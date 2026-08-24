#!/usr/bin/env python3
"""Static cross-workflow checks for complete-map visible-text approval."""

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[4]


class VisibleTextBatchReviewContractTest(unittest.TestCase):
    def read(self, relative_path: str) -> str:
        return (ROOT / relative_path).read_text(encoding="utf-8")

    def assert_contains(self, relative_path: str, *needles: str) -> None:
        content = self.read(relative_path)
        for needle in needles:
            self.assertIn(needle, content, f"{relative_path} lacks {needle!r}")

    def test_state_machine_owns_one_complete_map_gate(self) -> None:
        self.assert_contains(
            ".agents/skills/run-knowledge-video/references/workflow-state-machine.md",
            "visible-text-batch-review-v1",
            "concise-summary-visible-text-v1",
            "awaiting_visible_text_review",
            "visible_text_review_approved",
            "row_approval_mode: forbidden_batch_only",
            "row_by_row_approval_performed: false",
            "A one-click policy cannot satisfy or bypass this gate",
        )

    def test_storyboard_contract_forbids_per_shot_text_approval(self) -> None:
        for relative_path in (
            ".agents/skills/build-video-storyboard/SKILL.md",
            ".agents/skills/build-video-storyboard/references/storyboard-contract.md",
        ):
            self.assert_contains(
                relative_path,
                "visible-text-batch-review-v1",
                "concise-summary-visible-text-v1",
                "complete",
                "per-shot visible-text approval",
            )

    def test_mechanical_consumers_require_current_batch_approval(self) -> None:
        self.assert_contains(
            "leverage-video/src/shared/scene-transitions/build-review-proposal.mjs",
            "validateApprovedVisibleTextReviewState",
            "visible_text_review_approved",
        )
        self.assert_contains(
            "leverage-video/src/shared/storyboard/validate-final-storyboard.mjs",
            "validateApprovedVisibleTextReviewState",
        )
        self.assert_contains(
            "leverage-video/src/shared/visible-text-review/contract.mjs",
            "complete_active_generated_shot_visible_text_map",
            "forbidden_batch_only",
            "visible-text rows must not carry per-shot approval evidence",
        )

    def test_one_click_policy_has_no_visible_text_preauthorization(self) -> None:
        policy_contract = self.read(
            "leverage-video/src/shared/workflow-approval/contract.mjs"
        )
        self.assertNotIn("visible_text_approval", policy_contract)
        self.assert_contains(
            "leverage-video/src/shared/workflow-approval/contract.test.mjs",
            "one-click policy cannot preauthorize visible-text approval",
        )


if __name__ == "__main__":
    unittest.main()
