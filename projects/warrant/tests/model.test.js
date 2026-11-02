// Headless checks for the Warrant model. Run: node projects/warrant/tests/model.test.js
// Every check is seeded, so a run is reproducible. Exits non-zero if any check fails.
'use strict';
var assert = require('assert');
var path = require('path');
var fs = require('fs');
var M = require(path.join(__dirname, '..', 'model.js'));

var passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('ok   ' + name); }
  catch (e) { console.error('FAIL ' + name + '\n     ' + e.message); process.exitCode = 1; }
}
function pct(v) { return (100 * v).toFixed(2) + '%'; }

// One repetition of the full split-conformal pipeline on exchangeable data: draw training,
// calibration and test trips from the same world, fit the line, calibrate, count covered tests.
function splitRep(r, nTrain, nCal, nTest, alpha) {
  var base = M.baseShift();
  var tr = M.sampleTrips(r, base, nTrain), cal = M.sampleTrips(r, base, nCal);
  var model = M.fitOLS(tr.xs, tr.ys);
  var scores = cal.xs.map(function (x, i) { return Math.abs(cal.ys[i] - model.predict(x)); }).sort(function (a, b) { return a - b; });
  var q = M.conformalQuantile(scores, alpha), hits = 0;
  for (var i = 0; i < nTest; i++) {
    var t = M.sampleTrip(r, base);
    if (Math.abs(t.y - model.predict(t.x)) <= q) hits++;
  }
  return hits / nTest;
}

// ------------------------------------------------------------- (a) coverage under exchangeability
// Theory: P(Y in band) = ceil((n+1)(1-alpha)) / (n+1), which lies in [1 - alpha, 1 - alpha + 1/(n+1)].
// The configurations are chosen so that (n+1)(1-alpha) is not a whole number: the exact value then
// sits strictly inside that interval and Monte Carlo error cannot push an honest method outside it.
[{ n: 24, alpha: 0.1 }, { n: 12, alpha: 0.2 }, { n: 33, alpha: 0.05 }].forEach(function (c, ci) {
  check('(a) exchangeable coverage, n = ' + c.n + ', alpha = ' + c.alpha + ', 4000 repetitions', function () {
    var r = M.rng(100 + ci), reps = 4000, nTest = 20, sum = 0, sumSq = 0;
    for (var i = 0; i < reps; i++) { var v = splitRep(r, 60, c.n, nTest, c.alpha); sum += v; sumSq += v * v; }
    var mean = sum / reps, se = Math.sqrt((sumSq / reps - mean * mean) / reps);
    var exact = Math.ceil((c.n + 1) * (1 - c.alpha)) / (c.n + 1);
    var lo = 1 - c.alpha, hi = 1 - c.alpha + 1 / (c.n + 1);
    console.log('     empirical ' + pct(mean) + ' (se ' + pct(se) + '), exact ' + pct(exact) + ', allowed [' + pct(lo) + ', ' + pct(hi) + ']');
    assert(mean >= lo && mean <= hi, 'empirical coverage ' + mean + ' outside [' + lo + ', ' + hi + ']');
    assert(Math.abs(mean - exact) < 4 * se, 'empirical ' + mean + ' more than 4 se from exact ' + exact);
  });
});

check('(a) the page\'s own simulator covers at the theoretical rate (2000 calibration draws)', function () {
  // Same settings the page uses (n = 500 calibration trips, alpha = 0.1); each repetition is a fresh
  // simulator with its own training and calibration data, then 25 new trips from the same world.
  var reps = 2000, sum = 0, sumSq = 0, D = M.DEFAULTS;
  for (var i = 0; i < reps; i++) {
    var s = new M.Simulator({ seed: 5000 + i }), h = 0;
    for (var j = 0; j < 25; j++) h += s.step().m.split.hit ? 1 : 0;
    var v = h / 25; sum += v; sumSq += v * v;
  }
  var mean = sum / reps, se = Math.sqrt((sumSq / reps - mean * mean) / reps);
  var exact = Math.ceil((D.nCal + 1) * (1 - D.alpha)) / (D.nCal + 1);
  console.log('     empirical ' + pct(mean) + ' (se ' + pct(se) + '), exact ' + pct(exact) + ', allowed [' + pct(1 - D.alpha) + ', ' + pct(1 - D.alpha + 1 / (D.nCal + 1)) + '] up to Monte Carlo error');
  assert(Math.abs(mean - exact) < 4 * se, 'empirical ' + mean + ' more than 4 se from ' + exact);
  assert(mean >= 1 - D.alpha - 3 * se && mean <= 1 - D.alpha + 1 / (D.nCal + 1) + 3 * se);
});

