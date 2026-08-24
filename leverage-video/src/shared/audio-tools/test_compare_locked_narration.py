import importlib.util
import json
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("compare-locked-narration.py")
SPEC = importlib.util.spec_from_file_location("compare_locked_narration", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class CompareLockedNarrationTest(unittest.TestCase):
    def test_keeps_bracketed_archive_header_compatibility(self) -> None:
        transcript = json.dumps({"segments": [{"text": "知行合一"}]}).encode()
        result = MODULE.compare("[归档标题]\n知行合一。".encode(), transcript)
        self.assertTrue(result["exact_match"])

    def test_strips_plain_title_followed_by_blank_line(self) -> None:
        transcript = json.dumps({"segments": [{"text": "知行合一"}]}).encode()
        result = MODULE.compare("普通标题\n\n知行合一。".encode(), transcript)
        self.assertTrue(result["exact_match"])
        self.assertEqual(result["expected_character_count"], 4)

    def test_does_not_strip_narration_without_title_separator(self) -> None:
        locked = "正文第一行。\n正文第二行。"
        transcript = json.dumps({"segments": [{"text": locked}]}).encode()
        result = MODULE.compare(locked.encode(), transcript)
        self.assertTrue(result["exact_match"])
        self.assertEqual(result["expected_character_count"], 10)

    def test_exact_match_after_punctuation_normalization(self) -> None:
        transcript = json.dumps({"segments": [{"text": "知行合一"}]}).encode()
        result = MODULE.compare("知行合一。".encode(), transcript)
        self.assertTrue(result["exact_match"])
        self.assertEqual(result["mismatch_block_count"], 0)

    def test_does_not_hide_number_or_homophone_changes(self) -> None:
        transcript = json.dumps({"segments": [{"text": "十一只猫"}]}).encode()
        result = MODULE.compare("11只猫".encode(), transcript)
        self.assertFalse(result["exact_match"])
        self.assertGreater(result["mismatch_block_count"], 0)


if __name__ == "__main__":
    unittest.main()
