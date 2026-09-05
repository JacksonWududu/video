#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import re
import subprocess


REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
HELPER_PATH = Path(__file__).resolve().with_name("record-generated-imagegen-strict.py")
OVERRIDE_BRIDGE_PATH = (
    Path(__file__).resolve().parents[1] / "user-gate-override/consume-override.mjs"
)
TAKEOVER_ITEM_STATUSES = {
    "pending_generation",
    "changes_requested",
    "awaiting_batch_qa",
    "awaiting_user_approval",
}
WAIVED_PENDING_FINAL_REVIEW_STATUS = (
    "qa_failed_but_waived_once_pending_final_review"
)
EARLY_USER_ACCEPTANCE_STOP_STATUS = "stopped_by_explicit_user_acceptance"
PROMPT_FIXED_MARKER_QA_VERSION = "white-cat-prompt-fixed-marker-qa-v1"
P2_PROMPT_FIXED_MARKER = "WHITE-CAT SATCHEL STRAP LOCK:"
HERO_POSE_PROMPT_FIXED_MARKER = (
    "HERO-POSE ASSET: full-canvas transparent RGBA with fixed registration anchors."
)
P0_FORWARD_REVERSE_MISMATCH = "P0_FORWARD_REVERSE_MISMATCH"
P0_AMBIGUOUS_TRACE = "P0_AMBIGUOUS_TRACE"
P2_SATCHEL_TOPOLOGY = "P2_SATCHEL_TOPOLOGY"
VISIBLE_SYMBOL_FREE = "VISIBLE_SYMBOL_FREE"
FAILED_P0_MASTER_EDIT_SOURCE_GATE = "P0_FAILED_SOURCE_MUST_NOT_BE_EDIT_TARGET"
FAILED_MASTER_EDIT_SOURCE_OVERRIDE_VERSION = (
    "failed-p0-master-action-family-edit-source-override-v1"
)
FORWARD_REVERSE_MAPPING_QA_VERSION = "white-cat-forward-reverse-mapping-qa-v1"


def prompt_fixed_marker_failures(item: dict, prompt_text: str) -> list[dict]:
    asset_id = item.get("asset_id")
    failures = []
    if P2_PROMPT_FIXED_MARKER not in prompt_text:
        failures.append({
            "gate_id": f"visual_asset.{asset_id}.P2_PROMPT_FIXED_MARKER",
            "observed_result": "fail",
            "reason": (
                "P2_PROMPT_FIXED_MARKER: required literal is missing: "
                f"{P2_PROMPT_FIXED_MARKER}"
            ),
        })
    if (
        item.get("asset_kind") == "hero_pose"
        and HERO_POSE_PROMPT_FIXED_MARKER not in prompt_text
    ):
        failures.append({
            "gate_id": f"visual_asset.{asset_id}.HERO_POSE_PROMPT_FIXED_MARKER",
            "observed_result": "fail",
            "reason": (
                "HERO_POSE_PROMPT_FIXED_MARKER: required literal is missing: "
                f"{HERO_POSE_PROMPT_FIXED_MARKER}"
            ),
        })
    return failures


def validate_prompt_marker_supplement(
    override: dict,
    *,
    item: dict,
    failures: list[dict],
) -> None:
    supplements = override.get("decision", {}).get(
        "supplemental_exact_user_messages"
    )
    if not failures:
        if supplements is not None:
            raise ValueError(
                "one-time user gate override has an unnecessary supplemental prompt-marker release"
            )
        return
    expected_gate_ids = [failure["gate_id"] for failure in failures]
    if not isinstance(supplements, list) or len(supplements) != 1:
        raise ValueError(
            "one-time user gate override supplemental prompt-marker release is missing"
        )
    supplement = supplements[0]
    if (
        not isinstance(supplement, dict)
        or supplement.get("gate_ids") != expected_gate_ids
        or supplement.get("disposition") != "allow_once"
        or not isinstance(supplement.get("exact_user_message"), str)
    ):
        raise ValueError(
            "one-time user gate override supplemental prompt-marker release is stale"
        )
    message = supplement["exact_user_message"].lower()
    required_markers = [
        str(item.get("asset_id", "")).lower(),
        "提示词",
        "标记",
        "保留真实提示词",
        "失败证据",
    ]
    if (
        any(marker not in message for marker in required_markers)
        or not any(marker in message for marker in ("放行", "接受", "允许"))
        or not any(marker in message for marker in ("一次", "本次", "仅此一次"))
        or (
            any(failure["gate_id"].endswith(".P2_PROMPT_FIXED_MARKER") for failure in failures)
            and "p2" not in message
        )
        or (
            any(
                failure["gate_id"].endswith(".HERO_POSE_PROMPT_FIXED_MARKER")
                for failure in failures
            )
            and "hero-pose" not in message
            and "hero pose" not in message
        )
    ):
        raise ValueError(
            "one-time user gate override supplemental prompt-marker release is not exact and asset-specific"
        )


