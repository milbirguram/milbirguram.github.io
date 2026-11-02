# Almanac

A small data pipeline meant to run every day on public Canadian open data. It answers one question, how many hours the air has been high-risk in seven western Canadian cities, and it publishes its own health next to the answer: every run, every check of its data contract, and how fresh the data is. The page is `projects/almanac/index.html`; this file keeps the full record and is not linked from the page.

## What it’s for

Most pictures of a data pipeline are diagrams. This one is a working pipeline that keeps a public record of itself, so a visitor can see whether to trust the number at the top: which days ran, which ones broke a promise about their data, whether anything was refused, and whether the whole thing has quietly stopped. If it stops, the page says “stale” and shows the missing days, rather than going on showing an old answer as if it were current.

## The source and the question

**Dataset.** Environment and Climate Change Canada (ECCC), Meteorological Service of Canada: Air Quality Health Index (AQHI) observations, from the MSC Datamart (`dd.weather.gc.ca`). Two products are used, both CSV with one column per AQHI location and one row per UTC hour:

- the live hourly file, `…/{YYYYMMDD}/WXO-DD/air_quality/aqhi/{region}/observation/realtime/csv/{YYYYMMDDHH}_AQHI_{REGION}_SiteObs.csv`, republished every hour and holding the last 168 hours;
- monthly archives, `…/today/air_quality/aqhi/{region}/observation/monthly/csv/{YYYYMM}_MONTHLY_AQHI_{REGION}_SiteObs.csv`, plus a corrected `…_BACKFILLED.csv` version published about three days after each month ends. The listing goes back to at least July 2025.

Regions are `pyr` (British Columbia and Yukon) and `pnr` (Prairies and the North). A day's two regional files are about 25–30 KB each (hourly) or 100–140 KB (monthly).

**Why this source.** It updates hourly, has a stable machine-readable path, has history for a backfill (the monthly archives), is free to reuse under a published licence, and it answers a question people in the West care about every summer: how much wildfire smoke did we breathe. I first tried the MSC GeoMet OGC API (`api.weather.gc.ca`, collection `aqhi-observations-realtime`); on 2 November 2026 it held only about three days per location, too little for a backfill, so the Datamart CSVs are used instead.

**Licence and attribution.** Environment and Climate Change Canada Data Services End-use Licence (version 2.1.1, August 2026). It allows copying, adapting and publishing, provided the source is acknowledged with the attribution statement and, where possible, a link to the licence. The page says “Data Source: Environment and Climate Change Canada” and links the licence in its one paragraph. It must not suggest endorsement, and it does not use ECCC’s name as branding.

**Cities.** Seven AQHI locations: Vancouver (Metro Vancouver – NW, `JBRIK`), Victoria (Victoria / Saanich, `JBOBQ`), Kelowna (Central Okanagan, `JAFUV`), Kamloops (`JAFNW`), Prince George (`JBLVS`), Calgary (`IAKID`) and Edmonton (`IACMP`). An AQHI location is a community value; Vancouver is represented by the north-west zone of Metro Vancouver only.

**The question, exactly.** For each city, the number of UTC hours since the record began (4 August 2026) whose AQHI reading, rounded half up to a whole number as ECCC reports it, is 7 or more. ECCC’s categories: 1–3 low risk, 4–6 moderate, 7–10 high, 10+ very high. The CSV writes 10+ as 11, so “high-risk” here includes 10+. A reading counts when it is 6.5 or above.

## The pipeline

`pipeline/run.py`, Python 3.11 standard library only, so it runs the same locally and in GitHub Actions:

```
python -I projects/almanac/pipeline/run.py --date 2026-11-01
python -I projects/almanac/pipeline/run.py --backfill 2026-08-04 2026-11-01
python -I projects/almanac/pipeline/run.py --aggregate-only
```

Options: `--kind` (scheduled, manual, backfill, revision; defaults are inferred), `--source auto|hourly|monthly`, `--now` (inject the clock), `--data-dir`, `--source-dir` (read files from disk instead of the network, for tests and replays), `--pause` (seconds between requests, default 1).

