"""Evaluate copy, lookup, rules and the neural model on the held-out test split,
and write everything the page shows into ../data/.

Usage: python -I evaluate.py      (the neural part needs PyTorch and rote-work/neural.pt)

Outputs
  data/eval.json    every number on the page
  data/demo.json    ~2,000 test sentences with precomputed lookup and neural readings
  data/lookup.json  the most frequent non-copy readings from train, size-capped
  tests/rules_suite.json  a fixed suite with the Python rules' outputs (for the JS twin)
"""
import os, sys, json, random, collections, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import WORK, TRIVIAL, DATA_OUT, HERE, read_sentences
import rules, metrics

SEED = 2018
# neural: asked only about the tokens the data marks non-trivial (an oracle front end)
# gated:  the same model, asked about the tokens the rules decide need reading; the rest copied
SYSTEMS = ['copy', 'lookup', 'rules', 'neural', 'gated']
DEMO_BUDGET = 290 * 1024
LOOKUP_BUDGET = 150 * 1024


def build_lookup():
    """input -> most frequent reference in train. Self readings are counted apart to save memory."""
    self_count = collections.Counter()
    other = {}
    for sent in read_sentences(os.path.join(WORK, 'train.tsv')):
        for cls, inp, ref in sent:
            if ref == inp:
                self_count[inp] += 1
            else:
                d = other.get(inp)
                if d is None:
                    d = other[inp] = collections.Counter()
                d[ref] += 1
    table = {}       # non-copy decisions only
    freq = {}
    for inp, d in other.items():
        ref, n = d.most_common(1)[0]
        if n > self_count.get(inp, 0):
            table[inp] = ref
            freq[inp] = n
    seen = set(self_count) | set(other)
    return table, freq, seen


def neural_predictions(test_sents):
    cache = os.path.join(WORK, 'neural_test.json')
    if os.path.exists(cache):
        with open(cache, encoding='utf-8') as f:
            return json.load(f)
    import train as T  # adds the shared venv's site-packages when torch is not importable directly
    import torch
    with open(os.path.join(WORK, 'neural_vocab.json'), encoding='utf-8') as f:
        voc = json.load(f)
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    model = T.Seq2Seq(max(voc['chars'].values()) + 1, len(voc['words'])).to(device)
    model.load_state_dict(torch.load(os.path.join(WORK, 'neural.pt'), map_location=device))
    items = []
    for sent in test_sents:
        inputs = [t[1] for t in sent]
        for i, (cls, inp, ref) in enumerate(sent):
            if cls not in TRIVIAL:
                l, t, r = T.source_text(inputs, i)
                items.append((l, t, r, inp))
    t0 = time.time()
    preds = T.predict(model, items, voc['chars'], voc['words'], device)
    print('neural predictions', len(preds), '%.0fs' % (time.time() - t0))
    # preview phrases, in a plain context
    previews = {}
    for left, tok, right in [('The ring sold for', '£900', 'at auction .'), ('The tank holds', '3,500 kg', 'of water .'),
                             ('It opened on', 'May 20, 2008', 'in Boston .')]:
        previews[tok] = T.predict(model, [(left[-T.CTX_CHARS:], tok, right[:T.CTX_CHARS], tok)], voc['chars'], voc['words'], device)[0]
    out = {'test': preds, 'preview': previews}
    with open(cache, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False)
    return out


def rules_gate(cls_out, inp):
    """The rules' own decision that a token needs reading: a non-trivial class, or a changed output."""
    rcls, rout = cls_out
    return rcls not in TRIVIAL or metrics.canon(rout) != metrics.canon(inp)


def gated_extra_predictions(test_sents):
    """Neural readings for the tokens the rules' gate sends to the model although the data marks them
    PLAIN or PUNCT (the model was never asked about these in neural_predictions). In test order."""
    cache = os.path.join(WORK, 'neural_gate.json')
    if os.path.exists(cache):
        with open(cache, encoding='utf-8') as f:
            return json.load(f)
    import train as T
    import torch
    with open(os.path.join(WORK, 'neural_vocab.json'), encoding='utf-8') as f:
        voc = json.load(f)
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    model = T.Seq2Seq(max(voc['chars'].values()) + 1, len(voc['words'])).to(device)
    model.load_state_dict(torch.load(os.path.join(WORK, 'neural.pt'), map_location=device))
    items = []
    for sent in test_sents:
        inputs = [t[1] for t in sent]
        rule_out = rules.run_rules(inputs)
        for i, (cls, inp, ref) in enumerate(sent):
            if cls in TRIVIAL and rules_gate(rule_out[i], inp):
                l, t, r = T.source_text(inputs, i)
                items.append((l, t, r, inp))
    preds = T.predict(model, items, voc['chars'], voc['words'], device)
    print('gated extra neural predictions', len(preds))
    with open(cache, 'w', encoding='utf-8') as f:
        json.dump(preds, f, ensure_ascii=False)
    return preds


