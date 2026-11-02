// Headless checks for the Undertow model. Run: node projects/undertow/tests/model.test.js
// Exits non-zero if any check fails.
'use strict';
var assert = require('assert');
var path = require('path');
var M = require(path.join(__dirname, '..', 'model.js'));

var passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('ok   ' + name); }
  catch (e) { console.error('FAIL ' + name + '\n     ' + (e && e.message)); process.exitCode = 1; }
}
function sum(arr, a, b) { var s = 0; for (var i = a; i < b; i++) s += arr[i]; return s; }
function near(a, b, rel, msg) { assert(Math.abs(a - b) <= rel * Math.abs(b), msg + ': ' + a + ' vs ' + b); }

// ------------------------------------------------------------------ (a) low load, no trigger
check('(a) low load: goodput matches offered load', function () {
  var s = M.simulate({ trigger: 'none', baseRate: 12, duration: 300 }, 7);
  var T = s.T;
  assert(T.demand > 3000, 'enough requests');
  // Everything sent in the last second may still be in flight when the run stops.
  assert(T.good >= T.demand - 40, 'good ' + T.good + ' of ' + T.demand);
  assert.strictEqual(T.retries, 0, 'no retries at low load');
  assert.strictEqual(T.late, 0, 'nothing late at low load');
  var bin = s.cfg.bin;
  var d = sum(s.m.demand, 0, 300 / bin), g = sum(s.m.good, 0, 300 / bin);
  near(g / 300, d / 300, 0.02, 'goodput rate vs offered rate');
});

check("(a) Little's law holds at the server (L = lambda W, within 3%)", function () {
  [0.3, 0.5, 0.7].forEach(function (rho) {
    var s = M.simulate({ trigger: 'none', baseRate: 40 * rho, duration: 400 }, 11);
    var T = s.T;
    var L = T.sysArea / s.now;                // time-average number at the server (queue + service)
    var lambda = T.arrived / s.now;           // arrival rate at the server
    var W = T.sojournSum / T.sojournN;        // mean time at the server
    near(L, lambda * W, 0.03, 'rho ' + rho + ' L vs lambda W');
    // and the utilisation law: busy workers = lambda x mean service time
    var busy = sum(s.m.busyArea, 0, s.nb) / s.now;
    near(busy, lambda * s.cfg.serviceMean, 0.04, 'rho ' + rho + ' utilisation');
  });
});

check('(a) the service time distribution has the stated mean', function () {
  var s = new M.Sim({}, 3), n = 200000, t = 0;
  for (var i = 0; i < n; i++) t += s.serviceTime();
  near(t / n, s.cfg.serviceMean, 0.01, 'mean service time');
});

// ------------------------------------------------------------------ (b) metastability
check('(b) naive retries: the spike leaves the system down long after it ends; without retries it recovers', function () {
  var seeds = M.seedList(20);
  seeds.forEach(function (seed) {
    var withR = M.simulate({ retry: 'immediate' }, seed);
    var without = M.simulate({ retry: 'none' }, seed);
    var te = withR.lastTriggerEnd(), bin = withR.cfg.bin;
    // Same arrivals in both runs: the only difference is the retry policy.
    assert.deepStrictEqual(Array.from(withR.m.demand), Array.from(without.m.demand), 'common random numbers');
    // Offered load after the spike is back at its normal level...
    var dAfter = sum(withR.m.demand, (te + 5) / bin, (te + 30) / bin) / 25;
    near(dAfter, withR.cfg.baseRate, 0.15, 'offered load after the spike');
    // ...yet with retries goodput stays under half of it in every 5 s window from 5 s to 30 s after.
    for (var t = te + 5; t < te + 30; t += 5) {
      assert(withR.goodRatio(t, t + 5) < 0.5, 'seed ' + seed + ' window ' + t + ' ratio ' + withR.goodRatio(t, t + 5));
    }
    assert(withR.summary().stuck, 'classified stuck');
    // Without retries the same spike is over within 15 s.
    assert(!without.summary().stuck, 'seed ' + seed + ' no-retry run should recover');
    var r = without.recoveryTime();
    assert(r !== null && r <= 15, 'seed ' + seed + ' no-retry recovery ' + r);
  });
});

