#!/usr/bin/env python3
from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import struct
import subprocess
import sys
import tempfile
from pathlib import Path
import unittest


SKILL = Path(__file__).resolve().parents[1]
REPO = SKILL.parents[2]
SPEC = importlib.util.spec_from_file_location(
    "ian_knowledge_video_frame",
    SKILL / "scripts" / "validate_knowledge_video_frame.py",
)
assert SPEC and SPEC.loader
CONTRACT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CONTRACT)


def png_header(width: int = 1920, height: int = 1080) -> bytes:
    return b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR" + struct.pack(">II", width, height)


class IanKnowledgeVideoFrameTests(unittest.TestCase):
    def fixture(self, mode: str = "none"):
        temporary = tempfile.TemporaryDirectory(dir=REPO / "leverage-video" / "src")
        root = Path(temporary.name)
        (root / "schema").mkdir()
        (root / "assets" / "image").mkdir(parents=True)
        exact = "因果" if mode == "required" else None
        placement = "画面中央" if mode == "required" else None
        presented = "a" * 64
        review = {
            "contract_version": "per-shot-visual-direction-review-v3",
            "presented_map_sha256": presented,
            "rows": [{
                "shot_id": "S01",
                "visible_text_mode": mode,
                "exact_visible_text": exact,
                "visible_text_placement": placement,
                "user_selection": {
                    "status": "approved",
                    "presented_map_sha256": presented,
                    "visual_generation_route": "ian-handdrawn-ppt",
                    "treatment_profile_id": "ian-handdrawn-technical",
                    "visible_text_mode": mode,
                    "exact_visible_text": exact,
                    "visible_text_placement": placement,
                },
            }],
        }
        review_path = root / "schema" / "per-shot-visual-direction-review-v3.json"
        review_path.write_text(json.dumps(review, ensure_ascii=False), encoding="utf-8")
        raster = root / "assets" / "image" / "S01.png"
        raster.write_bytes(png_header())
        workspace = root.relative_to(REPO).as_posix()
        manifest = {
            "contract_version": "ian-knowledge-video-frame-v1",
            "episode_workspace": workspace,
            "queue_item_id": "visual-S01",
            "shot_id": "S01",
            "visual_generation_route": "ian-handdrawn-ppt",
            "treatment_profile_id": "ian-handdrawn-technical",
            "visible_text_mode": mode,
            "exact_visible_text": exact,
            "visible_text_placement": placement,
            "visual_direction_review": {
                "path": f"{workspace}/schema/per-shot-visual-direction-review-v3.json",
                "sha256": hashlib.sha256(review_path.read_bytes()).hexdigest(),
                "presented_map_sha256": presented,
            },
            "generation_constraints": CONTRACT.EXPECTED_CONSTRAINTS.copy(),
            "verified_visible_text": [exact] if exact else [],
            "output_raster": {
                "path": f"{workspace}/assets/image/S01.png",
                "sha256": hashlib.sha256(raster.read_bytes()).hexdigest(),
                "width": 1920,
                "height": 1080,
                "role": "final-production-raster",
            },
        }
        return temporary, root, manifest

    def validate(self, root: Path, manifest: dict):
        return CONTRACT.validate_manifest(manifest, episode_workspace=root, repo_root=REPO)

    def policy_authorize(self, root: Path, manifest: dict) -> str:
        policy_sha = "f" * 64
        authorized_at = "2026-08-24T10:00:00+08:00"
        review_path = root / "schema" / "per-shot-visual-direction-review-v3.json"
        review = json.loads(review_path.read_text(encoding="utf-8"))
        review["status"] = "policy_authorized"
        review["policy_authorization"] = {
            "policy_sha256": policy_sha,
            "authorized_at": authorized_at,
            "user_has_reviewed_specific_map": False,
            "presented_map_sha256": review["presented_map_sha256"],
        }
        selection = review["rows"][0]["user_selection"]
        selection.update({
            "status": "policy_authorized",
            "policy_sha256": policy_sha,
            "deterministic_recommendation_selected": True,
            "user_has_reviewed_specific_map": False,
            "exact_message": None,
            "decided_at": None,
            "authorized_at": authorized_at,
        })
        review_path.write_text(json.dumps(review, ensure_ascii=False), encoding="utf-8")
        review_sha = hashlib.sha256(review_path.read_bytes()).hexdigest()
        manifest["visual_direction_review"]["sha256"] = review_sha
        state = {
            "workflow_approval_mode": {"approval_mode": "one_click"},
            "one_click_approval_policy": {
                "contract_version": "one-click-approval-policy-v1",
                "policy_sha256": policy_sha,
                "preauthorizations": {
                    "deterministic_visual_direction_recommendations": True,
                    "continue_during_visual_production": True,
                },
                "user_has_reviewed_specific_maps": False,
            },
            "visual_direction_review": {
                "status": "policy_authorized",
                "path": manifest["visual_direction_review"]["path"],
                "checksum_sha256": review_sha,
                "presented_map_sha256": review["presented_map_sha256"],
                "policy_sha256": policy_sha,
                "user_has_reviewed_specific_map": False,
            },
        }
        (root / "schema" / "episode-state.json").write_text(
            json.dumps(state, ensure_ascii=False), encoding="utf-8"
        )
        return policy_sha

    def test_accepts_one_text_free_frame(self):
        temporary, root, manifest = self.fixture()
        with temporary:
            self.assertEqual(self.validate(root, manifest)["result"], "pass")

    def test_required_mode_accepts_only_exact_v3_text(self):
        temporary, root, manifest = self.fixture("required")
        with temporary:
            self.validate(root, manifest)
            changed = copy.deepcopy(manifest)
            changed["verified_visible_text"] = ["因果。"]
            with self.assertRaisesRegex(ValueError, "exact approved Chinese"):
                self.validate(root, changed)

    def test_accepts_policy_authorized_frame_when_current_and_policy_bound(self):
        temporary, root, manifest = self.fixture()
        with temporary:
            self.policy_authorize(root, manifest)
            self.assertEqual(self.validate(root, manifest)["result"], "pass")

    def test_rejects_policy_authorized_frame_with_stale_state_policy(self):
        temporary, root, manifest = self.fixture()
        with temporary:
            self.policy_authorize(root, manifest)
            state_path = root / "schema" / "episode-state.json"
            state = json.loads(state_path.read_text(encoding="utf-8"))
            state["one_click_approval_policy"]["policy_sha256"] = "b" * 64
            state_path.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "policy"):
                self.validate(root, manifest)

    def test_rejects_page_shell_multi_output_and_stale_review(self):
        temporary, root, manifest = self.fixture()
        with temporary:
            changed = copy.deepcopy(manifest)
            changed["generation_constraints"]["automatic_title"] = True
            with self.assertRaisesRegex(ValueError, "ordinary page shell"):
                self.validate(root, changed)
            changed = copy.deepcopy(manifest)
            changed["generation_constraints"]["output_raster_count"] = 2
            with self.assertRaisesRegex(ValueError, "ordinary page shell"):
                self.validate(root, changed)
            changed = copy.deepcopy(manifest)
            changed["visual_direction_review"]["sha256"] = "b" * 64
            with self.assertRaisesRegex(ValueError, "checksum is stale"):
                self.validate(root, changed)

    def test_cli_accepts_root_relative_manifest_path(self):
        temporary, root, manifest = self.fixture()
        with temporary:
            manifest_path = root / "schema" / "frame.json"
            manifest_path.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
            result = subprocess.run(
                [
                    sys.executable,
                    str(SKILL / "scripts" / "validate_knowledge_video_frame.py"),
                    "--episode-workspace",
                    root.relative_to(REPO).as_posix(),
                    manifest_path.relative_to(REPO).as_posix(),
                ],
                cwd=REPO,
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)["result"], "pass")


if __name__ == "__main__":
    unittest.main()
