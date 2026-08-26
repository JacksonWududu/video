#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
from typing import Any


REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
MAX_AUTOMATIC_REJECTED_GENERATIONS = 3
STOP_STATUS = "stopped_user_takeover_required"
GENERATED_STORYBOARD_IMAGE_ROUTES = {
    "imagegen",
    "xuan-paper-diorama",
    "ian-handdrawn-ppt",
    "ink-doodle-knowledge-card",
    "srt-whiteboard-animation",
}
ACTIVE_GENERATION_STATUSES = {
    "pending_generation",
    "changes_requested",
    "awaiting_batch_qa",
    "awaiting_user_approval",
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_root_relative(value: str, label: str) -> Path:
    candidate = Path(value)
    if candidate.is_absolute() or not value:
        raise ValueError(f"{label} must be root-relative")
    joined = REPOSITORY_ROOT / candidate
    if joined.is_symlink():
        raise ValueError(f"{label} must be a regular non-symlink file")
    resolved = joined.resolve(strict=True)
    resolved.relative_to(REPOSITORY_ROOT.resolve())
    if resolved.is_symlink() or not resolved.is_file():
        raise ValueError(f"{label} must be a regular non-symlink file")
    return resolved


def generation_attempt_scope_id(item: dict[str, Any]) -> str:
    explicit = item.get("generation_attempt_scope_id")
    if isinstance(explicit, str) and explicit.strip():
        return explicit
    shot_id = item.get("shot_id")
    role = item.get("role")
    if isinstance(shot_id, str) and shot_id and isinstance(role, str) and role:
        return f"{shot_id}:{role}"
    asset_id = item.get("asset_id")
    if not isinstance(asset_id, str) or not asset_id:
        raise ValueError("image generation failure target lacks a stable logical-asset scope")
    return asset_id


def apply_failure_control(
    item: dict[str, Any],
    review: dict[str, Any],
    failure: dict[str, Any],
) -> dict[str, Any]:
    existing_control = item.get("image_generation_attempt_control", {})
    if existing_control.get("automatic_retry_status") == STOP_STATUS:
        raise ValueError("automatic image retry already stopped; user takeover required")
    reason = failure.get("failure_reason")
    if not isinstance(reason, str) or not reason.strip():
        raise ValueError("image generation QA failure reason is empty")
    output_checksum = failure.get("output", {}).get("checksum_sha256")
    if not isinstance(output_checksum, str) or re.fullmatch(r"[0-9a-f]{64}", output_checksum) is None:
        raise ValueError("image generation QA failure output checksum is invalid")

    scope_id = generation_attempt_scope_id(item)
    item["generation_attempt_scope_id"] = scope_id
    history = item.setdefault("image_generation_qa_failures", [])
    if any(
        existing.get("output", {}).get("checksum_sha256") == output_checksum
        for existing in history
    ):
        raise ValueError("image generation QA failure output was already recorded")
    recorded_failure = {
        **failure,
        "failure_reason": reason.strip(),
        "attempt_number": len(history) + 1,
    }
    history.append(recorded_failure)
    rejected_count = len(history)
    stopped = rejected_count >= MAX_AUTOMATIC_REJECTED_GENERATIONS
    message = (
        f"分镜图片逻辑资产 {scope_id} 已累计 {rejected_count} 次生图经 QA 拒绝。"
        + (
            "已停止自动重试并暂停队列，请用户接管该资产。"
            if stopped
            else f"自动流程最多还可尝试 {MAX_AUTOMATIC_REJECTED_GENERATIONS - rejected_count} 次。"
        )
    )
    control = {
        "contract_version": "storyboard-image-generation-attempt-limit-v1",
        "generation_attempt_scope_id": scope_id,
        "maximum_automatic_rejected_generations": MAX_AUTOMATIC_REJECTED_GENERATIONS,
        "rejected_generation_count": rejected_count,
        "automatic_retry_status": STOP_STATUS if stopped else "retry_allowed",
        "last_failure_time": recorded_failure["qa_time"],
        "handoff_message": message,
        "reset_for_prompt_reference_base_composition_model_route_path_version_or_revision": False,
    }
    item["image_generation_attempt_control"] = control
    if stopped:
        review["queue_generation_allowed"] = False
        review["current_asset_id"] = item["asset_id"]
        review["user_takeover_required"] = True
        review["user_takeover_asset_id"] = item["asset_id"]
        review["user_takeover_scope_id"] = scope_id
        review["user_takeover_message"] = message
    elif item.get("status") in {"pending_generation", "changes_requested"}:
        review["queue_generation_allowed"] = True
    return control


def record_failure(args: argparse.Namespace) -> dict[str, Any]:
    workspace_candidate = Path(args.episode_workspace)
    if workspace_candidate.is_absolute() or not args.episode_workspace:
        raise ValueError("episode workspace must be root-relative")
    workspace = (REPOSITORY_ROOT / workspace_candidate).resolve(strict=True)
    workspace.relative_to(REPOSITORY_ROOT.resolve())
    state_file = workspace / "schema/episode-state.json"
    state = json.loads(state_file.read_text(encoding="utf-8"))
    review = state.get("visual_asset_review")
    if not isinstance(review, dict) or review.get("current_asset_id") != args.asset_id:
        raise ValueError("image generation QA failure target is not the current visual asset")
    item = next(
        (candidate for candidate in review.get("queue", []) if candidate.get("asset_id") == args.asset_id),
        None,
    )
    if (
        not isinstance(item, dict)
        or item.get("visual_generation_route") not in GENERATED_STORYBOARD_IMAGE_ROUTES
        or item.get("status") not in ACTIVE_GENERATION_STATUSES
    ):
        raise ValueError("asset is not an active generated storyboard-image target")
    prompt = resolve_root_relative(args.prompt_path, "failure prompt")
    output = resolve_root_relative(args.output_path, "failure output")
    if prompt.suffix.lower() != ".txt" or output.suffix.lower() != ".png":
        raise ValueError("image generation failure evidence must bind one TXT prompt and one PNG output")
    failure = {
        "prompt": {"path": args.prompt_path, "checksum_sha256": sha256_file(prompt)},
        "output": {"path": args.output_path, "checksum_sha256": sha256_file(output)},
        "failure_reason": args.failure_reason.strip(),
        "qa_time": args.qa_time,
    }
    control = apply_failure_control(item, review, failure)
    if control["automatic_retry_status"] == STOP_STATUS:
        blocker = {
            "blocker_id": f"storyboard-image-generation-attempt-limit:{control['generation_attempt_scope_id']}",
            "contract_version": control["contract_version"],
            "asset_id": args.asset_id,
            "generation_attempt_scope_id": control["generation_attempt_scope_id"],
            "status": STOP_STATUS,
            "message": control["handoff_message"],
        }
        blockers = state.setdefault("blockers", [])
        blockers[:] = [
            existing for existing in blockers
            if existing.get("blocker_id") != blocker["blocker_id"]
        ]
        blockers.append(blocker)
    temporary = state_file.with_suffix(".json.image-generation-qa-failure.tmp")
    if temporary.exists():
        raise ValueError("image generation QA failure temporary path already exists")
    temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(state_file)
    return {
        "result": "pass",
        "asset_id": args.asset_id,
        **control,
        "queue_generation_allowed": review.get("queue_generation_allowed"),
        "user_takeover_required": review.get("user_takeover_required", False),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("episode_workspace")
    parser.add_argument("asset_id")
    parser.add_argument("prompt_path")
    parser.add_argument("output_path")
    parser.add_argument("failure_reason")
    parser.add_argument("qa_time")
    args = parser.parse_args()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}", args.qa_time):
        raise SystemExit("qa_time must be ISO-8601 with offset")
    print(json.dumps(record_failure(args), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
