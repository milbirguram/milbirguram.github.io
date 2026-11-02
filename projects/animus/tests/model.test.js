// Headless checks for the Animus model. Run: node projects/animus/tests/model.test.js
// Exits non-zero on the first failed assertion.
'use strict';
var assert = require('assert');
var path = require('path');
var M = require(path.join(__dirname, '..', 'model.js'));
var P = M.P;

var passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('ok   ' + name); }
  catch (e) { console.error('FAIL ' + name + '\n     ' + e.message); process.exitCode = 1; }
}

function torusDist(x, y, L) {
  var dx = x - L.x, dy = y - L.y;
  dx -= P.W * Math.round(dx / P.W); dy -= P.H * Math.round(dy / P.H);
  return Math.sqrt(dx * dx + dy * dy);
}
var WORKSHOP_SLIP = M.WORKSHOP_SLIP; // the wheel slip the workshop uses (app.js reads the same value)

function run(type, arena, seconds, slip, seed) {
  var info = M.CLASSIC_INFO[type];
  return M.simulate({
    x: arena.start.x, y: arena.start.y, th: arena.start.th,
    wiring: M.classic(info.wires, info.sign), lights: arena.lights,
    steps: Math.round(seconds / P.dt), jitter: slip || 0, seed: seed || 1
  });
}

// ------------------------------------------------------------- the model as specified
check('sensor reading follows intensity/(1+d^2/k) x max(0, cos)', function () {
  // A vehicle at the origin facing east; one light 100 units straight ahead of the left sensor.
  var veh = { x: 200, y: 200, th: 0 };
  var sp = M.sensorPositions(veh.x, veh.y, veh.th);
  var light = { x: sp.lx + 100, y: sp.ly };
  var s = M.sense(veh.x, veh.y, veh.th, [light]);
  var expectLeft = 1 / (1 + 100 * 100 / P.k) * Math.cos(P.sensorAngle);
  assert(Math.abs(s.left - expectLeft) < 1e-12, 'left ' + s.left + ' vs ' + expectLeft);
  // A light directly behind is invisible to both forward-facing sensors.
  var behind = M.sense(veh.x, veh.y, veh.th, [{ x: 100, y: 200 }]);
  assert.strictEqual(behind.left, 0); assert.strictEqual(behind.right, 0);
});

check('motors are clamped to [0, vmax] and inhibition never reverses a wheel', function () {
  var w = M.classic('straight', -1);
  var m = M.motors(w, 50, 50);
  assert.strictEqual(m.left, 0); assert.strictEqual(m.right, 0);
  var e = M.motors(M.classic('crossed', 1), 50, 50);
  assert.strictEqual(e.left, P.vmax);
});

// ------------------------------------------------------------- (a) classic signatures
// The standard arena: one light, a vehicle starting off to its left, angled past it.
var ONE = { lights: [{ x: 500, y: 250 }], start: { x: 170, y: 330, th: -0.12 } };
var THREE = { lights: [{ x: 210, y: 150 }, { x: 600, y: 140 }, { x: 420, y: 380 }], start: { x: 90, y: 440, th: -0.4 } };

check('(a) 2b aggression: reaches within 15 units of the light', function () {
  var p = run('2b', ONE, 20);
  var min = Infinity;
  for (var i = 0; i <= p.steps; i++) min = Math.min(min, torusDist(p.xs[i], p.ys[i], ONE.lights[0]));
  assert(min < 15, 'closest approach ' + min.toFixed(1));
});

check('(a) 2a fear: after its closest approach it moves away, and faster near the light', function () {
  var p = run('2a', ONE, 20);
  var L = ONE.lights[0], min = Infinity, at = 0, vNear = 0;
  for (var i = 0; i <= p.steps; i++) {
    var d = torusDist(p.xs[i], p.ys[i], L);
    if (d < min) { min = d; at = i; }
    if (d < 150) vNear = Math.max(vNear, p.vs[i]);
  }
  // Look at the 4 s after the closest approach: distance grows by a clear margin.
  var later = torusDist(p.xs[at + 240], p.ys[at + 240], L);
  assert(later > min + 120, 'closest ' + min.toFixed(0) + ', 4 s later ' + later.toFixed(0));
  assert(vNear > P.base * 1.15, 'top speed within 150 units of the light ' + vNear.toFixed(1));
  assert(min > 20, 'it should not ram the light; closest ' + min.toFixed(1));
});

