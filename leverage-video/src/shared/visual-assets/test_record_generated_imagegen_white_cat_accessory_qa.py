#!/usr/bin/env python3
from __future__ import annotations

import copy
import importlib.util
from pathlib import Path
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

    def test_gate2_twilight_style_binding_drives_prompt_and_qa(self) -> None:
        selection = {
            "contract_version": "white-cat-visual-style-selection-v1",
            "gate2_script_sha256": "a" * 64,
            "style_id": "twilight-neon-animation",
            "treatment_profile_id": "imagegen-twilight-neon-narrative",
            "visual_cohesion_profile_id": "twilight-luminous-cohesion-v1",
            "style_skill_path": "/tmp/style-skill",
            "style_skill_checksum_sha256": "b" * 64,
            "style_profile_path": "/tmp/twilight-profile",
            "style_profile_checksum_sha256": "c" * 64,
            "decision": {
                "status": "selected",
                "exact_message": "选择暮紫霓影动画",
                "decided_at": "2026-08-26T10:00:00+08:00",
            },
        }
        selection["selection_sha256"] = self.recorder._canonical_sha256(selection)
        item = {
            "white_cat_visual_style_id": "twilight-neon-animation",
            "white_cat_visual_style_selection_sha256": selection["selection_sha256"],
            "visual_cohesion_profile_id": "twilight-luminous-cohesion-v1",
            "treatment_profile_id": "imagegen-twilight-neon-narrative",
        }
        style_id, cohesion_id, current = self.recorder.resolve_white_cat_visual_style_binding(
            {"white_cat_visual_style_selection": selection}, item
        )
        self.assertEqual((style_id, cohesion_id, current), (
            "twilight-neon-animation", "twilight-luminous-cohesion-v1", True
        ))
        qa = {"white_cat_visual_style_binding": {
            "style_id": style_id,
            "selection_sha256": selection["selection_sha256"],
            "visual_cohesion_profile_id": cohesion_id,
        }}
        self.recorder.validate_white_cat_style_prompt_and_qa(
            prompt_text=(
                "WHITE-CAT VISUAL STYLE: twilight-neon-animation. "
                "EPISODE VISUAL COHESION: twilight-luminous-cohesion-v1."
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


if __name__ == "__main__":
    unittest.main()
