"""Almanac pipeline: AQHI observations for seven western Canadian cities.

    python -I projects/almanac/pipeline/run.py --date 2026-11-01
    python -I projects/almanac/pipeline/run.py --backfill 2026-08-04 2026-11-01

extract -> validate (contract.json) -> load (data/raw, data/validated) -> aggregate
(data/aggregates) -> append a run record (data/runs.ndjson). Standard library only.

Rerunning a day on the same source gives byte-identical partitions and summary.
"""
import argparse
import csv
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import date as Date, datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)  # python -I does not add the script's folder to the path
import contract as C  # noqa: E402

VERSION = "almanac-pipeline 1.0"
USER_AGENT = "almanac-pipeline/1.0 (+https://milbirguram.github.io/projects/almanac/)"
DEFAULT_DATA = os.path.normpath(os.path.join(HERE, "..", "data"))
VALIDATED_COLS = ["date", "hour_utc", "location_id", "city", "aqhi", "aqhi_reported", "high_risk"]
QUARANTINE_COLS = ["date", "hour_utc", "location_id", "city", "value", "reason"]


# --------------------------------------------------------------------------- time

def utcnow():
    return datetime.now(timezone.utc).replace(microsecond=0)


def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(s):
    s = s.strip().replace("Z", "+00:00")
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def days(start, end):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


# --------------------------------------------------------------------------- extract

class Fetcher:
    """One request at a time, a pause between requests, a few polite retries.
    With source_dir set, files are read from disk by their URL's file name (tests, replays)."""

    def __init__(self, source_dir=None, pause=1.0):
        self.source_dir = source_dir
        self.pause = pause
        self.cache = {}
        self.last = 0.0
        self.downloaded = 0
        self.errors = {}

    def get(self, url):
        """Return (bytes, fresh) or (None, False) when the file does not exist."""
        if url in self.cache:
            return self.cache[url], False
        if url in self.errors:  # do not hammer a server that just failed us
            raise self.errors[url]
        if self.source_dir:
            path = os.path.join(self.source_dir, url.rsplit("/", 1)[-1])
            data = None
            if os.path.exists(path):
                with open(path, "rb") as f:
                    data = f.read()
            self.cache[url] = data
            return data, data is not None
        data = None
        for attempt in range(3):
            wait = self.pause - (time.time() - self.last)
            if wait > 0:
                time.sleep(wait)
            self.last = time.time()
            try:
                req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
                with urllib.request.urlopen(req, timeout=30) as resp:
                    data = resp.read()
                break
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    break
                if attempt == 2:
                    self.errors[url] = e
                    raise
            except (urllib.error.URLError, TimeoutError) as e:
                if attempt == 2:
                    self.errors[url] = e
                    raise
            time.sleep(2 ** attempt * 2)
        self.cache[url] = data
        if data is not None:
            self.downloaded += len(data)
        return data, data is not None


def fill(template, **kw):
    out = template
    for k, v in kw.items():
        out = out.replace("{" + k + "}", v)
    return out


def hourly_snapshot(fetcher, contract, region, now, resolved):
    """The newest hourly file (it holds the last 168 hours). Tries back hourly_lookback_hours."""
    if region in resolved:  # already fetched in this run: reuse it, and do not count it twice
        got = resolved[region]
        return None if got is None else (got[0], got[1], got[2], False)
    top = now.replace(minute=0, second=0, microsecond=0)
    for back in range(0, lookback_hours(contract) + 1):
        t = top - timedelta(hours=back)
        url = fill(contract["source"]["hourly_url"], yyyymmdd=t.strftime("%Y%m%d"),
                   yyyymmddhh=t.strftime("%Y%m%d%H"), region=region, REGION=region.upper())
        data, fresh = fetcher.get(url)
        if data is not None:
            resolved[region] = (data, url, "hourly snapshot", fresh)
            return resolved[region]
    resolved[region] = None
    return None


def lookback_hours(contract):
    return int(contract["source"].get("hourly_lookback_hours", 8))


def expects_live(contract, day, now, mode):
    """Whether this run should read the live hourly feed for `day`."""
    recent = (now.date() - day).days <= contract["source"]["hourly_window_days"]
    return mode == "hourly" or (mode == "auto" and recent)


def monthly_archive(fetcher, contract, region, day, want_revised=True):
    for suffix, label in (("_BACKFILLED", "revised monthly archive"), ("", "monthly archive")):
        if suffix and not want_revised:
            continue
        url = fill(contract["source"]["monthly_url"], yyyymm=day.strftime("%Y%m"),
                   region=region, REGION=region.upper(), suffix=suffix)
        data, fresh = fetcher.get(url)
        if data is not None:
            return data, url, label, fresh
    return None


