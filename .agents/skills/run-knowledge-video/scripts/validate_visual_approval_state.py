#!/usr/bin/env python3
"""Enforce sequential, exact-byte approval for knowledge-video visuals."""

from __future__ import annotations

import argparse
import copy
import html
import hashlib
import json
import re
import struct
import subprocess
from pathlib import Path
from typing import Any


SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
APPROVAL_WORDS = ("批准", "通过", "符合预期", "approve", "approved")
REVIEW_MODES = {
    "sequential_per_image", "batch_final_review", "hybrid_batch_v1",
    "one_click_final_review_v1",
}
GENERATION_UNLOCKING_STATUSES = {
    "approved", "qa_passed_pending_batch_review", "qa_passed_pending_final_review",
}
WHITEBOARD_ROUTE = "srt-whiteboard-animation"
LOCAL_VIDEO_ROUTE = "local-video-file"
IAN_ROUTE = "ian-handdrawn-ppt"
WHITEBOARD_STAGES = ("source_image_review", "annotation_review", "clip_review")
WHITE_CAT_QA_ROUTES = {"imagegen", "xuan-paper-diorama"}
WHITE_CAT_STYLE_OPTIONS = {
    "loose-line-vivid-watercolor": (
        "imagegen-watercolor-narrative", "warm-paper-watercolor-cohesion-v1"
    ),
    "twilight-neon-animation": (
        "imagegen-twilight-neon-narrative", "twilight-luminous-cohesion-v1"
    ),
}
WHITE_CAT_LIMB_IDS = {"F1", "F2", "H1", "H2"}
WHITE_CAT_MASTER_ROLES = {
    "base/master", "white-cat-master", "recurring-character-master",
}
WHITE_CAT_IMAGEGEN_MASTER_QA = "ordinary-imagegen-white-cat-master-qa-v2"
WHITE_CAT_IMAGEGEN_ACTION_QA = "ordinary-imagegen-white-cat-action-qa-v2"
WHITE_CAT_XUAN_MASTER_QA = "xuan-paper-diorama-asset-qa-v1"
WHITE_CAT_XUAN_ACTION_QA = "xuan-paper-diorama-action-qa-v1"
FINAL_REVIEW_PACKAGE_CONTRACT = "final-production-asset-review-package-v1"
FINAL_REVIEW_ASSETS_PER_PAGE = 12


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


def _parse_rate(value: Any) -> float:
    parts = str(value or "").split("/")
    try:
        rate = float(parts[0]) / float(parts[1]) if len(parts) == 2 else float(parts[0])
    except (ValueError, ZeroDivisionError):
        rate = 0
    if rate <= 0:
        raise ValueError("local video frame rate is invalid")
    return rate


def _probe_video_evidence(path: Path) -> dict[str, Any]:
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error", "-show_streams", "-show_format",
                "-of", "json", str(path),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError as error:
        raise ValueError("ffprobe is required to verify an approved local video") from error
    except subprocess.CalledProcessError as error:
        raise ValueError(f"approved local video probe failed: {error.stderr.strip()}") from error
    probe = json.loads(result.stdout)
    streams = probe.get("streams", [])
    videos = [stream for stream in streams if stream.get("codec_type") == "video"]
    audios = [stream for stream in streams if stream.get("codec_type") == "audio"]
    video = videos[0] if videos else {}
    rotations = [
        entry.get("rotation") for entry in video.get("side_data_list", [])
        if entry.get("rotation") is not None
    ]
    rotation = rotations[0] if rotations else video.get("tags", {}).get("rotate", 0)
    duration = float(video.get("duration") or probe.get("format", {}).get("duration") or 0)
    if duration <= 0:
        raise ValueError("approved local video duration is invalid")
    return {
        "video_streams": len(videos),
        "audio_streams": len(audios),
        "width": int(video.get("width") or 0),
        "height": int(video.get("height") or 0),
        "codec": video.get("codec_name"),
        "rotation_degrees": int(float(rotation or 0)),
        "source_duration_seconds": duration,
        "source_fps": _parse_rate(video.get("avg_frame_rate") or video.get("r_frame_rate")),
        "probe_result": "pass",
    }


def _is_local_video(item: dict[str, Any]) -> bool:
    return item.get("visual_generation_route") == LOCAL_VIDEO_ROUTE


def _disk_evidence(
    repository_root: str | Path, path_value: Any, item: dict[str, Any] | None = None,
) -> dict[str, Any]:
    path = _resolve_regular_file(repository_root, path_value)
    if item is not None and _is_local_video(item):
        return {
            "path": path,
            "checksum_sha256": _sha256_file(path),
            "media": _probe_video_evidence(path),
        }
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
    queue = [
        item
        for item in _review(state)["queue"]
        if item.get("active_for_current_storyboard") is not False
        and item.get("status") != "superseded"
    ]
    local_video_seen = False
    style_selection = state.get("white_cat_visual_style_selection")
    current_style = isinstance(style_selection, dict)
    if current_style:
        style_id = style_selection.get("style_id")
        option = WHITE_CAT_STYLE_OPTIONS.get(style_id)
        selection_sha256 = style_selection.get("selection_sha256")
        if (
            style_selection.get("contract_version")
            != "white-cat-visual-style-selection-v1"
            or option is None
            or not SHA256_RE.fullmatch(selection_sha256 or "")
            or style_selection.get("treatment_profile_id") != option[0]
            or style_selection.get("visual_cohesion_profile_id") != option[1]
        ):
            raise ValueError("white-cat visual style selection is invalid")
    for item in queue:
        if current_style and item.get("white_cat_present") is True:
            if (
                item.get("visual_generation_route") != "imagegen"
                or item.get("white_cat_visual_style_id") != style_id
                or item.get("white_cat_visual_style_selection_sha256")
                != selection_sha256
                or item.get("visual_cohesion_profile_id") != option[1]
                or item.get("treatment_profile_id") != option[0]
            ):
                raise ValueError(
                    f"current white-cat asset lacks the Gate-2 ImageGen style binding: "
                    f"{item.get('asset_id')}"
                )
        if _is_local_video(item):
            local_video_seen = True
        elif local_video_seen:
            raise ValueError("local-video-file queue items must be ordered after every generated visual")
    return queue


def _find(queue: list[dict[str, Any]], asset_id: str) -> dict[str, Any] | None:
    return next((item for item in queue if item.get("asset_id") == asset_id), None)


