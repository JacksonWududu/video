#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import struct
from typing import Any


REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
GATE_PATH = REPOSITORY_ROOT / ".agents/skills/run-knowledge-video/scripts/validate_visual_approval_state.py"
IAN_VALIDATOR_PATH = REPOSITORY_ROOT / ".agents/skills/ian-handdrawn-ppt/scripts/validate_knowledge_video_frame.py"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


def sha256_file(file: Path) -> str:
    digest = hashlib.sha256()
    with file.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_root_relative(value: str, label: str) -> Path:
    candidate = Path(value)
    if candidate.is_absolute() or not value:
        raise ValueError(f"{label} must be root-relative")
    resolved = (REPOSITORY_ROOT / candidate).resolve(strict=True)
    resolved.relative_to(REPOSITORY_ROOT.resolve())
    if candidate.is_symlink() or resolved.is_symlink():
        raise ValueError(f"{label} must not be a symlink")
    return resolved


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ValueError(f"cannot load {name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def checksum_bound_file(binding: dict[str, Any], label: str) -> Path:
    if not isinstance(binding, dict) or not SHA256_RE.fullmatch(str(binding.get("checksum_sha256", ""))):
        raise ValueError(f"{label} binding is invalid")
    file = resolve_root_relative(binding.get("path", ""), f"{label} path")
    if sha256_file(file) != binding["checksum_sha256"]:
        raise ValueError(f"{label} checksum is stale")
    return file


def png_dimensions(file: Path) -> tuple[int, int]:
    header = file.read_bytes()[:24]
    if len(header) != 24 or header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        raise ValueError(f"not a decodable PNG: {file}")
    return struct.unpack(">II", header[16:24])


def is_strict_revision_candidate(item: dict[str, Any] | None) -> bool:
    return bool(
        item
        and item.get("strict_review") is True
        and item.get("is_revision") is True
        and item.get("status") in {"changes_requested", "awaiting_user_approval"}
    )


def expected_reference_inputs(
    profile: dict[str, Any],
    revision_source: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    style = {
        "role": "visual_style_reference_only",
        "path": profile["style_anchor_path"],
        "checksum_sha256": profile["style_anchor_checksum_sha256"],
    }
    if revision_source is None:
        return [style]
    return [
        {
            "role": "edit_target_prior_presented_raster",
            "path": revision_source["path"],
            "checksum_sha256": revision_source["checksum_sha256"],
        },
        style,
    ]


def validate_text_container_evidence(
    evidence: dict[str, Any], *, asset_id: str,
    exact_visible_text: str, generated_source: dict[str, Any],
) -> None:
    if (
        not isinstance(evidence, dict)
        or evidence.get("contract_version") != "ian-text-container-qa-evidence-v1"
        or evidence.get("result") != "pass"
        or evidence.get("asset_id") != asset_id
        or evidence.get("raster") != generated_source
    ):
        raise ValueError("Ian text-container QA binding is stale or incomplete")
    regions = evidence.get("inspection", {}).get("regions")
    expected_labels = exact_visible_text.split("｜")
    if (
        not isinstance(regions, list)
        or [region.get("text") for region in regions if isinstance(region, dict)]
        != expected_labels
        or any(region.get("result") != "pass" for region in regions)
    ):
        raise ValueError("Ian text-container QA must cover the complete exact label list")


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
    manifest_file = resolve_root_relative(
        prior_record.get("prior_manifest_path", ""),
        "superseded Ian batch manifest",
    )
    if sha256_file(manifest_file) != prior_record.get("prior_manifest_file_checksum_sha256"):
        raise ValueError("superseded Ian batch manifest checksum is stale")
    manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    prior_asset = next(
        (
            asset
            for asset in manifest.get("review_assets", [])
            if asset.get("asset_id") == item.get("asset_id")
        ),
        None,
    )
    if (
        manifest.get("manifest_sha256") != prior_record.get("prior_manifest_sha256")
        or not isinstance(prior_asset, dict)
        or prior_asset.get("checksum_sha256") != revision_source.get("checksum_sha256")
    ):
        raise ValueError("Ian strict revision source is not the prior presented raster")


def pause_for_strict_revision(state: dict[str, Any], asset_id: str) -> None:
    review = state["visual_asset_review"]
    review["queue_generation_allowed"] = False
    review["current_asset_id"] = asset_id
    state["phase"] = "awaiting_visual_asset_review"
    state["current_phase"] = "awaiting_visual_asset_review"


def record(args: argparse.Namespace) -> dict[str, Any]:
    raise ValueError(
        "record-generated-ian-hybrid-qa.py is completed-history read-only; "
        "unfinished and new Ian shots must use record-generated-ian-layered-scene-qa.py"
    )

    # Historical implementation retained below for byte-level forensic reference only.
    workspace = resolve_root_relative(args.episode_workspace, "episode workspace")
    state_file = workspace / "schema/episode-state.json"
    state = json.loads(state_file.read_text(encoding="utf-8"))
    gate = load_module(GATE_PATH, "visual_approval_gate")
    review = state.get("visual_asset_review", {})
    one_click = review.get("mode") == "one_click_final_review_v1"
    candidate = next(
        (queued for queued in review.get("queue", []) if queued.get("asset_id") == args.asset_id),
        None,
    )
    is_strict_revision = is_strict_revision_candidate(candidate) and not one_click
    if is_strict_revision:
        if review.get("current_asset_id") != args.asset_id:
            raise ValueError("strict revision is not the current visual asset")
        if candidate.get("status") == "changes_requested" and review.get("queue_generation_allowed") is False:
            raise ValueError("visual review queue is paused")
        if candidate.get("status") == "awaiting_user_approval" and review.get("queue_generation_allowed") is not False:
            raise ValueError("strict replacement requires a paused approval boundary")
        item = candidate
    else:
        item = gate.require_generation_allowed(state, args.asset_id)
    if (
        item.get("visual_generation_route") != "ian-handdrawn-ppt"
        or (item.get("strict_review") is not False and not is_strict_revision and not one_click)
    ):
        raise ValueError("asset is not an Ian knowledge-video frame")

    qa_file = resolve_root_relative(args.qa_path, "QA evidence path")
    qa = json.loads(qa_file.read_text(encoding="utf-8"))
    qa_contract_version = qa.get("contract_version")
    if (
        qa_contract_version not in {
            "ian-knowledge-video-frame-qa-v1",
            "ian-knowledge-video-frame-qa-v2",
        }
        or qa.get("result") != "pass"
        or qa.get("asset_id") != args.asset_id
        or qa.get("generator") != "codex-native-imagegen"
        or qa.get("style_profile", {}).get("id") != item.get("treatment_profile_id")
        or not isinstance(qa.get("actual_reference_inputs"), list)
    ):
        raise ValueError("Ian QA evidence is incomplete")

    manifest_file = checksum_bound_file(qa["frame_manifest"], "Ian frame manifest")
    manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    ian = load_module(IAN_VALIDATOR_PATH, "ian_knowledge_video_frame")
    validation = ian.validate_manifest(manifest, episode_workspace=workspace, repo_root=REPOSITORY_ROOT)
    if (
        validation.get("result") != "pass"
        or manifest.get("queue_item_id") != args.asset_id
        or manifest.get("shot_id") != item.get("shot_id")
        or manifest.get("treatment_profile_id") != item.get("treatment_profile_id")
        or manifest.get("exact_visible_text") != item.get("exact_visible_text")
        or manifest.get("visible_text_placement") != item.get("visible_text_placement")
    ):
        raise ValueError("Ian frame manifest does not match the queue item")

    prompt_file = checksum_bound_file(qa["prompt"], "production prompt")
    prompt_text = prompt_file.read_text(encoding="utf-8")
    if "16:9 landscape composition" not in prompt_text:
        raise ValueError("production prompt lacks exact 16:9 phrase")
    for label in item["exact_visible_text"].split("｜"):
        if label not in prompt_text:
            raise ValueError("production prompt omits approved visible text")

    normalization_file = checksum_bound_file(qa["normalization_evidence"], "normalization evidence")
    normalization = json.loads(normalization_file.read_text(encoding="utf-8"))
    source_file = checksum_bound_file(normalization["source"], "generated source")
    normalized_file = checksum_bound_file(normalization["normalized"], "normalized raster")
    if tuple(normalization["source"].get("dimensions", [])) != png_dimensions(source_file):
        raise ValueError("generated source dimensions are stale")
    if png_dimensions(normalized_file) != (1920, 1080):
        raise ValueError("Ian approval object must be 1920x1080")
    if normalization.get("stretch") is not False or normalization.get("padding") is not False:
        raise ValueError("normalization may not stretch or pad")
    output = manifest["output_raster"]
    if output.get("path") != normalization["normalized"].get("path") or output.get("sha256") != normalization["normalized"].get("checksum_sha256"):
        raise ValueError("Ian manifest output does not match normalized raster")
    if qa_contract_version == "ian-knowledge-video-frame-qa-v2":
        containment_file = checksum_bound_file(
            qa.get("text_container_qa", {}), "Ian text-container QA evidence",
        )
        validate_text_container_evidence(
            json.loads(containment_file.read_text(encoding="utf-8")),
            asset_id=args.asset_id,
            exact_visible_text=item["exact_visible_text"],
            generated_source={
                "path": normalization["source"]["path"],
                "checksum_sha256": normalization["source"]["checksum_sha256"],
            },
        )

    profile = qa["style_profile"]
    skill_file = resolve_root_relative(profile.get("skill_path", ""), "Ian skill path")
    anchor_file = resolve_root_relative(profile.get("style_anchor_path", ""), "Ian style anchor path")
    if sha256_file(skill_file) != profile.get("skill_checksum_sha256") or sha256_file(anchor_file) != profile.get("style_anchor_checksum_sha256"):
        raise ValueError("pinned Ian style checksum is stale")
    revision_source = qa.get("revision_source") if is_strict_revision else None
    if revision_source is not None:
        if not isinstance(revision_source, dict):
            raise ValueError("Ian strict revision source binding is invalid")
        validate_strict_revision_source(state, item, revision_source)
    if qa["actual_reference_inputs"] != expected_reference_inputs(profile, revision_source):
        raise ValueError("Ian generation must bind the exact style anchor")

    for check in ("semantic_qa", "visible_text_qa", "style_qa", "visual_qa"):
        if qa.get(check, {}).get("result") != "pass":
            raise ValueError(f"{check} did not pass")
    observed = qa["visible_text_qa"].get("observed_exact_text")
    if not isinstance(observed, list) or "｜".join(observed) != item["exact_visible_text"] or qa["visible_text_qa"].get("no_other_visible_text") is not True:
        raise ValueError("Ian visible-text QA is incomplete")
    if qa.get("state_visible_text") != item["exact_visible_text"] or qa["style_qa"].get("style_anchor_match") is not True:
        raise ValueError("Ian state text or style QA is incomplete")

    item.update(
        status="awaiting_user_approval" if is_strict_revision else "awaiting_batch_qa",
        generator=qa["generator"],
        path=normalization["normalized"]["path"],
        checksum_sha256=normalization["normalized"]["checksum_sha256"],
        measured_dimensions=[1920, 1080],
        measured_aspect_ratio_relative_error=0,
        generated_source_path=normalization["source"]["path"],
        generated_source_checksum_sha256=normalization["source"]["checksum_sha256"],
        generated_source_dimensions=normalization["source"]["dimensions"],
        generated_source_aspect_ratio_relative_error=normalization["source"]["relative_aspect_ratio_error"],
        normalization_evidence_path=qa["normalization_evidence"]["path"],
        normalization_evidence_checksum_sha256=qa["normalization_evidence"]["checksum_sha256"],
        prompt_path=qa["prompt"]["path"],
        prompt_checksum_sha256=qa["prompt"]["checksum_sha256"],
        style_profile_id=profile["id"],
        style_skill_path=profile["skill_path"],
        style_skill_checksum_sha256=profile["skill_checksum_sha256"],
        style_anchor_path=profile["style_anchor_path"],
        style_anchor_checksum_sha256=profile["style_anchor_checksum_sha256"],
        actual_reference_inputs=qa["actual_reference_inputs"],
        frame_manifest_path=qa["frame_manifest"]["path"],
        frame_manifest_checksum_sha256=qa["frame_manifest"]["checksum_sha256"],
        state_visible_text=qa["state_visible_text"],
        qa_evidence_path=args.qa_path,
        qa_evidence_checksum_sha256=sha256_file(qa_file),
        qa_contract_version=qa_contract_version,
        technical_qa={
            "result": "pass",
            "rule_id": "ian-knowledge-video-frame-v1",
            "measured_dimensions": [1920, 1080],
        },
        semantic_qa=qa["semantic_qa"],
        visible_text_qa=qa["visible_text_qa"],
        style_qa=qa["style_qa"],
        visual_qa=qa["visual_qa"],
    )
    if revision_source is not None:
        item["revision_source"] = revision_source
    if qa_contract_version == "ian-knowledge-video-frame-qa-v2":
        item["text_container_qa"] = qa["text_container_qa"]
    if is_strict_revision:
        item.update(
            presented_checksum_sha256=normalization["normalized"]["checksum_sha256"],
            presented_at=args.qa_time,
            exact_presentation_message=(
                f"现呈交 {item['asset_id']} 修订 PNG，等待用户明确批准此精确字节。"
            ),
        )
        pause_for_strict_revision(state, args.asset_id)
    else:
        gate.record_hybrid_qa_pass(state, args.asset_id, args.qa_time)
        active = [
            candidate for candidate in state["visual_asset_review"]["queue"]
            if candidate.get("active_for_current_storyboard") is not False and candidate.get("status") != "superseded"
        ]
        next_item = next(
            (candidate for candidate in active if candidate.get("status") not in {
                "approved", "qa_passed_pending_batch_review", "qa_passed_pending_final_review",
            }),
            None,
        )
        state["visual_asset_review"]["current_asset_id"] = next_item.get("asset_id") if next_item else None

    temporary = state_file.with_suffix(".json.ian-hybrid-qa.tmp")
    if temporary.exists():
        raise ValueError("Ian hybrid QA temporary path already exists")
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
