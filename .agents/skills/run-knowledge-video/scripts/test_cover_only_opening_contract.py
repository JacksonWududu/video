#!/usr/bin/env python3
"""Contract checks for the canonical single-image knowledge-video opening."""

from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[4]


class CoverOnlyOpeningContractTest(unittest.TestCase):
    CONTRACT_FILES = (
        "AGENTS.md",
        ".agents/skills/run-knowledge-video/SKILL.md",
        ".agents/skills/run-knowledge-video/references/workflow-state-machine.md",
        ".agents/skills/run-knowledge-video/references/whole-workflow-summary.md",
        ".agents/skills/run-knowledge-video/references/revoice-variant.md",
        ".agents/skills/build-video-storyboard/SKILL.md",
        ".agents/skills/build-video-storyboard/references/storyboard-contract.md",
        ".agents/skills/produce-video-visuals/SKILL.md",
        ".agents/skills/produce-video-visuals/references/cover-data-and-asset-lock.md",
        ".agents/skills/assemble-video-master/SKILL.md",
        ".agents/skills/assemble-video-master/references/remotion-assembly-and-render.md",
        ".agents/skills/assemble-video-master/references/final-mix-and-delivery.md",
    )

    def read(self, relative_path: str) -> str:
        return (ROOT / relative_path).read_text(encoding="utf-8")

    def assert_file_contains(self, relative_path: str, *needles: str) -> None:
        content = self.read(relative_path)
        for needle in needles:
            self.assertIn(needle, content, f"{relative_path} lacks {needle!r}")

    def test_project_rule_routes_the_cover_contract(self) -> None:
        self.assert_file_contains(
            "AGENTS.md",
            "workflow-state-machine.md",
            "produce-video-visuals",
            "assemble-video-master",
            "OPEN-00 -> S01",
        )

    def test_storyboard_has_one_opening_row_and_no_timeline_offset(self) -> None:
        self.assert_file_contains(
            ".agents/skills/build-video-storyboard/references/storyboard-contract.md",
            "cover-only-v1",
            "Add only row `OPEN-00`",
            "narration_start_frame = 0",
            "episode_opening_frames = first_sentence_end_frame",
            "final_master_frames = narration_master_frames",
            "no composition offset",
        )

    def test_visual_node_archives_without_generating_or_review_queueing_cover(self) -> None:
        self.assert_file_contains(
            ".agents/skills/produce-video-visuals/references/cover-data-and-asset-lock.md",
            "/Users/jackson/Desktop/video-edit/video-resource/cover.png",
            "no text overlay",
            "must not enter `visual_asset_review.queue`",
            "proportional scale-to-cover",
            "1920×1080",
        )

    def test_assembly_binds_cover_from_frame_zero(self) -> None:
        self.assert_file_contains(
            ".agents/skills/assemble-video-master/references/remotion-assembly-and-render.md",
            "cover-only-v1",
            "single archived cover raster",
            "composition frame 0",
            "first_sentence_end_frame",
            "final_master_frames = narration_master_frames",
            "`OPEN-00 → S01`",
        )

    def test_state_and_revoice_evidence_use_cover_only_fields(self) -> None:
        self.assert_file_contains(
            ".agents/skills/run-knowledge-video/references/workflow-state-machine.md",
            "cover-only-v1",
            "cover source/archive/normalized paths and SHA-256 values",
            "narration start frame `0`",
            "episode opening frames equal to `first_sentence_end_frame`",
        )
        self.assert_file_contains(
            ".agents/skills/run-knowledge-video/references/revoice-variant.md",
            "cover path/checksum",
            "first_sentence_end_frame",
            "final_master_frames = replacement_narration_master_frames",
        )

    def test_legacy_shared_inputs_appear_only_in_explicit_prohibitions(self) -> None:
        prohibited = re.compile(r"Do not|must not|不得|禁止|不再|旧|legacy", re.I)
        legacy_tokens = ("opening.mp4", "topicCover.png", "OPEN-01", "opening_visual_frames")
        for relative_path in self.CONTRACT_FILES:
            for line_number, line in enumerate(self.read(relative_path).splitlines(), 1):
                if any(token in line for token in legacy_tokens):
                    self.assertRegex(
                        line,
                        prohibited,
                        f"{relative_path}:{line_number} has an active legacy opening reference: {line}",
                    )

    def test_skill_frontmatter_remains_discoverable(self) -> None:
        skill = self.read(".agents/skills/run-knowledge-video/SKILL.md")
        frontmatter = skill.split("---", 2)[1]
        self.assertRegex(frontmatter, r"(?m)^name: [a-z0-9-]+$")
        description_match = re.search(r'(?m)^description: "([^"]+)"$', frontmatter)
        self.assertIsNotNone(description_match)
        self.assertTrue(description_match.group(1).startswith("Use when"))
        self.assertLessEqual(len(frontmatter), 1024)


if __name__ == "__main__":
    unittest.main()
