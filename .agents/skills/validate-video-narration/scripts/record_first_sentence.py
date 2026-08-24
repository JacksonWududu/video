#!/usr/bin/env python3
"""Record one exact first spoken sentence without enforcing brand wording."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
from typing import Any


RULE_ID = "opening-first-sentence-record-v1"
TERMINATORS = frozenset("。！？!?")
CLOSERS = frozenset("”’」』】）》〉〕〗〙〛")
HEADING_SUFFIXES = ("口播稿", "旁白稿", "解说稿")
SHA256 = re.compile(r"^[a-f0-9]{64}$")


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _failure(reason: str, **details: Any) -> dict[str, Any]:
    return {
        "rule_id": RULE_ID,
        "status": "fail",
        "reason": reason,
        **details,
    }


def _line_records(text: str) -> list[tuple[int, int, str]]:
    records: list[tuple[int, int, str]] = []
    offset = 0
    for raw in text.splitlines(keepends=True):
        content = raw.rstrip("\r\n")
        records.append((offset, offset + len(content), content))
        offset += len(raw)
    if text and (not records or offset < len(text)):
        records.append((offset, len(text), text[offset:]))
    return records


def _leading_content_index(line: str) -> int:
    return len(line) - len(line.lstrip("\ufeff \t"))


def record_first_sentence(
    data: bytes,
    *,
    candidate_path: str,
    expected_sha256: str | None = None,
) -> dict[str, Any]:
    checksum = _sha256(data)
    if expected_sha256 is not None:
        if not SHA256.fullmatch(expected_sha256):
            return _failure("expected_sha256_invalid", candidate_path=candidate_path)
        if checksum != expected_sha256:
            return _failure(
                "candidate_checksum_mismatch",
                candidate_path=candidate_path,
                expected_sha256=expected_sha256,
                actual_sha256=checksum,
            )
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return _failure(
            "candidate_is_not_utf8",
            candidate_path=candidate_path,
            candidate_checksum_sha256=checksum,
        )
    lines = _line_records(text)
    first_nonempty_index = next(
        (index for index, (_, _, line) in enumerate(lines) if line.strip("\ufeff \t")),
        None,
    )
    if first_nonempty_index is None:
        return _failure(
            "candidate_has_no_spoken_sentence",
            candidate_path=candidate_path,
            candidate_checksum_sha256=checksum,
        )

    first_line = lines[first_nonempty_index][2]
    first_visible = first_line[_leading_content_index(first_line):].strip()
    heading_mode = "none"
    narration_line_index = first_nonempty_index
    if first_visible.endswith(HEADING_SUFFIXES):
        immediate_next = first_nonempty_index + 1
        if immediate_next < len(lines) and not lines[immediate_next][2].strip():
            narration_line_index = next(
                (
                    index
                    for index in range(immediate_next + 1, len(lines))
                    if lines[index][2].strip()
                ),
                -1,
            )
            if narration_line_index < 0:
                return _failure(
                    "heading_has_no_spoken_sentence",
                    candidate_path=candidate_path,
                    candidate_checksum_sha256=checksum,
                )
            heading_mode = "title_line_followed_by_blank"

    line_start, _, narration_line = lines[narration_line_index]
    leading = _leading_content_index(narration_line)
    spoken_line = narration_line[leading:]
    terminator_index = next(
        (index for index, character in enumerate(spoken_line) if character in TERMINATORS),
        None,
    )
    if terminator_index is None:
        return _failure(
            "first_complete_sentence_missing_on_first_narration_line",
            candidate_path=candidate_path,
            candidate_checksum_sha256=checksum,
            heading_mode=heading_mode,
        )
    sentence_end = terminator_index + 1
    while sentence_end < len(spoken_line) and spoken_line[sentence_end] in CLOSERS:
        sentence_end += 1
    exact_sentence = spoken_line[:sentence_end]
    char_start = line_start + leading
    char_end = char_start + sentence_end
    byte_start = len(text[:char_start].encode("utf-8"))
    byte_end = len(text[:char_end].encode("utf-8"))
    if data[byte_start:byte_end].decode("utf-8") != exact_sentence:
        return _failure(
            "utf8_byte_slice_inconsistent",
            candidate_path=candidate_path,
            candidate_checksum_sha256=checksum,
        )
    return {
        "rule_id": RULE_ID,
        "status": "pass",
        "candidate_checksum_sha256": checksum,
        "candidate": {
            "path": candidate_path,
            "checksum_sha256": checksum,
            "byte_size": len(data),
        },
        "heading_mode": heading_mode,
        "exact_first_sentence": exact_sentence,
        "byte_start": byte_start,
        "byte_end_exclusive": byte_end,
        "byte_length": byte_end - byte_start,
        "brand_prefix_validation": "not_applicable",
        "topic_extraction": "not_performed",
    }


def validate_record(data: bytes, record: dict[str, Any]) -> dict[str, Any]:
    if record.get("rule_id") != RULE_ID or record.get("status") != "pass":
        return _failure("record_contract_invalid")
    candidate = record.get("candidate")
    if not isinstance(candidate, dict) or candidate.get("checksum_sha256") != _sha256(data):
        return _failure("record_candidate_checksum_stale")
    if record.get("candidate_checksum_sha256") != candidate.get("checksum_sha256"):
        return _failure("record_candidate_checksum_projection_mismatch")
    start = record.get("byte_start")
    end = record.get("byte_end_exclusive")
    if not isinstance(start, int) or not isinstance(end, int) or start < 0 or end <= start or end > len(data):
        return _failure("record_byte_range_invalid")
    try:
        sliced = data[start:end].decode("utf-8")
    except UnicodeDecodeError:
        return _failure("record_byte_range_not_utf8")
    if sliced != record.get("exact_first_sentence"):
        return _failure("record_sentence_slice_mismatch")
    if record.get("byte_length") != end - start:
        return _failure("record_byte_length_mismatch")
    if record.get("brand_prefix_validation") != "not_applicable":
        return _failure("record_brand_validation_must_be_not_applicable")
    if record.get("topic_extraction") != "not_performed":
        return _failure("record_topic_extraction_must_be_not_performed")
    return {"rule_id": RULE_ID, "status": "pass"}


def _read_candidate(path: Path) -> bytes:
    if path.is_symlink() or not path.is_file():
        raise ValueError("candidate must be a regular non-symlink file")
    return path.read_bytes()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("candidate_path")
    parser.add_argument("--expected-sha256")
    args = parser.parse_args()
    candidate = Path(args.candidate_path)
    try:
        data = _read_candidate(candidate)
        result = record_first_sentence(
            data,
            candidate_path=args.candidate_path,
            expected_sha256=args.expected_sha256,
        )
    except (OSError, ValueError) as error:
        result = _failure("candidate_read_failed", candidate_path=args.candidate_path, detail=str(error))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["status"] == "pass" else 1


if __name__ == "__main__":
    sys.exit(main())
