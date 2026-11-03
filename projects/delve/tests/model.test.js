// Headless checks for the Delve model. Run: node projects/delve/tests/model.test.js
// Every random check is seeded, so a run is reproducible. Exits non-zero if any check fails.
'use strict';
var assert = require('assert');
var path = require('path');
var fs = require('fs');
var M = require(path.join(__dirname, '..', 'model.js'));
var DIR = path.join(__dirname, '..');

var passed = 0, failed = 0;
function check(name, fn) {
  var t = Date.now();
  try { var note = fn(); passed++; console.log('ok   ' + name + (note ? '  (' + note + ')' : '') + '  ' + (Date.now() - t) + ' ms'); }
  catch (e) { failed++; console.error('FAIL ' + name + '\n     ' + (e && e.stack || e)); process.exitCode = 1; }
}

// ------------------------------------------------------------------ statistics helpers
// Inverse standard normal (Acklam's rational approximation, relative error < 1.2e-9).
function normInv(p) {
  var a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  var b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  var c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  var d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  var q, r, pl = 0.02425;
  if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) return -normInv(1 - p);
  q = p - 0.5; r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
// Upper critical value of chi-square with k degrees of freedom (Wilson-Hilferty; accurate to
// well under 1% at these k and alpha, and the tests also report the statistic).
function chi2Crit(k, alpha) {
  var z = normInv(1 - alpha), h = 2 / (9 * k);
  return k * Math.pow(1 - h + z * Math.sqrt(h), 3);
}

// ------------------------------------------------------------------ brute force enumeration
// Every sequence of faces, each die exploding up to the cap, weighted by its probability.
function bruteForce(e) {
  var single = [];  // [{value, p}] for one die, enumerated as rolling chains
  (function chain(sum, p, depth) {
    for (var f = 1; f <= e.m; f++) {
      var q = p / e.m;
      if (e.explode && f === e.m && depth < M.EXPLODE_CAP) chain(sum + f, q, depth + 1);
      else single.push({ value: sum + f, p: q });
    }
  })(0, 1, 0);
  var out = {};
  (function all(i, vals, p) {
    if (i === e.n) {
      var v = vals.slice();
      if (e.keep === 'h') v.sort(function (a, b) { return b - a; });
      if (e.keep === 'l') v.sort(function (a, b) { return a - b; });
      if (e.keep) v = v.slice(0, e.k);
      var tot = v.reduce(function (a, b) { return a + b; }, 0) + e.mod;
      out[tot] = (out[tot] || 0) + p;
      return;
    }
    for (var j = 0; j < single.length; j++) { vals.push(single[j].value); all(i + 1, vals, p * single[j].p); vals.pop(); }
  })(0, [], 1);
  return out;
}

// ================================================================== (a) exact distributions
check('(a) convolution matches brute-force enumeration for small expressions', function () {
  var exprs = [], count = 0;
  [1, 2, 3, 4].forEach(function (n) {
    [2, 3, 4, 6, 8].forEach(function (m) {
      if (Math.pow(m, n) > 5000) return;
      exprs.push(M.mk(n, m));
      exprs.push(M.mk(n, m, { mod: 3 }));
      exprs.push(M.mk(n, m, { mod: -2 }));
      for (var k = 1; k < n; k++) { exprs.push(M.mk(n, m, { keep: 'h', k: k })); exprs.push(M.mk(n, m, { keep: 'l', k: k, mod: 1 })); }
      if (n <= 2 && m <= 6) { exprs.push(M.mk(n, m, { explode: true })); if (n === 2) exprs.push(M.mk(n, m, { explode: true, keep: 'h', k: 1 })); }
    });
  });
  [M.mk(1, 20), M.mk(2, 20, { keep: 'h', k: 1 }), M.mk(2, 20, { keep: 'l', k: 1 }), M.mk(1, 12), M.mk(2, 12, { keep: 'h', k: 1 }), M.mk(3, 10, { keep: 'h', k: 2 })].forEach(function (e) { exprs.push(e); });
  exprs.forEach(function (e) {
    var bf = bruteForce(e), d = M.dist(e), sum = 0;
    for (var x = d.min; x <= d.max; x++) {
      var want = bf[x] || 0;
      assert(Math.abs(M.pAt(d, x) - want) < 1e-12, M.notation(e) + ' at ' + x + ': ' + M.pAt(d, x) + ' vs ' + want);
      sum += M.pAt(d, x);
      if (d.ways) assert.strictEqual(d.ways[x - d.min], Math.round(want * d.total), M.notation(e) + ' ways at ' + x);
    }
    Object.keys(bf).forEach(function (k) { assert(+k >= d.min && +k <= d.max, M.notation(e) + ' support misses ' + k); });
    assert(Math.abs(sum - 1) < 1e-12);
    count++;
  });
  return count + ' expressions';
});

