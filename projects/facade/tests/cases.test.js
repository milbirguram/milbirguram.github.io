// Node test for Facade's cases and scorer. Run: node projects/facade/tests/cases.test.js
'use strict';
var assert = require('assert');
var path = require('path');
var CASES = require(path.join(__dirname, '..', 'cases.js'));
var F = require(path.join(__dirname, '..', 'model.js'));

var failures = 0, passes = 0;
function test(name, fn) {
  try { fn(); passes++; console.log('ok   ' + name); }
  catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + e.message); }
}

function words(s) { return s.trim().split(/\s+/).length; }
function invitedAnswer(c) { return F.findAnswer(c, c.invited); }
function trueAnswers(c) { return c.answers.filter(function (a) { return a.correct; }); }
var OUTS = ['knew', 'lucky', 'wrong'];

// The final reflection must describe only what the visitor chose, and read as plain English.
var ALL_NOUNS = [];
CASES.forEach(function (c) { c.answers.forEach(function (a) { a.bases.forEach(function (b) { if (b.noun) ALL_NOUNS.push(b.noun); }); }); });
function chosenBasis(c, x) { return F.findBasis(F.findAnswer(c, x.answer), x.basis); }
function checkReflection(r, s) {
  var paras = F.reflect(CASES, r);
  var text = paras.join(' ');
  var where = JSON.stringify(r);
  if (/\d/.test(text)) throw new Error('numeral in reflection: ' + text);
  if (/undefined|null|NaN/.test(text)) throw new Error('bad value in reflection: ' + text);
  if (/none of them knew nothing/.test(text)) throw new Error('double negative: ' + text);
  if (s.knew === 0 && /The other/.test(text)) throw new Error('"the other" with no first group: ' + where);
  if (s.right === 0 && !/^None of your answers were true/.test(paras[0])) throw new Error('right 0 not handled: ' + paras[0]);
  if (s.lucky === 0 && /right by luck/.test(paras[0])) throw new Error('luck named when there was none');
  // Exactly the chosen lucky bases are named in the first paragraph.
  var chosen = [], onEvidence = false;
  CASES.forEach(function (c) {
    var x = r[c.id];
    if (F.outcome(c, x.answer, x.basis) !== 'lucky') return;
    var b = chosenBasis(c, x);
    chosen.push(b.noun);
    if (b.source === 'evidence') onEvidence = true;
  });
  chosen.forEach(function (n) { if (paras[0].indexOf(n) < 0) throw new Error('missing chosen noun ' + n + ' in ' + paras[0]); });
  ALL_NOUNS.forEach(function (n) {
    if (chosen.indexOf(n) < 0 && paras[0].indexOf(n) >= 0) throw new Error('names unchosen evidence "' + n + '": ' + paras[0]);
  });
  // "felt no different from knowing" only when some lucky answer rested on evidence.
  if (/felt no different from knowing/.test(text) && !onEvidence) throw new Error('claims a hunch felt like knowing: ' + where);
}

test('ten cases in the planned mix: 4 Gettier, 3 control, 2 false, 1 pivot', function () {
  assert.strictEqual(CASES.length, 10);
  var n = {};
  CASES.forEach(function (c) { n[c.kind] = (n[c.kind] || 0) + 1; });
  assert.deepStrictEqual(n, { gettier: 4, control: 3, 'false': 2, pivot: 1 });
});

test('ids are unique and every case has the required structure', function () {
  var seen = {};
  CASES.forEach(function (c) {
    assert.ok(!seen[c.id], 'duplicate id ' + c.id); seen[c.id] = true;
    ['justified', 'true', 'luckyLink'].forEach(function (k) {
      assert.strictEqual(typeof c[k], 'boolean', c.id + '.' + k + ' must be boolean');
    });
    ['truthmaker', 'whatTheEvidenceTracks', 'title', 'story', 'question', 'facts', 'invited'].forEach(function (k) {
      assert.ok(typeof c[k] === 'string' && c[k].length > 0, c.id + '.' + k + ' must be a non-empty string');
    });
    assert.ok(c.intendedOutcomeByEvidenceChoice && typeof c.intendedOutcomeByEvidenceChoice === 'object');
    assert.ok(invitedAnswer(c), c.id + ': invited answer exists');
  });
});

