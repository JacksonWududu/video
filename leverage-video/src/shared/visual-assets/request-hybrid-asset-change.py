#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import re


REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
GATE_PATH = REPOSITORY_ROOT / ".agents/skills/run-knowledge-video/scripts/validate_visual_approval_state.py"


def resolve_root_relative(value: str, label: str) -> Path:
    candidate = Path(value)
    if candidate.is_absolute() or not value:
        raise ValueError(f"{label} must be root-relative")
    resolved = (REPOSITORY_ROOT / candidate).resolve(strict=True)
    resolved.relative_to(REPOSITORY_ROOT.resolve())
    if candidate.is_symlink() or resolved.is_symlink():
        raise ValueError(f"{label} must not be a symlink")
    return resolved


def load_gate():
    spec = importlib.util.spec_from_file_location("visual_approval_gate", GATE_PATH)
    if spec is None or spec.loader is None:
        raise ValueError("visual approval gate cannot be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def request_change(args: argparse.Namespace) -> dict:
    workspace = resolve_root_relative(args.episode_workspace, "episode workspace")
    state_file = workspace / "schema/episode-state.json"
    state = json.loads(state_file.read_text(encoding="utf-8"))
    if state.get("current_phase") != "awaiting_visual_asset_review":
        raise ValueError("episode is not awaiting visual asset review")
    review = state.get("visual_asset_review")
    manifest = review.get("active_batch") if isinstance(review, dict) else None
    if (
        not isinstance(review, dict)
        or review.get("mode") != "hybrid_batch_v1"
        or review.get("queue_generation_allowed") is not False
        or not isinstance(manifest, dict)
    ):
        raise ValueError("active hybrid visual batch is missing")

    gate = load_gate()
    item = gate.record_hybrid_changes_requested(
        state,
        args.asset_id,
        args.decision_message,
        args.decision_time,
    )
    state.setdefault("superseded_artifacts", []).append({
        "record_type": "superseded_visual_asset_batch",
        "reason": "user_requested_asset_pixel_revision_during_visual_asset_review",
        "superseded_at": args.decision_time,
        "prior_manifest_path": manifest.get("manifest_path"),
        "prior_manifest_file_checksum_sha256": manifest.get("manifest_file_checksum_sha256"),
        "prior_manifest_sha256": manifest.get("manifest_sha256"),
        "asset_ids": manifest.get("asset_ids"),
        "files_deleted": False,
        "user_change_request": args.decision_message,
    })
    review["queue_generation_allowed"] = True
    review["current_asset_id"] = args.asset_id
    state["current_phase"] = "visual_production"

    temporary = state_file.with_suffix(".json.hybrid-asset-change.tmp")
    if temporary.exists():
        raise ValueError("hybrid asset change temporary path already exists")
    temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(state_file)
    return {
        "result": "pass",
        "asset_id": item["asset_id"],
        "status": item["status"],
        "strict_review": item["strict_review"],
        "decision_message": item["decision_message"],
        "decision_time": item["decision_time"],
        "queue_generation_allowed": review["queue_generation_allowed"],
        "current_asset_id": review["current_asset_id"],
        "current_phase": state["current_phase"],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("episode_workspace")
    parser.add_argument("asset_id")
    parser.add_argument("decision_message")
    parser.add_argument("decision_time")
    args = parser.parse_args()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}", args.decision_time):
        raise SystemExit("decision_time must be ISO-8601 with offset")
    print(json.dumps(request_change(args), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
