"""Train a small U-Net to segment nuclei in BBBC039 (U2OS cells, Hoechst stain).

Usage:  python train.py RAW_DIR OUT_DIR
  RAW_DIR  holds BBBC039's images/ (16-bit TIFF) and masks/ (PNG) folders
  OUT_DIR  receives checkpoints, test probability maps and the full log

Writes split.json, results.json and log.txt next to this script.

What it does, in order:
  1. Split the 200 images by image with a fixed seed (140 train / 30 val / 30 test) and
     record a SHA-256 of every file in each split.
  2. Train a 4-level U-Net with same-padding convolutions, so the output is aligned with
     the input pixel for pixel. The last layer gives raw logits; the loss is
     BCE-with-logits plus a soft Dice term.
  3. Augment image and mask together: random 256x256 crop, flips, 90-degree rotations;
     and the image alone: light gain, offset and gamma jitter.
  4. Early-stop on mean per-image validation Dice at threshold 0.5.
  5. Report per-image Dice, IoU and pixel accuracy on the test split for the U-Net and for
     two baselines: predict all background, and Otsu's threshold.
"""
import json
import math
import os
import random
import sys
import time

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common  # noqa: E402

SEED = 20261102
N_VAL, N_TEST = 30, 30
CROP = 256
BATCH = 8
CROPS_PER_IMAGE = 4
MAX_EPOCHS = 150
PATIENCE = 15
LR = 1e-3


# ---------------------------------------------------------------- model

def double_conv(cin, cout):
    return nn.Sequential(
        nn.Conv2d(cin, cout, 3, padding=1, bias=False), nn.BatchNorm2d(cout), nn.ReLU(inplace=True),
        nn.Conv2d(cout, cout, 3, padding=1, bias=False), nn.BatchNorm2d(cout), nn.ReLU(inplace=True),
    )


class UNet(nn.Module):
    """Same-padding U-Net: every 3x3 conv pads by 1, so a H x W input (H, W multiples of
    16) gives a H x W map of logits. No sigmoid at the end: the loss takes logits."""

    def __init__(self, width=16, depth=4):
        super().__init__()
        chs = [width * 2 ** i for i in range(depth + 1)]
        self.down = nn.ModuleList([double_conv(1, chs[0])] +
                                  [double_conv(chs[i - 1], chs[i]) for i in range(1, depth + 1)])
        self.up = nn.ModuleList([nn.ConvTranspose2d(chs[i], chs[i - 1], 2, stride=2)
                                 for i in range(depth, 0, -1)])
        self.dec = nn.ModuleList([double_conv(2 * chs[i - 1], chs[i - 1]) for i in range(depth, 0, -1)])
        self.head = nn.Conv2d(chs[0], 1, 1)

    def forward(self, x):
        skips = []
        for i, block in enumerate(self.down):
            x = block(x if i == 0 else F.max_pool2d(x, 2))
            skips.append(x)
        skips.pop()
        for up, dec in zip(self.up, self.dec):
            x = up(x)
            x = dec(torch.cat([skips.pop(), x], dim=1))
        return self.head(x)


def predict_full(net, img, device):
    """Probability map for a whole image. Reflect-pads bottom and right to a multiple of 16,
    then crops the same rows and columns back off, so pixel (y, x) out is pixel (y, x) in."""
    h, w = img.shape
    ph, pw = (-h) % 16, (-w) % 16
    x = torch.from_numpy(img)[None, None].to(device)
    x = F.pad(x, (0, pw, 0, ph), mode='reflect')
    with torch.no_grad():
        logits = net(x)[0, 0, :h, :w]
    return torch.sigmoid(logits).cpu().numpy()


# ---------------------------------------------------------------- loss

def bce_dice_loss(logits, target):
    bce = F.binary_cross_entropy_with_logits(logits, target)
    p = torch.sigmoid(logits)
    dims = (1, 2, 3)
    inter = (p * target).sum(dims)
    soft_dice = (2 * inter + 1.0) / (p.sum(dims) + target.sum(dims) + 1.0)
    return bce + (1.0 - soft_dice).mean()


# ---------------------------------------------------------------- data

