from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest


SCRIPT_PATH = Path(__file__).with_name("record-generated-ian-hybrid-qa.py")


def load_recorder():
    spec = importlib.util.spec_from_file_location("ian_hybrid_recorder", SCRIPT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("recorder cannot be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class IanHybridStrictRevisionTest(unittest.TestCase):
    def test_accepts_changes_requested_strict_revision(self):
        recorder = load_recorder()
        self.assertTrue(recorder.is_strict_revision_candidate({
            "strict_review": True,
            "is_revision": True,
            "status": "changes_requested",
        }))

    def test_rejects_ordinary_strict_item(self):
        recorder = load_recorder()
        self.assertFalse(recorder.is_strict_revision_candidate({
            "strict_review": True,
            "is_revision": False,
            "status": "changes_requested",
        }))


if __name__ == "__main__":
    unittest.main()
