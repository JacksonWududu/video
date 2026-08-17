#!/usr/bin/env python3
"""Create an offline word-timestamped faster-whisper transcript."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

os.environ.setdefault("HF_HUB_OFFLINE", "1")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("audio", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--model", default="small")
    parser.add_argument("--language", default="zh")
    parser.add_argument("--beam-size", type=int, default=5)
    parser.add_argument("--no-vad", action="store_true")
    parser.add_argument("--no-condition-on-previous-text", action="store_true")
    args = parser.parse_args()

    if not args.audio.is_file() or args.audio.is_symlink() or args.audio.stat().st_size == 0:
        raise ValueError("audio must be a non-empty real regular file")

    try:
        import av
        import ctranslate2
        import faster_whisper
        from faster_whisper import WhisperModel
    except ImportError as error:
        raise RuntimeError(
            "Required local packages are unavailable; inspect the workspace before requesting any download"
        ) from error

    model = WhisperModel(args.model, device="cpu", compute_type="int8")
    segments, info = model.transcribe(
        str(args.audio),
        language=args.language,
        vad_filter=not args.no_vad,
        word_timestamps=True,
        beam_size=args.beam_size,
        condition_on_previous_text=not args.no_condition_on_previous_text,
    )
    payload = {
        "engine": "faster-whisper",
        "engine_version": faster_whisper.__version__,
        "ctranslate2_version": ctranslate2.__version__,
        "av_version": av.__version__,
        "model": args.model,
        "device": "cpu",
        "compute_type": "int8",
        "beam_size": args.beam_size,
        "vad_filter": not args.no_vad,
        "condition_on_previous_text": not args.no_condition_on_previous_text,
        "language": info.language,
        "language_probability": info.language_probability,
        "duration": info.duration,
        "duration_after_vad": info.duration_after_vad,
        "segments": [],
    }
    for segment in segments:
        payload["segments"].append(
            {
                "id": segment.id,
                "start": segment.start,
                "end": segment.end,
                "text": segment.text.strip(),
                "words": [
                    {
                        "start": word.start,
                        "end": word.end,
                        "word": word.word,
                        "probability": word.probability,
                    }
                    for word in (segment.words or [])
                ],
            }
        )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(f"{args.output.suffix}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(args.output)


if __name__ == "__main__":
    main()
