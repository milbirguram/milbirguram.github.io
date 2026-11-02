# Facade

A short drive through barn country and ten small cases, scored twice: once for being right, once for knowing.

## What it’s for

Being right and knowing are easy to run together, because from the inside they feel the same. Facade keeps two scores so you can watch them come apart. In most of its cases you can reason well, be right, and still not know, and the gap between the two numbers is the thing to notice.

## How it plays

- **The drive.** Barns pass a country road and you are asked about three of them. Then the view swings round: five are facades propped up on beams, and the one real barn looked exactly like them from the road.
- **The cases.** Each case is a still, illustrated scene. You pick things up in it (a phone screen, a clock face, a review page); each goes into your notes as a chip. Hunches appear as pencilled thought clouds. You commit by completing one sentence, “[your answer] — because [what you are going on]”, by dragging chips into the blanks or by choosing a chip and then a blank. Filing stamps the card; the scene turns round to show what was hidden; the verdict is Knew, Right by luck or Wrong, with one plain sentence on why.
- **The casebook.** A ledger beside the scene (a drawer on phones) records each filed sentence in pencil, then in ink once the case is revealed, with Right and Knew columns that build as you play. The last screen is the casebook open, with the two totals large.

The interface borrows interaction ideas, not art or text, from three games: completing a sentence from clues gathered in a frozen scene, handling evidence as physical objects on a desk and stamping a decision, and a logbook whose entries are confirmed only later.

## How I know

Each case is a small world written out in full in `cases.js`. For every answer and every piece of evidence you can pick, the file records two things: whether the answer is true, and whether that evidence is connected to the fact that makes it true. Connected means that if the fact had been different, the evidence would have been different too. Take away the cold and the thermometer does not read −4°C; take away the landing and the message is not sent.

`scenes.js` only draws. It holds the pictures and one hotspot per piece of evidence, and nothing about truth or tracking. The verdict always comes from `model.js`, reading `cases.js`.

The game scores by one rule, which I call the no-luck rule. If your answer is false, you were wrong. If it is true and the evidence you relied on is connected to what made it true, you knew. If it is true and the evidence is not connected, you were right by luck. This is a plain stand-in for several more careful ideas, among them causal theories of knowledge and the conditions philosophers call sensitivity and safety, which differ in the details and on some cases.

The opening barn is one of those cases. On a causal theory you knew it was a barn, because that real barn caused what you saw. The rule here asks a different question: had a facade stood in its place, would the view have been any different? It would not, so the game calls it luck. That is the point of Goldman’s 1976 paper, which used the fake barns against his own earlier causal theory.

Philosophers disagree about parts of this. Fake-barn cases are contested: some hold that you do know a real barn when you see one clearly, whatever stands around it, and surveys have found many people outside philosophy say the same. Some reject the starting point, that knowledge is justified true belief plus some further condition. Knowledge-first views treat knowledge as basic and explain evidence and justification in terms of it. The game takes one side so that it can keep score. It does not settle the question.

What is simplified: real evidence is rarely all or nothing, and people usually go on several things at once. Here you pick one. Each case has a single fact of the matter, written by me, and the scores are only as good as my judgement of which evidence is connected to which fact. Every one of those judgements is in the cases file, where you can check it. The scenes add small visual details (a gate number, a timer plug, a generic heading on a review site) that dress the story without changing what is true or what any evidence tracks. When a scene turns round, its caption says what the back shows, in pictures-only words written alongside the drawing; the verdict and its reason still come from `cases.js`.

One case is deliberately on the edge. In the forecast, the phone has no signal and is showing yesterday’s saved forecast; the story says you don’t notice the thin grey bar that hints at it, and the scene draws that bar without a label, so it is noticeable in hindsight rather than announced. Someone who thinks you should have noticed would call the belief unjustified, which makes the case plain luck rather than a Gettier case. The score is the same either way (Right by luck), but the label is contestable.

What I checked (run `node tests/cases.test.js`, `node tests/barns.test.js`, `node tests/scenes.test.js` and `node tests/preview.test.js`):

- The four Gettier cases are justified, true and lucky; the three ordinary cases are justified, true and not lucky; the two false cases are false; the one pivot case scores Knew or Right by luck depending on the evidence chosen; and every answer and evidence pair leads to exactly one outcome, the one written in the file.
- Every possible game (1,048,576 of them) is played and none scores more than four on Knew. The closing reflection is read for every play and names only the evidence actually chosen.
- Seen from the road, a facade and a real barn are drawn from exactly the same front: the drawing adds depth only when the view turns.
- Every piece of evidence in `cases.js` has exactly one hotspot in its scene and every hotspot names a real piece of evidence; hunches are drawn as thought clouds exactly when `cases.js` marks them as hunches; hotspots do not overlap and are at least 44 px with their touch margin on a 375 px phone; and the scenes file carries no truth values. No scene front names a hidden fact (no signal, the timer, the greyhound, the guardian dog, the stopped clock).
- Picking something up shows a close-up cropped so that any writing on it comes out at 12 CSS px or more, at phone and laptop slip sizes, with all of that writing in frame.
- The card preview’s “Right by luck” stamp is timed from the camera, not a separate clock, so it can only show while the real barn is on screen, swung round and labelled; this is checked across a range of frame shapes.

What would change the result: if you think justified true belief is enough for knowledge, every lucky answer that rested on evidence becomes Knew, while lucky hunches stay lucky. If you follow the evidence on offer all the way through, the two numbers then meet at eight. If you think a usually reliable kind of source gives knowledge even when this particular one has failed, the station clock and the forecast move across. If you think a well-trained hunch counts as evidence, some lucky answers in the false cases look different too.

## Sources

- Alvin I. Goldman, “Discrimination and Perceptual Knowledge”, *Journal of Philosophy* 73 (1976). The fake-barn case, which Goldman credits to Carl Ginet.
- Edmund L. Gettier, “Is Justified True Belief Knowledge?”, *Analysis* 23 (1963).
- Bertrand Russell, *Human Knowledge: Its Scope and Limits* (1948). The stopped clock.
- Roderick M. Chisholm, *Theory of Knowledge* (1966; second edition 1977). The sheep in the field.
- Jonathan Jenkins Ichikawa and Matthias Steup, “The Analysis of Knowledge”, *Stanford Encyclopedia of Philosophy*. https://plato.stanford.edu/entries/knowledge-analysis/
- Alvin I. Goldman, “A Causal Theory of Knowing”, *Journal of Philosophy* 64 (1967).
- Robert Nozick, *Philosophical Explanations* (1981). Sensitivity.
- Ernest Sosa, “How to Defeat Opposition to Moore”, *Philosophical Perspectives* 13 (1999). Safety.
- Timothy Williamson, *Knowledge and Its Limits* (2000). Knowledge first.
- Tamar Szabó Gendler and John Hawthorne, “The Real Guide to Fake Barns: A Catalogue of Gifts for Your Epistemic Enemies”, *Philosophical Studies* 124 (2005).
- David Colaço, Wesley Buckwalter, Stephen Stich and Edouard Machery, “Epistemic Intuitions in Fake-Barn Thought Experiments”, *Episteme* 11 (2014).

The scenarios and illustrations are my own. The clock, the sheep and the barns borrow their shapes from the cases above.
