#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import re
from typing import Any


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


def compact_storyboard_approval(review: dict[str, Any]) -> dict[str, Any]:
    return {
        "path": review.get("approved_path"),
        "checksum_sha256": review.get("approved_checksum_sha256"),
        "exact_decision_message": review.get("exact_decision_message"),
        "decided_at": review.get("decided_at"),
    }


def request_change(args: argparse.Namespace) -> dict[str, Any]:
    workspace = resolve_root_relative(args.episode_workspace, "episode workspace")
    state_file = workspace / "schema/episode-state.json"
    state = json.loads(state_file.read_text(encoding="utf-8"))
    if state.get("current_phase") != "awaiting_visual_asset_review":
        raise ValueError("episode is not awaiting visual asset review")
    storyboard_review = state.get("storyboard_review")
    active_storyboard = state.get("active_storyboard")
    if (
        not isinstance(storyboard_review, dict)
        or storyboard_review.get("status") != "approved"
        or not isinstance(active_storyboard, dict)
        or active_storyboard.get("status") != "approved"
    ):
        raise ValueError("approved storyboard evidence is missing")

    review = state.get("visual_asset_review")
    manifest = review.get("active_batch") if isinstance(review, dict) else None
    if not isinstance(manifest, dict):
        raise ValueError("active visual batch is missing")
    gate = load_gate()
    item = gate.record_hybrid_changes_requested(
        state,
        args.asset_id,
        args.decision_message,
        args.decision_time,
    )

    state.setdefault("superseded_artifacts", []).extend([
        {
            "record_type": "superseded_visual_asset_batch",
            "reason": "user_requested_storyboard_semantic_change_during_visual_asset_review",
            "superseded_at": args.decision_time,
            "prior_manifest_path": manifest.get("manifest_path"),
            "prior_manifest_file_checksum_sha256": manifest.get("manifest_file_checksum_sha256"),
            "prior_manifest_sha256": manifest.get("manifest_sha256"),
            "asset_ids": manifest.get("asset_ids"),
            "files_deleted": False,
            "user_change_request": args.decision_message,
        },
        {
            "record_type": "superseded_storyboard_review_approval",
            "reason": "S02 action-state semantic order requires revision",
            "superseded_at": args.decision_time,
            "prior_artifact_path": storyboard_review.get("approved_path"),
            "prior_artifact_checksum_sha256": storyboard_review.get("approved_checksum_sha256"),
            "prior_exact_decision_message": storyboard_review.get("exact_decision_message"),
            "prior_decided_at": storyboard_review.get("decided_at"),
            "affected_shot_ids": [item.get("shot_id")],
            "user_change_request": args.decision_message,
        },
    ])

    prior_approval = compact_storyboard_approval(storyboard_review)
    storyboard_review.update(
        status="changes_requested",
        change_request={
            "asset_id": args.asset_id,
            "shot_id": item.get("shot_id"),
            "exact_message": args.decision_message,
            "requested_at": args.decision_time,
            "reason": "requested_action_state_conflicts_with_approved_terminal_state",
        },
        superseded_approval=prior_approval,
    )
    for key in (
        "approved_path",
        "approved_checksum_sha256",
        "exact_decision_message",
        "decided_at",
    ):
        storyboard_review.pop(key, None)

    active_storyboard.update(
        status="changes_requested",
        superseded_approval={
            "path": active_storyboard.get("path"),
            "checksum_sha256": active_storyboard.get("checksum_sha256"),
            "approved_at": active_storyboard.get("approved_at"),
            "exact_approval_message": active_storyboard.get("exact_approval_message"),
        },
    )
    active_storyboard.pop("approved_at", None)
    active_storyboard.pop("exact_approval_message", None)

    review["queue_generation_allowed"] = False
    review["current_asset_id"] = args.asset_id
    state["current_phase"] = "storyboard_construction"
    state.setdefault("blockers", []).append({
        "type": "storyboard_action_order_revision_required",
        "recorded_at": args.decision_time,
        "shot_id": item.get("shot_id"),
        "asset_id": args.asset_id,
        "detail": "action-02 is already post-punishment; action-03 cannot become the punishment beat without replanning the final two states",
        "user_change_request": args.decision_message,
    })

    temporary = state_file.with_suffix(".json.storyboard-change.tmp")
    if temporary.exists():
        raise ValueError("storyboard change temporary path already exists")
    temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(state_file)
    return {
        "result": "pass",
        "asset_id": item["asset_id"],
        "asset_status": item["status"],
        "strict_review": item["strict_review"],
        "current_phase": state["current_phase"],
        "queue_generation_allowed": review["queue_generation_allowed"],
        "current_asset_id": review["current_asset_id"],
        "storyboard_review_status": storyboard_review["status"],
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
