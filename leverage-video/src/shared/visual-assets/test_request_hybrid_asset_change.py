from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest


SCRIPT = Path(__file__).resolve().with_name("request-hybrid-asset-change.py")


def load_module():
    spec = importlib.util.spec_from_file_location("request_hybrid_asset_change", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load hybrid asset change requester")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def queued(asset_id: str, status: str) -> dict:
    return {
        "asset_id": asset_id,
        "status": status,
        "strict_review": False,
        "active_for_current_storyboard": True,
    }


class PrebatchHybridAssetChangeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.module = load_module()
        cls.gate = cls.module.load_gate()

    def test_requeues_unpresented_qa_pass_without_making_it_strict(self) -> None:
        state = {
            "current_phase": "visual_production",
            "visual_asset_review": {
                "mode": "hybrid_batch_v1",
                "queue_generation_allowed": True,
                "current_asset_id": "S20-ian-v01",
                "queue": [
                    queued("S19-action-01-v01", "qa_passed_pending_batch_review"),
                    queued("S19-action-02-v01", "qa_passed_pending_batch_review"),
                    queued("S19-action-03-v01", "qa_passed_pending_batch_review"),
                    queued("S20-ian-v01", "pending_generation"),
                ],
            },
        }

        item = self.module.record_prebatch_change(
            state,
            self.gate,
            "S19-action-02-v01",
            "动作态挎包翻到错误解剖侧",
            "2026-08-21T23:20:00+08:00",
        )

        self.assertEqual(item["status"], "changes_requested")
        self.assertFalse(item["strict_review"])
        self.assertFalse(item["is_revision"])
        self.assertEqual(
            state["visual_asset_review"]["current_asset_id"],
            "S19-action-02-v01",
        )
        self.assertTrue(state["visual_asset_review"]["queue_generation_allowed"])
        self.assertEqual(
            state["visual_asset_review"]["queue"][2]["status"],
            "qa_passed_pending_batch_review",
        )

    def test_multiple_prebatch_changes_keep_earliest_item_current(self) -> None:
        state = {
            "current_phase": "visual_production",
            "visual_asset_review": {
                "mode": "hybrid_batch_v1",
                "queue_generation_allowed": True,
                "current_asset_id": "S20-ian-v01",
                "queue": [
                    queued("S19-action-02-v01", "qa_passed_pending_batch_review"),
                    queued("S19-action-03-v01", "qa_passed_pending_batch_review"),
                    queued("S20-ian-v01", "pending_generation"),
                ],
            },
        }

        self.module.record_prebatch_change(
            state,
            self.gate,
            "S19-action-02-v01",
            "动作态 2 翻侧",
            "2026-08-21T23:20:00+08:00",
        )
        self.module.record_prebatch_change(
            state,
            self.gate,
            "S19-action-03-v01",
            "动作态 3 翻侧",
            "2026-08-21T23:20:01+08:00",
        )

        review = state["visual_asset_review"]
        self.assertEqual(review["queue"][0]["status"], "changes_requested")
        self.assertEqual(review["queue"][1]["status"], "changes_requested")
        self.assertEqual(review["current_asset_id"], "S19-action-02-v01")


if __name__ == "__main__":
    unittest.main()
