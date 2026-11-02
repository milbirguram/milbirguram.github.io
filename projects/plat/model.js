/* Plat: the arithmetic behind the page, separate from drawing so it can be tested in Node.
 *
 * The pipeline (pipeline/build.py) publishes nominal figures only: for each local area,
 * roll year, property kind (non-strata, strata) and measure (land, building, total), the
 * count of properties and the 25th, 50th and 75th percentiles of assessed value.
 * Real figures are derived here. Deflating by one factor per year is exact for quantiles,
 * because every property in a year is scaled by the same positive number, so the order of
 * properties, and hence which one sits at the median, does not change.
 *
 * Works in the browser (window.Plat) and in Node (module.exports).
 */
(function (root) {
  'use strict';

  var KINDS = ['nonstrata', 'strata'];
  var MEASURES = ['land', 'building', 'total'];

  // A BC Assessment roll for year Y values property as of 1 July of Y - 1.
  function valuationYear(data, rollYear) { return rollYear - data.meta.valuation_lag; }

  // Multiply a nominal value from roll year Y by this to express it in base-year dollars.
  // CPI is the Vancouver all-items annual average for the valuation year.
  function cpiFactor(data, rollYear) {
    var cpi = data.meta.cpi;
    var v = cpi.values[String(valuationYear(data, rollYear))];
    var b = cpi.values[String(cpi.base_year)];
    if (!v || !b) return null;
    return b / v;
  }

  function yearIndex(data, year) { return data.meta.years.indexOf(year); }

  // One cell: {n, q1, med, q3} in the chosen dollars, or null when it was suppressed or empty.
  // `area` is an index into data.areas, or -1 for the whole city.
  function cell(data, area, year, kind, measure, basis) {
    var yi = yearIndex(data, year);
    if (yi < 0) return null;
    var block = area < 0 ? data.city[kind] : data.cells[kind];
    var n = area < 0 ? block.n[yi] : block.n[area][yi];
    if (!n) return null;
    var q = area < 0 ? block[measure][yi] : block[measure][area][yi];
    if (!q) return null;
    var f = basis === 'real' ? cpiFactor(data, year) : 1;
    if (f == null) return null;
    return { n: n, q1: q[0] * f, med: q[1] * f, q3: q[2] * f };
  }

  // Every published median for one view, over all areas and years.
  function medians(data, kind, measure, basis) {
    var out = [];
    for (var a = 0; a < data.areas.length; a++) {
      for (var i = 0; i < data.meta.years.length; i++) {
        var c = cell(data, a, data.meta.years[i], kind, measure, basis);
        if (c) out.push(c.med);
      }
    }
    return out.sort(function (x, y) { return x - y; });
  }

  // Class edges for one view, fixed across years so a colour means the same value in every
  // roll: k classes holding equal numbers of area-years (the pooled k-quantiles). Returns
  // k + 1 edges; the first is the lowest median and the last the highest. Equal-count
  // classes keep the many middling areas apart instead of letting Downtown's commercial
  // lots stretch the scale.
  function breaks(data, kind, measure, basis, k) {
    var v = medians(data, kind, measure, basis);
    if (!v.length) return null;
    var out = [v[0]];
    for (var i = 1; i < k; i++) {
      var pos = i / k * (v.length - 1);
      var lo = Math.floor(pos), f = pos - lo;
      out.push(v[lo] + (v[Math.min(lo + 1, v.length - 1)] - v[lo]) * f);
    }
    out.push(v[v.length - 1]);
    return out;
  }

  function classify(v, edges) {
    var k = edges.length - 1;
    for (var i = 1; i < k; i++) if (v < edges[i]) return i - 1;
    return k - 1;
  }

  // Percentage change of the median between two roll years, or null if either is missing.
  function change(data, area, kind, measure, basis, y0, y1) {
    var a = cell(data, area, y0, kind, measure, basis);
    var b = cell(data, area, y1, kind, measure, basis);
    if (!a || !b) return null;
    return b.med / a.med - 1;
  }

  // The first year in which this view has a value for this area (for "since" figures).
  function firstYear(data, area, kind, measure, basis) {
    var ys = data.meta.years;
    for (var i = 0; i < ys.length; i++) if (cell(data, area, ys[i], kind, measure, basis)) return ys[i];
    return null;
  }

  function money(v) {
    if (v == null || !isFinite(v)) return '—';
    var a = Math.abs(v);
    if (a >= 1e6) return '$' + (v / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'M';
    if (a >= 1e3) return '$' + Math.round(v / 1e3) + 'k';
    return '$' + Math.round(v);
  }

  function pct(x) {
    if (x == null || !isFinite(x)) return '—';
    var s = Math.round(x * 100);
    return (s > 0 ? '+' : s < 0 ? '−' : '') + Math.abs(s) + '%';
  }

  function count(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  // Every published cell, for checks: [{kind, area, year, n}].
  function publishedCells(data) {
    var out = [];
    KINDS.forEach(function (kind) {
      data.areas.forEach(function (_, a) {
        data.meta.years.forEach(function (y, yi) {
          var n = data.cells[kind].n[a][yi];
          if (n) out.push({ kind: kind, area: a, year: y, n: n });
        });
      });
    });
    return out;
  }

  // The card's two bars: the city's median land value and median building value of a lot,
  // each drawn as its own bar on one shared scale. They are never stacked, because the
  // median of land plus building is not the sum of the two medians.
  // `pairs` is [[land, building], ...] per year; returns [[landShare, buildingShare], ...]
  // as fractions of the largest single median.
  function pairBars(pairs) {
    var top = 0;
    pairs.forEach(function (p) { top = Math.max(top, p[0], p[1]); });
    return pairs.map(function (p) { return top > 0 ? [p[0] / top, p[1] / top] : [0, 0]; });
  }

  var Plat = {
    KINDS: KINDS,
    pairBars: pairBars,
    MEASURES: MEASURES,
    valuationYear: valuationYear,
    cpiFactor: cpiFactor,
    cell: cell,
    medians: medians,
    breaks: breaks,
    classify: classify,
    change: change,
    firstYear: firstYear,
    money: money,
    pct: pct,
    count: count,
    publishedCells: publishedCells
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Plat;
  else root.Plat = Plat;
})(this);
