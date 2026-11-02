// Undertow: the page. The simulation itself lives in model.js; the figures quoted for many
// seeds come from data.js, which tools/build-data.js computes from model.js.
(function () {
  'use strict';
  var U = window.Undertow, D = window.UndertowData, Kit = window.Kit;
  if (!U || !D || !Kit) return;
  function $(id) { return document.getElementById(id); }

  var PREVIEW = Kit.preview;
  var stage = document.querySelector('.ut-stage');
  var COL = {
    first: '#3f6377', retry: '#a84f2a', good: '#4d7350', dead: '#8f9388', ink: '#343630',
    strong: '#252821', muted: '#686d62', line: '#dedfd7', lineStrong: '#b5bdaf', bg: '#faf9f6',
    scene: '#f3f3ed', shade: 'rgba(168, 79, 42, 0.07)', pauseShade: 'rgba(63, 99, 119, 0.08)'
  };
  var FONT = getComputedStyle(document.documentElement).getPropertyValue('--font') || 'sans-serif';
  var LAT = U.DEFAULTS.latency;
  var RUN_LEN = 600;        // seconds a run may last on the page
  var WINDOW = 60;          // seconds shown in the charts
  var BIN = U.DEFAULTS.bin;
  var N = U.DEFAULTS.clients;
  var WAKE = 0.6;           // simulated seconds a path stays faintly visible after a flight

  var RETRY_NAMES = {
    none: 'no retries', immediate: 'retry at once', fixed: 'retry after 0.5 s', backoff: 'backoff',
    full: 'full jitter', equal: 'equal jitter', decorrelated: 'decorrelated jitter'
  };
  var SHED_NAMES = { off: 'first in, first out', stale: 'drop past timeout', early: 'drop past ½ timeout', lifo: 'newest first' };

  // ------------------------------------------------------------------ state
  var settings = { retry: 'immediate', maxAttempts: 3, timeout: 1, budget: false, breaker: false, shed: 'off', factor: 2.5 };
  var sim = null, seed = 1, mode = 0, runOpts = null;
  var particles = [], marks = [];
  var pulseTimeout = new Float64Array(N).fill(-9), pulseOk = new Float64Array(N).fill(-9);
  var speed = 2, userRunning = true, kitPlaying = false, raf = 0, lastTs = 0;
  var live = null;          // live recovery tracking
  var chartMax = null;
  var seen = {};
  var budgetOnAt = null;
  var challengeResult = null, checking = null;
  var preview = PREVIEW ? { remedyAt: 13, loopAt: 24, label: '' } : null;

  // ------------------------------------------------------------------ guided path
  var STEP_UI = [
    { title: 'Healthy.', line: 'Twenty clients send about 28 requests a second to four workers, 70% of what they can serve. Each client waits up to 1 s for a reply.' },
    { title: 'A spike, no retries.', line: 'At 5 s the load jumps to 2.5× for 4 s. Waits grow past the timeout and clients give up, but none of them retries.' },
    { title: 'The same spike, with retries.', line: 'Now a client that times out sends the request again at once, up to 3 attempts in all. Retries are diamonds.' },
    { title: 'Backoff.', line: 'Each retry now waits first, 0.2 s and then 0.4 s: exponential backoff.' },
    { title: 'Jitter.', line: 'Each wait is now random, between zero and the backoff, so clients no longer retry in step: “full jitter”.' },
    { title: 'A retry budget.', line: 'The same storm, with jittered backoff. Once it is down, switch on a retry budget: each client may then retry only about one request in ten.' }
  ];
  var CH_UI = { title: 'Challenge.', line: 'A 3× spike for 6 s. Find settings that recover in at least 18 of 20 seeded runs while still retrying (2 or more attempts).' };
  var EX_UI = { title: 'Explore.', line: 'Your own run. Change anything at any time, and fire a spike or a server pause from the Server box.' };

  function stepData(key) {
    for (var i = 0; i < D.steps.length; i++) if (D.steps[i].key === key) return D.steps[i];
    return null;
  }

  function copy(o) { var r = {}; for (var k in o) r[k] = o[k]; return r; }

  function applyOptsToSettings(o) {
    settings.retry = o.retry || 'immediate';
    settings.maxAttempts = o.maxAttempts || 3;
    settings.timeout = o.timeout || 1;
    settings.budget = !!o.budget;
    settings.breaker = !!o.breaker;
    settings.shed = o.shed || 'off';
    syncControls();
  }

  function settingsOpts() {
    return { retry: settings.retry, maxAttempts: settings.maxAttempts, timeout: settings.timeout,
             budget: settings.budget, breaker: settings.breaker, shed: settings.shed };
  }

  function newRun(opts, s) {
    runOpts = copy(opts);
    var o = copy(opts);
    o.duration = RUN_LEN;
    sim = new U.Sim(o, s);
    sim.log = [];
    seed = s;
    particles = []; marks = [];
    pulseTimeout.fill(-9); pulseOk.fill(-9);
    live = { downSince: null, recoveredAt: null, lastEnd: 0 };
    chartMax = { rate: 60, p99: 2 };
    budgetOnAt = settings.budget && mode === 5 ? 0 : null;
    challengeResult = null;
    draw();
    updateGuide(true);
  }

  function startStep(m) {
    cancelCheck();
    mode = m;
    if (typeof m === 'number') {
      var st = U.STEPS[m];
      var o = copy(st.opts); delete o.duration;
      applyOptsToSettings(o);
      newRun(o, 1);
    } else if (m === 'challenge') {
      applyOptsToSettings({ retry: 'immediate' });
      newRun(challengeOpts(), 1);
    } else {
      var e = settingsOpts(); e.trigger = 'none';
      newRun(e, 1);
    }
    seen[m] = true;
    renderStepButtons();
    renderPhaseCurrent();
    ensureLoop();
  }

  function challengeOpts() {
    var o = settingsOpts();
    for (var k in U.CHALLENGE) o[k] = U.CHALLENGE[k];
    return o;
  }

  function runAgain() {
    cancelCheck();
    var o;
    if (mode === 'challenge') o = challengeOpts();
    else if (mode === 'explore') { o = settingsOpts(); o.trigger = 'none'; }
    else { o = copy(U.STEPS[mode].opts); delete o.duration; var so = settingsOpts(); for (var k in so) o[k] = so[k]; if (mode === 5) o.budget = false; }
    if (mode === 5) { settings.budget = false; syncControls(); }
    newRun(o, seed + 1);
    userRunning = true; syncPlay();
    ensureLoop();
  }

  // A visitor's change to a setting during steps 1 to 5 makes the run their own.
  function userChanged(key) {
    if (typeof mode === 'number' && !(mode === 5 && key === 'budget')) {
      mode = 'explore';
      seen.explore = true;
      renderStepButtons();
    }
    if (mode === 5 && key === 'budget') budgetOnAt = settings.budget ? sim.now : null;
    renderPhaseCurrent();
    updateGuide(true);
  }

  // ------------------------------------------------------------------ live measures
  function sumBins(arr, a, b) { var s = 0; for (var i = Math.max(0, a); i < b; i++) s += arr[i]; return s; }
  function recent(span) {
    var m = sim.m, b1 = Math.floor(sim.now / BIN), b0 = b1 - Math.round(span / BIN);
    var secs = (b1 - Math.max(0, b0)) * BIN || 1;
    var done = sumBins(m.done, b0, b1);
    return {
      offered: sumBins(m.demand, b0, b1) / secs,
      good: sumBins(m.good, b0, b1) / secs,
      sent: sumBins(m.sent, b0, b1) / secs,
      done: done / secs,
      wasted: done ? sumBins(m.late, b0, b1) / done : 0,
      retries: sumBins(m.retries, b0, b1) / secs
    };
  }
  function activeTrigger() {
    var t = sim.now;
    for (var i = 0; i < sim.triggers.length; i++) { var tr = sim.triggers[i]; if (t >= tr.start && t < tr.end) return tr; }
    return null;
  }
  function trackRecovery() {
    var te = sim.lastTriggerEnd();
    if (te !== live.lastEnd) { live.lastEnd = te; live.downSince = null; live.recoveredAt = null; }
    if (!sim.triggers.length || sim.now < te + 1) return;
    var r = recent(2);
    var ratio = r.offered ? r.good / r.offered : 1;
    if (live.recoveredAt === null) {
      if (ratio >= 0.9) {
        // Report it the way the model's figures do (sim.recoveryTime): the start of the first 2 s
        // window at 90% or more that is not followed by a fall below 60%.
        var from = mode === 5 && budgetOnAt !== null && budgetOnAt > te ? budgetOnAt : te;
        var rt = sim.recoveryTime(from);
        live.recoveredAt = rt !== null ? from + rt : sim.now - 2;
      }
      else if (ratio < 0.5 && live.downSince === null) live.downSince = sim.now;
    } else if (ratio < 0.6) {
      live.recoveredAt = null; live.downSince = sim.now;
    }
  }
  function sinceEnd() { return Math.max(0, Math.floor(sim.now - sim.lastTriggerEnd())); }
  function f0(x) { return Math.round(x).toString(); }
  function f1(x) { return (Math.round(x * 10) / 10).toFixed(1); }
  function recentP(which, span) {
    var b1 = Math.floor(sim.now / BIN), b0 = Math.max(0, b1 - Math.round(span / BIN)), s = 0, n = 0;
    for (var b = b0; b < b1; b++) { var v = sim.m[which][b]; if (v === v) { s += v; n++; } }
    return n ? s / n : NaN;
  }

  // ------------------------------------------------------------------ guide text
  var guideKey = '';
  function setGuide(title, line, outcome, actions) {
    var key = title + '|' + line + '|' + outcome + '|' + (actions || []).map(function (a) { return a.label; }).join(',');
    if (key === guideKey) return;
    guideKey = key;
    $('ut-title').textContent = title;
    $('ut-line').textContent = line;
    $('ut-outcome').innerHTML = outcome;
    var box = $('ut-actions');
    var focused = box.contains(document.activeElement) ? document.activeElement.textContent : null;
    box.textContent = '';
    (actions || []).forEach(function (a) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'kit-button' + (a.primary ? ' is-primary' : '');
      b.textContent = a.label;
      if (a.disabled) b.disabled = true;
      b.addEventListener('click', a.run);
      box.appendChild(b);
      if (focused === a.label) b.focus();
    });
  }

  function nextAction() {
    if (typeof mode !== 'number') return [];
    var nxt = mode < 5 ? mode + 1 : 'challenge';
    var label = mode < 5 ? 'Next: ' + STEP_UI[mode + 1].title.replace(/\.$/, '').toLowerCase() : 'Next: the challenge';
    return [{ label: label, primary: true, run: function () { startStep(nxt); focusGuide(); } }];
  }
  function focusGuide() { var b = document.querySelector('.ut-step[aria-current="step"]'); if (b) b.focus(); }

  function downLine() {
    var r = recent(2);
    return 'The spike ended ' + sinceEnd() + ' s ago. Goodput: <b>' + f0(r.good) + '</b> of ' + f0(r.offered) + ' requests a second.';
  }

  function updateGuide(force) {
    if (PREVIEW || !sim) return;
    if (force) guideKey = '';
    stage.classList.toggle('is-guided', typeof mode === 'number' || mode === 'challenge');
    var t = sim.now, te = sim.lastTriggerEnd(), tr = activeTrigger(), r = recent(2);
    var out = '', acts = [];
    var down = live.recoveredAt === null && live.downSince !== null;
    var recovered = live.recoveredAt !== null;
    if (typeof mode === 'number') {
      var ui = STEP_UI[mode], sd = stepData(U.STEPS[mode].key);
      if (mode === 0) {
        if (t >= 6) {
          out = 'Goodput keeps up with offered load, about <b>' + f0(r.offered) + '</b> a second. Half of all replies take under ' +
            f1(recentP('p50', 6)) + ' s and 99% under ' + f1(recentP('p99', 6)) + ' s, well inside the timeout.';
          acts = nextAction();
        }
      } else if (mode === 1) {
        if (tr) out = 'The queue fills and waits pass the timeout. Workers now serve requests whose clients have already left.';
        else if (t >= te && !recovered) out = 'The spike is over. The workers are clearing a backlog that nobody is waiting for.';
        else if (recovered) {
          out = '<b>Recovered ' + f0(live.recoveredAt - te) + ' s after the spike ended.</b> In ' + sd.runs + ' seeded runs it recovered in ' + sd.recovered +
            ', after a median ' + f0(sd.medianRecovery) + ' s.';
          acts = nextAction();
        }
      } else if (mode >= 2 && mode <= 4) {
        if (tr && mode === 2) out = 'Every timeout now sends another copy, and the copies wait in the same queue.';
        else if (tr) out = 'The spike is on.';
        else if (t >= te) {
          if (recovered) out = 'This run recovered. In ' + sd.runs + ' seeded runs, ' + sd.held + ' stayed down.';
          else {
            out = downLine();
            if (t >= te + 6) {
              var amp = r.offered ? r.sent / r.offered : 1;
              if (mode === 2) out += ' Load is back to normal, but the workers are busy on copies whose clients have given up. <b>This is the undertow.</b> Two safety rules, give up after a timeout and try again, are together keeping it down. Nobody designed this outage.';
              if (mode === 3) out += ' <b>Still down.</b> Backoff delays each retry but does not cancel it: the server still gets ' + f1(amp) + '× the requests.';
              if (mode === 4) out += ' <b>Still down.</b> Jitter spreads the retries out; it does not make them fewer (' + f1(amp) + '× the requests).';
              out += ' Stuck in ' + sd.held + ' of ' + sd.runs + ' seeded runs.';
              acts = nextAction();
            }
          }
        }
      } else if (mode === 5) {
        if (!settings.budget) {
          if (tr) out = 'The spike is on.';
          else if (t >= te) {
            out = downLine();
            if (!recovered) acts = [{ label: 'Switch on the retry budget', primary: true, run: function () { setToggle('budget', true); } }];
          }
        } else {
          var rr = recent(4);
          if (t < te) out = 'The budget is on.';
          else if (!recovered) out = 'Budget on. Retries are now ' + f0(rr.offered ? 100 * rr.retries / rr.offered : 0) + '% of new requests; the queue is draining (' + sim.qLen() + ' waiting).';
          else {
            var from = budgetOnAt !== null && budgetOnAt > te ? budgetOnAt : te;
            out = '<b>Recovered ' + f0(Math.max(0, live.recoveredAt - from)) + ' s after ' + (from === te ? 'the spike ended' : 'the budget went on') + '.</b> ' +
              'The extra load had been the retries themselves. In ' + sd.runs + ' seeded runs with the budget switched on at 15 s, ' + sd.recovered +
              ' recovered, after a median ' + f0(sd.medianRecovery) + ' s.';
            acts = nextAction();
          }
        }
      }
      setGuide(ui.title, ui.line, out, acts);
    } else if (mode === 'challenge') {
      if (checking) out = 'Checking your settings: ' + checking.done + ' of ' + U.CHALLENGE_SEEDS + ' runs…';
      else if (challengeResult) out = challengeResult;
      else out = liveStatus(tr, te, recovered, down);
      acts = [
        { label: 'Run with these settings', run: function () { runAgain(); } },
        { label: checking ? 'Checking…' : 'Check over 20 runs', primary: true, disabled: !!checking, run: checkChallenge }
      ];
      setGuide(CH_UI.title, CH_UI.line, out, acts);
    } else {
      setGuide(EX_UI.title, EX_UI.line, liveStatus(tr, te, recovered, down), []);
    }
  }

  function liveStatus(tr, te, recovered, down) {
    if (!sim.triggers.length) return 'No spike yet.';
    if (tr) return tr.kind === 'spike' ? 'Spike on: ' + f1(tr.factor) + '× the load.' : 'The server is paused.';
    if (recovered) return 'Recovered ' + f0(live.recoveredAt - te) + ' s after the ' + (sim.triggers[sim.triggers.length - 1].kind === 'pause' ? 'pause' : 'spike') + ' ended.';
    if (down) return downLine().replace('The spike', sim.triggers[sim.triggers.length - 1].kind === 'pause' ? 'The pause' : 'The spike');
    return 'Watching for recovery…';
  }

  // ------------------------------------------------------------------ challenge check
  function cancelCheck() { if (checking) { clearTimeout(checking.timer); checking = null; } }
  function checkChallenge() {
    cancelCheck();
    var opts = challengeOpts();
    var retrying = opts.retry !== 'none' && opts.maxAttempts >= 2;
    var seeds = U.seedList(U.CHALLENGE_SEEDS);
    checking = { done: 0, ok: 0, timer: 0 };
    challengeResult = null;
    updateGuide(true);
    (function stepCheck() {
      if (!checking) return;
      var t0 = performance.now();
      while (checking.done < seeds.length && performance.now() - t0 < 12) {
        if (!U.simulate(opts, seeds[checking.done]).summary().stuck) checking.ok++;
        checking.done++;
      }
      if (checking.done < seeds.length) { checking.timer = setTimeout(stepCheck, 0); updateGuide(); return; }
      var ok = checking.ok;
      checking = null;
      var desc = describe(opts);
      if (!retrying) challengeResult = 'Recovered in <b>' + ok + ' of 20</b> runs, but without retries. Retrying is the point: keep 2 or more attempts.';
      else if (ok >= U.CHALLENGE_PASS) challengeResult = '<b>Passed: recovered in ' + ok + ' of 20 runs</b> with ' + desc + '. Look at the bottom rows of the map below for the others that work.';
      else challengeResult = 'Recovered in <b>' + ok + ' of 20</b> runs with ' + desc + '. Not yet. A remedy has to cut the work the server does for nobody, not just move it in time.';
      updateGuide(true);
    })();
  }
  function describe(o) {
    var parts = [RETRY_NAMES[o.retry] + ', ' + o.maxAttempts + ' attempts, ' + f1(o.timeout) + ' s timeout'];
    if (o.budget) parts.push('a retry budget');
    if (o.breaker) parts.push('a circuit breaker');
    if (o.shed !== 'off') parts.push(SHED_NAMES[o.shed]);
    return parts.join(', ');
  }

  // ------------------------------------------------------------------ controls
  function syncControls() {
    if (PREVIEW) return;
    $('ut-retry').value = settings.retry;
    $('ut-attempts').value = settings.maxAttempts;
    $('ut-attempts-out').textContent = String(settings.maxAttempts);
    $('ut-timeout').value = settings.timeout;
    $('ut-timeout-out').textContent = f1(settings.timeout) + ' s';
    $('ut-factor').value = settings.factor;
    $('ut-factor-out').textContent = f1(settings.factor) + '×';
    $('ut-budget').setAttribute('aria-pressed', String(settings.budget));
    $('ut-breaker').setAttribute('aria-pressed', String(settings.breaker));
    $('ut-shed').value = settings.shed;
    $('ut-attempts').disabled = settings.retry === 'none';
    var helps = {
      off: 'Requests are served in the order they arrived.',
      stale: 'A free worker skips any request that has waited longer than the timeout.',
      early: 'A free worker skips any request that has waited longer than half the timeout.',
      lifo: 'While the oldest request has waited over 0.25 s, the newest is served first.'
    };
    var extra = [];
    if (settings.budget) extra.push('Budget: each new request earns a client 0.1 of a retry; it can hold one.');
    if (settings.breaker) extra.push('Breaker: after 5 failures in its last 10 tries, a client sends nothing for 2 s, then tests with one request.');
    $('ut-help').textContent = helps[settings.shed] + (extra.length ? ' ' + extra.join(' ') : '');
    renderPhaseCurrent();
  }

  function mark(label) { if (sim) marks.push({ t: sim.now, label: label }); }

  function setSetting(key, value, label) {
    settings[key] = value;
    if (sim) sim.set(key, value);
    if (label) mark(label);
    syncControls();
    userChanged(key);
    if (!userRunning || !kitPlaying) draw();
  }
  function setToggle(key, on) {
    var names = { budget: 'budget', breaker: 'breaker' };
    setSetting(key, on, names[key] + (on ? ' on' : ' off'));
  }

  function bindControls() {
    $('ut-retry').addEventListener('change', function (e) { setSetting('retry', e.target.value, RETRY_NAMES[e.target.value]); });
    $('ut-attempts').addEventListener('input', function (e) { setSetting('maxAttempts', +e.target.value); });
    $('ut-attempts').addEventListener('change', function (e) { mark(e.target.value + ' attempts'); });
    $('ut-timeout').addEventListener('input', function (e) { setSetting('timeout', +e.target.value); });
    $('ut-timeout').addEventListener('change', function (e) { mark('timeout ' + f1(+e.target.value) + ' s'); });
    $('ut-factor').addEventListener('input', function (e) { settings.factor = +e.target.value; syncControls(); });
    $('ut-budget').addEventListener('click', function () { setToggle('budget', !settings.budget); });
    $('ut-breaker').addEventListener('click', function () { setToggle('breaker', !settings.breaker); });
    $('ut-shed').addEventListener('change', function (e) { setSetting('shed', e.target.value, SHED_NAMES[e.target.value]); });
    $('ut-spike').addEventListener('click', function () {
      if (!sim || activeTrigger()) return;
      sim.addTrigger('spike', sim.now, 4, settings.factor);
      ensureLoop();
    });
    $('ut-pause').addEventListener('click', function () {
      if (!sim || activeTrigger()) return;
      sim.addTrigger('pause', sim.now, 2, 1);
      ensureLoop();
    });
    $('ut-play').addEventListener('click', function () { userRunning = !userRunning; syncPlay(); ensureLoop(); });
    $('ut-again').addEventListener('click', runAgain);
    $('ut-speed').addEventListener('change', function (e) { speed = +e.target.value; });
    Array.prototype.forEach.call(document.querySelectorAll('.ut-step'), function (b) {
      b.addEventListener('click', function () {
        var s = b.getAttribute('data-step');
        startStep(/^\d$/.test(s) ? +s : s);
      });
    });
  }
  function syncPlay() {
    var ended = sim && sim.now >= RUN_LEN;
    $('ut-play').textContent = userRunning && !ended ? 'Pause' : 'Play';
    $('ut-play').disabled = !!ended;
    var busy = sim && !!activeTrigger();
    $('ut-spike').disabled = busy; $('ut-pause').disabled = busy;
  }
  function renderStepButtons() {
    Array.prototype.forEach.call(document.querySelectorAll('.ut-step'), function (b) {
      var s = b.getAttribute('data-step');
      var m = /^\d$/.test(s) ? +s : s;
      if (m === mode) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
      b.classList.toggle('is-seen', !!seen[m]);
    });
  }

  // ------------------------------------------------------------------ phase map
  var ROW_LABELS = {
    none: 'no retries', immediate: 'retry at once', fixed: 'fixed 0.5 s', backoff: 'backoff', full: 'full jitter',
    equal: 'equal jitter', decorrelated: 'decorrelated', budget: '+ retry budget', stale: '+ drop past timeout',
    early: '+ drop past ½ timeout', lifo: '+ newest first', breaker: '+ circuit breaker'
  };
  function cellColour(k, n) {
    // None recover: deep rust (white text). Any recover: from a light rust to pale sage (dark text),
    // light enough that dark text keeps at least 4.5:1 contrast. The number is always shown.
    var a = [168, 79, 42], b = [214, 226, 208];
    var f = k === 0 ? 0 : 0.42 + 0.58 * k / n;
    return 'rgb(' + a.map(function (v, i) { return Math.round(v + (b[i] - v) * f); }).join(',') + ')';
  }
  function buildPhase() {
    var tbl = $('ut-phase');
    if (!tbl) return;
    var P = D.phase;
    var html = '<thead><tr><th scope="col"><span class="ut-muted">spike</span></th>';
    P.factors.forEach(function (f) { html += '<th scope="col">' + f + '×</th>'; });
    html += '</tr></thead><tbody>';
    P.rows.forEach(function (key, i) {
      html += '<tr data-row="' + key + '"' + (key === 'budget' ? ' class="is-gap"' : '') + '><th scope="row">' + ROW_LABELS[key] + '</th>';
      P.recovered[i].forEach(function (k) {
        html += '<td class="' + (k === 0 ? 'is-down' : 'is-up') + '" style="background:' + cellColour(k, P.seeds) + '" aria-label="' + k + ' of ' + P.seeds + ' recover">' + k + '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody><caption>Numbers are recovering runs out of ' + P.seeds + '. Deep rust: it stayed down every time. <span id="ut-phase-here">Outlined: the cell for your current settings.</span></caption>';
    tbl.innerHTML = html;
  }
  function renderPhaseCurrent() {
    var key = null;
    var remedies = (settings.budget ? 1 : 0) + (settings.breaker ? 1 : 0) + (settings.shed !== 'off' ? 1 : 0);
    if (settings.maxAttempts === 3 && settings.timeout === 1) {
      if (remedies === 0) key = settings.retry;
      else if (remedies === 1 && settings.retry === 'immediate') key = settings.budget ? 'budget' : settings.breaker ? 'breaker' : settings.shed;
    }
    // The spike this run uses: the guided steps use the model's default, the challenge its own.
    var factor = mode === 'challenge' ? U.CHALLENGE.spikeFactor : mode === 'explore' ? settings.factor : U.DEFAULTS.spikeFactor;
    var col = D.phase.factors.indexOf(Math.round(factor * 10) / 10);
    if (typeof mode === 'number' && mode === 0) col = -1;
    // Every cell is a 4 s spike; the challenge's lasts 6 s, so no cell stands for it.
    if (mode === 'challenge') col = -1;
    var here = $('ut-phase-here');
    if (here) here.textContent = mode === 'challenge'
      ? 'No cell is outlined in the challenge: every cell is a 4 s spike, and the challenge’s lasts 6 s.'
      : 'Outlined: the cell for your current settings.';
    Array.prototype.forEach.call(document.querySelectorAll('#ut-phase tbody tr'), function (tr) {
      var on = tr.getAttribute('data-row') === key;
      tr.classList.toggle('is-current', on);
      Array.prototype.forEach.call(tr.querySelectorAll('td'), function (td, i) {
        var here = on && i === col;
        td.classList.toggle('is-here', here);
        if (here) td.setAttribute('title', 'Your current settings'); else td.removeAttribute('title');
      });
    });
  }

  // ------------------------------------------------------------------ canvas helpers
  function fit(cv) {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return null;
    var bw = Math.round(w * dpr), bh = Math.round(h * dpr);
    if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, W: w, H: h };
  }
  function glyph(ctx, x, y, r, retry, filled, colour) {
    ctx.beginPath();
    if (retry) {
      var d = r * 1.25;
      ctx.moveTo(x, y - d); ctx.lineTo(x + d, y); ctx.lineTo(x, y + d); ctx.lineTo(x - d, y); ctx.closePath();
    } else ctx.arc(x, y, r, 0, 2 * Math.PI);
    if (filled) { ctx.fillStyle = colour; ctx.fill(); }
    else { ctx.strokeStyle = colour; ctx.lineWidth = Math.max(1, r * 0.35); ctx.stroke(); }
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }

  // ------------------------------------------------------------------ scene
  // Rows fill from the middle outwards, so a short queue sits in the centre of the pool.
  function rowOrder(n) {
    var out = [], a = Math.floor((n - 1) / 2), b = a + 1;
    while (out.length < n) { if (a >= 0) out.push(a--); if (b < n) out.push(b++); }
    return out;
  }
  var L = null;
  function layout(W, H) {
    var small = W < 560;
    var top = small ? 30 : 38;
    var bottom = H - (PREVIEW ? Math.max(46, H * 0.27) : (small ? 26 : 30));
    var ch = (bottom - top) / N;
    var clients = [];
    var cx = Math.max(16, W * 0.06);
    for (var i = 0; i < N; i++) clients.push({ x: cx, y: top + (i + 0.5) * ch });
    var qx0 = W * 0.2, qx1 = W * (small ? 0.72 : 0.7);
    // 20 x 10 places, or 10 x 20 when the space is tall and narrow (phones)
    var qcols = (qx1 - qx0) / (bottom - top) < 1.2 ? 10 : 20, qrows = 200 / qcols;
    var cell = Math.min((qx1 - qx0) / qcols, (bottom - top) / qrows);
    var gw = cell * qcols, gh = cell * qrows;
    var gx0 = qx0 + (qx1 - qx0 - gw) / 2, gy0 = (top + bottom) / 2 - gh / 2;
    var mid = (top + bottom) / 2;
    var wx0 = W * (small ? 0.79 : 0.8), wx1 = W - Math.max(10, W * 0.035);
    var wgap = small ? 6 : 10;
    var wh = Math.min((bottom - top - 3 * wgap) / 4, Math.max(28, cell * 3));
    var wy0 = mid - (4 * wh + 3 * wgap) / 2;
    var workers = [];
    for (var w = 0; w < 4; w++) workers.push({ x: wx0, y: wy0 + w * (wh + wgap), w: wx1 - wx0, h: wh });
    return {
      W: W, H: H, small: small, top: top, bottom: bottom, mid: mid, clients: clients,
      cr: Math.max(2.2, Math.min(5, ch * 0.3)), cell: cell, gx0: gx0, gy0: gy0, gw: gw, gh: gh,
      door: { x: gx0 - Math.max(5, cell * 0.7), y: mid }, workers: workers,
      gr: Math.max(1.6, cell * 0.3), qcols: qcols, qrows: qrows, rows: rowOrder(qrows)
    };
  }
  // The queue flows left to right: the head (oldest) is in the rightmost column, next to the
  // workers, and each column fills from the middle outwards. Age therefore reads left to right.
  function qCol(i) { return L.qcols - 1 - Math.floor(i / L.qrows); }
  function qPos(i) {
    var col = qCol(i), row = L.rows[i % L.qrows];
    return { x: L.gx0 + (col + 0.5) * L.cell, y: L.gy0 + (row + 0.5) * L.cell };
  }
  function workerPoint(w) { var k = L.workers[w]; return { x: k.x + k.h * 0.45, y: k.y + k.h / 2 }; }

  // Turn the model's events into short-lived particles (all timed in simulated seconds).
  function absorb(log) {
    for (var i = 0; i < log.length; i++) {
      var e = log[i];
      switch (e.type) {
        case 'send': particles.push({ k: 0, t0: e.t, t1: e.t + LAT, c: e.client, n: e.n }); break;
        case 'reject': particles.push({ k: 1, t0: e.t, t1: e.t + LAT, c: e.client, n: e.n }); break;
        case 'finish': particles.push({ k: 2, t0: e.t, t1: e.t + LAT, c: e.client, w: e.worker, good: e.good }); break;
        case 'shed': particles.push({ k: 3, t0: e.t, t1: e.t + 0.45, n: e.n }); break;
        case 'timeout': pulseTimeout[e.client] = e.t; break;
        case 'success': pulseOk[e.client] = e.t; break;
        case 'blocked': pulseTimeout[e.client] = e.t; break;
      }
    }
    log.length = 0;
    if (particles.length > 2500) particles.splice(0, particles.length - 2500);
  }

  function bez(p0, c, p1, u) {
    var a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, d = u * u;
    return { x: a * p0.x + b * c.x + d * p1.x, y: a * p0.y + b * c.y + d * p1.y };
  }

  function drawScene() {
    var cv = $('ut-scene');
    var f = fit(cv);
    if (!f || !sim) return;
    var ctx = f.ctx, W = f.W, H = f.H;
    L = layout(W, H);
    var now = sim.now;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = COL.scene; ctx.fillRect(0, 0, W, H);
    var tr = activeTrigger();
    var fs = L.small ? 11 : 12;
    ctx.font = fs + 'px ' + FONT;
    ctx.textBaseline = 'alphabetic';

    // labels
    ctx.fillStyle = COL.muted;
    ctx.textAlign = 'left';
    ctx.fillText('clients', Math.max(6, L.clients[0].x - 10), L.top - 12);
    ctx.textAlign = 'right';
    ctx.fillText('workers', L.workers[0].x + L.workers[0].w, L.top - 12);
    ctx.textAlign = 'left';
    var ql = sim.qLen();
    if (!PREVIEW) {
      var age = ql ? now - sim.q[sim.qh].arriveAt : 0;
      ctx.fillText('queue ' + ql + '/200' + (ql ? ' · oldest ' + f1(age) + ' s' : ''), L.gx0, L.gy0 + L.gh + 18);
    }

    // faint paths
    ctx.strokeStyle = 'rgba(52, 54, 48, 0.06)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (var i = 0; i < N; i++) { ctx.moveTo(L.clients[i].x, L.clients[i].y); ctx.lineTo(L.door.x, L.door.y); }
    ctx.stroke();

    // queue frame
    roundRect(ctx, L.gx0 - 4, L.gy0 - 4, L.gw + 8, L.gh + 8, 6);
    ctx.fillStyle = 'rgba(250, 249, 246, 0.85)'; ctx.fill();
    ctx.strokeStyle = COL.line; ctx.lineWidth = 1; ctx.stroke();

    // queue contents (head in the rightmost column). A request still waited for fades as its
    // client's deadline nears; once the client has given up it is drawn hollow and grey.
    var snap = sim.queueSnapshot(200);
    var gone = 0;
    while (gone < snap.length && !snap[gone].waiting) gone++;
    if (gone >= L.qrows) {
      // a faint wash behind the columns that hold only work nobody is waiting for
      var gc = Math.floor(gone / L.qrows);
      ctx.fillStyle = 'rgba(143, 147, 136, 0.13)';
      ctx.fillRect(L.gx0 + (L.qcols - gc) * L.cell, L.gy0, gc * L.cell, L.gh);
    }
    for (var j = 0; j < snap.length; j++) {
      var it = snap[j], p = qPos(j);
      var retry = it.n > 1;
      if (it.waiting) {
        var life = it.deadline > it.sentAt ? (now - it.sentAt) / (it.deadline - it.sentAt) : 0;
        ctx.globalAlpha = 1 - 0.6 * Math.max(0, Math.min(1, life));
      }
      glyph(ctx, p.x, p.y, L.gr, retry, it.waiting, it.waiting ? (retry ? COL.retry : COL.first) : COL.dead);
      ctx.globalAlpha = 1;
    }
    if (gone >= L.qrows && !PREVIEW && !L.small && L.gy0 - L.top > 24) {
      // bracket over the abandoned run, from the head back to the newest abandoned request
      var bx0 = L.gx0 + (qCol(gone - 1)) * L.cell + 2, bx1 = L.gx0 + L.gw - 2, by = L.gy0 - 9;
      ctx.strokeStyle = COL.muted; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(bx0, by + 4); ctx.lineTo(bx0, by); ctx.lineTo(bx1, by); ctx.lineTo(bx1, by + 4); ctx.stroke();
      var btxt = gone + ' requests nobody is waiting for';
      if (ctx.measureText(btxt).width > bx1 - bx0) btxt = gone + ' abandoned';
      if (ctx.measureText(btxt).width < bx1 - bx0) {
        ctx.fillStyle = COL.muted; ctx.textAlign = 'right';
        ctx.fillText(btxt, bx1, by - 5);
        ctx.textAlign = 'left';
      }
    }

    // workers
    for (var w = 0; w < 4; w++) {
      var k = L.workers[w], wk = sim.workers[w], att = wk.att;
      roundRect(ctx, k.x, k.y, k.w, k.h, 5);
      ctx.fillStyle = COL.bg; ctx.fill();
      if (att && !att.waiting) {
        // hatched: serving a request whose client has gone
        ctx.save(); ctx.clip();
        ctx.strokeStyle = 'rgba(143, 147, 136, 0.35)'; ctx.lineWidth = 1;
        ctx.beginPath();
        for (var hx = k.x - k.h; hx < k.x + k.w; hx += 6) { ctx.moveTo(hx, k.y + k.h); ctx.lineTo(hx + k.h, k.y); }
        ctx.stroke(); ctx.restore();
      } else if (att) {
        ctx.fillStyle = 'rgba(77, 115, 80, 0.12)'; ctx.fill();
      }
      roundRect(ctx, k.x, k.y, k.w, k.h, 5);
      ctx.strokeStyle = att ? (att.waiting ? COL.good : COL.dead) : COL.line; ctx.lineWidth = att ? 1.4 : 1;
      if (att && !att.waiting) ctx.setLineDash([3, 3]);
      ctx.stroke(); ctx.setLineDash([]);
      if (att) {
        var gp = workerPoint(w);
        var gr = Math.min(k.h * 0.18, L.gr * 1.6);
        glyph(ctx, gp.x, gp.y, gr, att.n > 1, att.waiting, att.waiting ? (att.n > 1 ? COL.retry : COL.first) : COL.dead);
        var prog = Math.max(0, Math.min(1, (now - att.startAt) / att.svc));
        ctx.fillStyle = att.waiting ? COL.good : COL.dead;
        ctx.fillRect(k.x + 4, k.y + k.h - 5, (k.w - 8) * prog, 2);
        if (!L.small && k.w > 90 && k.h > 26) {
          ctx.fillStyle = COL.muted; ctx.textAlign = 'left';
          ctx.fillText(att.waiting ? 'serving' : 'nobody waiting', gp.x + gr + 8, gp.y + 4);
        }
      } else if (sim.paused && !L.small) {
        ctx.fillStyle = COL.muted; ctx.textAlign = 'left';
        ctx.fillText('paused', k.x + 10, k.y + k.h / 2 + 4);
      }
    }

    // clients
    for (var c = 0; c < N; c++) {
      var cp = L.clients[c], cl = sim.clients[c];
      var open = sim.cfg.breaker && cl.br !== 'closed';
      if (open) {
        var s = L.cr * 1.1;
        ctx.strokeStyle = COL.retry; ctx.lineWidth = 1.4;
        ctx.strokeRect(cp.x - s, cp.y - s, 2 * s, 2 * s);
      } else {
        ctx.beginPath(); ctx.arc(cp.x, cp.y, L.cr, 0, 2 * Math.PI);
        ctx.fillStyle = COL.ink; ctx.fill();
      }
      var dt = now - pulseTimeout[c];
      if (dt >= 0 && dt < 0.35) {
        ctx.beginPath(); ctx.arc(cp.x, cp.y, L.cr + 2 + dt * 16, 0, 2 * Math.PI);
        ctx.strokeStyle = 'rgba(168, 79, 42,' + (1 - dt / 0.35) * 0.8 + ')'; ctx.lineWidth = 1.3; ctx.stroke();
      }
      var dg = now - pulseOk[c];
      if (dg >= 0 && dg < 0.3) {
        ctx.beginPath(); ctx.arc(cp.x, cp.y, L.cr + 1.5, 0, 2 * Math.PI);
        ctx.strokeStyle = 'rgba(77, 115, 80,' + (1 - dg / 0.3) + ')'; ctx.lineWidth = 1.6; ctx.stroke();
      }
    }

    // particles
    var arcTop = { x: (L.door.x + L.workers[0].x) / 2, y: L.top - (L.bottom - L.top) * 0.35 };
    var keep = [];
    var trail = Kit.reducedMotion ? 0 : 0.45;
    // Wakes: each request and each reply leaves a faint trace of its path for a moment after it
    // lands, so the stream is visible even though a flight lasts only the model's 0.1 s.
    for (var q0 = 0; q0 < particles.length; q0++) {
      var pw = particles[q0];
      if (pw.k > 2 || now < pw.t1 || now >= pw.t1 + WAKE) continue;
      var fade = 1 - (now - pw.t1) / WAKE;
      if (pw.k === 0) {
        ctx.strokeStyle = pw.n > 1 ? 'rgba(168, 79, 42,' + (0.32 * fade) + ')' : 'rgba(63, 99, 119,' + (0.22 * fade) + ')';
        ctx.lineWidth = pw.n > 1 ? 1.3 : 1;
        ctx.beginPath(); ctx.moveTo(L.clients[pw.c].x, L.clients[pw.c].y); ctx.lineTo(L.door.x, L.door.y); ctx.stroke();
      } else if (pw.k === 2 && (pw.good || !PREVIEW)) {
        var wp = workerPoint(pw.w), wc = L.clients[pw.c];
        ctx.strokeStyle = pw.good ? 'rgba(77, 115, 80,' + (0.42 * fade) + ')' : 'rgba(143, 147, 136,' + (0.14 * fade) + ')';
        ctx.lineWidth = pw.good ? 1.2 : 1;
        ctx.beginPath(); ctx.moveTo(wp.x, wp.y); ctx.quadraticCurveTo(arcTop.x, arcTop.y, wc.x, wc.y); ctx.stroke();
      }
    }
    for (var q = 0; q < particles.length; q++) {
      var pt = particles[q];
      if (now >= pt.t1 + (pt.k === 0 || pt.k === 2 ? WAKE : 0)) continue;
      if (now < pt.t0) { keep.push(pt); continue; }
      keep.push(pt);
      if (now >= pt.t1) continue;
      var u = (now - pt.t0) / (pt.t1 - pt.t0);
      if (pt.k === 0 || pt.k === 1) {
        var from = pt.k === 0 ? L.clients[pt.c] : L.door, to = pt.k === 0 ? L.door : L.clients[pt.c];
        var x = from.x + (to.x - from.x) * u, y = from.y + (to.y - from.y) * u;
        if (pt.k === 0) {
          if (trail) {
            var u0 = Math.max(0, u - trail);
            ctx.strokeStyle = pt.n > 1 ? 'rgba(168, 79, 42, 0.35)' : 'rgba(63, 99, 119, 0.3)';
            ctx.lineWidth = L.gr * 0.9;
            ctx.beginPath(); ctx.moveTo(from.x + (to.x - from.x) * u0, from.y + (to.y - from.y) * u0); ctx.lineTo(x, y); ctx.stroke();
          }
          glyph(ctx, x, y, L.gr, pt.n > 1, true, pt.n > 1 ? COL.retry : COL.first);
        } else {
          // refused at the door: queue full
          ctx.strokeStyle = COL.retry; ctx.lineWidth = 1.3;
          var r2 = L.gr * 0.9;
          ctx.beginPath(); ctx.moveTo(x - r2, y - r2); ctx.lineTo(x + r2, y + r2); ctx.moveTo(x + r2, y - r2); ctx.lineTo(x - r2, y + r2); ctx.stroke();
        }
      } else if (pt.k === 2) {
        var p0 = workerPoint(pt.w), p1 = L.clients[pt.c];
        var b = bez(p0, arcTop, p1, u);
        if (pt.good) {
          ctx.beginPath(); ctx.arc(b.x, b.y, L.gr * 0.8, 0, 2 * Math.PI); ctx.fillStyle = COL.good; ctx.fill();
        } else {
          ctx.globalAlpha = Math.max(0, 1 - u * 1.4);
          ctx.beginPath(); ctx.arc(b.x, b.y, L.gr * 0.8, 0, 2 * Math.PI); ctx.strokeStyle = COL.dead; ctx.lineWidth = 1; ctx.stroke();
          ctx.globalAlpha = 1;
        }
      } else if (pt.k === 3) {
        var hp = qPos(0);
        ctx.globalAlpha = Math.max(0, 1 - u);
        var sx = hp.x + L.cell * 0.8, sy = hp.y + u * L.cell * 4, r3 = L.gr * 0.9;
        ctx.strokeStyle = COL.retry; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(sx - r3, sy - r3); ctx.lineTo(sx + r3, sy + r3); ctx.moveTo(sx + r3, sy - r3); ctx.lineTo(sx - r3, sy + r3); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    particles = keep;

    // banner: what is happening now
    var banner = null, bannerCol = COL.muted, bannerFill = false;
    if (tr) { banner = tr.kind === 'spike' ? 'spike: ' + f1(tr.factor) + '× load' : 'server paused'; bannerCol = COL.retry; }
    else if (sim.triggers.length && live) {
      if (live.recoveredAt !== null) { banner = 'recovered'; bannerCol = COL.good; bannerFill = true; }
      else if (live.downSince !== null) { banner = 'down ' + sinceEnd() + ' s after the ' + (sim.triggers[sim.triggers.length - 1].kind === 'pause' ? 'pause' : 'spike'); bannerCol = COL.retry; bannerFill = true; }
    }
    if (PREVIEW && preview.label) { drawPill(ctx, W / 2, L.top - 12, preview.label, COL.good, true); }
    else if (banner) drawPill(ctx, (L.door.x + L.workers[0].x) / 2, L.top - 12, banner, bannerCol, bannerFill);

    // Under the workers: the share of their recent work that went to clients who had left.
    if (!PREVIEW) {
      var rw = recent(2), wk0 = L.workers[0], wy = L.workers[3].y + L.workers[3].h + (L.small ? 14 : 18);
      if (rw.done > 0 && wy < H - 4) {
        var pct = Math.round(100 * rw.wasted);
        ctx.font = fs + 'px ' + FONT; ctx.textAlign = 'right';
        ctx.fillStyle = pct >= 50 ? COL.retry : COL.muted;
        ctx.fillText((L.small ? 'wasted ' : 'work for nobody ') + pct + '%', wk0.x + wk0.w, wy);
        ctx.textAlign = 'left';
      }
    }

    if (PREVIEW) drawMini(ctx, W, H);
  }

  function drawPill(ctx, cx, cy, text, colour, filled) {
    ctx.font = (filled ? '500 ' : '') + (L.small ? 11 : 13) + 'px ' + FONT;
    var tw = ctx.measureText(text).width, ph = L.small ? 18 : 22, pw = tw + 20;
    roundRect(ctx, cx - pw / 2, cy - ph / 2 - 3, pw, ph, ph / 2);
    if (filled) { ctx.fillStyle = colour; ctx.fill(); ctx.fillStyle = '#fff'; }
    else { ctx.fillStyle = COL.bg; ctx.fill(); ctx.strokeStyle = colour; ctx.lineWidth = 1; ctx.stroke(); ctx.fillStyle = colour; }
    ctx.textAlign = 'center';
    ctx.fillText(text, cx, cy + 1);
    ctx.textAlign = 'left';
  }

  // Preview only: a small chart of offered load and goodput along the bottom.
  function drawMini(ctx, W, H) {
    var y1 = H - 8, y0 = L.bottom + 14, x0 = 12, x1 = W - 12;
    var T = preview.loopAt;
    function X(t) { return x0 + (x1 - x0) * t / T; }
    var ymax = 80;
    function Y(v) { return y1 - (y1 - y0) * Math.min(v, ymax) / ymax; }
    sim.triggers.forEach(function (tr) {
      ctx.fillStyle = COL.shade; ctx.fillRect(X(tr.start), y0 - 4, X(Math.min(tr.end, T)) - X(tr.start), y1 - y0 + 4);
    });
    ctx.strokeStyle = COL.line; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y1 + 0.5); ctx.lineTo(x1, y1 + 0.5); ctx.stroke();
    lostBand(ctx, X, Y, 0, 'rgba(168, 79, 42, 0.16)');
    series(ctx, 'demand', X, Y, COL.ink, 1.2, [4, 3]);
    series(ctx, 'good', X, Y, COL.good, 2.4, null);
    if (preview.remedyT !== undefined) {
      ctx.strokeStyle = COL.good; ctx.lineWidth = 1; ctx.setLineDash([2, 2]);
      ctx.beginPath(); ctx.moveTo(X(preview.remedyT), y0 - 4); ctx.lineTo(X(preview.remedyT), y1); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.font = '11px ' + FONT; ctx.fillStyle = COL.muted; ctx.textAlign = 'left';
    // start the label clear of the client column, which reaches down towards the chart
    ctx.fillText('goodput vs offered (dashed)', Math.max(x0, L.clients[0].x + L.cr + 8), y0 - 6);
  }

  function smoothed(key, b) {
    var m = sim.m[key], s = 0, n = 0;
    for (var i = b - 3; i <= b; i++) if (i >= 0) { s += m[i]; n++; }
    return n ? s / (n * BIN) : 0;
  }
  // Shade the shortfall: offered load that was not served in time (between offered and goodput).
  function lostBand(ctx, X, Y, t0, fill) {
    var bEnd = Math.floor(sim.now / BIN), b0 = Math.max(0, Math.floor((t0 || 0) / BIN));
    if (bEnd - b0 < 2) return;
    ctx.beginPath();
    var b;
    for (b = b0; b < bEnd; b++) {
      var d = smoothed('demand', b), g = smoothed('good', b);
      var x = X((b + 1) * BIN), y = Y(Math.max(d, g));
      if (b === b0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    for (b = bEnd - 1; b >= b0; b--) ctx.lineTo(X((b + 1) * BIN), Y(smoothed('good', b)));
    ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
  }
  function series(ctx, key, X, Y, colour, width, dash, t0) {
    var bEnd = Math.floor(sim.now / BIN);
    var b0 = Math.max(0, Math.floor((t0 || 0) / BIN));
    ctx.strokeStyle = colour; ctx.lineWidth = width; ctx.setLineDash(dash || []);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    var started = false;
    for (var b = b0; b < bEnd; b++) {
      var v = key === 'queue' ? sim.m.qArea[b] / BIN : key === 'p99' ? sim.m.p99[b] : smoothed(key, b);
      if (v !== v) { started = false; continue; }
      var x = X((b + 1) * BIN), y = Y(v);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke(); ctx.setLineDash([]);
  }

  // ------------------------------------------------------------------ charts
  function niceCeil(v) {
    var steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    var p = Math.pow(10, Math.floor(Math.log10(v)));
    for (var i = 0; i < steps.length; i++) if (steps[i] * p >= v) return steps[i] * p;
    return 10 * p;
  }
  function drawChart(id, kind) {
    var f = fit($(id));
    if (!f || !sim) return;
    var ctx = f.ctx, W = f.W, H = f.H;
    ctx.clearRect(0, 0, W, H);
    var padL = 30, padR = 6, padT = 6, padB = 18;
    var t1 = Math.max(WINDOW, sim.now), t0 = t1 - WINDOW;
    function X(t) { return padL + (t - t0) / WINDOW * (W - padL - padR); }
    var ymax;
    var bEnd = Math.floor(sim.now / BIN), bStart = Math.max(0, Math.floor(t0 / BIN));
    if (kind === 'rate') {
      var mx = 0;
      // Scaled to offered load; a brief burst of retries during the spike may run off the top.
      for (var b = bStart; b < bEnd; b++) mx = Math.max(mx, smoothed('demand', b), smoothed('good', b));
      chartMax.rate = Math.max(chartMax.rate, niceCeil(mx * 1.4));
      ymax = chartMax.rate;
    } else if (kind === 'queue') ymax = 200;
    else {
      var mp = 0;
      for (var b2 = bStart; b2 < bEnd; b2++) { var v = sim.m.p99[b2]; if (v === v) mp = Math.max(mp, v); }
      chartMax.p99 = Math.max(chartMax.p99, niceCeil(Math.max(mp, settings.timeout * 1.3)));
      ymax = chartMax.p99;
    }
    function Y(v) { return padT + (H - padT - padB) * (1 - Math.min(v, ymax) / ymax); }
    ctx.save();
    ctx.beginPath(); ctx.rect(padL, 0, W - padL - padR, H); ctx.clip();
    sim.triggers.forEach(function (tr) {
      ctx.fillStyle = tr.kind === 'spike' ? COL.shade : COL.pauseShade;
      ctx.fillRect(X(tr.start), padT, X(Math.min(tr.end, Math.max(sim.now, tr.start))) - X(tr.start), H - padT - padB);
    });
    ctx.restore();
    // grid and ticks
    ctx.font = '11px ' + FONT; ctx.fillStyle = COL.muted; ctx.strokeStyle = COL.line; ctx.lineWidth = 1;
    [0, 0.5, 1].forEach(function (q) {
      var y = Math.round(Y(ymax * q)) + 0.5;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
      ctx.textAlign = 'right';
      var lab = kind === 'p99' ? (ymax * q).toFixed(ymax * q % 1 ? 1 : 0) + ' s' : String(Math.round(ymax * q));
      ctx.fillText(lab, padL - 4, y + 4);
    });
    ctx.textAlign = 'center';
    for (var s = Math.ceil(t0 / 10) * 10; s <= t1; s += 10) {
      if (X(s) < padL + 8) continue;
      ctx.fillText(s + ' s', Math.min(X(s), W - padR - 12), H - 4);
    }
    ctx.save();
    ctx.beginPath(); ctx.rect(padL, 0, W - padL - padR, H); ctx.clip();
    if (kind === 'rate') {
      lostBand(ctx, X, Y, t0, 'rgba(168, 79, 42, 0.14)');
      series(ctx, 'sent', X, Y, COL.retry, 1.3, null, t0);
      series(ctx, 'demand', X, Y, COL.ink, 1.3, [4, 3], t0);
      series(ctx, 'good', X, Y, COL.good, 2.6, null, t0);
    } else if (kind === 'queue') {
      // area
      ctx.beginPath(); ctx.moveTo(X(Math.max(t0, 0)), Y(0));
      for (var b3 = bStart; b3 < bEnd; b3++) ctx.lineTo(X((b3 + 1) * BIN), Y(sim.m.qArea[b3] / BIN));
      ctx.lineTo(X(bEnd * BIN), Y(0)); ctx.closePath();
      ctx.fillStyle = 'rgba(63, 99, 119, 0.16)'; ctx.fill();
      series(ctx, 'queue', X, Y, COL.first, 1.4, null, t0);
    } else {
      ctx.strokeStyle = COL.ink; ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
      var ty = Y(settings.timeout);
      ctx.beginPath(); ctx.moveTo(padL, ty); ctx.lineTo(W - padR, ty); ctx.stroke(); ctx.setLineDash([]);
      series(ctx, 'p99', X, Y, COL.retry, 1.5, null, t0);
    }
    // marks for settings changed mid-run
    marks.forEach(function (mk) {
      if (mk.t < t0) return;
      var x = Math.round(X(mk.t)) + 0.5;
      ctx.strokeStyle = COL.strong; ctx.lineWidth = 1; ctx.setLineDash([2, 2]);
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, H - padB); ctx.stroke(); ctx.setLineDash([]);
      if (kind === 'rate') { ctx.fillStyle = COL.strong; ctx.textAlign = 'left'; ctx.fillText(mk.label, x + 3, padT + 10); }
    });
    ctx.restore();
  }

  // ------------------------------------------------------------------ readout
  var lastReadout = 0;
  function readout(force) {
    if (PREVIEW || !sim) return;
    var nowR = performance.now();
    if (!force && nowR - lastReadout < 250) return;
    lastReadout = nowR;
    var r = recent(2);
    var amp = r.offered ? r.sent / r.offered : 1;
    $('ut-readout').innerHTML = 't = ' + f0(sim.now) + ' s · offered <b>' + f0(r.offered) + '</b>/s · goodput <b>' + f0(r.good) + '</b>/s · sent <b>' + f0(r.sent) +
      '</b>/s (' + f1(amp) + '×) · work for clients who left <b>' + f0(100 * r.wasted) + '%</b>';
    $('ut-scene').setAttribute('aria-label', 'Simulation at ' + f0(sim.now) + ' seconds: ' + sim.qLen() + ' of 200 queue places full, goodput ' + f0(r.good) +
      ' of ' + f0(r.offered) + ' requests a second offered, ' + f0(100 * r.wasted) + '% of finished work was for clients who had already given up.');
    updateGuide();
    syncPlay();
  }

  function draw() {
    if (!sim) return;
    drawScene();
    if (!PREVIEW) {
      drawChart('ut-c-rate', 'rate');
      drawChart('ut-c-queue', 'queue');
      drawChart('ut-c-p99', 'p99');
      readout(true);
    }
  }

  // ------------------------------------------------------------------ loop
  function advance(dtSim) {
    var target = Math.min(RUN_LEN, sim.now + dtSim);
    if (PREVIEW) {
      // The preview turns a remedy on partway through, then starts over. The recovery is the model's.
      if (sim.now < preview.remedyAt && target >= preview.remedyAt) {
        sim.runUntil(preview.remedyAt); absorb(sim.log);
        sim.set('shed', 'early'); preview.remedyT = preview.remedyAt; preview.label = 'load shedding on';
      }
      if (target >= preview.loopAt) { startPreviewRun(); return; }
    }
    sim.runUntil(target);
    absorb(sim.log);
    trackRecovery();
  }
  function frame(ts) {
    raf = 0;
    if (!running()) return;
    var dt = lastTs ? Math.max(0, Math.min(0.1, (ts - lastTs) / 1000)) : 0;
    lastTs = ts;
    advance(dt * speed);
    draw();
    if (sim.now >= RUN_LEN) { syncPlay(); return; }
    raf = requestAnimationFrame(frame);
  }
  function running() { return kitPlaying && userRunning && sim && sim.now < RUN_LEN; }
  function ensureLoop() {
    if (running() && !raf) { lastTs = 0; raf = requestAnimationFrame(frame); }
    if (!running() && raf) { cancelAnimationFrame(raf); raf = 0; }
    if (!running()) draw();
  }

  // ------------------------------------------------------------------ preview
  function startPreviewRun() {
    sim = new U.Sim({ retry: 'immediate', triggerStart: 1.5, triggerDuration: 4, duration: preview.loopAt + 1 }, 3);
    sim.log = [];
    particles = []; marks = [];
    pulseTimeout.fill(-9); pulseOk.fill(-9);
    live = { downSince: null, recoveredAt: null, lastEnd: 0 };
    preview.label = ''; preview.remedyT = undefined;
  }
  function previewStill() {
    // A representative still: the collapse, well after the spike, before any remedy.
    startPreviewRun();
    sim.runUntil(11.6); sim.log.length = 0;
    sim.runUntil(12); absorb(sim.log); trackRecovery();
  }

  // ------------------------------------------------------------------ start
  if (PREVIEW) {
    speed = 2.2;
    previewStill();
  } else {
    buildPhase();
    bindControls();
    syncControls();
    startStep(0);
  }
  if (typeof ResizeObserver !== 'undefined') {
    var ro = new ResizeObserver(function () { if (!raf) draw(); });
    ro.observe($('ut-scene'));
    if (!PREVIEW) ['ut-c-rate', 'ut-c-queue', 'ut-c-p99'].forEach(function (id) { ro.observe($(id)); });
  } else {
    window.addEventListener('resize', function () { if (!raf) draw(); });
  }
  Kit.onPlay(function (p) { kitPlaying = p; ensureLoop(); });
})();
