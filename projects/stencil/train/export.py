"""Export the browser demo's images and the Python reference metrics.

Usage:  python export.py RAW_DIR PROB_DIR
  RAW_DIR   BBBC039 (images/, masks/, metadata/)
  PROB_DIR  test-set probability maps written by train.py (OUT_DIR/test_probs)

Picks 8 test images (evenly spaced by nucleus share, skipping near-empty fields), takes the
same 384 x 512 centre crop of each, and writes for each one:
  ../data/<id>-raw.png    8-bit Hoechst image (1st-99.8th percentile stretch of the 16-bit TIFF)
  ../data/<id>-truth.png  annotated nuclei, 255 = nucleus
  ../data/<id>-prob.png   U-Net probability, round(p * 255)
plus ../data/manifest.js (provenance only; no metric values) and
../tests/python_reference.json (metrics computed here, for the Node tests to match).
"""
import csv
import json
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common  # noqa: E402

N_DEMO = 8
CROP_H, CROP_W = 384, 512
MIN_AREA = 20  # same as model.js


def main():
    raw_dir, prob_dir = sys.argv[1], sys.argv[2]
    stencil = os.path.dirname(HERE)
    data_dir = os.path.join(stencil, 'data')
    os.makedirs(data_dir, exist_ok=True)
    with open(os.path.join(HERE, 'split.json')) as f:
        split = json.load(f)
    plates = {}
    with open(os.path.join(raw_dir, 'metadata', 'filenames_and_plates.csv')) as f:
        for row in csv.reader(f):
            if len(row) >= 2:
                plates[row[0][:-4]] = row[1]

    test = split['splits']['test']
    shares = []
    for item in test:
        fg = np.asarray(Image.open(os.path.join(raw_dir, 'masks', item['name'] + '.png')))[..., 0] > 0
        shares.append((float(fg.mean()), item))
    usable = sorted([s for s in shares if s[0] >= 0.02], key=lambda s: s[0])
    picks = [usable[int(round(i * (len(usable) - 1) / (N_DEMO - 1)))] for i in range(N_DEMO)]

    thresholds = [float('%.2f' % (k / 100)) for k in range(1, 100)]
    manifest = {
        'dataset': 'BBBC039v1',
        'licence': 'CC0 1.0',
        'cells': 'U2OS',
        'stain': 'Hoechst 33342 (DNA)',
        'objective': '20x',
        'um_per_px': 0.656,
        'crop': [CROP_H, CROP_W],
        'min_area_px': MIN_AREA,
        'images': [],
    }
    reference = {'thresholds': thresholds, 'count_thresholds': [], 'images': []}
    count_ts = [float('%.2f' % (k / 100)) for k in range(5, 100, 5)]
    reference['count_thresholds'] = count_ts

    for idx, (share, item) in enumerate(sorted(picks, key=lambda s: s[1]['name'])):
        name = item['name']
        assert common.sha256(os.path.join(raw_dir, 'images', name + '.tif')) == item['image_sha256']
        raw = common.to_byte(common.load_raw(os.path.join(raw_dir, 'images', name + '.tif')))
        # The Otsu baseline's cut comes from the whole field, as in train.py's test numbers.
        # Recomputing it from the crop's own histogram would flatter Otsu (F22_s6: Dice 0.90
        # on the crop's own cut, 0.006 on the whole field's).
        otsu_cut = common.otsu_threshold(raw)
        fg, labels = common.load_labels(os.path.join(raw_dir, 'masks', name + '.png'))
        prob = np.asarray(Image.open(os.path.join(prob_dir, name + '.png')))
        h, w = raw.shape
        y0, x0 = (h - CROP_H) // 2, (w - CROP_W) // 2
        sl = (slice(y0, y0 + CROP_H), slice(x0, x0 + CROP_W))
        raw_c, fg_c, lab_c, prob_c = raw[sl], fg[sl], labels[sl], prob[sl]
        iid = 'f%d' % (idx + 1)
        files = {}
        for kind, arr in (('raw', raw_c), ('truth', fg_c.astype(np.uint8) * 255), ('prob', prob_c)):
            fn = '%s-%s.png' % (iid, kind)
            Image.fromarray(np.ascontiguousarray(arr)).save(os.path.join(data_dir, fn), optimize=True)
            files[kind] = fn
        parts = name.split('_')  # IXMtest_A02_s1_w1<uuid>
        manifest['images'].append({
            'id': iid, 'source': name + '.tif', 'source_sha256': item['image_sha256'],
            'mask_sha256': item['mask_sha256'], 'plate': plates.get(name, ''),
            'well': parts[1], 'site': parts[2][1:], 'crop_xywh': [int(x0), int(y0), CROP_W, CROP_H],
            'annotated_nuclei': common.count_instances(lab_c, MIN_AREA),
            'otsu_cut_whole_field': int(otsu_cut), 'files': files,
        })

        # Reference metrics on exactly the shipped bytes.
        shipped = {k: np.asarray(Image.open(os.path.join(data_dir, f))) for k, f in files.items()}
        truth = shipped['truth'] >= 128
        rows = []
        for t in thresholds:
            pred = common.threshold_bytes(shipped['prob'], t)
            tp, fp, fn, tn = common.confusion(pred, truth)
            acc, iou, dice = common.scores(tp, fp, fn, tn)
            rows.append({'t': t, 'tp': tp, 'fp': fp, 'fn': fn, 'tn': tn, 'accuracy': acc, 'iou': iou, 'dice': dice})
        counts = [common.count_blobs(common.threshold_bytes(shipped['prob'], t), MIN_AREA) for t in count_ts]
        ot = common.otsu_threshold(shipped['raw'])  # crop-only cut, kept to test model.js's Otsu
        otsu = shipped['raw'] > otsu_cut
        nothing = np.zeros_like(truth)
        reference['images'].append({
            'id': iid,
            'unet': rows,
            'unet_counts': counts,
            'otsu_threshold_crop': ot,
            'otsu_cut_whole_field': int(otsu_cut),
            'otsu': dict(zip(('accuracy', 'iou', 'dice'), common.scores(*common.confusion(otsu, truth)))),
            'otsu_count': common.count_blobs(otsu, MIN_AREA),
            'nothing': dict(zip(('accuracy', 'iou', 'dice'), common.scores(*common.confusion(nothing, truth)))),
            'truth_blobs': common.count_blobs(truth, MIN_AREA),
            'foreground_share': float(truth.mean()),
        })
        print(iid, name, 'share %.3f' % share, 'nuclei', manifest['images'][-1]['annotated_nuclei'],
              'Dice@0.5 %.3f' % rows[49]['dice'], 'acc@0.5 %.3f' % rows[49]['accuracy'],
              'nothing acc %.3f' % reference['images'][-1]['nothing']['accuracy'])

    with open(os.path.join(data_dir, 'manifest.js'), 'w') as f:
        f.write('// Written by train/export.py. Provenance only: no metric values live here.\n')
        f.write('window.STENCIL_MANIFEST = ' + json.dumps(manifest, indent=1) + ';\n')
    with open(os.path.join(stencil, 'tests', 'python_reference.json'), 'w') as f:
        json.dump(reference, f)


if __name__ == '__main__':
    main()
