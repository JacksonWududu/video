#!/usr/bin/env python3
"""Synthesize one locked knowledge-video narration with the approved Edge TTS profile."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path
import sys
from importlib.metadata import version


PROVIDER = "edge-tts"
VOICE = "zh-CN-YunjianNeural"
RATE = "+20%"
MAX_ATTEMPTS = 3


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_locked_text(path: Path) -> tuple[str, str, int]:
    data = path.read_bytes()
    if not data:
        raise ValueError("locked narration text is empty")
    text = data.decode("utf-8")
    if not text.strip():
        raise ValueError("locked narration text contains no spoken content")
    return text, sha256_bytes(data), len(data)


def build_plan(
    text_file: Path,
    output: Path,
    metadata_output: Path,
    text_sha256: str,
    text_bytes: int,
) -> dict:
    return {
        "contract_version": "edge-tts-narration-generation-v1",
        "provider": PROVIDER,
        "voice": VOICE,
        "rate": RATE,
        "text_file": str(text_file),
        "text_checksum_sha256": text_sha256,
        "text_byte_size": text_bytes,
        "output": str(output),
        "metadata_output": str(metadata_output),
        "maximum_attempts": MAX_ATTEMPTS,
    }


async def synthesize(text: str, output: Path, metadata_output: Path) -> tuple[int, str, int]:
    try:
        import edge_tts
    except ModuleNotFoundError as error:
        raise RuntimeError(
            "edge-tts is not installed; install the approved dependency before synthesis"
        ) from error

    if output.exists():
        raise FileExistsError(f"refusing to overwrite existing output: {output}")
    if metadata_output.exists():
        raise FileExistsError(f"refusing to overwrite existing metadata: {metadata_output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    metadata_output.parent.mkdir(parents=True, exist_ok=True)
    audio_partial = output.with_name(f".{output.name}.{os.getpid()}.partial")
    metadata_partial = metadata_output.with_name(
        f".{metadata_output.name}.{os.getpid()}.partial"
    )
    for partial in (audio_partial, metadata_partial):
        if partial.exists():
            raise FileExistsError(f"refusing to overwrite existing partial output: {partial}")
    dependency_version = version("edge-tts")
    last_error: Exception | None = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            communicator = edge_tts.Communicate(text, VOICE, rate=RATE)
            await communicator.save(str(audio_partial), str(metadata_partial))
            if audio_partial.stat().st_size <= 1000:
                raise RuntimeError("Edge TTS returned an unexpectedly small audio file")
            if metadata_partial.stat().st_size == 0:
                raise RuntimeError("Edge TTS returned empty timing metadata")
            metadata_events = [
                json.loads(line)
                for line in metadata_partial.read_bytes().splitlines()
            ]
            if not metadata_events or any(
                event.get("type") not in {"WordBoundary", "SentenceBoundary"}
                for event in metadata_events
            ):
                raise RuntimeError("Edge TTS timing metadata contains unsupported events")
            os.replace(audio_partial, output)
            os.replace(metadata_partial, metadata_output)
            return attempt, dependency_version, len(metadata_events)
        except Exception as error:  # Provider failures have several concrete exception types.
            last_error = error
            audio_partial.unlink(missing_ok=True)
            metadata_partial.unlink(missing_ok=True)
            if attempt < MAX_ATTEMPTS:
                await asyncio.sleep(2 * attempt)
    raise RuntimeError(f"Edge TTS failed after {MAX_ATTEMPTS} attempts") from last_error


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--text-file", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--metadata-output", required=True)
    parser.add_argument("--voice", default=VOICE)
    parser.add_argument("--rate", default=RATE)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.voice != VOICE:
        raise ValueError(f"voice must be {VOICE}")
    if args.rate != RATE:
        raise ValueError(f"rate must be {RATE}")
    text_file = Path(args.text_file).resolve()
    output = Path(args.output).resolve()
    metadata_output = Path(args.metadata_output).resolve()
    text, text_sha256, text_bytes = load_locked_text(text_file)
    record = build_plan(text_file, output, metadata_output, text_sha256, text_bytes)
    if args.dry_run:
        print(json.dumps(record, ensure_ascii=False, indent=2))
        return 0
    attempts, dependency_version, metadata_event_count = asyncio.run(
        synthesize(text, output, metadata_output)
    )
    output_data = output.read_bytes()
    metadata_data = metadata_output.read_bytes()
    record.update({
        "attempts_used": attempts,
        "dependency_version": dependency_version,
        "output_checksum_sha256": sha256_bytes(output_data),
        "output_byte_size": len(output_data),
        "metadata_checksum_sha256": sha256_bytes(metadata_data),
        "metadata_byte_size": len(metadata_data),
        "metadata_event_count": metadata_event_count,
        "status": "generated_pending_audio_validation",
    })
    print(json.dumps(record, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from error
