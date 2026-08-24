#!/usr/bin/env python3
"""Present or approve the one-click final exact visual hash list."""

from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
GATE_PATH = REPOSITORY_ROOT / ".agents/skills/run-knowledge-video/scripts/validate_visual_approval_state.py"


def load_gate():
    spec = importlib.util.spec_from_file_location("visual_approval_gate", GATE_PATH)
    if spec is None or spec.loader is None:
        raise ValueError("visual approval gate cannot be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["present", "approve"])
    parser.add_argument("episode_workspace")
    parser.add_argument("--presented-map-sha256")
    parser.add_argument("--decision-message")
    parser.add_argument("--decision-time")
    args = parser.parse_args()

    workspace = (REPOSITORY_ROOT / args.episode_workspace).resolve(strict=True)
    workspace.relative_to(REPOSITORY_ROOT)
    state_path = workspace / "schema/episode-state.json"
    state = json.loads(state_path.read_text(encoding="utf-8"))
    gate = load_gate()
    if args.command == "present":
        result = gate.present_one_click_final_visual_review(state)
    else:
        if not all((args.presented_map_sha256, args.decision_message, args.decision_time)):
            raise ValueError("approve requires exact map SHA-256, decision message, and decision time")
        result = gate.approve_one_click_final_visual_review(
            state,
            args.presented_map_sha256,
            args.decision_message,
            args.decision_time,
            repository_root=REPOSITORY_ROOT,
        )
    temporary = state_path.with_suffix(".json.one-click-final-review.tmp")
    if temporary.exists():
        raise ValueError("one-click final review temporary path already exists")
    temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(state_path)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