def choose_source(fetcher, contract, region, day, now, mode, resolved):
    """auto: the live hourly file if it still covers the day, otherwise the monthly archive."""
    if expects_live(contract, day, now, mode):
        got = hourly_snapshot(fetcher, contract, region, now, resolved)
        if got is not None or mode == "hourly":
            return got
    return monthly_archive(fetcher, contract, region, day)


def parse_source(data, date_str, date_col):
    text = data.decode("utf-8-sig").replace("\r\n", "\n").replace("\r", "\n")
    lines = [l for l in text.split("\n") if l.strip() != ""]
    if not lines:
        return {"header": [], "rows": [], "newest": None, "raw_lines": []}
    header = next(csv.reader([lines[0]]))
    header = [h.strip() for h in header]
    di = header.index(date_col) if date_col in header else 0
    hi = header.index("Hour (UTC)") if "Hour (UTC)" in header else 1
    rows, raw_lines, newest = [], [lines[0]], None
    for line in lines[1:]:
        row = next(csv.reader([line]))
        d = row[di].strip() if di < len(row) else ""
        try:
            stamp = "%sT%02d:00:00Z" % (d, int(row[hi]))
            datetime.strptime(stamp, "%Y-%m-%dT%H:%M:%SZ")
            if newest is None or stamp > newest:
                newest = stamp
        except (ValueError, IndexError):
            pass
        if d == date_str:
            rows.append(row)
            raw_lines.append(line)
    return {"header": header, "rows": rows, "newest": newest, "raw_lines": raw_lines}


# --------------------------------------------------------------------------- load

def write_text(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="") as f:
        f.write(text)
    os.replace(tmp, path)
    return len(text.encode("utf-8"))


def csv_text(cols, rows):
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(cols)
    for r in rows:
        w.writerow([r[c] for c in cols])
    return buf.getvalue()


def partition(data_dir, layer, day, suffix):
    return os.path.join(data_dir, layer, day.strftime("%Y-%m"), day.isoformat() + suffix)


def process_day(day, ctx):
    contract, fetcher, data_dir = ctx["contract"], ctx["fetcher"], ctx["data_dir"]
    now = ctx["now"]()
    started = now
    ds = day.isoformat()
    record = {
        "run_id": "%s-%s" % (started.strftime("%Y%m%dT%H%M%SZ"), ds),
        "batch_id": ctx["batch_id"], "kind": ctx["kind"], "date": ds,
        "started_at": iso(started), "finished_at": None, "status": "fail", "loaded": False,
        "source": [], "rows_in": 0, "rows_out": 0, "quarantined": 0, "bytes_written": 0,
        "checks": [], "notes": [], "pipeline": VERSION, "commit": (os.environ.get("GITHUB_SHA") or "")[:7] or None,
    }
    try:
        regions = sorted({l["region"] for l in contract["locations"]})
        sources, raws = {}, {}
        for region in regions:
            got = choose_source(fetcher, contract, region, day, now, ctx["source_mode"], ctx["resolved"])
            live_wanted = expects_live(contract, day, now, ctx["source_mode"])
            if got is None:
                if live_wanted:
                    record["notes"].append("No live %s file in the last %d hours, and no monthly archive covers this day yet: "
                                           "the feed seems to have stalled." % (region.upper(), lookback_hours(contract)))
                else:
                    record["notes"].append("No %s file covers this day; the source may not offer it any more." % region.upper())
                sources[region] = {"absent": "live" if live_wanted else "archive", "lookback_hours": lookback_hours(contract)}
                continue
            if live_wanted and got[2] != "hourly snapshot":
                record["notes"].append("No live %s file in the last %d hours, so the day was read from the %s."
                                       % (region.upper(), lookback_hours(contract), got[2]))
            data, url, label, fresh = got
            parsed = parse_source(data, ds, contract["columns"]["date"])
            sources[region] = parsed
            raws[region] = parsed["raw_lines"]
            record["source"].append({"region": region, "url": url, "type": label, "bytes": len(data), "downloaded": fresh})
        live = bool(record["source"]) and all(s["type"] == "hourly snapshot" for s in record["source"])
        locs = contract["locations"]
        for region, s in sources.items():
            idx = {n: i for i, n in enumerate(s.get("header", []))}
            for row in s.get("rows", []):
                for l in locs:
                    if l["region"] == region and l["id"] in idx and idx[l["id"]] < len(row) and row[idx[l["id"]]].strip():
                        record["rows_in"] += 1
        checks, rows, quarantined = C.validate(contract, ds, sources, now=now, live=live)
        record["checks"] = checks
        record["status"] = C.worst(c["status"] for c in checks)
        record["quarantined"] = len(quarantined)
        qpath = partition(data_dir, "quarantine", day, ".csv")
        if record["status"] != "fail":
            written = 0
            for region in regions:
                if region in raws:
                    written += write_text(partition(data_dir, "raw", day, "." + region + ".csv"), "\n".join(raws[region]) + "\n")
            written += write_text(partition(data_dir, "validated", day, ".csv"), csv_text(VALIDATED_COLS, rows))
            if quarantined:
                written += write_text(qpath, csv_text(QUARANTINE_COLS, quarantined))
            elif os.path.exists(qpath):
                os.remove(qpath)
            record["rows_out"] = len(rows)
            record["bytes_written"] = written
            record["loaded"] = True
        else:
            kept = os.path.exists(partition(data_dir, "validated", day, ".csv"))
            record["kept_earlier"] = kept
            record["notes"].append("The contract failed, so nothing was loaded for this day."
                                   + (" The day's earlier load is kept and still counted." if kept else ""))
            if quarantined:
                record["bytes_written"] = write_text(qpath, csv_text(QUARANTINE_COLS, quarantined))
    except Exception as e:  # a crash is still a run, and the log should say so
        record["status"] = "fail"
        record["notes"].append("The run stopped with an error: %s: %s" % (type(e).__name__, e))
        names = {c["name"] for c in record["checks"]}
        for c in contract["checks"]:
            if c["name"] not in names:
                record["checks"].append({"name": c["name"], "status": "skip", "detail": "Not run, because the run stopped early."})
    record["finished_at"] = iso(ctx["now"]())
    append_run(data_dir, record)
    return record


