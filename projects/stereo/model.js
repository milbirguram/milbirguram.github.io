/* Stereo: model.js
 *
 * One small simulated bike-share city, computed as five layers, each from the one below:
 *   world     what really happened (riders, bikes, weather)
 *   log       what got recorded (raw events from phones and docks, in UTC)
 *   pipeline  what the nightly job did (filter, dedupe, time zone, pairing, join, group-by)
 *   dashboard what people see (rides, riders turned away, average trip length)
 *   model     what a forecaster learned (Poisson regression, refitted every night)
 *
 * Every transform really runs on arrays of rows. A fault changes one layer; the layers above it
 * are recomputed from the changed data and the layers below it are never touched.
 * Works in the browser (window.Stereo) and in Node (module.exports).
 */
(function (root) {
  'use strict';

  // ---------- constants ----------
  var DAY = 86400, HOUR = 3600;
  var UTC_OFFSET = 7 * HOUR;          // the city keeps Pacific daylight time: UTC = local + 7 h
  var N_DAYS = 60;                    // Mon 2 Jun to Thu 31 Jul
  var NP = N_DAYS + 1;                // log partitions: one per night, plus one for arrivals after the season
  var FAULT_DAY = 28;                 // Mon 30 Jun: when faults begin in cause-and-effect mode
  var OPEN_DAY = 35;                  // Mon 7 Jul: Riverside opens, when that change is on
  var HEAT_FROM = 38, HEAT_TO = 44;   // Thu 10 Jul to Wed 16 Jul
  var FIRST_FORECAST = 14;            // the model needs two weeks of data before its first forecast
  var TRAIN_WINDOW = 28;              // it is refitted every night on the last 28 days
  var RIDGE = 1;                      // a tiny penalty so a window with no rain still has a solution

  var BASE_DEMAND = 600;              // ride requests on a dry 20°C weekday, before Riverside
  var B_TEMP = 0.032, B_RAIN = -0.48, B_WEEKEND = -0.14;
  var MAINT_PER_DAY = 5;

  var RETRY_RATE = 0.04;              // phones and docks resend about 4% of events (normal)
  var DROP_RATE = 0.30;               // firmware fault: share of Harbour returns lost
  var DOUBLE_SHARE = 0.35;            // app fault: share of riders on the update that double-sends
  var SKEW = HOUR;                    // clock fault: Rail Station's dock runs an hour ahead
  var HEAT_FLAG = 28.5;               // the weather record check calls a day this hot unusual
  var HARBOUR = 0, RAIL = 1, RIVERSIDE = 8;
  var DEFAULT_SEED = 7;

  var LAYERS = ['world', 'log', 'pipeline', 'dashboard', 'model'];
  var LAYER_INDEX = { world: 0, log: 1, pipeline: 2, dashboard: 3, model: 4 };

  // Stations: position in km on a 5.4 by 4.6 km map, bikes after the overnight rebalance, and
  // demand weights [weekday 6–10 origin, destination, weekday 16–20 origin, destination, other hours and weekends].
  var STATIONS = [
    { id: 0, name: 'Harbour',      x: 2.1, y: 0.6, bikes: 30, zone: 'Waterfront', w: [0.8, 3.0, 2.6, 3.2, 3.8] },
    { id: 1, name: 'Rail Station', x: 3.3, y: 1.3, bikes: 24, zone: 'Centre',     w: [2.4, 1.0, 1.2, 2.4, 1.0] },
    { id: 2, name: 'Market',       x: 1.3, y: 1.7, bikes: 18, zone: 'Centre',     w: [0.6, 1.6, 1.8, 0.9, 2.0] },
    { id: 3, name: 'Library',      x: 2.6, y: 2.2, bikes: 15, zone: 'Centre',     w: [0.4, 1.8, 1.8, 0.5, 1.0] },
    { id: 4, name: 'University',   x: 4.3, y: 2.6, bikes: 21, zone: 'East',       w: [0.5, 2.8, 2.8, 0.5, 0.8] },
    { id: 5, name: 'Park Gate',    x: 0.6, y: 3.0, bikes: 21, zone: 'West',       w: [1.8, 0.4, 0.6, 1.6, 2.4] },
    { id: 6, name: 'Old Mill',     x: 1.8, y: 3.8, bikes: 24, zone: 'West',       w: [2.8, 0.3, 0.5, 2.4, 1.0] },
    { id: 7, name: 'Hillside',     x: 3.4, y: 4.1, bikes: 24, zone: 'East',       w: [2.8, 0.3, 0.5, 2.4, 0.8] },
    { id: 8, name: 'Riverside',    x: 4.9, y: 1.1, bikes: 18, zone: 'East',       w: [2.2, 0.4, 0.5, 2.0, 1.2], opens: OPEN_DAY }
  ];

  // The menu of changes, one or more per layer. World changes are real; the rest are faults.
  var FAULTS = {
    heatwave:   { layer: 'world', real: true, label: 'Heatwave, 10–16 July',
                  what: 'Seven days at 30–33°C. More people want bikes than the docks hold.' },
    newstation: { layer: 'world', real: true, label: 'New station opens, 7 July',
                  what: 'Riverside opens with 18 bikes and riders of its own.' },
    firmware:   { layer: 'log', label: 'Dock firmware loses 30% of returns at Harbour',
                  what: 'Harbour’s docks stop sending about 30% of return events. The bikes still arrive.' },
    doublesend: { layer: 'log', label: 'App update sends some events twice',
                  what: 'An app update sends checkouts and ‘no bike’ events twice for about a third of riders.' },
    clockskew:  { layer: 'log', label: 'Rail Station’s dock clock runs an hour ahead',
                  what: 'The dock at Rail Station stamps every event an hour later than it happened.' },
    staletable: { layer: 'pipeline', label: 'Stations table misses the new station',
                  what: 'Riverside opens on 7 July, but nobody adds it to the stations table the pipeline joins against.' },
    timezone:   { layer: 'pipeline', label: 'Date taken from UTC, not local time',
                  what: 'The pipeline reads the date straight off the UTC timestamp. The city is 7 hours behind UTC.' },
    dedupekey:  { layer: 'pipeline', label: 'Dedupe on event id, not ride id',
                  what: 'Every resent copy has a new event id, so deduplicating on it removes nothing.' },
    definition: { layer: 'dashboard', label: 'Average trip length redefined as the median',
                  what: '‘Average trip length’ switches from the mean to the median.' },
    weatherjoin:{ layer: 'model', label: 'Training job joins the previous day’s weather',
                  what: 'The nightly training query pairs each day’s rides with the day before’s weather.' }
  };
  var FAULT_IDS = Object.keys(FAULTS);
  // Only the menu's own keys count: 'constructor' or 'toString' must never pass as a fault.
  function isFault(id) { return typeof id === 'string' && Object.prototype.hasOwnProperty.call(FAULTS, id); }

  // ---------- small helpers ----------
  var WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var MONTHS = ['May', 'Jun', 'Jul', 'Aug'];
  function dateLabel(d) {
    var dom = 2 + d, m = 1;
    if (dom < 1) { dom += 31; m = 0; }
    else if (dom > 30) { dom -= 30; m = 2; if (dom > 31) { dom -= 31; m = 3; } }
    return WD[((d % 7) + 7) % 7] + ' ' + dom + ' ' + MONTHS[m];
  }
  function weekdayOf(d) { return ((d % 7) + 7) % 7; }
  function isWeekend(d) { return weekdayOf(d) >= 5; }
  function meanMinutes(sumSeconds, n) { return n > 0 ? sumSeconds / n / 60 : 0; }
  function clampPart(p) { return p < 0 ? 0 : p > N_DAYS ? N_DAYS : p; }
  function g(x, m, s) { var z = (x - m) / s; return Math.exp(-0.5 * z * z); }

  // ---------- seeded, stateless randomness ----------
  // Every draw is a hash of (seed, purpose, ids). One layer's choices can never shift another's.
  function mix(h, k) {
    k = Math.imul(k | 0, 0xcc9e2d51); k = (k << 15) | (k >>> 17); k = Math.imul(k, 0x1b873593);
    h ^= k; h = (h << 13) | (h >>> 19);
    return (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  function fmix(h) {
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return h >>> 0;
  }
  function rnd(seed, tag, a, b, c) {
    var h = mix(mix(mix(mix(seed | 0, tag), a | 0), b | 0), c | 0);
    return (fmix(h ^ 20) + 0.5) / 4294967296;
  }
  function gauss(seed, tag, a, b) {
    var u = rnd(seed, tag, a, b, 7771), v = rnd(seed, tag, a, b, 7772);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function poisson(lam, seed, tag, a, b) {
    if (lam <= 0) return 0;
    if (lam < 30) {
      var L = Math.exp(-lam), k = 0, p = 1;
      do { k++; p *= rnd(seed, tag, a, b, k); } while (p > L && k < 400);
      return k - 1;
    }
    return Math.max(0, Math.round(lam + Math.sqrt(lam) * gauss(seed, tag, a, b)));
  }
  var T = { TEMP: 11, RAIN: 12, HEAT: 13, COUNT: 21, TIME: 22, ORIGIN: 23, DEST: 24, ROUND: 25, DUR: 26,
            MAINT: 27, RECV: 31, RETRY: 32, DROP: 33, PHONE: 34 };

  // ---------- a binary heap for bikes in use ----------
  function Heap() { this.t = []; this.v = []; }
  Heap.prototype.push = function (t, v) {
    var a = this.t, b = this.v, i = a.length;
    a.push(t); b.push(v);
    while (i > 0) { var p = (i - 1) >> 1; if (a[p] <= t) break; a[i] = a[p]; b[i] = b[p]; i = p; }
    a[i] = t; b[i] = v;
  };
  Heap.prototype.peek = function () { return this.t.length ? this.t[0] : Infinity; };
  Heap.prototype.pop = function () {
    var a = this.t, b = this.v, top = b[0], lt = a.pop(), lv = b.pop(), n = a.length;
    if (n) {
      var i = 0;
      for (;;) {
        var l = 2 * i + 1, r = l + 1, m = i, mt = lt;
        if (l < n && a[l] < mt) { m = l; mt = a[l]; }
        if (r < n && a[r] < mt) { m = r; mt = a[r]; }
        if (m === i) break;
        a[i] = a[m]; b[i] = b[m]; i = m;
      }
      a[i] = lt; b[i] = lv;
    }
    return top;
  };

  // =====================================================================================
  // LAYER 1. THE WORLD: what really happened
  // =====================================================================================
  function makeWeather(seed, heatwave) {
    var out = [];
    for (var d = 0; d < N_DAYS; d++) {
      var t = 20 + 2.4 * Math.sin(2 * Math.PI * (d - 8) / 50) + 2.0 * gauss(seed, T.TEMP, d, 0);
      var rain = rnd(seed, T.RAIN, d, 0, 0) < 0.27;
      if (rain) t -= 2.5;
      t = Math.min(27, Math.max(13, t));
      if (heatwave && d >= HEAT_FROM && d <= HEAT_TO) { t = 30 + 2.6 * rnd(seed, T.HEAT, d, 0, 0); rain = false; }
      out.push({ day: d, temp: Math.round(t * 10) / 10, rain: rain, weekend: isWeekend(d) });
    }
    return out;
  }

  function hourProfile(weekend) {
    var p = new Float64Array(24), s = 0, h;
    for (h = 0; h < 24; h++) {
      var x = h + 0.5, v;
      if (!weekend) v = 0.2 + 3.0 * g(x, 8.2, 1.0) + 2.5 * g(x, 17.5, 1.3) + 0.9 * g(x, 12.5, 1.7) + 0.4 * g(x, 21.5, 1.4);
      else v = 0.2 + 2.4 * g(x, 14.5, 3.2) + 0.5 * g(x, 22, 1.5);
      if (h < 6) v *= 0.25;
      p[h] = v; s += v;
    }
    for (h = 0; h < 24; h++) p[h] /= s;
    return p;
  }
  var PROFILE = [hourProfile(false), hourProfile(true)];

  // 0: weekday morning, 2: weekday evening, 4: other hours and weekends (origin weights; +1 for destinations)
  function periodOf(weekend, h) {
    if (weekend) return 4;
    if (h >= 6 && h < 10) return 0;
    if (h >= 16 && h < 20) return 2;
    return 4;
  }
  function weightsFor(col, riverOpen) {
    var w = new Float64Array(STATIONS.length);
    for (var s = 0; s < STATIONS.length; s++) w[s] = (STATIONS[s].opens && !riverOpen) ? 0 : STATIONS[s].w[col];
    return w;
  }
  function pick(w, u, except) {
    var tot = 0, s;
    for (s = 0; s < w.length; s++) if (s !== except) tot += w[s];
    var x = u * tot;
    for (s = 0; s < w.length; s++) {
      if (s === except) continue;
      x -= w[s];
      if (x < 0) return s;
    }
    for (s = w.length - 1; s >= 0; s--) if (s !== except && w[s] > 0) return s;
    return 0;
  }
  // Riverside adds its own riders: demand in each period grows by its share of the origin weights.
  function openMultiplier(per) {
    var a = 0, b = 0;
    for (var s = 0; s < STATIONS.length; s++) { b += STATIONS[s].w[per]; if (!STATIONS[s].opens) a += STATIONS[s].w[per]; }
    return b / a;
  }
  var OPEN_MULT = { 0: openMultiplier(0), 2: openMultiplier(2), 4: openMultiplier(4) };

  function tripSeconds(seed, d, key, o, dst, leisure, roundTrip) {
    var dist;
    if (roundTrip) dist = 1.4 + 1.8 * rnd(seed, T.DUR, d, key, 3);
    else dist = 1.25 * Math.hypot(STATIONS[o].x - STATIONS[dst].x, STATIONS[o].y - STATIONS[dst].y);
    var m = (2 + dist * (leisure ? 5.0 : 3.8)) * Math.exp(0.42 * gauss(seed, T.DUR, d, key));
    if (rnd(seed, T.DUR, d, key, 4) < (leisure ? 0.07 : 0.02)) m *= 2 + 2 * rnd(seed, T.DUR, d, key, 5);
    return Math.max(90, Math.round(m * 60));
  }

  function simulateWorld(seed, heatwave, newStation) {
    var weather = makeWeather(seed, heatwave);
    var nS = STATIONS.length, s, d, k;
    var rides = [], unmet = [], maint = [];
    var truth = {
      requests: new Int32Array(N_DAYS), rides: new Int32Array(N_DAYS), unmet: new Int32Array(N_DAYS),
      sumDur: new Float64Array(N_DAYS), tripLen: new Float64Array(N_DAYS)
    };
    var invStart = [], changes = [], dayIndex = [];
    for (d = 0; d < N_DAYS; d++) changes.push([]);
    var inv = [];
    for (s = 0; s < nS; s++) inv.push([]);
    var heap = new Heap();
    var nextBike = 0;
    for (s = 0; s < nS; s++) if (!STATIONS[s].opens) for (k = 0; k < STATIONS[s].bikes; k++) inv[0].push(nextBike++);

    function flush(t) {
      while (heap.t.length && heap.peek() <= t) {
        var at = heap.peek(), r = heap.pop();
        inv[r.st].push(r.bike);
        var day = Math.floor(at / DAY);
        if (day < N_DAYS) changes[day].push(at - day * DAY, r.st, 1);
      }
    }

    for (d = 0; d < N_DAYS; d++) {
      var dayStart = d * DAY;
      var riverOpen = !!newStation && d >= OPEN_DAY;
      flush(dayStart - 1);
      // The overnight truck takes every docked bike and refills each open station to its target.
      var docked = [];
      for (s = 0; s < nS; s++) { for (k = 0; k < inv[s].length; k++) docked.push(inv[s][k]); inv[s] = []; }
      if (newStation && d === OPEN_DAY) for (k = 0; k < STATIONS[RIVERSIDE].bikes; k++) docked.push(nextBike++);
      docked.sort(function (a, b) { return a - b; });
      var at = 0;
      for (s = 0; s < nS; s++) {
        if (STATIONS[s].opens && !riverOpen) continue;
        var take = Math.min(STATIONS[s].bikes, docked.length - at);
        inv[s] = docked.slice(at, at + take); at += take;
      }
      for (; at < docked.length; at++) inv[HARBOUR].push(docked[at]);
      var starts = new Int16Array(nS);
      for (s = 0; s < nS; s++) starts[s] = inv[s].length;
      invStart.push(starts);

      // Ride requests: Poisson counts per hour, from the day's weather and the hour's shape.
      var w = weather[d], we = w.weekend;
      var lam = BASE_DEMAND * Math.exp(B_TEMP * (w.temp - 20) + B_RAIN * (w.rain ? 1 : 0) + B_WEEKEND * (we ? 1 : 0));
      var prof = PROFILE[we ? 1 : 0];
      var evs = [];
      for (var h = 0; h < 24; h++) {
        var per = periodOf(we, h);
        var oW = weightsFor(per, riverOpen), dW = weightsFor(per === 4 ? 4 : per + 1, riverOpen);
        var n = poisson(lam * prof[h] * (riverOpen ? OPEN_MULT[per] : 1), seed, T.COUNT, d, h);
        for (var i = 0; i < n; i++) {
          var key = h * 1000 + i;
          var o = pick(oW, rnd(seed, T.ORIGIN, d, key, 0), -1);
          var leisure = per === 4;
          var roundTrip = rnd(seed, T.ROUND, d, key, 0) < (leisure ? 0.12 : 0.03);
          var dst = roundTrip ? o : pick(dW, rnd(seed, T.DEST, d, key, 0), o);
          evs.push({
            t: dayStart + h * HOUR + Math.floor(rnd(seed, T.TIME, d, key, 0) * HOUR), key: key, kind: 0,
            o: o, dst: dst, dur: tripSeconds(seed, d, key, o, dst, leisure, roundTrip)
          });
        }
      }
      // A mechanic checks a few bikes a day; those moves are not rides.
      for (var m = 0; m < MAINT_PER_DAY; m++) {
        var ms = Math.floor(rnd(seed, T.MAINT, d, m, 1) * 8);
        evs.push({
          t: dayStart + Math.floor((10 + 5 * rnd(seed, T.MAINT, d, m, 0)) * HOUR), key: 90000 + m, kind: 1,
          o: ms, dst: ms, dur: 1200 + Math.floor(rnd(seed, T.MAINT, d, m, 2) * 1200), m: m
        });
      }
      evs.sort(function (a, b) { return (a.t - b.t) || (a.key - b.key); });

      var seq = 0, first = rides.length;
      for (var e = 0; e < evs.length; e++) {
        var ev = evs[e];
        flush(ev.t);
        if (ev.kind === 0) {
          var id = d * 10000 + (seq++);
          truth.requests[d]++;
          if (inv[ev.o].length) {
            var bike = inv[ev.o].pop();
            var ride = { id: id, day: d, st0: ev.o, st1: ev.dst, t0: ev.t, t1: ev.t + ev.dur, bike: bike };
            rides.push(ride);
            heap.push(ride.t1, { bike: bike, st: ev.dst });
            changes[d].push(ev.t - dayStart, ev.o, -1);
            truth.rides[d]++;
            truth.sumDur[d] += ev.dur;
          } else {
            unmet.push({ id: id, day: d, st: ev.o, t: ev.t });
            truth.unmet[d]++;
          }
        } else if (inv[ev.o].length) {
          var mb = inv[ev.o].pop();
          maint.push({ id: d * 10000 + 9000 + ev.m, day: d, st0: ev.o, st1: ev.o, t0: ev.t, t1: ev.t + ev.dur, bike: mb });
          heap.push(ev.t + ev.dur, { bike: mb, st: ev.o });
          changes[d].push(ev.t - dayStart, ev.o, -1);
        }
      }
      dayIndex.push([first, rides.length]);
      truth.tripLen[d] = meanMinutes(truth.sumDur[d], truth.rides[d]);
    }
    flush(Infinity);

    var ops = [];
    if (newStation) ops.push({ day: OPEN_DAY, text: 'Riverside opened with ' + STATIONS[RIVERSIDE].bikes + ' bikes' });
    return {
      seed: seed, heatwave: !!heatwave, newStation: !!newStation, weather: weather,
      rides: rides, unmet: unmet, maint: maint, truth: truth, dayIndex: dayIndex,
      invStart: invStart, changes: changes, ops: ops, fleet: nextBike
    };
  }

  // =====================================================================================
  // LAYER 2. THE LOG: what got recorded
  // Checkouts and 'no bike' events come from the rider's phone; returns come from the dock.
  // Timestamps are UTC from the sender's clock (ts); the server adds its own arrival time (recv).
  // =====================================================================================
  // Event ids are numbers: (ref × 3 + type code) × 3 + copy, where copy 0 is the original,
  // 1 a normal network resend and 2 a resend caused by the app fault.
  var CODE = { checkout: 0, 'return': 1, nobike: 2 };
  function eventId(ref, type, copy) { return (ref * 3 + CODE[type]) * 3 + copy; }
  function eventKey(e) { return e.ref * 3 + CODE[e.type]; }
  function copyEvent(e, eid, recv, note) {
    return { eid: eid, type: e.type, kind: e.kind, src: e.src, ref: e.ref, bike: e.bike, st: e.st,
             ts: e.ts, recv: recv, note: note, part: 0 };
  }

  function makeLog(world, sc) {
    var seed = world.seed, f = sc.fault, F = sc.faultDay * DAY;
    var events = [], ghosts = [];
    function retry(e, code) {
      if (rnd(seed, T.RETRY, e.ref, code, 0) < RETRY_RATE) {
        events.push(copyEvent(e, e.eid + 1, e.recv + 6 + Math.floor(rnd(seed, T.RETRY, e.ref, code, 1) * 50), 'retry'));
      }
    }
    function doubled(e, code, tTrue) {
      if (f === 'doublesend' && tTrue >= F && rnd(seed, T.PHONE, e.ref, 0, 0) < DOUBLE_SHARE) {
        events.push(copyEvent(e, e.eid + 2, e.recv + 1 + Math.floor(rnd(seed, T.PHONE, e.ref, code, 1) * 3), 'double'));
      }
    }
    function dockReturn(r, kind) {
      var re = { eid: eventId(r.id, 'return', 0), type: 'return', kind: kind, src: 'dock', ref: r.id, bike: r.bike, st: r.st1,
                 ts: r.t1 + UTC_OFFSET, recv: r.t1 + UTC_OFFSET + 2 + Math.floor(rnd(seed, T.RECV, r.id, 2, 0) * 10), note: '', part: 0 };
      if (f === 'clockskew' && r.st1 === RAIL && r.t1 >= F) { re.ts += SKEW; re.note = 'skew'; }
      if (f === 'firmware' && r.st1 === HARBOUR && r.t1 >= F && rnd(seed, T.DROP, r.id, 0, 0) < DROP_RATE) {
        re.note = 'dropped'; ghosts.push(re); return null;
      }
      events.push(re);
      return re;
    }
    var i, r;
    for (i = 0; i < world.rides.length; i++) {
      r = world.rides[i];
      var co = { eid: eventId(r.id, 'checkout', 0), type: 'checkout', kind: 'ride', src: 'app', ref: r.id, bike: r.bike, st: r.st0,
                 ts: r.t0 + UTC_OFFSET, recv: r.t0 + UTC_OFFSET + 1 + Math.floor(rnd(seed, T.RECV, r.id, 1, 0) * 3), note: '', part: 0 };
      events.push(co); retry(co, 1); doubled(co, 1, r.t0);
      var re = dockReturn(r, 'ride');
      if (re) retry(re, 2);
    }
    for (i = 0; i < world.unmet.length; i++) {
      var u = world.unmet[i];
      var nb = { eid: eventId(u.id, 'nobike', 0), type: 'nobike', kind: 'request', src: 'app', ref: u.id, bike: -1, st: u.st,
                 ts: u.t + UTC_OFFSET, recv: u.t + UTC_OFFSET + 1 + Math.floor(rnd(seed, T.RECV, u.id, 3, 0) * 3), note: '', part: 0 };
      events.push(nb); retry(nb, 3); doubled(nb, 3, u.t);
    }
    for (i = 0; i < world.maint.length; i++) {
      r = world.maint[i];
      events.push({ eid: eventId(r.id, 'checkout', 0), type: 'checkout', kind: 'maintenance', src: 'mechanic', ref: r.id, bike: r.bike, st: r.st0,
                    ts: r.t0 + UTC_OFFSET, recv: r.t0 + UTC_OFFSET + 2, note: '', part: 0 });
      dockReturn(r, 'maintenance');
    }
    // The log is stored in nightly partitions by arrival time (the server's clock, converted correctly).
    var perPart = { events: new Int32Array(NP), checkout: new Int32Array(NP), 'return': new Int32Array(NP),
                    nobike: new Int32Array(NP), maintenance: new Int32Array(NP) };
    for (i = 0; i < events.length; i++) {
      var e = events[i];
      e.part = clampPart(Math.floor((e.recv - UTC_OFFSET) / DAY));
      perPart.events[e.part]++;
      if (e.kind === 'maintenance') perPart.maintenance[e.part]++;
      else perPart[e.type][e.part]++;
    }
    for (i = 0; i < ghosts.length; i++) ghosts[i].part = clampPart(Math.floor((ghosts[i].recv - UTC_OFFSET) / DAY));
    events.sort(function (a, b) { return (a.recv - b.recv) || (a.eid - b.eid); });
    return { events: events, ghosts: ghosts, perPart: perPart };
  }

  // =====================================================================================
  // LAYER 3. THE PIPELINE: what the nightly job did
  // =====================================================================================
  var NODES = ['extract', 'filter', 'dedupe', 'localtime', 'pair', 'join', 'group', 'joinNb', 'groupNb'];
  var NODE_INFO = {
    extract:   { name: 'Read log',            what: 'all events that arrived that night' },
    filter:    { name: 'Filter',              what: 'drops the mechanic’s maintenance moves' },
    dedupe:    { name: 'Dedupe',              what: 'keeps the first copy of each event' },
    localtime: { name: 'UTC → local time',    what: 'converts timestamps, adds date and hour' },
    pair:      { name: 'Pair into trips',     what: 'joins each checkout to its return on ride id' },
    join:      { name: 'Join stations table', what: 'inner join on start station' },
    group:     { name: 'Group by day',        what: 'counts trips, sums durations' },
    joinNb:    { name: 'Join stations table', what: '‘no bike’ events, inner join on station' },
    groupNb:   { name: 'Group by day',        what: 'counts riders turned away' }
  };

  function stationsTable(world, sc) {
    var rows = [];
    for (var s = 0; s < STATIONS.length; s++) {
      if (STATIONS[s].opens && !world.newStation) continue;
      if (s === RIVERSIDE && sc.fault === 'staletable') continue;   // nobody added it
      rows.push({ id: s, name: STATIONS[s].name, zone: STATIONS[s].zone });
    }
    return rows;
  }

  function runPipeline(log, world, sc) {
    var F = sc.faultDay;
    var tzBug = sc.fault === 'timezone', keyBug = sc.fault === 'dedupekey';
    var stats = {}, i, e, p;
    NODES.forEach(function (n) { stats[n] = { inp: new Int32Array(NP), out: new Int32Array(NP) }; });

    // 1. Read the log.
    var rows = log.events.slice();
    for (i = 0; i < rows.length; i++) { p = rows[i].part; stats.extract.inp[p]++; stats.extract.out[p]++; }

    // 2. Filter out maintenance moves.
    var kept = [];
    for (i = 0; i < rows.length; i++) {
      e = rows[i]; stats.filter.inp[e.part]++;
      if (e.kind !== 'maintenance') { kept.push(e); stats.filter.out[e.part]++; }
    }

    // 3. Dedupe: keep the first event with each key. The right key is (type, ride or request id).
    var seen = new Set(), deduped = [];
    for (i = 0; i < kept.length; i++) {
      e = kept[i]; stats.dedupe.inp[e.part]++;
      var key = (keyBug && e.part >= F) ? -1 - e.eid : eventKey(e);
      if (seen.has(key)) continue;
      seen.add(key); deduped.push(e); stats.dedupe.out[e.part]++;
    }

    // 4. Convert UTC to local time and derive the date and hour.
    var local = new Array(deduped.length);
    for (i = 0; i < deduped.length; i++) {
      e = deduped[i]; stats.localtime.inp[e.part]++; stats.localtime.out[e.part]++;
      var lt = (tzBug && e.part >= F) ? e.ts : e.ts - UTC_OFFSET;
      var date = Math.floor(lt / DAY);
      local[i] = { type: e.type, ref: e.ref, st: e.st, ts: e.ts, part: e.part, date: date,
                   hour: Math.floor((lt - date * DAY) / HOUR) };
    }

    // 5. Pair each checkout with its return(s) on ride id. No return: the checkout is dropped.
    var returns = new Map(), checkouts = [], nobike = [];
    for (i = 0; i < local.length; i++) {
      e = local[i];
      if (e.type === 'return') {
        stats.pair.inp[e.part]++;
        var list = returns.get(e.ref);
        if (list) list.push(e); else returns.set(e.ref, [e]);
      } else if (e.type === 'checkout') { stats.pair.inp[e.part]++; checkouts.push(e); }
      else nobike.push(e);
    }
    var trips = [], unmatched = new Int32Array(NP);
    for (i = 0; i < checkouts.length; i++) {
      var c = checkouts[i], rs = returns.get(c.ref);
      if (!rs) { unmatched[c.part]++; continue; }
      for (var j = 0; j < rs.length; j++) {
        trips.push({ ref: c.ref, st0: c.st, st1: rs[j].st, date: c.date, hour: c.hour, dur: rs[j].ts - c.ts, part: c.part });
        stats.pair.out[c.part]++;
      }
    }

    // 6. Inner join to the stations table on the start station (and on the station for 'no bike').
    var table = stationsTable(world, sc), byId = new Map();
    table.forEach(function (row) { byId.set(row.id, row); });
    var joined = [], joinedNb = [], droppedBy = {};
    for (i = 0; i < trips.length; i++) {
      var t = trips[i]; stats.join.inp[t.part]++;
      var row = byId.get(t.st0);
      if (!row) { droppedBy[t.st0] = (droppedBy[t.st0] || 0) + 1; continue; }
      t.zone = row.zone; joined.push(t); stats.join.out[t.part]++;
    }
    for (i = 0; i < nobike.length; i++) {
      var nbr = nobike[i]; stats.joinNb.inp[nbr.part]++;
      if (!byId.has(nbr.st)) { droppedBy[nbr.st] = (droppedBy[nbr.st] || 0) + 1; continue; }
      joinedNb.push(nbr); stats.joinNb.out[nbr.part]++;
    }

    // 7. Group by local date.
    var daily = { rides: new Int32Array(N_DAYS), sumDur: new Float64Array(N_DAYS), unmet: new Int32Array(N_DAYS) };
    var durs = [], hours = [], outside = 0;
    for (var d = 0; d < N_DAYS; d++) { durs.push([]); hours.push(new Int32Array(24)); }
    var touched = new Set(), touchedNb = new Set();
    for (i = 0; i < joined.length; i++) {
      t = joined[i]; stats.group.inp[t.part]++;
      var gk = t.part * 1000 + t.date + 10;
      if (!touched.has(gk)) { touched.add(gk); stats.group.out[t.part]++; }
      if (t.date < 0 || t.date >= N_DAYS) { outside++; continue; }
      daily.rides[t.date]++; daily.sumDur[t.date] += t.dur; durs[t.date].push(t.dur); hours[t.date][t.hour]++;
    }
    for (i = 0; i < joinedNb.length; i++) {
      nbr = joinedNb[i]; stats.groupNb.inp[nbr.part]++;
      var nk = nbr.part * 1000 + nbr.date + 10;
      if (!touchedNb.has(nk)) { touchedNb.add(nk); stats.groupNb.out[nbr.part]++; }
      if (nbr.date >= 0 && nbr.date < N_DAYS) daily.unmet[nbr.date]++;
    }

    var removed = new Int32Array(NP);
    for (p = 0; p < NP; p++) {
      removed[p] = (stats.filter.inp[p] - stats.filter.out[p]) + (stats.dedupe.inp[p] - stats.dedupe.out[p]) +
        unmatched[p] + (stats.join.inp[p] - stats.join.out[p]) + (stats.joinNb.inp[p] - stats.joinNb.out[p]);
    }
    return { trips: joined, nobike: joinedNb, daily: daily, durs: durs, hours: hours, outside: outside,
             stats: stats, unmatched: unmatched, removed: removed, tripsOut: stats.join.out, table: table, droppedBy: droppedBy };
  }

  // =====================================================================================
  // LAYER 4. THE DASHBOARD: what people see
  // =====================================================================================
  function median(arr) {
    if (!arr.length) return 0;
    var a = arr.slice().sort(function (x, y) { return x - y; }), m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function makeDashboard(pipe, sc) {
    var from = sc.fault === 'definition' ? sc.faultDay : Infinity;
    var rides = new Int32Array(N_DAYS), unmet = new Int32Array(N_DAYS), tripLen = new Float64Array(N_DAYS);
    for (var d = 0; d < N_DAYS; d++) {
      rides[d] = pipe.daily.rides[d];
      unmet[d] = pipe.daily.unmet[d];
      tripLen[d] = d >= from ? median(pipe.durs[d]) / 60 : meanMinutes(pipe.daily.sumDur[d], pipe.daily.rides[d]);
    }
    var defs = from < N_DAYS ? [{ metric: 'tripLen', day: from, from: 'mean', to: 'median' }] : [];
    return { rides: rides, unmet: unmet, tripLen: tripLen, defs: defs,
             definitionOn: function (day) { return day >= from ? 'median' : 'mean'; } };
  }

  // =====================================================================================
  // LAYER 5. THE MODEL: Poisson regression of rides on weather and weekday, refitted nightly
  // =====================================================================================
  function features(temp, rain, weekend) { return [1, (temp - 20) / 5, rain ? 1 : 0, weekend ? 1 : 0]; }
  function dot(a, b) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
  function solve(A, b) {
    var n = b.length, M = A.map(function (row, i) { return row.slice().concat([b[i]]); }), i, j, k;
    for (i = 0; i < n; i++) {
      var piv = i;
      for (j = i + 1; j < n; j++) if (Math.abs(M[j][i]) > Math.abs(M[piv][i])) piv = j;
      var tmp = M[i]; M[i] = M[piv]; M[piv] = tmp;
      for (j = i + 1; j < n; j++) {
        var fct = M[j][i] / M[i][i];
        for (k = i; k <= n; k++) M[j][k] -= fct * M[i][k];
      }
    }
    var x = new Array(n);
    for (i = n - 1; i >= 0; i--) {
      var s = M[i][n];
      for (j = i + 1; j < n; j++) s -= M[i][j] * x[j];
      x[i] = s / M[i][i];
    }
    return x;
  }
  // Maximises the Poisson log-likelihood (minus a tiny ridge on the slopes) by Newton's method.
  function poissonGradient(X, y, b, ridge) {
    var p = b.length, grad = new Array(p).fill(0);
    for (var i = 0; i < X.length; i++) {
      var mu = Math.exp(dot(X[i], b)), r = y[i] - mu;
      for (var j = 0; j < p; j++) grad[j] += X[i][j] * r;
    }
    for (var k = 1; k < p; k++) grad[k] -= ridge * b[k];
    return grad;
  }
  function fitPoisson(X, y, ridge) {
    var p = X[0].length, n = X.length, i, j, k, my = 0;
    for (i = 0; i < n; i++) my += y[i];
    my = Math.max(1, my / n);
    var b = [Math.log(my)];
    for (j = 1; j < p; j++) b.push(0);
    for (var it = 0; it < 100; it++) {
      var H = [], grad = new Array(p).fill(0);
      for (j = 0; j < p; j++) H.push(new Array(p).fill(0));
      for (i = 0; i < n; i++) {
        var mu = Math.exp(dot(X[i], b)), r = y[i] - mu;
        for (j = 0; j < p; j++) {
          grad[j] += X[i][j] * r;
          for (k = 0; k < p; k++) H[j][k] += X[i][j] * X[i][k] * mu;
        }
      }
      for (j = 1; j < p; j++) { grad[j] -= ridge * b[j]; H[j][j] += ridge; }
      var step = solve(H, grad), big = 0;
      for (j = 0; j < p; j++) { b[j] += step[j]; big = Math.max(big, Math.abs(step[j])); }
      if (big < 1e-12) break;
    }
    return b;
  }

  function makeModel(pipe, world, sc) {
    var badFrom = sc.fault === 'weatherjoin' ? sc.faultDay : Infinity;
    var y = pipe.daily.rides, W = world.weather;
    var forecast = new Float64Array(N_DAYS).fill(NaN), nights = [];
    for (var n = FIRST_FORECAST - 1; n < N_DAYS - 1; n++) {
      var X = [], Y = [], rows = [];
      for (var d = Math.max(0, n - TRAIN_WINDOW + 1); d <= n; d++) {
        var wd = n >= badFrom ? d - 1 : d;          // the training query's weather join
        if (wd < 0) continue;
        var x = features(W[wd].temp, W[wd].rain, isWeekend(d));
        X.push(x); Y.push(y[d]);
        rows.push({ date: d, rides: y[d], temp: W[wd].temp, rain: W[wd].rain, weekend: isWeekend(d) });
      }
      var beta = fitPoisson(X, Y, RIDGE);
      var w1 = W[n + 1];
      var xs = features(w1.temp, w1.rain, w1.weekend);  // serving: tomorrow's weather, joined correctly
      forecast[n + 1] = Math.exp(dot(xs, beta));
      nights.push({ night: n, day: n + 1, beta: beta, X: X, Y: Y, rows: rows, x: xs, forecast: forecast[n + 1] });
    }
    return { forecast: forecast, nights: nights, nightFor: function (day) { return nights[day - FIRST_FORECAST] || null; } };
  }

  // Mean absolute percentage error of a forecast against some actuals, over days [a, b].
  function mape(forecast, actual, a, b) {
    var s = 0, n = 0;
    for (var d = Math.max(a, FIRST_FORECAST); d <= Math.min(b, N_DAYS - 1); d++) {
      if (isNaN(forecast[d]) || !actual[d]) continue;
      s += Math.abs(forecast[d] - actual[d]) / actual[d]; n++;
    }
    return n ? s / n : NaN;
  }
  function effects(beta) {
    return {
      base: Math.exp(beta[0]),                // rides on a dry 20°C weekday
      temp5: Math.exp(beta[1]) - 1,           // change for +5°C
      rain: Math.exp(beta[2]) - 1,
      weekend: Math.exp(beta[3]) - 1
    };
  }

  // =====================================================================================
  // Scenarios, runs and a cache that shares unchanged lower layers between runs
  // =====================================================================================
  function normalise(sc) {
    sc = sc || {};
    var s = {
      seed: sc.seed == null ? DEFAULT_SEED : sc.seed,
      heatwave: !!sc.heatwave, newStation: !!sc.newStation,
      fault: sc.fault || null, faultDay: sc.faultDay == null ? FAULT_DAY : sc.faultDay
    };
    if (s.fault === 'heatwave') { s.heatwave = true; s.fault = null; }
    if (s.fault === 'newstation') { s.newStation = true; s.fault = null; }
    if (s.fault === 'staletable') { s.newStation = true; s.faultDay = OPEN_DAY; }
    if (s.fault && !isFault(s.fault)) throw new Error('Unknown fault: ' + s.fault);
    return s;
  }
  function truthOf(sc) {
    var s = normalise(sc);
    return { seed: s.seed, heatwave: s.heatwave, newStation: s.newStation, fault: null, faultDay: s.faultDay };
  }
  function faultLayer(sc) { var s = normalise(sc); return s.fault ? FAULTS[s.fault].layer : null; }

  function Runner(useCache) { this.useCache = useCache !== false; this.cache = new Map(); }
  Runner.prototype.get = function (key, make) {
    if (!this.useCache) return make();
    if (this.cache.has(key)) return this.cache.get(key);
    var v = make();
    if (this.cache.size > 40) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, v);
    return v;
  };
  Runner.prototype.run = function (input) {
    var sc = normalise(input), self = this;
    var lay = sc.fault ? LAYER_INDEX[FAULTS[sc.fault].layer] : 99;
    var at = function (L) { return lay === L ? sc.fault + '@' + sc.faultDay : '-'; };
    var kW = sc.seed + '|' + (sc.heatwave ? 'H' : '') + (sc.newStation ? 'N' : '');
    var kL = kW + '|' + at(1), kP = kL + '|' + at(2), kD = kP + '|' + at(3), kM = kP + '|' + at(4);
    var world = this.get('W' + kW, function () { return simulateWorld(sc.seed, sc.heatwave, sc.newStation); });
    var log = this.get('L' + kL, function () { return makeLog(world, sc); });
    var pipe = this.get('P' + kP, function () { return runPipeline(log, world, sc); });
    var dash = this.get('D' + kD, function () { return makeDashboard(pipe, sc); });
    var model = this.get('M' + kM, function () { return makeModel(pipe, world, sc); });
    return { scenario: sc, world: world, log: log, pipe: pipe, dash: dash, model: model };
  };
  function run(sc, opts) { return new Runner(!(opts && opts.cache === false)).run(sc); }

  // =====================================================================================
  // Comparing a run with its truth (the same world, no fault): the stereoscopic view
  // =====================================================================================
  function sameArray(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i] && !(a[i] !== a[i] && b[i] !== b[i])) return false;
    return true;
  }
  function avg(arr, a, b) {
    var s = 0, n = 0;
    for (var d = Math.max(0, a); d <= Math.min(b, arr.length - 1); d++) { if (arr[d] !== arr[d]) continue; s += arr[d]; n++; }
    return n ? s / n : NaN;
  }

  function compare(obs, tru) {
    var F = obs.scenario.faultDay, out = {}, i, e;
    // World: faults never touch it.
    out.world = { same: obs.world === tru.world || (sameArray(obs.world.truth.rides, tru.world.truth.rides) &&
      obs.world.rides.length === tru.world.rides.length) };
    // Log: match events by id.
    var tl = new Map(), ol = new Map();
    for (i = 0; i < tru.log.events.length; i++) tl.set(tru.log.events[i].eid, tru.log.events[i]);
    for (i = 0; i < obs.log.events.length; i++) ol.set(obs.log.events[i].eid, obs.log.events[i]);
    var missing = 0, extra = 0, restamped = 0, perPart = new Int32Array(NP);
    tl.forEach(function (ev, id) { if (!ol.has(id)) { missing++; perPart[ev.part]++; } });
    ol.forEach(function (ev, id) {
      var t = tl.get(id);
      if (!t) { extra++; perPart[ev.part]++; }
      else if (t.ts !== ev.ts) { restamped++; perPart[ev.part]++; }
    });
    out.log = { same: missing + extra + restamped === 0, missing: missing, extra: extra, restamped: restamped, perPart: perPart };
    // Pipeline: compare the trip table (by ride id) and the 'no bike' table. Every output row
    // that is missing, extra, on another date or of another length is also counted against the
    // nightly run (log partition) it came from, so the pipeline's strip can show where it differs.
    var tt = new Map(), pipePart = new Int32Array(NP);
    for (i = 0; i < tru.pipe.trips.length; i++) tt.set(tru.pipe.trips[i].ref, tru.pipe.trips[i]);
    var seenRef = new Map(), pm = 0, px = 0, misdated = 0, retimed = 0;
    for (i = 0; i < obs.pipe.trips.length; i++) {
      e = obs.pipe.trips[i];
      var c = (seenRef.get(e.ref) || 0) + 1; seenRef.set(e.ref, c);
      var t = tt.get(e.ref);
      if (!t || c > 1) { px++; pipePart[e.part]++; continue; }
      if (t.date !== e.date) misdated++;
      if (t.dur !== e.dur) retimed++;
      if (t.date !== e.date || t.dur !== e.dur) pipePart[e.part]++;
    }
    tt.forEach(function (t, ref) { if (!seenRef.has(ref)) { pm++; pipePart[t.part]++; } });
    var tn = new Map(), seenNb = new Map(), nbDiff = 0;
    for (i = 0; i < tru.pipe.nobike.length; i++) tn.set(tru.pipe.nobike[i].ref, tru.pipe.nobike[i]);
    for (i = 0; i < obs.pipe.nobike.length; i++) {
      e = obs.pipe.nobike[i];
      var cn = (seenNb.get(e.ref) || 0) + 1; seenNb.set(e.ref, cn);
      var u = tn.get(e.ref);
      if (!u || cn > 1 || u.date !== e.date) { nbDiff++; pipePart[e.part]++; }
    }
    tn.forEach(function (u, ref) { if (!seenNb.has(ref)) { nbDiff++; pipePart[u.part]++; } });
    var nbSame = obs.pipe.nobike.length === tru.pipe.nobike.length && sameArray(obs.pipe.daily.unmet, tru.pipe.daily.unmet);
    var internal = false;
    for (i = 0; i < NODES.length && !internal; i++) {
      var n = NODES[i];
      if (!sameArray(obs.pipe.stats[n].inp, tru.pipe.stats[n].inp) || !sameArray(obs.pipe.stats[n].out, tru.pipe.stats[n].out)) internal = true;
    }
    var outSame = pm + px + misdated + retimed + nbDiff === 0 && nbSame;
    out.pipeline = { same: outSame && !internal, outputSame: outSame, internal: internal, missing: pm, extra: px,
                     misdated: misdated, retimed: retimed, nobikeDiff: nbDiff, perPart: pipePart,
                     trips: obs.pipe.trips.length, truthTrips: tru.pipe.trips.length,
                     removed: sumArr(obs.pipe.removed), truthRemoved: sumArr(tru.pipe.removed) };
    // Dashboard: relative gaps from the fault day on.
    var from = obs.scenario.fault === 'staletable' ? OPEN_DAY : F;
    function gap(a, b) { var x = avg(a, from, N_DAYS - 1), y = avg(b, from, N_DAYS - 1); return y ? x / y - 1 : 0; }
    out.dashboard = {
      same: sameArray(obs.dash.rides, tru.dash.rides) && sameArray(obs.dash.unmet, tru.dash.unmet) && sameArray(obs.dash.tripLen, tru.dash.tripLen),
      rides: gap(obs.dash.rides, tru.dash.rides), unmet: gap(obs.dash.unmet, tru.dash.unmet), tripLen: gap(obs.dash.tripLen, tru.dash.tripLen),
      misdatedDays: countDiff(obs.dash.rides, tru.dash.rides)
    };
    out.model = {
      same: sameArray(obs.model.forecast, tru.model.forecast),
      gap: gap(obs.model.forecast, tru.model.forecast),
      mapeObs: mape(obs.model.forecast, obs.dash.rides, from, N_DAYS - 1),
      mapeTrue: mape(obs.model.forecast, tru.world.truth.rides, from, N_DAYS - 1),
      mapeTruthModel: mape(tru.model.forecast, tru.world.truth.rides, from, N_DAYS - 1)
    };
    var affected = [];
    if (!out.log.same) affected.push('log');
    if (!out.pipeline.same) affected.push('pipeline');
    if (!out.dashboard.same) affected.push('dashboard');
    if (!out.model.same) affected.push('model');
    out.affected = affected;
    return out;
  }
  function sumArr(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s; }
  function countDiff(a, b) { var n = 0; for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; }

  // =====================================================================================
  // Evidence: the checks a data engineer can run at each layer without knowing the truth
  // =====================================================================================
  function logChecks(log) {
    var ev = log.events, i, e;
    var hasReturn = new Set(), firstCheckout = new Map();
    for (i = 0; i < ev.length; i++) {
      e = ev[i];
      if (e.type === 'return') hasReturn.add(e.ref);
      else if (e.type === 'checkout' && !firstCheckout.has(e.ref)) firstCheckout.set(e.ref, e);
    }
    // Follow each bike: where was it next checked out after a checkout that never got a return?
    var byBike = new Map();
    firstCheckout.forEach(function (c) { var l = byBike.get(c.bike); if (l) l.push(c); else byBike.set(c.bike, [c]); });
    var unmatched = 0, unmatchedPart = new Int32Array(NP), nextAt = {};
    byBike.forEach(function (list) {
      list.sort(function (a, b) { return a.ts - b.ts; });
      for (var k = 0; k < list.length; k++) {
        var c = list[k];
        if (c.kind !== 'ride' || hasReturn.has(c.ref)) continue;
        unmatched++; unmatchedPart[c.part]++;
        var nx = list[k + 1];
        var where = nx ? nx.st : -1;
        nextAt[where] = (nextAt[where] || 0) + 1;
      }
    });
    // Events stamped later than the server received them: the sender's clock is ahead.
    var future = 0, futureBy = {}, futurePart = new Int32Array(NP);
    for (i = 0; i < ev.length; i++) {
      e = ev[i];
      if (e.ts > e.recv + 60) { future++; futurePart[e.part]++; futureBy[e.st] = (futureBy[e.st] || 0) + 1; }
    }
    // Share of events that repeat an earlier event (same type and id), night by night.
    var keys = new Set(), dupPart = new Int32Array(NP), firstSeen = {};
    for (i = 0; i < ev.length; i++) {
      e = ev[i];
      var k = eventKey(e);
      if (keys.has(k)) dupPart[e.part]++; else keys.add(k);
      if (firstSeen[e.st] == null) firstSeen[e.st] = e.part;
    }
    var shares = [];
    for (var p = 0; p < N_DAYS; p++) shares.push(log.perPart.events[p] ? dupPart[p] / log.perPart.events[p] : 0);
    var sorted = shares.slice().sort(function (a, b) { return a - b; });
    var maxShare = sorted[sorted.length - 1], maxAt = shares.indexOf(maxShare);
    return { unmatched: unmatched, unmatchedPart: unmatchedPart, nextAt: nextAt, future: future, futureBy: futureBy,
             futurePart: futurePart, dupShares: shares, dupMedian: sorted[sorted.length >> 1], dupMax: maxShare,
             dupMaxAt: maxAt, firstSeen: firstSeen };
  }

  function topEntry(obj) {
    var best = null, total = 0;
    Object.keys(obj).forEach(function (k) { total += obj[k]; if (!best || obj[k] > obj[best]) best = k; });
    return best == null ? null : { key: +best, n: obj[best], share: obj[best] / total };
  }
  function stationName(id) { return id >= 0 && STATIONS[id] ? STATIONS[id].name : 'not used again'; }
  function pct(x, digits) { return (x * 100).toFixed(digits == null ? 0 : digits) + '%'; }
  function num(n) { return Math.round(n).toLocaleString('en-GB'); }

  function evidence(r) {
    var items = [], W = r.world.weather, d;
    // World: what can be known without the data system.
    var maxT = -99, maxD = 0, wet = 0, hot = [];
    for (d = 0; d < N_DAYS; d++) {
      if (W[d].temp > maxT) { maxT = W[d].temp; maxD = d; }
      if (W[d].rain) wet++;
      if (W[d].temp >= HEAT_FLAG) hot.push(d);
    }
    items.push({ layer: 'world', id: 'w.heat', title: 'Weather record',
      value: 'Hottest day ' + maxT.toFixed(1) + '°C (' + dateLabel(maxD) + '). ' + wet + ' wet days.',
      detail: hot.length ? hot.length + ' days at ' + HEAT_FLAG + '°C or more, ' + dateLabel(hot[0]) + ' to ' + dateLabel(hot[hot.length - 1]) + '.' : '',
      normal: 'Summer days here usually run 14–27°C.', flagged: maxT >= HEAT_FLAG });
    items.push({ layer: 'world', id: 'w.ops', title: 'Operations calendar',
      value: r.world.ops.length ? r.world.ops.map(function (o) { return o.text + ' on ' + dateLabel(o.day) + '.'; }).join(' ') : 'No stations opened or closed.',
      detail: '', normal: '', flagged: r.world.ops.length > 0 });

    // Log.
    var lc = logChecks(r.log);
    var top = topEntry(lc.nextAt);
    items.push({ layer: 'log', id: 'l.unmatched', title: 'Checkouts with no return',
      value: num(lc.unmatched),
      detail: lc.unmatched && top ? 'Where those bikes were next checked out: ' + stationName(top.key) + ' ' + pct(top.share) + ' of the time.' : '',
      normal: 'Should be 0: every bike that leaves a dock comes back to one.', flagged: lc.unmatched > 0 });
    var ft = topEntry(lc.futureBy);
    items.push({ layer: 'log', id: 'l.future', title: 'Events stamped later than they arrived',
      value: num(lc.future),
      detail: lc.future && ft ? pct(ft.share) + ' from ' + stationName(ft.key) + ', starting ' + dateLabel(lc.futurePart.findIndex(function (x) { return x > 0; })) + '.' : '',
      normal: 'Should be 0: nothing arrives before it happens.', flagged: lc.future > 0 });
    items.push({ layer: 'log', id: 'l.dupes', title: 'Events that repeat an earlier one',
      value: 'Typically ' + pct(lc.dupMedian, 1) + ' a night; at most ' + pct(lc.dupMax, 1) + ' (' + dateLabel(lc.dupMaxAt) + ').',
      detail: '', normal: 'About 4%: phones and docks resend when the signal is poor.', flagged: lc.dupMax > 0.1 });
    var seenIds = Object.keys(lc.firstSeen).map(Number).sort(function (a, b) { return a - b; });
    var late = seenIds.filter(function (s) { return lc.firstSeen[s] > 0; });
    items.push({ layer: 'log', id: 'l.stations', title: 'Stations sending events',
      value: seenIds.length + (late.length ? ' (' + late.map(function (s) { return stationName(s) + ' from ' + dateLabel(lc.firstSeen[s]); }).join(', ') + ')' : ''),
      detail: '', normal: '', flagged: false });

    // Pipeline.
    var P = r.pipe;
    var unm = sumArr(P.unmatched);
    items.push({ layer: 'pipeline', id: 'p.pair', title: 'Checkouts dropped at pairing (no return)',
      value: num(unm), detail: unm ? 'From ' + dateLabel(P.unmatched.findIndex(function (x) { return x > 0; })) + ' on.' : '',
      normal: 'Should be 0.', flagged: unm > 0 });
    var dropIds = Object.keys(P.droppedBy), dropN = 0;
    dropIds.forEach(function (k) { dropN += P.droppedBy[k]; });
    items.push({ layer: 'pipeline', id: 'p.join', title: 'Rows dropped by the stations join',
      value: num(dropN), detail: dropN ? 'All with station id ' + dropIds.join(', ') + ', which is not in the table.' : '',
      normal: 'Should be 0: an inner join silently drops rows with no match.', flagged: dropN > 0 });
    var refs = new Set();
    for (d = 0; d < P.trips.length; d++) refs.add(P.trips[d].ref);
    var rep = P.trips.length - refs.size;
    items.push({ layer: 'pipeline', id: 'p.dedupe', title: 'Ride ids still repeated after dedupe',
      value: num(rep), detail: '', normal: 'Should be 0.', flagged: rep > 0 });
    var night = 0;
    for (d = 0; d < P.trips.length; d++) if (P.trips[d].hour < 5) night++;
    var nightShare = P.trips.length ? night / P.trips.length : 0;
    items.push({ layer: 'pipeline', id: 'p.hours', title: 'Rides dated between midnight and 5 am',
      value: pct(nightShare, 1), detail: '', normal: 'About 1%: few people ride at night.', flagged: nightShare > 0.08 });
    items.push({ layer: 'pipeline', id: 'p.table', title: 'Stations table',
      value: P.table.length + ' rows: ids ' + P.table.map(function (t) { return t.id; }).join(', ') + '.',
      detail: '', normal: '', flagged: false });

    // Dashboard.
    items.push({ layer: 'dashboard', id: 'd.defs', title: 'Metric definition changes',
      value: r.dash.defs.length ? r.dash.defs.map(function (x) { return '‘Average trip length’ changed from the ' + x.from + ' to the ' + x.to + ' on ' + dateLabel(x.day) + '.'; }).join(' ') : 'None this season.',
      detail: '', normal: '', flagged: r.dash.defs.length > 0 });

    // Model.
    var rowsAll = 0, mismatch = 0;
    r.model.nights.forEach(function (nt) {
      nt.rows.forEach(function (row) {
        rowsAll++;
        var w = W[row.date];
        if (w.temp !== row.temp || w.rain !== row.rain) mismatch++;
      });
    });
    var match = rowsAll ? 1 - mismatch / rowsAll : 1;
    items.push({ layer: 'model', id: 'm.join', title: 'Training rows whose weather matches the weather record',
      value: pct(match, 1), detail: '', normal: 'Should be 100%.', flagged: mismatch > 0 });
    var F = r.scenario.faultDay;
    var e1 = mape(r.model.forecast, r.dash.rides, FIRST_FORECAST, F - 1), e2 = mape(r.model.forecast, r.dash.rides, F, N_DAYS - 1);
    items.push({ layer: 'model', id: 'm.error', title: 'Forecast error against the dashboard’s rides',
      value: pct(e1, 1) + ' before ' + dateLabel(F) + ', ' + pct(e2, 1) + ' from then on.', detail: '', normal: '', flagged: false });
    return items;
  }
  function flags(r) {
    return evidence(r).filter(function (i) { return i.flagged; }).map(function (i) { return i.id; }).sort().join(',');
  }

  // =====================================================================================
  // Detective cases. Each ticket's numbers are computed from the run it describes.
  // =====================================================================================
  function r0(x) { return Math.round(x); }
  function r1(x) { return (Math.round(x * 10) / 10).toFixed(1); }
  var CASES = [
    { id: 'shorter', title: 'Shorter trips', level: 1, seed: 101, fault: 'definition', faultDay: 30,
      ticket: function (r) {
        var F = r.scenario.faultDay, a = avg(r.dash.tripLen, F - 7, F - 1), b = avg(r.dash.tripLen, F, F + 6);
        return { ok: b < a * 0.92, text: 'Average trip length dropped on ' + dateLabel(F) + ': it averaged ' + r1(a) + ' minutes a day in the week before and ' +
          r1(b) + ' in the week after, and it has stayed down. Marketing asks: did people start taking shorter rides?' };
      } },
    { id: 'riverside', title: 'The busy new station', level: 2, seed: 105, fault: 'staletable', newStation: true,
      ticket: function (r, tru) {
        var F = OPEN_DAY, a = avg(r.dash.rides, F - 14, F - 1), b = avg(r.dash.rides, F, F + 13);
        var ta = avg(tru.world.truth.rides, F - 14, F - 1), tb = avg(tru.world.truth.rides, F, F + 13);
        return { ok: tb / ta - b / a > 0.06 && Math.abs(b / a - 1) < 0.05,
          text: 'Riverside opened on ' + dateLabel(F) + '. The street team says its racks are empty by 9 am, yet rides per day barely moved: ' +
          num(a) + ' in the fortnight before, ' + num(b) + ' in the fortnight after. Did the new station just take riders from the others?' };
      } },
    { id: 'further', title: 'Riding further?', level: 3, seed: 103, fault: 'clockskew', faultDay: 24,
      ticket: function (r) {
        var F = r.scenario.faultDay, a = avg(r.dash.tripLen, F - 7, F - 1), b = avg(r.dash.tripLen, F, F + 6);
        var ra = avg(r.dash.rides, F - 7, F - 1), rb = avg(r.dash.rides, F, F + 6);
        return { ok: b > a * 1.2 && Math.abs(rb / ra - 1) < 0.08,
          text: 'Average trip length jumped from ' + r1(a) + ' to ' + r1(b) + ' minutes from ' + dateLabel(F) +
          ' and has stayed up. Rides per day hardly changed (' + num(ra) + ' a day the week before, ' + num(rb) + ' the week after). Are people suddenly riding further?' };
      } },
    { id: 'slump', title: 'The quiet slump', level: 4, seed: 404, fault: 'firmware', faultDay: 26,
      ticket: function (r) {
        var F = r.scenario.faultDay, f = r.model.forecast, y = r.dash.rides;
        function below(a, b) { var k = 0, n = 0, g = 0; for (var d = a; d <= b; d++) { n++; if (y[d] < f[d]) k++; g += y[d] / f[d] - 1; } return { k: k, n: n, g: g / n }; }
        var x0 = below(F - 12, F - 1), x1 = below(F, F + 13);
        return { ok: x1.k >= 11 && x1.g < -0.04 && x0.k <= 8,
          text: 'Since ' + dateLabel(F) + ', rides have come in below the forecast on ' + x1.k + ' of ' + x1.n + ' days, by ' + pct(-x1.g, 1) +
          ' on average. In the twelve days before, they fell short on ' + x0.k + '. The forecast already allows for the weather. Are we losing riders?' };
      } },
    { id: 'oneday', title: 'One bad day', level: 5, seed: 505, fault: 'timezone', faultDay: 29,
      ticket: function (r) {
        var F = r.scenario.faultDay, f = r.model.forecast, y = r.dash.rides;
        var e1 = mape(f, y, FIRST_FORECAST, F - 1), e2 = mape(f, y, F + 1, N_DAYS - 1);
        return { ok: y[F] < 0.75 * f[F] && Math.abs(y[F + 1] / f[F + 1] - 1) < 0.15 && e2 > 1.5 * e1,
          text: 'On ' + dateLabel(F) + ' rides came in at ' + num(y[F]) + ', ' + pct(1 - y[F] / f[F]) + ' below the forecast of ' + num(f[F]) +
          '. The next day they were back to normal. But since then the forecast has missed by ' + pct(e2, 1) + ' on average, against ' + pct(e1, 1) +
          ' before, and nobody has touched the model.' };
      } },
    { id: 'hotweek', title: 'The hot week', level: 6, seed: 606, real: 'heatwave', heatwave: true,
      ticket: function (r) {
        var a = avg(r.dash.unmet, HEAT_FROM - 7, HEAT_FROM - 1), b = avg(r.dash.unmet, HEAT_FROM, HEAT_TO);
        var c1 = avg(r.dash.rides, HEAT_FROM - 7, HEAT_FROM - 1), c2 = avg(r.dash.rides, HEAT_FROM, HEAT_TO);
        return { ok: b > 1.5 * a && c2 > c1, text: 'Riders turned away jumped from about ' + num(a) + ' to ' + num(b) + ' a day in the week from ' + dateLabel(HEAT_FROM) +
          ', and rides rose from ' + num(c1) + ' to ' + num(c2) + ' a day. Last spring an app bug that sent ‘no bike’ twice looked just like this. Is it back?' };
      } }
  ];
  CASES.forEach(function (c) { c.answer = c.fault || c.real; });
  function caseScenario(c) {
    return normalise({ seed: c.seed, fault: c.fault || null, faultDay: c.faultDay, heatwave: !!c.heatwave, newStation: !!c.newStation });
  }
  // What the visitor may name: per layer, every change on the menu.
  var ANSWERS = { world: ['heatwave', 'newstation'], log: ['firmware', 'doublesend', 'clockskew'],
                  pipeline: ['staletable', 'timezone', 'dedupekey'], dashboard: ['definition'], model: ['weatherjoin'] };
  // The scenario the visitor's answer describes, in the case's world.
  function candidateScenario(c, answer) {
    var base = caseScenario(c);
    var s = { seed: base.seed, heatwave: base.heatwave, newStation: base.newStation, faultDay: base.faultDay, fault: null };
    if (answer === 'heatwave') s.heatwave = true;
    else if (answer === 'newstation') s.newStation = true;
    else s.fault = answer;
    if (c.fault === 'staletable' && answer !== 'staletable') s.faultDay = FAULT_DAY;
    return normalise(s);
  }

  // =====================================================================================
  // The card preview's five series: a week's moving average of each layer under the firmware
  // fault, beside its truth. preview-data.js holds a copy (made by tools/make-preview-data.js),
  // so the card does not simulate the city twice on load; the tests check that copy equals this.
  // =====================================================================================
  function previewSeries(runner) {
    runner = runner || new Runner(false);
    var sc = { fault: 'firmware' }, obs = runner.run(sc), tru = runner.run(truthOf(sc));
    function smooth(a) {
      var out = [];
      for (var d = 0; d < N_DAYS; d++) {
        var s = 0, n = 0;
        for (var k = d - 3; k <= d + 3; k++) if (k >= 0 && k < N_DAYS && isFinite(a[k])) { s += a[k]; n++; }
        out.push(isFinite(a[d]) && n ? Math.round(s / n * 10) / 10 : null);
      }
      return out;
    }
    return {
      fault: sc.fault, faultDay: FAULT_DAY, source: 'log',
      bands: [
        { name: 'Model', obs: smooth(obs.model.forecast), tru: smooth(tru.model.forecast) },
        { name: 'Dashboard', obs: smooth(obs.dash.rides), tru: smooth(tru.dash.rides) },
        { name: 'Pipeline', obs: smooth(obs.pipe.tripsOut), tru: smooth(tru.pipe.tripsOut) },
        { name: 'Log', obs: smooth(obs.log.perPart['return']), tru: smooth(tru.log.perPart['return']) },
        { name: 'World', obs: smooth(tru.world.truth.rides), tru: null }
      ]
    };
  }

  var api = {
    DAY: DAY, HOUR: HOUR, UTC_OFFSET: UTC_OFFSET, N_DAYS: N_DAYS, NP: NP, FAULT_DAY: FAULT_DAY, OPEN_DAY: OPEN_DAY,
    HEAT_FROM: HEAT_FROM, HEAT_TO: HEAT_TO, FIRST_FORECAST: FIRST_FORECAST, TRAIN_WINDOW: TRAIN_WINDOW, RIDGE: RIDGE,
    RETRY_RATE: RETRY_RATE, DROP_RATE: DROP_RATE, DOUBLE_SHARE: DOUBLE_SHARE, SKEW: SKEW, HEAT_FLAG: HEAT_FLAG,
    BASE_DEMAND: BASE_DEMAND, B_TEMP: B_TEMP, B_RAIN: B_RAIN, B_WEEKEND: B_WEEKEND,
    HARBOUR: HARBOUR, RAIL: RAIL, RIVERSIDE: RIVERSIDE, DEFAULT_SEED: DEFAULT_SEED,
    LAYERS: LAYERS, LAYER_INDEX: LAYER_INDEX, STATIONS: STATIONS, FAULTS: FAULTS, FAULT_IDS: FAULT_IDS,
    NODES: NODES, NODE_INFO: NODE_INFO, CASES: CASES, ANSWERS: ANSWERS,
    dateLabel: dateLabel, weekdayOf: weekdayOf, isWeekend: isWeekend, meanMinutes: meanMinutes, median: median,
    rnd: rnd, simulateWorld: simulateWorld, makeLog: makeLog, runPipeline: runPipeline, makeDashboard: makeDashboard,
    makeModel: makeModel, fitPoisson: fitPoisson, poissonGradient: poissonGradient, features: features, dot: dot,
    mape: mape, effects: effects, avg: avg, normalise: normalise, truthOf: truthOf, faultLayer: faultLayer,
    Runner: Runner, run: run, compare: compare, evidence: evidence, flags: flags, logChecks: logChecks,
    caseScenario: caseScenario, candidateScenario: candidateScenario, stationName: stationName,
    isFault: isFault, previewSeries: previewSeries
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Stereo = api;
})(typeof window !== 'undefined' ? window : this);
