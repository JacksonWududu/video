#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import re
import struct
import subprocess
from typing import Any
import zlib


REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
GATE_PATH = REPOSITORY_ROOT / ".agents/skills/run-knowledge-video/scripts/validate_visual_approval_state.py"
OVERRIDE_BRIDGE_PATH = (
    Path(__file__).resolve().parents[1] / "user-gate-override/consume-override.mjs"
)
CANONICAL_ROOT = Path("/Users/jackson/Documents/Codex/character-library/white-cat/v2").resolve()
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
WHITE_CAT_SATCHEL_PROMPT_MARKER = "WHITE-CAT SATCHEL STRAP LOCK:"
WHITE_CAT_ANATOMICAL_SIDE_PROMPT_MARKER = "WHITE-CAT ANATOMICAL-SIDE CONTINUITY LOCK:"
WHITE_CAT_TOPOLOGY_AUTHORITY = "primary-three-quarter-plus-p2-text"
WHITE_CAT_FRONT_TRACE = [
    "forward_bag_end",
    "front_bag_end_ring_or_loop",
    "wide_plain_blue_front_path",
    "front_lower_neck_or_upper_chest",
]
WHITE_CAT_REAR_TRACE = [
    "rear_bag_end",
    "rear_bag_end_ring_or_loop",
    "wide_plain_blue_rear_path",
    "behind_neck_or_upper_back",
]
WHITE_CAT_ANATOMY_QA_VERSION = "white-cat-anatomy-qa-v2"
WHITE_CAT_MASTER_QA_VERSION = "ordinary-imagegen-white-cat-master-qa-v2"
WHITE_CAT_ACTION_QA_VERSION = "ordinary-imagegen-white-cat-action-qa-v2"
HERO_POSE_BACKGROUND_QA_VERSION = "ordinary-imagegen-hero-pose-background-qa-v1"
WHITE_CAT_LIMB_IDS = {"F1", "F2", "H1", "H2"}
WHITE_CAT_STYLE_SELECTION_VERSION = "white-cat-visual-style-selection-v1"
WHITE_CAT_STYLE_SELECTION_VERSION_V2 = "white-cat-visual-style-selection-v2"
WHITE_CAT_STYLE_OPTIONS = {
    "loose-line-vivid-watercolor": {
        "treatment_profile_id": "imagegen-watercolor-narrative",
        "visual_cohesion_profile_id": "warm-paper-watercolor-cohesion-v1",
    },
    "twilight-neon-animation": {
        "treatment_profile_id": "imagegen-twilight-neon-narrative",
        "visual_cohesion_profile_id": "twilight-luminous-cohesion-v1",
    },
    "gilded-mythic-storybook": {
        "treatment_profile_id": "imagegen-gilded-mythic-narrative",
        "visual_cohesion_profile_id": "gilded-mythic-cohesion-v1",
    },
}
DYNAMIC_WHITE_CAT_STYLE_OPTION = {
    "style_id": "cover-derived-episode-style",
    "treatment_profile_id": "imagegen-cover-derived-narrative",
    "visual_cohesion_profile_id": "cover-derived-cohesion-v1",
}
P0_AMBIGUOUS_TRACE = "P0_AMBIGUOUS_TRACE"
WAIVED_PENDING_FINAL_REVIEW_STATUS = (
    "qa_failed_but_waived_once_pending_final_review"
)
TAKEOVER_ITEM_STATUSES = {
    "pending_generation",
    "changes_requested",
    "awaiting_batch_qa",
    "awaiting_user_approval",
}


def _is_stopped_takeover_target(
    state: dict[str, Any], item: dict[str, Any] | None, asset_id: str,
) -> bool:
    review = state.get("visual_asset_review", {})
    controls = (
        item.get("image_generation_attempt_control", {}) if item else {},
        item.get("white_cat_generation_attempt_control", {}) if item else {},
    )
    return bool(
        item
        and item.get("status") in TAKEOVER_ITEM_STATUSES
        and review.get("user_takeover_required") is True
        and review.get("user_takeover_asset_id") == asset_id
        and review.get("current_asset_id") == asset_id
        and review.get("queue_generation_allowed") is False
        and any(
            control.get("automatic_retry_status")
            == "stopped_user_takeover_required"
            for control in controls
        )
    )


def _consumed_transition_ids(value: object) -> set[str]:
    found: set[str] = set()
    if isinstance(value, dict):
        for key, nested in value.items():
            if key == "consumed_transition_id" and isinstance(nested, str):
                found.add(nested)
            else:
                found.update(_consumed_transition_ids(nested))
    elif isinstance(value, list):
        for nested in value:
            found.update(_consumed_transition_ids(nested))
    return found


def _consume_user_gate_override(
    override: dict[str, Any],
    *,
    episode_id: str,
    scope_id: str,
    gate_ids: list[str],
    artifacts: list[dict[str, str]],
    transition_id: str,
    consumed_at: str,
) -> dict[str, Any]:
    payload = {
        "operation": "consume",
        "override": override,
        "bindings": {
            "episodeId": episode_id,
            "requiredScopeId": scope_id,
            "requiredGateIds": gate_ids,
            "requiredArtifacts": artifacts,
            "fromPhase": "awaiting_visual_asset_review",
            "toPhase": "visual_production",
        },
        "consumed_transition_id": transition_id,
        "consumed_at": consumed_at,
    }
    try:
        command = subprocess.run(
            ["node", str(OVERRIDE_BRIDGE_PATH)],
            input=json.dumps(payload, ensure_ascii=False),
            text=True,
            capture_output=True,
            check=False,
        )
    except OSError as error:
        raise ValueError("one-time user gate override validator is unavailable") from error
    if command.returncode != 0:
        detail = command.stderr.strip() or "validation failed"
        raise ValueError(f"one-time user gate override: {detail}")
    try:
        consumed = json.loads(command.stdout)
    except json.JSONDecodeError as error:
        raise ValueError(
            "one-time user gate override validator returned invalid JSON"
        ) from error
    if not isinstance(consumed, dict):
        raise ValueError(
            "one-time user gate override validator returned an invalid record"
        )
    return consumed


def _clear_active_takeover(review: dict[str, Any]) -> None:
    for key in (
        "user_takeover_required",
        "user_takeover_asset_id",
        "user_takeover_scope_id",
        "user_takeover_message",
    ):
        review.pop(key, None)


def next_generation_target(
    queue: list[dict[str, Any]], generation_unlocking_statuses: set[str]
) -> dict[str, Any] | None:
    return next(
        (
            item
            for item in queue
            if item.get("active_for_current_storyboard") is not False
            and item.get("status") != "superseded"
            and item.get("status") not in generation_unlocking_statuses
        ),
        None,
    )


