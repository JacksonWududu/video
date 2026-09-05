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

    def test_next_generation_target_skips_prior_waived_items(self):
        recorder = load_recorder()
        gate = recorder.load_module(recorder.GATE_PATH, "visual_approval_gate_test")
        queue = [
            {
                "asset_id": "S01-action-02-v01",
                "status": "qa_failed_but_waived_once_pending_final_review",
                "active_for_current_storyboard": True,
            },
            {
                "asset_id": "S02-ian-v01",
                "status": "qa_passed_pending_final_review",
                "active_for_current_storyboard": True,
            },
            {
                "asset_id": "S03-master-v01",
                "status": "pending_generation",
                "active_for_current_storyboard": True,
            },
        ]

        self.assertEqual(
            recorder.next_generation_target(
                queue,
                gate.GENERATION_UNLOCKING_STATUSES,
            )["asset_id"],
            "S03-master-v01",
        )
        self.assertFalse(recorder.is_strict_revision_candidate({
            "strict_review": True,
            "is_revision": False,
            "status": "changes_requested",
        }))

    def test_stopped_s02_target_can_resume_only_through_bound_layout_repair(self):
        recorder = load_recorder()
        prompt = {"path": "episode/prompt.txt", "checksum_sha256": "1" * 64}
        outputs = [
            {"path": f"episode/rejected-{number}.png", "checksum_sha256": str(number) * 64}
            for number in (2, 3, 4)
        ]
        failures = [
            {
                "attempt_number": index + 1,
                "prompt": prompt,
                "output": output,
                "failure_reason": f"failure {index + 1}",
            }
            for index, output in enumerate(outputs)
        ]
        item = {
            "asset_id": "S02-ian-v01",
            "status": "pending_generation",
            "generation_attempt_scope_id": "S02:standalone-graphic",
            "image_generation_qa_failures": failures,
            "image_generation_attempt_control": {
                "maximum_automatic_rejected_generations": 3,
                "rejected_generation_count": 3,
                "automatic_retry_status": "stopped_user_takeover_required",
            },
        }
        state = {"visual_asset_review": {
            "current_asset_id": item["asset_id"],
            "queue_generation_allowed": False,
            "user_takeover_required": True,
            "user_takeover_asset_id": item["asset_id"],
            "user_takeover_scope_id": item["generation_attempt_scope_id"],
            "user_takeover_message": "three failures",
        }}
        self.assertTrue(recorder.is_stopped_layout_repair_takeover_target(
            state,
            item,
            item["asset_id"],
        ))
        message = "按建议执行确定性布局修复。"
        repair = {
            "contract_version": "ian-pre-split-layout-repair-v1",
            "authorization": {"asset_id": item["asset_id"], "exact_user_message": message},
            "source_failure": failures[-1],
            "source_outside_union_max_visible_pixels": 1024,
            "layers": [{"layer_id": f"L0{number}"} for number in range(1, 5)],
        }
        manifest = {"split_spec": {"layout_repair": repair}}
        validation = {
            "deterministic_pre_split_layout_repair_match": True,
            "layout_repair_source_outside_union_visible_pixels": 9,
            "layout_repair_source_edge_visible_pixels": [
                {"layer_id": f"L0{number}", "visible_pixels": 0}
                for number in range(1, 5)
            ],
        }
        qa = {"rejected_attempts": outputs}
        self.assertEqual(recorder.validate_layout_repair_evidence(
            manifest=manifest,
            validation=validation,
            item=item,
            qa=qa,
            exact_user_message=message,
            takeover_target=True,
        ), repair)
        with self.assertRaisesRegex(ValueError, "exact user authorization"):
            recorder.validate_layout_repair_evidence(
                manifest=manifest,
                validation=validation,
                item=item,
                qa=qa,
                exact_user_message="different message",
                takeover_target=True,
            )
        stale = json.loads(json.dumps(manifest))
        stale["split_spec"]["layout_repair"]["source_failure"]["failure_reason"] = "changed"
        with self.assertRaisesRegex(ValueError, "third rejected generation"):
            recorder.validate_layout_repair_evidence(
                manifest=stale,
                validation=validation,
                item=item,
                qa=qa,
                exact_user_message=message,
                takeover_target=True,
            )

        recorder.mark_layout_repair_takeover_resolution(item, repair, "2026-08-30T15:00:00+08:00")
        self.assertEqual(
            item["image_generation_attempt_control"]["rejected_generation_count"],
            3,
        )
        self.assertEqual(
            item["image_generation_attempt_control"]["automatic_retry_status"],
            "resolved_by_user_directed_deterministic_layout_repair_qa_pass",
        )
        recorder.clear_active_takeover(state["visual_asset_review"])
        self.assertNotIn("user_takeover_required", state["visual_asset_review"])

    def test_repairable_geometry_target_resumes_without_consuming_attempt_limit(self):
        recorder = load_recorder()
        finding = {
            "attempt_number": 1,
            "finding_number": 1,
            "generation_output_number": 1,
            "prompt": {"path": "episode/prompt.txt", "checksum_sha256": "1" * 64},
            "output": {"path": "episode/source.png", "checksum_sha256": "2" * 64},
            "failure_reason": (
                "IAN_ZONE_GEOMETRY: intact separated groups miss approved zones"
            ),
            "qa_time": "2026-08-30T15:00:00+08:00",
            "disposition": "deterministic_repair_required",
            "counts_toward_rejected_generation_limit": False,
        }
        item = {
            "asset_id": "S04-ian-v01",
            "status": "pending_generation",
            "visual_generation_route": "ian-handdrawn-ppt",
            "generation_attempt_scope_id": "S04:standalone-graphic",
            "image_generation_repairable_findings": [finding],
            "image_generation_attempt_control": {
                "contract_version": "storyboard-image-generation-attempt-limit-v1",
                "generation_attempt_scope_id": "S04:standalone-graphic",
                "maximum_automatic_rejected_generations": 3,
                "rejected_generation_count": 0,
                "automatic_retry_status": "deterministic_layout_repair_required",
            },
            "ian_layout_repair_disposition": {
                "contract_version": "ian-generation-layout-repair-disposition-v1",
                "status": "repair_required",
                "generation_attempt_scope_id": "S04:standalone-graphic",
                "source_finding": finding,
            },
        }
        review = {
            "current_asset_id": item["asset_id"],
            "queue_generation_allowed": False,
            "ian_layout_repair_required": True,
            "ian_layout_repair_asset_id": item["asset_id"],
            "ian_layout_repair_scope_id": item["generation_attempt_scope_id"],
            "ian_layout_repair_message": "repair required",
        }
        state = {"visual_asset_review": review}

        self.assertTrue(recorder.is_repairable_layout_target(
            state,
            item,
            item["asset_id"],
        ))

        message = "对 S04-ian-v01 执行确定性布局修复。"
        repair = {
            "contract_version": "ian-pre-split-layout-repair-v1",
            "authorization": {"asset_id": item["asset_id"], "exact_user_message": message},
            "source_failure": recorder.generation_failure_projection(finding),
            "source_outside_union_max_visible_pixels": 1024,
            "layers": [{"layer_id": "L01"}],
        }
        self.assertEqual(recorder.validate_layout_repair_evidence(
            manifest={"split_spec": {"layout_repair": repair}},
            validation={
                "deterministic_pre_split_layout_repair_match": True,
                "layout_repair_source_outside_union_visible_pixels": 0,
                "layout_repair_source_edge_visible_pixels": [
                    {"layer_id": "L01", "visible_pixels": 0}
                ],
            },
            item=item,
            qa={},
            exact_user_message=message,
            takeover_target=False,
            repairable_target=True,
        ), repair)

        stale_repair = json.loads(json.dumps(repair))
        stale_repair["source_failure"]["output"]["checksum_sha256"] = "3" * 64
        with self.assertRaisesRegex(ValueError, "repairable geometry finding"):
            recorder.validate_layout_repair_evidence(
                manifest={"split_spec": {"layout_repair": stale_repair}},
                validation={
                    "deterministic_pre_split_layout_repair_match": True,
                    "layout_repair_source_outside_union_visible_pixels": 0,
                    "layout_repair_source_edge_visible_pixels": [
                        {"layer_id": "L01", "visible_pixels": 0}
                    ],
                },
                item=item,
                qa={},
                exact_user_message=message,
                takeover_target=False,
                repairable_target=True,
            )

        recorder.mark_repairable_layout_resolution(
            item,
            repair,
            "2026-08-30T15:05:00+08:00",
        )
        recorder.clear_active_layout_repair(review)
        self.assertEqual(
            item["image_generation_attempt_control"]["rejected_generation_count"],
            0,
        )
        self.assertEqual(
            item["image_generation_attempt_control"]["automatic_retry_status"],
            "resolved_by_deterministic_layout_repair_qa_pass",
        )
        self.assertEqual(
            item["ian_layout_repair_disposition"]["status"],
            "resolved_qa_pass",
        )
        self.assertNotIn("ian_layout_repair_required", review)
        self.assertTrue(review["queue_generation_allowed"])

    def test_stopped_s04_can_use_second_failure_only_with_consumed_exact_override(self):
        recorder = load_recorder()
        artifact = {
            "path": SCRIPT_PATH.relative_to(recorder.REPOSITORY_ROOT).as_posix(),
            "checksum_sha256": recorder.sha256_file(SCRIPT_PATH),
        }
        failures = [
            {
                "attempt_number": number,
                "prompt": artifact,
                "output": artifact,
                "failure_reason": f"failure {number}",
            }
            for number in (1, 2, 3)
        ]
        item = {
            "asset_id": "S04-ian-v01",
            "generation_attempt_scope_id": "S04:standalone-graphic",
            "image_generation_qa_failures": failures,
            "image_generation_attempt_control": {
                "maximum_automatic_rejected_generations": 3,
                "rejected_generation_count": 3,
            },
        }
        message = (
            "接受 S04-ian-v01 第二次失败图，并仅此一次放行"
            "Ian 停队后布局修复源必须为第三次失败图门禁"
        )
        repair = {
            "source_failure": recorder.generation_failure_projection(failures[1]),
        }
        state = {"episode_id": "episode-test"}
        consumed = recorder.consume_non_third_layout_repair_source_override(
            state=state,
            item=item,
            repair=repair,
            exact_user_message=message,
            decided_at="2026-08-30T16:25:08+08:00",
            transition_id="episode-test:S04:second-source:20260830T162508+0800",
            consumed_at="2026-08-30T16:26:00+08:00",
        )
        self.assertEqual(consumed["consumption"]["status"], "consumed")
        self.assertEqual(
            consumed["gate_ids"],
            [
                "visual_asset.S04-ian-v01."
                "IAN_STOPPED_LAYOUT_REPAIR_SOURCE_MUST_BE_THIRD_REJECTED_GENERATION"
            ],
        )
        with self.assertRaisesRegex(ValueError, "third rejected generation"):
            recorder.validate_layout_repair_evidence(
                manifest={"split_spec": {"layout_repair": {
                    "contract_version": "ian-pre-split-layout-repair-v1",
                    "authorization": {
                        "asset_id": item["asset_id"],
                        "exact_user_message": message,
                    },
                    "source_failure": repair["source_failure"],
                    "source_outside_union_max_visible_pixels": 1024,
                    "layers": [{"layer_id": "L01"}],
                }}},
                validation={
                    "deterministic_pre_split_layout_repair_match": True,
                    "layout_repair_source_outside_union_visible_pixels": 0,
                    "layout_repair_source_edge_visible_pixels": [
                        {"layer_id": "L01", "visible_pixels": 0}
                    ],
                },
                item=item,
                qa={"rejected_attempts": [failure["output"] for failure in failures]},
                exact_user_message=message,
                takeover_target=True,
            )
        self.assertEqual(
            recorder.validate_layout_repair_evidence(
                manifest={"split_spec": {"layout_repair": {
                    "contract_version": "ian-pre-split-layout-repair-v1",
                    "authorization": {
                        "asset_id": item["asset_id"],
                        "exact_user_message": message,
                    },
                    "source_failure": repair["source_failure"],
                    "source_outside_union_max_visible_pixels": 1024,
                    "layers": [{"layer_id": "L01"}],
                }}},
                validation={
                    "deterministic_pre_split_layout_repair_match": True,
                    "layout_repair_source_outside_union_visible_pixels": 0,
                    "layout_repair_source_edge_visible_pixels": [
                        {"layer_id": "L01", "visible_pixels": 0}
                    ],
                },
                item=item,
                qa={"rejected_attempts": [failure["output"] for failure in failures]},
                exact_user_message=message,
                takeover_target=True,
                allow_non_third_source=True,
            )["source_failure"],
            repair["source_failure"],
        )

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

    def test_s02_multiline_copy_can_bind_two_positioned_labels_without_text_loss(self):
        recorder = load_recorder()
        manifest_binding = {"path": "episode/manifest.json", "checksum_sha256": "1" * 64}
        final = {"path": "episode/final.png", "checksum_sha256": "2" * 64}
        left = {"x": 120, "y": 560, "width": 300, "height": 100}
        right = {"x": 1300, "y": 600, "width": 300, "height": 100}
        labels = [
            {"layer_id": "L01", "text": "个人理性", "container_bbox": left},
            {"layer_id": "L02", "text": "集体收缩", "container_bbox": right},
        ]
        manifest = {
            "contract_version": "ian-knowledge-video-layered-scene-v2",
            "final_composite": final,
            "layers": [{"layer_id": "L01"}, {"layer_id": "L02"}],
            "text_overlay": {
                "contract_version": "ian-deterministic-layer-text-overlay-v1",
                "mode": "required",
                "minimum_inset_px": 8,
                "labels": labels,
            },
        }
        containment = {
            "repair_mode": "v2-deterministic-owning-layer-overlay",
            "scene_package_manifest": manifest_binding,
            "raster": final,
            "layer_overlays": labels,
            "inspection": {"regions": [
                {**label, "min_inset_px": 8, "result": "pass"}
                for label in labels
            ]},
        }
        exact = "个人理性\n集体收缩"
        self.assertIsNone(recorder.validate_layer_text_containment_evidence(
            containment,
            manifest_binding,
            manifest,
            exact,
        ))

        substituted = json.loads(json.dumps(manifest))
        substituted["text_overlay"]["labels"][1]["text"] = "集体扩张"
        with self.assertRaisesRegex(ValueError, "approved visible text"):
            recorder.validate_layer_text_containment_evidence(
                containment,
                manifest_binding,
                substituted,
                exact,
            )

        dropped = json.loads(json.dumps(manifest))
        dropped["text_overlay"]["labels"].pop()
        with self.assertRaisesRegex(ValueError, "approved visible text"):
            recorder.validate_layer_text_containment_evidence(
                containment,
                manifest_binding,
                dropped,
                exact,
            )


if __name__ == "__main__":
    unittest.main()
