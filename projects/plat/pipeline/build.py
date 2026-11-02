"""Plat: turn the raw downloads into one compact JSON of area-by-year aggregates.

    python -I build.py RAW_DIR OUT_DIR

RAW_DIR holds what fetch.py downloaded (outside the repo). OUT_DIR is projects/plat/data.
Writes OUT_DIR/plat.json (the page) and OUT_DIR/preview.js (the card), and prints a short
audit. The output depends only on the inputs: same downloads, same bytes.

Steps
  1. Ingest every tax-*.parquet file and normalise the schema across years.
  2. Remove exact duplicate rows (identical in every column) and nothing else.
  3. Keep each folio's values for the roll year they are in effect (tax_assessment_year).
  4. Place each property in a local area: its land coordinate -> the City's parcel point
     with that tax coordinate -> the local-area polygon containing that point.
  5. Per area x roll year x kind (non-strata lot / strata unit): count, and the 25th, 50th
     and 75th percentiles of land, building (improvement) and total value. Cells with fewer
     than THRESHOLD properties are withheld.
  6. Attach the Vancouver CPI (annual average) and the new-building permit counts.

Needs DuckDB and numpy. Never publishes a parcel, an address or an owner: only aggregates.
"""
import csv
import glob
import io
import json
import math
import os
import sys
import tempfile
import zipfile

import duckdb
import numpy as np

THRESHOLD = 10          # withhold any cell with fewer properties than this
VALUATION_LAG = 1       # a roll for year Y values property as of 1 July of Y - 1
VIEW_W = 1000           # SVG width in user units
SIMPLIFY_M = 14         # Douglas-Peucker tolerance for the area outlines, in metres
CPI_GEO = "Vancouver, British Columbia"
CPI_PRODUCT = "All-items"

# The columns the four tax files share, with the type each is normalised to.
COLUMNS = [
    ("pid", "VARCHAR"), ("legal_type", "VARCHAR"), ("folio", "VARCHAR"), ("land_coordinate", "VARCHAR"),
    ("zoning_district", "VARCHAR"), ("zoning_classification", "VARCHAR"),
    ("lot", "VARCHAR"), ("plan", "VARCHAR"), ("block", "VARCHAR"), ("district_lot", "VARCHAR"),
    ("from_civic_number", "VARCHAR"), ("to_civic_number", "VARCHAR"), ("street_name", "VARCHAR"),
    ("property_postal_code", "VARCHAR"),
    ("narrative_legal_line1", "VARCHAR"), ("narrative_legal_line2", "VARCHAR"), ("narrative_legal_line3", "VARCHAR"),
    ("narrative_legal_line4", "VARCHAR"), ("narrative_legal_line5", "VARCHAR"),
    ("current_land_value", "BIGINT"), ("current_improvement_value", "BIGINT"), ("tax_assessment_year", "INTEGER"),
    ("previous_improvement_value", "BIGINT"), ("previous_land_value", "BIGINT"),
    ("year_built", "VARCHAR"), ("big_improvement_year", "VARCHAR"), ("tax_levy", "DOUBLE"),
    ("neighbourhood_code", "VARCHAR"), ("report_year", "INTEGER"), ("note", "VARCHAR"),
]


def sql_path(p):
    return p.replace("\\", "/").replace("'", "''")


# ---------------------------------------------------------------------------- 1. ingest

