#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path


RULE_ID = "opening-topic-extraction-v1"
PREFIXES = (
    "苏格拉底的猫今天聊的是，",
    "苏格拉底的猫今天聊的是,",
)
TERMINAL_PUNCTUATION = "。！？!?"


def _failure(reason: str) -> dict[str, object]:
    return {
        "rule_id": RULE_ID,
        "status": "fail",
        "reason": reason,
        "exact_first_sentence": None,
        "captured_topic_text": None,
    }


def validate_text(text: str) -> dict[str, object]:
    starts = [position for prefix in PREFIXES if (position := text.find(prefix)) >= 0]
    if not starts:
        return _failure("required_prefix_missing")

    start = min(starts)
    if any(mark in text[:start] for mark in TERMINAL_PUNCTUATION):
        return _failure("required_prefix_is_not_first_complete_sentence")

    line_start = text.rfind("\n", 0, start) + 1
    if text[line_start:start].strip():
        return _failure("required_prefix_is_not_at_sentence_start")

    prefix = next(prefix for prefix in PREFIXES if text.startswith(prefix, start))
    terminal_positions = [
        position
        for mark in TERMINAL_PUNCTUATION
        if (position := text.find(mark, start + len(prefix))) >= 0
    ]
    if not terminal_positions:
        return _failure("first_sentence_terminal_punctuation_missing")

    end = min(terminal_positions)
    exact_first_sentence = text[start : end + 1]
    topic_text = text[start + len(prefix) : end].strip()
    if not topic_text:
        return _failure("topic_text_empty")
    if "\n" in exact_first_sentence or "\r" in exact_first_sentence:
        return _failure("ambiguous_multiline_first_sentence")

    return {
        "rule_id": RULE_ID,
        "status": "pass",
        "reason": None,
        "exact_first_sentence": exact_first_sentence,
        "captured_topic_text": topic_text,
    }


def validate_file(path: Path) -> dict[str, object]:
    if path.is_symlink() or not path.is_file():
        return _failure("candidate_must_be_a_real_regular_file")
    try:
        text = path.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError:
        return _failure("candidate_must_be_utf8_text")
    return validate_text(text)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate and extract the canonical knowledge-video opening topic."
    )
    parser.add_argument("candidate_path", type=Path)
    args = parser.parse_args()
    result = validate_file(args.candidate_path)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
