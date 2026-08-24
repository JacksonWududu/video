#!/usr/bin/env python3
"""Static contract checks for Per-Shot Visual Direction Review."""

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[4]


class PerShotVisualDirectionContractTest(unittest.TestCase):
    def assert_file_contains(self, relative_path: str, *needles: str) -> None:
        content = (ROOT / relative_path).read_text(encoding="utf-8")
        for needle in needles:
            self.assertIn(needle, content, f"{relative_path} lacks {needle!r}")

    def test_orchestrator_makes_visual_direction_a_pre_transition_gate(self) -> None:
        self.assert_file_contains(
            ".agents/skills/run-knowledge-video/SKILL.md",
            "Per-Shot Visual Direction Review",
            "before the visible-text batch gate and transition review",
            "per-shot-visual-direction-review-v3",
            "visible-text-batch-review-v1",
            "Only after phase `visible_text_review_approved`",
        )

    def test_v3_review_catalogs_active_routes_and_retires_comic_and_doodle(self) -> None:
        self.assert_file_contains(
            ".agents/skills/run-knowledge-video/SKILL.md",
            "visual-generation-route-catalog-v2",
            "visual-language-and-comic-routing.md",
            "`imagegen`",
            "`comic-imagegen`",
            "legacy read-only",
            "`ian-handdrawn-ppt`",
            "`ink-doodle-knowledge-card`",
            "`doodle-slides`",
            "镜头｜时长（秒）｜画面｜白猫｜分镜生成方式｜可见文字｜锁稿原文",
            "local-video-file",
        )

    def test_summary_form_is_checksum_bound_and_cannot_bypass_review(self) -> None:
        self.assert_file_contains(
            ".agents/skills/run-knowledge-video/SKILL.md",
            "visual-direction-review-form-v3",
            "visual-direction-form-submission-v3",
            "validate-submission.mjs",
            "form itself must not write episode files",
            "画面 change must reopen the affected row",
            "storyboard-shot-merge-request-v1",
            "validate-merge-request.mjs",
        )
        self.assert_file_contains(
            ".agents/skills/build-video-storyboard/references/storyboard-contract.md",
            "full-table and selected-row submission",
            "Batch edits affect only compatible rows",
            "whiteboard-clean-progressive",
            "preserves a compatible current treatment",
            "Reopen only the changed direction rows and their adjacent ordinary boundaries",
            "compact_after_merge",
            "all current active rows",
        )
        self.assert_file_contains(
            "leverage-video/src/shared/visual-direction-review-form/contract.mjs",
            "visual-direction-form-submission-v3",
            "local_video_source_path",
            "visual direction form submission is bound to a stale presented map",
            "visual direction form submission is bound to a stale storyboard checksum",
            "requires_visual_semantic_rebuild_and_represent",
            "selected route is incompatible",
            "requires_candidate_map_refresh",
            "storyboard-shot-merge-request-v1",
            "compact_after_merge",
        )

    def test_structural_merge_is_checksum_bound_and_forbidden_in_revoice(self) -> None:
        self.assert_file_contains(
            ".agents/skills/run-knowledge-video/references/workflow-state-machine.md",
            "storyboard-shot-merge-request-v1",
            "compact_after_merge",
            "Retain the first selected ID",
            "archive the complete old-to-new lineage",
            "results above five require a semantic split",
            "`OPEN-00` and `revoice_variant` remain immutable",
        )
        self.assert_file_contains(
            "leverage-video/src/shared/visual-direction-review-form/merge-request.schema.json",
            "storyboard-shot-merge-request-v1",
            "storyboard_checksum_sha256",
            "compact_after_merge",
        )

    def test_state_machine_records_direction_evidence_and_invalidates_stale_outputs(self) -> None:
        self.assert_file_contains(
            ".agents/skills/run-knowledge-video/references/workflow-state-machine.md",
            "per-shot-visual-direction-review-v3",
            "visual-language-catalog-v1",
            "presented_map_sha256",
            "completed unchanged historical v1/v2 evidence",
            "`comic-imagegen` and `doodle-slides` are legacy read-only",
            "revoice_variant",
        )

    def test_revoice_locks_current_mapping_or_requires_legacy_confirmation(self) -> None:
        self.assert_file_contains(
            ".agents/skills/run-knowledge-video/references/revoice-variant.md",
            "v1/v2/v3 direction-selection evidence",
            "legacy parent",
            "Visual Direction Review",
            "contains the retired `comic-imagegen` or `doodle-slides` route",
            "duration_seconds",
            "duration_in_frames",
        )

    def test_compact_workflow_and_metadata_advertise_the_gate(self) -> None:
        self.assert_file_contains(
            ".agents/skills/run-knowledge-video/references/whole-workflow-summary.md",
            "Per-Shot Visual Direction Review",
            "Complete Visible Text Batch Review",
            "`comic-imagegen` 仅保留历史只读解析",
        )
        self.assert_file_contains(
            ".agents/skills/run-knowledge-video/agents/openai.yaml",
            "v3 visual and semantic transitions",
        )

    def test_schema_version_policy_is_current_v3_or_explicit_legacy_read_only(self) -> None:
        self.assert_file_contains(
            ".agents/skills/run-knowledge-video/references/workflow-state-machine.md",
            "visual_direction_artifact_policy",
            "artifact_mode: current_v3",
            "artifact_mode: legacy_read_only",
            "Reopening any legacy shot requires a new v3 artifact",
        )
        self.assert_file_contains(
            ".agents/skills/run-knowledge-video/references/visual-language-and-comic-routing.md",
            "`doodle-slides` is retired",
            "unchanged historical evidence",
            "Ian remains the default structured recommendation",
            "ink-doodle-knowledge-card",
        )
        self.assert_file_contains(
            ".agents/skills/assemble-video-master/agents/openai.yaml",
            "current approved v3 visual-direction map",
            "legacy read-only input",
        )
        self.assert_file_contains(
            "leverage-video/src/shared/visual-generation-routes/contract.mjs",
            "validateVisualDirectionArtifactPolicy",
            "any reopened shot requires v3",
        )


if __name__ == "__main__":
    unittest.main()
