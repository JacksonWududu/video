#!/usr/bin/env python3
"""Frame-drive the reviewed upstream renderer into a strict silent H.264 shot clip."""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import tempfile
from collections import deque
from fractions import Fraction
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

import stream_render as sr
from region_stream_renderer import RegionStreamRenderer
from whiteboard_contract import (
    DRAWING_OVERLAY_POLICY,
    FPS,
    HEIGHT,
    MIN_FINAL_HOLD_FRAMES,
    REPOSITORY_ROOT,
    ROUTE_ID,
    WIDTH,
    read_json,
    resolve_within,
    sha256_file,
    validate_annotation,
    validate_render_evidence,
    validate_source_aspect,
)


FFMPEG = Path("/opt/homebrew/bin/ffmpeg")
FFPROBE = Path("/opt/homebrew/bin/ffprobe")


def _path_record(path: Path) -> str:
    try:
        return path.relative_to(REPOSITORY_ROOT).as_posix()
    except ValueError as error:
        raise RuntimeError("whiteboard evidence path is outside the repository") from error


def _to_upstream(annotation: dict) -> dict:
    elements = []
    for item in annotation["elements"]:
        elements.append({
            "id": item["id"],
            "label": item["id"],
            "sequence": item["sequence"],
            "narrativeRole": item["semantic_role"],
            "subtitle": item["subtitle_span"]["text"],
            "type": item.get("type", "object"),
            "region": item["region"],
            "reveal": {
                "direction": "top_to_bottom",
                "startMs": round(item["start_frame"] * 1000 / FPS),
                "durationMs": max(1, round((item["end_frame"] - item["start_frame"]) * 1000 / FPS)),
                "maskPaddingPx": 0,
                "protectedRegions": item.get("protected_regions", []),
            },
        })
    return {
        "sceneId": annotation["shot_id"],
        "canvas": {"width": WIDTH, "height": HEIGHT},
        "sceneDurationMs": round(annotation["total_frames"] * 1000 / FPS),
        "elements": elements,
    }


def _probe(path: Path) -> dict:
    command = [
        str(FFPROBE), "-v", "error", "-count_frames",
        "-show_entries", "stream=index,codec_name,codec_type,width,height,avg_frame_rate,nb_read_frames",
        "-of", "json", str(path),
    ]
    completed = subprocess.run(command, check=True, capture_output=True, text=True)
    streams = json.loads(completed.stdout).get("streams", [])
    video = [stream for stream in streams if stream.get("codec_type") == "video"]
    audio = [stream for stream in streams if stream.get("codec_type") == "audio"]
    if len(video) != 1:
        raise RuntimeError("whiteboard clip must contain exactly one video stream")
    item = video[0]
    rate = Fraction(item["avg_frame_rate"])
    if rate.denominator == 0:
        raise RuntimeError("whiteboard clip has an invalid frame rate")
    return {
        "width": int(item["width"]),
        "height": int(item["height"]),
        "fps": int(rate) if rate.denominator == 1 else float(rate),
        "frame_count": int(item["nb_read_frames"]),
        "codec": item["codec_name"],
        "audio_streams": len(audio),
    }