check('(a) 3a love: ends near the light, almost stopped, facing it', function () {
  var p = run('3a', ONE, 30), n = p.steps, L = ONE.lights[0];
  var d = torusDist(p.xs[n], p.ys[n], L);
  assert(d < 90, 'final distance ' + d.toFixed(1));
  assert(p.vs[n] < 1, 'final speed ' + p.vs[n].toFixed(2));
  var bearing = Math.atan2(L.y - p.ys[n], L.x - p.xs[n]);
  var off = Math.abs(Math.atan2(Math.sin(bearing - p.ths[n]), Math.cos(bearing - p.ths[n])));
  assert(off < 0.35, 'facing error ' + off.toFixed(2) + ' rad');
});

check('(a) 3b explorer: slows near lights and visits more than one over time', function () {
  var p = run('3b', THREE, 90, WORKSHOP_SLIP, 7);
  var visited = {}, slowedNear = false;
  for (var i = 120; i <= p.steps; i += 3) {
    THREE.lights.forEach(function (L, j) {
      var d = torusDist(p.xs[i], p.ys[i], L);
      if (d < 110) { visited[j] = true; if (p.vs[i] < 0.6 * P.base) slowedNear = true; }
    });
  }
  assert(Object.keys(visited).length > 1, 'visited ' + Object.keys(visited).length);
  assert(slowedNear, 'it never slowed near a light');
  // It never comes to rest for long: mean speed over the last 30 s stays well above zero.
  var sum = 0, n = 0;
  for (var k = p.steps - 1800; k <= p.steps; k++) { sum += p.vs[k]; n++; }
  assert(sum / n > 0.4 * P.base, 'mean late speed ' + (sum / n).toFixed(1));
});

check('(a) signatures hold across 30 seeded random arenas (at least 80% each)', function () {
  var tally = { '2a': 0, '2b': 0, '3a': 0, '3b': 0 }, N = 30;
  for (var seed = 1; seed <= N; seed++) {
    var A = M.randomArena(seed, 2 + (seed % 2));
    var p = run('2b', A, 40, WORKSHOP_SLIP, seed), min = Infinity, i;
    for (i = 0; i <= p.steps; i++) A.lights.forEach(function (L) { min = Math.min(min, torusDist(p.xs[i], p.ys[i], L)); });
    if (min < 15) tally['2b']++;

    p = run('3a', A, 40, WORKSHOP_SLIP, seed);
    var fd = Math.min.apply(null, A.lights.map(function (L) { return torusDist(p.xs[p.steps], p.ys[p.steps], L); }));
    if (fd < 90 && p.vs[p.steps] < 2) tally['3a']++;

    // 2a: whenever it gets within 110 of a light, 3 s later it is farther away.
    p = run('2a', A, 40, WORKSHOP_SLIP, seed);
    var fled = true;
    for (i = 0; i + 180 <= p.steps; i += 6) {
      for (var j = 0; j < A.lights.length; j++) {
        var d0 = torusDist(p.xs[i], p.ys[i], A.lights[j]);
        if (d0 < 110 && torusDist(p.xs[i + 180], p.ys[i + 180], A.lights[j]) <= d0) fled = false;
      }
    }
    if (fled) tally['2a']++;

    p = run('3b', A, 90, WORKSHOP_SLIP, seed);
    var seen = {};
    for (i = 120; i <= p.steps; i += 3) A.lights.forEach(function (L, j) { if (torusDist(p.xs[i], p.ys[i], L) < 110) seen[j] = 1; });
    if (Object.keys(seen).length > 1) tally['3b']++;
  }
  Object.keys(tally).forEach(function (t) {
    assert(tally[t] >= 0.8 * N, t + ' held in ' + tally[t] + ' of ' + N);
  });
  console.log('     tallies of 30: ' + JSON.stringify(tally));
});

