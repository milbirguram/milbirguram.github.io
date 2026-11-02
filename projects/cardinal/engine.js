// Cardinal: loads DuckDB-Wasm from jsDelivr, lazily, and only when asked.
// Never loaded in preview mode. Exposes window.CardinalEngine.load(onProgress).
(function (root) {
  'use strict';

  // Exact pinned version: a stable release, published 2025-12-16.
  var VERSION = '1.32.0';
  var ESM_URL = 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@' + VERSION + '/+esm';

  var loading = null;

  function toPlain(value) {
    if (typeof value === 'bigint') return Number(value);
    if (value && typeof value === 'object' && typeof value.toJSON === 'function' && !(value instanceof Date)) {
      return value.toJSON();
    }
    return value;
  }

  function rowsOf(table) {
    var out = [];
    var fields = table.schema.fields.map(function (f) { return f.name; });
    var arr = table.toArray();
    for (var i = 0; i < arr.length; i++) {
      var r = arr[i];
      var o = {};
      for (var j = 0; j < fields.length; j++) o[fields[j]] = toPlain(r[fields[j]]);
      out.push(o);
    }
    return out;
  }

  function load(onProgress) {
    if (loading) return loading;
    loading = (async function () {
      var report = typeof onProgress === 'function' ? onProgress : function () {};
      report({ phase: 'script', loaded: 0, total: 0 });
      var duckdb = await import(ESM_URL);
      if (duckdb.PACKAGE_VERSION !== VERSION) {
        throw new Error('DuckDB-Wasm version mismatch: expected ' + VERSION + ', got ' + duckdb.PACKAGE_VERSION);
      }
      // The documented jsDelivr route: pick the best bundle for this browser,
      // then start the worker from a Blob URL so it runs on any static host.
      var bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
      if (bundle.mainModule.indexOf('@' + VERSION + '/') < 0) {
        throw new Error('Unexpected bundle URL ' + bundle.mainModule);
      }
      var workerUrl = URL.createObjectURL(new Blob(['importScripts("' + bundle.mainWorker + '");'], { type: 'text/javascript' }));
      var worker = new Worker(workerUrl);
      var db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker, function (p) {
        report({ phase: 'wasm', loaded: p.bytesLoaded || 0, total: p.bytesTotal || 0 });
      });
      URL.revokeObjectURL(workerUrl);
      var conn = await db.connect();
      report({ phase: 'ready', loaded: 1, total: 1 });

      // One query at a time: the connection is shared.
      var chain = Promise.resolve();
      var dead = false;
      function query(sql) {
        if (dead) return Promise.reject(new Error('DuckDB was stopped.'));
        var next = chain.then(function () { return conn.query(sql); }).then(rowsOf);
        chain = next.catch(function () {});
        return next;
      }

      // A query that can be stopped: by a wall-clock limit or by cancel(). It is sent as a pending
      // query, which DuckDB runs in slices, so a cancel can land between slices. If DuckDB has not
      // stopped 2.5 s after the cancel, the worker is ended and the error says so (restart: true);
      // the page then starts a fresh engine.
      function stoppable(sql, timeoutMs) {
        var ctl = { stop: null, early: null };
        var next = chain.then(function () {
          return new Promise(function (resolve, reject) {
            if (dead) { reject(new Error('DuckDB was stopped.')); return; }
            var settled = false, why = null, timer = 0, killer = 0;
            function finish(ok, value) {
              if (settled) return;
              settled = true; clearTimeout(timer); clearTimeout(killer);
              if (ok) resolve(value); else reject(value);
            }
            function stopped(restart) {
              var e = new Error(why === 'timeout' ? 'Stopped after ' + Math.round(timeoutMs / 1000) + ' seconds: that query takes too long to run here.' : 'Stopped.');
              e.stopped = why; e.restart = !!restart;
              return e;
            }
            ctl.stop = function (reason) {
              if (settled || why) return;
              why = reason;
              conn.cancelSent().catch(function () {});
              killer = setTimeout(function () {
                dead = true;
                loading = null;
                try { db.terminate(); } catch (e) { /* already gone */ }
                finish(false, stopped(true));
              }, 2500);
            };
            timer = setTimeout(function () { ctl.stop('timeout'); }, timeoutMs);
            if (ctl.early) ctl.stop(ctl.early);
            conn.send(sql).then(async function (reader) {
              var rows = [];
              for await (var batch of reader) rows = rows.concat(rowsOf(batch));
              return rows;
            }).then(function (rows) {
              if (why) finish(false, stopped(false)); else finish(true, rows);
            }, function (err) {
              finish(false, why ? stopped(false) : err);
            });
          });
        });
        chain = next.catch(function () {});
        return {
          promise: next,
          cancel: function () { if (ctl.stop) ctl.stop('cancel'); else ctl.early = 'cancel'; }
        };
      }

      var version = (await query('SELECT version() AS v'))[0].v;
      return {
        query: query, stoppable: stoppable, duckdbVersion: version, packageVersion: VERSION, db: db, conn: conn,
        isDead: function () { return dead; }
      };
    })();
    loading.catch(function () { loading = null; });
    return loading;
  }

  root.CardinalEngine = { VERSION: VERSION, load: load };
})(typeof window !== 'undefined' ? window : this);
