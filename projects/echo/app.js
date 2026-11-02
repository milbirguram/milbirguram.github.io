// Echo: the page. Loads a revision, lists its sentences, runs the model's analysis with a
// streamed log, and draws the timeline. In preview mode it only replays recorded data.
(function () {
  'use strict';
  var M = window.EchoModel, C = window.EchoCases, R = window.EchoRecorded || {};
  var stage = document.querySelector('[data-kit-stage]');
  var PREVIEW_CASE = 'vulfpeck';

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var MON = MONTHS.map(function (m) { return m.slice(0, 3); });

  // ------------------------------------------------------------------ timeline drawing
  var INK = '#252821', TEXT = '#343630', MUTED = '#686d62', LINE = '#dedfd7', BG = '#faf9f6';
  var WIKI = '#4d6a50', SOURCE = '#9a4b2f', LOOP = '#252821';
  var VERDICT_COLOUR = { echo: '#9a4b2f', first: '#4d6a50', later: '#7d5d10', unknown: '#686d62' };

  function isoLabel(ts) { var d = new Date(ts); return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); }
  function monthYear(day) { var d = new Date(day * 86400000); return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); }
  function shortDay(day) { var d = new Date(day * 86400000); return d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); }
  // Canvas labels use one style: "6 Jun 2013", "Jun 2013", or the date's own label when coarser.
  function shortDate(date) {
    if (date.precision === 'day') return shortDay(date.lo);
    if (date.precision === 'month') { var d = new Date(date.lo * 86400000); return MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); }
    return date.label;
  }
  function clamp(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function ease(x) { x = clamp(x); return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; }

  // Normalise a recorded case or a live result into what the timeline needs.
  function timelineData(o) {
    var claimDay = M.isoToDay(o.claimTs);
    var src = o.sources.filter(function (s) { return s.date; })[0] || null;
    return {
      claim: { day: claimDay, label: shortDay(claimDay), messy: !!o.messy },
      cite: o.citeTs ? { day: M.isoToDay(o.citeTs), label: shortDay(M.isoToDay(o.citeTs)), same: !!o.citeSame } : null,
      source: src ? { lo: src.date.lo, hi: src.date.hi, label: shortDate(src.date), name: src.name || 'The source', precise: src.date.precision === 'day' } : null,
      code: o.code, verdict: o.verdict, title: o.title || ''
    };
  }
  function fromRecorded(r) {
    return timelineData({
      claimTs: r.claimFirstSeen.timestamp, messy: r.claimFirstSeen.messy,
      citeTs: r.citationAttached && r.citationAttached.timestamp, citeSame: r.citationAttached && r.citationAttached.sameRevision,
      sources: r.sources.map(function (s) { return { date: s.date ? M.parseDate(s.date) : null, name: s.work || shortTitle(s.title) }; }),
      code: r.code, verdict: r.verdict, title: r.title
    });
  }
  function fromResult(res) {
    var srcs = res.sources.map(function (s) {
      var c = s.ref.citation;
      return { date: s.source, name: c.work || shortTitle(c.title) || (c.author ? c.author : null) };
    });
    // Prefer the source that drove the verdict.
    var rel = res.verdict.relations, order = [];
    ['after', 'before', 'overlap'].forEach(function (want) { rel.forEach(function (r, i) { if (r === want && srcs[i].date) order.push(srcs[i]); }); });
    return timelineData({
      claimTs: res.first.timestamp, messy: res.first.messy,
      citeTs: res.citation && res.citation.timestamp, citeSame: res.citation && res.citation.sameRevision,
      sources: order.length ? order : srcs, code: res.verdict.code, verdict: res.verdict.label, title: res.title
    });
  }
  function shortTitle(t) {
    if (!t) return null;
    t = String(t);
    return t.length > 28 ? t.slice(0, 26).replace(/\s+\S*$/, '') + '…' : t;
  }

  function niceTicks(lo, hi, maxTicks) {
    var spanYears = (hi - lo) / 365.25;
    var out = [];
    if (spanYears > 2.5) {
      var steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500];
      var y0 = new Date(lo * 86400000).getUTCFullYear(), y1 = new Date(hi * 86400000).getUTCFullYear();
      var step = steps.filter(function (s) { return (y1 - y0) / s <= maxTicks; })[0] || 1000;
      for (var y = Math.ceil(y0 / step) * step; y <= y1; y += step) { var d = M.dayNum(y, 1, 1); if (d >= lo && d <= hi) out.push({ day: d, label: String(y) }); }
    } else {
      var msteps = [1, 2, 3, 6, 12];
      var a = new Date(lo * 86400000), months = spanYears * 12;
      var ms = msteps.filter(function (s) { return months / s <= maxTicks; })[0] || 12;
      var y2 = a.getUTCFullYear(), m2 = a.getUTCMonth() + 1;
      for (var k = 0; k < 400; k++) {
        var day = M.dayNum(y2, m2, 1);
        if (day > hi) break;
        if (day >= lo && (m2 - 1) % ms === 0) out.push({ day: day, label: m2 === 1 ? String(y2) : MON[m2 - 1] });
        m2++; if (m2 > 12) { m2 = 1; y2++; }
      }
    }
    return out;
  }

  // Build the animation script: a cursor sweeps through time, markers appear as it passes,
  // arrows draw, and in an echo the arrows close into a loop.
  function schedule(d) {
    var ev = [{ id: 'claim', day: d.claim.day }];
    if (d.source) ev.push({ id: 'source', day: d.source.lo });
    if (d.cite && !d.cite.same) ev.push({ id: 'cite', day: d.cite.day });
    ev.sort(function (a, b) { return a.day - b.day || (a.id === 'claim' ? -1 : 1); });
    var steps = [{ id: 'lanes', w: 0.7 }];
    var prev = null;
    ev.forEach(function (e) {
      if (prev != null) steps.push({ id: 'sweep', from: prev, to: e.day, w: 1.4 });
      steps.push({ id: e.id, w: 0.7 });
      if (e.id === 'source' && d.code === 'echo') steps.push({ id: 'copy', w: 0.9 });
      if (e.id === 'cite' && d.source) steps.push({ id: 'citeArrow', w: 0.9 });
      if (e.id === 'claim' && d.source && d.source.lo < d.claim.day && !(d.cite && !d.cite.same)) steps.push({ id: 'citeArrow', w: 0.9 });
      prev = e.day;
    });
    if (d.cite && d.cite.same && d.source && d.source.lo >= d.claim.day) steps.push({ id: 'citeArrow', w: 0.9 });
    if (d.code === 'echo') steps.push({ id: 'loop', w: 1.2 });
    steps.push({ id: 'verdict', w: 0.8 });
    var total = steps.reduce(function (s, x) { return s + x.w; }, 0), t = 0, SPAN = 0.84;
    steps.forEach(function (s) { s.a = t / total * SPAN; t += s.w; s.b = t / total * SPAN; });
    return steps;
  }

  function drawTimeline(canvas, d, t, opts) {
    opts = opts || {};
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) return;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    var compact = W < 560;
    var steps = d._steps || (d._steps = schedule(d));
    var P = {};
    steps.forEach(function (s) { P[s.id] = Math.max(P[s.id] || 0, ease((t - s.a) / Math.max(1e-6, s.b - s.a))); });
    var fade = t > 0.94 ? 1 - clamp((t - 0.94) / 0.06) : 1;
    ctx.globalAlpha = fade;

    var fs = compact ? 12 : 13, font = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
    var top = opts.title ? (compact ? 34 : 40) : 14;
    var padX = compact ? 16 : 28;
    var axisY = H - (compact ? 20 : 26);
    var wikiY = top + (axisY - top) * 0.36, srcY = top + (axisY - top) * 0.78;

    // Day scale with padding.
    var days = [d.claim.day];
    if (d.source) { days.push(d.source.lo); days.push(d.source.hi); }
    if (d.cite) days.push(d.cite.day);
    var lo = Math.min.apply(null, days), hi = Math.max.apply(null, days);
    var span = Math.max(hi - lo, 60);
    lo -= span * 0.12; hi += span * 0.12;
    var x0 = padX + (compact ? 0 : 74), x1 = W - padX;
    function X(day) { return x0 + (day - lo) / (hi - lo) * (x1 - x0); }

    // On a small card the verdict takes the title's place when it arrives.
    var titleAlpha = compact ? 1 - (P.verdict || 0) : 1;
    if (opts.title && titleAlpha > 0) {
      ctx.globalAlpha = fade * titleAlpha;
      ctx.fillStyle = INK;
      ctx.font = '500 ' + (compact ? 13 : 15) + 'px ' + font;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.fillText(fitText(ctx, opts.title, W - padX * 2), padX, compact ? 12 : 14);
      ctx.globalAlpha = fade;
    }

    // Lanes and axis.
    var lanes = P.lanes || 0;
    ctx.globalAlpha = fade * lanes;
    ctx.lineWidth = 1;
    ctx.strokeStyle = LINE;
    [wikiY, srcY].forEach(function (y) { ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); });
    ctx.strokeStyle = '#b5bdaf';
    ctx.beginPath(); ctx.moveTo(x0, axisY); ctx.lineTo(x1, axisY); ctx.stroke();
    ctx.font = (compact ? 11 : 12) + 'px ' + font;
    ctx.fillStyle = MUTED;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    var ticks = niceTicks(lo, hi, compact ? 4 : 7), lastX = -1e9;
    ticks.forEach(function (tk) {
      var x = X(tk.day);
      ctx.beginPath(); ctx.moveTo(x, axisY); ctx.lineTo(x, axisY + 4); ctx.stroke();
      if (x - lastX > 34) { ctx.fillText(tk.label, x, axisY + 6); lastX = x; }
    });
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '500 ' + (compact ? 11 : 12) + 'px ' + font;
    if (!compact) {
      ctx.fillStyle = WIKI; ctx.fillText('Wikipedia', padX, wikiY);
      ctx.fillStyle = SOURCE; ctx.fillText('Source', padX, srcY);
    }
    ctx.globalAlpha = fade;

    // The cursor: where we are in time.
    var cursorDay = null;
    steps.forEach(function (s) { if (s.id === 'sweep' && t >= s.a) cursorDay = s.from + (s.to - s.from) * ease((t - s.a) / (s.b - s.a)); });
    var claimX = X(d.claim.day);
    // Wikipedia lane: the claim lives on from the moment it appears.
    if (P.claim > 0) {
      var endDay = cursorDay != null ? Math.max(cursorDay, d.claim.day) : d.claim.day;
      if (P.verdict > 0 || (P.loop || 0) > 0) endDay = Math.max(endDay, d.cite ? d.cite.day : endDay, d.source ? d.source.hi : endDay);
      var endX = Math.min(X(endDay), x1);
      ctx.strokeStyle = WIKI;
      ctx.lineWidth = 3;
      ctx.globalAlpha = fade * 0.35;
      ctx.beginPath(); ctx.moveTo(claimX, wikiY); ctx.lineTo(endX, wikiY); ctx.stroke();
      ctx.globalAlpha = fade;
    }
    if (cursorDay != null && t < (stepStart(steps, 'loop') || stepStart(steps, 'verdict') || 1)) {
      var cx = X(cursorDay);
      ctx.strokeStyle = '#b5bdaf';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(cx, top); ctx.lineTo(cx, axisY); ctx.stroke();
      ctx.setLineDash([]);
    }

    // Source: a diamond for a day, a band for a coarser date.
    var sx = null;
    if (d.source && P.source > 0) {
      var a = P.source;
      sx = X(d.source.lo);
      var sx2 = X(d.source.hi);
      ctx.globalAlpha = fade * a;
      if (sx2 - sx > 6) {
        ctx.fillStyle = 'rgba(154, 75, 47, 0.16)';
        roundRect(ctx, sx, srcY - 7, sx2 - sx, 14, 4); ctx.fill();
        ctx.strokeStyle = SOURCE; ctx.lineWidth = 1.5;
        roundRect(ctx, sx, srcY - 7, sx2 - sx, 14, 4); ctx.stroke();
        sx = (sx + sx2) / 2;
      } else {
        diamond(ctx, sx, srcY, 7 * (0.6 + 0.4 * a), SOURCE);
      }
      ctx.fillStyle = SOURCE;
      ctx.font = '500 ' + fs + 'px ' + font;
      ctx.textBaseline = 'top';
      placeLabel(ctx, (d.source.name || 'Source') + ' · ' + d.source.label, sx, srcY + 12, x0, x1);
      ctx.globalAlpha = fade;
    }

    // Claim: a circle on the Wikipedia lane, labelled just right of it.
    ctx.font = '500 ' + fs + 'px ' + font;
    var claimText = (compact ? 'On Wikipedia · ' : 'Claim first seen · ') + d.claim.label;
    var claimLabelX = Math.min(claimX + 12, W - padX - ctx.measureText(claimText).width);
    var claimLabelEnd = claimLabelX + ctx.measureText(claimText).width;
    if (P.claim > 0) {
      ctx.globalAlpha = fade * P.claim;
      circle(ctx, claimX, wikiY, 7 * (0.6 + 0.4 * P.claim), WIKI);
      ctx.fillStyle = WIKI;
      ctx.textBaseline = 'bottom';
      ctx.textAlign = 'left';
      ctx.fillText(claimText, claimLabelX, wikiY - 10);
      ctx.globalAlpha = fade;
    }

    // Citation: a square on the Wikipedia lane, labelled beside it where there is room.
    var citeX = null;
    if (d.cite && !d.cite.same && P.cite > 0) {
      citeX = X(d.cite.day);
      ctx.globalAlpha = fade * P.cite;
      square(ctx, citeX, wikiY, 6.5 * (0.6 + 0.4 * P.cite), INK);
      ctx.fillStyle = INK;
      ctx.font = '500 ' + fs + 'px ' + font;
      ctx.textAlign = 'left';
      var ct = 'Cited · ' + d.cite.label, cw = ctx.measureText(ct).width;
      var cxl = citeX + 12, cy = wikiY - 10;
      if (cxl + cw > W - padX) cxl = citeX - 12 - cw;
      if (cxl < claimLabelEnd + 8 && cxl + cw > claimLabelX - 8) { cxl = Math.max(x0, citeX - 12 - cw); cy = wikiY + 12 + fs; }
      ctx.textBaseline = 'bottom';
      ctx.fillText(ct, cxl, cy);
      ctx.globalAlpha = fade;
    } else if (d.cite && d.cite.same) citeX = claimX;

    // Arrows: the possible copy (dashed), and the citation pointing back.
    if (d.source && sx != null && P.copy > 0) arrow(ctx, claimX, wikiY + 9, sx, srcY - 10, P.copy, SOURCE, true, compact ? null : 'repeats it?', fs, font, W - padX);
    if (d.source && sx != null && citeX != null && P.citeArrow > 0) arrow(ctx, sx, srcY - 10, citeX, wikiY + 9, P.citeArrow, INK, false, compact ? null : 'cited for it', fs, font, W - padX);
    if (d.code === 'echo' && P.loop > 0 && citeX != null) {
      // Close the loop: from the citation back over the top to the claim it now supports.
      var yTop = Math.max(top + 2, wikiY - 46), r = 10, yEnd = wikiY - 10;
      var path = [];
      function seg(x, y) { path.push([x, y]); }
      seg(citeX, yEnd);
      seg(citeX, yTop + r);
      for (var q = 1; q <= 6; q++) { var an = q / 6 * Math.PI / 2; seg(citeX - r + r * Math.cos(an), yTop + r - r * Math.sin(an)); }
      seg(claimX + r, yTop);
      for (var q2 = 1; q2 <= 6; q2++) { var an2 = Math.PI / 2 + q2 / 6 * Math.PI / 2; seg(claimX + r + r * Math.cos(an2), yTop + r - r * Math.sin(an2)); }
      seg(claimX, wikiY - 10);
      var lens = [0];
      for (var i = 1; i < path.length; i++) lens.push(lens[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
      var want = lens[lens.length - 1] * clamp(P.loop);
      ctx.strokeStyle = LOOP; ctx.lineWidth = 1.75;
      ctx.beginPath(); ctx.moveTo(path[0][0], path[0][1]);

      for (var k = 1; k < path.length; k++) {
        if (lens[k] <= want) { ctx.lineTo(path[k][0], path[k][1]); continue; }
        var f = (want - lens[k - 1]) / Math.max(1e-6, lens[k] - lens[k - 1]);
        var px2 = path[k - 1][0] + (path[k][0] - path[k - 1][0]) * f, py2 = path[k - 1][1] + (path[k][1] - path[k - 1][1]) * f;
        ctx.lineTo(px2, py2);
        break;
      }
      ctx.stroke();
      if (P.loop > 0.98) head(ctx, path[path.length - 2][0], path[path.length - 2][1], path[path.length - 1][0], path[path.length - 1][1] + 1, LOOP);
    }

    // Verdict.
    if (P.verdict > 0) {
      ctx.globalAlpha = fade * P.verdict;
      ctx.font = '500 ' + (compact ? 13 : 14) + 'px ' + font;
      var vtext = d.verdict + (d.claim.messy ? ' (messy history)' : '') + (compact && opts.title && d.title ? ' · ' + d.title : '');
      var vw = ctx.measureText(vtext).width;
      var vy = opts.title ? (compact ? 12 : 14) : top;
      var vh = compact ? 12 : 14;
      var vx = compact && opts.title ? padX + 18 + vw : W - padX;
      ctx.fillStyle = BG;
      ctx.fillRect(vx - vw - 26, vy - 3, vw + 30, vh + 8);
      ctx.fillStyle = VERDICT_COLOUR[d.code] || MUTED;
      verdictIcon(ctx, d.code, vx - vw - 12, vy + vh / 2, VERDICT_COLOUR[d.code] || MUTED);
      ctx.fillStyle = VERDICT_COLOUR[d.code] || MUTED;
      ctx.font = '500 ' + (compact ? 13 : 14) + 'px ' + font;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText(vtext, vx, vy);
      ctx.textAlign = 'left';
    }
    ctx.globalAlpha = 1;
  }
  function stepStart(steps, id) { var s = steps.filter(function (x) { return x.id === id; })[0]; return s ? s.a : null; }
  function fitText(ctx, s, w) { if (ctx.measureText(s).width <= w) return s; while (s.length > 4 && ctx.measureText(s + '…').width > w) s = s.slice(0, -1); return s + '…'; }
  function placeLabel(ctx, text, x, y, minX, maxX, bias) {
    var w = ctx.measureText(text).width, lx;
    if (bias === 'left-ish') lx = x - 10;
    else if (bias === 'right-ish') lx = x - w + 10;
    else lx = x - w / 2;
    lx = Math.max(minX - 4, Math.min(lx, maxX - w + 4));
    ctx.textAlign = 'left';
    ctx.fillText(text, lx, y);
  }
  function circle(ctx, x, y, r, c) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = BG; ctx.lineWidth = 2; ctx.stroke(); }
  function square(ctx, x, y, r, c) { ctx.fillStyle = c; ctx.fillRect(x - r, y - r, r * 2, r * 2); ctx.strokeStyle = BG; ctx.lineWidth = 2; ctx.strokeRect(x - r, y - r, r * 2, r * 2); }
  function diamond(ctx, x, y, r, c) { ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x, y - r * 1.25); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r * 1.25); ctx.lineTo(x - r, y); ctx.closePath(); ctx.fill(); }
  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function head(ctx, ax, ay, bx, by, c) {
    var ang = Math.atan2(by - ay, bx - ax), s = 8;
    ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(bx, by);
    ctx.lineTo(bx - s * Math.cos(ang - 0.45), by - s * Math.sin(ang - 0.45));
    ctx.lineTo(bx - s * Math.cos(ang + 0.45), by - s * Math.sin(ang + 0.45));
    ctx.closePath(); ctx.fill();
  }
  function arrow(ctx, ax, ay, bx, by, p, colour, dashed, label, fs, font, maxX) {
    // A gentle curve from a to b, bowed to its right-hand side, drawn up to fraction p.
    var dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len, bow = Math.min(40, len * 0.18);
    var mx = (ax + bx) / 2 + nx * bow, my = (ay + by) / 2 + ny * bow;
    ctx.strokeStyle = colour; ctx.lineWidth = 1.75;
    if (dashed) ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(ax, ay);
    var N = 30, upto = Math.max(1, Math.round(N * clamp(p))), px = ax, py = ay, qx = ax, qy = ay;
    for (var i = 1; i <= upto; i++) {
      var u = i / N, x = (1 - u) * (1 - u) * ax + 2 * (1 - u) * u * mx + u * u * bx, y = (1 - u) * (1 - u) * ay + 2 * (1 - u) * u * my + u * u * by;
      ctx.lineTo(x, y); px = qx; py = qy; qx = x; qy = y;
    }
    ctx.stroke(); ctx.setLineDash([]);
    if (p > 0.98) head(ctx, px, py, qx, qy, colour);
    if (label && p > 0.6) {
      var hx = 0.25 * ax + 0.5 * mx + 0.25 * bx, hy = 0.25 * ay + 0.5 * my + 0.25 * by;
      ctx.font = 'italic ' + (fs - 1) + 'px ' + font; ctx.textBaseline = 'middle';
      var w = ctx.measureText(label).width;
      var lx = nx >= 0 ? hx + 8 : hx - 8 - w;
      if (maxX) lx = Math.min(lx, maxX - w);
      ctx.fillStyle = BG; ctx.fillRect(lx - 3, hy - fs / 2 - 1, w + 6, fs + 2);
      ctx.fillStyle = colour; ctx.textAlign = 'left';
      ctx.fillText(label, lx, hy);
    }
  }
  function verdictIcon(ctx, code, x, y, c) {
    ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = 1.75;
    if (code === 'echo') { ctx.beginPath(); ctx.arc(x, y, 5, 0.3, Math.PI * 1.85); ctx.stroke(); head(ctx, x + 4, y - 5.5, x + 5, y - 1.5, c); }
    else if (code === 'first') { ctx.beginPath(); ctx.moveTo(x - 5, y); ctx.lineTo(x - 1, y + 4); ctx.lineTo(x + 5, y - 4); ctx.stroke(); }
    else if (code === 'later') { ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x, y - 3); ctx.lineTo(x, y); ctx.lineTo(x + 2.5, y + 1.5); ctx.stroke(); }
    else { ctx.font = '600 13px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('?', x, y); ctx.textAlign = 'right'; ctx.textBaseline = 'top'; }
  }

  function describe(d) {
    var s = 'Timeline. The claim was first seen on Wikipedia on ' + d.claim.label + (d.claim.messy ? ' (the history is messy)' : '') + '. ';
    if (d.source) s += (d.source.name || 'The source') + ' is dated ' + d.source.label + (d.source.lo > d.claim.day ? ', after the claim appeared. ' : d.source.hi < d.claim.day ? ', before the claim appeared. ' : ', overlapping the time the claim appeared. ');
    else s += 'No source date is known. ';
    if (d.cite) s += d.cite.same ? 'The citation arrived with the claim. ' : 'The citation was attached on ' + d.cite.label + '. ';
    if (d.code === 'echo') s += 'The arrows form a loop: Wikipedia, then the source, then back to Wikipedia. ';
    return s + 'Verdict: ' + d.verdict + '.';
  }

  // A player that runs a timeline animation once or on a loop, and stops its frame loop when idle.
  function Player(canvas, opts) {
    this.canvas = canvas; this.opts = opts || {}; this.data = null; this.t = 0.9; this.raf = 0; this.start = 0; this.loop = !!this.opts.loop; this.duration = this.opts.duration || 10000;
  }
  Player.prototype.set = function (d, animate) {
    this.data = d; this.data._steps = null;
    this.canvas.setAttribute('aria-label', describe(d));
    this.stop();
    if (animate && !Kit.reducedMotion && !document.hidden) { this.t = 0; this.draw(); this.play(); } else { this.t = 0.9; this.draw(); }
  };
  Player.prototype.draw = function () { if (this.data) drawTimeline(this.canvas, this.data, this.t, this.opts); };
  Player.prototype.play = function () {
    var self = this;
    if (this.raf) return;
    this.start = performance.now() - this.t * this.duration * (this.loop ? 1 : 0);
    if (!this.loop) this.start = performance.now();
    function frame(now) {
      var t = (now - self.start) / self.duration;
      if (self.loop) t = t % 1;
      else if (t >= 0.9) { self.t = 0.9; self.draw(); self.raf = 0; return; }
      self.t = t; self.draw();
      self.raf = requestAnimationFrame(frame);
    }
    this.raf = requestAnimationFrame(frame);
  };
  Player.prototype.stop = function () { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; };

  function watchSize(el, fn) {
    if ('ResizeObserver' in window) new ResizeObserver(function () { fn(); }).observe(el);
    else window.addEventListener('resize', fn);
  }

  // ------------------------------------------------------------------ preview mode
  if (Kit.preview) { startPreview(); return; }

  function startPreview() {
    var canvas = document.getElementById('preview-canvas');
    canvas.hidden = false;
    var rec = R[PREVIEW_CASE];
    if (!rec) return;
    var d = fromRecorded(rec);
    var player = new Player(canvas, { loop: true, duration: 10000, title: 'Vulfpeck: “met in a German literature class”' });
    player.data = d;
    canvas.setAttribute('aria-label', describe(d));
    player.t = 0.9; player.draw();
    watchSize(canvas, function () { if (!player.raf) player.draw(); });
    Kit.onPlay(function (on) {
      if (on) { player.play(); }
      else { player.stop(); player.t = 0.9; player.draw(); }
    });
  }

  // ------------------------------------------------------------------ the full page
  function transport(url, headers) {
    return fetch(url, { headers: headers, credentials: 'omit' }).then(function (r) {
      if (!r.ok) throw new Error('Wikipedia returned HTTP ' + r.status + '.');
      return r.json();
    });
  }
  var api = M.makeApi(transport);

  var $ = function (id) { return document.getElementById(id); };
  var form = $('load-form'), articleIn = $('article'), oldidIn = $('oldid'), loadBtn = $('load-btn');
  var statusEl = $('status'), pane = $('article-pane'), sentencesEl = $('sentences'), articleHead = $('article-head'), filterIn = $('filter');
  var chosenEl = $('chosen'), traceIn = $('trace-text'), traceBtn = $('trace-btn'), citeList = $('cite-list'), scopeNote = $('scope-note'), chosenText = $('chosen-text');
  var logEl = $('log'), logWrap = $('log-wrap'), resultEl = $('result'), verdictEl = $('verdict'), evidenceEl = $('evidence'), caveatsEl = $('caveats'), tlCaption = $('tl-caption');
  var canvas = $('timeline'), checkBtn = $('check-btn'), checkEl = $('check');
  var player = new Player(canvas, { title: null });
  var state = { target: null, doc: null, sentence: null, busy: false };

  watchSize(canvas, function () { if (!player.raf) player.draw(); });

  function setStatus(msg, isError) { statusEl.textContent = msg || ''; statusEl.classList.toggle('is-error', !!isError); }
  function setBusy(b) {
    state.busy = b;
    [loadBtn, traceBtn, checkBtn].forEach(function (x) { if (x) x.disabled = b; });
    Array.prototype.forEach.call(document.querySelectorAll('.case-btn'), function (x) { x.disabled = b; });
    stage.setAttribute('aria-busy', b ? 'true' : 'false');
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function link(href, text) { var a = el('a', null, text); a.href = href; a.rel = 'noopener'; a.target = '_blank'; return a; }
  function revUrl(id) { return 'https://en.wikipedia.org/w/index.php?oldid=' + id; }
  // A diff against the revision Echo actually read, not merely the one before (which may be hidden).
  function diffUrl(id, prevId) { return 'https://en.wikipedia.org/w/index.php?diff=' + id + '&oldid=' + (prevId || 'prev'); }
  function articleUrl(t) { return 'https://en.wikipedia.org/wiki/' + encodeURIComponent(t.replace(/ /g, '_')); }

  // Opening state: a recorded documented case, so the idea is visible before anything is run.
  function showRecorded() {
    var rec = R[PREVIEW_CASE];
    if (!rec) return;
    var d = fromRecorded(rec);
    resultEl.hidden = false;
    var srcDate = rec.sources[0] && rec.sources[0].date ? M.parseDate(rec.sources[0].date) : null;
    renderVerdict(rec.code, rec.verdict, 'Recorded run of a documented case: the Vulfpeck article said the band met in a German literature class from ' +
      monthYear(M.isoToDay(rec.claimFirstSeen.timestamp)) + '. Billboard printed the same story in ' + (srcDate ? monthYear(srcDate.lo) : 'a later month') + ', and Billboard was then cited for it.');
    tlCaption.textContent = 'Recorded from revision ' + rec.oldid + ' of “Vulfpeck”. Open its case file to run it live.';
    evidenceEl.textContent = '';
    caveatsEl.textContent = '';
    player.set(d, true);
  }

  function renderVerdict(code, label, why) {
    verdictEl.className = 'verdict v-' + code;
    verdictEl.textContent = '';
    var icon = el('span', 'v-icon');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = { echo: '↻', first: '✓', later: '◷', unknown: '?' }[code] || '?';
    var box = el('div');
    box.appendChild(el('p', 'v-label', label));
    if (why) box.appendChild(el('p', 'v-why', why));
    verdictEl.appendChild(icon);
    verdictEl.appendChild(box);
  }

  // ---- loading an article
  async function loadArticle(title, oldid, quiet) {
    setBusy(true);
    setStatus('Loading ' + (oldid ? 'revision ' + oldid : '“' + title + '”') + '…');
    try {
      var target = await M.loadRevision(api, title, oldid);
      state.target = target;
      state.doc = M.analyseWikitext(target.content);
      state.sentence = null;
      renderArticle();
      chosenEl.hidden = true;
      var cited = state.doc.sentences.filter(clickable).length;
      if (!quiet) setStatus('Loaded “' + target.title + '”. ' + M.fmtInt(cited) + ' of ' + M.fmtInt(state.doc.sentences.length) + ' sentences carry a citation. Choose one.');
      return target;
    } catch (e) {
      setStatus(e.message || String(e), true);
      throw e;
    } finally { setBusy(false); }
  }

  function clickable(s) { return M.supportingRefs(state.doc.sentences, [state.doc.sentences.indexOf(s)]).refs.length > 0; }

  function renderArticle() {
    var t = state.target, doc = state.doc;
    pane.hidden = false;
    articleHead.textContent = '';
    var h = el('h3', 'art-title', t.title);
    articleHead.appendChild(h);
    var meta = el('p', 'art-meta');
    meta.appendChild(document.createTextNode('Revision '));
    meta.appendChild(link(revUrl(t.revid), String(t.revid)));
    meta.appendChild(document.createTextNode(' of ' + isoLabel(t.timestamp) + '. Text from Wikipedia’s article '));
    meta.appendChild(link(articleUrl(t.title), '“' + t.title + '”'));
    meta.appendChild(document.createTextNode(', '));
    meta.appendChild(link('https://creativecommons.org/licenses/by-sa/4.0/', 'CC BY-SA 4.0'));
    meta.appendChild(document.createTextNode('. Tables, infoboxes and captions are left out.'));
    articleHead.appendChild(meta);
    filterIn.value = '';
    sentencesEl.textContent = '';
    var frag = document.createDocumentFragment(), lastHeading = null;
    doc.paragraphs.forEach(function (p) {
      if (p.heading && p.heading !== lastHeading) { frag.appendChild(el('h4', 'sec', p.heading)); lastHeading = p.heading; }
      var block = el('div', 'para');
      p.sentences.forEach(function (s) {
        var sup = M.supportingRefs(doc.sentences, [doc.sentences.indexOf(s)]);
        var node;
        if (sup.refs.length) {
          node = el('button', 'sent');
          node.type = 'button';
          node.dataset.id = s.id;
          node.appendChild(document.createTextNode(s.text));
          if (sup.scope === 'sentence') {
            var marks = el('span', 'marks', ' ' + s.refs.map(function (r) { return '[' + (doc.refs[r].number || '·') + ']'; }).join(''));
            node.appendChild(marks);
          } else {
            node.classList.add('by-para');
            node.appendChild(el('span', 'marks', ' (paragraph’s citation)'));
          }
        } else node = el('span', 'sent plain', s.text);
        node.dataset.text = s.text.toLowerCase();
        block.appendChild(node);
      });
      frag.appendChild(block);
    });
    sentencesEl.appendChild(frag);
    sentencesEl.scrollTop = 0;
  }

  sentencesEl.addEventListener('click', function (e) {
    var b = e.target.closest('button.sent');
    if (!b || state.busy) return;
    choose(state.doc.sentences.filter(function (s) { return String(s.id) === b.dataset.id; })[0]);
  });

  filterIn.addEventListener('input', function () {
    var q = filterIn.value.trim().toLowerCase();
    Array.prototype.forEach.call(sentencesEl.querySelectorAll('.sent'), function (n) { n.hidden = q && n.dataset.text.indexOf(q) < 0; });
    Array.prototype.forEach.call(sentencesEl.querySelectorAll('.para'), function (p) {
      p.hidden = !!q && !p.querySelector('.sent:not([hidden])');
    });
    Array.prototype.forEach.call(sentencesEl.querySelectorAll('.sec'), function (h) { h.hidden = !!q; });
  });

  function dateKindLabel(kind) {
    return {
      date: 'from its date field', 'publication-date': 'from its publication-date field', year: 'year only',
      'orig-date': 'original publication date', url: 'read from the link', 'free-text': 'found in the citation text'
    }[kind] || '';
  }

  function citationLine(r) {
    var c = r.citation, li = el('li');
    li.appendChild(el('span', 'ref-no', r.number ? '[' + r.number + '] ' : ''));
    var name = c.title || c.text || 'Untitled citation';
    if (name.length > 140) name = name.slice(0, 138) + '…';
    if (c.url) li.appendChild(link(c.url.replace(/^\/\//, 'https://'), name)); else li.appendChild(el('span', null, name));
    if (c.work && c.work !== c.title) li.appendChild(document.createTextNode(' — ' + c.work));
    var when = el('span', 'when');
    var sep = /[.!?]$/.test(li.textContent.trim()) ? ' ' : '. ';
    if (c.source) when.textContent = sep + 'Dated ' + c.source.label + ' (' + dateKindLabel(c.sourceKind) + ').';
    else when.textContent = sep + 'No publication date' + (c.note ? ': ' + c.note : '.');
    li.appendChild(when);
    if (c.access) li.appendChild(el('span', 'hint', ' Access date ' + c.access.label + ' (a hint only: the page existed by then).'));
    return li;
  }

  function choose(s, traceText) {
    state.sentence = s;
    Array.prototype.forEach.call(sentencesEl.querySelectorAll('.sent.is-chosen'), function (n) { n.classList.remove('is-chosen'); n.removeAttribute('aria-current'); });
    var node = sentencesEl.querySelector('.sent[data-id="' + s.id + '"]');
    if (node) { node.classList.add('is-chosen'); node.setAttribute('aria-current', 'true'); }
    chosenEl.hidden = false;
    chosenText.textContent = s.text;
    var sup = M.supportingRefs(state.doc.sentences, [state.doc.sentences.indexOf(s)]);
    scopeNote.hidden = sup.scope !== 'paragraph';
    citeList.textContent = '';
    sup.refs.forEach(function (rid) { citeList.appendChild(citationLine(state.doc.refs[rid])); });
    traceIn.value = traceText || s.text;
    return sup;
  }

  // ---- running an analysis
  function logLine(text) {
    var li = el('li', null, text);
    if (/^  /.test(text)) li.className = 'sub';
    logEl.appendChild(li);
    while (logEl.children.length > 400) logEl.removeChild(logEl.firstChild);
    logWrap.scrollTop = logWrap.scrollHeight;
  }

  async function trace(opts) {
    opts = opts || {};
    if (!state.sentence) return null;
    setBusy(true);
    logWrap.hidden = false;
    logEl.textContent = '';
    resultEl.hidden = true;
    player.stop();
    setStatus('Tracing the sentence through the article’s history…');
    try {
      var res = await M.analyse({ api: api, target: state.target, doc: state.doc, sentence: state.sentence, traceText: traceIn.value, log: logLine });
      renderResult(res);
      setStatus('Done. ' + res.verdict.label + '.');
      return res;
    } catch (e) {
      logLine('Stopped: ' + (e.message || e));
      setStatus(e.message || String(e), true);
      if (opts.rethrow) throw e;
      return null;
    } finally { setBusy(false); }
  }
  traceBtn.addEventListener('click', function () { trace(); });

  function renderResult(res) {
    resultEl.hidden = false;
    var first = res.first, cit = res.citation;
    var why = {
      echo: 'A cited source is dated after a Wikipedia revision that already contained the claim. The source may have copied Wikipedia, or found it independently; the dates cannot say which.',
      first: 'A cited source is dated before the earliest wording of this claim that Echo found on Wikipedia. An earlier wording in quite different words would not be caught.',
      later: 'The claim appeared on Wikipedia with no citation, and this one was attached later. That is context, not proof: editors often add sources to older claims.',
      unknown: res.related ? 'The source is dated before this wording, but an earlier wording that may make the same claim was on Wikipedia before the source. See “Earlier wording” below.'
        : 'The evidence does not settle the order of events.'
    }[res.verdict.code];
    renderVerdict(res.verdict.code, res.verdict.label, why);
    var d = fromResult(res);
    player.set(d, true);
    tlCaption.textContent = describe(d);

    evidenceEl.textContent = '';
    function row(term, build) { var dt = el('dt', null, term), dd = el('dd'); build(dd); evidenceEl.appendChild(dt); evidenceEl.appendChild(dd); }
    row('This wording first seen', function (dd) {
      dd.appendChild(document.createTextNode(isoLabel(first.timestamp) + ', in revision '));
      dd.appendChild(link(revUrl(first.revid), String(first.revid)));
      if (first.firstVisible) dd.appendChild(document.createTextNode(', the first revision with readable text. Earlier revisions have hidden text.'));
      else if (first.index === 0) dd.appendChild(document.createTextNode(', the article’s first revision.'));
      else {
        dd.appendChild(document.createTextNode('. '));
        if (first.exact) { dd.appendChild(link(diffUrl(first.revid, first.prevRevid), 'The edit that added it')); dd.appendChild(document.createTextNode('.')); }
        else if (first.prevRevid) {
          dd.appendChild(document.createTextNode('It was absent in '));
          dd.appendChild(link(revUrl(first.prevRevid), String(first.prevRevid)));
          dd.appendChild(document.createTextNode(' (' + isoLabel(first.prevTimestamp) + '); ' +
            (first.hiddenBefore ? 'revisions in between have hidden text, so the exact edit is not known.' : 'the edits in between were not all checked.')));
        }
      }
      if (first.messy) {
        var note = el('span', 'messy', ' History is messy: ');
        dd.appendChild(note);
        first.events.slice(0, 4).forEach(function (e, i) {
          if (i) dd.appendChild(document.createTextNode('; '));
          dd.appendChild(document.createTextNode(e.kind === 'earlier' ? 'present earlier in ' : 'absent in '));
          dd.appendChild(link(revUrl(e.revid), e.revid + ' (' + isoLabel(e.timestamp) + ')'));
        });
        dd.appendChild(document.createTextNode('. The claim was removed and restored, so this date is a best effort.'));
      }
    });
    row('Citation attached', function (dd) {
      if (!cit) { dd.textContent = 'Not determined.'; return; }
      if (cit.sameRevision) { dd.textContent = 'In the same edit that added the claim.'; return; }
      dd.appendChild(document.createTextNode(isoLabel(cit.timestamp) + ', in revision '));
      dd.appendChild(link(revUrl(cit.revid), String(cit.revid)));
      dd.appendChild(document.createTextNode('. '));
      if (cit.exact) { dd.appendChild(link(diffUrl(cit.revid, cit.prevRevid), 'The edit that attached it')); dd.appendChild(document.createTextNode('.')); }
      else dd.appendChild(document.createTextNode('Earliest revision found with it; the exact edit was not pinned down.'));
      dd.appendChild(document.createTextNode(cit.appearedUnsourced ? ' The claim first appeared with no citation at all.' : ' The claim first appeared with a different citation.'));
    });
    if (res.earlier) row('Earlier wording', function (dd) {
      var e = res.earlier;
      dd.appendChild(document.createTextNode('Revision '));
      dd.appendChild(link(revUrl(e.revid), String(e.revid)));
      dd.appendChild(document.createTextNode(' (' + isoLabel(e.timestamp) + '), from before this wording, has ' +
        (e.sentences.length > 1 ? 'sentences' : 'a sentence') + ' sharing its rarer words: '));
      e.sentences.forEach(function (s, i) {
        if (i) dd.appendChild(document.createTextNode(' and '));
        dd.appendChild(el('q', null, s.text));
      });
      dd.appendChild(document.createTextNode(' '));
      var r = res.related;
      if (r) {
        dd.appendChild(document.createTextNode('Traced back, it was on Wikipedia ' + (r.settled ? 'from ' : 'by ') + isoLabel(r.timestamp) + ', in revision '));
        dd.appendChild(link(revUrl(r.revid), String(r.revid)));
        dd.appendChild(document.createTextNode(r.settled ? '. ' : ', and may be older still. '));
      }
      dd.appendChild(document.createTextNode('Echo matches words, not meaning, so read it and judge whether it makes the same claim.'));
      var sugg = e.sentences.map(function (s) { return s.suggest; }).filter(function (s, i, a) { return s && s.split(' ').length >= 2 && a.indexOf(s) === i; });
      if (sugg.length) {
        var p = el('p', 'suggest');
        p.appendChild(document.createTextNode('To follow the claim through the rewording, trace the words they share: '));
        sugg.forEach(function (s) {
          var b = el('button', 'kit-button suggest-btn', 'Trace “' + s + '”');
          b.type = 'button';
          b.addEventListener('click', function () { if (state.busy) return; traceIn.value = s; trace(); });
          p.appendChild(b);
        });
        dd.appendChild(p);
      }
    });
    row(res.sources.length > 1 ? 'Sources' : 'Source', function (dd) {
      var ul = el('ul', 'src-list');
      res.sources.forEach(function (s, i) {
        var li = citationLine(s.ref);
        var rel = res.verdict.relations[i];
        li.appendChild(el('span', 'rel', ' ' + { after: 'After the claim was on Wikipedia.', before: 'Before this wording first appeared.', overlap: 'Overlaps, at the precision given.',
          weak: 'A year from free text with no clear title: not enough to order.', unknown: '' }[rel] || ''));
        ul.appendChild(li);
      });
      dd.appendChild(ul);
      if (res.scope === 'paragraph') dd.appendChild(el('p', 'hint', 'The sentence has no citation of its own; this is the citation at the end of its paragraph.'));
    });
    row('Search', function (dd) {
      dd.textContent = M.fmtInt(res.revisionCount) + ' revisions listed' + (res.hiddenCount ? ' (' + res.hiddenCount + ' with hidden text skipped)' : '') +
        ', ' + res.fetches + ' fetched and read (limit ' + res.cap + ').' + (res.capHit ? ' The limit was reached; see the notes below.' : '') +
        ' Traced text: “' + (res.traceText.length > 120 ? res.traceText.slice(0, 118) + '…' : res.traceText) + '”, matched at ' + Math.round(M.THRESHOLD * 100) + '% of its words or more, with every number and “not” in it.';
    });
    caveatsEl.textContent = '';
    res.verdict.reasons.forEach(function (r) { caveatsEl.appendChild(el('li', null, r)); });
    if (window.matchMedia && window.matchMedia('(max-width: 820px)').matches) resultEl.scrollIntoView({ block: 'start', behavior: Kit.reducedMotion ? 'auto' : 'smooth' });
  }

  // ---- the form
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (state.busy) return;
    var p = M.parseArticleInput(articleIn.value, oldidIn.value);
    if (p.error) { setStatus(p.error, true); return; }
    loadArticle(p.title, p.oldid).catch(function () {});
  });

  // ---- case files
  function caseButton(c) {
    var b = el('button', 'kit-button case-btn', c.label);
    b.type = 'button';
    b.addEventListener('click', function () { openCase(c).catch(function () {}); });
    return b;
  }
  function renderCases() {
    var docList = $('cases-documented'), ctlList = $('cases-control');
    C.CASES.forEach(function (c) { (c.kind === 'documented' ? docList : ctlList).appendChild(caseButton(c)); });
  }
  async function openCase(c, opts) {
    opts = opts || {};
    articleIn.value = c.title;
    oldidIn.value = c.oldid;
    await loadArticle(c.title, c.oldid, true);
    var s = state.doc.sentences.filter(function (x) { return x.text.indexOf(c.pick) >= 0; })[0];
    if (!s) throw new Error('The case’s sentence was not found in revision ' + c.oldid + '.');
    choose(s, ('trace' in opts ? opts.trace : c.trace) || null);
    var node = sentencesEl.querySelector('.sent[data-id="' + s.id + '"]');
    if (node) sentencesEl.scrollTop += node.getBoundingClientRect().top - sentencesEl.getBoundingClientRect().top - 40;
    setStatus(c.story);
    var res = await trace(opts);
    if (res) setStatus(c.story + ' Result: ' + res.verdict.label + '.');
    return res;
  }

  // The scripted check: every documented case must be flagged, no control may be, and no
  // reworded incident traced whole may come out "Source came first".
  var EXPECT_TEXT = { echo: 'Flagged', clean: 'Not flagged', 'not-first': 'Not “Source came first”' };
  async function runCheck() {
    checkEl.hidden = false;
    checkEl.textContent = '';
    var table = el('table', 'check-table');
    var cap = el('caption', null, 'Case-file check, run live against Wikipedia');
    table.appendChild(cap);
    var thead = el('thead'), hr = el('tr');
    ['Case', 'Expected', 'Result', ''].forEach(function (h) { var th = el('th', null, h); th.scope = 'col'; hr.appendChild(th); });
    thead.appendChild(hr); table.appendChild(thead);
    var tbody = el('tbody'); table.appendChild(tbody);
    checkEl.appendChild(table);
    var out = [];
    var runs = C.runs();
    for (var i = 0; i < runs.length; i++) {
      var run = runs[i], tr = el('tr');
      var c = C.CASES.filter(function (x) { return x.id === run.caseId; })[0];
      tr.appendChild(el('td', null, run.label + (run.trace ? ', tracing “' + run.trace + '”' : '')));
      tr.appendChild(el('td', null, EXPECT_TEXT[run.expect] || run.expect));
      var cell = el('td', null, 'Running…'), ok = el('td', null, '');
      tr.appendChild(cell); tr.appendChild(ok); tbody.appendChild(tr);
      try {
        var res = await openCase(c, { rethrow: true, trace: run.trace });
        var pass = C.passes(run.expect, res.verdict.code);
        cell.textContent = res.verdict.label;
        ok.textContent = pass ? 'Pass' : 'Fail';
        ok.className = pass ? 'pass' : 'fail';
        out.push({ id: run.id, code: res.verdict.code, pass: pass, firstSeen: res.first.timestamp, fetches: res.fetches });
      } catch (e) {
        cell.textContent = 'Error: ' + (e.message || e);
        ok.textContent = 'Fail'; ok.className = 'fail';
        out.push({ id: run.id, error: String(e.message || e), pass: false });
      }
    }
    var passed = out.filter(function (r) { return r.pass; }).length;
    checkEl.appendChild(el('p', 'check-sum', passed + ' of ' + out.length + ' runs behaved as expected.'));
    return out;
  }
  window.EchoCheck = runCheck;
  checkBtn.addEventListener('click', function () { if (!state.busy) runCheck(); });

  renderCases();
  showRecorded();
})();
