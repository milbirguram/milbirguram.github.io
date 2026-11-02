// Node tests for the pure logic in model.js. Run: node projects/cardinal/tests/model.test.js
'use strict';
var assert = require('assert');
var path = require('path');
var fs = require('fs');
var M = require('../model.js');

var passed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { console.error('FAIL ' + name + '\n  ' + (e && e.stack || e)); process.exitCode = 1; }
}
function near(a, b, tol, msg) { assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' expected ' + b + ' ± ' + tol + ', got ' + a); }

// ------------------------------------------------------------------ q-error

test('q-error is symmetric and at least 1', function () {
  assert.strictEqual(M.qError(100, 100), 1);
  assert.strictEqual(M.qError(10, 1000), 100);
  assert.strictEqual(M.qError(1000, 10), 100);
  assert.strictEqual(M.qError(0, 0), 1);
  assert.strictEqual(M.qError(0, 50), 50, 'zero estimates are clamped to 1');
  assert.strictEqual(M.qError(null, 5), null);
  assert.strictEqual(M.direction(10, 1000), 'under');
  assert.strictEqual(M.direction(1000, 10), 'over');
  assert.strictEqual(M.direction(5, 5), 'exact');
});

test('median of odd and even lists', function () {
  assert.strictEqual(M.median([5, 1, 3]), 3);
  assert.strictEqual(M.median([4, 1, 3, 2]), 2.5);
  assert.strictEqual(M.median([]), null);
});

// ------------------------------------------------------------------ data-shape maths

test('Zipf-like masses sum to 1 and theta = 0 is uniform', function () {
  [0, 0.3, 0.8, 0.9].forEach(function (th) {
    var s = 0;
    for (var k = 0; k < 1000; k++) s += M.zipfMass(th, 1000, k);
    near(s, 1, 1e-9, 'theta ' + th);
  });
  near(M.zipfMass(0, 1000, 0), 0.001, 1e-12);
  near(M.zipfMass(0, 1000, 999), 0.001, 1e-12);
});

test('Zipf-like masses fall off as k^-theta', function () {
  var th = 0.8, n = 20000;
  var r = M.zipfMass(th, n, 1000) / M.zipfMass(th, n, 100);
  near(r, Math.pow(10, -th), 0.01);
});

