// Checks the recorded browser run (tests/steps.json, written from tests/steps.html) in Node:
// every guided step's claims are re-evaluated from DuckDB's recorded estimates and actual rows,
// the generated data are compared with the model's expectations, and the card preview is checked
// against the same recording. Run: node projects/cardinal/tests/steps.test.js
'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var M = require('../model.js');
var preview = require('./make-preview.js');

var steps = JSON.parse(fs.readFileSync(path.join(__dirname, 'steps.json'), 'utf8'));
var engineSrc = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');
var passed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { console.error('FAIL ' + name + '\n  ' + (e && e.stack || e)); process.exitCode = 1; }
}

test('the recording used the pinned version', function () {
  var pinned = /var VERSION = '([^']+)'/.exec(engineSrc)[1];
  assert.strictEqual(steps.packageVersion, pinned);
  assert.ok(/^v1\.4\./.test(steps.duckdbVersion), steps.duckdbVersion);
  assert.strictEqual(steps.allPass, true);
});

function asResult(rec) {
  if (rec.before) {
    return { before: rec.before, after: rec.after, tree: rec.after.tree, stats: rec.stats };
  }
  var r = JSON.parse(JSON.stringify(rec.run));
  r.stats = rec.stats;
  return r;
}

steps.sizes.forEach(function (size) {
  var label = size.orders.toLocaleString('en-CA') + ' orders';

  test(label + ': every step was recorded', function () {
    assert.deepStrictEqual(size.steps.map(function (s) { return s.id; }), M.STEPS.map(function (s) { return s.id; }));
  });

  size.steps.forEach(function (rec) {
    var step = M.STEPS.filter(function (s) { return s.id === rec.id; })[0];
    test(label + ': step "' + rec.id + '" claims hold when recomputed from the recorded engine output', function () {
      assert.deepStrictEqual(rec.settings, step.settings, 'the recording used this step’s settings');
      var claims = step.check(asResult(rec));
      claims.forEach(function (c, i) {
        assert.ok(c.pass, c.claim + ' — ' + c.detail);
        assert.strictEqual(rec.claims[i].pass, true, 'the browser run also passed: ' + c.claim);
      });
    });
  });

  test(label + ': q-errors in the recording follow from estimate and actual', function () {
    size.steps.forEach(function (rec) {
      var trees = rec.run ? [rec.run.tree] : [rec.before.tree, rec.after.tree];
      trees.forEach(function (t) {
        M.flatten(t).forEach(function (r) {
          if (r.node.est === null) return;
          assert.ok(r.node.est >= 0 && r.node.act >= 0);
          assert.strictEqual(r.q, Math.max(Math.max(1, r.node.est) / Math.max(1, r.node.act), Math.max(1, r.node.act) / Math.max(1, r.node.est)));
        });
      });
    });
  });

  test(label + ': the generated data match the model (skew, link, filters)', function () {
    var C = M.shape(size.orders).customers;
    size.dataChecks.forEach(function (d) {
      var tag = 'theta ' + d.theta + ', rho ' + d.rho + ': ';
      function close(measured, expected, what) {
        var sd = Math.sqrt(Math.max(1, expected));
        assert.ok(Math.abs(measured - expected) <= Math.max(6 * sd, 0.03 * expected), tag + what + ' measured ' + measured + ', expected ' + expected.toFixed(0));
      }
      var city = M.expected({ theta: d.theta, rho: d.rho, scope: 'city' }, size.orders);
      var prov = M.expected({ theta: d.theta, rho: d.rho, scope: 'province' }, size.orders);
      close(d.ordersInCity0, city.ordersInScope, 'orders from city 0');
      close(d.starProvince0Category0, prov.starJoinRows, 'province 0 × category 0');
      close(d.bestSellerRows, prov.bestSellerRows, 'product 0 orders');
      close(d.topCustomerShare * size.orders, M.zipfMass(d.theta, C, 0) * size.orders, 'busiest customer');
      if (d.theta === 0) assert.ok(Math.abs(d.cramersV - d.rho) <= 0.02, tag + 'Cramér’s V ' + d.cramersV + ' should be about ' + d.rho);
    });
  });
});

