from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import stat
import subprocess
import sys
from pathlib import Path
from typing import Any


REQUIRED_TOP = {"assets", "script", "schema", "docs"}
REQUIRED_ASSETS = {"audio", "image", "narration", "video"}
EXTENSION_CATEGORIES = {
    ".json": ("schema",),
    ".js": ("script",),
    ".css": ("script",),
    ".html": ("docs",),
    ".jsx": ("script",),
    ".ts": ("script",),
    ".tsx": ("script",),
    ".mjs": ("script",),
    ".cjs": ("script",),
    ".py": ("script",),
    ".sh": ("script",),
    ".mp3": ("assets", "audio"),
    ".wav": ("assets", "audio"),
    ".aac": ("assets", "audio"),
    ".m4a": ("assets", "audio"),
    ".flac": ("assets", "audio"),
    ".ogg": ("assets", "audio"),
    ".png": ("assets", "image"),
    ".jpg": ("assets", "image"),
    ".jpeg": ("assets", "image"),
    ".webp": ("assets", "image"),
    ".svg": ("assets", "image"),
    ".gif": ("assets", "image"),
    ".mp4": ("assets", "video"),
    ".mov": ("assets", "video"),
    ".mkv": ("assets", "video"),
    ".webm": ("assets", "video"),
    ".srt": ("assets", "narration"),
    ".vtt": ("assets", "narration"),
    ".ass": ("assets", "narration"),
    ".md": ("docs",),
    ".pdf": ("docs",),
    ".csv": ("docs",),
    ".tsv": ("docs",),
    ".docx": ("docs",),
}
NARRATION_TEXT_MARKERS = (
    "narration",
    "voiceover",
    "subtitle",
    "storyboard",
    "shot",
    "transcript",
    "口播",
    "字幕",
    "分镜",
    "转写",
)
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
WHITE_CAT_PENDING_QA_STATUSES = {
    "awaiting_user_approval",
    "awaiting_batch_qa",
    "qa_passed_pending_batch_review",
    "qa_passed_pending_final_review",
    "qa_failed_but_waived_once_pending_final_review",
}
WAIVED_PENDING_FINAL_REVIEW_STATUS = (
    "qa_failed_but_waived_once_pending_final_review"
)
WHITE_CAT_IMAGEGEN_QA_CONTRACTS = {
    "base/master": "ordinary-imagegen-white-cat-master-qa-v2",
    "action": "ordinary-imagegen-white-cat-action-qa-v2",
}
WHITE_CAT_XUAN_QA_CONTRACTS = {
    "base/master": "xuan-paper-diorama-asset-qa-v1",
    "action": "xuan-paper-diorama-action-qa-v1",
}
WHITE_CAT_ANATOMY_QA_CONTRACT = "white-cat-anatomy-qa-v2"
WHITE_CAT_PROMPT_FIXED_MARKER_QA_CONTRACT = (
    "white-cat-prompt-fixed-marker-qa-v1"
)
WHITE_CAT_SATCHEL_PROMPT_MARKER = "WHITE-CAT SATCHEL STRAP LOCK:"
WHITE_CAT_HERO_POSE_PROMPT_MARKER = (
    "HERO-POSE ASSET: full-canvas transparent RGBA with fixed "
    "registration anchors."
)
P0_FORWARD_REVERSE_MISMATCH = "P0_FORWARD_REVERSE_MISMATCH"
P0_AMBIGUOUS_TRACE = "P0_AMBIGUOUS_TRACE"
P2_SATCHEL_TOPOLOGY = "P2_SATCHEL_TOPOLOGY"
BOTTOM_SUBTITLE_SAFE_AREA = "BOTTOM_SUBTITLE_SAFE_AREA"
VISIBLE_SYMBOL_FREE = "VISIBLE_SYMBOL_FREE"
FAILED_P0_MASTER_EDIT_SOURCE_GATE = "P0_FAILED_SOURCE_MUST_NOT_BE_EDIT_TARGET"
FAILED_MASTER_EDIT_SOURCE_OVERRIDE_VERSION = (
    "failed-p0-master-action-family-edit-source-override-v1"
)
WHITE_CAT_FORWARD_REVERSE_MAPPING_QA_CONTRACT = (
    "white-cat-forward-reverse-mapping-qa-v1"
)
IAN_LAYERED_PACKAGE_REQUIRED_STATUSES = {
    "awaiting_batch_qa",
    "qa_passed_pending_batch_review",
    "qa_passed_pending_final_review",
    "awaiting_user_approval",
    "approved",
}
VISIBLE_TEXT_APPROVAL_REQUIRED_PHASES = {
    "visible_text_review_approved",
    "awaiting_transition_review",
    "transition_review_approved",
    "transition_policy_authorized",
    "storyboard_qa_passed",
    "awaiting_storyboard_review",
    "storyboard_review_approved",
    "storyboard_policy_authorized",
    "visual_production",
    "awaiting_visual_asset_review",
    "awaiting_precomposition_visual_review",
    "visual_assets_locked",
    "awaiting_caption_delivery_choice",
    "assembly_preflight",
    "composition_locked",
    "final_rendering",
}
VISIBLE_TEXT_ROW_APPROVAL_FIELDS = {
    "approval",
    "status",
    "exact_message",
    "decided_at",
}
VISIBLE_TEXT_COLLOQUIAL_MARKERS = (
    "你看",
    "你会发现",
    "你可以",
    "我们",
    "咱们",
    "大家",
    "其实",
    "说白了",
    "换句话说",
    "也就是说",
    "简单来说",
    "然后呢",
    "那么",
    "所以说",
    "这就是",
    "有没有",
    "怎么办",
    "来看",
    "想一想",
    "别急",
)


def _expected_category(path: Path) -> tuple[str, ...] | None:
    suffix = path.suffix.lower()
    if suffix in {".txt", ".md"} and any(
        marker in path.name.lower() for marker in NARRATION_TEXT_MARKERS
    ):
        return ("assets", "narration")
    return EXTENSION_CATEGORIES.get(suffix)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _resolve_bound_regular_file(
    repo: Path,
    path_value: Any,
    checksum_value: Any,
    label: str,
) -> tuple[Path | None, list[str]]:
    errors: list[str] = []
    if not isinstance(path_value, str) or not path_value or Path(path_value).is_absolute():
        return None, [f"{label} path must be root-relative"]
    if not isinstance(checksum_value, str) or not SHA256_RE.fullmatch(checksum_value):
        return None, [f"{label} checksum must be lowercase SHA-256"]

    relative = Path(path_value)
    if ".." in relative.parts:
        return None, [f"{label} path must stay within the repository"]
    candidate = repo / relative
    try:
        resolved = candidate.resolve(strict=True)
        resolved.relative_to(repo)
    except (FileNotFoundError, RuntimeError, ValueError, OSError):
        return None, [f"{label} path is missing or outside the repository: {path_value}"]

    current = repo
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            errors.append(f"{label} path must not contain a symlink: {path_value}")
            break
    try:
        mode = candidate.stat(follow_symlinks=False).st_mode
    except OSError:
        return None, [f"{label} path is not readable: {path_value}"]
    if not stat.S_ISREG(mode):
        errors.append(f"{label} path must be a regular file: {path_value}")
    if errors:
        return None, errors
    try:
        actual_checksum = _sha256_file(candidate)
    except OSError:
        return None, [f"{label} path is not readable: {path_value}"]
    if actual_checksum != checksum_value:
        return None, [f"{label} checksum is stale: {path_value}"]
    return candidate, []


def _white_cat_role(item: dict[str, Any]) -> str | None:
    role = item.get("role")
    if role == "base/master":
        return "base/master"
    if isinstance(role, str) and role.startswith("action-"):
        return "action"
    return None


def _white_cat_prompt_fixed_marker_failures(
    item: dict[str, Any], prompt_text: str,
) -> list[dict[str, str]]:
    asset_id = item.get("asset_id")
    failures: list[dict[str, str]] = []
    if WHITE_CAT_SATCHEL_PROMPT_MARKER not in prompt_text:
        failures.append({
            "gate_id": f"visual_asset.{asset_id}.P2_PROMPT_FIXED_MARKER",
            "observed_result": "fail",
            "reason": (
                "P2_PROMPT_FIXED_MARKER: required literal is missing: "
                f"{WHITE_CAT_SATCHEL_PROMPT_MARKER}"
            ),
        })
    if (
        item.get("asset_kind") == "hero_pose"
        and WHITE_CAT_HERO_POSE_PROMPT_MARKER not in prompt_text
    ):
        failures.append({
            "gate_id": (
                f"visual_asset.{asset_id}.HERO_POSE_PROMPT_FIXED_MARKER"
            ),
            "observed_result": "fail",
            "reason": (
                "HERO_POSE_PROMPT_FIXED_MARKER: required literal is missing: "
                f"{WHITE_CAT_HERO_POSE_PROMPT_MARKER}"
            ),
        })
    return failures


def _is_exact_prompt_marker_release_message(
    value: Any, *, asset_id: Any, hero_pose: bool,
) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    message = value.lower()
    return (
        str(asset_id).lower() in message
        and "p2" in message
        and "提示词" in message
        and "标记" in message
        and (not hero_pose or "hero-pose" in message)
        and any(marker in message for marker in ("放行", "接受", "允许"))
        and any(marker in message for marker in ("一次", "本次", "仅此一次"))
        and "保留" in message
        and "真实提示词" in message
        and "失败证据" in message
    )


def _count_consumed_transition_id(value: Any, transition_id: str) -> int:
    if isinstance(value, list):
        return sum(_count_consumed_transition_id(row, transition_id) for row in value)
    if not isinstance(value, dict):
        return 0
    return sum(
        1 if key == "consumed_transition_id" and nested == transition_id
        else _count_consumed_transition_id(nested, transition_id)
        for key, nested in value.items()
    )


def _is_visible_symbol_override(item: dict[str, Any]) -> bool:
    return (
        f"visual_asset.{item.get('asset_id')}.{VISIBLE_SYMBOL_FREE}"
        in item.get("waived_mechanical_gate_ids", [])
    )


def _is_ambiguous_trace_override(item: dict[str, Any]) -> bool:
    return (
        f"visual_asset.{item.get('asset_id')}.{P0_AMBIGUOUS_TRACE}"
        in item.get("waived_mechanical_gate_ids", [])
    )


def _validate_waived_visible_symbol_workspace_evidence(
    repo: Path,
    item: dict[str, Any],
    qa: dict[str, Any],
    state: dict[str, Any] | None,
) -> list[str]:
    asset_id = item.get("asset_id")
    label = f"White-cat asset {asset_id!r} visible-symbol override"
    if state is None:
        return [f"{label} lacks episode state"]
    visible = qa.get("visible_text_qa")
    identity = qa.get("identity_qa")
    if (
        item.get("visual_generation_route") != "imagegen"
        or _white_cat_role(item) != "action"
        or item.get("mechanical_qa_result") != "failed_but_waived_once"
        or item.get("user_mechanical_gate_override_result")
        != "pass_with_user_override"
        or not isinstance(identity, dict)
        or identity.get("result") != "pass"
        or not isinstance(visible, dict)
        or visible.get("result") != "fail"
        or visible.get("no_visible_text") is not True
        or visible.get("no_pseudotext") is not True
        or visible.get("no_decorative_symbols") is not False
    ):
        return [f"{label} does not preserve the exact failed visible-symbol result"]

    scope_id = item.get("generation_attempt_scope_id")
    attempt_control = item.get("image_generation_attempt_control")
    failures = item.get("image_generation_qa_failures")
    checksums = [
        failure.get("output", {}).get("checksum_sha256")
        for failure in failures or []
        if isinstance(failure, dict)
    ]
    if (
        not isinstance(scope_id, str)
        or not scope_id
        or not isinstance(attempt_control, dict)
        or attempt_control.get("contract_version")
        != "storyboard-image-generation-attempt-limit-v1"
        or attempt_control.get("generation_attempt_scope_id") != scope_id
        or attempt_control.get("maximum_automatic_rejected_generations") != 3
        or attempt_control.get("rejected_generation_count") != 3
        or attempt_control.get("automatic_retry_status")
        != "stopped_user_takeover_required"
        or not isinstance(failures, list)
        or len(failures) != 3
        or len(set(checksums)) != 3
    ):
        return [f"{label} attempt-limit history is stale"]
    latest = failures[-1]
    source_binding = {
        "path": item.get("path"),
        "checksum_sha256": item.get("checksum_sha256"),
    }
    prompt_binding = {
        "path": item.get("prompt_path"),
        "checksum_sha256": item.get("prompt_checksum_sha256"),
    }
    if latest.get("output") != source_binding or latest.get("prompt") != prompt_binding:
        return [f"{label} selected source is not the exact third failed output"]
    expected_waivable = [{
        "error_code": VISIBLE_SYMBOL_FREE,
        "observed_result": "fail",
        "reason": latest.get("failure_reason"),
    }]
    errors: list[str] = []
    if qa.get("waivable_mechanical_failures") != expected_waivable:
        errors.append(f"{label} waivable failure evidence is stale")
    inspection = identity.get("anatomy_evidence", {}).get("inspection_evidence", {})
    artifacts = [
        source_binding,
        prompt_binding,
        {
            "path": item.get("qa_evidence_path"),
            "checksum_sha256": item.get("qa_evidence_checksum_sha256"),
        },
        {
            "path": inspection.get("numbered_limb_map_path"),
            "checksum_sha256": inspection.get("numbered_limb_map_checksum_sha256"),
        },
    ]
    for binding in (latest.get("output"), latest.get("prompt")):
        if not isinstance(binding, dict):
            errors.append(f"{label} failed-artifact binding is missing")
            continue
        normalized = {
            "path": binding.get("path"),
            "checksum_sha256": binding.get("checksum_sha256"),
        }
        if normalized not in artifacts:
            artifacts.append(normalized)
    for index, binding in enumerate(artifacts):
        _, binding_errors = _resolve_bound_regular_file(
            repo,
            binding.get("path"),
            binding.get("checksum_sha256"),
            f"{label} artifact {index}",
        )
        errors.extend(binding_errors)
    if item.get("override_bound_artifacts") != artifacts:
        errors.append(f"{label} artifact list is stale")

    attempt_gate_id = f"storyboard-image-generation-attempt-limit:{scope_id}"
    visible_gate_id = f"visual_asset.{asset_id}.{VISIBLE_SYMBOL_FREE}"
    gate_ids = [attempt_gate_id, visible_gate_id]
    override = item.get("user_mechanical_gate_override")
    if not isinstance(override, dict):
        return errors + [f"{label} record is missing"]
    failure_by_gate = {
        failure.get("gate_id"): failure
        for failure in override.get("acknowledged_failures", [])
        if isinstance(failure, dict)
    }
    decision = override.get("decision")
    consumption = override.get("consumption")
    if (
        override.get("contract_version")
        != "one-time-explicit-user-mechanical-gate-override-v1"
        or override.get("episode_id") != state.get("episode_id")
        or override.get("scope_id") != scope_id
        or override.get("gate_ids") != gate_ids
        or item.get("waived_mechanical_gate_ids") != gate_ids
        or override.get("bound_artifacts") != artifacts
        or failure_by_gate.get(attempt_gate_id, {}).get("observed_result")
        != "stopped_user_takeover_required"
        or failure_by_gate.get(visible_gate_id, {}).get("reason")
        != latest.get("failure_reason")
        or not isinstance(decision, dict)
        or decision.get("disposition") != "allow_once"
        or not isinstance(consumption, dict)
        or consumption.get("from_phase") != "awaiting_visual_asset_review"
        or consumption.get("to_phase") != "visual_production"
        or consumption.get("status") != "consumed"
        or override.get("reuse_forbidden") is not True
    ):
        errors.append(f"{label} contract or transition is stale")
    else:
        message = str(decision.get("exact_user_message", "")).lower()
        if (
            str(asset_id).lower() not in message
            or not any(marker in message for marker in ("可见符号", "符号", "图案", "浮雕"))
            or not any(marker in message for marker in ("三次", "3次", "重试", "attempt"))
            or not any(marker in message for marker in ("放行", "接受", "允许"))
        ):
            errors.append(f"{label} decision is not asset/symbol/attempt-limit specific")
        projection = {
            key: override.get(key)
            for key in (
                "contract_version", "episode_id", "scope_id", "gate_ids",
                "acknowledged_failures", "bound_artifacts", "decision",
                "consumption", "reuse_forbidden",
            )
        }
        if override.get("override_sha256") != _canonical_sha256(projection):
            errors.append(f"{label} checksum is stale")
        transition_id = consumption.get("consumed_transition_id")
        if not isinstance(transition_id, str) or _count_consumed_transition_id(
            state, transition_id
        ) != 1:
            errors.append(f"{label} transition ID is missing or reused")
    matching_blockers = [
        blocker for blocker in state.get("blockers", [])
        if isinstance(blocker, dict)
        and blocker.get("blocker_id") == attempt_gate_id
    ]
    if (
        len(matching_blockers) != 1
        or matching_blockers[0].get("status") != "failed_but_waived_once"
        or matching_blockers[0].get("user_mechanical_gate_override_sha256")
        != override.get("override_sha256")
    ):
        errors.append(f"{label} attempt-limit blocker is stale")
    return errors


