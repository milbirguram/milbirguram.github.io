// Independent check: recompute each city's high-risk hours straight from the stored,
// validated CSV partitions (not with the pipeline's code) and compare with the
// aggregate the page shows. Rule: ECCC reports the AQHI rounded to a whole number;
// 7 and above is "high risk", so a reading counts when it is 6.5 or more.
//   node projects/almanac/tests/recompute-headline.js [data-dir]
var assert = require('assert');
var fs = require('fs');
var path = require('path');

var dataDir = process.argv[2] || path.join(__dirname, '..', 'data');
var root = path.join(dataDir, 'validated');

function walk(dir) {
  var out = [];
  fs.readdirSync(dir).forEach(function (n) {
    var p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (/\.csv$/.test(n)) out.push(p);
  });
  return out.sort();
}

var counts = {}, readings = {}, seen = {};
walk(root).forEach(function (file) {
  var lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  var head = lines[0].split(',');
  var iId = head.indexOf('location_id'), iV = head.indexOf('aqhi'), iH = head.indexOf('hour_utc'), iD = head.indexOf('date');
  lines.slice(1).forEach(function (line) {
    var c = line.split(',');
    var key = c[iD] + ' ' + c[iH] + ' ' + c[iId];
    assert.ok(!seen[key], 'duplicate stored reading ' + key);
    seen[key] = true;
    var v = parseFloat(c[iV]);
    readings[c[iId]] = (readings[c[iId]] || 0) + 1;
    counts[c[iId]] = (counts[c[iId]] || 0) + (v >= 6.5 ? 1 : 0);
  });
});

// A second, rougher path: straight from the raw slices as ECCC wrote them, one column per
// city. With nothing quarantined the two must agree exactly.
var rawCounts = {}, quarantined = 0;
var qdir = path.join(dataDir, 'quarantine');
if (fs.existsSync(qdir)) walk(qdir).forEach(function (f) { quarantined += fs.readFileSync(f, 'utf8').trim().split('\n').length - 1; });
if (fs.existsSync(path.join(dataDir, 'raw'))) {
  walk(path.join(dataDir, 'raw')).forEach(function (file) {
    var lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    var head = lines[0].split(',');
    lines.slice(1).forEach(function (line) {
      var c = line.split(',');
      head.forEach(function (id, i) {
        if (i < 2 || c[i] === undefined || c[i].trim() === '') return;
        var v = parseFloat(c[i]);
        if (v >= 6.5 && v <= 11) rawCounts[id] = (rawCounts[id] || 0) + 1;
      });
    });
  });
}

var summary = JSON.parse(fs.readFileSync(path.join(dataDir, 'aggregates', 'summary.json'), 'utf8'));
summary.cities.forEach(function (c) {
  var mine = counts[c.id] || 0;
  if (quarantined === 0) assert.strictEqual(rawCounts[c.id] || 0, mine, c.city + ': raw slices say ' + rawCounts[c.id]);
  assert.strictEqual(c.high_hours, mine, c.city + ': page says ' + c.high_hours + ', stored data says ' + mine);
  assert.strictEqual(c.hours_with_reading, readings[c.id] || 0, c.city + ' readings');
  var bars = summary.series[c.id].hi.reduce(function (a, b) { return a + (b || 0); }, 0);
  assert.strictEqual(bars, mine, c.city + ': the chart bars add up to ' + bars);
  console.log('  ' + (c.city + '              ').slice(0, 14) + ('     ' + mine).slice(-5) + ' high-risk hours  (page: ' + c.high_hours + ')');
});
console.log('recompute-headline: ok, ' + Object.keys(seen).length + ' stored readings');
