"""Development aid: run the Python rules over dev.tsv, report per-class accuracy,
and write the sentences plus Python outputs so node can check the JS twin.
Usage: python -I dev_rules.py [max_sentences]
"""
import os, sys, json, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import WORK, read_sentences
import rules, metrics

limit = int(sys.argv[1]) if len(sys.argv) > 1 else 10**9
stats = collections.defaultdict(lambda: [0, 0])
errs = collections.defaultdict(list)
dump = []
for k, sent in enumerate(read_sentences(os.path.join(WORK, 'dev.tsv'))):
    if k >= limit:
        break
    toks = [t[1] for t in sent]
    outs = rules.run_rules(toks)
    dump.append({'t': toks, 'o': [o for _, o in outs]})
    for (cls, inp, ref), (pc, out) in zip(sent, outs):
        ok = metrics.exact_match(out, ref)
        stats[cls][0] += ok
        stats[cls][1] += 1
        if not ok and len(errs[cls]) < 400:
            errs[cls].append((inp, ref, out, pc))
for cls, (c, n) in sorted(stats.items(), key=lambda x: -x[1][1]):
    print('%-11s %6d  %.3f' % (cls, n, c / n))
with open(os.path.join(WORK, 'dev_rules_dump.json'), 'w', encoding='utf-8') as f:
    json.dump(dump, f, ensure_ascii=False)
with open(os.path.join(WORK, 'dev_rules_errors.txt'), 'w', encoding='utf-8') as f:
    for cls, xs in errs.items():
        f.write('== %s\n' % cls)
        for x in xs:
            f.write('%s\t|%s|\t|%s|\t%s\n' % x)
