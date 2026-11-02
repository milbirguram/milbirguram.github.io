// Headless checks for the Stereo model. Run: node projects/stereo/tests/model.test.js
// Every run here is computed from scratch (no cache), so "unchanged" means recomputed and equal.
'use strict';
var assert = require('assert');
var path = require('path');
var S = require(path.join(__dirname, '..', 'model.js'));

var passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('ok   ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + '\n     ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n     ') : e)); }
}
function fresh(sc) { return S.run(sc, { cache: false }); }
function arr(a) { return Array.prototype.slice.call(a); }
function sameArr(a, b, msg) { assert.deepStrictEqual(arr(a), arr(b), msg); }
function sum(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s; }

// Comparable snapshots of each layer.
function worldSnap(r) { return JSON.stringify({ w: r.world.weather, rides: r.world.rides, unmet: r.world.unmet, maint: r.world.maint,
  t: [arr(r.world.truth.rides), arr(r.world.truth.unmet), arr(r.world.truth.sumDur)] }); }
function logSnap(r) { return JSON.stringify(r.log.events); }
function pipeSnap(r) { return JSON.stringify({ trips: r.pipe.trips, nb: r.pipe.nobike, d: [arr(r.pipe.daily.rides), arr(r.pipe.daily.unmet), arr(r.pipe.daily.sumDur)],
  stats: S.NODES.map(function (n) { return [arr(r.pipe.stats[n].inp), arr(r.pipe.stats[n].out)]; }) }); }
function dashSnap(r) { return JSON.stringify([arr(r.dash.rides), arr(r.dash.unmet), arr(r.dash.tripLen)]); }
function modelSnap(r) { return JSON.stringify({ f: arr(r.model.forecast).map(String), b: r.model.nights.map(function (n) { return n.beta; }) }); }
var SNAP = { world: worldSnap, log: logSnap, pipeline: pipeSnap, dashboard: dashSnap, model: modelSnap };

var base = fresh({});
var baseAgain = fresh({});

// ------------------------------------------------------------------------------------------
// (a) With no faults, the dashboard equals the true world exactly.
// ------------------------------------------------------------------------------------------
[{}, { heatwave: true }, { newStation: true }, { heatwave: true, newStation: true }, { seed: 31 }, { seed: 4242, newStation: true }].forEach(function (sc) {
  check('(a) no faults: dashboard equals the true world exactly ' + JSON.stringify(sc), function () {
    var r = fresh(sc), tr = r.world.truth;
    for (var d = 0; d < S.N_DAYS; d++) {
      assert.strictEqual(r.dash.rides[d], tr.rides[d], 'rides day ' + d);
      assert.strictEqual(r.dash.unmet[d], tr.unmet[d], 'unmet day ' + d);
      assert.strictEqual(r.dash.tripLen[d], tr.tripLen[d], 'trip length day ' + d);
    }
    // Every true ride appears exactly once, on the right day, with the right duration.
    var byRef = new Map();
    r.pipe.trips.forEach(function (t) { assert.ok(!byRef.has(t.ref), 'duplicate trip ' + t.ref); byRef.set(t.ref, t); });
    assert.strictEqual(byRef.size, r.world.rides.length);
    r.world.rides.forEach(function (ride) {
      var t = byRef.get(ride.id);
      assert.ok(t, 'missing ride ' + ride.id);
      assert.strictEqual(t.date, ride.day);
      assert.strictEqual(t.dur, ride.t1 - ride.t0);
      assert.strictEqual(t.st0, ride.st0);
    });
    assert.strictEqual(r.pipe.outside, 0);
    assert.strictEqual(S.flags(r), sc.heatwave && sc.newStation ? 'w.heat,w.ops' : sc.heatwave ? 'w.heat' : sc.newStation ? 'w.ops' : '');
  });
});

check('(a) the healthy pipeline really transforms: filter removes maintenance, dedupe removes resends', function () {
  var ev = base.log.events, maint = 0, resends = 0;
  ev.forEach(function (e) { if (e.kind === 'maintenance') maint++; else if (e.note === 'retry') resends++; });
  assert.ok(maint > 200 && resends > 1500, 'the log contains maintenance moves and resends: ' + maint + ', ' + resends);
  var st = base.pipe.stats;
  assert.strictEqual(sum(st.filter.inp) - sum(st.filter.out), maint);
  assert.strictEqual(sum(st.dedupe.inp) - sum(st.dedupe.out), resends);
  assert.strictEqual(sum(base.pipe.unmatched), 0);
  assert.strictEqual(sum(st.join.inp), sum(st.join.out));
  // Two rows (checkout, return) become one trip.
  assert.strictEqual(sum(st.pair.out), base.world.rides.length);
  assert.strictEqual(sum(st.pair.inp), 2 * base.world.rides.length);
});

