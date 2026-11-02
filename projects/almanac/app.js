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
      if (cfg.hatch) {
        // a ruled hatch in black ink, for readings the contract set aside
        var defs = svgEl('defs', {});
        var pat = svgEl('pattern', { id: cfg.hatch, width: 4, height: 4, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
        pat.appendChild(svgEl('rect', { width: 1.6, height: 4, fill: ink }));
        defs.appendChild(pat);
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
          if (s.rule) { a.stroke = s.rule; a['stroke-width'] = 0.6; }
          svg.appendChild(svgEl('rect', a));
          base += s.v;
        });
        if (cfg.marker && cfg.marker(i)) {
          svg.appendChild(svgEl('circle', { cx: (x + bw / 2).toFixed(2), cy: g.m.t + g.ph + 6, r: Math.min(2.6, Math.max(1.6, bw / 2)), fill: 'none', stroke: cfg.markerColor, 'stroke-width': 1.1 }));
        }
      }
      svg.appendChild(svgEl('line', { x1: g.m.l, x2: g.m.l + g.pw, y1: y(0), y2: y(0), stroke: ink, 'stroke-width': 1.2 }));
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
    var hi = css('--spot') || '#d9662a', warn = css('--ink') || '#1f1b16';
    var fresh = !charts.hi;
    charts.hi = barChart(svg, {
      n: s.dates.length, max: 24, ticks: [0, 12, 24], dates: s.dates,
      segments: function (i) { return [{ v: ser.hi[i] || 0, color: hi }]; },
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
      s.style.gridColumn = String(m.col + 1);
      s.setAttribute('aria-hidden', 'true');
      box.appendChild(s);
    });
    [['Mon', 0], ['Wed', 2], ['Fri', 4]].forEach(function (w) {
      var s = el('span', 'wlabel', w[0]);
      s.setAttribute('aria-hidden', 'true');
      s.style.top = 'calc(16px + var(--gap) + ' + w[1] + ' * (var(--cell) + var(--gap)))';
      box.appendChild(s);
    });
    grid.cells.forEach(function (c, i) {
      var d = c.day;
      var b = el('button', 'cell s-' + d.status + (d.kinds && d.kinds.indexOf('scheduled') >= 0 ? ' is-sched' : ''));
      b.appendChild(mark(M.STATUS[d.status] ? d.status : 'none'));
      b.type = 'button';
      b.style.gridColumn = String(c.col + 1);
      b.style.gridRow = String(c.row + 2);
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
    // The card: an almanac sheet printing itself. Each day's run glyph is stamped into the
    // calendar in turn while the smoke-orange bars of high-risk hours rise beneath.
    var P = window.ALMANAC_PREVIEW;
    var canvas = $('preview');
    canvas.hidden = false;
    var full = $('full');
    if (full) full.hidden = true;
    if (!P) return;
    var ctx = canvas.getContext('2d');
    var n = P.cal.length;
    var firstDow = (new Date(Date.parse(P.first + 'T00:00:00Z')).getUTCDay() + 6) % 7;
    var weeks = Math.floor((n - 1 + firstDow) / 7) + 1;
    var FILL = 6400, HOLD = 2600, FADE = 500, LOOP = FILL + HOLD + FADE;
    var INK = css('--ink') || '#1f1b16', INK2 = css('--ink-2') || '#574e43', INK3 = css('--ink-3') || '#8c8274';
    var SPOT = css('--spot') || '#d9662a';
    var SERIF = '"Libre Caslon Text", Georgia, serif', DISPLAY = '"Libre Caslon Display", "Libre Caslon Text", Georgia, serif';
    var W = 0, H = 0, dpr = 1, raf = 0, t0 = 0, playing = false;

    function still() { draw(LOOP - FADE - 1); }

    function resize() {
      var r = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(1, r.width); H = Math.max(1, r.height);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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

    function draw(t) {
      ctx.clearRect(0, 0, W, H); // the stock and its grain show through from the stage
      var alpha = Math.max(0, t > FILL + HOLD ? 1 - (t - FILL - HOLD) / FADE : 1);
      ctx.globalAlpha = alpha;
      var pad = Math.round(Math.min(W, H) * 0.095);
      var per = FILL / n;
      var shown = Math.min(n, t / per);
      var small = Math.max(11, Math.round(H * 0.058));
      // calendar, top left
      var calH = H * 0.5;
      var gap = Math.max(1.5, Math.min(W, H) * 0.012);
      var cell = Math.floor(Math.min((calH - 6 * gap) / 7, (W * 0.54 - (weeks - 1) * gap) / weeks));
      cell = Math.max(5, cell);
      var cx = pad, cy = pad;
      for (var i = 0; i < n; i++) {
        var k = i + firstDow, col = Math.floor(k / 7), row = k % 7;
        var x = cx + col * (cell + gap) + cell / 2, y = cy + row * (cell + gap) + cell / 2;
        var p = ease((shown - i) * 1.6);
        var rad = cell * 0.4;
        if (p <= 0) {
          ctx.fillStyle = INK3; ctx.globalAlpha = 0.5 * alpha;
          ctx.fillRect(x - 0.5, y - 0.5, 1, 1);
          ctx.globalAlpha = alpha;
          continue;
        }
        // stamped in: the mark lands a little large and settles, like a pressed impression
        glyph(P.cal.charAt(i), x, y, rad * (1 + 0.5 * (1 - p)));
        if (P.backfill.charAt(i) === 's') {
          ctx.strokeStyle = INK; ctx.lineWidth = 1;
          ctx.strokeRect(x - cell / 2 + 0.5, y - cell / 2 + 0.5, cell - 1, cell - 1);
        }
      }
      var days = Math.min(n, Math.floor(shown));
      var total = 0;
      for (var j = 0; j < days; j++) total += P.hi[j];
      if (shown >= n) total = P.total;
      var calW = weeks * (cell + gap) - gap;
      var calBottom = cy + 7 * (cell + gap) - gap;
      ctx.fillStyle = INK2;
      ctx.font = 'italic ' + small + 'px ' + SERIF;
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      var ran = 0, sched = 0; // worked out from the log: never call a scheduled run backfilled
      for (var m = 0; m < days; m++) {
        if (P.cal.charAt(m) === 'n') continue;
        ran++;
        if (P.backfill.charAt(m) === 's') sched++;
      }
      fitText(ran + (ran === 1 ? ' run' : ' runs') + (ran === 0 ? '' : sched === 0 ? ', all backfilled' : ', ' + sched + ' on schedule'), cx, calBottom + small + 2, calW + pad);
      // the running answer, top right
      var rx = cx + calW + pad * 0.9, rw = W - rx - pad;
      var big = Math.round(Math.min(H * 0.27, rw * 0.46));
      ctx.fillStyle = INK;
      ctx.font = big + 'px ' + DISPLAY;
      var numY = cy + big * 0.78;
      ctx.fillText(String(total), rx, numY);
      var nw = ctx.measureText(String(total)).width;
      ctx.fillStyle = SPOT;
      ctx.fillRect(rx, numY + big * 0.1, Math.max(nw, big * 0.5), Math.max(2, big * 0.07));
      ctx.fillStyle = INK;
      ctx.font = 'italic ' + small + 'px ' + SERIF;
      fitText('high-risk hours', rx, numY + big * 0.17 + small * 1.15, rw);
      ctx.fillStyle = INK2;
      ctx.font = small + 'px ' + SERIF;
      fitText(P.city, rx, numY + big * 0.17 + small * 2.45, rw);
      fitText('since ' + M.dayLabel(P.first), rx, numY + big * 0.17 + small * 3.6, rw);
      // the bars, along the foot of the sheet
      var by = H - pad * 0.85, bx = pad, bwid = W - 2 * pad;
      var bh = Math.max(10, by - (calBottom + small * 1.9));
      var band = bwid / n;
      ctx.fillStyle = INK3;
      for (var dx = bx; dx < bx + bwid; dx += 4) ctx.fillRect(dx, by - bh, 1, 0.8); // the 24-hour line, dotted
      ctx.fillStyle = SPOT;
      for (var b = 0; b < n; b++) {
        var q = ease((shown - b) * 1.2);
        if (q <= 0 || !P.hi[b]) continue;
        var hgt = (P.hi[b] / 24) * bh * q;
        ctx.fillRect(bx + b * band, by - hgt, Math.max(1, band - (band > 3 ? 1 : 0)), hgt);
      }
      ctx.fillStyle = INK;
      ctx.fillRect(bx, by, bwid, 1.2);
      ctx.globalAlpha = 1;
    }

    function fitText(s, x, y, w) {
      while (s.length > 4 && ctx.measureText(s).width > w) s = s.slice(0, -2) + '…';
      ctx.fillText(s, x, y);
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
