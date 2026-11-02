"""Each contract check passes clean data and catches a crafted violation.

    python -I -m unittest discover -s projects/almanac/tests -p "test_*.py"
"""
import copy
import os
import sys
import unittest
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fixtures as F  # noqa: E402
from fixtures import C, CONTRACT, DAY  # noqa: E402

NOW = datetime(2026, 8, 16, 7, 17, tzinfo=timezone.utc)


def run(src, live=True, now=NOW):
    checks, rows, q = C.validate(CONTRACT, DAY, src, now=now, live=live)
    return {c["name"]: c for c in checks}, rows, q


class CleanData(unittest.TestCase):
    def test_clean_day_passes_every_check(self):
        res, rows, q = run(F.sources())
        for name in ("schema", "types", "range", "uniqueness", "completeness", "volume", "freshness"):
            self.assertEqual(res[name]["status"], "pass", (name, res[name]["detail"]))
        self.assertEqual(len(rows), 24 * 7)
        self.assertEqual(q, [])

    def test_high_risk_rounding(self):
        _, rows, _ = run(F.sources())
        hi = [r for r in rows if r["high_risk"]]
        self.assertEqual(len(hi), 4)
        self.assertTrue(all(r["city"] == "Kamloops" for r in hi))
        self.assertEqual(C.reported(6.49), 6)
        self.assertEqual(C.reported(6.5), 7)
        self.assertEqual(C.reported(11.0), 11)

    def test_every_check_is_reported_once(self):
        res, _, _ = run(F.sources())
        self.assertEqual(sorted(res), sorted(c["name"] for c in CONTRACT["checks"]))


class Schema(unittest.TestCase):
    def test_missing_city_column_fails_and_loads_nothing(self):
        src = F.sources()
        i = src["pnr"]["header"].index("IAKID")
        src["pnr"]["header"][i] = "IAKIX"
        res, rows, _ = run(src)
        self.assertEqual(res["schema"]["status"], "fail")
        self.assertIn("IAKID", res["schema"]["detail"])
        self.assertEqual(rows, [])
        self.assertEqual(res["volume"]["status"], "skip")

    def test_extra_columns_are_fine(self):
        src = F.sources()
        src["pyr"]["header"].append("ZZNEW")
        for r in src["pyr"]["rows"]:
            r.append("2.00")
        res, _, _ = run(src)
        self.assertEqual(res["schema"]["status"], "pass")


class Types(unittest.TestCase):
    def test_text_in_a_reading_fails(self):
        src = F.sources()
        F.set_cell(src, "pyr", "JBRIK", 5, "n/a")
        res, rows, q = run(src)
        self.assertEqual(res["types"]["status"], "fail")
        self.assertEqual(rows, [])
        self.assertEqual(q[0]["reason"], "not a number")

    def test_bad_hour_fails(self):
        src = F.sources()
        src["pnr"]["rows"][0][1] = "25"
        res, _, _ = run(src)
        self.assertEqual(res["types"]["status"], "fail")

    def test_blank_reading_is_allowed(self):
        src = F.sources()
        F.set_cell(src, "pyr", "JBRIK", 5, "")
        res, rows, _ = run(src)
        self.assertEqual(res["types"]["status"], "pass")
        self.assertEqual(len(rows), 24 * 7 - 1)


class Range(unittest.TestCase):
    def test_one_odd_value_is_set_aside_with_a_warning(self):
        src = F.sources()
        F.set_cell(src, "pyr", "JBOBQ", 3, "-9.00")
        res, rows, q = run(src)
        self.assertEqual(res["range"]["status"], "warn")
        self.assertEqual(len(rows), 24 * 7 - 1)
        self.assertEqual(len(q), 1)
        self.assertEqual(q[0]["city"], "Victoria")

    def test_many_odd_values_fail(self):
        src = F.sources()
        for h in range(4):
            F.set_cell(src, "pnr", "IACMP", h, "120.00")
        res, rows, _ = run(src)
        self.assertEqual(res["range"]["status"], "fail")
        self.assertEqual(rows, [])

    def test_ten_plus_written_as_eleven_is_in_range(self):
        src = F.sources()
        F.set_cell(src, "pnr", "IAKID", 2, "11.00")
        res, rows, _ = run(src)
        self.assertEqual(res["range"]["status"], "pass")
        r = [r for r in rows if r["location_id"] == "IAKID" and r["hour_utc"] == 2][0]
        self.assertEqual(r["aqhi_reported"], "10+")
        self.assertEqual(r["high_risk"], 1)


