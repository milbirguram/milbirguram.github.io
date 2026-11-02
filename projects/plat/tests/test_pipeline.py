"""Plat pipeline checks. Needs DuckDB and numpy, and the raw downloads.

    python -I tests/test_pipeline.py RAW_DIR

(a) deduplication removes exact duplicate rows and only those (fixture, then the real data)
(b) strata units are never double-counted in land value (fixture, then the real data)
(c) three randomly chosen area-year medians, recomputed from the raw files by an
    independent query (its own point-in-polygon, its own filters, DuckDB's median()),
    match data/plat.json
Exits non-zero on any failure.
"""
import csv
import json
import os
import random
import sys

import duckdb
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "pipeline"))
import build  # noqa: E402

DATA = json.load(open(os.path.join(HERE, "..", "data", "plat.json"), encoding="utf-8"))
failures = []


def check(cond, msg):
    print(("ok   " if cond else "FAIL ") + msg)
    if not cond:
        failures.append(msg)


def fixture(con, rows):
    cols = ", ".join(f"{n} {t}" for n, t in build.COLUMNS)
    con.execute(f"CREATE OR REPLACE TABLE tax_raw ({cols})")
    names = [n for n, _ in build.COLUMNS]
    for r in rows:
        vals = [r.get(n) for n in names]
        con.execute(f"INSERT INTO tax_raw VALUES ({', '.join('?' * len(names))})", vals)


def row(folio, year, land, bldg, legal="LAND", lc=None, **kw):
    r = {"folio": folio, "land_coordinate": lc or folio[:8], "legal_type": legal, "report_year": year,
         "tax_assessment_year": year, "current_land_value": land, "current_improvement_value": bldg}
    r.update(kw)
    return r


# ------------------------------------------------------------------ (a) fixture
con = duckdb.connect()
fixture(con, [
    row("111111110000", 2020, 1000000, 200000),
    row("111111110000", 2020, 1000000, 200000),                      # exact duplicate: removed
    row("222222220000", 2020, 900000, 100000),
    row("222222220000", 2020, 900000, 100001),                       # same folio-year, differs: kept
    row("222222220000", 2020, 900000, 100000, street_name="X ST"),   # differs only in an address column: kept
    row("333333330000", 2021, 800000, 50000),
    row("333333330000", 2021, 800000, 50000),
    row("333333330000", 2021, 800000, 50000),                        # two exact copies: both removed
])
st = build.dedup(con)
check(st["exact_duplicates_removed"] == 3, "(a) fixture: three exact copies removed, got %d" % st["exact_duplicates_removed"])
check(st["rows_out"] == 5, "(a) fixture: five rows survive, got %d" % st["rows_out"])
check(st["folio_year_key_collisions"] == 1, "(a) fixture: near-duplicates kept and reported as one key collision")
left = con.execute("SELECT count(*) FROM tax_dedup WHERE folio = '222222220000'").fetchone()[0]
check(left == 3, "(a) fixture: rows that differ in any column all survive")

# ------------------------------------------------------------------ (b) fixture
# One strata plan of three units on one land coordinate, with three parcel points (one per
# polygon) at that coordinate, and one ordinary lot. Each unit carries its own share of land.
con = duckdb.connect()
fixture(con, [
    row("444444440001", 2020, 300000, 500000, legal="STRATA", lc="44444444"),
    row("444444440002", 2020, 310000, 520000, legal="STRATA", lc="44444444"),
    row("444444440003", 2020, 320000, 540000, legal="STRATA", lc="44444444"),
    row("444444440000", 2020, 0, 0, legal="LAND", lc="44444444"),      # common property: no value
    row("555555550000", 2020, 2000000, 300000),
])
build.dedup(con)
build.properties(con)
con.execute("""CREATE TABLE parcel_area AS SELECT * FROM (VALUES ('44444444', 0, 1), ('55555555', 0, 1)) t(tax_coord, area, candidate_areas)""")
# The raw parcel table has three rows for the strata coordinate; a naive join would triple it.
con.execute("""CREATE TABLE parcel_raw AS SELECT * FROM (VALUES ('44444444', 0), ('44444444', 0), ('44444444', 0), ('55555555', 0)) t(tax_coord, area)""")
naive = con.execute("SELECT count(*) FROM props p JOIN parcel_raw r ON p.land_coordinate = r.tax_coord").fetchone()[0]
build.place(con)
pub, _ = build.aggregate(con, threshold=1)
cells = {(r[0], r[1]): r for r in pub}
s = cells[("strata", 0)]
check(naive == 10 and con.execute("SELECT count(*) FROM placed").fetchone()[0] == 4,
      "(b) fixture: a naive join would make 10 rows from 4; the lookup keeps 4")
