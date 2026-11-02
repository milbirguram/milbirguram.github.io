// Node tests for the Blastema model. Run: node projects/blastema/tests/model.test.js
// Optional: node projects/blastema/tests/model.test.js --quick   (fewer cuts, for a fast check)
//
// (a) Locality: a cell's next state depends only on itself and its six neighbours.
// (b) Twenty random cuts at the page's three worm sizes, pieces chosen at the moment of the cut:
//     every piece at least 0.4 of the worm rebuilds exactly one head and one tail, with head,
//     pharynx and tail in proportion; pieces of 0.25-0.4 mostly do (the rate is printed).
//     tests/survey.js runs a larger batch and prints the failure rate by piece size.
// (c) Rewrite: after one touch of the page's brush, a cut gives a two-headed worm, and cutting
//     that worm again gives two-headed worms again.
'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var B = require(path.join(__dirname, '..', 'model.js'));
var Model = B.Model, ID = B.ID, SQ3_2 = B.SQ3_2;

var QUICK = process.argv.indexOf('--quick') >= 0;
var failures = 0, passes = 0;
function test(name, fn) {
  var t0 = Date.now();
  try { fn(); passes++; console.log('ok   ' + name + '  (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)'); }
  catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n     ') : e)); }
}

// Tolerances stated on the page ("How I know").
var TOL = {
  head: [0.12, 0.32],       // head (with eyes) as a fraction of body length
  tail: [0.10, 0.30],       // tail as a fraction of body length
  pharynx: [0.42, 0.68],    // centre of the pharynx, measured from the head end
  aspect: [2.8, 6.5],       // body length / body width
  steps: 3000               // a piece is patterned within this many steps (20 s at 150 steps a second)
};
var MIN_FRACTION = 0.25;    // pieces this long (fraction of the worm, at the moment of the cut) are checked
var SURE_FRACTION = 0.4;    // pieces at least this long must all regenerate; shorter ones mostly do
var SIZES = [80, 100, 120]; // the worm lengths the page uses (phone and preview, middle, wide)