def main():
    t0 = time.time()
    table, freq, seen = build_lookup()
    print('lookup built: %d non-copy entries, %d seen inputs, %.0fs' % (len(table), len(seen), time.time() - t0))
    test_sents = list(read_sentences(os.path.join(WORK, 'test.tsv')))
    neural = neural_predictions(test_sents)
    npred = iter(neural['test'])
    gpred = iter(gated_extra_predictions(test_sents))
    gate_stats = collections.Counter()

    combos = {}
    def acc_slot(key):
        if key not in combos:
            combos[key] = {s: {'n': 0, 'exact': 0, 'slot_c': 0, 'slot_t': 0} for s in SYSTEMS}
        return combos[key]
    per_class = {s: collections.defaultdict(lambda: {'n': 0, 'c': 0, 'seen_n': 0, 'seen_c': 0, 'unseen_n': 0, 'unseen_c': 0}) for s in SYSTEMS}
    silly = {s: collections.Counter() for s in SYSTEMS}
    silly_unseen = {s: collections.Counter() for s in SYSTEMS}
    class_count = collections.Counter()
    seen_count = collections.Counter()
    examples = collections.defaultdict(list)
    # ---- demo sentence helpers ----
    rnd = random.Random(SEED)
    cls_index = {c: i for i, c in enumerate(['PLAIN', 'PUNCT', 'DATE', 'LETTERS', 'CARDINAL', 'VERBATIM', 'MEASURE', 'ORDINAL',
                                             'DECIMAL', 'MONEY', 'ELECTRONIC', 'DIGIT', 'TELEPHONE', 'TIME', 'FRACTION', 'ADDRESS'])}

    def code(out, ref, inp):
        if metrics.exact_match(out, ref):
            return 1
        if metrics.exact_match(out, inp):
            return 0
        return out

    def encode(rec):
        toks = []
        for cls, inp, ref, is_seen, outs, ok in rec:
            if cls in TRIVIAL and ref == inp and ok['rules'] and ok['lookup']:
                toks.append(inp)
                continue
            toks.append([inp, cls_index.get(cls, 0), 0 if ref == inp else ref, 1 if is_seen else 0,
                         code(outs['lookup'], ref, inp), code(outs['neural'], ref, inp), 1 if ok['rules'] else 0])
        return toks

    cands_unseen, cands_other = [], []
    for si, sent in enumerate(test_sents):
        inputs = [t[1] for t in sent]
        rule_out = rules.run_rules(inputs)
        rec = []
        for i, (cls, inp, ref) in enumerate(sent):
            trivial = cls in TRIVIAL
            is_seen = inp in seen
            outs = {
                'copy': inp,
                'lookup': table.get(inp, inp),
                'rules': rule_out[i][1],
                'neural': inp if trivial else next(npred),
            }
            gate = rules_gate(rule_out[i], inp)
            gate_stats[(trivial, gate)] += 1
            outs['gated'] = (next(gpred) if trivial else outs['neural']) if gate else inp
            class_count[cls] += 1
            seen_count[(trivial, is_seen)] += 1
            ok = {s: metrics.exact_match(outs[s], ref) for s in SYSTEMS}
            for incl in (True, False):
                if not incl and trivial:
                    continue
                for unseen_only in (False, True):
                    if unseen_only and is_seen:
                        continue
                    box = acc_slot('%d%d' % (incl, unseen_only))
                    for s in SYSTEMS:
                        b = box[s]
                        b['n'] += 1
                        b['exact'] += ok[s]
                        c, t = metrics.slot_scores(outs[s], ref, 20, True)
                        b['slot_c'] += c
                        b['slot_t'] += t
            if not trivial:
                for s in SYSTEMS:
                    pc = per_class[s][cls]
                    pc['n'] += 1
                    pc['c'] += ok[s]
                    k = 'seen' if is_seen else 'unseen'
                    pc[k + '_n'] += 1
                    pc[k + '_c'] += ok[s]
                    et = metrics.error_type(outs[s], ref, inp, cls)
                    if et:
                        silly[s][et] += 1
                        if not is_seen:
                            silly_unseen[s][et] += 1
                        if len(examples[(s, et)]) < 6 and len(inp) < 24 and len(ref) < 60:
                            examples[(s, et)].append([inp, outs[s], ref])
            rec.append((cls, inp, ref, is_seen, outs, ok))
        if 6 <= len(rec) <= 16:
            nt = [r for r in rec if r[0] not in TRIVIAL]
            if nt and not any(len(r[2]) > 70 or len(r[1]) > 30 for r in nt):
                (cands_unseen if any(not r[3] for r in nt) else cands_other).append(encode(rec))

    total = sum(class_count.values())
    trivial_share = (class_count['PLAIN'] + class_count['PUNCT']) / total
    scores = {}
    for key, box in combos.items():
        scores[key] = {}
        for s in SYSTEMS:
            b = box[s]
            scores[key][s] = {'n': b['n'], 'exact': b['n'] and b['exact'] / b['n'], 'padded': b['slot_t'] and b['slot_c'] / b['slot_t']}

    split = json.load(open(os.path.join(WORK, 'split_info.json')))
    trainlog = json.load(open(os.path.join(WORK, 'train_log.json'))) if os.path.exists(os.path.join(WORK, 'train_log.json')) else {}
    classes_sorted = [c for c, _ in class_count.most_common()]
    ev = {
        'about': 'Computed by pipeline/evaluate.py on the held-out test split. Exact match is case- and space-insensitive.',
        'data': {
            'source': 'Sproat & Jaitly English text-normalization data (Google; Kestrel references), Wikipedia text',
            'licence': 'CC BY-SA 4.0',
            'shards': split['shards'], 'split_seed': split['seed'],
            'sentences': split['sentences'], 'tokens': split['tokens'],
        },
        'test': {
            'tokens': total,
            'nontrivial_tokens': total - class_count['PLAIN'] - class_count['PUNCT'],
            'plain_punct_share': trivial_share,
            'class_counts': {c: class_count[c] for c in classes_sorted},
            'unseen_nontrivial': seen_count[(False, False)],
            'seen_nontrivial': seen_count[(False, True)],
            'unseen_all': seen_count[(False, False)] + seen_count[(True, False)],
        },
        'original': {
            'claimed_val_acc': 99.51,
            'claimed_note': 'Keras per-slot accuracy over 20 output slots, padding counted, all tokens (conTEXT README)',
            'poster_conTEXT': 98.2, 'poster_xgboost': 97.4, 'kestrel_cited': 91.3,
            'output_vocab': 346, 'slots': 20, 'year': 2018,
        },
        'systems': SYSTEMS,
        'scores': scores,
        'per_class': {s: {c: dict(per_class[s][c]) for c in classes_sorted if c in per_class[s]} for s in SYSTEMS},
        'silly': {s: {t: silly[s][t] for t in metrics.ERROR_TYPES} for s in SYSTEMS},
        'silly_unseen': {s: {t: silly_unseen[s][t] for t in metrics.ERROR_TYPES} for s in SYSTEMS},
        'examples': {'%s|%s' % k: v for k, v in examples.items()},
        'neural': {
            'train_minutes': trainlog.get('train_minutes'), 'epochs': len(trainlog.get('epochs', [])),
            'train_examples': trainlog.get('n_train_examples'), 'device': trainlog.get('device'),
            'best_dev_exact_nontrivial': trainlog.get('best_dev_exact_nontrivial'),
            'per_input_cap': trainlog.get('per_input_cap'),
        },
        'gate': {
            'about': "gated = the neural model asked only about tokens the rules' classifier says need reading",
            'trivial_sent_to_model': gate_stats[(True, True)],
            'nontrivial_not_sent': gate_stats[(False, False)],
        },
        'lookup': {'noncopy_entries': len(table), 'seen_inputs': len(seen)},
        'preview_neural': neural.get('preview', {}),
    }

    rnd.shuffle(cands_unseen)
    rnd.shuffle(cands_other)
    chosen, size = [], 2
    ui = oi = 0
    while size < DEMO_BUDGET and (ui < len(cands_unseen) or oi < len(cands_other)):
        take_unseen = (len(chosen) % 2 == 0 and ui < len(cands_unseen)) or oi >= len(cands_other)
        if take_unseen:
            enc = cands_unseen[ui]; ui += 1
        else:
            enc = cands_other[oi]; oi += 1
        size += len(json.dumps(enc, ensure_ascii=False, separators=(',', ':')).encode('utf-8')) + 1
        if size >= DEMO_BUDGET:
            break
        chosen.append(enc)
    demo = {
        'about': 'Held-out test sentences. Token: a string (plain, read as written) or [input, classIndex, reference (0 = as written), '
                 'seen in train (1/0), lookup reading, neural reading, Python rules correct (1/0)]; for readings 1 = matches the reference, '
                 '0 = left as written, otherwise the reading.',
        'classes': list(cls_index.keys()),
        'selection': 'alternately a random test sentence holding an input never seen in train, and a random test sentence whose inputs were all seen; 6-16 tokens',
        'sentences': chosen,
    }
    ev['demo'] = {'sentences': len(chosen)}

    # ---- lookup for the browser ----
    items = sorted(table.items(), key=lambda kv: (-freq[kv[0]], kv[0]))
    lk, size = {}, 2
    for inp, ref in items:
        add = len(json.dumps({inp: ref}, ensure_ascii=False).encode('utf-8'))
        if size + add > LOOKUP_BUDGET:
            break
        lk[inp] = ref
        size += add
    ev['lookup']['browser_entries'] = len(lk)

    os.makedirs(DATA_OUT, exist_ok=True)
    with open(os.path.join(DATA_OUT, 'eval.json'), 'w', encoding='utf-8') as f:
        json.dump(ev, f, ensure_ascii=False, indent=1)
    with open(os.path.join(DATA_OUT, 'demo.json'), 'w', encoding='utf-8') as f:
        json.dump(demo, f, ensure_ascii=False, separators=(',', ':'))
    with open(os.path.join(DATA_OUT, 'lookup.json'), 'w', encoding='utf-8') as f:
        json.dump(lk, f, ensure_ascii=False, separators=(',', ':'))
    write_rules_suite()
    print(json.dumps({k: {s: round(v[s]['exact'], 4) for s in SYSTEMS} for k, v in scores.items()}, indent=0))
    print('demo sentences', len(chosen), 'browser lookup entries', len(lk), 'done in %.0fs' % (time.time() - t0))