check(s[3] == 3, "(b) fixture: three strata units counted once each, got %d" % s[3])
check(s[4][1] == 310000, "(b) fixture: strata median land is the middle unit's own share")
check(cells[("nonstrata", 0)][3] == 1, "(b) fixture: the zero-value common-property row is not counted as a lot")

# ------------------------------------------------------------------ the real data
if len(sys.argv) < 2 or not os.path.isdir(sys.argv[1]):
    print("FAIL no RAW_DIR given: the checks against the real data did not run")
    sys.exit(1)
raw = os.path.abspath(sys.argv[1])
files = sorted(f for f in os.listdir(raw) if f.startswith("tax-") and f.endswith(".parquet"))
paths = ["'" + build.sql_path(os.path.join(raw, f)) + "'" for f in files]

con = duckdb.connect()
build.ingest(con, [os.path.join(raw, f) for f in files])
st = build.dedup(con)
# Independent count of exact duplicates: group on every column.
cols = ", ".join(n for n, _ in build.COLUMNS)
extra = con.execute(f"SELECT coalesce(sum(k - 1), 0) FROM (SELECT count(*) k FROM tax_raw GROUP BY {cols})").fetchone()[0]
check(st["exact_duplicates_removed"] == extra == DATA["meta"]["audit"]["exact_duplicates_removed"],
      "(a) real data: removed %d rows, %d exact duplicates exist, plat.json says %d" % (st["exact_duplicates_removed"], extra, DATA["meta"]["audit"]["exact_duplicates_removed"]))
check(st["rows_in"] - st["rows_out"] == extra, "(a) real data: nothing but exact duplicates removed")

build.properties(con)
areas, proj, _, _ = build.load_areas(os.path.join(raw, "local-areas.geojson"))
import tempfile
with tempfile.TemporaryDirectory() as work:
    build.parcel_lookup(con, os.path.join(raw, "parcel-points.csv"), areas, proj, work)
build.place(con)
one = con.execute("SELECT count(*) = count(DISTINCT (folio, year)) FROM placed").fetchone()[0]
check(one, "(b) real data: every folio appears at most once per roll year after placing")
both = con.execute("SELECT count(*) FROM (SELECT folio, year FROM placed GROUP BY ALL HAVING count(DISTINCT kind) > 1)").fetchone()[0]
check(both == 0, "(b) real data: no property is in both the strata and the lot figures")
for kind in ("nonstrata", "strata"):
    yi = len(DATA["meta"]["years"]) - 1
    year = DATA["meta"]["years"][yi]
    pub_n = sum(DATA["cells"][kind]["n"][a][yi] for a in range(len(DATA["areas"])))
    placed_n = con.execute("SELECT count(*) FROM placed WHERE kind = ? AND year = ? AND area IS NOT NULL", [kind, year]).fetchone()[0]
    check(pub_n == placed_n, "(b) real data: %s counts over all areas in %d (%d) equal the placed properties (%d)" % (kind, year, pub_n, placed_n))

# ------------------------------------------------------------------ (c) independent medians
# Its own reading of the raw files, its own point-in-polygon (winding number on the
# unsimplified outlines) and DuckDB's median().
gj = json.load(open(os.path.join(raw, "local-areas.geojson"), encoding="utf-8"))
names = sorted(f["properties"]["name"] for f in gj["features"])
geoms = {f["properties"]["name"]: f["geometry"] for f in gj["features"]}


