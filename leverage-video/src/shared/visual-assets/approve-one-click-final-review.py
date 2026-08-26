#!/usr/bin/env python3
"""Present or approve the one-click final exact visual hash list."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess


REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
GATE_PATH = REPOSITORY_ROOT / ".agents/skills/run-knowledge-video/scripts/validate_visual_approval_state.py"
PACKAGE_BUILDER = REPOSITORY_ROOT / "leverage-video/src/shared/visual-assets/build-final-production-asset-review.mjs"


def load_gate():
    spec = importlib.util.spec_from_file_location("visual_approval_gate", GATE_PATH)
    if spec is None or spec.loader is None:
        raise ValueError("visual approval gate cannot be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_state(state_path: Path, state: dict) -> None:
    temporary = state_path.with_suffix(".json.one-click-final-review.tmp")
    if temporary.exists():
        raise ValueError("one-click final review temporary path already exists")
    temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(state_path)


def existing_package_report(episode_workspace: str, presented_map_sha256: str) -> dict | None:
    short_digest = presented_map_sha256[:8]
    relative = (
        f"{episode_workspace}/schema/"
        f"final-production-asset-review-{short_digest}.json"
    )
    target = REPOSITORY_ROOT / relative
    if not target.exists():
        return None
    if target.is_symlink() or not target.is_file():
        raise ValueError("existing final production review manifest is not a regular file")
    manifest_bytes = target.read_bytes()
    manifest = json.loads(manifest_bytes)
    return {
        "status": "existing",
        "contract_version": manifest.get("contract_version"),
        "presented_map_sha256": manifest.get("presented_map_sha256"),
        "counts": manifest.get("counts"),
        "html": manifest.get("outputs", {}).get("html"),
        "manifest": {
            "path": relative,
            "checksum_sha256": hashlib.sha256(manifest_bytes).hexdigest(),
        },
        "pages": manifest.get("outputs", {}).get("pages"),
        "ian_stage_sheets": manifest.get("outputs", {}).get("ian_stage_sheets"),
        "episode_state_mutated": False,
    }


def generate_package(episode_workspace: str, presented_map_sha256: str) -> dict:
    existing = existing_package_report(episode_workspace, presented_map_sha256)
    if existing is not None:
        return existing
    result = subprocess.run(
        [
            "node", str(PACKAGE_BUILDER), episode_workspace,
            "--expected-map-sha256", presented_map_sha256,
        ],
        cwd=REPOSITORY_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    try:
        report = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise ValueError(f"final production review package builder returned invalid JSON: {error}") from error
    if result.returncode != 0 or report.get("status") != "created":
        raise ValueError(
            f"final production review package generation failed: "
            f"{report.get('message') or result.stderr.strip()}"
        )
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["present", "approve"])
    parser.add_argument("episode_workspace")
    parser.add_argument("--presented-map-sha256")
    parser.add_argument("--decision-message")
    parser.add_argument("--decision-time")
    args = parser.parse_args()

    workspace = (REPOSITORY_ROOT / args.episode_workspace).resolve(strict=True)
    workspace.relative_to(REPOSITORY_ROOT)
    state_path = workspace / "schema/episode-state.json"
    original_state_bytes = state_path.read_bytes()
    state = json.loads(original_state_bytes)
    gate = load_gate()
    if args.command == "present":
        result = gate.present_one_click_final_visual_review(state)
        write_state(state_path, state)
        try:
            package_report = generate_package(
                args.episode_workspace, result["presented_map_sha256"],
            )
            package = gate.bind_one_click_final_review_package(
                state,
                package_report,
                repository_root=REPOSITORY_ROOT,
            )
            result = {**result, "review_package": package}
        except Exception:
            rollback = state_path.with_suffix(".json.one-click-final-review.rollback.tmp")
            if rollback.exists():
                raise ValueError("one-click final review rollback path already exists")
            rollback.write_bytes(original_state_bytes)
            rollback.replace(state_path)
            raise
    else:
        if not all((args.presented_map_sha256, args.decision_message, args.decision_time)):
            raise ValueError("approve requires exact map SHA-256, decision message, and decision time")
        result = gate.approve_one_click_final_visual_review(
            state,
            args.presented_map_sha256,
            args.decision_message,
            args.decision_time,
            repository_root=REPOSITORY_ROOT,
        )
    write_state(state_path, state)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
