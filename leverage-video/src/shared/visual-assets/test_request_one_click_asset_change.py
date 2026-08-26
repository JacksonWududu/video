from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().with_name("request-one-click-asset-change.py")


def load_module():
    spec = importlib.util.spec_from_file_location("request_one_click_asset_change", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load one-click asset change requester")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class OneClickAssetChangeCliTests(unittest.TestCase):
    def test_request_during_production_requeues_named_family(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            workspace = root / "episode"
            (workspace / "schema").mkdir(parents=True)
            state = {
                "phase": "visual_production",
                "current_phase": "visual_production",
                "visual_asset_review": {
                    "contract_version": "visual-asset-review-v3",
                    "mode": "one_click_final_review_v1",
                    "queue_generation_allowed": True,
                    "current_asset_id": "S11-ian-v01",
                    "queue": [
                        {
                            "asset_id": "S10-master-v01",
                            "status": "qa_passed_pending_final_review",
                            "strict_review": True,
                            "active_for_current_storyboard": True,
                            "depends_on": [],
                            "path": "episode/assets/S10-master.png",
                            "checksum_sha256": "1" * 64,
                            "batch_qa_checksum_sha256": "1" * 64,
                        },
                        {
                            "asset_id": "S10-action-01-v01",
                            "status": "qa_passed_pending_final_review",
                            "strict_review": False,
                            "active_for_current_storyboard": True,
                            "depends_on": ["S10-master-v01"],
                            "path": "episode/assets/S10-action.png",
                            "checksum_sha256": "2" * 64,
                        },
                        {
                            "asset_id": "S11-ian-v01",
                            "status": "pending_generation",
                            "strict_review": False,
                            "active_for_current_storyboard": True,
                            "depends_on": [],
                        },
                    ],
                },
            }
            state_path = workspace / "schema/episode-state.json"
            state_path.write_text(json.dumps(state), encoding="utf-8")
            module.REPOSITORY_ROOT = root

            result = module.request_change(argparse.Namespace(
                episode_workspace="episode",
                asset_id="S10-master-v01",
                decision_message="手机背面不能发光",
                decision_time="2026-08-26T01:20:00+08:00",
            ))

            updated = json.loads(state_path.read_text(encoding="utf-8"))
            queue = updated["visual_asset_review"]["queue"]
            self.assertEqual(result["change_scope"], "unpresented_prefinal_asset_family")
            self.assertEqual(result["affected_asset_ids"], [
                "S10-master-v01", "S10-action-01-v01",
            ])
            self.assertEqual(queue[0]["status"], "changes_requested")
            self.assertTrue(queue[0]["strict_review"])
            self.assertNotIn("path", queue[0])
            self.assertEqual(queue[1]["status"], "pending_generation")
            self.assertNotIn("path", queue[1])
            self.assertEqual(queue[2]["status"], "pending_generation")
            self.assertEqual(
                updated["visual_asset_review"]["current_asset_id"],
                "S10-master-v01",
            )

    def test_request_archives_pending_digest_and_requeues_only_named_asset(self) -> None:
        module = load_module()
        gate = module.load_gate()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            workspace = root / "episode"
            (workspace / "schema").mkdir(parents=True)
            state = {
                "phase": "awaiting_precomposition_visual_review",
                "current_phase": "awaiting_precomposition_visual_review",
                "visual_asset_review": {
                    "contract_version": "visual-asset-review-v3",
                    "mode": "one_click_final_review_v1",
                    "storyboard_sha256": "a" * 64,
                    "policy_sha256": "b" * 64,
                    "queue_generation_allowed": True,
                    "queue": [
                        {
                            "asset_id": "S16-ian-v01",
                            "path": "episode/assets/S16.png",
                            "checksum_sha256": "1" * 64,
                            "status": "qa_passed_pending_final_review",
                            "active_for_current_storyboard": True,
                            "depends_on": [],
                        },
                        {
                            "asset_id": "S17-ian-v01",
                            "path": "episode/assets/S17.png",
                            "checksum_sha256": "2" * 64,
                            "status": "qa_passed_pending_final_review",
                            "active_for_current_storyboard": True,
                            "depends_on": [],
                        },
                    ],
                },
            }
            gate.present_one_click_final_visual_review(state)
            state_path = workspace / "schema/episode-state.json"
            state_path.write_text(json.dumps(state), encoding="utf-8")
            module.REPOSITORY_ROOT = root

            result = module.request_change(argparse.Namespace(
                episode_workspace="episode",
                asset_id="S17-ian-v01",
                decision_message="文字越出方框",
                decision_time="2026-08-24T10:00:00+08:00",
            ))

            updated = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(result["status"], "changes_requested")
            self.assertEqual(updated["current_phase"], "visual_production")
            self.assertNotIn("final_review", updated["visual_asset_review"])
            self.assertEqual(
                updated["visual_asset_review"]["queue"][0]["status"],
                "qa_passed_pending_final_review",
            )


if __name__ == "__main__":
    unittest.main()
