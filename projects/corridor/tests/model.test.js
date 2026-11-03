// Headless checks for the Corridor raycaster and game. Run: node projects/corridor/tests/model.test.js
// Every random check is seeded, so a run is reproducible. Exits non-zero if any check fails.
'use strict';
var assert = require('assert');
var path = require('path');
var C = require(path.join(__dirname, '..', 'model.js'));

var passed = 0, failed = 0;
function check(name, fn) {
  var t = Date.now();
  try { var note = fn(); passed++; console.log('ok   ' + name + (note ? '  (' + note + ')' : '') + '  ' + (Date.now() - t) + ' ms'); }
  catch (e) { failed++; console.error('FAIL ' + name + '\n     ' + (e && e.stack || e)); process.exitCode = 1; }
}

function openTiles(map) {
  var out = [];
  for (var y = 0; y < map.h; y++) for (var x = 0; x < map.w; x++) if (map.cells[y * map.w + x] === C.EMPTY) out.push([x, y]);
  return out;
}

// The reference: walk along the ray in tiny fixed steps until the point is inside a wall, then
// bisect between the last open point and the first wall point. No grid logic at all.
function march(map, px, py, ux, uy, step) {
  var prev = 0, s = step;
  for (; s < 200; s += step) if (C.isWallAt(map, px + ux * s, py + uy * s)) break;
  var lo = s - step, hi = s;
  for (var i = 0; i < 40; i++) {
    var mid = (lo + hi) / 2;
    if (C.isWallAt(map, px + ux * mid, py + uy * mid)) hi = mid; else lo = mid;
  }
  return hi;
}
// How close is (x, y) to the nearest tile corner?
function cornerDist(x, y) {
  var dx = Math.abs(x - Math.round(x)), dy = Math.abs(y - Math.round(y));
  return Math.hypot(dx, dy);
}

// ------------------------------------------------------------------ (a) DDA against a brute-force march
check('(a) DDA hit distances match a fine-step ray march across 5000 random rays', function () {
  var R = C.rng(42), STEP = 0.002, TOL = 1e-6, n = 0, exact = 0, cornerCuts = 0, worst = 0;
  var maps = [C.generateLevel(C.DEFAULT_SEED).map, C.generateLevel(7).map, C.generateLevel(99).map, C.previewSet().map];
  for (var mi = 0; mi < maps.length; mi++) {
    var m = maps[mi], open = openTiles(m);
    for (var k = 0; k < 1250; k++) {
      var tile = open[Math.floor(R() * open.length)];
      var px = tile[0] + 0.02 + R() * 0.96, py = tile[1] + 0.02 + R() * 0.96;
      var a = R() * Math.PI * 2, ux = Math.cos(a), uy = Math.sin(a);
      var dda = C.castRay(m, px, py, ux, uy).t;
      var ref = march(m, px, py, ux, uy, STEP);
      var err = Math.abs(dda - ref);
      n++;
      if (err <= TOL) { exact++; worst = Math.max(worst, err); continue; }
      // The march can only ever be late, by stepping over a sliver of wall corner thinner than its
      // step. In that case the DDA hit must be earlier and right at a tile corner.
      var hx = px + ux * dda, hy = py + uy * dda;
      assert(dda < ref, 'DDA later than the march: dda ' + dda + ' march ' + ref);
      assert(cornerDist(hx, hy) < STEP * 2, 'mismatch away from a corner: dda ' + dda + ' march ' + ref + ' at ' + hx + ',' + hy);
      cornerCuts++;
    }
  }
  assert(exact / n > 0.99, 'too few exact matches: ' + exact + '/' + n);
  return exact + '/' + n + ' agree to 1e-6 (worst ' + worst.toExponential(1) + '); ' + cornerCuts + ' corner grazes the march stepped over';
});

