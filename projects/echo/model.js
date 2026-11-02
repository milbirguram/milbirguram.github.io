// Echo: the model. Pure functions for dates, wikitext, matching, the revision search and the
// verdict, plus an analysis driver that takes an injected `api(params)` function so it runs
// in the browser (window.EchoModel) and in Node (module.exports) alike.
(function (root, factory) {
  var m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else root.EchoModel = m;
})(this, function () {
  'use strict';

  // ---------------------------------------------------------------- dates
  // A date is an interval of whole UTC days [lo, hi] plus the precision it was given at.
  var MONTHS = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
    jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
    oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
  };
  var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'];
  var MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';

  function dayNum(y, m, d) { return Math.floor(Date.UTC(y, m - 1, d) / 86400000); }
  function daysIn(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function validDay(y, m, d) { return m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m); }
  function okYear(y) { return y >= 1000 && y <= 2100; }
  function dayToIso(n) { return new Date(n * 86400000).toISOString().slice(0, 10); }
  function dayToLabel(n) { var d = new Date(n * 86400000); return d.getUTCDate() + ' ' + MONTH_NAMES[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); }
  function isoToDay(ts) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ts || '');
    return m ? dayNum(+m[1], +m[2], +m[3]) : null;
  }

  function mk(lo, hi, precision, label) { return { lo: lo, hi: hi, precision: precision, label: label }; }
  function dayDate(y, m, d) {
    if (!okYear(y) || !validDay(y, m, d)) return null;
    var n = dayNum(y, m, d);
    return mk(n, n, 'day', d + ' ' + MONTH_NAMES[m - 1] + ' ' + y);
  }
  function monthDate(y, m) {
    if (!okYear(y) || m < 1 || m > 12) return null;
    return mk(dayNum(y, m, 1), dayNum(y, m, daysIn(y, m)), 'month', MONTH_NAMES[m - 1] + ' ' + y);
  }
  function yearDate(y) {
    if (!okYear(y)) return null;
    return mk(dayNum(y, 1, 1), dayNum(y, 12, 31), 'year', String(y));
  }
  function monthOf(word) { return MONTHS[String(word).toLowerCase().replace(/\.$/, '')] || 0; }

  // Seasons are read generously, for both hemispheres: a northern spring is March to May and a
  // southern one September to November, so "Spring 2014" covers March to November 2014 (and
  // likewise autumn). A southern summer straddles the new year, so summer, like winter, covers
  // December of the year before to February of the year after.
  var SEASONS = {
    spring: [3, 1, 11, 30], autumn: [3, 1, 11, 30], fall: [3, 1, 11, 30]
  };

  function parseDate(input) {
    if (input == null) return null;
    var s = String(input)
      .replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/[\u2013\u2014\u2212]/g, '-')
      .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/'{2,}/g, '')
      .replace(/\s+/g, ' ').trim();
    if (!s) return null;
    var low = s.toLowerCase();
    if (/^(n\.?\s?d\.?|undated|no date|unknown|forthcoming|in press)$/.test(low)) return null;
    low = low.replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+/, '').replace(/(\d)(st|nd|rd|th)\b/g, '$1');
    var m;

    // c. 2014, ca. 2014, circa 2014; c. 1990s widens the decade by a year each side
    if ((m = /^(?:c\.|ca\.?|circa|approx\.?|about)\s*(\d{4})(s?)$/.exec(low))) {
      var cy = +m[1];
      if (!okYear(cy)) return null;
      if (m[2]) {
        if (cy % 10) return null;
        return mk(dayNum(cy - 1, 1, 1), dayNum(cy + 10, 12, 31), 'circa', 'c. ' + cy + 's');
      }
      return mk(dayNum(cy - 1, 1, 1), dayNum(cy + 1, 12, 31), 'circa', 'c. ' + cy);
    }
    // 1990s, the 1990s, early/mid/late 1990s: the whole decade
    if ((m = /^(?:the\s+)?(?:(?:early|mid|late)[\s-]+)?(\d{3}0)s$/.exec(low))) {
      var dy = +m[1];
      if (!okYear(dy)) return null;
      return mk(dayNum(dy, 1, 1), dayNum(dy + 9, 12, 31), 'decade', s.replace(/^the\s+/i, ''));
    }
    // ISO day, possibly a timestamp
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[t ].*)?$/.exec(low))) return dayDate(+m[1], +m[2], +m[3]);
    if ((m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(low))) return dayDate(+m[1], +m[2], +m[3]);
    if ((m = /^(\d{4})-(\d{2})$/.exec(low)) && +m[2] <= 12) return monthDate(+m[1], +m[2]);
    // 2014, 2014a (a letter that tells apart works of the same year; never the "s" of a decade)
    if ((m = /^(\d{4})([a-rt-z])?$/.exec(low))) return yearDate(+m[1]);
    // 2013-2014, 2013-14
    if ((m = /^(\d{4})\s?-\s?(\d{2}|\d{4})$/.exec(low))) {
      var y1 = +m[1], y2 = m[2].length === 2 ? Math.floor(y1 / 100) * 100 + +m[2] : +m[2];
      if (!okYear(y1) || !okYear(y2) || y2 < y1) return null;
      return mk(dayNum(y1, 1, 1), dayNum(y2, 12, 31), 'range', y1 + '–' + y2);
    }
    // Spring 2014, Winter 2014
    if ((m = /^(spring|summer|autumn|fall|winter)\s+(\d{4})$/.exec(low))) {
      var sy = +m[2];
      if (!okYear(sy)) return null;
      var name = m[1].charAt(0).toUpperCase() + m[1].slice(1) + ' ' + sy;
      if (m[1] === 'winter' || m[1] === 'summer') return mk(dayNum(sy - 1, 12, 1), dayNum(sy + 1, 2, daysIn(sy + 1, 2)), 'season', name);
      var se = SEASONS[m[1]];
      return mk(dayNum(sy, se[0], se[1]), dayNum(sy, se[2], se[3]), 'season', name);
    }
    // March 2, 2014 / Mar. 2 2014
    if ((m = new RegExp('^' + MONTH_RE + '\\s+(\\d{1,2}),?\\s+(\\d{4})$').exec(low))) return dayDate(+m[3], monthOf(m[1]), +m[2]);
    // 2 March 2014
    if ((m = new RegExp('^(\\d{1,2})\\s+' + MONTH_RE + ',?\\s+(\\d{4})$').exec(low))) return dayDate(+m[3], monthOf(m[2]), +m[1]);
    // 2014 March 2 (Vancouver style)
    if ((m = new RegExp('^(\\d{4})\\s+' + MONTH_RE + '\\s+(\\d{1,2})$').exec(low))) return dayDate(+m[1], monthOf(m[2]), +m[3]);
    // March 2014, 2014 March
    if ((m = new RegExp('^' + MONTH_RE + ',?\\s+(\\d{4})$').exec(low))) return monthDate(+m[2], monthOf(m[1]));
    if ((m = new RegExp('^(\\d{4})\\s+' + MONTH_RE + '$').exec(low))) return monthDate(+m[1], monthOf(m[2]));
    // March-April 2014
    if ((m = new RegExp('^' + MONTH_RE + '\\s?-\\s?' + MONTH_RE + '\\s+(\\d{4})$').exec(low))) {
      var a = monthDate(+m[3], monthOf(m[1])), b = monthDate(+m[3], monthOf(m[2]));
      if (!a || !b || b.hi < a.lo) return null;
      return mk(a.lo, b.hi, 'range', a.label.split(' ')[0] + '–' + b.label);
    }
    // March 2-5, 2014 and 2-5 March 2014
    if ((m = new RegExp('^' + MONTH_RE + '\\s+(\\d{1,2})\\s?-\\s?(\\d{1,2}),?\\s+(\\d{4})$').exec(low)) ||
        (m = new RegExp('^(\\d{1,2})\\s?-\\s?(\\d{1,2})\\s+' + MONTH_RE + ',?\\s+(\\d{4})$').exec(low))) {
      var mo = isNaN(+m[1]) ? monthOf(m[1]) : monthOf(m[3]);
      var d1 = isNaN(+m[1]) ? +m[2] : +m[1], d2 = isNaN(+m[1]) ? +m[3] : +m[2];
      var da = dayDate(+m[4], mo, d1), db = dayDate(+m[4], mo, d2);
      if (!da || !db || db.lo < da.lo) return null;
      return mk(da.lo, db.hi, 'range', d1 + '–' + db.label);
    }
    // 02/03/2014: day and month order unknown unless one part is above 12
    if ((m = /^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/.exec(low))) {
      var p = +m[1], q = +m[2], yy = +m[3];
      if (p > 12) return dayDate(yy, q, p);
      if (q > 12) return dayDate(yy, p, q);
      var x = dayDate(yy, p, q), z = dayDate(yy, q, p);
      if (!x || !z) return x || z;
      if (x.lo === z.lo) return x;
      return mk(Math.min(x.lo, z.lo), Math.max(x.hi, z.hi), 'ambiguous', s);
    }
    return null;
  }

  // How a source interval sits against a day (or a window of days) when the claim was on Wikipedia.
  function relation(source, claimLoDay, claimHiDay) {
    if (!source) return 'unknown';
    if (claimHiDay == null) claimHiDay = claimLoDay;
    if (source.lo > claimHiDay) return 'after';
    if (source.hi < claimLoDay) return 'before';
    return 'overlap';
  }

  // ---------------------------------------------------------------- wikitext
  function findClose(s, i, open, close) {
    // s[i..] starts with `open`; returns the index just past the matching `close`, or -1.
    var depth = 0, j = i;
    while (j < s.length) {
      if (s.substr(j, open.length) === open) { depth++; j += open.length; continue; }
      if (s.substr(j, close.length) === close) { depth--; j += close.length; if (depth === 0) return j; continue; }
      j++;
    }
    return -1;
  }

  function splitTop(inner) {
    // Split template or link innards on top-level pipes.
    var parts = [], depth = 0, sq = 0, cur = '';
    for (var i = 0; i < inner.length; i++) {
      var two = inner.substr(i, 2);
      if (two === '{{') { depth++; cur += two; i++; continue; }
      if (two === '}}') { depth--; cur += two; i++; continue; }
      if (two === '[[') { sq++; cur += two; i++; continue; }
      if (two === ']]') { sq--; cur += two; i++; continue; }
      if (inner[i] === '|' && depth <= 0 && sq <= 0) { parts.push(cur); cur = ''; continue; }
      cur += inner[i];
    }
    parts.push(cur);
    return parts;
  }

  function templateParams(inner) {
    var parts = splitTop(inner);
    var name = parts.shift().replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    var named = {}, pos = [];
    parts.forEach(function (p) {
      var eq = p.indexOf('=');
      var key = eq > 0 ? p.slice(0, eq).trim().toLowerCase() : '';
      if (eq > 0 && /^[a-z0-9_ -]+$/.test(key)) named[key.replace(/_/g, '-').replace(/\s+/g, '-')] = p.slice(eq + 1).trim();
      else pos.push(p.trim());
    });
    return { name: name, named: named, pos: pos };
  }

  // Collect every top-level {{...}} occurrence with its span.
  function eachTemplate(s, fn) {
    var out = '', i = 0;
    while (i < s.length) {
      var k = s.indexOf('{{', i);
      if (k < 0) { out += s.slice(i); break; }
      var end = findClose(s, k, '{{', '}}');
      if (end < 0) { out += s.slice(i); break; }
      out += s.slice(i, k) + fn(s.slice(k + 2, end - 2));
      i = end;
    }
    return out;
  }

  var KEEP_FIRST = /^(lang|transl|nihongo|nowrap|nobr|small|smaller|big|illm|ill|interlanguage link|lang-x|keep together|abbr|em|strong|vr|var|sic|not a typo|proper name|linktext|ship|bdi|wikt|wiktionary|plainlist)$/;
  var CITE_NAME = /^(cite[ a-z-]*|citation|vcite[ a-z]*|cite q)$/;
  var SFN_NAME = /^(sfn|sfnp|sfnm|harvnb|harv|harvp|harvtxt|harvnp|harvcolnb|rp)$/;

  function templateToText(inner, ctx) {
    var t = templateParams(inner);
    if (SFN_NAME.test(t.name)) {
      if (t.name === 'rp') return '';
      if (ctx && ctx.addSfn && /^sfn/.test(t.name)) return ctx.addSfn(t);
      return '';
    }
    if (t.name === "'\"" || t.name === '"\'') return '\'"';
    if (t.name === 'nbsp' || t.name === 'snd' || t.name === 'spaced ndash') return ' ';
    if (t.name === 'ndash' || t.name === 'en dash') return '–';
    if (t.name === 'mdash') return '—';
    if (t.name === 'convert' || t.name === 'cvt') return (t.pos[0] || '') + ' ' + (t.pos[1] || '');
    if (/^lang-[a-z]+/.test(t.name)) return t.pos[0] || '';
    if (t.name === 'lang' || t.name === 'transl') return t.pos[1] || t.pos[0] || '';
    if (t.name === 'sic' || t.name === 'not a typo') return t.pos[0] || '';
    if (KEEP_FIRST.test(t.name)) return t.pos[0] || '';
    return '';
  }

  var STRIP_BLOCKS = /<(gallery|math|syntaxhighlight|source|score|timeline|imagemap|chem|graph|mapframe|templatedata|references|hiero|poem-not)[^>]*>[\s\S]*?<\/\1\s*>/gi;

  function stripLinks(s) {
    var out = '', i = 0;
    while (i < s.length) {
      var k = s.indexOf('[[', i);
      if (k < 0) { out += s.slice(i); break; }
      var end = findClose(s, k, '[[', ']]');
      if (end < 0) { out += s.slice(i); break; }
      out += s.slice(i, k);
      var inner = s.slice(k + 2, end - 2);
      var parts = splitTop(inner);
      var target = parts[0].trim();
      if (/^(file|image|media|category|[a-z]{2,3}(-[a-z]+)?):/i.test(target)) {
        // drop files, categories and interlanguage links
      } else {
        var text = parts.length > 1 ? parts[parts.length - 1] : target.replace(/^:/, '').replace(/^[a-z]+:/i, function (p) { return /^(wikt|wiktionary|w|s|q):$/i.test(p) ? '' : p; });
        out += stripLinks(text);
      }
      i = end;
    }
    return out;
  }

  function decodeEntities(s) {
    return s.replace(/&nbsp;|&#160;/g, ' ').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—')
      .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(+n); })
      .replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCharCode(parseInt(n, 16)); });
  }

  function inlineText(s, ctx) {
    s = eachTemplate(s, function (inner) { return inlineText(templateToText(inner, ctx), ctx); });
    s = stripLinks(s);
    s = s.replace(/\[(?:https?:)?\/\/[^\s\]]+\s+([^\]]*)\]/g, '$1').replace(/\[(?:https?:)?\/\/[^\]]*\]/g, '');
    s = s.replace(/'{2,}/g, '');
    s = s.replace(/<br\s*\/?>/gi, ' ').replace(/<\/?[a-z][^>]*>/gi, '');
    return decodeEntities(s);
  }

  var REF_RE = /<ref\b([^>]*?)\/>|<ref\b([^>]*)>([\s\S]*?)<\/ref\s*>/gi;
  function refAttr(attrs, key) {
    var m = new RegExp(key + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s/>]+))', 'i').exec(attrs || '');
    return m ? (m[1] || m[2] || m[3] || '').trim() : null;
  }

  // Turn an article's wikitext into paragraphs of sentences, each carrying the refs attached to it.
  function analyseWikitext(wikitext) {
    var src = String(wikitext || '').replace(/<!--[\s\S]*?(-->|$)/g, '').replace(/<nowiki\s*\/>/gi, '');
    var defs = {};
    src.replace(REF_RE, function (all, a1, a2, body) {
      var name = refAttr(a2, 'name');
      if (body != null && name && !defs[name] && body.trim()) defs[name] = body;
      return all;
    });
    var cites = collectCites(src);
    var refs = [], byName = {};
    function addRef(name, content, kind, extra) {
      if (name && byName[name] != null) return byName[name];
      var r = { id: refs.length, name: name || null, content: content || '', kind: kind || 'ref' };
      if (extra) for (var k in extra) r[k] = extra[k];
      refs.push(r);
      if (name) byName[name] = r.id;
      return r.id;
    }
    function ph(id) { return '\uE000' + id + '\uE001'; }
    src = src.replace(STRIP_BLOCKS, ' ');
    src = src.replace(REF_RE, function (all, selfAttrs, attrs, body) {
      var a = selfAttrs != null ? selfAttrs : attrs;
      var group = refAttr(a, 'group');
      if (group && !/^(ref|refs|r)$/i.test(group)) return '';
      var name = refAttr(a, 'name');
      var content = body != null && body.trim() ? body : (name ? defs[name] : '');
      if (!content && !name) return '';
      return ph(addRef(name, content || '', 'ref'));
    });
    var ctx = {
      addSfn: function (t) {
        var key = 'sfn:' + t.pos.join('|') + '|' + JSON.stringify(t.named);
        var content = '{{' + t.name + (t.pos.length ? '|' + t.pos.join('|') : '') +
          Object.keys(t.named).map(function (k) { return '|' + k + '=' + t.named[k]; }).join('') + '}}';
        return ph(addRef(key, content, 'sfn'));
      }
    };
    // Templates first (infoboxes and navboxes vanish, sfn becomes a ref), then line structure.
    src = eachTemplate(src, function (inner) { return inlineText(templateToText(inner, ctx), ctx); });

    var lines = src.split('\n');
    var paras = [], buf = [], heading = null, tableDepth = 0;
    function flush() {
      var text = buf.join(' ').trim();
      buf = [];
      if (text && /[A-Za-z0-9\u00C0-\uFFFF]/.test(text.replace(/\uE000\d+\uE001/g, ''))) paras.push({ heading: heading, raw: text });
    }
    lines.forEach(function (line) {
      var t = line.trim();
      if (/^\{\|/.test(t)) { flush(); tableDepth++; return; }
      if (tableDepth > 0) { if (/^\|\}/.test(t)) tableDepth--; return; }
      var h = /^(={2,6})\s*(.*?)\s*\1$/.exec(t);
      if (h) { flush(); heading = inlineText(h[2], ctx).replace(/\uE000\d+\uE001/g, '').trim(); return; }
      if (!t) { flush(); return; }
      if (/^(__[A-Z]+__|\|\}|!|\|)/.test(t)) return;
      if (/^[*#:;]+/.test(t)) { flush(); buf.push(t.replace(/^[*#:;]+\s*/, '')); flush(); return; }
      buf.push(t);
    });
    flush();

    var paragraphs = [];
    var sid = 0;
    paras.forEach(function (p, pi) {
      var text = inlineText(p.raw, ctx);
      var sentences = splitSentences(text).map(function (s) {
        return { id: sid++, para: pi, text: s.text, refs: s.refs };
      }).filter(function (s) { return s.text.length > 1; });
      if (sentences.length) paragraphs.push({ heading: p.heading, sentences: sentences });
    });
    // Number refs in order of first use, like the rendered article.
    var n = 0, numbers = {};
    var sentences = [];
    paragraphs.forEach(function (p, pi) {
      p.sentences.forEach(function (s) {
        s.para = pi;
        s.refs.forEach(function (r) { if (numbers[r] == null) numbers[r] = ++n; });
        sentences.push(s);
      });
    });
    refs.forEach(function (r) {
      r.number = numbers[r.id] || null;
      r.citation = parseCitation(r.content, cites);
    });
    return { paragraphs: paragraphs, sentences: sentences, refs: refs };
  }

  var ABBREV = /^(mr|mrs|ms|dr|st|jr|sr|prof|gen|col|lt|sgt|capt|gov|sen|rep|rev|mt|ft|no|nos|vol|vols|pp|p|ca|c|approx|e\.g|i\.e|vs|inc|ltd|co|corp|u\.s|u\.k|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|fig|ed|eds|op|cf|al|est|b|d|fl|r|lit|var|ssp|subsp|sp|spp|ch|sec|art|ave|blvd|rd|dept|univ|assn|bros|messrs|hon|ph\.d|a\.d|b\.c|m\.a|b\.a)$/i;

  function splitSentences(text) {
    var out = [], start = 0, i = 0;
    function push(endIdx) {
      var chunk = text.slice(start, endIdx);
      start = endIdx;
      var refs = [];
      chunk.replace(/\uE000(\d+)\uE001/g, function (_, id) { if (refs.indexOf(+id) < 0) refs.push(+id); return ''; });
      var clean = chunk.replace(/\uE000\d+\uE001/g, '').replace(/\s+/g, ' ').replace(/\s+([,.;:!?)])/g, '$1').replace(/\(\s*\)/g, '').trim();
      if (!clean && out.length) { refs.forEach(function (r) { if (out[out.length - 1].refs.indexOf(r) < 0) out[out.length - 1].refs.push(r); }); return; }
      out.push({ text: clean, refs: refs });
    }
    while (i < text.length) {
      var c = text[i];
      if (c === '.' || c === '!' || c === '?') {
        var j = i + 1;
        while (j < text.length && /["'”’)\]»]/.test(text[j])) j++;
        while (j < text.length && /[\uE000]/.test(text[j])) { var e = text.indexOf('\uE001', j); if (e < 0) break; j = e + 1; while (j < text.length && text[j] === ' ' && text[j + 1] === '\uE000') j++; }
        var k = j;
        while (k < text.length && /\s/.test(text[k])) k++;
        var atEnd = k >= text.length;
        var next = text[k];
        var spaced = k > j || atEnd;
        if (spaced && (atEnd || /[A-Z0-9"“‘'(\u00C0-\u024F\u0400-\u04FF\u3040-\u9FFF]/.test(next))) {
          var abbrev = false;
          if (c === '.') {
            var w = /([A-Za-z.]+)$/.exec(text.slice(Math.max(0, i - 12), i));
            if (w && (ABBREV.test(w[1]) || /^[A-Z]$/.test(w[1]) || /^([A-Za-z]\.)+[A-Za-z]$/.test(w[1]))) abbrev = true;
          }
          if (!abbrev) { push(j); i = j; continue; }
        }
      }
      i++;
    }
    if (start < text.length) push(text.length);
    return out;
  }

  // ---------------------------------------------------------------- citations
  function collectCites(src) {
    var list = [];
    (function walk(s) {
      eachTemplate(s, function (inner) {
        var t = templateParams(inner);
        if (CITE_NAME.test(t.name)) list.push(t);
        else walk(inner);
        return '';
      });
    })(src.replace(REF_RE, function (a, b, c, body) { return body ? ' ' + body + ' ' : ' '; }));
    return list;
  }

  function plain(s) { return inlineText(String(s || ''), null).replace(/\s+/g, ' ').trim(); }

  function authorOf(named) {
    return plain(named.last || named.last1 || named.surname || named.surname1 || named['author-last'] ||
      named.author || named.author1 || named['editor-last'] || named.editor || named.last1 || '');
  }

  function urlDate(url) {
    if (!url) return null;
    var u = originalUrl(url);
    var m = /\/((?:19|20)\d{2})\/(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])(?:\/|$|[-_])/.exec(u);
    if (m) return dayDate(+m[1], +m[2], +m[3]);
    m = /\/((?:19|20)\d{2})\/(0[1-9]|1[0-2])(?:\/|$)/.exec(u);
    if (m) return monthDate(+m[1], +m[2]);
    m = /\/((?:19|20)\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(?:\/|$|[-_])/.exec(u);
    if (m) return dayDate(+m[1], +m[2], +m[3]);
    return null;
  }

  function originalUrl(url) {
    var u = String(url || '').trim();
    var m = /^(?:https?:)?\/\/(?:web\.)?archive\.org\/web\/\d+[a-z_]*\/(.+)$/i.exec(u) ||
      /^(?:https?:)?\/\/archive\.(?:today|is|ph|md|li|fo|vn)\/\d+\/(.+)$/i.exec(u) ||
      /^(?:https?:)?\/\/(?:www\.)?webcitation\.org\/[^?]*\?url=(.+)$/i.exec(u);
    return m ? m[1] : u;
  }
  function normUrl(url) {
    return originalUrl(url).toLowerCase().replace(/^https?:\/\//, '').replace(/^\/\//, '').replace(/^www\d?\./, '')
      .replace(/^(m|mobile)\./, '').replace(/[#].*$/, '').replace(/\/+$/, '');
  }
  function normTitle(t) { return plain(t).toLowerCase().replace(/[^a-z0-9\u00C0-\uFFFF]+/g, ' ').trim(); }

  var ACCESS_RE = /(?:accessed|retrieved|access(?:ed)? on|viewed|consulted)(?: on)?:?\s*([^.;,()]*\d{4})/i;
  var FULL_DATE_RES = [
    new RegExp('\\b(\\d{1,2}\\s+' + MONTH_RE + ',?\\s+\\d{4})\\b', 'gi'),
    new RegExp('\\b(' + MONTH_RE + '\\s+\\d{1,2},?\\s+\\d{4})\\b', 'gi'),
    /\b(\d{4}-\d{2}-\d{2})\b/g
  ];

  function freeTextDate(text) {
    var t = text.replace(ACCESS_RE, ' ').replace(/(?:archived|archive)(?: from the original)?(?: on)?\s*[^.;]*\d{4}/gi, ' ');
    var found = [];
    FULL_DATE_RES.forEach(function (re) {
      re.lastIndex = 0;
      var m;
      while ((m = re.exec(t))) { var d = parseDate(m[1]); if (d) found.push(d); }
    });
    if (found.length) {
      var lo = Math.min.apply(null, found.map(function (d) { return d.lo; }));
      var same = found.every(function (d) { return d.lo === found[0].lo; });
      return same ? found[0] : { ambiguous: true, count: found.length, lo: lo };
    }
    var t2 = t.replace(/(?:isbn|issn|oclc|doi|pmid)[:\s]*[\d\-xX.\/]+/gi, ' ').replace(/(?:pages?|pp?\.)\s*[\d\-–, ]+/gi, ' ')
      .replace(/https?:\/\/\S+/g, ' ');
    var years = [], bracketed = false;
    var re2 = /(?:^|[^\d])((?:1[5-9]|20)\d{2})(?![\d])/g, m2;
    while ((m2 = re2.exec(t2))) {
      if (years.indexOf(+m2[1]) < 0) years.push(+m2[1]);
      if (/\(\s*$/.test(t2.slice(0, m2.index + m2[0].length - 4)) && /^\s*[a-z]?\)/.test(t2.slice(m2.index + m2[0].length))) bracketed = true;
    }
    if (years.length === 1) { var yd = yearDate(years[0]); yd.bracketed = bracketed; return yd; }
    if (years.length > 1) return { ambiguous: true, years: years };
    return null;
  }

  // Free-text citations often carry a year inside the title ("Remembering the 1918 flu
  // pandemic"). Titles are taken out before any date is looked for: link text, ''italics'' and
  // quoted phrases. Returns the text left over and whether a title was found.
  function withoutTitles(raw) {
    var found = false;
    var t = String(raw || '')
      .replace(/\[(?:https?:)?\/\/[^\s\]]+\s+[^\]]*\]/g, function () { found = true; return ' '; })
      .replace(/'{2,}([^']+?)'{2,}/g, function () { found = true; return ' '; })
      .replace(/"[^"]{3,}"|“[^”]{3,}”/g, function () { found = true; return ' '; });
    return { text: plain(t), titleFound: found };
  }

  // Read a ref's content into a citation: what it is and when it was published.
  function parseCitation(content, cites) {
    var c = { kind: 'text', template: null, title: null, url: null, work: null, author: null,
      fields: {}, source: null, sourceKind: null, access: null, note: null, text: '' };
    var raw = String(content || '');
    var tpl = null;
    eachTemplate(raw, function (inner) {
      var t = templateParams(inner);
      if (!tpl && (CITE_NAME.test(t.name) || SFN_NAME.test(t.name))) tpl = t;
      return '';
    });
    c.text = plain(raw.replace(/\{\{[\s\S]*\}\}/g, function (m) { return tpl ? '' : m; })) || plain(raw);
    if (tpl && SFN_NAME.test(tpl.name)) {
      c.kind = 'sfn';
      c.template = tpl.name;
      var author, yr;
      if (tpl.name === 'sfnm') { author = tpl.named['1a1'] || tpl.named.a1; yr = tpl.named['1y'] || tpl.named.y; }
      else {
        var pos = tpl.pos.filter(function (p) { return p; });
        yr = pos.filter(function (p) { return /^(c\.\s*)?\d{4}[a-z]?$/.test(p) || /^n\.?d\.?$/i.test(p); }).pop();
        author = pos[0];
      }
      c.author = author || null;
      c.sfnYear = yr || null;
      var match = null;
      if (author && cites) {
        var al = plain(author).toLowerCase();
        match = cites.filter(function (ct) {
          var who = authorOf(ct.named).toLowerCase();
          var ref = (ct.named.ref || '').toLowerCase();
          var when = (ct.named.date || ct.named.year || ct.named['publication-date'] || '');
          return (who.indexOf(al) >= 0 || (who && al.indexOf(who) >= 0) || ref.indexOf(al.replace(/\s+/g, '')) >= 0) &&
            (!yr || String(when).indexOf(String(yr).replace(/[a-z]$/, '').replace(/^c\.\s*/, '')) >= 0);
        })[0] || null;
      }
      if (match) { tpl = match; c.matchedFull = true; }
      else {
        c.title = (author || '') + (yr ? ' (' + yr + ')' : '');
        if (yr) { c.fields.year = yr; c.source = parseDate(yr); c.sourceKind = c.source ? 'year' : null; }
        if (!c.source) c.note = 'Short citation with no matching full reference.';
        return c;
      }
    }
    if (tpl) {
      if (c.kind !== 'sfn') c.kind = 'template';
      c.template = c.template || tpl.name;
      if (c.kind === 'sfn') c.fullTemplate = tpl.name;
      var n = tpl.named;
      c.title = plain(n.title || n['script-title'] || n['trans-title'] || n.chapter || n.contribution || n.entry || n.episode || '') || null;
      c.url = (n.url || n['chapter-url'] || n['archive-url'] || '').trim() || null;
      if (c.url && !/^(https?:)?\/\//i.test(c.url)) c.url = null;
      c.work = plain(n.work || n.website || n.newspaper || n.journal || n.magazine || n.periodical || n.publisher || n.agency || '') || null;
      c.author = authorOf(n) || c.author || null;
      ['date', 'publication-date', 'year', 'orig-date', 'orig-year', 'origyear', 'access-date', 'accessdate', 'archive-date', 'archivedate']
        .forEach(function (k) { if (n[k]) c.fields[k] = plain(n[k]); });
      var pubText = c.fields.date || c.fields['publication-date'] || c.fields.year;
      var pub = pubText ? parseDate(pubText) : null;
      var kind = c.fields.date ? 'date' : c.fields['publication-date'] ? 'publication-date' : c.fields.year ? 'year' : null;
      if (!pub && c.fields.date && c.fields.year) { pub = parseDate(c.fields.year); kind = 'year'; }
      var origText = c.fields['orig-date'] || c.fields['orig-year'] || c.fields.origyear;
      var orig = origText ? parseDate(origText) : null;
      if (orig && (!pub || orig.lo < pub.lo)) { pub = orig; kind = 'orig-date'; }
      if (!pub && c.url) { var ud = urlDate(c.url); if (ud) { pub = ud; kind = 'url'; } }
      if (pubText && !pub) c.note = 'The date "' + pubText + '" could not be read.';
      c.source = pub;
      c.sourceKind = pub ? kind : null;
      var acc = c.fields['access-date'] || c.fields.accessdate;
      c.access = acc ? parseDate(acc) : null;
      return c;
    }
    // Free text: a bare link, a typed reference, or a note.
    var urlM = /(https?:\/\/[^\s\]|<>"]+)/i.exec(raw);
    c.url = urlM ? urlM[1] : null;
    var ext = /\[(https?:\/\/[^\s\]]+)\s+([^\]]+)\]/.exec(raw);
    var q = /["“]([^"”]{6,})["”]/.exec(c.text) || /''([^']{6,})''/.exec(raw);
    c.title = plain(ext ? ext[2] : q ? q[1] : '') || null;
    var acc2 = ACCESS_RE.exec(c.text);
    c.access = acc2 ? parseDate(acc2[1].trim()) : null;
    var wt = withoutTitles(raw);
    var fd = freeTextDate(wt.text);
    if (fd && !fd.ambiguous) {
      c.source = fd; c.sourceKind = 'free-text';
      // A lone year with no title to set it apart may itself be part of a title: too weak to
      // show that the source came first.
      if (fd.precision === 'year' && !wt.titleFound && !fd.bracketed) {
        c.sourceWeak = true;
        c.note = 'The year ' + fd.label + ' was found in the citation text, which has no clear title, so it may be part of one.';
      }
    }
    else if (fd && fd.ambiguous) c.note = 'The citation mentions more than one date, so none is used.';
    if (!c.source && c.url) { var u2 = urlDate(c.url); if (u2) { c.source = u2; c.sourceKind = 'url'; } }
    return c;
  }

  // Keys that identify the same citation across revisions, whatever its formatting.
  function citationKeys(cit) {
    var keys = [];
    if (!cit) return keys;
    if (cit.url) keys.push('url:' + normUrl(cit.url));
    var t = cit.title ? normTitle(cit.title) : '';
    if (t.length >= 12) keys.push('title:' + t);
    if (cit.kind === 'sfn' && cit.author) keys.push('sfn:' + normTitle(cit.author) + '|' + String(cit.sfnYear || '').replace(/[a-z]$/, ''));
    if (cit.kind === 'text' && !keys.length && cit.text && cit.text.length >= 12) keys.push('text:' + normTitle(cit.text).slice(0, 80));
    return keys;
  }

  // ---------------------------------------------------------------- matching
  var STOP = {};
  ('a an the and or but of to in on at by for from with as is was were are be been being it its this that these those ' +
   'he she they them his her their there which who whom whose what when where while also has have had into over ' +
   'than then so such s t i we our you your one about after before during between up out more most some any all can could ' +
   'would will may might do did does very same other only just both each many much who after').split(' ').forEach(function (w) { STOP[w] = 1; });

  // Negators are kept as words: "did not attend" must not match "did attend". Negators and plain
  // numbers ("1923", "20") are required words when matching. An ordinal such as "19th" is not, so
  // "19th-century" can still match "nineteenth-century".
  var NEGATORS = { not: 1, no: 1, never: 1, nor: 1, neither: 1, none: 1, nobody: 1, nothing: 1 };
  function isRequired(w) { return NEGATORS[w] === 1 || /^\d+$/.test(w); }

  function tokens(text) {
    var t = String(text || '').normalize ? String(text || '').normalize('NFKD') : String(text || '');
    t = t.replace(/n['\u2019]t\b/gi, ' not');
    var all = t.toLowerCase().replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9\u00df-\u024f\u0370-\u03ff\u0400-\u04ff\u3040-\u30ff\u4e00-\u9fff]+/).filter(Boolean);
    var content = all.filter(function (w) { return !STOP[w] && (w.length > 1 || /\d/.test(w)); });
    return content.length >= 2 ? content : all;
  }

  // Best window of the revision's text against the claim. Returns score in [0, 1] and the
  // sentences the best window touches. Matching is lexical, with two guards: every number and
  // negator in the claim must be in the window ("1923" is not "1925"), and a negator the claim
  // lacks must not sit among the matched words ("did not attend" is not "did attend"). A window
  // that fails a guard does not count; `raw` is the score without the guards.
  function matchClaim(claimTokens, sentences) {
    var n = claimTokens.length;
    if (!n) return { score: 0, raw: 0, sentences: [] };
    var need = {}, required = [];
    claimTokens.forEach(function (w) { need[w] = (need[w] || 0) + 1; if (isRequired(w) && required.indexOf(w) < 0) required.push(w); });
    var stream = [], owner = [];
    sentences.forEach(function (s, si) {
      var tk = s._tokens || (s._tokens = tokens(s.text));
      for (var i = 0; i < tk.length; i++) { stream.push(tk[i]); owner.push(si); }
    });
    var W = Math.max(n, Math.ceil(n * 1.25) + 2);
    var have = {};
    function span(end) {
      var from = Math.max(0, end - W + 1), firstHit = -1, lastHit = -1;
      for (var j = from; j <= end; j++) if (need[stream[j]]) { if (firstHit < 0) firstHit = j; lastHit = j; }
      return [firstHit, lastHit];
    }
    function guarded(end) {
      for (var r = 0; r < required.length; r++) if (!have[required[r]]) return false;
      var sp = span(end);
      // Look a couple of words before the first match too, within its sentence: "not" precedes
      // the verb it negates.
      var from = sp[0];
      while (from > 0 && from > sp[0] - 2 && owner[from - 1] === owner[sp[0]]) from--;
      for (var j = from; j <= sp[1] && j >= 0; j++) if (NEGATORS[stream[j]] && !need[stream[j]]) return false;
      return true;
    }
    var matched = 0, best = 0, bestEnd = -1, raw = 0, rawEnd = -1;
    for (var i = 0; i < stream.length; i++) {
      var w = stream[i];
      if (need[w]) { have[w] = (have[w] || 0) + 1; if (have[w] <= need[w]) matched++; }
      if (i >= W) {
        var o = stream[i - W];
        if (need[o]) { if (have[o] <= need[o]) matched--; have[o]--; }
      }
      if (matched > raw) { raw = matched; rawEnd = i; }
      if (matched > best && guarded(i)) { best = matched; bestEnd = i; }
      if (best === n) break;
    }
    var touched = [], end = bestEnd >= 0 ? bestEnd : rawEnd;
    if (end >= 0) {
      // Trim the window to the tokens that actually matched, then list their sentences.
      var sp = span(end);
      for (var k = sp[0]; k <= sp[1] && k >= 0; k++) if (touched.indexOf(owner[k]) < 0) touched.push(owner[k]);
    }
    return { score: best / n, raw: Math.max(raw, best) / n, sentences: touched };
  }

  // How rare each of the claim's words is in the chosen revision: inverse sentence frequency,
  // so "Osgoode" counts for more than "law". Used only to spot possible earlier wordings.
  function rarityWeights(claimTokens, sentences) {
    var df = {}, N = sentences.length, want = {};
    claimTokens.forEach(function (w) { want[w] = 1; });
    sentences.forEach(function (s) {
      var seen = {};
      (s._tokens || (s._tokens = tokens(s.text))).forEach(function (w) { if (want[w] && !seen[w]) { seen[w] = 1; df[w] = (df[w] || 0) + 1; } });
    });
    var weights = {};
    claimTokens.forEach(function (w) { weights[w] = Math.log((N + 1) / Math.max(1, df[w] || 0)); });
    return { weights: weights, df: df, N: N };
  }

  var RELATED_MIN = 0.3;
  // Sentences of a revision that could be an earlier wording of the claim: they share at least
  // RELATED_MIN of its rarity-weighted words, at least two words, and at least one rare word (one
  // found in no more than three sentences of the chosen revision). This only ever makes Echo more
  // cautious; it never counts as the claim being present.
  function relatedSentences(claimTokens, rarity, sentences, limit) {
    var uniq = [];
    claimTokens.forEach(function (w) { if (uniq.indexOf(w) < 0) uniq.push(w); });
    var total = uniq.reduce(function (sum, w) { return sum + rarity.weights[w]; }, 0);
    if (!total) return [];
    var out = [];
    sentences.forEach(function (s) {
      var tk = s._tokens || (s._tokens = tokens(s.text));
      var got = 0, shared = [], rare = false;
      uniq.forEach(function (w) {
        if (tk.indexOf(w) >= 0) { got += rarity.weights[w]; shared.push(w); if ((rarity.df[w] || 0) <= 3) rare = true; }
      });
      var share = got / total;
      if (share >= RELATED_MIN && shared.length >= 2 && rare) out.push({ text: s.text, share: share, shared: shared });
    });
    out.sort(function (a, b) { return b.share - a.share; });
    return out.slice(0, limit || 2);
  }

  // The claim's own words that an earlier wording shares, in the claim's order: a shorter text
  // to trace that follows the claim through the rewording.
  var EDGE_PUNCT = /^[!-\/:-@\[-`{-~“”‘’«»]+|[!-\/:-@\[-`{-~“”‘’«»]+$/g;
  function sharedWords(claimText, related) {
    var keep = {}, out = [], used = {};
    related.shared.forEach(function (w) { keep[w] = 1; });
    String(claimText).split(/\s+/).forEach(function (word) {
      var tk = tokens(word);
      if (tk.length && tk.every(function (w) { return keep[w]; }) && !tk.every(function (w) { return used[w]; })) { tk.forEach(function (w) { used[w] = 1; }); out.push(word.replace(EDGE_PUNCT, '')); }
    });
    return out.join(' ');
  }

  var THRESHOLD = 0.8;

  // The refs that support a sentence: its own, or, when it has none, the first refs that follow it
  // in the same paragraph (Wikipedia often cites a whole paragraph at its end).
  function supportingRefs(sentences, idxs) {
    var own = [];
    idxs.forEach(function (i) { (sentences[i].refs || []).forEach(function (r) { if (own.indexOf(r) < 0) own.push(r); }); });
    if (own.length || !idxs.length) return { refs: own, scope: own.length ? 'sentence' : 'none' };
    var last = Math.max.apply(null, idxs), para = sentences[last].para;
    for (var k = last + 1; k < sentences.length && sentences[k].para === para; k++) {
      if (sentences[k].refs.length) return { refs: sentences[k].refs.slice(), scope: 'paragraph' };
    }
    return { refs: [], scope: 'none' };
  }

  // Look at one revision's sentences: is the claim there, and is it carrying the citation?
  function probeDoc(doc, claimTokens, keys) {
    var m = matchClaim(claimTokens, doc.sentences);
    var present = m.score >= THRESHOLD;
    var sup = present ? supportingRefs(doc.sentences, m.sentences) : { refs: [], scope: 'none' };
    var cited = false;
    if (present && keys && keys.length) {
      sup.refs.forEach(function (rid) {
        var k2 = citationKeys(doc.refs[rid].citation);
        if (k2.some(function (k) { return keys.indexOf(k) >= 0; })) cited = true;
      });
    }
    return { present: present, score: m.score, raw: m.raw, cited: cited, refCount: sup.refs.length, scope: sup.scope };
  }
  function probeText(wikitext, claimTokens, keys) { return probeDoc(analyseWikitext(wikitext), claimTokens, keys); }

  // ---------------------------------------------------------------- the search
  // probe(i) resolves to {present: true|false|null}. null means unknown (hidden revision or the
  // fetch cap was reached). These functions only ever look at indices in [lo, hi].
  async function firstPresent(lo, hi, probe) {
    // Smallest index in [lo, hi] where present, assuming absent...absent present...present and
    // probe(hi) present. Returns {first, lastAbsent, exact, capped}.
    var L = lo - 1, H = hi; // invariant: L absent (or before range), H present
    var capped = false;
    while (H - L > 1) {
      var mid = Math.floor((L + H) / 2);
      var r = await probe(mid);
      var j = mid;
      // Unknown: step to the right until something is known or we reach H.
      while (r.present == null && !r.capped && j + 1 < H) { j++; r = await probe(j); }
      if (r.capped) { capped = true; break; }
      if (r.present == null) {
        // Everything between mid and H is unknown; try the left side instead.
        var k = mid - 1;
        r = { present: null };
        while (k > L && r.present == null && !r.capped) { r = await probe(k); if (r.present == null) k--; }
        if (r.capped) { capped = true; break; }
        if (r.present == null) break; // all unknown between L and H
        if (r.present) H = k; else L = k;
        continue;
      }
      if (r.present) H = j; else L = j;
    }
    return { first: H, lastAbsent: L >= lo ? L : null, exact: H - L === 1 && !capped, capped: capped };
  }

  function spread(lo, hi, count, skip) {
    var out = [];
    if (hi < lo) return out;
    for (var k = 1; k <= count; k++) {
      var i = lo + Math.round(k * (hi - lo) / (count + 1));
      if (i >= lo && i <= hi && out.indexOf(i) < 0 && (!skip || skip.indexOf(i) < 0)) out.push(i);
    }
    return out;
  }

  // Find the earliest revision where the claim is present, then test the monotonic assumption.
  // n revisions, index n-1 is the target and is present.
  async function traceFirstAppearance(n, probe, opts) {
    opts = opts || {};
    var earlierSamples = opts.earlierSamples == null ? 5 : opts.earlierSamples;
    var laterSamples = opts.laterSamples == null ? 3 : opts.laterSamples;
    var events = []; // {index, present} observations that break monotonicity
    var res = await firstPresent(0, n - 1, probe);
    var messy = { earlier: false, gap: false, flicker: false };
    var rounds = 0;
    // Look for presence before the boundary; if found, search again below it.
    while (!res.capped && res.first > 1 && rounds < 4) {
      rounds++;
      var samples = spread(0, res.first - 2, earlierSamples);
      var hit = null;
      for (var s = 0; s < samples.length; s++) {
        var r = await probe(samples[s]);
        if (r.capped) { res.capped = true; break; }
        if (r.present) { hit = samples[s]; break; }
      }
      if (hit == null) break;
      messy.earlier = true;
      events.push({ kind: 'earlier', index: hit, absentAt: res.lastAbsent, laterFirst: res.first });
      var again = await firstPresent(0, hit, probe);
      res = { first: again.first, lastAbsent: again.lastAbsent, exact: again.exact, capped: again.capped };
    }
    // Neighbours and later samples: was it removed and re-added afterwards?
    if (!res.capped) {
      var after = [];
      if (res.first + 1 < n - 1) after.push(res.first + 1);
      spread(res.first + 1, n - 2, laterSamples, after).forEach(function (i) { after.push(i); });
      for (var a = 0; a < after.length; a++) {
        var rr = await probe(after[a]);
        if (rr.capped) { res.capped = true; break; }
        if (rr.present === false) {
          if (after[a] === res.first + 1) messy.flicker = true; else messy.gap = true;
          events.push({ kind: after[a] === res.first + 1 ? 'flicker' : 'gap', index: after[a] });
        }
      }
    }
    return {
      first: res.first, lastAbsent: res.lastAbsent, exact: res.exact && !res.capped, capped: !!res.capped,
      messy: messy.earlier || messy.gap || messy.flicker, messyKinds: messy, events: events
    };
  }

  // ---------------------------------------------------------------- the verdict
  var VERDICTS = {
    echo: 'Possible echo',
    first: 'Source came first',
    later: 'Citation added later',
    unknown: 'Can’t tell'
  };

  function quote(t) { t = String(t || ''); return '“' + (t.length > 140 ? t.slice(0, 138) + '…' : t) + '”'; }
  // A quoted sentence followed by more prose: no second full stop after one inside the quote.
  function quoteThen(t) { return quote(t) + (/[.!?]$/.test(String(t || '').trim()) && String(t).length <= 140 ? ' ' : '. '); }

  // first: {day (first revision seen with this wording), lastAbsentDay, exact, messy, capped, wordingCheck}
  // citation: {addedDay, sameRevision, appearedUnsourced} or null
  // sources: [{source: interval|null, sourceKind, weak, access: interval|null}]
  // related: an earlier wording that shares the claim's rarer words, traced back:
  //   {day, label, revid, text, settled} or null. It can only make the verdict more cautious.
  function decide(first, citation, sources, related) {
    var reasons = [];
    var presentDay = first.day;
    // Earliest day the claim could have appeared: exact when the boundary is tight and clean.
    var earliestDay = first.exact && !first.messy ? first.day : (first.messy ? null : first.lastAbsentDay);
    var rel = sources.map(function (s) {
      if (!s.source) return 'unknown';
      if (s.source.lo > presentDay) return 'after';
      if (earliestDay != null && s.source.hi < earliestDay) return s.weak ? 'weak' : 'before';
      return 'overlap';
    });
    var anyBefore = rel.indexOf('before') >= 0, anyAfter = rel.indexOf('after') >= 0;
    var allUndated = rel.every(function (r) { return r === 'unknown'; });
    var code;
    if (!sources.length) { code = 'unknown'; reasons.push('The sentence has no citation to compare.'); }
    else if (anyBefore) {
      code = 'first';
      if (related) {
        var stillFirst = related.settled && sources.some(function (s, i) { return rel[i] === 'before' && s.source.hi < related.day; });
        if (!stillFirst) {
          code = 'unknown';
          reasons.push('A cited source is dated before this wording first appeared, but an earlier wording that shares its rarer words was on Wikipedia ' +
            (related.settled ? 'from ' : 'by ') + related.label + ' (revision ' + related.revid + '): ' + quoteThen(related.text) + 'The source is not dated before that. ' +
            'If the earlier wording makes the same claim, the source may repeat Wikipedia. Echo cannot tell whether it does.');
          if (!related.settled) reasons.push('Echo could not trace that earlier wording all the way back, so it may be older still.');
        } else {
          reasons.push('An earlier wording that shares its rarer words was on Wikipedia from ' + related.label + ': ' + quoteThen(related.text) + 'The source is dated before that too.');
        }
      }
      if (code === 'first') {
        reasons.unshift('At least one cited source is dated before the earliest wording of the claim that Echo found on Wikipedia.');
        if (first.wordingCheck === 'none') reasons.push('Echo looked in the revisions it read from before this wording for a sentence sharing its rarer words, and found none. An earlier wording in quite different words would not be caught.');
        if (anyAfter) reasons.push('Another cited source is dated after the claim appeared; it may repeat Wikipedia, but the claim has an earlier source.');
      }
    } else if (anyAfter) {
      code = 'echo';
      reasons.push('The cited source is dated after a revision that already contained the claim.');
    } else if (allUndated && citation && citation.addedDay != null && !citation.sameRevision) {
      if (citation.appearedUnsourced) {
        code = 'later';
        reasons.push('The claim appeared on Wikipedia with no citation, and this one was attached later. That is context, not proof: editors often add sources to older claims.');
      } else {
        code = 'unknown';
        reasons.push('This citation was attached after the claim appeared, but the claim already had another citation then, so this is not a claim that appeared unsourced.');
      }
    } else {
      code = 'unknown';
    }
    if (first.messy) reasons.push('History is messy: the claim was removed and re-added at least once, so the first-appearance date is a best effort, not a certainty.');
    if (first.capped) reasons.push('The fetch limit was reached, so the first appearance is only known to a range of revisions.');
    if (first.hiddenBefore) reasons.push('Some earlier revisions have hidden text, so the claim may have appeared before the first revision Echo could read.');
    sources.forEach(function (s, i) {
      if (rel[i] === 'unknown' && s.access) reasons.push('A source has no publication date. Its access date (' + s.access.label + ') is only a hint: the page existed by then.');
      if (rel[i] === 'overlap') reasons.push('A source dated ' + s.source.label + ' overlaps the time the claim appeared, at the precision given.');
      if (rel[i] === 'weak') reasons.push('A source’s year (' + s.source.label + ') was found in free citation text with no clear title, so it may be part of a title. On its own it cannot show that the source came first.');
    });
    if (code === 'unknown' && sources.length && allUndated) reasons.unshift('No cited source has a usable publication date.');
    return { code: code, label: VERDICTS[code], relations: rel, reasons: reasons };
  }

  // ---------------------------------------------------------------- input
  function parseArticleInput(input, oldidInput) {
    var s = String(input || '').trim(), title = null, oldid = null;
    var o = String(oldidInput || '').trim();
    if (o) { if (!/^\d+$/.test(o)) return { error: 'The revision id should be a number.' }; oldid = +o; }
    if (/^(https?:)?\/\//i.test(s) || /wikipedia\.org/i.test(s)) {
      var url;
      try { url = new URL(/^\/\//.test(s) ? 'https:' + s : (/^https?:/i.test(s) ? s : 'https://' + s)); } catch (e) { return { error: 'That link could not be read.' }; }
      if (!/^(en\.(m\.)?wikipedia\.org)$/i.test(url.hostname)) return { error: 'Echo reads English Wikipedia only (en.wikipedia.org).' };
      var p = url.pathname;
      if (/^\/wiki\//.test(p)) title = decodeURIComponent(p.slice(6));
      if (url.searchParams.get('title')) title = url.searchParams.get('title');
      var u1 = url.searchParams.get('oldid'), u2 = url.searchParams.get('diff');
      if (!oldid && u1 && /^\d+$/.test(u1)) oldid = +u1;
      if (!oldid && u2 && /^\d+$/.test(u2)) oldid = +u2;
    } else if (s) title = s;
    if (title) title = title.replace(/_/g, ' ').replace(/#.*$/, '').trim();
    if (!title && !oldid) return { error: 'Give an article title or link.' };
    return { title: title || null, oldid: oldid };
  }

  // ---------------------------------------------------------------- the analysis driver
  var USER_AGENT = 'Echo/1.0 (https://milbirguram.github.io/projects/echo/)';
  var API = 'https://en.wikipedia.org/w/api.php';
  var FETCH_CAP = 40;

  function fmtInt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  async function loadRevision(api, title, oldid) {
    var params = { action: 'query', prop: 'revisions', rvprop: 'ids|timestamp|content', rvslots: 'main' };
    if (oldid) params.revids = oldid;
    else { params.titles = title; params.redirects = 1; }
    var j = await api(params);
    var q = j.query || {};
    if (q.badrevids) throw new Error('No revision with id ' + oldid + '.');
    var page = (q.pages || [])[0];
    if (!page || page.missing || page.invalid) throw new Error('No English Wikipedia article called "' + title + '".');
    if (page.ns !== 0) throw new Error('That is not an article (namespace ' + page.ns + ').');
    var rev = page.revisions && page.revisions[0];
    if (!rev || !rev.slots || rev.slots.main.texthidden || rev.slots.main.content == null) throw new Error('That revision’s text is hidden or unavailable.');
    var content = rev.slots.main.content;
    if (/^#redirect/i.test(content)) throw new Error('That revision is a redirect. Use the target article.');
    return { pageid: page.pageid, title: page.title, revid: rev.revid, timestamp: rev.timestamp, content: content };
  }

  async function listRevisions(api, pageid, endRevid, log) {
    var out = [], cont = {};
    for (var guard = 0; guard < 400; guard++) {
      var params = { action: 'query', prop: 'revisions', pageids: pageid, rvprop: 'ids|timestamp|sha1', rvlimit: 'max', rvdir: 'newer', rvendid: endRevid };
      for (var k in cont) params[k] = cont[k];
      var j = await api(params);
      var page = j.query && j.query.pages && j.query.pages[0];
      (page && page.revisions || []).forEach(function (r) {
        out.push({ revid: r.revid, timestamp: r.timestamp, sha1: r.sha1 || null, hidden: !!(r.sha1hidden || r.texthidden) });
      });
      if (log) log('Listing revisions… ' + fmtInt(out.length) + (j.continue ? ' so far' : ' in all'));
      if (!j.continue) break;
      cont = j.continue;
    }
    return out;
  }

  function sourcesFor(doc, sentence, refsOverride) {
    var sup = supportingRefs(doc.sentences, [doc.sentences.indexOf(sentence)]);
    var ids = refsOverride || sup.refs;
    return {
      scope: sup.scope,
      refs: ids.map(function (rid) { return doc.refs[rid]; })
    };
  }

  // Run the full analysis for one sentence of a loaded revision.
  // target: result of loadRevision; doc: analyseWikitext(target.content); sentence: one of doc.sentences;
  // traceText: the text to look for (defaults to the sentence); api(params) -> Promise<json>.
  async function analyse(o) {
    var api = o.api, log = o.log || function () {}, cap = o.cap || FETCH_CAP;
    var target = o.target, doc = o.doc, sentence = o.sentence;
    var traceText = (o.traceText || sentence.text).trim();
    var claimTokens = tokens(traceText);
    if (claimTokens.length < 2) throw new Error('The text to trace needs at least two words.');
    var sup = sourcesFor(doc, sentence);
    var refs = sup.refs;
    var keys = [];
    refs.forEach(function (r) { citationKeys(r.citation).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); }); });

    var selfCheck = probeDoc(doc, claimTokens, keys);
    if (!selfCheck.present) throw new Error('The text to trace was not found in the chosen revision. Use words from the sentence.');

    log('Listing revisions up to ' + target.revid + '…');
    var revs = await listRevisions(api, target.pageid, target.revid, log);
    if (!revs.length || revs[revs.length - 1].revid !== target.revid) {
      var at = revs.map(function (r) { return r.revid; }).indexOf(target.revid);
      if (at < 0) throw new Error('Could not place revision ' + target.revid + ' in the article’s history.');
      revs = revs.slice(0, at + 1);
    }
    var total = revs.length;
    revs.forEach(function (r, i) { r.orig = i; });
    var createdTs = revs[0].timestamp;
    // Revisions whose text was deleted by administrators cannot be read; leave them out.
    var hiddenCount = revs.filter(function (r) { return r.hidden; }).length;
    revs = revs.filter(function (r, i) { return !r.hidden || i === total - 1; });
    var n = revs.length;
    log(fmtInt(total) + ' revisions from ' + revs[0].timestamp.slice(0, 10) + ' to ' + revs[n - 1].timestamp.slice(0, 10) +
      (hiddenCount ? ' (' + fmtInt(hiddenCount) + ' with hidden text, skipped)' : '') + '. Searching for the first one with the claim.');
    // Hidden revisions between two readable ones (or before the first readable one) mean the
    // boundary between them is not tight.
    function hiddenGap(i, prev) { return revs[i].orig - (prev != null ? revs[prev].orig : -1) > 1; }

    // Each revision is fetched and parsed at most once; several searches can read it.
    var docs = {}, bySha = {}, fetches = 0, capHit = false;
    docs[n - 1] = doc;
    if (revs[n - 1].sha1) bySha[revs[n - 1].sha1] = doc;
    async function getDoc(i) {
      if (docs[i]) return docs[i];
      // Identical text (a revert, say) gives an identical answer without another fetch.
      if (revs[i].sha1 && bySha[revs[i].sha1]) return (docs[i] = bySha[revs[i].sha1]);
      if (fetches >= cap) { capHit = true; return { capped: true }; }
      fetches++;
      var rv = revs[i];
      log('Checking ' + rv.timestamp.slice(0, 10) + ' (revision ' + rv.revid + ', fetch ' + fetches + ' of at most ' + cap + ')…');
      var j = await api({ action: 'query', prop: 'revisions', revids: rv.revid, rvprop: 'ids|timestamp|content', rvslots: 'main' });
      var page = j.query && j.query.pages && j.query.pages[0];
      var r = page && page.revisions && page.revisions[0];
      var slot = r && r.slots && r.slots.main;
      var d;
      if (!slot || slot.texthidden || slot.content == null) { d = { hidden: true }; log('  text hidden; skipping.'); }
      else { d = analyseWikitext(slot.content); if (rv.sha1) bySha[rv.sha1] = d; }
      docs[i] = d;
      return d;
    }
    function makeProbe(ct, ks, what) {
      var memo = {};
      var probe = async function (i) {
        if (memo[i]) return memo[i];
        var d = await getDoc(i);
        if (d.capped) return { present: null, capped: true };
        if (d.hidden) return (memo[i] = { present: null, hidden: true });
        var res = probeDoc(d, ct, ks);
        memo[i] = res;
        log('  ' + (what === 'claim' ? '' : revs[i].timestamp.slice(0, 10) + ': ') + what + ' ' + (res.present ? 'present' : 'absent') +
          ' (match ' + Math.round(res.score * 100) + '%' + (res.raw > res.score + 0.001 ? '; ' + Math.round(res.raw * 100) + '% if a differing number or “not” is ignored' : '') + ')' +
          (res.present && ks && ks.length ? (res.cited ? ', with this citation' : ', without this citation') : '') + '.');
        return res;
      };
      probe.memo = memo;
      return probe;
    }
    var probe = makeProbe(claimTokens, keys, 'claim');
    probe.memo[n - 1] = selfCheck;

    var fa = await traceFirstAppearance(n, probe, o.searchOpts);
    var firstRev = revs[fa.first], prevRev = fa.lastAbsent != null ? revs[fa.lastAbsent] : null;
    var first0Messy = fa.messy;
    if (fa.messy) log('History is messy: the claim was not present in every revision after it first appeared.');

    // When was the citation first attached to the claim?
    var citation = null;
    if (keys.length) {
      var firstState = probe.memo[fa.first];
      if (firstState && firstState.cited) {
        citation = { index: fa.first, prevIndex: null, sameRevision: true, appearedUnsourced: false };
        log('The claim arrived with this citation already attached.');
      } else if (!capHit) {
        log('Searching for when the citation was attached…');
        var cprobe = async function (i) {
          var r = await probe(i);
          if (r.present == null) return r;
          return { present: !!(r.present && r.cited), capped: r.capped };
        };
        var ca = await firstPresent(fa.first, n - 1, cprobe);
        citation = { index: ca.first, prevIndex: ca.lastAbsent, sameRevision: false, exact: ca.exact && !hiddenGap(ca.first, ca.lastAbsent), capped: ca.capped,
          appearedUnsourced: !!(firstState && firstState.refCount === 0) };
      }
    }
    // Any revision seen after the first appearance without the claim breaks the monotonic
    // assumption, whichever search happened to look at it.
    Object.keys(probe.memo).forEach(function (k) {
      var i = +k;
      if (i > fa.first && i < n - 1 && probe.memo[k].present === false && !fa.events.some(function (e) { return e.index === i; })) {
        fa.messy = true;
        if (i === fa.first + 1) fa.messyKinds.flicker = true; else fa.messyKinds.gap = true;
        fa.events.push({ kind: i === fa.first + 1 ? 'flicker' : 'gap', index: i });
      }
    });
    if (fa.messy && !first0Messy) log('History is messy: the claim was missing from at least one later revision.');

    var sources = refs.map(function (r) {
      return { ref: r, source: r.citation.source, sourceKind: r.citation.sourceKind, weak: !!r.citation.sourceWeak, access: r.citation.access };
    });
    var hiddenBefore = hiddenGap(fa.first, fa.lastAbsent);
    var first = {
      index: fa.first, revid: firstRev.revid, timestamp: firstRev.timestamp, day: isoToDay(firstRev.timestamp),
      prevRevid: prevRev ? prevRev.revid : null, prevTimestamp: prevRev ? prevRev.timestamp : null,
      // With hidden revisions before the first one read, the claim can be no older than the article.
      lastAbsentDay: prevRev ? isoToDay(prevRev.timestamp) : hiddenBefore ? isoToDay(createdTs) : null,
      exact: (fa.exact || fa.first === 0) && !hiddenBefore, hiddenBefore: hiddenBefore, firstVisible: fa.first === 0 && hiddenBefore,
      messy: fa.messy, messyKinds: fa.messyKinds, capped: fa.capped || capHit,
      events: fa.events.map(function (e) { return { kind: e.kind, revid: revs[e.index].revid, timestamp: revs[e.index].timestamp }; })
    };
    var cit = null;
    if (citation) {
      var cr = revs[citation.index];
      cit = { revid: cr.revid, timestamp: cr.timestamp, addedDay: isoToDay(cr.timestamp), sameRevision: citation.sameRevision,
        prevRevid: citation.prevIndex != null ? revs[citation.prevIndex].revid : null, exact: citation.sameRevision || citation.exact,
        appearedUnsourced: citation.appearedUnsourced };
    }

    // An earlier wording? The claim may have been reworded, so this wording's first appearance
    // can be years after the claim's. Look in every revision already read from before it for a
    // sentence sharing the claim's rarer words.
    var rarity = rarityWeights(claimTokens, doc.sentences);
    function hintsBefore(limit) {
      var idx = Object.keys(docs).map(Number).filter(function (i) { return i < limit && !docs[i].hidden && !docs[i].capped; })
        .sort(function (a, b) { return b - a; });
      for (var h = 0; h < idx.length; h++) {
        var rs = relatedSentences(claimTokens, rarity, docs[idx[h]].sentences, 2);
        if (rs.length) return { index: idx[h], related: rs };
      }
      return null;
    }
    var hint = fa.first > 0 ? hintsBefore(fa.first) : null;
    first.wordingCheck = hint ? 'found' : fa.first === 0 ? 'start' : docs[fa.lastAbsent] && docs[fa.lastAbsent].sentences ? 'none' : 'unavailable';
    var earlier = null, related = null;
    if (hint) {
      earlier = { revid: revs[hint.index].revid, timestamp: revs[hint.index].timestamp,
        sentences: hint.related.map(function (r) { return { text: r.text, share: r.share, suggest: sharedWords(traceText, r) }; }) };
      log('Revision ' + earlier.revid + ' (' + earlier.timestamp.slice(0, 10) + '), from before this wording, has a sentence sharing its rarer words: ' + quote(hint.related[0].text));
    } else if (first.wordingCheck === 'none') log('No earlier wording sharing its rarer words in the revisions read from before it.');

    var verdict = decide(first, cit, sources, null);
    // Only "Source came first" can be undone by an earlier wording, so only then is it traced.
    if (verdict.code === 'first' && hint) {
      var at2 = hint, hops = 0;
      while (at2 && hops < 3) {
        hops++;
        var hopBest = null;
        for (var c = 0; c < at2.related.length; c++) {
          var cand = at2.related[c];
          log('Tracing the earlier wording back: ' + quote(cand.text));
          var rp = makeProbe(tokens(cand.text), null, 'earlier wording');
          var tr = await traceFirstAppearance(at2.index + 1, rp, { earlierSamples: 3, laterSamples: 0 });
          var rr = revs[tr.first];
          var item = { text: cand.text, revid: rr.revid, timestamp: rr.timestamp, day: isoToDay(rr.timestamp), label: dayToLabel(isoToDay(rr.timestamp)),
            index: tr.first, settled: !tr.capped && !capHit && !tr.messy && (tr.exact || tr.first === 0) && !hiddenGap(tr.first, tr.lastAbsent) };
          if (!hopBest || item.day < hopBest.day) hopBest = item;
          if (capHit) break;
        }
        if (!related || hopBest.day <= related.day) related = hopBest;
        if (capHit) { related.settled = false; break; }
        at2 = hopBest.index > 0 ? hintsBefore(hopBest.index) : null;
        if (at2) related.settled = false;
      }
      verdict = decide(first, cit, sources, related);
    }
    if (capHit) log('Reached the limit of ' + cap + ' revision fetches. Results below say what is still uncertain.');
    log('Done: ' + verdict.label + '. ' + fetches + ' revision fetch' + (fetches === 1 ? '' : 'es') + '.');
    return {
      title: target.title, pageid: target.pageid, targetRevid: target.revid, targetTimestamp: target.timestamp,
      sentence: sentence.text, traceText: traceText, revisionCount: total, hiddenCount: hiddenCount, fetches: fetches, cap: cap, capHit: capHit,
      first: first, citation: cit, sources: sources, scope: sup.scope, earlier: earlier, related: related, verdict: verdict
    };
  }

  // A browser or Node api(params) with the etiquette Wikipedia asks for: one request at a time,
  // cached for the session, maxlag respected. `transport(url, headers)` returns parsed JSON.
  function makeApi(transport, opts) {
    opts = opts || {};
    var cache = new Map(), queue = Promise.resolve(), wait = opts.wait || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    function url(params) {
      var q = { origin: '*', format: 'json', formatversion: 2, maxlag: 5 };
      for (var k in params) q[k] = params[k];
      return API + '?' + Object.keys(q).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(q[k]); }).join('&');
    }
    return function api(params) {
      var u = url(params);
      if (cache.has(u)) return cache.get(u);
      var p = queue.then(async function () {
        for (var attempt = 0; attempt < 4; attempt++) {
          var j = await transport(u, { 'Api-User-Agent': USER_AGENT });
          if (j && j.error && j.error.code === 'maxlag') { await wait(5000); continue; }
          if (j && j.error) throw new Error('Wikipedia said: ' + (j.error.info || j.error.code));
          return j;
        }
        throw new Error('Wikipedia is busy (replication lag). Try again in a minute.');
      });
      queue = p.catch(function () {});
      cache.set(u, p);
      p.catch(function () { cache.delete(u); });
      return p;
    };
  }

  return {
    parseDate: parseDate, relation: relation, dayNum: dayNum, dayToIso: dayToIso, dayToLabel: dayToLabel, probeDoc: probeDoc, isoToDay: isoToDay,
    analyseWikitext: analyseWikitext, splitSentences: splitSentences, parseCitation: parseCitation,
    citationKeys: citationKeys, normUrl: normUrl, urlDate: urlDate, tokens: tokens, matchClaim: matchClaim,
    probeText: probeText, supportingRefs: supportingRefs, rarityWeights: rarityWeights, relatedSentences: relatedSentences,
    sharedWords: sharedWords, RELATED_MIN: RELATED_MIN, firstPresent: firstPresent,
    traceFirstAppearance: traceFirstAppearance, decide: decide, VERDICTS: VERDICTS, THRESHOLD: THRESHOLD,
    parseArticleInput: parseArticleInput, loadRevision: loadRevision, listRevisions: listRevisions,
    analyse: analyse, makeApi: makeApi, API: API, USER_AGENT: USER_AGENT, FETCH_CAP: FETCH_CAP, fmtInt: fmtInt
  };
});
