// Wikitext to sentences and citations, and fuzzy matching. Run: node projects/echo/tests/wikitext.test.js
var assert = require('assert');
var M = require('../model.js');

var wt = [
  '{{Short description|Test}}',
  '{{Infobox band|name=Test|origin=Somewhere<ref>Infobox ref</ref>}}',
  "'''Test band''' is a [[funk]] band from [[Ann Arbor, Michigan|Ann Arbor]].<ref name=\"bb\">{{cite web |url=https://www.billboard.com/articles/x |title=Theo Katzman Tour Diary |work=Billboard |date=June 6, 2013 |access-date=June 9, 2013}}</ref> The members met in a 19th-century German literature class.<ref name=bb/><ref>{{cite news |title=Another article about the band |newspaper=The Paper |year=2015}}</ref>",
  '',
  '== History ==',
  'Dr. Smith founded it in c. 2010 in St. Louis, Mo. with J. R. Jones.{{sfn|Smith|2011|p=4}} It released an album.',
  'The album sold well, said the U.S. press.',
  '',
  '* A list item about the band.<ref name="lr"/>',
  '{| class="wikitable"',
  '| Table cell text that should vanish',
  '|}',
  '[[File:Band.jpg|thumb|A caption with a [[link]]<ref>caption ref</ref>]]',
  'An uncited sentence comes first. A second uncited one. Then the cited end of the paragraph.<ref>{{cite book |title=A Book Of Things |year=1999 |orig-date=1950}}</ref>',
  '',
  '== References ==',
  '{{reflist|refs=',
  '<ref name="lr">{{cite journal |last=Doe |title=List-defined reference title |journal=J |date=Spring 2014}}</ref>',
  '}}',
  '* {{cite book |last=Smith |first=A. |title=The Smith Book Of Bands |year=2011}}',
  '<!-- a comment with a sentence. -->'
].join('\n');

var doc = M.analyseWikitext(wt);
var texts = doc.sentences.map(function (s) { return s.text; });

assert.ok(texts.indexOf('Test band is a funk band from Ann Arbor.') >= 0, 'markup stripped: ' + texts[0]);
assert.ok(texts.indexOf('The members met in a 19th-century German literature class.') >= 0);
assert.ok(texts.some(function (t) { return t === 'Dr. Smith founded it in c. 2010 in St. Louis, Mo. with J. R. Jones.'; }), 'abbreviations do not split: ' + JSON.stringify(texts));
assert.ok(texts.indexOf('The album sold well, said the U.S. press.') >= 0);
assert.ok(!texts.some(function (t) { return /Table cell|caption|comment|Infobox/.test(t); }), 'tables, files, comments and infoboxes removed');
assert.ok(texts.indexOf('A list item about the band.') >= 0);

function sentence(start) { return doc.sentences.filter(function (s) { return s.text.indexOf(start) === 0; })[0]; }
function cits(s) { return s.refs.map(function (r) { return doc.refs[r].citation; }); }

// Named ref defined once, reused later.
var s1 = sentence('Test band'), s2 = sentence('The members met');
assert.strictEqual(s1.refs.length, 1);
assert.strictEqual(s2.refs.length, 2);
assert.strictEqual(s2.refs[0], s1.refs[0], 'named reuse resolves to the same ref');
assert.strictEqual(doc.refs[s1.refs[0]].number, 1);
assert.strictEqual(doc.refs[s2.refs[1]].number, 2);
var bb = cits(s2)[0];
assert.strictEqual(bb.template, 'cite web');
assert.strictEqual(bb.source.label, '6 June 2013');
assert.strictEqual(bb.sourceKind, 'date');
assert.strictEqual(bb.access.label, '9 June 2013');
assert.strictEqual(cits(s2)[1].source.label, '2015');
assert.strictEqual(cits(s2)[1].sourceKind, 'year');

// sfn finds its full citation in the bibliography.
var s3 = sentence('Dr. Smith');
var sf = cits(s3)[0];
assert.strictEqual(sf.kind, 'sfn');
assert.strictEqual(sf.title, 'The Smith Book Of Bands');
assert.strictEqual(sf.source.label, '2011');

// List-defined reference with a seasonal date.
var s4 = sentence('A list item');
assert.strictEqual(cits(s4)[0].title, 'List-defined reference title');
assert.strictEqual(cits(s4)[0].source.precision, 'season');

// orig-date wins when earlier.
var s5 = sentence('Then the cited end');
assert.strictEqual(cits(s5)[0].source.label, '1950');
assert.strictEqual(cits(s5)[0].sourceKind, 'orig-date');

// Uncited sentences borrow the paragraph-end citation, and say so.
var u = sentence('An uncited sentence');
var sup = M.supportingRefs(doc.sentences, [doc.sentences.indexOf(u)]);
assert.strictEqual(sup.scope, 'paragraph');
assert.deepStrictEqual(sup.refs, s5.refs);
var own = M.supportingRefs(doc.sentences, [doc.sentences.indexOf(s2)]);
assert.strictEqual(own.scope, 'sentence');

