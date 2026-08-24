from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest


SCRIPT = Path(__file__).resolve().with_name("record-white-cat-imagegen-qa-failure.py")


def load_module():
    spec = importlib.util.spec_from_file_location("white_cat_qa_failure", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load white-cat QA failure recorder")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def failure(checksum: str, index: int) -> dict:
    return {
        "prompt": {"path": f"prompt-{index}.txt", "checksum_sha256": "a" * 64},
        "output": {"path": f"output-{index}.png", "checksum_sha256": checksum},
        "failure_reason": "P2_SATCHEL_TOPOLOGY: rear path failed",
        "error_code": "P2_SATCHEL_TOPOLOGY",
        "qa_time": f"2026-08-21T18:00:0{index}+08:00",
    }


class WhiteCatQaFailureAttemptLimitTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.module = load_module()

    def test_third_failure_stops_retry_and_requires_user_takeover(self) -> None:
        item = {"asset_id": "S18-master-v01", "status": "changes_requested"}
        review = {"queue_generation_allowed": True, "current_asset_id": "S18-master-v01"}
        for index, checksum in enumerate(("1" * 64, "2" * 64, "3" * 64), start=1):
            control = self.module.apply_failure_control(item, review, failure(checksum, index))
        self.assertEqual(control["qa_failed_generation_count"], 3)
        self.assertEqual(control["automatic_retry_status"], self.module.STOP_STATUS)
        self.assertFalse(review["queue_generation_allowed"])
        self.assertTrue(review["user_takeover_required"])
        self.assertIn("请用户接手", review["user_takeover_message"])

    def test_duplicate_output_does_not_increase_attempt_count(self) -> None:
        item = {"asset_id": "S18-master-v01", "status": "changes_requested"}
        review = {"queue_generation_allowed": True, "current_asset_id": "S18-master-v01"}
        first = failure("1" * 64, 1)
        self.module.apply_failure_control(item, review, first)
        with self.assertRaisesRegex(ValueError, "already recorded"):
            self.module.apply_failure_control(item, review, first)
        self.assertEqual(len(item["white_cat_imagegen_qa_failures"]), 1)

    def test_generic_failure_reason_is_rejected(self) -> None:
        item = {"asset_id": "S18-master-v01", "status": "changes_requested"}
        review = {"queue_generation_allowed": True, "current_asset_id": "S18-master-v01"}
        invalid = failure("1" * 64, 1)
        invalid.pop("error_code")
        with self.assertRaisesRegex(ValueError, "stable P0/P2 error code"):
            self.module.apply_failure_control(item, review, invalid)
        self.assertNotIn("white_cat_imagegen_qa_failures", item)


if __name__ == "__main__":
    unittest.main()