check('(a) the expected-range band holds about 95% of windows under exchangeability', function () {
  // Each repetition: a fresh calibration set, then one window of W new trips. Count windows whose
  // coverage falls outside the beta-binomial 95% range the page draws.
  var W = 200, reps = 1500, outside = 0;
  for (var i = 0; i < reps; i++) {
    var s = new M.Simulator({ seed: 20000 + i, covWindow: W });
    for (var j = 0; j < W; j++) s.step();
    var sum = s.summary('split');
    if (sum.coverage < sum.range.lo || sum.coverage > sum.range.hi) outside++;
  }
  var rate = outside / reps;
  console.log('     windows outside the range: ' + pct(rate) + ' (nominal at most 5%, discreteness makes it a little less)');
  assert(rate < 0.07 && rate > 0.015, 'rate ' + rate);
});

// ------------------------------------------------------------- (b) the finite-sample quantile rule
check('(b) the conformal quantile is the empirical quantile at level ceil((n+1)(1-alpha))/n', function () {
  var r = M.rng(3);
  [1, 2, 5, 9, 19, 20, 24, 99, 100, 500].forEach(function (n) {
    [0.01, 0.05, 0.1, 0.2, 0.25, 0.5].forEach(function (alpha) {
      var s = []; for (var i = 0; i < n; i++) s.push(r.next());
      s.sort(function (a, b) { return a - b; });
      var level = Math.ceil((n + 1) * (1 - alpha) - 1e-9) / n;
      assert.strictEqual(M.conformalLevel(n, alpha), level, 'level n=' + n + ' alpha=' + alpha);
      // Naive definition: smallest score s with (#scores <= s)/n >= level; none if level > 1.
      var naive = Infinity;
      if (level <= 1) for (i = 0; i < n; i++) if ((i + 1) / n >= level - 1e-12) { naive = s[i]; break; }
      assert.strictEqual(M.conformalQuantile(s, alpha), naive, 'quantile n=' + n + ' alpha=' + alpha);
    });
  });
  // Worked cases: n = 24, alpha = 0.1 -> k = ceil(22.5) = 23; n = 19, alpha = 0.1 -> k = 18 (not 19:
  // 20 * 0.9 is 18 exactly, despite floating point); n = 5, alpha = 0.1 -> k = 6 > 5, so unbounded.
  var ramp = function (n) { var a = []; for (var i = 1; i <= n; i++) a.push(i); return a; };
  assert.strictEqual(M.conformalQuantile(ramp(24), 0.1), 23);
  assert.strictEqual(M.conformalQuantile(ramp(19), 0.1), 18);
  assert.strictEqual(M.conformalQuantile(ramp(5), 0.1), Infinity);
  assert.strictEqual(M.conformalQuantile(ramp(5), 0), Infinity);
  assert.strictEqual(M.conformalQuantile(ramp(5), 1), -Infinity);
  // It is not the plain empirical (1 - alpha) quantile: for n = 24 that would be the 22nd score.
  assert.notStrictEqual(M.conformalQuantile(ramp(24), 0.1), 22);
});

check('(b) the simulator\'s split band uses exactly that quantile', function () {
  var s = new M.Simulator();
  var k = Math.ceil((s.calScores.length + 1) * (1 - s.alpha) - 1e-9);
  assert.strictEqual(s.splitQ, s.calScores[k - 1]);
  var b = s.band('split', 3);
  assert(Math.abs((b[1] - b[0]) / 2 - s.calScores[k - 1]) < 1e-12);
  s.setAlpha(0.2);
  k = Math.ceil((s.calScores.length + 1) * 0.8 - 1e-9);
  assert.strictEqual(s.splitQ, s.calScores[k - 1]);
});

