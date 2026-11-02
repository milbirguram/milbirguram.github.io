/* Stencil page. Loads eight test fields (raw image, true mask, U-Net probability map, all
   8-bit PNGs), and recomputes every score from those pixels whenever a control moves. */
(function () {
  'use strict';
  var M = window.StencilModel;
  var MAN = window.STENCIL_MANIFEST;
  var Kit = window.Kit || { preview: false, onPlay: function (cb) { cb(true); }, reducedMotion: false };
  if (!M || !MAN) return;

  var H = MAN.crop[0], W = MAN.crop[1], N = W * H;
  var UM_PER_PX = MAN.um_per_px;
  var PREVIEW = Kit.preview;
  var PREVIEW_FIELD = 'f1';

  var $ = function (id) { return document.getElementById(id); };
  var stage = document.querySelector('[data-kit-stage]');
  var fieldCanvas = $('field'), fctx = fieldCanvas.getContext('2d');
  var sweepCanvas = $('sweep'), sctx = sweepCanvas.getContext('2d');
  var thresholdInput = $('threshold'), wipeInput = $('wipe');

  var state = { field: 0, t: 0.5, source: 'unet', layer: 'errors', wipe: 40, pulse: 1 };

  // Per-field data, filled as PNGs arrive.
  var fields = MAN.images.map(function (meta) {
    return { meta: meta, raw: null, truth: null, prob: null, otsu: null, sweep: null, truthBlobs: 0, share: 0, ready: false };
  });

  // Scratch buffers so slider moves do not allocate.
  var predBuf = new Uint8Array(N), tableBuf = new Uint8Array(N), nothing = new Uint8Array(N);
  var labelBuf = new Int32Array(N), stackBuf = new Int32Array(N);
  // Off-screen layers, stacked when the field is drawn: the raw image in DAPI colours, the
  // same image dimmed (overlay side of the wipe), a tint for nuclei found (or the mask
  // shown), and the error marks, drawn at the pulse's opacity. Only the last two depend on
  // the threshold; a wipe move or a pulse frame recomputes nothing.
  function layer() {
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var x = c.getContext('2d');
    var im = x.createImageData(W, H);
    return { canvas: c, ctx: x, img: im, px: im.data, u32: new Uint32Array(im.data.buffer) };
  }
  var rawLayer = layer(), dimLayer = layer(), tintLayer = layer(), marks = layer();
  // RGBA packed for little-endian Uint32 writes (every browser this page targets).
  function rgba(r, g, b, a) { return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0; }
  var TINT_ERR = rgba(79, 124, 255, 107), TINT_MASK = rgba(79, 124, 255, 158);
  var FP_LINE = rgba(255, 79, 216, 242), FP_FILL = rgba(255, 79, 216, 82);     // magenta, hatched
  var FN_DOT = rgba(61, 220, 132, 250), FN_FILL = rgba(61, 220, 132, 77);      // green, dotted
  var THRESHOLDS = M.sliderThresholds();

  // DAPI look-up table: black -> #4f7cff -> pale blue-white for the brightest pixels.
  var LUT = new Uint8Array(256 * 3);
  (function () {
    for (var v = 0; v < 256; v++) {
      var t = v / 255, a = Math.min(1, t * 1.35), b = Math.max(0, (t - 0.72) / 0.28);
      LUT[v * 3] = Math.round((0x4f * a) * (1 - b) + 0xe4 * b);
      LUT[v * 3 + 1] = Math.round((0x7c * a) * (1 - b) + 0xeb * b);
      LUT[v * 3 + 2] = Math.round((0xff * a) * (1 - b) + 0xff * b);
    }
  })();

  // ------------------------------------------------------------------ loading

  function loadGray(src) {
    // createImageBitmap with colour conversion off keeps the bytes exactly as stored.
    var opts = { colorSpaceConversion: 'none', premultiplyAlpha: 'none' };
    return fetch(src).then(function (r) {
      if (!r.ok) throw new Error('could not load ' + src);
      return r.blob();
    }).then(function (blob) {
      return window.createImageBitmap ? createImageBitmap(blob, opts) : blobToImage(blob);
    }).then(function (bmp) {
      var c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      var x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(bmp, 0, 0);
      if (bmp.close) bmp.close();
      return M.redChannel(x.getImageData(0, 0, c.width, c.height).data);
    });
  }

  function blobToImage(blob) {
    return new Promise(function (resolve, reject) {
      var im = new Image();
      im.onload = function () { resolve(im); };
      im.onerror = reject;
      im.src = URL.createObjectURL(blob);
    });
  }

  function loadField(f) {
    var dir = 'data/';
    return Promise.all([loadGray(dir + f.meta.files.raw), loadGray(dir + f.meta.files.truth), loadGray(dir + f.meta.files.prob)])
      .then(function (arr) {
        f.raw = arr[0];
        f.truth = M.binarise(arr[1]);
        f.prob = arr[2];
        // Otsu's cut was chosen from the whole field's histogram (train/export.py records
        // the byte); the mask and its scores are computed here from the crop's pixels.
        f.otsu = M.aboveCut(f.raw, f.meta.otsu_cut_whole_field);
        f.otsuScores = M.scores(M.confusion(f.otsu, f.truth));
        f.nothingScores = M.scores(M.confusion(nothing, f.truth));
        f.sweep = M.sweep(f.prob, f.truth, THRESHOLDS);
        f.best = M.bestThresholds(f.sweep);
        f.truthBlobs = M.countBlobs(f.truth, W, H, M.MIN_AREA, labelBuf, stackBuf);
        // Blob counts by setting ('u0.50', 'otsu', 'nothing'), filled as they are computed.
        f.blobs = {
          otsu: M.countBlobs(f.otsu, W, H, M.MIN_AREA, labelBuf, stackBuf),
          nothing: M.countBlobs(nothing, W, H, M.MIN_AREA, labelBuf, stackBuf)
        };
        var fg = 0;
        for (var i = 0; i < N; i++) fg += f.truth[i];
        f.share = fg / N;
        f.ready = true;
      });
  }

  // ------------------------------------------------------------------ scoring

  function predictionFor(f, source, t, out) {
    if (source === 'nothing') return nothing;
    if (source === 'otsu') return f.otsu;
    return M.threshold(f.prob, t, out);
  }

  function settingKey() { return state.source === 'unet' ? 'u' + state.t.toFixed(2) : state.source; }

  // A fresh, uncached evaluation (for checking in the console).
  function evaluate(f, withCount) {
    var pred = predictionFor(f, state.source, state.t, new Uint8Array(N));
    var s = M.scores(M.confusion(pred, f.truth));
    if (withCount) s.blobs = M.countBlobs(pred, W, H, M.MIN_AREA);
    s.pred = pred;
    return s;
  }

  // The viewed field, recomputed from its pixels whenever the field or setting changes.
  var current = { key: '', s: null };
  function evaluateCurrent(withCount) {
    var f = fields[state.field], key = state.field + '|' + settingKey() + (withCount ? '|n' : '');
    if (current.key === key) return current.s;
    var pred = predictionFor(f, state.source, state.t, predBuf);
    var s = M.scores(M.confusion(pred, f.truth));
    if (withCount) {
      s.blobs = M.countBlobs(pred, W, H, M.MIN_AREA, labelBuf, stackBuf);
      f.blobs[settingKey()] = s.blobs;
    }
    s.pred = pred;
    current = { key: key, s: s };
    return s;
  }

  // Scores of any loaded field at the current setting. For the U-Net these come from the
  // field's sweep, which gives exactly the counts threshold() + confusion() would.
  function scoresFor(f) {
    if (state.source === 'nothing') return f.nothingScores;
    if (state.source === 'otsu') return f.otsuScores;
    return f.sweep[M.sweepIndex(state.t)];
  }

  function fmt(x, d) { return x.toFixed(d == null ? 3 : d); }
  function pct(x) { return (x * 100).toFixed(1) + '%'; }
  function setText(el, text) { if (el.textContent !== text) el.textContent = text; }

  // ------------------------------------------------------------------ drawing the field

  var composed = '', rawField = -1;
  function composeRaw(f) {
    if (rawField === state.field) return;
    rawField = state.field;
    var raw = f.raw, a = rawLayer.px, d = dimLayer.px;
    for (var i = 0, o = 0; i < N; i++, o += 4) {
      var v = raw[i] * 3;
      a[o] = LUT[v]; a[o + 1] = LUT[v + 1]; a[o + 2] = LUT[v + 2]; a[o + 3] = 255;
      d[o] = LUT[v] >> 1; d[o + 1] = LUT[v + 1] >> 1; d[o + 2] = LUT[v + 2] >> 1; d[o + 3] = 255;
    }
    rawLayer.ctx.putImageData(rawLayer.img, 0, 0);
    dimLayer.ctx.putImageData(dimLayer.img, 0, 0);
  }

  function compose(f, pred) {
    composeRaw(f);
    var key = state.field + '|' + settingKey() + '|' + state.layer;
    if (key === composed) return;
    composed = key;
    var truth = f.truth, tint = tintLayer.u32, mk = marks.u32, L = state.layer;
    for (var y = 0, i = 0; y < H; y++) {
      var dotRow = (y % 5) < 2;
      for (var x = 0; x < W; x++, i++) {
        var p = pred[i], g = truth[i], tv = 0, mv = 0;
        if (L === 'errors') {
          if (p) { if (g) tv = TINT_ERR; else mv = ((x + y) % 6) < 2 ? FP_LINE : FP_FILL; }
          else if (g) mv = dotRow && (x % 5) < 2 ? FN_DOT : FN_FILL;
        } else if (L === 'truth' ? g : p) tv = TINT_MASK;
        tint[i] = tv; mk[i] = mv;
      }
    }
    tintLayer.ctx.putImageData(tintLayer.img, 0, 0);
    marks.ctx.putImageData(marks.img, 0, 0);
  }

  function sizeCanvas(c) {
    var r = c.getBoundingClientRect();
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    return { w: w, h: h, dpr: dpr };
  }

  function drawField(f, pred) {
    var s = sizeCanvas(fieldCanvas);
    compose(f, pred);
    // Fit (page) or cover (preview) the 4:3 field into the canvas.
    var scale = PREVIEW ? Math.max(s.w / W, s.h / H) : Math.min(s.w / W, s.h / H);
    var dw = W * scale, dh = H * scale, dx = (s.w - dw) / 2, dy = (s.h - dh) / 2;
    fctx.fillStyle = '#000';
    fctx.fillRect(0, 0, s.w, s.h);
    fctx.imageSmoothingEnabled = false;
    fctx.drawImage(rawLayer.canvas, dx, dy, dw, dh);
    var sx = Math.round(W * state.wipe / 100);
    if (sx < W) {
      // Overlay side of the wipe: dimmed image, tint, then the pulsing error marks.
      var ox = dx + sx * scale, ow = (W - sx) * scale;
      fctx.drawImage(dimLayer.canvas, sx, 0, W - sx, H, ox, dy, ow, dh);
      fctx.drawImage(tintLayer.canvas, sx, 0, W - sx, H, ox, dy, ow, dh);
      if (state.layer === 'errors') {
        fctx.globalAlpha = state.pulse;
        fctx.drawImage(marks.canvas, sx, 0, W - sx, H, ox, dy, ow, dh);
        fctx.globalAlpha = 1;
      }
    }

    // Wipe line.
    if (!PREVIEW || state.wipe > 0) {
      var wx = Math.round(dx + dw * state.wipe / 100) + 0.5;
      fctx.strokeStyle = 'rgba(255,255,255,0.9)';
      fctx.lineWidth = Math.max(1, s.dpr);
      fctx.beginPath(); fctx.moveTo(wx, dy); fctx.lineTo(wx, dy + dh); fctx.stroke();
      if (!PREVIEW) {
        fctx.fillStyle = '#fff';
        var hh = 18 * s.dpr, hw = 6 * s.dpr;
        fctx.fillRect(wx - hw / 2, dy + dh / 2 - hh / 2, hw, hh);
      }
    }

    // Scale bar: 50 micrometres at the stated pixel size.
    var um = 50, barPx = um / UM_PER_PX * scale;
    var pad = 12 * s.dpr;
    var bx = Math.min(s.w, dx + dw) - pad - barPx, by = Math.min(s.h, dy + dh) - pad;
    fctx.fillStyle = '#fff';
    fctx.fillRect(Math.round(bx), Math.round(by - 3 * s.dpr), Math.round(barPx), Math.round(3 * s.dpr));
    fctx.font = '600 ' + Math.round(11 * s.dpr) + 'px "Stencil Mono", ui-monospace, monospace';
    fctx.textAlign = 'center';
    fctx.textBaseline = 'bottom';
    fctx.lineWidth = 3 * s.dpr;
    fctx.strokeStyle = 'rgba(0,0,0,0.85)';
    fctx.strokeText(um + ' µm', bx + barPx / 2, by - 6 * s.dpr);
    fctx.fillText(um + ' µm', bx + barPx / 2, by - 6 * s.dpr);
  }

  // ------------------------------------------------------------------ sweep chart

  function drawSweep(f, cur) {
    var s = sizeCanvas(sweepCanvas), d = s.dpr;
    var ctx = sctx;
    ctx.clearRect(0, 0, s.w, s.h);
    var L = 34 * d, R = 70 * d, T = 8 * d, B = 22 * d;
    var pw = s.w - L - R, ph = s.h - T - B;
    // The y axis starts at Y0, not 0, so the shape of each curve is visible; it is labelled.
    var Y0 = 0.6;
    var X = function (t) { return L + t * pw; };
    var Y = function (v) { return T + (1 - (Math.max(Y0, v) - Y0) / (1 - Y0)) * ph; };
    ctx.font = Math.round(11 * d) + 'px "Stencil Mono", ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    // Grid.
    ctx.strokeStyle = 'rgba(196,200,208,0.22)';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#8d929c';
    ctx.textAlign = 'right';
    [0.6, 0.7, 0.8, 0.9, 1].forEach(function (v) {
      ctx.beginPath(); ctx.moveTo(L, Math.round(Y(v)) + 0.5); ctx.lineTo(L + pw, Math.round(Y(v)) + 0.5); ctx.stroke();
      ctx.fillText(v.toFixed(1), L - 6 * d, Y(v));
    });
    // Axis break mark under 0.6.
    ctx.strokeStyle = '#8d929c';
    [0, 4].forEach(function (o) {
      ctx.beginPath(); ctx.moveTo(L - 4 * d, T + ph - (2 - o) * d); ctx.lineTo(L + 4 * d, T + ph - (6 - o) * d); ctx.stroke();
    });
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    [0, 0.25, 0.5, 0.75, 1].forEach(function (t) {
      ctx.beginPath(); ctx.moveTo(Math.round(X(t)) + 0.5, T + ph); ctx.lineTo(Math.round(X(t)) + 0.5, T + ph + 4 * d); ctx.stroke();
      ctx.fillText(t === 0 || t === 1 ? String(t) : t.toFixed(2), X(t), T + ph + 6 * d);
    });

    // Predict-nothing accuracy: dashed.
    var nothingAcc = f.nothingScores.accuracy;
    ctx.setLineDash([4 * d, 4 * d]);
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath(); ctx.moveTo(L, Y(nothingAcc)); ctx.lineTo(L + pw, Y(nothingAcc)); ctx.stroke();
    ctx.setLineDash([]);

    function line(key, colour, width) {
      ctx.strokeStyle = colour; ctx.lineWidth = width * d;
      ctx.beginPath();
      f.sweep.forEach(function (p, j) { var x = X(p.t), y = Y(p[key]); if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke();
    }
    line('accuracy', '#c4c8d0', 1.5);
    line('dice', '#4f7cff', 2.5);

    // Where each score peaks: small ticks under the top edge.
    [[f.best.accuracy, '#c4c8d0'], [f.best.dice, '#4f7cff']].forEach(function (p, j) {
      ctx.fillStyle = p[1];
      var x = X(p[0]), y = T + j * 6 * d;
      ctx.beginPath(); ctx.moveTo(x - 4 * d, y); ctx.lineTo(x + 4 * d, y); ctx.lineTo(x, y + 6 * d); ctx.fill();
    });

    // Direct labels at the right edge, nudged apart if they collide.
    var last = f.sweep[f.sweep.length - 1];
    var labels = [
      { y: Y(last.accuracy), text: 'pixel acc', colour: '#c4c8d0' },
      { y: Y(last.dice), text: 'Dice', colour: '#4f7cff' },
      { y: Y(nothingAcc), text: 'nothing', colour: '#ffffff' }
    ].sort(function (a, b) { return a.y - b.y; });
    for (var j = 1; j < labels.length; j++) if (labels[j].y - labels[j - 1].y < 12 * d) labels[j].y = labels[j - 1].y + 12 * d;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    labels.forEach(function (l) { ctx.fillStyle = l.colour; ctx.fillText(l.text, L + pw + 6 * d, l.y); });

    // Current threshold.
    if (state.source === 'unet') {
      var tx = X(state.t);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1 * d;
      ctx.beginPath(); ctx.moveTo(tx, T); ctx.lineTo(tx, T + ph); ctx.stroke();
      [[cur.accuracy, '#c4c8d0'], [cur.dice, '#4f7cff']].forEach(function (p) {
        ctx.fillStyle = p[1];
        ctx.fillRect(tx - 3.5 * d, Y(p[0]) - 3.5 * d, 7 * d, 7 * d);
      });
    } else {
      // A baseline has no threshold: mark its two scores at the left edge.
      [[cur.accuracy, '#c4c8d0'], [cur.dice, '#4f7cff']].forEach(function (p) {
        var y = Y(p[0]);
        ctx.fillStyle = p[1];
        ctx.beginPath(); ctx.moveTo(L + 1 * d, y); ctx.lineTo(L + 9 * d, y - 5 * d); ctx.lineTo(L + 9 * d, y + 5 * d); ctx.fill();
        if (p[0] < Y0) { ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText('Dice ' + p[0].toFixed(2) + ' (below the axis)', L + 12 * d, y - 6 * d); }
      });
    }
  }

  // ------------------------------------------------------------------ readouts

  function updateReadouts(f, s) {
    setText($('v-acc'), fmt(s.accuracy));
    setText($('v-iou'), fmt(s.iou));
    setText($('v-dice'), fmt(s.dice));
    $('b-acc').style.width = pct(s.accuracy);
    $('b-iou').style.width = pct(s.iou);
    $('b-dice').style.width = pct(s.dice);
    // Change from the reference setting (U-Net at 0.50), so the size of each change is plain.
    var ref = f.sweep[M.sweepIndex(0.5)], same = state.source === 'unet' && Math.abs(state.t - 0.5) < 1e-9;
    [['d-acc', s.accuracy - ref.accuracy], ['d-iou', s.iou - ref.iou], ['d-dice', s.dice - ref.dice]].forEach(function (p) {
      setText($(p[0]), same ? '' : (p[1] >= 0 ? '+' : '−') + Math.abs(p[1]).toFixed(3) + ' vs U-Net at 0.50');
    });
    var free = f.nothingScores.accuracy;
    $('b-free').style.width = pct(free);
    $('n-acc').innerHTML = 'Hatched: the <b>' + fmt(free) + '</b> any model gets for calling every pixel background. Only ' +
      pct(f.share) + ' of this field is nucleus.';

    var meta = f.meta;
    var countText = 'Nuclei: <b>' + s.blobs + '</b> blobs found · <b>' + meta.annotated_nuclei + '</b> annotated.';
    if (f.truthBlobs !== meta.annotated_nuclei) {
      countText += ' Even the true mask shows ' + f.truthBlobs + ' blobs, because touching nuclei merge.';
    }
    $('count').innerHTML = countText;

    var hint = $('hint'), t = state.t, best = f.best;
    if (state.source === 'nothing') {
      hint.innerHTML = 'Every pixel called background. Pixel accuracy <b>' + fmt(s.accuracy) + '</b>, Dice <b>' + fmt(s.dice) +
        '</b>: it found none of what it was asked to find.';
    } else if (state.source === 'otsu') {
      hint.innerHTML = 'Otsu’s method: one brightness cut (byte ' + meta.otsu_cut_whole_field + '), chosen from the whole field’s histogram, no training.' +
        (s.dice < 0.5 ? ' Here it misses most nuclei, yet pixel accuracy is still <b>' + fmt(s.accuracy) + '</b>.' : '') +
        ' Move the threshold to return to the U-Net.';
    } else if (t <= 0.12) {
      hint.innerHTML = 'Low threshold: halos and specks around nuclei (magenta, hatched). Pixel accuracy <b>' + fmt(s.accuracy) +
        '</b>, Dice <b>' + fmt(s.dice) + '</b>.';
    } else if (t >= 0.88) {
      hint.innerHTML = 'High threshold: edges and dim nuclei go missing (green, dotted). Pixel accuracy <b>' + fmt(s.accuracy) +
        '</b>, Dice <b>' + fmt(s.dice) + '</b>.';
    } else {
      var lost = f.sweep[M.sweepIndex(best.dice)].dice - f.sweep[M.sweepIndex(best.accuracy)].dice;
      hint.innerHTML = 'This model is confident, so both scores move only a little' + (best.dice === best.accuracy ?
        ' and peak at the same cut, <b>' + best.dice.toFixed(2) + '</b>.' :
        '. Picking the cut by pixel accuracy (' + best.accuracy.toFixed(2) + ') instead of Dice (' + best.dice.toFixed(2) +
        ') costs <b>' + fmt(lost) + '</b> Dice.') + ' The gap shows when you press Predict nothing.';
    }
    setText($('t-out'), state.source === 'unet' ? t.toFixed(2) : 'not in use');
    thresholdInput.closest('.thresh').classList.toggle('is-idle', state.source !== 'unet');
    thresholdInput.setAttribute('aria-valuetext', 'threshold ' + t.toFixed(2) + (state.source === 'unet' ? '' : ', not in use until moved'));

    $('rh-well').innerHTML = '<span class="rh-k">PLATE</span> ' + meta.plate + ' <span class="rh-k">WELL</span> ' + meta.well +
      ' <span class="rh-k">SITE</span> ' + meta.site;
    var srcName = state.source === 'unet' ? 'U-Net at threshold ' + t.toFixed(2) : state.source === 'otsu' ? 'Otsu baseline' : 'Predict nothing';
    fieldCanvas.setAttribute('aria-label', 'Fluorescence image of nuclei, well ' + meta.well + ' site ' + meta.site +
      '. Left of the wipe: raw image. Right: ' + layerName() + ' for ' + srcName + '. Pixel accuracy ' + fmt(s.accuracy) +
      ', IoU ' + fmt(s.iou) + ', Dice ' + fmt(s.dice) + '.');
    sweepCanvas.setAttribute('aria-label', 'U-Net scores across thresholds for this field: pixel accuracy stays between ' +
      fmt(minOf(f.sweep, 'accuracy'), 2) + ' and ' + fmt(maxOf(f.sweep, 'accuracy'), 2) + '; Dice ranges from ' +
      fmt(minOf(f.sweep, 'dice'), 2) + ' to ' + fmt(maxOf(f.sweep, 'dice'), 2) + '. Predicting nothing scores ' + fmt(free, 2) + ' pixel accuracy.');
    setText($('sweep-cap'), 'The U-Net on this field at every threshold; the axis starts at 0.6. Peaks (marked at the top): Dice at ' +
      best.dice.toFixed(2) + ', pixel accuracy at ' + best.accuracy.toFixed(2) + '. Dashed: predicting nothing.');
    setText($('layer-tag'), layerName().toUpperCase());
    $('legend').classList.toggle('is-off', state.layer !== 'errors');
  }

  function layerName() { return state.layer === 'truth' ? 'true mask' : state.layer === 'pred' ? 'prediction' : 'errors'; }
  function minOf(a, k) { return a.reduce(function (m, p) { return Math.min(m, p[k]); }, Infinity); }
  function maxOf(a, k) { return a.reduce(function (m, p) { return Math.max(m, p[k]); }, -Infinity); }

  function buildTable() {
    var body = $('ftbody');
    body.innerHTML = '';
    fields.forEach(function (f, i) {
      var tr = document.createElement('tr');
      var th = document.createElement('th');
      th.scope = 'row';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'frow-btn';
      btn.textContent = f.meta.well + ' s' + f.meta.site;
      btn.setAttribute('aria-label', 'View field ' + (i + 1) + ', well ' + f.meta.well + ' site ' + f.meta.site);
      btn.addEventListener('click', function () { state.field = i; schedule(); });
      th.appendChild(btn);
      tr.appendChild(th);
      for (var c = 0; c < 4; c++) tr.appendChild(document.createElement('td'));
      body.appendChild(tr);
    });
  }

  // The table reads each field's scores from its sweep (or its cached baseline scores),
  // so a slider move costs no per-pixel work for the seven fields not on view. Their blob
  // counts need a flood fill, so they are filled in once the slider rests.
  var countTimer = 0;
  function updateTable(cur) {
    var rows = $('ftbody').children, sums = [0, 0, 0, 0, 0], n = 0, missing = false, key = settingKey();
    fields.forEach(function (f, i) {
      var tr = rows[i], tds = tr.children;
      tr.classList.toggle('is-current', i === state.field);
      tds[0].querySelector('button').setAttribute('aria-current', i === state.field ? 'true' : 'false');
      if (!f.ready) return;
      var s = i === state.field ? cur : scoresFor(f);
      var blobs = f.blobs[key];
      setText(tds[1], pct(f.share));
      setText(tds[2], fmt(s.accuracy));
      setText(tds[3], fmt(s.dice));
      tds[3].className = s.dice === 0 ? 'd-zero' : '';
      setText(tds[4], blobs == null ? '…' : blobs + ' / ' + f.meta.annotated_nuclei);
      if (blobs == null) missing = true;
      sums[0] += f.share; sums[1] += s.accuracy; sums[2] += s.dice; sums[3] += blobs || 0; sums[4] += f.meta.annotated_nuclei; n++;
    });
    if (!n) return;
    setText($('mean-share'), pct(sums[0] / n));
    setText($('mean-acc'), fmt(sums[1] / n));
    setText($('mean-dice'), fmt(sums[2] / n));
    setText($('mean-count'), missing ? '…' : sums[3] + ' / ' + sums[4]);
    clearTimeout(countTimer);
    if (missing) countTimer = setTimeout(fillCounts, 180);
  }

  function fillCounts() {
    var key = settingKey();
    fields.forEach(function (f) {
      if (!f.ready || f.blobs[key] != null) return;
      var pred = predictionFor(f, state.source, state.t, tableBuf);
      f.blobs[key] = M.countBlobs(pred, W, H, M.MIN_AREA, labelBuf, stackBuf);
    });
    // Fill the table straight away when the view is current; otherwise redraw.
    if (current.s && current.key.indexOf(state.field + '|' + key + '|') === 0) updateTable(current.s);
    else schedule();
  }

  // ------------------------------------------------------------------ render loop (on demand)

  var pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () { pending = false; render(); });
  }

  var statusTimer = 0;
  function render() {
    var f = fields[state.field];
    if (!f || !f.ready) return;
    var s = evaluateCurrent(!PREVIEW);
    drawField(f, s.pred);
    if (PREVIEW) { updatePreviewReadout(f); return; }
    updateReadouts(f, s);
    drawSweep(f, s);
    updateTable(s);
    syncButtons();
    clearTimeout(statusTimer);
    statusTimer = setTimeout(function () {
      setText($('status'), 'Pixel accuracy ' + fmt(s.accuracy, 2) + ', Dice ' + fmt(s.dice, 2) + '.');
    }, 700);
  }

  function syncButtons() {
    Array.prototype.forEach.call(stage.querySelectorAll('.src'), function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.source === state.source));
    });
    Array.prototype.forEach.call(stage.querySelectorAll('.cube'), function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.layer === state.layer));
    });
  }

  // ------------------------------------------------------------------ controls

  function bindControls() {
    thresholdInput.addEventListener('input', function () {
      state.t = parseFloat(thresholdInput.value);
      state.source = 'unet';
      schedule();
    });
    wipeInput.addEventListener('input', function () {
      state.wipe = parseFloat(wipeInput.value);
      wipeInput.setAttribute('aria-valuetext', Math.round(state.wipe) + '% raw, ' + Math.round(100 - state.wipe) + '% overlay');
      schedule();
    });
    Array.prototype.forEach.call(stage.querySelectorAll('.src'), function (b) {
      b.addEventListener('click', function () { state.source = b.dataset.source; schedule(); });
    });
    Array.prototype.forEach.call(stage.querySelectorAll('.cube'), function (b) {
      b.addEventListener('click', function () { state.layer = b.dataset.layer; schedule(); });
    });
    // Drag on the field to move the wipe.
    var dragging = false;
    function wipeFromEvent(e) {
      var r = fieldCanvas.getBoundingClientRect();
      var s = Math.min(r.width / W, r.height / H), dw = W * s, dx = (r.width - dw) / 2;
      var v = Math.max(0, Math.min(100, Math.round((e.clientX - r.left - dx) / dw * 100)));
      wipeInput.value = v;
      wipeInput.dispatchEvent(new Event('input'));
    }
    fieldCanvas.addEventListener('pointerdown', function (e) {
      dragging = true;
      fieldCanvas.setPointerCapture(e.pointerId);
      wipeFromEvent(e);
    });
    fieldCanvas.addEventListener('pointermove', function (e) { if (dragging) wipeFromEvent(e); });
    fieldCanvas.addEventListener('pointerup', function () { dragging = false; });
    fieldCanvas.addEventListener('pointercancel', function () { dragging = false; });

    if (window.ResizeObserver) new ResizeObserver(schedule).observe(stage);
    else window.addEventListener('resize', schedule);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
  }

  // ------------------------------------------------------------------ preview loop

  // Both rows are always on screen, so every frame (and the still) carries the contrast:
  // the U-Net and "predict nothing" side by side, on the same field.
  function updatePreviewReadout(f) {
    var u = f.sweep[M.sweepIndex(state.t)], z = f.nothingScores, on = state.source === 'unet';
    setText($('pr-t'), state.t.toFixed(2));
    setText($('pr-acc'), fmt(u.accuracy));
    setText($('pr-dice'), fmt(u.dice));
    setText($('pr-acc0'), fmt(z.accuracy));
    setText($('pr-dice0'), fmt(z.dice));
    $('pr-unet').classList.toggle('is-on', on);
    $('pr-none').classList.toggle('is-on', !on);
  }

  function startPreview() {
    var idx = 0;
    fields.forEach(function (f, i) { if (f.meta.id === PREVIEW_FIELD) idx = i; });
    state.field = idx;
    state.wipe = 22;
    var f = fields[idx];
    var raf = 0, t0 = 0;
    // A 10-second loop: 4 s predicting nothing (the misses pulse), then 6 s of the U-Net
    // with its threshold moving 0.50 -> 0.10 -> 0.90 -> 0.50.
    var PERIOD = 10000, NOTHING = 4000;
    function still() {
      state.source = 'nothing'; state.t = 0.5; state.pulse = 1;
      render();
    }
    function frame(now) {
      if (!t0) t0 = now;
      var ms = (now - t0) % PERIOD;
      if (ms < NOTHING) {
        state.source = 'nothing';
        state.t = 0.5;
      } else {
        state.source = 'unet';
        state.t = parseFloat((0.5 - 0.4 * Math.sin(2 * Math.PI * (ms - NOTHING) / (PERIOD - NOTHING))).toFixed(2));
      }
      state.pulse = 0.7 + 0.3 * Math.cos(2 * Math.PI * (now - t0) / 1400);
      render();
      raf = requestAnimationFrame(frame);
    }
    loadField(f).then(function () {
      if (window.ResizeObserver) new ResizeObserver(function () { if (!raf) still(); }).observe(stage);
      Kit.onPlay(function (playing) {
        if (playing && !raf) { t0 = 0; raf = requestAnimationFrame(frame); }
        else if (!playing) { if (raf) cancelAnimationFrame(raf); raf = 0; still(); }
      });
    });
  }

  // ------------------------------------------------------------------ start

  if (PREVIEW) {
    startPreview();
    return;
  }
  buildTable();
  bindControls();
  syncButtons();
  // The first field is drawn as soon as it arrives; the other seven follow for the table.
  loadField(fields[0]).then(function () {
    schedule();
    return Promise.all(fields.slice(1).map(function (f) { return loadField(f).then(schedule); }));
  }).catch(function (err) {
    $('hint').textContent = 'The images did not load (' + err.message + '). Try reloading the page.';
  });

  // For checking in the console: the live numbers come from here, not from any table.
  window.Stencil = { state: state, fields: fields, evaluate: evaluate, render: render };
})();