// The exact reference: treat every wall tile as a closed unit box and intersect the ray with each
// box by the slab method. The first entry over all boxes is where the ray meets a wall. No grid walk.
function slab(map, px, py, rdx, rdy) {
  var best = Infinity;
  for (var y = 0; y < map.h; y++) for (var x = 0; x < map.w; x++) {
    if (map.cells[y * map.w + x] === C.EMPTY) continue;
    var t0 = -Infinity, t1 = Infinity, ok = true;
    [[px, rdx, x], [py, rdy, y]].forEach(function (a) {
      if (!ok) return;
      if (a[1] === 0) { if (a[0] < a[2] || a[0] > a[2] + 1) ok = false; return; }
      var ta = (a[2] - a[0]) / a[1], tb = (a[2] + 1 - a[0]) / a[1];
      t0 = Math.max(t0, Math.min(ta, tb)); t1 = Math.min(t1, Math.max(ta, tb));
    });
    if (ok && t0 <= t1 && t1 >= 0 && t0 < best) best = Math.max(0, t0);
  }
  return best;
}
check('(a) DDA hit distances equal an exact ray-box intersection on 10,000 rays, with no exceptions', function () {
  var R = C.rng(77), n = 0, worst = 0;
  var maps = [C.generateLevel(C.DEFAULT_SEED).map, C.generateLevel(7).map, C.generateLevel(99).map, C.generateLevel(500).map, C.previewSet().map];
  var AXES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  maps.forEach(function (m) {
    var open = openTiles(m);
    for (var k = 0; k < 2000; k++) {
      var tile = open[Math.floor(R() * open.length)];
      var px = tile[0] + 0.01 + R() * 0.98, py = tile[1] + 0.01 + R() * 0.98, rdx, rdy;
      if (k % 10 === 0) { var ax = AXES[k / 10 % 4]; rdx = ax[0]; rdy = ax[1]; }   // exactly axis-aligned
      else { var a = R() * Math.PI * 2, len = 0.3 + R() * 2; rdx = Math.cos(a) * len; rdy = Math.sin(a) * len; }   // any length
      var dda = C.castRay(m, px, py, rdx, rdy).t, ref = slab(m, px, py, rdx, rdy);
      var err = Math.abs(dda - ref);
      assert(err < 1e-9, 'ray from ' + px + ',' + py + ' dir ' + rdx + ',' + rdy + ': dda ' + dda + ' exact ' + ref);
      worst = Math.max(worst, err); n++;
    }
  });
  return n + ' rays, worst difference ' + worst.toExponential(1);
});

check('(a) the DDA visits tiles in order and its texture coordinate lies on the struck face', function () {
  var m = C.generateLevel(C.DEFAULT_SEED).map, R = C.rng(5), open = openTiles(m);
  for (var k = 0; k < 2000; k++) {
    var tile = open[Math.floor(R() * open.length)], px = tile[0] + 0.1 + 0.8 * R(), py = tile[1] + 0.1 + 0.8 * R();
    var a = R() * Math.PI * 2, h = C.castRay(m, px, py, Math.cos(a), Math.sin(a));
    assert(h.u >= 0 && h.u <= 1);
    assert(C.tileAt(m, h.mapX, h.mapY) !== C.EMPTY);
    // The hit point lies on the boundary of the struck tile.
    if (h.side === 0) assert(Math.abs(h.hitX - Math.round(h.hitX)) < 1e-9 && (Math.round(h.hitX) === h.mapX || Math.round(h.hitX) === h.mapX + 1));
    else assert(Math.abs(h.hitY - Math.round(h.hitY)) < 1e-9 && (Math.round(h.hitY) === h.mapY || Math.round(h.hitY) === h.mapY + 1));
  }
});

// ------------------------------------------------------------------ (b) fish-eye correction
function facingWall(fov) {
  // A 40-wide open room; the camera stands 3 tiles from the north wall and looks straight at it.
  var rows = [], W = 41, H = 12;
  for (var y = 0; y < H; y++) {
    var s = '';
    for (var x = 0; x < W; x++) s += (x === 0 || y === 0 || x === W - 1 || y === H - 1) ? '1' : '.';
    rows.push(s);
  }
  var m = C.mapFromRows(rows), cam = C.makeCamera(20.5, 4, -Math.PI / 2, fov);
  return { m: m, cam: cam };
}
check('(b) correction on: a flat wall faced straight on has the same slice height in every column', function () {
  [40, 66, 90, 110].forEach(function (fov) {
    var s = facingWall(fov), w = 320, f = C.castFrame(s.m, s.cam, w, true), focal = C.focalPx(w, s.cam);
    var h0 = C.sliceHeight(f.dist[0], focal);
    for (var x = 0; x < w; x++) {
      assert.strictEqual(f.mapY[x], 0, 'every ray hits the north wall');
      assert(Math.abs(C.sliceHeight(f.dist[x], focal) - h0) < 1e-6, 'column ' + x + ' at fov ' + fov);
    }
    assert(Math.abs(f.dist[0] - 3) < 1e-9);
  });
  return 'all 320 columns equal at 40, 66, 90 and 110 degrees';
});
check('(b) correction off: the same wall bulges, tallest in the middle, shrinking by cos(angle)', function () {
  var s = facingWall(66), w = 320, f = C.castFrame(s.m, s.cam, w, false), focal = C.focalPx(w, s.cam);
  var mid = C.sliceHeight(f.dist[w / 2], focal), edge = C.sliceHeight(f.dist[0], focal);
  assert(mid > edge * 1.15, 'centre ' + mid + ' edge ' + edge);
  for (var x = 1; x < w / 2; x++) assert(C.sliceHeight(f.dist[x], focal) > C.sliceHeight(f.dist[x - 1], focal), 'rising to the centre');
  for (x = 0; x < w; x++) {
    var ang = Math.atan(C.cameraX(x, w) * s.cam.planeLen);
    var corrected = C.sliceHeight(f.perp[x], focal);
    assert(Math.abs(C.sliceHeight(f.dist[x], focal) - corrected * Math.cos(ang)) < 1e-6);
  }
  return 'centre ' + mid.toFixed(1) + ' px, edges ' + edge.toFixed(1) + ' px';
});

