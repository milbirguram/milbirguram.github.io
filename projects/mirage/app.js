// Mirage page: the walk, the garden, the thousand studies, and the card preview.
// All numbers come from model.js at run time.
(function () {
  'use strict';
  var M = window.Mirage, Kit = window.Kit;
  var C = {
    bg: '#faf9f6', wash: '#f3f3ed', ink: '#343630', strong: '#252821', muted: '#686d62',
    line: '#dedfd7', lineStrong: '#b5bdaf', accent: '#58705a', dot: '#4d5148', cell: '#e4e5dd'
  };
  var SHOWCASE_START = 20261101;
  var NF = M.FORKS.length;

  function $(id) { return document.getElementById(id); }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function ease(t) { t = clamp(t, 0, 1); return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function reduced() { return Kit.reducedMotion; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // p as text. Three decimals, but never let rounding blur which side of 0.05 it is on.
  function fmtP(p) {
    if (p < 0.001) return '< 0.001';
    var s = p.toFixed(3);
    if (p < M.ALPHA && s === '0.050') s = p.toFixed(4);
    return s;
  }
  function pText(p) { var s = fmtP(p); return s.charAt(0) === '<' ? 'p ' + s : 'p = ' + s; }
  function isSig(p) { return p < M.ALPHA; }

  // Size a canvas to its CSS box, devicePixelRatio capped at 2.
  function fit(canvas) {
    var r = canvas.getBoundingClientRect();
    var w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h };
  }

  function padChoices(ch) {
    var out = M.PREREG.slice();
    for (var i = 0; i < ch.length; i++) out[i] = ch[i];
    return out;
  }
  function pathWords(ch) { return ch.map(function (c, k) { return M.FORKS[k].options[c].short; }); }

  // ===========================================================================
  // Tree geometry, shared by the garden and the preview
  // ===========================================================================

  var Tree = (function () {
    var RADIX = M.RADIX, N = M.N_PATHS;
    var span = [];                     // leaves under one node at each depth
    span[NF] = 1;
    for (var d = NF - 1; d >= 0; d--) span[d] = span[d + 1] * RADIX[d];
    var RING = [0, 0.17, 0.32, 0.47, 0.62, 0.78, 1];
    // Leaf angles, with gaps between big branches so the structure reads.
    var slots = [], slot = 0;
    for (var i = 0; i < N; i++) {
      if (i % span[1] === 0) slot += 6; else if (i % span[2] === 0) slot += 3; else if (i % span[3] === 0) slot += 1;
      slots.push(slot); slot += 1;
    }
    var total = slot;
    var leafAngle = new Float64Array(N);
    for (i = 0; i < N; i++) leafAngle[i] = -Math.PI / 2 + 2 * Math.PI * (slots[i] - 2.5) / total;
    var nodeAngle = [];                // nodeAngle[d][j]
    for (d = 0; d <= NF; d++) {
      var count = N / span[d], arr = new Float64Array(count);
      for (var j = 0; j < count; j++) arr[j] = (leafAngle[j * span[d]] + leafAngle[(j + 1) * span[d] - 1]) / 2;
      nodeAngle.push(arr);
    }
    // Sector extents of the first fork (for the outer arcs and labels).
    var sectors = [];
    for (j = 0; j < RADIX[0]; j++) sectors.push([leafAngle[j * span[1]], leafAngle[(j + 1) * span[1] - 1]]);
    return { span: span, RING: RING, leafAngle: leafAngle, nodeAngle: nodeAngle, sectors: sectors, N: N };
  })();

  function sigCounts(p) {
    var out = [];
    for (var d = 0; d <= NF; d++) out.push(new Int32Array(Tree.N / Tree.span[d]));
    for (var i = 0; i < Tree.N; i++) if (isSig(p[i])) for (d = 0; d <= NF; d++) out[d][Math.floor(i / Tree.span[d])]++;
    return out;
  }

  // Cubic link from a parent node to a child node, optionally only its first fraction f.
  function linkTo(ctx, cx, cy, R, a0, r0, a1, r1, f, moveFirst) {
    var rm = (r0 + r1) / 2;
    var x0 = cx + Math.cos(a0) * r0 * R, y0 = cy + Math.sin(a0) * r0 * R;
    var x1 = cx + Math.cos(a0) * rm * R, y1 = cy + Math.sin(a0) * rm * R;
    var x2 = cx + Math.cos(a1) * rm * R, y2 = cy + Math.sin(a1) * rm * R;
    var x3 = cx + Math.cos(a1) * r1 * R, y3 = cy + Math.sin(a1) * r1 * R;
    if (moveFirst) ctx.moveTo(x0, y0);
    if (f >= 1) { ctx.bezierCurveTo(x1, y1, x2, y2, x3, y3); return; }
    // de Casteljau split at f
    var ax = x0 + (x1 - x0) * f, ay = y0 + (y1 - y0) * f;
    var bx = x1 + (x2 - x1) * f, by = y1 + (y2 - y1) * f;
    var cxx = x2 + (x3 - x2) * f, cyy = y2 + (y3 - y2) * f;
    var dx = ax + (bx - ax) * f, dy = ay + (by - ay) * f;
    var ex = bx + (cxx - bx) * f, ey = by + (cyy - by) * f;
    ctx.bezierCurveTo(ax, ay, dx, dy, dx + (ex - dx) * f, dy + (ey - dy) * f);
  }

  function tracePath(ctx, cx, cy, R, leaf, progress) {
    // progress runs 0..NF over the six links from root to leaf
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    for (var d = 1; d <= NF; d++) {
      var f = clamp(progress - (d - 1), 0, 1);
      if (f <= 0) break;
      var pj = Math.floor(leaf / Tree.span[d - 1]), cj = Math.floor(leaf / Tree.span[d]);
      linkTo(ctx, cx, cy, R, Tree.nodeAngle[d - 1][pj], Tree.RING[d - 1], Tree.nodeAngle[d][cj], Tree.RING[d], f, false);
    }
  }

  function diamond(ctx, x, y, r) {
    ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
  }

  // Draw the garden. o: { p, counts, you, pre, sel, grow (0..6), bloom, glow, trace, cx, cy, R, scale }
  function drawTree(ctx, o) {
    var cx = o.cx, cy = o.cy, R = o.R, s = o.scale;
    var grow = o.grow == null ? NF : o.grow;
    var d, j;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Branches, plain then significant-bearing, thinner towards the rim.
    for (var pass = 0; pass < 2; pass++) {
      for (d = 1; d <= NF; d++) {
        var f = clamp(grow - (d - 1), 0, 1);
        if (f <= 0) continue;
        var fe = ease(f);
        ctx.beginPath();
        var count = Tree.N / Tree.span[d], any = false;
        for (j = 0; j < count; j++) {
          var hasSig = o.glow > 0 && o.counts[d][j] > 0;
          if ((pass === 1) !== hasSig) continue;
          any = true;
          var pj = Math.floor(j / M.RADIX[d - 1]);
          linkTo(ctx, cx, cy, R, Tree.nodeAngle[d - 1][pj], Tree.RING[d - 1], Tree.nodeAngle[d][j], Tree.RING[d], fe, true);
        }
        if (!any) continue;
        var w = Math.max(0.6, (2.4 - d * 0.28) * s);
        if (pass === 0) { ctx.strokeStyle = 'rgba(104,109,98,0.30)'; ctx.lineWidth = w; }
        else { ctx.strokeStyle = 'rgba(88,112,90,' + (0.25 + 0.55 * o.glow) + ')'; ctx.lineWidth = w * (1 + 0.35 * o.glow); }
        ctx.stroke();
      }
    }
    // Arcs marking the three outcome sectors.
    if (o.arcs && grow >= NF) {
      ctx.strokeStyle = C.lineStrong; ctx.lineWidth = 1;
      Tree.sectors.forEach(function (sec) {
        ctx.beginPath(); ctx.arc(cx, cy, R + 9 * s, sec[0] - 0.01, sec[1] + 0.01); ctx.stroke();
      });
    }
    // Leaves.
    var bloom = o.bloom == null ? 1 : o.bloom;
    if (bloom > 0) {
      var shown = bloom * (Tree.N + 60);
      ctx.fillStyle = C.lineStrong;
      ctx.beginPath();
      for (var i = 0; i < Tree.N; i++) {
        var k = clamp((shown - i) / 60, 0, 1);
        if (k <= 0) break;
        if (o.glow > 0 && isSig(o.p[i])) continue;
        var a = Tree.leafAngle[i], r = 1.7 * s * ease(k);
        var x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
        ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 2 * Math.PI);
      }
      ctx.fill();
    }
    // The visitor's path, the pre-registered path, and a selected path.
    var trace = o.trace == null ? NF : o.trace;
    if (o.pre != null && trace > 0) {
      ctx.setLineDash([4 * s, 3.5 * s]);
      ctx.strokeStyle = C.muted; ctx.lineWidth = Math.max(1.2, 1.6 * s);
      tracePath(ctx, cx, cy, R, o.pre, trace); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (o.sel != null && o.sel !== o.you) {
      ctx.strokeStyle = 'rgba(77,81,72,0.85)'; ctx.lineWidth = Math.max(1.2, 1.7 * s);
      tracePath(ctx, cx, cy, R, o.sel, NF); ctx.stroke();
    }
    if (o.you != null && trace > 0) {
      ctx.strokeStyle = C.strong; ctx.lineWidth = Math.max(1.8, 2.8 * s);
      tracePath(ctx, cx, cy, R, o.you, trace); ctx.stroke();
    }
    // Significant leaves: accent diamonds with a soft halo.
    if (o.glow > 0 && bloom > 0) {
      var g = ease(o.glow), pulse = o.pulse || 0;
      ctx.fillStyle = 'rgba(88,112,90,' + (0.16 + 0.1 * pulse) * g + ')';
      ctx.beginPath();
      for (i = 0; i < Tree.N; i++) {
        if (!isSig(o.p[i])) continue;
        a = Tree.leafAngle[i]; x = cx + Math.cos(a) * R; y = cy + Math.sin(a) * R;
        var hr = (7 + 2 * pulse) * s * g;
        ctx.moveTo(x + hr, y); ctx.arc(x, y, hr, 0, 2 * Math.PI);
      }
      ctx.fill();
      // On small trees, keep the diamond big enough to read as a shape, and lift it just
      // past the rim so it separates from the grey leaves.
      var dR = Math.max(R < 200 ? 3.8 : 2.8, 4.6 * s), dOff = R < 200 ? 3 : 1.5 * s;
      ctx.fillStyle = C.accent; ctx.strokeStyle = C.bg; ctx.lineWidth = Math.max(0.75, 0.9 * s);
      ctx.beginPath();
      for (i = 0; i < Tree.N; i++) {
        if (!isSig(o.p[i])) continue;
        a = Tree.leafAngle[i]; x = cx + Math.cos(a) * (R + dOff); y = cy + Math.sin(a) * (R + dOff);
        diamond(ctx, x, y, dR * g);
      }
      ctx.fill();
      ctx.stroke();
    }
    // Rings around the ends of marked paths.
    function ringAt(leaf, color, width, rad, dash) {
      var aa = Tree.leafAngle[leaf];
      ctx.beginPath();
      ctx.arc(cx + Math.cos(aa) * R, cy + Math.sin(aa) * R, rad, 0, 2 * Math.PI);
      ctx.strokeStyle = color; ctx.lineWidth = width;
      if (dash) ctx.setLineDash(dash);
      ctx.stroke(); ctx.setLineDash([]);
    }
    if (trace >= NF) {
      if (o.pre != null) ringAt(o.pre, C.muted, Math.max(1, 1.3 * s), 6.5 * s, [2.5 * s, 2.5 * s]);
      if (o.you != null) ringAt(o.you, C.strong, Math.max(1.5, 2 * s), 7.5 * s);
    }
    if (o.sel != null) ringAt(o.sel, C.dot, Math.max(1.2, 1.5 * s), 9.5 * s);
    // Root.
    if (grow > 0) { ctx.fillStyle = C.strong; ctx.beginPath(); ctx.arc(cx, cy, 3.2 * s, 0, 2 * Math.PI); ctx.fill(); }
  }

  // ===========================================================================
  // Preview mode: the tree grows, leaves bloom, a few glow, one path traces. Loops.
  // ===========================================================================

  if (Kit.preview) { startPreview(); return; }

  function startPreview() {
    var canvas = $('preview');
    canvas.hidden = false;
    var show = M.findShowcase(SHOWCASE_START);
    var g = show.garden, counts = sigCounts(g.p);
    var you = M.pathIndex(show.walk);
    var youP = 'p = ' + fmtP(g.p[you]);
    var LOOP = 10500, raf = 0, t0 = 0, playing = false;

    function frame(t) {
      var fc = fit(canvas), ctx = fc.ctx, w = fc.w, h = fc.h;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h);
      var wide = w / h > 1.25;
      var R = wide ? Math.min(h * 0.42, w * 0.3) : Math.min(w, h) * 0.36;
      var cx = wide ? Math.max(R + 12, w * 0.33) : w / 2, cy = wide ? h / 2 : h * 0.44;
      var sec = t / 1000;
      var o = {
        p: g.p, counts: counts, you: you, pre: null, sel: null, cx: cx, cy: cy, R: R, scale: R / 150,
        grow: clamp(sec / 0.55, 0, NF),
        bloom: clamp((sec - 3.0) / 1.1, 0, 1),
        glow: clamp((sec - 4.2) / 0.7, 0, 1),
        trace: clamp((sec - 5.2) / 0.32, 0, NF),
        pulse: sec > 4.9 ? 0.5 + 0.5 * Math.sin((sec - 4.9) * 3.2) : 0
      };
      var fade = clamp((10.5 - sec) / 0.6, 0, 1);
      ctx.globalAlpha = fade;
      drawTree(ctx, o);
      // Words, never below 12px.
      var ta = clamp((sec - 4.6) / 0.6, 0, 1) * fade;
      if (ta > 0) {
        ctx.globalAlpha = ta;
        var big = Math.round(clamp(h * 0.105, 17, 34)), small = Math.round(clamp(h * 0.062, 12, 18));
        ctx.textBaseline = 'alphabetic';
        if (wide) {
          var tx = cx + R + Math.max(16, w * 0.045), avail = w - tx - 8;
          var lines = [['after six', C.ink], ['sensible choices,', C.ink], ['in pure noise', C.muted]];
          // Shrink to fit the space beside the tree, never below 12px.
          ctx.font = '600 ' + big + 'px ' + fontStack();
          while (big > 14 && ctx.measureText(youP).width > avail) { big--; ctx.font = '600 ' + big + 'px ' + fontStack(); }
          ctx.font = small + 'px ' + fontStack();
          while (small > 12 && ctx.measureText('sensible choices,').width > avail) { small--; ctx.font = small + 'px ' + fontStack(); }
          var lh = small * 1.35, ty = h / 2 - (big + lh * lines.length) / 2 + big * 0.85;
          ctx.textAlign = 'left';
          ctx.fillStyle = C.accent; ctx.font = '600 ' + big + 'px ' + fontStack();
          ctx.fillText(youP, tx, ty);
          ctx.font = small + 'px ' + fontStack();
          lines.forEach(function (ln, li) { ctx.fillStyle = ln[1]; ctx.fillText(ln[0], tx, ty + big * 0.35 + lh * (li + 1)); });
        } else {
          ctx.textAlign = 'center';
          ctx.fillStyle = C.accent; ctx.font = '600 ' + small + 'px ' + fontStack();
          ctx.fillText(youP + ' after six sensible choices, in pure noise', w / 2, h - small * 0.8);
        }
      }
      ctx.globalAlpha = 1;
    }
    function fontStack() { return '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif'; }
    function tick(ts) {
      if (!playing) return;
      if (!t0) t0 = ts;
      frame((ts - t0) % LOOP);
      raf = requestAnimationFrame(tick);
    }
    function still() { frame(8600); }
    Kit.onPlay(function (on) {
      playing = on;
      cancelAnimationFrame(raf);
      if (on) { t0 = 0; raf = requestAnimationFrame(tick); }
      else still();
    });
    window.addEventListener('resize', function () { if (!playing) still(); });
  }

  // ===========================================================================
  // The walk
  // ===========================================================================

  var state = {
    show: null, choices: [], peeked: [], peek: true, finished: false, skipped: false,
    dotX: null, dotAnim: 0
  };

  var el = {
    step: $('step-label'), peek: $('peek'), trail: $('trail'), fork: $('fork'), back: $('back'), skip: $('skip'),
    caption: $('data-caption'), dots: $('dots'), meter: $('meter'), meterLabel: $('meter-label'), meterMark: $('meter-mark'),
    meterHidden: $('meter-hidden'), garden: $('garden'), studies: $('studies')
  };

  function newShowcase(start) {
    state.show = M.findShowcase(start);
    state.show.counts = sigCounts(state.show.garden.p);
    state.show.jitter = new Float64Array(state.show.study.n);
    var jr = M.rng(M.hashSeed(state.show.seed, 7));
    for (var i = 0; i < state.show.study.n; i++) state.show.jitter[i] = jr() * 2 - 1;
    state.choices = []; state.peeked = []; state.finished = false; state.skipped = false; state.dotX = null;
  }

  function pAt(ch) { return state.show.garden.p[M.pathIndex(ch)]; }
  function signAt(ch) { return state.show.garden.sign[M.pathIndex(ch)]; }

  function renderWalk(focus) {
    var k = state.choices.length;
    state.finished = k >= NF;
    // Trail of choices, each a button back to that decision.
    el.trail.innerHTML = '';
    state.choices.forEach(function (c, i) {
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = '<span class="k">' + esc(M.FORKS[i].title) + ':</span> ' + esc(M.FORKS[i].options[c].short);
      b.setAttribute('aria-label', 'Change ' + M.FORKS[i].title.toLowerCase() + ', now ' + M.FORKS[i].options[c].short);
      b.addEventListener('click', function () { state.choices = state.choices.slice(0, i); renderWalk(true); });
      li.appendChild(b); el.trail.appendChild(li);
    });
    el.back.disabled = k === 0;
    var html;
    if (!state.finished) {
      var fork = M.FORKS[k];
      el.step.textContent = 'Decision ' + (k + 1) + ' of ' + NF + ' · ' + fork.title;
      html = '<h3 tabindex="-1">' + esc(fork.question) + '</h3><div class="options" role="group" aria-label="' + esc(fork.question) + '">';
      fork.options.forEach(function (opt, o) {
        var ch = padChoices(state.choices.concat([o]));
        var pv = pAt(ch);
        var pSpan = state.peek
          ? '<span class="opt-p' + (isSig(pv) ? ' is-sig' : '') + '">' + pText(pv) + '</span>'
          : '<span class="opt-p"></span>';
        html += '<button type="button" class="opt" data-o="' + o + '"' +
          (state.peek ? ' aria-label="' + esc(opt.label + '. ' + opt.why + ' Gives ' + pText(pv) + (isSig(pv) ? ', significant.' : '.')) + '"' : '') +
          '><span class="opt-label">' + esc(opt.label) + '</span>' + pSpan +
          '<span class="opt-why">' + esc(opt.why) + '</span></button>';
      });
      html += '</div>';
      el.fork.innerHTML = html;
      Array.prototype.forEach.call(el.fork.querySelectorAll('.opt'), function (b) {
        b.addEventListener('click', function () {
          state.peeked = state.peeked.slice(0, state.choices.length).concat([state.peek]);
          state.choices.push(+b.getAttribute('data-o'));
          renderWalk(true);
        });
      });
    } else {
      el.step.textContent = 'Your result';
      el.fork.innerHTML = resultHtml();
      $('reveal').addEventListener('click', function () { reveal(false); });
    }
    if (focus) {
      var h = el.fork.querySelector('h3');
      if (h) h.focus({ preventScroll: true });
    }
    renderData();
  }

  function resultHtml() {
    var ch = state.choices, p = pAt(ch), sg = signAt(ch), res = M.analysePath(state.show.study, ch);
    var sig = isSig(p);
    var dir = sg > 0 ? 'better' : 'worse';
    var out = '<h3 tabindex="-1">Your result</h3>';
    out += '<p class="result-p' + (sig ? ' is-sig' : '') + '">' + pText(p) + '</p>';
    if (sig) {
      out += '<p>The walkers reported ' + dir + ' mood than the others, and p is under 0.05. By the usual convention, that is a finding.</p>';
      out += '<p class="abstract"><b>Draft abstract.</b> ' + esc(abstractText(ch, p, sg, res.n)) + '</p>';
      out += '<p>Every step had a reason. Before writing it up, look at where else you could have gone.</p>';
    } else {
      out += '<p>The walkers reported slightly ' + dir + ' mood, but p is above 0.05. Nothing here would be written up as a finding.</p>';
      out += '<p>Now look at where else you could have gone.</p>';
    }
    out += '<p><button type="button" class="kit-button is-primary" id="reveal">See every path you could have taken</button></p>';
    return out;
  }

  function abstractText(ch, p, sg, n) {
    var who = ['', ' among adults under 40', ' among adults aged 40 and over'][ch[3]];
    var measure = ['a ten-item mood questionnaire', 'a single 0–10 mood rating', 'a two-week mood diary'][ch[0]];
    var bits = [];
    if (ch[1] === 1) bits.push('log-transformed');
    if (ch[2] === 1) bits.push('outliers removed');
    if (ch[2] === 2) bits.push('inattentive responders removed');
    if (ch[4] === 1) bits.push('adjusted for age');
    if (ch[4] === 2) bits.push('adjusted for sleep');
    var test = ['Welch t-test', 'Mann–Whitney U test', 'linear regression'][ch[5]];
    return 'In a randomised trial, a daily twenty-minute morning walk ' + (sg > 0 ? 'improved' : 'worsened') + ' mood' + who +
      ' (n = ' + n + '; ' + measure + (bits.length ? ', ' + bits.join(', ') : '') + '; ' + test + ', ' + pText(p) + ').';
  }

  // ---------- data panel ----------

  var SCALES = [
    { name: 'Questionnaire score', range: '10–50', lo: 10, hi: 50, ticks: [10, 20, 30, 40, 50] },
    { name: 'Single mood rating', range: '0–10', lo: 0, hi: 10, ticks: [0, 2, 4, 6, 8, 10] },
    { name: 'Two-week diary average', range: '1–7', lo: 1, hi: 7, ticks: [1, 2, 3, 4, 5, 6, 7] }
  ];

  function renderData() {
    var ch = padChoices(state.choices);
    var study = state.show.study;
    var y = M.outcomeValues(study, ch[0], ch[1]);
    var keep = M.includedMask(study, y, ch[2], ch[3]);
    var n1 = 0, n0 = 0, s1 = 0, s0 = 0;
    for (var i = 0; i < study.n; i++) if (keep[i]) { if (study.group[i]) { n1++; s1 += y[i]; } else { n0++; s0 += y[i]; } }
    var sc = SCALES[ch[0]];
    el.caption.innerHTML = '<b>' + sc.name + '</b> (' + sc.range + ')' + (ch[1] ? ', log scale' : '') +
      ' <span class="muted">· ' + (n1 + n0) + ' of ' + study.n + ' analysed</span>';
    // Meter: the p-value if you stopped here, later forks at their plain defaults.
    var p = pAt(ch);
    el.meter.hidden = !state.peek;
    el.meterHidden.hidden = state.peek;
    if (state.peek) {
      var k = state.choices.length;
      var lead = k === 0 ? 'The plain analysis' : k >= NF ? 'Your analysis' : 'If you stopped here';
      el.meterLabel.innerHTML = lead + ': <b class="' + (isSig(p) ? 'is-sig' : '') + '">' + pText(p) + '</b>' + (isSig(p) ? ' (significant)' : '');
      el.meterMark.style.left = (clamp(-Math.log(Math.max(p, 1e-3)) / Math.LN10 / 3, 0, 1) * 100) + '%';
      el.meterMark.classList.toggle('is-sig', isSig(p));
    }
    state.dotData = { y: y, keep: keep, sc: sc, log: ch[1] === 1, shift: ch[0] === 1 ? 1 : 0, m1: n1 ? s1 / n1 : NaN, m0: n0 ? s0 / n0 : NaN };
    var unit = function (v) { return ch[1] ? Math.exp(v) - (ch[0] === 1 ? 1 : 0) : v; };
    el.dots.setAttribute('aria-label', 'Dot plot of ' + sc.name.toLowerCase() + '. Walked: ' + n1 + ' people analysed, mean ' + unit(state.dotData.m1).toFixed(1) +
      '. Usual routine: ' + n0 + ' people analysed, mean ' + unit(state.dotData.m0).toFixed(1) + '. ' + (study.n - n1 - n0) + ' left out by your choices.');
    animateDots();
  }

  function dotTargets(w) {
    var dd = state.dotData, L = 64, Rm = 14, pw = w - L - Rm;
    var f = function (v) { return dd.log ? Math.log(v + dd.shift) : v; };
    var a = f(dd.sc.lo), b = f(dd.sc.hi);
    var X = new Float64Array(dd.y.length);
    for (var i = 0; i < dd.y.length; i++) X[i] = L + (dd.y[i] - a) / (b - a) * pw;
    return { X: X, map: function (v) { return L + (v - a) / (b - a) * pw; }, f: f, L: L, pw: pw };
  }

  var dotRaf = 0;
  function animateDots() {
    cancelAnimationFrame(dotRaf);
    var w = el.dots.getBoundingClientRect().width;
    var tg = dotTargets(w);
    var from = state.dotX && state.dotX.length === tg.X.length ? state.dotX : tg.X;
    var fromKeep = state.dotKeep || state.dotData.keep;
    var start = now(), dur = reduced() ? 0 : 420;
    function step() {
      var t = dur ? clamp((now() - start) / dur, 0, 1) : 1, e = ease(t);
      var X = new Float64Array(tg.X.length);
      for (var i = 0; i < X.length; i++) X[i] = from[i] + (tg.X[i] - from[i]) * e;
      drawDots(X, tg, fromKeep, e);
      state.dotX = X;
      if (t < 1) dotRaf = requestAnimationFrame(step);
      else state.dotKeep = state.dotData.keep;
    }
    step();
  }

  function drawDots(X, tg, fromKeep, e) {
    var fc = fit(el.dots), ctx = fc.ctx, w = fc.w, h = fc.h;
    var dd = state.dotData, study = state.show.study;
    ctx.clearRect(0, 0, w, h);
    var axisY = h - 24, rowH = (axisY - 8) / 2;
    var rows = [{ g: 1, label: 'Walked', y: 8 + rowH * 0.5 }, { g: 0, label: 'Usual', y: 8 + rowH * 1.5 }];
    // Row bands and labels.
    ctx.font = '13px ' + getComputedStyle(document.body).fontFamily;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    rows.forEach(function (r, i) {
      ctx.fillStyle = i === 0 ? C.wash : 'rgba(243,243,237,0.5)';
      ctx.fillRect(tg.L - 8, r.y - rowH / 2 + 2, tg.pw + 16, rowH - 4);
      ctx.fillStyle = C.ink;
      ctx.fillText(r.label, 0, r.y);
    });
    // Axis in the scale's own units, spaced on the analysed (raw or log) scale.
    ctx.strokeStyle = C.lineStrong; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(tg.L, axisY + 0.5); ctx.lineTo(tg.L + tg.pw, axisY + 0.5); ctx.stroke();
    ctx.fillStyle = C.muted; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.font = '12px ' + getComputedStyle(document.body).fontFamily;
    dd.sc.ticks.forEach(function (t) {
      var x = tg.map(tg.f(t));
      ctx.beginPath(); ctx.moveTo(x + 0.5, axisY); ctx.lineTo(x + 0.5, axisY + 4); ctx.stroke();
      ctx.fillText(String(t), x, axisY + 6);
    });
    // Dots.
    var rad = w < 420 ? 3 : 3.5;
    for (var i = 0; i < study.n; i++) {
      var row = rows[study.group[i] ? 0 : 1];
      var y = row.y + state.show.jitter[i] * (rowH / 2 - 8);
      var kNow = dd.keep[i], kWas = fromKeep[i];
      var a = kWas + (kNow - kWas) * e; // 1 = analysed, 0 = left out
      ctx.beginPath(); ctx.arc(X[i], y, rad, 0, 2 * Math.PI);
      if (a > 0.02) { ctx.fillStyle = 'rgba(77,81,72,' + (0.72 * a) + ')'; ctx.fill(); }
      if (a < 0.98) { ctx.strokeStyle = 'rgba(141,150,134,' + (1 - a) + ')'; ctx.lineWidth = 1.2; ctx.stroke(); }
    }
    // Group means of the analysed values.
    ctx.strokeStyle = C.accent; ctx.lineWidth = 2.5;
    [[dd.m1, rows[0]], [dd.m0, rows[1]]].forEach(function (m) {
      if (!isFinite(m[0])) return;
      var x = tg.map(m[0]);
      ctx.beginPath(); ctx.moveTo(x, m[1].y - rowH / 2 + 5); ctx.lineTo(x, m[1].y + rowH / 2 - 5); ctx.stroke();
    });
  }

  // ===========================================================================
  // The garden
  // ===========================================================================

  var garden = { anim: null, sel: null, you: null, pre: M.pathIndex(M.PREREG), layout: null, raf: 0 };
  var gc = $('garden-canvas');

  function reveal(skipped) {
    state.skipped = skipped;
    garden.you = skipped ? null : M.pathIndex(state.choices);
    garden.sel = null;
    el.garden.hidden = false;
    el.studies.hidden = false;
    fillGardenText();
    drawSpec();
    el.garden.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
    garden.anim = reduced() ? null : { start: now() + 250 };
    cancelAnimationFrame(garden.raf);
    garden.raf = requestAnimationFrame(gardenTick);
    sizeWaffles();
  }

  function gardenLayout() {
    var fc = fit(gc), size = Math.min(fc.w, fc.h);
    var R = size / 2 - Math.max(22, size * 0.07);
    return { ctx: fc.ctx, w: fc.w, h: fc.h, cx: fc.w / 2, cy: fc.h / 2, R: R, scale: clamp(R / 240, 0.62, 1.4) };
  }

  function gardenTick() {
    var lay = gardenLayout();
    garden.layout = lay;
    var t = garden.anim ? (now() - garden.anim.start) / 1000 : 99;
    var o = {
      p: state.show.garden.p, counts: state.show.counts, you: garden.you, pre: garden.pre, sel: garden.sel,
      cx: lay.cx, cy: lay.cy, R: lay.R, scale: lay.scale, arcs: true,
      grow: clamp(t / 0.42, 0, NF), bloom: clamp((t - 2.4) / 0.8, 0, 1), glow: clamp((t - 3.2) / 0.5, 0, 1),
      trace: clamp((t - 3.7) / 0.25, 0, NF)
    };
    lay.ctx.clearRect(0, 0, lay.w, lay.h);
    drawTree(lay.ctx, o);
    if (o.grow >= NF) drawSectorLabels(lay);
    if (garden.anim && t < 5.4) garden.raf = requestAnimationFrame(gardenTick);
    else garden.anim = null;
  }
  function redrawGarden() { if (!garden.anim && !el.garden.hidden) gardenTick(); }

  // Each outcome label sits in the corner or edge its arc faces, joined to the middle of
  // the arc by a short leader, so it is clear which third of the tree is which.
  function drawSectorLabels(lay) {
    var ctx = lay.ctx, names = ['Questionnaire', 'Rating', 'Diary'];
    var pad = 2, fs = 13, arcR = lay.R + 9 * lay.scale;
    ctx.font = fs + 'px ' + getComputedStyle(document.body).fontFamily;
    ctx.textBaseline = 'middle';
    Tree.sectors.forEach(function (sec, k) {
      var m = (sec[0] + sec[1]) / 2, cm = Math.cos(m), sm = Math.sin(m);
      var ax = lay.cx + cm * (arcR + 2), ay = lay.cy + sm * (arcR + 2);
      var tw = ctx.measureText(names[k]).width;
      var lx = cm > 0.35 ? lay.w - pad - tw : cm < -0.35 ? pad : lay.cx - tw / 2;     // label box left
      var ly = sm > 0 ? lay.h - pad - fs / 2 - 1 : pad + fs / 2 + 1;                   // label middle
      if (Math.abs(cm) <= 0.35) ly = sm > 0 ? Math.min(lay.h - pad - fs / 2 - 1, ay + 4 + fs / 2) : Math.max(pad + fs / 2 + 1, ay - 4 - fs / 2);
      // Leader from the arc to the nearest point of the label box.
      var bx = clamp(ax, lx, lx + tw), by = ly + (ay > ly ? fs / 2 + 1 : -fs / 2 - 1);
      if (Math.abs(bx - ax) + Math.abs(by - ay) > 10) {
        ctx.strokeStyle = C.lineStrong; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      }
      ctx.textAlign = 'left'; ctx.fillStyle = C.muted;
      ctx.fillText(names[k], lx, ly);
    });
  }

  function leafAt(x, y) {
    var lay = garden.layout;
    if (!lay) return null;
    var dx = x - lay.cx, dy = y - lay.cy, r = Math.sqrt(dx * dx + dy * dy);
    if (r < lay.R * 0.72 || r > lay.R + 26) return null;
    var a = Math.atan2(dy, dx), best = null, bd = Infinity;
    for (var i = 0; i < Tree.N; i++) {
      var d = Math.abs(Math.atan2(Math.sin(a - Tree.leafAngle[i]), Math.cos(a - Tree.leafAngle[i])));
      if (d < bd) { bd = d; best = i; }
    }
    return bd * lay.R < 14 ? best : null;
  }

  function select(i) {
    if (garden.sel === i) return;
    garden.sel = i;
    renderInspect();
    redrawGarden();
  }

  function renderInspect() {
    var box = $('inspect'), i = garden.sel;
    if (i == null) i = garden.you;
    if (i == null) { box.innerHTML = '<p style="margin:0">Point at a dot on the rim to see its path.</p>'; return; }
    var ch = M.pathChoices(i), p = state.show.garden.p[i], sg = state.show.garden.sign[i];
    var tag = i === garden.you ? 'Your path' : i === garden.pre ? 'The pre-registered path' : 'Path ' + (i + 1) + ' of ' + M.N_PATHS;
    if (i === garden.you && i === garden.pre) tag = 'Your path, which is also the pre-registered one';
    box.innerHTML = '<b>' + esc(tag) + '</b> · <span class="ip' + (isSig(p) ? ' is-sig' : '') + '">' + (isSig(p) ? '◆ ' : '') + pText(p) + '</span>' +
      ' · walkers ' + (sg > 0 ? 'higher' : 'lower') + '<br>' + esc(pathWords(ch).join(' → '));
  }

  gc.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch') return;
    var r = gc.getBoundingClientRect();
    select(leafAt(e.clientX - r.left, e.clientY - r.top));
  });
  gc.addEventListener('pointerdown', function (e) {
    var r = gc.getBoundingClientRect();
    select(leafAt(e.clientX - r.left, e.clientY - r.top));
  });
  gc.addEventListener('pointerleave', function (e) { if (e.pointerType !== 'touch') select(null); });
  gc.addEventListener('keydown', function (e) {
    var cur = garden.sel != null ? garden.sel : (garden.you != null ? garden.you : 0);
    var dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (dir) {
      e.preventDefault();
      var next = cur;
      if (e.shiftKey) {
        for (var s = 1; s <= Tree.N; s++) {
          var j = ((cur + dir * s) % Tree.N + Tree.N) % Tree.N;
          if (isSig(state.show.garden.p[j])) { next = j; break; }
        }
      } else next = ((cur + dir) % Tree.N + Tree.N) % Tree.N;
      select(next);
    } else if (e.key === 'Home') { e.preventDefault(); select(garden.you != null ? garden.you : garden.pre); }
    else if (e.key === 'Escape') select(null);
  });

  function fillGardenText() {
    var g = state.show.garden, N = M.N_PATHS;
    $('garden-headline').innerHTML = '<strong>' + g.nSig + ' of ' + N + '</strong> paths reach p &lt; 0.05.';
    var youP = garden.you != null ? g.p[garden.you] : null;
    var lead;
    if (youP == null) lead = 'You skipped the walk; the thick line is missing.';
    else if (isSig(youP)) {
      lead = 'Your path, at ' + pText(youP) + ', is one of them.';
      var guided = state.peeked.length >= NF && state.peeked.slice(0, NF).every(Boolean);
      if (guided) lead += ' At each fork the p-values on screen pointed the way.';
    }
    else lead = 'Your path, at ' + pText(youP) + ', is not one of them. These are.';
    $('garden-noise').innerHTML = esc(lead) + ' <b>The data were pure noise.</b> Every number was random, and the group labels were dealt afterwards by a separate shuffle.';
    $('garden-hint').hidden = false;
    var keyYou = document.querySelector('.key-you');
    if (keyYou) keyYou.parentNode.hidden = garden.you == null;
    gc.setAttribute('aria-label', 'A radial tree of all ' + N + ' analysis paths. ' + g.nSig + ' end in p below 0.05, drawn as larger diamonds. ' +
      (youP != null ? 'Your path is traced in a thick dark line and ends at ' + pText(youP) + '. ' : '') +
      'The pre-registered path is dashed and ends at ' + pText(g.p[garden.pre]) + '.');
    renderInspect();
    // List of significant paths.
    var list = $('sig-list'), items = [];
    for (var i = 0; i < N; i++) if (isSig(g.p[i])) items.push(i);
    items.sort(function (a, b) { return g.p[a] - g.p[b]; });
    $('sig-summary').textContent = 'List the ' + items.length + ' significant paths';
    list.innerHTML = items.map(function (i) {
      return '<li><span class="mono">' + esc(pText(g.p[i])) + '</span> ' + esc(pathWords(M.pathChoices(i)).join(', ')) +
        ' <span class="muted">(walkers ' + (g.sign[i] > 0 ? 'higher' : 'lower') + ')</span>' + (i === garden.you ? ' — <b>yours</b>' : '') + '</li>';
    }).join('');
    // The file drawer.
    var t = state.show.tries;
    $('drawer').innerHTML = '<b>One more fork was mine.</b> The page drew noise studies until one let a p-guided walk succeed, but only after four or more decisions. ' +
      (t === 1 ? 'This was the first draw.' : 'This was draw ' + t + '; ' + (t - 1) + ' ' + (t - 1 === 1 ? 'was' : 'were') + ' set aside.') +
      ' Published studies pass a similar filter.';
  }

  // ---------- specification curve ----------

  function drawSpec() {
    if (el.garden.hidden) return;
    var canvas = $('spec-canvas'), fc = fit(canvas), ctx = fc.ctx, w = fc.w, h = fc.h;
    var g = state.show.garden, N = M.N_PATHS;
    var z = new Float64Array(N), order = [];
    for (var i = 0; i < N; i++) { z[i] = M.signedZ(g.p[i], g.sign[i]); order.push(i); }
    order.sort(function (a, b) { return z[a] - z[b]; });
    var zmax = 3;
    for (i = 0; i < N; i++) zmax = Math.max(zmax, Math.abs(z[i]) + 0.3);
    var L = 34, Rm = 10, T = 22, B = 14, pw = w - L - Rm, ph = h - T - B;
    var Y = function (v) { return T + (zmax - v) / (2 * zmax) * ph; };
    var Xi = function (r) { return L + (r + 0.5) / N * pw; };
    ctx.clearRect(0, 0, w, h);
    var font = getComputedStyle(document.body).fontFamily;
    // Significance bands.
    var crit = M.normInv(0.975);
    ctx.fillStyle = 'rgba(88,112,90,0.08)';
    ctx.fillRect(L, Y(zmax), pw, Y(crit) - Y(zmax));
    ctx.fillRect(L, Y(-crit), pw, Y(-zmax) - Y(-crit));
    ctx.strokeStyle = C.accent; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    [crit, -crit].forEach(function (c) { ctx.beginPath(); ctx.moveTo(L, Math.round(Y(c)) + 0.5); ctx.lineTo(L + pw, Math.round(Y(c)) + 0.5); ctx.stroke(); });
    ctx.setLineDash([]);
    ctx.strokeStyle = C.lineStrong;
    ctx.beginPath(); ctx.moveTo(L, Math.round(Y(0)) + 0.5); ctx.lineTo(L + pw, Math.round(Y(0)) + 0.5); ctx.stroke();
    // Axis labels.
    ctx.font = '12px ' + font; ctx.fillStyle = C.muted; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    [-2, 0, 2].forEach(function (v) { ctx.fillText((v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v), L - 6, Y(v)); });
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText('z · walkers happier ↑', L, T - 6);
    ctx.textBaseline = 'top';
    ctx.fillStyle = C.accent; ctx.textAlign = 'left';
    ctx.fillText('p < 0.05', L + 6, Y(crit) + 4);
    // Points.
    var r = w < 500 ? 1.5 : 1.9;
    ctx.fillStyle = '#a3ab9c'; ctx.beginPath();
    order.forEach(function (idx, rank) { if (!isSig(g.p[idx])) { var x = Xi(rank), y = Y(z[idx]); ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 2 * Math.PI); } });
    ctx.fill();
    ctx.fillStyle = C.accent; ctx.beginPath();
    order.forEach(function (idx, rank) { if (isSig(g.p[idx])) diamond(ctx, Xi(rank), Y(z[idx]), 3.6); });
    ctx.fill();
    // Mark your path and the pre-registered one.
    // The curve rises left to right, so the space above-left of any point on it, and the
    // space below-right, is empty. Labels go there, never across the curve.
    var placed = [];
    function mark(idx, label, dash, color) {
      var rank = order.indexOf(idx), x = Xi(rank), y = Y(z[idx]);
      ctx.strokeStyle = color; ctx.lineWidth = 1.6; if (dash) ctx.setLineDash([2.5, 2.5]);
      ctx.beginPath(); ctx.arc(x, y, 6.5, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = '12px ' + font; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      var tw = ctx.measureText(label).width;
      function box(left) {
        var bx = left ? x - 9 - tw : x + 9, by = clamp(left ? y - 13 : y + 13, T + 8, T + ph - 8);
        return { x: clamp(bx, L, L + pw - tw), y: by };
      }
      function hits(bb) { return placed.some(function (q) { return Math.abs(q.x - bb.x) < tw + 4 && Math.abs(q.y - bb.y) < 15; }); }
      var bb = box(x - 9 - tw >= L);
      if (hits(bb)) bb = box(!(x - 9 - tw >= L));
      placed.push(bb);
      // A halo in the page colour keeps the label clear of the grid lines.
      ctx.strokeStyle = C.bg; ctx.lineWidth = 5; ctx.lineJoin = 'round';
      ctx.strokeText(label, bb.x, bb.y);
      ctx.fillStyle = color; ctx.fillText(label, bb.x, bb.y);
    }
    if (garden.you != null) mark(garden.you, 'your path', false, C.strong);
    if (garden.pre !== garden.you) mark(garden.pre, 'pre-registered', true, C.muted);
    var up = 0, down = 0;
    for (i = 0; i < N; i++) if (isSig(g.p[i])) { if (g.sign[i] > 0) up++; else down++; }
    var cap = 'A specification curve: every path, sorted by its signed z-score. ' +
      up + ' significant paths say walking lifts mood' + (down ? ' and ' + down + ' say it lowers it' : '') + ', from the same data.';
    $('spec-caption').textContent = cap;
    canvas.setAttribute('aria-label', 'Specification curve of all ' + N + ' paths sorted by signed z. ' + up + ' are significant in the positive direction and ' + down + ' in the negative.');
  }

  // ===========================================================================
  // A thousand studies
  // ===========================================================================

  var RUN_N = 1000, COLS = 40, ROWS = 25;
  var runs = { done: 0, any: new Uint8Array(RUN_N), peek: new Uint8Array(RUN_N), pre: new Uint8Array(RUN_N), raf: 0, active: false, painted: 0, seed: 0 };
  var waffles = [
    { canvas: $('w-any'), key: 'any', count: $('t-any') },
    { canvas: $('w-peek'), key: 'peek', count: $('t-peek') },
    { canvas: $('w-pre'), key: 'pre', count: $('t-pre') }
  ];

  function cellGeom(wf) {
    var cell = wf.w / COLS;
    return { cell: cell, size: Math.max(1, cell - (cell > 6 ? 1.5 : 1)) };
  }
  function paintCell(wf, i, state) {
    var g = cellGeom(wf), x = (i % COLS) * g.cell, y = Math.floor(i / COLS) * g.cell;
    wf.ctx.fillStyle = state === 2 ? C.accent : state === 1 ? C.cell : C.wash;
    wf.ctx.clearRect(x, y, g.cell, g.cell);
    wf.ctx.fillRect(x, y, g.size, g.size);
  }
  function sizeWaffles() {
    waffles.forEach(function (wf) {
      var fc = fit(wf.canvas);
      wf.ctx = fc.ctx; wf.w = fc.w; wf.h = fc.h;
      wf.ctx.clearRect(0, 0, wf.w, wf.h);
      for (var i = 0; i < RUN_N; i++) paintCell(wf, i, i < runs.done ? (runs[wf.key][i] ? 2 : 1) : 0);
    });
    runs.painted = runs.done;
    updateTallies();
  }
  function updateTallies() {
    waffles.forEach(function (wf) {
      if (!runs.done) { wf.count.innerHTML = '<b>–</b>'; return; }
      var c = 0; for (var i = 0; i < runs.done; i++) c += runs[wf.key][i];
      wf.count.innerHTML = '<b>' + (c / runs.done * 100).toFixed(1) + '%</b> · ' + c.toLocaleString('en-CA') + ' of ' + runs.done.toLocaleString('en-CA');
      wf.canvas.setAttribute('aria-label', 'Grid of ' + RUN_N + ' studies. ' + c + ' of ' + runs.done + ' found p below 0.05.');
    });
  }

  function startRun() {
    clearTimeout(runs.raf);
    runs.done = 0; runs.painted = 0; runs.active = true;
    runs.seed = (Math.random() * 4294967296) >>> 0;   // fresh noise every run
    $('run').disabled = true;
    $('studies-explain').hidden = true;
    sizeWaffles();
    runs.raf = setTimeout(runChunk, 30);
  }

  // Work is chunked on timers (about 14 ms of simulation per chunk) so the page stays
  // responsive; each chunk paints its own cells, which animates the tally.
  function runChunk() {
    var t0 = now(), n = 0;
    while (runs.done < RUN_N && now() - t0 < 14) {
      var r = M.runStudy(M.studySeed(runs.seed, runs.done));
      runs.any[runs.done] = r.any ? 1 : 0;
      runs.peek[runs.done] = r.peeker ? 1 : 0;
      runs.pre[runs.done] = r.prereg ? 1 : 0;
      runs.done++; n++;
    }
    for (var i = runs.painted; i < runs.done; i++) waffles.forEach(function (wf) { paintCell(wf, i, runs[wf.key][i] ? 2 : 1); });
    runs.painted = runs.done;
    updateTallies();
    $('run-status').textContent = runs.done < RUN_N ? runs.done.toLocaleString('en-CA') + ' / ' + RUN_N.toLocaleString('en-CA') : '';
    if (runs.done < RUN_N) runs.raf = setTimeout(runChunk, 0);
    else finishRun();
  }

  function finishRun() {
    runs.active = false;
    var b = $('run'); b.disabled = false; b.textContent = 'Run 1,000 more';
    var c = function (k) { var s = 0; for (var i = 0; i < RUN_N; i++) s += runs[k][i]; return s; };
    var any = c('any'), pk = c('peek'), pre = c('pre');
    $('explain-numbers').innerHTML = 'Of 1,000 studies with no effect, <b>' + any + '</b> had some path reach p &lt; 0.05 and the peeking analyst got there in <b>' + pk +
      '</b>. The pre-registered path did so in <b>' + pre + '</b>, close to the 50 that 5% promises.';
    $('studies-explain').hidden = false;
  }

  // ===========================================================================
  // Wiring
  // ===========================================================================

  el.peek.addEventListener('change', function () { state.peek = el.peek.checked; renderWalk(false); });
  el.back.addEventListener('click', function () { state.choices.pop(); renderWalk(true); });
  el.skip.addEventListener('click', function () { reveal(true); });
  $('again').addEventListener('click', function () {
    newShowcase(state.show.seed + 1);
    el.garden.hidden = true;
    renderWalk(false);
    document.querySelector('.mirage-stage').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
    var h = el.fork.querySelector('h3'); if (h) h.focus({ preventScroll: true });
  });
  $('run').addEventListener('click', startRun);

  var resizeTimer = 0;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (state.dotData) { cancelAnimationFrame(dotRaf); var tg = dotTargets(el.dots.getBoundingClientRect().width); state.dotX = tg.X; drawDots(tg.X, tg, state.dotData.keep, 1); state.dotKeep = state.dotData.keep; }
      if (!el.garden.hidden) { redrawGarden(); drawSpec(); }
      if (!el.studies.hidden) sizeWaffles();
    }, 60);
  }
  window.addEventListener('resize', onResize);

  newShowcase(SHOWCASE_START);
  el.peek.checked = state.peek;
  renderWalk(false);
})();
