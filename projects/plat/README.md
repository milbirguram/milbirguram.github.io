# Plat

A survey plat of Vancouver's 22 local areas, tinted by the median assessed value of land, of buildings, or of both, for every roll from 2006 to 2026. Scrub the years, switch between dollars as assessed and real (inflation-adjusted) dollars, and between ordinary lots and strata units. Click an area for its record: the median over time with its interquartile band, the number of properties behind it, and the new-building permits issued there.

## What it’s for

A visitor should be able to see where assessed land value and building value moved across Vancouver, how much of that movement is inflation, and how many properties and how wide a spread stand behind each median. The page also says plainly what the map cannot tell them. It answers the question an old course proposal (CMPT 767, 2020) asked and never answered, and folds in an older undergraduate interest in watching a city build.

In one line, what the data say: across the whole city, the real median land value of an ordinary lot rose from $668k (2006 roll, in 2025 dollars) to $1.87M (2026 roll), about 2.8 times; the real median building value of the same lots rose only about 1.6 times, from $125k to $205k. For strata units the land share rose 2.3 times and the building share 1.2 times. Most of the growth in assessed value is in land.

## How I know

### What is computed

For each local area, roll year (2006–2026) and kind of property (lot or strata unit): the number of properties, and the 25th, 50th and 75th percentiles (DuckDB `quantile_cont`) of land value, improvement (building) value, and their sum per property. The page derives real values by multiplying every figure for a roll by one CPI factor; that is exact for percentiles, because scaling every property in a year by the same positive number cannot change which one sits in the middle.

