#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

from whiteboard_contract import read_json, resolve_within, validate_annotation


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--episode-workspace", required=True)
    parser.add_argument("annotation")
    args = parser.parse_args()
    root = Path(args.episode_workspace).resolve(strict=True)
    annotation_path = resolve_within(root, args.annotation, must_exist=True)
    annotation = validate_annotation(read_json(annotation_path), episode_workspace=root)
    print(json.dumps({
        "result": "pass",
        "contract_version": annotation["contract_version"],
        "shot_id": annotation["shot_id"],
        "element_count": len(annotation["elements"]),
        "total_frames": annotation["total_frames"],
        "final_hold_frames": annotation["final_hold_frames"],
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
