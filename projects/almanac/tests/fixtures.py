"""Small crafted source files in the exact shape ECCC publishes, for the contract tests."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PIPELINE = os.path.normpath(os.path.join(HERE, "..", "pipeline"))
if PIPELINE not in sys.path:
    sys.path.insert(0, PIPELINE)

import contract as C  # noqa: E402

CONTRACT = C.load_contract()
DAY = "2026-08-15"
PYR = ["JABNO", "JAFNW", "JAFUV", "JBLVS", "JBOBQ", "JBRIK"]
PNR = ["IACMP", "IAKID", "IADGP"]


def value(station, hour):
    # a plausible clean day: low values, with a smoky afternoon in Kamloops (7+ for 4 hours)
    if station == "JAFNW" and 20 <= hour <= 23:
        return "8.40"
    return "%.2f" % (1.5 + (hour % 6) * 0.25)


def rows(region, day=DAY, hours=range(24)):
    cols = PYR if region == "pyr" else PNR
    header = ["Date", "Hour (UTC)"] + cols
    body = []
    for h in sorted(hours, reverse=True):
        body.append([day, "%02d" % h] + [value(c, h) for c in cols])
    return header, body


def sources(day=DAY, newest="2026-08-16T06:00:00Z"):
    out = {}
    for region in ("pnr", "pyr"):
        header, body = rows(region, day)
        out[region] = {"header": header, "rows": body, "newest": newest}
    return out


def csv_file(region, days=(DAY,)):
    header, _ = rows(region)
    lines = [",".join(header)]
    for d in sorted(days, reverse=True):
        _, body = rows(region, d)
        lines += [",".join(r) for r in body]
    return "\n".join(lines) + "\n"


def set_cell(src, region, station, hour, val):
    idx = src[region]["header"].index(station)
    for r in src[region]["rows"]:
        if int(r[1]) == hour:
            r[idx] = val
