#!/usr/bin/env python3
"""Requeue one asset from a pending one-click exact visual list."""

from __future__ import annotations

import argparse
import copy
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


def record_pre_final_change(
    state: dict,
    gate,
    asset_id: str,
    decision_message: str,
    decision_time: str,
) -> tuple[dict, dict]:
    """Requeue one generated family before the final exact list is presented."""
    if state.get("current_phase") != "visual_production":
        raise ValueError("episode is not in visual production")
    if not decision_message.strip():
        raise ValueError("change request message is empty")
    review = state.get("visual_asset_review")
    if (
        not isinstance(review, dict)
        or review.get("contract_version") != "visual-asset-review-v3"
        or review.get("mode") != "one_click_final_review_v1"
        or review.get("queue_generation_allowed") is not True
        or review.get("final_review") is not None
    ):
        raise ValueError("unpresented one-click visual queue is not active")
    queue = gate._queue(state)
    item = gate._find(queue, asset_id)
    if not isinstance(item, dict) or item.get("status") not in {
        "qa_passed_pending_final_review",
        "qa_failed_but_waived_once_pending_final_review",
    }:
        raise ValueError(f"asset is not an unpresented one-click QA pass: {asset_id}")

    affected_ids = {asset_id}
    pending = [asset_id]
    while pending:
        dependency_id = pending.pop()
        for candidate in queue:
            candidate_id = candidate.get("asset_id")
            if (
                candidate_id not in affected_ids
                and dependency_id in candidate.get("depends_on", [])
            ):
                affected_ids.add(candidate_id)
                pending.append(candidate_id)
    ordered_ids = [
        candidate["asset_id"] for candidate in queue
        if candidate.get("asset_id") in affected_ids
    ]
    prior_items = [
        copy.deepcopy(candidate) for candidate in queue
        if candidate.get("asset_id") in affected_ids
    ]
    record = {
        "record_type": "superseded_one_click_prefinal_visual_family",
        "reason": "user_requested_asset_pixel_revision_before_final_exact_list",
        "superseded_at": decision_time,
        "affected_asset_ids": ordered_ids,
        "preserved_unaffected_asset_count": len(queue) - len(affected_ids),
        "prior_queue_items": prior_items,
        "user_change_request": decision_message.strip(),
        "files_deleted": False,
        "preservation_policy": "preserve_exact_historical_bytes",
    }
    state.setdefault("superseded_artifacts", []).append(record)

    stale_exact_keys = {
        "path", "checksum_sha256", "measured_dimensions",
        "measured_aspect_ratio_relative_error", "generator",
        "source_approval_object", "composition_derivative_status",
        "actual_reference_inputs", "generation_lineage", "rejected_attempts",
        "technical_qa", "semantic_qa", "visible_text_qa", "style_qa",
        "continuity_qa", "visual_qa", "historical_identity_qa",
        "identity_qa", "qa_contract_version", "revision_source",
        "mechanical_qa_result", "user_mechanical_gate_override",
        "user_mechanical_gate_override_result", "waived_mechanical_gate_ids",
        "override_bound_artifacts", "original_qa_result",
        "pending_user_mechanical_gate_override",
    }
    stale_prefixes = (
        "approved_", "presented_", "batch_", "qa_evidence_", "prompt_",
        "base_prompt_", "style_", "generated_source_", "normalization_evidence_",
        "frame_manifest_", "scene_package_manifest_",
    )
    for candidate in queue:
        if candidate.get("asset_id") not in affected_ids:
            continue
        for key in list(candidate):
            if key in stale_exact_keys or key.startswith(stale_prefixes):
                candidate.pop(key, None)
        candidate["status"] = (
            "changes_requested" if candidate.get("asset_id") == asset_id
            else "pending_generation"
        )
        candidate["decision_message"] = decision_message.strip()
        candidate["decision_time"] = decision_time
        candidate.pop("is_revision", None)

    review["status"] = "in_progress"
    review["queue_generation_allowed"] = True
    review["current_asset_id"] = asset_id
    state["phase"] = "visual_production"
    state["current_phase"] = "visual_production"
    return item, record


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
    gate = load_gate()
    if state.get("current_phase") == "visual_production":
        item, superseded = record_pre_final_change(
            state,
            gate,
            args.asset_id,
            args.decision_message,
            args.decision_time,
        )
        change_scope = "unpresented_prefinal_asset_family"
    else:
        item = gate.record_one_click_changes_requested(
            state,
            args.asset_id,
            args.decision_message,
            args.decision_time,
        )
        superseded = state["superseded_artifacts"][-1]
        change_scope = "presented_final_exact_list_asset_family"
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
        "change_scope": change_scope,
        "affected_asset_ids": superseded["affected_asset_ids"],
        "prior_presented_map_sha256": superseded.get("prior_presented_map_sha256"),
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