check('(a) known values: 2d6 >= 7 is 21/36, d20 advantage >= 11 is 300/400, 4d6 keep 3 has 1296 outcomes', function () {
  var d = M.dist(M.mk(2, 6));
  assert.strictEqual(M.waysAtLeast(d, 7), 21); assert.strictEqual(d.total, 36);
  assert.strictEqual(M.waysAtLeast(M.dist(M.mk(2, 20, { keep: 'h', k: 1 })), 11), 300);
  assert.strictEqual(M.dist(M.mk(4, 6, { keep: 'h', k: 3 })).total, 1296);
  assert(Math.abs(M.dist(M.mk(4, 6, { keep: 'h', k: 3 })).mean - 15869 / 1296) < 1e-12);
  assert.strictEqual(M.waysAtLeast(M.dist(M.mk(3, 6)), 11), 108);
});

function pPrefix(d, i) { var s = 0; for (var j = 0; j <= i; j++) s += d.p[j]; return s; }
check('(a) large expressions match a seeded simulation inside family-wise 99.9% intervals', function () {
  var big = ['10d20k5', '6d6!', '8d10kl3+2', '10d100', '3d12!k2', '5d20-4', '10d6', '4d8!kl2'];
  var N = 200000, notes = [];
  big.forEach(function (txt, bi) {
    var e = M.parse(txt).expr, d = M.dist(e), rng = new M.Rng(9000 + bi);
    var counts = new Float64Array(d.max - d.min + 1);
    for (var i = 0; i < N; i++) {
      var r = M.roll(e, rng).total;
      assert(r >= d.min && r <= d.max, txt + ' rolled outside support: ' + r);
      counts[r - d.min]++;
    }
    for (i = 0; i < counts.length; i++) if (d.p[i] === 0) assert.strictEqual(counts[i], 0, txt + ' hit an impossible value');
    // Group neighbouring values so every group expects at least 20 hits (rare tails pooled),
    // then test each group. Bonferroni: alpha = 0.001 / groups, so all groups hold at 99.9%.
    var groups = [], gp = 0, gc = 0, from = d.min;
    for (i = 0; i < counts.length; i++) {
      gp += d.p[i]; gc += counts[i];
      if (N * gp >= 20 && N * (1 - pPrefix(d, i)) >= 20) { groups.push({ p: gp, c: gc, from: from, to: d.min + i }); gp = 0; gc = 0; from = d.min + i + 1; }
    }
    if (groups.length && (gp > 0 || gc > 0)) { var last = groups[groups.length - 1]; last.p += gp; last.c += gc; last.to = d.max; }
    var z = normInv(1 - 0.001 / (2 * groups.length)), worst = 0;
    groups.forEach(function (g) {
      var mu = N * g.p, sd = Math.sqrt(N * g.p * (1 - g.p)), dev = Math.abs(g.c - mu) / sd;
      worst = Math.max(worst, dev);
      assert(dev <= z, txt + ' values ' + g.from + '..' + g.to + ': ' + g.c + ' vs ' + mu.toFixed(1));
    });
    notes.push(txt + ' ' + groups.length + ' groups, max |z| ' + worst.toFixed(2) + ' < ' + z.toFixed(2));
  });
  return notes.join('; ');
});

check('(a) parser accepts the sandbox forms and rejects the rest', function () {
  assert.strictEqual(M.notation(M.parse('2d6').expr), '2d6');
  assert.strictEqual(M.notation(M.parse('d20 adv').expr), '2d20kh1');
  assert.strictEqual(M.notation(M.parse('d20 disadvantage').expr), '2d20kl1');
  assert.strictEqual(M.notation(M.parse('d20+3 adv').expr), '2d20kh1+3');
  assert.strictEqual(M.notation(M.parse('4d6k3').expr), '4d6kh3');
  assert.strictEqual(M.notation(M.parse('3D6 - 2').expr), '3d6−2');
  assert.strictEqual(M.notation(M.parse('d6!').expr), 'd6!');
  assert.strictEqual(M.notation(M.parse('4d6k4').expr), '4d6');
  assert.strictEqual(M.notation(M.parse('1d20 adv').expr), '2d20kh1');
  // advantage is one die rolled twice: "2d6 adv" must not quietly become "d6 adv"
  ['', 'banana', '0d6', '11d6', 'd1', 'd101', 'd30!', '3d6k4', '3d20adv', '2d6+99', '2d6 adv', '2d20 dis', '4d6k3 adv'].forEach(function (t) {
    assert.strictEqual(M.parse(t).ok, false, t);
  });
  assert(/d6 adv/.test(M.parse('2d6 adv').error), M.parse('2d6 adv').error);
});

