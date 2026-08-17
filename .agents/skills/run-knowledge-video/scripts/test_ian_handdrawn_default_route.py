#!/usr/bin/env python3
"""Contract checks for character-free data/logic storyboard-source routing."""

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[4]


class IanHanddrawnDefaultRouteContractTest(unittest.TestCase):
    def assert_file_contains(self, relative_path: str, *needles: str) -> None:
        content = (ROOT / relative_path).read_text(encoding="utf-8")
        for needle in needles:
            self.assertIn(needle, content, f"{relative_path} lacks {needle!r}")

    def assert_file_excludes(self, relative_path: str, *needles: str) -> None:
        content = (ROOT / relative_path).read_text(encoding="utf-8")
        for needle in needles:
            self.assertNotIn(needle, content, f"{relative_path} still contains {needle!r}")

    def test_project_instructions_route_the_visual_contract(self) -> None:
        self.assert_file_contains(
            "AGENTS.md",
            "build-video-storyboard",
            "produce-video-visuals",
            "Per-Shot Visual Direction Review",
            "immutable contract inputs",
        )
        self.assert_file_excludes(
            "AGENTS.md",
            "visual-generation-route-catalog-v1",
            "ian-handdrawn-ppt-default-v1",
            "deterministic production derivative",
            "historical still or character-led narrative illustration keeps its existing route",
        )

    def test_visual_skill_uses_the_generated_raster_as_the_production_visual(self) -> None:
        self.assert_file_contains(
            ".agents/skills/produce-video-visuals/SKILL.md",
            "per-shot-visual-direction-review-v3",
            "`ian-handdrawn-ppt` creates the complete raster",
            "accepted Ian or Ink Doodle PNG is the final production visual",
            "Do not create an editable data/logic scene",
            "shared opening cover",
            "ian-knowledge-video-frame-v1",
        )
        self.assert_file_excludes(
            ".agents/skills/produce-video-visuals/SKILL.md",
            "editable production derivative",
            "historical still or character-led narrative illustration follows its existing route",
            "every active vector's declared canvas/viewBox",
        )

    def test_data_contract_forbids_code_redraws_and_limits_remotion(self) -> None:
        self.assert_file_contains(
            ".agents/skills/produce-video-visuals/references/cover-data-and-asset-lock.md",
            "visual-generation-route-catalog-v2",
            "approved `ink-doodle-knowledge-card` selection is exact-shot opt-out evidence",
            "ink-doodle-knowledge-card-route-v1",
            "Remotion consumes only the approved PNG",
            "exact prompt/reference/style fingerprints",
        )
        self.assert_file_excludes(
            ".agents/skills/produce-video-visuals/references/cover-data-and-asset-lock.md",
            "`editable_scene_sources`",
            "editable transition derivatives",
            "deterministic production derivative",
        )

    def test_storyboard_plans_generated_rasters_not_editable_logic_scenes(self) -> None:
        self.assert_file_contains(
            ".agents/skills/build-video-storyboard/references/storyboard-contract.md",
            "ian-handdrawn-ppt-default-v1",
            "complete 16:9 raster page",
            "generated data/logic rasters",
            "ink-doodle-knowledge-card",
            "`doodle-slides` is historical read-only",
        )
        self.assert_file_excludes(
            ".agents/skills/build-video-storyboard/references/storyboard-contract.md",
            "editable data/transition sources",
            "Data visualizations are editable",
        )

    def test_remotion_only_animates_approved_rasters(self) -> None:
        self.assert_file_contains(
            ".agents/skills/assemble-video-master/references/remotion-assembly-and-render.md",
            "animation effects only",
            "must not redraw, recreate, or replace",
            "approved raster",
            "ComicScene",
            "legacy decoder/consumer implementation",
            "Do not invoke it for a new output or derivative",
        )
        self.assert_file_excludes(
            ".agents/skills/assemble-video-master/references/remotion-assembly-and-render.md",
            "Keep data labels editable",
        )

    def test_authoritative_state_machine_records_the_raster_only_route(self) -> None:
        self.assert_file_contains(
            ".agents/skills/run-knowledge-video/references/workflow-state-machine.md",
            "ian-handdrawn-ppt-default-v1",
            "final production visual",
            "Remotion consumes only approved PNG bytes",
            "no image-generation or redraw role",
            "Regenerate each affected Ian or Ink data/logic raster only through its currently approved `ian-handdrawn-ppt` or `ink-doodle-knowledge-card` route",
            "ian-knowledge-video-frame-v1",
        )
        self.assert_file_excludes(
            ".agents/skills/run-knowledge-video/references/workflow-state-machine.md",
            "Regenerate the AI source near 16:9 or recompose deterministic assets natively at 1920×1080",
        )

    def test_ian_skill_publishes_v3_bound_single_frame_adapter(self) -> None:
        self.assert_file_contains(
            ".agents/skills/ian-handdrawn-ppt/SKILL.md",
            "ian-knowledge-video-frame-v1",
            "exactly one 1920×1080 final PNG per queue item",
            "per-shot-visual-direction-review-v3",
        )
        self.assert_file_contains(
            ".agents/skills/ian-handdrawn-ppt/references/knowledge-video-frame.md",
            "automatic page number, title, subtitle, label, signature",
            "contact sheet is an outer Visual Asset Review artifact only",
            "validate_knowledge_video_frame.py",
        )


if __name__ == "__main__":
    unittest.main()
