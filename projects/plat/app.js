/* Plat: the page. Draws the plat (an SVG map of the 22 local areas), the field book (a
 * ranked ledger that is also the keyboard route to every area), the record of one area
 * (small multiples with an interquartile band and counts), and the card preview.
 * All arithmetic lives in model.js. */
(function () {
  'use strict';

  var P = window.Plat;
  var SVGNS = 'http://www.w3.org/2000/svg';
  var K = 7; // colour classes

  // The wash scale: dry earth to deep forest. Darker always means a higher median.
  // Muted, as pigment dries on linen; EDGE is where each wash pools at its boundary.
  var WASH = ['#e9dcb8', '#d8c594', '#beb27c', '#9a9f6c', '#76875d', '#55704f', '#3a5443'];
  var EDGE = ['#cbb88e', '#b9a470', '#9d935c', '#7a8150', '#586a45', '#3c553b', '#243a2f'];

  var MEASURE_LABEL = { land: 'land', building: 'building', total: 'land and building' };
  var KIND_LABEL = { nonstrata: 'lots', strata: 'strata units' };

  var stage = document.querySelector('[data-kit-stage]');
  var svg = document.getElementById('pl-svg');

  function el(name, attrs, parent) {
    var n = document.createElementNS(SVGNS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function h(tag, cls, text, parent) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }

  // ------------------------------------------------------------------ shared drawing

  var LINEN = '#e6e2d6', INK = '#22201b', SEPIA = '#5e5040';

  function defs(root, prefix) {
    var d = el('defs', {}, root);
    // Withheld cells: diagonal hatching in survey ink, as a plat marks land it does not describe.
    var pat = el('pattern', { id: prefix + 'hatch', width: 7, height: 7, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, d);
    el('rect', { width: 7, height: 7, fill: LINEN }, pat);
    el('line', { x1: 0, y1: 0, x2: 0, y2: 7, stroke: '#4a4234', 'stroke-width': 1.1 }, pat);
    // The wash: pigment runs a hair past the ruled line (fine displacement) and settles
    // unevenly into the linen (granulation). One filter over the whole wash layer.
    var f = el('filter', { id: prefix + 'wash', x: '-2%', y: '-2%', width: '104%', height: '104%', 'color-interpolation-filters': 'sRGB' }, d);
    var t1 = el('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.5', numOctaves: 2, seed: 7, result: 'n' }, f);
    var dm = el('feDisplacementMap', { in: 'SourceGraphic', in2: 'n', scale: 2, xChannelSelector: 'R', yChannelSelector: 'G', result: 'wash' }, f);
    // Granulation: slow blooms where the pigment settled thicker or thinner.
    var t2 = el('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.1', numOctaves: 3, seed: 3, result: 'g' }, f);
    el('feColorMatrix', { in: 'g', type: 'matrix', values: '0 0 0 0 0.20  0 0 0 0 0.16  0 0 0 0 0.10  0.55 0 0 0 -0.22', result: 'dk' }, f);
    el('feColorMatrix', { in: 'g', type: 'matrix', values: '0 0 0 0 0.93  0 0 0 0 0.92  0 0 0 0 0.88  -0.6 0 0 0 0.25', result: 'lt' }, f);
    el('feComposite', { in: 'dk', in2: 'wash', operator: 'in', result: 'dkin' }, f);
    el('feComposite', { in: 'lt', in2: 'wash', operator: 'in', result: 'ltin' }, f);
    var m = el('feMerge', {}, f);
    el('feMergeNode', { in: 'wash' }, m);
    el('feMergeNode', { in: 'ltin' }, m);
    el('feMergeNode', { in: 'dkin' }, m);
    // The pooled edge: each area's own rim, clipped inside it, softened and multiplied over
    // the wash, as pigment gathers where a wet wash meets its boundary.
    var pf = el('filter', { id: prefix + 'pool', x: '-2%', y: '-2%', width: '104%', height: '104%' }, d);
    var bl = el('feGaussianBlur', { stdDeviation: 1 }, pf);
    return {
      defs: d,
      // u: viewBox units per CSS pixel. Filter sizes are given in screen pixels, so the wash
      // reads the same on the card and on the full sheet.
      tune: function (u) {
        t1.setAttribute('baseFrequency', (0.9 / u).toFixed(4));
        dm.setAttribute('scale', (2 * u).toFixed(2));
        t2.setAttribute('baseFrequency', (0.07 / u).toFixed(4));
        bl.setAttribute('stdDeviation', (1.1 * u).toFixed(2));
      }
    };
  }

  // Clip each rim to its own area so the darker stroke sits only on the inside.
  function rimClip(dfs, prefix, i, d) {
    var cp = el('clipPath', { id: prefix + 'c' + i }, dfs.defs);
    el('path', { d: d }, cp);
    return 'url(#' + prefix + 'c' + i + ')';
  }

  function northArrow(g, x, y, s) {
    var a = el('g', { transform: 'translate(' + x + ',' + y + ') scale(' + s + ')', class: 'pl-north' }, g);
    el('circle', { r: 17, fill: 'none', stroke: INK, 'stroke-width': 0.8 }, a);
    el('path', { d: 'M0,-26 L6,6 L0,1 Z', fill: INK }, a);
    el('path', { d: 'M0,-26 L-6,6 L0,1 Z', fill: 'none', stroke: INK, 'stroke-width': 0.9 }, a);
    var t = el('text', { x: 0, y: -31, 'text-anchor': 'middle', class: 'pl-svg-caps' }, a);
    t.textContent = 'N';
    return a;
  }

  // A scale bar of whole kilometres, alternating filled and open like a surveyor's rule.
  // above: put the figures over the bar instead of under it.
  function scaleBar(g, view, x, y, km, h, above) {
    var u = 1000 / view.m_per_unit;
    h = h || 5;
    var s = el('g', { transform: 'translate(' + x + ',' + y + ')', class: 'pl-scale' }, g);
    for (var i = 0; i < km; i++) {
      el('rect', { x: i * u, y: 0, width: u, height: h, fill: i % 2 ? LINEN : INK, stroke: INK, 'stroke-width': h / 6 }, s);
    }
    for (var j = 0; j <= km; j++) {
      var t = el('text', { x: j * u, y: above ? -h * 0.9 : h, dy: above ? 0 : '1.05em', 'text-anchor': j === km && above ? 'start' : 'middle', class: 'pl-svg-mono' }, s);
      if (j === km && above) t.setAttribute('dx', '-0.3em');
      t.textContent = j === km ? j + ' km' : String(j);
    }
    return s;
  }

  function washFor(cls) { return cls < 0 ? null : WASH[cls]; }

  // ------------------------------------------------------------------ full page

  function initFull(data) {
    var years = data.meta.years;
    var state = {
      year: years[years.length - 1],
      measure: 'land',
      basis: 'real',
      kind: 'nonstrata',
      sel: -1,
      hover: -1
    };
    var view = data.view;
    var nA = data.areas.length;

    document.getElementById('pl-threshold').textContent = data.meta.threshold;
    document.getElementById('pl-unplaced').textContent = ((1 - data.meta.audit.placed_share_min) * 100).toFixed(1);
    document.getElementById('pl-real-btn').textContent = 'Real ' + data.meta.cpi.base_year;

    // --- the map
    svg.setAttribute('viewBox', '0 0 ' + view.w + ' ' + view.h);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    var dfs = defs(svg, 'pl-');
    var gWash = el('g', { filter: 'url(#pl-wash)', 'fill-opacity': 0.9 }, svg);
    var gEdge = el('g', { filter: 'url(#pl-pool)', fill: 'none', class: 'pl-pool' }, svg);
    var gLine = el('g', { fill: 'none', stroke: INK, 'stroke-width': 1.1, 'stroke-linejoin': 'round' }, svg);
    var gSel = el('g', { fill: 'none' }, svg);
    var gLab = el('g', {}, svg);
    var gHit = el('g', {}, svg);
    var washes = [], edges = [], labels = [], hits = [];

    data.areas.forEach(function (a, i) {
      washes.push(el('path', { d: a.d }, gWash));
      edges.push(el('path', { d: a.d, 'clip-path': rimClip(dfs, 'pl-', i, a.d) }, gEdge));
      el('path', { d: a.d }, gLine);
      var lab = el('g', { class: 'pl-lab', transform: 'translate(' + a.lx + ',' + a.ly + ')' }, gLab);
      var num = el('text', { class: 'pl-svg-mono pl-lab-num', 'text-anchor': 'middle' }, lab);
      num.textContent = a.num;
      var name = el('text', { class: 'pl-svg-caps pl-lab-name', 'text-anchor': 'middle' }, lab);
      var parts = a.name.split('-');
      parts.forEach(function (p, k) {
        var ts = el('tspan', { x: 0, dy: k === 0 ? 0 : '1.05em' }, name);
        ts.textContent = p + (k < parts.length - 1 ? '–' : '');
      });
      labels.push({ g: lab, num: num, name: name, lines: parts.length });
      var hit = el('path', { d: a.d, fill: 'transparent', class: 'pl-hit' }, gHit);
      hit.addEventListener('pointerenter', function () { setHover(i); });
      hit.addEventListener('pointerleave', function () { setHover(-1); });
      hit.addEventListener('click', function () { select(state.sel === i ? -1 : i); });
      hits.push(hit);
    });
    var selPath = el('path', { d: '', stroke: '#8c2f1c', 'stroke-width': 3.2, 'stroke-linejoin': 'round', class: 'pl-sel' }, gSel);
    var hovPath = el('path', { d: '', stroke: '#22201b', 'stroke-width': 2.4, 'stroke-dasharray': '6 3', 'stroke-linejoin': 'round' }, gSel);

    var deco = el('g', { class: 'pl-deco' }, svg);
    var NA = view.north || [40, view.h - 120], SB = view.scale || [20, view.h - 30];
    northArrow(deco, NA[0], NA[1], 1.25);
    var sbar = null;

    // Label sizes are set in screen pixels, so they stay legible at any width.
    var labelsWide = true;
    function sizeLabels() {
      var w = svg.getBoundingClientRect().width || 600;
      var unit = view.w / w; // viewBox units per CSS pixel
      labelsWide = w >= 520;
      svg.style.setProperty('--u', unit);
      labels.forEach(function (l, i) {
        var a = data.areas[i];
        l.num.setAttribute('font-size', (11.5 * unit).toFixed(2));
        l.name.setAttribute('font-size', (12 * unit).toFixed(2));
        l.name.style.display = labelsWide ? '' : 'none';
        var lift = labelsWide ? (l.lines * 12 * unit * 1.05) / 2 : 0;
        l.num.setAttribute('y', (-lift + 4 * unit).toFixed(1));
        l.name.setAttribute('y', (-lift + 18 * unit).toFixed(1));
      });
      // Where two names would collide, the area with less room keeps only its number.
      if (labelsWide) {
        var kept = [];
        data.areas.map(function (a, i) { return i; })
          .sort(function (x, y) { return data.areas[y].r - data.areas[x].r; })
          .forEach(function (i) {
            var a = data.areas[i], b = labels[i].name.getBBox();
            var box = { x0: a.lx + b.x - 3 * unit, y0: a.ly + b.y, x1: a.lx + b.x + b.width + 3 * unit, y1: a.ly + b.y + b.height };
            var hit = kept.some(function (k) { return box.x0 < k.x1 && k.x0 < box.x1 && box.y0 < k.y1 && k.y0 < box.y1; });
            if (hit) labels[i].name.style.display = 'none';
            else kept.push(box);
          });
      }
      deco.setAttribute('font-size', (11 * unit).toFixed(2));
      // The rule keeps a steady drawn thickness at any width.
      if (sbar) deco.removeChild(sbar);
      sbar = scaleBar(deco, view, SB[0], SB[1] - 2 * unit, 2, 4 * unit);
      dfs.tune(unit);
      gEdge.setAttribute('stroke-width', (6 * unit).toFixed(2));
      layoutGen++;
      drawMultiples();
    }

    // --- legend (below the map)
    var mapFig = document.getElementById('pl-map');
    var legend = h('div', 'pl-legend', null, null);
    mapFig.insertBefore(legend, document.getElementById('pl-map-desc'));

    // --- controls
    var yearInput = document.getElementById('pl-year-input');
    var yearOut = document.getElementById('pl-year-out');
    var yearNote = document.getElementById('pl-year-note');
    yearInput.min = years[0];
    yearInput.max = years[years.length - 1];
    yearInput.value = state.year;
    var ticks = document.getElementById('pl-ticks');
    years.forEach(function (y) {
      var last = years[years.length - 1];
      var major = y === years[0] || y === last || (y % 5 === 0 && y - years[0] > 2 && last - y > 2);
      var t = h('span', major ? 'is-major' : '', null, ticks);
      if (t.className) t.textContent = y;
    });
    yearInput.addEventListener('input', function () { stopRun(); setYear(+yearInput.value); });

    Array.prototype.forEach.call(document.querySelectorAll('.pl-tabs'), function (fs) {
      var key = fs.getAttribute('data-key');
      Array.prototype.forEach.call(fs.querySelectorAll('button'), function (b) {
        b.addEventListener('click', function () {
          state[key] = b.getAttribute('data-v');
          Array.prototype.forEach.call(fs.querySelectorAll('button'), function (o) {
            o.setAttribute('aria-pressed', o === b ? 'true' : 'false');
          });
          render();
        });
      });
    });

    // Running the years: one roll every 0.7 s, started and stopped by the visitor. Each step
    // is a jump between still frames, with no tweening, so it is the same under reduced motion.
    var runBtn = document.getElementById('pl-run');
    var runTimer = null;
    function stopRun() {
      if (runTimer) clearTimeout(runTimer);
      runTimer = null;
      runBtn.setAttribute('aria-pressed', 'false');
      runBtn.textContent = 'Run the years';
    }
    function step() {
      var i = years.indexOf(state.year);
      if (i >= years.length - 1) { stopRun(); return; }
      setYear(years[i + 1]);
      runTimer = setTimeout(step, 700);
    }
    runBtn.addEventListener('click', function () {
      if (runTimer) { stopRun(); return; }
      runBtn.setAttribute('aria-pressed', 'true');
      runBtn.textContent = 'Stop';
      if (state.year === years[years.length - 1]) setYear(years[0]);
      runTimer = setTimeout(step, 700);
    });

    document.getElementById('pl-record-city').addEventListener('click', function () { select(-1); });

    function setYear(y) {
      state.year = y;
      yearInput.value = y;
      render();
    }
    function setHover(i) {
      state.hover = i;
      hovPath.setAttribute('d', i >= 0 && i !== state.sel ? data.areas[i].d : '');
      Array.prototype.forEach.call(rowsEl.children, function (li) {
        li.classList.toggle('is-hover', +li.getAttribute('data-a') === i);
      });
      reading();
    }
    function select(i) {
      state.sel = i;
      selPath.setAttribute('d', i >= 0 ? data.areas[i].d : '');
      hovPath.setAttribute('d', '');
      render();
    }

    // --- ledger
    var rowsEl = document.getElementById('pl-rows');
    var rowEls = data.areas.map(function (a, i) {
      var li = h('li', 'pl-row');
      li.setAttribute('data-a', i);
      var b = h('button', 'pl-row-btn', null, li);
      b.type = 'button';
      h('span', 'pl-row-num', a.num, b);
      var sw = h('span', 'pl-row-sw', null, b);
      sw.setAttribute('aria-hidden', 'true');
      h('span', 'pl-row-name', a.name, b);
      var v = h('span', 'pl-row-val', '', b);
      var c = h('span', 'pl-row-chg', '', b);
      var n = h('span', 'pl-row-n', '', b);
      b.addEventListener('click', function () {
        select(state.sel === i ? -1 : i);
        // On a phone the record sits below the controls: bring it into view.
        if (state.sel === i && window.matchMedia('(max-width: 900px)').matches) {
          document.getElementById('pl-record').scrollIntoView({ behavior: Kit.reducedMotion ? 'auto' : 'smooth', block: 'start' });
        }
      });
      b.addEventListener('pointerenter', function () { setHover(i); });
      b.addEventListener('pointerleave', function () { setHover(-1); });
      b.addEventListener('focus', function () { setHover(i); });
      b.addEventListener('blur', function () { setHover(-1); });
      return { li: li, b: b, sw: sw, v: v, c: c, n: n };
    });

    var cur = null; // current view's cells, classes and breaks

    function render() {
      var edgesV = P.breaks(data, state.kind, state.measure, state.basis, K);
      var y0 = years[0];
      var cells = data.areas.map(function (_, i) {
        var c = P.cell(data, i, state.year, state.kind, state.measure, state.basis);
        var since = P.firstYear(data, i, state.kind, state.measure, state.basis);
        return {
          c: c,
          cls: c && edgesV ? P.classify(c.med, edgesV) : -1,
          since: since,
          chg: since != null && since < state.year ? P.change(data, i, state.kind, state.measure, state.basis, since, state.year) : null
        };
      });
      cur = { cells: cells, edges: edgesV, y0: y0 };

      // map
      cells.forEach(function (x, i) {
        var fill = x.cls >= 0 ? WASH[x.cls] : 'url(#pl-hatch)';
        washes[i].setAttribute('fill', fill);
        edges[i].setAttribute('stroke', x.cls >= 0 ? EDGE[x.cls] : 'none');
        labels[i].g.classList.toggle('is-withheld', x.cls < 0);
        hits[i].setAttribute('aria-hidden', 'true');
      });

      // year
      yearOut.textContent = state.year;
      yearNote.textContent = 'valued 1 July ' + P.valuationYear(data, state.year);

      // legend
      legend.textContent = '';
      var lt = h('span', 'pl-legend-t', 'Median ' + MEASURE_LABEL[state.measure] + ' value, ' + KIND_LABEL[state.kind] + (state.basis === 'real' ? ', ' + data.meta.cpi.base_year + ' dollars' : ', dollars of each roll'), legend);
      lt.id = 'pl-legend-t';
      var strip = h('span', 'pl-legend-strip', null, legend);
      if (edgesV) {
        WASH.forEach(function (c, k) {
          var cell = h('span', 'pl-legend-cell', null, strip);
          cell.style.background = c;
          cell.title = P.money(edgesV[k]) + ' to ' + P.money(edgesV[k + 1]);
        });
        var marks = h('span', 'pl-legend-marks', null, legend);
        [0, 2, 5, 7].forEach(function (k) {
          var m = h('span', '', P.money(edgesV[k]), marks);
          m.style.left = (k / K * 100) + '%';
        });
      }
      var wh = h('span', 'pl-legend-wh', null, legend);
      h('span', 'pl-legend-hatch', null, wh).setAttribute('aria-hidden', 'true');
      h('span', '', 'withheld, under ' + data.meta.threshold, wh);

      // ledger, sorted by median, withheld last
      var order = cells.map(function (_, i) { return i; }).sort(function (a, b) {
        var ca = cells[a].c, cb = cells[b].c;
        if (!ca && !cb) return data.areas[a].name < data.areas[b].name ? -1 : 1;
        if (!ca) return 1;
        if (!cb) return -1;
        return cb.med - ca.med;
      });
      order.forEach(function (i) {
        var r = rowEls[i], x = cells[i];
        rowsEl.appendChild(r.li);
        r.sw.style.background = x.cls >= 0 ? WASH[x.cls] : '';
        r.sw.classList.toggle('is-withheld', x.cls < 0);
        r.v.textContent = x.c ? P.money(x.c.med) : 'withheld';
        r.c.textContent = x.chg != null ? P.pct(x.chg) : '';
        r.c.title = x.since != null ? 'change since ' + x.since : '';
        r.n.textContent = x.c ? 'n ' + P.count(x.c.n) : '';
        r.b.setAttribute('aria-pressed', state.sel === i ? 'true' : 'false');
        r.b.setAttribute('aria-label', data.areas[i].name + ': ' + (x.c
          ? 'median ' + P.money(x.c.med) + ', ' + P.count(x.c.n) + ' properties' + (x.chg != null ? ', ' + P.pct(x.chg) + ' since ' + x.since : '')
          : 'withheld, fewer than ' + data.meta.threshold + ' properties'));
        r.li.classList.toggle('is-sel', state.sel === i);
      });
      document.getElementById('pl-ledger-h').textContent = 'Field book · ' + state.year + ' · change since ' + years[0];

      hint();
      reading();
      drawMultiples();
    }

    function hint() {
      var t;
      if (state.basis === 'real') t = 'Real: each roll restated in ' + data.meta.cpi.base_year + ' dollars with Vancouver’s average consumer price index for the year it was valued.';
      else t = 'As assessed: the dollars printed on each year’s roll. Switch to Real to take out inflation.';
      if (state.measure === 'total') t += ' Both: the median of each property’s land plus building, not the sum of two medians.';
      if (state.kind === 'strata') t += ' Strata units: each unit with its own share of the land.';
      document.getElementById('pl-hint').textContent = t;
    }

    function reading() {
      var out = document.getElementById('pl-map-desc');
      var i = state.hover >= 0 ? state.hover : state.sel;
      var head = state.year + ' roll, median ' + MEASURE_LABEL[state.measure] + ' value of ' + KIND_LABEL[state.kind] + (state.basis === 'real' ? ' in ' + data.meta.cpi.base_year + ' dollars' : ' as assessed');
      if (i >= 0) {
        var x = cur.cells[i];
        out.textContent = data.areas[i].name + ' (' + data.areas[i].num + '), ' + head + ': ' + (x.c
          ? P.money(x.c.med) + ', middle half ' + P.money(x.c.q1) + ' to ' + P.money(x.c.q3) + ', ' + P.count(x.c.n) + ' properties.'
          : 'withheld, fewer than ' + data.meta.threshold + ' properties.');
        return;
      }
      var have = cur.cells.map(function (x, k) { return { x: x, k: k }; }).filter(function (o) { return o.x.c; });
      if (!have.length) { out.textContent = head + ': no areas to show.'; return; }
      have.sort(function (a, b) { return b.x.c.med - a.x.c.med; });
      var hi = have[0], lo = have[have.length - 1];
      var city = P.cell(data, -1, state.year, state.kind, state.measure, state.basis);
      out.textContent = head + '. Highest ' + data.areas[hi.k].name + ' ' + P.money(hi.x.c.med) + ', lowest ' + data.areas[lo.k].name + ' ' + P.money(lo.x.c.med) +
        (city ? '; whole city ' + P.money(city.med) + ' across ' + P.count(city.n) + ' properties' : '') + '.';
    }

    // --- the record: small multiples
    // The panels are built when the area, the kind, the dollars or the layout change. A year
    // change only moves the year marks (cursor, dot, highlighted bar, captions), so scrubbing
    // forces no layout.
    var mult = document.getElementById('pl-multiples');
    var panels = [], multKey = null, layoutGen = 0, buildW = 0;
    function drawMultiples() {
      if (!cur) return;
      var a = state.sel;
      var key = [a, state.kind, state.basis, layoutGen].join('|');
      if (key !== multKey) {
        multKey = key;
        document.getElementById('pl-record-title').textContent = a >= 0 ? data.areas[a].num + '  ' + data.areas[a].name : 'The whole city';
        document.getElementById('pl-record-city').hidden = a < 0;
        document.getElementById('pl-record-sub').textContent =
          'Median with its middle half (25th to 75th percentile) shaded, ' + KIND_LABEL[state.kind] + ', ' +
          (state.basis === 'real' ? data.meta.cpi.base_year + ' dollars' : 'dollars as assessed') + '.' +
          (a >= 0 ? ' Dashed: the whole city.' : ' Click an area, or pick one in the field book.');
        mult.textContent = '';
        panels = [];
        buildW = 0;
        ['land', 'building', 'total'].forEach(function (m) { panels.push(panelValue(m, a)); });
        panels.push(panelCount(a));
        if (data.permits) panels.push(panelPermits(a));
      }
      panels.forEach(function (p) { p.update(); });
    }

    function frame(title) {
      var fig = h('figure', 'pl-panel', null, mult);
      h('figcaption', 'pl-panel-t', title, fig);
      // Drawn at the panel's own pixel size, so the axis figures stay at their CSS size.
      // Every panel sits in an equal grid column, so one measurement per build serves all.
      if (!buildW) buildW = Math.max(140, Math.round(fig.getBoundingClientRect().width));
      var w = buildW;
      var hh = Math.round(Math.max(112, Math.min(150, w * 0.6)));
      var s = el('svg', { viewBox: '0 0 ' + w + ' ' + hh, width: w, height: hh, class: 'pl-panel-svg' }, fig);
      return { fig: fig, svg: s, w: w, h: hh, l: 44, r: 8, t: 10, b: 20 };
    }
    function xs(f, y) { return f.l + (y - years[0]) / (years[years.length - 1] - years[0]) * (f.w - f.l - f.r); }
    function axisYears(f) {
      [years[0], 2016, years[years.length - 1]].forEach(function (y) {
        var t = el('text', { x: xs(f, y), y: f.h - 5, 'text-anchor': 'middle', class: 'pl-ax' }, f.svg);
        t.textContent = y;
      });
      f.cursor = el('line', { x1: 0, x2: 0, y1: f.t - 4, y2: f.h - f.b + 2, stroke: '#8c2f1c', 'stroke-width': 1.2 }, f.svg);
      // Pointer on a panel scrubs the year.
      var hit = el('rect', { x: f.l, y: 0, width: f.w - f.l - f.r, height: f.h, fill: 'transparent', class: 'pl-scrub' }, f.svg);
      function at(ev) {
        var r = f.svg.getBoundingClientRect();
        var x = (ev.clientX - r.left) / r.width * f.w;
        var y = Math.round(years[0] + (x - f.l) / (f.w - f.l - f.r) * (years[years.length - 1] - years[0]));
        y = Math.max(years[0], Math.min(years[years.length - 1], y));
        if (y !== state.year) { stopRun(); setYear(y); }
      }
      hit.addEventListener('pointerdown', function (ev) { at(ev); });
      hit.addEventListener('pointermove', function (ev) { if (ev.buttons) at(ev); });
    }
    function moveCursor(f) {
      var cx = xs(f, state.year);
      f.cursor.setAttribute('x1', cx);
      f.cursor.setAttribute('x2', cx);
    }

    function panelValue(m, a) {
      var f = frame(m === 'total' ? 'Land and building' : m === 'land' ? 'Land' : 'Building');
      var pts = [], city = [];
      years.forEach(function (y) {
        var c = P.cell(data, a, y, state.kind, m, state.basis);
        if (c) pts.push({ y: y, c: c });
        if (a >= 0) { var cc = P.cell(data, -1, y, state.kind, m, state.basis); if (cc) city.push({ y: y, c: cc }); }
      });
      var cap = h('p', 'pl-panel-v', null, f.fig);
      if (!pts.length) {
        var t0 = el('text', { x: f.w / 2, y: f.h / 2, 'text-anchor': 'middle', class: 'pl-ax' }, f.svg);
        t0.textContent = 'withheld in every year';
        return { update: function () { cap.textContent = state.year + ': withheld'; } };
      }
      var hi = 0;
      pts.forEach(function (p) { hi = Math.max(hi, p.c.q3); });
      city.forEach(function (p) { hi = Math.max(hi, p.c.med); });
      hi = niceMax(hi);
      function ys(v) { return f.h - f.b - v / hi * (f.h - f.b - f.t); }
      [0, hi / 2, hi].forEach(function (v) {
        el('line', { x1: f.l, x2: f.w - f.r, y1: ys(v), y2: ys(v), stroke: '#cbbf9f', 'stroke-width': 0.6 }, f.svg);
        var t = el('text', { x: f.l - 5, y: ys(v) + 3.5, 'text-anchor': 'end', class: 'pl-ax' }, f.svg);
        t.textContent = P.money(v);
      });
      // Runs of consecutive years, so a withheld year leaves a gap rather than a bridge.
      runs(pts).forEach(function (run) {
        var band = run.map(function (p) { return xs(f, p.y) + ',' + ys(p.c.q3); }).concat(run.slice().reverse().map(function (p) { return xs(f, p.y) + ',' + ys(p.c.q1); }));
        if (run.length > 1) el('polygon', { points: band.join(' '), fill: '#93a462', 'fill-opacity': 0.38 }, f.svg);
        el('polyline', { points: run.map(function (p) { return xs(f, p.y) + ',' + ys(p.c.med); }).join(' '), fill: 'none', stroke: '#22201b', 'stroke-width': 1.6 }, f.svg);
      });
      if (city.length) el('polyline', { points: city.map(function (p) { return xs(f, p.y) + ',' + ys(p.c.med); }).join(' '), fill: 'none', stroke: '#22201b', 'stroke-width': 1, 'stroke-dasharray': '3 3', 'stroke-opacity': 0.75 }, f.svg);
      axisYears(f);
      var dot = el('circle', { cx: 0, cy: 0, r: 3, fill: '#8c2f1c' }, f.svg);
      f.svg.setAttribute('role', 'img');
      f.svg.setAttribute('aria-label', (m === 'total' ? 'Land and building' : m) + ' median by year: ' + pts.map(function (p) { return p.y + ' ' + P.money(p.c.med); }).join(', '));
      return {
        update: function () {
          moveCursor(f);
          var now = P.cell(data, a, state.year, state.kind, m, state.basis);
          cap.textContent = now ? state.year + ': ' + P.money(now.med) + ' (' + P.money(now.q1) + '–' + P.money(now.q3) + ')' : state.year + ': withheld';
          if (now) {
            dot.setAttribute('cx', xs(f, state.year));
            dot.setAttribute('cy', ys(now.med));
            dot.removeAttribute('display');
          } else dot.setAttribute('display', 'none');
        }
      };
    }

    function bars(f, vals, label, fill) {
      var hi = niceMax(Math.max.apply(null, vals.map(function (v) { return v.v || 0; })) || 1, true);
      function ys(v) { return f.h - f.b - v / hi * (f.h - f.b - f.t); }
      [0, hi].forEach(function (v) {
        el('line', { x1: f.l, x2: f.w - f.r, y1: ys(v), y2: ys(v), stroke: '#cbbf9f', 'stroke-width': 0.6 }, f.svg);
        var t = el('text', { x: f.l - 5, y: ys(v) + 3.5, 'text-anchor': 'end', class: 'pl-ax' }, f.svg);
        t.textContent = P.count(v);
      });
      var bw = (f.w - f.l - f.r) / (years.length - 1) * 0.62;
      var rects = [];
      vals.forEach(function (v) {
        if (v.v == null) return;
        rects.push({ y: v.y, r: el('rect', { x: xs(f, v.y) - bw / 2, y: ys(v.v), width: bw, height: Math.max(0.5, ys(0) - ys(v.v)), fill: fill }, f.svg) });
      });
      axisYears(f);
      f.svg.setAttribute('role', 'img');
      f.svg.setAttribute('aria-label', label + ': ' + vals.filter(function (v) { return v.v != null; }).map(function (v) { return v.y + ' ' + v.v; }).join(', '));
      return function () {
        moveCursor(f);
        rects.forEach(function (o) { o.r.setAttribute('fill', o.y === state.year ? '#8c2f1c' : fill); });
      };
    }

    function panelCount(a) {
      var f = frame('Properties counted');
      var vals = years.map(function (y) {
        var c = P.cell(data, a, y, state.kind, 'land', 'nominal');
        return { y: y, v: c ? c.n : null };
      });
      var mark = bars(f, vals, 'Properties counted by year', '#6b5a43');
      var cap = h('p', 'pl-panel-v', '', f.fig);
      return {
        update: function () {
          mark();
          var c = vals[years.indexOf(state.year)];
          cap.textContent = state.year + ': ' + (c.v ? P.count(c.v) + ' ' + KIND_LABEL[state.kind] : 'withheld');
        }
      };
    }

    // From BE_Project: watching a city build. Permits for new buildings, by the roll whose
    // valuation date falls in the year they were issued.
    function panelPermits(a) {
      var f = frame('New-building permits');
      var pm = data.permits;
      var vals = years.map(function (y) {
        var k = pm.years.indexOf(y - data.meta.valuation_lag);
        if (k < 0) return { y: y, v: null };
        return { y: y, v: a >= 0 ? pm.areas[a][k] : pm.city[k] };
      });
      var mark = bars(f, vals, 'New-building permits issued in the year before each roll', '#55704f');
      var cap = h('p', 'pl-panel-v', '', f.fig);
      return {
        update: function () {
          mark();
          var c = vals[years.indexOf(state.year)];
          cap.textContent = c.v != null ? P.count(c.v) + ' issued in ' + (state.year - data.meta.valuation_lag) : 'Permit records start in ' + pm.years[0];
        }
      };
    }

    function runs(pts) {
      var out = [], curRun = [];
      pts.forEach(function (p, k) {
        if (k && p.y !== pts[k - 1].y + 1) { out.push(curRun); curRun = []; }
        curRun.push(p);
      });
      if (curRun.length) out.push(curRun);
      return out;
    }
    function niceMax(v, integer) {
      if (v <= 0) return 1;
      var p = Math.pow(10, Math.floor(Math.log10(v)));
      var steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
      for (var i = 0; i < steps.length; i++) if (steps[i] * p >= v) return integer ? Math.max(1, Math.ceil(steps[i] * p)) : steps[i] * p;
      return 10 * p;
    }

    render();
    sizeLabels();
    // Re-measure when the map or the panels change width (a window resize, a rotation, a
    // column reflow), not on every year change.
    var rt = null, seen = [svg.clientWidth, mult.clientWidth];
    function relayout() { clearTimeout(rt); rt = setTimeout(sizeLabels, 120); }
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function () {
        var now = [svg.clientWidth, mult.clientWidth];
        if (now[0] !== seen[0] || now[1] !== seen[1]) { seen = now; relayout(); }
      });
      ro.observe(svg);
      ro.observe(mult);
    }
    window.addEventListener('resize', relayout);
  }

  // ------------------------------------------------------------------ card preview

  // The roll years tick by and the areas recolour, beside two bars: the city's median land
  // value and median building value of a lot. Real values in base-year dollars, precomputed.
  // The card carries the sheet's furniture: a cartouche, a north arrow, a scale bar and
  // small-caps names on three of the largest areas.

  // The card's data shares the page's projection (the same 1000-unit-wide view), so the
  // page's metres per unit and label points apply. tests/test_preview_style.js checks both
  // against data/plat.json.
  var PV_M_PER_UNIT = 14.639;
  var PV_NAMES = [
    { i: 1, name: 'Downtown', x: 564.3, y: 116 },
    { i: 9, name: 'Kitsilano', x: 305, y: 221 },
    { i: 7, name: 'Kerrisdale', x: 310.9, y: 541.4 }
  ];

  function initPreview(pv) {
    stage.textContent = '';
    stage.classList.add('pl-pv');
    var s = el('svg', { viewBox: '0 0 ' + pv.w + ' ' + pv.h, preserveAspectRatio: 'xMidYMid meet', class: 'pl-pv-map', role: 'img', 'aria-label': 'Vancouver local areas shaded by real median land value, roll by roll' }, null);
    var wrap = h('div', 'pl-pv-wrap', null, stage);
    wrap.appendChild(s);
    var dfs = defs(s, 'pv-');
    var gW = el('g', { filter: 'url(#pv-wash)', 'fill-opacity': 0.88 }, s);
    var gE = el('g', { filter: 'url(#pv-pool)', fill: 'none', class: 'pl-pool' }, s);
    var gL = el('g', { fill: 'none', stroke: INK, 'stroke-width': 0.9, 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }, s);
    var rims = [];
    var paths = pv.areas.map(function (d, i) {
      el('path', { d: d, 'vector-effect': 'non-scaling-stroke' }, gL);
      rims.push(el('path', { d: d, 'clip-path': rimClip(dfs, 'pv-', i, d) }, gE));
      return el('path', { d: d }, gW);
    });
    var gN = el('g', { class: 'pl-pv-names' }, s);
    PV_NAMES.forEach(function (n) {
      var t = el('text', { x: n.x, y: n.y, 'text-anchor': 'middle', class: 'pl-svg-caps' }, gN);
      t.textContent = n.name;
    });
    var deco = el('g', { class: 'pl-deco' }, s);

    var side = h('div', 'pl-pv-side', null, stage);
    var cart = h('div', 'pl-pv-cart', null, side);
    h('div', 'pl-pv-cap', 'Plat of Vancouver', cart);
    var yr = h('div', 'pl-pv-year', '', cart);
    var sub = h('div', 'pl-pv-sub', 'medians for a lot, in ' + pv.base + ' dollars', cart);
    sub.setAttribute('aria-hidden', 'true');
    // Two bars on one scale, never stacked: a median of land plus building is not the sum
    // of the two medians. A surveyor's rule beneath them marks that one scale.
    var bars = h('div', 'pl-pv-bars', null, side);
    function barRow(cls, word) {
      var row = h('div', 'pl-pv-row', null, bars);
      var k = h('span', 'pl-pv-k', null, row);
      h('span', 'pl-pv-w', word, k);
      var fig = h('span', 'pl-pv-fig', '', k);
      var track = h('span', 'pl-pv-track', null, row);
      return { k: fig, fill: h('span', 'pl-pv-fill ' + cls, null, track) };
    }
    var rowL = barRow('pl-pv-land', 'Land'), rowB = barRow('pl-pv-bldg', 'Building');

    var edges = pv.edges;
    var shares = P.pairBars(pv.city);
    var top = 0;
    pv.city.forEach(function (c) { top = Math.max(top, c[0], c[1]); });
    var rule = h('div', 'pl-pv-rule', null, bars);
    rule.setAttribute('aria-hidden', 'true');
    for (var v = 0; v <= top; v += 250000) {
      var tk = h('span', 'pl-pv-tick' + (v % 1000000 === 0 ? ' is-major' : v % 500000 === 0 ? ' is-half' : ''), null, rule);
      tk.style.left = (v / top * 100).toFixed(2) + '%';
      if (v % 1000000 === 0) h('span', 'pl-pv-tl', v ? '$' + v / 1000000 + 'M' : '0', tk);
    }

    // Lettering and furniture are sized in screen pixels, so they stay legible from the
    // smallest card up.
    function fit() {
      var w = s.getBoundingClientRect().width || 200;
      var hpx = s.getBoundingClientRect().height || 150;
      var u = Math.max(pv.w / w, pv.h / hpx); // viewBox units per CSS pixel (meet)
      dfs.tune(u);
      gE.setAttribute('stroke-width', (5 * u).toFixed(1));
      gN.setAttribute('font-size', (Math.min(14, Math.max(11, w * 0.042)) * u).toFixed(1));
      gN.style.setProperty('--u', u);
      deco.setAttribute('font-size', (11 * u).toFixed(1));
      deco.style.setProperty('--u', u);
      deco.textContent = '';
      // Lower left, where the city gives way to the Fraser: the arrow, then the rule.
      var sA = 0.45 * u, r = 17 * sA;
      var ax = r + 4 * u, ay = pv.h - r - 3 * u;
      var arrow = northArrow(deco, ax, ay, sA);
      arrow.querySelector('text').setAttribute('font-size', 25);
      scaleBar(deco, { m_per_unit: PV_M_PER_UNIT }, ax + r + 7 * u, pv.h - 6.5 * u, 2, 3.5 * u, true);
    }

    function show(k) {
      pv.values.forEach(function (row, i) {
        var v = row[k];
        var c = v ? P.classify(v, edges) : -1;
        paths[i].setAttribute('fill', c >= 0 ? WASH[c] : 'url(#pv-hatch)');
        rims[i].setAttribute('stroke', c >= 0 ? EDGE[c] : 'none');
      });
      yr.textContent = pv.years[k];
      var c = pv.city[k];
      rowL.fill.style.width = (shares[k][0] * 100).toFixed(1) + '%';
      rowB.fill.style.width = (shares[k][1] * 100).toFixed(1) + '%';
      rowL.k.textContent = P.money(c[0]);
      rowB.k.textContent = P.money(c[1]);
    }

    var last = pv.years.length - 1;
    var k = last, timer = null;
    show(last);
    fit();
    var ft = null;
    window.addEventListener('resize', function () { clearTimeout(ft); ft = setTimeout(fit, 100); });
    function tick() {
      k = k >= last ? 0 : k + 1;
      show(k);
      timer = setTimeout(tick, k === last ? 2200 : k === 0 ? 900 : 420);
    }
    Kit.onPlay(function (playing) {
      clearTimeout(timer);
      timer = null;
      if (playing) timer = setTimeout(tick, 900);
      else { k = last; show(last); }
    });
  }

  // ------------------------------------------------------------------ boot

  function fail(msg) {
    var p = h('p', 'pl-fail', msg, null);
    stage.insertBefore(p, stage.firstChild);
  }

  if (window.Kit && Kit.preview) {
    var sc = document.createElement('script');
    sc.src = 'data/preview.js';
    sc.onload = function () { initPreview(window.PLAT_PREVIEW); };
    document.head.appendChild(sc);
  } else {
    fetch('data/plat.json').then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }).then(initFull).catch(function () {
      fail('The assessment data could not be loaded. Try reloading the page.');
    });
  }
})();
