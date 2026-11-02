// Cardinal: runs the experiments against DuckDB-Wasm. Browser only; the maths lives in model.js.
// Used by the page (app.js) and by the scripted check (tests/steps.html), so both run the same code.
(function (root) {
  'use strict';
  var M = root.CardinalModel;

  function now() { return performance.now(); }

  function Lab(engine, orders) {
    this.engine = engine;
    this.orders = orders;
    this.shape = M.shape(orders);
    this.data = null; // { theta, rho }
    this.stats = null;
    this.hardened = false;
  }

  Lab.prototype.q = function (sql) { return this.engine.query(sql); };

  // Build (or rebuild) the tables when the data settings change, then measure what was built.
  Lab.prototype.ensureData = async function (settings) {
    if (this.data && this.data.theta === settings.theta && this.data.rho === settings.rho) return this.stats;
    var t0 = now();
    var stmts = M.dataSql(settings, this.orders);
    for (var i = 0; i < stmts.length; i++) await this.q(stmts[i]);
    var genMs = now() - t0;
    if (!this.hardened) {
      // From here on DuckDB may not touch files or URLs; the editable box can only read these tables.
      await this.q('SET enable_external_access = false');
      this.hardened = true;
    }
    var cells = await this.q(M.STATS_SQL.contingency);
    var topC = (await this.q(M.STATS_SQL.topCustomer))[0].n;
    var topP = (await this.q(M.STATS_SQL.topProduct))[0].n;
    var scopes = (await this.q(M.STATS_SQL.scopes))[0];
    this.data = { theta: settings.theta, rho: settings.rho };
    this.stats = {
      theta: settings.theta,
      rho: settings.rho,
      genMs: genMs,
      cramersV: M.cramersV(cells),
      homeShare: M.diagonalShare(cells),
      topCustomerShare: topC / this.orders,
      topProductShare: topP / this.orders,
      scopeCustomers: { city: scopes.city, province: scopes.province, country: scopes.country },
      shape: this.shape
    };
    return this.stats;
  };

  Lab.prototype.profile = async function (sql) {
    var rows = await this.q('EXPLAIN (ANALYZE, FORMAT JSON)\n' + sql);
    var raw = rows[0].explain_value;
    return M.parseProfile(raw);
  };

  // Browser timing is noisy, so report the median of several runs, after one unmeasured warm-up run.
  Lab.prototype.time = async function (sql, runs) {
    var ts = [];
    var result = await this.q(sql); // one unmeasured warm-up run
    for (var i = 0; i < runs; i++) {
      var t = now();
      result = await this.q(sql);
      ts.push(now() - t);
    }
    return { median: M.median(ts), runs: ts, min: Math.min.apply(null, ts), max: Math.max.apply(null, ts), result: result };
  };

  Lab.prototype.withOptimizerOff = async function (fn) {
    await this.q("SET disabled_optimizers = 'build_side_probe_side'");
    try { return await fn(); } finally { await this.q('RESET disabled_optimizers'); }
  };

  // Run a preset. opts: { runs, alt (time the other build side for "best"), compare (time "best" for "fixed") }
  Lab.prototype.runPreset = async function (presetId, scope, opts) {
    opts = opts || {};
    var runs = opts.runs || 5;
    var preset = M.PRESETS[presetId];
    var out = { preset: presetId, scope: scope, sql: preset.sql(scope) };
    if (preset.setup) {
      var setupTimes = [];
      for (var i = 0; i < Math.max(1, Math.min(3, runs)); i++) {
        var t = now();
        await this.q(preset.setup);
        setupTimes.push(now() - t);
      }
      out.setupMs = M.median(setupTimes);
      out.setupSql = preset.setup;
    }
    out.tree = await this.profile(out.sql);
    var timed = await this.time(out.sql, runs);
    out.timing = { median: timed.median, runs: timed.runs, min: timed.min, max: timed.max };
    out.result = timed.result;
    var self = this;
    if (presetId === 'best' && opts.alt !== false) {
      var join = M.findJoin(out.tree, ['customers', 'orders']);
      var chosen = M.buildTables(join).join();
      var other = chosen === 'customers' ? 'orders' : 'customers';
      var altSql = preset.forced(scope, other);
      out.alt = await this.withOptimizerOff(async function () {
        var tree = await self.profile(altSql);
        var tm = await self.time(altSql, runs);
        return { sql: altSql, build: other, tree: tree, timing: { median: tm.median, runs: tm.runs, min: tm.min, max: tm.max } };
      });
    }
    if (presetId === 'fixed' && opts.compare !== false) {
      var base = M.PRESETS.best.sql(scope);
      var btree = await this.profile(base);
      var bt = await this.time(base, runs);
      out.compare = { sql: base, tree: btree, timing: { median: bt.median, runs: bt.runs, min: bt.min, max: bt.max } };
      // The right build side without storing anything: separates what the fix gains by correcting
      // the estimate from what it gains by not scanning and filtering all the orders again.
      var rightSql = M.PRESETS.best.forced(scope, 'customers');
      out.compareAlt = await this.withOptimizerOff(async function () {
        var tree = await self.profile(rightSql);
        var tm = await self.time(rightSql, runs);
        return { sql: rightSql, build: 'customers', tree: tree, timing: { median: tm.median, runs: tm.runs, min: tm.min, max: tm.max } };
      });
    }
    return out;
  };

  var LIMIT_ROWS = 5e7;
  var CUSTOM_TIMEOUT_MS = 5000;

  // The free-form box: validate, look at DuckDB's own estimates first, refuse anything enormous.
  // Those estimates can be badly wrong (that is the point of the page), so every run of the query
  // also has a wall-clock limit and can be stopped: opts.onRun(handle) receives a handle with cancel().
  // It runs once for the profile and then once or twice more for timing, not five times.
  Lab.prototype.runCustom = async function (sql, opts) {
    opts = opts || {};
    var v = M.validateSql(sql);
    if (!v.ok) throw new Error(v.reason);
    var plan = await this.q('EXPLAIN (FORMAT JSON)\n' + v.sql);
    var ops = M.parseExplain(plan[0].explain_value);
    for (var i = 0; i < ops.length; i++) {
      if (/CROSS_PRODUCT|NESTED_LOOP|BLOCKWISE_NL/.test(ops[i].op)) throw new Error('That query needs a cross product or nested-loop join, which could freeze the tab. Add a join condition.');
      if (ops[i].est !== null && ops[i].est > LIMIT_ROWS) throw new Error('DuckDB expects more than 50 million rows somewhere in that plan, which could freeze the tab.');
    }
    var engine = this.engine;
    var limit = opts.timeoutMs || CUSTOM_TIMEOUT_MS;
    function run(text) {
      var h = engine.stoppable(text, limit);
      if (opts.onRun) opts.onRun(h);
      return h.promise;
    }
    var t0 = now();
    var profiled = await run('EXPLAIN (ANALYZE, FORMAT JSON)\n' + v.sql);
    var profileMs = now() - t0;
    var tree = M.parseProfile(profiled[0].explain_value);
    var runs = profileMs > 1500 ? 1 : 2;
    var ts = [], result = null;
    for (var r = 0; r < runs; r++) {
      var t = now();
      result = await run(v.sql);
      ts.push(now() - t);
    }
    return { preset: 'custom', sql: v.sql, tree: tree, timing: { median: M.median(ts), runs: ts, min: Math.min.apply(null, ts), max: Math.max.apply(null, ts) }, result: result };
  };

  // Run one guided step end to end and evaluate its claims.
  Lab.prototype.runStep = async function (step, opts) {
    var s = step.settings;
    var stats = await this.ensureData(s);
    var result;
    if (step.then) {
      var before = await this.runPreset(s.preset, s.scope, opts);
      var after = await this.runPreset(s.preset, step.then.scope || s.scope, opts);
      result = { before: before, after: after, stats: stats, tree: after.tree };
    } else {
      result = await this.runPreset(s.preset, s.scope, opts);
      result.stats = stats;
    }
    result.claims = step.check(result);
    return result;
  };

  root.CardinalLab = Lab;
})(window);
