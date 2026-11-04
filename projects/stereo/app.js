/* Stereo: app.js. Draws the five layers computed by model.js and runs both modes. */
(function () {
  'use strict';
  var S = window.Stereo;
  var Kit = window.Kit || { preview: false, embedded: false, reducedMotion: false, playing: true, onPlay: function (cb) { cb(true); } };
  var N = S.N_DAYS, DAY = S.DAY, HOUR = S.HOUR;
  // An anaglyph: every layer is drawn twice, the record in red and the truth in cyan, added
  // together on a dark slate field. Where the two agree they sum to white; where they part,
  // each shows in its own colour. The same tokens are in style.css.
  var COL = {
    field: '#20242a', deep: '#191c21',
    red: '#ff4b3e', cyan: '#2ec4d6', white: '#f1efe8', buff: '#d8c9a3',
    ink: '#20242a',                          // printing on the mount, 9.5:1 on buff
    dim: '#a9a79f',                          // secondary text, 6:1 on the field
    rule: 'rgba(241,239,232,0.13)', ruleStrong: 'rgba(241,239,232,0.30)',
    wash: 'rgba(241,239,232,0.07)',          // days on which the world itself moved
    water: 'rgba(46,196,214,0.13)'
  };
  // Where record and truth agree, the red and the cyan image lie on the same line and add up to
  // white. They are drawn this far either side of it (CSS px), so a half-pixel of each ink stays
  // visible at the edges: the fused line still shows that it is made of two images. A screen
  // without high density cannot draw half a pixel crisply, so there the two lie a little further apart.
  var FUSE = (window.devicePixelRatio || 1) >= 1.5 ? 0.25 : 0.42;
  function easeInOut(p) { return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; }
  function easeOut(p) { return 1 - Math.pow(1 - p, 3); }
  var FONT = '"Space Grotesk", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
  var MONO = '"Space Mono", ui-monospace, Menlo, Consolas, monospace';
  // Canvas text does not wait for a web font: ask for the faces, then draw again once they are in.
  function whenFonts(faces, cb) {
    if (!document.fonts || !document.fonts.load) return;
    Promise.all(faces.map(function (f) { return document.fonts.load(f); })).then(cb, function () { /* system fallback is fine */ });
  }
  // The gap between record and truth: red and cyan hatching, the two images out of register.
  var hatchTile = null;
  function hatch(ctx) {
    if (!hatchTile) {
      hatchTile = document.createElement('canvas');
      hatchTile.width = hatchTile.height = 8;
      var x = hatchTile.getContext('2d');
      x.lineWidth = 1.3;
      [[0, 'rgba(255,75,62,0.55)'], [4, 'rgba(46,196,214,0.55)']].forEach(function (s) {
        x.strokeStyle = s[1];
        x.beginPath();
        for (var k = -8; k <= 8; k += 8) { x.moveTo(s[0] + k - 1, 9); x.lineTo(s[0] + k + 9, -1); }
        x.stroke();
      });
    }
    return ctx.createPattern(hatchTile, 'repeat');
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  // ---------- small helpers ----------
  function $(id) { return document.getElementById(id); }
  function fmtInt(n) { return n !== n ? '–' : Math.round(n).toLocaleString('en-GB'); }
  function fmt1(x) { return x !== x ? '–' : (Math.round(x * 10) / 10).toFixed(1); }
  function pct(x, d) { return (Math.abs(x) * 100).toFixed(d == null ? 0 : d) + '%'; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function clockOf(sec, withSec) {
    sec = ((Math.floor(sec) % DAY) + DAY) % DAY;
    var h = Math.floor(sec / HOUR), m = Math.floor((sec % HOUR) / 60), s = sec % 60;
    return pad2(h) + ':' + pad2(m) + (withSec ? ':' + pad2(s) : '');
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function clampDay(d) { return Math.max(0, Math.min(N - 1, Math.floor(d))); }
  function sizeCanvas(cv, w, h) {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    if (cv.style.height !== h + 'px') cv.style.height = h + 'px';
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return ctx;
  }
  function slice(a) { return Array.prototype.slice.call(a, 0, N); }
  function finite(v) { return typeof v === 'number' && v === v && isFinite(v); }

  // ---------- strips: thin rows sharing one 60-day axis ----------
  // On a phone each row's label sits above its value in a narrow gutter. Wider, the label and the
  // value share one line in a wider gutter, so the rows can be short and all five layers fit on a
  // laptop screen at once.
  var INLINE_MIN = 520;
  function inlineRows(w) { return w >= INLINE_MIN; }
  function stripGeom(w, gutter) { var gut = gutter != null ? gutter : (inlineRows(w) ? 156 : 76); return { x0: gut, x1: w - 6 }; }
  function xOf(g, d) { return g.x0 + (d + 0.5) / N * (g.x1 - g.x0); }

  // Each row: obs (what this layer records), optional tru (the same quantity in the true world),
  // optional dots (actual rides under a forecast). A row with tru is drawn as a stereo pair: the
  // record in red, the truth in cyan, added together, so days on which they agree come out white
  // (with a half-pixel red and cyan fringe) and days on which they part show as two lines (the
  // truth dashed there, so the pair does not rest on colour alone). Rows marked truth (the world)
  // are the cyan image only; the weather, the same in every image, is a fainter fused pair. A row
  // without tru (the truth hidden) is the red image alone.
  // o.tint marks where the world itself moved (a real change) and thickens the line there.
  function paired(row) { return !!(row.tru || row.weather); }
  // the inks a row's line is drawn in, each with its sideways offset
  function rowInks(row) { return paired(row) ? [[COL.red, -FUSE], [COL.cyan, FUSE]] : [[row.truth ? COL.cyan : COL.red, 0]]; }
  function drawRows(ctx, w, rows, o) {
    var g = stripGeom(w, o.gutter), y = 0, di = clampDay(o.day);
    var reveal = o.reveal == null ? N - 1 : o.reveal;
    var showCursor = o.day != null && !o.noCursor;
    rows.forEach(function (row, ri) {
      var h = row.h || 30, top = y + 6, bot = y + h - 5;
      if (o.heat) {
        ctx.fillStyle = COL.wash;
        ctx.fillRect(xOf(g, o.heat[0] - 0.5), y + 1, xOf(g, o.heat[1] + 0.5) - xOf(g, o.heat[0] - 0.5), h - 2);
      }
      var vals = [], d;
      for (d = 0; d < N; d++) {
        if (finite(row.obs[d])) vals.push(row.obs[d]);
        if (row.tru && finite(row.tru[d])) vals.push(row.tru[d]);
        if (row.dots && finite(row.dots[d])) vals.push(row.dots[d]);
      }
      var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
      if (!vals.length) { lo = 0; hi = 1; }
      if (row.zero) lo = Math.min(0, lo);
      if (hi - lo < 1e-9) hi = lo + 1;
      var padv = (hi - lo) * 0.06; if (!row.zero) lo -= padv; hi += padv;
      var Y = function (v) { return bot - (v - lo) / (hi - lo) * (bot - top); };
      var hot = null, inks = rowInks(row);
      var same = function (dd) { return !row.tru || (finite(row.obs[dd]) && finite(row.tru[dd]) && row.obs[dd] === row.tru[dd]); };
      if (row.kind === 'bars') {
        // how much of the record is not as it was: each bar split into a red half and a cyan half,
        // the two images side by side and never fused
        var bw = Math.max(1.5, (g.x1 - g.x0) / N * 0.62);
        ctx.fillStyle = COL.rule;
        ctx.fillRect(g.x0, bot, g.x1 - g.x0, 1);
        for (d = 0; d <= reveal; d++) {
          if (!(row.obs[d] > 0)) continue;
          var yy = Math.min(Y(row.obs[d]), bot - 1.5);
          ctx.fillStyle = COL.red; ctx.fillRect(xOf(g, d) - bw / 2, yy, bw / 2, bot - yy + 1);
          ctx.fillStyle = COL.cyan; ctx.fillRect(xOf(g, d), yy, bw / 2, bot - yy + 1);
        }
      } else {
        if (o.tint && o.tint.days && !(row.weather && !o.tint.weather)) {
          hot = new Array(N);
          for (d = 0; d < N; d++) hot[d] = !!o.tint.days[d];
        }
        if (row.tru) {
          // the gap between what this layer sees and the truth, hatched in both inks
          var pts = [];
          for (d = 0; d <= reveal; d++) if (finite(row.obs[d]) && finite(row.tru[d])) pts.push(d);
          if (pts.length > 1) {
            ctx.beginPath();
            pts.forEach(function (dd, i) { var x = xOf(g, dd), v = Y(row.obs[dd]); if (i) ctx.lineTo(x, v); else ctx.moveTo(x, v); });
            for (var k = pts.length - 1; k >= 0; k--) ctx.lineTo(xOf(g, pts[k]), Y(row.tru[pts[k]]));
            ctx.closePath();
            ctx.fillStyle = hatch(ctx);
            ctx.fill();
          }
        }
        if (row.dots) {
          // the actual rides under the forecast: small grey dots, clear of the lines
          ctx.fillStyle = COL.dim;
          for (d = 0; d <= reveal; d++) if (finite(row.dots[d])) { ctx.beginPath(); ctx.arc(xOf(g, d), Y(row.dots[d]), 1.9, 0, 6.283); ctx.fill(); }
        }
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        if (row.tru) {
          // the truth (cyan) and the record (red), each nudged half a fringe to its own side
          line(ctx, g, row.tru, Y, COL.cyan, 1.6, null, reveal, function (dd) { return same(dd - 1) && same(dd); }, FUSE);
          line(ctx, g, row.tru, Y, COL.cyan, 1.6, [4, 3], reveal, function (dd) { return !(same(dd - 1) && same(dd)); }, FUSE);
          line(ctx, g, row.obs, Y, COL.red, 1.6, null, reveal, null, -FUSE);
        } else {
          if (row.weather) ctx.globalAlpha = 0.62;
          inks.forEach(function (k) { line(ctx, g, row.obs, Y, k[0], row.weather ? 1.3 : 1.6, null, reveal, null, k[1]); });
        }
        if (hot) inks.forEach(function (k) { hotLine(ctx, g, row.obs, Y, k[0], 2.6, reveal, hot, k[1]); });
        ctx.restore();
        if (row.rain) {
          ctx.fillStyle = COL.dim;
          for (d = 0; d <= reveal; d++) if (row.rain[d]) ctx.fillRect(xOf(g, d) - 1, bot + 1, 2, 3);
        }
        // where the cursor meets this row: one white dot where record and truth agree, a red and a cyan one where they part
        if (showCursor && di <= reveal) {
          var v = valueAt(row.obs, o.day);
          if (finite(v)) {
            var px = xOf(g, o.day), py = Y(v), split = row.tru && !same(di);
            var tv0 = split ? valueAt(row.tru, o.day) : NaN;
            ctx.fillStyle = COL.field;
            ctx.beginPath(); ctx.arc(px, py, 4.4, 0, 6.283); ctx.fill();
            if (finite(tv0)) { ctx.beginPath(); ctx.arc(px, Y(tv0), 4.4, 0, 6.283); ctx.fill(); }
            ctx.save(); ctx.globalCompositeOperation = 'lighter';
            if (finite(tv0)) {
              ctx.fillStyle = COL.red; ctx.beginPath(); ctx.arc(px, py, 2.8, 0, 6.283); ctx.fill();
              ctx.fillStyle = COL.cyan; ctx.beginPath(); ctx.arc(px, Y(tv0), 2.8, 0, 6.283); ctx.fill();
            } else {
              // one dot of each ink, fused into white with their fringes
              inks.forEach(function (k) { ctx.fillStyle = k[0]; ctx.beginPath(); ctx.arc(px + k[1], py, 2.8, 0, 6.283); ctx.fill(); });
            }
            ctx.restore();
          }
        }
      }
      if (!o.noLabels && o.inline) {
        // label on the left, today's value on the right of the gutter, the truth after it if they differ
        var my = y + h / 2 + 0.5, right = g.x0 - 8;
        ctx.textBaseline = 'middle';
        ctx.fillStyle = COL.dim; ctx.font = '11.5px ' + FONT;
        ctx.fillText(row.label, 0, my);
        var lw = ctx.measureText(row.label).width;
        if (row.fmt) {
          var oTxt = row.fmt(row.obs[di]);
          var dif = row.kind !== 'bars' && row.tru && finite(row.tru[di]) && row.tru[di] !== row.obs[di];
          var tTxt = dif ? ' ≠' + row.fmt(row.tru[di]).replace(/ min$/, '') : '';
          ctx.font = '11px ' + MONO;
          var tw = tTxt ? ctx.measureText(tTxt).width : 0;
          ctx.font = (row.lead ? '700 13px ' : '12px ') + MONO;
          var vw = ctx.measureText(oTxt).width;
          if (tw && lw + 8 + vw + tw > right) { tw = 0; tTxt = ''; }
          if (lw + 8 + vw <= right) {
            ctx.textAlign = 'right';
            ctx.fillStyle = dif ? COL.red : row.truth ? COL.cyan : COL.white;
            ctx.fillText(oTxt, right - tw, my);
            if (tTxt) { ctx.font = '11px ' + MONO; ctx.fillStyle = COL.cyan; ctx.fillText(tTxt, right, my); }
            ctx.textAlign = 'left';
          }
        }
      } else if (!o.noLabels) {
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = COL.dim;
        ctx.font = '11px ' + FONT;
        ctx.fillText(row.label, 0, y + (h < 30 ? 12 : 13));
        if (h >= 26 && row.fmt) {
          var big = h >= 38;
          var vy = y + (big ? 30 : Math.min(27, h - 3));
          var obsTxt = row.fmt(row.obs[di]);
          var differs = row.kind !== 'bars' && row.tru && finite(row.tru[di]) && row.tru[di] !== row.obs[di];
          ctx.font = (big ? '700 13px ' : '12px ') + MONO;
          ctx.fillStyle = differs ? COL.red : row.truth ? COL.cyan : COL.white;
          ctx.fillText(obsTxt, 0, vy);
          if (differs) {
            var ow = ctx.measureText(obsTxt).width;
            ctx.font = '11px ' + MONO;
            var tt = '≠' + row.fmt(row.tru[di]).replace(/ min$/, '');
            if (ow + 3 + ctx.measureText(tt).width <= g.x0 - 6) { ctx.fillStyle = COL.cyan; ctx.fillText(tt, ow + 3, vy); }
          }
        }
      }
      if (ri < rows.length - 1 && !o.noSeparators) {
        ctx.fillStyle = COL.rule;
        ctx.fillRect(g.x0, y + h - 0.5, g.x1 - g.x0, 1);
      }
      y += h;
    });
    if (o.marker != null) {
      // the day of the change: a fault's marker is a red and a cyan line out of register; a real change's is white
      ctx.save();
      ctx.lineWidth = 1.2; ctx.setLineDash([2, 3]);
      var mx = Math.round(xOf(g, o.marker - 0.5)) + 0.5;
      // (a real change's two lines lie together and add up to white)
      var mo = o.markerFault ? 1.5 : FUSE;
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = COL.red; ctx.beginPath(); ctx.moveTo(mx - mo, 0); ctx.lineTo(mx - mo, y); ctx.stroke();
      ctx.strokeStyle = COL.cyan; ctx.beginPath(); ctx.moveTo(mx + mo, 0); ctx.lineTo(mx + mo, y); ctx.stroke();
      ctx.restore();
    }
    if (showCursor) {
      // drawn beneath everything already on the canvas, so the lines and dots stay on top
      var cx = Math.round(xOf(g, o.day)) + 0.5;
      ctx.save();
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = 'rgba(241,239,232,0.38)';
      ctx.fillRect(cx - 0.5, 0, 1, y);
      ctx.restore();
    }
    if (o.axis) {
      // weekly ticks on Mondays, and three dates
      ctx.fillStyle = COL.ruleStrong;
      for (var dd = 0; dd < N; dd += 7) ctx.fillRect(Math.round(xOf(g, dd - 0.5)), y + 1, 1, 4);
      ctx.fillStyle = COL.dim; ctx.font = '11px ' + MONO; ctx.textBaseline = 'top';
      [[0, '2 Jun', 'left'], [29, '1 Jul', 'center'], [N - 1, '31 Jul', 'right']].forEach(function (a) {
        ctx.textAlign = a[2];
        ctx.fillText(a[1], a[2] === 'left' ? xOf(g, -0.5) : a[2] === 'right' ? xOf(g, N - 0.5) : xOf(g, a[0] - 0.5), y + 6);
      });
      ctx.textAlign = 'left';
      y += 20;
    }
    return y;
  }
  // The value of a daily series at a fractional day (the cursor moves smoothly while playing).
  function valueAt(arr, day) {
    var a = Math.floor(day), f = day - a;
    if (a >= N - 1 || f < 1e-6) return arr[clampDay(a)];
    if (!finite(arr[a]) || !finite(arr[a + 1])) return arr[a];
    return arr[a] + (arr[a + 1] - arr[a]) * f;
  }
  // A series as a line; with `keep`, only the segments (d-1 → d) for which keep(d) holds;
  // dx shifts it sideways (one image of a stereo pair).
  function line(ctx, g, arr, Y, color, width, dash, reveal, keep, dx) {
    ctx.save();
    if (dx) ctx.translate(dx, 0);
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.lineCap = dash ? 'butt' : 'round';
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    var on = false;
    for (var d = 0; d <= reveal; d++) {
      if (!finite(arr[d])) { on = false; continue; }
      var x = xOf(g, d), v = Y(arr[d]);
      if (keep && d > 0 && !keep(d)) { on = false; }
      if (on) ctx.lineTo(x, v);
      else if (keep && d > 0 && keep(d) && finite(arr[d - 1])) { ctx.moveTo(xOf(g, d - 1), Y(arr[d - 1])); ctx.lineTo(x, v); on = true; }
      else if (!keep) { ctx.moveTo(x, v); on = true; }
    }
    ctx.stroke();
    ctx.restore();
  }
  // Overdraw the stretches of a line where `hot` is set, heavier, in one of the row's inks.
  function hotLine(ctx, g, arr, Y, color, width, reveal, hot, dx) {
    ctx.save();
    if (dx) ctx.translate(dx, 0);
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    for (var d = 1; d <= reveal; d++) {
      if (!(hot[d] || hot[d - 1]) || !finite(arr[d]) || !finite(arr[d - 1])) continue;
      ctx.moveTo(xOf(g, d - 1), Y(arr[d - 1])); ctx.lineTo(xOf(g, d), Y(arr[d]));
    }
    ctx.stroke();
    ctx.restore();
  }
  function rowsHeight(rows) { var h = 0; rows.forEach(function (r) { h += r.h || 30; }); return h; }
  // Row heights: on a phone, the stacked rows a little shorter; wider, one line per row.
  function compact(rows, w) {
    if (inlineRows(w)) rows.forEach(function (r) { r.h = r.kind === 'bars' ? 20 : r.dots ? 34 : r.lead ? 30 : 24; });
    else rows.forEach(function (r) { r.h = r.h ? r.h - 6 : 27; });
    return rows;
  }

  if (Kit.preview) { initPreview(); return; }
  initApp();

  // =====================================================================================
  // The card preview: five thin layers; a fault rises from the log and the forecast bends.
  // =====================================================================================
  // The card runs two or three at once on a phone, so it does not simulate the city: it draws
  // series that model.js computed ahead of time (preview-data.js, checked by the tests to equal
  // a fresh run). Only if that file cannot load does it compute them here.
  function initPreview() {
    if (window.StereoPreviewData) { startPreview(window.StereoPreviewData); return; }
    var sc = document.createElement('script');
    sc.src = 'preview-data.js';
    sc.onload = function () { startPreview(window.StereoPreviewData || S.previewSeries()); };
    sc.onerror = function () { startPreview(S.previewSeries()); };
    document.head.appendChild(sc);
  }
  function startPreview(data) {
    var cv = $('st-preview');
    cv.hidden = false;
    var F = data.faultDay;
    // top to bottom, as on the page; the fault starts in the log (index 3) and rises to the model
    var bands = data.bands.map(function (b) { return { name: b.name, obs: b.obs, tru: b.tru, hit: b.name !== 'World' }; });
    var SRC = 3;
    bands.forEach(function (b) {
      var lo = Infinity, hi = -Infinity;
      [b.obs, b.tru].forEach(function (a) { if (a) a.forEach(function (v) { if (finite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }); });
      var pad = (hi - lo) * 0.08; b.lo = lo - pad; b.hi = hi + pad;
    });
    // 10 s: draw in to the fault day, the fault rises, the gaps open, hold, fade
    var LOOP = 10000, A = 2600, B = 4300, C = 7500, D = 9400;
    var raf = 0, t0 = 0, playing = false;

    function phase(t) {
      if (t == null) return { r: N - 1, rise: 1, alpha: 1, pen: false };
      if (t < A) return { r: 1 + (F - 1) * easeInOut(t / A), rise: -1, alpha: Math.min(1, t / 350), pen: true };
      if (t < B) return { r: F, rise: easeInOut((t - A) / (B - A)), alpha: 1, pen: false };
      if (t < C) return { r: F + (N - 1 - F) * easeOut((t - B) / (C - B)), rise: 1, alpha: 1, pen: true };
      if (t < D) return { r: N - 1, rise: 1, alpha: 1, pen: false };
      return { r: N - 1, rise: 1, alpha: Math.max(0, 1 - (t - D) / (LOOP - D)), pen: false };
    }
    // points of a series up to a fractional day, with the last one interpolated
    function pts(a, r, X, Y) {
      var out = [], d;
      for (d = 0; d <= Math.floor(r); d++) if (finite(a[d])) out.push([X(d), Y(a[d]), d]);
      var f = r - Math.floor(r), k = Math.floor(r);
      if (f > 0 && k + 1 < N && finite(a[k]) && finite(a[k + 1])) out.push([X(k + f), Y(a[k] + (a[k + 1] - a[k]) * f), k + f]);
      return out;
    }
    function stroke(ctx, p, from, to) {
      ctx.beginPath();
      var on = false;
      for (var i = 0; i < p.length; i++) {
        if (p[i][2] < from - 1e-9 || p[i][2] > to + 1e-9) continue;
        if (on) ctx.lineTo(p[i][0], p[i][1]); else { ctx.moveTo(p[i][0], p[i][1]); on = true; }
      }
      ctx.stroke();
    }

    // The card itself: a buff mount with a printed rule, the slate window cut with a twin arch
    // across its top (one arch per eye), and the layer names stamped on the mount beside it.
    // The window is left transparent on this canvas, so the slate behind it shows through and the
    // two inks add up exactly: red + cyan = white.
    function windowPath(ctx, wl, wr, wt, wb, arch) {
      var hw = (wr - wl) / 2;
      ctx.moveTo(wl, wb); ctx.lineTo(wl, wt + arch);
      ctx.ellipse(wl + hw / 2, wt + arch, hw / 2, arch, 0, Math.PI, 2 * Math.PI);
      ctx.ellipse(wl + hw * 1.5, wt + arch, hw / 2, arch, 0, Math.PI, 2 * Math.PI);
      ctx.lineTo(wr, wb); ctx.closePath();
    }
    // a strand of the card stock: faint specks, made once
    var grainTile = null;
    function grain(ctx) {
      if (!grainTile) {
        grainTile = document.createElement('canvas');
        grainTile.width = grainTile.height = 96;
        var gx = grainTile.getContext('2d'), s = 11;
        for (var i = 0; i < 900; i++) {
          s = (s * 16807) % 2147483647; var x = s % 96;
          s = (s * 16807) % 2147483647; var y = s % 96;
          s = (s * 16807) % 2147483647;
          gx.fillStyle = 'rgba(70,58,32,' + (0.04 + (s % 1000) / 1000 * 0.1).toFixed(3) + ')';
          gx.fillRect(x, y, 1, 1);
        }
      }
      return ctx.createPattern(grainTile, 'repeat');
    }
    // a series drawn as one image of the pair: shifted sideways by dx
    function strokeAt(ctx, p, from, to, dx) {
      ctx.save(); ctx.translate(dx, 0); stroke(ctx, p, from, to); ctx.restore();
    }

    function draw(t) {
      var w = cv.clientWidth || 320, h = cv.clientHeight || 200;
      var ctx = sizeCanvas(cv, w, h);
      cv.style.height = '100%';
      var big = w >= 420, fs = big ? 12 : 11;
      var M = big ? 14 : 10, arch = big ? 13 : 9, gap = big ? 12 : 8;
      var spaced = 'letterSpacing' in ctx;
      ctx.font = '700 ' + fs + 'px ' + MONO;
      if (spaced) ctx.letterSpacing = '1px';
      var labW = 0;
      bands.forEach(function (b) { labW = Math.max(labW, ctx.measureText(b.name.toUpperCase()).width); });
      if (spaced) ctx.letterSpacing = '0px';
      // the window, and the strips inside it
      var wl = Math.round(M + labW + gap), wr = w - M, wt = M, wb = h - M;
      var top0 = wt + arch + 1, x0 = wl + (big ? 10 : 7), x1 = wr - (big ? 10 : 7);
      var bandH = (wb - 3 - top0) / bands.length;
      var X = function (d) { return x0 + (d + 0.5) / N * (x1 - x0); };
      var ph = phase(t), fx = Math.round(X(F - 0.5)) + 0.5;
      // the pulse head climbs from the log band to the top of the model band
      var ySrc = top0 + SRC * bandH + bandH * 0.62, yTop = top0 + 4;
      var yHead = ph.rise < 0 ? Infinity : ySrc + (yTop - ySrc) * ph.rise;
      var lw = big ? 1.8 : 1.6, fu = FUSE + 0.12;   // half the fused pair's offset: a little more than the page, as the card is small
      ctx.globalAlpha = ph.alpha;
      bands.forEach(function (b, i) {
        var top = top0 + i * bandH, iTop = top + 6, iBot = top + bandH - 6;
        var reached = b.reached = b.hit && yHead <= top + bandH - 4;
        if (i < bands.length - 1) { ctx.fillStyle = COL.rule; ctx.fillRect(wl, Math.round(top + bandH) - 0.5, wr - wl, 1); }
        var Y = function (v) { return iBot - (v - b.lo) / (b.hi - b.lo) * (iBot - iTop); };
        var po = pts(b.obs, ph.r, X, Y), pt = b.tru ? pts(b.tru, ph.r, X, Y) : null;
        var split = reached && pt && ph.r > F;
        ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.lineWidth = lw;
        if (split) {
          // the gap: from the fault day on, between the record and the truth
          var go = po.filter(function (p) { return p[2] >= F - 1; }), gt = pt.filter(function (p) { return p[2] >= F - 1; });
          if (go.length > 1 && gt.length > 1) {
            ctx.beginPath();
            go.forEach(function (p, k) { if (k) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
            for (var k = gt.length - 1; k >= 0; k--) ctx.lineTo(gt[k][0], gt[k][1]);
            ctx.closePath(); ctx.fillStyle = hatch(ctx); ctx.fill();
          }
        }
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        if (!b.hit) {
          // the world is the true image alone (cyan)
          ctx.strokeStyle = COL.cyan; stroke(ctx, po, 0, N);
        } else {
          // every other layer is a red and a cyan image lying together (white, with a fringe) until they part
          var upto = split ? F - 1 : N;
          ctx.strokeStyle = COL.red; strokeAt(ctx, po, 0, upto, -fu);
          ctx.strokeStyle = COL.cyan; strokeAt(ctx, po, 0, upto, fu);
          if (split) {
            ctx.strokeStyle = COL.cyan; strokeAt(ctx, pt, F - 1, N, fu);
            ctx.strokeStyle = COL.red; strokeAt(ctx, po, F - 1, N, -fu);
          }
        }
        // the pen: a dot at the end of each line while it draws (two, once the images have parted)
        if (ph.pen && po.length) {
          var last = po[po.length - 1], lt = split && pt.length ? pt[pt.length - 1] : null, r0 = big ? 2.8 : 2.4;
          var dots = !b.hit ? [[COL.cyan, last, 0]] : lt && last[2] > F ? [[COL.red, last, 0], [COL.cyan, lt, 0]] : [[COL.red, last, -fu], [COL.cyan, last, fu]];
          dots.forEach(function (dd) { ctx.fillStyle = dd[0]; ctx.beginPath(); ctx.arc(dd[1][0] + dd[2], dd[1][1], r0, 0, 6.283); ctx.fill(); });
        }
        ctx.restore();
      });
      // the fault: a red and a cyan line rising together from the log, out of register
      if (ph.rise >= 0) {
        var yH = Math.max(yTop, yHead), off = big ? 1.6 : 1.4;
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        ctx.lineWidth = big ? 1.8 : 1.6; ctx.setLineDash(ph.rise >= 1 ? [2, 3] : []);
        ctx.strokeStyle = COL.red; ctx.beginPath(); ctx.moveTo(fx - off, ySrc); ctx.lineTo(fx - off, yH); ctx.stroke();
        ctx.strokeStyle = COL.cyan; ctx.beginPath(); ctx.moveTo(fx + off, ySrc); ctx.lineTo(fx + off, yH); ctx.stroke();
        ctx.setLineDash([]);
        var pair = function (y, r) {
          ctx.fillStyle = COL.red; ctx.beginPath(); ctx.arc(fx - off, y, r, 0, 6.283); ctx.fill();
          ctx.fillStyle = COL.cyan; ctx.beginPath(); ctx.arc(fx + off, y, r, 0, 6.283); ctx.fill();
        };
        pair(ySrc, big ? 3.6 : 3.2);
        if (ph.rise < 1) pair(yH, big ? 4.8 : 4.2);
        ctx.restore();
        // name the fault just before its source, below the line (which runs higher before the fault)
        ctx.font = '500 ' + (big ? 13 : 12) + 'px ' + FONT; ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
        ctx.lineWidth = 5; ctx.strokeStyle = COL.field; ctx.lineJoin = 'round';
        var lx = fx - 8, ly = Math.min(ySrc + bandH * 0.12, top0 + (SRC + 1) * bandH - 8);
        ctx.strokeText('dock fault', lx, ly);
        // printed out of register: a red and a cyan copy either side of the white
        ctx.fillStyle = COL.red; ctx.fillText('dock fault', lx - 1.2, ly);
        ctx.fillStyle = COL.cyan; ctx.fillText('dock fault', lx + 1.2, ly);
        ctx.fillStyle = COL.white; ctx.fillText('dock fault', lx, ly);
        ctx.textAlign = 'left';
      }
      ctx.globalAlpha = 1;

      // the mount over everything outside the window
      ctx.beginPath(); ctx.rect(0, 0, w, h); windowPath(ctx, wl, wr, wt, wb, arch);
      ctx.fillStyle = COL.buff; ctx.fill('evenodd');
      ctx.fillStyle = grain(ctx); ctx.fill('evenodd');
      ctx.strokeStyle = 'rgba(32,36,42,0.36)'; ctx.lineWidth = 1;
      roundRect(ctx, 4.5, 4.5, w - 9, h - 9, big ? 8 : 6); ctx.stroke();
      // the layer names, stamped on the mount; once the fault reaches a layer, its name prints out of register
      ctx.font = '700 ' + fs + 'px ' + MONO; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      if (spaced) ctx.letterSpacing = '1px';
      bands.forEach(function (b, i) {
        var ly = Math.round(top0 + i * bandH + bandH / 2) + 0.5, txt = b.name.toUpperCase();
        if (b.reached) {
          ctx.globalAlpha = 0.85 * ph.alpha;
          ctx.fillStyle = COL.red; ctx.fillText(txt, M - 1.4, ly);
          ctx.fillStyle = COL.cyan; ctx.fillText(txt, M + 1.4, ly);
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = COL.ink; ctx.fillText(txt, M, ly);
      });
      if (spaced) ctx.letterSpacing = '0px';
    }
    function frame(now) {
      raf = 0;
      if (!playing) return;
      // start on the finished picture (the hold), so a card never opens on an empty frame
      if (!t0) t0 = now - C;
      draw((now - t0) % LOOP);
      raf = requestAnimationFrame(frame);
    }
    // a finished still straight away, whatever happens next (the loop starts on the same picture)
    draw(null);
    Kit.onPlay(function (p) {
      playing = p;
      if (p) { t0 = 0; if (!raf) raf = requestAnimationFrame(frame); }
      else { if (raf) cancelAnimationFrame(raf); raf = 0; draw(null); }
    });
    window.addEventListener('resize', function () { if (!playing) draw(null); });
    whenFonts(['500 12px "Space Grotesk"', '700 11px "Space Mono"'], function () { if (!playing) draw(null); });
  }

  // =====================================================================================
  // The full page
  // =====================================================================================
  function initApp() {
    var BAND_ORDER = ['model', 'dashboard', 'pipeline', 'log', 'world'];
    var INFO = {
      model: { name: 'Model', sub: 'what a forecaster learned' },
      dashboard: { name: 'Dashboard', sub: 'what people see' },
      pipeline: { name: 'Pipeline', sub: 'what the nightly job did' },
      log: { name: 'Log', sub: 'what got recorded' },
      world: { name: 'World', sub: 'what really happened' }
    };
    // Short names for the menus; the full description appears in the line above the stack.
    var SHORT = {
      heatwave: 'Heatwave, 10–16 July', newstation: 'New station opens, 7 July',
      firmware: 'Harbour docks lose 30% of returns', doublesend: 'App sends some events twice',
      clockskew: 'Rail Station clock an hour ahead', staletable: 'Stations table misses Riverside',
      timezone: 'Date taken from UTC', dedupekey: 'Dedupe on event id',
      definition: 'Average trip becomes the median', weatherjoin: 'Trained on the previous day’s weather'
    };
    var CASE_FROM = ['Marketing', 'Street team', 'Operations', 'Finance', 'Planning', 'Operations'];
    var STORE = 'stereo-cases-v1';
    var SEC_PER_DAY = 0.9;
    var narrowMQ = window.matchMedia ? window.matchMedia('(max-width: 899px)') : { matches: false };

    var runner = new S.Runner();
    var state = {
      mode: 'forward', fault: null, dayF: 20, tod: 17.25 * HOUR, truth: true,
      focus: narrowMQ.matches ? null : 'dashboard', playing: false, todPlaying: false,
      caseIdx: 0, examined: {}, revealed: false, ansLayer: null, ansFault: null, crossed: false
    };
    var cur = null;
    var scores = loadScores();

    // ---------- build the bands ----------
    var bands = {};
    var stack = $('st-stack');
    BAND_ORDER.forEach(function (layer) {
      var sec = document.createElement('section');
      sec.className = 'st-band';
      sec.setAttribute('data-layer', layer);
      sec.setAttribute('aria-labelledby', 'st-name-' + layer);
      var opts = '<option value="">' + (layer === 'world' ? 'Change the world…' : 'Break this layer…') + '</option>';
      S.FAULT_IDS.forEach(function (f) { if (S.FAULTS[f].layer === layer) opts += '<option value="' + f + '">' + esc(SHORT[f] || S.FAULTS[f].label) + '</option>'; });
      sec.innerHTML =
        '<div class="st-band-head">' +
          '<h2 class="st-vh">' + INFO[layer].name + '</h2>' +
          '<button type="button" class="st-name" id="st-name-' + layer + '" aria-controls="st-inspector" aria-expanded="false" aria-label="' + INFO[layer].name + ', ' + INFO[layer].sub + ': show details">' +
            '<span class="st-name-main">' + INFO[layer].name + '</span><span class="st-name-sub">' + INFO[layer].sub + '</span>' +
            '<span class="st-name-go" aria-hidden="true">details ›</span></button>' +
          '<span class="st-chip" data-state=""></span>' +
          '<label class="st-change"><span class="st-vh">Change at the ' + layer + ' layer</span><select aria-label="Change at the ' + layer + ' layer">' + opts + '</select></label>' +
        '</div>' +
        '<div class="st-strip-wrap"><canvas class="st-strip" role="img"></canvas>' +
          '<div class="st-closed" hidden><span>Not examined yet.</span><button type="button" class="kit-button">Examine the ' + layer + '</button></div></div>';
      stack.appendChild(sec);
      var b = {
        el: sec, name: sec.querySelector('.st-name'), chip: sec.querySelector('.st-chip'), select: sec.querySelector('select'),
        change: sec.querySelector('.st-change'), canvas: sec.querySelector('canvas'), closed: sec.querySelector('.st-closed'),
        examine: sec.querySelector('.st-closed button')
      };
      bands[layer] = b;
      b.select.addEventListener('change', function () { chooseFault(b.select.value || null, layer); });
      b.name.addEventListener('click', function () { focusLayer(layer, true); });
      b.examine.addEventListener('click', function () { examine(layer); });
      scrubbable(b.canvas);
      if (layer === 'dashboard') {
        // the seam between what appears and the process beneath it
        var seam = document.createElement('div');
        seam.className = 'st-seam';
        seam.setAttribute('aria-hidden', 'true');
        seam.innerHTML = '<span>↑ what appears</span><span>the process beneath ↓</span>';
        stack.appendChild(seam);
      }
    });

    // Drag across any strip to move through the season. A touch must move sideways first,
    // so a vertical swipe still scrolls the page; a tap jumps to that day.
    function scrubbable(cv) {
      var drag = null;
      function dayAt(clientX) {
        var r = cv.getBoundingClientRect(), g = stripGeom(r.width), x = clientX - r.left;
        if (x < g.x0 - 6) return null;
        return clampDay(Math.round((x - g.x0) / (g.x1 - g.x0) * N - 0.5));
      }
      function go(clientX) {
        var d = dayAt(clientX);
        if (d == null) return;
        stopPlay();
        if (d !== clampDay(state.dayF) || state.dayF !== d) setDay(d);
      }
      cv.addEventListener('pointerdown', function (e) {
        if (e.button > 0 || dayAt(e.clientX) == null) return;
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY, on: e.pointerType !== 'touch' };
        if (drag.on) { go(e.clientX); try { cv.setPointerCapture(e.pointerId); } catch (err) { /* fine */ } }
      });
      cv.addEventListener('pointermove', function (e) {
        if (!drag || e.pointerId !== drag.id) return;
        if (!drag.on) {
          var dx = Math.abs(e.clientX - drag.x), dy = Math.abs(e.clientY - drag.y);
          if (dx > 8 && dx > dy) { drag.on = true; try { cv.setPointerCapture(e.pointerId); } catch (err) { /* fine */ } }
          else if (dy > 8) { drag = null; return; }
          else return;
        }
        go(e.clientX);
      });
      cv.addEventListener('pointerup', function (e) {
        if (drag && !drag.on && Math.abs(e.clientX - drag.x) < 8 && Math.abs(e.clientY - drag.y) < 8) go(e.clientX);
        drag = null;
      });
      cv.addEventListener('pointercancel', function () { drag = null; });
    }

    var allSel = $('st-change-all');
    var allOpts = '<option value="">Nothing: a healthy city</option>';
    BAND_ORDER.slice().reverse().forEach(function (layer) {
      allOpts += '<optgroup label="' + INFO[layer].name + (layer === 'world' ? ' (real changes)' : '') + '">';
      S.FAULT_IDS.forEach(function (f) { if (S.FAULTS[f].layer === layer) allOpts += '<option value="' + f + '">' + esc(SHORT[f] || S.FAULTS[f].label) + '</option>'; });
      allOpts += '</optgroup>';
    });
    allSel.innerHTML = allOpts;
    allSel.addEventListener('change', function () { var f = allSel.value || null; chooseFault(f, f ? S.FAULTS[f].layer : null); });

    // ---------- top controls ----------
    var tabF = $('st-tab-forward'), tabD = $('st-tab-detective');
    [tabF, tabD].forEach(function (tab) {
      tab.addEventListener('click', function () { setMode(tab === tabF ? 'forward' : 'detective'); });
      tab.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          var other = tab === tabF ? tabD : tabF;
          other.focus(); setMode(other === tabF ? 'forward' : 'detective');
        }
      });
    });
    $('st-truth').addEventListener('change', function () { state.truth = this.checked; refreshAll(); });
    var slider = $('st-day');
    slider.addEventListener('input', function () { stopPlay(); setDay(+slider.value); });
    $('st-play').addEventListener('click', function () { if (state.playing) stopPlay(); else startPlay(); });
    Kit.onPlay(function (p) { if (!p) { stopPlay(); stopTod(); } });

    // ---------- computing ----------
    function scenario() {
      if (state.mode === 'forward') return S.normalise({ fault: state.fault });
      return S.caseScenario(S.CASES[state.caseIdx]);
    }
    function compute() {
      var sc = scenario();
      var obs = runner.run(sc), tru = runner.run(S.truthOf(sc));
      cur = { sc: sc, obs: obs, tru: tru, cmp: S.compare(obs, tru), ev: S.evidence(obs), change: activeChange() };
      cur.marker = markerDay(cur.change, sc);
    }
    function activeChange() {
      if (state.mode === 'forward') return state.fault;
      return S.CASES[state.caseIdx].answer;
    }
    function markerDay(change, sc) {
      if (!change) return null;
      if (change === 'heatwave') return S.HEAT_FROM;
      if (change === 'newstation' || change === 'staletable') return S.OPEN_DAY;
      return sc.faultDay;
    }
    function truthVisible() { return state.mode === 'forward' ? state.truth : state.revealed; }
    function isReal(change) { return !!(change && S.FAULTS[change].real); }

    // ---------- the rows each band draws ----------
    function rowsFor(layer) {
      var o = cur.obs, t = cur.tru, tv = truthVisible(), rows = [];
      var mins = function (v) { return fmt1(v) + ' min'; };
      if (layer === 'model') {
        var act = tv ? t.world.truth.rides : o.dash.rides;
        rows.push({ label: 'forecast', h: 46, lead: true, obs: o.model.forecast, tru: tv ? t.model.forecast : null, fmt: fmtInt,
                    dots: Array.prototype.map.call(slice(act), function (v, d) { return d >= S.FIRST_FORECAST ? v : NaN; }) });
      } else if (layer === 'dashboard') {
        rows.push({ label: 'rides', h: 42, lead: true, obs: o.dash.rides, tru: tv ? t.dash.rides : null, fmt: fmtInt });
        rows.push({ label: 'turned away', obs: o.dash.unmet, tru: tv ? t.dash.unmet : null, fmt: fmtInt, zero: true });
        rows.push({ label: 'avg trip', obs: o.dash.tripLen, tru: tv ? t.dash.tripLen : null, fmt: mins });
      } else if (layer === 'pipeline') {
        rows.push({ label: 'trips out', h: 38, lead: true, obs: slice(o.pipe.tripsOut), tru: tv ? slice(t.pipe.tripsOut) : null, fmt: fmtInt });
        rows.push({ label: 'rows removed', obs: slice(o.pipe.removed), tru: tv ? slice(t.pipe.removed) : null, fmt: fmtInt, zero: true });
        // output rows lost, added, moved to another date or given another length, per nightly run
        if (tv) rows.push({ label: 'not as it was', kind: 'bars', obs: slice(cur.cmp.pipeline.perPart), zero: true, fmt: fmtInt });
      } else if (layer === 'log') {
        rows.push({ label: 'events', h: 38, lead: true, obs: slice(o.log.perPart.events), tru: tv ? slice(t.log.perPart.events) : null, fmt: fmtInt });
        if (tv) rows.push({ label: 'not as it was', kind: 'bars', obs: slice(cur.cmp.log.perPart), zero: true, fmt: fmtInt });
      } else {
        if (tv) {
          rows.push({ label: 'rides', h: 38, lead: true, truth: true, obs: o.world.truth.rides, fmt: fmtInt });
          rows.push({ label: 'turned away', truth: true, obs: o.world.truth.unmet, fmt: fmtInt, zero: true });
        }
        rows.push({ label: '°C, rain ticks', weather: true, obs: o.world.weather.map(function (w) { return w.temp; }),
                    rain: o.world.weather.map(function (w) { return w.rain; }), fmt: function (v) { return fmt1(v) + '°C'; } });
      }
      return rows;
    }

    function layerHit(layer) {
      if (!truthVisible() || !cur.change) return null;
      if (isReal(cur.change) || (layer === 'world' && (cur.obs.world.newStation || cur.obs.world.heatwave))) return 'signal';
      if (cur.cmp.affected.indexOf(layer) < 0) return null;
      return layer === 'pipeline' && cur.cmp.pipeline.outputSame ? 'absorbed' : 'fault';
    }

    function drawStrips() {
      if (!cur) return;   // the city is not built yet (a resize can arrive first)
      BAND_ORDER.forEach(function (layer) {
        var b = bands[layer];
        if (b.canvas.hidden) return;
        var w = b.canvas.clientWidth;
        if (!w) return;
        var rows = compact(rowsFor(layer), w);
        var ctx = sizeCanvas(b.canvas, w, rowsHeight(rows) + (layer === 'world' ? 20 : 0));
        var hit = layerHit(layer);
        var heat = cur.obs.world.heatwave ? [S.HEAT_FROM, S.HEAT_TO] : null;
        drawRows(ctx, w, rows, {
          inline: inlineRows(w),
          day: state.dayF, axis: layer === 'world', heat: layer === 'world' || (hit === 'signal') ? heat : null,
          marker: hit ? cur.marker : (layer === 'world' && cur.obs.world.newStation ? S.OPEN_DAY : null),
          markerFault: hit === 'fault',
          tint: tintFor(hit)
        });
      });
      layoutTime();
    }
    // Where to weight a layer's line: on the days the world itself moved (a heatwave, a new station).
    // A fault needs no tint: its record and truth part on their own, into red and cyan.
    var signalDays = {};
    function tintFor(hit) {
      if (!hit || hit === 'absorbed' || hit === 'fault') return null;
      var w = cur.obs.world, key = (w.heatwave ? 'H' : '') + (w.newStation ? 'N' : '');
      if (!signalDays[key]) {
        var days = new Array(N);
        for (var d = 0; d < N; d++) days[d] = (w.heatwave && d >= S.HEAT_FROM && d <= S.HEAT_TO) || (w.newStation && d >= S.OPEN_DAY);
        signalDays[key] = days;
      }
      return { days: signalDays[key], weather: !!w.heatwave };
    }

    // ---------- chips: each layer against its own truth ----------
    function chipFor(layer) {
      var tv = truthVisible(), ch = cur.change, c = cur.cmp;
      if (state.mode === 'detective' && !state.revealed) {
        if (layer === 'dashboard') return { s: '', t: 'where the ticket starts' };
        return { s: '', t: state.examined[layer] ? 'examined' : '' };
      }
      if (!tv) return { s: '', t: '' };
      if (layer === 'world') {
        if (isReal(ch)) return { s: 'signal', t: 'changed: ' + (ch === 'heatwave' ? 'a heatwave' : 'a new station') };
        if (cur.obs.world.newStation) return { s: 'signal', t: 'changed: a new station' };
        return { s: 'ref', t: 'the reference' };
      }
      if (isReal(ch) || (cur.obs.world.newStation && !ch)) return { s: 'eq', t: '= matches truth; the world moved' };
      if (!ch || c.affected.indexOf(layer) < 0) return { s: 'eq', t: '= matches truth' };
      if (layer === 'log') {
        var parts = [];
        if (c.log.missing) parts.push(fmtInt(c.log.missing) + ' events never arrived');
        if (c.log.extra) parts.push(fmtInt(c.log.extra) + ' extra copies');
        if (c.log.restamped) parts.push(fmtInt(c.log.restamped) + ' stamped an hour late');
        return { s: 'ne', t: '≠ ' + parts.join(', ') };
      }
      if (layer === 'pipeline') {
        var p = c.pipeline;
        if (p.outputSame) return { s: 'absorbed', t: '= output matches; +' + fmtInt(p.removed - p.truthRemoved) + ' deduped' };
        if (p.missing) return { s: 'ne', t: '≠ ' + fmtInt(p.missing) + ' trips lost' };
        if (p.extra) return { s: 'ne', t: '≠ ' + fmtInt(p.extra) + ' trips too many' };
        if (p.misdated) return { s: 'ne', t: '≠ ' + fmtInt(p.misdated) + ' trips on the wrong day' };
        if (p.retimed) return { s: 'ne', t: '≠ ' + fmtInt(p.retimed) + ' trips an hour too long' };
        return { s: 'ne', t: '≠ differs from truth' };
      }
      if (layer === 'dashboard') {
        var dsh = c.dashboard;
        if (Math.abs(dsh.tripLen) > 0.03) return { s: 'ne', t: '≠ average trip ' + pct(dsh.tripLen) + (dsh.tripLen < 0 ? ' low' : ' high') };
        if (Math.abs(dsh.rides) > 0.02) return { s: 'ne', t: '≠ rides ' + pct(dsh.rides, 1) + (dsh.rides < 0 ? ' low' : ' high') };
        return { s: 'ne', t: '≠ rides wrong on ' + dsh.misdatedDays + ' days' };
      }
      var m = c.model;
      if (Math.abs(m.gap) >= 0.02 && m.mapeTrue < 1.5 * m.mapeTruthModel) return { s: 'ne', t: '≠ forecasts ' + pct(m.gap, 1) + (m.gap < 0 ? ' low' : ' high') };
      return { s: 'ne', t: '≠ error ' + pct(m.mapeTrue, 1) + ', truth-trained ' + pct(m.mapeTruthModel, 1) };
    }

    function refreshBands() {
      if (!cur) return;
      var det = state.mode === 'detective';
      BAND_ORDER.forEach(function (layer) {
        var b = bands[layer], chip = chipFor(layer);
        b.chip.textContent = chip.t;
        b.chip.setAttribute('data-state', chip.s);
        b.change.hidden = det;
        var sel = state.mode === 'forward' && state.fault && S.FAULTS[state.fault].layer === layer ? state.fault : '';
        b.select.value = sel;
        b.select.classList.toggle('is-set', !!sel);
        allSel.value = state.mode === 'forward' && state.fault ? state.fault : '';
        allSel.classList.toggle('is-set', !!(state.mode === 'forward' && state.fault));
        allSel.classList.toggle('is-real', isReal(state.fault));
        var closed = det && !state.examined[layer] && !state.revealed;
        b.canvas.hidden = closed;
        b.closed.hidden = !closed;
        b.el.classList.toggle('is-focus', state.focus === layer);
        b.name.setAttribute('aria-expanded', state.focus === layer ? 'true' : 'false');
        var hit = layerHit(layer);
        b.el.classList.toggle('is-hit-fault', hit === 'fault');
        b.el.classList.toggle('is-hit-signal', hit === 'signal' || hit === 'absorbed');
        b.canvas.setAttribute('aria-label', stripLabel(layer, chip));
      });
    }
    function stripLabel(layer, chip) {
      var tv = truthVisible();
      var what = {
        model: 'forecast rides per day, with the actual rides as dots', dashboard: 'rides, riders turned away and average trip length per day',
        pipeline: 'trips out and rows removed per nightly run' + (tv ? ', and output rows that differ from the truth' : ''),
        log: 'events logged per night' + (tv ? ', and events that differ from what happened' : ''),
        world: tv ? 'true rides, riders turned away and temperature per day' : 'temperature per day'
      }[layer];
      return INFO[layer].name + ': ' + what + ', over 60 days' + (tv ? ', solid as recorded, dashed the truth' : '') + '. Cursor at ' +
        S.dateLabel(clampDay(state.dayF)) + '.' + (chip.t ? ' ' + chip.t.replace('≠', 'Differs:').replace('=', 'Same:') + '.' : '');
    }

    // ---------- the pulse: a line rises from the changed layer, at the day it changed ----------
    // It climbs through every layer the change reaches and stops at the last one. Each band
    // flashes as the line enters it. With reduced motion the static markers carry the same story.
    var riseCv = $('st-rise');
    var rise = { raf: 0, t0: 0, seq: [], real: false, fired: {}, timers: [] };
    function pulse() {
      rise.timers.forEach(clearTimeout); rise.timers = [];
      BAND_ORDER.forEach(function (l) { bands[l].el.classList.remove('is-pulse'); });
      stopRise();
      if (!cur.change || !truthVisible() || cur.marker == null) return;
      var real = isReal(cur.change);
      var from = S.LAYER_INDEX[S.FAULTS[cur.change].layer];
      var seq = [];
      ['world', 'log', 'pipeline', 'dashboard', 'model'].forEach(function (l, i) {
        if (i < from) return;
        if (real || cur.cmp.affected.indexOf(l) >= 0) seq.push(l);
      });
      if (!seq.length || Kit.reducedMotion || !Kit.playing) return;
      rise.seq = seq; rise.real = real; rise.fired = {}; rise.t0 = 0;
      rise.raf = requestAnimationFrame(riseFrame);
    }
    function stopRise() {
      if (rise.raf) cancelAnimationFrame(rise.raf);
      rise.raf = 0;
      riseCv.width = 1; riseCv.height = 1; riseCv.style.height = '0px';
    }
    function flash(l) {
      var el = bands[l].el;
      el.style.setProperty('--st-pulse-wash', rise.real || layerHit(l) !== 'fault' ? 'rgba(241,239,232,0.07)' : 'rgba(255,75,62,0.07)');
      el.classList.remove('is-pulse'); void el.offsetWidth; el.classList.add('is-pulse');
      rise.timers.push(setTimeout(function () { el.classList.remove('is-pulse'); }, 1300));
    }
    function riseFrame(now) {
      rise.raf = 0;
      if (!rise.t0) rise.t0 = now;
      var t = now - rise.t0, n = rise.seq.length;
      var climb = 420 + n * 330, hold = 500, fade = 700, total = climb + hold + fade;
      var sr = stack.getBoundingClientRect(), W = stack.clientWidth, H = stack.clientHeight;
      var parts = rise.seq.map(function (l) {
        var b = bands[l], r = (b.canvas.hidden ? b.el : b.canvas).getBoundingClientRect();
        return { l: l, top: r.top - sr.top, bot: r.bottom - sr.top - (l === 'world' ? 20 : 0), left: r.left - sr.left, w: r.width };
      });
      var src = parts[0], dst = parts[n - 1];
      var x = Math.round(src.left + xOf(stripGeom(src.w), cur.marker - 0.5)) + 0.5;
      var y0 = src.bot - 3, y1 = dst.top + 3;
      var e = easeInOut(Math.min(1, t / climb)), yh = y0 + (y1 - y0) * e;
      var alpha = t < climb + hold ? 1 : Math.max(0, 1 - (t - climb - hold) / fade);
      parts.forEach(function (p) { if (!rise.fired[p.l] && yh <= p.bot - 2) { rise.fired[p.l] = true; flash(p.l); } });
      var ctx = sizeCanvas(riseCv, W, H);
      // A real change rises as one white line, its red and cyan images lying together: record and
      // truth move as one. A fault rises as a red and a cyan line apart, out of register.
      var inks = rise.real ? [[COL.red, -FUSE], [COL.cyan, FUSE]] : [[COL.red, -1.5], [COL.cyan, 1.5]];
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineWidth = rise.real ? 2 : 1.6; ctx.lineCap = 'round';
      inks.forEach(function (k) {
        var xk = x + k[1];
        ctx.strokeStyle = k[0];
        // faint where it crosses a band's heading, solid inside the strips
        ctx.globalAlpha = alpha * 0.35;
        ctx.beginPath(); ctx.moveTo(xk, y0); ctx.lineTo(xk, yh); ctx.stroke();
        ctx.globalAlpha = alpha;
        parts.forEach(function (p) {
          var a = Math.max(yh, p.top), b = Math.min(y0, p.bot);
          if (b > a) { ctx.beginPath(); ctx.moveTo(xk, b); ctx.lineTo(xk, a); ctx.stroke(); }
        });
        // the source, and the head
        ctx.fillStyle = k[0];
        ctx.beginPath(); ctx.arc(xk, y0, 3.2, 0, 6.283); ctx.fill();
        ctx.beginPath(); ctx.arc(xk, yh, 4.6, 0, 6.283); ctx.fill();
      });
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      if (t < total) rise.raf = requestAnimationFrame(riseFrame);
      else stopRise();
    }

    // ---------- the story line under the timeline ----------
    function storyHtml() {
      if (state.mode === 'detective') return '';
      var ch = state.fault;
      if (!ch) return '<strong>Nothing is broken.</strong> Every layer matches the truth, and the dashboard equals what really happened, ride for ride. ' +
        '<span class="st-tries"><span class="st-tries-l">Try one:</span>' +
        '<button type="button" class="st-try is-fault" data-try="firmware">Harbour docks lose returns</button>' +
        '<button type="button" class="st-try is-fault" data-try="timezone">A time-zone bug</button>' +
        '<button type="button" class="st-try is-signal" data-try="heatwave">A heatwave (real)</button></span>';
      var f = S.FAULTS[ch], when = S.dateLabel(cur.marker);
      if (f.real) return '<span class="st-flag-signal">Signal, not a bug.</span> ' + esc(f.what) + ' Every layer moves with it and still matches the truth.' + resetBtn();
      var c = cur.cmp, names = c.affected.map(function (l) { return INFO[l].name.toLowerCase(); });
      var txt = '<span class="st-flag-fault">From ' + when + ':</span> ' + esc(f.what) + ' ';
      if (ch === 'doublesend') txt += 'It reaches the log and the pipeline, where dedupe removes every extra copy. Nothing above moves.';
      else if (ch === 'definition') txt += 'Only the dashboard moves. The data underneath never changed.';
      else if (ch === 'weatherjoin') txt += 'Only the model moves: it learns the wrong weather, so its forecasts go astray.';
      else txt += 'It reaches ' + names.join(' → ') + '.' + (c.affected.indexOf('model') >= 0 ? ' Retrained on these numbers, the model learns the fault as if it were the city.' : ' The model only reads rides, so it does not move.');
      return txt + resetBtn();
    }

    function resetBtn() { return ' <button type="button" class="st-try st-reset" data-try="">Undo</button>'; }

    // ---------- the inspector ----------
    var insp = $('st-inspector');
    var mapCanvas = null, hourCanvas = null, tickerEl = null, todOut = null, todRange = null, todBtn = null, mapNote = null;

    function placeInspector() {
      if (narrowMQ.matches) {
        if (!state.focus) { insp.hidden = true; return; }
        insp.hidden = false;
        var host = bands[state.focus].el;
        if (insp.parentNode !== host) host.appendChild(insp);
      } else {
        insp.hidden = false;
        if (!state.focus) state.focus = 'dashboard';
        if (insp.parentNode !== $('st-main')) $('st-main').appendChild(insp);
      }
    }

    function evidenceHtml(layer) {
      var items = cur.ev.filter(function (it) { return it.layer === layer; });
      if (!items.length) return '';
      var showFlags = state.mode === 'forward' ? state.truth : true;
      return '<h4>Checks you can run here</h4><ul class="st-evidence">' + items.map(function (it) {
        var flag = showFlags && it.flagged && layer !== 'world';
        return '<li class="' + (flag ? 'is-flag' : '') + '"><span class="et">' + esc(it.title) + ':</span> <span class="ev">' + esc(it.value) + '</span>' +
          (flag ? '<span class="ef">out of the ordinary</span>' : '') +
          (it.detail ? ' <span class="ev">' + esc(it.detail) + '</span>' : '') +
          (it.normal ? '<span class="en">' + esc(it.normal) + '</span>' : '') + '</li>';
      }).join('') + '</ul>';
    }

    function factHtml(label, val, truthVal, note, truthName) {
      var tv = truthVisible() && truthVal != null;
      var differs = tv && truthVal !== val;
      truthName = truthName || 'truth';
      return '<div><dt>' + esc(label) + '</dt><dd>' + esc(val) +
        (tv ? '<small class="' + (differs ? 'is-ne' : 'is-eq') + '">' + (differs ? '≠ ' : '= ') + truthName + ' ' + esc(String(truthVal).replace(/ min$/, '')) + '</small>' : '') +
        (note ? '<small class="is-def">' + esc(note) + '</small>' : '') + '</dd></div>';
    }

    function renderInspector() {
      placeInspector();
      mapCanvas = hourCanvas = tickerEl = todOut = todRange = todBtn = mapNote = null;
      if (!state.focus || !cur) { insp.innerHTML = ''; return; }
      var d = clampDay(state.dayF), L = state.focus, html = '';
      if (L === 'world') html = inspWorld(d);
      else if (L === 'log') html = inspLog(d);
      else if (L === 'pipeline') html = inspPipeline(d);
      else if (L === 'dashboard') html = inspDashboard(d);
      else html = inspModel(d);
      insp.innerHTML = html;
      mapCanvas = insp.querySelector('.st-map');
      hourCanvas = insp.querySelector('.st-hours');
      tickerEl = insp.querySelector('.st-ticker');
      mapNote = insp.querySelector('.st-mapnote');
      todOut = insp.querySelector('.st-todbar output');
      todRange = insp.querySelector('.st-todbar input');
      todBtn = insp.querySelector('.st-todbar button');
      if (todRange) {
        todRange.addEventListener('input', function () { stopTod(); state.tod = +todRange.value * 60; updateTod(); });
        todBtn.addEventListener('click', function () { if (state.todPlaying) stopTod(); else startTod(); });
      }
      updateTod();
      drawHours();
    }

    function todBar() {
      return '<div class="st-todbar"><button type="button" class="kit-button">' + (state.todPlaying ? 'Pause' : 'Play the day') + '</button>' +
        '<label class="st-vh" for="st-tod">Time of day</label><input type="range" id="st-tod" min="0" max="1439" step="5" value="' + Math.round(state.tod / 60) + '">' +
        '<output for="st-tod">' + clockOf(state.tod) + '</output></div>';
    }

    function inspWorld(d) {
      var w = cur.obs.world, wx = w.weather[d], tr = w.truth;
      var head = '<h3>World · ' + S.dateLabel(d) + '</h3>';
      var weather = fmt1(wx.temp) + '°C, ' + (wx.rain ? 'rain' : 'dry') + ', ' + (wx.weekend ? 'weekend' : 'weekday') + '.';
      if (!truthVisible()) {
        return head + '<p class="st-sub">' + weather + ' From here you can know the weather and the operations calendar, but not the rides: those you only know through the log.</p>' +
          evidenceHtml('world');
      }
      var heat = w.heatwave && d >= S.HEAT_FROM && d <= S.HEAT_TO;
      return head + '<p class="st-sub">' + weather + (heat ? ' Heatwave: more people want bikes than the docks hold.' : '') + ' Overnight a truck shares out the bikes it finds docked, so the last stations on its round can start a few short.</p>' +
        '<canvas class="st-map" role="img"></canvas>' + todBar() +
        '<p class="st-sub st-mapnote"></p>' +
        '<dl class="st-facts">' + factHtml('Rides', fmtInt(tr.rides[d])) + factHtml('Found no bike', fmtInt(tr.unmet[d])) + factHtml('Mean trip', fmt1(tr.tripLen[d]) + ' min') + '</dl>' +
        (state.mode === 'detective' ? evidenceHtml('world') : '');
    }

    function inspLog(d) {
      var o = cur.obs.log, t = cur.tru.log, tv = truthVisible();
      var html = '<h3>Log · ' + S.dateLabel(d) + '</h3><p class="st-sub">Raw events in the order they arrived, stamped in UTC (local time + 7 h) by the phone or dock that sent them.</p>';
      html += '<table class="st-table"><thead><tr><th>Event</th><th class="num">Logged</th>' + (tv ? '<th class="num">Truth</th>' : '') + '</tr></thead><tbody>';
      [['checkout', 'Checkouts (phone)'], ['return', 'Returns (dock)'], ['nobike', '‘No bike’ (phone)'], ['maintenance', 'Maintenance']].forEach(function (k) {
        var a = o.perPart[k[0]][d], b = t.perPart[k[0]][d];
        html += '<tr><td>' + k[1] + '</td><td class="num' + (tv && a !== b ? ' is-ne' : '') + '">' + fmtInt(a) + '</td>' + (tv ? '<td class="num is-tru">' + fmtInt(b) + '</td>' : '') + '</tr>';
      });
      html += '</tbody></table>';
      html += '<h4>Stream at the time below</h4>' + todBar() + '<ol class="st-ticker" aria-label="Most recent events"></ol>';
      if (state.mode === 'detective' || !tv || cur.change) html += evidenceHtml('log');
      return html;
    }

    function dagNote(node, d) {
      var P = cur.obs.pipe, st = P.stats[node], gone = st.inp[d] - st.out[d];
      if (node === 'filter') return 'dropped ' + fmtInt(gone) + ' maintenance moves';
      if (node === 'dedupe') return 'on ' + (cur.sc.fault === 'dedupekey' && d >= cur.sc.faultDay ? 'event id' : 'ride id') + '; removed ' + fmtInt(gone) + ' repeats';
      if (node === 'pair') return P.unmatched[d] ? fmtInt(P.unmatched[d]) + ' checkouts had no return: dropped' : 'every checkout found its return';
      if (node === 'join' || node === 'joinNb') return gone ? fmtInt(gone) + ' rows matched no station: dropped' : 'every row matched a station';
      return S.NODE_INFO[node].what;
    }
    function dagRow(node, d) {
      var o = cur.obs.pipe.stats[node], t = cur.tru.pipe.stats[node], tv = truthVisible();
      var a = o.inp[d], b = o.out[d], ta = t.inp[d], tb = t.out[d], extra = dagNote(node, d);
      var ne = tv && (a !== ta || b !== tb);
      var unit = node === 'group' || node === 'groupNb' ? (b === 1 ? ' day' : ' days') : '';
      var info = S.NODE_INFO[node];
      var base = cur.obs.pipe.stats.extract.inp[d] || 1, bar = '';
      if (!unit) {
        var pIn = Math.min(100, a / base * 100), pOut = Math.min(100, b / base * 100), pTru = Math.min(100, tb / base * 100);
        bar = '<span class="st-flow" aria-hidden="true"><i class="in" style="width:' + pIn.toFixed(1) + '%"></i><i class="out" style="width:' + pOut.toFixed(1) + '%"></i>' +
          (ne ? '<i class="tru" style="left:' + pTru.toFixed(1) + '%"></i>' : '') + '</span>';
      }
      return '<li class="' + (ne ? 'is-ne' : '') + '"><span><span class="n">' + esc(info.name) + '</span><span class="w">' + esc(extra || info.what) + '</span>' + bar + '</span>' +
        '<span class="c">' + fmtInt(a) + ' → ' + fmtInt(b) + unit + (ne ? '<small>truth ' + fmtInt(ta) + ' → ' + fmtInt(tb) + '</small>' : '') + '</span></li>';
    }
    function inspPipeline(d) {
      var P = cur.obs.pipe, tv = truthVisible();
      var html = '<h3>Pipeline · nightly run for ' + S.dateLabel(d) + '</h3><p class="st-sub">Rows from this night’s partition of the log, counted at each step, in → out. Every step really runs on the rows; the job processes the whole season at once.</p>';
      html += '<ol class="st-dag">' + dagRow('extract', d) + dagRow('filter', d) + dagRow('dedupe', d) + dagRow('localtime', d) +
        '<li class="is-lane">Trips</li>' + dagRow('pair', d) + dagRow('join', d) + dagRow('group', d) +
        '<li class="is-lane">‘No bike’ events</li>' + dagRow('joinNb', d) + dagRow('groupNb', d) + '</ol>' +
        (tv ? '<p class="st-sub">A red edge means this step’s counts differ from the truth. That can be inherited from below: look for the first step that drops or adds rows it should not.</p>' : '');
      html += '<h4>Rides by hour on ' + S.dateLabel(d) + ', as the pipeline dated them</h4><canvas class="st-hours" role="img"></canvas>' +
        '<div class="st-legend"><span><span class="st-key is-fill"></span>pipeline</span>' + (tv ? '<span><span class="st-key is-box"></span>truth</span><span><span class="st-key is-both"></span>both agree</span>' : '') + '</div>';
      html += '<h4>Stations table</h4><p>' + P.table.map(function (r) { return esc(r.name); }).join(', ') + ' (' + P.table.length + ' rows).</p>';
      if (state.mode === 'detective' || cur.change) html += evidenceHtml('pipeline');
      return html;
    }

    function inspDashboard(d) {
      var o = cur.obs.dash, t = cur.tru.dash;
      var def = o.definitionOn(d);
      var html = '<h3>Dashboard · ' + S.dateLabel(d) + '</h3><p class="st-sub">The three numbers people read each morning.</p>';
      html += '<dl class="st-facts">' + factHtml('Rides', fmtInt(o.rides[d]), fmtInt(t.rides[d])) +
        factHtml('Turned away', fmtInt(o.unmet[d]), fmtInt(t.unmet[d])) +
        factHtml('Average trip (' + def + ')', fmt1(o.tripLen[d]) + ' min', fmt1(t.tripLen[d]) + ' min') + '</dl>';
      html += '<h4>Definitions</h4><table class="st-table"><tbody>' +
        '<tr><td>Rides</td><td>trips that started that day</td></tr>' +
        '<tr><td>Turned away</td><td>‘no bike’ events from the app</td></tr>' +
        '<tr><td>Average trip</td><td>' + (def === 'median' ? '<span class="' + (truthVisible() ? 'is-ne' : '') + '">median</span>' : 'mean') + ' of trip durations</td></tr></tbody></table>';
      html += evidenceHtml('dashboard');
      return html;
    }

    function effectRow(label, a, b, fmtf) {
      var tv = truthVisible() && b != null;
      var ne = tv && Math.abs(a - b) > 0.02 * Math.max(1, Math.abs(b));
      return '<tr><td>' + label + '</td><td class="num' + (ne ? ' is-ne' : '') + '">' + fmtf(a) + '</td>' + (tv ? '<td class="num is-tru">' + fmtf(b) + '</td>' : '') + '</tr>';
    }
    function signedPct(x) { return (x >= 0 ? '+' : '−') + pct(x); }
    function inspModel(d) {
      var o = cur.obs.model, t = cur.tru.model, tv = truthVisible();
      var html = '<h3>Model · forecast for ' + S.dateLabel(d) + '</h3><p class="st-sub">A Poisson regression of daily rides on temperature, rain and weekend, refitted every night on the pipeline’s last 28 days.</p>';
      var n = o.nightFor(d), nt = t.nightFor(d);
      if (!n) return html + '<p>No forecast yet: the model needs two weeks of data first.</p>' + (state.mode === 'detective' ? evidenceHtml('model') : '');
      html += '<dl class="st-facts">' + factHtml('Forecast', fmtInt(o.forecast[d]), tv ? fmtInt(t.forecast[d]) : null, null, 'truth-trained') +
        factHtml('Actual (dashboard)', fmtInt(cur.obs.dash.rides[d])) +
        (tv ? factHtml('Actual (really)', fmtInt(cur.obs.world.truth.rides[d])) : '') + '</dl>';
      var e = S.effects(n.beta), et = tv ? S.effects(nt.beta) : null;
      html += '<h4>What it learned the night before</h4><table class="st-table"><thead><tr><th></th><th class="num">This model</th>' + (tv ? '<th class="num">Trained on truth</th>' : '') + '</tr></thead><tbody>' +
        effectRow('Dry 20°C weekday', e.base, et && et.base, fmtInt) +
        effectRow('Each +5°C', e.temp5, et && et.temp5, signedPct) +
        effectRow('Rain', e.rain, et && et.rain, signedPct) +
        effectRow('Weekend', e.weekend, et && et.weekend, signedPct) + '</tbody></table>';
      var from = cur.marker != null ? cur.marker : S.FIRST_FORECAST;
      var eo = S.mape(o.forecast, cur.obs.dash.rides, from, N - 1), etr = S.mape(o.forecast, cur.obs.world.truth.rides, from, N - 1), ett = S.mape(t.forecast, cur.obs.world.truth.rides, from, N - 1);
      html += '<h4>Average error since ' + S.dateLabel(from) + '</h4><p>Against the dashboard’s rides: <strong>' + pct(eo, 1) + '</strong>.' +
        (tv ? ' Against what really happened: <strong>' + pct(etr, 1) + '</strong>. A model trained on the truth: ' + pct(ett, 1) + '.' : '') + '</p>';
      if (tv && cur.change && !isReal(cur.change) && cur.cmp.affected.indexOf('model') >= 0) {
        var says;
        if (Math.abs(e.rain - et.rain) > 0.12) says = 'it now thinks rain changes rides by ' + signedPct(e.rain) + '; trained on the truth it would say ' + signedPct(et.rain) + '.';
        else {
          var g = o.forecast[d] / t.forecast[d] - 1;
          says = 'for this day’s weather it expects ' + pct(g, 1) + (g < 0 ? ' fewer' : ' more') + ' rides than a model trained on the truth.';
        }
        html += '<p class="st-plain">Retrained every night on this data, the model has learned the fault as if it were the city: ' + esc(says) +
          (eo < etr ? ' Judged against its own data it even looks fine.' : '') + '</p>';
      } else if (tv && cur.change) {
        html += '<p class="st-plain is-ok">This model is the same as one trained on the truth.</p>';
      }
      html += '<h4>Its last three training rows</h4><table class="st-table"><thead><tr><th>Date</th><th class="num">Rides</th><th class="num">°C</th><th>Rain</th><th class="num">Record °C</th></tr></thead><tbody>' +
        n.rows.slice(-3).map(function (r) {
          var rec = cur.obs.world.weather[r.date];
          var mism = rec.temp !== r.temp || rec.rain !== r.rain;
          return '<tr><td>' + S.dateLabel(r.date) + '</td><td class="num">' + fmtInt(r.rides) + '</td><td class="num' + (mism ? ' is-ne' : '') + '">' + fmt1(r.temp) + '</td><td>' + (r.rain ? 'yes' : 'no') +
            '</td><td class="num">' + fmt1(rec.temp) + (rec.rain ? ', rain' : '') + '</td></tr>';
        }).join('') + '</tbody></table>';
      if (state.mode === 'detective' || cur.change) html += evidenceHtml('model');
      return html;
    }

    // ---------- inspector canvases: the map, the event stream, rides by hour ----------
    function updateTod() {
      if (todOut) todOut.textContent = clockOf(state.tod);
      if (todRange && document.activeElement !== todRange) todRange.value = Math.round(state.tod / 60);
      if (todBtn) todBtn.textContent = state.todPlaying ? 'Pause' : 'Play the day';
      drawMap();
      drawTicker();
    }

    // The routes riders take: straight lines between stations within reach of each other.
    var ROUTES = (function () {
      var out = [];
      for (var a = 0; a < S.STATIONS.length; a++) for (var b = a + 1; b < S.STATIONS.length; b++) {
        var A = S.STATIONS[a], B = S.STATIONS[b];
        if (Math.hypot(A.x - B.x, A.y - B.y) < 2.1) out.push([a, b]);
      }
      return out;
    })();
    var RIVER = [[-0.5, 0.0], [0.8, -0.08], [2.0, 0.1], [3.1, 0.06], [4.0, 0.32], [4.7, 0.55], [5.9, 0.42]];

    function drawMap() {
      if (!mapCanvas) return;
      var w = mapCanvas.clientWidth;
      if (!w) return;
      var h = Math.round(w * 46 / 54), ctx = sizeCanvas(mapCanvas, w, h);
      var world = cur.obs.world, d = clampDay(state.dayF), T = d * DAY + state.tod, tod = state.tod;
      var pad = 26, sx = (w - 2 * pad) / 5.4, sy = (h - 2 * pad - 8) / 4.6;
      function Q(x, y) { return [pad + x * sx, pad + y * sy]; }
      function P(s) { return Q(S.STATIONS[s].x, S.STATIONS[s].y); }
      var open = S.STATIONS.map(function (st) { return !st.opens || (world.newStation && d >= st.opens); });
      var inv = Array.prototype.slice.call(world.invStart[d]), ch = world.changes[d];
      for (var i = 0; i < ch.length; i += 3) if (ch[i] <= tod) inv[ch[i + 1]] += ch[i + 2];

      // the river along the north edge, and the routes between stations
      ctx.save();
      ctx.strokeStyle = COL.water; ctx.lineWidth = Math.max(9, sy * 0.24); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      var p0 = Q(RIVER[0][0], RIVER[0][1]);
      ctx.moveTo(p0[0], p0[1]);
      for (i = 1; i < RIVER.length - 1; i++) {
        var c = Q(RIVER[i][0], RIVER[i][1]), nx = Q((RIVER[i][0] + RIVER[i + 1][0]) / 2, (RIVER[i][1] + RIVER[i + 1][1]) / 2);
        ctx.quadraticCurveTo(c[0], c[1], nx[0], nx[1]);
      }
      var pl = Q(RIVER[RIVER.length - 1][0], RIVER[RIVER.length - 1][1]);
      ctx.lineTo(pl[0], pl[1]);
      ctx.stroke();
      ctx.strokeStyle = COL.rule; ctx.lineWidth = 1.2;
      ROUTES.forEach(function (r) {
        if (!open[r[0]] || !open[r[1]]) return;
        var a = P(r[0]), b = P(r[1]);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      });
      ctx.restore();

      // bikes in use: a dot with a short trail behind it, in the true image's cyan
      var inUse = 0;
      ctx.lineCap = 'round';
      [d - 1, d].forEach(function (dd) {
        if (dd < 0) return;
        var a = world.dayIndex[dd][0], b = world.dayIndex[dd][1];
        for (var k = a; k < b; k++) {
          var r = world.rides[k];
          if (r.t0 > T) break;
          if (r.t1 <= T) continue;
          inUse++;
          var f = (T - r.t0) / (r.t1 - r.t0), q0 = P(r.st0), q1 = P(r.st1), x, y;
          if (r.st0 === r.st1) { var ang = f * 6.283; x = q0[0] + 14 * Math.sin(ang); y = q0[1] - 14 + 14 * Math.cos(ang); }
          else {
            x = q0[0] + (q1[0] - q0[0]) * f; y = q0[1] + (q1[1] - q0[1]) * f;
            var fb = Math.max(0, f - 0.12), bx = q0[0] + (q1[0] - q0[0]) * fb, by = q0[1] + (q1[1] - q0[1]) * fb;
            ctx.strokeStyle = 'rgba(46,196,214,0.32)'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(x, y); ctx.stroke();
          }
          ctx.fillStyle = COL.cyan;
          ctx.beginPath(); ctx.arc(x, y, 2.3, 0, 6.283); ctx.fill();
        }
      });
      // riders turned away in the last 20 minutes
      var recent = {}, turned = 0;
      world.unmet.forEach(function (u) {
        if (u.day !== d || u.t > T) return;
        turned++;
        if (u.t > T - 1200) recent[u.st] = true;
      });
      // stations: a ring that fills with the bikes docked there, the count inside
      var empty = [];
      S.STATIONS.forEach(function (st, s) {
        if (!open[s]) return;
        var p = P(s), R = 8 + Math.sqrt(st.bikes) * 1.4, frac = Math.max(0, Math.min(1, inv[s] / st.bikes));
        ctx.fillStyle = COL.field; ctx.strokeStyle = inv[s] > 0 ? COL.ruleStrong : COL.white; ctx.lineWidth = inv[s] > 0 ? 1 : 1.6;
        if (!(inv[s] > 0)) ctx.setLineDash([3, 2.5]);
        ctx.beginPath(); ctx.arc(p[0], p[1], R, 0, 6.283); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
        if (inv[s] > 0) {
          ctx.strokeStyle = COL.cyan; ctx.lineWidth = 3.5; ctx.lineCap = 'butt';
          ctx.beginPath(); ctx.arc(p[0], p[1], R - 3, -Math.PI / 2, -Math.PI / 2 + frac * 6.283); ctx.stroke();
        } else empty.push(st.name);
        if (recent[s]) {
          ctx.strokeStyle = COL.white; ctx.lineWidth = 1; ctx.setLineDash([1.5, 2.5]);
          ctx.beginPath(); ctx.arc(p[0], p[1], R + 4, 0, 6.283); ctx.stroke(); ctx.setLineDash([]);
        }
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = COL.white; ctx.font = '700 11px ' + MONO;
        ctx.fillText(String(inv[s]), p[0], p[1] + 0.5);
        ctx.textBaseline = 'top'; ctx.font = '11.5px ' + FONT; ctx.fillStyle = inv[s] > 0 ? COL.dim : COL.white;
        ctx.fillText(st.name + (inv[s] > 0 ? '' : ', empty'), p[0], p[1] + R + (recent[s] ? 6 : 3));
      });
      ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = COL.white; ctx.font = '700 13px ' + MONO;
      ctx.fillText(clockOf(tod), 9, 8);
      mapCanvas.setAttribute('aria-label', 'Map of the stations at ' + clockOf(tod) + ' on ' + S.dateLabel(d) + '. ' + inUse + ' bikes in use. ' +
        (empty.length ? 'Empty: ' + empty.join(', ') + '.' : 'No station is empty.') + ' ' + turned + ' riders turned away so far today.');
      if (mapNote) mapNote.textContent = inUse + ' bikes out. ' + (empty.length ? 'Empty now: ' + empty.join(', ') + '. ' : 'No station is empty now. ') +
        turned + ' riders found no bike so far today. Each ring fills with the bikes docked there; dots are riders on their way.';
    }

    function drawTicker() {
      if (!tickerEl) return;
      var d = clampDay(state.dayF), tv = truthVisible();
      var limit = d * DAY + state.tod + S.UTC_OFFSET;
      var ev = cur.obs.log.events, lo = 0, hi = ev.length;
      while (lo < hi) { var mid = (lo + hi) >> 1; if (ev[mid].recv <= limit) lo = mid + 1; else hi = mid; }
      var list = [];
      for (var i = lo - 1; i >= 0 && list.length < 9; i--) if (ev[i].part === d) list.push(ev[i]);
      if (tv) {
        cur.obs.log.ghosts.forEach(function (g) { if (g.part === d && g.recv <= limit && g.recv > limit - 1800) list.push(g); });
        list.sort(function (a, b) { return b.recv - a.recv; });
        list = list.slice(0, 9);
      }
      list.reverse();
      // which events repeat an earlier one (derivable from the log alone)
      var seen = new Set(), repeats = new Set();
      for (i = Math.max(0, lo - 400); i < lo; i++) {
        var key = ev[i].type + ':' + ev[i].ref;
        if (seen.has(key)) repeats.add(ev[i]); else seen.add(key);
      }
      var names = { checkout: 'checkout', 'return': 'return', nobike: 'no bike' };
      tickerEl.innerHTML = list.length ? list.map(function (e) {
        var ghost = e.note === 'dropped';
        var note = '';
        if (ghost) note = '<span class="st-note is-fault">never arrived</span>';
        else if (e.note === 'double' && tv) note = '<span class="st-note is-fault">sent twice (app fault)</span>';
        else if (e.note === 'retry' && tv) note = '<span class="st-note">resent (normal)</span>';
        else if (repeats.has(e)) note = '<span class="st-note">repeats an earlier event</span>';
        if (e.ts > e.recv + 60) note += tv ? ' <span class="st-note is-fault">stamped 1 h late (clock)</span>' : ' <span class="st-note">stamped after it arrived</span>';
        if (e.kind === 'maintenance') note += ' <span class="st-note">mechanic</span>';
        return '<li><span class="' + (ghost ? 'is-ghost' : '') + '"><span class="t">' + clockOf(e.ts, true) + 'Z</span> <span class="k">' + names[e.type] + '</span> ' +
          (e.type === 'nobike' ? 'request ' : 'ride ') + e.ref + ' · ' + esc(S.stationName(e.st)) + '</span>' + note + '</li>';
      }).join('') : '<li>No events yet at this hour.</li>';
    }

    function drawHours() {
      if (!hourCanvas) return;
      var w = hourCanvas.clientWidth;
      if (!w) return;
      var h = 92, ctx = sizeCanvas(hourCanvas, w, h), d = clampDay(state.dayF);
      var a = cur.obs.pipe.hours[d], b = cur.tru.pipe.hours[d], tv = truthVisible();
      var max = 1;
      for (var k = 0; k < 24; k++) max = Math.max(max, a[k], tv ? b[k] : 0);
      var left = 2, bottom = h - 16, top = 6, bw = (w - left - 2) / 24;
      // the pipeline's hours in red and the true hours in cyan, added: equal hours come out white,
      // and where they differ the taller one shows its own colour above the white, with a tick at the truth's height
      ctx.globalCompositeOperation = 'lighter';
      for (k = 0; k < 24; k++) {
        var x = left + k * bw, ha = (bottom - top) * a[k] / max, fo = tv ? FUSE : 0;
        ctx.fillStyle = COL.red;
        ctx.fillRect(x + 1 - fo, bottom - ha, bw - 2, ha);
        if (tv) {
          var hb = (bottom - top) * b[k] / max;
          ctx.fillStyle = COL.cyan;
          ctx.fillRect(x + 1 + fo, bottom - hb, bw - 2, hb);
          if (a[k] !== b[k]) ctx.fillRect(x, bottom - hb - 1, bw, 2);
        }
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = COL.dim; ctx.font = '11px ' + MONO; ctx.textBaseline = 'top';
      [0, 6, 12, 18].forEach(function (hh) { ctx.fillText(pad2(hh) + ':00', left + hh * bw, bottom + 3); });
      var peak = 0; for (k = 1; k < 24; k++) if (a[k] > a[peak]) peak = k;
      hourCanvas.setAttribute('aria-label', 'Rides by hour on ' + S.dateLabel(d) + ' as dated by the pipeline. Busiest hour ' + pad2(peak) + ':00 with ' + a[peak] + ' rides.' +
        (tv ? ' The truth is drawn over it; where the two agree the bar is white.' : ''));
    }

    // ---------- detective mode ----------
    function loadScores() { try { return JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (e) { return {}; } }
    function saveScores() { try { localStorage.setItem(STORE, JSON.stringify(scores)); } catch (e) { /* private mode: fine */ } }

    function renderCases() {
      var host = $('st-cases');
      host.innerHTML = '';
      S.CASES.forEach(function (c, i) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'kit-button';
        b.setAttribute('aria-pressed', i === state.caseIdx ? 'true' : 'false');
        var sc = scores[c.id];
        b.innerHTML = (i + 1) + '. ' + esc(c.title) + '<span class="s">' + (sc === 2 ? 'solved' : sc === 1 ? 'half' : sc === 0 ? 'missed' : '') + '</span>';
        b.addEventListener('click', function () { openCase(i); });
        host.appendChild(b);
      });
      var solved = 0, tried = 0;
      S.CASES.forEach(function (c) { if (scores[c.id] != null) { tried++; if (scores[c.id] === 2) solved++; } });
      $('st-score').textContent = 'Six tickets, easiest first.' + (tried ? ' Solved ' + solved + ' of ' + S.CASES.length + '.' : '');
      var c = S.CASES[state.caseIdx];
      var tk = c.ticket(cur.obs, cur.tru);
      $('st-ticket').innerHTML = '<span class="from">Ticket ' + (state.caseIdx + 1) + ' of ' + S.CASES.length + ', from ' + CASE_FROM[state.caseIdx] + '</span>' + esc(tk.text);
      if (refocus === 'case') { refocus = null; focusQuiet(host.querySelector('[aria-pressed="true"]')); }
    }

    function renderAnswer() {
      var form = $('st-answer');
      form.hidden = state.mode !== 'detective';
      if (form.hidden) return;
      var lo = $('st-layer-options');
      var layers = [['world', 'World: nothing is broken'], ['log', 'Log'], ['pipeline', 'Pipeline'], ['dashboard', 'Dashboard'], ['model', 'Model']];
      lo.innerHTML = layers.map(function (l) {
        return '<label><input type="radio" name="st-layer" value="' + l[0] + '"' + (state.ansLayer === l[0] ? ' checked' : '') + (state.revealed ? ' disabled' : '') + '> ' + l[1] + '</label>';
      }).join('');
      Array.prototype.forEach.call(lo.querySelectorAll('input'), function (inp) {
        inp.addEventListener('change', function () { state.ansLayer = inp.value; state.ansFault = null; renderFaultOptions(); });
      });
      renderFaultOptions();
      var ex = Object.keys(state.examined).filter(function (k) { return state.examined[k] && k !== 'dashboard'; }).length;
      $('st-examined').textContent = 'Layers examined besides the dashboard: ' + ex + ' of 4.';
      var v = $('st-verdict');
      v.hidden = !state.revealed;
    }
    function renderFaultOptions() {
      var fo = $('st-fault-options'), field = $('st-fault-field');
      if (!state.ansLayer) { field.hidden = true; $('st-submit').disabled = true; return; }
      field.hidden = false;
      fo.innerHTML = S.ANSWERS[state.ansLayer].map(function (id) {
        var label = id === 'heatwave' ? 'Nothing is broken: the weather brought more riders' : id === 'newstation' ? 'Nothing is broken: a new station opened' : S.FAULTS[id].label;
        return '<label><input type="radio" name="st-fault" value="' + id + '"' + (state.ansFault === id ? ' checked' : '') + (state.revealed ? ' disabled' : '') + '> ' + esc(label) + '</label>';
      }).join('');
      Array.prototype.forEach.call(fo.querySelectorAll('input'), function (inp) {
        inp.addEventListener('change', function () { state.ansFault = inp.value; $('st-submit').disabled = state.revealed; });
      });
      $('st-submit').disabled = state.revealed || !state.ansFault;
    }

    $('st-answer').addEventListener('submit', function (e) {
      e.preventDefault();
      if (state.revealed || !state.ansFault) return;
      var c = S.CASES[state.caseIdx];
      var rightLayer = state.ansLayer === S.FAULTS[c.answer].layer, right = state.ansFault === c.answer;
      scores[c.id] = Math.max(scores[c.id] == null ? 0 : scores[c.id], right ? 2 : rightLayer ? 1 : 0);
      saveScores();
      state.revealed = true;
      var v = $('st-verdict');
      v.className = 'st-verdict ' + (right ? 'is-right' : 'is-wrong');
      var verdict = right ? 'Right layer, right cause.' : rightLayer ? 'Right layer, but not that cause.' : 'Not this time.';
      var ex = Object.keys(state.examined).filter(function (k) { return state.examined[k] && k !== 'dashboard'; }).length;
      v.innerHTML = '<p><span class="v">' + verdict + '</span> It was: ' + esc(answerLabel(c.answer)) + ' (' + INFO[S.FAULTS[c.answer].layer].name.toLowerCase() + ' layer).</p>' +
        '<p>' + esc(explain(c)) + '</p><p class="st-sub">You examined ' + ex + ' of the 4 other layers. The truth is now drawn beside every layer.</p>' +
        '<p>' + (state.caseIdx < S.CASES.length - 1 ? '<button type="button" class="kit-button" id="st-next">Next case</button>' : '<button type="button" class="kit-button" id="st-next">Back to case 1</button>') + '</p>';
      v.hidden = false;
      $('st-next').addEventListener('click', function () { refocus = 'case'; openCase((state.caseIdx + 1) % S.CASES.length); });
      refreshAll();
      pulse();
      v.focus();
    });

    function answerLabel(id) {
      if (id === 'heatwave') return 'nothing is broken, a heatwave brought more riders';
      if (id === 'newstation') return 'nothing is broken, a new station opened';
      var l = S.FAULTS[id].label; return l.charAt(0).toLowerCase() + l.slice(1);
    }

    function explain(c) {
      var o = cur.obs, t = cur.tru, F = cur.sc.faultDay, cmp = cur.cmp;
      var when = S.dateLabel(cur.marker);
      if (c.answer === 'definition') {
        var a = S.avg(t.dash.tripLen, F, N - 1), b = S.avg(o.dash.tripLen, F, N - 1);
        return 'The city did not change. On ' + when + ' the dashboard switched ‘average trip length’ from the mean to the median. Trip lengths are skewed (a few long rides pull the mean up), so the median sits about ' +
          pct(1 - b / a) + ' lower. The pipeline’s durations never changed, and the model, which reads only rides, never noticed.';
      }
      if (c.answer === 'staletable') {
        var riv = 0; o.log.events.forEach(function (e) { if (e.st === S.RIVERSIDE && e.type === 'checkout' && e.note === '') riv++; });
        return 'Riverside’s rides reached the log (' + fmtInt(riv) + ' checkouts), but the pipeline joins every trip to a stations table nobody updated. An inner join drops rows with no match, silently: ' +
          fmtInt(cmp.pipeline.missing) + ' trips vanished. Really, rides rose; the dashboard showed about ' + pct(-cmp.dashboard.rides) + ' too few from the opening on, and the model learned the smaller city.';
      }
      if (c.answer === 'clockskew') {
        var lc = S.logChecks(o.log);
        return 'From ' + when + ' the dock at Rail Station stamped every event an hour late. Each trip ending there looked 60 minutes longer, which lifted the average by about ' +
          fmt1(S.avg(o.dash.tripLen, F, N - 1) - S.avg(t.dash.tripLen, F, N - 1)) + ' minutes. Rides were untouched. The server’s own arrival times give it away: ' + fmtInt(lc.future) + ' events arrived before the time printed on them.';
      }
      if (c.answer === 'firmware') {
        return 'From ' + when + ' Harbour’s docks lost about 30% of their return events. A trip needs a checkout and a return, so the pipeline dropped ' + fmtInt(o.pipe.unmatched.reduce(function (x, y) { return x + y; }, 0)) +
          ' checkouts as unmatched. It did the right thing with bad data; the fault was below it. The bikes were there all along: most were next checked out at Harbour.';
      }
      if (c.answer === 'timezone') {
        return 'From ' + when + ' the pipeline took the date straight from the UTC timestamp. The city is 7 hours behind UTC, so every ride after 5 pm was filed under the next day. That first day lost its evening. After it, each day carries the evening before, so rides no longer line up with that day’s weather, and the retrained model’s error roughly doubled. Nothing in the log was wrong.';
      }
      var hw = o.world.weather.slice(S.HEAT_FROM, S.HEAT_TO + 1).map(function (w) { return w.temp; });
      return 'Nothing is broken. From ' + when + ' a heatwave (' + fmt1(Math.min.apply(null, hw)) + ' to ' + fmt1(Math.max.apply(null, hw)) + '°C) brought out more riders than the docks had bikes, so more people found stations empty. Every layer agrees with the world: the dashboard moved because the city moved. Repeated events stayed at their usual rate.';
    }

    function openCase(i, after) {
      stopPlay(); stopTod();
      state.caseIdx = i; state.examined = { dashboard: true }; state.revealed = false; state.ansLayer = null; state.ansFault = null;
      state.focus = 'dashboard';
      $('st-verdict').hidden = true;
      busyThen('Opening ticket ' + (i + 1) + '. Its city has to be simulated first…', function () {
        compute();
        state.dayF = cur.marker != null ? cur.marker : 30;
        if (after) after();
        refreshAll();
      });
    }

    // Some changes re-run several layers over 60 days of rides, which takes a moment on a slow
    // phone. Say so straight away, then do the work once the page has painted.
    var busyToken = 0, refocus = null;
    function focusQuiet(el) { if (!el) return; try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } }
    function busyThen(msg, fn) {
      var token = ++busyToken, main = $('st-main');
      main.classList.add('is-busy');
      $('st-story').innerHTML = '<span class="st-busy">' + esc(msg) + '</span>';
      setTimeout(function () {
        if (token !== busyToken) return;
        try { fn(); } finally { if (token === busyToken) main.classList.remove('is-busy'); }
      }, 40);
    }

    function examine(layer) {
      state.examined[layer] = true;
      focusLayer(layer, false);
      renderAnswer();
    }

    // ---------- focus, mode, faults, time ----------
    function focusLayer(layer, toggle) {
      if (state.mode === 'detective' && !state.revealed && !state.examined[layer]) { state.examined[layer] = true; renderAnswer(); }
      if (toggle && narrowMQ.matches && state.focus === layer) state.focus = null;
      else state.focus = layer;
      refreshBands();
      drawStrips();
      renderInspector();
    }

    function setMode(mode, after) {
      if (state.mode === mode) return;
      stopPlay(); stopTod();
      state.mode = mode;
      tabF.setAttribute('aria-selected', mode === 'forward' ? 'true' : 'false');
      tabD.setAttribute('aria-selected', mode === 'detective' ? 'true' : 'false');
      tabF.tabIndex = mode === 'forward' ? 0 : -1;
      tabD.tabIndex = mode === 'detective' ? 0 : -1;
      $('st-body').setAttribute('aria-labelledby', mode === 'forward' ? 'st-tab-forward' : 'st-tab-detective');
      $('st-truth-wrap').hidden = mode === 'detective';
      $('st-change-all-wrap').hidden = mode === 'detective';
      $('st-case').hidden = mode !== 'detective';
      if (mode === 'detective') openCase(state.caseIdx, after);
      else {
        busyThen('Back to cause and effect…', function () {
          compute(); state.focus = narrowMQ.matches ? null : 'dashboard'; refreshAll();
        });
      }
    }

    function chooseFault(f, layer, after, onLoad) {
      stopPlay();
      state.fault = f;
      var msg = !f ? 'Putting the city back as it was…'
        : isReal(f) ? 'Simulating the city again with this change…'
        : 'Re-running every layer from the ' + S.FAULTS[f].layer + ' up…';
      busyThen(msg, function () {
        compute();
        if (f) state.dayF = Math.min(N - 1, cur.marker + 6);
        if (f && !narrowMQ.matches) state.focus = layer === 'world' ? 'dashboard' : (S.FAULTS[f].layer);
        if (after) after();
        refreshAll();
        if (f && !onLoad) showStack(pulse); else pulse();
      });
    }
    // Bring the timeline and the five layers into view, so the pulse is seen from where it starts.
    // On a laptop the whole stack fits; on a phone its top is aligned with the top of the screen.
    var stackTimer = 0;
    function showStack(then) {
      clearTimeout(stackTimer);
      var col = stack.parentNode, r = col.getBoundingClientRect(), vh = window.innerHeight || document.documentElement.clientHeight;
      var fits = r.height <= vh;
      if ((fits && r.top >= 0 && r.bottom <= vh) || (!fits && r.top >= 0 && r.top < vh * 0.25)) { then(); return; }
      var smooth = !Kit.reducedMotion;
      try { col.scrollIntoView({ block: fits ? 'nearest' : 'start', behavior: smooth ? 'smooth' : 'auto' }); }
      catch (e) { col.scrollIntoView(!fits || r.top < 0); }
      if (smooth) stackTimer = setTimeout(then, 450); else then();
    }

    function setDay(d, fromPlay) {
      var before = clampDay(state.dayF);
      state.dayF = d;
      if (!fromPlay) slider.value = clampDay(d);
      updateDate();
      if (clampDay(d) !== before || !fromPlay) renderInspector();
      drawStrips();
    }
    var flag = $('st-date'), lastFlag = '';
    function updateDate() {
      var d = clampDay(state.dayF), txt = S.dateLabel(d);
      if (txt !== lastFlag) { flag.textContent = txt; lastFlag = txt; }
      if (document.activeElement !== slider) slider.value = d;
      slider.setAttribute('aria-valuetext', txt + ', day ' + (d + 1) + ' of ' + N);
      placeFlag();
    }
    // The date flag rides above the slider's thumb, which sits over the strips' cursor.
    function placeFlag() {
      var W = flag.parentNode.clientWidth;
      if (!W) return;
      var x = (Math.max(0, Math.min(N - 1, state.dayF)) + 0.5) / N * W, fw = flag.offsetWidth;
      flag.style.transform = 'translateX(' + Math.round(Math.max(0, Math.min(W - fw, x - fw / 2))) + 'px)';
    }
    // Line the slider up with the strips: the play button fills the strips' label gutter.
    var lastGut = -1;
    function layoutTime() {
      var c = bands.dashboard.canvas, w = c.clientWidth;
      if (!w) return;
      var gut = stripGeom(w).x0;
      if (gut !== lastGut) { $('st-time').style.setProperty('--st-gut', gut + 'px'); lastGut = gut; }
      placeFlag();
    }

    var raf = 0, lastT = 0;
    function setPlayBtn(on) {
      var b = $('st-play');
      b.querySelector('.st-play-t').textContent = on ? 'Pause' : 'Play';
      b.setAttribute('aria-label', on ? 'Pause the season' : 'Play the season');
      b.classList.toggle('is-on', on);
    }
    function startPlay() {
      if (!Kit.playing || !cur) return;
      if (state.dayF >= N - 1) state.dayF = 0;
      state.playing = true;
      state.crossed = cur.marker != null && state.dayF >= cur.marker;
      setPlayBtn(true);
      kick();
    }
    function stopPlay() {
      if (!state.playing) return;
      state.playing = false;
      state.dayF = clampDay(state.dayF);
      setPlayBtn(false);
      updateDate(); drawStrips(); renderInspector();
    }
    function startTod() {
      if (!Kit.playing) return;
      if (state.tod >= DAY - 300) state.tod = 5 * HOUR;
      state.todPlaying = true; updateTod(); kick();
    }
    function stopTod() { if (!state.todPlaying) return; state.todPlaying = false; updateTod(); }
    function kick() { if (!raf) { lastT = 0; raf = requestAnimationFrame(loop); } }
    function loop(now) {
      raf = 0;
      var dt = lastT ? Math.min(0.1, (now - lastT) / 1000) : 0;
      lastT = now;
      if (state.playing) {
        var before = clampDay(state.dayF);
        var next = state.dayF + dt / SEC_PER_DAY;
        if (next >= N - 1) { next = N - 1; }
        setDay(next, true);
        if (clampDay(next) !== before) updateDate();
        if (cur.marker != null && !state.crossed && next >= cur.marker) { state.crossed = true; pulse(); }
        if (next >= N - 1) stopPlay();
      }
      if (state.todPlaying) {
        state.tod += dt * 3600;
        if (state.tod >= DAY - 60) { state.tod = DAY - 60; state.todPlaying = false; }
        updateTod();
      }
      if (state.playing || state.todPlaying) raf = requestAnimationFrame(loop);
      else lastT = 0;
    }

    function refreshAll() {
      if (!cur) return;
      var legend = '<span class="st-legend-inline" aria-hidden="true"><span><span class="st-key"></span>recorded</span>' +
        '<span><span class="st-key is-truth"></span>truth</span><span><span class="st-key is-fused"></span>the two agree</span><span><span class="st-key is-gap"></span>the gap</span>' +
        '<span><span class="st-key is-dot"></span>actual rides, under the forecast</span></span>';
      $('st-hint').innerHTML = state.mode === 'forward'
        ? 'Choose a change. Drag through time, or open a layer for details. ' +
          (state.truth ? legend + '<span class="st-vh">Red lines are what each layer records and cyan lines the truth, dashed where the two part, with the gap between them hatched; where they agree they fuse into one white line. Dots under the forecast are the actual rides.</span>' : '')
        : 'Inspect the layers, then identify the cause. The truth is revealed after your answer.';
      $('st-story').innerHTML = storyHtml();
      Array.prototype.forEach.call($('st-story').querySelectorAll('.st-try'), function (b) {
        b.addEventListener('click', function () {
          var f = b.getAttribute('data-try') || null;
          refocus = 'story';
          chooseFault(f, f ? S.FAULTS[f].layer : null);
        });
      });
      // keep keyboard focus in the same place once the line is rebuilt: on Undo, or on the first suggestion
      if (refocus === 'story') { refocus = null; focusQuiet($('st-story').querySelector('.st-try')); }
      if (state.mode === 'detective') renderCases();
      renderAnswer();
      updateDate();
      refreshBands();
      drawStrips();
      renderInspector();
      writeHash();
    }

    // ---------- resize ----------
    var lastNarrow = narrowMQ.matches;
    function onResize() {
      // A ResizeObserver reports once on the first rendered frame, before the first compute()
      // has run. Nothing is drawn until then; refreshAll() lays everything out once it has.
      if (!cur) return;
      if (narrowMQ.matches !== lastNarrow) {
        lastNarrow = narrowMQ.matches;
        if (!lastNarrow && !state.focus) state.focus = 'dashboard';
        refreshBands(); renderInspector();
      }
      drawStrips(); drawMap(); drawHours();
    }
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function () { onResize(); });
      ro.observe(stack);
    } else window.addEventListener('resize', onResize);
    // the canvases name their rows in the stage's faces: draw again once those have arrived
    whenFonts(['11px "Space Grotesk"', '500 12px "Space Grotesk"', '12px "Space Mono"', '700 13px "Space Mono"'], function () {
      if (cur) { drawStrips(); drawMap(); drawHours(); }
    });

    // ---------- start ----------
    $('st-story').textContent = 'Building the city…';
    setTimeout(function () {
      var h = readHash();
      var after = function () { if (h.l) state.focus = h.l; if (h.d != null) state.dayF = h.d; };
      if (h.c != null) { state.caseIdx = h.c; setMode('detective', after); }
      else if (h.f) chooseFault(h.f, S.FAULTS[h.f].layer, after, true);
      else { compute(); after(); refreshAll(); }
    }, 30);

    // ---------- a shareable address: #fault=firmware, #case=3, optional &layer=log&day=40 ----------
    function readHash() {
      var out = {};
      try {
        var p = new URLSearchParams((location.hash || '').replace(/^#/, ''));
        var f = p.get('fault'), c = parseInt(p.get('case'), 10), l = p.get('layer'), d = parseInt(p.get('day'), 10);
        if (S.isFault(f)) out.f = f;
        if (c >= 1 && c <= S.CASES.length) out.c = c - 1;
        if (BAND_ORDER.indexOf(l) >= 0) out.l = l;
        if (d >= 1 && d <= N) out.d = d - 1;
      } catch (e) { /* no URLSearchParams: ignore the address */ }
      return out;
    }
    function writeHash() {
      if (!window.history || !history.replaceState) return;
      var h = state.mode === 'detective' ? '#case=' + (state.caseIdx + 1) : state.fault ? '#fault=' + state.fault : '';
      if (h !== location.hash) { try { history.replaceState(null, '', h || location.pathname + location.search); } catch (e) { /* file:// */ } }
    }
  }
})();
