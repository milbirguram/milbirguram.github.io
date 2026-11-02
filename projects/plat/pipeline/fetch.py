"""Plat: download the raw inputs, one request at a time, into a directory outside the repo.

    python -I fetch.py RAW_DIR [--refresh]

Files that already exist are skipped, so a rerun downloads nothing. --refresh re-downloads
the inputs that still change (the current property tax report, parcel points, permits and
CPI); the 2006-2019 tax reports are static and are only fetched once.

Every input is published under an open licence (see "Sources" in projects/plat/README.md).
Nothing here is ever written into the repository.
"""
import json
import os
import sys
import time
import urllib.request

ODS = "https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/"
UA = "plat-pipeline/1.0 (https://milbirguram.github.io/projects/plat/)"

# (file name, url, static?)
TAX = [
    ("tax-2006-2010.parquet", ODS + "property-tax-report-2006-2010/exports/parquet", True),
    ("tax-2011-2015.parquet", ODS + "property-tax-report-2011-2015/exports/parquet", True),
    ("tax-2016-2019.parquet", ODS + "property-tax-report-2016-2019/exports/parquet", True),
    ("tax-2020-on.parquet", ODS + "property-tax-report/exports/parquet", False),
]
OTHER = [
    # The 22 local areas. The boundaries do not change.
    ("local-areas.geojson", ODS + "local-area-boundary/exports/geojson", True),
    # One point per assessment parcel, keyed by the 8-digit land coordinate (tax_coord).
    # Only the key, the site id and the point are requested: no addresses.
    ("parcel-points.csv", ODS + "property-parcel-polygons/exports/csv?select=tax_coord,site_id,geo_point_2d&delimiter=%3B", False),
    # Issued building permits from 2017, already tagged with the local area by the City.
    # Only the fields needed for counts by area and year: no addresses, applicants or contractors.
    ("permits.csv", ODS + "issued-building-permits/exports/csv?select=permitnumber,issueyear,typeofwork,geolocalarea&delimiter=%3B", False),
    # Statistics Canada table 18-10-0005-01, Consumer Price Index, annual average, not seasonally adjusted.
    ("cpi-18100005.zip", "https://www150.statcan.gc.ca/n1/tbl/csv/18100005-eng.zip", False),
]


def get(url, dest):
    tmp = dest + ".part"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=600) as r, open(tmp, "wb") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
    os.replace(tmp, dest)
    print("  %-26s %8.1f MB  %5.1fs" % (os.path.basename(dest), os.path.getsize(dest) / 1e6, time.time() - t0))


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    raw = os.path.abspath(sys.argv[1])
    refresh = "--refresh" in sys.argv[2:]
    os.makedirs(raw, exist_ok=True)
    log = []
    for name, url, static in TAX + OTHER:
        dest = os.path.join(raw, name)
        if os.path.exists(dest) and (static or not refresh):
            print("  %-26s present, skipped" % name)
            continue
        get(url, dest)  # one request at a time
        log.append({"file": name, "url": url, "fetched_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
        time.sleep(1)
    if log:
        path = os.path.join(raw, "fetch-log.json")
        old = json.load(open(path)) if os.path.exists(path) else []
        json.dump(old + log, open(path, "w"), indent=1)


if __name__ == "__main__":
    main()
