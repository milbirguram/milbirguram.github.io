"""The page's aggregates must stay under their 200 KB budget as the record grows.

Builds two years of runs from the real run log and validated partitions (cycled onto new
dates), then checks the aggregates' size and that packed old days unpack to the same
calendar entries as full ones."""
import copy
import json
import os
import shutil
import sys
import tempfile
import unittest
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fixtures as F  # noqa: E402
import run as R  # noqa: E402

REAL = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data"))
YEARS = 2


class Budget(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="almanac-budget-")
        runs = R.read_runs(REAL)
        parts = {}
        for dirpath, _, files in os.walk(os.path.join(REAL, "validated")):
            for n in files:
                with open(os.path.join(dirpath, n), encoding="utf-8") as f:
                    parts[n[:10]] = f.read()
        src_days = sorted(parts)
        start = date(2026, 1, 1)
        out = []
        for i in range(365 * YEARS):
            d = start + timedelta(days=i)
            ds, sd = d.isoformat(), src_days[i % len(src_days)]
            text = parts[sd].replace(sd, ds)
            R.write_text(R.partition(cls.tmp, "validated", d, ".csv"), text)
            r = copy.deepcopy([x for x in runs if x["date"] == sd][-1])
            r["date"] = ds
            r["run_id"] = r["run_id"][:17] + ds
            r["kind"] = "scheduled" if i % 3 else "backfill"
            out.append(json.dumps(r, sort_keys=True))
        with open(os.path.join(cls.tmp, "runs.ndjson"), "w", encoding="utf-8", newline="") as f:
            f.write("\n".join(out) + "\n")
        with open(os.path.join(R.HERE, "known_issues.json"), encoding="utf-8") as f:
            cls.known = json.load(f)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_two_years_fit_the_budget(self):
        out = R.build_aggregates(self.tmp, F.CONTRACT, self.known)
        budget = F.CONTRACT["budgets"]["aggregates_bytes"]
        self.assertLess(out["bytes"], budget, "two years of aggregates are %d bytes" % out["bytes"])
        on_disk = sum(os.path.getsize(os.path.join(self.tmp, "aggregates", n))
                      for n in ("summary.json", "health.json", "preview.js"))
        self.assertEqual(on_disk, out["bytes"])
        h = out["health"]
        self.assertEqual(len(h["calendar"]), F.CONTRACT["budgets"]["detail_days"])
        self.assertEqual(len(R.calendar_items(h)), 365 * YEARS)

    def test_packed_days_unpack_to_the_full_entries(self):
        packed = R.calendar_items(R.build_aggregates(self.tmp, F.CONTRACT, self.known)["health"])
        wide = copy.deepcopy(F.CONTRACT)
        wide["budgets"]["detail_days"] = 10000
        full = R.build_aggregates(self.tmp, wide, self.known)["health"]["calendar"]
        self.assertEqual(len(packed), len(full))
        keys = R.OLD_FIELDS + ["date"]
        for a, b in zip(packed, full):
            self.assertEqual({k: a.get(k) for k in keys}, {k: b.get(k) for k in keys}, a["date"])


if __name__ == "__main__":
    unittest.main()
