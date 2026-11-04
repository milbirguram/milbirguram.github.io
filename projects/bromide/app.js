// Bromide page: loads the model, scores what you type, and runs the card preview.
(function () {
  'use strict';
  var Kit = window.Kit || { preview: false, reducedMotion: false, onPlay: function (cb) { cb(true); } };
  var B = window.Bromide;

  // Exposure: bits -> one of five silver tones, printed in the letters
  // themselves. Predictable words print faint, surprising ones develop dark.
  // The steps are the legend's wedge (style.css .x0 to .x4): under 2 bits
  // (better than a 1-in-4 guess) palest; 11 bits or more (rarer than about
  // 1 in 2,000) Dmax. The bits figure printed under every word says the
  // same thing in numbers, so tone is never the only signal.
  var STEPS = [2, 4, 7, 11];
  var STEP_LABELS = ['under 2', '2–4', '4–7', '7–11', '11+'];
  function step(bits) {
    var k = 0;
    while (k < STEPS.length && bits >= STEPS[k]) k++;
    return k;
  }
  function print(node, bits) {
    var k = step(bits);
    for (var i = 0; i <= STEPS.length; i++) node.classList.toggle('x' + i, i === k);
    return k;
  }

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function fmt(n, d) { return n.toFixed(d === undefined ? 1 : d); }
  function thousands(n) { return Math.round(n).toLocaleString('en-GB'); }

  if (Kit.preview) preview();
  else app();

  // ---- Preview: a print on the easel; the next sentence develops in place --

  function preview() {
    $('bro-app').hidden = true;
    var box = $('bro-preview');
    box.hidden = false;
    var label = $('pv-label'), text = $('pv-text'), num = $('pv-num'), unit = $('pv-unit');
    var data = window.BROMIDE_PREVIEW;
    if (!data || !data.sentences || !data.sentences.length) {
      label.textContent = 'Bromide';
      text.textContent = 'Which of your words did the books see coming?';
      num.textContent = '';
      unit.textContent = 'The model has not been built yet.';
      return;
    }
    var sentences = data.sentences;
    var LABELS = { tired: 'A tired line', fresh: 'A fresher line' };
    var words = [];

    // Lay a sentence on the sheet as a latent image: every word and its bits
    // in place, but only a ghost on the paper until it develops.
    function lay(si) {
      var s = sentences[si], total = 0, n = 0;
      label.textContent = LABELS[s.label] || '';
      text.textContent = '';
      words = s.words.map(function (w) {
        var sp = el('span', 'pv-w is-latent');
        var t = el('span', 'pv-t', w.t);
        sp.appendChild(t);
        if (w.punct) {
          sp.classList.add('pv-p');
        } else {
          sp.appendChild(el('span', 'pv-b', w.bits === undefined ? '?' : fmt(w.bits)));
          if (w.bits !== undefined) {
            var k = print(t, w.bits);
            // Development time: highlights settle fast, shadows keep darkening.
            t.style.transitionDuration = (0.7 + 0.55 * k) + 's';
            total += w.bits;
            n++;
          }
        }
        if (w.pre) text.appendChild(document.createTextNode(w.pre));
        text.appendChild(sp);
        return sp;
      });
      num.textContent = n ? fmt(total / n) : '–';
    }
    function develop() {
      words.forEach(function (sp) { sp.classList.remove('is-latent'); });
    }
    function fix() {
      words.forEach(function (sp) {
        sp.firstChild.style.transitionDuration = FADE_MS / 1000 + 's';
        sp.classList.add('is-latent');
      });
    }

    // One loop is 2 x 5.4 s: a sentence develops (up to 2.9 s for the
    // darkest words), holds, then fades to a ghost for 0.5 s (the sheet is
    // never blank), and the next is laid as a ghost and developed in place.
    var HOLD_MS = 4900, FADE_MS = 500;
    var timer = null, si = 0;
    function next() {
      box.classList.remove('is-still');
      fix();
      timer = setTimeout(function () {
        si = (si + 1) % sentences.length;
        lay(si);
        // Let the latent state paint before developing, so it transitions.
        void text.offsetWidth;
        develop();
        timer = setTimeout(next, HOLD_MS);
      }, FADE_MS);
    }
    // First frame: the fresher line, fully developed. Never a blank sheet.
    si = sentences.length - 1;
    box.classList.add('is-still');
    lay(si);
    develop();
    Kit.onPlay(function (playing) {
      clearTimeout(timer);
      timer = null;
      if (playing) {
        timer = setTimeout(next, HOLD_MS - 1500);
      } else {
        box.classList.add('is-still');
        develop();
      }
    });
  }

  // ---- The page ---------------------------------------------------------

  function app() {
    var textarea = $('bro-text');
    var reading = $('bro-reading');
    var status = $('bro-status'), statusText = $('bro-status-text'), progress = $('bro-progress');
    var avgEl = $('bro-avg'), subEl = $('bro-sub'), nudgeEl = $('bro-nudge'), detail = $('bro-detail');
    var shelfButtons = Array.prototype.slice.call(document.querySelectorAll('.bro-chip-btn'));
    var model = null, dist = null, result = null, items = [], sel = -1, debounce = null;
    var books = null;
    var narrow = window.matchMedia ? window.matchMedia('(max-width: 820px)') : null;
    var detailHome = detail.parentNode, legend = document.querySelector('.bro-legend');

    testStrip();
    textarea.maxLength = 2000;
    shelfButtons.forEach(function (b) { b.disabled = true; });

    if (window.BROMIDE_PREVIEW === null) {
      notBuilt();
      return;
    }
    loadBooks();
    loadModel();

    // The legend, printed by the same rule as the words: a step wedge.
    function testStrip() {
      var strip = $('bro-strip');
      STEP_LABELS.forEach(function (lab, k) {
        var cell = el('span', 'bro-step');
        var w = el('span', 'bro-step-w', 'word');
        print(w, k === 0 ? 0 : STEPS[k - 1]);
        cell.appendChild(w);
        cell.appendChild(el('span', 'bro-step-b', lab + (k === STEP_LABELS.length - 1 ? ' bits' : '')));
        strip.appendChild(cell);
      });
    }

    function notBuilt() {
      status.classList.add('is-error');
      progress.hidden = true;
      statusText.textContent = 'The model of the books is not ready yet, so there is nothing to score against. Please come back later.';
      reading.appendChild(el('p', 'bro-empty', 'Nothing to score yet.'));
    }

    function loadModel() {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', 'data/model.bin');
      xhr.responseType = 'arraybuffer';
      xhr.onprogress = function (e) {
        var mb = e.loaded / 1e6;
        if (e.lengthComputable && e.total) {
          progress.value = e.loaded / e.total;
          statusText.textContent = 'Loading the model of the books: ' + fmt(mb) + ' of ' + fmt(e.total / 1e6) + ' MB';
        } else {
          progress.removeAttribute('value');
          statusText.textContent = 'Loading the model of the books: ' + fmt(mb) + ' MB';
        }
      };
      xhr.onload = function () {
        if (xhr.status !== 200) return failed('The model could not be loaded (HTTP ' + xhr.status + ').');
        try {
          model = B.load(xhr.response);
        } catch (err) {
          return failed('The model file could not be read.');
        }
        ready(xhr.response.byteLength);
      };
      xhr.onerror = function () { failed('The model could not be loaded. Check the connection and reload.'); };
      xhr.send();
    }

    function failed(msg) {
      status.classList.add('is-error');
      progress.hidden = true;
      statusText.textContent = msg;
    }

    function loadBooks() {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', 'data/books.json');
      xhr.onload = function () {
        if (xhr.status !== 200) return;
        try { books = JSON.parse(xhr.responseText).books; } catch (e) { return; }
        var list = $('bro-book-list');
        books.forEach(function (b) {
          var li = el('li');
          li.appendChild(el('em', '', b.title));
          li.appendChild(document.createTextNode(', ' + b.author));
          list.appendChild(li);
        });
        $('bro-books-summary').textContent = 'Which books? ' + books.length + ' from Project Gutenberg';
        $('bro-books').hidden = false;
        booksNote();
      };
      xhr.send();
    }

    // Two lines above the book list: what the model is, in figures from its header.
    function booksNote() {
      if (!model || !books) return;
      var h = model.header;
      $('bro-books-note').textContent = 'About ' + fmt(h.corpus.word_tokens / 1e6) + ' million words, mostly British and American, ' +
        'published between about 1810 and 1920. Their idea of a likely word is that era’s: after “I dare” they expect “say”, ' +
        'and “okay” and “email” are unknown. The model keeps the ' + thousands(knownCount()) + ' commonest words and ' +
        'counts which follow which two tokens (words or punctuation marks), smoothed with Kneser–Ney' +
        (h.prune && h.prune.trigram_min > 1 ? '; to fit in ' + fmt(h.size / 1e6) + ' MB it forgets any run of three tokens seen ' +
          (h.prune.trigram_min === 2 ? 'only once' : 'fewer than ' + h.prune.trigram_min + ' times') : '') + '.';
    }

    function ready(bytes) {
      status.hidden = true;
      dist = new Float64Array(model.V);
      model.header.size = bytes;
      booksNote();
      shelfButtons.forEach(function (b) {
        b.disabled = false;
        b.addEventListener('click', function () {
          textarea.value = b.getAttribute('data-text');
          sel = -1;
          update(true);
        });
      });
      textarea.addEventListener('input', function () {
        clearTimeout(debounce);
        debounce = setTimeout(function () { update(false); }, 140);
      });
      // On a phone the word's detail goes right under the scored words, so a
      // tap shows its answer in view rather than far down the page.
      if (narrow) {
        placeDetail();
        if (narrow.addEventListener) narrow.addEventListener('change', placeDetail);
        else if (narrow.addListener) narrow.addListener(placeDetail);
      }
      update(true);
    }

    function placeDetail() {
      if (narrow.matches) legend.parentNode.insertBefore(detail, legend.nextSibling);
      else detailHome.appendChild(detail);
      detail.classList.toggle('is-inline', narrow.matches);
    }

    function knownCount() { return model.V - 9; }

    // Display form of a predicted token.
    function tokenName(id) {
      var w = model.vocab[id];
      var names = { ',': 'a comma', '.': 'a full stop', ';': 'a semicolon', ':': 'a colon', '!': 'an exclamation mark',
        '?': 'a question mark', '</s>': '(the end)', '<unk>': '(a rare word)' };
      return names[w] || w;
    }

    function update(autoSelect) {
      var original = textarea.value;
      result = model.score(original);
      result.origin = originMap(original);
      result.original = original;
      render(autoSelect);
    }

    // model.score works on a normalised copy (accents removed, curly
    // apostrophes straightened). For each normalised character, record where
    // its source character starts and ends in what was typed, so the strip
    // shows the visitor's own spelling.
    function originMap(original) {
      var starts = [], ends = [], pos = 0;
      for (var ch of original) {
        var n = B.normalise(ch).length;
        for (var k = 0; k < n; k++) { starts.push(pos); ends.push(pos + ch.length); }
        pos += ch.length;
      }
      return { starts: starts, ends: ends, ok: starts.length === result.text.length };
    }

    function displayOf(x) {
      var o = result.origin;
      if (!o.ok) return result.text.slice(x.start, x.end);
      return result.original.slice(o.starts[x.start], o.ends[x.end - 1]);
    }

    function render(autoSelect) {
      reading.textContent = '';
      items = [];
      result.sentences.forEach(function (sent, si) {
        sent.forEach(function (x, ti) {
          x.display = displayOf(x);
          x.sentence = si;
          x.pos = ti;
          if (x.punct) {
            reading.appendChild(el('span', 'p', x.display));
            return;
          }
          var b = el('button', 'w');
          b.type = 'button';
          b.tabIndex = -1;
          var t = el('span', 'w-text', x.display);
          var bits = el('span', 'w-bits', x.oov ? 'unknown' : fmt(x.bits));
          b.appendChild(t);
          b.appendChild(bits);
          if (x.oov) {
            b.classList.add('is-oov');
            b.setAttribute('aria-label', x.display + ': unknown to the books');
          } else {
            print(t, x.bits);
            b.setAttribute('aria-label', x.display + ': ' + fmt(x.bits) + ' bits');
          }
          var idx = items.length;
          b.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') select(idx, false); });
          b.addEventListener('click', function () { select(idx, true); });
          b.addEventListener('focus', function () { select(idx, false); });
          b.addEventListener('keydown', function (e) { onKey(e, idx); });
          x.button = b;
          items.push(x);
          reading.appendChild(b);
        });
      });
      if (!items.length) reading.appendChild(el('p', 'bro-empty', 'Write something above and it will be scored here.'));

      var memory = markMemory();
      summary(memory, bookLine());

      if (sel >= items.length) sel = items.length - 1;
      if (autoSelect || sel < 0) sel = autoSelect ? mostSurprising() : sel;
      if (sel >= 0) select(sel, false);
      else showHint();
    }

    function mostSurprising() {
      var best = -1;
      items.forEach(function (x, i) { if (!x.oov && (best < 0 || x.bits > items[best].bits)) best = i; });
      return best;
    }

    // Runs of five or more known words in a row, each under 1.5 bits: either a
    // stock phrase or a line the model has read in its books.
    function markMemory() {
      var runs = [], run = [];
      function flush() { if (run.length >= 5) runs.push(run); run = []; }
      items.forEach(function (x, i) {
        var prev = items[i - 1];
        if (prev && prev.sentence !== x.sentence) flush();
        if (!x.oov && x.bits < 1.5) run.push(x); else flush();
      });
      flush();
      runs.forEach(function (r) { r.forEach(function (x) { x.button.classList.add('is-memory'); }); });
      return runs;
    }

    // Is the text (or does it open with) a line the books contain? The build
    // measured a few: header.memory[i] has the shipped model's bits per word,
    // and what exact Kneser-Ney gives had the books never contained the line.
    function bookLine() {
      var toks = [].concat.apply([], result.sentences.map(function (s) { return s.map(function (x) { return x.tok; }); }));
      return B.matchLine(toks, model.header.memory);
    }

    function bookNote(match) {
      var m = match.probe, held = model.header.heldout.bits_per_word;
      var v = B.memoryVerdict(m, held);
      var times = m.times_in_books > 1 ? m.times_in_books + ' times' : 'once';
      var head = match.whole
        ? 'This line is in the books, ' + times + '. '
        : 'Your text opens with a line from the books, ' + times + ' (that line alone: ' + fmt(m.bits) + ' bits per word). ';
      var verdict;
      if (v.kind === 'recites') {
        verdict = 'The model remembers much of it: ' + fmt(m.bits) + ' bits per word, against ' + fmt(held) +
          ' for an ordinary sentence from the books. That is memory of the books, not a judgement on the line.';
      } else if (v.kind === 'helped') {
        verdict = 'Reading it made its words ' + (v.gain < 1 ? 'a little ' : '') + 'less surprising (' + fmt(m.unread_bits) +
          ' to ' + fmt(m.bits) + ' bits per word), but the model could not recite it' +
          (v.aboveOrdinary
            ? ': it is still more surprising than an ordinary sentence from the books (' + fmt(held) + ').'
            : '. What makes it predictable is phrasing the books use again and again.');
      } else {
        verdict = 'Reading it barely changed its score (' + fmt(m.unread_bits) + ' had the books never contained it). ' +
          'Its score comes from the books’ phrasing in general, not from memory of this line.';
      }
      return head + verdict;
    }

    function summary(memory, book) {
      if (result.avgBits === null) {
        avgEl.textContent = '–';
        subEl.textContent = result.unknown ? 'None of these words are known to the books, so there is nothing to average.' : '';
        nudgeEl.textContent = '';
        return;
      }
      avgEl.textContent = fmt(result.avgBits);
      var sub = 'Averaged over ' + result.known + ' word' + (result.known === 1 ? '' : 's') + ' the books know';
      if (result.unknown) sub += '; ' + result.unknown + ' unknown to them, left out';
      sub += '.';
      var h = model.header.heldout;
      if (h && h.bits_per_word) sub += ' Sentences from the books themselves average ' + fmt(h.bits_per_word) + '.';
      subEl.textContent = sub;

      nudgeEl.textContent = '';
      if (book) {
        nudgeEl.textContent = bookNote(book);
        return;
      }
      if (memory.length) {
        var words = memory[0].map(function (x) { return x.display; }).join(' ');
        nudgeEl.textContent = 'The run “' + words + '” is almost free to the model (underlined): the books use this phrasing ' +
          'again and again, so it finishes it for you. That is their habit, not a judgement on yours.';
        return;
      }
      var stretch = predictableStretch();
      if (stretch) {
        nudgeEl.textContent = 'The most predictable stretch is “' + stretch.words + '”, ' + fmt(stretch.bits) +
          ' bits for three words. Rewrite it and see if the number rises. A high number alone is not good writing, ' +
          'though: shuffled words score high too.';
      } else {
        nudgeEl.textContent = 'Write a little more, then rewrite to raise the number.';
      }
    }

    function predictableStretch() {
      var best = null;
      for (var i = 0; i + 2 < items.length; i++) {
        var a = items[i], b = items[i + 1], c = items[i + 2];
        if (a.oov || b.oov || c.oov || a.sentence !== c.sentence) continue;
        var bits = a.bits + b.bits + c.bits;
        if (!best || bits < best.bits) best = { bits: bits, words: a.display + ' ' + b.display + ' ' + c.display };
      }
      return best;
    }

    function onKey(e, i) {
      var next = -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = Math.min(items.length - 1, i + 1);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = Math.max(0, i - 1);
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = items.length - 1;
      if (next < 0) return;
      e.preventDefault();
      items[next].button.focus();
    }

    function showHint() {
      detail.textContent = '';
      detail.appendChild(el('p', 'bro-hint', 'Select a word to see what the model expected.'));
    }

    function select(i, fromClick) {
      if (i < 0 || i >= items.length) return;
      sel = i;
      items.forEach(function (x, k) {
        x.button.classList.toggle('is-selected', k === i);
        x.button.tabIndex = k === i ? 0 : -1;
      });
      showDetail(items[i]);
      if (fromClick) revealDetail();
    }

    // After a tap, if the word's detail is not fully on screen (on a phone it
    // sits under the legend, often below the fold), scroll just enough to show it.
    function revealDetail() {
      var r = detail.getBoundingClientRect();
      var h = window.innerHeight || document.documentElement.clientHeight;
      if (r.top >= 0 && r.bottom <= h) return;
      var top = r.height > h - 24 ? r.top - 12 : r.bottom - h + 12;
      if (r.top < 0) top = r.top - 12;
      window.scrollBy(0, top);
    }

    // The model's whole context: the two tokens (words or , ; : . ! ?) just
    // before this word, within its sentence.
    function contextText(x) {
      var sent = result.sentences[x.sentence];
      var prev = sent.slice(Math.max(0, x.pos - 2), x.pos);
      if (!prev.length) return 'What the model saw before it: the start of a sentence, nothing more.';
      var parts = prev.map(function (p) {
        return p.punct ? p.display : (p.oov ? '(an unknown word)' : p.display);
      });
      return 'What the model saw before it: “' + parts.join(' ').replace(/ ([,;:.!?])/g, '$1') + '”' +
        (prev.length === 1 ? ' at the start of a sentence' : '') + ', nothing more.';
    }

    function chance(p) {
      if (p >= 0.995) return 'almost certain';
      if (p >= 0.01) {
        var pct = Math.round(p * 100);
        return pct + '%, about 1 in ' + fmtOdds(1 / p);
      }
      return 'about 1 in ' + fmtOdds(1 / p);
    }
    function fmtOdds(x) {
      if (x < 10) return String(Math.round(x));
      var mag = Math.pow(10, Math.floor(Math.log10(x)) - 1);
      return thousands(Math.round(x / mag) * mag);
    }
    function ordinal(n) {
      var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
      return thousands(n) + (s[(v - 20) % 10] || s[v] || s[0]);
    }
    function pct(p) {
      if (p >= 0.095) return Math.round(p * 100) + '%';
      if (p >= 0.001) return (p * 100).toFixed(1) + '%';
      return '<0.1%';
    }

    function showDetail(x) {
      model.distribution(x.u, x.v, dist);
      var top = model.top(dist, 5);
      detail.textContent = '';
      detail.appendChild(el('p', 'd-ctx', contextText(x)));
      var main = el('p', 'd-main');
      if (x.oov) {
        main.appendChild(document.createTextNode('“'));
        main.appendChild(el('strong', '', x.display));
        main.appendChild(document.createTextNode('” is unknown to the books. It is not among the ' + thousands(knownCount()) +
          ' words the model keeps (it may turn up once or twice in the books, or never), so it gets no score and is left out of the average.'));
      } else {
        main.appendChild(document.createTextNode('You wrote “'));
        main.appendChild(el('strong', '', x.display));
        main.appendChild(document.createTextNode('”: '));
        main.appendChild(el('strong', '', fmt(x.bits) + ' bits'));
        main.appendChild(document.createTextNode('. The books gave it ' + chance(Math.pow(2, -x.bits)) + '.'));
      }
      detail.appendChild(main);
      detail.appendChild(el('p', '', x.oov ? 'In its place, the books expected:' : 'The books expected:'));
      var ol = el('ol', 'd-top');
      var max = top.length ? top[0].p : 1;
      top.forEach(function (t) {
        var li = el('li');
        if (!x.oov && t.id === x.id) li.classList.add('is-yours');
        li.appendChild(el('span', 'd-w', tokenName(t.id)));
        var bar = el('span', 'd-bar');
        var fill = el('i');
        fill.style.width = Math.max(2, 100 * t.p / max) + '%';
        bar.appendChild(fill);
        li.appendChild(bar);
        li.appendChild(el('span', 'd-p', pct(t.p)));
        ol.appendChild(li);
      });
      detail.appendChild(ol);
      if (!x.oov) {
        var inTop = top.some(function (t) { return t.id === x.id; });
        if (!inTop) {
          detail.appendChild(el('p', 'd-note', 'Your word was their ' + ordinal(model.rank(dist, x.id)) + ' choice of ' +
            thousands(model.V - 1) + '.'));
        }
      }
    }
  }
})();