// ================================================================== (b) RNG
check('(b) every die size is uniform: chi-square over 600,000 rolls at alpha 0.001', function () {
  var notes = [];
  [2, 4, 6, 8, 10, 12, 20, 100].forEach(function (m, i) {
    var rng = new M.Rng(31337 + i), N = 600000, c = new Float64Array(m + 1);
    for (var k = 0; k < N; k++) { var f = rng.die(m); assert(f >= 1 && f <= m && f === Math.floor(f)); c[f]++; }
    var exp = N / m, chi = 0;
    for (var f2 = 1; f2 <= m; f2++) chi += (c[f2] - exp) * (c[f2] - exp) / exp;
    var crit = chi2Crit(m - 1, 0.001);
    assert(chi < crit, 'd' + m + ' chi2 ' + chi.toFixed(2) + ' >= ' + crit.toFixed(2));
    notes.push('d' + m + ' ' + chi.toFixed(1) + '<' + crit.toFixed(1));
  });
  return notes.join(', ');
});

check('(b) successive d6 rolls are independent: chi-square on 600,000 pairs', function () {
  var rng = new M.Rng(4242), N = 600000, c = new Float64Array(36), prev = rng.die(6);
  for (var k = 0; k < N; k++) { var f = rng.die(6); c[(prev - 1) * 6 + f - 1]++; prev = f; }
  var exp = N / 36, chi = 0;
  for (var i = 0; i < 36; i++) chi += (c[i] - exp) * (c[i] - exp) / exp;
  var crit = chi2Crit(35, 0.001);
  assert(chi < crit, chi + ' >= ' + crit);
  return chi.toFixed(1) + '<' + crit.toFixed(1);
});

check('(b) seeded generators and seeded runs are reproducible', function () {
  var a = new M.Rng(77), b = new M.Rng(77), c = new M.Rng(78), same = 0;
  for (var i = 0; i < 10000; i++) { var x = a.u32(); assert.strictEqual(x, b.u32()); if (x === c.u32()) same++; }
  assert(same < 3);
  var r = new M.Rng(5); for (i = 0; i < 50; i++) r.die(6);
  var saved = r.save(), seq = [];
  for (i = 0; i < 20; i++) seq.push(r.die(20));
  var r2 = new M.Rng(0).load(saved);
  for (i = 0; i < 20; i++) assert.strictEqual(r2.die(20), seq[i]);
  function script(seed) {
    var s = M.newRun(seed), k = 0;
    while (s.phase !== 'end') {
      if (s.phase === 'room') M.attempt(s, (k++) % M.currentSit(s).approaches.length);
      else { if (M.canSearch(s)) M.search(s); M.ask(s, 'Is it quiet?', 'even'); var d = M.doors(s); M.move(s, d[k % d.length]); }
    }
    return s.log.map(M.logText).join('\n') + '|' + s.health + '|' + s.torches + '|' + s.outcome;
  }
  for (var seed = 1; seed <= 40; seed++) assert.strictEqual(script(seed), script(seed));
  assert.notStrictEqual(script(1), script(2));
  assert.deepStrictEqual(M.generate(99), M.generate(99));
});

