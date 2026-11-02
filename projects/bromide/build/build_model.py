#!/usr/bin/env python3
"""Build Bromide's trigram model from a folder of Project Gutenberg texts.

    python -I projects/bromide/build/build_model.py <corpus-dir> <out-dir>

Reads <corpus-dir>/manifest.json (written by fetch.py) when present, otherwise
every *.txt file. Strips the Project Gutenberg header, footer and licence,
tokenises with the rules in score.py, holds out one sentence in a hundred,
counts trigrams on the rest and estimates interpolated modified Kneser-Ney
probabilities (Chen & Goodman 1998). Low counts are pruned until the model
fits the size budget; pruned probability mass goes to the back-off weight.
Each context stores its back-off weight, and its stored values are scaled at
load to fill exactly the rest, so every distribution still sums to one.

Writes to <out-dir>: model.bin, books.json, preview.js.
Options: --vocab=N (default 40000), --budget=BYTES (default 3900000),
--prune=K2,K3 (keep bigrams seen in at least K2 contexts and trigrams seen at
least K3 times, instead of searching for the least pruning that fits).

The header records, besides the corpus figures:
  quant    the largest error, in bits, that rounding adds at each level, and
           `bound`, the most any shipped probability can differ from the same
           pruned model without rounding (checked by tests/exact.test.js);
  memory   famous openings of books in the corpus, scored by the shipped model,
           by exact Kneser-Ney with nothing pruned, and by exact Kneser-Ney
           trained without them, so the page can say how much of a line the
           books contain the shipped model actually remembers.
"""
import importlib.util
import json
import math
import os
import re
import struct
import sys

import numpy as np

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location('bromide_score', os.path.join(HERE, 'score.py'))
S = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(S)

PUNCT_ORDER = ['.', ',', ';', ':', '!', '?']
HOLDOUT_EVERY = 100
HOLDOUT_AT = 37

# Preview sentences: my own writing, one tired and one fresh.
PREVIEW = [
    {'label': 'tired', 'text': 'It was a cold and dark night, and the wind blew through the trees.'},
    {'label': 'fresh', 'text': 'The kettle ticked as it cooled, like a clock losing its nerve.'},
]

# Famous openings of books in the corpus, to see how much of a line read once
# survives pruning. All of them go into the header; the page shows a probe's
# figures when the visitor writes that line.
MEMORY_PROBES = [
    'It is a truth universally acknowledged, that a single man in possession of a good fortune must be in want of a wife.',
    'It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness.',
    'Call me Ishmael.',
]

START_RE = re.compile(r'^[ \t]*\*\*\*[ \t]*START OF (?:THE|THIS) PROJECT GUTENBERG[^\n]*$', re.I | re.M)
END_RE = re.compile(r'^[ \t]*(?:\*\*\*[ \t]*END OF (?:THE|THIS) PROJECT GUTENBERG|End of (?:the )?Project Gutenberg)', re.I | re.M)
TITLE_RE = re.compile(r'^Title:[ \t]*(.+)$', re.M)
AUTHOR_RE = re.compile(r'^Author:[ \t]*(.+)$', re.M)
ID_RE = re.compile(r'\[E(?:Book|text) #(\d+)\]', re.I)
ILLUS_RE = re.compile(r'\[(?:Illustration|Footnote)[^\]]*\]', re.I)
FRONT_RE = re.compile(r'produced by|transcriber|e-?text|proofread|distributed proof|http|www\.|scanned|edition|copyright', re.I)


def strip_gutenberg(raw):
    """Return (body, meta) or (None, reason)."""
    text = raw.replace('\r\n', '\n').replace('\r', '\n').replace('\ufeff', '')
    m = START_RE.search(text)
    if not m:
        return None, 'no START marker'
    head = text[:m.start()]
    body = text[m.end():]
    e = END_RE.search(body)
    if not e:
        return None, 'no END marker'
    body = body[:e.start()]
    meta = {}
    t = TITLE_RE.search(head)
    a = AUTHOR_RE.search(head)
    i = ID_RE.search(head)
    if t:
        meta['title'] = t.group(1).strip()
    if a:
        meta['author'] = a.group(1).strip()
    if i:
        meta['id'] = int(i.group(1))
    body = ILLUS_RE.sub(' ', body)
    paras = re.split(r'\n[ \t]*\n', body)
    kept = []
    for k, p in enumerate(paras):
        if 'gutenberg' in p.lower():
            continue
        if k < 12 and FRONT_RE.search(p):
            continue
        kept.append(p)
    return '\n\n'.join(drop_front_lists(kept)), meta


