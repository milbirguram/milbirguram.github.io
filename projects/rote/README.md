# Rote

A text-to-speech front end has to turn “£900” into “nine hundred pounds” before anything can be spoken. Rote shows four ways of deciding, side by side, on held-out test sentences and on text you type, and then a scoreboard that starts at the kind of figure my 2018 group project reported and falls, one switch at a time, to honest numbers.

To repeat something “by rote” is to repeat it without understanding. That is what the original project's model mostly did, and what its headline number hid.

## What it’s for

A visitor should leave knowing that a headline accuracy means nothing without the baseline beneath it. In text normalisation, more than nine tokens in ten are ordinary words and punctuation that need no work at all; copying the input already scores about 92%. Count padded output slots as correct and even copying passes 98%. The only numbers that say whether a system can read a new sentence are the ones on the tokens that need work, and above all on the ones it has never seen.

## What the original got wrong, and what changed

The original is *conTEXT: Normalization using LSTM*, a 2018 group project at Simon Fraser University by Siddhant Singhal, Raghib Musarrat, Rahul Rajeev and Milbir Guram, with Greg Mori (poster: Vision and Media Lab, SFU). The repo's README says it was written for a course (it mentions class assignments); the course number is not recorded in the files. An independent review found:

- **The 99.51% was padding.** It was Keras per-slot accuracy over 20 output slots. `utils.sequences()` one-hot encoded the pad id 0 like any word and nothing masked it, so for a one-word target 19 of the 20 slots were “correct” before the model did anything. *Changed:* the honest metric here is exact match of the whole reading; the old metric is reproduced on the new outputs (keras `pad_sequences` pads and truncates at the front; that detail is kept) so the page can show the gap. `tests/test_metrics.js` checks it on a toy example in both languages.
- **No baseline.** PLAIN and PUNCT tokens are 92.5% of the test tokens, and copying the input gets nearly all of them right. *Changed:* copy and a memorised lookup table are evaluated beside everything else, and the main scores exclude PLAIN and PUNCT. `tests/test_eval.js` checks that copy's accuracy equals the PLAIN+PUNCT share within a point.
- **“Beats Google's Kestrel (91.3%)”.** The reference readings in this data *are* Kestrel's output, so Kestrel scores 100% on them by construction; the 91.3% comes from a different evaluation. *Changed:* no comparison with Kestrel is made; the page says plainly that “correct” means “agrees with Kestrel”.
- **Poster numbers produced by no code.** The poster's 98.2% for conTEXT and 97.4% for XGBoost have no code in the repo. *Changed:* every number on the page is read from `data/eval.json`, which `pipeline/evaluate.py` writes; `tests/test_numbers.js` checks the page for stray numbers.
- **No labelled test set, and failure on unseen tokens admitted in the README.** *Changed:* a sentence-level train/dev/test split with a fixed seed, and every score is also given on test tokens whose exact text never occurs in train.
- **The notebook does not rerun; output vocabulary capped at 346 words.** *Changed:* a scripted pipeline (below); the neural output vocabulary is every word seen at least twice in non-trivial training references (491 words).
- **Much of `text_norm/` appears to be third-party code without attribution.** *Changed:* nothing was reused. Everything here was written from scratch; the old files were read as data only (no code run, nothing unpickled, the `.h5` model not loaded).

## How I know

**Data.** Sproat and Jaitly's English text-normalisation data, released by Google (linked from github.com/rwsproat/text-normalization-data, hosted on Kaggle as “Text Normalization for English, Russian and Polish”, version 1, 2020). The dataset's LICENSE file is Creative Commons Attribution-ShareAlike 4.0; its README says the text is from Wikipedia (extracted 2016-04-08) and that classes, tokens and reference readings are all Kestrel's. I streamed the 3.9 GB English archive and kept only the first two shards it contained, `output-00058-of-00100` and `output-00003-of-00100` (about 420 MB raw, 21,139,585 tokens in 1,763,387 sentences). Sentences were shuffled with seed 2018 and split 95 / 1 / 4 % into train / dev / test (1,675,219 / 17,633 / 70,535 sentences; 20,082,108 / 212,316 / 845,161 tokens). The shards are a random-looking slice of Wikipedia, not the paper's split.