check('(a) the world is plausible: unmet demand a few percent, trips right-skewed, a weekday double peak', function () {
  var tr = base.world.truth, req = sum(tr.requests), un = sum(tr.unmet);
  assert.ok(un / req > 0.03 && un / req < 0.12, 'unmet share ' + (un / req));
  var durs = base.world.rides.map(function (r) { return r.t1 - r.t0; });
  var mean = sum(durs) / durs.length, med = S.median(durs);
  assert.ok(mean / 60 > 13 && mean / 60 < 22, 'mean trip ' + mean / 60);
  assert.ok(med < 0.9 * mean, 'median below mean');
  var hours = new Array(24).fill(0);
  base.world.rides.forEach(function (r) { if (!S.isWeekend(r.day)) hours[Math.floor((r.t0 % S.DAY) / S.HOUR)]++; });
  assert.ok(hours[8] > 2 * hours[12] && hours[17] > 1.5 * hours[12] && hours[3] < hours[12] / 5, 'hours ' + hours.join(' '));
});

// ------------------------------------------------------------------------------------------
// (b) Each fault leaves its documented signature, on its own layer and above, never below.
// ------------------------------------------------------------------------------------------
var FAULTS = ['firmware', 'doublesend', 'clockskew', 'staletable', 'timezone', 'dedupekey', 'definition', 'weatherjoin'];
var runs = {};
FAULTS.forEach(function (f) {
  check('(b) ' + f + ': layers below ' + S.FAULTS[f].layer + ' are untouched, its own layer changes', function () {
    var obs = fresh({ fault: f }), tru = fresh(S.truthOf({ fault: f }));
    runs[f] = { obs: obs, tru: tru };
    var L = S.LAYER_INDEX[S.FAULTS[f].layer];
    S.LAYERS.forEach(function (layer, i) {
      if (i < L) assert.strictEqual(SNAP[layer](obs), SNAP[layer](tru), layer + ' must be untouched by ' + f);
    });
    assert.notStrictEqual(SNAP[S.FAULTS[f].layer](obs), SNAP[S.FAULTS[f].layer](tru), f + ' must change its own layer');
    var cmp = S.compare(obs, tru);
    cmp.affected.forEach(function (layer) { assert.ok(S.LAYER_INDEX[layer] >= L, f + ' reported as affecting ' + layer); });
    assert.ok(cmp.affected.indexOf(S.FAULTS[f].layer) >= 0);
  });
});

function forFault(f) { if (!runs[f]) runs[f] = { obs: fresh({ fault: f }), tru: fresh(S.truthOf({ fault: f })) }; return runs[f]; }
var F = S.FAULT_DAY;

check('(b) firmware: about 30% of Harbour returns vanish from the fault day; their trips are dropped; rides fall', function () {
  var x = forFault('firmware'), o = x.obs, t = x.tru;
  var ghosts = o.log.ghosts.filter(function (g) { return g.kind === 'ride'; });
  assert.ok(o.log.ghosts.every(function (g) { return g.st === S.HARBOUR && g.ts - S.UTC_OFFSET >= F * S.DAY; }));
  var harbourReturns = t.log.events.filter(function (e) { return e.type === 'return' && e.st === S.HARBOUR && e.note !== 'retry' && e.ts - S.UTC_OFFSET >= F * S.DAY; }).length;
  var share = o.log.ghosts.length / harbourReturns;
  assert.ok(share > 0.27 && share < 0.33, 'dropped share ' + share);
  assert.strictEqual(sum(o.pipe.unmatched), ghosts.length);
  // Exactly the rides whose return was lost disappear, on the day each ride started
  // (a ride from late the night before can lose a return that lands after midnight).
  var lost = new Int32Array(S.N_DAYS);
  ghosts.forEach(function (g) { lost[Math.floor(g.ref / 10000)]++; });
  for (var d = 0; d < S.N_DAYS; d++) {
    assert.strictEqual(o.dash.rides[d], t.dash.rides[d] - lost[d], 'day ' + d);
    if (d < F - 1) assert.strictEqual(lost[d], 0);
    if (d >= F) assert.ok(lost[d] > 0, 'day ' + d);
  }
  sameArr(o.dash.unmet, t.dash.unmet);
  var c = S.compare(o, t);
  assert.ok(c.dashboard.rides < -0.04 && c.model.gap < -0.02, 'rides gap ' + c.dashboard.rides + ', model gap ' + c.model.gap);
});

