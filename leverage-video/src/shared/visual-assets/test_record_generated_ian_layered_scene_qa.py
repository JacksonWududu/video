from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch


SCRIPT_PATH = Path(__file__).with_name("record-generated-ian-layered-scene-qa.py")


def load_recorder():
    spec = importlib.util.spec_from_file_location("ian_layered_scene_recorder", SCRIPT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("recorder cannot be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class IanLayeredSceneRecorderTest(unittest.TestCase):
    def test_strict_revision_requires_revision_status_and_flag(self):
        recorder = load_recorder()
        self.assertTrue(recorder.is_strict_revision_candidate({
            "strict_review": True,
            "is_revision": True,
            "status": "changes_requested",
        }))
        self.assertFalse(recorder.is_strict_revision_candidate({
            "strict_review": True,
            "is_revision": False,
            "status": "changes_requested",
        }))

    def test_reference_inputs_use_only_the_style_anchor(self):
        recorder = load_recorder()
        profile = {
            "style_anchor_path": ".agents/skills/ian-handdrawn-ppt/assets/reference.png",
            "style_anchor_checksum_sha256": "a" * 64,
        }
        self.assertEqual(
            recorder.expected_reference_inputs(profile),
            [
                {
                    "role": "visual_style_reference_only",
                    "path": profile["style_anchor_path"],
                    "checksum_sha256": profile["style_anchor_checksum_sha256"],
                },
            ],
        )
        with self.assertRaisesRegex(ValueError, "prior flattened raster"):
            recorder.expected_reference_inputs(profile, {
                "path": "episode/prior.png",
                "checksum_sha256": "b" * 64,
            })

    def test_package_projection_keeps_background_layers_and_review_composite_ordered(self):
        recorder = load_recorder()
        member = lambda path, checksum, alpha: {
            "path": path,
            "checksum_sha256": checksum,
            "width": 1920,
            "height": 1080,
            "has_alpha": alpha,
        }
        manifest = {
            "background": member("episode/background.png", "a" * 64, False),
            "layers": [
                {"layer_id": "L01", **member("episode/L01.png", "b" * 64, True)},
                {"layer_id": "L02", **member("episode/L02.png", "c" * 64, True)},
            ],
            "final_composite": member("episode/final.png", "d" * 64, False),
        }
        members = recorder.package_members(manifest)
        self.assertEqual(
            [(value["member_role"], value["layer_id"]) for value in members],
            [
                ("background", "background"),
                ("semantic-layer", "L01"),
                ("semantic-layer", "L02"),
                ("final-composite", "final-composite"),
            ],
        )
        self.assertEqual([value["checksum_sha256"] for value in members], [
            "a" * 64,
            "b" * 64,
            "c" * 64,
            "d" * 64,
        ])

    def test_generation_lineage_has_one_independent_stage_per_source_member(self):
        recorder = load_recorder()
        references = [{
            "role": "visual_style_reference_only",
            "path": ".agents/skills/ian-handdrawn-ppt/assets/reference.png",
            "checksum_sha256": "a" * 64,
        }]
        manifest = {
            "background": {"path": "episode/background.png", "checksum_sha256": "b" * 64},
            "layers": [
                {"layer_id": "L01", "path": "episode/L01.png", "checksum_sha256": "c" * 64},
            ],
        }
        lineage = [
            {
                "stage": "independent-member-generation",
                "generation_mode": "codex-native-imagegen-independent-member-v1",
                "member_role": "background",
                "layer_id": "background",
                "prompt": {"path": "episode/background-prompt.txt", "checksum_sha256": "d" * 64},
                "reference_inputs": references,
                "output": manifest["background"],
                "selection_status": "selected",
            },
            {
                "stage": "independent-member-generation",
                "generation_mode": "codex-native-imagegen-independent-member-v1",
                "member_role": "semantic-layer",
                "layer_id": "L01",
                "prompt": {"path": "episode/L01-prompt.txt", "checksum_sha256": "e" * 64},
                "reference_inputs": references,
                "output": {"path": "episode/L01.png", "checksum_sha256": "c" * 64},
                "selection_status": "selected",
            },
        ]
        with patch.object(recorder, "checksum_bound_file"):
            self.assertEqual(
                recorder.validate_member_generation_lineage(
                    lineage,
                    manifest,
                    references,
                ),
                lineage,
            )
            stale = [dict(stage) for stage in lineage]
            stale[1]["output"] = {"path": "episode/final.png", "checksum_sha256": "f" * 64}
            with self.assertRaisesRegex(ValueError, "independently member-bound"):
                recorder.validate_member_generation_lineage(stale, manifest, references)


if __name__ == "__main__":
    unittest.main()