References are cleaned in one way only: `<self>` (and `sil` on PUNCT) means “read as written”, and the `_letter` suffix Kestrel puts on spelled characters in URLs is dropped. Exact match ignores case and extra spaces. The derived files in `data/` contain Wikipedia text and Kestrel readings and are shared under the same CC BY-SA 4.0 licence.

**The systems.** Four are shown token by token on the page; the fifth, *gated*, appears only on the scoreboard.

1. *Copy*: output the input.
2. *Lookup*: the most frequent reading of each input string in train; anything unseen is copied. The page carries the 3,950 most frequent non-copy entries (about 150 KB) for your own text; the scores use the full table (164,422 non-copy entries).
3. *Rules*: hand-written classifier and verbalisers for cardinals, dates, years, money, measures, decimals, ordinals, times, telephone-like digit strings, digits, fractions, letters, symbols and web addresses, following Kestrel's conventions (no “and” in numbers, “o” for zero digits, “twenty ten” for 2010). It lives in `model.js` for the page, with a line-by-line Python twin in `pipeline/rules.py` for evaluation. The rules were written by looking at train and dev only. On the whole dev split (212,316 tokens) and the whole test split (845,161 tokens) the two give identical output and identical error kinds; `tests/test_rules_agree.js` checks a fixed suite against the live Python and every demo token against the stored Python verdict.
4. *Neural*: a character-level encoder (2-layer bidirectional GRU) over the token with three words of context either side, marked with boundary symbols, and a GRU decoder with attention over output words, about 5.1 million parameters. Trained only on non-trivial tokens (every class but PLAIN and PUNCT), with at most 40 examples per distinct input string so that years and common abbreviations do not swamp the rest (641,725 examples), mixed precision on an RTX 2060 for 45 minutes (six full epochs and part of a seventh; model chosen by dev exact match, 98.4% on a 6,000-token dev sample). A target equal to the input is the single word `<self>`. Its readings are precomputed: the page holds 2,106 held-out test sentences (about 290 KB). No ONNX model ships, because precomputed readings answer the question and a model of this size would exceed the 4 MB budget once int8-quantised with its vocabularies.
5. *Gated*: the same neural model, but asked only about the tokens the rules decide need reading (the rules give a class other than PLAIN or PUNCT, or change the token); everything else is copied. This is the fair comparison with the rules. *Neural* above is told by the data which tokens need reading (an oracle that no real front end has): it is asked about exactly the 63,375 non-trivial test tokens and credited with every PLAIN and PUNCT token for free. That oracle applies in every setting, not only when PLAIN and PUNCT are included: with them set aside, it still spares the model the “word or acronym?” decision that the rules get wrong on 747 of the 4,712 unseen tokens (most of them LETTERS and DATE). The rules' gate sends 3,405 test tokens that the data marks PLAIN or PUNCT to the model, and keeps 2,819 non-trivial ones from it.

**Results (held-out test, 845,161 tokens).**

| Setting | tokens | copy | lookup | rules | neural (oracle) | gated |
|---|---:|---:|---:|---:|---:|---:|
| Old metric: padded slots, all tokens | 845,161 | 98.8% | 99.81% | 99.90% | 99.95% | 99.87% |
| Exact match, all tokens | 845,161 | 92.2% | 99.24% | 99.30% | 99.53% | 99.11% |
| Exact match, PLAIN and PUNCT set aside | 63,375 | 1.1% | 91.6% | 95.6% | 98.6% | 95.6% |
| Exact match, unseen non-trivial tokens only | 4,712 | 0.0% | 0.0% | 82.1% | 92.4% | 79.0% |

