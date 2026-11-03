// Delve: the page. All game rules, odds and text with numbers in them come from model.js
// (window.Delve); this file draws them and wires the controls.
(function () {
  'use strict';
  var M = window.Delve;
  var Kit = window.Kit || { preview: false, reducedMotion: false, onPlay: function (cb) { cb(true); } };
  var $ = function (id) { return document.getElementById(id); };
  var C = { parch: '#efe3c6', ledger: '#f4ead2', ink: '#4a3826', soft: '#6b5640', blood: '#8c2a1e', verd: '#3f7a68', verdInk: '#2f5f50', ivory: '#f8f1de', shade: '#e9dcbc' };
  var TIER_FILL = { disaster: 'dis', fail: 'fail', success: 'succ', strong: 'strong' };
  var TIER_COL = { disaster: C.blood, fail: C.blood, success: C.verd, strong: C.verd };
  var TIER_TEXT = { disaster: C.blood, fail: C.blood, success: C.verdInk, strong: C.verdInk };
  var STYLE_NAME = { careful: 'Careful', bold: 'Bold', clever: 'Clever' };

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function reduced() { return !!Kit.reducedMotion; }
  // Small deterministic jitter for hand-drawn lines.
  function hash(n) { var x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); }
  function jit(n, a) { return (hash(n) - 0.5) * 2 * a; }
  function f1(x) { return Math.round(x * 10) / 10; }

  // ================================================================= dice drawings
  // Solid ivory polyhedra with inked numerals, drawn from the front.
  function dieShape(m) {
    var face = C.ivory, side = C.shade, s = '';
    var poly = function (pts, fill) { return '<polygon points="' + pts + '" fill="' + fill + '" stroke="' + C.ink + '" stroke-width="1.6" stroke-linejoin="round"/>'; };
    var line = function (pts) { return '<polyline points="' + pts + '" fill="none" stroke="' + C.ink + '" stroke-width="1" stroke-opacity="0.55" stroke-linejoin="round"/>'; };
    if (m === 6) {
      s += poly('8,15 15,7 42,7 35,15', '#fbf6e8') + poly('35,15 42,7 42,35 35,43', side) + poly('8,15 35,15 35,43 8,43', face);
      return { svg: s, cx: 21.5, cy: 30.5 };
    }
    if (m === 4 || m === 3) { s += poly('24,4 45,43 3,43', face) + line('24,4 24,30') + line('3,43 24,30 45,43'); return { svg: s, cx: 24, cy: 37, small: true }; }
    if (m === 8) { s += poly('24,3 45,24 24,45 3,24', side) + poly('24,3 41,30 7,30', face); return { svg: s, cx: 24, cy: 24.5 }; }
    if (m === 10 || m === 100) { s += poly('24,3 45,22 24,45 3,22', side) + poly('24,3 36,27 24,33 12,27', face); return { svg: s, cx: 24, cy: 24 }; }
    if (m === 12) {
      s += poly('24,2 44,14 44,34 24,46 4,34 4,14', side);
      s += poly('24,10 36,19 32,34 16,34 12,19', face) + line('24,2 24,10') + line('44,14 36,19') + line('44,34 32,34') + line('4,34 16,34') + line('4,14 12,19');
      return { svg: s, cx: 24, cy: 26.5 };
    }
    if (m === 2) { s += '<circle cx="24" cy="24" r="20" fill="' + face + '" stroke="' + C.ink + '" stroke-width="1.6"/><circle cx="24" cy="24" r="15" fill="none" stroke="' + C.ink + '" stroke-opacity="0.45"/>'; return { svg: s, cx: 24, cy: 24 }; }
    // d20 and anything else: a hexagonal outline with the front triangle.
    s += poly('24,2 44,13 44,35 24,46 4,35 4,13', side);
    s += poly('24,11 38,34 10,34', face) + line('24,2 24,11') + line('44,13 38,34 44,35') + line('4,13 10,34 4,35') + line('4,13 24,11 44,13') + line('10,34 24,46 38,34');
    return { svg: s, cx: 24, cy: 27.5, small: true };
  }
  // fsMin: a floor on the numeral size (the card preview draws dice small).
  function dieSVG(m, value, cls, fsMin) {
    var sh = dieShape(m), txt = value == null ? '' : String(value);
    var fs = txt.length >= 3 ? 11 : sh.small ? (txt.length === 2 ? 12.5 : 14) : (txt.length === 2 ? 15 : 17);
    if (fsMin) fs = Math.max(fs, fsMin);
    return '<svg class="dv-die' + (cls ? ' ' + cls : '') + '" viewBox="0 0 48 48" aria-hidden="true">' + sh.svg +
      '<text x="' + sh.cx + '" y="' + sh.cy + '" text-anchor="middle" dominant-baseline="middle" font-size="' + fs + '">' + esc(txt) + '</text></svg>';
  }

  // ================================================================= the odds chart
  // A ruled ledger page. Where the dice have few enough equally likely outcomes, each column is
  // a column of tally marks, one mark per way the dice can fall; otherwise an inked bar.
  function showRange(d) { return M.displayRange(d); }
  function patternDefs(id) {
    return '<defs>' +
      '<pattern id="' + id + '-fail" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="' + C.blood + '" fill-opacity="0.07"/><line x1="1" y1="0" x2="1" y2="5" stroke="' + C.blood + '" stroke-width="1.5"/></pattern>' +
      '<pattern id="' + id + '-dis" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="' + C.blood + '" fill-opacity="0.12"/><line x1="1" y1="0" x2="1" y2="5" stroke="' + C.blood + '" stroke-width="1.5"/><line x1="0" y1="1" x2="5" y2="1" stroke="' + C.blood + '" stroke-width="1.5"/></pattern>' +
      '</defs>';
  }
  function tierFill(id, t) {
    if (t === 'fail') return 'url(#' + id + '-fail)';
    if (t === 'disaster') return 'url(#' + id + '-dis)';
    if (t === 'success') return 'rgba(63,122,104,0.38)';
    return C.verd;
  }

  // spec: { id, d, target, landed, w, h, range:{lo,hi}, yMax, tally (allow), small, light (0..1 sweep) }
  function chartMarkup(spec) {
    var d = spec.d, w = spec.w, h = spec.h, id = spec.id, T = spec.target;
    var small = !!spec.small;
    var padL = 4, padR = 4, padT = small ? 16 : 22, padB = small ? 18 : 42;
    var lo = spec.range ? spec.range.lo : d.min, hi = spec.range ? spec.range.hi : d.max;
    var n = hi - lo + 1, plotW = w - padL - padR, cw = plotW / n, base = h - padB, plotH = base - padT;
    var maxWays = 0, maxP = 0, x;
    for (x = d.min; x <= d.max; x++) { maxP = Math.max(maxP, M.pAt(d, x)); if (d.ways) maxWays = Math.max(maxWays, d.ways[x - d.min]); }
    var yMax = spec.yMax || maxP;
    // Tally: one short horizontal stroke per way, stacked up the column and struck through in
    // fives, so a column's height is exactly proportional to its number of ways.
    var GAP = 2;
    var SP = maxWays ? Math.min(small ? 7 : 16, (plotH * 0.94 - GAP * Math.floor(maxWays / 5)) / maxWays) : 0;
    var tally = !!(spec.tally && d.ways && maxWays <= 60 && n <= 30 && cw >= 7 && SP >= 3);
    function tallyTop(ways) { return base - 3 - ways * SP - GAP * Math.floor((ways - 1) / 5); }
    var out = patternDefs(id);
    // ruled lines
    if (!small) for (var ry = base; ry > padT - 4; ry -= 26) out += '<line x1="0" x2="' + w + '" y1="' + ry + '" y2="' + ry + '" stroke="' + C.ink + '" stroke-opacity="0.08"/>';
    // pass zone wash
    if (T > lo && T <= hi + 1) {
      var tx = padL + (Math.max(T, lo) - lo) * cw;
      out += '<rect x="' + tx + '" y="' + (padT - 6) + '" width="' + Math.max(0, padL + plotW - tx) + '" height="' + (plotH + 6) + '" fill="' + C.verd + '" fill-opacity="0.07"/>';
    } else if (T <= lo) out += '<rect x="' + padL + '" y="' + (padT - 6) + '" width="' + plotW + '" height="' + (plotH + 6) + '" fill="' + C.verd + '" fill-opacity="0.07"/>';
    var light = spec.light == null ? 1 : spec.light;
    for (x = lo; x <= hi; x++) {
      var p = M.pAt(d, x); if (p <= 0) continue;
      var t = M.tierOf(x, T), cx = padL + (x - lo + 0.5) * cw, col = TIER_COL[t];
      var lit = (x - lo + 0.5) / n <= light;
      var op = lit ? 1 : 0.25;
      out += '<g class="dv-col" data-x="' + x + '" opacity="' + op + '">';
      if (tally) {
        var ways = d.ways[x - d.min], half = Math.min(9, cw * 0.36), sw = SP < 4.5 ? 1.2 : 1.6;
        for (var i = 0; i < ways; i++) {
          var g = Math.floor(i / 5), yy = base - 3 - (i + 0.5) * SP - GAP * g;
          if (i % 5 === 4) {
            // the fifth mark strikes diagonally through the four below it
            var yLo = yy + 4 * SP + SP * 0.4, yHi = yy - SP * 0.1;
            out += '<line x1="' + f1(cx - half * 0.75) + '" y1="' + f1(yLo) + '" x2="' + f1(cx + half * 0.75) + '" y2="' + f1(yHi) + '" stroke="' + col + '" stroke-width="' + sw + '" stroke-linecap="round"/>';
          } else {
            out += '<line x1="' + f1(cx - half + jit(x * 31 + i, 0.8)) + '" y1="' + f1(yy + jit(x * 7 + i, 0.5)) + '" x2="' + f1(cx + half + jit(x * 13 + i, 0.8)) + '" y2="' + f1(yy + jit(x * 3 + i * 5, 0.5)) + '" stroke="' + col + '" stroke-width="' + sw + '" stroke-linecap="round"/>';
          }
        }
      } else {
        var bh = Math.max(p > 0 ? 1.2 : 0, p / yMax * plotH), bw = Math.max(1, cw * (n > 40 ? 0.9 : 0.72));
        out += '<rect x="' + f1(cx - bw / 2) + '" y="' + f1(base - bh) + '" width="' + f1(bw) + '" height="' + f1(bh) + '" fill="' + tierFill(id, t) + '" stroke="' + col + '" stroke-width="' + (n > 40 ? 0.6 : 1.2) + '"/>';
      }
      if (t === 'strong' && cw >= 9 && !small) {
        var topY = tally ? tallyTop(d.ways[x - d.min]) : base - Math.max(1.2, p / yMax * plotH);
        out += starMark(cx, topY - 7, col);
      }
      out += '</g>';
    }
    // baseline, slightly hand-drawn
    out += '<path d="M' + padL + ' ' + (base + 0.5) + ' Q ' + (w / 2) + ' ' + (base + 1.6) + ' ' + (w - padR) + ' ' + (base + 0.3) + '" fill="none" stroke="' + C.ink + '" stroke-width="1.3"/>';
    // x labels
    var maxLabels = Math.max(2, Math.floor(plotW / (small ? 18 : 22)));
    var step = Math.max(1, Math.ceil(n / maxLabels));
    var fs = small ? 11 : 12.5;
    // Regular labels every `step`; the target and the landed value always get one, and a
    // regular label too close to either is dropped.
    var minGap = small ? 15 : 19, labels = [];
    var px = function (v) { return padL + (v - lo + 0.5) * cw; };
    [spec.landed, T].forEach(function (v) { if (v != null && v >= lo && v <= hi && labels.every(function (u) { return Math.abs(px(u) - px(v)) >= minGap; })) labels.push(v); });
    for (x = lo; x <= hi; x += step) if (labels.every(function (u) { return Math.abs(px(u) - px(x)) >= minGap; })) labels.push(x);
    labels.forEach(function (v) {
      out += '<text x="' + f1(px(v)) + '" y="' + (base + (small ? 13 : 16)) + '" text-anchor="middle" font-size="' + fs + '" fill="' + C.ink + '"' + (v === spec.landed ? ' font-weight="600"' : '') + '>' + v + '</text>';
    });
    if (hi < d.max) out += '<text x="' + (w - padR) + '" y="' + (padT - 4) + '" text-anchor="end" font-size="11" font-style="italic" fill="' + C.soft + '">tail runs on to ' + d.max + '</text>';
    // target line. Its label sits right of the line, unless a landed value at or past the
    // target needs that space; then it moves to the left when there is room.
    var tlx = null, needW = 0, needLeft = false, needX = 0;
    if (T > lo && T <= hi) {
      tlx = padL + (T - lo) * cw;
      needW = textW('need ' + T + '+', 12.5);
      needLeft = spec.landed != null && spec.landed >= T && tlx - 4 - needW >= 0;
      needX = needLeft ? tlx - 4 : Math.min(w - needW - 2, tlx + 4);
      out += '<line x1="' + f1(tlx) + '" x2="' + f1(tlx) + '" y1="' + (padT - 8) + '" y2="' + (base + 2) + '" stroke="' + C.ink + '" stroke-width="1.3" stroke-dasharray="3 3"/>';
      if (!small) out += '<text x="' + f1(needX) + '" y="' + (padT - 8) + '"' + (needLeft ? ' text-anchor="end"' : '') + ' font-size="12.5" font-style="italic" fill="' + C.ink + '">need ' + T + '+</text>';
    }
    // tier bands under the axis: a non-colour signal for the four outcomes
    if (!small) {
      var by = base + 26;
      M.TIERS.forEach(function (tier) {
        var a = null, b = null;
        for (var v = lo; v <= hi; v++) if (M.tierOf(v, T) === tier && M.pAt(d, v) > 0) { if (a === null) a = v; b = v; }
        if (a === null) return;
        var x1 = padL + (a - lo) * cw + 2, x2 = padL + (b - lo + 1) * cw - 2, mid = (x1 + x2) / 2, colr = TIER_TEXT[tier];
        out += '<path d="M' + f1(x1) + ' ' + (by - 4) + ' L' + f1(x1) + ' ' + by + ' L' + f1(x2) + ' ' + by + ' L' + f1(x2) + ' ' + (by - 4) + '" fill="none" stroke="' + colr + '" stroke-width="1.2"' + (tier === 'disaster' || tier === 'fail' ? ' stroke-dasharray="' + (tier === 'disaster' ? '1 2' : '4 2') + '"' : '') + '/>';
        var word = tier;
        if (x2 - x1 >= word.length * 6.4) out += '<text x="' + f1(mid) + '" y="' + (by + 13) + '" text-anchor="middle" font-size="12" fill="' + colr + '"' + (tier === 'strong' || tier === 'disaster' ? ' font-weight="600"' : '') + '>' + word + '</text>';
      });
    }
    // the landed value
    if (spec.landed != null && spec.landed >= lo && spec.landed <= hi) {
      var L = spec.landed, lcx = padL + (L - lo + 0.5) * cw;
      var lp = M.pAt(d, L), top;
      if (tally) top = tallyTop(d.ways[L - d.min]);
      else top = base - Math.max(1.2, lp / yMax * plotH);
      // The ring stays inside the chart and clears the axis numerals below the baseline.
      var rx = Math.max(3.5, Math.min(Math.max(7, cw * 0.62), (w - 1 - lcx) / 1.3, (lcx - 1) / 1.25));
      var ry = (base - top) / 2 + 6, cy = (base + top) / 2 - 3;
      var k = spec.landedSeed || 1;
      out += '<path class="dv-ring" pathLength="100" d="M' + f1(lcx + rx * 0.3) + ' ' + f1(cy - ry) + ' C ' + f1(lcx + rx * 1.3) + ' ' + f1(cy - ry + jit(k, 2)) + ', ' + f1(lcx + rx * 1.15) + ' ' + f1(cy + ry * 1.05) + ', ' + f1(lcx) + ' ' + f1(cy + ry) +
        ' C ' + f1(lcx - rx * 1.25) + ' ' + f1(cy + ry) + ', ' + f1(lcx - rx * 1.2) + ' ' + f1(cy - ry * 1.1) + ', ' + f1(lcx + rx * 0.55) + ' ' + f1(cy - ry - 2) + '" fill="none" stroke="' + C.ink + '" stroke-width="2" stroke-linecap="round"' +
        (spec.ringDash != null ? ' stroke-dasharray="100" stroke-dashoffset="' + spec.ringDash + '"' : '') + '/>';
      var ly = small ? Math.max(11, cy - ry - 3) : Math.max(12, top - 14 - (M.tierOf(L, T) === 'strong' ? 10 : 0));
      var lt = small ? String(L) : 'landed ' + L, lw = textW(lt, small ? 11.5 : 13);
      // left edge of the label, kept on the chart
      var lx0 = Math.max(1, Math.min(w - lw - 1, lcx - lw / 2));
      // on a small chart with no room above the ring, set the numeral beside the ring instead
      if (small && cy - ry - 3 < 11) lx0 = lcx > w / 2 ? Math.max(1, lcx - rx * 1.3 - 3 - lw) : Math.min(w - lw - 1, lcx + rx * 1.3 + 3);
      if (!small && tlx != null) {
        // keep to the landed value's own side of the target line, and near the top clear of
        // the line's label too
        if (L < T) lx0 = Math.max(1, Math.min(lx0, tlx - 4 - lw));
        else {
          lx0 = Math.max(lx0, tlx + 4);
          if (!needLeft && ly < padT + 10) lx0 = Math.max(lx0, needX + needW + 6);
          lx0 = Math.min(w - lw - 1, lx0);
        }
      }
      out += '<text x="' + f1(lx0) + '" y="' + f1(ly) + '" font-size="' + (small ? 11.5 : 13) + '" font-weight="600" fill="' + C.ink + '">' + lt + '</text>';
    }
    return { svg: out, tally: tally };
  }
  // Rough width of Spectral text, for keeping labels apart (about 0.52 em a character).
  function textW(t, fs) { return String(t).length * fs * 0.52; }
  function starMark(x, y, col) {
    var s = '';
    for (var i = 0; i < 3; i++) {
      var a = i * Math.PI / 3;
      s += '<line x1="' + f1(x - 3.6 * Math.cos(a)) + '" y1="' + f1(y - 3.6 * Math.sin(a)) + '" x2="' + f1(x + 3.6 * Math.cos(a)) + '" y2="' + f1(y + 3.6 * Math.sin(a)) + '" stroke="' + col + '" stroke-width="1.3"/>';
    }
    return s;
  }
  function sizeOf(el) { var r = el.getBoundingClientRect(); return { w: Math.max(120, Math.round(r.width)), h: Math.max(80, Math.round(r.height)) }; }
  function drawChart(svg, spec) {
    var sz = sizeOf(svg);
    spec.w = sz.w; spec.h = sz.h; spec.id = svg.id;
    svg.setAttribute('viewBox', '0 0 ' + sz.w + ' ' + sz.h);
    var r = chartMarkup(spec);
    svg.innerHTML = r.svg;
    return r;
  }
  function chartDesc(e, d, target, landed) {
    var mode = d.p.indexOf(Math.max.apply(null, d.p)) + d.min;
    var o = M.checkOdds(e, target);
    var s = 'Chart of ' + M.label(e) + ': totals from ' + d.min + ' to ' + d.max + ', most often ' + mode + '. Needing ' + target + ' or more passes ' + M.fmtPct(o.pass) + ' of the time.';
    if (landed != null) s += ' This roll landed on ' + landed + '.';
    return s;
  }

  // ================================================================= the map
  // A sketch of the rooms found so far. Levels run left to right, deeper to the right.
  function wobRect(x, y, w, h, k) {
    var p = [[x + jit(k, 1.2), y + jit(k + 1, 1.2)], [x + w + jit(k + 2, 1.2), y + jit(k + 3, 1.2)], [x + w + jit(k + 4, 1.2), y + h + jit(k + 5, 1.2)], [x + jit(k + 6, 1.2), y + h + jit(k + 7, 1.2)]];
    var s = 'M' + f1(p[0][0]) + ' ' + f1(p[0][1]);
    for (var i = 1; i <= 4; i++) {
      var a = p[i - 1], b = p[i % 4];
      s += ' Q ' + f1((a[0] + b[0]) / 2 + jit(k + 9 + i, 1.4)) + ' ' + f1((a[1] + b[1]) / 2 + jit(k + 13 + i, 1.4)) + ' ' + f1(b[0]) + ' ' + f1(b[1]);
    }
    return s;
  }
  function wobLine(x1, y1, x2, y2, k) {
    var mx = (x1 + x2) / 2 + jit(k, 2.5), my = (y1 + y2) / 2 + jit(k + 1, 2.5);
    return 'M' + f1(x1) + ' ' + f1(y1) + ' Q ' + f1(mx) + ' ' + f1(my) + ' ' + f1(x2) + ' ' + f1(y2);
  }
  // opts: { visited:[ids], current:id, doors: bool, w, h, newRoom:id, newOpacity, corridorDash, label: bool, preview }
  function mapMarkup(dg, opts) {
    var w = opts.w, h = opts.h, L = opts.levels || dg.levels.length, vert = !!opts.vertical;
    var small = w < 420;
    var rw = small ? 24 : 32, rh = small ? 18 : 23;
    var padX = rw / 2 + (small ? 10 : 16), padY = rh / 2 + 6;
    var gap = Math.min(small ? 40 : 52, (h - (opts.label ? 44 : 28)) / 2);
    var midY = opts.label ? h / 2 - 6 : h / 2;
    function pos(id) {
      var r = dg.rooms[id];
      if (vert) return { x: w / 2 + (r.row - (r.rows - 1) / 2) * (rw + 16), y: padY + r.level * (h - 2 * padY) / (L - 1) };
      return { x: padX + r.level * (w - 2 * padX) / (L - 1), y: midY + (r.row - (r.rows - 1) / 2) * gap };
    }
    // corridor ends: from the deeper-facing side of one room to the near side of the next
    function ends(a, b) {
      return vert ? [a.x, a.y + rh / 2, b.x, b.y - rh / 2] : [a.x + rw / 2, a.y, b.x - rw / 2, b.y];
    }
    var vis = opts.visited, seen = {}, out = '';
    vis.forEach(function (id) { seen[id] = true; });
    // frame and title
    if (!opts.preview) {
      out += '<path d="' + wobRect(3, 3, w - 6, h - 6, 900) + '" fill="none" stroke="' + C.ink + '" stroke-opacity="0.35" stroke-width="1"/>';
      out += '<text x="12" y="20" font-size="12.5" font-family="Spectral SC, Spectral, serif" font-weight="600" letter-spacing="0.6" fill="' + C.soft + '">sketch map</text>';
      out += compass(w - 22, 24);
    }
    // corridors walked
    for (var i = 1; i < vis.length; i++) {
      var a = pos(vis[i - 1]), b = pos(vis[i]);
      var isNew = opts.newRoom === vis[i] && i === vis.length - 1;
      var en = ends(a, b);
      out += '<path d="' + wobLine(en[0], en[1], en[2], en[3], vis[i] * 17) + '" fill="none" stroke="' + C.ink + '" stroke-width="1.6" stroke-linecap="round"' +
        (isNew && opts.corridorDash != null ? ' pathLength="100" stroke-dasharray="100" stroke-dashoffset="' + opts.corridorDash + '"' : '') + '/>';
    }
    // doors from the current room: dashed, ending in a question mark
    if (opts.doors) {
      var cur = pos(opts.current);
      dg.rooms[opts.current].doors.forEach(function (to, k) {
        var p = pos(to);
        out += '<path d="' + wobLine(cur.x + rw / 2, cur.y, p.x - 9, p.y, to * 29 + k) + '" fill="none" stroke="' + C.ink + '" stroke-width="1.3" stroke-dasharray="3 4" stroke-linecap="round"/>';
        out += '<circle cx="' + f1(p.x) + '" cy="' + f1(p.y) + '" r="9" fill="' + C.parch + '" stroke="' + C.ink + '" stroke-width="1.1" stroke-dasharray="2 2"/>';
        out += '<text x="' + f1(p.x) + '" y="' + f1(p.y + 4.5) + '" text-anchor="middle" font-size="13" fill="' + C.ink + '">?</text>';
      });
    }
    // rooms
    vis.forEach(function (id, order) {
      if (vis.indexOf(id) !== order) return;
      var p = pos(id), isCur = id === opts.current, sit = M.situation(dg.rooms[id].sit);
      var op = opts.newRoom === id && opts.newOpacity != null ? opts.newOpacity : 1;
      out += '<g opacity="' + op + '">';
      out += '<path d="' + wobRect(p.x - rw / 2, p.y - rh / 2, rw, rh, id * 41 + 3) + '" fill="' + (sit.final ? '#f6ecd0' : C.parch) + '" stroke="' + C.ink + '" stroke-width="' + (isCur ? 2.2 : 1.5) + '"/>';
      if (isCur) out += '<path d="' + wobRect(p.x - rw / 2 - 4, p.y - rh / 2 - 4, rw + 8, rh + 8, id * 43 + 5) + '" fill="none" stroke="' + C.ink + '" stroke-width="1" stroke-dasharray="2 2.5"/>';
      out += roomGlyph(sit.id, p.x, p.y, small);
      out += '</g>';
    });
    if (opts.label && opts.current != null) {
      var cp = pos(opts.current), nm = M.situation(dg.rooms[opts.current].sit).name;
      var anc = cp.x < 70 ? 'start' : cp.x > w - 70 ? 'end' : 'middle';
      var lx = anc === 'start' ? cp.x - rw / 2 : anc === 'end' ? cp.x + rw / 2 : cp.x;
      out += '<text x="' + f1(lx) + '" y="' + f1(Math.min(h - 8, cp.y + rh / 2 + 18)) + '" text-anchor="' + anc + '" font-size="' + (small ? 12 : 13.5) + '" font-style="italic" fill="' + C.ink + '">' + esc(nm) + '</text>';
    }
    return out;
  }
  function compass(x, y) {
    return '<g stroke="' + C.ink + '" stroke-width="1" fill="none" opacity="0.7"><line x1="' + x + '" y1="' + (y - 11) + '" x2="' + x + '" y2="' + (y + 11) + '"/><line x1="' + (x - 11) + '" y1="' + y + '" x2="' + (x + 11) + '" y2="' + y + '"/>' +
      '<path d="M' + x + ' ' + (y - 11) + ' L' + (x + 3) + ' ' + (y - 3) + ' L' + (x - 3) + ' ' + (y - 3) + ' Z" fill="' + C.ink + '"/></g>' +
      '<text x="' + x + '" y="' + (y + 24) + '" text-anchor="middle" font-size="11" fill="' + C.soft + '">deeper →</text>';
  }
  // A small inked mark for each kind of room, so the map reads as a journal sketch.
  function roomGlyph(kind, x, y, small) {
    var s = small ? 0.8 : 1, st = 'stroke="' + C.ink + '" stroke-width="1.2" fill="none" stroke-linecap="round"';
    var g = '<g transform="translate(' + f1(x) + ' ' + f1(y) + ') scale(' + s + ')">';
    switch (kind) {
      case 'gate': g += '<path d="M-7 7 V-3 Q0 -10 7 -3 V7 M-3.5 7 V-5 M0 7 V-6.5 M3.5 7 V-5" ' + st + '/>'; break;
      case 'warden': g += '<path d="M0 -8 L2.5 -3 L1.2 6 H-1.2 L-2.5 -3 Z M-5 6 H5" ' + st + '/><circle cx="0" cy="-3" r="1.4" fill="' + C.ink + '"/>'; break;
      case 'hound': g += '<path d="M-8 4 Q-4 -4 3 -1 Q7 -4 8 1 Q6 5 -8 4 Z M5 -2 L6 -5" ' + st + '/>'; break;
      case 'bridge': g += '<path d="M-9 -3 Q0 5 9 -3 M-9 1 Q0 9 9 1 M-5 0 V4 M0 1 V5 M5 0 V4" ' + st + '/>'; break;
      case 'face': g += '<circle cx="0" cy="0" r="6.5" ' + st + '/><path d="M-3 -1.5 H-1 M1 -1.5 H3 M-2.5 3 Q0 4.5 2.5 3" ' + st + '/>'; break;
      case 'water': g += '<path d="M-9 -2 Q-6 -5 -3 -2 T3 -2 T9 -2 M-9 3 Q-6 0 -3 3 T3 3 T9 3" ' + st + '/>'; break;
      case 'rubble': g += '<path d="M-8 6 L-5 0 L-1 6 Z M-1 6 L3 -2 L8 6 M-4 -6 L-1 -3" ' + st + '/>'; break;
      case 'tiles': g += '<path d="M-8 -6 H8 V6 H-8 Z M-8 0 H8 M-3 -6 V6 M3 -6 V6" ' + st + '/><rect x="-8" y="-6" width="5" height="6" fill="' + C.ink + '" opacity="0.5"/><rect x="3" y="0" width="5" height="6" fill="' + C.ink + '" opacity="0.5"/>'; break;
      case 'crow': g += '<path d="M-7 3 Q-2 -6 6 -2 L9 -3 L6 0 Q2 5 -7 3 Z M-1 3 L-2 7 M2 3 L2 7" ' + st + '/>'; break;
      case 'shaft': g += '<path d="M-4 -8 V8 M4 -8 V8 M-4 -4 H4 M-4 0 H4 M-4 4 H4" ' + st + '/>'; break;
      case 'mirrors': g += '<path d="M-7 -6 H-1 V6 H-7 Z M1 -6 H7 V6 H1 Z M-5 -3 L-3 -1 M3 -3 L5 -1" ' + st + '/>'; break;
      case 'spores': g += '<path d="M-6 6 V1 M0 6 V-1 M6 6 V2" ' + st + '/><path d="M-9 1 Q-6 -4 -3 1 Z M-3 -1 Q0 -7 3 -1 Z M3 2 Q6 -3 9 2 Z" ' + st + '/>'; break;
      case 'webs': g += '<path d="M-8 -6 L8 6 M8 -6 L-8 6 M0 -8 V8 M-5 -4 Q0 -2 5 -4 M-6 3 Q0 1 6 3" ' + st + '/>'; break;
    }
    return g + '</g>';
  }

  // ================================================================= state
  var S = null;
  var ui = {
    tab: 'check', sel: 0, view: null, busy: false,
    oracleMode: 'free', lk: 'even', lastOracle: null,
    cmp: { a: { text: '2d6', need: 7, landed: null, rolled: null }, b: { text: 'd12', need: 6, landed: null, rolled: null } },
    luck: null
  };
  var sandboxRng = new M.Rng((Date.now() ^ 0x2545f491) >>> 0);

  function newSeed() {
    var a = new Uint32Array(1);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(a); else a[0] = Math.floor(Math.random() * 4294967296);
    return 1 + (a[0] % 99998);
  }
  function freshDice() {
    var a = new Uint32Array(1);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(a); else a[0] = Math.floor(Math.random() * 4294967296);
    return a[0];
  }
  // A new expedition draws a new map; "same map again" keeps the map and draws fresh dice.
  function start(seed, again) {
    S = M.newRun(seed, freshDice());
    ui.sel = 0; ui.view = null; ui.busy = false; ui.oracleMode = 'free'; ui.lastOracle = null; ui.luck = null; ui.again = !!again;
    selectApproach(0, true);
    setTab('check', true);
    renderAll();
    announce('Expedition ' + S.seed + (again ? ' again, with fresh dice. ' : '. ') + M.currentSit(S).name + '.');
  }

  function effOf(i) { var ap = M.currentSit(S).approaches[i]; return { ap: ap, eff: M.effective(S, ap) }; }
  function selectApproach(i, quiet) {
    var x = effOf(i);
    ui.sel = i;
    ui.view = { expr: x.eff.expr, target: x.ap.target, notes: x.eff.notes, landed: null, result: null, dice: null };
    if (!quiet) { renderApproaches(); renderCheck(); }
  }

  // ================================================================= rendering
  function renderAll() {
    renderHead(); renderMap(); renderRoom(); renderCheck(); renderOracle(); renderCompare(); renderNext(); renderLog();
  }

  function pips(n, max, torch) {
    var s = '<span class="dv-pips" aria-hidden="true">';
    for (var i = 0; i < max; i++) s += '<span class="dv-pip' + (i < n ? ' is-full' : '') + (torch ? ' is-torch' : '') + (n <= 1 && i < Math.max(1, n) ? ' is-low' : '') + '"></span>';
    return s + '</span>';
  }
  function renderHead() {
    $('dv-seed').textContent = 'no. ' + S.seed;
    $('dv-health').innerHTML = pips(S.health, M.START.maxHealth) + '<span class="dv-count">' + S.health + ' of ' + M.START.maxHealth + '</span>';
    $('dv-torches').innerHTML = pips(S.torches, M.START.maxTorches, true) + '<span class="dv-count">' + (S.torches ? S.torches + ' left' : 'none: dark') + '</span>';
    $('dv-boon-wrap').hidden = !S.boon;
    $('dv-boon').textContent = '+' + S.boon + ' on the next check';
  }

  function renderMap() {
    var svg = $('dv-map'), sz = sizeOf(svg);
    svg.setAttribute('viewBox', '0 0 ' + sz.w + ' ' + sz.h);
    svg.innerHTML = mapMarkup(S.dungeon, { visited: S.visited, current: S.room, doors: S.phase === 'after', w: sz.w, h: sz.h, label: true });
    var nd = S.phase === 'after' ? M.doors(S).length : 0;
    $('dv-map-desc').textContent = 'Sketch map. You have found ' + S.visited.length + (S.visited.length === 1 ? ' room' : ' rooms') + ' and are in ' + M.currentSit(S).name + '.' +
      (nd ? ' ' + (nd === 1 ? 'One way leads' : nd + ' ways lead') + ' deeper.' : '');
  }

  function renderRoom() {
    var sit = M.currentSit(S), end = S.phase === 'end';
    $('dv-room-name').textContent = end ? (S.outcome === 'won' ? 'Out with the lamp' : 'The journal ends here') : sit.name;
    $('dv-sit').textContent = end ? '' : sit.text;
    $('dv-sit').hidden = end;
    $('dv-approaches').hidden = end;
    $('dv-end').hidden = !end;
    var help = [];
    if (!end) {
      if (S.room === 0 && S.phase === 'room' && S.log.length === 0) help.push('Health and torches are all you carry. Pick an approach to see its odds, then roll.' + (ui.again ? ' Same map as before; the dice are fresh.' : ''));
      if (S.phase === 'room') {
        var odds = sit.approaches.map(function (ap, i) { var x = effOf(i); return M.checkOdds(x.eff.expr, ap.target).pass; });
        var same = false;
        for (var i = 0; i < odds.length; i++) for (var j = i + 1; j < odds.length; j++) if (Math.abs(odds[i] - odds[j]) < 1e-12) same = true;
        if (same) help.push('Some approaches here pass exactly as often as each other. Their charts still differ at the ends: compare the disasters and the strong results.');
        if (M.dark(S)) help.push('No torches left. A d20 loses a step (advantage becomes a plain roll, a plain roll becomes disadvantage); other dice take one off. With no torch to burn, careful failures cost health.');
        if (S.boon) help.push('Your boon adds to the next check, then it is spent.');
      }
    }
    $('dv-room-help').textContent = help.join(' ');
    if (!end) renderApproaches(); else renderEnd();
  }

  function renderApproaches() {
    var sit = M.currentSit(S), box = $('dv-approaches'), html = '';
    var canRoll = S.phase === 'room' && !ui.busy;
    sit.approaches.forEach(function (ap, i) {
      var x = effOf(i), o = M.checkOdds(x.eff.expr, ap.target);
      html += '<button type="button" class="dv-ap" data-i="' + i + '" aria-pressed="' + (ui.sel === i) + '"' + (canRoll ? '' : ' disabled') + '>' +
        '<span class="dv-ap-style">' + STYLE_NAME[ap.style] + '</span>' +
        '<span class="dv-ap-text">' + esc(ap.text) + '</span>' +
        '<span class="dv-ap-pass">' + M.fmtPct(o.pass) + '</span>' +
        '<span class="dv-ap-dice">' + esc(M.label(x.eff.expr)) + ', need ' + ap.target + '+' + (x.eff.notes.length ? ' <i>(' + esc(x.eff.notes.join('; ')) + ')</i>' : '') + '</span>' +
        '<span class="dv-ap-cost">' + esc(M.costText(S, ap.style)) + '</span>' +
        '</button>';
    });
    box.innerHTML = html;
  }

  function lessonFor(e, tallied, d) {
    var L = [];
    if (M.isAdv(e)) L.push('Advantage: roll two, keep the higher. It helps most when you need a middling number.');
    else if (M.isDis(e)) L.push('Disadvantage: roll two, keep the lower. Low totals become common.');
    else if (e.keep === 'h') L.push('Roll extra dice and keep the best: the low end is squeezed out.');
    else if (e.keep === 'l') L.push('Roll extra dice and keep the worst: the high end is squeezed out.');
    else if (e.n === 1 && !e.explode) L.push('One die: every face is equally likely, so the chart is flat and the ends are as common as the middle.');
    else if (!e.explode) L.push('Dice that add up pile into the middle: there are more ways to make a middling total than an extreme one.');
    if (e.explode) L.push('A top face rolls again and adds (at most ' + M.NUMWORD[M.EXPLODE_CAP] + ' times a die), so the chart grows a long, thin tail to the right.');
    if (e.mod) L.push('Adding or taking off a number slides the whole chart along without changing its shape.');
    if (tallied) L.push('Each tally mark is one of the ' + M.fmtNum(d.total) + ' equally likely ways the dice can fall.');
    return L.join(' ');
  }

  function legendHTML(o) {
    return M.TIERS.map(function (t) {
      return '<li><span class="dv-sw t-' + t + '" aria-hidden="true"></span><span class="dv-t-' + t + '">' + M.TIER_LABEL[t] + '</span> <b>' + M.fmtPct(o[t]) + '</b></li>';
    }).join('');
  }

  function renderCheck(tumble) {
    var v = ui.view;
    if (!v) return;
    var e = v.expr, d = M.dist(e), o = M.checkOdds(e, v.target);
    $('dv-c-label').textContent = M.label(e);
    $('dv-c-words').textContent = '— ' + M.words(e) + (v.notes && v.notes.length ? ' (' + v.notes.join('; ') + ')' : '') + '.';
    $('dv-c-pass').textContent = M.fmtPct(o.pass);
    $('dv-c-passnote').textContent = 'to pass, needing ' + v.target + ' or more' + (o.passWays != null && o.total <= 100000 ? ' (' + M.fmtWays(o.passWays, o.total) + ')' : '');
    // dice tray
    var tray = '';
    if (v.dice) {
      v.dice.forEach(function (dd) {
        tray += dieSVG(e.m, dd.faces[0], (dd.kept ? '' : 'is-dropped') + (tumble ? ' is-tumbling' : ''));
        for (var k = 1; k < dd.faces.length; k++) tray += '<span class="dv-plus">+</span>' + dieSVG(e.m, dd.faces[k], 'is-extra' + (dd.kept ? '' : ' is-dropped') + (tumble ? ' is-tumbling' : ''));
      });
      if (e.mod) tray += '<span class="dv-plus">' + (e.mod > 0 ? '+' : '−') + Math.abs(e.mod) + '</span>';
    } else {
      for (var i = 0; i < e.n; i++) tray += dieSVG(e.m, '');
    }
    $('dv-tray').innerHTML = tray;
    var r = drawChart($('dv-c-chart'), { d: d, target: v.target, landed: tumble ? null : v.landed, tally: true, range: showRange(d), landedSeed: S.steps });
    $('dv-c-chart-desc').textContent = chartDesc(e, d, v.target, tumble ? null : v.landed);
    $('dv-c-legend').innerHTML = legendHTML(o);
    $('dv-c-lesson').textContent = lessonFor(e, r.tally, d) + ' Strong: beat the target by ' + M.STRONG + ' or more. Disaster: miss it by ' + M.DISASTER + ' or more.';
    var btn = $('dv-roll');
    var canRoll = S.phase === 'room' && !ui.busy;
    btn.disabled = !canRoll;
    btn.textContent = canRoll ? (v.result && !v.passed ? 'Roll again' : 'Roll ' + M.label(e)) : ui.busy ? 'Rolling' : 'Rolled';
    $('dv-c-result').innerHTML = v.result && !tumble ? v.result : '';
  }

  function resultHTML(res) {
    var d = M.dist(res.expr), ge = M.pAtLeast(d, res.total), score = M.midRank(d, res.total);
    var word = { strong: 'strong success', success: 'success', fail: 'fail', disaster: 'disaster' }[res.tier];
    var s = '<strong class="dv-t-' + res.tier + '">Rolled ' + res.total + ': ' + word + '.</strong> ';
    s += 'A total this high or higher comes up ' + M.fmtPct(ge) + ' of the time; its luck score is ' + score.toFixed(2) + ' of a possible one.';
    var c = M.changeText(res.change);
    if (c) s += ' You ' + c.replace(/^a torch burnt out/, 'burnt a torch').replace(/, a torch burnt out/, ', burnt a torch') + '.';
    if (res.phase === 'room') s += ' The warden still stands: try again.';
    return s;
  }

  // ---------------------------------------------------------------- oracle
  function renderOracle() {
    var search = ui.oracleMode === 'search';
    var lk = search ? M.currentSit(S).search : ui.lk;
    var sit = M.currentSit(S);
    $('dv-o-mode').textContent = search
      ? 'Searching asks the oracle one question, and the room sets the odds: ' + { unlikely: 'a yes is unlikely here.', even: 'yes and no are equally likely here.', likely: 'a yes is likely here.' }[lk]
      : 'Ask anything about the story. Choose how likely a yes seems; the oracle rolls one d20. Its answer is yours to interpret.';
    var q = $('dv-q');
    q.readOnly = search;
    if (search) q.value = M.SEARCH_QUESTION;
    else if (q.value === M.SEARCH_QUESTION) q.value = '';
    q.placeholder = S.phase === 'end' ? 'Will I come back?' : 'Is ' + sit.name.replace(/^The /, 'the ') + ' as quiet as it looks?';
    var lkHtml = '';
    Object.keys(M.LIKELIHOODS).forEach(function (k) {
      lkHtml += '<button type="button" class="dv-key dv-lk" data-lk="' + k + '" aria-pressed="' + (k === lk) + '"' + (search ? ' disabled' : '') + '>' + M.LIKELIHOODS[k].label + '</button>';
    });
    $('dv-likely').innerHTML = lkHtml;
    var landed = ui.lastOracle && ui.lastOracle.likelihood === lk ? ui.lastOracle : null;
    drawStrip($('dv-o-strip'), lk, landed ? landed.face : null);
    var bands = M.oracleBands(lk), yes = M.oracleYes(lk);
    $('dv-o-strip-desc').textContent = 'The oracle die, faces one to twenty. ' + M.LIKELIHOODS[lk].label + ': yes on ' + M.LIKELIHOODS[lk].line + ' or more, ' + M.fmtPct(yes) + '.' + (landed ? ' It rolled ' + landed.face + '.' : '');
    $('dv-o-bands').innerHTML = bands.map(function (b) {
      var fx = search ? searchEffect(b.key) : '';
      return '<li' + (landed && landed.answer === b.key ? ' class="is-landed"' : '') + '><span class="dv-sw o-' + b.key + '" aria-hidden="true"></span><span><b>' + b.label + '</b> ' + M.fmtPct(b.p) +
        ' <small>(' + (b.lo === b.hi ? 'face ' + b.lo : b.lo + '–' + b.hi) + ')</small>' + (fx ? '<br><small><i>' + fx + '</i></small>' : '') + '</span></li>';
    }).join('');
    $('dv-o-lesson').textContent = 'The “but” answers sit on the faces either side of the line: the answers that nearly went the other way, so they come with a twist. “And” needs the top or bottom face.';
    var ask = $('dv-ask');
    ask.textContent = search ? 'Search: roll the oracle' : 'Ask the oracle';
    ask.disabled = ui.busy || S.phase === 'end';
    $('dv-o-result').innerHTML = ui.lastOracle && ui.lastOracle.html ? ui.lastOracle.html : '';
  }
  function searchEffect(key) {
    var fx = M.SEARCH_EFFECT[key], a = [];
    if (fx.torch) a.push('a torch');
    if (fx.health) a.push('a salve, +' + fx.health + ' health');
    if (fx.boon) a.push('a clue, +' + fx.boon + ' on the next check');
    var s = a.length ? 'you find ' + a.join(' and ') : 'nothing';
    if (fx.torchLoss) s += (a.length ? ', but' : ', and') + ' a torch burns out';
    return s;
  }
  function drawStrip(svg, lk, face) {
    var sz = sizeOf(svg), w = sz.w, h = sz.h, n = M.ORACLE_DIE;
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    var cw = (w - 4) / n, top = 22, ch = 26, out = patternDefs(svg.id);
    var Lline = M.LIKELIHOODS[lk].line;
    for (var f = 1; f <= n; f++) {
      var a = M.oracleAnswer(f, lk), x = 2 + (f - 1) * cw, yes = a.indexOf('yes') === 0, col = yes ? C.verd : C.blood;
      var fill = a === 'yes-and' ? C.verd : a === 'no-and' ? C.blood : a === 'yes' ? 'rgba(63,122,104,0.32)' : a === 'no' ? 'url(#' + svg.id + '-fail)' : C.ledger;
      out += '<rect x="' + f1(x + 1) + '" y="' + top + '" width="' + f1(cw - 2) + '" height="' + ch + '" fill="' + fill + '" stroke="' + col + '" stroke-width="1.2"' + (a.indexOf('but') > 0 ? ' stroke-dasharray="3 2"' : '') + '/>';
      // face numbers sit under the cells, on plain paper, so the patterns never cover them
      if (cw >= 16 || f % 2 === 1 || f === face || f === Lline || f === n)
        out += '<text x="' + f1(x + cw / 2) + '" y="' + (top + ch + 15) + '" text-anchor="middle" font-size="' + (cw < 16 ? 11 : 12.5) + '" fill="' + C.ink + '"' + (f === face ? ' font-weight="600"' : '') + '>' + f + '</text>';
    }
    var lx = 2 + (Lline - 1) * cw;
    out += '<line x1="' + f1(lx) + '" x2="' + f1(lx) + '" y1="' + (top - 8) + '" y2="' + (top + ch + 6) + '" stroke="' + C.ink + '" stroke-width="2"/>';
    out += '<text x="' + f1(lx - 4) + '" y="' + (top - 9) + '" text-anchor="end" font-size="12.5" font-style="italic" fill="' + C.blood + '">no</text>';
    out += '<text x="' + f1(lx + 4) + '" y="' + (top - 9) + '" font-size="12.5" font-style="italic" fill="' + C.verdInk + '">yes from ' + Lline + '</text>';
    if (face != null) {
      var fx = 2 + (face - 0.5) * cw;
      out += '<ellipse cx="' + f1(fx) + '" cy="' + (top + ch / 2 + 7) + '" rx="' + f1(cw / 2 + 3) + '" ry="' + (ch / 2 + 14) + '" fill="none" stroke="' + C.ink + '" stroke-width="2" transform="rotate(-5 ' + f1(fx) + ' ' + (top + ch / 2 + 7) + ')"/>';
      out += '<text x="' + f1(Math.max(30, Math.min(w - 30, fx))) + '" y="' + (top + ch + 40) + '" text-anchor="middle" font-size="13" font-weight="600" fill="' + C.ink + '">' + M.ANSWER_LABEL[M.oracleAnswer(face, lk)] + '</text>';
    }
    svg.innerHTML = out;
  }

  // ---------------------------------------------------------------- compare
  var PRESETS = ['2d6', 'd12', 'd20', 'd20 adv', 'd20 dis', '3d6', '4d6k3', 'd6!', '2d6+1'];
  function buildCompare() {
    $('dv-k-help').textContent = 'Type dice like 2d6, d20 adv, 4d6k3 (four dice, keep the best three), d6! (a six rolls again, at most ' + M.NUMWORD[M.EXPLODE_CAP] + ' times) or 3d6+2, and the total you need. Both charts share one scale.';
    ['a', 'b'].forEach(function (k) {
      var side = $('dv-side-' + k), up = k.toUpperCase();
      side.innerHTML = '<div class="dv-side-head">' +
        '<label for="dv-' + k + '-expr">Dice ' + up + '<input class="dv-input" id="dv-' + k + '-expr" type="text" autocomplete="off" spellcheck="false" aria-describedby="dv-' + k + '-err"></label>' +
        '<label for="dv-' + k + '-need">Need<input class="dv-input dv-need" id="dv-' + k + '-need" type="number" inputmode="numeric" step="1"></label></div>' +
        '<div class="dv-presets" role="group" aria-label="Examples for dice ' + up + '">' + PRESETS.map(function (p) { return '<button type="button" class="dv-chip" data-side="' + k + '" data-preset="' + esc(p) + '">' + esc(p) + '</button>'; }).join('') + '</div>' +
        '<p class="dv-err" id="dv-' + k + '-err" role="alert"></p>' +
        '<p class="dv-chance"><span class="dv-big" id="dv-' + k + '-pass"></span> <span id="dv-' + k + '-note"></span></p>' +
        '<svg class="dv-chart" id="dv-' + k + '-chart" role="img" aria-labelledby="dv-' + k + '-desc"></svg><p class="dv-sr" id="dv-' + k + '-desc"></p>' +
        '<ul class="dv-legend" id="dv-' + k + '-legend"></ul>' +
        '<button type="button" class="dv-key" id="dv-' + k + '-roll">Roll ' + up + '</button>' +
        '<p class="dv-side-res" id="dv-' + k + '-res" aria-live="polite"></p>';
      $('dv-' + k + '-expr').value = ui.cmp[k].text;
      $('dv-' + k + '-need').value = ui.cmp[k].need;
      $('dv-' + k + '-expr').addEventListener('input', function () { ui.cmp[k].text = this.value; ui.cmp[k].landed = null; renderCompare(); });
      $('dv-' + k + '-need').addEventListener('input', function () { var v = parseInt(this.value, 10); if (isFinite(v)) { ui.cmp[k].need = Math.max(-99, Math.min(999, v)); ui.cmp[k].landed = null; renderCompare(); } });
      $('dv-' + k + '-roll').addEventListener('click', function () {
        var p = M.parse(ui.cmp[k].text); if (!p.ok) return;
        var r = M.roll(p.expr, sandboxRng);
        ui.cmp[k].landed = r.total; ui.cmp[k].rolled = r;
        renderCompare();
      });
    });
    $('dv-p-compare').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-preset]'); if (!b) return;
      var k = b.getAttribute('data-side');
      ui.cmp[k].text = b.getAttribute('data-preset'); ui.cmp[k].landed = null;
      $('dv-' + k + '-expr').value = ui.cmp[k].text;
      renderCompare();
    });
  }
  function renderCompare() {
    if (ui.tab !== 'compare') return;
    var parsed = {}, range = null, yMax = 0;
    ['a', 'b'].forEach(function (k) {
      var p = M.parse(ui.cmp[k].text);
      $('dv-' + k + '-err').textContent = p.ok ? '' : p.error;
      $('dv-' + k + '-roll').disabled = !p.ok;
      if (!p.ok) return;
      var d = M.dist(p.expr), r = showRange(d);
      parsed[k] = { e: p.expr, d: d };
      range = range ? { lo: Math.min(range.lo, r.lo), hi: Math.max(range.hi, r.hi) } : r;
      for (var x = d.min; x <= d.max; x++) yMax = Math.max(yMax, M.pAt(d, x));
    });
    ['a', 'b'].forEach(function (k) {
      var P = parsed[k], c = ui.cmp[k];
      if (!P) { $('dv-' + k + '-chart').innerHTML = ''; $('dv-' + k + '-pass').textContent = ''; $('dv-' + k + '-note').textContent = ''; $('dv-' + k + '-legend').innerHTML = ''; $('dv-' + k + '-res').textContent = ''; return; }
      var o = M.checkOdds(P.e, c.need);
      $('dv-' + k + '-pass').textContent = M.fmtPct(o.pass);
      $('dv-' + k + '-note').textContent = 'to pass' + (o.passWays != null && o.total <= 100000 ? ' (' + M.fmtWays(o.passWays, o.total) + ')' : '') + ', average ' + P.d.mean.toFixed(1);
      drawChart($('dv-' + k + '-chart'), { d: P.d, target: c.need, landed: c.landed, range: range, yMax: yMax, tally: false, small: false, landedSeed: c.landed || 1 });
      $('dv-' + k + '-desc').textContent = chartDesc(P.e, P.d, c.need, c.landed);
      $('dv-' + k + '-legend').innerHTML = legendHTML(o);
      $('dv-' + k + '-res').innerHTML = c.landed == null ? '' : '<strong class="dv-t-' + M.tierOf(c.landed, c.need) + '">Rolled ' + c.landed + ': ' + M.TIER_LABEL[M.tierOf(c.landed, c.need)].toLowerCase() + '.</strong> ' +
        (c.rolled ? diceSummary(P.e, c.rolled) : '');
    });
    var v = '';
    if (parsed.a && parsed.b) {
      var oa = M.checkOdds(parsed.a.e, ui.cmp.a.need), ob = M.checkOdds(parsed.b.e, ui.cmp.b.need);
      if (Math.abs(oa.pass - ob.pass) < 1e-12) v = 'Same chance to pass, ' + M.fmtPct(oa.pass) + '. The shapes differ at the ends: strong results ' + M.fmtPct(oa.strong) + ' against ' + M.fmtPct(ob.strong) + ', disasters ' + M.fmtPct(oa.disaster) + ' against ' + M.fmtPct(ob.disaster) + '.';
      else v = (oa.pass > ob.pass ? 'A' : 'B') + ' passes more often: ' + M.fmtPct(Math.max(oa.pass, ob.pass)) + ' against ' + M.fmtPct(Math.min(oa.pass, ob.pass)) + '. Disasters: ' + M.fmtPct(oa.disaster) + ' for A, ' + M.fmtPct(ob.disaster) + ' for B.';
    }
    $('dv-k-verdict').textContent = v;
  }
  function diceSummary(e, r) {
    var parts = r.dice.map(function (d) { var t = d.faces.join('+'); return d.kept ? t : '(' + t + ' dropped)'; });
    return 'Dice: ' + parts.join(', ') + (e.mod ? (e.mod > 0 ? ' +' : ' −') + Math.abs(e.mod) : '') + '.';
  }

  // ---------------------------------------------------------------- next, doors, log, end
  function renderNext() {
    var box = $('dv-next');
    box.hidden = S.phase !== 'after';
    if (S.phase !== 'after') return;
    var html = '';
    if (M.canSearch(S)) html += '<button type="button" class="dv-key dv-door dv-search" id="dv-search">Search the room<small>ask the oracle: ' + M.LIKELIHOODS[M.currentSit(S).search].label.toLowerCase() + '</small></button>';
    var ds = M.doors(S).slice().sort(function (a, b) { return S.dungeon.rooms[a].row - S.dungeon.rooms[b].row; });
    var names = ds.length === 1 ? ['Go deeper'] : ds.length === 2 ? ['Upper passage', 'Lower passage'] : ['Upper passage', 'Middle passage', 'Lower passage'];
    ds.forEach(function (to, i) {
      var sit = M.situation(S.dungeon.rooms[to].sit);
      html += '<button type="button" class="dv-key dv-door" data-to="' + to + '">' + names[i] + '<small>' + esc(sit.hint) + '</small></button>';
    });
    $('dv-doors').innerHTML = html;
    var sh = M.currentSit(S).search && !S.searched[S.room];
    $('dv-next-help').textContent = (sh ? 'You may search once, or go on. ' : 'Choose a way on. ') + 'Each new room burns a torch.';
  }

  function renderLog() {
    var ol = $('dv-log');
    ol.innerHTML = S.log.map(function (en) {
      return '<li class="is-' + en.kind + '">' + esc(M.logText(en)) + '</li>';
    }).join('') || '<li>' + esc(M.situation('gate').name) + '. The expedition begins.</li>';
    ol.scrollTop = ol.scrollHeight;
  }

  function renderEnd() {
    var box = $('dv-end'), won = S.outcome === 'won';
    var rooms = S.visited.length, sit = M.currentSit(S);
    var html = '<p>' + (won
      ? 'You passed the warden and climbed out with the lamp, ' + S.health + ' health and ' + S.torches + (S.torches === 1 ? ' torch' : ' torches') + ' left, after ' + rooms + ' rooms.'
      : 'Your health ran out in ' + sit.name.replace(/^The /, 'the ') + ', ' + rooms + (rooms === 1 ? ' room' : ' rooms') + ' in.') + '</p>';
    html += '<h3>How lucky was it?</h3>';
    html += '<p class="dv-micro">Each roll gets a luck score from zero to one: how far up its own chart it landed, with ties split. The run’s luck is the sum, set against every possible outcome of the same rolls.</p>';
    html += '<div id="dv-luck">' + (ui.luck ? luckHTML(ui.luck) : '<p class="dv-micro">Counting every possible run of these rolls…</p>') + '</div>';
    html += '<div class="dv-end-actions"><button type="button" class="dv-key" data-act="new">New expedition</button><button type="button" class="dv-key" data-act="again">Same map again</button></div>';
    box.innerHTML = html;
    if (ui.luck) drawHist();
    else setTimeout(function () {
      if (!S || S.phase !== 'end') return;
      ui.luck = M.luck(S.rolls, { seed: S.seed });
      var l = $('dv-luck'); if (!l) return;
      l.innerHTML = luckHTML(ui.luck); drawHist();
      announce('Luck: luckier than ' + M.fmtPct(ui.luck.percentile) + ' of possible runs.');
    }, 30);
  }
  function luckHTML(L) {
    var how = L.method === 'exact'
      ? 'Computed exactly, over every combination of these rolls.'
      : 'Estimated from ' + M.fmtNum(L.runs) + ' simulated runs of these rolls; the exact table was too large to count. The true figure is within about ' + Math.max(0.1, L.margin * 100).toFixed(1) + ' percentage points of this, ninety-nine times in a hundred.';
    return '<p><span class="dv-luck-big">' + L.score.toFixed(2) + '</span> from ' + L.n + (L.n === 1 ? ' roll' : ' rolls') + ', where an average run of these rolls scores ' + L.expected.toFixed(2) + '.</p>' +
      '<p>Luckier than <strong>' + M.fmtPct(L.percentile) + '</strong> of all possible runs of these same rolls.</p>' +
      '<svg class="dv-hist" id="dv-hist" role="img" aria-label="Spread of luck over all possible runs, with this run marked at ' + L.score.toFixed(2) + '."></svg>' +
      '<p class="dv-micro">' + how + '</p>';
  }
  function drawHist() {
    var svg = $('dv-hist'); if (!svg || !ui.luck) return;
    var L = ui.luck, sz = sizeOf(svg), w = sz.w, h = sz.h, n = L.hist.length, base = h - 20, cw = (w - 8) / n;
    var mx = Math.max.apply(null, Array.prototype.slice.call(L.hist)) || 1, out = patternDefs('dv-hist');
    for (var i = 0; i < n; i++) {
      var bh = L.hist[i] / mx * (base - 18), x = 4 + i * cw;
      var mine = i === L.mineBin;
      out += '<rect x="' + f1(x + 1) + '" y="' + f1(base - bh) + '" width="' + f1(cw - 2) + '" height="' + f1(bh) + '" fill="' + (mine ? C.ink : 'rgba(74,56,38,0.18)') + '" stroke="' + C.ink + '" stroke-width="' + (mine ? 0 : 0.8) + '"/>';
    }
    out += '<line x1="4" x2="' + (w - 4) + '" y1="' + base + '" y2="' + base + '" stroke="' + C.ink + '"/>';
    out += '<text x="4" y="' + (h - 4) + '" font-size="12" fill="' + C.soft + '">unluckiest</text><text x="' + (w - 4) + '" y="' + (h - 4) + '" text-anchor="end" font-size="12" fill="' + C.soft + '">luckiest</text>';
    var mxp = 4 + (L.mineBin + 0.5) * cw;
    out += '<text x="' + f1(Math.max(24, Math.min(w - 24, mxp))) + '" y="12" text-anchor="middle" font-size="12.5" font-weight="600" fill="' + C.ink + '">this run</text>';
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.innerHTML = out;
  }

  var liveTimer = null;
  function announce(t) { var el = $('dv-live'); el.textContent = ''; clearTimeout(liveTimer); liveTimer = setTimeout(function () { el.textContent = t; }, 60); }

  // ================================================================= actions
  function setTab(t, quiet) {
    ui.tab = t;
    Array.prototype.forEach.call(document.querySelectorAll('.dv-tab'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-tab') === t)); });
    $('dv-p-check').hidden = t !== 'check';
    $('dv-p-oracle').hidden = t !== 'oracle';
    $('dv-p-compare').hidden = t !== 'compare';
    if (quiet) return;
    if (t === 'check') renderCheck();
    if (t === 'oracle') renderOracle();
    if (t === 'compare') renderCompare();
  }

  function doRoll() {
    if (S.phase !== 'room' || ui.busy) return;
    var i = ui.sel, before = effOf(i);
    var res = M.attempt(S, i);
    ui.view = { expr: res.expr, target: res.target, notes: res.notes, landed: res.total, dice: res.roll.dice, result: resultHTML(res), passed: res.tier === 'success' || res.tier === 'strong' };
    void before;
    finishAction(function () {
      announce('Rolled ' + res.total + ': ' + M.TIER_LABEL[res.tier] + '.');
    }, true);
  }

  // Animate the dice, then draw everything. With reduced motion the result appears at once.
  function finishAction(after, dice) {
    if (dice && !reduced()) {
      ui.busy = true;
      renderApproaches();
      renderCheck(true);
      var dieEls = $('dv-tray').querySelectorAll('.dv-die text'), m = ui.view.expr.m, ticks = 0;
      var flick = setInterval(function () {
        ticks++;
        Array.prototype.forEach.call(dieEls, function (t) { t.textContent = String(1 + Math.floor(Math.random() * m)); });
        if (ticks > 7) clearInterval(flick);
      }, 70);
      setTimeout(function () { clearInterval(flick); ui.busy = false; renderAll(); if (after) after(); }, 680);
    } else { renderAll(); if (after) after(); }
  }

  function doAsk() {
    if (ui.busy || S.phase === 'end') return;
    var search = ui.oracleMode === 'search', res, lk;
    if (search) {
      res = M.search(S); lk = res.likelihood;
      var c = M.changeText(res.change);
      res.html = '<strong>The oracle rolled ' + res.face + ': ' + M.ANSWER_LABEL[res.answer].toLowerCase() + '.</strong> That answer comes up ' + M.fmtPct(res.p) + ' of the time at these odds. ' +
        (c ? 'You ' + c.replace(/^a torch burnt out/, 'burnt a torch').replace(/, a torch burnt out/, ', and a torch burnt out') + '.' : 'Nothing useful here.');
      ui.oracleMode = 'free';
    } else {
      lk = ui.lk;
      res = M.ask(S, $('dv-q').value.trim(), lk);
      res.html = '<strong>The oracle rolled ' + res.face + ': ' + M.ANSWER_LABEL[res.answer].toLowerCase() + '.</strong> That answer comes up ' + M.fmtPct(res.p) + ' of the time when a yes is ' + M.LIKELIHOODS[lk].label.toLowerCase() + '.';
    }
    ui.lastOracle = res;
    ui.oracleMode = search ? 'free' : ui.oracleMode;
    // keep the strip on the likelihood the answer used
    if (search) ui.lk = lk;
    renderAll();
    announce('Oracle: ' + M.ANSWER_LABEL[res.answer] + '.');
  }

  function doMove(to) {
    if (S.phase !== 'after' || ui.busy) return;
    M.move(S, to);
    ui.oracleMode = 'free'; ui.lastOracle = null;
    selectApproach(0, true);
    setTab('check', true);
    renderAll();
    announce('Entered ' + M.currentSit(S).name + '.');
    var room = $('dv-room');
    if (room.getBoundingClientRect().top < 0) room.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
    var first = $('dv-approaches').querySelector('.dv-ap');
    if (first) first.focus({ preventScroll: true });
  }

  function wire() {
    $('dv-approaches').addEventListener('click', function (ev) {
      var b = ev.target.closest('.dv-ap'); if (!b || b.disabled) return;
      selectApproach(+b.getAttribute('data-i'));
      if (ui.tab !== 'check') setTab('check');
      // on a phone the odds sit below the room: bring them into view
      if (window.matchMedia('(max-width: 780px)').matches) {
        var p = $('dv-panel'), r = p.getBoundingClientRect();
        if (r.top > window.innerHeight - 160) p.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
      }
    });
    $('dv-roll').addEventListener('click', doRoll);
    $('dv-ask').addEventListener('click', doAsk);
    $('dv-q').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); doAsk(); } });
    $('dv-likely').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-lk]'); if (!b || b.disabled) return;
      ui.lk = b.getAttribute('data-lk'); renderOracle();
      var nb = $('dv-likely').querySelector('[data-lk="' + ui.lk + '"]'); if (nb) nb.focus();
    });
    Array.prototype.forEach.call(document.querySelectorAll('.dv-tab'), function (b) {
      b.addEventListener('click', function () { setTab(b.getAttribute('data-tab')); });
    });
    $('dv-doors').addEventListener('click', function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      if (b.id === 'dv-search') {
        ui.oracleMode = 'search';
        setTab('oracle');
        var p = $('dv-panel');
        if (p.getBoundingClientRect().top < 0 || p.getBoundingClientRect().top > window.innerHeight - 120) p.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
        $('dv-ask').focus({ preventScroll: true });
        return;
      }
      doMove(+b.getAttribute('data-to'));
    });
    $('dv-new').addEventListener('click', function () { start(newSeed()); });
    $('dv-restart').addEventListener('click', function () { start(S.seed, true); });
    $('dv-end').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-act]'); if (!b) return;
      if (b.getAttribute('data-act') === 'new') start(newSeed()); else start(S.seed, true);
      $('dv-room').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
    });
    var pending = false;
    var redraw = function () {
      if (pending) return; pending = true;
      requestAnimationFrame(function () {
        pending = false;
        renderMap();
        if (ui.tab === 'check' && !ui.busy) renderCheck();
        if (ui.tab === 'oracle') renderOracle();
        if (ui.tab === 'compare') renderCompare();
        if (S.phase === 'end') drawHist();
      });
    };
    if (window.ResizeObserver) new ResizeObserver(redraw).observe($('dv-app'));
    else window.addEventListener('resize', redraw);
  }

  // ================================================================= card preview
  // A self-running loop: the die tumbles, the odds light up, the landed value is ringed,
  // and the map grows by one room. Rolls come from the model's seeded generator.
  function preview() {
    var host = $('dv-preview');
    host.hidden = false;
    $('dv-app').hidden = true;
    var W = 320, H = 200, BEAT = 2.6;
    var dg = M.generate(4);
    var path = [0];
    while (path.length < 5) { var r = dg.rooms[path[path.length - 1]]; if (!r.doors.length) break; path.push(r.doors[0]); }
    var plan = [
      { e: M.mk(2, 6), t: 7 }, { e: M.mk(2, 20, { keep: 'h', k: 1 }), t: 12 }, { e: M.mk(1, 12), t: 6 }, { e: M.mk(3, 6), t: 10 }
    ];
    // Seed chosen so the loop shows a mix of outcomes (a pass, a strong pass, a fail, a strong pass).
    var rng = new M.Rng(41);
    plan.forEach(function (b) { b.r = M.roll(b.e, rng); b.d = M.dist(b.e); b.o = M.checkOdds(b.e, b.t); });
    var chartBox = { x: 166, y: 104, w: 146, h: 88 };
    host.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
      '<defs><radialGradient id="pv-fox"><stop offset="0" stop-color="#8c5c28" stop-opacity="0.12"/><stop offset="1" stop-color="#8c5c28" stop-opacity="0"/></radialGradient></defs>' +
      '<rect width="320" height="200" fill="' + C.parch + '"/>' +
      '<circle cx="34" cy="168" r="30" fill="url(#pv-fox)"/><circle cx="292" cy="20" r="22" fill="url(#pv-fox)"/><circle cx="120" cy="30" r="18" fill="url(#pv-fox)"/>' +
      '<g id="pv-map" transform="translate(4 8)"></g>' +
      '<rect x="156" y="8" width="158" height="186" fill="' + C.ledger + '" stroke="' + C.ink + '" stroke-width="1.2"/>' +
      '<line x1="164" y1="8" x2="164" y2="194" stroke="' + C.blood + '" stroke-opacity="0.4"/>' +
      '<g id="pv-die" transform="translate(170 11)"></g>' +
      '<text x="172" y="69" font-size="22" font-weight="600" fill="' + C.verdInk + '"><tspan id="pv-pct"></tspan><tspan font-size="12.5" font-weight="400" font-style="italic" fill="' + C.ink + '" dx="4">to pass</tspan></text>' +
      '<text id="pv-expr" x="172" y="86" font-size="13" font-weight="600" fill="' + C.ink + '"></text>' +
      '<text id="pv-word" x="172" y="101" font-size="12.5" font-style="italic" fill="' + C.ink + '"></text>' +
      '<g id="pv-chart" transform="translate(' + chartBox.x + ' ' + chartBox.y + ')"></g>' +
      '</svg>';
    var gMap = host.querySelector('#pv-map'), gDie = host.querySelector('#pv-die'), gChart = host.querySelector('#pv-chart');
    var tExpr = host.querySelector('#pv-expr'), tPct = host.querySelector('#pv-pct'), tWord = host.querySelector('#pv-word');
    var current = { beat: -1, phase: '' }, raf = 0, t0 = 0, elapsed = 0;

    // each die of the roll at three quarters size, numerals at least 11px on the card;
    // dropped dice faded
    var DS = 0.75;
    function drawDice(b, vals, angle) {
      var s = '', gap = b.r.dice.length > 2 ? 34 : 40;
      b.r.dice.forEach(function (dd, i) {
        var inner = dieSVG(b.e.m, vals ? vals[i] : '', '', 15).replace(/<svg[^>]*>/, '').replace('</svg>', '');
        s += '<g transform="translate(' + (i * gap) + ' 0) rotate(' + f1(angle * (i % 2 ? -1 : 1)) + ' 18 18) scale(' + DS + ')"' + (vals && !dd.kept && angle === 0 ? ' opacity="0.4"' : '') + '>' + inner + '</g>';
      });
      gDie.innerHTML = s;
    }
    function frame(time) {
      var T = time % (BEAT * plan.length), bi = Math.floor(T / BEAT), u = T - bi * BEAT, b = plan[bi];
      if (bi !== current.beat) {
        current.beat = bi;
        tExpr.textContent = M.label(b.e) + ', need ' + b.t + '+';
        tPct.textContent = M.fmtPct(b.o.pass);
      }
      var light = Math.min(1, u / 0.45);
      var landed = u >= 1.05;
      var ring = landed ? Math.max(0, 100 - (u - 1.05) / 0.3 * 100) : null;
      gChart.innerHTML = chartMarkup({ id: 'pv' + bi, d: b.d, target: b.t, w: chartBox.w, h: chartBox.h, tally: true, small: true, light: light, landed: landed ? b.r.total : null, ringDash: ring, landedSeed: bi + 1 }).svg;
      if (u < 0.45) drawDice(b, null, 0);
      else if (u < 1.05) drawDice(b, b.r.dice.map(function (dd, i) { return 1 + Math.floor(hash(Math.floor(u * 14) + bi * 50 + i * 7) * b.e.m); }), (1.05 - u) * 520);
      else drawDice(b, b.r.dice.map(function (dd) { return dd.value; }), 0);
      tWord.textContent = landed ? 'landed ' + b.r.total + ': ' + M.TIER_LABEL[M.tierOf(b.r.total, b.t)].toLowerCase() : 'rolling';
      // the map grows by one room after the roll
      var grow = u >= 1.5, k = bi + 1 + (grow ? 1 : 0);
      var newOp = grow ? Math.min(1, (u - 1.5) / 0.45) : null, dash = grow ? Math.max(0, 100 - (u - 1.5) / 0.35 * 100) : null;
      gMap.innerHTML = mapMarkup(dg, { visited: path.slice(0, Math.min(path.length, k)), current: path[Math.min(path.length, k) - 1], doors: false, w: 146, h: 184, preview: true, vertical: true, levels: path.length, newRoom: grow ? path[k - 1] : null, newOpacity: newOp, corridorDash: dash });
    }
    function loop(now) {
      elapsed = (now - t0) / 1000;
      frame(elapsed);
      raf = requestAnimationFrame(loop);
    }
    function still() { frame(BEAT * 1 + 2.2); }
    Kit.onPlay(function (playing) {
      cancelAnimationFrame(raf); raf = 0;
      if (playing) { t0 = performance.now() - elapsed * 1000; raf = requestAnimationFrame(loop); }
      else still();
    });
  }

  // ================================================================= go
  if (Kit.preview) { preview(); return; }
  buildCompare();
  wire();
  start(newSeed());
  // For checking: every probability on the page should match a fresh computation.
  window.DelveAudit = function () {
    var errs = [], fresh = function (e, t) { return M.fmtPct(M.pAtLeast(M.dist(e), t)); };
    if (ui.view && $('dv-c-pass').textContent !== fresh(ui.view.expr, ui.view.target)) errs.push('check panel');
    Array.prototype.forEach.call(document.querySelectorAll('.dv-ap'), function (b, i) {
      var x = effOf(i);
      if (b.querySelector('.dv-ap-pass').textContent !== fresh(x.eff.expr, x.ap.target)) errs.push('approach ' + i);
    });
    return { ok: !errs.length, errors: errs, journal: S.log.length };
  };
})();