def load_helpers():
    spec = importlib.util.spec_from_file_location("ordinary_imagegen_helpers", HELPER_PATH)
    if spec is None or spec.loader is None:
        raise ValueError("ordinary ImageGen helpers cannot be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def is_action_variant(item: dict) -> bool:
    state_index = item.get("state_index")
    state_count_total = item.get("state_count_total")
    if item.get("asset_kind") == "hero_pose":
        return (
            isinstance(state_index, int)
            and isinstance(state_count_total, int)
            and 0 <= state_index < state_count_total
            and item.get("role") == f"action-{state_index + 1:02d}"
        )
    return (
        isinstance(state_index, int)
        and isinstance(state_count_total, int)
        and 1 <= state_index < state_count_total
        and item.get("role") == f"action-{state_index:02d}"
    )


def is_stopped_takeover_target(state: dict, item: dict | None, asset_id: str) -> bool:
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


def consumed_transition_ids(value: object) -> set[str]:
    found: set[str] = set()
    if isinstance(value, dict):
        for key, nested in value.items():
            if key == "consumed_transition_id" and isinstance(nested, str):
                found.add(nested)
            else:
                found.update(consumed_transition_ids(nested))
    elif isinstance(value, list):
        for nested in value:
            found.update(consumed_transition_ids(nested))
    return found


def count_consumed_transition_id(value: object, transition_id: str) -> int:
    count = 0
    if isinstance(value, dict):
        for key, nested in value.items():
            if key == "consumed_transition_id" and nested == transition_id:
                count += 1
            else:
                count += count_consumed_transition_id(nested, transition_id)
    elif isinstance(value, list):
        for nested in value:
            count += count_consumed_transition_id(nested, transition_id)
    return count


def validate_failed_master_edit_source_override(
    state: dict,
    item: dict,
    master: dict,
    helper,
) -> bool:
    """Validate the exact one-time release for a P0-failed action-family master."""
    if master.get("status") != WAIVED_PENDING_FINAL_REVIEW_STATUS:
        if master.get("failed_master_edit_source_override") is not None:
            raise ValueError("ordinary master carries an unnecessary failed-source override")
        return False

    master_id = master.get("asset_id")
    p0_gate_id = f"visual_asset.{master_id}.{P0_AMBIGUOUS_TRACE}"
    record = master.get("failed_master_edit_source_override")
    if p0_gate_id not in master.get("waived_mechanical_gate_ids", []):
        if record is not None:
            raise ValueError("non-P0 master carries an unnecessary failed-source override")
        return False
    if not isinstance(record, dict):
        raise ValueError("P0-failed master lacks an exact action-family edit-source override")
    shot_id = master.get("shot_id")
    action_ids = [
        candidate.get("asset_id")
        for candidate in state.get("visual_asset_review", {}).get("queue", [])
        if isinstance(candidate, dict)
        and candidate.get("shot_id") == shot_id
        and candidate.get("depends_on") == [master_id]
        and is_action_variant(candidate)
        and candidate.get("active_for_current_storyboard") is not False
        and candidate.get("status") != "superseded"
    ]
    qa_path = master.get("qa_evidence_path")
    qa_checksum = master.get("qa_evidence_checksum_sha256")
    qa_file = helper.checksum_bound_file(
        {"path": qa_path, "checksum_sha256": qa_checksum},
        "failed master QA evidence",
    )
    qa = json.loads(qa_file.read_text(encoding="utf-8"))
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
        helper.checksum_bound_file(artifact, f"failed master override artifact {index}")

    gate_id = f"visual_asset.{master_id}.{FAILED_P0_MASTER_EDIT_SOURCE_GATE}"
    reason = (
        f"P0-failed {master_id} source carries {P0_AMBIGUOUS_TRACE}; "
        "the default contract forbids using it as a downstream edit target."
    )
    override = record.get("user_mechanical_gate_override")
    decision = override.get("decision", {}) if isinstance(override, dict) else {}
    consumption = (
        override.get("consumption", {}) if isinstance(override, dict) else {}
    )
    expected_scope = f"{shot_id}:action-family-edit-source"
    expected_failure = {
        "gate_id": gate_id,
        "observed_result": "fail",
        "reason": reason,
    }
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
        or override.get("scope_id") != expected_scope
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
        raise ValueError("failed master edit-source override is stale or incomplete")
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
        raise ValueError("failed master edit-source decision is not exact and scoped")
    projection = {
        key: override.get(key)
        for key in (
            "contract_version",
            "episode_id",
            "scope_id",
            "gate_ids",
            "acknowledged_failures",
            "bound_artifacts",
            "decision",
            "consumption",
            "reuse_forbidden",
        )
    }
    transition_id = consumption.get("consumed_transition_id")
    if (
        override.get("override_sha256") != helper._canonical_sha256(projection)
        or not isinstance(transition_id, str)
        or not transition_id.strip()
        or count_consumed_transition_id(state, transition_id) != 1
    ):
        raise ValueError("failed master edit-source override checksum or consumption is stale")
    if item.get("asset_id") not in action_ids:
        raise ValueError("failed master edit-source override does not cover this action")
    return True


def consume_user_gate_override(
    override: dict,
    *,
    episode_id: str,
    scope_id: str,
    gate_ids: list[str],
    artifacts: list[dict],
    transition_id: str,
    consumed_at: str,
    from_phase: str = "awaiting_visual_asset_review",
    to_phase: str = "visual_production",
) -> dict:
    payload = {
        "operation": "consume",
        "override": override,
        "bindings": {
            "episodeId": episode_id,
            "requiredScopeId": scope_id,
            "requiredGateIds": gate_ids,
            "requiredArtifacts": artifacts,
            "fromPhase": from_phase,
            "toPhase": to_phase,
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
        raise ValueError("one-time user gate override validator returned invalid JSON") from error
    if not isinstance(consumed, dict):
        raise ValueError("one-time user gate override validator returned an invalid record")
    return consumed


def clear_active_takeover(review: dict) -> None:
    for key in (
        "user_takeover_required",
        "user_takeover_asset_id",
        "user_takeover_scope_id",
        "user_takeover_message",
    ):
        review.pop(key, None)


def mark_takeover_qa_resolution(item: dict) -> None:
    for key in (
        "image_generation_attempt_control",
        "white_cat_generation_attempt_control",
    ):
        control = item.get(key)
        if isinstance(control, dict) and control.get("automatic_retry_status") == (
            "stopped_user_takeover_required"
        ):
            control["automatic_retry_status"] = (
                "resolved_by_user_supplied_takeover_qa_pass"
            )
            control["resolution"] = "user-supplied-takeover-image-passed-full-qa"


def override_mode(args: argparse.Namespace, takeover_target: bool) -> str | None:
    p2 = bool(getattr(args, "accept_p2_with_user_override", False))
    combined = bool(
        getattr(
            args,
            "accept_p0_forward_reverse_and_p2_with_user_override",
            False,
        )
    )
    visible_symbol = bool(
        getattr(args, "accept_visible_symbol_with_user_override", False)
    )
    ambiguous_trace = bool(
        getattr(args, "accept_p0_ambiguous_trace_with_user_override", False)
    )
    if sum((p2, combined, visible_symbol, ambiguous_trace)) > 1:
        raise ValueError("one-time user gate override modes are mutually exclusive")
    if ambiguous_trace:
        return "p0_ambiguous_trace"
    if not takeover_target:
        return None
    if combined:
        return "p0_forward_reverse_and_p2"
    if p2:
        return "p2"
    if visible_symbol:
        return "visible_symbol"
    return None


def expected_forward_reverse_map(prompt_text: str) -> dict:
    facing_line = next(
        (
            line.strip().lower()
            for line in prompt_text.splitlines()
            if line.startswith("CAT FACING MAP:")
        ),
        "",
    )
    if "three-quarter screen-left" in facing_line or "three-quarter-screen-left" in facing_line:
        facing = "three-quarter-screen-left"
        front = "screen-left"
        rear = "screen-right"
    elif "three-quarter screen-right" in facing_line or "three-quarter-screen-right" in facing_line:
        facing = "three-quarter-screen-right"
        front = "screen-right"
        rear = "screen-left"
    else:
        raise ValueError(
            "P0_FORWARD_REVERSE_MISMATCH: prompt lacks one exact reversible CAT FACING MAP"
        )
    return {
        "expected_cat_facing_screen_direction": facing,
        "expected_anatomical_front_maps_to_screen": front,
        "expected_anatomical_rear_maps_to_screen": rear,
        "observed_cat_facing_screen_direction": (
            "three-quarter-screen-right"
            if facing == "three-quarter-screen-left"
            else "three-quarter-screen-left"
        ),
        "observed_anatomical_front_maps_to_screen": rear,
        "observed_anatomical_rear_maps_to_screen": front,
    }


def validate_forward_reverse_mapping_failure(
    identity: dict,
    *,
    prompt_text: str,
) -> dict:
    expected = expected_forward_reverse_map(prompt_text)
    mapping = identity.get("forward_reverse_mapping_qa")
    if (
        not isinstance(mapping, dict)
        or mapping.get("contract_version") != FORWARD_REVERSE_MAPPING_QA_VERSION
        or mapping.get("result") != "fail"
        or mapping.get("error_code") != P0_FORWARD_REVERSE_MISMATCH
        or any(mapping.get(key) != value for key, value in expected.items())
        or not isinstance(mapping.get("failure_reason"), str)
        or not mapping["failure_reason"].startswith(
            f"{P0_FORWARD_REVERSE_MISMATCH}:"
        )
        or identity.get("cat_facing_screen_direction")
        != expected["observed_cat_facing_screen_direction"]
        or identity.get("anatomical_front_maps_to_screen")
        != expected["observed_anatomical_front_maps_to_screen"]
        or identity.get("anatomical_rear_maps_to_screen")
        != expected["observed_anatomical_rear_maps_to_screen"]
    ):
        raise ValueError(
            "P0_FORWARD_REVERSE_MISMATCH: forward/reverse mapping QA is missing or stale"
        )
    return mapping


def record(args: argparse.Namespace) -> dict:
    helper = load_helpers()
    workspace = (REPOSITORY_ROOT / args.episode_workspace).resolve(strict=True)
    workspace.relative_to(REPOSITORY_ROOT.resolve())
    state_file = workspace / "schema/episode-state.json"
    state = json.loads(state_file.read_text(encoding="utf-8"))
    gate = helper.load_gate()
    review = state.get("visual_asset_review", {})
    one_click = review.get("mode") == "one_click_final_review_v1"
    candidate = next(
        (queued for queued in review.get("queue", []) if queued.get("asset_id") == args.asset_id),
        None,
    )
    takeover_target = is_stopped_takeover_target(state, candidate, args.asset_id)
    active_override_mode = override_mode(args, takeover_target)
    accepting_mechanical_override = active_override_mode is not None
    accepting_ambiguous_trace_override = (
        active_override_mode == "p0_ambiguous_trace"
    )
    early_ambiguous_trace_override = bool(
        accepting_ambiguous_trace_override and not takeover_target
    )
    accepting_white_cat_identity_override = active_override_mode in {
        "p2",
        "p0_forward_reverse_and_p2",
        "p0_ambiguous_trace",
    }
    user_supplied_takeover = bool(takeover_target and not accepting_mechanical_override)
    is_strict_revision = bool(
        candidate
        and candidate.get("strict_review") is True
        and candidate.get("is_revision") is True
        and candidate.get("status") in {"changes_requested", "awaiting_user_approval"}
    )
    is_requeued_batch_qa = bool(
        candidate
        and candidate.get("strict_review") is False
        and candidate.get("status") == "awaiting_batch_qa"
    )
    if takeover_target:
        item = candidate
    elif is_strict_revision:
        if review.get("current_asset_id") != args.asset_id:
            raise ValueError("strict revision is not the current visual asset")
        if candidate.get("status") == "changes_requested" and review.get("queue_generation_allowed") is False:
            raise ValueError("visual review queue is paused")
        if candidate.get("status") == "awaiting_user_approval" and review.get("queue_generation_allowed") is not False:
            raise ValueError("strict replacement requires a paused approval boundary")
        item = candidate
    elif is_requeued_batch_qa:
        if review.get("queue_generation_allowed") is False:
            raise ValueError("visual review queue is paused")
        if gate._next_unapproved(gate._queue(state)) is not candidate:
            raise ValueError("asset is not the current requeued hybrid QA target")
        item = candidate
    else:
        item = gate.require_generation_allowed(state, args.asset_id)
    is_white_cat_action = item.get("white_cat_present") is True
    expected_style_id, expected_cohesion_id, current_style_binding = (
        helper.resolve_white_cat_visual_style_binding(state, item)
    )
    active_style_selection = (
        helper.load_white_cat_visual_style_selection(state)
        if current_style_binding
        else {}
    )
    expected_style_profile_sha256 = (
        active_style_selection.get("style_profile_checksum_sha256")
        if current_style_binding
        and active_style_selection.get("contract_version")
        == helper.WHITE_CAT_STYLE_SELECTION_VERSION_V2
        else None
    )
    if (
        item.get("visual_generation_route") != "imagegen"
        or (item.get("strict_review") is not False and not is_strict_revision)
        or item.get("visible_text_mode") != "none"
        or not is_action_variant(item)
        or len(item.get("depends_on", [])) != 1
    ):
        raise ValueError("asset is not a normal ordinary-imagegen action state")

    qa_file = helper.resolve_path(args.qa_path, "QA evidence path")
    qa = json.loads(qa_file.read_text(encoding="utf-8"))
    expected_qa_result = "fail" if accepting_mechanical_override else "pass"
    expected_generator = (
        "user-supplied-takeover-image"
        if user_supplied_takeover
        else "codex-native-imagegen"
    )
    if (
        qa.get("contract_version") != (
            helper.WHITE_CAT_ACTION_QA_VERSION
            if is_white_cat_action
            else "ordinary-imagegen-historical-action-qa-v1"
        )
        or qa.get("result") != expected_qa_result
        or qa.get("asset_id") != args.asset_id
        or qa.get("generator") != expected_generator
        or qa.get("style_profile", {}).get("id") != item.get("treatment_profile_id")
        or not isinstance(qa.get("actual_reference_inputs"), list)
        or len(qa["actual_reference_inputs"]) not in ({2, 3} if is_white_cat_action else {1, 2})
        or not isinstance(qa.get("generation_lineage"), list)
        or len(qa["generation_lineage"]) < 1
    ):
        raise ValueError("ordinary ImageGen action QA evidence is incomplete")
    if user_supplied_takeover:
        takeover_source = helper.checksum_bound_file(
            qa.get("user_takeover_source", {}),
            "user takeover source",
        )
        if helper.sha256_file(takeover_source) != qa.get("selected_source", {}).get(
            "checksum_sha256"
        ):
            raise ValueError("user takeover source does not match selected exact bytes")

    prompt = helper.checksum_bound_file(qa["selected_prompt"], "selected prompt")
    prompt_text = prompt.read_text(encoding="utf-8")
    prompt_marker_qa_failures: list[dict] = []
    if "16:9 landscape composition" not in prompt_text or "VISIBLE-TEXT MODE: none." not in prompt_text:
        raise ValueError("production prompt lacks exact 16:9 or text-free instruction")
    if is_white_cat_action:
        prompt_marker_qa_failures = prompt_fixed_marker_failures(item, prompt_text)
        prompt_contract_text = prompt_text
        if (
            accepting_white_cat_identity_override
            and not accepting_ambiguous_trace_override
            and any(
            failure["gate_id"].endswith(".P2_PROMPT_FIXED_MARKER")
            for failure in prompt_marker_qa_failures
            )
        ):
            prompt_contract_text = f"{prompt_text}\n{P2_PROMPT_FIXED_MARKER}\n"
        helper.validate_white_cat_prompt_contract(prompt_contract_text)
    if current_style_binding:
        helper.validate_white_cat_style_prompt_and_qa(
            prompt_text=prompt_text,
            qa=qa,
            style_id=expected_style_id,
            cohesion_id=expected_cohesion_id,
            selection_sha256=item.get("white_cat_visual_style_selection_sha256"),
            current_binding=current_style_binding,
            style_profile_checksum_sha256=expected_style_profile_sha256,
        )

    source = helper.checksum_bound_file(qa["selected_source"], "selected source")
    dimensions = helper.png_dimensions(source)
    if list(dimensions) != qa["selected_source"].get("dimensions") or dimensions[0] <= dimensions[1]:
        raise ValueError("selected source dimensions are stale or non-landscape")
    relative_error = abs((dimensions[0] / dimensions[1]) / (16 / 9) - 1)
    if relative_error > 0.005 or abs(relative_error - qa["selected_source"].get("relative_aspect_ratio_error", 1)) > 1e-12:
        raise ValueError("selected source is outside the 16:9 tolerance")
    is_hero_pose = item.get("asset_kind") == "hero_pose"
    measured_alpha = None
    if is_hero_pose:
        transparent_qa = qa.get("transparent_pose_qa")
        expected_transparent_qa = {
            "result": "pass",
            "source_checksum_sha256": qa["selected_source"]["checksum_sha256"],
            "full_canvas_rgba": True,
            "transparent_background": True,
            "registration_anchor_policy": "fixed-full-canvas-v1",
        }
        hero_marker_is_released = accepting_mechanical_override and any(
            failure["gate_id"].endswith(".HERO_POSE_PROMPT_FIXED_MARKER")
            for failure in prompt_marker_qa_failures
        )
        if transparent_qa != expected_transparent_qa:
            raise ValueError("hero-pose asset lacks transparent full-canvas registration evidence")
        if (
            HERO_POSE_PROMPT_FIXED_MARKER not in prompt_text
            and not hero_marker_is_released
        ):
            raise ValueError("hero-pose asset lacks the fixed prompt registration marker")
        measured_alpha = helper.png_rgba_alpha_evidence(source)
        if (
            measured_alpha["min_alpha"] != 0
            or measured_alpha["max_alpha"] <= 0
            or measured_alpha["transparent_pixel_count"] < 1
            or measured_alpha["nontransparent_pixel_count"] < 1
        ):
            raise ValueError(
                "hero-pose asset lacks both transparent background and nontransparent subject pixels"
            )

    master_binding = qa["approved_master"]
    master = next(
        (candidate for candidate in state["visual_asset_review"]["queue"] if candidate.get("asset_id") == item["depends_on"][0]),
        None,
    )
    master_file = helper.checksum_bound_file(master_binding, "approved master")
    failed_master_source_released = bool(
        master
        and validate_failed_master_edit_source_override(
            state,
            item,
            master,
            helper,
        )
    )
    master_checksum = (
        master.get("approved_checksum_sha256")
        if master and master.get("status") == "approved"
        else master.get("checksum_sha256") if master else None
    )
    if (
        master is None
        or (
            master.get("status")
            not in (
                {"approved", "qa_passed_pending_final_review"}
                if one_click
                else {"approved"}
            )
            and not failed_master_source_released
        )
        or master_binding.get("asset_id") != master.get("asset_id")
        or master_binding.get("path") != master.get("path")
        or master_binding.get("checksum_sha256") != master_checksum
        or helper.sha256_file(master_file) != master_checksum
    ):
        raise ValueError("action source is not the exact approved master")

    profile = qa["style_profile"]
    authority = helper.resolve_path(profile.get("authority_path", ""), "style authority")
    if helper.sha256_file(authority) != profile.get("authority_checksum_sha256") or profile.get("medium_id") != expected_style_id:
        raise ValueError("ordinary ImageGen style authority is stale")
    expected_references = [
        {
            "role": "edit_target_approved_master",
            "path": master_binding["path"],
            "checksum_sha256": master_binding["checksum_sha256"],
        },
    ]
    if not is_white_cat_action and len(qa["actual_reference_inputs"]) == 2:
        identity_reference = qa["actual_reference_inputs"][1]
        identity_item = next(
            (
                candidate
                for candidate in state["visual_asset_review"]["queue"]
                if candidate.get("shot_id") == item.get("shot_id")
                and isinstance(candidate.get("state_index"), int)
                and candidate["state_index"] < item["state_index"]
                and candidate.get("path") == identity_reference.get("path")
                and candidate.get("checksum_sha256") == identity_reference.get("checksum_sha256")
                and candidate.get("presented_checksum_sha256") == identity_reference.get("checksum_sha256")
            ),
            None,
        )
        if (
            identity_reference.get("role") != "presented_same_shot_identity_reference"
            or identity_item is None
        ):
            raise ValueError("historical identity reference is not an earlier presented state from the same shot")
        expected_references.append({
            "role": "presented_same_shot_identity_reference",
            "path": identity_reference["path"],
            "checksum_sha256": identity_reference["checksum_sha256"],
        })
    character = qa.get("character_reference")
    if is_white_cat_action:
        primary = helper.resolve_path(character.get("primary_path", ""), "canonical identity reference")
        bible = helper.resolve_path(character.get("bible_path", ""), "character bible")
        constraints = helper.resolve_path(
            character.get("generation_constraints_path", ""),
            "white-cat generation constraints",
        )
        accuracy_rule = helper.resolve_path(
            character.get("satchel_accuracy_rule_path", ""),
            "white-cat satchel accuracy rule",
        )
        if (
            character.get("version") != "white-cat-v2"
            or helper.sha256_file(primary) != character.get("primary_checksum_sha256")
            or helper.sha256_file(bible) != character.get("bible_checksum_sha256")
            or helper.sha256_file(constraints) != character.get("generation_constraints_checksum_sha256")
            or helper.sha256_file(accuracy_rule) != character.get("satchel_accuracy_rule_checksum_sha256")
        ):
            raise ValueError("canonical white-cat binding is stale")
        expected_references.append({
            "role": "primary_canonical_identity_reference",
            "path": character["primary_path"],
            "checksum_sha256": character["primary_checksum_sha256"],
        })
    if is_white_cat_action and len(qa["actual_reference_inputs"]) == 3:
        support_path = str(Path(character["primary_path"]).with_name("socrates-cat-action-exploration-v01.png"))
        support_file = helper.resolve_path(support_path, "supporting action geometry reference")
        expected_references.append({
            "role": "supporting_action_geometry_reference",
            "path": support_path,
            "checksum_sha256": helper.sha256_file(support_file),
        })
    if qa["actual_reference_inputs"] != expected_references:
        raise ValueError("action did not use the exact approved master and canonical reference")
    for index, stage in enumerate(qa["generation_lineage"]):
        helper.checksum_bound_file(stage.get("prompt", {}), f"generation stage {index} prompt")
        helper.checksum_bound_file(stage.get("output", {}), f"generation stage {index} output")
        if stage.get("reference_inputs") != expected_references:
            raise ValueError(f"generation stage {index} has stale reference inputs")
        for ref_index, reference in enumerate(stage["reference_inputs"]):
            helper.checksum_bound_file(reference, f"generation stage {index} reference {ref_index}")
    selected_stage = qa["generation_lineage"][-1]
    if (
        selected_stage.get("selection_status") != "selected"
        or selected_stage.get("prompt") != qa["selected_prompt"]
        or selected_stage.get("output", {}).get("path") != qa["selected_source"]["path"]
        or selected_stage.get("output", {}).get("checksum_sha256") != qa["selected_source"]["checksum_sha256"]
    ):
        raise ValueError("selected generation lineage is inconsistent")
    for index, rejected in enumerate(qa.get("rejected_attempts", [])):
        helper.checksum_bound_file(rejected, f"rejected attempt {index}")

    checks = ["semantic_qa", "style_qa", "continuity_qa", "visual_qa"]
    if active_override_mode != "visible_symbol":
        checks.append("visible_text_qa")
    if not is_white_cat_action:
        checks.append("historical_identity_qa")
    for check in checks:
        if qa.get(check, {}).get("result") != "pass":
            raise ValueError(f"{check} did not pass")
    if is_white_cat_action:
        identity = qa["identity_qa"]
        if accepting_white_cat_identity_override:
            if identity.get("cat_count") != 1:
                raise ValueError("P0_CAT_COUNT: white-cat count must be one")
            if identity.get("foreleg_count") != 2:
                raise ValueError("P0_FORELIMB_COUNT: white-cat forelimb count must be two")
            if identity.get("hindleg_count") != 2:
                raise ValueError("P0_HINDLIMB_COUNT: white-cat hindlimb count must be two")
            if identity.get("paw_count") != 4:
                raise ValueError("P0_PAW_COUNT: white-cat paw count must be four")
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
                helper.validate_white_cat_ambiguous_trace_failure(
                    identity,
                    selected_source=qa["selected_source"],
                    selected_source_file=source,
                    expected_reason=waivable[0]["reason"],
                )
                helper.validate_white_cat_accessory_qa(identity)
                if identity.get("forward_reverse_mapping_qa") is not None:
                    raise ValueError(
                        "P0_AMBIGUOUS_TRACE override has unexpected forward/reverse mapping QA"
                    )
            else:
                helper.validate_white_cat_anatomy_qa_v2(
                    identity.get("anatomy_evidence", {}),
                    selected_source=qa["selected_source"],
                    selected_source_file=source,
                )
            if active_override_mode == "p0_forward_reverse_and_p2":
                validate_forward_reverse_mapping_failure(
                    identity,
                    prompt_text=prompt_text,
                )
            elif (
                not accepting_ambiguous_trace_override
                and identity.get("forward_reverse_mapping_qa") is not None
            ):
                raise ValueError(
                    "P2-only user gate override has unexpected forward/reverse mapping QA"
                )
            if not accepting_ambiguous_trace_override:
                try:
                    helper.validate_white_cat_accessory_qa(identity)
                except ValueError as error:
                    if not str(error).startswith("P2_SATCHEL_TOPOLOGY:"):
                        raise
                else:
                    raise ValueError(
                        "one-time user gate override requires a real P2_SATCHEL_TOPOLOGY failure"
                    )
            if identity.get("result") not in {"fail", "failed_but_waived_once"}:
                raise ValueError(
                    "one-time user gate override may not rewrite failed white-cat identity QA as pass"
                )
        else:
            helper.validate_white_cat_identity_qa_v2(
                identity,
                selected_source=qa["selected_source"],
                selected_source_file=source,
            )
    visible = qa["visible_text_qa"]
    if visible.get("no_visible_text") is not True or visible.get("no_pseudotext") is not True:
        raise ValueError("white-cat text-free QA is incomplete")
    if active_override_mode == "visible_symbol":
        if (
            visible.get("result") != "fail"
            or visible.get("no_decorative_symbols") is not False
        ):
            raise ValueError(
                "VISIBLE_SYMBOL_FREE: visible-symbol failure evidence is missing or stale"
            )
    if qa["continuity_qa"].get("derived_directly_from_approved_master") is not True:
        raise ValueError("imagegen action continuity QA is incomplete")

    consumed_override = None
    override_artifacts = None
    override_gate_ids = None
    attempt_blocker = None
    if accepting_mechanical_override:
        if takeover_target and state.get("phase") == "visual_production" and state.get(
            "current_phase"
        ) == "visual_production":
            state["phase"] = "awaiting_visual_asset_review"
            state["current_phase"] = "awaiting_visual_asset_review"
        expected_override_phase = (
            "visual_production"
            if early_ambiguous_trace_override
            else "awaiting_visual_asset_review"
        )
        if (
            review.get("mode") != "one_click_final_review_v1"
            or state.get("phase") != expected_override_phase
            or state.get("current_phase") != expected_override_phase
        ):
            raise ValueError(
                "one-time user gate override phase is stale"
            )
        scope_id = item.get("generation_attempt_scope_id")
        if (
            not isinstance(scope_id, str)
            or not scope_id.strip()
            or (
                not early_ambiguous_trace_override
                and review.get("user_takeover_scope_id") != scope_id
            )
        ):
            raise ValueError("one-time user gate override scope is stale")
        attempt_control = item.get("image_generation_attempt_control", {})
        white_cat_control = item.get("white_cat_generation_attempt_control", {})
        expected_failure_count = 1 if early_ambiguous_trace_override else 3
        expected_retry_status = (
            "retry_allowed"
            if early_ambiguous_trace_override
            else "stopped_user_takeover_required"
        )
        if (
            attempt_control.get("contract_version")
            != "storyboard-image-generation-attempt-limit-v1"
            or attempt_control.get("generation_attempt_scope_id") != scope_id
            or attempt_control.get("maximum_automatic_rejected_generations") != 3
            or attempt_control.get("rejected_generation_count") != expected_failure_count
            or attempt_control.get("automatic_retry_status") != expected_retry_status
            or (
                accepting_white_cat_identity_override
                and (
                    white_cat_control.get("contract_version")
                    != "white-cat-imagegen-attempt-limit-v1"
                    or white_cat_control.get("maximum_automatic_qa_failures") != 3
                    or white_cat_control.get("qa_failed_generation_count")
                    != expected_failure_count
                    or white_cat_control.get("automatic_retry_status")
                    != expected_retry_status
                )
            )
        ):
            raise ValueError(
                "one-time user gate override attempt evidence is stale"
            )
        attempt_gate_id = f"storyboard-image-generation-attempt-limit:{scope_id}"
        if early_ambiguous_trace_override:
            if any(
                isinstance(blocker, dict)
                and blocker.get("blocker_id") == attempt_gate_id
                for blocker in state.get("blockers", [])
            ):
                raise ValueError(
                    "early user acceptance carries an unnecessary attempt-limit blocker"
                )
        else:
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
                or matching_blockers[0].get("asset_id") != item["asset_id"]
                or matching_blockers[0].get("generation_attempt_scope_id") != scope_id
                or matching_blockers[0].get("status")
                != "stopped_user_takeover_required"
            ):
                raise ValueError(
                    "one-time user gate override attempt-limit blocker is missing or stale"
                )
            attempt_blocker = matching_blockers[0]
        generation_failures = item.get("image_generation_qa_failures", [])
        white_cat_failures = item.get("white_cat_imagegen_qa_failures", [])
        generation_checksums = [
            failure.get("output", {}).get("checksum_sha256")
            for failure in generation_failures
            if isinstance(failure, dict)
        ]
        expected_latest_error_code = (
            P0_FORWARD_REVERSE_MISMATCH
            if active_override_mode == "p0_forward_reverse_and_p2"
            else (
                P0_AMBIGUOUS_TRACE
                if accepting_ambiguous_trace_override
                else P2_SATCHEL_TOPOLOGY
            )
        )
        if (
            len(generation_failures) != expected_failure_count
            or len(set(generation_checksums)) != len(generation_checksums)
            or (
                accepting_white_cat_identity_override
                and (
                    len(white_cat_failures) != expected_failure_count
                    or white_cat_failures[-1].get("error_code")
                    != expected_latest_error_code
                )
            )
        ):
            raise ValueError(
                "one-time user gate override failure history is missing or inconsistent"
            )
        latest_failure = (
            white_cat_failures[-1]
            if accepting_white_cat_identity_override
            else generation_failures[-1]
        )
        helper.checksum_bound_file(
            latest_failure.get("prompt", {}),
            "latest failed prompt",
        )
        helper.checksum_bound_file(
            latest_failure.get("output", {}),
            "latest failed output",
        )
        latest_failure_reason = latest_failure.get("failure_reason")
        if active_override_mode == "visible_symbol" and (
            latest_failure.get("prompt") != qa.get("selected_prompt")
            or latest_failure.get("output", {}).get("path")
            != qa.get("selected_source", {}).get("path")
            or latest_failure.get("output", {}).get("checksum_sha256")
            != qa.get("selected_source", {}).get("checksum_sha256")
        ):
            raise ValueError(
                "VISIBLE_SYMBOL_FREE: selected source is not the exact third failed output"
            )
        expected_waivable_failures = (
            [
                {
                    "error_code": P0_FORWARD_REVERSE_MISMATCH,
                    "observed_result": "fail",
                    "reason": latest_failure_reason,
                },
                {
                    "error_code": P2_SATCHEL_TOPOLOGY,
                    "observed_result": "fail",
                    "reason": latest_failure_reason,
                },
            ]
            if active_override_mode == "p0_forward_reverse_and_p2"
            else ([{
                "error_code": VISIBLE_SYMBOL_FREE,
                "observed_result": "fail",
                "reason": latest_failure_reason,
            }] if active_override_mode == "visible_symbol" else ([{
                "error_code": P0_AMBIGUOUS_TRACE,
                "observed_result": "fail",
                "reason": latest_failure_reason,
            }] if accepting_ambiguous_trace_override else None))
        )
        if active_override_mode == "p0_forward_reverse_and_p2":
            if (
                qa.get("waivable_mechanical_failures")
                != expected_waivable_failures
                or identity["forward_reverse_mapping_qa"].get("failure_reason")
                != latest_failure_reason
            ):
                raise ValueError(
                    "one-time user gate override combined P0/P2 failure evidence is stale"
                )
        elif active_override_mode == "visible_symbol":
            if qa.get("waivable_mechanical_failures") != expected_waivable_failures:
                raise ValueError(
                    "VISIBLE_SYMBOL_FREE: waivable failure evidence is stale"
                )
        elif accepting_ambiguous_trace_override:
            if qa.get("waivable_mechanical_failures") != expected_waivable_failures:
                raise ValueError(
                    "P0_AMBIGUOUS_TRACE: waivable failure evidence is stale"
                )
        elif qa.get("waivable_mechanical_failures") is not None:
            raise ValueError(
                "P2-only user gate override has unexpected combined failure evidence"
            )
        qa_checksum = helper.sha256_file(qa_file)
        numbered_map = qa["identity_qa"]["anatomy_evidence"]["inspection_evidence"]
        override_artifacts = [
            {
                "path": qa["selected_source"]["path"],
                "checksum_sha256": qa["selected_source"]["checksum_sha256"],
            },
            {
                "path": qa["selected_prompt"]["path"],
                "checksum_sha256": qa["selected_prompt"]["checksum_sha256"],
            },
            {"path": args.qa_path, "checksum_sha256": qa_checksum},
            {
                "path": numbered_map["numbered_limb_map_path"],
                "checksum_sha256": numbered_map[
                    "numbered_limb_map_checksum_sha256"
                ],
            },
        ]
        for binding in (
            latest_failure["output"],
            latest_failure["prompt"],
        ):
            normalized = {
                "path": binding["path"],
                "checksum_sha256": binding["checksum_sha256"],
            }
            if normalized not in override_artifacts:
                override_artifacts.append(normalized)
        p0_gate_id = (
            f"visual_asset.{item['asset_id']}.P0_FORWARD_REVERSE_MISMATCH"
        )
        p2_gate_id = f"visual_asset.{item['asset_id']}.P2_SATCHEL_TOPOLOGY"
        visible_symbol_gate_id = (
            f"visual_asset.{item['asset_id']}.{VISIBLE_SYMBOL_FREE}"
        )
        ambiguous_trace_gate_id = (
            f"visual_asset.{item['asset_id']}.{P0_AMBIGUOUS_TRACE}"
        )
        prompt_marker_gate_ids = [
            failure["gate_id"] for failure in prompt_marker_qa_failures
        ]
        override_gate_ids = [
            *([] if early_ambiguous_trace_override else [attempt_gate_id]),
            *(
                [p0_gate_id]
                if active_override_mode == "p0_forward_reverse_and_p2"
                else []
            ),
            *(
                [ambiguous_trace_gate_id]
                if accepting_ambiguous_trace_override
                else (
                    [p2_gate_id, *prompt_marker_gate_ids]
                    if accepting_white_cat_identity_override
                    else [visible_symbol_gate_id]
                )
            ),
        ]
        pending_override = item.get("pending_user_mechanical_gate_override")
        if pending_override is None and active_override_mode in {
            "visible_symbol", "p0_ambiguous_trace",
        }:
            exact_user_message = getattr(args, "override_exact_user_message", "")
            decided_at = getattr(args, "override_decided_at", "")
            pending_override = {
                "contract_version": (
                    "one-time-explicit-user-mechanical-gate-override-v1"
                ),
                "episode_id": state.get("episode_id"),
                "scope_id": scope_id,
                "gate_ids": override_gate_ids,
                "acknowledged_failures": [
                    *([] if early_ambiguous_trace_override else [{
                        "gate_id": attempt_gate_id,
                        "observed_result": "stopped_user_takeover_required",
                        "reason": attempt_blocker["message"],
                    }]),
                    {
                        "gate_id": (
                            ambiguous_trace_gate_id
                            if accepting_ambiguous_trace_override
                            else visible_symbol_gate_id
                        ),
                        "observed_result": "fail",
                        "reason": latest_failure_reason,
                    },
                ],
                "bound_artifacts": override_artifacts,
                "decision": {
                    "exact_user_message": exact_user_message,
                    "decided_at": decided_at,
                    "disposition": "allow_once",
                },
                "consumption": {
                    "from_phase": expected_override_phase,
                    "to_phase": "visual_production",
                    "status": "available",
                },
                "reuse_forbidden": True,
            }
            pending_override["override_sha256"] = helper._canonical_sha256(
                pending_override
            )
        if not isinstance(pending_override, dict):
            raise ValueError("one-time user gate override record is missing")
        failure_by_gate = {
            row.get("gate_id"): row
            for row in pending_override.get("acknowledged_failures", [])
            if isinstance(row, dict)
        }
        if (
            (
                not early_ambiguous_trace_override
                and failure_by_gate.get(attempt_gate_id, {}).get("observed_result")
                != "stopped_user_takeover_required"
            )
            or (
                active_override_mode == "p0_forward_reverse_and_p2"
                and failure_by_gate.get(p0_gate_id, {}).get("reason")
                != latest_failure_reason
            )
            or (
                accepting_white_cat_identity_override
                and not accepting_ambiguous_trace_override
                and failure_by_gate.get(p2_gate_id, {}).get("reason")
                != latest_failure_reason
            )
            or (
                active_override_mode == "visible_symbol"
                and failure_by_gate.get(visible_symbol_gate_id, {}).get("reason")
                != latest_failure_reason
            )
            or (
                accepting_ambiguous_trace_override
                and failure_by_gate.get(ambiguous_trace_gate_id, {}).get("reason")
                != latest_failure_reason
            )
            or any(
                failure_by_gate.get(failure["gate_id"]) != failure
                for failure in prompt_marker_qa_failures
            )
        ):
            raise ValueError(
                "one-time user gate override does not preserve the exact failed results"
            )
        if accepting_white_cat_identity_override and not accepting_ambiguous_trace_override:
            validate_prompt_marker_supplement(
                pending_override,
                item=item,
                failures=prompt_marker_qa_failures,
            )
        exact_message = pending_override.get("decision", {}).get("exact_user_message", "")
        normalized_message = exact_message.lower()
        if accepting_ambiguous_trace_override:
            exact_early_message = (
                item["asset_id"].lower() in normalized_message
                and P0_AMBIGUOUS_TRACE.lower() in normalized_message
                and any(marker in normalized_message for marker in ("第一次", "第1次", "attempt 1"))
                and any(marker in normalized_message for marker in ("停止", "不再"))
                and any(marker in normalized_message for marker in ("重试", "自动重试"))
                and "保留" in normalized_message
                and "失败证据" in normalized_message
                and any(marker in normalized_message for marker in ("一次", "本次", "仅此一次"))
                and any(marker in normalized_message for marker in ("放行", "接受", "允许"))
            )
            if not exact_early_message:
                raise ValueError(
                    "early P0_AMBIGUOUS_TRACE override message is not exact and asset-specific"
                )
        elif (
            item["asset_id"].lower() not in normalized_message
            or (
                accepting_white_cat_identity_override
                and not any(
                    marker in normalized_message for marker in ("p2", "背带", "挎包")
                )
            )
            or (
                active_override_mode == "visible_symbol"
                and not any(
                    marker in normalized_message
                    for marker in ("可见符号", "符号", "图案", "浮雕")
                )
            )
            or (
                active_override_mode == "p0_forward_reverse_and_p2"
                and not any(
                    marker in normalized_message
                    for marker in ("p0", "朝向", "前后")
                )
            )
            or not any(marker in normalized_message for marker in ("三次", "3次", "重试", "attempt"))
            or not any(marker in normalized_message for marker in ("放行", "接受", "允许"))
        ):
            raise ValueError(
                "one-time user gate override message must name the asset, released mechanical failure, and three-attempt stop"
            )
        transition_id = getattr(args, "override_transition_id", "")
        consumed_at = getattr(args, "override_consumed_at", "")
        if (
            not isinstance(transition_id, str)
            or not transition_id.strip()
            or transition_id in consumed_transition_ids(state)
        ):
            raise ValueError(
                "one-time user gate override consumed transition id is missing or reused"
            )
        episode_id = state.get("episode_id")
        if not isinstance(episode_id, str) or not episode_id.strip():
            raise ValueError("one-time user gate override episode id is missing")
        consumed_override = consume_user_gate_override(
            pending_override,
            episode_id=episode_id,
            scope_id=scope_id,
            gate_ids=override_gate_ids,
            artifacts=override_artifacts,
            transition_id=transition_id,
            consumed_at=consumed_at,
            from_phase=expected_override_phase,
            to_phase="visual_production",
        )
        if early_ambiguous_trace_override:
            attempt_control.update(
                automatic_retry_status=EARLY_USER_ACCEPTANCE_STOP_STATUS,
                resolution="first-failed-output-accepted-by-explicit-user",
            )
            white_cat_control.update(
                automatic_retry_status=EARLY_USER_ACCEPTANCE_STOP_STATUS,
                resolution="first-failed-output-accepted-by-explicit-user",
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
        "identity_qa": qa["identity_qa"],
    } if is_white_cat_action else {
        "historical_identity_qa": qa["historical_identity_qa"],
    })
    item.update(
        status="awaiting_user_approval" if is_strict_revision else "awaiting_batch_qa",
        generator=qa["generator"],
        path=qa["selected_source"]["path"],
        checksum_sha256=qa["selected_source"]["checksum_sha256"],
        measured_dimensions=list(dimensions),
        measured_aspect_ratio_relative_error=relative_error,
        source_approval_object=True,
        composition_derivative_status="pending_source_approval",
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
        qa_evidence_checksum_sha256=helper.sha256_file(qa_file),
        technical_qa={"result": "pass", "rule_id": "ordinary-imagegen-source-v1", "measured_dimensions": list(dimensions)},
        semantic_qa=qa["semantic_qa"],
        visible_text_qa=qa["visible_text_qa"],
        style_qa=qa["style_qa"],
        continuity_qa=qa["continuity_qa"],
        visual_qa=qa["visual_qa"],
        **({
            "transparent_pose_qa": {
                **qa["transparent_pose_qa"],
                "measured_alpha": measured_alpha,
            },
        } if is_hero_pose else {}),
        **identity_fields,
    )
    if is_white_cat_action:
        item["qa_contract_version"] = qa["contract_version"]
    if user_supplied_takeover:
        item["user_takeover_source"] = qa["user_takeover_source"]
        item["user_takeover_adopted_at"] = args.qa_time
        mark_takeover_qa_resolution(item)
    if accepting_mechanical_override:
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
        item.pop("pending_user_mechanical_gate_override", None)
        if prompt_marker_qa_failures:
            item["prompt_contract_qa"] = {
                "contract_version": PROMPT_FIXED_MARKER_QA_VERSION,
                "result": "failed_but_waived_once",
                "prompt": qa["selected_prompt"],
                "failures": prompt_marker_qa_failures,
            }
        else:
            item.pop("prompt_contract_qa", None)
        if attempt_blocker is not None:
            attempt_blocker.update(
                status="failed_but_waived_once",
                user_mechanical_gate_override_sha256=consumed_override[
                    "override_sha256"
                ],
            )
        review["queue_generation_allowed"] = True
        state["phase"] = "visual_production"
        state["current_phase"] = "visual_production"
        clear_active_takeover(review)
    if is_strict_revision:
        item.update(
            presented_checksum_sha256=qa["selected_source"]["checksum_sha256"],
            presented_at=args.qa_time,
            exact_presentation_message=(
                f"现呈交 {item['asset_id']} 修订源 PNG，等待用户明确批准此精确字节。"
            ),
        )
        state["visual_asset_review"]["queue_generation_allowed"] = False
        state["visual_asset_review"]["current_asset_id"] = args.asset_id
    elif not accepting_mechanical_override:
        gate.record_hybrid_qa_pass(state, args.asset_id, args.qa_time)
        if user_supplied_takeover:
            clear_active_takeover(review)
            review["queue_generation_allowed"] = True
            if state.get("phase") == "awaiting_visual_asset_review":
                state["phase"] = "visual_production"
                state["current_phase"] = "visual_production"
    if not is_strict_revision:
        active = [
            candidate for candidate in state["visual_asset_review"]["queue"]
            if candidate.get("active_for_current_storyboard") is not False and candidate.get("status") != "superseded"
        ]
        next_item = next(
            (candidate for candidate in active if candidate.get("status") not in {
                "approved", "qa_passed_pending_batch_review", "qa_passed_pending_final_review",
                WAIVED_PENDING_FINAL_REVIEW_STATUS,
            }),
            None,
        )
        state["visual_asset_review"]["current_asset_id"] = next_item.get("asset_id") if next_item else None
    temporary = state_file.with_suffix(".json.imagegen-hybrid-qa.tmp")
    if temporary.exists():
        raise ValueError("ordinary ImageGen hybrid QA temporary path already exists")
    temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(state_file)
    return {
        "result": "pass_with_user_override" if accepting_mechanical_override else "pass",
        "asset_id": args.asset_id,
        "status": item["status"],
        "checksum_sha256": item["checksum_sha256"],
        "queue_generation_allowed": state["visual_asset_review"]["queue_generation_allowed"],
        "current_asset_id": state["visual_asset_review"]["current_asset_id"],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("episode_workspace")
    parser.add_argument("asset_id")
    parser.add_argument("qa_path")
    parser.add_argument("qa_time")
    parser.add_argument("--accept-p2-with-user-override", action="store_true")
    parser.add_argument(
        "--accept-p0-forward-reverse-and-p2-with-user-override",
        action="store_true",
    )
    parser.add_argument(
        "--accept-visible-symbol-with-user-override",
        action="store_true",
    )
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
    if sum((
        args.accept_p2_with_user_override,
        args.accept_p0_forward_reverse_and_p2_with_user_override,
        args.accept_visible_symbol_with_user_override,
        args.accept_p0_ambiguous_trace_with_user_override,
    )) > 1:
        raise SystemExit("one-time user gate override modes are mutually exclusive")
    accepting_override = (
        args.accept_p2_with_user_override
        or args.accept_p0_forward_reverse_and_p2_with_user_override
        or args.accept_visible_symbol_with_user_override
        or args.accept_p0_ambiguous_trace_with_user_override
    )
    if accepting_override and (
        not args.override_transition_id
        or not re.fullmatch(
            r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}",
            args.override_consumed_at or "",
        )
    ):
        raise SystemExit(
            "mechanical override requires a transition id and ISO-8601 consumed time with offset"
        )
    if (
        args.accept_visible_symbol_with_user_override
        or args.accept_p0_ambiguous_trace_with_user_override
    ) and (
        not args.override_exact_user_message
        or not re.fullmatch(
            r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}",
            args.override_decided_at or "",
        )
    ):
        raise SystemExit(
            "mechanical override requires the exact user message and ISO-8601 decision time"
        )
    print(json.dumps(record(args), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