Wrong readings by kind on non-trivial test tokens (unseen tokens in brackets):

| kind | copy | lookup | rules | neural | gated |
|---|---:|---:|---:|---:|---:|
| left unread | 62,654 (4,712) | 4,846 (4,712) | 2,098 (747) | 9 (1) | 2,100 (747) |
| wrong spelling-out | 0 (0) | 23 (0) | 73 (6) | 207 (156) | 144 (111) |
| repeated phrase | 0 (0) | 0 (0) | 0 (0) | 28 (27) | 18 (18) |
| unit wrong or missing | 0 (0) | 1 (0) | 7 (7) | 23 (22) | 15 (14) |
| month wrong or missing | 0 (0) | 0 (0) | 13 (13) | 8 (8) | 4 (4) |
| wrong number | 0 (0) | 425 (0) | 515 (54) | 542 (112) | 499 (86) |
| other | 0 (0) | 9 (0) | 112 (18) | 54 (34) | 27 (9) |

How the kinds are assigned (`errorType` in `model.js`, `error_type` in `metrics.py`; first match wins): *left unread* if the reading equals the input; *other* if it differs from the reference only in word breaks (“kilovolts” against “kilo volts”); *wrong spelling-out* if the reference class is ELECTRONIC or LETTERS (a URL or acronym spelled wrongly); *repeated phrase* if a phrase of one to three words is said twice in a row where the reference says it but never twice (a doubled digit word is not counted when the input has that digit doubled); *unit wrong or missing* if the unit or currency words said after a number differ from the reference's (single letters and “second” are not unit words); *month wrong or missing*; *wrong number*; otherwise *other*. The first version of this typer counted “c” and “second” as units and any doubled word as a repeat, so mangled URLs showed up as “wrong unit” and digit-by-digit readings as “repeated word”; an independent check caught it. I read samples of every kind for the rules and the neural model after the change. The rules' 13 month errors are numeric dates such as `25-10-2012` read digit by digit, so the month is missing rather than wrong.

By class, exact match on all / unseen test tokens:

| class | tokens (unseen) | rules | neural (oracle) | gated |
|---|---:|---:|---:|---:|
| date | 27,401 (1,486) | 99.2% / 88.6% | 99.9% / 98.1% | 99.3% / 89.7% |
| letters | 12,951 (1,094) | 87.7% / 60.1% | 99.6% / 98.0% | 88.0% / 59.9% |
| cardinal | 10,908 (422) | 96.6% / 96.2% | 98.0% / 97.6% | 97.1% / 94.1% |
| verbatim | 7,121 (123) | 97.9% / 87.8% | 99.6% / 91.1% | 98.9% / 87.8% |
| measure | 1,219 (410) | 96.1% / 89.8% | 97.9% / 94.1% | 95.7% / 88.8% |
| ordinal | 1,012 (8) | 95.6% / 100.0% | 92.1% / 100.0% | 91.3% / 100.0% |
| decimal | 801 (187) | 99.6% / 100.0% | 100.0% / 100.0% | 100.0% / 100.0% |
| money | 505 (245) | 93.3% / 89.4% | 95.6% / 91.0% | 92.9% / 88.6% |
| electronic | 444 (265) | 87.2% / 85.7% | 65.5% / 49.1% | 60.8% / 47.2% |
| digit | 436 (65) | 48.2% / 23.1% | 62.2% / 64.6% | 56.2% / 50.8% |
| telephone | 312 (273) | 85.6% / 87.2% | 81.4% / 79.5% | 74.0% / 73.6% |
| time | 115 (63) | 97.4% / 96.8% | 89.6% / 82.5% | 89.6% / 82.5% |
| fraction | 115 (58) | 97.4% / 94.8% | 86.1% / 74.1% | 86.1% / 74.1% |
| address | 35 (13) | 0.0% / 0.0% | 91.4% / 76.9% | 0.0% / 0.0% |

