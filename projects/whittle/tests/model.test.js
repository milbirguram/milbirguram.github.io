// Headless checks for the Whittle engine. Run: node projects/whittle/tests/model.test.js
// Every check is seeded, so a run is reproducible. Exits non-zero if any check fails.
'use strict';
var assert = require('assert');
var path = require('path');
var fs = require('fs');
var M = require(path.join(__dirname, '..', 'model.js'));

var passed = 0, failed = 0;
function check(name, fn) {
  var t = Date.now();
  try { var note = fn(); passed++; console.log('ok   ' + name + (note ? '  (' + note + ')' : '') + '  ' + (Date.now() - t) + ' ms'); }
  catch (e) { failed++; console.error('FAIL ' + name + '\n     ' + (e && e.stack || e)); process.exitCode = 1; }
}

var RUNS = M.RUNS;

// ------------------------------------------------------------------ the engine itself
check('PRNG is deterministic and in [0, 1)', function () {
  var a = M.rng(7), b = M.rng(7);
  for (var i = 0; i < 1000; i++) { var x = a(); assert.strictEqual(x, b()); assert(x >= 0 && x < 1); }
});

check('replaying a recorded choice sequence rebuilds the same value', function () {
  M.specs.forEach(function (s) {
    var r = M.rng(3);
    for (var i = 0; i < 300; i++) {
      var d = new M.Data(r, null, M.sizeAt(i, 30)), v = s.gen.draw(d);
      var back = M.replay(s.gen, d.choices, d.size);
      assert.deepStrictEqual(back.value, v, s.id);
      assert.deepStrictEqual(back.choices, d.choices, s.id);
    }
  });
});

check('size grows over a run', function () {
  assert.strictEqual(M.sizeAt(0, 30), 1);
  assert(M.sizeAt(30, 30) > M.sizeAt(3, 30));
  assert.strictEqual(M.sizeAt(999, 30), 30);
});

// ------------------------------------------------------------------ (a) strong properties refute, weak ones do not
var SEEDS_A = 1000;
M.specs.forEach(function (s) {
  s.properties.filter(function (p) { return p.strength === 'strong'; }).forEach(function (p) {
    check('(a) ' + s.id + ' / ' + p.id + ' refutes the buggy version within ' + RUNS + ' runs in >= 99% of ' + SEEDS_A + ' seeds', function () {
      var hits = 0, worst = 0, total = 0;
      for (var seed = 1; seed <= SEEDS_A; seed++) {
        var run = M.runProperty(s, p, s.buggy, { seed: seed, runs: RUNS });
        if (run.status === 'refuted') { hits++; total += run.tried; worst = Math.max(worst, run.tried); }
      }
      assert(hits >= 0.99 * SEEDS_A, hits + ' of ' + SEEDS_A);
      return hits + '/' + SEEDS_A + ', mean ' + (total / hits).toFixed(1) + ' inputs, worst ' + worst;
    });
  });
  var strongest = s.properties.filter(function (p) { return p.strength === 'strong'; });
  check('(a) ' + s.id + ' has at least one strong and one weak property', function () {
    assert(strongest.length >= 1);
    assert(s.properties.some(function (p) { return p.strength === 'weak'; }));
  });
  s.properties.filter(function (p) { return p.strength === 'weak'; }).forEach(function (p) {
    check('(a) ' + s.id + ' / ' + p.id + ' is weak as documented: misses the bug in 200 seeds x ' + RUNS + ' runs', function () {
      var skipped = 0;
      for (var seed = 1; seed <= 200; seed++) {
        var run = M.runProperty(s, p, s.buggy, { seed: seed, runs: RUNS });
        assert.strictEqual(run.status, 'survived', 'seed ' + seed + ': ' + JSON.stringify(run.failure && run.failure.value));
        skipped += run.discarded;
      }
      assert(p.why && p.why.length > 20, 'documented');
      return skipped ? 'mean ' + (skipped / 200).toFixed(0) + ' of ' + RUNS + ' skipped by its precondition' : '';
    });
  });
});

