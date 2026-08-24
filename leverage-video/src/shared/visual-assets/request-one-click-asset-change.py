#!/usr/bin/env python3
"""Requeue one asset from a pending one-click exact visual list."""

from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import re


REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
GATE_PATH = REPOSITORY_ROOT / ".agents/skills/run-knowledge-video/scripts/validate_visual_approval_state.py"


def load_gate():
    spec = importlib.util.spec_from_file_location("visual_approval_gate", GATE_PATH)
    if spec is None or spec.loader is None:
        raise ValueError("visual approval gate cannot be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def request_change(args: argparse.Namespace) -> dict:
    relative = Path(args.episode_workspace)
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError("episode workspace must be repository-root-relative")
    workspace = (REPOSITORY_ROOT / relative).resolve(strict=True)
    workspace.relative_to(REPOSITORY_ROOT.resolve(strict=True))
    state_path = workspace / "schema/episode-state.json"
    if state_path.is_symlink() or not state_path.is_file():
        raise ValueError("episode state is missing or symbolic")
    state = json.loads(state_path.read_text(encoding="utf-8"))
    item = load_gate().record_one_click_changes_requested(
        state,
        args.asset_id,
        args.decision_message,
        args.decision_time,
    )
    temporary = state_path.with_suffix(".json.one-click-asset-change.tmp")
    if temporary.exists():
        raise ValueError("one-click asset change temporary path already exists")
    temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(state_path)
    return {
        "result": "pass",
        "asset_id": item["asset_id"],
        "status": item["status"],
        "current_phase": state["current_phase"],
        "prior_presented_map_sha256": state["superseded_artifacts"][-1][
            "prior_presented_map_sha256"
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("episode_workspace")
    parser.add_argument("asset_id")
    parser.add_argument("decision_message")
    parser.add_argument("decision_time")
    args = parser.parse_args()
    if not re.fullmatch(
        r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}",
        args.decision_time,
    ):
        raise SystemExit("decision_time must be ISO-8601 with offset")
    print(json.dumps(request_change(args), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