// ------------------------------------------------------------- (c) covariate shift
var SHIFTED = M.SHIFT.medianKm.max;
function shiftedCoverage(mode, reps, perRep) {
  var c = { split: 0, weighted: 0 }, n = 0, unbounded = 0;
  for (var i = 0; i < reps; i++) {
    var s = new M.Simulator({ seed: 40000 + i });
    s.setWeightMode(mode);
    s.setTarget('medianKm', SHIFTED); s.jumpToTarget();
    for (var j = 0; j < perRep; j++) {
      var rec = s.step();
      if (mode === 'estimated' && j < M.DEFAULTS.recentWindow) continue; // let the classifier see a full window first
      c.split += rec.m.split.hit ? 1 : 0; c.weighted += rec.m.weighted.hit ? 1 : 0; n++;
      if (rec.m.weighted.width === Infinity) unbounded++;
    }
  }
  return { split: c.split / n, weighted: c.weighted / n, unbounded: unbounded / n };
}

check('(c) under covariate shift, split conformal under-covers and weighted conformal with true weights restores it', function () {
  var a = 1 - M.DEFAULTS.alpha, res = shiftedCoverage('true', 400, 150);
  console.log('     median distance ' + M.WORLD.medianKm + ' km -> ' + SHIFTED + ' km: split ' + pct(res.split) +
    ' (short by ' + pct(a - res.split) + '), weighted (true ratio) ' + pct(res.weighted) + ', unbounded bands ' + pct(res.unbounded));
  assert(a - res.split > 0.08, 'split should under-cover by a clear margin; got ' + res.split);
  assert(res.weighted >= a - 0.01, 'weighted coverage ' + res.weighted + ' below target');
  assert(res.weighted <= a + 0.04, 'weighted coverage ' + res.weighted + ' far above target');
});

check('(c) with no shift the true weights are all equal and weighted conformal equals split', function () {
  var s = new M.Simulator();
  for (var i = 0; i < 50; i++) { var rec = s.step(); assert.strictEqual(rec.m.weighted.lo, rec.m.split.lo); }
  // The likelihood ratio has mean 1 under the calibration distribution.
  var r = M.rng(9), sum = 0, N = 200000;
  for (i = 0; i < N; i++) sum += Math.exp(M.logLikelihoodRatio(M.sampleX(r, M.baseShift()), M.WORLD.medianKm, SHIFTED));
  assert(Math.abs(sum / N - 1) < 0.02, 'mean ratio ' + sum / N);
});

check('(c) estimated weights (a classifier on distances) also recover most of the gap', function () {
  var a = 1 - M.DEFAULTS.alpha, res = shiftedCoverage('estimated', 60, 700);
  console.log('     estimated ratio: weighted ' + pct(res.weighted) + ' against split ' + pct(res.split));
  assert(res.weighted >= a - 0.03 && res.weighted - res.split > 0.08);
});

// ------------------------------------------------------------- (d) adaptive conformal inference
check('(d) ACI long-run miss rate satisfies the Gibbs & Candes bound at every T, for both variants', function () {
  var scenarios = [
    { name: 'no shift', gamma: 0.02, set: {} },
    { name: 'covariate shift', gamma: 0.02, set: { medianKm: SHIFTED } },
    { name: 'concept drift', gamma: 0.005, set: { extraPerKm: M.SHIFT.extraPerKm.max } },
    { name: 'noisier long trips', gamma: 0.05, set: { extraNoisePerKm: M.SHIFT.extraNoisePerKm.max } },
    { name: 'everything, abruptly', gamma: 0.1, set: { medianKm: SHIFTED, extraPerKm: M.SHIFT.extraPerKm.max, extraNoisePerKm: M.SHIFT.extraNoisePerKm.max }, jump: true }
  ];
  scenarios.forEach(function (sc, si) {
    var s = new M.Simulator({ seed: 300 + si, gamma: sc.gamma, maxHistory: 100000 });
    var T = 6000, misses = { aci: 0, acir: 0 }, worst = -Infinity;
    for (var t = 1; t <= T; t++) {
      if (t === 1500) { for (var k in sc.set) s.setTarget(k, sc.set[k]); if (sc.jump) s.jumpToTarget(); }
      if (t === 4000) { for (k in sc.set) s.setTarget(k, M.baseShift()[k]); }
      var rec = s.step();
      M.ADAPTIVE.forEach(function (m) {
        misses[m] += rec.m[m].hit ? 0 : 1;
        worst = Math.max(worst, Math.abs(misses[m] / t - s.alpha) - M.aciBound(s.alpha, sc.gamma, t));
      });
    }
    console.log('     ' + sc.name + ' (gamma ' + sc.gamma + '): miss rate ' + pct(misses.aci / T) + ' (fixed scores), ' + pct(misses.acir / T) +
      ' (recent scores), bound at T ' + pct(M.aciBound(s.alpha, sc.gamma, T)) +
      ', split misses ' + pct(1 - s.history.filter(function (h) { return h.m.split.hit; }).length / s.history.length));
    assert(worst <= 1e-12, sc.name + ': bound exceeded by ' + worst);
    M.ADAPTIVE.forEach(function (m) {
      assert(s.adapt[m].maxDev <= 1e-12, sc.name + ': simulator\'s own bound tracker for ' + m + ' ' + s.adapt[m].maxDev);
      assert(Math.abs(misses[m] / T - s.alpha) <= M.aciBound(s.alpha, sc.gamma, T));
    });
  });
});