# Tables of contents and lists of illustrations are not prose. A heading such
# as "Contents" near the front starts a list; it runs while each paragraph
# reads like headings (chapter numbers, title-case names) and ends at the first
# paragraph of ordinary prose. List lines that end in a page number ("Heading
# to Chapter I.      1") are dropped wherever they occur in the front matter.
LIST_HEAD_RE = re.compile(r'(?:table of )?contents\.?|herein is written|(?:list of )?illustrations\.?|page', re.I)
PAGE_ENTRY_RE = re.compile(r'\S[ \t]{3,}(?:[ivxlcdm]+|\d+)\.?[ \t]*$', re.I)
HEADING_LINE_RE = re.compile(r'(?:chapter|book|part|stave|volume|letter)\b|[ivxlc]+\.(?:\s|$)', re.I)
LIST_WORD_RE = re.compile(r"[^\W\d_][^\W\d_'’-]*")


def heading_line(line):
    line = line.strip()
    if HEADING_LINE_RE.match(line) and len(line) < 90:
        return True
    words = LIST_WORD_RE.findall(line)
    low = sum(w[0].islower() for w in words)
    return low < 6 and low <= 0.5 * len(words)


def list_paragraph(p):
    lines = [l for l in p.split('\n') if l.strip()]
    return sum(heading_line(l) for l in lines) >= 0.8 * len(lines)


def drop_front_lists(paras):
    out, in_list, n = [], False, 0
    for p in paras:
        s = p.strip()
        if not s:
            continue
        n += 1
        lines = [l for l in s.split('\n') if l.strip()]
        if n <= 600 and all(PAGE_ENTRY_RE.search(l) for l in lines):
            continue
        if in_list:
            if list_paragraph(s):
                continue
            in_list = False
        if n <= 60 and LIST_HEAD_RE.fullmatch(s):
            in_list = True
            continue
        out.append(p)
    return out


def load_corpus(corpus_dir):
    manifest_path = os.path.join(corpus_dir, 'manifest.json')
    mirror = None
    if os.path.exists(manifest_path):
        with open(manifest_path, encoding='utf-8') as f:
            manifest = json.load(f)
        entries = manifest['books']
        mirror = manifest.get('mirror')
    else:
        entries = [{'file': n} for n in sorted(os.listdir(corpus_dir)) if n.endswith('.txt')]
    books = []
    for ent in entries:
        path = os.path.join(corpus_dir, os.path.basename(ent['file']))
        with open(path, 'rb') as f:
            raw = f.read().decode('utf-8', errors='replace')
        body, meta = strip_gutenberg(raw)
        if body is None:
            print('  skip %s: %s' % (ent['file'], meta), file=sys.stderr)
            continue
        info = {
            'id': ent.get('id', meta.get('id')),
            'title': ent.get('title') or meta.get('title', os.path.basename(path)),
            'author': ent.get('author') or meta.get('author', 'Unknown'),
        }
        books.append((info, body))
    return books, mirror


def discounts(counts):
    """Modified Kneser-Ney discounts D1, D2, D3+ from counts of counts."""
    n = [int(np.count_nonzero(counts == k)) for k in (1, 2, 3, 4)]
    default = (0.5, 1.0, 1.5)
    if min(n) == 0:
        return default
    y = n[0] / (n[0] + 2.0 * n[1])
    d = (1 - 2 * y * n[1] / n[0], 2 - 3 * y * n[2] / n[1], 3 - 4 * y * n[3] / n[2])
    return tuple(d[k] if 0 < d[k] < k + 1 else default[k] for k in range(3))


def interpolated_a(keys, counts, V, D):
    """For keys = h * V + w (sorted): a(h, w) = (c(h, w) - D(c)) / c(h), and the
    back-off weight gamma(h) = sum of D over h's entries / c(h), per entry."""
    ctx = keys // V
    _, inv = np.unique(ctx, return_inverse=True)
    denom = np.bincount(inv, weights=counts.astype(np.float64))
    d = np.where(counts == 1, D[0], np.where(counts == 2, D[1], D[2]))
    dsum = np.bincount(inv, weights=d)
    return (counts - d) / denom[inv], dsum[inv] / denom[inv]