// ------------------------------------------------------------------ (b) shrinking: deterministic, valid, locally minimal
// The neighbourhood a single shrink step can reach, built here independently of the shrinker:
// delete or zero a block of k choices (k in the shrinker's block sizes), or set one choice to
// 0, half its value, or one less.
function neighbours(seq) {
  var out = [];
  M.BLOCKS.forEach(function (k) {
    for (var i = 0; i + k <= seq.length; i++) {
      out.push(seq.slice(0, i).concat(seq.slice(i + k)));
      var z = seq.slice(); for (var j = i; j < i + k; j++) z[j] = 0; out.push(z);
    }
  });
  seq.forEach(function (v, i) {
    if (!v) return;
    [0, v >> 1, v - 1].forEach(function (w) { var c = seq.slice(); c[i] = w; out.push(c); });
  });
  return out;
}

function fails(s, p, impl, value) {
  var r = M.evaluate(p, value, impl);
  return !r.skip && !r.ok;
}

M.specs.forEach(function (s) {
  s.properties.filter(function (p) { return p.strength === 'strong'; }).forEach(function (p) {
    check('(b) ' + s.id + ' / ' + p.id + ': shrinking is deterministic, every step fails and is simpler, and the result is locally minimal (80 seeds)', function () {
      var results = {}, maxSteps = 0;
      for (var seed = 1; seed <= 80; seed++) {
        var e1 = M.experiment(s.id, p.id, 'buggy', seed), e2 = M.experiment(s.id, p.id, 'buggy', seed);
        assert.strictEqual(e1.run.status, 'refuted');
        assert.strictEqual(JSON.stringify(e1.shrunk.steps.map(function (x) { return x.choices; })),
          JSON.stringify(e2.shrunk.steps.map(function (x) { return x.choices; })), 'deterministic');
        var sh = e1.shrunk, size = e1.run.failure.size;
        assert(sh.complete, 'finished inside the budget');
        // each step still fails and is strictly simpler than the one before
        var prev = sh.original.choices;
        sh.steps.forEach(function (st) {
          assert(M.compare(st.choices, prev) < 0, 'strictly simpler');
          assert(fails(s, p, s.buggy, M.replay(s.gen, st.choices, size).value), 'step still fails');
          prev = st.choices;
        });
        assert(fails(s, p, s.buggy, sh.value), 'result fails');
        // local minimality
        neighbours(sh.choices).forEach(function (cand) {
          var r = M.replay(s.gen, cand, size);
          if (M.compare(r.choices, sh.choices) >= 0) return;
          assert(!fails(s, p, s.buggy, r.value), 'seed ' + seed + ': neighbour ' + JSON.stringify(r.value) + ' of ' + JSON.stringify(sh.value) + ' still fails');
        });
        var key = s.show(sh.value);
        results[key] = (results[key] || 0) + 1;
        maxSteps = Math.max(maxSteps, sh.steps.length);
      }
      var top = Object.keys(results).sort(function (a, b) { return results[b] - results[a]; })[0];
      return 'most common result ' + top + ' (' + results[top] + '/80), up to ' + maxSteps + ' steps';
    });
  });
});

check('(b) a hand-made failing input shrinks to the known smallest one', function () {
  var s = M.byId('split'), p = M.propOf(s, 'sum');
  // 9.99 split 7 ways: find its choice sequence by drawing until we get a failing value, then shrink.
  var run = M.runProperty(s, p, s.buggy, { seed: 11, runs: RUNS });
  var sh = M.shrink(s, p, s.buggy, run.failure);
  assert.deepStrictEqual(sh.value, { cents: 1, n: 2 });
  var c = M.byId('csv'), cr = M.runProperty(c, M.propOf(c, 'round'), c.buggy, { seed: 5, runs: RUNS });
  assert.deepStrictEqual(M.shrink(c, M.propOf(c, 'round'), c.buggy, cr.failure).value, ['"']);
  var r = M.byId('rle'), rr = M.runProperty(r, M.propOf(r, 'round'), r.buggy, { seed: 2, runs: RUNS });
  assert.strictEqual(M.shrink(r, M.propOf(r, 'round'), r.buggy, rr.failure).value, 'aaaaaaaaaa');
});

