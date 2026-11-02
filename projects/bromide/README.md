# Bromide

## What it’s for

Originality is hard to point at. Information theory gives one handle on it: a word that could have been guessed carries little information, and a word that could not carries a lot. Bromide scores each word of a visitor’s sentence in bits of surprisal under a language model counted from 42 public-domain books, so you can see where a sentence leans on habit. It also keeps the awkward question in view: predictable to whom? Here the answer is a few dozen books from about 1810 to 1920, and their taste is not yours.

## How I know

**What is modelled.** A word trigram model: the chance of each token given the two tokens just before it in the same sentence. A token is a word or one of the marks `, ; : . ! ?`; each sentence starts afresh with no context, and the model also predicts the end of the sentence. Text is lowercased, accents are dropped (“café” is read as “cafe”), curly apostrophes are straightened, quotation marks and dashes are ignored, and the full stop after Mr, Mrs, Dr and the like is not a sentence end. Probabilities are interpolated modified Kneser–Ney (Kneser and Ney 1995; Chen and Goodman 1998), with discounts D1, D2, D3+ estimated per order from counts of counts. Surprisal is −log₂ p(word | the two tokens before it). The page scores words only; punctuation is predicted and enters the context but is not shown or averaged.

**The corpus.** 42 books from Project Gutenberg, fetched by `build/fetch.py` from the University of Waterloo mirror (`https://mirror.csclub.uwaterloo.ca/gutenberg`, the script’s default) following Gutenberg’s robot policy: a mirror, one request at a time, 2.5 s between requests. The raw texts were kept outside the repository; only the model, the book list (`data/books.json`) and the preview scores are committed. Headers, footers and licence text are stripped by `build/build_model.py` (between the `*** START` and `*** END` markers; any paragraph mentioning Gutenberg; transcriber and edition notes in the first paragraphs; `[Illustration]` tags). Tables of contents and lists of illustrations are dropped too: a “Contents” or “Illustrations” heading near the front starts a list, which runs while paragraphs read like headings and ends at the first paragraph of prose, and lines ending in a page number go wherever they sit in the front matter (about 6,700 words over 37 books; `tests/strip.test.js`). Chapter headings inside the text remain. About 3.8 million words in 291,000 training sentences.

**Predictable to whom.** The books are mostly British and American novels and essays published between about 1813 (Pride and Prejudice) and 1920 (The Age of Innocence). Their idea of a likely word is that era’s: after “I dare”, they give “say” about three chances in four; “okay” and “email” are unknown. A sentence that sounds old scores as predictable even when it would read as fresh today, and the reverse. This era bias is the single most important caveat, and the page’s one paragraph says so.

**What is simplified.**
- Only two tokens of context, none across sentences. The model cannot tell a fresh image from nonsense: shuffled words score high too (see the cliché check below), and the page says so in its nudge.
- Vocabulary: the 35,002 most frequent words seen at least twice (99.56% of word tokens). Any other word is “unknown to the books”: it is flagged, given no score of its own, and left out of the average. Internally it is scored as `<unk>`, the bucket for all rare words, so that the context that follows it stays well defined.
- Pruning: every bigram is kept; trigrams seen only once are dropped (2.38 million distinct trigrams down to 420,000). Their share of probability is added to their context’s back-off weight, so every prediction still sums to one. On held-out text this costs 0.04 bits per word: 8.077 bits shipped against 8.041 for exact Kneser–Ney with nothing pruned.
- Rounding: each stored value is rounded to the nearest tenth of a bit, each back-off weight to an eighth of a bit on a logit grid, and each context’s values are then scaled to fill exactly what its weight leaves. The build measures, over every entry and context, the largest error this adds at each level and combines them into a bound on how far any shipped probability can be from the same pruned model unrounded: 0.16 bits. (The weight’s grid is symmetric, so rounding does not systematically inflate back-off weights; measured, the weights are within 0.062 bits of exact and their complements within 0.061.) A context whose weight would fall off the grid would be dropped; there are none.
- Size: `data/model.bin` is 3.56 MB, a compact binary of varint-delta word ids and one-byte values. It is loaded only by the project page, with a progress bar; the card preview loads only `data/preview.js` (1.2 kB). GitHub Pages compresses text types such as .json and .js, but most likely not a `.bin` served as `application/octet-stream`, so a visitor probably downloads the full 3.56 MB (2.03 MB if a server did gzip it). I have not checked the deployed response headers.

**Memorisation, measured.** The spec expected famous openings of books in the corpus to be memorised. This model cannot recite them, and the page says so. The build scores three openings with the shipped model, with exact Kneser–Ney with nothing pruned, and with exact Kneser–Ney trained without that line (every training sentence beginning with it removed):