class Uniqueness(unittest.TestCase):
    def test_conflicting_duplicate_fails(self):
        src = F.sources()
        dup = copy.deepcopy(src["pyr"]["rows"][0])
        dup[src["pyr"]["header"].index("JBRIK")] = "4.00"
        src["pyr"]["rows"].append(dup)
        res, rows, _ = run(src)
        self.assertEqual(res["uniqueness"]["status"], "fail")
        self.assertEqual(rows, [])

    def test_exact_duplicate_warns_and_keeps_one(self):
        src = F.sources()
        src["pnr"]["rows"].append(list(src["pnr"]["rows"][3]))
        res, rows, _ = run(src)
        self.assertEqual(res["uniqueness"]["status"], "warn")
        keys = [(r["hour_utc"], r["location_id"]) for r in rows]
        self.assertEqual(len(keys), len(set(keys)))
        self.assertEqual(len(rows), 24 * 7)


class Completeness(unittest.TestCase):
    def test_missing_hours_warn(self):
        src = F.sources()
        src["pyr"]["rows"] = [r for r in src["pyr"]["rows"] if int(r[1]) not in (0, 1)]
        res, _, _ = run(src)
        self.assertEqual(res["completeness"]["status"], "warn")
        self.assertIn("22 of 24", res["completeness"]["detail"])

    def test_missing_day_fails(self):
        src = F.sources()
        src["pnr"]["rows"] = []
        res, rows, _ = run(src)
        self.assertEqual(res["completeness"]["status"], "fail")
        self.assertEqual(rows, [])


class Volume(unittest.TestCase):
    def test_quiet_city_warns(self):
        src = F.sources()
        for h in range(10):
            F.set_cell(src, "pyr", "JAFUV", h, "")
        res, rows, _ = run(src)
        self.assertEqual(res["volume"]["status"], "warn")
        self.assertIn("Kelowna had readings for 14 of 24 hours", res["volume"]["detail"])
        self.assertEqual(len(rows), 24 * 7 - 10)

    def test_mostly_empty_day_fails(self):
        src = F.sources()
        for station in ("JAFUV", "JAFNW", "JBLVS", "JBOBQ"):
            for h in range(24):
                F.set_cell(src, "pyr", station, h, "")
        res, rows, _ = run(src)
        self.assertEqual(res["volume"]["status"], "fail")
        self.assertEqual(rows, [])


class Freshness(unittest.TestCase):
    def test_stale_feed_warns(self):
        res, _, _ = run(F.sources(newest="2026-08-15T20:00:00Z"))
        self.assertEqual(res["freshness"]["status"], "warn")

    def test_archive_skips(self):
        res, rows, _ = run(F.sources(), live=False)
        self.assertEqual(res["freshness"]["status"], "skip")
        self.assertEqual(len(rows), 24 * 7)

    def test_unknown_age_fails(self):
        res, _, _ = run(F.sources(newest=None))
        self.assertEqual(res["freshness"]["status"], "fail")

    def test_no_live_file_is_a_stalled_feed_not_a_schema_break(self):
        src = F.sources()
        src["pyr"] = {"absent": "live", "lookback_hours": 8}
        res, rows, _ = run(src)
        self.assertEqual(res["freshness"]["status"], "fail")
        self.assertIn("PYR", res["freshness"]["detail"])
        self.assertIn("8 hours", res["freshness"]["detail"])
        self.assertEqual(res["schema"]["status"], "skip")
        self.assertEqual(rows, [])


class NoFile(unittest.TestCase):
    def test_no_archive_file_fails_completeness(self):
        src = F.sources()
        src["pnr"] = None
        res, rows, _ = run(src, live=False)
        self.assertEqual(res["completeness"]["status"], "fail")
        self.assertIn("PNR", res["completeness"]["detail"])
        self.assertEqual(res["schema"]["status"], "skip")
        self.assertEqual(res["freshness"]["status"], "skip")
        self.assertEqual(rows, [])


if __name__ == "__main__":
    unittest.main()
