# Faultline

Purpose: reach a diagnosis only when the available evidence distinguishes it, while spending a declared tool budget. The useful outcome includes stopping with uncertainty when evidence is insufficient.

The process defined that stopping rule first, built a finite falsifiable service model, separated simulator truth from the policy's observation input, compared policies, then made each decision inspectable. This is a **live deterministic diagnostic agent**, not an LLM and not a replay. It is a closed-world experiment rather than a production incident responder.

## Model and policies

Six exhaustive states, exactly one true: healthy, database pool exhausted, worker backlog, upstream timeout, payload schema mismatch, stale cache. Seven tools return deterministic categorical signals with generated numeric/text detail. Logs and metrics cost one abstract unit; targeted probes cost two. The policy receives only the tool callback and observations, never the selected truth. Source is public; the truth is hidden from the policy, not a secret from visitors inspecting code.

Each observation removes states whose predicted signal differs. A singleton identifies the state **within this model**. Equal priors and noiseless signatures are assumptions, not learned production knowledge. The adaptive policy maximises expected candidate elimination per unit; a fixed logs-first checklist stops at a singleton; a quick policy reads metrics and guesses. Tool choices, outputs, elimination, spend and conclusion can be inspected and exported. Visitors can take manual probes too.

The fixed checklist and adaptive policy tie on all budgets in this small suite. At five units both identify all six fault types at mean cost 2.667, versus 50% correct guesses for the quick policy at cost one. This result does not justify a more elaborate policy. Trial shows the actual comparison.

There are no compound faults, noisy sensors, unknown fault types, real services or remediation. A log includes untrusted request text, but policy logic ignores free-form details entirely. This demonstrates input separation, **not prompt-injection resistance**. The service graph and latency chart describe generated fixture data. No network or model API is used.

## Checks

```sh
node projects/faultline/tests/model.test.cjs
```

733 assertions cover every state × policy × budget, budget discipline, no repeated tools, truth retained under observation, singleton correctness, malformed calls, baseline ties and the six distinct categorical paths across 36 detail seeds. Browser QA covers stepwise and full runs, manual tools, exhausted budgets, guesses, reset, reveal, export, mobile and compact previews.

The portfolio supplies `../kit.css` and `../kit.js`. Preview runs one finite investigation and remains still, with no animation loop. Chakra Petch and Sarabun are self-hosted SIL OFL; package versions and hashes are in `fonts/sources.json`.
