"""Hand-written rules: the Python twin of normalize() in ../model.js.

Every regex and table mirrors the JavaScript, so the evaluation (Python) and the
page (JavaScript) run the same system. tests/test_rules_agree.js checks that the
two give identical output on a fixed suite and on the demo sentences.
"""
import re

A = re.ASCII  # JavaScript's \d \w \s are ASCII-only

ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
        'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
SCALES = ['', 'thousand', 'million', 'billion', 'trillion', 'quadrillion']
DIGIT_O = ['o', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']


def under100(n):
    if n < 20:
        return ONES[n]
    return TENS[n // 10] + (' ' + ONES[n % 10] if n % 10 else '')


def under1000(n):
    h, r = n // 100, n % 100
    parts = []
    if h:
        parts.append(ONES[h] + ' hundred')
    if r:
        parts.append(under100(r))
    return ' '.join(parts)


def cardinal(digits):
    digits = re.sub(r'^0+(?=\d)', '', str(digits), flags=A)
    if not re.match(r'^\d+$', digits, A):
        return None
    if re.match(r'^0+$', digits):
        return 'zero'
    if len(digits) > 18:
        return None
    groups = []
    i = len(digits)
    while i > 0:
        groups.insert(0, int(digits[max(0, i - 3):i]))
        i -= 3
    words = []
    for g, v in enumerate(groups):
        scale = SCALES[len(groups) - 1 - g]
        if v:
            words.append(under1000(v) + (' ' + scale if scale else ''))
    return ' '.join(words)


def digits_o(s):
    return ' '.join(DIGIT_O[int(c)] for c in s if '0' <= c <= '9')


ORD_IRREG = {'one': 'first', 'two': 'second', 'three': 'third', 'five': 'fifth', 'eight': 'eighth', 'nine': 'ninth', 'twelve': 'twelfth'}


def ordinal_word(w):
    if w in ORD_IRREG:
        return ORD_IRREG[w]
    if w.endswith('y'):
        return w[:-1] + 'ieth'
    return w + 'th'


def ordinalize(words):
    p = words.split(' ')
    p[-1] = ordinal_word(p[-1])
    return ' '.join(p)


def plural_word(w):
    if w.endswith('y'):
        return w[:-1] + 'ies'
    if w.endswith('x') or w.endswith('s'):
        return w + 'es'
    return w + 's'


def pluralize(words):
    p = words.split(' ')
    p[-1] = plural_word(p[-1])
    return ' '.join(p)


def year_words(s):
    try:
        y = int(s)
    except ValueError:
        return None
    if y < 100:
        return cardinal(str(y))
    if 2000 <= y < 2010:
        return cardinal(str(y))
    if y % 1000 == 0:
        return cardinal(str(y))
    hi, lo = y // 100, y % 100
    if lo == 0:
        return under100(hi) + ' hundred'
    if y < 1000 and hi < 10:
        return ONES[hi] + ' ' + ('o ' + ONES[lo] if lo < 10 else under100(lo))
    return under100(hi) + ' ' + ('o ' + ONES[lo] if lo < 10 else under100(lo))


def two_digit_year(s):
    v = int(s)
    if len(s) == 2 and s[0] == '0':
        return 'o ' + ONES[v]
    return under100(v)


NUM_RE = re.compile(r'^([-−]?)(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d+))?$', A)


def decimal_fraction(frac):
    return 'zero' if frac == '0' else digits_o(frac)


def number_words(s):
    m = NUM_RE.match(s)
    if not m or (not m.group(2) and m.group(3) is None):
        return None
    parts = []
    if m.group(1):
        parts.append('minus')
    if m.group(2):
        cw = cardinal(m.group(2).replace(',', ''))
        if cw is None:
            return None
        parts.append(cw)
    if m.group(3) is not None:
        parts += ['point', decimal_fraction(m.group(3))]
    return ' '.join(parts)


def is_one(s):
    return bool(re.match(r'^[-−]?0*1$', s.replace(',', ''), A))


MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
MONTH_ABBR = {'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'jun': 5, 'jul': 6, 'aug': 7, 'sep': 8, 'sept': 8, 'oct': 9, 'nov': 10, 'dec': 11}


def month_index(w):
    k = re.sub(r'\.$', '', w.lower())
    if k in MONTHS:
        return MONTHS.index(k)
    return MONTH_ABBR.get(k, -1)


MONTH_PAT = r'(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?'

UNITS = {
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
    'degrees C': ['degree celsius', 'degrees celsius'],
}


def _js_sort_key_units(a):
    return (-len(a), a)


UNIT_KEYS = sorted(UNITS.keys(), key=_js_sort_key_units)
UNIT_ALT = '|'.join(re.escape(k) for k in UNIT_KEYS)

CURRENCY_PREFIX = {'$': 'dollar', 'US$': 'dollar', 'A$': 'dollar', 'C$': 'dollar', 'NZ$': 'dollar', 'HK$': 'dollar',
                   'S$': 'dollar', '£': 'pound', '€': 'euro', '¥': 'yen', '₹': 'rupee', 'Rs': 'rupee', 'Rs.': 'rupee'}
CURRENCY_CODE = {'USD': 'united states dollar', 'EUR': 'euro', 'GBP': 'british pound', 'JPY': 'japanese yen',
                 'SAR': 'saudi riyal', 'INR': 'indian rupee', 'CAD': 'canadian dollar', 'AUD': 'australian dollar'}
PREFIX_ALT = '|'.join(re.escape(k) for k in sorted(CURRENCY_PREFIX.keys(), key=lambda k: -len(k)))
SCALE_WORD = {'thousand': 'thousand', 'million': 'million', 'billion': 'billion', 'trillion': 'trillion',
              'k': 'thousand', 'K': 'thousand', 'm': 'million', 'M': 'million', 'mn': 'million', 'bn': 'billion', 'b': 'billion', 'B': 'billion'}


def currency_name(unit, plural):
    if unit == 'yen' or unit.endswith('yen'):
        return unit
    return pluralize(unit) if plural else unit


GREEK = {'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'ε': 'epsilon', 'ζ': 'zeta', 'η': 'eta', 'θ': 'theta',
         'ι': 'iota', 'κ': 'kappa', 'λ': 'lambda', 'μ': 'mu', 'ν': 'nu', 'ξ': 'xi', 'ο': 'omicron', 'π': 'pi', 'ρ': 'rho',
         'σ': 'sigma', 'ς': 'sigma', 'τ': 'tau', 'υ': 'upsilon', 'φ': 'phi', 'χ': 'chi', 'ψ': 'psi', 'ω': 'omega',
         'Α': 'alpha', 'Β': 'beta', 'Γ': 'gamma', 'Δ': 'delta', 'Θ': 'theta', 'Λ': 'lambda', 'Π': 'pi', 'Σ': 'sigma', 'Φ': 'phi', 'Ψ': 'psi', 'Ω': 'omega'}
SYMBOLS = {'&': 'and', '#': 'number', '+': 'plus', '=': 'equals', '×': 'times', '~': 'tilde', '@': 'at',
           '§': 'section', '°': 'degrees', '%': 'percent', '½': 'one half', '¼': 'one quarter', '¾': 'three quarters'}
ELECTRONIC_SYMBOL = {'/': 'slash', ':': 'colon', '-': 'dash', '_': 'underscore', '~': 'tilde', '@': 'at',
                     '?': 'question mark', '=': 'equals', '#': 'hash', '&': 'and', '%': 'percent', '+': 'plus'}
UNICODE_FRAC = {'½': (1, 2), '¼': (1, 4), '¾': (3, 4), '⅓': (1, 3), '⅔': (2, 3), '⅛': (1, 8), '⅜': (3, 8), '⅝': (5, 8), '⅞': (7, 8)}
CARD_CONTEXT = ['war', 'part', 'chapter', 'volume', 'vol', 'phase', 'type', 'act', 'book', 'section', 'article',
                'class', 'grade', 'level', 'stage', 'series', 'bowl', 'division', 'league', 'category', 'mark', 'mk', 'block', 'unit', 'apollo', 'title']
ABBREV = {'vs': 'versus', 'etc': 'etcetera', 'dr': 'doctor', 'mr': 'mister', 'jr': 'junior', 'sr': 'senior',
          'st': 'saint', 'ltd': 'limited', 'vol': 'volume'}
CAPS_WORDS = ['AND', 'OF', 'THE', 'FOR', 'HAS', 'ARE', 'NOT', 'BUT', 'ALL', 'OUR', 'YOU', 'HIS', 'HER', 'ITS',
              'WAS', 'CAN', 'NEW', 'ONE', 'TWO', 'ZIP', 'WAR', 'MAN', 'BIG', 'TOP', 'RED', 'SEX', 'GOD', 'DAY', 'BAD', 'HOT', 'OLD', 'OUT', 'NOW']

ROMAN_RE = re.compile(r'^(?=[MDCLXVI])M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$')


def roman_value(s):
    v = {'I': 1, 'V': 5, 'X': 10, 'L': 50, 'C': 100, 'D': 500, 'M': 1000}
    total = 0
    for i, ch in enumerate(s):
        a = v[ch]
        b = v[s[i + 1]] if i + 1 < len(s) else 0
        total += -a if a < b else a
    return total


def spell_letters(s):
    return ' '.join(c.lower() for c in s if ('A' <= c <= 'Z') or ('a' <= c <= 'z'))


def spell_word(w):
    return ' '.join(list(w))


def _date_ok(d):
    return 1 <= d <= 31


def verbalize_date(t):
    m = re.match(r'^(\d{1,2}) (' + MONTH_PAT + r')(?:,? (\d{3,4}))?$', t, A)
    if m:
        mi = month_index(m.group(2))
        if mi >= 0 and _date_ok(int(m.group(1))):
            return 'the ' + ordinalize(cardinal(m.group(1))) + ' of ' + MONTHS[mi] + (' ' + year_words(m.group(3)) if m.group(3) else '')
    m = re.match(r'^(' + MONTH_PAT + r') (\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{3,4}))?$', t, A)
    if m:
        mi = month_index(m.group(1))
        if mi >= 0 and _date_ok(int(m.group(2))):
            return MONTHS[mi] + ' ' + ordinalize(cardinal(m.group(2))) + (' ' + year_words(m.group(3)) if m.group(3) else '')
    m = re.match(r'^(' + MONTH_PAT + r'),? (\d{4})$', t, A)
    if m:
        mi = month_index(m.group(1))
        if mi >= 0:
            return MONTHS[mi] + ' ' + year_words(m.group(2))
    m = re.match(r'^(\d{4})-(\d{2})-(\d{2})$', t, A)
    if m and 1 <= int(m.group(2)) <= 12 and _date_ok(int(m.group(3))):
        return 'the ' + ordinalize(cardinal(m.group(3))) + ' of ' + MONTHS[int(m.group(2)) - 1] + ' ' + year_words(m.group(1))
    m = re.match(r'^(\d{1,2})[/.](\d{1,2})[/.](\d{2}|\d{4})$', t, A)
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        yw = year_words(m.group(3)) if len(m.group(3)) == 4 else two_digit_year(m.group(3))
        if 1 <= a <= 12 and 1 <= b <= 31:
            return MONTHS[a - 1] + ' ' + ordinalize(cardinal(str(b))) + ' ' + yw
        if 1 <= b <= 12 and 1 <= a <= 31:
            return 'the ' + ordinalize(cardinal(str(a))) + ' of ' + MONTHS[b - 1] + ' ' + yw
    m = re.match(r"^(\d{3,4})'?s$", t, A)
    if m:
        return pluralize(year_words(m.group(1)))
    m = re.match(r'^(\d{1,4}) ?(BC|AD|BCE|CE|B\.C\.|A\.D\.)$', t, A)
    if m:
        return year_words(m.group(1)) + ' ' + spell_letters(m.group(2))
    m = re.match(r'^(\d{4})$', t, A)
    if m:
        return year_words(m.group(1))
    return None


def _zone(z):
    return ' ' + spell_letters(z) if z else ''


class _Groups:
    def __init__(self, g):
        self.g = g

    def group(self, i):
        return self.g[i]


def verbalize_time(t):
    m = re.match(r'^(\d{1,2})([:.]) ?(\d{2})(?::(\d{2}))?(?:\s?([AaPp])\.?\s?[Mm]\.?)?(?:\s([A-Z]{2,4}))?$', t, A)
    # '.' separates hours and minutes only with am/pm or a zero-padded hour; otherwise 3.02 is a decimal
    if m and m.group(2) == '.' and not m.group(5) and not re.match(r'^0\d$', m.group(1), A):
        m = None
    if m:
        m = _Groups([m.group(0), m.group(1)] + [m.group(i) for i in range(3, 7)])
        h, mm = int(m.group(1)), int(m.group(2))
        if m.group(3) is not None:
            return (cardinal(str(h)) + (' hour ' if h == 1 else ' hours ') + cardinal(str(mm)) + (' minute' if mm == 1 else ' minutes')
                    + ' and ' + cardinal(m.group(3)) + (' second' if int(m.group(3)) == 1 else ' seconds') + _zone(m.group(5)))
        if h > 24 or mm > 59:
            return None
        ampm = ' ' + m.group(4).lower() + ' m' if m.group(4) else ''
        hw = cardinal(str(h))
        if mm == 0:
            if ampm:
                return hw + ampm + _zone(m.group(5))
            return (hw + ' hundred' if h > 12 else hw + " o'clock") + _zone(m.group(5))
        return hw + ' ' + ('o ' + ONES[mm] if mm < 10 else under100(mm)) + ampm + _zone(m.group(5))
    m = re.match(r'^(\d{1,2})\s?([AaPp])\.?\s?[Mm]\.?(?:\s([A-Z]{2,4}))?$', t, A)
    if m and int(m.group(1)) <= 12:
        return cardinal(m.group(1)) + ' ' + m.group(2).lower() + ' m' + _zone(m.group(3))
    m = re.match(r'^(\d{1,2}):(\d{2})\.(\d{1,3})$', t, A)
    if m:
        return (cardinal(m.group(1)) + (' minute ' if int(m.group(1)) == 1 else ' minutes ') + cardinal(m.group(2))
                + (' second' if int(m.group(2)) == 1 else ' seconds') + ' and ' + cardinal(m.group(3))
                + (' millisecond' if int(m.group(3)) == 1 else ' milliseconds'))
    return None


MONEY_PREFIX_RE = re.compile(r'^(' + PREFIX_ALT + r') ?([-−]?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?)(?: ?(thousand|million|billion|trillion|mn|bn|[kKmMbB])\b)?$', A)
MONEY_CODE_RE = re.compile(r'^([-−]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?) ?(USD|EUR|GBP|JPY|SAR|INR|CAD|AUD)$', A)


def verbalize_money(t):
    m = MONEY_PREFIX_RE.match(t)
    scale = None
    if m and re.search(r'\d', m.group(2), A):
        unit, num, scale = CURRENCY_PREFIX[m.group(1)], m.group(2), m.group(3)
    else:
        m = MONEY_CODE_RE.match(t)
        if not m:
            return None
        unit, num = CURRENCY_CODE[m.group(2)], m.group(1)
    if scale:
        return number_words(num) + ' ' + SCALE_WORD[scale] + ' ' + currency_name(unit, True)
    cm = re.match(r'^([-−]?[\d,]*)\.(\d{2})$', num, A)
    if cm and unit != 'yen':
        whole = cm.group(1).replace(',', '') or '0'
        cents = int(cm.group(2))
        w = cardinal(re.sub(r'^[-−]', '', whole))
        parts = []
        if _int_or_zero(whole) or not cents:
            parts.append(w + ' ' + currency_name(unit, not is_one(whole)))
        if cents:
            parts.append(under100(cents) + (' cent' if cents == 1 else ' cents'))
        return ' and '.join(parts)
    nw = number_words(num)
    if not nw:
        return None
    return nw + ' ' + currency_name(unit, not is_one(num))


def _int_or_zero(s):
    # JavaScript's +"-0" etc.; whole is digits with an optional sign here
    try:
        return int(s.replace('−', '-'))
    except ValueError:
        return 0


MEASURE_RE = re.compile(r'^([-−]?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?) ?(/)?(' + UNIT_ALT + r')$', A)


PER_UNIT_RE = re.compile(r'^(?:per |/)(' + UNIT_ALT + r')$', A)


def verbalize_measure(t):
    pm = PER_UNIT_RE.match(t)
    if pm:
        return 'per ' + UNITS[pm.group(1)][0]
    m = MEASURE_RE.match(t)
    if not m or not re.search(r'\d', m.group(1), A):
        return None
    nw = number_words(m.group(1))
    if not nw:
        return None
    u = UNITS[m.group(3)]
    if m.group(2):
        return nw + ' per ' + u[1]
    return nw + ' ' + (u[0] if is_one(m.group(1)) else u[1])


def fraction_words(n, d, mixed):
    nn, dd = int(n), int(d)
    if dd == 1:
        return cardinal(n) + ' over one'
    if dd == 2:
        den = 'half' if nn == 1 else 'halves'
    elif dd == 4:
        den = 'quarter' if nn == 1 else 'quarters'
    else:
        den = ordinalize(cardinal(d))
        if nn != 1:
            den = den + 's'
    if mixed and nn == 1:
        return 'a ' + den
    return cardinal(n) + ' ' + den


def verbalize_fraction(t):
    m = re.match(r'^(-?)(\d+)/(\d+)$', t, A)
    if m:
        return ('minus ' if m.group(1) else '') + fraction_words(m.group(2), m.group(3), False)
    m = re.match(r'^(\d+) (\d+)/(\d+)$', t, A)
    if m:
        return cardinal(m.group(1)) + ' and ' + fraction_words(m.group(2), m.group(3), True)
    m = re.match(r'^(\d*) ?([½¼¾⅓⅔⅛⅜⅝⅞])$', t, A)
    if m:
        f = UNICODE_FRAC[m.group(2)]
        if not m.group(1):
            return fraction_words(str(f[0]), str(f[1]), False)
        return cardinal(m.group(1)) + ' and ' + fraction_words(str(f[0]), str(f[1]), True)
    return None


def verbalize_electronic(t):
    s = t.lower()
    out = []
    i = 0
    while i < len(s):
        c = s[i]
        if 'a' <= c <= 'z':
            out.append(c)
            i += 1
            continue
        if '0' <= c <= '9':
            j = i
            while j < len(s) and '0' <= s[j] <= '9':
                j += 1
            run = s[i:j]
            if len(run) == 4 and 1000 <= int(run) <= 2099:
                said = year_words(run)
            elif len(run) <= 2 and run[0] != '0':
                said = cardinal(run)
            else:
                said = digits_o(run)
            out.append(spell_word(said.replace(' ', '')))
            i = j
            continue
        if c == '.':
            out.append('dot')
            i += 1
            continue
        if c in ELECTRONIC_SYMBOL:
            out.append(spell_word(ELECTRONIC_SYMBOL[c].replace(' ', '')))
        i += 1
    return ' '.join(out)


def is_pronounceable(w):
    s = w.lower()
    if not re.search(r'[aeiouy]', s):
        return False
    if re.search(r'[^aeiouy]{3}', s) or re.search(r'[aeiou]{3}', s):
        return False
    if not re.match(r'^[aeiou]?[^aeiouy]?[aeiouy]', s):
        return False
    return len(re.sub(r'[^aeiouy]', '', s)) / len(s) >= 0.34


ELECTRONIC_RES = [
    re.compile(r'^(https?://|www\.)\S+$', re.I | A),
    re.compile(r'^[\w.+-]+@[\w-]+\.[\w.]+$', A),
    re.compile(r'^[A-Za-z0-9][\w-]*(\.[\w-]+)*\.[a-z]{2,6}(/\S*)?$', A),
]


def normalize(tok, prev=(), nxt=()):
    """Return (cls, out) for one token given up to 3 tokens of context either side."""
    p1 = prev[-1] if prev else ''
    n1 = nxt[0] if nxt else ''
    t = re.sub(r'\s+', ' ', tok).strip()
    if not t:
        return 'PLAIN', tok
    if re.match(r'^[-–—]$', t):
        if re.search(r'\d$', p1, A) and re.match(r'^\d', n1, A):
            return 'PLAIN', 'to'
        if t != '-':
            return 'PUNCT', tok
        return 'VERBATIM', 'sil'
    if re.match(r'^[.,;:!?"\'()\[\]{}…“”‘’«»/|*]+$', t):
        return 'PUNCT', tok
    if any(r.match(t) for r in ELECTRONIC_RES):
        return 'ELECTRONIC', verbalize_electronic(t)
    r = verbalize_money(t)
    if r:
        return 'MONEY', r
    r = verbalize_time(t)
    if r:
        return 'TIME', r
    if re.search(MONTH_PAT, t) and re.search(r'\d', t, A):
        r = verbalize_date(t)
        if r:
            return 'DATE', r
    if re.match(r'^\d{1,4}-\d{2}-\d{2}$', t, A) or re.match(r'^\d{1,2}[/.]\d{1,2}[/.]\d{2,4}$', t, A):
        r = verbalize_date(t)
        if r:
            return 'DATE', r
    if re.match(r"^\d{3,4}'?s$", t, A):
        return 'DATE', verbalize_date(t)
    m = re.match(r"^([1-9])0'?s$", t, A)
    if m:
        return 'DATE', pluralize(under100(int(m.group(1)) * 10))
    r = verbalize_measure(t)
    if r:
        return 'MEASURE', r
    r = verbalize_fraction(t)
    if r:
        return 'FRACTION', r
    m = re.match(r'^([-−]?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?) (thousand|million|billion|trillion)$', t, A)
    if m and re.search(r'\d', m.group(1), A):
        return 'DECIMAL', number_words(m.group(1)) + ' ' + m.group(2)
    if re.match(r'^[-−]?(?:\d{1,3}(?:,\d{3})+|\d+)?\.\d+$', t, A):
        return 'DECIMAL', number_words(t)
    m = re.match(r'^(\d{1,3}(?:,\d{3})+|\d+)(st|nd|rd|th)$', t, re.I | A)
    if m:
        return 'ORDINAL', ordinalize(cardinal(m.group(1).replace(',', '')))
    if re.match(r'^\(?\d+\)?(?:[- ]\(?\d+\)?)+$', t, A) and len(re.sub(r'\D', '', t, flags=A)) >= 7:
        groups = [g for g in re.split(r'[- ()]+', t) if g]
        return 'TELEPHONE', ' sil '.join(digits_o(g) for g in groups)
    if re.match(r'^\d{1,4} ?(BC|AD|BCE|CE|B\.C\.|A\.D\.)$', t, A):
        return 'DATE', verbalize_date(t)
    if re.match(r'^\d{4}$', t, A) and 1000 <= int(t) <= 2099:
        return 'DATE', year_words(t)
    if re.match(r'^0\d+$', t, A):
        return 'DIGIT', digits_o(t)
    if re.match(r'^[-−]?(?:\d{1,3}(?:,\d{3})+|\d+)$', t, A):
        cw = number_words(t)
        if cw:
            return 'CARDINAL', cw
    if ROMAN_RE.match(t) and re.match(r'^[IVXL]+$', t):
        v = roman_value(t)
        pl = re.sub(r'\.$', '', p1.lower())
        if pl in CARD_CONTEXT:
            return 'CARDINAL', cardinal(str(v))
        if len(t) >= 2 and re.match(r'^[A-Z][a-z]+$', p1, A):
            return 'ORDINAL', 'the ' + ordinalize(cardinal(str(v)))
        if len(t) >= 2:
            return 'CARDINAL', cardinal(str(v))
    if t in SYMBOLS:
        return 'VERBATIM', SYMBOLS[t]
    if t in GREEK:
        return 'VERBATIM', GREEK[t]
    if len(t) == 1 and ord(t) > 0x7F and not (0xC0 <= ord(t) <= 0x24F):
        return 'VERBATIM', 'sil'
    if t.lower() in ABBREV:
        return 'PLAIN', ABBREV[t.lower()]
    if re.match(r'^(?:[A-Za-z]\. ?)+[A-Za-z]?\.?$', t) and '.' in t and len(re.sub(r'[^A-Za-z]', '', t)) <= 6:
        return 'LETTERS', spell_letters(t)
    if re.match(r'^[A-Z]-$', t):
        return 'LETTERS', spell_letters(t)
    m = re.match(r"^([A-Z]{2,6})(s|'s)?-?$", t)
    if m and m.group(1) not in CAPS_WORDS and not (len(m.group(1)) >= 4 and is_pronounceable(m.group(1))):
        return 'LETTERS', spell_letters(m.group(1)) + ("'s" if m.group(2) else '')
    if re.match(r'^[A-Za-z]{2,4}$', t) and not re.search(r'[aeiouyAEIOUY]', t):
        return 'LETTERS', spell_letters(t)
    return 'PLAIN', tok


def run_rules(tokens):
    out = []
    for i, t in enumerate(tokens):
        out.append(normalize(t, tokens[max(0, i - 3):i], tokens[i + 1:i + 4]))
    return out
