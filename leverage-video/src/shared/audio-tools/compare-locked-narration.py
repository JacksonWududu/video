#!/usr/bin/env python3
"""Compare locked narration with local ASR without episode-specific constants."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def strip_optional_archive_header(text: str) -> str:
    bracketed = re.sub(r"^\[[^\n]+\][^\n]*\n+", "", text, count=1)
    if bracketed != text:
        return bracketed
    return re.sub(
        r"^[^\r\n]*\S[^\r\n]*\r?\n(?:[ \t]*\r?\n)+",
        "",
        text,
        count=1,
    )


def normalize_text(text: str) -> str:
    return "".join(
        char
        for char in text
        if not unicodedata.category(char).startswith("P")
        and not unicodedata.category(char).startswith("Z")
        and not char.isspace()
    )


def transcript_text(payload: dict) -> str:
    segments = payload.get("segments")
    if not isinstance(segments, list):
        raise ValueError("transcript JSON requires a segments array")
    values: list[str] = []
    for index, segment in enumerate(segments):
        value = segment.get("text") if isinstance(segment, dict) else None
        if not isinstance(value, str):
            raise ValueError(f"segment {index} requires text")
        values.append(value)
    return "".join(values)


def diff_blocks(expected: str, observed: str) -> list[dict]:
    matcher = SequenceMatcher(None, expected, observed, autojunk=False)
    return [
        {
            "tag": tag,
            "expected_text": expected[i1:i2],
            "observed_text": observed[j1:j2],
            "expected_range": [i1, i2],
            "observed_range": [j1, j2],
        }
        for tag, i1, i2, j1, j2 in matcher.get_opcodes()
        if tag != "equal"
    ]


def compare(locked_bytes: bytes, transcript_bytes: bytes) -> dict:
    locked = normalize_text(strip_optional_archive_header(locked_bytes.decode("utf-8")))
    observed = normalize_text(transcript_text(json.loads(transcript_bytes.decode("utf-8"))))
    mismatches = diff_blocks(locked, observed)
    return {
        "comparison_rule": "locked-narration-vs-local-asr-exact-text-v1",
        "locked_script_checksum_sha256": sha256_bytes(locked_bytes),
        "transcript_checksum_sha256": sha256_bytes(transcript_bytes),
        "normalization": {
            "optional_archive_header_removed": True,
            "unicode_punctuation_removed": True,
            "unicode_separators_removed": True,
            "whitespace_removed": True,
            "number_substitutions": False,
            "phonetic_equivalence_accepted": False,
        },
        "expected_character_count": len(locked),
        "observed_character_count": len(observed),
        "exact_match": locked == observed,
        "similarity_ratio": SequenceMatcher(None, locked, observed, autojunk=False).ratio(),
        "mismatch_block_count": len(mismatches),
        "mismatches": mismatches,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("locked_script", type=Path)
    parser.add_argument("transcript_json", type=Path)
    parser.add_argument("output_json", type=Path)
    args = parser.parse_args()
    result = compare(args.locked_script.read_bytes(), args.transcript_json.read_bytes())
    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output_json.with_suffix(f"{args.output_json.suffix}.tmp")
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(args.output_json)


if __name__ == "__main__":
    main()
