#!/usr/bin/env python3
"""Contract checks for locked local scripts and selected narration-audio sources."""

from pathlib import Path
import json
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[4]


class LocalNarrationSourceContractTest(unittest.TestCase):
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

    def test_user_supplied_topic_remains_valid_but_script_bypass_is_removed(self) -> None:
        path = ".agents/skills/discover-video-topics/SKILL.md"
        self.assert_file_contains(
            path,
            "record `topic_source: user_supplied`",
            "local-script-resource-only-v1",
            "Pasted text alone is neither a narration candidate nor Gate 2 approval.",
        )
        self.assert_file_excludes(
            path,
            "If the user explicitly supplied a complete final script",
            "hand that script directly to `$validate-video-narration`",
        )

    def test_narration_origin_is_fixed_to_script_resource(self) -> None:
        state_machine = (
            ".agents/skills/run-knowledge-video/references/"
            "workflow-state-machine.md"
        )
        narration_skill = ".agents/skills/validate-video-narration/SKILL.md"
        self.assert_file_contains(
            state_machine,
            "local-script-resource-only-v1",
            "origin fixed to `script_resource`",
            "User-pasted narration is only proposed edit text",
        )
        self.assert_file_excludes(
            state_machine,
            "narration script origin (`script_resource` or `user_supplied`)",
            "A complete script explicitly supplied as final by the user",
        )
        self.assert_file_contains(
            narration_skill,
            "the candidate origin is always `script_resource`",
            "A statement that separately supplied text is final cannot approve",
        )
        self.assert_file_excludes(
            narration_skill,
            "Record whether the candidate came from `script_resource` or the user.",
            "For a user-supplied script",
        )

    def test_source_edit_restarts_unfinished_episode_at_gate_2(self) -> None:
        state_machine = (
            ".agents/skills/run-knowledge-video/references/"
            "workflow-state-machine.md"
        )
        self.assert_file_contains(
            state_machine,
            "revalidate the source path/checksum on resume and before every phase handoff",
            "preserve the superseded candidate",
            "restart at Gate 2",
            "invalidate the prior audit, approval, locked script, narration/audio validation",
        )
        self.assert_file_contains(
            ".agents/skills/validate-video-narration/SKILL.md",
            "a source checksum change invalidates the prior audit, Gate 2 approval",
            "audit the newly preserved candidate again",
        )

    def test_revised_completed_script_uses_fresh_new_video(self) -> None:
        orchestrator = ".agents/skills/run-knowledge-video/SKILL.md"
        summary = (
            ".agents/skills/run-knowledge-video/references/"
            "whole-workflow-summary.md"
        )
        self.assert_file_contains(
            orchestrator,
            "classify that request as `new_video`",
            "create a fresh episode workspace",
            "Keep the completed episode and all its artifacts unchanged.",
            "A history strikethrough remains informational",
        )
        self.assert_file_contains(
            summary,
            "应启动标准 `new_video`",
            "已完成 episode 继续绑定其归档锁稿",
            "同一题目在历史记录中的删除线仅作提示",
        )

    def test_wording_changes_cannot_use_revoice_variant(self) -> None:
        self.assert_file_contains(
            ".agents/skills/run-knowledge-video/SKILL.md",
            "Any narration-wording change is outside `revoice_variant`.",
            "use the standard `new_video` route",
        )
        self.assert_file_contains(
            ".agents/skills/run-knowledge-video/references/workflow-state-machine.md",
            "This route is never `revoice_variant` because revoice requires identical words.",
        )
        self.assert_file_contains(
            ".agents/skills/run-knowledge-video/references/revoice-variant.md",
            "start a standard `new_video` in a fresh workspace",
            "preserve the completed parent unchanged",
        )

    def test_audio_uses_the_script_resolved_topic_folder(self) -> None:
        self.assert_file_contains(
            ".agents/skills/validate-video-narration/SKILL.md",
            "use only the real topic folder already resolved during script lookup",
            "Do not scan sibling or unrelated folders.",
            "must match the current locked checksum",
        )
        self.assert_file_contains(
            ".agents/skills/run-knowledge-video/SKILL.md",
            "hand the already resolved topic folder and locked script",
        )

    def test_standard_route_supports_explicit_edge_tts_source(self) -> None:
        state_machine = (
            ".agents/skills/run-knowledge-video/references/"
            "workflow-state-machine.md"
        )
        self.assert_file_contains(
            state_machine,
            "narration-audio-source-selection-v1",
            "`colocated_voice` or `edge_tts`",
            "zh-CN-YunjianNeural",
            "`+20%`",
            "never silently fall back",
        )
        self.assert_file_contains(
            ".agents/skills/validate-video-narration/SKILL.md",
            "scripts/synthesize_edge_tts.py",
            "zh-CN-YunjianNeural",
            "`+20%`",
        )

    def test_edge_tts_adapter_has_deterministic_dry_run(self) -> None:
        adapter = ROOT / ".agents/skills/validate-video-narration/scripts/synthesize_edge_tts.py"
        self.assertTrue(adapter.is_file())
        with tempfile.TemporaryDirectory() as temp_dir:
            text_path = Path(temp_dir) / "locked.txt"
            output_path = Path(temp_dir) / "voice.mp3"
            metadata_path = Path(temp_dir) / "word-boundaries.jsonl"
            text_path.write_text("第一句。\n第二句。", encoding="utf-8")
            result = subprocess.run(
                [
                    "python3",
                    str(adapter),
                    "--text-file",
                    str(text_path),
                    "--output",
                    str(output_path),
                    "--metadata-output",
                    str(metadata_path),
                    "--voice",
                    "zh-CN-YunjianNeural",
                    "--rate=+20%",
                    "--dry-run",
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            record = json.loads(result.stdout)
            self.assertEqual(record["provider"], "edge-tts")
            self.assertEqual(record["voice"], "zh-CN-YunjianNeural")
            self.assertEqual(record["rate"], "+20%")
            self.assertEqual(record["metadata_output"], str(metadata_path.resolve()))
            self.assertFalse(output_path.exists())
            self.assertFalse(metadata_path.exists())

    def test_audit_records_c01_as_resolved(self) -> None:
        self.assert_file_contains(
            "docs/knowledge-video-rules-conflict-audit-2026-08-16.md",
            "C-01（已解决）：统一使用本地原稿",
            "按 `local-script-resource-only-v1` 解决",
            "当前 10 组均已解决",
        )


if __name__ == "__main__":
    unittest.main()
