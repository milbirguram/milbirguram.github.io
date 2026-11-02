// Date parsing across formats, with precision. Run: node projects/echo/tests/dates.test.js
var assert = require('assert');
var M = require('../model.js');
var d = function (y, m, dd) { return M.dayNum(y, m, dd); };

function check(text, precision, lo, hi) {
  var r = M.parseDate(text);
  assert.ok(r, 'should parse: ' + text);
  assert.strictEqual(r.precision, precision, text + ' precision');
  assert.strictEqual(M.dayToIso(r.lo), lo, text + ' lo');
  assert.strictEqual(M.dayToIso(r.hi), hi, text + ' hi');
}

check('2014-03-02', 'day', '2014-03-02', '2014-03-02');
check('2014-03-02T12:30:00Z', 'day', '2014-03-02', '2014-03-02');
check('March 2, 2014', 'day', '2014-03-02', '2014-03-02');
check('Mar. 2, 2014', 'day', '2014-03-02', '2014-03-02');
check('2 March 2014', 'day', '2014-03-02', '2014-03-02');
check('2nd March 2014', 'day', '2014-03-02', '2014-03-02');
check('Sunday, March 2, 2014', 'day', '2014-03-02', '2014-03-02');
check('March 2014', 'month', '2014-03-01', '2014-03-31');
check('February 2016', 'month', '2016-02-01', '2016-02-29');
check('2014-03', 'month', '2014-03-01', '2014-03-31');
check('2014', 'year', '2014-01-01', '2014-12-31');
check('2014a', 'year', '2014-01-01', '2014-12-31');
check('Spring 2014', 'season', '2014-03-01', '2014-11-30'); // northern March-May or southern September-November
check('Autumn 2014', 'season', '2014-03-01', '2014-11-30');
check('Fall 2014', 'season', '2014-03-01', '2014-11-30');
check('Summer 2014', 'season', '2013-12-01', '2015-02-28'); // a southern summer straddles the new year
check('Winter 2014', 'season', '2013-12-01', '2015-02-28');
check('c. 2014', 'circa', '2013-01-01', '2015-12-31');
check('circa 2014', 'circa', '2013-01-01', '2015-12-31');
check('ca. 1247', 'circa', '1246-01-01', '1248-12-31');
check('1990s', 'decade', '1990-01-01', '1999-12-31');
check('the 1990s', 'decade', '1990-01-01', '1999-12-31');
check('mid-1990s', 'decade', '1990-01-01', '1999-12-31');
check('c. 1990s', 'circa', '1989-01-01', '2000-12-31');
check('2014b', 'year', '2014-01-01', '2014-12-31');
check('2013–2014', 'range', '2013-01-01', '2014-12-31');
check('2013-14', 'range', '2013-01-01', '2014-12-31');
check('March–April 2014', 'range', '2014-03-01', '2014-04-30');
check('2–5 March 2014', 'range', '2014-03-02', '2014-03-05');
check('25/12/2014', 'day', '2014-12-25', '2014-12-25');
check('03/02/2014', 'ambiguous', '2014-02-03', '2014-03-02');

['', 'n.d.', 'undated', 'sometime', '2014-02-30', 'February 30, 2014', '13 Smarch 2014', '2014s', '1995s'].forEach(function (t) {
  assert.strictEqual(M.parseDate(t), null, 'should not parse: ' + JSON.stringify(t));
});

