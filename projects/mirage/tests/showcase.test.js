// The study shown first must demonstrate a *sequence* of choices, not one lucky switch:
// the peeking walk reaches p < 0.05 only at decision 4 or later, no single change to the
// plain analysis is significant on its own, and the plain analysis is not significant.
'use strict';
var M = require('../model.js');

var failures = 0;
function check(cond, msg) {
  if (cond) console.log('  ok  ' + msg);
  else { failures++; console.error('  FAIL ' + msg); }
}
function fmt(p) { return p.toFixed(3); }

// The page's own start seed (app.js SHOWCASE_START) and a few others, as "Walk again" does.
var fs = require('fs'), path = require('path');
var appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
var m = /SHOWCASE_START\s*=\s*(\d+)/.exec(appSrc);
check(!!m, 'app.js declares SHOWCASE_START');
var starts = [m ? +m[1] : 20261101, 1, 777, 424242, 99999999];

starts.forEach(function (start) {
  var s = M.findShowcase(start), g = s.garden;
  var trail = M.walkTrail(g, s.walk), cross = M.firstCrossing(g, s.walk);
  console.log('start ' + start + ': draw ' + s.tries + ', nSig ' + g.nSig + ', walk ' + s.walk.join('') +
    ', p along the walk ' + trail.map(fmt).join(' → '));
  check(s.tries < 1000, 'a showcase was found (not the fallback)');
  check(g.p[M.pathIndex(M.PREREG)] >= M.ALPHA, 'the plain, pre-registered path is not significant');
  check(trail[trail.length - 1] < M.ALPHA && g.sign[M.pathIndex(s.walk)] > 0, 'the peeking walk ends at p < 0.05 with walkers happier');
  check(cross >= 4, 'the walk first crosses 0.05 at decision ' + cross + ' (needs 4 or later)');
  for (var k = 0; k < cross - 1; k++) {
    // Every option shown at the decisions before the crossing is above 0.05, so the visitor
    // sees no significant option until several choices are made.
    var ch = M.PREREG.slice();
    for (var j = 0; j < k; j++) ch[j] = s.walk[j];
    var minP = Infinity;
    for (var o = 0; o < M.RADIX[k]; o++) { ch[k] = o; minP = Math.min(minP, g.p[M.pathIndex(ch)]); }
    if (!(minP >= M.ALPHA)) check(false, 'decision ' + (k + 1) + ' shows a significant option');
  }
  check(M.singleChangeHits(g) === 0, 'no single change to the plain analysis is significant on its own');
  check(M.pathIndex(s.walk) === M.pathIndex(M.peekingWalk(g)), 'the showcase walk is the peeking walk');
});

// The helpers agree with a direct recomputation.
var s0 = M.findShowcase(starts[0]);
var direct = M.analysePath(s0.study, s0.walk).p;
check(Math.abs(direct - s0.garden.p[M.pathIndex(s0.walk)]) < 1e-12, 'garden p of the walk equals analysePath');

if (failures) { console.error(failures + ' showcase check(s) failed'); process.exit(1); }
console.log('showcase: all checks passed');
