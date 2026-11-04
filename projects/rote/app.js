/* Rote — page and preview. Readings come from model.js (copy, lookup, rules) and from
   data/demo.json (precomputed neural readings for held-out test sentences). Every number
   shown is read from data/eval.json. */
(function () {
  'use strict';
  var R = window.Rote;
  var $ = function (id) { return document.getElementById(id); };

  // scored systems; the tape shows the first four (gated readings are not stored per token)
  var SYSTEMS = ['copy', 'lookup', 'rules', 'neural', 'gated'];
  var TAPE = ['copy', 'lookup', 'rules', 'neural'];
  var SYS_LABEL = { copy: 'copy', lookup: 'lookup', rules: 'rules', neural: 'neural', gated: 'gated' };
  var FAMILY = {
    CARDINAL: 'quantity', DECIMAL: 'quantity', ORDINAL: 'quantity', DIGIT: 'quantity', FRACTION: 'quantity',
    MONEY: 'quantity', MEASURE: 'quantity', DATE: 'calendar', TIME: 'calendar',
    LETTERS: 'spelled', VERBATIM: 'spelled', ELECTRONIC: 'spelled', TELEPHONE: 'spelled', ADDRESS: 'spelled',
    PLAIN: 'plain', PUNCT: 'plain'
  };

  // ---------------------------------------------------------------- preview
  // Wrong readings are documented errors, stamped with their source: "nine hundred euros" is the RNN
  // misreading Sproat and Jaitly describe; the other two are conTEXT's own outputs listed in its README.
  // None of the systems on this page makes them. Right readings come from the rules.
  var PREVIEW = [
    { tok: '£900', wrong: 'nine hundred euros', src: 'RNN, Sproat & Jaitly' },
    { tok: '3,500 kg', wrong: 'hundred hundred five meters', src: 'conTEXT' },
    { tok: 'May 20, 2008', wrong: 'december twentieth two thousand eight', src: 'conTEXT' }
  ];

  var ITA2 = { A: '11000', B: '10011', C: '01110', D: '10010', E: '10000', F: '10110', G: '01011', H: '00101', I: '01100',
    J: '11010', K: '11110', L: '01001', M: '00111', N: '00110', O: '00011', P: '01101', Q: '11101', R: '01010', S: '10100',
    T: '00001', U: '11100', V: '01111', W: '11001', X: '10111', Y: '10101', Z: '10001', ' ': '00100' };

  // The card is a teleprinter: the printout advances a line at a time and never clears, the
  // tape below punches each surviving reading in five-hole ITA2 code, and a two-line tally at the
  // foot of the paper sets the claimed figure against the honest one. One cycle ends exactly where
  // it began, so the still frame (paused, or reduced motion) is the fully printed state.
  function runPreview() {
    $('rt-app').hidden = true;
    var box = $('rt-preview');
    box.hidden = false;
    // the two figures sit in index.html as [data-num] spans that tests/test_numbers.js checks
    // against data/eval.json, so the card needs no request of its own
    var claimed = box.querySelector('[data-num="original.claimed_val_acc"]').textContent;
    var hard = box.querySelector('[data-num="scores.01.gated.exact"]').textContent;
    box.setAttribute('aria-label', box.getAttribute('aria-label') + ' At the foot of the paper a tally reads: claimed ' + claimed +
      ', with padding counted; on hard tokens ' + hard + ', exact match on tokens never seen in training.');

    function mk(tag, cls, parent) { var e = document.createElement(tag); e.className = cls; if (parent) parent.appendChild(e); return e; }
    var roll = mk('div', 'rt-pv-roll', box);
    var stack = mk('div', 'rt-pv-stack', roll);
    var score = mk('div', 'rt-pv-score', box);
    var s1 = mk('div', 'rt-pv-line', score), s2 = mk('div', 'rt-pv-line', score);
    var bed = mk('div', 'rt-pv-bed', box);
    var tape = mk('canvas', 'rt-pv-tape', bed);
    tape.setAttribute('aria-hidden', 'true');

    var LF = 0.2, TPS = 18, CPS = 48, SCPS = 60, STRIKE = 0.3, HOLD = 0.45, LH = 1.42;
    var items = PREVIEW.map(function (p) { return { tok: p.tok, wrong: p.wrong, src: p.src, right: R.normalize(p.tok, {}).out }; });
    // the cycle ends on £900, the headline example, so start it on the next one
    var order = [items[1], items[2], items[0]];
    var lines = [], punch = [];
    function addLines(hist, t) {
      order.forEach(function (it) {
        var specs = [
          { k: 'tok', text: it.tok, src: it.src, rate: TPS, extra: 0.12 },
          { k: 'wrong', text: it.wrong, rate: CPS, extra: STRIKE },
          { k: 'right', text: it.right, rate: CPS, extra: 0 }
        ];
        specs.forEach(function (L) {
          L.hist = hist;
          L.ts = t;
          L.ty = t + LF;
          L.dur = L.text.length / L.rate;
          if (L.k === 'right') { L.seed = punch.length; punch.push(L); }
          t = L.ty + L.dur + L.extra;
          lines.push(L);
        });
        t += HOLD;
      });
      return t;
    }
    // the previous cycle, already printed, then this one
    addLines(true, -1e9);
    var HN = lines.length;
    var t = addLines(false, 0);
    var SC = [
      [{ t: pad('CLAIMED', 16), c: '' }, { t: claimed, c: 'rt-pv-b' }, { t: '  padding counted', c: 'rt-pv-note' }],
      [{ t: pad('ON HARD TOKENS', 16), c: 'rt-pv-red' }, { t: hard, c: 'rt-pv-red rt-pv-b' }, { t: '  unseen, exact', c: 'rt-pv-note' }]
    ];
    function segLen(s) { return s.reduce(function (a, g) { return a + g.t.length; }, 0); }
    var scStart = t + 0.1, sc1 = segLen(SC[0]) / SCPS, sc2 = segLen(SC[1]) / SCPS;
    var LOOP = scStart + 0.15 + sc1 + 0.12 + sc2 + 1;

    // ribbon ink: each glyph strikes a little harder or softer (opacity 0.85 to 1)
    function inkInto(parent, text, seed, cls) {
      var host = mk('span', cls || '', parent);
      for (var i = 0; i < text.length; i++) {
        var g = mk('span', '', host);
        g.textContent = text[i];
        var h = Math.sin((seed + i) * 12.9898) * 43758.5453;
        g.style.opacity = (0.85 + 0.15 * (h - Math.floor(h))).toFixed(2);
      }
      return host;
    }
    function typed(L, t) { return L.hist ? L.text.length : Math.max(0, Math.min(L.text.length, Math.floor((t - L.ty) * L.rate))); }
    function after(L, t) { return L.hist ? 1 : Math.max(0, Math.min(1, (t - L.ty - L.dur) / (L.extra || 1))); }

    var POOL = 9, pool = [];
    for (var i = 0; i < POOL; i++) { var p = mk('div', 'rt-pv-line', stack); p.sig = ''; pool.push(p); }
    function setLine(el, L, t, idx) {
      if (!L) { if (el.sig !== '-') { el.sig = '-'; el.textContent = ''; } return; }
      var n = typed(L, t), s = after(L, t);
      var sig = idx + ',' + n + ',' + (L.k === 'right' ? 0 : s.toFixed(2));
      if (el.sig === sig) return;
      el.sig = sig;
      el.textContent = '';
      if (L.k === 'tok') {
        inkInto(el, L.text.slice(0, n), idx * 7, 'rt-pv-box' + (n ? '' : ' is-empty'));
        if (s >= 1) mk('span', 'rt-pv-src', el).textContent = '✕ ' + L.src;
      } else if (L.k === 'wrong') {
        mk('span', 'rt-pv-x', el).textContent = '✕ ';
        var w = mk('span', 'rt-pv-txt', el);
        w.textContent = L.text.slice(0, n);
        w.style.setProperty('--s', (s * 100) + '%');
      } else {
        el.appendChild(document.createTextNode('  '));
        inkInto(el, L.text.slice(0, n), idx * 7, 'rt-pv-ink');
      }
    }
    function setScore(el, segs, n) {
      if (el.sig === n) return;
      el.sig = n;
      el.textContent = '';
      segs.forEach(function (g, i) {
        if (n <= 0) return;
        var part = g.t.slice(0, n);
        n -= g.t.length;
        if (g.c.indexOf('red') < 0 && g.c.indexOf('note') < 0) inkInto(el, part, i * 5, g.c + ' rt-pv-ink');
        else mk('span', g.c, el).textContent = part;
      });
    }
    function draw(t) {
      var k = HN - 1;
      while (k + 1 < lines.length && lines[k + 1].ts <= t) k++;
      var off = 0;
      if (k >= HN) { var f = Math.min(1, (t - lines[k].ts) / LF); off = 1 - f * (2 - f); }
      stack.style.transform = off ? 'translateY(' + (off * LH).toFixed(3) + 'em)' : '';
      for (var i = 0; i < POOL; i++) { var j = k - (POOL - 1) + i; setLine(pool[i], lines[j], t, j); }
      var a = 1e3, b = 1e3;
      if (t >= scStart) {
        a = Math.floor((t - scStart - 0.15) * SCPS);
        b = Math.floor((t - scStart - 0.27 - sc1) * SCPS);
      }
      setScore(s1, SC[0], a);
      setScore(s2, SC[1], b);
      // the tape holds the readings punched so far, newest at the punch
      var text = [];
      punch.forEach(function (L) { var m = typed(L, t); if (L.hist || m) text.push(L.text.slice(0, m)); });
      drawTape(text.join(' '));
    }
    var lastTape = '';
    function drawTape(text, force) {
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      var w = tape.clientWidth, h = tape.clientHeight;
      if (!w || !h) return;
      var key = text + '|' + w + 'x' + h + '@' + dpr;
      if (key === lastTape && !force) return;
      lastTape = key;
      if (tape.width !== Math.round(w * dpr) || tape.height !== Math.round(h * dpr)) {
        tape.width = Math.round(w * dpr); tape.height = Math.round(h * dpr);
      }
      var g = tape.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      // the tape: a strip with a feed track of small sprocket holes and five data tracks
      var top = h * 0.1, th = h * 0.8, pitch = th / 7, r = pitch * 0.34;
      var headX = w - Math.max(26, w * 0.1), headW = Math.max(10, w * 0.035);
      g.fillStyle = '#eccf6c';
      g.fillRect(0, top, w, th);
      g.fillStyle = '#c4a443';
      g.fillRect(0, top, w, 1);
      g.fillRect(0, top + th - 1, w, 1);
      var cols = Math.floor((headX - 2) / pitch);
      var chars = text.toUpperCase().slice(-cols);
      g.fillStyle = '#26221c';
      for (var i = 0; i < chars.length; i++) {
        var x = headX - (chars.length - i - 0.5) * pitch;
        g.beginPath(); g.arc(x, top + pitch * 3.5, r * 0.55, 0, 7); g.fill(); // sprocket hole
        var code = ITA2[chars[i]];
        if (!code) continue;
        for (var b = 0; b < 5; b++) {
          if (code[b] !== '1') continue;
          var y = top + pitch * (1 + b + (b >= 2 ? 1 : 0));
          g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
        }
      }
      // the punch block the tape runs through; beyond it the tape is still blank
      g.fillStyle = '#26221c';
      g.fillRect(headX, 0, headW, h);
      g.fillStyle = '#4a443a';
      g.fillRect(headX + 2, h * 0.04, headW - 4, 1.5);
    }

    var raf = 0, t0 = 0;
    function still() { draw(LOOP); }
    function frame(now) {
      draw(((now - t0) / 1000) % LOOP);
      raf = requestAnimationFrame(frame);
    }
    still();
    window.addEventListener('resize', function () { lastTape = ''; if (!raf) still(); });
    Kit.onPlay(function (playing) {
      if (playing && !raf) {
        t0 = performance.now();
        raf = requestAnimationFrame(frame);
      } else if (!playing && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
        still();
      }
    });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { lastTape = ''; if (!raf) still(); });
  }

  if (Kit.preview) { runPreview(); return; }

  // ---------------------------------------------------------------- page
  var EV = null, DEMO = null, TABLE = null;
  var state = { mode: 'test', sentence: null, pad: true, triv: true, unseen: false, prev: null };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function get(obj, path) {
    return path.split('.').reduce(function (o, k) { return o == null ? o : o[k]; }, obj);
  }
  function fmt(v, how) {
    if (how === 'pct1') return v.toFixed(1) + '%';
    if (how === 'pct2') return v.toFixed(2) + '%';
    if (how === 'frac1') return (v * 100).toFixed(1) + '%';
    if (how === 'int') return Math.round(v).toLocaleString('en-GB');
    return String(v);
  }
  function fillNums(root) {
    Array.prototype.forEach.call((root || document).querySelectorAll('[data-num]'), function (n) {
      var v = get(EV, n.getAttribute('data-num'));
      if (typeof v === 'number') n.textContent = fmt(v, n.getAttribute('data-fmt'));
    });
  }
  function num(path, how) { return '<span data-num="' + path + '" data-fmt="' + how + '">' + fmt(get(EV, path), how) + '</span>'; }

  // ---- token sources ----
  function joinTokens(toks) {
    var out = '';
    toks.forEach(function (t, i) {
      if (i && !/^[.,;:!?)\]}%”’]$/.test(t) && !/^[(\[{“‘]$/.test(toks[i - 1])) out += ' ';
      out += t;
    });
    return out;
  }
  function decodeDemo(sent) {
    var toks = sent.map(function (t) { return typeof t === 'string' ? t : t[0]; });
    var rules = R.runRules(toks);
    return sent.map(function (t, i) {
      var inp = toks[i];
      if (typeof t === 'string') {
        var cls = /^[^\w]+$/.test(inp) ? 'PUNCT' : 'PLAIN';
        return { inp: inp, cls: cls, ref: inp, seen: null, out: { copy: inp, lookup: inp, rules: rules[i].out, neural: inp } };
      }
      var ref = t[2] === 0 ? inp : t[2];
      var dec = function (c) { return c === 1 ? ref : c === 0 ? inp : c; };
      return { inp: inp, cls: DEMO.classes[t[1]], ref: ref, seen: !!t[3],
        out: { copy: inp, lookup: dec(t[4]), rules: rules[i].out, neural: dec(t[5]) } };
    });
  }
  function freeTokens(text) {
    var toks = R.tokenize(text).map(function (t) { return t.text; });
    var rules = R.runRules(toks);
    var look = TABLE ? R.runLookup(toks, TABLE) : toks.slice();
    return toks.map(function (inp, i) {
      return { inp: inp, cls: rules[i].cls, ref: null, seen: null,
        out: { copy: inp, lookup: look[i], rules: rules[i].out, neural: null } };
    });
  }

  // ---- rendering the sentence and the tape ----
  // the systems that make a decision disagree (copy never decides, so it is left out)
  function isSplit(tok) {
    var vals = ['lookup', 'rules', 'neural'].map(function (s) { return tok.out[s]; }).filter(function (v) { return v !== null; }).map(R.canon);
    return vals.some(function (v) { return v !== vals[0]; });
  }
  function shown(tok) {
    if (tok.cls !== 'PLAIN' && tok.cls !== 'PUNCT') return true;
    if (tok.ref !== null && R.canon(tok.ref) !== R.canon(tok.inp)) return true;
    return isSplit(tok);
  }
  function inkSpan(text) { // a slightly uneven ribbon: some words print lighter
    var frag = document.createDocumentFragment();
    String(text).split(' ').forEach(function (w, i) {
      if (i) frag.appendChild(document.createTextNode(' '));
      var h = 0;
      for (var k = 0; k < w.length; k++) h = (h * 31 + w.charCodeAt(k)) % 97;
      var s = el('span', h % 5 === 0 ? 'rt-ink-a' : h % 7 === 0 ? 'rt-ink-b' : '', w);
      frag.appendChild(s);
    });
    return frag;
  }
  function sayText(v) { return v === 'sil' ? 'sil (a pause)' : v; }

  function renderTokens(tokens) {
    var sen = $('rt-sentence');
    sen.textContent = '';
    tokens.forEach(function (t) {
      if (!shown(t)) { sen.appendChild(el('span', 'rt-w', t.inp)); return; }
      var c = el('span', 'rt-chip f-' + (FAMILY[t.cls] || 'plain') + (isSplit(t) ? ' is-split' : ''));
      c.appendChild(el('span', 'rt-cls', t.cls.toLowerCase()));
      c.appendChild(el('span', '', t.inp));
      if (isSplit(t)) c.setAttribute('title', 'The systems disagree on this token');
      sen.appendChild(c);
    });

    var rows = $('rt-rows');
    rows.textContent = '';
    var test = state.mode === 'test';
    var nShown = 0, nWrong = 0;
    tokens.forEach(function (t) {
      if (!shown(t)) return;
      nShown++;
      var li = el('li', 'rt-row');
      var left = el('div', 'rt-row-token');
      var chip = el('span', 'rt-chip f-' + (FAMILY[t.cls] || 'plain') + (isSplit(t) ? ' is-split' : ''));
      chip.appendChild(el('span', 'rt-cls', t.cls.toLowerCase()));
      chip.appendChild(el('span', '', t.inp));
      left.appendChild(chip);
      if (test && t.seen !== null) {
        left.appendChild(el('span', 'rt-stamp ' + (t.seen ? 'is-seen' : 'is-unseen'), t.seen ? 'seen in training' : 'unseen in training'));
      }
      li.appendChild(left);
      var list = el('ul', 'rt-readings');
      if (test) list.appendChild(readingLine('none', 'kestrel', t.ref, 'is-ref', null));
      TAPE.forEach(function (s) {
        var v = t.out[s];
        if (v === null) {
          list.appendChild(readingLine('none', s, 'only for test sentences', 'is-missing', null));
          return;
        }
        if (!test) { list.appendChild(readingLine('none', s, v, '', null)); return; }
        var et = R.errorType(v, t.ref, t.inp, t.cls);
        if (et) nWrong++;
        list.appendChild(readingLine(et ? 'blank' : 'punched', s, v, et ? 'is-wrong' : '', et));
      });
      li.appendChild(list);
      rows.appendChild(li);
    });
    if (!nShown) {
      var li = el('li', 'rt-row');
      li.appendChild(el('p', 'rt-note', 'Every token here is plain text or punctuation, read as written by all four systems.'));
      rows.appendChild(li);
    }
    $('rt-legend').innerHTML = test
      ? 'The kestrel line is the reference. A punched hole means a reading matches it; a red <span class="rt-red">✕</span>, struck through, means it does not. ' +
        (nWrong ? nWrong + ' wrong reading' + (nWrong === 1 ? '' : 's') + ' in this sentence.' : 'No wrong readings in this sentence.') +
        ' The neural model was asked only about tokens the data marks as needing work.'
      : 'Your own text has no reference, so nothing is marked right or wrong; a red <span class="rt-red">≠</span> marks tokens where the systems disagree. ' +
        'Lookup here holds the ' + num('lookup.browser_entries', 'int') + ' most frequent of its entries.';
  }
  function readingLine(hole, sys, text, cls, et) {
    var li = el('li', 'rt-reading');
    var h = el('span', 'rt-hole' + (hole === 'punched' ? ' is-punched' : hole === 'none' ? ' is-none' : ''));
    h.setAttribute('aria-hidden', 'true');
    li.appendChild(h);
    li.appendChild(el('span', 'rt-sys', sys));
    var say = el('span', 'rt-say ' + cls);
    if (et) say.appendChild(el('span', 'rt-x', '✕')).setAttribute('aria-hidden', 'true');
    say.appendChild(inkSpan(sayText(text)));
    if (et) {
      li.appendChild(say);
      say.appendChild(el('span', 'rt-sr', ' (wrong:'));
      say.appendChild(el('span', 'rt-tag', R.ERROR_LABELS[et]));
      say.appendChild(el('span', 'rt-sr', ')'));
    } else {
      if (hole === 'punched') say.appendChild(el('span', 'rt-sr', ' (matches)'));
      li.appendChild(say);
    }
    return li;
  }

  // ---- modes ----
  var firstDraw = true;
  function pickSentence() {
    var list = DEMO.sentences;
    if (firstDraw) {
      firstDraw = false;
      // open on a sentence that shows the point: an unseen non-plain token that some system misreads
      var good = [];
      list.forEach(function (s, i) {
        if (s.some(function (t) { return typeof t !== 'string' && !t[3] && (t[5] !== 1 || t[4] !== 1) && [6, 9, 2, 13, 8].indexOf(t[1]) >= 0; })) good.push(i);
      });
      if (good.length) return list[good[Math.floor(Math.random() * good.length)]];
    }
    return list[Math.floor(Math.random() * list.length)];
  }
  function showTest(sent) {
    state.mode = 'test';
    state.sentence = sent;
    var tokens = decodeDemo(sent);
    $('rt-text').value = joinTokens(tokens.map(function (t) { return t.inp; }));
    $('rt-feed-note').innerHTML = 'Held-out example. Neural readings are recorded; half the examples include tokens unseen in training.';
    renderTokens(tokens);
  }
  function showFree(text) {
    state.mode = 'free';
    var tokens = freeTokens(text);
    $('rt-feed-note').innerHTML = 'Copy, lookup and rules run live. Neural readings are available for examples only.';
    renderTokens(tokens);
  }

  // ---- scoreboard ----
  function scoreKey() { return (state.triv ? '1' : '0') + (state.unseen ? '1' : '0'); }
  function scoreOf(sys) {
    var s = EV.scores[scoreKey()][sys];
    return state.pad ? s.padded : s.exact;
  }
  function renderBoard() {
    var bw = $('rt-board').clientWidth;
    var W = bw < 360 ? 10 : bw < 520 ? 14 : 30;
    var lines = [];
    var key = scoreKey(), n = EV.scores[key].copy.n;
    lines.push('<b>' + pad('system', 9) + pad('', W + 1) + 'score</b>');
    var now = {};
    SYSTEMS.forEach(function (s) {
      var v = scoreOf(s);
      now[s] = v;
      var bars = Math.round(v * W);
      var row = pad(SYS_LABEL[s], 9) + repeat('#', bars) + repeat('.', W - bars) + ' ' + pctTxt(v);
      if (state.prev && Math.abs(state.prev[s] - v) > 0.0005) row += '  <span class="rt-was">' + pctTxt(state.prev[s]) + '</span>';
      lines.push(row);
    });
    lines.push(repeat('-', 9 + W + 7));
    lines.push(pad('conTEXT', 9) + num('original.year', 'raw') + pad(' claim', W + 1 - String(EV.original.year).length) + num('original.claimed_val_acc', 'pct2'));
    $('rt-board').innerHTML = lines.join('\n');
    state.prev = now;

    var tokensWord = state.unseen ? 'unseen test tokens' : 'test tokens';
    var note = [];
    note.push('Scored on ' + fmt(n, 'int') + ' ' + tokensWord + (state.triv ? '' : ', PLAIN and PUNCT set aside') + '.');
    if (state.pad) note.push('Padding counted: each reading fills ' + num('original.slots', 'int') + ' word slots and blank slots that match blank slots score, so a wrong one-word reading still earns ' +
      fmt(EV.original.slots - 1, 'int') + ' of ' + num('original.slots', 'int') + '. This is the ' + num('original.year', 'raw') + ' metric, applied to the systems here; the ' + num('original.year', 'raw') + ' model itself is not rerun.');
    else note.push('Whole reading must match the reference exactly.');
    if (state.triv) note.push('PLAIN and PUNCT are ' + num('test.plain_punct_share', 'frac1') + ' of tokens, and copying gets them right almost free.');
    if (state.unseen) note.push('Unseen: the exact token text never occurs in the training split, so memorising the whole string cannot help.');
    note.push('Neural is told which tokens need reading, an advantage no real front end has; gated is the same model reading only what the rules flag, the fair match for rules.');
    $('rt-board-note').innerHTML = note.join(' ');

    var step;
    if (state.pad && state.triv && !state.unseen) step = 'This is how the ' + EV.original.year + ' project scored itself. Switch off the first key.';
    else if (!state.pad && state.triv && !state.unseen) step = 'Now set aside the tokens that need no work.';
    else if (!state.pad && !state.triv && !state.unseen) step = 'Last, keep only tokens never seen in training.';
    else if (!state.pad && !state.triv && state.unseen) {
      var silly = function (sys) { var x = EV.silly_unseen[sys]; return x.unit + x.month + x.repeat + x.spelling; };
      step = 'The honest number for a new sentence: compare gated with rules. Silly errors here (a wrong or missing unit or month, a repeated phrase, a garbled spelling-out): neural ' +
        fmt(silly('neural'), 'int') + ', gated ' + fmt(silly('gated'), 'int') + ', rules ' + fmt(silly('rules'), 'int') + '.';
    }
    else step = 'Any mix of keys is allowed; the ' + EV.original.year + ' setting was the first two on, the third off.';
    $('rt-print-step').textContent = step;
  }
  function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
  function repeat(c, n) { return n > 0 ? new Array(n + 1).join(c) : ''; }
  // two decimals near the top, so 99.95% is never printed as 100.0%
  function pctTxt(v) { var t = (v * 100).toFixed(v >= 0.99 ? 2 : 1) + '%'; while (t.length < 6) t = ' ' + t; return t; }

  function renderClasses() {
    var box = $('rt-classes');
    var classes = Object.keys(EV.per_class.copy);
    var html = '<table><caption>Exact match by class, PLAIN and PUNCT excluded (test split)</caption><thead><tr><th></th><th>tokens</th><th></th>';
    SYSTEMS.forEach(function (s) { html += '<th colspan="2" class="rt-gap" scope="colgroup">' + s + '</th>'; });
    html += '</tr><tr><th scope="col">class</th><th scope="col">all</th><th scope="col">unseen</th>';
    SYSTEMS.forEach(function () { html += '<th scope="col" class="rt-gap">all</th><th scope="col">unseen</th>'; });
    html += '</tr></thead><tbody>';
    classes.forEach(function (c) {
      var base = EV.per_class.copy[c];
      html += '<tr><td>' + c.toLowerCase() + '</td><td>' + fmt(base.n, 'int') + '</td><td>' + fmt(base.unseen_n, 'int') + '</td>';
      SYSTEMS.forEach(function (s) {
        var p = EV.per_class[s][c];
        html += '<td class="rt-gap">' + (p.n ? fmt(p.c / p.n, 'frac1') : '–') + '</td><td>' + (p.unseen_n ? fmt(p.unseen_c / p.unseen_n, 'frac1') : '–') + '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table>';
    html += '<table><caption>Wrong readings by kind, non-trivial test tokens (unseen in brackets)</caption><thead><tr><th>kind</th>';
    SYSTEMS.forEach(function (s) { html += '<th>' + s + '</th>'; });
    html += '</tr></thead><tbody>';
    R.ERROR_TYPES.forEach(function (t) {
      html += '<tr><td>' + R.ERROR_LABELS[t] + '</td>';
      SYSTEMS.forEach(function (s) { html += '<td>' + fmt(EV.silly[s][t], 'int') + ' (' + fmt(EV.silly_unseen[s][t], 'int') + ')</td>'; });
      html += '</tr>';
    });
    html += '</tbody></table>';
    box.innerHTML = html;
  }

  // ---- wiring ----
  function bind() {
    $('rt-draw').addEventListener('click', function () { showTest(pickSentence()); });
    $('rt-own').addEventListener('click', function () {
      var t = $('rt-text');
      t.value = 'The crate weighed 3,500 kg and cost £900 on May 20, 2008, at 10:30 a.m.';
      showFree(t.value);
      t.focus();
    });
    var timer = 0;
    $('rt-text').addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { showFree($('rt-text').value); }, 120);
    });
    $('rt-form').addEventListener('submit', function (e) { e.preventDefault(); showFree($('rt-text').value); });
    [['rt-pad', 'pad'], ['rt-triv', 'triv'], ['rt-unseen', 'unseen']].forEach(function (p) {
      $(p[0]).addEventListener('click', function () {
        state[p[1]] = !state[p[1]];
        this.setAttribute('aria-pressed', String(state[p[1]]));
        renderBoard();
      });
    });
    var lastW = 0;
    window.addEventListener('resize', function () {
      var w = $('rt-board').clientWidth;
      if (Math.abs(w - lastW) > 20) { lastW = w; renderBoard(); }
    });
  }

  function load(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); });
  }
  // the live systems work before any data arrives
  $('rt-feed-note').textContent = 'Loading the test sentences and the scoreboard…';
  Promise.all([load('data/eval.json'), load('data/demo.json'), load('data/lookup.json')]).then(function (d) {
    EV = d[0]; DEMO = d[1]; TABLE = d[2];
    fillNums(document);
    $('rt-test-size').textContent = 'held-out test, ' + fmt(EV.test.tokens, 'int') + ' tokens';
    bind();
    showTest(pickSentence());
    renderBoard();
    renderClasses();
  }).catch(function () {
    $('rt-feed-note').textContent = 'The data files did not load, so only your own text can be read (copy and rules).';
    $('rt-own').addEventListener('click', function () { showFree($('rt-text').value || 'It cost £900 on May 20, 2008.'); });
    $('rt-text').addEventListener('input', function () { showFree($('rt-text').value); });
    $('rt-form').addEventListener('submit', function (e) { e.preventDefault(); showFree($('rt-text').value); });
  });
})();
