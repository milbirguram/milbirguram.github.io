// Cardinal: the page. DuckDB-Wasm is loaded lazily (engine.js, lab.js) and never in preview mode.
(function () {
  'use strict';
  var M = window.CardinalModel;
  var Kit = window.Kit || { preview: false, reducedMotion: false, onPlay: function (cb) { cb(true); } };
  var $ = function (id) { return document.getElementById(id); };

  if (Kit.preview) { startPreview(); return; }

  // ================================================================== state

  var small = window.matchMedia && window.matchMedia('(max-width: 600px), (pointer: coarse)').matches;
  if (navigator.deviceMemory && navigator.deviceMemory < 4) small = true;
  var ORDERS = small ? M.SIZES.phone : M.SIZES.laptop;
  var RUNS = 5;
  var SHAPE = M.shape(ORDERS);

  var S = { theta: 0, rho: 0, scope: 'province', preset: 'star', sql: '', step: 0 };
  var engine = null, lab = null;
  var busy = false, pending = null;
  var last = null;      // { want, result, stats }
  var ready = false;

  var el = {
    dots: $('cd-dots'), prev: $('cd-prev'), next: $('cd-next'),
    title: $('cd-story-title'), lead: $('cd-story-lead'), result: $('cd-story-result'), action: $('cd-story-action'),
    status: $('cd-status'), statusText: $('cd-status-text'), bar: $('cd-progress-bar'), load: $('cd-load'),
    plan: $('cd-plan'), change: $('cd-change'), time: $('cd-time'), foot: $('cd-foot'),
    controls: $('cd-controls'),
    theta: $('cd-theta'), thetaOut: $('cd-theta-out'), thetaNote: $('cd-theta-note'),
    rho: $('cd-rho'), rhoOut: $('cd-rho-out'), rhoNote: $('cd-rho-note'),
    scopeNote: $('cd-scope-note'), sql: $('cd-sql'), run: $('cd-run'), sqlMsg: $('cd-sql-msg'), stop: $('cd-stop')
  };

  var fmt = M.formatCount;
  function pct(x) { return (x * 100).toFixed(x < 0.1 ? 1 : 0) + '%'; }
  function ms(x) { return x < 10 ? x.toFixed(1) : String(Math.round(x)); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ================================================================== guided path

  var STORY = [
    {
      lead: function () {
        return 'Orders are evenly spread. Compare DuckDB’s guesses (hatched) with the real row counts (solid).';
      },
      result: function (r) {
        var worst = M.flatten(r.tree).reduce(function (m, x) { return x.q !== null && x.q > m ? x.q : m; }, 1);
        return 'Worst guess in this plan: off by ×' + M.formatQ(worst) + '.';
      }
    },
    {
      lead: function (st) {
        var rho = M.STEPS[1].settings.rho;
        var share = st && st.rho === rho && S.rho === rho ? ' (with chance, ' + pct(st.homeShare) + ' end up there)' : '';
        return 'Now ' + pct(rho) + ' of orders are moved to the category that matches the customer’s province' + share +
          '. The two filters overlap, but DuckDB treats them as independent.';
      },
      result: function (r, st) {
        var j = M.findJoin(r.tree, ['customers', 'orders', 'products']);
        if (!j) return '';
        return 'Final join: guessed ' + fmt(j.est) + ', real ' + fmt(j.act) + ', so ×' + M.formatQ(M.qError(j.est, j.act)) +
          ' too few. Measured link between the two columns (Cramér’s V): ' + st.cramersV.toFixed(2) + '.';
      },
      aside: 'Inside a single table DuckDB is more careful: with two equality filters it keeps only the more selective one, so this trap needs a join.'
    },
    {
      lead: function (st) {
        var share = st && st.theta === S.theta && st.theta > 0 ? ' ' + pct(st.topCustomerShare) + ' of' : ' a large share of';
        return 'Link off, skew on. The busiest customer alone now places' + share + ' all orders. DuckDB still assumes customers order equally often.';
      },
      result: function (r) {
        var j = M.findJoin(r.tree, ['customers', 'orders']);
        if (!j) return '';
        return 'Orders from city 0: guessed ' + fmt(j.est) + ', real ' + fmt(j.act) + ', ×' + M.formatQ(M.qError(j.est, j.act)) + ' too few, and the error carries up the plan.';
      },
      aside: 'Almost all of that gap is the one busy customer. Filter on a quieter city, such as city 30, and DuckDB guesses slightly too many instead.'
    },
    {
      lead: function () {
        return 'Query the best-selling product. Widen the customer filter and watch which side DuckDB chooses for its hash table.';
      },
      result: function (r) {
        var j = M.findJoin(r.tree, ['customers', 'orders']);
        var scan = M.findScan(r.tree, 'orders');
        if (!j || !scan) return '';
        var build = M.buildTables(j).join();
        var head = 'DuckDB guesses product 0 has ' + fmt(scan.est) + ' orders; it has ' + fmt(scan.act) + '. ';
        if (build === 'customers') {
          var cust = M.findScan(r.tree, 'customers');
          return head + 'With one city it builds on the ' + fmt(cust.act) + ' customers, which is right: ' + ms(r.timing.median) + ' ms.';
        }
        var gap = r.alt ? r.timing.median / r.alt.timing.median : 1;
        return head + 'Now it builds on those orders, ' + fmt(scan.act) + ' rows, thinking them the smaller side: ' + ms(r.timing.median) +
          ' ms. Building on the customers instead takes ' + (r.alt ? ms(r.alt.timing.median) : '?') + ' ms' +
          (gap < 1.3 ? ' (this time the gap is within the noise; switch back and forth to measure again).' : '.');
      },
      action: function () {
        if (S.scope !== 'city') return null;
        return { label: 'Widen the filter to one province', run: function () {
          setScope('province'); request();
          var r = document.querySelector('#cd-scope input[value="province"]'); if (r) r.focus(); // the button is about to go
        } };
      }
    },
    {
      lead: function () {
        return 'Store the product’s orders first. With an exact row count, DuckDB can choose the smaller side again.';
      },
      result: function (r) {
        if (!r.compare || !r.compareAlt) return '';
        return 'Join on the stored table: ' + ms(r.timing.median) + ' ms. Without storing, DuckDB’s own plan takes ' + ms(r.compare.timing.median) +
          ' ms and the right build side ' + ms(r.compareAlt.timing.median) + ' ms: the gap between those two is the cost of the bad guess; the rest of the saving comes from not scanning all ' +
          fmt(ORDERS) + ' orders again. Storing took ' + ms(r.setupMs) + ' ms, so it pays only when the stored result is reused.';
      },
      aside: 'Other systems go further: statistics over pairs of columns for correlation, sampling while planning, and adaptive execution that changes plan when real counts surprise it. Leis and colleagues (2015) found large estimation errors in every system they tested.'
    }
  ];

  function buildDots() {
    M.STEPS.forEach(function (step, i) {
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = '<span class="cd-dot-num">' + (i + 1) + '</span><span class="cd-dot-label">' + esc(step.title) + '</span>';
      b.setAttribute('aria-label', 'Step ' + (i + 1) + ' of ' + M.STEPS.length + ': ' + step.title);
      b.addEventListener('click', function () { goStep(i); });
      li.appendChild(b);
      el.dots.appendChild(li);
    });
    if (small) Array.prototype.forEach.call(el.dots.querySelectorAll('.cd-dot-label'), function (n) { n.hidden = true; });
  }

  function goStep(i) {
    S.step = i;
    var st = M.STEPS[i].settings;
    S.theta = st.theta; S.rho = st.rho; S.scope = st.scope; S.preset = st.preset;
    syncControls();
    renderDots();
    renderStory();
    if (ready) request();
  }

  function renderDots() {
    Array.prototype.forEach.call(el.dots.querySelectorAll('button'), function (b, i) {
      if (i === S.step) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    });
    el.prev.disabled = S.step === 0;
    el.next.textContent = S.step === M.STEPS.length - 1 ? 'Start again' : 'Next step';
    $('cd-tb-sheet').textContent = (S.step + 1) + ' of ' + M.STEPS.length;
  }

  function onStep() {
    var st = M.STEPS[S.step].settings;
    var scopeOk = S.scope === st.scope || (M.STEPS[S.step].then && S.scope === M.STEPS[S.step].then.scope);
    return S.theta === st.theta && S.rho === st.rho && S.preset === st.preset && scopeOk;
  }

  function renderStory() {
    var i = S.step;
    var story = STORY[i];
    var stats = last && last.stats;
    el.title.textContent = 'Step ' + (i + 1) + ' of ' + M.STEPS.length + ' · ' + M.STEPS[i].title;
    el.lead.textContent = story.lead(stats);
    var res = '';
    var fresh = last && onStep() && last.want.preset === S.preset && last.want.scope === S.scope && last.want.theta === S.theta && last.want.rho === S.rho;
    if (fresh) {
      try { res = story.result(last.result, last.stats) || ''; } catch (e) { res = ''; }
    }
    el.result.innerHTML = '';
    if (res) el.result.textContent = res;
    if (story.aside && onStep()) {
      var a = document.createElement('span');
      a.className = 'cd-aside';
      a.textContent = (res ? ' ' : '') + story.aside;
      el.result.appendChild(a);
    }
    el.action.innerHTML = '';
    el.action.hidden = true;
    var labels = document.querySelectorAll('#cd-scope label');
    Array.prototype.forEach.call(labels, function (l) { l.classList.remove('is-cue'); });
    if (!onStep()) {
      el.action.hidden = false;
      var span = document.createElement('span');
      span.className = 'cd-drift';
      span.textContent = 'You have moved away from this step’s settings. ';
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'cd-link'; b.textContent = 'Back to the step';
      b.addEventListener('click', function () { goStep(S.step); });
      span.appendChild(b);
      el.action.appendChild(span);
      return;
    }
    var act = story.action && story.action();
    if (act && ready) {
      el.action.hidden = false;
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'kit-button is-primary'; btn.textContent = act.label;
      btn.addEventListener('click', act.run);
      el.action.appendChild(btn);
      var cue = document.querySelector('#cd-scope input[value="province"]');
      if (cue) cue.parentNode.classList.add('is-cue');
    }
  }

  // ================================================================== controls

  function syncControls() {
    el.theta.value = S.theta; el.thetaOut.textContent = S.theta.toFixed(1);
    el.rho.value = S.rho; el.rhoOut.textContent = S.rho.toFixed(1);
    var r = document.querySelector('#cd-scope input[value="' + S.scope + '"]'); if (r) r.checked = true;
    var p = document.querySelector('#cd-presets input[value="' + S.preset + '"]'); if (p) p.checked = true;
    if (S.preset !== 'custom') el.sql.value = presetText(S.preset, S.scope);
    el.sqlMsg.textContent = '';
  }

  var presetText = M.presetText;

  function setScope(v) {
    S.scope = v;
    var r = document.querySelector('#cd-scope input[value="' + v + '"]'); if (r) r.checked = true;
    if (S.preset !== 'custom') el.sql.value = presetText(S.preset, S.scope);
  }

  var debounce = null;
  function soon() { clearTimeout(debounce); debounce = setTimeout(request, 350); }

  function wireControls() {
    el.theta.addEventListener('input', function () { S.theta = Math.round(+el.theta.value * 10) / 10; el.thetaOut.textContent = S.theta.toFixed(1); renderStory(); soon(); });
    el.theta.addEventListener('change', function () { clearTimeout(debounce); request(); });
    el.rho.addEventListener('input', function () { S.rho = Math.round(+el.rho.value * 10) / 10; el.rhoOut.textContent = S.rho.toFixed(1); renderStory(); soon(); });
    el.rho.addEventListener('change', function () { clearTimeout(debounce); request(); });
    Array.prototype.forEach.call(document.querySelectorAll('#cd-scope input'), function (inp) {
      inp.addEventListener('change', function () { setScope(inp.value); renderStory(); request(); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('#cd-presets input'), function (inp) {
      inp.addEventListener('change', function () {
        S.preset = inp.value;
        if (S.preset === 'custom') { $('cd-sql-details').open = true; S.sql = el.sql.value; el.sql.focus(); }
        else el.sql.value = presetText(S.preset, S.scope);
        renderStory(); request();
      });
    });
    el.run.addEventListener('click', runCustom);
    el.sql.addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runCustom(); } });
    el.prev.addEventListener('click', function () { if (S.step > 0) goStep(S.step - 1); });
    el.next.addEventListener('click', function () { goStep(S.step === M.STEPS.length - 1 ? 0 : S.step + 1); });
    el.load.addEventListener('click', function () { el.load.hidden = true; boot(); });
    el.stop.addEventListener('click', function () { if (current) current.cancel(); });
  }

  function runCustom() {
    var text = el.sql.value;
    // A preset's setup step is shown as a comment; the box itself only reads.
    var v = M.validateSql(text);
    if (!v.ok) { el.sqlMsg.textContent = v.reason; return; }
    el.sqlMsg.textContent = '';
    S.preset = 'custom'; S.sql = v.sql;
    var p = document.querySelector('#cd-presets input[value="custom"]'); if (p) p.checked = true;
    renderStory();
    request();
  }

  function setEnabled(on) {
    el.controls.setAttribute('aria-disabled', on ? 'false' : 'true');
    Array.prototype.forEach.call(el.controls.querySelectorAll('input, textarea, button'), function (n) { n.disabled = !on; });
  }

  // ================================================================== running

  function snapshot() { return { theta: S.theta, rho: S.rho, scope: S.scope, preset: S.preset, sql: S.sql }; }

  var current = null; // handle of a running free-form query, which can be stopped

  function request() {
    if (!ready) return;
    pending = snapshot();
    if (!busy) pump();
    else if (current) current.cancel(); // a new request should not wait behind a slow query of your own
  }

  async function pump() {
    busy = true;
    el.status.classList.add('is-busy');
    while (pending) {
      var want = pending; pending = null;
      try { await runOnce(want); }
      catch (err) {
        showError(err, want);
        if (err && err.restart) await restartEngine();
        if (!ready) { pending = null; }
      }
      current = null;
      el.stop.hidden = true;
    }
    busy = false;
    el.status.classList.remove('is-busy');
    if (ready) setStatus('Ready. Results are DuckDB’s own: EXPLAIN ANALYZE for the counts, wall-clock time for the runs.');
  }

  // DuckDB did not stop when asked, so its worker was ended. Start a fresh one; the tables are
  // generated again on the next request.
  async function restartEngine() {
    ready = false;
    setEnabled(false);
    setStatus('Restarting DuckDB…');
    try {
      engine = await window.CardinalEngine.load();
      lab = new window.CardinalLab(engine, ORDERS);
      ready = true;
      setEnabled(true);
    } catch (e) {
      setStatus('DuckDB could not restart: ' + String(e && e.message || e).slice(0, 160) + '. Reload the page.', true);
    }
  }

  async function runOnce(want) {
    var dataChanged = !lab.data || lab.data.theta !== want.theta || lab.data.rho !== want.rho;
    setStatus(dataChanged ? 'Generating ' + fmt(ORDERS) + ' orders…' : 'Running the query…');
    var stats = await lab.ensureData(want);
    renderStats(stats);
    if (pending && (pending.theta !== want.theta || pending.rho !== want.rho)) return;
    var r;
    if (want.preset === 'custom') {
      setStatus('Running your query: once for the profile, then once or twice for time (it stops after 5 s)…');
      el.stop.hidden = false;
      r = await lab.runCustom(want.sql, { onRun: function (h) { current = h; } });
    } else {
      setStatus('Running the query ' + RUNS + ' times…');
      r = await lab.runPreset(want.preset, want.scope, { runs: RUNS });
    }
    var prev = last;
    last = { want: want, result: r, stats: stats };
    renderPlan(r.tree);
    renderChange(prev, last);
    renderTiming(r);
    renderStory();
    if (want.preset === 'custom') el.sqlMsg.textContent = '';
  }

  function showError(err, want) {
    var msg = String(err && err.message || err).replace(/^Error:\s*/, '');
    if (err && err.stopped === 'cancel' && pending && !err.restart) return; // stopped because the visitor moved on
    if (want && want.preset === 'custom') { el.sqlMsg.textContent = msg.split('\n')[0].slice(0, 220); return; }
    setStatus('Something went wrong: ' + msg.slice(0, 200), true);
  }

  function setStatus(text, isError) {
    el.statusText.textContent = text;
    el.status.classList.toggle('is-error', !!isError);
  }

  // ================================================================== rendering

  function renderStats(st) {
    el.thetaNote.innerHTML = st.theta > 0
      ? 'Busiest customer: <strong>' + pct(st.topCustomerShare) + '</strong> of orders. Product 0: <strong>' + pct(st.topProductShare) + '</strong> of sales. (Zipf-like, exponent ' + st.theta.toFixed(1) + '.)'
      : 'Orders fall evenly on customers and products. Raise it to pile them onto a few.';
    el.rhoNote.innerHTML = 'Share of orders moved to the category matching the customer’s province. Measured: <strong>' + pct(st.homeShare) +
      '</strong> of orders are in it (some by chance); link (Cramér’s V) <strong>' + st.cramersV.toFixed(2) + '</strong>.';
    var keep = st.scopeCustomers[S.scope];
    el.scopeNote.innerHTML = 'Keeps <strong>' + fmt(keep) + '</strong> of ' + fmt(st.scopeCustomers.country) + ' customers.';
    el.foot.textContent = fmt(SHAPE.orders) + ' orders, ' + fmt(SHAPE.customers) + ' customers and ' + fmt(SHAPE.products) +
      ' products, generated in this tab in ' + (st.genMs / 1000).toFixed(1) + ' s from a seeded hash, so every visit gets the same rows' +
      (small ? ' (fewer than on a laptop, to stay quick on a phone).' : '.') + ' DuckDB ' + engine.duckdbVersion + ', duckdb-wasm ' + engine.packageVersion + '.';
    $('cd-tb-engine').textContent = 'DuckDB ' + engine.duckdbVersion;
  }

  var MAX = Math.pow(10, Math.ceil(Math.log10(ORDERS * 1.5)));

  function axisRow() {
    var axis = document.createElement('div');
    axis.className = 'cd-axis';
    axis.setAttribute('aria-hidden', 'true');
    var track = document.createElement('div');
    track.className = 'cd-track';
    var step = small ? 100 : 10;
    for (var t = 1; t < MAX; t *= step) {
      var s = document.createElement('span');
      s.className = 'cd-tick';
      s.style.left = (M.logPos(t, MAX) * 100) + '%';
      s.textContent = M.shortCount(t);
      track.appendChild(s);
    }
    axis.appendChild(track);
    return axis;
  }

  function opLabel(n) {
    var role = n.role ? '<span class="cd-role' + (n.role === 'build' ? ' is-build' : '') + '" title="' +
      (n.role === 'build' ? 'DuckDB builds its hash table from this input' : 'DuckDB probes the hash table with this input') + '">' + n.role + '</span>' : '';
    var name = n.op === 'SEQ_SCAN' ? 'Scan <span>' + esc(n.table) + '</span>' : esc(n.name);
    return role + '<span class="cd-name">' + name + '</span>' + (n.detail ? '<span class="cd-detail">' + esc(n.detail) + '</span>' : '');
  }

  function srText(n, q) {
    var who = n.op === 'SEQ_SCAN' ? 'Scan of ' + n.table : n.name;
    if (n.role) who = (n.role === 'build' ? 'Build side: ' : 'Probe side: ') + who;
    if (n.est === null || n.act === null) return who + '. No estimate.';
    var dir = M.direction(n.est, n.act);
    // Same threshold as the visible label: under 1.5 times off reads as close.
    return who + (n.detail ? ' (' + n.detail + ')' : '') + '. Guessed ' + fmt(n.est) + ' rows, real ' + fmt(n.act) +
      (q < 1.5 ? ', about right.' : dir === 'under' ? ', ' + M.formatQ(q) + ' times too few.' : ', ' + M.formatQ(q) + ' times too many.');
  }

  function fillRow(row, r) {
    var n = r.node;
    row.style.setProperty('--depth', r.depth);
    row.classList.toggle('is-root', r.depth === 0);
    // Where the real count is 1.5 times or more off the guess, the row carries red-pencil corrections.
    row.classList.toggle('is-off', n.est !== null && n.act !== null && r.q >= 1.5);
    var q = r.q;
    var dir = M.direction(n.est, n.act);
    var hasEst = n.est !== null && n.act !== null;
    var op = row.querySelector('.cd-op');
    op.innerHTML = opLabel(n) + '<span class="cd-sr">' + esc(srText(n, q)) + '</span>';
    var estBar = row.querySelector('.cd-bar-est'), actBar = row.querySelector('.cd-bar-act');
    estBar.style.display = hasEst ? '' : 'none';
    actBar.style.display = n.act !== null ? '' : 'none';
    if (hasEst) estBar.style.width = (M.logPos(n.est, MAX) * 100) + '%';
    if (n.act !== null) actBar.style.width = (M.logPos(n.act, MAX) * 100) + '%';
    row.querySelector('.cd-nums').innerHTML = hasEst
      ? '<span class="cd-n-est">' + fmt(n.est) + '</span><span class="cd-n-act">' + fmt(n.act) + '</span>'
      : (n.act !== null ? '<span class="cd-n-est">–</span><span class="cd-n-act">' + fmt(n.act) + '</span>' : '');
    var qEl = row.querySelector('.cd-q');
    qEl.classList.toggle('is-bad', hasEst && q >= 10);
    qEl.innerHTML = hasEst
      ? '<strong>×' + M.formatQ(q) + '</strong><small>' + (q < 1.5 ? 'close' : dir === 'under' ? 'too few' : 'too many') + '</small>'
      : '<span class="cd-none">no guess</span>';
  }

  function newRow(key) {
    var row = document.createElement('div');
    row.className = 'cd-row';
    row.setAttribute('role', 'listitem');
    row.dataset.key = key;
    row.innerHTML = '<div class="cd-op"></div><div class="cd-track" aria-hidden="true"></div><div class="cd-nums" aria-hidden="true"></div><div class="cd-q" aria-hidden="true"></div>';
    var track = row.querySelector('.cd-track');
    for (var t = 10; t < MAX; t *= 10) {
      var g = document.createElement('span');
      g.className = 'cd-gridline';
      g.style.left = (M.logPos(t, MAX) * 100) + '%';
      track.appendChild(g);
    }
    var e = document.createElement('div'); e.className = 'cd-bar cd-bar-est'; e.style.width = '0';
    var a = document.createElement('div'); a.className = 'cd-bar cd-bar-act'; a.style.width = '0';
    track.appendChild(e); track.appendChild(a);
    return row;
  }

  function renderPlan(tree) {
    var rows = M.flatten(tree);
    var old = {};
    var before = {};
    Array.prototype.forEach.call(el.plan.querySelectorAll('.cd-row'), function (r) {
      old[r.dataset.key] = r;
      before[r.dataset.key] = r.getBoundingClientRect().top;
    });
    if (!el.plan.querySelector('.cd-axis')) el.plan.appendChild(axisRow());
    var fresh = [];
    rows.forEach(function (r) {
      var row = old[r.key];
      if (row) delete old[r.key];
      else { row = newRow(r.key); fresh.push(row); }
      fillRow(row, r);
      el.plan.appendChild(row);
    });
    Object.keys(old).forEach(function (k) { old[k].remove(); });
    // New rows start with empty bars and grow; moved rows slide from where they were.
    var motion = !Kit.reducedMotion;
    Array.prototype.forEach.call(el.plan.querySelectorAll('.cd-row'), function (row) {
      var k = row.dataset.key;
      if (fresh.indexOf(row) >= 0) {
        if (!motion) return;
        var bars = row.querySelectorAll('.cd-bar');
        var target = Array.prototype.map.call(bars, function (b) { return b.style.width; });
        Array.prototype.forEach.call(bars, function (b) { b.style.transition = 'none'; b.style.width = '0'; });
        void row.offsetWidth;
        Array.prototype.forEach.call(bars, function (b, i) { b.style.transition = ''; b.style.width = target[i]; });
        return;
      }
      if (!motion || before[k] === undefined) return;
      var dy = before[k] - row.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) return;
      row.style.transition = 'none';
      row.style.transform = 'translateY(' + dy + 'px)';
      row.style.zIndex = '1';
      void row.offsetWidth;
      row.style.transition = 'transform 0.8s cubic-bezier(.3,.7,.2,1)';
      row.style.transform = '';
      setTimeout(function () { row.style.zIndex = ''; row.style.transition = ''; }, 850);
    });
  }

  function estimatesOf(tree) {
    var m = {};
    M.flatten(tree).forEach(function (r) { m[r.key] = { est: r.node.est, act: r.node.act }; });
    return m;
  }

  function renderChange(prev, cur) {
    var text = null;
    if (prev && prev.result && prev.result.tree) {
      var same = M.tablesOf(prev.result.tree).join() === M.tablesOf(cur.result.tree).join();
      if (same) text = M.describeChange(prev.result.tree, cur.result.tree);
      // Name the cause when the visitor changed the filter: DuckDB cannot see skew or the link,
      // so a re-plan that comes with a filter change is the filter's doing.
      if (text && prev.want.scope !== cur.want.scope) {
        text = text.replace(/\.$/, '') + ', because the customer filter changed from ' + M.SCOPES[prev.want.scope].label.toLowerCase() +
          ' to ' + M.SCOPES[cur.want.scope].label.toLowerCase() + '.';
      }
      if (!text && same && M.signature(prev.result.tree) === M.signature(cur.result.tree) &&
          (prev.want.theta !== cur.want.theta || prev.want.rho !== cur.want.rho)) {
        var a = estimatesOf(prev.result.tree), b = estimatesOf(cur.result.tree);
        var estSame = true, actMoved = false;
        Object.keys(b).forEach(function (k) {
          if (!a[k] || a[k].est === null || b[k].est === null) return;
          if (Math.abs(a[k].est - b[k].est) > 0.05 * Math.max(1, a[k].est)) estSame = false;
          if (M.qError(a[k].act, b[k].act) >= 1.5) actMoved = true;
        });
        if (estSame && actMoved) text = 'The real counts moved; DuckDB’s guesses did not. Its statistics (row counts, distinct counts, smallest and largest values) cannot see skew or a link between tables, so the plan stays the same.';
      }
    }
    if (!text) { el.change.hidden = true; return; }
    el.change.hidden = false;
    el.change.textContent = text;
    if (!Kit.reducedMotion) { el.change.classList.remove('is-flash'); void el.change.offsetWidth; el.change.classList.add('is-flash'); }
  }

  function timeRow(label, value, max, kind) {
    return '<div class="cd-time-row' + (kind ? ' is-' + kind : '') + '"><span class="cd-time-label">' + esc(label) + '</span>' +
      '<span class="cd-time-track"><span class="cd-time-bar" style="display:block;width:' + Math.max(1, value / max * 100).toFixed(1) + '%"></span></span>' +
      '<span class="cd-time-ms">' + ms(value) + ' ms</span></div>';
  }

  function resultLine(rows) {
    if (!rows || !rows.length) return 'Result: no rows.';
    var cols = Object.keys(rows[0]);
    var show = rows.slice(0, 3).map(function (r) {
      return cols.slice(0, 4).map(function (c) {
        var v = r[c];
        if (typeof v === 'number') v = Math.abs(v) >= 1000 || Number.isInteger(v) ? Math.round(v).toLocaleString('en-CA') : v.toFixed(2);
        return c + ' = ' + v;
      }).join(', ');
    });
    return 'Result: ' + show.join('; ') + (rows.length > 3 ? '; … (' + fmt(rows.length) + ' rows)' : '.');
  }

  function renderTiming(r) {
    var html = '';
    var t = r.timing.median;
    if (r.preset === 'best' && r.alt) {
      var j = M.findJoin(r.tree, ['customers', 'orders']);
      var build = M.buildTables(j).join();
      var max = Math.max(t, r.alt.timing.median);
      html += timeRow('DuckDB’s plan (builds on ' + build + ')', t, max);
      html += timeRow('Other side (builds on ' + r.alt.build + ')', r.alt.timing.median, max, 'other');
    } else if (r.preset === 'fixed' && r.compare) {
      var mx = Math.max(t, r.compare.timing.median, r.setupMs, r.compareAlt ? r.compareAlt.timing.median : 0);
      html += timeRow('Store product 0’s orders', r.setupMs, mx, 'setup');
      html += timeRow('Join on the stored table', t, mx);
      if (r.compareAlt) html += timeRow('Right build side, no storing', r.compareAlt.timing.median, mx, 'other');
      html += timeRow('DuckDB’s plan, no storing', r.compare.timing.median, mx, 'other');
    } else {
      html += timeRow('This plan', t, t);
    }
    var n = r.timing.runs.length;
    html += '<p class="cd-time-note">' + (n === 1 ? 'One run' : 'Median of ' + n + ' runs') + ' in this tab' +
      (n > 1 ? ' (' + ms(r.timing.min) + '–' + ms(r.timing.max) + ' ms for the first line)' : '') + '. Browser timings are noisy; treat gaps under about a third as noise.' +
      (r.preset === 'best' ? ' The other side is timed with DuckDB’s build-side choice switched off.' : '') +
      (r.preset === 'fixed' && r.compareAlt ? ' The right build side is timed with DuckDB’s build-side choice switched off.' : '') +
      (r.preset === 'custom' ? ' Your own queries run fewer times, so their time is rougher.' : '') + '</p>';
    html += '<p class="cd-result">' + esc(resultLine(r.result)) + '</p>';
    el.time.innerHTML = html;
    el.time.hidden = false;
  }

  // ================================================================== boot

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = function () { reject(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
  }

  function progress(f) { el.bar.style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + '%'; }

  async function boot() {
    setEnabled(false);
    try {
      setStatus('Loading DuckDB-Wasm 1.32.0 from jsDelivr (about 6 MB, cached after the first visit)…');
      progress(0.03);
      await loadScript('engine.js');
      await loadScript('lab.js');
      engine = await window.CardinalEngine.load(function (p) {
        if (p.phase === 'script') progress(0.06);
        else if (p.phase === 'wasm') {
          if (p.total > 0) progress(0.08 + 0.8 * Math.min(1, p.loaded / p.total));
          else progress(0.3);
          setStatus('Loading DuckDB-Wasm 1.32.0… ' + (p.loaded / 1048576).toFixed(1) + ' MB');
        } else if (p.phase === 'ready') progress(0.92);
      });
      lab = new window.CardinalLab(engine, ORDERS);
      setStatus('Generating ' + fmt(ORDERS) + ' orders…');
      progress(0.96);
      ready = true;
      el.status.classList.add('is-ready');
      setEnabled(true);
      renderStory();
      request();
    } catch (err) {
      setStatus('DuckDB could not start in this browser: ' + String(err && err.message || err).slice(0, 160) + '. The project card shows recorded results.', true);
      el.load.hidden = false;
      el.load.textContent = 'Try again';
      el.load.disabled = false;
    }
  }

  buildDots();
  $('cd-tb-data').textContent = fmt(SHAPE.orders) + ' orders';
  wireControls();
  goStep(0);
  var conn = navigator.connection;
  if (conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || ''))) {
    setStatus('DuckDB-Wasm is about 6 MB. Load it when you are ready.');
    setEnabled(false);
    el.load.hidden = false;
    el.load.disabled = false;
  } else {
    boot();
  }

  // ================================================================== preview (the project card)

  function startPreview() {
    var canvas = $('cd-preview');
    var app = $('cd-app');
    if (app) app.hidden = true;
    canvas.hidden = false;
    var ctx = canvas.getContext('2d');
    var REC = M.RECORDED_PREVIEW;
    var frames = REC.frames;
    var W = 0, H = 0, dpr = 1;
    var raf = 0, t0 = 0, playing = false;
    var LOOP = 10.5;

    function resize() {
      var r = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(1, r.width); H = Math.max(1, r.height);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function lerp(a, b, f) { return a + (b - a) * f; }
    function lerpLog(a, b, f) { return Math.exp(lerp(Math.log(Math.max(1, a)), Math.log(Math.max(1, b)), f)); }
    function ease(f) { return f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2; }

    // State at loop time t (seconds).
    function stateAt(t) {
      var cityFrames = frames.filter(function (f) { return f.scope === 'city'; });
      var flipped = frames[frames.length - 1];
      var s = { theta: 0, rows: null, flip: 0, ms: 0, alpha: 1 };
      var sweepStart = 0.8, sweepEnd = 5.8, flipStart = 6.8, flipEnd = 7.8, fadeStart = 9.9;
      var city;
      if (t < sweepStart) city = { idx: 0, f: 0 };
      else if (t < sweepEnd) {
        var x = (t - sweepStart) / (sweepEnd - sweepStart) * (cityFrames.length - 1);
        var i = Math.min(cityFrames.length - 2, Math.floor(x));
        city = { idx: i, f: x - i };
      } else city = { idx: cityFrames.length - 2, f: 1 };
      var A = cityFrames[city.idx], B = cityFrames[city.idx + 1] || A;
      // The dial and bars glide between recorded frames; the numbers shown are always a recorded frame's.
      var nearest = city.f < 0.5 ? A : B;
      s.theta = lerp(A.theta, B.theta, city.f);
      s.thetaLabel = nearest.theta;
      s.ms = nearest.ms;
      s.rows = A.rows.map(function (r, k) {
        var rb = B.rows[k], rn = nearest.rows[k];
        return { key: r.key, label: r.label, detail: r.detail, role: r.role, depth: r.depth, est: lerpLog(r.est, rb.est, city.f), act: lerpLog(r.act, rb.act, city.f), qShow: M.qError(rn.est, rn.act) };
      });
      if (t >= flipStart) {
        var g = ease(Math.min(1, (t - flipStart) / (flipEnd - flipStart)));
        s.flip = g;
        var byKey = {};
        flipped.rows.forEach(function (r, k) { byKey[r.key] = { r: r, k: k }; });
        s.rows = s.rows.map(function (r, k) {
          var to = byKey[r.key];
          return { key: r.key, label: g > 0.5 ? to.r.label : r.label, detail: g > 0.5 ? to.r.detail : r.detail, role: g > 0.5 ? to.r.role : r.role,
            depth: r.depth, est: lerpLog(r.est, to.r.est, g), act: lerpLog(r.act, to.r.act, g), slot: lerp(k, to.k, g),
            qShow: g > 0.5 ? M.qError(to.r.est, to.r.act) : r.qShow };
        });
        if (g > 0.5) { s.ms = flipped.ms; s.altMs = flipped.altMs; }
      }
      if (t >= fadeStart) s.alpha = Math.max(0, 1 - (t - fadeStart) / (LOOP - fadeStart));
      return s;
    }

    // Drawn as a cyanotype: white linework for the optimiser's plan, red pencil for the real counts.
    var C = { bp: '#1c3f6e', deep: '#163257', chalk: '#eef5fb', cyan: '#a9dcef', pencil: '#d9472b', pencilHi: '#ff9175' };
    var MONO = '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif';
    var HAND = '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif';
    var CODE = 'ui-monospace, Menlo, Consolas, monospace'; // filter details, as on the page
    var grid = null; // the field and its drafting grid, drawn once per size

    function drawField() {
      grid = document.createElement('canvas');
      grid.width = canvas.width; grid.height = canvas.height;
      var g = grid.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      var bg = g.createLinearGradient(0, 0, W * 0.2, H);
      bg.addColorStop(0.25, C.bp); bg.addColorStop(1, C.deep);
      g.fillStyle = bg; g.fillRect(0, 0, W, H);
      var x, y;
      g.lineWidth = 1;
      for (x = 0.5; x < W; x += 10) {
        g.strokeStyle = (Math.round(x - 0.5) % 50 === 0) ? 'rgba(169,220,239,0.13)' : 'rgba(169,220,239,0.055)';
        g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
      }
      for (y = 0.5; y < H; y += 10) {
        g.strokeStyle = (Math.round(y - 0.5) % 50 === 0) ? 'rgba(169,220,239,0.13)' : 'rgba(169,220,239,0.055)';
        g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
      }
      var m = Math.max(5, Math.min(W, H) * 0.03);
      g.strokeStyle = 'rgba(238,245,251,0.6)';
      g.strokeRect(m + 0.5, m + 0.5, W - 2 * m - 1, H - 2 * m - 1);
    }

    function draw(s) {
      if (!grid || grid.width !== canvas.width || grid.height !== canvas.height) drawField();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(grid, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = s.alpha;
      var pad = Math.max(14, W * 0.055);
      var fs = Math.max(11, Math.min(15, Math.min(W / 27, H / 15.5)));
      var small = Math.max(11, fs * 0.82);
      ctx.textBaseline = 'middle';
      ctx.lineCap = 'butt';

      // Header: the skew dial as a drafting protractor on the left, the query time on the right.
      var r = Math.max(14, Math.min(H * 0.105, W * 0.065));
      var cx = pad + r, cy = pad + r + 1;
      ctx.strokeStyle = C.chalk; ctx.lineWidth = 1.25;
      ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, 2 * Math.PI); ctx.lineTo(cx - r, cy); ctx.stroke();
      for (var k = 0; k <= 9; k++) {
        var a = Math.PI + Math.PI * k / 9, len = k % 3 === 0 ? 0.28 : 0.15;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        ctx.lineTo(cx + Math.cos(a) * r * (1 - len), cy + Math.sin(a) * r * (1 - len)); ctx.stroke();
      }
      var frac = s.theta / 0.9;
      var ang = Math.PI + Math.PI * frac;
      ctx.strokeStyle = C.cyan; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.55, Math.PI, Math.PI + Math.PI * Math.max(0.001, frac)); ctx.stroke();
      ctx.strokeStyle = C.chalk; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(ang) * r * 1.05, cy + Math.sin(ang) * r * 1.05); ctx.stroke();
      ctx.fillStyle = C.chalk; ctx.fillRect(cx - 2, cy - 2, 4, 4);
      ctx.textAlign = 'left';
      ctx.fillStyle = C.chalk;
      ctx.font = '600 ' + fs + 'px ' + MONO;
      ctx.fillText('SKEW ' + s.thetaLabel.toFixed(1), cx + r + 8, cy - fs * 0.5);
      ctx.textAlign = 'right';
      ctx.fillStyle = C.chalk;
      ctx.font = '600 ' + Math.round(fs * 1.2) + 'px ' + MONO;
      ctx.fillText(Math.round(s.ms) + ' ms', W - pad, cy - fs * 0.5);
      ctx.fillStyle = C.cyan;
      ctx.font = small + 'px ' + MONO;
      // After the flip, the fair comparison: the same query with the other build side.
      var sub = s.altMs ? 'other side ' + Math.round(s.altMs) + ' ms' : 'query time';
      ctx.fillText(sub, W - pad, cy + fs * 0.6);
      var room = W - pad - ctx.measureText(sub).width - 10 - (cx + r + 8);
      ctx.textAlign = 'left';
      // Skew moves the counts; the flip comes from widening the customer filter, so say so.
      // The flip is a revision to the drawing, so it is noted in red pencil.
      if (s.flip > 0.5) {
        var hs = Math.round(fs * 1.0);
        ctx.font = '600 ' + hs + 'px ' + HAND;
        while (hs > 11 && ctx.measureText('filter widened → plan flips').width > room) { hs--; ctx.font = '600 ' + hs + 'px ' + HAND; }
        ctx.fillStyle = C.pencilHi;
        ctx.fillText('filter widened → plan flips', cx + r + 8, cy + fs * 0.6);
      } else {
        ctx.font = small + 'px ' + MONO;
        ctx.fillText('customers in one city', cx + r + 8, cy + fs * 0.6);
      }

      // Rows.
      var ly = Math.max(cy + r * 0.3, cy + fs * 1.3) + fs * 0.75; // legend line, below the subtitle
      var top = ly + fs * 0.85;
      var rowH = (H - top - pad * 0.75) / s.rows.length;
      // Bars start just right of the widest operator label.
      var labelW = 0;
      s.rows.forEach(function (row) {
        var w = row.depth * fs;
        ctx.font = '700 11px ' + MONO;
        if (row.role) w += ctx.measureText(row.role.toUpperCase()).width + 14;
        ctx.font = '600 ' + fs + 'px ' + MONO;
        labelW = Math.max(labelW, w + ctx.measureText(row.label).width + 12);
      });
      labelW = Math.max(labelW, W * 0.3);
      var qW = Math.max(46, fs * 3.6);
      var bx = pad + labelW, bw = W - pad - qW - bx - 8;
      var MAXV = 1e6 * 1.5;
      ctx.strokeStyle = C.chalk; ctx.lineWidth = 1.25;
      ctx.beginPath(); ctx.moveTo(pad, top - 2); ctx.lineTo(W - pad, top - 2); ctx.stroke();
      s.rows.forEach(function (row, k) {
        var slot = row.slot !== undefined ? row.slot : k;
        var y = top + slot * rowH;
        var mid = y + rowH / 2;
        var indent = row.depth * fs * 1.0;
        ctx.textAlign = 'left';
        var x = pad + indent;
        if (row.depth > 0) { // schematic connector from the parent
          ctx.strokeStyle = 'rgba(238,245,251,0.7)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(pad + fs * 0.35, y - rowH * 0.25); ctx.lineTo(pad + fs * 0.35, mid - fs * 0.6); ctx.lineTo(x - 2, mid - fs * 0.6); ctx.stroke();
        }
        if (row.role) {
          ctx.font = (row.role === 'build' ? '600 ' : '') + 11 + 'px ' + MONO;
          var tw = ctx.measureText(row.role.toUpperCase()).width + 8, th = 15;
          var ty = mid - fs * 0.6 - th / 2;
          if (row.role === 'build') { ctx.fillStyle = C.chalk; ctx.fillRect(x, ty, tw, th); ctx.fillStyle = C.deep; }
          else {
            ctx.strokeStyle = C.cyan; ctx.lineWidth = 1; ctx.setLineDash([2, 2]);
            ctx.strokeRect(x + 0.5, ty + 0.5, tw - 1, th - 1); ctx.setLineDash([]); ctx.fillStyle = C.cyan;
          }
          ctx.fillText(row.role.toUpperCase(), x + 4, ty + th / 2 + 0.5);
          ctx.fillStyle = C.chalk;
          ctx.font = '600 ' + fs + 'px ' + MONO;
          ctx.fillText(row.label, x + tw + 6, mid - fs * 0.6);
        } else {
          ctx.fillStyle = C.chalk;
          ctx.font = '600 ' + fs + 'px ' + MONO;
          ctx.fillText(row.label, x, mid - fs * 0.6);
        }
        ctx.fillStyle = C.cyan;
        ctx.font = small + 'px ' + CODE;
        ctx.fillText(row.detail, x, mid + fs * 0.62);
        // Bars: the guess as a white dimension line, the real count as a red-pencil stroke.
        var h = Math.max(5, Math.min(8, rowH * 0.15));
        var we = Math.max(2, bw * M.logPos(row.est, MAXV)), wa = Math.max(2, bw * M.logPos(row.act, MAXV));
        var ey = mid - h - 2;
        ctx.strokeStyle = C.chalk; ctx.lineWidth = 1.25;
        ctx.strokeRect(bx + 0.6, ey, we - 1.2, h);
        ctx.beginPath(); ctx.moveTo(bx + we - 0.6, ey - 3); ctx.lineTo(bx + we - 0.6, ey + h + 3); ctx.stroke();
        ctx.fillStyle = C.pencil; ctx.fillRect(bx, mid + 2, wa, h);
        ctx.strokeStyle = C.pencilHi; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, mid + 2.5, wa - 1, h - 1);
        // q-error: lettered when close, written in red pencil when off, ringed past x10.
        var q = row.qShow;
        var qx = W - pad - (q >= 10 ? 5 : 0), qy = mid - fs * 0.35;
        ctx.textAlign = 'right';
        if (q < 1.5) {
          ctx.fillStyle = C.chalk; ctx.font = '600 ' + fs + 'px ' + MONO;
          ctx.fillText('×' + M.formatQ(q), qx, qy);
          ctx.fillStyle = C.cyan; ctx.font = small + 'px ' + MONO;
          ctx.fillText('close', qx, mid + fs * 0.7);
        } else {
          ctx.fillStyle = C.pencilHi; ctx.font = '600 ' + Math.round(fs * 1.15) + 'px ' + HAND;
          var label = '×' + M.formatQ(q);
          ctx.fillText(label, qx - 2, qy);
          if (q >= 10) {
            var lw = ctx.measureText(label).width;
            ctx.save();
            ctx.strokeStyle = C.pencilHi; ctx.lineWidth = 1.4;
            ctx.translate(qx - 2 - lw / 2, qy + 1); ctx.rotate(-0.08);
            ctx.beginPath(); ctx.ellipse(0, 0, lw / 2 + 6, fs * 0.82, 0, 0.15, Math.PI * 2 + 0.05); ctx.stroke();
            ctx.restore();
          }
          ctx.font = '600 ' + Math.round(fs * 0.95) + 'px ' + HAND;
          ctx.fillText(row.act < row.est ? 'too many' : 'too few', qx, mid + fs * 0.85);
        }
        if (k < s.rows.length - 1 || row.slot !== undefined) {
          ctx.strokeStyle = 'rgba(169,220,239,0.3)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(pad, y + rowH); ctx.lineTo(W - pad, y + rowH); ctx.stroke();
        }
      });
      // Legend under the dial row, over the bars.
      ctx.textAlign = 'left';
      ctx.font = small + 'px ' + MONO;
      ctx.strokeStyle = C.chalk; ctx.lineWidth = 1.25; ctx.strokeRect(bx + 0.6, ly - 3.5, 13, 7);
      ctx.fillStyle = C.cyan; ctx.fillText('guess', bx + 18, ly);
      var gx = bx + 18 + ctx.measureText('guess').width + 10;
      ctx.fillStyle = C.pencil; ctx.fillRect(gx, ly - 3.5, 13, 7);
      ctx.strokeStyle = C.pencilHi; ctx.lineWidth = 1; ctx.strokeRect(gx + 0.5, ly - 3, 12, 6);
      ctx.fillStyle = C.cyan; ctx.fillText('real', gx + 18, ly);
      ctx.globalAlpha = 1;
    }

    var tNow = 8.6; // the still frame: skewed, flipped, guesses far from the counts
    function frame(ts) {
      if (!playing) return;
      if (!t0) t0 = ts - tNow * 1000;
      tNow = ((ts - t0) / 1000) % LOOP;
      draw(stateAt(tNow));
      raf = requestAnimationFrame(frame);
    }

    resize();
    draw(stateAt(tNow));
    // The drawing's lettering is self-hosted; redraw the still frame once it has loaded.
    if (document.fonts && document.fonts.load) {
      Promise.all([document.fonts.load('400 12px "Inter"'), document.fonts.load('600 12px "Inter"')])
        .then(function () { if (!playing) draw(stateAt(tNow)); }, function () {});
    }
    window.addEventListener('resize', function () { resize(); draw(stateAt(tNow)); });
    Kit.onPlay(function (on) {
      playing = on;
      if (on) { t0 = 0; cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); }
      else { cancelAnimationFrame(raf); raf = 0; draw(stateAt(tNow)); }
    });
  }
})();
