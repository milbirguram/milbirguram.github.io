// Animus model: Braitenberg vehicles 2 and 3, and the Guess-the-wiring rounds.
// Works in the browser (window.AnimusModel) and in Node (module.exports).
//
// Coordinates: x to the right, y downwards (canvas convention). Heading th is in
// radians, 0 = east, increasing clockwise on screen. A vehicle's left side is the
// direction th - 90deg.
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- parameters
  var P = {
    W: 800,            // arena width (world units)
    H: 500,            // arena height
    dt: 1 / 60,        // fixed timestep, seconds
    k: 3000,           // light falloff: intensity / (1 + d^2 / k); half strength at d = sqrt(k) ~ 55
    sensorAngle: 0,    // how far each sensor axis is splayed out from the heading (0 = both face forward)
    sensorFwd: 12,     // sensors sit on the nose, 12 units ahead of the axle centre ...
    sensorSide: 8,     // ... and 8 units to each side (about 34 degrees either side of centre)
    axle: 20,          // distance between the wheels
    base: 60,          // motor speed with no light, units per second
    gain: 120,         // weight of one ordinary connection
    vmax: 260,         // motor speed limit; motors never run backwards
    walls: 'wrap'      // the floor wraps round (the only option: there are no walls to bounce off)
  };

  // ---------------------------------------------------------------- PRNG
  // mulberry32: small, fast, good enough, and identical in every JS engine.
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------------------------------------------------------------- wiring
  // A wiring is four weights: ll = left sensor -> left motor, rr = right -> right,
  // lr = left sensor -> right motor, rl = right sensor -> left motor.
  function wiring(ll, rr, lr, rl) { return { ll: ll, rr: rr, lr: lr, rl: rl }; }

  // The four classic vehicles: wires 'straight' | 'crossed', sign +1 | -1.
  function classic(wires, sign, strength) {
    var g = sign * P.gain * (strength == null ? 1 : strength);
    return wires === 'straight' ? wiring(g, g, 0, 0) : wiring(0, 0, g, g);
  }

  // One wire per sensor, chosen independently: each side is {to: 'same'|'opposite', sign}.
  function perSensor(left, right) {
    var w = wiring(0, 0, 0, 0);
    if (left.to === 'same') w.ll += left.sign * P.gain; else w.lr += left.sign * P.gain;
    if (right.to === 'same') w.rr += right.sign * P.gain; else w.rl += right.sign * P.gain;
    return w;
  }

  // Symmetric four-wire vehicle: straight weight s and crossed weight c, in half-gain steps.
  function fourWire(s, c) {
    var u = P.gain / 2;
    return wiring(s * u, s * u, c * u, c * u);
  }

  var CLASSIC_INFO = {
    '2a': { wires: 'straight', sign: 1, name: 'fear', colour: '#2f6690',
      text: 'Each sensor drives its own side. More light, faster. It turns away from light and speeds up near it.' },
    '2b': { wires: 'crossed', sign: 1, name: 'aggression', colour: '#b0343a',
      text: 'Each sensor drives the opposite side. More light, faster. It turns towards light and rams it.' },
    '3a': { wires: 'straight', sign: -1, name: 'love', colour: '#8a3f86',
      text: 'Each sensor drives its own side. More light, slower. It turns towards light and comes to rest facing it.' },
    '3b': { wires: 'crossed', sign: -1, name: 'explorer', colour: '#2b6f50',
      text: 'Each sensor drives the opposite side. More light, slower. It slows near a light, turns away and wanders on.' }
  };
  function classicId(wires, sign) {
    return (sign > 0 ? '2' : '3') + (wires === 'straight' ? 'a' : 'b');
  }

  // ---------------------------------------------------------------- sensing
  function sensorReading(sx, sy, axis, lights) {
    var ax = Math.cos(axis), ay = Math.sin(axis), total = 0;
    for (var i = 0; i < lights.length; i++) {
      var L = lights[i];
      var dx = L.x - sx, dy = L.y - sy;
      // the floor is a torus: use the nearest copy of each light
      dx -= P.W * Math.round(dx / P.W);
      dy -= P.H * Math.round(dy / P.H);
      var d2 = dx * dx + dy * dy;
      var d = Math.sqrt(d2);
      var cosA = d < 1e-9 ? 1 : (dx * ax + dy * ay) / d;
      if (cosA > 0) total += (L.intensity == null ? 1 : L.intensity) / (1 + d2 / P.k) * cosA;
    }
    return total;
  }

  function sensorPositions(x, y, th) {
    var c = Math.cos(th), s = Math.sin(th);
    var f = P.sensorFwd, l = P.sensorSide;
    return {
      lx: x + f * c + l * s, ly: y + f * s - l * c,
      rx: x + f * c - l * s, ry: y + f * s + l * c
    };
  }

  function sense(x, y, th, lights) {
    var p = sensorPositions(x, y, th);
    return {
      left: sensorReading(p.lx, p.ly, th - P.sensorAngle, lights),
      right: sensorReading(p.rx, p.ry, th + P.sensorAngle, lights)
    };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function motors(w, SL, SR) {
    return {
      left: clamp(P.base + w.ll * SL + w.rl * SR, 0, P.vmax),
      right: clamp(P.base + w.rr * SR + w.lr * SL, 0, P.vmax)
    };
  }

  // ---------------------------------------------------------------- vehicle
  // state: {x, y, th, v, w (wiring), jitter, rand}
  function makeVehicle(opts) {
    return {
      x: opts.x, y: opts.y, th: opts.th, v: 0, omega: 0,
      w: opts.wiring,
      jitter: opts.jitter || 0,
      rand: opts.jitter ? rng(opts.seed == null ? 1 : opts.seed) : null
    };
  }

  // Advance one fixed timestep. The floor wraps round: a vehicle that leaves one edge
  // comes back at the opposite one, with its heading unchanged.
  function step(veh, lights) {
    var S = sense(veh.x, veh.y, veh.th, lights);
    var m = motors(veh.w, S.left, S.right);
    var v = (m.left + m.right) / 2;
    var omega = (m.left - m.right) / P.axle; // right wheel faster -> turn left (th decreases)
    var dt = P.dt;
    var mid = veh.th + omega * dt / 2;
    veh.x += v * Math.cos(mid) * dt;
    veh.y += v * Math.sin(mid) * dt;
    veh.th += omega * dt;
    // Optional wheel slip: a small random turn, proportional to how fast it is moving,
    // so a vehicle at rest stays at rest. Seeded, so runs are repeatable.
    if (veh.rand) veh.th += veh.jitter * (v / P.base) * (veh.rand() - 0.5) * 2 * Math.sqrt(dt);
    if (veh.x < 0) veh.x += P.W; else if (veh.x >= P.W) veh.x -= P.W;
    if (veh.y < 0) veh.y += P.H; else if (veh.y >= P.H) veh.y -= P.H;
    // keep th in (-pi, pi] so long runs do not lose precision
    if (veh.th > Math.PI) veh.th -= 2 * Math.PI;
    else if (veh.th <= -Math.PI) veh.th += 2 * Math.PI;
    veh.v = v; veh.omega = omega;
    veh.sl = S.left; veh.sr = S.right;
    return veh;
  }

  // Run one vehicle for a number of steps and record its path.
  function simulate(opts) {
    var veh = makeVehicle(opts);
    var n = opts.steps;
    var xs = new Float64Array(n + 1), ys = new Float64Array(n + 1);
    var ths = new Float64Array(n + 1), vs = new Float64Array(n + 1);
    xs[0] = veh.x; ys[0] = veh.y; ths[0] = veh.th; vs[0] = 0;
    for (var i = 1; i <= n; i++) {
      step(veh, opts.lights);
      xs[i] = veh.x; ys[i] = veh.y; ths[i] = veh.th; vs[i] = veh.v;
    }
    return { xs: xs, ys: ys, ths: ths, vs: vs, steps: n };
  }

  // Mean distance between two paths, sampled ten times per second.
  function pathDistance(a, b) {
    var n = Math.min(a.steps, b.steps), every = 6, sum = 0, count = 0;
    for (var i = 0; i <= n; i += every) {
      var dx = a.xs[i] - b.xs[i], dy = a.ys[i] - b.ys[i];
      dx -= P.W * Math.round(dx / P.W); dy -= P.H * Math.round(dy / P.H);
      sum += Math.sqrt(dx * dx + dy * dy);
      count++;
    }
    return sum / count;
  }

  // Two wirings "behave the same" in an arena when their paths stay, on average,
  // within this many units of each other (the arena is 800 units wide).
  var SAME_THRESHOLD = 12;

  // ---------------------------------------------------------------- guess rounds
  // Guess specs, by mode:
  //   classic: {wires, sign}
  //   sensor:  {left: {to, sign}, right: {to, sign}}
  //   four:    {s, c}  (weights in half-gain steps, -2..2)
  function specWiring(mode, g) {
    if (mode === 'classic') return classic(g.wires, g.sign);
    if (mode === 'sensor') return perSensor(g.left, g.right);
    if (mode === 'four') return fourWire(g.s, g.c);
    throw new Error('unknown mode ' + mode);
  }

  function specKey(mode, g) {
    if (mode === 'classic') return classicId(g.wires, g.sign);
    if (mode === 'sensor') {
      return 'L' + (g.left.to === 'same' ? 'S' : 'X') + (g.left.sign > 0 ? '+' : '-') +
        'R' + (g.right.to === 'same' ? 'S' : 'X') + (g.right.sign > 0 ? '+' : '-');
    }
    return 's' + g.s + 'c' + g.c;
  }

  function candidates(mode) {
    var out = [], tos = ['same', 'opposite'], signs = [1, -1];
    if (mode === 'classic') {
      ['straight', 'crossed'].forEach(function (wires) {
        signs.forEach(function (sign) { out.push({ wires: wires, sign: sign }); });
      });
    } else if (mode === 'sensor') {
      tos.forEach(function (lt) { signs.forEach(function (ls) {
        tos.forEach(function (rt) { signs.forEach(function (rs) {
          out.push({ left: { to: lt, sign: ls }, right: { to: rt, sign: rs } });
        }); });
      }); });
    } else if (mode === 'four') {
      for (var s = -2; s <= 2; s++) for (var c = -2; c <= 2; c++) out.push({ s: s, c: c });
    }
    return out;
  }

  var ROUNDS = [
    {
      id: 'one-light', title: 'One light', mode: 'classic', seconds: 14,
      lights: [{ x: 540, y: 220 }], start: { x: 200, y: 300, th: 0 },
      truth: { wires: 'crossed', sign: 1 }, speedCue: true,
      prompt: 'Watch how it treats the light. Does it turn towards it or away, and does it speed up or slow down as it gets close?'
    },
    {
      id: 'two-lights', title: 'Two lights', mode: 'classic', seconds: 16,
      lights: [{ x: 300, y: 170 }, { x: 560, y: 340 }], start: { x: 140, y: 40, th: 0.785 },
      truth: { wires: 'straight', sign: 1 }, speedCue: true,
      prompt: 'Two lights this time. Look at what happens to its speed near each one.'
    },
    {
      id: 'experiment', title: 'Run an experiment', mode: 'classic', seconds: 24, canMove: true,
      lights: [{ x: 250, y: 140 }, { x: 600, y: 360 }], start: { x: 460, y: 320, th: -2.36 },
      truth: { wires: 'crossed', sign: -1 },
      prompt: 'From now on you can drag the lights while it drives. Put a light where you want to test it. An experiment you choose tells you more than a recording you are handed.'
    },
    {
      id: 'head-on', title: 'Head on', mode: 'classic', seconds: 14, canMove: true, teaches: true,
      lights: [{ x: 560, y: 250 }], start: { x: 110, y: 250, th: 0 },
      truth: { wires: 'straight', sign: -1 },
      prompt: 'The light is dead ahead. Guess from this run first. Then, if you like, drag the light off the line and watch again.',
      lesson: 'With the light exactly ahead, both sensors always read the same. Whether the wires are straight or crossed then makes no difference at all.'
    },
    {
      id: 'mixed', title: 'One plus, one minus', mode: 'sensor', seconds: 22, canMove: true,
      lights: [{ x: 270, y: 170 }, { x: 530, y: 320 }], start: { x: 140, y: 120, th: -0.39 },
      truth: { left: { to: 'opposite', sign: 1 }, right: { to: 'same', sign: -1 } },
      prompt: 'Now each sensor has its own wire, and the two need not match. One excites a wheel, one inhibits a wheel. Which is which, and which wheel does each drive? Its turns carry most of the answer. Its speed hardly changes: the two sensors read almost the same, and one wire adds about what the other takes away.'
    },
    {
      id: 'four-wire', title: 'Four wires', mode: 'four', seconds: 22, canMove: true,
      lights: [{ x: 250, y: 160 }, { x: 590, y: 300 }], start: { x: 700, y: 400, th: 3.14 },
      truth: { s: -1, c: 2 },
      prompt: 'Both straight and crossed wires are connected, each with its own weight. Straight-minus-crossed sets how it turns; straight-plus-crossed sets how it speeds up.'
    }
  ];

  function roundSteps(round) { return Math.round(round.seconds / P.dt); }

  function runSpec(round, spec, lights) {
    return simulate({
      x: round.start.x, y: round.start.y, th: round.start.th,
      wiring: specWiring(round.mode, spec),
      lights: lights || round.lights,
      steps: roundSteps(round)
    });
  }

  // Every candidate whose path in this round's arena stays within SAME_THRESHOLD of the truth.
  function equivalenceClass(round) {
    var truthPath = runSpec(round, round.truth);
    return candidates(round.mode).filter(function (c) {
      return pathDistance(truthPath, runSpec(round, c)) < SAME_THRESHOLD;
    }).map(function (c) { return specKey(round.mode, c); });
  }

  // How a wiring steers and how it speeds up, as coefficients on the two sensor readings.
  // turn rate = (left wheel - right wheel) / axle; speed = (left wheel + right wheel) / 2.
  function laws(w) {
    return {
      turnL: (w.ll - w.lr) / P.axle, turnR: (w.rl - w.rr) / P.axle,
      speedL: (w.ll + w.lr) / 2, speedR: (w.rl + w.rr) / 2
    };
  }
  // True when two specs turn by exactly the same law (they may still differ in speed).
  function sameTurning(mode, a, b) {
    var x = laws(specWiring(mode, a)), y = laws(specWiring(mode, b));
    return Math.abs(x.turnL - y.turnL) < 1e-9 && Math.abs(x.turnR - y.turnR) < 1e-9;
  }
  // Largest change of speed from the cruising speed over a path, as a fraction of it
  // (the first half second, while it gets going, is skipped).
  function speedSwing(path) {
    var m = 0;
    for (var i = Math.round(0.5 / P.dt); i <= path.steps; i++) m = Math.max(m, Math.abs(path.vs[i] - P.base));
    return m / P.base;
  }

  // How far below and above the cruising speed a path went, as fractions of it.
  function speedRange(path) {
    var lo = 0, hi = 0;
    for (var i = Math.round(0.5 / P.dt); i <= path.steps; i++) {
      var d = path.vs[i] - P.base;
      if (d < lo) lo = d; if (d > hi) hi = d;
    }
    return { below: -lo / P.base, above: hi / P.base };
  }

  // Score a guess: exact, same-here (indistinguishable in this arena), or wrong.
  function scoreGuess(round, guess) {
    var truthPath = runSpec(round, round.truth);
    var guessPath = runSpec(round, guess);
    var distance = pathDistance(truthPath, guessPath);
    var exact = specKey(round.mode, guess) === specKey(round.mode, round.truth);
    return {
      exact: exact,
      accepted: exact || distance < SAME_THRESHOLD,
      sameHere: !exact && distance < SAME_THRESHOLD,
      distance: distance,
      truthPath: truthPath,
      guessPath: guessPath
    };
  }

  // ---------------------------------------------------------------- standard arenas for tests and the preview
  function randomArena(seed, nLights) {
    var r = rng(seed), lights = [];
    for (var i = 0; i < nLights; i++) {
      lights.push({ x: 120 + r() * (P.W - 240), y: 90 + r() * (P.H - 180) });
    }
    return {
      lights: lights,
      start: { x: 60 + r() * (P.W - 120), y: 60 + r() * (P.H - 120), th: r() * 2 * Math.PI - Math.PI }
    };
  }

  // ---------------------------------------------------------------- workshop and preview scenes
  // Starts for the default workshop and the card preview were chosen by a grid search
  // (every 30 units, every 15 degrees) for poses where each vehicle shows its character
  // early: 2b rams a light by about 5 s, 2a swerves away without touching one, 3a comes
  // to rest, and 3b slows near one light, turns off and slows again at the other.
  // The tests re-check each of these, so a change to the model cannot quietly break them.
  var WORKSHOP_SLIP = 0.5; // seeded random wheel slip for workshop and preview vehicles
  var SCENES = {
    workshop: {
      lights: [{ x: 290, y: 200 }, { x: 540, y: 320 }],
      cars: [
        { type: '2a', x: 550, y: 150, th: 1.833, seed: 11 },
        { type: '2b', x: 640, y: 90, th: -2.356, seed: 12 },
        { type: '3a', x: 610, y: 480, th: -1.047, seed: 13 },
        { type: '3b', x: 130, y: 330, th: -0.524, seed: 14 }
      ],
      stillSeconds: 10 // the still shown when motion is reduced
    },
    preview: {
      lights: [{ x: 300, y: 215 }, { x: 520, y: 300 }],
      cars: [
        { type: '2b', x: 80, y: 350, th: -0.39, seed: 21 },
        { type: '3a', x: 680, y: 430, th: -1.18, seed: 22 },
        { type: '3b', x: 200, y: 430, th: -0.39, seed: 23 },
        { type: '2a', x: 600, y: 30, th: 2.36, seed: 24 }
      ],
      stillSeconds: 8
    }
  };

  // Where a newly released vehicle starts: 120-170 units from a light, heading roughly
  // towards it (about 11 to 29 degrees off), so that it meets a light within a few seconds.
  // A vehicle aimed straight at a light would not show which way it turns.
  function spawnPose(r, lights) {
    for (var t = 0; t < 60; t++) {
      var L = lights[Math.floor(r() * lights.length)];
      var d = 120 + r() * 50, a = r() * 2 * Math.PI;
      var x = L.x + d * Math.cos(a), y = L.y + d * Math.sin(a);
      if (x < 30 || x > P.W - 30 || y < 30 || y > P.H - 30) continue;
      var tooClose = false;
      for (var i = 0; i < lights.length; i++) {
        if (Math.hypot(lights[i].x - x, lights[i].y - y) < 100) tooClose = true;
      }
      if (tooClose) continue;
      var off = (0.2 + r() * 0.3) * (r() < 0.5 ? -1 : 1);
      var th = Math.atan2(L.y - y, L.x - x) + off;
      return { x: x, y: y, th: Math.atan2(Math.sin(th), Math.cos(th)) };
    }
    return { x: 40 + r() * (P.W - 80), y: 40 + r() * (P.H - 80), th: r() * 2 * Math.PI - Math.PI };
  }

  // Eight fixed arenas, unrelated to any round, used to ask whether two wirings are
  // "clearly different" in general: their paths drift apart by more than three times
  // the sameness threshold in at least one of them.
  var PROBES = (function () {
    var out = [];
    for (var s = 101; s <= 108; s++) out.push(randomArena(s, 2 + (s % 2)));
    return out;
  })();
  var CLEARLY_DIFFERENT = 3 * SAME_THRESHOLD;

  function generalDistance(mode, a, b) {
    var worst = 0;
    PROBES.forEach(function (A) {
      var r = { mode: mode, seconds: 25, lights: A.lights, start: A.start };
      worst = Math.max(worst, pathDistance(runSpec(r, a), runSpec(r, b)));
    });
    return worst;
  }
  function clearlyDifferent(mode, a, b) { return generalDistance(mode, a, b) > CLEARLY_DIFFERENT; }

  // Plain-language description of a guess spec.
  function describe(mode, g) {
    var sign = function (x) { return x > 0 ? '+' : '−'; };
    if (mode === 'classic') {
      var id = classicId(g.wires, g.sign), info = CLASSIC_INFO[id];
      return id + ' (' + info.name + '): ' + g.wires + ', ' + (g.sign > 0 ? 'excitatory +' : 'inhibitory −');
    }
    if (mode === 'sensor') {
      var side = function (name, x) {
        var own = name === 'left' ? 'left' : 'right', other = name === 'left' ? 'right' : 'left';
        return name + ' sensor ' + sign(x.sign) + ' to the ' + (x.to === 'same' ? own : other) + ' wheel';
      };
      return side('left', g.left) + ', ' + side('right', g.right);
    }
    var wt = function (x) {
      if (x === 0) return '0';
      var mag = Math.abs(x) === 1 ? '½' : '1';
      return sign(x) + mag;
    };
    return 'straight ' + wt(g.s) + ', crossed ' + wt(g.c);
  }

  var api = {
    P: P, rng: rng, wiring: wiring, classic: classic, perSensor: perSensor, fourWire: fourWire,
    CLASSIC_INFO: CLASSIC_INFO, classicId: classicId,
    sense: sense, sensorPositions: sensorPositions, motors: motors,
    makeVehicle: makeVehicle, step: step, simulate: simulate, pathDistance: pathDistance,
    SAME_THRESHOLD: SAME_THRESHOLD,
    ROUNDS: ROUNDS, candidates: candidates, specWiring: specWiring, specKey: specKey,
    roundSteps: roundSteps, runSpec: runSpec, equivalenceClass: equivalenceClass, scoreGuess: scoreGuess,
    randomArena: randomArena, PROBES: PROBES, CLEARLY_DIFFERENT: CLEARLY_DIFFERENT,
    generalDistance: generalDistance, clearlyDifferent: clearlyDifferent, describe: describe,
    laws: laws, sameTurning: sameTurning, speedSwing: speedSwing, speedRange: speedRange,
    WORKSHOP_SLIP: WORKSHOP_SLIP, SCENES: SCENES, spawnPose: spawnPose
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AnimusModel = api;
})(typeof window !== 'undefined' ? window : this);
