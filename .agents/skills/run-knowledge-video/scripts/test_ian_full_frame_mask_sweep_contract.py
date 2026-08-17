#!/usr/bin/env python3
"""Contract checks for the Ian-only full-frame mask-sweep render rule."""

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[4]


class IanFullFrameMaskSweepContractTest(unittest.TestCase):
    def assert_file_contains(self, relative_path: str, *needles: str) -> None:
        content = (ROOT / relative_path).read_text(encoding="utf-8")
        for needle in needles:
            self.assertIn(needle, content, f"{relative_path} lacks {needle!r}")

    def test_authoritative_state_machine_defines_scope_timing_and_evidence(self) -> None:
        self.assert_file_contains(
            ".agents/skills/run-knowledge-video/references/workflow-state-machine.md",
            "ian-full-frame-mask-sweep-v1",
            "`visual_generation_route: ian-handdrawn-ppt`",
            "leverage-video/src/shared/full-frame-mask-sweep",
            "duration_in_frames <= round(fps × 3)",
            "sweep_frames = duration_in_frames - round(fps × 3)",
            "hold_frames = round(fps × 3)",
            "does not apply to any non-Ian visual",
            "shot duration rather than the full-composition duration",
        )

    def test_remotion_contract_requires_the_shared_component_only_for_ian(self) -> None:
        self.assert_file_contains(
            ".agents/skills/assemble-video-master/references/remotion-assembly-and-render.md",
            "ian-full-frame-mask-sweep-v1",
            "`FullFrameMaskSweep`",
            "leverage-video/src/shared/full-frame-mask-sweep",
            "must use",
            "Ink `GraphicScene` and historical `DoodleScene` never import or consume `FullFrameMaskSweep`",
            "exactly 3 seconds",
            "explicit exception to the general 2.5-second maximum continuous hold",
        )

    def test_assembly_entry_and_storyboard_contract_route_the_effect(self) -> None:
        self.assert_file_contains(
            ".agents/skills/assemble-video-master/SKILL.md",
            "ian-full-frame-mask-sweep-v1",
            "visual_generation_route: ian-handdrawn-ppt",
        )
        self.assert_file_contains(
            ".agents/skills/build-video-storyboard/references/storyboard-contract.md",
            "ian-full-frame-mask-sweep-v1",
            "derived from the final shot duration",
            "not a selectable motion alternative",
        )

    def test_summary_exposes_the_ian_only_rule(self) -> None:
        self.assert_file_contains(
            ".agents/skills/run-knowledge-video/references/whole-workflow-summary.md",
            "ian-full-frame-mask-sweep-v1",
            "只适用于 `visual_generation_route: ian-handdrawn-ppt`",
            "大于 3 秒",
            "小于或等于 3 秒",
            "非 Ian 分镜不自动使用",
        )


if __name__ == "__main__":
    unittest.main()