check('(b) the collapse needs the trigger: the same retries without a spike stay healthy', function () {
  M.seedList(20).forEach(function (seed) {
    var s = M.simulate({ trigger: 'none', retry: 'immediate' }, seed);
    assert(s.T.good >= 0.97 * s.T.demand, 'seed ' + seed + ' healthy without trigger');
  });
});

check('(b) a brief server pause also tips naive retries into collapse, and not without retries', function () {
  M.seedList(10).forEach(function (seed) {
    assert(M.simulate({ trigger: 'pause', triggerDuration: 2, retry: 'immediate' }, seed).summary().stuck, 'pause + retries stuck');
    assert(!M.simulate({ trigger: 'pause', triggerDuration: 2, retry: 'none' }, seed).summary().stuck, 'pause alone recovers');
  });
});

check('(b) in the collapse the workers are busy, but on requests nobody waits for', function () {
  var s = M.simulate({ retry: 'immediate' }, 1);
  var bin = s.cfg.bin, a = 20 / bin, b = 35 / bin;
  var busy = sum(s.m.busyArea, a, b) / 15;
  assert(busy > 0.95 * s.cfg.workers, 'workers saturated: ' + busy);
  var done = sum(s.m.done, a, b), good = sum(s.m.good, a, b);
  assert(done > 0.9 * 40 * 15, 'throughput near capacity: ' + done / 15);
  assert(good < 0.05 * done, 'goodput near zero: ' + good / 15);
});

// ------------------------------------------------------------------ (c) remedies over many seeds
check('(c) every guided-step claim holds in at least 95% of 40 seeds', function () {
  M.STEPS.forEach(function (step) {
    var f = M.stepFigures(step);
    assert(f.held >= 0.95 * f.runs, step.key + ' held in ' + f.held + ' of ' + f.runs);
  });
});

check('(c) backoff and jitter alone leave the amplification near maxAttempts; a budget caps it', function () {
  var seeds = M.seedList(10);
  ['backoff', 'full', 'equal', 'decorrelated'].forEach(function (p) {
    seeds.forEach(function (seed) {
      var sm = M.simulate({ retry: p }, seed).summary();
      assert(sm.stuck, p + ' seed ' + seed + ' stuck');
      assert(sm.amplification > 2.3, p + ' amplification ' + sm.amplification);
    });
  });
  // With the budget on from the start, retries stay near 10% of new requests (plus the bucket).
  seeds.forEach(function (seed) {
    var s = M.simulate({ retry: 'immediate', budget: true }, seed);
    assert(s.T.retries <= 0.1 * s.T.demand + s.cfg.clients * s.cfg.budgetBurst + 1, 'budget bound');
    assert(!s.summary().stuck, 'budget recovers seed ' + seed);
  });
});

check('(c) dropping requests only once they pass the timeout does not help; dropping at half does', function () {
  M.seedList(10).forEach(function (seed) {
    assert(M.simulate({ retry: 'immediate', shed: 'stale' }, seed).summary().stuck, 'stale shedding stays stuck');
    assert(!M.simulate({ retry: 'immediate', shed: 'early' }, seed).summary().stuck, 'early shedding recovers');
    assert(!M.simulate({ retry: 'immediate', shed: 'lifo' }, seed).summary().stuck, 'LIFO recovers');
    assert(!M.simulate({ retry: 'immediate', breaker: true }, seed).summary().stuck, 'breaker recovers');
  });
});

check('(c) the challenge is not passed by backoff, jitter or stale shedding, and is by the working remedies', function () {
  function share(extra) {
    var o = {}, k;
    for (k in M.CHALLENGE) o[k] = M.CHALLENGE[k];
    for (k in extra) o[k] = extra[k];
    return Math.round(M.recoverShare(o, M.seedList(M.CHALLENGE_SEEDS)) * M.CHALLENGE_SEEDS);
  }
  [{ retry: 'immediate' }, { retry: 'backoff' }, { retry: 'full' }, { retry: 'immediate', shed: 'stale' }, { retry: 'immediate', maxAttempts: 2 }]
    .forEach(function (o) { assert(share(o) < M.CHALLENGE_PASS, JSON.stringify(o) + ' should fail'); });
  [{ retry: 'immediate', budget: true }, { retry: 'immediate', shed: 'early' }, { retry: 'immediate', shed: 'lifo' }, { retry: 'immediate', breaker: true }]
    .forEach(function (o) { assert(share(o) >= M.CHALLENGE_PASS, JSON.stringify(o) + ' should pass'); });
});

