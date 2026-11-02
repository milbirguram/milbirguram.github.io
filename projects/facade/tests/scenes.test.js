// Node test for the case scenes. Run: node projects/facade/tests/scenes.test.js
// The pictures must offer exactly the evidence cases.js defines, no more and no less, and must
// carry none of the epistemic facts themselves (cases.js stays the single source of truth).
'use strict';
var assert = require('assert');
var path = require('path');
var CASES = require(path.join(__dirname, '..', 'cases.js'));
var S = require(path.join(__dirname, '..', 'scenes.js'));

var failures = 0, passes = 0;
function test(name, fn) {
  try { fn(); passes++; console.log('ok   ' + name); }
  catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + e.message); }
}

function basesOf(c) {
  var out = [];
  c.answers.forEach(function (a) { a.bases.forEach(function (b) { out.push({ id: b.id, answer: a.id, source: b.source }); }); });
  return out;
}

test('every case has a scene, and every scene belongs to a case', function () {
  var caseIds = CASES.map(function (c) { return c.id; }).sort();
  assert.deepStrictEqual(Object.keys(S.byId).sort(), caseIds);
});

test('within a case, each piece of evidence has its own id, so a hotspot names one answer’s basis', function () {
  CASES.forEach(function (c) {
    var ids = basesOf(c).map(function (b) { return b.id; });
    assert.strictEqual(new Set(ids).size, ids.length, c.id + ': basis ids ' + ids.join(','));
  });
});

test('every evidence option in cases.js has exactly one hotspot in its scene, and vice versa', function () {
  CASES.forEach(function (c) {
    var want = basesOf(c).map(function (b) { return b.id; }).sort();
    var got = S.byId[c.id].hotspots.map(function (h) { return h.basis; }).sort();
    assert.deepStrictEqual(got, want, c.id);
  });
});

test('hunches are drawn as thought clouds and evidence as things, matching each basis’s source', function () {
  CASES.forEach(function (c) {
    basesOf(c).forEach(function (b) {
      var h = S.byId[c.id].hotspots.filter(function (x) { return x.basis === b.id; })[0];
      assert.strictEqual(h.thought, b.source === 'hunch', c.id + '/' + b.id);
    });
  });
});

test('hotspots sit inside the picture, are big enough to press, have labels, and do not overlap', function () {
  Object.keys(S.byId).forEach(function (id) {
    var hs = S.byId[id].hotspots;
    hs.forEach(function (h) {
      assert.ok(h.x >= 0 && h.y >= 0 && h.x + h.w <= S.VW && h.y + h.h <= S.VH, id + '/' + h.basis + ' inside the view box');
      assert.ok(h.w >= 28 && h.h >= 28, id + '/' + h.basis + ' at least 28 units each way');
      assert.ok(typeof h.label === 'string' && h.label.length > 3, id + '/' + h.basis + ' has a label');
    });
    for (var i = 0; i < hs.length; i++) {
      for (var j = i + 1; j < hs.length; j++) {
        var a = hs[i], b = hs[j];
        var overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        assert.ok(!overlap, id + ': ' + a.basis + ' overlaps ' + b.basis);
      }
    }
  });
});

test('scenes carry pictures only: no truth values, no tracking, no outcomes', function () {
  var allowed = ['basis', 'x', 'y', 'w', 'h', 'label', 'thought'];
  Object.keys(S.byId).forEach(function (id) {
    var sc = S.byId[id];
    assert.deepStrictEqual(Object.keys(sc).sort(), ['alt', 'back', 'backAlt', 'backCaption', 'front', 'hotspots'], id + ' fields');
    sc.hotspots.forEach(function (h) {
      Object.keys(h).forEach(function (k) { assert.ok(allowed.indexOf(k) >= 0, id + '/' + h.basis + ' has field ' + k); });
    });
  });
});

