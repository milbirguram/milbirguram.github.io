/*
 * Rote — model.js
 * Everything that decides what is read aloud, shared by the page and the node tests:
 *   - number words in the conventions of the Kestrel references (no "and", "o" for zero digits)
 *   - a hand-written rule system: classify a token, then verbalise it
 *   - a free-text tokeniser for the page
 *   - the copy and lookup systems
 *   - the two metrics (exact match, and the old Keras-style per-slot accuracy with padding)
 *   - a coarse error typer ("silly errors")
 * pipeline/rules.py and pipeline/metrics.py are line-for-line Python twins; tests/ checks they agree.
 */
(function (root) {
  'use strict';

  // ---------- number words ----------
  var ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  var TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  var SCALES = ['', 'thousand', 'million', 'billion', 'trillion', 'quadrillion'];
  var DIGIT_O = ['o', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

  function under100(n) {
    if (n < 20) return ONES[n];
    return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
  }
  function under1000(n) {
    var h = Math.floor(n / 100), r = n % 100, parts = [];
    if (h) parts.push(ONES[h] + ' hundred');
    if (r) parts.push(under100(r));
    return parts.join(' ');
  }
  // digits: a string of ASCII digits, any length up to 18
  function cardinal(digits) {
    digits = String(digits).replace(/^0+(?=\d)/, '');
    if (!/^\d+$/.test(digits)) return null;
    if (/^0+$/.test(digits)) return 'zero';
    if (digits.length > 18) return null;
    var groups = [];
    for (var i = digits.length; i > 0; i -= 3) groups.unshift(parseInt(digits.slice(Math.max(0, i - 3), i), 10));
    var words = [];
    for (var g = 0; g < groups.length; g++) {
      var v = groups[g], scale = SCALES[groups.length - 1 - g];
      if (v) words.push(under1000(v) + (scale ? ' ' + scale : ''));
    }
    return words.join(' ');
  }
  function digitsO(s) { // "105" -> "one o five"
    var out = [];
    for (var i = 0; i < s.length; i++) if (/\d/.test(s[i])) out.push(DIGIT_O[+s[i]]);
    return out.join(' ');
  }
  var ORD_IRREG = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };
  function ordinalWord(w) {
    if (ORD_IRREG[w]) return ORD_IRREG[w];
    if (/y$/.test(w)) return w.slice(0, -1) + 'ieth';
    return w + 'th';
  }
  function ordinalize(words) { // last word to ordinal
    var p = words.split(' ');
    p[p.length - 1] = ordinalWord(p[p.length - 1]);
    return p.join(' ');
  }
  function pluralWord(w) {
    if (/y$/.test(w)) return w.slice(0, -1) + 'ies';
    if (/x$|s$/.test(w)) return w + 'es';
    return w + 's';
  }
  function pluralize(words) {
    var p = words.split(' ');
    p[p.length - 1] = pluralWord(p[p.length - 1]);
    return p.join(' ');
  }
  // years: 1987 nineteen eighty seven, 1905 nineteen o five, 1900 nineteen hundred,
  // 2000 two thousand, 2008 two thousand eight, 2010 twenty ten, 249 two forty nine
  function yearWords(s) {
    var y = parseInt(s, 10);
    if (isNaN(y)) return null;
    if (y < 100) return cardinal(String(y));
    if (y >= 2000 && y < 2010) return cardinal(String(y));
    if (y % 1000 === 0) return cardinal(String(y));
    var hi = Math.floor(y / 100), lo = y % 100;
    if (lo === 0) return under100(hi) + ' hundred';
    if (y < 1000 && hi < 10) return ONES[hi] + ' ' + (lo < 10 ? 'o ' + ONES[lo] : under100(lo));
    return under100(hi) + ' ' + (lo < 10 ? 'o ' + ONES[lo] : under100(lo));
  }
  function twoDigitYear(s) { // "07" -> "o seven", "14" -> "fourteen"
    var v = parseInt(s, 10);
    if (s.length === 2 && s[0] === '0') return 'o ' + ONES[v];
    return under100(v);
  }

  // number string (commas allowed, optional decimal part, optional sign) -> words
  var NUM_RE = /^([-−]?)(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d+))?$/;
  function decimalFraction(frac) {
    if (frac === '0') return 'zero';
    return digitsO(frac);
  }
  function numberWords(s) {
    var m = NUM_RE.exec(s);
    if (!m || (!m[2] && !m[3])) return null;
    var parts = [];
    if (m[1]) parts.push('minus');
    if (m[2]) {
      var cw = cardinal(m[2].replace(/,/g, ''));
      if (cw === null) return null;
      parts.push(cw);
    }
    if (m[3] !== undefined) parts.push('point', decimalFraction(m[3]));
    return parts.join(' ');
  }
  function isOne(s) { return /^[-−]?0*1$/.test(s.replace(/,/g, '')); }

  // ---------- tables ----------
  var MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  var MONTH_ABBR = { jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
  function monthIndex(w) {
    var k = w.toLowerCase().replace(/\.$/, '');
    var i = MONTHS.indexOf(k);
    if (i >= 0) return i;
    return Object.prototype.hasOwnProperty.call(MONTH_ABBR, k) ? MONTH_ABBR[k] : -1;
  }
  var MONTH_PAT = '(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\\.?';

  // unit -> [singular, plural]
  var UNITS = {
    'km': ['kilometer', 'kilometers'], 'm': ['meter', 'meters'], 'cm': ['centimeter', 'centimeters'],
    'mm': ['millimeter', 'millimeters'], 'μm': ['micrometer', 'micrometers'], 'µm': ['micrometer', 'micrometers'],
    'nm': ['nanometer', 'nanometers'], 'kg': ['kilogram', 'kilograms'], 'g': ['gram', 'grams'],
    'mg': ['milligram', 'milligrams'], 'lb': ['pound', 'pounds'], 'lbs': ['pound', 'pounds'],
    'oz': ['ounce', 'ounces'], 'ft': ['foot', 'feet'], "'": ['foot', 'feet'], 'in': ['inch', 'inches'],
    'mi': ['mile', 'miles'], 'yd': ['yard', 'yards'], 'mph': ['mile per hour', 'miles per hour'],
    'km/h': ['kilometer per hour', 'kilometers per hour'], 'kmh': ['kilometer per hour', 'kilometers per hour'],
    'km/hr': ['kilometer per hour', 'kilometers per hour'], 'm/s': ['meter per second', 'meters per second'],
    'km2': ['square kilometer', 'square kilometers'], 'km²': ['square kilometer', 'square kilometers'],
    'm2': ['square meter', 'square meters'], 'm²': ['square meter', 'square meters'],
    'sq mi': ['square mile', 'square miles'], 'mi2': ['square mile', 'square miles'], 'mi²': ['square mile', 'square miles'],
    'ha': ['hectare', 'hectares'], 'kB': ['kilobyte', 'kilobytes'], 'KB': ['kilobyte', 'kilobytes'],
    'kb': ['kilobit', 'kilobits'], 'MB': ['megabyte', 'megabytes'], 'Mb': ['megabit', 'megabits'],
    'GB': ['gigabyte', 'gigabytes'], 'TB': ['terabyte', 'terabytes'], 'W': ['watt', 'watts'],
    'kW': ['kilowatt', 'kilowatts'], 'MW': ['megawatt', 'megawatts'], 'GW': ['gigawatt', 'gigawatts'],
    'kWh': ['kilowatt hour', 'kilowatt hours'], 'V': ['volt', 'volts'], 'kV': ['kilovolt', 'kilovolts'],
    'Hz': ['hertz', 'hertz'], 'kHz': ['kilohertz', 'kilohertz'], 'MHz': ['megahertz', 'megahertz'],
    'GHz': ['gigahertz', 'gigahertz'], 'hp': ['horsepower', 'horsepower'],
    '°C': ['degree celsius', 'degrees celsius'], '°F': ['degree fahrenheit', 'degrees fahrenheit'],
    '°': ['degree', 'degrees'], 'L': ['liter', 'liters'], 'l': ['liter', 'liters'], 'ml': ['milliliter', 'milliliters'],
    'mL': ['milliliter', 'milliliters'], 's': ['second', 'seconds'], 'sec': ['second', 'seconds'],
    'min': ['minute', 'minutes'], 'h': ['hour', 'hours'], 'hr': ['hour', 'hours'], 'hrs': ['hour', 'hours'],
    'ms': ['millisecond', 'milliseconds'], '%': ['percent', 'percent'], 'percent': ['percent', 'percent'],
    'per cent': ['percent', 'percent'], 'kcal': ['kilocalorie', 'kilocalories'], 'cal': ['calorie', 'calories'],
    'acres': ['acre', 'acres'], 'acre': ['acre', 'acres'], 'sq ft': ['square foot', 'square feet'],
    'sq km': ['square kilometer', 'square kilometers'], '"': ['inch', 'inches'], 'cc': ['c c', 'c c'],
    'rpm': ['revolution per minute', 'revolutions per minute'], 'kN': ['kilonewton', 'kilonewtons'],
    'µg': ['microgram', 'micrograms'], 'μg': ['microgram', 'micrograms'], 'kJ': ['kilojoule', 'kilojoules'],
    'AU': ['astronomical unit', 'astronomical units'], 'degrees F': ['degree fahrenheit', 'degrees fahrenheit'],
    'degrees C': ['degree celsius', 'degrees celsius']
  };
  var UNIT_KEYS = Object.keys(UNITS).sort(function (a, b) { return b.length - a.length || (a < b ? -1 : 1); });
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'); }
  var UNIT_ALT = UNIT_KEYS.map(escRe).join('|');

  var CURRENCY_PREFIX = { '$': 'dollar', 'US$': 'dollar', 'A$': 'dollar', 'C$': 'dollar', 'NZ$': 'dollar', 'HK$': 'dollar',
    'S$': 'dollar', '£': 'pound', '€': 'euro', '¥': 'yen', '₹': 'rupee', 'Rs': 'rupee', 'Rs.': 'rupee' };
  var CURRENCY_CODE = { 'USD': 'united states dollar', 'EUR': 'euro', 'GBP': 'british pound', 'JPY': 'japanese yen',
    'SAR': 'saudi riyal', 'INR': 'indian rupee', 'CAD': 'canadian dollar', 'AUD': 'australian dollar' };
  var PREFIX_ALT = Object.keys(CURRENCY_PREFIX).sort(function (a, b) { return b.length - a.length; }).map(escRe).join('|');
  var SCALE_WORD = { 'thousand': 'thousand', 'million': 'million', 'billion': 'billion', 'trillion': 'trillion',
    'k': 'thousand', 'K': 'thousand', 'm': 'million', 'M': 'million', 'mn': 'million', 'bn': 'billion', 'b': 'billion', 'B': 'billion' };
  function currencyName(unit, plural) {
    if (unit === 'yen' || /yen$/.test(unit)) return unit;
    return plural ? pluralize(unit) : unit;
  }

  var GREEK = { 'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'ε': 'epsilon', 'ζ': 'zeta', 'η': 'eta', 'θ': 'theta',
    'ι': 'iota', 'κ': 'kappa', 'λ': 'lambda', 'μ': 'mu', 'ν': 'nu', 'ξ': 'xi', 'ο': 'omicron', 'π': 'pi', 'ρ': 'rho',
    'σ': 'sigma', 'ς': 'sigma', 'τ': 'tau', 'υ': 'upsilon', 'φ': 'phi', 'χ': 'chi', 'ψ': 'psi', 'ω': 'omega',
    'Α': 'alpha', 'Β': 'beta', 'Γ': 'gamma', 'Δ': 'delta', 'Θ': 'theta', 'Λ': 'lambda', 'Π': 'pi', 'Σ': 'sigma', 'Φ': 'phi', 'Ψ': 'psi', 'Ω': 'omega' };
  var SYMBOLS = { '&': 'and', '#': 'number', '+': 'plus', '=': 'equals', '×': 'times', '~': 'tilde', '@': 'at',
    '§': 'section', '°': 'degrees', '%': 'percent', '½': 'one half', '¼': 'one quarter', '¾': 'three quarters' };
  var ELECTRONIC_SYMBOL = { '/': 'slash', ':': 'colon', '-': 'dash', '_': 'underscore', '~': 'tilde', '@': 'at',
    '?': 'question mark', '=': 'equals', '#': 'hash', '&': 'and', '%': 'percent', '+': 'plus' };
  var UNICODE_FRAC = { '½': [1, 2], '¼': [1, 4], '¾': [3, 4], '⅓': [1, 3], '⅔': [2, 3], '⅛': [1, 8], '⅜': [3, 8], '⅝': [5, 8], '⅞': [7, 8] };
  var CARD_CONTEXT = ['war', 'part', 'chapter', 'volume', 'vol', 'phase', 'type', 'act', 'book', 'section', 'article',
    'class', 'grade', 'level', 'stage', 'series', 'bowl', 'division', 'league', 'category', 'mark', 'mk', 'block', 'unit', 'apollo', 'title'];
  var ABBREV = { 'vs': 'versus', 'etc': 'etcetera', 'dr': 'doctor', 'mr': 'mister', 'jr': 'junior', 'sr': 'senior',
    'st': 'saint', 'ltd': 'limited', 'vol': 'volume' };
  // capitalised words that are read as words, not spelled
  var CAPS_WORDS = ['AND', 'OF', 'THE', 'FOR', 'HAS', 'ARE', 'NOT', 'BUT', 'ALL', 'OUR', 'YOU', 'HIS', 'HER', 'ITS',
    'WAS', 'CAN', 'NEW', 'ONE', 'TWO', 'ZIP', 'WAR', 'MAN', 'BIG', 'TOP', 'RED', 'SEX', 'GOD', 'DAY', 'BAD', 'HOT', 'OLD', 'OUT', 'NOW'];

  var ROMAN_RE = /^(?=[MDCLXVI])M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;
  function romanValue(s) {
    var v = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }, total = 0;
    for (var i = 0; i < s.length; i++) {
      var a = v[s[i]], b = v[s[i + 1]] || 0;
      total += a < b ? -a : a;
    }
    return total;
  }

  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function spellLetters(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) if (/[A-Za-z]/.test(s[i])) out.push(s[i].toLowerCase());
    return out.join(' ');
  }
  function spellWord(w) { return w.split('').join(' '); }

  // ---------- verbalisers ----------
  function verbalizeDate(t) {
    var m, mi;
    // 15 February 1987 / 31 January
    m = new RegExp('^(\\d{1,2}) (' + MONTH_PAT + ')(?:,? (\\d{3,4}))?$').exec(t);
    if (m && (mi = monthIndex(m[2])) >= 0 && +m[1] >= 1 && +m[1] <= 31)
      return 'the ' + ordinalize(cardinal(m[1])) + ' of ' + MONTHS[mi] + (m[3] ? ' ' + yearWords(m[3]) : '');
    // May 20, 2008 / May 20 / May 2008
    m = new RegExp('^(' + MONTH_PAT + ') (\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{3,4}))?$').exec(t);
    if (m && (mi = monthIndex(m[1])) >= 0 && +m[2] >= 1 && +m[2] <= 31)
      return MONTHS[mi] + ' ' + ordinalize(cardinal(m[2])) + (m[3] ? ' ' + yearWords(m[3]) : '');
    m = new RegExp('^(' + MONTH_PAT + '),? (\\d{4})$').exec(t);
    if (m && (mi = monthIndex(m[1])) >= 0) return MONTHS[mi] + ' ' + yearWords(m[2]);
    // ISO 2004-04-04
    m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
    if (m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31)
      return 'the ' + ordinalize(cardinal(m[3])) + ' of ' + MONTHS[+m[2] - 1] + ' ' + yearWords(m[1]);
    // 12/05/2001: month first unless the first field cannot be a month
    m = /^(\d{1,2})[\/.](\d{1,2})[\/.](\d{2}|\d{4})$/.exec(t);
    if (m) {
      var a = +m[1], b = +m[2], yw = m[3].length === 4 ? yearWords(m[3]) : twoDigitYear(m[3]);
      if (a >= 1 && a <= 12 && b >= 1 && b <= 31) return MONTHS[a - 1] + ' ' + ordinalize(cardinal(String(b))) + ' ' + yw;
      if (b >= 1 && b <= 12 && a >= 1 && a <= 31) return 'the ' + ordinalize(cardinal(String(a))) + ' of ' + MONTHS[b - 1] + ' ' + yw;
    }
    // 1990s
    m = /^(\d{3,4})'?s$/.exec(t);
    if (m) return pluralize(yearWords(m[1]));
    // 500 BC
    m = /^(\d{1,4}) ?(BC|AD|BCE|CE|B\.C\.|A\.D\.)$/.exec(t);
    if (m) return yearWords(m[1]) + ' ' + spellLetters(m[2]);
    m = /^(\d{4})$/.exec(t);
    if (m) return yearWords(m[1]);
    return null;
  }

  function verbalizeTime(t) {
    var m = /^(\d{1,2})([:.]) ?(\d{2})(?::(\d{2}))?(?:\s?([AaPp])\.?\s?[Mm]\.?)?(?:\s([A-Z]{2,4}))?$/.exec(t);
    var zone = function (z) { return z ? ' ' + spellLetters(z) : ''; };
    // '.' separates hours and minutes only with am/pm or a zero-padded hour; otherwise 3.02 is a decimal
    if (m && m[2] === '.' && !m[5] && !/^0\d$/.test(m[1])) m = null;
    if (m) {
      m.splice(2, 1);
      var h = +m[1], mm = +m[2];
      if (m[3] !== undefined) {
        return cardinal(String(h)) + (h === 1 ? ' hour ' : ' hours ') + cardinal(String(mm)) + (mm === 1 ? ' minute' : ' minutes') +
          ' and ' + cardinal(m[3]) + (+m[3] === 1 ? ' second' : ' seconds') + zone(m[5]);
      }
      if (h > 24 || mm > 59) return null;
      var ampm = m[4] ? ' ' + m[4].toLowerCase() + ' m' : '';
      var hw = cardinal(String(h));
      if (mm === 0) {
        if (ampm) return hw + ampm + zone(m[5]);
        return (h > 12 ? hw + ' hundred' : hw + " o'clock") + zone(m[5]);
      }
      return hw + ' ' + (mm < 10 ? 'o ' + ONES[mm] : under100(mm)) + ampm + zone(m[5]);
    }
    m = /^(\d{1,2})\s?([AaPp])\.?\s?[Mm]\.?(?:\s([A-Z]{2,4}))?$/.exec(t);
    if (m && +m[1] <= 12) return cardinal(m[1]) + ' ' + m[2].toLowerCase() + ' m' + zone(m[3]);
    // lap times 1:34.52 -> one minute thirty four seconds and fifty two milliseconds
    m = /^(\d{1,2}):(\d{2})\.(\d{1,3})$/.exec(t);
    if (m) return cardinal(m[1]) + (+m[1] === 1 ? ' minute ' : ' minutes ') + cardinal(m[2]) + (+m[2] === 1 ? ' second' : ' seconds') +
      ' and ' + cardinal(m[3]) + (+m[3] === 1 ? ' millisecond' : ' milliseconds');
    return null;
  }

  function verbalizeMoney(t) {
    var m = new RegExp('^(' + PREFIX_ALT + ') ?([-−]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)?(?:\\.\\d+)?)(?: ?(thousand|million|billion|trillion|mn|bn|[kKmMbB])\\b)?$').exec(t);
    var unit, num, scale;
    if (m && /\d/.test(m[2])) { unit = CURRENCY_PREFIX[m[1]]; num = m[2]; scale = m[3]; }
    else {
      m = /^([-−]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?) ?(USD|EUR|GBP|JPY|SAR|INR|CAD|AUD)$/.exec(t);
      if (!m) return null;
      unit = CURRENCY_CODE[m[2]]; num = m[1];
    }
    if (scale) return numberWords(num) + ' ' + SCALE_WORD[scale] + ' ' + currencyName(unit, true);
    var cm = /^([-−]?[\d,]*)\.(\d{2})$/.exec(num);
    if (cm && unit !== 'yen') {
      var whole = cm[1].replace(/,/g, '') || '0', cents = +cm[2];
      var w = cardinal(whole.replace(/^[-−]/, '')), parts = [];
      if (+whole.replace('−', '-') || !cents) parts.push(w + ' ' + currencyName(unit, !isOne(whole)));
      if (cents) parts.push(under100(cents) + (cents === 1 ? ' cent' : ' cents'));
      return parts.join(' and ');
    }
    var nw = numberWords(num);
    if (!nw) return null;
    return nw + ' ' + currencyName(unit, !isOne(num));
  }

  var MEASURE_RE = new RegExp('^([-−]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)?(?:\\.\\d+)?) ?(/)?(' + UNIT_ALT + ')$');
  var PER_UNIT_RE = new RegExp('^(?:per |\\/)(' + UNIT_ALT + ')$');
  function verbalizeMeasure(t) {
    var pm = PER_UNIT_RE.exec(t);
    if (pm) return 'per ' + UNITS[pm[1]][0];
    var m = MEASURE_RE.exec(t);
    if (!m || !/\d/.test(m[1])) return null;
    var nw = numberWords(m[1]);
    if (!nw) return null;
    var u = UNITS[m[3]];
    if (m[2]) return nw + ' per ' + u[1];
    return nw + ' ' + (isOne(m[1]) ? u[0] : u[1]);
  }

  function fractionWords(n, d, mixed) {
    var nn = +n, dd = +d, den;
    if (dd === 1) return cardinal(n) + ' over one';
    if (dd === 2) den = nn === 1 ? 'half' : 'halves';
    else if (dd === 4) den = nn === 1 ? 'quarter' : 'quarters';
    else { den = ordinalize(cardinal(d)); if (nn !== 1) den = den + 's'; }
    if (mixed && nn === 1) return 'a ' + den;
    return cardinal(n) + ' ' + den;
  }
  function verbalizeFraction(t) {
    var m = /^(-?)(\d+)\/(\d+)$/.exec(t);
    if (m) return (m[1] ? 'minus ' : '') + fractionWords(m[2], m[3], false);
    m = /^(\d+) (\d+)\/(\d+)$/.exec(t);
    if (m) return cardinal(m[1]) + ' and ' + fractionWords(m[2], m[3], true);
    m = /^(\d*) ?([½¼¾⅓⅔⅛⅜⅝⅞])$/.exec(t);
    if (m) {
      var f = UNICODE_FRAC[m[2]];
      if (!m[1]) return fractionWords(String(f[0]), String(f[1]), false);
      return cardinal(m[1]) + ' and ' + fractionWords(String(f[0]), String(f[1]), true);
    }
    return null;
  }

  function verbalizeElectronic(t) {
    var s = t.toLowerCase(), out = [], i = 0;
    while (i < s.length) {
      var c = s[i];
      if (/[a-z]/.test(c)) { out.push(c); i++; continue; }
      if (/\d/.test(c)) {
        var j = i; while (j < s.length && /\d/.test(s[j])) j++;
        var run = s.slice(i, j);
        var said = run.length === 4 && +run >= 1000 && +run <= 2099 ? yearWords(run)
          : run.length <= 2 && run[0] !== '0' ? cardinal(run) : digitsO(run);
        out.push(spellWord(said.replace(/ /g, '')));
        i = j; continue;
      }
      if (c === '.') { out.push('dot'); i++; continue; }
      if (own(ELECTRONIC_SYMBOL, c)) out.push(spellWord(ELECTRONIC_SYMBOL[c].replace(/ /g, '')));
      i++;
    }
    return out.join(' ');
  }

  function isPronounceable(w) {
    var s = w.toLowerCase();
    if (!/[aeiouy]/.test(s)) return false;
    if (/[^aeiouy]{3}/.test(s) || /[aeiou]{3}/.test(s)) return false;
    if (!/^[aeiou]?[^aeiouy]?[aeiouy]/.test(s)) return false;
    return s.replace(/[^aeiouy]/g, '').length / s.length >= 0.34;
  }

  // ---------- classifier + verbaliser ----------
  // tok: the token text. ctx: {prev: [earlier tokens, nearest last], next: [later tokens, nearest first]}
  // returns {cls, out}; out is the spoken words ("sil" for silence)
  function normalize(tok, ctx) {
    ctx = ctx || {};
    var prev = ctx.prev || [], next = ctx.next || [];
    var p1 = prev.length ? prev[prev.length - 1] : '', n1 = next.length ? next[0] : '';
    var t = tok.replace(/\s+/g, ' ').trim();
    var r, m;
    if (!t) return { cls: 'PLAIN', out: tok };

    // punctuation
    if (/^[-–—]$/.test(t)) {
      if (/\d$/.test(p1) && /^\d/.test(n1)) return { cls: 'PLAIN', out: 'to' };
      if (t !== '-') return { cls: 'PUNCT', out: tok };
      return { cls: 'VERBATIM', out: 'sil' };
    }
    if (/^[.,;:!?"'()\[\]{}…“”‘’«»\/|*]+$/.test(t)) return { cls: 'PUNCT', out: tok };

    // electronic
    if (/^(https?:\/\/|www\.)\S+$/i.test(t) || /^[\w.+-]+@[\w-]+\.[\w.]+$/.test(t) ||
        /^[A-Za-z0-9][\w-]*(\.[\w-]+)*\.[a-z]{2,6}(\/\S*)?$/.test(t))
      return { cls: 'ELECTRONIC', out: verbalizeElectronic(t) };

    if ((r = verbalizeMoney(t))) return { cls: 'MONEY', out: r };
    if ((r = verbalizeTime(t))) return { cls: 'TIME', out: r };
    if (new RegExp(MONTH_PAT).test(t) && /\d/.test(t) && (r = verbalizeDate(t))) return { cls: 'DATE', out: r };
    if (/^\d{1,4}-\d{2}-\d{2}$/.test(t) || /^\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4}$/.test(t)) {
      if ((r = verbalizeDate(t))) return { cls: 'DATE', out: r };
    }
    if (/^\d{3,4}'?s$/.test(t)) return { cls: 'DATE', out: verbalizeDate(t) };
    // decades: 90s, 80's -> nineties, eighties (not "ninety seconds")
    m = /^([1-9])0'?s$/.exec(t);
    if (m) return { cls: 'DATE', out: pluralize(under100(+m[1] * 10)) };
    if ((r = verbalizeMeasure(t))) return { cls: 'MEASURE', out: r };
    if ((r = verbalizeFraction(t))) return { cls: 'FRACTION', out: r };

    // decimals and scaled numbers
    m = /^([-−]?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?) (thousand|million|billion|trillion)$/.exec(t);
    if (m && /\d/.test(m[1])) return { cls: 'DECIMAL', out: numberWords(m[1]) + ' ' + m[2] };
    if (/^[-−]?(?:\d{1,3}(?:,\d{3})+|\d+)?\.\d+$/.test(t)) return { cls: 'DECIMAL', out: numberWords(t) };

    // ordinals 21st
    m = /^(\d{1,3}(?:,\d{3})+|\d+)(st|nd|rd|th)$/i.exec(t);
    if (m) return { cls: 'ORDINAL', out: ordinalize(cardinal(m[1].replace(/,/g, ''))) };

    // telephone-like digit groups
    if (/^\(?\d+\)?(?:[- ]\(?\d+\)?)+$/.test(t) && t.replace(/\D/g, '').length >= 7) {
      var groups = t.split(/[- ()]+/).filter(function (g) { return g.length; });
      return { cls: 'TELEPHONE', out: groups.map(digitsO).join(' sil ') };
    }

    // dates by shape
    if (/^\d{1,4} ?(BC|AD|BCE|CE|B\.C\.|A\.D\.)$/.test(t)) return { cls: 'DATE', out: verbalizeDate(t) };
    if (/^\d{4}$/.test(t) && +t >= 1000 && +t <= 2099) return { cls: 'DATE', out: yearWords(t) };

    // cardinals
    if (/^0\d+$/.test(t)) return { cls: 'DIGIT', out: digitsO(t) };
    if (/^[-−]?(?:\d{1,3}(?:,\d{3})+|\d+)$/.test(t)) {
      var cw = numberWords(t);
      if (cw) return { cls: 'CARDINAL', out: cw };
    }

    // roman numerals
    if (ROMAN_RE.test(t) && /^[IVXL]+$/.test(t)) {
      var v = romanValue(t), pl = p1.toLowerCase().replace(/\.$/, '');
      if (CARD_CONTEXT.indexOf(pl) >= 0) return { cls: 'CARDINAL', out: cardinal(String(v)) };
      if (t.length >= 2 && /^[A-Z][a-z]+$/.test(p1)) return { cls: 'ORDINAL', out: 'the ' + ordinalize(cardinal(String(v))) };
      if (t.length >= 2) return { cls: 'CARDINAL', out: cardinal(String(v)) };
    }

    // symbols
    if (own(SYMBOLS, t)) return { cls: 'VERBATIM', out: SYMBOLS[t] };
    if (own(GREEK, t)) return { cls: 'VERBATIM', out: GREEK[t] };
    if (Array.from(t).length === 1 && /[^\x00-\x7F]/.test(t) && !/[À-ɏ]/.test(t)) return { cls: 'VERBATIM', out: 'sil' };

    if (own(ABBREV, t.toLowerCase())) return { cls: 'PLAIN', out: ABBREV[t.toLowerCase()] };
    // letters: U.S.  T. H.  BBC  NGOs  pp
    if (/^(?:[A-Za-z]\. ?)+[A-Za-z]?\.?$/.test(t) && /\./.test(t) && t.replace(/[^A-Za-z]/g, '').length <= 6)
      return { cls: 'LETTERS', out: spellLetters(t) };
    if (/^[A-Z]-$/.test(t)) return { cls: 'LETTERS', out: spellLetters(t) };
    m = /^([A-Z]{2,6})(s|'s)?-?$/.exec(t);
    if (m && CAPS_WORDS.indexOf(m[1]) < 0 && !(m[1].length >= 4 && isPronounceable(m[1]))) {
      return { cls: 'LETTERS', out: spellLetters(m[1]) + (m[2] ? "'s" : '') };
    }
    if (/^[A-Za-z]{2,4}$/.test(t) && !/[aeiouyAEIOUY]/.test(t)) return { cls: 'LETTERS', out: spellLetters(t) };

    return { cls: 'PLAIN', out: tok };
  }

  // ---------- free-text tokeniser (page only) ----------
  var NUM = '(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?';
  var TOKEN_PATTERNS = [
    '(?:https?:\\/\\/|www\\.)\\S+[^\\s.,;:!?)]',
    '[\\w.+-]+@[\\w-]+\\.[A-Za-z.]+[A-Za-z]',
    '\\d{1,2} ' + MONTH_PAT + '(?:,? \\d{4})?(?![\\w])',
    MONTH_PAT + ' \\d{1,2}(?:st|nd|rd|th)?(?:,? \\d{4})?(?![\\w])',
    MONTH_PAT + ',? \\d{4}(?![\\w])',
    '\\d{4}-\\d{2}-\\d{2}',
    '\\d{1,2}[\\/.]\\d{1,2}[\\/.]\\d{2,4}(?![\\w])',
    '\\d{1,2}:\\d{2}(?::\\d{2})?(?: ?[AaPp]\\.?[Mm]\\.?)?',
    '\\d{1,2} ?[AaPp]\\.?[Mm]\\.?(?![A-Za-z])',
    '(?:' + PREFIX_ALT + ') ?' + NUM + '(?: ?(?:thousand|million|billion|trillion|mn|bn|[kKmMbB])(?![A-Za-z]))?',
    NUM + ' ?(?:USD|EUR|GBP|JPY|SAR|INR|CAD|AUD)(?![A-Za-z])',
    // "in" after a space is nearly always the word, not inches ("10 in the box"), so it must touch the number
    '[-−]?' + NUM + '(?: ?\\/?(?:' + UNIT_KEYS.filter(function (k) { return k !== 'in'; }).map(escRe).join('|') + ')|\\/?in)(?![A-Za-z0-9])',
    '\\d+ \\d+\\/\\d+',
    '\\d*[½¼¾⅓⅔⅛⅜⅝⅞]',
    '\\d+\\/\\d+',
    NUM + ' (?:thousand|million|billion|trillion)(?![A-Za-z])',
    '\\(?\\d{3}\\)?[- ]\\d{3}-\\d{4}',
    '\\d{3}-\\d{4}(?![\\w-])',
    '\\d+(?:-\\d+){2,}',
    '\\d{1,4} ?(?:BC|AD|BCE|CE)(?![A-Za-z])',
    '(?:\\d{3,4}|[1-9]0)\'?s(?![A-Za-z])',
    '\\d+(?:st|nd|rd|th)(?![A-Za-z])',
    '(?:[A-Za-z]\\.){2,}',
    '[A-Za-z0-9][\\w-]*(?:\\.[\\w-]+)*\\.(?:com|org|net|edu|gov|ca|uk|io)(?:\\/\\S*[^\\s.,;:!?)])?(?![A-Za-z])',
    '[-−]?' + NUM,
    '[A-Za-zÀ-ɏ]+(?:[\'’][A-Za-z]+)*',
    '[\\uD800-\\uDBFF][\\uDC00-\\uDFFF]', // a whole emoji or other astral character, not half of one
    '\\S'
  ];
  var TOKEN_RE = new RegExp(TOKEN_PATTERNS.map(function (p) { return '(?:' + p + ')'; }).join('|'), 'g');

  function tokenize(text) {
    var toks = [], m;
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(text))) {
      if (!m[0].length) { TOKEN_RE.lastIndex++; continue; }
      if (/^\s+$/.test(m[0])) continue;
      // a hyphen straight after a letter, digit or closing bracket joins two things (10-20, COVID-19),
      // so it is a token of its own, not a minus sign on the number that follows
      if (/^[-−]\d/.test(m[0]) && m.index > 0 && /[A-Za-z0-9À-ɏ)\]%]/.test(text[m.index - 1])) {
        toks.push({ text: m[0][0], start: m.index, end: m.index + 1 });
        TOKEN_RE.lastIndex = m.index + 1;
        continue;
      }
      toks.push({ text: m[0], start: m.index, end: m.index + m[0].length });
    }
    return toks;
  }

  // ---------- systems ----------
  function contextFor(tokens, i, k) {
    k = k || 3;
    return { prev: tokens.slice(Math.max(0, i - k), i), next: tokens.slice(i + 1, i + 1 + k) };
  }
  function runRules(tokens) {
    return tokens.map(function (t, i) { return normalize(t, contextFor(tokens, i)); });
  }
  function runCopy(tokens) { return tokens.slice(); }
  // table: {input: output} holding only entries whose usual reading differs from the input
  function runLookup(tokens, table) {
    return tokens.map(function (t) {
      return Object.prototype.hasOwnProperty.call(table, t) ? table[t] : t;
    });
  }

  // ---------- metrics ----------
  function canon(s) { return String(s).replace(/\s+/g, ' ').trim().toLowerCase(); }
  function exactMatch(pred, ref) { return canon(pred) === canon(ref); }
  // Keras-style per-slot accuracy: both word sequences are pre-padded (pad_sequences' default)
  // to `slots`, then every slot that agrees counts, including slots where both are padding.
  function slotScores(pred, ref, slots, countPadding) {
    slots = slots || 20;
    var P = canon(pred).split(' ').filter(Boolean).slice(-slots);
    var R = canon(ref).split(' ').filter(Boolean).slice(-slots);
    while (P.length < slots) P.unshift(null);
    while (R.length < slots) R.unshift(null);
    var correct = 0, total = 0;
    for (var i = 0; i < slots; i++) {
      var pad = P[i] === null && R[i] === null;
      if (pad && !countPadding) continue;
      total++;
      if (P[i] === R[i]) correct++;
    }
    return { correct: correct, total: total };
  }
  // pairs: [[pred, ref], ...]
  function accuracy(pairs, opts) {
    opts = opts || {};
    if (!opts.padding) {
      var c = 0;
      pairs.forEach(function (p) { if (exactMatch(p[0], p[1])) c++; });
      return pairs.length ? c / pairs.length : 0;
    }
    var cc = 0, tt = 0;
    pairs.forEach(function (p) { var s = slotScores(p[0], p[1], opts.slots || 20, true); cc += s.correct; tt += s.total; });
    return tt ? cc / tt : 0;
  }

  // ---------- error typing ----------
  var NUMBER_WORDS = {};
  ONES.concat(TENS.filter(Boolean), ['hundred', 'thousand', 'million', 'billion', 'trillion', 'o', 'point', 'minus'])
    .forEach(function (w) { NUMBER_WORDS[w] = 1; NUMBER_WORDS[ordinalWord(w)] = 1; NUMBER_WORDS[pluralWord(w)] = 1; });
  // unit and currency words; single letters and words with another common sense
  // ("c" from "c c", "second" the ordinal) are left out
  var UNIT_WORDS = {};
  var NOT_UNITS = { c: 1, second: 1, per: 1, square: 1 };
  Object.keys(UNITS).forEach(function (k) { UNITS[k].forEach(function (p) { p.split(' ').forEach(function (w) { if (!own(NOT_UNITS, w)) UNIT_WORDS[w] = 1; }); }); });
  ['dollar', 'dollars', 'pound', 'pounds', 'euro', 'euros', 'yen', 'rupee', 'rupees', 'cent', 'cents', 'riyal', 'riyals']
    .forEach(function (w) { UNIT_WORDS[w] = 1; });
  var MONTH_WORDS = {};
  MONTHS.forEach(function (w) { MONTH_WORDS[w] = 1; });
  function wordsIn(words, set) { return words.filter(function (w) { return own(set, w); }).join(' '); }
  // unit words only count once a number word has been said ("nine hundred pounds", not "pound sign")
  function unitsIn(words) {
    var num = false, out = [];
    words.forEach(function (w) {
      if (own(NUMBER_WORDS, w)) num = true;
      else if (num && own(UNIT_WORDS, w)) out.push(w);
    });
    return out.join(' ');
  }
  function count(words, phrase) { // occurrences of a word sequence
    var n = 0;
    for (var i = 0; i + phrase.length <= words.length; i++) {
      var ok = true;
      for (var j = 0; j < phrase.length && ok; j++) ok = words[i + j] === phrase[j];
      if (ok) n++;
    }
    return n;
  }
  // a stutter: a phrase of one to three words said twice in a row, where the reference says it
  // but never twice in a row ("eleven minutes eleven minutes"; not "one nine nine five" for a date)
  // a doubled digit word is no stutter when the input has that digit doubled ("115" -> "one one five")
  var DIGIT_OF = { o: '0', zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' };
  function hasStutter(P, R, input) {
    for (var n = 1; n <= 3; n++) {
      for (var i = 0; i + 2 * n <= P.length; i++) {
        var a = P.slice(i, i + n), same = true;
        for (var k = 0; k < n && same; k++) same = P[i + n + k] === a[k];
        if (n === 1 && same && own(DIGIT_OF, a[0]) && String(input || '').indexOf(DIGIT_OF[a[0]] + DIGIT_OF[a[0]]) >= 0) continue;
        if (same && count(R, a) > 0 && count(R, a.concat(a)) === 0) return true;
      }
    }
    return false;
  }
  var SPELLED = { ELECTRONIC: 1, LETTERS: 1 };
  function spelledRef(R) { // fallback when the class is not known: two or more single letters
    return R.length >= 2 && R.every(function (w) { return /^[a-z]$/.test(w) || w === 'dot'; });
  }

  var ERROR_TYPES = ['unread', 'spelling', 'repeat', 'unit', 'month', 'number', 'other'];
  var ERROR_LABELS = { unread: 'left unread', spelling: 'wrong spelling-out', repeat: 'repeated phrase', unit: 'unit wrong or missing',
    month: 'month wrong or missing', number: 'wrong number', other: 'other' };
  // returns null when correct. cls (optional) is the reference class.
  // First match wins: unread, spelling (web addresses and letter strings), repeat, unit, month, number, other.
  function errorType(pred, ref, input, cls) {
    if (exactMatch(pred, ref)) return null;
    var P = canon(pred).split(' ').filter(Boolean), R = canon(ref).split(' ').filter(Boolean);
    if (input !== undefined && input !== null && canon(pred) === canon(input)) return 'unread';
    if (P.join('') === R.join('')) return 'other'; // same letters, different word breaks ("kilovolts", "kilo volts")
    if (cls ? own(SPELLED, cls) : spelledRef(R)) return 'spelling';
    if (hasStutter(P, R, input)) return 'repeat';
    var ru = unitsIn(R);
    if (ru && unitsIn(P) !== ru) return 'unit';
    if (wordsIn(P, MONTH_WORDS) !== wordsIn(R, MONTH_WORDS) && wordsIn(R, MONTH_WORDS)) return 'month';
    if (wordsIn(P, NUMBER_WORDS) !== wordsIn(R, NUMBER_WORDS) && wordsIn(R, NUMBER_WORDS)) return 'number';
    return 'other';
  }

  var api = {
    cardinal: cardinal, ordinalize: ordinalize, yearWords: yearWords, numberWords: numberWords, digitsO: digitsO,
    normalize: normalize, tokenize: tokenize, contextFor: contextFor,
    runRules: runRules, runCopy: runCopy, runLookup: runLookup,
    canon: canon, exactMatch: exactMatch, slotScores: slotScores, accuracy: accuracy,
    errorType: errorType, ERROR_TYPES: ERROR_TYPES, ERROR_LABELS: ERROR_LABELS,
    CLASSES: ['PLAIN', 'PUNCT', 'DATE', 'LETTERS', 'CARDINAL', 'VERBATIM', 'MEASURE', 'ORDINAL', 'DECIMAL', 'MONEY',
      'ELECTRONIC', 'DIGIT', 'TELEPHONE', 'TIME', 'FRACTION', 'ADDRESS']
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Rote = api;
})(typeof window !== 'undefined' ? window : this);
