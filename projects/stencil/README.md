# Stencil

A small U-Net outlines cell nuclei in fluorescence microscope images. On the page you slide
the threshold that turns its probability map into a mask, and watch pixel accuracy, IoU and
Dice recomputed from the pixels as you go. A "Predict nothing" button and an Otsu baseline sit
beside the model.

## What it’s for

Segmentation is for finding and outlining cells, so the score has to reward finding and
outlining cells. In these images 3–30% of pixels are nucleus, so a model that calls every
pixel background already gets 0.70–0.96 pixel accuracy and a Dice of exactly zero. The page
lets a visitor see that gap with their own hands: press "Predict nothing" and pixel accuracy
barely drops while Dice falls to zero. The threshold slider is honest about a less dramatic
fact: this U-Net is confident, so across the slider both scores move only a little and agree
on the best cut. Pixel accuracy fails not by ranking thresholds wrongly but by its floor: it
cannot tell a model that finds every nucleus from one that finds none. A U-Net is only as
honest as the number used to judge it.

## What the original got wrong, and what changed

This revives an old course-assignment repository (`U-Net`) of mine. No code was reused; the
model, training and evaluation were written again from scratch. The original's bone-marrow
scans (BMMC) carry no stated licence, so they are not used or published here.

| The original | Now |
| --- | --- |
| The model ended in a sigmoid and the loss applied a softmax on top of it, so the highest probability it could ever give was about 0.73 and the loss could not fall below about 0.31. | The network ends in raw logits. The loss is `binary_cross_entropy_with_logits` plus a soft Dice term, applied once. |
| Unpadded convolutions with a mirror-padded mosaic that was cropped back to the original tile, so outputs and labels were misaligned. | Same-padding convolutions: an H×W input gives an H×W output. Whole images are reflect-padded on the bottom and right to a multiple of 16 and the same rows and columns are cropped off. Checked: shifting the test predictions by one pixel in any direction lowers mean test Dice (0.964 at no shift; 0.936–0.944 one pixel along a row or column; lower still on diagonals). |
| "Augmentation" was one fixed 180° rotation. | Random 256×256 crops, random flips and 90° rotations applied to image and mask together; light gain, offset and gamma jitter on the image only. |
| No metric at all; only a loss and pictures. | Per-image Dice, IoU and pixel accuracy on a held-out test split, against two baselines. |
| Foreground was 3.8–38.9% of pixels, so predicting all background scored 61–96% pixel accuracy, and nobody would have noticed. | Pixel accuracy is reported only next to Dice and IoU and next to the all-background baseline; the page is about exactly this. |
| The test split was the last three files in directory-listing order. | A shuffled split by image with a fixed seed (20261102): 140 train, 30 validation, 30 test. Every file's SHA-256 is recorded in `train/split.json`. (BBBC039's own recommended split was not used; see "How I know".) |
| The epoch loss was divided by `i` instead of `i + 1`. | The epoch loss is the mean over the batches actually run. |

## How I know

**Data.** BBBC039v1 from the Broad Bioimage Benchmark Collection: 200 fields of U2OS cells,
Hoechst 33342 (DNA) channel, 520×696 pixels, 16-bit TIFF, with about 23,000 hand-annotated
nuclei. Licence: CC0 1.0. The masks are PNGs whose red channel holds a small colour index per
nucleus, with touching nuclei given different colours; foreground is "index > 0" and single
nuclei are the 4-connected components of each index. The images come from the screen
published as BBBC022, whose page gives a 20× objective and 0.656 µm per pixel; the scale bar
uses that figure. The BBBC039 page itself does not state the pixel size, so the bar is only as
right as that link.

**Model and training** (`train/train.py`, `train/common.py`). A 4-level U-Net, 16 channels at
the top, 1.94 million parameters, batch norm and ReLU, transposed-convolution upsampling.
Adam at 1e-3, halved when validation Dice stalls for 5 epochs, early stopping after 15 epochs
without a gain. On an RTX 2060 it ran 45 epochs in 6 minutes; the best validation Dice was
0.970 at epoch 30. `train/log.txt` is the full log and `train/results.json` has every
per-image number. The weights (7.8 MB) are not kept in the repository.

**Test results** (30 test images, per-image mean, threshold 0.5 fixed in advance):