check('(d) ACI\'s band is unbounded when alpha_t <= 0 and empty when alpha_t >= 1', function () {
  var s = new M.Simulator();
  M.ADAPTIVE.forEach(function (m) {
    s.adapt[m].alpha = -0.01; var b = s.band(m, 3);
    assert(b[0] === -Infinity && b[1] === Infinity);
    s.adapt[m].alpha = 1.01; b = s.band(m, 3);
    assert(isNaN(b[0]) && isNaN(b[1]));
  });
  assert.strictEqual(M.aciBound(0.1, 0.02, 100), (0.9 + 0.02) / (0.02 * 100));
});

// What the page says about the ACI repair: ACI on fixed scores pays in unbounded bands; with a rolling
// window, the window supplies the steady state and alpha_t mainly protects the transition.
check('(d) decomposition: recalibration supplies ACI-with-window\'s steady state; ACI alone pays in unbounded bands', function () {
  var drift = { extraPerKm: M.SHIFT.extraPerKm.max };
  var st = {}, s = new M.Simulator({ seed: 5, maxHistory: 100000 }), trough = { acir: 1, recal: 1 };
  ['aci', 'acir', 'recal'].forEach(function (m) { st[m] = { miss: 0, n: 0, unb: 0, w: [] }; });
  for (var t = 0; t < 4000; t++) {
    if (t === 500) for (var k in drift) s.setTarget(k, drift[k]);
    var rec = s.step();
    if (t >= 500 && t < 1000) { trough.acir = Math.min(trough.acir, rec.m.acir.cov); trough.recal = Math.min(trough.recal, rec.m.recal.cov); }
    if (t < 1500) continue;
    Object.keys(st).forEach(function (m) {
      var q = rec.m[m]; st[m].n++; st[m].miss += q.hit ? 0 : 1;
      if (q.width === Infinity) st[m].unb++; else st[m].w.push(q.width);
    });
  }
  var miss = function (m) { return st[m].miss / st[m].n; };
  var wA = M.median(st.acir.w), wR = M.median(st.recal.w), unb = st.aci.unb / st.aci.n;
  console.log('     steady state after drift: ACI+window misses ' + pct(miss('acir')) + ' (width ' + wA.toFixed(1) + '), window alone ' + pct(miss('recal')) +
    ' (width ' + wR.toFixed(1) + '); ACI alone misses ' + pct(miss('aci')) + ', unbounded ' + pct(unb) + '; transition trough ' + pct(trough.acir) + ' against ' + pct(trough.recal));
  assert(Math.abs(miss('acir') - miss('recal')) < 0.015, 'steady-state miss rates should match');
  assert(Math.abs(wA - wR) / wR < 0.05, 'steady-state widths should match');
  assert(Math.abs(s.adapt.acir.alpha - s.alpha) < 0.05, 'alpha_t with the window should settle near alpha, got ' + s.adapt.acir.alpha);
  assert(unb > 0.2, 'ACI on fixed scores should often be unbounded under drift, got ' + unb);
  assert(trough.acir - trough.recal > 0.05, 'alpha_t should protect the transition');
});

