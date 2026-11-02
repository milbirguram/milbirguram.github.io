// Whittle: the page. All counts shown here come from model.js (window.Whittle).
(function () {
  'use strict';
  var Kit = window.Kit || { preview: false, reducedMotion: false, onPlay: function (cb) { cb(true); } };
  var W = window.Whittle;
  var RUNS = W.RUNS;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function plural(n, one, many) { return W.fmtInt(n) + ' ' + (n === 1 ? one : (many || one + 's')); }
  function clip(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  // ---------------------------------------------------------------- code highlighting
  // Comments, strings, regex literals after "(", keywords and numbers. Nothing clever.
  var TOKENS = /(\/\/[^\n]*)|('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*")|(\((\/(?:\\.|[^\/\\\n])+\/[gimsuy]*))|\b(function|return|const|let|var|if|else|while|for|new|of|true|false)\b|\b(\d+)\b/g;
  function highlight(line) {
    var out = '', last = 0, m;
    TOKENS.lastIndex = 0;
    while ((m = TOKENS.exec(line))) {
      out += esc(line.slice(last, m.index));
      if (m[1]) out += '<span class="t-com">' + esc(m[1]) + '</span>';
      else if (m[2]) out += '<span class="t-str">' + esc(m[2]) + '</span>';
      else if (m[3]) out += '(<span class="t-re">' + esc(m[4]) + '</span>';
      else if (m[5]) out += '<span class="t-kw">' + m[5] + '</span>';
      else out += '<span class="t-num">' + m[6] + '</span>';
      last = TOKENS.lastIndex;
    }
    return out + esc(line.slice(last));
  }

  // ================================================================ preview (the card)
  if (Kit.preview) { preview(); return; }

  // ================================================================ full page
  var state = {
    fn: W.specs[0].id,
    version: 'buggy',
    prop: {},           // chosen property per function
    results: {},        // last outcome per function/version/property, shown beside the property
    seed: startSeed(),  // shown with every run; each new try uses the next seed
    anim: null
  };
  W.specs.forEach(function (s) { state.prop[s.id] = W.strongest(s).id; });

  function startSeed() {
    var r = Math.random();
    try { if (window.crypto && crypto.getRandomValues) r = crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296; } catch (e) {}
    return 1 + Math.floor(r * 9999);
  }

  function spec() { return W.byId(state.fn); }

  // ---------------------------------------------------------------- function picker
  function renderFns() {
    var box = $('wh-fns');
    box.textContent = '';
    W.specs.forEach(function (s) {
      var b = el('button', 'wh-fn', s.tab);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(s.id === state.fn));
      b.addEventListener('click', function () {
        if (state.fn === s.id) return;
        state.fn = s.id; state.version = 'buggy';
        renderAll();
      });
      box.appendChild(b);
    });
  }

  // ---------------------------------------------------------------- code and example tests
  function renderCode(markBug) {
    var s = spec(), src = W.sourceOf(s, state.version), pre = $('wh-code');
    $('wh-file').textContent = s.file;
    pre.innerHTML = src.lines.map(function (line, i) {
      var bad = markBug && i === src.bugLine;
      return '<span class="wh-line' + (bad ? ' is-bad' : '') + '"><span class="wh-ln" aria-hidden="true">' + (i + 1) + '</span>' +
        '<span class="wh-lc">' + (highlight(line) || ' ') + '</span>' +
        '</span>';
    }).join('');
    var note = $('wh-code-note');
    note.hidden = !(markBug && src.bugLine >= 0);
    note.textContent = note.hidden ? '' : '✕ Line ' + (src.bugLine + 1) + ' is the bug, marked by hand. The tester shows that the code is wrong, not where.';
    pre.setAttribute('aria-label', 'Source code of ' + s.file + (markBug && src.bugLine >= 0 ? ', line ' + (src.bugLine + 1) + ' marked by hand as the bug' : ''));
    $('wh-buggy').setAttribute('aria-pressed', String(state.version === 'buggy'));
    $('wh-fixed').setAttribute('aria-pressed', String(state.version === 'fixed'));
  }

  function examples() { var s = spec(); return W.runExamples(s, s[state.version]); }

  function renderExamples() {
    var s = spec(), ex = examples(), ul = $('wh-examples');
    ul.textContent = '';
    ex.results.forEach(function (r, i) {
      var li = el('li', 'wh-ex ' + (r.pass ? 'is-pass' : 'is-fail'));
      li.appendChild(el('span', 'wh-mark', r.pass ? '✓' : '✕')).setAttribute('aria-hidden', 'true');
      li.appendChild(el('span', 'wh-sr', r.pass ? 'Passes: ' : 'Fails: '));
      var code = el('code', 'wh-ex-code');
      code.innerHTML = highlight(r.code) + ' <span class="wh-arrow" aria-label="should give">→</span> ' + highlight(W.showVal(s.examples[i].want));
      li.appendChild(code);
      ul.appendChild(li);
    });
    $('wh-ex-count').textContent = ex.passed + '/' + ex.total + ' passed';
    $('wh-ex-count').className = 'wh-pill ' + (ex.passed === ex.total ? 'is-pass' : 'is-fail');
  }

  // ---------------------------------------------------------------- properties
  function resultKey(pid) { return state.fn + '/' + state.version + '/' + pid; }

  function renderProps() {
    var s = spec(), box = $('wh-props');
    box.textContent = '';
    s.properties.forEach(function (p) {
      var id = 'wh-p-' + p.id;
      var row = el('div', 'wh-prop');
      var input = el('input');
      input.type = 'radio'; input.name = 'wh-prop'; input.id = id; input.value = p.id;
      input.checked = state.prop[s.id] === p.id;
      input.addEventListener('change', function () { state.prop[s.id] = p.id; resetRun(); });
      var label = el('label');
      label.htmlFor = id;
      label.appendChild(el('span', 'wh-prop-text', p.label));
      var code = el('code', 'wh-prop-code');
      code.innerHTML = highlight(p.code);
      label.appendChild(code);
      var res = state.results[resultKey(p.id)];
      if (res) label.appendChild(el('span', 'wh-prop-res ' + (res.refuted ? 'is-fail' : 'is-pass'), res.text));
      row.appendChild(input); row.appendChild(label);
      box.appendChild(row);
    });
    $('wh-inputs').textContent = 'Inputs: ' + s.inputs.charAt(0).toLowerCase() + s.inputs.slice(1);
  }

  // ---------------------------------------------------------------- scoreboard
  function renderScore(exp) {
    var ex = examples();
    $('wh-sb-ex').textContent = ex.passed + '/' + ex.total + ' passed';
    if (!exp) {
      $('wh-sb-prop').textContent = 'not tried yet';
      $('wh-sb-shrink').textContent = '–';
      $('wh-sb-prop').className = $('wh-sb-shrink').className = '';
      return;
    }
    var sb = W.scoreboard(exp);
    $('wh-sb-prop').textContent = sb.property;
    $('wh-sb-shrink').textContent = sb.shrink;
    $('wh-sb-prop').className = exp.run.status === 'refuted' ? 'is-fail' : 'is-pass';
  }

  // ---------------------------------------------------------------- running
  function stopAnim() {
    if (state.anim) { cancelAnimationFrame(state.anim.raf); clearTimeout(state.anim.timer); state.anim = null; }
    $('wh-skip').hidden = true;
  }

  function resetRun() {
    stopAnim();
    $('wh-stream').textContent = '';
    $('wh-counter').textContent = '';
    $('wh-shrink').hidden = true;
    $('wh-steps').textContent = '';
    $('wh-verdict').hidden = true;
    $('wh-lesson').hidden = true;
    $('wh-live').textContent = '';
    $('wh-go').textContent = 'Try to break it';
    renderCode(false);
    renderScore(null);
  }

  function renderAll() {
    renderFns();
    renderExamples();
    renderProps();
    resetRun();
  }

  var MAX_CHIPS = 48;

  function chip(s, item, cls) {
    var c = el('span', 'wh-chip ' + (cls || '') + ' is-' + item.outcome);
    var text = clip(s.show(item.value), 34);
    c.textContent = (item.outcome === 'fail' ? '✕ ' : '') + text;
    if (item.outcome === 'skip') c.title = 'skipped by the precondition';
    return c;
  }

  function addChips(s, inputs, from, to) {
    var box = $('wh-stream');
    var start = Math.max(from, to - MAX_CHIPS);
    for (var i = start; i < to; i++) box.appendChild(chip(s, inputs[i]));
    while (box.childNodes.length > MAX_CHIPS) box.removeChild(box.firstChild);
  }

  function counterText(exp, n) {
    var run = exp.run, t = 'Tried ' + plural(n, 'input') + ' of up to ' + W.fmtInt(RUNS);
    var skipped = 0;
    for (var i = 0; i < n; i++) if (run.inputs[i].outcome === 'skip') skipped++;
    if (skipped) t += ' · ' + W.fmtInt(skipped) + ' skipped';
    return t + ' · seed ' + exp.seed;
  }

  function go() {
    stopAnim();
    var s = spec();
    var exp = W.experiment(s.id, state.prop[s.id], state.version, state.seed++, RUNS);
    resetRun();
    $('wh-go').textContent = 'Try again, new seed';
    if (Kit.reducedMotion) { finish(exp); return; }

    $('wh-skip').hidden = false;
    var N = exp.run.inputs.length, shown = 0, t0 = null;
    var D = Math.max(500, Math.min(3200, N * 60));
    var anim = state.anim = { raf: 0, timer: 0, exp: exp };
    function frame(t) {
      if (state.anim !== anim) return;
      if (t0 == null) t0 = t;
      var u = Math.min(1, (t - t0) / D);
      var n = Math.min(N, Math.ceil(N * (N > 50 ? u * u : u)));
      if (n > shown) { addChips(s, exp.run.inputs, shown, n); shown = n; $('wh-counter').textContent = counterText(exp, n); }
      if (shown < N) { state.anim.raf = requestAnimationFrame(frame); return; }
      if (exp.run.status !== 'refuted') { finish(exp); return; }
      $('wh-counter').textContent = counterText(exp, N) + ' · input ' + W.fmtInt(N) + ' failed';
      anim.timer = setTimeout(function () { if (state.anim === anim) shrinkSteps(exp); }, 650);
    }
    state.anim.raf = requestAnimationFrame(frame);
  }

  // Steps are labelled by what changed in the shown input, not by the shrinker's internal pass:
  // removing hidden choices can shorten the input, or only change a value in it.
  function bulk(v) {
    if (typeof v === 'string') return v.length;
    if (Array.isArray(v)) return v.reduce(function (n, x) { return n + 1 + bulk(x); }, 0);
    if (v && typeof v === 'object') return Object.keys(v).reduce(function (n, k) { return n + bulk(v[k]); }, 0);
    return 0;
  }
  function stepText(s, steps, i, original) {
    var before = i === 0 ? original : steps[i - 1].value, after = steps[i].value;
    if (s.show(after) === s.show(before)) return 'simplified a hidden choice';
    if (bulk(after) < bulk(before)) return 'cut a piece out';
    return steps[i].pass === 'lower' ? 'made a value smaller' : 'made it simpler';
  }

  function stepItem(s, label, what, value, cls) {
    var li = el('li', 'wh-step ' + (cls || ''));
    li.appendChild(el('span', 'wh-step-n', label));
    li.appendChild(el('span', 'wh-step-what', what));
    var c = el('code', 'wh-chip is-fail', '✕ ' + s.show(value));
    li.appendChild(c);
    return li;
  }

  function shrinkSteps(exp) {
    var s = exp.spec, sh = exp.shrunk, list = $('wh-steps'), i = 0;
    $('wh-shrink').hidden = false;
    list.textContent = '';
    list.appendChild(stepItem(s, 'found', 'the failing input', sh.original.value, 'is-first'));
    var gap = Math.max(140, Math.min(450, 2600 / Math.max(1, sh.steps.length)));
    var anim = state.anim;
    function next() {
      if (state.anim !== anim) return;
      if (i >= sh.steps.length) { finish(exp); return; }
      var st = sh.steps[i];
      list.appendChild(stepItem(s, 'step ' + (i + 1), stepText(s, sh.steps, i, sh.original.value), st.value));
      list.scrollTop = list.scrollHeight;
      i++;
      state.anim.timer = setTimeout(next, gap);
    }
    state.anim.timer = setTimeout(next, gap);
  }

  function finish(exp) {
    stopAnim();
    var s = exp.spec, run = exp.run, sh = exp.shrunk, N = run.inputs.length;
    var box = $('wh-stream');
    box.textContent = '';
    addChips(s, run.inputs, 0, N);
    $('wh-counter').textContent = counterText(exp, N) + (run.status === 'refuted' ? ' · input ' + W.fmtInt(N) + ' failed' : '');

    var sb = W.scoreboard(exp);
    var res = run.status === 'refuted'
      ? { refuted: true, text: 'refuted after ' + plural(run.tried, 'input') }
      : { refuted: false, text: 'survived ' + W.fmtInt(run.tried - run.discarded) + (run.discarded ? ', ' + W.fmtInt(run.discarded) + ' skipped' : '') };
    state.results[resultKey(exp.prop.id)] = res;
    renderProps();
    renderScore(exp);

    var lesson = $('wh-lesson'), ex = exp.examples;
    lesson.hidden = false;
    lesson.className = 'wh-lesson ' + (res.refuted ? 'is-fail' : 'is-pass');

    if (run.status === 'refuted') {
      var list = $('wh-steps');
      list.textContent = '';
      list.appendChild(stepItem(s, 'found', 'the failing input', sh.original.value, 'is-first'));
      sh.steps.forEach(function (st, i) { list.appendChild(stepItem(s, 'step ' + (i + 1), stepText(s, sh.steps, i, sh.original.value), st.value)); });
      if (list.lastChild) list.lastChild.className += ' is-final';
      list.scrollTop = list.scrollHeight;
      $('wh-shrink').hidden = false;
      $('wh-verdict').hidden = false;
      $('wh-v-input').innerHTML = '';
      $('wh-v-input').appendChild(el('code', 'wh-chip is-fail is-big', '✕ ' + s.show(sh.value)));
      $('wh-v-exp').textContent = sh.result.expected;
      $('wh-v-act').textContent = sh.result.actual;
      renderCode(exp.version === 'buggy');
      var k = sh.steps.length;
      lesson.textContent = 'The ' + plural(ex.total, 'example test') + ' agreed with the code. This one input does not, and one counterexample outweighs any number of passing examples. ' +
        (k ? 'Shrinking took ' + plural(k, 'step') + ' to reach an input where none of the simplifications the shrinker tries still fails. ' : '') +
        (k > 1 ? '' : sh.choices.every(function (c) { return c === 0; })
          ? 'That is the simplest input the generator can make, so there was little to whittle; another function shows a longer whittle. '
          : 'The tester starts with small inputs, so this failure was already ' + (k ? 'nearly ' : '') + 'as small as it gets; try a new seed to see a longer whittle. ') +
        'A small failing input points at the cause: compare what was expected with what came back. ' +
        (exp.version === 'buggy' ? 'Line ' + (W.sourceOf(s, 'buggy').bugLine + 1) + ', marked by hand, is the bug. ' : '') +
        'Now try the fixed version, or a weaker property.';
      $('wh-live').textContent = 'Refuted after ' + plural(run.tried, 'input') + '. Smallest failing input ' + s.show(sh.value) + '. Expected ' + sh.result.expected + ', actual ' + sh.result.actual + '.';
    } else {
      var tested = run.tried - run.discarded, skippedNote = run.discarded
        ? ' The precondition skipped another ' + W.fmtInt(run.discarded) + ' of the ' + W.fmtInt(run.tried) + ' generated inputs, so they were never tested.'
        : '';
      if (exp.version === 'buggy') {
        lesson.textContent = 'It survived ' + plural(tested, 'attempt') + ' to refute it, yet this code has a bug.' + skippedNote + ' ' + exp.prop.why + ' A property is only useful if it could fail.';
      } else {
        lesson.textContent = 'Not proof: it survived ' + plural(tested, 'attempt') + ' to refute it, and each one could have failed.' + skippedNote +
          (exp.prop.strength === 'weak' ? ' This property also passes the version as written, so surviving here says little.' : ' The same property fails the version as written.');
      }
      $('wh-live').textContent = sb.property + '.';
    }
  }

  // ---------------------------------------------------------------- wiring
  $('wh-go').addEventListener('click', go);
  $('wh-skip').addEventListener('click', function () {
    if (state.anim) finish(state.anim.exp);
  });
  $('wh-buggy').addEventListener('click', function () { if (state.version !== 'buggy') { state.version = 'buggy'; renderAll(); } });
  $('wh-fixed').addEventListener('click', function () { if (state.version !== 'fixed') { state.version = 'fixed'; renderAll(); } });

  renderAll();

  // ================================================================ preview
  function preview() {
    $('wh-app').hidden = true;
    var box = $('wh-preview');
    box.hidden = false;
    var streamBox = $('wh-p-stream');

    // Real runs of the strongest property on each buggy function, for the seeds listed in the
    // model (W.PREVIEW, checked by the tests); the runs themselves are untouched.
    var demos = W.PREVIEW.map(function (d) {
      return W.experiment(d.fn, W.strongest(W.byId(d.fn)).id, 'buggy', d.seed, RUNS);
    });

    function timeline(e) {
      var N = e.run.inputs.length, steps = e.shrunk.steps.length;
      var t = { stream: Math.min(2600, N * 75), hold: 700, step: 420 };
      t.shrink = (steps + 1) * t.step;
      t.end = 1900;
      t.total = t.stream + t.hold + t.shrink + t.end;
      return t;
    }
    var plans = demos.map(timeline);

    var cur = -1, lastKey = '';
    function draw(di, ms) {
      var e = demos[di], T = plans[di], s = e.spec, N = e.run.inputs.length;
      var n = Math.min(N, Math.max(1, Math.ceil(N * Math.min(1, ms / T.stream))));
      var inShrink = ms >= T.stream + T.hold, k = 0;
      if (inShrink) k = Math.min(e.shrunk.steps.length, Math.floor((ms - T.stream - T.hold) / T.step));
      var done = ms >= T.stream + T.hold + T.shrink;
      var key = di + '/' + n + '/' + (inShrink ? 1 : 0) + '/' + k + '/' + (done ? 1 : 0);
      if (key === lastKey) return;
      lastKey = key;

      if (di !== cur) { cur = di; streamBox.textContent = ''; streamBox.dataset.n = '0'; }
      var have = +streamBox.dataset.n;
      if (n < have) { streamBox.textContent = ''; have = 0; }
      for (var i = Math.max(have, n - 30); i < n; i++) {
        var item = e.run.inputs[i];
        var c = el('span', 'wh-chip is-' + item.outcome, (item.outcome === 'fail' ? '✕ ' : '') + clip(s.show(item.value), 22));
        streamBox.appendChild(c);
      }
      while (streamBox.childNodes.length > 30) streamBox.removeChild(streamBox.firstChild);
      streamBox.dataset.n = String(n);
      streamBox.className = 'wh-p-stream' + (inShrink ? ' is-dim' : '');

      $('wh-p-fn').textContent = s.tab;
      $('wh-p-count').textContent = plural(n, 'input');
      var label = $('wh-p-label'), big = $('wh-p-big');
      if (!inShrink) {
        label.textContent = n === N ? 'input ' + W.fmtInt(N) + ' fails' : 'example tests pass · trying random inputs';
        big.textContent = n === N ? '✕ ' + clip(s.show(e.run.failure.value), 40) : '';
        big.className = 'wh-p-big' + (n === N ? ' is-fail' : '');
      } else {
        var v = k === 0 ? e.shrunk.original.value : e.shrunk.steps[k - 1].value;
        label.textContent = done ? 'smallest failing input · ' + plural(e.shrunk.steps.length, 'step') : 'whittling · step ' + k + ' of ' + e.shrunk.steps.length;
        big.textContent = '✕ ' + clip(s.show(v), 40);
        big.className = 'wh-p-big is-fail' + (done ? ' is-final' : '');
      }
    }

    // A still frame for paused cards and reduced motion: the first demo, fully whittled.
    function still() { draw(0, plans[0].total - 1); }

    var raf = 0, at = 0, demo = 0, prev = null;
    function frame(now) {
      if (prev != null) at += Math.min(100, now - prev);
      prev = now;
      if (at >= plans[demo].total) { at = 0; demo = (demo + 1) % demos.length; }
      draw(demo, at);
      raf = requestAnimationFrame(frame);
    }
    still();
    Kit.onPlay(function (playing) {
      cancelAnimationFrame(raf);
      prev = null;
      if (playing) { raf = requestAnimationFrame(frame); return; }
      // Paused: show the current demo fully whittled, never a half-empty frame. On resume the
      // loop moves on to the next demo.
      draw(demo, plans[demo].total - 1);
      at = plans[demo].total;
    });
  }
})();
