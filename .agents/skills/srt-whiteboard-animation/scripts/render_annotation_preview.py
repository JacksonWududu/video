#!/usr/bin/env python3
"""Render a static, deterministic region preview. No browser is used."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from whiteboard_contract import HEIGHT, WIDTH, read_json, resolve_within, validate_annotation


FONT_CANDIDATES = (
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
)


def resolve_font(explicit: str | None, size: int) -> ImageFont.FreeTypeFont:
    candidates = (explicit,) if explicit else FONT_CANDIDATES
    for value in candidates:
        if value and Path(value).is_file():
            return ImageFont.truetype(value, size)
    raise RuntimeError("no deterministic Chinese font found")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--episode-workspace", required=True)
    parser.add_argument("image")
    parser.add_argument("annotation")
    parser.add_argument("output")
    parser.add_argument("--font")
    args = parser.parse_args()

    root = Path(args.episode_workspace).resolve(strict=True)
    image_path = resolve_within(root, args.image, must_exist=True)
    annotation_path = resolve_within(root, args.annotation, must_exist=True)
    output = resolve_within(root, args.output, must_exist=False)
    if output.exists():
        raise RuntimeError("versioned whiteboard preview already exists; overwrite is forbidden")
    annotation = validate_annotation(read_json(annotation_path), episode_workspace=root)
    image = Image.open(image_path).convert("RGBA")
    if image.size != (WIDTH, HEIGHT):
        raise ValueError("annotation preview requires a 1920x1080 normalized PNG")
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    font = resolve_font(args.font, 24)
    small = resolve_font(args.font, 18)
    colors = ((48, 99, 196, 230), (222, 88, 74, 230), (35, 145, 106, 230), (173, 91, 201, 230))

    safe = annotation["subtitle_safe_area"]
    draw.rectangle(
        (safe["x"], safe["y"], safe["x"] + safe["width"], safe["y"] + safe["height"]),
        fill=(206, 52, 52, 25), outline=(206, 52, 52, 210), width=3,
    )
    draw.text((safe["x"] + 14, safe["y"] + 12), "字幕安全区", font=font, fill=(160, 35, 35, 255))
    for index, element in enumerate(annotation["elements"]):
        region = element["region"]
        x, y = region["x"], region["y"]
        right, bottom = x + region["width"], y + region["height"]
        color = colors[index % len(colors)]
        draw.rounded_rectangle((x, y, right, bottom), radius=12, outline=color, width=4, fill=(*color[:3], 22))
        label = f"{index + 1}. {element['id']}  f{element['start_frame']}–{element['end_frame']}"
        box = draw.textbbox((0, 0), label, font=small)
        label_width = min(right - x - 16, box[2] - box[0] + 20)
        draw.rounded_rectangle((x + 8, y + 8, x + 8 + label_width, y + 42), radius=6, fill=(255, 255, 255, 235))
        draw.text((x + 16, y + 12), label, font=small, fill=color)
        for protected in element.get("protected_regions", []):
            px, py = protected["x"], protected["y"]
            draw.rectangle(
                (px, py, px + protected["width"], py + protected["height"]),
                outline=(40, 40, 40, 210), width=3,
            )
    output.parent.mkdir(parents=True, exist_ok=True)
    Image.alpha_composite(image, overlay).convert("RGB").save(output, format="PNG", optimize=False)
    print(output.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