// ------------------------------------------------------------------ (c) correct versions survive everything
M.specs.forEach(function (s) {
  check('(c) ' + s.id + ': the fixed version passes every property, 10 seeds x ' + RUNS + ' runs each', function () {
    var notes = [];
    s.properties.forEach(function (p) {
      var tested = 0;
      for (var seed = 101; seed <= 110; seed++) {
        var run = M.runProperty(s, p, s.fixed, { seed: seed, runs: RUNS });
        assert.strictEqual(run.status, 'survived', p.id + ' seed ' + seed + ': ' + JSON.stringify(run.failure && run.failure.value));
        tested += run.tried - run.discarded;
      }
      notes.push(p.id + ' ' + tested);
    });
    return 'non-skipped inputs: ' + notes.join(', ');
  });
});

// ------------------------------------------------------------------ (d) the example tests pass on both versions
M.specs.forEach(function (s) {
  check('(d) ' + s.id + ': 3-4 example tests, all pass on the buggy version (and the fixed one)', function () {
    assert(s.examples.length >= 3 && s.examples.length <= 4);
    var b = M.runExamples(s, s.buggy), f = M.runExamples(s, s.fixed);
    assert.strictEqual(b.passed, b.total, 'buggy');
    assert.strictEqual(f.passed, f.total, 'fixed');
  });
});

// ------------------------------------------------------------------ what is shown is what runs
M.specs.forEach(function (s) {
  check(s.id + ': the code on screen is the code that runs, and the bug marker finds one line', function () {
    var b = M.sourceOf(s, 'buggy'), f = M.sourceOf(s, 'fixed');
    var hits = b.lines.filter(function (l) { return l.indexOf(s.bugMarker) >= 0; }).length;
    assert.strictEqual(hits, 1, 'marker once in buggy');
    assert.strictEqual(f.text.indexOf(s.bugMarker), -1, 'marker absent in fixed');
    assert(b.bugLine >= 0 && f.bugLine === -1);
    Object.keys(s.buggy).forEach(function (k) {
      if (k === 'formatRow') return; // shown as text, built from quote; checked below
      var src = s.buggy[k].toString().replace(/\r/g, '');
      var body = src.split('\n').slice(1, -1).map(function (l) { return l.trim(); }).join('\n');
      var shown = b.lines.map(function (l) { return l.trim(); }).join('\n');
      assert(shown.indexOf(body) >= 0, k + ' body shown');
    });
  });
});
check('csv: formatRow as shown behaves like the real one', function () {
  var s = M.byId('csv');
  /* eslint-disable no-new-func */
  var shown = new Function('quote', 'return ' + M.sourceOf(s, 'buggy').lines.slice(M.sourceOf(s, 'buggy').lines.indexOf('function formatRow(fields) {')).join('\n'))(s.buggy.quote);
  ['a', 'x,y', 'q"', ''].forEach(function (f) { assert.strictEqual(shown([f, 'b']), s.buggy.formatRow([f, 'b'])); });
});

// ------------------------------------------------------------------ (e) counts come from the engine
check('(e) the scoreboard is built only from engine results', function () {
  var e = M.experiment('dedupe', 'ref', 'buggy', 4);
  var sb = M.scoreboard(e);
  assert.strictEqual(sb.examples, e.examples.passed + '/' + e.examples.total + ' passed');
  assert(sb.property.indexOf(M.fmtInt(e.run.tried) + ' input') >= 0);
  assert(sb.shrink.indexOf(M.fmtInt(e.shrunk.steps.length) + ' step') >= 0);
  assert.strictEqual(e.run.inputs.length, e.run.tried, 'one recorded input per run');
  assert.strictEqual(e.run.inputs[e.run.inputs.length - 1].outcome, 'fail');
  var f = M.experiment('dedupe', 'ref', 'fixed', 4), sf = M.scoreboard(f);
  assert(sf.property.indexOf(M.fmtInt(RUNS)) >= 0 && f.run.status === 'survived');
  assert.strictEqual(M.fmtInt(1000), '1,000');
});