// ================================================================== (c) oracle
// The numbers stated in the README and on the page: yes-side chance per likelihood, and each band.
var STATED = {
  unlikely: { 'no-and': 0.05, 'no': 0.55, 'no-but': 0.10, 'yes-but': 0.10, 'yes': 0.15, 'yes-and': 0.05 },
  even:     { 'no-and': 0.05, 'no': 0.35, 'no-but': 0.10, 'yes-but': 0.10, 'yes': 0.35, 'yes-and': 0.05 },
  likely:   { 'no-and': 0.05, 'no': 0.15, 'no-but': 0.10, 'yes-but': 0.10, 'yes': 0.55, 'yes-and': 0.05 }
};
check('(c) oracle bands sum to 1 and match the stated numbers', function () {
  Object.keys(M.LIKELIHOODS).forEach(function (lk) {
    var bands = M.oracleBands(lk), sum = 0, faces = [];
    bands.forEach(function (b) {
      sum += b.p;
      assert(Math.abs(b.p - STATED[lk][b.key]) < 1e-12, lk + ' ' + b.key + ' ' + b.p);
      faces = faces.concat(b.faces);
      // bands are contiguous runs of faces
      for (var i = 1; i < b.faces.length; i++) assert.strictEqual(b.faces[i], b.faces[i - 1] + 1);
    });
    assert(Math.abs(sum - 1) < 1e-12);
    assert.deepStrictEqual(faces.slice().sort(function (a, b) { return a - b; }), Array.from({ length: 20 }, function (_, i) { return i + 1; }));
    // the "but" answers are the faces on either side of the line
    var L = M.LIKELIHOODS[lk].line;
    assert.strictEqual(M.oracleAnswer(L, lk), 'yes-but'); assert.strictEqual(M.oracleAnswer(L - 1, lk), 'no-but');
    assert.strictEqual(M.oracleAnswer(L - 2, lk), 'no-but'); assert.strictEqual(M.oracleAnswer(L + 1, lk), 'yes-but');
  });
  assert(Math.abs(M.oracleYes('unlikely') - 0.3) < 1e-12 && Math.abs(M.oracleYes('even') - 0.5) < 1e-12 && Math.abs(M.oracleYes('likely') - 0.7) < 1e-12);
});

check('(c) oracle answers drawn by the game match the bands (seeded, 300,000 asks per likelihood)', function () {
  var notes = [];
  Object.keys(M.LIKELIHOODS).forEach(function (lk, li) {
    var s = M.newRun(500 + li), N = 300000, c = {};
    for (var i = 0; i < N; i++) { var a = M.ask(s, '', lk).answer; c[a] = (c[a] || 0) + 1; s.log.length = 0; }
    var chi = 0;
    M.oracleBands(lk).forEach(function (b) { var e = N * b.p; chi += Math.pow((c[b.key] || 0) - e, 2) / e; });
    var crit = chi2Crit(5, 0.001);
    assert(chi < crit, lk + ' chi2 ' + chi);
    notes.push(lk + ' ' + chi.toFixed(1));
  });
  return notes.join(', ');
});

// ================================================================== (d) dungeons
check('(d) every generated dungeon (seeds 1..20,000) is connected and finishable', function () {
  var sizes = {};
  for (var seed = 1; seed <= 20000; seed++) {
    var g = M.generate(seed), R = g.rooms.length;
    assert(R >= 8 && R <= 12, 'rooms ' + R);
    sizes[R] = (sizes[R] || 0) + 1;
    assert.strictEqual(g.rooms[g.start].sit, 'gate');
    assert.strictEqual(g.rooms[g.goal].sit, 'warden');
    var ids = g.rooms.map(function (r) { return r.sit; });
    assert.strictEqual(new Set(ids).size, R, 'repeated situation');
    // forward reachability from the gate
    var seen = new Set([g.start]), stack = [g.start];
    while (stack.length) { var r = g.rooms[stack.pop()]; r.doors.forEach(function (d) { if (!seen.has(d)) { seen.add(d); stack.push(d); } }); }
    assert.strictEqual(seen.size, R, 'unreachable room, seed ' + seed);
    // every room can reach the lowest hall; doors only go one level down
    g.rooms.forEach(function (room) {
      if (room.id === g.goal) { assert.strictEqual(room.doors.length, 0); return; }
      assert(room.doors.length >= 1, 'dead end, seed ' + seed);
      room.doors.forEach(function (d) { assert.strictEqual(g.rooms[d].level, room.level + 1); });
    });
    // no crossing corridors between neighbouring levels
    for (var lv = 0; lv < g.levels.length - 1; lv++) {
      var edges = [];
      g.levels[lv].forEach(function (id) { g.rooms[id].doors.forEach(function (d) { edges.push([g.rooms[id].row, g.rooms[d].row]); }); });
      edges.forEach(function (e1) { edges.forEach(function (e2) { assert(!((e1[0] < e2[0] && e1[1] > e2[1])), 'crossing, seed ' + seed); }); });
    }
  }
  return Object.keys(sizes).map(function (k) { return k + ' rooms: ' + sizes[k]; }).join(', ');
});

