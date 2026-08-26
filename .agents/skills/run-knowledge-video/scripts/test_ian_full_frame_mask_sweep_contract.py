#!/usr/bin/env python3
"""Contract checks for the active Ian layered entry-effects rule."""

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[4]


class IanLayeredSceneContractTest(unittest.TestCase):
    def assert_file_contains(self, relative_path: str, *needles: str) -> None:
        content = (ROOT / relative_path).read_text(encoding="utf-8")
        for needle in needles:
            self.assertIn(needle, content, f"{relative_path} lacks {needle!r}")

    def test_authoritative_state_machine_defines_package_timing_and_entry_owners(self) -> None:
        self.assert_file_contains(
            ".agents/skills/run-knowledge-video/references/workflow-state-machine.md",
            "ian-knowledge-video-layered-scene-v2",
            "one complete text-free master",
            "ian-layered-scene-plan-v1",
            "meaningful_change_events",
            "event.at_frame - shot_start_frame",
            "full-canvas transparent pre-text layers",
            "ian-layered-entry-effects-v2",
            "maximum-10-px soft settle",
            "`OPEN-00 → S01`",
            "approved incoming `scene-transition-v3`",
            "completed-history evidence only",
        )

    def test_remotion_contract_consumes_checksum_bound_motion_and_sfx(self) -> None:
        self.assert_file_contains(
            ".agents/skills/assemble-video-master/references/remotion-assembly-and-render.md",
            "`IanLayeredScene`",
            "`qa_contract.ian_layered_scene_packages`",
            "ian-layered-entry-effects-renderer-v2",
            "approved SVG-backed contour/path reveal",
            "only 2–3 semantically important layers",
            "adjacent audible timbre families must differ",
            "pitch/speed-only pseudo-variation is forbidden",
            "`FullFrameMaskSweep`",
            "Whole-scene movement, scaling, rotation",
            "approved incoming `scene-transition-v3`",
        )

    def test_assembly_and_storyboard_require_exact_layer_plan(self) -> None:
        self.assert_file_contains(
            ".agents/skills/assemble-video-master/SKILL.md",
            "ian-knowledge-video-layered-scene-v2",
            "IanLayeredScene",
            "visual_generation_route: ian-handdrawn-ppt",
            "soft-settle-v1",
        )
        self.assert_file_contains(
            ".agents/skills/build-video-storyboard/references/storyboard-contract.md",
            "Ian 分层场景计划",
            "ian-layered-scene-plan-v1",
            "contiguous exact UTF-8 byte ranges",
            "meaningful_change_events",
            "ian-layered-entry-effects-v2",
            "completed-history evidence only",
        )

    def test_renderer_uses_deterministic_motion_svg_masks_and_audio(self) -> None:
        renderer = (
            ROOT / "leverage-video/src/shared/video-scenes/IanLayeredScene.tsx"
        ).read_text(encoding="utf-8")
        self.assertIn("layer.entry_frame", renderer)
        self.assertIn("opacity", renderer)
        self.assertIn("softSettleOffset", renderer)
        self.assertIn("strokeDashoffset", renderer)
        self.assertIn("<Audio", renderer)
        for forbidden in (
            "scale(",
            "rotate(",
            "maskImage",
            "clipPath",
            "FullFrameMaskSweep",
            "Math.random",
        ):
            self.assertNotIn(forbidden, renderer)

    def test_summary_exposes_entry_effects_and_legacy_boundary(self) -> None:
        self.assert_file_contains(
            ".agents/skills/run-knowledge-video/references/whole-workflow-summary.md",
            "ian-knowledge-video-layered-scene-v2",
            "无字的完整 Ian 母图",
            "ian-layered-entry-effects-v2",
            "每镜最多两种运动语言",
            "多层镜头只给 2–3 个关键层配置真实入场音效",
            "同一源素材单镜最多两次",
            "不准仅靠变调或变速伪造变化",
            "仅供已完成历史项目只读",
        )


if __name__ == "__main__":
    unittest.main()