| | Pixel accuracy | IoU | Dice |
| --- | --- | --- | --- |
| U-Net | 0.984 (0.882–1.000) | 0.932 (0.701–1.000) | 0.964 (0.824–1.000) |
| Otsu threshold | 0.945 (0.339–0.999) | 0.822 (0.000–0.954) | 0.867 (0.000–0.976) |
| All background | 0.811 (0.702–1.000) | 0.033 (0.000–1.000) | 0.033 (0.000–1.000) |

One test field (`IXMtest_F13_s7`) has no annotated nuclei; with nothing to find and nothing
found, Dice and IoU are 1 by convention, which is where the all-background row's 0.033 comes
from. Leaving that field out, all-background scores 0.805 pixel accuracy and Dice 0 on every
one of the other 29, the U-Net 0.963 Dice and Otsu 0.897. The threshold that maximised
validation Dice was 0.55; on test it changes the U-Net's mean Dice by less than 0.001. Otsu
fails on two fields with nuclei: Dice 0.003 on `F22_s6` and 0.373 on `E05_s2` (over whole
fields). `F22_s6` has a very bright object near its left edge, which is the likely reason,
though I have not proved it. On the empty field Otsu calls about two thirds of the image
nucleus (pixel accuracy 0.339 with nothing to find). The page's Otsu baseline uses the cut
chosen from the whole field, as these test numbers do, and applies it to the crop: on the
page's crop of `F22_s6` (field f4) that gives Dice 0.006 and pixel accuracy 0.774. An earlier
version recomputed the cut from the crop's own histogram, which gave Dice 0.90 there and made
Otsu look about as good as the U-Net. On the other seven crops the whole-field cut gives
Otsu Dice 0.93–0.97, close to the U-Net's: on clean, evenly lit fields a single brightness
cut does well, and it is fragile rather than bad.

**The split.** BBBC039 ships its own training, validation and test lists
(`metadata/training.txt` etc.: 100 / 50 / 50) and recommends them for comparable results. I
did not use them; my seeded split puts 13 official-training and 7 official-validation images
in my test set, so these numbers are not comparable with published BBBC039 results. The split
is also by image, not by well: 7 of the 28 wells in my test set also have a site in training
(9 in training or validation), and two of the page's fields (f5, well I15; f7, well M12) have a
same-well site in training. Sites in one well can be near-replicates, so the test scores may
be slightly optimistic. "Never seen in training" on the page is true per image, which the
hash check enforces, not per well.

**The browser demo** (`train/export.py`, `model.js`, `app.js`). Eight test fields, evenly
spaced by nucleus share, skipping near-empty ones; the same 384×512 centre crop of each. Each
is shipped as three 8-bit grayscale PNGs: the raw image (1st–99.8th percentile stretch of the
16-bit original), the true mask, and the U-Net probability rounded to `round(p × 255)`. About
1 MB in all. The page's threshold rule is "probability byte ≥ t × 255". Every number on the
page (pixel accuracy, IoU, Dice, the changes from t = 0.50, the sweep chart, the Otsu mask and
its threshold, the blob counts, the table) is computed in the browser from those pixels when
a control moves. The only stored per-field facts are provenance (file name, hashes, plate,
well, site, crop), the number of annotated nuclei in the crop, and the byte at which Otsu's
method cut the whole field (the crop alone cannot reproduce it); the Otsu mask and its
scores are computed from that cut on the page. The table's per-field scores are read from a
per-field histogram sweep computed once in the browser (exactly the same counts as
thresholding the pixels, which the tests check); the viewed field is recomputed pixel by
pixel, and other fields' blob counts are filled in once the slider rests.

**Checks** (`node projects/stencil/tests/run.js`):

- `shipped.test.js`: decodes the shipped PNGs in Node and, for every field and all 99 slider
  thresholds, checks that `model.js` gives the same TP/FP/FN/TN counts as Python and the same
  pixel accuracy, IoU and Dice to 1e-6 (2,376 values; in practice they are identical). Also
  the Otsu threshold and scores, the blob counts, the fast histogram path used by the chart,
  and that predicting nothing gives Dice 0 and pixel accuracy equal to 1 − nucleus share. The
  Otsu check uses the whole-field cut recorded in the manifest; model.js's own Otsu is still
  checked against Python on each crop. It
  also checks the PNGs carry no gamma or colour-profile chunk a browser might apply. In
  Chrome I ran the same comparison on the bytes the page itself decoded: maximum difference 0.
- `split.test.js`: the three splits share no image (by SHA-256), and every shipped field's
  source image and mask hash is in the test split and in neither training nor validation.
  With `STENCIL_RAW` set to the BBBC039 folder it recomputes all 200 image and mask hashes.
