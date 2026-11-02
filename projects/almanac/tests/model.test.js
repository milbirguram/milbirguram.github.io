var assert = require('assert');
var fs = require('fs');
var path = require('path');
var M = require('../model.js');

assert.strictEqual(M.ageText(0.5), '30 minutes');
assert.strictEqual(M.ageText(1), '1 hour');
assert.strictEqual(M.ageText(30), '30 hours');
assert.strictEqual(M.ageText(73), '3 days');
assert.strictEqual(M.fmtInt(12345), '12,345');
assert.strictEqual(M.dayLabel('2026-08-04'), '4 Aug');
assert.strictEqual(M.longDay('2026-11-01'), 'Sun 1 November 2026');
assert.strictEqual(M.stamp('2026-11-02T03:27:00Z'), '2 Nov, 03:27 UTC');

var dir = path.join(__dirname, '..', 'data', 'aggregates');
var health = JSON.parse(fs.readFileSync(path.join(dir, 'health.json'), 'utf8'));
var summary = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'));
health.calendar = M.expandCalendar(health);
assert.strictEqual(health.calendar.length, summary.dates.length);

// Packed old days unpack to plain entries, in date order, before the full recent ones.
var packed = M.expandCalendar({
  calendar_old: { first: '2026-01-30', fields: ['status', 'kind', 'kinds', 'runs', 'rows_in', 'rows_out', 'q', 'loaded', 'checks', 'src', 'kept'],
    days: [['p', 'b', 'b', 1, 168, 168, 0, 1, 'pppppps', 'R', 0], ['n'], ['f', 's', 'bs', 2, 117, 0, 0, 0, 'pppppfp', 'H', 160]] },
  calendar: [{ date: '2026-02-02', status: 'pass' }]
});
assert.deepStrictEqual(packed.map(function (d) { return d.date; }), ['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02']);
assert.strictEqual(packed[0].src, 'revised monthly archive');
assert.strictEqual(packed[0].kept, undefined);
assert.strictEqual(packed[1].status, 'none');
assert.deepStrictEqual(packed[2].kinds, ['backfill', 'scheduled']);
assert.strictEqual(packed[2].loaded, false);
assert.strictEqual(packed[2].kept, 160);

// A refused rerun says the earlier load is still counted; a refused first run does not.
assert.ok(/earlier load \(160 readings\) is kept and still counted/.test(M.loadedText(packed[2])));
assert.ok(/earlier load/.test(M.describeDay(packed[2])));
assert.strictEqual(M.loadedText({ loaded: false }), 'Nothing loaded.');

// The tally's note on warnings is counted, not assumed.
var names = ['schema', 'types', 'range', 'uniqueness', 'completeness', 'volume', 'freshness'];
var wc = M.warnCauses([{ status: 'warn', checks: 'ppppwpp' }, { status: 'warn', checks: 'ppppwwp' },
  { status: 'warn', checks: 'ppwpppp' }, { status: 'pass', checks: 'ppppppp' }], names);
assert.strictEqual(wc.total, 3);
assert.strictEqual(wc.top, 'completeness');
assert.strictEqual(wc.topCount, 2);
var real = M.warnCauses(health.calendar, health.check_names);
var ambers = health.calendar.filter(function (d) { return d.status === 'warn'; }).length;
assert.strictEqual(real.total, ambers);

// Calendar: one cell per day, Monday-first week columns, no two days in one cell.
var g = M.calendarGrid(health.calendar);
assert.strictEqual(g.cells.length, summary.dates.length);
var used = {};
g.cells.forEach(function (c) {
  var k = c.col + ',' + c.row;
  assert.ok(!used[k]);
  used[k] = 1;
  assert.strictEqual((new Date(Date.parse(c.day.date + 'T00:00:00Z')).getUTCDay() + 6) % 7, c.row);
});

// Every day has a status, and every run day says how it was run.
var t = M.tally(health.calendar);
assert.strictEqual(t.pass + t.warn + t.fail + t.none, health.calendar.length);
health.calendar.forEach(function (d) {
  if (d.status === 'none') return;
  assert.ok(M.KIND[d.kind], d.kind);
  var checks = M.dayChecks(d, health);
  assert.strictEqual(checks.length, 7);
  // the day's colour is the worst of its checks
  var worst = checks.some(function (c) { return c.status === 'fail'; }) ? 'fail'
    : checks.some(function (c) { return c.status === 'warn'; }) ? 'warn' : 'pass';
  assert.strictEqual(d.status, worst, d.date);
  assert.ok(/backfill|scheduled|hand|revision/i.test(M.describeDay(d)));
});

// The headline equals the bars it is drawn from, for every city.
summary.cities.forEach(function (c) {
  var v = M.cityView(summary, c.id);
  assert.strictEqual(v.total, v.seriesTotal, c.city);
  assert.ok(v.coverage > 0 && v.coverage <= 1);
});
var top = M.ranked(summary)[0].high_hours;
assert.strictEqual(top, Math.max.apply(null, summary.cities.map(function (c) { return c.high_hours; })));

// Budgets: the page's aggregates stay small.
var bytes = ['summary.json', 'health.json', 'preview.js'].reduce(function (a, n) {
  return a + fs.statSync(path.join(dir, n)).size;
}, 0);
assert.ok(bytes < 200000, 'aggregates are ' + bytes + ' bytes');
console.log('model: ok (aggregates ' + bytes + ' bytes)');