// ------------------------------------------------------------------ (d) determinism
check('(d) same seed gives an identical run; a different seed does not', function () {
  var cfgs = [{ retry: 'full', budget: true }, { retry: 'decorrelated', breaker: true }, { trigger: 'pause', shed: 'lifo' }];
  cfgs.forEach(function (c) {
    var a = M.simulate(c, 42), b = M.simulate(c, 42), d = M.simulate(c, 43);
    for (var k in a.m) assert.deepStrictEqual(Array.from(a.m[k]), Array.from(b.m[k]), 'metric ' + k);
    assert.deepStrictEqual(a.T, b.T, 'totals');
    assert.notDeepStrictEqual(Array.from(a.m.demand), Array.from(d.m.demand), 'different seed differs');
  });
  // Stepping in many small increments (as the page does) gives the same run as one call.
  var x = new M.Sim({ retry: 'full' }, 9);
  for (var t = 0.016; t < 40; t += 0.016) x.runUntil(t);
  x.runUntil(40);
  var y = M.simulate({ retry: 'full' }, 9);
  // Every event and count is identical; time integrals may differ in the last float digit,
  // because stepping splits them into more pieces.
  for (var key in y.T) {
    if (key === 'sysArea') near(x.T[key], y.T[key], 1e-12, 'incremental ' + key);
    else assert.strictEqual(x.T[key], y.T[key], 'incremental equals batch: ' + key);
  }
  ['demand', 'sent', 'done', 'good', 'late', 'shed', 'rejected', 'p99'].forEach(function (k) {
    assert.deepStrictEqual(Array.from(x.m[k]), Array.from(y.m[k]), 'incremental metric ' + k);
  });
  // A longer run is the same run up to the shorter one's end.
  var z = M.simulate({ retry: 'full', duration: 600 }, 9);
  var zz = new M.Sim({ retry: 'full', duration: 600 }, 9); zz.runUntil(40);
  assert.deepStrictEqual(Array.from(zz.m.good.slice(0, 80)), Array.from(y.m.good.slice(0, 80)), 'duration does not change the run');
  assert(z.now === 600);
});

// ------------------------------------------------------------------ (e) accounting
check('(e) goodput <= throughput in every bin; all server work is either good or wasted', function () {
  var cfgs = [{ retry: 'immediate' }, { retry: 'none' }, { retry: 'full', budget: true }, { shed: 'early' }, { shed: 'lifo' },
              { breaker: true }, { trigger: 'pause', triggerDuration: 3 }, { queueCap: Infinity, duration: 30 }];
  cfgs.forEach(function (c) {
    var s = M.simulate(c, 5);
    var T = s.T;
    for (var b = 0; b < s.nb; b++) {
      assert(s.m.good[b] <= s.m.done[b], 'bin ' + b);
      assert(s.m.good[b] + s.m.late[b] === s.m.done[b], 'good + late = done, bin ' + b);
    }
    assert.strictEqual(T.good + T.late, T.done);
    near(T.goodWork + T.wastedWork, T.busyTime, 1e-9, 'work split');
    // busy time of finished requests cannot exceed what the workers had
    assert(T.busyTime <= s.cfg.workers * s.now + 1e-6, 'busy time bound');
    // requests: every new request is still open, succeeded, or failed
    assert.strictEqual(T.demand, T.succeeded + T.failed + s.pendingCount, 'request conservation ' + JSON.stringify(c));
    // attempts: every arrival at the server was rejected, shed, completed, or is still there
    var inQueue = s.qLen(), inService = s.busy;
    assert.strictEqual(T.arrived, T.rejected + T.shed + T.done + inQueue + inService, 'attempt conservation');
    assert.strictEqual(T.inSystem, inQueue + inService, 'in-system count');
  });
});

