from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path


REQUIRED_TOP = {"assets", "script", "schema", "docs"}
REQUIRED_ASSETS = {"audio", "image", "narration", "video"}
EXTENSION_CATEGORIES = {
    ".json": ("schema",),
    ".js": ("script",),
    ".jsx": ("script",),
    ".ts": ("script",),
    ".tsx": ("script",),
    ".mjs": ("script",),
    ".cjs": ("script",),
    ".py": ("script",),
    ".sh": ("script",),
    ".mp3": ("assets", "audio"),
    ".wav": ("assets", "audio"),
    ".aac": ("assets", "audio"),
    ".m4a": ("assets", "audio"),
    ".flac": ("assets", "audio"),
    ".ogg": ("assets", "audio"),
    ".png": ("assets", "image"),
    ".jpg": ("assets", "image"),
    ".jpeg": ("assets", "image"),
    ".webp": ("assets", "image"),
    ".svg": ("assets", "image"),
    ".gif": ("assets", "image"),
    ".mp4": ("assets", "video"),
    ".mov": ("assets", "video"),
    ".mkv": ("assets", "video"),
    ".webm": ("assets", "video"),
    ".srt": ("assets", "narration"),
    ".vtt": ("assets", "narration"),
    ".ass": ("assets", "narration"),
    ".md": ("docs",),
    ".pdf": ("docs",),
    ".csv": ("docs",),
    ".tsv": ("docs",),
    ".docx": ("docs",),
}
NARRATION_TEXT_MARKERS = (
    "narration",
    "voiceover",
    "subtitle",
    "storyboard",
    "shot",
    "transcript",
    "口播",
    "字幕",
    "分镜",
    "转写",
)


def _expected_category(path: Path) -> tuple[str, ...] | None:
    suffix = path.suffix.lower()
    if suffix in {".txt", ".md"} and any(
        marker in path.name.lower() for marker in NARRATION_TEXT_MARKERS
    ):
        return ("assets", "narration")
    return EXTENSION_CATEGORIES.get(suffix)


def validate_episode_workspace(repo_root: Path, workspace_arg: Path) -> list[str]:
    errors: list[str] = []
    repo = repo_root.resolve(strict=True)
    episode_parent = (repo / "leverage-video" / "src").resolve(strict=True)
    candidate = workspace_arg if workspace_arg.is_absolute() else repo / workspace_arg

    if candidate.is_symlink():
        return [f"Workspace is a symlink: {candidate}"]

    try:
        workspace = candidate.resolve(strict=True)
    except FileNotFoundError:
        return [f"Workspace does not exist: {candidate}"]

    if workspace.parent != episode_parent or not re.fullmatch(
        r"topic[0-9]+", workspace.name
    ):
        return [
            "Workspace must be a real direct child topic<N> under "
            f"leverage-video/src: {workspace}"
        ]
    if not workspace.is_dir():
        return [f"Workspace is not a directory: {workspace}"]

    for relative in REQUIRED_TOP:
        path = workspace / relative
        if path.is_symlink() or not path.is_dir():
            errors.append(
                f"Missing or symlinked required directory: {path.relative_to(repo)}"
            )

    assets = workspace / "assets"
    for relative in REQUIRED_ASSETS:
        path = assets / relative
        if path.is_symlink() or not path.is_dir():
            errors.append(
                f"Missing or symlinked required directory: {path.relative_to(repo)}"
            )

    observed_top = {path.name for path in workspace.iterdir() if path.is_dir()}
    for name in sorted(observed_top - REQUIRED_TOP):
        errors.append(
            f"Unexpected episode-level directory: {(workspace / name).relative_to(repo)}"
        )

    if assets.is_dir() and not assets.is_symlink():
        observed_assets = {path.name for path in assets.iterdir() if path.is_dir()}
        for name in sorted(observed_assets - REQUIRED_ASSETS):
            errors.append(
                f"Unexpected assets-level directory: {(assets / name).relative_to(repo)}"
            )

    for root, dirnames, filenames in os.walk(workspace, followlinks=False):
        root_path = Path(root)
        for name in tuple(dirnames) + tuple(filenames):
            path = root_path / name
            if path.is_symlink():
                errors.append(f"Symlink is not allowed: {path.relative_to(repo)}")

        for filename in filenames:
            path = root_path / filename
            expected = _expected_category(path)
            if expected is None:
                continue
            relative = path.relative_to(workspace)
            if relative.parts[: len(expected)] != expected:
                expected_text = "/".join(expected)
                errors.append(
                    f"Misplaced artifact: {path.relative_to(repo)}; "
                    f"expected under {expected_text}/"
                )

    return sorted(set(errors))


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate one knowledge-video episode workspace."
    )
    parser.add_argument("workspace", type=Path)
    args = parser.parse_args()
    repo_root = Path(__file__).resolve().parents[4]
    errors = validate_episode_workspace(repo_root, args.workspace)
    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 1
    print(f"Valid episode workspace: {args.workspace}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