// Precision is respected when comparing with the day a claim appeared.
var claim = d(2014, 3, 10);
assert.strictEqual(M.relation(M.parseDate('2014-03-02'), claim), 'before');
assert.strictEqual(M.relation(M.parseDate('2014-03-11'), claim), 'after');
assert.strictEqual(M.relation(M.parseDate('2014-03-10'), claim), 'overlap', 'same day cannot be ordered');
assert.strictEqual(M.relation(M.parseDate('March 2014'), claim), 'overlap', 'month straddles the day');
assert.strictEqual(M.relation(M.parseDate('2014'), claim), 'overlap', 'year straddles the day');
assert.strictEqual(M.relation(M.parseDate('April 2014'), claim), 'after');
assert.strictEqual(M.relation(M.parseDate('2015'), claim), 'after');
assert.strictEqual(M.relation(M.parseDate('2013'), claim), 'before');
assert.strictEqual(M.relation(M.parseDate('Spring 2014'), claim), 'overlap');
assert.strictEqual(M.relation(M.parseDate('c. 2014'), claim), 'overlap');
assert.strictEqual(M.relation(M.parseDate('c. 2010'), claim), 'before');
assert.strictEqual(M.relation(M.parseDate('Winter 2015'), d(2014, 12, 15)), 'overlap', 'winter 2015 may mean December 2014');
assert.strictEqual(M.relation(null, claim), 'unknown');
assert.strictEqual(M.relation(M.parseDate('2010s'), M.dayNum(2012, 5, 1)), 'overlap', 'a decade cannot be placed before a day inside it');
assert.strictEqual(M.relation(M.parseDate('Spring 2014'), M.dayNum(2014, 10, 1)), 'overlap', 'a southern spring reaches October');

// Citation fields: date beats year, orig-date wins when earlier, access-date is only a hint.
var c1 = M.parseCitation('{{cite web |url=https://example.org/a |title=Alpha beta gamma |date=June 6, 2013 |access-date=June 9, 2013}}');
assert.strictEqual(c1.sourceKind, 'date');
assert.strictEqual(M.dayToIso(c1.source.lo), '2013-06-06');
assert.strictEqual(M.dayToIso(c1.access.lo), '2013-06-09');
var c2 = M.parseCitation('{{cite book |title=Old book reprinted |year=2010 |orig-date=1952}}');
assert.strictEqual(c2.sourceKind, 'orig-date');
assert.strictEqual(c2.source.label, '1952');
var c3 = M.parseCitation('{{cite news |title=Something happened today |publication-date=March 2014}}');
assert.strictEqual(c3.sourceKind, 'publication-date');
assert.strictEqual(c3.source.precision, 'month');
var c4 = M.parseCitation('{{cite web |url=https://example.org/b |title=Undated page here |access-date=2015-01-20}}');
assert.strictEqual(c4.source, null, 'access-date alone is not a publication date');
assert.strictEqual(M.dayToIso(c4.access.lo), '2015-01-20');
var c5 = M.parseCitation('The Mirror, [http://www.mirror.co.uk/sport/football/2008/09/18/new-look-115875/ New-look side], accessed 19 September 2008');
assert.strictEqual(c5.sourceKind, 'url');
assert.strictEqual(M.dayToIso(c5.source.lo), '2008-09-18');
assert.strictEqual(M.dayToIso(c5.access.lo), '2008-09-19');
var c6 = M.parseCitation("''The Incredible Canadian'', by [[Bruce Hutchison]], Toronto 1952, Longmans Canada");
assert.strictEqual(c6.sourceKind, 'free-text');
assert.strictEqual(c6.source.label, '1952');
var c7 = M.parseCitation('Smith 1990, reprinted 2004');
assert.strictEqual(c7.source, null, 'two different years in free text: no date');
var c8 = M.parseCitation('{{cite web |url=https://web.archive.org/web/20150906103530/http://rabbit.org/facts/ |title=Basic Rabbit Facts}}');
assert.strictEqual(c8.source, null, 'archive capture timestamp is not a publication date');
// A year inside a free-text title is not a publication date.
assert.strictEqual(M.parseCitation('"Remembering the 1918 flu pandemic". The Guardian.').source, null, 'year in a quoted title');
assert.strictEqual(M.parseCitation("''The War of 1812 Revisited''. Toronto Star.").source, null, 'year in an italic title');
assert.strictEqual(M.parseCitation('[http://example.org/x Looking back at 1966] Some paper').source, null, 'year in link text');
var c9 = M.parseCitation('Jones, A. (2015). A book about things. Publisher.');
assert.strictEqual(c9.source.label, '2015', 'bracketed year');
assert.ok(!c9.sourceWeak, 'a bracketed year is not weak');
var c10 = M.parseCitation('Remembering the 1918 flu pandemic. The Guardian.');
assert.ok(c10.source && c10.sourceWeak, 'a lone year with no clear title is weak');
console.log('dates: all passed');
