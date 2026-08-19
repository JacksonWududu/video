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


def load_gate():
    spec = importlib.util.spec_from_file_location("visual_approval_gate", GATE_PATH)
    if spec is None or spec.loader is None:
        raise ValueError("visual approval gate cannot be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def png_dimensions(file: Path) -> tuple[int, int]:
    header = file.read_bytes()[:24]
    if len(header) != 24 or header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        raise ValueError(f"not a decodable PNG: {file}")
    return struct.unpack(">II", header[16:24])


def checksum_bound_file(binding: dict[str, Any], label: str) -> Path:
    if not isinstance(binding, dict) or not SHA256_RE.fullmatch(str(binding.get("checksum_sha256", ""))):
        raise ValueError(f"{label} binding is invalid")
    file = resolve_root_relative(binding.get("path", ""), f"{label} path")
    if sha256_file(file) != binding["checksum_sha256"]:
        raise ValueError(f"{label} checksum is stale")
    return file


def record(args: argparse.Namespace) -> dict[str, Any]:
    workspace = resolve_root_relative(args.episode_workspace, "episode workspace")
    state_file = workspace / "schema/episode-state.json"
    state = json.loads(state_file.read_text(encoding="utf-8"))
    gate = load_gate()
    item = gate.require_generation_allowed(state, args.asset_id)
    if (
        item.get("visual_generation_route") != "xuan-paper-diorama"
        or item.get("strict_review") is not True
        or item.get("is_revision") is not True
        or item.get("role") not in {"action-01", "action-02", "action-03"}
        or item.get("has_downstream_action_variants") is not False
    ):
        raise ValueError("asset is not a strict revised Xuan Paper action state")

    qa_file = resolve_root_relative(args.qa_path, "QA evidence path")
    qa = json.loads(qa_file.read_text(encoding="utf-8"))
    if (
        qa.get("contract_version") != "xuan-paper-diorama-action-qa-v1"
        or qa.get("result") != "pass"
        or qa.get("asset_id") != args.asset_id
        or qa.get("generator") != "codex-native-imagegen"
        or qa.get("style_profile", {}).get("id") != "xuan-paper-diorama"
        or not isinstance(qa.get("actual_reference_inputs"), list)
        or len(qa["actual_reference_inputs"]) != 1
        or not isinstance(qa.get("generation_lineage"), list)
        or len(qa["generation_lineage"]) < 1
    ):
        raise ValueError("strict Xuan Paper action QA evidence is incomplete")

    prompt_file = checksum_bound_file(qa["prompt"], "selected prompt")
    prompt_text = prompt_file.read_text(encoding="utf-8")
    if "16:9 landscape composition" not in prompt_text or "Text: none." not in prompt_text:
        raise ValueError("production prompt lacks exact 16:9 or text-free instruction")

    normalization_file = checksum_bound_file(qa["normalization_evidence"], "normalization evidence")
    normalization = json.loads(normalization_file.read_text(encoding="utf-8"))
    source_file = checksum_bound_file(normalization["source"], "generated source")
    normalized_file = checksum_bound_file(normalization["normalized"], "normalized raster")
    if tuple(normalization["source"].get("dimensions", [])) != png_dimensions(source_file):
        raise ValueError("generated source dimensions are stale")
    if png_dimensions(normalized_file) != (1920, 1080):
        raise ValueError("Xuan Paper approval object must be 1920x1080")
    if normalization.get("stretch") is not False or normalization.get("padding") is not False:
        raise ValueError("normalization may not stretch or pad")

    profile = qa["style_profile"]
    for path_key, checksum_key in [
        ("skill_path", "skill_checksum_sha256"),
        ("profile_path", "profile_checksum_sha256"),
    ]:
        external = Path(profile[path_key])
        if not external.is_absolute() or not external.is_file() or sha256_file(external) != profile[checksum_key]:
            raise ValueError(f"pinned style {path_key} checksum is stale")

    reference = qa["actual_reference_inputs"][0]
    if reference.get("role") != "edit_target_identity_composition_and_era_reference":
        raise ValueError("action reference must be the approved master edit target")
    checksum_bound_file(reference, "approved master reference")
    if len(item.get("depends_on", [])) != 1:
        raise ValueError("action state must depend on exactly one approved master")
    master = next(
        (candidate for candidate in state["visual_asset_review"]["queue"]
         if candidate.get("asset_id") == item["depends_on"][0]),
        None,
    )
    if (
        master is None
        or master.get("status") != "approved"
        or master.get("path") != reference.get("path")
        or master.get("approved_checksum_sha256") != reference.get("checksum_sha256")
    ):
        raise ValueError("action reference is not the exact approved master")

    for index, stage in enumerate(qa["generation_lineage"]):
        checksum_bound_file(stage.get("prompt", {}), f"generation stage {index} prompt")
        checksum_bound_file(stage.get("output", {}), f"generation stage {index} output")
        if stage.get("reference_inputs", []) != qa["actual_reference_inputs"]:
            raise ValueError(f"generation stage {index} did not use the approved master directly")
    for index, rejected in enumerate(qa.get("rejected_attempts", [])):
        checksum_bound_file(rejected, f"rejected attempt {index}")

    for check in (
        "semantic_qa",
        "identity_qa",
        "visible_text_qa",
        "style_qa",
        "continuity_qa",
        "visual_qa",
    ):
        if qa.get(check, {}).get("result") != "pass":
            raise ValueError(f"{check} did not pass")
    if (
        qa["visible_text_qa"].get("no_visible_text") is not True
        or qa["visible_text_qa"].get("no_pseudotext") is not True
        or qa["style_qa"].get("readable_depth_planes") not in range(4, 8)
    ):
        raise ValueError("Xuan Paper visual or text-free QA is incomplete")

    item.update(
        status="awaiting_user_approval",
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
        style_profile_path=profile["profile_path"],
        style_profile_checksum_sha256=profile["profile_checksum_sha256"],
        style_skill_path=profile["skill_path"],
        style_skill_checksum_sha256=profile["skill_checksum_sha256"],
        actual_reference_inputs=qa["actual_reference_inputs"],
        generation_lineage=qa["generation_lineage"],
        rejected_attempts=qa.get("rejected_attempts", []),
        qa_evidence_path=args.qa_path,
        qa_evidence_checksum_sha256=sha256_file(qa_file),
        technical_qa={
            "result": "pass",
            "rule_id": "xuan-paper-diorama-route-v1",
            "measured_dimensions": [1920, 1080],
        },
        semantic_qa=qa["semantic_qa"],
        identity_qa=qa["identity_qa"],
        visible_text_qa=qa["visible_text_qa"],
        style_qa=qa["style_qa"],
        continuity_qa=qa["continuity_qa"],
        visual_qa=qa["visual_qa"],
        presented_checksum_sha256=normalization["normalized"]["checksum_sha256"],
        presented_at=args.qa_time,
        exact_presentation_message=(
            f"现呈交 {args.asset_id} 严格修订图精确 PNG，等待用户明确批准此精确字节后，方可继续下一动作态。"
        ),
    )
    state["visual_asset_review"]["queue_generation_allowed"] = False
    state["visual_asset_review"]["current_asset_id"] = args.asset_id
    state["current_phase"] = "awaiting_visual_asset_review"

    temporary = state_file.with_suffix(".json.xuan-strict-action.tmp")
    if temporary.exists():
        raise ValueError("Xuan Paper strict action QA temporary path already exists")
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
