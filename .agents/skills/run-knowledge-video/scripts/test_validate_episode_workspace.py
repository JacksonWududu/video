#!/usr/bin/env python3
"""Tests for the episode workspace validator."""

from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("validate_episode_workspace.py")
SPEC = importlib.util.spec_from_file_location("validate_episode_workspace", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class EpisodeWorkspaceValidatorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.repo = Path(self.temporary.name)
        self.workspace_relative = "leverage-video/src/" + "topic" + str(1)
        self.workspace = self.repo / self.workspace_relative
        self.episode_id = "episode-test"
        for directory in (
            "assets/audio",
            "assets/image",
            "assets/narration",
            "assets/video",
            "script",
            "schema",
            "docs",
        ):
            (self.workspace / directory).mkdir(parents=True, exist_ok=True)

        self.image = self.workspace / "assets/image/white-cat.png"
        self.image.write_bytes(b"final-white-cat-image")
        self.image_relative = self.image.relative_to(self.repo).as_posix()
        self.numbered_map = self.workspace / "assets/image/white-cat-numbered-map.png"
        self.numbered_map.write_bytes(b"numbered-white-cat-limb-map")
        self.numbered_map_relative = self.numbered_map.relative_to(self.repo).as_posix()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def write_state(
        self,
        item: dict,
        *,
        current_phase: str = "visual_production",
        extra_state: dict | None = None,
    ) -> None:
        state = {
            "current_phase": current_phase,
            "visual_asset_review": {"queue": [item]},
        }
        if extra_state:
            state.update(extra_state)
        (self.workspace / "schema/episode-state.json").write_text(
            json.dumps(state, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    def write_qa(
        self,
        *,
        contract_version: str,
        asset_id: str = "S01-master-v01",
        include_anatomy: bool = True,
    ) -> tuple[str, str]:
        identity: dict = {"result": "pass"}
        if include_anatomy:
            identity["anatomy_evidence"] = {
                "contract_version": "white-cat-anatomy-qa-v2",
                "result": "pass",
                "source_image": {
                    "path": self.image_relative,
                    "checksum_sha256": sha256(self.image),
                },
                "inspection_evidence": {
                    "methods": ["full_resolution", "numbered_limb_map"],
                    "numbered_limb_map_path": self.numbered_map_relative,
                    "numbered_limb_map_checksum_sha256": sha256(self.numbered_map),
                    "numbered_limb_map_source_checksum_sha256": sha256(self.image),
                    "numbered_limb_map_limb_ids": ["F1", "F2", "H1", "H2"],
                },
            }
        qa = {
            "contract_version": contract_version,
            "result": "pass",
            "asset_id": asset_id,
            "identity_qa": identity,
        }
        qa_file = self.workspace / "schema/s01-master-v01-qa.json"
        qa_file.write_text(
            json.dumps(qa, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return qa_file.relative_to(self.repo).as_posix(), sha256(qa_file)

    def item(
        self,
        *,
        status: str,
        route: str = "imagegen",
        qa_contract: str = "ordinary-imagegen-white-cat-master-qa-v2",
        include_anatomy: bool = True,
    ) -> dict:
        qa_path, qa_checksum = self.write_qa(
            contract_version=qa_contract,
            include_anatomy=include_anatomy,
        )
        item = {
            "asset_id": "S01-master-v01",
            "role": "base/master",
            "status": status,
            "active_for_current_storyboard": True,
            "visual_generation_route": route,
            "white_cat_present": True,
            "path": self.image_relative,
            "checksum_sha256": sha256(self.image),
            "qa_evidence_path": qa_path,
            "qa_evidence_checksum_sha256": qa_checksum,
        }
        if status in MODULE.WHITE_CAT_PENDING_QA_STATUSES:
            item["qa_contract_version"] = qa_contract
        if status == "approved":
            item.update(
                approved_checksum_sha256=sha256(self.image),
                presented_checksum_sha256=sha256(self.image),
                decision_message="批准历史白猫素材",
                decision_time="2026-08-21T12:00:00+08:00",
            )
        return item

    def post_delivery_context(self) -> dict:
        master = self.workspace / "assets/video/episode-test-caption-free-master-v1.mp4"
        master.write_bytes(b"verified-delivered-master")
        master_path = master.relative_to(self.repo).as_posix()
        master_checksum = sha256(master)

        transaction = self.workspace / "schema/delivery-transaction-v1.json"
        transaction.write_text(
            json.dumps({"transaction_id": "delivery-episode-test-v1"}) + "\n",
            encoding="utf-8",
        )
        transaction_path = transaction.relative_to(self.repo).as_posix()
        transaction_checksum = sha256(transaction)

        report = self.workspace / "docs/post-delivery-bgm-recommendation-v1.md"
        report.write_text(
            "# BGM 推荐\n\n1. Track One — https://music.example/track-one\n",
            encoding="utf-8",
        )
        report_path = report.relative_to(self.repo).as_posix()
        report_checksum = sha256(report)

        recommendations = []
        for rank in range(1, 4):
            recommendations.append({
                "rank": rank,
                "title": f"Track {rank}",
                "creator": f"Creator {rank}",
                "source_name": "Official Music Library",
                "audition_url": f"https://music.example/track-{rank}",
                "license_url": f"https://music.example/track-{rank}/license",
                "license_type": "library-license",
                "attribution_requirement": "not required",
                "commercial_boundary": "verify for the recorded distribution intent",
                "platform_restrictions": "none recorded",
                "risk_level": "low",
                "verified_at": "2026-08-26T20:00:00+08:00",
                "bpm": None,
                "bpm_basis": "unpublished",
                "emotion": "steady and reflective",
                "fit_reason": "supports knowledge narration without masking speech",
                "editing_note": "loop under narration and fade at the ending",
            })

        artifact = {
            "contract_version": "knowledge-video-post-delivery-bgm-recommendation-v1",
            "status": "complete",
            "scope": "advisory_only_no_media_mutation",
            "delivery_transaction_manifest": {
                "path": transaction_path,
                "checksum_sha256": transaction_checksum,
            },
            "analysis_master": {
                "role": "caption_free_master",
                "path": master_path,
                "checksum_sha256": master_checksum,
            },
            "recommendation_basis": {
                "content_track": "knowledge_explainer",
                "topic": "test topic",
                "emotion_arc": "question to insight",
                "pacing": "steady narration with short visual beats",
                "narration_and_sfx": "speech first with sparse effects",
                "distribution_intent": "unknown",
            },
            "recommendations": recommendations,
            "mutation_evidence": {
                "music_downloaded": False,
                "music_mixed": False,
                "delivered_master_changed": False,
            },
            "report": {
                "path": report_path,
                "checksum_sha256": report_checksum,
            },
        }
        artifact_file = self.workspace / "schema/post-delivery-bgm-recommendation-v1.json"
        artifact_file.write_text(
            json.dumps(artifact, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        artifact_path = artifact_file.relative_to(self.repo).as_posix()
        return {
            "post_delivery_bgm_recommendation_policy": "required-v1",
            "render_outputs": {
                "caption_free_master": {
                    "path": master_path,
                    "checksum_sha256": master_checksum,
                },
            },
            "delivery": {
                "status": "delivered",
                "result": "pass",
                "required_delivery_roles": ["caption_free_master"],
                "delivered_roles": ["caption_free_master"],
                "role_set_equality_result": "pass",
                "transaction_manifest_path": transaction_path,
                "transaction_manifest_checksum_sha256": transaction_checksum,
                "outputs": {
                    "caption_free_master": {
                        "path": "/external/episode-test-caption-free-master-v1.mp4",
                        "checksum_sha256": master_checksum,
                    },
                },
            },
            "post_delivery_bgm_recommendation": {
                "contract_version": "knowledge-video-post-delivery-bgm-recommendation-v1",
                "status": "complete",
                "artifact_path": artifact_path,
                "artifact_checksum_sha256": sha256(artifact_file),
                "report_path": report_path,
                "report_checksum_sha256": report_checksum,
            },
        }

    def errors(self) -> list[str]:
        return MODULE.validate_episode_workspace(self.repo, self.workspace)

    def ian_item(self, *, include_plan: bool = True, status: str = "pending_generation") -> dict:
        item = {
            "asset_id": "S01-ian-v01",
            "shot_id": "S01",
            "status": status,
            "active_for_current_storyboard": True,
            "visual_generation_route": "ian-handdrawn-ppt",
            "white_cat_present": False,
        }
        if not include_plan:
            return item
        source_text = "先出现结构。"
        plan = {
            "contract_version": "ian-layered-scene-plan-v1",
            "shot_id": "S01",
            "narration_source_text_sha256": hashlib.sha256(
                source_text.encode("utf-8")
            ).hexdigest(),
            "scene_renderer": "ian-static-layered-scene-v1",
            "background_policy": "static-paper-background-v1",
            "layer_asset_policy": "full-canvas-transparent-png-v1",
            "layer_entry_transition": {
                "contract_version": "ian-layer-entry-fade-v1",
                "duration_frames": 8,
                "easing": "linear",
            },
            "motion_policy": {
                "scene_transform": "forbidden",
                "layer_transform": "forbidden",
                "mask_reveal": "forbidden",
                "internal_cut": "forbidden",
                "opacity_animation": "ian-layer-entry-fade-v1",
            },
            "layer_count": 1,
            "layers": [{
                "layer_id": "L01",
                "z_index": 1,
                "semantic_role": "建立结构",
                "source_text_start_byte": 0,
                "source_text_end_byte_exclusive": len(source_text.encode("utf-8")),
                "source_text": source_text,
                "entry_frame": 0,
            }],
        }
        item["ian_scene_plan"] = plan
        item["ian_scene_plan_sha256"] = MODULE._canonical_sha256(plan)
        return item

    def attach_ian_v2_package(self, item: dict) -> dict:
        layer_ids = [layer["layer_id"] for layer in item["ian_scene_plan"]["layers"]]

        def write_member(name: str, payload: bytes) -> tuple[str, str]:
            target = self.workspace / f"assets/image/ian/{name}.png"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(payload)
            return target.relative_to(self.repo).as_posix(), sha256(target)

        source_path, source_checksum = write_member("source-master", b"source-master")
        normalized_path, normalized_checksum = write_member(
            "normalized-master", b"normalized-master"
        )
        background_path, background_checksum = write_member("background", b"background")
        pre_text = [write_member(f"{layer_id}-pre-text", b"pre-text-" + layer_id.encode())
                    for layer_id in layer_ids]
        final_layers = [write_member(layer_id, b"layer-" + layer_id.encode())
                        for layer_id in layer_ids]
        final_path, final_checksum = write_member("final", b"final")
        members = [
            {
                "member_role": "source-master",
                "layer_id": "source-master",
                "path": source_path,
                "checksum_sha256": source_checksum,
                "width": 1672,
                "height": 941,
                "has_alpha": False,
            },
            {
                "member_role": "normalized-master",
                "layer_id": "normalized-master",
                "path": normalized_path,
                "checksum_sha256": normalized_checksum,
                "width": 1920,
                "height": 1080,
                "has_alpha": False,
            },
            {
                "member_role": "background",
                "layer_id": "background",
                "path": background_path,
                "checksum_sha256": background_checksum,
                "width": 1920,
                "height": 1080,
                "has_alpha": False,
            },
            *[
                {
                    "member_role": "pre-text-layer",
                    "layer_id": layer_id,
                    "path": path,
                    "checksum_sha256": checksum,
                    "width": 1920,
                    "height": 1080,
                    "has_alpha": True,
                }
                for layer_id, (path, checksum) in zip(layer_ids, pre_text, strict=True)
            ],
            *[
                {
                    "member_role": "semantic-layer",
                    "layer_id": layer_id,
                    "path": path,
                    "checksum_sha256": checksum,
                    "width": 1920,
                    "height": 1080,
                    "has_alpha": True,
                }
                for layer_id, (path, checksum) in zip(layer_ids, final_layers, strict=True)
            ],
            {
                "member_role": "final-composite",
                "layer_id": "final-composite",
                "path": final_path,
                "checksum_sha256": final_checksum,
                "width": 1920,
                "height": 1080,
                "has_alpha": False,
            },
        ]
        prompt = self.workspace / "assets/narration/ian-master-prompt.txt"
        prompt.write_text("16:9 landscape composition\nno visible text\n", encoding="utf-8")
        prompt_binding = {
            "path": prompt.relative_to(self.repo).as_posix(),
            "checksum_sha256": sha256(prompt),
        }
        references: list[dict] = []
        manifest = {
            "contract_version": "ian-knowledge-video-layered-scene-v2",
            "queue_item_id": item["asset_id"],
            "scene_plan": item["ian_scene_plan"],
            "scene_plan_sha256": item["ian_scene_plan_sha256"],
            "master_generation": {
                "contract_version": "ian-gpt-image-2-text-free-master-v1",
                "generator": "codex-native-imagegen",
                "model_id": "gpt-image-2",
                "prompt": prompt_binding,
                "reference_inputs": references,
                "source_master": {
                    "path": source_path,
                    "checksum_sha256": source_checksum,
                    "width": 1672,
                    "height": 941,
                    "role": "text-free-complete-master-source",
                    "has_alpha": False,
                },
            },
            "model_provenance": {
                "contract_version": "codex-native-imagegen-gpt-image-2-provenance-v1",
                "canonical_model": "gpt-image-2",
                "evidence_kind": "embedded-c2pa-software-agent-observation-v1",
                "source_master_checksum_sha256": source_checksum,
                "expected_software_agent": {"name": "gpt-image", "version": "2.0"},
            },
            "normalized_master": {
                "path": normalized_path,
                "checksum_sha256": normalized_checksum,
                "width": 1920,
                "height": 1080,
                "role": "text-free-complete-master-normalized",
                "has_alpha": False,
            },
            "background": {
                "path": background_path,
                "checksum_sha256": background_checksum,
                "width": 1920,
                "height": 1080,
                "role": "static-paper-background",
                "has_alpha": False,
            },
            "pre_text_layers": [
                {
                    "layer_id": layer_id,
                    "path": path,
                    "checksum_sha256": checksum,
                    "width": 1920,
                    "height": 1080,
                    "role": "transparent-semantic-element-pre-text",
                    "has_alpha": True,
                }
                for layer_id, (path, checksum) in zip(layer_ids, pre_text, strict=True)
            ],
            "layers": [
                {
                    "layer_id": layer_id,
                    "path": path,
                    "checksum_sha256": checksum,
                    "width": 1920,
                    "height": 1080,
                    "role": "transparent-semantic-element",
                    "has_alpha": True,
                }
                for layer_id, (path, checksum) in zip(layer_ids, final_layers, strict=True)
            ],
            "final_composite": {
                "path": final_path,
                "checksum_sha256": final_checksum,
                "width": 1920,
                "height": 1080,
                "role": "final-composite-review-raster",
                "has_alpha": False,
            },
        }
        manifest_file = self.workspace / "schema/ian-layered-scene-v2.json"
        manifest_file.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
        item.update(
            qa_contract_version="ian-layered-scene-qa-v2",
            scene_package_manifest_path=manifest_file.relative_to(self.repo).as_posix(),
            scene_package_manifest_checksum_sha256=sha256(manifest_file),
            ian_scene_package_members=members,
            actual_reference_inputs=references,
            generation_lineage=[{
                "stage": "complete-master-generation",
                "generation_mode": "codex-native-imagegen-gpt-image-2-text-free-master-v1",
                "model_id": "gpt-image-2",
                "prompt": prompt_binding,
                "reference_inputs": references,
                "output": {"path": source_path, "checksum_sha256": source_checksum},
                "selection_status": "selected",
            }],
            path=final_path,
            checksum_sha256=final_checksum,
        )
        return item

    def attach_stopped_ian_earlier_source_override(self, item: dict) -> dict:
        manifest_file = self.repo / item["scene_package_manifest_path"]
        manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
        second_prompt = item["generation_lineage"][0]["prompt"]
        second_output = {
            "path": item["ian_scene_package_members"][0]["path"],
            "checksum_sha256": item["ian_scene_package_members"][0][
                "checksum_sha256"
            ],
        }

        def write_attempt(number: int) -> tuple[dict, dict]:
            prompt = self.workspace / f"assets/narration/ian-attempt-{number}.txt"
            prompt.write_text(
                "16:9 landscape composition\nno visible text\n",
                encoding="utf-8",
            )
            output = self.workspace / f"assets/image/ian/attempt-{number}.png"
            output.write_bytes(f"rejected-{number}".encode())
            return (
                {
                    "path": prompt.relative_to(self.repo).as_posix(),
                    "checksum_sha256": sha256(prompt),
                },
                {
                    "path": output.relative_to(self.repo).as_posix(),
                    "checksum_sha256": sha256(output),
                },
            )

        first_prompt, first_output = write_attempt(1)
        third_prompt, third_output = write_attempt(3)
        bindings = [
            (first_prompt, first_output),
            (second_prompt, second_output),
            (third_prompt, third_output),
        ]
        failures = [
            {
                "attempt_number": number,
                "prompt": prompt,
                "output": output,
                "failure_reason": f"IAN_ZONE_GEOMETRY: attempt {number}",
            }
            for number, (prompt, output) in enumerate(bindings, start=1)
        ]
        projections = [MODULE._generation_failure_projection(row) for row in failures]
        message = (
            "接受 S01-ian-v01 第二次失败图，并仅此一次放行 Ian 停队后布局修复源"
            "必须为第三次失败图门禁；保留三次真实失败证据。"
        )
        manifest["split_spec"] = {
            "layout_repair": {
                "contract_version": "ian-pre-split-layout-repair-v1",
                "authorization": {
                    "asset_id": item["asset_id"],
                    "exact_user_message": message,
                },
                "source_failure": projections[1],
            }
        }
        manifest_file.write_text(
            json.dumps(manifest, ensure_ascii=False), encoding="utf-8"
        )
        item.update(
            generation_attempt_scope_id="S01:standalone-graphic",
            image_generation_qa_failures=failures,
            rejected_attempts=[row["output"] for row in projections],
            image_generation_attempt_control={
                "contract_version": "storyboard-image-generation-attempt-limit-v1",
                "generation_attempt_scope_id": "S01:standalone-graphic",
                "maximum_automatic_rejected_generations": 3,
                "rejected_generation_count": 3,
                "automatic_retry_status": (
                    "resolved_by_user_directed_deterministic_layout_repair_qa_pass"
                ),
            },
            scene_package_manifest_checksum_sha256=sha256(manifest_file),
        )
        gate_id = (
            "visual_asset.S01-ian-v01."
            "IAN_STOPPED_LAYOUT_REPAIR_SOURCE_MUST_BE_THIRD_REJECTED_GENERATION"
        )
        artifacts = [
            binding
            for failure in projections
            for binding in (failure["prompt"], failure["output"])
        ]
        override = {
            "contract_version": "one-time-explicit-user-mechanical-gate-override-v1",
            "episode_id": self.episode_id,
            "scope_id": "S01:standalone-graphic:ian-layout-repair-source-selection",
            "gate_ids": [gate_id],
            "acknowledged_failures": [{
                "gate_id": gate_id,
                "observed_result": "fail",
                "reason": (
                    "Selected Ian stopped-takeover layout-repair source is preserved "
                    "attempt 2; the default contract requires preserved attempt 3."
                ),
            }],
            "bound_artifacts": artifacts,
            "decision": {
                "exact_user_message": message,
                "decided_at": "2026-08-30T16:25:08+08:00",
                "disposition": "allow_once",
            },
            "consumption": {
                "from_phase": "awaiting_visual_asset_review",
                "to_phase": "visual_production",
                "status": "consumed",
                "consumed_transition_id": f"{self.episode_id}:S01:ian-earlier-source:1",
                "consumed_at": "2026-08-30T17:40:02+08:00",
            },
            "reuse_forbidden": True,
        }
        override["override_sha256"] = MODULE._canonical_sha256(override)
        item["ian_layout_repair_source_selection"] = {
            "contract_version": "ian-stopped-layout-repair-source-selection-v1",
            "result": "pass_with_user_override",
            "selected_source_failure": projections[1],
            "default_required_source_failure": projections[2],
            "user_mechanical_gate_override": override,
        }
        item["user_takeover_disposition"] = {
            "contract_version": "ian-pre-split-layout-repair-takeover-v1",
            "source_failure": projections[1],
            "source_selection_result": "pass_with_user_override",
            "source_selection_override_sha256": override["override_sha256"],
        }
        return item

    def test_web_artifacts_use_source_and_document_categories(self) -> None:
        self.assertEqual(MODULE._expected_category(Path("book.css")), ("script",))
        self.assertEqual(MODULE._expected_category(Path("book.html")), ("docs",))

    def test_category_classification_is_unchanged(self) -> None:
        self.assertEqual(
            MODULE._expected_category(Path("storyboard-v2.md")),
            ("assets", "narration"),
        )
        self.assertEqual(
            MODULE._expected_category(Path("final-storyboard-review.md")),
            ("assets", "narration"),
        )
        self.assertEqual(
            MODULE._expected_category(Path("visual-batch-review.md")),
            ("docs",),
        )
        self.assertEqual(
            MODULE._expected_category(Path("assets/audio/user-source/voice-v01.mp3")),
            ("assets", "audio"),
        )

    def test_approved_historical_v1_remains_readable(self) -> None:
        item = self.item(
            status="approved",
            qa_contract="ordinary-imagegen-white-cat-master-qa-v1",
            include_anatomy=False,
        )
        self.write_state(item)
        self.assertEqual(self.errors(), [])

    def test_forged_approved_status_without_approval_evidence_fails(self) -> None:
        item = self.item(
            status="approved",
            qa_contract="ordinary-imagegen-white-cat-master-qa-v1",
            include_anatomy=False,
        )
        item.pop("approved_checksum_sha256")
        item.pop("decision_message")
        self.write_state(item)
        errors = self.errors()
        self.assertTrue(any("checksum evidence is invalid" in error for error in errors))
        self.assertTrue(any("decision message is missing" in error for error in errors))

    def test_pending_imagegen_v1_fails_closed(self) -> None:
        item = self.item(
            status="awaiting_user_approval",
            qa_contract="ordinary-imagegen-white-cat-master-qa-v1",
            include_anatomy=False,
        )
        self.write_state(item)
        self.assertTrue(any("master-qa-v2" in error for error in self.errors()))

    def test_pending_imagegen_v2_passes(self) -> None:
        self.write_state(self.item(status="qa_passed_pending_final_review"))
        self.assertEqual(self.errors(), [])

    def test_early_failed_p2_master_uses_generic_hash_bound_acceptance(self) -> None:
        item = self.item(
            status="qa_failed_but_waived_once_pending_final_review",
            qa_contract="ordinary-imagegen-white-cat-master-qa-v2",
        )
        item.update(
            asset_id="S03-master-v01",
            generation_attempt_scope_id="S03:base/master",
            mechanical_qa_result="failed_but_waived_once",
            user_mechanical_gate_override_result="pass_with_user_override",
        )
        qa_file = self.repo / item["qa_evidence_path"]
        qa = json.loads(qa_file.read_text(encoding="utf-8"))
        failure_reason = (
            "P2_SATCHEL_TOPOLOGY: rear bag-end anchor is not traceable; "
            "the cat baseline intrudes into the bottom 18% subtitle-safe area."
        )
        qa.update(
            result="fail",
            asset_id="S03-master-v01",
            waivable_mechanical_failures=[
                {
                    "error_code": "P2_SATCHEL_TOPOLOGY",
                    "observed_result": "fail",
                    "reason": failure_reason,
                },
                {
                    "error_code": "BOTTOM_SUBTITLE_SAFE_AREA",
                    "observed_result": "fail",
                    "reason": failure_reason,
                },
            ],
            visual_qa={
                "result": "fail",
                "bottom_subtitle_safe_area_readable": False,
                "bottom_subtitle_safe_area_result": "fail",
                "safe_band_fraction": 0.18,
            },
        )
        qa["identity_qa"].update(
            result="fail",
            cat_count=1,
            foreleg_count=2,
            hindleg_count=2,
            paw_count=4,
            accessory_geometry_correct=False,
            satchel_count=1,
            bag_strap_count=1,
            bag_end_attachment_count=1,
            front_strap_attached_to_forward_bag_end=True,
            rear_strap_attached_to_rear_bag_end=False,
            himation_trim_distinct_from_bag_straps=True,
            satchel_anatomical_flank="right",
            both_bag_end_anchors_visibly_traceable=False,
            source_retry_policy_compliant=False,
        )
        prompt = self.workspace / "assets/image/s01-master-prompt.txt"
        prompt.write_text(
            "WHITE-CAT SATCHEL STRAP LOCK:\n"
            "Keep the bottom 18% subtitle-safe.\n",
            encoding="utf-8",
        )
        prompt_binding = {
            "path": prompt.relative_to(self.repo).as_posix(),
            "checksum_sha256": sha256(prompt),
        }
        source_binding = {
            "path": item["path"],
            "checksum_sha256": item["checksum_sha256"],
        }
        failure = {
            "attempt_number": 1,
            "prompt": prompt_binding,
            "output": source_binding,
            "failure_reason": failure_reason,
            "error_code": "P2_SATCHEL_TOPOLOGY",
        }
        item.update(
            prompt_path=prompt_binding["path"],
            prompt_checksum_sha256=prompt_binding["checksum_sha256"],
            image_generation_qa_failures=[json.loads(json.dumps(failure))],
            white_cat_imagegen_qa_failures=[json.loads(json.dumps(failure))],
            image_generation_attempt_control={
                "contract_version": "storyboard-image-generation-attempt-limit-v1",
                "generation_attempt_scope_id": "S03:base/master",
                "maximum_automatic_rejected_generations": 3,
                "rejected_generation_count": 1,
                "automatic_retry_status": "stopped_by_explicit_user_acceptance",
            },
            white_cat_generation_attempt_control={
                "contract_version": "white-cat-imagegen-attempt-limit-v1",
                "maximum_automatic_qa_failures": 3,
                "qa_failed_generation_count": 1,
                "automatic_retry_status": "stopped_by_explicit_user_acceptance",
            },
        )
        qa_file.write_text(
            json.dumps(qa, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        item["qa_evidence_checksum_sha256"] = sha256(qa_file)
        selection = self.workspace / "schema/s01-master-user-selection-v1.json"
        selection.write_text(
            json.dumps({"selected_attempt_number": 1}) + "\n",
            encoding="utf-8",
        )
        item["user_source_selection_evidence"] = {
            "path": selection.relative_to(self.repo).as_posix(),
            "checksum_sha256": sha256(selection),
        }
        artifacts = [
            source_binding,
            prompt_binding,
            {
                "path": item["qa_evidence_path"],
                "checksum_sha256": item["qa_evidence_checksum_sha256"],
            },
            {
                "path": self.numbered_map_relative,
                "checksum_sha256": sha256(self.numbered_map),
            },
            item["user_source_selection_evidence"],
        ]
        p2_gate = "visual_asset.S03-master-v01.P2_SATCHEL_TOPOLOGY"
        subtitle_gate = "visual_asset.S03-master-v01.BOTTOM_SUBTITLE_SAFE_AREA"
        override = {
            "contract_version": "one-time-explicit-user-mechanical-gate-override-v1",
            "episode_id": "episode-test",
            "scope_id": "S03:base/master",
            "gate_ids": [p2_gate, subtitle_gate],
            "acknowledged_failures": [
                {
                    "gate_id": p2_gate,
                    "observed_result": "fail",
                    "reason": failure_reason,
                },
                {
                    "gate_id": subtitle_gate,
                    "observed_result": "fail",
                    "reason": failure_reason,
                },
            ],
            "bound_artifacts": artifacts,
            "decision": {
                "exact_user_message": (
                    "接受 S03-master-v01 第一次失败图，并仅此一次放行 "
                    "P2_SATCHEL_TOPOLOGY 与底部18%字幕安全区门禁；"
                    "停止该资产后续自动重试，保留真实失败证据，以第一次失败图继续。"
                ),
                "decided_at": "2026-08-30T21:05:00+08:00",
                "disposition": "allow_once",
            },
            "consumption": {
                "from_phase": "visual_production",
                "to_phase": "visual_production",
                "status": "consumed",
                "consumed_transition_id": "episode-test:S03-master:early-p2-subtitle:1",
                "consumed_at": "2026-08-30T21:05:01+08:00",
            },
            "reuse_forbidden": True,
        }
        selection.write_text(
            json.dumps({
                "contract_version": "visual-asset-user-source-selection-v1",
                "episode_id": "episode-test",
                "asset_id": "S03-master-v01",
                "generation_attempt_scope_id": "S03:base/master",
                "selected_attempt_number": 1,
                "selected_generation_source": source_binding,
                "selected_prompt": prompt_binding,
                "preserved_failure": {
                    "attempt_number": 1,
                    "error_code": "P2_SATCHEL_TOPOLOGY",
                    "failure_reason": failure_reason,
                },
                "disclosed_gate_ids": [p2_gate, subtitle_gate],
                "gate_effect": {
                    "selection_recorded": True,
                    "mechanical_gate_override_consumed": True,
                    "release_decision": override["decision"],
                    "consumed_transition_id": override["consumption"][
                        "consumed_transition_id"
                    ],
                },
            }, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        item["user_source_selection_evidence"]["checksum_sha256"] = sha256(
            selection
        )
        override["override_sha256"] = MODULE._canonical_sha256(override)
        item.update(
            user_mechanical_gate_override=override,
            waived_mechanical_gate_ids=[p2_gate, subtitle_gate],
            override_bound_artifacts=artifacts,
        )
        self.write_state(item, extra_state={
            "episode_id": "episode-test",
            "blockers": [],
        })
        self.assertEqual(self.errors(), [])
        item["image_generation_attempt_control"]["automatic_retry_status"] = (
            "stopped_user_takeover_required"
        )
        self.write_state(item, extra_state={
            "episode_id": "episode-test",
            "blockers": [],
        })
        self.assertTrue(any(
            "attempt-limit/white-cat failure history is stale" in error
            for error in self.errors()
        ))

    def test_failed_p2_qa_requires_exact_consumed_override_and_audit_blocker(self) -> None:
        item = self.item(
            status="qa_failed_but_waived_once_pending_final_review",
            qa_contract="ordinary-imagegen-white-cat-action-qa-v2",
        )
        item.update(
            asset_id="S01-action-02-v01",
            role="action-02",
            asset_kind="hero_pose",
            generation_attempt_scope_id="S01:action-02",
            mechanical_qa_result="failed_but_waived_once",
            user_mechanical_gate_override_result="pass_with_user_override",
        )
        qa_file = self.repo / item["qa_evidence_path"]
        qa = json.loads(qa_file.read_text(encoding="utf-8"))
        qa.update(result="fail", asset_id=item["asset_id"])
        qa["identity_qa"].update(
            result="fail",
            accessory_geometry_correct=False,
            satchel_count=1,
            front_strap_attached_to_forward_bag_end=True,
            rear_strap_attached_to_rear_bag_end=False,
            bag_end_attachment_count=1,
            himation_trim_distinct_from_bag_straps=True,
            satchel_anatomical_flank="right",
            both_bag_end_anchors_visibly_traceable=False,
            source_retry_policy_compliant=False,
        )
        qa_file.write_text(
            json.dumps(qa, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        item["qa_evidence_checksum_sha256"] = sha256(qa_file)
        prompt = self.workspace / "assets/image/action-02-prompt.txt"
        prompt.write_text(
            "WHITE-CAT SATCHEL STRAP LOCK:\n"
            "HERO-POSE ASSET: full-canvas transparent RGBA with fixed "
            "registration anchors.\n",
            encoding="utf-8",
        )
        item["prompt_path"] = prompt.relative_to(self.repo).as_posix()
        item["prompt_checksum_sha256"] = sha256(prompt)
        outputs = []
        for attempt in (1, 2, 3):
            output = self.workspace / f"assets/image/action-02-attempt-{attempt}.png"
            output.write_bytes(f"attempt-{attempt}".encode())
            outputs.append({
                "path": output.relative_to(self.repo).as_posix(),
                "checksum_sha256": sha256(output),
            })
        prompt_binding = {
            "path": item["prompt_path"],
            "checksum_sha256": item["prompt_checksum_sha256"],
        }
        failures = [{
            "attempt_number": index + 1,
            "prompt": prompt_binding,
            "output": output,
            "failure_reason": (
                "P2_SATCHEL_TOPOLOGY: rear bag-end anchor missing"
                if index == 2 else f"P2 failure {index + 1}"
            ),
            "error_code": "P2_SATCHEL_TOPOLOGY",
        } for index, output in enumerate(outputs)]
        item["image_generation_qa_failures"] = json.loads(json.dumps(failures))
        item["white_cat_imagegen_qa_failures"] = json.loads(json.dumps(failures))
        item["image_generation_attempt_control"] = {
            "contract_version": "storyboard-image-generation-attempt-limit-v1",
            "generation_attempt_scope_id": item["generation_attempt_scope_id"],
            "maximum_automatic_rejected_generations": 3,
            "rejected_generation_count": 3,
            "automatic_retry_status": "stopped_user_takeover_required",
        }
        item["white_cat_generation_attempt_control"] = {
            "contract_version": "white-cat-imagegen-attempt-limit-v1",
            "maximum_automatic_qa_failures": 3,
            "qa_failed_generation_count": 3,
            "automatic_retry_status": "stopped_user_takeover_required",
        }
        attempt_gate = "storyboard-image-generation-attempt-limit:S01:action-02"
        p2_gate = f"visual_asset.{item['asset_id']}.P2_SATCHEL_TOPOLOGY"
        artifacts = [
            {"path": item["path"], "checksum_sha256": item["checksum_sha256"]},
            prompt_binding,
            {
                "path": item["qa_evidence_path"],
                "checksum_sha256": item["qa_evidence_checksum_sha256"],
            },
            {
                "path": self.numbered_map_relative,
                "checksum_sha256": sha256(self.numbered_map),
            },
            outputs[2],
        ]
        override = {
            "contract_version": "one-time-explicit-user-mechanical-gate-override-v1",
            "episode_id": self.episode_id,
            "scope_id": "S01:action-02",
            "gate_ids": [attempt_gate, p2_gate],
            "acknowledged_failures": [
                {
                    "gate_id": attempt_gate,
                    "observed_result": "stopped_user_takeover_required",
                    "reason": "three failures",
                },
                {
                    "gate_id": p2_gate,
                    "observed_result": "fail",
                    "reason": failures[2]["failure_reason"],
                },
            ],
            "bound_artifacts": artifacts,
            "decision": {
                "exact_user_message": "接受 S01-action-02-v01 的 P2 背带失败并放行三次限制",
                "decided_at": "2026-08-29T18:20:00+08:00",
                "disposition": "allow_once",
            },
            "consumption": {
                "from_phase": "awaiting_visual_asset_review",
                "to_phase": "visual_production",
                "status": "consumed",
                "consumed_transition_id": f"{self.episode_id}:S01-action-02:p2:1",
                "consumed_at": "2026-08-29T18:20:01+08:00",
            },
            "reuse_forbidden": True,
        }
        override["override_sha256"] = MODULE._canonical_sha256(override)
        item.update(
            user_mechanical_gate_override=override,
            waived_mechanical_gate_ids=[attempt_gate, p2_gate],
            override_bound_artifacts=artifacts,
        )
        blocker = {
            "blocker_id": attempt_gate,
            "contract_version": "storyboard-image-generation-attempt-limit-v1",
            "asset_id": item["asset_id"],
            "generation_attempt_scope_id": item["generation_attempt_scope_id"],
            "status": "failed_but_waived_once",
            "user_mechanical_gate_override_sha256": override["override_sha256"],
        }
        self.write_state(item, extra_state={"episode_id": self.episode_id, "blockers": [blocker]})
        self.assertEqual(self.errors(), [])

        combined_item = json.loads(json.dumps(item))
        combined_blocker = json.loads(json.dumps(blocker))
        combined_qa = json.loads(json.dumps(qa))
        combined_reason = (
            "P0_FORWARD_REVERSE_MISMATCH: anatomical front is screen-right and "
            "rear is screen-left; the rear wide blue path also fails to reach a "
            "distinct rear bag-end ring."
        )
        original_prompt_text = prompt.read_text(encoding="utf-8")
        original_qa_bytes = qa_file.read_bytes()
        prompt.write_text(
            original_prompt_text
            + "CAT FACING MAP: torso three-quarter screen-left; anatomical front "
            "and chest map screen-left; anatomical rear and rump map screen-right.\n",
            encoding="utf-8",
        )
        combined_prompt_binding = {
            "path": combined_item["prompt_path"],
            "checksum_sha256": sha256(prompt),
        }
        combined_item["prompt_checksum_sha256"] = combined_prompt_binding[
            "checksum_sha256"
        ]
        for failure_list in (
            combined_item["image_generation_qa_failures"],
            combined_item["white_cat_imagegen_qa_failures"],
        ):
            for failure in failure_list:
                failure["prompt"] = json.loads(json.dumps(combined_prompt_binding))
        combined_item["white_cat_imagegen_qa_failures"][-1].update(
            error_code="P0_FORWARD_REVERSE_MISMATCH",
            failure_reason=combined_reason,
        )
        combined_qa["identity_qa"].update(
            cat_facing_screen_direction="three-quarter-screen-right",
            anatomical_front_maps_to_screen="screen-right",
            anatomical_rear_maps_to_screen="screen-left",
            forward_reverse_mapping_qa={
                "contract_version": "white-cat-forward-reverse-mapping-qa-v1",
                "result": "fail",
                "error_code": "P0_FORWARD_REVERSE_MISMATCH",
                "expected_cat_facing_screen_direction": "three-quarter-screen-left",
                "expected_anatomical_front_maps_to_screen": "screen-left",
                "expected_anatomical_rear_maps_to_screen": "screen-right",
                "observed_cat_facing_screen_direction": "three-quarter-screen-right",
                "observed_anatomical_front_maps_to_screen": "screen-right",
                "observed_anatomical_rear_maps_to_screen": "screen-left",
                "failure_reason": combined_reason,
            },
        )
        combined_qa["waivable_mechanical_failures"] = [
            {
                "error_code": "P0_FORWARD_REVERSE_MISMATCH",
                "observed_result": "fail",
                "reason": combined_reason,
            },
            {
                "error_code": "P2_SATCHEL_TOPOLOGY",
                "observed_result": "fail",
                "reason": combined_reason,
            },
        ]
        qa_file.write_text(
            json.dumps(combined_qa, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        combined_item["qa_evidence_checksum_sha256"] = sha256(qa_file)
        combined_artifacts = [
            {
                "path": combined_item["path"],
                "checksum_sha256": combined_item["checksum_sha256"],
            },
            combined_prompt_binding,
            {
                "path": combined_item["qa_evidence_path"],
                "checksum_sha256": combined_item["qa_evidence_checksum_sha256"],
            },
            {
                "path": self.numbered_map_relative,
                "checksum_sha256": sha256(self.numbered_map),
            },
            outputs[2],
        ]
        p0_gate = (
            f"visual_asset.{combined_item['asset_id']}.P0_FORWARD_REVERSE_MISMATCH"
        )
        combined_override = json.loads(json.dumps(override))
        combined_override["gate_ids"] = [attempt_gate, p0_gate, p2_gate]
        combined_override["acknowledged_failures"] = [
            combined_override["acknowledged_failures"][0],
            {
                "gate_id": p0_gate,
                "observed_result": "fail",
                "reason": combined_reason,
            },
            {
                "gate_id": p2_gate,
                "observed_result": "fail",
                "reason": combined_reason,
            },
        ]
        combined_override["bound_artifacts"] = combined_artifacts
        combined_override["decision"]["exact_user_message"] = (
            "接受 S01-action-02-v01 第三次失败图，并仅此一次放行三次尝试"
            "限制、P0 前后朝向门禁与 P2 背带拓扑门禁；保留真实提示词及"
            "失败证据。"
        )
        combined_override["consumption"]["consumed_transition_id"] = (
            f"{self.episode_id}:S01-action-02:p0-p2:1"
        )
        combined_override.pop("override_sha256")
        combined_override["override_sha256"] = MODULE._canonical_sha256(
            combined_override
        )
        combined_item.update(
            user_mechanical_gate_override=combined_override,
            waived_mechanical_gate_ids=combined_override["gate_ids"],
            override_bound_artifacts=combined_artifacts,
        )
        combined_blocker["user_mechanical_gate_override_sha256"] = (
            combined_override["override_sha256"]
        )
        self.write_state(
            combined_item,
            extra_state={
                "episode_id": self.episode_id,
                "blockers": [combined_blocker],
            },
        )
        self.assertEqual(self.errors(), [])

        prompt.write_text(original_prompt_text, encoding="utf-8")
        qa_file.write_bytes(original_qa_bytes)

        original_item = json.loads(json.dumps(item))
        original_blocker = json.loads(json.dumps(blocker))
        prompt.write_text(
            "FINAL P2 CAMERA AND BAG-END LAYOUT — BLOCKING PRIORITY:\n"
            "HERO-POSE ASSET: full-canvas transparent RGBA after deterministic "
            "chroma conversion, with fixed registration anchors.\n",
            encoding="utf-8",
        )
        item["asset_kind"] = "hero_pose"
        item["prompt_checksum_sha256"] = sha256(prompt)
        prompt_binding["checksum_sha256"] = item["prompt_checksum_sha256"]
        for failure_list in (
            item["image_generation_qa_failures"],
            item["white_cat_imagegen_qa_failures"],
        ):
            for failure in failure_list:
                failure["prompt"] = json.loads(json.dumps(prompt_binding))
        prompt_gate_ids = [
            f"visual_asset.{item['asset_id']}.P2_PROMPT_FIXED_MARKER",
            f"visual_asset.{item['asset_id']}.HERO_POSE_PROMPT_FIXED_MARKER",
        ]
        prompt_failures = [
            {
                "gate_id": prompt_gate_ids[0],
                "observed_result": "fail",
                "reason": (
                    "P2_PROMPT_FIXED_MARKER: required literal is missing: "
                    "WHITE-CAT SATCHEL STRAP LOCK:"
                ),
            },
            {
                "gate_id": prompt_gate_ids[1],
                "observed_result": "fail",
                "reason": (
                    "HERO_POSE_PROMPT_FIXED_MARKER: required literal is missing: "
                    "HERO-POSE ASSET: full-canvas transparent RGBA with fixed "
                    "registration anchors."
                ),
            },
        ]
        override["gate_ids"].extend(prompt_gate_ids)
        override["acknowledged_failures"].extend(
            json.loads(json.dumps(prompt_failures))
        )
        override["decision"]["supplemental_exact_user_messages"] = [{
            "exact_user_message": (
                "对 S01-action-02-v01 本次转换，追加一次性放行 P2 提示词固定"
                "标记缺失与 HERO-POSE 固定标记不完全匹配门禁；保留真实提示词"
                "及失败证据。"
            ),
            "decided_at": "2026-08-29T18:21:00+08:00",
            "disposition": "allow_once",
            "gate_ids": prompt_gate_ids,
        }]
        override.pop("override_sha256")
        override["override_sha256"] = MODULE._canonical_sha256(override)
        item["waived_mechanical_gate_ids"] = override["gate_ids"]
        item["override_bound_artifacts"] = artifacts
        item["prompt_contract_qa"] = {
            "contract_version": "white-cat-prompt-fixed-marker-qa-v1",
            "result": "failed_but_waived_once",
            "prompt": prompt_binding,
            "failures": json.loads(json.dumps(prompt_failures)),
        }
        blocker["user_mechanical_gate_override_sha256"] = override["override_sha256"]
        self.write_state(
            item,
            extra_state={"episode_id": self.episode_id, "blockers": [blocker]},
        )
        self.assertEqual(self.errors(), [])

        item["prompt_contract_qa"]["failures"][0]["reason"] = "stale reason"
        self.write_state(
            item,
            extra_state={"episode_id": self.episode_id, "blockers": [blocker]},
        )
        self.assertTrue(any(
            "prompt-marker QA evidence is stale" in error
            for error in self.errors()
        ))
        item["prompt_contract_qa"]["failures"] = json.loads(
            json.dumps(prompt_failures)
        )

        override["decision"]["supplemental_exact_user_messages"][0][
            "exact_user_message"
        ] = "一次性放行提示词门禁"
        override.pop("override_sha256")
        override["override_sha256"] = MODULE._canonical_sha256(override)
        blocker["user_mechanical_gate_override_sha256"] = override["override_sha256"]
        self.write_state(
            item,
            extra_state={"episode_id": self.episode_id, "blockers": [blocker]},
        )
        self.assertTrue(any(
            "supplemental prompt-marker release is stale" in error
            for error in self.errors()
        ))

        item = original_item
        blocker = original_blocker
        prompt.write_text(
            "WHITE-CAT SATCHEL STRAP LOCK:\n"
            "HERO-POSE ASSET: full-canvas transparent RGBA with fixed "
            "registration anchors.\n",
            encoding="utf-8",
        )

        blocker["status"] = "resolved"
        self.write_state(item, extra_state={"episode_id": self.episode_id, "blockers": [blocker]})
        self.assertTrue(any("attempt-limit blocker is stale" in error for error in self.errors()))

    def test_pending_imagegen_action_requires_action_v2(self) -> None:
        item = self.item(status="awaiting_batch_qa")
        item["role"] = "action-01"
        self.write_state(item)
        errors = self.errors()
        self.assertTrue(any("action-qa-v2" in error for error in errors))

    def test_pending_qa_checksum_tampering_fails(self) -> None:
        item = self.item(status="awaiting_batch_qa")
        item["qa_evidence_checksum_sha256"] = "0" * 64
        self.write_state(item)
        self.assertTrue(any("checksum is stale" in error for error in self.errors()))

    def test_pending_qa_path_tampering_fails(self) -> None:
        item = self.item(status="qa_passed_pending_batch_review")
        item["qa_evidence_path"] = "/tmp/forged-white-cat-qa.json"
        self.write_state(item)
        self.assertTrue(any("root-relative" in error for error in self.errors()))

    def test_pending_xuan_without_anatomy_fails(self) -> None:
        item = self.item(
            status="awaiting_user_approval",
            route="xuan-paper-diorama",
            qa_contract="xuan-paper-diorama-asset-qa-v1",
            include_anatomy=False,
        )
        self.write_state(item)
        self.assertTrue(any("anatomy evidence is missing" in error for error in self.errors()))

    def test_pending_xuan_v1_wrapper_with_anatomy_v2_passes(self) -> None:
        item = self.item(
            status="awaiting_user_approval",
            route="xuan-paper-diorama",
            qa_contract="xuan-paper-diorama-asset-qa-v1",
        )
        self.write_state(item)
        self.assertEqual(self.errors(), [])

    def test_anatomy_source_must_match_final_queue_binding(self) -> None:
        item = self.item(status="awaiting_user_approval")
        qa_file = self.repo / item["qa_evidence_path"]
        qa = json.loads(qa_file.read_text(encoding="utf-8"))
        qa["identity_qa"]["anatomy_evidence"]["source_image"]["checksum_sha256"] = "1" * 64
        qa_file.write_text(json.dumps(qa, ensure_ascii=False) + "\n", encoding="utf-8")
        item["qa_evidence_checksum_sha256"] = sha256(qa_file)
        self.write_state(item)
        self.assertTrue(any("source binding is stale" in error for error in self.errors()))

    def test_pending_v2_numbered_map_tampering_fails(self) -> None:
        item = self.item(status="qa_passed_pending_final_review")
        self.numbered_map.write_bytes(b"tampered-numbered-map")
        self.write_state(item)
        self.assertTrue(any("numbered limb map checksum is stale" in error for error in self.errors()))

    def test_pending_v2_numbered_map_deletion_fails(self) -> None:
        item = self.item(status="awaiting_user_approval")
        self.numbered_map.unlink()
        self.write_state(item)
        self.assertTrue(any("numbered limb map path is missing" in error for error in self.errors()))

    def test_pending_v2_numbered_map_source_and_limb_ids_must_match(self) -> None:
        item = self.item(status="awaiting_batch_qa")
        qa_file = self.repo / item["qa_evidence_path"]
        qa = json.loads(qa_file.read_text(encoding="utf-8"))
        inspection = qa["identity_qa"]["anatomy_evidence"]["inspection_evidence"]
        inspection["numbered_limb_map_source_checksum_sha256"] = "1" * 64
        inspection["numbered_limb_map_limb_ids"] = ["F1", "F2", "H1", "H3"]
        qa_file.write_text(json.dumps(qa, ensure_ascii=False) + "\n", encoding="utf-8")
        item["qa_evidence_checksum_sha256"] = sha256(qa_file)
        self.write_state(item)
        errors = self.errors()
        self.assertTrue(any("numbered limb map source binding is stale" in error for error in errors))
        self.assertTrue(any("numbered limb map limb IDs are invalid" in error for error in errors))

    def test_regeneration_states_do_not_require_legacy_evidence_migration(self) -> None:
        for status in ("changes_requested", "pending_generation"):
            with self.subTest(status=status):
                item = self.item(
                    status=status,
                    qa_contract="ordinary-imagegen-white-cat-master-qa-v1",
                    include_anatomy=False,
                )
                item.pop("qa_evidence_path")
                item.pop("qa_evidence_checksum_sha256")
                self.write_state(item)
                self.assertEqual(self.errors(), [])

    def test_unfinished_ian_flattened_queue_requires_migration(self) -> None:
        self.write_state(self.ian_item(include_plan=False))
        self.assertTrue(any(
            "must migrate from a flattened raster" in error
            for error in self.errors()
        ))

    def test_unfinished_ian_layered_plan_can_wait_for_generation(self) -> None:
        self.write_state(self.ian_item())
        self.assertEqual(self.errors(), [])

    def test_completed_legacy_ian_remains_read_only(self) -> None:
        self.write_state(
            self.ian_item(include_plan=False, status="approved"),
            current_phase="delivered",
        )
        self.assertEqual(self.errors(), [])

    def test_qa_passed_ian_requires_complete_package_projection(self) -> None:
        self.write_state(self.ian_item(status="qa_passed_pending_final_review"))
        errors = self.errors()
        self.assertTrue(any("manifest path" in error for error in errors))
        self.assertTrue(any("package QA/member projection is incomplete" in error for error in errors))

    def test_qa_passed_ian_accepts_active_v2_master_first_projection(self) -> None:
        item = self.attach_ian_v2_package(
            self.ian_item(status="qa_passed_pending_final_review")
        )
        self.write_state(item)
        self.assertEqual(self.errors(), [])

    def test_stopped_ian_earlier_repair_source_requires_exact_consumed_override(
        self,
    ) -> None:
        item = self.attach_stopped_ian_earlier_source_override(
            self.attach_ian_v2_package(
                self.ian_item(status="qa_passed_pending_final_review")
            )
        )
        self.write_state(item, extra_state={"episode_id": self.episode_id})
        self.assertEqual(self.errors(), [])

        item.pop("ian_layout_repair_source_selection")
        self.write_state(item, extra_state={"episode_id": self.episode_id})
        self.assertTrue(any(
            "lacks a consumed exact override" in error for error in self.errors()
        ))

    def test_qa_passed_ian_rejects_v1_package_in_unfinished_episode(self) -> None:
        item = self.attach_ian_v2_package(
            self.ian_item(status="qa_passed_pending_final_review")
        )
        manifest_file = self.repo / item["scene_package_manifest_path"]
        manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
        manifest["contract_version"] = "ian-knowledge-video-layered-scene-v1"
        manifest_file.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
        item["scene_package_manifest_checksum_sha256"] = sha256(manifest_file)
        self.write_state(item)
        self.assertTrue(any("manifest is stale" in error for error in self.errors()))

    def visible_text_review_state(self, *, row_approval: bool = False) -> dict:
        storyboard_path = f"{self.workspace_relative}/assets/narration/storyboard-v1.md"
        storyboard = self.repo / storyboard_path
        storyboard.write_text("storyboard", encoding="utf-8")
        direction_path = f"{self.workspace_relative}/schema/direction-v3.json"
        direction = {
            "contract_version": "per-shot-visual-direction-review-v3",
            "status": "policy_authorized",
            "storyboard": {
                "path": storyboard_path,
                "checksum_sha256": sha256(storyboard),
            },
            "presented_map_sha256": "c" * 64,
            "rows": [{
                "shot_id": "S01",
                "user_selection": {
                    "visible_text_mode": "required",
                    "exact_visible_text": "一次结果 ≠ 无法改变",
                    "visible_text_placement": "中心结论框",
                },
            }],
        }
        direction_file = self.repo / direction_path
        direction_file.write_text(
            json.dumps(direction, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        direction_binding = {
            "status": "policy_authorized",
            "path": direction_path,
            "checksum_sha256": sha256(direction_file),
            "presented_map_sha256": direction["presented_map_sha256"],
        }
        row = {
            "shot_id": "S01",
            "visible_text_mode": "required",
            "exact_visible_text": "一次结果 ≠ 无法改变",
            "visible_text_placement": "中心结论框",
            "source_text_sha256": "d" * 64,
            "text_style_contract": "concise-summary-visible-text-v1",
            "text_style_qa": {
                "contract_version": "concise-summary-visible-text-v1",
                "result": "pass",
            },
        }
        if row_approval:
            row["approval"] = {"status": "approved"}
        review = {
            "contract_version": "visible-text-batch-review-v1",
            "episode_workspace": self.workspace_relative,
            "status": "approved",
            "storyboard": direction["storyboard"],
            "visual_direction_review": direction_binding,
            "batch_scope": "complete_active_generated_shot_visible_text_map",
            "row_approval_mode": "forbidden_batch_only",
            "text_style_contract": "concise-summary-visible-text-v1",
            "rows": [row],
        }
        projection = {
            key: review[key]
            for key in (
                "contract_version",
                "episode_workspace",
                "storyboard",
                "visual_direction_review",
                "batch_scope",
                "row_approval_mode",
                "text_style_contract",
                "rows",
            )
        }
        review["presented_map_sha256"] = MODULE._canonical_sha256(projection)
        review["presentation"] = {
            "exact_message": "请整批审核以下全部可见文字。",
            "presented_at": "2026-08-24T15:00:00+08:00",
            "complete_map_presented": True,
        }
        review["approval"] = {
            "status": "approved",
            "scope": "complete_presented_map",
            "presented_map_sha256": review["presented_map_sha256"],
            "exact_message": "批准全部可见文字",
            "decided_at": "2026-08-24T15:02:00+08:00",
            "user_has_reviewed_complete_map": True,
            "row_by_row_approval_performed": False,
        }
        review_path = f"{self.workspace_relative}/schema/visible-text-batch-review-v1.json"
        review_file = self.repo / review_path
        review_file.write_text(
            json.dumps(review, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return {
            "workspace_path": self.workspace_relative,
            "visual_direction_review": direction_binding,
            "visible_text_review": {
                "contract_version": "visible-text-batch-review-v1",
                "status": "approved",
                "path": review_path,
                "checksum_sha256": sha256(review_file),
                "presented_map_sha256": review["presented_map_sha256"],
                "exact_decision_message": "批准全部可见文字",
                "decided_at": "2026-08-24T15:02:00+08:00",
                "approval_scope": "complete_presented_map",
                "user_has_reviewed_complete_map": True,
                "row_by_row_approval_performed": False,
            },
        }

    def test_unfinished_post_direction_phase_requires_visible_text_batch_review(self) -> None:
        context = self.visible_text_review_state()
        context.pop("visible_text_review")
        self.write_state(
            self.item(status="pending_generation"),
            extra_state=context,
        )
        self.assertTrue(any(
            "complete visible-text batch approval is missing" in error
            for error in self.errors()
        ))

    def test_approved_visible_text_batch_review_passes_workspace_gate(self) -> None:
        self.write_state(
            self.item(status="pending_generation"),
            extra_state=self.visible_text_review_state(),
        )
        self.assertEqual(self.errors(), [])

    def test_visible_text_rows_must_not_carry_per_shot_approvals(self) -> None:
        self.write_state(
            self.item(status="pending_generation"),
            extra_state=self.visible_text_review_state(row_approval=True),
        )
        self.assertTrue(any(
            "must not carry per-shot approval evidence" in error
            for error in self.errors()
        ))

    def test_completed_legacy_delivery_without_bgm_recommendation_remains_valid(self) -> None:
        self.write_state(
            self.item(
                status="approved",
                qa_contract="ordinary-imagegen-white-cat-master-qa-v1",
                include_anatomy=False,
            ),
            current_phase="delivered",
        )
        self.assertEqual(self.errors(), [])

    def test_waiting_post_delivery_bgm_phase_accepts_passing_delivery(self) -> None:
        context = self.post_delivery_context()
        context.pop("post_delivery_bgm_recommendation")
        self.write_state(
            self.item(
                status="approved",
                qa_contract="ordinary-imagegen-white-cat-master-qa-v1",
                include_anatomy=False,
            ),
            current_phase="awaiting_post_delivery_bgm_recommendation",
            extra_state=context,
        )
        self.assertEqual(self.errors(), [])

    def test_required_final_delivery_rejects_missing_bgm_recommendation(self) -> None:
        context = self.post_delivery_context()
        context.pop("post_delivery_bgm_recommendation")
        self.write_state(
            self.item(
                status="approved",
                qa_contract="ordinary-imagegen-white-cat-master-qa-v1",
                include_anatomy=False,
            ),
            current_phase="delivered",
            extra_state=context,
        )
        self.assertTrue(any(
            "post-delivery BGM recommendation evidence is missing" in error
            for error in self.errors()
        ))

    def test_required_final_delivery_accepts_valid_bgm_recommendation(self) -> None:
        self.write_state(
            self.item(
                status="approved",
                qa_contract="ordinary-imagegen-white-cat-master-qa-v1",
                include_anatomy=False,
            ),
            current_phase="delivered",
            extra_state=self.post_delivery_context(),
        )
        self.assertEqual(self.errors(), [])

    def test_post_delivery_bgm_recommendation_must_not_mutate_media(self) -> None:
        context = self.post_delivery_context()
        artifact_file = self.repo / context["post_delivery_bgm_recommendation"]["artifact_path"]
        artifact = json.loads(artifact_file.read_text(encoding="utf-8"))
        artifact["mutation_evidence"]["music_mixed"] = True
        artifact_file.write_text(
            json.dumps(artifact, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        context["post_delivery_bgm_recommendation"][
            "artifact_checksum_sha256"
        ] = sha256(artifact_file)
        self.write_state(
            self.item(
                status="approved",
                qa_contract="ordinary-imagegen-white-cat-master-qa-v1",
                include_anatomy=False,
            ),
            current_phase="delivered",
            extra_state=context,
        )
        self.assertTrue(any(
            "must preserve delivered media" in error for error in self.errors()
        ))

    def test_current_composition_requires_sound_design_binding(self) -> None:
        self.write_state(
            self.item(
                status="approved",
                qa_contract="ordinary-imagegen-white-cat-master-qa-v1",
                include_anatomy=False,
            ),
            current_phase="composition_locked",
        )
        self.assertTrue(any(
            "requires a passing sound-effect design" in error for error in self.errors()
        ))

    def test_current_composition_accepts_checksum_current_sound_design(self) -> None:
        library = {
            "path": "leverage-video/src/shared/sound-effects/manifest-v3.json",
            "checksum_sha256": "e" * 64,
        }
        policy_file = self.repo / "leverage-video/src/shared/sound-effects/sound-design-policy-v2.json"
        policy_file.parent.mkdir(parents=True, exist_ok=True)
        policy_file.write_text('{"contract_version":"knowledge-video-sound-design-policy-v2"}\n', encoding="utf-8")
        policy = {
            "path": policy_file.relative_to(self.repo).as_posix(),
            "checksum_sha256": sha256(policy_file),
        }
        artifact = {
            "contract_version": "knowledge-video-sound-design-v2",
            "status": "qa_passed",
            "resume_mode": "standard",
            "revoice": None,
            "episode_workspace": self.workspace.relative_to(self.repo).as_posix(),
            "fps": 30,
            "duration_frames": 90,
            "policy": {},
            "bindings": {
                "sound_effect_library": library,
                "sound_design_policy": policy,
            },
            "bus_gain_multiplier": 1.12,
            "shot_analysis": [],
            "events": [],
            "event_map_sha256": "",
            "result": "pass",
        }
        projection = dict(artifact)
        projection.pop("event_map_sha256")
        projection.pop("result")
        artifact["event_map_sha256"] = MODULE._canonical_sha256(projection)
        artifact_file = self.workspace / "schema/knowledge-video-sound-design-v2.json"
        artifact_file.write_text(
            json.dumps(artifact, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        binding = {
            "contract_version": "knowledge-video-sound-design-v2",
            "status": "qa_passed",
            "path": artifact_file.relative_to(self.repo).as_posix(),
            "checksum_sha256": sha256(artifact_file),
            "event_map_sha256": artifact["event_map_sha256"],
            "bus_gain_multiplier": 1.12,
            "sound_effect_library": library,
            "sound_design_policy": policy,
        }
        self.write_state(
            self.item(
                status="approved",
                qa_contract="ordinary-imagegen-white-cat-master-qa-v1",
                include_anatomy=False,
            ),
            current_phase="composition_locked",
            extra_state={"sound_effect_design": binding},
        )
        self.assertEqual(self.errors(), [])

        self.write_state(
            self.item(
                status="approved",
                qa_contract="ordinary-imagegen-white-cat-master-qa-v1",
                include_anatomy=False,
            ),
            current_phase="final_rendering",
            extra_state={"sound_effect_design": binding},
        )
        self.assertTrue(any(
            "audio-only sound preflight" in error for error in self.errors()
        ))

        preflight = {
            "contract_version": "knowledge-video-sound-audio-preflight-v1",
            "result": "pass",
            "sound_effects_projection_sha256": "f" * 64,
            "narration": {
                "asset": "episode-test/assets/audio/narration.wav",
                "checksum_sha256": "c" * 64,
                "gain": 1,
            },
            "normalization": "disabled",
            "bus_gain_multiplier": 1.12,
            "cue_groups": [],
            "full_master_frames": 90,
            "sample_rate_hz": 44100,
            "measured_peak_dbfs": -1.2,
            "peak_ceiling_dbfs": -1,
            "full_video_rendered": False,
        }
        preflight_file = self.workspace / "schema/sound-effect-audio-preflight-v1.json"
        preflight_file.write_text(
            json.dumps(preflight, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        preflight_binding = {
            "contract_version": "knowledge-video-sound-audio-preflight-v1",
            "status": "qa_passed",
            "path": preflight_file.relative_to(self.repo).as_posix(),
            "checksum_sha256": sha256(preflight_file),
            "sound_effects_projection_sha256": "f" * 64,
            "bus_gain_multiplier": 1.12,
        }
        self.write_state(
            self.item(
                status="approved",
                qa_contract="ordinary-imagegen-white-cat-master-qa-v1",
                include_anatomy=False,
            ),
            current_phase="final_rendering",
            extra_state={
                "sound_effect_design": binding,
                "sound_effect_audio_preflight": preflight_binding,
            },
        )
        self.assertEqual(self.errors(), [])

        artifact["contract_version"] = "knowledge-video-sound-design-v1"
        projection = dict(artifact)
        projection.pop("event_map_sha256")
        projection.pop("result")
        artifact["event_map_sha256"] = MODULE._canonical_sha256(projection)
        artifact_file.write_text(
            json.dumps(artifact, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        binding["contract_version"] = "knowledge-video-sound-design-v1"
        binding["checksum_sha256"] = sha256(artifact_file)
        binding["event_map_sha256"] = artifact["event_map_sha256"]
        self.write_state(
            self.item(
                status="approved",
                qa_contract="ordinary-imagegen-white-cat-master-qa-v1",
                include_anatomy=False,
            ),
            current_phase="composition_locked",
            extra_state={"sound_effect_design": binding},
        )
        self.assertTrue(any(
            "incomplete or stale" in error for error in self.errors()
        ))

    def test_malformed_episode_state_fails_closed(self) -> None:
        (self.workspace / "schema/episode-state.json").write_text(
            "{not-json",
            encoding="utf-8",
        )
        self.assertTrue(any("not valid UTF-8 JSON" in error for error in self.errors()))


if __name__ == "__main__":
    unittest.main()
