// Shared helpers for Bromide's tests.
// Each check runs against a model built from tests/fixture (my own prose, three
// tiny "books" in Project Gutenberg format) and, when it exists, against the
// shipped model in data/model.bin.
'use strict';
var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var ROOT = path.join(__dirname, '..');
var Bromide = require(path.join(ROOT, 'model.js'));
var PY = process.env.PYTHON || 'python';
var FIXTURE_OUT = path.join(os.tmpdir(), 'bromide-fixture-model');
// BROMIDE_DATA points the shipped-model tests at another build (e.g. a trial build outside the repo).
var SHIPPED = path.join(process.env.BROMIDE_DATA || path.join(ROOT, 'data'), 'model.bin');

function python(args, input) {
  var r = cp.spawnSync(PY, ['-I'].concat(args), { input: input, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error('python ' + args.join(' ') + ' failed:\n' + r.stderr);
  return r.stdout;
}

// The fixture is far too small for the preview lines to mean anything, so the
// build's preview check is waived for it (--allow-preview).
var built = {};
function buildFixture(out, extra) {
  if (!built[out]) {
    python([path.join(ROOT, 'build', 'build_model.py'), path.join(__dirname, 'fixture'), out, '--allow-preview'].concat(extra || []));
    built[out] = true;
  }
  return path.join(out, 'model.bin');
}
function fixtureModelPath() { return buildFixture(FIXTURE_OUT); }
// The same fixture with pruning forced on (bigrams in fewer than 2 contexts and
// trigrams seen once are dropped), to test the pruned, rounded format.
function prunedFixtureModelPath() { return buildFixture(FIXTURE_OUT + '-pruned', ['--prune=2,2']); }

function models() {
  var list = [{ name: 'fixture', path: fixtureModelPath() }];
  if (fs.existsSync(SHIPPED)) list.push({ name: 'shipped', path: SHIPPED });
  else console.log('  note: data/model.bin is not built yet; checking the fixture model only');
  return list.map(function (m) {
    m.model = Bromide.load(fs.readFileSync(m.path));
    return m;
  });
}

// Small seeded PRNG so failures are reproducible.
function rng(seed) {
  var s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    var t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = {
  ROOT: ROOT, Bromide: Bromide, python: python, models: models, rng: rng,
  SHIPPED: SHIPPED, fixtureModelPath: fixtureModelPath, prunedFixtureModelPath: prunedFixtureModelPath
};
