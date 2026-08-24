#!/usr/bin/env python3
"""Contract checks for the active static Ian layered-scene rule."""

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
            "ian-knowledge-video-layered-scene-v1",
            "ian-layered-scene-plan-v1",
            "meaningful_change_events",
            "event.at_frame - shot_start_frame",
            "transparent semantic layers",
            "eight-frame fade",
            "spatially static",
            "`OPEN-00 → S01`",
            "approved incoming `scene-transition-v3`",
            "completed-history evidence only",
        )

    def test_remotion_contract_consumes_layers_and_forbids_raster_motion(self) -> None:
        self.assert_file_contains(
            ".agents/skills/assemble-video-master/references/remotion-assembly-and-render.md",
            "`IanLayeredScene`",
            "`qa_contract.ian_layered_scene_packages`",
            "fixed at `left: 0`, `top: 0`, scale 1, and rotation 0",
            "linear 0→1 over exactly eight local frames",
            "`FullFrameMaskSweep`",
            "scene and layer translation, scaling, rotation",
            "approved incoming `scene-transition-v3`",
        )

    def test_assembly_and_storyboard_require_exact_layer_plan(self) -> None:
        self.assert_file_contains(
            ".agents/skills/assemble-video-master/SKILL.md",
            "ian-knowledge-video-layered-scene-v1",
            "IanLayeredScene",
            "visual_generation_route: ian-handdrawn-ppt",
            "exactly eight frames",
        )
        self.assert_file_contains(
            ".agents/skills/build-video-storyboard/references/storyboard-contract.md",
            "Ian 分层场景计划",
            "ian-layered-scene-plan-v1",
            "contiguous exact UTF-8 byte ranges",
            "meaningful_change_events",
            "Only layer opacity may change",
            "completed-history evidence only",
        )

    def test_renderer_changes_only_layer_opacity(self) -> None:
        renderer = (
            ROOT / "leverage-video/src/shared/video-scenes/IanLayeredScene.tsx"
        ).read_text(encoding="utf-8")
        self.assertIn("layer.entry_frame", renderer)
        self.assertIn("opacity", renderer)
        for forbidden in (
            "transform:",
            "translate(",
            "scale(",
            "rotate(",
            "maskImage",
            "clipPath",
            "FullFrameMaskSweep",
        ):
            self.assertNotIn(forbidden, renderer)

    def test_summary_exposes_static_layered_rule_and_legacy_boundary(self) -> None:
        self.assert_file_contains(
            ".agents/skills/run-knowledge-video/references/whole-workflow-summary.md",
            "ian-knowledge-video-layered-scene-v1",
            "静止背景",
            "全画布透明 PNG 层",
            "固定 8 帧透明度渐显",
            "不平移、不缩放、不旋转",
            "仅供已完成历史项目只读",
        )


if __name__ == "__main__":
    unittest.main()
