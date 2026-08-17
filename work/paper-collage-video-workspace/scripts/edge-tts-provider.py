#!/usr/bin/env python3
"""Resilient Edge TTS command adapter for paper-collage-video."""

import argparse
import asyncio
import os
import random

import edge_tts


async def synthesize(text: str, output: str, voice: str, rate: str) -> None:
    if os.path.exists(output) and os.path.getsize(output) > 1000:
        return

    last_error: Exception | None = None
    for attempt in range(6):
        try:
            communicator = edge_tts.Communicate(text, voice, rate=rate)
            await communicator.save(output)
            if os.path.getsize(output) <= 1000:
                raise RuntimeError("Edge TTS returned an unexpectedly small audio file")
            return
        except Exception as error:  # Edge TTS exposes several transient error types.
            last_error = error
            if os.path.exists(output):
                os.remove(output)
            if attempt < 5:
                await asyncio.sleep(2 * (attempt + 1) + random.uniform(0, 2))

    raise RuntimeError("Edge TTS failed after six attempts") from last_error


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--text", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--voice", default="zh-CN-YunxiNeural")
    parser.add_argument("--rate", default="+10%")
    args = parser.parse_args()
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    asyncio.run(synthesize(args.text, args.output, args.voice, args.rate))


if __name__ == "__main__":
    main()
