// Writes the card preview's recorded frames into model.js from tests/steps.json.
// Run: node projects/cardinal/tests/make-preview.js   (after saving a fresh steps.json)
'use strict';
var fs = require('fs');
var path = require('path');

var LABELS = { HASH_JOIN: 'Hash join' };

function rowsOf(tree) {
  // The preview shows the join and its two scans; the aggregate on top adds nothing to the story.
  var join = tree.op === 'HASH_JOIN' ? tree : tree.children[0];
  var out = [{ key: 'join', label: 'Hash join', detail: 'on customer', role: null, depth: 0, est: join.est, act: join.act }];
  join.children.forEach(function (c) {
    out.push({
      key: c.table,
      label: c.table,
      detail: (c.detail || '').replace(/=/g, ' = '),
      role: c.role,
      depth: 1,
      est: c.est,
      act: c.act
    });
  });
  return out;
}

function round1(x) { return Math.round(x * 10) / 10; }

// Frames: the best-seller query with one city as skew rises (previewFrames), then the flip itself,
// taken from guided step 4 at the laptop size, so the flipped plan's time and the other build side's
// time come from the same run on the same data (the fair comparison across the flip).
function framesFrom(steps) {
  var laptop = steps.sizes.slice().sort(function (a, b) { return b.orders - a.orders; })[0];
  var flip = laptop.steps.filter(function (s) { return s.id === 'flip'; })[0];
  var frames = steps.previewFrames.filter(function (f) { return f.scope === 'city'; }).map(function (f) {
    return { theta: f.theta, scope: f.scope, ms: f.ms, rows: rowsOf(f.tree) };
  });
  frames.push({
    theta: flip.settings.theta, scope: flip.then.scope, ms: round1(flip.after.timing.median),
    altMs: round1(flip.after.alt.timing.median), altBuild: flip.after.alt.build, rows: rowsOf(flip.after.tree)
  });
  return {
    source: 'tests/steps.json, recorded ' + steps.generatedAt + ' with duckdb-wasm ' + steps.packageVersion + ' (DuckDB ' + steps.duckdbVersion + ')',
    frames: frames
  };
}

if (require.main === module) {
  var steps = JSON.parse(fs.readFileSync(path.join(__dirname, 'steps.json'), 'utf8'));
  var data = framesFrom(steps);
  var file = path.join(__dirname, '..', 'model.js');
  var src = fs.readFileSync(file, 'utf8');
  var block = '// BEGIN RECORDED_PREVIEW\n  var RECORDED_PREVIEW = ' + JSON.stringify(data) + ';\n  // END RECORDED_PREVIEW';
  var next = src.replace(/\/\/ BEGIN RECORDED_PREVIEW[\s\S]*?\/\/ END RECORDED_PREVIEW/, block);
  if (next === src && src.indexOf(block) < 0) { console.error('markers not found'); process.exit(1); }
  fs.writeFileSync(file, next);
  console.log('wrote ' + data.frames.length + ' preview frames into model.js');
}

module.exports = { framesFrom: framesFrom, LABELS: LABELS };
