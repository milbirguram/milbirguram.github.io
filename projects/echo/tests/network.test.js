// The analysis driver against a fake Wikipedia, checking that every request goes to
// en.wikipedia.org/w/api.php with the etiquette parameters, one at a time, cached, capped;
// and that the page code makes no other requests and none in preview mode.
// Run: node projects/echo/tests/network.test.js
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var M = require('../model.js');

// ---- a fake article: 300 revisions; the claim arrives at 120, is vandalised away 200-209,
// and the citation (dated after the claim) is attached at 250.
var N = 300, CLAIM_AT = 120, GAP = [200, 209], CITE_AT = 250;
function ts(i) { return new Date(Date.UTC(2010, 0, 1) + i * 5 * 86400000).toISOString().replace('.000', ''); }
function text(i) {
  var t = 'Intro sentence about the subject.<ref>{{cite book |title=An Older Book Entirely |year=1990}}</ref>\n\n';
  if (i >= CLAIM_AT && !(i >= GAP[0] && i <= GAP[1])) {
    t += 'The subject was named after a small mountain lake in Norway.';
    if (i >= CITE_AT) t += '<ref>{{cite news |url=https://news.example.com/story |title=How the subject got its name |date=' + ts(CITE_AT - 10).slice(0, 10) + '}}</ref>';
    t += '\n';
  }
  return t + '\nRevision ' + i + ' padding.';
}
var revs = [];
for (var i = 0; i < N; i++) revs.push({ revid: 1000 + i, timestamp: ts(i), sha1: 'h' + i, hidden: i === 150 });

var urls = [], inFlight = 0, maxInFlight = 0;
function transport(url, headers) {
  urls.push(url);
  assert.strictEqual(headers['Api-User-Agent'], 'Echo/1.0 (https://milbirguram.github.io/projects/echo/)');
  inFlight++;
  maxInFlight = Math.max(maxInFlight, inFlight);
  var q = {};
  url.split('?')[1].split('&').forEach(function (kv) { var p = kv.split('='); q[decodeURIComponent(p[0])] = decodeURIComponent(p[1]); });
  return new Promise(function (resolve) {
    setTimeout(function () {
      inFlight--;
      var page = { pageid: 7, ns: 0, title: 'Subject' };
      if (q.revids) {
        var r = revs[+q.revids - 1000];
        page.revisions = [{ revid: r.revid, timestamp: r.timestamp, slots: r.hidden ? { main: { texthidden: true } } : { main: { content: text(+q.revids - 1000) } } }];
        return resolve({ query: { pages: [page] } });
      }
      if (q.pageids) {
        var start = q.rvcontinue ? +q.rvcontinue : 0, end = revs.map(function (r) { return r.revid; }).indexOf(+q.rvendid);
        var chunk = revs.slice(start, Math.min(start + 100, end + 1));
        page.revisions = chunk.map(function (r) { return r.hidden ? { revid: r.revid, timestamp: r.timestamp, sha1hidden: true } : { revid: r.revid, timestamp: r.timestamp, sha1: r.sha1 }; });
        var next = start + 100;
        var out = { query: { pages: [page] } };
        if (next <= end) out.continue = { rvcontinue: String(next), continue: '||' };
        return resolve(out);
      }
      resolve({ error: { code: 'unexpected', info: 'unexpected request' } });
    }, 1);
  });
}

(async function () {
  var api = M.makeApi(transport);
  var target = await M.loadRevision(api, null, 1000 + N - 1);
  var doc = M.analyseWikitext(target.content);
  var sentence = doc.sentences.filter(function (s) { return /mountain lake/.test(s.text); })[0];
  var log = [];
  var res = await M.analyse({ api: api, target: target, doc: doc, sentence: sentence, log: function (l) { log.push(l); } });

  assert.strictEqual(res.first.revid, 1000 + CLAIM_AT, 'first appearance');
  assert.strictEqual(res.first.prevRevid, 1000 + CLAIM_AT - 1);
  assert.strictEqual(res.citation.revid, 1000 + CITE_AT, 'citation attached');
  assert.strictEqual(res.verdict.code, 'echo');
  assert.strictEqual(res.hiddenCount, 1);
  assert.ok(res.fetches <= M.FETCH_CAP);
  assert.ok(log.some(function (l) { return /Listing revisions… 300 in all/.test(l); }), 'log streams the listing');
  assert.ok(log.some(function (l) { return /^Checking 20\d\d-\d\d-\d\d \(revision \d+/.test(l); }), 'log streams checks');

  // Etiquette on every request.
  assert.ok(urls.length > 3);
  urls.forEach(function (u) {
    assert.ok(u.indexOf('https://en.wikipedia.org/w/api.php?') === 0, 'only the API: ' + u);
    ['origin=*', 'format=json', 'formatversion=2', 'maxlag=5'].forEach(function (p) {
      assert.ok(u.indexOf(p.replace('*', '%2A')) >= 0 || u.indexOf(p) >= 0, p + ' in ' + u);
    });
  });
  assert.strictEqual(maxInFlight, 1, 'one request at a time');

  // Session cache: the same analysis again costs nothing.
  var before = urls.length;
  await M.analyse({ api: api, target: target, doc: doc, sentence: sentence });
  assert.strictEqual(urls.length, before, 'second run served from the session cache');

  // Fetch cap is honoured and reported.
  var api2 = M.makeApi(transport);
  var res2 = await M.analyse({ api: api2, target: target, doc: doc, sentence: sentence, cap: 4 });
  assert.ok(res2.fetches <= 4);
  assert.strictEqual(res2.capHit, true);

  // maxlag errors are retried, other errors surface.
  var calls = 0;
  var api3 = M.makeApi(function () { calls++; return Promise.resolve(calls < 2 ? { error: { code: 'maxlag', info: 'lagged' } } : { ok: 1 }); }, { wait: function () { return Promise.resolve(); } });
  assert.deepStrictEqual(await api3({ action: 'query' }), { ok: 1 });
  var api4 = M.makeApi(function () { return Promise.resolve({ error: { code: 'badvalue', info: 'nope' } }); });
  await assert.rejects(api4({ action: 'query' }), /nope/);

  // Static checks on the page code: one network call site, only to the API, and the preview
  // branch returns before any API client exists.
  var dir = path.join(__dirname, '..');
  var app = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
  var all = ['app.js', 'model.js', 'cases.js', 'index.html'].map(function (f) { return fs.readFileSync(path.join(dir, f), 'utf8'); }).join('\n');
  assert.strictEqual((all.match(/\bfetch\(/g) || []).length, 1, 'exactly one fetch call site');
  assert.ok(!/XMLHttpRequest|sendBeacon|new WebSocket|EventSource|importScripts/.test(all), 'no other request APIs');
  assert.ok(!/<(img|iframe|audio|video|link)[^>]+src=["']https?:/i.test(all), 'no remote media');
  var previewReturn = app.indexOf('if (Kit.preview) {');
  var apiMade = app.indexOf('makeApi(');
  assert.ok(previewReturn > 0 && apiMade > previewReturn, 'preview branch comes before the API client');
  var branch = app.slice(previewReturn, app.indexOf('}', app.indexOf('return;', previewReturn)) + 1);
  assert.ok(/return;/.test(branch) && !/api|fetch/i.test(branch.replace(/startPreview/g, '')), 'preview branch makes no requests');
  console.log('network: all passed');
})().catch(function (e) { console.error(e); process.exit(1); });