test('stories are 60 to 120 words', function () {
  CASES.forEach(function (c) {
    var n = words(c.story);
    assert.ok(n >= 60 && n <= 120, c.id + ' story has ' + n + ' words');
  });
});

test('each case has exactly one true answer, and every answer offers 2 or 3 bases', function () {
  CASES.forEach(function (c) {
    assert.strictEqual(trueAnswers(c).length, 1, c.id);
    c.answers.forEach(function (a) {
      assert.ok(a.bases.length >= 2 && a.bases.length <= 3, c.id + '/' + a.id + ' has ' + a.bases.length + ' bases');
    });
    var invited = invitedAnswer(c);
    assert.ok(invited.bases.length >= 2 && invited.bases.length <= 3, c.id + ': invited answer offers 2 or 3 pieces of evidence');
  });
});

test('field `true` matches whether the invited answer is correct', function () {
  CASES.forEach(function (c) { assert.strictEqual(c['true'], invitedAnswer(c).correct, c.id); });
});

test('field `justified` matches: the invited answer rests on real evidence from the story', function () {
  CASES.forEach(function (c) {
    var evidence = invitedAnswer(c).bases.filter(function (b) { return b.source === 'evidence'; });
    assert.strictEqual(c.justified, evidence.length > 0, c.id);
  });
});

test('field `luckyLink` matches the evidence for the invited answer', function () {
  CASES.forEach(function (c) {
    var ev = invitedAnswer(c).bases.filter(function (b) { return b.source === 'evidence'; });
    if (!c['true']) { assert.strictEqual(c.luckyLink, false, c.id + ': a false belief has no lucky link'); return; }
    if (c.kind === 'pivot') {
      assert.strictEqual(c.luckyLink, true, c.id + ': the most salient evidence is lucky');
      ev.forEach(function (b) {
        assert.strictEqual(c.luckyLinkByEvidence[b.id], !b.tracks, c.id + '/' + b.id);
      });
      return;
    }
    ev.forEach(function (b) { assert.strictEqual(c.luckyLink, !b.tracks, c.id + '/' + b.id); });
  });
});

test('Gettier cases are justified, true and lucky, and no basis for the true answer tracks', function () {
  CASES.filter(function (c) { return c.kind === 'gettier'; }).forEach(function (c) {
    assert.ok(c.justified && c['true'] && c.luckyLink, c.id);
    trueAnswers(c)[0].bases.forEach(function (b) { assert.strictEqual(b.tracks, false, c.id + '/' + b.id); });
  });
});

test('controls are justified, true and not lucky, and their evidence tracks', function () {
  CASES.filter(function (c) { return c.kind === 'control'; }).forEach(function (c) {
    assert.ok(c.justified && c['true'] && !c.luckyLink, c.id);
    invitedAnswer(c).bases.filter(function (b) { return b.source === 'evidence'; })
      .forEach(function (b) { assert.strictEqual(b.tracks, true, c.id + '/' + b.id); });
  });
});

test('false cases are justified but false: the invited answer is wrong', function () {
  CASES.filter(function (c) { return c.kind === 'false'; }).forEach(function (c) {
    assert.ok(c.justified, c.id);
    assert.strictEqual(c['true'], false, c.id);
    assert.strictEqual(invitedAnswer(c).correct, false, c.id);
  });
});

test('the pivot case: the evidence you pick decides between Knew and Right by luck', function () {
  var p = CASES.filter(function (c) { return c.kind === 'pivot'; })[0];
  assert.ok(p.justified && p['true'], p.id);
  var t = trueAnswers(p)[0];
  var outs = t.bases.map(function (b) { return F.outcome(p, t.id, b.id); });
  assert.ok(outs.indexOf('knew') >= 0 && outs.indexOf('lucky') >= 0, 'pivot outcomes: ' + outs.join(','));
});

