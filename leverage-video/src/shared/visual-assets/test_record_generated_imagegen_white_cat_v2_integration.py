#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
from types import SimpleNamespace
import unittest
import zlib


SCRIPT_DIR = Path(__file__).resolve().parent
STRICT_PATH = SCRIPT_DIR / "record-generated-imagegen-strict.py"
HYBRID_PATH = SCRIPT_DIR / "record-generated-imagegen-hybrid-qa.py"
WORKSPACE_VALIDATOR_PATH = (
    SCRIPT_DIR.parents[3]
    / ".agents/skills/run-knowledge-video/scripts/validate_episode_workspace.py"
)
VISUAL_GATE_PATH = (
    SCRIPT_DIR.parents[3]
    / ".agents/skills/run-knowledge-video/scripts/validate_visual_approval_state.py"
)


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path.name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_png(
    path: Path,
    *,
    width: int = 16,
    height: int = 9,
    rgb: tuple[int, int, int] = (255, 255, 255),
    alpha: int | tuple[int, int] | None = None,
) -> None:
    def chunk(kind: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + kind
            + payload
            + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
        )

    color_type = 2 if alpha is None else 6
    if isinstance(alpha, tuple):
        pixels = b"".join(
            bytes((*rgb, alpha[index % 2]))
            for index in range(width)
        )
    else:
        pixel = bytes(rgb) if alpha is None else bytes((*rgb, alpha))
        pixels = pixel * width
    rows = b"".join(b"\x00" + pixels for _ in range(height))
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, color_type, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(rows))
        + chunk(b"IEND", b"")
    )


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class FakeVisualGate:
    GENERATION_UNLOCKING_STATUSES = {
        "approved",
        "qa_passed_pending_batch_review",
        "qa_passed_pending_final_review",
        "qa_failed_but_waived_once_pending_final_review",
        "superseded",
    }

    @staticmethod
    def _queue(state: dict) -> list[dict]:
        return state["visual_asset_review"]["queue"]

    @classmethod
    def _next_unapproved(cls, queue: list[dict]) -> dict | None:
        return next(
            (
                item
                for item in queue
                if item.get("active_for_current_storyboard") is not False
                and item.get("status") not in {
                    "approved",
                    "qa_passed_pending_batch_review",
                    "qa_passed_pending_final_review",
                    "superseded",
                }
            ),
            None,
        )

    @classmethod
    def require_generation_allowed(cls, state: dict, asset_id: str) -> dict:
        review = state["visual_asset_review"]
        item = next(candidate for candidate in cls._queue(state) if candidate["asset_id"] == asset_id)
        if review.get("queue_generation_allowed") is not True:
            raise ValueError("visual review queue is paused")
        if review.get("current_asset_id") != asset_id:
            raise ValueError("asset is not the current generation target")
        return item

    @classmethod
    def record_hybrid_qa_pass(cls, state: dict, asset_id: str, qa_time: str) -> None:
        item = next(candidate for candidate in cls._queue(state) if candidate["asset_id"] == asset_id)
        item["status"] = (
            "qa_passed_pending_final_review"
            if state["visual_asset_review"].get("mode") == "one_click_final_review_v1"
            else "awaiting_batch_qa"
        )
        item["qa_passed_at"] = qa_time