check('(d) every approach can pass and can fail, in light and dark, with or without a boon', function () {
  M.SITUATIONS.forEach(function (sit) {
    sit.approaches.forEach(function (ap) {
      [0, 1, 2].forEach(function (boon) {
        [5, 0].forEach(function (torches) {
          var s = { torches: torches, boon: boon };
          var o = M.checkOdds(M.effective(s, ap).expr, ap.target);
          assert(o.pass > 0 && o.pass < 1, sit.id + ' ' + ap.text + ' boon ' + boon + ' torches ' + torches + ': ' + o.pass);
        });
      });
    });
  });
});

check('(d) every run ends: 6,000 seeded runs under three policies, all finish within the bound', function () {
  // Each failure costs at least one point of health or one torch, health and torches are
  // capped, and finds are limited to one search per room plus strong results, so a run has
  // a hard bound on its steps. We check runs end well inside it.
  var Rng = M.Rng, won = 0, total = 0, maxSteps = 0, policies = ['first', 'random', 'best'];
  for (var seed = 1; seed <= 2000; seed++) {
    policies.forEach(function (pol, pi) {
      var s = M.newRun(seed), pick = new Rng(seed * 7 + pi);
      while (s.phase !== 'end') {
        assert(s.steps < 200, 'run did not end, seed ' + seed + ' ' + pol);
        var sit = M.currentSit(s);
        if (s.phase === 'room') {
          var i = 0;
          if (pol === 'random') i = pick.die(sit.approaches.length) - 1;
          if (pol === 'best') { var bp = -1; sit.approaches.forEach(function (ap, j) { var p = M.checkOdds(M.effective(s, ap).expr, ap.target).pass; if (p > bp) { bp = p; i = j; } }); }
          M.attempt(s, i);
        } else {
          if (pol !== 'first' && M.canSearch(s)) M.search(s);
          var d = M.doors(s); M.move(s, d[pick.die(d.length) - 1]);
        }
      }
      assert(s.outcome === 'won' || s.outcome === 'lost');
      if (s.outcome === 'won') { won++; assert.strictEqual(s.room, s.dungeon.goal); }
      else assert.strictEqual(s.health, 0);
      total++; maxSteps = Math.max(maxSteps, s.steps);
    });
  }
  assert(won > 0 && won < total);
  return 'won ' + won + ' of ' + total + ', longest ' + maxSteps + ' steps';
});

// ================================================================== luck
check('luck: exact method matches brute force over every combination of a short run', function () {
  var rolls = [{ expr: M.mk(2, 6), value: 9 }, { expr: M.mk(1, 12), value: 3 }, { expr: M.mk(2, 20, { keep: 'h', k: 1 }), value: 14 }, { expr: M.mk(1, 20), value: 11 }];
  var L = M.luck(rolls);
  assert.strictEqual(L.method, 'exact');
  var ds = rolls.map(function (r) { return M.dist(r.expr); });
  var mine = rolls.reduce(function (a, r, i) { return a + M.midRank(ds[i], r.value); }, 0);
  var below = 0, equal = 0;
  (function all(i, acc, p) {
    if (i === ds.length) { if (acc < mine - 1e-7) below += p; else if (Math.abs(acc - mine) <= 1e-7) equal += p; return; }
    for (var x = ds[i].min; x <= ds[i].max; x++) all(i + 1, acc + M.midRank(ds[i], x), p * M.pAt(ds[i], x));
  })(0, 0, 1);
  assert(Math.abs(L.below - below) < 1e-9 && Math.abs(L.equal - equal) < 1e-9, L.below + ' ' + below + ' ' + L.equal + ' ' + equal);
  // the histogram too: same bins, every combination
  var hist = new Float64Array(L.hist.length), nb = L.hist.length;
  (function all(i, acc, p) {
    if (i === ds.length) { hist[Math.min(nb - 1, Math.floor(Math.round(acc * M.GRID) / (ds.length * M.GRID) * nb))] += p; return; }
    for (var x = ds[i].min; x <= ds[i].max; x++) all(i + 1, acc + M.midRank(ds[i], x), p * M.pAt(ds[i], x));
  })(0, 0, 1);
  for (var hb = 0; hb < nb; hb++) assert(Math.abs(hist[hb] - L.hist[hb]) < 1e-6, 'bin ' + hb + ': ' + hist[hb] + ' vs ' + L.hist[hb]);
  assert(Math.abs(L.expected - rolls.length / 2) < 1e-6);
  assert(Math.abs(L.score - mine) < 1e-6);
});

