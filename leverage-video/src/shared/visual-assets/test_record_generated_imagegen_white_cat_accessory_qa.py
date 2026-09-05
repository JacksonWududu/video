#!/usr/bin/env python3
from __future__ import annotations

import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


SCRIPT_DIR = Path(__file__).resolve().parent
STRICT_PATH = SCRIPT_DIR / "record-generated-imagegen-strict.py"
ACTION_PATH = SCRIPT_DIR / "record-generated-imagegen-hybrid-qa.py"


def load_strict_recorder():
    spec = importlib.util.spec_from_file_location("white_cat_strict_recorder", STRICT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load strict ImageGen recorder")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def valid_identity_qa() -> dict:
    return {
        "cat_count": 1,
        "foreleg_count": 2,
        "hindleg_count": 2,
        "paw_count": 4,
        "accessory_geometry_correct": True,
        "satchel_count": 1,
        "bag_strap_count": 2,
        "bag_end_attachment_count": 2,
        "front_strap_attached_to_forward_bag_end": True,
        "rear_strap_attached_to_rear_bag_end": True,
        "himation_trim_distinct_from_bag_straps": True,
        "satchel_anatomical_flank": "right",
        "cat_facing_screen_direction": "three-quarter-screen-left",
        "anatomical_front_maps_to_screen": "screen-left",
        "anatomical_rear_maps_to_screen": "screen-right",
        "front_path_screen_vector": "up-left across sternum and front throat",
        "rear_path_screen_vector": "up-right behind shoulder and neck",
        "front_path_trace": [
            "forward_bag_end",
            "front_bag_end_ring_or_loop",
            "wide_plain_blue_front_path",
            "front_lower_neck_or_upper_chest",
        ],
        "rear_path_trace": [
            "rear_bag_end",
            "rear_bag_end_ring_or_loop",
            "wide_plain_blue_rear_path",
            "behind_neck_or_upper_back",
        ],
        "both_bag_end_anchors_visibly_traceable": True,
        "strap_paths_spatially_distinct": True,
        "topology_authority": "primary-three-quarter-plus-p2-text",
        "source_retry_policy_compliant": True,
    }


class WhiteCatAccessoryQaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.recorder = load_strict_recorder()

    def test_accepts_exact_two_end_satchel_topology(self) -> None:
        self.recorder.validate_white_cat_accessory_qa(valid_identity_qa())

    def test_rejects_missing_forward_end_connection(self) -> None:
        identity = copy.deepcopy(valid_identity_qa())
        identity["front_strap_attached_to_forward_bag_end"] = False
        with self.assertRaisesRegex(ValueError, "P2 satchel strap"):
            self.recorder.validate_white_cat_accessory_qa(identity)

    def test_rejects_himation_trim_substitution(self) -> None:
        identity = copy.deepcopy(valid_identity_qa())
        identity["himation_trim_distinct_from_bag_straps"] = False
        with self.assertRaisesRegex(ValueError, "P2 satchel strap"):
            self.recorder.validate_white_cat_accessory_qa(identity)

    def test_rejects_wrong_strap_or_attachment_counts(self) -> None:
        for field, value in (("satchel_count", 2), ("bag_strap_count", 1), ("bag_end_attachment_count", 1)):
            with self.subTest(field=field):
                identity = copy.deepcopy(valid_identity_qa())
                identity[field] = value
                with self.assertRaisesRegex(ValueError, "P2 satchel strap"):
                    self.recorder.validate_white_cat_accessory_qa(identity)

    def test_rejects_satchel_on_wrong_or_unreported_anatomical_flank(self) -> None:
        for value in ("left", "", None):
            with self.subTest(value=value):
                identity = copy.deepcopy(valid_identity_qa())
                identity["satchel_anatomical_flank"] = value
                with self.assertRaisesRegex(ValueError, "anatomical right flank"):
                    self.recorder.validate_white_cat_accessory_qa(identity)

    def test_rejects_pre_flank_legacy_identity_for_new_qa(self) -> None:
        identity = copy.deepcopy(valid_identity_qa())
        identity.pop("satchel_anatomical_flank")
        with self.assertRaisesRegex(ValueError, "anatomical right flank"):
            self.recorder.validate_white_cat_accessory_qa(identity)

    def test_rejects_missing_directional_path_evidence(self) -> None:
        for field, value in (
            ("front_path_screen_vector", ""),
            ("rear_path_trace", []),
            ("both_bag_end_anchors_visibly_traceable", False),
            ("strap_paths_spatially_distinct", False),
            ("source_retry_policy_compliant", False),
        ):
            with self.subTest(field=field):
                identity = copy.deepcopy(valid_identity_qa())
                identity[field] = value
                with self.assertRaisesRegex(ValueError, "P2 directional path"):
                    self.recorder.validate_white_cat_accessory_qa(identity)

    def test_rejects_same_screen_vector_for_both_paths(self) -> None:
        identity = copy.deepcopy(valid_identity_qa())
        identity["rear_path_screen_vector"] = identity["front_path_screen_vector"]
        with self.assertRaisesRegex(ValueError, "P2 directional path"):
            self.recorder.validate_white_cat_accessory_qa(identity)

    def test_prompt_contract_requires_anatomical_routes_anchors_and_trim_distinction(self) -> None:
        valid = """
        WHITE-CAT SATCHEL STRAP LOCK:
        WHITE-CAT ANATOMICAL-SIDE CONTINUITY LOCK:
        Keep the satchel on the anatomical right flank; do not mirror the character from the approved master.
        Front path crosses the front upper chest and enters the forward bag-end D-ring.
        Rear path passes behind the neck and rear shoulder into the rear bag-end D-ring.
        Robe trim is clothing and never a strap.
        """
        self.recorder.validate_white_cat_prompt_contract(valid)
        with self.assertRaisesRegex(ValueError, "P2 path evidence"):
            self.recorder.validate_white_cat_prompt_contract(
                "WHITE-CAT SATCHEL STRAP LOCK: exactly two blue straps."
            )

    def test_prompt_contract_rejects_missing_anatomical_side_lock(self) -> None:
        with self.assertRaisesRegex(ValueError, "anatomical-side continuity"):
            self.recorder.validate_white_cat_prompt_contract("""
                WHITE-CAT SATCHEL STRAP LOCK:
                Front path crosses the front chest into the forward bag-end ring.
                Rear path passes behind the neck into the rear bag-end ring.
                Robe trim is clothing and never a strap.
            """)

    def test_rejects_pre_marker_legacy_prompt_for_new_qa(self) -> None:
        with self.assertRaisesRegex(ValueError, "anatomical-side continuity"):
            self.recorder.validate_white_cat_prompt_contract(
                """
                WHITE-CAT SATCHEL STRAP LOCK:
                Front path crosses the front chest into the forward bag-end ring.
                Rear path passes behind the neck into the rear bag-end ring.
                Robe trim is clothing and never a strap.
                """
            )

    def test_master_and_action_recorders_require_prompt_marker_and_shared_qa(self) -> None:
        strict_text = STRICT_PATH.read_text(encoding="utf-8")
        action_text = ACTION_PATH.read_text(encoding="utf-8")
        self.assertIn("WHITE_CAT_SATCHEL_PROMPT_MARKER", strict_text)
        self.assertIn("helper.validate_white_cat_prompt_contract(", action_text)
        self.assertNotIn("unchanged_legacy_requeue", action_text)
        self.assertIn("selected_source=qa[\"selected_source\"]", strict_text)
        self.assertIn("selected_source_file=source", strict_text)
        self.assertIn("helper.validate_white_cat_identity_qa_v2(", action_text)

    def test_gate2_gilded_style_binding_drives_prompt_and_qa(self) -> None:
        selection = {
            "contract_version": "white-cat-visual-style-selection-v1",
            "gate2_script_sha256": "a" * 64,
            "style_id": "gilded-mythic-storybook",
            "treatment_profile_id": "imagegen-gilded-mythic-narrative",
            "visual_cohesion_profile_id": "gilded-mythic-cohesion-v1",
            "style_skill_path": "/tmp/style-skill",
            "style_skill_checksum_sha256": "b" * 64,
            "style_profile_path": "/tmp/gilded-profile",
            "style_profile_checksum_sha256": "c" * 64,
            "decision": {
                "status": "selected",
                "exact_message": "选择鎏金秘境绘本",
                "decided_at": "2026-08-26T10:00:00+08:00",
            },
        }
        selection["selection_sha256"] = self.recorder._canonical_sha256(selection)
        item = {
            "white_cat_visual_style_id": "gilded-mythic-storybook",
            "white_cat_visual_style_selection_sha256": selection["selection_sha256"],
            "visual_cohesion_profile_id": "gilded-mythic-cohesion-v1",
            "treatment_profile_id": "imagegen-gilded-mythic-narrative",
        }
        style_id, cohesion_id, current = self.recorder.resolve_white_cat_visual_style_binding(
            {"white_cat_visual_style_selection": selection}, item
        )
        self.assertEqual((style_id, cohesion_id, current), (
            "gilded-mythic-storybook", "gilded-mythic-cohesion-v1", True
        ))
        qa = {"white_cat_visual_style_binding": {
            "style_id": style_id,
            "selection_sha256": selection["selection_sha256"],
            "visual_cohesion_profile_id": cohesion_id,
        }}
        self.recorder.validate_white_cat_style_prompt_and_qa(
            prompt_text=(
                "WHITE-CAT VISUAL STYLE: gilded-mythic-storybook. "
                "EPISODE VISUAL COHESION: gilded-mythic-cohesion-v1."
            ),
            qa=qa,
            style_id=style_id,
            cohesion_id=cohesion_id,
            selection_sha256=selection["selection_sha256"],
            current_binding=current,
        )
        item["visual_cohesion_profile_id"] = "warm-paper-watercolor-cohesion-v1"
        with self.assertRaisesRegex(ValueError, "stale, mixed, or substituted"):
            self.recorder.resolve_white_cat_visual_style_binding(
                {"white_cat_visual_style_selection": selection}, item
            )

    def test_cover_derived_v2_binding_requires_episode_profile_marker(self) -> None:
        selection = {
            "contract_version": "white-cat-visual-style-selection-v2",
            "gate2_script_sha256": "a" * 64,
            "style_source": "episode_cover",
            "style_id": "cover-derived-episode-style",
            "source_style_id": None,
            "style_label": "当前封面风格",
            "treatment_profile_id": "imagegen-cover-derived-narrative",
            "visual_cohesion_profile_id": "cover-derived-cohesion-v1",
            "style_profile_path": "topic/schema/cover-derived-style-profile-v1.json",
            "style_profile_checksum_sha256": "b" * 64,
            "publishing_cover_package_path": "topic/schema/publishing-cover-generation-v1.json",
            "publishing_cover_package_sha256": "c" * 64,
            "decision": {
                "status": "selected",
                "exact_message": "使用当前封面风格",
                "decided_at": "2026-08-27T10:00:00+08:00",
            },
        }
        selection["selection_sha256"] = self.recorder._canonical_sha256(selection)
        item = {
            "white_cat_visual_style_id": "cover-derived-episode-style",
            "white_cat_visual_style_selection_sha256": selection["selection_sha256"],
            "visual_cohesion_profile_id": "cover-derived-cohesion-v1",
            "treatment_profile_id": "imagegen-cover-derived-narrative",
        }
        style_id, cohesion_id, current = self.recorder.resolve_white_cat_visual_style_binding(
            {"white_cat_visual_style_selection": selection}, item
        )
        qa = {"white_cat_visual_style_binding": {
            "style_id": style_id,
            "selection_sha256": selection["selection_sha256"],
            "visual_cohesion_profile_id": cohesion_id,
            "style_profile_checksum_sha256": selection["style_profile_checksum_sha256"],
        }}
        prompt = (
            "WHITE-CAT VISUAL STYLE: cover-derived-episode-style. "
            "EPISODE VISUAL COHESION: cover-derived-cohesion-v1. "
            f"EPISODE STYLE PROFILE SHA256: {selection['style_profile_checksum_sha256']}."
        )
        self.recorder.validate_white_cat_style_prompt_and_qa(
            prompt_text=prompt,
            qa=qa,
            style_id=style_id,
            cohesion_id=cohesion_id,
            selection_sha256=selection["selection_sha256"],
            current_binding=current,
            style_profile_checksum_sha256=selection["style_profile_checksum_sha256"],
        )
        with self.assertRaisesRegex(ValueError, "style-profile checksum marker"):
            self.recorder.validate_white_cat_style_prompt_and_qa(
                prompt_text=prompt.split("EPISODE STYLE PROFILE")[0],
                qa=qa,
                style_id=style_id,
                cohesion_id=cohesion_id,
                selection_sha256=selection["selection_sha256"],
                current_binding=current,
                style_profile_checksum_sha256=selection["style_profile_checksum_sha256"],
            )

    def test_cover_derived_v2_binding_loads_episode_summary_file(self) -> None:
        selection = {
            "contract_version": "white-cat-visual-style-selection-v2",
            "gate2_script_sha256": "a" * 64,
            "style_id": "cover-derived-episode-style",
            "treatment_profile_id": "imagegen-cover-derived-narrative",
            "visual_cohesion_profile_id": "cover-derived-cohesion-v1",
            "style_profile_path": "episode/schema/cover-derived-style-profile-v1.json",
            "style_profile_checksum_sha256": "b" * 64,
            "style_source": "episode_cover",
            "source_style_id": None,
            "style_label": "当前封面风格（暖金深蓝编辑绘本）",
            "publishing_cover_package_path": "episode/schema/publishing-cover-generation-v1.json",
            "publishing_cover_package_sha256": "c" * 64,
            "decision": {
                "status": "selected",
                "exact_message": "那选择1， 继续推进",
                "decided_at": "2026-08-29T14:58:28+08:00",
            },
        }
        selection["selection_sha256"] = self.recorder._canonical_sha256(selection)
        with tempfile.TemporaryDirectory(dir=SCRIPT_DIR) as temporary:
            root = Path(temporary)
            selection_path = root / "episode/schema/white-cat-visual-style-selection-v2.json"
            selection_path.parent.mkdir(parents=True)
            selection_path.write_text(
                json.dumps(selection, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            summary = {
                "contract_version": selection["contract_version"],
                "status": "selected",
                "path": selection_path.relative_to(root).as_posix(),
                "file_checksum_sha256": self.recorder.sha256_file(selection_path),
                **{
                    key: selection[key]
                    for key in (
                        "selection_sha256",
                        "style_id",
                        "style_source",
                        "style_label",
                        "treatment_profile_id",
                        "visual_cohesion_profile_id",
                        "style_profile_path",
                        "style_profile_checksum_sha256",
                        "publishing_cover_package_path",
                        "publishing_cover_package_sha256",
                        "decision",
                    )
                },
            }
            item = {
                "white_cat_visual_style_id": selection["style_id"],
                "white_cat_visual_style_selection_sha256": selection["selection_sha256"],
                "visual_cohesion_profile_id": selection["visual_cohesion_profile_id"],
                "treatment_profile_id": selection["treatment_profile_id"],
            }
            previous_root = self.recorder.REPOSITORY_ROOT
            self.recorder.REPOSITORY_ROOT = root
            try:
                self.assertEqual(
                    self.recorder.resolve_white_cat_visual_style_binding(
                        {"white_cat_visual_style_selection": summary}, item
                    ),
                    ("cover-derived-episode-style", "cover-derived-cohesion-v1", True),
                )
                selection_path.write_text(
                    selection_path.read_text(encoding="utf-8") + " ",
                    encoding="utf-8",
                )
                with self.assertRaisesRegex(ValueError, "checksum is stale"):
                    self.recorder.resolve_white_cat_visual_style_binding(
                        {"white_cat_visual_style_selection": summary}, item
                    )
            finally:
                self.recorder.REPOSITORY_ROOT = previous_root


if __name__ == "__main__":
    unittest.main()
