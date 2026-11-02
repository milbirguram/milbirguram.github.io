"""Train the small neural system: a character-level encoder over the token with a
+-3-word context window, and an attention decoder over output words.

Trained ONLY on non-trivial tokens (every class except PLAIN and PUNCT).
Targets equal to the input become a single '<self>' word.

Usage (needs PyTorch): python -I train.py [minutes]
Writes rote-work/neural.pt, rote-work/neural_vocab.json, rote-work/train_log.json
"""
import os, sys, json, time, random, math, array, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    import torch
except ImportError:  # the shared venv's site-packages, used from its base interpreter
    sys.path.insert(0, os.path.join(os.environ.get('ROTE_SCRATCH', r'C:\Users\MILBIR\AppData\Local\Temp\claude\C--Users-MILBIR-Desktop-Git\c3e3582f-6443-4676-a52a-c51260891918\scratchpad'), 'ml-venv', 'Lib', 'site-packages'))
    import torch
import torch.nn as nn
import torch.nn.functional as F
from common import WORK, TRIVIAL, read_sentences
from metrics import canon

SEED = 2018
CTX_WORDS, CTX_CHARS, TOK_CHARS = 3, 40, 60
MAX_OUT = 48
PER_INPUT_CAP = 40          # at most this many training examples share one input string
PAD, UNK, NORM_L, NORM_R = 0, 1, 2, 3   # char ids
WPAD, WUNK, WBOS, WEOS, WSELF = 0, 1, 2, 3, 4  # word ids


def source_text(inputs, i):
    left = ' '.join(inputs[max(0, i - CTX_WORDS):i])[-CTX_CHARS:]
    right = ' '.join(inputs[i + 1:i + 1 + CTX_WORDS])[:CTX_CHARS]
    return left, inputs[i][:TOK_CHARS], right


def encode_source(left, tok, right, cvocab):
    ids = [cvocab.get(c, UNK) for c in left] + [NORM_L] + [cvocab.get(c, UNK) for c in tok] + [NORM_R] + [cvocab.get(c, UNK) for c in right]
    return ids


def target_words(inp, ref):
    if canon(ref) == canon(inp):
        return ['<self>']
    return canon(ref).split(' ')


class Seq2Seq(nn.Module):
    def __init__(self, n_chars, n_words, ce=64, hid=256, we=128):
        super().__init__()
        self.cemb = nn.Embedding(n_chars, ce, padding_idx=PAD)
        self.enc = nn.GRU(ce, hid, num_layers=2, bidirectional=True, batch_first=True, dropout=0.1)
        self.bridge = nn.Linear(2 * hid, 2 * hid)
        self.wemb = nn.Embedding(n_words, we, padding_idx=WPAD)
        self.cell = nn.GRUCell(we + 2 * hid, 2 * hid)
        self.att = nn.Linear(2 * hid, 2 * hid, bias=False)
        self.comb = nn.Linear(4 * hid, 2 * hid)
        self.out = nn.Linear(2 * hid, n_words)
        self.drop = nn.Dropout(0.1)

    def encode(self, src, lens):
        e = self.drop(self.cemb(src))
        packed = nn.utils.rnn.pack_padded_sequence(e, lens.cpu(), batch_first=True, enforce_sorted=False)
        out, h = self.enc(packed)
        out, _ = nn.utils.rnn.pad_packed_sequence(out, batch_first=True, total_length=src.size(1))
        last = torch.cat([h[-2], h[-1]], dim=1)
        h0 = torch.tanh(self.bridge(last))
        mask = src != PAD
        return out, h0, mask

    def step(self, y_prev, h, ctx_prev, enc, keys, mask):
        x = torch.cat([self.wemb(y_prev), ctx_prev], dim=1)
        h = self.cell(x, h)
        scores = torch.bmm(keys, h.unsqueeze(2)).squeeze(2)
        scores = scores.masked_fill(~mask, -1e4)
        a = torch.softmax(scores.float(), dim=1).to(enc.dtype)
        ctx = torch.bmm(a.unsqueeze(1), enc).squeeze(1)
        o = torch.tanh(self.comb(torch.cat([h, ctx], dim=1)))
        return self.out(self.drop(o)), h, ctx

    def forward(self, src, lens, tgt_in):
        enc, h, mask = self.encode(src, lens)
        keys = self.att(enc)
        ctx = torch.zeros_like(h)
        logits = []
        for t in range(tgt_in.size(1)):
            lo, h, ctx = self.step(tgt_in[:, t], h, ctx, enc, keys, mask)
            logits.append(lo)
        return torch.stack(logits, dim=1)

    @torch.no_grad()
    def greedy(self, src, lens, max_len=MAX_OUT + 2):
        enc, h, mask = self.encode(src, lens)
        keys = self.att(enc)
        ctx = torch.zeros_like(h)
        y = torch.full((src.size(0),), WBOS, dtype=torch.long, device=src.device)
        outs, done = [], torch.zeros(src.size(0), dtype=torch.bool, device=src.device)
        for _ in range(max_len):
            lo, h, ctx = self.step(y, h, ctx, enc, keys, mask)
            y = lo.argmax(1)
            outs.append(y)
            done |= y == WEOS
            if bool(done.all()):
                break
        return torch.stack(outs, 1)