check('luck: simulation agrees with the exact answer and labels itself', function () {
  var rolls = [];
  var rng = new M.Rng(3);
  ['2d6', 'd12', 'd20 adv', 'd20', '2d6+1', 'd8+2'].forEach(function (t) { var e = M.parse(t).expr; rolls.push({ expr: e, value: M.roll(e, rng).total }); });
  var ex = M.luck(rolls), sim = M.luck(rolls, { forceSim: true, seed: 11 });
  assert.strictEqual(ex.method, 'exact'); assert.strictEqual(sim.method, 'simulation');
  var se = Math.sqrt(ex.percentile * (1 - ex.percentile) / sim.runs);
  assert(Math.abs(sim.percentile - ex.percentile) < 4 * se + 1e-9, sim.percentile + ' vs ' + ex.percentile);
  var hs = 0; for (var i = 0; i < ex.hist.length; i++) hs += ex.hist[i];
  assert(Math.abs(hs - 1) < 1e-9);
  return 'exact ' + ex.percentile.toFixed(4) + ', simulated ' + sim.percentile.toFixed(4);
});

check('luck: a full run finishes the luck sum in under a second', function () {
  var worst = 0;
  for (var seed = 1; seed <= 40; seed++) {
    var s = M.newRun(seed), k = 0;
    while (s.phase !== 'end') {
      if (s.phase === 'room') M.attempt(s, (k++) % M.currentSit(s).approaches.length);
      else { if (M.canSearch(s)) M.search(s); M.move(s, M.doors(s)[0]); }
    }
    var t = Date.now(); var L = M.luck(s.rolls, { seed: seed }); worst = Math.max(worst, Date.now() - t);
    assert(L.percentile >= 0 && L.percentile <= 1);
    assert(L.method === 'exact' || L.method === 'simulation');
  }
  assert(worst < 1000, worst + ' ms');
  return 'worst ' + worst + ' ms';
});

check('luck: ties are exact; percentiles equal an exact-fraction count over every combination', function () {
  // Independent exact counts per roll: enumerate every face sequence with whole-number weights
  // (an exploding die as a padded chain of cap + 1 rolls), then score each value as the exact
  // fraction (2 * below + ways) / (2 * total) and compare run totals as BigInt fractions.
  function exactCounts(e) {
    var cap = M.EXPLODE_CAP, m = e.m, one = {};
    if (!e.explode) for (var f = 1; f <= m; f++) one[f] = BigInt(1);
    else (function chain(sum, len) {
      for (var f = 1; f <= m; f++) {
        if (f === m && len < cap) chain(sum + f, len + 1);
        else one[sum + f] = (one[sum + f] || BigInt(0)) + BigInt(Math.pow(m, cap - len));
      }
    })(0, 0);
    var faces = Object.keys(one).map(Number), out = {};
    (function all(i, vals, w) {
      if (i === e.n) {
        var v = vals.slice().sort(function (a, b) { return a - b; });
        if (e.keep === 'h') v = v.slice(v.length - e.k); else if (e.keep === 'l') v = v.slice(0, e.k);
        var t = v.reduce(function (a, b) { return a + b; }, 0) + e.mod;
        out[t] = (out[t] || BigInt(0)) + w; return;
      }
      faces.forEach(function (f) { vals.push(f); all(i + 1, vals, w * one[f]); vals.pop(); });
    })(0, [], BigInt(1));
    var tot = BigInt(0); Object.keys(out).forEach(function (k) { tot += out[k]; });
    var xs = Object.keys(out).map(Number).sort(function (a, b) { return a - b; }), below = BigInt(0), rows = [];
    xs.forEach(function (x) { rows.push({ x: x, num: BigInt(2) * below + out[x], den: BigInt(2) * tot, p: Number(out[x]) / Number(tot) }); below += out[x]; });
    return rows;
  }
  function gcdB(a, b) { while (b) { var t = a % b; a = b; b = t; } return a; }
  var cases = [
    ['2d6', 7, 'd12', 6, 'd12', 7, '2d6', 8, 'd20 adv', 14],
    ['2d6!', 8, 'd12', 5, '2d6', 7, 'd8+2', 6],
    ['3d6', 10, 'd12', 7, 'd20', 11, '2d6', 6]
  ];
  var worst = 0;
  cases.forEach(function (c) {
    var rolls = [], tabs = [];
    for (var i = 0; i < c.length; i += 2) { var e = M.parse(c[i]).expr; rolls.push({ expr: e, value: c[i + 1] }); tabs.push(exactCounts(e)); }
    var Q = tabs.reduce(function (q, t) { var d = t[0].den; return q / gcdB(q, d) * d; }, BigInt(1));
    tabs.forEach(function (t) { t.forEach(function (r) { r.key = r.num * (Q / r.den); }); });
    var mine = BigInt(0);
    rolls.forEach(function (r, i) { mine += tabs[i].filter(function (row) { return row.x === r.value; })[0].key; });
    var below = 0, equal = 0;
    (function all(i, acc, p) {
      if (i === tabs.length) { if (acc < mine) below += p; else if (acc === mine) equal += p; return; }
      tabs[i].forEach(function (row) { all(i + 1, acc + row.key, p * row.p); });
    })(0, BigInt(0), 1);
    assert(equal > 1e-4, c.join(' ') + ': this case should have real ties, equal ' + equal);
    var L = M.luck(rolls);
    assert.strictEqual(L.method, 'exact');
    var err = Math.max(Math.abs(L.below - below), Math.abs(L.equal - equal));
    worst = Math.max(worst, err);
    assert(err < 1e-12, c.join(' ') + ': below ' + L.below + ' vs ' + below + ', equal ' + L.equal + ' vs ' + equal);
  });
  return 'worst difference ' + worst.toExponential(1);
});