// What the page says about CQR: under this covariate shift it roughly holds (its band follows the noise
// at each distance), but nothing guarantees it, and it breaks under drift.
check('CQR roughly holds under this covariate shift but not under concept drift (200 calibration draws)', function () {
  var r = M.rng(77), cov = { split: 0, cqr: 0 }, dr = 0, n = 0, reps = 200, per = 100;
  var sh = M.baseShift(); sh.medianKm = SHIFTED;
  var d = M.baseShift(); d.extraPerKm = M.SHIFT.extraPerKm.max;
  for (var i = 0; i < reps; i++) {
    var s = new M.Simulator({ seed: 90000 + i });
    for (var j = 0; j < per; j++) {
      var t = M.sampleTrip(r, sh), b = s.band('cqr', t.x), bs = s.band('split', t.x);
      cov.cqr += b[0] <= t.y && t.y <= b[1] ? 1 : 0; cov.split += bs[0] <= t.y && t.y <= bs[1] ? 1 : 0;
      var u = M.sampleTrip(r, d), c = s.band('cqr', u.x);
      dr += c[0] <= u.y && u.y <= c[1] ? 1 : 0;
      n++;
    }
  }
  console.log('     longer trips: CQR ' + pct(cov.cqr / n) + ', split ' + pct(cov.split / n) + '; drift: CQR ' + pct(dr / n));
  assert(cov.cqr / n > 0.86 && cov.cqr / n - cov.split / n > 0.07);
  assert(dr / n < 0.7);
});

// The default seed should be typical for every repair, not flattering for one and unflattering for another.
check('the default seed is typical: split, weighted and CQR all near their averages', function () {
  var s = new M.Simulator(), r = M.rng(4242), N = 60000, cut = s.calMedianKm, base = M.baseShift();
  var c = { sS: 0, sL: 0, qS: 0, qL: 0, nS: 0, nL: 0 };
  for (var i = 0; i < N; i++) {
    var t = M.sampleTrip(r, base), b = s.band('split', t.x), q = s.band('cqr', t.x);
    var hs = b[0] <= t.y && t.y <= b[1] ? 1 : 0, hq = q[0] <= t.y && t.y <= q[1] ? 1 : 0;
    if (t.x < cut) { c.nS++; c.sS += hs; c.qS += hq; } else { c.nL++; c.sL += hs; c.qL += hq; }
  }
  var sh = M.baseShift(); sh.medianKm = SHIFTED; s.cur.medianKm = SHIFTED;
  var w = 0, sp = 0;
  for (i = 0; i < N; i++) {
    t = M.sampleTrip(r, sh); var bw = s.band('weighted', t.x), b2 = s.band('split', t.x);
    w += bw[0] <= t.y && t.y <= bw[1] ? 1 : 0; sp += b2[0] <= t.y && t.y <= b2[1] ? 1 : 0;
  }
  console.log('     seed ' + M.DEFAULTS.seed + ': split short ' + pct(c.sS / c.nS) + ', long ' + pct(c.sL / c.nL) + '; CQR short ' + pct(c.qS / c.nS) +
    ', long ' + pct(c.qL / c.nL) + '; longer trips: split ' + pct(sp / N) + ', weighted ' + pct(w / N));
  assert(c.sS / c.nS - c.sL / c.nL > 0.06, 'split should show the usual short/long gap');
  assert(Math.abs(c.qS / c.nS - c.qL / c.nL) < 0.03, 'CQR should close the gap at the default seed');
  assert(Math.abs(w / N - 0.91) < 0.02 && Math.abs(sp / N - 0.775) < 0.02, 'weighted and split under shift should be near their averages');
});

// ------------------------------------------------------------- supporting pieces
check('quantile lines put about tau of the training trips below them', function () {
  var r = M.rng(5), tr = M.sampleTrips(r, M.baseShift(), 2000);
  [0.05, 0.5, 0.95].forEach(function (tau) {
    var q = M.fitQuantileLine(tr.xs, tr.ys, tau), below = 0;
    for (var i = 0; i < 2000; i++) if (tr.ys[i] < q.predict(tr.xs[i])) below++;
    assert(Math.abs(below / 2000 - tau) < 0.005, 'tau ' + tau + ': ' + below / 2000);
  });
});

