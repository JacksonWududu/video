#!/usr/bin/env python3
"""Turn a solid chroma-key background into a soft transparent alpha matte."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--transparent-threshold", type=float, default=18.0)
    parser.add_argument("--opaque-threshold", type=float, default=95.0)
    parser.add_argument("--edge-feather", type=float, default=0.6)
    parser.add_argument(
        "--key-color",
        default="auto",
        help="auto, #rrggbb, or r,g,b",
    )
    parser.add_argument("--matte-erode", type=int, default=0)
    parser.add_argument("--edge-padding", type=int, default=6)
    parser.add_argument("--metadata", type=Path)
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def sample_key(rgb: np.ndarray) -> np.ndarray:
    border = np.concatenate(
        [
            rgb[:4, :, :].reshape(-1, 3),
            rgb[-4:, :, :].reshape(-1, 3),
            rgb[:, :4, :].reshape(-1, 3),
            rgb[:, -4:, :].reshape(-1, 3),
        ],
        axis=0,
    )
    return np.median(border, axis=0)


def parse_key_color(value: str, rgb: np.ndarray) -> np.ndarray:
    if value.lower() == "auto":
        return sample_key(rgb)
    normalized = value.removeprefix("#")
    if len(normalized) == 6:
        try:
            return np.asarray(
                [int(normalized[index : index + 2], 16) for index in (0, 2, 4)],
                dtype=np.float32,
            )
        except ValueError as error:
            raise SystemExit(f"Invalid --key-color: {value}") from error
    try:
        channels = [float(channel.strip()) for channel in value.split(",")]
    except ValueError as error:
        raise SystemExit(f"Invalid --key-color: {value}") from error
    if len(channels) != 3 or any(channel < 0 or channel > 255 for channel in channels):
        raise SystemExit(f"Invalid --key-color: {value}")
    return np.asarray(channels, dtype=np.float32)


def despill(rgb: np.ndarray, key: np.ndarray, alpha_u8: np.ndarray) -> np.ndarray:
    key_chroma = key - np.mean(key)
    magnitude = float(np.linalg.norm(key_chroma))
    if magnitude < 1.0:
        return rgb
    key_direction = key_chroma / magnitude
    neutral = np.mean(rgb, axis=2, keepdims=True)
    chroma = rgb - neutral
    spill = np.maximum(0.0, np.sum(chroma * key_direction, axis=2))
    edge_strength = np.power(1.0 - alpha_u8.astype(np.float32) / 255.0, 0.72)
    strength = spill * edge_strength * (alpha_u8 > 0)
    return rgb - strength[:, :, None] * key_direction[None, None, :]


def key_plane_distance(rgb: np.ndarray, key: np.ndarray) -> np.ndarray:
    key_magnitude_squared = float(np.sum(key * key))
    projection = np.clip(
        np.sum(rgb * key[None, None, :], axis=2) / key_magnitude_squared,
        0.0,
        1.25,
    )
    residual = np.linalg.norm(
        rgb - projection[:, :, None] * key[None, None, :],
        axis=2,
    )
    # Provider shadows are commonly darkened copies of the key hue. Distance
    # to the key-colour ray removes those shadows, while the darkness floor
    # keeps genuine near-black ink contours opaque.
    darkness_penalty = np.maximum(0.0, 0.35 - projection) * 441.7
    return np.hypot(residual, darkness_penalty)


def pad_transparent_rgb(
    rgb: np.ndarray,
    alpha_u8: np.ndarray,
    iterations: int,
) -> np.ndarray:
    """Extend subject edge colors into transparent pixels for safe resampling."""
    result = rgb.copy()
    filled = alpha_u8 > 0
    height, width = filled.shape
    for _ in range(iterations):
        pending = ~filled
        if not np.any(pending):
            break
        color_sum = np.zeros_like(result)
        neighbor_count = np.zeros((height, width), dtype=np.float32)
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)):
            source_y = slice(max(0, -dy), min(height, height - dy))
            source_x = slice(max(0, -dx), min(width, width - dx))
            target_y = slice(max(0, dy), min(height, height + dy))
            target_x = slice(max(0, dx), min(width, width + dx))
            valid = filled[source_y, source_x]
            color_sum[target_y, target_x] += result[source_y, source_x] * valid[:, :, None]
            neighbor_count[target_y, target_x] += valid
        newly_filled = pending & (neighbor_count > 0)
        result[newly_filled] = color_sum[newly_filled] / neighbor_count[newly_filled, None]
        filled[newly_filled] = True
    result[~filled] = 235.0
    return result


def main() -> None:
    args = parse_args()
    if args.out.exists() and not args.force:
        raise SystemExit(f"Output exists: {args.out}; pass --force to overwrite")
    if args.opaque_threshold <= args.transparent_threshold:
        raise SystemExit("opaque-threshold must be larger than transparent-threshold")
    if args.matte_erode < 0:
        raise SystemExit("matte-erode must be zero or positive")
    if args.edge_padding < 0:
        raise SystemExit("edge-padding must be zero or positive")

    source = Image.open(args.input).convert("RGB")
    rgb = np.asarray(source, dtype=np.float32)
    key = parse_key_color(args.key_color, rgb)
    distance = key_plane_distance(rgb, key)
    alpha = np.clip(
        (distance - args.transparent_threshold)
        / (args.opaque_threshold - args.transparent_threshold),
        0.0,
        1.0,
    )
    alpha_image = Image.fromarray(np.uint8(alpha * 255), mode="L")
    if args.matte_erode > 0:
        alpha_image = alpha_image.filter(ImageFilter.MinFilter(args.matte_erode * 2 + 1))
    if args.edge_feather > 0:
        alpha_image = alpha_image.filter(ImageFilter.GaussianBlur(args.edge_feather))
    alpha_u8 = np.asarray(alpha_image, dtype=np.uint8)

    rgb = despill(rgb, key, alpha_u8)
    rgb = pad_transparent_rgb(rgb, alpha_u8, args.edge_padding)

    rgba = np.dstack([np.uint8(np.clip(rgb, 0, 255)), alpha_u8])
    args.out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, mode="RGBA").save(args.out)

    transparent = int(np.count_nonzero(alpha_u8 == 0))
    partial = int(np.count_nonzero((alpha_u8 > 0) & (alpha_u8 < 255)))
    total = int(alpha_u8.size)
    key_hex = "#" + "".join(f"{round(channel):02x}" for channel in key)
    print(f"Wrote {args.out}")
    print(f"Key color: {key_hex}")
    print(f"Transparent pixels: {transparent}/{total}")
    print(f"Partially transparent pixels: {partial}/{total}")
    if args.metadata:
        args.metadata.parent.mkdir(parents=True, exist_ok=True)
        args.metadata.write_text(
            json.dumps(
                {
                    "schemaVersion": 2,
                    "input": str(args.input),
                    "output": str(args.out),
                    "keyColor": key_hex,
                    "transparentThreshold": args.transparent_threshold,
                    "opaqueThreshold": args.opaque_threshold,
                    "edgeFeather": args.edge_feather,
                    "matteErode": args.matte_erode,
                    "distanceMetric": "key-ray-with-darkness-floor-v1",
                    "despill": "key-chroma-edge",
                    "transparentRgb": {
                        "mode": "edge-pad-neutral",
                        "paddingPixels": args.edge_padding,
                        "neutralRgb": [235, 235, 235],
                    },
                    "transparentPixels": transparent,
                    "partialPixels": partial,
                    "totalPixels": total,
                },
                indent=2,
            )
            + "\n",
            encoding="utf8",
        )
        print(f"Metadata: {args.metadata}")


if __name__ == "__main__":
    main()
