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
) -> None:
    def chunk(kind: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + kind
            + payload
            + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
        )

    rows = b"".join(b"\x00" + bytes(rgb) * width for _ in range(height))
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(rows))
        + chunk(b"IEND", b"")
    )


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class FakeVisualGate:
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
        item["status"] = "awaiting_batch_qa"
        item["qa_passed_at"] = qa_time


class WhiteCatRecorderV2IntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.strict = load_module(STRICT_PATH, "white_cat_v2_strict_integration")
        cls.hybrid = load_module(HYBRID_PATH, "white_cat_v2_hybrid_integration")

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
""",
            encoding="utf-8",
        )
        self.master_source = self.files / "master.png"
        self.action_source = self.files / "action.png"
        self.numbered_map = self.files / "numbered-map.png"
        write_png(self.master_source)
        write_png(self.action_source, rgb=(240, 240, 240))
        write_png(self.numbered_map, rgb=(255, 0, 0))

        self.authority = self._text_file("style-authority.md", "style authority")
        self.catalog = self._text_file("visual-catalog.md", "visual catalog")
        self.primary = self._text_file("white-cat-primary.dat", "primary identity")
        self.bible = self._text_file("white-cat-bible.md", "character bible")
        self.constraints = self._text_file("white-cat-constraints.md", "generation constraints")
        self.accuracy = self._text_file("white-cat-accuracy.md", "satchel accuracy")
        self.geometry = self._text_file("white-cat-geometry.dat", "supporting geometry")

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

    def _action_qa(self, action: dict, *, contract_version: str | None = None) -> dict:
        selected_source = {
            **self._binding(self.action_source),
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
        return {
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
            "identity_qa": self._identity(self.action_source),
            **self._passing_checks(),
        }

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


if __name__ == "__main__":
    unittest.main()
