// Corridor: the stage (first-person view), the ground plan, the game loop and the card preview.
// All the geometry lives in model.js (window.Corridor); this file only paints and listens.
(function () {
  'use strict';
  var C = window.Corridor, Kit = window.Kit;
  var $ = function (id) { return document.getElementById(id); };

  var TEX = 64, SPR = 32, H = 200;
  var FOG = [12, 9, 10];
  var AMBER = '#f2b35a', CHALK = '#ece6d6', SLATE = '#232b2c', WING = '#141012';
  var DPR = Math.min(2, window.devicePixelRatio || 1);

  // ------------------------------------------------------------------ procedural art
  // Everything is drawn from small formulas: painted flats for walls, a stage lantern and a key
  // for sprites. No image files, no copied game art.
  function hash(x, y, s) {
    var h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 982451653)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function bake(size, fn) {
    var out = new Uint8ClampedArray(size * size * 4);
    for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) {
      var c = fn(x, y), i = (y * size + x) * 4;
      if (!c) continue;
      out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = c[3] || 255;
    }
    return out;
  }
  function mul(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }
  // Every flat has a timber edge where it butts against the next one.
  function flatEdge(x, c) {
    if (x === 0 || x === TEX - 1) return [36, 24, 22];
    if (x === 1) return mul(c, 1.18);
    return c;
  }
  function brushed(x, y, c) { return mul(c, 0.94 + 0.06 * Math.sin((x + y * 0.3) * 0.21) + (hash(x, y, 9) - 0.5) * 0.08); }

  var BRICK_TEX = bake(TEX, function (x, y) {
    var row = y >> 3, off = (row & 1) ? 8 : 0, bx = (x + off) >> 4;
    var mortar = (y & 7) === 7 || ((x + off) & 15) === 0, c;
    if (mortar) c = [148, 130, 108];
    else { var t = 0.86 + hash(bx, row, 2) * 0.26; c = [150 * t, 64 * t, 50 * t]; }
    return flatEdge(x, brushed(x, y, c));
  });
  var PANEL_TEX = bake(TEX, function (x, y) {
    var board = x >> 3, gx = x & 7, c;
    var base = mul([112, 70, 40], 0.9 + hash(board, 0, 3) * 0.2);
    c = mul(base, 1 + 0.09 * Math.sin(y * 0.55 + hash(board, 1, 3) * 6 + Math.sin(y * 0.13 + board) * 2));
    if (gx === 0) c = [52, 32, 20];
    if (y > 41) {
      var px = x & 15;
      c = mul(c, 0.82);
      if (px === 2 || px === 13 || y === 44 || y === 60) c = [70, 44, 27];
    }
    if (y < 3) c = [64, 40, 26];
    else if (y < 5) c = [158, 108, 62];
    if (y >= 38 && y <= 40) c = y === 40 ? [58, 36, 23] : [166, 114, 64];
    return flatEdge(x, brushed(x, y, c));
  });
  var PAPER_TEX = bake(TEX, function (x, y) {
    var c;
    if (y >= 46) {
      if (y === 46) c = [150, 104, 60];
      else if (y === 47) c = [48, 30, 22];
      else c = (x & 15) === 0 ? [44, 27, 20] : mul([86, 52, 33], 0.9 + hash(x >> 4, 5, 4) * 0.16);
    } else {
      var a = (x + y) & 15, b = (x - y + 64) & 15;
      var da = a - 8, db = b - 8;
      c = [98, 30, 40];
      if (a === 0 || b === 0) c = [168, 122, 62];
      if (Math.abs(da) + Math.abs(db) <= 2) c = [206, 156, 80];
    }
    return flatEdge(x, brushed(x, y, c));
  });
  var GLYPHS = { E: ['111', '100', '110', '100', '111'], X: ['101', '101', '010', '101', '101'], I: ['111', '010', '010', '010', '111'], T: ['111', '010', '010', '010', '010'] };
  var EXIT_TEX = bake(TEX, function (x, y) {
    var c = ((y & 7) === 7 || ((x + ((y >> 3) & 1) * 8) & 15) === 0) ? [52, 36, 32] : [74, 46, 40];
    if (y >= 1 && y <= 14 && x >= 15 && x <= 48) {
      c = (y === 1 || y === 14 || x === 15 || x === 48) ? [64, 52, 48] : [20, 16, 18];
      var lx = x - 18, ly = y - 3;
      if (lx >= 0 && ly >= 0 && ly < 10) {
        var letter = 'EXIT'.charAt(Math.floor(lx / 8)), gx = lx % 8;
        if (letter && gx < 6) {
          var bit = GLYPHS[letter][ly >> 1].charAt(gx >> 1);
          if (bit === '1') return [242, 179, 90, 254];            // lit: drawn at full strength in the dark
        }
      }
      return c;
    }
    if (x >= 13 && x <= 50 && y >= 17) {
      if (x <= 15 || x >= 48 || y <= 19) return [42, 27, 21];
      c = mul([104, 64, 36], 1 + 0.07 * Math.sin(y * 0.5 + x * 0.05));
      if (x === 20 || x === 43 || y === 24 || y === 39 || y === 43 || y === 59) c = [70, 43, 26];
      if (x >= 41 && x <= 43 && y >= 40 && y <= 42) c = [242, 179, 90];
      return c;
    }
    return flatEdge(x, c);
  });
  var TEXTURES = [null, BRICK_TEX, PANEL_TEX, PAPER_TEX, EXIT_TEX];
  var FLAT = [null, [150, 64, 50], [112, 70, 40], [98, 30, 40], [104, 64, 36]];

  // A stage lantern on a yoke: the follow-spot. Lit lens pixels are flagged as self-lit.
  function lantern(lit) {
    return bake(SPR, function (x, y) {
      var dx = x - 15.5, dy = y - 18, r = Math.sqrt(dx * dx + dy * dy);
      if (r <= 9.5) {
        if (r <= 6.2) return lit ? (r < 3 ? [255, 236, 190, 254] : [242, 179, 90, 254]) : [64, 58, 56];
        return r > 8.4 ? [28, 24, 26] : [86, 80, 80];
      }
      if ((x === 4 || x === 5 || x === 26 || x === 27) && y >= 6 && y <= 18) return [156, 146, 136];
      if ((y === 6 || y === 7) && x >= 4 && x <= 27) return [156, 146, 136];
      if ((x === 15 || x === 16) && y >= 1 && y < 6) return [110, 100, 95];
      if (y === 0 && x >= 9 && x <= 22) return [178, 168, 158];
      return null;
    });
  }
  var DRONE_LIT = lantern(true), DRONE_DIM = lantern(false);
  var KEY_SPR = bake(SPR, function (x, y) {
    var dx = x - 15.5, dy = y - 8.5, r = Math.sqrt(dx * dx + dy * dy), on = false;
    if (r >= 3 && r <= 6.2) on = true;
    if (x >= 14 && x <= 17 && y >= 14 && y <= 29) on = true;
    if (x >= 18 && x <= 22 && ((y >= 22 && y <= 24) || (y >= 26 && y <= 28))) on = true;
    if (!on) return null;
    var k = x > 16 ? 0.82 : 1.06;
    return [Math.min(255, 242 * k), 179 * k, 90 * k, 254];
  });

  // ------------------------------------------------------------------ the first-person renderer
  // opts: { textures, correct, painted (columns shown), mark (column to tint, or -1), crosshair, beam }
  function renderView(img, map, cam, frame, opts, sprites) {
    var d = img.data, W = img.width, focal = C.focalPx(W, cam), half = H / 2;
    var tex = opts.textures, x, y, i;

    // Floor and ceiling, one row at a time. A floor row at screen height y lies rowDist tiles ahead.
    var dx0 = cam.dirX + cam.planeX * (1 / W - 1), dy0 = cam.dirY + cam.planeY * (1 / W - 1);
    var sx = cam.planeX * 2 / W, sy = cam.planeY * 2 / W;
    for (y = 0; y < H; y++) {
      var floor = y >= half, p = floor ? (y + 0.5 - half) : (half - y - 0.5);
      var rowDist = 0.5 * focal / p, fog = Math.exp(-rowDist * (floor ? 0.2 : 0.3));
      var wx = cam.x + rowDist * dx0, wy = cam.y + rowDist * dy0, stx = rowDist * sx, sty = rowDist * sy;
      var o = y * W * 4;
      if (floor) {
        // Footlights: the boards glow amber nearest the audience and fall away into the dark.
        var light = 0.1 + 1.25 * Math.exp(-rowDist * 0.3);
        for (x = 0; x < W; x++, wx += stx, wy += sty, o += 4) {
          var t = 1;
          if (tex) {
            var py = wy * 4, plank = Math.floor(py), fy = py - plank;
            var bxw = wx * 0.5 + hash(plank, 0, 7) * 2, board = Math.floor(bxw);
            t = 0.82 + hash(plank, board, 8) * 0.3;
            if (fy < 0.07 || bxw - board < 0.012) t *= 0.45;
          }
          var k = t * light;
          d[o] = 108 * k + FOG[0] * (1 - fog); d[o + 1] = 68 * k + FOG[1] * (1 - fog); d[o + 2] = 38 * k + FOG[2] * (1 - fog); d[o + 3] = 255;
        }
      } else {
        // The fly tower: black, crossed by the lighting grid's battens.
        for (x = 0; x < W; x++, wx += stx, wy += sty, o += 4) {
          var c0 = 26, c1 = 19, c2 = 21;
          if (tex && (wx - Math.floor(wx) < 0.035 || wy - Math.floor(wy) < 0.035)) { c0 = 74; c1 = 60; c2 = 54; }
          d[o] = c0 * fog + FOG[0] * (1 - fog); d[o + 1] = c1 * fog + FOG[1] * (1 - fog); d[o + 2] = c2 * fog + FOG[2] * (1 - fog); d[o + 3] = 255;
        }
      }
    }

    // Walls: one slice per column, its height the focal length divided by the distance.
    for (x = 0; x < W; x++) {
      var dist = frame.dist[x], lh = focal / Math.max(dist, 1e-4), top = half - lh / 2;
      var y0 = Math.max(0, Math.floor(top)), y1 = Math.min(H, Math.ceil(top + lh));
      var tile = frame.tile[x], T = TEXTURES[tile] || BRICK_TEX, flat = FLAT[tile] || FLAT[1];
      var wf = Math.exp(-dist * 0.12), side = frame.side[x] ? 0.74 : 1;
      var tx = Math.min(TEX - 1, Math.floor(frame.u[x] * TEX));
      for (y = y0; y < y1; y++) {
        var v = (y + 0.5 - top) / lh, ty = Math.min(TEX - 1, Math.max(0, Math.floor(v * TEX)));
        var lift = (0.82 + 0.3 * v) * side * wf, j = (ty * TEX + tx) * 4, r, g, b;
        if (tex) {
          if (T[j + 3] === 254) { r = T[j]; g = T[j + 1]; b = T[j + 2]; lift = Math.max(lift, 0.92); }
          else { r = T[j]; g = T[j + 1]; b = T[j + 2]; }
        } else { r = flat[0]; g = flat[1]; b = flat[2]; }
        i = (y * W + x) * 4;
        d[i] = r * lift + FOG[0] * (1 - wf); d[i + 1] = g * lift + FOG[1] * (1 - wf); d[i + 2] = b * lift + FOG[2] * (1 - wf);
      }
    }

    // Sprites: far to near, each column drawn only where it is nearer than the wall in that column.
    var list = [];
    sprites.forEach(function (s) {
      var pr = C.projectSprite(cam, s.x, s.y, W, opts.correct);
      if (pr.depth > 0.18) list.push({ s: s, p: pr });
    });
    list.sort(function (a, b) { return b.p.depth - a.p.depth; });
    list.forEach(function (it) {
      var s = it.s, pr = it.p, size = focal * s.size / pr.scaleDist;
      var cy = half + focal * (0.5 - s.z) / pr.scaleDist, left = pr.screenX - size / 2, topS = cy - size / 2;
      var xa = Math.max(0, Math.floor(left)), xb = Math.min(W, Math.ceil(left + size));
      var ya = Math.max(0, Math.floor(topS)), yb = Math.min(H, Math.ceil(topS + size));
      var sf = Math.exp(-pr.depth * 0.12);
      for (var sxp = xa; sxp < xb; sxp++) {
        if (pr.depth >= frame.perp[sxp]) continue;
        var u = Math.min(SPR - 1, Math.max(0, Math.floor((sxp + 0.5 - left) / size * SPR)));
        for (var syp = ya; syp < yb; syp++) {
          var vv = Math.min(SPR - 1, Math.max(0, Math.floor((syp + 0.5 - topS) / size * SPR)));
          var q = (vv * SPR + u) * 4, a = s.tex[q + 3];
          if (!a) continue;
          var kk = a === 254 ? 1 : sf, ii = (syp * W + sxp) * 4;
          d[ii] = s.tex[q] * kk + FOG[0] * (1 - kk); d[ii + 1] = s.tex[q + 1] * kk + FOG[1] * (1 - kk); d[ii + 2] = s.tex[q + 2] * kk + FOG[2] * (1 - kk);
        }
      }
    });

    // With correction off, a dotted chalk line marks where each slice's top and bottom would be with
    // the straight-ahead distance. The gap between it and the painted edge is the fish-eye bulge.
    if (opts.outline) {
      for (x = 0; x < W; x++) {
        if ((x >> 1) & 1) continue;
        var hc = focal / Math.max(frame.perp[x], 1e-4);
        if (hc >= H - 2) continue;
        var yt = Math.round(half - hc / 2), yb = Math.round(half + hc / 2) - 1;
        [yt, yb].forEach(function (yy) {
          if (yy < 0 || yy >= H) return;
          var oi = (yy * W + x) * 4; d[oi] = 236; d[oi + 1] = 230; d[oi + 2] = 214;
        });
      }
    }

    // The zap beam: a short-lived amber line from the hand to the aim point.
    if (opts.beam > 0) {
      var bx0 = W * 0.62, by0 = H - 1, bx1 = W / 2, by1 = half + 2, steps = 90;
      for (var n = 0; n <= steps; n++) {
        var f = n / steps, px = Math.round(bx0 + (bx1 - bx0) * f), pyy = Math.round(by0 + (by1 - by0) * f);
        for (var w = -1; w <= 1; w++) {
          if (px + w < 0 || px + w >= W) continue;
          var bi = (pyy * W + px + w) * 4, al = opts.beam * (w ? 0.45 : 0.85);
          d[bi] = d[bi] + (242 - d[bi]) * al; d[bi + 1] = d[bi + 1] + (160 - d[bi + 1]) * al; d[bi + 2] = d[bi + 2] + (60 - d[bi + 2]) * al;
        }
      }
    }

    // A spike mark (the tape cross that marks a spot on a stage floor) shows where the beam aims.
    if (opts.crosshair) {
      var cx = (W / 2) | 0, cyy = half | 0;
      for (var m = 2; m <= 4; m++) [[cx + m, cyy], [cx - m, cyy], [cx, cyy + m], [cx, cyy - m]].forEach(function (pt) {
        var ci = (pt[1] * W + pt[0]) * 4; d[ci] = 242; d[ci + 1] = 179; d[ci + 2] = 90;
      });
    }

    // Slow motion: columns not yet painted stay dark; the column being painted is tinted amber.
    if (opts.painted < W) {
      for (x = Math.max(0, Math.floor(opts.painted)); x < W; x++) for (y = 0; y < H; y++) {
        i = (y * W + x) * 4; d[i] = 8; d[i + 1] = 6; d[i + 2] = 7;
      }
    }
    if (opts.mark >= 0 && opts.mark < W) {
      for (y = 0; y < H; y++) {
        i = (y * W + opts.mark) * 4;
        d[i] = d[i] * 0.15 + 242 * 0.85; d[i + 1] = d[i + 1] * 0.15 + 179 * 0.85; d[i + 2] = d[i + 2] * 0.15 + 90 * 0.85;
      }
    }
  }

  // ------------------------------------------------------------------ the ground plan
  var hatch = null;
  function hatchPattern(ctx) {
    if (hatch) return hatch;
    var c = document.createElement('canvas'), n = Math.round(7 * DPR);
    c.width = c.height = n;
    var g = c.getContext('2d');
    g.strokeStyle = 'rgba(236,230,214,0.13)'; g.lineWidth = DPR;
    g.beginPath(); g.moveTo(0, n); g.lineTo(n, 0); g.moveTo(-1, 1); g.lineTo(1, -1); g.moveTo(n - 1, n + 1); g.lineTo(n + 1, n - 1); g.stroke();
    hatch = ctx.createPattern(c, 'repeat');
    return hatch;
  }
  // o: { map, cam, frame, every, painted, highlight, keys, drones, exit, view: {ox, oy, s},
  //      seen (optional: tiles some ray has reached; anything else stays blank) }   (CSS px)
  function drawPlan(ctx, cw, ch, o) {
    var m = o.map, s = o.view.s, ox = o.view.ox, oy = o.view.oy, x, y, seen = o.seen;
    function known(tx, ty) { return !seen || (tx >= 0 && ty >= 0 && tx < m.w && ty < m.h && seen[ty * m.w + tx] === 1); }
    function X(v) { return ox + v * s; }
    function Y(v) { return oy + v * s; }
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = SLATE; ctx.fillRect(0, 0, cw, ch);
    var xa = Math.max(0, Math.floor(-ox / s)), xb = Math.min(m.w, Math.ceil((cw - ox) / s));
    var ya = Math.max(0, Math.floor(-oy / s)), yb = Math.min(m.h, Math.ceil((ch - oy) / s));

    // Walls: sectioned (hatched), with chalk edges only where a wall faces open floor.
    ctx.fillStyle = hatchPattern(ctx);
    ctx.beginPath();
    for (y = ya; y < yb; y++) for (x = xa; x < xb; x++) if (C.tileAt(m, x, y) !== C.EMPTY && known(x, y)) ctx.rect(X(x), Y(y), s, s);
    ctx.fill();
    ctx.strokeStyle = 'rgba(236,230,214,0.08)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (y = ya; y < yb; y++) for (x = xa; x < xb; x++) if (C.tileAt(m, x, y) === C.EMPTY && known(x, y)) ctx.rect(X(x) + 0.5, Y(y) + 0.5, s, s);
    ctx.stroke();
    ctx.strokeStyle = CHALK; ctx.lineWidth = Math.max(1.25, s * 0.08); ctx.lineCap = 'round';
    ctx.beginPath();
    for (y = ya; y < yb; y++) for (x = xa; x < xb; x++) {
      if (C.tileAt(m, x, y) === C.EMPTY || !known(x, y)) continue;
      if (C.tileAt(m, x, y - 1) === C.EMPTY) { ctx.moveTo(X(x), Y(y)); ctx.lineTo(X(x + 1), Y(y)); }
      if (C.tileAt(m, x, y + 1) === C.EMPTY) { ctx.moveTo(X(x), Y(y + 1)); ctx.lineTo(X(x + 1), Y(y + 1)); }
      if (C.tileAt(m, x - 1, y) === C.EMPTY) { ctx.moveTo(X(x), Y(y)); ctx.lineTo(X(x), Y(y + 1)); }
      if (C.tileAt(m, x + 1, y) === C.EMPTY) { ctx.moveTo(X(x + 1), Y(y)); ctx.lineTo(X(x + 1), Y(y + 1)); }
    }
    ctx.stroke();

    // The exit: drawn as an architect draws a door, a leaf and its swing.
    if (o.exit && known(o.exit.x, o.exit.y)) {
      var e = o.exit, a = o.exitApproach, hx, hy, lx, ly, sa, ea;
      ctx.fillStyle = SLATE; ctx.fillRect(X(e.x) + 1, Y(e.y) + 1, s - 2, s - 2);
      if (a.y < e.y) { hx = e.x; hy = e.y; lx = e.x; ly = e.y - 1; sa = -Math.PI / 2; ea = 0; }
      else if (a.y > e.y) { hx = e.x; hy = e.y + 1; lx = e.x; ly = e.y + 2; sa = 0; ea = Math.PI / 2; }
      else if (a.x < e.x) { hx = e.x; hy = e.y; lx = e.x - 1; ly = e.y; sa = Math.PI; ea = Math.PI * 1.5; }
      else { hx = e.x + 1; hy = e.y + 1; lx = e.x + 2; ly = e.y + 1; sa = 0; ea = Math.PI / 2; }
      ctx.strokeStyle = CHALK; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(X(hx), Y(hy)); ctx.lineTo(X(lx), Y(ly)); ctx.stroke();
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.arc(X(hx), Y(hy), s, Math.min(sa, ea), Math.max(sa, ea)); ctx.stroke();
      ctx.setLineDash([]);
      if (s >= 14) {
        ctx.font = '11px "Cutive Mono", "Courier New", monospace'; ctx.fillStyle = CHALK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        var tx0 = X(e.x + 0.5), ty0 = Y(e.y + 0.5);
        ctx.fillStyle = SLATE; ctx.fillRect(tx0 - 15, ty0 - 7, 30, 14);
        ctx.fillStyle = CHALK; ctx.fillText('EXIT', tx0, ty0 + 0.5);
      }
    }

    // Keys and follow-spots, as symbols on a lighting plot.
    ctx.lineWidth = 1.5;
    (o.keys || []).forEach(function (k) {
      if (k.taken || !known(Math.floor(k.x), Math.floor(k.y))) return;
      var kx = X(k.x), ky = Y(k.y), r = Math.max(3, s * 0.16);
      ctx.strokeStyle = AMBER;
      ctx.beginPath(); ctx.arc(kx - r, ky, r, 0, Math.PI * 2); ctx.moveTo(kx, ky); ctx.lineTo(kx + r * 2.2, ky); ctx.moveTo(kx + r * 1.6, ky); ctx.lineTo(kx + r * 1.6, ky + r); ctx.stroke();
    });
    (o.drones || []).forEach(function (dr) {
      var dx = X(dr.x), dy = Y(dr.y), r = Math.max(4, s * 0.26);
      ctx.strokeStyle = CHALK; ctx.fillStyle = SLATE;
      if (dr.stun > 0) ctx.setLineDash([2, 2]);
      ctx.beginPath(); ctx.arc(dx, dy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(dx - r * 0.6, dy - r * 0.6); ctx.lineTo(dx + r * 0.6, dy + r * 0.6); ctx.moveTo(dx + r * 0.6, dy - r * 0.6); ctx.lineTo(dx - r * 0.6, dy + r * 0.6); ctx.stroke();
    });

    // Rays: one per screen column; every Nth is drawn, out to where it met a wall.
    var cam = o.cam, f = o.frame, W = f.w, P = [X(cam.x), Y(cam.y)];
    var lim = Math.min(W, Math.ceil(o.painted));
    ctx.strokeStyle = 'rgba(236,230,214,0.42)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (x = 0; x < lim; x += o.every) { ctx.moveTo(P[0], P[1]); ctx.lineTo(X(f.hitX[x]), Y(f.hitY[x])); }
    ctx.stroke();
    // The two edge rays bound the field of view.
    ctx.strokeStyle = CHALK; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(X(f.hitX[0]), Y(f.hitY[0])); ctx.lineTo(P[0], P[1]);
    if (lim >= W) ctx.lineTo(X(f.hitX[W - 1]), Y(f.hitY[W - 1]));
    ctx.stroke();
    // The screen: the camera plane one tile ahead, which every ray passes through.
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(X(cam.x + cam.dirX - cam.planeX), Y(cam.y + cam.dirY - cam.planeY));
    ctx.lineTo(X(cam.x + cam.dirX + cam.planeX), Y(cam.y + cam.dirY + cam.planeY));
    ctx.stroke();
    ctx.setLineDash([]);

    // One ray traced in full: the ray, and its distance measured straight ahead (dashed).
    var hcol = o.highlight;
    if (hcol >= 0 && hcol < W) {
      var Hx = X(f.hitX[hcol]), Hy = Y(f.hitY[hcol]), t = f.perp[hcol];
      var Qx = X(cam.x + cam.dirX * t), Qy = Y(cam.y + cam.dirY * t);
      ctx.strokeStyle = AMBER; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(P[0], P[1]); ctx.lineTo(Qx, Qy); ctx.lineTo(Hx, Hy); ctx.stroke();
      ctx.setLineDash([]); ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(P[0], P[1]); ctx.lineTo(Hx, Hy); ctx.stroke();
      ctx.fillStyle = AMBER; ctx.beginPath(); ctx.arc(Hx, Hy, 3.2, 0, Math.PI * 2); ctx.fill();
    }

    // The seat: you.
    var pr = Math.max(4, Math.min(9, s * 0.2));
    ctx.fillStyle = WING; ctx.strokeStyle = CHALK; ctx.lineWidth = 1.75;
    ctx.beginPath(); ctx.arc(P[0], P[1], pr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(P[0], P[1]); ctx.lineTo(P[0] + cam.dirX * pr * 1.9, P[1] + cam.dirY * pr * 1.9); ctx.stroke();
  }

  function fitCanvas(canvas) {
    var r = canvas.getBoundingClientRect(), w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    var pw = Math.round(w * DPR), ph = Math.round(h * DPR);
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
    return { w: w, h: h };
  }

  var fpCanvas = $('co-fp'), fpCtx = fpCanvas.getContext('2d');
  var mapCanvas = $('co-map'), mapCtx = mapCanvas.getContext('2d');
  var house = $('co-house'), plan = $('co-plan');

  if (Kit.preview) { runPreview(); return; }

  // ================================================================== the game page
  var W = 320;
  var img = fpCtx.createImageData(W, H), frame = null;
  var view = $('co-view'), curtain = $('co-curtain'), prompt = $('co-prompt');
  var ui = {
    keys: $('co-keys'), time: $('co-time'), best: $('co-best'), trick: $('co-trick'), restart: $('co-restart'),
    go: $('co-go'), cardTitle: $('co-card-title'), cardText: $('co-card-text'), desk: $('co-desk'),
    slow: $('co-slow'), fish: $('co-fish'), tex: $('co-tex'), fov: $('co-fov'), fovOut: $('co-fov-out'),
    slowNote: $('co-slow-note'), fishNote: $('co-fish-note'), texNote: $('co-tex-note'), fovNote: $('co-fov-note'),
    sheet: $('co-sheet-live')
  };
  var BEST_KEY = 'corridor.best.v1.' + C.DEFAULT_SEED;
  var st = {
    game: C.createGame(C.DEFAULT_SEED), running: false, split: false, slow: false, painted: W, holdPainted: 0,
    correct: true, textures: true, fov: 66, inspect: -1, beam: 0, clock: 0, best: null, everTrick: false,
    raisedAt: -1, promptUntil: 0, hudKey: '', sheetKey: '', zapQueued: false, look: 0
  };
  var held = {};
  var drones = [];           // per-drone drawing state (height, for the sink when dimmed)
  var seen = null;           // tiles some ray has reached: the plan shows only these
  var TRACE = 40;            // the column traced on the plan unless you point at another: off-centre,
                             // so its straight-line and straight-ahead distances visibly differ
  var PLAN_SPAN = 8;         // tiles across the plan's window

  try { var b = parseFloat(window.localStorage.getItem(BEST_KEY)); if (isFinite(b) && b > 0) st.best = b; } catch (e) { /* storage unavailable */ }

  function fmt(t) {
    var m = Math.floor(t / 60), s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  }
  function say(text, secs) {
    prompt.textContent = text;
    st.promptUntil = st.clock + (secs || 3.2);
  }

  function resetGame() {
    st.game = C.createGame(C.DEFAULT_SEED);
    drones = st.game.drones.map(function () { return { z: 0.62 }; });
    seen = new Uint8Array(st.game.map.w * st.game.map.h);
    st.hudKey = '';
  }
  resetGame();

  function raise() {
    if (st.game.won) resetGame();
    curtain.classList.add('is-up');
    st.running = true;
    st.raisedAt = st.clock;
    try { view.focus({ preventScroll: true }); } catch (e) { view.focus(); }
    say('Find three keys. The stage door is marked EXIT.', 4);
  }
  function lower(title, text, button) {
    ui.cardTitle.textContent = title; ui.cardText.textContent = text; ui.go.textContent = button;
    curtain.classList.remove('is-up');
    st.running = false;
    setTimeout(function () { try { ui.go.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 50);
  }

  // ------------------------------------------------------------------ toggles and their microcopy
  function notes() {
    ui.slowNote.textContent = st.slow
      ? 'The game waits while one frame is painted, a column at a time. Walk to resume.'
      : 'Watch one frame draw, one ray at a time.';
    ui.fishNote.textContent = st.correct
      ? 'On: flat walls stay flat. Switch off to compare.'
      : 'Off: longer edge rays make flat walls look curved.';
    ui.texNote.textContent = st.textures
      ? 'On: the ray picks a slice of the wall’s texture.'
      : 'Off: walls use flat colours and simple shading.';
    var focal = C.focalPx(W, C.makeCamera(0, 0, 0, st.fov));
    ui.fovOut.textContent = st.fov + '°';
    ui.fovNote.textContent = 'The same ' + W + ' rays, fanned wider or narrower. A wall 1 tile away is now ' + Math.round(focal) + ' px tall; each slice is that divided by its distance.';
  }
  function press(btn, on) { btn.setAttribute('aria-pressed', on ? 'true' : 'false'); }
  // On a phone only the note of the cue last touched is shown, so the desk fits under the view.
  function active(el) {
    Array.prototype.forEach.call(document.querySelectorAll('.co-toggle'), function (t) { t.classList.toggle('is-active', t.contains(el)); });
  }
  function setSplit(on) {
    st.split = on;
    press(ui.trick, on);
    house.classList.toggle('is-split', on);
    plan.hidden = !on; ui.desk.hidden = !on;
    if (on && !st.everTrick) { st.everTrick = true; ui.trick.classList.remove('is-standby'); }
    if (!on) { setSlow(false); st.inspect = -1; }
    st.sheetKey = '';
  }
  function setSlow(on) {
    if (st.slow === on) return;
    st.slow = on; press(ui.slow, on);
    st.painted = on ? 0 : W; st.holdPainted = 0;
    notes();
  }
  ui.trick.addEventListener('click', function () { setSplit(!st.split); });
  ui.restart.addEventListener('click', function () { resetGame(); setSlow(false); raise(); });
  ui.go.addEventListener('click', raise);
  ui.slow.addEventListener('click', function () { setSlow(!st.slow); active(ui.slow); });
  ui.fish.addEventListener('click', function () { st.correct = !st.correct; press(ui.fish, st.correct); notes(); st.sheetKey = ''; active(ui.fish); });
  ui.tex.addEventListener('click', function () { st.textures = !st.textures; press(ui.tex, st.textures); notes(); active(ui.tex); });
  ui.fov.addEventListener('input', function () { st.fov = +ui.fov.value; notes(); st.sheetKey = ''; active(ui.fov); });
  active(ui.fish);
  notes();

  // ------------------------------------------------------------------ input
  var CODES = {
    KeyW: 'fwd', ArrowUp: 'fwd', KeyS: 'back', ArrowDown: 'back',
    KeyA: 'turnL', ArrowLeft: 'turnL', KeyD: 'turnR', ArrowRight: 'turnR', KeyQ: 'strL', KeyE: 'strR'
  };
  var stage = document.querySelector('[data-kit-stage]');
  stage.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var tag = e.target.tagName, onRange = e.target.type === 'range', onButton = tag === 'BUTTON';
    if (onRange && /^Arrow/.test(e.code)) return;
    if (e.code === 'KeyT') { setSplit(!st.split); e.preventDefault(); return; }
    if ((e.code === 'Space' || e.code === 'Enter') && onButton) return;
    var act = CODES[e.code];
    if (e.code === 'Space' || e.code === 'KeyF') act = 'zap';
    if (!act) return;
    e.preventDefault();
    if (!st.running) { if (!st.game.won && e.target === view) raise(); return; }
    if (act === 'zap') { if (!e.repeat) st.zapQueued = true; return; }
    held[act] = true;
  });
  window.addEventListener('keyup', function (e) {
    var act = CODES[e.code];
    if (act) held[act] = false;
  });
  window.addEventListener('blur', function () { held = {}; });

  // Drag across the stage to look; in the split view, pointing at a column traces its ray.
  var drag = null;
  function colAt(e) {
    var r = fpCanvas.getBoundingClientRect();
    return Math.max(0, Math.min(W - 1, Math.floor((e.clientX - r.left) / r.width * W)));
  }
  view.addEventListener('pointerdown', function (e) {
    if (!curtain.classList.contains('is-up')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag = { id: e.pointerId, x: e.clientX, moved: 0 };
    try { view.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    if (st.split) st.inspect = colAt(e);
    view.focus({ preventScroll: true });
  });
  view.addEventListener('pointermove', function (e) {
    if (st.split && !st.slow) st.inspect = colAt(e);
    if (!drag || drag.id !== e.pointerId) return;
    var r = fpCanvas.getBoundingClientRect(), dx = e.clientX - drag.x;
    drag.x = e.clientX; drag.moved += Math.abs(dx);
    if (st.running) st.look += dx / r.width * (100 * Math.PI / 180);
  });
  function endDrag(e) { if (drag && drag.id === e.pointerId) drag = null; }
  view.addEventListener('pointerup', endDrag);
  view.addEventListener('pointercancel', endDrag);
  view.addEventListener('pointerleave', function () { if (!drag && !st.slow) st.inspect = -1; });

  // Touch pad: hold to walk or turn.
  Array.prototype.forEach.call(document.querySelectorAll('.co-key'), function (btn) {
    var act = btn.getAttribute('data-hold');
    function on(e) {
      e.preventDefault();
      if (!st.running) { if (!st.game.won) raise(); }
      btn.classList.add('is-held');
      if (act === 'zap') st.zapQueued = true; else held['pad_' + act] = true;
      try { btn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }
    function off() { btn.classList.remove('is-held'); held['pad_' + act] = false; }
    btn.addEventListener('pointerdown', on);
    btn.addEventListener('pointerup', off);
    btn.addEventListener('pointercancel', off);
    btn.addEventListener('lostpointercapture', off);
    btn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    btn.addEventListener('click', function (e) { if (e.detail === 0 && act === 'zap') st.zapQueued = true; });
  });

  function input() {
    function h(a) { return held[a] || held['pad_' + a] ? 1 : 0; }
    var inp = { move: h('fwd') - h('back'), turn: h('turnR') - h('turnL'), strafe: h('strR') - h('strL'), look: st.look, zap: st.zapQueued, hold: st.split };
    st.look = 0; st.zapQueued = false;
    return inp;
  }

  // ------------------------------------------------------------------ events from the model
  var WORDS = ['No', 'One', 'Two', 'Three'];
  function handle(events) {
    events.forEach(function (ev) {
      if (ev.type === 'key') {
        var left = 3 - ev.count;
        say(left ? 'Key found. ' + WORDS[left] + ' to go.' : 'Key found: that is all three. Now find the stage door.');
        if (ev.count === 1 && !st.everTrick) nudge();
      } else if (ev.type === 'caught') {
        say('A follow-spot caught you in its light: ' + ev.penalty + ' seconds added.');
      } else if (ev.type === 'locked') {
        say('The stage door is locked. ' + WORDS[ev.missing] + (ev.missing === 1 ? ' key' : ' keys') + ' to go.');
      } else if (ev.type === 'zap') {
        st.beam = 1;
        if (ev.index >= 0) say('Dimmed. It relights in a few seconds.', 2.2);
        else if (ev.beyond) say('Out of reach: the beam carries ' + C.ZAP_RANGE + ' tiles.', 2.2);
      } else if (ev.type === 'win') {
        var total = ev.total, isBest = st.best === null || total < st.best;
        if (isBest) { st.best = total; try { window.localStorage.setItem(BEST_KEY, String(total)); } catch (e) { /* storage unavailable */ } }
        var pen = st.game.penalty ? ' (' + st.game.penalty + ' s of it from follow-spots)' : '';
        lower('Curtain', 'You found the way out in ' + fmt(total) + pen + '. ' + (isBest ? 'That is your best time.' : 'Your best is ' + fmt(st.best) + '.'), 'Play again');
        say('');
      }
    });
  }
  function nudge() {
    if (st.everTrick) return;
    ui.trick.classList.add('is-standby');
    say('Standing by: press T, or Show the trick, to see how this view is drawn.', 5);
  }

  // ------------------------------------------------------------------ drawing
  function sprites(g, t) {
    var out = [];
    g.keys.forEach(function (k, i) { if (!k.taken) out.push({ x: k.x, y: k.y, z: 0.42 + 0.035 * Math.sin(t * 2.2 + i * 2), size: 0.32, tex: KEY_SPR }); });
    g.drones.forEach(function (d, i) {
      var target = d.stun > 0 ? 0.22 : 0.62 + 0.04 * Math.sin(t * 1.6 + i);
      var ds = drones[i]; ds.z += (target - ds.z) * 0.08;
      out.push({ x: d.x, y: d.y, z: ds.z, size: 0.44, tex: d.stun > 0 ? DRONE_DIM : DRONE_LIT });
    });
    return out;
  }
  function sheet(col) {
    var cam = st.cam, f = frame, focal = C.focalPx(W, cam);
    var ang = Math.atan(C.cameraX(col, W) * cam.planeLen) * 180 / Math.PI;
    var side = Math.abs(ang) < 0.05 ? 'dead ahead' : Math.abs(ang).toFixed(1) + '° ' + (ang < 0 ? 'left' : 'right') + ' of centre';
    var sum = C.sheetSum(focal, f.dist[col]);
    var key = col + '|' + sum.dist + '|' + sum.focal + '|' + st.correct + '|' + f.perp[col].toFixed(2) + '|' + f.euclid[col].toFixed(2);
    if (key === st.sheetKey) return;
    st.sheetKey = key;
    ui.sheet.textContent = 'Column ' + (col + 1) + ' of ' + W + ', ' + side + '. Its ray meets a wall ' + f.perp[col].toFixed(2) +
      ' tiles ahead (' + f.euclid[col].toFixed(2) + ' in a straight line), so the slice is ' + sum.focal + ' ÷ ' + sum.dist + ' = ' + sum.height + ' px tall' +
      (st.correct ? '.' : ', using the straight-line distance.');
  }
  var planSize = null;
  function draw() {
    var g = st.game, p = g.player;
    var cam = st.cam = C.makeCamera(p.x, p.y, p.a, st.fov);
    frame = C.castFrame(g.map, cam, W, st.correct, frame);
    if (st.running) remember(g.map, cam);
    var hl = st.slow ? Math.min(W - 1, Math.floor(st.painted)) : (st.inspect >= 0 ? st.inspect : TRACE);
    renderView(img, g.map, cam, frame, {
      textures: st.textures, correct: st.correct, painted: st.slow ? st.painted : W, mark: st.split ? hl : -1,
      crosshair: st.running, beam: st.beam, outline: !st.correct
    }, sprites(g, st.clock));
    fpCtx.putImageData(img, 0, 0);
    if (st.split) {
      if (!planSize) planSize = fitCanvas(mapCanvas);
      var cw = planSize.w, ch = planSize.h;
      drawPlan(mapCtx, cw, ch, {
        map: g.map, cam: cam, frame: frame, every: 8, painted: st.slow ? st.painted : W, highlight: hl,
        keys: g.keys, drones: inView(g.drones, cam), exit: g.level.exit, exitApproach: g.level.exitApproach,
        view: C.planWindow(cw, ch, g.map.w, g.map.h, cam.x, cam.y, PLAN_SPAN), seen: seen
      });
      sheet(hl);
    }
  }
  // Every tile a ray has crossed or struck goes on the plan, so it fills in as you look about.
  function remember(m, cam) {
    var f = frame;
    seen[Math.floor(cam.y) * m.w + Math.floor(cam.x)] = 1;
    for (var x = 0; x < W; x++) {
      if (f.mapX[x] >= 0 && f.mapY[x] >= 0 && f.mapX[x] < m.w && f.mapY[x] < m.h) seen[f.mapY[x] * m.w + f.mapX[x]] = 1;
      if (x & 3) continue;
      var len = f.euclid[x], ux = (f.hitX[x] - cam.x) / Math.max(len, 1e-9), uy = (f.hitY[x] - cam.y) / Math.max(len, 1e-9);
      for (var t = 0.3; t < len; t += 0.3) seen[Math.floor(cam.y + uy * t) * m.w + Math.floor(cam.x + ux * t)] = 1;
    }
  }
  // Drones go on the plan only while you can see them on stage: in the field of view, nearer than the wall.
  function inView(list, cam) {
    return list.filter(function (d) {
      var pr = C.projectSprite(cam, d.x, d.y, W, true), col = Math.floor(pr.screenX);
      return pr.depth > 0.18 && col >= 0 && col < W && pr.depth < frame.perp[col];
    });
  }
  function hud() {
    var g = st.game, n = C.keysTaken(g), total = g.time + g.penalty;
    var key = n + '|' + total.toFixed(1) + '|' + st.best;
    if (key === st.hudKey) return;
    st.hudKey = key;
    ui.keys.innerHTML = '<span class="co-keyglyphs" aria-hidden="true">' + '◆◆◆'.slice(0, n) + '◇◇◇'.slice(0, 3 - n) + '</span>' + n + ' of 3';
    ui.time.textContent = fmt(total);
    ui.best.textContent = st.best === null ? 'none yet' : fmt(st.best);
  }

  // ------------------------------------------------------------------ the loop
  var raf = 0, last = 0;
  function tick(now) {
    raf = requestAnimationFrame(tick);
    var dt = last ? Math.max(0, Math.min(0.05, (now - last) / 1000)) : 0;
    last = now;
    st.clock += dt;
    var inp = input();
    if (st.slow && (inp.move || inp.turn || inp.strafe || inp.look)) setSlow(false);
    if (st.running && !st.slow) handle(C.stepGame(st.game, inp, dt));
    if (st.slow) {
      if (st.painted < W) st.painted = Math.min(W, st.painted + dt * 48);
      else if ((st.holdPainted += dt) > 1.6) { st.painted = 0; st.holdPainted = 0; }
    }
    st.beam = Math.max(0, st.beam - dt * 6);
    if (st.running && !st.everTrick && st.raisedAt >= 0 && st.clock - st.raisedAt > 14 && !ui.trick.classList.contains('is-standby')) nudge();
    if (prompt.textContent && st.clock > st.promptUntil) prompt.textContent = '';
    draw();
    hud();
  }
  function start() { if (!raf) { last = 0; raf = requestAnimationFrame(tick); } }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; held = {}; }

  var onResize = function () { planSize = null; };
  window.addEventListener('resize', onResize);
  if (window.ResizeObserver) new ResizeObserver(onResize).observe(mapCanvas);

  draw(); hud();
  Kit.onPlay(function (playing) { if (playing) start(); else { stop(); draw(); } });

  // ================================================================== the card preview
  // A walk down a hand-made corridor. Every ten seconds the stage splits, one frame is painted
  // column by column while its rays fan across the plan, and then the walk carries on.
  function runPreview() {
    var set = C.previewSet(), LOOP = 10, STILL = 6.6;
    var pimg = null, pframe = null, pW = 0, split = null, psize = null;
    var flyers = [{ x: 3.2, y: 6.5, stun: 0 }, { x: 5.6, y: 2.8, stun: 0 }];

    function layout(on) {
      if (split === on) return;
      split = on;
      house.classList.toggle('is-split', on);
      plan.hidden = !on;
      psize = null; pW = 0;
    }
    function sizeView() {
      var r = fpCanvas.getBoundingClientRect(), w = Math.max(60, Math.round(H * r.width / Math.max(1, r.height)));
      if (w !== pW) {
        pW = w; fpCanvas.width = w; fpCanvas.height = H;
        pimg = fpCtx.createImageData(w, H);
      }
    }
    function at(t) {
      var on = t >= 3.4 && t < 9.4;
      layout(on);
      sizeView();
      // The walk pauses while the frame is painted, then carries on.
      var wt = t < 3.4 ? t : (t < 5.9 ? 3.4 : t - 2.5);
      var y = set.path.y0 - (set.path.y0 - set.path.y1) * Math.min(1, wt / 7.5);
      var a = -Math.PI / 2 + 0.13 * Math.sin(t * 0.9 + 0.4);
      var cam = C.makeCamera(set.path.x, y, a, 66);
      pframe = C.castFrame(set.map, cam, pW, true, pframe);
      flyers[0].x = 4.5 + 1.7 * Math.sin(t * 0.8); flyers[1].x = 4.5 + 0.9 * Math.sin(t * 0.6 + 1);
      var spr = [{ x: set.keys[0].x, y: set.keys[0].y, z: 0.42 + 0.035 * Math.sin(t * 2.2), size: 0.32, tex: KEY_SPR }];
      flyers.forEach(function (f, i) { spr.push({ x: f.x, y: f.y, z: 0.62 + 0.04 * Math.sin(t * 1.6 + i), size: 0.44, tex: DRONE_LIT }); });
      var painted = on ? Math.max(0, Math.min(pW, (t - 3.6) / 2.2 * pW)) : pW;
      var mark = on && painted < pW ? Math.floor(painted) : -1;
      renderView(pimg, set.map, cam, pframe, { textures: true, correct: true, painted: painted, mark: mark, crosshair: false, beam: 0 }, spr);
      // Blackout between loops, as between scenes.
      var black = t > 9.5 ? (t - 9.5) / 0.5 : (t < 0.4 ? 1 - t / 0.4 : 0);
      if (black > 0) {
        var dd = pimg.data, k = 1 - Math.min(1, black);
        for (var i = 0; i < dd.length; i += 4) { dd[i] *= k; dd[i + 1] *= k; dd[i + 2] *= k; }
      }
      fpCtx.putImageData(pimg, 0, 0);
      if (on) {
        if (!psize) psize = fitCanvas(mapCanvas);
        var cw = psize.w, ch = psize.h, s = cw / (set.map.w + 0.4);
        var oy = Math.max(ch - set.map.h * s, Math.min(0, ch * 0.74 - cam.y * s));
        drawPlan(mapCtx, cw, ch, {
          map: set.map, cam: cam, frame: pframe, every: Math.max(3, Math.round(pW / 32)), painted: painted, highlight: mark,
          keys: [{ x: set.keys[0].x, y: set.keys[0].y }], drones: flyers, exit: null,
          view: { s: s, ox: (cw - set.map.w * s) / 2, oy: oy }
        });
        if (black > 0) { mapCtx.setTransform(1, 0, 0, 1, 0, 0); mapCtx.fillStyle = 'rgba(0,0,0,' + Math.min(1, black) + ')'; mapCtx.fillRect(0, 0, mapCanvas.width, mapCanvas.height); }
      }
    }

    var raf2 = 0, t0 = 0;
    function loop(now) {
      raf2 = requestAnimationFrame(loop);
      if (!t0) t0 = now - STILL * 1000;
      at((Math.max(0, now - t0) / 1000) % LOOP);
    }
    window.addEventListener('resize', function () { psize = null; pW = 0; if (!raf2) at(STILL); });
    Kit.onPlay(function (playing) {
      if (playing) { if (!raf2) { t0 = 0; raf2 = requestAnimationFrame(loop); } }
      else { if (raf2) cancelAnimationFrame(raf2); raf2 = 0; at(STILL); }
    });
  }
})();
