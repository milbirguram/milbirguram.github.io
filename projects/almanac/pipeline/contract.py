"""Almanac's data contract: the checks a day of AQHI observations must pass before it is loaded.

The rules and thresholds live in contract.json. This module only knows how to apply them.
Each check returns {"name", "status", "detail"}, where status is one of
pass, warn, fail or skip (skip = does not apply to this kind of run).
"""
import json
import math
import os
import re
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
INT_RE = re.compile(r"^\d{1,2}$")
NUM_RE = re.compile(r"^-?\d+(\.\d+)?$")
RANK = {"skip": 0, "pass": 0, "warn": 1, "fail": 2}


def load_contract(path=None):
    with open(path or os.path.join(HERE, "contract.json"), encoding="utf-8") as f:
        return json.load(f)


def check_cfg(contract, name):
    for c in contract["checks"]:
        if c["name"] == name:
            return c
    raise KeyError(name)


def reported(value):
    """The AQHI as the public sees it: rounded half up to a whole number; 11 means 10+."""
    return int(math.floor(value + 0.5))


def worst(statuses):
    top = "pass"
    for s in statuses:
        if RANK[s] > RANK[top]:
            top = s
    return top


def plural(n, word, many=None):
    return "%d %s" % (n, word if n == 1 else (many or word + "s"))


