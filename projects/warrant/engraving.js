// Warrant: the engraved seal. Pure decoration plus one signal: the seal cracks while coverage
// sits below the range expected if nothing had changed, and mends when it comes back.
// Guilloché linework is computed here (polar roses and a scalloped edge), not stored as artwork.
(function (root) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var TAU = Math.PI * 2;

  function r1(v) { return Math.round(v * 10) / 10; }
  function path(pts, close) {
    return 'M' + pts.map(function (p) { return r1(p[0]) + ' ' + r1(p[1]); }).join('L') + (close ? 'Z' : '');
  }
  // A closed polar curve rho(theta).
  function polar(rho, steps) {
    var pts = [];
    for (var i = 0; i < steps; i++) {
      var t = i / steps * TAU, r = rho(t);
      pts.push([r * Math.cos(t), r * Math.sin(t)]);
    }
    return path(pts, true);
  }
  function el(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  // The crack runs top to bottom; each half of the seal is clipped to one side of it.
  var CRACK = [[-3, -60], [-3, -46], [2, -34], [-4, -21], [3, -9], [-2, 5], [4, 18], [-3, 32], [1, 46], [1, 60]];

  function build(svg, uid) {
    svg.setAttribute('viewBox', '-50 -50 100 100');
    var defs = el('defs', {}, svg);
    var body = el('g', { id: uid + '-body' }, defs);

    // scalloped outer edge
    el('path', { d: polar(function (t) { return 46 + 2 * Math.cos(30 * t); }, 360), class: 'wa-seal-edge' }, body);
    el('circle', { r: 41, class: 'wa-seal-rule' }, body);
    el('circle', { r: 39.6, class: 'wa-seal-hair' }, body);
    // microprinted ring
    el('path', { id: uid + '-ring', d: 'M0 -32.5A32.5 32.5 0 1 1 0 32.5A32.5 32.5 0 1 1 0 -32.5', fill: 'none' }, defs);
    var tx = el('text', { class: 'wa-seal-micro', 'aria-hidden': 'true' }, body);
    var tp = el('textPath', { href: '#' + uid + '-ring', textLength: '200', lengthAdjust: 'spacing' }, tx);
    tp.textContent = 'Warrant · of · coverage · Warrant · of · coverage ·';
    el('circle', { r: 27.5, class: 'wa-seal-hair' }, body);
    // interlaced rosette band
    var lines = [];
    for (var j = 0; j < 6; j++) {
      (function (j) {
        lines.push(polar(function (t) { return 20.5 + 4.6 * Math.sin(12 * t + j * TAU / 12); }, 240));
      })(j);
    }
    for (j = 0; j < 4; j++) {
      (function (j) {
        lines.push(polar(function (t) { return 20.5 + 2.2 * Math.sin(24 * t + j * TAU / 8); }, 300));
      })(j);
    }
    el('path', { d: lines.join(''), class: 'wa-seal-lines' }, body);
    el('circle', { r: 14.6, class: 'wa-seal-centre' }, body);
    el('circle', { r: 13.4, class: 'wa-seal-hair' }, body);
    var centre = el('text', { class: 'wa-seal-text', 'text-anchor': 'middle', 'dominant-baseline': 'central', y: '0.5' }, body);

    var left = CRACK.concat([[-60, 60], [-60, -60]]);
    var right = CRACK.concat([[60, 60], [60, -60]]);
    el('path', { d: path(left, true) }, el('clipPath', { id: uid + '-l' }, defs));
    el('path', { d: path(right, true) }, el('clipPath', { id: uid + '-r' }, defs));

    // relief: a crisp offset impression under the print, as an embossing die leaves
    var g1 = el('g', { class: 'wa-seal-half wa-seal-l', 'clip-path': 'url(#' + uid + '-l)' }, svg);
    var g2 = el('g', { class: 'wa-seal-half wa-seal-r', 'clip-path': 'url(#' + uid + '-r)' }, svg);
    [g1, g2].forEach(function (g) {
      el('use', { href: '#' + uid + '-body', class: 'wa-seal-relief', x: '0.9', y: '1.1' }, g);
      el('use', { href: '#' + uid + '-body' }, g);
    });
    el('path', { d: path(CRACK.slice(1, -1)), class: 'wa-seal-crack' }, svg);
    return centre;
  }

  // Attach a seal to an <svg> element. Returns set(state, label, centreText),
  // where state is 'whole', 'broken' or 'mended'.
  function seal(svg, uid) {
    var centre = build(svg, uid || 'wa-seal');
    var cur = null;
    return function set(state, label, text) {
      if (text != null && centre.textContent !== text) centre.textContent = text;
      if (label != null) svg.setAttribute('aria-label', label);
      if (state !== cur) { svg.setAttribute('data-state', state); cur = state; }
    };
  }

  var api = { seal: seal };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WarrantEngraving = api;
})(typeof window !== 'undefined' ? window : this);