def _validate_visual_cohesion_qa(
    state: dict[str, Any],
    queue: list[dict[str, Any]],
    repository_root: str | Path,
) -> dict[str, Any] | None:
    selection = state.get("white_cat_visual_style_selection")
    if not isinstance(selection, dict):
        return None
    qa = state.get("visual_cohesion_qa")
    expected_asset_ids = [
        item.get("asset_id") for item in queue if not _is_local_video(item)
    ]
    if (
        not isinstance(qa, dict)
        or qa.get("contract_version") != "episode-visual-cohesion-qa-v1"
        or qa.get("result") != "pass"
        or qa.get("white_cat_visual_style_selection_sha256")
        != selection.get("selection_sha256")
        or qa.get("visual_cohesion_profile_id")
        != selection.get("visual_cohesion_profile_id")
        or qa.get("covered_asset_ids") != expected_asset_ids
        or qa.get("anomalies") != []
    ):
        raise ValueError("episode visual cohesion QA is missing, stale, partial, or rejected")
    overview = qa.get("overview")
    if not isinstance(overview, dict):
        raise ValueError("episode visual cohesion QA overview is missing")
    file = _resolve_regular_file(repository_root, overview.get("path"))
    if _sha256_file(file) != overview.get("checksum_sha256"):
        raise ValueError("episode visual cohesion QA overview changed on disk")
    return qa


def _is_whiteboard(item: dict[str, Any]) -> bool:
    return item.get("visual_generation_route") == WHITEBOARD_ROUTE


def _require_white_cat_qa_v2_state(
    item: dict[str, Any], repository_root: str | Path | None = None,
) -> dict[str, Any] | None:
    """Check recorder-bound white-cat v2 evidence and optionally reread its map."""
    route = item.get("visual_generation_route")
    if item.get("white_cat_present") is not True or route not in WHITE_CAT_QA_ROUTES:
        return None

    is_master = item.get("role") in WHITE_CAT_MASTER_ROLES
    expected_qa_contract = {
        ("imagegen", True): WHITE_CAT_IMAGEGEN_MASTER_QA,
        ("imagegen", False): WHITE_CAT_IMAGEGEN_ACTION_QA,
        ("xuan-paper-diorama", True): WHITE_CAT_XUAN_MASTER_QA,
        ("xuan-paper-diorama", False): WHITE_CAT_XUAN_ACTION_QA,
    }[(route, is_master)]
    if item.get("qa_contract_version") != expected_qa_contract:
        raise ValueError(
            f"white-cat QA contract version is invalid: {item.get('asset_id')}"
        )

    path = item.get("path")
    checksum = item.get("checksum_sha256")
    if not isinstance(path, str) or not path \
            or not isinstance(checksum, str) or not SHA256_RE.fullmatch(checksum):
        raise ValueError(f"white-cat QA source binding is missing: {item.get('asset_id')}")
    identity = item.get("identity_qa")
    if not isinstance(identity, dict) or identity.get("result") != "pass":
        raise ValueError(f"white-cat identity QA did not pass: {item.get('asset_id')}")
    if (
        identity.get("cat_count") != 1
        or identity.get("foreleg_count") != 2
        or identity.get("hindleg_count") != 2
        or identity.get("paw_count") != 4
    ):
        raise ValueError(f"white-cat P0 counts are invalid: {item.get('asset_id')}")
    if (
        identity.get("accessory_geometry_correct") is not True
        or identity.get("satchel_count") != 1
        or identity.get("bag_strap_count") != 2
        or identity.get("bag_end_attachment_count") != 2
        or identity.get("front_strap_attached_to_forward_bag_end") is not True
        or identity.get("rear_strap_attached_to_rear_bag_end") is not True
        or identity.get("himation_trim_distinct_from_bag_straps") is not True
        or identity.get("satchel_anatomical_flank") != "right"
        or identity.get("both_bag_end_anchors_visibly_traceable") is not True
        or identity.get("strap_paths_spatially_distinct") is not True
        or identity.get("source_retry_policy_compliant") is not True
    ):
        raise ValueError(f"white-cat P2 accessory QA is invalid: {item.get('asset_id')}")
    anatomy = identity.get("anatomy_evidence")
    if not isinstance(anatomy, dict) \
            or anatomy.get("contract_version") != "white-cat-anatomy-qa-v2" \
            or anatomy.get("result") != "pass":
        raise ValueError(f"white-cat anatomy QA v2 did not pass: {item.get('asset_id')}")
    if anatomy.get("source_image") != {
        "path": path,
        "checksum_sha256": checksum,
    }:
        raise ValueError(f"white-cat anatomy source binding is stale: {item.get('asset_id')}")

    traces = anatomy.get("limb_traces")
    if not isinstance(traces, list) or len(traces) != 4 \
            or any(not isinstance(trace, dict) for trace in traces):
        raise ValueError(f"white-cat limb trace evidence is incomplete: {item.get('asset_id')}")
    trace_ids = [trace.get("id") for trace in traces]
    paw_ids = [trace.get("paw_region_id") for trace in traces]
    if any(not isinstance(trace_id, str) for trace_id in trace_ids) \
            or set(trace_ids) != WHITE_CAT_LIMB_IDS or len(set(trace_ids)) != 4:
        raise ValueError(f"white-cat limb trace IDs are invalid: {item.get('asset_id')}")
    if any(not isinstance(paw_id, str) or not paw_id.strip() for paw_id in paw_ids) \
            or len(set(paw_ids)) != 4:
        raise ValueError(f"white-cat paw region IDs are invalid: {item.get('asset_id')}")
    for direction in ("forward_trace_ids", "reverse_trace_ids"):
        ids = anatomy.get(direction)
        if not isinstance(ids, list) or len(ids) != 4 \
                or any(not isinstance(trace_id, str) for trace_id in ids) \
                or set(ids) != WHITE_CAT_LIMB_IDS or len(set(ids)) != 4:
            raise ValueError(
                f"white-cat bidirectional trace evidence is invalid: {item.get('asset_id')}"
            )
    if any(anatomy.get(field) != 0 for field in (
        "unassigned_paw_like_shapes",
        "ambiguous_limb_regions",
        "branched_or_fused_limb_regions",
    )):
        raise ValueError(f"white-cat unresolved limb regions remain: {item.get('asset_id')}")

    inspection = anatomy.get("inspection_evidence")
    numbered_map_checksum = (
        inspection.get("numbered_limb_map_checksum_sha256")
        if isinstance(inspection, dict) else None
    )
    numbered_map_path = (
        inspection.get("numbered_limb_map_path")
        if isinstance(inspection, dict) else None
    )
    if not isinstance(inspection, dict) \
            or inspection.get("methods") != ["full_resolution", "numbered_limb_map"] \
            or not isinstance(numbered_map_path, str) \
            or not numbered_map_path \
            or Path(numbered_map_path).is_absolute() \
            or ".." in Path(numbered_map_path).parts \
            or not isinstance(numbered_map_checksum, str) \
            or not SHA256_RE.fullmatch(numbered_map_checksum) \
            or inspection.get("numbered_limb_map_source_checksum_sha256") != checksum \
            or inspection.get("numbered_limb_map_limb_ids") != ["F1", "F2", "H1", "H2"]:
        raise ValueError(
            f"white-cat numbered limb-map evidence is stale: {item.get('asset_id')}"
        )
    if repository_root is not None:
        try:
            numbered_map = _resolve_regular_file(repository_root, numbered_map_path)
        except ValueError as error:
            raise ValueError(
                f"white-cat numbered limb map is unavailable: {item.get('asset_id')}"
            ) from error
        if _sha256_file(numbered_map) != numbered_map_checksum:
            raise ValueError(
                f"white-cat numbered limb map changed on disk: {item.get('asset_id')}"
            )
    return {
        "numbered_limb_map_path": numbered_map_path,
        "numbered_limb_map_checksum_sha256": numbered_map_checksum,
        "numbered_limb_map_source_checksum_sha256": checksum,
        "numbered_limb_map_limb_ids": ["F1", "F2", "H1", "H2"],
    }


