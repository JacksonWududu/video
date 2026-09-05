#!/usr/bin/env python3
from __future__ import annotations

import argparse
from datetime import datetime
import importlib.util
import json
from pathlib import Path
import re
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
REPOSITORY_ROOT = SCRIPT_DIR.parents[3]
CONTRACT_VERSION = "ian-repairable-source-redo-request-v1"


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path.name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


failure_recorder = load_module(SCRIPT_DIR / "record-image-generation-qa-failure.py", "ian_redo_failure_recorder")
ian_recorder = load_module(SCRIPT_DIR / "record-generated-ian-layered-scene-qa.py", "ian_redo_qa_recorder")
visual_gate = load_module(ian_recorder.GATE_PATH, "ian_redo_visual_gate")


def scoped_path(value: str, workspace: Path | None, *, directory: bool = False) -> Path:
    if not isinstance(value, str) or not value or Path(value).is_absolute() or ".." in Path(value).parts:
        raise ValueError("redo evidence paths must be root-relative")
    root = REPOSITORY_ROOT.resolve()
    candidate = root / value
    for parent in (candidate, *candidate.parents):
        if parent == root:
            break
        if parent.is_symlink():
            raise ValueError("redo evidence must not use symlinks")
    try:
        path = candidate.resolve(strict=True)
        path.relative_to(workspace or root)
    except (OSError, ValueError) as error:
        raise ValueError("redo evidence is missing or outside the workspace") from error
    if not (path.is_dir() if directory else path.is_file() and path.stat().st_size > 0):
        raise ValueError("redo evidence must be a nonempty regular file")
    return path


def timestamp(value: str) -> datetime:
    if not isinstance(value, str) or re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:Z|[+-]\d\d:\d\d)", value) is None:
        raise ValueError("redo decision requires an exact timestamp with timezone")
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def explicit_redo(message: str) -> bool:
    if not isinstance(message, str) or not message.strip():
        return False
    clauses = re.split(r"[，,。；;！!？?\n]", re.sub(r"\s+", "", message))
    return any(
        re.search(r"换一个|换一张|换张|重做|重画|重新生成|重新画|再生成", clause)
        and not re.search(r"不|别|无需|无须|禁止|取消|停止", clause)
        for clause in clauses
    )