check('(e) inputs skipped by a precondition are not counted as attempts to refute', function () {
  var e = M.experiment('csv', 'plain', 'buggy', 3), sb = M.scoreboard(e);
  assert.strictEqual(e.run.status, 'survived');
  assert(e.run.discarded > 0, 'this property skips inputs');
  var tested = e.run.tried - e.run.discarded;
  assert(sb.property.indexOf('survived ' + M.fmtInt(tested) + ' attempts') === 0, sb.property);
  assert(sb.property.indexOf(M.fmtInt(e.run.discarded) + ' more skipped') >= 0, sb.property);
  assert(sb.property.indexOf(M.fmtInt(e.run.tried) + ' attempts') < 0, 'does not claim every generated input as an attempt');
  var app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert(!/'survived ' \+ W\.fmtInt\(run\.tried\)/.test(app), 'the badge does not count skipped inputs');
  assert(!/plural\(run\.tried, 'attempt'\)|fmtInt\(run\.tried\) \+ ' attempts/.test(app), 'the lessons do not count skipped inputs');
});

check('(e) the preview replays real runs that meet its stated rule', function () {
  var R = M.PREVIEW_RULE;
  assert(M.PREVIEW.length >= 4);
  M.PREVIEW.forEach(function (d) {
    var s = M.byId(d.fn), e = M.experiment(d.fn, M.strongest(s).id, 'buggy', d.seed);
    assert.strictEqual(e.run.status, 'refuted', d.fn);
    assert(e.run.tried >= R.minInputs && e.run.tried <= R.maxInputs, d.fn + ' inputs ' + e.run.tried);
    assert(e.shrunk.steps.length >= R.minSteps && e.shrunk.steps.length <= R.maxSteps, d.fn + ' steps ' + e.shrunk.steps.length);
  });
  var app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert(/W\.PREVIEW\.map/.test(app) && !/for \(var seed = 1; seed </.test(app), 'the preview uses the listed seeds and does not search at load');
});

check('first runs show real whittling: few runs shrink in 0 or 1 steps (300 seeds)', function () {
  var notes = [];
  [['dedupe', 0.15], ['search', 0.15], ['split', 0.15], ['rle', 0.35], ['csv', 0.5]].forEach(function (x) {
    var s = M.byId(x[0]), p = M.strongest(s), short = 0, steps = 0;
    for (var seed = 1; seed <= 300; seed++) {
      var k = M.experiment(s.id, p.id, 'buggy', seed).shrunk.steps.length;
      steps += k; if (k <= 1) short++;
    }
    assert(short <= x[1] * 300, x[0] + ': ' + short + ' of 300 shrank in 0 or 1 steps');
    notes.push(x[0] + ' ' + short + '/300 short, mean ' + (steps / 300).toFixed(1) + ' steps');
  });
  return notes.join('; ');
});

check('dedupe: the shown result is minimal too: no single deletion or move towards 0 still fails (300 seeds)', function () {
  var s = M.byId('dedupe'), p = M.propOf(s, 'ref'), results = {};
  for (var seed = 1; seed <= 300; seed++) {
    var v = M.experiment('dedupe', 'ref', 'buggy', seed).shrunk.value;
    v.forEach(function (x, i) {
      var cands = [v.slice(0, i).concat(v.slice(i + 1))];
      if (x !== 0) { var c = v.slice(); c[i] = x - Math.sign(x); cands.push(c); c = v.slice(); c[i] = 0; cands.push(c); }
      cands.forEach(function (c) { assert(!fails(s, p, s.buggy, c), 'seed ' + seed + ': ' + JSON.stringify(c) + ' from ' + JSON.stringify(v) + ' still fails'); });
    });
    results[s.show(v)] = (results[s.show(v)] || 0) + 1;
  }
  return Object.keys(results).sort(function (a, b) { return results[b] - results[a]; }).map(function (k) { return k + ' ' + results[k]; }).join(', ');
});

check('(e) no counts are typed into the page or the app', function () {
  var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  var stage = html.slice(html.indexOf('data-kit-stage'), html.lastIndexOf('</section>'));
  var text = stage.replace(/<[^>]*>/g, ' ');
  assert(!/\d/.test(text), 'digits in stage text: ' + (text.match(/.{0,20}\d.{0,20}/) || [''])[0]);
  var lede = (html.match(/<p class="kit-lede">([\s\S]*?)<\/p>/) || [])[1] || '';
  assert(!/\d/.test(lede), 'digits in the lede');
  var app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  var strings = app.match(/'[^'\n]*'|"[^"\n]*"/g) || [];
  var bad = strings.filter(function (str) { return /\d+\s*(inputs?|steps?|passed|attempts?|runs?|tries|skipped)\b/i.test(str); });
  assert.deepStrictEqual(bad, [], 'hard-coded counts in app.js strings');
  assert(!/\b1000\b|1,000/.test(app), 'the run budget is taken from the model, not typed in');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