def pad_batch(seqs, pad, device):
    n = max(len(s) for s in seqs)
    t = torch.full((len(seqs), n), pad, dtype=torch.long)
    for i, s in enumerate(seqs):
        t[i, :len(s)] = torch.tensor(s, dtype=torch.long)
    return t.to(device)


def decode_ids(ids, inv_words, inp):
    words = []
    for i in ids:
        if i == WEOS:
            break
        if i == WSELF:
            return inp
        if i in (WPAD, WBOS):
            continue
        words.append(inv_words[i] if i < len(inv_words) else '<unk>')
    return ' '.join(words)


def predict(model, items, cvocab, inv_words, device, batch=512):
    """items: list of (left, tok, right, raw_input). Returns list of strings."""
    model.eval()
    order = sorted(range(len(items)), key=lambda k: len(items[k][0]) + len(items[k][1]) + len(items[k][2]))
    res = [None] * len(items)
    for b in range(0, len(order), batch):
        idx = order[b:b + batch]
        seqs = [encode_source(items[k][0], items[k][1], items[k][2], cvocab) for k in idx]
        src = pad_batch(seqs, PAD, device)
        lens = torch.tensor([len(s) for s in seqs])
        with torch.autocast(device_type=device.type, dtype=torch.float16, enabled=device.type == 'cuda'):
            out = model.greedy(src, lens).cpu().tolist()
        for k, ids in zip(idx, out):
            res[k] = decode_ids(ids, inv_words, items[k][3])
    return res


