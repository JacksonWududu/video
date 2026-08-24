#!/usr/bin/env python3
import copy
import hashlib
import importlib.util
import json
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

    def _attach_white_cat_v2(self, item, *, route="imagegen"):
        is_master = item.get("role") in {
            "base/master", "white-cat-master", "recurring-character-master",
        }
        contract_version = {
            ("imagegen", True): "ordinary-imagegen-white-cat-master-qa-v2",
            ("imagegen", False): "ordinary-imagegen-white-cat-action-qa-v2",
            ("xuan-paper-diorama", True): "xuan-paper-diorama-asset-qa-v1",
            ("xuan-paper-diorama", False): "xuan-paper-diorama-action-qa-v1",
        }[(route, is_master)]
        traces = [
            {"id": trace_id, "paw_region_id": f"P{index}"}
            for index, trace_id in enumerate(("F1", "F2", "H1", "H2"), start=1)
        ]
        numbered_map_path = "assets/image/white-cat-numbered-map.png"
        numbered_map = self._write_png(numbered_map_path, marker=b"numbered-map-v1")
        item.update(
            white_cat_present=True,
            visual_generation_route=route,
            qa_contract_version=contract_version,
            identity_qa={
                "result": "pass",
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
                "both_bag_end_anchors_visibly_traceable": True,
                "strap_paths_spatially_distinct": True,
                "source_retry_policy_compliant": True,
                "anatomy_evidence": {
                    "contract_version": "white-cat-anatomy-qa-v2",
                    "result": "pass",
                    "source_image": {
                        "path": item["path"],
                        "checksum_sha256": item["checksum_sha256"],
                    },
                    "limb_traces": traces,
                    "forward_trace_ids": ["F1", "F2", "H1", "H2"],
                    "reverse_trace_ids": ["F1", "F2", "H1", "H2"],
                    "unassigned_paw_like_shapes": 0,
                    "ambiguous_limb_regions": 0,
                    "branched_or_fused_limb_regions": 0,
                    "inspection_evidence": {
                        "methods": ["full_resolution", "numbered_limb_map"],
                        "numbered_limb_map_path": numbered_map_path,
                        "numbered_limb_map_checksum_sha256": self._sha256(numbered_map),
                        "numbered_limb_map_source_checksum_sha256": item[
                            "checksum_sha256"
                        ],
                        "numbered_limb_map_limb_ids": ["F1", "F2", "H1", "H2"],
                    },
                },
            },
        )
        return item

    def _attach_ian_layered_scene(self, item):
        source_text = "测试"
        scene_plan = {
            "contract_version": "ian-layered-scene-plan-v1",
            "shot_id": "S06",
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
                "semantic_role": "核心概念",
                "source_text_start_byte": 0,
                "source_text_end_byte_exclusive": len(source_text.encode("utf-8")),
                "source_text": source_text,
                "entry_frame": 0,
            }],
        }
        encoded_plan = json.dumps(
            scene_plan, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        ).encode("utf-8")
        plan_checksum = hashlib.sha256(encoded_plan).hexdigest()
        background_path = "episodes/fixture/assets/image/ian/background.png"
        layer_path = "episodes/fixture/assets/image/ian/L01.png"
        final_path = "episodes/fixture/assets/image/ian/final.png"
        background = self._write_png(background_path, 1920, 1080, b"background")
        layer = self._write_png(layer_path, 1920, 1080, b"layer")
        final = self._write_png(final_path, 1920, 1080, b"final")
        members = [
            {
                "member_role": "background",
                "layer_id": "background",
                "path": background_path,
                "checksum_sha256": self._sha256(background),
                "width": 1920,
                "height": 1080,
                "has_alpha": False,
            },
            {
                "member_role": "semantic-layer",
                "layer_id": "L01",
                "path": layer_path,
                "checksum_sha256": self._sha256(layer),
                "width": 1920,
                "height": 1080,
                "has_alpha": True,
            },
            {
                "member_role": "final-composite",
                "layer_id": "final-composite",
                "path": final_path,
                "checksum_sha256": self._sha256(final),
                "width": 1920,
                "height": 1080,
                "has_alpha": False,
            },
        ]
        manifest_path = "episodes/fixture/schema/ian-layered-scene-v1.json"
        manifest_file = self.repository_root / manifest_path
        manifest_file.parent.mkdir(parents=True, exist_ok=True)
        manifest_file.write_text(json.dumps({
            "contract_version": "ian-knowledge-video-layered-scene-v1",
            "queue_item_id": item["asset_id"],
            "shot_id": "S06",
            "scene_plan": scene_plan,
            "scene_plan_sha256": plan_checksum,
            "background": {
                "path": background_path,
                "checksum_sha256": self._sha256(background),
                "width": 1920,
                "height": 1080,
                "has_alpha": False,
            },
            "layers": [{
                "layer_id": "L01",
                "path": layer_path,
                "checksum_sha256": self._sha256(layer),
                "width": 1920,
                "height": 1080,
                "has_alpha": True,
            }],
            "final_composite": {
                "path": final_path,
                "checksum_sha256": self._sha256(final),
                "width": 1920,
                "height": 1080,
                "has_alpha": False,
            },
        }, ensure_ascii=False), encoding="utf-8")
        style_path = "episodes/fixture/assets/image/ian/style.png"
        style = self._write_png(style_path, 1920, 1080, b"style")
        references = [{
            "role": "visual_style_reference_only",
            "path": style_path,
            "checksum_sha256": self._sha256(style),
        }]
        generation_lineage = []
        for index, member in enumerate(members[:-1]):
            prompt_path = f"episodes/fixture/assets/narration/ian-member-{index + 1}-prompt.txt"
            prompt_file = self.repository_root / prompt_path
            prompt_file.parent.mkdir(parents=True, exist_ok=True)
            prompt_file.write_text(
                f"16:9 landscape composition\nIan member {member['layer_id']}\n",
                encoding="utf-8",
            )
            generation_lineage.append({
                "stage": "independent-member-generation",
                "generation_mode": "codex-native-imagegen-independent-member-v1",
                "member_role": member["member_role"],
                "layer_id": member["layer_id"],
                "prompt": {
                    "path": prompt_path,
                    "checksum_sha256": self._sha256(prompt_file),
                },
                "reference_inputs": references,
                "output": {
                    "path": member["path"],
                    "checksum_sha256": member["checksum_sha256"],
                },
                "selection_status": "selected",
            })
        item.update(
            shot_id="S06",
            status="awaiting_user_approval",
            strict_review=True,
            visual_generation_route="ian-handdrawn-ppt",
            qa_contract_version="ian-layered-scene-qa-v1",
            path=final_path,
            checksum_sha256=self._sha256(final),
            presented_checksum_sha256=self._sha256(final),
            measured_dimensions=[1920, 1080],
            scene_package_manifest_path=manifest_path,
            scene_package_manifest_checksum_sha256=self._sha256(manifest_file),
            ian_scene_plan=scene_plan,
            ian_scene_plan_sha256=plan_checksum,
            ian_scene_package_members=members,
            actual_reference_inputs=references,
            generation_lineage=generation_lineage,
        )
        item["presented_ian_layered_scene_package"] = (
            self.gate._require_ian_layered_scene_package(item)
        )
        return {"item": item, "layer": layer, "manifest": manifest_file}

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

    def test_ian_strict_approval_binds_the_complete_layered_package(self):
        item = self.state["visual_asset_review"]["queue"][0]
        self._attach_ian_layered_scene(item)
        approved = self.gate.record_approval(
            self.state,
            item["asset_id"],
            "批准 Ian 完整分层场景包",
            "2026-08-24T12:00:00Z",
            repository_root=self.repository_root,
        )
        self.assertEqual(approved["status"], "approved")
        self.assertEqual(
            approved["approved_ian_layered_scene_package"],
            approved["presented_ian_layered_scene_package"],
        )
        self.assertEqual(
            len(approved["approved_ian_layered_scene_package"]["members"]), 3
        )

    def test_ian_approval_rejects_a_changed_semantic_layer(self):
        item = self.state["visual_asset_review"]["queue"][0]
        evidence = self._attach_ian_layered_scene(item)
        evidence["layer"].write_bytes(evidence["layer"].read_bytes() + b"changed")
        with self.assertRaisesRegex(ValueError, "package member changed on disk"):
            self.gate.record_approval(
                self.state,
                item["asset_id"],
                "批准 Ian 完整分层场景包",
                "2026-08-24T12:00:00Z",
                repository_root=self.repository_root,
            )

    def test_ian_approval_rejects_a_manifest_plan_not_bound_to_the_storyboard_queue(self):
        item = self.state["visual_asset_review"]["queue"][0]
        evidence = self._attach_ian_layered_scene(item)
        manifest = json.loads(evidence["manifest"].read_text(encoding="utf-8"))
        manifest["scene_plan"]["layers"][0]["semantic_role"] = "已篡改"
        evidence["manifest"].write_text(
            json.dumps(manifest, ensure_ascii=False), encoding="utf-8"
        )
        item["scene_package_manifest_checksum_sha256"] = self._sha256(
            evidence["manifest"]
        )
        item["presented_ian_layered_scene_package"] = (
            self.gate._require_ian_layered_scene_package(item)
        )
        with self.assertRaisesRegex(ValueError, "package manifest is stale"):
            self.gate.record_approval(
                self.state,
                item["asset_id"],
                "批准 Ian 完整分层场景包",
                "2026-08-24T12:00:00Z",
                repository_root=self.repository_root,
            )

    def test_ian_approval_rejects_cross_member_generation_lineage(self):
        item = self.state["visual_asset_review"]["queue"][0]
        self._attach_ian_layered_scene(item)
        item["generation_lineage"][1]["output"] = dict(
            item["generation_lineage"][0]["output"]
        )
        with self.assertRaisesRegex(ValueError, "generation lineage is stale"):
            self.gate._require_ian_layered_scene_package(item)

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

    def test_third_white_cat_qa_failure_blocks_automatic_retry(self):
        item = self.state["visual_asset_review"]["queue"][0]
        item.update(
            status="changes_requested",
            white_cat_generation_attempt_control={
                "contract_version": "white-cat-imagegen-attempt-limit-v1",
                "maximum_automatic_qa_failures": 3,
                "qa_failed_generation_count": 3,
                "automatic_retry_status": "stopped_user_takeover_required",
            },
        )
        self.state["visual_asset_review"]["queue_generation_allowed"] = True
        with self.assertRaisesRegex(ValueError, "user takeover required"):
            self.gate.require_generation_allowed(self.state, "S06-master-v02")

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

    def test_white_cat_manual_approval_accepts_bound_v2_state_evidence(self):
        item = self.state["visual_asset_review"]["queue"][0]
        item.update(
            status="awaiting_user_approval",
            path="assets/image/s06-master-v02.png",
            checksum_sha256="a" * 64,
            presented_checksum_sha256="a" * 64,
            measured_dimensions=[1672, 941],
        )
        self._attach_white_cat_v2(item)
        approved = self.gate.record_approval(
            self.state, item["asset_id"], "批准白猫母图", "2026-08-22T11:00:00Z"
        )
        self.assertEqual(approved["status"], "approved")

    def test_white_cat_manual_approval_rejects_forged_source_binding_without_mutation(self):
        item = self.state["visual_asset_review"]["queue"][0]
        item.update(
            status="awaiting_user_approval",
            path="assets/image/s06-master-v02.png",
            checksum_sha256="a" * 64,
            presented_checksum_sha256="a" * 64,
            measured_dimensions=[1672, 941],
        )
        self._attach_white_cat_v2(item)
        item["identity_qa"]["anatomy_evidence"]["source_image"][
            "checksum_sha256"
        ] = "b" * 64
        with self.assertRaisesRegex(ValueError, "anatomy source binding is stale"):
            self.gate.record_approval(
                self.state, item["asset_id"], "批准白猫母图", "2026-08-22T11:00:00Z"
            )
        self.assertEqual(item["status"], "awaiting_user_approval")
        self.assertNotIn("approved_checksum_sha256", item)

    def test_white_cat_manual_approval_rejects_p2_failure_without_mutation(self):
        item = self.state["visual_asset_review"]["queue"][0]
        item.update(
            status="awaiting_user_approval",
            path="assets/image/s06-master-v02.png",
            checksum_sha256="a" * 64,
            presented_checksum_sha256="a" * 64,
            measured_dimensions=[1672, 941],
        )
        self._attach_white_cat_v2(item)
        item["identity_qa"]["bag_strap_count"] = 1
        with self.assertRaisesRegex(ValueError, "P2 accessory QA is invalid"):
            self.gate.record_approval(
                self.state, item["asset_id"], "批准白猫母图", "2026-08-22T11:00:00Z"
            )
        self.assertEqual(item["status"], "awaiting_user_approval")
        self.assertNotIn("approved_checksum_sha256", item)

    def test_white_cat_manual_approval_rejects_tampered_numbered_map_without_mutation(self):
        item = self.state["visual_asset_review"]["queue"][0]
        source = self._write_png("assets/image/s06-master-v02.png")
        item.update(
            status="awaiting_user_approval",
            path="assets/image/s06-master-v02.png",
            checksum_sha256=self._sha256(source),
            presented_checksum_sha256=self._sha256(source),
            measured_dimensions=[1672, 941],
        )
        self._attach_white_cat_v2(item)
        numbered_map = self.repository_root / item["identity_qa"]["anatomy_evidence"][
            "inspection_evidence"
        ]["numbered_limb_map_path"]
        numbered_map.write_bytes(b"tampered-after-qa")
        with self.assertRaisesRegex(ValueError, "numbered limb map changed on disk"):
            self.gate.record_approval(
                self.state,
                item["asset_id"],
                "批准白猫母图",
                "2026-08-22T11:00:00Z",
                repository_root=self.repository_root,
            )
        self.assertEqual(item["status"], "awaiting_user_approval")
        self.assertNotIn("approved_checksum_sha256", item)

    def test_white_cat_lock_rejects_numbered_map_tampered_after_approval(self):
        item = self.state["visual_asset_review"]["queue"][0]
        self.state["visual_asset_review"]["queue"] = [item]
        source = self._write_png("assets/image/s06-master-v02.png")
        item.update(
            status="awaiting_user_approval",
            path="assets/image/s06-master-v02.png",
            checksum_sha256=self._sha256(source),
            presented_checksum_sha256=self._sha256(source),
            measured_dimensions=[1672, 941],
        )
        self._attach_white_cat_v2(item)
        self.gate.record_approval(
            self.state,
            item["asset_id"],
            "批准白猫母图",
            "2026-08-22T11:00:00Z",
            repository_root=self.repository_root,
        )
        numbered_map = self.repository_root / item["identity_qa"]["anatomy_evidence"][
            "inspection_evidence"
        ]["numbered_limb_map_path"]
        numbered_map.write_bytes(b"tampered-after-approval")
        with self.assertRaisesRegex(ValueError, "numbered limb map changed on disk"):
            self.gate.validate_visual_assets_locked(self.state, self.repository_root)

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

    def test_white_cat_batch_qa_accepts_xuan_wrapper_with_anatomy_v2(self):
        self.state["visual_asset_review"]["mode"] = "batch_final_review"
        item = self.state["visual_asset_review"]["queue"][0]
        item.update(
            status="awaiting_batch_qa",
            path="assets/image/s06-xuan-master-v02.png",
            checksum_sha256="a" * 64,
            measured_dimensions=[1672, 941],
        )
        self._attach_white_cat_v2(item, route="xuan-paper-diorama")
        passed = self.gate.record_batch_qa_pass(
            self.state, item["asset_id"], "2026-08-22T11:01:00Z"
        )
        self.assertEqual(passed["status"], "qa_passed_pending_batch_review")

    def test_white_cat_batch_approval_rechecks_unique_paw_evidence(self):
        self.state["visual_asset_review"]["mode"] = "batch_final_review"
        item = self.state["visual_asset_review"]["queue"][0]
        self.state["visual_asset_review"]["queue"] = [item]
        item.update(
            status="awaiting_batch_qa",
            path="assets/image/s06-master-v02.png",
            checksum_sha256="a" * 64,
            measured_dimensions=[1672, 941],
        )
        self._attach_white_cat_v2(item)
        self.gate.record_batch_qa_pass(
            self.state, item["asset_id"], "2026-08-22T11:01:00Z"
        )
        item["identity_qa"]["anatomy_evidence"]["limb_traces"][1][
            "paw_region_id"
        ] = "P1"
        with self.assertRaisesRegex(ValueError, "paw region IDs are invalid"):
            self.gate.record_batch_approval(
                self.state, "全部批准", "2026-08-22T11:02:00Z"
            )
        self.assertEqual(item["status"], "qa_passed_pending_batch_review")

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

    def test_white_cat_hybrid_approval_rechecks_anatomy_after_qa(self):
        state = self._hybrid_state(1)
        item = state["visual_asset_review"]["queue"][0]
        item["role"] = "action-01"
        relative_path = "assets/image/S01-white-cat-action-v01.png"
        target = self._write_png(relative_path)
        item.update(
            status="awaiting_batch_qa",
            path=relative_path,
            checksum_sha256=self._sha256(target),
            measured_dimensions=[1672, 941],
            narration_source_text="白猫动作",
            technical_qa={"result": "pass"},
        )
        self._attach_white_cat_v2(item)
        self.gate.record_hybrid_qa_pass(
            state, item["asset_id"], "2026-08-22T11:03:00Z"
        )
        item["identity_qa"]["result"] = "fail"
        with self.assertRaisesRegex(ValueError, "identity QA did not pass"):
            self.gate.record_hybrid_batch_approval(
                state, None, "批准整批", "2026-08-22T11:04:00Z",
                repository_root=self.repository_root,
            )
        self.assertEqual(item["status"], "qa_passed_pending_batch_review")

    def test_white_cat_hybrid_approval_rejects_deleted_numbered_map(self):
        state = self._hybrid_state(1)
        item = state["visual_asset_review"]["queue"][0]
        item["role"] = "action-01"
        relative_path = "assets/image/S01-white-cat-action-v01.png"
        target = self._write_png(relative_path)
        item.update(
            status="awaiting_batch_qa",
            path=relative_path,
            checksum_sha256=self._sha256(target),
            measured_dimensions=[1672, 941],
            narration_source_text="白猫动作",
            technical_qa={"result": "pass"},
        )
        self._attach_white_cat_v2(item)
        self.gate.record_hybrid_qa_pass(
            state, item["asset_id"], "2026-08-22T11:03:00Z"
        )
        map_path = self.repository_root / item["identity_qa"]["anatomy_evidence"][
            "inspection_evidence"
        ]["numbered_limb_map_path"]
        map_path.unlink()
        with self.assertRaisesRegex(ValueError, "numbered limb map"):
            self.gate.record_hybrid_batch_approval(
                state,
                None,
                "批准整批",
                "2026-08-22T11:04:00Z",
                repository_root=self.repository_root,
            )
        self.assertEqual(item["status"], "qa_passed_pending_batch_review")

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

    def test_hybrid_current_strict_revision_can_be_approved_past_earlier_batch_items(self):
        state = self._hybrid_state(2)
        review = state["visual_asset_review"]
        earlier, strict = review["queue"]
        earlier["status"] = "awaiting_batch_qa"
        relative_path = "assets/image/S02-strict-revision-v01.png"
        asset_path = self._write_png(relative_path, marker=b"strict-revision")
        checksum = self._sha256(asset_path)
        strict.update(
            strict_review=True,
            is_revision=True,
            status="awaiting_user_approval",
            path=relative_path,
            checksum_sha256=checksum,
            presented_checksum_sha256=checksum,
            measured_dimensions=[1672, 941],
            technical_qa={"result": "pass"},
        )
        review.update(
            queue_generation_allowed=False,
            current_asset_id=strict["asset_id"],
        )
        approved = self.gate.record_approval(
            state, strict["asset_id"], "批准该分镜", "2026-08-15T00:01:00Z",
            repository_root=self.repository_root,
        )
        self.assertEqual(approved["status"], "approved")
        self.assertEqual(earlier["status"], "awaiting_batch_qa")

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

    def test_visual_asset_lock_keeps_approved_legacy_white_cat_v1_readable(self):
        state = self._hybrid_state(1)
        item = state["visual_asset_review"]["queue"][0]
        relative_path = "assets/image/S01-legacy-white-cat-master-v01.png"
        target = self._write_png(relative_path)
        checksum = self._sha256(target)
        item.update(
            role="base/master",
            white_cat_present=True,
            visual_generation_route="imagegen",
            qa_contract_version="ordinary-imagegen-white-cat-master-qa-v1",
            status="approved",
            path=relative_path,
            checksum_sha256=checksum,
            presented_checksum_sha256=checksum,
            approved_checksum_sha256=checksum,
            measured_dimensions=[1672, 941],
            approval_disk_checksum_sha256=checksum,
            approval_disk_measured_dimensions=[1672, 941],
        )
        self.assertEqual(
            self.gate.validate_visual_assets_locked(state, self.repository_root)["result"],
            "pass",
        )

    def _local_video_state(self):
        state = self._hybrid_state(1)
        generated = state["visual_asset_review"]["queue"][0]
        generated_path = self._write_png("assets/image/S01-graphic-v01.png")
        generated_checksum = self._sha256(generated_path)
        generated.update(
            status="approved",
            path="assets/image/S01-graphic-v01.png",
            checksum_sha256=generated_checksum,
            presented_checksum_sha256=generated_checksum,
            approved_checksum_sha256=generated_checksum,
            measured_dimensions=[1672, 941],
            approval_disk_checksum_sha256=generated_checksum,
            approval_disk_measured_dimensions=[1672, 941],
        )
        relative_path = "assets/video/user-source/s02-local-source-v01.mp4"
        source = self.repository_root / relative_path
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_bytes(b"exact-local-video-bytes")
        checksum = self._sha256(source)
        media = {
            "video_streams": 1,
            "audio_streams": 1,
            "width": 1920,
            "height": 1080,
            "codec": "h264",
            "rotation_degrees": 0,
            "source_duration_seconds": 8.0,
            "source_fps": 30.0,
            "probe_result": "pass",
            "full_decode_result": "pass",
        }
        state["visual_asset_review"]["queue"].append({
            "asset_id": "S02-local-video-v01",
            "shot_id": "S02",
            "visual_generation_route": "local-video-file",
            "role": "local-video-source",
            "strict_review": True,
            "depends_on": [],
            "status": "awaiting_user_approval",
            "path": relative_path,
            "checksum_sha256": checksum,
            "presented_checksum_sha256": checksum,
            "media": media,
            "local_video_match": {
                "contract_version": "local-video-match-v1",
                "target_duration_frames": 120,
                "playback_rate": 2.0,
                "match_status": "matched",
            },
            "technical_qa": {"result": "pass"},
        })
        self.gate._probe_video_evidence = lambda _: {
            key: value for key, value in media.items() if key != "full_decode_result"
        }
        return state

    def test_local_video_items_must_be_deferred_until_after_generated_visuals(self):
        state = self._local_video_state()
        state["visual_asset_review"]["queue"].reverse()
        with self.assertRaisesRegex(ValueError, "ordered after every generated visual"):
            self.gate.validate_visual_assets_locked(state, self.repository_root)

    def test_local_video_uses_strict_exact_byte_matched_approval_and_lock(self):
        state = self._local_video_state()
        item = self.gate.record_approval(
            state,
            "S02-local-video-v01",
            "批准本地视频匹配预览",
            "2026-08-18T10:00:00+08:00",
            repository_root=self.repository_root,
        )
        self.assertEqual(item["status"], "approved")
        self.assertEqual(item["approval_disk_media"]["width"], 1920)
        self.assertEqual(
            self.gate.validate_visual_assets_locked(state, self.repository_root)["result"],
            "pass",
        )

    def test_local_video_cannot_enter_the_image_generation_call(self):
        state = self._local_video_state()
        local = state["visual_asset_review"]["queue"][1]
        local["status"] = "pending_generation"
        with self.assertRaisesRegex(ValueError, "must be imported"):
            self.gate.require_generation_allowed(state, local["asset_id"])

    def _one_click_state(self):
        state = {
            "visual_asset_review": {
                "contract_version": "visual-asset-review-v3",
                "mode": "one_click_final_review_v1",
                "storyboard_sha256": "a" * 64,
                "policy_sha256": "b" * 64,
                "generation_aspect_ratio": [16, 9],
                "generation_aspect_ratio_max_relative_error": 0.005,
                "queue_generation_allowed": True,
                "queue": [],
            }
        }
        for index in range(2):
            relative = f"assets/image/one-click-{index}.png"
            target = self._write_png(relative, marker=f"v{index}".encode())
            state["visual_asset_review"]["queue"].append({
                "asset_id": f"S01-state-{index}",
                "path": relative,
                "checksum_sha256": self._sha256(target),
                "measured_dimensions": [1672, 941],
                "depends_on": [] if index == 0 else ["S01-state-0"],
                "status": "awaiting_batch_qa" if index == 0 else "pending_generation",
                "technical_qa": {"result": "pass"},
            })
        return state

    def test_one_click_qa_continues_but_final_review_precedes_caption_and_lock(self):
        state = self._one_click_state()
        self.gate.record_hybrid_qa_pass(state, "S01-state-0", "2026-08-22T10:00:00+08:00")
        self.gate.require_generation_allowed(state, "S01-state-1")["status"] = "awaiting_batch_qa"
        self.gate.record_hybrid_qa_pass(state, "S01-state-1", "2026-08-22T10:01:00+08:00")
        self.assertEqual(state["current_phase"], "awaiting_precomposition_visual_review")
        with self.assertRaisesRegex(ValueError, "exact hash-list approval"):
            self.gate.validate_visual_assets_locked(state, self.repository_root)
        final_review = self.gate.present_one_click_final_visual_review(state)
        approved = self.gate.approve_one_click_final_visual_review(
            state,
            final_review["presented_map_sha256"],
            "批准完整精确哈希清单",
            "2026-08-22T10:02:00+08:00",
            repository_root=self.repository_root,
        )
        self.assertEqual(approved["status"], "approved")
        self.assertEqual(state["current_phase"], "awaiting_caption_delivery_choice")
        self.assertEqual(
            self.gate.validate_visual_assets_locked(state, self.repository_root)["result"],
            "pass",
        )

    def test_white_cat_one_click_qa_rejects_missing_v2_evidence_before_status_change(self):
        state = self._one_click_state()
        item = state["visual_asset_review"]["queue"][0]
        item.update(
            role="base/master",
            white_cat_present=True,
            visual_generation_route="imagegen",
        )
        with self.assertRaisesRegex(ValueError, "QA contract version is invalid"):
            self.gate.record_hybrid_qa_pass(
                state, item["asset_id"], "2026-08-22T11:05:00Z"
            )
        self.assertEqual(item["status"], "awaiting_batch_qa")
        self.assertNotIn("batch_qa_checksum_sha256", item)

    def test_white_cat_one_click_final_payload_rechecks_numbered_map_binding(self):
        state = self._one_click_state()
        first, second = state["visual_asset_review"]["queue"]
        first["role"] = "base/master"
        self._attach_white_cat_v2(first)
        self.gate.record_hybrid_qa_pass(
            state, first["asset_id"], "2026-08-22T11:06:00Z"
        )
        self.gate.require_generation_allowed(state, second["asset_id"])[
            "status"
        ] = "awaiting_batch_qa"
        self.gate.record_hybrid_qa_pass(
            state, second["asset_id"], "2026-08-22T11:07:00Z"
        )
        first["identity_qa"]["anatomy_evidence"]["inspection_evidence"][
            "numbered_limb_map_source_checksum_sha256"
        ] = "0" * 64
        with self.assertRaisesRegex(ValueError, "numbered limb-map evidence is stale"):
            self.gate.present_one_click_final_visual_review(state)
        self.assertNotIn("final_review", state["visual_asset_review"])

    def test_white_cat_one_click_review_binds_map_and_rejects_post_presentation_tamper(self):
        state = self._one_click_state()
        first, second = state["visual_asset_review"]["queue"]
        first["role"] = "base/master"
        self._attach_white_cat_v2(first)
        self.gate.record_hybrid_qa_pass(
            state, first["asset_id"], "2026-08-22T11:06:00Z"
        )
        self.gate.require_generation_allowed(state, second["asset_id"])[
            "status"
        ] = "awaiting_batch_qa"
        self.gate.record_hybrid_qa_pass(
            state, second["asset_id"], "2026-08-22T11:07:00Z"
        )
        final_review = self.gate.present_one_click_final_visual_review(state)
        anatomy_review = final_review["assets"][0]["white_cat_anatomy_review"]
        inspection = first["identity_qa"]["anatomy_evidence"]["inspection_evidence"]
        self.assertEqual(
            anatomy_review,
            {
                "numbered_limb_map_path": inspection["numbered_limb_map_path"],
                "numbered_limb_map_checksum_sha256": inspection[
                    "numbered_limb_map_checksum_sha256"
                ],
                "numbered_limb_map_source_checksum_sha256": first[
                    "checksum_sha256"
                ],
                "numbered_limb_map_limb_ids": ["F1", "F2", "H1", "H2"],
            },
        )
        numbered_map = self.repository_root / inspection["numbered_limb_map_path"]
        numbered_map.write_bytes(b"tampered-after-final-review-presentation")
        with self.assertRaisesRegex(ValueError, "numbered limb map changed on disk"):
            self.gate.approve_one_click_final_visual_review(
                state,
                final_review["presented_map_sha256"],
                "批准完整精确哈希清单",
                "2026-08-22T11:08:00Z",
                repository_root=self.repository_root,
            )
        self.assertTrue(all(
            item["status"] == "qa_passed_pending_final_review"
            for item in state["visual_asset_review"]["queue"]
        ))

    def test_one_click_stale_final_hash_fails_without_approving_assets(self):
        state = self._one_click_state()
        for item in state["visual_asset_review"]["queue"]:
            item["status"] = "qa_passed_pending_final_review"
        self.gate.present_one_click_final_visual_review(state)
        with self.assertRaisesRegex(ValueError, "stale"):
            self.gate.approve_one_click_final_visual_review(
                state,
                "f" * 64,
                "批准完整精确哈希清单",
                "2026-08-22T10:02:00+08:00",
                repository_root=self.repository_root,
            )
        self.assertTrue(all(
            item["status"] == "qa_passed_pending_final_review"
            for item in state["visual_asset_review"]["queue"]
        ))

    def test_one_click_pending_final_review_can_requeue_one_named_asset(self):
        state = self._one_click_state()
        for item in state["visual_asset_review"]["queue"]:
            item.update(
                status="qa_passed_pending_final_review",
                qa_evidence_path=f"schema/{item['asset_id']}-qa.json",
                qa_evidence_checksum_sha256="c" * 64,
                batch_qa_checksum_sha256=item["checksum_sha256"],
            )
        final_review = self.gate.present_one_click_final_visual_review(state)
        untouched = dict(state["visual_asset_review"]["queue"][0])

        changed = self.gate.record_one_click_changes_requested(
            state,
            "S01-state-1",
            "文字越出方框，请调整后重呈完整清单",
            "2026-08-24T10:00:00+08:00",
        )

        review = state["visual_asset_review"]
        self.assertNotIn("final_review", review)
        self.assertEqual(state["phase"], "visual_production")
        self.assertEqual(state["current_phase"], "visual_production")
        self.assertEqual(review["current_asset_id"], "S01-state-1")
        self.assertTrue(review["queue_generation_allowed"])
        self.assertEqual(review["queue"][0], untouched)
        self.assertEqual(changed["status"], "changes_requested")
        self.assertTrue(changed["is_revision"])
        self.assertFalse(changed["strict_review"])
        for stale_key in (
            "path", "checksum_sha256", "qa_evidence_path",
            "qa_evidence_checksum_sha256", "batch_qa_checksum_sha256",
        ):
            self.assertNotIn(stale_key, changed)
        archive = state["superseded_artifacts"][-1]
        self.assertEqual(
            archive["record_type"],
            "superseded_one_click_final_visual_review",
        )
        self.assertEqual(
            archive["prior_presented_map_sha256"],
            final_review["presented_map_sha256"],
        )
        self.assertEqual(archive["affected_asset_ids"], ["S01-state-1"])
        self.assertEqual(archive["preserved_unaffected_asset_count"], 1)
        self.assertEqual(
            archive["prior_final_review"]["presented_map_sha256"],
            final_review["presented_map_sha256"],
        )

    def test_one_click_change_rejects_a_stale_pending_digest(self):
        state = self._one_click_state()
        for item in state["visual_asset_review"]["queue"]:
            item["status"] = "qa_passed_pending_final_review"
        self.gate.present_one_click_final_visual_review(state)
        state["visual_asset_review"]["final_review"]["presented_map_sha256"] = "f" * 64

        with self.assertRaisesRegex(ValueError, "stale"):
            self.gate.record_one_click_changes_requested(
                state,
                "S01-state-1",
                "文字越出方框",
                "2026-08-24T10:00:00+08:00",
            )


if __name__ == "__main__":
    unittest.main()
