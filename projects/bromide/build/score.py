#!/usr/bin/env python3
"""Bromide reference scorer.

The tokenizer, the model reader and the scorer here are the reference that
model.js must match. build_model.py loads this file for its tokenizer, so the
model is trained and scored with exactly the same rules.

Usage (reads JSON {"sentences": [...]} on stdin, writes bits per token):
    python -I score.py <model.bin> < sentences.json

Model file layout (little-endian):
    "BRMD"  u32 version  u32 headerLen  header JSON (utf-8)
    u32 vocabLen  vocabulary, one word per line (utf-8)
    V x u16       unigram, round(-log2 p * 1024); 0xFFFF = probability 0
    bigrams:  V varints n(v) | sum(n) varints word-id deltas | sum(n) bytes q
              | one byte g for each v with n(v) > 0
    trigrams: u32 C | C varints context-key deltas | C varints n | deltas | q
              | C bytes g
A stored value q means a = 2^(-q/10), rounded to the nearest tenth of a bit.
Each context also stores its own back-off weight gamma (the Kneser-Ney
weight, plus the share of any pruned entries) as g, a logit on a grid of an
eighth of a bit: gamma = 2^L / (1 + 2^L), L = g/8 - 16. At load, that
context's stored a values are scaled so that they sum to exactly 1 - gamma.
So every distribution sums to one, and neither gamma nor 1 - gamma is off by
more than 1/16 of a bit, however much was pruned or rounded (the build drops
any context whose weight would fall off the grid, and fails if one is below
it). The build writes the largest error rounding can cause in any probability
into the header as quant.bound; tests/exact.test.js checks it.
"""
import json
import math
import re
import struct
import sys
import unicodedata

ABBREV = frozenset('mr mrs dr st ms messrs prof rev capt col gen lt esq mme mlle'.split())
PUNCT = frozenset(['.', '!', '?', ',', ';', ':'])
ENDS = frozenset(['.', '!', '?'])
_MARKS = re.compile('[̀-ͯ]')
_APOS = re.compile('[‘’ʼ′]')
_PARA = re.compile('\n[ \t\r]*\n')
_TOKEN = re.compile(r"[A-Za-z0-9]+(?:'[A-Za-z0-9]+)*|[.!?,;:]")

UNK, END, START = 0, 1, 2
MAGIC = b'BRMD'
VERSION = 2
QA = 10.0        # a-values are stored as round(-log2(a) * QA) in one byte
QG = 8.0         # back-off weights are stored as round((log2(g / (1 - g)) + GOFF) * QG)
GOFF = 16.0
Q1 = 1024.0      # unigram values are stored as round(-log2(p) * Q1) in two bytes
Q1_ZERO = 0xFFFF


def normalise(text):
    """NFKD, drop combining accents, straighten apostrophes. Case is kept."""
    t = unicodedata.normalize('NFKD', text)
    t = _MARKS.sub('', t)
    return _APOS.sub("'", t)


def spans(text):
    """Return (normalised text, sentences of (token, start, end)).

    Paragraphs are separated by blank lines. A sentence ends after . ! ? or at
    the end of a paragraph. A full stop after Mr, Mrs, Dr and the like is
    dropped. Punctuation at the start of a sentence is dropped.
    """
    t = normalise(text)
    out = []
    pos = 0
    paras = []
    for m in _PARA.finditer(t):
        paras.append((pos, m.start()))
        pos = m.end()
    paras.append((pos, len(t)))
    for a, b in paras:
        cur = []
        for m in _TOKEN.finditer(t, a, b):
            tok = m.group(0).lower()
            if tok in PUNCT:
                if not cur:
                    continue
                if tok == '.' and cur[-1][0] in ABBREV:
                    continue
                cur.append((tok, m.start(), m.end()))
                if tok in ENDS:
                    out.append(cur)
                    cur = []
            else:
                cur.append((tok, m.start(), m.end()))
        if cur:
            out.append(cur)
    return t, out


def sentences(text):
    """Sentences of lowercase tokens (words and , ; : . ! ?)."""
    return [[x[0] for x in s] for s in spans(text)[1]]


def gamma_value(g):
    """Back-off weight for a stored byte g."""
    x = 2.0 ** (g / QG - GOFF)
    return x / (1.0 + x)


def read_varint(buf, pos):
    result = 0
    shift = 0
    while True:
        b = buf[pos]
        pos += 1
        result |= (b & 0x7F) << shift
        if b < 0x80:
            return result, pos
        shift += 7