def _is_strict(item: dict[str, Any], queue: list[dict[str, Any]]) -> bool:
    if _is_whiteboard(item) or _is_local_video(item):
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
    attempt_control = current.get("image_generation_attempt_control", {})
    if attempt_control.get("automatic_retry_status") == "stopped_user_takeover_required":
        raise ValueError(f"automatic image retry stopped; user takeover required: {asset_id}")
    legacy_white_cat_control = current.get("white_cat_generation_attempt_control", {})
    if legacy_white_cat_control.get("automatic_retry_status") == "stopped_user_takeover_required":
        raise ValueError(f"white-cat automatic retry stopped; user takeover required: {asset_id}")
    if _is_local_video(current):
        raise ValueError("local-video-file must be imported only after generated visuals, not generated")
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
    review = _review(state)
    is_current_strict_hybrid_target = bool(
        item
        and review.get("mode") == "hybrid_batch_v1"
        and review.get("current_asset_id") == asset_id
        and _is_strict(item, queue)
    )
    if item is None or (not is_current_strict_hybrid_target and (current is None or item is not current)):
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
    evidence = _disk_evidence(repository_root, item["path"], item)
    if evidence["checksum_sha256"] != current:
        raise ValueError(f"approved asset changed on disk: {item.get('asset_id')}")
    if _is_local_video(item):
        expected_media = item.get("media")
        actual_media = evidence["media"]
        for field in (
            "video_streams", "audio_streams", "width", "height", "codec",
            "rotation_degrees", "source_duration_seconds", "source_fps", "probe_result",
        ):
            expected = expected_media.get(field) if isinstance(expected_media, dict) else None
            actual = actual_media[field]
            if isinstance(actual, float):
                if not isinstance(expected, (int, float)) or abs(expected - actual) > 1e-6:
                    raise ValueError(f"approved local video media evidence changed: {field}")
            elif expected != actual:
                raise ValueError(f"approved local video media evidence changed: {field}")
        if not isinstance(expected_media, dict) or expected_media.get("full_decode_result") != "pass":
            raise ValueError("approved local video lacks passing full-decode evidence")
        return evidence
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
    if _is_local_video(item):
        media = item.get("media")
        match = item.get("local_video_match")
        if (
            not isinstance(media, dict)
            or media.get("video_streams") != 1
            or media.get("width") != 1920
            or media.get("height") != 1080
            or media.get("codec") != "h264"
            or media.get("rotation_degrees") != 0
            or media.get("probe_result") != "pass"
            or media.get("full_decode_result") != "pass"
        ):
            raise ValueError("local video must be an unrotated 1920x1080 H.264 source")
        if (
            not isinstance(match, dict)
            or match.get("contract_version") != "local-video-match-v1"
            or match.get("match_status") != "matched"
            or not isinstance(match.get("target_duration_frames"), int)
            or match["target_duration_frames"] < 1
            or not isinstance(match.get("playback_rate"), (int, float))
            or match["playback_rate"] <= 0
        ):
            raise ValueError("local video exact-duration match evidence is invalid")
        expected_rate = media.get("source_duration_seconds") / (
            match["target_duration_frames"] / 30
        )
        if abs(expected_rate - match["playback_rate"]) > 1e-9:
            raise ValueError("local video playback rate is stale")
        item["measured_aspect_ratio_relative_error"] = 0
        return
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
    _require_white_cat_qa_v2_state(item, repository_root)
    ian_package = _require_ian_layered_scene_package(item, repository_root)
    if ian_package is not None \
            and item.get("presented_ian_layered_scene_package") != ian_package:
        raise ValueError("presented Ian layered-scene package is stale")
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
    if ian_package is not None:
        item["approved_ian_layered_scene_package"] = ian_package
    if evidence is not None:
        item["approval_disk_checksum_sha256"] = evidence["checksum_sha256"]
        if _is_local_video(item):
            item["approval_disk_media"] = evidence["media"]
        else:
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


