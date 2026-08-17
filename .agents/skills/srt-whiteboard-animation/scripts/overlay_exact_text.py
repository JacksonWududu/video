#!/usr/bin/env python3
"""Apply storyboard-approved Chinese text deterministically before source review."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw, ImageFont

from whiteboard_contract import (
    REPOSITORY_ROOT,
    ROUTE_ID,
    read_json,
    resolve_within,
    sha256_file,
    validate_source_aspect,
    validate_visual_direction_binding,
)


DEFAULT_FONT = "/System/Library/Fonts/PingFang.ttc"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--episode-workspace", required=True)
    parser.add_argument("input")
    parser.add_argument("spec")
    parser.add_argument("output")
    parser.add_argument("evidence")
    parser.add_argument("--font", default=DEFAULT_FONT)
    args = parser.parse_args()
    root = Path(args.episode_workspace).resolve(strict=True)
    input_path = resolve_within(root, args.input, must_exist=True)
    spec_path = resolve_within(root, args.spec, must_exist=True)
    output = resolve_within(root, args.output, must_exist=False)
    evidence_path = resolve_within(root, args.evidence, must_exist=False)
    if output.exists() or evidence_path.exists():
        raise RuntimeError("versioned whiteboard text output/evidence already exists; overwrite is forbidden")
    spec = read_json(spec_path)
    if spec.get("contract_version") != "whiteboard-exact-text-overlay-v2":
        raise ValueError("unsupported exact-text overlay contract")
    if spec.get("visual_generation_route") != ROUTE_ID or spec.get("visible_text_mode") != "required":
        raise ValueError("whiteboard exact-text overlay requires the approved route and required mode")
    validate_visual_direction_binding(spec, root)
    approved = spec.get("approved_visible_text")
    layers = spec.get("layers")
    if not isinstance(approved, list) or not approved or not isinstance(layers, list):
        raise ValueError("approved_visible_text and layers are required")
    if [layer.get("text") for layer in layers] != approved:
        raise ValueError("text layers must equal approved Chinese in exact order")
    font_path = Path(args.font).resolve(strict=True)
    image = Image.open(input_path).convert("RGB")
    width, height = image.size
    relative_error = validate_source_aspect(width, height)
    draw = ImageDraw.Draw(image)
    for index, layer in enumerate(layers):
        text = layer["text"]
        if not isinstance(text, str) or not text.strip():
            raise ValueError(f"layers[{index}].text is invalid")
        x, y = layer.get("x"), layer.get("y")
        size = layer.get("font_size")
        if not all(isinstance(value, int) for value in (x, y, size)) or size < 1:
            raise ValueError(f"layers[{index}] position/font_size is invalid")
        font = ImageFont.truetype(str(font_path), size)
        fill = ImageColor.getrgb(layer.get("color", "#333333"))
        draw.text((x, y), text, font=font, fill=fill, anchor=layer.get("anchor", "la"))
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output, format="PNG", optimize=False)
    evidence = {
        "contract_version": "whiteboard-exact-text-overlay-evidence-v1",
        "input": {"path": input_path.relative_to(REPOSITORY_ROOT).as_posix(), "sha256": sha256_file(input_path)},
        "spec": {"path": spec_path.relative_to(REPOSITORY_ROOT).as_posix(), "sha256": sha256_file(spec_path)},
        "font": {"path": str(font_path), "sha256": sha256_file(font_path)},
        "output": {"path": output.relative_to(REPOSITORY_ROOT).as_posix(), "sha256": sha256_file(output)},
        "approved_visible_text": approved,
        "dimensions": [width, height],
        "aspect_ratio_relative_error": relative_error,
    }
    evidence_path.parent.mkdir(parents=True, exist_ok=True)
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(output.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