def quantise_a(a):
    """round(-log2(a) * QA); values over 255 do not fit a byte and are pruned."""
    with np.errstate(divide='ignore'):
        q = np.round(-np.log2(a) * S.QA)
    return q


def gamma_index(gamma, rest):
    """Unclipped grid index of back-off weight gamma (with rest = 1 - gamma)."""
    L = np.log2(gamma) - np.log2(rest)
    return np.round((L + S.GOFF) * S.QG)


def quantise_gamma(gamma, rest):
    """Back-off weight gamma (with rest = 1 - gamma) as a byte on a logit grid.
    clip_contexts() has already removed every context that would fall off the
    top of the grid and failed the build for any below it, so the clip here
    never changes a value (quant_errors would show it if it did)."""
    return np.clip(gamma_index(gamma, rest), 0, 255).astype(np.uint8)


def quant_errors(qq, inv, a_kept, gamma, rest, g):
    """Largest |log2(shipped / unrounded)| for the back-off weights, for their
    complements, and for the kept values once scaled to fill the complement."""
    x = 2.0 ** (g.astype(np.float64) / S.QG - S.GOFF)
    gq = x / (1.0 + x)
    rq = 1.0 / (1.0 + x)
    aq = 2.0 ** (-qq.astype(np.float64) / S.QA)
    s = np.bincount(inv, weights=aq, minlength=gamma.size)
    stored = aq * (rq / s)[inv]

    def err(p, q):
        return float(np.max(np.abs(np.log2(p) - np.log2(q)))) if p.size else 0.0
    return {'gamma': err(gq, gamma), 'rest': err(rq, rest), 'a': err(stored, a_kept)}


def clip_contexts(keys, a, V, keep):
    """Drop every entry of a context whose stored back-off weight would fall off
    the top of the byte grid (its kept entries carry under about 2^-16 of the
    mass). That context then backs off with weight one: a change to at most
    2^-16 of its probability mass. The header counts such contexts, and the
    tests require there to be none in the shipped model.
    Returns (keep, contexts dropped, contexts below the grid); the build fails
    if any context's weight is below the grid (gamma under about 2^-16)."""
    ctx = keys // V
    uctx, inv = np.unique(ctx[keep], return_inverse=True)
    kept_sum = np.bincount(inv, weights=a[keep], minlength=uctx.size)
    gamma = 1.0 - kept_sum
    with np.errstate(divide='ignore', invalid='ignore'):
        gi = gamma_index(np.maximum(gamma, 1e-300), np.maximum(kept_sum, 1e-300))
    high = uctx[gi > 255]
    low = int(np.count_nonzero(gi < 0))
    if high.size:
        keep = keep & ~np.isin(ctx, high)
    return keep, int(high.size), low


def varint_len(x):
    x = np.asarray(x, dtype=np.uint64)
    n = np.ones(x.shape, dtype=np.int64)
    for k in range(1, 10):
        n += x >= np.uint64(1 << (7 * k))
    return n


def varint_bytes(x):
    x = np.asarray(x, dtype=np.uint64)
    if x.size == 0:
        return b''
    nb = varint_len(x)
    res = np.empty(int(nb.sum()), dtype=np.uint8)
    starts = np.concatenate([[0], np.cumsum(nb)[:-1]])
    for k in range(int(nb.max())):
        sel = nb > k
        byte = (x[sel] >> np.uint64(7 * k)) & np.uint64(0x7F)
        more = (nb[sel] > k + 1).astype(np.uint64) << np.uint64(7)
        res[starts[sel] + k] = (byte | more).astype(np.uint8)
    return res.tobytes()


def group_deltas(ctx, w):
    """Word-id deltas within each context group (first entry absolute)."""
    if w.size == 0:
        return w
    first = np.ones(w.shape, dtype=bool)
    first[1:] = ctx[1:] != ctx[:-1]
    prev = np.concatenate([[0], w[:-1]])
    return np.where(first, w, w - prev)