def record_one_click_whiteboard_qa_pass(
    state: dict[str, Any], asset_id: str, stage_name: str, qa_time: str,
    *, repository_root: str | Path,
) -> dict[str, Any]:
    if _review(state).get("mode") != "one_click_final_review_v1":
        raise ValueError("one-click whiteboard QA requires one_click_final_review_v1")
    if stage_name not in WHITEBOARD_STAGES:
        raise ValueError("unknown whiteboard review stage")
    queue = _queue(state)
    item = _find(queue, asset_id)
    if item is None or item is not _next_unapproved(queue) or not _is_whiteboard(item):
        raise ValueError(f"asset is not the current whiteboard QA target: {asset_id}")
    review = _whiteboard_review(item)
    stage = review[stage_name]
    if review.get("current_stage") != stage_name \
            or stage.get("status") != "awaiting_user_approval":
        raise ValueError(f"whiteboard stage is not awaiting QA: {stage_name}")
    if stage_name == "source_image_review":
        checksum = _require_path_checksum(
            stage, "source_image", repository_root, require_disk=True,
        )
        source_path = _resolve_regular_file(repository_root, stage["source_image_path"])
        if list(_png_dimensions(source_path)) != stage.get("measured_dimensions"):
            raise ValueError("whiteboard source image dimensions changed on disk")
        _require_generation_aspect_ratio(state, stage)
        stage["qa_source_image_checksum_sha256"] = checksum
        review["current_stage"] = "annotation_review"
        review["annotation_review"]["status"] = "pending_generation"
        item["status"] = "whiteboard_in_progress"
    elif stage_name == "annotation_review":
        if review["source_image_review"].get("status") != "qa_passed_pending_final_review":
            raise ValueError("whiteboard source image QA has not passed")
        stage["qa_annotation_checksum_sha256"] = _require_path_checksum(
            stage, "annotation", repository_root, require_disk=True,
        )
        stage["qa_preview_checksum_sha256"] = _require_path_checksum(
            stage, "preview", repository_root, require_disk=True,
        )
        review["current_stage"] = "clip_review"
        review["clip_review"]["status"] = "pending_generation"
        item["status"] = "whiteboard_in_progress"
    else:
        if any(review[name].get("status") != "qa_passed_pending_final_review"
               for name in WHITEBOARD_STAGES[:2]):
            raise ValueError("whiteboard source and annotation QA must pass first")
        clip_checksum = _require_path_checksum(
            stage, "clip", repository_root, require_disk=True,
        )
        stage["qa_render_evidence_checksum_sha256"] = _require_path_checksum(
            stage, "render_evidence", repository_root, require_disk=True,
        )
        _require_whiteboard_media(stage)
        item.update(
            status="qa_passed_pending_final_review",
            path=stage["clip_path"],
            checksum_sha256=clip_checksum,
        )
        review["current_stage"] = None
    stage.update(status="qa_passed_pending_final_review", qa_passed_at=qa_time)
    if _next_unapproved(queue) is None:
        state["phase"] = "awaiting_precomposition_visual_review"
        state["current_phase"] = "awaiting_precomposition_visual_review"
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
    _require_white_cat_qa_v2_state(item)
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
        if item.get("status") != "approved":
            _require_white_cat_qa_v2_state(item)
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


