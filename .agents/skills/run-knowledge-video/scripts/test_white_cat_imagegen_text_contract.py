#!/usr/bin/env python3
"""Cross-skill contract checks for resolved C-02 and C-03."""

import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[4]


class WhiteCatImagegenTextContractTest(unittest.TestCase):
    def read(self, relative_path: str) -> str:
        return (ROOT / relative_path).read_text(encoding="utf-8")

    def assert_file_contains(self, relative_path: str, *needles: str) -> None:
        content = self.read(relative_path)
        for needle in needles:
            self.assertIn(needle, content, f"{relative_path} lacks {needle!r}")

    def assert_file_excludes(self, relative_path: str, *needles: str) -> None:
        content = self.read(relative_path)
        for needle in needles:
            self.assertNotIn(needle, content, f"{relative_path} still contains {needle!r}")

    def test_catalog_scopes_text_free_policy_to_white_cat_ordinary_imagegen(self) -> None:
        catalog = json.loads(self.read(
            "leverage-video/src/shared/visual-generation-routes/catalog.json"
        ))
        routes = {route["route_id"]: route for route in catalog["routes"]}
        self.assertEqual(routes["imagegen"]["visible_text_policy"], "approved-raster-v1")
        self.assertEqual(
            routes["imagegen"]["white_cat_visible_text_policy"],
            "text-free-v1",
        )
        self.assertEqual(
            routes["xuan-paper-diorama"]["visible_text_policy"],
            "text-free-v1",
        )
        self.assertEqual(
            routes["xuan-paper-diorama"]["style_profile_id"],
            "xuan-paper-diorama",
        )
        self.assertEqual(routes["comic-imagegen"]["visible_text_policy"], "text-free-v1")
        self.assertEqual(
            routes["ian-handdrawn-ppt"]["visible_text_policy"],
            "approved-exact-text-raster-v1",
        )
        self.assertEqual(
            routes["doodle-slides"]["visible_text_policy"],
            "approved-exact-text-raster-v1",
        )
        self.assertEqual(routes["doodle-slides"]["selection_policy"], "legacy-read-only")
        self.assertEqual(
            routes["ink-doodle-knowledge-card"]["visible_text_policy"],
            "approved-exact-text-raster-v1",
        )
        self.assertEqual(
            routes["ink-doodle-knowledge-card"]["style_profile_id"],
            "ink-doodle-knowledge-card",
        )
        self.assertEqual(
            routes["srt-whiteboard-animation"]["visible_text_policy"],
            "whiteboard-annotation-v1",
        )

    def test_storyboard_and_visual_rules_have_one_route_resolved_decision(self) -> None:
        self.assert_file_contains(
            ".agents/skills/build-video-storyboard/references/storyboard-contract.md",
            "Ordinary `imagegen` with `white_cat_present: true` and every `xuan-paper-diorama` shot are unconditionally text-free",
            "`xuan-paper-diorama` never permits visible text",
            "There is no cross-route top-title whitelist",
            "Remotion must not create, rewrite, reposition, or remove it.",
        )
        self.assert_file_contains(
            ".agents/skills/produce-video-visuals/references/character-and-style-lock.md",
            "Apply this lock to ordinary `imagegen` shots",
            "and to every `xuan-paper-diorama` shot",
            "Do not create a second text-approval checkpoint",
            "never override the checksum-bound v3 row",
        )
        self.assert_file_excludes(
            ".agents/skills/produce-video-visuals/references/character-and-style-lock.md",
            "A storyboard's earlier label plan or approval is not approval",
            "It may be superseded at the visual layer without changing",
        )
        self.assert_file_contains(
            ".agents/skills/produce-video-visuals/references/visual-asset-review.md",
            "`imagegen` with `white_cat_present: true` must contain no visible",
            "`xuan-paper-diorama`",
            "Visual Asset Review verifies implementation only",
            "cannot change mode, copy, or placement without reopening v3",
        )

    def test_assembly_has_no_generic_top_title_authority(self) -> None:
        reference = (
            ".agents/skills/assemble-video-master/references/"
            "remotion-assembly-and-render.md"
        )
        self.assert_file_contains(
            reference,
            "Do not define or mount a generic top-title component.",
            "Do not recreate, edit, reposition, or remove it in Remotion.",
        )
        self.assert_file_excludes(
            reference,
            "Render a top title only when",
            "Remove titles that crowd the frame",
        )
        self.assert_file_contains(
            "leverage-video/src/shared/assembly-plan/build-assembly-plan.mjs",
            "assembly must not receive a generic top-title or timeline text overlay field",
            "timeline_text_overlays: []",
        )

    def test_audit_preserves_c02_and_c03_resolution_records(self) -> None:
        self.assert_file_contains(
            "docs/knowledge-video-rules-conflict-audit-2026-08-16.md",
            "C-02（已解决）：白猫普通 ImageGen 的可见文字权威",
            "C-03（已解决）：白猫普通 ImageGen 禁止顶部标题",
            "当前 10 组均已解决",
            "C-01 至 C-10 已于 2026-08-16 全部解决",
        )


if __name__ == "__main__":
    unittest.main()
