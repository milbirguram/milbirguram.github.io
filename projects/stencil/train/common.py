"""Shared helpers for Stencil's training and export scripts.

Everything here is plain NumPy and Pillow so the metric definitions can be read in one
place and matched line for line by ../model.js.
"""
import hashlib
from collections import deque

import numpy as np
from PIL import Image


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def load_raw(path):
    """16-bit Hoechst image -> float32 in [0, 1] after a per-image 1st-99.8th percentile stretch."""
    a = np.asarray(Image.open(path)).astype(np.float32)
    lo, hi = np.percentile(a, [1.0, 99.8])
    return np.clip((a - lo) / max(hi - lo, 1.0), 0.0, 1.0).astype(np.float32)


def to_byte(x):
    """[0, 1] float -> uint8, rounding half up so it is easy to reproduce anywhere."""
    return np.floor(np.clip(x, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)


def load_labels(path):
    """BBBC039 masks: the red channel holds a small colour index per nucleus, chosen so
    that touching nuclei get different colours. Returns (foreground bool, instance labels).
    Instances are the 4-connected components of each colour index."""
    r = np.asarray(Image.open(path))[..., 0]
    labels = np.zeros(r.shape, np.int32)
    n = 0
    for colour in np.unique(r):
        if colour == 0:
            continue
        comp, k = components(r == colour)
        labels[comp > 0] = comp[comp > 0] + n
        n += k
    return r > 0, labels


def components(mask):
    """4-connected components of a boolean mask. Returns (labels int32, count)."""
    h, w = mask.shape
    flat = mask.ravel()
    lab = np.zeros(h * w, np.int32)
    n = 0
    for start in np.flatnonzero(flat):
        if lab[start]:
            continue
        n += 1
        lab[start] = n
        q = deque([start])
        while q:
            i = q.popleft()
            y, x = divmod(int(i), w)
            for j, ok in ((i - w, y > 0), (i + w, y < h - 1), (i - 1, x > 0), (i + 1, x < w - 1)):
                if ok and flat[j] and not lab[j]:
                    lab[j] = n
                    q.append(j)
    return lab.reshape(h, w), n


def count_blobs(mask, min_area):
    """Number of 4-connected components with at least min_area pixels."""
    lab, n = components(mask)
    if n == 0:
        return 0
    sizes = np.bincount(lab.ravel())[1:]
    return int((sizes >= min_area).sum())


def count_instances(labels, min_area):
    """Number of annotated nuclei with at least min_area pixels inside the array."""
    sizes = np.bincount(labels.ravel())[1:]
    return int((sizes >= min_area).sum())


def otsu_threshold(byte_img):
    """Otsu's threshold on a uint8 image: the t (0..254) that maximises between-class
    variance of {v <= t} vs {v > t}; the first maximum wins. Foreground is v > t."""
    hist = np.bincount(byte_img.ravel(), minlength=256).astype(np.float64)
    total = hist.sum()
    sum_all = float(np.dot(np.arange(256), hist))
    w0 = 0.0
    sum0 = 0.0
    best_t, best = 0, -1.0
    for t in range(255):
        w0 += hist[t]
        sum0 += t * hist[t]
        w1 = total - w0
        if w0 == 0 or w1 == 0:
            continue
        m0 = sum0 / w0
        m1 = (sum_all - sum0) / w1
        between = w0 * w1 * (m0 - m1) ** 2
        if between > best:
            best, best_t = between, t
    return best_t


def confusion(pred, truth):
    pred = pred.astype(bool)
    truth = truth.astype(bool)
    tp = int(np.count_nonzero(pred & truth))
    fp = int(np.count_nonzero(pred & ~truth))
    fn = int(np.count_nonzero(~pred & truth))
    tn = int(pred.size - tp - fp - fn)
    return tp, fp, fn, tn


def scores(tp, fp, fn, tn):
    """Pixel accuracy, IoU and Dice. When prediction and truth are both empty, IoU and
    Dice are 1 by convention (nothing to find, nothing found)."""
    n = tp + fp + fn + tn
    acc = (tp + tn) / n
    iou = tp / (tp + fp + fn) if (tp + fp + fn) else 1.0
    dice = 2 * tp / (2 * tp + fp + fn) if (2 * tp + fp + fn) else 1.0
    return acc, iou, dice


def threshold_bytes(prob_bytes, t):
    """The page's rule: a pixel is predicted 'nucleus' when its 8-bit probability
    byte >= t * 255 (t a double in [0, 1])."""
    return prob_bytes.astype(np.float64) >= t * 255.0
