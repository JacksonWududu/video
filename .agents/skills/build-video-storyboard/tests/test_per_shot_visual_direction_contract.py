#!/usr/bin/env python3
"""Static contract checks for storyboard visual-direction gating."""

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[4]


class PerShotVisualDirectionContractTest(unittest.TestCase):
    def assert_file_contains(self, relative_path: str, *needles: str) -> None:
        content = (ROOT / relative_path).read_text(encoding="utf-8")
        for needle in needles:
            self.assertIn(needle, content, f"{relative_path} lacks {needle!r}")

    def test_skill_requires_visual_direction_before_transition_review(self) -> None:
        self.assert_file_contains(
            ".agents/skills/build-video-storyboard/SKILL.md",
            "per-shot-visual-direction-review-v3",
            "storyboard_construction → awaiting_visual_direction_review → visual_direction_review_approved → awaiting_transition_review → transition_review_approved → storyboard_qa_passed → awaiting_storyboard_review",
            "before Per-Boundary Transition Review",
            "`确认全部推荐`",
            "`默认`, `继续`, `你看着办`, general authorization, or Storyboard Review as a selection",
        )

    def test_skill_requires_explicit_v3_visual_text_and_route_choices(self) -> None:
        self.assert_file_contains(
            ".agents/skills/build-video-storyboard/SKILL.md",
            "Record each approved row's exact choice text/time/status",
            "comic treatment remains an `imagegen` treatment",
            "`comic-imagegen` is retired",
            "`imagegen`",
            "`xuan-paper-diorama` as an explicit, non-default narrative alternative",
            "`ian-handdrawn-ppt` as the structured default",
            "Never recommend Whiteboard by default",
            "Do not enter Transition Review, Storyboard Review, or visual production",
        )

    def test_summary_requires_approved_six_column_direction_fields(self) -> None:
        self.assert_file_contains(
            ".agents/skills/build-video-storyboard/references/storyboard-contract.md",
            "| 镜头 | 画面 | 白猫 | 生图方式 | 可见文字 | 锁稿原文 |",
            "`不适用`",
            "`固定封面（cover-only-v1）`",
            "must never be `待确认`, pending, incompatible, or checksum-stale",
            "per-shot-visual-direction-review-v3",
            "all current active rows",
            "storyboard-shot-merge-request-v1",
            "compact_after_merge",
        )

    def test_merge_requires_clean_contiguous_rows_and_semantic_rebuild(self) -> None:
        self.assert_file_contains(
            ".agents/skills/build-video-storyboard/SKILL.md",
            "validate-merge-request.mjs",
            "no dirty unsubmitted direction fields",
            "Concatenate exact `source_text` with no inserted bytes",
            "required character-state count exceeds five",
            "`OPEN-00` and `revoice_variant` are never mergeable",
        )

    def test_revisions_and_revoice_preserve_or_reopen_direction_evidence(self) -> None:
        self.assert_file_contains(
            ".agents/skills/build-video-storyboard/references/storyboard-contract.md",
            "complete approved white-cat/route/structure/treatment mapping",
            "legacy parent",
            "Visual Direction Review",
            "Any visual-contract change exits `revoice_variant`",
            "parent using retired `comic-imagegen` is read-only",
            "kind, options, duration seconds, duration frames",
        )

    def test_skill_metadata_advertises_visual_direction_review(self) -> None:
        self.assert_file_contains(
            ".agents/skills/build-video-storyboard/agents/openai.yaml",
            "v3 visual and semantic transitions",
            "$build-video-storyboard",
        )


if __name__ == "__main__":
    unittest.main()
