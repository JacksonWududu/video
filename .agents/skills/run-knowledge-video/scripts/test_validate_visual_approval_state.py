#!/usr/bin/env python3
import copy
import hashlib
import importlib.util
import pathlib
import struct
import tempfile
import unittest


SCRIPT = pathlib.Path(__file__).with_name("validate_visual_approval_state.py")


def load_module():
    spec = importlib.util.spec_from_file_location("visual_gate", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load visual approval validator")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class VisualApprovalGateTests(unittest.TestCase):
    def setUp(self):
        self.gate = load_module()
        self._temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self._temporary_directory.cleanup)
        self.repository_root = pathlib.Path(self._temporary_directory.name)
        self.state = {
            "visual_asset_review": {
                "mode": "sequential_per_image",
                "generation_aspect_ratio": [16, 9],
                "generation_aspect_ratio_max_relative_error": 0.005,
                "queue": [
                    {
                        "asset_id": "S06-master-v02",
                        "role": "base/master",
                        "depends_on": [],
                        "status": "pending_generation",
                    },
                    {
                        "asset_id": "S06-action-01-v02",
                        "role": "action-01",
                        "depends_on": ["S06-master-v02"],
                        "status": "pending_generation",
                    },
                ],
            }
        }

    def _write_png(self, relative_path, width=1672, height=941, marker=b"v1"):
        target = self.repository_root / relative_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(
            b"\x89PNG\r\n\x1a\n"
            + struct.pack(">I", 13)
            + b"IHDR"
            + struct.pack(">II", width, height)
            + b"\x08\x06\x00\x00\x00"
            + marker
        )
        return target

    @staticmethod
    def _sha256(path):
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def test_blocks_next_image_until_current_exact_bytes_are_approved(self):
        with self.assertRaisesRegex(ValueError, "current asset is not approved"):
            self.gate.require_generation_allowed(self.state, "S06-action-01-v02")

    def test_approval_requires_presented_and_current_checksum_to_match(self):
        item = self.state["visual_asset_review"]["queue"][0]
        item.update(
            status="awaiting_user_approval",
            path="leverage-video/src/topic3/assets/image/s06-master-v02.png",
            checksum_sha256="a" * 64,
            presented_checksum_sha256="b" * 64,
        )
        with self.assertRaisesRegex(ValueError, "checksum mismatch"):
            self.gate.record_approval(self.state, "S06-master-v02", "批准 S06 母图", "2026-08-12T00:00:00Z")

    def test_approved_master_unlocks_only_the_immediate_next_asset(self):
        item = self.state["visual_asset_review"]["queue"][0]
        item.update(
            status="awaiting_user_approval",
            path="leverage-video/src/topic3/assets/image/s06-master-v02.png",
            checksum_sha256="a" * 64,
            presented_checksum_sha256="a" * 64,
            measured_dimensions=[2048, 1152],
        )
        self.gate.record_approval(self.state, "S06-master-v02", "批准 S06 母图", "2026-08-12T00:00:00Z")
        self.gate.require_generation_allowed(self.state, "S06-action-01-v02")
        with self.assertRaisesRegex(ValueError, "not the next queued asset"):
            self.gate.require_generation_allowed(self.state, "S06-action-02-v02")

    def test_changes_requested_keeps_downstream_locked(self):
        state = copy.deepcopy(self.state)
        item = state["visual_asset_review"]["queue"][0]
        item.update(
            status="awaiting_user_approval",
            path="leverage-video/src/topic3/assets/image/s06-master-v02.png",
            checksum_sha256="a" * 64,
            presented_checksum_sha256="a" * 64,
        )
        self.gate.record_changes_requested(state, "S06-master-v02", "脸不像 v2", "2026-08-12T00:00:00Z")
        with self.assertRaisesRegex(ValueError, "current asset is not approved"):
            self.gate.require_generation_allowed(state, "S06-action-01-v02")

    def test_approval_accepts_1672x941_as_close_16x9(self):
        item = self.state["visual_asset_review"]["queue"][0]
        item.update(
            status="awaiting_user_approval",
            path="leverage-video/src/topic3/assets/image/s06-master-v02.png",
            checksum_sha256="a" * 64,
            presented_checksum_sha256="a" * 64,
            measured_dimensions=[1672, 941],
        )
        self.gate.record_approval(self.state, "S06-master-v02", "批准 S06 母图", "2026-08-12T00:00:00Z")

    def test_approval_rejects_image_outside_16x9_tolerance(self):
        item = self.state["visual_asset_review"]["queue"][0]
        item.update(
            status="awaiting_user_approval",
            path="leverage-video/src/topic3/assets/image/s06-master-v02.png",
            checksum_sha256="a" * 64,
            presented_checksum_sha256="a" * 64,
            measured_dimensions=[1600, 1200],
        )
        with self.assertRaisesRegex(ValueError, "generated aspect ratio is outside tolerance"):
            self.gate.record_approval(self.state, "S06-master-v02", "批准 S06 母图", "2026-08-12T00:00:00Z")

    def test_user_defined_one_shorthand_is_explicit_approval(self):
        item = self.state["visual_asset_review"]["queue"][0]
        item.update(
            status="awaiting_user_approval",
            path="leverage-video/src/topic3/assets/image/s06-master-v02.png",
            checksum_sha256="a" * 64,
            presented_checksum_sha256="a" * 64,
            measured_dimensions=[1672, 941],
        )
        approved = self.gate.record_approval(
            self.state, "S06-master-v02", "1", "2026-08-12T00:00:00Z"
        )
        self.assertEqual(approved["status"], "approved")

    def test_explicit_correct_and_matches_expectation_is_approval(self):
        item = self.state["visual_asset_review"]["queue"][0]
        item.update(
            status="awaiting_user_approval",
            path="leverage-video/src/topic3/assets/image/s06-master-v02.png",
            checksum_sha256="a" * 64,
            presented_checksum_sha256="a" * 64,
            measured_dimensions=[1672, 940],
        )
        approved = self.gate.record_approval(
            self.state,
            "S06-master-v02",
            "这张是对的， 符合预期的",
            "2026-08-13T00:00:00Z",
        )
        self.assertEqual(approved["status"], "approved")

    def test_batch_mode_qa_pass_unlocks_only_next_asset_without_final_approval(self):
        self.state["visual_asset_review"]["mode"] = "batch_final_review"
        item = self.state["visual_asset_review"]["queue"][0]
        item.update(
            status="awaiting_batch_qa",
            path="leverage-video/src/topic3/assets/image/s06-master-v02.png",
            checksum_sha256="a" * 64,
            measured_dimensions=[1672, 940],
        )
        passed = self.gate.record_batch_qa_pass(
            self.state, "S06-master-v02", "2026-08-13T00:00:00Z"
        )
        self.assertEqual(passed["status"], "qa_passed_pending_batch_review")
        self.assertNotIn("approved_checksum_sha256", passed)
        self.gate.require_generation_allowed(self.state, "S06-action-01-v02")

    def test_batch_final_approval_requires_every_item_to_be_qa_passed_or_preapproved(self):
        self.state["visual_asset_review"]["mode"] = "batch_final_review"
        first, second = self.state["visual_asset_review"]["queue"]
        first.update(
            status="qa_passed_pending_batch_review",
            path="leverage-video/src/topic3/assets/image/s06-master-v02.png",
            checksum_sha256="a" * 64,
            batch_qa_checksum_sha256="a" * 64,
            measured_dimensions=[1672, 940],
        )
        with self.assertRaisesRegex(ValueError, "not ready for batch approval"):
            self.gate.record_batch_approval(
                self.state, "全部批准", "2026-08-13T00:00:00Z"
            )
        second.update(
            status="qa_passed_pending_batch_review",
            path="leverage-video/src/topic3/assets/image/s06-action-01-v02.png",
            checksum_sha256="b" * 64,
            batch_qa_checksum_sha256="b" * 64,
            measured_dimensions=[1672, 940],
        )
        approved = self.gate.record_batch_approval(
            self.state, "全部批准", "2026-08-13T00:00:00Z"
        )
        self.assertTrue(all(item["status"] == "approved" for item in approved))

    def test_inactive_superseded_shot_does_not_block_current_queue(self):
        self.state["visual_asset_review"]["queue"] = [
            {
                "asset_id": "S01-transition-v02",
                "status": "superseded",
                "active_for_current_storyboard": False,
            },
            {
                "asset_id": "S06-master-v02",
                "status": "approved",
                "active_for_current_storyboard": True,
            },
            {
                "asset_id": "S07-transition-v03",
                "role": "transition-graphic",
                "depends_on": [],
                "status": "pending_generation",
                "active_for_current_storyboard": True,
            },
        ]
        current = self.gate.require_generation_allowed(
            self.state, "S07-transition-v03"
        )
        self.assertEqual(current["asset_id"], "S07-transition-v03")

    def test_storyboard_review_pause_blocks_visual_generation(self):
        self.state["visual_asset_review"]["queue_generation_allowed"] = False
        with self.assertRaisesRegex(ValueError, "visual review queue is paused"):
            self.gate.require_generation_allowed(self.state, "S06-master-v02")

    def _whiteboard_state(self):
        return {
            "visual_asset_review": {
                "mode": "sequential_per_image",
                "generation_aspect_ratio": [16, 9],
                "generation_aspect_ratio_max_relative_error": 0.005,
                "queue": [
                    {
                        "asset_id": "S01-whiteboard-v01",
                        "visual_generation_route": "srt-whiteboard-animation",
                        "status": "awaiting_user_approval",
                        "depends_on": [],
                        "whiteboard_review": {
                            "contract_version": "whiteboard-visual-asset-review-v1",
                            "current_stage": "source_image_review",
                            "source_image_review": {
                                "status": "awaiting_user_approval",
                                "source_image_path": "leverage-video/src/example/assets/image/s01-whiteboard-v01.png",
                                "source_image_checksum_sha256": "a" * 64,
                                "presented_source_image_checksum_sha256": "a" * 64,
                                "measured_dimensions": [1672, 941],
                            },
                            "annotation_review": {"status": "locked"},
                            "clip_review": {"status": "locked"},
                        },
                    },
                    {
                        "asset_id": "S02-master-v01",
                        "status": "pending_generation",
                        "depends_on": ["S01-whiteboard-v01"],
                    },
                ],
            }
        }

    def test_whiteboard_requires_source_annotation_and_clip_approvals_in_order(self):
        state = self._whiteboard_state()
        asset_id = "S01-whiteboard-v01"
        with self.assertRaisesRegex(ValueError, "require source, annotation, and clip approvals"):
            self.gate.record_approval(state, asset_id, "批准", "2026-08-15T00:00:00Z")
        self.gate.record_whiteboard_source_approval(
            state, asset_id, "批准源图", "2026-08-15T00:00:00Z"
        )
        with self.assertRaisesRegex(ValueError, "current asset is not approved"):
            self.gate.require_generation_allowed(state, "S02-master-v01")
        annotation_stage = self.gate.require_whiteboard_stage_allowed(
            state, asset_id, "annotation_review"
        )
        annotation_stage.update(
            status="awaiting_user_approval",
            annotation_path="leverage-video/src/example/schema/s01-whiteboard-annotation-v2.json",
            annotation_checksum_sha256="b" * 64,
            presented_annotation_checksum_sha256="b" * 64,
            preview_path="leverage-video/src/example/assets/image/s01-whiteboard-preview-v01.png",
            preview_checksum_sha256="c" * 64,
            presented_preview_checksum_sha256="c" * 64,
        )
        self.gate.record_whiteboard_annotation_approval(
            state, asset_id, "批准标注与预览", "2026-08-15T00:01:00Z"
        )
        clip_stage = self.gate.require_whiteboard_stage_allowed(state, asset_id, "clip_review")
        clip_stage.update(
            status="awaiting_user_approval",
            clip_path="leverage-video/src/example/assets/video/s01-whiteboard-v01.mp4",
            clip_checksum_sha256="d" * 64,
            presented_clip_checksum_sha256="d" * 64,
            render_evidence_path="leverage-video/src/example/schema/s01-whiteboard-render-evidence-v1.json",
            render_evidence_checksum_sha256="e" * 64,
            presented_render_evidence_checksum_sha256="e" * 64,
            render_evidence_contract_version="whiteboard-render-evidence-v1",
            expected_frame_count=90,
            media={
                "width": 1920,
                "height": 1080,
                "fps": 30,
                "codec": "h264",
                "audio_streams": 0,
                "frame_count": 90,
                "final_frame_verified": True,
                "full_frame_hold_verified_frames": 15,
            },
        )
        self.gate.record_whiteboard_clip_approval(
            state, asset_id, "批准白板片段", "2026-08-15T00:02:00Z"
        )
        self.assertEqual(state["visual_asset_review"]["queue"][0]["status"], "approved")
        self.gate.require_generation_allowed(state, "S02-master-v01")

    def test_whiteboard_change_request_rolls_back_only_current_and_later_stages(self):
        state = self._whiteboard_state()
        asset_id = "S01-whiteboard-v01"
        self.gate.record_whiteboard_source_approval(
            state, asset_id, "批准源图", "2026-08-15T00:00:00Z"
        )
        review = state["visual_asset_review"]["queue"][0]["whiteboard_review"]
        review["annotation_review"]["status"] = "awaiting_user_approval"
        self.gate.record_whiteboard_changes_requested(
            state, asset_id, "annotation_review", "区域二过大", "2026-08-15T00:01:00Z"
        )
        self.assertEqual(review["source_image_review"]["status"], "approved")
        self.assertEqual(review["annotation_review"]["status"], "changes_requested")
        self.assertEqual(review["clip_review"]["status"], "locked")
        with self.assertRaisesRegex(ValueError, "current asset is not approved"):
            self.gate.require_generation_allowed(state, "S02-master-v01")

    def test_batch_mode_cannot_bypass_whiteboard_stages(self):
        state = self._whiteboard_state()
        state["visual_asset_review"]["mode"] = "batch_final_review"
        item = state["visual_asset_review"]["queue"][0]
        item["status"] = "awaiting_batch_qa"
        with self.assertRaisesRegex(ValueError, "cannot bypass whiteboard"):
            self.gate.record_batch_qa_pass(
                state, "S01-whiteboard-v01", "2026-08-15T00:00:00Z"
            )

    def _hybrid_state(self, count=5):
        return {
            "visual_asset_review": {
                "contract_version": "visual-asset-review-v2",
                "mode": "hybrid_batch_v1",
                "batch_size": 4,
                "generation_aspect_ratio": [16, 9],
                "generation_aspect_ratio_max_relative_error": 0.005,
                "queue": [
                    {
                        "asset_id": f"S{index:02d}-graphic-v01",
                        "role": "standalone-graphic",
                        "depends_on": [],
                        "status": "pending_generation",
                    }
                    for index in range(1, count + 1)
                ],
            }
        }

    def _qa_hybrid(self, state, asset_id, checksum):
        item = next(
            item for item in state["visual_asset_review"]["queue"]
            if item["asset_id"] == asset_id
        )
        relative_path = f"assets/image/{asset_id}.png"
        asset_path = self._write_png(relative_path, marker=checksum.encode("ascii"))
        item.update(
            status="awaiting_batch_qa",
            path=relative_path,
            checksum_sha256=self._sha256(asset_path),
            measured_dimensions=[1672, 941],
            narration_source_text=f"旁白 {asset_id}",
            technical_qa={"result": "pass"},
        )
        return self.gate.record_hybrid_qa_pass(
            state, asset_id, "2026-08-15T00:00:00Z"
        )

    def test_hybrid_groups_four_normal_assets_and_hashes_the_ordered_manifest(self):
        state = self._hybrid_state()
        for index in range(1, 5):
            self._qa_hybrid(state, f"S{index:02d}-graphic-v01", hex(index)[2:] * 64)
        review = state["visual_asset_review"]
        self.assertFalse(review["queue_generation_allowed"])
        self.assertEqual(review["active_batch"]["asset_ids"], [
            "S01-graphic-v01", "S02-graphic-v01", "S03-graphic-v01", "S04-graphic-v01"
        ])
        self.assertRegex(review["active_batch"]["manifest_sha256"], r"^[0-9a-f]{64}$")

    def test_hybrid_strict_barrier_truncates_batch_and_requires_per_item_approval(self):
        state = self._hybrid_state(4)
        state["visual_asset_review"]["queue"][2].update(
            role="base/master", has_downstream_action_variants=True
        )
        self._qa_hybrid(state, "S01-graphic-v01", "a" * 64)
        self._qa_hybrid(state, "S02-graphic-v01", "b" * 64)
        review = state["visual_asset_review"]
        self.assertEqual(review["active_batch"]["asset_ids"], [
            "S01-graphic-v01", "S02-graphic-v01"
        ])
        with self.assertRaisesRegex(ValueError, "paused"):
            self.gate.require_generation_allowed(state, "S03-graphic-v01")

    def test_hybrid_whole_and_partial_batch_approval(self):
        state = self._hybrid_state(4)
        for index in range(1, 5):
            self._qa_hybrid(state, f"S{index:02d}-graphic-v01", str(index) * 64)
        approved = self.gate.record_hybrid_batch_approval(
            state, ["S01-graphic-v01"], "批准第一张", "2026-08-15T00:01:00Z",
            repository_root=self.repository_root,
        )
        self.assertEqual(approved[0]["status"], "approved")
        self.assertFalse(state["visual_asset_review"]["queue_generation_allowed"])
        self.gate.record_hybrid_batch_approval(
            state, None, "批准其余整批", "2026-08-15T00:02:00Z",
            repository_root=self.repository_root,
        )
        self.assertTrue(all(
            item["status"] == "approved"
            for item in state["visual_asset_review"]["queue"]
        ))
        self.assertNotIn("active_batch", state["visual_asset_review"])

    def test_hybrid_single_change_preserves_unchanged_approved_bytes(self):
        state = self._hybrid_state(4)
        for index in range(1, 5):
            self._qa_hybrid(state, f"S{index:02d}-graphic-v01", str(index) * 64)
        self.gate.record_hybrid_batch_approval(
            state, ["S01-graphic-v01"], "批准第一张", "2026-08-15T00:01:00Z",
            repository_root=self.repository_root,
        )
        first_checksum = state["visual_asset_review"]["queue"][0]["approved_checksum_sha256"]
        self.gate.record_hybrid_changes_requested(
            state, "S02-graphic-v01", "第二张改构图", "2026-08-15T00:02:00Z"
        )
        self.assertEqual(state["visual_asset_review"]["queue"][0]["status"], "approved")
        self.assertEqual(state["visual_asset_review"]["queue"][0]["approved_checksum_sha256"], first_checksum)
        self.assertEqual(state["visual_asset_review"]["queue"][1]["status"], "changes_requested")
        self.assertNotIn("active_batch", state["visual_asset_review"])

    def test_hybrid_approval_rejects_an_asset_overwritten_after_presentation(self):
        state = self._hybrid_state(4)
        for index in range(1, 5):
            self._qa_hybrid(state, f"S{index:02d}-graphic-v01", str(index) * 64)
        changed = self.repository_root / state["visual_asset_review"]["queue"][1]["path"]
        self._write_png(
            state["visual_asset_review"]["queue"][1]["path"],
            marker=b"user-edited-v2",
        )
        self.assertNotEqual(
            self._sha256(changed),
            state["visual_asset_review"]["queue"][1]["checksum_sha256"],
        )
        with self.assertRaisesRegex(ValueError, "changed on disk|checksum mismatch"):
            self.gate.record_hybrid_batch_approval(
                state, None, "批准整批", "2026-08-15T00:01:00Z",
                repository_root=self.repository_root,
            )

    def test_hybrid_strict_approval_rejects_overwritten_presented_bytes(self):
        state = self._hybrid_state(1)
        item = state["visual_asset_review"]["queue"][0]
        item.update(role="base/master", strict_review=True)
        relative_path = "assets/image/S01-master-v01.png"
        asset_path = self._write_png(relative_path, marker=b"presented-v1")
        checksum = self._sha256(asset_path)
        item.update(
            status="awaiting_user_approval",
            path=relative_path,
            checksum_sha256=checksum,
            presented_checksum_sha256=checksum,
            measured_dimensions=[1672, 941],
            technical_qa={"result": "pass"},
        )
        self._write_png(relative_path, marker=b"user-edited-v2")
        with self.assertRaisesRegex(ValueError, "changed on disk"):
            self.gate.record_approval(
                state, item["asset_id"], "批准当前文件", "2026-08-15T00:01:00Z",
                repository_root=self.repository_root,
            )

    def test_visual_asset_lock_rechecks_approved_bytes_on_disk(self):
        state = self._hybrid_state(4)
        for index in range(1, 5):
            self._qa_hybrid(state, f"S{index:02d}-graphic-v01", str(index) * 64)
        self.gate.record_hybrid_batch_approval(
            state, None, "批准整批", "2026-08-15T00:01:00Z",
            repository_root=self.repository_root,
        )
        self.assertEqual(
            self.gate.validate_visual_assets_locked(state, self.repository_root)["result"],
            "pass",
        )
        changed_path = state["visual_asset_review"]["queue"][2]["path"]
        self._write_png(changed_path, marker=b"changed-after-approval")
        with self.assertRaisesRegex(ValueError, "changed on disk|checksum mismatch"):
            self.gate.validate_visual_assets_locked(state, self.repository_root)


if __name__ == "__main__":
    unittest.main()