| Line (in the books once) | Shipped | Nothing pruned | Never read | Runs of three kept |
| --- | --- | --- | --- | --- |
| Austen, “It is a truth universally acknowledged…” | 6.03 | 5.43 | 6.75 | 17 of 25 |
| Dickens, “It was the best of times…” | 5.72 | 5.05 | 6.14 | 23 of 28 |
| Melville, “Call me Ishmael.” | 10.13 | 7.92 | 11.95 | 2 of 4 |

(bits per known word; ordinary held-out sentences average 8.08.) Reading a line once does make it less surprising. For Austen the fall is 0.7 bits per word, about 16.6 bits over its 23 words: the exact sequence became about 100,000 times likelier. But the model still could not recite it: “universally” (11.0 bits), “possession” (12.0) and “want” (12.2) remain long shots, because a trigram model with Kneser–Ney discounting gives a sequence seen once little weight in any common context, and pruning removes the singleton trigrams altogether. What makes Austen’s and Dickens’s lines predictable is stock phrasing the books use again and again (“in possession of”, “must be in want of”, “it was the”). “Call me Ishmael.” falls further, 1.8 bits per word, only because “ishmael” is almost impossible after “me” for a model that never read the line; in the shipped model it still costs 15.1 bits, and the line as a whole scores above an ordinary sentence from the books.

On the page, writing one of these lines shows its figures with a verdict from `Bromide.memoryVerdict` in `model.js`. It says the model “remembers much of it” only when the line scores under half the held-out average and at least three in four of its runs of three survived pruning; none of the three does. Otherwise it says how far reading the line lowered its score and that the model could not recite it, and, for Ishmael, that the line is still more surprising than an ordinary sentence. A text that only opens with one of the lines is told so, with the line’s own figure kept separate from the text’s. `tests/shipped.test.js` checks every probe, the verdict rule on made-up cases, and the matching. The run marker (five or more words in a row under 1.5 bits each) is described as the books’ habitual phrasing, not as memory of a particular line.

**What I checked** (all in `tests/`, run with `node projects/bromide/tests/run-all.js`; the model checks run on a small model built from `tests/fixture`, my own prose in Gutenberg format, and the shipped model):
- (a) `normalisation.test.js`: for 100 random contexts (half of them contexts the trigram table knows), the probabilities over the whole vocabulary sum to 1 within 1e-6. Worst error on the shipped model: under 1e-12.
- (b) `reference.test.js`: the JavaScript scorer (`model.js`) and the Python reference scorer (`build/score.py`) agree token by token on 50 random sentences, within 1e-6 bits, and tokenise identically, including accents, curly apostrophes, abbreviations and stray symbols. Worst difference on the shipped model: about 2e-15 bits.
- (c) `cliche.test.js`: ten common clichés each score lower than the average of 30 shuffles of their own words, and lower than at least 80% of the shuffles. On the shipped model all ten pass, nine of them 30 out of 30 (for example 4.5 against 8.6 bits for “At the end of the day, it was all for the best.”). The weakest is “Time heals all wounds.”, 12.1 against 12.5, 24 of 30: the books do not use it.
- (d) `oov.test.js`: unknown words are flagged, unscored and left out of the average; a sentence of only unknown words has no average; licence-only words (gutenberg, ebook, trademark, copyright and others) are not in the vocabulary, and ordinary words the licence also uses (license, licence, royalty, refund) are no more common than the novels make them.
- `exact.test.js`: the shipped format against an independent exact Kneser–Ney (`tests/kn_exact.py`, written with plain dictionaries), on the unpruned fixture (worst 0.052 bits) and on the fixture with pruning forced on (`--prune=2,2`, worst 0.100 bits, within the 0.146-bit bound the build computed for it).
- `shipped.test.js`: the model is under 4 MB; the book list matches the header; the preview scores are the shipped model’s own; the tired preview line scores more than a bit per word below the fresher one (4.8 against 10.8) with no unknown words; the rounding bound is under 0.25 bits; every memorisation probe matches the page’s scorer, and no verdict contradicts the score beside it.
- `strip.test.js`: a made-up Gutenberg file loses its header, licence, table of contents and list of illustrations, and keeps its prose.

**What would change the conclusion.** A different shelf. Modern prose would make different words surprising, and a model that reads further back, like today’s large language models, finds far more of any sentence predictable. A longer context would also memorise lines read once. The tones say how a few dozen old books would have guessed, nothing more.

## How it looks

