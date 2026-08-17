#!/usr/bin/env python3
"""Contract checks for the completed-episode revoice-variant workflow."""

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[4]


class RevoiceVariantContractTest(unittest.TestCase):
    def assert_file_contains(self, relative_path: str, *needles: str) -> None:
        content = (ROOT / relative_path).read_text(encoding="utf-8")
        for needle in needles:
            self.assertIn(needle, content, f"{relative_path} lacks {needle!r}")

    def test_project_instructions_authorize_narrow_revoice_resume(self) -> None:
        self.assert_file_contains(
            "AGENTS.md",
            "revoice_variant",
            "workflow-state-machine.md",
            "revoice-variant.md",
            "preserving locked words and visuals",
        )

    def test_orchestrator_routes_revoice_without_visual_generation(self) -> None:
        self.assert_file_contains(
            ".agents/skills/run-knowledge-video/SKILL.md",
            "references/revoice-variant.md",
            "voice-only derivative",
            "Do not call `$produce-video-visuals`",
        )

    def test_state_machine_records_variant_lineage_and_visual_binding(self) -> None:
        self.assert_file_contains(
            ".agents/skills/run-knowledge-video/references/workflow-state-machine.md",
            "revoice_variant",
            "visual_sequence_lock",
            "revoice-visual-binding",
            "awaiting_revoice_storyboard_review",
        )

    def test_audio_node_supports_exact_replacement_selection(self) -> None:
        self.assert_file_contains(
            ".agents/skills/validate-video-narration/SKILL.md",
            "replacement narration audio",
            "exact user-named top-level `voice*.mp3`",
        )

    def test_storyboard_node_supports_timing_only_derivation(self) -> None:
        self.assert_file_contains(
            ".agents/skills/build-video-storyboard/SKILL.md",
            "retiming-only",
            "visual_sequence_lock",
            "Do not call `$produce-video-visuals`",
        )

    def test_assembly_node_consumes_locked_visual_sequence(self) -> None:
        self.assert_file_contains(
            ".agents/skills/assemble-video-master/SKILL.md",
            "locked visual sequence",
            "revoice-visual-binding",
            "replacement narration master",
        )

    def test_revoice_preserves_exact_parent_transition_parameters(self) -> None:
        self.assert_file_contains(
            ".agents/skills/run-knowledge-video/references/revoice-variant.md",
            "`duration_seconds`",
            "`duration_in_frames`",
            "Any transition kind, option, duration, or frame-count change exits this route",
            "new shot is shorter than its locked transition",
            "another voice/speed",
        )
        self.assert_file_contains(
            ".agents/skills/assemble-video-master/SKILL.md",
            "never recomputes state count/order or any inter-shot transition kind/options/duration/frame count",
            "shot is shorter than its locked transition",
        )

    def test_retired_comic_or_doodle_parent_cannot_enter_revoice(self) -> None:
        self.assert_file_contains(
            ".agents/skills/run-knowledge-video/references/revoice-variant.md",
            "contains the retired `comic-imagegen` or `doodle-slides` route",
            "historical read-only",
        )

    def test_revoice_bgm_inherits_without_selector_resolution(self) -> None:
        self.assert_file_contains(
            ".agents/skills/assemble-video-master/references/final-mix-and-delivery.md",
            "In `revoice_variant`, skip selector and source resolution.",
            "never substitute the current default",
        )


if __name__ == "__main__":
    unittest.main()
