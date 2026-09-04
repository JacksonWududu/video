#!/usr/bin/env python3
"""Record one approved-route static spread candidate through the existing visual gate."""
from __future__ import annotations
import argparse
import copy
import importlib.util
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[4]


def load_gate():
    path = ROOT / ".agents/skills/run-knowledge-video/scripts/validate_visual_approval_state.py"
    spec = importlib.util.spec_from_file_location("static_spread_visual_gate", path)
    gate = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gate)
    return gate


def record_static_spread_qa(state, asset_id, qa_path, qa_time, *, repository_root=ROOT):
    gate = load_gate()
    gate.REPOSITORY_ROOT = Path(repository_root)
    candidate = copy.deepcopy(state)
    item = gate.require_generation_allowed(candidate, asset_id)
    qa_file = gate._resolve_regular_file(repository_root, qa_path)
    qa = json.loads(qa_file.read_text(encoding="utf-8"))
    if qa.get("asset_id") != asset_id:
        raise ValueError("static spread QA asset ID mismatch")
    output = qa.get("output", {})
    source = gate._resolve_regular_file(repository_root, output.get("path"))
    dimensions = list(gate._png_dimensions(source))
    item.update(path=output.get("path"), checksum_sha256=output.get("checksum_sha256"),
                measured_dimensions=dimensions, prompt_path=qa.get("prompt", {}).get("path"),
                prompt_checksum_sha256=qa.get("prompt", {}).get("checksum_sha256"),
                qa_evidence_path=qa_path, qa_evidence_checksum_sha256=gate._sha256_file(qa_file),
                qa_contract_version=qa.get("contract_version"),
                actual_reference_inputs=qa.get("actual_reference_inputs"),
                status="awaiting_batch_qa")
    for field in ("technical_qa", "semantic_qa", "visible_text_qa", "style_qa", "visual_qa"):
        item[field] = qa.get(field)
    validator = ROOT / "leverage-video/src/shared/visual-assets/static-spread-contract.mjs"
    result = subprocess.run(["node", str(validator)], input=json.dumps({
        "repositoryRoot": str(repository_root), "state": candidate, "item": item,
    }, ensure_ascii=False), capture_output=True, text=True, check=False)
    if result.returncode:
        raise ValueError(result.stderr.strip() or "static spread QA failed")
    item["static_spread_review"] = json.loads(result.stdout)
    strict = gate._is_strict(item, gate._queue(candidate))
    if strict and candidate["visual_asset_review"]["mode"] != "one_click_final_review_v1":
        item["status"] = "awaiting_user_approval"
    else:
        gate.record_hybrid_qa_pass(candidate, asset_id, qa_time)
    return candidate


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("episode_workspace")
    parser.add_argument("asset_id")
    parser.add_argument("qa_path")
    parser.add_argument("--qa-time", required=True)
    args = parser.parse_args()
    gate = load_gate()
    state_path = gate._resolve_regular_file(ROOT, f"{args.episode_workspace}/schema/episode-state.json")
    old = state_path.read_bytes()
    state = json.loads(old)
    next_state = record_static_spread_qa(state, args.asset_id, args.qa_path, args.qa_time)
    if state_path.read_bytes() != old:
        raise ValueError("episode state changed during static QA")
    temporary = state_path.with_name(state_path.name + ".static-qa.tmp")
    with temporary.open("x", encoding="utf-8") as handle:
        handle.write(json.dumps(next_state, ensure_ascii=False, indent=2) + "\n")
    try:
        if state_path.read_bytes() != old:
            raise ValueError("episode state changed during static QA")
        temporary.replace(state_path)
    finally:
        if temporary.exists():
            temporary.unlink()
    print(json.dumps({"result": "pass", "asset_id": args.asset_id, "user_approved": False}))


if __name__ == "__main__":
    main()