def _verify_final_hold(path: Path, expected_bgr: np.ndarray, frames: int) -> tuple[int, float]:
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise RuntimeError("cannot decode rendered whiteboard clip")
    tail: deque[np.ndarray] = deque(maxlen=frames)
    decoded = 0
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        tail.append(frame)
        decoded += 1
    capture.release()
    if len(tail) < frames:
        raise RuntimeError("whiteboard clip is shorter than its required final hold")
    errors = [float(np.mean(np.abs(frame.astype(np.float32) - expected_bgr.astype(np.float32)))) for frame in tail]
    maximum = max(errors)
    if maximum > 8.0:
        raise RuntimeError(f"whiteboard final hold does not show the complete frame: MAE={maximum:.3f}")
    return decoded, maximum


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--episode-workspace", required=True)
    parser.add_argument("--source-image", required=True)
    parser.add_argument("--normalized-image", required=True)
    parser.add_argument("--annotation", required=True)
    parser.add_argument("--preview", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--evidence", required=True)
    parser.add_argument("--ink-path", choices=("grid", "skeleton"), default="grid")
    args = parser.parse_args()

    if not FFMPEG.is_file() or not FFPROBE.is_file():
        raise RuntimeError("the existing system ffmpeg/ffprobe is required; no fallback is allowed")
    root = Path(args.episode_workspace).resolve(strict=True)
    source = resolve_within(root, args.source_image, must_exist=True)
    normalized = resolve_within(root, args.normalized_image, must_exist=True)
    annotation_path = resolve_within(root, args.annotation, must_exist=True)
    preview = resolve_within(root, args.preview, must_exist=True)
    output = resolve_within(root, args.output, must_exist=False)
    evidence_path = resolve_within(root, args.evidence, must_exist=False)
    if output.exists() or evidence_path.exists():
        raise RuntimeError("versioned whiteboard output/evidence already exists; overwrite is forbidden")

    annotation = validate_annotation(read_json(annotation_path), episode_workspace=root)
    with Image.open(source) as source_image:
        source_width, source_height = source_image.size
    source_aspect_error = validate_source_aspect(source_width, source_height)
    if sha256_file(source) != annotation["source_image_sha256"]:
        raise RuntimeError("approved source image checksum does not match annotation")
    if sha256_file(normalized) != annotation["normalized_image_sha256"]:
        raise RuntimeError("approved normalized image checksum does not match annotation")
    normalized_bgr = sr._imread_any(normalized)
    if normalized_bgr is None or normalized_bgr.shape[:2] != (HEIGHT, WIDTH):
        raise RuntimeError("whiteboard normalized image must decode as 1920x1080")

    config = sr.Config(
        fps=FPS,
        cap_long_edge=WIDTH,
        grid_edge=10,
        canvas_hex="#F5EBD7",
        ink_path_mode=args.ink_path,
        color_fill="contour-wipe",
        pause_mode="off",
    )
    renderer = RegionStreamRenderer(
        normalized_bgr,
        _to_upstream(annotation),
        config,
    )
    if (renderer.out_w, renderer.out_h) != (WIDTH, HEIGHT):
        raise RuntimeError("reviewed renderer did not preserve the exact 1920x1080 canvas")

    output.parent.mkdir(parents=True, exist_ok=True)
    evidence_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".whiteboard-render-", dir=output.parent) as temporary:
        raw = Path(temporary) / "raw.mp4"
        renderer.render_to(raw, math.ceil(annotation["total_frames"] * 1000 / FPS))
        raw_capture = cv2.VideoCapture(str(raw))
        raw_count = int(raw_capture.get(cv2.CAP_PROP_FRAME_COUNT))
        raw_capture.release()
        if raw_count < annotation["total_frames"]:
            raise RuntimeError("reviewed renderer produced too few source frames")
        command = [
            str(FFMPEG), "-n", "-loglevel", "error", "-i", str(raw),
            "-map", "0:v:0", "-frames:v", str(annotation["total_frames"]),
            "-r", str(FPS), "-an", "-sn", "-dn", "-c:v", "libx264",
            "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
            "-movflags", "+faststart", str(output),
        ]
        subprocess.run(command, check=True, capture_output=True, text=True)

    media = _probe(output)
    decoded_frames, final_mae = _verify_final_hold(
        output,
        renderer.color_img,
        max(MIN_FINAL_HOLD_FRAMES, annotation["final_hold_frames"]),
    )
    if decoded_frames != annotation["total_frames"]:
        raise RuntimeError("decoded whiteboard frame count does not equal the shot frame count")
    media.update({
        "final_frame_verified": True,
        "full_frame_hold_verified_frames": annotation["final_hold_frames"],
        "final_hold_max_mae": final_mae,
        "ffmpeg_path": str(FFMPEG),
    })
    evidence = {
        "contract_version": "whiteboard-render-evidence-v1",
        "visual_generation_route": ROUTE_ID,
        "drawing_overlay_policy": DRAWING_OVERLAY_POLICY,
        "shot_id": annotation["shot_id"],
        "source_image": {"path": _path_record(source), "sha256": sha256_file(source)},
        "normalized_image": {"path": _path_record(normalized), "sha256": sha256_file(normalized)},
        "annotation": {"path": _path_record(annotation_path), "sha256": sha256_file(annotation_path)},
        "preview": {"path": _path_record(preview), "sha256": sha256_file(preview)},
        "clip": {"path": _path_record(output), "sha256": sha256_file(output)},
        "source_dimensions": [source_width, source_height],
        "source_aspect_ratio_relative_error": source_aspect_error,
        "normalized_dimensions": [WIDTH, HEIGHT],
        "total_frames": annotation["total_frames"],
        "element_order": [element["id"] for element in annotation["elements"]],
        "media": media,
    }
    validate_render_evidence(evidence)
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"result": "pass", "output": _path_record(output), "evidence": _path_record(evidence_path)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
