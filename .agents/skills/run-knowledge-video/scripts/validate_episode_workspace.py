from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import stat
import sys
from pathlib import Path
from typing import Any


REQUIRED_TOP = {"assets", "script", "schema", "docs"}
REQUIRED_ASSETS = {"audio", "image", "narration", "video"}
EXTENSION_CATEGORIES = {
    ".json": ("schema",),
    ".js": ("script",),
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
}
WHITE_CAT_IMAGEGEN_QA_CONTRACTS = {
    "base/master": "ordinary-imagegen-white-cat-master-qa-v2",
    "action": "ordinary-imagegen-white-cat-action-qa-v2",
}
WHITE_CAT_XUAN_QA_CONTRACTS = {
    "base/master": "xuan-paper-diorama-asset-qa-v1",
    "action": "xuan-paper-diorama-action-qa-v1",
}
WHITE_CAT_ANATOMY_QA_CONTRACT = "white-cat-anatomy-qa-v2"
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


def _validate_pending_white_cat_qa(
    repo: Path,
    item: dict[str, Any],
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
    if qa.get("result") != "pass":
        errors.append(f"White-cat asset {asset_id!r} top-level QA must pass")
    if qa.get("asset_id") != asset_id:
        errors.append(f"White-cat asset {asset_id!r} QA asset_id is stale")

    identity = qa.get("identity_qa")
    if not isinstance(identity, dict) or identity.get("result") != "pass":
        errors.append(f"White-cat asset {asset_id!r} identity_qa must pass")
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
    if anatomy.get("result") != "pass":
        errors.append(f"White-cat asset {asset_id!r} anatomy QA must pass")
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
    return errors


def _validate_approved_white_cat_history(
    repo: Path,
    item: dict[str, Any],
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
    if qa.get("result") != "pass" or qa.get("asset_id") != asset_id:
        errors.append(f"Approved historical white-cat asset {asset_id!r} QA identity is stale")
    recorded_contract = item.get("qa_contract_version")
    if recorded_contract is not None and recorded_contract != contract:
        errors.append(f"Approved historical white-cat asset {asset_id!r} state QA contract is stale")
    if contract in {
        "ordinary-imagegen-white-cat-master-qa-v2",
        "ordinary-imagegen-white-cat-action-qa-v2",
    } or (route == "xuan-paper-diorama" and recorded_contract is not None):
        errors.extend(_validate_pending_white_cat_qa(repo, item))
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
            errors.extend(_validate_pending_white_cat_qa(repo, item))
        elif item.get("status") == "approved":
            errors.extend(_validate_approved_white_cat_history(repo, item))
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
            or item.get("visual_generation_route") != "ian-handdrawn-ppt"
        ):
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

    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            errors.append(f"Visible-text row {index} must be a JSON object")
            continue
        shot_id = row.get("shot_id", index)
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
