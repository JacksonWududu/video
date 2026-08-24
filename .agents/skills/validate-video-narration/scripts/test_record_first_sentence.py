#!/usr/bin/env python3
from __future__ import annotations

import copy
import hashlib
import importlib.util
from pathlib import Path
import unittest


MODULE_PATH = Path(__file__).with_name("record_first_sentence.py")
SPEC = importlib.util.spec_from_file_location("record_first_sentence", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("cannot load first-sentence recorder")
RECORDER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RECORDER)


class FirstSentenceRecorderTests(unittest.TestCase):
    def record(self, text: str, expected_sha256: str | None = None):
        data = text.encode("utf-8")
        return data, RECORDER.record_first_sentence(
            data,
            candidate_path="episode/assets/narration/candidate.txt",
            expected_sha256=expected_sha256,
        )

    def test_accepts_arbitrary_natural_sentence_after_title(self) -> None:
        data, result = self.record(
            "习得性无助 口播稿\n\n机会已经来了，人为什么还是不想动？\n下一句。\n"
        )
        self.assertEqual(result["status"], "pass")
        self.assertEqual(result["exact_first_sentence"], "机会已经来了，人为什么还是不想动？")
        self.assertEqual(result["heading_mode"], "title_line_followed_by_blank")
        self.assertNotIn("captured_topic_text", result)
        self.assertEqual(result["topic_extraction"], "not_performed")
        self.assertEqual(
            data[result["byte_start"]:result["byte_end_exclusive"]].decode("utf-8"),
            result["exact_first_sentence"],
        )

    def test_accepts_legacy_brand_sentence_without_requiring_it(self) -> None:
        _, result = self.record("苏格拉底的猫今天聊的是，知行合一。\n下一句。")
        self.assertEqual(result["status"], "pass")
        self.assertEqual(result["brand_prefix_validation"], "not_applicable")

    def test_accepts_current_extra_comma_and_preserves_utf8_offsets(self) -> None:
        data, result = self.record(
            "习得性无助 口播稿\n\n苏格拉底的猫，今天聊的是，习得性无助。\n下一句。\n"
        )
        self.assertEqual(result["status"], "pass")
        self.assertEqual(result["byte_start"], len("习得性无助 口播稿\n\n".encode("utf-8")))
        self.assertEqual(result["byte_length"], len(result["exact_first_sentence"].encode("utf-8")))
        self.assertEqual(
            data[result["byte_start"]:result["byte_end_exclusive"]],
            result["exact_first_sentence"].encode("utf-8"),
        )

    def test_rejects_missing_complete_sentence_on_first_narration_line(self) -> None:
        _, result = self.record("主题 口播稿\n\n这一句跨了行\n到这里才结束。\n")
        self.assertEqual(result["status"], "fail")
        self.assertEqual(result["reason"], "first_complete_sentence_missing_on_first_narration_line")

    def test_rejects_stale_expected_checksum(self) -> None:
        _, result = self.record("任意首句。", expected_sha256="0" * 64)
        self.assertEqual(result["status"], "fail")
        self.assertEqual(result["reason"], "candidate_checksum_mismatch")

    def test_validate_record_rejects_wrong_offset_sha_and_text(self) -> None:
        data, record = self.record("标题 口播稿\n\n任意自然首句。\n")
        self.assertEqual(RECORDER.validate_record(data, record)["status"], "pass")

        wrong_range = copy.deepcopy(record)
        wrong_range["byte_end_exclusive"] -= len("。".encode("utf-8"))
        self.assertEqual(
            RECORDER.validate_record(data, wrong_range)["reason"],
            "record_sentence_slice_mismatch",
        )

        wrong_sha = copy.deepcopy(record)
        wrong_sha["candidate"]["checksum_sha256"] = hashlib.sha256(b"other").hexdigest()
        self.assertEqual(
            RECORDER.validate_record(data, wrong_sha)["reason"],
            "record_candidate_checksum_stale",
        )

        wrong_projected_sha = copy.deepcopy(record)
        wrong_projected_sha["candidate_checksum_sha256"] = hashlib.sha256(b"other").hexdigest()
        self.assertEqual(
            RECORDER.validate_record(data, wrong_projected_sha)["reason"],
            "record_candidate_checksum_projection_mismatch",
        )

        wrong_text = copy.deepcopy(record)
        wrong_text["exact_first_sentence"] = "另一句。"
        self.assertEqual(
            RECORDER.validate_record(data, wrong_text)["reason"],
            "record_sentence_slice_mismatch",
        )

        wrong_length = copy.deepcopy(record)
        wrong_length["byte_length"] += 1
        self.assertEqual(
            RECORDER.validate_record(data, wrong_length)["reason"],
            "record_byte_length_mismatch",
        )


if __name__ == "__main__":
    unittest.main()