check('CQR under exchangeability covers at the theoretical rate (1000 calibration draws)', function () {
  var reps = 1000, sum = 0;
  for (var i = 0; i < reps; i++) {
    var s = new M.Simulator({ seed: 70000 + i }), h = 0;
    for (var j = 0; j < 20; j++) h += s.step().m.cqr.hit ? 1 : 0;
    sum += h / 20;
  }
  var mean = sum / reps;
  console.log('     CQR coverage ' + pct(mean));
  assert(Math.abs(mean - 0.9) < 0.01);
});

check('the input check reads about 0.5 without shift and well above it with shift', function () {
  var s = new M.Simulator({ seed: 11 });
  for (var i = 0; i < 400; i++) s.step();
  var calm = s.inputAuc;
  s.setTarget('medianKm', SHIFTED); s.jumpToTarget();
  for (i = 0; i < 400; i++) s.step();
  console.log('     AUC without shift ' + calm.toFixed(3) + ', with shift ' + s.inputAuc.toFixed(3));
  assert(calm < 0.56 && s.inputAuc > 0.7);
});

check('concept drift is invisible to the input check', function () {
  var s = new M.Simulator({ seed: 12 });
  s.setTarget('extraPerKm', M.SHIFT.extraPerKm.max); s.jumpToTarget();
  for (var i = 0; i < 400; i++) s.step();
  assert(s.inputAuc < 0.56, 'AUC ' + s.inputAuc);
  assert(s.summary('split').coverage < 0.8);
});

// ------------------------------------------------------------- (e) nothing hard-coded that the model computes
check('(e) the page shows no numbers the model could compute', function () {
  var root = path.join(__dirname, '..');
  var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  var app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  var stage = html.slice(html.indexOf('data-kit-stage'));
  var text = stage.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');
  // No percentages, minutes, kilometres or coverage levels typed into the stage's text.
  var bad = text.match(/\d+(\.\d+)?\s*(%|min\b|km\b|minutes|trips)|0\.\d+/g);
  assert(!bad, 'hard-coded numbers in index.html stage: ' + JSON.stringify(bad));
  // Form controls take their ranges and starting values from the model, not from the HTML.
  assert(!/<input[^>]*type="range"[^>]*\b(value|min|max)=/.test(stage), 'a slider has a hard-coded value/min/max in index.html');
  // app.js must not carry the model's numbers: no target coverage, no z-scores, no quantile rule,
  // and no quoted text with a number followed by a unit.
  var code = app.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  [/\b0?\.9\b/, /\b90\s*%/, /1\.645|1\.96\b/, /Math\.ceil/, /\b2\.5\b/, /\b4\.5\b/, /\b500\b/, /\b300\b/].forEach(function (re) {
    assert(!re.test(code), 'app.js contains ' + re);
  });
  var strings = code.match(/'[^'\n]*'|"[^"\n]*"/g) || [];
  strings.forEach(function (s) {
    assert(!/\d\s*(%|min\b|km\b|trips)/.test(s), 'app.js has a hard-coded number in text: ' + s);
  });
  // Fixes the verifier caught: the gamma slider announces its value, the step-1 text does not
  // assert that coverage always stays inside the range, and the noise readout reports the real
  // change in spread rather than the ratio of the per-km terms.
  assert(!/aria-valuetext',\s*''\)/.test(code), 'gamma slider has an empty aria-valuetext');
  assert(/setAttribute\('aria-valuetext'/.test(code), 'gamma slider never sets aria-valuetext');
  assert(!/stays inside the shaded range/.test(code), 'step-1 copy asserts coverage always stays inside the range');
  assert(/W\.noiseSd\(/.test(code) && !/noisePerKm \+ v\) \/ W\.WORLD\.noisePerKm/.test(code), 'noise readout should use noiseSd');
  // The lede states the promise without a number either.
  var lede = (html.match(/<p class="kit-lede">([\s\S]*?)<\/p>/) || [])[1] || '';
  assert(!/\d/.test(lede.replace(/\b(19|20)\d\d\b/g, '')), 'lede has a number: ' + lede);
});

console.log('\n' + passed + ' checks passed' + (process.exitCode ? ', some FAILED' : ''));
