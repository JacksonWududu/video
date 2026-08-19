#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
from typing import Any


REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
GATE_PATH = REPOSITORY_ROOT / ".agents/skills/run-knowledge-video/scripts/validate_visual_approval_state.py"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


def sha256_file(file: Path) -> str:
    digest = hashlib.sha256()
    with file.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


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


def approve(args: argparse.Namespace) -> dict[str, Any]:
    workspace = resolve_root_relative(args.episode_workspace, "episode workspace")
    state_file = workspace / "schema/episode-state.json"
    state = json.loads(state_file.read_text(encoding="utf-8"))
    review = state.get("visual_asset_review")
    if not isinstance(review, dict) or review.get("mode") != "hybrid_batch_v1":
        raise ValueError("hybrid visual asset review is not active")
    if review.get("queue_generation_allowed") is not False:
        raise ValueError("visual generation queue is not paused for batch approval")
    manifest = review.get("active_batch")
    if not isinstance(manifest, dict):
        raise ValueError("active hybrid batch is missing")
    manifest_file = resolve_root_relative(manifest.get("manifest_path", ""), "batch manifest")
    if sha256_file(manifest_file) != manifest.get("manifest_file_checksum_sha256"):
        raise ValueError("batch manifest file checksum is stale")
    file_manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    for key in ("contract_version", "assets", "asset_ids", "checksum_map", "manifest_sha256"):
        if file_manifest.get(key) != manifest.get(key):
            raise ValueError(f"batch manifest file does not match active batch: {key}")
    if not SHA256_RE.fullmatch(str(manifest.get("manifest_sha256", ""))):
        raise ValueError("batch manifest checksum is invalid")

    gate = load_gate()
    approved = gate.record_hybrid_batch_approval(
        state,
        None,
        args.decision_message,
        args.decision_time,
        repository_root=REPOSITORY_ROOT,
    )
    queue = [
        item
        for item in review["queue"]
        if item.get("active_for_current_storyboard") is not False
        and item.get("status") != "superseded"
    ]
    next_item = next(
        (
            item
            for item in queue
            if item.get("status") not in {"approved", "qa_passed_pending_batch_review"}
        ),
        None,
    )
    review["current_asset_id"] = next_item.get("asset_id") if next_item else None
    state["current_phase"] = "visual_production"

    temporary = state_file.with_suffix(".json.hybrid-approval.tmp")
    if temporary.exists():
        raise ValueError("hybrid approval temporary path already exists")
    temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(state_file)
    return {
        "result": "pass",
        "approved_asset_ids": [item["asset_id"] for item in approved],
        "manifest_sha256": manifest["manifest_sha256"],
        "decision_message": args.decision_message,
        "decision_time": args.decision_time,
        "queue_generation_allowed": review["queue_generation_allowed"],
        "current_asset_id": review["current_asset_id"],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("episode_workspace")
    parser.add_argument("decision_message")
    parser.add_argument("decision_time")
    args = parser.parse_args()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}", args.decision_time):
        raise SystemExit("decision_time must be ISO-8601 with offset")
    print(json.dumps(approve(args), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
