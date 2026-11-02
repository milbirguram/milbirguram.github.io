"""Shared helpers for the Rote pipeline (data loading and reference clean-up)."""
import os, re

HERE = os.path.dirname(os.path.abspath(__file__))
SCRATCH = os.environ.get('ROTE_SCRATCH', r'C:\Users\MILBIR\AppData\Local\Temp\claude\C--Users-MILBIR-Desktop-Git\c3e3582f-6443-4676-a52a-c51260891918\scratchpad')
RAW = os.path.join(SCRATCH, 'rote-raw')
WORK = os.path.join(SCRATCH, 'rote-work')
DATA_OUT = os.path.join(HERE, '..', 'data')

TRIVIAL = ('PLAIN', 'PUNCT')
_LETTER = re.compile(r'_letter\b')
_SPACES = re.compile(r'\s+')


def resolve_ref(cls, inp, out):
    """Turn a Kestrel output column into the string a reader should say.

    '<self>' means "read the token as written"; for PUNCT, 'sil' means the
    punctuation passes through as a pause, so both resolve to the input itself.
    ELECTRONIC readings carry a '_letter' suffix on spelled characters; it is
    stripped so references are plain words.
    """
    if out == '<self>' or (cls == 'PUNCT' and out == 'sil'):
        return inp
    out = _LETTER.sub('', out)
    return _SPACES.sub(' ', out).strip()


def read_sentences(path, resolve=True):
    """Yield sentences as lists of (cls, inp, ref) from a Kestrel-format file."""
    sent = []
    with open(path, encoding='utf-8') as f:
        for line in f:
            line = line.rstrip('\n')
            if not line:
                if sent:
                    yield sent
                    sent = []
                continue
            parts = line.split('\t')
            if parts[0] == '<eos>':
                if sent:
                    yield sent
                sent = []
                continue
            if len(parts) < 3:
                continue
            cls, inp, out = parts[0], parts[1], parts[2]
            sent.append((cls, inp, resolve_ref(cls, inp, out) if resolve else out))
    if sent:
        yield sent
