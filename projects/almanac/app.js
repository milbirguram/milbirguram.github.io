// Almanac page. Loads only the pipeline's aggregates (data/aggregates/*.json) and draws
// the answer and the pipeline's health. In preview mode it draws a precomputed snapshot
// (data/aggregates/preview.js) on a canvas and makes no requests.
(function () {
  'use strict';
  var M = window.AlmanacModel;
  var Kit = window.Kit || { preview: false, onPlay: function (cb) { cb(true); }, reducedMotion: false };
  var params = new URLSearchParams(location.search);
  var injected = params.get('now'); // ?now=2026-11-05T12:00:00Z sets the clock, for testing the stale state
  function now() { return injected ? Date.parse(injected) : Date.now(); }
  var SVGNS = 'http://www.w3.org/2000/svg';

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function svgEl(tag, attrs, text) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }
  function css(name) { return getComputedStyle($('full') || document.body).getPropertyValue(name).trim(); }
  // the run glyphs: shape carries the status (see style.css), the words beside them say it
  function mark(status) {
    var s = el('span', 'mk mk-' + status);
    s.setAttribute('aria-hidden', 'true');
    return s;
  }

  if (Kit.preview) { startPreview(); return; }

  // ======================================================================== data

  var state = { summary: null, health: null, city: null, day: -1 };

  function getJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' answered ' + r.status);
      return r.json();
    });
  }

  Promise.all([getJSON('data/aggregates/summary.json'), getJSON('data/aggregates/health.json')])
    .then(function (res) {
      state.summary = res[0];
      state.health = res[1];
      state.health.calendar = M.extendCalendar(M.expandCalendar(state.health), now());
      state.city = M.ranked(state.summary)[0].id;
      var cal = state.health.calendar;
      for (var i = cal.length - 1; i >= 0; i--) { if (cal[i].status !== 'none') { state.day = i; break; } }
      $('loading').hidden = true;
      $('answer').hidden = false;
      $('health').hidden = false;
      renderAll();
      window.addEventListener('resize', debounce(drawCharts, 120));
      setInterval(renderFreshness, 60000);
    })
    .catch(function (err) {
      $('loading').hidden = true;
      var e = $('load-error');
      e.hidden = false;
      e.textContent = 'The aggregates could not be loaded (' + err.message + '). The pipeline’s files are in the data folder of this project.';
    });

  function debounce(fn, ms) {
    var t;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  function renderAll() {
    renderCities();
    renderHeadline();
    renderFreshness();
    renderTally();
    renderCalendar();
    renderContract();
    renderLineage();
    renderIssues();
    drawCharts();
  }

  // ======================================================================== the answer

  function renderCities() {
    var box = $('cities');
    box.textContent = '';
    M.ranked(state.summary).forEach(function (c) {
      var b = el('button', 'city');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(c.id === state.city));
      b.setAttribute('aria-label', c.city + ', ' + M.plural(c.high_hours, 'high-risk hour'));
      b.appendChild(el('span', null, c.city));
      b.appendChild(el('span', 'n', M.fmtInt(c.high_hours)));
      b.addEventListener('click', function () {
        state.city = c.id;
        renderCities();
        renderHeadline();
        drawHiChart();
        box.querySelector('[aria-pressed="true"]').focus();
      });
      box.appendChild(b);
    });
  }

  function longDate(iso) {
    var t = new Date(M.parse(iso));
    return t.getUTCDate() + ' ' + ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
      'September', 'October', 'November', 'December'][t.getUTCMonth()];
  }

  function renderHeadline() {
    var s = state.summary;
    var v = M.cityView(s, state.city);
    var c = v.city;
    $('big-n').textContent = M.fmtInt(v.total);
    $('big-unit').textContent = v.total === 1 ? 'hour' : 'hours';
    var span = longDate(s.first_date) + ' to ' + longDate(s.last_date) + ' ' + s.last_date.slice(0, 4);
    var sub = $('big-sub');
    sub.textContent = '';
    if (v.total > 0) {
      var pct = v.share * 100;
      sub.append('of high-risk air in ');
      sub.appendChild(el('b', null, c.city));
      sub.append(' from ' + span + ': ' + (pct < 1 ? 'under 1' : Math.round(pct)) + '% of the ' +
        M.fmtInt(c.hours_with_reading) + ' hours that had a reading. The worst day was ' +
        longDate(c.worst_day) + ', with ' + M.plural(c.worst_day_hours, 'hour') + '; the highest reading was ' + c.peak_label + '.');
    } else {
      sub.append('of high-risk air in ');
      sub.appendChild(el('b', null, c.city));
      sub.append(' from ' + span + '. Its highest reading was ' + c.peak_label + (c.peak_at ? ', on ' + longDate(c.peak_at.slice(0, 10)) : '') + '.');
    }
    var gap = $('big-gap');
    gap.hidden = !v.gappy;
    if (v.gappy) {
      gap.textContent = 'Readings are missing for ' + Math.round((1 - v.coverage) * 100) +
        '% of hours here' + (c.zone !== c.city ? ' (the ' + c.zone + ' zone)' : '') + ', so the true count may be higher.';
    }
    $('hi-cap').textContent = 'High-risk hours each day in ' + c.city + ' (0 to 24)';
    $('hi-chart').setAttribute('aria-label', 'Bar chart of high-risk hours each day in ' + c.city + ', ' +
      M.dayLabel(s.first_date) + ' to ' + M.dayLabel(s.last_date, true) + '; ' + M.plural(v.total, 'hour') +
      ' in all. Focus the chart and use the arrow keys to read each day.');
  }

  // ======================================================================== bar charts

  function barChart(svg, cfg) {
    var api = { index: -1 };
    function geom() {
      var w = svg.clientWidth || 600, h = svg.clientHeight || 180;
      var m = { l: 30, r: 8, t: 10, b: cfg.marker ? 30 : 24 };
      var pw = Math.max(10, w - m.l - m.r), ph = Math.max(10, h - m.t - m.b);
      return { w: w, h: h, m: m, pw: pw, ph: ph, band: pw / cfg.n };
    }
    api.draw = function () {
      var g = geom();
      svg.setAttribute('viewBox', '0 0 ' + g.w + ' ' + g.h);
      svg.textContent = '';
      var ink = css('--ink') || '#1f1b16', ink3 = css('--ink-3') || '#8c8274';
      if (cfg.hatch || cfg.spotHatch) {
        var defs = svgEl('defs', {});
        if (cfg.hatch) {
          // a ruled hatch in black ink, for readings the contract set aside
          var pat = svgEl('pattern', { id: cfg.hatch, width: 4, height: 4, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
          pat.appendChild(svgEl('rect', { width: 1.6, height: 4, fill: ink }));
          defs.appendChild(pat);
        }
        if (cfg.spotHatch) {
          // the spot colour is never laid flat: high-risk hours are a ruled hatch in smoke orange
          var sp = svgEl('pattern', { id: cfg.spotHatch, width: 3.4, height: 3.4, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
          sp.appendChild(svgEl('rect', { width: 1.5, height: 3.4, fill: cfg.spot }));
          defs.appendChild(sp);
        }
        svg.appendChild(defs);
      }
      var y = function (v) { return g.m.t + g.ph - (v / cfg.max) * g.ph; };
      cfg.ticks.forEach(function (t) {
        svg.appendChild(svgEl('line', { x1: g.m.l, x2: g.m.l + g.pw, y1: y(t), y2: y(t), stroke: ink3, 'stroke-width': 0.8, 'stroke-dasharray': '1 3' }));
        svg.appendChild(svgEl('text', { x: g.m.l - 6, y: y(t) + 4, 'text-anchor': 'end' }, String(t)));
      });
      var bw = Math.max(1, g.band - (g.band > 4 ? 1.5 : g.band > 2 ? 0.6 : 0));
      for (var i = 0; i < cfg.n; i++) {
        var x = g.m.l + i * g.band;
        var base = 0;
        cfg.segments(i).forEach(function (s) {
          if (!s.v) return;
          var a = { x: x.toFixed(2), y: y(base + s.v).toFixed(2), width: bw.toFixed(2), height: (y(base) - y(base + s.v)).toFixed(2) };
          if (s.outline) { a.fill = 'none'; a.stroke = s.color; a['stroke-width'] = 0.8; a['stroke-dasharray'] = '1 2'; } else a.fill = s.color;
          if (s.rule) { a.stroke = s.rule; a['stroke-width'] = s.ruleWidth || 0.6; }
          svg.appendChild(svgEl('rect', a));
          if (s.cap) {
            // the letterpress bite: ink gathers at the edge the type struck first
            svg.appendChild(svgEl('rect', { x: a.x, y: a.y, width: a.width, height: Math.min(1.6, +a.height).toFixed(2), fill: s.cap }));
          }
          base += s.v;
        });
        if (cfg.marker && cfg.marker(i)) {
          svg.appendChild(svgEl('circle', { cx: (x + bw / 2).toFixed(2), cy: g.m.t + g.ph + 6, r: Math.min(2.6, Math.max(1.6, bw / 2)), fill: 'none', stroke: cfg.markerColor, 'stroke-width': 1.1 }));
        }
      }
      svg.appendChild(svgEl('line', { x1: g.m.l, x2: g.m.l + g.pw, y1: y(0), y2: y(0), stroke: ink, 'stroke-width': 1.2 }));
      if (cfg.frame) {
        // a black-ruled frame round the plot, thick at the foot, as an almanac boxes its tables
        svg.appendChild(svgEl('rect', { x: g.m.l - 0.5, y: y(cfg.max) - 0.5, width: g.pw + 1, height: g.ph + 1, fill: 'none', stroke: ink, 'stroke-width': 1 }));
        svg.appendChild(svgEl('line', { x1: g.m.l - 1, x2: g.m.l + g.pw + 1, y1: y(0) + 1.5, y2: y(0) + 1.5, stroke: ink, 'stroke-width': 2 }));
      }
      (cfg.lines || []).forEach(function (L) {
        svg.appendChild(svgEl('line', { x1: g.m.l, x2: g.m.l + g.pw, y1: y(L.v), y2: y(L.v), stroke: L.color, 'stroke-width': 1.2, 'stroke-dasharray': '6 3' }));
        svg.appendChild(svgEl('text', { x: g.m.l + 6, y: y(L.v) - 6, 'class': 'halo', style: 'fill:' + L.color }, L.label));
      });
      // month labels at each month's first day
      var lastRight = -1;
      cfg.dates.forEach(function (d, i) {
        var day = +d.slice(8, 10);
        if (!(day === 1 || (i === 0 && day <= 20))) return;
        var x = g.m.l + i * g.band;
        if (x < lastRight) return;
        var label = M.MONTHS[+d.slice(5, 7) - 1];
        svg.appendChild(svgEl('text', { x: x, y: g.m.t + g.ph + (cfg.marker ? 21 : 17) }, label));
        lastRight = x + 30;
      });
      api.cursor = svgEl('rect', { x: 0, y: g.m.t, width: Math.max(2, g.band), height: g.ph, fill: 'rgba(31,27,22,0.1)', visibility: 'hidden' });
      svg.insertBefore(api.cursor, svg.firstChild);
      api.g = g;
      if (api.index >= 0) api.set(api.index, true);
    };
    api.set = function (i, quiet) {
      i = Math.max(0, Math.min(cfg.n - 1, i));
      api.index = i;
      if (api.cursor) {
        api.cursor.setAttribute('x', (api.g.m.l + i * api.g.band - (api.g.band < 3 ? 1 : 0)).toFixed(2));
        api.cursor.setAttribute('visibility', 'visible');
      }
      cfg.readout(i);
    };
    function fromEvent(e) {
      var r = svg.getBoundingClientRect();
      return Math.floor((e.clientX - r.left - api.g.m.l) / api.g.band);
    }
    svg.addEventListener('pointermove', function (e) { api.set(fromEvent(e)); });
    svg.addEventListener('pointerdown', function (e) { api.set(fromEvent(e)); });
    svg.addEventListener('keydown', function (e) {
      var i = api.index < 0 ? cfg.n - 1 : api.index;
      if (e.key === 'ArrowLeft') i--;
      else if (e.key === 'ArrowRight') i++;
      else if (e.key === 'Home') i = 0;
      else if (e.key === 'End') i = cfg.n - 1;
      else if (e.key === 'PageUp') i -= 7;
      else if (e.key === 'PageDown') i += 7;
      else return;
      e.preventDefault();
      api.set(i);
    });
    svg.addEventListener('focus', function () { if (api.index < 0) api.set(cfg.n - 1); });
    return api;
  }

  var charts = {};

  function drawCharts() { drawHiChart(); drawRowsChart(); }

  function drawHiChart() {
    var s = state.summary, id = state.city, ser = s.series[id];
    var keep = charts.hi ? charts.hi.index : -1;
    var svg = $('hi-chart');
    var hi = css('--spot') || '#d9662a', deep = css('--spot-deep') || '#a3441a', warn = css('--ink') || '#1f1b16';
    var fresh = !charts.hi;
    charts.hi = barChart(svg, {
      n: s.dates.length, max: 24, ticks: [0, 12, 24], dates: s.dates, spotHatch: 'almanac-spot', spot: hi, frame: true,
      segments: function (i) { return [{ v: ser.hi[i] || 0, color: 'url(#almanac-spot)', rule: hi, ruleWidth: 0.9, cap: deep }]; },
      marker: function (i) { return ser.n[i] !== null && ser.n[i] < 18; },
      markerColor: warn,
      readout: function (i) {
        var d = s.dates[i], n = ser.n[i];
        var t = M.longDay(d) + ': ';
        if (n === null) t += 'no data loaded for this day.';
        else {
          t += (ser.hi[i] ? M.plural(ser.hi[i], 'high-risk hour') : 'no high-risk hours') +
            ' in ' + s.cities.filter(function (c) { return c.id === id; })[0].city + '; ' +
            (n === 24 ? 'all 24 hours had a reading' : n + ' of 24 hours had a reading') +
            (ser.max[i] != null ? '; highest ' + (ser.max[i] >= 10.5 ? '10+' : Math.floor(ser.max[i] + 0.5)) : '') + '.';
        }
        $('hi-read').textContent = t;
      }
    });
    charts.hi.index = keep;
    charts.hi.draw();
    if (fresh || keep < 0) {
      // start the readout on the city's worst day, so the bars are explained at once
      var c = s.cities.filter(function (x) { return x.id === id; })[0];
      var wi = c.worst_day ? s.dates.indexOf(c.worst_day) : s.dates.length - 1;
      charts.hi.set(wi);
    } else charts.hi.set(keep);
  }

  function drawRowsChart() {
    var cal = state.health.calendar;
    var keep = charts.rows ? charts.rows.index : -1;
    var bar = css('--ink-3') || '#8c8274', bad = css('--ink') || '#1f1b16', faint = css('--ink-2') || '#574e43';
    var anyKept = cal.some(function (d) { return d.kept; });
    $('lg-kept').hidden = !anyKept;
    charts.rows = barChart($('rows-chart'), {
      n: cal.length, max: 168, ticks: [0, 168], dates: cal.map(function (d) { return d.date; }), hatch: 'almanac-hatch',
      lines: [{ v: 84, label: 'below 84, the day is refused', color: bad }],
      segments: function (i) {
        var d = cal[i];
        if (d.status === 'none') return [];
        var refused = d.loaded ? d.q : d.kept ? 0 : d.rows_in;
        var loaded = d.loaded ? d.rows_out : d.kept || 0; // a refused rerun leaves the earlier load counted
        return [
          { v: loaded, color: bar },
          { v: refused, color: 'url(#almanac-hatch)', rule: bad },
          { v: Math.max(0, 168 - loaded - refused), color: faint, outline: true }
        ];
      },
      marker: anyKept ? function (i) { return !!cal[i].kept; } : null,
      markerColor: bad,
      readout: function (i) {
        var d = cal[i];
        var t = M.longDay(d.date) + ': ';
        if (d.status === 'none') t += 'no run.';
        else if (!d.loaded && d.kept) t += 'the latest run was refused (' + M.fmtInt(d.rows_in) + ' readings arrived, none loaded); the earlier load of ' + M.fmtInt(d.kept) + ' readings is kept and still counted.';
        else if (!d.loaded) t += 'refused; ' + M.fmtInt(d.rows_in) + ' readings arrived and none were loaded.';
        else {
          t += M.fmtInt(d.rows_out) + ' of 168 readings loaded';
          if (d.q) t += ', ' + d.q + ' set aside';
          var miss = 168 - d.rows_in;
          t += miss > 0 ? ', ' + miss + ' missing at the source.' : ', none missing.';
        }
        $('rows-read').textContent = t;
      }
    });
    $('rows-chart').setAttribute('aria-label', 'Bar chart of readings loaded each day, out of 168 expected (7 cities, 24 hours). Focus it and use the arrow keys to read each day.');
    charts.rows.index = keep;
    charts.rows.draw();
    charts.rows.set(keep >= 0 ? keep : cal.length - 1);
  }

  // ======================================================================== freshness

  function renderFreshness() {
    var h = state.health, slo = h.contract.slo;
    var lr = h.latest_run;
    var f = M.freshness(now(), h.latest_hour, lr && lr.finished_at, slo);
    var word = $('fresh-word');
    word.textContent = '';
    var badge = el('span', 'badge ' + (f.state === 'fresh' ? 'is-fresh' : 'is-stale'), f.word);
    word.appendChild(badge);
    word.append(f.state === 'fresh' ? 'The data is up to date.' : 'The data is out of date.');
    var lines = $('fresh-lines');
    lines.textContent = '';
    lines.append('Newest hour: ' + M.stamp(h.latest_hour) + ', ' + M.ageText(f.dataAgeHours) + ' ago.');
    lines.appendChild(el('br'));
    if (lr) {
      lines.append('Last run: ' + M.stamp(lr.finished_at) + ', ' + M.ageText(f.runAgeHours) + ' ago (' +
        (M.KIND[lr.kind] || lr.kind) + ', ' + (M.STATUS[lr.status] || M.STATUS.none).word.toLowerCase() + ').');
    }
    f.reasons.forEach(function (r) { lines.appendChild(el('span', 'why', r)); });
    $('fresh-slo').textContent = slo.plain + (injected ? ' (Clock set to ' + M.stamp(new Date(now()).toISOString()) + ' for testing.)' : '');
    drawDial(f, slo);
    $('fresh').setAttribute('data-state', f.state);
  }

  function drawDial(f, slo) {
    // a printed clock face: 0 to 48 hours round the rim, the stale part ruled with hatching
    var svg = $('dial');
    svg.textContent = '';
    var ink = css('--ink') || '#1f1b16', ink2 = css('--ink-2') || '#574e43';
    var max = slo.max_data_age_hours * 4 / 3; // 48 h when the SLO is 36 h
    var cx = 60, cy = 60, r = 47, start = 135, sweep = 270;
    function pt(t, rr) {
      var a = (start + sweep * t) * Math.PI / 180;
      return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
    }
    function arc(t0, t1, rr, attrs) {
      var p0 = pt(t0, rr), p1 = pt(t1, rr);
      var large = (t1 - t0) * sweep > 180 ? 1 : 0;
      attrs.d = 'M' + p0[0].toFixed(2) + ' ' + p0[1].toFixed(2) + ' A' + rr + ' ' + rr + ' 0 ' + large + ' 1 ' + p1[0].toFixed(2) + ' ' + p1[1].toFixed(2);
      attrs.fill = 'none';
      svg.appendChild(svgEl('path', attrs));
    }
    var defs = svgEl('defs', {});
    var pat = svgEl('pattern', { id: 'dial-hatch', width: 3, height: 3, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
    pat.appendChild(svgEl('rect', { width: 1.1, height: 3, fill: ink }));
    defs.appendChild(pat);
    svg.appendChild(defs);
    var limit = slo.max_data_age_hours / max;
    arc(0, 1, r + 4, { stroke: ink, 'stroke-width': 1 });          // the rim
    arc(limit, 1, r - 3, { stroke: 'url(#dial-hatch)', 'stroke-width': 9 }); // stale: hatched
    for (var hgt = 0; hgt <= max + 0.01; hgt += 3) {
      var tt = hgt / max, major = hgt % 12 === 0;
      var p0 = pt(tt, r + 4), p1 = pt(tt, r + 4 - (major ? 8 : 4));
      svg.appendChild(svgEl('line', { x1: p0[0].toFixed(2), y1: p0[1].toFixed(2), x2: p1[0].toFixed(2), y2: p1[1].toFixed(2), stroke: ink, 'stroke-width': major ? 1.4 : 0.8 }));
    }
    [24].forEach(function (hh) {
      var q = pt(hh / max, r - 13);
      svg.appendChild(svgEl('text', { x: q[0].toFixed(2), y: (q[1] + 4).toFixed(2), 'text-anchor': 'middle', 'font-size': 10.5, fill: ink2 }, String(hh)));
    });
    var a = pt(limit, r - 10), b = pt(limit, r + 9);
    svg.appendChild(svgEl('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: ink, 'stroke-width': 2 }));
    var lab = pt(limit, r - 19);
    svg.appendChild(svgEl('text', { x: lab[0], y: lab[1] + 4, 'text-anchor': 'middle', 'font-size': 11, fill: ink }, slo.max_data_age_hours + 'h'));
    var age = isFinite(f.dataAgeHours) ? Math.max(0, f.dataAgeHours) : max;
    var t = Math.min(1, age / max);
    var n = pt(t, r - 11), tail = pt(t + 0.5, 9);
    svg.appendChild(svgEl('line', { x1: tail[0].toFixed(2), y1: tail[1].toFixed(2), x2: n[0].toFixed(2), y2: n[1].toFixed(2), stroke: ink, 'stroke-width': 1.8, 'stroke-linecap': 'butt' }));
    svg.appendChild(svgEl('circle', { cx: cx, cy: cy, r: 3.6, fill: ink }));
    svg.appendChild(svgEl('circle', { cx: cx, cy: cy, r: 1.3, fill: css('--stock') || '#f3ecdc' }));
    svg.appendChild(svgEl('text', { x: cx, y: cy + 31, 'text-anchor': 'middle', 'font-size': 15, 'font-family': css('--display') || 'serif', fill: ink }, f.word));
    svg.appendChild(svgEl('text', { x: cx, y: cy + 45, 'text-anchor': 'middle', 'font-size': 11, 'font-style': 'italic', fill: ink2 }, age >= max ? max + 'h+' : Math.round(age) + 'h old'));
    svg.setAttribute('aria-label', 'Freshness clock: ' + f.word + '. The newest hour is ' + M.ageText(f.dataAgeHours) + ' old; the limit is ' + slo.max_data_age_hours + ' hours.');
    svg.removeAttribute('aria-labelledby');
  }

  // ======================================================================== runs

  function renderTally() {
    var h = state.health, t = M.tally(h.calendar);
    var box = $('tally');
    box.textContent = '';
    box.appendChild(el('p', 'h3', M.plural(t.total, 'day') + ' with a run'));
    var ul = el('ul');
    [['pass', 'all checks passed'], ['warn', 'loaded with a warning'], ['fail', 'refused by the contract'], ['none', 'no run at all']].forEach(function (p) {
      var li = el('li');
      li.appendChild(mark(p[0]));
      li.append(M.fmtInt(t[p[0]] || 0) + ' ' + p[1]);
      ul.appendChild(li);
    });
    box.appendChild(ul);
    var note;
    if (t.scheduled === 0) {
      note = 'All ' + M.fmtInt(t.total) + ' were filled in by a backfill; none has run on its daily schedule yet.';
    } else {
      note = M.fmtInt(t.scheduled) + ' ran on the daily schedule; ' + M.fmtInt(t.backfill) + ' were filled in later by a backfill or revision.';
    }
    var w = M.warnCauses(h.calendar, h.check_names);
    if (w.top && w.topCount * 2 > w.total) {
      var def = h.contract.checks.filter(function (c) { return c.name === w.top; })[0];
      note += ' ' + (w.topCount === w.total ? 'Every warning' : M.fmtInt(w.topCount) + ' of the ' + M.fmtInt(w.total) + ' warnings') +
        ' came from the check “' + (def ? def.title : w.top) + '”.';
    }
    box.appendChild(el('p', 'note', note));
  }

  var cells = [];

  function renderCalendar() {
    var cal = state.health.calendar;
    var grid = M.calendarGrid(cal);
    var box = $('cal');
    box.textContent = '';
    cells = [];
    grid.months.forEach(function (m) {
      var s = el('span', 'mlabel', m.label);
      s.style.gridColumn = String(m.col + 2);
      s.setAttribute('aria-hidden', 'true');
      box.appendChild(s);
    });
    // the date of each week's Monday heads its column, in old-style numerals
    var first = M.parse(cal[0].date) - ((new Date(M.parse(cal[0].date)).getUTCDay() + 6) % 7) * 864e5;
    for (var wk = 0; wk < grid.weeks; wk++) {
      var dn = el('span', 'dnum', String(new Date(first + wk * 7 * 864e5).getUTCDate()));
      dn.style.gridColumn = String(wk + 2);
      dn.setAttribute('aria-hidden', 'true');
      box.appendChild(dn);
    }
    var corner = el('span', 'wcorner');
    corner.setAttribute('aria-hidden', 'true');
    box.appendChild(corner);
    // weekday heads in small capitals, Monday first; they stay put when the weeks scroll
    ['m', 't', 'w', 't', 'f', 's', 's'].forEach(function (w, r) {
      var s = el('span', 'wlabel', w);
      s.setAttribute('aria-hidden', 'true');
      s.style.gridRow = String(r + 3);
      box.appendChild(s);
    });
    grid.cells.forEach(function (c, i) {
      var d = c.day;
      var b = el('button', 'cell s-' + d.status + (d.kinds && d.kinds.indexOf('scheduled') >= 0 ? ' is-sched' : ''));
      b.appendChild(mark(M.STATUS[d.status] ? d.status : 'none'));
      b.type = 'button';
      b.style.gridColumn = String(c.col + 2);
      b.style.gridRow = String(c.row + 3);
      b.setAttribute('aria-label', M.describeDay(d));
      b.setAttribute('aria-pressed', String(i === state.day));
      b.tabIndex = i === state.day ? 0 : -1;
      b.addEventListener('click', function () { select(i, false); });
      b.addEventListener('mouseenter', function () { showTip(i); });
      b.addEventListener('mouseleave', hideTip);
      b.addEventListener('focus', function () { showTip(i); });
      b.addEventListener('blur', hideTip);
      b.addEventListener('keydown', function (e) {
        var step = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }[e.key];
        var j;
        if (step) j = i + step;
        else if (e.key === 'Home') j = 0;
        else if (e.key === 'End') j = cal.length - 1;
        else return;
        e.preventDefault();
        if (j < 0 || j >= cal.length) return;
        select(j, true);
      });
      box.appendChild(b);
      cells.push(b);
    });
    var sc = $('cal-scroll');
    sc.scrollLeft = sc.scrollWidth;
  }

  function select(i, focus) {
    var prev = cells[state.day];
    if (prev) { prev.setAttribute('aria-pressed', 'false'); prev.tabIndex = -1; }
    state.day = i;
    cells[i].setAttribute('aria-pressed', 'true');
    cells[i].tabIndex = 0;
    if (focus) cells[i].focus();
    renderContract();
  }

  function showTip(i) {
    var tip = $('tip'), b = cells[i], box = b.closest('.cal-box');
    tip.textContent = M.describeDay(state.health.calendar[i]);
    tip.hidden = false;
    var br = b.getBoundingClientRect(), xr = box.getBoundingClientRect();
    var left = br.left - xr.left + br.width / 2 - tip.offsetWidth / 2;
    left = Math.max(0, Math.min(xr.width - tip.offsetWidth, left));
    var top = br.top - xr.top - tip.offsetHeight - 8;
    if (top < 0) top = br.bottom - xr.top + 8;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }

  function hideTip() { $('tip').hidden = true; }

  var SOURCE_WORDS = {
    'hourly snapshot': 'ECCC’s live hourly file',
    'monthly archive': 'ECCC’s monthly archive',
    'revised monthly archive': 'ECCC’s corrected monthly archive'
  };

  function renderContract() {
    var h = state.health;
    var d = h.calendar[state.day];
    var head = $('contract-h'), day = $('contract-day'), list = $('checks');
    list.textContent = '';
    day.textContent = '';
    if (!d) { head.textContent = 'Contract results'; return; }
    head.textContent = 'Contract results for ' + M.longDay(d.date);
    if (d.status === 'none') {
      day.textContent = 'No run reached this day: the schedule did not fire, or the run stopped before it. Nothing was loaded.';
      return;
    }
    var st = M.STATUS[d.status];
    var dw = el('b', 'w-' + d.status);
    dw.appendChild(mark(d.status));
    dw.append(st.word);
    day.appendChild(dw);
    var src = d.src ? d.src.split(',').map(function (s) { return SOURCE_WORDS[s] || s; }).join(' and ') : 'no source file';
    day.append(': ' + st.day + '. ' + cap(M.KIND[d.kind] || d.kind) + (d.finished ? ', run ' + M.stamp(d.finished) : '') + ', read from ' + src + '. ' +
      M.loadedText(d) +
      (d.runs > 1 ? ' This day has ' + d.runs + ' runs (' + d.kinds.map(function (k) { return M.KIND[k] || k; }).join(', ') + '); the latest is shown.' : ''));
    (d.notes || []).forEach(function (n) { day.appendChild(el('span', 'why', ' ' + n)); });
    M.dayChecks(d, h).forEach(function (c) {
      var li = el('li', 'check');
      var s = M.STATUS[c.status];
      li.appendChild(mark(c.status));
      var title = el('p', 'check-title', c.title);
      title.appendChild(el('span', 'word w-' + c.status, s.word));
      li.appendChild(title);
      li.appendChild(el('p', 'check-detail', c.detail || 'Details are kept for the most recent 90 days only.'));
      var det = el('details');
      det.appendChild(el('summary', null, 'What this promise means'));
      det.appendChild(el('p', null, c.plain));
      li.appendChild(det);
      list.appendChild(li);
    });
  }

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // ======================================================================== lineage and issues

  function renderLineage() {
    var h = state.health, L = h.lineage;
    var nodes = [
      { step: 'Source', name: 'ECCC MSC Datamart', path: 'dd.weather.gc.ca', href: h.source.docs_url,
        what: 'Hourly AQHI per city: the live file covers the last 7 days; monthly archives cover older days.',
        num: M.plural(L.source.files, 'file') + ', ' + M.bytesText(L.source.downloaded_bytes) + ' fetched so far' },
      { step: 'Raw', name: 'As received', path: 'data/raw/', href: null,
        what: 'Each day’s rows exactly as ECCC wrote them, for the two regional files.',
        num: M.plural(L.raw.files, 'file') + ', ' + M.bytesText(L.raw.bytes) },
      { step: 'Gate', name: 'Data contract', path: 'pipeline/contract.json', href: 'pipeline/contract.json', gate: true,
        what: '7 checks. A day that fails stops here and is not loaded.',
        side: M.plural(L.quarantine.rows, 'reading') + ' set aside so far' },
      { step: 'Validated', name: 'Clean table', path: 'data/validated/', href: null,
        what: 'One row per city per hour, partitioned by day.',
        num: M.plural(L.validated.files, 'day') + ', ' + M.fmtInt(L.validated.rows) + ' rows' },
      { step: 'Aggregates', name: 'What this page loads', path: 'data/aggregates/', href: null,
        what: 'summary.json for the answer, health.json for everything about the runs.',
        num: M.bytesText(L.aggregates.bytes) + ' of a ' + M.bytesText(L.aggregates.budget) + ' budget' }
    ];
    var ol = $('lineage');
    ol.textContent = '';
    nodes.forEach(function (n) {
      var li = el('li', 'node' + (n.gate ? ' is-gate' : ''));
      li.appendChild(el('p', 'step', n.step));
      li.appendChild(el('p', 'name', n.name));
      var p = el('p', 'path');
      if (n.href) { var a = el('a', null, n.path); a.href = n.href; p.appendChild(a); } else p.textContent = n.path;
      li.appendChild(p);
      li.appendChild(el('p', 'what', n.what));
      if (n.num) li.appendChild(el('p', 'num', n.num));
      if (n.side) li.appendChild(el('p', 'side', n.side));
      ol.appendChild(li);
    });
    var note = $('lineage').parentNode.querySelector('.lineage-note') || el('p', 'micro lineage-note');
    note.textContent = '';
    note.append('Every run also appends one line to ');
    var a = el('a', null, 'data/runs.ndjson');
    a.href = 'data/runs.ndjson';
    note.appendChild(a);
    note.append(' (' + M.plural(L.runs_log.records, 'record') + ' so far): when it started and finished, what it read, each check’s result, and rows in and out. The pipeline is Python with only the standard library, so it runs the same on a laptop and in GitHub Actions.');
    note.style.marginTop = '14px';
    $('lineage').parentNode.appendChild(note);
  }

  function renderIssues() {
    var ul = $('issues');
    ul.textContent = '';
    state.health.known_issues.forEach(function (it) {
      var li = el('li', 'issue');
      var chip = el('span', 'chip is-' + it.status, cap(it.status));
      li.appendChild(chip);
      li.appendChild(el('b', null, it.title));
      li.append('. ' + it.detail + ' ');
      li.appendChild(el('span', 'when', 'Noted ' + M.dayLabel(it.opened, true) + '.'));
      ul.appendChild(li);
    });
  }

  // ======================================================================== preview

  function startPreview() {
    // The card: an almanac sheet. It opens finished (the answer, every run's glyph in its
    // weekday row, the hatched high-risk chart) and holds; then the press goes over it again:
    // the sheet dims to a blind impression and each day's glyph and bar is re-inked in turn.
    var P = window.ALMANAC_PREVIEW;
    var canvas = $('preview');
    canvas.hidden = false;
    var full = $('full');
    if (full) full.hidden = true;
    if (!P) return;
    var ctx = canvas.getContext('2d');
    var n = P.cal.length;
    var DAY = 864e5;
    var start = Date.parse(P.first + 'T00:00:00Z');
    var firstDow = (new Date(start).getUTCDay() + 6) % 7; // Monday = 0
    var weeks = Math.floor((n - 1 + firstDow) / 7) + 1;
    var monday0 = start - firstDow * DAY;
    var HOLD0 = 1200, DIM = 400, FILL = 5600, HOLD1 = 2200;
    var LOOP = HOLD0 + DIM + FILL + HOLD1; // 9.4 s
    var BLIND = 0.2; // a blind impression: the sheet before the ink goes on again
    var INK = css('--ink') || '#1f1b16', INK2 = css('--ink-2') || '#574e43', INK3 = css('--ink-3') || '#8a7f62';
    var SPOT = css('--spot') || '#d9662a', DEEP = css('--spot-deep') || '#a3441a';
    var PRESSED = '#3b342b'; // black ink a little starved in the middle of a large face
    var SERIF = '"Libre Caslon Text", Georgia, serif', DISPLAY = '"Libre Caslon Display", "Libre Caslon Text", Georgia, serif';
    var LEAF = typeof Path2D === 'function' ? new Path2D('M-5 0C-10 4-7 11 0 9C5 7.5 8 3 13 0C8-3 5-7.5 0-9C-7-11-10-4-5 0Z') : null;
    var STEM = typeof Path2D === 'function' ? new Path2D('M-5 0C-10 0-13-4-11-7C-9.5-9-6.5-8-7.5-5.5') : null;
    var W = 0, H = 0, dpr = 1, raf = 0, t0 = 0, playing = false, L = null;
    var cum = [0];
    for (var c0 = 0; c0 < n; c0++) cum.push(cum[c0] + (P.hi[c0] || 0));
    var ran = 0, sched = 0; // worked out from the log: never call a scheduled run backfilled
    for (var m0 = 0; m0 < n; m0++) {
      if (P.cal.charAt(m0) === 'n') continue;
      ran++;
      if (P.backfill.charAt(m0) === 's') sched++;
    }
    var runsText = ran + (ran === 1 ? ' run' : ' runs') + (ran === 0 ? '' : sched === 0 ? ', all backfilled' : ', ' + sched + ' on schedule');

    function still() { draw(0); }

    function layout() {
      var s = Math.min(W / 320, H / 200);
      var fs = Math.max(11, Math.round(11 * s));
      var pad = 13 * s, top = 12 * s;
      var wc = fs * 1.2 + 7 * s;
      var R = Math.max(98 * s, W * 0.31);
      var p = Math.min((W - 2 * pad - wc - R - 12 * s) / weeks, (H * 0.46) / 7);
      var calX = pad + wc;
      var gridTop = top + 2 * fs + 6 * s;
      var gridBottom = gridTop + 7 * p;
      var histBottom = H - 14 * s;
      var histTop = Math.min(gridBottom + 21 * s, histBottom - 24 * s);
      var rx = calX + weeks * p + 15 * s;
      return {
        s: s, fs: fs, pad: pad, top: top, wc: wc, p: p, calX: calX, calW: weeks * p,
        gridTop: gridTop, gridBottom: gridBottom, ornY: (gridBottom + histTop) / 2 + 0.5 * s,
        histTop: histTop, histBottom: histBottom, rx: rx, rw: W - pad - rx
      };
    }

    function resize() {
      var r = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(1, r.width); H = Math.max(1, r.height);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      L = layout();
      if (!playing) still();
    }

    function ease(x) { x = Math.max(0, Math.min(1, x)); return 1 - Math.pow(1 - x, 3); }

    function glyph(code, x, y, rad) {
      // the same shapes as the page: full disc, half disc, struck ring, point
      ctx.fillStyle = INK; ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, rad * 0.28);
      if (code === 'g') { ctx.beginPath(); ctx.arc(x, y, rad, 0, 2 * Math.PI); ctx.fill(); return; }
      if (code === 'n') { ctx.fillStyle = INK3; ctx.beginPath(); ctx.arc(x, y, Math.max(0.8, rad * 0.3), 0, 2 * Math.PI); ctx.fill(); return; }
      var ri = rad - ctx.lineWidth / 2;
      ctx.beginPath(); ctx.arc(x, y, ri, 0, 2 * Math.PI); ctx.stroke();
      if (code === 'a') { ctx.beginPath(); ctx.arc(x, y, ri, Math.PI / 2, Math.PI * 1.5); ctx.closePath(); ctx.fill(); }
      else if (code === 'r') { var d = ri * 0.72; ctx.beginPath(); ctx.moveTo(x - d, y - d); ctx.lineTo(x + d, y + d); ctx.stroke(); }
    }

    function hline(x0, x1, y, w, color) { ctx.fillStyle = color; ctx.fillRect(x0, y - w / 2, x1 - x0, w); }

    // The press. Returns how day i stands at time t:
    //   { ink: 0..1 how dark its finished impression is, stamp: 0..1 how far its re-inking has gone }
    var IN_FILL = HOLD0 + DIM, END_FILL = HOLD0 + DIM + FILL;
    function press(t, i) {
      if (t < HOLD0 || t >= END_FILL) return { ink: 1, stamp: 0 };
      if (t < IN_FILL) return { ink: 1 - (1 - BLIND) * (t - HOLD0) / DIM, stamp: 0 };
      var shown = (t - IN_FILL) / FILL * (n + 2);
      return { ink: BLIND, stamp: ease((shown - i) * 1.6) };
    }
    // days re-inked so far (the whole sheet outside the re-inking)
    function daysInked(t) {
      if (t < IN_FILL || t >= END_FILL) return n;
      return Math.max(0, Math.min(n, Math.floor((t - IN_FILL) / FILL * (n + 2))));
    }

    function draw(t) {
      var g = L, s = g.s, fs = g.fs;
      ctx.clearRect(0, 0, W, H); // the stock and its grain show through from the stage
      ctx.textBaseline = 'alphabetic';
      var spacing = 'letterSpacing' in ctx;

      // ---- the calendar: month heads, Monday numerals, weekday heads, one glyph per day
      ctx.font = fs + 'px ' + SERIF;
      ctx.textAlign = 'left';
      var lastMonth = -1, lastRight = -1;
      for (var i = 0; i < n; i++) {
        var mo = new Date(start + i * DAY).getUTCMonth();
        if (mo === lastMonth) continue;
        lastMonth = mo;
        var mx = g.calX + Math.floor((i + firstDow) / 7) * g.p;
        if (mx < lastRight) continue;
        var label = M.MONTHS[mo].toUpperCase();
        if (spacing) ctx.letterSpacing = (0.1 * fs).toFixed(1) + 'px';
        if (mx + 3 * s + ctx.measureText(label).width > g.calX + g.calW + 2 * s) continue; // no room left of the answer
        ctx.fillStyle = INK;
        ctx.fillText(label, mx + 3 * s, g.top + fs * 0.78);
        ctx.fillRect(mx, g.top - 1 * s, Math.max(0.8, 0.8 * s), fs * 0.95);
        lastRight = mx + ctx.measureText(label).width + 8 * s;
      }
      if (spacing) ctx.letterSpacing = '0px';
      ctx.textAlign = 'center';
      ctx.fillStyle = INK2;
      var every = ctx.measureText('28').width + 1.5 * s > g.p ? 2 : 1;
      for (var w = 0; w < weeks; w += every) {
        ctx.fillText(String(new Date(monday0 + w * 7 * DAY).getUTCDate()), g.calX + (w + 0.5) * g.p, g.top + fs * 1.85);
      }
      ctx.fillStyle = INK;
      ['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach(function (d, r) {
        ctx.fillText(d, g.pad + (g.wc - 3 * s) / 2, g.gridTop + (r + 0.5) * g.p + fs * 0.34);
      });
      // hairline rules: under the heads, at the foot, after the weekday column, between weeks
      var hair = Math.max(0.8, 0.8 * s);
      hline(g.pad, g.calX + g.calW, g.gridTop - 1.5 * s, hair, INK);
      hline(g.pad, g.calX + g.calW, g.gridBottom + 1.5 * s, hair, INK);
      ctx.fillRect(g.calX - 2 * s, g.gridTop - 1.5 * s, Math.max(0.7, 0.7 * s), g.gridBottom - g.gridTop + 3 * s);
      ctx.fillStyle = INK3;
      for (var v = 1; v < weeks; v++) ctx.fillRect(g.calX + v * g.p - 0.25, g.gridTop, 0.5, g.gridBottom - g.gridTop);

      var rad = g.p * 0.36;
      for (var j = 0; j < n; j++) {
        var kk = j + firstDow, cx = g.calX + (Math.floor(kk / 7) + 0.5) * g.p, cy = g.gridTop + (kk % 7 + 0.5) * g.p;
        var pr = press(t, j), code = P.cal.charAt(j);
        ctx.globalAlpha = pr.ink;
        glyph(code, cx, cy, rad);
        if (pr.stamp > 0) {
          // stamped in: the mark lands a little large and settles, like a pressed impression
          ctx.globalAlpha = pr.stamp;
          glyph(code, cx, cy, rad * (1 + 0.45 * (1 - pr.stamp)));
        }
        ctx.globalAlpha = 1;
        if (P.backfill.charAt(j) === 's') {
          ctx.strokeStyle = INK; ctx.lineWidth = 1;
          ctx.strokeRect(cx - g.p / 2 + 0.5, cy - g.p / 2 + 0.5, g.p - 1, g.p - 1);
        }
      }

      // ---- the ornament between the glyphs and the chart: swelled rules and a hedera
      ornament(g.pad + (g.wc + g.calW) / 2, g.ornY, s);

      // ---- the answer, right of the calendar. The figure never resets: it is the answer.
      var big = Math.round(Math.min(58 * s, g.rw / 1.62));
      var numY = g.top + big * 0.66;
      ctx.textAlign = 'left';
      ctx.font = big + 'px ' + DISPLAY;
      var num = String(P.total);
      ctx.fillStyle = PRESSED;
      ctx.fillText(num, g.rx, numY);
      ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, 1.1 * s); ctx.lineJoin = 'round';
      ctx.strokeText(num, g.rx, numY); // the bite: the ink gathers at the edges of the face
      var nw = ctx.measureText(num).width;
      // its rule: a black-ruled box hatched in the spot, filling as the press re-counts the hours
      var ry = numY + 7 * s, rh = 7 * s, rbw = Math.max(nw, big);
      var frac = P.total ? cum[daysInked(t)] / P.total : 1;
      if (t >= HOLD0 && t < IN_FILL) frac = 1;
      hatch(g.rx, ry, rbw * frac, rh, s, null);
      ctx.strokeStyle = INK; ctx.lineWidth = 1;
      ctx.strokeRect(g.rx + 0.5, ry + 0.5, rbw - 1, rh - 1);
      var ly = ry + rh + fs * 1.5, lh = fs * 1.28;
      ctx.fillStyle = INK; ctx.font = 'italic ' + (fs + 1) + 'px ' + SERIF;
      fitText('high-risk hours', g.rx, ly, g.rw);
      ctx.font = fs + 'px ' + SERIF;
      var where = wrapped(P.city + ', since ' + M.dayLabel(P.first), g.rw);
      where.forEach(function (line, li) { ctx.fillText(line, g.rx, ly + lh * (1 + li)); });
      ctx.fillStyle = INK2; ctx.font = 'italic ' + fs + 'px ' + SERIF;
      var after = 1 + where.length + 0.25;
      wrapped(runsText, g.rw).forEach(function (line, li) { ctx.fillText(line, g.rx, ly + lh * (after + li)); });

      // ---- the chart: hatched smoke-orange hours inside a black-ruled frame
      var x0 = g.pad, x1 = W - g.pad, yt = g.histTop, yb = g.histBottom;
      var band = (x1 - x0 - 2) / n, ph = yb - yt - 3 * s;
      var whole = [], fresh = [], ghost = 1;
      for (var b = 0; b < n; b++) {
        var hb = (P.hi[b] || 0) / 24 * ph, pb = press(t, b);
        whole.push(hb);
        fresh.push(hb * pb.stamp);
        ghost = pb.ink;
      }
      ctx.globalAlpha = ghost;
      bars(whole, x0 + 1, yb, band, s);
      ctx.globalAlpha = 1;
      if (t >= IN_FILL && t < END_FILL) bars(fresh, x0 + 1, yb, band, s);
      ctx.strokeStyle = INK; ctx.lineWidth = 1;
      ctx.strokeRect(x0 + 0.5, yt + 0.5, x1 - x0 - 1, yb - yt);
      hline(x0, x1, yb + Math.max(1, s), 2 * Math.max(1, s), INK);
      // the 12-hour line, dotted in a screen of black
      ctx.fillStyle = INK3;
      var y12 = yb - ph / 2;
      for (var dx = x0 + 3; dx < x1 - 2; dx += 4 * s) ctx.fillRect(dx, y12, 1, 0.8);
    }

    function hatch(x, y, w, h, s, clip) {
      if (w <= 0 || h <= 0) return;
      ctx.save();
      ctx.beginPath();
      if (clip) clip(); else ctx.rect(x, y, w, h);
      ctx.clip();
      var k = Math.max(1, s * 0.9);
      ctx.strokeStyle = SPOT; ctx.lineWidth = 1.25 * k;
      ctx.beginPath();
      for (var u = x - h; u < x + w + h; u += 3.2 * k) { ctx.moveTo(u, y + h); ctx.lineTo(u + h, y); }
      ctx.stroke();
      ctx.restore();
    }

    function bars(hs, x0, yb, band, s) {
      // one step outline per run of high-risk days: hatched inside, a darker spot edge round it
      function outline() {
        for (var i = 0; i < hs.length; i++) {
          if (hs[i] < 0.3) continue;
          var a = i;
          while (i + 1 < hs.length && hs[i + 1] >= 0.3) i++;
          ctx.moveTo(x0 + a * band, yb);
          for (var j = a; j <= i; j++) { ctx.lineTo(x0 + j * band, yb - hs[j]); ctx.lineTo(x0 + (j + 1) * band, yb - hs[j]); }
          ctx.lineTo(x0 + (i + 1) * band, yb);
          ctx.closePath();
        }
      }
      var top = 0;
      for (var k = 0; k < hs.length; k++) top = Math.max(top, hs[k]);
      if (top < 0.3) return;
      hatch(x0, yb - top, hs.length * band, top, s, outline);
      ctx.beginPath(); outline();
      ctx.strokeStyle = DEEP; ctx.lineWidth = Math.max(1, 1.1 * s); ctx.lineJoin = 'miter';
      ctx.stroke();
    }

    function ornament(cx, cy, s) {
      // a swelled rule each side of a hedera, the printer's ivy-leaf fleuron
      var half = Math.min(L.calW * 0.34, 64 * s), sw = 1.5 * s;
      ctx.fillStyle = INK;
      [-1, 1].forEach(function (sgn) {
        var a = cx + sgn * 10 * s, b = cx + sgn * (10 * s + half), mid = (a + b) / 2;
        ctx.beginPath();
        ctx.moveTo(a, cy); ctx.quadraticCurveTo(mid, cy - sw * 2, b, cy); ctx.quadraticCurveTo(mid, cy + sw * 2, a, cy);
        ctx.fill();
      });
      if (!LEAF) return;
      ctx.save();
      ctx.translate(cx + s, cy);
      ctx.scale(0.62 * s, 0.62 * s);
      ctx.fill(LEAF);
      ctx.strokeStyle = INK; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      ctx.stroke(STEM);
      ctx.strokeStyle = css('--stock') || '#ede0a6'; ctx.lineWidth = 1.1; ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.moveTo(-3, 0); ctx.lineTo(8, 0); ctx.stroke(); // the leaf's vein, left as bare stock
      ctx.restore();
    }

    function wrapped(str, w) {
      if (ctx.measureText(str).width <= w) return [str];
      var cut = str.indexOf(', ');
      return cut > 0 ? [str.slice(0, cut + 1), str.slice(cut + 2)] : [str];
    }

    function fitText(str, x, y, w) {
      while (str.length > 4 && ctx.measureText(str).width > w) str = str.slice(0, -2) + '…';
      ctx.fillText(str, x, y);
    }

    function frame(ts) {
      if (!t0) t0 = ts;
      draw((ts - t0) % LOOP);
      raf = requestAnimationFrame(frame);
    }

    window.addEventListener('resize', resize);
    resize();
    // the faces are self-hosted; once they arrive, redraw the still frame in them
    if (document.fonts && document.fonts.load) {
      Promise.all([document.fonts.load('40px ' + DISPLAY), document.fonts.load('italic 12px ' + SERIF), document.fonts.load('12px ' + SERIF)])
        .then(function () { if (!playing) still(); }, function () {});
    }
    Kit.onPlay(function (on) {
      playing = on;
      if (on) { t0 = 0; cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); }
      else { cancelAnimationFrame(raf); raf = 0; still(); }
    });
  }
})();