def _require_ian_layered_scene_package(
    item: dict[str, Any], repository_root: str | Path | None = None,
) -> dict[str, Any] | None:
    if item.get("visual_generation_route") != IAN_ROUTE:
        return None
    manifest_path = item.get("scene_package_manifest_path")
    manifest_checksum = item.get("scene_package_manifest_checksum_sha256")
    scene_plan = item.get("ian_scene_plan")
    plan_checksum = item.get("ian_scene_plan_sha256")
    members = item.get("ian_scene_package_members")
    if item.get("qa_contract_version") != "ian-layered-scene-qa-v2" \
            or not isinstance(manifest_path, str) or not manifest_path \
            or not SHA256_RE.fullmatch(str(manifest_checksum or "")) \
            or not isinstance(scene_plan, dict) \
            or not SHA256_RE.fullmatch(str(plan_checksum or "")) \
            or not isinstance(members, list) or len(members) < 6:
        raise ValueError(f"Ian layered-scene state is incomplete: {item.get('asset_id')}")
    encoded_plan = json.dumps(
        scene_plan, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode("utf-8")
    if hashlib.sha256(encoded_plan).hexdigest() != plan_checksum:
        raise ValueError(f"Ian layered-scene plan checksum is stale: {item.get('asset_id')}")
    layer_count = scene_plan.get("layer_count")
    if not isinstance(layer_count, int) or layer_count < 1:
        raise ValueError(f"Ian layered-scene plan layer count is invalid: {item.get('asset_id')}")
    expected_roles = ["source-master", "normalized-master", "background"] + [
        "pre-text-layer" for _ in range(layer_count)
    ] + ["semantic-layer" for _ in range(layer_count)] + ["final-composite"]
    if len(members) != 4 + (2 * layer_count):
        raise ValueError(f"Ian layered-scene member count is invalid: {item.get('asset_id')}")
    if [member.get("member_role") for member in members] != expected_roles:
        raise ValueError(f"Ian layered-scene member order is invalid: {item.get('asset_id')}")
    layer_ids = [f"L{index:02d}" for index in range(1, layer_count + 1)]
    expected_layer_ids = [
        "source-master", "normalized-master", "background",
        *layer_ids, *layer_ids, "final-composite",
    ]
    normalized_members = []
    for index, member in enumerate(members):
        member_role = member.get("member_role") if isinstance(member, dict) else None
        expected_width = member.get("width") if member_role == "source-master" else 1920
        expected_height = member.get("height") if member_role == "source-master" else 1080
        if not isinstance(member, dict) \
                or member.get("layer_id") != expected_layer_ids[index] \
                or not isinstance(member.get("path"), str) or not member["path"] \
                or not SHA256_RE.fullmatch(str(member.get("checksum_sha256", ""))) \
                or not isinstance(expected_width, int) or expected_width < 1 \
                or not isinstance(expected_height, int) or expected_height < 1 \
                or member.get("width") != expected_width \
                or member.get("height") != expected_height \
                or member.get("has_alpha") \
                != (member_role in {"pre-text-layer", "semantic-layer"}):
            raise ValueError(
                f"Ian layered-scene member is invalid: {item.get('asset_id')}:{index}"
            )
        normalized_members.append({
            "member_role": member["member_role"],
            "layer_id": member["layer_id"],
            "path": member["path"],
            "checksum_sha256": member["checksum_sha256"],
            "width": expected_width,
            "height": expected_height,
            "has_alpha": member["has_alpha"],
        })
    final_member = normalized_members[-1]
    if final_member["path"] != item.get("path") \
            or final_member["checksum_sha256"] != item.get("checksum_sha256"):
        raise ValueError(f"Ian final composite is stale: {item.get('asset_id')}")
    lineage = item.get("generation_lineage")
    if not isinstance(lineage, list) or len(lineage) != 1:
        raise ValueError(
            f"Ian source master lacks one generation lineage: {item.get('asset_id')}"
        )
    stage = lineage[0]
    source_member = normalized_members[0]
    if not isinstance(stage, dict) \
            or set(stage) != {
                "stage", "generation_mode", "model_id", "prompt",
                "reference_inputs", "output", "selection_status",
            } \
            or stage.get("stage") != "complete-master-generation" \
            or stage.get("generation_mode") \
            != "codex-native-imagegen-gpt-image-2-text-free-master-v1" \
            or stage.get("model_id") != "gpt-image-2" \
            or stage.get("selection_status") != "selected" \
            or stage.get("reference_inputs") != item.get("actual_reference_inputs") \
            or stage.get("output") != {
                "path": source_member["path"],
                "checksum_sha256": source_member["checksum_sha256"],
            }:
        raise ValueError(f"Ian generation lineage is stale: {item.get('asset_id')}:0")
    prompt = stage.get("prompt")
    if not isinstance(prompt, dict) \
            or not isinstance(prompt.get("path"), str) or not prompt["path"] \
            or not SHA256_RE.fullmatch(str(prompt.get("checksum_sha256", ""))):
        raise ValueError(f"Ian generation prompt binding is invalid: {item.get('asset_id')}:0")
    payload = {
        "contract_version": "ian-knowledge-video-layered-scene-v2",
        "manifest": {
            "path": manifest_path,
            "checksum_sha256": manifest_checksum,
        },
        "scene_plan_sha256": plan_checksum,
        "members": normalized_members,
    }
    encoded = json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode("utf-8")
    result = {
        **payload,
        "package_review_sha256": hashlib.sha256(encoded).hexdigest(),
    }
    if repository_root is not None:
        manifest_file = _resolve_regular_file(repository_root, manifest_path)
        if _sha256_file(manifest_file) != manifest_checksum:
            raise ValueError(f"Ian package manifest changed on disk: {item.get('asset_id')}")
        manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
        master_generation = manifest.get("master_generation", {})
        manifest_members = [
            {
                "member_role": "source-master",
                "layer_id": "source-master",
                **master_generation.get("source_master", {}),
            },
            {
                "member_role": "normalized-master",
                "layer_id": "normalized-master",
                **manifest.get("normalized_master", {}),
            },
            {"member_role": "background", "layer_id": "background", **manifest.get("background", {})},
            *[
                {"member_role": "pre-text-layer", **layer}
                for layer in manifest.get("pre_text_layers", [])
            ],
            *[
                {"member_role": "semantic-layer", **layer}
                for layer in manifest.get("layers", [])
            ],
            {
                "member_role": "final-composite",
                "layer_id": "final-composite",
                **manifest.get("final_composite", {}),
            },
        ]
        projected_manifest_members = [
            {
                "member_role": member.get("member_role"),
                "layer_id": member.get("layer_id"),
                "path": member.get("path"),
                "checksum_sha256": member.get("checksum_sha256"),
                "width": member.get("width"),
                "height": member.get("height"),
                "has_alpha": member.get("has_alpha"),
            }
            for member in manifest_members
        ]
        model_provenance = manifest.get("model_provenance", {})
        if manifest.get("contract_version") != "ian-knowledge-video-layered-scene-v2" \
                or manifest.get("queue_item_id") != item.get("asset_id") \
                or manifest.get("shot_id") != item.get("shot_id") \
                or manifest.get("scene_plan") != scene_plan \
                or manifest.get("scene_plan_sha256") != plan_checksum \
                or master_generation.get("contract_version") \
                != "ian-gpt-image-2-text-free-master-v1" \
                or master_generation.get("generator") != "codex-native-imagegen" \
                or master_generation.get("model_id") != "gpt-image-2" \
                or master_generation.get("prompt") != prompt \
                or master_generation.get("reference_inputs") \
                != item.get("actual_reference_inputs") \
                or master_generation.get("source_master") is None \
                or model_provenance.get("contract_version") \
                != "codex-native-imagegen-gpt-image-2-provenance-v1" \
                or model_provenance.get("generator") != "codex-native-imagegen" \
                or model_provenance.get("canonical_model") != "gpt-image-2" \
                or model_provenance.get("evidence_kind") \
                != "embedded-c2pa-software-agent-observation-v1" \
                or model_provenance.get("source_master_checksum_sha256") \
                != source_member["checksum_sha256"] \
                or model_provenance.get("expected_software_agent") \
                != {"name": "gpt-image", "version": "2.0"} \
                or projected_manifest_members != normalized_members:
            raise ValueError(f"Ian package manifest is stale: {item.get('asset_id')}")
        for member in normalized_members:
            member_file = _resolve_regular_file(repository_root, member["path"])
            if _sha256_file(member_file) != member["checksum_sha256"]:
                raise ValueError(
                    f"Ian package member changed on disk: {item.get('asset_id')}:{member['layer_id']}"
                )
        prompt_file = _resolve_regular_file(repository_root, prompt["path"])
        if _sha256_file(prompt_file) != prompt["checksum_sha256"]:
            raise ValueError(f"Ian generation prompt changed on disk: {item.get('asset_id')}:0")
    return result


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
        asset = {"asset_id": item.get("asset_id"), "checksum_sha256": checksum}
        ian_package = _require_ian_layered_scene_package(item)
        if ian_package is not None:
            asset["ian_layered_scene_package"] = ian_package
        assets.append(asset)
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
    mode = review.get("mode")
    if mode not in {"hybrid_batch_v1", "one_click_final_review_v1"}:
        raise ValueError("visual QA pass requires hybrid_batch_v1 or one_click_final_review_v1 mode")
    if mode == "hybrid_batch_v1" and review.get("batch_size") != 4:
        raise ValueError("hybrid_batch_v1 requires batch_size 4")
    queue = _queue(state)
    item = _find(queue, asset_id)
    current = _next_unapproved(queue)
    if item is None or current is None or item is not current:
        raise ValueError(f"asset is not the current hybrid QA target: {asset_id}")
    if mode == "hybrid_batch_v1" and _is_strict(item, queue):
        raise ValueError("strict hybrid assets require per-item exact-byte approval")
    if item.get("status") not in {"awaiting_batch_qa", "awaiting_user_approval"}:
        raise ValueError(f"asset is not awaiting hybrid QA: {asset_id}")
    if not isinstance(item.get("path"), str) or not item["path"]:
        raise ValueError("hybrid QA asset path is missing")
    checksum = item.get("checksum_sha256")
    if not isinstance(checksum, str) or not SHA256_RE.fullmatch(checksum):
        raise ValueError("hybrid QA checksum is invalid")
    _require_white_cat_qa_v2_state(item)
    _require_generation_aspect_ratio(state, item)
    if item.get("technical_qa", {}).get("result") != "pass":
        raise ValueError("hybrid technical QA must pass before review batching")
    pending_status = (
        "qa_passed_pending_final_review"
        if mode == "one_click_final_review_v1"
        else "qa_passed_pending_batch_review"
    )
    item.update(
        status=pending_status,
        batch_qa_checksum_sha256=checksum,
        batch_qa_time=qa_time,
    )
    if mode == "one_click_final_review_v1":
        review["queue_generation_allowed"] = True
        if _next_unapproved(queue) is None:
            state["phase"] = "awaiting_precomposition_visual_review"
            state["current_phase"] = "awaiting_precomposition_visual_review"
        return item
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
    for asset_id in requested:
        item = _find(queue, asset_id)
        if item is not None and item.get("status") != "approved":
            _require_white_cat_qa_v2_state(item, repository_root)
            _require_ian_layered_scene_package(item, repository_root)
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
    if review.get("mode") == "one_click_final_review_v1":
        final_review = review.get("final_review")
        if not isinstance(final_review, dict) \
                or final_review.get("status") != "approved" \
                or final_review.get("exact_hash_list_approved") is not True \
                or not SHA256_RE.fullmatch(final_review.get("asset_list_sha256", "")):
            raise ValueError("one-click visual lock requires complete exact hash-list approval")
        _validate_one_click_final_review_package(
            state, final_review, repository_root,
        )
    if review.get("active_batch") is not None or review.get("queue_generation_allowed") is False:
        raise ValueError("visual asset review still has an active approval boundary")
    checksum_map: dict[str, str] = {}
    for item in queue:
        asset_id = item.get("asset_id")
        if not isinstance(asset_id, str) or not asset_id:
            raise ValueError("visual asset lock contains an invalid asset_id")
        if item.get("status") != "approved":
            raise ValueError(f"visual asset is not approved: {asset_id}")
        if item.get("qa_contract_version") in {
            WHITE_CAT_IMAGEGEN_MASTER_QA,
            WHITE_CAT_IMAGEGEN_ACTION_QA,
            WHITE_CAT_XUAN_MASTER_QA,
            WHITE_CAT_XUAN_ACTION_QA,
        }:
            _require_white_cat_qa_v2_state(item, repository_root)
        _require_ian_layered_scene_package(item, repository_root)
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
            or (
                _is_local_video(item)
                and item.get("approval_disk_media") != evidence["media"]
            )
            or (
                not _is_local_video(item)
                and item.get("approval_disk_measured_dimensions") != evidence["measured_dimensions"]
            )
        ):
            raise ValueError(f"approval-time disk evidence is missing or stale: {asset_id}")
        checksum_map[asset_id] = evidence["checksum_sha256"]
    _validate_visual_cohesion_qa(state, queue, repository_root)
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


