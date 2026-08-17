#!/usr/bin/env python3
"""Enforce sequential, exact-byte approval for knowledge-video visuals."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import struct
from pathlib import Path
from typing import Any


SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
APPROVAL_WORDS = ("批准", "通过", "符合预期", "approve", "approved")
REVIEW_MODES = {"sequential_per_image", "batch_final_review", "hybrid_batch_v1"}
GENERATION_UNLOCKING_STATUSES = {"approved", "qa_passed_pending_batch_review"}
WHITEBOARD_ROUTE = "srt-whiteboard-animation"
WHITEBOARD_STAGES = ("source_image_review", "annotation_review", "clip_review")


def _repository_root(value: str | Path | None) -> Path:
    if value is None:
        raise ValueError("repository_root is required for exact-byte disk verification")
    try:
        root = Path(value).resolve(strict=True)
    except (OSError, RuntimeError) as error:
        raise ValueError(f"repository_root is invalid: {error}") from error
    if not root.is_dir():
        raise ValueError("repository_root must be a directory")
    return root


def _resolve_regular_file(repository_root: str | Path, path_value: Any) -> Path:
    root = _repository_root(repository_root)
    if not isinstance(path_value, str) or not path_value:
        raise ValueError("approved asset path is missing")
    relative = Path(path_value)
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError("approved asset path must be repository-relative")
    current = root
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError(f"approved asset path must not contain a symbolic link: {path_value}")
    try:
        resolved = current.resolve(strict=True)
        resolved.relative_to(root)
    except (OSError, RuntimeError, ValueError) as error:
        raise ValueError(f"approved asset path is unavailable or outside the repository: {path_value}") from error
    if not resolved.is_file() or resolved.stat().st_size < 1:
        raise ValueError(f"approved asset must be a non-empty regular file: {path_value}")
    return resolved


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _png_dimensions(path: Path) -> tuple[int, int]:
    with path.open("rb") as handle:
        header = handle.read(24)
    if (
        len(header) != 24
        or header[:8] != b"\x89PNG\r\n\x1a\n"
        or header[12:16] != b"IHDR"
    ):
        raise ValueError(f"approved visual is not a PNG: {path}")
    return struct.unpack(">II", header[16:24])


def _disk_evidence(repository_root: str | Path, path_value: Any) -> dict[str, Any]:
    path = _resolve_regular_file(repository_root, path_value)
    return {
        "path": path,
        "checksum_sha256": _sha256_file(path),
        "measured_dimensions": list(_png_dimensions(path)),
    }


def _review(state: dict[str, Any]) -> dict[str, Any]:
    review = state.get("visual_asset_review")
    if not isinstance(review, dict) or review.get("mode") not in REVIEW_MODES:
        raise ValueError("visual approval mode is invalid")
    queue = review.get("queue")
    if not isinstance(queue, list) or not queue:
        raise ValueError("visual approval queue is empty")
    return review


def _queue(state: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        item
        for item in _review(state)["queue"]
        if item.get("active_for_current_storyboard") is not False
        and item.get("status") != "superseded"
    ]


def _find(queue: list[dict[str, Any]], asset_id: str) -> dict[str, Any] | None:
    return next((item for item in queue if item.get("asset_id") == asset_id), None)


def _is_whiteboard(item: dict[str, Any]) -> bool:
    return item.get("visual_generation_route") == WHITEBOARD_ROUTE


def _is_strict(item: dict[str, Any], queue: list[dict[str, Any]]) -> bool:
    if _is_whiteboard(item):
        return True
    if item.get("strict_review") is True or item.get("user_marked_strict") is True:
        return True
    if item.get("is_revision") is True or item.get("revision_of"):
        return True
    if item.get("has_downstream_action_variants") is True:
        return True
    if item.get("role") in {"comic-character-reference", "white-cat-master", "recurring-character-master"}:
        return True
    asset_id = item.get("asset_id")
    return item.get("role") == "base/master" and any(
        asset_id in candidate.get("depends_on", []) for candidate in queue
    )


def _whiteboard_review(item: dict[str, Any]) -> dict[str, Any]:
    review = item.get("whiteboard_review")
    if not isinstance(review, dict) or review.get("contract_version") != "whiteboard-visual-asset-review-v1":
        raise ValueError("whiteboard visual review contract is missing")
    if review.get("current_stage") not in WHITEBOARD_STAGES:
        raise ValueError("whiteboard current review stage is invalid")
    for stage in WHITEBOARD_STAGES:
        if not isinstance(review.get(stage), dict):
            raise ValueError(f"whiteboard review stage is missing: {stage}")
    return review


def _next_unapproved(queue: list[dict[str, Any]]) -> dict[str, Any] | None:
    return next(
        (item for item in queue if item.get("status") not in GENERATION_UNLOCKING_STATUSES),
        None,
    )


def require_generation_allowed(state: dict[str, Any], asset_id: str) -> dict[str, Any]:
    """Return the queued item only when it is the sole asset currently unlocked."""
    review = _review(state)
    if review.get("queue_generation_allowed") is False:
        raise ValueError("visual review queue is paused")
    queue = _queue(state)
    requested = _find(queue, asset_id)
    current = _next_unapproved(queue)
    if requested is None or current is None or requested is not current:
        if requested is not None and current is not None:
            raise ValueError(f"current asset is not approved: {current.get('asset_id')}")
        raise ValueError(f"asset is not the next queued asset: {asset_id}")

    if current.get("status") not in {"pending_generation", "changes_requested"}:
        raise ValueError(f"current asset is not available for generation: {asset_id}")
    if _is_whiteboard(current):
        review = _whiteboard_review(current)
        if review["current_stage"] != "source_image_review":
            raise ValueError("whiteboard derived generation requires require_whiteboard_stage_allowed")

    by_id = {item.get("asset_id"): item for item in queue}
    for dependency_id in current.get("depends_on", []):
        dependency = by_id.get(dependency_id)
        if dependency is None or dependency.get("status") not in GENERATION_UNLOCKING_STATUSES:
            raise ValueError(f"dependency is not approved: {dependency_id}")
    return current


def require_whiteboard_stage_allowed(
    state: dict[str, Any], asset_id: str, stage_name: str
) -> dict[str, Any]:
    if stage_name not in WHITEBOARD_STAGES:
        raise ValueError("unknown whiteboard review stage")
    queue = _queue(state)
    item = _find(queue, asset_id)
    current = _next_unapproved(queue)
    if item is None or current is None or item is not current or not _is_whiteboard(item):
        raise ValueError(f"asset is not the current whiteboard target: {asset_id}")
    review = _whiteboard_review(item)
    if review.get("current_stage") != stage_name:
        raise ValueError(f"whiteboard stage is not unlocked: {stage_name}")
    stage = review[stage_name]
    if stage.get("status") not in {"pending_generation", "changes_requested"}:
        raise ValueError(f"whiteboard stage is not available for generation: {stage_name}")
    stage_index = WHITEBOARD_STAGES.index(stage_name)
    for previous_name in WHITEBOARD_STAGES[:stage_index]:
        if review[previous_name].get("status") != "approved":
            raise ValueError(f"whiteboard prerequisite is not approved: {previous_name}")
    return stage


def _require_decision_target(state: dict[str, Any], asset_id: str) -> dict[str, Any]:
    queue = _queue(state)
    item = _find(queue, asset_id)
    current = _next_unapproved(queue)
    if item is None or current is None or item is not current:
        raise ValueError(f"asset is not the current approval target: {asset_id}")
    if item.get("status") != "awaiting_user_approval":
        raise ValueError(f"asset is not awaiting user approval: {asset_id}")
    return item


def _require_exact_presented_bytes(
    item: dict[str, Any], repository_root: str | Path | None = None,
    *, require_disk: bool = False,
) -> dict[str, Any] | None:
    current = item.get("checksum_sha256")
    presented = item.get("presented_checksum_sha256")
    if not isinstance(item.get("path"), str) or not item["path"]:
        raise ValueError("approved asset path is missing")
    if not isinstance(current, str) or not SHA256_RE.fullmatch(current):
        raise ValueError("current checksum is invalid")
    if not isinstance(presented, str) or not SHA256_RE.fullmatch(presented):
        raise ValueError("presented checksum is invalid")
    if current != presented:
        raise ValueError("checksum mismatch between current and presented asset")
    if not require_disk:
        return None
    evidence = _disk_evidence(repository_root, item["path"])
    if evidence["checksum_sha256"] != current:
        raise ValueError(f"approved asset changed on disk: {item.get('asset_id')}")
    if evidence["measured_dimensions"] != item.get("measured_dimensions"):
        raise ValueError(f"approved asset dimensions changed on disk: {item.get('asset_id')}")
    return evidence


def _require_generation_aspect_ratio(state: dict[str, Any], item: dict[str, Any]) -> None:
    review = _review(state)
    target = review.get("generation_aspect_ratio")
    tolerance = review.get("generation_aspect_ratio_max_relative_error")
    if target != [16, 9]:
        raise ValueError("visual review generation_aspect_ratio must be 16:9")
    if not isinstance(tolerance, (int, float)) or not 0 <= tolerance <= 0.05:
        raise ValueError("visual review aspect-ratio tolerance is invalid")
    dimensions = item.get("measured_dimensions")
    if (
        not isinstance(dimensions, list)
        or len(dimensions) != 2
        or not all(isinstance(value, int) and value > 0 for value in dimensions)
    ):
        raise ValueError("generated dimensions are invalid")
    width, height = dimensions
    target_ratio = target[0] / target[1]
    relative_error = abs((width / height) - target_ratio) / target_ratio
    if width <= height or relative_error > tolerance:
        raise ValueError("generated aspect ratio is outside tolerance")
    item["measured_aspect_ratio_relative_error"] = relative_error


def record_approval(
    state: dict[str, Any], asset_id: str, decision_message: str, decision_time: str,
    *, repository_root: str | Path | None = None,
) -> dict[str, Any]:
    item = _require_decision_target(state, asset_id)
    if _review(state).get("mode") == "hybrid_batch_v1" and not _is_strict(item, _queue(state)):
        raise ValueError("normal hybrid assets require a batch manifest approval")
    if _is_whiteboard(item):
        raise ValueError("whiteboard assets require source, annotation, and clip approvals")
    require_disk = _review(state).get("mode") == "hybrid_batch_v1"
    evidence = _require_exact_presented_bytes(
        item, repository_root, require_disk=require_disk,
    )
    _require_generation_aspect_ratio(state, item)
    normalized = decision_message.strip().lower()
    if not normalized or not (
        normalized == "1" or any(word in normalized for word in APPROVAL_WORDS)
    ):
        raise ValueError("approval message is not explicit")
    item["status"] = "approved"
    item["approved_checksum_sha256"] = item["checksum_sha256"]
    item["decision_message"] = decision_message
    item["decision_time"] = decision_time
    if evidence is not None:
        item["approval_disk_checksum_sha256"] = evidence["checksum_sha256"]
        item["approval_disk_measured_dimensions"] = evidence["measured_dimensions"]
        item["approval_disk_verified_at"] = decision_time
    return item


def _require_explicit_approval(decision_message: str) -> None:
    normalized = decision_message.strip().lower()
    if not normalized or not (
        normalized == "1" or any(word in normalized for word in APPROVAL_WORDS)
    ):
        raise ValueError("approval message is not explicit")


def _current_whiteboard_decision_target(
    state: dict[str, Any], asset_id: str, stage_name: str
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    queue = _queue(state)
    item = _find(queue, asset_id)
    current = _next_unapproved(queue)
    if item is None or current is None or item is not current or not _is_whiteboard(item):
        raise ValueError(f"asset is not the current whiteboard approval target: {asset_id}")
    review = _whiteboard_review(item)
    if review.get("current_stage") != stage_name:
        raise ValueError(f"whiteboard stage is not the current approval target: {stage_name}")
    stage = review[stage_name]
    if stage.get("status") != "awaiting_user_approval":
        raise ValueError(f"whiteboard stage is not awaiting user approval: {stage_name}")
    return item, review, stage


def _require_path_checksum(
    stage: dict[str, Any], prefix: str,
    repository_root: str | Path | None = None,
    *, require_disk: bool = False,
) -> str:
    path_value = stage.get(f"{prefix}_path")
    checksum = stage.get(f"{prefix}_checksum_sha256")
    presented = stage.get(f"presented_{prefix}_checksum_sha256")
    if not isinstance(path_value, str) or not path_value:
        raise ValueError(f"whiteboard {prefix} path is missing")
    if not isinstance(checksum, str) or not SHA256_RE.fullmatch(checksum):
        raise ValueError(f"whiteboard {prefix} checksum is invalid")
    if checksum != presented:
        raise ValueError(f"whiteboard {prefix} checksum does not match presented bytes")
    if require_disk:
        path = _resolve_regular_file(repository_root, path_value)
        if _sha256_file(path) != checksum:
            raise ValueError(f"whiteboard {prefix} changed on disk")
    return checksum


def record_whiteboard_source_approval(
    state: dict[str, Any], asset_id: str, decision_message: str, decision_time: str,
    *, repository_root: str | Path | None = None,
) -> dict[str, Any]:
    item, review, stage = _current_whiteboard_decision_target(
        state, asset_id, "source_image_review"
    )
    _require_explicit_approval(decision_message)
    require_disk = _review(state).get("mode") == "hybrid_batch_v1"
    checksum = _require_path_checksum(
        stage, "source_image", repository_root, require_disk=require_disk,
    )
    if require_disk:
        source_path = _resolve_regular_file(repository_root, stage["source_image_path"])
        if list(_png_dimensions(source_path)) != stage.get("measured_dimensions"):
            raise ValueError("whiteboard source image dimensions changed on disk")
    aspect_proxy = {
        "measured_dimensions": stage.get("measured_dimensions"),
    }
    _require_generation_aspect_ratio(state, aspect_proxy)
    stage["measured_aspect_ratio_relative_error"] = aspect_proxy[
        "measured_aspect_ratio_relative_error"
    ]
    stage.update(
        status="approved",
        approved_source_image_checksum_sha256=checksum,
        decision_message=decision_message,
        decision_time=decision_time,
    )
    review["current_stage"] = "annotation_review"
    review["annotation_review"]["status"] = "pending_generation"
    item["status"] = "whiteboard_in_progress"
    return stage


def record_whiteboard_annotation_approval(
    state: dict[str, Any], asset_id: str, decision_message: str, decision_time: str,
    *, repository_root: str | Path | None = None,
) -> dict[str, Any]:
    item, review, stage = _current_whiteboard_decision_target(
        state, asset_id, "annotation_review"
    )
    if review["source_image_review"].get("status") != "approved":
        raise ValueError("whiteboard source image is not approved")
    _require_explicit_approval(decision_message)
    require_disk = _review(state).get("mode") == "hybrid_batch_v1"
    annotation_checksum = _require_path_checksum(
        stage, "annotation", repository_root, require_disk=require_disk,
    )
    preview_checksum = _require_path_checksum(
        stage, "preview", repository_root, require_disk=require_disk,
    )
    stage.update(
        status="approved",
        approved_annotation_checksum_sha256=annotation_checksum,
        approved_preview_checksum_sha256=preview_checksum,
        decision_message=decision_message,
        decision_time=decision_time,
    )
    review["current_stage"] = "clip_review"
    review["clip_review"]["status"] = "pending_generation"
    item["status"] = "whiteboard_in_progress"
    return stage


def _require_whiteboard_media(stage: dict[str, Any]) -> None:
    if stage.get("render_evidence_contract_version") != "whiteboard-render-evidence-v1":
        raise ValueError("whiteboard render evidence contract is missing")
    media = stage.get("media")
    if not isinstance(media, dict):
        raise ValueError("whiteboard media evidence is missing")
    if media.get("width") != 1920 or media.get("height") != 1080:
        raise ValueError("whiteboard clip must be 1920x1080")
    if media.get("fps") != 30 or media.get("codec") != "h264":
        raise ValueError("whiteboard clip must be 30 fps H.264")
    if media.get("audio_streams") != 0:
        raise ValueError("whiteboard clip must have no audio")
    if not isinstance(media.get("frame_count"), int) or media["frame_count"] < 1:
        raise ValueError("whiteboard clip frame count is invalid")
    if media.get("frame_count") != stage.get("expected_frame_count"):
        raise ValueError("whiteboard clip frame count does not equal shot frames")
    if media.get("final_frame_verified") is not True:
        raise ValueError("whiteboard final frame is not verified")
    if media.get("full_frame_hold_verified_frames", 0) < 15:
        raise ValueError("whiteboard final complete frame hold is shorter than 15 frames")


def record_whiteboard_clip_approval(
    state: dict[str, Any], asset_id: str, decision_message: str, decision_time: str,
    *, repository_root: str | Path | None = None,
) -> dict[str, Any]:
    item, review, stage = _current_whiteboard_decision_target(
        state, asset_id, "clip_review"
    )
    if review["source_image_review"].get("status") != "approved" \
            or review["annotation_review"].get("status") != "approved":
        raise ValueError("whiteboard source and annotation approvals are required")
    _require_explicit_approval(decision_message)
    require_disk = _review(state).get("mode") == "hybrid_batch_v1"
    clip_checksum = _require_path_checksum(
        stage, "clip", repository_root, require_disk=require_disk,
    )
    evidence_checksum = _require_path_checksum(
        stage, "render_evidence", repository_root, require_disk=require_disk,
    )
    _require_whiteboard_media(stage)
    stage.update(
        status="approved",
        approved_clip_checksum_sha256=clip_checksum,
        approved_render_evidence_checksum_sha256=evidence_checksum,
        decision_message=decision_message,
        decision_time=decision_time,
    )
    item["status"] = "approved"
    item["approved_checksum_sha256"] = clip_checksum
    item["whiteboard_approved_checksums"] = {
        "source_image_sha256": review["source_image_review"][
            "approved_source_image_checksum_sha256"
        ],
        "annotation_sha256": review["annotation_review"][
            "approved_annotation_checksum_sha256"
        ],
        "preview_sha256": review["annotation_review"][
            "approved_preview_checksum_sha256"
        ],
        "clip_sha256": clip_checksum,
        "render_evidence_sha256": evidence_checksum,
    }
    return stage


def record_whiteboard_changes_requested(
    state: dict[str, Any], asset_id: str, stage_name: str,
    decision_message: str, decision_time: str
) -> dict[str, Any]:
    if stage_name not in WHITEBOARD_STAGES:
        raise ValueError("unknown whiteboard review stage")
    item, review, stage = _current_whiteboard_decision_target(state, asset_id, stage_name)
    if not decision_message.strip():
        raise ValueError("change request message is empty")
    start = WHITEBOARD_STAGES.index(stage_name)
    for index, name in enumerate(WHITEBOARD_STAGES[start:], start=start):
        target = review[name]
        target["status"] = "changes_requested" if index == start else "locked"
        for key in list(target):
            if key.startswith("approved_") or key in {"decision_message", "decision_time"}:
                target.pop(key, None)
    review["current_stage"] = stage_name
    item["status"] = "changes_requested" if stage_name == "source_image_review" else "whiteboard_in_progress"
    item.pop("approved_checksum_sha256", None)
    item.pop("whiteboard_approved_checksums", None)
    stage["decision_message"] = decision_message
    stage["decision_time"] = decision_time
    return stage


def record_changes_requested(
    state: dict[str, Any], asset_id: str, decision_message: str, decision_time: str
) -> dict[str, Any]:
    item = _require_decision_target(state, asset_id)
    if not decision_message.strip():
        raise ValueError("change request message is empty")
    item["status"] = "changes_requested"
    item["decision_message"] = decision_message
    item["decision_time"] = decision_time
    return item


def record_batch_qa_pass(
    state: dict[str, Any], asset_id: str, qa_time: str
) -> dict[str, Any]:
    review = _review(state)
    if review.get("mode") != "batch_final_review":
        raise ValueError("batch QA pass requires batch_final_review mode")
    queue = _queue(state)
    item = _find(queue, asset_id)
    current = _next_unapproved(queue)
    if item is None or current is None or item is not current:
        raise ValueError(f"asset is not the current batch QA target: {asset_id}")
    if _is_whiteboard(item):
        raise ValueError("batch QA cannot bypass whiteboard three-stage approval")
    if item.get("status") not in {"awaiting_batch_qa", "awaiting_user_approval"}:
        raise ValueError(f"asset is not awaiting batch QA: {asset_id}")
    current_checksum = item.get("checksum_sha256")
    if not isinstance(item.get("path"), str) or not item["path"]:
        raise ValueError("batch QA asset path is missing")
    if not isinstance(current_checksum, str) or not SHA256_RE.fullmatch(current_checksum):
        raise ValueError("batch QA checksum is invalid")
    _require_generation_aspect_ratio(state, item)
    item["status"] = "qa_passed_pending_batch_review"
    item["batch_qa_checksum_sha256"] = current_checksum
    item["batch_qa_time"] = qa_time
    return item


def record_batch_approval(
    state: dict[str, Any], decision_message: str, decision_time: str
) -> list[dict[str, Any]]:
    review = _review(state)
    if review.get("mode") != "batch_final_review":
        raise ValueError("batch approval requires batch_final_review mode")
    normalized = decision_message.strip().lower()
    if not normalized or not (
        normalized == "1" or any(word in normalized for word in APPROVAL_WORDS)
    ):
        raise ValueError("batch approval message is not explicit")
    queue = _queue(state)
    not_ready = [
        item.get("asset_id")
        for item in queue
        if item.get("status") not in GENERATION_UNLOCKING_STATUSES
    ]
    if not_ready:
        raise ValueError(f"assets not ready for batch approval: {', '.join(not_ready)}")
    for item in queue:
        if item.get("status") == "approved":
            continue
        if _is_whiteboard(item):
            raise ValueError("batch approval cannot bypass whiteboard three-stage approval")
        checksum = item.get("checksum_sha256")
        if checksum != item.get("batch_qa_checksum_sha256"):
            raise ValueError(f"batch QA checksum mismatch: {item.get('asset_id')}")
        item["status"] = "approved"
        item["presented_checksum_sha256"] = checksum
        item["approved_checksum_sha256"] = checksum
        item["decision_message"] = decision_message
        item["decision_time"] = decision_time
    return queue


def _hybrid_manifest(items: list[dict[str, Any]]) -> dict[str, Any]:
    assets = []
    for item in items:
        checksum = item.get("checksum_sha256")
        if not isinstance(checksum, str) or not SHA256_RE.fullmatch(checksum):
            raise ValueError(f"hybrid batch checksum is invalid: {item.get('asset_id')}")
        if not isinstance(item.get("narration_source_text"), str):
            raise ValueError(f"hybrid batch narration source is missing: {item.get('asset_id')}")
        if item.get("technical_qa", {}).get("result") != "pass":
            raise ValueError(f"hybrid batch technical QA is not passing: {item.get('asset_id')}")
        assets.append({"asset_id": item.get("asset_id"), "checksum_sha256": checksum})
    payload = {
        "contract_version": "visual-asset-batch-manifest-v1",
        "assets": assets,
    }
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return {
        **payload,
        "asset_ids": [item["asset_id"] for item in assets],
        "checksum_map": {item["asset_id"]: item["checksum_sha256"] for item in assets},
        "manifest_sha256": hashlib.sha256(encoded).hexdigest(),
    }


def record_hybrid_qa_pass(
    state: dict[str, Any], asset_id: str, qa_time: str
) -> dict[str, Any]:
    review = _review(state)
    if review.get("mode") != "hybrid_batch_v1":
        raise ValueError("hybrid QA pass requires hybrid_batch_v1 mode")
    if review.get("batch_size") != 4:
        raise ValueError("hybrid_batch_v1 requires batch_size 4")
    queue = _queue(state)
    item = _find(queue, asset_id)
    current = _next_unapproved(queue)
    if item is None or current is None or item is not current:
        raise ValueError(f"asset is not the current hybrid QA target: {asset_id}")
    if _is_strict(item, queue):
        raise ValueError("strict hybrid assets require per-item exact-byte approval")
    if item.get("status") not in {"awaiting_batch_qa", "awaiting_user_approval"}:
        raise ValueError(f"asset is not awaiting hybrid QA: {asset_id}")
    if not isinstance(item.get("path"), str) or not item["path"]:
        raise ValueError("hybrid QA asset path is missing")
    checksum = item.get("checksum_sha256")
    if not isinstance(checksum, str) or not SHA256_RE.fullmatch(checksum):
        raise ValueError("hybrid QA checksum is invalid")
    _require_generation_aspect_ratio(state, item)
    if item.get("technical_qa", {}).get("result") != "pass":
        raise ValueError("hybrid technical QA must pass before review batching")
    item.update(
        status="qa_passed_pending_batch_review",
        batch_qa_checksum_sha256=checksum,
        batch_qa_time=qa_time,
    )
    pending = [
        candidate for candidate in queue
        if candidate.get("status") == "qa_passed_pending_batch_review"
    ]
    next_item = _next_unapproved(queue)
    boundary = (
        len(pending) >= review["batch_size"]
        or next_item is None
        or _is_strict(next_item, queue)
    )
    if boundary:
        review["active_batch"] = _hybrid_manifest(pending)
        review["queue_generation_allowed"] = False
    return item


def record_hybrid_batch_approval(
    state: dict[str, Any], asset_ids: list[str] | None,
    decision_message: str, decision_time: str,
    *, repository_root: str | Path,
) -> list[dict[str, Any]]:
    review = _review(state)
    if review.get("mode") != "hybrid_batch_v1":
        raise ValueError("hybrid batch approval requires hybrid_batch_v1 mode")
    _require_explicit_approval(decision_message)
    manifest = review.get("active_batch")
    if not isinstance(manifest, dict) or not SHA256_RE.fullmatch(manifest.get("manifest_sha256", "")):
        raise ValueError("active hybrid batch manifest is missing")
    queue = _queue(state)
    manifest_items = [_find(queue, asset_id) for asset_id in manifest.get("asset_ids", [])]
    if any(item is None for item in manifest_items):
        raise ValueError("active hybrid batch contains a missing asset")
    expected_manifest = _hybrid_manifest(manifest_items)
    if any(manifest.get(key) != expected_manifest[key] for key in (
        "contract_version", "assets", "asset_ids", "checksum_map", "manifest_sha256",
    )):
        raise ValueError("active hybrid batch manifest is stale or malformed")
    requested = manifest["asset_ids"] if asset_ids is None else asset_ids
    if not isinstance(requested, list) or not requested or any(
        asset_id not in manifest["asset_ids"] for asset_id in requested
    ):
        raise ValueError("hybrid batch approval contains an unknown asset")
    approved = []
    for asset_id in requested:
        item = _find(queue, asset_id)
        if item is None:
            raise ValueError(f"hybrid batch asset is missing: {asset_id}")
        checksum = item.get("checksum_sha256")
        if checksum != manifest["checksum_map"].get(asset_id) \
                or checksum != item.get("batch_qa_checksum_sha256"):
            raise ValueError(f"hybrid batch checksum mismatch: {asset_id}")
        evidence = _disk_evidence(repository_root, item.get("path"))
        if evidence["checksum_sha256"] != checksum:
            raise ValueError(f"hybrid batch asset changed on disk: {asset_id}")
        if evidence["measured_dimensions"] != item.get("measured_dimensions"):
            raise ValueError(f"hybrid batch asset dimensions changed on disk: {asset_id}")
        item.update(
            status="approved",
            presented_checksum_sha256=checksum,
            approved_checksum_sha256=checksum,
            batch_manifest_sha256=manifest["manifest_sha256"],
            decision_message=decision_message,
            decision_time=decision_time,
            approval_disk_checksum_sha256=evidence["checksum_sha256"],
            approval_disk_measured_dimensions=evidence["measured_dimensions"],
            approval_disk_verified_at=decision_time,
        )
        approved.append(item)
    if all((_find(queue, asset_id) or {}).get("status") == "approved"
           for asset_id in manifest["asset_ids"]):
        review.pop("active_batch", None)
        review["queue_generation_allowed"] = True
    return approved


def validate_visual_assets_locked(
    state: dict[str, Any], repository_root: str | Path,
) -> dict[str, Any]:
    review = _review(state)
    queue = _queue(state)
    if review.get("active_batch") is not None or review.get("queue_generation_allowed") is False:
        raise ValueError("visual asset review still has an active approval boundary")
    checksum_map: dict[str, str] = {}
    for item in queue:
        asset_id = item.get("asset_id")
        if not isinstance(asset_id, str) or not asset_id:
            raise ValueError("visual asset lock contains an invalid asset_id")
        if item.get("status") != "approved":
            raise ValueError(f"visual asset is not approved: {asset_id}")
        if _is_whiteboard(item):
            whiteboard = _whiteboard_review(item)
            source = whiteboard["source_image_review"]
            annotation = whiteboard["annotation_review"]
            clip = whiteboard["clip_review"]
            if any(whiteboard[name].get("status") != "approved" for name in WHITEBOARD_STAGES):
                raise ValueError(f"whiteboard stages are not approved: {asset_id}")
            _require_path_checksum(source, "source_image", repository_root, require_disk=True)
            _require_path_checksum(annotation, "annotation", repository_root, require_disk=True)
            _require_path_checksum(annotation, "preview", repository_root, require_disk=True)
            clip_checksum = _require_path_checksum(clip, "clip", repository_root, require_disk=True)
            _require_path_checksum(clip, "render_evidence", repository_root, require_disk=True)
            if item.get("approved_checksum_sha256") != clip_checksum:
                raise ValueError(f"whiteboard approved checksum is stale: {asset_id}")
            checksum_map[asset_id] = clip_checksum
            continue
        evidence = _require_exact_presented_bytes(
            item, repository_root, require_disk=True,
        )
        if item.get("approved_checksum_sha256") != evidence["checksum_sha256"]:
            raise ValueError(f"approved checksum does not match disk: {asset_id}")
        if review.get("mode") == "hybrid_batch_v1" and (
            item.get("approval_disk_checksum_sha256") != evidence["checksum_sha256"]
            or item.get("approval_disk_measured_dimensions") != evidence["measured_dimensions"]
        ):
            raise ValueError(f"approval-time disk evidence is missing or stale: {asset_id}")
        checksum_map[asset_id] = evidence["checksum_sha256"]
    payload = {
        "contract_version": "visual-assets-lock-verification-v1",
        "mode": review["mode"],
        "assets": [
            {"asset_id": asset_id, "checksum_sha256": checksum}
            for asset_id, checksum in checksum_map.items()
        ],
    }
    encoded = json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode("utf-8")
    return {
        **payload,
        "active_asset_count": len(checksum_map),
        "verification_sha256": hashlib.sha256(encoded).hexdigest(),
        "result": "pass",
    }


def _invalidate_dependents(queue: list[dict[str, Any]], asset_id: str) -> None:
    pending = [asset_id]
    invalidated = {asset_id}
    while pending:
        current = pending.pop()
        for item in queue:
            candidate_id = item.get("asset_id")
            if candidate_id not in invalidated and current in item.get("depends_on", []):
                invalidated.add(candidate_id)
                pending.append(candidate_id)
    for item in queue:
        if item.get("asset_id") in invalidated and item.get("asset_id") != asset_id:
            item["status"] = "pending_generation"
            for key in list(item):
                if key.startswith("approved_") or key.startswith("presented_") or key.startswith("batch_"):
                    item.pop(key, None)


def record_hybrid_changes_requested(
    state: dict[str, Any], asset_id: str,
    decision_message: str, decision_time: str
) -> dict[str, Any]:
    review = _review(state)
    if review.get("mode") != "hybrid_batch_v1":
        raise ValueError("hybrid change request requires hybrid_batch_v1 mode")
    if not decision_message.strip():
        raise ValueError("change request message is empty")
    queue = _queue(state)
    item = _find(queue, asset_id)
    manifest = review.get("active_batch")
    if item is None or not isinstance(manifest, dict) or asset_id not in manifest.get("asset_ids", []):
        raise ValueError(f"asset is not in the active hybrid batch: {asset_id}")
    item.update(
        status="changes_requested",
        strict_review=True,
        is_revision=True,
        decision_message=decision_message,
        decision_time=decision_time,
    )
    for key in list(item):
        if key.startswith("approved_") or key.startswith("presented_") or key.startswith("batch_"):
            item.pop(key, None)
    _invalidate_dependents(queue, asset_id)
    for candidate_id in manifest["asset_ids"]:
        candidate = _find(queue, candidate_id)
        if candidate is not None and candidate is not item and candidate.get("status") != "approved":
            candidate["status"] = "awaiting_batch_qa"
            candidate.pop("batch_qa_checksum_sha256", None)
    review.pop("active_batch", None)
    review["queue_generation_allowed"] = True
    return item


def _main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["validate-locked"])
    parser.add_argument("state_file")
    parser.add_argument("--repository-root", required=True)
    args = parser.parse_args()
    state_path = _resolve_regular_file(args.repository_root, args.state_file)
    try:
        state = json.loads(state_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ValueError(f"episode state is unreadable: {error}") from error
    print(json.dumps(
        validate_visual_assets_locked(state, args.repository_root),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ))


if __name__ == "__main__":
    _main()
