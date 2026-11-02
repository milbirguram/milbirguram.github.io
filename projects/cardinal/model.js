// Cardinal: pure logic. No DOM, no DuckDB. Works in the browser (window.CardinalModel)
// and in Node (module.exports), so the maths and the plan parsing can be tested headlessly.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CardinalModel = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ------------------------------------------------------------------ data shape

  var SEED = 1979; // the year of Selinger et al.
  var CITIES = 60;
  var CITIES_PER_PROVINCE = 5;
  var PROVINCES = 12;
  var CATEGORIES = 12;
  var PRODUCTS = 1008; // a multiple of 12, so every category has the same number of products
  var SIZES = { laptop: 1000000, phone: 400000 };

  function shape(orders) {
    return {
      orders: orders,
      customers: Math.round(orders / 50),
      products: PRODUCTS,
      cities: CITIES,
      provinces: PROVINCES,
      categories: CATEGORIES
    };
  }

  function provinceOfCity(city) { return Math.floor(city / CITIES_PER_PROVINCE); }
  function cityOfCustomer(id) { return id % CITIES; }
  function provinceOfCustomer(id) { return provinceOfCity(cityOfCustomer(id)); }
  function categoryOfProduct(id) { return id % CATEGORIES; }

  // A foreign key is drawn as id = floor(n * u^a) with u uniform on [0, 1) and a = 1 / (1 - theta).
  // Then P(id = k) = ((k+1)/n)^(1-theta) - (k/n)^(1-theta), which is close to (1-theta) k^-theta / n^(1-theta):
  // a Zipf-like law with exponent theta. theta = 0 is uniform.
  function exponentFor(theta) { return 1 / (1 - theta); }

  function zipfMass(theta, n, k) {
    var e = 1 - theta;
    return Math.pow((k + 1) / n, e) - Math.pow(k / n, e);
  }

  function zipfMassWhere(theta, n, predicate) {
    var s = 0;
    for (var k = 0; k < n; k++) if (predicate(k)) s += zipfMass(theta, n, k);
    return s;
  }

  // Customer scopes: the "filter selectivity" control.
  var SCOPES = {
    city: { label: 'One city', sql: 'c.city = 0', fraction: 1 / CITIES, test: function (id) { return cityOfCustomer(id) === 0; } },
    province: { label: 'One province', sql: 'c.province = 0', fraction: 1 / PROVINCES, test: function (id) { return provinceOfCustomer(id) === 0; } },
    country: { label: 'Whole country', sql: '', fraction: 1, test: function () { return true; } }
  };

  // What the data really hold, in expectation, for the generator below.
  // An order picks customer k with zipfMass(theta, C, k). Its product is a skewed draw "base";
  // with probability rho the product is moved to the same rank inside the category that matches
  // the customer's province, which is what correlates province and category.
  function expected(settings, orders) {
    var s = shape(orders);
    var theta = settings.theta, rho = settings.rho;
    var C = s.customers, P = s.products;
    var scope = SCOPES[settings.scope || 'province'];
    var baseCat0 = zipfMassWhere(theta, P, function (j) { return categoryOfProduct(j) === 0; });
    var baseFirstBlock = zipfMassWhere(theta, P, function (j) { return j < CATEGORIES; });
    var inScope = 0, inScopeAndCat0 = 0, prov0 = 0;
    for (var k = 0; k < C; k++) {
      var m = zipfMass(theta, C, k);
      var p0 = provinceOfCustomer(k) === 0;
      if (p0) prov0 += m;
      if (scope.test(k)) {
        inScope += m;
        inScopeAndCat0 += m * (rho * (p0 ? 1 : 0) + (1 - rho) * baseCat0);
      }
    }
    var product0 = (1 - rho) * zipfMass(theta, P, 0) + rho * baseFirstBlock * prov0;
    return {
      topCustomerShare: zipfMass(theta, C, 0),
      topProductShare: zipfMass(theta, P, 0),
      ordersInScope: orders * inScope,
      starJoinRows: orders * inScopeAndCat0,
      bestSellerRows: orders * product0,
      // The optimiser's textbook model: every key equally likely, filters independent.
      uniformIndependent: {
        ordersInScope: orders * scope.fraction,
        starJoinRows: orders * scope.fraction / CATEGORIES,
        bestSellerRows: orders / P
      }
    };
  }

  // SQL that builds the three tables in DuckDB. Randomness is a seeded hash of the row number,
  // so the same settings always give the same rows. Each stream is reduced modulo a prime first:
  // DuckDB's multi-argument hash() keeps the low bits of different streams related, so
  // hash(...) % 12 and hash(...) % 60 taken directly would not be independent.
  // Products' price uses hash(...) % 9800 directly; nothing depends on it.
  function dataSql(settings, orders) {
    var s = shape(orders);
    var a = exponentFor(settings.theta);
    var rhoPerMille = Math.round(settings.rho * 1000);
    var U = function (stream) { return '(hash(i, ' + stream + ', ' + SEED + ') % 1000003) / 1000003.0'; };
    return [
      'CREATE OR REPLACE TABLE customers AS SELECT i::INTEGER AS id, (i % ' + CITIES + ')::INTEGER AS city, ' +
        '((i % ' + CITIES + ') // ' + CITIES_PER_PROVINCE + ')::INTEGER AS province FROM generate_series(0, ' + (s.customers - 1) + ') t(i)',
      'CREATE OR REPLACE TABLE products AS SELECT i::INTEGER AS id, (i % ' + CATEGORIES + ')::INTEGER AS category, ' +
        'round(2 + (hash(i, 9, ' + SEED + ') % 9800) / 100.0, 2) AS price FROM generate_series(0, ' + (s.products - 1) + ') t(i)',
      'CREATE OR REPLACE TABLE orders AS WITH d AS (SELECT i, ' +
        'least(' + (s.customers - 1) + ', floor(' + s.customers + ' * pow(' + U(1) + ', ' + a.toFixed(6) + ')))::INTEGER AS cid, ' +
        'least(' + (s.products - 1) + ', floor(' + s.products + ' * pow(' + U(2) + ', ' + a.toFixed(6) + ')))::INTEGER AS base, ' +
        '(hash(i, 3, ' + SEED + ') % 1000003) % 1000 < ' + rhoPerMille + ' AS local, ' +
        'round(5 + (hash(i, 4, ' + SEED + ') % 9500) / 100.0, 2) AS amount ' +
        'FROM generate_series(0, ' + (s.orders - 1) + ') t(i)) ' +
        'SELECT i::INTEGER AS id, cid AS customer_id, ' +
        'CASE WHEN local THEN (base - base % ' + CATEGORIES + ' + (cid % ' + CITIES + ') // ' + CITIES_PER_PROVINCE + ')::INTEGER ELSE base END AS product_id, ' +
        'amount FROM d'
    ];
  }

  var STATS_SQL = {
    contingency: 'SELECT c.province AS a, p.category AS b, count(*)::INTEGER AS n FROM orders o JOIN customers c ON o.customer_id = c.id JOIN products p ON o.product_id = p.id GROUP BY ALL',
    topCustomer: 'SELECT max(n)::INTEGER AS n FROM (SELECT count(*) AS n FROM orders GROUP BY customer_id)',
    topProduct: 'SELECT max(n)::INTEGER AS n FROM (SELECT count(*) AS n FROM orders GROUP BY product_id)',
    scopes: 'SELECT count(*) FILTER (WHERE city = 0)::INTEGER AS city, count(*) FILTER (WHERE province = 0)::INTEGER AS province, count(*)::INTEGER AS country FROM customers'
  };

  // ------------------------------------------------------------------ queries

  function where(parts) {
    parts = parts.filter(Boolean);
    return parts.length ? '\nWHERE ' + parts.join(' AND ') : '';
  }

  var PRESETS = {
    star: {
      label: 'Regional sales',
      note: 'Orders joined to customers and products, filtered on both.',
      sql: function (scope) {
        return 'SELECT count(*) AS orders, sum(o.amount) AS revenue\nFROM orders o\nJOIN customers c ON o.customer_id = c.id\nJOIN products p ON o.product_id = p.id' +
          where([SCOPES[scope].sql, 'p.category = 0']);
      }
    },
    best: {
      label: 'Best seller',
      note: 'Orders for product 0, joined to customers.',
      sql: function (scope) {
        return 'SELECT count(*) AS orders, sum(o.amount) AS revenue\nFROM orders o\nJOIN customers c ON o.customer_id = c.id' +
          where(['o.product_id = 0', SCOPES[scope].sql]);
      },
      // The same query with the hash-join sides written out, for use with the build-side optimiser off.
      // With it off, DuckDB probes with the left input and builds on the right one.
      forced: function (scope, build) {
        var from = build === 'customers'
          ? 'FROM orders o\nJOIN customers c ON o.customer_id = c.id'
          : 'FROM customers c\nJOIN orders o ON o.customer_id = c.id';
        return 'SELECT count(*) AS orders, sum(o.amount) AS revenue\n' + from + where(['o.product_id = 0', SCOPES[scope].sql]);
      }
    },
    fixed: {
      label: 'Best seller, materialised',
      note: 'Store product 0’s orders first, so DuckDB can count them.',
      setup: 'CREATE OR REPLACE TEMP TABLE best_seller AS SELECT * FROM orders WHERE product_id = 0',
      sql: function (scope) {
        return 'SELECT count(*) AS orders, sum(o.amount) AS revenue\nFROM best_seller o\nJOIN customers c ON o.customer_id = c.id' +
          where([SCOPES[scope].sql]);
      }
    }
  };

  // The editable box may only read. DuckDB's own external access is also switched off.
  // Forbidden words are matched as keywords only: not inside quoted identifiers, not after AS
  // (an alias such as "AS load") and not next to a dot (a qualified name such as o.load).
  var FORBIDDEN_WORDS = ['attach', 'detach', 'copy', 'export', 'import', 'install', 'load', 'pragma', 'set', 'reset',
    'call', 'create', 'insert', 'update', 'delete', 'drop', 'alter', 'truncate', 'vacuum', 'checkpoint', 'use',
    'begin', 'commit', 'rollback', 'prepare', 'execute', 'deallocate', 'summarize', 'describe', 'show', 'explain', 'merge',
    'recursive'];
  var FORBIDDEN_FUNCS = /\b(read_\w+|\w+_scan|parquet_\w+|glob|sniff_csv|query|query_table|getenv|load_extension|duckdb_secrets|which_secret)\s*\(/i;
  var QID = /\u0001(\d+)\u0001/g;

  // Splits SQL into code, string literals and quoted identifiers. In the code, comments become spaces,
  // string literals become '' and each quoted identifier becomes a placeholder \u0001<n>\u0001.
  function stripSql(sql) {
    var literals = [], idents = [];
    var code = '';
    var i = 0;
    while (i < sql.length) {
      var ch = sql[i];
      if (ch === '-' && sql[i + 1] === '-') { while (i < sql.length && sql[i] !== '\n') i++; code += ' '; continue; }
      if (ch === '/' && sql[i + 1] === '*') {
        var end = sql.indexOf('*/', i + 2);
        if (end < 0) return { error: 'An unfinished /* comment.' };
        i = end + 2; code += ' '; continue;
      }
      if (ch === "'" || ch === '"') {
        var j = i + 1, text = '';
        while (j < sql.length) {
          if (sql[j] === ch && sql[j + 1] === ch) { text += ch; j += 2; continue; }
          if (sql[j] === ch) break;
          text += sql[j]; j++;
        }
        if (j >= sql.length) return { error: 'An unfinished quoted string.' };
        if (ch === "'") { literals.push(text); code += " '' "; }
        else { code += ' \u0001' + idents.length + '\u0001 '; idents.push(text); }
        i = j + 1; continue;
      }
      code += ch; i++;
    }
    return { code: code, literals: literals, idents: idents };
  }

  function validateSql(sql) {
    if (typeof sql !== 'string' || !sql.trim()) return { ok: false, reason: 'Write a query first.' };
    if (sql.length > 4000) return { ok: false, reason: 'Keep the query under 4,000 characters.' };
    var s = stripSql(sql);
    if (s.error) return { ok: false, reason: s.error };
    var code = s.code.trim().replace(/;\s*$/, '');
    if (!code) return { ok: false, reason: 'Write a query first.' };
    if (code.indexOf(';') >= 0) return { ok: false, reason: 'One statement at a time.' };
    if (!/^(select|with)\b/i.test(code.replace(/^\(+\s*/, ''))) return { ok: false, reason: 'Only SELECT (or WITH … SELECT) queries can run here.' };
    var tokens = code.toLowerCase().match(/[a-z_][a-z0-9_]*|\u0001\d+\u0001|[^\sa-z0-9_]/g) || [];
    for (var t = 0; t < tokens.length; t++) {
      var w = tokens[t];
      if (FORBIDDEN_WORDS.indexOf(w) < 0) continue;
      var before = tokens[t - 1], after = tokens[t + 1];
      if (before === 'as' || before === '.' || after === '.') continue;
      if (w === 'recursive') return { ok: false, reason: 'Recursive queries can run without end, so they are not allowed here.' };
      return { ok: false, reason: '“' + w.toUpperCase() + '” is not allowed here; this box only reads the three tables.' };
    }
    // Function names are checked with quoted identifiers unquoted, so "read_csv"(…) is caught too.
    var bare = code.replace(QID, function (m, n) { return s.idents[+n].replace(/[^A-Za-z0-9_]/g, '_'); });
    if (FORBIDDEN_FUNCS.test(bare)) return { ok: false, reason: 'Reading files or running nested SQL is not allowed here.' };
    for (var l = 0; l < s.literals.length; l++) {
      if (/[\/\\:]|\.\w{2,7}$/.test(s.literals[l])) return { ok: false, reason: 'String literals that look like files or URLs are not allowed.' };
    }
    return { ok: true, sql: sql.trim().replace(/;\s*$/, '') };
  }

  // The text a preset shows in the SQL box. A setup step (the materialised preset) is shown as a
  // comment, because the page runs it itself and the box only reads; the rest runs as written.
  function presetText(id, scope) {
    var p = PRESETS[id];
    return (p.setup ? '-- First the page runs, once:\n-- ' + p.setup + ';\n\n' : '') + p.sql(scope) + ';';
  }

  // ------------------------------------------------------------------ plans

  var COLLAPSE = { EXPLAIN_ANALYZE: 1, PROJECTION: 1, RESULT_COLLECTOR: 1 };
  var JOINS = { HASH_JOIN: 1, NESTED_LOOP_JOIN: 1, BLOCKWISE_NL_JOIN: 1, PIECEWISE_MERGE_JOIN: 1, IE_JOIN: 1, CROSS_PRODUCT: 1, DELIM_JOIN: 1, LEFT_DELIM_JOIN: 1, RIGHT_DELIM_JOIN: 1, POSITIONAL_JOIN: 1, ASOF_JOIN: 1 };
  var NAMES = {
    HASH_JOIN: 'Hash join', SEQ_SCAN: 'Scan', TABLE_SCAN: 'Scan', FILTER: 'Filter', HASH_GROUP_BY: 'Group by',
    PERFECT_HASH_GROUP_BY: 'Group by', UNGROUPED_AGGREGATE: 'Aggregate', ORDER_BY: 'Sort', TOP_N: 'Top N',
    STREAMING_LIMIT: 'Limit', LIMIT: 'Limit', NESTED_LOOP_JOIN: 'Nested-loop join', BLOCKWISE_NL_JOIN: 'Nested-loop join',
    PIECEWISE_MERGE_JOIN: 'Merge join', IE_JOIN: 'Inequality join', CROSS_PRODUCT: 'Cross product', WINDOW: 'Window',
    STREAMING_WINDOW: 'Window', CTE: 'CTE', CTE_SCAN: 'CTE scan', COLUMN_DATA_SCAN: 'Scan (in memory)', DUMMY_SCAN: 'Constant',
    DELIM_SCAN: 'Delim scan', UNION: 'Union', DISTINCT: 'Distinct'
  };

  function toNumber(v) {
    if (v === undefined || v === null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var n = Number(String(v).replace(/[~,\s]|rows/g, ''));
    return isFinite(n) ? n : null;
  }

  function asText(v, sep) {
    if (v === undefined || v === null) return '';
    if (Array.isArray(v)) return v.join(sep || ' AND ');
    return String(v);
  }

  // DuckDB's EXPLAIN (ANALYZE, FORMAT JSON) output -> a small tree:
  // { op, name, table, detail, est, act, timeMs, children, role }
  // est comes from extra_info["Estimated Cardinality"], act from operator_cardinality.
  function parseProfile(input) {
    var root = typeof input === 'string' ? JSON.parse(input) : input;
    if (Array.isArray(root)) root = root.length === 1 ? root[0] : { children: root };
    function norm(node) {
      var type = String(node.operator_type || node.operator_name || node.name || '').trim();
      var kids = (node.children || []).map(norm).filter(Boolean);
      if (!type || COLLAPSE[type]) {
        if (kids.length === 1) return kids[0];
        if (kids.length === 0) return null;
        return { op: 'QUERY', name: 'Query', table: '', detail: '', est: null, act: null, timeMs: null, children: kids };
      }
      var ei = node.extra_info || {};
      if (type === 'TABLE_SCAN') type = 'SEQ_SCAN';
      var table = asText(ei.Table || ei.Function === 'SEQ_SCAN' && ei.Table || '');
      var detail = '';
      if (JOINS[type]) detail = asText(ei.Conditions);
      else if (type === 'SEQ_SCAN') detail = asText(ei.Filters);
      else if (type === 'FILTER') detail = asText(ei.Expression || ei.Filters);
      else if (/GROUP_BY/.test(type)) detail = asText(ei.Groups, ', ');
      else if (type === 'UNGROUPED_AGGREGATE') detail = asText(ei.Aggregates, ', ');
      var out = {
        op: type,
        name: NAMES[type] || type.charAt(0) + type.slice(1).toLowerCase().replace(/_/g, ' '),
        table: table,
        detail: detail.replace(/\s+/g, ' ').trim(),
        est: toNumber(ei['Estimated Cardinality']),
        act: toNumber(node.operator_cardinality),
        timeMs: typeof node.operator_timing === 'number' ? node.operator_timing * 1000 : null,
        children: kids
      };
      if (JOINS[type] && kids.length === 2) {
        kids[0].role = 'probe';
        kids[1].role = 'build';
      }
      return out;
    }
    var tree = norm(root);
    if (!tree) throw new Error('The profile has no operators.');
    return tree;
  }

  // EXPLAIN (FORMAT JSON) without ANALYZE: estimates only. Used to guard the free-form box.
  function parseExplain(input) {
    var root = typeof input === 'string' ? JSON.parse(input) : input;
    var list = [];
    (function walk(n) {
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (!n || typeof n !== 'object') return;
      var ei = n.extra_info || {};
      list.push({ op: String(n.name || n.operator_type || '').trim(), est: toNumber(ei['Estimated Cardinality']) });
      (n.children || []).forEach(walk);
    })(root);
    return list;
  }

  function tablesOf(node) {
    var out = [];
    (function walk(n) {
      if (n.op === 'SEQ_SCAN' && n.table) out.push(n.table);
      n.children.forEach(walk);
    })(node);
    return out.sort();
  }

  function isJoin(node) { return !!JOINS[node.op]; }

  // Rows for display, depth-first, root first. Each gets a key that survives re-planning
  // (operator + the tables beneath it), so the view can animate rows to their new places.
  function flatten(tree) {
    var rows = [];
    var seen = {};
    (function walk(n, depth, parentKey) {
      var base = n.op + ':' + tablesOf(n).join('+') + (n.op === 'SEQ_SCAN' ? '|' + n.detail : '');
      var key = base;
      var dup = 1;
      while (seen[key]) key = base + '#' + (++dup);
      seen[key] = true;
      rows.push({ key: key, depth: depth, node: n, parent: parentKey, q: qError(n.est, n.act) });
      n.children.forEach(function (c) { walk(c, depth + 1, key); });
    })(tree, 0, null);
    return rows;
  }

  function signature(n) {
    var head = n.op + (n.table ? '[' + n.table + ']' : '');
    return n.children.length ? head + '(' + n.children.map(signature).join(',') + ')' : head;
  }

  function joinsOf(tree) {
    var out = [];
    (function walk(n) { if (isJoin(n)) out.push(n); n.children.forEach(walk); })(tree);
    return out;
  }

  function buildSide(join) { return join.children[1] || null; }

  function listTables(ts) {
    if (ts.length <= 1) return ts[0] || 'its input';
    return ts.slice(0, -1).join(', ') + ' and ' + ts[ts.length - 1];
  }

  function guess(n) { return n && n.est !== null ? ' (it guessed ' + formatCount(n.est) + ' rows)' : ''; }

  // One plain sentence about what changed between two plans, or null when nothing did.
  function describeChange(prev, next) {
    if (!prev || !next) return null;
    if (signature(prev) === signature(next)) return null;
    var pj = joinsOf(prev), nj = joinsOf(next);
    var key = function (j) { return tablesOf(j).join('+'); };
    var prevKeys = pj.map(key);
    var sameTables = tablesOf(prev).join('+') === tablesOf(next).join('+');
    if (!sameTables) return null; // a different query, not a re-plan
    var reordered = nj.some(function (j) { return prevKeys.indexOf(key(j)) < 0; });
    if (reordered && nj.length > 1) {
      var deepest = nj[nj.length - 1];
      var first = tablesOf(deepest);
      var rest = tablesOf(next).filter(function (t) { return first.indexOf(t) < 0; });
      return 'The join order changed: DuckDB now joins ' + listTables(first) + ' first' + guess(deepest) +
        (rest.length ? ', then adds ' + listTables(rest) : '') + '.';
    }
    for (var i = 0; i < nj.length; i++) {
      var match = pj[prevKeys.indexOf(key(nj[i]))];
      if (!match) continue;
      var nb = buildSide(nj[i]), pb = buildSide(match);
      if (nb && pb && tablesOf(nb).join('+') !== tablesOf(pb).join('+')) {
        return 'The plan flipped: DuckDB now builds its hash table on ' + listTables(tablesOf(nb)) + guess(nb) +
          ' instead of ' + listTables(tablesOf(pb)) + guess(pb) + '.';
      }
    }
    return 'The plan changed shape.';
  }

  // ------------------------------------------------------------------ measures

  // q-error (Moerkotte, Neumann and Steidl 2009): the factor by which an estimate is off,
  // in whichever direction. Counts below 1 are treated as 1 so an empty result stays finite.
  function qError(est, act) {
    if (est === null || est === undefined || act === null || act === undefined) return null;
    var e = Math.max(1, est), a = Math.max(1, act);
    return Math.max(e / a, a / e);
  }

  function direction(est, act) {
    if (est === null || act === null || est === undefined || act === undefined) return null;
    var e = Math.max(1, est), a = Math.max(1, act);
    if (a > e) return 'under';
    if (e > a) return 'over';
    return 'exact';
  }

  function median(xs) {
    if (!xs || !xs.length) return null;
    var s = xs.slice().sort(function (a, b) { return a - b; });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  // Cramér's V for a list of {a, b, n} cells: 0 when the two columns are independent, 1 when one fixes the other.
  function cramersV(cells) {
    var rows = {}, cols = {}, total = 0, joint = {};
    cells.forEach(function (c) {
      var n = Number(c.n);
      rows[c.a] = (rows[c.a] || 0) + n;
      cols[c.b] = (cols[c.b] || 0) + n;
      joint[c.a + '|' + c.b] = (joint[c.a + '|' + c.b] || 0) + n;
      total += n;
    });
    var rk = Object.keys(rows), ck = Object.keys(cols);
    if (total === 0 || rk.length < 2 || ck.length < 2) return 0;
    var chi = 0;
    rk.forEach(function (r) {
      ck.forEach(function (c) {
        var e = rows[r] * cols[c] / total;
        var o = joint[r + '|' + c] || 0;
        chi += (o - e) * (o - e) / e;
      });
    });
    return Math.sqrt(chi / (total * (Math.min(rk.length, ck.length) - 1)));
  }

  // Share of orders whose category matches the customer's province: the diagonal of the
  // province x category table. The generator moves a fraction rho of orders onto the diagonal;
  // the rest land there by chance (1 in 12 on uniform data), so the share is rho + (1 - rho) / 12.
  function diagonalShare(cells) {
    var total = 0, diag = 0;
    cells.forEach(function (c) { var n = Number(c.n); total += n; if (String(c.a) === String(c.b)) diag += n; });
    return total ? diag / total : 0;
  }
  function homeShareExpected(rho) { return rho + (1 - rho) / CATEGORIES; }

  // ------------------------------------------------------------------ display helpers

  function formatCount(n) {
    if (n === null || n === undefined || !isFinite(n)) return '–';
    n = Math.round(n);
    return n.toLocaleString('en-CA');
  }

  function shortCount(n) {
    if (n === null || n === undefined || !isFinite(n)) return '–';
    if (n < 1000) return String(Math.round(n));
    if (n < 1e6) return (n < 1e4 ? (n / 1000).toFixed(1).replace(/\.0$/, '') : Math.round(n / 1000)) + 'k';
    return (n / 1e6).toFixed(n < 1e7 ? 1 : 0).replace(/\.0$/, '') + 'M';
  }

  function formatQ(q) {
    if (q === null) return '–';
    return q < 10 ? q.toFixed(1) : String(Math.round(q));
  }

  // Position of a count on a log axis from 1 to max, as a fraction 0..1.
  function logPos(n, max) {
    if (n === null || n === undefined) return 0;
    var v = Math.max(1, n);
    return Math.min(1, Math.log(v) / Math.log(Math.max(10, max)));
  }

  function logTicks(max) {
    var t = [];
    for (var p = 1; p <= max * 1.0001; p *= 10) t.push(p);
    return t;
  }

  // ------------------------------------------------------------------ guided steps
  // Each step sets the controls, says one or two things, and makes claims that the scripted
  // browser check (tests/steps.html) asserts against DuckDB's real output.

  function findScan(tree, table) {
    var hit = null;
    (function walk(n) { if (!hit && n.op === 'SEQ_SCAN' && n.table === table) hit = n; n.children.forEach(walk); })(tree);
    return hit;
  }

  function findJoin(tree, tables) {
    var want = tables.slice().sort().join('+');
    var hit = null;
    joinsOf(tree).forEach(function (j) { if (!hit && tablesOf(j).join('+') === want) hit = j; });
    return hit;
  }

  function buildTables(join) { return join && join.children[1] ? tablesOf(join.children[1]) : []; }

  function claim(text, pass, detail) { return { claim: text, pass: !!pass, detail: detail || '' }; }

  function estimatedOps(tree) {
    return flatten(tree).filter(function (r) { return r.node.est !== null && r.node.act !== null; });
  }

  var STEPS = [
    {
      id: 'uniform',
      title: 'Uniform data',
      settings: { theta: 0, rho: 0, scope: 'province', preset: 'star' },
      check: function (r) {
        var worst = Math.max.apply(null, estimatedOps(r.tree).map(function (x) { return x.q; }));
        return [claim('Every operator’s estimate is within a factor of 2 of the real count', worst <= 2, 'worst q-error ' + worst.toFixed(2))];
      }
    },
    {
      id: 'correlated',
      title: 'Correlated filters',
      settings: { theta: 0, rho: 0.8, scope: 'province', preset: 'star' },
      check: function (r) {
        var top = findJoin(r.tree, ['customers', 'orders', 'products']);
        var cust = findScan(r.tree, 'customers'), prod = findScan(r.tree, 'products');
        return [
          claim('The final join is underestimated at least fivefold', top && top.act / Math.max(1, top.est) >= 5, top ? formatCount(top.est) + ' guessed, ' + formatCount(top.act) + ' real' : 'no join'),
          claim('Each filter on its own is still estimated well', qError(cust.est, cust.act) <= 2 && qError(prod.est, prod.act) <= 2, 'customers q ' + qError(cust.est, cust.act).toFixed(2) + ', products q ' + qError(prod.est, prod.act).toFixed(2)),
          claim('The measured correlation matches the setting', Math.abs(r.stats.cramersV - 0.8) <= 0.05, 'Cramér’s V ' + r.stats.cramersV.toFixed(3))
        ];
      }
    },
    {
      id: 'skew',
      title: 'Skewed join key',
      settings: { theta: 0.8, rho: 0, scope: 'city', preset: 'star' },
      check: function (r) {
        var j = findJoin(r.tree, ['customers', 'orders']);
        var cust = findScan(r.tree, 'customers');
        return [
          claim('The orders–customers join is underestimated at least fourfold', j && j.act / Math.max(1, j.est) >= 4, j ? formatCount(j.est) + ' guessed, ' + formatCount(j.act) + ' real' : 'no join'),
          claim('The customer filter alone is still estimated well', qError(cust.est, cust.act) <= 2, 'q ' + qError(cust.est, cust.act).toFixed(2))
        ];
      }
    },
    {
      id: 'flip',
      title: 'The plan flips',
      settings: { theta: 0.8, rho: 0, scope: 'city', preset: 'best' },
      then: { scope: 'province' },
      check: function (r) {
        var jb = findJoin(r.before.tree, ['customers', 'orders']);
        var ja = findJoin(r.after.tree, ['customers', 'orders']);
        var scan = findScan(r.after.tree, 'orders');
        var alt = r.after.alt;
        var altJoin = alt && findJoin(alt.tree, ['customers', 'orders']);
        return [
          claim('With one city, DuckDB builds its hash table on customers', buildTables(jb).join() === 'customers'),
          claim('With one province, it flips and builds on orders', buildTables(ja).join() === 'orders'),
          claim('It does so because it guesses product 0’s orders at least 50 times too low', scan && scan.act / Math.max(1, scan.est) >= 50, scan ? formatCount(scan.est) + ' guessed, ' + formatCount(scan.act) + ' real' : ''),
          claim('The other build side really is the customers side', altJoin && buildTables(altJoin).join() === 'customers'),
          claim('DuckDB’s flipped plan is at least 1.5 times slower than the other build side', alt && r.after.timing.median >= 1.5 * alt.timing.median,
            r.after.timing.median.toFixed(1) + ' ms against ' + (alt ? alt.timing.median.toFixed(1) : '?') + ' ms'),
          claim('The query slows down after the flip', r.after.timing.median > r.before.timing.median,
            r.before.timing.median.toFixed(1) + ' ms, then ' + r.after.timing.median.toFixed(1) + ' ms')
        ];
      }
    },
    {
      id: 'fix',
      title: 'What helps',
      settings: { theta: 0.8, rho: 0, scope: 'province', preset: 'fixed' },
      check: function (r) {
        var j = findJoin(r.tree, ['best_seller', 'customers']);
        var scan = findScan(r.tree, 'best_seller');
        var orig = r.compare;
        return [
          claim('With the orders materialised, DuckDB counts them exactly', scan && qError(scan.est, scan.act) <= 1.1, scan ? formatCount(scan.est) + ' guessed, ' + formatCount(scan.act) + ' real' : ''),
          claim('and builds its hash table on customers again', buildTables(j).join() === 'customers'),
          claim('The join then runs at least 1.5 times faster than DuckDB’s own plan', orig && orig.timing.median >= 1.5 * r.timing.median,
            r.timing.median.toFixed(1) + ' ms against ' + (orig ? orig.timing.median.toFixed(1) : '?') + ' ms; materialising took ' + (r.setupMs !== undefined ? r.setupMs.toFixed(1) : '?') + ' ms')
        ];
      }
    }
  ];

  // ------------------------------------------------------------------ recorded preview
  // The card preview cannot load DuckDB, so it replays these numbers. They are written by
  // tests/make-preview.js from tests/steps.json (the scripted run against the pinned version);
  // tests/steps.test.js checks they still match it.
  // BEGIN RECORDED_PREVIEW
  var RECORDED_PREVIEW = {"source":"tests/steps.json, recorded 2026-11-02T03:35:51.385Z with duckdb-wasm 1.32.0 (DuckDB v1.4.3)","frames":[{"theta":0,"scope":"city","ms":6.6,"rows":[{"key":"join","label":"Hash join","detail":"on customer","role":null,"depth":0,"est":14,"act":21},{"key":"orders","label":"orders","detail":"product_id = 0","role":"probe","depth":1,"est":801,"act":1007},{"key":"customers","label":"customers","detail":"city = 0","role":"build","depth":1,"est":371,"act":334}]},{"theta":0.2,"scope":"city","ms":5.9,"rows":[{"key":"join","label":"Hash join","detail":"on customer","role":null,"depth":0,"est":14,"act":56},{"key":"orders","label":"orders","detail":"product_id = 0","role":"probe","depth":1,"est":801,"act":3941},{"key":"customers","label":"customers","detail":"city = 0","role":"build","depth":1,"est":371,"act":334}]},{"theta":0.4,"scope":"city","ms":9.2,"rows":[{"key":"join","label":"Hash join","detail":"on customer","role":null,"depth":0,"est":14,"act":260},{"key":"orders","label":"orders","detail":"product_id = 0","role":"probe","depth":1,"est":801,"act":15842},{"key":"customers","label":"customers","detail":"city = 0","role":"build","depth":1,"est":371,"act":334}]},{"theta":0.6,"scope":"city","ms":12.7,"rows":[{"key":"join","label":"Hash join","detail":"on customer","role":null,"depth":0,"est":14,"act":2143},{"key":"orders","label":"orders","detail":"product_id = 0","role":"probe","depth":1,"est":801,"act":63092},{"key":"customers","label":"customers","detail":"city = 0","role":"build","depth":1,"est":371,"act":334}]},{"theta":0.8,"scope":"city","ms":21.5,"rows":[{"key":"join","label":"Hash join","detail":"on customer","role":null,"depth":0,"est":14,"act":37715},{"key":"orders","label":"orders","detail":"product_id = 0","role":"probe","depth":1,"est":801,"act":250474},{"key":"customers","label":"customers","detail":"city = 0","role":"build","depth":1,"est":371,"act":334}]},{"theta":0.8,"scope":"province","ms":31.9,"altMs":12.2,"altBuild":"customers","rows":[{"key":"join","label":"Hash join","detail":"on customer","role":null,"depth":0,"est":61,"act":62890},{"key":"customers","label":"customers","detail":"province = 0","role":"probe","depth":1,"est":1539,"act":1670},{"key":"orders","label":"orders","detail":"product_id = 0","role":"build","depth":1,"est":801,"act":250531}]}]};
  // END RECORDED_PREVIEW

  return {
    RECORDED_PREVIEW: RECORDED_PREVIEW,
    SEED: SEED, SIZES: SIZES, SCOPES: SCOPES, PRESETS: PRESETS, STEPS: STEPS, STATS_SQL: STATS_SQL,
    shape: shape, exponentFor: exponentFor, zipfMass: zipfMass, zipfMassWhere: zipfMassWhere,
    provinceOfCustomer: provinceOfCustomer, categoryOfProduct: categoryOfProduct,
    expected: expected, dataSql: dataSql, validateSql: validateSql, presetText: presetText,
    diagonalShare: diagonalShare, homeShareExpected: homeShareExpected, cityOfCustomer: cityOfCustomer,
    parseProfile: parseProfile, parseExplain: parseExplain, flatten: flatten, signature: signature,
    tablesOf: tablesOf, joinsOf: joinsOf, findJoin: findJoin, findScan: findScan, buildTables: buildTables,
    describeChange: describeChange,
    qError: qError, direction: direction, median: median, cramersV: cramersV,
    formatCount: formatCount, shortCount: shortCount, formatQ: formatQ, logPos: logPos, logTicks: logTicks
  };
});
