# Mirage

A small, made-up study of whether a morning walk improves mood. The visitor analyses it through six reasonable choices, reaches p < 0.05, and then sees the whole garden of forking paths they could have walked. The page lives at `projects/mirage/index.html`; this file keeps the full record and is not linked from the page.

## What it’s for

To show how a result that looks true can come out of nothing, with nobody cheating. Each decision in the walk is one an honest analyst might make for a good reason. The trouble is that the reasons are found after the data are in view, and noise always offers a few paths that look like a finding. The 5% error rate on a p-value only holds when the path was fixed in advance.

## The study as framed on the page

A hundred and twenty adults are split by lot into two groups of sixty. One group takes a twenty-minute walk every morning for two weeks; the other carries on as usual. Everyone keeps a two-week mood diary and, at the end, fills in a mood questionnaire and a single 0–10 rating. The page says up front that the data "may or may not" contain a real effect, and only reveals at the end that they are pure noise.

## Design choices

**Peeking is a fork.** The "Show p-values while choosing" toggle starts switched on, because that is how analysis usually goes: the numbers are on screen while the decisions are made, and each decision has a good reason of its own. Switching it off walks blind, the way a pre-registered analysis does.

**Why one path stays near 5%.** When there is no effect, a p-value is equally likely to land anywhere between 0 and 1, so one fixed test falls below 0.05 about one time in twenty. That is all the 5% promises. Every extra path is another draw. The paths share the same people, so they are far from independent, and 486 paths are not 486 separate tries, but they differ enough that the chance of at least one hit climbs well past 5%. Pre-registration means writing the path down before seeing the data. It removes the forks, not the noise. It does not make an analysis right, only honest about its error rate.

**The look.** The stage is an engraved botanical plate: cream plate paper with a platemark, sepia ink in fine rules and hatching, and printer’s vermilion used for one thing only, a result under p = 0.05. The garden is drawn as a plant on a cut stalk: each complete analysis ends in a slender leaf, and each significant one in a vermilion berry, so shape as well as colour marks it. The plate number is the number of noise studies the page drew before it found the one it shows (see "The first study is selected" below), so the file drawer is printed in the corner of the plate. Type is Old Standard TT, with the digits taken from IM Fell English because Old Standard has no old-style figures; both are SIL OFL fonts, self-hosted from Fontsource (Latin subset, about 109 KB in all) with the licence in `fonts/OFL.txt`.

**Page length.** At the owner’s request the page itself is only a back link, a title and one short paragraph. Everything a visitor needs to use the interactive is brief microcopy inside the stage; the longer explanation lives here.

## How I know

**What is modelled.** Every study is generated fresh from a seeded random number generator (mulberry32, with Box–Muller for normal draws). Each of the 120 participants gets an age, a night’s sleep, an attention-check result and a latent mood that is partly tied to sleep; the three mood measures share that latent mood, as real measures would, and are rounded and bounded like real scales. Only then are the group labels dealt, by a shuffle from a separate random stream, sixty and sixty. Nothing about the group touches any measurement. There is no effect to find.

**The tests.** The Welch t-test uses the Welch–Satterthwaite degrees of freedom, with the Student t distribution computed from the regularised incomplete beta function. The Mann–Whitney U test uses average ranks for ties, the normal approximation with the tie-corrected variance, and a 0.5 continuity correction, as R and scipy do by default. Regression is ordinary least squares with the group and, if chosen, one covariate, and a t-test on the group coefficient; with no covariate it is the classic pooled t-test. When you adjust and then choose Welch or Mann–Whitney, the test runs on scores with the covariate regressed out. Every p-value is two-sided.

**What is simplified.** Real forks are messier and more numerous: dozens of plausible outcomes, covariates and exclusion rules, and choices that depend on each other. Here every fork is crossed with every other, which gives 3 × 2 × 3 × 3 × 3 × 3 = 486 paths. The "analyst who peeks" is a simple rule: at each fork, take the option with the lowest p while leaving later forks at their plain defaults. Real people are less mechanical and often more inventive.

**The first study is selected.** The first study you see is not a random draw. The page draws studies until it finds one where the plain analysis finds nothing, the peeking analyst finds walkers happier at p < 0.05 but only at the fourth decision or later, and no single change to the plain analysis is enough on its own; it says how many draws it took. Without that last condition the walk often hinges on one choice, usually the outcome measure, and the other decisions do little. The selected study is not typical in its count of significant paths either; other noise studies give other counts, from none to more than a hundred, and "Walk again" shows others. That selection is the file drawer, and the thousand-study run shows how often it happens without any selection.

**What I checked.** Node tests in `tests/` (run `node projects/mirage/tests/run-all.js`) check that p-values match reference values to three decimals (for example t = 2.0 with 30 degrees of freedom gives 0.0546). scipy was not available, so the references come from a separate Python script (`tests/reference.py`) that integrates the t density numerically and re-implements each test independently, from closed forms for one and two degrees of freedom, and from printed t tables. The tests run all 486 paths on 3,000 fresh null datasets. Every path, taken alone, has a false-positive rate close to 5% (4.0–5.8% across paths; the pre-registered path 4.6%), and no more paths fall outside the 99% binomial interval than chance predicts when 486 paths are checked at once. The Mann–Whitney paths run a touch below 5% because of the continuity correction. Another test confirms that, in the first study, the peeking walk only reaches p < 0.05 at the fourth decision or later. They confirm that the "any path" share is counted from simulation and matches a recount, and that group labels are statistically and structurally independent of every variable.

**What would change the conclusion.** If the walk had a real effect, more paths would light up and the plain path would find it too; forking paths do not create effects, they create false ones. Fewer or more strongly correlated forks would shrink the any-path share; more forks would grow it. The numbers here belong to this toy design and should not be read as the false-positive rate of any real field.

## Sources

- Andrew Gelman and Eric Loken, "The garden of forking paths: Why multiple comparisons can be a problem, even when there is no ‘fishing expedition’ or ‘p-hacking’ and the research hypothesis was posited ahead of time", unpublished manuscript, Columbia University, 2013.
- Joseph P. Simmons, Leif D. Nelson and Uri Simonsohn, "False-positive psychology: Undisclosed flexibility in data collection and analysis allows presenting anything as significant", *Psychological Science* 22(11), 2011. https://doi.org/10.1177/0956797611417632
- Uri Simonsohn, Joseph P. Simmons and Leif D. Nelson, "Specification curve analysis", *Nature Human Behaviour* 4, 2020. https://doi.org/10.1038/s41562-020-0912-z
- Nate Breznau and many co-authors, "Observing many researchers using the same data and hypothesis reveals a hidden universe of uncertainty", *Proceedings of the National Academy of Sciences* 119(44), 2022. https://doi.org/10.1073/pnas.2203150119
- Jorge Luis Borges, "The Garden of Forking Paths", 1941, the story the title nods to.
