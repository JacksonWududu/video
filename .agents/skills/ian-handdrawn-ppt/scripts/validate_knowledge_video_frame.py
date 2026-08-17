#!/usr/bin/env python3
"""Validate one Ian knowledge-video frame against its approved v3 row."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import struct
from pathlib import Path
from typing import Any


SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
EXPECTED_CONSTRAINTS = {
    "output_raster_count": 1,
    "automatic_page_number": False,
    "automatic_title": False,
    "automatic_subtitle": False,
    "automatic_labels": False,
    "signature": False,
    "contact_sheet_embedded": False,
}


class ContractError(ValueError):
    pass


def _read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ContractError("JSON root must be an object")
    return value


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _sha(value: Any, label: str) -> str:
    if not isinstance(value, str) or not SHA256_RE.fullmatch(value):
        raise ContractError(f"{label} must be a lowercase SHA-256")
    return value


def _string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ContractError(f"{label} must be a non-empty string")
    return value


def _within(repo_root: Path, episode_root: Path, value: Any, label: str) -> Path:
    relative = Path(_string(value, label))
    if relative.is_absolute():
        raise ContractError(f"{label} must be repository-root-relative")
    candidate = repo_root / relative
    if candidate.is_symlink():
        raise ContractError(f"{label} must not be a symbolic link")
    resolved = candidate.resolve(strict=True)
    try:
        resolved.relative_to(episode_root)
    except ValueError as error:
        raise ContractError(f"{label} escapes episode workspace") from error
    return resolved


def _png_dimensions(path: Path) -> tuple[int, int]:
    header = path.read_bytes()[:24]
    if len(header) != 24 or header[:8] != PNG_SIGNATURE or header[12:16] != b"IHDR":
        raise ContractError("output_raster must be a decodable PNG header")
    return struct.unpack(">II", header[16:24])


def validate_manifest(manifest: dict[str, Any], *, episode_workspace: Path, repo_root: Path) -> dict[str, Any]:
    root = episode_workspace.resolve(strict=True)
    repository = repo_root.resolve(strict=True)
    if manifest.get("contract_version") != "ian-knowledge-video-frame-v1":
        raise ContractError("unsupported Ian knowledge-video frame contract")
    try:
        expected_workspace = root.relative_to(repository).as_posix()
    except ValueError as error:
        raise ContractError("episode workspace is outside the repository") from error
    if manifest.get("episode_workspace") != expected_workspace:
        raise ContractError("episode_workspace binding mismatch")

    shot_id = _string(manifest.get("shot_id"), "shot_id")
    _string(manifest.get("queue_item_id"), "queue_item_id")
    if manifest.get("visual_generation_route") != "ian-handdrawn-ppt":
        raise ContractError("Ian frame route mismatch")
    treatment = _string(manifest.get("treatment_profile_id"), "treatment_profile_id")

    binding = manifest.get("visual_direction_review")
    if not isinstance(binding, dict):
        raise ContractError("visual_direction_review binding is required")
    review_path = _within(repository, root, binding.get("path"), "visual_direction_review.path")
    review_sha = _sha(binding.get("sha256"), "visual_direction_review.sha256")
    if _sha256(review_path) != review_sha:
        raise ContractError("visual direction review checksum is stale")
    presented_sha = _sha(
        binding.get("presented_map_sha256"),
        "visual_direction_review.presented_map_sha256",
    )
    review = _read_json(review_path)
    if review.get("contract_version") != "per-shot-visual-direction-review-v3":
        raise ContractError("Ian frame requires per-shot-visual-direction-review-v3")
    if review.get("presented_map_sha256") != presented_sha:
        raise ContractError("Ian frame presented-map binding is stale")
    rows = review.get("rows")
    if not isinstance(rows, list):
        raise ContractError("visual direction review rows are missing")
    matches = [row for row in rows if isinstance(row, dict) and row.get("shot_id") == shot_id]
    if len(matches) != 1:
        raise ContractError("Ian frame must resolve exactly one visual direction row")
    row = matches[0]
    selection = row.get("user_selection")
    if not isinstance(selection, dict) or selection.get("status") != "approved":
        raise ContractError("Ian visual direction row is not approved")
    if selection.get("presented_map_sha256") != presented_sha:
        raise ContractError("Ian row selection has stale presented-map evidence")
    if selection.get("visual_generation_route") != "ian-handdrawn-ppt":
        raise ContractError("Ian frame does not match the approved route")
    if selection.get("treatment_profile_id") != treatment:
        raise ContractError("Ian frame treatment does not match the approved row")

    visible_mode = manifest.get("visible_text_mode")
    exact_text = manifest.get("exact_visible_text")
    placement = manifest.get("visible_text_placement")
    for source in (row, selection):
        if source.get("visible_text_mode") != visible_mode:
            raise ContractError("Ian visible-text mode does not match v3")
        if source.get("exact_visible_text") != exact_text:
            raise ContractError("Ian visible text does not match v3")
        if source.get("visible_text_placement") != placement:
            raise ContractError("Ian visible-text placement does not match v3")
    verified = manifest.get("verified_visible_text")
    if visible_mode == "none":
        if exact_text is not None or placement is not None or verified != []:
            raise ContractError("Ian none mode forbids all visible text and placement")
    elif visible_mode == "required":
        exact = _string(exact_text, "exact_visible_text")
        _string(placement, "visible_text_placement")
        if verified != [exact]:
            raise ContractError("Ian raster text must equal the exact approved Chinese")
    else:
        raise ContractError("unsupported Ian visible_text_mode")

    if manifest.get("generation_constraints") != EXPECTED_CONSTRAINTS:
        raise ContractError("Ian knowledge-video frame must disable the ordinary page shell")
    output = manifest.get("output_raster")
    if not isinstance(output, dict) or output.get("role") != "final-production-raster":
        raise ContractError("one final production raster is required")
    output_path = _within(repository, root, output.get("path"), "output_raster.path")
    if output_path.relative_to(root).parts[:2] != ("assets", "image"):
        raise ContractError("Ian output raster must be under assets/image")
    output_sha = _sha(output.get("sha256"), "output_raster.sha256")
    if _sha256(output_path) != output_sha:
        raise ContractError("Ian output raster checksum is stale")
    dimensions = _png_dimensions(output_path)
    if dimensions != (1920, 1080) or (output.get("width"), output.get("height")) != dimensions:
        raise ContractError("Ian output raster must be exactly 1920x1080")
    return {"result": "pass", "shot_id": shot_id, "output_raster": output.get("path")}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--episode-workspace", required=True, type=Path)
    parser.add_argument("manifest", type=Path)
    args = parser.parse_args()
    repo_root = Path(__file__).resolve().parents[4]
    root = args.episode_workspace.resolve(strict=True)
    manifest_path = _within(repo_root.resolve(strict=True), root, args.manifest, "manifest")
    result = validate_manifest(_read_json(manifest_path), episode_workspace=root, repo_root=repo_root)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