def _one_click_final_review_payload(state: dict[str, Any]) -> dict[str, Any]:
    review = _review(state)
    if review.get("contract_version") != "visual-asset-review-v3" \
            or review.get("mode") != "one_click_final_review_v1":
        raise ValueError("one-click final review requires visual-asset-review-v3")
    storyboard_sha256 = review.get("storyboard_sha256")
    policy_sha256 = review.get("policy_sha256")
    if not SHA256_RE.fullmatch(storyboard_sha256 or "") \
            or not SHA256_RE.fullmatch(policy_sha256 or ""):
        raise ValueError("one-click final review bindings are missing")
    assets = []
    for item in _queue(state):
        if item.get("status") != "qa_passed_pending_final_review":
            raise ValueError(f"asset has not passed QA for final review: {item.get('asset_id')}")
        if not isinstance(item.get("path"), str) or not item["path"] \
                or not SHA256_RE.fullmatch(item.get("checksum_sha256", "")):
            raise ValueError(f"asset final-review evidence is incomplete: {item.get('asset_id')}")
        anatomy_review = _require_white_cat_qa_v2_state(item)
        asset = {
            "asset_id": item["asset_id"],
            "path": item["path"],
            "checksum_sha256": item["checksum_sha256"],
            "qa_status": item["status"],
        }
        ian_package = _require_ian_layered_scene_package(item)
        if ian_package is not None:
            asset["ian_layered_scene_package"] = ian_package
        if anatomy_review is not None:
            asset["white_cat_anatomy_review"] = anatomy_review
        assets.append(asset)
    if not assets:
        raise ValueError("one-click final review asset list is empty")
    return {
        "contract_version": "visual-asset-review-v3",
        "mode": "one_click_final_review_v1",
        "storyboard_sha256": storyboard_sha256,
        "policy_sha256": policy_sha256,
        "assets": assets,
    }