def _canonical_sha256(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def load_white_cat_visual_style_selection(state: dict[str, Any]) -> dict[str, Any]:
    summary = state.get("white_cat_visual_style_selection")
    if not isinstance(summary, dict):
        raise ValueError("white-cat visual style selection is missing or unsupported")
    path_value = summary.get("path")
    checksum = summary.get("file_checksum_sha256")
    if path_value is None and checksum is None:
        return summary
    if not isinstance(path_value, str) or not SHA256_RE.fullmatch(str(checksum or "")):
        raise ValueError("white-cat visual style selection file binding is incomplete")
    selection_file = checksum_bound_file(
        {"path": path_value, "checksum_sha256": checksum},
        "white-cat visual style selection",
    )
    try:
        selection = json.loads(selection_file.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ValueError("white-cat visual style selection file is invalid JSON") from error
    if not isinstance(selection, dict) or summary.get("status") != "selected":
        raise ValueError("white-cat visual style selection summary is invalid")
    summary_fields = [
        "contract_version",
        "selection_sha256",
        "style_id",
        "treatment_profile_id",
        "visual_cohesion_profile_id",
        "style_profile_path",
        "style_profile_checksum_sha256",
        "decision",
    ]
    if selection.get("contract_version") == WHITE_CAT_STYLE_SELECTION_VERSION_V2:
        summary_fields.extend(
            [
                "style_source",
                "style_label",
                "publishing_cover_package_path",
                "publishing_cover_package_sha256",
            ]
        )
    if any(summary.get(field) != selection.get(field) for field in summary_fields):
        raise ValueError("white-cat visual style selection summary is stale or substituted")
    return selection


def resolve_white_cat_visual_style_binding(
    state: dict[str, Any], item: dict[str, Any]
) -> tuple[str, str, bool]:
    style_id = item.get("white_cat_visual_style_id")
    selection_sha256 = item.get("white_cat_visual_style_selection_sha256")
    cohesion_id = item.get("visual_cohesion_profile_id")
    if style_id is None and selection_sha256 is None and cohesion_id is None:
        if state.get("white_cat_visual_style_selection") is not None:
            raise ValueError("ordinary ImageGen episode style binding is missing")
        return "loose-line-vivid-watercolor", "warm-paper-watercolor-cohesion-v1", False
    if style_id is None or not SHA256_RE.fullmatch(selection_sha256 or "") or cohesion_id is None:
        raise ValueError("white-cat visual style binding is incomplete")
    selection = load_white_cat_visual_style_selection(state)
    contract_version = selection.get("contract_version")
    option = WHITE_CAT_STYLE_OPTIONS.get(style_id)
    projection: dict[str, Any] = {
        "contract_version": contract_version,
        "gate2_script_sha256": selection.get("gate2_script_sha256"),
        "style_id": selection.get("style_id"),
        "treatment_profile_id": selection.get("treatment_profile_id"),
        "visual_cohesion_profile_id": selection.get("visual_cohesion_profile_id"),
        "style_profile_path": selection.get("style_profile_path"),
        "style_profile_checksum_sha256": selection.get("style_profile_checksum_sha256"),
        "decision": {
            "status": selection.get("decision", {}).get("status"),
            "exact_message": selection.get("decision", {}).get("exact_message"),
            "decided_at": selection.get("decision", {}).get("decided_at"),
        },
    }
    if contract_version == WHITE_CAT_STYLE_SELECTION_VERSION:
        projection.update(
            {
                "style_skill_path": selection.get("style_skill_path"),
                "style_skill_checksum_sha256": selection.get("style_skill_checksum_sha256"),
            }
        )
    elif contract_version == WHITE_CAT_STYLE_SELECTION_VERSION_V2:
        option = DYNAMIC_WHITE_CAT_STYLE_OPTION
        projection.update(
            {
                "style_source": selection.get("style_source"),
                "source_style_id": selection.get("source_style_id"),
                "style_label": selection.get("style_label"),
                "publishing_cover_package_path": selection.get("publishing_cover_package_path"),
                "publishing_cover_package_sha256": selection.get("publishing_cover_package_sha256"),
            }
        )
        if (
            selection.get("style_source") not in {"episode_cover", "registered_custom"}
            or not isinstance(selection.get("style_label"), str)
            or not selection["style_label"].strip()
            or not isinstance(selection.get("style_profile_path"), str)
            or not selection["style_profile_path"].strip()
            or not SHA256_RE.fullmatch(selection.get("style_profile_checksum_sha256") or "")
            or (
                selection.get("style_source") == "episode_cover"
                and (
                    selection.get("source_style_id") is not None
                    or not isinstance(selection.get("publishing_cover_package_path"), str)
                    or not SHA256_RE.fullmatch(
                        selection.get("publishing_cover_package_sha256") or ""
                    )
                )
            )
            or (
                selection.get("style_source") == "registered_custom"
                and (
                    not isinstance(selection.get("source_style_id"), str)
                    or selection.get("publishing_cover_package_path") is not None
                    or selection.get("publishing_cover_package_sha256") is not None
                )
            )
        ):
            raise ValueError("white-cat visual style v2 profile binding is invalid")
    else:
        option = None
    if (
        option is None
        or selection.get("selection_sha256") != _canonical_sha256(projection)
        or selection.get("selection_sha256") != selection_sha256
        or selection.get("style_id") != style_id
        or selection.get("treatment_profile_id") != option["treatment_profile_id"]
        or item.get("treatment_profile_id") != option["treatment_profile_id"]
        or selection.get("visual_cohesion_profile_id") != cohesion_id
        or cohesion_id != option["visual_cohesion_profile_id"]
    ):
        raise ValueError("white-cat visual style binding is stale, mixed, or substituted")
    return style_id, cohesion_id, True


def validate_white_cat_style_prompt_and_qa(
    *,
    prompt_text: str,
    qa: dict[str, Any],
    style_id: str,
    cohesion_id: str,
    selection_sha256: str | None,
    current_binding: bool,
    style_profile_checksum_sha256: str | None = None,
) -> None:
    if not current_binding:
        return
    if f"WHITE-CAT VISUAL STYLE: {style_id}." not in prompt_text:
        raise ValueError("production prompt lacks the Gate-2 white-cat visual style marker")
    if f"EPISODE VISUAL COHESION: {cohesion_id}." not in prompt_text:
        raise ValueError("production prompt lacks the episode visual cohesion marker")
    expected_qa_binding = {
        "style_id": style_id,
        "selection_sha256": selection_sha256,
        "visual_cohesion_profile_id": cohesion_id,
    }
    if style_profile_checksum_sha256 is not None:
        if f"EPISODE STYLE PROFILE SHA256: {style_profile_checksum_sha256}." not in prompt_text:
            raise ValueError("production prompt lacks the episode style-profile checksum marker")
        expected_qa_binding["style_profile_checksum_sha256"] = style_profile_checksum_sha256
    if qa.get("white_cat_visual_style_binding") != expected_qa_binding:
        raise ValueError("white-cat generation QA lacks the exact style/cohesion binding")


def validate_white_cat_prompt_contract(text: str) -> None:
    normalized = " ".join(text.lower().split())
    checks = {
        "satchel marker": WHITE_CAT_SATCHEL_PROMPT_MARKER.lower() in normalized,
        "front anatomical route": bool(
            re.search(r"front.{0,240}(neck|throat|chest|sternum)", normalized)
        ),
        "rear anatomical route": bool(
            re.search(r"(rear|behind).{0,240}(neck|shoulder|upper back)", normalized)
        ),
        "opposite bag-end anchors": (
            ("bag end" in normalized or "bag-end" in normalized or "d-ring" in normalized)
            and ("forward" in normalized or "front" in normalized)
            and ("rear" in normalized or "hindquarters" in normalized)
        ),
        "trim distinction": "trim" in normalized and ("robe" in normalized or "himation" in normalized),
        "anatomical-side continuity": (
            WHITE_CAT_ANATOMICAL_SIDE_PROMPT_MARKER.lower() in normalized
            and "anatomical right flank" in normalized
            and bool(re.search(r"(do not|never|no)\s+mirror", normalized))
        ),
    }
    missing = [label for label, passed in checks.items() if not passed]
    if missing:
        raise ValueError(f"white-cat prompt lacks P2 path evidence: {', '.join(missing)}")


def _require_normalized_point(value: Any, label: str) -> None:
    if (
        not isinstance(value, list)
        or len(value) != 2
        or any(
            not isinstance(item, (int, float))
            or isinstance(item, bool)
            or not math.isfinite(item)
            or item < 0
            or item > 1
            for item in value
        )
    ):
        raise ValueError(f"P0_AMBIGUOUS_TRACE: {label} must be a normalized point")


def _require_normalized_bbox(value: Any, label: str) -> None:
    if (
        not isinstance(value, list)
        or len(value) != 4
        or any(
            not isinstance(item, (int, float))
            or isinstance(item, bool)
            or not math.isfinite(item)
            for item in value
        )
        or value[0] < 0
        or value[1] < 0
        or value[2] <= 0
        or value[3] <= 0
        or value[0] + value[2] > 1
        or value[1] + value[3] > 1
    ):
        raise ValueError(f"P0_AMBIGUOUS_TRACE: {label} must be a normalized in-canvas bbox")


def _point_is_inside_bbox(point: list[float], bbox: list[float]) -> bool:
    return (
        bbox[0] <= point[0] <= bbox[0] + bbox[2]
        and bbox[1] <= point[1] <= bbox[1] + bbox[3]
    )


def validate_white_cat_anatomy_qa_v2(
    anatomy: dict[str, Any],
    *,
    selected_source: dict[str, Any],
    selected_source_file: Path,
) -> None:
    if anatomy.get("contract_version") != WHITE_CAT_ANATOMY_QA_VERSION:
        raise ValueError("P0_EVIDENCE_STALE: white-cat anatomy QA must use v2")
    try:
        bound_source = checksum_bound_file(selected_source, "selected source")
    except (OSError, ValueError) as error:
        raise ValueError("P0_EVIDENCE_STALE: selected source binding is stale") from error
    if bound_source != selected_source_file.resolve():
        raise ValueError("P0_EVIDENCE_STALE: selected source file does not match its binding")
    if anatomy.get("source_image") != {
        "path": selected_source.get("path"),
        "checksum_sha256": selected_source.get("checksum_sha256"),
    }:
        raise ValueError("P0_EVIDENCE_STALE: anatomy source image binding is stale")
    source_dimensions = png_dimensions(selected_source_file)
    if anatomy.get("canvas") != {"width": source_dimensions[0], "height": source_dimensions[1]}:
        raise ValueError("P0_EVIDENCE_STALE: anatomy canvas does not match source image")

    traces = anatomy.get("limb_traces")
    if not isinstance(traces, list) or any(not isinstance(trace, dict) for trace in traces):
        raise ValueError("P0_AMBIGUOUS_TRACE: limb traces are missing")
    trace_ids = [trace.get("id") for trace in traces]
    invalid_trace_ids = any(not isinstance(trace_id, str) for trace_id in trace_ids)
    if (
        len(traces) != 4
        or invalid_trace_ids
        or set(trace_ids) != WHITE_CAT_LIMB_IDS
        or len(set(trace_ids)) != 4
    ):
        fore_count = sum(1 for value in trace_ids if isinstance(value, str) and value.startswith("F"))
        hind_count = sum(1 for value in trace_ids if isinstance(value, str) and value.startswith("H"))
        if fore_count != 2:
            code = "P0_FORELIMB_COUNT"
        elif hind_count != 2:
            code = "P0_HINDLIMB_COUNT"
        else:
            code = "P0_AMBIGUOUS_TRACE"
        raise ValueError(f"{code}: limb trace IDs must be exactly F1, F2, H1, H2")
    paw_ids: set[str] = set()
    paw_bboxes: set[tuple[float, float, float, float]] = set()
    anchor_points: set[tuple[float, float]] = set()
    for trace in traces:
        trace_id = trace["id"]
        expected_class = "forelimb" if trace_id.startswith("F") else "hindlimb"
        expected_anchor = "shoulder" if expected_class == "forelimb" else "hip"
        paw_id = trace.get("paw_region_id")
        if not isinstance(paw_id, str) or not paw_id.strip() or paw_id in paw_ids:
            raise ValueError("P0_PAW_COUNT: every limb requires one unique paw region")
        paw_ids.add(paw_id)
        if trace.get("class") != expected_class or trace.get("torso_anchor") != expected_anchor:
            raise ValueError("P0_AMBIGUOUS_TRACE: limb class or torso anchor is inconsistent")
        if trace.get("paw_visible") is not True or trace.get("continuous_to_torso") is not True:
            raise ValueError("P0_AMBIGUOUS_TRACE: every paw must trace continuously to its torso anchor")
        paw_bbox = trace.get("paw_bbox_normalized")
        _require_normalized_bbox(paw_bbox, f"{trace_id}.paw_bbox_normalized")
        paw_bbox_key = tuple(paw_bbox)
        if paw_bbox_key in paw_bboxes:
            raise ValueError("P0_PAW_COUNT: limb traces cannot share a paw bbox")
        paw_bboxes.add(paw_bbox_key)
        anchor_point = trace.get("torso_anchor_point_normalized")
        _require_normalized_point(
            anchor_point,
            f"{trace_id}.torso_anchor_point_normalized",
        )
        anchor_key = tuple(anchor_point)
        if anchor_key in anchor_points:
            raise ValueError("P0_BRANCH_OR_FUSION: limb traces cannot share a torso outlet")
        anchor_points.add(anchor_key)
        polyline = trace.get("trace_polyline_normalized")
        if not isinstance(polyline, list) or len(polyline) < 3:
            raise ValueError("P0_AMBIGUOUS_TRACE: every limb trace requires at least three points")
        for point_index, point in enumerate(polyline):
            _require_normalized_point(point, f"{trace_id}.trace_polyline_normalized[{point_index}]")
        if not _point_is_inside_bbox(polyline[0], paw_bbox) or polyline[-1] != anchor_point:
            raise ValueError(
                "P0_AMBIGUOUS_TRACE: limb trace must begin inside its paw bbox and end at its torso anchor"
            )
        if trace.get("occlusion_status") not in {"none", "partial"}:
            raise ValueError("P0_AMBIGUOUS_TRACE: fully ambiguous occlusion cannot pass")
        if trace.get("occlusion_status") == "partial" and (
            not isinstance(trace.get("occlusion_reason"), str)
            or not trace["occlusion_reason"].strip()
        ):
            raise ValueError("P0_AMBIGUOUS_TRACE: partial occlusion requires a reason")

    for direction in ("forward_trace_ids", "reverse_trace_ids"):
        ids = anatomy.get(direction)
        if (
            not isinstance(ids, list)
            or len(ids) != 4
            or any(not isinstance(trace_id, str) for trace_id in ids)
            or set(ids) != WHITE_CAT_LIMB_IDS
        ):
            raise ValueError("P0_FORWARD_REVERSE_MISMATCH: bidirectional trace sets differ")
    if anatomy.get("unassigned_paw_like_shapes") != 0:
        raise ValueError("P0_UNASSIGNED_PAW: unassigned paw-like shapes remain")
    if anatomy.get("ambiguous_limb_regions") != 0:
        raise ValueError("P0_AMBIGUOUS_TRACE: ambiguous limb regions remain")
    if anatomy.get("branched_or_fused_limb_regions") != 0:
        raise ValueError("P0_BRANCH_OR_FUSION: branched or fused limb regions remain")

    evidence = anatomy.get("inspection_evidence")
    if not isinstance(evidence, dict) or evidence.get("methods") != ["full_resolution", "numbered_limb_map"]:
        raise ValueError("P0_EVIDENCE_STALE: full-resolution and numbered-map evidence are required")
    if evidence.get("numbered_limb_map_source_checksum_sha256") != selected_source.get(
        "checksum_sha256"
    ) or evidence.get("numbered_limb_map_limb_ids") != ["F1", "F2", "H1", "H2"]:
        raise ValueError("P0_EVIDENCE_STALE: numbered limb map provenance is stale")
    numbered_map_path = evidence.get("numbered_limb_map_path")
    if not isinstance(numbered_map_path, str) or Path(numbered_map_path).is_absolute():
        raise ValueError("P0_EVIDENCE_STALE: numbered limb map path must be root-relative")
    try:
        numbered_map = checksum_bound_file(
            {
                "path": numbered_map_path,
                "checksum_sha256": evidence.get("numbered_limb_map_checksum_sha256"),
            },
            "numbered limb map",
        )
        numbered_dimensions = png_dimensions(numbered_map)
    except (OSError, ValueError) as error:
        raise ValueError("P0_EVIDENCE_STALE: numbered limb map binding or PNG is stale") from error
    if (
        numbered_map == selected_source_file.resolve()
        or evidence.get("numbered_limb_map_checksum_sha256") == selected_source.get("checksum_sha256")
    ):
        raise ValueError("P0_EVIDENCE_STALE: source image cannot be used as its numbered limb map")
    if numbered_dimensions != source_dimensions:
        raise ValueError("P0_EVIDENCE_STALE: numbered limb map must match source dimensions")
    if anatomy.get("result") != "pass":
        raise ValueError("P0_EVIDENCE_STALE: anatomy result is inconsistent with passing evidence")


def validate_white_cat_ambiguous_trace_failure(
    identity: dict[str, Any],
    *,
    selected_source: dict[str, Any],
    selected_source_file: Path,
    expected_reason: str,
) -> None:
    if (
        identity.get("result") != "fail"
        or identity.get("cat_count") != 1
        or identity.get("foreleg_count") != 2
        or identity.get("hindleg_count") != 2
        or identity.get("paw_count") != 4
    ):
        raise ValueError(
            "P0_AMBIGUOUS_TRACE: failed identity counts or disposition are stale"
        )
    anatomy = identity.get("anatomy_evidence")
    if (
        not isinstance(anatomy, dict)
        or anatomy.get("contract_version") != WHITE_CAT_ANATOMY_QA_VERSION
        or anatomy.get("result") != "fail"
        or anatomy.get("error_code") != P0_AMBIGUOUS_TRACE
        or anatomy.get("failure_reason") != expected_reason
        or anatomy.get("source_image") != {
            "path": selected_source.get("path"),
            "checksum_sha256": selected_source.get("checksum_sha256"),
        }
    ):
        raise ValueError(
            "P0_AMBIGUOUS_TRACE: anatomy failure evidence is missing or stale"
        )
    source_dimensions = png_dimensions(selected_source_file)
    if anatomy.get("canvas") != {
        "width": source_dimensions[0],
        "height": source_dimensions[1],
    }:
        raise ValueError("P0_EVIDENCE_STALE: anatomy failure canvas is stale")
    traces = anatomy.get("limb_traces")
    if not isinstance(traces, list) or len(traces) != 4 or any(
        not isinstance(trace, dict) for trace in traces
    ):
        raise ValueError("P0_AMBIGUOUS_TRACE: four trace records are required")
    trace_ids = [trace.get("id") for trace in traces]
    paw_ids = [trace.get("paw_region_id") for trace in traces]
    if (
        trace_ids != ["F1", "F2", "H1", "H2"]
        or len(set(paw_ids)) != 4
        or any(not isinstance(paw_id, str) or not paw_id for paw_id in paw_ids)
        or [
            trace.get("id")
            for trace in traces
            if trace.get("continuous_to_torso") is not True
        ]
        != ["H1"]
        or next(trace for trace in traces if trace.get("id") == "H1").get(
            "ambiguity_reason"
        )
        != expected_reason
    ):
        raise ValueError(
            "P0_AMBIGUOUS_TRACE: the exact H1 ambiguity is not preserved"
        )
    if (
        anatomy.get("forward_trace_ids") != ["F1", "F2", "H1", "H2"]
        or anatomy.get("reverse_trace_ids") != ["F1", "F2", "H1", "H2"]
        or anatomy.get("unassigned_paw_like_shapes") != 0
        or anatomy.get("ambiguous_limb_regions") != 1
        or anatomy.get("branched_or_fused_limb_regions") != 0
    ):
        raise ValueError(
            "P0_AMBIGUOUS_TRACE: unresolved-region evidence is missing or stale"
        )
    evidence = anatomy.get("inspection_evidence")
    if (
        not isinstance(evidence, dict)
        or evidence.get("methods")
        != ["full_resolution", "numbered_limb_map"]
        or evidence.get("numbered_limb_map_source_checksum_sha256")
        != selected_source.get("checksum_sha256")
        or evidence.get("numbered_limb_map_limb_ids")
        != ["F1", "F2", "H1", "H2"]
    ):
        raise ValueError("P0_EVIDENCE_STALE: numbered limb-map provenance is stale")
    numbered_map = checksum_bound_file(
        {
            "path": evidence.get("numbered_limb_map_path"),
            "checksum_sha256": evidence.get(
                "numbered_limb_map_checksum_sha256"
            ),
        },
        "numbered limb map",
    )
    if (
        numbered_map == selected_source_file.resolve()
        or png_dimensions(numbered_map) != source_dimensions
    ):
        raise ValueError(
            "P0_EVIDENCE_STALE: numbered limb map is not an independent same-size PNG"
        )
    validate_white_cat_accessory_qa(identity)


def validate_white_cat_accessory_qa(identity: dict[str, Any]) -> None:
    if identity.get("accessory_geometry_correct") is not True or (
        identity.get("satchel_count") != 1
        or identity.get("bag_strap_count") != 2
        or identity.get("bag_end_attachment_count") != 2
        or identity.get("front_strap_attached_to_forward_bag_end") is not True
        or identity.get("rear_strap_attached_to_rear_bag_end") is not True
        or identity.get("himation_trim_distinct_from_bag_straps") is not True
    ):
        raise ValueError("P2_SATCHEL_TOPOLOGY: white-cat P2 satchel strap QA is incomplete")
    if identity.get("satchel_anatomical_flank") != "right":
        raise ValueError("P2_SATCHEL_TOPOLOGY: white-cat satchel is not on the anatomical right flank")
    if (
        identity.get("cat_facing_screen_direction") not in {
            "screen-left",
            "screen-right",
            "front-facing",
            "rear-facing",
            "three-quarter-screen-left",
            "three-quarter-screen-right",
        }
        or not isinstance(identity.get("anatomical_front_maps_to_screen"), str)
        or not identity["anatomical_front_maps_to_screen"].strip()
        or not isinstance(identity.get("anatomical_rear_maps_to_screen"), str)
        or not identity["anatomical_rear_maps_to_screen"].strip()
        or not isinstance(identity.get("front_path_screen_vector"), str)
        or not identity["front_path_screen_vector"].strip()
        or not isinstance(identity.get("rear_path_screen_vector"), str)
        or not identity["rear_path_screen_vector"].strip()
        or identity.get("front_path_screen_vector") == identity.get("rear_path_screen_vector")
        or identity.get("front_path_trace") != WHITE_CAT_FRONT_TRACE
        or identity.get("rear_path_trace") != WHITE_CAT_REAR_TRACE
        or identity.get("both_bag_end_anchors_visibly_traceable") is not True
        or identity.get("strap_paths_spatially_distinct") is not True
        or identity.get("topology_authority") != WHITE_CAT_TOPOLOGY_AUTHORITY
        or identity.get("source_retry_policy_compliant") is not True
    ):
        raise ValueError("P2_SATCHEL_TOPOLOGY: white-cat P2 directional path QA is incomplete")


def validate_white_cat_identity_qa_v2(
    identity: dict[str, Any],
    *,
    selected_source: dict[str, Any],
    selected_source_file: Path,
) -> None:
    if identity.get("cat_count") != 1:
        raise ValueError("P0_CAT_COUNT: white-cat count must be one")
    if identity.get("foreleg_count") != 2:
        raise ValueError("P0_FORELIMB_COUNT: white-cat forelimb count must be two")
    if identity.get("hindleg_count") != 2:
        raise ValueError("P0_HINDLIMB_COUNT: white-cat hindlimb count must be two")
    if identity.get("paw_count") != 4:
        raise ValueError("P0_PAW_COUNT: white-cat paw count must be four")
    validate_white_cat_anatomy_qa_v2(
        identity.get("anatomy_evidence", {}),
        selected_source=selected_source,
        selected_source_file=selected_source_file,
    )
    validate_white_cat_accessory_qa(identity)
    if identity.get("result") != "pass":
        raise ValueError("P0_EVIDENCE_STALE: white-cat identity result is inconsistent")


def sha256_file(file: Path) -> str:
    digest = hashlib.sha256()
    with file.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_path(value: str, label: str) -> Path:
    candidate = Path(value)
    if not value:
        raise ValueError(f"{label} is missing")
    if candidate.is_absolute():
        resolved = candidate.resolve(strict=True)
        resolved.relative_to(CANONICAL_ROOT)
    else:
        resolved = (REPOSITORY_ROOT / candidate).resolve(strict=True)
        resolved.relative_to(REPOSITORY_ROOT.resolve())
    if candidate.is_symlink() or resolved.is_symlink() or not resolved.is_file():
        raise ValueError(f"{label} must be a regular non-symlink file")
    return resolved


def checksum_bound_file(binding: dict[str, Any], label: str) -> Path:
    if not isinstance(binding, dict) or not SHA256_RE.fullmatch(str(binding.get("checksum_sha256", ""))):
        raise ValueError(f"{label} binding is invalid")
    file = resolve_path(binding.get("path", ""), f"{label} path")
    if sha256_file(file) != binding["checksum_sha256"]:
        raise ValueError(f"{label} checksum is stale")
    return file


def validate_same_episode_reference_inputs(
    state: dict[str, Any], item: dict[str, Any], references: Any,
    workspace: Path, style_binding: Any,
) -> None:
    if not isinstance(references, list):
        raise ValueError("ordinary ImageGen reference inputs must be a list")
    if not references:
        return
    queue = [
        row for row in state["visual_asset_review"]["queue"]
        if row.get("active_for_current_storyboard") is True
    ]
    targets = [index for index, row in enumerate(queue) if row.get("asset_id") == item["asset_id"]]
    if len(targets) != 1 or item.get("white_cat_present") is not False:
        raise ValueError("ordinary ImageGen reference target is ambiguous or not cat-free")
    expected_style = resolve_white_cat_visual_style_binding(state, item)

    def scoped_file(binding: dict[str, Any], label: str) -> Path:
        value = binding.get("path")
        if not isinstance(value, str) or not value or Path(value).is_absolute() or ".." in Path(value).parts:
            raise ValueError(f"{label} must be a root-relative file inside the episode")
        file = REPOSITORY_ROOT.resolve() / value
        file.relative_to(workspace)
        if file.resolve(strict=True) != file or file.is_symlink():
            raise ValueError(f"{label} must not use symlinks")
        return checksum_bound_file(binding, label)

    seen: set[str] = set()
    for reference in references:
        if (
            not isinstance(reference, dict)
            or set(reference) != {"role", "asset_id", "path", "checksum_sha256"}
            or reference.get("role") not in {
                "same_episode_identity_reference", "same_episode_composition_reference",
            }
            or not isinstance(reference.get("asset_id"), str)
            or reference["asset_id"] in seen
        ):
            raise ValueError("ordinary ImageGen reference binding is invalid or duplicated")
        seen.add(reference["asset_id"])
        sources = [(index, row) for index, row in enumerate(queue)
                   if row.get("asset_id") == reference["asset_id"]]
        if len(sources) != 1 or sources[0][0] >= targets[0]:
            raise ValueError("ordinary ImageGen reference must be a unique earlier queue item")
        source = sources[0][1]
        role = source.get("role", "")
        if (
            source.get("active_for_current_storyboard") is not True
            or source.get("white_cat_present") is not False
            or source.get("visual_generation_route") != "imagegen"
            or source.get("asset_kind") is not None
            or not re.fullmatch(r"S\d{2,}", str(source.get("shot_id", "")))
            or not (role == "base/master" or re.fullmatch(r"action-\d{2,}", str(role)))
            or source.get("visible_text_mode") != "none"
            or source.get("generator") != "codex-native-imagegen"
            or source.get("treatment_profile_id") != item.get("treatment_profile_id")
            or resolve_white_cat_visual_style_binding(state, source) != expected_style
            or source.get("style_profile_id") != item.get("treatment_profile_id")
            or source.get("style_medium_id") != expected_style[0]
            or source.get("path") != reference["path"]
            or source.get("checksum_sha256") != reference["checksum_sha256"]
            or source.get("technical_qa", {}).get("result") != "pass"
        ):
            raise ValueError("ordinary ImageGen reference is not an active matching-style source")
        status = source.get("status")
        if status == "approved":
            reviewed_checksum = source.get("approved_checksum_sha256")
        elif (
            status == "qa_passed_pending_final_review"
            and state["visual_asset_review"].get("mode") == "one_click_final_review_v1"
        ):
            reviewed_checksum = source.get("batch_qa_checksum_sha256")
        else:
            raise ValueError("ordinary ImageGen reference has not passed source approval or one-click QA")
        if reviewed_checksum != reference["checksum_sha256"]:
            raise ValueError("ordinary ImageGen reference approval or QA checksum is stale")
        source_file = scoped_file(reference, "ordinary ImageGen reference source")
        dimensions = list(png_dimensions(source_file))
        qa_file = scoped_file({
            "path": source.get("qa_evidence_path"),
            "checksum_sha256": source.get("qa_evidence_checksum_sha256"),
        }, "ordinary ImageGen reference QA")
        source_qa = json.loads(qa_file.read_text(encoding="utf-8"))
        if (
            not isinstance(source_qa, dict)
            or source_qa.get("contract_version") != (
                "ordinary-imagegen-historical-master-qa-v1" if role == "base/master"
                else "ordinary-imagegen-historical-action-qa-v1"
            )
            or source_qa.get("result") != "pass"
            or source_qa.get("asset_id") != source["asset_id"]
            or source_qa.get("generator") != "codex-native-imagegen"
            or source_qa.get("selected_source", {}).get("path") != reference["path"]
            or source_qa.get("selected_source", {}).get("checksum_sha256") != reviewed_checksum
            or source_qa.get("selected_source", {}).get("dimensions") != dimensions
            or source.get("measured_dimensions") != dimensions
            or source_qa.get("style_profile", {}).get("id") != source["style_profile_id"]
            or source_qa.get("style_profile", {}).get("medium_id") != expected_style[0]
            or source_qa.get("white_cat_visual_style_binding") != style_binding
        ):
            raise ValueError("ordinary ImageGen reference QA does not bind the exact source and style")
        for check in ("semantic_qa", "visible_text_qa", "style_qa", "continuity_qa",
                      "visual_qa", "historical_identity_qa"):
            if source_qa.get(check, {}).get("result") != "pass" or source.get(check) != source_qa[check]:
                raise ValueError(f"ordinary ImageGen reference {check} is not passing or is stale")
        if (
            source_qa["visible_text_qa"].get("no_visible_text") is not True
            or source_qa["visible_text_qa"].get("no_pseudotext") is not True
        ):
            raise ValueError("ordinary ImageGen reference is not verified text-free")


def png_dimensions(file: Path) -> tuple[int, int]:
    data = file.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"not a decodable PNG: {file}")
    offset = 8
    header: tuple[int, int, int, int, int] | None = None
    compressed = bytearray()
    scanline_lengths: list[int] = []
    saw_iend = False
    while offset < len(data):
        if offset + 12 > len(data):
            raise ValueError(f"not a decodable PNG: {file}")
        length = struct.unpack(">I", data[offset : offset + 4])[0]
        kind = data[offset + 4 : offset + 8]
        payload_end = offset + 8 + length
        chunk_end = payload_end + 4
        if chunk_end > len(data):
            raise ValueError(f"not a decodable PNG: {file}")
        payload = data[offset + 8 : payload_end]
        expected_crc = struct.unpack(">I", data[payload_end:chunk_end])[0]
        if zlib.crc32(kind + payload) & 0xFFFFFFFF != expected_crc:
            raise ValueError(f"not a decodable PNG: {file}")
        if header is None and kind != b"IHDR":
            raise ValueError(f"not a decodable PNG: {file}")
        if kind == b"IHDR":
            if header is not None or length != 13:
                raise ValueError(f"not a decodable PNG: {file}")
            width, height, bit_depth, color_type, compression, filtering, interlace = struct.unpack(
                ">IIBBBBB", payload
            )
            valid_depths = {
                0: {1, 2, 4, 8, 16},
                2: {8, 16},
                3: {1, 2, 4, 8},
                4: {8, 16},
                6: {8, 16},
            }
            if (
                width < 1
                or height < 1
                or bit_depth not in valid_depths.get(color_type, set())
                or compression != 0
                or filtering != 0
                or interlace not in {0, 1}
            ):
                raise ValueError(f"not a decodable PNG: {file}")
            header = (width, height, bit_depth, color_type, interlace)
        elif kind == b"IDAT":
            compressed.extend(payload)
        elif kind == b"IEND":
            if length != 0 or chunk_end != len(data):
                raise ValueError(f"not a decodable PNG: {file}")
            saw_iend = True
            offset = chunk_end
            break
        offset = chunk_end
    if header is None or not compressed or not saw_iend:
        raise ValueError(f"not a decodable PNG: {file}")
    width, height, bit_depth, color_type, interlace = header
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color_type]
    bits_per_pixel = channels * bit_depth
    passes = (
        [(0, 0, 1, 1)]
        if interlace == 0
        else [
            (0, 0, 8, 8),
            (4, 0, 8, 8),
            (0, 4, 4, 8),
            (2, 0, 4, 4),
            (0, 2, 2, 4),
            (1, 0, 2, 2),
            (0, 1, 1, 2),
        ]
    )
    for start_x, start_y, step_x, step_y in passes:
        pass_width = 0 if width <= start_x else (width - start_x + step_x - 1) // step_x
        pass_height = 0 if height <= start_y else (height - start_y + step_y - 1) // step_y
        if pass_width:
            scanline_lengths.extend(
                [(pass_width * bits_per_pixel + 7) // 8] * pass_height
            )
    try:
        decompressor = zlib.decompressobj()
        raw = decompressor.decompress(bytes(compressed)) + decompressor.flush()
    except zlib.error as error:
        raise ValueError(f"not a decodable PNG: {file}") from error
    if (
        not decompressor.eof
        or decompressor.unused_data
        or decompressor.unconsumed_tail
        or len(raw) != sum(length + 1 for length in scanline_lengths)
    ):
        raise ValueError(f"not a decodable PNG: {file}")
    row_offset = 0
    for row_length in scanline_lengths:
        if raw[row_offset] not in range(5):
            raise ValueError(f"not a decodable PNG: {file}")
        row_offset += row_length + 1
    return width, height


def png_rgba_alpha_evidence(file: Path) -> dict[str, int]:
    """Decode an 8-bit, non-interlaced RGBA PNG and measure real alpha pixels."""
    data = file.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"not a decodable RGBA PNG: {file}")
    offset = 8
    width = height = 0
    compressed = bytearray()
    while offset < len(data):
        if offset + 12 > len(data):
            raise ValueError(f"not a decodable RGBA PNG: {file}")
        length = struct.unpack(">I", data[offset : offset + 4])[0]
        kind = data[offset + 4 : offset + 8]
        payload_end = offset + 8 + length
        chunk_end = payload_end + 4
        if chunk_end > len(data):
            raise ValueError(f"not a decodable RGBA PNG: {file}")
        payload = data[offset + 8 : payload_end]
        expected_crc = struct.unpack(">I", data[payload_end:chunk_end])[0]
        if zlib.crc32(kind + payload) & 0xFFFFFFFF != expected_crc:
            raise ValueError(f"not a decodable RGBA PNG: {file}")
        if kind == b"IHDR":
            if length != 13:
                raise ValueError(f"not a decodable RGBA PNG: {file}")
            width, height, bit_depth, color_type, compression, filtering, interlace = struct.unpack(
                ">IIBBBBB", payload
            )
            if (
                width < 1
                or height < 1
                or bit_depth != 8
                or color_type != 6
                or compression != 0
                or filtering != 0
                or interlace != 0
            ):
                raise ValueError("hero-pose source must be an 8-bit non-interlaced RGBA PNG")
        elif kind == b"IDAT":
            compressed.extend(payload)
        elif kind == b"IEND":
            break
        offset = chunk_end
    if width < 1 or height < 1 or not compressed:
        raise ValueError(f"not a decodable RGBA PNG: {file}")
    try:
        raw = zlib.decompress(bytes(compressed))
    except zlib.error as error:
        raise ValueError(f"not a decodable RGBA PNG: {file}") from error
    stride = width * 4
    if len(raw) != height * (stride + 1):
        raise ValueError(f"not a decodable RGBA PNG: {file}")

    previous = bytearray(stride)
    alpha_values: list[int] = []

    def paeth(left: int, above: int, upper_left: int) -> int:
        estimate = left + above - upper_left
        left_distance = abs(estimate - left)
        above_distance = abs(estimate - above)
        upper_left_distance = abs(estimate - upper_left)
        if left_distance <= above_distance and left_distance <= upper_left_distance:
            return left
        if above_distance <= upper_left_distance:
            return above
        return upper_left

    for row_index in range(height):
        start = row_index * (stride + 1)
        filter_type = raw[start]
        encoded = raw[start + 1 : start + 1 + stride]
        if filter_type not in range(5):
            raise ValueError(f"not a decodable RGBA PNG: {file}")
        decoded = bytearray(stride)
        for index, value in enumerate(encoded):
            left = decoded[index - 4] if index >= 4 else 0
            above = previous[index]
            upper_left = previous[index - 4] if index >= 4 else 0
            predictor = (
                0
                if filter_type == 0
                else left
                if filter_type == 1
                else above
                if filter_type == 2
                else (left + above) // 2
                if filter_type == 3
                else paeth(left, above, upper_left)
            )
            decoded[index] = (value + predictor) & 0xFF
        alpha_values.extend(decoded[3::4])
        previous = decoded
    minimum = min(alpha_values)
    maximum = max(alpha_values)
    transparent_count = sum(value == 0 for value in alpha_values)
    nontransparent_count = sum(value > 0 for value in alpha_values)
    return {
        "min_alpha": minimum,
        "max_alpha": maximum,
        "transparent_pixel_count": transparent_count,
        "nontransparent_pixel_count": nontransparent_count,
    }