// ------------------------------------------------------------------ (c) collision
check('(c) a 200,000-step random walk never ends a step inside a wall', function () {
  var R = C.rng(11), seeds = [C.DEFAULT_SEED, 7, 1234], total = 0;
  seeds.forEach(function (seed) {
    var L = C.generateLevel(seed), x = L.start.x, y = L.start.y, a = 0;
    for (var i = 0; i < 66667; i++) {
      if (R() < 0.1) a = R() * Math.PI * 2;
      var len = R() < 0.05 ? R() * 3 : R() * 0.2;   // mostly small steps, some long lunges
      var p = C.movePlayer(L.map, x, y, Math.cos(a) * len, Math.sin(a) * len, C.PLAYER_R);
      x = p.x; y = p.y; total++;
      assert(C.boxClear(L.map, x, y, C.PLAYER_R), 'inside a wall at ' + x + ',' + y + ' (seed ' + seed + ', step ' + i + ')');
    }
  });
  return total + ' steps';
});
check('(c) the full game step with random input keeps the player clear of walls', function () {
  var R = C.rng(3), g = C.createGame(), dt = 1 / 60;
  for (var i = 0; i < 30000; i++) {
    C.stepGame(g, { move: R() * 2 - 1, strafe: R() < 0.3 ? R() * 2 - 1 : 0, turn: R() * 2 - 1, zap: R() < 0.01 }, R() < 0.02 ? 0.25 : dt);
    assert(C.boxClear(g.map, g.player.x, g.player.y, C.PLAYER_R));
    g.drones.forEach(function (d) { assert(!C.isWallAt(g.map, d.x, d.y), 'drone in a wall'); });
    if (g.won) g = C.createGame();
  }
});

// ------------------------------------------------------------------ (d) determinism
check('(d) the same seed gives the same level and the same drone paths', function () {
  [C.DEFAULT_SEED, 7, 2024].forEach(function (seed) {
    var a = C.generateLevel(seed), b = C.generateLevel(seed);
    assert.deepStrictEqual(Array.from(a.map.cells), Array.from(b.map.cells));
    assert.deepStrictEqual(a.keys, b.keys); assert.deepStrictEqual(a.drones, b.drones); assert.deepStrictEqual(a.exit, b.exit);
    var ga = C.createGame(seed), gb = C.createGame(seed), R1 = C.rng(9), R2 = C.rng(9);
    for (var i = 0; i < 3000; i++) {
      var ia = { move: R1() * 2 - 1, turn: R1() * 2 - 1, zap: R1() < 0.02 }, ib = { move: R2() * 2 - 1, turn: R2() * 2 - 1, zap: R2() < 0.02 };
      C.stepGame(ga, ia, 1 / 60); C.stepGame(gb, ib, 1 / 60);
      for (var k = 0; k < ga.drones.length; k++) {
        assert.strictEqual(ga.drones[k].x, gb.drones[k].x); assert.strictEqual(ga.drones[k].y, gb.drones[k].y);
      }
    }
  });
  var moved = C.createGame(), start = moved.drones.map(function (d) { return [d.x, d.y]; });
  for (var i = 0; i < 600; i++) C.stepGame(moved, {}, 1 / 60);
  assert(moved.drones.some(function (d, k) { return d.x !== start[k][0] || d.y !== start[k][1]; }), 'drones actually drift');
  var other = C.generateLevel(C.DEFAULT_SEED + 1);
  assert.notDeepStrictEqual(Array.from(other.map.cells), Array.from(C.generateLevel(C.DEFAULT_SEED).map.cells), 'a different seed gives a different maze');
});

