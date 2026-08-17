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
