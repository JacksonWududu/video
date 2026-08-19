#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import re


REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
HELPER_PATH = Path(__file__).resolve().with_name("record-generated-imagegen-strict.py")


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
    return (
        isinstance(state_index, int)
        and isinstance(state_count_total, int)
        and 1 <= state_index < state_count_total
        and item.get("role") == f"action-{state_index:02d}"
    )


def record(args: argparse.Namespace) -> dict:
    helper = load_helpers()
    workspace = (REPOSITORY_ROOT / args.episode_workspace).resolve(strict=True)
    workspace.relative_to(REPOSITORY_ROOT.resolve())
    state_file = workspace / "schema/episode-state.json"
    state = json.loads(state_file.read_text(encoding="utf-8"))
    gate = helper.load_gate()
    review = state.get("visual_asset_review", {})
    candidate = next(
        (queued for queued in review.get("queue", []) if queued.get("asset_id") == args.asset_id),
        None,
    )
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
    if is_strict_revision:
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
    if (
        item.get("visual_generation_route") != "imagegen"
        or (item.get("strict_review") is not False and not is_strict_revision)
        or item.get("white_cat_present") is not True
        or item.get("visible_text_mode") != "none"
        or not is_action_variant(item)
        or len(item.get("depends_on", [])) != 1
    ):
        raise ValueError("asset is not a normal ordinary-imagegen white-cat action state")

    qa_file = helper.resolve_path(args.qa_path, "QA evidence path")
    qa = json.loads(qa_file.read_text(encoding="utf-8"))
    if (
        qa.get("contract_version") != "ordinary-imagegen-white-cat-action-qa-v1"
        or qa.get("result") != "pass"
        or qa.get("asset_id") != args.asset_id
        or qa.get("generator") != "codex-native-imagegen"
        or qa.get("style_profile", {}).get("id") != item.get("treatment_profile_id")
        or not isinstance(qa.get("actual_reference_inputs"), list)
        or len(qa["actual_reference_inputs"]) not in {2, 3}
        or not isinstance(qa.get("generation_lineage"), list)
        or len(qa["generation_lineage"]) < 1
    ):
        raise ValueError("ordinary ImageGen action QA evidence is incomplete")

    prompt = helper.checksum_bound_file(qa["selected_prompt"], "selected prompt")
    prompt_text = prompt.read_text(encoding="utf-8")
    if "16:9 landscape composition" not in prompt_text or "VISIBLE-TEXT MODE: none." not in prompt_text:
        raise ValueError("production prompt lacks exact 16:9 or text-free instruction")

    source = helper.checksum_bound_file(qa["selected_source"], "selected source")
    dimensions = helper.png_dimensions(source)
    if list(dimensions) != qa["selected_source"].get("dimensions") or dimensions[0] <= dimensions[1]:
        raise ValueError("selected source dimensions are stale or non-landscape")
    relative_error = abs((dimensions[0] / dimensions[1]) / (16 / 9) - 1)
    if relative_error > 0.005 or abs(relative_error - qa["selected_source"].get("relative_aspect_ratio_error", 1)) > 1e-12:
        raise ValueError("selected source is outside the 16:9 tolerance")

    master_binding = qa["approved_master"]
    master = next(
        (candidate for candidate in state["visual_asset_review"]["queue"] if candidate.get("asset_id") == item["depends_on"][0]),
        None,
    )
    master_file = helper.checksum_bound_file(master_binding, "approved master")
    if (
        master is None
        or master.get("status") != "approved"
        or master_binding.get("asset_id") != master.get("asset_id")
        or master_binding.get("path") != master.get("path")
        or master_binding.get("checksum_sha256") != master.get("approved_checksum_sha256")
        or helper.sha256_file(master_file) != master.get("approved_checksum_sha256")
    ):
        raise ValueError("action source is not the exact approved master")

    profile = qa["style_profile"]
    authority = helper.resolve_path(profile.get("authority_path", ""), "style authority")
    if helper.sha256_file(authority) != profile.get("authority_checksum_sha256") or profile.get("medium_id") != "loose-line-vivid-watercolor":
        raise ValueError("ordinary ImageGen style authority is stale")
    character = qa["character_reference"]
    primary = helper.resolve_path(character.get("primary_path", ""), "canonical identity reference")
    bible = helper.resolve_path(character.get("bible_path", ""), "character bible")
    if (
        character.get("version") != "white-cat-v2"
        or helper.sha256_file(primary) != character.get("primary_checksum_sha256")
        or helper.sha256_file(bible) != character.get("bible_checksum_sha256")
    ):
        raise ValueError("canonical white-cat binding is stale")

    expected_references = [
        {
            "role": "edit_target_approved_master",
            "path": master_binding["path"],
            "checksum_sha256": master_binding["checksum_sha256"],
        },
        {
            "role": "primary_canonical_identity_reference",
            "path": character["primary_path"],
            "checksum_sha256": character["primary_checksum_sha256"],
        },
    ]
    if len(qa["actual_reference_inputs"]) == 3:
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

    for check in ("semantic_qa", "identity_qa", "visible_text_qa", "style_qa", "continuity_qa", "visual_qa"):
        if qa.get(check, {}).get("result") != "pass":
            raise ValueError(f"{check} did not pass")
    identity = qa["identity_qa"]
    if (
        identity.get("cat_count") != 1
        or identity.get("foreleg_count") != 2
        or identity.get("hindleg_count") != 2
        or identity.get("paw_count") != 4
        or identity.get("accessory_geometry_correct") is not True
    ):
        raise ValueError("white-cat P0 identity QA is incomplete")
    visible = qa["visible_text_qa"]
    if visible.get("no_visible_text") is not True or visible.get("no_pseudotext") is not True:
        raise ValueError("white-cat text-free QA is incomplete")
    if qa["continuity_qa"].get("derived_directly_from_approved_master") is not True:
        raise ValueError("white-cat action continuity QA is incomplete")

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
        character_reference_version=character["version"],
        character_reference_path=character["primary_path"],
        character_reference_checksum_sha256=character["primary_checksum_sha256"],
        character_bible_path=character["bible_path"],
        character_bible_checksum_sha256=character["bible_checksum_sha256"],
        actual_reference_inputs=qa["actual_reference_inputs"],
        generation_lineage=qa["generation_lineage"],
        rejected_attempts=qa.get("rejected_attempts", []),
        qa_evidence_path=args.qa_path,
        qa_evidence_checksum_sha256=helper.sha256_file(qa_file),
        technical_qa={"result": "pass", "rule_id": "ordinary-imagegen-source-v1", "measured_dimensions": list(dimensions)},
        semantic_qa=qa["semantic_qa"],
        identity_qa=qa["identity_qa"],
        visible_text_qa=qa["visible_text_qa"],
        style_qa=qa["style_qa"],
        continuity_qa=qa["continuity_qa"],
        visual_qa=qa["visual_qa"],
    )
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
    else:
        gate.record_hybrid_qa_pass(state, args.asset_id, args.qa_time)
        active = [
            candidate for candidate in state["visual_asset_review"]["queue"]
            if candidate.get("active_for_current_storyboard") is not False and candidate.get("status") != "superseded"
        ]
        next_item = next(
            (candidate for candidate in active if candidate.get("status") not in {"approved", "qa_passed_pending_batch_review"}),
            None,
        )
        state["visual_asset_review"]["current_asset_id"] = next_item.get("asset_id") if next_item else None
    temporary = state_file.with_suffix(".json.imagegen-hybrid-qa.tmp")
    if temporary.exists():
        raise ValueError("ordinary ImageGen hybrid QA temporary path already exists")
    temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(state_file)
    return {
        "result": "pass",
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
    args = parser.parse_args()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}", args.qa_time):
        raise SystemExit("qa_time must be ISO-8601 with offset")
    print(json.dumps(record(args), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
