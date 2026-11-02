"""Metrics and error typing: Python twin of the metric half of ../model.js.

exact_match   the honest score: the whole reading must match the reference.
slot_scores   the original project's score: Keras-style per-slot accuracy over a
              fixed number of output slots (20), with sequences pre-padded the way
              keras pad_sequences does by default, and padding slots counted as
              correct when both sides are padding. Its train/validation targets
              were one-hot encoded with no mask, so this is what "99.51%" measured.
"""
import re
import rules as R

_WS = re.compile(r'\s+')


def canon(s):
    return _WS.sub(' ', str(s)).strip().lower()


def exact_match(pred, ref):
    return canon(pred) == canon(ref)


def slot_scores(pred, ref, slots=20, count_padding=True):
    P = [w for w in canon(pred).split(' ') if w][-slots:]
    Rf = [w for w in canon(ref).split(' ') if w][-slots:]
    P = [None] * (slots - len(P)) + P
    Rf = [None] * (slots - len(Rf)) + Rf
    correct = total = 0
    for a, b in zip(P, Rf):
        pad = a is None and b is None
        if pad and not count_padding:
            continue
        total += 1
        if a == b:
            correct += 1
    return correct, total


def accuracy(pairs, padding=False, slots=20):
    if not padding:
        return sum(exact_match(p, r) for p, r in pairs) / len(pairs) if pairs else 0.0
    c = t = 0
    for p, r in pairs:
        a, b = slot_scores(p, r, slots, True)
        c += a
        t += b
    return c / t if t else 0.0


def _build_sets():
    number = set()
    for w in R.ONES + [x for x in R.TENS if x] + ['hundred', 'thousand', 'million', 'billion', 'trillion', 'o', 'point', 'minus']:
        number.update([w, R.ordinal_word(w), R.plural_word(w)])
    # unit and currency words; single letters and words with another common sense
    # ('c' from 'c c', 'second' the ordinal) are left out
    unit = set()
    for pair in R.UNITS.values():
        for p in pair:
            for w in p.split(' '):
                if w not in NOT_UNITS:
                    unit.add(w)
    unit.update(['dollar', 'dollars', 'pound', 'pounds', 'euro', 'euros', 'yen', 'rupee', 'rupees', 'cent', 'cents', 'riyal', 'riyals'])
    return number, unit, set(R.MONTHS)


NOT_UNITS = {'c', 'second', 'per', 'square'}
NUMBER_WORDS, UNIT_WORDS, MONTH_WORDS = _build_sets()
ERROR_TYPES = ['unread', 'spelling', 'repeat', 'unit', 'month', 'number', 'other']
SPELLED = {'ELECTRONIC', 'LETTERS'}
_LETTER_RE = re.compile(r'^[a-z]$')


def _words_in(words, s):
    return ' '.join(w for w in words if w in s)


def _units_in(words):
    """Unit words said after a number word."""
    num, out = False, []
    for w in words:
        if w in NUMBER_WORDS:
            num = True
        elif num and w in UNIT_WORDS:
            out.append(w)
    return ' '.join(out)


def _count(words, phrase):
    n = len(phrase)
    return sum(1 for i in range(len(words) - n + 1) if words[i:i + n] == phrase)


DIGIT_OF = {'o': '0', 'zero': '0', 'one': '1', 'two': '2', 'three': '3', 'four': '4', 'five': '5', 'six': '6',
            'seven': '7', 'eight': '8', 'nine': '9'}


def _has_stutter(P, Rf, inp):
    """A phrase of 1-3 words said twice in a row that the reference says, but never twice in a row.
    A doubled digit word is no stutter when the input has that digit doubled ('115' -> 'one one five')."""
    for n in (1, 2, 3):
        for i in range(len(P) - 2 * n + 1):
            a = P[i:i + n]
            if P[i + n:i + 2 * n] != a:
                continue
            if n == 1 and a[0] in DIGIT_OF and DIGIT_OF[a[0]] * 2 in str(inp or ''):
                continue
            if _count(Rf, a) > 0 and _count(Rf, a + a) == 0:
                return True
    return False


def _spelled_ref(Rf):
    return len(Rf) >= 2 and all(_LETTER_RE.match(w) or w == 'dot' for w in Rf)


def error_type(pred, ref, inp=None, cls=None):
    if exact_match(pred, ref):
        return None
    P = [w for w in canon(pred).split(' ') if w]
    Rf = [w for w in canon(ref).split(' ') if w]
    if inp is not None and canon(pred) == canon(inp):
        return 'unread'
    if ''.join(P) == ''.join(Rf):  # same letters, different word breaks ('kilovolts', 'kilo volts')
        return 'other'
    if (cls in SPELLED) if cls else _spelled_ref(Rf):
        return 'spelling'
    if _has_stutter(P, Rf, inp):
        return 'repeat'
    ru = _units_in(Rf)
    if ru and _units_in(P) != ru:
        return 'unit'
    if _words_in(P, MONTH_WORDS) != _words_in(Rf, MONTH_WORDS) and _words_in(Rf, MONTH_WORDS):
        return 'month'
    if _words_in(P, NUMBER_WORDS) != _words_in(Rf, NUMBER_WORDS) and _words_in(Rf, NUMBER_WORDS):
        return 'number'
    return 'other'