SUITE = [
    ['£900'], ['3,500 kg'], ['May 20, 2008'], ['15 February 1987'], ['1987'], ['2008'], ['2010'], ['1905'], ['1900'],
    ['1990s'], ['$11.50'], ['$4.25M'], ['$50K'], ['US$100,000'], ['42.60 USD'], ['4.9/km²'], ['52.63 km2'], ['61.6%'],
    ["77'"], ['92.10'], ['1.0'], ['13.0000'], ['.40'], ['2.5 million'], ['0.47%'], ['46/100'], ['1/2'], ['7/4'], ['29/1'],
    ['30½'], ['2 1/2'], ['4:16'], ['07:00'], ['19:00'], ['00:50:53'], ['6:00am'], ['9:01am EDT'], ['1:34.52'], ['3.02'],
    ['09.10'], ['978-0-306-44696-2'], ['0799-0537'], ['07'], ['21st'], ['101st'], ['http://www.pitt.edu/~dash'],
    ['Cairo360.com'], ['diff2013.org'], ['BBC'], ['NGOs'], ["NHL's"], ['NASA'], ['AND'], ['U.S.'], ['T. H.'], ['B-'], ['pp'],
    ['&'], ['α'], ['р'], ['-'], ['—'], ['.'], ['vs'], ['dr'], ['2004-04-04'], ['12/05/2001'], ['25/12/99'], ['300 BC'],
    ['-57'], ['1,200'], ['26,456'], ['$1'], ['$1.00'], ['1 kg'], ['per km²'], ['59,000 sq ft'], ['12345678901234567890'],
    ['constructor'], ['toString'], ['Henry', 'VIII'], ['World', 'War', 'II'], ['1990', '-', '1995'], ['the', 'I', 'think'],
    ['10:30 a.m.'], ['7 pm'], ['£3.2 million'], ['€300,000'], ['5½'], ['3 ¼'], ['−5'], ['$0.50'],
    ['90s'], ["80's"], ['20s'], ['pages', '10', '-', '20'], ['555-1234'], ['COVID', '-', '19'], ['😀'],
]


def write_rules_suite():
    cases = []
    for toks in SUITE:
        out = rules.run_rules(toks)
        cases.append({'tokens': toks, 'cls': [c for c, _ in out], 'out': [o for _, o in out]})
    with open(os.path.join(HERE, '..', 'tests', 'rules_suite.json'), 'w', encoding='utf-8') as f:
        json.dump(cases, f, ensure_ascii=False, indent=0)


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'suite':
        write_rules_suite()
    else:
        main()