1. **Extract.** For each region, the live hourly file if the day is within the last 6 days, otherwise the corrected monthly archive if it exists, otherwise the first monthly archive. One request at a time, one-second pauses, three tries with back-off, a descriptive User-Agent, and each file fetched once per run.
2. **Validate.** `pipeline/contract.py` applies `pipeline/contract.json`, the data contract written as data. Seven checks: schema (expected columns present), types (dates, hours 0–23, numeric or blank readings), range (1 to 11; odd values quarantined, more than 1% fails the day), uniqueness (one reading per city-hour; exact repeats warn, conflicting ones fail), completeness (all 24 hours in the file), volume (each city at least 18 of 24 hours, else a warning; under half of the 168 expected readings fails) and freshness (the live file’s newest hour at most 6 hours old, else a warning; not applicable to an archive). The day’s status is the worst check: green, amber or red.

   When there is no source file at all, no check pretends to have looked at it. If the run wanted the live feed (the day is within 6 days) and found no hourly file in the last 8 hours (`hourly_lookback_hours`) and no monthly archive for the day, the freshness check fails with “the feed seems to have stalled” and the other six are marked “not run”. If it wanted an archive and none exists, the completeness check fails instead. Before a verification pass this case showed up as a schema failure with freshness skipped, which blamed the wrong thing; the stalled-feed and missing-archive tests now pin it down.
3. **Load.** Only when the day is not red: `data/raw/YYYY-MM/YYYY-MM-DD.{pyr,pnr}.csv` (that day’s rows exactly as received), `data/validated/YYYY-MM/YYYY-MM-DD.csv` (one row per city-hour: date, hour, location, city, value, reported value, high-risk flag) and `data/quarantine/…` for readings set aside. A red day writes nothing to raw or validated, so earlier good data for that day is kept, still counted in the answer, and marked as kept on the calendar, in its tooltip and in the readings chart (a ring under the bar).
4. **Aggregate.** `data/aggregates/summary.json` (the answer, per city and per day), `health.json` (calendar of runs, lineage counts, the SLO, known issues; the last 90 days keep a full entry with run id, times and each check’s result in words, and older days are packed into short tuples, `calendar_old`, that `model.js` unpacks) and `preview.js` (a tiny snapshot for the projects card). The page loads only these.
5. **Log.** Every run, including a failed or crashed one, appends a record to `data/runs.ndjson`: run id, batch id, kind, day, start and finish, source URLs and bytes, rows in and out, quarantined count, every check’s result and detail, bytes written, notes and the commit.

**Idempotent.** Partitions are written whole, sorted and with fixed line endings, and the summary has no timestamps. Rerunning a day on the same source gives byte-identical raw, validated and summary files; only the run log grows (by design: a rerun is a run) and `health.json`, which reports the log.

**Schedule.** `pipeline/almanac.yml` is a GitHub Actions workflow: daily at 07:17 UTC (the previous UTC day is complete by then), manual dispatch with an optional day or backfill range, a concurrency group, a 15-minute timeout and only `contents: write`. It runs the Python contract tests first, processes yesterday, and on the 4th of each month reloads the previous month from ECCC’s corrected file as a “revision”. It commits only when something under `projects/almanac/data` changed; the run log changes on every run, so in practice every run is committed, which is what lets the page show it. If the contract failed, the data is still committed and then the job is marked failed. The owner’s token lacks the workflow scope, so the file is not in `.github/workflows`; the install line is at its top.

**Budgets.** 90 days take about 2.2 MB on disk (raw 0.76 MB, validated 0.55 MB, run log 0.14 MB, aggregates 73 KB), so about 9 MB a year, under the 20 MB budget. The aggregates are 73 KB against a 200 KB budget. They used to grow by about 300–650 bytes a day and would have passed the budget after about 14 months; now days older than 90 are packed (about 45 bytes each), the daily maximum is stored as the reported whole number, and `tests/test_budget.py` builds two years of runs and asserts the total stays under 200 KB (it is about 150 KB). At roughly 45 KB a year, the summary should be split by year before the record reaches three years. The launch backfill downloaded 0.79 MB.