def append_run(data_dir, record):
    path = os.path.join(data_dir, "runs.ndjson")
    os.makedirs(data_dir, exist_ok=True)
    with open(path, "a", encoding="utf-8", newline="") as f:
        f.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")


def read_runs(data_dir):
    path = os.path.join(data_dir, "runs.ndjson")
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        return [json.loads(l) for l in f if l.strip()]


# --------------------------------------------------------------------------- aggregate

def dumps(obj):
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def walk(root, suffix):
    out = []
    if not os.path.isdir(root):
        return out
    for dirpath, _, files in os.walk(root):
        for name in files:
            if name.endswith(suffix):
                out.append(os.path.join(dirpath, name))
    return sorted(out)


PREVIEW_DAYS = 91
OLD_FIELDS = ["status", "kind", "kinds", "runs", "rows_in", "rows_out", "q", "loaded", "checks", "src", "kept"]
STATUS_CODE = {"pass": "p", "warn": "w", "fail": "f", "none": "n"}
KIND_CODE = {"scheduled": "s", "manual": "m", "backfill": "b", "revision": "r"}
SRC_CODE = {"hourly snapshot": "H", "monthly archive": "M", "revised monthly archive": "R"}


def _inverse(d):
    return {v: k for k, v in d.items()}


def pack_day(item):
    """A calendar entry as a short tuple in OLD_FIELDS order (a day with no run is ["n"])."""
    if item["status"] == "none":
        return ["n"]
    return [STATUS_CODE[item["status"]], KIND_CODE[item["kind"]], "".join(KIND_CODE[k] for k in item["kinds"]),
            item["runs"], item["rows_in"], item["rows_out"], item["q"], 1 if item["loaded"] else 0, item["checks"],
            "".join(SRC_CODE.get(x, "?") for x in item["src"].split(",") if x), item.get("kept", 0)]


def calendar_items(health):
    """Every calendar day as a dict, old packed days first (mirrors expandCalendar in model.js)."""
    out = []
    old = health.get("calendar_old") or {"days": []}
    if old["days"]:
        first = Date.fromisoformat(old["first"])
        st, kd, sr = _inverse(STATUS_CODE), _inverse(KIND_CODE), _inverse(SRC_CODE)
        for i, t in enumerate(old["days"]):
            ds = (first + timedelta(days=i)).isoformat()
            if t[0] == "n":
                out.append({"date": ds, "status": "none"})
                continue
            item = dict(zip(old["fields"], t))
            item.update({"date": ds, "status": st[t[0]], "kind": kd[item["kind"]], "kinds": [kd[c] for c in item["kinds"]],
                         "loaded": bool(item["loaded"]), "src": ",".join(sorted(sr.get(c, c) for c in item["src"]))})
            if not item["kept"]:
                del item["kept"]
            out.append(item)
    return out + list(health.get("calendar", []))


