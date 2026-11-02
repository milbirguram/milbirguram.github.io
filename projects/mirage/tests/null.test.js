// Checks (a), (c) and (d) on simulated null data.
'use strict';
var fs = require('fs'), path = require('path');
var M = require('../model.js');

var failures = 0;
function check(cond, msg) {
  if (cond) console.log('  ok  ' + msg);
  else { failures++; console.error('  FAIL ' + msg); }
}

// ---------------------------------------------------------------------------
// (a) Fixed paths keep their false-positive rate at 5%.
// ---------------------------------------------------------------------------
var R = 3000;
var hits = new Int32Array(M.N_PATHS);
var t0 = Date.now(), k, r, i;
for (r = 0; r < R; r++) {
  var g = M.garden(M.generateStudy(M.hashSeed(424242, r)));
  for (k = 0; k < M.N_PATHS; k++) if (g.p[k] < M.ALPHA) hits[k]++;
}
// 99% normal-approximation binomial interval around 5% for R trials.
var half = 2.5758 * Math.sqrt(0.05 * 0.95 / R);
var lo = 0.05 - half, hi = 0.05 + half;
console.log('(a) ' + R + ' null datasets in ' + (Date.now() - t0) + ' ms; 99% interval [' + lo.toFixed(4) + ', ' + hi.toFixed(4) + ']');
function rateOf(choices) { return hits[M.pathIndex(choices)] / R; }
function label(choices) { return choices.map(function (c, j) { return M.FORKS[j].options[c].short; }).join(' / '); }
var named = [
  M.PREREG,
  [0, 0, 0, 0, 0, 1], [0, 0, 0, 0, 0, 2], [0, 0, 0, 0, 2, 2], [0, 0, 0, 0, 1, 0],
  [1, 0, 0, 0, 0, 1], [2, 1, 1, 1, 2, 2], [0, 1, 2, 2, 1, 0], [1, 1, 1, 2, 2, 1], [2, 0, 2, 1, 0, 0]
];
named.forEach(function (c) {
  var rate = rateOf(c);
  check(rate >= lo && rate <= hi, 'path ' + label(c) + ': ' + (rate * 100).toFixed(2) + '%');
});
var outside = 0, sum = 0, minR = 1, maxR = 0;
for (k = 0; k < M.N_PATHS; k++) {
  var rate = hits[k] / R;
  sum += rate; minR = Math.min(minR, rate); maxR = Math.max(maxR, rate);
  if (rate < lo || rate > hi) outside++;
}
console.log('    all ' + M.N_PATHS + ' paths: mean ' + (sum / M.N_PATHS * 100).toFixed(2) + '%, range ' +
  (minR * 100).toFixed(2) + '–' + (maxR * 100).toFixed(2) + '%, outside the 99% interval: ' + outside);
// About 1% of paths should fall outside by chance; allow 3% because paths share data.
check(outside <= Math.ceil(0.03 * M.N_PATHS), 'at most 3% of all paths outside the interval (' + outside + ')');
check(Math.abs(sum / M.N_PATHS - 0.05) < 0.006, 'average false-positive rate across paths is near 5%');
// Mean rate by test: the Mann-Whitney paths should run slightly conservative (continuity
// correction), the t-based ones close to 5%.
var byTest = [0, 0, 0], nByTest = [0, 0, 0];
for (k = 0; k < M.N_PATHS; k++) { var tk = M.pathChoices(k)[5]; byTest[tk] += hits[k] / R; nByTest[tk]++; }
console.log('    mean by test: ' + M.FORKS[5].options.map(function (o, j) { return o.short + ' ' + (byTest[j] / nByTest[j] * 100).toFixed(2) + '%'; }).join(', '));
byTest.forEach(function (v, j) {
  check(Math.abs(v / nByTest[j] - 0.05) < 0.006, M.FORKS[5].options[j].short + ' paths average near 5%');
});
console.log('    pre-registered path: ' + (rateOf(M.PREREG) * 100).toFixed(2) + '%');

