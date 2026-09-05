#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
from typing import Any


REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
GATE_PATH = REPOSITORY_ROOT / ".agents/skills/run-knowledge-video/scripts/validate_visual_approval_state.py"
VALIDATOR_PATH = REPOSITORY_ROOT / ".agents/skills/ian-handdrawn-ppt/scripts/validate_knowledge_video_layered_scene.mjs"
OVERRIDE_BRIDGE_PATH = (
    REPOSITORY_ROOT
    / "leverage-video/src/shared/user-gate-override/consume-override.mjs"
)
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
IAN_CANONICAL_STYLE_ANCHOR_PATH = (
    ".agents/skills/ian-handdrawn-ppt/assets/"
    "reference-handdrawn-article-illustration-style.png"
)
VISIBLE_TEXT_SEGMENT_SEPARATOR_RE = re.compile(r"\r\n|\n|｜")
IAN_STOPPED_LAYOUT_REPAIR_SOURCE_GATE = (
    "IAN_STOPPED_LAYOUT_REPAIR_SOURCE_MUST_BE_THIRD_REJECTED_GENERATION"
)
IAN_LAYOUT_REPAIR_DISPOSITION = "ian-generation-layout-repair-disposition-v1"
REPAIR_REQUIRED_STATUS = "deterministic_layout_repair_required"