def build_aggregates(data_dir, contract, known_issues):
    locs = contract["locations"]
    thr = contract["high_risk_threshold"]
    vfiles = walk(os.path.join(data_dir, "validated"), ".csv")
    per = {}  # date -> lid -> [hi, max, n, maxlabel, maxhour]
    latest_hour = None
    vrows = 0
    for path in vfiles:
        ds = os.path.basename(path)[:10]
        day = per.setdefault(ds, {})
        with open(path, encoding="utf-8", newline="") as f:
            for r in csv.DictReader(f):
                vrows += 1
                s = day.setdefault(r["location_id"], [0, 0.0, 0, "", -1])
                x = float(r["aqhi"])
                s[0] += 1 if C.reported(x) >= thr else 0
                if x > s[1]:
                    s[1], s[3], s[4] = x, r["aqhi_reported"], int(r["hour_utc"])
                s[2] += 1
                stamp = "%sT%02d:00:00Z" % (ds, int(r["hour_utc"]))
                if latest_hour is None or stamp > latest_hour:
                    latest_hour = stamp
    runs = read_runs(data_dir)
    run_dates = sorted({r["date"] for r in runs})
    all_dates = sorted(set(per) | set(run_dates))
    if not all_dates:
        return None
    start = Date.fromisoformat(min(per) if per else all_dates[0])
    end = Date.fromisoformat(all_dates[-1])
    dates = [d.isoformat() for d in days(start, end)]

    # ---- summary: the answer to the question
    cities, series = [], {}
    for l in locs:
        hi, mx, n = [], [], []
        tot_hi = tot_n = loaded_days = 0
        peak, peak_label, peak_at, worst_day, worst_hi = 0.0, "", None, None, 0
        for ds in dates:
            s = per.get(ds, {}).get(l["id"]) if ds in per else None
            if ds not in per:
                hi.append(None); mx.append(None); n.append(None)
                continue
            loaded_days += 1
            if s is None:
                hi.append(0); mx.append(None); n.append(0)
                continue
            hi.append(s[0]); mx.append(C.reported(s[1])); n.append(s[2])  # max as reported: 11 = 10+
            tot_hi += s[0]; tot_n += s[2]
            if s[1] > peak:
                peak, peak_label, peak_at = s[1], s[3], "%sT%02d:00:00Z" % (ds, s[4])
            if s[0] > worst_hi:
                worst_hi, worst_day = s[0], ds
        series[l["id"]] = {"hi": hi, "max": mx, "n": n}
        cities.append({"id": l["id"], "city": l["city"], "zone": l["zone"], "high_hours": tot_hi,
                       "hours_with_reading": tot_n, "hours_possible": loaded_days * 24,
                       "peak": round(peak, 2), "peak_label": peak_label, "peak_at": peak_at,
                       "worst_day": worst_day, "worst_day_hours": worst_hi})
    loaded_dates = sorted(per)
    summary = {
        "question": "How many hours has the air been high-risk (AQHI 7 or more) in western Canadian cities?",
        "threshold": thr, "first_date": dates[0], "last_date": dates[-1],
        "first_loaded": loaded_dates[0] if loaded_dates else None,
        "last_loaded": loaded_dates[-1] if loaded_dates else None,
        "days_loaded": len(loaded_dates), "latest_hour": latest_hour,
        "dates": dates, "cities": cities, "series": series,
        "attribution": contract["source"]["attribution"],
    }

    # ---- health: the pipeline's account of itself
    # The most recent `detail_days` keep a full entry each (ids, times, every check's words).
    # Older days are packed into short tuples (see OLD_FIELDS) so the file stays inside its
    # budget however long the pipeline runs; model.js and calendar_items() unpack them.
    by_date = {}
    for r in runs:
        e = by_date.setdefault(r["date"], {"runs": 0, "kinds": []})
        e["runs"] += 1
        if r["kind"] not in e["kinds"]:
            e["kinds"].append(r["kind"])
        e["last"] = r
    detail_from = (end - timedelta(days=contract["budgets"]["detail_days"] - 1)).isoformat()
    names = [c["name"] for c in contract["checks"]]
    status_char = {"pass": "p", "warn": "w", "fail": "f", "skip": "s"}
    cal, old = [], []
    for ds in dates:
        e = by_date.get(ds)
        if not e:
            item = {"date": ds, "status": "none"}
        else:
            r = e["last"]
            res = {c["name"]: c for c in r["checks"]}
            item = {
                "date": ds, "status": r["status"], "kind": r["kind"], "runs": e["runs"], "kinds": e["kinds"],
                "rows_in": r["rows_in"], "rows_out": r["rows_out"], "q": r["quarantined"],
                "loaded": r["loaded"], "src": ",".join(sorted({s["type"] for s in r["source"]})),
                "checks": "".join(status_char[res[n]["status"]] if n in res else "s" for n in names),
            }
            if not r["loaded"] and ds in per:
                # refused, but an earlier load of this day is still in data/validated and counted
                item["kept"] = sum(v[2] for v in per[ds].values())
        if ds < detail_from:
            old.append(pack_day(item))
            continue
        if e:
            r = e["last"]
            res = {c["name"]: c for c in r["checks"]}
            item.update({"run_id": r["run_id"], "started": r["started_at"], "finished": r["finished_at"],
                         "bytes": r["bytes_written"],
                         "details": [res[n]["detail"] if n in res else "" for n in names]})
            if r["notes"]:
                item["notes"] = r["notes"]
        cal.append(item)
    latest = runs[-1] if runs else None
    totals = {"runs": len(runs), "kinds": {}, "statuses": {}}
    for r in runs:
        totals["kinds"][r["kind"]] = totals["kinds"].get(r["kind"], 0) + 1
        totals["statuses"][r["status"]] = totals["statuses"].get(r["status"], 0) + 1
    raw_files = walk(os.path.join(data_dir, "raw"), ".csv")
    q_files = walk(os.path.join(data_dir, "quarantine"), ".csv")
    q_rows = 0
    for p in q_files:
        with open(p, encoding="utf-8") as f:
            q_rows += max(0, sum(1 for _ in f) - 1)
    src_bytes = sum(s["bytes"] for r in runs for s in r["source"] if s.get("downloaded"))
    health = {
        "contract": {"name": contract["name"], "version": contract["version"],
                     "checks": [{"name": c["name"], "title": c["title"], "plain": c["plain"]} for c in contract["checks"]],
                     "slo": contract["slo"]},
        "source": {k: contract["source"][k] for k in ("publisher", "attribution", "licence", "licence_url", "docs_url")},
        "latest_hour": latest_hour,
        "latest_run": None if latest is None else {k: latest[k] for k in (
            "run_id", "kind", "date", "started_at", "finished_at", "status", "rows_in", "rows_out", "quarantined", "notes")},
        "calendar_old": {"first": dates[0], "fields": OLD_FIELDS, "days": old},
        "calendar": cal, "check_names": names, "totals": totals,
        "lineage": {
            "source": {"downloaded_bytes": src_bytes, "files": len({s["url"] for r in runs for s in r["source"]})},
            "raw": {"files": len(raw_files), "bytes": sum(os.path.getsize(p) for p in raw_files)},
            "validated": {"files": len(vfiles), "rows": vrows, "bytes": sum(os.path.getsize(p) for p in vfiles)},
            "quarantine": {"files": len(q_files), "rows": q_rows},
            "runs_log": {"records": len(runs), "bytes": os.path.getsize(os.path.join(data_dir, "runs.ndjson")) if runs else 0},
            "aggregates": {"bytes": 0, "budget": contract["budgets"]["aggregates_bytes"]},
        },
        "known_issues": known_issues,
    }

    # ---- preview: a tiny precomputed snapshot for the projects card (no fetch in preview)
    # Only the last PREVIEW_DAYS: the card has room for about thirteen weeks of squares.
    full_cal = calendar_items({"calendar_old": {"first": dates[0], "fields": OLD_FIELDS, "days": old}, "calendar": cal})
    k0 = max(0, len(dates) - PREVIEW_DAYS)
    win = {l["id"]: sum(h or 0 for h in series[l["id"]]["hi"][k0:]) for l in locs}
    top = max(locs, key=lambda l: (win[l["id"]], -locs.index(l)))
    letter = {"pass": "g", "warn": "a", "fail": "r", "none": "n"}
    preview = {
        "city": top["city"], "total": win[top["id"]], "first": dates[k0], "last": dates[-1],
        "cal": "".join(letter.get(c["status"], "n") for c in full_cal[k0:]),
        "backfill": "".join("s" if "scheduled" in c.get("kinds", []) else "b" for c in full_cal[k0:]),
        "hi": [h if h is not None else 0 for h in series[top["id"]]["hi"][k0:]],
    }
    preview_text = "window.ALMANAC_PREVIEW=" + dumps(preview) + ";\n"
    summary_text = dumps(summary) + "\n"
    agg = os.path.join(data_dir, "aggregates")
    for _ in range(3):  # health includes its own size; settle it
        health_text = dumps(health) + "\n"
        size = len(summary_text.encode()) + len(health_text.encode()) + len(preview_text.encode())
        health["lineage"]["aggregates"]["bytes"] = size
    health_text = dumps(health) + "\n"
    write_text(os.path.join(agg, "summary.json"), summary_text)
    write_text(os.path.join(agg, "health.json"), health_text)
    write_text(os.path.join(agg, "preview.js"), preview_text)
    return {"summary": summary, "health": health, "bytes": size}