test('every drawing renders to clean markup', function () {
  Object.keys(S.byId).forEach(function (id) {
    ['front', 'back'].forEach(function (side) {
      var svg = S.byId[id][side]('t');
      assert.ok(typeof svg === 'string' && svg.length > 500, id + '.' + side + ' draws something');
      assert.ok(!/undefined|NaN|null/.test(svg), id + '.' + side + ' has a bad value');
      var opens = (svg.match(/<g[ >]/g) || []).length, closes = (svg.match(/<\/g>/g) || []).length;
      assert.strictEqual(opens, closes, id + '.' + side + ' groups balanced');
      assert.ok(!/&(?![a-z]+;|#\d+;)/.test(svg), id + '.' + side + ' has a raw ampersand');
    });
    assert.ok(S.byId[id].alt.length > 40 && S.byId[id].backAlt.length > 40, id + ' has descriptions');
  });
});

test('two drawings of the same scene on one page do not share gradient ids', function () {
  Object.keys(S.byId).forEach(function (id) {
    var a = S.byId[id].front('a'), b = S.byId[id].front('b');
    var ids = function (s) { return (s.match(/id="[^"]+"/g) || []); };
    ids(a).forEach(function (x) { assert.ok(ids(b).indexOf(x) < 0, id + ' reuses ' + x); });
  });
});

test('each turned scene has a short caption of what it shows, distinct from what the front already said', function () {
  CASES.forEach(function (c) {
    var cap = S.byId[c.id].backCaption;
    assert.ok(typeof cap === 'string' && cap.length >= 40 && cap.length <= 160, c.id + ' caption length ' + (cap && cap.length));
    assert.notStrictEqual(cap, c.truthmaker, c.id + ' caption is not just the truthmaker');
    assert.ok(!/!|\bknew\b|\blucky\b|\bluck\b|\bjustified\b/i.test(cap), c.id + ' caption pictures, not verdicts');
  });
  // The namesake-style case: the caption must name the hidden mechanism, not the visible reading.
  assert.ok(/stopped/.test(S.byId.clock.backCaption), 'clock caption says the clock had stopped');
});

test('nothing on a front gives away a hidden fact in plain words', function () {
  var giveaways = { forecast: /No connection|no signal/i, neighbour: /timer|Calgary/i, dog: /greyhound/i, sheep: /guardian|dog/i, clock: /stopped|battery/i };
  Object.keys(giveaways).forEach(function (id) {
    var front = S.byId[id].front('t').replace(/<[^>]+>/g, ' ');
    assert.ok(!giveaways[id].test(front), id + ' front text: ' + (front.match(giveaways[id]) || [])[0]);
    assert.ok(!giveaways[id].test(S.byId[id].alt), id + ' front description');
  });
});

test('the review site in the noodles scene has a generic name, not one that could be a real business', function () {
  var front = S.byId.noodles.front('t').replace(/<[^>]+>/g, ' ');
  assert.ok(!/CityBites/.test(front));
});

// The close-up slip on a 375 px phone (about 302 x 177, or 300 x 109 for wide things) and on a
// laptop (about 233 x 178, or 499 x 182 for wide things). Writing on what you pick up must
// come out at 12 CSS px or more, which the scene itself cannot manage on a phone.
test('close-ups make the writing on every piece of evidence readable, on a phone and a laptop', function () {
  CASES.forEach(function (c) {
    S.byId[c.id].hotspots.forEach(function (h) {
      var f = S.focusOf(c.id, h.basis);
      var boxes = f.wide ? [[300, 109], [499, 182]] : [[302, 177], [233, 178]];
      boxes.forEach(function (d) {
        var z = S.closeUp(c.id, h.basis, d[0], d[1]);
        assert.ok(z.x >= -1e-6 && z.y >= -1e-6 && z.x + z.w <= S.VW + 1e-6 && z.y + z.h <= S.VH + 1e-6, c.id + '/' + h.basis + ' crop inside the drawing');
        assert.ok(Math.abs(z.w / z.h - d[0] / d[1]) < 1e-6, c.id + '/' + h.basis + ' crop has the box’s shape, so nothing is letterboxed');
        if (z.textPx !== null) assert.ok(z.textPx >= 12, c.id + '/' + h.basis + ' at ' + d.join('x') + ': text ' + z.textPx.toFixed(1) + ' px');
        if (f.text) {
          var t = f.text;
          assert.ok(t.x >= z.x - 1 && t.x + t.w <= z.x + z.w + 1 && t.y >= z.y - 1 && t.y + t.h <= z.y + z.h + 1, c.id + '/' + h.basis + ' all its writing in the crop');
        }
      });
    });
  });
});

test('hotspots are big enough for a fingertip on a 375 px phone (343 px scene, with the 8 px touch margin)', function () {
  var k = 343 / S.VW;
  Object.keys(S.byId).forEach(function (id) {
    S.byId[id].hotspots.forEach(function (h) {
      assert.ok(h.w * k + 16 >= 44 && h.h * k + 16 >= 44, id + '/' + h.basis + ' ' + (h.w * k + 16).toFixed(0) + 'x' + (h.h * k + 16).toFixed(0) + ' px');
    });
  });
});

if (failures) { console.log('\n' + failures + ' failed, ' + passes + ' passed'); process.exit(1); }
console.log('\nall ' + passes + ' passed');