def request_redo(args: argparse.Namespace) -> dict[str, Any]:
    workspace = scoped_path(args.episode_workspace, None, directory=True)
    state_path = scoped_path(f"{args.episode_workspace}/schema/episode-state.json", workspace)
    original_bytes = state_path.read_bytes()
    state = json.loads(original_bytes)
    request_path = scoped_path(args.request_path, workspace)
    request = json.loads(request_path.read_bytes())
    expected_keys = {"contract_version", "asset_id", "generation_attempt_scope_id", "exact_user_message", "decided_at", "prompt", "output"}
    if not isinstance(request, dict) or set(request) != expected_keys or request.get("contract_version") != CONTRACT_VERSION:
        raise ValueError("unsupported Ian repairable-source redo request")
    if request["asset_id"] != args.asset_id or not explicit_redo(request["exact_user_message"]):
        raise ValueError("redo requires the exact current asset and an explicit user request to regenerate")
    decided_at = timestamp(request["decided_at"])
    review = state.get("visual_asset_review", {})
    targets = [row for row in review.get("queue", []) if row.get("asset_id") == args.asset_id and row.get("active_for_current_storyboard") is True]
    if len(targets) != 1 or review.get("user_takeover_required") is True:
        raise ValueError("redo requires exactly one active current Ian repairable source")
    item = targets[0]
    if not ian_recorder.is_repairable_layout_target(state, item, args.asset_id):
        raise ValueError("redo target is not the current paused Ian repairable source")
    scope_id = request["generation_attempt_scope_id"]
    control = item["image_generation_attempt_control"]
    if not isinstance(scope_id, str) or not scope_id.strip() or scope_id != item.get("generation_attempt_scope_id") or scope_id != control.get("generation_attempt_scope_id"):
        raise ValueError("redo logical-asset scope does not match the current source")
    finding = item["image_generation_repairable_findings"][-1]
    if not failure_recorder.is_repairable_ian_geometry(item, finding.get("failure_reason", "")) or finding.get("counts_toward_rejected_generation_limit") is not False:
        raise ValueError("redo source lacks an uncounted repairable geometry finding")
    if decided_at < timestamp(finding.get("qa_time")):
        raise ValueError("redo decision predates the source finding")
    for key, suffix in (("prompt", ".txt"), ("output", ".png")):
        binding = request[key]
        if not isinstance(binding, dict) or set(binding) != {"path", "checksum_sha256"} or binding != finding.get(key):
            raise ValueError(f"redo {key} binding does not match the current source finding")
        checksum = binding["checksum_sha256"]
        path = scoped_path(binding["path"], workspace)
        if path.suffix.lower() != suffix or not isinstance(checksum, str) or re.fullmatch(r"[0-9a-f]{64}", checksum) is None or failure_recorder.sha256_file(path) != checksum:
            raise ValueError(f"redo {key} disk checksum or file type is invalid")
    history = item.get("image_generation_qa_failures", [])
    count = control.get("rejected_generation_count")
    if not isinstance(history, list) or type(count) is not int or count != len(history) or not 0 <= count < failure_recorder.MAX_AUTOMATIC_REJECTED_GENERATIONS or control.get("maximum_automatic_rejected_generations") != failure_recorder.MAX_AUTOMATIC_REJECTED_GENERATIONS:
        raise ValueError("redo source has an inconsistent or stopped rejection count")
    if any(entry.get("output", {}).get("checksum_sha256") == request["output"]["checksum_sha256"] for entry in history):
        raise ValueError("redo source was already counted as rejected")

    # This records a new user rejection; the original geometry finding remains intact.
    evidence = {**request, "request": {"path": args.request_path, "checksum_sha256": failure_recorder.sha256_file(request_path)}}
    failure = {
        "prompt": request["prompt"], "output": request["output"],
        "failure_reason": "USER_AESTHETIC_REJECTION: " + request["exact_user_message"],
        "qa_time": request["decided_at"], "user_rejection": evidence,
    }
    item["ian_layout_repair_disposition"]["status"] = "source_rejected_by_user"
    item["ian_layout_repair_disposition"]["user_rejection"] = evidence
    item["status"] = "changes_requested"
    ian_recorder.clear_active_layout_repair(review)
    # Check queue order and dependencies before a third-count stop can mask them.
    item["image_generation_attempt_control"] = {**control, "automatic_retry_status": "retry_allowed"}
    visual_gate.require_generation_allowed(state, args.asset_id)
    control = failure_recorder.append_counted_failure(item, review, failure, scope_id)
    stopped = control["automatic_retry_status"] == failure_recorder.STOP_STATUS
    if stopped:
        failure_recorder.mark_state_awaiting_user_takeover(state)
        blocker = {
            "blocker_id": f"storyboard-image-generation-attempt-limit:{scope_id}",
            "contract_version": control["contract_version"], "asset_id": args.asset_id,
            "generation_attempt_scope_id": scope_id, "status": failure_recorder.STOP_STATUS,
            "message": control["handoff_message"],
        }
        blockers = state.setdefault("blockers", [])
        blockers[:] = [entry for entry in blockers if entry.get("blocker_id") != blocker["blocker_id"]]
        blockers.append(blocker)
        try:
            visual_gate.require_generation_allowed(state, args.asset_id)
        except ValueError as error:
            gate_result = {"result": "blocked", "error": str(error)}
        else:
            raise ValueError("third rejection unexpectedly passed the generation gate")
    else:
        state["phase"] = state["current_phase"] = "visual_production"
        allowed = visual_gate.require_generation_allowed(state, args.asset_id)
        gate_result = {"result": "pass", "asset_id": allowed["asset_id"]}

    if state_path.read_bytes() != original_bytes:
        raise ValueError("episode state changed while validating the redo request")
    temporary = state_path.with_suffix(".json.ian-source-redo.tmp")
    with temporary.open("x", encoding="utf-8") as handle:
        handle.write(json.dumps(state, ensure_ascii=False, indent=2) + "\n")
    try:
        temporary.replace(state_path)
    finally:
        temporary.unlink(missing_ok=True)
    return {
        "result": failure_recorder.STOP_STATUS if stopped else "redo_allowed",
        "asset_id": args.asset_id, "generation_attempt_scope_id": scope_id,
        "rejected_generation_count": control["rejected_generation_count"],
        "queue_generation_allowed": review["queue_generation_allowed"],
        "generation_gate": gate_result,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Record an explicit user rejection of the current repairable Ian source and check its redo gate.")
    parser.add_argument("episode_workspace")
    parser.add_argument("asset_id")
    parser.add_argument("request_path")
    args = parser.parse_args()
    try:
        result = request_redo(args)
    except (ValueError, OSError) as error:
        parser.exit(1, f"{error}\n")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