test('the generator formula draws ids with the stated masses (simulation)', function () {
  // Same transform as the SQL: id = floor(n * u^(1/(1-theta))), with a seeded PRNG for u.
  var seed = 12345;
  function rnd() { // mulberry32
    seed = (seed + 0x6D2B79F5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  var n = 200, th = 0.7, a = M.exponentFor(th), N = 200000;
  var counts = new Array(n).fill(0);
  for (var i = 0; i < N; i++) counts[Math.min(n - 1, Math.floor(n * Math.pow(rnd(), a)))]++;
  [0, 1, 5, 50, 199].forEach(function (k) {
    var p = M.zipfMass(th, n, k);
    var sd = Math.sqrt(N * p * (1 - p));
    assert.ok(Math.abs(counts[k] - N * p) < 5 * sd + 2, 'id ' + k + ': ' + counts[k] + ' vs ' + (N * p).toFixed(0));
  });
});

test('expected() reduces to the textbook model on uniform, independent data', function () {
  // Equal up to rounding: 20,000 customers do not split exactly into 60 cities (cities 0-19 get 334).
  var e = M.expected({ theta: 0, rho: 0, scope: 'province' }, 1000000);
  near(e.ordersInScope, 1000000 * 1670 / 20000, 1e-6);
  near(e.ordersInScope / e.uniformIndependent.ordersInScope, 1, 0.005);
  near(e.starJoinRows / e.uniformIndependent.starJoinRows, 1, 0.005);
  near(e.bestSellerRows, e.uniformIndependent.bestSellerRows, 1e-6);
});

test('correlation raises the star join; skew raises the best seller', function () {
  var base = M.expected({ theta: 0, rho: 0, scope: 'province' }, 1000000).starJoinRows;
  var corr = M.expected({ theta: 0, rho: 0.8, scope: 'province' }, 1000000).starJoinRows;
  // rho = 0.8: P = 1/12 * (0.8 + 0.2/12)
  near(corr, 1000000 * 1670 / 20000 * (0.8 + 0.2 / 12), 1e-6);
  assert.ok(corr / base > 9, 'about tenfold');
  var best = M.expected({ theta: 0.8, rho: 0, scope: 'province' }, 1000000).bestSellerRows;
  near(best, 1000000 * Math.pow(1 / 1008, 0.2), 1);
});

// ------------------------------------------------------------------ Cramér's V

function mixtureCells(rho, k, total) {
  var cells = [];
  for (var a = 0; a < k; a++) for (var b = 0; b < k; b++) {
    cells.push({ a: a, b: b, n: total * (rho * (a === b ? 1 / k : 0) + (1 - rho) / (k * k)) });
  }
  return cells;
}

test('Cramér’s V is 0 for independence, 1 for a perfect link, rho for the mixture', function () {
  near(M.cramersV(mixtureCells(0, 12, 1e6)), 0, 1e-9);
  near(M.cramersV(mixtureCells(1, 12, 1e6)), 1, 1e-9);
  [0.2, 0.5, 0.8].forEach(function (r) { near(M.cramersV(mixtureCells(r, 12, 1e6)), r, 1e-9, 'rho ' + r); });
});

// ------------------------------------------------------------------ SQL

test('data SQL is deterministic, seeded and sized from the setting', function () {
  var a = M.dataSql({ theta: 0.8, rho: 0.5 }, 400000);
  var b = M.dataSql({ theta: 0.8, rho: 0.5 }, 400000);
  assert.deepStrictEqual(a, b);
  assert.strictEqual(a.length, 3);
  assert.ok(/generate_series\(0, 7999\)/.test(a[0]), 'customers = orders / 50');
  assert.ok(/generate_series\(0, 1007\)/.test(a[1]));
  assert.ok(/generate_series\(0, 399999\)/.test(a[2]));
  assert.ok(a[2].indexOf(', ' + M.SEED + ')') > 0, 'hash is seeded');
  assert.ok(a[2].indexOf('5.000000') > 0, 'exponent 1/(1-0.8) = 5');
  assert.ok(a[2].indexOf('% 1000003) % 1000 < 500 AS local') > 0, 'rho as per-mille, from a prime-reduced stream');
});

test('validateSql accepts reads and refuses writes, files and stacked statements', function () {
  assert.ok(M.validateSql('SELECT count(*) FROM orders').ok);
  assert.ok(M.validateSql('with t as (select * from customers) select count(*) from t;').ok);
  assert.ok(M.validateSql("SELECT 'it''s fine' AS x").ok);
  assert.ok(M.validateSql('-- a comment\nSELECT 1').ok);
  [
    'DROP TABLE orders',
    'SELECT 1; DROP TABLE orders',
    "SELECT * FROM read_csv('https://example.com/x.csv')",
    "SELECT * FROM 'data.parquet'",
    "COPY orders TO 'x.csv'",
    'ATTACH \'x.db\'',
    'SELECT * FROM orders /* unterminated',
    "SELECT * FROM query('select 1')",
    'PRAGMA version',
    "SET enable_external_access = true",
    ''
  ].forEach(function (sql) { assert.ok(!M.validateSql(sql).ok, 'should refuse: ' + sql); });
});

test('validateSql: keywords only count as keywords, not as aliases or quoted names', function () {
  [
    'SELECT "set" FROM orders',
    'SELECT 1 AS load',
    'SELECT city AS "show" FROM customers',
    'SELECT o.amount AS "update", c.city AS use FROM orders o JOIN customers c ON o.customer_id = c.id'
  ].forEach(function (sql) { var v = M.validateSql(sql); assert.ok(v.ok, 'should accept: ' + sql + ' — ' + v.reason); });
});

test('validateSql refuses recursion and quoted file functions', function () {
  var rec = M.validateSql('WITH RECURSIVE t(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM t) SELECT count(*) FROM t');
  assert.ok(!rec.ok && /Recursive/.test(rec.reason), rec.reason);
  assert.ok(!M.validateSql('with recursive t as (select 1) select * from t').ok);
  assert.ok(!M.validateSql("SELECT * FROM \"read_csv\"('x')").ok, 'quoted function name');
  assert.ok(!M.validateSql("SELECT * FROM \"read_csv_auto\" ('x')").ok, 'quoted function name with a space');
});

test('the preset SQL, and the text each preset puts in the box, pass the validator', function () {
  ['star', 'best', 'fixed'].forEach(function (p) {
    ['city', 'province', 'country'].forEach(function (s) {
      assert.ok(M.validateSql(M.PRESETS[p].sql(s)).ok, p + '/' + s);
      var v = M.validateSql(M.presetText(p, s));
      assert.ok(v.ok, 'box text ' + p + '/' + s + ': ' + v.reason);
    });
  });
  assert.ok(/^-- /m.test(M.presetText('fixed', 'province')), 'the materialise step is shown as a comment');
});

// ------------------------------------------------------------------ what the step copy says about the data

test('home-category share is rho + (1 - rho)/12 on the mixture, and is what the page measures', function () {
  [0, 0.5, 0.8, 1].forEach(function (r) { near(M.diagonalShare(mixtureCells(r, 12, 1e6)), M.homeShareExpected(r), 1e-9, 'rho ' + r); });
  near(M.homeShareExpected(0.8), 0.8167, 1e-4);
});

test('step 3: the busiest customer lives in city 0 and alone explains city 0’s excess orders', function () {
  var th = M.STEPS[2].settings.theta, C = M.shape(M.SIZES.laptop).customers;
  assert.strictEqual(M.STEPS[2].settings.scope, 'city');
  assert.strictEqual(M.cityOfCustomer(0), 0, 'customer 0 lives in city 0');
  var top = M.zipfMass(th, C, 0);
  assert.ok(top > 0.13 && top < 0.15, 'busiest customer ' + top);
  var top10 = M.zipfMassWhere(th, C, function (k) { return k < 10; });
  assert.ok(top10 < 0.25, 'a few customers do not place most orders: top 10 place ' + top10);
  var city0 = M.zipfMassWhere(th, C, function (k) { return M.cityOfCustomer(k) === 0; });
  var city0Rest = city0 - top;
  assert.ok(city0 > 5 / 60, 'city 0 holds far more than a uniform share: ' + city0);
  assert.ok(city0Rest < 1 / 60, 'without customer 0, city 0 is below a uniform share: ' + city0Rest);
  var quieter = 0;
  for (var c = 0; c < 60; c++) {
    if (M.zipfMassWhere(th, C, function (k) { return M.cityOfCustomer(k) === c; }) < 1 / 60) quieter++;
  }
  assert.ok(quieter >= 50, 'most cities get fewer orders than a uniform share: ' + quieter);
  assert.ok(M.zipfMassWhere(th, C, function (k) { return M.cityOfCustomer(k) === 30; }) < 1 / 60, 'city 30 is a quiet city');
});

test('the page copy does not credit skew with the plan flip', function () {
  var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  var app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  var lede = /<p class="kit-lede">([\s\S]*?)<\/p>/.exec(html)[1];
  var label = /id="cd-preview"[^>]*aria-label="([^"]*)"/.exec(html)[1];
  [lede, label].forEach(function (t) {
    assert.ok(!/skew[^.;]*until the plan flips/i.test(t), 'claims skew flips the plan: ' + t);
    assert.ok(/widen/i.test(t), 'names the widened filter: ' + t);
  });
  assert.ok(/filter widened → plan flips/.test(app), 'the preview labels the flip frame');
  assert.ok(lede.split(/\s+/).length <= 95, 'lede stays short');
});