- **Real dollars.** A BC Assessment roll for year Y values property as of 1 July of Y − 1 (the Assessment Act's valuation date). So a roll is deflated with the Vancouver all-items CPI annual average of its valuation year, and expressed in dollars of the latest valuation year (2025 for the 2026 roll). Example: the 2006 roll's city median land value of a lot, $439,000, becomes 439,000 × 161.4 / 106.0 = $668,439.62 in 2025 dollars.
- **Colours.** Seven classes with equal numbers of area-years (pooled over every year for the chosen view), so a colour means the same dollar range in every roll and a darker wash always means a higher median. Equal-count classes stop Downtown's commercial lots from stretching the scale. Every value is also printed in the field book, so colour is never the only signal.
- **Withheld cells.** Any area-year-kind with fewer than 10 properties is not published; the page hatches it. With this data no area cell falls below 10, but the rule is enforced and tested.

### The pipeline (`pipeline/`)

`fetch.py` downloads, one request at a time, into a directory outside the repo. `build.py` turns those files into `data/plat.json` (81 KB) and `data/preview.js` (7 KB, the card). Both are deterministic: rebuilding from the same downloads was checked to give byte-identical files.

1. **Ingest and normalise.** The City publishes the tax report as four datasets: `property-tax-report-2006-2010`, `-2011-2015`, `-2016-2019` and `property-tax-report` (2020 on). Column changes found and handled: `previous_land_value` and `previous_improvement_value` are empty text in 2006–2010 and integers later (the City notes they do not exist before 2014); `note` exists only from 2020; column order differs between files; `tax_assessment_year` and `report_year` are text everywhere and are cast to integers; zoning columns are empty before 2020 and unused. All 4,255,337 rows are unioned under one schema.
2. **Deduplicate.** `SELECT DISTINCT *` over every column removes exact duplicate rows and nothing else. The parcel key was checked first: PID is not unique within a year (a PID can carry several folios, and some rows have no PID), while folio is unique within every report year. There were no exact duplicates and no repeated folio-year keys in this download. Rows that share a folio and year but differ anywhere would be kept and reported, not merged.
3. **Which year.** The documentation defines `tax_assessment_year` as the year the values are in effect and `report_year` as the year the row was extracted, so they are not interchangeable. In this data they never disagree when both are present; where `tax_assessment_year` is blank (52,578 rows, from 2014 on) the folio was not assessed that year and its values are blank too. Those rows are dropped, not imputed. 251 further rows with zero total value are dropped. 4,202,508 property-years remain. Nothing is imputed, and the free-text legal-description columns are never used.
4. **Local areas.** The data's `neighbourhood_code` is BC Assessment's code, not the City's local area: of its 30 codes only 7 fall inside a single local area, and 15% of 2026 properties lie outside their code's main area. So each property is placed instead through its `land_coordinate` (the first 8 digits of the folio), which matches `tax_coord` in the City's parcel dataset; the parcel's point is placed in a local-area polygon (even-odd ray casting). The lookup is reduced to one row per `tax_coord` before the join, because every unit of a strata plan shares one coordinate and a direct join would repeat rows. 96.6% of 2006 properties and 100.0% of 2026 properties are placed; the rest are on lots that no longer exist in today's parcel map (subdivided, consolidated or redeveloped). They count in the whole-city figures only.
5. **Strata.** `legal_type = 'STRATA'` rows are strata units; `LAND` and `OTHER` are lots. Strata units carry their own share of the land under the building (units of one plan have different land values). A few plans also have a zero-value common-property row (111 `LAND` rows that share a coordinate with strata units, over all 21 rolls, against 3,589 strata coordinates in 2006 and 6,998 in 2026), and the zero-value filter drops those. Units and lots are kept in separate figures and nothing is summed across properties, so no land is counted twice.
6. **Permits.** New-building permits (`typeofwork = 'New Building'`) by the City's own `geolocalarea` and issue year, from 2017. Only the permit number, year, type of work and area are downloaded: no addresses, applicants or contractors.

### Checks (`tests/`)

- `node tests/test_model.js` — 13 checks: (d) CPI deflation against a hand calculation and the CPI values read from the StatCan table; (e) no published cell below the threshold, withheld cells carry no values, the model returns nothing for them; the JSON has no folio, PID, address, plan or owner fields; percentile triples are ordered; real figures are nominal times one factor per year; colour classes are equal-count and monotone; the card uses the same classes as the page, and shows the city's median land and median building value as two bars on one scale, never stacked (a median of land plus building is not the sum of the two medians).
- `node tests/test_page.js` — 7 checks on the words: the lede stays short; the meta description and the lede count the rolls the same way as the data; both licence attributions are in the lede, Statistics Canada's in its required form with the reference years; the two main caveats sit beside the map; the page describes the CPI as the model applies it; every file the pipeline's docstrings name exists.
- `python -I tests/test_pipeline.py RAW_DIR` — (a) on a fixture, exact copies are removed and rows differing in any column (even only an address) survive; on the real data, the rows removed equal an independent count of exact duplicates (GROUP BY every column). (b) On a fixture, a three-unit strata plan with three parcel points stays three rows (a naive join makes ten) and its median land is a unit's own share; on the real data, each folio appears once per year, no property is in both kinds, and published counts over all areas equal the placed properties. (c) Three randomly chosen area-year-kind-measure medians are recomputed from the raw parquet files by an independent path (its own winding-number point-in-polygon on the unsimplified outlines, its own filters, DuckDB `median()`), and must match `plat.json` to the dollar, with the same count.

All three pass. The page was checked in a browser at 1280 px, 800 px and 375 × 812, and the card at 320 × 200 and 520 × 325, with no console errors.

### What is simplified, and what would change the conclusion

- **Assessed is not sold.** BC Assessment's mass-appraisal estimates lag and smooth the market; a sale-price series could show a different path, especially in fast years. Tax levies are not used at all: a rise in tax is not a rise in value.
- **Descriptive only.** The 2020 proposal framed the question as "after the rise in immigration" with no immigration data. Nothing here tests any cause.
- **Composition.** A median moves when the mix of properties moves: a new tower of small units lowers an area's strata median without any unit losing value. Repeat-property (same folio) indices would separate the two; this page does not.
- **Lots are mixed.** "Lots" includes commercial and industrial land, which is why Downtown and the West End lead. A residential-only view would need the property class, which the historical files lack.
- **Placement uses today's parcels.** Up to 3.4% of older records cannot be placed. If those lots were concentrated in fast-changing areas, older area medians would be slightly biased.
- **CPI.** All-items Vancouver CPI annual average, standing in for the 1 July valuation date; it includes shelter costs, so "real" here means "relative to the general price level", not "relative to rents".
- **Boundaries** are simplified (14 m Douglas–Peucker tolerance) for drawing only; placement uses the full outlines.

### How to rerun

From the repo root, with Python 3.14, DuckDB 2.0.0 and numpy 2.5.4 (the versions it was built and tested with):

```
python -I projects/plat/pipeline/fetch.py /some/dir/outside/the/repo/plat-raw
python -I projects/plat/pipeline/build.py /some/dir/outside/the/repo/plat-raw projects/plat/data
python -I projects/plat/tests/test_pipeline.py /some/dir/outside/the/repo/plat-raw
node projects/plat/tests/test_model.js
node projects/plat/tests/test_page.js
```

`fetch.py` skips files it already has; `--refresh` re-downloads the ones that still change. `pipeline/plat.yml` runs the same steps once a year on GitHub Actions; install instructions are in its first line.

## What the original got wrong, and what changed

The original (Activity3_Visualization, CMPT 767, 2020) was a proposal and two screenshots of the table, with no analysis. Its framing was causal ("after the rise in immigration") with no immigration data; this page is descriptive only and says so. It planned to replace nulls, including in the free-text legal-description columns; here nothing is imputed, blank-year rows are dropped as "not assessed", and legal descriptions are never read. It treated `TAX_ASSESSMENT_YEAR` and `REPORT_YEAR` as redundant; their documented meanings differ, and the blank-year rows are exactly where that matters. It ignored that strata units share a land coordinate; strata units are now kept apart and the parcel join is guarded against repeating them. And it mixed assessed value, sale value and tax growth; this page uses assessed value only, labelled as such, with real and nominal views side by side. The undergraduate BE_Project (2017–18, "Illegal Locality Detection using NGIS") wanted to watch a city build from GIS data; that survives here, honestly scoped, as counts of new-building permits per area beside each area's building values.

## Sources

- City of Vancouver Open Data Portal: Property tax report (`property-tax-report`, `property-tax-report-2006-2010`, `property-tax-report-2011-2015`, `property-tax-report-2016-2019`); Local area boundary (`local-area-boundary`); Property parcel polygons (`property-parcel-polygons`); Issued building permits (`issued-building-permits`). Exports from https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/ , downloaded 2 November 2026. Contains information licensed under the Open Government Licence – Vancouver (https://opendata.vancouver.ca/pages/licence/).
- Statistics Canada. Table 18-10-0005-01, Consumer Price Index, annual average, not seasonally adjusted; Vancouver, British Columbia; All-items (2002=100), vector v41695228. https://www150.statcan.gc.ca/n1/tbl/csv/18100005-eng.zip , downloaded 2 November 2026. Adapted from Statistics Canada, Table 18-10-0005-01, reference years 2005–2025. This does not constitute an endorsement by Statistics Canada of this product. Used under the Statistics Canada Open Licence (https://www.statcan.gc.ca/en/reference/licence).
- Assessment Act, RSBC 1996, c. 20 (British Columbia): the valuation date of 1 July of the year before the roll.
- Fonts: Cormorant Garamond and Cormorant SC (Christian Thalmann, Catharsis Fonts) and Overpass Mono (The Overpass Project Authors, for Red Hat), SIL Open Font License 1.1, Latin subsets from Fontsource 5.3.0. Licence in `fonts/OFL.txt`.
