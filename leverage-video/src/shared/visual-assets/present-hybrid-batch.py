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


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def resolve_root_relative(value: str, label: str, *, must_exist: bool = True) -> Path:
    candidate = Path(value)
    if candidate.is_absolute() or not value:
        raise ValueError(f"{label} must be root-relative")
    target = REPOSITORY_ROOT / candidate
    resolved = target.resolve(strict=must_exist)
    resolved.relative_to(REPOSITORY_ROOT.resolve())
    if must_exist and resolved.is_symlink():
        raise ValueError(f"{label} must not be a symlink")
    return resolved


def load_gate():
    spec = importlib.util.spec_from_file_location("visual_approval_gate", GATE_PATH)
    if spec is None or spec.loader is None:
        raise ValueError("visual approval gate cannot be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def present(args: argparse.Namespace) -> dict[str, Any]:
    workspace = resolve_root_relative(args.episode_workspace, "episode workspace")
    state_file = workspace / "schema/episode-state.json"
    state = json.loads(state_file.read_text(encoding="utf-8"))
    review = state.get("visual_asset_review", {})
    manifest = review.get("active_batch")
    gate = load_gate()
    active_queue = gate._queue(state)
    items = [gate._find(active_queue, asset_id) for asset_id in manifest.get("asset_ids", [])] if isinstance(manifest, dict) else []
    unpresented_recovery = (
        state.get("current_phase") == "awaiting_visual_asset_review"
        and isinstance(manifest, dict)
        and "manifest_path" not in manifest
    )
    if (
        state.get("current_phase") != "visual_production" and not unpresented_recovery
        or review.get("mode") != "hybrid_batch_v1"
        or review.get("queue_generation_allowed") is not False
        or not items
        or any(item is None or item.get("status") != "qa_passed_pending_batch_review" for item in items)
    ):
        raise ValueError("hybrid batch is not ready for presentation")
    expected = gate._hybrid_manifest(items)
    if any(manifest.get(key) != expected[key] for key in (
        "contract_version", "assets", "asset_ids", "checksum_map", "manifest_sha256"
    )):
        raise ValueError("active hybrid batch manifest is stale")
    for item in items:
        file = resolve_root_relative(item["path"], f"{item['asset_id']} raster")
        if sha256_bytes(file.read_bytes()) != item["checksum_sha256"]:
            raise ValueError(f"{item['asset_id']} raster checksum is stale")
        qa_file = resolve_root_relative(item["qa_evidence_path"], f"{item['asset_id']} QA evidence")
        if sha256_bytes(qa_file.read_bytes()) != item["qa_evidence_checksum_sha256"]:
            raise ValueError(f"{item['asset_id']} QA evidence checksum is stale")
    shot_ids = {item["shot_id"] for item in items}
    shot_label = next(iter(shot_ids)) if len(shot_ids) == 1 else "跨镜头"
    all_actions = all(str(item.get("role", "")).startswith("action-") for item in items)
    asset_label = "动作态" if all_actions else "视觉资产"
    exact_message = (
        f"现呈交 {shot_label} {asset_label} {len(items)} 张精确 PNG"
        f"（批次清单 SHA-256 {manifest['manifest_sha256']}），"
        "等待用户明确批准此批次全部精确字节。"
    )
    payload = {
        **manifest,
        "episode_workspace": args.episode_workspace,
        "storyboard_path": state["active_storyboard"]["path"],
        "storyboard_checksum_sha256": state["active_storyboard"]["checksum_sha256"],
        "presented_at": args.presented_at,
        "exact_presentation_message": exact_message,
        "review_assets": [
            {
                "asset_id": item["asset_id"],
                "shot_id": item["shot_id"],
                "role": item["role"],
                "path": item["path"],
                "checksum_sha256": item["checksum_sha256"],
                "measured_dimensions": item["measured_dimensions"],
                "state_visible_text": item.get("state_visible_text"),
                "technical_qa": item["technical_qa"],
                "semantic_qa": item["semantic_qa"],
                "identity_qa": item.get("identity_qa"),
                "visible_text_qa": item["visible_text_qa"],
                "style_qa": item.get("style_qa"),
                "continuity_qa": item.get("continuity_qa"),
                "visual_qa": item["visual_qa"],
                "qa_evidence_path": item["qa_evidence_path"],
                "qa_evidence_checksum_sha256": item["qa_evidence_checksum_sha256"],
                "narration_source_text": item["narration_source_text"],
            }
            for item in items
        ],
    }
    manifest_file = resolve_root_relative(args.manifest_path, "manifest path", must_exist=False)
    if manifest_file.exists():
        raise ValueError("refusing to overwrite an existing batch manifest")
    manifest_bytes = (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    for item in items:
        item.update(
            presented_checksum_sha256=item["checksum_sha256"],
            presented_at=args.presented_at,
            presented_batch_manifest_sha256=manifest["manifest_sha256"],
        )
    review["active_batch"] = {
        **manifest,
        "manifest_path": args.manifest_path,
        "manifest_file_checksum_sha256": sha256_bytes(manifest_bytes),
        "presented_at": args.presented_at,
        "exact_presentation_message": exact_message,
        "storyboard_path": payload["storyboard_path"],
        "storyboard_checksum_sha256": payload["storyboard_checksum_sha256"],
    }
    state["current_phase"] = "awaiting_visual_asset_review"
    state_bytes = (json.dumps(state, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    manifest_file.parent.mkdir(parents=True, exist_ok=True)
    manifest_tmp = manifest_file.with_suffix(manifest_file.suffix + ".tmp")
    state_tmp = state_file.with_suffix(".json.batch-presentation.tmp")
    if manifest_tmp.exists() or state_tmp.exists():
        raise ValueError("batch presentation temporary path already exists")
    manifest_tmp.write_bytes(manifest_bytes)
    state_tmp.write_bytes(state_bytes)
    manifest_tmp.replace(manifest_file)
    state_tmp.replace(state_file)
    return {
        "result": "pass",
        "manifest_path": args.manifest_path,
        "manifest_sha256": manifest["manifest_sha256"],
        "manifest_file_checksum_sha256": sha256_bytes(manifest_bytes),
        "asset_ids": manifest["asset_ids"],
        "exact_presentation_message": exact_message,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("episode_workspace")
    parser.add_argument("manifest_path")
    parser.add_argument("presented_at")
    args = parser.parse_args()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}", args.presented_at):
        raise SystemExit("presented_at must be ISO-8601 with offset")
    print(json.dumps(present(args), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