check('(b) doublesend: extra copies of app events only; the correct dedupe absorbs them all', function () {
  var x = forFault('doublesend'), o = x.obs, t = x.tru;
  var extra = o.log.events.length - t.log.events.length;
  assert.ok(extra > 3000, 'extra events ' + extra);
  var doubles = o.log.events.filter(function (e) { return e.note === 'double'; });
  assert.strictEqual(doubles.length, extra);
  assert.ok(doubles.every(function (e) { return e.src === 'app' && e.type !== 'return' && e.ts - S.UTC_OFFSET >= F * S.DAY; }));
  assert.strictEqual(sum(o.pipe.stats.dedupe.inp) - sum(o.pipe.stats.dedupe.out), sum(t.pipe.stats.dedupe.inp) - sum(t.pipe.stats.dedupe.out) + extra);
  assert.strictEqual(JSON.stringify(o.pipe.trips), JSON.stringify(t.pipe.trips));
  assert.strictEqual(dashSnap(o), dashSnap(t));
  assert.strictEqual(modelSnap(o), modelSnap(t));
  var c = S.compare(o, t);
  assert.deepStrictEqual(c.affected, ['log', 'pipeline']);
  assert.ok(c.pipeline.outputSame && c.pipeline.internal);
});

check('(b) clockskew: Rail Station dock events are stamped exactly one hour late; only trip length moves', function () {
  var x = forFault('clockskew'), o = x.obs, t = x.tru;
  var te = new Map(); t.log.events.forEach(function (e) { te.set(e.eid, e); });
  var moved = 0;
  o.log.events.forEach(function (e) {
    var u = te.get(e.eid);
    assert.ok(u);
    if (e.ts !== u.ts) {
      moved++;
      assert.strictEqual(e.ts - u.ts, S.HOUR);
      assert.ok(e.st === S.RAIL && e.type === 'return' && u.ts - S.UTC_OFFSET >= F * S.DAY);
    }
  });
  assert.ok(moved > 1000, 'restamped ' + moved);
  sameArr(o.dash.rides, t.dash.rides); sameArr(o.dash.unmet, t.dash.unmet);
  for (var d = F; d < S.N_DAYS; d++) assert.ok(o.dash.tripLen[d] > t.dash.tripLen[d] + 3, 'day ' + d);
  assert.strictEqual(modelSnap(o), modelSnap(t));
  var tt = new Map(); t.pipe.trips.forEach(function (tr) { tt.set(tr.ref, tr); });
  o.pipe.trips.forEach(function (tr) {
    var u = tt.get(tr.ref);
    assert.strictEqual(tr.dur - u.dur, (tr.st1 === S.RAIL && tr.dur !== u.dur) ? S.HOUR : 0);
  });
});

check('(b) staletable: the inner join drops exactly the rows that start at Riverside', function () {
  var x = forFault('staletable'), o = x.obs, t = x.tru;
  assert.ok(o.world.newStation && t.world.newStation);
  var riv = new Int32Array(S.N_DAYS), rivNb = new Int32Array(S.N_DAYS);
  t.world.rides.forEach(function (r) { if (r.st0 === S.RIVERSIDE) riv[r.day]++; });
  t.world.unmet.forEach(function (u) { if (u.st === S.RIVERSIDE) rivNb[u.day]++; });
  assert.ok(sum(riv) > 500, 'Riverside rides ' + sum(riv));
  for (var d = 0; d < S.N_DAYS; d++) {
    assert.strictEqual(o.dash.rides[d], t.dash.rides[d] - riv[d]);
    assert.strictEqual(o.dash.unmet[d], t.dash.unmet[d] - rivNb[d]);
  }
  assert.deepStrictEqual(Object.keys(o.pipe.droppedBy), [String(S.RIVERSIDE)]);
});

