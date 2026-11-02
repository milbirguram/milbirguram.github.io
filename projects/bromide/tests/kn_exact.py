#!/usr/bin/env python3
"""Exact interpolated modified Kneser-Ney, written separately from build_model.py
with plain dictionaries and no rounding, as a yardstick for the shipped values.

If the model was pruned (its header says so), the same pruning is applied here
without rounding: an entry seen fewer times than the header's minimum, or too
small for a byte (-log2 a > 25.5), is dropped and its value added to its
context's back-off weight. So the shipped model and this one differ only by
rounding, which the header's quant.bound promises to keep small.

    python -I kn_exact.py <corpus-dir> <model.bin>  > probs.json

Uses build_model.py only to read and strip the books and score.py only for the
tokenizer, so the maths here is independent. Prints JSON:
{"vocab_matches": bool, "pruned": bool, "rows": [[u, v, w, p], ...]} for every
token of every sentence (training and held-out) plus the whole vocabulary in a
few contexts.
"""
import importlib.util
import json
import math
import os
import random
import sys
from collections import Counter, defaultdict

sys.dont_write_bytecode = True
BUILD = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'build')


def load(name):
    spec = importlib.util.spec_from_file_location('bromide_' + name, os.path.join(BUILD, name + '.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def discounts(values):
    cc = Counter(values)
    n = [cc[k] for k in (1, 2, 3, 4)]
    default = (0.5, 1.0, 1.5)
    if min(n) == 0:
        return default
    y = n[0] / (n[0] + 2.0 * n[1])
    d = (1 - 2 * y * n[1] / n[0], 2 - 3 * y * n[2] / n[1], 3 - 4 * y * n[3] / n[2])
    return tuple(d[k] if 0 < d[k] < k + 1 else default[k] for k in range(3))


def main(argv):
    corpus, model_path = argv[1], argv[2]
    S = load('score')
    BM = load('build_model')
    with open(model_path, 'rb') as f:
        header_vocab = S.Model(f.read())
    sents = []
    for info, body in BM.load_corpus(corpus)[0]:
        sents.extend(S.sentences(body))
    train = [s for i, s in enumerate(sents) if i % 100 != 37]

    freq = Counter(t for s in train for t in s if t not in S.PUNCT)
    ranked = sorted((w for w, c in freq.items() if c >= 2), key=lambda w: (-freq[w], w))[:40000]
    vocab = ['<unk>', '</s>', '<s>', '.', ',', ';', ':', '!', '?'] + ranked
    ix = {w: i for i, w in enumerate(vocab)}
    V = len(vocab)

    c3 = Counter()
    for s in train:
        seq = [2, 2] + [ix.get(t, 0) for t in s] + [1]
        for i in range(2, len(seq)):
            c3[(seq[i - 2], seq[i - 1], seq[i])] += 1
    n2 = Counter((v, w) for (u, v, w) in c3)        # distinct left contexts of (v, w)
    n1 = Counter(w for (v, w) in n2)                  # distinct left contexts of w
    D3, D2, D1 = discounts(c3.values()), discounts(n2.values()), discounts(n1.values())

    def d(D, c):
        return 0.0 if c == 0 else D[min(c, 3) - 1]

    prune = header_vocab.header.get('prune', {})
    k2, k3 = prune.get('bigram_min', 1), prune.get('trigram_min', 1)

    def kept(a, c, k):
        return c >= k and round(-math.log2(a) * 10) <= 255

    tot3, ds3 = defaultdict(int), defaultdict(float)
    for (u, v, w), c in c3.items():
        tot3[(u, v)] += c
        ds3[(u, v)] += d(D3, c)
    tot2, ds2 = defaultdict(int), defaultdict(float)
    for (v, w), c in n2.items():
        tot2[v] += c
        ds2[v] += d(D2, c)
    # Pruned values join their context's back-off weight.
    for (u, v, w), c in c3.items():
        a = (c - d(D3, c)) / tot3[(u, v)]
        if not kept(a, c, k3):
            ds3[(u, v)] += a * tot3[(u, v)]
    for (v, w), c in n2.items():
        a = (c - d(D2, c)) / tot2[v]
        if not kept(a, c, k2):
            ds2[v] += a * tot2[v]
    T = sum(n1.values())
    spread = sum(d(D1, c) for c in n1.values()) / T / (V - 1)

    def p1(w):
        if w == 2:
            return 0.0
        c = n1.get(w, 0)
        return (c - d(D1, c)) / T + spread

    def p2(v, w):
        if v not in tot2:
            return p1(w)
        c = n2.get((v, w), 0)
        a = (c - d(D2, c)) / tot2[v]
        return (a if c and kept(a, c, k2) else 0.0) + ds2[v] / tot2[v] * p1(w)

    def p3(u, v, w):
        if (u, v) not in tot3:
            return p2(v, w)
        c = c3.get((u, v, w), 0)
        a = (c - d(D3, c)) / tot3[(u, v)]
        return (a if c and kept(a, c, k3) else 0.0) + ds3[(u, v)] / tot3[(u, v)] * p2(v, w)

    rows = []
    for s in sents[:4000]:
        u, v = 2, 2
        for t in s + ['</s>']:
            w = ix.get(t, 0) if t != '</s>' else 1
            rows.append([u, v, w, p3(u, v, w)])
            u, v = v, w
    rnd = random.Random(1998)
    ctxs = list(tot3)
    for _ in range(5):
        u, v = ctxs[rnd.randrange(len(ctxs))]
        rows.extend([u, v, w, p3(u, v, w)] for w in range(V))
    json.dump({'vocab_matches': vocab == header_vocab.vocab,
               'pruned': k2 > 1 or k3 > 1,
               'rows': rows}, sys.stdout)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
