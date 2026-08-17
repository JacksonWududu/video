#!/usr/bin/env python3
from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import pathlib
import tempfile
import unittest


SCRIPT_DIR = pathlib.Path(__file__).resolve().parents[1] / "scripts"
REPO = SCRIPT_DIR.parents[3]
SPEC = importlib.util.spec_from_file_location("whiteboard_contract", SCRIPT_DIR / "whiteboard_contract.py")
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("cannot load whiteboard contract")
CONTRACT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CONTRACT)


def valid_annotation(scene_class="narrative_illustration"):
    text = "甲乙"
    return {
        "contract_version": "whiteboard-annotation-v2",
        "shot_id": "S01",
        "visual_generation_route": "srt-whiteboard-animation",
        "white_cat_present": False,
        "scene_class": scene_class,
        "canvas": {"width": 1920, "height": 1080, "fps": 30},
        "source_image_sha256": "a" * 64,
        "normalized_image_sha256": "b" * 64,
        "locked_source_text": text,
        "total_frames": 45,
        "final_hold_frames": 15,
        "subtitle_safe_area": {"x": 0, "y": 850, "width": 1920, "height": 230},
        "visible_text_mode": "none",
        "approved_visible_text": [],
        "approved_text_placement": None,
        "text_layers": [],
        "performing_subject_present": False,
        "action_family_policy": None,
        "elements": [
            {
                "id": "first",
                "sequence": 1,
                "semantic_role": "铺垫",
                "type": "object",
                "subtitle_span": {"start": 0, "end": 1, "text": "甲"},
                "region": {"x": 120, "y": 100, "width": 500, "height": 500},
                "protected_regions": [],
                "start_frame": 0,
                "end_frame": 8,
            },
            {
                "id": "second",
                "sequence": 2,
                "semantic_role": "结果",
                "type": "object",
                "subtitle_span": {"start": 1, "end": 2, "text": "乙"},
                "region": {"x": 900, "y": 120, "width": 500, "height": 500},
                "protected_regions": [],
                "start_frame": 8,
                "end_frame": 20,
            },
        ],
    }


def visual_direction_review(annotation):
    mode = annotation["visible_text_mode"]
    exact = annotation["approved_visible_text"][0] if mode == "required" else None
    placement = annotation["approved_text_placement"]
    presented = "c" * 64
    return {
        "contract_version": "per-shot-visual-direction-review-v3",
        "presented_map_sha256": presented,
        "rows": [{
            "shot_id": annotation["shot_id"],
            "scene_class": annotation["scene_class"],
            "visible_text_mode": mode,
            "exact_visible_text": exact,
            "visible_text_placement": placement,
            "user_selection": {
                "status": "approved",
                "white_cat_present": False,
                "visual_generation_route": "srt-whiteboard-animation",
                "presented_map_sha256": presented,
                "visible_text_mode": mode,
                "exact_visible_text": exact,
                "visible_text_placement": placement,
            },
        }],
    }


def validate_bound(annotation, review=None):
    with tempfile.TemporaryDirectory(prefix="whiteboard-contract-", dir=REPO / "leverage-video" / "src") as directory:
        root = pathlib.Path(directory)
        schema = root / "schema"
        schema.mkdir()
        review = review or visual_direction_review(annotation)
        review_path = schema / "per-shot-visual-direction-review-v3.json"
        review_path.write_text(json.dumps(review, ensure_ascii=False), encoding="utf-8")
        review_relative = review_path.relative_to(REPO).as_posix()
        annotation["visual_direction_review_path"] = review_relative
        annotation["visual_direction_review_sha256"] = hashlib.sha256(review_path.read_bytes()).hexdigest()
        annotation["presented_map_sha256"] = review["presented_map_sha256"]
        (schema / "episode-state.json").write_text(json.dumps({
            "visual_direction_review": {
                "status": "approved",
                "artifact_path": review_relative,
                "artifact_checksum_sha256": annotation["visual_direction_review_sha256"],
                "presented_map_sha256": annotation["presented_map_sha256"],
            },
        }), encoding="utf-8")
        return CONTRACT.validate_annotation(annotation, episode_workspace=root)


