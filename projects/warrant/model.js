// Warrant model: split conformal prediction and three repairs for when its promise breaks.
// Works in the browser (window.WarrantModel) and in Node (module.exports).
//
// The story: predict how long a delivery takes (minutes) from its distance (km).
// A least-squares line is fitted on past trips, split conformal calibrates a band on
// more past trips, and new trips then stream in, possibly from a shifted world.
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- the world
  // Distance is log-normal; time is a gently curved function of distance plus noise
  // whose spread grows with distance. The fitted model is a straight line, so it is
  // slightly wrong, as real models are.
  var WORLD = {
    medianKm: 2.5,       // median trip distance in the past data
    logSd: 0.5,          // spread of log distance
    base: 8,             // minutes before the courier leaves (pick-up, hand-over)
    perKm: 3,            // minutes per km
    curve: 0.15,         // extra minutes per km^2 (long trips leave the quiet streets)
    noiseBase: 1.5,      // noise sd at zero distance, minutes
    noisePerKm: 0.4      // noise sd grows by this much per km
  };

  // How far each shift control can move the world.
  var SHIFT = {
    medianKm: { min: WORLD.medianKm, max: 4.5 },  // covariate shift: trips get longer
    extraNoisePerKm: { min: 0, max: 0.8 },        // long trips get less predictable
    extraPerKm: { min: 0, max: 2 },               // concept drift: each km takes longer
    noiseRefKm: 5                                 // the page reports the noise change at this distance
  };

  var DEFAULTS = {
    seed: 63,            // chosen as typical, not flattering: see README
    nTrain: 300,         // trips used to fit the line
    nCal: 500,           // trips used to calibrate the band
    alpha: 0.1,          // the promise is coverage 1 - alpha
    gamma: 0.02,         // ACI step size
    recalWindow: 300,    // rolling recalibration uses the most recent labelled trips
    covWindow: 200,      // running coverage is measured over this many trips
    recentWindow: 300,   // trips used to estimate the likelihood ratio and the input check
    refitEvery: 20,      // refit the shift classifier every this many trips
    ramp: 0.02,          // fraction of the remaining gap a shift closes per trip
    maxHistory: 1200
  };

  // split: the band set once from the calibration trips.
  // weighted: weighted conformal for covariate shift.
  // aci: adaptive conformal inference on the fixed calibration scores (Gibbs & Candes's update alone).
  // acir: the same update, with scores taken from the latest recalWindow labelled trips.
  // recal: those latest scores at the fixed level 1 - alpha (gamma = 0): recalibration alone.
  // cqr: conformalised quantile regression.
  var METHODS = ['split', 'weighted', 'aci', 'acir', 'recal', 'cqr'];
  var ADAPTIVE = ['aci', 'acir'];

  // The share of windows the expected range holds when nothing has changed.
  var RANGE_MASS = 0.95;

  // Ranges for the page's controls, so the page carries none of its own.
  var CONTROLS = {
    alpha: { min: 0.02, max: 0.3, step: 0.01 },
    gamma: { min: 0.002, max: 0.1 }
  };

  // ---------------------------------------------------------------- random numbers
  // mulberry32 plus polar Box-Muller: seeded and identical in every JS engine.
  function rng(seed) {
    var a = seed >>> 0;
    var spare = null;
    function next() {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    function normal() {
      if (spare !== null) { var s = spare; spare = null; return s; }
      var u, v, r;
      do { u = 2 * next() - 1; v = 2 * next() - 1; r = u * u + v * v; } while (r === 0 || r >= 1);
      var f = Math.sqrt(-2 * Math.log(r) / r);
      spare = v * f;
      return u * f;
    }
    return { next: next, normal: normal };
  }

  function baseShift() { return { medianKm: WORLD.medianKm, extraNoisePerKm: 0, extraPerKm: 0 }; }

  function trueMean(x, s) { return WORLD.base + (WORLD.perKm + s.extraPerKm) * x + WORLD.curve * x * x; }
  function noiseSd(x, s) { return WORLD.noiseBase + (WORLD.noisePerKm + s.extraNoisePerKm) * x; }
  function sampleX(r, s) { return s.medianKm * Math.exp(WORLD.logSd * r.normal()); }
  function sampleTrip(r, s) {
    var x = sampleX(r, s);
    return { x: x, y: trueMean(x, s) + noiseSd(x, s) * r.normal() };
  }
  function sampleTrips(r, s, n) {
    var xs = new Array(n), ys = new Array(n);
    for (var i = 0; i < n; i++) { var t = sampleTrip(r, s); xs[i] = t.x; ys[i] = t.y; }
    return { xs: xs, ys: ys };
  }

  // True likelihood ratio dP_test/dP_cal at distance x when the median moves from m0 to m1.
  // Both are log-normal with the same spread, so the Jacobians cancel. Returned on the log scale.
  function logLikelihoodRatio(x, m0, m1) {
    var l = Math.log(x), a = Math.log(m0), b = Math.log(m1), s2 = WORLD.logSd * WORLD.logSd;
    return ((l - a) * (l - a) - (l - b) * (l - b)) / (2 * s2);
  }

  // ---------------------------------------------------------------- small linear algebra
  function solve(A, b) {
    var n = b.length, M = A.map(function (row, i) { return row.slice().concat([b[i]]); });
    for (var c = 0; c < n; c++) {
      var p = c;
      for (var r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      var tmp = M[c]; M[c] = M[p]; M[p] = tmp;
      for (r = c + 1; r < n; r++) {
        var f = M[r][c] / M[c][c];
        for (var k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    var x = new Array(n);
    for (var i = n - 1; i >= 0; i--) {
      var s = M[i][n];
      for (var j = i + 1; j < n; j++) s -= M[i][j] * x[j];
      x[i] = s / M[i][i];
    }
    return x;
  }

  // Ordinary least squares line y = a + b x.
  function fitOLS(xs, ys) {
    var n = xs.length, mx = 0, my = 0;
    for (var i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
    mx /= n; my /= n;
    var sxy = 0, sxx = 0;
    for (i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) * (xs[i] - mx); }
    var b = sxy / sxx, a = my - b * mx;
    return { a: a, b: b, predict: function (x) { return a + b * x; } };
  }

  // Linear quantile regression q_tau(x) = a + b x, minimising the pinball loss by the
  // majorise-minimise iteration of Hunter & Lange (2000).
  function fitQuantileLine(xs, ys, tau) {
    var n = xs.length, ols = fitOLS(xs, ys), beta = [ols.a, ols.b];
    var sx = 0; for (var i = 0; i < n; i++) sx += xs[i];
    var eps = 1e-6;
    for (var it = 0; it < 300; it++) {
      var A = [[0, 0], [0, 0]], rhs = [(2 * tau - 1) * n, (2 * tau - 1) * sx];
      for (i = 0; i < n; i++) {
        var r = ys[i] - beta[0] - beta[1] * xs[i];
        var w = 1 / (eps + Math.abs(r));
        A[0][0] += w; A[0][1] += w * xs[i]; A[1][1] += w * xs[i] * xs[i];
        rhs[0] += w * ys[i]; rhs[1] += w * xs[i] * ys[i];
      }
      A[1][0] = A[0][1];
      var nb = solve(A, rhs);
      var moved = Math.abs(nb[0] - beta[0]) + Math.abs(nb[1] - beta[1]);
      beta = nb;
      if (moved < 1e-9) break;
    }
    var a = beta[0], b = beta[1];
    return { a: a, b: b, predict: function (x) { return a + b * x; } };
  }

  // Logistic regression on features [1, l, l^2], l = ln x, by Newton's method with a
  // small ridge on the slope terms. Returns the fitted log-odds function.
  function fitLogistic(xs0, xs1) {
    var rows = [], labels = [];
    function feat(x) { var l = Math.log(x); return [1, l, l * l]; }
    xs0.forEach(function (x) { rows.push(feat(x)); labels.push(0); });
    xs1.forEach(function (x) { rows.push(feat(x)); labels.push(1); });
    var beta = [0, 0, 0], lambda = 1e-3;
    for (var it = 0; it < 30; it++) {
      var H = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], g = [0, 0, 0];
      for (var i = 0; i < rows.length; i++) {
        var f = rows[i], eta = beta[0] * f[0] + beta[1] * f[1] + beta[2] * f[2];
        var p = 1 / (1 + Math.exp(-eta)), w = p * (1 - p), d = labels[i] - p;
        for (var j = 0; j < 3; j++) {
          g[j] += d * f[j];
          for (var k = 0; k < 3; k++) H[j][k] += w * f[j] * f[k];
        }
      }
      for (j = 1; j < 3; j++) { H[j][j] += lambda * rows.length; g[j] -= lambda * rows.length * beta[j]; }
      var step = solve(H, g), moved = 0;
      for (j = 0; j < 3; j++) { beta[j] += step[j]; moved += Math.abs(step[j]); }
      if (moved < 1e-8) break;
    }
    return function (x) { var l = Math.log(x); return beta[0] + beta[1] * l + beta[2] * l * l; };
  }

  // Area under the ROC curve: chance a random row of group 1 scores above one of group 0.
  function auc(s0, s1) {
    var all = [];
    s0.forEach(function (v) { all.push([v, 0]); });
    s1.forEach(function (v) { all.push([v, 1]); });
    all.sort(function (p, q) { return p[0] - q[0]; });
    var rankSum = 0, i = 0;
    while (i < all.length) {
      var j = i;
      while (j + 1 < all.length && all[j + 1][0] === all[i][0]) j++;
      var rank = (i + j) / 2 + 1;
      for (var k = i; k <= j; k++) if (all[k][1] === 1) rankSum += rank;
      i = j + 1;
    }
    var n1 = s1.length, n0 = s0.length;
    return (rankSum - n1 * (n1 + 1) / 2) / (n0 * n1);
  }

  // ---------------------------------------------------------------- conformal quantiles
  // The finite-sample rule: with n calibration scores, take the k-th smallest where
  // k = ceil((n + 1)(1 - alpha)); equivalently the empirical quantile at level
  // ceil((n + 1)(1 - alpha)) / n. If k > n the band must be unbounded; if k < 1 it is empty.
  function conformalRank(n, alpha) {
    // The tiny slack keeps 0.9 * 20 = 18.000000000000004 from rounding up to 19.
    return Math.ceil((n + 1) * (1 - alpha) - 1e-9);
  }
  function conformalLevel(n, alpha) { return conformalRank(n, alpha) / n; }
  function conformalQuantile(sorted, alpha) {
    var n = sorted.length, k = conformalRank(n, alpha);
    if (k > n) return Infinity;
    if (k < 1) return -Infinity;
    return sorted[k - 1];
  }

  // Weighted conformal quantile (Tibshirani, Barber, Candes & Ramdas 2019).
  // sorted: calibration scores ascending; cum[i] = sum of their weights up to i;
  // wTest: weight of the test point, whose own score is placed at +infinity.
  function weightedQuantile(sorted, cum, wTest, alpha) {
    var n = sorted.length, total = cum[n - 1] + wTest, need = (1 - alpha) * total;
    if (cum[n - 1] < need) return Infinity;
    var lo = 0, hi = n - 1;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (cum[mid] >= need) hi = mid; else lo = mid + 1; }
    return sorted[lo];
  }

  // Kish effective sample size of a set of weights.
  function effectiveSize(ws) {
    var s = 0, s2 = 0;
    for (var i = 0; i < ws.length; i++) { s += ws[i]; s2 += ws[i] * ws[i]; }
    return s * s / s2;
  }

  // ---------------------------------------------------------------- the expected range
  function lgamma(z) {
    var g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
      -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
    z -= 1;
    var x = c[0];
    for (var i = 1; i < g + 2; i++) x += c[i] / (z + i);
    var t = z + g + 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
  }
  function lbeta(a, b) { return lgamma(a) + lgamma(b) - lgamma(a + b); }

  // Under exchangeability, split conformal's coverage given its calibration set is
  // Beta(k, n + 1 - k) with k = ceil((n + 1)(1 - alpha)) (continuous scores). The number
  // of covered trips among W new ones is then beta-binomial. Returns the central range
  // holding probability `mass`, as fractions of W.
  var rangeCache = {};
  function coverageRange(W, n, alpha, mass) {
    mass = mass || RANGE_MASS;
    var key = W + '|' + n + '|' + alpha + '|' + mass;
    if (rangeCache[key]) return rangeCache[key];
    var k = conformalRank(n, alpha), out;
    if (k > n) out = { lo: 1, hi: 1, mean: 1 };
    else {
      var a = k, b = n + 1 - k, lb = lbeta(a, b), lw = lgamma(W + 1), cdf = 0, lo = null, hi = null;
      var tail = (1 - mass) / 2;
      for (var j = 0; j <= W; j++) {
        cdf += Math.exp(lw - lgamma(j + 1) - lgamma(W - j + 1) + lbeta(j + a, W - j + b) - lb);
        if (lo === null && cdf > tail) lo = j;
        if (hi === null && cdf >= 1 - tail) hi = j;
      }
      if (hi === null) hi = W;
      out = { lo: lo / W, hi: hi / W, mean: a / (a + b) };
    }
    rangeCache[key] = out;
    return out;
  }

  // Gibbs & Candes (2021), Proposition 4.1: for every T,
  // |(1/T) sum err_t - alpha| <= (max(alpha_1, 1 - alpha_1) + gamma) / (gamma T).
  function aciBound(alpha1, gamma, T) { return (Math.max(alpha1, 1 - alpha1) + gamma) / (gamma * T); }

  // ---------------------------------------------------------------- sorted multiset
  function insertSorted(arr, v) {
    var lo = 0, hi = arr.length;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (arr[mid] < v) lo = mid + 1; else hi = mid; }
    arr.splice(lo, 0, v);
  }
  function removeSorted(arr, v) {
    var lo = 0, hi = arr.length;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (arr[mid] < v) lo = mid + 1; else hi = mid; }
    if (arr[lo] === v) arr.splice(lo, 1);
  }
  function median(arr) {
    if (!arr.length) return NaN;
    var s = arr.slice().sort(function (a, b) { return a - b; }), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  // ---------------------------------------------------------------- the simulator
  // Fits once, then streams trips. Every method sees the same trips, so they can be compared.
  function Simulator(opts) {
    var o = {}, key;
    for (key in DEFAULTS) o[key] = DEFAULTS[key];
    for (key in (opts || {})) o[key] = opts[key];
    this.o = o;
    this.r = rng(o.seed);
    var base = baseShift();
    this.train = sampleTrips(this.r, base, o.nTrain);
    this.cal = sampleTrips(this.r, base, o.nCal);
    this.model = fitOLS(this.train.xs, this.train.ys);
    this.calMedianKm = median(this.cal.xs);

    // Calibration scores |y - yhat|, sorted, with the distance of each kept in the same order.
    var model = this.model, cal = this.cal, idx = [];
    for (var i = 0; i < o.nCal; i++) idx.push(i);
    var res = cal.xs.map(function (x, i2) { return Math.abs(cal.ys[i2] - model.predict(x)); });
    idx.sort(function (p, q) { return res[p] - res[q]; });
    this.calScores = idx.map(function (j) { return res[j]; });
    this.calScoreXs = idx.map(function (j) { return cal.xs[j]; });

    this.cur = baseShift();
    this.target = baseShift();
    this.weightMode = 'true';
    this.t = 0;
    this.recentXs = [];
    this.estLogW = null;
    this.inputAuc = null;
    this.sinceRefit = 0;
    this.trueCumKey = null;
    this.setAlpha(o.alpha);
  }

  Simulator.prototype.setAlpha = function (alpha) {
    var o = this.o;
    this.alpha = alpha;
    this.splitQ = conformalQuantile(this.calScores, alpha);
    // CQR: quantile lines at alpha/2 and 1 - alpha/2 on the training trips, conformalised on calibration.
    this.qLo = fitQuantileLine(this.train.xs, this.train.ys, alpha / 2);
    this.qHi = fitQuantileLine(this.train.xs, this.train.ys, 1 - alpha / 2);
    var qLo = this.qLo, qHi = this.qHi, cal = this.cal;
    var cs = cal.xs.map(function (x, i) { return Math.max(qLo.predict(x) - cal.ys[i], cal.ys[i] - qHi.predict(x)); });
    cs.sort(function (a, b) { return a - b; });
    this.cqrScores = cs;
    this.cqrQ = conformalQuantile(cs, alpha);
    this.resetStream();
  };

  // Clears the record of new trips and restarts ACI. The world and its shift stay as they are.
  Simulator.prototype.resetStream = function () {
    var o = this.o;
    this.history = [];
    this.windows = {};
    var self = this;
    METHODS.forEach(function (m) { self.windows[m] = { hits: [], sum: 0 }; });
    this.resetAdaptive();
    // The rolling window starts as the last o.recalWindow calibration trips, in the order they were drawn.
    this.recentQueue = this.cal.xs.map(function (x, i) { return Math.abs(self.cal.ys[i] - self.model.predict(x)); });
    if (this.recentQueue.length > o.recalWindow) this.recentQueue = this.recentQueue.slice(this.recentQueue.length - o.recalWindow);
    this.recentScores = this.recentQueue.slice().sort(function (a, b) { return a - b; });
  };

  // Each ACI variant keeps its own alpha_t, driven by its own misses.
  Simulator.prototype.resetAdaptive = function () {
    var self = this;
    this.adapt = {};
    ADAPTIVE.forEach(function (m) { self.adapt[m] = { alpha: self.alpha, misses: 0, T: 0, maxDev: 0 }; });
  };

  Simulator.prototype.setTarget = function (name, value) { this.target[name] = value; };
  Simulator.prototype.jumpToTarget = function () { for (var k in this.target) this.cur[k] = this.target[k]; };
  Simulator.prototype.setGamma = function (g) { this.o.gamma = g; this.resetAdaptive(); };
  Simulator.prototype.setWeightMode = function (m) { this.weightMode = m; };

  // Weights for the calibration trips (in score order) and for a test distance x.
  Simulator.prototype.trueCum = function () {
    var key = this.cur.medianKm;
    if (this.trueCumKey === key) return this.trueCumArr;
    var m0 = WORLD.medianKm, m1 = key, xs = this.calScoreXs, cum = new Array(xs.length), s = 0;
    for (var i = 0; i < xs.length; i++) { s += Math.exp(logLikelihoodRatio(xs[i], m0, m1)); cum[i] = s; }
    this.trueCumKey = key; this.trueCumArr = cum;
    return cum;
  };
  Simulator.prototype.estCum = function () {
    if (!this.estLogW) return null;
    if (this.estCumArr) return this.estCumArr;
    var f = this.estLogW, xs = this.calScoreXs, cum = new Array(xs.length), s = 0;
    for (var i = 0; i < xs.length; i++) { s += Math.exp(f(xs[i])); cum[i] = s; }
    this.estCumArr = cum;
    return cum;
  };
  Simulator.prototype.testWeight = function (x, mode) {
    if (mode === 'estimated') return this.estLogW ? Math.exp(this.estLogW(x)) : 1;
    return Math.exp(logLikelihoodRatio(x, WORLD.medianKm, this.cur.medianKm));
  };
  Simulator.prototype.weightedQ = function (x, mode) {
    mode = mode || this.weightMode;
    var cum = mode === 'estimated' ? this.estCum() : this.trueCum();
    if (!cum) return this.splitQ; // nothing estimated yet: all weights equal
    return weightedQuantile(this.calScores, cum, this.testWeight(x, mode), this.alpha);
  };
  Simulator.prototype.effectiveCalSize = function (mode) {
    mode = mode || this.weightMode;
    var cum = mode === 'estimated' ? this.estCum() : this.trueCum();
    if (!cum) return this.calScores.length;
    var ws = cum.map(function (c, i) { return i ? c - cum[i - 1] : c; });
    return effectiveSize(ws);
  };

  Simulator.prototype.refitClassifier = function () {
    if (this.recentXs.length < 50) { this.estLogW = null; this.estCumArr = null; this.inputAuc = null; return; }
    var f = fitLogistic(this.cal.xs, this.recentXs);
    this.estLogW = f;
    this.estCumArr = null;
    this.inputAuc = auc(this.cal.xs.map(f), this.recentXs.map(f));
  };

  // The band each method would give at distance x right now: [lo, hi].
  Simulator.prototype.band = function (method, x) {
    var yhat = this.model.predict(x), q;
    if (method === 'split') q = this.splitQ;
    else if (method === 'weighted') q = this.weightedQ(x);
    else if (method === 'aci') q = conformalQuantile(this.calScores, this.adapt.aci.alpha);
    else if (method === 'acir') q = conformalQuantile(this.recentScores, this.adapt.acir.alpha);
    else if (method === 'recal') q = conformalQuantile(this.recentScores, this.alpha);
    else if (method === 'cqr') return [this.qLo.predict(x) - this.cqrQ, this.qHi.predict(x) + this.cqrQ];
    if (q === -Infinity) return [NaN, NaN]; // empty band
    return [yhat - q, yhat + q];
  };

  Simulator.prototype.step = function () {
    var o = this.o, k;
    for (k in this.target) this.cur[k] += (this.target[k] - this.cur[k]) * o.ramp;
    var trip = sampleTrip(this.r, this.cur), x = trip.x, y = trip.y;
    var rec = { t: this.t, x: x, y: y, m: {} };
    var self = this;

    METHODS.forEach(function (m) {
      var b = self.band(m, x);
      var hit = b[0] <= y && y <= b[1];   // NaN (empty band) compares false: a miss
      var w = self.windows[m];
      w.hits.push(hit ? 1 : 0); w.sum += hit ? 1 : 0;
      if (w.hits.length > o.covWindow) w.sum -= w.hits.shift();
      rec.m[m] = { lo: b[0], hi: b[1], hit: hit, cov: w.sum / w.hits.length, width: b[1] - b[0] };
    });
    rec.alphaT = {};

    // ACI: the outcome is revealed and each variant's alpha_t moves by its own error.
    ADAPTIVE.forEach(function (m) {
      var a = self.adapt[m], err = rec.m[m].hit ? 0 : 1;
      rec.alphaT[m] = a.alpha;
      a.T++; a.misses += err;
      a.alpha += o.gamma * (self.alpha - err);
      a.maxDev = Math.max(a.maxDev, Math.abs(a.misses / a.T - self.alpha) - aciBound(self.alpha, o.gamma, a.T));
    });
    // The labelled trip enters the rolling window used by 'acir' and 'recal'.
    var score = Math.abs(y - this.model.predict(x));
    this.recentQueue.push(score); insertSorted(this.recentScores, score);
    if (this.recentQueue.length > o.recalWindow) removeSorted(this.recentScores, this.recentQueue.shift());

    // Unlabelled inputs for the likelihood-ratio estimate and the input check.
    this.recentXs.push(x);
    if (this.recentXs.length > o.recentWindow) this.recentXs.shift();
    if (++this.sinceRefit >= o.refitEvery) { this.sinceRefit = 0; this.refitClassifier(); }

    this.history.push(rec);
    if (this.history.length > o.maxHistory) this.history.shift();
    this.t++;
    return rec;
  };

  // A summary of the recent stream for one method, everything computed from the record.
  Simulator.prototype.summary = function (method) {
    var o = this.o, h = this.history, n = Math.min(h.length, o.covWindow);
    var recent = h.slice(h.length - n), widths = [], shortHit = 0, shortN = 0, longHit = 0, longN = 0, unbounded = 0;
    var cut = this.calMedianKm;
    recent.forEach(function (r) {
      var m = r.m[method];
      if (isFinite(m.width)) widths.push(m.width); else if (m.width === Infinity) unbounded++;
      if (r.x < cut) { shortN++; shortHit += m.hit ? 1 : 0; } else { longN++; longHit += m.hit ? 1 : 0; }
    });
    var win = this.windows[method], ad = this.adapt[method];
    return {
      n: n,
      coverage: n ? win.sum / win.hits.length : NaN,
      target: 1 - this.alpha,
      range: n ? coverageRange(n, this.calScores.length, this.alpha) : null,
      medianWidth: median(widths),
      unbounded: unbounded,
      shortCov: shortN ? shortHit / shortN : NaN, shortN: shortN,
      longCov: longN ? longHit / longN : NaN, longN: longN,
      cutKm: cut,
      inputAuc: this.inputAuc,
      aciMissRate: ad && ad.T ? ad.misses / ad.T : NaN,
      aciT: ad ? ad.T : 0,
      aciBound: ad && ad.T ? aciBound(this.alpha, o.gamma, ad.T) : NaN,
      aciAlpha: ad ? ad.alpha : NaN
    };
  };

  var api = {
    WORLD: WORLD, SHIFT: SHIFT, DEFAULTS: DEFAULTS, METHODS: METHODS, ADAPTIVE: ADAPTIVE, CONTROLS: CONTROLS,
    RANGE_MASS: RANGE_MASS,
    rng: rng, baseShift: baseShift, trueMean: trueMean, noiseSd: noiseSd,
    sampleX: sampleX, sampleTrip: sampleTrip, sampleTrips: sampleTrips,
    logLikelihoodRatio: logLikelihoodRatio,
    fitOLS: fitOLS, fitQuantileLine: fitQuantileLine, fitLogistic: fitLogistic, auc: auc,
    conformalRank: conformalRank, conformalLevel: conformalLevel, conformalQuantile: conformalQuantile,
    weightedQuantile: weightedQuantile, effectiveSize: effectiveSize,
    coverageRange: coverageRange, aciBound: aciBound, median: median,
    Simulator: Simulator
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WarrantModel = api;
})(typeof self !== 'undefined' ? self : this);