def augment(img, mask, rng):
    h, w = img.shape
    y = rng.integers(0, h - CROP + 1)
    x = rng.integers(0, w - CROP + 1)
    a = img[y:y + CROP, x:x + CROP]
    m = mask[y:y + CROP, x:x + CROP]
    k = rng.integers(0, 4)
    a, m = np.rot90(a, k), np.rot90(m, k)
    if rng.random() < 0.5:
        a, m = a[:, ::-1], m[:, ::-1]
    if rng.random() < 0.5:
        a, m = a[::-1], m[::-1]
    gain = rng.uniform(0.8, 1.25)
    offset = rng.uniform(-0.05, 0.05)
    gamma = rng.uniform(0.8, 1.25)
    a = np.clip(a, 0, 1) ** gamma * gain + offset
    return np.ascontiguousarray(a, np.float32), np.ascontiguousarray(m, np.float32)


def per_image_scores(prob, truth, t=0.5):
    return common.scores(*common.confusion(prob >= t, truth))


def main():
    raw_dir, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    rng = np.random.default_rng(SEED)
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    log_lines = []

    def log(s):
        print(s, flush=True)
        log_lines.append(s)

    names = sorted(f[:-4] for f in os.listdir(os.path.join(raw_dir, 'images')) if f.endswith('.tif'))
    order = list(names)
    random.Random(SEED).shuffle(order)
    split = {'test': sorted(order[:N_TEST]), 'val': sorted(order[N_TEST:N_TEST + N_VAL]),
             'train': sorted(order[N_TEST + N_VAL:])}
    record = {'seed': SEED, 'source': 'BBBC039v1 (images.zip, masks.zip)', 'splits': {}}
    for part, items in split.items():
        record['splits'][part] = [{
            'name': n,
            'image_sha256': common.sha256(os.path.join(raw_dir, 'images', n + '.tif')),
            'mask_sha256': common.sha256(os.path.join(raw_dir, 'masks', n + '.png')),
        } for n in items]
    with open(os.path.join(HERE, 'split.json'), 'w') as f:
        json.dump(record, f, indent=1)

    data = {}
    for n in names:
        img = common.load_raw(os.path.join(raw_dir, 'images', n + '.tif'))
        fg =np.asarray(Image.open(os.path.join(raw_dir, 'masks', n + '.png')))[..., 0] > 0
        data[n] = (img, fg)
    fgs = [data[n][1].mean() for n in names]
    log('device %s, torch %s; %d images; foreground share %.3f-%.3f (mean %.3f)' %
        (device, torch.__version__, len(names), min(fgs), max(fgs), float(np.mean(fgs))))
    log('split seed %d: %d train / %d val / %d test' % (SEED, len(split['train']), len(split['val']), len(split['test'])))

    net = UNet().to(device)
    log('parameters: %d' % sum(p.numel() for p in net.parameters()))
    opt = torch.optim.Adam(net.parameters(), lr=LR)
    sched = torch.optim.lr_scheduler.ReduceLROnPlateau(opt, mode='max', factor=0.5, patience=5)
    best, best_epoch, since = -1.0, 0, 0
    ckpt = os.path.join(out_dir, 'best.pt')
    t0 = time.time()
    for epoch in range(1, MAX_EPOCHS + 1):
        net.train()
        jobs = [n for n in split['train'] for _ in range(CROPS_PER_IMAGE)]
        rng.shuffle(jobs)
        total, batches = 0.0, 0
        for b in range(0, len(jobs) - BATCH + 1, BATCH):
            pairs = [augment(*data[n], rng) for n in jobs[b:b + BATCH]]
            x = torch.from_numpy(np.stack([p[0] for p in pairs]))[:, None].to(device)
            y = torch.from_numpy(np.stack([p[1] for p in pairs]))[:, None].to(device)
            loss = bce_dice_loss(net(x), y)
            opt.zero_grad()
            loss.backward()
            opt.step()
            total += loss.item()
            batches += 1
        train_loss = total / batches  # mean over the batches actually run

        net.eval()
        val = [per_image_scores(predict_full(net, data[n][0], device), data[n][1])[2] for n in split['val']]
        vd = float(np.mean(val))
        sched.step(vd)
        mark = ''
        if vd > best:
            best, best_epoch, since = vd, epoch, 0
            torch.save(net.state_dict(), ckpt)
            mark = ' *'
        else:
            since += 1
        log('epoch %3d  loss %.4f  val Dice %.4f  lr %.0e  %5.0fs%s' %
            (epoch, train_loss, vd, opt.param_groups[0]['lr'], time.time() - t0, mark))
        if since >= PATIENCE:
            log('early stop: no val Dice gain for %d epochs' % PATIENCE)
            break
    log('best val Dice %.4f at epoch %d; training took %.0f s' % (best, best_epoch, time.time() - t0))

    net.load_state_dict(torch.load(ckpt, map_location=device))
    net.eval()

    # Threshold chosen on validation only (reported alongside the fixed 0.5).
    val_probs = {n: predict_full(net, data[n][0], device) for n in split['val']}
    grid = [round(0.05 * i, 2) for i in range(1, 20)]
    val_t = max(grid, key=lambda t: np.mean([per_image_scores(val_probs[n], data[n][1], t)[2] for n in split['val']]))
    log('validation-chosen threshold: %.2f' % val_t)

    prob_dir = os.path.join(out_dir, 'test_probs')
    os.makedirs(prob_dir, exist_ok=True)
    rows = []
    shifts = {}
    for n in split['test']:
        img, truth = data[n]
        prob = predict_full(net, img, device)
        Image.fromarray(common.to_byte(prob)).save(os.path.join(prob_dir, n + '.png'))
        byte = common.to_byte(img)
        otsu_t = common.otsu_threshold(byte)
        row = {'name': n, 'foreground_share': float(truth.mean())}
        for key, pred in (('unet_0.5', prob >= 0.5), ('unet_val_t', prob >= val_t),
                          ('all_background', np.zeros_like(truth)), ('otsu', byte > otsu_t)):
            acc, iou, dice = common.scores(*common.confusion(pred, truth))
            row[key] = {'pixel_accuracy': acc, 'iou': iou, 'dice': dice}
        rows.append(row)
        # Alignment check: Dice of the 0.5 mask shifted by (dy, dx) against the truth.
        for dy in range(-2, 3):
            for dx in range(-2, 3):
                pred = np.roll(prob >= 0.5, (dy, dx), axis=(0, 1))
                shifts.setdefault((dy, dx), []).append(common.scores(*common.confusion(pred, truth))[2])

    def summary(key, metric):
        v = np.array([r[key][metric] for r in rows])
        return {'mean': float(v.mean()), 'min': float(v.min()), 'max': float(v.max())}

    keys = ('unet_0.5', 'unet_val_t', 'all_background', 'otsu')
    results = {
        'device': device, 'torch': torch.__version__, 'seed': SEED,
        'best_epoch': best_epoch, 'best_val_dice': best, 'val_threshold': val_t,
        'test_summary': {k: {m: summary(k, m) for m in ('pixel_accuracy', 'iou', 'dice')} for k in keys},
        'alignment_mean_dice_by_shift': {'%d,%d' % k: float(np.mean(v)) for k, v in sorted(shifts.items())},
        'test_per_image': rows,
    }
    with open(os.path.join(HERE, 'results.json'), 'w') as f:
        json.dump(results, f, indent=1)

    log('test set, %d images, per-image mean (min-max):' % len(rows))
    for k in keys:
        s = results['test_summary'][k]
        log('  %-15s acc %.3f (%.3f-%.3f)  IoU %.3f (%.3f-%.3f)  Dice %.3f (%.3f-%.3f)' % (
            k, s['pixel_accuracy']['mean'], s['pixel_accuracy']['min'], s['pixel_accuracy']['max'],
            s['iou']['mean'], s['iou']['min'], s['iou']['max'],
            s['dice']['mean'], s['dice']['min'], s['dice']['max']))
    best_shift = max(shifts, key=lambda k: np.mean(shifts[k]))
    log('alignment: mean test Dice is highest at shift %s (0,0 means aligned): %.4f vs %.4f at (0,1)' % (
        best_shift, np.mean(shifts[best_shift]), np.mean(shifts[(0, 1)])))
    with open(os.path.join(HERE, 'log.txt'), 'w') as f:
        f.write('\n'.join(log_lines) + '\n')


if __name__ == '__main__':
    main()
