# Echo

Pick a sentence from an English Wikipedia article and check whether its cited source was published after the sentence first appeared on Wikipedia, the signature of citogenesis.

Sometimes a claim is added to Wikipedia without a source. A journalist or author reads it there and repeats it. Then an editor finds that article or book and cites it for the claim, which now looks well sourced. This loop is called citogenesis. Its trace is in the dates: the source was published after the claim was already on Wikipedia.

## What it’s for

Wikipedia is widely read by the people who write the sources it cites. Echo lets anyone take one sentence and see, in about a minute, whether its source was published after the sentence was already on Wikipedia. It shows every step and every revision it looked at, so the answer can be checked rather than trusted.

## Reading the verdict

- **Possible echo (↻).** A cited source is dated after a revision that already contained the claim. The source may have taken it from Wikipedia. It may also have found it independently; the dates cannot say which.
- **Source came first (✓).** A cited source is dated before the earliest wording of the claim that Echo found. Before saying so, Echo looks in the revisions before that wording for an earlier one that shares the sentence’s rarer words. If such a wording was on Wikipedia before the source, the answer is “Can’t tell” instead. The source could still be wrong.
- **Citation added later (◷).** No cited source has a date that settles the order, the claim first appeared with no citation, and this one was attached later. That is common and usually innocent. It is context, not proof.
- **Can’t tell (?).** No usable date, a date too coarse to order against the claim (a year that contains the day the claim appeared, say), a history too tangled to read, or an earlier wording that may make the same claim and was on Wikipedia before the source.

## What it cannot tell

Dates show order, not copying. A later source may have its own evidence. An earlier source may have been updated quietly after the claim appeared. A citation’s date field may be wrong, or describe a reprint rather than the first edition. Echo matches words, not meaning. If a sentence was reworded, it traces this wording and then looks for an earlier one sharing its rarer words; a rewording in quite different words would not be found. Each run reads at most 40 old revisions, so a long or tangled history can leave the first appearance known only to a range.

## How I know

**What is modelled.** Echo reads the article’s wikitext through the Wikipedia API. It splits the prose into sentences and attaches each `<ref>` to the sentence it follows, including reused named refs, list-defined refs, short citations such as `{{sfn}}` and `{{harvnb}}` matched to their full entry, and the common `{{cite …}}` templates. A source’s date comes from `date`, `publication-date` or `year`, or from `orig-date` when that is earlier. Without those, it falls back to a date in the link’s path or a date in a free-text citation, and says so. Years inside a quoted or italic title or a link’s text are ignored (“Remembering the 1918 flu pandemic” is not from 1918), and a lone year in a citation with no clear title cannot on its own give “Source came first”. An access date is shown only as a hint.

To find the first appearance, it lists every revision up to the chosen one and binary-searches them, fetching one revision’s text at a time. A revision contains the claim when at least 80% of the traced words fall within a short window, every number and negator in the traced text is among them, and no “not” or “never” sits among them that the traced text lacks. Binary search assumes the claim, once added, stayed. Echo tests that: it samples revisions before the boundary and after it, and treats any revision seen without the claim after its first appearance as a sign of a messy history. A messy history never yields “Source came first”, because an earlier appearance could have been missed. It can still yield “Possible echo”, since that rests only on a revision Echo actually read. Dates are compared at their own precision: “2013” cannot be placed before or after 25 January 2013.

A claim is often reworded, and the search above finds only when this wording arrived. So before giving “Source came first”, Echo looks in every revision it has read from before that wording for a sentence that shares the claim’s rarer words, weighted by how few sentences of the article use them. If it finds one, it traces that wording back too. If the earlier wording was on Wikipedia before the source, or cannot be traced to its start within the fetch limit, the answer is “Can’t tell”, with the earlier wording shown and the shared words offered as a new text to trace. The earlier wording can only make Echo more cautious; it never counts as the claim on its own.

**What is simplified.** Tables, infoboxes, image captions and footnote text are left out. A sentence with no citation of its own borrows the next citation in its paragraph, and is labelled so. Matching is lexical: it counts shared words and does not understand meaning. Seasons are read for both hemispheres, so “Spring 2014” and “Autumn 2014” span March to November 2014, and “Summer 2014” and “Winter 2014” span December 2013 to February 2015. “c. 2014” is read as 2013 to 2015, and “1990s” as the whole decade. Sentence splitting is heuristic and will sometimes join or split sentences wrongly.

**What I checked.** Node tests in `tests/` cover date parsing in about twenty formats with their precision, the search on synthetic histories (including claims removed and re-added, brief reverts, hidden revisions and the fetch limit), a reworded claim on a fake history, the wikitext parser, the matching guards, and the request rules: every request goes to `en.wikipedia.org/w/api.php` with `maxlag=5`, one at a time, cached for the session. Run them with `node tests/run-all.js`. The card preview makes no requests; it replays a recorded run (`recorded.js`).

The six case files were run live on 2 November 2026; the results are in `tests/cases.json`, and the “Check all case files” button in the page (or `EchoCheck()` in the console) reruns them. All four documented incidents came out as “Possible echo” and both controls as “Source came first”. Mottainai’s history is messy, and Echo says so: the claim was removed in 2018 and restored in 2019 with the 2015 book as its source.

Two of the incidents need a word of warning. In AC Omonia and Arthur Meighen the cited sentence was newly worded when the citation was attached. Traced whole, each comes out as “Can’t tell”: Echo finds the earlier wording (by May 2007 for Omonia’s fans, from January 2008 for “graduated from Osgoode Hall Law School”) and says it was on Wikipedia before the source. Before I added the earlier-wording check, both came out as “Source came first”, which was wrong. Their case files trace the shared words Echo suggests, “fans Zany Ones” and “law Osgoode School”, and those find the claim in August 2008 and January 2008. The check runs every case, and the whole-sentence runs too, which must never come out as “Source came first”.

Two other incidents on Wikipedia’s list did not become case files. Ronnie Hazlehurst’s restored claim cites “Times obituary” with no date, and the Rabbit article’s 2015 citations for “fluffle” carry only access dates. Run through Echo, both come out as “Can’t tell”, which is the honest answer from those citations.

**What would change the conclusion.** A wrong date in a citation, an earlier edition of a book, or an earlier wording of the claim in quite different words would each move a verdict. So would a source that drew on something other than Wikipedia: “Possible echo” marks a sentence for a closer look, not a finding of copying.

## Sources

- Randall Munroe, “Citogenesis”, xkcd 978, 2011. https://xkcd.com/978/
- Wikipedia, “List of citogenesis incidents”, the source of the four documented case files. https://en.wikipedia.org/wiki/Wikipedia:List_of_citogenesis_incidents
- Wikipedia, “Verifiability”, on sources that mirror or use Wikipedia. https://en.wikipedia.org/wiki/Wikipedia:Verifiability
- MediaWiki, “API:Revisions”. https://www.mediawiki.org/wiki/API:Revisions
- MediaWiki, “API:Etiquette”. https://www.mediawiki.org/wiki/API:Etiquette
- Wikipedia, “Help:Citation Style 1”, for the citation template fields. https://en.wikipedia.org/wiki/Help:Citation_Style_1
- Wikipedia text shown on the page is from the linked articles and revisions, under CC BY-SA 4.0. https://creativecommons.org/licenses/by-sa/4.0/
- Type: Newsreader, by Production Type for Google Fonts, under the SIL Open Font License 1.1 (licence in `fonts/OFL.txt`). Self-hosted Latin subsets from Fontsource 5.2.10: the variable roman (weights 200–800) and the 400 italic. https://github.com/productiontype/Newsreader
