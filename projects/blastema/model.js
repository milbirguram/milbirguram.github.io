// Blastema model: a flatworm made of cells on a hexagonal lattice, each following local rules.
// Works in the browser (window.BlastemaModel) and in Node (module.exports).
//
// THE LOCALITY CONTRACT
// Every rule that changes a cell lives in two functions:
//   updateCell(i)  - the next state of tissue cell i, computed from cell i and its six neighbours.
//   updateSite(s)  - whether an empty site s is filled by a neighbour dividing into it, computed
//                    from site s's six neighbours.
// Both read only the current arrays at i (or s) and at NB[i*6 + k], and write only the next arrays
// at i (or s). Random draws are hashed from (seed, step, site), so the result does not depend on
// the order in which cells are visited. tests/model.test.js checks this by scrambling every other
// site on the lattice and confirming the update does not change.
//
// Every cell carries the same small rule book: the width profile (PROFILE_*) and where the head,
// pharynx and tail bands begin (BANDS), all as fractions of the body's length. What no cell holds
// is a picture in place: where the head is, how long the body is, or which cell should be which.
// Those come from what each cell reads:
//   - two "pole signals" relayed cell to cell from organiser cells (each cell keeps the nearest two
//     organisers it hears of, by hop count). Their sum and ratio give the cell its place on the
//     body (u, 0 at a head to 1 at a tail), how far it is from the body axis, and the body length.
//     Because everything is read as a ratio of the current body length, proportions rescale.
//   - a "voltage" memory per cell, coupled to neighbours, which decides what a posterior-facing
//     wound builds: a tail (normal) or a head (rewritten). It is bistable with a low threshold, so
//     it is a two-state switch for the whole body, not a spatial map: a normal worm holds 0
//     everywhere, and a patch of 1 wider than a cell or two spreads until the whole body holds 1.
// Global operations exist only outside the cell rules: the knife (an outside event), moving the
// cut pieces apart (mechanics), the rewrite brush (an outside treatment) and bodies() (UI/tests).
//
// Lattice: rows of sites; odd rows are shifted right by half a hop. Site (x, y) sits at
// X = x + 0.5 * (y & 1), Y = y * sqrt(3)/2. One hop = one cell diameter.
(function (root) {
  'use strict';

  var SQ3_2 = Math.sqrt(3) / 2;

  // Site states
  var EMPTY = 0, LIVE = 1, DYING = 2;
  // Organiser types (also the "type" of a pole signal)
  var NONE = 0, HEAD = 1, TAIL = 2;
  // Identities (what a cell is, for drawing and for the tests)
  var ID = { NONE: 0, HEAD: 1, TRUNK: 2, PHARYNX: 3, TAIL: 4, EYE: 5 };

  // Half-width of the body as a function of u (0 = head pole, 1 = tail pole), as a fraction of
  // the body length. A cell compares its own lateral reading to this. The lateral reading runs
  // (1 - EPS_M) rows per row (see m below), so the shape is the same for any EPS_M.
  var EPS_M = 0.3;
  var PROFILE_U = [0, 0.03, 0.075, 0.12, 0.18, 0.3, 0.62, 0.8, 0.92, 1];
  var PROFILE_K = [0.05, 0.085, 0.1, 0.092, 0.08, 0.098, 0.098, 0.08, 0.045, 0.02].map(function (k) { return 1.25 * k * (1 - EPS_M); });
  function profile(u) {
    if (u <= 0) return PROFILE_K[0];
    if (u >= 1) return PROFILE_K[PROFILE_K.length - 1];
    for (var k = 1; k < PROFILE_U.length; k++) {
      if (u <= PROFILE_U[k]) {
        var a = PROFILE_U[k - 1], b = PROFILE_U[k], t = (u - a) / (b - a);
        return PROFILE_K[k - 1] + t * (PROFILE_K[k] - PROFILE_K[k - 1]);
      }
    }
    return PROFILE_K[PROFILE_K.length - 1];
  }

  // Where identities sit along the body (fractions of the pole-to-pole axis).
  var BANDS = {
    head: 0.17,                 // from a head pole to here: head
    tail: 0.17,                 // from a tail pole to here: tail
    pharynx: [0.46, 0.64],      // u range of the pharynx in a head-tail body
    pharynxTwin: 0.43,          // in a two-headed body: f above this (the middle) is pharynx
    pharynxLat: 0.55,           // pharynx only near the axis (widest at its middle)
    eye: [0.06, 0.115],         // eyespots: an oval spanning this f range from a head pole ...
    eyeLat: [0.26, 0.6]         // ... and this lateral range (fraction of the local half-width)
  };

  // Deterministic hash -> [0, 1). Used for every random draw so updates are order-independent.
  function hash4(a, b, c, d) {
    var h = (a ^ 0x9e3779b9) | 0;
    h = Math.imul(h ^ (b | 0), 0x85ebca6b); h ^= h >>> 13;
    h = Math.imul(h ^ (c | 0), 0xc2b2ae35); h ^= h >>> 16;
    h = Math.imul(h ^ (d | 0), 0x27d4eb2f); h ^= h >>> 15;
    h = Math.imul(h, 0x165667b1); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  // Fields that are relayed between cells live in two copies (current and next).
  var RELAYED = [
    ['e1d', Uint16Array], ['e1id', Int32Array], ['e1t', Uint8Array],   // nearest pole: hops, id, type
    ['e2d', Uint16Array], ['e2id', Int32Array], ['e2t', Uint8Array],   // nearest pole with another id
    ['m', Float32Array],      // relayed estimate of the pole-to-pole length (the shortest S nearby)
    ['dL', Uint16Array],      // hops to an uninjured body edge (finds the middle of a wound bud)
    ['alarm', Uint16Array],   // wound alarm, relayed and fading one step per hop
    ['mem', Float32Array]     // voltage memory: 0 normal, 1 head-like
  ];
  // Fields owned by the cell (written only by its own update, or copied at birth).
  var OWN = [
    ['state', Uint8Array], ['org', Uint8Array], ['orgId', Int32Array],
    ['ident', Uint8Array], ['pos', Float32Array], ['facing', Int8Array],
    ['wound', Uint8Array], ['wt', Uint16Array], ['blast', Uint8Array], ['gen', Uint8Array],
    ['age', Uint16Array], ['nPrev', Uint8Array], ['starve', Uint16Array],
    ['dieT', Uint8Array], ['lat', Float32Array], ['edge', Uint8Array],
    // render-only: visual offset after the pieces are pushed apart (moved with the cell)
    ['offX', Float32Array], ['offY', Float32Array]
  ];

  function Model(opts) {
    opts = opts || {};
    this.L0 = opts.L0 || 120;                       // length of the starting worm, in hops
    this.nx = opts.nx || Math.round(this.L0 * 2.3);
    this.ny = opts.ny || Math.round(this.L0 * 1.15);
    this.ny += this.ny & 1;
    this.seed = (opts.seed == null ? 1 : opts.seed) | 0;
    var L0 = this.L0;
    this.P = {
      CAP: Math.round(1.8 * L0),       // pole signals fade out beyond this many hops
      MIN_AXIS: Math.round(0.2 * L0),  // two poles closer than this cannot make a body
      BUD_DEPTH: 4,                    // a blastema cell this many divisions from the wound stops dividing
      BUD_MIN: 2,                      // bud generation at which an organiser can appear
      DL_MIN: 3,                       // a bud must be at least this wide (hops from its edge)
      ORG_NEAR: 14,                    // a wound closes once its organiser is this close
      BUD_LAT: 0.9,                    // a bud does not spread sideways past the old body's edge
      FACING: 0.18,                    // a wound faces head- or tail-ward if pos changes this much (x 1/length)
      ORG_LAT: 0.5,                    // organisers form only near the remembered body axis
      EPS_M: EPS_M,                    // slack added per hop when relaying the length estimate
      P_BUD: 0.24, P_ORG: 0.03, P_GROW: 0.15, P_DIE: 0.025,
      DYING_STEPS: 8,
      T_LAT: 400,                      // a wound with no clear polarity closes after this
      T_INHIBIT: 500,                  // a wound whose organiser is already present elsewhere closes
      T_WOUND_MAX: 1600,               // a wound that cannot pattern gives up
      T_STARVE: 1400,                  // tissue with no complete pole pair this long dies off
      BLAST_MATURE: 700,
      GROW_MARGIN: 0.1, DIE_MARGIN: 0.3,
      MEM_D: 0.5, MEM_R: 0.5, MEM_THETA: 0.2   // voltage memory: coupling, bistable pull, threshold
    };
    this.N = this.nx * this.ny;
    this.NB = new Int32Array(this.N * 6);
    this.col = new Uint8Array(this.N);    // 3-colouring of the lattice: neighbours never share a colour
    this._buildNeighbours();
    var self = this;
    this.cur = {}; this.nxt = {};
    RELAYED.forEach(function (f) { self.cur[f[0]] = new f[1](self.N); self.nxt[f[0]] = new f[1](self.N); });
    OWN.forEach(function (f) { self[f[0]] = new f[1](self.N); });
    this.born = new Uint8Array(this.N);      // birth decided this step (site index)
    this.bornParent = new Int32Array(this.N);
    this.bornBlast = new Uint8Array(this.N);
    this.bornLat = new Float32Array(this.N);
    this.dieFlag = new Uint8Array(this.N);
    this.stamp = new Int32Array(this.N);
    this.list = new Int32Array(this.N);
    this.frontier = new Int32Array(this.N);
    this.nLive = 0;
    this.t = 0;
    this.nextOrgId = 1;
    this.reset();
  }

  Model.prototype._buildNeighbours = function () {
    var nx = this.nx, ny = this.ny, NB = this.NB;
    for (var y = 0; y < ny; y++) {
      for (var x = 0; x < nx; x++) {
        var i = y * nx + x, b = i * 6, odd = y & 1;
        var q = x - (y - odd) / 2;
        this.col[i] = (((q - y) % 3) + 3) % 3;
        var c = odd
          ? [[x - 1, y], [x + 1, y], [x, y - 1], [x + 1, y - 1], [x, y + 1], [x + 1, y + 1]]
          : [[x - 1, y], [x + 1, y], [x - 1, y - 1], [x, y - 1], [x - 1, y + 1], [x, y + 1]];
        for (var k = 0; k < 6; k++) {
          var cx = c[k][0], cy = c[k][1];
          // The outer two rings of the lattice are off limits, so nothing ever touches the edge.
          NB[b + k] = (cx < 2 || cy < 2 || cx >= nx - 2 || cy >= ny - 2) ? -1 : cy * nx + cx;
        }
      }
    }
  };

  Model.prototype.X = function (i) { var y = (i / this.nx) | 0; return (i - y * this.nx) + 0.5 * (y & 1); };
  Model.prototype.Y = function (i) { return ((i / this.nx) | 0) * SQ3_2; };
  Model.prototype.siteAt = function (X, Y) {
    var y = Math.round(Y / SQ3_2);
    var x = Math.round(X - 0.5 * (y & 1));
    if (x < 2 || y < 2 || x >= this.nx - 2 || y >= this.ny - 2) return -1;
    return y * this.nx + x;
  };

  Model.prototype.rand = function (i, salt) { return hash4(this.seed, this.t, i, salt); };

  Model.prototype._clearSite = function (i) {
    var c = this.cur, n = this.nxt;
    RELAYED.forEach(function (f) { c[f[0]][i] = 0; n[f[0]][i] = 0; });
    for (var k = 0; k < OWN.length; k++) this[OWN[k][0]][i] = 0;
  };

  // ------------------------------------------------------------------ starting body
  // The first worm is laid out once, by evaluating the same local reading every cell uses
  // (hop distances to two organisers and the width profile). After that, cells are on their own.
  Model.prototype.reset = function () {
    var N = this.N, P = this.P, self = this;
    RELAYED.forEach(function (f) { self.cur[f[0]].fill(0); self.nxt[f[0]].fill(0); });
    OWN.forEach(function (f) { self[f[0]].fill(0); });
    this.t = 0;
    this.nextOrgId = 1;
    var L = this.L0;
    var cy = (this.ny >> 1) & ~1;               // an even row
    var x0 = Math.round(this.nx / 2 - L / 2);
    var head = cy * this.nx + (x0 + L), tail = cy * this.nx + x0;   // head on the right
    this.org[head] = HEAD; this.orgId[head] = this.nextOrgId++;
    this.org[tail] = TAIL; this.orgId[tail] = this.nextOrgId++;
    var hx = this.X(head), tx = this.X(tail), hy = cy;
    for (var i = 0; i < N; i++) {
      var y = (i / this.nx) | 0;
      var X = this.X(i);
      if (y < 3 || y > this.ny - 4 || X < 3 || X > this.nx - 4) continue;
      var dh = hexDist(X, y, hx, hy), dt = hexDist(X, y, tx, hy);
      var S = dh + dt, m = L;
      var f = Math.min(dh, dt) / S;
      var u = dh <= dt ? f : 1 - f;
      if ((S - m) * (1 - EPS_M) <= profile(u) * m + 0.1) { this.state[i] = LIVE; this.cur.m[i] = m + EPS_M * (S - m); }
    }
    this.state[head] = LIVE; this.state[tail] = LIVE;
    for (i = 0; i < N; i++) {
      if (!this.state[i]) continue;
      if (!this.cur.m[i]) this.cur.m[i] = L;
      this.cur.dL[i] = 0;
      this.pos[i] = 0.5;
      this.age[i] = 60000;
      this.dieT[i] = 0;
    }
    for (i = 0; i < N; i++) if (this.state[i]) this.nPrev[i] = this._countLive(i);
    // Let the signals spread and settle before anyone looks.
    this.step(Math.round(L * 1.25));
    for (i = 0; i < N; i++) this.age[i] = 60000;
  };

  function hexDist(x1, y1row, x2, y2row) {
    var dyr = Math.abs(y1row - y2row), dx = Math.abs(x1 - x2);
    return dx >= dyr / 2 ? dx + dyr / 2 : dyr;
  }

  Model.prototype._countLive = function (i) {
    var c = 0, b = i * 6;
    for (var k = 0; k < 6; k++) { var j = this.NB[b + k]; if (j >= 0 && this.state[j] === LIVE) c++; }
    return c;
  };

  // ------------------------------------------------------------------ the step
  Model.prototype.step = function (n) {
    n = n || 1;
    for (var s = 0; s < n; s++) this._step();
  };

  Model.prototype._step = function () {
    var N = this.N, state = this.state, NB = this.NB;
    this.t++;
    // Gather tissue cells and the empty sites next to them.
    var nl = 0, nf = 0, stamp = this.stamp, tag = this.t;
    for (var i = 0; i < N; i++) if (state[i] !== EMPTY) this.list[nl++] = i;
    for (var a = 0; a < nl; a++) {
      var b = this.list[a] * 6;
      for (var k = 0; k < 6; k++) {
        var j = NB[b + k];
        if (j >= 0 && state[j] === EMPTY && stamp[j] !== tag) { stamp[j] = tag; this.frontier[nf++] = j; }
      }
    }
    this.nLive = nl;
    // 1. Every tissue cell computes its next state from its neighbourhood.
    for (a = 0; a < nl; a++) this.updateCell(this.list[a]);
    // 2. Every empty site next to tissue decides whether a neighbour divides into it.
    for (a = 0; a < nf; a++) this.updateSite(this.frontier[a]);
    // 3. Commit: swap relayed fields, apply deaths and births.
    var t = this.cur; this.cur = this.nxt; this.nxt = t;
    for (a = 0; a < nl; a++) {
      i = this.list[a];
      if (state[i] === DYING) {
        if (this.dieT[i] > 0) this.dieT[i]--;
        if (this.dieT[i] === 0) this._clearSite(i);
      } else if (this.dieFlag[i]) {
        state[i] = DYING; this.dieT[i] = this.P.DYING_STEPS; this.org[i] = NONE;
      }
      this.dieFlag[i] = 0;
    }
    for (a = 0; a < nf; a++) {
      var s = this.frontier[a];
      if (!this.born[s]) continue;
      this.born[s] = 0;
      this._birth(s, this.bornParent[s], this.bornBlast[s], this.bornLat[s]);
    }
  };

  // Merge a candidate pole reading into the best two (distinct ids). Returns via the scratch object.
  function offer(B, d, id, t, cap) {
    if (!id || d >= cap) return;
    if (id === B.i1) { if (d < B.d1) B.d1 = d; return; }
    if (id === B.i2) {
      if (d < B.d2) B.d2 = d;
      if (B.d2 < B.d1) { var td = B.d1, ti = B.i1, tt = B.t1; B.d1 = B.d2; B.i1 = B.i2; B.t1 = B.t2; B.d2 = td; B.i2 = ti; B.t2 = tt; }
      return;
    }
    if (d < B.d1) { B.d2 = B.d1; B.i2 = B.i1; B.t2 = B.t1; B.d1 = d; B.i1 = id; B.t1 = t; }
    else if (d < B.d2) { B.d2 = d; B.i2 = id; B.t2 = t; }
  }
  function blank(B, cap) { B.d1 = cap; B.i1 = 0; B.t1 = 0; B.d2 = cap; B.i2 = 0; B.t2 = 0; }

  // A cell's reading of where it is, from its two pole signals and the length estimate m.
  //   f   = distance to the nearer pole / (sum of both)       (0 at a pole, 0.5 halfway)
  //   u   = position from head (0) to tail (1)
  //   S   = sum of both distances; S - m = rows away from the body axis (hex metric)
  //   lat = (S - m) / allowed half-width at u                 (0 on the axis, 1 at the edge)
  function reading(d1, t1, d2, t2, m, out) {
    var S = d1 + d2;
    var f = S > 0 ? d1 / S : 0;
    var u;
    if (t1 === HEAD && t2 === TAIL) u = f;
    else if (t1 === TAIL && t2 === HEAD) u = 1 - f;
    else if (t1 === HEAD) u = f;            // two heads: 0 at either head, 0.5 in the middle
    else u = 1 - f;                         // two tails
    var k = profile(u) * m;
    out.S = S; out.f = f; out.u = u; out.half = k; out.lat = (S - m) / Math.max(1e-6, k);
    return out;
  }

  // Eyespots and the pharynx are ovals in (place along the body, distance from the axis).
  // S and half (body length and local half-width, in hops and rows) keep a small worm's eyespots
  // at least about one cell across.
  function identityOf(t1, t2, f, u, lat, S, half) {
    if (t1 === HEAD && f < BANDS.head) {
      var ec = (BANDS.eye[0] + BANDS.eye[1]) / 2, eh = (BANDS.eye[1] - BANDS.eye[0]) / 2;
      var lc = (BANDS.eyeLat[0] + BANDS.eyeLat[1]) / 2, lh = (BANDS.eyeLat[1] - BANDS.eyeLat[0]) / 2;
      eh = Math.max(eh, 0.75 / Math.max(S, 1));
      lh = Math.max(lh, 0.6 * (1 - EPS_M) / Math.max(half, 0.1));
      var ex = (f - ec) / eh, ey = (lat - lc) / lh;
      if (ex * ex + ey * ey <= 1) return ID.EYE;
      return ID.HEAD;
    }
    if (t1 === TAIL && f < BANDS.tail) return ID.TAIL;
    var pc;
    if (t1 !== t2) pc = (u - (BANDS.pharynx[0] + BANDS.pharynx[1]) / 2) / ((BANDS.pharynx[1] - BANDS.pharynx[0]) / 2);
    else if (t1 === HEAD) pc = (0.5 - f) / (0.5 - BANDS.pharynxTwin);
    else pc = 9;
    if (pc * pc < 1 && lat < BANDS.pharynxLat * Math.sqrt(1 - pc * pc)) return ID.PHARYNX;
    return ID.TRUNK;
  }

  var B = { d1: 0, i1: 0, t1: 0, d2: 0, i2: 0, t2: 0 };
  var R = { S: 0, f: 0, u: 0, half: 0, lat: 0 };

  // ------------------------------------------------------------------ the cell rule
  // Reads: cell i and its six neighbours NB[i*6 .. i*6+5] (current arrays only).
  // Writes: next arrays at i, and the cell's own fields at i.
  Model.prototype.updateCell = function (i) {
    var P = this.P, c = this.cur, n = this.nxt, NB = this.NB, state = this.state, base = i * 6;
    var CAP = P.CAP;
    var dying = state[i] === DYING;

    // --- read the neighbourhood
    blank(B, CAP);
    if (this.org[i]) offer(B, 0, this.orgId[i], this.org[i], CAP);
    var nAll = 0, nLive = 0, anyEmpty = false;
    var mMin = 1e9, dLmin = 65535, alarmMax = 0, memSum = 0, posSum = 0, nPos = 0;
    var sameOrgLower = false, budLatMin = 9, posMin = 9, posMax = -9;
    for (var k = 0; k < 6; k++) {
      var j = NB[base + k];
      if (j < 0 || state[j] === EMPTY) { anyEmpty = true; continue; }
      nAll++;
      if (state[j] === LIVE) nLive++;
      offer(B, c.e1d[j] + 1, c.e1id[j], c.e1t[j], CAP);
      offer(B, c.e2d[j] + 1, c.e2id[j], c.e2t[j], CAP);
      if (c.m[j] < mMin) mMin = c.m[j];
      if (c.dL[j] < dLmin) dLmin = c.dL[j];
      if (c.alarm[j] > alarmMax) alarmMax = c.alarm[j];
      memSum += c.mem[j];
      posSum += this.pos[j]; nPos++;
      if (this.org[i] && this.org[j] === this.org[i] && this.orgId[j] < this.orgId[i]) sameOrgLower = true;
      if (this.blast[j] && this.edge[j] && this.lat[j] < budLatMin) budLatMin = this.lat[j];
      if (this.pos[j] < posMin) posMin = this.pos[j];
      if (this.pos[j] > posMax) posMax = this.pos[j];
    }

    // --- relay the pole signals
    n.e1d[i] = B.d1; n.e1id[i] = B.i1; n.e1t[i] = B.t1;
    n.e2d[i] = B.d2; n.e2id[i] = B.i2; n.e2t[i] = B.t2;
    // Two poles closer than MIN_AXIS cannot frame a body: the reading is not used.
    var valid = B.i1 !== 0 && B.i2 !== 0 && B.d1 + B.d2 >= P.MIN_AXIS;
    var S = valid ? B.d1 + B.d2 : 1e9;
    var m = Math.min(S, (nAll ? mMin : c.m[i]) + P.EPS_M, 4 * CAP);
    n.m[i] = m;

    // --- voltage memory: coupled to neighbours, bistable (normal 0, head-like 1)
    var v = c.mem[i];
    var vMean = nAll ? memSum / nAll : v;
    v = v + P.MEM_D * (vMean - v) + P.MEM_R * v * (1 - v) * (v - P.MEM_THETA);
    n.mem[i] = v < 0 ? 0 : v > 1 ? 1 : v;

    // --- wound detection: a neighbour that was healthy last step is gone
    var lost = !dying && nAll < this.nPrev[i];
    this.nPrev[i] = nLive;
    if (lost && !this.wound[i]) {
      this.wound[i] = 1; this.wt[i] = 0;
      // Polarity, read locally from positional memory: is this edge more head-ward than inside?
      // (pos changes by about 1/length per hop along the body and hardly at all across it)
      var g = nPos ? this.pos[i] - posSum / nPos : 0, gMin = P.FACING / Math.max(c.m[i], 10);
      this.facing[i] = g < -gMin ? 1 : g > gMin ? -1 : 0;
    }

    // --- alarm: wounds raise it; it spreads one hop per step and fades when they close
    var alarm = this.wound[i] ? CAP : (alarmMax > 0 ? alarmMax - 1 : 0);
    n.alarm[i] = alarm;

    // --- bud geometry
    var dL = (anyEmpty && !this.wound[i] && !this.blast[i]) ? 0 : Math.min(65535, dLmin + 1);
    n.dL[i] = dL;

    if (this.age[i] < 65535) this.age[i]++;
    this.edge[i] = anyEmpty ? 1 : 0;        // neighbours read this next step
    if (dying) return;

    // --- where am I? (positional reading)
    if (valid) {
      reading(B.d1, B.t1, B.d2, B.t2, m, R);
      // Identity and positional memory (place along the body, distance from the axis) are held
      // still while the wound alarm is up, because the signals are then still settling.
      if (alarm === 0) { this.ident[i] = identityOf(B.t1, B.t2, R.f, R.u, R.lat, R.S, R.half); this.pos[i] = posOf(B.d1, B.t1, B.d2, B.t2, m); this.lat[i] = R.lat; }
    }

    // --- organisers: one of two same-type organisers that are too close stands down
    if (this.org[i]) {
      var rival = (B.i2 && B.t2 === this.org[i] && B.i2 !== this.orgId[i] && B.d2 < P.MIN_AXIS && B.i2 < this.orgId[i]);
      if (sameOrgLower || rival) { this.org[i] = NONE; this.orgId[i] = 0; }
    }

    // --- which kind of end this tissue would build here
    var want = this.facing[i] > 0 ? HEAD : this.facing[i] < 0 ? (c.mem[i] > 0.5 ? HEAD : TAIL) : NONE;
    // How far a same-type organiser must be for this one to form:
    //   normal memory: a head or a tail forms only if the body has none at all (no signal heard);
    //   rewritten memory: a head forms if the nearest other head is far enough away.
    var inhibitRange = (want === HEAD && c.mem[i] > 0.5) ? P.MIN_AXIS : CAP;
    var sameNear = (B.i1 && B.t1 === want && B.d1 < inhibitRange) || (B.i2 && B.t2 === want && B.d2 < inhibitRange);
    var anyTooClose = (B.i1 && B.d1 < P.MIN_AXIS) || (B.i2 && B.d2 < P.MIN_AXIS);

    // --- wound bookkeeping
    if (this.wound[i]) {
      this.wt[i]++;
      var close = (B.i1 && B.t1 === want && B.d1 < P.ORG_NEAR) || (B.i2 && B.t2 === want && B.d2 < P.ORG_NEAR);
      if ((want === NONE && this.wt[i] > P.T_LAT) || (want !== NONE && close) ||
          (want !== NONE && sameNear && this.wt[i] > P.T_INHIBIT) || this.wt[i] > P.T_WOUND_MAX) {
        this.wound[i] = 0;
      }
    }

    // --- blastema matures
    if (this.blast[i] && this.age[i] > P.BLAST_MATURE && alarm === 0) this.blast[i] = 0;

    // --- an organiser appears at the middle of a bud's tip, if nothing nearby already does its job
    if (!this.org[i] && this.blast[i] && anyEmpty && nAll >= 3 && want !== NONE && this.gen[i] >= P.BUD_MIN &&
        c.dL[i] >= P.DL_MIN && c.dL[i] < 65535 && this.lat[i] <= P.ORG_LAT && this.lat[i] <= budLatMin && !sameNear && !anyTooClose &&
        this.rand(i, 7) < P.P_ORG) {
      this.org[i] = want; this.orgId[i] = hashId(this.seed, this.t, i);
    }

    // --- a healed body that hears no head (or no tail) makes one at the cell that remembers being
    //     furthest head-ward (or tail-ward): no neighbour remembers a place nearer that end.
    //     (A lengthwise half needs this: its cut faces neither way, so it grows no bud.)
    if (!this.org[i] && alarm === 0 && anyEmpty && !this.wound[i] && !this.blast[i] && !anyTooClose &&
        this.rand(i, 8) < P.P_ORG * 0.5) {
      var hasHead = (B.i1 && B.t1 === HEAD) || (B.i2 && B.t2 === HEAD);
      var hasTail = (B.i1 && B.t1 === TAIL) || (B.i2 && B.t2 === TAIL);
      if (!hasHead && this.pos[i] < 0.35 && this.pos[i] <= posMin) { this.org[i] = HEAD; this.orgId[i] = hashId(this.seed, this.t, i); }
      else if (!hasTail && this.pos[i] > 0.65 && this.pos[i] >= posMax) { this.org[i] = TAIL; this.orgId[i] = hashId(this.seed, this.t, i); }
    }

    // --- remodelling: an edge cell outside the width its reading allows dies off
    if (valid && alarm === 0 && anyEmpty && !this.org[i]) {
      if (R.S - m > R.half + P.DIE_MARGIN && this.rand(i, 3) < P.P_DIE) this.dieFlag[i] = 1;
    }

    // --- contact: a cell left with two or fewer neighbours (a stray or a thin spur) dies off
    if (!this.org[i] && ((nAll <= 1 && this.rand(i, 4) < 0.1) ||
        (nAll === 2 && !this.blast[i] && !this.wound[i] && this.rand(i, 4) < 0.05))) this.dieFlag[i] = 1;

    // --- starvation: tissue that never hears two poles (a piece too small to pattern) fades
    if (!valid && !this.wound[i] && alarm === 0) {
      if (this.starve[i] < 65535) this.starve[i]++;
      if (this.starve[i] > P.T_STARVE && this.rand(i, 5) < P.P_DIE) this.dieFlag[i] = 1;
    } else this.starve[i] = 0;
  };

  // Positional memory: place along the body from the difference of the two pole distances, which
  // (on this grid) does not change across the body, only along it. 0 = head end, 1 = tail end;
  // in a two-headed body 0 at either head and 0.5 in the middle.
  function posOf(d1, t1, d2, t2, m) {
    var fi = Math.max(0, 0.5 - (d2 - d1) / (2 * Math.max(m, 1)));
    return (t1 === HEAD) ? fi : 1 - fi;
  }

  // Organiser ids only need to differ; derive them from (seed, step, site) so they stay local.
  function hashId(seed, t, i) { return 1 + Math.floor(hash4(seed, t, i, 99) * 2147483000); }

  // ------------------------------------------------------------------ the empty-site rule
  // Reads: the six neighbours of empty site s. Writes: the birth decision at s.
  var BS = { d1: 0, i1: 0, t1: 0, d2: 0, i2: 0, t2: 0 };
  var RS = { S: 0, f: 0, u: 0, half: 0, lat: 0 };
  Model.prototype.updateSite = function (s) {
    var P = this.P, c = this.cur, NB = this.NB, state = this.state, base = s * 6, CAP = P.CAP;
    // Births take turns by lattice colour, so two neighbouring gaps are never filled in the same
    // step (otherwise two separate bodies could grow into touching gaps at once and fuse).
    if (this.col[s] !== this.t % 3) return;
    blank(BS, CAP);
    var occ = 0, runs = 0, prevOcc = -1, firstOcc = -1, firstId = 0, sameBody = true;
    var mMin = 1e9, alarmMax = 0, budParent = -1, growParent = -1, nParents = 0, latSum = 0;
    // Ring order of the six neighbours, so we can tell whether tissue touches s in one run.
    for (var r = 0; r < 6; r++) {
      var j = NB[base + RING[r]];
      var o = (j >= 0 && state[j] !== EMPTY) ? 1 : 0;
      if (r === 0) firstOcc = o;
      else if (o && !prevOcc) runs++;
      prevOcc = o;
      if (!o) continue;
      occ++;
      if (!firstId) firstId = c.e1id[j];
      if (!c.e1id[j] || c.e1id[j] !== firstId) sameBody = false;   // dying neighbours count here too
      if (state[j] !== LIVE) continue;
      offer(BS, c.e1d[j] + 1, c.e1id[j], c.e1t[j], CAP);
      offer(BS, c.e2d[j] + 1, c.e2id[j], c.e2t[j], CAP);
      if (c.m[j] < mMin) mMin = c.m[j];
      if (c.alarm[j] > alarmMax) alarmMax = c.alarm[j];
      if ((this.wound[j] || this.blast[j]) && this.facing[j] !== 0 && this.gen[j] < P.BUD_DEPTH) {
        if (budParent < 0 || this.rand(s, 11 + r) < 0.5) budParent = j;
      }
      nParents++;
      latSum += this.lat[j];
      if (growParent < 0 || this.rand(s, 21 + r) < 1 / nParents) growParent = j;
    }
    if (firstOcc && !prevOcc) runs++;        // the run that wraps round starts at r = 0
    if (occ === 6) runs = 1;              // a hole surrounded by tissue
    if (occ === 0 || nParents === 0) return;
    if (occ < 2) return;
    // Never bridge two stretches of tissue unless they hear the same nearest organiser (a nick
    // in one body closes; two separate bodies never fuse).
    if (runs !== 1 && !(sameBody && alarmMax === 0)) return;

    // A wound or young bud cell divides outward to build the blastema.
    if (budParent >= 0 && latSum / nParents <= P.BUD_LAT && this.rand(s, 1) < P.P_BUD) {
      this.born[s] = 1; this.bornParent[s] = budParent; this.bornBlast[s] = 1;
      this.bornLat[s] = latSum / nParents;   // a bud cell remembers the average place of its neighbours
      return;
    }
    // Ordinary growth: a neighbour divides into the gap if the gap's reading says "inside the body".
    if (alarmMax === 0 && BS.i1 && BS.i2 && BS.d1 + BS.d2 >= P.MIN_AXIS) {
      var m = mMin + P.EPS_M;
      reading(BS.d1, BS.t1, BS.d2, BS.t2, m, RS);
      if (RS.S - m <= RS.half - P.GROW_MARGIN && this.rand(s, 2) < P.P_GROW) {
        this.born[s] = 1; this.bornParent[s] = growParent; this.bornBlast[s] = 0; this.bornLat[s] = latSum / nParents;
      }
    }
  };
  // Neighbour indices in ring order (W, NW, NE, E, SE, SW) for both row parities.
  // NB order is [W, E, NW, NE, SW, SE].
  var RING = [0, 2, 3, 1, 5, 4];

  // A new cell copies its parent's state (local: the parent is a neighbour of s).
  Model.prototype._birth = function (s, p, isBlast, lat) {
    var c = this.cur, n = this.nxt;
    for (var f = 0; f < RELAYED.length; f++) { var name = RELAYED[f][0]; c[name][s] = c[name][p]; n[name][s] = c[name][p]; }
    this.state[s] = LIVE;
    this.org[s] = NONE; this.orgId[s] = 0;
    this.ident[s] = this.ident[p];
    this.pos[s] = this.pos[p];
    this.lat[s] = lat;
    this.facing[s] = isBlast ? this.facing[p] : 0;
    this.wound[s] = 0; this.wt[s] = 0;
    this.blast[s] = isBlast ? 1 : 0;
    this.gen[s] = isBlast ? Math.min(255, this.gen[p] + 1) : 0;
    this.age[s] = 0;
    this.nPrev[s] = 0;
    this.starve[s] = 0;
    this.dieT[s] = 0;
    this.offX[s] = this.offX[p]; this.offY[s] = this.offY[p];
  };

  // ------------------------------------------------------------------ outside events
  // The knife: removes the cells along a segment (lattice coordinates, in hops) and pushes the
  // pieces it separates a little apart. Returns the number of cells removed.
  Model.prototype.cut = function (ax, ay, bx, by, opts) {
    opts = opts || {};
    var width = opts.width || 1.1, gap = opts.gap == null ? Math.max(5, Math.round(this.L0 * 0.06)) : opts.gap;
    var N = this.N, removed = 0, touched = [];
    var dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1e-9;
    for (var i = 0; i < N; i++) {
      if (this.state[i] === EMPTY) continue;
      var X = this.X(i), Y = this.Y(i);
      var t = ((X - ax) * dx + (Y - ay) * dy) / len2;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      var px = ax + t * dx - X, py = ay + t * dy - Y;
      if (px * px + py * py <= width * width) {
        for (var k = 0; k < 6; k++) { var j = this.NB[i * 6 + k]; if (j >= 0) touched.push(j); }
        this._clearSite(i);
        removed++;
      }
    }
    if (!removed) return 0;
    // Mechanics (not a cell rule): pieces on either side of the cut drift apart.
    var comps = this.components();
    var nxl = -dy, nyl = dx, nl = Math.sqrt(nxl * nxl + nyl * nyl) || 1;
    nxl /= nl; nyl /= nl;
    var mx = (ax + bx) / 2, my = (ay + by) / 2;
    var self = this;
    var mark = new Int32Array(N).fill(-1);
    comps.forEach(function (cells, ci) { cells.forEach(function (i) { mark[i] = ci; }); });
    var hit = {};
    touched.forEach(function (j) { if (mark[j] >= 0) hit[mark[j]] = true; });
    var moving = [];
    comps.forEach(function (cells, ci) {
      if (!hit[ci]) return;
      var sx = 0, sy = 0;
      cells.forEach(function (i) { sx += self.X(i); sy += self.Y(i); });
      sx /= cells.length; sy /= cells.length;
      var side = (sx - mx) * nxl + (sy - my) * nyl >= 0 ? 1 : -1;
      var vx = nxl * side, vy = nyl * side;
      var sxs = 0, sys = 0;
      if (Math.abs(vx) >= 0.5) sxs = (vx > 0 ? 1 : -1) * gap;
      else sys = (vy > 0 ? 1 : -1) * 2 * Math.ceil(gap / (2 * SQ3_2));
      moving.push({ cells: cells, dx: sxs, dy: sys });
    });
    // Larger pieces move first; each move shrinks until it fits.
    moving.sort(function (a, b) { return b.cells.length - a.cells.length; });
    moving.forEach(function (mv) { self._translate(mv.cells, mv.dx, mv.dy); });
    return removed;
  };

  // Rigidly move a set of cells by (dxCols, dyRows); dyRows is even so the hex parity is kept.
  Model.prototype._translate = function (cells, dxc, dyr) {
    var nx = this.nx, ny = this.ny, self = this;
    var steps = Math.max(Math.abs(dxc), Math.abs(dyr) / 2);
    var ok = function (ddx, ddy) {
      var inSet = new Uint8Array(self.N);
      cells.forEach(function (i) { inSet[i] = 1; });
      for (var a = 0; a < cells.length; a++) {
        var i = cells[a], y = (i / nx) | 0, x = i - y * nx;
        var X2 = x + ddx, Y2 = y + ddy;
        if (X2 < 4 || Y2 < 4 || X2 >= nx - 4 || Y2 >= ny - 4) return false;
        var t = Y2 * nx + X2;
        if (self.state[t] !== EMPTY && !inSet[t]) return false;
        // keep at least one empty site between this piece and any other tissue
        for (var k = 0; k < 6; k++) {
          var q = self.NB[t * 6 + k];
          if (q >= 0 && self.state[q] !== EMPTY && !inSet[q]) return false;
        }
      }
      return true;
    };
    var ddx = dxc, ddy = dyr;
    for (var s = steps; s > 0; s--) {
      ddx = Math.round(dxc * s / steps); ddy = 2 * Math.round(dyr * s / steps / 2);
      if (ok(ddx, ddy)) break;
      ddx = 0; ddy = 0;
    }
    if (!ddx && !ddy) return;
    var snap = cells.map(function (i) { return self._save(i); });
    cells.forEach(function (i) { self._clearSite(i); });
    var shiftX = ddx, shiftY = ddy * SQ3_2;
    cells.forEach(function (i, a) {
      var y = (i / nx) | 0, x = i - y * nx;
      var t = (y + ddy) * nx + (x + ddx);
      self._load(t, snap[a]);
      self.offX[t] -= shiftX; self.offY[t] -= shiftY;   // drawn where it was, then eased over
    });
  };

  Model.prototype._save = function (i) {
    var o = { c: {}, n: {}, own: {} }, self = this;
    RELAYED.forEach(function (f) { o.c[f[0]] = self.cur[f[0]][i]; o.n[f[0]] = self.nxt[f[0]][i]; });
    OWN.forEach(function (f) { o.own[f[0]] = self[f[0]][i]; });
    return o;
  };
  Model.prototype._load = function (i, o) {
    var self = this;
    RELAYED.forEach(function (f) { self.cur[f[0]][i] = o.c[f[0]]; self.nxt[f[0]][i] = o.n[f[0]]; });
    OWN.forEach(function (f) { self[f[0]][i] = o.own[f[0]]; });
  };

  // The rewrite brush: sets the voltage memory to head-like within radius r (hops).
  Model.prototype.paint = function (X, Y, r, value) {
    value = value == null ? 1 : value;
    var c = this.cur, n = this.nxt, count = 0;
    var y0 = Math.max(0, Math.floor((Y - r) / SQ3_2)), y1 = Math.min(this.ny - 1, Math.ceil((Y + r) / SQ3_2));
    for (var y = y0; y <= y1; y++) {
      for (var x = Math.max(0, Math.floor(X - r - 1)); x <= Math.min(this.nx - 1, Math.ceil(X + r + 1)); x++) {
        var i = y * this.nx + x;
        if (this.state[i] === EMPTY) continue;
        var ddx = this.X(i) - X, ddy = this.Y(i) - Y;
        if (ddx * ddx + ddy * ddy > r * r) continue;
        c.mem[i] = value; n.mem[i] = value; count++;
      }
    }
    return count;
  };

  // ------------------------------------------------------------------ read-outs (UI and tests)
  Model.prototype.components = function () {
    var N = this.N, seen = new Uint8Array(N), out = [], NB = this.NB;
    for (var i = 0; i < N; i++) {
      if (this.state[i] === EMPTY || seen[i]) continue;
      var stack = [i], cells = [];
      seen[i] = 1;
      while (stack.length) {
        var a = stack.pop(); cells.push(a);
        for (var k = 0; k < 6; k++) {
          var j = NB[a * 6 + k];
          if (j >= 0 && !seen[j] && this.state[j] !== EMPTY) { seen[j] = 1; stack.push(j); }
        }
      }
      out.push(cells);
    }
    return out;
  };

  // Summaries of each separate body: organisers, identities, extent along the axis.
  Model.prototype.bodies = function () {
    var self = this, c = this.cur;
    return this.components().map(function (cells) {
      var b = { cells: cells, n: cells.length, heads: 0, tails: 0, minX: 1e9, maxX: -1e9, minY: 1e9, maxY: -1e9,
        cx: 0, cy: 0, wound: 0, blast: 0, young: 0, valid: 0, mem: 0, orgs: [], counts: [0, 0, 0, 0, 0, 0] };
      cells.forEach(function (i) {
        var X = self.X(i), Y = self.Y(i);
        b.cx += X; b.cy += Y;
        if (X < b.minX) b.minX = X; if (X > b.maxX) b.maxX = X;
        if (Y < b.minY) b.minY = Y; if (Y > b.maxY) b.maxY = Y;
        if (self.org[i] === HEAD) { b.heads++; b.orgs.push({ type: HEAD, X: X, Y: Y }); }
        if (self.org[i] === TAIL) { b.tails++; b.orgs.push({ type: TAIL, X: X, Y: Y }); }
        if (self.wound[i]) b.wound++;
        if (self.blast[i]) b.blast++;
        if (self.age[i] < 400) b.young++;
        if (c.e1id[i] && c.e2id[i]) b.valid++;
        b.mem += c.mem[i];
        b.counts[self.ident[i]]++;
      });
      b.cx /= b.n; b.cy /= b.n; b.mem /= b.n;
      b.length = b.maxX - b.minX + 1;
      b.width = b.maxY - b.minY + SQ3_2;
      return b;
    });
  };

  // Where along the body's long axis each identity lies, as fractions of the body's length,
  // measured from the head end. Used by the tests to check proportions.
  Model.prototype.layout = function (body) {
    var self = this, xs = { 1: [], 3: [], 4: [], 5: [] };
    body.cells.forEach(function (i) {
      var id = self.ident[i];
      if (id === ID.HEAD || id === ID.EYE) xs[1].push(self.X(i));
      if (id === ID.EYE) xs[5].push(self.X(i));
      if (id === ID.PHARYNX) xs[3].push(self.X(i));
      if (id === ID.TAIL) xs[4].push(self.X(i));
    });
    var L = body.maxX - body.minX + 1;
    function span(a) {
      if (!a.length) return null;
      var lo = Math.min.apply(null, a), hi = Math.max.apply(null, a), mean = a.reduce(function (p, q) { return p + q; }, 0) / a.length;
      return { lo: lo, hi: hi, len: (hi - lo + 1) / L, mid: mean };
    }
    return { L: L, head: span(xs[1]), pharynx: span(xs[3]), tail: span(xs[4]), eye: span(xs[5]) };
  };

  // Is every piece finished? (no wound, no bud, both poles heard everywhere)
  Model.prototype.settled = function (body) {
    return body.wound === 0 && body.blast === 0 && body.valid === body.n;
  };

  var api = {
    Model: Model, ID: ID, HEAD: HEAD, TAIL: TAIL, NONE: NONE, EMPTY: EMPTY, LIVE: LIVE, DYING: DYING,
    profile: profile, BANDS: BANDS, SQ3_2: SQ3_2, RELAYED: RELAYED, OWN: OWN, hash4: hash4
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BlastemaModel = api;
})(typeof window !== 'undefined' ? window : this);
