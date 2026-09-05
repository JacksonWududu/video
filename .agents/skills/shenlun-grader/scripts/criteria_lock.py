#!/usr/bin/env python3

import argparse
import json
import sys

from validate_case import expected_criteria_lock, load_json


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Print the answer-independent SHA-256 lock for a Shenlun criterion map."
    )
    parser.add_argument("case")
    args = parser.parse_args(argv)
    try:
        case = load_json(args.case)
        if not isinstance(case, dict):
            raise ValueError("case root must be an object")
        if not isinstance(case.get("criteria"), list) or not case["criteria"]:
            raise ValueError("case must contain a non-empty criteria array")
        print(expected_criteria_lock(case))
    except (OSError, UnicodeError, ValueError, OverflowError, RecursionError) as error:
        print(f"criteria_lock=fail: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