check('(e) in the collapse most server work is spent on abandoned requests, and it is counted', function () {
  var sm = M.simulate({ retry: 'immediate' }, 2).summary();
  assert(sm.wastedShare > 0.7, 'wasted share ' + sm.wastedShare);
  var ok = M.simulate({ trigger: 'none' }, 2).summary();
  assert(ok.wastedShare < 0.01, 'healthy wasted share ' + ok.wastedShare);
});

// ------------------------------------------------------------------ checks added after review
check('the page reports recovery as the model does: the live tracker, replayed, gives recoveryTime', function () {
  // Mirrors app.js trackRecovery: watch a trailing 2 s window from 1 s after the spike; when it first
  // reaches 90%, ask the model for recoveryTime at that moment. It must equal the full-run figure
  // that data.js medians come from (no 2 s offset between the live number and the median).
  [1, 2, 3, 4, 5].forEach(function (seed) {
    var opts = { retry: 'none' };
    var s = new M.Sim(opts, seed), bin = s.cfg.bin, te = s.lastTriggerEnd(), live = null;
    for (var t = 0.5; t <= s.cfg.duration + 1e-9; t += 0.5) {
      s.runUntil(t);
      if (live !== null || t < te + 1) continue;
      var b1 = Math.floor(s.now / bin + 1e-9), b0 = b1 - Math.round(2 / bin);
      var d = sum(s.m.demand, b0, b1), g = sum(s.m.good, b0, b1);
      if (d > 0 && g / d >= 0.9) { var rt = s.recoveryTime(te); live = rt !== null ? rt : s.now - 2 - te; }
    }
    var full = M.simulate(opts, seed).recoveryTime();
    assert(live !== null && full !== null, 'recovers, seed ' + seed);
    assert.strictEqual(live, full, 'live ' + live + ' vs model ' + full + ', seed ' + seed);
    // and the window that starts there really is at 90% or more
    var f = M.simulate(opts, seed);
    assert(f.goodRatio(te + full, te + full + 2) >= 0.9, 'window at recovery, seed ' + seed);
  });
});

check('in the collapse, retry amplification settles at the attempt cap (3x)', function () {
  var s = M.simulate({ retry: 'immediate', duration: 120 }, 1), bin = s.cfg.bin;
  var a = sum(s.m.sent, 40 / bin, 120 / bin), d = sum(s.m.demand, 40 / bin, 120 / bin);
  near(a / d, 3, 0.02, 'steady amplification');
});

check('shedding past the timeout stays stuck: the requests it keeps are still served for nobody', function () {
  [1, 2, 3].forEach(function (seed) {
    var sm = M.simulate({ retry: 'immediate', shed: 'stale' }, seed).summary();
    assert(sm.stuck, 'stale shedding stuck, seed ' + seed);
    assert(sm.wastedShare > 0.8, 'wasted share ' + sm.wastedShare);
  });
});

check('a 4 s timeout does not stop retries: queue-full rejections are retried and larger spikes still tip', function () {
  var seeds = M.seedList(10), defaultOk = 0, challengeOk = 0;
  seeds.forEach(function (seed) {
    if (!M.simulate({ retry: 'immediate', timeout: 4 }, seed).summary().stuck) defaultOk++;
    var s = M.simulate({ retry: 'immediate', timeout: 4, spikeFactor: 3, triggerDuration: 6 }, seed);
    if (!s.summary().stuck) challengeOk++;
    assert(s.T.rejected > 0 && s.T.retries > 0, 'rejections retried, seed ' + seed);
  });
  assert(defaultOk >= 9, 'default spike with a 4 s timeout recovers: ' + defaultOk);
  assert(challengeOk <= 2, '3x for 6 s with a 4 s timeout mostly stays down: ' + challengeOk);
});

check('a short queue does not stop retries, but nothing tips', function () {
  [10, 20, 30].forEach(function (q) {
    M.seedList(5).forEach(function (seed) {
      var s = M.simulate({ retry: 'immediate', queueCap: q }, seed);
      assert(s.T.retries > 100, 'retries start with queueCap ' + q + ': ' + s.T.retries);
      assert(!s.summary().stuck, 'recovers with queueCap ' + q + ', seed ' + seed);
    });
  });
});

console.log(passed + ' checks passed' + (process.exitCode ? ', some FAILED' : ''));
