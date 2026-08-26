from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
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
    def test_resolve_root_relative_accepts_regular_file_and_rejects_symlink(self):
        recorder = load_recorder()
        regular = Path(__file__).resolve()
        regular_relative = regular.relative_to(recorder.REPOSITORY_ROOT).as_posix()
        self.assertEqual(
            recorder.resolve_root_relative(regular_relative, "fixture"),
            regular,
        )

        with tempfile.TemporaryDirectory(dir=recorder.REPOSITORY_ROOT) as directory:
            directory_path = Path(directory)
            target = directory_path / "target.txt"
            target.write_text("fixture", encoding="utf-8")
            link = directory_path / "link.txt"
            link.symlink_to(target)
            link_relative = link.relative_to(recorder.REPOSITORY_ROOT).as_posix()
            with self.assertRaisesRegex(ValueError, "non-symlink"):
                recorder.resolve_root_relative(link_relative, "fixture")

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
            "style_anchor_path": (
                ".agents/skills/ian-handdrawn-ppt/assets/"
                "reference-handdrawn-article-illustration-style.png"
            ),
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
        with self.assertRaisesRegex(ValueError, "canonical Ian style anchor"):
            recorder.expected_reference_inputs({
                **profile,
                "style_anchor_path": "episode/arbitrary-style.txt",
            })
        with self.assertRaisesRegex(ValueError, "checksum"):
            recorder.expected_reference_inputs({
                **profile,
                "style_anchor_checksum_sha256": "not-a-sha256",
            })

    def test_package_projection_keeps_v2_derivation_order(self):
        recorder = load_recorder()
        member = lambda path, checksum, alpha: {
            "path": path,
            "checksum_sha256": checksum,
            "width": 1920,
            "height": 1080,
            "has_alpha": alpha,
        }
        manifest = {
            "master_generation": {
                "source_master": member("episode/master-source.png", "1" * 64, False),
            },
            "normalized_master": member("episode/master.png", "2" * 64, False),
            "background": member("episode/background.png", "a" * 64, False),
            "pre_text_layers": [
                {"layer_id": "L01", **member("episode/L01-pre.png", "3" * 64, True)},
                {"layer_id": "L02", **member("episode/L02-pre.png", "4" * 64, True)},
            ],
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
                ("source-master", "source-master"),
                ("normalized-master", "normalized-master"),
                ("background", "background"),
                ("pre-text-layer", "L01"),
                ("pre-text-layer", "L02"),
                ("semantic-layer", "L01"),
                ("semantic-layer", "L02"),
                ("final-composite", "final-composite"),
            ],
        )
        self.assertEqual([value["checksum_sha256"] for value in members], [
            "1" * 64,
            "2" * 64,
            "a" * 64,
            "3" * 64,
            "4" * 64,
            "b" * 64,
            "c" * 64,
            "d" * 64,
        ])

    def test_generation_lineage_has_exactly_one_gpt_image_2_master_stage(self):
        recorder = load_recorder()
        references = [{
            "role": "visual_style_reference_only",
            "path": (
                ".agents/skills/ian-handdrawn-ppt/assets/"
                "reference-handdrawn-article-illustration-style.png"
            ),
            "checksum_sha256": "a" * 64,
        }]
        manifest = {
            "master_generation": {
                "contract_version": "ian-gpt-image-2-text-free-master-v1",
                "generator": "codex-native-imagegen",
                "model_id": "gpt-image-2",
                "prompt": {
                    "path": "episode/master-prompt.txt",
                    "checksum_sha256": "d" * 64,
                },
                "reference_inputs": references,
                "source_master": {
                    "path": "episode/master-source.png",
                    "checksum_sha256": "b" * 64,
                },
            },
        }
        lineage = [
            {
                "stage": "complete-master-generation",
                "generation_mode": "codex-native-imagegen-gpt-image-2-text-free-master-v1",
                "model_id": "gpt-image-2",
                "prompt": manifest["master_generation"]["prompt"],
                "reference_inputs": references,
                "output": manifest["master_generation"]["source_master"],
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
            stale[0]["stage"] = "independent-member-generation"
            with self.assertRaisesRegex(ValueError, "complete master"):
                recorder.validate_member_generation_lineage(stale, manifest, references)

            with_legacy_repair = json.loads(json.dumps(lineage))
            with_legacy_repair[0]["deterministic_text_repair"] = {}
            with self.assertRaisesRegex(ValueError, "exactly one complete master"):
                recorder.validate_member_generation_lineage(
                    with_legacy_repair,
                    manifest,
                    references,
                )

    def test_package_validator_requires_all_five_v2_proofs(self):
        recorder = load_recorder()
        passed = {
            "result": "pass",
            "model_provenance_observation": {
                "contract_version": "embedded-c2pa-software-agent-observation-v1",
                "evidence_kind": "observation-not-signature-verification",
                "software_agent_name": "gpt-image",
                "software_agent_version": "2.0",
            },
            "deterministic_master_normalization_match": True,
            "deterministic_semantic_split_match": True,
            "deterministic_text_overlay_match": True,
            "deterministic_composite_match": True,
        }
        with patch.object(
            recorder.subprocess,
            "run",
            return_value=SimpleNamespace(
                returncode=0,
                stdout=json.dumps(passed),
                stderr="",
            ),
        ):
            self.assertEqual(
                recorder.run_package_validator("episode", "episode/manifest.json"),
                passed,
            )

        for proof in (
            "deterministic_master_normalization_match",
            "deterministic_semantic_split_match",
            "deterministic_text_overlay_match",
            "deterministic_composite_match",
        ):
            incomplete = {**passed, proof: False}
            with patch.object(
                recorder.subprocess,
                "run",
                return_value=SimpleNamespace(
                    returncode=0,
                    stdout=json.dumps(incomplete),
                    stderr="",
                ),
            ), self.assertRaisesRegex(ValueError, "incomplete"):
                recorder.run_package_validator("episode", "episode/manifest.json")

        wrong_model = json.loads(json.dumps(passed))
        wrong_model["model_provenance_observation"]["software_agent_version"] = "1.5"
        with patch.object(
            recorder.subprocess,
            "run",
            return_value=SimpleNamespace(
                returncode=0,
                stdout=json.dumps(wrong_model),
                stderr="",
            ),
        ), self.assertRaisesRegex(ValueError, "incomplete"):
            recorder.run_package_validator("episode", "episode/manifest.json")

    def test_containment_binds_v2_overlay_to_final_composite_and_owning_layers(self):
        recorder = load_recorder()
        manifest_binding = {"path": "episode/manifest.json", "checksum_sha256": "1" * 64}
        final = {"path": "episode/final.png", "checksum_sha256": "2" * 64}
        container = {"x": 890, "y": 672, "width": 380, "height": 256}
        manifest = {
            "contract_version": "ian-knowledge-video-layered-scene-v2",
            "final_composite": final,
            "layers": [
                {"layer_id": "L01", "path": "episode/L01.png", "checksum_sha256": "3" * 64},
                {"layer_id": "L02", "path": "episode/L02.png", "checksum_sha256": "4" * 64},
            ],
            "text_overlay": {
                "contract_version": "ian-deterministic-layer-text-overlay-v1",
                "mode": "required",
                "minimum_inset_px": 8,
                "labels": [{
                    "layer_id": "L02",
                    "text": "一次结果≠无法改变",
                    "container_bbox": container,
                }],
            },
        }
        containment = {
            "repair_mode": "v2-deterministic-owning-layer-overlay",
            "scene_package_manifest": manifest_binding,
            "raster": final,
            "layer_overlays": [{
                "layer_id": "L02",
                "text": "一次结果≠无法改变",
                "container_bbox": container,
            }],
            "inspection": {"regions": [{
                "layer_id": "L02",
                "text": "一次结果≠无法改变",
                "container_bbox": container,
                "min_inset_px": 8,
                "result": "pass",
            }]},
        }
        self.assertIsNone(recorder.validate_layer_text_containment_evidence(
            containment,
            manifest_binding,
            manifest,
            "一次结果≠无法改变",
        ))
        stale = json.loads(json.dumps(containment))
        stale["layer_overlays"][0]["layer_id"] = "L01"
        with self.assertRaisesRegex(ValueError, "owning layer"):
            recorder.validate_layer_text_containment_evidence(
                stale,
                manifest_binding,
                manifest,
                "一次结果≠无法改变",
            )


if __name__ == "__main__":
    unittest.main()
