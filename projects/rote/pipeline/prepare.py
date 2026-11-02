"""Split the downloaded English shards into train / dev / test by SENTENCE.

Usage: python -I prepare.py
Reads every output-*-of-00100 file in rote-raw, shuffles sentence order with a
fixed seed and writes train.tsv / dev.tsv / test.tsv (raw Kestrel columns,
one blank line between sentences) into rote-work.
"""
import os, sys, glob, random, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import RAW, WORK, read_sentences

SEED = 2018
TEST_FRAC, DEV_FRAC = 0.04, 0.01

shards = sorted(glob.glob(os.path.join(RAW, 'output-*-of-00100')))
sents = []
for p in shards:
    sents.extend(read_sentences(p, resolve=False))
print('shards', [os.path.basename(p) for p in shards], 'sentences', len(sents))
order = list(range(len(sents)))
random.Random(SEED).shuffle(order)
n_test = int(len(sents) * TEST_FRAC)
n_dev = int(len(sents) * DEV_FRAC)
splits = {'test': order[:n_test], 'dev': order[n_test:n_test + n_dev], 'train': order[n_test + n_dev:]}
os.makedirs(WORK, exist_ok=True)
info = {'seed': SEED, 'shards': [os.path.basename(p) for p in shards], 'sentences': {}, 'tokens': {}}
for name, idx in splits.items():
    idx.sort()
    ntok = 0
    with open(os.path.join(WORK, name + '.tsv'), 'w', encoding='utf-8', newline='\n') as f:
        for i in idx:
            for cls, inp, out in sents[i]:
                f.write(cls + '\t' + inp + '\t' + out + '\n')
                ntok += 1
            f.write('\n')
    info['sentences'][name] = len(idx)
    info['tokens'][name] = ntok
    print(name, len(idx), 'sentences', ntok, 'tokens')
with open(os.path.join(WORK, 'split_info.json'), 'w') as f:
    json.dump(info, f, indent=1)