// ------------------------------------------------------------------ plan parsing

var FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'profile-best-province.json'), 'utf8'));

test('parseProfile reads estimates and actual rows from DuckDB’s JSON profile', function () {
  var tree = M.parseProfile(FIXTURE.explain_value);
  assert.strictEqual(tree.op, 'UNGROUPED_AGGREGATE', 'EXPLAIN_ANALYZE and PROJECTION are collapsed');
  var join = tree.children[0];
  assert.strictEqual(join.op, 'HASH_JOIN');
  assert.strictEqual(join.children.length, 2);
  var probe = join.children[0], build = join.children[1];
  assert.strictEqual(probe.role, 'probe');
  assert.strictEqual(build.role, 'build');
  assert.strictEqual(probe.table, 'customers');
  assert.strictEqual(build.table, 'orders');
  assert.strictEqual(build.detail, 'product_id=0');
  assert.strictEqual(typeof build.est, 'number');
  assert.strictEqual(typeof build.act, 'number');
  assert.ok(build.act / build.est > 50, 'the fixture is the skewed, flipped plan');
  assert.ok(join.timeMs >= 0);
});

test('flatten gives stable keys and q-errors from the engine’s numbers', function () {
  var rows = M.flatten(M.parseProfile(FIXTURE.explain_value));
  var keys = rows.map(function (r) { return r.key; });
  assert.strictEqual(new Set(keys).size, keys.length);
  rows.forEach(function (r) { assert.strictEqual(r.q, M.qError(r.node.est, r.node.act)); });
});