def winding(lon, lat, ring):
    ring = np.asarray(ring, float)
    x1, y1 = ring[:-1, 0][None, :], ring[:-1, 1][None, :]
    x2, y2 = ring[1:, 0][None, :], ring[1:, 1][None, :]
    px, py = lon[:, None], lat[:, None]
    cross = (x2 - x1) * (py - y1) - (px - x1) * (y2 - y1)
    up = (y1 <= py) & (y2 > py) & (cross > 0)
    down = (y1 > py) & (y2 <= py) & (cross < 0)
    return (up.sum(1) - down.sum(1)) != 0


def in_area(lon, lat, name):
    g = geoms[name]
    polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
    res = np.zeros(len(lon), bool)
    for poly in polys:
        r = winding(lon, lat, poly[0])
        for hole in poly[1:]:
            r &= ~winding(lon, lat, hole)
        res |= r
    return res


pts = []
with open(os.path.join(raw, "parcel-points.csv"), encoding="utf-8-sig") as fh:
    for r in csv.DictReader(fh, delimiter=";"):
        if r["tax_coord"] and r["geo_point_2d"]:
            la, lo = (float(v) for v in r["geo_point_2d"].split(","))
            pts.append((r["tax_coord"], lo, la))
lon = np.array([p[1] for p in pts])
lat = np.array([p[2] for p in pts])
owner = np.full(len(pts), -1)
for i, n in enumerate(names):
    owner[(owner < 0) & in_area(lon, lat, n)] = i
votes = {}
for (tc, _, _), a in zip(pts, owner):
    if a >= 0:
        votes.setdefault(tc, {}).setdefault(a, 0)
        votes[tc][a] += 1
home = {tc: sorted(v.items(), key=lambda kv: (-kv[1], kv[0]))[0][0] for tc, v in votes.items()}

rng = random.Random()
years = DATA["meta"]["years"]
picks = []
while len(picks) < 3:
    kind = rng.choice(["nonstrata", "strata"])
    a = rng.randrange(len(names))
    yi = rng.randrange(len(years))
    measure = rng.choice(["land", "building", "total"])
    if DATA["cells"][kind]["n"][a][yi]:
        picks.append((kind, a, yi, measure))
ind = duckdb.connect()
union = " UNION ALL ".join(
    f"SELECT folio, legal_type, land_coordinate, CAST(tax_assessment_year AS VARCHAR) AS tay, current_land_value AS l, current_improvement_value AS b FROM read_parquet({p})"
    for p in paths)
ind.execute(f"CREATE TABLE r AS SELECT DISTINCT * FROM ({union})")
for kind, a, yi, measure in picks:
    coords = [tc for tc, h in home.items() if h == a]
    ind.execute("CREATE OR REPLACE TEMP TABLE c AS SELECT unnest(?::VARCHAR[]) AS tc", [coords])
    expr = {"land": "l", "building": "b", "total": "l + b"}[measure]
    legal = "legal_type = 'STRATA'" if kind == "strata" else "legal_type <> 'STRATA'"
    n, med = ind.execute(f"""
        SELECT count(*), median({expr}) FROM r
        WHERE tay = ? AND l IS NOT NULL AND b IS NOT NULL AND l + b > 0 AND {legal}
          AND land_coordinate IN (SELECT tc FROM c)
    """, [str(years[yi])]).fetchone()
    pub = DATA["cells"][kind][measure][a][yi]
    pn = DATA["cells"][kind]["n"][a][yi]
    check(n == pn and abs(med - pub[1]) <= 1,
          "(c) %s %s %s %d: independent median %s from %d properties, plat.json %s from %d" % (names[a], kind, measure, years[yi], med, n, pub[1], pn))

print()
if failures:
    print("%d check(s) failed" % len(failures))
    sys.exit(1)
print("all pipeline checks passed")
