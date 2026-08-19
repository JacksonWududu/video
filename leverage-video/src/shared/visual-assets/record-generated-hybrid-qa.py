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
    if item.get("visual_generation_route") != "ink-doodle-knowledge-card":
        raise ValueError("this recorder currently accepts only Ink Doodle assets")
    qa_file = resolve_root_relative(args.qa_path, "QA evidence path")
    qa = json.loads(qa_file.read_text(encoding="utf-8"))
    if (
        qa.get("contract_version") != "ink-doodle-asset-qa-v1"
        or qa.get("result") != "pass"
        or qa.get("asset_id") != args.asset_id
        or qa.get("generator") != "codex-native-imagegen"
        or qa.get("style_profile", {}).get("id") != "ink-doodle-knowledge-card"
        or not isinstance(qa.get("actual_reference_inputs"), list)
    ):
        raise ValueError("Ink Doodle QA evidence is incomplete")
    prompt_file = checksum_bound_file(qa["prompt"], "prompt")
    if "16:9 landscape composition" not in prompt_file.read_text(encoding="utf-8"):
        raise ValueError("production prompt lacks exact 16:9 phrase")
    normalization_file = checksum_bound_file(qa["normalization_evidence"], "normalization evidence")
    normalization = json.loads(normalization_file.read_text(encoding="utf-8"))
    source_file = checksum_bound_file(normalization["source"], "generated source")
    normalized_file = checksum_bound_file(normalization["normalized"], "normalized raster")
    if tuple(normalization["source"].get("dimensions", [])) != png_dimensions(source_file):
        raise ValueError("generated source dimensions are stale")
    if png_dimensions(normalized_file) != (1920, 1080):
        raise ValueError("Ink Doodle approval object must be 1920x1080")
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
    for index, reference in enumerate(qa["actual_reference_inputs"]):
        if not isinstance(reference, dict) or not isinstance(reference.get("role"), str) or not reference["role"]:
            raise ValueError(f"actual reference {index} role is missing")
        checksum_bound_file(reference, f"actual reference {index}")
    for check in ["semantic_qa", "visible_text_qa", "visual_qa"]:
        if qa.get(check, {}).get("result") != "pass":
            raise ValueError(f"{check} did not pass")
    item.update(
        status="awaiting_batch_qa",
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
        state_visible_text=qa["state_visible_text"],
        qa_evidence_path=args.qa_path,
        qa_evidence_checksum_sha256=sha256_file(qa_file),
        technical_qa={
            "result": "pass",
            "rule_id": "ink-doodle-knowledge-card-route-v1",
            "measured_dimensions": [1920, 1080],
        },
        semantic_qa=qa["semantic_qa"],
        visible_text_qa=qa["visible_text_qa"],
        visual_qa=qa["visual_qa"],
    )
    gate.record_hybrid_qa_pass(state, args.asset_id, args.qa_time)
    active = [
        candidate
        for candidate in state["visual_asset_review"]["queue"]
        if candidate.get("active_for_current_storyboard") is not False
        and candidate.get("status") != "superseded"
    ]
    next_item = next(
        (candidate for candidate in active if candidate.get("status") not in {"approved", "qa_passed_pending_batch_review"}),
        None,
    )
    state["visual_asset_review"]["current_asset_id"] = next_item.get("asset_id") if next_item else None
    temporary = state_file.with_suffix(".json.hybrid-qa.tmp")
    if temporary.exists():
        raise ValueError("hybrid QA temporary path already exists")
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
