#!/usr/bin/env python3
"""Validation primitives for project whiteboard annotations and render evidence."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any


WIDTH = 1920
HEIGHT = 1080
FPS = 30
MIN_FINAL_HOLD_FRAMES = 15
ROUTE_ID = "srt-whiteboard-animation"
ACTION_FAMILY_REPLACEMENT = "whiteboard-element-sequence-replaces-action-family-v1"
DRAWING_OVERLAY_POLICY = "canvas-only-no-hand-pen-cursor-v1"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
REPOSITORY_ROOT = Path(__file__).resolve().parents[4]


class ContractError(ValueError):
    pass


def sha256_file(path: str | Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path: str | Path) -> dict[str, Any]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ContractError("JSON root must be an object")
    return data


def resolve_within(root: str | Path, value: str | Path, *, must_exist: bool) -> Path:
    root_path = Path(root).resolve(strict=True)
    repository = REPOSITORY_ROOT.resolve(strict=True)
    try:
        root_path.relative_to(repository)
    except ValueError as error:
        raise ContractError("episode workspace is outside the repository") from error
    raw = Path(value)
    if raw.is_absolute():
        raise ContractError(f"path must be repository-root-relative: {value}")
    candidate = repository / raw
    if must_exist:
        resolved = candidate.resolve(strict=True)
    else:
        parent = candidate.parent.resolve(strict=True)
        resolved = parent / candidate.name
    try:
        resolved.relative_to(root_path)
    except ValueError as error:
        raise ContractError(f"path escapes episode workspace: {value}") from error
    return resolved


def _integer(value: Any, label: str, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ContractError(f"{label} must be an integer >= {minimum}")
    return value


def _string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ContractError(f"{label} must be a non-empty string")
    return value


def _sha(value: Any, label: str) -> str:
    if not isinstance(value, str) or not SHA256_RE.fullmatch(value):
        raise ContractError(f"{label} must be a lowercase SHA-256")
    return value


def _rect(value: Any, label: str) -> dict[str, int]:
    if not isinstance(value, dict):
        raise ContractError(f"{label} must be an object")
    rect = {
        key: _integer(value.get(key), f"{label}.{key}", 1 if key in {"width", "height"} else 0)
        for key in ("x", "y", "width", "height")
    }
    if rect["x"] + rect["width"] > WIDTH or rect["y"] + rect["height"] > HEIGHT:
        raise ContractError(f"{label} is outside the 1920x1080 canvas")
    return rect


def _intersects(first: dict[str, int], second: dict[str, int]) -> bool:
    return not (
        first["x"] + first["width"] <= second["x"]
        or second["x"] + second["width"] <= first["x"]
        or first["y"] + first["height"] <= second["y"]
        or second["y"] + second["height"] <= first["y"]
    )


def validate_source_aspect(width: int, height: int, tolerance: float = 0.005) -> float:
    _integer(width, "source width", 1)
    _integer(height, "source height", 1)
    if width <= height:
        raise ContractError("whiteboard source must be landscape")
    target = 16 / 9
    relative_error = abs(width / height - target) / target
    if relative_error > tolerance:
        raise ContractError("whiteboard source aspect ratio exceeds 0.5% tolerance")
    return relative_error


def validate_visual_direction_binding(payload: dict[str, Any], episode_workspace: str | Path) -> dict[str, Any]:
    root = Path(episode_workspace).resolve(strict=True)
    review_value = _string(payload.get("visual_direction_review_path"), "visual_direction_review_path")
    if Path(review_value).is_absolute():
        raise ContractError("visual_direction_review_path must be repository-root-relative")
    review_path = resolve_within(root, review_value, must_exist=True)
    review_sha = _sha(payload.get("visual_direction_review_sha256"), "visual_direction_review_sha256")
    if sha256_file(review_path) != review_sha:
        raise ContractError("visual direction review checksum is stale")
    review = read_json(review_path)
    if review.get("contract_version") != "per-shot-visual-direction-review-v3":
        raise ContractError("whiteboard production requires per-shot-visual-direction-review-v3")
    presented = _sha(payload.get("presented_map_sha256"), "presented_map_sha256")
    if review.get("presented_map_sha256") != presented:
        raise ContractError("whiteboard presented-map binding is stale")
    state_path = root / "schema" / "episode-state.json"
    if not state_path.is_file() or state_path.is_symlink():
        raise ContractError("current episode state is required for whiteboard approval binding")
    state_binding = read_json(state_path).get("visual_direction_review")
    if not isinstance(state_binding, dict) or state_binding.get("status") != "approved":
        raise ContractError("episode state does not record an approved visual direction review")
    if state_binding.get("artifact_path") != review_value:
        raise ContractError("whiteboard review is not the current episode-state artifact")
    if state_binding.get("artifact_checksum_sha256") != review_sha:
        raise ContractError("episode-state visual direction checksum is stale")
    if state_binding.get("presented_map_sha256") != presented:
        raise ContractError("episode-state presented-map binding is stale")
    rows = review.get("rows")
    if not isinstance(rows, list):
        raise ContractError("visual direction review rows are missing")
    matches = [
        row for row in rows
        if isinstance(row, dict) and row.get("shot_id") == payload.get("shot_id")
    ]
    if len(matches) != 1:
        raise ContractError("whiteboard must resolve exactly one visual direction row")
    row = matches[0]
    selection = row.get("user_selection")
    if not isinstance(selection, dict) or selection.get("status") != "approved":
        raise ContractError("whiteboard visual direction row is not approved")
    if selection.get("presented_map_sha256") != presented:
        raise ContractError("whiteboard row selection has stale presented-map evidence")
    if selection.get("visual_generation_route") != ROUTE_ID:
        raise ContractError("whiteboard route does not match the approved v3 row")
    if selection.get("white_cat_present") is not False:
        raise ContractError("whiteboard v3 row must forbid the white cat")
    if row.get("scene_class") != payload.get("scene_class"):
        raise ContractError("whiteboard scene_class does not match the approved v3 row")
    mode = payload.get("visible_text_mode")
    exact = selection.get("exact_visible_text")
    placement = selection.get("visible_text_placement")
    for source in (row, selection):
        if source.get("visible_text_mode") != mode:
            raise ContractError("whiteboard visible-text mode does not match v3")
        if source.get("exact_visible_text") != exact:
            raise ContractError("whiteboard exact visible text is inconsistent inside v3")
        if source.get("visible_text_placement") != placement:
            raise ContractError("whiteboard text placement is inconsistent inside v3")
    expected_text = [] if mode == "none" else [_string(exact, "approved v3 exact_visible_text")]
    if payload.get("approved_visible_text") != expected_text:
        raise ContractError("whiteboard approved visible text does not equal v3")
    if payload.get("approved_text_placement") != placement:
        raise ContractError("whiteboard approved text placement does not equal v3")
    return row


def validate_annotation(
    annotation: dict[str, Any],
    *,
    episode_workspace: str | Path | None = None,
    allow_legacy_read_only: bool = False,
) -> dict[str, Any]:
    version = annotation.get("contract_version")
    current = version == "whiteboard-annotation-v2"
    if not current and not (version == "whiteboard-annotation-v1" and allow_legacy_read_only):
        raise ContractError("unsupported whiteboard annotation contract")
    _string(annotation.get("shot_id"), "shot_id")
    if annotation.get("visual_generation_route") != ROUTE_ID:
        raise ContractError("whiteboard annotation route mismatch")
    if annotation.get("white_cat_present") is not False:
        raise ContractError("white cat shots reject the whiteboard route")
    scene_class = annotation.get("scene_class")
    if scene_class not in {"narrative_illustration", "structured_graphic"}:
        raise ContractError("unsupported whiteboard scene_class")
    canvas = annotation.get("canvas")
    if canvas != {"width": WIDTH, "height": HEIGHT, "fps": FPS}:
        raise ContractError("whiteboard canvas must be exactly 1920x1080 at 30 fps")
    if current:
        if episode_workspace is None:
            raise ContractError("whiteboard-annotation-v2 requires an episode workspace")
        validate_visual_direction_binding(annotation, episode_workspace)
    _sha(annotation.get("source_image_sha256"), "source_image_sha256")
    _sha(annotation.get("normalized_image_sha256"), "normalized_image_sha256")
    locked_text = _string(annotation.get("locked_source_text"), "locked_source_text")
    total_frames = _integer(annotation.get("total_frames"), "total_frames", 1)
    final_hold = _integer(annotation.get("final_hold_frames"), "final_hold_frames", MIN_FINAL_HOLD_FRAMES)
    if final_hold >= total_frames:
        raise ContractError("final hold must be shorter than the shot")

    safe = _rect(annotation.get("subtitle_safe_area"), "subtitle_safe_area")
    if safe["y"] + safe["height"] != HEIGHT or safe["height"] < 180:
        raise ContractError("subtitle safe area must reserve at least 180 bottom pixels")

    visible_mode = annotation.get("visible_text_mode")
    approved_text = annotation.get("approved_visible_text", [])
    layers = annotation.get("text_layers", [])
    if not isinstance(approved_text, list) or not isinstance(layers, list):
        raise ContractError("approved_visible_text and text_layers must be arrays")
    required_mode = "required" if current else "approved_exact_chinese"
    if scene_class == "narrative_illustration":
        if visible_mode != "none" or approved_text or layers:
            raise ContractError("narrative whiteboard shots reject visible text")
        if current and annotation.get("approved_text_placement") is not None:
            raise ContractError("narrative whiteboard none mode rejects text placement")
    elif visible_mode == "none":
        if approved_text or layers:
            raise ContractError("visible_text_mode=none rejects text layers")
        if current and annotation.get("approved_text_placement") is not None:
            raise ContractError("visible_text_mode=none rejects text placement")
    elif visible_mode == required_mode:
        if not approved_text or not layers:
            raise ContractError("structured whiteboard text requires approved exact Chinese")
        if current:
            _string(annotation.get("approved_text_placement"), "approved_text_placement")
        if any(not isinstance(text, str) or not text.strip() for text in approved_text):
            raise ContractError("approved visible text must contain non-empty strings")
        layer_text = []
        for index, layer in enumerate(layers):
            if not isinstance(layer, dict):
                raise ContractError(f"text_layers[{index}] must be an object")
            text = _string(layer.get("text"), f"text_layers[{index}].text")
            _rect(layer.get("region"), f"text_layers[{index}].region")
            layer_text.append(text)
        if layer_text != approved_text:
            raise ContractError("text layers must equal approved Chinese in exact order")
    else:
        raise ContractError("unsupported visible_text_mode")

    performing = annotation.get("performing_subject_present")
    if not isinstance(performing, bool):
        raise ContractError("performing_subject_present must be boolean")
    replacement = annotation.get("action_family_policy")
    if performing and replacement != ACTION_FAMILY_REPLACEMENT:
        raise ContractError("performing whiteboard subject requires the route-only action-family replacement")
    if not performing and replacement not in {None, ACTION_FAMILY_REPLACEMENT}:
        raise ContractError("unsupported action_family_policy")

    elements = annotation.get("elements")
    if not isinstance(elements, list) or not elements:
        raise ContractError("whiteboard annotation requires elements")
    ids: set[str] = set()
    previous_end = 0
    previous_span_end = 0
    for index, element in enumerate(elements):
        if not isinstance(element, dict):
            raise ContractError(f"elements[{index}] must be an object")
        element_id = _string(element.get("id"), f"elements[{index}].id")
        if element_id in ids:
            raise ContractError(f"duplicate whiteboard element id: {element_id}")
        ids.add(element_id)
        if element.get("sequence") != index + 1:
            raise ContractError("whiteboard element sequence must be consecutive and ordered")
        _string(element.get("semantic_role"), f"elements[{index}].semantic_role")
        region = _rect(element.get("region"), f"elements[{index}].region")
        if _intersects(region, safe):
            raise ContractError(f"elements[{index}] intersects the subtitle safe area")
        protected = element.get("protected_regions", [])
        if not isinstance(protected, list):
            raise ContractError(f"elements[{index}].protected_regions must be an array")
        for protected_index, value in enumerate(protected):
            _rect(value, f"elements[{index}].protected_regions[{protected_index}]")
        start = _integer(element.get("start_frame"), f"elements[{index}].start_frame")
        end = _integer(element.get("end_frame"), f"elements[{index}].end_frame", 1)
        if end <= start:
            raise ContractError(f"elements[{index}] must have a positive frame range")
        if start < previous_end:
            raise ContractError("whiteboard element times must not overlap")
        if end > total_frames - final_hold:
            raise ContractError("whiteboard element intrudes into the final complete-frame hold")
        previous_end = end
        span = element.get("subtitle_span")
        if not isinstance(span, dict):
            raise ContractError(f"elements[{index}].subtitle_span must be an object")
        span_start = _integer(span.get("start"), f"elements[{index}].subtitle_span.start")
        span_end = _integer(span.get("end"), f"elements[{index}].subtitle_span.end", 1)
        span_text = _string(span.get("text"), f"elements[{index}].subtitle_span.text")
        if span_end <= span_start or span_start < previous_span_end or span_end > len(locked_text):
            raise ContractError("whiteboard subtitle spans must be ordered and inside locked text")
        if locked_text[span_start:span_end] != span_text:
            raise ContractError("whiteboard subtitle span text does not match locked narration")
        previous_span_end = span_end
    if total_frames - previous_end < final_hold:
        raise ContractError("whiteboard final complete frame hold is shorter than 15 frames")
    return annotation


def validate_render_evidence(evidence: dict[str, Any]) -> dict[str, Any]:
    if evidence.get("contract_version") != "whiteboard-render-evidence-v1":
        raise ContractError("unsupported whiteboard render evidence contract")
    if evidence.get("visual_generation_route") != ROUTE_ID:
        raise ContractError("whiteboard render evidence route mismatch")
    if evidence.get("drawing_overlay_policy") != DRAWING_OVERLAY_POLICY:
        raise ContractError("whiteboard render must contain no hand, pen, cursor, or drawing-tip overlay")
    for field in ("source_image", "normalized_image", "annotation", "preview", "clip"):
        item = evidence.get(field)
        if not isinstance(item, dict):
            raise ContractError(f"render evidence {field} is missing")
        _string(item.get("path"), f"{field}.path")
        _sha(item.get("sha256"), f"{field}.sha256")
    media = evidence.get("media")
    if not isinstance(media, dict):
        raise ContractError("render evidence media is missing")
    if media.get("width") != WIDTH or media.get("height") != HEIGHT:
        raise ContractError("whiteboard clip dimensions must be 1920x1080")
    if media.get("fps") != FPS or media.get("codec") != "h264":
        raise ContractError("whiteboard clip must be 30 fps H.264")
    if media.get("audio_streams") != 0:
        raise ContractError("whiteboard clip must have no audio")
    if media.get("frame_count") != evidence.get("total_frames"):
        raise ContractError("whiteboard clip frame count mismatch")
    if media.get("full_frame_hold_verified_frames", 0) < MIN_FINAL_HOLD_FRAMES:
        raise ContractError("whiteboard final frame hold verification is too short")
    if media.get("final_frame_verified") is not True:
        raise ContractError("whiteboard final frame is not verified")
    return evidence
