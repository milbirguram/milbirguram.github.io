// Node test for the card preview's timing. Run: node projects/facade/tests/preview.test.js
// The preview's card says "That is a barn — because it looks like one" and is stamped
// "Right by luck". That verdict is only honest while the real barn is on screen, already
// swung round to show it is real. The card's clock is computed from the camera, so it can
// never drift from the barns; this checks that, at the frame shapes the card is shown in.
'use strict';
var assert = require('assert');
var path = require('path');
var F = require(path.join(__dirname, '..', 'model.js'));

var failures = 0, passes = 0;
function test(name, fn) {
  try { fn(); passes++; console.log('ok   ' + name); }
  catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + e.message); }
}

var PV = F.PREVIEW;
var real = PV.barns.filter(function (b) { return b.real; })[0];
// app.js draws the preview with u = H / 370 world units per px, so the frame is 370 * W / H
// units across: 592 for the card's 16:10, and a little more or less if the card is reshaped.
var VIEWS = [520, 555, 592, 640];

// Where the real barn stands across the frame (0 = left, 1 = right) for each repeat of it
// that could be on screen.
function realPositions(cam, across) {
  var out = [];
  for (var n = -2; n <= Math.ceil(cam / PV.period) + 2; n++) out.push(0.5 + (real.x + n * PV.period - cam) / across);
  return out;
}
// Its "real barn" tag sits halfway along the swung-round side.
function tagFrac(xFrac, across) { return xFrac + (PV.depth * Math.sin(F.MAX_SWING) / 2) / across; }

test('the card loop is exactly one lap of the barns', function () {
  assert.ok(Math.abs(PV.loop - PV.period / PV.speed) < 1e-9);
  assert.ok(PV.loop >= 6 && PV.loop <= 12, 'loop ' + PV.loop + ' s');
  var c = PV.card;
  assert.ok(c.show < c.claim && c.claim < c.basis && c.basis < c.stamp && c.stamp < c.verdict && c.verdict < c.hide && c.hide + 0.5 <= PV.loop);
});

test('the card clock runs at one second per second and repeats with the barns', function () {
  for (var cam = 0; cam < 3 * PV.period; cam += 7) {
    var a = F.previewClock(cam), b = F.previewClock(cam + PV.speed * 0.1);
    var step = ((b - a) % PV.loop + PV.loop) % PV.loop;
    assert.ok(Math.abs(step - 0.1) < 1e-9, 'step ' + step + ' at ' + cam);
    assert.ok(Math.abs(F.previewClock(cam) - F.previewClock(cam + PV.period)) < 1e-9);
  }
});

test('whenever the stamp or verdict is showing, the real barn is on screen, fully swung round and labelled', function () {
  VIEWS.forEach(function (across) {
    for (var cam = 0; cam < 5 * PV.period; cam += 1) {
      var k = F.previewClock(cam);
      if (k < PV.card.stamp || k > PV.card.hide + 0.5) continue;
      var ok = realPositions(cam, across).some(function (x) {
        var tag = tagFrac(x, across);
        return F.previewSwing(x) === 1 && tag > 0.08 && tag < 0.92;
      });
      assert.ok(ok, 'frame ' + across + ' units, cam ' + cam + ', card at ' + k.toFixed(2) + ' s');
    }
  });
});

test('the still frame (paused, or reduced motion) shows the stamped card over the turned real barn', function () {
  VIEWS.forEach(function (across) {
    // app.js pvStill(): the camera stands 21% of the frame past the real barn.
    var x = 0.5 - 0.21;
    assert.strictEqual(F.previewSwing(x), 1, across);
    var tag = tagFrac(x, across);
    assert.ok(tag > 0.08 && tag < 0.92, across + ': tag at ' + tag.toFixed(2));
  });
  var still = PV.card.hide - 0.4;
  assert.ok(still > PV.card.verdict + 0.4 && still < PV.card.hide, 'still frame time shows the verdict in full');
});

if (failures) { console.log('\n' + failures + ' failed, ' + passes + ' passed'); process.exit(1); }
console.log('\nall ' + passes + ' passed');