def _validate_one_click_final_review_package(
    state: dict[str, Any], final_review: dict[str, Any],
    repository_root: str | Path,
) -> dict[str, Any]:
    package = final_review.get("review_package")
    digest = final_review.get("presented_map_sha256")
    workspace = state.get("workspace_path")
    if not isinstance(package, dict) \
            or package.get("contract_version") != FINAL_REVIEW_PACKAGE_CONTRACT:
        raise ValueError("current image-rich unified final review package is missing")
    if not SHA256_RE.fullmatch(digest or "") \
            or package.get("presented_map_sha256") != digest:
        raise ValueError("image-rich unified final review package digest is stale")
    if not isinstance(workspace, str) or not workspace \
            or Path(workspace).is_absolute() or ".." in Path(workspace).parts:
        raise ValueError("episode workspace binding is invalid")
    short_digest = digest[:8]
    expected_manifest_path = (
        f"{workspace}/schema/final-production-asset-review-{short_digest}.json"
    )
    expected_html_path = (
        f"{workspace}/docs/final-production-asset-review-{short_digest}.html"
    )
    manifest_binding = package.get("manifest")
    html_binding = package.get("html")
    if not isinstance(manifest_binding, dict) \
            or manifest_binding.get("path") != expected_manifest_path \
            or not SHA256_RE.fullmatch(manifest_binding.get("checksum_sha256", "")):
        raise ValueError("image-rich unified final review manifest binding is stale")
    if not isinstance(html_binding, dict) \
            or html_binding.get("path") != expected_html_path \
            or not SHA256_RE.fullmatch(html_binding.get("checksum_sha256", "")):
        raise ValueError("image-rich unified final review HTML binding is stale")

    manifest_path = _resolve_regular_file(repository_root, expected_manifest_path)
    if _sha256_file(manifest_path) != manifest_binding["checksum_sha256"]:
        raise ValueError("image-rich unified final review manifest changed on disk")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ValueError(f"image-rich unified final review manifest is unreadable: {error}") from error
    if manifest.get("contract_version") != FINAL_REVIEW_PACKAGE_CONTRACT \
            or manifest.get("episode_workspace") != workspace \
            or manifest.get("phase") != "awaiting_precomposition_visual_review" \
            or manifest.get("presented_map_sha256") != digest \
            or manifest.get("approval_effect") != "none-display-aid-only" \
            or manifest.get("episode_state_mutated") is not False:
        raise ValueError("image-rich unified final review manifest authority is stale")

    counts = package.get("counts")
    pages = package.get("pages")
    ian_sheets = package.get("ian_stage_sheets")
    outputs = manifest.get("outputs")
    assets = final_review.get("assets")
    manifest_assets = manifest.get("assets")
    if not isinstance(counts, dict) or manifest.get("counts") != counts \
            or not isinstance(pages, list) or not isinstance(ian_sheets, list) \
            or not isinstance(outputs, dict) or outputs.get("html") != html_binding \
            or outputs.get("pages") != pages \
            or outputs.get("ian_stage_sheets") != ian_sheets:
        raise ValueError("image-rich unified final review output map is stale")
    if not isinstance(assets, list) or not isinstance(manifest_assets, list) \
            or len(manifest_assets) != len(assets) \
            or counts.get("asset_count") != len(assets) \
            or counts.get("page_count") != len(pages) \
            or counts.get("page_count") != (
                len(assets) + FINAL_REVIEW_ASSETS_PER_PAGE - 1
            ) // FINAL_REVIEW_ASSETS_PER_PAGE:
        raise ValueError("image-rich unified final review counts are stale")
    expected_ian_count = sum(
        1 for item in _queue(state)
        if item.get("visual_generation_route") == IAN_ROUTE
    )
    if counts.get("ian_package_count") != expected_ian_count \
            or len(ian_sheets) != expected_ian_count:
        raise ValueError("image-rich unified final review Ian package count is stale")
    for expected, actual in zip(assets, manifest_assets, strict=True):
        for field in ("asset_id", "path", "checksum_sha256", "qa_status"):
            expected_value = expected.get(field)
            if field == "qa_status" and final_review.get("status") == "approved":
                expected_value = "qa_passed_pending_final_review"
            if actual.get(field) != expected_value:
                raise ValueError(
                    f"image-rich unified final review asset map is stale: "
                    f"{expected.get('asset_id')}"
                )

    html_path = _resolve_regular_file(repository_root, expected_html_path)
    if _sha256_file(html_path) != html_binding["checksum_sha256"]:
        raise ValueError("image-rich unified final review HTML changed on disk")
    try:
        html_text = html_path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        raise ValueError(f"image-rich unified final review HTML is unreadable: {error}") from error
    required_metadata = (
        f'<meta name="final-production-review-contract" content="{FINAL_REVIEW_PACKAGE_CONTRACT}">',
        f'<meta name="final-production-review-map-sha256" content="{digest}">',
        f'<meta name="final-production-review-asset-count" content="{len(assets)}">',
        f'<meta name="final-production-review-ian-package-count" content="{expected_ian_count}">',
    )
    if any(marker not in html_text for marker in required_metadata) \
            or html_text.count('data-final-review-asset="1"') != len(assets) \
            or html_text.count('data-ian-package="1"') != expected_ian_count:
        raise ValueError("image-rich unified final review HTML content is incomplete")
    for asset in assets:
        escaped_id = html.escape(asset["asset_id"], quote=True)
        if html_text.count(f'data-asset-id="{escaped_id}"') != 1 \
                or asset["checksum_sha256"] not in html_text:
            raise ValueError(
                f"image-rich unified final review HTML omits asset: {asset['asset_id']}"
            )

    for output in [*pages, *ian_sheets]:
        if not isinstance(output, dict) or output.get("width") != 1920 \
                or output.get("height") != 1080 \
                or not SHA256_RE.fullmatch(output.get("checksum_sha256", "")):
            raise ValueError("image-rich unified final review sheet binding is invalid")
        output_path = output.get("path")
        if not isinstance(output_path, str) or not output_path.startswith(
            f"{workspace}/assets/image/review/final-production-assets-{short_digest}-"
        ):
            raise ValueError("image-rich unified final review sheet path is stale")
        sheet = _resolve_regular_file(repository_root, output_path)
        if _sha256_file(sheet) != output["checksum_sha256"] \
                or _png_dimensions(sheet) != (1920, 1080):
            raise ValueError("image-rich unified final review sheet changed on disk")
    return package


def bind_one_click_final_review_package(
    state: dict[str, Any], package_report: dict[str, Any], *,
    repository_root: str | Path,
) -> dict[str, Any]:
    review = _review(state)
    final_review = review.get("final_review")
    if state.get("phase") != "awaiting_precomposition_visual_review" \
            or state.get("current_phase") != "awaiting_precomposition_visual_review" \
            or not isinstance(final_review, dict) \
            or final_review.get("status") != "pending":
        raise ValueError("episode is not awaiting one-click final visual review")
    if package_report.get("contract_version") != FINAL_REVIEW_PACKAGE_CONTRACT \
            or package_report.get("presented_map_sha256") != final_review.get(
                "presented_map_sha256"
            ) \
            or package_report.get("episode_state_mutated") is not False:
        raise ValueError("final production review package report is stale")
    package = {
        "contract_version": package_report["contract_version"],
        "presented_map_sha256": package_report["presented_map_sha256"],
        "counts": copy.deepcopy(package_report.get("counts")),
        "manifest": copy.deepcopy(package_report.get("manifest")),
        "html": copy.deepcopy(package_report.get("html")),
        "pages": copy.deepcopy(package_report.get("pages")),
        "ian_stage_sheets": copy.deepcopy(package_report.get("ian_stage_sheets")),
    }
    candidate = copy.deepcopy(final_review)
    candidate["review_package"] = package
    _validate_one_click_final_review_package(state, candidate, repository_root)
    final_review["review_package"] = package
    return package


def present_one_click_final_visual_review(state: dict[str, Any]) -> dict[str, Any]:
    payload = _one_click_final_review_payload(state)
    encoded = json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode("utf-8")
    final_review = {
        **payload,
        "presented_map_sha256": hashlib.sha256(encoded).hexdigest(),
        "status": "pending",
    }
    _review(state)["final_review"] = final_review
    state["phase"] = "awaiting_precomposition_visual_review"
    state["current_phase"] = "awaiting_precomposition_visual_review"
    return final_review