def _validate_waived_ambiguous_trace_workspace_evidence(
    repo: Path,
    item: dict[str, Any],
    qa: dict[str, Any],
    state: dict[str, Any] | None,
) -> list[str]:
    asset_id = item.get("asset_id")
    label = f"White-cat asset {asset_id!r} P0 ambiguous-trace override"
    white_cat_role = _white_cat_role(item)
    early_action_acceptance = white_cat_role == "action"
    if state is None:
        return [f"{label} lacks episode state"]
    identity = qa.get("identity_qa")
    anatomy = identity.get("anatomy_evidence") if isinstance(identity, dict) else None
    if (
        item.get("visual_generation_route") != "imagegen"
        or white_cat_role not in {"base/master", "action"}
        or item.get("mechanical_qa_result") != "failed_but_waived_once"
        or item.get("user_mechanical_gate_override_result")
        != "pass_with_user_override"
        or not isinstance(identity, dict)
        or identity.get("result") != "fail"
        or identity.get("cat_count") != 1
        or identity.get("foreleg_count") != 2
        or identity.get("hindleg_count") != 2
        or identity.get("paw_count") != 4
        or identity.get("accessory_geometry_correct") is not True
        or identity.get("satchel_count") != 1
        or identity.get("bag_strap_count") != 2
        or identity.get("bag_end_attachment_count") != 2
        or identity.get("front_strap_attached_to_forward_bag_end") is not True
        or identity.get("rear_strap_attached_to_rear_bag_end") is not True
        or identity.get("himation_trim_distinct_from_bag_straps") is not True
        or identity.get("both_bag_end_anchors_visibly_traceable") is not True
        or identity.get("strap_paths_spatially_distinct") is not True
        or identity.get("source_retry_policy_compliant") is not True
        or not isinstance(anatomy, dict)
        or anatomy.get("contract_version") != WHITE_CAT_ANATOMY_QA_CONTRACT
        or anatomy.get("result") != "fail"
        or anatomy.get("error_code") != P0_AMBIGUOUS_TRACE
        or anatomy.get("ambiguous_limb_regions") != 1
        or anatomy.get("unassigned_paw_like_shapes") != 0
        or anatomy.get("branched_or_fused_limb_regions") != 0
    ):
        return [f"{label} does not preserve the exact failed P0 result"]
    traces = anatomy.get("limb_traces")
    if (
        not isinstance(traces, list)
        or len(traces) != 4
        or [trace.get("id") for trace in traces if isinstance(trace, dict)]
        != ["F1", "F2", "H1", "H2"]
        or [
            trace.get("id")
            for trace in traces
            if isinstance(trace, dict)
            and trace.get("continuous_to_torso") is not True
        ]
        != ["H1"]
    ):
        return [f"{label} H1 ambiguity trace is stale"]

    scope_id = item.get("generation_attempt_scope_id")
    attempt_control = item.get("image_generation_attempt_control")
    white_cat_control = item.get("white_cat_generation_attempt_control")
    generation_failures = item.get("image_generation_qa_failures")
    white_cat_failures = item.get("white_cat_imagegen_qa_failures")
    expected_failure_count = 1 if early_action_acceptance else 3
    expected_retry_status = (
        "stopped_by_explicit_user_acceptance"
        if early_action_acceptance
        else "stopped_user_takeover_required"
    )
    if (
        not isinstance(scope_id, str)
        or not scope_id
        or not isinstance(attempt_control, dict)
        or attempt_control.get("contract_version")
        != "storyboard-image-generation-attempt-limit-v1"
        or attempt_control.get("generation_attempt_scope_id") != scope_id
        or attempt_control.get("maximum_automatic_rejected_generations") != 3
        or attempt_control.get("rejected_generation_count") != expected_failure_count
        or attempt_control.get("automatic_retry_status") != expected_retry_status
        or not isinstance(white_cat_control, dict)
        or white_cat_control.get("contract_version")
        != "white-cat-imagegen-attempt-limit-v1"
        or white_cat_control.get("maximum_automatic_qa_failures") != 3
        or white_cat_control.get("qa_failed_generation_count")
        != expected_failure_count
        or white_cat_control.get("automatic_retry_status") != expected_retry_status
        or not isinstance(generation_failures, list)
        or len(generation_failures) != expected_failure_count
        or not isinstance(white_cat_failures, list)
        or len(white_cat_failures) != expected_failure_count
        or [failure.get("attempt_number") for failure in generation_failures]
        != list(range(1, expected_failure_count + 1))
        or [failure.get("attempt_number") for failure in white_cat_failures]
        != list(range(1, expected_failure_count + 1))
    ):
        return [f"{label} attempt-limit history is stale"]
    selected_index = 0 if early_action_acceptance else 1
    selected_failure = white_cat_failures[selected_index]
    selected_generation_failure = generation_failures[selected_index]
    source_binding = {
        "path": item.get("path"),
        "checksum_sha256": item.get("checksum_sha256"),
    }
    prompt_binding = {
        "path": item.get("prompt_path"),
        "checksum_sha256": item.get("prompt_checksum_sha256"),
    }
    selected_reason = selected_failure.get("failure_reason")
    if (
        selected_failure.get("error_code") != P0_AMBIGUOUS_TRACE
        or selected_failure.get("output") != source_binding
        or selected_failure.get("prompt") != prompt_binding
        or selected_generation_failure.get("output") != source_binding
        or selected_generation_failure.get("prompt") != prompt_binding
        or selected_generation_failure.get("failure_reason") != selected_reason
        or anatomy.get("failure_reason") != selected_reason
        or next(trace for trace in traces if trace.get("id") == "H1").get(
            "ambiguity_reason"
        )
        != selected_reason
    ):
        source_label = "first" if early_action_acceptance else "second"
        return [f"{label} selected source is not the exact {source_label} failure"]
    expected_waivable = [{
        "error_code": P0_AMBIGUOUS_TRACE,
        "observed_result": "fail",
        "reason": selected_reason,
    }]
    errors: list[str] = []
    if qa.get("waivable_mechanical_failures") != expected_waivable:
        errors.append(f"{label} waivable failure evidence is stale")
    inspection = anatomy.get("inspection_evidence", {})
    artifacts = [
        source_binding,
        prompt_binding,
        {
            "path": item.get("qa_evidence_path"),
            "checksum_sha256": item.get("qa_evidence_checksum_sha256"),
        },
        {
            "path": inspection.get("numbered_limb_map_path"),
            "checksum_sha256": inspection.get(
                "numbered_limb_map_checksum_sha256"
            ),
        },
    ]
    for failure in generation_failures:
        for key in ("prompt", "output"):
            binding = failure.get(key)
            if not isinstance(binding, dict):
                errors.append(f"{label} failed-artifact binding is missing")
                continue
            normalized = {
                "path": binding.get("path"),
                "checksum_sha256": binding.get("checksum_sha256"),
            }
            if normalized not in artifacts:
                artifacts.append(normalized)
    for index, binding in enumerate(artifacts):
        _, binding_errors = _resolve_bound_regular_file(
            repo,
            binding.get("path"),
            binding.get("checksum_sha256"),
            f"{label} artifact {index}",
        )
        errors.extend(binding_errors)
    if item.get("override_bound_artifacts") != artifacts:
        errors.append(f"{label} artifact list is stale")

    attempt_gate_id = f"storyboard-image-generation-attempt-limit:{scope_id}"
    p0_gate_id = f"visual_asset.{asset_id}.{P0_AMBIGUOUS_TRACE}"
    gate_ids = [p0_gate_id] if early_action_acceptance else [attempt_gate_id, p0_gate_id]
    override = item.get("user_mechanical_gate_override")
    if not isinstance(override, dict):
        return errors + [f"{label} record is missing"]
    failures_by_gate = {
        failure.get("gate_id"): failure
        for failure in override.get("acknowledged_failures", [])
        if isinstance(failure, dict)
    }
    decision = override.get("decision")
    consumption = override.get("consumption")
    if (
        override.get("contract_version")
        != "one-time-explicit-user-mechanical-gate-override-v1"
        or override.get("episode_id") != state.get("episode_id")
        or override.get("scope_id") != scope_id
        or override.get("gate_ids") != gate_ids
        or item.get("waived_mechanical_gate_ids") != gate_ids
        or override.get("bound_artifacts") != artifacts
        or (
            not early_action_acceptance
            and failures_by_gate.get(attempt_gate_id, {}).get("observed_result")
            != "stopped_user_takeover_required"
        )
        or failures_by_gate.get(p0_gate_id, {}).get("reason") != selected_reason
        or not isinstance(decision, dict)
        or decision.get("disposition") != "allow_once"
        or not isinstance(consumption, dict)
        or consumption.get("from_phase") != (
            "visual_production"
            if early_action_acceptance
            else "awaiting_visual_asset_review"
        )
        or consumption.get("to_phase") != "visual_production"
        or consumption.get("status") != "consumed"
        or override.get("reuse_forbidden") is not True
    ):
        errors.append(f"{label} contract or transition is stale")
    else:
        message = str(decision.get("exact_user_message", "")).lower()
        exact_source_marker = (
            any(marker in message for marker in ("第一次", "第1次", "attempt 1"))
            if early_action_acceptance
            else any(marker in message for marker in ("第二", "第2", "attempt 2"))
        )
        stop_marker = (
            any(marker in message for marker in ("停止", "不再"))
            and "重试" in message
            if early_action_acceptance
            else any(marker in message for marker in ("三次", "3次", "attempt"))
        )
        if (
            str(asset_id).lower() not in message
            or "p0_ambiguous_trace" not in message
            or not exact_source_marker
            or not stop_marker
            or not any(marker in message for marker in ("放行", "接受", "允许"))
            or not any(marker in message for marker in ("一次", "本次", "仅此一次"))
            or "保留" not in message
            or "失败证据" not in message
        ):
            errors.append(f"{label} decision is not exact-source/gate specific")
        projection = {
            key: override.get(key)
            for key in (
                "contract_version", "episode_id", "scope_id", "gate_ids",
                "acknowledged_failures", "bound_artifacts", "decision",
                "consumption", "reuse_forbidden",
            )
        }
        if override.get("override_sha256") != _canonical_sha256(projection):
            errors.append(f"{label} checksum is stale")
        transition_id = consumption.get("consumed_transition_id")
        if not isinstance(transition_id, str) or _count_consumed_transition_id(
            state, transition_id,
        ) != 1:
            errors.append(f"{label} transition ID is missing or reused")
    matching_blockers = [
        blocker for blocker in state.get("blockers", [])
        if isinstance(blocker, dict)
        and blocker.get("blocker_id") == attempt_gate_id
    ]
    if early_action_acceptance:
        if matching_blockers:
            errors.append(f"{label} carries an unnecessary attempt-limit blocker")
    elif (
        len(matching_blockers) != 1
        or matching_blockers[0].get("status") != "failed_but_waived_once"
        or matching_blockers[0].get("user_mechanical_gate_override_sha256")
        != override.get("override_sha256")
    ):
        errors.append(f"{label} attempt-limit blocker is stale")
    return errors