def section(keys, q, a, gamma_all, V, keep, n_contexts=None):
    """Encode one order; keys = context * V + word, sorted.

    a holds the exact interpolated values and gamma_all the exact back-off
    weight of each entry's context. A context's stored back-off weight is its
    exact weight plus the exact values of its pruned entries, so its kept
    entries carry exactly the rest.
    Returns (bytes, number of entries, number of contexts, rounding errors)."""
    k = keys[keep]
    qq = q[keep].astype(np.uint8)
    ctx = k // V
    w = k % V
    dw = group_deltas(ctx, w)
    uctx, first, inv, ns = np.unique(ctx, return_index=True, return_inverse=True, return_counts=True)
    kept_sum = np.bincount(inv, weights=a[keep], minlength=uctx.size)
    # gamma = 1 - kept_sum, computed as the exact weight plus the pruned values
    # of contexts that keep at least one entry (no cancellation when gamma is tiny).
    pk, pa = keys[~keep] // V, a[~keep]
    pos = np.searchsorted(uctx, pk)
    hit = pos < uctx.size
    hit[hit] = uctx[pos[hit]] == pk[hit]
    pruned_sum = np.bincount(pos[hit], weights=pa[hit], minlength=uctx.size)
    gamma = gamma_all[keep][first] + pruned_sum
    g = quantise_gamma(gamma, kept_sum)
    stats = quant_errors(qq, inv, a[keep], gamma, kept_sum, g)
    if n_contexts is not None:     # bigrams: one count per context id 0..V-1
        ns_all = np.bincount(ctx, minlength=n_contexts)
        out = varint_bytes(ns_all) + varint_bytes(dw) + qq.tobytes() + g.tobytes()
        return out, int(k.size), int(uctx.size), stats
    kd = np.concatenate([uctx[:1], np.diff(uctx)]) if uctx.size else uctx
    out = (struct.pack('<I', uctx.size) + varint_bytes(kd) + varint_bytes(ns) + varint_bytes(dw) +
           qq.tobytes() + g.tobytes())
    return out, int(k.size), int(uctx.size), stats


def estimate(train, index, V):
    """Counts and unrounded interpolated modified Kneser-Ney values for the
    training sentences, as sorted arrays (keys = context * V + word)."""
    seq = []
    for s in train:
        seq.append(S.START)
        seq.append(S.START)
        seq.extend(index.get(t, S.UNK) for t in s)
        seq.append(S.END)
    ids = np.array(seq, dtype=np.int64)
    u, v, w = ids[:-2], ids[1:-1], ids[2:]
    ok = w != S.START
    key3 = ((u[ok] * V + v[ok]) * V + w[ok])
    keys3, c3 = np.unique(key3, return_counts=True)
    keys2, cc2 = np.unique(keys3 % (V * V), return_counts=True)
    cc1 = np.bincount(keys2 % V, minlength=V).astype(np.float64)

    D3 = discounts(c3)
    D2 = discounts(cc2)
    D1 = discounts(cc1[cc1 > 0].astype(np.int64))

    # Unigram: continuation counts, discounted, interpolated with a uniform
    # distribution over every token except <s>.
    d1 = np.where(cc1 == 0, 0.0, np.where(cc1 == 1, D1[0], np.where(cc1 == 2, D1[1], D1[2])))
    T = cc1.sum()
    p1 = (cc1 - d1) / T + (d1.sum() / T) / (V - 1)
    p1[S.START] = 0.0

    a3, g3 = interpolated_a(keys3, c3, V, D3)
    a2, g2 = interpolated_a(keys2, cc2, V, D2)
    return {'keys3': keys3, 'c3': c3, 'keys2': keys2, 'cc2': cc2, 'p1': p1, 'a3': a3, 'g3': g3,
            'a2': a2, 'g2': g2, 'D3': D3, 'D2': D2, 'D1': D1, 'tokens': int(ids.size)}


def probe_tokens(line):
    """The probe's tokens without its final full stop, to match it as a prefix
    of the sentence in the book (a probe may stop before the book's sentence does)."""
    toks = [t for s in S.sentences(line) for t in s]
    return toks[:-1] if toks and toks[-1] in S.ENDS else toks