The stage is the darkroom: a near-black easel field (#1b1514) lit faintly from the left by the red safelight (#a3201b), two scribed masking blades at opposite corners, and on it a deckle-edged sheet of cool white bromide paper (#f3f0e8). Surprisal is shown as exposure, in the letters themselves rather than in boxes behind them: each word is printed in one of five silver tones, from pale #b9b4ab (under 2 bits, better than a 1-in-4 guess) through #88837b (2–4), #6d6860 (4–7) and #45413c (7–11) to near-black #1a1816 (11 bits or more), and the two darkest carry a slight bloom of their own tone, as silver halide spreads a little where it is densest. So predictable words print faint and surprising ones develop dark. The legend is a five-step wedge printed by the same rule (`step` in `app.js`, `.x0`–`.x4` in `style.css`) and labelled “faint: expected / dark: surprising”.

The two faintest tones fall below 4.5:1 against the paper (#b9b4ab is about 1.8:1, #88837b about 3.3:1). That is deliberate, since faintness is the measurement, and it is bounded: those tones are used only for words at 20–23 px, each word is also in full black in the text box above, its exact bits are printed beneath it in #5f5a53 (6:1), and its button carries the word and its bits as an accessible name. Tone is never the only signal. The text box is an enlarger easel; red safelight marks interface elements, never data. The card preview shows one sentence fully developed from the first frame, then fades it to a ghost and develops the next in place, faint words settling first and dark ones darkening longest; it uses only `data/preview.js`. The type is EB Garamond (SIL Open Font License; `fonts/OFL.txt`), self-hosted as three Latin-subset WOFF2 files (regular, italic, medium; 67 kB) from Fontsource 5.1.0.

## Rebuilding

```
python -I projects/bromide/build/fetch.py <empty-corpus-dir>
python -I projects/bromide/build/build_model.py <corpus-dir> projects/bromide/data
node projects/bromide/tests/run-all.js
```

`build_model.py` needs numpy. It fails if the preview’s tired line does not score clearly below its fresh line. The shipped build kept trigrams seen at least twice (the least pruning that fits 3.9 MB).

## The books

Texts from Project Gutenberg (www.gutenberg.org).

- Pride and Prejudice, Jane Austen (#1342)
- Frankenstein, Mary Wollstonecraft Shelley (#84)
- A Tale of Two Cities, Charles Dickens (#98)
- Alice’s Adventures in Wonderland, Lewis Carroll (#11)
- Moby-Dick, Herman Melville (#2701)
- The Yellow Wallpaper, Charlotte Perkins Gilman (#1952)
- Jane Eyre, Charlotte Brontë (#1260)
- Walden, Henry David Thoreau (#205)
- The Picture of Dorian Gray, Oscar Wilde (#174)
- The Adventures of Sherlock Holmes, Arthur Conan Doyle (#1661)
- Wuthering Heights, Emily Brontë (#768)
- On Liberty, John Stuart Mill (#34901)
- Dracula, Bram Stoker (#345)
- The Strange Case of Dr. Jekyll and Mr. Hyde, Robert Louis Stevenson (#43)
- Middlemarch, George Eliot (#145)
- The Time Machine, H. G. Wells (#35)
- Adventures of Huckleberry Finn, Mark Twain (#76)
- Essays, First Series, Ralph Waldo Emerson (#2944)
- Great Expectations, Charles Dickens (#1400)
- Heart of Darkness, Joseph Conrad (#219)
- Tess of the d’Urbervilles, Thomas Hardy (#110)
- The Problems of Philosophy, Bertrand Russell (#5827)
- Emma, Jane Austen (#158)
- Dubliners, James Joyce (#2814)
- Treasure Island, Robert Louis Stevenson (#120)
- The Souls of Black Folk, W. E. B. Du Bois (#408)
- The Age of Innocence, Edith Wharton (#541)
- The War of the Worlds, H. G. Wells (#36)
- The Awakening, Kate Chopin (#160)
- A Room with a View, E. M. Forster (#2641)
- Silas Marner, George Eliot (#550)
- The Turn of the Screw, Henry James (#209)
- The Adventures of Tom Sawyer, Mark Twain (#74)
- A Portrait of the Artist as a Young Man, James Joyce (#4217)
- The Call of the Wild, Jack London (#215)
- Persuasion, Jane Austen (#105)
- The Man Who Was Thursday, G. K. Chesterton (#1695)
- The Scarlet Letter, Nathaniel Hawthorne (#33)
- The Secret Garden, Frances Hodgson Burnett (#113)
- A Christmas Carol, Charles Dickens (#46)
- Anne of Green Gables, L. M. Montgomery (#45)
- The Sign of the Four, Arthur Conan Doyle (#2097)

## Sources

- C. E. Shannon (1948). “A Mathematical Theory of Communication.” *Bell System Technical Journal* 27.
- C. E. Shannon (1951). “Prediction and Entropy of Printed English.” *Bell System Technical Journal* 30.
- R. Kneser and H. Ney (1995). “Improved backing-off for M-gram language modeling.” *Proceedings of ICASSP*.
- S. F. Chen and J. Goodman (1998). “An empirical study of smoothing techniques for language modeling.” Technical report TR-10-98, Harvard University.
- Project Gutenberg, https://www.gutenberg.org/ (texts), and its robot access policy, https://www.gutenberg.org/policy/robot_access.html.
- Inspiration: Russell Samora (2026). “Comparisons as Predictable as the Sunrise.” *The Pudding*. (Cited without a link; I have not verified the URL.)