The copy baseline scores 92.2% on all tokens; PLAIN and PUNCT are 92.5% of them. Under the old padded metric copying scores 98.8%, and the neural model 99.95%, against the 99.51% the 2018 README reported. On tokens never seen in training, lookup can only copy (0%), the rules reach 82.1% and the neural model 92.4% — but only because it is told which tokens need reading. Put behind the rules' own decision, the same model scores 79.0%, below the rules: most of its apparent lead was the oracle (on unseen LETTERS, for example, 98.0% with the oracle and 59.9% without). Its misses also include more of the kind a listener notices at once. On unseen tokens, counting garbled spellings, repeated phrases and wrong or missing units and months, the oracle model makes 213 such errors, the gated model 147 and the rules 26. Most of the model's are web addresses and letter strings spelled wrongly. Its weakest classes are the ones that need spelling out rather than memory (electronic 65.5%, fraction 86.1% on all tokens), where the rules are stronger.

**Simplifications.** All systems see Kestrel's token boundaries in the evaluation; on the page your own text is split by a regex tokeniser instead. In that tokeniser a hyphen straight after a letter, digit or closing bracket is a token of its own, so “10-20” reads “ten to twenty” rather than “ten minus twenty”, and “555-1234” stays one telephone token (`tests/test_model.js` checks these, along with emoji and decades such as “90s”). The *neural* row is asked only about the tokens the data marks as non-trivial, in every setting (see *Gated* above); the *gated* row is the comparison to use. Seen/unseen is by exact input string, not by context, so it is a lower bound on novelty: many unseen strings are made of familiar parts (a new date in a familiar format, a new number before a familiar unit), and they are easier than a truly new kind of token would be. The original 2018 model is not rerun; its metric is applied to these systems instead. Error kinds are assigned by the simple rules described above, so the counts are approximate; the per-kind examples in `data/eval.json` show what each kind holds.

**What would change the conclusion.** A neural model that held up on unseen tokens as well as the rules do, behind a real front-end classifier, would weaken the case for rules, but not the case against padded, baseline-free accuracy. References written by people rather than by Kestrel would lower the rules' scores, since they were written to Kestrel's conventions.

**How to rerun.**

```
python -I pipeline/fetch.py   (streams the archive; see its docstring)
python -I pipeline/prepare.py
python -I pipeline/dev_rules.py            # rules on dev, per class
<python with torch> -I pipeline/train.py 45
<python with torch> -I pipeline/evaluate.py
node tests/run_all.js
python -I tests/test_seen.py               # needs the local data
```

The shared venv's `python.exe` was missing on the build machine, so torch was imported from that venv's `site-packages` by its base interpreter (Python 3.14); `train.py` does this itself when `import torch` fails.

## Sources

- Richard Sproat and Navdeep Jaitly. 2016. RNN Approaches to Text Normalization: A Challenge. arXiv:1611.00068. https://arxiv.org/abs/1611.00068
- Richard Sproat. Text Normalization for English, Russian and Polish (dataset, Kaggle, 2020; CC BY-SA 4.0). Linked from https://github.com/rwsproat/text-normalization-data
- Peter Ebden and Richard Sproat. 2015. The Kestrel TTS text normalization system. Natural Language Engineering 21(3).
- Paul Taylor. 2009. Text-to-Speech Synthesis. Cambridge University Press.
- Dzmitry Bahdanau, Kyunghyun Cho and Yoshua Bengio. 2015. Neural Machine Translation by Jointly Learning to Align and Translate. ICLR.
- Siddhant Singhal, Raghib Musarrat, Rahul Rajeev, Milbir Guram and Greg Mori. 2018. conTEXT: Normalization using LSTM. Poster and code, Simon Fraser University (the repo ML_Project).
- Courier Prime, copyright 2015 The Courier Prime Project Authors (Quote-Unquote Apps), SIL Open Font License 1.1 (fonts/OFL.txt), WOFF2 files from Fontsource 5.2.8.