def approve_one_click_final_visual_review(
    state: dict[str, Any], presented_map_sha256: str,
    decision_message: str, decision_time: str, *, repository_root: str | Path,
) -> dict[str, Any]:
    _require_explicit_approval(decision_message)
    review = _review(state)
    final_review = review.get("final_review")
    expected = present_one_click_final_visual_review(state)
    if not isinstance(final_review, dict) \
            or final_review.get("status") != "pending" \
            or presented_map_sha256 != expected["presented_map_sha256"] \
            or final_review.get("presented_map_sha256") != expected["presented_map_sha256"]:
        raise ValueError("one-click final visual approval is stale or not bound to the complete list")
    for item in _queue(state):
        _require_white_cat_qa_v2_state(item, repository_root)
        _require_ian_layered_scene_package(item, repository_root)
        evidence = _disk_evidence(repository_root, item["path"], item)
        if evidence["checksum_sha256"] != item["checksum_sha256"]:
            raise ValueError(f"one-click final visual changed on disk: {item['asset_id']}")
    review_package = _validate_one_click_final_review_package(
        state, final_review, repository_root,
    )
    for item in _queue(state):
        if _is_whiteboard(item):
            whiteboard = _whiteboard_review(item)
            source = whiteboard["source_image_review"]
            annotation = whiteboard["annotation_review"]
            clip = whiteboard["clip_review"]
            if any(whiteboard[name].get("status") != "qa_passed_pending_final_review"
                   for name in WHITEBOARD_STAGES):
                raise ValueError(f"whiteboard QA is incomplete: {item['asset_id']}")
            source.update(
                status="approved",
                approved_source_image_checksum_sha256=source["qa_source_image_checksum_sha256"],
            )
            annotation.update(
                status="approved",
                approved_annotation_checksum_sha256=annotation["qa_annotation_checksum_sha256"],
                approved_preview_checksum_sha256=annotation["qa_preview_checksum_sha256"],
            )
            clip.update(
                status="approved",
                approved_clip_checksum_sha256=item["checksum_sha256"],
                approved_render_evidence_checksum_sha256=clip[
                    "qa_render_evidence_checksum_sha256"
                ],
            )
            item["whiteboard_approved_checksums"] = {
                "source_image_sha256": source["approved_source_image_checksum_sha256"],
                "annotation_sha256": annotation["approved_annotation_checksum_sha256"],
                "preview_sha256": annotation["approved_preview_checksum_sha256"],
                "clip_sha256": clip["approved_clip_checksum_sha256"],
                "render_evidence_sha256": clip["approved_render_evidence_checksum_sha256"],
            }
        item.update(
            status="approved",
            presented_checksum_sha256=item["checksum_sha256"],
            approved_checksum_sha256=item["checksum_sha256"],
            decision_message=decision_message,
            decision_time=decision_time,
        )
    final_review = {
        **expected,
        "assets": [
            {**asset, "qa_status": "approved"} for asset in expected["assets"]
        ],
        "status": "approved",
        "exact_hash_list_approved": True,
        "asset_list_sha256": expected["presented_map_sha256"],
        "decision_message": decision_message,
        "decision_time": decision_time,
        "review_package": copy.deepcopy(review_package),
    }
    review["final_review"] = final_review
    review["queue_generation_allowed"] = True
    state["phase"] = "awaiting_caption_delivery_choice"
    state["current_phase"] = "awaiting_caption_delivery_choice"
    return final_review


def record_one_click_changes_requested(
    state: dict[str, Any], asset_id: str,
    decision_message: str, decision_time: str,
) -> dict[str, Any]:
    """Invalidate a pending exact list and requeue only the named asset family."""
    if state.get("phase") != "awaiting_precomposition_visual_review" \
            or state.get("current_phase") != "awaiting_precomposition_visual_review":
        raise ValueError("episode is not awaiting one-click final visual review")
    if not decision_message.strip():
        raise ValueError("change request message is empty")
    review = _review(state)
    if review.get("contract_version") != "visual-asset-review-v3" \
            or review.get("mode") != "one_click_final_review_v1":
        raise ValueError("one-click visual change requires visual-asset-review-v3")
    queue = _queue(state)
    item = _find(queue, asset_id)
    if item is None or item.get("status") != "qa_passed_pending_final_review":
        raise ValueError(f"asset is not in the pending one-click exact list: {asset_id}")

    payload = _one_click_final_review_payload(state)
    encoded = json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode("utf-8")
    expected_final_review = {
        **payload,
        "presented_map_sha256": hashlib.sha256(encoded).hexdigest(),
        "status": "pending",
    }
    prior_final_review = review.get("final_review")
    comparable_prior = copy.deepcopy(prior_final_review)
    if isinstance(comparable_prior, dict):
        comparable_prior.pop("review_package", None)
    if comparable_prior != expected_final_review:
        raise ValueError("one-click final visual review is stale or malformed")

    affected_ids = {asset_id}
    pending = [asset_id]
    while pending:
        dependency_id = pending.pop()
        for candidate in queue:
            candidate_id = candidate.get("asset_id")
            if candidate_id not in affected_ids \
                    and dependency_id in candidate.get("depends_on", []):
                affected_ids.add(candidate_id)
                pending.append(candidate_id)
    ordered_affected_ids = [
        candidate["asset_id"] for candidate in queue
        if candidate.get("asset_id") in affected_ids
    ]
    prior_items = [
        copy.deepcopy(candidate) for candidate in queue
        if candidate.get("asset_id") in affected_ids
    ]
    state.setdefault("superseded_artifacts", []).append({
        "record_type": "superseded_one_click_final_visual_review",
        "reason": "user_requested_asset_pixel_revision_during_pending_exact_list_review",
        "superseded_at": decision_time,
        "prior_presented_map_sha256": expected_final_review["presented_map_sha256"],
        "prior_review_status": "pending",
        "affected_asset_ids": ordered_affected_ids,
        "preserved_unaffected_asset_count": len(queue) - len(affected_ids),
        "prior_final_review": copy.deepcopy(prior_final_review),
        "prior_queue_items": prior_items,
        "user_change_request": decision_message.strip(),
        "files_deleted": False,
        "preservation_policy": "preserve_exact_historical_bytes",
    })

    stale_exact_keys = {
        "path", "checksum_sha256", "measured_dimensions",
        "measured_aspect_ratio_relative_error", "generator",
        "actual_reference_inputs", "state_visible_text",
        "technical_qa", "semantic_qa", "visible_text_qa", "style_qa", "visual_qa",
        "qa_contract_version", "revision_source", "ian_scene_plan_sha256",
        "ian_scene_package_members", "generation_lineage",
    }
    stale_prefixes = (
        "approved_", "presented_", "batch_", "generated_source_",
        "normalization_evidence_", "frame_manifest_", "qa_evidence_",
        "prompt_", "style_skill_", "style_anchor_", "style_profile_",
        "scene_package_manifest_",
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
    item["is_revision"] = True
    item["strict_review"] = False
    review.pop("final_review", None)
    review["status"] = "in_progress"
    review["queue_generation_allowed"] = True
    review["current_asset_id"] = asset_id
    state["phase"] = "visual_production"
    state["current_phase"] = "visual_production"
    return item


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
