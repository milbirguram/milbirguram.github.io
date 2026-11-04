// Warrant: the page. All numbers shown come from model.js (window.WarrantModel).
(function () {
  'use strict';

  var W = window.WarrantModel;
  var Kit = window.Kit || { preview: false, reducedMotion: false, onPlay: function (cb) { cb(true); } };
  var D = W.DEFAULTS, S = W.SHIFT, C = W.CONTROLS;

  // A bond certificate: ink and intaglio green on security paper, serial red for the misses.
  var COL = {
    ink: '#1c1d19', strong: '#1c1d19', muted: '#4c5446', line: 'rgba(31,90,70,0.15)', lineStrong: 'rgba(31,90,70,0.5)',
    accent: '#1f5a46', miss: '#9a2b1e', bandFill: 'rgba(31,90,70,0.06)', hatch: 'rgba(31,90,70,0.55)', cal: '#a6b3a3',
    range: 'rgba(31,90,70,0.12)', ghost: '#5d6357', plot: '#f8f5ea', wash: '#f3eedd', fitted: 'rgba(28,29,25,0.45)'
  };
  var VIEW = { xMax: 12, yMax: 90 };      // display range of the scatter, km and minutes
  var SHOWN = 600;                         // trips on the history chart
  var TRAIL = 160;                         // recent trips drawn on the scatter
  var Y_FLOOR = 0.4;                       // lowest coverage the history chart's scale shows
  var SPEEDS = [{ label: 'Slow', perSecond: 4 }, { label: 'Normal', perSecond: 12 }, { label: 'Fast', perSecond: 40 }];
  var NAMES = { split: 'No repair', weighted: 'Weighted', aci: 'ACI', acir: 'ACI with recalibration', recal: 'Recalibration only', cqr: 'CQR' };

  function $(id) { return document.getElementById(id); }
  function pct(v, d) { return isFinite(v) ? (100 * v).toFixed(d == null ? 1 : d) + '%' : '–'; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function decimals(step) { return Math.max(0, Math.round(-Math.log10(step))); }
  function ordinal(k) {
    var t = k % 100, u = k % 10;
    return k + (t > 10 && t < 14 ? 'th' : u === 1 ? 'st' : u === 2 ? 'nd' : u === 3 ? 'rd' : 'th');
  }
  function copyShift(s) { return { medianKm: s.medianKm, extraNoisePerKm: s.extraNoisePerKm, extraPerKm: s.extraPerKm }; }

  // ---------------------------------------------------------------- canvases
  function surface(canvas) {
    var o = { canvas: canvas, ctx: canvas.getContext('2d'), w: 0, h: 0 };
    o.resize = function () {
      var r = canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      o.w = Math.max(1, r.width); o.h = Math.max(1, r.height);
      canvas.width = Math.round(o.w * dpr); canvas.height = Math.round(o.h * dpr);
      o.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    o.resize();
    return o;
  }

  function font(px, weight, italic) { return (italic ? 'italic ' : '') + (weight || 400) + ' ' + px + 'px "Playfair Display", Georgia, "Times New Roman", serif'; }
  // Canvas text waits for the self-hosted face; redraw once it is in.
  function whenFonts(cb) {
    if (!document.fonts || !document.fonts.load) return;
    Promise.all(['400', '700', 'italic 400'].map(function (f) { return document.fonts.load(f + ' 12px "Playfair Display"'); }))
      .then(cb, function () {});
  }
  // The seal on the chart: whole, cracked while coverage is below the expected range, mended after.
  function sealer() {
    var E = window.WarrantEngraving, svg = $('wa-seal');
    var set = E && svg ? E.seal(svg, 'wa-seal') : function () {}, broke = false;
    return {
      reset: function () { broke = false; },
      show: function (flag, promise) {
        if (flag === 'below') broke = true;
        var st = flag === 'below' ? 'broken' : broke ? 'mended' : 'whole';
        set(st, st === 'broken' ? 'Seal cracked: coverage has fallen below the range expected if nothing had changed. The promise is ' + promise + '.'
          : st === 'mended' ? 'Seal mended: coverage is back inside the expected range. The promise is ' + promise + '.'
          : 'Seal intact: coverage is not below the expected range. The promise is ' + promise + '.', promise);
      }
    };
  }

  // A small Gaussian kernel density over distance, for the "old versus new" strip.
  function density(xs, grid, bw) {
    var out = new Array(grid.length), k = 1 / (xs.length * bw * Math.sqrt(2 * Math.PI));
    for (var g = 0; g < grid.length; g++) {
      var s = 0;
      for (var i = 0; i < xs.length; i++) { var z = (grid[g] - xs[i]) / bw; if (z > -4 && z < 4) s += Math.exp(-0.5 * z * z); }
      out[g] = s * k;
    }
    return out;
  }

  // ---------------------------------------------------------------- the scatter
  function drawScatter(sf, sim, method, opt) {
    var ctx = sf.ctx, w = sf.w, h = sf.h, small = w < 460;
    opt = opt || {};
    var L = opt.preview ? 8 : (small ? 34 : 42), R = w - (opt.preview ? 8 : 12);
    var T = opt.preview ? 26 : 14, B = (opt.bottom != null ? opt.bottom : h - (small ? 28 : 32));
    var px = function (x) { return L + x / VIEW.xMax * (R - L); };
    var py = function (y) { return B - y / VIEW.yMax * (B - T); };

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = COL.plot; ctx.fillRect(0, 0, w, h);

    // grid and ticks
    ctx.lineWidth = 1; ctx.strokeStyle = COL.line; ctx.fillStyle = COL.muted;
    ctx.font = font(small || opt.preview ? 11 : 12);
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    var xStep = small ? 4 : 2, yStep = 20, v;
    for (v = 0; v <= VIEW.xMax; v += xStep) {
      ctx.beginPath(); ctx.moveTo(Math.round(px(v)) + 0.5, T); ctx.lineTo(Math.round(px(v)) + 0.5, B); ctx.stroke();
      if (!opt.preview) ctx.fillText(String(v), px(v), B + 6);
    }
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (v = 0; v <= VIEW.yMax; v += yStep) {
      ctx.beginPath(); ctx.moveTo(L, Math.round(py(v)) + 0.5); ctx.lineTo(R, Math.round(py(v)) + 0.5); ctx.stroke();
      if (!opt.preview) ctx.fillText(String(v), L - 6, py(v));
    }
    if (!opt.preview) {
      ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
      ctx.fillText('distance, km', R, h - 2);
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('delivery time, min', L + 6, T + 4);
    }

    ctx.save();
    ctx.beginPath(); ctx.rect(L, T, R - L, B - T); ctx.clip();

    // old versus new distances
    if (!opt.preview) {
      var grid = [], n = 80;
      for (var i = 0; i < n; i++) grid.push(0.05 + i * (VIEW.xMax - 0.1) / (n - 1));
      if (!sim._calDens) sim._calDens = density(sim.cal.xs, grid, 0.3);
      var hist = sim.history, recentXs = [];
      for (i = Math.max(0, hist.length - D.covWindow); i < hist.length; i++) recentXs.push(hist[i].x);
      var newDens = recentXs.length ? density(recentXs, grid, 0.3) : null;
      var peak = Math.max.apply(null, sim._calDens.concat(newDens || [])), hgt = 26;
      var dy = function (d) { return B - d / peak * hgt; };
      ctx.beginPath(); ctx.moveTo(px(grid[0]), B);
      grid.forEach(function (g, j) { ctx.lineTo(px(g), dy(sim._calDens[j])); });
      ctx.lineTo(px(grid[n - 1]), B); ctx.closePath();
      ctx.fillStyle = COL.range; ctx.fill();
      if (newDens) {
        ctx.beginPath();
        grid.forEach(function (g, j) { if (j) ctx.lineTo(px(g), dy(newDens[j])); else ctx.moveTo(px(g), dy(newDens[j])); });
        ctx.strokeStyle = COL.ink; ctx.lineWidth = 1.25; ctx.stroke();
      }
      var argmax = function (a) { var b = 0; for (var j = 1; j < a.length; j++) if (a[j] > a[b]) b = j; return b; };
      ctx.font = font(11); ctx.fillStyle = COL.muted; ctx.textBaseline = 'bottom'; ctx.textAlign = 'center';
      var ca = argmax(sim._calDens), na = newDens ? argmax(newDens) : ca;
      if (Math.abs(px(grid[ca]) - px(grid[na])) > 44) {
        ctx.fillText('old', px(grid[ca]), dy(sim._calDens[ca]) - 2);
        ctx.fillText('new', px(grid[na]), dy(newDens[na]) - 2);
      } else {
        ctx.textAlign = 'right';
        ctx.fillText('distances: old and new alike', R - 6, B - 4);
      }
    }

    // calibration trips
    ctx.fillStyle = COL.cal;
    var rc = opt.preview ? 1.4 : (small ? 1.4 : 1.7);
    for (i = 0; i < sim.cal.xs.length; i++) {
      ctx.beginPath(); ctx.arc(px(sim.cal.xs[i]), py(sim.cal.ys[i]), rc, 0, 6.2832); ctx.fill();
    }

    // the axes, ruled twice like the frame of a certificate
    ctx.restore();
    ctx.strokeStyle = COL.accent; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(L + 0.5, T); ctx.lineTo(L + 0.5, B + 0.5); ctx.lineTo(R, B + 0.5); ctx.stroke();
    ctx.save();
    ctx.beginPath(); ctx.rect(L, T, R - L, B - T); ctx.clip();

    // bands
    function bandPath(m) {
      var top = [], bot = [], unb = [], empty = false, steps = 72;
      for (var j = 0; j <= steps; j++) {
        var x = 0.1 + j * (VIEW.xMax - 0.1) / steps, b = sim.band(m, x);
        if (isNaN(b[0])) { empty = true; continue; }
        if (!isFinite(b[1])) unb.push(x);
        top.push([px(x), py(clamp(b[1], -VIEW.yMax, 2 * VIEW.yMax))]);
        bot.push([px(x), py(clamp(b[0], -VIEW.yMax, 2 * VIEW.yMax))]);
      }
      return { top: top, bot: bot, unb: unb, empty: empty };
    }
    function edge(pts) { pts.forEach(function (p, j) { if (j) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }); }

    var bp = bandPath(method);
    if (bp.top.length) {
      ctx.beginPath(); edge(bp.top);
      for (i = bp.bot.length - 1; i >= 0; i--) ctx.lineTo(bp.bot[i][0], bp.bot[i][1]);
      ctx.closePath(); ctx.fillStyle = COL.bandFill; ctx.fill();
      // The band as an engraved ribbon: lines that run with it, closer together where it is narrow.
      var widest = 0, j2, k2;
      for (j2 = 0; j2 < bp.top.length; j2++) widest = Math.max(widest, bp.bot[j2][1] - bp.top[j2][1]);
      var nl = clamp(Math.round(widest / (opt.preview ? 3.4 : 3.2)), 3, 48);
      ctx.strokeStyle = COL.hatch; ctx.lineWidth = opt.preview ? 0.7 : 0.6; ctx.beginPath();
      for (k2 = 1; k2 < nl; k2++) {
        for (j2 = 0; j2 < bp.top.length; j2++) {
          var yy = bp.top[j2][1] + k2 / nl * (bp.bot[j2][1] - bp.top[j2][1]);
          if (j2) ctx.lineTo(bp.top[j2][0], yy); else ctx.moveTo(bp.top[j2][0], yy);
        }
      }
      ctx.stroke();
      ctx.strokeStyle = COL.accent; ctx.lineWidth = 1.6;
      ctx.beginPath(); edge(bp.top); ctx.stroke();
      ctx.beginPath(); edge(bp.bot); ctx.stroke();
      if (widest > 12) {
        var inner = function (pts, d) { pts.forEach(function (p, j) { if (j) ctx.lineTo(p[0], p[1] + d); else ctx.moveTo(p[0], p[1] + d); }); };
        ctx.lineWidth = 0.6;
        ctx.beginPath(); inner(bp.top, 2.8); ctx.stroke();
        ctx.beginPath(); inner(bp.bot, -2.8); ctx.stroke();
      }
    }
    if (method !== 'split' && opt.ghost !== false) {
      var gp = bandPath('split');
      ctx.setLineDash([5, 4]); ctx.strokeStyle = COL.ghost; ctx.lineWidth = 1.25;
      ctx.beginPath(); edge(gp.top); ctx.stroke();
      ctx.beginPath(); edge(gp.bot); ctx.stroke();
      ctx.setLineDash([]);
    }
    // the fitted line
    ctx.strokeStyle = COL.fitted; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px(0), py(sim.model.predict(0))); ctx.lineTo(px(VIEW.xMax), py(sim.model.predict(VIEW.xMax))); ctx.stroke();

    // recent trips: dots inside the band, crosses outside
    var hist2 = sim.history, start = Math.max(0, hist2.length - TRAIL), r = opt.preview ? 3 : (small ? 2.6 : 3);
    for (i = start; i < hist2.length; i++) {
      var rec = hist2[i], age = (hist2.length - 1 - i) / TRAIL, a = 1 - 0.75 * age;
      var hit = opt.hitOf ? opt.hitOf(rec) : rec.m[method].hit;
      var X = px(rec.x), Y = py(clamp(rec.y, 0, VIEW.yMax));
      ctx.globalAlpha = a;
      if (hit) {
        ctx.fillStyle = COL.ink; ctx.beginPath(); ctx.arc(X, Y, r, 0, 6.2832); ctx.fill();
      } else {
        ctx.strokeStyle = COL.miss; ctx.lineWidth = 2; ctx.beginPath();
        ctx.moveTo(X - r - 0.5, Y - r - 0.5); ctx.lineTo(X + r + 0.5, Y + r + 0.5);
        ctx.moveTo(X + r + 0.5, Y - r - 0.5); ctx.lineTo(X - r - 0.5, Y + r + 0.5); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    if (hist2.length) {
      var last = hist2[hist2.length - 1];
      ctx.strokeStyle = COL.strong; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(px(last.x), py(clamp(last.y, 0, VIEW.yMax)), r + 4, 0, 6.2832); ctx.stroke();
    }
    ctx.restore();

    // notes on the band itself
    ctx.font = font(11); ctx.fillStyle = COL.strong; ctx.textBaseline = 'top'; ctx.textAlign = 'center';
    if (bp.unb.length && !opt.preview) {
      var mid = bp.unb[Math.floor(bp.unb.length / 2)];
      ctx.fillText('band unbounded here', clamp(px(mid), L + 60, R - 60), T + 22);
    }
    if (bp.empty && !bp.top.length) ctx.fillText('band empty', (L + R) / 2, T + 22);
    return { L: L, R: R, T: T, B: B };
  }

  // ---------------------------------------------------------------- coverage over time
  // series: [{t, cov, n}] plus optional comparison; draws the target, the expected range and the line(s).
  function drawCoverage(ctx, box, rows, opt) {
    var L = box.L, R = box.R, T = box.T, B = box.B, lo = opt.yLo, target = opt.target;
    if (!rows.length) return;
    var t0 = rows[0].t, span = Math.max(opt.span - 1, 1);
    var px = function (t) { return L + (t - t0) / span * (R - L); };
    var py = function (v) { return B - (v - lo) / (1 - lo) * (B - T); };

    // expected range if nothing had changed
    ctx.beginPath();
    rows.forEach(function (r, i) { var g = W.coverageRange(r.n, opt.nCal, opt.alpha); if (i) ctx.lineTo(px(r.t), py(g.hi)); else ctx.moveTo(px(r.t), py(g.hi)); });
    for (var i = rows.length - 1; i >= 0; i--) { var g = W.coverageRange(rows[i].n, opt.nCal, opt.alpha); ctx.lineTo(px(rows[i].t), py(Math.max(g.lo, lo))); }
    ctx.closePath(); ctx.fillStyle = COL.range; ctx.fill();

    // target
    ctx.setLineDash([4, 4]); ctx.strokeStyle = COL.accent; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(L, Math.round(py(target)) + 0.5); ctx.lineTo(R, Math.round(py(target)) + 0.5); ctx.stroke();
    ctx.setLineDash([]);

    function line(key, colour, width, dash) {
      ctx.strokeStyle = colour; ctx.lineWidth = width; ctx.setLineDash(dash || []);
      ctx.beginPath();
      rows.forEach(function (r, j) { var y = py(Math.max(lo, r[key])); if (j) ctx.lineTo(px(r.t), y); else ctx.moveTo(px(r.t), y); });
      ctx.stroke(); ctx.setLineDash([]);
    }
    if (opt.compare) line('cmp', COL.ghost, 1.25, [5, 4]);
    if (opt.compare2) line('cmp2', COL.ink, 1.5, [1.5, 3]);
    line('cov', COL.strong, opt.preview ? 2 : 1.75);
    return px;
  }

  // ---------------------------------------------------------------- full page
  function fullPage() {
    var sc = surface($('wa-scatter')), hc = surface($('wa-history'));
    var state = { step: 1, method: 'split', aciScores: 'fixed', running: !Kit.reducedMotion, speed: 1, acc: 0, events: [], flag: null, kit: true };
    var sim, seal = sealer();

    function active() {
      if (state.step !== 3) return 'split';
      if (state.method === 'aci') return state.aciScores === 'recent' ? 'acir' : 'aci';
      return state.method;
    }
    // True when the world is, and is set to stay, as it was when the calibration trips were drawn.
    function unchanged() {
      var b = W.baseShift();
      for (var k in b) if (Math.abs(sim.target[k] - b[k]) > 1e-9 || Math.abs(sim.cur[k] - b[k]) > 1e-3 * (1 + Math.abs(b[k]))) return false;
      return true;
    }

    function prefill() { for (var i = 0; i < D.covWindow; i++) sim.step(); }
    function build(seed, from) {
      sim = new W.Simulator({ seed: seed, alpha: from ? from.alpha : D.alpha, gamma: from ? from.o.gamma : D.gamma });
      if (from) { sim.cur = copyShift(from.cur); sim.target = copyShift(from.target); sim.setWeightMode(from.weightMode); }
      state.events = []; state.lows = null; seal.reset();
      prefill();
    }
    build(D.seed);

    // ---- controls, all ranges from the model
    var alphaIn = $('wa-alpha');
    alphaIn.min = (1 - C.alpha.max).toFixed(decimals(C.alpha.step));
    alphaIn.max = (1 - C.alpha.min).toFixed(decimals(C.alpha.step));
    alphaIn.step = String(C.alpha.step);
    alphaIn.value = (1 - D.alpha).toFixed(decimals(C.alpha.step));
    function promiseText() {
      $('wa-promise-text').innerHTML = 'Promise: for <strong>' + pct(1 - sim.alpha, 0) + '</strong> of new trips, the true time falls inside the band <span class="wa-dim">(α = ' + sim.alpha.toFixed(decimals(C.alpha.step)) + ')</span>';
    }
    alphaIn.addEventListener('input', function () {
      var a = Number((1 - Number(alphaIn.value)).toFixed(decimals(C.alpha.step)));
      sim.setAlpha(a);
      state.events = []; state.lows = null; seal.reset();
      prefill();
      promiseText(); refresh(true);
    });

    var sliders = [
      { id: 'wa-s-median', key: 'medianKm', out: 'wa-o-median', fmt: function (v) { return v.toFixed(1) + ' km'; }, ev: 'longer trips' },
      { id: 'wa-s-noise', key: 'extraNoisePerKm', out: 'wa-o-noise', fmt: function (v) {
        // The real change in the noise sd at a reference distance, not the ratio of the per-km terms alone.
        var ref = S.noiseRefKm, b = W.baseShift(), s2 = W.baseShift();
        s2.extraNoisePerKm = v;
        return 'spread ×' + (W.noiseSd(ref, s2) / W.noiseSd(ref, b)).toFixed(1) + ' at ' + ref + ' km';
      }, ev: 'noisier' },
      { id: 'wa-s-drift', key: 'extraPerKm', out: 'wa-o-drift', fmt: function (v) { return '+' + v.toFixed(1) + ' min per km'; }, ev: 'drift' }
    ];
    sliders.forEach(function (s) {
      var el = $(s.id), lim = S[s.key];
      el.min = String(lim.min); el.max = String(lim.max); el.step = String((lim.max - lim.min) / 40);
      el.value = String(sim.target[s.key]);
      s.el = el;
      $(s.out).textContent = s.fmt(Number(el.value));
      el.addEventListener('input', function () {
        sim.setTarget(s.key, Number(el.value));
        $(s.out).textContent = s.fmt(Number(el.value));
        refresh(true);
      });
      el.addEventListener('change', function () { mark(s.ev); });
    });
    function syncSliders() {
      sliders.forEach(function (s) { s.el.value = String(sim.target[s.key]); $(s.out).textContent = s.fmt(sim.target[s.key]); });
    }
    $('wa-restore').addEventListener('click', function () {
      var b = W.baseShift();
      for (var k in b) sim.setTarget(k, b[k]);
      syncSliders(); mark('restored'); refresh(true);
    });

    function mark(label) { state.events.push({ t: sim.t, label: label }); state.lows = { acir: 1, recal: 1, any: false }; draw(); }

    Array.prototype.forEach.call(document.querySelectorAll('input[name="wa-method"]'), function (r) {
      r.addEventListener('change', function () {
        if (!r.checked) return;
        state.method = r.value;
        $('wa-weights').hidden = r.value !== 'weighted';
        $('wa-gamma-box').hidden = r.value !== 'aci';
        $('wa-ascores').hidden = r.value !== 'aci';
        refresh(true);
      });
    });
    $('wa-recal-n').textContent = String(D.recalWindow);
    Array.prototype.forEach.call(document.querySelectorAll('input[name="wa-ascores"]'), function (r) {
      r.addEventListener('change', function () { if (r.checked) { state.aciScores = r.value; refresh(true); } });
    });
    Array.prototype.forEach.call(document.querySelectorAll('input[name="wa-wmode"]'), function (r) {
      r.addEventListener('change', function () { if (r.checked) { sim.setWeightMode(r.value); refresh(true); } });
    });
    var gammaIn = $('wa-gamma');
    gammaIn.min = '0'; gammaIn.max = '100'; gammaIn.step = '1';
    var gRatio = C.gamma.max / C.gamma.min;
    gammaIn.value = String(Math.round(100 * Math.log(D.gamma / C.gamma.min) / Math.log(gRatio)));
    function gammaOut() {
      $('wa-o-gamma').textContent = sim.o.gamma.toFixed(3);
      gammaIn.setAttribute('aria-valuetext', 'γ = ' + sim.o.gamma.toFixed(3));
    }
    gammaIn.addEventListener('input', function () {
      sim.setGamma(C.gamma.min * Math.pow(gRatio, Number(gammaIn.value) / 100));
      gammaOut(); refresh(true);
    });

    var speedSel = $('wa-speed');
    SPEEDS.forEach(function (s, i) { var o = document.createElement('option'); o.value = String(i); o.textContent = s.label; speedSel.appendChild(o); });
    speedSel.value = String(state.speed);
    speedSel.addEventListener('change', function () { state.speed = Number(speedSel.value); });

    var playBtn = $('wa-play');
    function playLabel() { playBtn.textContent = state.running ? 'Pause' : 'Play'; }
    playBtn.addEventListener('click', function () { state.running = !state.running; playLabel(); schedule(); });
    playLabel();

    $('wa-redraw').addEventListener('click', function () {
      build((Math.random() * 1e9) >>> 0, sim);
      refresh(true);
      say('New past trips drawn; the line and band were refitted.');
    });

    Array.prototype.forEach.call(document.querySelectorAll('.wa-step'), function (b) {
      b.addEventListener('click', function () { setStep(Number(b.getAttribute('data-step'))); });
    });
    function setStep(n) {
      state.step = n;
      Array.prototype.forEach.call(document.querySelectorAll('.wa-step'), function (b) {
        b.setAttribute('aria-pressed', String(Number(b.getAttribute('data-step')) === n));
      });
      Array.prototype.forEach.call(document.querySelectorAll('[data-steps]'), function (el) {
        el.hidden = el.getAttribute('data-steps').split(' ').indexOf(String(n)) < 0;
      });
      $('wa-ghost-label').parentNode.hidden = active() === 'split';
      say(['', 'Step 1: the promise.', 'Step 2: shift the trips.', 'Step 3: repair.'][n]);
      refresh(true);
    }

    function say(text) { $('wa-live').textContent = text; }

    // ---- words, all computed
    function copyStep1() {
      var n = sim.calScores.length, k = W.conformalRank(n, sim.alpha);
      $('wa-copy-1a').textContent = 'A straight line was fitted to ' + sim.train.xs.length + ' past trips. Its errors on ' + n +
        ' other past trips set the band: its half-width is the ' + ordinal(k) + ' smallest of those errors, k = ⌈(n + 1)(1 − α)⌉ with n = ' + n + '.';
      var odds = Math.round(1 / (1 - W.RANGE_MASS)), text;
      if (!unchanged()) {
        text = 'You have shifted the world in step 2, so new trips are no longer exchangeable with the old ones, and the shaded range no longer describes what to expect.';
      } else if (state.flag === 'inside' || !state.flag) {
        text = 'New trips come from the same world as the old ones, so they are exchangeable with them and the promise holds. ' +
          'Coverage wanders inside the shaded range; even with nothing changed, about 1 window in ' + odds + ' falls outside it. The promise is about the long run, not about any one trip.';
      } else {
        text = 'Coverage is ' + state.flag + ' the shaded range just now, by chance: nothing has changed, and about 1 window in ' + odds + ' falls outside it anyway. ' +
          'The promise is about the long run, not about any one trip.';
      }
      $('wa-copy-1b').textContent = text;
    }

    function diagnosis() {
      var t = sim.target, b = W.baseShift(), out = [];
      var cov = t.medianKm > b.medianKm + 1e-9, noise = t.extraNoisePerKm > 1e-9, drift = t.extraPerKm > 1e-9;
      if (!cov && !noise && !drift) out.push('New trips still follow the calibration data.');
      else out.push('The trips have changed; the original coverage guarantee no longer applies.');
      if (cov) out.push('Longer trips expose gaps in the old data. The input check can detect this shift.');
      if (noise) out.push('Long trips are less predictable. The input check cannot detect this change.');
      if (drift) out.push('Each kilometre takes longer. The missed predictions reveal this drift.');
      $('wa-diagnosis').innerHTML = out.map(function (p) { return '<p>' + p + '</p>'; }).join('');
    }

    function methodCopy(sum) {
      var m = state.method, n = sim.calScores.length, html = [];
      var noShift = (function () { var b = W.baseShift(); for (var k in b) if (Math.abs(sim.target[k] - b[k]) > 1e-9) return false; return true; })();
      if (noShift) html.push('<p class="wa-dim">Nothing has shifted yet. Set a shift above, then compare the repairs.</p>');
      if (m === 'split') {
        html.push('<p><b>No repair.</b> The band was set once, from the calibration trips. Its guarantee needs new trips to be exchangeable with them.</p>');
      } else if (m === 'weighted') {
        html.push('<p><b>Fixes</b> covariate shift. Calibration trips that look like today’s count for more, in proportion to the likelihood ratio of new to old distances (Tibshirani, Barber, Candès and Ramdas, 2019).</p>');
        html.push('<p><b>Does not fix</b> a change in how distance turns into time: try the other two sliders. <b>Costs</b> width: fewer trips effectively count, and far from the old data the band can become unbounded.</p>');
        html.push('<p class="wa-dim">Calibration trips that effectively count: ' + Math.round(sim.effectiveCalSize()) + ' of ' + n + '.' +
          (sim.weightMode === 'estimated' ? ' The ratio comes from a logistic classifier that tells the calibration distances from the latest ' + sim.o.recentWindow + ', refitted every ' + sim.o.refitEvery + ' trips.' : ' The true ratio is known only because this world is simulated.') + '</p>');
      } else if (m === 'aci') {
        var am = active(), win = sum.n;
        html.push('<p><b>Fixes</b> the long-run miss rate, whatever changed. After each trip the true time is revealed: a miss lowers α<sub>t</sub> and widens the band, a hit raises it a little and narrows the band (Gibbs and Candès, 2021). It needs the true time after every trip, and it does not fix any single trip: it reacts only after misses.</p>');
        if (am === 'aci') {
          html.push('<p><b>Costs</b> width. Each new error is ranked against the fixed calibration errors, so when the world has moved far, misses push α<sub>t</sub> below zero again and again and the band becomes unbounded: ' +
            sum.unbounded + ' of the last ' + win + ' trips. That is how it keeps the long-run promise.</p>');
        } else {
          var rs = sim.summary('recal'), lows = transitionLows();
          html.push('<p><b>Here each error is ranked against the latest ' + sim.o.recalWindow + ' trips</b>, as in Gibbs and Candès’s own experiments. Most of the long-run repair then comes from that recent window, not from α<sub>t</sub>. ' +
            'Recalibration alone (γ = 0, the dotted line) covered ' + pct(rs.coverage) + ' of the last ' + win + ' trips with a median width of ' + fmtWidth(rs.medianWidth) +
            ', against ' + pct(sum.coverage) + ' and ' + fmtWidth(sum.medianWidth) + ' with α<sub>t</sub>.</p>');
          html.push('<p>α<sub>t</sub> earns its keep in the transition, before the window has filled with new trips' +
            (lows ? ': since the last change, the lowest coverage was ' + pct(lows.acir, 0) + ' with it and ' + pct(lows.recal, 0) + ' without.' : '.') + '</p>');
        }
        html.push('<p class="wa-dim">α<sub>t</sub> is now ' + sum.aciAlpha.toFixed(3) + '. Misses since it started: ' + pct(sum.aciMissRate) + ' of ' + sum.aciT +
          ' trips. The guarantee keeps this within ±' + pct(sum.aciBound) + ' of α, a bound that tightens as trips accumulate.</p>');
      } else {
        var t = sim.target, b = W.baseShift();
        var cov = t.medianKm > b.medianKm + 1e-9, other = t.extraNoisePerKm > 1e-9 || t.extraPerKm > 1e-9;
        var low = sum.range && sum.coverage < sum.range.lo;
        html.push('<p><b>Fixes</b> a band whose width ignores the noise. Two quantile lines, fitted on the training trips and then calibrated the same way, let the band widen where trips are less predictable (Romano, Patterson and Candès, 2019). ' +
          'Compare short and long trips in the readout; that balance holds on average over past data and varies from one draw to the next.</p>');
        if (other) {
          html.push('<p><b>Does not fix</b> this shift. The quantile lines learned how time spread around distance in the old data; when that rule changes, nothing tells them.</p>');
        } else if (cov && !low) {
          html.push('<p><b>Holds here, but not by any guarantee.</b> Its band roughly follows the noise at each distance, so moving to longer trips costs it little. Its promise is still only for trips exchangeable with the calibration trips: try the other two sliders.</p>');
        } else if (cov) {
          html.push('<p><b>Does not fix</b> shift. Its band follows the noise at each distance, which helps when trips get longer, but its promise is only for trips exchangeable with the calibration trips.</p>');
        } else {
          html.push('<p><b>Does not fix</b> shift. Its guarantee is still for trips exchangeable with the calibration trips, and still on average over trips, not for each distance.</p>');
        }
      }
      $('wa-method-copy').innerHTML = html.join('');
    }

    function fmtWidth(v) { return isFinite(v) ? v.toFixed(1) + ' min' : '–'; }
    // Lowest running coverage of ACI with recalibration and of recalibration alone since the last shift event.
    // Tracked trip by trip, because the simulator keeps only a limited history.
    function transitionLows() { return state.lows && state.lows.any ? state.lows : null; }
    function trackLows(rec) {
      var l = state.lows;
      if (!l) return;
      l.any = true;
      l.acir = Math.min(l.acir, rec.m.acir.cov); l.recal = Math.min(l.recal, rec.m.recal.cov);
    }

    var lastWords = 0;
    function refresh(force) {
      var now = performance.now();
      if (!force && now - lastWords < 200) { draw(); return; }
      lastWords = now;
      var m = active(), sum = sim.summary(m);
      $('wa-r-cov-label').textContent = 'Coverage, last ' + sum.n + ' trips';
      $('wa-r-cov').textContent = pct(sum.coverage);
      var flag = !sum.range ? '' : sum.coverage < sum.range.lo ? 'below' : sum.coverage > sum.range.hi ? 'above' : 'inside';
      var fl = $('wa-r-flag');
      fl.textContent = flag ? flag + ' the expected range' : '';
      fl.className = 'wa-flag' + (flag === 'below' ? ' is-low' : '');
      if (flag !== state.flag) {
        if (flag === 'below' && state.flag) say(unchanged() ? 'Coverage has dipped below the expected range by chance; nothing has changed.' : 'Coverage has fallen below the range expected if nothing had changed.');
        else if (flag === 'inside' && state.flag === 'below') say('Coverage is back inside the expected range.');
        state.flag = flag;
      }
      seal.show(flag, pct(1 - sim.alpha, 0));
      var chip = $('wa-chip');
      chip.textContent = 'Coverage ' + pct(sum.coverage) + (flag ? ' · ' + flag + ' the expected range' : '');
      chip.className = 'wa-chip' + (flag === 'below' ? ' is-low' : '');
      $('wa-r-range').textContent = sum.range ? pct(sum.range.lo, 1) + ' – ' + pct(sum.range.hi, 1) : '–';
      $('wa-r-split-label').textContent = 'Under · over ' + sum.cutKm.toFixed(1) + ' km';
      $('wa-r-split').textContent = pct(sum.shortCov, 0) + ' · ' + pct(sum.longCov, 0);
      $('wa-r-width').textContent = fmtWidth(sum.medianWidth) + (sum.unbounded ? ' · ' + sum.unbounded + ' unbounded' : '');
      $('wa-r-auc').textContent = sum.inputAuc == null ? '–' : sum.inputAuc.toFixed(2);
      promiseText();
      if (state.step === 1) copyStep1();
      if (state.step === 2) diagnosis();
      if (state.step === 3) methodCopy(sum);
      $('wa-ghost-label').textContent = 'band with no repair';
      $('wa-ghost-label').parentNode.hidden = m === 'split';
      gammaOut();
      $('wa-scatter').setAttribute('aria-label', 'Delivery time against distance. ' + NAMES[m] + ' band. Of the last ' + sum.n + ' trips, ' +
        pct(sum.coverage) + ' fell inside the band; the promise is ' + pct(sum.target, 0) + '. Under ' + sum.cutKm.toFixed(1) + ' km: ' + pct(sum.shortCov, 0) + ', over: ' + pct(sum.longCov, 0) + '.');
      $('wa-history').setAttribute('aria-label', 'Running coverage over the last ' + Math.min(SHOWN, sim.history.length) + ' trips against the target of ' + pct(sum.target, 0) +
        ', and the band width below it. Coverage is ' + (flag ? flag + ' the range expected if nothing had changed.' : 'not yet measured.'));
      draw();
    }

    function drawHistory() {
      var ctx = hc.ctx, w = hc.w, h = hc.h, small = w < 460;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = COL.plot; ctx.fillRect(0, 0, w, h);
      var hist = sim.history.slice(-SHOWN), m = active();
      if (!hist.length) return;
      var L = small ? 38 : 46, R = w - 12, split = Math.round(h * 0.6);
      var top = { L: L, R: R, T: 18, B: split - 8 }, bot = { L: L, R: R, T: split + 14, B: h - 10 };
      var first = sim.history[0].t, alpha = sim.alpha, target = 1 - alpha, cw = sim.o.covWindow;
      var dual = m === 'acir';
      var rows = hist.map(function (r) { return { t: r.t, cov: r.m[m].cov, cmp: r.m.split.cov, cmp2: r.m.recal.cov, n: Math.min(cw, r.t - first + 1) }; });
      // The first few trips after a restart swing wildly; leave them out when choosing the scale.
      // The scale never goes below Y_FLOOR, so the target and 100% labels stay apart; lower values sit on the floor.
      var lowest = rows.reduce(function (a, r) { return r.n * 4 < cw ? a : Math.min(a, r.cov, m !== 'split' ? r.cmp : 1, dual ? r.cmp2 : 1); }, 1);
      var yLo = lowest > 0.6 ? 0.6 : Y_FLOOR, clipped = lowest < yLo;
      ctx.font = font(11); ctx.fillStyle = COL.muted; ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
      var pyc = function (v) { return top.B - (v - yLo) / (1 - yLo) * (top.B - top.T); };
      [yLo, target, 1].forEach(function (v) {
        ctx.strokeStyle = COL.line; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(L, Math.round(pyc(v)) + 0.5); ctx.lineTo(R, Math.round(pyc(v)) + 0.5); ctx.stroke();
        // Skip the target's label when it would collide with the 100% or the floor label.
        if (v === target && (Math.abs(pyc(target) - pyc(1)) < 12 || Math.abs(pyc(target) - pyc(yLo)) < 12)) return;
        ctx.fillText((v === yLo && clipped ? '≤' : '') + pct(v, 0), L - 6, pyc(v));
      });
      var pxT = drawCoverage(ctx, top, rows, { yLo: yLo, target: target, alpha: alpha, nCal: sim.calScores.length, span: SHOWN, compare: m !== 'split', compare2: dual });
      ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = COL.muted;
      ctx.fillText('coverage, last ' + Math.min(cw, rows.length) + ' trips' + (small ? '' : '  ·  shaded: expected if nothing changed'), L + 4, 2);

      // width
      var wMax = 0;
      hist.forEach(function (r) { [r.m[m].width, r.m.split.width].forEach(function (v) { if (isFinite(v) && v > wMax) wMax = v; }); });
      wMax = Math.max(10, 10 * (Math.floor(wMax * 1.15 / 10) + 1));
      var pyw = function (v) { return bot.B - Math.min(v, wMax) / wMax * (bot.B - bot.T); };
      ctx.strokeStyle = COL.line; ctx.lineWidth = 1; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      [0, wMax].forEach(function (v) {
        ctx.beginPath(); ctx.moveTo(L, Math.round(pyw(v)) + 0.5); ctx.lineTo(R, Math.round(pyw(v)) + 0.5); ctx.stroke();
        ctx.textBaseline = v ? 'top' : 'bottom';
        ctx.fillText(String(v), L - 6, pyw(v));
      });
      function wline(key, colour, lw, dash) {
        ctx.strokeStyle = colour; ctx.lineWidth = lw; ctx.setLineDash(dash || []); ctx.beginPath();
        hist.forEach(function (r, j) {
          var v = r.m[key].width, y = pyw(isFinite(v) ? v : wMax), x = pxT(r.t);
          if (j && !isNaN(v)) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        });
        ctx.stroke(); ctx.setLineDash([]);
      }
      if (m !== 'split') wline('split', COL.ghost, 1.25, [5, 4]);
      if (dual) wline('recal', COL.ink, 1.5, [1.5, 3]);
      wline(m, COL.accent, 1.5);
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillStyle = COL.muted;
      var wl = 'band width, min';
      if (dual) wl += small ? ' · dashed: none · dotted: γ = 0' : '  ·  dashed: no repair  ·  dotted: recalibration only (γ = 0)';
      else if (m !== 'split') wl += '  ·  dashed: no repair';
      ctx.fillText(wl, L + 4, bot.T - 2);

      // events
      ctx.font = font(11); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      state.events.forEach(function (e) {
        if (e.t < rows[0].t) return;
        var x = Math.round(pxT(e.t)) + 0.5;
        ctx.strokeStyle = COL.lineStrong; ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(x, top.T); ctx.lineTo(x, bot.B); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = COL.muted; ctx.fillText(e.label, clamp(x, L + 30, R - 30), split - 6);
      });
    }

    function draw() {
      drawScatter(sc, sim, active());
      drawHistory();
    }

    // ---- loop
    var raf = null, last = null;
    function wanted() { return state.kit && state.running; }
    function schedule() { if (wanted() && !raf) { last = null; raf = requestAnimationFrame(frame); } }
    function frame(now) {
      raf = null;
      if (!wanted()) return;
      if (last === null) last = now;
      var dt = Math.min(0.1, (now - last) / 1000); last = now;
      state.acc += dt * SPEEDS[state.speed].perSecond;
      var n = Math.min(20, Math.floor(state.acc));
      state.acc -= n;
      for (var i = 0; i < n; i++) trackLows(sim.step());
      if (n) refresh(false);
      raf = requestAnimationFrame(frame);
    }
    Kit.onPlay(function (p) { state.kit = p; schedule(); });

    var ro = window.ResizeObserver ? new ResizeObserver(function () { sc.resize(); hc.resize(); draw(); }) : null;
    if (ro) { ro.observe($('wa-scatter')); ro.observe($('wa-history')); }
    else window.addEventListener('resize', function () { sc.resize(); hc.resize(); draw(); });

    // On narrow screens the panel stacks under both charts. Move the shift and repair controls
    // (with a coverage chip) to just under the scatter, so a slider and its effect share the screen.
    // Moving the node, rather than reordering with CSS, keeps the focus order the same as what is seen.
    var narrow = window.matchMedia ? window.matchMedia('(max-width: 880px)') : null;
    function place() {
      var ctl = $('wa-controls'), isNarrow = !!(narrow && narrow.matches);
      if (isNarrow && ctl.parentNode !== $('wa-slot')) $('wa-slot').appendChild(ctl);
      else if (!isNarrow && ctl.parentNode === $('wa-slot')) $('wa-diagnosis').parentNode.insertBefore(ctl, $('wa-diagnosis'));
    }
    if (narrow) { if (narrow.addEventListener) narrow.addEventListener('change', place); else if (narrow.addListener) narrow.addListener(place); }
    place();

    setStep(1);
    schedule();
    whenFonts(draw);
  }

  // ---------------------------------------------------------------- preview (the card on projects.html)
  // A loop of about ten seconds: the promise holds, the trips shift, misses appear and coverage dips,
  // then adaptive conformal inference takes over and coverage recovers.
  function preview() {
    var sf = surface($('wa-scatter')), seal = sealer();
    var RATE = 45, WIN = 60, A = 140, B2 = 290, END = 470;
    var p;
    function start() {
      var sim = new W.Simulator({ seed: D.seed, gamma: 0.05, ramp: 0.03 });
      p = { sim: sim, n: 0, method: 'split', hits: [], sum: 0, rows: [], acc: 0 };
      seal.reset();
      // Fill one coverage window before the loop starts, so the strip begins steady.
      for (var i = 0; i < WIN; i++) {
        var rec = sim.step();
        rec.shown = rec.m.split.hit;
        p.hits.push(rec.shown ? 1 : 0); p.sum += rec.shown ? 1 : 0;
      }
    }
    function stepOnce() {
      var sim = p.sim;
      if (p.n === A) { sim.setTarget('medianKm', S.medianKm.max); sim.setTarget('extraPerKm', S.extraPerKm.max / 2); }
      // From here the band shown is ACI on the recent window; both parts have run from the start of the stream.
      if (p.n === B2) { p.method = 'acir'; sim.resetAdaptive(); }
      var rec = sim.step();
      rec.shown = rec.m[p.method].hit;
      p.hits.push(rec.shown ? 1 : 0); p.sum += rec.shown ? 1 : 0;
      if (p.hits.length > WIN) p.sum -= p.hits.shift();
      p.rows.push({ t: p.n, cov: p.sum / p.hits.length, n: p.hits.length });
      // The seal follows every trip, so a crack mended before a still frame still shows its seam.
      p.low = p.sum / p.hits.length < W.coverageRange(p.hits.length, sim.calScores.length, sim.alpha).lo;
      seal.show(p.low ? 'below' : 'inside', pct(1 - sim.alpha, 0));
      p.n++;
      if (p.n >= END) start();
    }
    function caption() { return p.n < A ? 'the promise holds' : p.method === 'split' ? 'the trips shift' : 'recalibrate and adapt'; }
    function draw() {
      var w = sf.w, h = sf.h, ctx = sf.ctx, stripTop = Math.round(h * 0.7);
      drawScatter(sf, p.sim, p.method, { preview: true, bottom: stripTop - 6, ghost: false, hitOf: function (r) { return r.shown; } });
      var fs = Math.max(12, Math.min(16, Math.round(w / 24)));
      ctx.font = font(fs, 400, true); ctx.fillStyle = COL.strong; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(caption(), 10, 5);
      // coverage strip, ruled off twice
      ctx.fillStyle = COL.wash; ctx.fillRect(0, stripTop, w, h - stripTop);
      ctx.strokeStyle = COL.accent; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, stripTop + 0.5); ctx.lineTo(w, stripTop + 0.5); ctx.moveTo(0, stripTop + 3.5); ctx.lineTo(w, stripTop + 3.5); ctx.stroke();
      var box = { L: 10, R: w - 64, T: stripTop + 10, B: h - 8 };
      var rows = p.rows.slice(-END);
      drawCoverage(ctx, box, rows, { yLo: 0.5, target: 1 - p.sim.alpha, alpha: p.sim.alpha, nCal: p.sim.calScores.length, span: END, preview: true });
      var cur = rows.length ? rows[rows.length - 1].cov : NaN;
      var low = !!p.low;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = font(fs, 700); ctx.fillStyle = low ? COL.miss : COL.strong;
      ctx.fillText(pct(cur, 0), w - 56, (box.T + box.B) / 2 - fs * 0.55);
      ctx.font = font(12, 400, true); ctx.fillStyle = COL.muted;
      ctx.fillText('covered', w - 56, (box.T + box.B) / 2 + fs * 0.6);
    }

    start();
    // The still frame (paused, or reduced motion): just after the repair has taken over.
    while (p.n < B2 + 70) stepOnce();
    draw();

    var raf = null, last = null;
    function frame(now) {
      raf = null;
      if (last === null) last = now;
      var dt = Math.min(0.1, (now - last) / 1000); last = now;
      p.acc += dt * RATE;
      var n = Math.floor(p.acc); p.acc -= n;
      for (var i = 0; i < n; i++) stepOnce();
      draw();
      raf = requestAnimationFrame(frame);
    }
    Kit.onPlay(function (playing) {
      if (playing && !raf) { last = null; raf = requestAnimationFrame(frame); }
      else if (!playing && raf) { cancelAnimationFrame(raf); raf = null; draw(); }
    });
    var ro = window.ResizeObserver ? new ResizeObserver(function () { sf.resize(); draw(); }) : null;
    if (ro) ro.observe($('wa-scatter')); else window.addEventListener('resize', function () { sf.resize(); draw(); });
    whenFonts(draw);
  }

  if (Kit.preview) preview(); else fullPage();
})();
