// Facade: scoring and barn geometry. No DOM here, so Node tests can load it.
//
// Scoring is one rule, the "no luck" rule:
//   the answer is false                                   -> 'wrong'
//   the answer is true and the basis tracks its truthmaker -> 'knew'
//   the answer is true and the basis does not              -> 'lucky' (right by luck)
//
// Barn geometry: each barn is a front (a gable wall) of width w, wall height h and roof rise r,
// standing at x = 0 on the ground. A real barn has depth d behind that front. A facade has
// none: only a thin board, propped from behind by struts. The view can swing round a vertical
// axis by angle theta; at theta = 0 (the view from the road) depth is invisible, so a facade and
// a real barn project to exactly the same front.
(function (root) {
  'use strict';

  var OUTCOMES = {
    knew: { label: 'Knew', mark: '✓' },
    lucky: { label: 'Right by luck', mark: '≈' },
    wrong: { label: 'Wrong', mark: '✗' }
  };

  function findAnswer(c, answerId) {
    for (var i = 0; i < c.answers.length; i++) if (c.answers[i].id === answerId) return c.answers[i];
    return null;
  }

  function findBasis(answer, basisId) {
    if (!answer) return null;
    for (var i = 0; i < answer.bases.length; i++) if (answer.bases[i].id === basisId) return answer.bases[i];
    return null;
  }

  function outcome(c, answerId, basisId) {
    var a = findAnswer(c, answerId);
    var b = findBasis(a, basisId);
    if (!a || !b) throw new Error('Unknown answer or basis: ' + c.id + ' ' + answerId + '/' + basisId);
    if (!a.correct) return 'wrong';
    return b.tracks ? 'knew' : 'lucky';
  }

  // Every (answer, basis) pair a visitor can pick, as 'answer/basis' keys.
  function combos(c) {
    var out = [];
    c.answers.forEach(function (a) {
      a.bases.forEach(function (b) { out.push(a.id + '/' + b.id); });
    });
    return out;
  }

  // The best Knew score anyone can reach: cases where some basis for the true answer tracks.
  function maxKnew(cases) {
    return cases.filter(function (c) {
      return c.answers.some(function (a) {
        return a.correct && a.bases.some(function (b) { return b.tracks; });
      });
    }).length;
  }

  // responses: { caseId: { answer, basis } }. Unanswered cases are skipped.
  function score(cases, responses) {
    var s = { total: cases.length, answered: 0, right: 0, knew: 0, lucky: 0, wrong: 0, perCase: [] };
    cases.forEach(function (c) {
      var r = responses[c.id];
      if (!r) return;
      var o = outcome(c, r.answer, r.basis);
      s.answered++;
      s[o]++;
      if (o !== 'wrong') s.right++;
      s.perCase.push({ id: c.id, outcome: o });
    });
    s.maxKnew = maxKnew(cases);
    return s;
  }

  // ---- The final reflection --------------------------------------------------------------
  // Built only from what the visitor chose. Returns plain-text paragraphs.

  var NUMBER_WORDS = ['none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  function num(n) { return NUMBER_WORDS[n] || String(n); }
  function Num(n) { var w = num(n); return w.charAt(0).toUpperCase() + w.slice(1); }
  function times(n) { return n === 1 ? 'once' : n === 2 ? 'twice' : num(n) + ' times'; }
  function listJoin(xs) {
    if (xs.length <= 1) return xs.join('');
    return xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];
  }

  function reflect(cases, responses) {
    var s = score(cases, responses);
    var N = cases.length;
    var lucky = [], missed = [], justifiedWrong = 0;
    cases.forEach(function (c) {
      var r = responses[c.id];
      if (!r) return;
      var a = findAnswer(c, r.answer), b = findBasis(a, r.basis);
      var o = outcome(c, r.answer, r.basis);
      if (o === 'lucky') lucky.push(b);
      if (o === 'wrong' && b.source === 'evidence') justifiedWrong++;
      var knowable = c.answers.some(function (x) { return x.correct && x.bases.some(function (y) { return y.tracks; }); });
      if (knowable && o !== 'knew') missed.push('“' + c.title + '”');
    });

    var paras = [];
    if (s.right === 0) {
      paras.push('None of your answers were true, so both scores stayed at nothing. In two of the cases the evidence itself pointed the wrong way. In the others, going with what you could see would at least have made you right.');
    } else if (s.lucky > 0) {
      var nouns = listJoin(lucky.map(function (b) { return b.noun; }));
      var head = 'You were right ' + times(s.right) + ' and ' +
        (s.knew === 0 ? (s.right === 1 ? 'did not know it' : 'knew none of them') : 'knew ' + num(s.knew)) + '. ';
      var who;
      if (s.knew === 0) who = s.lucky === 1 ? 'It was' : s.lucky === 2 ? 'Both were' : 'All ' + num(s.lucky) + ' were';
      else who = s.lucky === 1 ? 'The other one was' : 'The other ' + num(s.lucky) + ' were';
      paras.push(head + who + ' right by luck: you went on ' + nouns + ', and the world agreed for reasons ' +
        (s.lucky === 1 ? 'it knew nothing about.' : 'none of them knew anything about.'));
      var onEvidence = lucky.filter(function (b) { return b.source === 'evidence'; }).length;
      var tail = ' Nothing on the inside marks the difference, which is why it is worth keeping two scores.';
      if (onEvidence === s.lucky) {
        paras.push('At the moment you answered, ' + (s.lucky === 1 ? 'that answer' : 'those answers') + ' felt no different from knowing.' + tail);
      } else if (onEvidence > 0) {
        paras.push('The lucky answers that rested on evidence felt, at the moment you answered, no different from knowing.' + tail);
      } else {
        paras.push((s.lucky === 1 ? 'That answer' : 'Those answers') + ' rested on a hunch, and you may have sensed it at the time. The harder cases are the ones where good evidence and luck feel the same from the inside, which is why it is worth keeping two scores.');
      }
    } else {
      paras.push(s.right === 1
        ? 'You were right once, and you knew it. In several cases the evidence on offer led away from knowing.'
        : 'You were right ' + times(s.right) + ', and each time you knew. That took some care, or some caution: in several cases the evidence on offer led away from knowing.');
    }

    paras.push('Nobody can score more than ' + num(s.maxKnew) + ' on Knew here. In the other ' + num(N - s.maxKnew) +
      ' cases, nothing you could have gone on was connected to the truth.' +
      (missed.length ? ' You could have known in ' + listJoin(missed) + '.' : ''));

    if (s.wrong > 0) {
      var p = 'You were wrong ' + times(s.wrong) + '.';
      if (justifiedWrong > 0) {
        var subj = justifiedWrong === s.wrong
          ? (s.wrong === 1 ? 'It' : s.wrong === 2 ? 'Both' : 'Each')
          : Num(justifiedWrong) + ' of those';
        p += ' ' + subj + ' rested on good evidence that pointed the wrong way. That is not a failure of reasoning.';
      }
      paras.push(p);
    }
    return paras;
  }

  // ---- The valley of barns --------------------------------------------------------------

  // Six barn fronts along the road. Colours and sizes vary, but not with `real`.
  // The visitor is asked about barns 0, 2 and 4. Only barn 4 is real.
  var VALLEY = {
    barns: [
      { w: 70, h: 44, r: 30, colour: '#9a5646', real: false },
      { w: 64, h: 40, r: 28, colour: '#a47b4b', real: false },
      { w: 74, h: 46, r: 31, colour: '#7d5c50', real: false },
      { w: 66, h: 42, r: 29, colour: '#9a5646', real: false },
      { w: 72, h: 45, r: 30, colour: '#a47b4b', real: true },
      { w: 68, h: 43, r: 29, colour: '#6f7d6a', real: false }
    ],
    asked: [0, 2, 4],
    depth: 100,     // depth of a real barn, in the same units
    first: 380,     // world x of the first barn
    spacing: 270    // world distance between barns
  };
  VALLEY.barns.forEach(function (b, i) { b.x = VALLEY.first + i * VALLEY.spacing; });

  // A shorter loop for the card preview: four barns, one real, repeating.
  var PREVIEW = {
    barns: [
      { w: 70, h: 44, r: 30, colour: '#9a5646', real: false },
      { w: 66, h: 42, r: 29, colour: '#a47b4b', real: false },
      { w: 72, h: 45, r: 30, colour: '#7d5c50', real: true },
      { w: 68, h: 43, r: 29, colour: '#6f7d6a', real: false }
    ],
    depth: 100,
    spacing: 155
  };
  PREVIEW.barns.forEach(function (b, i) { b.x = i * PREVIEW.spacing; });
  PREVIEW.period = PREVIEW.barns.length * PREVIEW.spacing;

  var MAX_SWING = 118 * Math.PI / 180;
  var LIFT = 0.32; // how far the viewpoint rises as it swings round, so roofs and struts read

  // Project a barn-local point (x across the front, y up, z back from the front) for a view
  // swung round by theta. Returns [X, Y] in barn units, Y up.
  function project(theta, x, y, z) {
    var c = Math.cos(theta), s = Math.sin(theta);
    var e = LIFT * s;
    var zr = z * c - x * s;
    return [x * c + z * s, y + e * zr];
  }

  // The affine map of a plane parallel to the front, at depth z0:
  //   X = xx*x + ox,  Y = xy*x + yy*y + oy.
  function planeAt(theta, z0) {
    var c = Math.cos(theta), s = Math.sin(theta), e = LIFT * s;
    return { xx: c, xy: -e * s, yy: 1, ox: z0 * s, oy: e * z0 * c };
  }
  function frontPlane(theta) { return planeAt(theta, 0); }

  // Past a quarter turn the front faces away and you see the back of it.
  function seesBack(theta) { return Math.cos(theta) < 0; }

  function frontOutline(b) {
    var w2 = b.w / 2;
    return [[-w2, 0], [w2, 0], [w2, b.h], [0, b.h + b.r], [-w2, b.h]];
  }

  // Parts of a barn in painter's order (back to front), each as projected polygons or lines.
  // The front is listed as 'front'; when the view has swung past a quarter turn the same
  // outline is seen from behind, and the renderer paints it as the back of the board.
  function barnParts(b, theta, depth) {
    var w2 = b.w / 2, h = b.h, r = b.r;
    var P = function (x, y, z) { return project(theta, x, y, z); };
    var back = seesBack(theta);
    var front = { part: 'front', pts: frontOutline(b).map(function (p) { return P(p[0], p[1], 0); }) };
    var parts = [];
    if (b.real) {
      var d = depth;
      if (back) parts.push(front);
      parts.push({ part: 'roofL', pts: [P(-w2, h, 0), P(0, h + r, 0), P(0, h + r, d), P(-w2, h, d)] });
      parts.push({ part: 'side', pts: [P(w2, 0, 0), P(w2, 0, d), P(w2, h, d), P(w2, h, 0)] });
      parts.push({ part: 'roofR', pts: [P(0, h + r, 0), P(w2, h, 0), P(w2, h, d), P(0, h + r, d)] });
      if (back) parts.push({ part: 'rear', pts: frontOutline(b).map(function (p) { return P(p[0], p[1], d); }) });
      else parts.push(front);
      return parts;
    }
    var reach = h * 0.8, t = 3, props = [];
    [-0.3, 0.3].forEach(function (f) {
      props.push({ part: 'strut', pts: [P(f * b.w, h * 0.72, 0), P(f * b.w, 0, reach)] });
    });
    props.push({ part: 'strut', pts: [P(0, h + r * 0.55, 0), P(0, 0, reach * 1.25)] });
    props.push({ part: 'brace', pts: [P(-0.3 * b.w, h * 0.36, reach * 0.5), P(0.3 * b.w, h * 0.36, reach * 0.5)] });
    var edges = [
      { part: 'edge', pts: [P(w2, 0, 0), P(w2, 0, t), P(w2, h, t), P(w2, h, 0)] },
      { part: 'edge', pts: [P(w2, h, 0), P(w2, h, t), P(0, h + r, t), P(0, h + r, 0)] }
    ];
    // From the road the props are behind the board; from behind they stand in front of it.
    return back ? edges.concat([front], props) : props.concat(edges, [front]);
  }

  function polygonArea(pts) {
    var a = 0;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i], q = pts[(i + 1) % pts.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return Math.abs(a) / 2;
  }

  function pointInPolygon(pt, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  var Facade = {
    OUTCOMES: OUTCOMES,
    findAnswer: findAnswer,
    findBasis: findBasis,
    outcome: outcome,
    combos: combos,
    maxKnew: maxKnew,
    score: score,
    reflect: reflect,
    numberWord: Num,
    VALLEY: VALLEY,
    PREVIEW: PREVIEW,
    MAX_SWING: MAX_SWING,
    project: project,
    frontPlane: frontPlane,
    planeAt: planeAt,
    seesBack: seesBack,
    frontOutline: frontOutline,
    barnParts: barnParts,
    polygonArea: polygonArea,
    pointInPolygon: pointInPolygon
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Facade;
  else root.Facade = Facade;
})(typeof window !== 'undefined' ? window : this);
