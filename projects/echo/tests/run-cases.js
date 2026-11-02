// Runs every case file against the live Wikipedia API and records the results in
// tests/cases.json. Needs network access. Run: node projects/echo/tests/run-cases.js [caseId]
// The same check runs in the browser from the page's "Re-run the case files" button.
// Each case runs as its file sets it up; a case that traces shorter words also runs with the
// whole sentence, which must never come out "Source came first".
var https = require('https');
var fs = require('fs');
var path = require('path');
var M = require('../model.js');
var C = require('../cases.js');

function transport(url, headers) {
  // Node has no CORS; Wikipedia asks scripts to send a real User-Agent instead of Api-User-Agent.
  return new Promise(function (resolve, reject) {
    https.get(url, { headers: { 'User-Agent': M.USER_AGENT + ' node test runner', 'Api-User-Agent': headers['Api-User-Agent'] } }, function (res) {
      var body = '';
      res.setEncoding('utf8');
      res.on('data', function (c) { body += c; });
      res.on('end', function () { try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('Bad JSON from ' + url + ': ' + body.slice(0, 200))); } });
    }).on('error', reject);
  });
}

async function runCase(api, c, trace, log) {
  var target = await M.loadRevision(api, c.title, c.oldid);
  var doc = M.analyseWikitext(target.content);
  var sentence = doc.sentences.filter(function (s) { return s.text.indexOf(c.pick) >= 0; })[0];
  if (!sentence) throw new Error('Sentence not found: ' + c.pick);
  return M.analyse({ api: api, target: target, doc: doc, sentence: sentence, traceText: trace, log: log });
}

function summarise(c, run, res) {
  return {
    id: run.id, caseId: c.id, kind: run.id === c.id ? c.kind : 'whole-sentence', title: res.title, oldid: res.targetRevid,
    sentence: res.sentence, trace: res.traceText,
    expect: run.expect, verdict: res.verdict.label, code: res.verdict.code,
    pass: C.passes(run.expect, res.verdict.code),
    claimFirstSeen: { revid: res.first.revid, timestamp: res.first.timestamp, prevRevid: res.first.prevRevid, exact: res.first.exact, messy: res.first.messy, wordingCheck: res.first.wordingCheck },
    citationAttached: res.citation ? { revid: res.citation.revid, timestamp: res.citation.timestamp, sameRevision: res.citation.sameRevision } : null,
    earlierWording: res.earlier ? { foundIn: res.earlier.revid, timestamp: res.earlier.timestamp, text: res.earlier.sentences[0].text, suggestions: res.earlier.sentences.map(function (x) { return x.suggest; }) } : null,
    earlierWordingTraced: res.related ? { revid: res.related.revid, timestamp: res.related.timestamp, text: res.related.text, settled: res.related.settled } : null,
    sources: res.sources.map(function (s) {
      return { title: s.ref.citation.title, work: s.ref.citation.work, url: s.ref.citation.url, date: s.source ? s.source.label : null, dateKind: s.sourceKind, access: s.access ? s.access.label : null };
    }),
    reasons: res.verdict.reasons,
    revisions: res.revisionCount, fetches: res.fetches, capHit: res.capHit
  };
}

(async function () {
  var api = M.makeApi(transport);
  var only = process.argv[2];
  var out = { ranAt: new Date().toISOString(), runner: 'node tests/run-cases.js', results: [] };
  var file = path.join(__dirname, 'cases.json');
  var failed = 0;
  var runs = C.runs();
  for (var i = 0; i < runs.length; i++) {
    var run = runs[i];
    var c = C.CASES.filter(function (x) { return x.id === run.caseId; })[0];
    if (only && c.id !== only) continue;
    process.stdout.write('\n== ' + run.label + (run.trace ? ' [trace: ' + run.trace + ']' : '') + '\n');
    try {
      var res = await runCase(api, c, run.trace, function (line) { if (process.env.ECHO_VERBOSE) console.log('  ' + line); });
      var s = summarise(c, run, res);
      out.results.push(s);
      console.log('  ' + s.verdict + (s.pass ? '  PASS' : '  FAIL') + ' | first seen ' + s.claimFirstSeen.timestamp + ' (' + s.claimFirstSeen.revid + ')' +
        (s.claimFirstSeen.messy ? ' messy' : '') + ' | cited ' + (s.citationAttached ? s.citationAttached.timestamp : '-') +
        ' | sources ' + s.sources.map(function (x) { return (x.date || 'no date') + ' [' + x.dateKind + ']'; }).join('; ') +
        ' | ' + s.fetches + ' fetches of ' + s.revisions + ' revisions');
      if (s.earlierWording) console.log('  earlier wording in ' + s.earlierWording.foundIn + ': ' + s.earlierWording.text + ' (suggests: ' + s.earlierWording.suggestions.join(' / ') + ')');
      res.verdict.reasons.forEach(function (r) { console.log('    - ' + r); });
      if (!s.pass) failed++;
    } catch (e) {
      failed++;
      console.log('  ERROR ' + e.message);
      out.results.push({ id: run.id, caseId: c.id, kind: c.kind, error: e.message, pass: false });
    }
  }
  if (!only) {
    fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
    // The card preview and the opening timeline replay recorded results, so they need no network.
    var rec = {};
    out.results.forEach(function (r) { if (!r.error) rec[r.id] = r; });
    fs.writeFileSync(path.join(__dirname, '..', 'recorded.js'),
      '// Generated by tests/run-cases.js on ' + out.ranAt.slice(0, 10) + ': recorded results of the case files, used by\n' +
      '// the card preview and the opening timeline so they need no network. Do not edit by hand.\n' +
      '(function (root) {\n  var RECORDED = ' + JSON.stringify(rec, null, 2).replace(/\n/g, '\n  ') + ';\n' +
      "  if (typeof module === 'object' && module.exports) module.exports = RECORDED;\n  else root.EchoRecorded = RECORDED;\n})(this);\n");
  }
  console.log('\n' + (failed ? failed + ' run(s) failed' : 'all runs behaved as expected'));
  process.exit(failed ? 1 : 0);
})();
