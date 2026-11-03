// Delve: dice, oracle, dungeon and luck model.
// Works in the browser (window.Delve) and in Node (module.exports). No DOM in this file.
//
// Every probability the page shows is computed here:
//  - dice distributions are exact, by convolution (sums) or by a dynamic programme over
//    order statistics (keep-highest / keep-lowest), with integer counts whenever the number
//    of equally likely outcomes fits in a double without rounding;
//  - oracle band probabilities are counted face by face on the oracle die;
//  - run luck is the exact distribution of a sum of per-roll percentile ranks, or a seeded
//    simulation when the exact table would be too large, and the result says which.
(function (root) {
  'use strict';

  // ------------------------------------------------------------------ seeded RNG
  // sfc32 (Chris Doty-Humphrey's Small Fast Counting generator), seeded through splitmix32.
  function splitmix32(a) {
    return function () {
      a = (a + 0x9e3779b9) | 0;
      var t = a ^ (a >>> 16);
      t = Math.imul(t, 0x21f0aaad);
      t = t ^ (t >>> 15);
      t = Math.imul(t, 0x735a2d97);
      return (t ^ (t >>> 15)) >>> 0;
    };
  }

  function Rng(seed) {
    var sm = splitmix32(seed >>> 0);
    this.a = sm(); this.b = sm(); this.c = sm(); this.d = sm();
    for (var i = 0; i < 12; i++) this.u32();
  }
  Rng.prototype.u32 = function () {
    var a = this.a, b = this.b, c = this.c, d = this.d;
    var t = (((a + b) | 0) + d) | 0;
    this.d = (d + 1) | 0;
    this.a = b ^ (b >>> 9);
    this.b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    this.c = (c + t) | 0;
    return t >>> 0;
  };
  // A fair face 1..m by rejection: values in the incomplete last block of 2^32 are redrawn,
  // so every face has exactly the same number of accepted 32-bit values.
  Rng.prototype.die = function (m) {
    var lim = 4294967296 - (4294967296 % m), x;
    do { x = this.u32(); } while (x >= lim);
    return (x % m) + 1;
  };
  Rng.prototype.unit = function () { return this.u32() / 4294967296; };
  Rng.prototype.save = function () { return [this.a, this.b, this.c, this.d]; };
  Rng.prototype.load = function (s) { this.a = s[0]; this.b = s[1]; this.c = s[2]; this.d = s[3]; return this; };

  // ------------------------------------------------------------------ dice expressions
  // { n, m, explode, keep: 'h' | 'l' | null, k, mod }. A die "explodes" when it shows its top
  // face: it is rolled again and the new face added, at most EXPLODE_CAP extra times per die.
  // The cap is part of the rule, so the distribution is finite and computed exactly.
  var LIMITS = { nMax: 10, mMin: 2, mMax: 100, explodeMMax: 20, modMax: 30, explodeCap: 4 };
  var EXPLODE_CAP = LIMITS.explodeCap;

  function mk(n, m, o) {
    o = o || {};
    var e = { n: n, m: m, explode: !!o.explode, keep: o.keep || null, k: o.k || 0, mod: o.mod || 0 };
    if (e.keep && (e.k <= 0 || e.k >= e.n)) { e.keep = null; e.k = 0; }
    if (!e.keep) e.k = 0;
    return e;
  }
  function clone(e) { return mk(e.n, e.m, e); }

  function notation(e) {
    var s = (e.n === 1 ? '' : e.n) + 'd' + e.m + (e.explode ? '!' : '');
    if (e.keep) s += 'k' + e.keep + e.k;
    if (e.mod) s += (e.mod > 0 ? '+' : '−') + Math.abs(e.mod);
    return s;
  }
  function isAdv(e) { return e.n === 2 && e.keep === 'h' && e.k === 1; }
  function isDis(e) { return e.n === 2 && e.keep === 'l' && e.k === 1; }

  // The short label used on buttons and in the journal.
  function label(e) {
    var s;
    if (isAdv(e)) s = 'd' + e.m + (e.explode ? '!' : '') + ' adv';
    else if (isDis(e)) s = 'd' + e.m + (e.explode ? '!' : '') + ' dis';
    else s = (e.n === 1 ? '' : e.n) + 'd' + e.m + (e.explode ? '!' : '') + (e.keep ? ' keep ' + (e.keep === 'h' ? 'best ' : 'worst ') + e.k : '');
    if (e.mod) s += ' ' + (e.mod > 0 ? '+' : '−') + ' ' + Math.abs(e.mod);
    return s;
  }

  var NUMWORD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  function words(e) {
    var die = e.m + '-sided';
    var s;
    if (isAdv(e)) s = 'two ' + die + ' dice, keep the higher (advantage)';
    else if (isDis(e)) s = 'two ' + die + ' dice, keep the lower (disadvantage)';
    else if (e.keep) s = NUMWORD[e.n] + ' ' + die + ' dice, keep the ' + (e.keep === 'h' ? 'highest ' : 'lowest ') + NUMWORD[e.k] + (e.k > 1 ? ', added' : '');
    else if (e.n === 1) s = 'one ' + die + ' die';
    else s = NUMWORD[e.n] + ' ' + die + ' dice, added';
    if (e.explode) s += '; a top face rolls again and adds';
    if (e.mod) s += (e.mod > 0 ? ', plus ' : ', minus ') + Math.abs(e.mod);
    return s;
  }

  function parse(text) {
    var t = String(text || '').toLowerCase().replace(/−/g, '-').replace(/\s+/g, '');
    t = t.replace(/disadvantage$/, 'dis').replace(/advantage$/, 'adv');
    t = t.replace(/(adv|dis)([+-]\d+)$/, '$2$1');
    var r = /^(\d*)d(\d+)(!?)(?:(kh|kl|k)(\d+))?([+-]\d+)?(adv|dis)?$/.exec(t);
    if (!r) return { ok: false, error: 'Try a form like 2d6, d20 adv, 4d6k3, d6! or 3d6+2.' };
    var n = r[1] ? parseInt(r[1], 10) : 1, m = parseInt(r[2], 10);
    var o = { explode: r[3] === '!', mod: r[6] ? parseInt(r[6], 10) : 0 };
    if (r[4]) { o.keep = r[4] === 'kl' ? 'l' : 'h'; o.k = parseInt(r[5], 10); }
    if (r[7]) {
      if (r[4]) return { ok: false, error: 'Advantage means two dice, keep one. Leave out the keep part.' };
      if (r[1] && n !== 1) return { ok: false, error: 'Advantage rolls one die twice and keeps one: write d' + m + ' ' + r[7] + ', or ' + n + 'd' + m + 'kh1 to keep the best of ' + n + '.' };
      n = 2; o.keep = r[7] === 'adv' ? 'h' : 'l'; o.k = 1;
    }
    if (n < 1 || n > LIMITS.nMax) return { ok: false, error: 'Use between 1 and ' + LIMITS.nMax + ' dice.' };
    if (m < LIMITS.mMin || m > LIMITS.mMax) return { ok: false, error: 'Dice can have ' + LIMITS.mMin + ' to ' + LIMITS.mMax + ' sides.' };
    if (o.explode && m > LIMITS.explodeMMax) return { ok: false, error: 'Exploding dice go up to d' + LIMITS.explodeMMax + ' here.' };
    if (o.keep && (o.k < 1 || o.k > n)) return { ok: false, error: 'Keep between 1 and ' + n + ' of ' + n + ' dice.' };
    if (Math.abs(o.mod) > LIMITS.modMax) return { ok: false, error: 'Keep the bonus between −' + LIMITS.modMax + ' and +' + LIMITS.modMax + '.' };
    return { ok: true, expr: mk(n, m, o) };
  }

  // ------------------------------------------------------------------ exact distributions
  // One die as (value, weight) pairs. With `integer`, weights are whole counts out of W equally
  // likely outcomes, so sums of them count outcomes exactly: a plain die has weight 1 per face
  // out of m; an exploding die is counted as a chain of EXPLODE_CAP + 1 rolls (m^(cap+1)
  // equally likely sequences), where a chain that stops after j + 1 rolls covers m^(cap - j) of
  // them. Otherwise weights are probabilities.
  function dieTable(m, explode, integer) {
    var vals = [], w = [], j, r, W = explode ? Math.pow(m, EXPLODE_CAP + 1) : m;
    if (!explode) {
      for (r = 1; r <= m; r++) { vals.push(r); w.push(integer ? 1 : 1 / m); }
      return { vals: vals, w: w, W: integer ? m : 1 };
    }
    for (j = 0; j < EXPLODE_CAP; j++) {
      for (r = 1; r < m; r++) { vals.push(j * m + r); w.push(integer ? Math.pow(m, EXPLODE_CAP - j) : Math.pow(m, -(j + 1))); }
    }
    for (r = 1; r <= m; r++) { vals.push(EXPLODE_CAP * m + r); w.push(integer ? 1 : Math.pow(m, -(EXPLODE_CAP + 1))); }
    return { vals: vals, w: w, W: integer ? W : 1 };
  }

  function binom(n, k) {
    var r = 1;
    for (var i = 1; i <= k; i++) r = r * (n - k + i) / i;
    return Math.round(r);
  }

  function convolveAll(t, n) {
    var lo = t.vals[0], hi = t.vals[t.vals.length - 1];
    var cur = [1], curLo = 0;
    for (var d = 0; d < n; d++) {
      var next = new Float64Array(cur.length + hi - lo);
      for (var i = 0; i < cur.length; i++) {
        if (!cur[i]) continue;
        for (var f = 0; f < t.vals.length; f++) next[i + t.vals[f] - lo] += cur[i] * t.w[f];
      }
      cur = next; curLo += lo;
    }
    return { lo: curLo, a: cur };
  }

  // Sum of the k highest (or lowest) of n independent dice. Values are visited from the best
  // end; for each value v we choose how many of the still-unassigned dice show v
  // (C(r, c) ways, weight w_v^c); only the first k assigned dice count towards the kept sum.
  function keepDP(t, n, k, high) {
    var order = t.vals.map(function (v, i) { return i; });
    if (high) order.reverse();
    var maxV = t.vals[t.vals.length - 1], S = k * maxV + 1, j, s, c;
    var cur = [], next;
    for (j = 0; j <= n; j++) cur.push(new Float64Array(S));
    cur[0][0] = 1;
    var C = [];
    for (j = 0; j <= n; j++) { C.push([]); for (c = 0; c <= j; c++) C[j].push(binom(j, c)); }
    for (var oi = 0; oi < order.length; oi++) {
      var v = t.vals[order[oi]], w = t.w[order[oi]];
      next = [];
      for (j = 0; j <= n; j++) next.push(new Float64Array(S));
      for (j = 0; j <= n; j++) {
        var row = cur[j], r = n - j, room = Math.max(0, k - j);
        for (s = 0; s < S; s++) {
          var x = row[s];
          if (!x) continue;
          var wp = 1;
          for (c = 0; c <= r; c++) {
            next[j + c][s + Math.min(c, room) * v] += x * C[r][c] * wp;
            wp *= w;
          }
        }
      }
      cur = next;
    }
    return { lo: 0, a: cur[n] };
  }

  var cache = {};
  function dist(e) {
    var key = notation(e);
    if (cache[key]) return cache[key];
    // Outcomes are counted in whole numbers whenever their total fits in a double exactly.
    var total = Math.pow(e.explode ? Math.pow(e.m, EXPLODE_CAP + 1) : e.m, e.n);
    var integer = total <= 9007199254740992;
    var t = dieTable(e.m, e.explode, integer);
    var raw = e.keep ? keepDP(t, e.n, e.k, e.keep === 'h') : convolveAll(t, e.n);
    var W = integer ? total : 1;
    // trim zero ends
    var a = raw.a, i0 = 0, i1 = a.length - 1;
    while (i0 < i1 && a[i0] === 0) i0++;
    while (i1 > i0 && a[i1] === 0) i1--;
    var p = new Float64Array(i1 - i0 + 1), cnt = integer ? [] : null, mean = 0, sum = 0;
    for (var i = i0; i <= i1; i++) {
      var q = a[i] / W;
      p[i - i0] = q; sum += q;
      if (cnt) cnt.push(Math.round(a[i]));
    }
    if (!integer) for (i = 0; i < p.length; i++) p[i] /= sum; // remove float drift (|1-sum| < 1e-14)
    var min = raw.lo + i0 + e.mod;
    for (i = 0; i < p.length; i++) mean += (min + i) * p[i];
    // `ways`/`total` are the equally likely outcomes shown on the page (plain dice only: the
    // padded chains of an exploding die are exact but not a natural thing to count aloud);
    // `cnt`/`den` are the exact counts the luck score uses, for exploding dice too.
    var plain = integer && !e.explode;
    var d = { key: key, expr: clone(e), min: min, max: min + p.length - 1, p: p, ways: plain ? cnt : null, total: plain ? total : null,
      cnt: cnt, den: integer ? total : null, mean: mean };
    cache[key] = d;
    return d;
  }

  // The range of totals worth drawing: everything, except that a long thin tail (exploding
  // dice) is cut where less than one in two thousand rolls would land beyond it.
  var TAIL_CUT = 0.0005;
  function displayRange(d) {
    var hi = d.max;
    if (d.max - d.min > 40) {
      var tail = 0;
      for (var x = d.max; x > d.min; x--) { tail += d.p[x - d.min]; if (tail >= TAIL_CUT) { hi = x; break; } }
    }
    return { lo: d.min, hi: hi };
  }
  function pAt(d, x) { return x < d.min || x > d.max ? 0 : d.p[x - d.min]; }
  function pAtLeast(d, x) {
    if (d.ways) return waysAtLeast(d, x) / d.total;
    var s = 0;
    for (var v = Math.max(x, d.min); v <= d.max; v++) s += d.p[v - d.min];
    return Math.min(1, s);
  }
  function waysAtLeast(d, x) {
    if (!d.ways) return null;
    var s = 0;
    for (var v = Math.max(x, d.min); v <= d.max; v++) s += d.ways[v - d.min];
    return s;
  }
  // Percentile rank of a landed value, ties split: P(X < x) + P(X = x) / 2. Its mean is exactly 1/2.
  function midRank(d, x) {
    var below = 0;
    for (var v = d.min; v < x && v <= d.max; v++) below += d.p[v - d.min];
    return below + pAt(d, x) / 2;
  }

  // ------------------------------------------------------------------ rolling for real
  function roll(e, rng) {
    var dice = [], i;
    for (i = 0; i < e.n; i++) {
      var faces = [], f, k = 0;
      do { f = rng.die(e.m); faces.push(f); k++; } while (e.explode && f === e.m && k <= EXPLODE_CAP);
      dice.push({ faces: faces, value: faces.reduce(function (a, b) { return a + b; }, 0), kept: true });
    }
    if (e.keep) {
      var idx = dice.map(function (d, j) { return j; });
      idx.sort(function (a, b) {
        var da = dice[a].value, db = dice[b].value;
        return e.keep === 'h' ? (db - da) || (a - b) : (da - db) || (a - b);
      });
      dice.forEach(function (d) { d.kept = false; });
      for (i = 0; i < e.k; i++) dice[idx[i]].kept = true;
    }
    var total = e.mod;
    dice.forEach(function (d) { if (d.kept) total += d.value; });
    return { dice: dice, total: total };
  }

  // ------------------------------------------------------------------ checks: four outcomes
  // Beat the target by STRONG or more: strong. Miss it by DISASTER or more: disaster.
  var STRONG = 4, DISASTER = 5;
  var TIERS = ['disaster', 'fail', 'success', 'strong'];
  var TIER_LABEL = { disaster: 'Disaster', fail: 'Fail', success: 'Success', strong: 'Strong' };
  function tierOf(x, target) {
    if (x >= target + STRONG) return 'strong';
    if (x >= target) return 'success';
    if (x <= target - DISASTER) return 'disaster';
    return 'fail';
  }
  function checkOdds(e, target) {
    var d = dist(e), o = { disaster: 0, fail: 0, success: 0, strong: 0 };
    for (var x = d.min; x <= d.max; x++) o[tierOf(x, target)] += d.p[x - d.min];
    o.pass = pAtLeast(d, target);
    o.passWays = waysAtLeast(d, target);
    o.total = d.total;
    return o;
  }

  // ------------------------------------------------------------------ number formatting
  function fmtPct(p) {
    if (p <= 0) return '0%';
    if (p >= 1) return '100%';
    if (p < 0.001) return 'under 0.1%';
    if (p > 0.999) return 'over 99.9%';
    // toFixed(6) first, so a float sum such as 0.56249999999 rounds as the exact 0.5625 does.
    var s = (Math.round(+(p * 1000).toFixed(6)) / 10).toFixed(1);
    if (s === '0.0') s = '0.1';
    if (s === '100.0') s = '99.9';
    return s.replace(/\.0$/, '') + '%';
  }
  function fmtNum(x) { return String(x).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function fmtWays(w, total) { return fmtNum(w) + ' of ' + fmtNum(total) + ' ways'; }

  // ------------------------------------------------------------------ the oracle
  // One d20. The likelihood sets a line: faces on or above it say yes. The two faces either
  // side of the line are the near misses, "but"; the outermost faces are "and".
  var ORACLE_DIE = 20;
  var LIKELIHOODS = {
    unlikely: { key: 'unlikely', label: 'Unlikely', line: 15 },
    even: { key: 'even', label: 'Even odds', line: 11 },
    likely: { key: 'likely', label: 'Likely', line: 7 }
  };
  var ANSWERS = ['no-and', 'no', 'no-but', 'yes-but', 'yes', 'yes-and'];
  var ANSWER_LABEL = { 'no-and': 'No, and', 'no': 'No', 'no-but': 'No, but', 'yes-but': 'Yes, but', 'yes': 'Yes', 'yes-and': 'Yes, and' };
  function oracleAnswer(face, lk) {
    var L = LIKELIHOODS[lk].line;
    if (face >= L) {
      if (face === ORACLE_DIE) return 'yes-and';
      return face <= L + 1 ? 'yes-but' : 'yes';
    }
    if (face === 1) return 'no-and';
    return face >= L - 2 ? 'no-but' : 'no';
  }
  function oracleBands(lk) {
    var out = ANSWERS.map(function (a) { return { key: a, label: ANSWER_LABEL[a], faces: [], p: 0 }; });
    var byKey = {};
    out.forEach(function (b) { byKey[b.key] = b; });
    for (var f = 1; f <= ORACLE_DIE; f++) byKey[oracleAnswer(f, lk)].faces.push(f);
    out.forEach(function (b) { b.p = b.faces.length / ORACLE_DIE; b.lo = b.faces[0]; b.hi = b.faces[b.faces.length - 1]; });
    return out;
  }
  function oracleYes(lk) {
    return oracleBands(lk).reduce(function (s, b) { return s + (b.key.indexOf('yes') === 0 ? b.p : 0); }, 0);
  }
  var ORACLE_EXPR = mk(1, ORACLE_DIE);

  // ------------------------------------------------------------------ situations
  // style: careful (costs time: a torch), bold (costs 2 health), clever (costs 1 health).
  var COST = {
    careful: { fail: { torch: 1 }, disaster: { torch: 1, health: 1 } },
    bold: { fail: { health: 2 }, disaster: { health: 3 } },
    clever: { fail: { health: 1 }, disaster: { health: 2 } }
  };
  function A(style, text, n, m, o, target, did) { return { style: style, text: text, expr: mk(n, m, o), target: target, did: did }; }
  var ADV = { keep: 'h', k: 1 }, DIS = { keep: 'l', k: 1 };

  var GATE = {
    id: 'gate', name: 'The Rusted Gate', search: 'even',
    text: 'A rusted gate bars the first stair down. The hinges are stiff with age.',
    hint: '',
    approaches: [
      A('careful', 'Work the hinges loose', 2, 6, null, 7, 'worked the hinges loose'),
      A('clever', 'Find the weakest bar', 1, 12, null, 6, 'looked for the weakest bar')
    ]
  };
  var WARDEN = {
    id: 'warden', name: 'The Lowest Hall', search: null, final: true,
    text: 'A stone warden guards the lamp at the bottom of the delve. You must get past it. Each failure costs you and you try again.',
    hint: 'a cold, steady light',
    approaches: [
      A('careful', 'Wait for the blade to fall, then slip by', 2, 6, null, 8, 'waited for the blade, then moved'),
      A('bold', 'Strike its cracked knee', 2, 20, ADV, 13, 'struck at the cracked knee'),
      A('clever', 'Read the word carved on its base aloud', 1, 12, null, 7, 'read the carved word aloud')
    ]
  };
  var POOL = [
    { id: 'hound', name: 'The Sleeping Hound', search: 'unlikely',
      text: 'A great grey hound sleeps across the passage. One ear twitches.',
      hint: 'a smell of wet fur',
      approaches: [
        A('careful', 'Creep along the far wall', 2, 6, null, 8, 'crept along the far wall'),
        A('bold', 'Leap it while it sleeps', 2, 20, ADV, 12, 'leapt over it while it slept'),
        A('clever', 'Toss it the last of the bread', 1, 12, null, 5, 'tossed it the bread')
      ] },
    { id: 'bridge', name: 'The Rope Bridge', search: 'unlikely',
      text: 'A rope bridge sags over a black drop. Several planks are missing.',
      hint: 'wind from far below',
      approaches: [
        A('careful', 'Test every plank first', 3, 6, null, 10, 'tested every plank'),
        A('bold', 'Run before it can give way', 1, 20, null, 9, 'ran for it')
      ] },
    { id: 'face', name: 'The Stone Face', search: 'even',
      text: 'A face carved in the wall asks: what grows shorter the longer it lives?',
      hint: 'a voice, very slow',
      approaches: [
        A('careful', 'Think it through, slowly', 2, 6, { mod: 1 }, 8, 'thought it through'),
        A('clever', 'Trust a hunch; sixes count again', 2, 6, { explode: true }, 9, 'trusted a hunch')
      ] },
    { id: 'water', name: 'The Flooded Passage', search: 'even',
      text: 'Cold water fills the passage to the waist. Something moves beneath it.',
      hint: 'dripping water',
      approaches: [
        A('careful', 'Wade along the wall', 2, 6, null, 6, 'waded along the wall'),
        A('bold', 'Swim the deep middle', 1, 20, null, 8, 'swam the deep middle'),
        A('clever', 'Float across on a broken door', 1, 12, null, 5, 'floated across on a door')
      ] },
    { id: 'rubble', name: 'The Fallen Roof', search: 'likely',
      text: 'Half the ceiling has come down. What remains creaks.',
      hint: 'grit falling',
      approaches: [
        A('careful', 'Shore it up; four tries, keep the best three', 4, 6, { keep: 'h', k: 3 }, 12, 'shored it up with beams'),
        A('bold', 'Dash beneath before it settles', 1, 20, null, 10, 'dashed beneath')
      ] },
    { id: 'tiles', name: 'The Pale Tiles', search: 'unlikely',
      text: 'The floor is tiled in pale and dark stone. Old bones lie on the pale ones.',
      hint: 'a faint click',
      approaches: [
        A('careful', 'Step only on the dark stones', 2, 6, null, 7, 'stepped only on dark stones'),
        A('bold', 'Jump the hall in the dark', 2, 20, DIS, 7, 'jumped the hall blind'),
        A('clever', 'Push a fallen statue ahead', 1, 12, null, 6, 'pushed a statue ahead')
      ] },
    { id: 'crow', name: 'The Toll Crow', search: 'likely',
      text: 'A crow with one white eye sits on a skull and demands a toll.',
      hint: 'a dry cawing',
      approaches: [
        A('careful', 'Answer its three questions', 3, 6, null, 11, 'answered its questions'),
        A('bold', 'Shout it off its perch', 1, 20, null, 11, 'shouted it away'),
        A('clever', 'Bargain with a button', 1, 12, null, 7, 'bargained with a button')
      ] },
    { id: 'shaft', name: 'The Iron Rungs', search: 'even',
      text: 'The way on is a shaft. Old iron rungs lead down into the dark.',
      hint: 'a long echo',
      approaches: [
        A('careful', 'Rope yourself to each rung', 2, 6, { mod: 2 }, 9, 'roped down rung by rung'),
        A('bold', 'Slide down the chain', 2, 20, ADV, 14, 'slid down the chain')
      ] },
    { id: 'mirrors', name: 'The Mirror Hall', search: 'likely',
      text: 'A hall of tarnished mirrors. Your reflection is a step behind you.',
      hint: 'your own footsteps, late',
      approaches: [
        A('careful', 'Chalk each mirror as you pass', 2, 6, null, 7, 'chalked each mirror'),
        A('bold', 'Break a way through', 2, 20, ADV, 11, 'broke a way through'),
        A('clever', 'Walk it with eyes shut', 1, 12, null, 6, 'walked it with eyes shut')
      ] },
    { id: 'spores', name: 'The Glowing Cave', search: 'likely',
      text: 'Pale fungus glows along the walls. The air tastes of spores.',
      hint: 'a sweet, rotten smell',
      approaches: [
        A('careful', 'Hold your breath and walk', 3, 6, null, 9, 'held a breath and walked'),
        A('bold', 'Run through', 1, 20, null, 6, 'ran through'),
        A('clever', 'Breathe through a wet cloth', 1, 8, { mod: 2 }, 6, 'breathed through a wet cloth')
      ] },
    { id: 'webs', name: 'The Webbed Hall', search: 'even',
      text: 'Thick webs hang from wall to wall. Something large made them.',
      hint: 'a faint rustle',
      approaches: [
        A('careful', 'Cut a path, thread by thread', 2, 6, null, 6, 'cut a path'),
        A('bold', 'Tear straight through', 2, 20, DIS, 6, 'tore straight through'),
        A('clever', 'Follow the old thread back', 1, 12, null, 4, 'followed the old thread')
      ] }
  ];
  var SITUATIONS = [GATE, WARDEN].concat(POOL);
  function situation(id) { for (var i = 0; i < SITUATIONS.length; i++) if (SITUATIONS[i].id === id) return SITUATIONS[i]; return null; }

  // ------------------------------------------------------------------ dungeon generation
  // A layered map: level 0 is the gate, the last level is the lowest hall, and each middle
  // level holds one to three rooms. A run passes through one room per level, so the path is
  // 8 to 10 rooms long, out of 8 to 12 on the map. Doors join neighbouring levels by a monotone staircase,
  // so every room has a way in and a way on, and no two corridors cross.
  function generate(seed) {
    var rng = new Rng((seed ^ 0x5bd1e995) >>> 0);
    var L = 7 + rng.die(3);            // 8..10 levels
    var R = L + rng.die(13 - L) - 1;   // L..12 rooms
    var M = L - 2, widths = [], i, extra = R - 2 - M;
    for (i = 0; i < M; i++) widths.push(1);
    var guard = 0;
    while (extra > 0 && guard++ < 1000) {
      var cap = widths.every(function (w) { return w >= 2; }) ? 3 : 2;
      i = rng.die(M) - 1;
      if (widths[i] < cap) { widths[i]++; extra--; }
    }
    widths = [1].concat(widths, [1]);
    var pool = POOL.slice();
    for (i = pool.length - 1; i > 0; i--) { var j = rng.die(i + 1) - 1, tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp; }
    var rooms = [], levels = [];
    widths.forEach(function (w, lv) {
      var ids = [];
      for (var r = 0; r < w; r++) {
        var sit = lv === 0 ? GATE : lv === L - 1 ? WARDEN : pool.pop();
        ids.push(rooms.length);
        rooms.push({ id: rooms.length, level: lv, row: r, rows: w, sit: sit.id, doors: [] });
      }
      levels.push(ids);
    });
    for (var lv = 0; lv < L - 1; lv++) {
      var a = levels[lv], b = levels[lv + 1], x = 0, y = 0;
      rooms[a[0]].doors.push(b[0]);
      while (x < a.length - 1 || y < b.length - 1) {
        var step;
        if (x === a.length - 1) step = 'b';
        else if (y === b.length - 1) step = 'a';
        else step = ['a', 'b', 'ab'][rng.die(3) - 1];
        if (step.indexOf('a') >= 0) x++;
        if (step.indexOf('b') >= 0) y++;
        rooms[a[x]].doors.push(b[y]);
      }
    }
    return { seed: seed >>> 0, rooms: rooms, levels: levels, start: 0, goal: rooms.length - 1 };
  }

  // ------------------------------------------------------------------ the game
  var START = { health: 7, torches: 6, maxHealth: 7, maxTorches: 7, maxBoon: 2 };
  // Searching asks the oracle "Is there anything useful here?" at the room's likelihood.
  var SEARCH_EFFECT = {
    'yes-and': { torch: 1, health: 1 },
    'yes': { torch: 1 },
    'yes-but': { health: 1, torchLoss: 1 },
    'no-but': { boon: 1 },
    'no': {},
    'no-and': { torchLoss: 1 }
  };
  var SEARCH_QUESTION = 'Is there anything useful here?';

  // The map comes from `seed`; the dice from `diceSeed` (the same number unless given), so the
  // same map can be walked again with fresh dice.
  function newRun(seed, diceSeed) {
    seed = seed >>> 0;
    diceSeed = diceSeed == null ? seed : diceSeed >>> 0;
    return {
      seed: seed, diceSeed: diceSeed, dungeon: generate(seed), rng: new Rng(diceSeed).save(),
      health: START.health, torches: START.torches, boon: 0,
      room: 0, visited: [0], phase: 'room', searched: {}, log: [], rolls: [], outcome: null, steps: 0
    };
  }
  function rngOf(s) { return new Rng(0).load(s.rng); }
  function currentSit(s) { return situation(s.dungeon.rooms[s.room].sit); }
  function dark(s) { return s.torches <= 0; }

  // The expression actually rolled, after darkness and any boon. In the dark a d20 loses a
  // step (advantage becomes a plain roll, a plain roll becomes disadvantage); other dice take -1.
  function effective(s, ap) {
    var e = clone(ap.expr), notes = [];
    if (dark(s)) {
      if (e.m === 20 && !e.explode && isAdv(e)) { e = mk(1, 20, { mod: e.mod }); notes.push('dark: advantage lost'); }
      else if (e.m === 20 && !e.explode && e.n === 1 && !e.keep) { e = mk(2, 20, { keep: 'l', k: 1, mod: e.mod }); notes.push('dark: disadvantage'); }
      else { e.mod -= 1; notes.push('dark: −1'); }
    }
    if (s.boon > 0) { e.mod += s.boon; notes.push('boon: +' + s.boon); }
    return { expr: e, notes: notes };
  }

  function applyDelta(s, d, out) {
    if (d.health) { var h0 = s.health; s.health = Math.max(0, Math.min(START.maxHealth, s.health + d.health)); out.health = (out.health || 0) + s.health - h0; }
    if (d.torch) { var t0 = s.torches; s.torches = Math.max(0, Math.min(START.maxTorches, s.torches + d.torch)); out.torch = (out.torch || 0) + s.torches - t0; }
    if (d.boon) { var b0 = s.boon; s.boon = Math.max(0, Math.min(START.maxBoon, s.boon + d.boon)); out.boon = (out.boon || 0) + s.boon - b0; }
  }

  function costFor(s, style, tier) {
    var c = COST[style][tier], d = {};
    if (c.health) d.health = -c.health;
    if (c.torch) {
      // A careful failure costs time. With no torch left to burn, it costs health instead,
      // so every failure costs something and a run always ends.
      if (s.torches > 0) d.torch = -c.torch; else d.health = (d.health || 0) - c.torch;
    }
    return d;
  }

  // What a fail and a disaster would cost right now, in the words the approach cards use.
  // Built from costFor, so the card always says what the rules will take.
  function costParts(d) {
    var a = [];
    if (d.torch) a.push(-d.torch === 1 ? 'a torch' : (-d.torch) + ' torches');
    if (d.health) a.push((-d.health) + ' health');
    return a.join(' and ');
  }
  function costText(s, style) {
    return 'Fail: lose ' + costParts(costFor(s, style, 'fail')) + '. Disaster: lose ' + costParts(costFor(s, style, 'disaster')) + '.';
  }

  function attempt(s, i) {
    if (s.phase !== 'room') throw new Error('not in a room');
    var sit = currentSit(s), ap = sit.approaches[i];
    var eff = effective(s, ap), rng = rngOf(s);
    var r = roll(eff.expr, rng);
    s.rng = rng.save(); s.steps++;
    var tier = tierOf(r.total, ap.target);
    var odds = checkOdds(eff.expr, ap.target);
    var change = {};
    var usedBoon = s.boon;
    if (s.boon) applyDelta(s, { boon: -s.boon }, {});
    if (tier === 'fail' || tier === 'disaster') applyDelta(s, costFor(s, ap.style, tier), change);
    if (tier === 'strong') applyDelta(s, { boon: 1 }, change);
    var res = { kind: 'check', room: s.room, sit: sit.id, approach: i, style: ap.style, expr: eff.expr, notes: eff.notes,
      target: ap.target, roll: r, total: r.total, tier: tier, odds: odds, change: change, usedBoon: usedBoon };
    s.rolls.push({ expr: eff.expr, value: r.total, kind: 'check' });
    var pass = tier === 'success' || tier === 'strong';
    if (s.health <= 0) { s.phase = 'end'; s.outcome = 'lost'; }
    else if (sit.final && pass) { s.phase = 'end'; s.outcome = 'won'; }
    else if (!sit.final) s.phase = 'after';
    res.phase = s.phase;
    s.log.push(res);
    return res;
  }

  function canSearch(s) { return s.phase === 'after' && !s.searched[s.room] && !!currentSit(s).search; }
  function search(s) {
    if (!canSearch(s)) throw new Error('cannot search');
    var lk = currentSit(s).search, rng = rngOf(s);
    var face = rng.die(ORACLE_DIE);
    s.rng = rng.save(); s.steps++;
    var ans = oracleAnswer(face, lk), fx = SEARCH_EFFECT[ans], change = {};
    s.searched[s.room] = true;
    if (fx.torch) applyDelta(s, { torch: fx.torch }, change);
    if (fx.health) applyDelta(s, { health: fx.health }, change);
    if (fx.torchLoss) applyDelta(s, { torch: -fx.torchLoss }, change);
    if (fx.boon) applyDelta(s, { boon: fx.boon }, change);
    var res = { kind: 'search', room: s.room, sit: currentSit(s).id, likelihood: lk, face: face, answer: ans, change: change,
      p: oracleBands(lk).filter(function (b) { return b.key === ans; })[0].p };
    s.rolls.push({ expr: ORACLE_EXPR, value: face, kind: 'search' });
    s.log.push(res);
    return res;
  }

  // A free question: flavour only. It does not change the run and does not count towards luck.
  function ask(s, question, lk) {
    var rng = rngOf(s), face = rng.die(ORACLE_DIE);
    s.rng = rng.save();
    var ans = oracleAnswer(face, lk);
    var res = { kind: 'ask', room: s.room, question: String(question || '').slice(0, 120), likelihood: lk, face: face, answer: ans,
      p: oracleBands(lk).filter(function (b) { return b.key === ans; })[0].p };
    s.log.push(res);
    return res;
  }

  function doors(s) { return s.dungeon.rooms[s.room].doors.slice(); }
  function move(s, to) {
    if (s.phase !== 'after') throw new Error('not ready to move');
    if (doors(s).indexOf(to) < 0) throw new Error('no such door');
    s.room = to; s.visited.push(to); s.phase = 'room'; s.steps++;
    var change = {};
    if (s.torches > 0) applyDelta(s, { torch: -1 }, change);
    var res = { kind: 'move', room: to, sit: currentSit(s).id, change: change, dark: dark(s) };
    s.log.push(res);
    return res;
  }

  // ------------------------------------------------------------------ journal text
  function changeText(c) {
    var parts = [];
    if (c.health < 0) parts.push('lost ' + (-c.health) + ' health');
    if (c.health > 0) parts.push('gained ' + c.health + ' health');
    if (c.torch < 0) parts.push((-c.torch === 1 ? 'a torch burnt out' : (-c.torch) + ' torches burnt out'));
    if (c.torch > 0) parts.push('found ' + (c.torch === 1 ? 'a torch' : c.torch + ' torches'));
    if (c.boon > 0) parts.push('gained a boon (+1 on the next check)');
    return parts.join(', ');
  }
  var TIER_LINE = { strong: 'Strong success', success: 'Success', fail: 'Fail', disaster: 'Disaster' };
  function logText(entry) {
    var sit = situation(entry.sit), c;
    if (entry.kind === 'move') {
      return 'Entered ' + sit.name.replace(/^The /, 'the ') + '.' + (entry.change.torch ? ' A torch burnt out.' : '') + (entry.dark ? ' No light left.' : '');
    }
    if (entry.kind === 'check') {
      var ap = sit.approaches[entry.approach];
      var pPass = entry.odds.pass;
      var t = cap(ap.did) + ': ' + label(entry.expr) + ', needing ' + entry.target + '+ (' + fmtPct(pPass) + '). Rolled ' + entry.total + '. ' + TIER_LINE[entry.tier] + '.';
      c = changeText(entry.change);
      if (c) t += ' ' + cap(c) + '.';
      if (sit.final && entry.phase !== 'end' && entry.tier !== 'success' && entry.tier !== 'strong') t += ' The warden still stands.';
      return t;
    }
    var lk = LIKELIHOODS[entry.likelihood].label.toLowerCase();
    if (entry.kind === 'search') {
      t = 'Searched (' + lk + '). The oracle rolled ' + entry.face + ': ' + ANSWER_LABEL[entry.answer].toLowerCase() + ' (' + fmtPct(entry.p) + ').';
      c = changeText(entry.change);
      return t + ' ' + (c ? cap(c) + '.' : 'Nothing found.');
    }
    var q = entry.question ? '“' + entry.question + '”' : 'A question';
    return q + ' (' + lk + '). The oracle rolled ' + entry.face + ': ' + ANSWER_LABEL[entry.answer].toLowerCase() + ' (' + fmtPct(entry.p) + ').';
  }
  function cap(t) { return t.charAt(0).toUpperCase() + t.slice(1); }

  // ------------------------------------------------------------------ luck
  // Each roll scores its percentile rank (0 = lowest possible, 1 = highest, ties split).
  // Run luck is the sum. We place it among every possible outcome of the same rolls.
  //
  // Scores are exact fractions: a value with c of the D equally likely outcomes and b below it
  // scores (2b + c) / 2D. Every score is put over one common denominator Q (the least common
  // multiple of the 2D), so a run's total is a whole number of 1/Q steps and two totals are
  // equal exactly when their fractions are. The sum is then convolved exactly (split in two
  // halves, see below), or, when a half-table would pass EXACT_LIMIT entries, simulated with
  // a seed. If some roll had no exact count, or Q times the number of rolls would not fit in
  // a double, the scores fall back to a grid of 1e-9 and the result is labelled a simulation.
  var GRID = 1e9, EXACT_LIMIT = 250000, SIM_RUNS = 100000, SAFE = 9007199254740991;
  function gcd(a, b) { while (b) { var t = a % b; a = b; b = t; } return a; }
  function scaleFor(dists) {
    var Q = 1;
    for (var i = 0; i < dists.length; i++) {
      var d = dists[i];
      if (!d.cnt) return null;
      var D2 = 2 * d.den, g = gcd(Q, D2);
      Q = Q / g * D2;
      if (Q * Math.max(1, dists.length) > SAFE) return null;
    }
    return Q;
  }
  // (value -> score key) for one roll: keys are integers in units of 1/Q.
  function scoreTable(d, Q) {
    var vals = [], probs = [], i, below = 0;
    if (Q) {
      var f = Q / (2 * d.den);
      for (i = 0; i < d.cnt.length; i++) {
        var c = d.cnt[i];
        if (c <= 0) continue;
        vals.push((2 * below + c) * f); probs.push(d.p[i]);
        below += c;
      }
      return { vals: vals, probs: probs };
    }
    for (i = 0; i < d.p.length; i++) {
      var q = d.p[i];
      if (q <= 0) continue;
      vals.push(Math.round((below + q / 2) * GRID)); probs.push(q);
      below += q;
    }
    return { vals: vals, probs: probs };
  }
  function scoreKey(d, x, Q) {
    if (!Q) return Math.round(midRank(d, x) * GRID);
    var below = 0, i = x - d.min;
    for (var j = 0; j < i && j < d.cnt.length; j++) below += d.cnt[j];
    var c = i >= 0 && i < d.cnt.length ? d.cnt[i] : 0;
    return (2 * below + c) * (Q / (2 * d.den));
  }
  // The exact distribution of a sum of score tables, as a Map key -> probability, or null if it
  // would pass `limit` entries (work is bounded before each step).
  function sumTable(tables, limit) {
    var map = new Map([[0, 1]]);
    for (var t = 0; t < tables.length; t++) {
      var next = new Map(), tb = tables[t];
      if (map.size * tb.vals.length > limit * 6) return null;
      map.forEach(function (p, k) {
        for (var i = 0; i < tb.vals.length; i++) {
          var key = k + tb.vals[i];
          next.set(key, (next.get(key) || 0) + p * tb.probs[i]);
        }
      });
      map = next;
      if (map.size > limit) return null;
    }
    return map;
  }

  function luck(rolls, opts) {
    opts = opts || {};
    var dists = rolls.map(function (r) { return dist(r.expr); });
    var Q = scaleFor(dists), unit = Q || GRID;
    var tables = dists.map(function (d) { return scoreTable(d, Q); });
    var mine = 0, expected = 0;
    rolls.forEach(function (r, i) { mine += scoreKey(dists[i], r.value, Q); });
    tables.forEach(function (t) { for (var i = 0; i < t.vals.length; i++) expected += t.vals[i] * t.probs[i]; });
    var n = rolls.length, method = 'exact', below = 0, equal = 0, bins = 24, hist = new Float64Array(bins), b;
    var span = n * unit;
    // Bins are equal slices of 0..n; with whole-number keys the bin edges are exact too.
    var binOf = function (k) { return n ? Math.min(bins - 1, Math.floor(k * bins / span)) : 0; };
    // Exact, meet in the middle: split the rolls into two halves of similar size, build each
    // half's exact table, then for every total A of the first half look up how much of the
    // second half's table lies below (or exactly at) what is needed. Same answer as one big
    // table, at the cost of two small ones.
    var A = null, B = null;
    if (!opts.forceSim && Q) {
      var order = tables.map(function (t, i) { return i; }).sort(function (x, y) { return tables[y].vals.length - tables[x].vals.length; });
      var ha = [], hb = [], la = 0, lb = 0;
      order.forEach(function (i) { var l = Math.log(tables[i].vals.length); if (la <= lb) { ha.push(tables[i]); la += l; } else { hb.push(tables[i]); lb += l; } });
      A = sumTable(ha, EXACT_LIMIT);
      B = A && sumTable(hb, EXACT_LIMIT);
    }
    if (A && B) {
      var bk = Array.from(B.keys()).sort(function (x, y) { return x - y; });
      var cum = new Float64Array(bk.length + 1);
      for (var i = 0; i < bk.length; i++) cum[i + 1] = cum[i] + B.get(bk[i]);
      var edges = [];
      for (b = 1; b < bins; b++) edges.push(Math.ceil(b * span / bins));
      var lessAt = new Float64Array(bins - 1);
      // Walk A's totals upwards; every target (mine - a, edge - a) then only moves down B, so
      // one pointer per target finds the first B total at or above it in linear time.
      var ak = Array.from(A.keys()).sort(function (x, y) { return x - y; });
      var jm = bk.length, je = edges.map(function () { return bk.length; });
      for (var ai = 0; ai < ak.length; ai++) {
        var ka = ak[ai], pa = A.get(ka), x = mine - ka;
        while (jm > 0 && bk[jm - 1] >= x) jm--;
        below += pa * cum[jm];
        if (jm < bk.length && bk[jm] === x) equal += pa * (cum[jm + 1] - cum[jm]);
        for (var e = 0; e < edges.length; e++) {
          var xe = edges[e] - ka, je_ = je[e];
          while (je_ > 0 && bk[je_ - 1] >= xe) je_--;
          je[e] = je_;
          lessAt[e] += pa * cum[je_];
        }
      }
      var prev = 0;
      for (b = 0; b < bins - 1; b++) { hist[b] = lessAt[b] - prev; prev = lessAt[b]; }
      hist[bins - 1] = 1 - prev;
    } else {
      method = 'simulation';
      var rng = new Rng(opts.seed == null ? 12345 : opts.seed), runs = opts.runs || SIM_RUNS;
      var cdfs = tables.map(function (tb) { var c = [], s = 0; tb.probs.forEach(function (q) { s += q; c.push(s); }); return c; });
      for (var r = 0; r < runs; r++) {
        var k = 0;
        for (var t = 0; t < tables.length; t++) {
          var u = rng.unit(), c = cdfs[t], lo = 0, hi = c.length - 1;
          while (lo < hi) { var mid = (lo + hi) >> 1; if (u < c[mid]) hi = mid; else lo = mid + 1; }
          k += tables[t].vals[lo];
        }
        if (k < mine) below++; else if (k === mine) equal++;
        hist[binOf(k)] += 1;
      }
      below /= runs; equal /= runs;
      for (b = 0; b < bins; b++) hist[b] /= runs;
    }
    var pct = below + equal / 2;
    return {
      n: n, score: mine / unit, expected: expected / unit, method: method, scale: unit, runs: method === 'simulation' ? (opts.runs || SIM_RUNS) : null,
      // half-width of a 99% interval for a simulated percentile
      margin: method === 'simulation' ? 2.576 * Math.sqrt(Math.max(pct * (1 - pct), 1 / (opts.runs || SIM_RUNS)) / (opts.runs || SIM_RUNS)) : 0,
      below: below, equal: equal, percentile: pct, hist: hist, mineBin: binOf(mine)
    };
  }


  var api = {
    Rng: Rng, LIMITS: LIMITS, EXPLODE_CAP: EXPLODE_CAP,
    mk: mk, parse: parse, notation: notation, label: label, words: words, isAdv: isAdv, isDis: isDis,
    dist: dist, displayRange: displayRange, pAt: pAt, pAtLeast: pAtLeast, waysAtLeast: waysAtLeast, midRank: midRank, roll: roll,
    STRONG: STRONG, DISASTER: DISASTER, TIERS: TIERS, TIER_LABEL: TIER_LABEL, tierOf: tierOf, checkOdds: checkOdds,
    fmtPct: fmtPct, fmtNum: fmtNum, fmtWays: fmtWays,
    ORACLE_DIE: ORACLE_DIE, ORACLE_EXPR: ORACLE_EXPR, LIKELIHOODS: LIKELIHOODS, ANSWERS: ANSWERS, ANSWER_LABEL: ANSWER_LABEL,
    oracleAnswer: oracleAnswer, oracleBands: oracleBands, oracleYes: oracleYes,
    COST: COST, SITUATIONS: SITUATIONS, POOL: POOL, situation: situation, generate: generate,
    START: START, SEARCH_EFFECT: SEARCH_EFFECT, SEARCH_QUESTION: SEARCH_QUESTION,
    newRun: newRun, effective: effective, attempt: attempt, canSearch: canSearch, search: search, ask: ask,
    doors: doors, move: move, currentSit: currentSit, dark: dark, logText: logText, changeText: changeText,
    luck: luck, GRID: GRID, costFor: costFor, costText: costText, NUMWORD: NUMWORD
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Delve = api;
})(typeof window !== 'undefined' ? window : this);
