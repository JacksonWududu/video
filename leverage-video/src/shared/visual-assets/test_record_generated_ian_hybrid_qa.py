from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest


SCRIPT_PATH = Path(__file__).with_name("record-generated-ian-hybrid-qa.py")


def load_recorder():
    spec = importlib.util.spec_from_file_location("ian_hybrid_recorder", SCRIPT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("recorder cannot be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class IanHybridStrictRevisionTest(unittest.TestCase):
    def test_legacy_flattened_recorder_is_read_only(self):
        recorder = load_recorder()
        with self.assertRaisesRegex(ValueError, "completed-history read-only"):
            recorder.record(object())

    def test_accepts_changes_requested_strict_revision(self):
        recorder = load_recorder()
        self.assertTrue(recorder.is_strict_revision_candidate({
            "strict_review": True,
            "is_revision": True,
            "status": "changes_requested",
        }))

    def test_rejects_ordinary_strict_item(self):
        recorder = load_recorder()
        self.assertFalse(recorder.is_strict_revision_candidate({
            "strict_review": True,
            "is_revision": False,
            "status": "changes_requested",
        }))

    def test_strict_revision_reference_order_binds_prior_raster_then_style(self):
        recorder = load_recorder()
        profile = {
            "style_anchor_path": ".agents/skills/ian-handdrawn-ppt/assets/reference.png",
            "style_anchor_checksum_sha256": "a" * 64,
        }
        revision_source = {
            "path": "episode/assets/image/rejected/prior.png",
            "checksum_sha256": "b" * 64,
        }
        self.assertEqual(
            recorder.expected_reference_inputs(profile, revision_source),
            [
                {
                    "role": "edit_target_prior_presented_raster",
                    "path": revision_source["path"],
                    "checksum_sha256": revision_source["checksum_sha256"],
                },
                {
                    "role": "visual_style_reference_only",
                    "path": profile["style_anchor_path"],
                    "checksum_sha256": profile["style_anchor_checksum_sha256"],
                },
            ],
        )

    def test_strict_revision_pause_enters_visual_review_phase(self):
        recorder = load_recorder()
        state = {
            "phase": "visual_production",
            "current_phase": "visual_production",
            "visual_asset_review": {
                "queue_generation_allowed": True,
                "current_asset_id": None,
            },
        }
        recorder.pause_for_strict_revision(state, "S20-ian-v01")
        self.assertEqual(state["phase"], "awaiting_visual_asset_review")
        self.assertEqual(state["current_phase"], "awaiting_visual_asset_review")
        self.assertFalse(state["visual_asset_review"]["queue_generation_allowed"])
        self.assertEqual(
            state["visual_asset_review"]["current_asset_id"],
            "S20-ian-v01",
        )

    def test_v2_text_container_evidence_binds_every_exact_label(self):
        recorder = load_recorder()
        evidence = {
            "contract_version": "ian-text-container-qa-evidence-v1",
            "result": "pass",
            "asset_id": "S17-ian-v01",
            "raster": {"path": "episode/generated/S17.png", "checksum_sha256": "a" * 64},
            "inspection": {
                "regions": [
                    {"text": "不保证马上成功", "result": "pass"},
                    {"text": "一次结果≠无法改变", "result": "pass"},
                    {"text": "两个问题", "result": "pass"},
                ]
            },
        }
        recorder.validate_text_container_evidence(
            evidence,
            asset_id="S17-ian-v01",
            exact_visible_text="不保证马上成功｜一次结果≠无法改变｜两个问题",
            generated_source={
                "path": "episode/generated/S17.png",
                "checksum_sha256": "a" * 64,
            },
        )

    def test_v2_text_container_evidence_rejects_missing_label(self):
        recorder = load_recorder()
        evidence = {
            "contract_version": "ian-text-container-qa-evidence-v1",
            "result": "pass",
            "asset_id": "S17-ian-v01",
            "raster": {"path": "episode/generated/S17.png", "checksum_sha256": "a" * 64},
            "inspection": {
                "regions": [
                    {"text": "不保证马上成功", "result": "pass"},
                    {"text": "两个问题", "result": "pass"},
                ]
            },
        }
        with self.assertRaisesRegex(ValueError, "complete exact label list"):
            recorder.validate_text_container_evidence(
                evidence,
                asset_id="S17-ian-v01",
                exact_visible_text="不保证马上成功｜一次结果≠无法改变｜两个问题",
                generated_source={
                    "path": "episode/generated/S17.png",
                    "checksum_sha256": "a" * 64,
                },
            )


if __name__ == "__main__":
    unittest.main()