def _validate_waived_p2_workspace_evidence(
    repo: Path,
    item: dict[str, Any],
    qa: dict[str, Any],
    state: dict[str, Any] | None,
) -> list[str]:
    asset_id = item.get("asset_id")
    label = f"White-cat asset {asset_id!r} one-time mechanical override"
    errors: list[str] = []
    identity = qa.get("identity_qa")
    white_cat_role = _white_cat_role(item)
    waivable_failures = qa.get("waivable_mechanical_failures")
    has_forward_reverse_override = any(
        isinstance(failure, dict)
        and failure.get("error_code") == P0_FORWARD_REVERSE_MISMATCH
        for failure in waivable_failures or []
    )
    front_attached = (
        isinstance(identity, dict)
        and identity.get("front_strap_attached_to_forward_bag_end") is True
    )
    rear_attached = (
        isinstance(identity, dict)
        and identity.get("rear_strap_attached_to_rear_bag_end") is True
    )
    if (
        state is None
        or item.get("visual_generation_route") != "imagegen"
        or white_cat_role not in {"base/master", "action"}
        or item.get("mechanical_qa_result") != "failed_but_waived_once"
        or item.get("user_mechanical_gate_override_result")
        != "pass_with_user_override"
        or not isinstance(identity, dict)
        or identity.get("accessory_geometry_correct") is not False
        or identity.get("satchel_count") != 1
        or identity.get("bag_end_attachment_count") != 1
        or front_attached == rear_attached
        or identity.get("himation_trim_distinct_from_bag_straps") is not True
        or identity.get("satchel_anatomical_flank") != "right"
        or identity.get("both_bag_end_anchors_visibly_traceable") is not False
        or identity.get("source_retry_policy_compliant") is not False
    ):
        return [f"{label} does not preserve the exact failed P2 result"]

    scope_id = item.get("generation_attempt_scope_id")
    episode_id = state.get("episode_id")
    attempt_control = item.get("image_generation_attempt_control")
    white_cat_control = item.get("white_cat_generation_attempt_control")
    generation_failures = item.get("image_generation_qa_failures")
    white_cat_failures = item.get("white_cat_imagegen_qa_failures")
    rejected_generation_count = (
        attempt_control.get("rejected_generation_count")
        if isinstance(attempt_control, dict) else None
    )
    early_user_acceptance = (
        rejected_generation_count in {1, 2}
        and isinstance(attempt_control, dict)
        and attempt_control.get("automatic_retry_status")
        == "stopped_by_explicit_user_acceptance"
        and isinstance(white_cat_control, dict)
        and white_cat_control.get("qa_failed_generation_count")
        == rejected_generation_count
        and white_cat_control.get("automatic_retry_status")
        == "stopped_by_explicit_user_acceptance"
    )
    expected_failure_count = rejected_generation_count if early_user_acceptance else 3
    expected_retry_status = (
        "stopped_by_explicit_user_acceptance"
        if early_user_acceptance else "stopped_user_takeover_required"
    )
    expected_latest_error_code = (
        P0_FORWARD_REVERSE_MISMATCH
        if has_forward_reverse_override else P2_SATCHEL_TOPOLOGY
    )
    if (
        not isinstance(scope_id, str)
        or not scope_id
        or not isinstance(episode_id, str)
        or not episode_id
        or not isinstance(attempt_control, dict)
        or attempt_control.get("contract_version")
        != "storyboard-image-generation-attempt-limit-v1"
        or attempt_control.get("generation_attempt_scope_id") != scope_id
        or attempt_control.get("maximum_automatic_rejected_generations") != 3
        or attempt_control.get("rejected_generation_count")
        != expected_failure_count
        or attempt_control.get("automatic_retry_status")
        != expected_retry_status
        or not isinstance(white_cat_control, dict)
        or white_cat_control.get("contract_version")
        != "white-cat-imagegen-attempt-limit-v1"
        or white_cat_control.get("maximum_automatic_qa_failures") != 3
        or white_cat_control.get("qa_failed_generation_count")
        != expected_failure_count
        or white_cat_control.get("automatic_retry_status")
        != expected_retry_status
        or not isinstance(generation_failures, list)
        or len(generation_failures) != expected_failure_count
        or not isinstance(white_cat_failures, list)
        or len(white_cat_failures) != expected_failure_count
        or [
            failure.get("attempt_number")
            for failure in generation_failures
            if isinstance(failure, dict)
        ] != list(range(1, expected_failure_count + 1))
        or [
            failure.get("attempt_number")
            for failure in white_cat_failures
            if isinstance(failure, dict)
        ] != list(range(1, expected_failure_count + 1))
        or len({
            failure.get("output", {}).get("checksum_sha256")
            for failure in generation_failures
            if isinstance(failure, dict)
        }) != expected_failure_count
        or not isinstance(white_cat_failures[-1], dict)
        or white_cat_failures[-1].get("error_code")
        != expected_latest_error_code
        or (early_user_acceptance and has_forward_reverse_override)
    ):
        return [f"{label} attempt-limit/white-cat failure history is stale"]

    inspection = identity.get("anatomy_evidence", {}).get("inspection_evidence", {})
    artifacts = [
        {"path": item.get("path"), "checksum_sha256": item.get("checksum_sha256")},
        {
            "path": item.get("prompt_path"),
            "checksum_sha256": item.get("prompt_checksum_sha256"),
        },
        {
            "path": item.get("qa_evidence_path"),
            "checksum_sha256": item.get("qa_evidence_checksum_sha256"),
        },
        {
            "path": inspection.get("numbered_limb_map_path"),
            "checksum_sha256": inspection.get(
                "numbered_limb_map_checksum_sha256"
            ),
        },
    ]
    latest_white_cat_failure = white_cat_failures[-1]
    latest_generation_failure = generation_failures[-1]
    source_binding = artifacts[0]
    prompt_binding = artifacts[1]
    if early_user_acceptance and (
        latest_white_cat_failure.get("output") != source_binding
        or latest_white_cat_failure.get("prompt") != prompt_binding
        or latest_generation_failure.get("output") != source_binding
        or latest_generation_failure.get("prompt") != prompt_binding
        or latest_generation_failure.get("failure_reason")
        != latest_white_cat_failure.get("failure_reason")
    ):
        return [f"{label} selected source is not the exact accepted failed output"]
    artifact_failures = (
        generation_failures if early_user_acceptance else [latest_white_cat_failure]
    )
    for failure in artifact_failures:
        for key in ("output", "prompt"):
            binding = failure.get(key)
            if not isinstance(binding, dict):
                errors.append(f"{label} failed-artifact binding is missing")
                continue
            normalized = {
                "path": binding.get("path"),
                "checksum_sha256": binding.get("checksum_sha256"),
            }
            if normalized not in artifacts:
                artifacts.append(normalized)
    selection_binding = item.get("user_source_selection_evidence")
    if early_user_acceptance:
        if not isinstance(selection_binding, dict):
            errors.append(f"{label} early acceptance selection evidence is missing")
        elif selection_binding not in artifacts:
            artifacts.append(selection_binding)
    prompt_file: Path | None = None
    selection_file: Path | None = None
    for index, binding in enumerate(artifacts):
        resolved_file, binding_errors = _resolve_bound_regular_file(
            repo,
            binding.get("path"),
            binding.get("checksum_sha256"),
            f"{label} artifact {index}",
        )
        errors.extend(binding_errors)
        if index == 1:
            prompt_file = resolved_file
        if early_user_acceptance and binding is selection_binding:
            selection_file = resolved_file
    if item.get("override_bound_artifacts") != artifacts:
        errors.append(f"{label} artifact list is stale")

    prompt_failures: list[dict[str, str]] = []
    if prompt_file is not None:
        try:
            prompt_text = prompt_file.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as error:
            errors.append(f"{label} prompt is not valid UTF-8: {error}")
        else:
            prompt_failures = _white_cat_prompt_fixed_marker_failures(
                item, prompt_text,
            )

            if has_forward_reverse_override:
                facing_line = next((
                    line.strip().lower()
                    for line in prompt_text.splitlines()
                    if line.startswith("CAT FACING MAP:")
                ), "")
                if (
                    "three-quarter screen-left" in facing_line
                    or "three-quarter-screen-left" in facing_line
                ):
                    expected_facing = "three-quarter-screen-left"
                    expected_front = "screen-left"
                    expected_rear = "screen-right"
                    observed_facing = "three-quarter-screen-right"
                elif (
                    "three-quarter screen-right" in facing_line
                    or "three-quarter-screen-right" in facing_line
                ):
                    expected_facing = "three-quarter-screen-right"
                    expected_front = "screen-right"
                    expected_rear = "screen-left"
                    observed_facing = "three-quarter-screen-left"
                else:
                    errors.append(
                        f"{label} forward/reverse mapping QA lacks one exact "
                        "reversible CAT FACING MAP"
                    )
                    expected_facing = expected_front = expected_rear = None
                    observed_facing = None
                mapping = identity.get("forward_reverse_mapping_qa")
                expected_mapping = {
                    "contract_version": (
                        WHITE_CAT_FORWARD_REVERSE_MAPPING_QA_CONTRACT
                    ),
                    "result": "fail",
                    "error_code": P0_FORWARD_REVERSE_MISMATCH,
                    "expected_cat_facing_screen_direction": expected_facing,
                    "expected_anatomical_front_maps_to_screen": expected_front,
                    "expected_anatomical_rear_maps_to_screen": expected_rear,
                    "observed_cat_facing_screen_direction": observed_facing,
                    "observed_anatomical_front_maps_to_screen": expected_rear,
                    "observed_anatomical_rear_maps_to_screen": expected_front,
                    "failure_reason": latest_white_cat_failure.get(
                        "failure_reason"
                    ),
                }
                expected_waivable_failures = [
                    {
                        "error_code": P0_FORWARD_REVERSE_MISMATCH,
                        "observed_result": "fail",
                        "reason": latest_white_cat_failure.get("failure_reason"),
                    },
                    {
                        "error_code": P2_SATCHEL_TOPOLOGY,
                        "observed_result": "fail",
                        "reason": latest_white_cat_failure.get("failure_reason"),
                    },
                ]
                if (
                    mapping != expected_mapping
                    or qa.get("waivable_mechanical_failures")
                    != expected_waivable_failures
                    or identity.get("cat_facing_screen_direction")
                    != observed_facing
                    or identity.get("anatomical_front_maps_to_screen")
                    != expected_rear
                    or identity.get("anatomical_rear_maps_to_screen")
                    != expected_front
                ):
                    errors.append(
                        f"{label} forward/reverse mapping QA is missing or stale"
                    )
            elif early_user_acceptance:
                visual_qa = qa.get("visual_qa")
                expected_waivable_failures = [{
                    "error_code": P2_SATCHEL_TOPOLOGY,
                    "observed_result": "fail",
                    "reason": latest_white_cat_failure.get("failure_reason"),
                }]
                if (
                    isinstance(visual_qa, dict)
                    and visual_qa.get("result") == "fail"
                    and visual_qa.get("bottom_subtitle_safe_area_result") == "fail"
                    and visual_qa.get("bottom_subtitle_safe_area_readable") is False
                ):
                    expected_waivable_failures.append({
                        "error_code": BOTTOM_SUBTITLE_SAFE_AREA,
                        "observed_result": "fail",
                        "reason": latest_white_cat_failure.get("failure_reason"),
                    })
                if (
                    identity.get("forward_reverse_mapping_qa") is not None
                    or waivable_failures != expected_waivable_failures
                ):
                    errors.append(
                        f"{label} early-acceptance failure evidence is stale"
                    )
            elif (
                identity.get("forward_reverse_mapping_qa") is not None
                or waivable_failures is not None
            ):
                errors.append(
                    f"{label} P2-only override has unexpected combined failure evidence"
                )

    attempt_gate_id = f"storyboard-image-generation-attempt-limit:{scope_id}"
    p0_gate_id = f"visual_asset.{asset_id}.P0_FORWARD_REVERSE_MISMATCH"
    p2_gate_id = f"visual_asset.{asset_id}.P2_SATCHEL_TOPOLOGY"
    subtitle_gate_id = f"visual_asset.{asset_id}.{BOTTOM_SUBTITLE_SAFE_AREA}"
    prompt_gate_ids = [failure["gate_id"] for failure in prompt_failures]
    has_subtitle_override = early_user_acceptance and any(
        isinstance(failure, dict)
        and failure.get("error_code") == BOTTOM_SUBTITLE_SAFE_AREA
        for failure in waivable_failures or []
    )
    gate_ids = (
        [
            p2_gate_id,
            *([subtitle_gate_id] if has_subtitle_override else []),
            *prompt_gate_ids,
        ]
        if early_user_acceptance
        else [
            attempt_gate_id,
            *([p0_gate_id] if has_forward_reverse_override else []),
            p2_gate_id,
            *prompt_gate_ids,
        ]
    )
    override = item.get("user_mechanical_gate_override")
    if not isinstance(override, dict):
        return errors + [f"{label} record is missing"]
    failure_by_gate = {
        failure.get("gate_id"): failure
        for failure in override.get("acknowledged_failures", [])
        if isinstance(failure, dict)
    }
    consumption = override.get("consumption")
    decision = override.get("decision")
    if early_user_acceptance:
        try:
            selection = json.loads(selection_file.read_text(encoding="utf-8"))
        except (AttributeError, OSError, UnicodeDecodeError, json.JSONDecodeError):
            selection = None
        selected_failure = latest_white_cat_failure
        if (
            not isinstance(selection, dict)
            or selection.get("contract_version")
            != "visual-asset-user-source-selection-v1"
            or selection.get("episode_id") != episode_id
            or selection.get("asset_id") != asset_id
            or selection.get("generation_attempt_scope_id") != scope_id
            or selection.get("selected_attempt_number") != expected_failure_count
            or selection.get("selected_generation_source") != source_binding
            or selection.get("selected_prompt") != prompt_binding
            or selection.get("preserved_failure", {}).get("attempt_number")
            != expected_failure_count
            or selection.get("preserved_failure", {}).get("error_code")
            != P2_SATCHEL_TOPOLOGY
            or selection.get("preserved_failure", {}).get("failure_reason")
            != selected_failure.get("failure_reason")
            or selection.get("disclosed_gate_ids") != gate_ids
            or selection.get("gate_effect", {}).get("selection_recorded") is not True
            or selection.get("gate_effect", {}).get(
                "mechanical_gate_override_consumed"
            ) is not True
            or selection.get("gate_effect", {}).get("release_decision") != decision
            or selection.get("gate_effect", {}).get("consumed_transition_id")
            != (consumption or {}).get("consumed_transition_id")
        ):
            errors.append(f"{label} early acceptance selection evidence is stale")
    prompt_acknowledgements = [
        failure
        for failure in override.get("acknowledged_failures", [])
        if isinstance(failure, dict)
        and failure.get("gate_id") in prompt_gate_ids
    ]
    if prompt_acknowledgements != prompt_failures:
        errors.append(f"{label} prompt-marker acknowledged failures are stale")
    prompt_binding = artifacts[1]
    expected_prompt_contract_qa = {
        "contract_version": WHITE_CAT_PROMPT_FIXED_MARKER_QA_CONTRACT,
        "result": "failed_but_waived_once",
        "prompt": prompt_binding,
        "failures": prompt_failures,
    }
    if prompt_failures:
        if item.get("prompt_contract_qa") != expected_prompt_contract_qa:
            errors.append(f"{label} prompt-marker QA evidence is stale")
        supplemental = (
            decision.get("supplemental_exact_user_messages")
            if isinstance(decision, dict) else None
        )
        if (
            not isinstance(supplemental, list)
            or len(supplemental) != 1
            or not isinstance(supplemental[0], dict)
            or supplemental[0].get("gate_ids") != prompt_gate_ids
            or supplemental[0].get("disposition") != "allow_once"
            or not isinstance(supplemental[0].get("decided_at"), str)
            or not supplemental[0]["decided_at"].strip()
            or not _is_exact_prompt_marker_release_message(
                supplemental[0].get("exact_user_message"),
                asset_id=asset_id,
                hero_pose=item.get("asset_kind") == "hero_pose",
            )
        ):
            errors.append(f"{label} supplemental prompt-marker release is stale")
    else:
        if item.get("prompt_contract_qa") is not None:
            errors.append(f"{label} has unexpected prompt-marker QA evidence")
        if (
            isinstance(decision, dict)
            and decision.get("supplemental_exact_user_messages") not in (None, [])
        ):
            errors.append(f"{label} has an unexpected supplemental release")
    if (
        override.get("contract_version")
        != "one-time-explicit-user-mechanical-gate-override-v1"
        or override.get("episode_id") != episode_id
        or override.get("scope_id") != scope_id
        or override.get("gate_ids") != gate_ids
        or item.get("waived_mechanical_gate_ids") != gate_ids
        or override.get("bound_artifacts") != artifacts
        or (
            not early_user_acceptance
            and failure_by_gate.get(attempt_gate_id, {}).get("observed_result")
            != "stopped_user_takeover_required"
        )
        or (
            has_forward_reverse_override
            and failure_by_gate.get(p0_gate_id, {}).get("reason")
            != latest_white_cat_failure.get("failure_reason")
        )
        or failure_by_gate.get(p2_gate_id, {}).get("reason")
        != latest_white_cat_failure.get("failure_reason")
        or (
            has_subtitle_override
            and failure_by_gate.get(subtitle_gate_id, {}).get("reason")
            != latest_white_cat_failure.get("failure_reason")
        )
        or not isinstance(decision, dict)
        or decision.get("disposition") != "allow_once"
        or not isinstance(decision.get("exact_user_message"), str)
        or not decision["exact_user_message"].strip()
        or not isinstance(consumption, dict)
        or consumption.get("from_phase") != (
            "visual_production"
            if early_user_acceptance else "awaiting_visual_asset_review"
        )
        or consumption.get("to_phase") != "visual_production"
        or consumption.get("status") != "consumed"
        or not isinstance(consumption.get("consumed_transition_id"), str)
        or not consumption["consumed_transition_id"].strip()
        or override.get("reuse_forbidden") is not True
    ):
        errors.append(f"{label} contract or transition is stale")
    else:
        message = decision["exact_user_message"].lower()
        if (
            str(asset_id).lower() not in message
            or not any(marker in message for marker in ("p2", "背带", "挎包"))
            or (
                has_forward_reverse_override
                and not any(marker in message for marker in ("p0", "朝向", "前后"))
            )
            or not (
                (
                    any(marker in message for marker in ("停止", "不再"))
                    and "重试" in message
                    and any(
                        marker in message
                        for marker in (
                            "第一次" if expected_failure_count == 1 else "第二次",
                            f"第{expected_failure_count}次",
                            f"attempt {expected_failure_count}",
                        )
                    )
                )
                if early_user_acceptance
                else any(
                    marker in message
                    for marker in ("三次", "3次", "重试", "attempt")
                )
            )
            or not any(marker in message for marker in ("放行", "接受", "允许"))
            or (
                early_user_acceptance
                and not any(marker in message for marker in ("一次", "本次", "仅此一次"))
            )
            or (early_user_acceptance and "保留" not in message)
            or (early_user_acceptance and "失败证据" not in message)
            or (
                has_subtitle_override
                and not any(marker in message for marker in ("字幕", "底部18%"))
            )
        ):
            errors.append(
                f"{label} decision is not asset/P0/P2/attempt-limit specific"
            )
        projection = {
            key: override.get(key)
            for key in (
                "contract_version", "episode_id", "scope_id", "gate_ids",
                "acknowledged_failures", "bound_artifacts", "decision",
                "consumption", "reuse_forbidden",
            )
        }
        expected_override_sha = _canonical_sha256(projection)
        if override.get("override_sha256") != expected_override_sha:
            errors.append(f"{label} checksum is stale")
        if _count_consumed_transition_id(
            state, consumption["consumed_transition_id"]
        ) != 1:
            errors.append(f"{label} transition ID is missing or reused")

    matching_blockers = [
        blocker
        for blocker in state.get("blockers", [])
        if isinstance(blocker, dict)
        and blocker.get("blocker_id") == attempt_gate_id
    ]
    if early_user_acceptance and matching_blockers:
        errors.append(f"{label} early acceptance has an attempt-limit blocker")
    if not early_user_acceptance and (
        len(matching_blockers) != 1
        or matching_blockers[0].get("contract_version")
        != "storyboard-image-generation-attempt-limit-v1"
        or matching_blockers[0].get("asset_id") != asset_id
        or matching_blockers[0].get("generation_attempt_scope_id") != scope_id
        or matching_blockers[0].get("status") != "failed_but_waived_once"
        or matching_blockers[0].get("user_mechanical_gate_override_sha256")
        != override.get("override_sha256")
    ):
        errors.append(f"{label} attempt-limit blocker is stale")
    return errors


