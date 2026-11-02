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
    return real.x + PV.period + (0.17 * W) / unitPreview();
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
        var t = clamp((W * 0.74 - sx) / (W * 0.26), 0, 1);
        drawBarn(b, sx, L.gy, u, ease(t) * F.MAX_SWING, PV.depth);
        var tagX = sx + ((b.real ? PV.depth : b.h) * Math.sin(F.MAX_SWING) * u) / 2 * ease(t);
        labels.push([b.real ? 'real barn' : 'facade', tagX, clamp((t - 0.55) / 0.35, 0, 1), b.real, dropBelow(b, PV.depth) * u * ease(t)]);
      });
    }
    labels.forEach(function (l) { label(l[0], l[1], L.gy + l[4] + 4 + 12, 12, l[3] ? 600 : 400, l[2]); });
    drawForeground(cam * u, u, 1, cam / 7);
  }

  function stepPreview(dt) {
    pv.cam += 62 * dt;
    if (pv.cam > 1e6) pv.cam -= Math.floor(pv.cam / PV.period - 2) * PV.period;
    return true;
  }

  // ---- Animation loop ------------------------------------------------------------------

  var raf = 0, lastT = 0;

  function draw() {
    if (!W || !H) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (Kit.preview) drawPreview(); else drawDrive();
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

  // ---- The cases ----------------------------------------------------------------------

  var game = { i: 0, responses: {}, answer: null };
  var els = {
    drive: $('fc-drive'), cases: $('fc-cases'), final: $('fc-final'),
    progress: $('fc-progress'), right: $('fc-right'), knew: $('fc-knew'),
    title: $('fc-title'), story: $('fc-story'), question: $('fc-question'),
    askAnswer: $('fc-ask-answer'), askBasis: $('fc-ask-basis'),
    answers: $('fc-answers'), bases: $('fc-bases'),
    reveal: $('fc-reveal'), outcome: $('fc-outcome'), checks: $('fc-checks'),
    facts: $('fc-facts'), links: $('fc-links'), next: $('fc-next')
  };

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }

  function show(which) {
    els.drive.hidden = which !== 'drive';
    els.cases.hidden = which !== 'cases';
    els.final.hidden = which !== 'final';
    if (which !== 'drive') stop();
  }

  function scrollToStage() {
    var stage = document.querySelector('[data-kit-stage]');
    var r = stage.getBoundingClientRect();
    if (r.top < 0 || r.top > window.innerHeight * 0.4) {
      stage.scrollIntoView({ behavior: Kit.reducedMotion ? 'auto' : 'smooth', block: 'start' });
    }
  }

  function startCases() {
    game.i = 0;
    game.responses = {};
    show('cases');
    renderCase();
    scrollToStage();
    els.title.focus({ preventScroll: true });
  }

  function outcomeHTML(o) {
    var info = F.OUTCOMES[o];
    return '<span class="fc-mark is-' + o + '" aria-hidden="true">' + info.mark + '</span><span class="is-' + o + '">' + info.label + '</span>';
  }

  function choiceButton(text, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'kit-button';
    b.textContent = text;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', onClick);
    return b;
  }

  function press(container, btn) {
    Array.prototype.forEach.call(container.children, function (b) { b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'); });
  }

  function updateTally(bump) {
    var s = F.score(CASES, game.responses);
    if (bump && String(s.right) !== els.right.textContent) flash(els.right);
    if (bump && String(s.knew) !== els.knew.textContent) flash(els.knew);
    els.right.textContent = s.right;
    els.knew.textContent = s.knew;
  }

  function flash(el) {
    el.classList.remove('is-bumped');
    void el.offsetWidth;
    el.classList.add('is-bumped');
  }

  function renderCase() {
    var c = CASES[game.i];
    game.answer = null;
    els.progress.textContent = 'Case ' + (game.i + 1) + ' of ' + CASES.length;
    $('fc-rule').hidden = game.i !== 0;
    els.title.textContent = c.title;
    els.story.textContent = c.story;
    els.question.textContent = c.question;
    els.answers.innerHTML = '';
    c.answers.forEach(function (a) {
      var b = choiceButton(a.text, function () { chooseAnswer(a, b); });
      els.answers.appendChild(b);
    });
    els.askBasis.hidden = true;
    els.bases.innerHTML = '';
    els.reveal.hidden = true;
    updateTally(false);
  }

  function chooseAnswer(a, btn) {
    if (game.responses[CASES[game.i].id]) return;
    game.answer = a;
    press(els.answers, btn);
    els.bases.innerHTML = '';
    a.bases.forEach(function (bs) {
      var b = choiceButton(bs.text, function () { chooseBasis(bs, b); });
      els.bases.appendChild(b);
    });
    var wasHidden = els.askBasis.hidden;
    els.askBasis.hidden = false;
    if (wasHidden) els.bases.firstChild.focus({ preventScroll: false });
  }

  function chooseBasis(bs, btn) {
    var c = CASES[game.i];
    if (game.responses[c.id] || !game.answer) return;
    press(els.bases, btn);
    var a = game.answer;
    game.responses[c.id] = { answer: a.id, basis: bs.id };
    var o = F.outcome(c, a.id, bs.id);
    Array.prototype.forEach.call(els.answers.children, function (b) { b.disabled = true; });
    Array.prototype.forEach.call(els.bases.children, function (b) { b.disabled = true; });

    els.outcome.innerHTML = outcomeHTML(o);
    var checks = '<li>Was your answer true? <b>' + (a.correct ? 'Yes' : 'No') + '</b></li>';
    if (a.correct) checks += '<li>Was it true because of what you went on? <b>' + (bs.tracks ? 'Yes' : 'No') + '</b></li>';
    else checks += '<li>Was it reasonable, given what you could see? <b>' + (bs.source === 'evidence' ? 'Yes' : 'Not really') + '</b></li>';
    els.checks.innerHTML = checks;
    els.facts.textContent = c.facts;
    els.links.innerHTML =
      '<dt>You went on</dt><dd>' + esc(bs.text) + '. ' + esc(bs.why) + '</dd>' +
      '<dt>' + (a.correct ? 'What made it true' : 'What was actually the case') + '</dt><dd>' + esc(c.truthmaker) + '</dd>';
    els.next.textContent = game.i < CASES.length - 1 ? 'Next case' : 'See your two scores';
    els.reveal.hidden = false;
    updateTally(true);
    els.reveal.focus({ preventScroll: true });
    if (els.reveal.getBoundingClientRect().top > window.innerHeight * 0.6) {
      els.reveal.scrollIntoView({ behavior: Kit.reducedMotion ? 'auto' : 'smooth', block: 'start' });
    }
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

  // ---- The two scores -----------------------------------------------------------------

  function renderFinal() {
    var s = F.score(CASES, game.responses);
    var N = CASES.length;
    var outs = CASES.map(function (c) { var r = game.responses[c.id]; return F.outcome(c, r.answer, r.basis); });

    function box(name, n, on) {
      var cells = outs.map(function (o) { return '<span class="fc-cell' + (on(o) ? ' is-on' : '') + '"></span>'; }).join('');
      return '<div class="fc-score"><p class="fc-score-label">' + name + '</p>' +
        '<p class="fc-score-num">' + n + ' <span>of ' + N + '</span></p>' +
        '<div class="fc-cells" aria-hidden="true">' + cells + '</div></div>';
    }
    var big = $('fc-big');
    big.innerHTML = box('Right', s.right, function (o) { return o !== 'wrong'; }) + box('Knew', s.knew, function (o) { return o === 'knew'; });
    big.setAttribute('aria-label', 'Right: ' + s.right + ' of ' + N + '. Knew: ' + s.knew + ' of ' + N + '.');
    big.setAttribute('role', 'group');

    $('fc-reflect').innerHTML = F.reflect(CASES, game.responses).map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('');

    $('fc-list').innerHTML = CASES.map(function (c, i) {
      var r = game.responses[c.id];
      var a = F.findAnswer(c, r.answer), b = F.findBasis(a, r.basis);
      return '<li><span class="fc-li-title">' + (i + 1) + '. ' + esc(c.title) + '</span>' +
        '<span class="fc-li-out">' + outcomeHTML(outs[i]) + '</span>' +
        '<span class="fc-li-detail">' + esc(c.question) + ' You said “' + esc(a.text) + '”, going on “' + esc(b.text) + '”.</span></li>';
    }).join('');

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
    describe('Barn fronts glide past a country road. As each passes, the view swings round: most are flat facades propped up on beams; one is a real barn.');
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