// ------------------------------------------------------------------ (e) solvability
check('(e) the default level is solvable: every key and the exit are reachable', function () {
  var L = C.generateLevel(C.DEFAULT_SEED);
  assert(C.solvable(L));
  assert.strictEqual(L.keys.length, 3);
  assert.strictEqual(L.drones.length, 3);
});
check('(e) 1000 other seeds are all solvable, with three distinct keys off the start tile', function () {
  for (var seed = 1; seed <= 1000; seed++) {
    var L = C.generateLevel(seed);
    assert(C.solvable(L), 'seed ' + seed);
    assert.strictEqual(L.keys.length, 3, 'seed ' + seed);
    var ids = L.keys.map(function (k) { return k.x + ',' + k.y; });
    assert.strictEqual(new Set(ids).size, 3);
    assert(ids.indexOf('1,1') < 0);
  }
});
check('(e) a scripted player that walks the shortest paths collects every key and wins', function () {
  var g = C.createGame(), won = false;
  function pathTo(tx, ty) {
    var d = C.bfs(g.map, tx, ty), x = Math.floor(g.player.x), y = Math.floor(g.player.y), route = [];
    while (d[y * g.map.w + x] > 0) {
      var best = null;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (s) {
        var nx = x + s[0], ny = y + s[1], v = C.tileAt(g.map, nx, ny) === C.EMPTY ? d[ny * g.map.w + nx] : -1;
        if (v >= 0 && v < d[y * g.map.w + x] && !best) best = [nx, ny];
      });
      x = best[0]; y = best[1]; route.push(best);
    }
    return route;
  }
  function walk(route) {
    route.forEach(function (c) {
      for (var i = 0; i < 400; i++) {
        var dx = c[0] + 0.5 - g.player.x, dy = c[1] + 0.5 - g.player.y;
        if (Math.hypot(dx, dy) < 0.05) break;
        g.player.a = Math.atan2(dy, dx);
        var ev = C.stepGame(g, { move: Math.min(1, Math.hypot(dx, dy) / (2.6 / 60)) }, 1 / 60);
        if (ev.some(function (e) { return e.type === 'win'; })) won = true;
      }
    });
  }
  g.level.keys.forEach(function (k) { walk(pathTo(k.x, k.y)); });
  assert.strictEqual(C.keysTaken(g), 3);
  var ap = g.level.exitApproach, ex = g.level.exit;
  walk(pathTo(ap.x, ap.y));
  g.player.a = Math.atan2(ex.y - ap.y, ex.x - ap.x);
  for (var i = 0; i < 120 && !won; i++) if (C.stepGame(g, { move: 1 }, 1 / 60).some(function (e) { return e.type === 'win'; })) won = true;
  assert(won, 'reached the exit with all keys');
  return 'finished in ' + g.time.toFixed(1) + ' s plus ' + g.penalty + ' s of penalties';
});

// ------------------------------------------------------------------ sprites and the zap beam
check('sprites: one straight ahead projects to the centre column; the depth is perpendicular', function () {
  var cam = C.makeCamera(2, 2, 0.7, 66), w = 320;
  var p = C.projectSprite(cam, 2 + 3 * Math.cos(0.7), 2 + 3 * Math.sin(0.7), w, true);
  assert(Math.abs(p.screenX - w / 2) < 1e-9); assert(Math.abs(p.depth - 3) < 1e-9);
  // A sprite on the left edge ray lands at column 0's left edge.
  var lx = 2 + 3 * (cam.dirX - cam.planeX), ly = 2 + 3 * (cam.dirY - cam.planeY);
  assert(Math.abs(C.projectSprite(cam, lx, ly, w, true).screenX - 0) < 1e-9);
});
check('zap: hits a drone straight ahead, misses one behind a wall or off to the side', function () {
  var m = C.mapFromRows(['1111111111', '1........1', '1....1...1', '1111111111']);
  var drones = [{ x: 7.5, y: 1.5, stun: 0 }];
  assert.strictEqual(C.zapTest(m, 1.5, 1.5, 0, drones).index, 0);
  assert.strictEqual(C.zapTest(m, 1.5, 1.5, 0.3, drones).index, -1, 'aimed away');
  assert.strictEqual(C.zapTest(m, 1.5, 2.5, 0, [{ x: 7.5, y: 2.5, stun: 0 }]).index, -1, 'wall in the way');
  assert.strictEqual(C.zapTest(m, 1.5, 1.5, 0, [{ x: 7.5, y: 1.5, stun: 2 }]).index, -1, 'already dimmed');
  assert.strictEqual(C.zapTest(m, 0.5 + 1, 1.5, 0, [{ x: 8.5, y: 1.5, stun: 0 }]).index, -1, 'beyond the range of ' + C.ZAP_RANGE);
});