test('within one table DuckDB keeps the more selective filter instead of multiplying (step 2 aside)', function () {
  var linked = steps.singleTable.people_linked, indep = steps.singleTable.people_independent;
  // Same estimate for both tables: the second filter (province) did not change it.
  assert.strictEqual(linked.est, indep.est);
  // About 20,000 / 60, the city filter alone; multiplying would give about 20,000 / 720.
  assert.ok(linked.est > 20000 / 60 / 1.5 && linked.est < 20000 / 60 * 1.5, 'estimate ' + linked.est);
  assert.ok(M.qError(linked.est, linked.act) <= 1.5, 'linked columns: close');
  assert.ok(indep.est / Math.max(1, indep.act) >= 5, 'independent columns: overestimated');
});

test('the card preview replays exactly the recorded frames', function () {
  var want = preview.framesFrom(steps);
  assert.deepStrictEqual(M.RECORDED_PREVIEW, want);
  var f = want.frames;
  assert.strictEqual(f[0].rows[1].key, 'orders');
  assert.strictEqual(f[0].rows[2].role, 'build', 'one city: builds on customers');
  assert.strictEqual(f[f.length - 1].rows[2].key, 'orders');
  assert.strictEqual(f[f.length - 1].rows[2].role, 'build', 'one province: builds on orders');
  var q0 = M.qError(f[0].rows[1].est, f[0].rows[1].act), q4 = M.qError(f[4].rows[1].est, f[4].rows[1].act);
  assert.ok(q4 > 50 * q0, 'guess and count drift apart as skew rises');
  // The flip frame compares like with like: the same query, DuckDB's build side against the other one.
  var last = f[f.length - 1];
  assert.strictEqual(last.altBuild, 'customers');
  assert.ok(last.altMs > 0 && last.ms >= 1.5 * last.altMs, 'flipped plan ' + last.ms + ' ms against the other side ' + last.altMs + ' ms');
  var laptop = steps.sizes.filter(function (z) { return z.orders === M.SIZES.laptop; })[0];
  var flip = laptop.steps.filter(function (s) { return s.id === 'flip'; })[0];
  assert.strictEqual(last.altMs, Math.round(flip.after.alt.timing.median * 10) / 10, 'from step 4’s own run');
});

test('step 3 aside: a quieter city (30) is overestimated, not underestimated', function () {
  var q = steps.quietCity;
  assert.ok(q, 'steps.json records the quiet-city run');
  assert.strictEqual(q.city, 30);
  assert.strictEqual(q.theta, M.STEPS[2].settings.theta);
  assert.ok(q.est > q.act, 'guessed ' + q.est + ', real ' + q.act);
  assert.ok(M.qError(q.est, q.act) < 2, 'slightly, not wildly: q ' + M.qError(q.est, q.act));
  var exp = M.zipfMassWhere(q.theta, M.shape(q.orders).customers, function (k) { return M.cityOfCustomer(k) === 30; }) * q.orders;
  assert.ok(Math.abs(q.act - exp) <= Math.max(6 * Math.sqrt(exp), 0.03 * exp), 'real count ' + q.act + ' matches the model ' + exp.toFixed(0));
});

test('the measured home-category share is rho + (1 - rho)/12 on uniform data (step 2 copy, ρ note)', function () {
  // Recorded either inside each size's dataChecks (a fresh full run) or in homeShareChecks (added later).
  var groups = steps.sizes.map(function (z) { return z.dataChecks.filter(function (d) { return d.homeShare !== undefined; }); });
  if (steps.homeShareChecks) groups = groups.concat(steps.homeShareChecks.sizes.map(function (z) { return z.checks; }));
  var seen = 0;
  groups.forEach(function (checks) {
    checks.forEach(function (d) {
      if (d.theta !== 0) return;
      seen++;
      assert.ok(Math.abs(d.homeShare - M.homeShareExpected(d.rho)) <= 0.01, 'rho ' + d.rho + ': ' + d.homeShare);
    });
  });
  assert.ok(seen >= 8, 'home-category share recorded at both sizes');
});

console.log(passed + ' recorded-step tests passed' + (process.exitCode ? ', some FAILED' : ''));
