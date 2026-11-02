// Whittle: a small property-based testing engine, six buggy functions and their properties.
// Works in the browser (window.Whittle) and in Node (module.exports).
//
// The engine follows Hypothesis in one important way: every generated input is built from a
// recorded sequence of integer choices, and shrinking edits that sequence, never the value.
// A candidate is replayed through the same generator, so whatever the shrinker produces is
// always a value the generator could have produced. Shorter sequences, then lexicographically
// smaller ones, count as simpler ("shortlex"), and the shrinker only accepts strictly simpler
// sequences that still fail, so it always terminates.
(function (root) {
  'use strict';

  // ------------------------------------------------------------------ seeded PRNG (mulberry32)
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ------------------------------------------------------------------ choice sequences
  var MAX_CHOICES = 4000;

  function Overrun() { this.message = 'too many choices'; }

  // Random mode: choices come from the PRNG (through an optional sampler that biases them).
  // Replay mode: choices come from `prefix`; a value too large for its range is clamped, and
  // draws beyond the end of the prefix are 0, the simplest choice.
  function Data(rand, prefix, size) {
    this.rand = rand;
    this.prefix = prefix || null;
    this.size = size;
    this.choices = [];
  }
  Data.prototype.choice = function (n, sampler) {
    if (this.choices.length >= MAX_CHOICES) throw new Overrun();
    var v;
    if (this.prefix) {
      var i = this.choices.length;
      v = i < this.prefix.length ? Math.min(this.prefix[i], n - 1) : 0;
    } else {
      v = sampler ? sampler(this.rand, n) : Math.floor(this.rand() * n);
    }
    this.choices.push(v);
    return v;
  };

  // Shortlex order: shorter is simpler; at equal length, the first smaller choice wins.
  function compare(a, b) {
    if (a.length !== b.length) return a.length - b.length;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  }

  // A mild bias towards the simplest choice, so zeros and empty things turn up early.
  function leanZero(r, n) { return r() < 0.12 ? 0 : Math.floor(r() * n); }

  // ------------------------------------------------------------------ generators
  // A generator is { draw(data) -> value }. Size grows over the run and only ever caps ranges
  // and average lengths; during shrinking it is held at the size of the failing run.
  var gen = {
    // Integers in [lo, hi]. Non-negative ranges draw one choice (value - lo). Ranges that span
    // zero draw the magnitude and then a sign, so 0 is the simplest integer, then 1, -1, 2, -2 ...
    // The sign is drawn even when the magnitude is 0 (and then ignored), so lowering a magnitude
    // to 0 never shifts the choices that follow: -1 can shrink straight to 0.
    int: function (lo, hi, scale) {
      scale = scale || function (s) { return s; };
      return {
        draw: function (d) {
          var cap = Math.max(0, Math.floor(scale(d.size)));
          if (lo >= 0) return lo + d.choice(Math.min(hi - lo, cap) + 1, leanZero);
          var mag = d.choice(Math.min(Math.max(-lo, hi), cap) + 1, leanZero);
          var negative = d.choice(2);
          if (mag === 0) return 0;
          var v = negative ? -mag : mag;
          return Math.max(lo, Math.min(hi, v));
        }
      };
    },
    // Lists: `min` elements unconditionally, then before each further element a yes/no choice
    // (1 = one more). Deleting a [1, element...] block from the sequence deletes the element.
    list: function (elem, opts) {
      var min = opts.min || 0, max = opts.max || 60, avg = opts.avg || function (s) { return s / 2; };
      return {
        draw: function (d) {
          var out = [], mean = Math.max(0.5, avg(d.size)), p = mean / (1 + mean);
          while (out.length < min) out.push(elem.draw(d));
          while (out.length < max) {
            if (!d.choice(2, function (r) { return r() < p ? 1 : 0; })) break;
            out.push(elem.draw(d));
          }
          return out;
        }
      };
    },
    // Strings over an alphabet. With `vary`, a run first picks how many letters of the alphabet
    // it may use (1 to all), so strings like "aaaaaaa" are common rather than astronomically rare.
    string: function (alphabet, opts) {
      opts = opts || {};
      return {
        draw: function (d) {
          var k = opts.vary ? 1 + d.choice(alphabet.length) : alphabet.length;
          var chars = gen.list({ draw: function (dd) { return alphabet[dd.choice(k)]; } }, opts).draw(d);
          return chars.join('');
        }
      };
    },
    record: function (fields) {
      var keys = Object.keys(fields);
      return {
        draw: function (d) {
          var out = {};
          keys.forEach(function (k) { out[k] = fields[k].draw(d); });
          return out;
        }
      };
    },
    map: function (g, f) {
      return { draw: function (d) { return f(g.draw(d), d); } };
    }
  };

  // Calendar dates as ISO strings, counted in days from an epoch (UTC, so no time zones).
  var EPOCH = Date.UTC(2024, 0, 1);
  function isoDay(offset) { return new Date(EPOCH + offset * 86400000).toISOString().slice(0, 10); }
  function dayOf(iso) { return Math.round((Date.parse(iso + 'T00:00:00Z') - EPOCH) / 86400000); }

  // ------------------------------------------------------------------ running a property
  var SKIP = { skip: true };

  // Size starts small and grows by one per input, as in QuickCheck, up to the cap.
  function sizeAt(i, maxSize) { return Math.min(maxSize, 1 + i); }

  function evaluate(prop, value, impl) {
    var r;
    try { r = prop.check(value, impl); }
    catch (e) { return { ok: false, threw: true, expected: prop.expects || 'no error', actual: 'throws “' + (e && e.message) + '”' }; }
    if (r === SKIP) return { skip: true };
    return r;
  }

  function replay(g, choices, size) {
    var d = new Data(null, choices, size);
    var value = g.draw(d);
    return { value: value, choices: d.choices };
  }

  // Generate up to `runs` inputs from one seed and test each. Stops at the first failure.
  function runProperty(spec, prop, impl, opts) {
    var runs = opts.runs || 1000, maxSize = opts.maxSize || spec.maxSize || 30;
    var r = rng(opts.seed == null ? 1 : opts.seed), inputs = [], discarded = 0;
    for (var i = 0; i < runs; i++) {
      var size = sizeAt(i, maxSize), d = new Data(r, null, size), value;
      try { value = spec.gen.draw(d); }
      catch (e) { if (e instanceof Overrun) continue; throw e; }
      var res = evaluate(prop, value, impl);
      if (res.skip) { discarded++; inputs.push({ value: value, outcome: 'skip' }); continue; }
      if (!res.ok) {
        inputs.push({ value: value, outcome: 'fail' });
        return {
          status: 'refuted', tried: i + 1, discarded: discarded, inputs: inputs,
          failure: { value: value, choices: d.choices, size: size, result: res }
        };
      }
      inputs.push({ value: value, outcome: 'pass' });
    }
    return { status: 'survived', tried: runs, discarded: discarded, inputs: inputs, failure: null };
  }

  // ------------------------------------------------------------------ shrinking
  // Three passes over the choice sequence, repeated until a whole sweep changes nothing:
  //   delete  remove a block of k consecutive choices (k = 8, 4, 3, 2, 1), right to left
  //   zero    set a block of k consecutive choices to 0
  //   lower   set one choice to 0, or binary-search the smallest value that still fails
  //           (this tries v >> 1 first and ends having tried v - 1)
  // Every accepted candidate is strictly shortlex-smaller and still fails, so this terminates.
  // When it stops inside the budget, no single delete, zero, halve or decrement of any choice
  // yields a smaller failing sequence: the result is locally minimal in that neighbourhood.
  var BLOCKS = [8, 4, 3, 2, 1];

  function shrink(spec, prop, impl, failure, opts) {
    opts = opts || {};
    var maxCalls = opts.maxCalls || 60000, size = failure.size;
    var start = replay(spec.gen, failure.choices, size);
    var cur = start.choices, curValue = start.value, curResult = failure.result;
    var steps = [], calls = 0;

    function attempt(seq, pass) {
      if (calls >= maxCalls) return false;
      var d = new Data(null, seq, size), v;
      try { v = spec.gen.draw(d); } catch (e) { if (e instanceof Overrun) return false; throw e; }
      if (compare(d.choices, cur) >= 0) return false;
      calls++;
      var res = evaluate(prop, v, impl);
      if (res.skip || res.ok) return false;
      cur = d.choices; curValue = v; curResult = res;
      steps.push({ value: v, choices: cur.slice(), pass: pass, result: res });
      return true;
    }

    function deletePass() {
      var any = false;
      BLOCKS.forEach(function (k) {
        var i = cur.length - k;
        while (i >= 0) {
          if (attempt(cur.slice(0, i).concat(cur.slice(i + k)), 'delete')) { any = true; i = Math.min(i, cur.length - k); }
          else i--;
        }
      });
      return any;
    }

    function zeroPass() {
      var any = false;
      BLOCKS.forEach(function (k) {
        for (var i = 0; i + k <= cur.length; i++) {
          var nonzero = false;
          for (var j = i; j < i + k; j++) if (cur[j]) { nonzero = true; break; }
          if (!nonzero) continue;
          var c = cur.slice();
          for (j = i; j < i + k; j++) c[j] = 0;
          if (attempt(c, 'zero')) any = true;
        }
      });
      return any;
    }

    function withAt(seq, i, v) { var c = seq.slice(); c[i] = v; return c; }

    function lowerPass() {
      var any = false;
      for (var i = 0; i < cur.length; i++) {
        var v = cur[i];
        if (!v) continue;
        if (attempt(withAt(cur, i, 0), 'lower')) { any = true; continue; }
        var lo = 0, hi = v;
        while (hi - lo > 1) {
          var mid = (lo + hi) >>> 1;
          if (attempt(withAt(cur, i, mid), 'lower')) {
            any = true;
            if (cur.length <= i || cur[i] !== mid) break;
            hi = mid;
          } else lo = mid;
        }
      }
      return any;
    }

    var sweeps = 0;
    while (calls < maxCalls) {
      sweeps++;
      var changed = deletePass();
      changed = zeroPass() || changed;
      changed = lowerPass() || changed;
      if (!changed) break;
    }
    return {
      value: curValue, choices: cur, result: curResult, steps: steps,
      calls: calls, sweeps: sweeps, complete: calls < maxCalls,
      original: { value: start.value, choices: start.choices }
    };
  }

  // One full experiment, as the page runs it.
  function experiment(fnId, propId, version, seed, runs) {
    var spec = byId(fnId), prop = propOf(spec, propId), impl = spec[version];
    var run = runProperty(spec, prop, impl, { seed: seed, runs: runs || 1000 });
    var shrunk = run.failure ? shrink(spec, prop, impl, run.failure) : null;
    return { spec: spec, prop: prop, version: version, seed: seed, run: run, shrunk: shrunk, examples: runExamples(spec, impl) };
  }

  function runExamples(spec, impl) {
    var results = spec.examples.map(function (ex) {
      var pass;
      try { pass = deepEqual(ex.run(impl), ex.want); } catch (e) { pass = false; }
      return { code: ex.code, pass: pass };
    });
    return { results: results, passed: results.filter(function (r) { return r.pass; }).length, total: results.length };
  }

  // The scoreboard's three lines, built only from engine results.
  function scoreboard(exp) {
    var ex = exp.examples, run = exp.run, sh = exp.shrunk;
    var lines = { examples: ex.passed + '/' + ex.total + ' passed' };
    if (run.status === 'refuted') {
      lines.property = 'refuted the code after ' + fmtInt(run.tried) + ' input' + (run.tried === 1 ? '' : 's');
      lines.shrink = sh.steps.length ? 'shrunk in ' + fmtInt(sh.steps.length) + ' step' + (sh.steps.length === 1 ? '' : 's') : 'already as small as it gets';
    } else {
      // Inputs skipped by a precondition were never tested, so they do not count as attempts.
      var tested = run.tried - run.discarded;
      lines.property = 'survived ' + fmtInt(tested) + ' attempt' + (tested === 1 ? '' : 's') + ' to refute it' +
        (run.discarded ? ' (' + fmtInt(run.discarded) + ' more skipped by the precondition)' : '');
      lines.shrink = 'nothing to shrink';
    }
    return lines;
  }

  function fmtInt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  // ------------------------------------------------------------------ helpers for properties
  function deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  function showStr(s) { return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'"; }
  function showVal(v) {
    if (typeof v === 'string') return showStr(v);
    if (Array.isArray(v)) return '[' + v.map(showVal).join(', ') + ']';
    if (v && typeof v === 'object') return '{ ' + Object.keys(v).map(function (k) { return k + ': ' + showVal(v[k]); }).join(', ') + ' }';
    return String(v);
  }
  function verdict(ok, expected, actual) { return { ok: !!ok, expected: expected, actual: actual }; }

  // ================================================================== the functions under test
  // Each is written as ordinary code. The page shows these exact functions (via toString), so
  // the code on screen is the code that runs.

  // ---------------------------------------------------------------- 1. dedupe
  var dedupeBuggy = function dedupe(items) {
    // Drop repeats, keeping the first copy of each value.
    return items.filter((item, i) => items.lastIndexOf(item) === i);
  };
  var dedupeFixed = function dedupe(items) {
    // Drop repeats, keeping the first copy of each value.
    return items.filter((item, i) => items.indexOf(item) === i);
  };
  function dedupeRef(xs) {
    var seen = {}, out = [];
    xs.forEach(function (x) { if (!seen[x]) { seen[x] = true; out.push(x); } });
    return out;
  }

  // ---------------------------------------------------------------- 2. run-length encoding
  var encodeShared = function encode(text) {
    let out = '';
    for (let i = 0; i < text.length; ) {
      let run = 1;
      while (text[i + run] === text[i]) run++;
      out += run + text[i];
      i += run;
    }
    return out;
  };
  var decodeBuggy = function decode(code) {
    return code.replace(/(\d)(\D)/g, (_, count, ch) => ch.repeat(Number(count)));
  };
  var decodeFixed = function decode(code) {
    return code.replace(/(\d+)(\D)/g, (_, count, ch) => ch.repeat(Number(count)));
  };

  // ---------------------------------------------------------------- 3. date-range overlap
  var overlapsBuggy = function overlaps(a, b) {
    // Each range includes both its start and end dates, e.g.
    // { start: '2024-03-01', end: '2024-03-05' } is five days.
    return a.start < b.end && b.start < a.end;
  };
  var overlapsFixed = function overlaps(a, b) {
    // Each range includes both its start and end dates, e.g.
    // { start: '2024-03-01', end: '2024-03-05' } is five days.
    return a.start <= b.end && b.start <= a.end;
  };
  function overlapsRef(a, b) {
    for (var d = dayOf(a.start); d <= dayOf(a.end); d++) {
      if (d >= dayOf(b.start) && d <= dayOf(b.end)) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- 4. splitting a bill
  var splitBuggy = function splitAmount(cents, n) {
    // Split a bill of `cents` into n shares as evenly as possible.
    const share = Math.round(cents / n);
    return Array.from({ length: n }, () => share);
  };
  var splitFixed = function splitAmount(cents, n) {
    // Split a bill of `cents` into n shares as evenly as possible.
    const share = Math.floor(cents / n);
    const extra = cents - share * n;   // cents left over, one each to the first few shares
    return Array.from({ length: n }, (_, i) => share + (i < extra ? 1 : 0));
  };

  // ---------------------------------------------------------------- 5. binary search
  var searchBuggy = function firstIndexOf(sorted, target) {
    // Index of the first copy of target in a sorted array, or -1.
    let lo = 0, hi = sorted.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] === target) return mid;
      if (sorted[mid] < target) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  };
  var searchFixed = function firstIndexOf(sorted, target) {
    // Index of the first copy of target in a sorted array, or -1.
    let lo = 0, hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return sorted[lo] === target ? lo : -1;
  };

  // ---------------------------------------------------------------- 6. CSV quoting
  var quoteBuggy = function quote(field) {
    // Fields with a comma or a quote mark must be wrapped in quotes.
    if (/[",]/.test(field)) return '"' + field + '"';
    return field;
  };
  var quoteFixed = function quote(field) {
    // Fields with a comma or a quote mark must be wrapped in quotes,
    // and a quote mark inside a field is written twice.
    if (/[",]/.test(field)) return '"' + field.replace(/"/g, '""') + '"';
    return field;
  };
  function makeFormatRow(q) {
    return function formatRow(fields) { return fields.map(q).join(','); };
  }
  var formatRowSource = 'function formatRow(fields) {\n  return fields.map(quote).join(\',\');\n}';

  // A strict parser for one CSV record (RFC 4180 rules, no line breaks). Not under test.
  function parseRow(line) {
    var fields = [], i = 0, n = line.length;
    for (;;) {
      var f = '';
      if (line[i] === '"') {
        i++;
        for (;;) {
          if (i >= n) throw new Error('unclosed quote');
          if (line[i] === '"') {
            if (line[i + 1] === '"') { f += '"'; i += 2; } else { i++; break; }
          } else f += line[i++];
        }
        if (i < n && line[i] !== ',') throw new Error('text after a closing quote');
      } else {
        while (i < n && line[i] !== ',') {
          if (line[i] === '"') throw new Error('stray quote');
          f += line[i++];
        }
      }
      fields.push(f);
      if (i >= n) return fields;
      i++;
    }
  }

  // ------------------------------------------------------------------ display helpers
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function shortDate(iso) { return MONTHS[+iso.slice(5, 7) - 1] + ' ' + (+iso.slice(8, 10)); }
  function showRange(r) {
    if (r.start === r.end) return shortDate(r.start);
    var s = shortDate(r.start), e = shortDate(r.end);
    if (s.slice(0, 3) === e.slice(0, 3)) e = e.slice(4);
    return s + '–' + e;
  }
  function money(c) { return '$' + Math.floor(c / 100) + '.' + ('0' + (c % 100)).slice(-2); }

  // ================================================================== specs
  // strength: 'strong' properties can refute the buggy version; 'weak' ones cannot, by design,
  // and `why` says what they miss. The tests check both claims.
  var SPECS = [
    {
      id: 'dedupe',
      tab: 'dedupe',
      file: 'dedupe.js',
      buggy: { dedupe: dedupeBuggy },
      fixed: { dedupe: dedupeFixed },
      source: function (impl) { return [impl.dedupe]; },
      bugMarker: 'lastIndexOf',
      inputs: 'Lists of small integers, longer as the run goes on.',
      gen: gen.list(gen.int(-9, 9, function (s) { return Math.min(9, 1 + s / 3); }), { avg: function (s) { return s / 3; }, max: 40 }),
      show: showVal,
      examples: [
        { code: 'dedupe([1, 1, 2, 3, 3])', want: [1, 2, 3], run: function (m) { return m.dedupe([1, 1, 2, 3, 3]); } },
        { code: 'dedupe([7, 7, 7])', want: [7], run: function (m) { return m.dedupe([7, 7, 7]); } },
        { code: 'dedupe([4, 9, 2])', want: [4, 9, 2], run: function (m) { return m.dedupe([4, 9, 2]); } },
        { code: 'dedupe([])', want: [], run: function (m) { return m.dedupe([]); } }
      ],
      properties: [
        {
          id: 'nodup', strength: 'weak', label: 'No value appears twice in the output',
          code: 'new Set(out).size === out.length',
          why: 'True of the buggy version too: it does remove repeats. It just keeps the wrong copy, and this property never looks at order.',
          check: function (xs, m) {
            var out = m.dedupe(xs);
            return verdict(new Set(out).size === out.length, 'no repeats', showVal(out));
          }
        },
        {
          id: 'same', strength: 'weak', label: 'Every input value is still there',
          code: 'xs.every(x => out.includes(x))',
          why: 'Also true of the buggy version. Keeping the right values is not the same as keeping them in the right order.',
          check: function (xs, m) {
            var out = m.dedupe(xs);
            return verdict(xs.every(function (x) { return out.indexOf(x) >= 0; }), 'all of ' + showVal(xs), showVal(out));
          }
        },
        {
          id: 'ref', strength: 'strong', label: 'Matches a plain loop that keeps first copies',
          code: 'deepEqual(out, keepFirstCopies(xs))',
          why: 'A slow, obviously correct reference pins down the whole answer, order included.',
          check: function (xs, m) {
            var out = m.dedupe(xs), want = dedupeRef(xs);
            return verdict(deepEqual(out, want), showVal(want), showVal(out));
          }
        }
      ]
    },
    {
      id: 'rle',
      tab: 'run-length',
      file: 'rle.js',
      buggy: { encode: encodeShared, decode: decodeBuggy },
      fixed: { encode: encodeShared, decode: decodeFixed },
      source: function (impl) { return [impl.encode, impl.decode]; },
      bugMarker: '/(\\d)(\\D)/g',
      inputs: 'Strings of the letters a to d. Some runs use only one letter.',
      gen: gen.string(['a', 'b', 'c', 'd'], { vary: true, avg: function (s) { return s / 1.5; }, max: 60 }),
      show: showStr,
      examples: [
        { code: "encode('aaabcc')", want: '3a1b2c', run: function (m) { return m.encode('aaabcc'); } },
        { code: "decode('3a1b2c')", want: 'aaabcc', run: function (m) { return m.decode('3a1b2c'); } },
        { code: "decode(encode('banana'))", want: 'banana', run: function (m) { return m.decode(m.encode('banana')); } },
        { code: "encode('')", want: '', run: function (m) { return m.encode(''); } }
      ],
      properties: [
        {
          id: 'short', strength: 'weak', label: 'Encoding is never more than twice as long',
          code: 'encode(s).length <= 2 * s.length',
          why: 'True, and it only tests encode. The bug is in decode, which this property never calls.',
          check: function (s, m) {
            var e = m.encode(s);
            return verdict(e.length <= 2 * s.length, 'at most ' + 2 * s.length + ' characters', e.length + ' (' + showStr(e) + ')');
          }
        },
        {
          id: 'letters', strength: 'weak', label: 'Every letter in the encoding comes from the input',
          code: 'lettersOf(encode(s)) ⊆ lettersOf(s)',
          why: 'Again only encode is tested. A property can be true and still never touch the code that is wrong.',
          check: function (s, m) {
            var e = m.encode(s), bad = e.replace(/\d/g, '').split('').filter(function (c) { return s.indexOf(c) < 0; });
            return verdict(bad.length === 0, 'letters from ' + showStr(s), showStr(e));
          }
        },
        {
          id: 'round', strength: 'strong', label: 'Decoding the encoding gives back the input',
          code: 'decode(encode(s)) === s',
          why: 'A round trip ties the two halves together, so a fault in either one shows.',
          check: function (s, m) {
            var back = m.decode(m.encode(s));
            return verdict(back === s, showStr(s), showStr(back));
          }
        }
      ]
    },
    {
      id: 'overlap',
      tab: 'date overlap',
      file: 'overlaps.js',
      buggy: { overlaps: overlapsBuggy },
      fixed: { overlaps: overlapsFixed },
      source: function (impl) { return [impl.overlaps]; },
      bugMarker: 'a.start < b.end',
      inputs: 'Pairs of date ranges in 2024, from one day to a few weeks long.',
      gen: (function () {
        var range = gen.map(gen.record({
          start: gen.int(0, 365, function (s) { return Math.min(365, 12 + 4 * s); }),
          days: gen.int(0, 30, function (s) { return Math.min(30, 1 + s); })
        }), function (r) { return { start: isoDay(r.start), end: isoDay(r.start + r.days) }; });
        return gen.record({ a: range, b: range });
      })(),
      show: function (v) { return showRange(v.a) + ' · ' + showRange(v.b); },
      examples: [
        { code: "overlaps(Mar 1–10, Mar 5–15)", want: true, run: function (m) { return m.overlaps({ start: '2024-03-01', end: '2024-03-10' }, { start: '2024-03-05', end: '2024-03-15' }); } },
        { code: "overlaps(Mar 1–5, Mar 10–15)", want: false, run: function (m) { return m.overlaps({ start: '2024-03-01', end: '2024-03-05' }, { start: '2024-03-10', end: '2024-03-15' }); } },
        { code: "overlaps(Mar 1–31, Mar 10–12)", want: true, run: function (m) { return m.overlaps({ start: '2024-03-01', end: '2024-03-31' }, { start: '2024-03-10', end: '2024-03-12' }); } },
        { code: "overlaps(Apr 1–3, Mar 1–10)", want: false, run: function (m) { return m.overlaps({ start: '2024-04-01', end: '2024-04-03' }, { start: '2024-03-01', end: '2024-03-10' }); } }
      ],
      properties: [
        {
          id: 'sym', strength: 'weak', label: 'Order does not matter',
          code: 'overlaps(a, b) === overlaps(b, a)',
          why: 'The buggy test is symmetric too: it is wrong the same way in both directions.',
          check: function (v, m) {
            var x = m.overlaps(v.a, v.b), y = m.overlaps(v.b, v.a);
            return verdict(x === y, 'the same both ways', x + ' one way, ' + y + ' the other');
          }
        },
        {
          id: 'gap', strength: 'weak', label: 'Ranges with a day between them never overlap',
          code: 'a.end < dayBefore(b.start) ⇒ !overlaps(a, b)',
          why: 'This only checks that apart means apart. The bug is the other way round: it misses ranges that share exactly one day.',
          check: function (v, m) {
            var a = v.a, b = v.b, apart = dayOf(a.end) + 1 < dayOf(b.start) || dayOf(b.end) + 1 < dayOf(a.start);
            if (!apart) return SKIP;
            var got = m.overlaps(a, b);
            return verdict(!got, 'false', String(got));
          }
        },
        {
          id: 'self', strength: 'strong', label: 'Every range overlaps itself',
          code: 'overlaps(a, a) === true',
          why: 'Simple, and enough: a one-day range fails it.',
          check: function (v, m) {
            var got = m.overlaps(v.a, v.a);
            return verdict(got === true, 'true for ' + showRange(v.a), String(got));
          }
        },
        {
          id: 'ref', strength: 'strong', label: 'Agrees with checking day by day',
          code: 'overlaps(a, b) === someDayIsInBoth(a, b)',
          why: 'A slow reference that walks the calendar. Slow does not matter in a test.',
          check: function (v, m) {
            var got = m.overlaps(v.a, v.b), want = overlapsRef(v.a, v.b);
            return verdict(got === want, String(want), String(got));
          }
        }
      ]
    },
    {
      id: 'split',
      tab: 'split a bill',
      file: 'split.js',
      buggy: { splitAmount: splitBuggy },
      fixed: { splitAmount: splitFixed },
      source: function (impl) { return [impl.splitAmount]; },
      bugMarker: 'Math.round',
      inputs: 'Amounts from $0.00 upward, split among 1 to 12 people.',
      gen: gen.record({
        cents: gen.int(0, 100000, function (s) { return 4 * s * s; }),
        n: gen.int(1, 12, function (s) { return Math.min(11, s / 2); })
      }),
      show: function (v) { return money(v.cents) + ' ÷ ' + v.n; },
      examples: [
        { code: 'splitAmount(900, 3)', want: [300, 300, 300], run: function (m) { return m.splitAmount(900, 3); } },
        { code: 'splitAmount(1000, 4)', want: [250, 250, 250, 250], run: function (m) { return m.splitAmount(1000, 4); } },
        { code: 'splitAmount(0, 2)', want: [0, 0], run: function (m) { return m.splitAmount(0, 2); } },
        { code: 'splitAmount(4999, 1)', want: [4999], run: function (m) { return m.splitAmount(4999, 1); } }
      ],
      properties: [
        {
          id: 'count', strength: 'weak', label: 'There are n shares',
          code: 'splitAmount(c, n).length === n',
          why: 'Always true here. It checks the shape of the answer, not the money.',
          check: function (v, m) {
            var out = m.splitAmount(v.cents, v.n);
            return verdict(out.length === v.n, v.n + ' shares', out.length + ' shares');
          }
        },
        {
          id: 'fair', strength: 'weak', label: 'No two shares differ by more than one cent',
          code: 'max(parts) - min(parts) <= 1',
          why: 'Easy to pass by giving everyone the same rounded amount, which is exactly the bug.',
          check: function (v, m) {
            var out = m.splitAmount(v.cents, v.n);
            var spread = Math.max.apply(null, out) - Math.min.apply(null, out);
            return verdict(spread <= 1, 'at most 1¢ apart', spread + '¢ apart');
          }
        },
        {
          id: 'sum', strength: 'strong', label: 'The shares add up to the bill',
          code: 'sum(splitAmount(c, n)) === c',
          why: 'The one thing a bill splitter must never get wrong, stated directly.',
          check: function (v, m) {
            var out = m.splitAmount(v.cents, v.n), total = out.reduce(function (a, b) { return a + b; }, 0);
            return verdict(total === v.cents, money(v.cents), money(total) + ' from ' + showVal(out));
          }
        }
      ]
    },
    {
      id: 'search',
      tab: 'binary search',
      file: 'search.js',
      buggy: { firstIndexOf: searchBuggy },
      fixed: { firstIndexOf: searchFixed },
      source: function (impl) { return [impl.firstIndexOf]; },
      bugMarker: 'return mid',
      inputs: 'Sorted lists of small integers, often with repeats, and a target that is usually in the list.',
      gen: gen.map(gen.record({
        xs: gen.list(gen.int(-9, 9, function (s) { return Math.min(9, 1 + s / 4); }), { avg: function (s) { return s / 2.5; }, max: 40 }),
        pick: gen.int(0, 1),
        any: gen.int(-9, 9, function (s) { return Math.min(9, 1 + s / 4); }),
        at: gen.int(0, 39, function () { return 39; })
      }), function (r) {
        var sorted = r.xs.slice().sort(function (a, b) { return a - b; });
        var target = (r.pick === 0 && sorted.length) ? sorted[r.at % sorted.length] : r.any;
        return { sorted: sorted, target: target };
      }),
      show: function (v) { return v.target + ' in ' + showVal(v.sorted); },
      examples: [
        { code: 'firstIndexOf([1, 3, 5, 7, 9], 7)', want: 3, run: function (m) { return m.firstIndexOf([1, 3, 5, 7, 9], 7); } },
        { code: 'firstIndexOf([1, 3, 5, 7, 9], 4)', want: -1, run: function (m) { return m.firstIndexOf([1, 3, 5, 7, 9], 4); } },
        { code: 'firstIndexOf([2, 4, 6, 8], 2)', want: 0, run: function (m) { return m.firstIndexOf([2, 4, 6, 8], 2); } },
        { code: 'firstIndexOf([], 1)', want: -1, run: function (m) { return m.firstIndexOf([], 1); } }
      ],
      properties: [
        {
          id: 'hit', strength: 'weak', label: 'Whatever index it returns holds the target',
          code: 'i === -1 || sorted[i] === target',
          why: 'True: every index it returns does hold the target. It is just not always the first one.',
          check: function (v, m) {
            var i = m.firstIndexOf(v.sorted, v.target);
            return verdict(i === -1 || v.sorted[i] === v.target, 'sorted[i] === ' + v.target, 'i = ' + i);
          }
        },
        {
          id: 'found', strength: 'weak', label: 'It returns −1 only when the target is missing',
          code: '(i === -1) === !sorted.includes(target)',
          why: 'Also true. Binary search always finds some copy; this cannot tell which.',
          check: function (v, m) {
            var i = m.firstIndexOf(v.sorted, v.target), present = v.sorted.indexOf(v.target) >= 0;
            return verdict((i === -1) === !present, present ? 'an index' : '-1', String(i));
          }
        },
        {
          id: 'first', strength: 'strong', label: 'It agrees with a linear scan',
          code: 'firstIndexOf(sorted, t) === sorted.indexOf(t)',
          why: 'indexOf is slow but plainly right, and it returns the first copy.',
          check: function (v, m) {
            var i = m.firstIndexOf(v.sorted, v.target), want = v.sorted.indexOf(v.target);
            return verdict(i === want, String(want), String(i));
          }
        }
      ]
    },
    {
      id: 'csv',
      tab: 'CSV quoting',
      file: 'csv.js',
      buggy: { quote: quoteBuggy, formatRow: makeFormatRow(quoteBuggy) },
      fixed: { quote: quoteFixed, formatRow: makeFormatRow(quoteFixed) },
      source: function (impl) { return [impl.quote, formatRowSource]; },
      bugMarker: "'\"' + field + '\"'",
      inputs: 'Rows of one or more short fields made of a, b, spaces, commas and quote marks.',
      gen: gen.list(gen.string(['a', 'b', ' ', ',', '"'], { avg: function (s) { return Math.min(4, s / 4); }, max: 12 }), { min: 1, avg: function (s) { return Math.min(4, s / 6); }, max: 8 }),
      show: showVal,
      examples: [
        { code: "formatRow(['a', 'b', 'c'])", want: 'a,b,c', run: function (m) { return m.formatRow(['a', 'b', 'c']); } },
        { code: "formatRow(['Smith, J', '42'])", want: '"Smith, J",42', run: function (m) { return m.formatRow(['Smith, J', '42']); } },
        { code: "parseRow(formatRow(['name', 'city, country']))", want: ['name', 'city, country'], run: function (m) { return parseRow(m.formatRow(['name', 'city, country'])); } },
        { code: "formatRow(['', 'x'])", want: ',x', run: function (m) { return m.formatRow(['', 'x']); } }
      ],
      properties: [
        {
          id: 'plain', strength: 'weak', label: 'Round trip, for rows with no quote marks',
          code: 'hasQuote(row) || parseRow(formatRow(row)) equals row',
          why: 'The precondition throws away exactly the inputs that would have failed. Look at how many were skipped.',
          check: function (row, m) {
            if (row.some(function (f) { return f.indexOf('"') >= 0; })) return SKIP;
            var back = parseRow(m.formatRow(row));
            return verdict(deepEqual(back, row), showVal(row), showVal(back));
          }
        },
        {
          id: 'len', strength: 'weak', label: 'The output is at least as long as the fields',
          code: "formatRow(row).length >= row.join('').length",
          why: 'True of almost any formatter. It says nothing about whether the text can be read back.',
          check: function (row, m) {
            var out = m.formatRow(row), n = row.join('').length;
            return verdict(out.length >= n, 'at least ' + n + ' characters', out.length + ' characters');
          }
        },
        {
          id: 'round', strength: 'strong', label: 'Parsing the output gives back the row',
          code: 'parseRow(formatRow(row)) equals row',
          expects: 'the same row back',
          why: 'The round trip is the contract of a CSV writer: whatever it writes, a reader must recover.',
          check: function (row, m) {
            var line = m.formatRow(row), back = parseRow(line);
            return verdict(deepEqual(back, row), showVal(row), showVal(back) + ' from ' + line);
          }
        }
      ]
    }
  ];

  function byId(id) { for (var i = 0; i < SPECS.length; i++) if (SPECS[i].id === id) return SPECS[i]; throw new Error('no function ' + id); }
  function propOf(spec, id) { for (var i = 0; i < spec.properties.length; i++) if (spec.properties[i].id === id) return spec.properties[i]; throw new Error('no property ' + id); }

  // Source text of a version, dedented, plus the 0-based line that carries the bug (or -1).
  function sourceOf(spec, version) {
    var parts = spec.source(spec[version]).map(function (f) {
      var text = (typeof f === 'string' ? f : f.toString()).replace(/\r/g, '');
      var lines = text.split('\n'), last = lines[lines.length - 1], pad = last.length - last.replace(/^\s+/, '').length;
      return lines.map(function (l, i) { return i === 0 ? l : l.slice(Math.min(pad, l.length - l.replace(/^\s+/, '').length)); }).join('\n');
    });
    var text = parts.join('\n\n'), lines = text.split('\n'), bugLine = -1;
    if (version === 'buggy') {
      for (var i = 0; i < lines.length; i++) if (lines[i].indexOf(spec.bugMarker) >= 0) { bugLine = i; break; }
    }
    return { text: text, lines: lines, bugLine: bugLine };
  }

  // The card preview replays real runs of these seeds (strongest property, buggy version).
  // They were chosen so each demo has a stream worth watching and a few shrink steps; the tests
  // check that each one still meets PREVIEW_RULE, so the preview stays honest engine output.
  var PREVIEW = [
    { fn: 'dedupe', seed: 4 }, { fn: 'search', seed: 19 }, { fn: 'split', seed: 36 },
    { fn: 'rle', seed: 11 }, { fn: 'csv', seed: 274 }
  ];
  var PREVIEW_RULE = { minInputs: 10, maxInputs: 40, minSteps: 4, maxSteps: 9 };
  function strongest(spec) {
    var strong = spec.properties.filter(function (p) { return p.strength === 'strong'; });
    return strong[strong.length - 1];
  }

  var api = {
    rng: rng, Data: Data, compare: compare, gen: gen, SKIP: SKIP, BLOCKS: BLOCKS,
    sizeAt: sizeAt, replay: replay, evaluate: evaluate,
    runProperty: runProperty, shrink: shrink, experiment: experiment, runExamples: runExamples,
    scoreboard: scoreboard, fmtInt: fmtInt,
    specs: SPECS, byId: byId, propOf: propOf, sourceOf: sourceOf,
    parseRow: parseRow, isoDay: isoDay, dayOf: dayOf, showVal: showVal, RUNS: 1000,
    PREVIEW: PREVIEW, PREVIEW_RULE: PREVIEW_RULE, strongest: strongest
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Whittle = api;
})(typeof window !== 'undefined' ? window : this);
