#!/usr/bin/env python3
"""Count spoken-script characters and estimate duration at six characters/second."""

from __future__ import annotations

import argparse
import json
import sys
import unicodedata


def is_counted_character(character: str) -> bool:
    """Return True for non-whitespace, non-punctuation characters."""

    return not character.isspace() and not unicodedata.category(character).startswith("P")


def analyze(text: str) -> dict[str, object]:
    count = sum(1 for character in text if is_counted_character(character))
    seconds = round(count / 6, 1)
    display_seconds: int | float = int(seconds) if seconds.is_integer() else seconds
    return {
        "text": text,
        "character_count": count,
        "suggested_seconds": display_seconds,
        "formula": f"{count} ÷ 6 = {display_seconds}秒",
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Ignore whitespace and Unicode punctuation, then divide the count by six."
    )
    parser.add_argument(
        "--text",
        action="append",
        help="Source segment to analyze. Repeat for multiple segments.",
    )
    args = parser.parse_args()

    texts = args.text if args.text else [sys.stdin.read()]
    results = [analyze(text) for text in texts]
    payload: object = results[0] if len(results) == 1 else results
    json.dump(payload, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
