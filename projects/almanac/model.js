// Almanac: the page's logic, kept apart from drawing so Node can test it.
// Works in the browser (window.AlmanacModel) and in Node (module.exports).
(function (root) {
  'use strict';

  var HOUR = 3600 * 1000;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function parse(iso) {
    if (!iso) return NaN;
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) iso += 'T00:00:00Z';
    return Date.parse(iso);
  }

  // ---- words and numbers -------------------------------------------------

  function plural(n, word, many) {
    return fmtInt(n) + ' ' + (n === 1 ? word : (many || word + 's'));
  }

  function fmtInt(n) {
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function ageText(hours) {
    if (!isFinite(hours)) return 'unknown';
    if (hours < 0) hours = 0;
    if (hours < 1) {
      var m = Math.round(hours * 60);
      return m <= 1 ? 'a minute' : m + ' minutes';
    }
    if (hours < 48) {
      var h = Math.round(hours);
      return h === 1 ? '1 hour' : h + ' hours';
    }
    var d = Math.floor(hours / 24);
    return d + ' days';
  }

  function dayLabel(iso, withYear) {
    var t = new Date(parse(iso));
    return t.getUTCDate() + ' ' + MONTHS[t.getUTCMonth()] + (withYear ? ' ' + t.getUTCFullYear() : '');
  }

  function longDay(iso) {
    var t = new Date(parse(iso));
    return DAYS[t.getUTCDay()] + ' ' + t.getUTCDate() + ' ' + LONG_MONTHS[t.getUTCMonth()] + ' ' + t.getUTCFullYear();
  }

  function stamp(iso) {
    var t = new Date(parse(iso));
    var hh = ('0' + t.getUTCHours()).slice(-2), mm = ('0' + t.getUTCMinutes()).slice(-2);
    return t.getUTCDate() + ' ' + MONTHS[t.getUTCMonth()] + ', ' + hh + ':' + mm + ' UTC';
  }

  function bytesText(b) {
    if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB';
    if (b >= 1e3) return Math.round(b / 1e3) + ' KB';
    return b + ' bytes';
  }

  // ---- freshness ---------------------------------------------------------
  // Fresh only when the newest hour of data is within the data SLO AND the pipeline
  // ran recently enough. `now` is injected so the rule can be tested without a clock.

  function freshness(now, latestHour, latestRunFinished, slo) {
    var dataAge = (now - parse(latestHour)) / HOUR;
    var runAge = (now - parse(latestRunFinished)) / HOUR;
    var reasons = [];
    if (!isFinite(dataAge)) reasons.push('There is no data yet.');
    else if (dataAge > slo.max_data_age_hours) {
      reasons.push('The newest hour is ' + ageText(dataAge) + ' old; the limit is ' + slo.max_data_age_hours + ' hours.');
    }
    if (!isFinite(runAge)) reasons.push('The pipeline has never run.');
    else if (runAge > slo.max_run_age_hours) {
      reasons.push('The last run was ' + ageText(runAge) + ' ago; it should run at least every ' + slo.max_run_age_hours + ' hours.');
    }
    var stale = reasons.length > 0;
    return {
      state: stale ? 'stale' : 'fresh',
      word: stale ? 'Stale' : 'Fresh',
      dataAgeHours: dataAge,
      runAgeHours: runAge,
      reasons: reasons,
      // fraction of the data SLO used, for the dial (can exceed 1)
      used: isFinite(dataAge) ? Math.max(0, dataAge) / slo.max_data_age_hours : Infinity
    };
  }

  // ---- runs and contract -------------------------------------------------

  var STATUS = {
    pass: { word: 'Passed', glyph: '✓', day: 'all checks passed' },
    warn: { word: 'Warning', glyph: '!', day: 'loaded with a warning' },
    fail: { word: 'Failed', glyph: '×', day: 'refused: a check failed' },
    skip: { word: 'Not run', glyph: '–', day: '' },
    none: { word: 'No run', glyph: '', day: 'no run for this day' }
  };
  var CODE = { p: 'pass', w: 'warn', f: 'fail', s: 'skip' };

  var KIND = {
    scheduled: 'scheduled run',
    manual: 'run by hand',
    backfill: 'backfill',
    revision: 'revision from ECCC’s corrected file'
  };

  function dayChecks(day, health) {
    // [{name, title, plain, status, detail}] for one calendar entry
    var defs = health.contract.checks;
    return defs.map(function (def, i) {
      var code = day.checks ? day.checks.charAt(i) : 's';
      return {
        name: def.name, title: def.title, plain: def.plain,
        status: CODE[code] || 'skip',
        detail: day.details ? day.details[i] : null
      };
    });
  }

  function describeDay(day) {
    var s = STATUS[day.status] || STATUS.none;
    if (day.status === 'none') return longDay(day.date) + '. No run.';
    var kind = KIND[day.kind] || day.kind;
    var parts = [longDay(day.date) + '.', s.word + ': ' + s.day + '.'];
    parts.push(kind.charAt(0).toUpperCase() + kind.slice(1) + (day.runs > 1 ? ' (' + day.runs + ' runs; latest shown)' : '') + '.');
    parts.push(loadedText(day));
    if (day.details && day.checks) {
      for (var i = 0; i < day.checks.length; i++) {
        var c = day.checks.charAt(i);
        if ((c === 'w' || c === 'f') && day.details[i]) { parts.push(day.details[i]); break; }
      }
    }
    return parts.join(' ');
  }

  function loadedText(day) {
    if (day.loaded) return fmtInt(day.rows_out) + ' of 168 readings loaded.';
    if (day.kept) return 'Nothing new loaded; the day’s earlier load (' + plural(day.kept, 'reading') + ') is kept and still counted.';
    return 'Nothing loaded.';
  }

  // Which check causes the amber days: {total, counts: {name: days}, top: name, topCount}
  function warnCauses(calendar, names) {
    var out = { total: 0, counts: {}, top: null, topCount: 0 };
    calendar.forEach(function (d) {
      if (d.status !== 'warn' || !d.checks) return;
      out.total++;
      for (var i = 0; i < d.checks.length && i < names.length; i++) {
        if (d.checks.charAt(i) === 'w') out.counts[names[i]] = (out.counts[names[i]] || 0) + 1;
      }
    });
    names.forEach(function (n) {
      if ((out.counts[n] || 0) > out.topCount) { out.top = n; out.topCount = out.counts[n]; }
    });
    return out;
  }

  // health.json keeps full entries for recent days and packs older ones into short tuples
  // (health.calendar_old); this returns one plain entry per day, oldest first.
  var UNPACK = {
    status: { p: 'pass', w: 'warn', f: 'fail', n: 'none' },
    kind: { s: 'scheduled', m: 'manual', b: 'backfill', r: 'revision' },
    src: { H: 'hourly snapshot', M: 'monthly archive', R: 'revised monthly archive' }
  };
  function expandCalendar(health) {
    var out = [], old = health.calendar_old;
    if (old && old.days && old.days.length) {
      var t0 = parse(old.first);
      old.days.forEach(function (t, i) {
        var ds = new Date(t0 + i * 24 * HOUR).toISOString().slice(0, 10);
        if (t[0] === 'n') { out.push({ date: ds, status: 'none' }); return; }
        var d = { date: ds };
        old.fields.forEach(function (f, k) { d[f] = t[k]; });
        d.status = UNPACK.status[d.status];
        d.kind = UNPACK.kind[d.kind];
        d.kinds = d.kinds.split('').map(function (c) { return UNPACK.kind[c]; });
        d.loaded = !!d.loaded;
        d.src = d.src.split('').map(function (c) { return UNPACK.src[c] || c; }).sort().join(',');
        if (!d.kept) delete d.kept;
        out.push(d);
      });
    }
    return out.concat(health.calendar || []);
  }

  function tally(calendar) {
    var t = { pass: 0, warn: 0, fail: 0, none: 0, backfill: 0, scheduled: 0, total: 0 };
    calendar.forEach(function (d) {
      t[d.status] = (t[d.status] || 0) + 1;
      if (d.status !== 'none') {
        t.total++;
        if (d.kind === 'backfill' || d.kind === 'revision') t.backfill++;
        if (d.kind === 'scheduled') t.scheduled++;
      }
    });
    return t;
  }

  // Lay days out as week columns (Monday first), like a wall calendar turned sideways.
  function calendarGrid(calendar) {
    if (!calendar.length) return { weeks: 0, cells: [], months: [] };
    var first = new Date(parse(calendar[0].date));
    var offset = (first.getUTCDay() + 6) % 7; // Monday = 0
    var cells = [], months = [], lastMonth = -1;
    calendar.forEach(function (d, i) {
      var k = i + offset;
      var col = Math.floor(k / 7), row = k % 7;
      var m = new Date(parse(d.date)).getUTCMonth();
      if (m !== lastMonth) { months.push({ col: col, label: MONTHS[m] }); lastMonth = m; }
      cells.push({ day: d, col: col, row: row });
    });
    return { weeks: Math.floor((calendar.length - 1 + offset) / 7) + 1, cells: cells, months: months };
  }

  // The pipeline can only log days it ran. If it stops, the page itself adds the missing
  // days, up to yesterday by the visitor's clock, as "no run", so a silent gap still shows.
  function extendCalendar(calendar, now) {
    var out = calendar.slice();
    if (!out.length) return out;
    var day = 24 * HOUR;
    var last = parse(out[out.length - 1].date);
    var yesterday = Math.floor(now / day) * day - day;
    for (var t = last + day, k = 0; t <= yesterday && k < 400; t += day, k++) {
      out.push({ date: new Date(t).toISOString().slice(0, 10), status: 'none', added: true });
    }
    return out;
  }

  // ---- the answer --------------------------------------------------------

  function cityView(summary, id) {
    var c = null;
    summary.cities.forEach(function (x) { if (x.id === id) c = x; });
    if (!c) return null;
    var s = summary.series[id];
    var sum = 0;
    s.hi.forEach(function (h) { if (h) sum += h; });
    var coverage = c.hours_possible ? c.hours_with_reading / c.hours_possible : 0;
    return {
      city: c, total: c.high_hours, seriesTotal: sum, coverage: coverage,
      share: c.hours_with_reading ? c.high_hours / c.hours_with_reading : 0,
      gappy: coverage < 0.9
    };
  }

  function ranked(summary) {
    return summary.cities.slice().sort(function (a, b) {
      return b.high_hours - a.high_hours || summary.cities.indexOf(a) - summary.cities.indexOf(b);
    });
  }

  var api = {
    parse: parse, plural: plural, fmtInt: fmtInt, ageText: ageText, dayLabel: dayLabel, longDay: longDay,
    stamp: stamp, bytesText: bytesText, freshness: freshness, STATUS: STATUS, KIND: KIND,
    dayChecks: dayChecks, describeDay: describeDay, loadedText: loadedText, warnCauses: warnCauses, expandCalendar: expandCalendar,
    extendCalendar: extendCalendar, tally: tally, calendarGrid: calendarGrid,
    cityView: cityView, ranked: ranked, MONTHS: MONTHS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AlmanacModel = api;
})(this);