check('explorer: how much its wandering owes to the wheel slip (reported, both figures)', function () {
  // Same criterion as above: more than one light within 110 units over 90 s.
  function tally(slip, from, to) {
    var n = 0;
    for (var seed = from; seed <= to; seed++) {
      var A = M.randomArena(seed, 2 + (seed % 2)), p = run('3b', A, 90, slip, seed), seen = {};
      for (var i = 120; i <= p.steps; i += 3) A.lights.forEach(function (L, j) { if (torusDist(p.xs[i], p.ys[i], L) < 110) seen[j] = 1; });
      if (Object.keys(seen).length > 1) n++;
    }
    return n;
  }
  var withSlip = tally(WORKSHOP_SLIP, 1, 30), noSlip = tally(0, 1, 30);
  console.log('     3b reaches a second light: ' + withSlip + ' of 30 with slip, ' + noSlip + ' of 30 without');
  assert(withSlip > noSlip, 'the page says the slip helps the explorer; here it did not');
  assert(noSlip < 0.8 * 30, 'the page says that without slip the explorer often fails; update the text');
});

// ------------------------------------------------------------- the default workshop, its still, and the preview
function sceneRun(scene, c, seconds) {
  var info = M.CLASSIC_INFO[c.type];
  return M.simulate({ x: c.x, y: c.y, th: c.th, wiring: M.classic(info.wires, info.sign), lights: scene.lights,
    steps: Math.round(seconds / P.dt), jitter: WORKSHOP_SLIP, seed: c.seed });
}
function nearest(p, i, lights) {
  var best = { d: Infinity, j: -1 };
  lights.forEach(function (L, j) { var d = torusDist(p.xs[i], p.ys[i], L); if (d < best.d) best = { d: d, j: j }; });
  return best;
}
// Each classic vehicle's character, checked over the first `by` seconds of a run.
var SHOWS = {
  '2b': function (p, lights, by) { // rams a light
    for (var i = 0; i <= by / P.dt; i++) if (nearest(p, i, lights).d < 15) return true;
    return 'never within 15 units of a light';
  },
  '2a': function (p, lights, by) { // comes near a light, swerves away, never touches one
    var min = Infinity;
    for (var i = 0; i <= by / P.dt; i++) min = Math.min(min, nearest(p, i, lights).d);
    if (min > 120) return 'never came within 120 units of a light';
    if (min < 30) return 'came within ' + min.toFixed(0) + ' units of a light';
    var now = nearest(p, Math.round(by / P.dt), lights).d;
    return now > min + 60 ? true : 'not moving away at the end (closest ' + min.toFixed(0) + ', now ' + now.toFixed(0) + ')';
  },
  '3a': function (p, lights, by) { // at rest near a light
    var i = Math.round(by / P.dt);
    return nearest(p, i, lights).d < 90 && p.vs[i] < 3 ? true : 'not at rest near a light';
  },
  '3b': function (p, lights, by, needTwo) { // slows near a light and moves on (to another, if needTwo)
    var slowed = {};
    for (var i = 30; i <= by / P.dt; i++) {
      var n = nearest(p, i, lights);
      if (n.d < 110 && p.vs[i] < 0.6 * P.base) slowed[n.j] = true;
    }
    var k = Object.keys(slowed).length;
    if (k < (needTwo ? 2 : 1)) return 'slowed near ' + k + ' light(s)';
    return p.vs[Math.round(by / P.dt)] > 3 ? true : 'it stopped';
  }
};

check('default workshop: within 12 s each vehicle shows its character', function () {
  var S = M.SCENES.workshop;
  S.cars.forEach(function (c) {
    var r = SHOWS[c.type](sceneRun(S, c, 12), S.lights, 12, true);
    assert(r === true, c.type + ': ' + r);
  });
});

check('default workshop: fear never rams a light in its first three minutes', function () {
  var S = M.SCENES.workshop, c = S.cars.filter(function (x) { return x.type === '2a'; })[0];
  var p = sceneRun(S, c, 180), min = Infinity;
  for (var i = 0; i <= p.steps; i++) min = Math.min(min, nearest(p, i, S.lights).d);
  assert(min > 30, 'closest approach ' + min.toFixed(1));
});

check('reduced-motion still (workshop) already shows every character', function () {
  var S = M.SCENES.workshop;
  S.cars.forEach(function (c) {
    var r = SHOWS[c.type](sceneRun(S, c, S.stillSeconds), S.lights, S.stillSeconds, true);
    assert(r === true, c.type + ' at ' + S.stillSeconds + ' s: ' + r);
  });
});