// harvnb inside a ref.
var d2 = M.analyseWikitext('Claim here.<ref>{{harvnb|Brown|1987|p=12}}</ref>\n\n{{cite book |last=Brown |title=Brown on Things |year=1987}}');
assert.strictEqual(d2.refs[d2.sentences[0].refs[0]].citation.title, 'Brown on Things');
assert.strictEqual(d2.refs[d2.sentences[0].refs[0]].citation.source.label, '1987');

// Same citation recognised across formatting changes.
var k1 = M.citationKeys(M.parseCitation('{{cite web|url=http://www.billboard.com/articles/x/|title=Theo Katzman Tour Diary}}'));
var k2 = M.citationKeys(M.parseCitation('[https://billboard.com/articles/x Theo Katzman Tour Diary]'));
assert.ok(k1.some(function (k) { return k2.indexOf(k) >= 0; }), 'same url, different formatting');
var k3 = M.citationKeys(M.parseCitation('{{cite web|url=https://web.archive.org/web/2015/http://billboard.com/articles/x|title=x}}'));
assert.ok(k3.indexOf('url:billboard.com/articles/x') >= 0, 'archive wrapper removed');

// Fuzzy matching tolerates small edits, rejects different claims.
var claim = M.tokens('The members met in a 19th-century German literature class at the University of Michigan.');
function score(text) { return M.matchClaim(claim, M.analyseWikitext(text).sentences).score; }
assert.strictEqual(score('Intro. The members met in a 19th-century [[German literature]] class at the [[University of Michigan]]. Outro.'), 1);
assert.ok(score('The members first met in a nineteenth-century German literature class at the University of Michigan.') >= M.THRESHOLD, 'small wording edit');
assert.ok(score('The band members met at the University of Michigan.') < M.THRESHOLD, 'a different, shorter claim');
assert.ok(score('Nothing to see here at all.') < 0.2);

// Matching guards: negation and numbers must agree.
function sc(a, b) { return M.matchClaim(M.tokens(a), M.analyseWikitext(b).sentences).score; }
assert.ok(sc('He did not attend Osgoode Hall Law School.', 'He did attend Osgoode Hall Law School.') < M.THRESHOLD, 'the claim negator must be there');
assert.ok(sc('He did attend Osgoode Hall Law School.', 'He did not attend Osgoode Hall Law School.') < M.THRESHOLD, 'a negator the claim lacks blocks a match');
assert.ok(sc('He did attend Osgoode Hall Law School.', 'He never attended Osgoode Hall Law School.') < M.THRESHOLD, 'never blocks a match');
assert.strictEqual(sc("He didn't attend Osgoode Hall Law School.", 'He did not attend Osgoode Hall Law School.'), 1, 'contraction');
assert.ok(sc('The club was founded in 1923 by students in Nicosia.', 'The club was founded in 1925 by students in Nicosia.') < M.THRESHOLD, 'a changed year');
assert.strictEqual(sc('The club was founded in 1923 by students in Nicosia.', 'It was not big. The club was founded in 1923 by students in Nicosia.'), 1, 'a negator in the sentence before does not count');

// Earlier wordings: sentences sharing the claim's rarer words.
var art = M.analyseWikitext('Meighen was born in Anderson. He was a lawyer. Law was his trade and he practised law. He studied law and taught school. He also studied law at Osgoode Law School. His law firm grew. The school was small.');
var ct = M.tokens('He also studied law at Osgoode Law School.');
var rw = M.rarityWeights(ct, art.sentences);
var older = M.analyseWikitext('Meighen was born in Anderson. He was a lawyer. Meighen then graduated from Osgoode Hall Law School. The school was small.');
var rel = M.relatedSentences(ct, rw, older.sentences, 2);
assert.strictEqual(rel.length, 1, 'one earlier wording');
assert.ok(/graduated from Osgoode/.test(rel[0].text));
assert.strictEqual(M.sharedWords('He also studied law at Osgoode Law School.', rel[0]), 'law Osgoode School');
assert.strictEqual(M.relatedSentences(ct, rw, M.analyseWikitext('He was a lawyer. The school was small.').sentences, 2).length, 0, 'common words alone are not an earlier wording');

// Article inputs.
assert.deepStrictEqual(M.parseArticleInput('https://en.wikipedia.org/wiki/AC_Omonia'), { title: 'AC Omonia', oldid: null });
assert.deepStrictEqual(M.parseArticleInput('https://en.wikipedia.org/w/index.php?title=AC_Omonia&oldid=239656275'), { title: 'AC Omonia', oldid: 239656275 });
assert.deepStrictEqual(M.parseArticleInput('https://en.m.wikipedia.org/wiki/Dunning%E2%80%93Kruger_effect#History'), { title: 'Dunning–Kruger effect', oldid: null });
assert.deepStrictEqual(M.parseArticleInput('Mottainai', '925482674'), { title: 'Mottainai', oldid: 925482674 });
assert.ok(M.parseArticleInput('https://de.wikipedia.org/wiki/Berlin').error);
assert.ok(M.parseArticleInput('').error);
assert.ok(M.parseArticleInput('X', 'abc').error);

console.log('wikitext: all passed');
