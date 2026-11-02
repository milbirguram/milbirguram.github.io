// The card borrows the page's scale and label points without loading plat.json (a preview
// makes no fetches), so check that what app.js hard-codes still matches the data.
// Run: node tests/test_preview_style.js
'use strict';
var assert = require('assert');
var path = require('path');
var fs = require('fs');

var ROOT = path.join(__dirname, '..');
var app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
var data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'plat.json'), 'utf8'));
var src = fs.readFileSync(path.join(ROOT, 'data', 'preview.js'), 'utf8');
var pv = JSON.parse(src.slice(src.indexOf('=') + 1, src.lastIndexOf(';')));

var passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok   ' + name); }
  catch (e) { console.log('FAIL ' + name + '\n     ' + e.message); process.exitCode = 1; }
}

test('the card and the page share one projection', function () {
  assert.strictEqual(pv.w, data.view.w);
  assert.strictEqual(pv.h, data.view.h);
  assert.strictEqual(pv.areas.length, data.areas.length);
});

test('the card scale bar uses the page metres per unit', function () {
  var m = app.match(/var PV_M_PER_UNIT = ([\d.]+);/);
  assert.ok(m, 'PV_M_PER_UNIT not found');
  assert.ok(Math.abs(+m[1] - data.view.m_per_unit) < 1e-6, m[1] + ' vs ' + data.view.m_per_unit);
});

test('the card names sit on the right areas, at the page label points', function () {
  var block = app.slice(app.indexOf('var PV_NAMES'), app.indexOf('];', app.indexOf('var PV_NAMES')));
  var re = /\{ i: (\d+), name: '([^']+)', x: ([\d.]+), y: ([\d.]+) \}/g, m, n = 0;
  while ((m = re.exec(block))) {
    var a = data.areas[+m[1]];
    assert.strictEqual(a.name, m[2]);
    assert.ok(Math.abs(a.lx - +m[3]) < 0.05 && Math.abs(a.ly - +m[4]) < 0.05, m[2]);
    n++;
  }
  assert.ok(n >= 3 && n <= 4, n + ' names');
});

test('the card holds no red ink: the year is lettered in sepia, not brick red', function () {
  var pvCode = app.slice(app.indexOf('function initPreview'), app.indexOf('// ------------------------------------------------------------------ boot'));
  assert.ok(!/8c2f1c/i.test(pvCode));
  var css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  var card = css.slice(css.indexOf('the card preview */'));
  assert.ok(!/--pl-red/.test(card), 'card CSS uses red');
});

console.log('\n' + passed + ' passed' + (process.exitCode ? ', some failed' : ''));
