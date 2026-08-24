#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
from typing import Any


REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
MAX_AUTOMATIC_QA_FAILURES = 3
STOP_STATUS = "stopped_user_takeover_required"
WHITE_CAT_QA_ERROR_CODES = {
    "P0_CAT_COUNT",
    "P0_FORELIMB_COUNT",
    "P0_HINDLIMB_COUNT",
    "P0_PAW_COUNT",
    "P0_UNASSIGNED_PAW",
    "P0_AMBIGUOUS_TRACE",
    "P0_BRANCH_OR_FUSION",
    "P0_FORWARD_REVERSE_MISMATCH",
    "P0_EVIDENCE_STALE",
    "P2_SATCHEL_TOPOLOGY",
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
    resolved = (REPOSITORY_ROOT / candidate).resolve(strict=True)
    resolved.relative_to(REPOSITORY_ROOT.resolve())
    if candidate.is_symlink() or resolved.is_symlink() or not resolved.is_file():
        raise ValueError(f"{label} must be a regular non-symlink file")
    return resolved


def apply_failure_control(
    item: dict[str, Any],
    review: dict[str, Any],
    failure: dict[str, Any],
) -> dict[str, Any]:
    if failure.get("error_code") not in WHITE_CAT_QA_ERROR_CODES:
        raise ValueError("white-cat QA failure requires a stable P0/P2 error code")
    history = item.setdefault("white_cat_imagegen_qa_failures", [])
    if any(
        existing.get("output", {}).get("checksum_sha256")
        == failure["output"]["checksum_sha256"]
        for existing in history
    ):
        raise ValueError("white-cat QA failure output was already recorded")
    failure = {**failure, "attempt_number": len(history) + 1}
    history.append(failure)
    failed_count = len(history)
    stopped = failed_count >= MAX_AUTOMATIC_QA_FAILURES
    message = (
        f"白猫资产 {item['asset_id']} 已累计 {failed_count} 次生图经 QA 不通过。"
        + (
            "已停止自动重试，请用户接手：可提供修订图、明确新构图，或决定是否放弃该资产。"
            if stopped
            else f"自动流程最多还可尝试 {MAX_AUTOMATIC_QA_FAILURES - failed_count} 次。"
        )
    )
    control = {
        "contract_version": "white-cat-imagegen-attempt-limit-v1",
        "maximum_automatic_qa_failures": MAX_AUTOMATIC_QA_FAILURES,
        "qa_failed_generation_count": failed_count,
        "automatic_retry_status": STOP_STATUS if stopped else "retry_allowed",
        "last_failure_time": failure["qa_time"],
        "handoff_message": message,
    }
    item["white_cat_generation_attempt_control"] = control
    if stopped:
        review["queue_generation_allowed"] = False
        review["current_asset_id"] = item["asset_id"]
        review["user_takeover_required"] = True
        review["user_takeover_asset_id"] = item["asset_id"]
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
        raise ValueError("white-cat QA failure target is not the current visual asset")
    item = next(
        (candidate for candidate in review.get("queue", []) if candidate.get("asset_id") == args.asset_id),
        None,
    )
    if (
        not isinstance(item, dict)
        or item.get("white_cat_present") is not True
        or item.get("visual_generation_route") not in {"imagegen", "xuan-paper-diorama"}
        or item.get("status")
        not in {"pending_generation", "changes_requested", "awaiting_batch_qa", "awaiting_user_approval"}
    ):
        raise ValueError("asset is not an active white-cat ImageGen target")
    if not args.failure_reason.strip():
        raise ValueError("QA failure reason is empty")
    error_code_match = re.match(
        r"^(P[02]_[A-Z0-9_]+)(?::|\s|$)",
        args.failure_reason.strip(),
    )
    if error_code_match is None or error_code_match.group(1) not in WHITE_CAT_QA_ERROR_CODES:
        raise ValueError("QA failure reason must begin with a stable P0/P2 error code")
    prompt = resolve_root_relative(args.prompt_path, "failure prompt")
    output = resolve_root_relative(args.output_path, "failure output")
    if prompt.suffix.lower() != ".txt" or output.suffix.lower() != ".png":
        raise ValueError("white-cat failure evidence must bind one TXT prompt and one PNG output")
    failure = {
        "prompt": {
            "path": args.prompt_path,
            "checksum_sha256": sha256_file(prompt),
        },
        "output": {
            "path": args.output_path,
            "checksum_sha256": sha256_file(output),
        },
        "failure_reason": args.failure_reason.strip(),
        "error_code": error_code_match.group(1),
        "qa_time": args.qa_time,
    }
    control = apply_failure_control(item, review, failure)
    if control["automatic_retry_status"] == STOP_STATUS:
        state["phase"] = "awaiting_visual_asset_review"
        state["current_phase"] = "awaiting_visual_asset_review"
    temporary = state_file.with_suffix(".json.white-cat-qa-failure.tmp")
    if temporary.exists():
        raise ValueError("white-cat QA failure temporary path already exists")
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
