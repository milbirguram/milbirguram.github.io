// Blastema: drawing, controls and the card preview. The cells' rules live in model.js.
// Everything here is outside the cells: the knife, the brush, the camera and the picture.
(function () {
  'use strict';
  var BM = window.BlastemaModel, Kit = window.Kit;
  var ID = BM.ID, SQ3_2 = BM.SQ3_2;
  var PREVIEW = !!Kit.preview;
  var $ = function (id) { return document.getElementById(id); };

  var view = $('bl-view'), glCanvas = $('bl-gl'), ui = $('bl-ui');
  var uictx = ui.getContext('2d');

  var STEPS_PER_SEC = 120;          // simulation steps per second at 1x
  var R = 2;                        // field texels per hop

  // ------------------------------------------------------------------ state
  var S = {
    tool: 'knife', lens: 0, speed: 1,
    cuts: 0, cutsAfterRewrite: 0, rewritten: false, painting: false, twinSeen: false,
    lastCutStep: -1e9
  };
  var model, L0, TW, TH, accA, accB, texA, texB, tmp, WW, WH, wA, wB, texWA, texWB, wtmp, pts;
  var DS = 4;                       // the wide field is a quarter of the resolution
  var W = 0, H = 0, dprR = 1, portrait = false;
  var cam = { x: 0, y: 0, s: 1, ready: false };
  var reduced = Kit.reducedMotion;
  var time = 0, simAcc = 0;

  function chooseL0() {
    if (PREVIEW) return 80;
    var w = view.clientWidth || 600;
    return w >= 700 ? 120 : w >= 480 ? 100 : 80;
  }

  function newModel(seed) {
    L0 = chooseL0();
    model = new BM.Model({ L0: L0, seed: seed == null ? (1 + Math.floor(Math.random() * 1e6)) : seed });
    TW = Math.ceil((model.nx + 2) * R);
    TH = Math.ceil((model.ny * SQ3_2 + 2) * R);
    accA = new Float32Array(TW * TH * 4);
    accB = new Float32Array(TW * TH * 4);
    texA = new Uint8Array(TW * TH * 4);
    texB = new Uint8Array(TW * TH * 4);
    tmp = new Float32Array(TW * TH * 4);
    WW = Math.ceil(TW / DS); WH = Math.ceil(TH / DS);
    wA = new Float32Array(WW * WH * 4); wB = new Float32Array(WW * WH * 4);
    texWA = new Uint8Array(WW * WH * 4); texWB = new Uint8Array(WW * WH * 4);
    wtmp = new Float32Array(WW * WH * 4);
    lastRect = {}; lastAcc = null; prepKey = ''; fullUpload = true;
    pts = new Float32Array(model.N * PSTRIDE);
    cam.ready = false;
    if (gl) glAllocTextures();
  }

  // ------------------------------------------------------------------ geometry
  // The slow sway of the body. The same formula is used in the shaders (see waveParams), so the
  // field textures are built once per model change and the sway costs nothing on the CPU.
  function wave(X, t) {
    if (reduced) return 0;
    var A = 0.011 * L0, lambda = 0.75 * L0;
    return A * Math.sin(2 * Math.PI * (X / lambda) - t * 0.9) + 0.004 * L0 * Math.sin(t * 0.37 + X / (0.3 * L0));
  }
  // [amplitude 1, wavenumber 1, amplitude 2, wavenumber 2] and the two phases, in world units.
  function waveParams(t) {
    var TAU = 2 * Math.PI;
    if (reduced) return { w: [0, 0, 0, 0], ph: [0, 0] };
    return { w: [0.011 * L0, TAU / (0.75 * L0), 0.004 * L0, 1 / (0.3 * L0)],
      ph: [((-0.9 * t) % TAU + TAU) % TAU, (0.37 * t) % TAU] };
  }
  function w2s(X, Y) {
    if (portrait) return [(Y - cam.y) * cam.s + W / 2, -(X - cam.x) * cam.s + H / 2];
    return [(X - cam.x) * cam.s + W / 2, (Y - cam.y) * cam.s + H / 2];
  }
  function s2w(sx, sy) {
    if (portrait) return [cam.x - (sy - H / 2) / cam.s, cam.y + (sx - W / 2) / cam.s];
    return [cam.x + (sx - W / 2) / cam.s, cam.y + (sy - H / 2) / cam.s];
  }
  // The point on the (unwaved) lattice under a screen point.
  function s2lattice(sx, sy) {
    var p = s2w(sx, sy);
    return [p[0], p[1] - wave(p[0], time)];
  }

  // ------------------------------------------------------------------ sizing
  function measure() {
    var r = view.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    portrait = !PREVIEW && H > W * 1.05;
    var dpr = Math.min(window.devicePixelRatio || 1, PREVIEW ? 1.5 : 2);
    var maxPx = PREVIEW ? 260000 : 1600000;           // keep the fill cost bounded
    if (W * H * dpr * dpr > maxPx) dpr = Math.sqrt(maxPx / (W * H));
    dprR = dpr;
    glCanvas.width = Math.round(W * dpr); glCanvas.height = Math.round(H * dpr);
    var udpr = Math.min(window.devicePixelRatio || 1, 2);
    ui.width = Math.round(W * udpr); ui.height = Math.round(H * udpr);
    uictx.setTransform(udpr, 0, 0, udpr, 0, 0);
  }

  function fitCamera(bb, k) {
    var bw = Math.max(10, bb.maxX - bb.minX + 6), bh = Math.max(6, bb.maxY - bb.minY + 6);
    var sw = portrait ? H : W, sh = portrait ? W : H;
    var fill = PREVIEW ? 0.86 : 0.8;
    var s = Math.min(sw * fill / bw, sh * (PREVIEW ? 0.7 : 0.62) / bh);
    var sMax = Math.min(sw * fill / (L0 * 0.75), sh * 0.62 / (L0 * 0.12));
    s = Math.min(s, sMax);
    var tx = (bb.minX + bb.maxX) / 2, ty = (bb.minY + bb.maxY) / 2;
    if (!cam.ready || k >= 1) { cam.x = tx; cam.y = ty; cam.s = s; cam.ready = true; return; }
    cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k; cam.s += (s - cam.s) * k;
  }

  // ------------------------------------------------------------------ per-cell picture data
  var COLOURS = {
    trunk: [0.36, 0.80, 0.74], head: [0.97, 0.86, 0.60], pharynx: [0.98, 0.58, 0.52],
    tail: [0.56, 0.62, 0.98], blast: [0.94, 1.0, 0.98]
  };
  var bbox = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  var nPts = 0;

  var PSTRIDE = 5;
  function splat(q, w, hd, ph, bl, tl, l1, l2, eye) {
    accA[q] += w; accA[q + 1] += w * hd; accA[q + 2] += w * ph; accA[q + 3] += w * bl;
    accB[q] += w * tl; accB[q + 1] += w * l1; accB[q + 2] += w * l2; accB[q + 3] += w * eye;
  }
  // Build the field textures from the cells. The sway is applied later, in the shaders, so this
  // only has to run when the model has changed (see render).
  var lastAcc = null, upRows = { a: null, w: null }, fullUpload = true;
  function prepare() {
    var m = model, N = m.N, nx = m.nx, cur = m.cur, P = m.P;
    if (lastAcc) { clearRect(accA, TW, lastAcc); clearRect(accB, TW, lastAcc); }
    var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, k = 0;
    var CAP = P.CAP;
    for (var i = 0; i < N; i++) {
      var st = m.state[i];
      if (!st) continue;
      var y = (i / nx) | 0;
      var X = (i - y * nx) + 0.5 * (y & 1) + m.offX[i];
      var Y = y * SQ3_2 + m.offY[i];
      if (X < minX) minX = X; if (X > maxX) maxX = X;
      if (Y < minY) minY = Y; if (Y > maxY) maxY = Y;
      var dens = st === BM.DYING ? 0.25 + 0.6 * m.dieT[i] / P.DYING_STEPS : 1;
      var id = m.ident[i];
      var young = m.age[i] < 360 ? 1 - m.age[i] / 360 : 0;
      var bl = (m.blast[i] || m.wound[i]) ? 1 : young * 0.7;
      var hd = (id === ID.HEAD || id === ID.EYE) ? 1 : 0;
      var ph = id === ID.PHARYNX ? 1 : 0;
      var tl = id === ID.TAIL ? 1 : 0;
      var eye = id === ID.EYE ? 1 : 0;
      var l1 = 0, l2 = 0;
      if (S.lens === 1) {
        var dH = CAP, dT = CAP;
        if (cur.e1id[i]) { if (cur.e1t[i] === BM.HEAD) dH = cur.e1d[i]; else dT = cur.e1d[i]; }
        if (cur.e2id[i]) { if (cur.e2t[i] === BM.HEAD) dH = Math.min(dH, cur.e2d[i]); else dT = Math.min(dT, cur.e2d[i]); }
        var len = Math.max(20, Math.min(cur.m[i], 2 * L0));
        l1 = dH < CAP ? Math.exp(-2.4 * dH / len) : 0;
        l2 = dT < CAP ? Math.exp(-2.4 * dT / len) : 0;
      } else if (S.lens === 2) {
        // the voltage memory itself, exactly as the cells hold it: 0 normal, 1 head-like
        l1 = cur.mem[i]; l2 = l1;
      }
      // bilinear splat into the field textures
      var fx = X * R - 0.5, fy = Y * R - 0.5;
      var ix = Math.floor(fx), iy = Math.floor(fy), wx = fx - ix, wy = fy - iy;
      if (ix < 0 || iy < 0 || ix >= TW - 1 || iy >= TH - 1) continue;
      var o = (iy * TW + ix) * 4;
      var w00 = (1 - wx) * (1 - wy) * dens, w10 = wx * (1 - wy) * dens, w01 = (1 - wx) * wy * dens, w11 = wx * wy * dens;
      splat(o, w00, hd, ph, bl, tl, l1, l2, eye);
      splat(o + 4, w10, hd, ph, bl, tl, l1, l2, eye);
      splat(o + TW * 4, w01, hd, ph, bl, tl, l1, l2, eye);
      splat(o + TW * 4 + 4, w11, hd, ph, bl, tl, l1, l2, eye);
      // point sprites for the cells themselves (unswayed; the sway is added when drawn)
      pts[k++] = X; pts[k++] = Y;
      pts[k++] = m.blast[i] || m.wound[i] ? 4 : id === ID.HEAD || id === ID.EYE ? 1 : id === ID.PHARYNX ? 2 : id === ID.TAIL ? 3 : 0;
      pts[k++] = (i * 0.6180339) % 1;
      pts[k++] = S.lens === 1 ? l1 - l2 : l1 * 2 - 1;   // lens value, for the 2D fallback
    }
    nPts = k / PSTRIDE;
    if (minX > maxX) { minX = maxX = model.nx / 2; minY = maxY = model.ny * SQ3_2 / 2; }
    bbox.minX = minX; bbox.maxX = maxX; bbox.minY = minY; bbox.maxY = maxY;
    var K = 2.6 * 255;
    var x0 = Math.max(0, Math.floor(minX * R) - 12), x1 = Math.min(TW - 1, Math.ceil(maxX * R) + 12);
    var y0 = Math.max(0, Math.floor(minY * R) - 12), y1 = Math.min(TH - 1, Math.ceil(maxY * R) + 12);
    lastAcc = [x0, x1, y0, y1];
    // smooth the sharp field over about one cell, then make the quarter-resolution wide field
    blur5(accA, TW, x0, x1, y0, y1, tmp); blur5(accB, TW, x0, x1, y0, y1, tmp);
    wA.fill(0); wB.fill(0);
    var inv = 1 / (DS * DS);
    for (var ty = y0; ty <= y1; ty++) {
      var wrow = ((ty / DS) | 0) * WW;
      for (var tx = x0; tx <= x1; tx++) {
        var q = (ty * TW + tx) * 4, wq = (wrow + ((tx / DS) | 0)) * 4;
        wA[wq] += accA[q] * inv; wA[wq + 1] += accA[q + 1] * inv; wA[wq + 2] += accA[q + 2] * inv; wA[wq + 3] += accA[q + 3] * inv;
        wB[wq] += accB[q] * inv; wB[wq + 1] += accB[q + 1] * inv; wB[wq + 2] += accB[q + 2] * inv; wB[wq + 3] += accB[q + 3] * inv;
      }
    }
    var wx0 = Math.max(0, ((x0 / DS) | 0) - 3), wx1 = Math.min(WW - 1, ((x1 / DS) | 0) + 3);
    var wy0 = Math.max(0, ((y0 / DS) | 0) - 3), wy1 = Math.min(WH - 1, ((y1 / DS) | 0) + 3);
    blur5(wA, WW, wx0, wx1, wy0, wy1, wtmp); blur5(wA, WW, wx0, wx1, wy0, wy1, wtmp);
    blur5(wB, WW, wx0, wx1, wy0, wy1, wtmp); blur5(wB, WW, wx0, wx1, wy0, wy1, wtmp);
    upRows.a = joinRows(upRows.a, toBytes(accA, texA, TW, x0, x1, y0, y1, K, 'a'));
    toBytes(accB, texB, TW, x0, x1, y0, y1, K, 'b');
    upRows.w = joinRows(upRows.w, toBytes(wA, texWA, WW, wx0, wx1, wy0, wy1, K, 'wa'));
    toBytes(wB, texWB, WW, wx0, wx1, wy0, wy1, K, 'wb');
  }
  function joinRows(a, b) { return a ? [Math.min(a[0], b[0]), Math.max(a[1], b[1])] : b; }
  function clearRect(img, w, r) {
    for (var y = r[2]; y <= r[3]; y++) img.fill(0, (y * w + r[0]) * 4, (y * w + r[1]) * 4 + 4);
  }
  // Separable [1 4 6 4 1] / 16 blur of a 4-channel image, inside a rectangle (zero outside it).
  function blur5(img, w, x0, x1, y0, y1, t) {
    var x, y, q, c, row = w * 4;
    for (y = y0; y <= y1; y++) {
      for (x = x0; x <= x1; x++) {
        q = (y * w + x) * 4;
        var a2 = x - 2 >= x0, a1 = x - 1 >= x0, b1 = x + 1 <= x1, b2 = x + 2 <= x1;
        if (a2 && b2) {
          for (c = 0; c < 4; c++, q++) t[q] = (img[q - 8] + 4 * img[q - 4] + 6 * img[q] + 4 * img[q + 4] + img[q + 8]) * 0.0625;
        } else {
          for (c = 0; c < 4; c++, q++) t[q] = ((a2 ? img[q - 8] : 0) + 4 * (a1 ? img[q - 4] : 0) + 6 * img[q] + 4 * (b1 ? img[q + 4] : 0) + (b2 ? img[q + 8] : 0)) * 0.0625;
        }
      }
    }
    var r2 = 2 * row;
    for (y = y0; y <= y1; y++) {
      var u2 = y - 2 >= y0, u1 = y - 1 >= y0, d1 = y + 1 <= y1, d2 = y + 2 <= y1, inner = u2 && d2;
      for (q = (y * w + x0) * 4, c = (y * w + x1) * 4 + 4; q < c; q++) {
        img[q] = inner
          ? (t[q - r2] + 4 * t[q - row] + 6 * t[q] + 4 * t[q + row] + t[q + r2]) * 0.0625
          : ((u2 ? t[q - r2] : 0) + 4 * (u1 ? t[q - row] : 0) + 6 * t[q] + 4 * (d1 ? t[q + row] : 0) + (d2 ? t[q + r2] : 0)) * 0.0625;
      }
    }
  }
  // Write a rectangle of a float image into a byte texture, clearing what was written last time.
  // Returns the rows touched (old and new), which are all that need uploading.
  var lastRect = {};
  function toBytes(src, dst, w, x0, x1, y0, y1, K, key) {
    var r = lastRect[key], ya = y0, yb = y1;
    if (r) {
      for (var yy = r[2]; yy <= r[3]; yy++) dst.fill(0, (yy * w + r[0]) * 4, (yy * w + r[1]) * 4 + 4);
      ya = Math.min(ya, r[2]); yb = Math.max(yb, r[3]);
    }
    for (var ty = y0; ty <= y1; ty++) {
      for (var q = (ty * w + x0) * 4, qe = (ty * w + x1) * 4 + 4; q < qe; q++) {
        var v = src[q] * K; dst[q] = v > 255 ? 255 : v;
      }
    }
    lastRect[key] = [x0, x1, y0, y1];
    return [ya, yb];
  }

  // ------------------------------------------------------------------ WebGL renderer
  var gl = null, prog = null, pprog = null, tri = null, pbuf = null, tA = null, tB = null, tWA = null, tWB = null, deriv = false;

  var VS = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }';
  function fieldFS(useDeriv) {
    return (useDeriv ? '#extension GL_OES_standard_derivatives : enable\n' : '') +
    '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n' +
    'uniform sampler2D uA, uB, uWA, uWB; uniform mat3 uMap; uniform vec2 uHop; uniform vec2 uRes; uniform vec2 uWScale;\n' +
    'uniform float uTime, uLens, uMotion; uniform vec4 uWave; uniform vec2 uPh;\n' +
    'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n' +
    'float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);\n' +
    '  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }\n' +
    'float aa(float x){ ' + (useDeriv ? 'return max(fwidth(x), 1e-4);' : 'return 0.02;') + ' }\n' +
    'float iso(float v, float n){ float f = abs(fract(v * n + 0.5) - 0.5) / n; float w = aa(v); return 1.0 - smoothstep(0.4 * w, 1.4 * w, f); }\n' +
    'vec4 blur(sampler2D t, vec2 uv, vec2 h){\n' +
    '  vec4 a = texture2D(t, uv) * 0.25;\n' +
    '  a += (texture2D(t, uv + vec2(h.x, 0.0)) + texture2D(t, uv - vec2(h.x, 0.0)) + texture2D(t, uv + vec2(0.0, h.y)) + texture2D(t, uv - vec2(0.0, h.y))) * 0.125;\n' +
    '  a += (texture2D(t, uv + h) + texture2D(t, uv - h) + texture2D(t, uv + vec2(h.x, -h.y)) + texture2D(t, uv + vec2(-h.x, h.y))) * 0.0625;\n' +
    '  return a; }\n' +
    'void main(){\n' +
    '  vec2 uv = (uMap * vec3(gl_FragCoord.xy, 1.0)).xy;\n' +
    // the sway: shift each column of the (unswayed) field by the wave at that place along the body
    '  float wx = uv.x / uHop.x;\n' +
    '  uv.y -= (uWave.x * sin(uWave.y * wx + uPh.x) + uWave.z * sin(uWave.w * wx + uPh.y)) * uHop.y;\n' +
    '  vec2 sp = gl_FragCoord.xy / uRes;\n' +
    '  float vig = smoothstep(1.15, 0.1, length((sp - 0.5) * vec2(1.25, 1.0)) * 1.55);\n' +
    '  vec3 bg = mix(vec3(0.012, 0.03, 0.027), vec3(0.05, 0.105, 0.095), vig);\n' +
    // drifting motes, for depth (still when motion is reduced)
    '  vec2 g = gl_FragCoord.xy / 34.0 + vec2(uTime * 0.18 * uMotion, uTime * 0.03 * uMotion);\n' +
    '  vec2 gi = floor(g); vec2 gf = fract(g) - 0.5;\n' +
    '  float hr = hash(gi); vec2 off = vec2(hash(gi + 3.1), hash(gi + 7.7)) - 0.5;\n' +
    '  float mote = smoothstep(0.09, 0.0, length(gf - off * 0.7)) * step(0.72, hr) * (0.35 + 0.65 * hash(gi + 1.3));\n' +
    '  bg += vec3(0.25, 0.42, 0.40) * mote * 0.16;\n' +
    '  vec4 a = blur(uA, uv, uHop * 0.5);\n' +
    '  vec2 wp = uv / uHop;\n' +
    '  vec2 wuv = uv * uWScale;\n' +
    '  vec4 wa = texture2D(uWA, wuv); vec4 wb = texture2D(uWB, wuv);\n' +
    // the outline: mostly the cells, eased by the wide field so the lattice does not show as a ragged edge
    '  float dEdge = 0.42 * a.r + 0.36 * blur(uA, uv, uHop * 1.2).r + 0.22 * wa.r;\n' +
    '  vec2 hh = uHop * 5.0 * uWScale;\n' +
    '  float halo = (texture2D(uWA, wuv + vec2(hh.x, 0.0)).r + texture2D(uWA, wuv - vec2(hh.x, 0.0)).r + texture2D(uWA, wuv + vec2(0.0, hh.y)).r + texture2D(uWA, wuv - vec2(0.0, hh.y)).r) * 0.25;\n' +
    '  halo = 0.5 * halo + 0.5 * wa.r;\n' +
    '  float d = a.r;\n' +
    '  float inv = 1.0 / max(wa.r, 0.05);\n' +
    '  float hd = clamp(wa.g * inv, 0.0, 1.0), ph = clamp(wa.b * inv, 0.0, 1.0), bl = clamp(wa.a * inv, 0.0, 1.0), tl = clamp(wb.r * inv, 0.0, 1.0);\n' +
    '  vec3 cTrunk = vec3(0.30, 0.78, 0.71), cHead = vec3(1.0, 0.86, 0.62), cPh = vec3(1.0, 0.58, 0.60), cTail = vec3(0.60, 0.64, 1.0), cBl = vec3(0.94, 1.0, 0.98);\n' +
    '  vec3 c = mix(cTrunk, cHead, smoothstep(0.05, 1.0, hd));\n' +
    '  c = mix(c, cTail, smoothstep(0.05, 1.0, tl) * 0.85);\n' +
    '  c = mix(c, cPh, smoothstep(0.15, 0.9, ph) * 0.42);\n' +
    '  float body = smoothstep(0.27, 0.40, dEdge);\n' +
    '  float depth = smoothstep(0.30, 0.92, 0.65 * wa.r + 0.35 * a.r);\n' +
    '  float membrane = body * (1.0 - smoothstep(0.36, 0.62, dEdge));\n' +
    // the blastema: read from the sharp field as well, so a bud a few cells deep is plainly visible
    '  float blS = clamp(a.a / max(a.r, 0.05), 0.0, 1.0);\n' +
    '  float blv = max(smoothstep(0.12, 0.75, blS), smoothstep(0.1, 0.9, bl) * 0.85);\n' +
    '  float pulse = 0.82 + 0.18 * sin(uTime * 2.4 * uMotion);\n' +
    '  float tex = vnoise(wp * 0.33 + vec2(uTime * 0.05 * uMotion, 0.0)) * 0.6 + vnoise(wp * 0.9 - vec2(0.0, uTime * 0.08 * uMotion)) * 0.4;\n' +
    '  float lensOn = step(0.5, uLens);\n' +
    '  if (uLens > 0.5) {\n' +
    '    vec4 lb = blur(uB, uv, uHop * 0.85);\n' +
    '    float l1 = clamp(lb.g / max(a.r, 0.05), 0.0, 1.0), l2 = clamp(lb.b / max(a.r, 0.05), 0.0, 1.0);\n' +
    '    vec3 lc; float lines;\n' +
    '    if (uLens < 1.5) {\n' +
    '      float tt = l1 / max(l1 + l2, 0.001);\n' +
    '      lc = mix(vec3(0.26, 0.50, 1.0), vec3(1.0, 0.66, 0.24), smoothstep(0.0, 1.0, tt)) * (0.30 + 0.75 * max(l1, l2));\n' +
    '      lines = max(iso(l1, 6.0) * step(0.04, l1), iso(l2, 6.0) * step(0.04, l2));\n' +
    '    } else {\n' +
    // the voltage memory as stored: blue is normal (0), gold is head-like (1); lines trace a spreading front
    '      float v = l1;\n' +
    '      lc = mix(vec3(0.16, 0.34, 0.66), vec3(1.0, 0.80, 0.32), smoothstep(0.0, 1.0, v));\n' +
    '      lines = iso(v + 0.125, 4.0) * step(0.03, v) * step(v, 0.97);\n' +
    '    }\n' +
    '    c = mix(lc, vec3(1.0), lines * 0.5 * body);\n' +
    '  }\n' +
    // translucent body: a soft outer glow, a body that brightens with depth, a thin luminous rim
    '  vec3 col = bg + c * halo * 0.26;\n' +
    '  float inner = (0.10 + 0.40 * depth + 0.14 * tex * depth) * (1.0 + 0.55 * smoothstep(0.1, 1.0, hd) + 0.2 * smoothstep(0.1, 1.0, tl));\n' +
    '  vec3 core = mix(c, vec3(0.92, 1.0, 0.96), 0.18 * depth * depth);\n' +
    '  vec3 fill = core * inner * (1.0 - lensOn) + c * lensOn * (0.45 + 0.25 * depth);\n' +
    '  col = mix(col, fill, body * 0.92);\n' +
    '  col += mix(c, vec3(1.0), 0.3) * membrane * 0.48;\n' +
    // the pharynx: a soft inner glow rather than a painted patch
    '  col += cPh * smoothstep(0.3, 0.95, ph) * body * (0.10 + 0.16 * depth) * (1.0 - lensOn);\n' +
    // the bud: pale, softly pulsing, with its own glow just beyond the edge
    '  float budGlow = smoothstep(0.02, 0.22, wa.a) * (1.0 - body);\n' +
    '  col += cBl * budGlow * 0.16 * pulse * (1.0 - 0.6 * lensOn);\n' +
    '  col = mix(col, cBl * (0.50 + 0.28 * membrane + 0.12 * depth) * pulse, blv * body * 0.78 * (1.0 - 0.55 * lensOn));\n' +
    '  vec4 eb = blur(uB, uv, uHop * 0.6);\n' +
    '  float e = eb.a / max(a.r, 0.12);\n' +
    '  float pupil = smoothstep(0.4, 0.7, e) * body;\n' +
    '  float ring = clamp(smoothstep(0.06, 0.24, wb.a / max(wa.r, 0.12) + e * 0.5) * body - pupil, 0.0, 1.0);\n' +
    '  col = mix(col, vec3(0.96, 0.97, 0.90), ring * 0.38 * (1.0 - 0.5 * lensOn));\n' +
    '  col = mix(col, vec3(0.02, 0.035, 0.04), pupil * 0.92);\n' +
    '  gl_FragColor = vec4(col, 1.0);\n' +
    '}';
  }
  var PVS =
    'precision highp float; attribute vec4 a; uniform mat3 uW; uniform float uSize, uTime, uMotion; uniform vec4 uWave; uniform vec2 uPh; varying vec3 vC; varying float vA;\n' +
    'void main(){ vec2 w = a.xy; w.y += uWave.x * sin(uWave.y * w.x + uPh.x) + uWave.z * sin(uWave.w * w.x + uPh.y);\n' +
    '  vec3 c = (uW * vec3(w, 1.0)); gl_Position = vec4(c.xy, 0.0, 1.0); gl_PointSize = uSize;\n' +
    '  float k = a.z; vC = k < 0.5 ? vec3(0.55, 0.95, 0.88) : k < 1.5 ? vec3(1.0, 0.92, 0.70) : k < 2.5 ? vec3(1.0, 0.70, 0.64) : k < 3.5 ? vec3(0.70, 0.76, 1.0) : vec3(1.0);\n' +
    '  vA = (k > 3.5 ? 0.14 : 0.055) *(0.75 + 0.25 * sin(uTime * (1.3 + a.w) * uMotion + a.w * 40.0)); }';
  var PFS =
    'precision mediump float; varying vec3 vC; varying float vA;\n' +
    'void main(){ vec2 q = gl_PointCoord * 2.0 - 1.0; float r2 = dot(q, q); if (r2 > 1.0) discard; float f = (1.0 - r2); gl_FragColor = vec4(vC * vA * f * f, 1.0); }';

  function compile(type, src) {
    var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { var log = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(log); }
    return s;
  }
  function link(vs, fs) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }
  function initGL() {
    var opts = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'low-power' };
    try { gl = glCanvas.getContext('webgl', opts) || glCanvas.getContext('experimental-webgl', opts); } catch (e) { gl = null; }
    if (!gl) return false;
    try {
      deriv = !!gl.getExtension('OES_standard_derivatives');
      try { prog = link(VS, fieldFS(deriv)); } catch (e) { deriv = false; prog = link(VS, fieldFS(false)); }
      pprog = link(PVS, PFS);
      tri = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, tri);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      pbuf = gl.createBuffer();
      return true;
    } catch (e) {
      gl = null;
      return false;
    }
  }
  function glAllocTextures() {
    [tA, tB, tWA, tWB].forEach(function (t) { if (t) gl.deleteTexture(t); });
    tA = gl.createTexture(); tB = gl.createTexture(); tWA = gl.createTexture(); tWB = gl.createTexture();
    fullUpload = true;
    [tA, tB, tWA, tWB].forEach(function (t, n) {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, n < 2 ? TW : WW, n < 2 ? TH : WH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    });
  }

  // Matrices (column-major 3x3) for the two passes.
  function fieldMap() {
    // fragment pixel (origin bottom-left, device px) -> texture uv
    var k = 1 / dprR, s = cam.s;
    // css: cx = fx*k ; cy = H - fy*k
    var a, b, c, d, e, f;   // X = a*fx + b*fy + c ; Y = d*fx + e*fy + f
    if (!portrait) {
      a = k / s; b = 0; c = cam.x - W / 2 / s;
      d = 0; e = -k / s; f = cam.y + (H - H / 2) / s;   // Y = cam.y + (H - fy*k - H/2)/s
    } else {
      // X = cam.x - (cy - H/2)/s = cam.x - (H/2 - fy*k)/s ; Y = cam.y + (cx - W/2)/s
      a = 0; b = k / s; c = cam.x - H / 2 / s;
      d = k / s; e = 0; f = cam.y - W / 2 / s;
    }
    var ux = R / TW, uy = R / TH;
    return new Float32Array([a * ux, d * uy, 0, b * ux, e * uy, 0, c * ux, f * uy, 1]);
  }
  function worldToClip() {
    var s = cam.s, a, b, c, d, e, f;   // sx = a*X + b*Y + c ; sy = d*X + e*Y + f  (css px)
    if (!portrait) { a = s; b = 0; c = -cam.x * s + W / 2; d = 0; e = s; f = -cam.y * s + H / 2; }
    else { a = 0; b = s; c = -cam.y * s + W / 2; d = -s; e = 0; f = cam.x * s + H / 2; }
    // clip x = sx*2/W - 1 ; clip y = 1 - sy*2/H
    var kx = 2 / W, ky = -2 / H;
    return new Float32Array([a * kx, d * ky, 0, b * kx, e * ky, 0, c * kx - 1, f * ky + 1, 1]);
  }

  function drawGL() {
    gl.viewport(0, 0, glCanvas.width, glCanvas.height);
    gl.disable(gl.BLEND);
    gl.useProgram(prog);
    // Upload only the rows that changed since the last upload (old and new body extent).
    var ra = fullUpload ? [0, TH - 1] : upRows.a, rw = fullUpload ? [0, WH - 1] : upRows.w;
    upload(gl.TEXTURE0, tA, texA, TW, ra); upload(gl.TEXTURE1, tB, texB, TW, ra);
    upload(gl.TEXTURE2, tWA, texWA, WW, rw); upload(gl.TEXTURE3, tWB, texWB, WW, rw);
    upRows.a = upRows.w = null; fullUpload = false;
    var wp = waveParams(time);
    gl.uniform4f(gl.getUniformLocation(prog, 'uWave'), wp.w[0], wp.w[1], wp.w[2], wp.w[3]);
    gl.uniform2f(gl.getUniformLocation(prog, 'uPh'), wp.ph[0], wp.ph[1]);
    gl.uniform1i(gl.getUniformLocation(prog, 'uA'), 0);
    gl.uniform1i(gl.getUniformLocation(prog, 'uB'), 1);
    gl.uniform1i(gl.getUniformLocation(prog, 'uWA'), 2);
    gl.uniform1i(gl.getUniformLocation(prog, 'uWB'), 3);
    gl.uniform2f(gl.getUniformLocation(prog, 'uWScale'), (TW / DS) / WW, (TH / DS) / WH);
    gl.uniformMatrix3fv(gl.getUniformLocation(prog, 'uMap'), false, fieldMap());
    var hop = cam.s * dprR;  // device px per hop
    gl.uniform2f(gl.getUniformLocation(prog, 'uHop'), R / TW, R / TH);
    gl.uniform2f(gl.getUniformLocation(prog, 'uRes'), glCanvas.width, glCanvas.height);
    gl.uniform1f(gl.getUniformLocation(prog, 'uTime'), time);
    gl.uniform1f(gl.getUniformLocation(prog, 'uLens'), S.lens);
    gl.uniform1f(gl.getUniformLocation(prog, 'uMotion'), reduced ? 0 : 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, tri);
    var lp = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(lp);
    gl.vertexAttribPointer(lp, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disableVertexAttribArray(lp);
    // the cells themselves, as faint additive points
    if (nPts && hop > 2.2) {
      gl.useProgram(pprog);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      gl.bindBuffer(gl.ARRAY_BUFFER, pbuf);
      gl.bufferData(gl.ARRAY_BUFFER, pts.subarray(0, nPts * PSTRIDE), gl.DYNAMIC_DRAW);
      var la = gl.getAttribLocation(pprog, 'a');
      gl.enableVertexAttribArray(la);
      gl.vertexAttribPointer(la, 4, gl.FLOAT, false, PSTRIDE * 4, 0);
      gl.uniformMatrix3fv(gl.getUniformLocation(pprog, 'uW'), false, worldToClip());
      gl.uniform1f(gl.getUniformLocation(pprog, 'uSize'), Math.max(2, hop * 1.05));
      gl.uniform1f(gl.getUniformLocation(pprog, 'uTime'), time);
      gl.uniform1f(gl.getUniformLocation(pprog, 'uMotion'), reduced ? 0 : 1);
      gl.uniform4f(gl.getUniformLocation(pprog, 'uWave'), wp.w[0], wp.w[1], wp.w[2], wp.w[3]);
      gl.uniform2f(gl.getUniformLocation(pprog, 'uPh'), wp.ph[0], wp.ph[1]);
      gl.drawArrays(gl.POINTS, 0, nPts);
      gl.disableVertexAttribArray(la);
      gl.disable(gl.BLEND);
    }
  }
  function upload(unit, tex, data, w, rows) {
    gl.activeTexture(unit); gl.bindTexture(gl.TEXTURE_2D, tex);
    if (!rows) return;
    var h = rows[1] - rows[0] + 1;
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, rows[0], w, h, gl.RGBA, gl.UNSIGNED_BYTE, data.subarray(rows[0] * w * 4, (rows[1] + 1) * w * 4));
  }

  // ------------------------------------------------------------------ canvas 2D fallback
  var c2 = null, sprites = null, lensSprites = null;
  function radial(rgb, a0) {
    var c = document.createElement('canvas'); c.width = c.height = 32;
    var x = c.getContext('2d'), g = x.createRadialGradient(16, 16, 0, 16, 16, 16), s = rgb.join(',');
    g.addColorStop(0, 'rgba(' + s + ',' + a0 + ')'); g.addColorStop(0.5, 'rgba(' + s + ',' + (a0 * 0.4) + ')'); g.addColorStop(1, 'rgba(' + s + ',0)');
    x.fillStyle = g; x.fillRect(0, 0, 32, 32);
    return c;
  }
  function mixRGB(a, b, t) { return [0, 1, 2].map(function (k) { return Math.round(a[k] + (b[k] - a[k]) * t); }); }
  function initCanvas2D() {
    c2 = glCanvas.getContext('2d');
    if (!c2) return false;
    var cols = [[92, 204, 189], [247, 219, 153], [250, 148, 133], [143, 158, 250], [240, 255, 250]];
    sprites = cols.map(function (c) { return radial(c, 0.55); });
    lensSprites = { 1: [], 2: [] };
    for (var k = 0; k <= 8; k++) {
      var v = k / 4 - 1;   // -1 .. 1
      lensSprites[1].push(radial(v < 0 ? mixRGB([60, 70, 80], [77, 143, 255], -v) : mixRGB([60, 70, 80], [255, 179, 71], v), 0.6));
      lensSprites[2].push(radial(mixRGB([41, 87, 168], [255, 204, 82], (v + 1) / 2), 0.6));   // voltage memory 0 .. 1
    }
    return true;
  }
  function draw2D() {
    var ctx = c2, w = glCanvas.width, h = glCanvas.height, k = dprR;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    var g = ctx.createRadialGradient(w / 2, h * 0.45, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
    g.addColorStop(0, '#0d1c19'); g.addColorStop(1, '#040908');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    var size = Math.max(3, cam.s * 2.6) * k;
    for (var n = 0, q = 0; n < nPts; n++, q += PSTRIDE) {
      var p = w2s(pts[q], pts[q + 1] + wave(pts[q], time));
      var spr = S.lens ? lensSprites[S.lens][Math.max(0, Math.min(8, Math.round((pts[q + 4] + 1) * 4)))] : sprites[pts[q + 2]];
      ctx.drawImage(spr, p[0] * k - size / 2, p[1] * k - size / 2, size, size);
    }
    ctx.globalCompositeOperation = 'source-over';
    var m = model;
    ctx.fillStyle = 'rgba(4,8,8,0.9)';
    for (var e = 0; e < m.N; e++) {
      if (m.state[e] !== BM.LIVE || m.ident[e] !== ID.EYE) continue;
      var X = m.X(e) + m.offX[e], Y = m.Y(e) + m.offY[e];
      var s2 = w2s(X, Y + wave(X, time));
      ctx.beginPath(); ctx.arc(s2[0] * k, s2[1] * k, Math.max(1, cam.s * 0.7) * k, 0, 6.2832); ctx.fill();
    }
  }

  // ------------------------------------------------------------------ overlay (knife, brush, guide)
  var drag = null, hover = null, trails = [], kbd = false, guideX = 0, labels = [], labelFont = '';
  function brushRadius() { return 0.075 * L0; }

  function drawUI() {
    var ctx = uictx;
    ctx.clearRect(0, 0, W, H);
    // fading slices
    for (var i = trails.length - 1; i >= 0; i--) {
      var tr = trails[i], age = time - tr.t;
      if (age > 0.9) { trails.splice(i, 1); continue; }
      var a = 1 - age / 0.9;
      var p0 = w2s(tr.a[0], tr.a[1]), p1 = w2s(tr.b[0], tr.b[1]);
      line(ctx, p0, p1, 'rgba(210,255,245,' + (0.16 * a) + ')', 7);
      line(ctx, p0, p1, 'rgba(235,255,250,' + (0.85 * a) + ')', 1.4);
    }
    // first visit: a faint ghost of the knife shows the gesture until the visitor tries it
    if (!PREVIEW && !S.touched && S.cuts === 0 && !drag && !kbd && S.tool === 'knife' && time > 1.2) {
      var cyc = reduced ? 0.62 : ((time - 1.2) % 4.6) / 4.6;
      var f = Math.min(1, Math.max(0, (cyc - 0.08) / 0.5));
      f = f * f * (3 - 2 * f);
      var env = reduced ? 1 : Math.min(1, cyc / 0.08, (1 - cyc) / 0.25);
      if (env > 0) {
        var gx = bbox.minX + 0.44 * (bbox.maxX - bbox.minX);
        var g0 = w2s(gx - 4, bbox.minY - 8 + wave(gx, time)), g1 = w2s(gx + 4, bbox.maxY + 8 + wave(gx, time));
        var gp = [g0[0] + (g1[0] - g0[0]) * f, g0[1] + (g1[1] - g0[1]) * f];
        ctx.setLineDash([3, 6]);
        line(ctx, g0, gp, 'rgba(235,255,250,' + (0.42 * env) + ')', 1.2);
        ctx.setLineDash([]);
        dot(ctx, gp, 9, 'rgba(235,255,250,' + (0.08 * env) + ')');
        dot(ctx, gp, 3, 'rgba(235,255,250,' + (0.55 * env) + ')');
      }
    }
    if (drag && S.tool === 'knife' && !PREVIEW) {
      line(ctx, drag.a, drag.b, 'rgba(210,255,245,0.18)', 7);
      line(ctx, drag.a, drag.b, 'rgba(240,255,252,0.9)', 1.3);
      dot(ctx, drag.a, 2.5, 'rgba(240,255,252,0.9)');
    }
    if (S.tool === 'brush' && hover && !PREVIEW) {
      var r = brushRadius() * cam.s;
      ctx.beginPath(); ctx.arc(hover[0], hover[1], r, 0, 6.2832);
      ctx.strokeStyle = 'rgba(255,222,150,0.85)'; ctx.lineWidth = 1.2; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
      dot(ctx, hover, 1.8, 'rgba(255,222,150,0.9)');
    }
    if (kbd && document.activeElement === ui && !PREVIEW) {
      var g0 = w2s(guideX, bbox.minY - 8), g1 = w2s(guideX, bbox.maxY + 8);
      ctx.setLineDash([6, 6]);
      line(ctx, g0, g1, S.tool === 'knife' ? 'rgba(235,255,250,0.85)' : 'rgba(255,222,150,0.9)', 1.3);
      ctx.setLineDash([]);
    }
    // quiet labels at the poles of finished worms
    if (!PREVIEW && labels.length) {
      if (!labelFont) labelFont = '12px ' + getComputedStyle(document.body).fontFamily;
      ctx.font = labelFont;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      labels.forEach(function (l) {
        var p = w2s(l.X, l.Y + wave(l.X, time));
        if (portrait) { ctx.textAlign = 'left'; p[0] += 8; } else p[1] += 10;
        ctx.fillStyle = l.type === BM.HEAD ? 'rgba(250,228,180,0.75)' : 'rgba(196,204,255,0.75)';
        ctx.fillText(l.type === BM.HEAD ? 'head' : 'tail', p[0], p[1]);
      });
    }
    // preview knife sweep
    if (PREVIEW && pv.sweep) {
      var sw = pv.sweep;
      line(ctx, sw.a, sw.b, 'rgba(210,255,245,0.2)', 6);
      line(ctx, sw.a, sw.b, 'rgba(240,255,252,0.95)', 1.2);
    }
    if (PREVIEW && pv.fade > 0) { ctx.fillStyle = 'rgba(4,9,8,' + pv.fade + ')'; ctx.fillRect(0, 0, W, H); }
  }
  function line(ctx, a, b, style, w) {
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
    ctx.strokeStyle = style; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.stroke();
  }
  function dot(ctx, p, r, style) { ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 6.2832); ctx.fillStyle = style; ctx.fill(); }

  function localPoint(e) { var r = ui.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

  function doCut(a, b) {
    var la = s2lattice(a[0], a[1]), lb = s2lattice(b[0], b[1]);
    prepKey = ''; var removed = model.cut(la[0], la[1], lb[0], lb[1]);
    trails.push({ a: [la[0], la[1] + wave(la[0], time)], b: [lb[0], lb[1] + wave(lb[0], time)], t: time });
    if (removed) afterCut();
    return removed;
  }
  function afterCut() {
    S.cuts++;
    if (S.rewritten) S.cutsAfterRewrite++;
    S.lastCutStep = model.t;
    S.focus = null;
    refreshGuide(true);
  }
  function doPaint(p) {
    var l = s2lattice(p[0], p[1]);
    prepKey = ''; if (model.paint(l[0], l[1], brushRadius())) { S.painting = true; refreshGuide(true); }
  }

  if (!PREVIEW) {
    ui.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      kbd = false; S.touched = true;
      ui.focus({ preventScroll: true });
      try { ui.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      var p = localPoint(e);
      drag = { a: p, b: p, id: e.pointerId };
      hover = p;
      if (S.tool === 'brush') doPaint(p);
      e.preventDefault();
      wake();
    });
    ui.addEventListener('pointermove', function (e) {
      var p = localPoint(e);
      hover = p;
      if (drag && e.pointerId === drag.id) {
        if (S.tool === 'brush') {
          // paint along the stroke so fast strokes leave no gaps
          var a = drag.b, d = Math.hypot(p[0] - a[0], p[1] - a[1]), stepPx = Math.max(4, brushRadius() * cam.s * 0.5);
          for (var s = stepPx; s < d; s += stepPx) doPaint([a[0] + (p[0] - a[0]) * s / d, a[1] + (p[1] - a[1]) * s / d]);
          doPaint(p);
        }
        drag.b = p;
      }
      wake();
    });
    function end(e) {
      if (!drag || e.pointerId !== drag.id) return;
      if (S.tool === 'knife' && e.type === 'pointerup') {
        var d = Math.hypot(drag.b[0] - drag.a[0], drag.b[1] - drag.a[1]);
        if (d > 8) doCut(drag.a, drag.b);
      }
      drag = null;
      wake();
    }
    ui.addEventListener('pointerup', end);
    ui.addEventListener('pointercancel', end);
    ui.addEventListener('pointerleave', function () { if (!drag) { hover = null; wake(); } });

    ui.addEventListener('keydown', function (e) {
      var k = e.key, step = e.shiftKey ? 8 : 2;
      S.touched = true;
      var fwd = portrait ? ['ArrowUp', 'ArrowRight'] : ['ArrowRight', 'ArrowUp'];
      var back = portrait ? ['ArrowDown', 'ArrowLeft'] : ['ArrowLeft', 'ArrowDown'];
      if (fwd.indexOf(k) >= 0 || back.indexOf(k) >= 0) {
        if (!kbd) { kbd = true; guideX = (bbox.minX + bbox.maxX) / 2; }
        else guideX += (fwd.indexOf(k) >= 0 ? 1 : -1) * step;
        guideX = Math.max(bbox.minX - 4, Math.min(bbox.maxX + 4, guideX));
        e.preventDefault(); wake(); return;
      }
      if (k === 'Enter' || k === ' ') {
        if (!kbd) { kbd = true; guideX = (bbox.minX + bbox.maxX) / 2; wake(); e.preventDefault(); return; }
        var y0 = bbox.minY - 10, y1 = bbox.maxY + 10;
        if (S.tool === 'knife') {
          prepKey = ''; var removed = model.cut(guideX, y0, guideX, y1);
          trails.push({ a: [guideX, y0], b: [guideX, y1], t: time });
          if (removed) afterCut();
        } else {
          prepKey = ''; for (var y = y0; y <= y1; y += brushRadius() * 0.6) if (model.paint(guideX, y, brushRadius())) S.painting = true;
          refreshGuide(true);
        }
        e.preventDefault(); wake();
      }
    });
    ui.addEventListener('focus', function () { wake(); });
    ui.addEventListener('blur', function () { kbd = false; wake(); });

    // Controls
    var knifeBtn = $('bl-knife'), brushBtn = $('bl-brush');
    function setTool(t) {
      S.tool = t;
      knifeBtn.setAttribute('aria-pressed', t === 'knife' ? 'true' : 'false');
      brushBtn.setAttribute('aria-pressed', t === 'brush' ? 'true' : 'false');
      ui.classList.toggle('is-brush', t === 'brush');
      ui.setAttribute('aria-label', t === 'knife'
        ? 'Worm. Drag across it to cut. With the keyboard, the arrow keys move a guide line and Enter cuts along it.'
        : 'Worm. Touch or drag over it to set its voltage memory to head-like. With the keyboard, the arrow keys move a guide line and Enter paints along it.');
      if (t === 'brush' && S.lens === 0) setLens(2);
      refreshGuide(true); wake();
    }
    knifeBtn.addEventListener('click', function () { setTool('knife'); });
    brushBtn.addEventListener('click', function () { setTool('brush'); });
    var lensBtns = Array.prototype.slice.call(document.querySelectorAll('[data-lens]'));
    function setLens(n) {
      S.lens = n;
      lensBtns.forEach(function (b) { b.setAttribute('aria-pressed', +b.getAttribute('data-lens') === n ? 'true' : 'false'); });
      var lg = $('bl-legend');
      if (n === 0) { lg.hidden = true; lg.innerHTML = ''; }
      else if (n === 1) {
        lg.hidden = false;
        lg.innerHTML = '<span><i class="bl-swatch" style="background:#ffb347"></i>Amber: signal from head organisers</span>' +
          '<span><i class="bl-swatch" style="background:#4d8fff"></i>Blue: signal from tail organisers</span>' +
          '<span>Lines join cells that read the same level</span>';
      } else {
        lg.hidden = false;
        lg.innerHTML = '<span><i class="bl-swatch" style="background:linear-gradient(90deg,#2957a8,#ffcc52)"></i>Voltage memory: blue is normal, gold is head-like</span>' +
          '<span>An untouched worm reads the same everywhere; lines mark a spreading front</span>';
      }
      wake();
    }
    lensBtns.forEach(function (b) { b.addEventListener('click', function () { setLens(+b.getAttribute('data-lens')); }); });
    $('bl-speed').addEventListener('change', function (e) { S.speed = +e.target.value; wake(); });
    $('bl-reset').addEventListener('click', function () {
      newModel();
      // S.sawWhole is kept: a visitor who has seen pieces rebuild is guided straight to the rewrite.
      S.cuts = 0; S.cutsAfterRewrite = 0; S.rewritten = false; S.painting = false; S.twinSeen = false; S.focus = null;
      trails = []; drag = null;
      measure(); prepare(); fitCamera(bbox, 1);
      refreshGuide(true); wake();
    });
  }

  // ------------------------------------------------------------------ guidance
  var lastGuide = 0, statusText = '', captionText = '';
  var steps = Array.prototype.slice.call(document.querySelectorAll('.bl-steps li'));
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  var NUM = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
  function word(n) { return n < NUM.length ? NUM[n] : String(n); }

  function refreshGuide(force) {
    if (PREVIEW) return;
    if (!force && time - lastGuide < 0.4) return;
    lastGuide = time;
    var bodies = model.bodies();
    var minLen = 0.2 * L0;
    var big = bodies.filter(function (b) { return b.length >= minLen && b.n > 40; });
    var small = bodies.filter(function (b) { return !(b.length >= minLen && b.n > 40); });
    var rebuilding = big.filter(function (b) { return !(b.wound === 0 && b.blast === 0 && b.valid === b.n && b.heads + b.tails === 2) || b.young > b.n * 0.06; });
    var twins = big.filter(function (b) { return b.heads === 2 && b.tails === 0; });
    labels = [];
    big.forEach(function (b) {
      if (rebuilding.indexOf(b) >= 0) return;
      b.orgs.forEach(function (o) {
        // just below the organiser, clear of the body
        labels.push({ X: o.X + (o.X > b.cx ? -2 : 2), Y: b.maxY + 1, type: o.type });
      });
    });
    var memMax = 0, memAny = 0;
    bodies.forEach(function (b) { memMax = Math.max(memMax, b.mem); });
    if (memMax > 0.9) S.rewritten = true;
    var finishedTwins = twins.filter(function (b) { return rebuilding.indexOf(b) < 0; });
    if (finishedTwins.length && !S.twinSeen) {
      // the first two-headed worm is finished: ease the camera towards the largest one
      var tw = finishedTwins.reduce(function (a, b) { return b.n > a.n ? b : a; });
      S.focus = { minX: tw.minX, maxX: tw.maxX, minY: tw.minY, maxY: tw.maxY };
    }
    if (finishedTwins.length) S.twinSeen = true;
    if (S.cuts > 0 && big.length && !rebuilding.length) S.sawWhole = true;
    var painting = !S.rewritten && memMax > 0.02;

    // caption and step
    var step, cap;
    if (rebuilding.length && S.cuts > 0) {
      step = S.cutsAfterRewrite ? 4 : 2;
      cap = S.cutsAfterRewrite
        ? 'Watch the cut ends. With the memory head-like, a cut end that would have grown a tail grows a head.'
        : 'Each piece is rebuilding what it lost: a pale bud at the cut, then a new head or tail, then the old tissue reshapes into a smaller whole.';
    } else if (S.twinSeen) {
      step = 5;
      cap = 'Two heads, from the same cells and the same rules: the change is held in the cells’ memory, not in their rule book. Cut it again and it persists.';
    } else if (S.rewritten) {
      step = 4;
      cap = 'The memory now reads head-like, but the body has not changed. Choose the knife and cut the worm across its middle.';
    } else if (painting) {
      step = 3;
      cap = 'The head-like value is passing from cell to cell. The memory is a two-state switch: once tipped, it takes over the whole body.';
    } else if (S.sawWhole && S.cuts > 0) {
      step = 3;
      cap = 'Each piece is a whole, smaller worm again. Next, press Reset for a fresh worm, then choose the rewrite brush and touch it.';
    } else if (S.sawWhole) {
      step = 3;
      cap = 'A fresh worm. Choose the rewrite brush and touch the worm anywhere.';
    } else {
      step = 1;
      cap = 'Drag across the worm to cut it.';
    }
    steps.forEach(function (li, k) {
      var n = k + 1;
      if (n === step) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
      li.classList.toggle('is-done', n < step);
    });
    if (cap !== captionText) {
      captionText = cap;
      var ce = $('bl-caption');
      ce.textContent = cap;
      ce.classList.remove('is-new'); void ce.offsetWidth; ce.classList.add('is-new');
    }

    // status
    var parts = [];
    if (!big.length) parts.push('No piece is large enough to rebuild.');
    else {
      var whole = big.length - rebuilding.length;
      if (big.length === 1) {
        var b = big[0];
        parts.push(rebuilding.length ? 'One worm, rebuilding.' : 'One worm: ' + headsTails(b) + '.');
      } else {
        var s = word(big.length) + ' worms';
        if (rebuilding.length === big.length) s += ', all rebuilding';
        else if (rebuilding.length) s += ': ' + whole + ' whole, ' + rebuilding.length + ' rebuilding';
        else s += ', all whole';
        parts.push(s + '.');
        if (twins.length) parts.push((twins.length === 1 ? 'One has' : word(twins.length) + ' have') + ' two heads.');
      }
    }
    var fading = small.filter(function (b) { return b.n >= 6; });
    if (fading.length) parts.push(fading.length === 1 ? 'One piece is too small to rebuild and is fading.' : word(fading.length) + ' pieces are too small to rebuild and are fading.');
    if (S.rewritten) parts.push('Voltage memory: head-like.');
    else if (painting) parts.push('Voltage memory: changing.');
    var st = parts.join(' ');
    if (st !== statusText) { statusText = st; $('bl-status').textContent = st; }
  }
  function headsTails(b) {
    var h = b.heads === 1 ? 'one head' : plural(b.heads, 'head', 'heads');
    var t = b.tails === 1 ? 'one tail' : b.tails === 0 ? 'no tail' : plural(b.tails, 'tail', 'tails');
    if (b.heads === 2 && b.tails === 0) return 'two heads, no tail';
    return h + ', ' + t;
  }

  // ------------------------------------------------------------------ preview loop
  var pv = { t: 0, cut: false, sweep: null, fade: 0, LOOP: 12, CUT_AT: 1.8, SWEEP: 0.5, RATE: 150 };
  function previewCutLine() {
    var b = bbox;
    var X = b.minX + 0.47 * (b.maxX - b.minX), cy = (b.minY + b.maxY) / 2, half = (b.maxY - b.minY) * 0.9 + 6;
    var th = 0.2;
    return { a: [X - Math.sin(th) * half, cy - Math.cos(th) * half], b: [X + Math.sin(th) * half, cy + Math.cos(th) * half] };
  }
  function previewAdvance(dt) {
    pv.t += dt;
    if (pv.t >= pv.LOOP) {
      pv.t -= pv.LOOP;
      newModel(7); pv.cut = false; prepare(time); fitCamera(bbox, 1);
    }
    var t = pv.t;
    pv.fade = t < 0.5 ? 1 - t / 0.5 : t > pv.LOOP - 0.8 ? (t - (pv.LOOP - 0.8)) / 0.8 : 0;
    pv.sweep = null;
    if (!pv.cut && t >= pv.CUT_AT - pv.SWEEP) {
      var L = previewCutLine();
      var f = Math.min(1, (t - (pv.CUT_AT - pv.SWEEP)) / pv.SWEEP);
      var a = [L.a[0], L.a[1] + wave(L.a[0], time)], b = [L.b[0], L.b[1] + wave(L.b[0], time)];
      var p0 = w2s(a[0], a[1]), p1 = w2s(b[0], b[1]);
      pv.sweep = { a: p0, b: [p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f] };
      if (t >= pv.CUT_AT) {
        prepKey = ''; model.cut(L.a[0], L.a[1], L.b[0], L.b[1]);
        trails.push({ a: a, b: b, t: time });
        pv.cut = true; pv.sweep = null;
      }
    }
    if (pv.cut) {
      simAcc += dt * pv.RATE;
      var n = Math.min(8, Math.floor(simAcc));
      simAcc -= n;
      if (n) model.step(n);
    }
  }
  // Jump the preview to a representative moment (used for the still frame).
  function previewSeek(target) {
    newModel(7); pv.cut = false; pv.t = 0;
    prepare(time); fitCamera(bbox, 1);
    var L = previewCutLine();
    model.cut(L.a[0], L.a[1], L.b[0], L.b[1]);
    pv.cut = true;
    model.step(Math.round((target - pv.CUT_AT) * pv.RATE));
    pv.t = target;
    decayOffsets(10);
  }

  // ------------------------------------------------------------------ main loop
  var raf = 0, lastT = 0, playing = false, dirty = true;
  var drifting = true;              // pieces still easing apart after a cut
  function decayOffsets(dt) {
    var m = model, k = Math.exp(-dt / 0.55), any = false;
    for (var i = 0; i < m.N; i++) {
      if (!m.state[i]) continue;
      if (m.offX[i] !== 0) { m.offX[i] *= k; if (Math.abs(m.offX[i]) < 0.01) m.offX[i] = 0; else any = true; }
      if (m.offY[i] !== 0) { m.offY[i] *= k; if (Math.abs(m.offY[i]) < 0.01) m.offY[i] = 0; else any = true; }
    }
    drifting = any;
  }
  // The field textures are rebuilt only when something they show has changed. While the pieces
  // drift apart this happens every frame; otherwise at most 30 times a second (the cells change
  // a step at a time, and the sway is drawn by the GPU).
  var prepKey = '', prepAt = -1;
  function maybePrepare(force) {
    var key = model.t + ':' + S.lens + ':' + model.seed;
    if (!force && !drifting && key === prepKey) return;
    if (!force && !drifting && playing && time - prepAt < 1 / 31) return;
    prepare(); prepKey = key; prepAt = time;
  }
  function render(throttled) {
    maybePrepare(!throttled);
    fitCamera(S.focus || bbox, cam.ready ? 0.04 : 1);
    if (gl) drawGL(); else if (c2) draw2D();
    drawUI();
  }
  function frame(now) {
    raf = 0;
    var dt = lastT ? Math.min(0.1, (now - lastT) / 1000) : 1 / 60;
    lastT = now;
    if (!reduced || !PREVIEW) time += dt;
    if (PREVIEW) previewAdvance(dt);
    else if (S.speed > 0) {
      simAcc += dt * STEPS_PER_SEC * S.speed;
      var n = Math.min(12, Math.floor(simAcc));
      simAcc -= n;
      var t0 = performance.now();
      for (var s = 0; s < n; s++) { model.step(1); if (performance.now() - t0 > 8) { simAcc = 0; break; } }
    }
    decayOffsets(dt);
    render(true);
    refreshGuide(false);
    if (playing) raf = requestAnimationFrame(frame);
  }
  function wake() {
    if (playing) { if (!raf) raf = requestAnimationFrame(frame); }
    else render();
  }
  function setPlaying(p) {
    playing = p;
    if (p) { lastT = 0; if (!raf) raf = requestAnimationFrame(frame); }
    else { if (raf) cancelAnimationFrame(raf); raf = 0; render(); }
  }

  // ------------------------------------------------------------------ start
  measure();
  var ok = initGL();
  if (!ok) initCanvas2D();
  glCanvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); if (raf) cancelAnimationFrame(raf); raf = 0; gl = null; });
  glCanvas.addEventListener('webglcontextrestored', function () { if (initGL()) { glAllocTextures(); wake(); } });

  if (PREVIEW) {
    previewSeek(2.8);           // a still that tells the story: a clean cut, a pale bud on each cut face
  } else {
    newModel();
  }
  prepare(time); fitCamera(bbox, 1);
  if (!PREVIEW) refreshGuide(true);
  render();

  var ro = window.ResizeObserver ? new ResizeObserver(function () { measure(); cam.ready = false; render(); }) : null;
  if (ro) ro.observe(view); else window.addEventListener('resize', function () { measure(); cam.ready = false; render(); });

  Kit.onPlay(function (p) { reduced = Kit.reducedMotion; setPlaying(p); });

  // For checking in a browser console, only with ?debug in the address (not used by the page).
  if (/[?&]debug\b/.test(location.search)) window.__blastema = {
    model: function () { return model; }, state: S, cam: cam,
    timeRender: function (n) { var t0 = performance.now(), a = 0, b = 0; for (var k = 0; k < n; k++) { var t1 = performance.now(); prepare(); a += performance.now() - t1; t1 = performance.now(); if (gl) { fullUpload = false; upRows.a = [0, TH - 1]; upRows.w = [0, WH - 1]; drawGL(); gl.finish(); } b += performance.now() - t1; } return { prepare: a / n, draw: b / n, total: (performance.now() - t0) / n }; },
    cut: function (a, b) { return doCut(w2s(a[0], a[1]), w2s(b[0], b[1])); },
    advance: function (n, dt) { for (var k = 0; k < n; k++) { model.step(1); } time += dt || 0; decayOffsets(5); render(); refreshGuide(true); return model.t; },
    tick: function (frames, dt) {     // run the loop's timing without animation frames
      for (var k = 0; k < frames; k++) { time += dt; if (PREVIEW) previewAdvance(dt); decayOffsets(dt); }
      render(); return { loopT: pv.t, cut: pv.cut, step: model.t, fade: pv.fade };
    },
    seek: function (t) { previewSeek(t); time += 0.5; render(); return model.t; },
    screen: function (X, Y) { var r = ui.getBoundingClientRect(), p = w2s(X, Y + wave(X, time)); return [p[0] + r.left, p[1] + r.top]; },
    lens: function (n) { var b = document.querySelector('[data-lens="' + n + '"]'); if (b) b.click(); }
  };
})();