# --------------------------------------------------------------------------- cli

def main(argv=None):
    p = argparse.ArgumentParser(description="Almanac: daily AQHI pipeline with a data contract.")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--date", help="process one UTC day, YYYY-MM-DD")
    g.add_argument("--backfill", nargs=2, metavar=("START", "END"), help="process every day from START to END")
    g.add_argument("--aggregate-only", action="store_true", help="rebuild data/aggregates from stored data")
    p.add_argument("--kind", choices=["scheduled", "manual", "backfill", "revision"],
                   help="label for the run log (default: scheduled under a GitHub cron, backfill for --backfill, else manual)")
    p.add_argument("--source", choices=["auto", "hourly", "monthly"], default="auto",
                   help="auto reads the live hourly file while it still covers the day, else the monthly archive")
    p.add_argument("--now", help="pretend the clock reads this ISO time (tests)")
    p.add_argument("--data-dir", default=DEFAULT_DATA)
    p.add_argument("--source-dir", help="read source files from this folder instead of the network")
    p.add_argument("--contract", help="path to contract.json")
    p.add_argument("--pause", type=float, default=1.0, help="seconds between requests")
    a = p.parse_args(argv)

    contract = C.load_contract(a.contract)
    with open(os.path.join(HERE, "known_issues.json"), encoding="utf-8") as f:
        known = json.load(f)
    fixed = parse_iso(a.now) if a.now else None
    now = (lambda: fixed) if fixed else utcnow
    data_dir = os.path.abspath(a.data_dir)

    if a.aggregate_only:
        out = build_aggregates(data_dir, contract, known)
        print("aggregates: %s bytes" % (out["bytes"] if out else 0))
        return 0

    if a.backfill:
        start, end = Date.fromisoformat(a.backfill[0]), Date.fromisoformat(a.backfill[1])
        if end < start:
            p.error("END is before START")
        kind = a.kind or "backfill"
    else:
        start = end = Date.fromisoformat(a.date)
        kind = a.kind or ("scheduled" if os.environ.get("GITHUB_EVENT_NAME") == "schedule" else "manual")
    if end >= now().date():
        p.error("a day can only be processed once it is over (UTC)")

    source_mode = "monthly" if kind == "revision" and a.source == "auto" else a.source
    ctx = {"contract": contract, "fetcher": Fetcher(a.source_dir, a.pause), "data_dir": data_dir,
           "now": now, "kind": kind, "batch_id": "%s-%s" % (kind, now().strftime("%Y%m%dT%H%M%SZ")),
           "source_mode": source_mode, "resolved": {}}
    worst = "pass"
    for day in days(start, end):
        r = process_day(day, ctx)
        worst = C.worst([worst, r["status"]])
        print("%s  %-9s %-5s in %4d out %4d  %s" % (r["date"], r["kind"], r["status"], r["rows_in"], r["rows_out"],
                                                    " ".join("%s:%s" % (c["name"], c["status"]) for c in r["checks"] if c["status"] != "pass")))
    out = build_aggregates(data_dir, contract, known)
    print("downloaded %d bytes; aggregates %d bytes" % (ctx["fetcher"].downloaded, out["bytes"] if out else 0))
    if out and out["bytes"] > contract["budgets"]["aggregates_bytes"]:
        print("WARNING: aggregates are %d bytes, over their %d-byte budget"
              % (out["bytes"], contract["budgets"]["aggregates_bytes"]), file=sys.stderr)
    return 2 if worst == "fail" else 0


if __name__ == "__main__":
    sys.exit(main())
