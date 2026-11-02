// The analysis driver on fake histories where the claim was reworded, or where revisions just
// before it have hidden text. A reworded claim must never come out "Source came first" when an
// earlier wording was on Wikipedia before the source. Run: node projects/echo/tests/rewording.test.js
var assert = require('assert');
var M = require('../model.js');

function ts(i) { return new Date(Date.UTC(2006, 0, 1) + i * 10 * 86400000).toISOString().replace('.000', ''); }
function day(i) { return ts(i).slice(0, 10); }

// spec: { n, text(i) -> wikitext, hidden(i) -> bool }
function fakeApi(spec) {
  var revs = [];
  for (var i = 0; i < spec.n; i++) revs.push({ revid: 5000 + i, timestamp: ts(i), sha1: 's' + i, hidden: !!(spec.hidden && spec.hidden(i)) });
  var count = { content: 0 };
  function transport(url) {
    var q = {};
    url.split('?')[1].split('&').forEach(function (kv) { var p = kv.split('='); q[decodeURIComponent(p[0])] = decodeURIComponent(p[1]); });
    var page = { pageid: 9, ns: 0, title: 'Club' };
    if (q.revids) {
      count.content++;
      var r = revs[+q.revids - 5000];
      page.revisions = [{ revid: r.revid, timestamp: r.timestamp, slots: r.hidden ? { main: { texthidden: true } } : { main: { content: spec.text(+q.revids - 5000) } } }];
      return Promise.resolve({ query: { pages: [page] } });
    }
    if (q.pageids) {
      var end = revs.map(function (r) { return r.revid; }).indexOf(+q.rvendid);
      page.revisions = revs.slice(0, end + 1).map(function (r) { return r.hidden ? { revid: r.revid, timestamp: r.timestamp, sha1hidden: true } : { revid: r.revid, timestamp: r.timestamp, sha1: r.sha1 }; });
      return Promise.resolve({ query: { pages: [page] } });
    }
    return Promise.resolve({ error: { code: 'unexpected', info: 'unexpected' } });
  }
  return { api: M.makeApi(transport), count: count, n: spec.n };
}

async function run(f, pick, trace) {
  var target = await M.loadRevision(f.api, null, 5000 + f.n - 1);
  var doc = M.analyseWikitext(target.content);
  var sentence = doc.sentences.filter(function (s) { return s.text.indexOf(pick) >= 0; })[0];
  assert.ok(sentence, 'sentence ' + pick);
  return M.analyse({ api: f.api, target: target, doc: doc, sentence: sentence, traceText: trace });
}

var FILLER = 'The club plays in the first division. It was founded by students. Its ground is in the old town. The team wears green. Matches draw large crowds. The club has a youth academy. Its rivals are across the river.';

// The Omonia pattern: an unsourced claim at 40; at 150 it is reworded into another sentence and
// cited to a source dated between the two.
function reworded(sourceDay) {
  return function (i) {
    var t = '';
    if (i >= 40 && i < 150) t += 'A small group of fans are lovingly called the Zany Ones and wear hats made from shoes.\n\n';
    t += FILLER + '\n\n';
    if (i >= 20) t += i >= 150
      ? 'The club\'s fans, the Zany Ones, are considered to be left-wing in their majority.<ref>{{cite news |title=Match preview for the cup tie |date=' + sourceDay + '}}</ref>\n\n'
      : 'The club\'s fans are considered to be left-wing in their majority.\n\n';
    return t;
  };
}

(async function () {
  // 1. The whole reworded sentence: the new wording is found at 150, an earlier wording before it,
  //    and since the source (day 100) is after the earlier wording, the answer is "Can't tell".
  var f1 = fakeApi({ n: 200, text: reworded(day(100)) });
  var r1 = await run(f1, 'Zany Ones, are considered', null);
  assert.strictEqual(r1.first.revid, 5150, 'this wording first appears at 150');
  assert.ok(r1.earlier, 'an earlier wording is found');
  assert.notStrictEqual(r1.verdict.code, 'first', 'never "Source came first"');
  assert.strictEqual(r1.verdict.code, 'unknown');
  assert.ok(r1.related && r1.related.day <= M.isoToDay(day(40)), 'the earlier wording is traced back to 40 or before: ' + JSON.stringify(r1.related));
  var suggestions = r1.earlier.sentences.map(function (s) { return s.suggest; });
  assert.ok(suggestions.some(function (s) { return /Zany Ones/.test(s); }), 'suggests the shared words: ' + suggestions.join(' / '));
  assert.ok(r1.fetches <= M.FETCH_CAP);

  // 2. Tracing the suggested shared words follows the claim back: a possible echo.
  var sug = suggestions.filter(function (s) { return /Zany Ones/.test(s); })[0];
  var r2 = await run(f1, 'Zany Ones, are considered', sug);
  assert.strictEqual(r2.first.revid, 5040, 'the shared words first appear at 40');
  assert.strictEqual(r2.verdict.code, 'echo');

  // 3. A source older than every wording still comes first.
  var f3 = fakeApi({ n: 200, text: reworded('1952') });
  var r3 = await run(f3, 'Zany Ones, are considered', null);
  assert.strictEqual(r3.verdict.code, 'first', 'a 1952 source predates every wording');
  assert.ok(r3.related && r3.related.settled, 'the earlier wording was traced to its start');

  // 4. A sentence with no earlier wording: "Source came first", and Echo says it looked.
  var f4 = fakeApi({ n: 120, text: function (i) { return FILLER + (i >= 60 ? '\n\nThe badge shows a four-leaf clover on a crimson shield.<ref>{{cite book |title=Badges of the world |year=1990}}</ref>' : ''); } });
  var r4 = await run(f4, 'four-leaf clover', null);
  assert.strictEqual(r4.verdict.code, 'first');
  assert.strictEqual(r4.first.wordingCheck, 'none');
  assert.ok(!r4.earlier);

  // 5. Hidden revisions just before the first appearance: the boundary is not tight.
  var f5 = fakeApi({ n: 120, hidden: function (i) { return i === 58 || i === 59; },
    text: function (i) { return FILLER + (i >= 60 ? '\n\nThe badge shows a four-leaf clover on a crimson shield.<ref>{{cite web |url=https://example.org/badge |title=The badge story |date=' + day(110) + '}}</ref>' : ''); } });
  var r5 = await run(f5, 'four-leaf clover', null);
  assert.strictEqual(r5.first.revid, 5060);
  assert.strictEqual(r5.first.prevRevid, 5057, 'the last revision read without it');
  assert.strictEqual(r5.first.hiddenBefore, true);
  assert.strictEqual(r5.first.exact, false, 'hidden revisions in between: not exact');
  assert.strictEqual(r5.verdict.code, 'echo', 'a later source is still a possible echo');

  // 6. The article's first revisions hidden, claim in the first readable one.
  var f6 = fakeApi({ n: 50, hidden: function (i) { return i < 3; },
    text: function (i) { return FILLER + '\n\nThe badge shows a four-leaf clover on a crimson shield.<ref>{{cite book |title=Badges of the world |year=1990}}</ref>'; } });
  var r6 = await run(f6, 'four-leaf clover', null);
  assert.strictEqual(r6.first.revid, 5003);
  assert.strictEqual(r6.first.firstVisible, true, 'labelled the first readable revision');
  assert.strictEqual(r6.first.exact, false);
  assert.strictEqual(r6.verdict.code, 'first', 'a 1990 source predates the article itself');
  console.log('rewording: all passed');
})().catch(function (e) { console.error(e); process.exit(1); });