def sha256_file(file: Path) -> str:
    digest = hashlib.sha256()
    with file.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_root_relative(value: str, label: str) -> Path:
    candidate = Path(value)
    if candidate.is_absolute() or not value or ".." in candidate.parts:
        raise ValueError(f"{label} must be root-relative")
    unresolved = REPOSITORY_ROOT / candidate
    if unresolved.is_symlink():
        raise ValueError(f"{label} must be a regular non-symlink non-empty file")
    resolved = unresolved.resolve(strict=True)
    resolved.relative_to(REPOSITORY_ROOT.resolve())
    if not resolved.is_file() or resolved.stat().st_size == 0:
        raise ValueError(f"{label} must be a regular non-symlink non-empty file")
    return resolved


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ValueError(f"cannot load {name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def checksum_bound_file(binding: dict[str, Any], label: str) -> Path:
    if not isinstance(binding, dict) or not SHA256_RE.fullmatch(
        str(binding.get("checksum_sha256", ""))
    ):
        raise ValueError(f"{label} binding is invalid")
    file = resolve_root_relative(binding.get("path", ""), f"{label} path")
    if sha256_file(file) != binding["checksum_sha256"]:
        raise ValueError(f"{label} checksum is stale")
    return file


def exact_visible_text_segments(value: str) -> list[str]:
    return VISIBLE_TEXT_SEGMENT_SEPARATOR_RE.split(value)


def labels_reproduce_exact_visible_text(
    labels: Any,
    exact_visible_text: Any,
) -> bool:
    if (
        not isinstance(labels, list)
        or not labels
        or not isinstance(exact_visible_text, str)
        or not exact_visible_text
    ):
        return False
    texts = [label.get("text") if isinstance(label, dict) else None for label in labels]
    if any(not isinstance(text, str) or not text for text in texts):
        return False
    if len(texts) == 1 and texts[0] == exact_visible_text:
        return True
    segments = exact_visible_text_segments(exact_visible_text)
    return all(segments) and texts == segments


def is_strict_revision_candidate(item: dict[str, Any] | None) -> bool:
    return bool(
        item
        and item.get("strict_review") is True
        and item.get("is_revision") is True
        and item.get("status") in {"changes_requested", "awaiting_user_approval"}
    )


def next_generation_target(
    queue: list[dict[str, Any]],
    generation_unlocking_statuses: set[str],
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


def is_stopped_layout_repair_takeover_target(
    state: dict[str, Any],
    item: dict[str, Any] | None,
    asset_id: str,
) -> bool:
    review = state.get("visual_asset_review", {})
    control = item.get("image_generation_attempt_control", {}) if item else {}
    return bool(
        item
        and item.get("status") == "pending_generation"
        and review.get("user_takeover_required") is True
        and review.get("user_takeover_asset_id") == asset_id
        and review.get("user_takeover_scope_id")
        == item.get("generation_attempt_scope_id")
        and review.get("current_asset_id") == asset_id
        and review.get("queue_generation_allowed") is False
        and control.get("automatic_retry_status")
        == "stopped_user_takeover_required"
        and control.get("rejected_generation_count") == 3
    )


def is_repairable_layout_target(
    state: dict[str, Any],
    item: dict[str, Any] | None,
    asset_id: str,
) -> bool:
    review = state.get("visual_asset_review", {})
    control = item.get("image_generation_attempt_control", {}) if item else {}
    disposition = item.get("ian_layout_repair_disposition", {}) if item else {}
    findings = item.get("image_generation_repairable_findings", []) if item else []
    return bool(
        item
        and item.get("status") == "pending_generation"
        and item.get("visual_generation_route") == "ian-handdrawn-ppt"
        and review.get("current_asset_id") == asset_id
        and review.get("queue_generation_allowed") is False
        and review.get("ian_layout_repair_required") is True
        and review.get("ian_layout_repair_asset_id") == asset_id
        and review.get("ian_layout_repair_scope_id")
        == item.get("generation_attempt_scope_id")
        and control.get("automatic_retry_status") == REPAIR_REQUIRED_STATUS
        and disposition.get("contract_version") == IAN_LAYOUT_REPAIR_DISPOSITION
        and disposition.get("status") == "repair_required"
        and disposition.get("generation_attempt_scope_id")
        == item.get("generation_attempt_scope_id")
        and isinstance(findings, list)
        and bool(findings)
        and disposition.get("source_finding") == findings[-1]
    )


def canonical_sha256(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


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


def generation_failure_projection(value: dict[str, Any]) -> dict[str, Any]:
    return {
        "attempt_number": value.get("attempt_number"),
        "prompt": value.get("prompt"),
        "output": value.get("output"),
        "failure_reason": value.get("failure_reason"),
    }


def layout_repair_override_artifacts(
    failures: list[dict[str, Any]],
) -> list[dict[str, str]]:
    artifacts: list[dict[str, str]] = []
    for failure in failures:
        for key in ("prompt", "output"):
            binding = failure.get(key)
            if not isinstance(binding, dict):
                raise ValueError("Ian layout-repair failure artifact binding is missing")
            normalized = {
                "path": binding.get("path"),
                "checksum_sha256": binding.get("checksum_sha256"),
            }
            checksum_bound_file(normalized, f"Ian layout-repair {key} artifact")
            artifacts.append(normalized)
    return artifacts


def consume_user_gate_override(
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
        raise ValueError("one-time user gate override validator returned an invalid record")
    return consumed


def consume_non_third_layout_repair_source_override(
    *,
    state: dict[str, Any],
    item: dict[str, Any],
    repair: dict[str, Any],
    exact_user_message: str | None,
    decided_at: str | None,
    transition_id: str | None,
    consumed_at: str | None,
) -> dict[str, Any] | None:
    failures = item.get("image_generation_qa_failures")
    if not isinstance(failures, list) or len(failures) != 3:
        raise ValueError("Ian layout-repair source override lacks three preserved failures")
    projections = [generation_failure_projection(failure) for failure in failures]
    source_failure = repair.get("source_failure")
    if source_failure == projections[-1]:
        return None
    if source_failure not in projections[:-1]:
        raise ValueError("Ian layout repair source is not one of the preserved failures")
    if not isinstance(exact_user_message, str) or not exact_user_message.strip():
        raise ValueError("Ian non-third layout-repair source requires an exact gate release")
    normalized_message = exact_user_message.lower()
    if (
        str(item.get("asset_id", "")).lower() not in normalized_message
        or not any(marker in normalized_message for marker in ("第二", "第2", "attempt 2"))
        or not any(marker in normalized_message for marker in ("第三", "第3", "attempt 3"))
        or "布局修复源" not in normalized_message
        or not any(marker in normalized_message for marker in ("放行", "接受", "允许"))
    ):
        raise ValueError(
            "Ian source override message must name the asset, second/third failure, layout-repair source gate, and one-time release"
        )
    if (
        not isinstance(transition_id, str)
        or not transition_id.strip()
        or transition_id in consumed_transition_ids(state)
    ):
        raise ValueError("Ian source override transition ID is missing or reused")
    episode_id = state.get("episode_id")
    generation_scope = item.get("generation_attempt_scope_id")
    if not isinstance(episode_id, str) or not episode_id.strip():
        raise ValueError("Ian source override episode id is missing")
    if not isinstance(generation_scope, str) or not generation_scope.strip():
        raise ValueError("Ian source override generation scope is missing")
    scope_id = f"{generation_scope}:ian-layout-repair-source-selection"
    gate_id = f"visual_asset.{item['asset_id']}.{IAN_STOPPED_LAYOUT_REPAIR_SOURCE_GATE}"
    artifacts = layout_repair_override_artifacts(failures)
    source_attempt = source_failure.get("attempt_number")
    required_attempt = projections[-1].get("attempt_number")
    pending = {
        "contract_version": "one-time-explicit-user-mechanical-gate-override-v1",
        "episode_id": episode_id,
        "scope_id": scope_id,
        "gate_ids": [gate_id],
        "acknowledged_failures": [
            {
                "gate_id": gate_id,
                "observed_result": "fail",
                "reason": (
                    "Selected Ian stopped-takeover layout-repair source is preserved "
                    f"attempt {source_attempt}; the default contract requires preserved "
                    f"attempt {required_attempt}."
                ),
            }
        ],
        "bound_artifacts": artifacts,
        "decision": {
            "exact_user_message": exact_user_message,
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
    pending["override_sha256"] = canonical_sha256(pending)
    return consume_user_gate_override(
        pending,
        episode_id=episode_id,
        scope_id=scope_id,
        gate_ids=[gate_id],
        artifacts=artifacts,
        transition_id=transition_id,
        consumed_at=consumed_at or "",
    )


def validate_layout_repair_evidence(
    *,
    manifest: dict[str, Any],
    validation: dict[str, Any],
    item: dict[str, Any],
    qa: dict[str, Any],
    exact_user_message: str | None,
    takeover_target: bool,
    allow_non_third_source: bool = False,
    repairable_target: bool = False,
) -> dict[str, Any] | None:
    repair = manifest.get("split_spec", {}).get("layout_repair")
    if repair is None:
        if exact_user_message is not None:
            raise ValueError("layout-repair user message was supplied without a repair")
        if takeover_target or repairable_target:
            raise ValueError("Ian layout-repair target requires an authorized layout repair")
        return None
    authorization = repair.get("authorization", {})
    if (
        repair.get("contract_version") != "ian-pre-split-layout-repair-v1"
        or authorization.get("asset_id") != item.get("asset_id")
        or not isinstance(exact_user_message, str)
        or not exact_user_message
        or authorization.get("exact_user_message") != exact_user_message
    ):
        raise ValueError("Ian layout repair lacks the exact user authorization")
    edge_pixels = validation.get("layout_repair_source_edge_visible_pixels")
    source_limit = repair.get("source_outside_union_max_visible_pixels")
    source_outside = validation.get(
        "layout_repair_source_outside_union_visible_pixels"
    )
    if (
        validation.get("deterministic_pre_split_layout_repair_match") is not True
        or not isinstance(source_outside, int)
        or not isinstance(source_limit, int)
        or source_outside > source_limit
        or not isinstance(edge_pixels, list)
        or len(edge_pixels) != len(repair.get("layers", []))
        or any(row.get("visible_pixels") != 0 for row in edge_pixels)
    ):
        raise ValueError("Ian layout repair replay or intact-source evidence is incomplete")
    if repairable_target:
        findings = item.get("image_generation_repairable_findings")
        disposition = item.get("ian_layout_repair_disposition", {})
        if (
            not isinstance(findings, list)
            or not findings
            or disposition.get("contract_version") != IAN_LAYOUT_REPAIR_DISPOSITION
            or disposition.get("status") != "repair_required"
            or disposition.get("source_finding") != findings[-1]
            or repair.get("source_failure")
            != generation_failure_projection(findings[-1])
        ):
            raise ValueError("Ian layout repair does not bind the repairable geometry finding")
        return repair
    if not takeover_target:
        return repair

    failures = item.get("image_generation_qa_failures")
    control = item.get("image_generation_attempt_control", {})
    if (
        not isinstance(failures, list)
        or len(failures) != 3
        or control.get("rejected_generation_count") != len(failures)
        or control.get("maximum_automatic_rejected_generations") != 3
    ):
        raise ValueError("Ian layout-repair takeover lacks the preserved three failures")
    expected_failure = generation_failure_projection(failures[-1])
    if (
        repair.get("source_failure") != expected_failure
        and not allow_non_third_source
    ):
        raise ValueError("Ian layout repair does not bind the third rejected generation")
    if repair.get("source_failure") not in [
        generation_failure_projection(failure) for failure in failures
    ]:
        raise ValueError("Ian layout repair source is not one of the preserved failures")
    if qa.get("rejected_attempts") != [failure.get("output") for failure in failures]:
        raise ValueError("Ian layout repair does not preserve every rejected output")
    return repair


def clear_active_takeover(review: dict[str, Any]) -> None:
    for key in (
        "user_takeover_required",
        "user_takeover_asset_id",
        "user_takeover_scope_id",
        "user_takeover_message",
    ):
        review.pop(key, None)


def clear_active_layout_repair(review: dict[str, Any]) -> None:
    for key in (
        "ian_layout_repair_required",
        "ian_layout_repair_asset_id",
        "ian_layout_repair_scope_id",
        "ian_layout_repair_message",
    ):
        review.pop(key, None)
    review["queue_generation_allowed"] = True


def mark_layout_repair_takeover_resolution(
    item: dict[str, Any],
    repair: dict[str, Any],
    resolved_at: str,
) -> None:
    control = item.get("image_generation_attempt_control", {})
    if control.get("automatic_retry_status") != "stopped_user_takeover_required":
        raise ValueError("Ian layout-repair takeover control is not stopped")
    control["automatic_retry_status"] = (
        "resolved_by_user_directed_deterministic_layout_repair_qa_pass"
    )
    control["resolution"] = (
        "user-directed-deterministic-layout-repair-passed-full-qa"
    )
    control["resolved_at"] = resolved_at
    item["user_takeover_disposition"] = {
        "contract_version": "ian-pre-split-layout-repair-takeover-v1",
        "exact_user_message": repair["authorization"]["exact_user_message"],
        "resolved_at": resolved_at,
        "source_failure": repair["source_failure"],
    }


def mark_repairable_layout_resolution(
    item: dict[str, Any],
    repair: dict[str, Any],
    resolved_at: str,
) -> None:
    control = item.get("image_generation_attempt_control", {})
    disposition = item.get("ian_layout_repair_disposition", {})
    if (
        control.get("automatic_retry_status") != REPAIR_REQUIRED_STATUS
        or disposition.get("contract_version") != IAN_LAYOUT_REPAIR_DISPOSITION
        or disposition.get("status") != "repair_required"
    ):
        raise ValueError("Ian repairable-layout disposition is not active")
    control["automatic_retry_status"] = (
        "resolved_by_deterministic_layout_repair_qa_pass"
    )
    control["resolution"] = "deterministic-layout-repair-passed-full-qa"
    control["resolved_at"] = resolved_at
    disposition.update(
        status="resolved_qa_pass",
        resolved_at=resolved_at,
        layout_repair=repair,
    )


def expected_reference_inputs(
    profile: dict[str, Any],
    revision_source: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    if revision_source is not None:
        raise ValueError(
            "Ian layered revisions may not use a prior flattened raster as a generation input"
        )
    if profile.get("style_anchor_path") != IAN_CANONICAL_STYLE_ANCHOR_PATH:
        raise ValueError("Ian layered scenes require the canonical Ian style anchor")
    if not SHA256_RE.fullmatch(str(profile.get("style_anchor_checksum_sha256", ""))):
        raise ValueError("Ian canonical style anchor checksum must be a SHA-256")
    style = {
        "role": "visual_style_reference_only",
        "path": profile["style_anchor_path"],
        "checksum_sha256": profile["style_anchor_checksum_sha256"],
    }
    return [style]


def validate_strict_revision_source(
    state: dict[str, Any],
    item: dict[str, Any],
    revision_source: dict[str, Any],
) -> None:
    checksum_bound_file(revision_source, "Ian strict revision source")
    prior_record = next(
        (
            record
            for record in reversed(state.get("superseded_artifacts", []))
            if record.get("record_type") == "superseded_visual_asset_batch"
            and item.get("asset_id") in record.get("asset_ids", [])
        ),
        None,
    )
    if not isinstance(prior_record, dict):
        raise ValueError("Ian strict revision lacks a superseded presented batch")


def pause_for_strict_revision(state: dict[str, Any], asset_id: str) -> None:
    review = state["visual_asset_review"]
    review["queue_generation_allowed"] = False
    review["current_asset_id"] = asset_id
    state["phase"] = "awaiting_visual_asset_review"
    state["current_phase"] = "awaiting_visual_asset_review"


def run_package_validator(episode_workspace: str, manifest_path: str) -> dict[str, Any]:
    result = subprocess.run(
        ["node", str(VALIDATOR_PATH), episode_workspace, manifest_path],
        cwd=REPOSITORY_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise ValueError(
            "Ian layered-scene package validation failed: "
            + (result.stderr.strip() or result.stdout.strip())
        )
    value = json.loads(result.stdout)
    observation = value.get("model_provenance_observation", {})
    if (
        value.get("result") != "pass"
        or observation
        != {
            "contract_version": "embedded-c2pa-software-agent-observation-v1",
            "evidence_kind": "observation-not-signature-verification",
            "software_agent_name": "gpt-image",
            "software_agent_version": "2.0",
        }
        or value.get("deterministic_master_normalization_match") is not True
        or value.get("deterministic_semantic_split_match") is not True
        or value.get("deterministic_text_overlay_match") is not True
        or value.get("deterministic_composite_match") is not True
    ):
        raise ValueError("Ian layered-scene package validation is incomplete")
    return value


def package_members(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    values = [
        {
            "member_role": "source-master",
            "layer_id": "source-master",
            **manifest["master_generation"]["source_master"],
        },
        {
            "member_role": "normalized-master",
            "layer_id": "normalized-master",
            **manifest["normalized_master"],
        },
        {"member_role": "background", "layer_id": "background", **manifest["background"]},
        *[
            {"member_role": "pre-text-layer", **layer}
            for layer in manifest["pre_text_layers"]
        ],
        *[
            {"member_role": "semantic-layer", **layer}
            for layer in manifest["layers"]
        ],
        {
            "member_role": "final-composite",
            "layer_id": "final-composite",
            **manifest["final_composite"],
        },
    ]
    return [
        {
            "member_role": value["member_role"],
            "layer_id": value["layer_id"],
            "path": value["path"],
            "checksum_sha256": value["checksum_sha256"],
            "width": value["width"],
            "height": value["height"],
            "has_alpha": value["has_alpha"],
        }
        for value in values
    ]


def validate_member_generation_lineage(
    lineage: Any,
    manifest: dict[str, Any],
    reference_inputs: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    master_generation = manifest.get("master_generation", {})
    source_master = master_generation.get("source_master", {})
    expected_output = {
        "path": source_master.get("path"),
        "checksum_sha256": source_master.get("checksum_sha256"),
    }
    expected_keys = {
        "stage",
        "generation_mode",
        "model_id",
        "prompt",
        "reference_inputs",
        "output",
        "selection_status",
    }
    if not isinstance(lineage, list) or len(lineage) != 1:
        raise ValueError("Ian generation lineage must contain exactly one complete master stage")
    stage = lineage[0]
    if not isinstance(stage, dict) or set(stage) != expected_keys:
        raise ValueError("Ian generation lineage must contain exactly one complete master stage")
    if (
        master_generation.get("contract_version")
        != "ian-gpt-image-2-text-free-master-v1"
        or master_generation.get("generator") != "codex-native-imagegen"
        or master_generation.get("model_id") != "gpt-image-2"
        or stage.get("stage") != "complete-master-generation"
        or stage.get("generation_mode")
        != "codex-native-imagegen-gpt-image-2-text-free-master-v1"
        or stage.get("model_id") != "gpt-image-2"
        or stage.get("prompt") != master_generation.get("prompt")
        or stage.get("reference_inputs") != reference_inputs
        or master_generation.get("reference_inputs") != reference_inputs
        or stage.get("output") != expected_output
        or stage.get("selection_status") != "selected"
    ):
        raise ValueError("Ian generation stage is not bound to the selected GPT Image 2 complete master")
    checksum_bound_file(stage["prompt"], "Ian complete-master generation prompt")
    checksum_bound_file(stage["output"], "Ian complete-master generation output")
    return lineage


def validate_layer_text_containment_evidence(
    containment: dict[str, Any],
    manifest_binding: dict[str, Any],
    manifest: dict[str, Any],
    exact_visible_text: str,
) -> None:
    overlay = manifest.get("text_overlay", {})
    labels = overlay.get("labels")
    final_composite = manifest.get("final_composite", {})
    final_projection = {
        "path": final_composite.get("path"),
        "checksum_sha256": final_composite.get("checksum_sha256"),
    }
    if (
        manifest.get("contract_version") != "ian-knowledge-video-layered-scene-v2"
        or overlay.get("contract_version") != "ian-deterministic-layer-text-overlay-v1"
        or overlay.get("mode") != "required"
        or not isinstance(labels, list)
        or not labels
        or containment.get("repair_mode") != "v2-deterministic-owning-layer-overlay"
        or containment.get("scene_package_manifest") != manifest_binding
        or containment.get("raster") != final_projection
    ):
        raise ValueError("Ian containment does not bind the v2 final composite and owning layers")
    if not labels_reproduce_exact_visible_text(labels, exact_visible_text):
        raise ValueError("Ian containment labels do not equal the approved visible text")
    layer_ids = {layer.get("layer_id") for layer in manifest.get("layers", [])}
    if any(label.get("layer_id") not in layer_ids for label in labels):
        raise ValueError("Ian containment label is not bound to an owning layer")
    expected_overlays = [
        {
            "layer_id": label["layer_id"],
            "text": label["text"],
            "container_bbox": label["container_bbox"],
        }
        for label in labels
    ]
    if containment.get("layer_overlays") != expected_overlays:
        raise ValueError("Ian containment owning layer overlays are stale")
    regions = containment.get("inspection", {}).get("regions")
    if not isinstance(regions, list) or len(regions) != len(labels):
        raise ValueError("Ian containment regions do not equal the deterministic labels")
    for label, region in zip(labels, regions, strict=True):
        if (
            region.get("layer_id") != label["layer_id"]
            or region.get("text") != label["text"]
            or region.get("container_bbox") != label["container_bbox"]
            or region.get("min_inset_px") != overlay.get("minimum_inset_px")
            or region.get("result") != "pass"
        ):
            raise ValueError("Ian containment region is not bound to its owning layer")


def record(args: argparse.Namespace) -> dict[str, Any]:
    workspace = (REPOSITORY_ROOT / args.episode_workspace).resolve(strict=True)
    workspace.relative_to(REPOSITORY_ROOT)
    state_file = workspace / "schema/episode-state.json"
    state = json.loads(state_file.read_text(encoding="utf-8"))
    gate = load_module(GATE_PATH, "visual_approval_gate")
    review = state.get("visual_asset_review", {})
    one_click = review.get("mode") == "one_click_final_review_v1"
    candidate = next(
        (
            queued
            for queued in review.get("queue", [])
            if queued.get("asset_id") == args.asset_id
        ),
        None,
    )
    strict_revision = is_strict_revision_candidate(candidate) and not one_click
    takeover_target = is_stopped_layout_repair_takeover_target(
        state,
        candidate,
        args.asset_id,
    )
    repairable_target = is_repairable_layout_target(
        state,
        candidate,
        args.asset_id,
    )
    if strict_revision:
        if review.get("current_asset_id") != args.asset_id:
            raise ValueError("strict revision is not the current visual asset")
        item = candidate
    elif takeover_target or repairable_target:
        item = candidate
    else:
        item = gate.require_generation_allowed(state, args.asset_id)
    if item.get("visual_generation_route") != "ian-handdrawn-ppt":
        raise ValueError("asset is not an Ian layered scene")

    qa_file = resolve_root_relative(args.qa_path, "QA evidence path")
    qa = json.loads(qa_file.read_text(encoding="utf-8"))
    if (
        qa.get("contract_version") != "ian-layered-scene-qa-v2"
        or qa.get("result") != "pass"
        or qa.get("asset_id") != args.asset_id
        or qa.get("generator") != "codex-native-imagegen"
        or qa.get("style_profile", {}).get("id") != item.get("treatment_profile_id")
        or not isinstance(qa.get("actual_reference_inputs"), list)
        or not isinstance(qa.get("generation_lineage"), list)
    ):
        raise ValueError("Ian layered-scene QA evidence is incomplete")

    manifest_file = checksum_bound_file(
        qa["scene_package_manifest"], "Ian layered-scene manifest"
    )
    manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    validation = run_package_validator(
        args.episode_workspace, qa["scene_package_manifest"]["path"]
    )
    expected_visible_text = (
        [] if item.get("visible_text_mode") == "none" else [item.get("exact_visible_text")]
    )
    expected_direction = {
        "path": item.get("visual_direction_review_path"),
        "checksum_sha256": item.get("visual_direction_review_checksum_sha256"),
        "presented_map_sha256": item.get("visual_direction_presented_map_sha256"),
    }
    text_overlay = manifest.get("text_overlay", {})
    overlay_labels = text_overlay.get("labels", [])
    expected_text_mode = item.get("visible_text_mode")
    expected_overlay_text = (
        "" if expected_text_mode == "none" else item.get("exact_visible_text")
    )
    if (
        manifest.get("contract_version") != "ian-knowledge-video-layered-scene-v2"
        or manifest.get("episode_workspace") != args.episode_workspace
        or manifest.get("queue_item_id") != args.asset_id
        or manifest.get("shot_id") != item.get("shot_id")
        or manifest.get("treatment_profile_id") != item.get("treatment_profile_id")
        or manifest.get("narration_source_text") != item.get("narration_source_text")
        or manifest.get("timing", {}).get("shot_start_frame")
        != item.get("shot_start_frame")
        or manifest.get("timing", {}).get("shot_end_frame") != item.get("shot_end_frame")
        or manifest.get("storyboard_binding")
        != {
            "path": item.get("storyboard_path"),
            "checksum_sha256": item.get("storyboard_checksum_sha256"),
        }
        or manifest.get("visual_direction_review") != expected_direction
        or manifest.get("scene_plan") != item.get("ian_scene_plan")
        or manifest.get("scene_plan_sha256") != item.get("ian_scene_plan_sha256")
        or text_overlay.get("mode") != expected_text_mode
        or (
            expected_text_mode == "required"
            and not labels_reproduce_exact_visible_text(
                overlay_labels,
                expected_overlay_text,
            )
        )
        or (expected_text_mode == "none" and overlay_labels != [])
        or manifest.get("verified_visible_text") != expected_visible_text
        or validation.get("member_count") != 4 + (2 * len(manifest.get("layers", [])))
    ):
        raise ValueError("Ian layered-scene manifest does not match the queue item")
    repair_value = manifest.get("split_spec", {}).get("layout_repair")
    source_selection_override = None
    if takeover_target and isinstance(repair_value, dict):
        source_selection_override = consume_non_third_layout_repair_source_override(
            state=state,
            item=item,
            repair=repair_value,
            exact_user_message=getattr(args, "layout_repair_user_message", None),
            decided_at=getattr(args, "layout_repair_source_override_decided_at", None),
            transition_id=getattr(args, "layout_repair_source_override_transition_id", None),
            consumed_at=getattr(args, "layout_repair_source_override_consumed_at", None),
        )
    layout_repair = validate_layout_repair_evidence(
        manifest=manifest,
        validation=validation,
        item=item,
        qa=qa,
        exact_user_message=getattr(args, "layout_repair_user_message", None),
        takeover_target=takeover_target,
        allow_non_third_source=source_selection_override is not None,
        repairable_target=repairable_target,
    )

    if qa.get("prompt") != manifest.get("master_generation", {}).get("prompt"):
        raise ValueError("production prompt is not the selected complete-master prompt")
    prompt_file = checksum_bound_file(qa["prompt"], "production prompt")
    prompt_text = prompt_file.read_text(encoding="utf-8")
    if "16:9 landscape composition" not in prompt_text:
        raise ValueError("production prompt lacks exact 16:9 phrase")
    normalized_prompt = prompt_text.lower()
    if not any(
        phrase in normalized_prompt
        for phrase in ("no visible text", "text: none", "no written characters")
    ):
        raise ValueError("production prompt lacks an explicit text-free master phrase")
    for label in expected_visible_text:
        for segment in exact_visible_text_segments(label):
            if segment and segment in prompt_text:
                raise ValueError("text-free complete-master prompt includes approved visible text")

    profile = qa["style_profile"]
    skill_file = resolve_root_relative(profile.get("skill_path", ""), "Ian skill path")
    anchor_file = resolve_root_relative(
        profile.get("style_anchor_path", ""), "Ian style anchor path"
    )
    if (
        sha256_file(skill_file) != profile.get("skill_checksum_sha256")
        or sha256_file(anchor_file) != profile.get("style_anchor_checksum_sha256")
    ):
        raise ValueError("pinned Ian style checksum is stale")
    if qa.get("revision_source") is not None:
        raise ValueError("Ian layered QA may not reference a prior flattened raster")
    expected_references = expected_reference_inputs(profile)
    if (
        qa["actual_reference_inputs"] != expected_references
        or manifest.get("master_generation", {}).get("reference_inputs")
        != expected_references
    ):
        raise ValueError("Ian generation must bind the exact style anchor")
    generation_lineage = validate_member_generation_lineage(
        qa["generation_lineage"],
        manifest,
        expected_references,
    )
    for index, rejected in enumerate(qa.get("rejected_attempts", [])):
        checksum_bound_file(rejected, f"Ian rejected attempt {index}")

    for check in ("semantic_qa", "visible_text_qa", "style_qa", "visual_qa"):
        if qa.get(check, {}).get("result") != "pass":
            raise ValueError(f"{check} did not pass")
    observed = qa["visible_text_qa"].get("observed_exact_text")
    if (
        observed != expected_visible_text
        or qa["visible_text_qa"].get("no_other_visible_text") is not True
        or qa["style_qa"].get("style_anchor_match") is not True
    ):
        raise ValueError("Ian visible-text or style QA is incomplete")
    if expected_visible_text:
        containment_file = checksum_bound_file(
            qa.get("text_container_qa", {}), "Ian text-container QA evidence"
        )
        containment = json.loads(containment_file.read_text(encoding="utf-8"))
        if (
            containment.get("contract_version") != "ian-text-container-qa-evidence-v1"
            or containment.get("result") != "pass"
            or containment.get("asset_id") != args.asset_id
            or containment.get("raster")
            != {
                "path": manifest["final_composite"]["path"],
                "checksum_sha256": manifest["final_composite"]["checksum_sha256"],
            }
        ):
            raise ValueError("Ian text-container QA is not bound to the final composite")
        validate_layer_text_containment_evidence(
            containment,
            qa["scene_package_manifest"],
            manifest,
            item["exact_visible_text"],
        )
    elif qa.get("text_container_qa") is not None:
        raise ValueError("text-free Ian scenes may not carry containment evidence")

    members = package_members(manifest)
    final_composite = manifest["final_composite"]
    item.update(
        status="awaiting_user_approval" if strict_revision else "awaiting_batch_qa",
        generator=qa["generator"],
        path=final_composite["path"],
        checksum_sha256=final_composite["checksum_sha256"],
        measured_dimensions=[1920, 1080],
        measured_aspect_ratio_relative_error=0,
        prompt_path=qa["prompt"]["path"],
        prompt_checksum_sha256=qa["prompt"]["checksum_sha256"],
        style_profile_id=profile["id"],
        style_skill_path=profile["skill_path"],
        style_skill_checksum_sha256=profile["skill_checksum_sha256"],
        style_anchor_path=profile["style_anchor_path"],
        style_anchor_checksum_sha256=profile["style_anchor_checksum_sha256"],
        actual_reference_inputs=qa["actual_reference_inputs"],
        generation_lineage=generation_lineage,
        model_id=manifest["master_generation"]["model_id"],
        model_provenance=manifest["model_provenance"],
        model_provenance_observation=validation["model_provenance_observation"],
        rejected_attempts=qa.get("rejected_attempts", []),
        scene_package_manifest_path=qa["scene_package_manifest"]["path"],
        scene_package_manifest_checksum_sha256=qa["scene_package_manifest"][
            "checksum_sha256"
        ],
        ian_scene_plan_sha256=manifest["scene_plan_sha256"],
        ian_scene_package_members=members,
        state_visible_text=item.get("exact_visible_text"),
        qa_evidence_path=args.qa_path,
        qa_evidence_checksum_sha256=sha256_file(qa_file),
        qa_contract_version="ian-layered-scene-qa-v2",
        technical_qa={
            "result": "pass",
            "rule_id": "ian-knowledge-video-layered-scene-v2",
            "measured_dimensions": [1920, 1080],
            "layer_count": len(manifest["layers"]),
            "model_provenance_observation": validation[
                "model_provenance_observation"
            ],
            "deterministic_master_normalization_match": validation[
                "deterministic_master_normalization_match"
            ],
            "deterministic_pre_split_layout_repair_match": validation[
                "deterministic_pre_split_layout_repair_match"
            ],
            "deterministic_semantic_split_match": validation[
                "deterministic_semantic_split_match"
            ],
            "deterministic_text_overlay_match": validation[
                "deterministic_text_overlay_match"
            ],
            "deterministic_composite_match": validation[
                "deterministic_composite_match"
            ],
            "layout_repair_source_outside_union_visible_pixels": validation[
                "layout_repair_source_outside_union_visible_pixels"
            ],
            "layout_repair_source_edge_visible_pixels": validation[
                "layout_repair_source_edge_visible_pixels"
            ],
        },
        semantic_qa=qa["semantic_qa"],
        visible_text_qa=qa["visible_text_qa"],
        style_qa=qa["style_qa"],
        visual_qa=qa["visual_qa"],
    )
    if expected_visible_text:
        item["text_container_qa"] = qa["text_container_qa"]
    package_review = gate._require_ian_layered_scene_package(item, REPOSITORY_ROOT)
    if package_review is None:
        raise ValueError("Ian layered-scene package review could not be built")
    if strict_revision:
        item.update(
            presented_checksum_sha256=final_composite["checksum_sha256"],
            presented_ian_layered_scene_package=package_review,
            presented_at=args.qa_time,
            exact_presentation_message=(
                f"现呈交 {item['asset_id']} 分层场景包及确定性合成预览，"
                "等待用户明确批准此精确包。"
            ),
        )
        pause_for_strict_revision(state, args.asset_id)
    else:
        if takeover_target:
            mark_layout_repair_takeover_resolution(item, layout_repair, args.qa_time)
            matching_blockers = [
                blocker
                for blocker in state.get("blockers", [])
                if blocker.get("asset_id") == item.get("asset_id")
                and blocker.get("generation_attempt_scope_id")
                == item.get("generation_attempt_scope_id")
                and blocker.get("contract_version")
                == "storyboard-image-generation-attempt-limit-v1"
            ]
            if len(matching_blockers) != 1:
                raise ValueError("Ian layout-repair takeover blocker is missing or ambiguous")
            matching_blockers[0].update(
                status=(
                    "resolved_by_user_directed_deterministic_layout_repair_qa_pass"
                ),
                resolution="user-directed-deterministic-layout-repair-passed-full-qa",
                resolved_at=args.qa_time,
            )
            if source_selection_override is not None:
                failures = item["image_generation_qa_failures"]
                source_selection = {
                    "contract_version": (
                        "ian-stopped-layout-repair-source-selection-v1"
                    ),
                    "result": "pass_with_user_override",
                    "selected_source_failure": layout_repair["source_failure"],
                    "default_required_source_failure": (
                        generation_failure_projection(failures[-1])
                    ),
                    "user_mechanical_gate_override": source_selection_override,
                }
                item["ian_layout_repair_source_selection"] = source_selection
                item["user_takeover_disposition"].update(
                    source_selection_result="pass_with_user_override",
                    source_selection_override_sha256=source_selection_override[
                        "override_sha256"
                    ],
                )
                matching_blockers[0].update(
                    layout_repair_source_selection_result="pass_with_user_override",
                    layout_repair_source_override_sha256=source_selection_override[
                        "override_sha256"
                    ],
                )
        if repairable_target:
            mark_repairable_layout_resolution(item, layout_repair, args.qa_time)
            clear_active_layout_repair(review)
        gate.record_hybrid_qa_pass(state, args.asset_id, args.qa_time)
        if takeover_target:
            clear_active_takeover(review)
        next_item = next_generation_target(
            state["visual_asset_review"]["queue"],
            gate.GENERATION_UNLOCKING_STATUSES,
        )
        state["visual_asset_review"]["current_asset_id"] = (
            next_item.get("asset_id") if next_item else None
        )

    temporary = state_file.with_suffix(".json.ian-layered-qa.tmp")
    if temporary.exists():
        raise ValueError("Ian layered QA temporary path already exists")
    temporary.write_text(
        json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    temporary.replace(state_file)
    return {
        "result": (
            "pass_with_user_override"
            if source_selection_override is not None
            else "pass"
        ),
        "asset_id": args.asset_id,
        "status": item["status"],
        "package_manifest_checksum_sha256": item[
            "scene_package_manifest_checksum_sha256"
        ],
        "final_composite_checksum_sha256": item["checksum_sha256"],
        "layer_count": len(manifest["layers"]),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("episode_workspace")
    parser.add_argument("asset_id")
    parser.add_argument("qa_path")
    parser.add_argument("qa_time")
    parser.add_argument("--layout-repair-user-message")
    parser.add_argument("--layout-repair-source-override-decided-at")
    parser.add_argument("--layout-repair-source-override-transition-id")
    parser.add_argument("--layout-repair-source-override-consumed-at")
    args = parser.parse_args()
    if not re.fullmatch(
        r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}", args.qa_time
    ):
        raise SystemExit("qa_time must be ISO-8601 with offset")
    print(json.dumps(record(args), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