def ingest(con, files, table="tax_raw"):
    """Union the files into one table with one schema. Returns {file: {missing, retyped}}."""
    report = {}
    selects = []
    for f in files:
        cols = {r[0]: r[1] for r in con.execute(f"describe select * from read_parquet('{sql_path(f)}')").fetchall()}
        missing, retyped = [], []
        parts = []
        for name, typ in COLUMNS:
            if name not in cols:
                missing.append(name)
                parts.append(f"CAST(NULL AS {typ}) AS {name}")
            elif cols[name] != typ:
                retyped.append(f"{name}: {cols[name]} -> {typ}")
                # Empty strings in a numeric column mean "no value".
                parts.append(f"TRY_CAST(NULLIF(TRIM(CAST({name} AS VARCHAR)), '') AS {typ}) AS {name}")
            else:
                parts.append(name)
        extra = sorted(set(cols) - {c for c, _ in COLUMNS})
        report[os.path.basename(f)] = {"missing": missing, "retyped": retyped, "extra": extra}
        selects.append(f"SELECT {', '.join(parts)} FROM read_parquet('{sql_path(f)}')")
    con.execute(f"CREATE OR REPLACE TABLE {table} AS " + " UNION ALL ".join(selects))
    return report


# ---------------------------------------------------------------------------- 2. dedup

def dedup(con, src="tax_raw", dst="tax_dedup"):
    """Drop rows identical to another row in every column; keep everything else.

    Rows that share a folio and year but differ anywhere are not exact duplicates and are
    kept; they are counted and reported instead (key_collisions)."""
    before = con.execute(f"SELECT count(*) FROM {src}").fetchone()[0]
    con.execute(f"CREATE OR REPLACE TABLE {dst} AS SELECT DISTINCT * FROM {src}")
    after = con.execute(f"SELECT count(*) FROM {dst}").fetchone()[0]
    collisions = con.execute(
        f"SELECT count(*) FROM (SELECT folio, report_year FROM {dst} GROUP BY ALL HAVING count(*) > 1)"
    ).fetchone()[0]
    return {"rows_in": before, "exact_duplicates_removed": before - after, "rows_out": after,
            "folio_year_key_collisions": collisions}


# ---------------------------------------------------------------------------- 3. values

def properties(con, src="tax_dedup", dst="props"):
    """One row per folio per roll year with values in effect for that roll.

    tax_assessment_year is the year the values are in effect; report_year is only when the
    row was extracted. Where tax_assessment_year is blank the folio was not assessed that
    year (its values are blank too), so those rows are dropped rather than imputed."""
    con.execute(f"""
        CREATE OR REPLACE TABLE {dst} AS
        SELECT folio, land_coordinate,
               CASE WHEN legal_type = 'STRATA' THEN 'strata' ELSE 'nonstrata' END AS kind,
               tax_assessment_year AS year,
               current_land_value AS land,
               current_improvement_value AS building,
               current_land_value + current_improvement_value AS total
        FROM {src}
        WHERE tax_assessment_year IS NOT NULL
          AND current_land_value IS NOT NULL AND current_improvement_value IS NOT NULL
          AND current_land_value + current_improvement_value > 0
    """)
    return con.execute(f"""
        SELECT
          (SELECT count(*) FROM {src}),
          (SELECT count(*) FROM {src} WHERE tax_assessment_year IS NULL),
          (SELECT count(*) FROM {src} WHERE tax_assessment_year IS NOT NULL AND tax_assessment_year <> report_year),
          (SELECT count(*) FROM {dst})
    """).fetchone()


# ---------------------------------------------------------------------------- geometry

def project_fn(lon0, lat0):
    k = math.cos(math.radians(lat0)) * 111320.0
    def f(lon, lat):
        return ((lon - lon0) * k, (lat0 - lat) * 110574.0)
    return f


def rings_of(geom):
    if geom["type"] == "Polygon":
        return [geom["coordinates"]]
    if geom["type"] == "MultiPolygon":
        return geom["coordinates"]
    raise ValueError(geom["type"])


