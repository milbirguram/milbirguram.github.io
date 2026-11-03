# Trial

Purpose: test whether an agent's complexity earns a measurable improvement, and let someone inspect the cases behind the number. A tie is a result. The process fixed a task, cases, grading rules and cost definitions before presenting comparisons, then independently reviewed the benchmark's limits.

## Two explicitly different records

**Live diagnosis policies.** Three configurations of Faultline, run locally against 36 fixtures: six fault types × six numeric-detail seeds. There are only six distinct categorical decision problems; seeds do not provide independent fault mechanisms. Accuracy includes inconclusive cases as failures. “Unique” means one state remains under an exhaustive noiseless model. Cost is abstract tool units, not money or tokens. Mean local JS elapsed time includes policy and fixture observations; it is not API or model latency, varies by browser/hardware/timer resolution and is too small for a strong speed ranking.

The comparison includes an intentionally strong fixed logs-first checklist. It ties the adaptive policy's accuracy and tool cost for every available budget. At five units both score 36/36 with mean cost 2.667; the metrics-only quick guess scores 18/36 with cost one. A correct guess may still lack unique evidence. Every case opens the actual trace and simulator truth; raw runs can be exported. Changing the budget requires a rerun, so the displayed score always belongs to the completed run.

**Recorded SQL model outputs.** The same twenty Palmer-penguin questions, one inherited Codex model and three actual prompt setups. SQLite execution checked seventeen results and three abstentions per setup; all scored 20/20. No setup wins. The verification condition actually executed SQL and made no revisions. Tokens, billed cost and API latency remain unavailable. Batch timestamps include scheduling/tool/file I/O, not inference time. Captured answers, expected and actual rows and exact prompts are inspectable; links open the corresponding live Query case.

Both are small, visible demonstrations, not claims of general agent reliability, production incident quality or prompt-injection protection. The static site makes no model calls.

## Reproduce

```sh
python projects/trial/scripts-sync.py
node projects/trial/tests/model.test.cjs
```

The sync script copies the exact Faultline engine and Query capture into this project for a standalone runtime, with hashes and protocol in `data/provenance.json`. The tests check engine provenance, known suite results and truthful null metadata. Source project tests independently exercise the policies and execute all SQL with actual SQLite WASM. Browser QA covers budgets, reruns, failure filters, traces, both suites, deep links, export, mobile and previews.

Serve the portfolio root; shared frame styles/runtime are `../kit.css` and `../kit.js`. All assets are local. Preview performs one finite evaluation, then remains still. Public Sans and Red Hat Mono are self-hosted SIL OFL with package versions and hashes in `fonts/sources.json`.
