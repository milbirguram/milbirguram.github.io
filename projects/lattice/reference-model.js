/* Exact inference and causal interventions for train.py's exported weights.
 * No network, randomness or DOM. UMD for browser and Node validation.
 */
(function (root) {
  'use strict';
  function integer(value, min, max, label) {
    if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(label);
  }
  function infer(data, weights, a, b) {
    var p = data.modulus, h = data.width;
    integer(a, 0, p - 1, 'a'); integer(b, 0, p - 1, 'b');
    var hidden = new Float64Array(h), logits = new Float64Array(p);
    var j, c, sum;
    for (j = 0; j < h; j++) {
      sum = weights.E[a * h + j] + weights.E[b * h + j];
      hidden[j] = sum * sum;
      for (c = 0; c < p; c++) logits[c] += hidden[j] * weights.U[j * p + c];
    }
    var best = 0;
    for (c = 1; c < p; c++) if (logits[c] > logits[best]) best = c;
    var maximum = logits[best], denominator = 0, probabilities = new Float64Array(p);
    for (c = 0; c < p; c++) { probabilities[c] = Math.exp(logits[c] - maximum); denominator += probabilities[c]; }
    for (c = 0; c < p; c++) probabilities[c] /= denominator;
    var target = (a + b) % p;
    return {prediction: best, target: target, correct: best === target,
      loss: Math.log(denominator) + maximum - logits[target],
      logits: logits, probabilities: probabilities, hidden: hidden};
  }
  function evaluate(data, weights, pairs) {
    pairs = pairs || data.split.testPairs;
    var count = 0, loss = 0, predictions = [];
    pairs.forEach(function (pair) {
      var result = infer(data, weights, pair[0], pair[1]);
      if (result.correct) count++;
      loss += result.loss; predictions.push(result.prediction);
    });
    return {accuracy: count / pairs.length, loss: loss / pairs.length,
      correct: count, total: pairs.length, predictions: predictions};
  }
  function components(data, weights, frequency) {
    var p = data.modulus, h = data.width;
    integer(frequency, 1, Math.floor(p / 2), 'frequency');
    var cosine = new Float64Array(h), sine = new Float64Array(h), mean = new Float64Array(h);
    for (var i = 0; i < p; i++) {
      var angle = 2 * Math.PI * frequency * i / p;
      for (var j = 0; j < h; j++) {
        var value = weights.E[i * h + j];
        cosine[j] += 2 / p * Math.cos(angle) * value;
        sine[j] += 2 / p * Math.sin(angle) * value;
        mean[j] += value / p;
      }
    }
    return {cosine: cosine, sine: sine, mean: mean};
  }
  function ablate(data, weights, frequency, mode) {
    if (mode !== 'remove' && mode !== 'only') throw new RangeError('mode');
    var p = data.modulus, h = data.width, basis = components(data, weights, frequency);
    var embedding = new Float64Array(p * h);
    for (var i = 0; i < p; i++) {
      var angle = 2 * Math.PI * frequency * i / p;
      for (var j = 0; j < h; j++) {
        var contribution = Math.cos(angle) * basis.cosine[j] + Math.sin(angle) * basis.sine[j];
        embedding[i * h + j] = mode === 'remove' ? weights.E[i * h + j] - contribution : basis.mean[j] + contribution;
      }
    }
    return {E: embedding, U: weights.U, step: weights.step};
  }
  // One fixed control direction per frequency, shared across runs/checkpoints.
  // Its L2/Frobenius length equals the removed Fourier component's length.
  // Projecting out DC and the selected band prevents accidentally removing it.
  function control(data, weights, frequency) {
    var p = data.modulus, h = data.width;
    integer(frequency, 1, Math.floor(p / 2), 'frequency');
    var seed = (0x9e3779b9 ^ Math.imul(frequency, 0x85ebca6b)) >>> 0;
    var state = seed, random = new Float64Array(p * h), i, j;
    for (i = 0; i < random.length; i++) {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      random[i] = (state >>> 0) / 4294967296 * 2 - 1;
    }
    var randomBasis = components(data, {E: random}, frequency);
    var targetBasis = components(data, weights, frequency);
    var normRandom = 0, normTarget = 0;
    for (i = 0; i < p; i++) {
      var angle = 2 * Math.PI * frequency * i / p, c = Math.cos(angle), s = Math.sin(angle);
      for (j = 0; j < h; j++) {
        var ix = i * h + j;
        random[ix] -= randomBasis.mean[j] + c * randomBasis.cosine[j] + s * randomBasis.sine[j];
        var component = c * targetBasis.cosine[j] + s * targetBasis.sine[j];
        normRandom += random[ix] * random[ix]; normTarget += component * component;
      }
    }
    var scale = Math.sqrt(normTarget / normRandom), changed = new Float64Array(p * h);
    for (i = 0; i < changed.length; i++) changed[i] = weights.E[i] - scale * random[i];
    return {E: changed, U: weights.U, step: weights.step, controlSeed: seed};
  }
  function nearestPowerControl(checkpoint, frequency) {
    var selected = checkpoint.frequencyPower[frequency - 1], best = null, distance = Infinity;
    checkpoint.frequencyPower.forEach(function (power, i) {
      if (i + 1 === frequency) return;
      var delta = Math.abs(power - selected);
      if (delta < distance) { distance = delta; best = i + 1; }
    });
    return best;
  }
  var api = {infer: infer, evaluate: evaluate, components: components,
    ablate: ablate, control: control, nearestPowerControl: nearestPowerControl};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LatticeReference = api;
})(typeof window !== 'undefined' ? window : globalThis);
