// Facade: the ten case scenes. Pictures and hotspots only.
//
// cases.js is the single source of truth for what each case means: which answer is true,
// which evidence tracks the truth. This file holds no such facts. It draws each case as a
// flat illustration (the front: what you can see; the back: what was hidden) and places one
// hotspot on the picture for every piece of evidence ("basis") that cases.js offers.
// Hunches are drawn as pencilled thought clouds; evidence as things you can pick up.
// tests/scenes.test.js checks that every basis has exactly one hotspot and vice versa.
//
// Coordinates are in a 400 x 240 view box. front(uid) and back(uid) return SVG markup
// (without the outer <svg>), so the same drawing can be shown whole or cropped for a close-up.
(function (root) {
  'use strict';

  var VW = 400, VH = 240;

  // The palette of the drive (app.js), so the scenes and the drive read as one set.
  var K = {
    sky1: '#e7ece1', sky2: '#f7f6f0', far: '#dbe1d2', near: '#c8d2bb', field: '#bcc8aa',
    verge: '#aab899', road: '#dddbd1', roadEdge: '#c3bfb2', trunk: '#6b5d4c',
    treeA: '#7b8f6f', treeB: '#687d5e', treeC: '#8a9c7c', roof: '#5a5750', roofDark: '#46443f',
    trim: '#f1ece2', wood: '#c7b28c', strut: '#6c5a43', ink: '#343630', inkStrong: '#252821',
    muted: '#686d62', red: '#9a5646', ochre: '#a47b4b', brown: '#7d5c50', sage: '#58705a',
    paper: '#faf9f6', wall: '#ece6d8', wallDark: '#d8cfbd', floor: '#cfc3ab', screen: '#2f332c',
    glass: '#dfe7e2', night1: '#3e4652', night2: '#5f6a73', lamp: '#f2e2b0', wool: '#f4f1ea',
    grey: '#9b9d94', water: '#a9bcbc', orange: '#c4733e', skin: '#c69c7c', skin2: '#a77d5e',
    pencil: '#7b7d74', card: '#fbf8f1'
  };

  // ---- Drawing helpers -------------------------------------------------------------------

  function n(x) { return Math.round(x * 10) / 10; }
  function rect(x, y, w, h, fill, o) {
    return '<rect x="' + n(x) + '" y="' + n(y) + '" width="' + n(w) + '" height="' + n(h) + '" fill="' + fill + '"' + (o || '') + '/>';
  }
  function circle(cx, cy, r, fill, o) {
    return '<circle cx="' + n(cx) + '" cy="' + n(cy) + '" r="' + n(r) + '" fill="' + fill + '"' + (o || '') + '/>';
  }
  function ellipse(cx, cy, rx, ry, fill, o) {
    return '<ellipse cx="' + n(cx) + '" cy="' + n(cy) + '" rx="' + n(rx) + '" ry="' + n(ry) + '" fill="' + fill + '"' + (o || '') + '/>';
  }
  function path(d, fill, o) { return '<path d="' + d + '" fill="' + fill + '"' + (o || '') + '/>'; }
  function line(x1, y1, x2, y2, stroke, w, o) {
    return '<line x1="' + n(x1) + '" y1="' + n(y1) + '" x2="' + n(x2) + '" y2="' + n(y2) + '" stroke="' + stroke +
      '" stroke-width="' + w + '" stroke-linecap="round"' + (o || '') + '/>';
  }
  function text(x, y, s, size, fill, o) {
    return '<text x="' + n(x) + '" y="' + n(y) + '" font-size="' + size + '" fill="' + fill + '"' + (o || '') + '>' + s + '</text>';
  }
  var MID = ' text-anchor="middle"', BOLD = ' font-weight="600"';
  function stroke(c, w, extra) { return ' stroke="' + c + '" stroke-width="' + w + '"' + (extra || ''); }
  function grad(id, a, b) {
    return '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + a +
      '"/><stop offset="1" stop-color="' + b + '"/></linearGradient></defs>';
  }
  function sky(id, a, b, x, y, w, h) {
    return grad(id, a, b) + rect(x || 0, y || 0, w || VW, h || VH, 'url(#' + id + ')');
  }
  function tree(x, y, s, tone) {
    return rect(x - 2 * s, y - 16 * s, 4 * s, 16 * s, K.trunk) +
      circle(x, y - 30 * s, 13 * s, tone || K.treeA) + circle(x - 9 * s, y - 22 * s, 10 * s, tone || K.treeA) +
      circle(x + 9 * s, y - 23 * s, 10 * s, tone || K.treeA);
  }
  function hills(y1, y2) {
    return path('M0 ' + y1 + ' Q 90 ' + (y1 - 22) + ' 190 ' + (y1 - 8) + ' T 400 ' + (y1 - 14) + ' V 240 H 0 Z', K.far) +
      path('M0 ' + y2 + ' Q 120 ' + (y2 - 14) + ' 230 ' + (y2 - 4) + ' T 400 ' + (y2 - 10) + ' V 240 H 0 Z', K.near);
  }
  // A pencilled thought cloud: how a hunch appears in a scene.
  function thought(x, y) {
    var o = stroke(K.pencil, 1.1, ' stroke-dasharray="2.2 1.8"');
    return '<g transform="translate(' + x + ' ' + y + ')">' +
      path('M-12 6 C-19 6 -19 -4 -11 -4 C-11 -12 -2 -13 0 -7 C3 -13 12 -12 11 -4 C19 -4 19 6 12 6 Z', K.card, o) +
      circle(-6, 1, 1.4, K.pencil) + circle(0, 1, 1.4, K.pencil) + circle(6, 1, 1.4, K.pencil) +
      circle(-15, 11, 2.2, K.card, stroke(K.pencil, 1)) + circle(-19, 15, 1.3, K.card, stroke(K.pencil, 1)) + '</g>';
  }
  // A little larger than the cloud it covers, so a fingertip can press it on a phone.
  function thoughtSpot(x, y) { return { x: x - 21, y: y - 19, w: 42, h: 40 }; }
  function phone(x, y, w, h, screenFill) {
    return rect(x, y, w, h, K.screen, ' rx="7"') + rect(x + 3, y + 6, w - 6, h - 12, screenFill || K.sky2, ' rx="3"');
  }
  function hand(cx, cy, len, deg, w, col) {
    var a = deg * Math.PI / 180;
    return line(cx, cy, cx + len * Math.sin(a), cy - len * Math.cos(a), col || K.inkStrong, w);
  }
  function clockFace(cx, cy, r, h, m, rim) {
    var s = circle(cx, cy, r, K.paper, stroke(K.ink, rim || r * 0.14));
    for (var i = 0; i < 12; i++) {
      var a = i * 30 * Math.PI / 180, r1 = r * (i % 3 ? 0.8 : 0.7), r2 = r * 0.88;
      s += line(cx + r1 * Math.sin(a), cy - r1 * Math.cos(a), cx + r2 * Math.sin(a), cy - r2 * Math.cos(a), K.ink, i % 3 ? r * 0.05 : r * 0.09);
    }
    s += hand(cx, cy, r * 0.48, (h % 12 + m / 60) * 30, r * 0.11) + hand(cx, cy, r * 0.72, m * 6, r * 0.07);
    return s + circle(cx, cy, r * 0.08, K.inkStrong);
  }
  function person(x, y, s, shirt, skin, hair) {
    return path('M' + n(x - 11 * s) + ' ' + n(y) + ' C' + n(x - 11 * s) + ' ' + n(y - 15 * s) + ' ' + n(x + 11 * s) + ' ' + n(y - 15 * s) + ' ' + n(x + 11 * s) + ' ' + n(y) + ' Z', shirt) +
      circle(x, y - 19 * s, 6.5 * s, skin || K.skin) +
      path('M' + n(x - 6.8 * s) + ' ' + n(y - 19 * s) + ' C' + n(x - 7 * s) + ' ' + n(y - 28 * s) + ' ' + n(x + 7 * s) + ' ' + n(y - 28 * s) + ' ' + n(x + 6.8 * s) + ' ' + n(y - 20 * s) + ' Z', hair || K.roofDark);
  }
  function sheep(x, y, s, flip) {
    var d = flip ? -1 : 1;
    return line(x - 6 * s, y + 4 * s, x - 6 * s, y + 10 * s, K.roofDark, 1.6 * s) + line(x + 6 * s, y + 4 * s, x + 6 * s, y + 10 * s, K.roofDark, 1.6 * s) +
      ellipse(x, y, 11 * s, 7 * s, K.wool, stroke('#c9c6bc', 0.8)) + circle(x - 6 * s, y - 4 * s, 4 * s, K.wool) + circle(x + 4 * s, y - 5 * s, 4.5 * s, K.wool) +
      ellipse(x + d * 12 * s, y - 2 * s, 3.4 * s, 4.4 * s, K.roofDark);
  }
  function sound(x, y, s) {
    var o = stroke(K.muted, 1.4 * s, ' fill="none" stroke-linecap="round"');
    return [6, 11, 16].map(function (r) {
      return '<path d="M' + n(x + r * s * 0.6) + ' ' + n(y - r * s * 0.8) + ' A ' + n(r * s) + ' ' + n(r * s) + ' 0 0 1 ' + n(x + r * s * 0.6) + ' ' + n(y + r * s * 0.8) + '"' + o + '/>';
    }).join('');
  }
  function car(x, y, s, body, glass) {
    return path('M' + n(x - 26 * s) + ' ' + n(y) + ' L' + n(x - 26 * s) + ' ' + n(y - 10 * s) + ' L' + n(x - 14 * s) + ' ' + n(y - 12 * s) +
      ' L' + n(x - 7 * s) + ' ' + n(y - 21 * s) + ' L' + n(x + 14 * s) + ' ' + n(y - 21 * s) + ' L' + n(x + 24 * s) + ' ' + n(y - 11 * s) +
      ' L' + n(x + 26 * s) + ' ' + n(y) + ' Z', body) +
      path('M' + n(x - 5 * s) + ' ' + n(y - 19 * s) + ' L' + n(x + 3 * s) + ' ' + n(y - 19 * s) + ' L' + n(x + 3 * s) + ' ' + n(y - 12 * s) + ' L' + n(x - 11 * s) + ' ' + n(y - 12 * s) + ' Z', glass) +
      path('M' + n(x + 6 * s) + ' ' + n(y - 19 * s) + ' L' + n(x + 13 * s) + ' ' + n(y - 19 * s) + ' L' + n(x + 20 * s) + ' ' + n(y - 12 * s) + ' L' + n(x + 6 * s) + ' ' + n(y - 12 * s) + ' Z', glass) +
      circle(x - 14 * s, y, 5.5 * s, K.inkStrong) + circle(x + 14 * s, y, 5.5 * s, K.inkStrong) +
      circle(x - 14 * s, y, 2 * s, K.grey) + circle(x + 14 * s, y, 2 * s, K.grey);
  }
  function room(floorY) {
    return rect(0, 0, VW, VH, K.wall) + rect(0, floorY, VW, VH - floorY, K.floor) + rect(0, floorY - 4, VW, 4, K.wallDark);
  }
  function label(x, y, s, size, fill) { return text(x, y, s, size || 9, fill || K.ink, MID); }

  // ---- The scenes ------------------------------------------------------------------------

  var SCENES = {};

  SCENES.clock = {
    alt: 'A country railway platform in the afternoon. A round clock hangs under the canopy, reading 4:12. A bench with a sandwich and your bag, a crow by a crisp packet, the small station building. Three thought clouds.',
    backAlt: 'Behind the scene: the platform clock has stopped at 4:12, its battery flat since Tuesday. Your phone, out of the bag, also says 4:12.',
    backCaption: 'The clock stopped at 4:12 on Tuesday, when its battery ran flat. Your phone, out of the bag, also says 4:12.',
    hotspots: [
      { basis: 'clock', x: 164, y: 75, w: 52, h: 52, label: 'The platform clock' },
      { basis: 'sense', thought: true, label: 'A thought about the time of day', at: [84, 118] },
      { basis: 'doubt', thought: true, label: 'A thought about the clock', at: [238, 92] },
      { basis: 'light', thought: true, label: 'A thought about the light', at: [298, 42] }
    ],
    front: function (u) {
      var s = sky('s' + u, K.sky1, K.sky2) + circle(334, 48, 15, '#f2e9cf') + hills(150, 160) +
        tree(40, 162, 0.9, K.treeB) + tree(236, 160, 0.7, K.treeC);
      // Station building.
      s += rect(268, 104, 132, 74, K.ochre) + path('M258 106 L330 78 L402 106 Z', K.roof) +
        rect(284, 124, 20, 26, K.glass, stroke(K.trim, 2)) + rect(318, 130, 24, 48, K.brown) + rect(362, 124, 20, 26, K.glass, stroke(K.trim, 2)) +
        rect(300, 109, 60, 11, K.paper, ' rx="2"') + label(330, 117.5, 'Platform 1', 7);
      // Canopy and the clock.
      s += rect(108, 66, 172, 7, K.roof) + line(122, 73, 122, 178, K.roofDark, 4) + line(190, 73, 190, 80, K.roofDark, 2.5) +
        clockFace(190, 101, 21, 4, 12, 3);
      // Platform and track.
      s += rect(0, 176, VW, 30, K.road) + rect(0, 176, VW, 2, K.roadEdge) + rect(0, 202, VW, 3, '#e2d6a6') + rect(0, 205, VW, 35, '#b8b1a2');
      for (var x = 4; x < VW; x += 18) s += rect(x, 211, 8, 25, '#8f8677');
      s += rect(0, 214, VW, 3, '#6c6a62') + rect(0, 229, VW, 3, '#6c6a62');
      // Bench, sandwich, bag.
      s += line(70, 160, 70, 176, K.roofDark, 2.5) + line(140, 160, 140, 176, K.roofDark, 2.5) + line(70, 145, 70, 160, K.roofDark, 2) + line(140, 145, 140, 160, K.roofDark, 2) +
        rect(62, 157, 86, 5, K.brown, ' rx="1.5"') + rect(62, 143, 86, 5, K.brown, ' rx="1.5"') +
        rect(74, 152, 16, 5, '#e6d3a3', ' rx="2"') + rect(74, 154, 16, 1.5, '#9fb07f') +
        rect(110, 140, 26, 18, K.sage, ' rx="4"') + path('M114 141 C114 129 132 129 132 141', 'none', stroke(K.roofDark, 2));
      // Crow and crisp packet.
      s += ellipse(236, 171, 7, 4, K.screen) + circle(243, 168, 3, K.screen) + path('M245 167 l4 1.2 l-4 1.2 Z', K.roofDark) +
        path('M229 170 l-6 -2 l1 4 Z', K.screen) + line(234, 174, 233, 177, K.screen, 1) + line(238, 174, 239, 177, K.screen, 1) +
        rect(250, 169, 9, 7, '#c9a64a', ' rx="1" transform="rotate(-15 254 172)"');
      return s + thought(238, 92) + thought(298, 42) + thought(84, 118);
    },
    back: function (u) {
      var s = rect(0, 0, VW, VH, K.wall) + rect(0, 186, VW, 54, '#d9cdb4');
      s += clockFace(118, 108, 64, 4, 12, 5);
      // Cobweb across the face: the hands have not moved for days.
      s += path('M70 70 L118 108 M60 104 L118 108 M80 150 L118 108 M70 70 Q 66 88 60 104 Q 66 128 80 150', 'none', stroke('#b5bdaf', 0.8));
      s += rect(198, 146, 50, 24, K.grey, ' rx="3"') + rect(248, 152, 5, 12, K.grey) + rect(202, 150, 7, 16, '#c9c6bc') +
        label(223, 184, 'battery flat', 9) + label(223, 196, 'since Tuesday', 9);
      s += phone(292, 50, 76, 138) + text(330, 106, '4:12', 24, K.inkStrong, MID + BOLD) + label(330, 122, 'p.m.', 9, K.muted) +
        label(330, 168, 'your phone', 8, K.muted);
      s += line(186, 92, 286, 92, K.muted, 1, ' stroke-dasharray="3 3"') + label(236, 84, 'same, by chance', 9, K.muted);
      return s;
    }
  };

  SCENES.landed = {
    alt: 'A hallway at night. On the hall table a phone shows a message from Amara, “Down. Taxiing forever.”, and below it the airline app: Landed 9:03. A framed photo of Amara on the wall, a window onto the night, car keys on a hook. Two thought clouds.',
    backAlt: 'Behind the scene: at the airport, the plane is on the ground. Lines run from it to the control tower’s arrivals record and to Amara’s message.',
    backCaption: 'At the airport the plane is down. Amara’s text and the app’s status both come from that landing.',
    hotspots: [
      { basis: 'text', x: 212, y: 52, w: 86, h: 42, label: 'The message on your phone' },
      { basis: 'app', x: 212, y: 96, w: 86, h: 80, label: 'The airline app' },
      { basis: 'joke', thought: true, label: 'A thought about Amara', at: [372, 104] },
      { basis: 'late', thought: true, label: 'A thought about evening flights', at: [156, 40] }
    ],
    front: function (u) {
      var s = room(204);
      s += rect(22, 30, 112, 104, K.trim) + sky('s' + u, K.night1, K.night2, 28, 36, 100, 92) +
        circle(46, 52, 1, K.trim) + circle(70, 64, 1.2, K.trim) + circle(108, 48, 1, K.trim) + circle(96, 84, 1.4, '#e8a28f') +
        rect(77, 36, 2, 92, K.trim) + rect(28, 80, 100, 2, K.trim);
      s += rect(300, 30, 46, 56, K.brown) + rect(304, 34, 38, 48, K.glass) + person(323, 82, 1.1, K.red, K.skin2, K.inkStrong) +
        path('M318 61 Q 323 65 328 61', 'none', stroke(K.inkStrong, 1));
      s += rect(160, 184, 200, 8, K.brown) + rect(170, 192, 5, 12, K.brown) + rect(345, 192, 5, 12, K.brown);
      s += phone(208, 34, 92, 150);
      s += text(216, 49, '9:11', 7, K.ink) +
        rect(216, 56, 76, 34, '#ffffff', ' rx="4"' + stroke(K.roadEdge, 0.6)) + text(221, 66, 'Amara', 7, K.inkStrong, BOLD) +
        text(221, 77, 'Down. Taxiing', 7.5, K.ink) + text(221, 86, 'forever.', 7.5, K.ink) +
        rect(216, 98, 76, 76, '#e9eee7', ' rx="4"') + text(221, 109, 'Flight from Halifax', 6.4, K.muted) +
        text(221, 125, 'Landed', 13, '#3f5a42', BOLD) + text(221, 138, 'Due 9:05 · Landed 9:03', 6, K.ink) +
        text(221, 152, 'Gate 12', 6.4, K.ink) + text(221, 164, 'Baggage belt 3', 6.4, K.ink);
      s += line(372, 132, 372, 138, K.roofDark, 1.5) + circle(372, 143, 5, 'none', stroke(K.roofDark, 1.5)) + rect(370, 147, 4, 13, K.ochre, ' rx="1"');
      return s + thought(372, 104) + thought(156, 40);
    },
    back: function (u) {
      var s = sky('s' + u, K.night1, K.night2) + rect(0, 168, VW, 72, '#5b6157') + rect(0, 182, VW, 20, '#3c403a');
      for (var x = 10; x < VW; x += 40) s += rect(x, 191, 20, 2, K.trim);
      for (x = 6; x < VW; x += 24) s += circle(x, 180, 1.4, K.lamp) + circle(x + 12, 204, 1.4, K.lamp);
      s += rect(322, 92, 16, 76, '#c8c2b4') + rect(312, 74, 36, 18, K.lamp) + rect(310, 70, 40, 5, K.roof);
      s += ellipse(170, 172, 70, 10, K.trim) + path('M104 170 L96 146 L112 146 L126 166 Z', K.trim) +
        path('M160 174 L128 190 L150 190 L192 174 Z', '#dcd6ca');
      for (x = 136; x < 228; x += 9) s += circle(x, 170, 1.8, '#3c403a');
      s += circle(154, 170, 1.8, K.lamp);
      s += label(170, 150, 'touched down 9:03', 10, K.trim);
      s += path('M232 166 Q 280 120 310 84', 'none', stroke(K.lamp, 1.2, ' stroke-dasharray="3 3"')) + text(262, 112, 'arrivals record', 8.5, K.trim, ' text-anchor="end"');
      s += path('M150 164 Q 90 110 58 72', 'none', stroke(K.lamp, 1.2, ' stroke-dasharray="3 3"')) +
        rect(28, 36, 22, 38, K.screen, ' rx="4"' + stroke(K.grey, 1)) + rect(31, 42, 16, 22, K.trim, ' rx="1"') + text(56, 52, 'her text', 8.5, K.trim);
      return s;
    }
  };

  SCENES.meeting = {
    alt: 'An office corridor. Your phone shows the calendar entry, Design review at 2:00 in Room 4, and the invitation you accepted. The door of Room 4 is shut. A wall clock reads 1:58. Coffee and notebook. One thought cloud.',
    backAlt: 'Behind the door: Room 4 is empty, chairs pushed in. The whiteboard says the review moved to 11:00. The update sits unread at an old email address.',
    backCaption: 'Room 4 is empty. The review moved to 11:00, and the update sits unread at an old email address.',
    hotspots: [
      { basis: 'calendar', x: 40, y: 46, w: 94, h: 84, label: 'The calendar on your phone' },
      { basis: 'invite', x: 40, y: 132, w: 94, h: 64, label: 'The invitation you accepted' },
      { basis: 'door', x: 234, y: 58, w: 82, h: 142, label: 'The door of Room 4' },
      { basis: 'moved', thought: true, label: 'A thought about meetings', at: [196, 62] }
    ],
    front: function () {
      var s = room(204);
      s += rect(234, 58, 82, 146, K.wallDark) + rect(240, 64, 70, 140, K.brown) +
        rect(248, 104, 54, 40, 'none', stroke('#6c4f45', 1.5)) + rect(248, 152, 54, 40, 'none', stroke('#6c4f45', 1.5)) +
        circle(300, 140, 3, K.trim) + rect(256, 78, 38, 14, K.paper, ' rx="2"') + label(275, 88, 'Room 4', 8, K.inkStrong);
      s += clockFace(362, 48, 14, 1, 58, 2);
      s += rect(150, 192, 66, 10, K.sage, ' rx="1"') + rect(170, 170, 18, 22, K.paper, ' rx="2"') + rect(168, 166, 22, 5, K.roof, ' rx="1"');
      s += phone(38, 40, 98, 162);
      s += text(46, 56, 'Today', 8, K.inkStrong, BOLD);
      ['1:00', '2:00', '3:00'].forEach(function (t, i) {
        s += text(46, 72 + i * 20, t, 6, K.muted) + line(62, 70 + i * 20, 128, 70 + i * 20, K.line || '#dedfd7', 0.6);
      });
      s += rect(64, 91, 64, 30, '#c8d2bb', ' rx="2"') + text(67, 101, 'Design review', 7, K.inkStrong, BOLD) + text(67, 112, '2:00 · Room 4', 6.4, K.ink);
      s += rect(44, 136, 86, 54, '#ffffff', ' rx="4"' + stroke(K.roadEdge, 0.6)) + text(49, 148, 'Invitation', 6.4, K.muted) +
        text(49, 161, 'Design review', 7.4, K.inkStrong, BOLD) + text(49, 172, '2:00 · Room 4', 6.4, K.ink) + text(49, 184, '✓ Accepted last week', 6.2, '#3f5a42');
      return s + thought(196, 62);
    },
    back: function () {
      var s = room(196);
      s += rect(118, 36, 164, 72, K.paper, stroke(K.line || '#b5bdaf', 2)) + label(200, 60, 'Design review', 11, K.inkStrong) +
        label(200, 78, 'moved to 11:00', 11, K.inkStrong) + label(200, 96, 'done, thanks all', 9, K.muted);
      s += clockFace(338, 52, 16, 2, 0, 2.4);
      s += rect(110, 150, 180, 9, K.brown) + rect(120, 159, 5, 37, K.brown) + rect(275, 159, 5, 37, K.brown);
      [134, 178, 222, 262].forEach(function (x) { s += rect(x - 9, 142, 18, 22, K.sage, ' rx="3"') + rect(x - 8, 164, 3, 30, K.roofDark) + rect(x + 5, 164, 3, 30, K.roofDark); });
      [150, 205, 250].forEach(function (x) { s += rect(x, 141, 8, 9, K.paper, stroke(K.grey, 0.6)); });
      s += rect(22, 124, 64, 42, K.paper, stroke(K.muted, 1)) + path('M22 124 L54 148 L86 124', 'none', stroke(K.muted, 1)) +
        label(54, 182, 'old address', 8.5, K.ink) + label(54, 194, '1 unread', 8.5, K.ink);
      return s;
    }
  };

  SCENES.forecast = {
    alt: 'A basement flat. On the table a phone shows the weather app: Rain from 2 p.m., with a grey cloud; a thin grey bar runs along the top of the screen. A rain jacket on a hook, a bicycle, a high window at pavement level. Two thought clouds.',
    backAlt: 'Behind the scene: at two o’clock a shower blows in off the lake. Today’s real forecast, which the phone never downloaded because it had no signal, said dry.',
    backCaption: 'The phone had no signal and showed yesterday’s saved forecast. Today’s said dry. A shower blows in off the lake anyway.',
    hotspots: [
      { basis: 'app', x: 161, y: 64, w: 82, h: 118, label: 'The weather app' },
      { basis: 'yesterday', x: 32, y: 62, w: 56, h: 92, label: 'Your rain jacket, still damp from yesterday' },
      { basis: 'distrust', thought: true, label: 'A thought about the phone', at: [264, 100] },
      { basis: 'twice', thought: true, label: 'A thought about the weather', at: [316, 34] }
    ],
    front: function () {
      var s = room(206);
      s += rect(120, 10, 170, 56, K.trim) + rect(126, 16, 158, 44, '#dfe3dc') + rect(126, 46, 158, 14, '#b9b5aa');
      for (var x = 134; x < 284; x += 12) s += line(x, 22, x, 46, K.roofDark, 1.2);
      s += line(126, 24, 284, 24, K.roofDark, 1.4);
      s += circle(60, 68, 3, K.roofDark) + path('M44 74 L76 74 L86 120 L80 150 L40 150 L34 120 Z', K.sage) +
        path('M50 74 Q 60 90 70 74', '#4b604d') + line(60, 82, 60, 148, '#4b604d', 1.2) +
        circle(48, 156, 1.6, '#9fb4c4') + circle(70, 162, 1.6, '#9fb4c4');
      s += circle(306, 196, 24, 'none', stroke(K.ink, 3)) + circle(368, 196, 24, 'none', stroke(K.ink, 3)) +
        path('M306 196 L330 168 L362 168 L368 196 M330 168 L340 196 L362 168 M328 160 L336 160 M360 168 L356 156 L366 154', 'none', stroke(K.red, 3, ' stroke-linejoin="round"'));
      s += rect(130, 182, 146, 8, K.brown) + rect(140, 190, 5, 16, K.brown) + rect(262, 190, 5, 16, K.brown);
      s += phone(164, 68, 76, 112);
      s += rect(167, 75, 70, 3, K.grey, ' rx="1.5"');
      s += text(202, 98, 'Rain from 2 p.m.', 7.6, K.inkStrong, MID + BOLD) +
        ellipse(196, 122, 14, 8, K.grey) + circle(206, 116, 9, K.grey) + circle(190, 117, 7, K.grey) +
        line(190, 134, 187, 142, '#7e9cb2', 1.6) + line(199, 134, 196, 142, '#7e9cb2', 1.6) + line(208, 134, 205, 142, '#7e9cb2', 1.6) +
        text(202, 160, 'Afternoon', 6.4, K.muted, MID);
      return s + thought(264, 100) + thought(316, 34);
    },
    back: function (u) {
      var s = sky('s' + u, '#cfd5d2', '#eef0ea') + path('M0 128 Q 100 112 200 122 T 400 118 V 150 H 0 Z', K.near) +
        rect(0, 146, VW, 46, K.water) + line(30, 160, 90, 160, '#c3d2d1', 1.4) + line(200, 172, 270, 172, '#c3d2d1', 1.4) +
        rect(0, 192, VW, 48, K.road) + rect(0, 192, VW, 2, K.roadEdge);
      s += ellipse(110, 62, 46, 18, '#8d948f') + circle(88, 52, 18, '#8d948f') + circle(122, 46, 22, '#8d948f');
      for (var x = 76; x < 170; x += 11) s += line(x, 84, x + 16, 126, '#7e9cb2', 1.4);
      s += path('M176 100 q 14 -6 28 0 q 14 6 28 0', 'none', stroke(K.muted, 1.4)) + label(110, 30, 'a shower off the lake', 9, K.inkStrong);
      s += circle(262, 214, 12, 'none', stroke(K.ink, 2.4)) + circle(300, 214, 12, 'none', stroke(K.ink, 2.4)) +
        path('M262 214 L278 198 L296 198 L300 214 M278 198 L284 214', 'none', stroke(K.red, 2.4)) +
        path('M276 196 L282 176 L292 176 L292 194 Z', K.sage) + circle(286, 170, 5, K.skin);
      s += rect(270, 22, 110, 54, K.paper, ' rx="5"' + stroke(K.grey, 1.2, ' stroke-dasharray="3 2"')) +
        label(325, 38, 'today’s forecast', 8, K.muted) + circle(306, 58, 7, '#e9d9a8') + text(322, 63, 'dry', 14, K.ink, BOLD) +
        label(325, 92, 'never downloaded:', 8.5, K.muted) + label(325, 104, 'the phone had no signal', 8.5, K.muted);
      return s;
    }
  };

  SCENES.cold = {
    alt: 'A kitchen just after seven on a December morning. Through the window, rooftops at dawn and the porch where the thermometer probe sits in shade. On the window frame the thermometer display reads −4°C. A phone on the counter shows the town weather station: −4.5°C, ten minutes ago. Kettle, gloves. Two thought clouds.',
    backAlt: 'Behind the scene: a clear sky let the whole town cool all night. Frost on the roofs. The porch probe and the station mast both sit in the same cold air.',
    backCaption: 'A clear night cooled the whole town. The porch probe and the station mast both measure that same cold air.',
    hotspots: [
      { basis: 'thermometer', x: 224, y: 60, w: 70, h: 58, label: 'The thermometer on the window frame' },
      { basis: 'station', x: 302, y: 60, w: 74, h: 112, label: 'The town weather station, on your phone' },
      { basis: 'mild', thought: true, label: 'A thought about yesterday', at: [252, 34] },
      { basis: 'town', thought: true, label: 'A thought about the town', at: [70, 50] }
    ],
    front: function (u) {
      var s = rect(0, 0, VW, VH, K.wall);
      s += rect(30, 24, 190, 130, K.trim) + sky('s' + u, '#c5d0da', '#efe4d2', 36, 30, 178, 118) +
        path('M36 120 L60 120 L60 104 L74 94 L88 104 L88 120 L110 120 L110 110 L130 98 L150 110 L150 120 L214 120 L214 148 L36 148 Z', '#8f978f') +
        rect(174, 62, 10, 86, K.wood) + rect(168, 96, 8, 5, K.paper) + path('M176 98 Q 200 96 218 82', 'none', stroke(K.roofDark, 1)) +
        rect(123, 30, 4, 118, K.trim);
      s += path('M218 82 Q 222 80 228 80', 'none', stroke(K.roofDark, 1)) + rect(228, 64, 62, 36, K.screen, ' rx="4"') + rect(232, 68, 54, 28, K.glass, ' rx="2"') +
        text(259, 88, '−4°C', 13, K.inkStrong, MID + BOLD) + label(259, 112, 'outside', 7.5, K.muted);
      s += rect(0, 172, VW, 68, K.floor) + rect(0, 166, VW, 7, '#b8ad96');
      s += path('M96 166 L100 142 Q 116 134 132 142 L136 166 Z', K.grey) + path('M132 148 Q 146 148 140 160', 'none', stroke(K.grey, 3)) + rect(108, 136, 16, 5, K.roofDark, ' rx="2"');
      s += path('M168 166 L170 150 L176 148 L178 156 L182 150 L186 152 L184 166 Z', K.red) + path('M190 166 L192 152 L198 150 L200 158 L204 152 L208 154 L206 166 Z', K.red);
      s += phone(306, 64, 66, 104) + label(339, 84, 'Town station', 6.6, K.muted) + text(339, 110, '−4.5°C', 13, K.inkStrong, MID + BOLD) +
        label(339, 124, '10 min ago', 6.2, K.muted) + label(339, 146, 'mast, 2 streets away', 5.6, K.muted);
      return s + thought(252, 34) + thought(70, 50);
    },
    back: function (u) {
      var s = sky('s' + u, '#b9c6d3', '#f0e6d6') + circle(60, 30, 1, K.trim) + circle(140, 20, 1, K.trim) + circle(300, 26, 1, K.trim);
      s += rect(0, 170, VW, 70, '#e4e8e3');
      s += path('M0 170 L0 130 L30 112 L60 130 L60 170 Z', '#8f978f') + path('M0 130 L30 112 L60 130 L56 132 L30 116 L4 132 Z', '#ffffff') +
        path('M150 170 L150 126 L184 104 L218 126 L218 170 Z', '#8f978f') + path('M150 126 L184 104 L218 126 L214 128 L184 108 L154 128 Z', '#ffffff');
      s += rect(84, 110, 10, 60, K.wood) + rect(78, 140, 8, 5, K.paper) + path('M74 132 l4 4 m0 -4 l-4 4 M96 150 l4 4 m0 -4 l-4 4', 'none', stroke('#9fb4c4', 1)) +
        label(82, 194, 'your probe: −4°C', 9, K.inkStrong);
      s += line(320, 60, 320, 170, K.grey, 3) + line(312, 170, 320, 60, K.grey, 1) + line(328, 170, 320, 60, K.grey, 1) +
        rect(310, 54, 20, 12, K.paper, stroke(K.grey, 1)) + label(320, 194, 'the station: −4.5°C', 9, K.inkStrong);
      s += label(200, 60, 'clear sky, cold all night', 10, K.inkStrong) + label(200, 76, 'the same air at both', 9, K.muted);
      return s;
    }
  };

  SCENES.sheep = {
    alt: 'A steep field seen over a wooden gate on a grey afternoon. Near the far stone wall, a white, woolly animal with its head down. A bleat carries from the top of the field, where the ground rises out of sight. A farmhouse on the next hill. Two thought clouds.',
    backAlt: 'Behind the rise: the white animal is a guardian dog. The flock grazes just over the rise, out of sight from the gate, and one ewe is bleating.',
    backCaption: 'The white animal is a guardian dog. The flock is just over the rise, and one ewe is bleating.',
    hotspots: [
      { basis: 'shape', x: 226, y: 97, w: 42, h: 34, label: 'The white animal by the far wall' },
      { basis: 'bleat', x: 306, y: 22, w: 56, h: 38, label: 'The bleat from the top of the field' },
      { basis: 'odd', thought: true, label: 'A thought about the animal', at: [292, 88] },
      { basis: 'wind', thought: true, label: 'A thought about the next farm', at: [74, 64] }
    ],
    front: function (u) {
      var s = sky('s' + u, '#dfe2dc', '#f2f1eb') + path('M0 110 Q 50 86 120 96 L120 140 L0 140 Z', K.far) +
        rect(30, 88, 22, 14, K.trim) + path('M28 89 L41 80 L54 89 Z', K.roof) + rect(38, 94, 5, 8, K.brown);
      s += path('M0 240 L0 128 Q 120 116 220 74 Q 280 50 400 58 L400 240 Z', K.field) + path('M0 128 Q 60 124 110 118', 'none', stroke(K.treeB, 4));
      s += path('M40 140 Q 200 124 400 98', 'none', stroke(K.grey, 5, ' stroke-dasharray="7 2"'));
      s += line(240, 118, 240, 126, K.grey, 1.6) + line(258, 116, 258, 124, K.grey, 1.6) +
        ellipse(250, 113, 13, 8, K.wool, stroke('#c9c6bc', 0.8)) + circle(244, 107, 5, K.wool) + circle(254, 106, 5.5, K.wool) + circle(237, 120, 4.4, K.wool, stroke('#c9c6bc', 0.6));
      s += sound(330, 40, 1);
      s += rect(14, 150, 11, 90, K.brown) + rect(206, 150, 11, 90, K.brown);
      [166, 182, 198, 214].forEach(function (y) { s += rect(25, y, 181, 6, K.ochre); });
      s += line(28, 218, 204, 168, K.ochre, 6);
      return s + thought(292, 88) + thought(74, 64);
    },
    back: function (u) {
      var s = sky('s' + u, '#dfe2dc', '#f2f1eb') + path('M0 240 L0 150 Q 140 100 222 82 Q 300 100 400 140 L400 240 Z', K.field) +
        path('M222 82 Q 300 100 400 140 L400 240 L230 240 Z', '#b1bf9f') + path('M10 190 Q 120 178 200 160', 'none', stroke(K.grey, 5, ' stroke-dasharray="7 2"'));
      // The dog: white, but a dog: pointed muzzle, ears, curled tail, collar.
      s += line(74, 172, 74, 186, '#dad6cc', 3) + line(104, 172, 104, 186, '#dad6cc', 3) + ellipse(90, 168, 20, 10, K.wool, stroke('#c9c6bc', 0.8)) +
        path('M108 162 Q 120 150 124 158 L128 166 Q 120 170 112 168 Z', K.wool, stroke('#c9c6bc', 0.8)) + path('M112 156 L116 148 L119 156 Z', '#e4dfd2') +
        circle(127, 165, 1.6, K.inkStrong) + circle(119, 158, 1.2, K.inkStrong) + path('M70 164 Q 58 150 66 146', 'none', stroke(K.wool, 4)) +
        line(108, 160, 110, 170, K.red, 2.4) + label(92, 206, 'a guardian dog', 9.5, K.inkStrong);
      s += sheep(270, 124, 1.1) + sheep(306, 136, 1, true) + sheep(340, 128, 1.1) + sheep(296, 160, 1.1) + sheep(350, 162, 1, true) + sound(360, 118, 0.8);
      s += label(316, 196, 'the flock, over the rise', 9.5, K.inkStrong);
      return s;
    }
  };

  SCENES.neighbour = {
    alt: 'Seven in the evening, already dark, seen from your front window. Across the way, Gord’s house: his blue hatchback in the drive, the kitchen light on, the front curtains drawn. One thought cloud.',
    backAlt: 'Inside Gord’s house: nobody home. The kitchen lamp is plugged into a timer. A note on the fridge: Calgary, back in a week.',
    backCaption: 'Nobody is home. The kitchen lamp is on a timer, and a note on the fridge says Calgary, back in a week.',
    hotspots: [
      { basis: 'car', x: 54, y: 156, w: 100, h: 42, label: 'Gord’s car in the drive' },
      { basis: 'light', x: 290, y: 108, w: 50, h: 52, label: 'Gord’s kitchen window' },
      { basis: 'curtains', x: 180, y: 110, w: 80, h: 58, label: 'Gord’s front curtains' },
      { basis: 'hunch', thought: true, label: 'A passing thought', at: [46, 112] }
    ],
    front: function (u) {
      var s = sky('s' + u, K.night1, K.night2) + circle(70, 44, 12, '#f2e9cf') + circle(140, 30, 1, K.trim) + circle(330, 24, 1, K.trim);
      s += rect(0, 186, VW, 54, '#4d5449') + rect(30, 188, 140, 28, '#6a6d64');
      s += rect(160, 94, 190, 96, '#b9ab92') + path('M148 96 L255 50 L362 96 Z', K.roofDark);
      s += rect(186, 116, 66, 46, K.red) + line(197, 117, 197, 161, '#7e4436', 1.4) + line(208, 117, 208, 161, '#7e4436', 1.4) +
        line(230, 117, 230, 161, '#7e4436', 1.4) + line(241, 117, 241, 161, '#7e4436', 1.4) + rect(186, 116, 66, 46, 'none', stroke(K.trim, 2));
      s += circle(314, 134, 26, K.lamp, ' opacity="0.18"') + rect(296, 116, 36, 36, K.lamp) + rect(296, 116, 36, 36, 'none', stroke(K.trim, 2)) + line(314, 116, 314, 152, K.trim, 1.5);
      s += rect(262, 132, 24, 58, K.roof);
      s += car(100, 194, 1.25, '#55708a', '#9fb0bf');
      s += line(378, 110, 378, 190, K.roofDark, 3) + circle(378, 108, 5, K.lamp);
      s += rect(0, 0, VW, 8, K.brown) + rect(0, 0, 8, VH, K.brown) + rect(392, 0, 8, VH, K.brown) + rect(0, 230, VW, 10, K.brown) +
        path('M8 8 L34 8 Q 26 90 30 230 L8 230 Z', K.wood);
      return s + thought(46, 112);
    },
    back: function (u) {
      var s = room(196);
      s += rect(24, 40, 70, 90, K.lamp) + rect(24, 40, 34, 90, K.red) + rect(60, 40, 34, 90, K.red);
      s += rect(126, 60, 52, 136, '#e9e4d6', stroke(K.grey, 1)) + rect(134, 82, 34, 26, K.lamp) +
        text(151, 93, 'Calgary', 6.5, K.inkStrong, MID) + text(151, 103, 'back in a week', 5.4, K.ink, MID);
      s += rect(214, 30, 150, 82, K.trim) + sky('s' + u, K.night1, K.night2, 220, 36, 138, 70) +
        path('M220 106 L260 74 L290 96 L320 66 L358 106 Z', '#7a8592') + path('M300 54 l16 -4 l3 3 l-14 5 Z', K.trim) + text(352, 50, 'Calgary', 7, K.trim, ' text-anchor="end"');
      s += rect(214, 150, 150, 8, K.brown) + rect(286, 120, 8, 30, K.roof) + path('M276 120 L304 120 L298 104 L282 104 Z', K.lamp);
      s += rect(318, 166, 18, 22, K.paper, ' rx="2"' + stroke(K.grey, 1)) + circle(327, 177, 6, K.card, stroke(K.ink, 1)) + hand(327, 177, 4, 220, 1.2) +
        label(300, 214, 'a timer: on at dusk', 9, K.inkStrong) + label(110, 214, 'nobody home since noon', 9, K.inkStrong);
      return s;
    }
  };

  SCENES.noodles = {
    alt: 'An unfamiliar city street at dusk. Your phone shows a review site: a photograph of a glossy bowl of noodles, 4.8 stars and “the best hand-pulled noodles in town”. Down the street, the small noodle bar. Two thought clouds.',
    backAlt: 'Behind the scene: the review site is a machine that hands out ratings between 4.6 and 4.9 and pastes in stock photographs. In the noodle bar’s kitchen, a cook pulls noodles by hand while locals queue.',
    backCaption: 'The review site gives every place 4.6 to 4.9 stars and a stock photograph. In the kitchen, a cook really does pull noodles by hand.',
    hotspots: [
      { basis: 'photos', x: 34, y: 48, w: 112, h: 78, label: 'The photograph on the review site' },
      { basis: 'rating', x: 34, y: 152, w: 112, h: 46, label: 'The rating on the review site' },
      { basis: 'thin', thought: true, label: 'A thought about the site', at: [180, 40] },
      { basis: 'online', thought: true, label: 'A thought about the noodle bar', at: [322, 96] }
    ],
    front: function (u) {
      var s = sky('s' + u, '#d6d3d6', '#f1e6d6');
      s += rect(176, 64, 62, 136, '#b4aca1') + rect(238, 84, 52, 116, '#a39b90') + rect(350, 50, 50, 150, '#b4aca1');
      [[188, 80], [214, 80], [188, 104], [214, 128], [250, 100], [266, 124], [362, 66], [380, 90], [362, 114]].forEach(function (p) { s += rect(p[0], p[1], 10, 12, K.lamp); });
      s += rect(290, 120, 60, 80, K.brown) + path('M286 120 L354 120 L350 110 L290 110 Z', K.red) + rect(298, 138, 44, 30, K.lamp) +
        text(320, 133, 'Noodles', 8, K.trim, MID + BOLD) + line(284, 116, 284, 124, K.roofDark, 1) + circle(284, 130, 5, K.orange);
      s += rect(0, 196, VW, 6, K.road) + rect(0, 202, VW, 38, '#c9c4b8');
      s += phone(30, 24, 120, 210);
      s += rect(33, 30, 114, 16, '#e9e4d6') + text(39, 41, 'Reviews', 8, K.muted, BOLD);
      s += rect(38, 52, 104, 70, '#8a6a4a') + ellipse(90, 102, 34, 12, K.trim) + ellipse(90, 96, 30, 8, '#e6d3a3') +
        path('M68 96 q 6 -6 12 0 t 12 0 t 12 0 t 10 0', 'none', stroke('#f6ead0', 1.6)) + line(104, 70, 124, 94, '#3c3329', 2) + line(110, 68, 126, 92, '#3c3329', 2) +
        ellipse(76, 66, 10, 4, '#f6e7c9', ' opacity="0.45"');
      s += text(39, 138, 'Noodle bar', 10, K.inkStrong, BOLD) + text(39, 149, '2 streets away', 6.6, K.muted);
      s += text(39, 168, '★★★★★', 10, K.ochre) + text(98, 168, '4.8', 10, K.inkStrong, BOLD) +
        text(39, 182, '“the best hand-pulled', 7, K.ink) + text(39, 192, 'noodles in town”', 7, K.ink);
      return s + thought(180, 40) + thought(322, 96);
    },
    back: function () {
      var s = rect(0, 0, 186, VH, K.wall) + rect(186, 0, 214, VH, '#efe0c8') + rect(186, 196, 214, 44, K.floor) + rect(0, 196, 186, 44, '#d9cdb4');
      s += rect(30, 70, 112, 84, K.grey, ' rx="6"') + circle(62, 104, 16, K.paper) + label(62, 108, '4.6–4.9', 7, K.inkStrong) +
        rect(92, 92, 40, 8, K.screen, ' rx="2"') + rect(96, 154, 34, 6, K.paper, stroke(K.grey, 0.6)) + rect(100, 160, 34, 6, K.paper, stroke(K.grey, 0.6)) +
        rect(36, 160, 44, 8, '#8a6a4a') + rect(38, 168, 44, 8, '#8a6a4a') + label(60, 186, 'stock photos', 8.5, K.ink) +
        label(90, 54, 'the review site', 9.5, K.inkStrong) + label(90, 218, 'ratings made, not earned', 9, K.inkStrong);
      s += line(186, 0, 186, VH, K.grey, 1, ' stroke-dasharray="4 3"');
      s += rect(200, 150, 140, 46, K.brown) + rect(200, 146, 140, 6, K.wood);
      s += person(258, 150, 1.6, K.trim, K.skin2) + line(244, 128, 228, 124, K.skin2, 3) + line(272, 128, 290, 124, K.skin2, 3) +
        path('M228 124 Q 259 150 290 124 M228 124 Q 259 140 290 124 M228 124 Q 259 130 290 124', 'none', stroke('#e6d3a3', 1.4));
      s += path('M236 104 q 4 -8 0 -16 M250 100 q 4 -8 0 -16', 'none', stroke('#c9c6bc', 1.4));
      s += rect(352, 40, 40, 156, '#c9b79a') + person(362, 196, 1.1, K.sage) + person(380, 196, 1.1, K.red, K.skin2) + person(371, 210, 1.0, K.ochre);
      s += label(292, 224, 'a very good kitchen; locals queue', 9, K.inkStrong);
      return s;
    }
  };

  SCENES.bridge = {
    alt: 'The view from an eighth-floor window: the river and the Ash Street bridge, with orange barriers across both ends, a crane lifting a section of railing, and cars turning back. On the sill, a tablet shows the city’s traffic map with the bridge in red and a closure symbol. Two thought clouds.',
    backAlt: 'Behind the scene: down at the bridge the railings are being replaced for a week. A road crew member updates the closure on the city’s map.',
    backCaption: 'The bridge railings are being replaced this week, and the road crew keeps the city’s map up to date.',
    hotspots: [
      { basis: 'window', x: 30, y: 88, w: 336, h: 58, label: 'The bridge, from your window' },
      { basis: 'map', x: 282, y: 164, w: 108, h: 72, label: 'The city’s traffic map' },
      { basis: 'stale', thought: true, label: 'A thought about maps', at: [256, 186] },
      { basis: 'night', thought: true, label: 'A thought about roadworks', at: [112, 60] }
    ],
    front: function (u) {
      var s = sky('s' + u, K.sky1, K.sky2);
      [[20, 70, 24], [48, 58, 20], [72, 76, 30], [280, 64, 22], [306, 54, 26], [336, 72, 30], [370, 60, 24]].forEach(function (b) { s += rect(b[0], b[1], b[2], 60, '#c9cfc4'); });
      s += rect(0, 118, VW, 30, K.near) + rect(0, 148, VW, 38, K.water) + rect(0, 186, VW, 22, K.near) +
        line(40, 164, 100, 164, '#c3d2d1', 1.4) + line(240, 176, 320, 176, '#c3d2d1', 1.4);
      s += rect(40, 138, 320, 8, '#8f8677') + rect(120, 146, 10, 34, '#8f8677') + rect(270, 146, 10, 34, '#8f8677') + line(40, 132, 220, 132, K.roofDark, 1.4) + line(258, 132, 360, 132, K.roofDark, 1.4);
      for (var x = 44; x < 360; x += 12) if (x < 220 || x > 258) s += line(x, 132, x, 138, K.roofDark, 1);
      [[40, 124], [336, 124]].forEach(function (p) {
        s += rect(p[0], p[1], 24, 14, K.paper) + rect(p[0], p[1], 6, 14, K.orange) + rect(p[0] + 12, p[1], 6, 14, K.orange);
      });
      s += rect(196, 40, 8, 98, '#b98d3e') + rect(150, 40, 110, 5, '#b98d3e') + rect(186, 32, 22, 12, '#b98d3e');
      for (var y = 46; y < 136; y += 10) s += line(196, y, 204, y + 10, '#8f6b2c', 1);
      s += line(240, 45, 240, 98, K.roofDark, 1) + rect(224, 98, 32, 5, K.roof);
      s += car(14, 132, 0.45, K.sage, K.glass) + car(84, 120, 0.4, K.red, K.glass) + path('M70 112 q -8 -2 -10 4', 'none', stroke(K.muted, 1));
      s += rect(0, 0, VW, 10, K.wallDark) + rect(0, 0, 10, VH, K.wallDark) + rect(390, 0, 10, VH, K.wallDark) + rect(0, 206, VW, 34, K.wallDark);
      s += rect(286, 168, 100, 64, K.screen, ' rx="5"') + rect(291, 173, 90, 54, K.trim) + rect(291, 190, 90, 12, '#cfdcdc') +
        line(300, 176, 300, 224, K.line || '#dedfd7', 2) + line(366, 176, 366, 224, '#dedfd7', 2) + line(306, 196, 360, 196, '#a6463a', 3.4) +
        circle(333, 196, 5.6, '#a6463a') + line(330, 196, 336, 196, '#ffffff', 1.6) + text(336, 214, 'Ash St', 6, K.ink, MID);
      return s + thought(256, 186) + thought(112, 60);
    },
    back: function (u) {
      var s = sky('s' + u, K.sky1, K.sky2) + rect(0, 150, VW, 90, K.water) + rect(0, 128, VW, 22, '#8f8677') + line(0, 122, 160, 122, K.roofDark, 2);
      for (var x = 6; x < 160; x += 12) s += line(x, 122, x, 128, K.roofDark, 1.4);
      s += rect(250, 120, 110, 6, K.roof) + rect(250, 112, 110, 6, K.roof) + label(305, 104, 'new railings', 9, K.inkStrong);
      s += rect(18, 100, 30, 28, K.paper) + rect(18, 100, 8, 28, K.orange) + rect(34, 100, 8, 28, K.orange);
      s += person(200, 128, 1.8, K.orange, K.skin) + rect(186, 104, 6, 26, '#e3c66b') + rect(208, 104, 6, 26, '#e3c66b') +
        rect(212, 84, 36, 26, K.screen, ' rx="3"') + rect(215, 87, 30, 20, K.trim);
      s += rect(70, 30, 150, 44, K.paper, ' rx="5"' + stroke(K.grey, 1)) + label(145, 48, 'Ash St bridge: closed', 9.5, K.inkStrong) +
        label(145, 63, 'railing repairs, one week', 8.5, K.ink) + path('M190 74 L214 88', 'none', stroke(K.grey, 1));
      s += label(200, 210, 'the crew updates the map', 9.5, K.inkStrong);
      return s;
    }
  };

  SCENES.dog = {
    alt: 'A laptop showing the weekly video call: six tiles. Dana’s background has a framed photo of a beagle; Theo’s camera is off. A caption reads: Dana: Sorry, I have to take him out at four. Two thought clouds beside the laptop.',
    backAlt: 'Behind the cameras: Dana collects her neighbour’s beagle for a paid walk. Under Theo’s desk, out of shot, an old greyhound sleeps.',
    backCaption: 'Dana’s walk is her neighbour’s beagle. Theo’s old greyhound sleeps under his desk, out of shot.',
    hotspots: [
      { basis: 'photo', x: 19, y: 23, w: 42, h: 34, label: 'The photo behind Dana' },
      { basis: 'walk', x: 15, y: 171, w: 304, h: 34, label: 'What Dana said' },
      { basis: 'office', thought: true, label: 'A thought about the office', at: [366, 60] },
      { basis: 'odds', thought: true, label: 'A thought about the team', at: [366, 128] }
    ],
    front: function () {
      var s = rect(0, 0, VW, VH, K.wall) + rect(0, 222, VW, 18, K.wood);
      s += rect(8, 12, 318, 196, K.screen, ' rx="8"') + rect(15, 19, 304, 182, '#e9e8e2') + path('M0 208 L334 208 L322 224 L12 224 Z', K.grey);
      function tile(x, y, bg, name) { return rect(x, y, 98, 76, bg) + rect(x + 3, y + 64, name.length * 4.2 + 8, 9, K.screen, ' rx="2" opacity="0.75"') + text(x + 7, y + 70.6, name, 6, K.trim); }
      // Dana: the beagle photo on her wall.
      s += tile(17, 21, K.wall, 'Dana') + rect(23, 27, 34, 26, K.brown) + rect(25.5, 29.5, 29, 21, K.glass) +
        ellipse(42, 42, 8, 4.4, K.ochre) + rect(44, 38, 6, 6, K.paper) + circle(33, 39, 4, K.ochre) + ellipse(31.4, 40.6, 1.8, 3.2, '#5a4a3c') +
        line(36, 46, 36, 49, K.ochre, 1.4) + line(48, 46, 48, 49, K.ochre, 1.4) + path('M50 40 q 4 -4 3 -7', 'none', stroke(K.ochre, 1.4)) +
        person(80, 97, 1.5, K.sage, K.skin, K.roofDark);
      s += tile(118, 21, '#4d5449', 'Theo') + circle(167, 54, 14, K.muted) + text(167, 59, 'T', 13, K.trim, MID) + text(167, 80, 'camera off', 5.6, '#dfe2dc', MID);
      s += tile(219, 21, K.glass, 'Priya') + rect(296, 50, 12, 14, K.brown) + circle(302, 44, 8, K.treeB) + person(260, 97, 1.5, K.ochre, K.skin2, K.inkStrong);
      s += tile(17, 100, '#e3d9c5', 'Sam') + rect(24, 106, 30, 40, K.brown) + rect(27, 110, 4, 12, K.red) + rect(32, 110, 4, 12, K.sage) + rect(37, 110, 4, 12, K.ochre) +
        person(76, 176, 1.5, K.red, K.skin, '#7d5c50');
      s += tile(118, 100, '#dfe7e2', 'Leo') + rect(124, 106, 36, 30, K.trim) + rect(126, 108, 32, 26, '#c5d0da') + person(178, 176, 1.5, K.roof, K.skin2, K.roofDark);
      s += tile(219, 100, K.wall, 'You') + person(268, 176, 1.5, '#55708a', K.skin, K.brown);
      s += rect(15, 177, 304, 22, K.screen, ' opacity="0.86"') + text(22, 186.5, 'Dana: Sorry, I have to take', 7.6, K.trim) + text(22, 195.5, 'him out at four.', 7.6, K.trim);
      s += rect(352, 196, 20, 26, K.paper, ' rx="2"' + stroke(K.grey, 1)) + path('M372 202 q 8 0 8 7 q 0 7 -8 7', 'none', stroke(K.grey, 2));
      return s + thought(366, 60) + thought(366, 128);
    },
    back: function (u) {
      var s = sky('s' + u, K.sky1, K.sky2, 0, 0, 196, VH) + rect(0, 170, 196, 70, K.near);
      for (var x = 8; x < 196; x += 16) s += rect(x, 132, 6, 40, K.wood);
      s += rect(0, 140, 196, 4, K.wood) + rect(0, 158, 196, 4, K.wood);
      s += person(56, 190, 1.7, K.sage, K.skin, K.roofDark) + person(148, 190, 1.7, K.red, K.skin2, K.grey);
      s += ellipse(104, 196, 12, 6, K.ochre) + rect(106, 192, 7, 7, K.paper) + circle(92, 190, 5, K.ochre) + ellipse(90, 192, 2, 3.8, '#5a4a3c') +
        line(96, 200, 96, 206, K.ochre, 1.6) + line(112, 200, 112, 206, K.ochre, 1.6) + path('M74 168 Q 84 180 92 188', 'none', stroke(K.red, 1.2));
      s += label(98, 30, 'Dana walks her', 9.5, K.inkStrong) + label(98, 43, 'neighbour’s beagle', 9.5, K.inkStrong);
      s += line(196, 0, 196, VH, K.grey, 1, ' stroke-dasharray="4 3"') + rect(196, 0, 204, VH, K.wall) + rect(196, 206, 204, 34, K.floor);
      s += rect(236, 132, 140, 8, K.brown) + rect(242, 140, 6, 66, K.brown) + rect(364, 140, 6, 66, K.brown) +
        rect(282, 104, 54, 28, K.screen, ' rx="2"') + rect(276, 130, 66, 3, K.grey) + text(309, 121, 'camera off', 6, K.trim, MID);
      s += path('M262 200 Q 270 180 300 186 Q 330 182 338 196 Q 330 206 300 204 Q 270 208 262 200 Z', '#a8a39a') +
        path('M338 196 Q 350 190 356 196 L360 200 Q 350 204 340 202 Z', '#a8a39a') + path('M262 200 Q 252 196 256 186', 'none', stroke('#a8a39a', 2)) +
        path('M346 192 q 2 -4 6 -3', 'none', stroke('#8a857c', 1.4));
      s += label(298, 30, 'Theo’s old greyhound,', 9.5, K.inkStrong) + label(298, 43, 'asleep under the desk', 9.5, K.inkStrong);
      return s;
    }
  };

  // Fill in each thought cloud's hotspot from where it is drawn.
  Object.keys(SCENES).forEach(function (id) {
    SCENES[id].hotspots.forEach(function (h) {
      if (h.thought) {
        var r = thoughtSpot(h.at[0], h.at[1]);
        h.x = r.x; h.y = r.y; h.w = r.w; h.h = r.h;
        delete h.at;
      } else {
        h.thought = false;
      }
    });
  });

  // ---- Close-ups -------------------------------------------------------------------------
  //
  // Picking something up shows a crop of the same drawing. The crop is chosen so that any
  // writing on the thing is big enough to read (READ_PX on screen) whenever it fits, and
  // otherwise as big as it can be while still showing the whole of that writing.

  var READ_PX = 13, MARGIN = 8, MIN_CROP = 90;

  // Rough boxes for the <text> in a drawing (width from character count; good enough to frame).
  function textBoxes(markup) {
    var re = /<text x="([\d.-]+)" y="([\d.-]+)" font-size="([\d.]+)"([^>]*)>([^<]*)<\/text>/g, m, out = [];
    while ((m = re.exec(markup))) {
      var x = +m[1], y = +m[2], size = +m[3], attrs = m[4];
      var chars = m[5].replace(/&[a-z]+;|&#\d+;/g, '_').length;
      var w = chars * size * (/font-weight/.test(attrs) ? 0.6 : 0.56);
      var x0 = /text-anchor="middle"/.test(attrs) ? x - w / 2 : x;
      out.push({ x: x0, y: y - size * 0.82, w: w, h: size * 1.05, size: size });
    }
    return out;
  }

  // What a hotspot's close-up should frame: the hotspot, and the writing inside it.
  function focusOf(id, basis) {
    var sc = SCENES[id];
    var h = sc.hotspots.filter(function (x) { return x.basis === basis; })[0];
    var texts = textBoxes(sc.front('m')).filter(function (t) {
      var cx = t.x + t.w / 2, cy = t.y + t.h / 2;
      return cx >= h.x && cx <= h.x + h.w && cy >= h.y && cy <= h.y + h.h;
    });
    var focus = { x: h.x, y: h.y, w: h.w, h: h.h };
    var text = null, minSize = Infinity;
    if (texts.length) {
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      texts.forEach(function (t) {
        x0 = Math.min(x0, t.x); y0 = Math.min(y0, t.y); x1 = Math.max(x1, t.x + t.w); y1 = Math.max(y1, t.y + t.h);
        minSize = Math.min(minSize, t.size);
      });
      text = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    // A long, low thing (a caption, a row of windows) reads better in a wide frame.
    var main = text && text.w >= 80 ? text : focus;
    return { hotspot: focus, text: text, minSize: text ? minSize : null, wide: main.w / main.h >= 2.6 };
  }

  // The crop (in view-box units) for a close-up drawn into a box artW x artH CSS px.
  // Returns {x, y, w, h, textPx}: textPx is the smallest writing's size on screen, or null.
  function closeUp(id, basis, artW, artH) {
    var f = focusOf(id, basis), H = f.hotspot, T = f.text;
    var fit = function (b, m) { return Math.min(artW / (b.w + 2 * m), artH / (b.h + 2 * m)); };
    var zMin = Math.max(artW / VW, artH / VH);           // never show past the drawing's edge
    var zMax = Math.max(zMin, artW / MIN_CROP);          // never zoom in so far that context is lost
    var z = fit(H, MARGIN), centre = H;
    if (T && z * f.minSize < READ_PX) {
      var zText = Math.min(READ_PX / f.minSize, fit(T, 5));
      if (zText > z) { z = zText; centre = T; }
    }
    z = Math.min(zMax, Math.max(zMin, z));
    var w = artW / z, h = artH / z;
    var x = Math.max(0, Math.min(VW - w, centre.x + centre.w / 2 - w / 2));
    var y = Math.max(0, Math.min(VH - h, centre.y + centre.h / 2 - h / 2));
    return { x: x, y: y, w: w, h: h, textPx: T ? f.minSize * z : null };
  }

  var Scenes = { VW: VW, VH: VH, byId: SCENES, palette: K, focusOf: focusOf, closeUp: closeUp };

  if (typeof module !== 'undefined' && module.exports) module.exports = Scenes;
  else root.FacadeScenes = Scenes;
})(typeof window !== 'undefined' ? window : this);