// ================================================================== the rules shown on the cards
check('approach cards state the cost the rules actually take, in light and in the dark', function () {
  var seen = 0;
  M.SITUATIONS.forEach(function (sit) {
    sit.approaches.forEach(function (ap, i) {
      [3, 0].forEach(function (torches) {
        ['fail', 'disaster'].forEach(function (want) {
          // find a dice seed whose roll lands in the wanted tier, then compare the card with the effect
          for (var seed = 1; seed < 5000; seed++) {
            var s = M.newRun(1, seed);
            s.dungeon.rooms[0].sit = sit.id; s.room = 0;
            s.torches = torches; s.health = 7;
            var text = M.costText(s, ap.style);
            var res = M.attempt(s, i);
            if (res.tier !== want) continue;
            var part = text.split('. ')[want === 'fail' ? 0 : 1];
            var h = part.match(/(\d+) health/), t = /a torch/.test(part) ? 1 : 0;
            var where = sit.id + ' ' + ap.style + ' torches ' + torches + ' ' + want + ': "' + text + '" vs ' + JSON.stringify(res.change);
            assert.strictEqual(res.change.health ? -res.change.health : 0, h ? +h[1] : 0, where);
            assert.strictEqual(res.change.torch ? -res.change.torch : 0, t, where);
            seen++;
            break;
          }
        });
      });
    });
  });
  var dark = M.newRun(3); dark.torches = 0;
  assert.strictEqual(M.costText(dark, 'careful'), 'Fail: lose 1 health. Disaster: lose 2 health.');
  assert.strictEqual(M.costText(M.newRun(3), 'careful'), 'Fail: lose a torch. Disaster: lose a torch and 1 health.');
  assert(seen >= 100, 'only ' + seen + ' cases checked');
  return seen + ' card and roll pairs';
});

check('same map, fresh dice: the map seed and the dice seed are separate', function () {
  var a = M.newRun(77, 1), b = M.newRun(77, 2), c = M.newRun(77);
  assert.deepStrictEqual(a.dungeon, b.dungeon);
  assert.deepStrictEqual(c.dungeon, M.newRun(77, 77).dungeon);
  var ra = [], rb = [];
  for (var i = 0; i < 6; i++) { ra.push(M.ask(a, '', 'even').face); rb.push(M.ask(b, '', 'even').face); }
  assert.notDeepStrictEqual(ra, rb);
  var x = M.newRun(77, 5), y = M.newRun(77, 5);
  M.attempt(x, 0); M.attempt(y, 0);
  assert.deepStrictEqual(x.log.map(M.logText), y.log.map(M.logText));
});

check('a run passes through 8 to 10 rooms of an 8 to 12 room map', function () {
  var counts = {};
  for (var seed = 1; seed <= 5000; seed++) {
    var g = M.generate(seed), L = g.levels.length;
    assert(L >= 8 && L <= 10, 'levels ' + L);
    assert(g.rooms.length >= L && g.rooms.length <= 12);
    counts[L] = (counts[L] || 0) + 1;
  }
  return Object.keys(counts).map(function (k) { return k + ' deep: ' + counts[k]; }).join(', ');
});

