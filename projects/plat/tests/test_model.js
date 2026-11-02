// Plat model and published-data checks. Run: node tests/test_model.js
// (d) CPI deflation matches a hand calculation.
// (e) No published cell has fewer properties than the suppression threshold.
// Plus: the JSON carries aggregates only, and the colour classes behave.
'use strict';
var assert = require('assert');
var path = require('path');
var fs = require('fs');
var P = require('../model.js');
var data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'plat.json'), 'utf8'));

var passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok   ' + name); }
  catch (e) { console.log('FAIL ' + name + '\n     ' + e.message); process.exitCode = 1; }
}

// ---------------------------------------------------------------- (d) CPI by hand
// Statistics Canada table 18-10-0005-01, Vancouver, all-items, annual average (2002=100):
// 2005 = 106.0, 2022 = 147.8, 2025 = 161.4 (read from the downloaded table).
test('(d) CPI values are the ones read from the StatCan table', function () {
  assert.strictEqual(data.meta.cpi.values['2005'], 106.0);
  assert.strictEqual(data.meta.cpi.values['2022'], 147.8);
  assert.strictEqual(data.meta.cpi.values['2025'], 161.4);
  assert.strictEqual(data.meta.cpi.base_year, 2025);
});

test('(d) the 2006 roll (valued 1 July 2005) in 2025 dollars, by hand', function () {
  // City median land value of lots, 2006 roll: $439,000 as assessed.
  var nominal = P.cell(data, -1, 2006, 'nonstrata', 'land', 'nominal');
  assert.strictEqual(nominal.med, 439000);
  // 439,000 x 161.4 / 106.0 = 70,854,600 / 106 = 668,439.62
  var real = P.cell(data, -1, 2006, 'nonstrata', 'land', 'real');
  assert.ok(Math.abs(real.med - 668439.62) < 0.01, 'got ' + real.med);
});

test('(d) the 2023 roll (valued 1 July 2022), and the 2026 roll needs no adjustment', function () {
  assert.ok(Math.abs(P.cpiFactor(data, 2023) - 161.4 / 147.8) < 1e-12);
  assert.strictEqual(P.cpiFactor(data, 2026), 1);
  var n = P.cell(data, 3, 2023, 'strata', 'total', 'nominal');
  var r = P.cell(data, 3, 2023, 'strata', 'total', 'real');
  assert.ok(Math.abs(r.q1 - n.q1 * 1.0920162381596752) < 1e-6);
  assert.ok(Math.abs(r.q3 - n.q3 * 1.0920162381596752) < 1e-6);
});

// ---------------------------------------------------------------- (e) suppression
test('(e) no published area cell has fewer than the threshold', function () {
  assert.strictEqual(data.meta.threshold, 10);
  var cells = P.publishedCells(data);
  assert.ok(cells.length > 800, 'expected many cells, got ' + cells.length);
  cells.forEach(function (c) { assert.ok(c.n >= 10, JSON.stringify(c)); });
});

test('(e) a withheld cell carries no values, and city cells meet the threshold too', function () {
  P.KINDS.forEach(function (k) {
    data.areas.forEach(function (_, a) {
      data.meta.years.forEach(function (y, yi) {
        if (!data.cells[k].n[a][yi]) P.MEASURES.forEach(function (m) { assert.strictEqual(data.cells[k][m][a][yi], 0); });
      });
    });
    data.city[k].n.forEach(function (n) { assert.ok(n >= 10); });
  });
});

test('(e) the model returns null for a withheld cell', function () {
  var copy = JSON.parse(JSON.stringify(data));
  copy.cells.strata.n[0][0] = 0;
  copy.cells.strata.land[0][0] = 0;
  assert.strictEqual(P.cell(copy, 0, data.meta.years[0], 'strata', 'land', 'real'), null);
});

// ---------------------------------------------------------------- privacy, shape
test('the JSON holds aggregates only: no folio, PID, address or owner fields', function () {
  var text = JSON.stringify(data).toLowerCase();
  ['folio', 'pid', 'street', 'postal', 'civic', 'owner', 'legal_line', 'plan'].forEach(function (w) {
    assert.ok(text.indexOf('"' + w) < 0, 'found key ' + w);
  });
  assert.deepStrictEqual(Object.keys(data).sort(), ['areas', 'cells', 'city', 'meta', 'permits', 'view']);
});

