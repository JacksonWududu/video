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
        self.workspace = self.repo / "leverage-video/src/topic1"
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

    def visible_text_review_state(self, *, row_approval: bool = False) -> dict:
        storyboard_path = "leverage-video/src/topic1/assets/narration/storyboard-v1.md"
        storyboard = self.repo / storyboard_path
        storyboard.write_text("storyboard", encoding="utf-8")
        direction_path = "leverage-video/src/topic1/schema/direction-v3.json"
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
            "episode_workspace": "leverage-video/src/topic1",
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
        review_path = "leverage-video/src/topic1/schema/visible-text-batch-review-v1.json"
        review_file = self.repo / review_path
        review_file.write_text(
            json.dumps(review, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return {
            "workspace_path": "leverage-video/src/topic1",
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

    def test_malformed_episode_state_fails_closed(self) -> None:
        (self.workspace / "schema/episode-state.json").write_text(
            "{not-json",
            encoding="utf-8",
        )
        self.assertTrue(any("not valid UTF-8 JSON" in error for error in self.errors()))


if __name__ == "__main__":
    unittest.main()