check('(b) timezone: rides after 5 pm local are filed under the next day; the pipeline loses none, the dashboard only the last evening', function () {
  var x = forFault('timezone'), o = x.obs, t = x.tru;
  assert.strictEqual(o.pipe.trips.length, t.pipe.trips.length);
  var tt = new Map(); t.pipe.trips.forEach(function (tr) { tt.set(tr.ref, tr); });
  var shifted = 0;
  o.pipe.trips.forEach(function (tr) {
    var u = tt.get(tr.ref);
    var expect = tr.part >= F && u.hour >= 17 ? u.date + 1 : u.date;
    assert.strictEqual(tr.date, expect);
    if (tr.date !== u.date) shifted++;
  });
  assert.ok(shifted / o.pipe.trips.length > 0.15, 'shifted share ' + shifted / o.pipe.trips.length);
  assert.ok(o.dash.rides[F] < 0.8 * t.dash.rides[F], 'the first faulty day loses its evening');
  for (var d = 0; d < F; d++) assert.strictEqual(o.dash.rides[d], t.dash.rides[d]);
  // Totals are kept except the season's last evening, which is filed under 1 August, past the dashboard.
  var lastEvening = t.pipe.trips.filter(function (tr) { return tr.date === S.N_DAYS - 1 && tr.hour >= 17; }).length;
  assert.ok(lastEvening > 50, 'last evening ' + lastEvening);
  assert.strictEqual(o.pipe.outside, lastEvening);
  assert.strictEqual(sum(o.dash.rides), sum(t.dash.rides) - lastEvening);
});

check('(b) each layer shows its own gap: the pipeline strip’s per-night count of rows unlike the truth', function () {
  var none = S.compare(base, baseAgain).pipeline;
  assert.strictEqual(sum(none.perPart), 0);
  FAULTS.forEach(function (f) {
    var x = forFault(f), c = S.compare(x.obs, x.tru), p = c.pipeline, n = sum(p.perPart);
    var changed = 0, tt = new Map(), seen = new Set();
    x.tru.pipe.trips.forEach(function (tr) { tt.set(tr.ref, tr); });
    x.obs.pipe.trips.forEach(function (tr) {
      var u = tt.get(tr.ref);
      if (u && !seen.has(tr.ref) && (u.date !== tr.date || u.dur !== tr.dur)) changed++;
      seen.add(tr.ref);
    });
    assert.strictEqual(n, p.missing + p.extra + changed + p.nobikeDiff, f + ': per-night count adds up');
    if (S.LAYER_INDEX[S.FAULTS[f].layer] > S.LAYER_INDEX.pipeline || f === 'doublesend') assert.strictEqual(n, 0, f + ' leaves the pipeline output alone');
    else assert.ok(n > 0 && c.affected.indexOf('pipeline') >= 0, f + ' shows a gap at the pipeline');
  });
  // The time-zone fault: identical counts per night, yet every faulty night now shows its misdated rows.
  var tz = forFault('timezone'), ctz = S.compare(tz.obs, tz.tru).pipeline;
  sameArr(tz.obs.pipe.tripsOut, tz.tru.pipe.tripsOut);
  for (var d = 0; d < S.N_DAYS; d++) {
    if (d < F) assert.strictEqual(ctz.perPart[d], 0, 'night ' + d);
    else assert.ok(ctz.perPart[d] > 0, 'night ' + d);
  }
});

check('(b) only the menu’s own faults are accepted: inherited keys such as constructor are refused', function () {
  ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'nonsense'].forEach(function (f) {
    assert.ok(!S.isFault(f), f);
    assert.throws(function () { S.normalise({ fault: f }); }, /Unknown fault/, f);
  });
  S.FAULT_IDS.forEach(function (f) { assert.ok(S.isFault(f)); });
});