class WhiteboardContractTests(unittest.TestCase):
    def test_accepts_no_cat_narrative_annotation(self):
        self.assertEqual(validate_bound(valid_annotation())["shot_id"], "S01")

    def test_rejects_white_cat(self):
        annotation = valid_annotation()
        annotation["white_cat_present"] = True
        with self.assertRaisesRegex(ValueError, "white cat"):
            validate_bound(annotation)

    def test_rejects_narrative_visible_text(self):
        annotation = valid_annotation()
        annotation["visible_text_mode"] = "required"
        annotation["approved_visible_text"] = ["错误"]
        annotation["approved_text_placement"] = "画面中央"
        annotation["text_layers"] = [{"text": "错误", "region": {"x": 1, "y": 1, "width": 100, "height": 50}}]
        with self.assertRaisesRegex(ValueError, "reject visible text"):
            validate_bound(annotation)

    def test_accepts_only_exact_approved_structured_chinese(self):
        annotation = valid_annotation("structured_graphic")
        annotation["visible_text_mode"] = "required"
        annotation["approved_visible_text"] = ["因果"]
        annotation["approved_text_placement"] = "画面中央"
        annotation["text_layers"] = [{"text": "因果", "region": {"x": 700, "y": 40, "width": 150, "height": 60}}]
        review = visual_direction_review(annotation)
        validate_bound(annotation, review)
        changed = copy.deepcopy(annotation)
        changed["text_layers"][0]["text"] = "因果。"
        with self.assertRaisesRegex(ValueError, "exact order"):
            validate_bound(changed, review)

    def test_rejects_overlapping_times_and_safe_area_intrusion(self):
        annotation = valid_annotation()
        annotation["elements"][1]["start_frame"] = 7
        with self.assertRaisesRegex(ValueError, "must not overlap"):
            validate_bound(annotation)
        annotation = valid_annotation()
        annotation["elements"][1]["region"] = {"x": 900, "y": 800, "width": 500, "height": 100}
        with self.assertRaisesRegex(ValueError, "subtitle safe area"):
            validate_bound(annotation)

    def test_route_only_action_family_replacement_is_required(self):
        annotation = valid_annotation()
        annotation["performing_subject_present"] = True
        with self.assertRaisesRegex(ValueError, "route-only action-family replacement"):
            validate_bound(annotation)
        annotation["action_family_policy"] = "whiteboard-element-sequence-replaces-action-family-v1"
        validate_bound(annotation)

    def test_rejects_self_declared_text_or_stale_v3_binding(self):
        annotation = valid_annotation("structured_graphic")
        annotation["visible_text_mode"] = "required"
        annotation["approved_visible_text"] = ["因果"]
        annotation["approved_text_placement"] = "画面中央"
        annotation["text_layers"] = [{"text": "因果", "region": {"x": 700, "y": 40, "width": 150, "height": 60}}]
        review = visual_direction_review(annotation)
        changed = copy.deepcopy(annotation)
        changed["approved_visible_text"] = ["结果"]
        changed["text_layers"][0]["text"] = "结果"
        with self.assertRaisesRegex(ValueError, "does not equal v3"):
            validate_bound(changed, review)
        stale = copy.deepcopy(review)
        stale["presented_map_sha256"] = "d" * 64
        with self.assertRaisesRegex(ValueError, "presented-map"):
            validate_bound(annotation, stale)

    def test_rejects_a_v3_artifact_that_is_not_current_in_episode_state(self):
        annotation = valid_annotation()
        with tempfile.TemporaryDirectory(prefix="whiteboard-current-", dir=REPO / "leverage-video" / "src") as directory:
            root = pathlib.Path(directory)
            schema = root / "schema"
            schema.mkdir()
            review = visual_direction_review(annotation)
            review_path = schema / "per-shot-visual-direction-review-v3.json"
            review_path.write_text(json.dumps(review), encoding="utf-8")
            annotation["visual_direction_review_path"] = review_path.relative_to(REPO).as_posix()
            annotation["visual_direction_review_sha256"] = hashlib.sha256(review_path.read_bytes()).hexdigest()
            annotation["presented_map_sha256"] = review["presented_map_sha256"]
            (schema / "episode-state.json").write_text(json.dumps({
                "visual_direction_review": {
                    "status": "approved",
                    "artifact_path": f"{root.relative_to(REPO).as_posix()}/schema/other-v3.json",
                    "artifact_checksum_sha256": annotation["visual_direction_review_sha256"],
                    "presented_map_sha256": annotation["presented_map_sha256"],
                },
            }), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "not the current episode-state artifact"):
                CONTRACT.validate_annotation(annotation, episode_workspace=root)

    def test_v1_is_legacy_read_only_only(self):
        annotation = valid_annotation()
        annotation["contract_version"] = "whiteboard-annotation-v1"
        annotation.pop("approved_text_placement")
        with self.assertRaisesRegex(ValueError, "unsupported"):
            CONTRACT.validate_annotation(annotation)
        self.assertEqual(
            CONTRACT.validate_annotation(annotation, allow_legacy_read_only=True)["shot_id"],
            "S01",
        )


if __name__ == "__main__":
    unittest.main()