def main():
    minutes = float(sys.argv[1]) if len(sys.argv) > 1 else 45.0
    random.seed(SEED)
    torch.manual_seed(SEED)
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print('device', device, torch.cuda.get_device_name(0) if device.type == 'cuda' else '')

    # ---- build training examples (compact flat arrays) ----
    t0 = time.time()
    cvocab = {}
    wcount = collections.Counter()
    per_input = collections.Counter()
    raw = []  # (src_ids list as array, tgt words)
    src_flat, src_off = array.array('H'), array.array('I', [0])
    tgt_list = []
    n_seen = n_skip_long = n_capped = 0
    cvocab_next = 4
    smoke = os.environ.get('ROTE_SMOKE')
    for k_sent, sent in enumerate(read_sentences(os.path.join(WORK, 'train.tsv'))):
        if smoke and k_sent > 20000:
            break
        inputs = [t[1] for t in sent]
        for i, (cls, inp, ref) in enumerate(sent):
            if cls in TRIVIAL:
                continue
            n_seen += 1
            if per_input[inp] >= PER_INPUT_CAP:
                n_capped += 1
                continue
            words = target_words(inp, ref)
            if len(words) > MAX_OUT:
                n_skip_long += 1
                continue
            per_input[inp] += 1
            left, tok, right = source_text(inputs, i)
            for c in left + tok + right:
                if c not in cvocab:
                    cvocab[c] = cvocab_next
                    cvocab_next += 1
            ids = encode_source(left, tok, right, cvocab)
            src_flat.extend(ids)
            src_off.append(len(src_flat))
            wcount.update(words)
            tgt_list.append(words)
    del per_input
    words = ['<pad>', '<unk>', '<s>', '</s>', '<self>'] + sorted(w for w, c in wcount.items() if c >= 2 and w != '<self>')
    assert len(words) < 65535 and cvocab_next < 65535
    wvocab = {w: i for i, w in enumerate(words)}
    tgt_flat, tgt_off = array.array('H'), array.array('I', [0])
    for ws in tgt_list:
        tgt_flat.extend([wvocab.get(w, WUNK) for w in ws] + [WEOS])
        tgt_off.append(len(tgt_flat))
    del tgt_list, wcount
    N = len(src_off) - 1
    print('non-trivial train tokens %d, used %d, capped %d, too long %d; chars %d words %d; built in %.0fs'
          % (n_seen, N, n_capped, n_skip_long, cvocab_next, len(words), time.time() - t0))
    with open(os.path.join(WORK, 'neural_vocab.json'), 'w', encoding='utf-8') as f:
        json.dump({'chars': cvocab, 'words': words}, f, ensure_ascii=False)

    # ---- dev sample for model selection ----
    dev_items, dev_refs = [], []
    for sent in read_sentences(os.path.join(WORK, 'dev.tsv')):
        inputs = [t[1] for t in sent]
        for i, (cls, inp, ref) in enumerate(sent):
            if cls not in TRIVIAL:
                l, t, r = source_text(inputs, i)
                dev_items.append((l, t, r, inp))
                dev_refs.append(ref)
    rnd = random.Random(SEED)
    pick = rnd.sample(range(len(dev_items)), min(300 if os.environ.get('ROTE_SMOKE') else 6000, len(dev_items)))
    dev_items = [dev_items[k] for k in pick]
    dev_refs = [dev_refs[k] for k in pick]

    model = Seq2Seq(cvocab_next, len(words)).to(device)
    opt = torch.optim.Adam(model.parameters(), lr=2e-3)
    scaler = torch.amp.GradScaler('cuda', enabled=device.type == 'cuda')
    print('parameters', sum(p.numel() for p in model.parameters()))
    lengths = [src_off[k + 1] - src_off[k] for k in range(N)]
    B = 256
    log = {'epochs': [], 'n_train_examples': N, 'device': str(device), 'per_input_cap': PER_INPUT_CAP}
    best = -1
    start = time.time()
    deadline = start + minutes * 60
    epoch = 0
    inv_words = words
    while time.time() < deadline and epoch < 12:
        epoch += 1
        model.train()
        idx = list(range(N))
        rnd.shuffle(idx)
        # bucket: sort within chunks of 100 batches by source length
        batches = []
        for c in range(0, N, B * 100):
            chunk = sorted(idx[c:c + B * 100], key=lambda k: lengths[k])
            batches += [chunk[j:j + B] for j in range(0, len(chunk), B)]
        rnd.shuffle(batches)
        tot, steps = 0.0, 0
        for bi, bidx in enumerate(batches):
            srcs = [src_flat[src_off[k]:src_off[k + 1]].tolist() for k in bidx]
            tg = [tgt_flat[tgt_off[k]:tgt_off[k + 1]].tolist() for k in bidx]
            src = pad_batch(srcs, PAD, device)
            lens = torch.tensor([len(s) for s in srcs])
            tgt_out = pad_batch(tg, WPAD, device)
            tgt_in = torch.cat([torch.full((len(bidx), 1), WBOS, dtype=torch.long, device=device), tgt_out[:, :-1]], dim=1)
            with torch.autocast(device_type=device.type, dtype=torch.float16, enabled=device.type == 'cuda'):
                logits = model(src, lens, tgt_in)
                loss = F.cross_entropy(logits.reshape(-1, logits.size(-1)).float(), tgt_out.reshape(-1), ignore_index=WPAD)
            opt.zero_grad(set_to_none=True)
            scaler.scale(loss).backward()
            scaler.unscale_(opt)
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            scaler.step(opt)
            scaler.update()
            tot += loss.item()
            steps += 1
            if bi % 500 == 0:
                print('  epoch %d batch %d/%d loss %.4f  %.1f min' % (epoch, bi, len(batches), tot / steps, (time.time() - start) / 60), flush=True)
            if time.time() > deadline:
                break
        preds = predict(model, dev_items, cvocab, inv_words, device)
        acc = sum(canon(p) == canon(r) for p, r in zip(preds, dev_refs)) / len(dev_refs)
        print('epoch %d loss %.4f dev exact (non-trivial) %.4f  %.1f min' % (epoch, tot / max(1, steps), acc, (time.time() - start) / 60), flush=True)
        log['epochs'].append({'epoch': epoch, 'loss': tot / max(1, steps), 'dev_exact_nontrivial': acc,
                              'minutes': (time.time() - start) / 60, 'completed': time.time() <= deadline})
        if acc > best:
            best = acc
            torch.save(model.state_dict(), os.path.join(WORK, 'neural.pt'))
        for g in opt.param_groups:
            g['lr'] *= 0.6
    log['best_dev_exact_nontrivial'] = best
    log['train_minutes'] = (time.time() - start) / 60
    with open(os.path.join(WORK, 'train_log.json'), 'w') as f:
        json.dump(log, f, indent=1)
    print('done', best)


if __name__ == '__main__':
    main()
