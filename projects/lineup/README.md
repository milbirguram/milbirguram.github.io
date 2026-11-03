# Lineup

## What it is for

Help a visitor explore which NHL team's measured five-on-five gaps a skater's recorded strengths could complement, and see how changing the purpose changes the answer. The output is an explained analytic fit index, not a probability of winning, a trade recommendation or a claim about chemistry.

## How I know

The static browser application includes 678 skaters with at least 300 five-on-five minutes in the completed 2025–26 regular season and all 32 team profiles. The source's single team label is a historical snapshot, not a verified current roster. It may attach a traded player's whole season to one label. Team needs therefore use the actual **team CSV**, never totals reconstructed by grouping players. Goalies and special teams are excluded.

Four dimensions serve the purpose: individual unblocked attempts per 60; xG per 100 unblocked attempts; goals minus xG per 60; and off-ice minus on-ice xGA per 60. The final dimension retains teammate, opponent and deployment effects. It is context, not isolated defence. Shot quality describes chances taken, not an ability to finish them. Primary assists and shot events are available in the source but passing skill, tracking and chemistry are not inferred.

Player profiles pool counts and denominators across 2023–24, 2024–25 and 2025–26 with recency weights 0.3, 0.6 and 1. Each rate is shrunk towards its latest-season forward/defence mean by `minutes / (minutes + prior)`, then standardised using that group's unshrunk mean and standard deviation, capped at ±4 SD. Peers are unweighted eligible players, not an ice-time weighted average. Profiles can therefore be above/below the average even where a raw rate looks small. The percentile display ranks the resulting profile among its position group. A disabled regularisation checkbox shows the unshrunk alternative.

Team metrics are corresponding team unblocked attempts/60, xG/100 attempts, goals−xG/60, and **negative** xGA/60. Team means/SDs are across 32 clubs. Need is `min(3, max(0, −teamZ))`; an above-average dimension has zero need. Fit is `sum(normalised user priority × team need × playerZ)`. Negative terms count against the match. Priorities default to equal and are a declared judgement, not learned definitions of “best”. There is no salary, roster-slot or positional vacancy constraint; forwards/defencemen are benchmark groups. The listed team is excluded by default. Scores have index units, not goals or percentage chances. If every score is non-positive the UI says the lens finds no positive complement. Ties sort by team abbreviation; close leaders receive a near-tie notice.

Shrinkage priors `[300, 600, 2400, 2400]` minutes were selected separately per dimension from the declared grid `[0,300,600,1200,2400]` on 2023–24 → 2024–25 (505 players). The later 2024–25 → 2025–26 holdout has 492 continuing skaters with ≥300 prior-season and ≥600 next-season five-on-five minutes, unchanged position group. Standardised four-feature RMSE is 0.904735 without shrinkage and 0.816931 with it. This is a **profile estimation check**, not validation of team fit. It excludes dropouts. Historical CSVs were downloaded now, not archived at each past forecast date; MoneyPuck does not identify the xG model version in each row, so this is not a pipeline-wide leakage-free forecasting claim. Only prior selection is tested against holdout leakage.

The stability check drops each available player season in turn while keeping team needs, baseline and priorities fixed. It reports whether the same leader remains; it is not a confidence interval. Contracts, cap space, trade cost, health, coaching intentions, deployment, passing and linemate chemistry would be needed for a real roster decision.

## Reproduce and check

From the portfolio root:

```
python projects/lineup/scripts/build-data.py --cache C:/path/to/raw-cache
node projects/lineup/tests/run-all.js
python projects/lineup/tests/audit-data.py C:/path/to/raw-cache
```

The builder uses only the Python standard library, curl and Node. It retains raw files in the chosen cache, exports a compact browser snapshot, source URLs/hashes/file dates, the prior grid and validation results. File-modified dates describe cache files, not an asserted provider publication time. `builtAt` is separate. The app has no runtime third-party requests. The full CSVs are not published.

Checks independently rederive every exported number from the raw CSV, hand-check time units and denominators, weighted pooling, shrinkage and signed contributions; enumerate all 678 × 31 candidate scores; verify deterministic ranking, team exclusion, finite ranges, priority changes and temporal prior-selection isolation. `tests/browser.html` checks preview lifecycle and mobile overflow. Browser checks cover search, empty results, filters, objective controls, own-team inclusion, regularisation and the evidence drawer. No measured transfer-success claim is made.

## Sources and permissions

- [MoneyPuck data and usage permission](https://moneypuck.com/data.htm): listed downloads are free for non-commercial use with clear MoneyPuck.com credit. Other uses require permission. This is **not an unrestricted open-data or open-source licence**; application code, data and font licences are separate. No affiliation or endorsement is implied.
- [MoneyPuck glossary](https://moneypuck.com/glossary.htm) and [xG methodology](https://moneypuck.com/about.htm).
- The exact CSV URLs, checksums and snapshot metadata are in `data/sources.json`; skaters 2023/2024/2025 and teams 2025 are used. The provider data dictionary was inspected during design. Player bios and line/shot files are optional future sources, not hidden inputs.
- Oswald and Source Sans 3 are self-hosted under SIL OFL; fixed versions and hashes are recorded in `fonts/sources.json`.

Serve the portfolio with `python -m http.server 8139`. The project expects the shared `../kit.css` and `../kit.js`. Its nine-second preview cycles three real player profiles, starts complete, credits MoneyPuck and follows `Kit.onPlay`; paused/reduced-motion cards have no animation loop.