check('preview still shows every character', function () {
  var S = M.SCENES.preview;
  S.cars.forEach(function (c) {
    var r = SHOWS[c.type](sceneRun(S, c, S.stillSeconds), S.lights, S.stillSeconds, false);
    assert(r === true, c.type + ' at ' + S.stillSeconds + ' s: ' + r);
  });
});

check('released vehicles usually show their character within 15-20 s (reported)', function () {
  var rates = {}, N = 200;
  ['2a', '2b', '3a', '3b'].forEach(function (t) {
    var r = M.rng(7), ok = 0;
    for (var k = 0; k < N; k++) {
      // half in the default arena, half in random arenas of two or three lights
      var lights = k % 2 ? M.SCENES.workshop.lights : M.randomArena(500 + k, 2 + (k % 4 === 0 ? 1 : 0)).lights;
      var pose = M.spawnPose(r, lights);
      var p = sceneRun({ lights: lights }, { type: t, x: pose.x, y: pose.y, th: pose.th, seed: 1000 + k }, 20);
      var res = false, i;
      if (t === '2b') { // passes through a light (within 25 units) within 15 s
        for (i = 0; i <= 15 / P.dt; i++) if (nearest(p, i, lights).d < 25) { res = true; break; }
      } else if (t === '3b') { // slows near a light, then leaves it (over 160 units away and moving), within 20 s
        for (i = 0; i <= p.steps; i++) {
          var n = nearest(p, i, lights);
          if (n.d < 110 && p.vs[i] < 0.6 * P.base) {
            for (var b = i; b <= p.steps; b++) if (torusDist(p.xs[b], p.ys[b], lights[n.j]) > 160 && p.vs[b] > 20) { res = true; break; }
            break;
          }
        }
      } else if (t === '3a') { // at rest near a light by 20 s
        res = SHOWS['3a'](p, lights, 20) === true;
      } else { // 2a: within 15 s comes within 120, never within 30, and is moving away at 15 s
        res = SHOWS['2a'](p, lights, 15) === true;
      }
      if (res) ok++;
    }
    rates[t] = ok;
  });
  console.log('     of ' + N + ' releases: ' + JSON.stringify(rates));
  assert(rates['2a'] >= 0.7 * N && rates['2b'] >= 0.7 * N && rates['3a'] >= 0.85 * N && rates['3b'] >= 0.5 * N,
    'release rates fell: ' + JSON.stringify(rates));
});

// ------------------------------------------------------------- (b) every Guess round is identifiable
check('(b) six rounds, candidate sets never shrink', function () {
  assert.strictEqual(M.ROUNDS.length, 6);
  var prev = 0;
  M.ROUNDS.forEach(function (R) {
    var n = M.candidates(R.mode).length;
    assert(n >= prev, R.id + ' has fewer candidates than the round before');
    prev = n;
  });
  assert(M.ROUNDS.some(function (R) { return R.canMove; }), 'some round lets the visitor move a light');
  assert(!M.ROUNDS[0].canMove && !M.ROUNDS[1].canMove, 'the first two rounds are observation only');
});

M.ROUNDS.forEach(function (R, idx) {
  check('(b) round ' + (idx + 1) + ' "' + R.title + '": scoring accepts exactly the equivalence class', function () {
    var eq = M.equivalenceClass(R);
    var truthKey = M.specKey(R.mode, R.truth);
    assert(eq.indexOf(truthKey) >= 0, 'truth not in its own class');
    var clearlyDifferentMembers = [];
    M.candidates(R.mode).forEach(function (c) {
      var key = M.specKey(R.mode, c);
      var s = M.scoreGuess(R, c);
      assert.strictEqual(s.accepted, eq.indexOf(key) >= 0, key + ': accepted=' + s.accepted + ' but in class=' + (eq.indexOf(key) >= 0));
      assert.strictEqual(s.exact, key === truthKey);
      if (s.accepted && key !== truthKey && M.clearlyDifferent(R.mode, R.truth, c)) clearlyDifferentMembers.push(key);
    });
    if (R.teaches) {
      assert(clearlyDifferentMembers.length > 0, 'a teaching round must really contain a clearly different twin');
      assert(R.lesson, 'a teaching round must say what it teaches');
    } else {
      assert.deepStrictEqual(clearlyDifferentMembers, [], 'round accepts clearly different wirings: ' + clearlyDifferentMembers.join(', '));
    }
    console.log('     class: ' + eq.join(', '));
  });
});