test('every area has a shape and every quantile triple is ordered', function () {
  assert.strictEqual(data.areas.length, 22);
  P.KINDS.forEach(function (k) {
    P.MEASURES.forEach(function (m) {
      data.cells[k][m].forEach(function (row) {
        row.forEach(function (q) { if (q) assert.ok(q[0] <= q[1] && q[1] <= q[2], JSON.stringify(q)); });
      });
    });
  });
  data.areas.forEach(function (a) { assert.ok(/^M[\d.,LMZ-]+Z$/.test(a.d), a.name); });
});

// ---------------------------------------------------------------- model behaviour
test('real quantiles are nominal quantiles times one factor per year', function () {
  data.meta.years.forEach(function (y) {
    var f = P.cpiFactor(data, y);
    var n = P.cell(data, 9, y, 'nonstrata', 'building', 'nominal');
    var r = P.cell(data, 9, y, 'nonstrata', 'building', 'real');
    assert.ok(Math.abs(r.med - n.med * f) < 1e-6);
    assert.strictEqual(r.n, n.n);
  });
});

test('colour classes: equal-count classes over all area-years, fixed across years', function () {
  var v = P.medians(data, 'nonstrata', 'land', 'real');
  var e = P.breaks(data, 'nonstrata', 'land', 'real', 7);
  assert.strictEqual(e.length, 8);
  assert.strictEqual(e[0], v[0]);
  assert.strictEqual(e[7], v[v.length - 1]);
  for (var i = 1; i < e.length; i++) assert.ok(e[i] >= e[i - 1]);
  // each class holds about a seventh of the area-years
  var counts = [0, 0, 0, 0, 0, 0, 0];
  v.forEach(function (x) { counts[P.classify(x, e)]++; });
  counts.forEach(function (c) { assert.ok(Math.abs(c - v.length / 7) <= 2, JSON.stringify(counts)); });
  // monotone: a higher median never gets a lighter class
  var last = -1;
  v.forEach(function (x) { var c = P.classify(x, e); assert.ok(c >= last); last = c; });
});

test('the card preview uses the same classes as the page', function () {
  var src = fs.readFileSync(path.join(__dirname, '..', 'data', 'preview.js'), 'utf8');
  var pv = JSON.parse(src.slice(src.indexOf('=') + 1, src.lastIndexOf(';')));
  var e = P.breaks(data, 'nonstrata', 'land', 'real', 7);
  pv.edges.forEach(function (x, i) { assert.ok(Math.abs(x - e[i]) <= 1, i + ': ' + x + ' vs ' + e[i]); });
  assert.strictEqual(pv.values.length, 22);
});

test('the card shows the city medians on one scale, each as its own bar, never summed', function () {
  var src = fs.readFileSync(path.join(__dirname, '..', 'data', 'preview.js'), 'utf8');
  var pv = JSON.parse(src.slice(src.indexOf('=') + 1, src.lastIndexOf(';')));
  // The card's figures are the page's real city medians for lots.
  pv.years.forEach(function (y, i) {
    var land = P.cell(data, -1, y, 'nonstrata', 'land', 'real').med;
    var bldg = P.cell(data, -1, y, 'nonstrata', 'building', 'real').med;
    assert.ok(Math.abs(pv.city[i][0] - land) <= 1 && Math.abs(pv.city[i][1] - bldg) <= 1, y);
  });
  var s = P.pairBars(pv.city);
  var top = 0;
  pv.city.forEach(function (c) { top = Math.max(top, c[0], c[1]); });
  s.forEach(function (b, i) {
    assert.ok(b[0] <= 1 && b[1] <= 1);
    assert.ok(Math.abs(b[0] - pv.city[i][0] / top) < 1e-12 && Math.abs(b[1] - pv.city[i][1] / top) < 1e-12);
  });
  // The largest single median fills its bar; nothing is scaled by land + building.
  assert.ok(s.some(function (b) { return b[0] === 1 || b[1] === 1; }));
  // And the sum of the two medians is not the median total (why they are not stacked).
  var last = pv.years[pv.years.length - 1];
  var tot = P.cell(data, -1, last, 'nonstrata', 'total', 'real').med;
  assert.ok(Math.abs(tot - (pv.city[pv.city.length - 1][0] + pv.city[pv.city.length - 1][1])) > 1000);
});

test('formatting', function () {
  assert.strictEqual(P.money(1873000), '$1.87M');
  assert.strictEqual(P.money(12500000), '$12.5M');
  assert.strictEqual(P.money(439000), '$439k');
  assert.strictEqual(P.pct(0.341), '+34%');
  assert.strictEqual(P.pct(-0.12), '−12%');
  assert.strictEqual(P.count(136720), '136,720');
});

console.log('\n' + passed + ' passed' + (process.exitCode ? ', some failed' : ''));