## The page

Back link, title, one paragraph; everything else is in the stage. The answer: a city chooser that doubles as a ranking, one big number, a sentence giving its denominator (hours that had a reading), a warning when a city’s coverage is under 90%, and a bar chart of high-risk hours per day that adds up to the big number, with a mark under days where the city had fewer than 18 readings. The health panel: a freshness clock and its rule; a tally of runs; a calendar with one square per day (status is carried by shape, like the moon-phase marks in a printed almanac: a full disc passed, a half disc warned, a struck ring was refused, a point means no run; a boxed mark ran on schedule, an unboxed one was backfilled; 22 px squares on desktop and 24 px on a phone, where the calendar scrolls sideways); the selected day’s contract results in words, each with a “what this promise means” line; a chart of readings loaded per day against the 168 expected and the 84 refusal line; a lineage strip from source to raw to contract to validated to aggregates, with live counts; and the known-issues log from `pipeline/known_issues.json`.

**Look.** The stage is set as a two-colour almanac sheet: cream stock with a light paper grain, black ink, and one spot colour, wildfire-smoke orange (#d9662a), used only for high-risk hours (the bars, the rule under the headline number, the screen behind “high-risk”). Everything else, including pass, warning and refusal, is told by shape and words in black, so the only colour on the page means smoke. Type is Libre Caslon Text and Libre Caslon Display (SIL Open Font License, self-hosted in `fonts/` with `OFL.txt`, about 100 KB). The card preview prints the same marks into the calendar day by day while the orange bars rise.

**Freshness, honestly.** Fresh means the newest hour is at most 36 hours old and the last run finished at most 26 hours ago (`contract.json`, `slo`). The page computes this from the visitor’s clock, not the pipeline’s. It also adds “no run” squares for every day after the last logged one up to yesterday, so a stopped pipeline shows its gap instead of hiding it. `?now=2026-11-05T12:00:00Z` sets the page’s clock for testing.

**Preview.** On the projects card the run calendar fills in day by day while the high-risk bars draw and the total counts up, from `preview.js` (the last 91 days only, so the squares stay legible); no requests, and a full still frame when paused. Its caption counts the scheduled runs among those shown, so it will stop saying “all backfilled” once the schedule runs.

**What the page claims about itself.** The calendar, contract results and counts come from the pipeline’s log; the freshness verdict and the “no run” squares are worked out by the page from the visitor’s clock; the known issues are written by hand. The page says so in those words. The tally’s sentence about which check causes most warnings is counted from the calendar, and only shown when one check causes most of them.

**Not yet running on a schedule.** At launch all 90 days came from one backfill (batch `backfill-20261102T033929Z`); the workflow has not run in GitHub Actions yet, so the page will turn stale about a day after launch. That is the honest state, and it is the first known issue. The owner should move `almanac.yml` into `.github/workflows`, start it once by hand from the Actions tab, and only then describe the project as running every day.

## How I know

**What was checked, and how.**

- `tests/test_contract.py`: each of the seven checks passes a clean crafted day and catches a crafted violation (renamed column, text in a reading, an hour of 25, out-of-range values below and above the 1% line, 10+ as 11, conflicting and exact duplicates, missing hours, a missing day, a quiet city, a mostly empty day, a stale feed, an unknown feed age, an archive source).
- `tests/test_pipeline.py`: end to end on crafted files with `--source-dir`: rerunning a day and a backfill gives byte-identical partitions and summary; backfill runs are labelled and share a batch id; a red day is logged, exits 2 and leaves the earlier validated data untouched; a missing archive is a red completeness failure, not a crash; a stalled live feed (no hourly file) fails freshness, not schema, with the other checks not run; a live file 7 hours old warns; a refused rerun records that the earlier load is kept; a day that is not over is refused.
- `tests/test_budget.py`: two years of runs, cycled from the real log and partitions, keep the aggregates under 200 KB, and packed old days unpack to the same entries as full ones.
- `tests/recompute-headline.js`: an independent Node script recounts each city’s high-risk hours from the stored validated CSVs (and, separately, from the raw slices as ECCC wrote them), and checks both against `summary.json` and against the sum of the chart’s bars. All seven cities match (Kamloops 137, Kelowna 61, Calgary 17, Edmonton 11, Vancouver 9, Prince George 1, Victoria 0, from 14,240 stored readings).
- `tests/freshness.test.js`: with an injected clock, fresh just inside the 36-hour limit, stale one minute past it, stale when only the run is too old, both reasons when both are, stale with no data; and the page adds “no run” days after the last logged one.
- `tests/model.test.js`: calendar layout, unpacking of old days, each day’s colour is the worst of its checks, the kept-earlier wording, the counted cause of warnings, the headline equals its bars, the aggregates are under budget.
- Run all with `node projects/almanac/tests/run-all.js`.
- Real-data idempotency: I copied the data folder, reran 10 September 2026 against the live server, and diffed: only `runs.ndjson` and `health.json` changed.
- I compared ECCC’s first and corrected September files for the BC and Yukon region: the corrected one filled 636 blank city-hours and changed 257 values. That is why the workflow reloads each month on the 4th, and why October is listed as a known issue.
- In a browser: desktop and 375 px widths, the `?preview` card on projects.html, keyboard use of the calendar and charts, the stale state with an injected clock, and no console errors.

**What is simplified.**

- The record starts on 4 August 2026, because the launch backfill was capped at about 90 days. The counts are hours since then, not hours this year; July 2026 alone had 119 high-risk hours in Kamloops by ECCC’s corrected file.
- One AQHI location stands for each city. Metro Vancouver’s other zones, for instance, can differ.
- Readings are ECCC’s real-time values, which it says are not quality-controlled. Missing hours are not filled in, so a city with gaps (Kelowna most of all) has a count that is a floor.
- Days are UTC days, not local days.
- The volume threshold (18 of 24 hours per city) is a judgement: fewer readings can hide high-risk hours. With it, 36 of the 90 backfilled days are amber, 31 of them because Central Okanagan (Kelowna) or Kamloops went quiet. I did not loosen it to make the calendar greener.
- The AQHI is a relative-risk index built from ozone, PM2.5 and NO2; this project counts its hours and makes no health claim beyond ECCC’s category names.

**What would change the conclusion.** ECCC’s corrected monthly files can fill gaps and revise values, so October’s counts may move after the revision run. Extending the backfill to 1 January (one command; the archives are there) would turn “since 4 August” into “this year” and add July’s smoke. A change to the AQHI formula or to how the CSV encodes 10+ would be caught by the range check before it changed a count.

**Local note.** On the machine that ran the backfill, the installed Python had no certificate store, so `run.py` was run with `SSL_CERT_FILE` pointing at Git for Windows’ CA bundle. GitHub’s Ubuntu runners do not need this.

## Sources

- Environment and Climate Change Canada, Meteorological Service of Canada. “Data and Products of the Air Quality Health Index (AQHI) observation and forecast.” MSC Open Data documentation. https://eccc-msc.github.io/open-data/msc-data/aqhi/readme_aqhi_en/
- Environment and Climate Change Canada. “Environment and Climate Change Canada Data Services End-use Licence,” version 2.1.1, August 2026. https://eccc-msc.github.io/open-data/licence/readme_en/
- MSC Datamart, AQHI observations, `https://dd.weather.gc.ca/today/air_quality/aqhi/` (hourly and monthly CSV), accessed 2 November 2026.
- MSC GeoMet OGC API, collection `aqhi-observations-realtime`, `https://api.weather.gc.ca/collections/aqhi-observations-realtime`, examined 2 November 2026 and not used (about three days of history).
