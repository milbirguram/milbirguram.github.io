/* Stencil model: segmentation metrics computed from 8-bit images.
 *
 * Every number the page shows comes from these functions, run on the shipped PNGs at the
 * moment the slider moves. The definitions match train/common.py line for line, and
 * tests/ checks the two agree on every shipped image.
 *
 * Works in the browser (window.StencilModel) and in Node (module.exports).
 */
(function (root) {
  'use strict';

  // Blobs smaller than this many pixels are not counted as nuclei (about 8.6 square
  // micrometres at 0.656 um per pixel; a typical nucleus here is several hundred pixels).
  var MIN_AREA = 20;

  // The page's thresholding rule: a pixel is called "nucleus" when its probability byte
  // is >= t * 255. Writes 1 or 0 into out (Uint8Array) and returns it.
  function threshold(prob, t, out) {
    var n = prob.length, cut = t * 255;
    out = out || new Uint8Array(n);
    for (var i = 0; i < n; i++) out[i] = prob[i] >= cut ? 1 : 0;
    return out;
  }

  function empty(n) { return new Uint8Array(n); }

  // Counts of true positives, false positives, false negatives and true negatives.
  function confusion(pred, truth) {
    var tp = 0, fp = 0, fn = 0, n = pred.length;
    for (var i = 0; i < n; i++) {
      var p = pred[i] !== 0, g = truth[i] !== 0;
      if (p) { if (g) tp++; else fp++; } else if (g) fn++;
    }
    return { tp: tp, fp: fp, fn: fn, tn: n - tp - fp - fn };
  }

  // Pixel accuracy, IoU and Dice. With nothing to find and nothing found, IoU and Dice
  // are 1 by convention.
  function scores(c) {
    var n = c.tp + c.fp + c.fn + c.tn;
    var u = c.tp + c.fp + c.fn;
    var d = 2 * c.tp + c.fp + c.fn;
    return {
      accuracy: (c.tp + c.tn) / n,
      iou: u ? c.tp / u : 1,
      dice: d ? 2 * c.tp / d : 1
    };
  }

  // Otsu's threshold on 8-bit data: the t in 0..254 that maximises the between-class
  // variance of {v <= t} and {v > t}; the first maximum wins.
  function otsuThreshold(bytes) {
    var hist = new Float64Array(256), i, n = bytes.length;
    for (i = 0; i < n; i++) hist[bytes[i]]++;
    var sumAll = 0;
    for (i = 0; i < 256; i++) sumAll += i * hist[i];
    var w0 = 0, sum0 = 0, best = -1, bestT = 0;
    for (var t = 0; t < 255; t++) {
      w0 += hist[t];
      sum0 += t * hist[t];
      var w1 = n - w0;
      if (w0 === 0 || w1 === 0) continue;
      var m0 = sum0 / w0, m1 = (sumAll - sum0) / w1;
      var between = w0 * w1 * (m0 - m1) * (m0 - m1);
      if (between > best) { best = between; bestT = t; }
    }
    return bestT;
  }

  // Foreground is "byte > cut" (Otsu's convention). The page passes the cut Otsu chose
  // from the whole field's histogram (recorded by train/export.py), not the crop's.
  function aboveCut(bytes, cut, out) {
    var n = bytes.length;
    out = out || new Uint8Array(n);
    for (var i = 0; i < n; i++) out[i] = bytes[i] > cut ? 1 : 0;
    return out;
  }

  function otsuMask(raw, out) { return aboveCut(raw, otsuThreshold(raw), out); }

  // Index into sliderThresholds() / sweep() for a slider value t (0.01 .. 0.99).
  function sweepIndex(t) { return Math.round(t * 100) - 1; }

  // The thresholds at which a sweep's Dice and pixel accuracy peak (first maximum wins).
  function bestThresholds(sw) {
    var bd = 0, ba = 0;
    for (var j = 1; j < sw.length; j++) {
      if (sw[j].dice > sw[bd].dice) bd = j;
      if (sw[j].accuracy > sw[ba].accuracy) ba = j;
    }
    return { dice: sw[bd].t, accuracy: sw[ba].t };
  }

  // Number of 4-connected blobs with at least minArea pixels. labels is optional scratch
  // space (Int32Array of the same length) so repeated calls do not allocate.
  function countBlobs(mask, w, h, minArea, labels, stack) {
    var n = w * h;
    if (minArea == null) minArea = MIN_AREA;
    labels = labels || new Int32Array(n);
    stack = stack || new Int32Array(n);
    labels.fill(0);
    var count = 0, next = 0;
    for (var s = 0; s < n; s++) {
      if (!mask[s] || labels[s]) continue;
      next++;
      var top = 0, area = 0;
      stack[top++] = s;
      labels[s] = next;
      while (top) {
        var i = stack[--top];
        area++;
        var x = i % w;
        if (i >= w && mask[i - w] && !labels[i - w]) { labels[i - w] = next; stack[top++] = i - w; }
        if (i < n - w && mask[i + w] && !labels[i + w]) { labels[i + w] = next; stack[top++] = i + w; }
        if (x > 0 && mask[i - 1] && !labels[i - 1]) { labels[i - 1] = next; stack[top++] = i - 1; }
        if (x < w - 1 && mask[i + 1] && !labels[i + 1]) { labels[i + 1] = next; stack[top++] = i + 1; }
      }
      if (area >= minArea) count++;
    }
    return count;
  }

  // Error map: 0 true negative, 1 true positive, 2 false positive, 3 false negative.
  function errorMap(pred, truth, out) {
    var n = pred.length;
    out = out || new Uint8Array(n);
    for (var i = 0; i < n; i++) {
      var p = pred[i] !== 0, g = truth[i] !== 0;
      out[i] = p ? (g ? 1 : 2) : (g ? 3 : 0);
    }
    return out;
  }

  // Scores at many thresholds at once, from per-byte histograms of nucleus and background
  // pixels. Gives exactly the same counts as threshold() + confusion() at each t.
  function sweep(prob, truth, ts) {
    var fgH = new Float64Array(256), bgH = new Float64Array(256), i, n = prob.length;
    for (i = 0; i < n; i++) { if (truth[i]) fgH[prob[i]]++; else bgH[prob[i]]++; }
    var fgAbove = new Float64Array(257), bgAbove = new Float64Array(257);
    for (i = 255; i >= 0; i--) { fgAbove[i] = fgAbove[i + 1] + fgH[i]; bgAbove[i] = bgAbove[i + 1] + bgH[i]; }
    var fgAll = fgAbove[0];
    return ts.map(function (t) {
      // smallest byte b with b >= t * 255
      var cut = t * 255, b = 0;
      while (b < 256 && !(b >= cut)) b++;
      var tp = fgAbove[b], fp = bgAbove[b], fn = fgAll - tp;
      var s = scores({ tp: tp, fp: fp, fn: fn, tn: n - tp - fp - fn });
      s.t = t;
      return s;
    });
  }

  // The red channel of RGBA pixel data (what a canvas returns for a grayscale PNG).
  function redChannel(rgba, out) {
    var n = rgba.length >> 2;
    out = out || new Uint8Array(n);
    for (var i = 0; i < n; i++) out[i] = rgba[i << 2];
    return out;
  }

  function binarise(bytes, out) {
    var n = bytes.length;
    out = out || new Uint8Array(n);
    for (var i = 0; i < n; i++) out[i] = bytes[i] >= 128 ? 1 : 0;
    return out;
  }

  // Thresholds on the slider: 0.01 steps from 0.01 to 0.99, as doubles parsed from text,
  // so the browser, Node and Python all hold the very same values.
  function sliderThresholds() {
    var out = [];
    for (var k = 1; k <= 99; k++) out.push(parseFloat((k / 100).toFixed(2)));
    return out;
  }

  var api = {
    MIN_AREA: MIN_AREA,
    threshold: threshold,
    empty: empty,
    confusion: confusion,
    scores: scores,
    otsuThreshold: otsuThreshold,
    otsuMask: otsuMask,
    aboveCut: aboveCut,
    sweepIndex: sweepIndex,
    bestThresholds: bestThresholds,
    countBlobs: countBlobs,
    errorMap: errorMap,
    sweep: sweep,
    redChannel: redChannel,
    binarise: binarise,
    sliderThresholds: sliderThresholds
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StencilModel = api;
})(typeof window !== 'undefined' ? window : this);
