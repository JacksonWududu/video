#!/usr/bin/env python3
from __future__ import annotations

import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class SkillContractTests(unittest.TestCase):
    def test_retains_only_curated_upstream_surface(self):
        self.assertTrue((ROOT / "LICENSE").is_file())
        self.assertTrue((ROOT / "assets/drawing-hand.png").is_file())
        self.assertFalse((ROOT / "assets/preview.html").exists())
        self.assertFalse((ROOT / "scripts/parse_srt.py").exists())
        self.assertFalse((ROOT / "scripts/merge_scenes.py").exists())
        self.assertFalse((ROOT / "README.md").exists())

    def test_dependency_lock_is_exact_and_excludes_pyav(self):
        lines = (ROOT / "requirements.lock").read_text(encoding="utf-8").splitlines()
        self.assertEqual(lines, [
            "opencv-python-headless==5.0.0.93",
            "numpy==2.5.1",
            "Pillow==12.3.0",
        ])
        self.assertFalse(any(line.lower().startswith("av") for line in lines))
        renderer = (ROOT / "scripts/stream_render.py").read_text(encoding="utf-8")
        self.assertNotIn("import av", renderer)

    def test_publishes_machine_readable_contracts(self):
        for name in (
            "whiteboard-annotation-v1.schema.json",
            "whiteboard-annotation-v2.schema.json",
            "whiteboard-render-evidence-v1.schema.json",
        ):
            self.assertTrue((ROOT / "references" / name).is_file())

    def test_current_annotation_uses_upstream_enum_and_v3_binding(self):
        schema = (ROOT / "references" / "whiteboard-annotation-v2.schema.json").read_text(encoding="utf-8")
        self.assertIn('"visible_text_mode": {"enum": ["none", "required"]}', schema)
        self.assertIn('"visual_direction_review_sha256"', schema)
        self.assertIn('"presented_map_sha256"', schema)
        contract = (ROOT / "scripts" / "whiteboard_contract.py").read_text(encoding="utf-8")
        self.assertIn("validate_visual_direction_binding", contract)
        self.assertIn("does not equal v3", contract)
        self.assertIn('root / "schema" / "episode-state.json"', contract)
        self.assertIn("not the current episode-state artifact", contract)

    def test_skill_forbids_browser_and_srt_workflow(self):
        text = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("不得自行解析 SRT", text)
        self.assertIn("不得使用 Computer Use", text)
        self.assertIn("whiteboard-element-sequence-replaces-action-family-v1", text)

    def test_active_renderers_forbid_drawing_overlays(self):
        skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        entrypoint = (ROOT / "scripts/render_whiteboard_clip.py").read_text(encoding="utf-8")
        region_renderer = (ROOT / "scripts/region_stream_renderer.py").read_text(encoding="utf-8")
        stream_renderer = (ROOT / "scripts/stream_render.py").read_text(encoding="utf-8")
        schema = (ROOT / "references/whiteboard-render-evidence-v1.schema.json").read_text(encoding="utf-8")
        self.assertIn("canvas-only-no-hand-pen-cursor-v1", skill)
        self.assertIn('"drawing_overlay_policy"', schema)
        for source in (entrypoint, region_renderer, stream_renderer):
            self.assertNotIn("--hand", source)
            self.assertNotIn("--bare-tip", source)
            self.assertNotIn("--pen-image", source)
            self.assertNotIn("TipOverlay", source)
            self.assertNotIn("drawing-hand.png", source)


if __name__ == "__main__":
    unittest.main()
