#!/usr/bin/env python3
"""Contract checks for the final caption-delivery choice."""

from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[4]


class CaptionDeliveryChoiceContractTest(unittest.TestCase):
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

    def test_project_instructions_route_the_caption_delivery_contract(self) -> None:
        self.assert_file_contains(
            "AGENTS.md",
            "final Caption Delivery Choice",
            "assemble-video-master",
            "deliver only selected full-master roles",
        )
        self.assert_file_excludes(
            "AGENTS.md",
            "caption_delivery.mode",
            "`caption_free_only` requires one delivered MP4",
            "The final master must be caption-free.",
        )
        self.assert_file_contains(
            ".agents/skills/run-knowledge-video/references/workflow-state-machine.md",
            "caption_delivery.mode",
            "caption_free_only",
            "captioned_only",
            "both",
            "1. 无字幕；2. 有字幕；3. 有字幕跟无字幕的视频都有",
            "active delivery transaction manifest",
        )
        self.assert_file_contains(
            ".agents/skills/assemble-video-master/references/final-mix-and-delivery.md",
            "one delivered MP4",
            "two delivered MP4s",
            "The complete master already contains the opening",
            "it is not a user deliverable",
        )

    def test_orchestrator_stops_before_render_until_choice_exists(self) -> None:
        self.assert_file_contains(
            ".agents/skills/run-knowledge-video/SKILL.md",
            "Caption Delivery Choice",
            "awaiting_caption_delivery_choice",
            "Do not start a final master or per-topic opening render",
            "1. 无字幕；2. 有字幕；3. 有字幕跟无字幕的视频都有",
        )
        state = self.read(
            ".agents/skills/run-knowledge-video/references/workflow-state-machine.md"
        )
        phase_order = (
            "composition_locked → awaiting_caption_delivery_choice → "
            "final_rendering → delivered"
        )
        self.assertIn(phase_order, state)
        self.assertIn("Do not infer a default", state)

    def test_state_machine_separates_delivery_roles_from_internal_opening_qa(self) -> None:
        content = self.read(
            ".agents/skills/run-knowledge-video/references/workflow-state-machine.md"
        )
        mapping = re.search(
            r"`caption_free_only` requires `([^`]+)`; "
            r"`captioned_only` requires `([^`]+)`; "
            r"`both` requires both master roles",
            content,
        )
        self.assertIsNotNone(mapping, "canonical mode-to-role mapping is missing")
        self.assertEqual(
            mapping.groups(),
            (
                "caption_free_master",
                "captioned_master",
            ),
        )
        self.assertIn("required_delivery_roles", content)
        self.assertIn("required_internal_qa_roles", content)
        self.assertIn("caption_free_opening", content)
        self.assertIn("captioned_opening", content)
        self.assertIn("render no unselected delivery role", content)
        self.assertIn("never appear in the delivery transaction manifest", content)
        self.assertIn("master that has the same caption role", content)

    def test_captioned_outputs_are_burned_in_but_have_no_subtitle_stream(self) -> None:
        self.assert_file_contains(
            ".agents/skills/assemble-video-master/references/remotion-assembly-and-render.md",
            "burned-in bottom narration captions",
            "exactly one caption component",
            "subtitle_stream_count: 0",
            "subtitle_sidecar_delivered: false",
        )

    def test_delivery_contract_is_mode_driven_and_versioned(self) -> None:
        self.assert_file_contains(
            ".agents/skills/assemble-video-master/references/final-mix-and-delivery.md",
            "caption-free-final",
            "captioned-final",
            "active delivery transaction",
            "required_delivery_roles",
            "one delivered MP4",
            "two delivered MP4s",
            "Do not copy or return the standalone per-topic opening",
            "not a raw directory listing",
            "Never remove, overwrite, or count unrelated or historical files",
        )
        self.assert_file_excludes(
            ".agents/skills/assemble-video-master/references/final-mix-and-delivery.md",
            "Return clickable links to every delivered master/opening pair",
        )

    def test_delivery_section_contains_no_standalone_opening_role(self) -> None:
        content = self.read(
            ".agents/skills/assemble-video-master/references/final-mix-and-delivery.md"
        )
        delivery = content.split("## Delivery", 1)[1]
        self.assertIn("required_delivery_roles", delivery)
        self.assertIn("complete full video", delivery)
        self.assertNotIn("caption_free_opening", delivery)
        self.assertNotIn("captioned_opening", delivery)
        self.assertNotIn("-opening-v", delivery)

    def test_both_mode_keeps_non_caption_inputs_identical(self) -> None:
        self.assert_file_contains(
            ".agents/skills/assemble-video-master/SKILL.md",
            "only the caption layer may differ",
            "both",
            "zero subtitle streams",
            "1. 无字幕；2. 有字幕；3. 有字幕跟无字幕的视频都有",
        )

    def test_revoice_variant_makes_a_fresh_delivery_choice(self) -> None:
        self.assert_file_contains(
            ".agents/skills/run-knowledge-video/references/revoice-variant.md",
            "fresh Caption Delivery Choice",
            "Do not inherit the parent's caption-delivery mode",
            "parent `required_delivery_roles`",
            "internal opening QA",
            "legacy_caption_free_only",
        )

    def test_choice_change_creates_a_scoped_transaction(self) -> None:
        self.assert_file_contains(
            ".agents/skills/run-knowledge-video/references/workflow-state-machine.md",
            "Caption Delivery Choice change",
            "create a new active delivery transaction manifest",
            "do not delete its historical versioned file",
        )

    def test_human_summary_explains_the_three_outputs(self) -> None:
        self.assert_file_contains(
            ".agents/skills/run-knowledge-video/references/whole-workflow-summary.md",
            "最终字幕交付选择",
            "仅无字幕",
            "仅有字幕",
            "两种都要",
            "完整成片本身已经包含片头",
            "独立片头只作为工作区内部 QA 文件",
            "1 个完整视频",
            "2 个完整视频",
        )

    def test_ui_metadata_mentions_the_final_choice(self) -> None:
        self.assert_file_contains(
            ".agents/skills/run-knowledge-video/agents/openai.yaml",
            "final caption-delivery choice",
        )
        self.assert_file_contains(
            ".agents/skills/assemble-video-master/agents/openai.yaml",
            "caption-free, captioned, or both",
            "final caption-delivery choice",
        )


if __name__ == "__main__":
    unittest.main()
