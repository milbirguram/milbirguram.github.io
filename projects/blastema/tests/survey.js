// A larger batch of random cuts than the test file runs, for the numbers quoted in "How I know".
// Run: node projects/blastema/tests/survey.js [cuts=90] [first=1]
// Cuts are at the page's three worm sizes, anywhere from 0.15 to 0.85 along the body, tilted up
// to 45 degrees. Pieces are chosen at the moment of the cut, by their length then, and followed by
// the cells they started with; a piece that fades away counts as a failure. Prints one line per
// piece and a summary by piece size. It asserts nothing: it reports.
'use strict';
var path = require('path');
var B = require(path.join(__dirname, '..', 'model.js'));
var Model = B.Model, ID = B.ID, SQ3_2 = B.SQ3_2;
var N = +process.argv[2] || 90, START = +process.argv[3] || 1;
var TOL = { head: [0.12, 0.32], tail: [0.10, 0.30], pharynx: [0.42, 0.68], aspect: [2.8, 6.5], steps: 3000 };

function rng(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function cutAt(m, X, Y, th) { var H = m.ny * SQ3_2, s = Math.sin(th), c = Math.cos(th); return m.cut(X - s * H, Y - c * H, X + s * H, Y + c * H); }
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
function ok(b) { return b && b.heads === 1 && b.tails === 1 && b.wound === 0 && b.blast === 0 && b.valid === b.n; }

var rows = [];
for (var k = START; k < START + N; k++) {
  var L0 = [80, 100, 120][k % 3];
  var r = rng(k * 31337 + 7);
  var m = new Model({ L0: L0, seed: k + 500 });
  var b0 = m.bodies()[0];
  var u = 0.15 + 0.7 * r(), th = (r() - 0.5) * 2 * (45 * Math.PI / 180);
  cutAt(m, b0.minX + u * (b0.maxX - b0.minX), b0.cy + (r() - 0.5) * 4, th);
  var pieces = m.bodies().map(function (b) { return { cells: b.cells.slice(), frac: b.length / L0 }; })
    .filter(function (p) { return p.frac >= 0.15; });
  var when = pieces.map(function () { return -1; }), t0 = m.t;
  while (m.t - t0 < TOL.steps) {
    m.step(50);
    follow(m, pieces).forEach(function (b, q) { if (when[q] < 0 && ok(b)) when[q] = m.t - t0; });
    if (when.every(function (w) { return w >= 0; })) break;
  }
  m.step(1200);
  follow(m, pieces).forEach(function (b, q) {
    var rec = { cut: k, L0: L0, frac: +pieces[q].frac.toFixed(3), angle: Math.round(th * 180 / Math.PI), steps: when[q] };
    var why = [];
    if (!b) why.push('faded');
    else {
      var L = m.layout(b), h = b.orgs.filter(function (o) { return o.type === B.HEAD; })[0];
      var endX = h ? (h.X > b.cx ? b.maxX : b.minX) : b.minX;
      var head = L.head ? L.head.len : 0, tail = L.tail ? L.tail.len : 0;
      var ph = L.pharynx ? Math.abs(endX - L.pharynx.mid) / L.L : -1, aspect = b.length / b.width;
      if (b.heads !== 1 || b.tails !== 1) why.push(b.heads + 'h' + b.tails + 't');
      if (when[q] < 0) why.push('slow');
      if (head < TOL.head[0] || head > TOL.head[1]) why.push('head');
      if (tail < TOL.tail[0] || tail > TOL.tail[1]) why.push('tail');
      if (ph < TOL.pharynx[0] || ph > TOL.pharynx[1]) why.push('pharynx');
      if (aspect < TOL.aspect[0] || aspect > TOL.aspect[1]) why.push('aspect ' + aspect.toFixed(2));
      if (b.counts[ID.EYE] < 2) why.push('eyes ' + b.counts[ID.EYE]);
    }
    rec.ok = !why.length; rec.why = why.join(',');
    rows.push(rec);
    console.log(JSON.stringify(rec));
  });
}
console.log('\nsummary (' + N + ' cuts)');
[[0.15, 0.25], [0.25, 0.3], [0.3, 0.4], [0.4, 9], [0.25, 9]].forEach(function (bin) {
  var s = rows.filter(function (x) { return x.frac >= bin[0] && x.frac < bin[1]; });
  var good = s.filter(function (x) { return x.ok; });
  var slow = good.reduce(function (a, x) { return Math.max(a, x.steps); }, 0);
  var st = good.map(function (x) { return x.steps; }).sort(function (a, b) { return a - b; });
  console.log('  pieces ' + bin[0] + (bin[1] < 9 ? '-' + bin[1] : '+') + ' of the worm: ' + good.length + ' of ' + s.length +
    ' right; patterned in median ' + (st.length ? st[st.length >> 1] : '-') + ', 90th percentile ' + (st.length ? st[Math.floor(st.length * 0.9)] : '-') + ', slowest ' + slow + ' steps');
});
