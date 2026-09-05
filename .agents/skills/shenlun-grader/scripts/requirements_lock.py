#!/usr/bin/env python3

import argparse
import sys

from validate_case import expected_requirements_lock, load_json


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Print the answer-independent SHA-256 lock for prompt requirements."
    )
    parser.add_argument("case")
    args = parser.parse_args(argv)
    try:
        case = load_json(args.case)
        if not isinstance(case, dict):
            raise ValueError("case root must be an object")
        if not isinstance(case.get("prompt"), str) or not case["prompt"].strip():
            raise ValueError("case must contain an available prompt")
        if not isinstance(case.get("prompt_requirements"), list):
            raise ValueError("case must contain a prompt_requirements array")
        print(expected_requirements_lock(case))
    except (OSError, UnicodeError, ValueError, OverflowError, RecursionError) as error:
        print(f"requirements_lock=fail: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