test('a false answer never tracks, and a hunch never tracks', function () {
  CASES.forEach(function (c) {
    c.answers.forEach(function (a) {
      a.bases.forEach(function (b) {
        if (!a.correct) assert.strictEqual(b.tracks, false, c.id + '/' + a.id + '/' + b.id);
        if (b.source === 'hunch') assert.strictEqual(b.tracks, false, c.id + '/' + b.id);
        assert.ok(b.source === 'evidence' || b.source === 'hunch', c.id + '/' + b.id + ' source');
        assert.ok(b.why && b.text, c.id + '/' + b.id + ' has text and why');
      });
    });
  });
});

test('every answer/evidence pair maps to exactly one outcome, and it matches the intended one', function () {
  CASES.forEach(function (c) {
    var keys = F.combos(c);
    var intended = c.intendedOutcomeByEvidenceChoice;
    assert.deepStrictEqual(Object.keys(intended).sort(), keys.slice().sort(), c.id + ': intended table covers exactly the pairs offered');
    assert.strictEqual(new Set(keys).size, keys.length, c.id + ': no duplicate pairs');
    keys.forEach(function (k) {
      var parts = k.split('/');
      var o = F.outcome(c, parts[0], parts[1]);
      assert.strictEqual(OUTS.filter(function (x) { return x === o; }).length, 1, c.id + ' ' + k + ' -> ' + o);
      assert.strictEqual(o, intended[k], c.id + ' ' + k + ': computed ' + o + ', intended ' + intended[k]);
    });
  });
});

test('outcome rejects answers and bases that are not offered', function () {
  assert.throws(function () { F.outcome(CASES[0], 'yes', 'nope'); });
  assert.throws(function () { F.outcome(CASES[0], 'maybe', 'clock'); });
  // A basis that belongs to another answer is not a valid pick.
  assert.throws(function () { F.outcome(CASES[0], 'no', 'clock'); });
});

test('score: following the evidence everywhere gives Right 8, Knew 3 or 4 depending on the field', function () {
  function follow(pickTracking) {
    var r = {};
    CASES.forEach(function (c) {
      var a = invitedAnswer(c);
      var ev = a.bases.filter(function (b) { return b.source === 'evidence'; });
      var pick = ev[0];
      if (pickTracking) ev.forEach(function (b) { if (b.tracks) pick = b; });
      r[c.id] = { answer: a.id, basis: pick.id };
    });
    return F.score(CASES, r);
  }
  var a = follow(false), b = follow(true);
  assert.strictEqual(a.right, 8); assert.strictEqual(a.knew, 3);
  assert.strictEqual(b.right, 8); assert.strictEqual(b.knew, 4);
  assert.strictEqual(b.lucky + b.knew + b.wrong, 10);
  assert.strictEqual(b.maxKnew, 4);
});

test('score and reflection: no strategy beats maxKnew, and the reflection reads correctly, over every possible play', function () {
  // Exhaustive over all combinations: product of pairs per case (3^10 = 59049).
  var lists = CASES.map(F.combos);
  var best = 0, idx = lists.map(function () { return 0; });
  var count = 0, expected = lists.reduce(function (n, l) { return n * l.length; }, 1);
  for (;;) {
    var r = {};
    CASES.forEach(function (c, i) { var p = lists[i][idx[i]].split('/'); r[c.id] = { answer: p[0], basis: p[1] }; });
    var s = F.score(CASES, r);
    assert.ok(s.knew <= s.right, 'knew never exceeds right');
    if (s.knew > best) best = s.knew;
    checkReflection(r, s);
    count++;
    var k = 0;
    while (k < idx.length && ++idx[k] === lists[k].length) { idx[k] = 0; k++; }
    if (k === idx.length) break;
  }
  assert.strictEqual(best, F.maxKnew(CASES));
  assert.strictEqual(count, expected);
  console.log('     (' + count + ' plays checked, reflection included)');
});