def _validate_pending_white_cat_qa(
    repo: Path,
    item: dict[str, Any],
    state: dict[str, Any] | None = None,
) -> list[str]:
    asset_id = item.get("asset_id")
    label = f"White-cat asset {asset_id!r} QA evidence"
    qa_file, errors = _resolve_bound_regular_file(
        repo,
        item.get("qa_evidence_path"),
        item.get("qa_evidence_checksum_sha256"),
        label,
    )
    if errors or qa_file is None:
        return errors
    try:
        qa = json.loads(qa_file.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        return [f"{label} is not valid UTF-8 JSON: {error}"]
    if not isinstance(qa, dict):
        return [f"{label} must contain a JSON object"]

    role = _white_cat_role(item)
    route = item.get("visual_generation_route")
    if role is None:
        return [f"White-cat asset {asset_id!r} has an unsupported image role"]
    contracts = (
        WHITE_CAT_IMAGEGEN_QA_CONTRACTS
        if route == "imagegen"
        else WHITE_CAT_XUAN_QA_CONTRACTS
    )
    expected_contract = contracts[role]
    if qa.get("contract_version") != expected_contract:
        errors.append(
            f"White-cat asset {asset_id!r} QA contract must be {expected_contract}"
        )
    if item.get("qa_contract_version") != expected_contract:
        errors.append(
            f"White-cat asset {asset_id!r} state QA contract must be {expected_contract}"
        )
    waived = item.get("status") == WAIVED_PENDING_FINAL_REVIEW_STATUS or (
        item.get("status") == "approved"
        and item.get("mechanical_qa_result") == "failed_but_waived_once"
    )
    if qa.get("result") != ("fail" if waived else "pass"):
        errors.append(
            f"White-cat asset {asset_id!r} top-level QA disposition is invalid"
        )
    if qa.get("asset_id") != asset_id:
        errors.append(f"White-cat asset {asset_id!r} QA asset_id is stale")

    identity = qa.get("identity_qa")
    visible_symbol_override = waived and _is_visible_symbol_override(item)
    ambiguous_trace_override = waived and _is_ambiguous_trace_override(item)
    if not isinstance(identity, dict) or identity.get("result") != (
        "pass" if visible_symbol_override or not waived else "fail"
    ):
        errors.append(f"White-cat asset {asset_id!r} identity_qa disposition is invalid")
        return errors
    anatomy = identity.get("anatomy_evidence")
    if not isinstance(anatomy, dict):
        errors.append(f"White-cat asset {asset_id!r} anatomy evidence is missing")
        return errors
    if anatomy.get("contract_version") != WHITE_CAT_ANATOMY_QA_CONTRACT:
        errors.append(
            f"White-cat asset {asset_id!r} anatomy contract must be "
            f"{WHITE_CAT_ANATOMY_QA_CONTRACT}"
        )
    if anatomy.get("result") != (
        "fail" if ambiguous_trace_override else "pass"
    ):
        errors.append(
            f"White-cat asset {asset_id!r} anatomy QA disposition is invalid"
        )
    expected_source = {
        "path": item.get("path"),
        "checksum_sha256": item.get("checksum_sha256"),
    }
    if anatomy.get("source_image") != expected_source:
        errors.append(
            f"White-cat asset {asset_id!r} anatomy source binding is stale"
        )
    inspection = anatomy.get("inspection_evidence")
    if not isinstance(inspection, dict):
        errors.append(
            f"White-cat asset {asset_id!r} numbered limb map evidence is missing"
        )
        return errors
    if inspection.get("methods") != ["full_resolution", "numbered_limb_map"]:
        errors.append(
            f"White-cat asset {asset_id!r} numbered limb map methods are invalid"
        )
    _, map_errors = _resolve_bound_regular_file(
        repo,
        inspection.get("numbered_limb_map_path"),
        inspection.get("numbered_limb_map_checksum_sha256"),
        f"White-cat asset {asset_id!r} numbered limb map",
    )
    errors.extend(map_errors)
    if inspection.get("numbered_limb_map_source_checksum_sha256") != expected_source[
        "checksum_sha256"
    ]:
        errors.append(
            f"White-cat asset {asset_id!r} numbered limb map source binding is stale"
        )
    if inspection.get("numbered_limb_map_limb_ids") != ["F1", "F2", "H1", "H2"]:
        errors.append(
            f"White-cat asset {asset_id!r} numbered limb map limb IDs are invalid"
        )
    if waived:
        errors.extend(
            _validate_waived_visible_symbol_workspace_evidence(
                repo, item, qa, state,
            )
            if visible_symbol_override
            else (
                _validate_waived_ambiguous_trace_workspace_evidence(
                    repo, item, qa, state,
                )
                if ambiguous_trace_override
                else _validate_waived_p2_workspace_evidence(
                    repo, item, qa, state,
                )
            )
        )
    return errors


def _validate_approved_white_cat_history(
    repo: Path,
    item: dict[str, Any],
    state: dict[str, Any] | None = None,
) -> list[str]:
    asset_id = item.get("asset_id")
    checksum = item.get("checksum_sha256")
    errors: list[str] = []
    if (
        not isinstance(checksum, str)
        or not SHA256_RE.fullmatch(checksum)
        or item.get("approved_checksum_sha256") != checksum
        or item.get("presented_checksum_sha256") != checksum
    ):
        errors.append(f"Approved historical white-cat asset {asset_id!r} checksum evidence is invalid")
    if not isinstance(item.get("decision_message"), str) or not item["decision_message"].strip():
        errors.append(f"Approved historical white-cat asset {asset_id!r} decision message is missing")
    if not isinstance(item.get("decision_time"), str) or not item["decision_time"].strip():
        errors.append(f"Approved historical white-cat asset {asset_id!r} decision time is missing")
    _, source_errors = _resolve_bound_regular_file(
        repo,
        item.get("path"),
        checksum,
        f"Approved historical white-cat asset {asset_id!r}",
    )
    errors.extend(source_errors)

    qa_file, qa_errors = _resolve_bound_regular_file(
        repo,
        item.get("qa_evidence_path"),
        item.get("qa_evidence_checksum_sha256"),
        f"Approved historical white-cat asset {asset_id!r} QA evidence",
    )
    errors.extend(qa_errors)
    if qa_file is None:
        return errors
    try:
        qa = json.loads(qa_file.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        errors.append(
            f"Approved historical white-cat asset {asset_id!r} QA is not valid UTF-8 JSON: {error}"
        )
        return errors
    if not isinstance(qa, dict):
        errors.append(f"Approved historical white-cat asset {asset_id!r} QA must be a JSON object")
        return errors

    role = _white_cat_role(item)
    route = item.get("visual_generation_route")
    if role is None:
        errors.append(f"Approved historical white-cat asset {asset_id!r} has an unsupported role")
        return errors
    if route == "imagegen":
        suffix = "master" if role == "base/master" else "action"
        allowed_contracts = {
            f"ordinary-imagegen-white-cat-{suffix}-qa-v1",
            f"ordinary-imagegen-white-cat-{suffix}-qa-v2",
        }
    else:
        allowed_contracts = {WHITE_CAT_XUAN_QA_CONTRACTS[role]}
    contract = qa.get("contract_version")
    if contract not in allowed_contracts:
        errors.append(f"Approved historical white-cat asset {asset_id!r} QA contract is invalid")
    waived = item.get("mechanical_qa_result") == "failed_but_waived_once"
    if qa.get("result") != ("fail" if waived else "pass") \
            or qa.get("asset_id") != asset_id:
        errors.append(f"Approved historical white-cat asset {asset_id!r} QA identity is stale")
    recorded_contract = item.get("qa_contract_version")
    if recorded_contract is not None and recorded_contract != contract:
        errors.append(f"Approved historical white-cat asset {asset_id!r} state QA contract is stale")
    if contract in {
        "ordinary-imagegen-white-cat-master-qa-v2",
        "ordinary-imagegen-white-cat-action-qa-v2",
    } or (route == "xuan-paper-diorama" and recorded_contract is not None):
        errors.extend(_validate_pending_white_cat_qa(repo, item, state))
    return errors


def _validate_white_cat_pending_qa(
    repo: Path,
    workspace: Path,
) -> list[str]:
    state_file = workspace / "schema" / "episode-state.json"
    if not state_file.exists():
        return []
    if state_file.is_symlink() or not state_file.is_file():
        return [
            "Episode state must be a regular non-symlink file: "
            f"{state_file.relative_to(repo)}"
        ]
    try:
        state = json.loads(state_file.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        return [f"Episode state is not valid UTF-8 JSON: {error}"]
    if not isinstance(state, dict):
        return ["Episode state must contain a JSON object"]

    review = state.get("visual_asset_review")
    if review is None:
        return []
    if not isinstance(review, dict):
        return ["Episode visual_asset_review must be a JSON object"]
    if "queue" not in review:
        return []
    queue = review["queue"]
    if not isinstance(queue, list):
        return ["Episode visual_asset_review.queue must be a JSON array"]

    errors: list[str] = []
    for index, item in enumerate(queue):
        if not isinstance(item, dict):
            errors.append(f"Episode visual_asset_review.queue[{index}] must be a JSON object")
            continue
        if (
            item.get("active_for_current_storyboard") is False
            or item.get("status") == "superseded"
            or item.get("white_cat_present") is not True
            or item.get("visual_generation_route") not in {"imagegen", "xuan-paper-diorama"}
        ):
            continue
        if item.get("status") in WHITE_CAT_PENDING_QA_STATUSES:
            errors.extend(_validate_pending_white_cat_qa(repo, item, state))
        elif item.get("status") == "approved":
            errors.extend(_validate_approved_white_cat_history(repo, item, state))
    return errors


def _canonical_sha256(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()


def _generation_failure_projection(value: dict[str, Any]) -> dict[str, Any]:
    return {
        "attempt_number": value.get("attempt_number"),
        "prompt": value.get("prompt"),
        "output": value.get("output"),
        "failure_reason": value.get("failure_reason"),
    }


def _validate_ian_layout_repair_source_selection(
    repo: Path,
    state: dict[str, Any],
    item: dict[str, Any],
    manifest: dict[str, Any],
) -> list[str]:
    asset_id = item.get("asset_id")
    label = f"Active Ian asset {asset_id!r} stopped layout-repair source"
    repair = manifest.get("split_spec", {}).get("layout_repair")
    selection = item.get("ian_layout_repair_source_selection")
    if not isinstance(repair, dict):
        return [f"{label} selection evidence is stale"] if selection is not None else []

    control = item.get("image_generation_attempt_control")
    if not isinstance(control, dict) or control.get("rejected_generation_count") != 3:
        return [f"{label} selection evidence is stale"] if selection is not None else []

    errors: list[str] = []
    failures = item.get("image_generation_qa_failures")
    if (
        control.get("contract_version")
        != "storyboard-image-generation-attempt-limit-v1"
        or control.get("generation_attempt_scope_id")
        != item.get("generation_attempt_scope_id")
        or control.get("maximum_automatic_rejected_generations") != 3
        or not isinstance(failures, list)
        or len(failures) != 3
        or any(not isinstance(failure, dict) for failure in failures)
    ):
        return [f"{label} three-failure history is stale"]
    projections = [_generation_failure_projection(failure) for failure in failures]
    if [failure.get("attempt_number") for failure in projections] != [1, 2, 3]:
        errors.append(f"{label} three-failure ordering is stale")
    rejected_attempts = [failure.get("output") for failure in projections]
    if item.get("rejected_attempts") != rejected_attempts:
        errors.append(f"{label} rejected-attempt projection is stale")
    source_failure = repair.get("source_failure")
    default_source = projections[-1]
    if source_failure == default_source:
        if selection is not None:
            errors.append(f"{label} carries an unnecessary override")
        return errors
    if source_failure not in projections[:-1]:
        return errors + [f"{label} is not a preserved earlier failure"]
    if not isinstance(selection, dict):
        return errors + [f"{label} lacks a consumed exact override"]

    override = selection.get("user_mechanical_gate_override")
    generation_scope = item.get("generation_attempt_scope_id")
    gate_id = (
        f"visual_asset.{asset_id}."
        "IAN_STOPPED_LAYOUT_REPAIR_SOURCE_MUST_BE_THIRD_REJECTED_GENERATION"
    )
    artifacts = [
        {
            "path": failure[binding].get("path"),
            "checksum_sha256": failure[binding].get("checksum_sha256"),
        }
        for failure in projections
        for binding in ("prompt", "output")
        if isinstance(failure.get(binding), dict)
    ]
    if len(artifacts) != 6:
        errors.append(f"{label} bound failure artifacts are incomplete")
    for index, artifact in enumerate(artifacts):
        _, artifact_errors = _resolve_bound_regular_file(
            repo,
            artifact.get("path"),
            artifact.get("checksum_sha256"),
            f"{label} artifact {index}",
        )
        errors.extend(artifact_errors)

    expected_reason = (
        "Selected Ian stopped-takeover layout-repair source is preserved "
        f"attempt {source_failure.get('attempt_number')}; the default contract "
        f"requires preserved attempt {default_source.get('attempt_number')}."
    )
    expected_failure = {
        "gate_id": gate_id,
        "observed_result": "fail",
        "reason": expected_reason,
    }
    if not isinstance(override, dict):
        return errors + [f"{label} override record is missing"]
    decision = override.get("decision")
    consumption = override.get("consumption")
    expected_scope = f"{generation_scope}:ian-layout-repair-source-selection"
    if (
        selection.get("contract_version")
        != "ian-stopped-layout-repair-source-selection-v1"
        or selection.get("result") != "pass_with_user_override"
        or selection.get("selected_source_failure") != source_failure
        or selection.get("default_required_source_failure") != default_source
        or override.get("contract_version")
        != "one-time-explicit-user-mechanical-gate-override-v1"
        or override.get("episode_id") != state.get("episode_id")
        or override.get("scope_id") != expected_scope
        or override.get("gate_ids") != [gate_id]
        or override.get("acknowledged_failures") != [expected_failure]
        or override.get("bound_artifacts") != artifacts
        or not isinstance(decision, dict)
        or decision.get("disposition") != "allow_once"
        or decision.get("exact_user_message")
        != repair.get("authorization", {}).get("exact_user_message")
        or not isinstance(decision.get("decided_at"), str)
        or not decision["decided_at"].strip()
        or not isinstance(consumption, dict)
        or consumption.get("from_phase") != "awaiting_visual_asset_review"
        or consumption.get("to_phase") != "visual_production"
        or consumption.get("status") != "consumed"
        or not isinstance(consumption.get("consumed_at"), str)
        or not consumption["consumed_at"].strip()
        or override.get("reuse_forbidden") is not True
    ):
        errors.append(f"{label} override contract or transition is stale")
    else:
        message = decision["exact_user_message"].lower()
        if (
            str(asset_id).lower() not in message
            or not any(marker in message for marker in ("第二", "第2", "attempt 2"))
            or not any(marker in message for marker in ("第三", "第3", "attempt 3"))
            or "布局修复源" not in message
            or not any(marker in message for marker in ("放行", "接受", "允许"))
            or not any(marker in message for marker in ("一次", "本次", "仅此一次"))
            or "保留" not in message
            or "失败证据" not in message
        ):
            errors.append(f"{label} decision is not exact-source/gate specific")
        projection = {
            key: override.get(key)
            for key in (
                "contract_version", "episode_id", "scope_id", "gate_ids",
                "acknowledged_failures", "bound_artifacts", "decision",
                "consumption", "reuse_forbidden",
            )
        }
        if override.get("override_sha256") != _canonical_sha256(projection):
            errors.append(f"{label} override checksum is stale")
        transition_id = consumption.get("consumed_transition_id")
        if (
            not isinstance(transition_id, str)
            or not transition_id.strip()
            or _count_consumed_transition_id(state, transition_id) != 1
        ):
            errors.append(f"{label} transition ID is missing or reused")

    takeover = item.get("user_takeover_disposition")
    if (
        not isinstance(takeover, dict)
        or takeover.get("contract_version")
        != "ian-pre-split-layout-repair-takeover-v1"
        or takeover.get("source_failure") != source_failure
        or takeover.get("source_selection_result") != "pass_with_user_override"
        or takeover.get("source_selection_override_sha256")
        != override.get("override_sha256")
    ):
        errors.append(f"{label} takeover disposition is stale")
    return errors



STATIC_SPREAD_VALIDATOR_PATH = (
    Path(__file__).resolve().parents[4]
    / "leverage-video/src/shared/visual-assets/static-spread-contract.mjs"
)


def _is_static_spread(value: Any) -> bool:
    return isinstance(value, dict) and value.get("presentation_mode") == "illustrated-flipbook"


def _validate_static_spread_queue_item(repo: Path, state: dict, item: dict) -> list[str]:
    required_statuses = IAN_LAYERED_PACKAGE_REQUIRED_STATUSES | {WAIVED_PENDING_FINAL_REVIEW_STATUS}
    operation = "asset" if item.get("status") in required_statuses else "authority"
    result = subprocess.run(
        ["node", str(STATIC_SPREAD_VALIDATOR_PATH)],
        input=json.dumps({"repositoryRoot": str(repo), "state": state, "item": item,
                          "operation": operation}, ensure_ascii=False),
        text=True, capture_output=True, check=False,
    )
    label = f"Active static spread {item.get('asset_id')!r}"
    if result.returncode:
        return [f"{label}: {result.stderr.strip() or 'static validation failed'}"]
    if operation == "asset":
        evidence = json.loads(result.stdout)
        if item.get("static_spread_review") != evidence:
            return [f"{label} current review evidence is stale"]
        if item.get("status") == "approved" and item.get("approved_static_spread_review") != evidence:
            return [f"{label} approved review evidence is stale"]
    return []

def _validate_active_ian_layered_scene_queue(
    repo: Path,
    workspace: Path,
) -> list[str]:
    state_file = workspace / "schema" / "episode-state.json"
    if not state_file.exists() or state_file.is_symlink() or not state_file.is_file():
        return []
    try:
        state = json.loads(state_file.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return []
    if not isinstance(state, dict) or state.get("current_phase") == "delivered":
        return []
    queue = state.get("visual_asset_review", {}).get("queue", [])
    if not isinstance(queue, list):
        return []

    errors: list[str] = []
    for index, item in enumerate(queue):
        if not isinstance(item, dict):
            continue
        if (
            item.get("active_for_current_storyboard") is False
            or item.get("status") == "superseded"
        ):
            continue
        if _is_static_spread(item) or state.get("white_cat_visual_style_selection", {}).get("style_id") == "illustrated-flipbook":
            errors.extend(_validate_static_spread_queue_item(repo, state, item))
            continue
        if item.get("visual_generation_route") != "ian-handdrawn-ppt":
            continue
        label = f"Active Ian asset {item.get('asset_id')!r}"
        plan = item.get("ian_scene_plan")
        if (
            not isinstance(plan, dict)
            or plan.get("contract_version") != "ian-layered-scene-plan-v1"
            or plan.get("shot_id") != item.get("shot_id")
            or plan.get("scene_renderer") != "ian-static-layered-scene-v1"
            or plan.get("layer_asset_policy") != "full-canvas-transparent-png-v1"
            or not isinstance(plan.get("layers"), list)
            or not plan["layers"]
            or plan.get("layer_count") != len(plan["layers"])
            or item.get("ian_scene_plan_sha256") != _canonical_sha256(plan)
        ):
            errors.append(
                f"{label} must migrate from a flattened raster to a checksum-bound "
                "ian-layered-scene-plan-v1"
            )
            continue
        motion = plan.get("motion_policy")
        if motion != {
            "scene_transform": "forbidden",
            "layer_transform": "forbidden",
            "mask_reveal": "forbidden",
            "internal_cut": "forbidden",
            "opacity_animation": "ian-layer-entry-fade-v1",
        }:
            errors.append(f"{label} layered plan permits retired motion or masking")
        if item.get("status") not in IAN_LAYERED_PACKAGE_REQUIRED_STATUSES:
            continue
        manifest_file, manifest_errors = _resolve_bound_regular_file(
            repo,
            item.get("scene_package_manifest_path"),
            item.get("scene_package_manifest_checksum_sha256"),
            f"{label} layered-scene manifest",
        )
        errors.extend(manifest_errors)
        members = item.get("ian_scene_package_members")
        lineage = item.get("generation_lineage")
        layer_count = len(plan["layers"])
        expected_roles = ["source-master", "normalized-master", "background"] \
            + ["pre-text-layer"] * layer_count \
            + ["semantic-layer"] * layer_count \
            + ["final-composite"]
        source_member = (
            members[0]
            if isinstance(members, list) and members and isinstance(members[0], dict)
            else {}
        )
        if (
            item.get("qa_contract_version") != "ian-layered-scene-qa-v2"
            or not isinstance(members, list)
            or len(members) != 4 + (2 * layer_count)
            or any(not isinstance(member, dict) for member in members)
            or [member.get("member_role") for member in members]
            != expected_roles
            or not isinstance(lineage, list)
            or len(lineage) != 1
            or not isinstance(lineage[0], dict)
            or set(lineage[0]) != {
                "stage", "generation_mode", "model_id", "prompt",
                "reference_inputs", "output", "selection_status",
            }
            or lineage[0].get("stage") != "complete-master-generation"
            or lineage[0].get("generation_mode")
            != "codex-native-imagegen-gpt-image-2-text-free-master-v1"
            or lineage[0].get("model_id") != "gpt-image-2"
            or lineage[0].get("selection_status") != "selected"
            or lineage[0].get("reference_inputs") != item.get("actual_reference_inputs")
            or lineage[0].get("output") != {
                "path": source_member.get("path"),
                "checksum_sha256": source_member.get("checksum_sha256"),
            }
        ):
            errors.append(f"{label} layered package QA/member projection is incomplete")
        if manifest_file is None:
            continue
        try:
            manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            errors.append(f"{label} layered-scene manifest is not valid UTF-8 JSON")
            continue
        if (
            not isinstance(manifest, dict)
            or manifest.get("contract_version")
            != "ian-knowledge-video-layered-scene-v2"
            or manifest.get("queue_item_id") != item.get("asset_id")
            or manifest.get("scene_plan") != plan
            or manifest.get("scene_plan_sha256") != item.get("ian_scene_plan_sha256")
        ):
            errors.append(f"{label} layered-scene manifest is stale")
            continue
        master_generation_value = manifest.get("master_generation")
        model_provenance_value = manifest.get("model_provenance")
        master_generation = (
            master_generation_value if isinstance(master_generation_value, dict) else {}
        )
        model_provenance = (
            model_provenance_value if isinstance(model_provenance_value, dict) else {}
        )
        if (
            not isinstance(master_generation_value, dict)
            or master_generation.get("contract_version")
            != "ian-gpt-image-2-text-free-master-v1"
            or master_generation.get("generator") != "codex-native-imagegen"
            or master_generation.get("model_id") != "gpt-image-2"
            or master_generation.get("source_master", {}).get("path")
            != source_member.get("path")
            or master_generation.get("source_master", {}).get("checksum_sha256")
            != source_member.get("checksum_sha256")
            or not isinstance(model_provenance_value, dict)
            or model_provenance.get("contract_version")
            != "codex-native-imagegen-gpt-image-2-provenance-v1"
            or model_provenance.get("canonical_model") != "gpt-image-2"
            or model_provenance.get("evidence_kind")
            != "embedded-c2pa-software-agent-observation-v1"
            or model_provenance.get("source_master_checksum_sha256")
            != source_member.get("checksum_sha256")
            or model_provenance.get("expected_software_agent")
            != {"name": "gpt-image", "version": "2.0"}
        ):
            errors.append(f"{label} source-master/model provenance is stale")
        errors.extend(
            _validate_ian_layout_repair_source_selection(
                repo,
                state,
                item,
                manifest,
            )
        )
        normalized_master = manifest.get("normalized_master")
        background = manifest.get("background")
        final_composite = manifest.get("final_composite")
        pre_text_layers = manifest.get("pre_text_layers")
        layers = manifest.get("layers")
        manifest_members = [
            {
                "member_role": "source-master",
                "layer_id": "source-master",
                **master_generation.get("source_master", {}),
            },
            {
                "member_role": "normalized-master",
                "layer_id": "normalized-master",
                **(normalized_master if isinstance(normalized_master, dict) else {}),
            },
            {
                "member_role": "background",
                "layer_id": "background",
                **(background if isinstance(background, dict) else {}),
            },
            *[
                {"member_role": "pre-text-layer", **layer}
                for layer in (pre_text_layers if isinstance(pre_text_layers, list) else [])
                if isinstance(layer, dict)
            ],
            *[
                {"member_role": "semantic-layer", **layer}
                for layer in (layers if isinstance(layers, list) else [])
                if isinstance(layer, dict)
            ],
            {
                "member_role": "final-composite",
                "layer_id": "final-composite",
                **(final_composite if isinstance(final_composite, dict) else {}),
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
        if projected_manifest_members != members:
            errors.append(f"{label} layered package member projection is stale")
        for member_index, member in enumerate(members):
            if not isinstance(member, dict):
                continue
            _, member_errors = _resolve_bound_regular_file(
                repo,
                member.get("path"),
                member.get("checksum_sha256"),
                f"{label} package member {member_index}",
            )
            errors.extend(member_errors)
    return errors


def _validate_failed_master_edit_source_overrides(
    repo: Path,
    workspace: Path,
) -> list[str]:
    state_file = workspace / "schema" / "episode-state.json"
    if not state_file.exists() or state_file.is_symlink() or not state_file.is_file():
        return []
    try:
        state = json.loads(state_file.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return []
    queue = state.get("visual_asset_review", {}).get("queue", [])
    if not isinstance(queue, list):
        return []

    errors: list[str] = []
    by_id = {
        item.get("asset_id"): item
        for item in queue
        if isinstance(item, dict) and isinstance(item.get("asset_id"), str)
    }
    for master in by_id.values():
        status = master.get("status")
        record = master.get("failed_master_edit_source_override")
        if status not in {WAIVED_PENDING_FINAL_REVIEW_STATUS, "approved"}:
            if record is not None:
                errors.append(
                    f"Asset {master.get('asset_id')!r} carries an unnecessary failed-source override"
                )
            continue
        if status == "approved" and record is None:
            continue
        master_id = master.get("asset_id")
        shot_id = master.get("shot_id")
        p0_gate_id = f"visual_asset.{master_id}.{P0_AMBIGUOUS_TRACE}"
        if p0_gate_id not in master.get("waived_mechanical_gate_ids", []):
            if record is not None:
                errors.append(
                    f"Non-P0 master {master_id!r} carries an unnecessary failed-source override"
                )
            continue
        action_ids = [
            item.get("asset_id")
            for item in queue
            if isinstance(item, dict)
            and item.get("shot_id") == shot_id
            and item.get("depends_on") == [master_id]
            and item.get("active_for_current_storyboard") is not False
            and item.get("status") != "superseded"
            and isinstance(item.get("state_index"), int)
            and isinstance(item.get("state_count_total"), int)
            and 1 <= item["state_index"] < item["state_count_total"]
            and item.get("role") == f"action-{item['state_index']:02d}"
        ]
        if not action_ids:
            continue
        release_needed = any(
            by_id[action_id].get("status") in {
                "pending_generation",
                "changes_requested",
                "awaiting_batch_qa",
                "awaiting_user_approval",
            }
            for action_id in action_ids
        ) and state.get("visual_asset_review", {}).get("queue_generation_allowed") is True
        if not isinstance(record, dict):
            if release_needed:
                errors.append(
                    f"P0-failed master {master_id!r} lacks an exact action-family edit-source override"
                )
            continue

        label = f"P0-failed master {master_id!r} action-family edit-source override"
        qa_path = master.get("qa_evidence_path")
        qa_checksum = master.get("qa_evidence_checksum_sha256")
        qa_file, qa_errors = _resolve_bound_regular_file(
            repo,
            qa_path,
            qa_checksum,
            f"{label} QA evidence",
        )
        errors.extend(qa_errors)
        if qa_file is None:
            continue
        try:
            qa = json.loads(qa_file.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            errors.append(f"{label} QA evidence is invalid")
            continue
        anatomy = qa.get("identity_qa", {}).get("anatomy_evidence", {})
        inspection = anatomy.get("inspection_evidence", {})
        artifacts = [
            {
                "path": master.get("path"),
                "checksum_sha256": master.get("checksum_sha256"),
            },
            {"path": qa_path, "checksum_sha256": qa_checksum},
            {
                "path": inspection.get("numbered_limb_map_path"),
                "checksum_sha256": inspection.get(
                    "numbered_limb_map_checksum_sha256"
                ),
            },
        ]
        for index, artifact in enumerate(artifacts):
            _, artifact_errors = _resolve_bound_regular_file(
                repo,
                artifact.get("path"),
                artifact.get("checksum_sha256"),
                f"{label} artifact {index}",
            )
            errors.extend(artifact_errors)

        gate_id = f"visual_asset.{master_id}.{FAILED_P0_MASTER_EDIT_SOURCE_GATE}"
        reason = (
            f"P0-failed {master_id} source carries {P0_AMBIGUOUS_TRACE}; "
            "the default contract forbids using it as a downstream edit target."
        )
        expected_failure = {
            "gate_id": gate_id,
            "observed_result": "fail",
            "reason": reason,
        }
        override = record.get("user_mechanical_gate_override")
        decision = override.get("decision", {}) if isinstance(override, dict) else {}
        consumption = (
            override.get("consumption", {}) if isinstance(override, dict) else {}
        )
        if (
            record.get("contract_version")
            != FAILED_MASTER_EDIT_SOURCE_OVERRIDE_VERSION
            or record.get("result") != "pass_with_user_override"
            or record.get("master_asset_id") != master_id
            or record.get("shot_id") != shot_id
            or record.get("allowed_action_asset_ids") != action_ids
            or record.get("source") != artifacts[0]
            or record.get("original_failure") != {
                "qa_evidence": artifacts[1],
                "error_code": P0_AMBIGUOUS_TRACE,
                "result": "fail",
                "failed_master_must_not_be_used_as_an_edit_target": True,
            }
            or not isinstance(override, dict)
            or override.get("contract_version")
            != "one-time-explicit-user-mechanical-gate-override-v1"
            or override.get("episode_id") != state.get("episode_id")
            or override.get("scope_id") != f"{shot_id}:action-family-edit-source"
            or override.get("gate_ids") != [gate_id]
            or override.get("acknowledged_failures") != [expected_failure]
            or override.get("bound_artifacts") != artifacts
            or decision.get("disposition") != "allow_once"
            or not isinstance(decision.get("decided_at"), str)
            or consumption.get("from_phase") != "visual_production"
            or consumption.get("to_phase") != "visual_production"
            or consumption.get("status") != "consumed"
            or override.get("reuse_forbidden") is not True
            or anatomy.get("result") != "fail"
            or anatomy.get("error_code") != P0_AMBIGUOUS_TRACE
            or qa.get("continuity_qa", {}).get(
                "failed_master_must_not_be_used_as_an_edit_target"
            )
            is not True
        ):
            errors.append(f"{label} contract or failure binding is stale")
            continue
        message = decision.get("exact_user_message", "").lower()
        if (
            str(master_id).lower() not in message
            or str(shot_id).lower() not in message
            or "动作族" not in message
            or "唯一编辑基底" not in message
            or "p0 失败图不得作为后续编辑源" not in message
            or P0_AMBIGUOUS_TRACE.lower() not in message
            or "不扩展至其他资产" not in message
            or not any(marker in message for marker in ("一次", "本次", "仅此一次"))
            or not any(marker in message for marker in ("放行", "接受", "允许"))
        ):
            errors.append(f"{label} decision is not exact and scoped")
        projection = {
            key: override.get(key)
            for key in (
                "contract_version", "episode_id", "scope_id", "gate_ids",
                "acknowledged_failures", "bound_artifacts", "decision",
                "consumption", "reuse_forbidden",
            )
        }
        transition_id = consumption.get("consumed_transition_id")
        if (
            override.get("override_sha256") != _canonical_sha256(projection)
            or not isinstance(transition_id, str)
            or not transition_id.strip()
            or _count_consumed_transition_id(state, transition_id) != 1
        ):
            errors.append(f"{label} checksum or transition consumption is stale")
    return errors


def _validate_concise_visible_text(value: Any, label: str) -> list[str]:
    if not isinstance(value, str) or not value.strip():
        return [f"{label} concise visible text must be non-empty"]
    errors: list[str] = []
    if value != value.strip() or "\r" in value:
        errors.append(f"{label} concise visible text has invalid outer whitespace or line breaks")
    lines = value.split("\n")
    if len(lines) > 2 or any(not line.strip() for line in lines):
        errors.append(f"{label} concise visible text permits at most two non-empty lines")
    if sum(not character.isspace() for character in value) > 28:
        errors.append(f"{label} concise visible text exceeds 28 non-whitespace characters")
    if re.search(r"[。！？!?；;]", value) or any(
        marker in value for marker in VISIBLE_TEXT_COLLOQUIAL_MARKERS
    ) or re.match(r"^[我你](?!国)", value) or re.search(r"[吧嘛呢呀啊哦啦呗]$", value):
        errors.append(f"{label} contains spoken or prose-like visible text")
    return errors


def _validate_visible_text_batch_review(
    repo: Path,
    workspace: Path,
) -> list[str]:
    state_file = workspace / "schema" / "episode-state.json"
    if not state_file.exists() or state_file.is_symlink() or not state_file.is_file():
        return []
    try:
        state = json.loads(state_file.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return []
    if not isinstance(state, dict) or state.get("current_phase") in {
        "delivered",
        "revoice_variant_delivered",
    }:
        return []
    direction_binding = state.get("visual_direction_review")
    if not isinstance(direction_binding, dict) or state.get(
        "current_phase"
    ) not in VISIBLE_TEXT_APPROVAL_REQUIRED_PHASES:
        return []

    review_binding = state.get("visible_text_review")
    if not isinstance(review_binding, dict):
        return ["complete visible-text batch approval is missing"]

    errors: list[str] = []
    if (
        review_binding.get("contract_version") != "visible-text-batch-review-v1"
        or review_binding.get("status") != "approved"
        or review_binding.get("approval_scope") != "complete_presented_map"
        or review_binding.get("user_has_reviewed_complete_map") is not True
        or review_binding.get("row_by_row_approval_performed") is not False
    ):
        errors.append("complete visible-text batch approval is missing")

    direction_file, direction_errors = _resolve_bound_regular_file(
        repo,
        direction_binding.get("path"),
        direction_binding.get("checksum_sha256"),
        "Visual-direction review",
    )
    review_file, review_errors = _resolve_bound_regular_file(
        repo,
        review_binding.get("path"),
        review_binding.get("checksum_sha256"),
        "Visible-text batch review",
    )
    errors.extend(direction_errors)
    errors.extend(review_errors)
    if direction_file is None or review_file is None:
        return errors
    try:
        direction = json.loads(direction_file.read_text(encoding="utf-8"))
        review = json.loads(review_file.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        errors.append("Visible-text batch review evidence is not valid UTF-8 JSON")
        return errors
    if not isinstance(direction, dict) or not isinstance(review, dict):
        errors.append("Visible-text batch review evidence must contain JSON objects")
        return errors

    workspace_relative = workspace.relative_to(repo).as_posix()
    expected_direction_binding = {
        "path": direction_binding.get("path"),
        "checksum_sha256": direction_binding.get("checksum_sha256"),
        "presented_map_sha256": direction_binding.get("presented_map_sha256"),
        "status": direction.get("status"),
    }
    if (
        direction.get("contract_version") != "per-shot-visual-direction-review-v3"
        or direction.get("status") not in {"approved", "policy_authorized"}
        or direction.get("presented_map_sha256")
        != direction_binding.get("presented_map_sha256")
    ):
        errors.append("Visible-text batch review visual-direction binding is stale")
    if (
        review.get("contract_version") != "visible-text-batch-review-v1"
        or review.get("episode_workspace") != workspace_relative
        or review.get("status") != "approved"
        or review.get("batch_scope")
        != "complete_active_generated_shot_visible_text_map"
        or review.get("row_approval_mode") != "forbidden_batch_only"
        or review.get("text_style_contract")
        != "concise-summary-visible-text-v1"
        or review.get("storyboard") != direction.get("storyboard")
        or review.get("visual_direction_review") != expected_direction_binding
    ):
        errors.append("Visible-text batch review scope or current-map binding is invalid")

    rows = review.get("rows")
    direction_rows = direction.get("rows")
    if (
        not isinstance(rows, list)
        or not isinstance(direction_rows, list)
        or len(rows) != len(direction_rows)
        or any(
            not isinstance(row, dict)
            or not isinstance(direction_row, dict)
            or row.get("shot_id") != direction_row.get("shot_id")
            for row, direction_row in zip(
                rows if isinstance(rows, list) else [],
                direction_rows if isinstance(direction_rows, list) else [],
            )
        )
    ):
        errors.append("Visible-text batch review does not cover the complete active shot set")
        rows = rows if isinstance(rows, list) else []
        direction_rows = direction_rows if isinstance(direction_rows, list) else []

    flipbook = _is_static_spread(direction)
    selected_flipbook = state.get("white_cat_visual_style_selection", {}).get("style_id") == "illustrated-flipbook"
    if flipbook != selected_flipbook or _is_static_spread(review) != flipbook:
        errors.append("Visible-text flipbook branch differs from selected episode style")
    if flipbook and review.get("body_text_contract") != "locked-narration-spread-body-v1":
        errors.append("Visible-text flipbook body contract is invalid")
    if flipbook or selected_flipbook:
        result = subprocess.run(
            ["node", str(STATIC_SPREAD_VALIDATOR_PATH)],
            input=json.dumps({"repositoryRoot": str(repo), "state": state,
                              "operation": "direction"}, ensure_ascii=False),
            text=True, capture_output=True, check=False,
        )
        if result.returncode:
            errors.append(f"Visible-text flipbook direction/style authority is invalid: {result.stderr.strip()}")

    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            errors.append(f"Visible-text row {index} must be a JSON object")
            continue
        shot_id = row.get("shot_id", index)
        direction_row = direction_rows[index] if index < len(direction_rows) and isinstance(direction_rows[index], dict) else {}
        spread = row.get("static_spread")
        if _is_static_spread(row) != flipbook or _is_static_spread(direction_row) != flipbook:
            errors.append(f"Visible-text row {shot_id} flipbook branch binding is stale")
        if flipbook:
            source_text = spread.get("source_text") if isinstance(spread, dict) else None
            if (
                row.get("body_text_contract") != "locked-narration-spread-body-v1"
                or not isinstance(spread, dict)
                or set(spread) != {"contract_version", "source_text", "source_text_sha256"}
                or spread.get("contract_version") != "knowledge-video-static-spread-v1"
                or not isinstance(source_text, str) or not source_text
                or hashlib.sha256(source_text.encode("utf-8")).hexdigest() != spread.get("source_text_sha256")
                or row.get("source_text_sha256") != spread.get("source_text_sha256")
                or spread != direction_row.get("static_spread")
                or spread != direction_row.get("user_selection", {}).get("static_spread")
            ):
                errors.append(f"Visible-text row {shot_id} exact flipbook body is stale")
        elif spread is not None or row.get("body_text_contract") is not None:
            errors.append(f"Visible-text row {shot_id} static body requires the selected flipbook style")
        if any(field in row for field in VISIBLE_TEXT_ROW_APPROVAL_FIELDS):
            errors.append(
                f"Visible-text row {shot_id} must not carry per-shot approval evidence"
            )
        mode = row.get("visible_text_mode")
        exact_text = row.get("exact_visible_text")
        placement = row.get("visible_text_placement")
        style_qa = row.get("text_style_qa")
        if (
            row.get("text_style_contract") != "concise-summary-visible-text-v1"
            or not isinstance(style_qa, dict)
            or style_qa.get("contract_version")
            != "concise-summary-visible-text-v1"
            or not SHA256_RE.fullmatch(str(row.get("source_text_sha256", "")))
        ):
            errors.append(f"Visible-text row {shot_id} style/source evidence is invalid")
        if mode == "required":
            errors.extend(_validate_concise_visible_text(exact_text, f"Visible-text row {shot_id}"))
            if not isinstance(placement, str) or not placement.strip() or style_qa.get("result") != "pass":
                errors.append(f"Visible-text row {shot_id} required-text evidence is invalid")
        elif mode == "none":
            if exact_text is not None or placement is not None or style_qa.get("result") != "not_applicable":
                errors.append(f"Visible-text row {shot_id} no-text evidence is invalid")
        else:
            errors.append(f"Visible-text row {shot_id} mode must be none or required")
        if index < len(direction_rows) and isinstance(direction_rows[index], dict):
            selection = direction_rows[index].get("user_selection")
            if not isinstance(selection, dict) or (
                mode,
                exact_text,
                placement,
            ) != (
                selection.get("visible_text_mode"),
                selection.get("exact_visible_text"),
                selection.get("visible_text_placement"),
            ):
                errors.append(f"Visible-text row {shot_id} differs from visual direction")

    projection = {
        key: review.get(key)
        for key in (
            "contract_version",
            "episode_workspace",
            "storyboard",
            "visual_direction_review",
            "batch_scope",
            "row_approval_mode",
            "text_style_contract",
            "rows",
        )
    }
    if "presentation_mode" in review:
        projection.update(presentation_mode=review.get("presentation_mode"),
                          body_text_contract=review.get("body_text_contract"))
    expected_map_sha256 = _canonical_sha256(projection)
    presentation = review.get("presentation")
    approval = review.get("approval")
    if (
        review.get("presented_map_sha256") != expected_map_sha256
        or not isinstance(presentation, dict)
        or presentation.get("complete_map_presented") is not True
        or not isinstance(presentation.get("exact_message"), str)
        or not presentation["exact_message"].strip()
        or not isinstance(presentation.get("presented_at"), str)
        or not presentation["presented_at"].strip()
    ):
        errors.append("Visible-text complete-map presentation evidence is missing or stale")
    if (
        not isinstance(approval, dict)
        or approval.get("status") != "approved"
        or approval.get("scope") != "complete_presented_map"
        or approval.get("presented_map_sha256") != expected_map_sha256
        or approval.get("user_has_reviewed_complete_map") is not True
        or approval.get("row_by_row_approval_performed") is not False
        or not isinstance(approval.get("exact_message"), str)
        or not approval["exact_message"].strip()
        or not isinstance(approval.get("decided_at"), str)
        or not approval["decided_at"].strip()
    ):
        errors.append("Visible-text batch review is not approved as one complete map")
    if (
        review_binding.get("presented_map_sha256") != expected_map_sha256
        or not isinstance(approval, dict)
        or review_binding.get("exact_decision_message") != approval.get("exact_message")
        or review_binding.get("decided_at") != approval.get("decided_at")
    ):
        errors.append("Visible-text review state binding is stale")
    return errors


def _validate_post_delivery_bgm_recommendation(
    repo: Path,
    workspace: Path,
) -> list[str]:
    state_file = workspace / "schema" / "episode-state.json"
    if not state_file.exists() or state_file.is_symlink() or not state_file.is_file():
        return []
    try:
        state = json.loads(state_file.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return []
    if not isinstance(state, dict):
        return []

    policy = state.get("post_delivery_bgm_recommendation_policy")
    phase = state.get("current_phase")
    final_phases = {"delivered", "revoice_variant_delivered"}
    waiting_phase = "awaiting_post_delivery_bgm_recommendation"
    if policy is None and phase not in {waiting_phase}:
        return []
    if policy != "required-v1":
        return ["post-delivery BGM recommendation policy must be required-v1"]
    if phase not in final_phases | {waiting_phase}:
        return []

    errors: list[str] = []
    delivery = state.get("delivery")
    if not isinstance(delivery, dict):
        return ["post-delivery BGM recommendation requires a passing delivery transaction"]
    required_roles = delivery.get("required_delivery_roles")
    delivered_roles = delivery.get("delivered_roles")
    if (
        delivery.get("status") != "delivered"
        or delivery.get("result") != "pass"
        or delivery.get("role_set_equality_result") != "pass"
        or not isinstance(required_roles, list)
        or not required_roles
        or any(not isinstance(role, str) or not role for role in required_roles)
        or not isinstance(delivered_roles, list)
        or sorted(required_roles) != sorted(delivered_roles)
    ):
        errors.append("post-delivery BGM recommendation requires a passing delivery transaction")
    if phase == waiting_phase:
        return errors

    binding = state.get("post_delivery_bgm_recommendation")
    if not isinstance(binding, dict):
        return errors + ["post-delivery BGM recommendation evidence is missing"]
    if (
        binding.get("contract_version")
        != "knowledge-video-post-delivery-bgm-recommendation-v1"
        or binding.get("status") != "complete"
    ):
        errors.append("post-delivery BGM recommendation state binding is incomplete")

    artifact_file, artifact_errors = _resolve_bound_regular_file(
        repo,
        binding.get("artifact_path"),
        binding.get("artifact_checksum_sha256"),
        "Post-delivery BGM recommendation artifact",
    )
    report_file, report_errors = _resolve_bound_regular_file(
        repo,
        binding.get("report_path"),
        binding.get("report_checksum_sha256"),
        "Post-delivery BGM recommendation report",
    )
    errors.extend(artifact_errors)
    errors.extend(report_errors)
    if artifact_file is None or report_file is None:
        return errors
    if artifact_file.parent != workspace / "schema":
        errors.append("Post-delivery BGM recommendation artifact must be under episode schema/")
    if report_file.parent != workspace / "docs":
        errors.append("Post-delivery BGM recommendation report must be under episode docs/")

    try:
        artifact = json.loads(artifact_file.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return errors + ["Post-delivery BGM recommendation artifact is not valid UTF-8 JSON"]
    if not isinstance(artifact, dict):
        return errors + ["Post-delivery BGM recommendation artifact must contain a JSON object"]
    if (
        artifact.get("contract_version")
        != "knowledge-video-post-delivery-bgm-recommendation-v1"
        or artifact.get("status") != "complete"
        or artifact.get("scope") != "advisory_only_no_media_mutation"
    ):
        errors.append("post-delivery BGM recommendation artifact contract is invalid")

    manifest_binding = artifact.get("delivery_transaction_manifest")
    expected_manifest_binding = {
        "path": delivery.get("transaction_manifest_path"),
        "checksum_sha256": delivery.get("transaction_manifest_checksum_sha256"),
    }
    if manifest_binding != expected_manifest_binding:
        errors.append("post-delivery BGM recommendation delivery binding is stale")
    else:
        manifest_file, manifest_errors = _resolve_bound_regular_file(
            repo,
            manifest_binding.get("path"),
            manifest_binding.get("checksum_sha256"),
            "Post-delivery BGM delivery manifest",
        )
        errors.extend(manifest_errors)
        if manifest_file is not None and manifest_file.parent != workspace / "schema":
            errors.append("Post-delivery BGM delivery manifest must be under episode schema/")

    expected_role = (
        "caption_free_master"
        if isinstance(required_roles, list) and "caption_free_master" in required_roles
        else "captioned_master"
    )
    analysis_master = artifact.get("analysis_master")
    render_outputs_value = state.get("render_outputs")
    render_outputs = render_outputs_value if isinstance(render_outputs_value, dict) else {}
    delivery_outputs_value = delivery.get("outputs")
    delivery_outputs = delivery_outputs_value if isinstance(delivery_outputs_value, dict) else {}
    render_output = render_outputs.get(expected_role, {})
    delivery_output = delivery_outputs.get(expected_role, {})
    if (
        not isinstance(analysis_master, dict)
        or analysis_master.get("role") != expected_role
        or analysis_master.get("path") != render_output.get("path")
        or analysis_master.get("checksum_sha256")
        != render_output.get("checksum_sha256")
        or analysis_master.get("checksum_sha256")
        != delivery_output.get("checksum_sha256")
    ):
        errors.append("post-delivery BGM recommendation master binding is stale")
    else:
        master_file, master_errors = _resolve_bound_regular_file(
            repo,
            analysis_master.get("path"),
            analysis_master.get("checksum_sha256"),
            "Post-delivery BGM analysis master",
        )
        errors.extend(master_errors)
        if master_file is not None and master_file.parent != workspace / "assets" / "video":
            errors.append("Post-delivery BGM analysis master must be under assets/video/")

    basis = artifact.get("recommendation_basis")
    basis_fields = (
        "content_track",
        "topic",
        "emotion_arc",
        "pacing",
        "narration_and_sfx",
        "distribution_intent",
    )
    if not isinstance(basis, dict) or any(
        not isinstance(basis.get(field), str) or not basis[field].strip()
        for field in basis_fields
    ):
        errors.append("post-delivery BGM recommendation basis is incomplete")

    recommendations = artifact.get("recommendations")
    if not isinstance(recommendations, list) or not 3 <= len(recommendations) <= 5:
        errors.append("post-delivery BGM recommendation must contain 3 to 5 candidates")
    else:
        required_text_fields = (
            "title",
            "creator",
            "source_name",
            "license_type",
            "attribution_requirement",
            "commercial_boundary",
            "platform_restrictions",
            "verified_at",
            "emotion",
            "fit_reason",
            "editing_note",
        )
        observed_urls: set[str] = set()
        for index, candidate in enumerate(recommendations, start=1):
            label = f"post-delivery BGM candidate {index}"
            if not isinstance(candidate, dict):
                errors.append(f"{label} must be a JSON object")
                continue
            if candidate.get("rank") != index:
                errors.append(f"{label} rank is invalid")
            if any(
                not isinstance(candidate.get(field), str) or not candidate[field].strip()
                for field in required_text_fields
            ):
                errors.append(f"{label} metadata is incomplete")
            for field in ("audition_url", "license_url"):
                url = candidate.get(field)
                if not isinstance(url, str) or not url.startswith("https://"):
                    errors.append(f"{label} {field} must be a verified HTTPS link")
                elif field == "audition_url":
                    if url in observed_urls:
                        errors.append(f"{label} audition_url must be unique")
                    observed_urls.add(url)
            if candidate.get("risk_level") not in {"low", "medium", "high"}:
                errors.append(f"{label} risk level is invalid")
            bpm = candidate.get("bpm")
            bpm_basis = candidate.get("bpm_basis")
            if (
                isinstance(bpm, bool)
                or (bpm is not None and (not isinstance(bpm, (int, float)) or not 0 < bpm <= 300))
                or bpm_basis not in {"official_metadata", "measured", "unpublished"}
                or (bpm is None and bpm_basis != "unpublished")
            ):
                errors.append(f"{label} BPM evidence is invalid")

    if artifact.get("mutation_evidence") != {
        "music_downloaded": False,
        "music_mixed": False,
        "delivered_master_changed": False,
    }:
        errors.append("post-delivery BGM recommendation must preserve delivered media")
    if artifact.get("report") != {
        "path": binding.get("report_path"),
        "checksum_sha256": binding.get("report_checksum_sha256"),
    }:
        errors.append("post-delivery BGM recommendation report binding is stale")
    return errors


def _validate_sound_effect_design_state(
    repo: Path,
    workspace: Path,
) -> list[str]:
    state_file = workspace / "schema" / "episode-state.json"
    if not state_file.exists() or state_file.is_symlink() or not state_file.is_file():
        return []
    try:
        state = json.loads(state_file.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return []
    if not isinstance(state, dict):
        return []
    binding = state.get("sound_effect_design")
    required_phases = {
        "composition_locked",
        "final_rendering",
        "revoice_assembly",
        "revoice_variant_rendering",
    }
    if binding is None:
        if state.get("current_phase") in required_phases:
            return ["current composition phase requires a passing sound-effect design binding"]
        return []
    if not isinstance(binding, dict):
        return ["sound_effect_design state binding must be a JSON object"]
    errors: list[str] = []
    artifact_file, artifact_errors = _resolve_bound_regular_file(
        repo,
        binding.get("path"),
        binding.get("checksum_sha256"),
        "Sound-effect design",
    )
    errors.extend(artifact_errors)
    if artifact_file is None:
        return errors
    try:
        artifact = json.loads(artifact_file.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return errors + ["Sound-effect design is not valid UTF-8 JSON"]
    workspace_schema = workspace / "schema"
    try:
        artifact_file.relative_to(workspace_schema)
    except ValueError:
        errors.append("Sound-effect design must be stored under the active episode schema")
    contract_version = artifact.get("contract_version")
    binding_contract_version = binding.get("contract_version")
    current_v2 = (
        contract_version == "knowledge-video-sound-design-v2"
        and binding_contract_version == contract_version
    )
    legacy_v1 = (
        contract_version == "knowledge-video-sound-design-v1"
        and binding_contract_version == contract_version
        and (
            state.get("current_phase") == "delivered"
            or artifact.get("resume_mode") == "revoice_variant"
        )
    )
    if (
        not (current_v2 or legacy_v1)
        or artifact.get("status") != "qa_passed"
        or binding.get("status") != "qa_passed"
        or artifact.get("result") != "pass"
        or artifact.get("episode_workspace") != workspace.relative_to(repo).as_posix()
        or artifact.get("fps") != 30
        or not isinstance(artifact.get("events"), list)
        or not isinstance(artifact.get("shot_analysis"), list)
        or binding.get("event_map_sha256") != artifact.get("event_map_sha256")
        or binding.get("bus_gain_multiplier") != artifact.get("bus_gain_multiplier")
        or binding.get("sound_effect_library")
        != artifact.get("bindings", {}).get("sound_effect_library")
    ):
        errors.append("sound_effect_design state binding is incomplete or stale")
        return errors
    if current_v2:
        policy = artifact.get("bindings", {}).get("sound_design_policy")
        if binding.get("sound_design_policy") != policy:
            errors.append("sound_effect_design policy binding is incomplete or stale")
        _, policy_errors = _resolve_bound_regular_file(
            repo,
            policy.get("path") if isinstance(policy, dict) else None,
            policy.get("checksum_sha256") if isinstance(policy, dict) else None,
            "Sound-design policy",
        )
        errors.extend(policy_errors)
    projection = dict(artifact)
    projection.pop("event_map_sha256", None)
    projection.pop("result", None)
    if artifact.get("event_map_sha256") != _canonical_sha256(projection):
        errors.append("Sound-effect design canonical event-map checksum is stale")
    return errors


def _validate_sound_effect_audio_preflight_state(
    repo: Path,
    workspace: Path,
) -> list[str]:
    state_file = workspace / "schema" / "episode-state.json"
    if not state_file.exists() or state_file.is_symlink() or not state_file.is_file():
        return []
    try:
        state = json.loads(state_file.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return []
    if not isinstance(state, dict):
        return []
    sound_design = state.get("sound_effect_design")
    if not isinstance(sound_design, dict) or sound_design.get(
        "contract_version"
    ) != "knowledge-video-sound-design-v2":
        return []
    required_phases = {
        "final_rendering",
        "revoice_variant_rendering",
        "awaiting_post_delivery_bgm_recommendation",
        "delivered",
    }
    if state.get("current_phase") not in required_phases:
        return []
    binding = state.get("sound_effect_audio_preflight")
    if not isinstance(binding, dict):
        return ["current render phase requires a passing audio-only sound preflight"]
    artifact_file, errors = _resolve_bound_regular_file(
        repo,
        binding.get("path"),
        binding.get("checksum_sha256"),
        "Sound-effect audio preflight",
    )
    if artifact_file is None:
        return errors
    try:
        artifact = json.loads(artifact_file.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return errors + ["Sound-effect audio preflight is not valid UTF-8 JSON"]
    try:
        artifact_file.relative_to(workspace / "schema")
    except ValueError:
        errors.append("Sound-effect audio preflight must be stored under the active episode schema")
    projection_sha = artifact.get("sound_effects_projection_sha256")
    if (
        binding.get("contract_version")
        != "knowledge-video-sound-audio-preflight-v1"
        or binding.get("status") != "qa_passed"
        or artifact.get("contract_version")
        != "knowledge-video-sound-audio-preflight-v1"
        or artifact.get("result") != "pass"
        or binding.get("sound_effects_projection_sha256") != projection_sha
        or not isinstance(projection_sha, str)
        or re.fullmatch(r"[a-f0-9]{64}", projection_sha) is None
        or binding.get("bus_gain_multiplier")
        != artifact.get("bus_gain_multiplier")
        or artifact.get("bus_gain_multiplier")
        != sound_design.get("bus_gain_multiplier")
        or artifact.get("narration", {}).get("gain") != 1
        or artifact.get("normalization") != "disabled"
        or artifact.get("sample_rate_hz") != 44100
        or artifact.get("peak_ceiling_dbfs") != -1
        or not isinstance(artifact.get("measured_peak_dbfs"), (int, float))
        or not math.isfinite(artifact.get("measured_peak_dbfs"))
        or artifact.get("measured_peak_dbfs") > -1
        or artifact.get("full_video_rendered") is not False
        or not isinstance(artifact.get("cue_groups"), list)
        or not isinstance(artifact.get("full_master_frames"), int)
        or artifact.get("full_master_frames") < 1
    ):
        errors.append("sound_effect_audio_preflight state binding is incomplete or stale")
    return errors


def validate_episode_workspace(repo_root: Path, workspace_arg: Path) -> list[str]:
    errors: list[str] = []
    repo = repo_root.resolve(strict=True)
    episode_parent = (repo / "leverage-video" / "src").resolve(strict=True)
    candidate = workspace_arg if workspace_arg.is_absolute() else repo / workspace_arg

    if candidate.is_symlink():
        return [f"Workspace is a symlink: {candidate}"]

    try:
        workspace = candidate.resolve(strict=True)
    except FileNotFoundError:
        return [f"Workspace does not exist: {candidate}"]

    if workspace.parent != episode_parent or not re.fullmatch(
        r"topic[0-9]+", workspace.name
    ):
        return [
            "Workspace must be a real direct child topic<N> under "
            f"leverage-video/src: {workspace}"
        ]
    if not workspace.is_dir():
        return [f"Workspace is not a directory: {workspace}"]

    for relative in REQUIRED_TOP:
        path = workspace / relative
        if path.is_symlink() or not path.is_dir():
            errors.append(
                f"Missing or symlinked required directory: {path.relative_to(repo)}"
            )

    assets = workspace / "assets"
    for relative in REQUIRED_ASSETS:
        path = assets / relative
        if path.is_symlink() or not path.is_dir():
            errors.append(
                f"Missing or symlinked required directory: {path.relative_to(repo)}"
            )

    observed_top = {path.name for path in workspace.iterdir() if path.is_dir()}
    for name in sorted(observed_top - REQUIRED_TOP):
        errors.append(
            f"Unexpected episode-level directory: {(workspace / name).relative_to(repo)}"
        )

    if assets.is_dir() and not assets.is_symlink():
        observed_assets = {path.name for path in assets.iterdir() if path.is_dir()}
        for name in sorted(observed_assets - REQUIRED_ASSETS):
            errors.append(
                f"Unexpected assets-level directory: {(assets / name).relative_to(repo)}"
            )

    for root, dirnames, filenames in os.walk(workspace, followlinks=False):
        root_path = Path(root)
        for name in tuple(dirnames) + tuple(filenames):
            path = root_path / name
            if path.is_symlink():
                errors.append(f"Symlink is not allowed: {path.relative_to(repo)}")

        for filename in filenames:
            path = root_path / filename
            expected = _expected_category(path)
            if expected is None:
                continue
            relative = path.relative_to(workspace)
            if relative.parts[: len(expected)] != expected:
                expected_text = "/".join(expected)
                errors.append(
                    f"Misplaced artifact: {path.relative_to(repo)}; "
                    f"expected under {expected_text}/"
                )

    errors.extend(_validate_white_cat_pending_qa(repo, workspace))
    errors.extend(_validate_failed_master_edit_source_overrides(repo, workspace))
    errors.extend(_validate_active_ian_layered_scene_queue(repo, workspace))
    errors.extend(_validate_visible_text_batch_review(repo, workspace))
    errors.extend(_validate_sound_effect_design_state(repo, workspace))
    errors.extend(_validate_sound_effect_audio_preflight_state(repo, workspace))
    errors.extend(_validate_post_delivery_bgm_recommendation(repo, workspace))

    return sorted(set(errors))


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate one knowledge-video episode workspace."
    )
    parser.add_argument("workspace", type=Path)
    args = parser.parse_args()
    repo_root = Path(__file__).resolve().parents[4]
    errors = validate_episode_workspace(repo_root, args.workspace)
    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 1
    print(f"Valid episode workspace: {args.workspace}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
