# Trace

Purpose: help a reader find what code actually does without asking them to trust a fluent unsupported answer. Every recorded factual answer has a source span; credentials and live-production questions abstain when the snapshot cannot establish them.

The process worked backwards from that standard: choose a small real source corpus, make line-addressable retrieval work, capture actual model investigations, review every cited claim, then design the reader. The interface exposes the boundary between **recorded model answers** and **live lexical retrieval**.

## The record

Ten files and 1,977 lines from `milbirguram/milbirguram.github.io`, pinned to `80d4b9138e970e3409d32f408d379cc71f3dad3d`: Almanac's pipeline, workflow, browser model, README and selected tests. This is a bounded subset, not an index of the entire repository. No changing run data or credentials are included.

A real inherited Codex model session used the local search CLI for seven questions: twelve search calls, five answers and two abstentions. Its queries, top-five result IDs, segments, citations and exact prompt are preserved in `data/recorded-runs.json` with local paths redacted. Original capture SHA-256 is retained. No model tokens, billed cost or API inference latency were available. No new LLM answer is produced in the browser.

Retrieval: BM25, k1=1.2 and b=0.75, camel-case and word tokenisation with a fixed stop list; 36-line chunks starting every 26 lines (ten-line overlap). Path text participates in retrieval. Top five per query. Scores are lexical relevance, not confidence. All recorded searches rerun locally; the panel retains unique matches from follow-up searches too. New text performs search only and explicitly has no generated answer.

The reader opens exact lines, provides a pinned GitHub deep link, and shows each file's hash. Code takes priority over stale prose: the README's “workflow not installed” claim conflicts with the checked-in `.github/workflows/almanac.yml`. Scheduling configuration does not prove that a run happened this morning. An independent review checked every segment against the cited source and Git revision. Seven examples are not a general reliability benchmark.

## Reproduce and check

From the portfolio root:

```sh
python projects/trace/scripts/build.py
node projects/trace/tests/model.test.cjs
node projects/trace/scripts/search.cjs "freshness threshold"
```

The corpus builder needs the pinned portfolio Git object. `scripts/import-runs.py path/to/capture.json` imports an already captured research artifact, checks citation bounds and replays every search. It never fabricates model responses. The static corpus is included so normal use needs neither Git nor a server model.

Browser checks cover citation highlighting, file browsing, all seven questions, unknown text, search-only labeling, small screens and representative card frames. Local durations are elapsed retrieval/replay or search time, not model latency. The portfolio supplies `../kit.css` and `../kit.js`. No API calls, upload, storage or animation loop.

Vollkorn and Fira Code are self-hosted under SIL OFL; fixed package versions and hashes are in `fonts/sources.json`.
