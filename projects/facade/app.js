// Facade: the drive, the ten cases and the two scores. Scoring and geometry live in model.js.
(function () {
  'use strict';

  var F = window.Facade;
  var CASES = window.FacadeCases;
  var Kit = window.Kit || { preview: false, reducedMotion: false, playing: true, onPlay: function (cb) { cb(true); } };
  var $ = function (id) { return document.getElementById(id); };

  // ---- Canvas -------------------------------------------------------------------------

  var canvas = $('fc-canvas');
  var ctx = canvas.getContext('2d');
  var W = 0, H = 0, dpr = 1;
  var FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';

  var C = {
    skyTop: '#e7ece1', skyBottom: '#f7f6f0', sun: '#f2e9cf', cloud: 'rgba(255,255,255,0.75)',
    far: '#dbe1d2', near: '#c8d2bb', field: '#bcc8aa', fieldLine: 'rgba(90,110,70,0.10)',
    road: '#dddbd1', roadEdge: '#c3bfb2', dash: '#f6f4ed', verge: '#aab899',
    post: '#7a705f', wire: 'rgba(80,72,60,0.45)',
    trunk: '#6b5d4c', treeA: '#7b8f6f', treeB: '#687d5e', treeC: '#8a9c7c',
    roof: '#5a5750', roofDark: '#46443f', trim: '#f1ece2', wood: '#c7b28c', strut: '#6c5a43',
    ink: '#252821', car: '#58705a', carDark: '#3f5241', glass: '#dfe7e2', tyre: '#343630'
  };

  function resize() {
    var r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    if (!raf) draw();
  }

  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function ease(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function shade(hex, k) {
    var n = parseInt(hex.slice(1), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = Math.round(r * (1 - k)); g = Math.round(g * (1 - k)); b = Math.round(b * (1 - k));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  function rng(seed) {
    return function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  }

  // Layout, as fractions of the canvas height.
  function layout() {
    return { gy: H * (Kit.preview ? 0.63 : 0.66), fieldTop: H * 0.555, roadTop: H * 0.80, roadBottom: H * 0.885 };
  }

  // ---- Scenery ------------------------------------------------------------------------

  function hillPath(off, base, amp, l1, l2, ph, colour) {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (var x = 0; x <= W + 8; x += 8) {
      var u = x + off;
      ctx.lineTo(x, base - amp * (0.62 * Math.sin(u / l1 + ph) + 0.38 * Math.sin(u / l2 + ph * 2.3)));
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
  }

  function drawBackground(bgX, unit, sunAlpha) {
    var L = layout();
    var g = ctx.createLinearGradient(0, 0, 0, L.fieldTop);
    g.addColorStop(0, C.skyTop);
    g.addColorStop(1, C.skyBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    if (sunAlpha === undefined || sunAlpha > 0) {
      ctx.save();
      ctx.globalAlpha = sunAlpha === undefined ? 1 : sunAlpha;
      ctx.fillStyle = C.sun;
      ctx.beginPath();
      ctx.arc(W * 0.82 - bgX * 0.01, H * 0.17, 20 * unit, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.fillStyle = C.cloud;
    for (var i = 0; i < 3; i++) {
      var span = W + 300 * unit;
      var cx = ((i * 0.37 + 0.15) * span - bgX * 0.04) % span;
      if (cx < 0) cx += span;
      cx -= 120 * unit;
      var cy = H * (0.1 + 0.06 * i);
      ctx.beginPath();
      ctx.ellipse(cx, cy, 46 * unit, 9 * unit, 0, 0, Math.PI * 2);
      ctx.ellipse(cx + 26 * unit, cy - 5 * unit, 28 * unit, 8 * unit, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    hillPath(bgX * 0.15, H * 0.45, 16 * unit, 170 * unit, 83 * unit, 0.7, C.far);
    hillPath(bgX * 0.35, H * 0.53, 12 * unit, 120 * unit, 61 * unit, 2.1, C.near);

    ctx.fillStyle = C.field;
    ctx.fillRect(0, L.fieldTop, W, L.roadTop - L.fieldTop);
    ctx.strokeStyle = C.fieldLine;
    ctx.lineWidth = 1;
    [0.25, 0.55, 0.8].forEach(function (f) {
      var y = Math.round(L.fieldTop + (L.roadTop - L.fieldTop) * f) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    });
  }

  function drawForeground(bgX, unit, carAlpha, wheelTurn) {
    var L = layout();
    ctx.fillStyle = C.road;
    ctx.fillRect(0, L.roadTop, W, L.roadBottom - L.roadTop);
    ctx.fillStyle = C.roadEdge;
    ctx.fillRect(0, L.roadTop, W, Math.max(1, unit));
    ctx.fillStyle = C.dash;
    var mid = (L.roadTop + L.roadBottom) / 2;
    var step = 46 * unit, dash = 22 * unit;
    var off = (bgX * 1.1) % step;
    for (var x = -off; x < W; x += step) ctx.fillRect(x, mid - unit, dash, Math.max(1.5, 2 * unit));

    ctx.fillStyle = C.verge;
    ctx.fillRect(0, L.roadBottom, W, H - L.roadBottom);

    if (carAlpha > 0) drawCar(W * 0.15, mid + 2 * unit, unit, carAlpha, wheelTurn);

    // Fence along the near verge.
    var pstep = 64 * unit, poff = (bgX * 1.5) % pstep;
    var top = L.roadBottom + 6 * unit, bottom = H - 4 * unit;
    ctx.strokeStyle = C.wire;
    ctx.lineWidth = Math.max(1, 0.8 * unit);
    [0.3, 0.62].forEach(function (f) {
      var y = top + (bottom - top) * f;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    });
    ctx.fillStyle = C.post;
    for (var px = -poff; px < W + pstep; px += pstep) ctx.fillRect(px, top, Math.max(2, 3 * unit), bottom - top);
  }

  function drawCar(x, y, u, alpha, turn) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.scale(u, u);
    ctx.fillStyle = C.carDark;
    ctx.beginPath();
    ctx.moveTo(-24, -4); ctx.lineTo(24, -4); ctx.lineTo(25, -12); ctx.lineTo(13, -13);
    ctx.lineTo(7, -21); ctx.lineTo(-12, -21); ctx.lineTo(-19, -13); ctx.lineTo(-25, -12);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = C.car;
    ctx.fillRect(-24, -12, 48, 7);
    ctx.fillStyle = C.glass;
    ctx.beginPath();
    ctx.moveTo(-10, -19); ctx.lineTo(-2, -19); ctx.lineTo(-2, -13); ctx.lineTo(-16, -13); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(1, -19); ctx.lineTo(6, -19); ctx.lineTo(11, -13); ctx.lineTo(1, -13); ctx.closePath(); ctx.fill();
    [-14, 14].forEach(function (wx) {
      ctx.fillStyle = C.tyre;
      ctx.beginPath(); ctx.arc(wx, -4, 5.2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#a9ab9f';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(wx + Math.cos(turn) * 3, -4 + Math.sin(turn) * 3);
      ctx.lineTo(wx - Math.cos(turn) * 3, -4 - Math.sin(turn) * 3);
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawTree(t, sx, gy, s, alpha) {
    if (alpha <= 0) return;
    var k = s * t.size;
    var by = gy - t.back * s;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = C.trunk;
    ctx.fillRect(sx - 2 * k, by - 16 * k, 4 * k, 16 * k);
    ctx.fillStyle = t.tone;
    ctx.beginPath();
    ctx.arc(sx, by - 30 * k, 13 * k, 0, Math.PI * 2);
    ctx.arc(sx - 9 * k, by - 22 * k, 10 * k, 0, Math.PI * 2);
    ctx.arc(sx + 9 * k, by - 23 * k, 10 * k, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function makeTrees(barnXs, from, to, seed) {
    var rand = rng(seed), out = [], tones = [C.treeA, C.treeB, C.treeC];
    for (var x = from; x < to; x += 70 + rand() * 90) {
      var near = barnXs.some(function (bx) { return Math.abs(bx - x) < 85; });
      if (near) continue;
      out.push({ x: x, size: 0.75 + rand() * 0.4, back: rand() * 8, tone: tones[Math.floor(rand() * 3)] });
    }
    return out;
  }

  // ---- Barns --------------------------------------------------------------------------

  function poly(pts, cx, gy, s) {
    ctx.beginPath();
    pts.forEach(function (p, i) {
      var x = cx + p[0] * s, y = gy - p[1] * s;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
    ctx.closePath();
  }

  // The front is drawn by one function for every barn, real or not. Depth only appears
  // through barnParts() once the view swings (theta > 0).
  function outlinePath(b) {
    ctx.beginPath();
    F.frontOutline(b).forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
    ctx.closePath();
  }

  function drawFront(b, cx, gy, s, theta) {
    var m = F.frontPlane(theta);
    var w2 = b.w / 2, h = b.h, r = b.r;
    ctx.save();
    ctx.transform(s * m.xx, -s * m.xy, 0, -s * m.yy, cx, gy);
    outlinePath(b);
    ctx.fillStyle = b.colour;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(0,0,0,0.10)';
    ctx.lineWidth = 0.8;
    for (var x = -w2 + b.w / 9; x < w2; x += b.w / 9) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h + r); ctx.stroke();
    }
    ctx.restore();
    // Big door with a cross brace.
    var dw = b.w * 0.44, dh = h * 0.64;
    ctx.fillStyle = shade(b.colour, 0.22);
    ctx.fillRect(-dw / 2, 0, dw, dh);
    ctx.strokeStyle = C.trim;
    ctx.lineWidth = 2;
    ctx.strokeRect(-dw / 2, 0, dw, dh);
    ctx.beginPath();
    ctx.moveTo(-dw / 2, 0); ctx.lineTo(0, dh); ctx.lineTo(dw / 2, 0);
    ctx.moveTo(-dw / 2, dh); ctx.lineTo(0, 0); ctx.lineTo(dw / 2, dh);
    ctx.moveTo(0, 0); ctx.lineTo(0, dh);
    ctx.lineWidth = 1.4;
    ctx.stroke();
    // Hayloft door.
    var lw = b.w * 0.2, ly = h + r * 0.1, lh = r * 0.42;
    ctx.fillStyle = shade(b.colour, 0.3);
    ctx.fillRect(-lw / 2, ly, lw, lh);
    ctx.lineWidth = 1.6;
    ctx.strokeRect(-lw / 2, ly, lw, lh);
    // Corner trim and roof edge.
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(-w2 + 1.2, 0); ctx.lineTo(-w2 + 1.2, h);
    ctx.moveTo(w2 - 1.2, 0); ctx.lineTo(w2 - 1.2, h);
    ctx.stroke();
    ctx.strokeStyle = C.roof;
    ctx.lineWidth = 3.4;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-w2 - 3, h - 2); ctx.lineTo(0, h + r + 1); ctx.lineTo(w2 + 3, h - 2);
    ctx.stroke();
    ctx.restore();
  }

  // The back of a facade: bare boards and a frame, no paint.
  function drawBoardBack(b, cx, gy, s, theta) {
    var m = F.frontPlane(theta);
    var w2 = b.w / 2, h = b.h, r = b.r;
    ctx.save();
    ctx.transform(s * m.xx, -s * m.xy, 0, -s * m.yy, cx, gy);
    outlinePath(b);
    ctx.fillStyle = C.wood;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(70,55,35,0.22)';
    ctx.lineWidth = 0.8;
    for (var x = -w2 + b.w / 7; x < w2; x += b.w / 7) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h + r); ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = C.strut;
    ctx.lineWidth = 2.4;
    ctx.lineJoin = 'round';
    outlinePath(b);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-w2, h * 0.36); ctx.lineTo(w2, h * 0.36);
    ctx.moveTo(-w2, h); ctx.lineTo(w2, h);
    ctx.moveTo(-w2, 0); ctx.lineTo(w2, h);
    ctx.stroke();
    ctx.restore();
  }

  // The far gable wall of a real barn, seen once the view has gone round.
  function drawRear(b, cx, gy, s, theta, depth) {
    var m = F.planeAt(theta, depth);
    var w2 = b.w / 2, h = b.h;
    ctx.save();
    ctx.transform(s * m.xx, -s * m.xy, 0, -s * m.yy, cx + s * m.ox, gy - s * m.oy);
    outlinePath(b);
    ctx.fillStyle = shade(b.colour, 0.08);
    ctx.fill();
    ctx.fillStyle = shade(b.colour, 0.35);
    ctx.fillRect(-b.w * 0.12, 0, b.w * 0.24, h * 0.55);
    ctx.strokeStyle = C.trim;
    ctx.lineWidth = 1.6;
    ctx.strokeRect(-b.w * 0.12, 0, b.w * 0.24, h * 0.55);
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(-w2 + 1.2, 0); ctx.lineTo(-w2 + 1.2, h);
    ctx.moveTo(w2 - 1.2, 0); ctx.lineTo(w2 - 1.2, h);
    ctx.stroke();
    ctx.strokeStyle = C.roof;
    ctx.lineWidth = 3.4;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-w2 - 3, h - 2); ctx.lineTo(0, h + b.r + 1); ctx.lineTo(w2 + 3, h - 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawBarn(b, cx, gy, s, theta, depth) {
    var parts = F.barnParts(b, theta, depth);
    var P = function (x, y, z) { return F.project(theta, x, y, z); };
    var w2 = b.w / 2;
    // Shadow on the ground.
    ctx.fillStyle = 'rgba(55,70,45,0.16)';
    var reach = b.real ? depth : b.h;
    poly([P(-w2 - 4, 0, -3), P(w2 + 4, 0, -3), P(w2 + 4, 0, reach * Math.min(1, theta * 4)), P(-w2 - 4, 0, reach * Math.min(1, theta * 4))], cx, gy, s);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx, gy + 1, (w2 + 5) * s * Math.max(0.4, Math.cos(theta)), 2.6 * s, 0, 0, Math.PI * 2);
    ctx.fill();

    parts.forEach(function (p) {
      if (p.part === 'front') {
        if (!b.real && F.seesBack(theta)) drawBoardBack(b, cx, gy, s, theta);
        else drawFront(b, cx, gy, s, theta);
        return;
      }
      if (p.part === 'rear') { drawRear(b, cx, gy, s, theta, depth); return; }
      if (p.part === 'strut' || p.part === 'brace') {
        if (theta < 0.01) return;
        ctx.strokeStyle = C.strut;
        ctx.lineCap = 'round';
        ctx.lineWidth = Math.max(1.4, (p.part === 'brace' ? 2.2 : 3.2) * s);
        ctx.beginPath();
        ctx.moveTo(cx + p.pts[0][0] * s, gy - p.pts[0][1] * s);
        ctx.lineTo(cx + p.pts[1][0] * s, gy - p.pts[1][1] * s);
        ctx.stroke();
        return;
      }
      if (F.polygonArea(p.pts) < 1e-6) return;
      poly(p.pts, cx, gy, s);
      if (p.part === 'side') {
        ctx.fillStyle = shade(b.colour, 0.2);
        ctx.fill();
        // A window and the board lines on the long wall.
        ctx.save();
        ctx.clip();
        ctx.strokeStyle = 'rgba(0,0,0,0.12)';
        ctx.lineWidth = Math.max(0.6, 0.8 * s);
        for (var z = depth / 8; z < depth; z += depth / 8) {
          var a = P(w2, 0, z), q = P(w2, b.h, z);
          ctx.beginPath(); ctx.moveTo(cx + a[0] * s, gy - a[1] * s); ctx.lineTo(cx + q[0] * s, gy - q[1] * s); ctx.stroke();
        }
        ctx.restore();
        poly([P(w2, b.h * 0.42, depth * 0.38), P(w2, b.h * 0.42, depth * 0.56), P(w2, b.h * 0.76, depth * 0.56), P(w2, b.h * 0.76, depth * 0.38)], cx, gy, s);
        ctx.fillStyle = shade(b.colour, 0.45);
        ctx.fill();
        ctx.strokeStyle = C.trim;
        ctx.lineWidth = Math.max(0.8, 1.4 * s);
        ctx.stroke();
      } else if (p.part === 'roofR') {
        ctx.fillStyle = C.roof; ctx.fill();
      } else if (p.part === 'roofL') {
        ctx.fillStyle = C.roofDark; ctx.fill();
      } else if (p.part === 'edge') {
        ctx.fillStyle = C.wood; ctx.fill();
      }
    });
  }

  function label(text, x, y, size, weight, alpha, keepInside) {
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = weight + ' ' + size + 'px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = C.ink;
    var half = ctx.measureText(text).width / 2 + 3;
    ctx.fillText(text, keepInside ? clamp(x, half, Math.max(half, W - half)) : x, y);
    ctx.restore();
  }

  function tagSize() { return W < 420 ? 12 : 13; }

  // How far below the ground line a barn reaches once swung (the near end sits lower).
  function dropBelow(b, depth) {
    var low = 0;
    F.barnParts(b, F.MAX_SWING, depth).forEach(function (p) {
      p.pts.forEach(function (q) { if (q[1] < low) low = q[1]; });
    });
    return -low;
  }

  // ---- The drive ----------------------------------------------------------------------

  var V = F.VALLEY;
  var lastBarnX = V.barns[V.barns.length - 1].x;
  var END_X = lastBarnX + 330;
  var driveTrees = makeTrees(V.barns.map(function (b) { return b.x; }), -600, END_X + 900, 7);
  var REVEAL_MOVE = 1.4, REVEAL_STAGGER = 0.38, REVEAL_TURN = 0.9;
  var REVEAL_END = REVEAL_MOVE + 0.15 + (V.barns.length - 1) * REVEAL_STAGGER + REVEAL_TURN + 0.6;

  var drive = { phase: 'intro', camX: null, v: 0, target: 0, stop: 0, answers: [], rt: 0 };

  function unitDrive() { return H / 300; }
  function introCam() { return V.barns[0].x - (0.3 * W) / unitDrive(); }

  // Where each barn stands once the view has swung round. On a narrow screen six in a row
  // would be tiny, so they go in two rows of three, both fitted between the top and the road.
  var BARN_TOP = Math.max.apply(null, V.barns.map(function (b) { return b.h + b.r; }));
  var MAX_DROP = Math.max.apply(null, V.barns.map(function (b) { return dropBelow(b, V.depth); }));
  var ROW_GAP = 6;

  function revealRows() { return W < 500 ? 2 : 1; }

  function slotFor(i) {
    var rows = revealRows(), n = Math.ceil(V.barns.length / rows);
    var row = Math.floor(i / n), col = i % n, slotW = W / n;
    var ext = 74 * Math.abs(Math.cos(F.MAX_SWING)) + V.depth * Math.sin(F.MAX_SWING);
    var s = Math.min(unitDrive() * 0.9, (slotW * 0.8) / ext);
    var L = layout(), gy = L.gy;
    if (rows === 2) {
      var tag = tagSize(), above = tag + 14, below = tag + 8;
      s = Math.min(s, (L.roadTop - 2 * (above + below) - ROW_GAP) / (2 * (BARN_TOP + MAX_DROP)));
      var rowH = above + (BARN_TOP + MAX_DROP) * s + below;
      var gyLow = L.roadTop - below - MAX_DROP * s;
      gy = row === 1 ? gyLow : gyLow - rowH - ROW_GAP;
    }
    var centre = slotW * (col + 0.5);
    return { cx: centre - (V.depth * Math.sin(F.MAX_SWING) * s) / 2 + 4 * s, s: s, centre: centre, gy: gy };
  }

  function drawDrive() {
    var u = unitDrive();
    if (drive.camX === null) drive.camX = introCam();
    var cam = drive.camX;
    var bgX = cam * u;
    var L = layout();
    var reveal = drive.phase === 'revealing' || drive.phase === 'revealed' || drive.phase === 'after';
    var rt = reveal ? drive.rt : 0;
    var move = ease(rt / REVEAL_MOVE);

    var twoRows = reveal && revealRows() === 2;
    // In two rows the far row stands where the sun was, so let the sun fade.
    drawBackground(bgX, u, twoRows ? 1 - move : 1);

    // Two rows: raise the field so the far row stands on ground, not in the sky.
    if (twoRows && move > 0) {
      var farGy = slotFor(0).gy, sf = slotFor(0).s;
      ctx.save();
      ctx.globalAlpha = move;
      hillPath(bgX * 0.15, farGy - 30 * sf, 8 * u, 170 * u, 83 * u, 0.7, C.near);
      hillPath(bgX * 0.35, farGy - 4 * sf, 3 * u, 120 * u, 61 * u, 2.1, C.field);
      ctx.restore();
    }

    driveTrees.forEach(function (t) {
      var sx = W / 2 + (t.x - cam) * u;
      if (sx < -60 * u || sx > W + 60 * u) return;
      drawTree(t, sx, L.gy, u, 1 - move);
    });

    V.barns.forEach(function (b, i) {
      var sx = W / 2 + (b.x - cam) * u, s = u, theta = 0, gy = L.gy;
      if (reveal) {
        var slot = slotFor(i);
        sx = lerp(sx, slot.cx, move);
        s = lerp(u, slot.s, move);
        gy = lerp(L.gy, slot.gy, move);
        theta = ease((rt - REVEAL_MOVE - 0.15 - i * REVEAL_STAGGER) / REVEAL_TURN) * F.MAX_SWING;
      }
      if (sx < -200 * s || sx > W + 120 * s) return;
      drawBarn(b, sx, gy, s, theta, V.depth);
    });

    // Labels: what each one was, and what you said.
    if (reveal) {
      V.barns.forEach(function (b, i) {
        var slot = slotFor(i);
        var a = clamp((rt - REVEAL_MOVE - 0.15 - i * REVEAL_STAGGER - REVEAL_TURN * 0.6) / 0.4, 0, 1);
        var mid = slot.cx + ((b.real ? V.depth : b.h) * Math.sin(F.MAX_SWING) * slot.s) / 2;
        label(b.real ? 'real barn' : 'facade', mid, slot.gy + dropBelow(b, V.depth) * slot.s + 4 + tagSize(), tagSize(), b.real ? 600 : 400, a, true);
        var k = V.asked.indexOf(i);
        if (k >= 0 && drive.answers[k] !== undefined) {
          var top = slot.gy - (b.h + b.r) * slot.s - 12;
          label('you: ' + (drive.answers[k] ? 'yes' : 'no'), mid, top, tagSize(), 500, ease(rt / REVEAL_MOVE), true);
        }
      });
    }

    // A question mark over the barn being asked about.
    if (drive.phase === 'asking') {
      var b = V.barns[V.asked[drive.stop]];
      var x = W / 2 + (b.x - cam) * u, y = L.gy - (b.h + b.r) * u - 22;
      ctx.fillStyle = 'rgba(250,249,246,0.92)';
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y + 12); ctx.lineTo(x, y + 18); ctx.stroke();
      label('?', x, y + 5, 15, 600, 1);
    }

    drawForeground(bgX, u, 1 - move, cam / 7);
  }

  function stepDrive(dt) {
    if (drive.phase === 'driving') {
      var dist = drive.target - drive.camX;
      if (Kit.reducedMotion || dist <= 0.5) { drive.camX = drive.target; arrive(); return false; }
      var A = 110, VMAX = 165;
      drive.v = Math.min(VMAX, drive.v + A * dt, Math.sqrt(2 * A * dist) + 4);
      drive.camX = Math.min(drive.target, drive.camX + drive.v * dt);
      return true;
    }
    if (drive.phase === 'revealing') {
      drive.rt += dt;
      if (Kit.reducedMotion || drive.rt >= REVEAL_END) { drive.rt = REVEAL_END; revealed(); return false; }
      return true;
    }
    return false;
  }

  // ---- The drive's captions -----------------------------------------------------------

  var say = $('fc-say'), actions = $('fc-actions');

  function caption(html, buttons) {
    var hadFocus = actions.contains(document.activeElement) || document.activeElement === document.body;
    say.innerHTML = html;
    actions.innerHTML = '';
    (buttons || []).forEach(function (b, i) {
      var el = document.createElement('button');
      el.type = 'button';
      el.className = 'kit-button' + (i === 0 && b.primary !== false ? ' is-primary' : '');
      el.textContent = b.text;
      el.addEventListener('click', b.on);
      actions.appendChild(el);
    });
    if (hadFocus && actions.firstChild && !Kit.preview) actions.firstChild.focus({ preventScroll: true });
  }

  function describe(text) { canvas.setAttribute('aria-label', text); }

  var ASK = ['Is that a barn?', 'Another one. Is that a barn?', 'And this one. Is it a barn?'];

  function startDrive() {
    drive.phase = 'driving';
    drive.stop = 0;
    drive.answers = [];
    drive.v = 0;
    drive.rt = 0;
    drive.camX = introCam();
    drive.target = V.barns[V.asked[0]].x;
    caption('Driving…', []);
    describe('Farmland passing a car on a country road. Barns stand in the fields.');
    kick();
  }

  function arrive() {
    drive.v = 0;
    if (drive.stop < V.asked.length) {
      drive.phase = 'asking';
      caption('<strong>' + ASK[drive.stop] + '</strong>', [
        { text: 'Yes, a barn', on: function () { answerBarn(true); }, primary: false },
        { text: 'No', on: function () { answerBarn(false); }, primary: false }
      ]);
      describe('The car has stopped beside a barn in a field, marked with a question mark. It looks like an ordinary barn: a painted front with a big cross-braced door and a hayloft door.');
      requestDraw();
    } else {
      drive.phase = 'arrived';
      caption('That is the end of the valley. Before you drive on, look back at the barns from the other side.', [
        { text: 'Look back', on: startReveal }
      ]);
      describe('The road leaves the valley. The barns are behind the car.');
      requestDraw();
    }
  }

  function answerBarn(yes) {
    drive.answers[drive.stop] = yes;
    drive.stop++;
    drive.phase = 'driving';
    drive.target = drive.stop < V.asked.length ? V.barns[V.asked[drive.stop]].x : END_X;
    caption(drive.stop < V.asked.length ? 'Driving on…' : 'Driving on, out of the valley…', []);
    kick();
  }

  function startReveal() {
    drive.phase = 'revealing';
    drive.rt = 0;
    caption('Looking back…', []);
    kick();
  }

  function revealed() {
    drive.phase = 'revealed';
    var nFake = V.barns.filter(function (b) { return !b.real; }).length;
    var realK = V.asked.length - 1;
    var fakeYes = 0;
    V.asked.forEach(function (bi, k) { if (!V.barns[bi].real && drive.answers[k]) fakeYes++; });
    var realYes = !!drive.answers[realK];
    describe('Seen from behind, ' + nFake + ' of the ' + V.barns.length + ' barns are flat facades propped up by wooden beams, with nothing behind them. One, the third you were asked about, is a real barn with walls and a roof.');

    var html = 'From the other side, the valley looks different. ' + words(nFake) + ' of the ' + words(V.barns.length).toLowerCase() +
      ' are facades: painted fronts propped up on beams, with nothing behind them. Only one is a real barn, the third one you were asked about. ';
    if (realYes) {
      html += fakeYes === 2 ? 'You called both facades you were asked about barns, too. '
        : fakeYes === 1 ? 'You called one of the two facades a barn, too. '
        : 'You said no to both facades. ';
      html += 'About the real one, you were right. From the road it looked exactly like the fakes.<br><strong>Did you know it was a barn?</strong>';
      caption(html, [
        { text: 'Yes, I knew', on: function () { afterKnow('yes'); }, primary: false },
        { text: 'No, I was lucky', on: function () { afterKnow('no'); }, primary: false },
        { text: 'I’m not sure', on: function () { afterKnow('unsure'); }, primary: false }
      ]);
    } else {
      html += (fakeYes === 0 ? 'You said no to all three: right about the two facades, wrong about the one real barn. ' : 'You said the real one was not a barn. ') +
        'From the road, nothing told it apart from the fakes. ';
      drive.phase = 'after';
      caption(html + rulePara(), [{ text: 'Start the ten cases', on: startCases }]);
    }
  }

  function words(n) { return ['None', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven'][n] || String(n); }

  function rulePara() {
    return '<br><strong>The rule from here on:</strong> you knew only if your answer was true because of the evidence you relied on. True by luck scores as right, not as knowing.';
  }

  function afterKnow(choice) {
    drive.phase = 'after';
    var text = {
      yes: 'Many people say yes, and some philosophers agree: you saw a real barn, clearly, with working eyes. Others say no: in this valley the same view belonged to five fakes and one barn, so being right was luck. The cases that follow take the second view.',
      no: 'That is the view the cases that follow will use. Your belief was true, but what you went on, a front seen from the road, was the same for the fakes.',
      unsure: 'Neither are philosophers; this one is contested. The cases that follow take a side so that they can keep score.'
    }[choice];
    caption(text + rulePara(), [{ text: 'Start the ten cases', on: startCases }]);
  }

  // ---- The card preview ---------------------------------------------------------------

  var PV = F.PREVIEW;
  var pvTrees = makeTrees(PV.barns.map(function (b) { return b.x; }).concat([PV.period]), 0, PV.period, 3)
    .filter(function (t) { return t.x > 40 && t.x < PV.period - 40; });
  var pv = { cam: null };

  function unitPreview() { return H / 370; }
  function pvStill() {
    var real = PV.barns.filter(function (b) { return b.real; })[0];
    return real.x + PV.period + (0.21 * W) / unitPreview();
  }

  function drawPreview() {
    var u = unitPreview();
    if (pv.cam === null) pv.cam = pvStill();
    var cam = pv.cam, L = layout();
    drawBackground(cam * u, u);
    var span = W / u;
    var n0 = Math.floor((cam - span) / PV.period) - 1, n1 = Math.ceil((cam + span) / PV.period) + 1;
    var n;
    for (n = n0; n <= n1; n++) {
      pvTrees.forEach(function (t) {
        var sx = W / 2 + (t.x + n * PV.period - cam) * u;
        if (sx > -50 * u && sx < W + 50 * u) drawTree(t, sx, L.gy, u, 1);
      });
    }
    var labels = [];
    for (n = n0; n <= n1; n++) {
      PV.barns.forEach(function (b) {
        var sx = W / 2 + (b.x + n * PV.period - cam) * u;
        if (sx < -220 * u || sx > W + 80 * u) return;
        // Passing by, each one swings round to show what is behind it.
        var t = F.previewSwing(sx / W);
        drawBarn(b, sx, L.gy, u, ease(t) * F.MAX_SWING, PV.depth);
        var tagX = sx + ((b.real ? PV.depth : b.h) * Math.sin(F.MAX_SWING) * u) / 2 * ease(t);
        labels.push([b.real ? 'real barn' : 'facade', tagX, clamp((t - 0.55) / 0.35, 0, 1), b.real, dropBelow(b, PV.depth) * u * ease(t)]);
      });
    }
    // A still frame shows no half-faded tags: each is either fully there or not at all.
    var still = !Kit.playing;
    labels.forEach(function (l) { label(l[0], l[1], L.gy + l[4] + 4 + 12, 12, l[3] ? 600 : 400, still ? (l[2] > 0.15 ? 1 : 0) : l[2]); });
    drawForeground(cam * u, u, 1, cam / 7);
  }

  function stepPreview(dt) {
    pv.cam += PV.speed * dt;
    if (pv.cam > 1e6) pv.cam -= Math.floor(pv.cam / PV.period - 2) * PV.period;
    return true;
  }

  // The preview's second beat: a sentence card is filled in and stamped, then the verdict.
  // Its clock comes from the camera (F.previewClock), so it stays in step with the barns.
  var PVC = PV.card;
  var pvEls = { card: $('fc-pv'), claim: $('fc-pv-claim'), basis: $('fc-pv-basis'), stamp: $('fc-pv-stamp'), verdict: $('fc-pv-verdict') };
  function pvCard(still) {
    var k = still ? PVC.hide - 0.4 : F.previewClock(pv.cam);
    var shown = ease((k - PVC.show) / 0.5) * (1 - ease((k - PVC.hide) / 0.5));
    pvEls.card.style.opacity = shown.toFixed(3);
    pvEls.card.style.transform = 'translateY(' + ((1 - shown) * -10).toFixed(1) + 'px)';
    pvEls.claim.classList.toggle('is-filled', k > PVC.claim);
    pvEls.basis.classList.toggle('is-filled', k > PVC.basis);
    var s = ease((k - PVC.stamp) / 0.22);
    pvEls.stamp.style.opacity = s.toFixed(3);
    pvEls.stamp.style.transform = 'rotate(-7deg) scale(' + (1.7 - 0.7 * s).toFixed(3) + ')';
    pvEls.verdict.style.opacity = ease((k - PVC.verdict) / 0.4).toFixed(3);
  }

  // ---- Animation loop ------------------------------------------------------------------

  var raf = 0, lastT = 0;

  function draw() {
    if (!W || !H) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (Kit.preview) { drawPreview(); pvCard(!Kit.playing); } else drawDrive();
  }

  function frame(t) {
    raf = 0;
    var dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0;
    lastT = t;
    var more = Kit.preview ? stepPreview(dt) : stepDrive(dt);
    draw();
    if (more && Kit.playing) raf = requestAnimationFrame(frame);
    else lastT = 0;
  }

  function kick() {
    if (raf || !Kit.playing) { if (!raf) draw(); return; }
    lastT = 0;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    lastT = 0;
  }

  function requestDraw() { if (!raf) draw(); }

  // ---- The cases: a scene, a sentence card and a casebook -----------------------------
  //
  // cases.js says what each case means; scenes.js draws it. Here the visitor picks things up
  // in the scene (each becomes a chip in their notes), completes the sentence
  // "[answer] — because [evidence]", and files it. The scene then turns round to show what
  // was hidden, and F.outcome() gives the verdict by the one scoring rule in model.js.

  var SC = window.FacadeScenes;
  var VB = '0 0 ' + SC.VW + ' ' + SC.VH;
  var SVG_OPEN = '<svg xmlns="http://www.w3.org/2000/svg" focusable="false" font-family="-apple-system, BlinkMacSystemFont, \'Segoe UI\', Helvetica, Arial, sans-serif" ';

  var game = { i: 0, responses: {}, revealed: {}, claim: null, basis: null, selected: null, seen: [], filed: false, suppressClick: false };
  var els = {
    drive: $('fc-drive'), cases: $('fc-cases'), final: $('fc-final'),
    progress: $('fc-progress'), rule: $('fc-rule'), title: $('fc-title'), story: $('fc-story'),
    flip: $('fc-flip'), front: $('fc-front'), back: $('fc-back'), backArt: $('fc-back-art'), backCap: $('fc-back-cap'),
    inspect: $('fc-inspect'), slipArt: $('fc-slip-art'), slipTitle: $('fc-inspect-title'), slipNote: $('fc-slip-note'), slipClose: $('fc-slip-close'),
    lookHint: $('fc-look-hint'), card: $('fc-card'), question: $('fc-question'),
    blankClaim: $('fc-blank-claim'), blankBasis: $('fc-blank-basis'), stamp: $('fc-stamp'),
    claims: $('fc-claims'), notes: $('fc-notes'), hint: $('fc-hint'), fileRow: $('fc-file-row'), file: $('fc-file'),
    verdict: $('fc-verdict'), outcome: $('fc-outcome'), why: $('fc-why'), facts: $('fc-facts'), next: $('fc-next'),
    book: $('fc-book'), ledger: $('fc-ledger'), bookToggle: $('fc-book-toggle'), bookClose: $('fc-book-close')
  };

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  function reduced() { return Kit.reducedMotion; }
  function later(fn, ms) { if (reduced()) fn(); else setTimeout(fn, ms); }

  function show(which) {
    els.drive.hidden = which !== 'drive';
    els.cases.hidden = which !== 'cases';
    els.final.hidden = which !== 'final';
    if (which !== 'drive') stop();
    if (which !== 'cases') closeBook(false);
  }

  function scrollToStage() {
    var stage = document.querySelector('[data-kit-stage]');
    var r = stage.getBoundingClientRect();
    if (r.top < 0 || r.top > window.innerHeight * 0.4) {
      stage.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
    }
  }

  // ---- Lookups (all meaning comes from cases.js) ----

  function current() { return CASES[game.i]; }
  function ownerOf(c, basisId) {
    for (var i = 0; i < c.answers.length; i++) if (F.findBasis(c.answers[i], basisId)) return c.answers[i].id;
    return null;
  }
  function basisOf(c, basisId) { return F.findBasis(F.findAnswer(c, ownerOf(c, basisId)), basisId); }
  function spotOf(c, basisId) { return SC.byId[c.id].hotspots.filter(function (h) { return h.basis === basisId; })[0]; }

  function lowerFirst(s) {
    if (/^(I|Amara|Dana|Gord|Theo)\b/.test(s)) return s;
    return /^[A-Z](?![A-Z0-9])/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
  }
  function sentence(c, r) {
    return F.findAnswer(c, r.answer).text + ' — because ' + lowerFirst(basisOf(c, r.basis).text) + '.';
  }

  // ---- The scene ----

  function svg(markup, viewBox, extra) {
    return SVG_OPEN + 'viewBox="' + viewBox + '" ' + (extra || '') + '>' + markup + '</svg>';
  }

  function renderScene(c) {
    var sc = SC.byId[c.id];
    var html = svg(sc.front('f' + game.i), VB, 'role="img" aria-label="' + esc(sc.alt) + '"');
    sc.hotspots.forEach(function (h) {
      var style = 'left:' + (h.x / SC.VW * 100) + '%;top:' + (h.y / SC.VH * 100) + '%;width:' + (h.w / SC.VW * 100) + '%;height:' + (h.h / SC.VH * 100) + '%';
      // Where the hover tag goes, so it stays inside the picture.
      var place = (h.y + h.h > SC.VH * 0.72 ? ' is-low' : '') +
        (h.x + h.w / 2 < 70 ? ' is-left' : h.x + h.w / 2 > SC.VW - 70 ? ' is-right' : '');
      html += '<button type="button" class="fc-spot' + (h.thought ? ' is-thought' : '') + place + '" data-basis="' + esc(h.basis) + '" data-tag="' + esc(h.label) +
        '" style="' + style + '" aria-label="' + esc((h.thought ? 'Think it over: ' : 'Pick up: ') + h.label) + '"><span class="fc-pin" aria-hidden="true"></span></button>';
    });
    els.front.innerHTML = html;
    els.backArt.innerHTML = svg(sc.back('b' + game.i), VB, 'role="img" aria-label="' + esc(sc.backAlt) + '"');
    els.backCap.textContent = '';
    els.backCap.hidden = true;
    setTurned(false, true);
  }

  function setTurned(on, instant) {
    if (instant) {
      els.flip.classList.add('is-instant');
      els.flip.classList.toggle('is-turned', on);
      void els.flip.offsetWidth;
      els.flip.classList.remove('is-instant');
    } else {
      els.flip.classList.toggle('is-turned', on);
    }
    els.front.setAttribute('aria-hidden', on ? 'true' : 'false');
    els.back.setAttribute('aria-hidden', on ? 'false' : 'true');
    Array.prototype.forEach.call(els.front.querySelectorAll('.fc-spot'), function (b) { b.tabIndex = on ? -1 : 0; });
  }

  els.front.addEventListener('click', function (e) {
    var b = e.target.closest('.fc-spot');
    if (b && !game.filed) inspect(b.getAttribute('data-basis'), b);
  });

  var lastSpot = null;

  function inspect(basisId, spotEl) {
    var c = current(), h = spotOf(c, basisId), b = basisOf(c, basisId);
    lastSpot = spotEl;
    if (game.seen.indexOf(basisId) < 0) {
      game.seen.push(basisId);
      spotEl.classList.add('is-seen');
      renderChips();
    }
    els.inspect.classList.toggle('is-thought', h.thought);
    els.inspect.classList.toggle('is-wide', SC.focusOf(c.id, basisId).wide);
    els.slipTitle.textContent = h.label;
    els.slipNote.textContent = (h.thought ? 'A thought: ' : '') + '“' + b.text + '”';
    els.slipArt.innerHTML = '';
    els.inspect.hidden = false;
    // A close-up: the same drawing, cropped round the thing you picked up, close enough
    // that any writing on it can be read (SC.closeUp works that out for this box size).
    var box = els.slipArt.getBoundingClientRect();
    var crop = SC.closeUp(c.id, basisId, Math.max(1, box.width), Math.max(1, box.height));
    els.slipArt.innerHTML = svg(SC.byId[c.id].front('z' + game.i), [crop.x, crop.y, crop.w, crop.h].map(function (v) { return Math.round(v * 10) / 10; }).join(' '), 'aria-hidden="true"');
    els.slipClose.focus({ preventScroll: true });
    if (game.seen.length === 1) setHint(game.i === 0 ? 'It is in your notes now. Pick up more, or start the sentence.' : '');
  }

  function closeInspect() {
    if (els.inspect.hidden) return;
    els.inspect.hidden = true;
    if (lastSpot && document.body.contains(lastSpot)) lastSpot.focus({ preventScroll: true });
  }
  els.slipClose.addEventListener('click', closeInspect);

  // ---- Chips and blanks ----

  function chip(kind, id, text, thought) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'fc-chip is-' + kind + (thought ? ' is-thought' : '');
    b.setAttribute('data-kind', kind);
    b.setAttribute('data-id', id);
    b.setAttribute('aria-pressed', 'false');
    b.innerHTML = '<span class="fc-chip-text">' + esc(text) + '</span><span class="fc-chip-tag"></span>';
    return b;
  }

  function renderChips() {
    var c = current();
    els.claims.innerHTML = '';
    c.answers.forEach(function (a) { els.claims.appendChild(chip('claim', a.id, a.text, false)); });
    els.notes.innerHTML = '';
    if (!game.seen.length) {
      els.notes.innerHTML = '<span class="fc-empty">Nothing yet. What you pick up in the picture lands here.</span>';
    }
    game.seen.forEach(function (id) {
      var b = basisOf(c, id);
      els.notes.appendChild(chip('basis', id, b.text, b.source === 'hunch'));
    });
    refresh();
  }

  function slotEl(kind) { return kind === 'claim' ? els.blankClaim : els.blankBasis; }

  function canPlace(kind, id) {
    var c = current();
    if (kind === 'claim') return !game.basis || ownerOf(c, game.basis) === id;
    return !game.claim || ownerOf(c, id) === game.claim;
  }

  function refresh() {
    var c = current();
    var ans = game.claim && F.findAnswer(c, game.claim);
    var bas = game.basis && basisOf(c, game.basis);
    fillBlank(els.blankClaim, ans ? ans.text : null, 'your answer', 'Answer blank');
    fillBlank(els.blankBasis, bas ? lowerFirst(bas.text) : null, 'what you are going on', 'Evidence blank');
    els.blankBasis.classList.toggle('is-thought', !!(bas && bas.source === 'hunch'));
    Array.prototype.forEach.call(document.querySelectorAll('#fc-claims .fc-chip, #fc-notes .fc-chip'), function (b) {
      var kind = b.getAttribute('data-kind'), id = b.getAttribute('data-id');
      var used = (kind === 'claim' ? game.claim : game.basis) === id;
      var fits = canPlace(kind, id);
      b.disabled = game.filed || used || !fits;
      b.classList.toggle('is-used', used);
      b.classList.toggle('is-other', !used && !fits);
      b.querySelector('.fc-chip-tag').textContent = used ? 'in the sentence' : !fits ? 'goes with the other answer' : '';
      b.setAttribute('aria-pressed', game.selected && game.selected.kind === kind && game.selected.id === id ? 'true' : 'false');
    });
    ['claim', 'basis'].forEach(function (kind) {
      slotEl(kind).classList.toggle('is-target', !!(game.selected && game.selected.kind === kind));
      slotEl(kind).disabled = game.filed;
    });
    els.file.disabled = !(game.claim && game.basis) || game.filed;
  }

  function fillBlank(el, value, placeholder, name) {
    el.classList.toggle('is-filled', !!value);
    el.querySelector('.fc-blank-text').textContent = value || placeholder;
    el.setAttribute('aria-label', name + ': ' + (value ? value + '. Press to take it out.' : 'empty.'));
  }

  function setHint(t) { els.hint.textContent = t; }

  function place(kind, id) {
    if (game.filed || !canPlace(kind, id)) return false;
    if (kind === 'claim') game.claim = id; else game.basis = id;
    game.selected = null;
    refresh();
    if (game.claim && game.basis) setHint('Ready to file. To swap a chip, press its blank to take it out.');
    else if (game.claim) setHint(game.seen.length ? 'Now what are you going on? Put a note in the second blank.' : 'Now look round the picture for what you are going on.');
    else setHint('Now choose your answer for the first blank.');
    return true;
  }

  function onChipClick(e) {
    var b = e.target.closest('.fc-chip');
    if (!b || b.disabled) return;
    if (game.suppressClick) { game.suppressClick = false; return; }
    var kind = b.getAttribute('data-kind'), id = b.getAttribute('data-id');
    if (game.selected && game.selected.kind === kind && game.selected.id === id) {
      game.selected = null;
      setHint('');
    } else {
      game.selected = { kind: kind, id: id };
      setHint(kind === 'claim' ? 'Now choose the first blank, “your answer”.' : 'Now choose the second blank, “what you are going on”.');
    }
    refresh();
  }
  els.claims.addEventListener('click', onChipClick);
  els.notes.addEventListener('click', onChipClick);

  [els.blankClaim, els.blankBasis].forEach(function (el) {
    el.addEventListener('click', function () {
      if (game.filed) return;
      var kind = el.getAttribute('data-slot');
      if (game.selected) {
        if (game.selected.kind === kind) { place(kind, game.selected.id); el.focus({ preventScroll: true }); return; }
        setHint('That chip goes in the other blank.');
        return;
      }
      if (kind === 'claim' ? game.claim : game.basis) {
        if (kind === 'claim') game.claim = null; else game.basis = null;
        refresh();
        setHint('Taken out. Choose another chip.');
        return;
      }
      setHint(kind === 'claim' ? 'Choose an answer chip first, then this blank.' : (game.seen.length ? 'Choose a note first, then this blank.' : 'Your notes are empty. Pick something up in the picture first.'));
    });
  });

  // Dragging a chip onto a blank. A press without movement stays a click.
  // On touch, chips let the page scroll (touch-action: pan-y): a drag starts on a sideways
  // move, or on a short hold, and an upward or downward swipe scrolls as usual.
  var drag = null;
  function onDown(e) {
    var b = e.target.closest('.fc-chip');
    if (!b || b.disabled || e.button !== 0) return;
    drag = { el: b, kind: b.getAttribute('data-kind'), id: b.getAttribute('data-id'), x: e.clientX, y: e.clientY, pid: e.pointerId, ghost: null,
      touch: e.pointerType === 'touch', hold: 0 };
    try { b.setPointerCapture(e.pointerId); } catch (err) { /* not supported: fine */ }
    if (drag.touch) {
      var d = drag;
      d.hold = setTimeout(function () { if (drag === d && !d.ghost) { startGhost(d); moveGhost(d.x, d.y); } }, 380);
    }
  }
  function startGhost(d) {
    clearTimeout(d.hold);
    d.ghost = d.el.cloneNode(true);
    d.ghost.className += ' fc-ghost';
    d.ghost.removeAttribute('aria-pressed');
    d.ghost.setAttribute('aria-hidden', 'true');
    document.body.appendChild(d.ghost);
    d.el.classList.add('is-dragging');
    slotEl(d.kind).classList.add('is-target');
  }
  function moveGhost(x, y) {
    var r = drag.ghost.getBoundingClientRect();
    drag.ghost.style.transform = 'translate(' + (x - r.width / 2) + 'px,' + (y - r.height / 2) + 'px)';
    var over = overBlank(x, y, drag.kind);
    els.blankClaim.classList.toggle('is-over', over === els.blankClaim);
    els.blankBasis.classList.toggle('is-over', over === els.blankBasis);
  }
  function overBlank(x, y, kind) {
    var t = document.elementFromPoint(x, y);
    t = t && t.closest ? t.closest('.fc-blank') : null;
    return t && t.getAttribute('data-slot') === kind ? t : null;
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.pid) return;
    if (!drag.ghost) {
      var dx = Math.abs(e.clientX - drag.x), dy = Math.abs(e.clientY - drag.y);
      if (dx + dy < 7) return;
      // A vertical swipe on a touch screen is a scroll, not a drag.
      if (drag.touch && dy > dx) { clearTimeout(drag.hold); drag = null; return; }
      startGhost(drag);
    }
    moveGhost(e.clientX, e.clientY);
  }
  function endDrag(e, cancelled) {
    if (!drag || (e && e.pointerId !== drag.pid)) return;
    var d = drag;
    drag = null;
    clearTimeout(d.hold);
    if (!d.ghost) return;
    d.ghost.remove();
    d.el.classList.remove('is-dragging');
    els.blankClaim.classList.remove('is-over');
    els.blankBasis.classList.remove('is-over');
    game.suppressClick = true;
    setTimeout(function () { game.suppressClick = false; }, 0);
    var placed = !cancelled && overBlank(e.clientX, e.clientY, d.kind) && place(d.kind, d.id);
    if (!placed) refresh();
  }
  [els.claims, els.notes].forEach(function (box) {
    box.addEventListener('pointerdown', onDown);
    box.addEventListener('pointermove', onMove);
    box.addEventListener('pointerup', function (e) { endDrag(e, false); });
    box.addEventListener('pointercancel', function (e) { endDrag(e, true); });
    // Once a chip is being dragged, the finger moves the chip, not the page.
    box.addEventListener('touchmove', function (e) { if (drag && drag.ghost && e.cancelable) e.preventDefault(); }, { passive: false });
  });

  // ---- Filing, the turn-around and the verdict ----

  els.file.addEventListener('click', function () {
    var c = current();
    if (game.filed || !game.claim || !game.basis) return;
    game.filed = true;
    game.selected = null;
    game.responses[c.id] = { answer: game.claim, basis: game.basis };
    closeInspect();
    refresh();
    Array.prototype.forEach.call(els.front.querySelectorAll('.fc-spot'), function (b) { b.disabled = true; });
    els.fileRow.hidden = true;
    els.lookHint.textContent = '';
    els.card.classList.add('is-filed');
    els.stamp.classList.remove('is-down');
    els.card.classList.remove('is-thunk');
    void els.stamp.offsetWidth;
    els.stamp.classList.add('is-down');
    els.card.classList.add('is-thunk');
    setHint('Filed. Now the scene turns round.');
    renderLedger();
    // The stamp lands first; then bring the picture into view, if it has scrolled away, and turn it.
    later(function () { later(turnScene, bringSceneIntoView() ? 450 : 0); }, 650);
  });

  // Scrolls so the whole scene is on screen. Returns true if it had to move.
  function bringSceneIntoView() {
    var r = $('fc-scene').getBoundingClientRect();
    if (r.top >= 0 && r.bottom <= window.innerHeight) return false;
    window.scrollTo({ top: window.pageYOffset + r.top - 12, behavior: reduced() ? 'auto' : 'smooth' });
    return true;
  }

  function turnScene() {
    var c = current();
    els.backCap.innerHTML = '<span>Behind the scene:</span> ' + esc(SC.byId[c.id].backCaption);
    els.backCap.hidden = false;
    setTurned(true, reduced());
    later(showVerdict, 1150);
  }

  function outcomeHTML(o) {
    var info = F.OUTCOMES[o];
    return '<span class="fc-mark is-' + o + '" aria-hidden="true">' + info.mark + '</span><span class="is-' + o + '">' + info.label + '</span>';
  }

  function showVerdict() {
    var c = current(), r = game.responses[c.id];
    var o = F.outcome(c, r.answer, r.basis);
    game.revealed[c.id] = true;
    els.outcome.innerHTML = outcomeHTML(o);
    els.why.textContent = basisOf(c, r.basis).why;
    els.facts.textContent = c.facts;
    els.next.textContent = game.i < CASES.length - 1 ? 'Next case' : 'Open the casebook';
    setHint('');
    els.verdict.hidden = false;
    renderLedger(c.id);
    els.verdict.focus({ preventScroll: true });
    var vr = els.verdict.getBoundingClientRect();
    if (vr.bottom > window.innerHeight) els.verdict.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'nearest' });
  }

  els.next.addEventListener('click', function () {
    if (game.i < CASES.length - 1) {
      game.i++;
      renderCase();
      scrollToStage();
      els.title.focus({ preventScroll: true });
    } else {
      renderFinal();
    }
  });

  // ---- The casebook ----

  var MARKS = {
    right: { knew: ['✓', 'right'], lucky: ['✓', 'right'], wrong: ['✗', 'wrong'] },
    knew: { knew: ['✓', 'knew'], lucky: ['–', 'did not know'], wrong: ['–', 'did not know'] }
  };

  function tally() {
    var r = {};
    CASES.forEach(function (c) { if (game.revealed[c.id]) r[c.id] = game.responses[c.id]; });
    return F.score(CASES, r);
  }

  function ledgerHTML(fresh, final) {
    var s = tally(), N = CASES.length;
    var rows = CASES.map(function (c, i) {
      var r = game.responses[c.id], shown = game.revealed[c.id];
      var state = shown ? 'is-ink' : r ? 'is-pencil' : 'is-blank';
      if (!final && i === game.i) state += ' is-current';
      if (c.id === fresh) state += ' is-fresh';
      var line = r ? '<span class="fc-l-line">' + esc(sentence(c, r)) + '</span>' : '';
      var cells;
      if (shown) {
        var o = F.outcome(c, r.answer, r.basis);
        cells = ['right', 'knew'].map(function (col) {
          var m = MARKS[col][o];
          return '<td class="fc-l-mark is-' + (m[0] === '–' ? 'dash' : m[0] === '✗' ? 'cross' : 'tick') + '"><span aria-hidden="true">' + m[0] + '</span><span class="fc-sr">' + m[1] + '</span></td>';
        }).join('');
      } else if (r) {
        cells = '<td class="fc-l-mark is-pencil"><span aria-hidden="true">?</span><span class="fc-sr">not yet known</span></td>' +
          '<td class="fc-l-mark is-pencil"><span aria-hidden="true">?</span><span class="fc-sr">not yet known</span></td>';
      } else {
        cells = '<td class="fc-l-mark"></td><td class="fc-l-mark"></td>';
      }
      return '<tr class="' + state + '"><th scope="row"><span class="fc-l-n">' + (i + 1) + '</span><span class="fc-l-title">' + esc(c.title) + '</span>' + line + '</th>' + cells + '</tr>';
    }).join('');
    return '<caption class="fc-sr">' + (final ? 'Your casebook' : 'Your cases so far') + ': Right ' + s.right + ', Knew ' + s.knew + ', of ' + N + '</caption>' +
      '<thead><tr><th scope="col">Case</th><th scope="col">Right</th><th scope="col">Knew</th></tr></thead><tbody>' + rows + '</tbody>' +
      '<tfoot><tr><th scope="row">' + (final ? 'Total' : 'So far') + '</th><td class="fc-l-total">' + s.right + '</td><td class="fc-l-total">' + s.knew + '</td></tr></tfoot>';
  }

  function renderLedger(fresh) {
    els.ledger.innerHTML = ledgerHTML(fresh, false);
    var s = tally();
    els.bookToggle.textContent = 'Casebook · Right ' + s.right + ' · Knew ' + s.knew;
  }

  // On a phone the casebook is a drawer.
  var scrim = document.createElement('div');
  scrim.className = 'fc-scrim';
  scrim.hidden = true;
  els.cases.appendChild(scrim);

  function openBook() {
    els.book.classList.add('is-open');
    scrim.hidden = false;
    els.bookToggle.setAttribute('aria-expanded', 'true');
    els.bookClose.focus({ preventScroll: true });
  }
  function closeBook(refocus) {
    if (!els.book.classList.contains('is-open')) return;
    els.book.classList.remove('is-open');
    scrim.hidden = true;
    els.bookToggle.setAttribute('aria-expanded', 'false');
    if (refocus) els.bookToggle.focus({ preventScroll: true });
  }
  els.bookToggle.addEventListener('click', openBook);
  els.bookClose.addEventListener('click', function () { closeBook(true); });
  scrim.addEventListener('click', function () { closeBook(true); });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!els.inspect.hidden) closeInspect();
    else closeBook(true);
  });

  // ---- A case ----

  function startCases() {
    game.i = 0;
    game.responses = {};
    game.revealed = {};
    show('cases');
    renderCase();
    scrollToStage();
    els.title.focus({ preventScroll: true });
  }

  function renderCase() {
    var c = current();
    game.claim = null;
    game.basis = null;
    game.selected = null;
    game.seen = [];
    game.filed = false;
    els.progress.textContent = 'Case ' + (game.i + 1) + ' of ' + CASES.length;
    els.rule.hidden = game.i !== 0;
    els.title.textContent = c.title;
    els.story.textContent = c.story;
    els.question.textContent = c.question;
    els.inspect.hidden = true;
    renderScene(c);
    els.lookHint.textContent = game.i === 0
      ? 'Press anything marked in the picture to pick it up. Clouds are your own thoughts.'
      : 'Look round the picture. What you pick up goes into your notes.';
    setHint(game.i === 0 ? 'Finish the sentence: drag a chip into a blank, or choose a chip and then a blank.' : '');
    els.card.classList.remove('is-filed', 'is-thunk');
    els.stamp.classList.remove('is-down');
    els.fileRow.hidden = false;
    els.verdict.hidden = true;
    renderChips();
    renderLedger();
  }

  // ---- The open casebook ----

  function renderFinal() {
    var s = F.score(CASES, game.responses);
    var N = CASES.length;
    var outs = CASES.map(function (c) { var r = game.responses[c.id]; return F.outcome(c, r.answer, r.basis); });

    // One cell per case, in order, so the two bars line up. In the Right bar the cases that
    // were right by luck are hatched: they are the gap between the two numbers.
    function box(name, n, cls) {
      var cells = outs.map(function (o) { var k = cls(o); return '<span class="fc-cell' + (k ? ' ' + k : '') + '"></span>'; }).join('');
      return '<div class="fc-score"><p class="fc-score-label">' + name + '</p>' +
        '<p class="fc-score-num">' + n + ' <span>of ' + N + '</span></p>' +
        '<div class="fc-cells" aria-hidden="true">' + cells + '</div></div>';
    }
    var big = $('fc-big');
    var lucky = s.right - s.knew;
    big.innerHTML = box('Right', s.right, function (o) { return o === 'knew' ? 'is-on' : o === 'lucky' ? 'is-luck' : ''; }) +
      box('Knew', s.knew, function (o) { return o === 'knew' ? 'is-on' : ''; }) +
      (lucky ? '<p class="fc-cells-key" aria-hidden="true"><i></i>right by luck: ' + lucky + '</p>' : '');
    big.setAttribute('aria-label', 'Right: ' + s.right + ' of ' + N + '. Knew: ' + s.knew + ' of ' + N + '.');
    big.setAttribute('role', 'group');
    $('fc-reflect').innerHTML = F.reflect(CASES, game.responses).map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('');
    $('fc-final-ledger').innerHTML = ledgerHTML(null, true);

    show('final');
    scrollToStage();
    $('fc-final-title').focus({ preventScroll: true });
  }

  $('fc-replay').addEventListener('click', startCases);
  $('fc-redrive').addEventListener('click', function () {
    drive.phase = 'intro';
    drive.camX = null;
    drive.answers = [];
    drive.rt = 0;
    show('drive');
    caption('You are driving through farmland on a clear afternoon. Now and then you will be asked what you see.', [
      { text: 'Start the drive', on: startDrive },
      { text: 'Skip to the cases', on: startCases, primary: false }
    ]);
    resize();
    scrollToStage();
    actions.firstChild.focus({ preventScroll: true });
  });

  // ---- Wiring -------------------------------------------------------------------------

  Array.prototype.forEach.call(actions.querySelectorAll('[data-act]'), function (b) {
    b.addEventListener('click', b.getAttribute('data-act') === 'start' ? startDrive : startCases);
  });

  if (Kit.preview) {
    $('fc-pv').hidden = false;
    describe('Barn fronts glide past a country road. As each passes, the view swings round: most are flat facades propped up on beams; one is a real barn. Then a card reads “That is a barn, because it looks like one”, is stamped Filed, and marked Right by luck.');
  }

  resize();
  if (window.ResizeObserver) new ResizeObserver(function () { resize(); }).observe(canvas);
  else window.addEventListener('resize', resize);

  Kit.onPlay(function (playing) {
    if (Kit.preview) {
      if (playing) kick();
      else { stop(); pv.cam = pvStill(); draw(); }
      return;
    }
    if (playing) { if (drive.phase === 'driving' || drive.phase === 'revealing') kick(); }
    else { stop(); draw(); }
  });
})();
