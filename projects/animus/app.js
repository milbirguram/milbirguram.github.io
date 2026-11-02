// Animus: page and preview. The mechanism lives in model.js; this file only draws it
// and wires up the controls.
(function () {
  'use strict';
  var M = window.AnimusModel, P = M.P, Kit = window.Kit;
  var SLIP = M.WORKSHOP_SLIP; // workshop wheel slip (the tests use the same value)
  var MAX_CARS = 8, MAX_LIGHTS = 4;
  var TRAIL_EVERY = 2;       // record a trail point every 2 physics steps (30 per second)
  var TRAIL_KEEP = 240;      // fading trails keep the last 8 seconds
  var DOT_EVERY = 15;        // on lasting tracks, a dot every 15 points = every half second

  var COL = {
    arena: '#f3f3ed', ink: '#343630', muted: '#686d62', line: '#dedfd7',
    lightCore: '#f2c14e', lightEdge: '#a8790f', hidden: '#343630', guess: '#a34f12'
  };

  var canvas = document.getElementById('an-canvas');
  var arenaEl = document.getElementById('an-arena');
  var ctx = canvas.getContext('2d');
  var panel = document.getElementById('an-panel');
  var pauseBtn = document.getElementById('an-pause');
  var speedSel = document.getElementById('an-speed');
  var barMode = document.getElementById('an-bar-mode');
  var hint = document.getElementById('an-hint');
  var tabW = document.getElementById('an-tab-workshop');
  var tabG = document.getElementById('an-tab-guess');
  var live = document.getElementById('an-live');
  function announce(text) { if (live) { live.textContent = ''; live.textContent = text; } }

  // ------------------------------------------------------------------ helpers
  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    if (html != null) e.innerHTML = html;
    return e;
  }
  function button(label, opts) {
    opts = opts || {};
    var b = el('button', { type: 'button', class: 'kit-button' + (opts.primary ? ' is-primary' : '') });
    b.textContent = label;
    if (opts.pressed != null) b.setAttribute('aria-pressed', opts.pressed ? 'true' : 'false');
    if (opts.label) b.setAttribute('aria-label', opts.label);
    if (opts.onclick) b.addEventListener('click', opts.onclick);
    return b;
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function torusDelta(d, size) { return d - size * Math.round(d / size); }
  var MINUS = '−';

  // ------------------------------------------------------------------ cars (vehicle + drawing state)
  function makeCar(o) {
    var v = M.makeVehicle({ x: o.x, y: o.y, th: o.th, wiring: o.wiring, jitter: o.slip || 0, seed: o.seed });
    return {
      v: v, px: o.x, py: o.y, pth: o.th, steps: 0, limit: o.limit || 0,
      colour: o.colour, label: o.label, name: o.name, fade: o.fade !== false,
      trail: [o.x, o.y], start: { x: o.x, y: o.y, th: o.th }, opts: o
    };
  }
  function resetCar(c) {
    var o = c.opts;
    c.v = M.makeVehicle({ x: o.x, y: o.y, th: o.th, wiring: o.wiring, jitter: o.slip || 0, seed: o.seed });
    c.px = o.x; c.py = o.y; c.pth = o.th; c.steps = 0; c.trail = [o.x, o.y];
  }
  function stepCar(c, lights) {
    if (c.limit && c.steps >= c.limit) { c.px = c.v.x; c.py = c.v.y; c.pth = c.v.th; return; }
    c.px = c.v.x; c.py = c.v.y; c.pth = c.v.th;
    M.step(c.v, lights);
    c.steps++;
    if (c.steps % TRAIL_EVERY === 0) {
      c.trail.push(c.v.x, c.v.y);
      if (c.fade && c.trail.length > TRAIL_KEEP * 2) c.trail.splice(0, c.trail.length - TRAIL_KEEP * 2);
    }
  }
  function classicCar(id, x, y, th, seed) {
    var info = M.CLASSIC_INFO[id];
    return makeCar({
      x: x, y: y, th: th, wiring: M.classic(info.wires, info.sign), slip: SLIP, seed: seed,
      colour: info.colour, label: id, name: id + ' ' + info.name
    });
  }

  // ------------------------------------------------------------------ scenes
  // Scenes are defined in model.js, where the tests check that each vehicle shows its character.
  function buildScene(S) {
    return {
      lights: clone(S.lights),
      cars: S.cars.map(function (c) { return classicCar(c.type, c.x, c.y, c.th, c.seed); })
    };
  }
  function workshopDefault() { return buildScene(M.SCENES.workshop); }
  var spawnRng = M.rng(2024), spawnSeed = 100;

  var state = {
    mode: 'workshop',
    paused: false,
    speed: { workshop: 1, guess: 2 },
    selected: 0,
    workshop: workshopDefault(),
    wiring: { wires: 'crossed', sign: 1 },
    guess: null
  };
  function scene() { return state.mode === 'workshop' ? state.workshop : state.guess.scene; }

  // ------------------------------------------------------------------ canvas sizing and transform
  var view = { w: 0, h: 0, dpr: 1, s: 1, ox: 0, oy: 0 };
  function resize() {
    var r = arenaEl.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (w === view.w && h === view.h && dpr === view.dpr) return;
    view.w = w; view.h = h; view.dpr = dpr;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    view.s = Math.min(w / P.W, h / P.H);
    view.ox = (w - P.W * view.s) / 2; view.oy = (h - P.H * view.s) / 2;
    glowCache = null;
    draw();
  }
  function toWorld(e) {
    var r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.ox) / view.s, y: (e.clientY - r.top - view.oy) / view.s };
  }

  // ------------------------------------------------------------------ drawing
  var glowCache = null;
  function glowSprite() {
    // Radial glow drawn from the same falloff the sensors use: 1 / (1 + d^2 / k).
    if (glowCache) return glowCache;
    var R = 3.2 * Math.sqrt(P.k);
    var px = Math.max(32, Math.ceil(R * view.s * view.dpr));
    var c = document.createElement('canvas');
    c.width = c.height = px * 2;
    var g = c.getContext('2d');
    var grad = g.createRadialGradient(px, px, 0, px, px, px);
    for (var i = 0; i <= 16; i++) {
      var t = i / 16, d = t * R;
      var a = 0.62 / (1 + d * d / P.k) * (1 - t * t);
      grad.addColorStop(t, 'rgba(236, 178, 52,' + a.toFixed(3) + ')');
    }
    g.fillStyle = grad;
    g.fillRect(0, 0, px * 2, px * 2);
    glowCache = { canvas: c, R: R };
    return glowCache;
  }

  function drawLights(lights, opts) {
    var gs = glowSprite();
    var s = view.s;
    lights.forEach(function (L) {
      // draw the light and its wrapped copies near the edges, since the floor is a torus
      for (var ix = -1; ix <= 1; ix++) for (var iy = -1; iy <= 1; iy++) {
        var x = L.x + ix * P.W, y = L.y + iy * P.H;
        if (x + gs.R < 0 || x - gs.R > P.W || y + gs.R < 0 || y - gs.R > P.H) continue;
        ctx.drawImage(gs.canvas, (x - gs.R) * s, (y - gs.R) * s, gs.R * 2 * s, gs.R * 2 * s);
      }
    });
    lights.forEach(function (L, i) {
      var r = Math.max(6, 8 * s);
      ctx.beginPath();
      ctx.arc(L.x * s, L.y * s, r, 0, Math.PI * 2);
      ctx.fillStyle = COL.lightCore; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = COL.lightEdge; ctx.stroke();
      if (opts.numbers) {
        if (opts.selected === i && opts.movable) {
          ctx.beginPath();
          ctx.arc(L.x * s, L.y * s, r + 5, 0, Math.PI * 2);
          ctx.setLineDash([3, 3]); ctx.strokeStyle = COL.ink; ctx.lineWidth = 1.25; ctx.stroke(); ctx.setLineDash([]);
        }
        label(String(i + 1), L.x * s + r + 4, L.y * s - r - 2, COL.muted);
      }
    });
  }

  var fontFamily = null;
  function label(text, x, y, colour) {
    if (!fontFamily) fontFamily = getComputedStyle(document.body).fontFamily;
    ctx.font = '500 12px ' + fontFamily;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3.5; ctx.strokeStyle = COL.arena; ctx.strokeText(text, x, y);
    ctx.fillStyle = colour; ctx.fillText(text, x, y);
  }

  // A trail stored as flat [x0, y0, x1, y1, ...]. Fading trails grow fainter with age.
  function drawTrail(pts, colour, fade, dashed, upTo) {
    var n = upTo == null ? pts.length / 2 : Math.min(upTo, pts.length / 2);
    if (n < 2) return;
    var s = view.s;
    ctx.strokeStyle = colour;
    ctx.lineWidth = Math.max(1.5, 2.6 * s);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (dashed) ctx.setLineDash([6, 5]);
    var chunk = fade ? 12 : n;
    for (var a = 1; a < n; a += chunk) {
      var b = Math.min(n, a + chunk);
      ctx.globalAlpha = fade ? 0.85 * Math.pow((a + b) / 2 / n, 1.3) : 0.85;
      ctx.beginPath();
      ctx.moveTo(pts[(a - 1) * 2] * s, pts[(a - 1) * 2 + 1] * s);
      for (var i = a; i < b; i++) {
        var x = pts[i * 2], y = pts[i * 2 + 1], x0 = pts[i * 2 - 2], y0 = pts[i * 2 - 1];
        if (Math.abs(x - x0) > P.W / 2 || Math.abs(y - y0) > P.H / 2) ctx.moveTo(x * s, y * s);
        else ctx.lineTo(x * s, y * s);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    if (!fade) {
      // a dot every half second: the gaps show speed
      ctx.fillStyle = colour;
      var r = Math.max(1.6, 2.4 * s);
      for (var j = DOT_EVERY; j < n; j += DOT_EVERY) {
        ctx.beginPath(); ctx.arc(pts[j * 2] * s, pts[j * 2 + 1] * s, r, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  function drawBody(x, y, th, colour, text) {
    var s = view.s;
    var k = Math.max(s, 0.72); // drawn a little larger than life on small screens, to stay legible
    // draw the vehicle and, near an edge, its wrapped copy
    var xs = [x], ys = [y];
    if (x < 20) xs.push(x + P.W); else if (x > P.W - 20) xs.push(x - P.W);
    if (y < 20) ys.push(y + P.H); else if (y > P.H - 20) ys.push(y - P.H);
    xs.forEach(function (xx) { ys.forEach(function (yy) {
      ctx.save();
      ctx.translate(xx * s, yy * s);
      ctx.rotate(th);
      ctx.scale(k, k);
      ctx.fillStyle = COL.ink;
      ctx.fillRect(-8, -12.5, 13, 4);   // left wheel
      ctx.fillRect(-8, 8.5, 13, 4);     // right wheel
      ctx.beginPath();
      roundRect(-12, -9, 26, 18, 5);
      ctx.fillStyle = colour; ctx.fill();
      ctx.fillStyle = '#fff6d8'; ctx.strokeStyle = COL.ink; ctx.lineWidth = 1;
      // the sensors, drawn where the model puts them
      ctx.beginPath(); ctx.arc(P.sensorFwd, -P.sensorSide, 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(P.sensorFwd, P.sensorSide, 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
    }); });
    if (text) label(text, x * s + 16 * k, y * s - 15 * k, colour);
  }
  function roundRect(x, y, w, h, r) {
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  }

  function lerpAngle(a, b, t) { var d = Math.atan2(Math.sin(b - a), Math.cos(b - a)); return a + d * t; }
  function carPose(c, t) {
    var x = c.v.x, y = c.v.y;
    if (Math.abs(x - c.px) > P.W / 2 || Math.abs(y - c.py) > P.H / 2) return { x: x, y: y, th: c.v.th };
    return { x: c.px + (x - c.px) * t, y: c.py + (y - c.py) * t, th: lerpAngle(c.pth, c.v.th, t) };
  }

  var fadeAlpha = 0; // preview fade between loops
  function draw(t) {
    if (t == null) t = 1;
    var dpr = view.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COL.arena;
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.save();
    ctx.translate(view.ox, view.oy);
    ctx.beginPath(); ctx.rect(0, 0, P.W * view.s, P.H * view.s); ctx.clip();
    var sc = scene();
    var G = state.mode === 'guess' ? state.guess : null;
    var movable = !Kit.preview && (state.mode === 'workshop' || (G && G.round.canMove && G.phase === 'watch'));
    drawLights(sc.lights, { numbers: !Kit.preview, selected: state.selected, movable: movable });
    if (G && G.phase === 'compared') {
      var cmp = G.compare, i = Math.min(cmp.idx, cmp.max);
      drawTrail(cmp.truthPts, COL.hidden, false, false, Math.floor(i / TRAIL_EVERY) + 1);
      drawTrail(cmp.guessPts, COL.guess, false, true, Math.floor(i / TRAIL_EVERY) + 1);
      var tp = cmp.truth, gp = cmp.guess;
      drawBody(gp.xs[i], gp.ys[i], gp.ths[i], COL.guess, 'your guess');
      drawBody(tp.xs[i], tp.ys[i], tp.ths[i], COL.hidden, 'hidden');
    } else {
      sc.cars.forEach(function (c) { drawTrail(c.trail, c.colour, c.fade, false); });
      sc.cars.forEach(function (c) {
        var p = carPose(c, t);
        drawBody(p.x, p.y, p.th, c.colour, c.label);
      });
    }
    ctx.restore();
    if (fadeAlpha > 0) {
      ctx.globalAlpha = fadeAlpha; ctx.fillStyle = COL.arena; ctx.fillRect(0, 0, view.w, view.h); ctx.globalAlpha = 1;
    }
  }

  // ------------------------------------------------------------------ simulation loop
  var raf = 0, last = 0, acc = 0, kitPlaying = true, dragging = -1;

  function hasWork() {
    if (Kit.preview) return true;
    var sc = scene();
    if (state.mode === 'workshop') return sc.cars.length > 0;
    var G = state.guess;
    if (G.phase === 'compared') return G.compare.idx < G.compare.max;
    return sc.cars.some(function (c) { return !c.limit || c.steps < c.limit; });
  }
  function shouldRun() { return kitPlaying && !state.paused && hasWork(); }

  function simStep() {
    var sc = scene();
    if (state.mode === 'guess' && state.guess.phase === 'compared') {
      if (state.guess.compare.idx < state.guess.compare.max) state.guess.compare.idx++;
      return;
    }
    sc.cars.forEach(function (c) { stepCar(c, sc.lights); });
  }

  function frame(now) {
    raf = 0;
    if (!shouldRun()) { draw(); afterStop(); return; }
    var dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    var speed = Kit.preview ? 1 : state.speed[state.mode];
    acc += dt * speed;
    var n = 0;
    while (acc >= P.dt && n < 40) { simStep(); acc -= P.dt; n++; }
    if (n >= 40) acc = 0;
    if (Kit.preview) previewTick(dt);
    draw(acc / P.dt);
    if (!Kit.preview) updateProgress();
    raf = requestAnimationFrame(frame);
  }
  function start() {
    if (raf || !shouldRun()) { if (!raf) draw(); return; }
    last = 0; acc = 0;
    raf = requestAnimationFrame(frame);
  }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; draw(); }
  var pendingDraw = 0;
  function requestDraw() {
    if (raf || pendingDraw) return;
    pendingDraw = requestAnimationFrame(function () { pendingDraw = 0; draw(); });
  }
  function afterStop() { if (!Kit.preview) { updateProgress(); refreshPause(); } }

  // ------------------------------------------------------------------ preview loop
  var previewClock = 0;
  function previewScene() { return buildScene(M.SCENES.preview); }
  function previewAdvance(seconds) {
    var n = Math.round(seconds / P.dt);
    for (var i = 0; i < n; i++) simStep();
  }
  function previewReset() {
    state.workshop = previewScene();
    previewAdvance(1);
    previewClock = 1;
  }
  function previewTick(dt) {
    previewClock += dt;
    if (previewClock > 10.4) { previewReset(); acc = 0; }
    if (previewClock > 9.8) fadeAlpha = Math.min(1, (previewClock - 9.8) / 0.6);
    else if (previewClock < 1.6) fadeAlpha = Math.max(0, 1 - (previewClock - 1) / 0.6);
    else fadeAlpha = 0;
  }

  // ------------------------------------------------------------------ vehicle diagram (SVG)
  // w: weights in units of one ordinary connection; ll, rr straight; lr, rl crossed.
  function diagram(w, title) {
    var S = { lx: 80, rx: 140, sy: 44, mlx: 68, mrx: 152, my: 150 };
    var wires = [
      { k: 'll', x1: S.lx, x2: S.mlx, t: 0.55 },
      { k: 'rr', x1: S.rx, x2: S.mrx, t: 0.55 },
      { k: 'lr', x1: S.lx, x2: S.mrx, t: 0.24 },
      { k: 'rl', x1: S.rx, x2: S.mlx, t: 0.24 }
    ];
    var out = '<svg viewBox="0 0 220 200" role="img" aria-label="' + title + '">';
    out += '<text x="110" y="13" text-anchor="middle" font-size="12" fill="#686d62">front</text>';
    out += '<rect x="48" y="28" width="124" height="160" rx="16" fill="#f3f3ed" stroke="#b5bdaf"/>';
    out += '<rect x="30" y="122" width="16" height="52" rx="4" fill="#343630"/>';
    out += '<rect x="174" y="122" width="16" height="52" rx="4" fill="#343630"/>';
    wires.forEach(function (wr) {
      var v = w[wr.k];
      if (!v) return;
      var x1 = wr.x1, y1 = S.sy + 8, x2 = wr.x2, y2 = S.my - 10;
      var exc = v > 0;
      var width = 1.2 + 1.6 * Math.abs(v);
      out += '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + (exc ? '#343630' : '#686d62') +
        '" stroke-width="' + width.toFixed(1) + '"' + (exc ? '' : ' stroke-dasharray="5 4"') + ' stroke-linecap="round"/>';
      var bx = x1 + (x2 - x1) * wr.t, by = y1 + (y2 - y1) * wr.t;
      var mag = Math.abs(v), txt = (exc ? '+' : MINUS) + (mag === 1 ? '' : mag === 0.5 ? '½' : String(mag));
      var r = txt.length > 1 ? 11 : 9;
      out += '<circle cx="' + bx.toFixed(1) + '" cy="' + by.toFixed(1) + '" r="' + r + '" fill="#faf9f6" stroke="#343630"/>';
      out += '<text x="' + bx.toFixed(1) + '" y="' + (by + 4.5).toFixed(1) + '" text-anchor="middle" font-size="' + (txt.length > 1 ? 12 : 15) + '" fill="#252821">' + txt + '</text>';
    });
    // sensors and motors drawn on top of the wires
    [S.lx, S.rx].forEach(function (x, i) {
      out += '<circle cx="' + x + '" cy="' + S.sy + '" r="10" fill="#f6dd8f" stroke="#343630"/>';
      out += '<text x="' + x + '" y="' + (S.sy + 4) + '" text-anchor="middle" font-size="11" fill="#252821">' + (i ? 'R' : 'L') + '</text>';
    });
    [S.mlx, S.mrx].forEach(function (x) {
      out += '<circle cx="' + x + '" cy="' + S.my + '" r="10" fill="#faf9f6" stroke="#343630"/>';
      out += '<text x="' + x + '" y="' + (S.my + 4) + '" text-anchor="middle" font-size="11" fill="#252821">M</text>';
    });
    return out + '</svg>';
  }
  function unitWeights(w) {
    return { ll: w.ll / P.gain, rr: w.rr / P.gain, lr: w.lr / P.gain, rl: w.rl / P.gain };
  }

  // ------------------------------------------------------------------ shared controls
  function segment(legend, options, current, onPick) {
    var fs = el('fieldset', { class: 'an-field' });
    fs.appendChild(el('legend', { text: legend }));
    var row = el('div', { class: 'an-seg' });
    options.forEach(function (o) {
      row.appendChild(button(o.label, {
        pressed: o.value === current,
        onclick: function () { onPick(o.value); }
      }));
    });
    fs.appendChild(row);
    fs.disable = function (d) { Array.prototype.forEach.call(row.children, function (b) { b.disabled = d; }); };
    return fs;
  }
  var WIRE_OPTS = [{ label: 'Straight', value: 'straight' }, { label: 'Crossed', value: 'crossed' }];
  var SIGN_OPTS = [{ label: '+ more light, faster', value: 1 }, { label: MINUS + ' more light, slower', value: -1 }];

  // ------------------------------------------------------------------ workshop panel
  function renderWorkshop() {
    var wg = state.wiring, id = M.classicId(wg.wires, wg.sign), info = M.CLASSIC_INFO[id];
    var sc = state.workshop;
    panel.innerHTML = '';
    panel.setAttribute('aria-labelledby', 'an-tab-workshop');
    panel.appendChild(el('h3', { text: 'Wire a vehicle' }));
    var dg = el('div', { class: 'an-diagram' }, diagram(unitWeights(M.classic(wg.wires, wg.sign)),
      'Wiring diagram: ' + (wg.wires === 'straight' ? 'each sensor to the motor on its own side' : 'each sensor to the motor on the far side') +
      ', ' + (wg.sign > 0 ? 'excitatory' : 'inhibitory')));
    panel.appendChild(dg);
    panel.appendChild(segment('Each sensor’s wire goes', WIRE_OPTS, wg.wires, function (v) { state.wiring.wires = v; renderWorkshop(); focusPressed(0); }));
    panel.appendChild(segment('Effect of light on the motor', SIGN_OPTS, wg.sign, function (v) { state.wiring.sign = v; renderWorkshop(); focusPressed(1); }));
    panel.appendChild(el('p', { class: 'an-muted an-small', text: 'In the dark every motor turns at the same steady cruising speed. A + wire adds to it as the light grows; a ' + MINUS + ' wire takes away from it, down to a stop.' }));
    var name = el('p', { class: 'an-name' });
    name.innerHTML = '<span class="an-swatch" style="background:' + info.colour + '"></span><strong>' + id + ' · ' + info.name + '.</strong> ' + info.text;
    panel.appendChild(name);
    var rel = button('Release a ' + id, { primary: true, onclick: function () { releaseCar(); } });
    rel.id = 'an-release';
    rel.disabled = sc.cars.length >= MAX_CARS;
    var row = el('div', { class: 'an-row' });
    row.appendChild(rel);
    panel.appendChild(row);

    panel.appendChild(el('h3', { text: 'In the arena' }));
    if (sc.cars.length) {
      var ul = el('ul', { class: 'an-cars', 'aria-label': 'Vehicles in the arena' });
      sc.cars.forEach(function (c, i) {
        var li = el('li');
        li.innerHTML = '<span class="an-swatch" style="background:' + c.colour + '"></span><span class="an-car-name">' + c.name + '</span>';
        var x = el('button', { type: 'button', class: 'an-x', 'aria-label': 'Remove ' + c.name, text: 'remove' });
        x.addEventListener('click', function () { sc.cars.splice(i, 1); renderWorkshop(); describeArena(); requestDraw(); });
        li.appendChild(x);
        ul.appendChild(li);
      });
      panel.appendChild(ul);
    } else {
      panel.appendChild(el('p', { class: 'an-muted', text: 'No vehicles yet. Release one.' }));
    }
    var row2 = el('div', { class: 'an-row' });
    var addL = button('Add light', { onclick: function () { addLight(); } });
    addL.disabled = sc.lights.length >= MAX_LIGHTS;
    var remL = button('Remove light ' + (state.selected + 1), { onclick: function () { removeLight(); } });
    remL.disabled = sc.lights.length <= 1;
    row2.appendChild(addL); row2.appendChild(remL);
    row2.appendChild(button('Clear vehicles', { onclick: function () { sc.cars = []; renderWorkshop(); describeArena(); requestDraw(); } }));
    panel.appendChild(row2);
    describeArena();
  }
  function focusPressed(fieldIndex) {
    var fs = panel.querySelectorAll('.an-field')[fieldIndex];
    var b = fs && fs.querySelector('[aria-pressed="true"]');
    if (b) b.focus();
  }

  function releaseCar() {
    var sc = state.workshop;
    if (sc.cars.length >= MAX_CARS) return;
    // a little way from a light and roughly facing it, so it meets one within a few seconds
    var pose = M.spawnPose(spawnRng, sc.lights);
    var id = M.classicId(state.wiring.wires, state.wiring.sign);
    sc.cars.push(classicCar(id, pose.x, pose.y, pose.th, spawnSeed++));
    renderWorkshop();
    var rel = document.getElementById('an-release');
    if (rel && !rel.disabled) rel.focus();
    start();
  }
  function addLight(at) {
    var sc = scene();
    if (sc.lights.length >= MAX_LIGHTS) return;
    var p = at || { x: 120 + spawnRng() * (P.W - 240), y: 90 + spawnRng() * (P.H - 180) };
    sc.lights.push({ x: p.x, y: p.y });
    state.selected = sc.lights.length - 1;
    if (state.mode === 'workshop') renderWorkshop();
    requestDraw();
  }
  function removeLight() {
    var sc = scene();
    if (sc.lights.length <= 1) return;
    sc.lights.splice(Math.min(state.selected, sc.lights.length - 1), 1);
    state.selected = Math.min(state.selected, sc.lights.length - 1);
    if (state.mode === 'workshop') renderWorkshop();
    requestDraw();
  }
  function resetWorkshop() {
    state.workshop = workshopDefault();
    state.selected = 0;
    renderWorkshop();
    start(); requestDraw();
  }

  // ------------------------------------------------------------------ guess game
  function defaultGuess(mode) {
    if (mode === 'classic') return { wires: 'straight', sign: 1 };
    if (mode === 'sensor') return { left: { to: 'same', sign: 1 }, right: { to: 'same', sign: 1 } };
    return { s: 0, c: 0 };
  }
  function startRound(i) {
    var R = M.ROUNDS[i];
    var G = state.guess;
    G.index = i; G.round = R; G.phase = 'watch'; G.compare = null; G.score = null;
    G.guessSpec = defaultGuess(R.mode);
    G.scene = {
      lights: clone(R.lights),
      cars: [makeCar({ x: R.start.x, y: R.start.y, th: R.start.th, wiring: M.specWiring(R.mode, R.truth),
        colour: COL.hidden, label: '?', name: 'hidden vehicle', fade: false, limit: M.roundSteps(R) })]
    };
    G.moved = false;
    state.selected = 0;
    renderGuess();
    describeArena();
    start(); requestDraw();
  }
  function newGame() {
    state.guess = { index: 0, results: [], round: null };
    startRound(0);
  }
  function replay() {
    var G = state.guess;
    G.scene.cars.forEach(resetCar);
    start(); requestDraw();
    updateProgress();
  }
  function lightsBack() {
    var G = state.guess;
    G.scene.lights = clone(G.round.lights);
    G.moved = false;
    renderGuess();
    replay();
  }
  function checkGuess() {
    var G = state.guess, R = G.round;
    var s = M.scoreGuess(R, G.guessSpec);
    G.score = s;
    G.results[G.index] = { accepted: s.accepted, exact: s.exact, sameHere: s.sameHere, moved: G.moved };
    G.phase = 'compared';
    G.scene.lights = clone(R.lights);
    G.compare = {
      truth: s.truthPath, guess: s.guessPath, idx: 0, max: s.truthPath.steps,
      truthPts: pathPoints(s.truthPath), guessPts: pathPoints(s.guessPath)
    };
    // When a wrong guess lands in the round's class, say whether the two are also close elsewhere.
    G.similarElsewhere = s.sameHere ? !M.clearlyDifferent(R.mode, R.truth, G.guessSpec) : null;
    G.twins = M.equivalenceClass(R).filter(function (k) { return k !== M.specKey(R.mode, R.truth); });
    // A wrong guess that steers by exactly the same law as the truth differs only in speed.
    G.sameTurn = !s.accepted && M.sameTurning(R.mode, G.guessSpec, R.truth);
    renderGuess();
    var res = document.getElementById('an-result-head');
    if (res) res.focus();
    var summary = panel.querySelector('.an-result');
    announce(summary ? Array.prototype.map.call(summary.children, function (c) { return c.textContent; }).join(' ') : '');
    describeArena();
    start(); requestDraw();
  }
  function replayCompare() {
    state.guess.compare.idx = 0;
    start(); requestDraw();
  }
  function pathPoints(p) {
    var out = [];
    for (var i = 0; i <= p.steps; i += TRAIL_EVERY) out.push(p.xs[i], p.ys[i]);
    return out;
  }
  function nextRound() {
    var G = state.guess;
    if (G.index + 1 < M.ROUNDS.length) startRound(G.index + 1);
    else { G.phase = 'done'; renderGuess(); var h = panel.querySelector('h3'); if (h) h.focus(); requestDraw(); }
  }
  function scoreSoFar() {
    var G = state.guess, n = 0, right = 0;
    G.results.forEach(function (r) { if (r) { n++; if (r.accepted) right++; } });
    return { n: n, right: right };
  }

  function guessControls(R, G, locked) {
    var wrap = el('div');
    var mode = R.mode, g = G.guessSpec;
    var w = unitWeights(M.specWiring(mode, g));
    wrap.appendChild(el('div', { class: 'an-diagram' }, diagram(w, 'Your guess: ' + M.describe(mode, g))));
    var fields = [];
    function rerender(fieldIndex) { renderGuess(); focusPressed(fieldIndex); }
    if (mode === 'classic') {
      fields.push(segment('Each sensor’s wire goes', WIRE_OPTS, g.wires, function (v) { g.wires = v; rerender(0); }));
      fields.push(segment('Effect of light on the motor', SIGN_OPTS, g.sign, function (v) { g.sign = v; rerender(1); }));
    } else if (mode === 'sensor') {
      ['left', 'right'].forEach(function (side, si) {
        var own = side, other = side === 'left' ? 'right' : 'left';
        fields.push(segment(side === 'left' ? 'Left sensor drives the' : 'Right sensor drives the',
          [{ label: own + ' wheel', value: 'same' }, { label: other + ' wheel', value: 'opposite' }], g[side].to,
          function (v) { g[side].to = v; rerender(si * 2); }));
        fields.push(segment('…and light makes that wheel', [{ label: '+ faster', value: 1 }, { label: MINUS + ' slower', value: -1 }], g[side].sign,
          function (v) { g[side].sign = v; rerender(si * 2 + 1); }));
      });
    } else {
      [['s', 'Straight wires (own side)'], ['c', 'Crossed wires (far side)']].forEach(function (pair) {
        var key = pair[0], id = 'an-w-' + key;
        var box = el('div', { class: 'an-range' });
        var lab = el('label', { for: id, text: pair[1] });
        var out = el('output', { for: id, id: id + '-out' });
        var inp = el('input', { type: 'range', id: id, min: '-2', max: '2', step: '1', value: String(g[key]) });
        var txt = function (v) { return v === 0 ? '0' : (v > 0 ? '+' : MINUS) + (Math.abs(v) === 1 ? '½' : '1'); };
        out.textContent = txt(g[key]);
        inp.setAttribute('aria-valuetext', txt(g[key]));
        inp.disabled = locked;
        inp.addEventListener('input', function () {
          g[key] = parseInt(inp.value, 10);
          out.textContent = txt(g[key]);
          inp.setAttribute('aria-valuetext', txt(g[key]));
          var d = wrap.querySelector('.an-diagram');
          d.innerHTML = diagram(unitWeights(M.specWiring(mode, g)), 'Your guess: ' + M.describe(mode, g));
        });
        box.appendChild(lab); box.appendChild(out); box.appendChild(inp);
        wrap.appendChild(box);
      });
    }
    fields.forEach(function (f) { if (locked) f.disable(true); wrap.appendChild(f); });
    return wrap;
  }

  function renderGuess() {
    var G = state.guess;
    panel.innerHTML = '';
    panel.setAttribute('aria-labelledby', 'an-tab-guess');
    if (G.phase === 'done') return renderEnd();
    var R = G.round, sc = scoreSoFar();
    var head = el('h3', { tabindex: '-1', text: 'Round ' + (G.index + 1) + ' of ' + M.ROUNDS.length + ' · ' + R.title });
    panel.appendChild(head);
    panel.appendChild(el('p', { class: 'an-muted an-small', text: sc.n ? 'Score so far: ' + sc.right + ' of ' + sc.n + '.' : 'Nothing scored yet.' }));

    if (G.phase === 'watch') {
      panel.appendChild(el('p', { text: R.prompt }));
      var row = el('div', { class: 'an-row' });
      row.appendChild(button('Replay', { onclick: replay }));
      if (R.canMove) {
        var back = button('Put lights back', { onclick: lightsBack });
        back.disabled = !G.moved;
        row.appendChild(back);
      }
      panel.appendChild(row);
      panel.appendChild(el('p', { class: 'an-progress', id: 'an-progress', 'aria-hidden': 'true' }));
      panel.appendChild(el('p', { class: 'an-muted an-small', text: 'Dots on the track mark every half second, so wider gaps mean it was going faster.' }));
      panel.appendChild(el('h3', { text: 'Your guess' }));
      panel.appendChild(guessControls(R, G, false));
      var row2 = el('div', { class: 'an-row' });
      row2.appendChild(button('Check my guess', { primary: true, onclick: checkGuess }));
      panel.appendChild(row2);
      updateProgress();
      return;
    }

    // compared
    var s = G.score, truthText = M.describe(R.mode, R.truth), guessText = M.describe(R.mode, G.guessSpec);
    var box = el('div', { class: 'an-result ' + (s.accepted ? 'is-right' : 'is-wrong') });
    var h = el('h3', { id: 'an-result-head', tabindex: '-1' });
    var html = '';
    if (s.exact) {
      h.textContent = 'Right.';
      html += '<p>It was ' + truthText + '.</p>';
      if (G.twins.length) {
        html += '<p>Note that ' + G.twins.join(', ') + ' would have counted too. ' +
          'These wirings behave the same here — this arena could not tell them apart.</p>';
      }
    } else if (s.sameHere) {
      h.textContent = 'Counted as right.';
      html += '<p>You said ' + guessText + '. It was ' + truthText + '. ' +
        'These two wirings behave the same here — this arena could not tell them apart.</p>';
      if (G.similarElsewhere === false) html += '<p>Elsewhere they part ways. Try moving the light off the line next time.</p>';
      else if (G.similarElsewhere === true) html += '<p>They stay close in other arenas too.</p>';
    } else {
      h.textContent = 'Not this time.';
      html += '<p>You said ' + guessText + '. It was ' + truthText + '.</p>';
      if (G.twins.length) html += '<p>In this arena ' + G.twins.join(', ') + ' would also have counted, because it behaves the same here.</p>';
      if (G.sameTurn) {
        var tr = M.speedRange(s.truthPath), gr = M.speedRange(s.guessPath);
        var pc = function (x) { return Math.round(x * 100) + '%'; };
        var gSwing = Math.max(gr.below, gr.above, tr.below, tr.above);
        html += '<p>Your wiring steers by exactly the same rule as the hidden one. They differ only in how light changes their speed. ' +
          'The hidden vehicle went from ' + pc(tr.below) + ' below to ' + pc(tr.above) + ' above its cruising speed; yours would have gone from ' +
          pc(gr.below) + ' below to ' + pc(gr.above) + ' above. ' +
          (gSwing < 0.25 ? 'A difference that small is hard to see, but it put the two on different paths here.' : 'That difference in speed is what gave it away.') + '</p>';
      }
    }
    if (R.lesson) html += '<p>' + R.lesson + '</p>';
    html += '<p class="an-muted an-small">Average gap between the two paths: ' + Math.round(s.distance) +
      ' units. Under ' + M.SAME_THRESHOLD + ' counts as the same; the arena is ' + P.W + ' wide.</p>';
    box.appendChild(h);
    box.insertAdjacentHTML('beforeend', html);
    panel.appendChild(box);
    panel.appendChild(el('div', { class: 'an-key' },
      '<span><svg width="28" height="6" aria-hidden="true"><line x1="0" y1="3" x2="28" y2="3" stroke="' + COL.hidden + '" stroke-width="2"/></svg>Solid: the hidden wiring</span>' +
      '<span><svg width="28" height="6" aria-hidden="true"><line x1="0" y1="3" x2="28" y2="3" stroke="' + COL.guess + '" stroke-width="2" stroke-dasharray="6 5"/></svg>Dashed: your guess, same start, original lights</span>'));
    var row3 = el('div', { class: 'an-row' });
    row3.appendChild(button('Replay comparison', { onclick: replayCompare }));
    row3.appendChild(button(G.index + 1 < M.ROUNDS.length ? 'Next round' : 'See your score', { primary: true, onclick: nextRound }));
    panel.appendChild(row3);
    panel.appendChild(el('h3', { text: 'Your guess' }));
    var w = unitWeights(M.specWiring(R.mode, G.guessSpec));
    panel.appendChild(el('div', { class: 'an-diagram' }, diagram(w, 'Your guess: ' + guessText)));
  }

  function renderEnd() {
    var G = state.guess, sc = scoreSoFar();
    panel.appendChild(el('h3', { tabindex: '-1', text: 'You read ' + sc.right + ' of ' + M.ROUNDS.length + ' wirings.' }));
    announce('You read ' + sc.right + ' of ' + M.ROUNDS.length + ' wirings.');
    var ol = el('ol', { class: 'an-score-list' });
    M.ROUNDS.forEach(function (R, i) {
      var r = G.results[i];
      var t = !r ? 'skipped' : r.exact ? 'right' : r.sameHere ? 'counted: same behaviour here' : 'missed';
      ol.appendChild(el('li', { text: R.title + ': ' + t }));
    });
    panel.appendChild(ol);
    var n = M.ROUNDS.length, experimented = G.results.some(function (r) { return r && r.moved; });
    var opening = sc.right === n ? 'All ' + n + '.'
      : sc.right * 2 > n ? 'Most of them, but not all.'
      : sc.right * 2 === n ? 'Half of them.'
      : 'Fewer than half.';
    opening += experimented ? ' You moved a light at least once, which tells you more than watching.' : ' You read them by watching alone, without moving a light.';
    panel.appendChild(el('p', { text: opening + ' Building any of these vehicles took two to four choices and a second. Running the other way, from tracks to wires, was slow and uncertain, and in one arena the answer was simply not in the behaviour.' }));
    panel.appendChild(el('p', { text: 'Braitenberg called this the law of uphill analysis and downhill invention: it is easy to invent a mechanism that produces a behaviour, and much harder to work out the mechanism by watching the behaviour. It is worth remembering the next time something seems to want something.' }));
    var row = el('div', { class: 'an-row' });
    row.appendChild(button('Play again', { primary: true, onclick: newGame }));
    row.appendChild(button('Back to the workshop', { onclick: function () { setMode('workshop'); tabW.focus(); } }));
    panel.appendChild(row);
  }

  var lastProgress = '';
  function updateProgress() {
    if (state.mode !== 'guess') return;
    var p = document.getElementById('an-progress');
    if (!p || !state.guess.scene) return;
    var c = state.guess.scene.cars[0], R = state.guess.round;
    var t = c.steps * P.dt;
    var txt = c.steps >= c.limit ? 'Run finished (' + R.seconds + ' s). Replay it, or make your guess.'
      : 't = ' + t.toFixed(1) + ' s of ' + R.seconds;
    if (txt !== lastProgress) { p.textContent = txt; lastProgress = txt; }
  }

  // ------------------------------------------------------------------ mode, pause, speed
  function setMode(m) {
    if (state.mode === m && panel.childNodes.length) return;
    state.mode = m;
    tabW.setAttribute('aria-selected', m === 'workshop' ? 'true' : 'false');
    tabG.setAttribute('aria-selected', m === 'guess' ? 'true' : 'false');
    tabW.tabIndex = m === 'workshop' ? 0 : -1;
    tabG.tabIndex = m === 'guess' ? 0 : -1;
    speedSel.value = String(state.speed[m]);
    barMode.innerHTML = '';
    if (m === 'workshop') {
      barMode.appendChild(button('Reset', { onclick: resetWorkshop, label: 'Reset the workshop' }));
      hint.textContent = 'Drag a light to move it. Tap empty ground to add one (up to four). Keyboard: focus the arena, press 1–4 to pick a light, then the arrow keys.';
      renderWorkshop();
    } else {
      if (!state.guess) newGame(); else renderGuess();
      hint.textContent = 'Lights are fixed in rounds 1 and 2. From round 3 you can drag them, or use 1–4 and the arrow keys.';
    }
    selectedClamp();
    describeArena();
    stop(); start(); requestDraw();
  }
  function selectedClamp() { state.selected = Math.min(state.selected, scene().lights.length - 1); }
  function refreshPause() {
    // the label says what pressing it will do; no aria-pressed, which would contradict the label
    pauseBtn.textContent = state.paused ? 'Play' : 'Pause';
  }
  pauseBtn.addEventListener('click', function () {
    state.paused = !state.paused;
    refreshPause();
    if (state.paused) stop(); else start();
  });
  speedSel.addEventListener('change', function () {
    state.speed[state.mode] = parseFloat(speedSel.value);
  });
  [tabW, tabG].forEach(function (t) {
    t.addEventListener('click', function () { setMode(t === tabW ? 'workshop' : 'guess'); });
    t.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        var other = t === tabW ? tabG : tabW;
        other.focus();
        setMode(other === tabW ? 'workshop' : 'guess');
        e.preventDefault();
      }
    });
  });

  function describeArena() {
    var sc = scene(), txt;
    if (state.mode === 'workshop') {
      txt = 'Arena with ' + sc.lights.length + ' light' + (sc.lights.length === 1 ? '' : 's') + ' and ' +
        (sc.cars.length ? sc.cars.length + ' vehicle' + (sc.cars.length === 1 ? '' : 's') + ': ' +
          sc.cars.map(function (c) { return c.name; }).join(', ') : 'no vehicles') + '. Trails fade as they age.';
    } else {
      var G = state.guess;
      txt = G.phase === 'compared'
        ? 'Comparison: the hidden vehicle’s path (solid) and your guess’s path (dashed) from the same start.'
        : 'Round ' + (G.index + 1) + ': a vehicle with hidden wiring drives among ' + sc.lights.length + ' light' + (sc.lights.length === 1 ? '' : 's') + ', leaving a trail.';
    }
    canvas.setAttribute('aria-label', txt);
  }

  // ------------------------------------------------------------------ pointer and keyboard on the arena
  function lightsMovable() {
    if (Kit.preview) return false;
    if (state.mode === 'workshop') return true;
    var G = state.guess;
    return G && G.phase === 'watch' && G.round.canMove;
  }
  function hitLight(p) {
    var sc = scene(), best = -1, bd = Math.max(26, 22 / view.s);
    sc.lights.forEach(function (L, i) {
      var d = Math.hypot(torusDelta(L.x - p.x, P.W), torusDelta(L.y - p.y, P.H));
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }
  function clampLight(L) {
    L.x = Math.max(8, Math.min(P.W - 8, L.x));
    L.y = Math.max(8, Math.min(P.H - 8, L.y));
  }
  function lightMoved() {
    if (state.mode === 'guess') {
      var G = state.guess;
      if (!G.moved) { G.moved = true; renderGuess(); }
    }
  }
  canvas.addEventListener('pointerdown', function (e) {
    if (!lightsMovable()) return;
    var p = toWorld(e), i = hitLight(p);
    if (i >= 0) {
      dragging = i; state.selected = i;
      canvas.setPointerCapture(e.pointerId);
      canvas.className = 'is-grabbing';
      e.preventDefault();
      requestDraw();
    } else if (state.mode === 'workshop' && p.x >= 0 && p.x <= P.W && p.y >= 0 && p.y <= P.H) {
      addLight(p);
    }
  });
  canvas.addEventListener('pointermove', function (e) {
    if (Kit.preview) return;
    var p = toWorld(e);
    if (dragging >= 0) {
      var L = scene().lights[dragging];
      if (!L) return;
      L.x = p.x; L.y = p.y; clampLight(L);
      requestDraw();
      return;
    }
    if (!lightsMovable()) { canvas.className = 'is-locked'; return; }
    canvas.className = hitLight(p) >= 0 ? 'is-grab' : (state.mode === 'workshop' ? '' : 'is-locked');
  });
  function endDrag() {
    if (dragging < 0) return;
    dragging = -1;
    canvas.className = 'is-grab';
    lightMoved();
    if (state.mode === 'workshop') renderWorkshop();
    else autoReplayIfDone();
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('lostpointercapture', endDrag);

  function autoReplayIfDone() {
    var G = state.guess;
    if (G && G.phase === 'watch') {
      var c = G.scene.cars[0];
      if (c.steps >= c.limit) replay();
    }
  }

  canvas.addEventListener('keydown', function (e) {
    if (!lightsMovable()) return;
    var sc = scene();
    if (/^[1-4]$/.test(e.key)) {
      var i = parseInt(e.key, 10) - 1;
      if (i < sc.lights.length) { state.selected = i; requestDraw(); if (state.mode === 'workshop') renderWorkshop(); canvas.focus(); }
      e.preventDefault();
      return;
    }
    var L = sc.lights[state.selected];
    if (!L) return;
    var step = e.shiftKey ? 40 : 10, moved = true;
    if (e.key === 'ArrowLeft') L.x -= step;
    else if (e.key === 'ArrowRight') L.x += step;
    else if (e.key === 'ArrowUp') L.y -= step;
    else if (e.key === 'ArrowDown') L.y += step;
    else moved = false;
    if (moved) {
      clampLight(L); e.preventDefault(); requestDraw();
      lightMoved();
      if (state.mode === 'guess') { canvas.focus(); autoReplayIfDone(); }
    }
  });

  // ------------------------------------------------------------------ start up
  if (window.ResizeObserver) new ResizeObserver(resize).observe(arenaEl);
  window.addEventListener('resize', resize);

  if (Kit.preview) {
    previewReset();
    var still = M.SCENES.preview.stillSeconds; // a representative still, checked by the tests
    previewAdvance(still - 1); previewClock = still;
    resize();
    Kit.onPlay(function (playing) { kitPlaying = playing; if (playing) start(); else stop(); });
  } else {
    if (Kit.reducedMotion) {
      state.paused = true;
      // a still that already shows each vehicle's character (the tests check this moment)
      var n = Math.round(M.SCENES.workshop.stillSeconds / P.dt);
      state.workshop.cars.forEach(function (c) { for (var i = 0; i < n; i++) stepCar(c, state.workshop.lights); });
    }
    refreshPause();
    setMode('workshop');
    resize();
    Kit.onPlay(function (playing) { kitPlaying = playing; if (playing) start(); else stop(); });
  }
})();