class ExactKN:
    """Interpolated modified Kneser-Ney with nothing pruned and nothing rounded,
    straight from the build's arrays. Used only for figures in the header."""

    def __init__(self, est, V):
        self.k2, self.a2, self.g2 = est['keys2'], est['a2'], est['g2']
        self.k3, self.a3, self.g3, self.p1, self.V = est['keys3'], est['a3'], est['g3'], est['p1'], V

    @staticmethod
    def _level(keys, a, g, ctx, w, V, lower):
        lo = int(np.searchsorted(keys, ctx * V))
        if lo >= keys.size or keys[lo] // V != ctx:
            return lower
        i = int(np.searchsorted(keys, ctx * V + w))
        hit = i < keys.size and keys[i] == ctx * V + w
        return (float(a[i]) if hit else 0.0) + float(g[lo]) * lower

    def prob(self, u, v, w):
        p = float(self.p1[w])
        p = self._level(self.k2, self.a2, self.g2, v, w, self.V, p)
        return self._level(self.k3, self.a3, self.g3, u * self.V + v, w, self.V, p)

    def score(self, toks, index):
        u, v = S.START, S.START
        out = []
        for t in toks:
            w = index.get(t, S.UNK)
            out.append(-math.log2(self.prob(u, v, w)))
            u, v = v, w
        return out

    def trigram_count(self, u, v, w, keys3, c3):
        key = (u * self.V + v) * self.V + w
        i = int(np.searchsorted(keys3, key))
        return int(c3[i]) if i < keys3.size and keys3[i] == key else 0


def encode(header, vocab, q1, sec2, sec3):
    hb = json.dumps(header, separators=(',', ':'), sort_keys=True).encode('utf-8')
    vb = '\n'.join(vocab).encode('utf-8')
    return (S.MAGIC + struct.pack('<II', S.VERSION, len(hb)) + hb +
            struct.pack('<I', len(vb)) + vb + q1.astype('<u2').tobytes() + sec2 + sec3)


