// Check (b): p-values match reference values to 3 decimals.
// Reference values come from tests/reference.py (independent Simpson integration of the
// t density, math.erfc, and a separate implementation of each test; scipy is not
// installed), from closed forms for df = 1 and df = 2, and from printed t tables.
'use strict';
var assert = require('assert');
var M = require('../model.js');

var failures = 0;
function near(actual, expected, tol, label) {
  tol = tol == null ? 5e-4 : tol;
  try {
    assert.ok(Math.abs(actual - expected) <= tol, label + ': got ' + actual + ', expected ' + expected);
    console.log('  ok  ' + label + ' = ' + actual.toFixed(6));
  } catch (e) { failures++; console.error('  FAIL ' + e.message); }
}

console.log('Student t, two-sided');
// Python reference (Simpson integration of the t density).
[[2.0, 30, 0.054625], [2.042, 30, 0.050029], [2.228, 10, 0.050012], [2.845, 20, 0.010008],
 [1.0, 5, 0.363217], [3.0, 5, 0.030099], [0.5, 100, 0.618174], [4.0, 12.7, 0.001581],
 [2.5, 58.3, 0.015254], [1.3, 2, 0.323247]].forEach(function (r) {
  near(M.tTwoSided(r[0], r[1]), r[2], 5e-4, 't=' + r[0] + ', df=' + r[1]);
  near(M.tTwoSided(-r[0], r[1]), r[2], 5e-4, 't=-' + r[0] + ', df=' + r[1]);
});
// Closed forms: df = 1 is Cauchy, p = 1 - (2/pi) atan|t|; df = 2, p = 1 - |t|/sqrt(2 + t^2).
[0.3, 1, 2.5, 12.706].forEach(function (t) {
  near(M.tTwoSided(t, 1), 1 - 2 / Math.PI * Math.atan(t), 1e-9, 'closed form df=1, t=' + t);
  near(M.tTwoSided(t, 2), 1 - t / Math.sqrt(2 + t * t), 1e-9, 'closed form df=2, t=' + t);
});
// Printed table critical values (two-sided 5% and 1%).
near(M.tTwoSided(12.706, 1), 0.05, 5e-4, 'table t(0.975, 1)');
near(M.tTwoSided(2.571, 5), 0.05, 5e-4, 'table t(0.975, 5)');
near(M.tTwoSided(2.000, 60), 0.05, 5e-4, 'table t(0.975, 60)');
near(M.tTwoSided(2.660, 60), 0.01, 5e-4, 'table t(0.995, 60)');
near(M.tTwoSided(0, 10), 1, 1e-12, 't = 0');

console.log('Normal');
[[1.96, 0.049996], [1.0, 0.317311], [2.576, 0.009995], [3.2, 0.001374]].forEach(function (r) {
  near(2 * M.normSf(r[0]), r[1], 1e-6, 'two-sided z=' + r[0]);
});
near(M.normInv(0.975), 1.959964, 1e-6, 'normInv(0.975)');
near(M.normInv(0.005), -2.575829, 1e-6, 'normInv(0.005)');
near(M.normInv(M.normCdf(0.3)), 0.3, 1e-9, 'normInv round trip');

var A = [4.1, 5.3, 6.0, 5.5, 7.2, 4.8, 6.6, 5.9, 6.1, 5.0, 7.7, 6.3];
var B = [3.9, 4.4, 5.1, 4.0, 5.6, 6.2, 3.5, 4.9, 4.2, 5.4];
var RA = [6, 7, 7, 5, 8, 6, 9, 7, 6, 8, 7, 5, 6];
var RB = [5, 6, 6, 4, 7, 5, 6, 5, 8, 6, 5, 4];
var Y = [31, 28, 35, 40, 22, 30, 33, 29, 36, 27, 38, 25, 34, 30];
var G = [1, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0];
var X = [7.0, 6.5, 7.5, 8.0, 5.5, 7.25, 6.75, 6.0, 8.25, 6.5, 7.0, 5.75, 7.5, 7.0];

console.log('Welch t-test');
var w = M.welch(A, B);
near(w.t, 2.884454, 1e-5, 'Welch t');
near(w.df, 19.989783, 1e-5, 'Welch df');
near(w.p, 0.009170, 5e-4, 'Welch p');

console.log('Mann-Whitney U');
var m = M.mannWhitney(RA, RB);
near(m.U, 117, 0, 'U with ties');
near(m.z, 2.154641, 1e-6, 'z, tie and continuity corrected');
near(m.p, 0.031190, 5e-4, 'p, tie and continuity corrected');
var m2 = M.mannWhitney(RA, RB, { continuity: false });
near(m2.p, 0.029064, 5e-4, 'p, tie corrected, no continuity');
var m3 = M.mannWhitney(A, B);
near(m3.U, 96, 0, 'U, no ties');
near(m3.p, 0.019242, 5e-4, 'p, no ties');
// Hand check on a tiny case: a = [1, 2], b = [3, 4]: U = 0, mean 2, var = 2*2*5/12.
var tiny = M.mannWhitney([1, 2], [3, 4], { continuity: false });
near(tiny.U, 0, 0, 'tiny U');
near(tiny.z, -2 / Math.sqrt(20 / 12), 1e-12, 'tiny z by hand');
// Symmetry: swapping groups flips the sign, keeps p.
near(M.mannWhitney(RB, RA).p, m.p, 1e-12, 'swap symmetry');

console.log('OLS');
var o1 = M.ols(Y, G, null);
near(o1.b, 8.0, 1e-9, 'group-only coefficient');
near(o1.se, 1.595060, 1e-6, 'group-only se');
near(o1.df, 12, 0, 'group-only df');
near(o1.p, 0.000301, 5e-4, 'group-only p');
// With no covariate, regression is Student's pooled t-test: compare by hand.
var y1 = Y.filter(function (_, i) { return G[i]; }), y0 = Y.filter(function (_, i) { return !G[i]; });
var a1 = M.meanVar(y1), a0 = M.meanVar(y0);
var sp = ((a1.n - 1) * a1.v + (a0.n - 1) * a0.v) / (a1.n + a0.n - 2);
near(o1.t, (a1.mean - a0.mean) / Math.sqrt(sp * (1 / a1.n + 1 / a0.n)), 1e-9, 'equals pooled t');
var o2 = M.ols(Y, G, X);
near(o2.b, 4.298701, 1e-6, 'adjusted coefficient');
near(o2.se, 1.664665, 1e-6, 'adjusted se');
near(o2.df, 11, 0, 'adjusted df');
near(o2.p, 0.025485, 5e-4, 'adjusted p');

if (failures) { console.error(failures + ' stats check(s) failed'); process.exit(1); }
console.log('stats: all checks passed');