check('(a) the overnight truck shares out only the bikes docked at midnight; bikes still out return later', function () {
  [base, fresh({ newStation: true })].forEach(function (r) {
    var w = r.world, short = 0;
    for (var d = 0; d < S.N_DAYS; d++) {
      var docked = 0, out = 0, fleet = 0, s;
      for (s = 0; s < S.STATIONS.length; s++) docked += w.invStart[d][s];
      w.rides.concat(w.maint).forEach(function (x) { if (x.t0 < d * S.DAY && x.t1 >= d * S.DAY) out++; });
      for (s = 0; s < S.STATIONS.length; s++) if (!S.STATIONS[s].opens || (w.newStation && d >= S.STATIONS[s].opens)) fleet += S.STATIONS[s].bikes;
      assert.strictEqual(docked + out, fleet, 'day ' + d);
      for (s = 0; s < S.STATIONS.length; s++) if (w.invStart[d][s] < S.STATIONS[s].bikes && (!S.STATIONS[s].opens || (w.newStation && d >= S.STATIONS[s].opens))) { short++; break; }
    }
    assert.ok(short > 40, 'some station starts short on most days: ' + short);
  });
});

check('(b) dedupekey: the usual resends leak through and the pairing join fans out', function () {
  var x = forFault('dedupekey'), o = x.obs, t = x.tru;
  assert.ok(o.pipe.trips.length > t.pipe.trips.length * 1.03);
  var c = S.compare(o, t);
  assert.strictEqual(c.pipeline.missing, 0);
  assert.strictEqual(c.pipeline.extra, o.pipe.trips.length - t.pipe.trips.length);
  for (var d = 0; d < S.N_DAYS; d++) assert.ok(o.dash.rides[d] >= t.dash.rides[d]);
  assert.ok(c.dashboard.rides > 0.05, 'rides gap ' + c.dashboard.rides);
});

check('(b) definition: from the fault day the dashboard shows the median, which sits below the mean', function () {
  var x = forFault('definition'), o = x.obs, t = x.tru;
  sameArr(o.dash.rides, t.dash.rides); sameArr(o.dash.unmet, t.dash.unmet);
  for (var d = 0; d < S.N_DAYS; d++) {
    if (d < F) assert.strictEqual(o.dash.tripLen[d], t.dash.tripLen[d]);
    else {
      assert.strictEqual(o.dash.tripLen[d], S.median(o.pipe.durs[d]) / 60);
      assert.ok(o.dash.tripLen[d] < 0.92 * t.dash.tripLen[d], 'day ' + d);
    }
  }
  assert.strictEqual(modelSnap(o), modelSnap(t));
});

check('(b) weatherjoin: same data, but the model learns from the wrong day’s weather and forecasts worse', function () {
  var x = forFault('weatherjoin'), o = x.obs, t = x.tru;
  o.model.nights.forEach(function (n, i) {
    if (n.night < F) assert.deepStrictEqual(n.beta, t.model.nights[i].beta);
  });
  var c = S.compare(o, t);
  assert.ok(c.model.mapeTrue > 2 * c.model.mapeTruthModel, 'error ' + c.model.mapeTrue + ' vs ' + c.model.mapeTruthModel);
  var last = o.model.nights[o.model.nights.length - 1], lastT = t.model.nights[t.model.nights.length - 1];
  assert.ok(Math.abs(S.effects(last.beta).rain) < Math.abs(S.effects(lastT.beta).rain) / 2, 'the learned rain effect shrinks');
});

check('(b) world changes are signal: every layer agrees with the changed world', function () {
  var hw = fresh({ heatwave: true });
  for (var d = 0; d < S.HEAT_FROM; d++) assert.strictEqual(hw.world.truth.rides[d], base.world.truth.rides[d], 'before the heat, day ' + d);
  var a = 0, b = 0, ua = 0, ub = 0;
  for (d = S.HEAT_FROM; d <= S.HEAT_TO; d++) { a += hw.dash.rides[d]; b += base.dash.rides[d]; ua += hw.dash.unmet[d]; ub += base.dash.unmet[d]; }
  assert.ok(a > 1.2 * b && ua > 1.5 * ub, 'the heatwave raises rides and unmet demand');
  var c = S.compare(hw, fresh(S.truthOf({ heatwave: true })));
  assert.deepStrictEqual(c.affected, []);
  var ns = fresh({ newStation: true });
  var r1 = S.avg(ns.dash.rides, S.OPEN_DAY, S.N_DAYS - 1), r0 = S.avg(base.dash.rides, S.OPEN_DAY, S.N_DAYS - 1);
  assert.ok(r1 > 1.05 * r0, 'a new station adds rides');
});