// ------------------------------------------------------------------ the reveal
check('hold (plan open): drones stand still, cannot catch you, and you walk at half pace', function () {
  var a = C.createGame(), b = C.createGame();
  // Both start on the same tile facing the same open corridor.
  var x0 = a.level.start.x, y0 = a.level.start.y;
  var before = a.drones.map(function (d) { return [d.x, d.y]; });
  C.stepGame(a, { move: 1, hold: true }, 0.05); C.stepGame(b, { move: 1 }, 0.05);
  var da = Math.hypot(a.player.x - x0, a.player.y - y0), db = Math.hypot(b.player.x - x0, b.player.y - y0);
  assert(Math.abs(db - C.MOVE_SPEED * 0.05) < 1e-9, 'full pace ' + db);
  assert(Math.abs(da - C.HOLD_PACE * C.MOVE_SPEED * 0.05) < 1e-9, 'half pace ' + da);
  for (var i = 0; i < 600; i++) C.stepGame(a, { turn: 0.2, hold: true }, 1 / 60);
  a.drones.forEach(function (d, k) { assert(d.x === before[k][0] && d.y === before[k][1], 'drone held'); });
  // A drone parked on the player cannot catch them while held.
  a.drones[0].x = a.player.x; a.drones[0].y = a.player.y;
  var ev = C.stepGame(a, { move: 0.1, hold: true }, 1 / 60);
  assert(!ev.some(function (e) { return e.type === 'caught'; }) && a.penalty === 0);
});
check('plan window: about 8 tiles across, the player always inside it, tens of pixels per tile', function () {
  var m = C.generateLevel(C.DEFAULT_SEED).map, R = C.rng(8);
  [[350, 350], [330, 330], [520, 520], [300, 200]].forEach(function (sz) {
    for (var k = 0; k < 500; k++) {
      var px = 1 + R() * (m.w - 2), py = 1 + R() * (m.h - 2), v = C.planWindow(sz[0], sz[1], m.w, m.h, px, py, 8);
      var sx = v.ox + px * v.s, sy = v.oy + py * v.s;
      assert(sx >= 0 && sx <= sz[0] && sy >= 0 && sy <= sz[1], 'player off the plan');
      assert(v.ox <= 0 && v.ox + m.w * v.s >= sz[0], 'window stays inside the map');
      assert(v.s >= 25, 'scale ' + v.s);
    }
  });
  var whole = C.planWindow(300, 300, 9, 9, 4.5, 4.5, 10);
  assert(Math.abs(whole.ox - (300 - 9 * whole.s) / 2) < 1e-9, 'a map smaller than the window is centred');
});
check('cue sheet: the printed sum, focal ÷ distance = height, is right for the numbers printed', function () {
  var m = C.generateLevel(C.DEFAULT_SEED).map, R = C.rng(21), open = openTiles(m), worst = 0;
  for (var k = 0; k < 3000; k++) {
    var tile = open[Math.floor(R() * open.length)];
    var cam = C.makeCamera(tile[0] + 0.25 + 0.5 * R(), tile[1] + 0.25 + 0.5 * R(), R() * 6.3, 40 + R() * 70);
    var f = C.castFrame(m, cam, 320, R() < 0.5), col = Math.floor(R() * 320), sum = C.sheetSum(C.focalPx(320, cam), f.dist[col]);
    var shown = sum.focal / parseFloat(sum.dist);
    assert(Math.abs(sum.height - shown) <= 0.5 + 1e-9, sum.focal + ' / ' + sum.dist + ' printed as ' + sum.height);
    // ...and stays close to the height actually drawn.
    worst = Math.max(worst, Math.abs(sum.height - C.sliceHeight(f.dist[col], C.focalPx(320, cam))) / C.sliceHeight(f.dist[col], C.focalPx(320, cam)));
  }
  return 'printed height within ' + (worst * 100).toFixed(1) + '% of the drawn height';
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