def main(argv):
    args = [a for a in argv[1:] if not a.startswith('--')]
    opts = dict((a[2:].split('=', 1) + [''])[:2] for a in argv[1:] if a.startswith('--'))
    if len(args) != 2:
        sys.stderr.write(__doc__)
        return 2
    corpus_dir, out_dir = args
    vocab_cap = int(opts.get('vocab', 40000))
    budget = int(opts.get('budget', 3900000))
    os.makedirs(out_dir, exist_ok=True)

    books, mirror = load_corpus(corpus_dir)
    if not books:
        print('no usable books in %s' % corpus_dir, file=sys.stderr)
        return 1
    print('%d books' % len(books))

    train, held = [], []
    book_rows = []
    idx = 0
    for info, body in books:
        sents = S.sentences(body)
        words = 0
        for s in sents:
            words += sum(1 for t in s if t not in S.PUNCT)
            (held if idx % HOLDOUT_EVERY == HOLDOUT_AT else train).append(s)
            idx += 1
        row = dict(info)
        row['words'] = words
        book_rows.append(row)
    print('%d training sentences, %d held out' % (len(train), len(held)))

    freq = {}
    for s in train:
        for t in s:
            if t not in S.PUNCT:
                freq[t] = freq.get(t, 0) + 1
    ranked = sorted((w for w, c in freq.items() if c >= 2), key=lambda w: (-freq[w], w))
    specials = ['<unk>', '</s>', '<s>']
    vocab = specials + PUNCT_ORDER + ranked[:vocab_cap]
    V = len(vocab)
    assert V < 65536
    index = {w: i for i, w in enumerate(vocab)}
    word_tokens = sum(freq.values())
    covered = sum(freq[w] for w in ranked[:vocab_cap])
    print('vocabulary %d (covers %.2f%% of word tokens)' % (V, 100.0 * covered / word_tokens))

    est = estimate(train, index, V)
    keys3, c3, keys2, cc2, p1, a3, g3, a2, g2 = (est[k] for k in ('keys3', 'c3', 'keys2', 'cc2', 'p1',
                                                                  'a3', 'g3', 'a2', 'g2'))
    D3, D2, D1 = est['D3'], est['D2'], est['D1']
    print('%d distinct trigrams, %d distinct bigrams' % (keys3.size, keys2.size))
    with np.errstate(divide='ignore'):
        q1 = np.where(p1 > 0, np.minimum(np.round(-np.log2(p1) * S.Q1), S.Q1_ZERO - 1), S.Q1_ZERO)
    q3 = quantise_a(a3)
    q2 = quantise_a(a2)

    fixed = 12 + 2500 + 4 + len('\n'.join(vocab).encode('utf-8')) + 2 * V
    steps = [(1, 1), (1, 2), (2, 2), (2, 3), (3, 3), (3, 4), (4, 4), (4, 5), (5, 6), (6, 7), (7, 8),
             (8, 10), (10, 12), (12, 15), (15, 20), (20, 25), (25, 30), (30, 40), (40, 50)]
    if 'prune' in opts:
        steps = [tuple(int(x) for x in opts['prune'].split(','))]
    chosen = None
    for k2, k3 in steps:
        keep2, clip2, low2 = clip_contexts(keys2, a2, V, (cc2 >= k2) & (q2 <= 255))
        keep3, clip3, low3 = clip_contexts(keys3, a3, V, (c3 >= k3) & (q3 <= 255))
        if low2 or low3:
            print('%d contexts have a back-off weight below the grid' % (low2 + low3), file=sys.stderr)
            return 1
        sec2, e2, n2, st2 = section(keys2, q2, a2, g2, V, keep2, n_contexts=V)
        sec3, e3, n3, st3 = section(keys3, q3, a3, g3, V, keep3)
        size = fixed + len(sec2) + len(sec3)
        print('  keep bigrams in >= %d contexts, trigrams seen >= %d times: %d + %d entries, ~%d bytes'
              % (k2, k3, e2, e3, size))
        if size <= budget or 'prune' in opts:
            chosen = (k2, k3, sec2, sec3, e2, e3, n3, st2, st3, clip2 + clip3)
            break
    if chosen is None:
        print('could not meet the size budget', file=sys.stderr)
        return 1
    k2, k3, sec2, sec3, e2, e3, n3, st2, st3, clipped = chosen

    # Rounding error. Each level mixes its own values with its back-off weight
    # times the level below, so a level is off by at most the larger of its
    # values' error and its weight's error plus the error of the level below.
    p1q = np.where(q1 == S.Q1_ZERO, 0.0, 2.0 ** (-q1 / S.Q1))
    p1q = p1q / p1q.sum()
    nz = p1 > 0
    e1 = float(np.max(np.abs(np.log2(p1q[nz]) - np.log2(p1[nz]))))
    b2 = max(st2['a'], st2['gamma'] + e1, e1)
    b3 = max(st3['a'], st3['gamma'] + b2, b2)
    quant = {'unigram': e1, 'bigram': st2, 'trigram': st3, 'bound': b3, 'contexts_dropped_off_grid': clipped}
    print('rounding: unigram %.4f; bigram a %.4f, gamma %.4f, rest %.4f; trigram a %.4f, gamma %.4f, rest %.4f; '
          'bound %.4f bits; %d contexts dropped off the grid' %
          (e1, st2['a'], st2['gamma'], st2['rest'], st3['a'], st3['gamma'], st3['rest'], b3, clipped))
    exact = ExactKN(est, V)
    # The same model without the probe lines: what the books would predict had
    # they never contained them. Every training sentence that begins with a
    # probe line is left out; the vocabulary stays the same.
    probes = [probe_tokens(line) for line in MEMORY_PROBES]
    removed = [0] * len(probes)
    train_wo = []
    for s in train:
        hit = [i for i, pt in enumerate(probes) if pt and s[:len(pt)] == pt]
        for i in hit:
            removed[i] += 1
        if not hit:
            train_wo.append(s)
    unread = ExactKN(estimate(train_wo, index, V), V)
    del train_wo

    header = {
        'order': 3,
        'V': V,
        'qa': S.QA,
        'qg': S.QG,
        'q1': S.Q1,
        'discounts': {'trigram': D3, 'bigram': D2, 'unigram': D1},
        'prune': {'bigram_min': k2, 'trigram_min': k3},
        'quant': quant,
        'entries': {'bigram': e2, 'trigram': e3, 'trigram_contexts': n3},
        'corpus': {'books': len(books), 'train_sentences': len(train), 'heldout_sentences': len(held),
                   'train_tokens': est['tokens'], 'word_tokens': int(word_tokens),
                   'distinct_words': len(freq), 'coverage': covered / word_tokens},
    }
    data = encode(header, vocab, q1, sec2, sec3)

    # Held-out evaluation with the model exactly as it will be shipped.
    model = S.Model(data)
    bits, ebits, words, oov = 0.0, 0.0, 0, 0
    for s in held:
        for r, e in zip(model.score_sentence(s), exact.score(s, index)):
            if r['tok'] in S.PUNCT:
                continue
            if r['oov']:
                oov += 1
                continue
            bits += r['bits']
            ebits += e
            words += 1
    header['heldout'] = {'bits_per_word': bits / words if words else None, 'words': words, 'unknown': oov,
                         'unpruned_bits_per_word': ebits / words if words else None}
    print('held-out: %.3f bits per known word over %d words (%d unknown); unpruned exact KN %.3f' %
          (header['heldout']['bits_per_word'] or 0, words, oov, header['heldout']['unpruned_bits_per_word'] or 0))

    # Lines the books contain once: how much of each survives pruning.
    memory = []
    for line, nrem in zip(MEMORY_PROBES, removed):
        shipped, unpruned, never, n, runs, kept_runs, seen_runs = 0.0, 0.0, 0.0, 0, 0, 0, 0
        for s in S.sentences(line):
            u, v = S.START, S.START
            for t, r, e, f in zip(s, model.score_sentence(s), exact.score(s, index), unread.score(s, index)):
                w = index.get(t, S.UNK)
                if t not in S.PUNCT and w != S.UNK:
                    shipped += r['bits']
                    unpruned += e
                    never += f
                    n += 1
                c = exact.trigram_count(u, v, w, keys3, c3)
                runs += 1
                seen_runs += c >= 1
                kept_runs += c >= k3
                u, v = v, w
        n = max(n, 1)
        memory.append({'text': line, 'times_in_books': nrem, 'bits': shipped / n, 'unpruned_bits': unpruned / n,
                       'unread_bits': never / n, 'trigrams': runs, 'trigrams_seen': int(seen_runs),
                       'trigrams_kept': int(kept_runs)})
        print('memory probe (in the books %d times): shipped %.2f, unpruned %.2f, never read %.2f bits per word; '
              'trigrams %d, seen %d, kept %d  %s' %
              (nrem, shipped / n, unpruned / n, never / n, runs, seen_runs, kept_runs, line[:40]))
    header['memory'] = memory
    data = encode(header, vocab, q1, sec2, sec3)
    model = S.Model(data)
    with open(os.path.join(out_dir, 'model.bin'), 'wb') as f:
        f.write(data)
    print('model.bin: %d bytes' % len(data))

    with open(os.path.join(out_dir, 'books.json'), 'w', encoding='utf-8') as f:
        json.dump({'books': book_rows, 'source': 'Project Gutenberg (www.gutenberg.org)',
                   'mirror': mirror}, f, indent=1, ensure_ascii=False)

    preview = []
    for p in PREVIEW:
        text, sents = S.spans(p['text'])
        toks = [x for s in sents for x in s]
        scored = [r for s in sents for r in model.score_sentence([x[0] for x in s])]
        items, total, n = [], 0.0, 0
        last = 0
        for (tok, a, b), r in zip(toks, scored):
            item = {'t': text[a:b], 'pre': text[last:a]}
            last = b
            if tok in S.PUNCT:
                item['punct'] = True
            elif r['oov']:
                item['oov'] = True
            else:
                item['bits'] = round(r['bits'], 2)
                total += r['bits']
                n += 1
            items.append(item)
        preview.append({'label': p['label'], 'words': items, 'avg': round(total / n, 2) if n else None})
    with open(os.path.join(out_dir, 'preview.js'), 'w', encoding='utf-8') as f:
        f.write('// Generated by build/build_model.py: preview sentences scored by the shipped model.\n')
        f.write('window.BROMIDE_PREVIEW = ')
        json.dump({'sentences': preview}, f, separators=(',', ':'), ensure_ascii=False)
        f.write(';\n')

    # Checks a reader of the page relies on (tests/shipped.test.js asserts them too).
    by = {p['label']: p for p in preview}
    unknown_fresh = sum(1 for w in by['fresh']['words'] if w.get('oov'))
    print('preview: tired %s, fresh %s bits per word (%d unknown in the fresh line)' %
          (by['tired']['avg'], by['fresh']['avg'], unknown_fresh))
    if not (by['tired']['avg'] is not None and by['fresh']['avg'] is not None and
            by['tired']['avg'] + 1 < by['fresh']['avg'] and unknown_fresh <= 2):
        print('the preview lines do not show tired < fresh clearly; change PREVIEW', file=sys.stderr)
        return 0 if 'allow-preview' in opts else 1
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