def douglas_peucker(pts, tol):
    pts = np.asarray(pts, float)
    if len(pts) < 4:
        return pts
    keep = np.zeros(len(pts), bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        a, b = pts[i], pts[j]
        seg = b - a
        L = np.hypot(*seg)
        mid = pts[i + 1:j]
        if L == 0:
            d = np.hypot(*(mid - a).T)
        else:
            d = np.abs(seg[0] * (mid[:, 1] - a[1]) - seg[1] * (mid[:, 0] - a[0])) / L
        k = int(np.argmax(d))
        if d[k] > tol:
            m = i + 1 + k
            keep[m] = True
            stack += [(i, m), (m, j)]
    return pts[keep]


def points_in_rings(px, py, ring):
    """Even-odd ray casting for many points against one ring."""
    x, y = ring[:, 0], ring[:, 1]
    x2, y2 = np.roll(x, -1), np.roll(y, -1)
    inside = np.zeros(len(px), bool)
    for k in range(len(x)):
        cond = (y[k] > py) != (y2[k] > py)
        if not cond.any():
            continue
        with np.errstate(divide="ignore", invalid="ignore"):
            xin = (x2[k] - x[k]) * (py - y[k]) / (y2[k] - y[k]) + x[k]
        inside ^= cond & (px < xin)
    return inside


def label_point(polys, step):
    """A point well inside the largest polygon: the grid point farthest from any edge."""
    best = None
    for poly in polys:
        outer = poly[0]
        xmin, ymin = outer.min(0)
        xmax, ymax = outer.max(0)
        gx, gy = np.meshgrid(np.arange(xmin, xmax, step), np.arange(ymin, ymax, step))
        px, py = gx.ravel(), gy.ravel()
        ins = points_in_rings(px, py, outer)
        for hole in poly[1:]:
            ins &= ~points_in_rings(px, py, hole)
        px, py = px[ins], py[ins]
        if not len(px):
            continue
        dmin = np.full(len(px), np.inf)
        for ring in poly:
            a = ring
            b = np.roll(ring, -1, axis=0)
            for (ax, ay), (bx, by) in zip(a, b):
                vx, vy = bx - ax, by - ay
                L2 = vx * vx + vy * vy or 1e-9
                t = np.clip(((px - ax) * vx + (py - ay) * vy) / L2, 0, 1)
                d = np.hypot(px - (ax + t * vx), py - (ay + t * vy))
                dmin = np.minimum(dmin, d)
        k = int(np.argmax(dmin))
        if best is None or dmin[k] > best[2]:
            best = (px[k], py[k], dmin[k])
    return best


def load_areas(path):
    gj = json.load(open(path, encoding="utf-8"))
    feats = sorted(gj["features"], key=lambda f: f["properties"]["name"])
    lons, lats = [], []
    for f in feats:
        for poly in rings_of(f["geometry"]):
            for ring in poly:
                for lon, lat in ring:
                    lons.append(lon)
                    lats.append(lat)
    lon0, lat0 = min(lons), max(lats)
    proj = project_fn(lon0, lat0)
    xmax = max(proj(lon, lat0)[0] for lon in lons)
    ymax = max(proj(lon0, lat)[1] for lat in lats)
    m_per_unit = xmax / VIEW_W
    areas = []
    for f in feats:
        polys_m = []
        for poly in rings_of(f["geometry"]):
            polys_m.append([np.array([proj(lon, lat) for lon, lat in ring]) for ring in poly])
        areas.append({"name": f["properties"]["name"], "polys_m": polys_m})
    return areas, proj, m_per_unit, ymax / m_per_unit


def area_svg(area, m_per_unit):
    d = []
    polys_u = []
    for poly in area["polys_m"]:
        rings_u = []
        for ring in poly:
            simp = douglas_peucker(ring, SIMPLIFY_M) / m_per_unit
            if len(simp) < 4:
                continue
            rings_u.append(simp)
            pts = simp[:-1] if np.allclose(simp[0], simp[-1]) else simp
            d.append("M" + "L".join("%.1f,%.1f" % (x, y) for x, y in pts) + "Z")
        if rings_u:
            polys_u.append(rings_u)
    return "".join(d), polys_u


# ---------------------------------------------------------------------------- 4. areas

def parcel_lookup(con, parcels_csv, areas, proj, workdir, table="parcel_area"):
    """tax_coord -> local area index, one row per tax_coord.

    The City's parcel points are keyed by tax_coord, the same 8 digits as the tax report's
    land_coordinate. Several parcels can share a tax_coord (every unit of a strata plan
    shares one), so the lookup is reduced to a single row per tax_coord before any join;
    joining the tax rows to raw parcel rows would repeat them."""
    rows = con.execute(f"""
        SELECT tax_coord, geo_point_2d FROM read_csv('{sql_path(parcels_csv)}', delim=';', header=true, all_varchar=true)
        WHERE tax_coord IS NOT NULL AND geo_point_2d IS NOT NULL
    """).fetchall()
    coords = np.array([[float(v) for v in g.split(",")] for _, g in rows])  # lat, lon
    xy = np.array([proj(lon, lat) for lat, lon in coords])
    which = np.full(len(rows), -1)
    for i, a in enumerate(areas):
        for poly in a["polys_m"]:
            ins = points_in_rings(xy[:, 0], xy[:, 1], poly[0])
            for hole in poly[1:]:
                ins &= ~points_in_rings(xy[:, 0], xy[:, 1], hole)
            which[ins & (which < 0)] = i
    path = os.path.join(workdir, "parcel_points.csv")
    with open(path, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["tax_coord", "area"])
        for (tc, _), a in zip(rows, which):
            w.writerow([tc, int(a)])
    con.execute(f"""
        CREATE OR REPLACE TABLE {table} AS
        WITH p AS (SELECT tax_coord, area FROM read_csv('{sql_path(path)}', header=true,
                   columns={{'tax_coord': 'VARCHAR', 'area': 'INTEGER'}}) WHERE area >= 0),
             c AS (SELECT tax_coord, area, count(*) k FROM p GROUP BY ALL)
        SELECT tax_coord, arg_max(area, k * 100 - area) AS area, count(*) AS candidate_areas
        FROM c GROUP BY tax_coord
    """)
    return {
        "parcel_points": len(rows),
        "outside_all_areas": int((which < 0).sum()),
        "tax_coords": con.execute(f"SELECT count(*) FROM {table}").fetchone()[0],
        "tax_coords_in_two_areas": con.execute(f"SELECT count(*) FROM {table} WHERE candidate_areas > 1").fetchone()[0],
    }


def place(con, src="props", lookup="parcel_area", dst="placed"):
    con.execute(f"""
        CREATE OR REPLACE TABLE {dst} AS
        SELECT p.*, l.area FROM {src} p LEFT JOIN {lookup} l ON p.land_coordinate = l.tax_coord
    """)
    n_src = con.execute(f"SELECT count(*) FROM {src}").fetchone()[0]
    n_dst = con.execute(f"SELECT count(*) FROM {dst}").fetchone()[0]
    assert n_src == n_dst, "placing properties must not repeat any row"
    return con.execute(f"""
        SELECT year, count(*), count(area) FROM {dst} GROUP BY year ORDER BY year
    """).fetchall()


# ---------------------------------------------------------------------------- 5. aggregate

def aggregate(con, src="placed", threshold=THRESHOLD):
    """Rows of (kind, area or -1 for the city, year, n, [q1, med, q3] x land/building/total)."""
    q = "[0.25, 0.5, 0.75]"
    def run(group, where):
        return con.execute(f"""
            SELECT kind, {group} AS area, year, count(*) AS n,
                   quantile_cont(land, {q}), quantile_cont(building, {q}), quantile_cont(total, {q})
            FROM {src} {where}
            GROUP BY ALL ORDER BY kind, area, year
        """).fetchall()
    out = run("area", "WHERE area IS NOT NULL") + run("-1", "")
    return [r for r in out if r[3] >= threshold], [r for r in out if r[3] < threshold]


# ---------------------------------------------------------------------------- 6. CPI, permits

def load_cpi(zip_path):
    with zipfile.ZipFile(zip_path) as z:
        name = [n for n in z.namelist() if n.endswith(".csv") and "MetaData" not in n][0]
        text = z.read(name).decode("utf-8-sig")
    values = {}
    unit = None
    for row in csv.DictReader(io.StringIO(text)):
        if row["GEO"] == CPI_GEO and row["Products and product groups"] == CPI_PRODUCT and row["VALUE"]:
            values[int(row["REF_DATE"])] = float(row["VALUE"])
            unit = row["UOM"]
            vector = row.get("VECTOR")
    return values, unit, vector


def load_permits(con, path, area_names):
    rows = con.execute(f"""
        SELECT geolocalarea, TRY_CAST(issueyear AS INTEGER) y, count(*)
        FROM read_csv('{sql_path(path)}', delim=';', header=true, all_varchar=true)
        WHERE typeofwork = 'New Building'
        GROUP BY ALL
    """).fetchall()
    years = sorted({r[1] for r in rows if r[1] is not None})
    idx = {n: i for i, n in enumerate(area_names)}
    grid = [[0] * len(years) for _ in area_names]
    city = [0] * len(years)
    unplaced = 0
    for name, y, n in rows:
        if y is None:
            continue
        city[years.index(y)] += n
        if name in idx:
            grid[idx[name]][years.index(y)] += n
        else:
            unplaced += n
    return {"years": years, "areas": grid, "city": city, "unplaced": unplaced}


# ---------------------------------------------------------------------------- main

def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    raw, out = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
    os.makedirs(out, exist_ok=True)
    con = duckdb.connect()
    audit = {}

    files = sorted(glob.glob(os.path.join(raw, "tax-*.parquet")))
    audit["schema"] = ingest(con, files)
    audit["dedup"] = dedup(con)
    total, blank_year, year_mismatch, kept = properties(con)
    audit["values"] = {"rows": total, "dropped_not_assessed": blank_year,
                       "assessment_year_differs_from_report_year": year_mismatch,
                       "dropped_no_value_or_zero": total - blank_year - kept, "kept": kept}

    areas, proj, m_per_unit, view_h = load_areas(os.path.join(raw, "local-areas.geojson"))
    with tempfile.TemporaryDirectory() as work:
        audit["parcels"] = parcel_lookup(con, os.path.join(raw, "parcel-points.csv"), areas, proj, work)
    placed = place(con)
    audit["placed_by_year"] = {y: {"properties": n, "placed": k, "share": round(k / n, 4)} for y, n, k in placed}

    published, withheld = aggregate(con)
    years = sorted({r[2] for r in published})
    audit["withheld_cells"] = len([r for r in withheld if r[1] >= 0])

    cpi, cpi_unit, cpi_vector = load_cpi(os.path.join(raw, "cpi-18100005.zip"))
    base_year = max(years) - VALUATION_LAG
    if base_year not in cpi:
        base_year = max(cpi)
    need = [y - VALUATION_LAG for y in years]
    missing = [y for y in need if y not in cpi]
    if missing:
        raise SystemExit("CPI missing for valuation years %s" % missing)

    nA, nY = len(areas), len(years)
    def blank():
        return {"n": [[0] * nY for _ in range(nA)], "land": [[0] * nY for _ in range(nA)],
                "building": [[0] * nY for _ in range(nA)], "total": [[0] * nY for _ in range(nA)]}
    cells = {"nonstrata": blank(), "strata": blank()}
    city = {k: {"n": [0] * nY, "land": [0] * nY, "building": [0] * nY, "total": [0] * nY} for k in cells}
    for kind, area, year, n, ql, qb, qt in published:
        yi = years.index(year)
        qs = {"land": ql, "building": qb, "total": qt}
        if area < 0:
            city[kind]["n"][yi] = n
            for m, v in qs.items():
                city[kind][m][yi] = [round(x) for x in v]
        else:
            cells[kind]["n"][area][yi] = n
            for m, v in qs.items():
                cells[kind][m][area][yi] = [round(x) for x in v]

    area_out = []
    small = {"Strathcona", "South Cambie", "West End"}
    for i, a in enumerate(areas):
        d, polys_u = area_svg(a, m_per_unit)
        lx, ly, r = label_point(polys_u, 4)
        area_out.append({"num": i + 1, "name": a["name"], "d": d, "lx": round(float(lx), 1), "ly": round(float(ly), 1),
                         "r": round(float(r), 1)})

    permits = load_permits(con, os.path.join(raw, "permits.csv"), [a["name"] for a in areas])
    audit["permits_unplaced"] = permits.pop("unplaced")

    data = {
        "meta": {
            "years": years,
            "valuation_lag": VALUATION_LAG,
            "threshold": THRESHOLD,
            "cpi": {"base_year": base_year, "unit": cpi_unit, "vector": cpi_vector,
                    "table": "18-10-0005-01", "geo": CPI_GEO, "product": CPI_PRODUCT,
                    "values": {str(y): cpi[y] for y in sorted(cpi) if y >= min(need)}},
            "audit": {
                "rows_in": audit["dedup"]["rows_in"],
                "exact_duplicates_removed": audit["dedup"]["exact_duplicates_removed"],
                "same_key_rows_kept": audit["dedup"]["folio_year_key_collisions"],
                "properties_kept": kept,
                "placed_share_min": min(v["share"] for v in audit["placed_by_year"].values()),
                "withheld_cells": audit["withheld_cells"],
            },
        },
        "view": {"w": VIEW_W, "h": round(view_h, 1), "m_per_unit": round(m_per_unit, 4)},
        "areas": area_out,
        "cells": cells,
        "city": city,
        "permits": permits,
    }
    with open(os.path.join(out, "plat.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(data, fh, separators=(",", ":"), ensure_ascii=False)

    write_preview(data, os.path.join(out, "preview.js"))
    json.dump(audit, sys.stdout, indent=1, default=str)
    print()


def write_preview(data, path):
    """The card: real median land value of lots by area and year, and the city's median land
    and building value of lots, all in base-year dollars. Paths are rounded to whole units."""
    meta = data["meta"]
    cpi = meta["cpi"]["values"]
    base = cpi[str(meta["cpi"]["base_year"])]
    def f(y):
        return base / cpi[str(y - meta["valuation_lag"])]
    years = meta["years"]
    ns = data["cells"]["nonstrata"]
    values = []
    for a in range(len(data["areas"])):
        values.append([round(ns["land"][a][i][1] * f(y)) if ns["n"][a][i] else 0 for i, y in enumerate(years)])
    flat = sorted(v for row in values for v in row if v)
    k = 7  # the same pooled equal-count classes as Plat.breaks in model.js
    edges = [flat[0]]
    for i in range(1, k):
        pos = i / k * (len(flat) - 1)
        lo = int(math.floor(pos))
        edges.append(flat[lo] + (flat[min(lo + 1, len(flat) - 1)] - flat[lo]) * (pos - lo))
    edges.append(flat[-1])
    cityns = data["city"]["nonstrata"]
    city = [[round(cityns["land"][i][1] * f(y)), round(cityns["building"][i][1] * f(y))] for i, y in enumerate(years)]
    import re
    def coarse(d):
        return re.sub(r"(\d+\.\d)", lambda m: str(round(float(m.group(1)))), d)
    pv = {"w": data["view"]["w"], "h": data["view"]["h"], "years": years, "base": meta["cpi"]["base_year"],
          "areas": [coarse(a["d"]) for a in data["areas"]], "values": values, "edges": [round(e) for e in edges],
          "city": city}
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("/* Generated by pipeline/build.py: the card preview's data. */\nwindow.PLAT_PREVIEW=")
        json.dump(pv, fh, separators=(",", ":"))
        fh.write(";\n")


if __name__ == "__main__":
    main()