// ------------------------------------------------------------------------------------------
// (c) Model metrics come from the model actually fitted.
// ------------------------------------------------------------------------------------------
check('(c) every nightly fit solves the Poisson score equations, and each forecast is exp(x·beta)', function () {
  [base, forFault('timezone').obs, forFault('weatherjoin').obs].forEach(function (r) {
    r.model.nights.forEach(function (n) {
      var grad = S.poissonGradient(n.X, n.Y, n.beta, S.RIDGE), scale = sum(n.Y);
      grad.forEach(function (gv) { assert.ok(Math.abs(gv) < 1e-6 * scale, 'gradient ' + gv); });
      assert.strictEqual(r.model.forecast[n.day], Math.exp(S.dot(n.x, n.beta)));
      // The training targets are the pipeline's own daily rides.
      n.rows.forEach(function (row, i) { assert.strictEqual(n.Y[i], r.pipe.daily.rides[row.date]); });
    });
    for (var d = 0; d < S.FIRST_FORECAST; d++) assert.ok(isNaN(r.model.forecast[d]));
  });
});

check('(c) the error figures are recomputed from the fitted forecasts', function () {
  var x = forFault('firmware'), o = x.obs, t = x.tru, c = S.compare(o, t);
  var s = 0, n = 0, s2 = 0;
  for (var d = F; d < S.N_DAYS; d++) {
    s += Math.abs(o.model.forecast[d] - o.dash.rides[d]) / o.dash.rides[d];
    s2 += Math.abs(o.model.forecast[d] - t.world.truth.rides[d]) / t.world.truth.rides[d]; n++;
  }
  assert.ok(Math.abs(c.model.mapeObs - s / n) < 1e-12 && Math.abs(c.model.mapeTrue - s2 / n) < 1e-12);
  // Judged against its own (corrupted) data the model looks better than it is.
  assert.ok(c.model.mapeObs < c.model.mapeTrue);
});

check('(c) the fitter recovers known coefficients from synthetic Poisson data', function () {
  var truth = [Math.log(500), 0.15, -0.4, -0.12], X = [], Y = [];
  for (var i = 0; i < 400; i++) {
    var x = S.features(14 + 12 * S.rnd(1, 99, i, 0, 0), S.rnd(1, 98, i, 0, 0) < 0.3, S.rnd(1, 97, i, 0, 0) < 2 / 7);
    var mu = Math.exp(S.dot(x, truth));
    var u = S.rnd(1, 96, i, 0, 1), v = S.rnd(1, 96, i, 0, 2);
    X.push(x); Y.push(Math.max(0, Math.round(mu + Math.sqrt(mu) * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v))));
  }
  var b = S.fitPoisson(X, Y, 0);
  b.forEach(function (bv, j) { assert.ok(Math.abs(bv - truth[j]) < 0.03, 'coef ' + j + ': ' + bv + ' vs ' + truth[j]); });
});

// ------------------------------------------------------------------------------------------
// (d) Seeded determinism.
// ------------------------------------------------------------------------------------------
check('(d) the same seed gives the same five layers; another seed gives another city', function () {
  S.LAYERS.forEach(function (layer) { assert.strictEqual(SNAP[layer](base), SNAP[layer](baseAgain), layer); });
  var f1 = fresh({ fault: 'firmware' });
  assert.strictEqual(logSnap(f1), logSnap(forFault('firmware').obs));
  var other = fresh({ seed: 8 });
  assert.notStrictEqual(dashSnap(other), dashSnap(base));
  // The cached runner gives exactly what a fresh computation gives.
  var R = new S.Runner(), cached = R.run({ fault: 'timezone' });
  R.run({ fault: 'firmware' });
  assert.strictEqual(dashSnap(R.run({ fault: 'timezone' })), dashSnap(forFault('timezone').obs));
  assert.strictEqual(modelSnap(cached), modelSnap(forFault('timezone').obs));
});

