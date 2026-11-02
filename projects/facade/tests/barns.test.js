// Node test for the barn geometry. Run: node projects/facade/tests/barns.test.js
// The claim the opening scene rests on: from the road, a facade and a real barn look the same.
'use strict';
var assert = require('assert');
var path = require('path');
var F = require(path.join(__dirname, '..', 'model.js'));

var failures = 0, passes = 0;
function test(name, fn) {
  try { fn(); passes++; console.log('ok   ' + name); }
  catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + e.message); }
}
function close(a, b, eps) { return Math.abs(a - b) < (eps || 1e-9); }

var V = F.VALLEY;

test('the valley: six fronts, one real barn, and it is the last one asked about', function () {
  assert.strictEqual(V.barns.length, 6);
  var real = V.barns.map(function (b, i) { return b.real ? i : -1; }).filter(function (i) { return i >= 0; });
  assert.deepStrictEqual(real, [V.asked[V.asked.length - 1]]);
  assert.ok(V.asked.length === 3);
});

test('the real barn shares its colour with a facade, so colour cannot give it away', function () {
  var real = V.barns.filter(function (b) { return b.real; })[0];
  assert.ok(V.barns.some(function (b) { return !b.real && b.colour === real.colour; }));
});

test('from the road (theta = 0), a real barn shows nothing but its front', function () {
  V.barns.forEach(function (b) {
    var real = Object.assign({}, b, { real: true });
    F.barnParts(real, 0, V.depth).forEach(function (p) {
      if (p.part !== 'front') assert.ok(F.polygonArea(p.pts) < 1e-9, p.part + ' should have no area from the road');
    });
  });
});

test('from the road, a facade’s struts and edge are hidden behind its front', function () {
  V.barns.forEach(function (b) {
    var fake = Object.assign({}, b, { real: false });
    var parts = F.barnParts(fake, 0, V.depth);
    var front = parts.filter(function (p) { return p.part === 'front'; })[0].pts;
    parts.forEach(function (p) {
      if (p.part === 'front') return;
      p.pts.forEach(function (pt) {
        // Points on or inside the outline: nudge toward the centroid to test the boundary case.
        var c = [0, b.h * 0.5];
        var nudged = [pt[0] + (c[0] - pt[0]) * 1e-6, pt[1] + (c[1] - pt[1]) * 1e-6];
        assert.ok(F.pointInPolygon(nudged, front), p.part + ' point ' + pt + ' visible from the road');
      });
    });
  });
});

test('from the road, real and fake fronts of the same size project identically', function () {
  V.barns.forEach(function (b) {
    var a = F.barnParts(Object.assign({}, b, { real: true }), 0, V.depth).filter(function (p) { return p.part === 'front'; })[0];
    var c = F.barnParts(Object.assign({}, b, { real: false }), 0, V.depth).filter(function (p) { return p.part === 'front'; })[0];
    assert.deepStrictEqual(a.pts, c.pts);
  });
});

test('swung round, the difference shows: the real barn has a side wall, the facade has struts', function () {
  var th = F.MAX_SWING;
  var real = V.barns.filter(function (b) { return b.real; })[0];
  var side = F.barnParts(real, th, V.depth).filter(function (p) { return p.part === 'side'; })[0];
  assert.ok(F.polygonArea(side.pts) > 0.5 * real.h * V.depth * Math.sin(th));
  var fake = V.barns[0];
  var parts = F.barnParts(fake, th, V.depth);
  var front = parts.filter(function (p) { return p.part === 'front'; })[0].pts;
  var struts = parts.filter(function (p) { return p.part === 'strut'; });
  assert.ok(struts.length >= 2);
  struts.forEach(function (s) { assert.ok(!F.pointInPolygon(s.pts[1], front), 'strut foot shows behind the facade'); });
});

test('planeAt agrees with project for points on the front and on the rear wall', function () {
  [0, 0.3, 1.2, F.MAX_SWING].forEach(function (th) {
    [0, V.depth].forEach(function (z0) {
      var m = F.planeAt(th, z0);
      [[-30, 0], [20, 40], [0, 70]].forEach(function (p) {
        var q = F.project(th, p[0], p[1], z0);
        assert.ok(close(q[0], m.xx * p[0] + m.ox) && close(q[1], m.xy * p[0] + m.yy * p[1] + m.oy), 'theta ' + th + ' z ' + z0);
      });
    });
  });
});

test('fully swung round, the view is from behind: a facade shows the back of its board', function () {
  assert.ok(F.seesBack(F.MAX_SWING));
  assert.ok(!F.seesBack(0));
  var real = V.barns.filter(function (b) { return b.real; })[0];
  var parts = F.barnParts(real, F.MAX_SWING, V.depth).map(function (p) { return p.part; });
  assert.strictEqual(parts[parts.length - 1], 'rear', 'the real barn’s far wall is drawn last, nearest the viewer');
  var fparts = F.barnParts(V.barns[0], F.MAX_SWING, V.depth).map(function (p) { return p.part; });
  assert.ok(fparts.indexOf('front') < fparts.indexOf('strut'), 'from behind, the struts stand in front of the board');
});

test('preview loop has one real barn among four', function () {
  assert.strictEqual(F.PREVIEW.barns.filter(function (b) { return b.real; }).length, 1);
  assert.strictEqual(F.PREVIEW.period, F.PREVIEW.barns.length * F.PREVIEW.spacing);
});

if (failures) { console.log('\n' + failures + ' failed, ' + passes + ' passed'); process.exit(1); }
console.log('\nall ' + passes + ' passed');