test('scores partial play correctly', function () {
  var s = F.score(CASES, { clock: { answer: 'yes', basis: 'clock' }, landed: { answer: 'yes', basis: 'app' } });
  assert.strictEqual(s.answered, 2); assert.strictEqual(s.right, 2); assert.strictEqual(s.knew, 1); assert.strictEqual(s.lucky, 1);
});


test('every basis that can score Right by luck has its own noun for the reflection', function () {
  var seen = {};
  CASES.forEach(function (c) {
    c.answers.forEach(function (a) {
      a.bases.forEach(function (b) {
        if (F.outcome(c, a.id, b.id) !== 'lucky') return;
        assert.ok(typeof b.noun === 'string' && b.noun.length > 0, c.id + '/' + a.id + '/' + b.id + ' needs a noun');
        assert.ok(!seen[b.noun], 'noun used twice: ' + b.noun);
        seen[b.noun] = true;
      });
    });
    assert.ok(!('luckNoun' in c), c.id + ': per-case luckNoun is gone; nouns live on bases');
  });
});

test('a case nobody can know has no tracking basis on any answer', function () {
  CASES.forEach(function (c) {
    var tracking = [];
    c.answers.forEach(function (a) { a.bases.forEach(function (b) { if (b.tracks) tracking.push(a.id + '/' + b.id); }); });
    if (c.kind === 'gettier' || c.kind === 'false') assert.deepStrictEqual(tracking, [], c.id);
    else assert.ok(tracking.length >= 1, c.id);
  });
});

test('reflection on the paths the verifier flagged', function () {
  function play(pick) { var r = {}; CASES.forEach(function (c) { r[c.id] = pick(c); }); return r; }
  // Evidence-following, second basis everywhere.
  var second = play(function (c) { var a = invitedAnswer(c); return { answer: a.id, basis: a.bases[1].id }; });
  var p = F.reflect(CASES, second);
  assert.ok(/none of them knew anything about/.test(p[0]), p[0]);
  assert.ok(p[0].indexOf('a stopped clock') < 0 && p[0].indexOf('a rough sense of the time') >= 0, p[0]);
  assert.ok(/^You were right eight times and knew four\. The other four were right by luck/.test(p[0]), p[0]);
  assert.ok(/^You were wrong twice\. Both rested on good evidence/.test(p[p.length - 1]), p[p.length - 1]);
  // All wrong: Yes on the false cases, No elsewhere.
  var allWrong = play(function (c) {
    var a = c.answers.filter(function (x) { return !x.correct; })[0];
    return { answer: a.id, basis: a.bases[0].id };
  });
  assert.strictEqual(F.score(CASES, allWrong).right, 0);
  p = F.reflect(CASES, allWrong);
  assert.ok(/^None of your answers were true/.test(p[0]), p[0]);
  assert.ok(/You were wrong ten times\. Two of those rested on good evidence/.test(p[p.length - 1]), p[p.length - 1]);
  // Right only by hunch, knew none.
  var hunchOnly = play(function (c) {
    var a = c.kind === 'false' ? F.findAnswer(c, 'no') : c.answers.filter(function (x) { return !x.correct; })[0];
    var b = a.bases.filter(function (y) { return y.source === 'hunch'; })[0];
    return { answer: a.id, basis: b.id };
  });
  p = F.reflect(CASES, hunchOnly);
  assert.ok(/^You were right twice and knew none of them\. Both were right by luck/.test(p[0]), p[0]);
  assert.ok(/rested on a hunch/.test(p[1]) && !/felt no different/.test(p[1]), p[1]);
  // One lucky answer: singular forms.
  var one = play(function (c) {
    if (c.id === 'clock') return { answer: 'yes', basis: 'clock' };
    var a = c.answers.filter(function (x) { return !x.correct; })[0];
    return { answer: a.id, basis: a.bases[0].id };
  });
  p = F.reflect(CASES, one);
  assert.ok(/^You were right once and did not know it\. It was right by luck: you went on a stopped clock, and the world agreed for reasons it knew nothing about\.$/.test(p[0]), p[0]);
});

if (failures) { console.log('\n' + failures + ' failed, ' + passes + ' passed'); process.exit(1); }
console.log('\nall ' + passes + ' passed');