check('exploding dice are counted in whole numbers, and the counts agree with brute force', function () {
  ['d6!', '2d6!', 'd4!+1', '3d4!k2', 'd10!'].forEach(function (t) {
    var e = M.parse(t).expr, d = M.dist(e), bf = bruteForce(e), sum = 0;
    assert(d.cnt && d.den, t + ' has no exact counts');
    assert.strictEqual(d.ways, null, t + ' should not show ways');
    d.cnt.forEach(function (c, i) { sum += c; assert(Math.abs(c / d.den - (bf[d.min + i] || 0)) < 1e-13, t + ' at ' + (d.min + i)); });
    assert.strictEqual(sum, d.den, t);
  });
});

// ================================================================== (e) shown numbers come from the model
check('(e) every percentage in the journal equals the model, recomputed from scratch', function () {
  var seen = 0;
  for (var seed = 1; seed <= 400; seed++) {
    var s = M.newRun(seed), k = 0;
    while (s.phase !== 'end') {
      if (s.phase === 'room') M.attempt(s, (k++) % M.currentSit(s).approaches.length);
      else { if (M.canSearch(s)) M.search(s); if (seed % 3 === 0) M.ask(s, 'Is anyone near?', ['unlikely', 'even', 'likely'][seed % 3]); M.move(s, M.doors(s)[k % M.doors(s).length]); }
    }
    s.log.forEach(function (en) {
      var text = M.logText(en), m = text.match(/\((?:under |over )?[\d.]+%\)/g) || [];
      if (en.kind === 'check') {
        assert.strictEqual(m.length, 1, text);
        // recompute by brute force where small, else via a fresh distribution of the same notation
        var e = M.parse(M.notation(en.expr).replace('−', '-')).expr, want;
        if (Math.pow(e.m, e.n) <= 5000 || e.explode) { var bf = bruteForce(e); want = 0; Object.keys(bf).forEach(function (x) { if (+x >= en.target) want += bf[x]; }); }
        else want = M.pAtLeast(M.dist(e), en.target);
        assert.strictEqual(m[0], '(' + M.fmtPct(want) + ')', text);
        seen++;
      } else if (en.kind === 'search' || en.kind === 'ask') {
        var faces = 0;
        for (var f = 1; f <= 20; f++) if (M.oracleAnswer(f, en.likelihood) === en.answer) faces++;
        assert.strictEqual(m[0], '(' + M.fmtPct(faces / 20) + ')', text);
        assert(text.indexOf('rolled ' + en.face + ':') > 0);
        seen++;
      } else assert.strictEqual(m.length, 0, text);
    });
  }
  return seen + ' percentages';
});

check('(e) the page and app code carry no typed-in probabilities', function () {
  var app = fs.readFileSync(path.join(DIR, 'app.js'), 'utf8');
  var html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  // strings in app.js: no percentage, no "N of M ways", no decimal fraction
  var strings = app.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) || [];
  strings.forEach(function (s) {
    assert(!/\d\s*%/.test(s), 'percentage literal in app.js: ' + s);
    assert(!/\d+\s+of\s+\d+/.test(s), 'count literal in app.js: ' + s);
  });
  assert(!/[^\w.]0\.\d{3,}/.test(app), 'long decimal literal in app.js');
  // markup: the lede and the stage hold no digits at all
  var body = html.slice(html.indexOf('<h1>'), html.indexOf('</main>')).replace(/<[^>]+>/g, ' ');
  assert(!/\d/.test(body), 'digit in page text: ' + (body.match(/.{0,30}\d.{0,30}/) || [''])[0]);
  // the app gets every shown probability through the model's formatter
  assert(/fmtPct\(/.test(app));
});

check('(e) formatting is faithful: fmtPct never shows 0% or 100% for a possible-but-not-certain event', function () {
  [1e-9, 0.0004, 0.00049, 0.0005, 0.9995, 0.99951, 1 - 1e-9].forEach(function (p) {
    var t = M.fmtPct(p);
    assert(t !== '0%' && t !== '100%', p + ' -> ' + t);
  });
  assert.strictEqual(M.fmtPct(21 / 36), '58.3%');
  assert.strictEqual(M.fmtPct(0.5), '50%');
  assert.strictEqual(M.fmtPct(0), '0%');
  assert.strictEqual(M.fmtPct(1), '100%');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
