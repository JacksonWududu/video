#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw


SKILL = Path(__file__).resolve().parents[1]
SCRIPTS = SKILL / "scripts"
REPO = SKILL.parents[2]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class RendererIntegrationTests(unittest.TestCase):
    def test_synthetic_line_art_renders_exact_silent_h264(self):
        with tempfile.TemporaryDirectory(prefix="whiteboard-integration-", dir=REPO / "leverage-video" / "src") as directory:
            root = Path(directory)
            source = root / "source.png"
            annotation_path = root / "annotation.json"
            preview = root / "preview.png"
            clip = root / "clip.mp4"
            evidence_path = root / "evidence.json"

            image = Image.new("RGB", (1920, 1080), "#F5EBD7")
            draw = ImageDraw.Draw(image)
            draw.rounded_rectangle((160, 130, 760, 700), radius=50, outline="#363636", width=18, fill="#F2B24A")
            draw.line((300, 280, 610, 560), fill="#C84B31", width=24)
            draw.ellipse((980, 180, 1540, 700), outline="#363636", width=18, fill="#4E85C5")
            draw.line((1100, 520, 1440, 320), fill="#C84B31", width=24)
            image.save(source, format="PNG", optimize=False)

            schema = root / "schema"
            schema.mkdir()
            presented = "c" * 64
            review = {
                "contract_version": "per-shot-visual-direction-review-v3",
                "presented_map_sha256": presented,
                "rows": [{
                    "shot_id": "SYNTH-01",
                    "scene_class": "narrative_illustration",
                    "visible_text_mode": "none",
                    "exact_visible_text": None,
                    "visible_text_placement": None,
                    "user_selection": {
                        "status": "approved",
                        "white_cat_present": False,
                        "visual_generation_route": "srt-whiteboard-animation",
                        "presented_map_sha256": presented,
                        "visible_text_mode": "none",
                        "exact_visible_text": None,
                        "visible_text_placement": None,
                    },
                }],
            }
            review_path = schema / "per-shot-visual-direction-review-v3.json"
            review_path.write_text(json.dumps(review, ensure_ascii=False), encoding="utf-8")
            review_relative = review_path.relative_to(REPO).as_posix()
            review_sha = sha256(review_path)
            (schema / "episode-state.json").write_text(json.dumps({
                "visual_direction_review": {
                    "status": "approved",
                    "artifact_path": review_relative,
                    "artifact_checksum_sha256": review_sha,
                    "presented_map_sha256": presented,
                },
            }), encoding="utf-8")

            annotation = {
                "contract_version": "whiteboard-annotation-v2",
                "shot_id": "SYNTH-01",
                "visual_generation_route": "srt-whiteboard-animation",
                "white_cat_present": False,
                "scene_class": "narrative_illustration",
                "visual_direction_review_path": review_relative,
                "visual_direction_review_sha256": review_sha,
                "presented_map_sha256": presented,
                "canvas": {"width": 1920, "height": 1080, "fps": 30},
                "source_image_sha256": sha256(source),
                "normalized_image_sha256": sha256(source),
                "locked_source_text": "甲乙",
                "total_frames": 45,
                "final_hold_frames": 15,
                "subtitle_safe_area": {"x": 0, "y": 850, "width": 1920, "height": 230},
                "visible_text_mode": "none",
                "approved_visible_text": [],
                "approved_text_placement": None,
                "text_layers": [],
                "performing_subject_present": False,
                "action_family_policy": None,
                "elements": [
                    {
                        "id": "cause", "sequence": 1, "semantic_role": "起因", "type": "object",
                        "subtitle_span": {"start": 0, "end": 1, "text": "甲"},
                        "region": {"x": 120, "y": 90, "width": 700, "height": 660},
                        "protected_regions": [], "start_frame": 0, "end_frame": 8
                    },
                    {
                        "id": "effect", "sequence": 2, "semantic_role": "结果", "type": "object",
                        "subtitle_span": {"start": 1, "end": 2, "text": "乙"},
                        "region": {"x": 920, "y": 100, "width": 700, "height": 650},
                        "protected_regions": [], "start_frame": 8, "end_frame": 20
                    }
                ]
            }
            annotation_path.write_text(json.dumps(annotation, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

            subprocess.run(
                [
                    sys.executable, str(SCRIPTS / "render_annotation_preview.py"),
                    "--episode-workspace", str(root),
                    source.relative_to(REPO).as_posix(), annotation_path.relative_to(REPO).as_posix(),
                    preview.relative_to(REPO).as_posix()
                ],
                check=True, capture_output=True, text=True,
            )
            subprocess.run(
                [
                    sys.executable, str(SCRIPTS / "render_whiteboard_clip.py"),
                    "--episode-workspace", str(root), "--source-image", source.relative_to(REPO).as_posix(),
                    "--normalized-image", source.relative_to(REPO).as_posix(),
                    "--annotation", annotation_path.relative_to(REPO).as_posix(),
                    "--preview", preview.relative_to(REPO).as_posix(),
                    "--output", clip.relative_to(REPO).as_posix(),
                    "--evidence", evidence_path.relative_to(REPO).as_posix()
                ],
                check=True, capture_output=True, text=True,
            )
            evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
            self.assertEqual(evidence["contract_version"], "whiteboard-render-evidence-v1")
            self.assertEqual(evidence["media"]["width"], 1920)
            self.assertEqual(evidence["media"]["height"], 1080)
            self.assertEqual(evidence["media"]["fps"], 30)
            self.assertEqual(evidence["media"]["codec"], "h264")
            self.assertEqual(evidence["media"]["audio_streams"], 0)
            self.assertEqual(evidence["media"]["frame_count"], 45)
            self.assertGreaterEqual(evidence["media"]["full_frame_hold_verified_frames"], 15)
            self.assertTrue(evidence["media"]["final_frame_verified"])
            self.assertEqual(evidence["clip"]["sha256"], sha256(clip))

    def test_annotation_validator_rejects_a_path_outside_episode_workspace(self):
        with tempfile.TemporaryDirectory(prefix="whiteboard-path-bound-", dir=REPO / "leverage-video" / "src") as directory:
            parent = Path(directory)
            episode = parent / "episode"
            episode.mkdir()
            outside = parent / "outside.json"
            outside.write_text("{}\n", encoding="utf-8")
            completed = subprocess.run(
                [
                    sys.executable, str(SCRIPTS / "validate_whiteboard_annotation.py"),
                    "--episode-workspace", str(episode), outside.relative_to(REPO).as_posix()
                ],
                capture_output=True, text=True,
            )
            self.assertNotEqual(completed.returncode, 0)
            self.assertIn("escapes episode workspace", completed.stderr)


if __name__ == "__main__":
    unittest.main()
