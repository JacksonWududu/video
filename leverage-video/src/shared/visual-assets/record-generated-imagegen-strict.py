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
from typing import Any
import zlib


REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
GATE_PATH = REPOSITORY_ROOT / ".agents/skills/run-knowledge-video/scripts/validate_visual_approval_state.py"
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


def _canonical_sha256(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def resolve_white_cat_visual_style_binding(
    state: dict[str, Any], item: dict[str, Any]
) -> tuple[str, str, bool]:
    style_id = item.get("white_cat_visual_style_id")
    selection_sha256 = item.get("white_cat_visual_style_selection_sha256")
    cohesion_id = item.get("visual_cohesion_profile_id")
    if style_id is None and selection_sha256 is None and cohesion_id is None:
        return "loose-line-vivid-watercolor", "warm-paper-watercolor-cohesion-v1", False
    if style_id is None or not SHA256_RE.fullmatch(selection_sha256 or "") or cohesion_id is None:
        raise ValueError("white-cat visual style binding is incomplete")
    selection = state.get("white_cat_visual_style_selection")
    if not isinstance(selection, dict):
        raise ValueError("white-cat visual style selection is missing or unsupported")
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
    is_user_takeover = bool(
        candidate
        and review.get("user_takeover_required") is True
        and review.get("user_takeover_asset_id") == args.asset_id
        and review.get("current_asset_id") == args.asset_id
        and review.get("queue_generation_allowed") is False
        and candidate.get("status") == "awaiting_user_approval"
        and candidate.get("white_cat_generation_attempt_control", {}).get("automatic_retry_status")
        == "stopped_user_takeover_required"
    )
    item = candidate if is_user_takeover else gate.require_generation_allowed(state, args.asset_id)
    is_white_cat_master = item.get("white_cat_present") is True
    expected_style_id, expected_cohesion_id, current_style_binding = (
        resolve_white_cat_visual_style_binding(state, item)
        if is_white_cat_master
        else ("loose-line-vivid-watercolor", "warm-paper-watercolor-cohesion-v1", False)
    )
    active_style_selection = state.get("white_cat_visual_style_selection", {})
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
            else "ordinary-imagegen-historical-master-qa-v1"
        )
        or qa.get("result") != "pass"
        or qa.get("asset_id") != args.asset_id
        or qa.get("generator")
        != ("user-supplied-takeover-image" if is_user_takeover else "codex-native-imagegen")
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
        if is_white_cat_master:
            validate_white_cat_prompt_contract(text)
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
    elif qa.get("actual_reference_inputs") != []:
        raise ValueError("historical master declares unrecorded reference inputs")
    for index, stage in enumerate(qa["generation_lineage"]):
        checksum_bound_file(stage.get("prompt", {}), f"generation stage {index} prompt")
        checksum_bound_file(stage.get("output", {}), f"generation stage {index} output")
        references = stage.get("reference_inputs", [])
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
    if not is_white_cat_master:
        checks.append("historical_identity_qa")
    for check in checks:
        if qa.get(check, {}).get("result") != "pass":
            raise ValueError(f"{check} did not pass")
    if is_white_cat_master:
        validate_white_cat_identity_qa_v2(
            qa["identity_qa"],
            selected_source=qa["selected_source"],
            selected_source_file=source,
        )
    visible = qa["visible_text_qa"]
    if visible.get("no_visible_text") is not True or visible.get("no_pseudotext") is not True:
        raise ValueError("white-cat text-free QA is incomplete")

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
    } if is_white_cat_master else {
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
    if is_white_cat_master:
        item["qa_contract_version"] = qa["contract_version"]
    if is_user_takeover:
        item["user_takeover_source"] = qa["user_takeover_source"]
        item["user_takeover_adopted_at"] = args.qa_time
    if one_click:
        gate.record_hybrid_qa_pass(state, args.asset_id, args.qa_time)
        active = [
            queued for queued in review.get("queue", [])
            if queued.get("active_for_current_storyboard") is not False
            and queued.get("status") != "superseded"
        ]
        next_item = next((queued for queued in active if queued.get("status") not in {
            "approved", "qa_passed_pending_batch_review", "qa_passed_pending_final_review",
        }), None)
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
        "result": "pass",
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
    args = parser.parse_args()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}", args.qa_time):
        raise SystemExit("qa_time must be ISO-8601 with offset")
    print(json.dumps(record(args), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
