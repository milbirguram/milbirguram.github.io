// Mirage model: a null study generator, three hypothesis tests, and the garden of
// 486 analysis paths. No DOM here. Works in the browser (window.Mirage) and in Node
// (module.exports) so it can be tested headlessly.
(function (root) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Seeded randomness
  // ---------------------------------------------------------------------------

  // Mix two integers into a well-spread 32-bit seed (a small integer hash).
  function hashSeed(a, b) {
    var h = (a ^ 0x9e3779b9) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = (h + Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35)) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x165667b1) >>> 0;
    return (h ^ (h >>> 15)) >>> 0;
  }

  // mulberry32: a small, fast 32-bit PRNG with good statistical quality for simulation.
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Standard normal deviates by the Box-Muller transform (both values are used).
  function normalSource(rand) {
    var spare = null;
    return function () {
      if (spare !== null) { var s = spare; spare = null; return s; }
      var u = 0;
      while (u <= 0) u = rand();
      var v = rand();
      var r = Math.sqrt(-2 * Math.log(u));
      spare = r * Math.sin(2 * Math.PI * v);
      return r * Math.cos(2 * Math.PI * v);
    };
  }

  // ---------------------------------------------------------------------------
  // Special functions
  // ---------------------------------------------------------------------------

  var LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];

  // log Gamma(x) for x > 0 (Lanczos approximation, g = 7).
  function lgamma(x) {
    if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
    x -= 1;
    var a = LANCZOS[0];
    var t = x + 7.5;
    for (var i = 1; i < 9; i++) a += LANCZOS[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }

  // Continued fraction for the incomplete beta function (modified Lentz).
  function betacf(a, b, x) {
    var FPMIN = 1e-300, EPS = 1e-15;
    var qab = a + b, qap = a + 1, qam = a - 1;
    var c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    var h = d;
    for (var m = 1; m <= 500; m++) {
      var m2 = 2 * m;
      var aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      var del = d * c;
      h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }

  // Regularized incomplete beta function I_x(a, b).
  function betai(a, b, x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    var bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    if (x < (a + 1) / (a + b + 2)) return bt * betacf(a, b, x) / a;
    return 1 - bt * betacf(b, a, 1 - x) / b;
  }

  // Two-sided p-value for Student's t with df degrees of freedom.
  // P(|T| > |t|) = I_{df/(df+t^2)}(df/2, 1/2).
  function tTwoSided(t, df) {
    if (!isFinite(t)) return isNaN(t) ? 1 : 0;
    if (!(df > 0)) return 1;
    return Math.min(1, betai(df / 2, 0.5, df / (df + t * t)));
  }

  // Regularized upper incomplete gamma Q(a, x), used for the normal tail.
  function gammq(a, x) {
    if (x <= 0) return 1;
    var gln = lgamma(a);
    if (x < a + 1) {
      var ap = a, sum = 1 / a, del = sum;
      for (var n = 0; n < 500; n++) {
        ap += 1; del *= x / ap; sum += del;
        if (Math.abs(del) < Math.abs(sum) * 1e-16) break;
      }
      return 1 - sum * Math.exp(-x + a * Math.log(x) - gln);
    }
    var FPMIN = 1e-300;
    var b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
    for (var i = 1; i < 500; i++) {
      var an = -i * (i - a);
      b += 2;
      d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      var dl = d * c;
      h *= dl;
      if (Math.abs(dl - 1) < 1e-16) break;
    }
    return Math.exp(-x + a * Math.log(x) - gln) * h;
  }

  // Standard normal upper tail P(Z > z), via erfc(x) = Q(1/2, x^2).
  function normSf(z) {
    if (z < 0) return 1 - normSf(-z);
    return 0.5 * gammq(0.5, z * z / 2);
  }
  function normCdf(z) { return 1 - normSf(z); }

  // Inverse standard normal CDF (Acklam's rational approximation plus one Halley step).
  function normInv(p) {
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    var a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    var b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    var c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    var d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    var q, r, x;
    if (p < 0.02425) {
      q = Math.sqrt(-2 * Math.log(p));
      x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    } else if (p > 1 - 0.02425) {
      q = Math.sqrt(-2 * Math.log(1 - p));
      x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    } else {
      q = p - 0.5; r = q * q;
      x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    }
    var e = normCdf(x) - p;
    var u = e * Math.sqrt(2 * Math.PI) * Math.exp(x * x / 2);
    return x - u / (1 + x * u / 2);
  }

  // ---------------------------------------------------------------------------
  // Tests. Each takes plain arrays (or typed arrays) of numbers.
  // ---------------------------------------------------------------------------

  function meanVar(a) {
    var n = a.length, m = 0, i;
    for (i = 0; i < n; i++) m += a[i];
    m /= n;
    var s = 0;
    for (i = 0; i < n; i++) { var d = a[i] - m; s += d * d; }
    return { n: n, mean: m, v: n > 1 ? s / (n - 1) : 0 };
  }

  // Welch's unequal-variance t-test. diff = mean(a) - mean(b).
  function welch(a, b) {
    var A = meanVar(a), B = meanVar(b);
    var va = A.v / A.n, vb = B.v / B.n;
    var se = Math.sqrt(va + vb);
    var diff = A.mean - B.mean;
    if (!(se > 0) || A.n < 2 || B.n < 2) return { t: 0, df: NaN, p: 1, diff: diff };
    var t = diff / se;
    var df = (va + vb) * (va + vb) / (va * va / (A.n - 1) + vb * vb / (B.n - 1));
    return { t: t, df: df, p: tTwoSided(t, df), diff: diff };
  }

  // Mann-Whitney U test, normal approximation with tie correction and a 0.5 continuity
  // correction (the defaults of R's wilcox.test and scipy's mannwhitneyu, asymptotic).
  // U is the statistic for sample a; z > 0 when a tends to be larger.
  function mannWhitney(a, b, opts) {
    var useCC = !(opts && opts.continuity === false);
    var n1 = a.length, n2 = b.length, N = n1 + n2;
    if (n1 < 1 || n2 < 1) return { U: 0, z: 0, p: 1 };
    // Sort a copy of the pooled values (native numeric sort), then find each value's
    // average rank by binary search: ties share the mean of the ranks they span.
    var sorted = new Float64Array(N), i;
    for (i = 0; i < n1; i++) sorted[i] = a[i];
    for (i = 0; i < n2; i++) sorted[n1 + i] = b[i];
    sorted.sort();
    var r1 = 0, tieSum = 0;
    for (i = 0; i < n1; i++) {
      var lo = lowerBound(sorted, a[i]), hi = upperBound(sorted, a[i]);
      r1 += (lo + hi + 1) / 2; // ranks lo+1 .. hi, 1-based
    }
    i = 0;
    while (i < N) {
      var j = i;
      while (j + 1 < N && sorted[j + 1] === sorted[i]) j++;
      var tcount = j - i + 1;
      if (tcount > 1) tieSum += tcount * tcount * tcount - tcount;
      i = j + 1;
    }
    var U = r1 - n1 * (n1 + 1) / 2;
    var mu = n1 * n2 / 2;
    var sigma2 = n1 * n2 / 12 * ((N + 1) - tieSum / (N * (N - 1)));
    if (!(sigma2 > 0)) return { U: U, z: 0, p: 1 };
    var dev = U - mu;
    var adj = useCC ? Math.max(0, Math.abs(dev) - 0.5) : Math.abs(dev);
    var z = (dev < 0 ? -1 : 1) * adj / Math.sqrt(sigma2);
    return { U: U, z: z, p: Math.min(1, 2 * normSf(Math.abs(z))) };
  }

  function lowerBound(arr, v) { var lo = 0, hi = arr.length; while (lo < hi) { var m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; } return lo; }
  function upperBound(arr, v) { var lo = 0, hi = arr.length; while (lo < hi) { var m = (lo + hi) >> 1; if (arr[m] <= v) lo = m + 1; else hi = m; } return lo; }

  // Ordinary least squares y = b0 + b1*g + b2*x (x optional), with the t-test on b1.
  // Uses the Frisch-Waugh-Lovell route: residualise y and g on x, then regress.
  function ols(y, g, x) {
    var n = y.length, i;
    var yr = new Float64Array(n), gr = new Float64Array(n);
    var k; // number of parameters
    if (x) {
      residualise(y, x, yr);
      residualise(g, x, gr);
      k = 3;
    } else {
      var my = 0, mg = 0;
      for (i = 0; i < n; i++) { my += y[i]; mg += g[i]; }
      my /= n; mg /= n;
      for (i = 0; i < n; i++) { yr[i] = y[i] - my; gr[i] = g[i] - mg; }
      k = 2;
    }
    var sgg = 0, sgy = 0;
    for (i = 0; i < n; i++) { sgg += gr[i] * gr[i]; sgy += gr[i] * yr[i]; }
    var df = n - k;
    if (!(sgg > 0) || df < 1) return { b: 0, se: NaN, t: 0, df: df, p: 1 };
    var b = sgy / sgg, rss = 0;
    for (i = 0; i < n; i++) { var e = yr[i] - b * gr[i]; rss += e * e; }
    var se = Math.sqrt(rss / df / sgg);
    if (!(se > 0)) return { b: b, se: se, t: 0, df: df, p: 1 };
    var t = b / se;
    return { b: b, se: se, t: t, df: df, p: tTwoSided(t, df) };
  }

  // Residuals of v regressed on x (with intercept). Writes into out.
  function residualise(v, x, out) {
    var n = v.length, mv = 0, mx = 0, i;
    for (i = 0; i < n; i++) { mv += v[i]; mx += x[i]; }
    mv /= n; mx /= n;
    var sxx = 0, sxv = 0;
    for (i = 0; i < n; i++) { var dx = x[i] - mx; sxx += dx * dx; sxv += dx * (v[i] - mv); }
    var slope = sxx > 0 ? sxv / sxx : 0;
    out = out || new Float64Array(n);
    for (i = 0; i < n; i++) out[i] = v[i] - mv - slope * (x[i] - mx);
    return out;
  }

  // ---------------------------------------------------------------------------
  // The study: n participants, two randomised groups, nothing connects them.
  // ---------------------------------------------------------------------------

  var N_DEFAULT = 120;

  // Every participant's measurements are drawn first, from one random stream, without any
  // reference to a group. Group labels are then dealt by a shuffle from a second,
  // separate stream. So the labels are independent of every outcome and covariate.
  function generateStudy(seed, n) {
    n = n || N_DEFAULT;
    var rand = rng(hashSeed(seed, 1));
    var gauss = normalSource(rand);
    var age = new Float64Array(n), sleep = new Float64Array(n), attnFail = new Uint8Array(n);
    var q = new Float64Array(n), r = new Float64Array(n), d = new Float64Array(n);
    for (var i = 0; i < n; i++) {
      age[i] = 20 + Math.floor(rand() * 40);                       // 20-59, uniform
      var zs = gauss();
      sleep[i] = Math.round((7 + 1.1 * zs) * 4) / 4;              // hours, to the quarter
      if (sleep[i] < 3) sleep[i] = 3;
      attnFail[i] = rand() < 0.07 ? 1 : 0;                         // failed the check item
      // A latent mood trait, partly tied to sleep (true in life, and it makes the
      // covariate fork matter). The three measures share it, as real mood measures do.
      var mood = 0.4 * zs + Math.sqrt(1 - 0.16) * gauss();
      var e1 = gauss(), e2 = gauss(), e3 = gauss();
      q[i] = clamp(Math.round(31 + 7 * (0.75 * mood + 0.66 * e1)), 10, 50);               // 10-50 questionnaire
      r[i] = clamp(Math.round(6 + 1.9 * (0.7 * mood + 0.71 * e2)), 0, 10);                 // 0-10 single rating
      d[i] = clamp(Math.round((4.3 + 0.9 * (0.65 * mood + 0.76 * e3)) * 10) / 10, 1, 7);  // 1-7 diary average
    }
    var group = new Uint8Array(n);
    var gRand = rng(hashSeed(seed, 2));
    var order = [];
    for (i = 0; i < n; i++) order.push(i);
    for (i = n - 1; i > 0; i--) { var j = Math.floor(gRand() * (i + 1)); var tmp = order[i]; order[i] = order[j]; order[j] = tmp; }
    for (i = 0; i < n / 2; i++) group[order[i]] = 1;               // 1 = walked, 0 = usual routine
    return { seed: seed, n: n, group: group, age: age, sleep: sleep, attnFail: attnFail, outcomes: [q, r, d] };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // ---------------------------------------------------------------------------
  // The forks. Option 0 of every fork is the plain, pre-registered choice.
  // ---------------------------------------------------------------------------

  var FORKS = [
    { id: 'outcome', title: 'Outcome', question: 'Which measure of mood?', options: [
      { label: 'Questionnaire score', short: 'questionnaire', why: 'The ten-item mood scale everyone filled in. The obvious primary measure.' },
      { label: 'Single 0–10 rating', short: '0–10 rating', why: 'One direct question about today’s mood. Less fatigue, less noise from item wording.' },
      { label: 'Two-week diary average', short: 'diary', why: 'Averaged over fourteen evenings, so less swayed by one bad morning.' }
    ] },
    { id: 'transform', title: 'Scale', question: 'Transform the scores?', options: [
      { label: 'Keep them raw', short: 'raw', why: 'The numbers as recorded. Easiest to explain.' },
      { label: 'Log-transform', short: 'log', why: 'Mood scores bunch and skew; a log can make the two groups’ spreads more alike.' }
    ] },
    { id: 'exclude', title: 'Exclusions', question: 'Leave anyone out?', options: [
      { label: 'Keep everyone', short: 'no exclusions', why: 'Everyone was randomised. Dropping people can bias the comparison.' },
      { label: 'Drop scores beyond 2.5 SD', short: 'drop > 2.5 SD', why: 'A standard rule so that a few extreme values do not dominate the means.' },
      { label: 'Drop failed attention checks', short: 'drop inattentive', why: 'Someone who failed the check item may not have read the questions.' }
    ] },
    { id: 'subgroup', title: 'Who', question: 'Whom to compare?', options: [
      { label: 'Everyone', short: 'everyone', why: 'The question was about adults in general.' },
      { label: 'Under 40', short: 'under 40', why: 'Younger routines are more flexible; a walk may change more for them.' },
      { label: '40 and over', short: '40 and over', why: 'Gentle exercise may matter more with age.' }
    ] },
    { id: 'covariate', title: 'Adjustment', question: 'Adjust for anything?', options: [
      { label: 'No adjustment', short: 'unadjusted', why: 'Randomisation already balances the groups on average.' },
      { label: 'Adjust for age', short: 'adjust for age', why: 'Mood shifts with age; accounting for it can sharpen the comparison.' },
      { label: 'Adjust for last night’s sleep', short: 'adjust for sleep', why: 'Sleep strongly predicts next-day mood. Removing it removes noise.' }
    ] },
    { id: 'test', title: 'Test', question: 'Which test?', options: [
      { label: 'Welch t-test', short: 'Welch t', why: 'Compares the two means without assuming equal spreads.' },
      { label: 'Mann–Whitney U', short: 'Mann–Whitney', why: 'Compares ranks, so skew and outliers matter less.' },
      { label: 'Linear regression', short: 'regression', why: 'Estimates the group difference with any adjustment built into the model.' }
    ] }
  ];
  var RADIX = FORKS.map(function (f) { return f.options.length; });
  var N_PATHS = RADIX.reduce(function (a, b) { return a * b; }, 1);
  var PREREG = [0, 0, 0, 0, 0, 0];
  var ALPHA = 0.05;

  function pathIndex(choices) {
    var idx = 0;
    for (var k = 0; k < RADIX.length; k++) idx = idx * RADIX[k] + choices[k];
    return idx;
  }
  function pathChoices(idx) {
    var out = new Array(RADIX.length);
    for (var k = RADIX.length - 1; k >= 0; k--) { out[k] = idx % RADIX[k]; idx = Math.floor(idx / RADIX[k]); }
    return out;
  }

  // The analysed outcome after the outcome and scale forks.
  function outcomeValues(study, c0, c1) {
    var src = study.outcomes[c0];
    if (c1 === 0) return src;
    var out = new Float64Array(study.n);
    var shift = c0 === 1 ? 1 : 0; // the 0-10 rating can be zero, so log(x + 1)
    for (var i = 0; i < study.n; i++) out[i] = Math.log(src[i] + shift);
    return out;
  }

  // Which participants survive the exclusion and subgroup forks.
  function includedMask(study, y, c2, c3) {
    var n = study.n, keep = new Uint8Array(n), i;
    var lo = -Infinity, hi = Infinity;
    if (c2 === 1) {
      var mv = meanVar(y), sd = Math.sqrt(mv.v);
      lo = mv.mean - 2.5 * sd; hi = mv.mean + 2.5 * sd;
    }
    for (i = 0; i < n; i++) {
      var ok = true;
      if (c2 === 1 && (y[i] < lo || y[i] > hi)) ok = false;
      if (c2 === 2 && study.attnFail[i]) ok = false;
      if (c3 === 1 && !(study.age[i] < 40)) ok = false;
      if (c3 === 2 && !(study.age[i] >= 40)) ok = false;
      keep[i] = ok ? 1 : 0;
    }
    return keep;
  }

  // Run the last two forks (adjustment and test) on one analysed subset.
  // Returns { p, sign } where sign > 0 means the walking group scored higher.
  function runTest(y, g, cov, c5) {
    var n = y.length, i;
    if (c5 === 2) {
      var fit = ols(y, g, cov);
      return { p: fit.p, sign: fit.b > 0 ? 1 : fit.b < 0 ? -1 : 0, stat: fit.t };
    }
    var v = cov ? residualise(y, cov) : y; // Welch or Mann-Whitney on covariate-adjusted scores
    var a = [], b = [];
    for (i = 0; i < n; i++) (g[i] ? a : b).push(v[i]);
    if (c5 === 0) {
      var w = welch(a, b);
      return { p: w.p, sign: w.diff > 0 ? 1 : w.diff < 0 ? -1 : 0, stat: w.t };
    }
    var m = mannWhitney(a, b);
    return { p: m.p, sign: m.z > 0 ? 1 : m.z < 0 ? -1 : 0, stat: m.z };
  }

  function subset(arr, keep, count) {
    var out = new Float64Array(count), j = 0;
    for (var i = 0; i < keep.length; i++) if (keep[i]) out[j++] = arr[i];
    return out;
  }

  // One path, computed directly.
  function analysePath(study, choices) {
    var y = outcomeValues(study, choices[0], choices[1]);
    var keep = includedMask(study, y, choices[2], choices[3]);
    var count = 0, n1 = 0;
    for (var i = 0; i < keep.length; i++) if (keep[i]) { count++; if (study.group[i]) n1++; }
    var ys = subset(y, keep, count), gs = subset(study.group, keep, count);
    var cov = choices[4] === 1 ? subset(study.age, keep, count) : choices[4] === 2 ? subset(study.sleep, keep, count) : null;
    var res = runTest(ys, gs, cov, choices[5]);
    res.n = count; res.n1 = n1; res.n0 = count - n1;
    return res;
  }

  // All paths for one study. p[i] and sign[i] are indexed by pathIndex.
  function garden(study) {
    var p = new Float64Array(N_PATHS), sign = new Int8Array(N_PATHS);
    for (var c0 = 0; c0 < RADIX[0]; c0++) for (var c1 = 0; c1 < RADIX[1]; c1++) {
      var y = outcomeValues(study, c0, c1);
      for (var c2 = 0; c2 < RADIX[2]; c2++) for (var c3 = 0; c3 < RADIX[3]; c3++) {
        var keep = includedMask(study, y, c2, c3), count = 0;
        for (var i = 0; i < keep.length; i++) count += keep[i];
        var ys = subset(y, keep, count), gs = subset(study.group, keep, count);
        var covs = [null, subset(study.age, keep, count), subset(study.sleep, keep, count)];
        for (var c4 = 0; c4 < RADIX[4]; c4++) for (var c5 = 0; c5 < RADIX[5]; c5++) {
          var idx = pathIndex([c0, c1, c2, c3, c4, c5]);
          var r = runTest(ys, gs, covs[c4], c5);
          p[idx] = r.p; sign[idx] = r.sign;
        }
      }
    }
    var nSig = 0;
    for (var k = 0; k < N_PATHS; k++) if (p[k] < ALPHA) nSig++;
    return { p: p, sign: sign, nSig: nSig };
  }

  // A walker who peeks: at each fork, take the option whose p-value is lowest when the
  // forks still ahead are left at their plain defaults. This mirrors the page's peek mode.
  function peekingWalk(g, upTo) {
    var choices = PREREG.slice();
    var last = upTo == null ? RADIX.length : upTo;
    for (var k = 0; k < last; k++) {
      var best = 0, bestP = Infinity;
      for (var o = 0; o < RADIX[k]; o++) {
        choices[k] = o;
        var pv = g.p[pathIndex(choices)];
        if (pv < bestP) { bestP = pv; best = o; }
      }
      choices[k] = best;
    }
    return choices;
  }

  // One complete null study, analysed three ways.
  function runStudy(seed) {
    var g = garden(generateStudy(seed));
    var walk = peekingWalk(g);
    return {
      any: g.nSig > 0,
      nSig: g.nSig,
      prereg: g.p[pathIndex(PREREG)] < ALPHA,
      peeker: g.p[pathIndex(walk)] < ALPHA
    };
  }

  function studySeed(runSeed, i) { return hashSeed(runSeed, i + 1000); }

  // Many null studies. Every share is counted from simulated data; nothing is assumed.
  function simulate(count, runSeed) {
    var out = { count: count, any: 0, prereg: 0, peeker: 0, sigPaths: 0 };
    for (var i = 0; i < count; i++) {
      var s = runStudy(studySeed(runSeed, i));
      if (s.any) out.any++;
      if (s.prereg) out.prereg++;
      if (s.peeker) out.peeker++;
      out.sigPaths += s.nSig;
    }
    return out;
  }

  // The p-value after each step of a walk, with the forks still ahead left at their plain
  // defaults: trail[0] is the plain analysis, trail[k] is the p after k decisions.
  function walkTrail(g, walk) {
    var trail = [], ch = PREREG.slice();
    trail.push(g.p[pathIndex(ch)]);
    for (var k = 0; k < walk.length; k++) { ch[k] = walk[k]; trail.push(g.p[pathIndex(ch)]); }
    return trail;
  }

  // The decision (1-based) at which a walk first reaches p < ALPHA, or 0 if it never does.
  function firstCrossing(g, walk) {
    var trail = walkTrail(g, walk);
    for (var k = 1; k < trail.length; k++) if (trail[k] < ALPHA) return k;
    return 0;
  }

  // How many paths that differ from the plain path at exactly one fork are significant.
  function singleChangeHits(g) {
    var c = 0;
    for (var k = 0; k < RADIX.length; k++) for (var o = 0; o < RADIX[k]; o++) {
      if (o === PREREG[k]) continue;
      var ch = PREREG.slice(); ch[k] = o;
      if (g.p[pathIndex(ch)] < ALPHA) c++;
    }
    return c;
  }

  var SHOWCASE_MIN_CROSSING = 4;

  // Does this garden make a fair demonstration of forking paths? The peeking walk must reach
  // p < 0.05 in the hoped-for direction (walkers happier) while the plain path does not; it
  // must get there only at decision 4 or later, so several choices add up; and no single
  // change to the plain analysis may be enough on its own.
  function isShowcase(g) {
    var walk = peekingWalk(g), wi = pathIndex(walk);
    return g.p[wi] < ALPHA && g.sign[wi] > 0 && g.p[pathIndex(PREREG)] >= ALPHA &&
      firstCrossing(g, walk) >= SHOWCASE_MIN_CROSSING && singleChangeHits(g) === 0;
  }

  // The study shown first. Starting from a fixed seed, draw noise studies until one passes
  // isShowcase. The number of draws it took is reported on the page: that selection is the
  // file drawer.
  function findShowcase(startSeed, maxTries) {
    maxTries = maxTries || 1000;
    for (var t = 0; t < maxTries; t++) {
      var seed = startSeed + t;
      var study = generateStudy(seed);
      var g = garden(study);
      if (isShowcase(g)) return { seed: seed, tries: t + 1, study: study, garden: g, walk: peekingWalk(g) };
    }
    var s0 = generateStudy(startSeed), g0 = garden(s0);
    return { seed: startSeed, tries: maxTries, study: s0, garden: g0, walk: peekingWalk(g0) };
  }

  // Signed z for the specification curve: the normal quantile matching the two-sided p,
  // carrying the direction of the estimate.
  function signedZ(p, sign) {
    var z = normInv(1 - Math.max(p, 1e-15) / 2);
    return (sign < 0 ? -1 : 1) * z;
  }

  var Mirage = {
    hashSeed: hashSeed, rng: rng, normalSource: normalSource,
    lgamma: lgamma, betai: betai, tTwoSided: tTwoSided, normSf: normSf, normCdf: normCdf, normInv: normInv,
    welch: welch, mannWhitney: mannWhitney, ols: ols, residualise: residualise, meanVar: meanVar,
    generateStudy: generateStudy, N_DEFAULT: N_DEFAULT,
    FORKS: FORKS, RADIX: RADIX, N_PATHS: N_PATHS, PREREG: PREREG, ALPHA: ALPHA,
    pathIndex: pathIndex, pathChoices: pathChoices,
    outcomeValues: outcomeValues, includedMask: includedMask,
    analysePath: analysePath, garden: garden, peekingWalk: peekingWalk,
    runStudy: runStudy, studySeed: studySeed, simulate: simulate, findShowcase: findShowcase,
    walkTrail: walkTrail, firstCrossing: firstCrossing, singleChangeHits: singleChangeHits,
    isShowcase: isShowcase, SHOWCASE_MIN_CROSSING: SHOWCASE_MIN_CROSSING,
    signedZ: signedZ
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Mirage;
  else root.Mirage = Mirage;
})(typeof window !== 'undefined' ? window : this);