class WhiteCatRecorderV2IntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.strict = load_module(STRICT_PATH, "white_cat_v2_strict_integration")
        cls.hybrid = load_module(HYBRID_PATH, "white_cat_v2_hybrid_integration")
        cls.workspace_validator = load_module(
            WORKSPACE_VALIDATOR_PATH,
            "white_cat_v2_workspace_validator_integration",
        )
        cls.visual_gate = load_module(
            VISUAL_GATE_PATH,
            "white_cat_v2_visual_gate_integration",
        )

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(dir=SCRIPT_DIR)
        self.root = Path(self.temporary.name)
        self.workspace = self.root / "episode"
        (self.workspace / "schema").mkdir(parents=True)
        self.files = self.root / "fixture"
        self.files.mkdir()

        self.strict.REPOSITORY_ROOT = self.root
        self.strict.CANONICAL_ROOT = self.root.resolve()
        self.strict.load_gate = lambda: FakeVisualGate
        self.hybrid.REPOSITORY_ROOT = self.root
        self.hybrid.load_helpers = lambda: self.strict

        self.prompt = self.files / "prompt.txt"
        self.prompt.write_text(
            """16:9 landscape composition. VISIBLE-TEXT MODE: none.
WHITE-CAT SATCHEL STRAP LOCK:
WHITE-CAT ANATOMICAL-SIDE CONTINUITY LOCK:
Keep the satchel on the anatomical right flank; do not mirror the character.
Front route crosses the upper chest into the forward bag-end D-ring.
Rear route passes behind the neck and shoulder into the rear bag-end D-ring.
Robe trim is clothing and never a strap.
CAT FACING MAP: torso three-quarter screen-left; anatomical front and chest map screen-left; anatomical rear and rump map screen-right.
""",
            encoding="utf-8",
        )
        self.master_source = self.files / "master.png"
        self.action_source = self.files / "action.png"
        self.hero_pose_source = self.files / "hero-pose.png"
        self.numbered_map = self.files / "numbered-map.png"
        write_png(self.master_source)
        write_png(self.action_source, rgb=(240, 240, 240))
        write_png(self.hero_pose_source, rgb=(240, 240, 240), alpha=(0, 255))
        write_png(self.numbered_map, rgb=(255, 0, 0))

        self.authority = self._text_file("style-authority.md", "style authority")
        self.catalog = self._text_file("visual-catalog.md", "visual catalog")
        self.primary = self._text_file("white-cat-primary.dat", "primary identity")
        self.bible = self._text_file("white-cat-bible.md", "character bible")
        self.constraints = self._text_file("white-cat-constraints.md", "generation constraints")
        self.accuracy = self._text_file("white-cat-accuracy.md", "satchel accuracy")
        self.geometry = self._text_file("white-cat-geometry.dat", "supporting geometry")

    def test_strict_next_generation_target_skips_prior_waived_items(self) -> None:
        queue = [
            {"asset_id": "waived", "status": "qa_failed_but_waived_once_pending_final_review"},
            {"asset_id": "next", "status": "pending_generation"},
        ]

        target = self.strict.next_generation_target(
            queue,
            FakeVisualGate.GENERATION_UNLOCKING_STATUSES,
        )

        self.assertEqual(target["asset_id"], "next")

    def test_failed_master_action_family_edit_source_override_is_exact(self) -> None:
        qa_file = self.files / "failed-master-qa.json"
        qa = {
            "result": "fail",
            "identity_qa": {
                "result": "fail",
                "anatomy_evidence": {
                    "contract_version": "white-cat-anatomy-qa-v2",
                    "result": "fail",
                    "error_code": "P0_AMBIGUOUS_TRACE",
                    "inspection_evidence": {
                        "numbered_limb_map_path": self._relative(self.numbered_map),
                        "numbered_limb_map_checksum_sha256": sha256(self.numbered_map),
                    },
                },
            },
            "continuity_qa": {
                "result": "pass",
                "failed_master_must_not_be_used_as_an_edit_target": True,
            },
        }
        qa_file.write_text(
            json.dumps(qa, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        master = {
            "asset_id": "S06-master-v01",
            "shot_id": "S06",
            "role": "base/master",
            "status": "qa_failed_but_waived_once_pending_final_review",
            "path": self._relative(self.master_source),
            "checksum_sha256": sha256(self.master_source),
            "qa_evidence_path": self._relative(qa_file),
            "qa_evidence_checksum_sha256": sha256(qa_file),
            "waived_mechanical_gate_ids": [
                "visual_asset.S06-master-v01.P0_AMBIGUOUS_TRACE"
            ],
        }
        actions = [
            {
                "asset_id": f"S06-action-{index:02d}-v01",
                "shot_id": "S06",
                "role": f"action-{index:02d}",
                "depends_on": ["S06-master-v01"],
                "status": "pending_generation",
                "active_for_current_storyboard": True,
                "state_index": index,
                "state_count_total": 4,
            }
            for index in range(1, 4)
        ]
        gate_id = (
            "visual_asset.S06-master-v01."
            "P0_FAILED_SOURCE_MUST_NOT_BE_EDIT_TARGET"
        )
        reason = (
            "P0-failed S06-master-v01 source carries P0_AMBIGUOUS_TRACE; "
            "the default contract forbids using it as a downstream edit target."
        )
        artifacts = [
            self._binding(self.master_source),
            self._binding(qa_file),
            self._binding(self.numbered_map),
        ]
        override = {
            "contract_version": "one-time-explicit-user-mechanical-gate-override-v1",
            "episode_id": "episode-test",
            "scope_id": "S06:action-family-edit-source",
            "gate_ids": [gate_id],
            "acknowledged_failures": [{
                "gate_id": gate_id,
                "observed_result": "fail",
                "reason": reason,
            }],
            "bound_artifacts": artifacts,
            "decision": {
                "exact_user_message": (
                    "接受 S06-master-v01 第二次失败图作为 S06 动作族的唯一编辑基底，"
                    "并仅此一次放行“P0 失败图不得作为后续编辑源”门禁；保留 "
                    "P0_AMBIGUOUS_TRACE 失败状态及全部证据，不扩展至其他资产。"
                ),
                "decided_at": "2026-08-30T18:43:57+08:00",
                "disposition": "allow_once",
            },
            "consumption": {
                "from_phase": "visual_production",
                "to_phase": "visual_production",
                "status": "consumed",
                "consumed_transition_id": (
                    "episode-test:S06-master-v01:failed-master-edit-source-override:1"
                ),
                "consumed_at": "2026-08-30T18:43:58+08:00",
            },
            "reuse_forbidden": True,
        }
        override["override_sha256"] = self.strict._canonical_sha256(override)
        master["failed_master_edit_source_override"] = {
            "contract_version": (
                "failed-p0-master-action-family-edit-source-override-v1"
            ),
            "result": "pass_with_user_override",
            "master_asset_id": "S06-master-v01",
            "shot_id": "S06",
            "allowed_action_asset_ids": [row["asset_id"] for row in actions],
            "source": artifacts[0],
            "original_failure": {
                "qa_evidence": artifacts[1],
                "error_code": "P0_AMBIGUOUS_TRACE",
                "result": "fail",
                "failed_master_must_not_be_used_as_an_edit_target": True,
            },
            "user_mechanical_gate_override": override,
        }
        state = {
            "episode_id": "episode-test",
            "visual_asset_review": {"queue": [master, *actions]},
        }

        self.assertTrue(
            self.hybrid.validate_failed_master_edit_source_override(
                state,
                actions[0],
                master,
                self.strict,
            )
        )
        non_p0_master = copy.deepcopy(master)
        non_p0_master.pop("failed_master_edit_source_override")
        non_p0_master["waived_mechanical_gate_ids"] = [
            "visual_asset.S06-master-v01.P2_SATCHEL_TOPOLOGY"
        ]
        self.assertFalse(
            self.hybrid.validate_failed_master_edit_source_override(
                state,
                actions[0],
                non_p0_master,
                self.strict,
            )
        )
        tampered = copy.deepcopy(master)
        tampered["failed_master_edit_source_override"][
            "allowed_action_asset_ids"
        ] = actions[:1]
        with self.assertRaisesRegex(ValueError, "stale or incomplete"):
            self.hybrid.validate_failed_master_edit_source_override(
                state,
                actions[0],
                tampered,
                self.strict,
            )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _text_file(self, name: str, text: str) -> Path:
        path = self.files / name
        path.write_text(text, encoding="utf-8")
        return path

    def _relative(self, path: Path) -> str:
        return path.relative_to(self.root).as_posix()

    def _binding(self, path: Path, **extra) -> dict:
        return {
            **extra,
            "path": self._relative(path),
            "checksum_sha256": sha256(path),
        }

    def _write_state(self, queue: list[dict], current_asset_id: str) -> Path:
        state = {
            "episode_id": "episode-test",
            "phase": "producing_visual_assets",
            "current_phase": "producing_visual_assets",
            "visual_asset_review": {
                "mode": "per_asset_visual_review_v1",
                "queue_generation_allowed": True,
                "current_asset_id": current_asset_id,
                "queue": queue,
            },
        }
        state_file = self.workspace / "schema/episode-state.json"
        state_file.write_text(
            json.dumps(state, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return state_file

    def _enable_cover_derived_style(self, state_file: Path) -> dict:
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
        selection["selection_sha256"] = self.strict._canonical_sha256(selection)
        selection_file = self.workspace / "schema/white-cat-visual-style-selection-v2.json"
        selection_file.write_text(
            json.dumps(selection, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        summary_fields = (
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
        state = json.loads(state_file.read_text(encoding="utf-8"))
        state["white_cat_visual_style_selection"] = {
            "contract_version": selection["contract_version"],
            "status": "selected",
            "path": self._relative(selection_file),
            "file_checksum_sha256": sha256(selection_file),
            **{field: selection[field] for field in summary_fields},
        }
        for item in state["visual_asset_review"]["queue"]:
            if item.get("white_cat_present") is True or item.get("asset_kind") == "hero_pose_background":
                item.update(
                    treatment_profile_id=selection["treatment_profile_id"],
                    white_cat_visual_style_id=selection["style_id"],
                    white_cat_visual_style_selection_sha256=selection["selection_sha256"],
                    visual_cohesion_profile_id=selection["visual_cohesion_profile_id"],
                )
        state_file.write_text(
            json.dumps(state, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        self.prompt.write_text(
            self.prompt.read_text(encoding="utf-8")
            + f"WHITE-CAT VISUAL STYLE: {selection['style_id']}.\n"
            + f"EPISODE VISUAL COHESION: {selection['visual_cohesion_profile_id']}.\n"
            + f"EPISODE STYLE PROFILE SHA256: {selection['style_profile_checksum_sha256']}.\n",
            encoding="utf-8",
        )
        return selection

    @staticmethod
    def _bind_cover_style_qa(qa: dict, selection: dict) -> None:
        qa["style_profile"].update(
            id=selection["treatment_profile_id"],
            medium_id=selection["style_id"],
        )
        qa["white_cat_visual_style_binding"] = {
            "style_id": selection["style_id"],
            "selection_sha256": selection["selection_sha256"],
            "visual_cohesion_profile_id": selection["visual_cohesion_profile_id"],
            "style_profile_checksum_sha256": selection["style_profile_checksum_sha256"],
        }

    def _strict_item(self, *, white_cat: bool = True) -> dict:
        return {
            "asset_id": "S01-master-v01",
            "shot_id": "S01",
            "role": "base/master",
            "status": "pending_generation",
            "active_for_current_storyboard": True,
            "visual_generation_route": "imagegen",
            "strict_review": True,
            "has_downstream_action_variants": True,
            "visible_text_mode": "none",
            "treatment_profile_id": "loose-line-vivid-watercolor-v1",
            "white_cat_present": white_cat,
        }

    def _action_state(self, *, strict_revision: bool = False) -> tuple[Path, dict]:
        master_binding = self._binding(self.master_source)
        master = {
            "asset_id": "S02-master-v01",
            "shot_id": "S02",
            "role": "base/master",
            "status": "approved",
            "active_for_current_storyboard": True,
            "visual_generation_route": "imagegen",
            "path": master_binding["path"],
            "checksum_sha256": master_binding["checksum_sha256"],
            "approved_checksum_sha256": master_binding["checksum_sha256"],
        }
        action = {
            "asset_id": "S02-action-01-v01",
            "shot_id": "S02",
            "role": "action-01",
            "status": "changes_requested" if strict_revision else "pending_generation",
            "active_for_current_storyboard": True,
            "visual_generation_route": "imagegen",
            "strict_review": strict_revision,
            "is_revision": strict_revision,
            "visible_text_mode": "none",
            "state_index": 1,
            "state_count_total": 2,
            "depends_on": [master["asset_id"]],
            "treatment_profile_id": "loose-line-vivid-watercolor-v1",
            "white_cat_present": True,
        }
        return self._write_state([master, action], action["asset_id"]), action

    def _hero_pose_state(self) -> tuple[Path, dict]:
        background_binding = self._binding(self.master_source)
        background = {
            "asset_id": "S01-master-v01",
            "asset_kind": "hero_pose_background",
            "shot_id": "S01",
            "role": "base/master",
            "state_index": None,
            "status": "approved",
            "active_for_current_storyboard": True,
            "visual_generation_route": "imagegen",
            "path": background_binding["path"],
            "checksum_sha256": background_binding["checksum_sha256"],
            "approved_checksum_sha256": background_binding["checksum_sha256"],
            "white_cat_present": False,
        }
        pose = {
            "asset_id": "S01-action-01-v01",
            "asset_kind": "hero_pose",
            "shot_id": "S01",
            "role": "action-01",
            "status": "pending_generation",
            "active_for_current_storyboard": True,
            "visual_generation_route": "imagegen",
            "strict_review": False,
            "visible_text_mode": "none",
            "state_index": 0,
            "state_count_total": 5,
            "depends_on": [background["asset_id"]],
            "treatment_profile_id": "loose-line-vivid-watercolor-v1",
            "white_cat_present": True,
        }
        return self._write_state([background, pose], pose["asset_id"]), pose

    def _anatomy(self, source: Path) -> dict:
        source_binding = self._binding(source)
        traces = []
        for index, trace_id in enumerate(("F1", "F2", "H1", "H2"), start=1):
            fore = trace_id.startswith("F")
            paw_bbox = [0.1 * index, 0.6, 0.05, 0.08]
            anchor = [0.45 + 0.05 * index, 0.5]
            traces.append(
                {
                    "id": trace_id,
                    "class": "forelimb" if fore else "hindlimb",
                    "paw_region_id": f"P{index}",
                    "paw_bbox_normalized": paw_bbox,
                    "paw_visible": True,
                    "continuous_to_torso": True,
                    "torso_anchor": "shoulder" if fore else "hip",
                    "torso_anchor_point_normalized": anchor,
                    "trace_polyline_normalized": [
                        [paw_bbox[0] + 0.02, 0.65],
                        [0.3 + 0.05 * index, 0.58],
                        anchor,
                    ],
                    "occlusion_status": "none",
                }
            )
        return {
            "contract_version": "white-cat-anatomy-qa-v2",
            "result": "pass",
            "source_image": source_binding,
            "canvas": {"width": 16, "height": 9},
            "limb_traces": traces,
            "forward_trace_ids": ["F1", "F2", "H1", "H2"],
            "reverse_trace_ids": ["F1", "F2", "H1", "H2"],
            "unassigned_paw_like_shapes": 0,
            "ambiguous_limb_regions": 0,
            "branched_or_fused_limb_regions": 0,
            "inspection_evidence": {
                "methods": ["full_resolution", "numbered_limb_map"],
                "numbered_limb_map_path": self._relative(self.numbered_map),
                "numbered_limb_map_checksum_sha256": sha256(self.numbered_map),
                "numbered_limb_map_source_checksum_sha256": source_binding["checksum_sha256"],
                "numbered_limb_map_limb_ids": ["F1", "F2", "H1", "H2"],
            },
        }

    def _identity(self, source: Path) -> dict:
        return {
            "result": "pass",
            "cat_count": 1,
            "foreleg_count": 2,
            "hindleg_count": 2,
            "paw_count": 4,
            "anatomy_evidence": self._anatomy(source),
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

    def _character(self, *, include_geometry: bool) -> dict:
        result = {
            "version": "white-cat-v2",
            "primary_path": self._relative(self.primary),
            "primary_checksum_sha256": sha256(self.primary),
            "bible_path": self._relative(self.bible),
            "bible_checksum_sha256": sha256(self.bible),
            "generation_constraints_path": self._relative(self.constraints),
            "generation_constraints_checksum_sha256": sha256(self.constraints),
            "satchel_accuracy_rule_path": self._relative(self.accuracy),
            "satchel_accuracy_rule_checksum_sha256": sha256(self.accuracy),
        }
        if include_geometry:
            result.update(
                supporting_geometry_path=self._relative(self.geometry),
                supporting_geometry_checksum_sha256=sha256(self.geometry),
            )
        return result

    @staticmethod
    def _passing_checks() -> dict:
        return {
            "semantic_qa": {"result": "pass"},
            "visible_text_qa": {
                "result": "pass",
                "no_visible_text": True,
                "no_pseudotext": True,
            },
            "style_qa": {"result": "pass"},
            "continuity_qa": {
                "result": "pass",
                "derived_directly_from_approved_master": True,
            },
            "visual_qa": {"result": "pass"},
        }

    def _master_qa(self, *, white_cat: bool = True, contract_version: str | None = None) -> dict:
        selected_source = {
            **self._binding(self.master_source),
            "dimensions": [16, 9],
            "relative_aspect_ratio_error": 0.0,
        }
        prompt = self._binding(self.prompt)
        references = (
            [
                self._binding(
                    self.primary,
                    role="primary_canonical_identity_reference",
                )
            ]
            if white_cat
            else []
        )
        qa = {
            "contract_version": contract_version
            or (
                "ordinary-imagegen-white-cat-master-qa-v2"
                if white_cat
                else "ordinary-imagegen-historical-master-qa-v1"
            ),
            "result": "pass",
            "asset_id": "S01-master-v01",
            "generator": "codex-native-imagegen",
            "base_prompt": prompt,
            "selected_prompt": prompt,
            "selected_source": selected_source,
            "style_profile": {
                "id": "loose-line-vivid-watercolor-v1",
                "medium_id": "loose-line-vivid-watercolor",
                "authority_path": self._relative(self.authority),
                "authority_checksum_sha256": sha256(self.authority),
                "catalog_path": self._relative(self.catalog),
                "catalog_checksum_sha256": sha256(self.catalog),
            },
            "actual_reference_inputs": references,
            "generation_lineage": [
                {
                    "prompt": prompt,
                    "output": selected_source,
                    "reference_inputs": references,
                    "selection_status": "selected",
                }
            ],
            **self._passing_checks(),
        }
        if white_cat:
            qa["character_reference"] = self._character(include_geometry=True)
            qa["identity_qa"] = self._identity(self.master_source)
        else:
            qa["historical_identity_qa"] = {"result": "pass"}
        return qa

    def _action_qa(
        self,
        action: dict,
        *,
        contract_version: str | None = None,
        source: Path | None = None,
    ) -> dict:
        selected_source_path = source or self.action_source
        selected_source = {
            **self._binding(selected_source_path),
            "dimensions": [16, 9],
            "relative_aspect_ratio_error": 0.0,
        }
        prompt = self._binding(self.prompt)
        master = next(
            item
            for item in json.loads(
                (self.workspace / "schema/episode-state.json").read_text(encoding="utf-8")
            )["visual_asset_review"]["queue"]
            if item["asset_id"] == action["depends_on"][0]
        )
        approved_master = {
            "asset_id": master["asset_id"],
            "path": master["path"],
            "checksum_sha256": master["approved_checksum_sha256"],
        }
        references = [
            {
                "role": "edit_target_approved_master",
                "path": approved_master["path"],
                "checksum_sha256": approved_master["checksum_sha256"],
            },
            self._binding(
                self.primary,
                role="primary_canonical_identity_reference",
            ),
        ]
        qa = {
            "contract_version": contract_version or "ordinary-imagegen-white-cat-action-qa-v2",
            "result": "pass",
            "asset_id": action["asset_id"],
            "generator": "codex-native-imagegen",
            "selected_prompt": prompt,
            "selected_source": selected_source,
            "approved_master": approved_master,
            "style_profile": {
                "id": "loose-line-vivid-watercolor-v1",
                "medium_id": "loose-line-vivid-watercolor",
                "authority_path": self._relative(self.authority),
                "authority_checksum_sha256": sha256(self.authority),
            },
            "character_reference": self._character(include_geometry=False),
            "actual_reference_inputs": references,
            "generation_lineage": [
                {
                    "prompt": prompt,
                    "output": selected_source,
                    "reference_inputs": references,
                    "selection_status": "selected",
                }
            ],
            "identity_qa": self._identity(selected_source_path),
            **self._passing_checks(),
        }
        if action.get("asset_kind") == "hero_pose":
            qa["transparent_pose_qa"] = {
                "result": "pass",
                "source_checksum_sha256": selected_source["checksum_sha256"],
                "full_canvas_rgba": True,
                "transparent_background": True,
                "registration_anchor_policy": "fixed-full-canvas-v1",
            }
        return qa

    def _write_qa(self, qa: dict, name: str) -> str:
        path = self.files / name
        path.write_text(json.dumps(qa, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return self._relative(path)

    @staticmethod
    def _args(asset_id: str, qa_path: str) -> argparse.Namespace:
        return argparse.Namespace(
            episode_workspace="episode",
            asset_id=asset_id,
            qa_path=qa_path,
            qa_time="2026-08-22T10:00:00+08:00",
        )

    @staticmethod
    def _override_sha256(value: dict) -> str:
        projection = {
            key: value[key]
            for key in (
                "contract_version",
                "episode_id",
                "scope_id",
                "gate_ids",
                "acknowledged_failures",
                "bound_artifacts",
                "decision",
                "consumption",
                "reuse_forbidden",
            )
        }
        encoded = json.dumps(
            projection,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()

    def _mark_action_takeover_stop(
        self,
        state_file: Path,
        action: dict,
        *,
        with_p2_failures: bool = False,
    ) -> dict:
        state = json.loads(state_file.read_text(encoding="utf-8"))
        review = state["visual_asset_review"]
        review.update(
            contract_version="visual-asset-review-v3",
            mode="one_click_final_review_v1",
            queue_generation_allowed=False,
            current_asset_id=action["asset_id"],
            user_takeover_required=True,
            user_takeover_asset_id=action["asset_id"],
            user_takeover_scope_id=f"{action['shot_id']}:{action['role']}",
            user_takeover_message="三次失败，等待用户接手当前动作图。",
        )
        state["phase"] = "awaiting_visual_asset_review"
        state["current_phase"] = "awaiting_visual_asset_review"
        item = next(
            candidate
            for candidate in review["queue"]
            if candidate["asset_id"] == action["asset_id"]
        )
        item["status"] = "pending_generation"
        item["generation_attempt_scope_id"] = f"{action['shot_id']}:{action['role']}"
        item["white_cat_generation_attempt_control"] = {
            "contract_version": "white-cat-imagegen-attempt-limit-v1",
            "maximum_automatic_qa_failures": 3,
            "qa_failed_generation_count": 3,
            "automatic_retry_status": "stopped_user_takeover_required",
            "last_failure_time": "2026-08-22T09:59:00+08:00",
            "handoff_message": "三次失败，等待用户接手当前动作图。",
        }
        if with_p2_failures:
            outputs = (self.master_source, self.numbered_map, self.action_source)
            failures = [
                {
                    "prompt": self._binding(self.prompt),
                    "output": self._binding(output),
                    "failure_reason": "P2_SATCHEL_TOPOLOGY: rear strap detached",
                    "error_code": "P2_SATCHEL_TOPOLOGY",
                    "qa_time": f"2026-08-22T09:5{index}:00+08:00",
                    "attempt_number": index,
                }
                for index, output in enumerate(outputs, start=1)
            ]
            item["white_cat_imagegen_qa_failures"] = copy.deepcopy(failures)
            item["image_generation_qa_failures"] = copy.deepcopy(failures)
            item["image_generation_attempt_control"] = {
                "contract_version": "storyboard-image-generation-attempt-limit-v1",
                "generation_attempt_scope_id": item["generation_attempt_scope_id"],
                "maximum_automatic_rejected_generations": 3,
                "rejected_generation_count": 3,
                "automatic_retry_status": "stopped_user_takeover_required",
                "last_failure_time": failures[-1]["qa_time"],
                "handoff_message": "三次失败，等待用户接手当前动作图。",
                "reset_for_prompt_reference_base_composition_model_route_path_version_or_revision": False,
            }
            state["blockers"] = [{
                "blocker_id": (
                    "storyboard-image-generation-attempt-limit:"
                    f"{item['generation_attempt_scope_id']}"
                ),
                "contract_version": "storyboard-image-generation-attempt-limit-v1",
                "asset_id": item["asset_id"],
                "generation_attempt_scope_id": item["generation_attempt_scope_id"],
                "status": "stopped_user_takeover_required",
                "message": "三次失败，等待用户接手当前动作图。",
            }]
        state_file.write_text(
            json.dumps(state, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return item

    def _available_p2_override(self, action: dict, qa: dict, qa_path: str) -> dict:
        scope_id = f"{action['shot_id']}:{action['role']}"
        gate_ids = [
            f"storyboard-image-generation-attempt-limit:{scope_id}",
            f"visual_asset.{action['asset_id']}.P2_SATCHEL_TOPOLOGY",
        ]
        value = {
            "contract_version": "one-time-explicit-user-mechanical-gate-override-v1",
            "episode_id": "episode-test",
            "scope_id": scope_id,
            "gate_ids": gate_ids,
            "acknowledged_failures": [
                {
                    "gate_id": gate_ids[0],
                    "observed_result": "stopped_user_takeover_required",
                    "reason": "three distinct generated outputs were rejected",
                },
                {
                    "gate_id": gate_ids[1],
                    "observed_result": "fail",
                    "reason": "P2_SATCHEL_TOPOLOGY: rear strap detached",
                },
            ],
            "bound_artifacts": [
                {
                    "path": qa["selected_source"]["path"],
                    "checksum_sha256": qa["selected_source"]["checksum_sha256"],
                },
                {
                    "path": qa["selected_prompt"]["path"],
                    "checksum_sha256": qa["selected_prompt"]["checksum_sha256"],
                },
                {
                    "path": qa_path,
                    "checksum_sha256": sha256(self.root / qa_path),
                },
                {
                    "path": qa["identity_qa"]["anatomy_evidence"]["inspection_evidence"][
                        "numbered_limb_map_path"
                    ],
                    "checksum_sha256": qa["identity_qa"]["anatomy_evidence"][
                        "inspection_evidence"
                    ]["numbered_limb_map_checksum_sha256"],
                },
            ],
            "decision": {
                "exact_user_message": (
                    "接受当前 S02-action-01-v01 的 P2 背带错误图，"
                    "并放行该资产三次失败限制，仅此一次"
                ),
                "decided_at": "2026-08-22T10:00:00+08:00",
                "disposition": "allow_once",
            },
            "consumption": {
                "from_phase": "awaiting_visual_asset_review",
                "to_phase": "visual_production",
                "status": "available",
            },
            "reuse_forbidden": True,
        }
        value["override_sha256"] = self._override_sha256(value)
        return value

    def _available_forward_reverse_and_p2_override(
        self,
        action: dict,
        qa: dict,
        qa_path: str,
        failure_reason: str,
    ) -> dict:
        value = self._available_p2_override(action, qa, qa_path)
        attempt_gate_id = value["gate_ids"][0]
        p0_gate_id = (
            f"visual_asset.{action['asset_id']}.P0_FORWARD_REVERSE_MISMATCH"
        )
        p2_gate_id = f"visual_asset.{action['asset_id']}.P2_SATCHEL_TOPOLOGY"
        value["gate_ids"] = [attempt_gate_id, p0_gate_id, p2_gate_id]
        value["acknowledged_failures"] = [
            value["acknowledged_failures"][0],
            {
                "gate_id": p0_gate_id,
                "observed_result": "fail",
                "reason": failure_reason,
            },
            {
                "gate_id": p2_gate_id,
                "observed_result": "fail",
                "reason": failure_reason,
            },
        ]
        value["decision"]["exact_user_message"] = (
            f"接受 {action['asset_id']} 第三次失败图，并仅此一次放行三次尝试限制、"
            "P0 前后朝向门禁与 P2 背带拓扑门禁；保留真实提示词及失败证据。"
        )
        value["override_sha256"] = self._override_sha256(value)
        return value

    def _assert_failure_is_atomic(
        self,
        *,
        recorder,
        state_file: Path,
        args: argparse.Namespace,
        error_pattern: str,
        temporary_suffix: str,
    ) -> None:
        before = state_file.read_bytes()
        with self.assertRaisesRegex(ValueError, error_pattern):
            recorder.record(args)
        self.assertEqual(state_file.read_bytes(), before)
        self.assertFalse(state_file.with_suffix(temporary_suffix).exists())

    @staticmethod
    def _add_third_forelimb(qa: dict) -> None:
        extra = copy.deepcopy(qa["identity_qa"]["anatomy_evidence"]["limb_traces"][0])
        extra.update(id="F3", paw_region_id="P5")
        qa["identity_qa"]["anatomy_evidence"]["limb_traces"].append(extra)

    def test_strict_master_p0_failure_leaves_state_and_tmp_untouched(self) -> None:
        item = self._strict_item()
        state_file = self._write_state([item], item["asset_id"])
        qa = self._master_qa()
        self._add_third_forelimb(qa)
        args = self._args(item["asset_id"], self._write_qa(qa, "strict-p0-fail.json"))
        self._assert_failure_is_atomic(
            recorder=self.strict,
            state_file=state_file,
            args=args,
            error_pattern="P0_FORELIMB_COUNT",
            temporary_suffix=".json.imagegen-strict.tmp",
        )

    def test_hybrid_action_p0_failure_leaves_state_and_tmp_untouched(self) -> None:
        state_file, action = self._action_state()
        qa = self._action_qa(action)
        self._add_third_forelimb(qa)
        args = self._args(action["asset_id"], self._write_qa(qa, "action-p0-fail.json"))
        self._assert_failure_is_atomic(
            recorder=self.hybrid,
            state_file=state_file,
            args=args,
            error_pattern="P0_FORELIMB_COUNT",
            temporary_suffix=".json.imagegen-hybrid-qa.tmp",
        )

    def test_hybrid_strict_revision_p0_failure_is_atomic(self) -> None:
        state_file, action = self._action_state(strict_revision=True)
        qa = self._action_qa(action)
        self._add_third_forelimb(qa)
        args = self._args(action["asset_id"], self._write_qa(qa, "revision-p0-fail.json"))
        self._assert_failure_is_atomic(
            recorder=self.hybrid,
            state_file=state_file,
            args=args,
            error_pattern="P0_FORELIMB_COUNT",
            temporary_suffix=".json.imagegen-hybrid-qa.tmp",
        )

    def test_new_white_cat_master_v1_wrapper_is_rejected_atomically(self) -> None:
        item = self._strict_item()
        state_file = self._write_state([item], item["asset_id"])
        qa = self._master_qa(contract_version="ordinary-imagegen-white-cat-master-qa-v1")
        args = self._args(item["asset_id"], self._write_qa(qa, "master-v1.json"))
        self._assert_failure_is_atomic(
            recorder=self.strict,
            state_file=state_file,
            args=args,
            error_pattern="master QA evidence is incomplete",
            temporary_suffix=".json.imagegen-strict.tmp",
        )

    def test_new_white_cat_action_v1_wrapper_is_rejected_atomically(self) -> None:
        state_file, action = self._action_state()
        qa = self._action_qa(
            action,
            contract_version="ordinary-imagegen-white-cat-action-qa-v1",
        )
        args = self._args(action["asset_id"], self._write_qa(qa, "action-v1.json"))
        self._assert_failure_is_atomic(
            recorder=self.hybrid,
            state_file=state_file,
            args=args,
            error_pattern="action QA evidence is incomplete",
            temporary_suffix=".json.imagegen-hybrid-qa.tmp",
        )

    def test_valid_strict_white_cat_v2_is_recorded(self) -> None:
        item = self._strict_item()
        state_file = self._write_state([item], item["asset_id"])
        args = self._args(
            item["asset_id"],
            self._write_qa(self._master_qa(), "strict-v2-pass.json"),
        )
        result = self.strict.record(args)
        recorded = json.loads(state_file.read_text(encoding="utf-8"))
        recorded_item = recorded["visual_asset_review"]["queue"][0]
        self.assertEqual(result["status"], "awaiting_user_approval")
        self.assertEqual(
            recorded_item["qa_contract_version"],
            "ordinary-imagegen-white-cat-master-qa-v2",
        )
        self.assertEqual(
            recorded_item["identity_qa"]["anatomy_evidence"]["contract_version"],
            "white-cat-anatomy-qa-v2",
        )
        self.assertFalse(recorded["visual_asset_review"]["queue_generation_allowed"])
        self.assertFalse(state_file.with_suffix(".json.imagegen-strict.tmp").exists())

    def test_strict_master_ambiguous_trace_override_binds_second_failure_once(self) -> None:
        item = self._strict_item()
        next_item = {
            "asset_id": "S01-action-01-v01",
            "status": "pending_generation",
            "active_for_current_storyboard": True,
        }
        state_file = self._write_state([item, next_item], item["asset_id"])
        third_source = self.files / "third.png"
        write_png(third_source, rgb=(16, 32, 64))
        reason = (
            "P0_AMBIGUOUS_TRACE: H1 paw is visible but its proximal path and hip "
            "outlet are fully occluded by the satchel."
        )
        outputs = (self.action_source, self.master_source, third_source)
        white_cat_failures = [
            {
                "prompt": self._binding(self.prompt),
                "output": self._binding(output),
                "failure_reason": reason if index == 2 else "P0_PAW_COUNT: extra paw",
                "error_code": (
                    self.strict.P0_AMBIGUOUS_TRACE
                    if index == 2 else "P0_PAW_COUNT"
                ),
                "qa_time": f"2026-08-22T09:5{index}:00+08:00",
                "attempt_number": index,
            }
            for index, output in enumerate(outputs, start=1)
        ]
        generation_failures = [
            {key: copy.deepcopy(value) for key, value in failure.items() if key != "error_code"}
            for failure in white_cat_failures
        ]
        state = json.loads(state_file.read_text(encoding="utf-8"))
        review = state["visual_asset_review"]
        review.update(
            contract_version="visual-asset-review-v3",
            mode="one_click_final_review_v1",
            queue_generation_allowed=False,
            current_asset_id=item["asset_id"],
            user_takeover_required=True,
            user_takeover_asset_id=item["asset_id"],
            user_takeover_scope_id="S01:base/master",
            user_takeover_message="三次失败，等待用户接手当前母图。",
        )
        stopped = review["queue"][0]
        stopped.update(
            generation_attempt_scope_id="S01:base/master",
            image_generation_qa_failures=generation_failures,
            white_cat_imagegen_qa_failures=white_cat_failures,
            image_generation_attempt_control={
                "contract_version": "storyboard-image-generation-attempt-limit-v1",
                "generation_attempt_scope_id": "S01:base/master",
                "maximum_automatic_rejected_generations": 3,
                "rejected_generation_count": 3,
                "automatic_retry_status": "stopped_user_takeover_required",
            },
            white_cat_generation_attempt_control={
                "contract_version": "white-cat-imagegen-attempt-limit-v1",
                "maximum_automatic_qa_failures": 3,
                "qa_failed_generation_count": 3,
                "automatic_retry_status": "stopped_user_takeover_required",
            },
        )
        state.update(
            phase="awaiting_visual_asset_review",
            current_phase="awaiting_visual_asset_review",
            blockers=[{
                "blocker_id": "storyboard-image-generation-attempt-limit:S01:base/master",
                "contract_version": "storyboard-image-generation-attempt-limit-v1",
                "asset_id": item["asset_id"],
                "generation_attempt_scope_id": "S01:base/master",
                "status": "stopped_user_takeover_required",
                "message": "三次失败，等待用户接手当前母图。",
            }],
        )
        state_file.write_text(
            json.dumps(state, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

        qa = self._master_qa()
        qa["result"] = "fail"
        qa["identity_qa"]["result"] = "fail"
        anatomy = qa["identity_qa"]["anatomy_evidence"]
        anatomy.update(
            result="fail",
            error_code=self.strict.P0_AMBIGUOUS_TRACE,
            failure_reason=reason,
            ambiguous_limb_regions=1,
        )
        h1 = next(trace for trace in anatomy["limb_traces"] if trace["id"] == "H1")
        h1.update(continuous_to_torso=False, ambiguity_reason=reason)
        qa["waivable_mechanical_failures"] = [{
            "error_code": self.strict.P0_AMBIGUOUS_TRACE,
            "observed_result": "fail",
            "reason": reason,
        }]
        qa_path = self._write_qa(qa, "strict-ambiguous-override.json")
        args = self._args(item["asset_id"], qa_path)
        args.accept_p0_ambiguous_trace_with_user_override = True
        args.override_exact_user_message = (
            "接受 S01-master-v01 第二次失败图，并仅此一次放行三次尝试限制与 "
            "P0_AMBIGUOUS_TRACE 门禁；保留三次真实失败证据，以该图继续。"
        )
        args.override_decided_at = "2026-08-22T10:00:00+08:00"
        args.override_transition_id = "episode-test:S01-master:ambiguous:1"
        args.override_consumed_at = "2026-08-22T10:00:01+08:00"

        result = self.strict.record(args)
        recorded = json.loads(state_file.read_text(encoding="utf-8"))
        recorded_item = recorded["visual_asset_review"]["queue"][0]
        self.assertEqual(result["result"], "pass_with_user_override")
        self.assertEqual(
            recorded_item["status"],
            "qa_failed_but_waived_once_pending_final_review",
        )
        self.assertEqual(recorded_item["path"], self._relative(self.master_source))
        self.assertEqual(recorded_item["identity_qa"]["result"], "fail")
        self.assertEqual(len(recorded_item["image_generation_qa_failures"]), 3)
        self.assertEqual(
            recorded_item["user_mechanical_gate_override"]["consumption"]["status"],
            "consumed",
        )
        self.assertEqual(recorded["phase"], "visual_production")
        self.assertEqual(
            recorded["visual_asset_review"]["current_asset_id"],
            next_item["asset_id"],
        )
        self.assertNotIn("user_takeover_required", recorded["visual_asset_review"])
        self.assertEqual(recorded["blockers"][0]["status"], "failed_but_waived_once")
        self.assertEqual(
            self.workspace_validator._validate_pending_white_cat_qa(
                self.root,
                recorded_item,
                recorded,
            ),
            [],
        )
        gate_evidence = self.visual_gate._require_white_cat_qa_v2_state(
            recorded_item,
            self.root,
            state=recorded,
        )
        self.assertEqual(
            gate_evidence["mechanical_gate_override"]["result"],
            "pass_with_user_override",
        )

    def test_hybrid_action_early_ambiguous_trace_acceptance_preserves_one_failure(self) -> None:
        state_file, action = self._action_state()
        reason = (
            "P0_AMBIGUOUS_TRACE: H1 paw is visible but its proximal path and hip "
            "outlet are fully occluded by the satchel."
        )
        state = json.loads(state_file.read_text(encoding="utf-8"))
        state.update(phase="visual_production", current_phase="visual_production")
        review = state["visual_asset_review"]
        review.update(mode="one_click_final_review_v1", queue_generation_allowed=True)
        item = next(
            candidate for candidate in review["queue"]
            if candidate["asset_id"] == action["asset_id"]
        )
        scope_id = f"{action['shot_id']}:{action['role']}"
        failure = {
            "prompt": self._binding(self.prompt),
            "output": self._binding(self.action_source),
            "failure_reason": reason,
            "qa_time": "2026-08-22T09:59:00+08:00",
            "attempt_number": 1,
        }
        item.update(
            generation_attempt_scope_id=scope_id,
            image_generation_qa_failures=[copy.deepcopy(failure)],
            white_cat_imagegen_qa_failures=[{
                **copy.deepcopy(failure),
                "error_code": self.strict.P0_AMBIGUOUS_TRACE,
            }],
            image_generation_attempt_control={
                "contract_version": "storyboard-image-generation-attempt-limit-v1",
                "generation_attempt_scope_id": scope_id,
                "maximum_automatic_rejected_generations": 3,
                "rejected_generation_count": 1,
                "automatic_retry_status": "retry_allowed",
            },
            white_cat_generation_attempt_control={
                "contract_version": "white-cat-imagegen-attempt-limit-v1",
                "maximum_automatic_qa_failures": 3,
                "qa_failed_generation_count": 1,
                "automatic_retry_status": "retry_allowed",
            },
        )
        state_file.write_text(
            json.dumps(state, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

        qa = self._action_qa(action)
        qa["result"] = "fail"
        identity = qa["identity_qa"]
        identity["result"] = "fail"
        anatomy = identity["anatomy_evidence"]
        anatomy.update(
            result="fail",
            error_code=self.strict.P0_AMBIGUOUS_TRACE,
            failure_reason=reason,
            ambiguous_limb_regions=1,
        )
        h1 = next(trace for trace in anatomy["limb_traces"] if trace["id"] == "H1")
        h1.update(continuous_to_torso=False, ambiguity_reason=reason)
        qa["waivable_mechanical_failures"] = [{
            "error_code": self.strict.P0_AMBIGUOUS_TRACE,
            "observed_result": "fail",
            "reason": reason,
        }]
        qa_path = self._write_qa(qa, "hybrid-early-ambiguous-override.json")
        args = self._args(action["asset_id"], qa_path)
        args.accept_p0_ambiguous_trace_with_user_override = True
        args.override_exact_user_message = (
            "接受 S02-action-01-v01 第一次失败图，并仅此一次放行 "
            "P0_AMBIGUOUS_TRACE 门禁；停止该资产后续自动重试，保留真实失败证据，"
            "以该图继续。"
        )
        args.override_decided_at = "2026-08-22T10:00:00+08:00"
        args.override_transition_id = "episode-test:S02-action-01:early-p0:1"
        args.override_consumed_at = "2026-08-22T10:00:01+08:00"

        result = self.hybrid.record(args)
        recorded = json.loads(state_file.read_text(encoding="utf-8"))
        recorded_item = next(
            candidate for candidate in recorded["visual_asset_review"]["queue"]
            if candidate["asset_id"] == action["asset_id"]
        )
        self.assertEqual(result["result"], "pass_with_user_override")
        self.assertEqual(
            recorded_item["status"],
            "qa_failed_but_waived_once_pending_final_review",
        )
        self.assertEqual(len(recorded_item["image_generation_qa_failures"]), 1)
        self.assertEqual(
            recorded_item["image_generation_attempt_control"]["automatic_retry_status"],
            "stopped_by_explicit_user_acceptance",
        )
        self.assertEqual(
            recorded_item["waived_mechanical_gate_ids"],
            [f"visual_asset.{action['asset_id']}.P0_AMBIGUOUS_TRACE"],
        )
        self.assertEqual(
            self.workspace_validator._validate_pending_white_cat_qa(
                self.root,
                recorded_item,
                recorded,
            ),
            [],
        )
        gate_evidence = self.visual_gate._require_white_cat_qa_v2_state(
            recorded_item,
            self.root,
            state=recorded,
        )
        self.assertEqual(
            gate_evidence["mechanical_gate_override"]["result"],
            "pass_with_user_override",
        )

    def _non_white_cat_style_fixture(
        self, *, action: bool, style_id: str = "gilded-mythic-storybook",
        style_source: str = "episode_cover",
    ) -> tuple[Path, dict, dict, dict]:
        self.prompt.write_text(
            "16:9 landscape composition. VISIBLE-TEXT MODE: none.\n",
            encoding="utf-8",
        )
        if action:
            state_file, item = self._action_state()
        else:
            item = self._strict_item(white_cat=False)
            state_file = self._write_state([item], item["asset_id"])
        current_v2 = style_id == "cover-derived-episode-style"
        option = (
            self.strict.DYNAMIC_WHITE_CAT_STYLE_OPTION
            if current_v2 else self.strict.WHITE_CAT_STYLE_OPTIONS[style_id]
        )
        selection = {
            "contract_version": "white-cat-visual-style-selection-v2" if current_v2
            else "white-cat-visual-style-selection-v1",
            "gate2_script_sha256": "a" * 64,
            "style_id": style_id,
            "treatment_profile_id": option["treatment_profile_id"],
            "visual_cohesion_profile_id": option["visual_cohesion_profile_id"],
            "style_profile_path": self._relative(self.authority),
            "style_profile_checksum_sha256": sha256(self.authority),
            "decision": {
                "status": "selected", "exact_message": "本测试选择指定风格，正文不用白猫",
                "decided_at": "2026-09-04T10:00:00+08:00",
            },
        }
        if current_v2:
            selection.update(
                style_source=style_source,
                source_style_id="synthetic-custom-style" if style_source == "registered_custom" else None,
                style_label="合成测试风格",
                publishing_cover_package_path=None if style_source == "registered_custom"
                else self._relative(self.catalog),
                publishing_cover_package_sha256=None if style_source == "registered_custom"
                else sha256(self.catalog),
            )
        else:
            selection.update(
                style_skill_path=self._relative(self.authority),
                style_skill_checksum_sha256=sha256(self.authority),
            )
        selection["selection_sha256"] = self.strict._canonical_sha256(selection)
        item.update(
            white_cat_present=False,
            treatment_profile_id=selection["treatment_profile_id"],
            white_cat_visual_style_id=style_id,
            white_cat_visual_style_selection_sha256=selection["selection_sha256"],
            visual_cohesion_profile_id=selection["visual_cohesion_profile_id"],
        )
        state = json.loads(state_file.read_text(encoding="utf-8"))
        state["white_cat_visual_style_selection"] = selection
        state["visual_asset_review"]["queue"][-1] = item
        if action:
            state["visual_asset_review"]["mode"] = "one_click_final_review_v1"
        state_file.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        self.prompt.write_text(
            self.prompt.read_text(encoding="utf-8")
            + f"WHITE-CAT VISUAL STYLE: {style_id}.\n"
            + f"EPISODE VISUAL COHESION: {selection['visual_cohesion_profile_id']}.\n"
            + (f"EPISODE STYLE PROFILE SHA256: {selection['style_profile_checksum_sha256']}.\n"
               if current_v2 else ""),
            encoding="utf-8",
        )
        qa = self._action_qa(item, contract_version="ordinary-imagegen-historical-action-qa-v1") \
            if action else self._master_qa(white_cat=False)
        qa.pop("character_reference", None)
        qa.pop("identity_qa", None)
        qa["historical_identity_qa"] = {"result": "pass"}
        qa["actual_reference_inputs"] = [
            reference for reference in qa["actual_reference_inputs"]
            if reference["role"] == "edit_target_approved_master"
        ]
        for stage in qa["generation_lineage"]:
            stage["reference_inputs"] = copy.deepcopy(qa["actual_reference_inputs"])
        self._bind_cover_style_qa(qa, selection)
        if not current_v2:
            qa["white_cat_visual_style_binding"].pop("style_profile_checksum_sha256")
        return state_file, item, qa, selection

    def _non_white_cat_cross_shot_reference_fixture(
        self, *, one_click: bool = False,
        reference_role: str = "same_episode_identity_reference",
    ) -> tuple[Path, dict, dict, Path]:
        state_file, source_item, source_qa, _ = self._non_white_cat_style_fixture(action=False)
        image_dir = self.workspace / "assets/image"
        image_dir.mkdir(parents=True, exist_ok=True)
        source_png = image_dir / "S01-master.png"
        write_png(source_png)
        source_qa["selected_source"].update(self._binding(source_png))
        source_qa["generation_lineage"][-1]["output"] = copy.deepcopy(source_qa["selected_source"])
        source_qa_file = self.workspace / "qa/S01-master.json"
        source_qa_file.parent.mkdir(exist_ok=True)
        source_qa_file.write_text(json.dumps(source_qa, ensure_ascii=False, indent=2) + "\n",
                                  encoding="utf-8")
        self.strict.record(self._args(source_item["asset_id"], self._relative(source_qa_file)))
        state = json.loads(state_file.read_text(encoding="utf-8"))
        state["visual_asset_review"].update(
            mode="sequential_per_image", generation_aspect_ratio=[16, 9],
            generation_aspect_ratio_max_relative_error=0.005,
        )
        if one_click:
            state["visual_asset_review"]["mode"] = "one_click_final_review_v1"
            self.visual_gate.record_hybrid_qa_pass(
                state, source_item["asset_id"], "2026-09-04T10:01:00+08:00",
            )
        else:
            self.visual_gate.record_approval(
                state, source_item["asset_id"], "批准此合成测试源图", "2026-09-04T10:01:00+08:00",
                repository_root=self.root,
            )
        source = state["visual_asset_review"]["queue"][0]
        target = copy.deepcopy(source_item)
        target.update(asset_id="S02-master-v01", shot_id="S02")
        state["visual_asset_review"]["queue"].append(target)
        state["visual_asset_review"].update(
            current_asset_id=target["asset_id"], queue_generation_allowed=True,
        )
        state.update(phase="producing_visual_assets", current_phase="producing_visual_assets")
        state_file.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        target_png = image_dir / "S02-master.png"
        write_png(target_png, rgb=(230, 220, 180))
        qa = copy.deepcopy(source_qa)
        qa["asset_id"] = target["asset_id"]
        qa["selected_source"].update(self._binding(target_png))
        reference = {
            "role": reference_role,
            "asset_id": source["asset_id"],
            "path": source["path"],
            "checksum_sha256": source["checksum_sha256"],
        }
        qa["actual_reference_inputs"] = [reference]
        qa["generation_lineage"][-1].update(
            output=copy.deepcopy(qa["selected_source"]), reference_inputs=[copy.deepcopy(reference)],
        )
        return state_file, target, qa, source_qa_file

    def test_non_white_cat_strict_accepts_approved_prior_identity_reference(self) -> None:
        state_file, item, qa, _ = self._non_white_cat_cross_shot_reference_fixture()
        result = self.strict.record(self._args(
            item["asset_id"], self._write_qa(qa, "no-cat-prior-identity.json"),
        ))
        queue = json.loads(state_file.read_text(encoding="utf-8"))["visual_asset_review"]["queue"]
        self.assertEqual(queue[0]["status"], "approved")
        self.assertEqual(result["status"], "awaiting_user_approval")
        self.assertEqual(queue[-1]["actual_reference_inputs"], qa["actual_reference_inputs"])

    def test_non_white_cat_cross_shot_reference_ignores_inactive_duplicate_history(self) -> None:
        for history_first in (False, True):
            with self.subTest(history_first=history_first):
                state_file, item, qa, _ = self._non_white_cat_cross_shot_reference_fixture()
                state = json.loads(state_file.read_text(encoding="utf-8"))
                active_queue = state["visual_asset_review"]["queue"]
                history = copy.deepcopy(active_queue)
                for old in history:
                    old.update(
                        active_for_current_storyboard=False, white_cat_present=None, status="qa_failed",
                        path=f"episode/assets/image/retired-{old['asset_id']}.png",
                        checksum_sha256="f" * 64, qa_evidence_path="episode/qa/retired-missing.json",
                        qa_evidence_checksum_sha256="f" * 64,
                    )
                state["visual_asset_review"]["queue"] = (
                    history + active_queue if history_first else active_queue + history
                )
                if history_first:
                    before = copy.deepcopy(state)
                    self.strict.validate_same_episode_reference_inputs(
                        state, active_queue[-1], qa["actual_reference_inputs"], self.workspace,
                        qa["white_cat_visual_style_binding"],
                    )
                    self.assertEqual(state, before)
                    continue
                state_file.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                result = self.strict.record(self._args(
                    item["asset_id"], self._write_qa(qa, "no-cat-inactive-history.json"),
                ))
                queue = json.loads(state_file.read_text(encoding="utf-8"))["visual_asset_review"]["queue"]
                self.assertEqual(result["status"], "awaiting_user_approval")
                self.assertEqual(queue[1]["actual_reference_inputs"], qa["actual_reference_inputs"])
                self.assertEqual(queue[2:], history)

    def test_non_white_cat_strict_accepts_one_click_prior_composition_reference(self) -> None:
        state_file, item, qa, _ = self._non_white_cat_cross_shot_reference_fixture(
            one_click=True, reference_role="same_episode_composition_reference",
        )
        result = self.strict.record(self._args(
            item["asset_id"], self._write_qa(qa, "no-cat-prior-composition.json"),
        ))
        queue = json.loads(state_file.read_text(encoding="utf-8"))["visual_asset_review"]["queue"]
        self.assertEqual(queue[0]["status"], "qa_passed_pending_final_review")
        self.assertEqual(queue[0]["batch_qa_checksum_sha256"], queue[0]["checksum_sha256"])
        self.assertNotIn("approved_checksum_sha256", queue[0])
        self.assertEqual(result["status"], "qa_passed_pending_final_review")
        self.assertEqual(queue[-1]["actual_reference_inputs"], qa["actual_reference_inputs"])

    def test_non_white_cat_strict_accepts_prior_action_reference(self) -> None:
        state_file, target, qa, source_qa_file = self._non_white_cat_cross_shot_reference_fixture()
        state = json.loads(state_file.read_text(encoding="utf-8"))
        master = state["visual_asset_review"]["queue"][0]
        action = copy.deepcopy(target)
        action.update(
            asset_id="S01-action-01-v01", shot_id="S01", role="action-01", strict_review=False,
            has_downstream_action_variants=False, state_index=1, state_count_total=2,
            depends_on=[master["asset_id"]],
        )
        state["visual_asset_review"]["queue"].insert(1, action)
        state["visual_asset_review"]["current_asset_id"] = action["asset_id"]
        state_file.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        action_png = self.workspace / "assets/image/S01-action.png"
        write_png(action_png, rgb=(220, 210, 170))
        action_qa = self._action_qa(
            action, contract_version="ordinary-imagegen-historical-action-qa-v1", source=action_png,
        )
        source_qa = json.loads(source_qa_file.read_text(encoding="utf-8"))
        action_qa["style_profile"] = source_qa["style_profile"]
        action_qa["white_cat_visual_style_binding"] = source_qa["white_cat_visual_style_binding"]
        action_qa.pop("character_reference")
        action_qa.pop("identity_qa")
        action_qa["historical_identity_qa"] = {"result": "pass"}
        action_qa["actual_reference_inputs"] = action_qa["actual_reference_inputs"][:1]
        action_qa["generation_lineage"][-1]["reference_inputs"] = copy.deepcopy(action_qa["actual_reference_inputs"])
        action_qa_file = self.workspace / "qa/S01-action.json"
        action_qa_file.write_text(json.dumps(action_qa, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        self.hybrid.record(self._args(action["asset_id"], self._relative(action_qa_file)))
        state = json.loads(state_file.read_text(encoding="utf-8"))
        state["visual_asset_review"]["mode"] = "one_click_final_review_v1"
        source = self.visual_gate.record_hybrid_qa_pass(state, action["asset_id"], "2026-09-04T10:02:00+08:00")
        state["visual_asset_review"].update(current_asset_id=target["asset_id"], queue_generation_allowed=True)
        state_file.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        qa["actual_reference_inputs"][0].update(
            asset_id=source["asset_id"], path=source["path"], checksum_sha256=source["checksum_sha256"],
        )
        qa["generation_lineage"][-1]["reference_inputs"] = copy.deepcopy(qa["actual_reference_inputs"])
        result = self.strict.record(self._args(
            target["asset_id"], self._write_qa(qa, "no-cat-prior-action.json"),
        ))
        queue = json.loads(state_file.read_text(encoding="utf-8"))["visual_asset_review"]["queue"]
        self.assertEqual(source["status"], "qa_passed_pending_final_review")
        self.assertEqual(source["batch_qa_checksum_sha256"], source["checksum_sha256"])
        self.assertEqual(result["status"], "qa_passed_pending_final_review")
        self.assertEqual(queue[-1]["actual_reference_inputs"], qa["actual_reference_inputs"])

    def test_non_white_cat_cross_shot_reference_failures_are_atomic(self) -> None:
        cases = (
            "failed_source", "waived_source", "pending_source", "inactive_source", "missing_active",
            "white_cat_source", "ian_source", "cover_source", "hero_pose_source", "hero_background_source",
            "invalid_source_role", "later_source", "duplicate_source_id", "duplicate_target_id", "unknown_source_id",
            "wrong_style", "wrong_selection_hash", "wrong_cohesion", "wrong_treatment", "wrong_medium",
            "wrong_approved_hash", "wrong_batch_hash", "one_click_status_in_manual_mode",
            "technical_qa_failed", "source_qa_failed", "source_qa_contract", "source_qa_generator",
            "source_qa_asset_id", "source_qa_selected_bytes", "source_qa_stale_hash", "source_qa_mismatch",
            "source_png_stale_hash", "source_png_undecodable", "cross_episode_image", "cross_episode_qa",
            "symlink_image", "symlink_qa", "extra_reference_key", "missing_reference_key",
            "wrong_reference_role", "rejected_lineage_reference", "target_cat_flag_missing",
        ) + tuple(f"failed_check:{check}" for check in (
            "semantic_qa", "visible_text_qa", "style_qa", "continuity_qa", "visual_qa", "historical_identity_qa",
        ))
        for case in cases:
            with self.subTest(case=case):
                one_click = case in {"wrong_batch_hash", "one_click_status_in_manual_mode"}
                state_file, item, qa, source_qa_file = self._non_white_cat_cross_shot_reference_fixture(
                    one_click=one_click,
                )
                state = json.loads(state_file.read_text(encoding="utf-8"))
                queue = state["visual_asset_review"]["queue"]
                source = queue[0]
                reference = qa["actual_reference_inputs"][0]
                source_qa = json.loads(source_qa_file.read_text(encoding="utf-8"))
                source_png = self.root / source["path"]
                if case in {"failed_source", "waived_source", "pending_source"}:
                    source["status"] = {
                        "failed_source": "qa_failed",
                        "waived_source": "qa_failed_but_waived_once_pending_final_review",
                        "pending_source": "awaiting_user_approval",
                    }[case]
                elif case == "inactive_source":
                    source["active_for_current_storyboard"] = False
                elif case == "missing_active":
                    source.pop("active_for_current_storyboard")
                elif case == "white_cat_source":
                    source["white_cat_present"] = True
                elif case == "ian_source":
                    source["visual_generation_route"] = "ian-handdrawn-ppt"
                elif case in {"cover_source", "hero_pose_source", "hero_background_source"}:
                    source["asset_kind"] = {
                        "cover_source": "publishing_cover", "hero_pose_source": "hero_pose",
                        "hero_background_source": "hero_pose_background",
                    }[case]
                elif case == "invalid_source_role":
                    source["role"] = "cover"
                elif case == "later_source":
                    queue.reverse()
                elif case == "duplicate_source_id":
                    queue.insert(0, copy.deepcopy(source))
                elif case == "duplicate_target_id":
                    queue.append(copy.deepcopy(queue[-1]))
                elif case == "unknown_source_id":
                    reference["asset_id"] = "S00-missing-v01"
                elif case in {"wrong_style", "wrong_selection_hash", "wrong_cohesion", "wrong_treatment",
                              "wrong_medium", "wrong_approved_hash", "wrong_batch_hash"}:
                    key, value = {
                        "wrong_style": ("white_cat_visual_style_id", "twilight-neon-animation"),
                        "wrong_selection_hash": ("white_cat_visual_style_selection_sha256", "f" * 64),
                        "wrong_cohesion": ("visual_cohesion_profile_id", "wrong-cohesion"),
                        "wrong_treatment": ("treatment_profile_id", "wrong-treatment"),
                        "wrong_medium": ("style_medium_id", "twilight-neon-animation"),
                        "wrong_approved_hash": ("approved_checksum_sha256", "f" * 64),
                        "wrong_batch_hash": ("batch_qa_checksum_sha256", "f" * 64),
                    }[case]
                    source[key] = value
                elif case == "one_click_status_in_manual_mode":
                    state["visual_asset_review"]["mode"] = "sequential_per_image"
                elif case == "technical_qa_failed":
                    source["technical_qa"]["result"] = "fail"
                elif case.startswith("failed_check:"):
                    check = case.split(":", 1)[1]
                    source_qa[check]["result"] = "fail"
                    source[check] = copy.deepcopy(source_qa[check])
                elif case.startswith("source_qa_"):
                    if case == "source_qa_failed":
                        source_qa["result"] = "fail"
                    elif case == "source_qa_contract":
                        source_qa["contract_version"] = "ordinary-imagegen-historical-action-qa-v1"
                    elif case == "source_qa_generator":
                        source_qa["generator"] = "other-generator"
                    elif case == "source_qa_asset_id":
                        source_qa["asset_id"] = item["asset_id"]
                    elif case == "source_qa_selected_bytes":
                        source_qa["selected_source"]["checksum_sha256"] = "f" * 64
                    elif case == "source_qa_stale_hash":
                        source_qa["synthetic_changed_after_recording"] = True
                    elif case == "source_qa_mismatch":
                        source_qa["semantic_qa"]["observation"] = "different recorded evidence"
                elif case in {"source_png_stale_hash", "source_png_undecodable"}:
                    source_png.write_bytes(source_png.read_bytes()[:33])
                    if case == "source_png_undecodable":
                        checksum = sha256(source_png)
                        source.update(checksum_sha256=checksum, approved_checksum_sha256=checksum)
                        reference["checksum_sha256"] = checksum
                        source_qa["selected_source"]["checksum_sha256"] = checksum
                elif case == "cross_episode_image":
                    source["path"] = self._relative(self.master_source)
                    reference["path"] = source["path"]
                    source_qa["selected_source"]["path"] = source["path"]
                elif case == "cross_episode_qa":
                    source["qa_evidence_path"] = self._write_qa(source_qa, "outside-source-qa.json")
                elif case in {"symlink_image", "symlink_qa"}:
                    original = source_png if case == "symlink_image" else source_qa_file
                    linked = original.with_name(f"linked-{original.name}")
                    if not linked.is_symlink():
                        linked.symlink_to(original)
                    if case == "symlink_image":
                        source["path"] = self._relative(linked)
                        reference["path"] = source["path"]
                        source_qa["selected_source"]["path"] = source["path"]
                    else:
                        source["qa_evidence_path"] = self._relative(linked)
                elif case == "extra_reference_key":
                    reference["source_access_authorized"] = True
                elif case == "missing_reference_key":
                    reference.pop("asset_id")
                elif case == "wrong_reference_role":
                    reference["role"] = "publishing_cover_reference"
                elif case == "target_cat_flag_missing":
                    queue[-1].pop("white_cat_present")
                source_qa_file.write_text(json.dumps(source_qa, ensure_ascii=False, indent=2) + "\n",
                                          encoding="utf-8")
                if case != "source_qa_stale_hash":
                    source["qa_evidence_checksum_sha256"] = sha256(source_qa_file)
                qa["generation_lineage"][-1]["reference_inputs"] = copy.deepcopy(qa["actual_reference_inputs"])
                if case == "rejected_lineage_reference":
                    rejected_stage = copy.deepcopy(qa["generation_lineage"][-1])
                    rejected_stage["selection_status"] = "rejected"
                    rejected_stage["reference_inputs"][0]["checksum_sha256"] = "f" * 64
                    qa["generation_lineage"].insert(0, rejected_stage)
                state_file.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                self._assert_failure_is_atomic(
                    recorder=self.strict, state_file=state_file,
                    args=self._args(item["asset_id"], self._write_qa(qa, "no-cat-prior-rejected.json")),
                    error_pattern="reference|style|cohesion|checksum|PNG|symlink|QA|qa|not in the subpath",
                    temporary_suffix=".json.imagegen-strict.tmp",
                )

    def test_non_white_cat_gilded_strict_master_uses_selected_style(self) -> None:
        state_file, item, qa, selection = self._non_white_cat_style_fixture(action=False)
        result = self.strict.record(self._args(item["asset_id"], self._write_qa(qa, "no-cat-master.json")))
        recorded = json.loads(state_file.read_text(encoding="utf-8"))["visual_asset_review"]["queue"][-1]
        self.assertEqual(result["status"], "awaiting_user_approval")
        self.assertEqual(recorded["style_medium_id"], selection["style_id"])
        self.assertEqual(recorded["historical_identity_qa"], {"result": "pass"})
        self.assertNotIn("identity_qa", recorded)

    def test_non_white_cat_gilded_hybrid_action_waits_for_final_review(self) -> None:
        state_file, item, qa, selection = self._non_white_cat_style_fixture(action=True)
        result = self.hybrid.record(self._args(item["asset_id"], self._write_qa(qa, "no-cat-action.json")))
        recorded = json.loads(state_file.read_text(encoding="utf-8"))["visual_asset_review"]["queue"][-1]
        self.assertEqual(result["status"], "qa_passed_pending_final_review")
        self.assertEqual(recorded["style_medium_id"], selection["style_id"])
        self.assertEqual(recorded["historical_identity_qa"], {"result": "pass"})
        self.assertNotIn("identity_qa", recorded)

    def test_non_white_cat_other_core_and_v2_styles_use_both_recorders(self) -> None:
        for action in (False, True):
            for style_id, style_source in (
                ("loose-line-vivid-watercolor", "episode_cover"),
                ("twilight-neon-animation", "episode_cover"),
                ("cover-derived-episode-style", "episode_cover"),
                ("cover-derived-episode-style", "registered_custom"),
            ):
                with self.subTest(action=action, style_id=style_id, source=style_source):
                    state_file, item, qa, selection = self._non_white_cat_style_fixture(
                        action=action, style_id=style_id, style_source=style_source,
                    )
                    recorder = self.hybrid if action else self.strict
                    result = recorder.record(self._args(
                        item["asset_id"], self._write_qa(qa, "no-cat-current-style.json"),
                    ))
                    recorded = json.loads(state_file.read_text(encoding="utf-8"))[
                        "visual_asset_review"
                    ]["queue"][-1]
                    self.assertEqual(result["status"], "qa_passed_pending_final_review"
                                     if action else "awaiting_user_approval")
                    self.assertEqual(recorded["style_medium_id"], selection["style_id"])
                    self.assertEqual(recorded["style_profile_id"], selection["treatment_profile_id"])
                    self.assertNotIn("identity_qa", recorded)

    def test_non_white_cat_current_style_failures_are_atomic(self) -> None:
        cases = (
            ("wrong_style", "wrong medium|style authority is stale"),
            ("wrong_selection_hash", "stale, mixed, or substituted"),
            ("wrong_cohesion", "stale, mixed, or substituted"),
            ("missing_row_binding", "binding"),
            ("wrong_qa_selection_hash", "exact style/cohesion binding"),
            ("wrong_qa_profile_hash", "exact style/cohesion binding"),
            ("stale_profile_selection", "stale, mixed, or substituted"),
            ("missing_style_marker", "visual style marker"),
            ("missing_cohesion_marker", "visual cohesion marker"),
            ("missing_profile_marker", "style-profile checksum marker"),
        )
        for action in (False, True):
            for case, error_pattern in cases:
                with self.subTest(action=action, case=case):
                    state_file, item, qa, _ = self._non_white_cat_style_fixture(
                        action=action, style_id="cover-derived-episode-style",
                    )
                    state = json.loads(state_file.read_text(encoding="utf-8"))
                    row = state["visual_asset_review"]["queue"][-1]
                    if case == "wrong_style":
                        qa["style_profile"]["medium_id"] = "loose-line-vivid-watercolor"
                    elif case == "wrong_selection_hash":
                        row["white_cat_visual_style_selection_sha256"] = "f" * 64
                    elif case == "wrong_cohesion":
                        row["visual_cohesion_profile_id"] = "warm-paper-watercolor-cohesion-v1"
                    elif case == "missing_row_binding":
                        for field in ("white_cat_visual_style_id", "white_cat_visual_style_selection_sha256",
                                      "visual_cohesion_profile_id"):
                            row.pop(field)
                    elif case == "wrong_qa_selection_hash":
                        qa["white_cat_visual_style_binding"]["selection_sha256"] = "f" * 64
                    elif case == "wrong_qa_profile_hash":
                        qa["white_cat_visual_style_binding"]["style_profile_checksum_sha256"] = "f" * 64
                    elif case == "stale_profile_selection":
                        state["white_cat_visual_style_selection"]["style_profile_checksum_sha256"] = "f" * 64
                    else:
                        marker = {
                            "missing_style_marker": "WHITE-CAT VISUAL STYLE:",
                            "missing_cohesion_marker": "EPISODE VISUAL COHESION:",
                            "missing_profile_marker": "EPISODE STYLE PROFILE SHA256:",
                        }[case]
                        self.prompt.write_text("".join(
                            line for line in self.prompt.read_text(encoding="utf-8").splitlines(keepends=True)
                            if not line.startswith(marker)
                        ), encoding="utf-8")
                        binding = self._binding(self.prompt)
                        qa["selected_prompt"] = binding
                        if "base_prompt" in qa:
                            qa["base_prompt"] = binding
                        for stage in qa["generation_lineage"]:
                            stage["prompt"] = binding
                    state_file.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n",
                                          encoding="utf-8")
                    self._assert_failure_is_atomic(
                        recorder=self.hybrid if action else self.strict,
                        state_file=state_file,
                        args=self._args(item["asset_id"], self._write_qa(qa, "no-cat-style-rejected.json")),
                        error_pattern=error_pattern,
                        temporary_suffix=".json.imagegen-hybrid-qa.tmp" if action else ".json.imagegen-strict.tmp",
                    )

    def test_non_white_cat_historical_action_without_style_selection_is_still_recorded(self) -> None:
        state_file, item, qa, _ = self._non_white_cat_style_fixture(action=True)
        state = json.loads(state_file.read_text(encoding="utf-8"))
        del state["white_cat_visual_style_selection"]
        row = state["visual_asset_review"]["queue"][-1]
        for field in ("white_cat_visual_style_id", "white_cat_visual_style_selection_sha256",
                      "visual_cohesion_profile_id"):
            row.pop(field)
        row["treatment_profile_id"] = "loose-line-vivid-watercolor-v1"
        state_file.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        qa["style_profile"].update(id="loose-line-vivid-watercolor-v1", medium_id="loose-line-vivid-watercolor")
        qa.pop("white_cat_visual_style_binding")
        self.prompt.write_text("16:9 landscape composition. VISIBLE-TEXT MODE: none.\n", encoding="utf-8")
        qa["selected_prompt"] = self._binding(self.prompt)
        for stage in qa["generation_lineage"]:
            stage["prompt"] = self._binding(self.prompt)
        result = self.hybrid.record(self._args(
            item["asset_id"], self._write_qa(qa, "no-cat-historical-action.json"),
        ))
        recorded = json.loads(state_file.read_text(encoding="utf-8"))["visual_asset_review"]["queue"][-1]
        self.assertEqual(result["status"], "qa_passed_pending_final_review")
        self.assertEqual(recorded["style_medium_id"], "loose-line-vivid-watercolor")
        self.assertEqual(recorded["historical_identity_qa"], {"result": "pass"})
        self.assertNotIn("identity_qa", recorded)

    def test_non_white_cat_historical_master_v1_is_still_recorded(self) -> None:
        item = self._strict_item(white_cat=False)
        state_file = self._write_state([item], item["asset_id"])
        args = self._args(
            item["asset_id"],
            self._write_qa(
                self._master_qa(white_cat=False),
                "historical-master-v1-pass.json",
            ),
        )
        result = self.strict.record(args)
        recorded = json.loads(state_file.read_text(encoding="utf-8"))
        recorded_item = recorded["visual_asset_review"]["queue"][0]
        self.assertEqual(result["status"], "awaiting_user_approval")
        self.assertEqual(recorded_item["historical_identity_qa"], {"result": "pass"})
        self.assertNotIn("qa_contract_version", recorded_item)
        self.assertFalse(state_file.with_suffix(".json.imagegen-strict.tmp").exists())

    def test_hero_pose_background_uses_current_non_character_qa_contract(self) -> None:
        self.prompt.write_text(
            self.prompt.read_text(encoding="utf-8")
            + "HERO-POSE BACKGROUND: independent text-free registered background.\n",
            encoding="utf-8",
        )
        item = self._strict_item(white_cat=False)
        item.update(
            asset_kind="hero_pose_background",
            role="base/master",
            state_index=None,
            motion_tier="hero_pose",
            schedule_background_asset_id="S01-background",
        )
        state_file = self._write_state([item], item["asset_id"])
        selection = self._enable_cover_derived_style(state_file)
        qa = self._master_qa(
            white_cat=False,
            contract_version="ordinary-imagegen-hero-pose-background-qa-v1",
        )
        qa["asset_id"] = item["asset_id"]
        qa.pop("historical_identity_qa")
        self._bind_cover_style_qa(qa, selection)
        args = self._args(
            item["asset_id"],
            self._write_qa(qa, "hero-pose-background-v1-pass.json"),
        )

        result = self.strict.record(args)
        recorded = json.loads(state_file.read_text(encoding="utf-8"))
        recorded_item = recorded["visual_asset_review"]["queue"][0]

        self.assertEqual(result["status"], "awaiting_user_approval")
        self.assertEqual(
            recorded_item["qa_contract_version"],
            "ordinary-imagegen-hero-pose-background-qa-v1",
        )
        self.assertNotIn("historical_identity_qa", recorded_item)
        self.assertFalse(state_file.with_suffix(".json.imagegen-strict.tmp").exists())

    def test_hero_pose_background_rejects_a_malformed_queue_shape(self) -> None:
        item = self._strict_item(white_cat=False)
        item.update(
            asset_kind="hero_pose_background",
            role="base/master",
            state_index=0,
            motion_tier="hero_pose",
            schedule_background_asset_id="S01-background",
        )
        state_file = self._write_state([item], item["asset_id"])
        qa = self._master_qa(white_cat=False)
        args = self._args(
            item["asset_id"],
            self._write_qa(qa, "malformed-hero-pose-background.json"),
        )
        self._assert_failure_is_atomic(
            recorder=self.strict,
            state_file=state_file,
            args=args,
            error_pattern="hero-pose background queue contract",
            temporary_suffix=".json.imagegen-strict.tmp",
        )

    def test_first_hero_pose_is_recorded_as_action_01_from_background(self) -> None:
        self.prompt.write_text(
            self.prompt.read_text(encoding="utf-8")
            + "HERO-POSE ASSET: full-canvas transparent RGBA with fixed registration anchors.\n",
            encoding="utf-8",
        )
        state_file, pose = self._hero_pose_state()
        selection = self._enable_cover_derived_style(state_file)
        qa = self._action_qa(pose, source=self.hero_pose_source)
        self._bind_cover_style_qa(qa, selection)
        args = self._args(
            pose["asset_id"],
            self._write_qa(qa, "hero-pose-action-01-pass.json"),
        )

        result = self.hybrid.record(args)
        recorded = json.loads(state_file.read_text(encoding="utf-8"))
        recorded_pose = recorded["visual_asset_review"]["queue"][1]

        self.assertEqual(result["status"], "awaiting_batch_qa")
        self.assertEqual(recorded_pose["state_index"], 0)
        self.assertEqual(recorded_pose["role"], "action-01")
        self.assertEqual(recorded_pose["depends_on"], ["S01-master-v01"])
        self.assertEqual(recorded_pose["transparent_pose_qa"]["result"], "pass")

    def test_user_supplied_takeover_action_still_requires_full_white_cat_qa(self) -> None:
        cases = (
            (
                "P0",
                lambda qa: self._add_third_forelimb(qa),
                "P0_FORELIMB_COUNT",
            ),
            (
                "P1",
                lambda qa: qa["character_reference"].update(version="white-cat-v1"),
                "canonical white-cat binding is stale",
            ),
            (
                "P2",
                lambda qa: qa["identity_qa"].update(bag_strap_count=1),
                "P2_SATCHEL_TOPOLOGY",
            ),
            (
                "semantic",
                lambda qa: qa["semantic_qa"].update(result="fail"),
                "semantic_qa did not pass",
            ),
        )
        for label, mutate, error_pattern in cases:
            with self.subTest(label=label):
                state_file, action = self._action_state()
                self._mark_action_takeover_stop(state_file, action)
                qa = self._action_qa(action)
                qa.update(
                    generator="user-supplied-takeover-image",
                    user_takeover_source=copy.deepcopy(qa["selected_source"]),
                )
                mutate(qa)
                args = self._args(
                    action["asset_id"],
                    self._write_qa(qa, f"takeover-{label}-fail.json"),
                )
                self._assert_failure_is_atomic(
                    recorder=self.hybrid,
                    state_file=state_file,
                    args=args,
                    error_pattern=error_pattern,
                    temporary_suffix=".json.imagegen-hybrid-qa.tmp",
                )

    def test_user_supplied_takeover_hero_pose_still_requires_transparency_qa(self) -> None:
        self.prompt.write_text(
            self.prompt.read_text(encoding="utf-8")
            + "HERO-POSE ASSET: full-canvas transparent RGBA with fixed registration anchors.\n",
            encoding="utf-8",
        )
        state_file, pose = self._hero_pose_state()
        self._mark_action_takeover_stop(state_file, pose)
        qa = self._action_qa(pose, source=self.hero_pose_source)
        qa.update(
            generator="user-supplied-takeover-image",
            user_takeover_source=copy.deepcopy(qa["selected_source"]),
        )
        qa["transparent_pose_qa"]["transparent_background"] = False
        args = self._args(
            pose["asset_id"],
            self._write_qa(qa, "takeover-hero-transparent-fail.json"),
        )
        self._assert_failure_is_atomic(
            recorder=self.hybrid,
            state_file=state_file,
            args=args,
            error_pattern="transparent full-canvas registration evidence",
            temporary_suffix=".json.imagegen-hybrid-qa.tmp",
        )

    def test_valid_user_supplied_takeover_action_passes_qa_without_erasing_failures(self) -> None:
        state_file, action = self._action_state()
        self._mark_action_takeover_stop(state_file, action, with_p2_failures=True)
        qa = self._action_qa(action)
        qa.update(
            generator="user-supplied-takeover-image",
            user_takeover_source=copy.deepcopy(qa["selected_source"]),
        )
        result = self.hybrid.record(
            self._args(
                action["asset_id"],
                self._write_qa(qa, "takeover-action-pass.json"),
            )
        )
        recorded = json.loads(state_file.read_text(encoding="utf-8"))
        review = recorded["visual_asset_review"]
        item = review["queue"][1]

        self.assertEqual(result["status"], "qa_passed_pending_final_review")
        self.assertEqual(item["generator"], "user-supplied-takeover-image")
        self.assertEqual(item["user_takeover_source"], qa["selected_source"])
        self.assertEqual(len(item["white_cat_imagegen_qa_failures"]), 3)
        self.assertEqual(
            item["white_cat_generation_attempt_control"]["automatic_retry_status"],
            "resolved_by_user_supplied_takeover_qa_pass",
        )
        self.assertNotIn("user_takeover_required", review)
        self.assertTrue(review["queue_generation_allowed"])

    def test_explicit_p2_override_consumes_once_and_preserves_failed_qa(self) -> None:
        state_file, action = self._action_state()
        self._mark_action_takeover_stop(state_file, action, with_p2_failures=True)
        qa = self._action_qa(action)
        qa["result"] = "fail"
        qa["identity_qa"].update(
            result="fail",
            accessory_geometry_correct=False,
            rear_strap_attached_to_rear_bag_end=False,
            bag_end_attachment_count=1,
            both_bag_end_anchors_visibly_traceable=False,
            source_retry_policy_compliant=False,
        )
        qa_path = self._write_qa(qa, "p2-override-failed-qa.json")
        state = json.loads(state_file.read_text(encoding="utf-8"))
        state["visual_asset_review"]["queue"][1][
            "pending_user_mechanical_gate_override"
        ] = self._available_p2_override(action, qa, qa_path)
        state_file.write_text(
            json.dumps(state, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        args = self._args(
            action["asset_id"],
            qa_path,
        )
        args.accept_p2_with_user_override = True
        args.override_transition_id = "episode-test:S02-action-01:p2-override:1"
        args.override_consumed_at = "2026-08-22T10:00:01+08:00"

        result = self.hybrid.record(args)
        recorded = json.loads(state_file.read_text(encoding="utf-8"))
        review = recorded["visual_asset_review"]
        item = review["queue"][1]

        self.assertEqual(result["result"], "pass_with_user_override")
        self.assertEqual(item["status"], "qa_failed_but_waived_once_pending_final_review")
        self.assertEqual(item["mechanical_qa_result"], "failed_but_waived_once")
        self.assertEqual(item["identity_qa"]["result"], "fail")
        self.assertFalse(item["identity_qa"]["accessory_geometry_correct"])
        self.assertEqual(item["user_mechanical_gate_override"]["consumption"]["status"], "consumed")
        self.assertEqual(item["user_mechanical_gate_override_result"], "pass_with_user_override")
        self.assertNotIn("pending_user_mechanical_gate_override", item)
        self.assertEqual(len(item["white_cat_imagegen_qa_failures"]), 3)
        self.assertEqual(recorded["phase"], "visual_production")
        self.assertEqual(recorded["current_phase"], "visual_production")
        self.assertTrue(review["queue_generation_allowed"])
        self.assertNotIn("user_takeover_required", review)
        self.assertEqual(
            recorded["blockers"][0]["status"],
            "failed_but_waived_once",
        )
        self.assertEqual(
            recorded["blockers"][0]["user_mechanical_gate_override_sha256"],
            item["user_mechanical_gate_override"]["override_sha256"],
        )

    def test_explicit_visible_symbol_override_consumes_general_attempt_stop(self) -> None:
        state_file, action = self._action_state()
        self._mark_action_takeover_stop(state_file, action, with_p2_failures=True)
        state = json.loads(state_file.read_text(encoding="utf-8"))
        stopped = state["visual_asset_review"]["queue"][1]
        stopped.pop("white_cat_generation_attempt_control", None)
        stopped.pop("white_cat_imagegen_qa_failures", None)
        failure_reason = (
            "可见符号失败：金币仍有花形浮雕；未满足完全空白无图案要求。"
        )
        stopped["image_generation_qa_failures"][-1]["failure_reason"] = failure_reason
        state_file.write_text(
            json.dumps(state, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        qa = self._action_qa(action)
        qa["result"] = "fail"
        qa["visible_text_qa"].update(
            result="fail",
            no_decorative_symbols=False,
            failure_reason=failure_reason,
        )
        qa["waivable_mechanical_failures"] = [{
            "error_code": "VISIBLE_SYMBOL_FREE",
            "observed_result": "fail",
            "reason": failure_reason,
        }]
        qa_path = self._write_qa(qa, "visible-symbol-override-failed-qa.json")
        args = self._args(action["asset_id"], qa_path)
        args.accept_visible_symbol_with_user_override = True
        args.override_exact_user_message = (
            "接受 S02-action-01-v01 第三次失败图，并仅此一次放行三次尝试限制"
            "及可见符号门禁；保留真实失败证据。"
        )
        args.override_decided_at = "2026-08-22T10:00:00+08:00"
        args.override_transition_id = "episode-test:S02-action-01:visible-symbol:1"
        args.override_consumed_at = "2026-08-22T10:00:01+08:00"

        result = self.hybrid.record(args)
        recorded = json.loads(state_file.read_text(encoding="utf-8"))
        item = recorded["visual_asset_review"]["queue"][1]

        self.assertEqual(result["result"], "pass_with_user_override")
        self.assertEqual(
            item["status"],
            "qa_failed_but_waived_once_pending_final_review",
        )
        self.assertEqual(item["identity_qa"]["result"], "pass")
        self.assertEqual(item["visible_text_qa"]["result"], "fail")
        self.assertEqual(
            item["waived_mechanical_gate_ids"],
            [
                "storyboard-image-generation-attempt-limit:S02:action-01",
                "visual_asset.S02-action-01-v01.VISIBLE_SYMBOL_FREE",
            ],
        )
        self.assertNotIn("white_cat_imagegen_qa_failures", item)
        self.assertEqual(recorded["blockers"][0]["status"], "failed_but_waived_once")

    def test_explicit_forward_reverse_and_p2_override_consumes_exact_three_gates(self) -> None:
        state_file, action = self._action_state()
        self._mark_action_takeover_stop(state_file, action, with_p2_failures=True)
        failure_reason = (
            "P0_FORWARD_REVERSE_MISMATCH: anatomical front is screen-right and rear "
            "is screen-left; the rear wide blue path also fails to reach a distinct "
            "rear bag-end ring."
        )
        state = json.loads(state_file.read_text(encoding="utf-8"))
        item = state["visual_asset_review"]["queue"][1]
        item["white_cat_imagegen_qa_failures"][-1].update(
            error_code="P0_FORWARD_REVERSE_MISMATCH",
            failure_reason=failure_reason,
        )
        state_file.write_text(
            json.dumps(state, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

        qa = self._action_qa(action)
        qa["result"] = "fail"
        qa["identity_qa"].update(
            result="fail",
            accessory_geometry_correct=False,
            rear_strap_attached_to_rear_bag_end=False,
            bag_end_attachment_count=1,
            both_bag_end_anchors_visibly_traceable=False,
            source_retry_policy_compliant=False,
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
                "failure_reason": failure_reason,
            },
        )
        qa["waivable_mechanical_failures"] = [
            {
                "error_code": "P0_FORWARD_REVERSE_MISMATCH",
                "observed_result": "fail",
                "reason": failure_reason,
            },
            {
                "error_code": "P2_SATCHEL_TOPOLOGY",
                "observed_result": "fail",
                "reason": failure_reason,
            },
        ]
        qa_path = self._write_qa(qa, "p0-forward-reverse-p2-override.json")
        state = json.loads(state_file.read_text(encoding="utf-8"))
        state["visual_asset_review"]["queue"][1][
            "pending_user_mechanical_gate_override"
        ] = self._available_forward_reverse_and_p2_override(
            action,
            qa,
            qa_path,
            failure_reason,
        )
        state_file.write_text(
            json.dumps(state, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

        args = self._args(action["asset_id"], qa_path)
        args.accept_p0_forward_reverse_and_p2_with_user_override = True
        args.override_transition_id = "episode-test:S02-action-01:p0-p2-override:1"
        args.override_consumed_at = "2026-08-22T10:00:01+08:00"
        result = self.hybrid.record(args)
        recorded = json.loads(state_file.read_text(encoding="utf-8"))
        recorded_item = recorded["visual_asset_review"]["queue"][1]

        self.assertEqual(result["result"], "pass_with_user_override")
        self.assertEqual(
            recorded_item["waived_mechanical_gate_ids"],
            [
                "storyboard-image-generation-attempt-limit:S02:action-01",
                "visual_asset.S02-action-01-v01.P0_FORWARD_REVERSE_MISMATCH",
                "visual_asset.S02-action-01-v01.P2_SATCHEL_TOPOLOGY",
            ],
        )
        self.assertEqual(
            recorded_item["identity_qa"]["forward_reverse_mapping_qa"]["result"],
            "fail",
        )
        self.assertEqual(recorded["phase"], "visual_production")
        self.assertTrue(recorded["visual_asset_review"]["queue_generation_allowed"])

    def test_forward_reverse_and_p2_override_requires_mapping_evidence_atomically(self) -> None:
        state_file, action = self._action_state()
        self._mark_action_takeover_stop(state_file, action, with_p2_failures=True)
        state = json.loads(state_file.read_text(encoding="utf-8"))
        failure_reason = (
            "P0_FORWARD_REVERSE_MISMATCH: anatomical front is screen-right and rear "
            "is screen-left; the rear wide blue path also fails to reach a distinct "
            "rear bag-end ring."
        )
        item = state["visual_asset_review"]["queue"][1]
        item["white_cat_imagegen_qa_failures"][-1].update(
            error_code="P0_FORWARD_REVERSE_MISMATCH",
            failure_reason=failure_reason,
        )
        state_file.write_text(
            json.dumps(state, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        qa = self._action_qa(action)
        qa["result"] = "fail"
        qa["identity_qa"].update(
            result="fail",
            accessory_geometry_correct=False,
            rear_strap_attached_to_rear_bag_end=False,
            bag_end_attachment_count=1,
            both_bag_end_anchors_visibly_traceable=False,
            source_retry_policy_compliant=False,
        )
        qa["waivable_mechanical_failures"] = [
            {
                "error_code": "P0_FORWARD_REVERSE_MISMATCH",
                "observed_result": "fail",
                "reason": failure_reason,
            },
            {
                "error_code": "P2_SATCHEL_TOPOLOGY",
                "observed_result": "fail",
                "reason": failure_reason,
            },
        ]
        qa_path = self._write_qa(qa, "p0-forward-reverse-p2-missing-map.json")
        state = json.loads(state_file.read_text(encoding="utf-8"))
        state["visual_asset_review"]["queue"][1][
            "pending_user_mechanical_gate_override"
        ] = self._available_forward_reverse_and_p2_override(
            action,
            qa,
            qa_path,
            failure_reason,
        )
        state_file.write_text(
            json.dumps(state, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        args = self._args(action["asset_id"], qa_path)
        args.accept_p0_forward_reverse_and_p2_with_user_override = True
        args.override_transition_id = "episode-test:missing-map:1"
        args.override_consumed_at = "2026-08-22T10:00:01+08:00"
        self._assert_failure_is_atomic(
            recorder=self.hybrid,
            state_file=state_file,
            args=args,
            error_pattern="forward/reverse mapping QA",
            temporary_suffix=".json.imagegen-hybrid-qa.tmp",
        )

    def test_p2_override_can_bind_supplemental_prompt_marker_releases(self) -> None:
        self.prompt.write_text(
            self.prompt.read_text(encoding="utf-8").replace(
                "WHITE-CAT SATCHEL STRAP LOCK:\n",
                "FINAL P2 CAMERA AND BAG-END LAYOUT — BLOCKING PRIORITY:\n",
            )
            + (
                "HERO-POSE ASSET: full-canvas transparent RGBA after deterministic "
                "chroma conversion, with fixed registration anchors.\n"
            ),
            encoding="utf-8",
        )
        state_file, action = self._hero_pose_state()
        action = self._mark_action_takeover_stop(
            state_file,
            action,
            with_p2_failures=True,
        )
        qa = self._action_qa(action, source=self.hero_pose_source)
        qa["result"] = "fail"
        qa["identity_qa"].update(
            result="fail",
            accessory_geometry_correct=False,
            rear_strap_attached_to_rear_bag_end=False,
            bag_end_attachment_count=1,
            both_bag_end_anchors_visibly_traceable=False,
            source_retry_policy_compliant=False,
        )
        qa_path = self._write_qa(qa, "p2-override-prompt-markers-failed-qa.json")
        override = self._available_p2_override(action, qa, qa_path)
        override["decision"]["exact_user_message"] = (
            f"接受当前 {action['asset_id']} 的 P2 背带错误图，"
            "并放行该资产三次失败限制，仅此一次"
        )
        prompt_gate_ids = [
            f"visual_asset.{action['asset_id']}.P2_PROMPT_FIXED_MARKER",
            f"visual_asset.{action['asset_id']}.HERO_POSE_PROMPT_FIXED_MARKER",
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
        override["acknowledged_failures"].extend(prompt_failures)
        override["decision"]["supplemental_exact_user_messages"] = [{
            "exact_user_message": (
                "对 S01-action-01-v01 本次转换，追加一次性放行 P2 提示词固定标记缺失"
                "与 HERO-POSE 固定标记不完全匹配门禁；保留真实提示词及失败证据。"
            ),
            "decided_at": "2026-08-22T10:00:00+08:00",
            "disposition": "allow_once",
            "gate_ids": prompt_gate_ids,
        }]
        for binding in (
            action["white_cat_imagegen_qa_failures"][-1]["output"],
            action["white_cat_imagegen_qa_failures"][-1]["prompt"],
        ):
            normalized = {
                "path": binding["path"],
                "checksum_sha256": binding["checksum_sha256"],
            }
            if normalized not in override["bound_artifacts"]:
                override["bound_artifacts"].append(normalized)
        override["override_sha256"] = self._override_sha256(override)
        state = json.loads(state_file.read_text(encoding="utf-8"))
        state["visual_asset_review"]["queue"][1][
            "pending_user_mechanical_gate_override"
        ] = override
        state_file.write_text(
            json.dumps(state, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        args = self._args(action["asset_id"], qa_path)
        args.accept_p2_with_user_override = True
        args.override_transition_id = "episode-test:S01-action-01:prompt-markers:1"
        args.override_consumed_at = "2026-08-22T10:00:01+08:00"

        result = self.hybrid.record(args)
        recorded = json.loads(state_file.read_text(encoding="utf-8"))
        item = recorded["visual_asset_review"]["queue"][1]
        self.assertEqual(result["result"], "pass_with_user_override")
        self.assertEqual(item["waived_mechanical_gate_ids"], override["gate_ids"])
        self.assertEqual(
            item["prompt_contract_qa"],
            {
                "contract_version": "white-cat-prompt-fixed-marker-qa-v1",
                "result": "failed_but_waived_once",
                "prompt": qa["selected_prompt"],
                "failures": prompt_failures,
            },
        )
        self.assertEqual(
            item["user_mechanical_gate_override"]["decision"][
                "supplemental_exact_user_messages"
            ],
            override["decision"]["supplemental_exact_user_messages"],
        )

    def test_prompt_marker_release_requires_exact_supplemental_message(self) -> None:
        self.prompt.write_text(
            self.prompt.read_text(encoding="utf-8").replace(
                "WHITE-CAT SATCHEL STRAP LOCK:\n",
                "FINAL P2 CAMERA AND BAG-END LAYOUT — BLOCKING PRIORITY:\n",
            ),
            encoding="utf-8",
        )
        state_file, action = self._action_state()
        self._mark_action_takeover_stop(state_file, action, with_p2_failures=True)
        qa = self._action_qa(action)
        qa["result"] = "fail"
        qa["identity_qa"].update(
            result="fail",
            accessory_geometry_correct=False,
            rear_strap_attached_to_rear_bag_end=False,
            bag_end_attachment_count=1,
            both_bag_end_anchors_visibly_traceable=False,
            source_retry_policy_compliant=False,
        )
        qa_path = self._write_qa(qa, "p2-override-missing-prompt-supplement.json")
        override = self._available_p2_override(action, qa, qa_path)
        prompt_gate_id = f"visual_asset.{action['asset_id']}.P2_PROMPT_FIXED_MARKER"
        override["gate_ids"].append(prompt_gate_id)
        override["acknowledged_failures"].append({
            "gate_id": prompt_gate_id,
            "observed_result": "fail",
            "reason": (
                "P2_PROMPT_FIXED_MARKER: required literal is missing: "
                "WHITE-CAT SATCHEL STRAP LOCK:"
            ),
        })
        override["override_sha256"] = self._override_sha256(override)
        state = json.loads(state_file.read_text(encoding="utf-8"))
        state["visual_asset_review"]["queue"][1][
            "pending_user_mechanical_gate_override"
        ] = override
        state_file.write_text(
            json.dumps(state, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        args = self._args(action["asset_id"], qa_path)
        args.accept_p2_with_user_override = True
        args.override_transition_id = "episode-test:missing-prompt-supplement:1"
        args.override_consumed_at = "2026-08-22T10:00:01+08:00"
        self._assert_failure_is_atomic(
            recorder=self.hybrid,
            state_file=state_file,
            args=args,
            error_pattern="supplemental prompt-marker release",
            temporary_suffix=".json.imagegen-hybrid-qa.tmp",
        )

    def test_p2_override_fails_closed_for_wrong_bindings_or_non_p2_failure(self) -> None:
        cases = ("scope", "gate", "artifact", "consumed", "semantic", "blocker")
        for label in cases:
            with self.subTest(label=label):
                state_file, action = self._action_state()
                self._mark_action_takeover_stop(state_file, action, with_p2_failures=True)
                qa = self._action_qa(action)
                qa["result"] = "fail"
                qa["identity_qa"].update(
                    result="fail",
                    accessory_geometry_correct=False,
                    rear_strap_attached_to_rear_bag_end=False,
                    bag_end_attachment_count=1,
                    both_bag_end_anchors_visibly_traceable=False,
                    source_retry_policy_compliant=False,
                )
                if label == "semantic":
                    qa["semantic_qa"]["result"] = "fail"
                qa_path = self._write_qa(qa, f"p2-override-{label}-fail.json")
                override = self._available_p2_override(action, qa, qa_path)
                if label == "scope":
                    override["scope_id"] = "S02:other-action"
                elif label == "gate":
                    override["gate_ids"][1] = "visual_asset.other.P2_SATCHEL_TOPOLOGY"
                    override["acknowledged_failures"][1]["gate_id"] = override["gate_ids"][1]
                elif label == "artifact":
                    override["bound_artifacts"][0]["checksum_sha256"] = "f" * 64
                elif label == "consumed":
                    override["consumption"].update(
                        status="consumed",
                        consumed_transition_id="old-transition",
                        consumed_at="2026-08-22T09:00:00+08:00",
                    )
                override["override_sha256"] = self._override_sha256(override)
                state = json.loads(state_file.read_text(encoding="utf-8"))
                if label == "blocker":
                    state["blockers"][0]["status"] = "resolved"
                state["visual_asset_review"]["queue"][1][
                    "pending_user_mechanical_gate_override"
                ] = override
                state_file.write_text(
                    json.dumps(state, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8",
                )
                args = self._args(
                    action["asset_id"],
                    qa_path,
                )
                args.accept_p2_with_user_override = True
                args.override_transition_id = f"episode-test:{label}:1"
                args.override_consumed_at = "2026-08-22T10:00:01+08:00"
                self._assert_failure_is_atomic(
                    recorder=self.hybrid,
                    state_file=state_file,
                    args=args,
                    error_pattern=(
                        "semantic_qa did not pass"
                        if label == "semantic"
                        else "one-time user gate override"
                    ),
                    temporary_suffix=".json.imagegen-hybrid-qa.tmp",
                )


if __name__ == "__main__":
    unittest.main()