function rng(seed) {
  var a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A straight cut across the whole stage through (X, Y), at angle th from vertical (radians).
function cutAcross(m, X, Y, th) {
  var H = m.ny * SQ3_2, dx = Math.tan(th) * H;
  return m.cut(X - dx / 2 * (Y / (H / 2)), 0, X + dx / 2 * ((H - Y) / (H / 2)), H);
}
function cutAt(m, X, Y, th) {
  var H = m.ny * SQ3_2, s = Math.sin(th), c = Math.cos(th);
  return m.cut(X - s * H, Y - c * H, X + s * H, Y + c * H);
}

function headEnd(m, b) {
  var h = b.orgs.filter(function (o) { return o.type === B.HEAD; })[0];
  return h ? (h.X > b.cx ? 'right' : 'left') : null;
}

function anatomy(m, b) {
  var L = m.layout(b);
  var side = headEnd(m, b);
  var endX = side === 'right' ? b.maxX : b.minX;
  var fromHead = function (x) { return Math.abs(endX - x) / L.L; };
  return {
    heads: b.heads, tails: b.tails,
    head: L.head ? L.head.len : 0,
    tail: L.tail ? L.tail.len : 0,
    pharynx: L.pharynx ? fromHead(L.pharynx.mid) : -1,
    eyes: b.counts[ID.EYE],
    aspect: b.length / b.width,
    n: b.n, length: b.length
  };
}

// Step until every large piece shows its expected organisers and no wound or bud, or give up.
function runUntilPatterned(m, minLen, expect, maxSteps) {
  var t0 = m.t;
  while (m.t - t0 < maxSteps) {
    m.step(50);
    var big = m.bodies().filter(function (b) { return b.length >= minLen; });
    if (big.length && big.every(function (b) { return expect(b) && b.wound === 0 && b.blast === 0 && b.valid === b.n; })) return m.t - t0;
  }
  return -1;
}

// ---------------------------------------------------------------- (a) locality
test('(a) a cell\'s update reads only itself and its six neighbours', function () {
  var A = new Model({ L0: 90, seed: 11 });
  cutAt(A, A.nx / 2 + 8, A.ny * SQ3_2 / 2, 0.3);
  A.step(180);                      // mid-regeneration: wounds, buds, alarm, stale signals
  A.paint(A.nx / 2 - 30, A.ny * SQ3_2 / 2, 8);
  A.step(3);
  var Bm = new Model({ L0: 90, seed: 11 });
  var r = rng(5);
  var fieldsC = B.RELAYED.map(function (f) { return f[0]; });
  var fieldsO = B.OWN.map(function (f) { return f[0]; });
  function scramble(M, i) {
    M.state[i] = r() < 0.6 ? 1 : (r() < 0.5 ? 0 : 2);
    fieldsC.forEach(function (f) { M.cur[f][i] = Math.floor(r() * 200); M.nxt[f][i] = Math.floor(r() * 200); });
    fieldsO.forEach(function (f) { if (f !== 'state') M[f][i] = Math.floor(r() * 3); });
    M.cur.mem[i] = r();
  }
  function copySite(from, to, i) {
    to.state[i] = from.state[i];
    fieldsC.forEach(function (f) { to.cur[f][i] = from.cur[f][i]; to.nxt[f][i] = from.nxt[f][i]; });
    fieldsO.forEach(function (f) { to[f][i] = from[f][i]; });
  }
  function ring(M, i, depth) {          // sites within `depth` hops
    var seen = {}, frontier = [i]; seen[i] = 0;
    for (var d = 0; d < depth; d++) {
      var next = [];
      frontier.forEach(function (a) { for (var k = 0; k < 6; k++) { var j = M.NB[a * 6 + k]; if (j >= 0 && !(j in seen)) { seen[j] = d + 1; next.push(j); } } });
      frontier = next;
    }
    return seen;
  }
  // Fill the whole second model with garbage once.
  for (var q = 0; q < Bm.N; q++) scramble(Bm, q);
  Bm.t = A.t;
  var tissue = [], empty = [];
  for (var i = 0; i < A.N; i++) {
    if (A.state[i] !== 0) tissue.push(i);
    else { for (var k = 0; k < 6; k++) { var j = A.NB[i * 6 + k]; if (j >= 0 && A.state[j] === 1) { empty.push(i); break; } } }
  }
  function sample(arr, n) { var out = []; for (var a = 0; a < n; a++) out.push(arr[Math.floor(r() * arr.length)]); return out; }
  var special = tissue.filter(function (c) { return A.wound[c] || A.blast[c] || A.org[c]; });
  var cells = sample(tissue, 250).concat(sample(special, 150));
  var sites = sample(empty, 250);
  var outC = fieldsC, outO = fieldsO.filter(function (f) { return f !== 'offX' && f !== 'offY'; });

  function result(M, i) {
    var o = { die: M.dieFlag[i] };
    outC.forEach(function (f) { o['n.' + f] = M.nxt[f][i]; });
    outO.forEach(function (f) { o[f] = M[f][i]; });
    return o;
  }
  var checked = 0;
  cells.forEach(function (i) {
    var hood = ring(A, i, 3);
    // reference: A's own update, then undo it
    var saveOwn = {}; outO.forEach(function (f) { saveOwn[f] = A[f][i]; });
    var saveN = {}; outC.forEach(function (f) { saveN[f] = A.nxt[f][i]; });
    A.dieFlag[i] = 0;
    A.updateCell(i);
    var want = result(A, i);
    outO.forEach(function (f) { A[f][i] = saveOwn[f]; });
    outC.forEach(function (f) { A.nxt[f][i] = saveN[f]; });
    A.dieFlag[i] = 0;
    // fresh garbage up to three hops out, then the real cell and its six neighbours on top
    Object.keys(hood).forEach(function (s) { if (hood[s] >= 2) scramble(Bm, +s); });
    Object.keys(hood).forEach(function (s) { if (hood[s] <= 1) copySite(A, Bm, +s); });
    Bm.dieFlag[i] = 0;
    Bm.updateCell(i);
    assert.deepStrictEqual(result(Bm, i), want, 'cell ' + i + ' differs when distant sites change');
    checked++;
  });
  sites.forEach(function (s) {
    var hood = ring(A, s, 3);
    A.born[s] = 0; A.updateSite(s);
    var want = { born: A.born[s], parent: A.born[s] ? A.bornParent[s] : -1, blast: A.born[s] ? A.bornBlast[s] : -1 };
    A.born[s] = 0;
    Object.keys(hood).forEach(function (q) { if (hood[q] >= 2) scramble(Bm, +q); });
    Object.keys(hood).forEach(function (q) { if (hood[q] <= 1) copySite(A, Bm, +q); });
    Bm.born[s] = 0; Bm.updateSite(s);
    var got = { born: Bm.born[s], parent: Bm.born[s] ? Bm.bornParent[s] : -1, blast: Bm.born[s] ? Bm.bornBlast[s] : -1 };
    Bm.born[s] = 0;
    assert.deepStrictEqual(got, want, 'site ' + s + ' differs when distant sites change');
    checked++;
  });
  assert.ok(checked >= 600);
  assert.ok(special.length > 20, 'the sample includes wound, bud and organiser cells');
});

test('(a) the cell rules contain no global look-ups', function () {
  var src = fs.readFileSync(path.join(__dirname, '..', 'model.js'), 'utf8');
  ['updateCell', 'updateSite'].forEach(function (name) {
    var start = src.indexOf('Model.prototype.' + name + ' = function');
    assert.ok(start > 0, name + ' found');
    var end = src.indexOf('\n  };', start);
    var body = src.slice(start, end);
    var bad = body.match(/this\.(N|nx|ny|list|frontier|components|bodies|layout|cut|paint)\b/g);
    assert.ok(!bad, name + ' uses ' + bad);
    var idx = body.match(/\[[^\]]+\]/g) || [];
    idx.forEach(function (ix) {
      assert.ok(/^\[(i|j|s|p|base \+ k|base \+ RING\[r|r|RING\[r|f|0|k)\]?\]$/.test(ix), name + ' indexes with ' + ix);
    });
  });
});

// ---------------------------------------------------------------- (b) random cuts
// Pieces are chosen at the moment of the cut, by their length then, and followed to the end by
// the cells they started with. A piece that fades away is counted as a failure.
function piecesNow(m) {
  return m.bodies().map(function (b) { return { cells: b.cells.slice(), frac: b.length / m.L0 }; });
}
// The body each piece became: the one holding most of the piece's original sites (or null).
function follow(m, pieces) {
  var bodies = m.bodies(), owner = new Int32Array(m.N).fill(-1);
  bodies.forEach(function (b, bi) { b.cells.forEach(function (i) { owner[i] = bi; }); });
  return pieces.map(function (p) {
    var cnt = {}, best = -1, bc = 0;
    p.cells.forEach(function (i) { if (owner[i] >= 0) cnt[owner[i]] = (cnt[owner[i]] || 0) + 1; });
    Object.keys(cnt).forEach(function (q) { if (cnt[q] > bc) { bc = cnt[q]; best = +q; } });
    return best >= 0 ? bodies[best] : null;
  });
}
function patterned(b, expect) { return b && expect(b) && b.wound === 0 && b.blast === 0 && b.valid === b.n; }
function oneHeadOneTail(b) { return b.heads === 1 && b.tails === 1; }

// Cut, then follow every piece: steps until it is patterned, and its anatomy once it has reshaped.
function cutAndFollow(m, cutFn, minFrac, expect, maxSteps) {
  cutFn();
  var pieces = piecesNow(m).filter(function (p) { return p.frac >= minFrac; });
  var t0 = m.t, when = pieces.map(function () { return -1; });
  while (m.t - t0 < maxSteps) {
    m.step(50);
    follow(m, pieces).forEach(function (b, k) { if (when[k] < 0 && patterned(b, expect)) when[k] = m.t - t0; });
    if (when.every(function (w) { return w >= 0; })) break;
  }
  m.step(1200);                         // let the remodelling finish
  return follow(m, pieces).map(function (b, k) {
    return { frac: pieces[k].frac, steps: when[k], body: b, a: b ? anatomy(m, b) : null };
  });
}
function problems(p) {
  if (!p.body) return ['faded away'];
  var a = p.a, out = [];
  if (a.heads !== 1 || a.tails !== 1) out.push(a.heads + ' heads, ' + a.tails + ' tails');
  if (p.steps < 0) out.push('not patterned within ' + TOL.steps + ' steps');
  if (a.head < TOL.head[0] || a.head > TOL.head[1]) out.push('head ' + a.head.toFixed(2));
  if (a.tail < TOL.tail[0] || a.tail > TOL.tail[1]) out.push('tail ' + a.tail.toFixed(2));
  if (a.pharynx < TOL.pharynx[0] || a.pharynx > TOL.pharynx[1]) out.push('pharynx ' + a.pharynx.toFixed(2));
  if (a.aspect < TOL.aspect[0] || a.aspect > TOL.aspect[1]) out.push('aspect ' + a.aspect.toFixed(2));
  if (a.eyes < 2) out.push(a.eyes + ' eyespot cells');
  return out;
}

test('(b) 20 random cuts at the page\'s sizes: pieces at least ' + SURE_FRACTION + ' of the worm always rebuild one head and one tail, in proportion; pieces of ' + MIN_FRACTION + ' to ' + SURE_FRACTION + ' nearly always', function () {
  var n = QUICK ? 6 : 20, sure = 0, edge = 0, edgeOk = 0, slowest = 0, notes = [];
  for (var k = 1; k <= n; k++) {
    var L0 = SIZES[k % 3];
    var r = rng(k * 7919 + L0);
    var m = new Model({ L0: L0, seed: k });
    var body = m.bodies()[0];
    var u = 0.2 + 0.6 * r();
    var th = (r() - 0.5) * 2 * (35 * Math.PI / 180);
    var X = body.minX + u * (body.maxX - body.minX), Y = body.cy + (r() - 0.5) * 4;
    var tag = 'cut ' + k + ' (L0 ' + L0 + ', u ' + u.toFixed(2) + ', angle ' + (th * 180 / Math.PI).toFixed(0) + ')';
    var res = cutAndFollow(m, function () { cutAt(m, X, Y, th); }, MIN_FRACTION, oneHeadOneTail, TOL.steps);
    assert.ok(res.some(function (p) { return p.frac >= SURE_FRACTION; }), tag + ': a cut between 0.2 and 0.8 leaves a large piece');
    res.forEach(function (p) {
      var bad = problems(p);
      if (p.steps > slowest) slowest = p.steps;
      if (p.frac >= SURE_FRACTION) {
        sure++;
        assert.ok(!bad.length, tag + ' piece of ' + p.frac.toFixed(2) + ': ' + bad.join(', ') + ' ' + JSON.stringify(p.a));
      } else {
        edge++;
        if (!bad.length) edgeOk++; else notes.push(tag + ' piece of ' + p.frac.toFixed(2) + ': ' + bad.join(', '));
      }
    });
  }
  console.log('     ' + n + ' cuts; ' + sure + ' pieces >= ' + SURE_FRACTION + ' all right; ' + edgeOk + ' of ' + edge +
    ' pieces of ' + MIN_FRACTION + '-' + SURE_FRACTION + ' right; slowest patterned in ' + slowest + ' steps');
  notes.forEach(function (s) { console.log('       (allowed) ' + s); });
  if (edge) assert.ok(edgeOk / edge >= 0.8, 'borderline pieces mostly rebuild: ' + edgeOk + '/' + edge);
});

test('the uncut worm has the same proportions the tests demand of regenerated pieces', function () {
  SIZES.forEach(function (L0) {
    var m = new Model({ L0: L0, seed: 2 });
    var b = m.bodies()[0], p = anatomy(m, b);
    assert.strictEqual(m.bodies().length, 1);
    assert.strictEqual(p.heads, 1); assert.strictEqual(p.tails, 1);
    assert.ok(p.head >= TOL.head[0] && p.head <= TOL.head[1], JSON.stringify(p));
    assert.ok(p.tail >= TOL.tail[0] && p.tail <= TOL.tail[1], JSON.stringify(p));
    assert.ok(p.pharynx >= TOL.pharynx[0] && p.pharynx <= TOL.pharynx[1], JSON.stringify(p));
    if (L0 >= 100) assert.ok(b.n >= 2000 || L0 < 120, 'desktop worm has at least 2000 cells: ' + b.n);
  });
});

test('pieces rescale: a regenerated piece is a smaller whole worm, not a stump', function () {
  var m = new Model({ L0: 100, seed: 4 });
  var before = anatomy(m, m.bodies()[0]);
  var b0 = m.bodies()[0];
  cutAt(m, b0.minX + 0.4 * (b0.maxX - b0.minX), b0.cy, 0);
  runUntilPatterned(m, 25, function (b) { return b.heads === 1 && b.tails === 1; }, TOL.steps);
  m.step(1500);
  var pieces = m.bodies().filter(function (b) { return b.length >= 25; }).map(function (b) { return anatomy(m, b); });
  assert.strictEqual(pieces.length, 2);
  pieces.forEach(function (p) {
    assert.ok(p.length < before.length * 0.8, 'piece is shorter');
    assert.ok(Math.abs(p.aspect - before.aspect) / before.aspect < 0.3, 'aspect kept within 30%: ' + p.aspect.toFixed(2) + ' vs ' + before.aspect.toFixed(2));
  });
});

test('a lengthwise split: each half regrows its missing side, with one head and one tail', function () {
  (QUICK ? [1] : [1, 2, 3, 4, 5]).forEach(function (seed) {
    var m = new Model({ L0: 100, seed: seed });
    var b0 = m.bodies()[0], Y = b0.cy + (seed % 3 - 1) * 1.5;
    m.cut(b0.minX - 3, Y, b0.maxX + 3, Y);
    m.step(4000);
    var big = m.bodies().filter(function (b) { return b.length >= 25; });
    assert.strictEqual(big.length, 2, 'seed ' + seed + ': two halves survive: ' + summary(m.bodies().filter(function (b) { return b.n > 30; })));
    big.forEach(function (b) {
      var p = anatomy(m, b);
      assert.ok(b.heads === 1 && b.tails === 1, 'seed ' + seed + ': ' + JSON.stringify(p));
      assert.ok(p.aspect >= TOL.aspect[0] && p.aspect <= TOL.aspect[1], 'seed ' + seed + ': regrown to a worm shape: ' + JSON.stringify(p));
    });
  });
});

test('very small pieces fail: a sliver from the tail tip does not become a worm', function () {
  var m = new Model({ L0: 100, seed: 6 });
  var b0 = m.bodies()[0];
  cutAt(m, b0.minX + 0.1 * (b0.maxX - b0.minX), b0.cy, 0);
  m.step(4500);
  var small = m.bodies().filter(function (b) { return b.length < 25; });
  var big = m.bodies().filter(function (b) { return b.length >= 25; });
  assert.strictEqual(big.length, 1);
  assert.strictEqual(big[0].heads, 1); assert.strictEqual(big[0].tails, 1);
  small.forEach(function (b) { assert.ok(!(b.heads === 1 && b.tails === 1), 'a sliver made a whole worm'); });
  assert.ok(small.reduce(function (s, b) { return s + b.n; }, 0) < 20, 'the sliver has faded');
});

// ---------------------------------------------------------------- (c) rewrite persists
// One touch of the page's brush (radius 0.075 of the worm's length, as in app.js), at fraction f
// of the way from the head end to the tail end, then wait for the memory to spread.
var BRUSH = 0.075;
function brushTouch(m, b, f) {
  var headRight = headEnd(m, b) === 'right';
  var X = headRight ? b.maxX - f * b.length : b.minX + f * b.length;
  var n = m.paint(X, b.cy, BRUSH * m.L0);
  var t0 = m.t;
  while (m.t - t0 < 3000) {
    m.step(50);
    var now = m.bodies().filter(function (q) { return Math.abs(q.cx - b.cx) < 5 && Math.abs(q.cy - b.cy) < 5; })[0];
    if (now && now.mem > 0.97) break;
  }
  return { painted: n, steps: m.t - t0 };
}

test('(c) rewrite persists: after a rewrite, two successive cuts both give two-headed worms (every piece above the minimum size)', function () {
  // [seed, worm length, where the single brush touch lands (0 head end .. 1 tail end)]
  var trials = QUICK ? [[1, 100, 0.9]] : [[1, 100, 0.9], [2, 120, 0.1], [3, 100, 0.5], [4, 120, 0.8]];
  trials.forEach(function (tr) {
    var seed = tr[0], L0 = tr[1], k = L0 / 100;
    var r = rng(seed + 100);
    var m = new Model({ L0: L0, seed: seed });
    var touch = brushTouch(m, m.bodies()[0], tr[2]);
    var b0 = m.bodies()[0];
    var tag = 'seed ' + seed + ' (L0 ' + L0 + ', touch at ' + tr[2] + '): ';
    assert.ok(touch.painted > 0 && b0.mem > 0.95, tag + 'one touch has spread through the body: ' + b0.mem.toFixed(2));
    assert.ok(touch.steps <= 1500, tag + 'spread within 1,500 steps: ' + touch.steps);
    assert.strictEqual(b0.heads, 1, tag + 'anatomy unchanged until cut');
    assert.strictEqual(b0.tails, 1, tag + 'anatomy unchanged until cut');
    // first cut, a little behind the middle
    cutAt(m, b0.minX + (0.3 + 0.1 * r()) * b0.length, b0.cy, (r() - 0.5) * 0.5);   // tail at minX: the head piece is 60-70% long
    var steps = runUntilPatterned(m, 25 * k, function (b) { return b.heads + b.tails === 2; }, TOL.steps);
    assert.ok(steps > 0, tag + 'patterned after first cut');
    m.step(1000);
    var big = m.bodies().filter(function (b) { return b.length >= 25 * k; });
    var twin = big.filter(function (b) { return b.heads === 2 && b.tails === 0; });
    var plain = big.filter(function (b) { return b.heads === 1 && b.tails === 1; });
    assert.strictEqual(twin.length, 1, tag + 'the head piece became two-headed: ' + summary(big));
    assert.strictEqual(plain.length, 1, tag + 'the tail piece kept its tail and grew a head: ' + summary(big));
    checkTwin(m, twin[0], tag);
    // second cut, through the two-headed worm: both halves are two-headed again
    var w = twin[0];
    var X = w.minX + (0.4 + 0.2 * r()) * w.length;
    cutAt(m, X, w.cy, (r() - 0.5) * 0.4);
    assert.ok(runUntilPatterned(m, 25 * k, function (b) { return b.heads + b.tails === 2; }, TOL.steps) > 0, tag + 'patterned after the second cut');
    m.step(800);
    var pieces = m.bodies().filter(function (b) { return b.cx > w.minX - 12 && b.cx < w.maxX + 12 && Math.abs(b.cy - w.cy) < 15 && b.length >= 25 * k; });
    assert.ok(pieces.length >= 1, tag + 'at least one piece above the minimum size: ' + summary(pieces) + ' twin was ' + Math.round(w.length) + ' all ' + summary(m.bodies().filter(function (b) { return b.n > 30; })));
    pieces.forEach(function (b) {
      assert.ok(b.heads === 2 && b.tails === 0, tag + 'two-headed again after the second cut: ' + summary(pieces));
      checkTwin(m, b, tag);
    });
    // the one-headed piece looks normal, but it carries the rewrite: cut it and its front half
    // grows a second head where a tail would have been
    var p = plain[0];
    var hx = p.orgs.filter(function (o) { return o.type === B.HEAD; })[0].X;
    var X2 = p.cx + (hx > p.cx ? -0.2 : 0.2) * p.length;   // front piece is about 70% of the worm
    cutAt(m, X2, p.cy, 0);
    assert.ok(runUntilPatterned(m, 20 * k, function (b) { return b.heads + b.tails === 2; }, TOL.steps) > 0, tag + 'patterned after cutting the normal-looking worm');
    m.step(800);
    var front = m.bodies().filter(function (b) { return (b.cx - X2) * (hx - X2) > 0 && Math.abs(b.cx - X2) < Math.abs(hx - X2) + 10 && b.length >= 20 * k && b.orgs.some(function (o) { return o.type === B.HEAD && Math.abs(o.X - hx) < 12; }); });
    assert.strictEqual(front.length, 1, tag + 'front piece found: hx ' + hx.toFixed(1) + ' X2 ' + X2.toFixed(1) + ' ' + JSON.stringify(m.bodies().filter(function (b) { return b.n > 30; }).map(function (b) { return [Math.round(b.cx), Math.round(b.length), b.orgs.map(function (o) { return o.type + '@' + o.X; }).join(' ')]; })));
    assert.ok(front[0].heads === 2 && front[0].tails === 0, tag + 'a normal-looking worm with the rewritten memory makes two heads when cut: ' + summary(front));
  });
});
function summary(bs) { return JSON.stringify(bs.map(function (b) { return [b.heads, b.tails, Math.round(b.length)]; })); }
function checkTwin(m, b, tag) {
  var L = m.layout(b);
  assert.ok(L.pharynx && Math.abs((L.pharynx.mid - b.minX) / L.L - 0.5) < 0.12, tag + 'pharynx in the middle of a two-headed worm');
  assert.ok(b.counts[ID.EYE] >= 4, tag + 'eyes on both heads');
}

test('control: without a rewrite, the same cuts never give two heads', function () {
  var m = new Model({ L0: 100, seed: 1 });
  var b0 = m.bodies()[0];
  cutAt(m, b0.minX + 0.5 * b0.length, b0.cy, 0.1);
  runUntilPatterned(m, 25, function (b) { return b.heads === 1 && b.tails === 1; }, TOL.steps);
  m.step(600);
  m.bodies().forEach(function (b) { assert.ok(b.heads <= 1, 'two heads without a rewrite'); });
});

test('an untouched worm holds the same voltage memory (0) in every cell, at every size and after a cut', function () {
  SIZES.forEach(function (L0) {
    var m = new Model({ L0: L0, seed: 9 });
    var b = m.bodies()[0];
    cutAt(m, b.minX + 0.5 * b.length, b.cy, 0.2);
    m.step(600);
    for (var i = 0; i < m.N; i++) assert.strictEqual(m.cur.mem[i], 0, 'L0 ' + L0 + ': cell ' + i + ' holds ' + m.cur.mem[i]);
  });
});

test('the memory is a whole-body switch: one touch of the page brush, anywhere, tips the whole worm', function () {
  var places = QUICK ? [0.5] : [0.05, 0.5, 0.95];
  SIZES.forEach(function (L0) {
    places.forEach(function (f) {
      var m = new Model({ L0: L0, seed: 5 });
      var res = brushTouch(m, m.bodies()[0], f);
      var mem = m.bodies()[0].mem;
      assert.ok(mem > 0.97, 'L0 ' + L0 + ', touch at ' + f + ': mean memory ' + mem.toFixed(3) + ' after ' + res.steps + ' steps');
      assert.ok(res.steps <= 1500, 'L0 ' + L0 + ', touch at ' + f + ': spread took ' + res.steps + ' steps');
    });
  });
});

test('a dab too small to hold is pulled back by its neighbours', function () {
  var m = new Model({ L0: 100, seed: 3 });
  var b = m.bodies()[0];
  m.paint(b.cx, b.cy, 1.2);
  m.step(600);
  assert.ok(m.bodies()[0].mem < 0.02, 'small dab faded: ' + m.bodies()[0].mem.toFixed(3));
});

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
