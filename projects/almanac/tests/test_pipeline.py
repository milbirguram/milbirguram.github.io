"""End-to-end pipeline tests on crafted files read from disk (no network):
idempotency, backfill, failed days keep earlier data, and the run log."""
import filecmp
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fixtures as F  # noqa: E402
import run as R  # noqa: E402  (pipeline/run.py, on the path via fixtures)

DAYS = ["2026-08-14", "2026-08-15", "2026-08-16"]


def write_sources(folder, days=DAYS, broken=None):
    os.makedirs(folder, exist_ok=True)
    for region in ("pyr", "pnr"):
        text = F.csv_file(region, days)
        if broken and broken[0] == region:
            text = broken[1](text)
        name = "202608_MONTHLY_AQHI_%s_SiteObs.csv" % region.upper()
        with open(os.path.join(folder, name), "w", encoding="utf-8", newline="") as f:
            f.write(text)


def tree(folder, skip=("runs.ndjson", "health.json")):
    out = {}
    for dirpath, _, files in os.walk(folder):
        for n in files:
            if n in skip:
                continue
            p = os.path.join(dirpath, n)
            with open(p, "rb") as f:
                out[os.path.relpath(p, folder)] = f.read()
    return out


class Pipeline(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="almanac-test-")
        self.src = os.path.join(self.tmp, "src")
        self.data = os.path.join(self.tmp, "data")
        write_sources(self.src)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def cli(self, *args):
        return R.main(list(args) + ["--source-dir", self.src, "--data-dir", self.data,
                                    "--now", "2026-11-02T07:17:00Z", "--pause", "0"])

    def runs(self):
        with open(os.path.join(self.data, "runs.ndjson"), encoding="utf-8") as f:
            return [json.loads(l) for l in f]

    def test_rerunning_a_day_gives_identical_output(self):
        self.assertEqual(self.cli("--backfill", "2026-08-14", "2026-08-16"), 0)
        first = tree(self.data)
        self.assertEqual(self.cli("--date", "2026-08-15"), 0)
        self.assertEqual(self.cli("--backfill", "2026-08-14", "2026-08-16"), 0)
        second = tree(self.data)
        self.assertEqual(sorted(first), sorted(second))
        for k in first:
            self.assertEqual(first[k], second[k], k)
        self.assertIn(os.path.join("aggregates", "summary.json"), first)
        # the log grows: every run is recorded, including reruns
        self.assertEqual(len(self.runs()), 7)

    def test_backfill_labels_and_partitions(self):
        self.cli("--backfill", "2026-08-14", "2026-08-16")
        runs = self.runs()
        self.assertEqual([r["kind"] for r in runs], ["backfill"] * 3)
        self.assertEqual(len({r["batch_id"] for r in runs}), 1)
        for d in DAYS:
            self.assertTrue(os.path.exists(os.path.join(self.data, "validated", "2026-08", d + ".csv")))
            self.assertTrue(os.path.exists(os.path.join(self.data, "raw", "2026-08", d + ".pyr.csv")))
        with open(os.path.join(self.data, "aggregates", "summary.json"), encoding="utf-8") as f:
            s = json.load(f)
        kam = [c for c in s["cities"] if c["city"] == "Kamloops"][0]
        self.assertEqual(kam["high_hours"], 12)  # 4 smoky hours a day x 3 days
        with open(os.path.join(self.data, "aggregates", "health.json"), encoding="utf-8") as f:
            h = json.load(f)
        self.assertEqual([c["kind"] for c in h["calendar"]], ["backfill"] * 3)
        self.assertEqual(h["calendar"][0]["checks"], "pppppps")

    def test_failed_day_is_logged_and_keeps_earlier_data(self):
        self.cli("--date", "2026-08-15")
        before = tree(os.path.join(self.data, "validated"))
        # the source renames a city column: the contract must refuse the day
        write_sources(self.src, broken=("pnr", lambda t: t.replace("IAKID", "IAKIX")))
        code = self.cli("--date", "2026-08-15")
        self.assertEqual(code, 2)
        last = self.runs()[-1]
        self.assertEqual(last["status"], "fail")
        self.assertFalse(last["loaded"])
        self.assertEqual(tree(os.path.join(self.data, "validated")), before)
        with open(os.path.join(self.data, "aggregates", "health.json"), encoding="utf-8") as f:
            h = json.load(f)
        self.assertEqual(h["calendar"][-1]["status"], "fail")
        self.assertEqual(h["calendar"][-1]["runs"], 2)
        # the refused rerun says the earlier load is still counted, and how much of it
        self.assertTrue(last["kept_earlier"])
        self.assertEqual(h["calendar"][-1]["kept"], 24 * 7)
        with open(os.path.join(self.data, "aggregates", "summary.json"), encoding="utf-8") as f:
            s = json.load(f)
        self.assertEqual(sum(c["high_hours"] for c in s["cities"]), 4)

    def test_missing_archive_is_a_red_run_not_a_crash(self):
        shutil.rmtree(self.src)
        os.makedirs(self.src)
        code = self.cli("--date", "2026-08-15")
        self.assertEqual(code, 2)
        last = self.runs()[-1]
        self.assertEqual(last["status"], "fail")
        self.assertTrue(any("No PYR file" in n for n in last["notes"]))
        res = {c["name"]: c for c in last["checks"]}
        # no file is a missing day, not a renamed column
        self.assertEqual(res["completeness"]["status"], "fail")
        self.assertEqual(res["schema"]["status"], "skip")
        self.assertEqual([c["name"] for c in last["checks"]], [c["name"] for c in F.CONTRACT["checks"]])

    def test_stalled_live_feed_fails_freshness_not_schema(self):
        # What the daily run sees when ECCC's hourly feed has stopped: no live file at all.
        shutil.rmtree(self.src)
        os.makedirs(self.src)
        code = self.cli("--date", "2026-11-01")
        self.assertEqual(code, 2)
        last = self.runs()[-1]
        res = {c["name"]: c for c in last["checks"]}
        self.assertEqual(res["freshness"]["status"], "fail")
        self.assertIn("stalled", res["freshness"]["detail"])
        for name in ("schema", "types", "range", "uniqueness", "completeness", "volume"):
            self.assertEqual(res[name]["status"], "skip", name)
        self.assertTrue(any("stalled" in n for n in last["notes"]))

    def test_live_feed_six_to_eight_hours_old_warns(self):
        # an hourly file from 7 hours ago is found (within the lookback), but its newest hour is old
        for region in ("pyr", "pnr"):
            text = F.csv_file(region, ["2026-11-01"])
            name = "2026110200_AQHI_%s_SiteObs.csv" % region.upper()
            with open(os.path.join(self.src, name), "w", encoding="utf-8", newline="") as f:
                f.write(text)
        self.assertEqual(self.cli("--date", "2026-11-01"), 0)
        last = self.runs()[-1]
        res = {c["name"]: c for c in last["checks"]}
        self.assertEqual(res["freshness"]["status"], "warn")
        self.assertEqual(last["source"][0]["type"], "hourly snapshot")

    def test_refuses_a_day_that_is_not_over(self):
        with self.assertRaises(SystemExit):
            self.cli("--date", "2026-11-02")


if __name__ == "__main__":
    unittest.main()
