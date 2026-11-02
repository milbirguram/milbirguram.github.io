"""HIDDEN CHECK (needs the local data in rote-work): seen/unseen is computed from TRAIN inputs.

Rebuilds the set of train input strings from train.tsv and checks every demo token's
seen flag, then checks that no test sentence also sits in train by position (the split
is by sentence). Skips cleanly when the data are not on this machine.
Usage: python -I tests/test_seen.py
"""
import os, sys, json
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'pipeline'))
from common import WORK, read_sentences

train = os.path.join(WORK, 'train.tsv')
if not os.path.exists(train):
    print('test_seen: skipped (no local data at %s)' % WORK)
    sys.exit(0)
seen = set()
for sent in read_sentences(train, resolve=False):
    for _, inp, _ in sent:
        seen.add(inp)
with open(os.path.join(HERE, '..', 'data', 'demo.json'), encoding='utf-8') as f:
    demo = json.load(f)
n = bad = 0
for s in demo['sentences']:
    for t in s:
        if isinstance(t, str):
            continue
        n += 1
        if (t[0] in seen) != bool(t[3]):
            bad += 1
            print('mismatch', repr(t[0]), t[3])
with open(os.path.join(HERE, '..', 'data', 'eval.json'), encoding='utf-8') as f:
    ev = json.load(f)
unseen_test = 0
for sent in read_sentences(os.path.join(WORK, 'test.tsv'), resolve=False):
    for cls, inp, _ in sent:
        if cls not in ('PLAIN', 'PUNCT') and inp not in seen:
            unseen_test += 1
assert bad == 0, '%d seen flags disagree with train' % bad
assert unseen_test == ev['test']['unseen_nontrivial'], (unseen_test, ev['test']['unseen_nontrivial'])
print('test_seen: ok (%d demo tokens; %d unseen non-trivial test tokens)' % (n, unseen_test))
