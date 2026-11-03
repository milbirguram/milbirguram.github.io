# Query

Purpose: let someone ask a modest question of real data and inspect the evidence behind the answer. Success means the SQL is visible, actually executable, and checked against the requested units and scope. An unsupported causal or population claim should end in abstention.

The process began with that outcome, chose one small public dataset, captured real model outputs, independently graded them, then built the interface around the evidence. It did not begin by adding agent roles. The result is a no-key static demonstration: **recorded LLM planning, live SQLite tools**, plus an explicitly separate local rules planner.

## What runs

- 344 Palmer penguin samples, three species, three islands, 2007–2009. Original CSV row order supplies an `id`; source `NA` becomes SQL NULL.
- Three actual planning batches from the inherited Codex session model: schema only, schema plus guidance, and schema with SQL verification tools. 20 fixed questions, 17 SQL and three abstentions, each answered once per setup. The verified batch made 18 SQL tool calls (one read-only connection setup and 17 result queries), with no revisions. All three scored 20/20. This is a ceiling on a small visible set, not a winning-prompt or reliability claim.
- The browser executes the selected or edited statement in sql.js 1.13.0, in a Web Worker with an in-memory read-only database. One SELECT or read-only CTE, no comments or multiple statements, 6,000-character limit, 200 displayed rows, a 1 MB output budget, a 32 MiB SQLite heap limit and 1.5-second execution timeout. A timed-out worker is terminated and recreated on the next query. This is a local fixture sandbox, not a general SQL service.
- The local planner matches a documented grammar: `average body mass|flipper length|bill length|bill depth` or `count samples`, optional `by species|island|year|sex`, optional `for Adelie|Chinstrap|Gentoo`. Other wording clarifies rather than silently dropping filters. It is not an LLM.

The trace distinguishes supplied schema, captured decision, live execution and live comparison against the fixed expected result. New local questions have no independent answer oracle. An edited statement can run successfully while failing the original question's result check. Summaries are captured decisions or descriptions of returned cells, never fabricated fresh LLM text. CSV export protects string cells that could be interpreted as spreadsheet formulas.

## Evidence and limits

`data/recorded-batches.json` preserves outputs, exact prompts with machine paths redacted, real tool results for the verified batch and fresh grading results. Original capture artifact hashes are retained in provenance. Token usage, billed cost and API latency were not available and remain null. Capture batch duration includes concurrent scheduling and file/tool I/O; it is not inference latency. These were model-session research batches, not direct API benchmark calls.

Grading compares rows, ignores aliases and uses requested ordering for the top-three query. Integer expected values are exact; other numbers allow max(0.01, 0.1% of expected). Every expected question ID must appear exactly once. An independent review re-executed all 51 SQL outputs and checked all nine abstentions. The data describes observations, not all Antarctic penguins; confounding prevents causal island claims.

## Reproduce

From the portfolio root, with Python 3.10+ and Node 18+:

```sh
python projects/query/scripts/build.py
node projects/query/tests/model.test.cjs
node projects/query/tests/state.test.cjs
python -m http.server 8140
```

The default builder regrades the published capture and CSV. To import original research captures, pass a directory with `bare.json`, `guided.json`, `verified.json`, `questions.json` and `penguins.csv`. It does not generate new model responses. Browser worker verification: `/projects/query/tests/review.html` (66 checks). UI QA also covers CTEs, abstention, SQL failure/recovery, timeout, CSV export, mobile and both card sizes.

The portfolio provides `../kit.css` and `../kit.js`; serve from its root. The preview uses captured output and never starts SQLite or an animation loop.

## Sources

- Palmer penguins, Horst, Hill and Gorman (2020), collected by Gorman and Palmer Station LTER; CC0. [Dataset and citation](https://allisonhorst.github.io/palmerpenguins/). Exact upstream commit, CSV hash and question hash: `data/provenance.json`.
- [sql.js](https://github.com/sql-js/sql.js), MIT; SQLite public domain. Vendored files and SHA-256 hashes: `vendor/sources.json` and `vendor/LICENSE.txt`.
- Lora and Roboto Mono, self-hosted SIL OFL, pinned Fontsource packages: `fonts/sources.json` and per-font licence files.
