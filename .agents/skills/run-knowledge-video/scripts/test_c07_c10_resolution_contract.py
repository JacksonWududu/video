#!/usr/bin/env python3
"""Repository-level contract checks for resolved C-07 through C-10."""

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[4]


class C07C10ResolutionContractTest(unittest.TestCase):
    def read(self, relative_path: str) -> str:
        return (ROOT / relative_path).read_text(encoding="utf-8")

    def assert_contains(self, relative_path: str, *needles: str) -> None:
        content = self.read(relative_path)
        for needle in needles:
            self.assertIn(needle, content, f"{relative_path} lacks {needle!r}")

    def test_c07_ian_adapter_is_v3_bound_and_single_frame(self) -> None:
        self.assert_contains(
            ".agents/skills/ian-handdrawn-ppt/references/knowledge-video-frame.md",
            "ian-knowledge-video-frame-v1",
            "exactly one final 1920×1080 PNG",
            "per-shot-visual-direction-review-v3",
            "contact sheet is an outer Visual Asset Review artifact only",
            "repository-root-relative paths",
        )
        self.assert_contains(
            ".agents/skills/ian-handdrawn-ppt/scripts/validate_knowledge_video_frame.py",
            "visual direction review checksum is stale",
            "ordinary page shell",
            "exact approved Chinese",
        )

    def test_c08_current_writes_are_v3_and_legacy_is_read_only(self) -> None:
        self.assert_contains(
            "leverage-video/src/shared/visual-generation-routes/contract.mjs",
            "validateVisualDirectionArtifactPolicy",
            "artifact_mode !== 'current_v3'",
            "artifact_mode !== 'legacy_read_only'",
            "any reopened shot requires v3",
        )
        self.assert_contains(
            ".agents/skills/doodle-slides/SKILL.md",
            "不再是新建或修改知识视频分镜的可选路线",
            "历史只读证据",
            "ink-doodle-knowledge-card",
        )

    def test_c09_whiteboard_uses_direct_enum_and_disk_v3_binding(self) -> None:
        self.assert_contains(
            ".agents/skills/srt-whiteboard-animation/references/whiteboard-annotation-v2.schema.json",
            '"visible_text_mode": {"enum": ["none", "required"]}',
            '"visual_direction_review_sha256"',
            '"presented_map_sha256"',
            '"approved_text_placement"',
        )
        self.assert_contains(
            ".agents/skills/srt-whiteboard-animation/scripts/whiteboard_contract.py",
            "validate_visual_direction_binding",
            "sha256_file(review_path)",
            "does not equal v3",
            'root / "schema" / "episode-state.json"',
            "not the current episode-state artifact",
        )

    def test_c10_standard_and_revoice_share_fixed_audio_category(self) -> None:
        for path in (
            ".agents/skills/validate-video-narration/SKILL.md",
            ".agents/skills/validate-video-narration/references/audio-first-validation.md",
            ".agents/skills/run-knowledge-video/references/workflow-state-machine.md",
            ".agents/skills/run-knowledge-video/references/revoice-variant.md",
        ):
            self.assert_contains(path, "assets/audio/user-source/")
        self.assert_contains(
            ".agents/skills/validate-video-narration/SKILL.md",
            "sole user-source archive category",
            "never create `<episode-workspace>/audio/`",
        )


if __name__ == "__main__":
    unittest.main()