check('(b) separation margin: every rejected candidate is well beyond the threshold', function () {
  M.ROUNDS.forEach(function (R) {
    var truth = M.runSpec(R, R.truth);
    M.candidates(R.mode).forEach(function (c) {
      var d = M.pathDistance(truth, M.runSpec(R, c));
      assert(d < M.SAME_THRESHOLD / 2 || d > M.SAME_THRESHOLD * 2,
        R.id + ' ' + M.specKey(R.mode, c) + ' sits near the threshold: ' + d.toFixed(1));
    });
  });
});

check('rounds: a hidden fear vehicle never charges into a light', function () {
  M.ROUNDS.forEach(function (R) {
    if (R.mode !== 'classic' || M.specKey(R.mode, R.truth) !== '2a') return;
    var p = M.runSpec(R, R.truth), min = Infinity;
    for (var i = 0; i <= p.steps; i++) R.lights.forEach(function (L) { min = Math.min(min, torusDist(p.xs[i], p.ys[i], L)); });
    assert(min > 20, R.id + ': hidden 2a comes within ' + min.toFixed(1) + ' units of a light');
  });
});

check('rounds: a prompt points at speed only when the speed visibly changes', function () {
  M.ROUNDS.forEach(function (R) {
    var swing = M.speedSwing(M.runSpec(R, R.truth));
    if (R.speedCue) assert(swing > 0.25, R.id + ' asks about speed, but it changes by only ' + Math.round(swing * 100) + '%');
    else assert(!/watch its speed|what happens to its speed|speed up or slow down/i.test(R.prompt), R.id + ' points at speed without speedCue');
  });
});

check('round 5: every wiring that turns exactly like the truth is rejected, and differs from it in speed', function () {
  var R = M.ROUNDS.filter(function (r) { return r.id === 'mixed'; })[0];
  var truthKey = M.specKey(R.mode, R.truth), truthSwing = M.speedSwing(M.runSpec(R, R.truth));
  var twins = M.candidates(R.mode).filter(function (c) {
    return M.specKey(R.mode, c) !== truthKey && M.sameTurning(R.mode, c, R.truth);
  });
  assert(twins.length > 0, 'expected same-turning twins (the mirror wiring at least)');
  var mirror = twins.filter(function (c) { return c.left.sign !== c.right.sign; });
  assert.strictEqual(mirror.length, 1, 'expected exactly one mixed same-turning twin');
  twins.forEach(function (c) {
    assert(!M.scoreGuess(R, c).accepted, M.specKey(R.mode, c) + ' turns like the truth and is accepted');
  });
  console.log('     round 5 same-turning twins: ' + twins.map(function (c) { return M.specKey(R.mode, c); }).join(', ') +
    '; hidden speed changes by at most ' + Math.round(truthSwing * 100) + '%');
  assert(truthSwing < 0.25, 'the prompt says its speed hardly changes');
});

// ------------------------------------------------------------- (c) determinism
check('(c) same seed gives an identical trajectory; a different seed does not', function () {
  var A = M.randomArena(42, 3);
  var a = run('3b', A, 30, WORKSHOP_SLIP, 99);
  var b = run('3b', A, 30, WORKSHOP_SLIP, 99);
  var c = run('3b', A, 30, WORKSHOP_SLIP, 100);
  for (var i = 0; i <= a.steps; i++) {
    assert(a.xs[i] === b.xs[i] && a.ys[i] === b.ys[i] && a.ths[i] === b.ths[i], 'diverged at step ' + i);
  }
  var differs = false;
  for (var j = 0; j <= a.steps; j++) if (a.xs[j] !== c.xs[j]) { differs = true; break; }
  assert(differs, 'a different seed should give a different run');
  assert.deepStrictEqual(M.randomArena(5, 3), M.randomArena(5, 3));
});

check('(c) round replays are identical every time', function () {
  M.ROUNDS.forEach(function (R) {
    var a = M.runSpec(R, R.truth), b = M.runSpec(R, R.truth);
    assert.strictEqual(M.pathDistance(a, b), 0, R.id);
  });
});

console.log('\n' + passed + ' checks passed' + (process.exitCode ? ', some FAILED' : ''));