def read_varints(buf, pos, n):
    out = [0] * n
    for i in range(n):
        out[i], pos = read_varint(buf, pos)
    return out, pos


class Model:
    def __init__(self, data):
        if data[:4] != MAGIC:
            raise ValueError('not a Bromide model')
        pos = 4
        version, hlen = struct.unpack_from('<II', data, pos)
        if version != VERSION:
            raise ValueError('unknown model version %d' % version)
        pos += 8
        self.header = json.loads(data[pos:pos + hlen].decode('utf-8'))
        pos += hlen
        (vlen,) = struct.unpack_from('<I', data, pos)
        pos += 4
        self.vocab = data[pos:pos + vlen].decode('utf-8').split('\n')
        pos += vlen
        V = self.V = len(self.vocab)
        self.index = {w: i for i, w in enumerate(self.vocab)}
        self.atable = [2.0 ** (-q / QA) for q in range(256)]
        self.gtable = [gamma_value(g) for g in range(256)]

        raw = []
        for i in range(V):
            (q,) = struct.unpack_from('<H', data, pos)
            pos += 2
            raw.append(0.0 if q == Q1_ZERO else 2.0 ** (-q / Q1))
        z = 0.0
        for r in raw:
            z += r
        self.p1 = [r / z for r in raw]

        ns, pos = read_varints(data, pos, V)
        deltas, pos = read_varints(data, pos, sum(ns))
        qs = data[pos:pos + len(deltas)]
        pos += len(deltas)
        n_ctx = sum(1 for n in ns if n)
        gs = data[pos:pos + n_ctx]
        pos += n_ctx
        self.bi = [None] * V
        self.b2 = [1.0] * V
        e = 0
        k = 0
        for v in range(V):
            n = ns[v]
            if n == 0:
                continue
            gamma = self.gtable[gs[k]]
            k += 1
            self.bi[v] = self._group(deltas, qs, e, n, gamma)
            e += n
            self.b2[v] = gamma

        (c3,) = struct.unpack_from('<I', data, pos)
        pos += 4
        kd, pos = read_varints(data, pos, c3)
        ns, pos = read_varints(data, pos, c3)
        deltas, pos = read_varints(data, pos, sum(ns))
        qs = data[pos:pos + len(deltas)]
        pos += len(deltas)
        gs = data[pos:pos + c3]
        pos += c3
        self.tri = {}
        key = 0
        e = 0
        for c in range(c3):
            key = kd[c] if c == 0 else key + kd[c]
            gamma = self.gtable[gs[c]]
            self.tri[key] = (self._group(deltas, qs, e, ns[c], gamma), gamma)
            e += ns[c]
        if pos != len(data):
            raise ValueError('trailing bytes in model')

    def _group(self, deltas, qs, e, n, gamma):
        """One context's entries {word: a}, scaled so they sum to 1 - gamma."""
        s = 0.0
        for k in range(n):
            s += self.atable[qs[e + k]]
        scale = (1.0 - gamma) / s
        d = {}
        w = 0
        for k in range(n):
            w = deltas[e + k] if k == 0 else w + deltas[e + k]
            d[w] = self.atable[qs[e + k]] * scale
        return d

    def word_id(self, tok):
        return self.index.get(tok, UNK)

    def prob(self, u, v, w):
        p = self.p1[w]
        d = self.bi[v]
        if d is not None:
            p = d.get(w, 0.0) + self.b2[v] * p
        t = self.tri.get(u * self.V + v)
        if t is not None:
            p = t[0].get(w, 0.0) + t[1] * p
        return p

    def score_sentence(self, toks):
        """Bits for each token of one sentence. OOV tokens score as <unk>."""
        u, v = START, START
        out = []
        for tok in toks:
            w = self.word_id(tok)
            p = self.prob(u, v, w)
            out.append({'tok': tok, 'id': w, 'oov': w == UNK, 'bits': -math.log2(p)})
            u, v = v, w
        return out

    def score_text(self, text):
        return [self.score_sentence(s) for s in sentences(text)]


def main(argv):
    if len(argv) != 2:
        sys.stderr.write(__doc__)
        return 2
    with open(argv[1], 'rb') as f:
        model = Model(f.read())
    req = json.loads(sys.stdin.buffer.read().decode('utf-8'))
    out = {'results': [model.score_text(s) for s in req['sentences']]}
    if req.get('tokenize'):
        out['tokens'] = [sentences(s) for s in req['sentences']]
    json.dump(out, sys.stdout)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
