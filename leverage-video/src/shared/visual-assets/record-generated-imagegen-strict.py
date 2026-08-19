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
CANONICAL_ROOT = Path("/Users/jackson/Documents/Codex/character-library/white-cat/v2").resolve()
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


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
    header = file.read_bytes()[:24]
    if len(header) != 24 or header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        raise ValueError(f"not a decodable PNG: {file}")
    return struct.unpack(">II", header[16:24])


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
    item = gate.require_generation_allowed(state, args.asset_id)
    if (
        item.get("visual_generation_route") != "imagegen"
        or item.get("strict_review") is not True
        or item.get("has_downstream_action_variants") is not True
        or item.get("white_cat_present") is not True
        or item.get("visible_text_mode") != "none"
    ):
        raise ValueError("asset is not a strict ordinary-imagegen white-cat master")

    qa_file = resolve_path(args.qa_path, "QA evidence path")
    qa = json.loads(qa_file.read_text(encoding="utf-8"))
    if (
        qa.get("contract_version") != "ordinary-imagegen-white-cat-master-qa-v1"
        or qa.get("result") != "pass"
        or qa.get("asset_id") != args.asset_id
        or qa.get("generator") != "codex-native-imagegen"
        or qa.get("style_profile", {}).get("id") != item.get("treatment_profile_id")
        or not isinstance(qa.get("generation_lineage"), list)
        or len(qa["generation_lineage"]) < 1
        or not isinstance(qa.get("actual_reference_inputs"), list)
    ):
        raise ValueError("ordinary ImageGen master QA evidence is incomplete")

    base_prompt = checksum_bound_file(qa["base_prompt"], "base prompt")
    selected_prompt = checksum_bound_file(qa["selected_prompt"], "selected prompt")
    for prompt in (base_prompt, selected_prompt):
        text = prompt.read_text(encoding="utf-8")
        if "16:9 landscape composition" not in text or "VISIBLE-TEXT MODE: none." not in text:
            raise ValueError("production prompt lacks exact 16:9 or text-free instruction")

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
    if profile.get("medium_id") != "loose-line-vivid-watercolor":
        raise ValueError("ordinary ImageGen master has the wrong medium")

    character = qa["character_reference"]
    required_character_files = [
        ("primary_path", "primary_checksum_sha256"),
        ("bible_path", "bible_checksum_sha256"),
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
    for index, stage in enumerate(qa["generation_lineage"]):
        checksum_bound_file(stage.get("prompt", {}), f"generation stage {index} prompt")
        checksum_bound_file(stage.get("output", {}), f"generation stage {index} output")
        references = stage.get("reference_inputs", [])
        for ref_index, reference in enumerate(references):
            checksum_bound_file(reference, f"generation stage {index} reference {ref_index}")
        if not any(ref.get("path") == primary_path and ref.get("checksum_sha256") == primary_checksum for ref in references):
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

    item.update(
        status="awaiting_user_approval",
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
        character_reference_version=character["version"],
        character_reference_path=character["primary_path"],
        character_reference_checksum_sha256=character["primary_checksum_sha256"],
        character_bible_path=character["bible_path"],
        character_bible_checksum_sha256=character["bible_checksum_sha256"],
        supporting_geometry_reference_path=character["supporting_geometry_path"],
        supporting_geometry_reference_checksum_sha256=character["supporting_geometry_checksum_sha256"],
        actual_reference_inputs=qa["actual_reference_inputs"],
        generation_lineage=qa["generation_lineage"],
        rejected_attempts=qa.get("rejected_attempts", []),
        qa_evidence_path=args.qa_path,
        qa_evidence_checksum_sha256=sha256_file(qa_file),
        technical_qa={"result": "pass", "rule_id": "ordinary-imagegen-source-v1", "measured_dimensions": list(dimensions)},
        semantic_qa=qa["semantic_qa"],
        identity_qa=qa["identity_qa"],
        visible_text_qa=qa["visible_text_qa"],
        style_qa=qa["style_qa"],
        continuity_qa=qa["continuity_qa"],
        visual_qa=qa["visual_qa"],
        presented_checksum_sha256=qa["selected_source"]["checksum_sha256"],
        presented_at=args.qa_time,
        exact_presentation_message=(
            f"现呈交 {item['shot_id']} 主图精确源 PNG，等待用户明确批准此精确字节后，方可生成其动作变体。"
        ),
    )
    state["visual_asset_review"]["queue_generation_allowed"] = False
    state["visual_asset_review"]["current_asset_id"] = args.asset_id

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