- `static.test.js`: the manifest has no metric fields, the page never loads the Python
  reference or results, the readouts start empty in the HTML, no external requests, lede
  length, size budgets.
- `model.test.js`: hand-worked cases for each metric, the thresholding rule, blob counting,
  Otsu and the error map.
- `claims.test.js`: the prose against the data. It recomputes, from the shipped PNGs, how far
  Dice moves across the slider (at most 0.146) and fails if the page claims a "swing"; checks
  that choosing the cut by pixel accuracy costs at most 0.005 Dice before the lede may say the
  two "agree on the best cut" (it costs at most 0.0005); checks the predict-nothing range
  quoted in the lede and meta description (0.70–0.96); and checks the card's still frame is
  the predict-nothing one and that the table's slider path does no per-pixel work.

**What is simplified.**

- Eight crops from one public set of one cell line, imaged one way. The page shows how the
  metrics behave; it says nothing about how this model would do on other cells, stains or
  microscopes.
- The model's probabilities are confident, so on these fields Dice moves by 0.05–0.15 across
  the whole slider (0.01–0.99) and only 0.012–0.021 between 0.10 and 0.90, while pixel
  accuracy moves 0.01–0.05. The two scores peak at the same threshold on 5 of 8 fields, and
  choosing the cut by pixel accuracy never costs more than 0.0005 Dice. What drops to zero is
  "predict nothing". An earlier version of the page said Dice and IoU "swing" across the
  slider; the data did not support that, and the wording now says what the data shows. The
  chart's y axis starts at 0.6 so the curves' shapes are visible; it says so beside the chart.
- Pixel scores treat the image as one bag of pixels. A binary mask merges touching nuclei, so
  even the true mask counts fewer blobs than there are nuclei; the page says this. Blobs
  under 20 pixels are not counted. A proper instance metric (matched objects, F1 at an IoU
  cut-off, as in Caicedo et al.) would judge splitting and merging directly; the page does not
  compute one.
- Probabilities are quantised to 8 bits for shipping, so the slider's 0.01 steps sometimes
  select the same pixels.
- Validation Dice was measured at threshold 0.5 on whole images; the training crops are
  256×256.

**What would change the conclusion.** If the nucleus share were near half the image, pixel
accuracy would track Dice much more closely and the gap would shrink; the point of the page
is that in microscopy it rarely is. A metric that weights nucleus and background pixels
equally (balanced accuracy) would also close much of the gap.

**How to rerun.** With Python 3.11+ and PyTorch, NumPy and Pillow:
`python train/train.py <BBBC039 folder> <work folder>`, then
`python train/export.py <BBBC039 folder> <work folder>/test_probs`. Then run the Node tests.
GPU nondeterminism means a rerun will give slightly different weights and numbers.

## Sources

- Caicedo JC, Roth J, Goodman A, Becker T, Karhohs KW, Broisin M, Molnar C, McQuin C, Singh S,
  Theis FJ, Carpenter AE. Evaluation of Deep Learning Strategies for Nucleus Segmentation in
  Fluorescence Images. Cytometry Part A 95(9):952–965, 2019. (Preprint on bioRxiv, 2018:
  https://doi.org/10.1101/335216.) The BBBC039 data set.
- Ljosa V, Sokolnicki KL, Carpenter AE. Annotated high-throughput microscopy image sets for
  validation. Nature Methods 9:637, 2012. https://doi.org/10.1038/nmeth.2083
- BBBC039, Broad Bioimage Benchmark Collection: https://bbbc.broadinstitute.org/BBBC039
  ("We used image set BBBC039v1 Caicedo et al. 2018, available from the Broad Bioimage
  Benchmark Collection [Ljosa et al., Nature Methods, 2012]." CC0.)
- BBBC022, Broad Bioimage Benchmark Collection: https://bbbc.broadinstitute.org/BBBC022
  (objective and pixel size).
- Ronneberger O, Fischer P, Brox T. U-Net: Convolutional Networks for Biomedical Image
  Segmentation. MICCAI 2015.
- Otsu N. A Threshold Selection Method from Gray-Level Histograms. IEEE Transactions on
  Systems, Man, and Cybernetics 9(1):62–66, 1979.
- Fonts: IBM Plex Mono and IBM Plex Sans Condensed (IBM, SIL Open Font License 1.1), from
  Fontsource 5.2.7; licence in `fonts/OFL.txt`.
