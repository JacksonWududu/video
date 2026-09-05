from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest


SCRIPT = Path(__file__).resolve().with_name("record-image-generation-qa-failure.py")


def load_module():
    spec = importlib.util.spec_from_file_location("image_generation_qa_failure", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load image-generation QA failure recorder")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def failure(checksum: str, index: int, prompt_version: int = 1) -> dict:
    return {
        "prompt": {
            "path": f"prompt-v{prompt_version}.txt",
            "checksum_sha256": f"{prompt_version:x}" * 64,
        },
        "output": {"path": f"output-{index}.png", "checksum_sha256": checksum},
        "failure_reason": "visible pseudo-text rejected",
        "qa_time": f"2026-08-25T10:00:0{index}+08:00",
    }


def ian_geometry_finding(checksum: str, index: int) -> dict:
    value = failure(checksum, index)
    value["failure_reason"] = (
        "IAN_ZONE_GEOMETRY_AND_SUBTITLE_SAFE_BAND: "
        "semantic groups are intact and separated but miss their approved zones"
    )
    return value


class ImageGenerationQaFailureAttemptLimitTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.module = load_module()

    def test_third_failure_stops_every_generated_storyboard_image_route(self) -> None:
        for route in sorted(self.module.GENERATED_STORYBOARD_IMAGE_ROUTES):
            with self.subTest(route=route):
                item = {
                    "asset_id": f"asset-{route}",
                    "shot_id": "S01",
                    "role": route,
                    "status": "pending_generation",
                    "visual_generation_route": route,
                }
                review = {"queue_generation_allowed": True, "current_asset_id": item["asset_id"]}
                for index, checksum in enumerate(("1" * 64, "2" * 64, "3" * 64), start=1):
                    control = self.module.apply_failure_control(
                        item, review, failure(checksum, index, prompt_version=index)
                    )
                self.assertEqual(control["rejected_generation_count"], 3)
                self.assertEqual(control["automatic_retry_status"], self.module.STOP_STATUS)
                self.assertFalse(review["queue_generation_allowed"])
                self.assertTrue(review["user_takeover_required"])

    def test_prompt_revision_does_not_reset_failure_count(self) -> None:
        item = {"asset_id": "S16-ian-v02", "shot_id": "S16", "role": "standalone-graphic"}
        review = {"queue_generation_allowed": True, "current_asset_id": item["asset_id"]}
        for index, checksum in enumerate(("a" * 64, "b" * 64, "c" * 64), start=1):
            control = self.module.apply_failure_control(
                item, review, failure(checksum, index, prompt_version=index)
            )
        self.assertEqual(control["rejected_generation_count"], 3)
        self.assertEqual(len(item["image_generation_qa_failures"]), 3)

    def test_duplicate_output_does_not_increase_count(self) -> None:
        item = {"asset_id": "S16-ian-v02", "shot_id": "S16", "role": "standalone-graphic"}
        review = {"queue_generation_allowed": True, "current_asset_id": item["asset_id"]}
        first = failure("d" * 64, 1)
        self.module.apply_failure_control(item, review, first)
        with self.assertRaisesRegex(ValueError, "already recorded"):
            self.module.apply_failure_control(item, review, first)
        self.assertEqual(len(item["image_generation_qa_failures"]), 1)

    def test_no_fourth_automatic_attempt_after_stop(self) -> None:
        item = {"asset_id": "S16-ian-v02", "shot_id": "S16", "role": "standalone-graphic"}
        review = {"queue_generation_allowed": True, "current_asset_id": item["asset_id"]}
        for index, checksum in enumerate(("1" * 64, "2" * 64, "3" * 64), start=1):
            self.module.apply_failure_control(item, review, failure(checksum, index))
        with self.assertRaisesRegex(ValueError, "user takeover required"):
            self.module.apply_failure_control(item, review, failure("4" * 64, 4))
        self.assertEqual(len(item["image_generation_qa_failures"]), 3)

    def test_takeover_stop_moves_episode_to_visual_review_boundary(self) -> None:
        state = {
            "phase": "visual_production",
            "current_phase": "visual_production",
        }

        self.module.mark_state_awaiting_user_takeover(state)

        self.assertEqual(state["phase"], "awaiting_visual_asset_review")
        self.assertEqual(state["current_phase"], "awaiting_visual_asset_review")

    def test_repairable_ian_geometry_does_not_consume_rejected_generation_limit(self) -> None:
        item = {
            "asset_id": "S04-ian-v01",
            "shot_id": "S04",
            "role": "standalone-graphic",
            "status": "pending_generation",
            "visual_generation_route": "ian-handdrawn-ppt",
        }
        review = {"queue_generation_allowed": True, "current_asset_id": item["asset_id"]}

        control = self.module.apply_failure_control(
            item,
            review,
            ian_geometry_finding("e" * 64, 1),
        )

        self.assertEqual(control["rejected_generation_count"], 0)
        self.assertEqual(
            control["automatic_retry_status"],
            "deterministic_layout_repair_required",
        )
        self.assertNotIn("image_generation_qa_failures", item)
        self.assertEqual(len(item["image_generation_repairable_findings"]), 1)
        self.assertEqual(
            item["image_generation_repairable_findings"][0]["disposition"],
            "deterministic_repair_required",
        )
        self.assertEqual(item["image_generation_repairable_findings"][0]["attempt_number"], 1)
        self.assertFalse(review["queue_generation_allowed"])
        self.assertTrue(review["ian_layout_repair_required"])
        self.assertNotIn("user_takeover_required", review)

    def test_ian_semantic_failure_still_consumes_rejected_generation_limit(self) -> None:
        item = {
            "asset_id": "S04-ian-v01",
            "shot_id": "S04",
            "role": "standalone-graphic",
            "status": "pending_generation",
            "visual_generation_route": "ian-handdrawn-ppt",
        }
        review = {"queue_generation_allowed": True, "current_asset_id": item["asset_id"]}

        control = self.module.apply_failure_control(
            item,
            review,
            failure("f" * 64, 1),
        )

        self.assertEqual(control["rejected_generation_count"], 1)
        self.assertEqual(control["automatic_retry_status"], "retry_allowed")
        self.assertEqual(len(item["image_generation_qa_failures"]), 1)
        self.assertNotIn("image_generation_repairable_findings", item)

    def test_geometry_code_is_not_repairable_for_non_ian_route(self) -> None:
        item = {
            "asset_id": "S04-imagegen-v01",
            "shot_id": "S04",
            "role": "standalone-graphic",
            "status": "pending_generation",
            "visual_generation_route": "imagegen",
        }
        review = {"queue_generation_allowed": True, "current_asset_id": item["asset_id"]}

        control = self.module.apply_failure_control(
            item,
            review,
            ian_geometry_finding("9" * 64, 1),
        )

        self.assertEqual(control["rejected_generation_count"], 1)
        self.assertEqual(control["automatic_retry_status"], "retry_allowed")


if __name__ == "__main__":
    unittest.main()