check('(c)(d) the card preview’s stored series equal a fresh computation by model.js', function () {
  var fs = require('fs'), vm = require('vm');
  var src = fs.readFileSync(path.join(__dirname, '..', 'preview-data.js'), 'utf8');
  var box = { window: {} };
  vm.runInNewContext(src, box);
  var stored = box.window.StereoPreviewData, now = S.previewSeries();
  assert.ok(stored, 'preview-data.js defines window.StereoPreviewData');
  assert.strictEqual(JSON.stringify(stored), JSON.stringify(now), 'preview-data.js is stale: run node projects/stereo/tools/make-preview-data.js');
  // and it shows what the card claims: the record falls below its truth from the fault day, at the log and above
  assert.deepStrictEqual(now.bands.map(function (b) { return b.name; }), ['Model', 'Dashboard', 'Pipeline', 'Log', 'World']);
  now.bands.slice(0, 4).forEach(function (b) {
    var lo = 0, n = 0;
    for (var d = now.faultDay + 3; d < S.N_DAYS - 3; d++) if (b.obs[d] != null) { n++; if (b.obs[d] < b.tru[d]) lo++; }
    assert.ok(lo === n && n > 20, b.name + ' below its truth after the fault: ' + lo + ' of ' + n);
    for (d = 0; d < now.faultDay - 4; d++) assert.strictEqual(b.obs[d], b.tru[d], b.name + ' equal before the fault, day ' + d);
  });
});

// ------------------------------------------------------------------------------------------
// (e) Each detective case is uniquely identifiable from the evidence the visitor can reach.
// ------------------------------------------------------------------------------------------
var ALL_ANSWERS = [];
Object.keys(S.ANSWERS).forEach(function (layer) { S.ANSWERS[layer].forEach(function (a) { ALL_ANSWERS.push(a); }); });
var LAYER_OF = {};
Object.keys(S.ANSWERS).forEach(function (layer) { S.ANSWERS[layer].forEach(function (a) { LAYER_OF[a] = layer; }); });

S.CASES.forEach(function (c, i) {
  check('(e) case ' + (i + 1) + ' “' + c.title + '”: the ticket’s anomaly is real and the evidence singles out ' + c.answer, function () {
    var sc = S.caseScenario(c), obs = fresh(sc), tru = fresh(S.truthOf(sc));
    var tk = c.ticket(obs, tru);
    assert.ok(tk.ok, 'ticket claim does not hold: ' + tk.text);
    assert.ok(ALL_ANSWERS.indexOf(c.answer) >= 0);
    var items = S.evidence(obs), mine = S.flags(obs);
    // The evidence that names the cause sits on the answer's own layer, where drilling down reaches it.
    assert.ok(items.some(function (it) { return it.flagged && it.layer === LAYER_OF[c.answer]; }), 'no flagged evidence on ' + LAYER_OF[c.answer]);
    ALL_ANSWERS.forEach(function (a) {
      var cand = fresh(S.candidateScenario(c, a)), theirs = S.flags(cand);
      if (a === c.answer) assert.strictEqual(theirs, mine, 'the answer reproduces the evidence');
      else assert.notStrictEqual(theirs, mine, 'answer ' + a + ' would leave the same evidence (' + mine + ')');
    });
    // A real change leaves no fault evidence at all; a fault always does.
    var faultFlags = items.filter(function (it) { return it.flagged && it.layer !== 'world'; });
    if (c.real) assert.strictEqual(faultFlags.length, 0);
    else assert.ok(faultFlags.length > 0);
  });
});

check('(e) ticket 1’s numbers are the weekly averages it names, before and after the change', function () {
  var c = S.CASES[0], sc = S.caseScenario(c), r = fresh(sc), F = sc.faultDay;
  var text = c.ticket(r, fresh(S.truthOf(sc))).text;
  var a = (Math.round(S.avg(r.dash.tripLen, F - 7, F - 1) * 10) / 10).toFixed(1), b = (Math.round(S.avg(r.dash.tripLen, F, F + 6) * 10) / 10).toFixed(1);
  assert.ok(text.indexOf('dropped on ' + S.dateLabel(F)) >= 0, text);
  assert.ok(text.indexOf(a + ' minutes a day in the week before and ' + b + ' in the week after') >= 0, text);
  assert.ok(!/overnight/.test(text), 'no claim about two adjacent days: ' + text);
});

check('(e) cases rise in difficulty and cover the layers, including one with nothing broken', function () {
  var levels = S.CASES.map(function (c) { return c.level; });
  assert.deepStrictEqual(levels, levels.slice().sort(function (a, b) { return a - b; }));
  assert.ok(S.CASES.some(function (c) { return c.real; }));
  var layers = new Set(S.CASES.map(function (c) { return LAYER_OF[c.answer]; }));
  ['world', 'log', 'pipeline', 'dashboard'].forEach(function (l) { assert.ok(layers.has(l), 'no case at ' + l); });
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