test('describeChange explains a build-side flip and stays quiet when nothing changed', function () {
  var flipped = M.parseProfile(FIXTURE.explain_value);
  var city = JSON.parse(JSON.stringify(flipped));
  var join = city.children[0];
  join.children.reverse();
  join.children[0].role = 'probe'; join.children[1].role = 'build';
  assert.strictEqual(M.describeChange(flipped, flipped), null);
  var s = M.describeChange(city, flipped);
  assert.ok(/builds its hash table on orders/.test(s), s);
  assert.ok(/instead of customers/.test(s), s);
});

test('describeChange explains a join-order change', function () {
  function scan(t, est) { return { op: 'SEQ_SCAN', table: t, detail: '', est: est, act: est, children: [] }; }
  function join(a, b, est) { a.role = 'probe'; b.role = 'build'; return { op: 'HASH_JOIN', name: 'Hash join', table: '', detail: '', est: est, act: est, children: [a, b] }; }
  var p1 = join(join(scan('orders', 1e6), scan('customers', 300), 18000), scan('products', 80), 1200);
  var p2 = join(join(scan('orders', 1e6), scan('products', 80), 60000), scan('customers', 300), 1200);
  var s = M.describeChange(p1, p2);
  assert.ok(/join order changed/.test(s) && /orders and products first/.test(s) && /then adds customers/.test(s), s);
});

test('parseExplain lists operators with estimates', function () {
  var list = M.parseExplain([{ name: 'HASH_JOIN', extra_info: { 'Estimated Cardinality': '1230' }, children: [{ name: 'SEQ_SCAN ', extra_info: { 'Estimated Cardinality': '1000000' }, children: [] }] }]);
  assert.deepStrictEqual(list, [{ op: 'HASH_JOIN', est: 1230 }, { op: 'SEQ_SCAN', est: 1000000 }]);
});

test('log axis positions', function () {
  assert.strictEqual(M.logPos(1, 1e6), 0);
  near(M.logPos(1000, 1e6), 0.5, 1e-12);
  assert.strictEqual(M.logPos(1e7, 1e6), 1);
  assert.deepStrictEqual(M.logTicks(1e3), [1, 10, 100, 1000]);
  assert.strictEqual(M.shortCount(250531), '251k');
  assert.strictEqual(M.shortCount(1500), '1.5k');
});

console.log(passed + ' model tests passed' + (process.exitCode ? ', some FAILED' : ''));
