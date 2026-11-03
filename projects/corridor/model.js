// Corridor: a small grid raycaster in the style of early 1990s first-person games, plus the
// game that runs on it. Works in the browser (window.Corridor) and in Node (module.exports).
//
// Coordinates: the map is a grid of unit tiles, x to the right and y downwards (as on a page).
// A tile value of 0 is open floor; anything else is a wall, and the value picks its texture.
//
// The camera is a position, a unit direction vector and a "camera plane" vector at right
// angles to it, as long as tan(fov / 2). Screen column x (of w) looks along
//     dir + plane * cameraX,   cameraX = 2 (x + 0.5) / w - 1   (from -1 at the left to +1 at the right).
// Each ray walks the grid one tile boundary at a time (DDA: digital differential analysis),
// so it visits exactly the tiles it passes through and stops at the first wall.
// Because the ray direction is not normalised, the ray parameter t at the hit is the distance
// from the camera to the wall measured along the view direction (the "perpendicular" distance),
// not the straight-line distance. Drawing slices with the straight-line distance instead is what
// produces the fish-eye bulge; the straight-line distance is t times the length of the ray vector.
(function (root) {
  'use strict';

  var EMPTY = 0, BRICK = 1, PANEL = 2, PAPER = 3, EXIT = 4;
  var DEFAULT_SEED = 1907;
  var PLAYER_R = 0.22;          // half the side of the player's square collision box, in tiles
  var MOVE_SPEED = 2.6;         // tiles per second
  var TURN_SPEED = 2.4;         // radians per second
  var DRONE_SPEED = 0.8;
  var DRONE_CHASE = 1.15;
  var DRONE_SIGHT = 5.5;
  var DRONE_R = 0.3;            // zap hit radius around a drone's centre
  var CATCH_R = 0.5;
  var ZAP_RANGE = 6;
  var ZAP_STUN = 5;
  var CATCH_STUN = 3;
  var PENALTY = 5;              // seconds added when a drone catches you
  var KEY_R = 0.5;
  var HOLD_PACE = 0.5;          // walking speed while the ground plan is open ("hold")

  // ------------------------------------------------------------------ seeded PRNG (mulberry32)
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

  // ------------------------------------------------------------------ the grid
  function makeMap(w, h, fill) {
    var cells = new Uint8Array(w * h);
    if (fill) cells.fill(fill);
    return { w: w, h: h, cells: cells };
  }
  function mapFromRows(rows) {
    var h = rows.length, w = rows[0].length, m = makeMap(w, h, 0);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var c = rows[y].charAt(x);
      m.cells[y * w + x] = c === '.' ? 0 : (c === 'E' ? EXIT : (+c || 1));
    }
    return m;
  }
  // Anything outside the grid counts as wall, so no ray or walker can leave it.
  function tileAt(map, x, y) {
    if (x < 0 || y < 0 || x >= map.w || y >= map.h) return BRICK;
    return map.cells[y * map.w + x];
  }
  function isWallAt(map, px, py) { return tileAt(map, Math.floor(px), Math.floor(py)) !== EMPTY; }

  // ------------------------------------------------------------------ one ray, by DDA
  // (px, py) start, (rdx, rdy) direction (any length). Returns t such that the hit point is
  // p + t * rd, which side of the tile was struck (0: a face of constant x, 1: constant y), the tile,
  // and u in [0, 1): where along that face the ray landed, left to right as seen by the viewer.
  function castRay(map, px, py, rdx, rdy, out) {
    out = out || {};
    var mapX = Math.floor(px), mapY = Math.floor(py);
    var deltaX = rdx === 0 ? 1e30 : Math.abs(1 / rdx);
    var deltaY = rdy === 0 ? 1e30 : Math.abs(1 / rdy);
    var stepX, stepY, sideX, sideY;
    if (rdx < 0) { stepX = -1; sideX = (px - mapX) * deltaX; } else { stepX = 1; sideX = (mapX + 1 - px) * deltaX; }
    if (rdy < 0) { stepY = -1; sideY = (py - mapY) * deltaY; } else { stepY = 1; sideY = (mapY + 1 - py) * deltaY; }
    var side = 0, tile = tileAt(map, mapX, mapY), steps = 0, limit = map.w + map.h + 4;
    // If we start inside a wall (never happens in play), report a hit at distance zero.
    if (tile !== EMPTY) { out.t = 0; out.side = 0; out.mapX = mapX; out.mapY = mapY; out.tile = tile; out.hitX = px; out.hitY = py; out.u = 0; out.steps = 0; return out; }
    while (steps++ < limit) {
      if (sideX < sideY) { sideX += deltaX; mapX += stepX; side = 0; }
      else { sideY += deltaY; mapY += stepY; side = 1; }
      tile = tileAt(map, mapX, mapY);
      if (tile !== EMPTY) break;
    }
    var t = side === 0 ? sideX - deltaX : sideY - deltaY;
    var hx = px + t * rdx, hy = py + t * rdy;
    var u = side === 0 ? hy - Math.floor(hy) : hx - Math.floor(hx);
    if ((side === 0 && rdx < 0) || (side === 1 && rdy > 0)) u = 1 - u;
    out.t = t; out.side = side; out.mapX = mapX; out.mapY = mapY; out.tile = tile;
    out.hitX = hx; out.hitY = hy; out.u = u; out.steps = steps;
    return out;
  }

  // ------------------------------------------------------------------ camera and the frame loop
  function makeCamera(x, y, angle, fovDeg) {
    var k = Math.tan(fovDeg * Math.PI / 360);
    var dx = Math.cos(angle), dy = Math.sin(angle);
    return { x: x, y: y, angle: angle, fov: fovDeg, dirX: dx, dirY: dy, planeX: -dy * k, planeY: dx * k, planeLen: k };
  }
  // Pixels per tile at distance 1: chosen so that pixels are square for any screen width and fov.
  function focalPx(w, cam) { return (w / 2) / cam.planeLen; }
  function cameraX(x, w) { return 2 * (x + 0.5) / w - 1; }

  function allocFrame(w) {
    return {
      w: w,
      perp: new Float64Array(w), euclid: new Float64Array(w), dist: new Float64Array(w),
      side: new Uint8Array(w), tile: new Uint8Array(w), u: new Float64Array(w),
      hitX: new Float64Array(w), hitY: new Float64Array(w), mapX: new Int32Array(w), mapY: new Int32Array(w),
      rdx: new Float64Array(w), rdy: new Float64Array(w)
    };
  }
  // The whole trick: one ray per screen column. `correct` picks the distance each slice uses.
  function castFrame(map, cam, w, correct, frame) {
    if (!frame || frame.w !== w) frame = allocFrame(w);
    var hit = {};
    for (var x = 0; x < w; x++) {
      var cx = cameraX(x, w);
      var rdx = cam.dirX + cam.planeX * cx, rdy = cam.dirY + cam.planeY * cx;
      castRay(map, cam.x, cam.y, rdx, rdy, hit);
      var len = Math.sqrt(rdx * rdx + rdy * rdy);
      frame.perp[x] = hit.t;
      frame.euclid[x] = hit.t * len;
      frame.dist[x] = correct ? hit.t : hit.t * len;
      frame.side[x] = hit.side; frame.tile[x] = hit.tile; frame.u[x] = hit.u;
      frame.hitX[x] = hit.hitX; frame.hitY[x] = hit.hitY; frame.mapX[x] = hit.mapX; frame.mapY[x] = hit.mapY;
      frame.rdx[x] = rdx; frame.rdy[x] = rdy;
    }
    frame.correct = !!correct;
    return frame;
  }
  // A wall is one tile tall and the eye is halfway up it, so the slice is centred on the horizon.
  function sliceHeight(dist, focal) { return focal / Math.max(dist, 1e-6); }

  // Billboard sprites: depth along the view direction, and where the centre lands on screen.
  function projectSprite(cam, sx, sy, w, correct) {
    var rx = sx - cam.x, ry = sy - cam.y;
    var depth = rx * cam.dirX + ry * cam.dirY;
    var lateral = (rx * cam.planeX + ry * cam.planeY) / cam.planeLen;
    var focal = focalPx(w, cam);
    var scaleDist = correct ? depth : Math.sqrt(rx * rx + ry * ry);
    return { depth: depth, screenX: w / 2 + focal * lateral / depth, scaleDist: scaleDist, focal: focal };
  }

  // ------------------------------------------------------------------ collision
  // The player is a square of half-side r. Moves are split into small sub-steps and each axis is
  // resolved separately, so the player slides along walls and can never end up inside one.
  function moveAxis(map, x, y, d, r, axisX) {
    var p = axisX ? x : y, q = axisX ? y : x, np = p + d;
    var q0 = Math.floor(q - r), q1 = Math.floor(q + r), i, edge;
    function wall(a, b) { return axisX ? tileAt(map, a, b) !== EMPTY : tileAt(map, b, a) !== EMPTY; }
    if (d > 0) {
      edge = Math.floor(np + r);
      for (i = q0; i <= q1; i++) if (wall(edge, i)) { np = edge - r - 1e-6; break; }
    } else if (d < 0) {
      edge = Math.floor(np - r);
      for (i = q0; i <= q1; i++) if (wall(edge, i)) { np = edge + 1 + r + 1e-6; break; }
    }
    return np;
  }
  function movePlayer(map, x, y, dx, dy, r) {
    var n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / (r * 0.9)));
    var sx = dx / n, sy = dy / n;
    for (var i = 0; i < n; i++) {
      x = moveAxis(map, x, y, sx, r, true);
      y = moveAxis(map, x, y, sy, r, false);
    }
    return { x: x, y: y };
  }
  function boxClear(map, x, y, r) {
    return !isWallAt(map, x - r, y - r) && !isWallAt(map, x + r, y - r) &&
           !isWallAt(map, x - r, y + r) && !isWallAt(map, x + r, y + r);
  }

  // ------------------------------------------------------------------ reachability
  function bfs(map, sx, sy) {
    var dist = new Int32Array(map.w * map.h).fill(-1), queue = [sx + sy * map.w];
    dist[queue[0]] = 0;
    for (var qi = 0; qi < queue.length; qi++) {
      var i = queue[qi], x = i % map.w, y = (i - x) / map.w;
      var nb = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
      for (var k = 0; k < 4; k++) {
        var nx = nb[k][0], ny = nb[k][1];
        if (tileAt(map, nx, ny) !== EMPTY) continue;
        var j = nx + ny * map.w;
        if (dist[j] < 0) { dist[j] = dist[i] + 1; queue.push(j); }
      }
    }
    return dist;
  }
  // Every key tile and the floor tile in front of the exit must be reachable from the start.
  function solvable(level) {
    var m = level.map, d = bfs(m, Math.floor(level.start.x), Math.floor(level.start.y));
    var keysOk = level.keys.every(function (k) { return d[k.x + k.y * m.w] >= 0; });
    var exitOk = d[level.exitApproach.x + level.exitApproach.y * m.w] >= 0 && tileAt(m, level.exit.x, level.exit.y) === EXIT;
    return keysOk && exitOk;
  }

  // ------------------------------------------------------------------ the level generator
  // A depth-first maze on an 8 x 8 grid of cells (17 x 17 tiles), with some extra openings so
  // there are loops to escape along, and two small rooms. Walls are themed by how far they are
  // from the start: a painted brick street, then a panelled hall, then a papered parlour.
  function generateLevel(seed) {
    var R = rng(seed), N = 8, W = 2 * N + 1, H = W, m = makeMap(W, H, BRICK), x, y, i;
    function open(tx, ty) { m.cells[ty * W + tx] = EMPTY; }
    var seen = new Uint8Array(N * N), stack = [[0, 0]];
    seen[0] = 1; open(1, 1);
    while (stack.length) {
      var top = stack[stack.length - 1], cx = top[0], cy = top[1], opts = [];
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
        var nx = cx + d[0], ny = cy + d[1];
        if (nx >= 0 && ny >= 0 && nx < N && ny < N && !seen[ny * N + nx]) opts.push([nx, ny, d]);
      });
      if (!opts.length) { stack.pop(); continue; }
      var pick = opts[Math.floor(R() * opts.length)];
      open(2 * cx + 1 + pick[2][0], 2 * cy + 1 + pick[2][1]);
      open(2 * pick[0] + 1, 2 * pick[1] + 1);
      seen[pick[1] * N + pick[0]] = 1;
      stack.push([pick[0], pick[1]]);
    }
    for (y = 1; y < H - 1; y++) for (x = 1; x < W - 1; x++) {
      var between = (x % 2 === 0 && y % 2 === 1) || (x % 2 === 1 && y % 2 === 0);
      if (between && m.cells[y * W + x] !== EMPTY && R() < 0.14) open(x, y);
    }
    for (i = 0; i < 2; i++) {
      var rx = 1 + Math.floor(R() * (N - 2)), ry = 1 + Math.floor(R() * (N - 2));
      for (y = 2 * ry + 1; y <= 2 * ry + 3; y++) for (x = 2 * rx + 1; x <= 2 * rx + 3; x++) open(x, y);
    }

    var dist = bfs(m, 1, 1), maxD = 0;
    for (i = 0; i < dist.length; i++) if (dist[i] > maxD) maxD = dist[i];
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      if (m.cells[y * W + x] === EMPTY) continue;
      var best = -1;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        var nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        var dd = dist[ny * W + nx];
        if (dd >= 0 && (best < 0 || dd < best)) best = dd;
      }
      if (best < 0) best = maxD * (x + y) / (W + H);
      m.cells[y * W + x] = best < maxD / 3 ? BRICK : (best < 2 * maxD / 3 ? PANEL : PAPER);
    }

    // The exit: in the outer wall, beside the open tile farthest from the start.
    var ex = null, far = -1;
    for (y = 1; y < H - 1; y++) for (x = 1; x < W - 1; x++) {
      var d0 = dist[y * W + x];
      if (d0 < 0 || !(x === 1 || y === 1 || x === W - 2 || y === H - 2)) continue;
      if (d0 > far) { far = d0; ex = { x: x, y: y }; }
    }
    var exit = ex.x === W - 2 ? { x: W - 1, y: ex.y } : ex.y === H - 2 ? { x: ex.x, y: H - 1 } : ex.x === 1 ? { x: 0, y: ex.y } : { x: ex.x, y: 0 };
    m.cells[exit.y * W + exit.x] = EXIT;

    // Keys: dead ends, spread out greedily (each next key as far as possible from the others).
    var cands = [];
    for (y = 1; y < H - 1; y++) for (x = 1; x < W - 1; x++) {
      if (dist[y * W + x] < 4 || (x === ex.x && y === ex.y)) continue;
      var openN = 0;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) { if (tileAt(m, x + d[0], y + d[1]) === EMPTY) openN++; });
      cands.push({ x: x, y: y, dead: openN === 1, d: dist[y * W + x] });
    }
    var dead = cands.filter(function (c) { return c.dead; });
    var pool = dead.length >= 3 ? dead : cands;
    var anchors = [{ x: 1, y: 1 }, ex], keys = [];
    for (i = 0; i < 3; i++) {
      var bestC = null, bestS = -1;
      pool.forEach(function (c) {
        if (keys.indexOf(c) >= 0) return;
        var s = Infinity;
        anchors.concat(keys).forEach(function (a) { s = Math.min(s, Math.hypot(a.x - c.x, a.y - c.y)); });
        s += c.d * 0.05;
        if (s > bestS) { bestS = s; bestC = c; }
      });
      keys.push(bestC);
    }

    // Drones start well away from the start and from each other.
    var spots = cands.filter(function (c) { return c.d >= 7 && keys.indexOf(c) < 0; }), drones = [];
    for (var tries = 0; tries < 400 && drones.length < 3 && spots.length; tries++) {
      var s0 = spots[Math.floor(R() * spots.length)];
      if (drones.every(function (d) { return Math.hypot(d.x - s0.x, d.y - s0.y) >= 4; })) drones.push({ x: s0.x, y: s0.y });
    }

    var startA = tileAt(m, 2, 1) === EMPTY ? 0 : Math.PI / 2;
    return {
      seed: seed, map: m,
      start: { x: 1.5, y: 1.5, angle: startA },
      exit: exit, exitApproach: { x: ex.x, y: ex.y },
      keys: keys.map(function (k) { return { x: k.x, y: k.y }; }),
      drones: drones
    };
  }

  // ------------------------------------------------------------------ the game
  function createGame(seed) {
    if (seed === undefined) seed = DEFAULT_SEED;
    var level = generateLevel(seed);
    return {
      seed: seed, level: level, map: level.map,
      player: { x: level.start.x, y: level.start.y, a: level.start.angle },
      keys: level.keys.map(function (k) { return { x: k.x + 0.5, y: k.y + 0.5, taken: false }; }),
      drones: level.drones.map(function (d) {
        return { x: d.x + 0.5, y: d.y + 0.5, tx: d.x, ty: d.y, px: -1, py: -1, stun: 0, chasing: false };
      }),
      rng: rng((seed ^ 0x5bd1e995) >>> 0),
      time: 0, penalty: 0, started: false, won: false, zapCool: 0, lockedCool: 0
    };
  }
  function keysTaken(g) { return g.keys.filter(function (k) { return k.taken; }).length; }

  function lineOfSight(map, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy);
    if (d < 1e-9) return true;
    var h = castRay(map, ax, ay, dx / d, dy / d);
    return h.t >= d;
  }

  // Which drone (if any) does a beam fired straight ahead hit first? Each drone is a disc of radius
  // DRONE_R; the beam stops at the first wall or after ZAP_RANGE tiles.
  function zapTest(map, x, y, angle, drones) {
    var ux = Math.cos(angle), uy = Math.sin(angle), wall = castRay(map, x, y, ux, uy).t;
    var reach = Math.min(wall, ZAP_RANGE), best = -1, bestAlong = Infinity, beyond = false;
    for (var i = 0; i < drones.length; i++) {
      var d = drones[i];
      if (d.stun > 0) continue;
      var rx = d.x - x, ry = d.y - y, along = rx * ux + ry * uy, off = Math.abs(-rx * uy + ry * ux);
      if (along <= 0 || off > DRONE_R) continue;
      if (along > reach) { if (along < wall) beyond = true; continue; }
      if (along < bestAlong) { bestAlong = along; best = i; }
    }
    // beyond: a drone was in line and in view, but past the beam's reach.
    return { index: best, length: best >= 0 ? bestAlong : reach, beyond: best < 0 && beyond };
  }

  function chooseNext(g, d) {
    var m = g.map, opts = [];
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (s) {
      var nx = d.tx + s[0], ny = d.ty + s[1];
      if (tileAt(m, nx, ny) === EMPTY) opts.push([nx, ny]);
    });
    if (opts.length > 1) opts = opts.filter(function (o) { return !(o[0] === d.px && o[1] === d.py); });
    if (!opts.length) return;
    var p = g.player, near = Math.hypot(p.x - d.x, p.y - d.y) < DRONE_SIGHT && lineOfSight(m, d.x, d.y, p.x, p.y);
    d.chasing = near;
    var pick;
    if (near && g.rng() < 0.75) {
      pick = opts[0];
      opts.forEach(function (o) {
        if (Math.hypot(o[0] + 0.5 - p.x, o[1] + 0.5 - p.y) < Math.hypot(pick[0] + 0.5 - p.x, pick[1] + 0.5 - p.y)) pick = o;
      });
    } else pick = opts[Math.floor(g.rng() * opts.length)];
    d.px = d.tx; d.py = d.ty; d.tx = pick[0]; d.ty = pick[1];
  }

  // input: { move: -1..1, strafe: -1..1, turn: -1..1, look: radians this step, zap: bool,
  //          hold: bool (used while the plan is shown: the drones hold still and cannot catch you,
  //                and you walk at half pace, so the plan is a place to study, not a shortcut) }
  function stepGame(g, input, dt) {
    var events = [], p = g.player, m = g.map;
    input = input || {};
    if (g.won) return events;
    var move = input.move || 0, strafe = input.strafe || 0, turn = input.turn || 0, look = input.look || 0;
    if (!g.started && (move || strafe || turn || look || input.zap)) g.started = true;
    p.a += turn * TURN_SPEED * dt + look;
    var ca = Math.cos(p.a), sa = Math.sin(p.a);
    var pace = MOVE_SPEED * (input.hold ? HOLD_PACE : 1) * dt;
    var mx = (ca * move - sa * strafe) * pace, my = (sa * move + ca * strafe) * pace;
    if (mx || my) { var np = movePlayer(m, p.x, p.y, mx, my, PLAYER_R); p.x = np.x; p.y = np.y; }
    if (g.started) g.time += dt;

    g.keys.forEach(function (k, i) {
      if (!k.taken && Math.hypot(k.x - p.x, k.y - p.y) < KEY_R) { k.taken = true; events.push({ type: 'key', index: i, count: keysTaken(g) }); }
    });

    g.zapCool = Math.max(0, g.zapCool - dt);
    if (input.zap && g.zapCool === 0) {
      g.zapCool = 0.5;
      var z = zapTest(m, p.x, p.y, p.a, g.drones);
      if (z.index >= 0) g.drones[z.index].stun = ZAP_STUN;
      events.push({ type: 'zap', index: z.index, length: z.length, beyond: z.beyond });
    }

    if (!input.hold) g.drones.forEach(function (d, i) {
      if (d.stun > 0) { d.stun = Math.max(0, d.stun - dt); return; }
      var speed = (d.chasing ? DRONE_CHASE : DRONE_SPEED) * dt, budget = speed;
      for (var guard = 0; guard < 4 && budget > 0; guard++) {
        var tx = d.tx + 0.5, ty = d.ty + 0.5, dx = tx - d.x, dy = ty - d.y, dd = Math.hypot(dx, dy);
        if (dd <= budget) { d.x = tx; d.y = ty; budget -= dd; chooseNext(g, d); }
        else { d.x += dx / dd * budget; d.y += dy / dd * budget; budget = 0; }
      }
      if (g.started && Math.hypot(d.x - p.x, d.y - p.y) < CATCH_R) {
        d.stun = CATCH_STUN; g.penalty += PENALTY;
        // It turns back the way it came, so it does not sit on you.
        var bx = d.px, by = d.py;
        if (bx >= 0) { d.px = d.tx; d.py = d.ty; d.tx = bx; d.ty = by; }
        events.push({ type: 'caught', index: i, penalty: PENALTY });
      }
    });

    // The exit is a door in the outer wall: touch it once you hold all three keys.
    g.lockedCool = Math.max(0, g.lockedCool - dt);
    var e = g.level.exit;
    var cx = Math.max(e.x, Math.min(p.x, e.x + 1)), cy = Math.max(e.y, Math.min(p.y, e.y + 1));
    if (Math.hypot(cx - p.x, cy - p.y) < PLAYER_R + 0.3) {
      if (keysTaken(g) === g.keys.length) { g.won = true; events.push({ type: 'win', total: g.time + g.penalty }); }
      else if (g.lockedCool === 0) { g.lockedCool = 2.5; events.push({ type: 'locked', missing: g.keys.length - keysTaken(g) }); }
    }
    return events;
  }

  // ------------------------------------------------------------------ the ground plan's window
  // The plan shows a window about `span` tiles across, centred on the player (and kept inside the
  // map where it can be), so a typical ray of one or two tiles is drawn tens of pixels long.
  // Returns pixels per tile and the pixel offset of the map's origin.
  function planWindow(cw, ch, mapW, mapH, px, py, span) {
    var s = Math.min(cw, ch) / span;
    function axis(c, size, p) {
      if (size * s <= c) return (c - size * s) / 2;
      return Math.min(0, Math.max(c - size * s, c / 2 - p * s));
    }
    return { s: s, ox: axis(cw, mapW, px), oy: axis(ch, mapH, py) };
  }

  // The cue sheet's sum, "focal ÷ distance = height", with the result worked out from the numbers
  // as printed, so a reader who checks it with a calculator gets the same answer.
  function sheetSum(focal, dist) {
    var f = Math.round(focal), d = dist.toFixed(2), dn = Math.max(+d, 0.01);
    return { focal: f, dist: d, height: Math.round(f / dn) };
  }

  // ------------------------------------------------------------------ the card preview's set
  // A hand-made corridor, walked from the bottom of the plan to the top.
  var PREVIEW_ROWS = [
    '111111111',
    '1113E3111',
    '113...311',
    '113...311',
    '1133.3311',
    '1223.3221',
    '12.....21',
    '1222.2221',
    '1112.2111',
    '1112.2111',
    '112...211',
    '1122.2211',
    '1112.2111',
    '1111.1111',
    '11.....11',
    '1111.1111',
    '1111.1111',
    '1111.1111',
    '1111.1111',
    '111111111'
  ];
  function previewSet() {
    return {
      map: mapFromRows(PREVIEW_ROWS),
      keys: [{ x: 4.5, y: 10.5 }],
      drones: [{ x: 3.2, y: 6.5 }, { x: 5.6, y: 2.8 }],
      path: { x: 4.5, y0: 18.2, y1: 6.6 }
    };
  }

  var api = {
    EMPTY: EMPTY, BRICK: BRICK, PANEL: PANEL, PAPER: PAPER, EXIT: EXIT,
    DEFAULT_SEED: DEFAULT_SEED, PLAYER_R: PLAYER_R, ZAP_RANGE: ZAP_RANGE, DRONE_R: DRONE_R,
    rng: rng, makeMap: makeMap, mapFromRows: mapFromRows, tileAt: tileAt, isWallAt: isWallAt,
    castRay: castRay, makeCamera: makeCamera, focalPx: focalPx, cameraX: cameraX,
    allocFrame: allocFrame, castFrame: castFrame, sliceHeight: sliceHeight, projectSprite: projectSprite,
    movePlayer: movePlayer, boxClear: boxClear, bfs: bfs, solvable: solvable,
    generateLevel: generateLevel, createGame: createGame, stepGame: stepGame, keysTaken: keysTaken,
    zapTest: zapTest, lineOfSight: lineOfSight, previewSet: previewSet,
    planWindow: planWindow, sheetSum: sheetSum, HOLD_PACE: HOLD_PACE, MOVE_SPEED: MOVE_SPEED
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Corridor = api;
})(typeof window !== 'undefined' ? window : this);
