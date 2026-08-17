#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest


MODULE_PATH = Path(__file__).with_name("validate_opening_topic.py")
SPEC = importlib.util.spec_from_file_location("validate_opening_topic", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("cannot load opening-topic validator")
VALIDATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VALIDATOR)


class OpeningTopicValidatorTests(unittest.TestCase):
    def test_accepts_canonical_chinese_comma_and_preserves_topic(self) -> None:
        result = VALIDATOR.validate_text(
            "[知行合一] 口播稿\n\n苏格拉底的猫今天聊的是，王阳明的“知行合一”。\n下一句。"
        )
        self.assertEqual(result["status"], "pass")
        self.assertEqual(result["captured_topic_text"], "王阳明的“知行合一”")
        self.assertEqual(
            result["exact_first_sentence"],
            "苏格拉底的猫今天聊的是，王阳明的“知行合一”。",
        )

    def test_accepts_ascii_comma(self) -> None:
        result = VALIDATOR.validate_text("苏格拉底的猫今天聊的是,知行合一！")
        self.assertEqual(result["status"], "pass")
        self.assertEqual(result["captured_topic_text"], "知行合一")

    def test_rejects_retired_opening(self) -> None:
        result = VALIDATOR.validate_text("苏格拉底的猫今天想聊的，是知行合一。")
        self.assertEqual(result["status"], "fail")
        self.assertEqual(result["reason"], "required_prefix_missing")

    def test_rejects_empty_topic(self) -> None:
        result = VALIDATOR.validate_text("苏格拉底的猫今天聊的是，。")
        self.assertEqual(result["status"], "fail")
        self.assertEqual(result["reason"], "topic_text_empty")

    def test_rejects_when_another_sentence_precedes_opening(self) -> None:
        result = VALIDATOR.validate_text(
            "这是第一句。苏格拉底的猫今天聊的是，知行合一。"
        )
        self.assertEqual(result["status"], "fail")
        self.assertEqual(
            result["reason"], "required_prefix_is_not_first_complete_sentence"
        )

    def test_rejects_prefix_embedded_inside_other_text(self) -> None:
        result = VALIDATOR.validate_text(
            "旁白：苏格拉底的猫今天聊的是，知行合一。"
        )
        self.assertEqual(result["status"], "fail")
        self.assertEqual(result["reason"], "required_prefix_is_not_at_sentence_start")


if __name__ == "__main__":
    unittest.main()
