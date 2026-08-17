#!/usr/bin/env python3
"""Classification tests for the episode workspace validator."""

from __future__ import annotations

import importlib.util
from pathlib import Path


SCRIPT = Path(__file__).with_name("validate_episode_workspace.py")
SPEC = importlib.util.spec_from_file_location("validate_episode_workspace", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

assert MODULE._expected_category(Path("storyboard-v2.md")) == ("assets", "narration")
assert MODULE._expected_category(Path("final-storyboard-review.md")) == ("assets", "narration")
assert MODULE._expected_category(Path("visual-batch-review.md")) == ("docs",)
assert MODULE._expected_category(Path("assets/audio/user-source/voice-v01.mp3")) == ("assets", "audio")
print("episode_workspace_category_tests=pass")