def validate(contract, date, sources, now=None, live=True):
    """Apply the contract to one UTC day.

    sources: {region: {"header": [str], "rows": [[str]] (rows whose date cell is `date`),
                       "newest": "YYYY-MM-DDTHH:00:00Z" or None}}
             A region with no file at all is None or {"absent": "live" | "archive",
             "lookback_hours": n}: "live" when the run looked for the live feed and found none.
    now:     datetime (UTC) of the run, for the freshness check.
    live:    True when the source is the live hourly feed, False for a monthly archive.

    Returns (checks, good_rows, quarantined) where good_rows are dicts ready to load
    and quarantined are dicts with a reason.
    """
    cols = contract["columns"]
    locs = contract["locations"]
    checks = []
    quarantined = []

    # 0. no file at all -----------------------------------------------------
    # A region with no source file is not a broken schema: there is nothing to check.
    # From the live feed it means the feed has stalled (freshness); from an archive it
    # means the source does not cover the day (completeness). Every other check is not run.
    absent = [r for r in sorted({l["region"] for l in locs})
              if not sources.get(r) or sources[r].get("absent")]
    if absent:
        names = ", ".join(r.upper() for r in absent)
        live_absent = [r for r in absent if (sources.get(r) or {}).get("absent") == "live"]
        if live_absent:
            fc = check_cfg(contract, "freshness")
            look = (sources[live_absent[0]] or {}).get("lookback_hours")
            checks.append({"name": "freshness", "status": "fail",
                           "detail": "No live file for %s in the last %s: the feed seems to have stalled (limit %d hours)." % (
                               ", ".join(r.upper() for r in live_absent),
                               plural(look, "hour") if look else "few hours", fc["max_age_hours"])})
        else:
            checks.append({"name": "completeness", "status": "fail",
                           "detail": "The source has no file that covers this day (%s)." % names})
        done = {c["name"] for c in checks}
        for c in contract["checks"]:
            if c["name"] not in done:
                checks.append({"name": c["name"], "status": "skip",
                               "detail": "Not run, because there was no file to check."})
        order_ = [c["name"] for c in contract["checks"]]
        checks.sort(key=lambda c: order_.index(c["name"]))
        return checks, [], quarantined

    # 1. schema -------------------------------------------------------------
    missing = []
    for region in sorted({l["region"] for l in locs}):
        src = sources.get(region)
        header = src["header"] if src else []
        need = [cols["date"], cols["hour"]] + [l["id"] for l in locs if l["region"] == region]
        missing += ["%s (%s)" % (n, region.upper()) for n in need if n not in header]
    if missing:
        checks.append({"name": "schema", "status": "fail",
                       "detail": "Missing column%s: %s." % ("" if len(missing) == 1 else "s", ", ".join(missing))})
        return finish(contract, checks), [], quarantined
    checks.append({"name": "schema", "status": "pass",
                   "detail": "All %d expected columns are present." % (2 + len(locs))})

    # Gather cells: (hour, location) -> list of raw strings
    bad_types = []
    hours_seen = set()
    cells = {}
    for region in sorted({l["region"] for l in locs}):
        src = sources[region]
        idx = {name: i for i, name in enumerate(src["header"])}
        mine = [l for l in locs if l["region"] == region]
        region_hours = []
        for row in src["rows"]:
            def cell(name):
                i = idx[name]
                return row[i].strip() if i < len(row) else ""
            d, h = cell(cols["date"]), cell(cols["hour"])
            if not DATE_RE.match(d) or not INT_RE.match(h) or not 0 <= int(h) <= 23:
                bad_types.append("%s row with date %r and hour %r" % (region.upper(), d, h))
                continue
            hour = int(h)
            region_hours.append(hour)
            for l in mine:
                v = cell(l["id"])
                if v == "":
                    continue
                if not NUM_RE.match(v):
                    bad_types.append("%s at %02d:00 is %r" % (l["city"], hour, v))
                    quarantined.append(qrow(date, hour, l, v, "not a number"))
                    continue
                cells.setdefault((hour, l["id"]), []).append(v)
        hours_seen.update(region_hours)
        sources[region]["_hours"] = region_hours

    # 2. types --------------------------------------------------------------
    if bad_types:
        checks.append({"name": "types", "status": "fail",
                       "detail": "%s of the wrong kind, e.g. %s." % (plural(len(bad_types), "value"), bad_types[0])})
    else:
        checks.append({"name": "types", "status": "pass",
                       "detail": "Every date, hour and reading parsed."})

    # 3. range --------------------------------------------------------------
    rc = check_cfg(contract, "range")
    in_range = {}
    odd = []
    total_readings = 0
    by_id = {l["id"]: l for l in locs}
    for key in sorted(cells):
        hour, lid = key
        kept = []
        for v in cells[key]:
            total_readings += 1
            x = float(v)
            if rc["min"] <= x <= rc["max"]:
                kept.append(v)
            else:
                odd.append("%s at %02d:00 = %s" % (by_id[lid]["city"], hour, v))
                quarantined.append(qrow(date, hour, by_id[lid], v, "outside %g to %g" % (rc["min"], rc["max"])))
        if kept:
            in_range[key] = kept
    if not odd:
        checks.append({"name": "range", "status": "pass",
                       "detail": "All %s lie between %g and %g." % (plural(total_readings, "reading"), rc["min"], rc["max"])})
    else:
        frac = len(odd) / float(max(total_readings, 1))
        status = "fail" if frac > rc["fail_fraction"] else "warn"
        checks.append({"name": "range", "status": status,
                       "detail": "%s of %d set aside (%s), e.g. %s." % (
                           plural(len(odd), "reading"), total_readings,
                           "too many to trust the day" if status == "fail" else "few enough to load the rest", odd[0])})

    # 4. uniqueness ---------------------------------------------------------
    dup_same, dup_conflict = [], []
    good = {}
    for key in sorted(in_range):
        vals = in_range[key]
        if len(vals) == 1:
            good[key] = vals[0]
            continue
        if len({float(v) for v in vals}) == 1:
            dup_same.append(key)
            good[key] = vals[0]
        else:
            dup_conflict.append(key)
            for v in vals:
                quarantined.append(qrow(date, key[0], by_id[key[1]], v, "conflicting duplicate"))
    def name_key(k):
        return "%s at %02d:00" % (by_id[k[1]]["city"], k[0])
    if dup_conflict:
        checks.append({"name": "uniqueness", "status": "fail",
                       "detail": "%s with two different readings, e.g. %s." % (plural(len(dup_conflict), "city-hour"), name_key(dup_conflict[0]))})
    elif dup_same:
        checks.append({"name": "uniqueness", "status": "warn",
                       "detail": "%s repeated with the same reading; one copy kept." % plural(len(dup_same), "city-hour")})
    else:
        checks.append({"name": "uniqueness", "status": "pass",
                       "detail": "No city has two readings for the same hour."})

    # 5. completeness -------------------------------------------------------
    cc = check_cfg(contract, "completeness")
    short = []
    for region in sorted(sources):
        if region not in {l["region"] for l in locs}:
            continue
        n = len(set(sources[region].get("_hours", [])))
        if n < cc["hours"]:
            short.append((region, n))
    if any(n == 0 for _, n in short):
        checks.append({"name": "completeness", "status": "fail",
                       "detail": "The source has no rows for this day (%s)." % ", ".join(r.upper() for r, n in short if n == 0)})
    elif short:
        checks.append({"name": "completeness", "status": "warn",
                       "detail": "Only %s." % "; ".join("%d of %d hours in the %s file" % (n, cc["hours"], r.upper()) for r, n in short)})
    else:
        checks.append({"name": "completeness", "status": "pass",
                       "detail": "All %d hours are in the file." % cc["hours"]})

    # 6. volume -------------------------------------------------------------
    vc = check_cfg(contract, "volume")
    per_city = {l["id"]: 0 for l in locs}
    for (hour, lid) in good:
        per_city[lid] += 1
    expected = cc["hours"] * len(locs)
    total = sum(per_city.values())
    thin = [(by_id[lid]["city"], n) for lid, n in per_city.items() if n < vc["min_hours_per_city"]]
    if total < vc["fail_below_fraction"] * expected:
        checks.append({"name": "volume", "status": "fail",
                       "detail": "Only %d of %d expected readings; too few to load." % (total, expected)})
    elif thin:
        checks.append({"name": "volume", "status": "warn",
                       "detail": "%s; high-risk hours there may be missed (%d of %d readings in all)." % (
                           "; ".join("%s had readings for %d of 24 hours" % t for t in thin), total, expected)})
    else:
        checks.append({"name": "volume", "status": "pass",
                       "detail": "%d of %d readings; every city had at least %d hours." % (total, expected, vc["min_hours_per_city"])})

    # 7. freshness ----------------------------------------------------------
    fc = check_cfg(contract, "freshness")
    if not live:
        checks.append({"name": "freshness", "status": "skip",
                       "detail": "Read from a monthly archive, so the live feed's age does not apply."})
    else:
        newest = [s.get("newest") for s in sources.values() if s.get("newest")]
        if not newest or now is None:
            checks.append({"name": "freshness", "status": "fail", "detail": "Could not tell how new the source is."})
        else:
            oldest_newest = min(parse_hour(n) for n in newest)
            age = (now - oldest_newest).total_seconds() / 3600.0
            if age <= fc["max_age_hours"]:
                checks.append({"name": "freshness", "status": "pass",
                               "detail": "The feed's newest hour was %.1f hours old." % max(age, 0)})
            else:
                checks.append({"name": "freshness", "status": "warn",
                               "detail": "The feed's newest hour was %.1f hours old (limit %d)." % (age, fc["max_age_hours"])})

    status = worst(c["status"] for c in checks)
    rows = []
    if status != "fail":
        thr = contract["high_risk_threshold"]
        for (hour, lid) in sorted(good, key=lambda k: (k[0], order(locs, k[1]))):
            x = float(good[(hour, lid)])
            r = reported(x)
            rows.append({
                "date": date, "hour_utc": hour, "location_id": lid, "city": by_id[lid]["city"],
                "aqhi": "%.2f" % x, "aqhi_reported": "10+" if r > 10 else str(r),
                "high_risk": 1 if r >= thr else 0,
            })
    return checks, rows, quarantined


def finish(contract, checks):
    names = [c["name"] for c in contract["checks"]]
    done = {c["name"] for c in checks}
    for n in names:
        if n not in done:
            checks.append({"name": n, "status": "skip", "detail": "Not run, because an earlier check failed."})
    return checks


def order(locs, lid):
    for i, l in enumerate(locs):
        if l["id"] == lid:
            return i
    return 99


def qrow(date, hour, loc, value, reason):
    return {"date": date, "hour_utc": hour, "location_id": loc["id"], "city": loc["city"],
            "value": value, "reason": reason}


def parse_hour(s):
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