// ---------------------------------------------------------------------------
// (c) The "any path significant" share is simulated, not assumed.
// ---------------------------------------------------------------------------
console.log('(c) any-path share');
var S = 120, seedA = 99, seedB = 100;
var simA = M.simulate(S, seedA);
var manual = 0, manualPre = 0;
for (i = 0; i < S; i++) {
  var gi = M.garden(M.generateStudy(M.studySeed(seedA, i)));
  var any = false;
  for (k = 0; k < M.N_PATHS; k++) if (gi.p[k] < 0.05) { any = true; break; }
  if (any) manual++;
  if (gi.p[M.pathIndex(M.PREREG)] < 0.05) manualPre++;
}
check(simA.any === manual, 'simulate() any-path count equals a recount from raw gardens (' + simA.any + ' = ' + manual + ')');
check(simA.prereg === manualPre, 'simulate() pre-registered count equals a recount (' + simA.prereg + ')');
var simB = M.simulate(S, seedB);
check(simA.any !== simB.any || simA.sigPaths !== simB.sigPaths, 'a different seed gives a different tally');
check(simA.any / S > 0.2 && simA.any / S < 0.95, 'any-path share is far above 5% (' + (simA.any / S * 100).toFixed(1) + '%)');
var appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
check(/M\.runStudy\(M\.studySeed\(/.test(appSrc), 'app.js tallies studies by calling Mirage.runStudy on fresh seeds (no hard-coded share)');

// ---------------------------------------------------------------------------
// (d) The generator has zero effect: group is independent of everything.
// ---------------------------------------------------------------------------
console.log('(d) generator independence');
var vars = ['questionnaire', 'rating', 'diary', 'age', 'sleep', 'attnFail'];
function columns(s) { return [s.outcomes[0], s.outcomes[1], s.outcomes[2], s.age, s.sleep, s.attnFail]; }
// 1. Balance: groups are always exactly 60 and 60.
var balanced = true;
for (i = 0; i < 200; i++) {
  var si = M.generateStudy(i), c = 0;
  for (k = 0; k < si.n; k++) c += si.group[k];
  if (c !== si.n / 2) balanced = false;
}
check(balanced, 'every study has exactly 60 walkers and 60 controls');
// 2. Statistical: across 2,000 studies, the standardised mean difference between groups
//    for each variable is centred on zero with the spread chance alone predicts.
var D = 2000;
var diffs = vars.map(function () { return []; });
for (r = 0; r < D; r++) {
  var st = M.generateStudy(M.hashSeed(31337, r));
  columns(st).forEach(function (col, v) {
    var a = [], b = [];
    for (k = 0; k < st.n; k++) (st.group[k] ? a : b).push(col[k]);
    var A = M.meanVar(a), B = M.meanVar(b), all = M.meanVar(Array.prototype.slice.call(col));
    diffs[v].push(all.v > 0 ? (A.mean - B.mean) / Math.sqrt(all.v) : 0);
  });
}
// Expected sd of the standardised difference for 60 vs 60 out of 120: sqrt(2/60 * 120/119).
var expectedSd = Math.sqrt(2 / 60) * Math.sqrt(120 / 119);
vars.forEach(function (name, v) {
  var mv = M.meanVar(diffs[v]);
  var se = expectedSd / Math.sqrt(D);
  check(Math.abs(mv.mean) < 4 * se && Math.abs(Math.sqrt(mv.v) / expectedSd - 1) < 0.08,
    name + ': mean standardised difference ' + mv.mean.toFixed(4) + ' (limit ±' + (4 * se).toFixed(4) +
    '), sd ' + Math.sqrt(mv.v).toFixed(3) + ' vs ' + expectedSd.toFixed(3) + ' expected');
});
// 3. Structural: measurements come from one random stream, group labels from another, so
//    re-dealing groups cannot touch any measurement. Confirm in the source that the
//    drawing loop never reads group and that there is no effect parameter.
var modelSrc = fs.readFileSync(path.join(__dirname, '..', 'model.js'), 'utf8');
var gen = modelSrc.slice(modelSrc.indexOf('function generateStudy'), modelSrc.indexOf('function clamp'));
var code = gen.replace(/\/\/.*$/gm, '');
var drawPart = code.slice(code.indexOf('{'), code.indexOf('var group'));
check(drawPart.length > 200 && !/group/.test(drawPart), 'measurements are drawn before, and without reference to, group');
check(!/effect/i.test(code), 'generateStudy has no effect parameter');
check(/hashSeed\(seed, 1\)/.test(code) && /hashSeed\(seed, 2\)/.test(code), 'measurements and groups use separate random streams');

if (failures) { console.error(failures + ' null check(s) failed'); process.exit(1); }
console.log('null: all checks passed');
