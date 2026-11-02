// The first-appearance search on synthetic revision histories, and the verdict rules.
// Run: node projects/echo/tests/search.test.js
var assert = require('assert');
var M = require('../model.js');

function history(spec) {
  // '1' claim present, '0' absent, '?' text hidden
  return spec.split('').map(function (c) { return c === '1' ? true : c === '0' ? false : null; });
}
function prober(h, cap) {
  var calls = 0, seen = {};
  var probe = function (i) {
    assert.ok(i >= 0 && i < h.length, 'index in range: ' + i);
    if (!seen[i]) {
      if (cap != null && calls >= cap) return Promise.resolve({ present: null, capped: true });
      calls++;
      seen[i] = 1;
    }
    return Promise.resolve({ present: h[i] });
  };
  probe.calls = function () { return calls; };
  return probe;
}

(async function () {
  // Monotonic histories of every length up to 60 and every boundary.
  for (var n = 1; n <= 60; n++) {
    for (var b = 0; b < n; b++) {
      var h = [];
      for (var i = 0; i < n; i++) h.push(i >= b);
      var r = await M.firstPresent(0, n - 1, prober(h));
      assert.strictEqual(r.first, b, 'n=' + n + ' b=' + b);
      assert.strictEqual(r.lastAbsent, b > 0 ? b - 1 : null);
      assert.ok(r.exact);
      var t = await M.traceFirstAppearance(n, prober(h));
      assert.strictEqual(t.first, b, 'trace n=' + n + ' b=' + b);
      assert.strictEqual(t.messy, false, 'monotonic is not messy n=' + n + ' b=' + b);
    }
  }

  // Logarithmic number of probes on a long history.
  var long = [];
  for (var k = 0; k < 5000; k++) long.push(k >= 3141);
  var p = prober(long);
  var lr = await M.traceFirstAppearance(long.length, p);
  assert.strictEqual(lr.first, 3141);
  assert.strictEqual(lr.messy, false);
  assert.ok(p.calls() <= 13 + 5 + 4, 'probes: ' + p.calls());

  // Present from the very first revision.
  var r0 = await M.traceFirstAppearance(8, prober(history('11111111')));
  assert.strictEqual(r0.first, 0);
  assert.strictEqual(r0.lastAbsent, null);
  assert.strictEqual(r0.messy, false);

  // Removed and re-added: a plain binary search lands on the re-add; the earlier samples catch it.
  var h1 = history('0001111111111111000000000000000111');
  var plain = await M.firstPresent(0, h1.length - 1, prober(h1));
  assert.strictEqual(plain.first, 31, 'plain binary search alone is fooled');
  var t1 = await M.traceFirstAppearance(h1.length, prober(h1));
  assert.strictEqual(t1.first, 3, 'finds the earliest appearance');
  assert.strictEqual(t1.messy, true);
  assert.strictEqual(t1.messyKinds.earlier, true);

  // Removed and re-added after the true first appearance: the first date stands, history is messy.
  var h2 = history('000000111111111000000011111111111111');
  var t2 = await M.traceFirstAppearance(h2.length, prober(h2));
  assert.strictEqual(t2.first, 6);
  assert.ok(t2.messy, 'gap detected');

  // A brief flicker: added, reverted at once, added again much later.
  var h3 = history('00000100000000000000000000011111');
  var t3 = await M.traceFirstAppearance(h3.length, prober(h3), { earlierSamples: 30 });
  assert.strictEqual(t3.first, 5);
  assert.ok(t3.messy && t3.messyKinds.flicker, 'flicker detected');

  // Removed and re-added where the samples miss it: reported as found, never a false 'clean'.
  var h3b = history('0000000000000000000000000001111111110000000000000000000000000000000000001111');
  var t3b = await M.traceFirstAppearance(h3b.length, prober(h3b));
  assert.ok(h3b[t3b.first] === true, 'reported first has the claim');

  // Hidden revisions are stepped over.
  var h4 = history('0000??0?11111111');
  var t4 = await M.firstPresent(0, h4.length - 1, prober(h4));
  assert.strictEqual(t4.first, 8);
  assert.ok(h4[t4.lastAbsent] === false, 'last absent is a real absent revision');
  var h5 = history('0????????1');
  var t5 = await M.firstPresent(0, h5.length - 1, prober(h5));
  assert.strictEqual(t5.first, 9);
  assert.strictEqual(t5.lastAbsent, 0);
  assert.strictEqual(t5.exact, false, 'boundary is not tight across hidden revisions');

  // The fetch cap stops the search with honest bounds.
  var big = [];
  for (var q = 0; q < 4096; q++) big.push(q >= 1000);
  var t6 = await M.traceFirstAppearance(big.length, prober(big, 5));
  assert.strictEqual(t6.capped, true);
  assert.strictEqual(t6.exact, false);
  assert.ok(big[t6.first] === true, 'reported first is a revision with the claim');
  assert.ok(t6.lastAbsent == null || big[t6.lastAbsent] === false, 'reported absent is absent');

  // Verdicts.
  var day = M.dayNum(2013, 1, 25);
  var first = { day: day, lastAbsentDay: day - 1, exact: true, messy: false, capped: false };
  function src(t) { return { source: M.parseDate(t), access: null }; }
  assert.strictEqual(M.decide(first, null, [src('June 6, 2013')]).code, 'echo');
  assert.strictEqual(M.decide(first, null, [src('1952')]).code, 'first');
  assert.strictEqual(M.decide(first, null, [src('2013')]).code, 'unknown', 'a year straddling the day cannot be ordered');
  assert.strictEqual(M.decide(first, { addedDay: day + 100, sameRevision: false, appearedUnsourced: true }, [src('2013')]).code, 'unknown', 'a date that overlaps is not "added later"');
  assert.strictEqual(M.decide(first, { addedDay: day + 100, sameRevision: false, appearedUnsourced: true }, [{ source: null, access: M.parseDate('2015') }]).code, 'later');
  assert.strictEqual(M.decide(first, { addedDay: day + 100, sameRevision: false, appearedUnsourced: false }, [{ source: null, access: null }]).code, 'unknown', 'the claim appeared with another citation');
  assert.strictEqual(M.decide(first, { addedDay: day, sameRevision: true }, [{ source: null, access: null }]).code, 'unknown');
  assert.strictEqual(M.decide(first, null, [src('1952'), src('2014')]).code, 'first', 'an earlier source wins');
  assert.strictEqual(M.decide(first, null, []).code, 'unknown');
  var messyFirst = { day: day, lastAbsentDay: day - 1, exact: true, messy: true, capped: false };
  assert.strictEqual(M.decide(messyFirst, null, [src('1952')]).code, 'unknown', 'messy history cannot show the source came first');
  assert.strictEqual(M.decide(messyFirst, null, [src('2015')]).code, 'echo', 'a confirmed earlier revision still dates the claim');
  var capped = { day: day, lastAbsentDay: day - 400, exact: false, messy: false, capped: true };
  assert.strictEqual(M.decide(capped, null, [src('2012')]).code, 'unknown', 'source inside the uncertain window');
  assert.strictEqual(M.decide(capped, null, [src('2010')]).code, 'first');
  // A free-text year with no clear title cannot show that the source came first.
  assert.strictEqual(M.decide(first, null, [{ source: M.parseDate('1952'), weak: true }]).code, 'unknown');
  // Hidden revisions before the first one read: no 'Source came first' from a boundary that is not tight.
  var hid = { day: day, lastAbsentDay: null, exact: false, hiddenBefore: true, messy: false, capped: false };
  assert.strictEqual(M.decide(hid, null, [src('2010')]).code, 'unknown');
  // An earlier wording undoes 'Source came first' unless the source predates it too.
  var early = { day: M.dayNum(2008, 1, 3), label: '3 January 2008', revid: 1, text: 'Meighen then graduated from Osgoode Hall Law School.', settled: true };
  var later2017 = { day: M.dayNum(2017, 7, 27), lastAbsentDay: M.dayNum(2017, 6, 1), exact: true, messy: false, capped: false };
  assert.strictEqual(M.decide(later2017, null, [src('20 April 2012')]).code, 'first', 'without the earlier wording');
  assert.strictEqual(M.decide(later2017, null, [src('20 April 2012')], early).code, 'unknown', 'the earlier wording came before the source');
  assert.strictEqual(M.decide(later2017, null, [src('1952')], early).code, 'first', 'the source predates even the earlier wording');
  var unsettled = { day: M.dayNum(2008, 1, 3), label: '3 January 2008', revid: 1, text: 'x y', settled: false };
  assert.strictEqual(M.decide(later2017, null, [src('1952')], unsettled).code, 'unknown', 'an earlier wording not traced to its start');
  assert.strictEqual(M.decide(later2017, null, [src('2019')], early).code, 'echo', 'an earlier wording never blocks a later source');
  console.log('search: all passed');
})().catch(function (e) { console.error(e); process.exit(1); });
