// The page must say "stale" honestly. The clock is injected, so no waiting is needed.
var assert = require('assert');
var path = require('path');
var fs = require('fs');
var M = require('../model.js');

var slo = { max_data_age_hours: 36, max_run_age_hours: 26 };
var H = 3600 * 1000;
var latestHour = '2026-11-01T23:00:00Z';
var lastRun = '2026-11-02T07:20:00Z';
var t0 = Date.parse(latestHour);

// A normal morning after the daily run: fresh.
var f = M.freshness(t0 + 9 * H, latestHour, lastRun, slo);
assert.strictEqual(f.state, 'fresh');
assert.strictEqual(f.word, 'Fresh');
assert.deepStrictEqual(f.reasons, []);

// Exactly at the limit is still fresh; one minute past is stale.
assert.strictEqual(M.freshness(t0 + 36 * H, latestHour, '2026-11-02T20:00:00Z', slo).state, 'fresh');
var late = M.freshness(t0 + 36 * H + 60000, latestHour, '2026-11-02T20:00:00Z', slo);
assert.strictEqual(late.state, 'stale');
assert.ok(/newest hour/.test(late.reasons[0]));

// The latest run is older than its SLO, even though the data is recent enough: stale.
var noRun = M.freshness(Date.parse('2026-11-03T10:00:00Z'), '2026-11-02T23:00:00Z', '2026-11-02T07:20:00Z', slo);
assert.strictEqual(noRun.state, 'stale');
assert.strictEqual(noRun.reasons.length, 1);
assert.ok(/last run was/.test(noRun.reasons[0]), noRun.reasons[0]);

// Both broken: both reasons are given.
var both = M.freshness(t0 + 5 * 24 * H, latestHour, lastRun, slo);
assert.strictEqual(both.state, 'stale');
assert.strictEqual(both.reasons.length, 2);

// No data at all is stale, never fresh by default.
assert.strictEqual(M.freshness(t0, null, null, slo).state, 'stale');

// Against the real aggregates: what a visitor sees soon after the last run, and a month later.
var health = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'aggregates', 'health.json'), 'utf8'));
health.calendar = M.expandCalendar(health);
var finished = health.latest_run.finished_at;
var soon = M.freshness(Date.parse(finished) + H, health.latest_hour, finished, health.contract.slo);
var month = M.freshness(Date.parse(finished) + 30 * 24 * H, health.latest_hour, finished, health.contract.slo);
assert.strictEqual(month.state, 'stale');
assert.strictEqual(health.contract.slo.max_data_age_hours, 36);
// Days with no run are not invisible: the page adds them up to yesterday by its own clock.
var lastDay = Date.parse(health.calendar[health.calendar.length - 1].date + 'T00:00:00Z');
var D = 24 * H;
var ext = M.extendCalendar(health.calendar, lastDay + 4 * D + 12 * H); // three whole days later, no runs
var added = ext.slice(health.calendar.length);
assert.deepStrictEqual(added.map(function (d) { return d.date; }),
  [1, 2, 3].map(function (k) { return new Date(lastDay + k * D).toISOString().slice(0, 10); }));
assert.ok(added.every(function (d) { return d.status === 'none'; }));
assert.strictEqual(M.extendCalendar(health.calendar, lastDay + D + 8 * H).length, health.calendar.length);
console.log('freshness: ok (an hour after the last run the page says ' + soon.word + '; a month later it says ' + month.word + ')');
