// Undertow: a seeded, deterministic discrete-event simulation of clients, retries and a server.
// Works in the browser (window.Undertow) and in Node (module.exports).
//
// N clients send requests (one Poisson stream in total, each request given to a random client)
// over a network with a fixed one-way delay to a server with C workers and a bounded queue.
// Service times are lognormal. Each attempt has a client timeout. A timed-out attempt is
// abandoned by its client but stays in the queue, and still occupies a worker when it reaches
// one: the server cannot tell that nobody is waiting for it. A failed attempt (timeout, queue
// full, or shed) may be retried under a retry policy, up to a maximum number of attempts.
(function (root) {
  'use strict';

  // ------------------------------------------------------------------ random numbers
  function mulberry32(a) {
    a = a >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashSeed(seed, salt) {
    var h = (seed >>> 0) ^ Math.imul(salt + 0x9E3779B9, 0x85EBCA6B);
    h = Math.imul(h ^ (h >>> 16), 0x7FEB352D);
    h = Math.imul(h ^ (h >>> 15), 0x846CA68B);
    return (h ^ (h >>> 16)) >>> 0;
  }

  // ------------------------------------------------------------------ defaults
  var DEFAULTS = {
    clients: 20,          // N
    baseRate: 28,         // new requests per second across all clients (70% of capacity)
    workers: 4,           // C
    serviceMean: 0.1,     // s, lognormal mean
    serviceSigma: 0.6,    // lognormal shape (sigma of the underlying normal)
    queueCap: 200,        // waiting places; Infinity for an unbounded queue
    latency: 0.1,         // s, one-way network delay
    timeout: 1.0,         // s, client timeout per attempt, measured from sending
    retry: 'immediate',   // none | immediate | fixed | backoff | full | equal | decorrelated
    maxAttempts: 3,       // including the first
    fixedDelay: 0.5,      // s
    backoffBase: 0.2,     // s
    backoffCap: 10,       // s
    budget: false,        // per-client retry budget (token bucket)
    budgetRatio: 0.1,     // tokens earned per new request; a retry costs one token
    budgetBurst: 1,       // bucket size, and its starting fill
    shed: 'off',          // off | stale (drop past the timeout) | early (drop past half of it) | lifo
    lifoAge: 0.25,        // s: 'lifo' serves newest-first while the oldest waiting request is older than this
    breaker: false,       // per-client circuit breaker
    breakerWindow: 10,    // outcomes remembered
    breakerThreshold: 0.5,// share of failures in the window that opens it
    breakerOpen: 2,       // s it stays open before letting one probe through
    trigger: 'spike',     // none | spike | pause
    triggerStart: 5,      // s
    triggerDuration: 4,   // s
    spikeFactor: 2.5,     // offered load multiplier during a spike
    duration: 40,         // s simulated
    bin: 0.5              // s per metrics bin
  };

  var RETRY_POLICIES = ['none', 'immediate', 'fixed', 'backoff', 'full', 'equal', 'decorrelated'];

  // Event kinds
  var E_GEN = 0, E_ARRIVE = 1, E_FINISH = 2, E_RESPONSE = 3, E_TIMEOUT = 4, E_RETRY = 5,
      E_PAUSE_ON = 6, E_PAUSE_OFF = 7, E_DISPATCH = 8;

  // Response kinds
  var R_OK = 0, R_LATE = 1, R_REJECT = 2, R_SHED = 3;

  function Sim(opts, seed) {
    var c = this.cfg = {};
    var k;
    for (k in DEFAULTS) c[k] = DEFAULTS[k];
    if (opts) for (k in opts) if (opts[k] !== undefined) c[k] = opts[k];
    this.seed = (seed === undefined ? 1 : seed) >>> 0;
    this.rArr = mulberry32(hashSeed(this.seed, 1));
    this.rSvc = mulberry32(hashSeed(this.seed, 2));
    this.rJit = mulberry32(hashSeed(this.seed, 3));
    this.now = 0;
    this.heap = [];
    this.seq = 0;
    this.nextId = 1;
    this.log = null;            // set to an array to receive render events
    // queue as a deque on an array
    this.q = [];
    this.qh = 0;
    this.workers = [];
    for (var w = 0; w < c.workers; w++) this.workers.push({ att: null, finishAt: 0, ver: 0 });
    this.busy = 0;
    this.paused = false;
    this.clients = [];
    for (var i = 0; i < c.clients; i++) {
      this.clients.push({ tokens: c.budgetBurst, br: 'closed', ring: [], openUntil: 0, probing: false, opens: 0 });
    }
    // metrics
    var nb = Math.ceil(c.duration / c.bin) + 1;
    this.nb = nb;
    var names = ['demand', 'sent', 'retries', 'arrived', 'done', 'good', 'late', 'rejected', 'shed',
                 'gaveUp', 'blocked', 'succeeded', 'qArea', 'qMax', 'ageMax', 'p50', 'p99', 'busyArea'];
    this.m = {};
    for (var j = 0; j < names.length; j++) this.m[names[j]] = new Float64Array(nb);
    this.latBin = [];
    this.lastT = 0;
    this.T = {
      demand: 0, sent: 0, retries: 0, arrived: 0, done: 0, good: 0, late: 0, rejected: 0, shed: 0,
      gaveUp: 0, budgetDenied: 0, blocked: 0, succeeded: 0, failed: 0,
      busyTime: 0, goodWork: 0, wastedWork: 0,
      sysArea: 0, sojournSum: 0, sojournN: 0, // for Little's law (server: queue + service)
      inSystem: 0
    };
    this.pending = {}; // logical requests still open, by id (for checks)
    this.pendingCount = 0;
    this.triggers = [];
    this.genVer = 0;
    if (c.trigger === 'spike' || c.trigger === 'pause') this.addTrigger(c.trigger, c.triggerStart, c.triggerDuration, c.spikeFactor);
    else this.push(this.nextGenTime(0), E_GEN, null, this.genVer);
  }

  var P = Sim.prototype;

  // ---------------------------------------------------------------- event heap (time, seq)
  P.push = function (t, kind, obj, ver) {
    var h = this.heap;
    var e = { t: t, s: this.seq++, k: kind, o: obj, v: ver || 0 };
    h.push(e);
    var i = h.length - 1;
    while (i > 0) {
      var p = (i - 1) >> 1;
      var a = h[p];
      if (a.t < e.t || (a.t === e.t && a.s < e.s)) break;
      h[i] = a; i = p;
    }
    h[i] = e;
  };
  P.pop = function () {
    var h = this.heap;
    var top = h[0];
    var last = h.pop();
    if (h.length) {
      var i = 0, n = h.length;
      for (;;) {
        var l = 2 * i + 1, r = l + 1, m = i;
        var mv = last;
        if (l < n && (h[l].t < mv.t || (h[l].t === mv.t && h[l].s < mv.s))) { m = l; mv = h[l]; }
        if (r < n && (h[r].t < mv.t || (h[r].t === mv.t && h[r].s < mv.s))) { m = r; mv = h[r]; }
        if (m === i) break;
        h[i] = h[m]; i = m;
      }
      h[i] = last;
    }
    return top;
  };

  // ---------------------------------------------------------------- helpers
  // Triggers: a spike multiplies the offered load for a while; a pause stops every worker.
  // The constructor adds the configured one; the page can add more as the run goes on.
  P.addTrigger = function (kind, start, duration, factor) {
    var tr = { kind: kind, start: start, end: start + duration, factor: factor || 1 };
    this.triggers.push(tr);
    if (kind === 'pause') {
      this.push(start, E_PAUSE_ON, tr);
      this.push(tr.end, E_PAUSE_OFF, tr);
    }
    // Redraw the next arrival from now under the new rate schedule (exact, by memorylessness).
    this.genVer++;
    this.push(this.nextGenTime(this.now), E_GEN, null, this.genVer);
    return tr;
  };
  P.rateAt = function (t) {
    var r = this.cfg.baseRate;
    for (var i = 0; i < this.triggers.length; i++) {
      var tr = this.triggers[i];
      if (tr.kind === 'spike' && t >= tr.start && t < tr.end) r *= tr.factor;
    }
    return r;
  };
  P.nextBoundary = function (t) {
    var b = Infinity;
    for (var i = 0; i < this.triggers.length; i++) {
      var tr = this.triggers[i];
      if (tr.kind !== 'spike') continue;
      if (tr.start > t && tr.start < b) b = tr.start;
      if (tr.end > t && tr.end < b) b = tr.end;
    }
    return b;
  };
  // End of the most recent trigger (0 if none).
  P.lastTriggerEnd = function () {
    var e = 0;
    for (var i = 0; i < this.triggers.length; i++) if (this.triggers[i].end > e) e = this.triggers[i].end;
    return e;
  };
  // Exact piecewise-constant Poisson: draw with the current rate; if the draw crosses a rate
  // boundary, restart from the boundary (memorylessness makes this exact).
  P.nextGenTime = function (t) {
    for (;;) {
      var rate = this.rateAt(t);
      var dt = rate > 0 ? -Math.log(1 - this.rArr()) / rate : Infinity;
      var b = this.nextBoundary(t);
      if (t + dt <= b) return t + dt;
      t = b;
    }
  };
  P.serviceTime = function () {
    var c = this.cfg;
    var s = c.serviceSigma;
    var mu = Math.log(c.serviceMean) - s * s / 2;
    var u1 = this.rSvc(), u2 = this.rSvc();
    var z = Math.sqrt(-2 * Math.log(1 - u1)) * Math.cos(2 * Math.PI * u2);
    return Math.exp(mu + s * z);
  };
  P.qLen = function () { return this.q.length - this.qh; };
  P.binOf = function (t) { var b = Math.floor(t / this.cfg.bin); return b < 0 ? 0 : (b >= this.nb ? this.nb - 1 : b); };
  P.emit = function (ev) { if (this.log) this.log.push(ev); };

  // Accumulate time integrals (queue length, number at the server, busy workers) up to t.
  P.accum = function (t) {
    var bin = this.cfg.bin;
    var ql = this.qLen(), ns = this.T.inSystem, bz = this.busy;
    while (this.lastT < t) {
      var b = this.binOf(this.lastT);
      var end = Math.min(t, (b + 1) * bin);
      if (b === this.nb - 1) end = t;
      var dt = end - this.lastT;
      this.m.qArea[b] += ql * dt;
      this.m.busyArea[b] += bz * dt;
      this.T.sysArea += ns * dt;
      this.lastT = end;
    }
  };
  P.noteQueue = function () {
    var b = this.binOf(this.now);
    var ql = this.qLen();
    if (ql > this.m.qMax[b]) this.m.qMax[b] = ql;
    if (ql > 0) {
      var age = this.now - this.q[this.qh].arriveAt;
      if (age > this.m.ageMax[b]) this.m.ageMax[b] = age;
    }
  };

  // ---------------------------------------------------------------- main loop
  P.runUntil = function (t) {
    var limit = t;
    while (this.heap.length && this.heap[0].t <= limit) {
      var e = this.pop();
      this.accum(e.t);
      this.now = e.t;
      this.handle(e);
    }
    this.accum(limit);
    this.now = limit;
    this.closeBins();
    return this;
  };
  P.run = function () { return this.runUntil(this.cfg.duration); };

  P.closeBins = function () {
    // percentiles for bins that are complete
    var bin = this.cfg.bin;
    var upto = Math.min(this.nb, Math.floor(this.now / bin + 1e-9));
    if (this._closed === undefined) this._closed = 0;
    for (var b = this._closed; b < upto; b++) {
      var arr = this.latBin[b];
      if (arr && arr.length) {
        arr.sort(function (x, y) { return x - y; });
        this.m.p50[b] = arr[Math.min(arr.length - 1, Math.floor(0.5 * arr.length))];
        this.m.p99[b] = arr[Math.min(arr.length - 1, Math.floor(0.99 * arr.length))];
      } else {
        this.m.p50[b] = NaN; this.m.p99[b] = NaN;
      }
      this.latBin[b] = null;
    }
    this._closed = Math.max(this._closed, upto);
  };

  P.handle = function (e) {
    switch (e.k) {
      case E_GEN: if (e.v === this.genVer) this.onGen(); return;
      case E_ARRIVE: return this.onArrive(e.o);
      case E_FINISH: return this.onFinish(e.o, e.v);
      case E_RESPONSE: return this.onResponse(e.o, e.v);
      case E_TIMEOUT: return this.onTimeout(e.o);
      case E_RETRY: return this.sendAttempt(e.o);
      case E_PAUSE_ON: this.paused = true; return this.onPauseOn(e.o);
      case E_PAUSE_OFF: this.paused = false; this.emit({ type: 'resume', t: this.now }); return this.dispatch();
      case E_DISPATCH: return this.dispatch();
    }
  };

  // A new logical request from a random client.
  P.onGen = function () {
    var c = this.cfg;
    var client = Math.floor(this.rArr() * c.clients);
    var req = { id: this.nextId++, client: client, firstAt: this.now, attempts: 0, done: false, sleep: c.backoffBase };
    this.T.demand++;
    this.m.demand[this.binOf(this.now)]++;
    this.pending[req.id] = req; this.pendingCount++;
    var cl = this.clients[client];
    if (c.budget) cl.tokens = Math.min(c.budgetBurst, cl.tokens + c.budgetRatio);
    this.sendAttempt(req);
    this.push(this.nextGenTime(this.now), E_GEN, null, this.genVer);
  };

  P.breakerAllows = function (cl) {
    if (!this.cfg.breaker) return true;
    if (cl.br === 'closed') return true;
    if (cl.br === 'open') {
      if (this.now < cl.openUntil) return false;
      cl.br = 'half'; cl.probing = false;
    }
    // half-open: one probe at a time
    if (cl.probing) return false;
    cl.probing = true;
    return true;
  };
  P.breakerRecord = function (cl, ok) {
    var c = this.cfg;
    if (!c.breaker) return;
    if (cl.br === 'half') {
      cl.probing = false;
      if (ok) { cl.br = 'closed'; cl.ring = []; }
      else { cl.br = 'open'; cl.openUntil = this.now + c.breakerOpen; cl.opens++; }
      return;
    }
    if (cl.br !== 'closed') return;
    cl.ring.push(ok ? 0 : 1);
    if (cl.ring.length > c.breakerWindow) cl.ring.shift();
    if (cl.ring.length >= c.breakerWindow) {
      var f = 0;
      for (var i = 0; i < cl.ring.length; i++) f += cl.ring[i];
      if (f / cl.ring.length >= c.breakerThreshold) {
        cl.br = 'open'; cl.openUntil = this.now + c.breakerOpen; cl.opens++; cl.ring = [];
        this.emit({ type: 'breaker', t: this.now, client: cl === undefined ? -1 : this.clients.indexOf(cl) });
      }
    }
  };

  P.sendAttempt = function (req) {
    var c = this.cfg;
    var cl = this.clients[req.client];
    var b = this.binOf(this.now);
    if (!this.breakerAllows(cl)) {
      // Refused locally by the open breaker: the request fails fast and is not retried.
      this.T.blocked++; this.m.blocked[b]++;
      this.finishReq(req, false);
      this.emit({ type: 'blocked', t: this.now, client: req.client, n: req.attempts + 1 });
      return;
    }
    req.attempts++;
    var att = {
      id: this.nextId++, req: req, client: req.client, n: req.attempts,
      sentAt: this.now, arriveAt: 0, startAt: 0, svc: 0, waiting: true, state: 0,
      deadline: this.now + c.timeout, probe: cl.br === 'half'
    };
    this.T.sent++; this.m.sent[b]++;
    if (req.attempts > 1) { this.T.retries++; this.m.retries[b]++; }
    this.push(this.now + c.latency, E_ARRIVE, att);
    this.push(att.deadline, E_TIMEOUT, att);
    this.emit({ type: 'send', t: this.now, id: att.id, client: att.client, n: att.n });
  };

  P.onArrive = function (att) {
    var c = this.cfg;
    var b = this.binOf(this.now);
    att.arriveAt = this.now;
    this.T.arrived++; this.m.arrived[b]++;
    if (this.qLen() >= c.queueCap && this.busy >= c.workers) {
      this.T.rejected++; this.m.rejected[b]++;
      att.state = 4;
      this.emit({ type: 'reject', t: this.now, id: att.id, client: att.client, n: att.n });
      this.push(this.now + c.latency, E_RESPONSE, att, R_REJECT);
      return;
    }
    this.T.inSystem++;
    this.q.push(att);
    att.state = 1;
    this.emit({ type: 'enqueue', t: this.now, id: att.id, n: att.n });
    this.dispatch();
    this.noteQueue();
  };

  P.takeFromQueue = function () {
    var c = this.cfg;
    // Shedding: at the moment a worker frees up, drop requests that have waited in the queue
    // longer than the client timeout ('stale') or half of it ('early').
    var shedAge = c.shed === 'stale' ? c.timeout : c.shed === 'early' ? c.timeout / 2 : Infinity;
    if (shedAge < Infinity) {
      while (this.qLen() > 0 && this.now - this.q[this.qh].arriveAt > shedAge) {
        var d = this.q[this.qh];
        this.q[this.qh] = null; this.qh++;
        this.shedOne(d);
      }
    }
    if (this.qLen() === 0) return null;
    var att;
    if (c.shed === 'lifo' && this.now - this.q[this.qh].arriveAt > c.lifoAge) {
      att = this.q.pop();
    } else {
      att = this.q[this.qh]; this.q[this.qh] = null; this.qh++;
    }
    if (this.qh > 1024 && this.qh * 2 > this.q.length) { this.q = this.q.slice(this.qh); this.qh = 0; }
    return att;
  };
  P.shedOne = function (att) {
    var b = this.binOf(this.now);
    this.T.shed++; this.m.shed[b]++;
    this.T.inSystem--;
    att.state = 4;
    this.emit({ type: 'shed', t: this.now, id: att.id, client: att.client, n: att.n });
    this.push(this.now + this.cfg.latency, E_RESPONSE, att, R_SHED);
  };

  P.dispatch = function () {
    if (this.paused) return;
    var ws = this.workers;
    for (var w = 0; w < ws.length; w++) {
      if (ws[w].att) continue;
      var att = this.takeFromQueue();
      if (!att) break;
      att.state = 2;
      att.startAt = this.now;
      att.svc = this.serviceTime();
      ws[w].att = att;
      ws[w].finishAt = this.now + att.svc;
      ws[w].ver++;
      this.busy++;
      this.push(ws[w].finishAt, E_FINISH, w, ws[w].ver);
      this.emit({ type: 'start', t: this.now, id: att.id, worker: w, n: att.n, svc: att.svc });
    }
  };

  P.onPauseOn = function (tr) {
    var d = tr.end - tr.start;
    this.emit({ type: 'pause', t: this.now });
    for (var w = 0; w < this.workers.length; w++) {
      var wk = this.workers[w];
      if (!wk.att) continue;
      wk.finishAt += d; wk.ver++;
      wk.att.svc += d; // a paused worker holds its request for the pause as well
      this.push(wk.finishAt, E_FINISH, w, wk.ver);
    }
  };

  P.onFinish = function (w, ver) {
    var wk = this.workers[w];
    if (wk.ver !== ver || !wk.att) return;
    var c = this.cfg;
    var att = wk.att;
    wk.att = null; this.busy--;
    var b = this.binOf(this.now);
    this.T.done++; this.m.done[b]++;
    this.T.inSystem--;
    this.T.busyTime += att.svc;
    this.T.sojournSum += this.now - att.arriveAt; this.T.sojournN++;
    // In time if the response reaches the client before its deadline.
    var good = this.now + c.latency <= att.deadline;
    if (good) { this.T.good++; this.m.good[b]++; this.T.goodWork += att.svc; }
    else { this.T.late++; this.m.late[b]++; this.T.wastedWork += att.svc; }
    var lat = this.now + c.latency - att.sentAt;
    (this.latBin[b] || (this.latBin[b] = [])).push(lat);
    att.state = 3;
    this.emit({ type: 'finish', t: this.now, id: att.id, worker: w, client: att.client, n: att.n, good: good });
    this.push(this.now + c.latency, E_RESPONSE, att, good ? R_OK : R_LATE);
    this.dispatch();
    this.noteQueue();
  };

  P.onResponse = function (att, kind) {
    if (!att.waiting) return; // nobody is listening any more
    att.waiting = false;
    var cl = this.clients[att.client];
    if (kind === R_OK) {
      this.breakerRecord(cl, true);
      this.T.succeeded++; this.m.succeeded[this.binOf(this.now)]++;
      this.finishReq(att.req, true);
      this.emit({ type: 'success', t: this.now, id: att.id, client: att.client, n: att.n });
    } else {
      // A fast error (queue full or shed): the client learns of it before its timeout.
      this.breakerRecord(cl, false);
      this.onFailure(att);
    }
  };

  P.onTimeout = function (att) {
    if (!att.waiting) return;
    att.waiting = false;
    this.emit({ type: 'timeout', t: this.now, id: att.id, client: att.client, n: att.n });
    this.breakerRecord(this.clients[att.client], false);
    this.onFailure(att);
  };

  P.retryDelay = function (req) {
    var c = this.cfg;
    var n = req.attempts; // attempts already made (>= 1)
    var exp = Math.min(c.backoffCap, c.backoffBase * Math.pow(2, n - 1));
    switch (c.retry) {
      case 'immediate': return 0;
      case 'fixed': return c.fixedDelay;
      case 'backoff': return exp;
      case 'full': return this.rJit() * exp;
      case 'equal': return exp / 2 + this.rJit() * exp / 2;
      case 'decorrelated':
        var lo = c.backoffBase, hi = req.sleep * 3;
        req.sleep = Math.min(c.backoffCap, lo + this.rJit() * (hi - lo));
        return req.sleep;
    }
    return -1;
  };

  P.onFailure = function (att) {
    var c = this.cfg;
    var req = att.req;
    if (req.done) return;
    if (c.retry === 'none' || req.attempts >= c.maxAttempts) { this.finishReq(req, false); return; }
    if (c.budget) {
      var cl = this.clients[req.client];
      if (cl.tokens < 1) { this.T.budgetDenied++; this.finishReq(req, false); this.emit({ type: 'denied', t: this.now, client: req.client }); return; }
      cl.tokens -= 1;
    }
    var d = this.retryDelay(req);
    if (d < 0) { this.finishReq(req, false); return; }
    this.push(this.now + d, E_RETRY, req);
  };

  P.finishReq = function (req, ok) {
    if (req.done) return;
    req.done = true;
    delete this.pending[req.id]; this.pendingCount--;
    if (!ok) { this.T.failed++; this.T.gaveUp++; this.m.gaveUp[this.binOf(this.now)]++; }
  };

  // Live changes from the page (remedies and retry settings take effect for new decisions).
  P.set = function (key, value) {
    this.cfg[key] = value;
    if (key === 'budget' && value) {
      for (var i = 0; i < this.clients.length; i++) this.clients[i].tokens = Math.min(this.clients[i].tokens, this.cfg.budgetBurst);
    }
    if (key === 'breaker' && !value) {
      for (var j = 0; j < this.clients.length; j++) { var cl = this.clients[j]; cl.br = 'closed'; cl.ring = []; cl.probing = false; }
    }
    if (key === 'shed') this.dispatch();
  };

  // Snapshot of the queue for drawing: [{n, age, waiting}] oldest first.
  P.queueSnapshot = function (max) {
    var out = [];
    var n = this.qLen();
    var lim = Math.min(n, max || n);
    for (var i = 0; i < lim; i++) {
      var a = this.q[this.qh + i];
      out.push({ id: a.id, n: a.n, age: this.now - a.arriveAt, waiting: a.waiting, sentAt: a.sentAt, deadline: a.deadline });
    }
    return out;
  };

  // ---------------------------------------------------------------- summaries
  function sumRange(arr, a, b) { var s = 0; for (var i = a; i < b; i++) s += arr[i]; return s; }

  // Window used to call a run "stuck": the 10 s that begin 20 s after the trigger ends.
  var STUCK = { after: 20, length: 10, fraction: 0.5 };

  // Ratio of goodput to offered load over [t0, t1).
  P.goodRatio = function (t0, t1) {
    var bin = this.cfg.bin;
    var a = Math.max(0, Math.round(t0 / bin)), b = Math.min(this.nb, Math.round(t1 / bin));
    var d = sumRange(this.m.demand, a, b), g = sumRange(this.m.good, a, b);
    return d > 0 ? g / d : 1;
  };

  // Seconds after the trigger ended until goodput first stays at >= 90% of offered load over a
  // sliding 2 s window, or null if that never happens within the run.
  P.recoveryTime = function (from) {
    var c = this.cfg, bin = c.bin;
    var te = from === undefined ? this.lastTriggerEnd() : from;
    var w = Math.round(2 / bin);
    var end = Math.min(this.nb, Math.floor(this.now / bin));
    for (var b = Math.round(te / bin); b + w <= end; b++) {
      var d = sumRange(this.m.demand, b, b + w), g = sumRange(this.m.good, b, b + w);
      if (d > 0 && g / d >= 0.9) {
        // also require it to hold to the end of the run (no relapse)
        var ok = true;
        for (var k = b; k + w <= end; k += w) {
          var d2 = sumRange(this.m.demand, k, k + w), g2 = sumRange(this.m.good, k, k + w);
          if (d2 > 0 && g2 / d2 < 0.6) { ok = false; break; }
        }
        if (ok) return Math.max(0, b * bin - te);
      }
    }
    return null;
  };

  P.summary = function () {
    var te = this.lastTriggerEnd();
    var t0 = te + STUCK.after, t1 = t0 + STUCK.length;
    var ratio = this.goodRatio(t0, Math.min(t1, this.now));
    var T = this.T;
    return {
      stuck: ratio < STUCK.fraction,
      ratioAfter: ratio,
      recovery: this.recoveryTime(),
      amplification: T.demand ? T.sent / T.demand : 1,
      wastedShare: T.busyTime ? T.wastedWork / T.busyTime : 0,
      totals: T
    };
  };

  // Run a configuration; `changes` optionally switches settings mid-run: [{at: s, set: {...}}].
  function simulate(opts, seed, changes) {
    var s = new Sim(opts, seed);
    if (changes) {
      for (var i = 0; i < changes.length; i++) {
        s.runUntil(changes[i].at);
        for (var k in changes[i].set) s.set(k, changes[i].set[k]);
      }
    }
    s.run();
    return s;
  }

  // Share of seeds that recover, for a configuration.
  function recoverShare(opts, seeds, changes) {
    var ok = 0;
    for (var i = 0; i < seeds.length; i++) if (!simulate(opts, seeds[i], changes).summary().stuck) ok++;
    return ok / seeds.length;
  }

  function seedList(n, start) { var a = []; for (var i = 0; i < n; i++) a.push((start || 1) + i); return a; }

  // ---------------------------------------------------------------- the guided path
  // Each step is a configuration and the outcome the page claims for it; the tests check every
  // claim over many seeds, and the page's figures come from the same runs (data.js).
  var STEPS = [
    { key: 'healthy', claim: 'healthy', opts: { trigger: 'none', retry: 'immediate' } },
    { key: 'noretry', claim: 'recovers', opts: { retry: 'none' } },
    { key: 'naive', claim: 'stuck', opts: { retry: 'immediate' } },
    { key: 'backoff', claim: 'stuck', opts: { retry: 'backoff' } },
    { key: 'jitter', claim: 'stuck', opts: { retry: 'full' } },
    // The visitor switches the budget on mid-collapse; the check switches it on at 15 s.
    { key: 'budget', claim: 'recovers', opts: { retry: 'full', duration: 60 }, changes: [{ at: 15, set: { budget: true } }] }
  ];
  var STEP_SEEDS = 40;

  // Outcome of one seeded run of a step: did the claim hold, and when did it recover.
  function stepOutcome(step, seed) {
    var s = simulate(step.opts, seed, step.changes);
    var sum = s.summary();
    var from = step.changes ? step.changes[0].at : s.lastTriggerEnd();
    var rec = s.recoveryTime(from);
    var T = s.T;
    var held;
    if (step.claim === 'healthy') held = T.good >= 0.97 * T.demand && T.retries <= 0.01 * T.sent;
    else if (step.claim === 'stuck') held = sum.stuck;
    else held = rec !== null && rec <= 30;
    return { held: held, recovery: rec, stuck: sum.stuck, amplification: sum.amplification, wastedShare: sum.wastedShare };
  }

  function stepFigures(step, n) {
    var seeds = seedList(n || STEP_SEEDS), held = 0, recs = [], amps = 0, waste = 0;
    for (var i = 0; i < seeds.length; i++) {
      var o = stepOutcome(step, seeds[i]);
      if (o.held) held++;
      if (o.recovery !== null) recs.push(o.recovery);
      amps += o.amplification; waste += o.wastedShare;
    }
    recs.sort(function (x, y) { return x - y; });
    return {
      key: step.key, runs: seeds.length, held: held,
      recovered: recs.length,
      medianRecovery: recs.length ? recs[Math.floor(recs.length / 2)] : null,
      amplification: Math.round(100 * amps / seeds.length) / 100,
      wastedShare: Math.round(100 * waste / seeds.length) / 100
    };
  }

  // The challenge: a bigger, longer spike. The visitor's settings are run over CHALLENGE_SEEDS seeds.
  var CHALLENGE = { trigger: 'spike', spikeFactor: 3, triggerDuration: 6 };
  var CHALLENGE_SEEDS = 20, CHALLENGE_PASS = 18;

  // Phase map: spike size x client and server policy (the remedy rows retry at once, up to 3 attempts).
  var PHASE = {
    factors: [1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 2, 2.5, 3, 4],
    rows: [
      { key: 'none', opts: { retry: 'none' } },
      { key: 'immediate', opts: { retry: 'immediate' } },
      { key: 'fixed', opts: { retry: 'fixed' } },
      { key: 'backoff', opts: { retry: 'backoff' } },
      { key: 'full', opts: { retry: 'full' } },
      { key: 'equal', opts: { retry: 'equal' } },
      { key: 'decorrelated', opts: { retry: 'decorrelated' } },
      { key: 'budget', opts: { retry: 'immediate', budget: true } },
      { key: 'stale', opts: { retry: 'immediate', shed: 'stale' } },
      { key: 'early', opts: { retry: 'immediate', shed: 'early' } },
      { key: 'lifo', opts: { retry: 'immediate', shed: 'lifo' } },
      { key: 'breaker', opts: { retry: 'immediate', breaker: true } }
    ],
    seeds: 20
  };

  // Number of seeds (out of PHASE.seeds) that recover for one cell.
  function phaseCell(rowKey, factor) {
    var row = null;
    for (var i = 0; i < PHASE.rows.length; i++) if (PHASE.rows[i].key === rowKey) row = PHASE.rows[i];
    var o = { trigger: 'spike', spikeFactor: factor };
    for (var k in row.opts) o[k] = row.opts[k];
    return Math.round(recoverShare(o, seedList(PHASE.seeds)) * PHASE.seeds);
  }

  var api = {
    DEFAULTS: DEFAULTS, RETRY_POLICIES: RETRY_POLICIES, STUCK: STUCK, STEPS: STEPS,
    STEP_SEEDS: STEP_SEEDS, CHALLENGE: CHALLENGE, CHALLENGE_SEEDS: CHALLENGE_SEEDS,
    CHALLENGE_PASS: CHALLENGE_PASS, PHASE: PHASE,
    Sim: Sim, simulate: simulate, recoverShare: recoverShare, seedList: seedList,
    stepOutcome: stepOutcome, stepFigures: stepFigures, phaseCell: phaseCell, mulberry32: mulberry32
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Undertow = api;
})(typeof window !== 'undefined' ? window : this);