def load_gate():
    spec = importlib.util.spec_from_file_location("visual_approval_gate", GATE_PATH)
    if spec is None or spec.loader is None:
        raise ValueError("visual approval gate cannot be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def record(args: argparse.Namespace) -> dict[str, Any]:
    workspace = (REPOSITORY_ROOT / args.episode_workspace).resolve(strict=True)
    workspace.relative_to(REPOSITORY_ROOT.resolve())
    state_file = workspace / "schema/episode-state.json"
    state = json.loads(state_file.read_text(encoding="utf-8"))
    gate = load_gate()
    review = state.get("visual_asset_review", {})
    one_click = review.get("mode") == "one_click_final_review_v1"
    candidate = next(
        (queued for queued in review.get("queue", []) if queued.get("asset_id") == args.asset_id),
        None,
    )
    stopped_takeover_target = _is_stopped_takeover_target(
        state, candidate, args.asset_id,
    )
    accepting_ambiguous_trace_override = bool(
        getattr(args, "accept_p0_ambiguous_trace_with_user_override", False)
    )
    if accepting_ambiguous_trace_override and not stopped_takeover_target:
        raise ValueError(
            "P0_AMBIGUOUS_TRACE override requires the exact stopped takeover target"
        )
    is_user_takeover = bool(
        stopped_takeover_target and not accepting_ambiguous_trace_override
    )
    item = (
        candidate
        if stopped_takeover_target
        else gate.require_generation_allowed(state, args.asset_id)
    )
    is_hero_pose_background_kind = item.get("asset_kind") == "hero_pose_background"
    is_hero_pose_background = (
        is_hero_pose_background_kind
        and item.get("role") == "base/master"
        and item.get("state_index") is None
        and item.get("motion_tier") == "hero_pose"
        and item.get("white_cat_present") is False
        and isinstance(item.get("schedule_background_asset_id"), str)
        and bool(item["schedule_background_asset_id"].strip())
    )
    if is_hero_pose_background_kind and not is_hero_pose_background:
        raise ValueError("hero-pose background queue contract is invalid")
    is_white_cat_master = item.get("white_cat_present") is True
    expected_style_id, expected_cohesion_id, current_style_binding = (
        resolve_white_cat_visual_style_binding(state, item)
    )
    active_style_selection = (
        load_white_cat_visual_style_selection(state)
        if current_style_binding
        else {}
    )
    expected_style_profile_sha256 = (
        active_style_selection.get("style_profile_checksum_sha256")
        if current_style_binding
        and active_style_selection.get("contract_version") == WHITE_CAT_STYLE_SELECTION_VERSION_V2
        else None
    )
    if (
        item.get("visual_generation_route") != "imagegen"
        or item.get("strict_review") is not True
        or item.get("has_downstream_action_variants") is not True
        or item.get("visible_text_mode") != "none"
    ):
        raise ValueError("asset is not a strict ordinary-imagegen master")

    qa_file = resolve_path(args.qa_path, "QA evidence path")
    qa = json.loads(qa_file.read_text(encoding="utf-8"))
    if (
        qa.get("contract_version") != (
            WHITE_CAT_MASTER_QA_VERSION
            if is_white_cat_master
            else (
                HERO_POSE_BACKGROUND_QA_VERSION
                if is_hero_pose_background
                else "ordinary-imagegen-historical-master-qa-v1"
            )
        )
        or qa.get("result")
        != ("fail" if accepting_ambiguous_trace_override else "pass")
        or qa.get("asset_id") != args.asset_id
        or qa.get("generator")
        != (
            "user-supplied-takeover-image"
            if is_user_takeover
            else "codex-native-imagegen"
        )
        or qa.get("style_profile", {}).get("id") != item.get("treatment_profile_id")
        or not isinstance(qa.get("generation_lineage"), list)
        or len(qa["generation_lineage"]) < 1
        or not isinstance(qa.get("actual_reference_inputs"), list)
    ):
        raise ValueError("ordinary ImageGen master QA evidence is incomplete")
    if is_user_takeover:
        takeover_source = checksum_bound_file(
            qa.get("user_takeover_source", {}),
            "user takeover source",
        )
        if sha256_file(takeover_source) != qa.get("selected_source", {}).get("checksum_sha256"):
            raise ValueError("user takeover source does not match selected exact bytes")

    base_prompt = checksum_bound_file(qa["base_prompt"], "base prompt")
    selected_prompt = checksum_bound_file(qa["selected_prompt"], "selected prompt")
    for prompt in (base_prompt, selected_prompt):
        text = prompt.read_text(encoding="utf-8")
        if "16:9 landscape composition" not in text or "VISIBLE-TEXT MODE: none." not in text:
            raise ValueError("production prompt lacks exact 16:9 or text-free instruction")
        if is_white_cat_master or is_hero_pose_background:
            if is_hero_pose_background and "HERO-POSE BACKGROUND: independent text-free registered background." not in text:
                raise ValueError("hero-pose background prompt lacks its independent-background marker")
            if is_white_cat_master:
                validate_white_cat_prompt_contract(text)
        if current_style_binding:
            validate_white_cat_style_prompt_and_qa(
                prompt_text=text,
                qa=qa,
                style_id=expected_style_id,
                cohesion_id=expected_cohesion_id,
                selection_sha256=item.get("white_cat_visual_style_selection_sha256"),
                style_profile_checksum_sha256=expected_style_profile_sha256,
                current_binding=current_style_binding,
            )

    source = checksum_bound_file(qa["selected_source"], "selected source")
    dimensions = png_dimensions(source)
    if list(dimensions) != qa["selected_source"].get("dimensions") or dimensions[0] <= dimensions[1]:
        raise ValueError("selected source dimensions are stale or non-landscape")
    relative_error = abs((dimensions[0] / dimensions[1]) / (16 / 9) - 1)
    if relative_error > 0.005 or abs(relative_error - qa["selected_source"].get("relative_aspect_ratio_error", 1)) > 1e-12:
        raise ValueError("selected source is outside the 16:9 tolerance")

    profile = qa["style_profile"]
    authority = resolve_path(profile.get("authority_path", ""), "style authority")
    catalog = resolve_path(profile.get("catalog_path", ""), "visual-language catalog")
    if sha256_file(authority) != profile.get("authority_checksum_sha256") or sha256_file(catalog) != profile.get("catalog_checksum_sha256"):
        raise ValueError("ordinary ImageGen style authority checksum is stale")
    if profile.get("medium_id") != expected_style_id:
        raise ValueError("ordinary ImageGen master has the wrong medium")

    character = qa.get("character_reference")
    if is_white_cat_master:
        required_character_files = [
            ("primary_path", "primary_checksum_sha256"),
            ("bible_path", "bible_checksum_sha256"),
            ("generation_constraints_path", "generation_constraints_checksum_sha256"),
            ("satchel_accuracy_rule_path", "satchel_accuracy_rule_checksum_sha256"),
            ("supporting_geometry_path", "supporting_geometry_checksum_sha256"),
        ]
        for path_key, checksum_key in required_character_files:
            file = resolve_path(character.get(path_key, ""), f"character {path_key}")
            if sha256_file(file) != character.get(checksum_key):
                raise ValueError(f"character {path_key} checksum is stale")
        if character.get("version") != "white-cat-v2":
            raise ValueError("canonical white-cat version mismatch")
        primary_path = character["primary_path"]
        primary_checksum = character["primary_checksum_sha256"]
    elif is_hero_pose_background:
        if qa.get("actual_reference_inputs") != []:
            raise ValueError("hero-pose background must not consume publishing-cover or character image inputs")
    else:
        validate_same_episode_reference_inputs(
            state, item, qa["actual_reference_inputs"], workspace,
            qa.get("white_cat_visual_style_binding"),
        )
    for index, stage in enumerate(qa["generation_lineage"]):
        checksum_bound_file(stage.get("prompt", {}), f"generation stage {index} prompt")
        checksum_bound_file(stage.get("output", {}), f"generation stage {index} output")
        references = stage.get("reference_inputs", [])
        if not is_white_cat_master and not is_hero_pose_background:
            validate_same_episode_reference_inputs(
                state, item, references, workspace,
                qa.get("white_cat_visual_style_binding"),
            )
        for ref_index, reference in enumerate(references):
            checksum_bound_file(reference, f"generation stage {index} reference {ref_index}")
        if is_white_cat_master and not any(
            ref.get("path") == primary_path and ref.get("checksum_sha256") == primary_checksum
            for ref in references
        ):
            raise ValueError(f"generation stage {index} lacks canonical white-cat input")
    selected_stage = qa["generation_lineage"][-1]
    if (
        selected_stage.get("selection_status") != "selected"
        or selected_stage.get("prompt") != qa["selected_prompt"]
        or selected_stage.get("output", {}).get("path") != qa["selected_source"]["path"]
        or selected_stage.get("output", {}).get("checksum_sha256") != qa["selected_source"]["checksum_sha256"]
        or selected_stage.get("reference_inputs") != qa["actual_reference_inputs"]
    ):
        raise ValueError("selected generation lineage is inconsistent")
    for index, rejected in enumerate(qa.get("rejected_attempts", [])):
        checksum_bound_file(rejected, f"rejected attempt {index}")

    checks = ["semantic_qa", "visible_text_qa", "style_qa", "continuity_qa", "visual_qa"]
    if not is_white_cat_master and not is_hero_pose_background:
        checks.append("historical_identity_qa")
    for check in checks:
        if qa.get(check, {}).get("result") != "pass":
            raise ValueError(f"{check} did not pass")
    if is_white_cat_master:
        if accepting_ambiguous_trace_override:
            waivable = qa.get("waivable_mechanical_failures")
            if (
                not isinstance(waivable, list)
                or len(waivable) != 1
                or waivable[0].get("error_code") != P0_AMBIGUOUS_TRACE
                or waivable[0].get("observed_result") != "fail"
                or not isinstance(waivable[0].get("reason"), str)
                or not waivable[0]["reason"].startswith(
                    f"{P0_AMBIGUOUS_TRACE}:"
                )
            ):
                raise ValueError(
                    "P0_AMBIGUOUS_TRACE: waivable failure evidence is missing or stale"
                )
            validate_white_cat_ambiguous_trace_failure(
                qa["identity_qa"],
                selected_source=qa["selected_source"],
                selected_source_file=source,
                expected_reason=waivable[0]["reason"],
            )
        else:
            validate_white_cat_identity_qa_v2(
                qa["identity_qa"],
                selected_source=qa["selected_source"],
                selected_source_file=source,
            )
    visible = qa["visible_text_qa"]
    if visible.get("no_visible_text") is not True or visible.get("no_pseudotext") is not True:
        raise ValueError("white-cat text-free QA is incomplete")

    consumed_override: dict[str, Any] | None = None
    override_artifacts: list[dict[str, str]] | None = None
    override_gate_ids: list[str] | None = None
    attempt_blocker: dict[str, Any] | None = None
    if accepting_ambiguous_trace_override:
        if (
            review.get("mode") != "one_click_final_review_v1"
            or state.get("phase") != "awaiting_visual_asset_review"
            or state.get("current_phase") != "awaiting_visual_asset_review"
        ):
            raise ValueError(
                "one-time user gate override requires awaiting_visual_asset_review"
            )
        scope_id = item.get("generation_attempt_scope_id")
        if (
            not isinstance(scope_id, str)
            or not scope_id
            or review.get("user_takeover_scope_id") != scope_id
        ):
            raise ValueError("one-time user gate override scope is stale")
        attempt_control = item.get("image_generation_attempt_control", {})
        white_cat_control = item.get("white_cat_generation_attempt_control", {})
        generation_failures = item.get("image_generation_qa_failures", [])
        white_cat_failures = item.get("white_cat_imagegen_qa_failures", [])
        if (
            attempt_control.get("contract_version")
            != "storyboard-image-generation-attempt-limit-v1"
            or attempt_control.get("generation_attempt_scope_id") != scope_id
            or attempt_control.get("maximum_automatic_rejected_generations") != 3
            or attempt_control.get("rejected_generation_count") != 3
            or attempt_control.get("automatic_retry_status")
            != "stopped_user_takeover_required"
            or white_cat_control.get("contract_version")
            != "white-cat-imagegen-attempt-limit-v1"
            or white_cat_control.get("maximum_automatic_qa_failures") != 3
            or white_cat_control.get("qa_failed_generation_count") != 3
            or white_cat_control.get("automatic_retry_status")
            != "stopped_user_takeover_required"
            or not isinstance(generation_failures, list)
            or len(generation_failures) != 3
            or not isinstance(white_cat_failures, list)
            or len(white_cat_failures) != 3
            or [row.get("attempt_number") for row in generation_failures]
            != [1, 2, 3]
            or [row.get("attempt_number") for row in white_cat_failures]
            != [1, 2, 3]
            or len({
                row.get("output", {}).get("checksum_sha256")
                for row in generation_failures
                if isinstance(row, dict)
            })
            != 3
        ):
            raise ValueError(
                "one-time user gate override lacks the exact three-attempt stop evidence"
            )
        selected_failure = white_cat_failures[1]
        selected_generation_failure = generation_failures[1]
        selected_reason = selected_failure.get("failure_reason")
        if (
            selected_failure.get("error_code") != P0_AMBIGUOUS_TRACE
            or selected_failure.get("prompt") != qa.get("selected_prompt")
            or selected_failure.get("output", {}).get("path")
            != qa.get("selected_source", {}).get("path")
            or selected_failure.get("output", {}).get("checksum_sha256")
            != qa.get("selected_source", {}).get("checksum_sha256")
            or selected_generation_failure.get("prompt")
            != selected_failure.get("prompt")
            or selected_generation_failure.get("output")
            != selected_failure.get("output")
            or selected_generation_failure.get("failure_reason") != selected_reason
            or qa.get("waivable_mechanical_failures") != [{
                "error_code": P0_AMBIGUOUS_TRACE,
                "observed_result": "fail",
                "reason": selected_reason,
            }]
        ):
            raise ValueError(
                "P0_AMBIGUOUS_TRACE: selected source is not the exact second failed output"
            )
        attempt_gate_id = f"storyboard-image-generation-attempt-limit:{scope_id}"
        matching_blockers = [
            blocker
            for blocker in state.get("blockers", [])
            if isinstance(blocker, dict)
            and blocker.get("blocker_id") == attempt_gate_id
        ]
        if (
            len(matching_blockers) != 1
            or matching_blockers[0].get("contract_version")
            != "storyboard-image-generation-attempt-limit-v1"
            or matching_blockers[0].get("asset_id") != item.get("asset_id")
            or matching_blockers[0].get("generation_attempt_scope_id") != scope_id
            or matching_blockers[0].get("status")
            != "stopped_user_takeover_required"
        ):
            raise ValueError(
                "one-time user gate override attempt-limit blocker is missing or stale"
            )
        attempt_blocker = matching_blockers[0]
        inspection = qa["identity_qa"]["anatomy_evidence"][
            "inspection_evidence"
        ]
        override_artifacts = [
            {
                "path": qa["selected_source"]["path"],
                "checksum_sha256": qa["selected_source"]["checksum_sha256"],
            },
            {
                "path": qa["selected_prompt"]["path"],
                "checksum_sha256": qa["selected_prompt"]["checksum_sha256"],
            },
            {
                "path": args.qa_path,
                "checksum_sha256": sha256_file(qa_file),
            },
            {
                "path": inspection["numbered_limb_map_path"],
                "checksum_sha256": inspection[
                    "numbered_limb_map_checksum_sha256"
                ],
            },
        ]
        for failure in generation_failures:
            for key in ("prompt", "output"):
                binding = failure.get(key)
                if not isinstance(binding, dict):
                    raise ValueError(
                        "one-time user gate override failure artifact is missing"
                    )
                checksum_bound_file(binding, f"failed attempt {failure.get('attempt_number')} {key}")
                normalized = {
                    "path": binding.get("path"),
                    "checksum_sha256": binding.get("checksum_sha256"),
                }
                if normalized not in override_artifacts:
                    override_artifacts.append(normalized)
        p0_gate_id = f"visual_asset.{item['asset_id']}.{P0_AMBIGUOUS_TRACE}"
        override_gate_ids = [attempt_gate_id, p0_gate_id]
        exact_message = getattr(args, "override_exact_user_message", "")
        normalized_message = exact_message.lower()
        if (
            item["asset_id"].lower() not in normalized_message
            or "p0_ambiguous_trace" not in normalized_message
            or not any(
                marker in normalized_message
                for marker in ("第二", "第2", "attempt 2")
            )
            or not any(
                marker in normalized_message
                for marker in ("三次", "3次", "attempt")
            )
            or not any(
                marker in normalized_message
                for marker in ("放行", "接受", "允许")
            )
            or not any(
                marker in normalized_message
                for marker in ("一次", "本次", "仅此一次")
            )
            or "保留" not in normalized_message
            or "失败证据" not in normalized_message
        ):
            raise ValueError(
                "one-time user gate override message must name the asset, second failure, P0_AMBIGUOUS_TRACE, three-attempt stop, and evidence retention"
            )
        decided_at = getattr(args, "override_decided_at", "")
        pending_override = {
            "contract_version": "one-time-explicit-user-mechanical-gate-override-v1",
            "episode_id": state.get("episode_id"),
            "scope_id": scope_id,
            "gate_ids": override_gate_ids,
            "acknowledged_failures": [
                {
                    "gate_id": attempt_gate_id,
                    "observed_result": "stopped_user_takeover_required",
                    "reason": attempt_blocker["message"],
                },
                {
                    "gate_id": p0_gate_id,
                    "observed_result": "fail",
                    "reason": selected_reason,
                },
            ],
            "bound_artifacts": override_artifacts,
            "decision": {
                "exact_user_message": exact_message,
                "decided_at": decided_at,
                "disposition": "allow_once",
            },
            "consumption": {
                "from_phase": "awaiting_visual_asset_review",
                "to_phase": "visual_production",
                "status": "available",
            },
            "reuse_forbidden": True,
        }
        pending_override["override_sha256"] = _canonical_sha256(
            pending_override
        )
        transition_id = getattr(args, "override_transition_id", "")
        consumed_at = getattr(args, "override_consumed_at", "")
        if (
            not isinstance(transition_id, str)
            or not transition_id
            or transition_id in _consumed_transition_ids(state)
        ):
            raise ValueError(
                "one-time user gate override consumed transition id is missing or reused"
            )
        episode_id = state.get("episode_id")
        if not isinstance(episode_id, str) or not episode_id:
            raise ValueError("one-time user gate override episode id is missing")
        consumed_override = _consume_user_gate_override(
            pending_override,
            episode_id=episode_id,
            scope_id=scope_id,
            gate_ids=override_gate_ids,
            artifacts=override_artifacts,
            transition_id=transition_id,
            consumed_at=consumed_at,
        )

    identity_fields = ({
        "character_reference_version": character["version"],
        "character_reference_path": character["primary_path"],
        "character_reference_checksum_sha256": character["primary_checksum_sha256"],
        "character_bible_path": character["bible_path"],
        "character_bible_checksum_sha256": character["bible_checksum_sha256"],
        "generation_constraints_path": character["generation_constraints_path"],
        "generation_constraints_checksum_sha256": character["generation_constraints_checksum_sha256"],
        "satchel_accuracy_rule_path": character["satchel_accuracy_rule_path"],
        "satchel_accuracy_rule_checksum_sha256": character["satchel_accuracy_rule_checksum_sha256"],
        "supporting_geometry_reference_path": character["supporting_geometry_path"],
        "supporting_geometry_reference_checksum_sha256": character["supporting_geometry_checksum_sha256"],
        "identity_qa": qa["identity_qa"],
    } if is_white_cat_master else {} if is_hero_pose_background else {
        "historical_identity_qa": qa["historical_identity_qa"],
    })
    item.update(
        status="awaiting_batch_qa" if one_click else "awaiting_user_approval",
        generator=qa["generator"],
        path=qa["selected_source"]["path"],
        checksum_sha256=qa["selected_source"]["checksum_sha256"],
        measured_dimensions=list(dimensions),
        measured_aspect_ratio_relative_error=relative_error,
        source_approval_object=True,
        composition_derivative_status="pending_source_approval",
        base_prompt_path=qa["base_prompt"]["path"],
        base_prompt_checksum_sha256=qa["base_prompt"]["checksum_sha256"],
        prompt_path=qa["selected_prompt"]["path"],
        prompt_checksum_sha256=qa["selected_prompt"]["checksum_sha256"],
        style_profile_id=profile["id"],
        style_medium_id=profile["medium_id"],
        style_authority_path=profile["authority_path"],
        style_authority_checksum_sha256=profile["authority_checksum_sha256"],
        actual_reference_inputs=qa["actual_reference_inputs"],
        generation_lineage=qa["generation_lineage"],
        rejected_attempts=qa.get("rejected_attempts", []),
        qa_evidence_path=args.qa_path,
        qa_evidence_checksum_sha256=sha256_file(qa_file),
        technical_qa={"result": "pass", "rule_id": "ordinary-imagegen-source-v1", "measured_dimensions": list(dimensions)},
        semantic_qa=qa["semantic_qa"],
        visible_text_qa=qa["visible_text_qa"],
        style_qa=qa["style_qa"],
        continuity_qa=qa["continuity_qa"],
        visual_qa=qa["visual_qa"],
        presented_checksum_sha256=qa["selected_source"]["checksum_sha256"],
        presented_at=args.qa_time,
        exact_presentation_message=(None if one_click else (
            (
                f"现登记用户接手提供的 {item['shot_id']} 母图精确 PNG；仅此附件字节可按用户当前明确批准继续。"
                if is_user_takeover
                else f"现呈交 {item['shot_id']} 主图精确源 PNG，等待用户明确批准此精确字节后，方可生成其动作变体。"
            )
        )),
        **identity_fields,
    )
    if is_white_cat_master or is_hero_pose_background:
        item["qa_contract_version"] = qa["contract_version"]
    if is_user_takeover:
        item["user_takeover_source"] = qa["user_takeover_source"]
        item["user_takeover_adopted_at"] = args.qa_time
    if accepting_ambiguous_trace_override:
        if (
            consumed_override is None
            or override_artifacts is None
            or override_gate_ids is None
            or attempt_blocker is None
        ):
            raise ValueError("one-time user gate override record is incomplete")
        item.update(
            status=WAIVED_PENDING_FINAL_REVIEW_STATUS,
            batch_qa_checksum_sha256=qa["selected_source"]["checksum_sha256"],
            batch_qa_time=args.qa_time,
            mechanical_qa_result="failed_but_waived_once",
            user_mechanical_gate_override=consumed_override,
            user_mechanical_gate_override_result="pass_with_user_override",
            waived_mechanical_gate_ids=override_gate_ids,
            override_bound_artifacts=override_artifacts,
            original_qa_result="fail",
        )
        attempt_blocker.update(
            status="failed_but_waived_once",
            user_mechanical_gate_override_sha256=consumed_override[
                "override_sha256"
            ],
        )
        review["queue_generation_allowed"] = True
        state["phase"] = "visual_production"
        state["current_phase"] = "visual_production"
        _clear_active_takeover(review)
    if one_click:
        if not accepting_ambiguous_trace_override:
            gate.record_hybrid_qa_pass(state, args.asset_id, args.qa_time)
        next_item = next_generation_target(
            review.get("queue", []),
            gate.GENERATION_UNLOCKING_STATUSES,
        )
        review["current_asset_id"] = next_item.get("asset_id") if next_item else None
    else:
        state["visual_asset_review"]["queue_generation_allowed"] = False
        state["visual_asset_review"]["current_asset_id"] = args.asset_id
        state["phase"] = "awaiting_visual_asset_review"
        state["current_phase"] = "awaiting_visual_asset_review"

    temporary = state_file.with_suffix(".json.imagegen-strict.tmp")
    if temporary.exists():
        raise ValueError("ordinary ImageGen strict QA temporary path already exists")
    temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(state_file)
    return {
        "result": (
            "pass_with_user_override"
            if accepting_ambiguous_trace_override
            else "pass"
        ),
        "asset_id": args.asset_id,
        "status": item["status"],
        "checksum_sha256": item["checksum_sha256"],
        "measured_dimensions": item["measured_dimensions"],
        "queue_generation_allowed": state["visual_asset_review"]["queue_generation_allowed"],
        "current_asset_id": state["visual_asset_review"]["current_asset_id"],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("episode_workspace")
    parser.add_argument("asset_id")
    parser.add_argument("qa_path")
    parser.add_argument("qa_time")
    parser.add_argument(
        "--accept-p0-ambiguous-trace-with-user-override",
        action="store_true",
    )
    parser.add_argument("--override-exact-user-message")
    parser.add_argument("--override-decided-at")
    parser.add_argument("--override-transition-id")
    parser.add_argument("--override-consumed-at")
    args = parser.parse_args()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}", args.qa_time):
        raise SystemExit("qa_time must be ISO-8601 with offset")
    if args.accept_p0_ambiguous_trace_with_user_override and (
        not args.override_exact_user_message
        or not args.override_transition_id
        or not re.fullmatch(
            r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}",
            args.override_decided_at or "",
        )
        or not re.fullmatch(
            r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}",
            args.override_consumed_at or "",
        )
    ):
        raise SystemExit(
            "P0_AMBIGUOUS_TRACE override requires the exact user message, transition id, and ISO-8601 decision/consumption times"
        )
    print(json.dumps(record(args), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
