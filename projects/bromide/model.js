// Bromide model: tokenizer, model reader and scorer.
// Mirrors build/score.py exactly; tests/reference.test.js checks that they agree.
// Works in the browser (window.Bromide) and in Node (module.exports).
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Bromide = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var UNK = 0, END = 1, START = 2;
  var QA = 10, QG = 8, GOFF = 16, Q1 = 1024, Q1_ZERO = 0xFFFF, VERSION = 2;
  var ABBREV = {};
  'mr mrs dr st ms messrs prof rev capt col gen lt esq mme mlle'.split(' ').forEach(function (w) { ABBREV[w] = true; });
  var PUNCT = { '.': true, '!': true, '?': true, ',': true, ';': true, ':': true };
  var ENDS = { '.': true, '!': true, '?': true };

  function normalise(text) {
    return String(text).normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[‘’ʼ′]/g, "'");
  }

  // Returns {text: normalised text, sentences: [[{tok, start, end, punct}]]}.
  // Same rules as score.py: paragraphs split on blank lines; a sentence ends
  // after . ! ? or at the end of a paragraph; "." after Mr, Mrs, Dr ... is
  // dropped; punctuation at the start of a sentence is dropped.
  function spans(text) {
    var t = normalise(text);
    var paras = [];
    var re = /\n[ \t\r]*\n/g;
    var pos = 0, m;
    while ((m = re.exec(t)) !== null) {
      paras.push([pos, m.index]);
      pos = m.index + m[0].length;
    }
    paras.push([pos, t.length]);
    var out = [];
    for (var p = 0; p < paras.length; p++) {
      var a = paras[p][0];
      var seg = t.slice(a, paras[p][1]);
      var tr = /[A-Za-z0-9]+(?:'[A-Za-z0-9]+)*|[.!?,;:]/g;
      var cur = [];
      while ((m = tr.exec(seg)) !== null) {
        var tok = m[0].toLowerCase();
        var item = { tok: tok, start: a + m.index, end: a + m.index + m[0].length, punct: !!PUNCT[tok] };
        if (item.punct) {
          if (!cur.length) continue;
          if (tok === '.' && ABBREV[cur[cur.length - 1].tok]) continue;
          cur.push(item);
          if (ENDS[tok]) { out.push(cur); cur = []; }
        } else {
          cur.push(item);
        }
      }
      if (cur.length) out.push(cur);
    }
    return { text: t, sentences: out };
  }

  function sentences(text) {
    return spans(text).sentences.map(function (s) { return s.map(function (x) { return x.tok; }); });
  }

  // ---- model file -------------------------------------------------------

  function Reader(bytes) { this.b = bytes; this.pos = 0; }
  Reader.prototype.u32 = function () {
    var b = this.b, p = this.pos;
    this.pos += 4;
    return (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16)) + b[p + 3] * 16777216;
  };
  Reader.prototype.varint = function () {
    var b = this.b, result = 0, mul = 1, byte;
    do {
      byte = b[this.pos++];
      result += (byte & 0x7F) * mul;
      mul *= 128;
    } while (byte >= 0x80);
    return result;
  };

  function utf8(bytes) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length).toString('utf8');
  }

  // Back-off weight for a stored byte g (see build/score.py).
  function gammaValue(g) {
    var x = Math.pow(2, g / QG - GOFF);
    return x / (1 + x);
  }

  // Reads one order's grouped entries: ns[i] entries per group, word-id deltas,
  // q bytes, then one g byte per non-empty group. Returns, per group, the
  // back-off weight b and the scale that makes its stored values sum to 1 - b.
  function readGroups(r, ns, nGroups, atable, gtable) {
    var start = new Uint32Array(nGroups + 1);
    var total = 0;
    for (var i = 0; i < nGroups; i++) { start[i] = total; total += ns[i]; }
    start[nGroups] = total;
    var w = new Uint16Array(total);
    for (i = 0; i < nGroups; i++) {
      var id = 0;
      for (var e = start[i]; e < start[i + 1]; e++) {
        var d = r.varint();
        id = e === start[i] ? d : id + d;
        w[e] = id;
      }
    }
    var q = r.b.slice(r.pos, r.pos + total);
    r.pos += total;
    var b = new Float64Array(nGroups), scale = new Float64Array(nGroups);
    for (i = 0; i < nGroups; i++) {
      if (start[i + 1] === start[i]) { b[i] = 1; continue; }
      var gamma = gtable[r.b[r.pos++]];
      var s = 0;
      for (e = start[i]; e < start[i + 1]; e++) s += atable[q[e]];
      b[i] = gamma;
      scale[i] = (1 - gamma) / s;
    }
    return { start: start, w: w, q: q, b: b, scale: scale };
  }

  function Model(buffer) {
    var bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== 'BRMD') throw new Error('not a Bromide model');
    var r = new Reader(bytes);
    r.pos = 4;
    var version = r.u32();
    if (version !== VERSION) throw new Error('unknown model version ' + version);
    var hlen = r.u32();
    this.header = JSON.parse(utf8(bytes.subarray(r.pos, r.pos + hlen)));
    r.pos += hlen;
    var vlen = r.u32();
    this.vocab = utf8(bytes.subarray(r.pos, r.pos + vlen)).split('\n');
    r.pos += vlen;
    var V = this.V = this.vocab.length;
    this.index = new Map();
    for (var i = 0; i < V; i++) this.index.set(this.vocab[i], i);

    var atable = this.atable = new Float64Array(256);
    var gtable = new Float64Array(256);
    for (i = 0; i < 256; i++) {
      atable[i] = Math.pow(2, -i / QA);
      gtable[i] = gammaValue(i);
    }

    var raw = new Float64Array(V);
    var z = 0;
    for (i = 0; i < V; i++) {
      var q = bytes[r.pos] | (bytes[r.pos + 1] << 8);
      r.pos += 2;
      raw[i] = q === Q1_ZERO ? 0 : Math.pow(2, -q / Q1);
    }
    for (i = 0; i < V; i++) z += raw[i];
    this.p1 = new Float64Array(V);
    for (i = 0; i < V; i++) this.p1[i] = raw[i] / z;

    var ns = new Uint32Array(V);
    for (i = 0; i < V; i++) ns[i] = r.varint();
    this.bi = readGroups(r, ns, V, atable, gtable);

    var C = r.u32();
    var keys = new Float64Array(C);
    var key = 0;
    for (i = 0; i < C; i++) { var d = r.varint(); key = i === 0 ? d : key + d; keys[i] = key; }
    var ns3 = new Uint32Array(C);
    for (i = 0; i < C; i++) ns3[i] = r.varint();
    this.tri = readGroups(r, ns3, C, atable, gtable);
    this.tri.keys = keys;
    if (r.pos !== bytes.length) throw new Error('trailing bytes in model');
  }

  function search(arr, lo, hi, x) {
    while (lo < hi) {
      var mid = (lo + hi) >>> 1;
      var v = arr[mid];
      if (v === x) return mid;
      if (v < x) lo = mid + 1; else hi = mid;
    }
    return -1;
  }

  Model.prototype.wordId = function (tok) {
    var id = this.index.get(tok);
    return id === undefined || id === START ? UNK : id;
  };

  Model.prototype.context = function (u, v) {
    var keys = this.tri.keys;
    return search(keys, 0, keys.length, u * this.V + v);
  };

  // p(w | u v) under interpolated Kneser-Ney with the shipped (pruned, quantised) values.
  Model.prototype.prob = function (u, v, w) {
    var p = this.p1[w];
    var bi = this.bi, s = bi.start[v], e = bi.start[v + 1];
    if (e > s) {
      var j = search(bi.w, s, e, w);
      p = (j >= 0 ? this.atable[bi.q[j]] * bi.scale[v] : 0) + bi.b[v] * p;
    }
    var c = this.context(u, v);
    if (c >= 0) {
      var tri = this.tri;
      var k = search(tri.w, tri.start[c], tri.start[c + 1], w);
      p = (k >= 0 ? this.atable[tri.q[k]] * tri.scale[c] : 0) + tri.b[c] * p;
    }
    return p;
  };

  // The whole next-word distribution for context (u, v), as a Float64Array over ids.
  Model.prototype.distribution = function (u, v, out) {
    var V = this.V, i, e;
    var dist = out || new Float64Array(V);
    dist.set(this.p1);
    var bi = this.bi, s = bi.start[v], t = bi.start[v + 1];
    if (t > s) {
      var b2 = bi.b[v], s2 = bi.scale[v];
      for (i = 0; i < V; i++) dist[i] = b2 * dist[i];
      for (e = s; e < t; e++) dist[bi.w[e]] = this.atable[bi.q[e]] * s2 + dist[bi.w[e]];
    }
    var c = this.context(u, v);
    if (c >= 0) {
      var tri = this.tri, b3 = tri.b[c], s3 = tri.scale[c];
      for (i = 0; i < V; i++) dist[i] = b3 * dist[i];
      for (e = tri.start[c]; e < tri.start[c + 1]; e++) dist[tri.w[e]] = this.atable[tri.q[e]] * s3 + dist[tri.w[e]];
    }
    return dist;
  };

  Model.prototype.top = function (dist, k) {
    var best = [];
    for (var i = 0; i < dist.length; i++) {
      var p = dist[i];
      if (best.length < k || p > best[best.length - 1].p) {
        var j = best.length < k ? best.length : k - 1;
        while (j > 0 && best[j - 1].p < p) { best[j] = best[j - 1]; j--; }
        best[j] = { id: i, word: this.vocab[i], p: p };
      }
    }
    return best;
  };

  // Rank of word w in dist: 1 + number of tokens strictly more probable.
  Model.prototype.rank = function (dist, w) {
    var pw = dist[w], n = 1;
    for (var i = 0; i < dist.length; i++) if (dist[i] > pw) n++;
    return n;
  };

  // Score text. Every token gets bits; words the model does not know are
  // flagged oov and left out of the average (their bits are those of <unk>,
  // the bucket for all rare words, and are never shown as the word's score).
  Model.prototype.score = function (text) {
    var sp = spans(text);
    var known = 0, unknown = 0, total = 0;
    for (var si = 0; si < sp.sentences.length; si++) {
      var u = START, v = START;
      var sent = sp.sentences[si];
      for (var ti = 0; ti < sent.length; ti++) {
        var x = sent[ti];
        var w = this.wordId(x.tok);
        x.id = w;
        x.u = u;
        x.v = v;
        x.oov = w === UNK;
        x.bits = -Math.log2(this.prob(u, v, w));
        if (!x.punct) {
          if (x.oov) unknown++;
          else { known++; total += x.bits; }
        }
        u = v;
        v = w;
      }
    }
    sp.known = known;
    sp.unknown = unknown;
    sp.avgBits = known ? total / known : null;
    return sp;
  };

  // Lines the books contain (header.memory, measured by the build). Given the
  // visitor's tokens, return { probe, whole } for the first probe the text is
  // (whole) or opens with (not whole), ignoring final punctuation; else null.
  function trimPunct(toks) {
    var t = toks.slice();
    while (t.length && /^[.,;:!?]$/.test(t[t.length - 1])) t.pop();
    return t;
  }
  function matchLine(tokens, probes) {
    var toks = trimPunct(tokens);
    for (var i = 0; i < (probes || []).length; i++) {
      var pt = trimPunct([].concat.apply([], sentences(probes[i].text)));
      if (!probes[i].times_in_books || !pt.length || toks.length < pt.length) continue;
      if (pt.every(function (t, k) { return toks[k] === t; })) return { probe: probes[i], whole: toks.length === pt.length };
    }
    return null;
  }

  // What reading a line once did for the model. It "recites" the line only
  // when the line scores well under half an ordinary held-out sentence's bits
  // per word and most of its runs of three survived pruning; otherwise reading
  // it only made it less surprising (gain = bits saved per word).
  function memoryVerdict(probe, heldBits) {
    var gain = probe.unread_bits - probe.bits;
    var recites = probe.bits < heldBits / 2 && probe.trigrams > 0 && probe.trigrams_kept >= 0.75 * probe.trigrams;
    return {
      gain: gain,
      recites: recites,
      kind: recites ? 'recites' : gain >= 0.25 ? 'helped' : 'unchanged',
      aboveOrdinary: probe.bits > heldBits
    };
  }

  return {
    UNK: UNK, END: END, START: START,
    normalise: normalise,
    spans: spans,
    sentences: sentences,
    matchLine: matchLine,
    memoryVerdict: memoryVerdict,
    Model: Model,
    load: function (buffer) { return new Model(buffer); }
  };
});
