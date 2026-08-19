from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest


SCRIPT_PATH = Path(__file__).with_name("record-generated-xuan-hybrid-qa.py")


def load_recorder():
    spec = importlib.util.spec_from_file_location("xuan_hybrid_recorder", SCRIPT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("recorder cannot be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class XuanHybridActionRoleTest(unittest.TestCase):
    def test_accepts_action_04_when_it_is_the_last_variant_of_five_states(self):
        recorder = load_recorder()
        self.assertTrue(recorder.is_action_variant({
            "role": "action-04",
            "state_index": 4,
            "state_count_total": 5,
        }))

    def test_rejects_role_and_index_mismatch(self):
        recorder = load_recorder()
        self.assertFalse(recorder.is_action_variant({
            "role": "action-03",
            "state_index": 4,
            "state_count_total": 5,
        }))

    def test_rejects_master_and_out_of_range_state(self):
        recorder = load_recorder()
        self.assertFalse(recorder.is_action_variant({
            "role": "base/master",
            "state_index": 0,
            "state_count_total": 5,
        }))
        self.assertFalse(recorder.is_action_variant({
            "role": "action-05",
            "state_index": 5,
            "state_count_total": 5,
        }))


if __name__ == "__main__":
    unittest.main()
