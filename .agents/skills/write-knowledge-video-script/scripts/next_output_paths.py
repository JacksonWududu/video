#!/usr/bin/env python3
"""Resolve the next narration-package paths without writing anything."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import sys


REPO_ROOT = Path(__file__).resolve().parents[4]
OUTPUT_ROOT = REPO_ROOT / "output" / "codexVoiceScript"
DEFAULT_SOURCE_ROOT = Path("/Users/jackson/Desktop/video-edit/script-resource")
PACKAGE_ROLES = ("口播稿", "创作诊断", "B站发布包")


class ContractError(ValueError):
    """Raised when a path would violate the standalone output contract."""


def validate_topic(topic: str) -> str:
    if topic != topic.strip():
        raise ContractError("选题首尾不得含空白")
    if not topic or topic in {".", ".."}:
        raise ContractError("选题不能为空或路径段")
    if len(topic) > 80:
        raise ContractError("选题不得超过 80 个字符")
    if "/" in topic or "\\" in topic:
        raise ContractError("选题不得包含路径分隔符")
    if any(ord(character) < 32 or ord(character) == 127 for character in topic):
        raise ContractError("选题不得包含控制字符")
    return topic


def _assert_not_symlink(path: Path, label: str) -> None:
    if path.is_symlink():
        raise ContractError(f"{label}不得是符号链接：{path}")


def validate_source_file(path: Path) -> dict[str, str | int]:
    source = path.expanduser()
    _assert_not_symlink(source, "源文件")
    try:
        metadata = source.lstat()
    except FileNotFoundError as error:
        raise ContractError(f"源文件不存在：{source}") from error
    if not stat.S_ISREG(metadata.st_mode):
        raise ContractError(f"源文件必须是普通文件：{source}")
    if not os.access(source, os.R_OK):
        raise ContractError(f"源文件不可读：{source}")

    raw = source.read_bytes()
    try:
        raw.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise ContractError(f"源文件必须是 UTF-8 或 UTF-8-SIG：{source}") from error

    return {
        "path": str(source.resolve()),
        "sha256": hashlib.sha256(raw).hexdigest(),
        "bytes": len(raw),
    }


def default_source_path(topic: str) -> Path:
    safe_topic = validate_topic(topic)
    return DEFAULT_SOURCE_ROOT / safe_topic / f"{safe_topic}_口播稿.txt"


def _validate_output_root(root: Path) -> Path:
    root = root.absolute()
    if root == OUTPUT_ROOT.absolute():
        try:
            root.relative_to(REPO_ROOT)
        except ValueError as error:
            raise ContractError("生产输出根目录必须位于仓库内") from error
        relative_parts = root.relative_to(REPO_ROOT).parts
        current = REPO_ROOT
        for part in relative_parts:
            current = current / part
            if current.exists() or current.is_symlink():
                _assert_not_symlink(current, "生产输出路径")
    elif root.exists() or root.is_symlink():
        # Non-production roots exist only for imported function tests. Do not
        # reject macOS's system-level /var -> /private/var link.
        _assert_not_symlink(root, "测试输出根目录")
    return root


def package_paths(topic: str, version: int, output_root: Path = OUTPUT_ROOT) -> dict[str, Path]:
    safe_topic = validate_topic(topic)
    if version < 1 or version > 999:
        raise ContractError("版本号必须在 001 到 999 之间")
    root = _validate_output_root(output_root)
    topic_dir = root / safe_topic
    _assert_not_symlink(topic_dir, "选题输出目录")
    version_text = f"v{version:03d}"
    return {
        "directory": topic_dir,
        "narration": topic_dir / f"{safe_topic}_口播稿_{version_text}.txt",
        "diagnosis": topic_dir / f"{safe_topic}_创作诊断_{version_text}.md",
        "publishing": topic_dir / f"{safe_topic}_B站发布包_{version_text}.md",
    }


def resolve_next(topic: str, output_root: Path = OUTPUT_ROOT) -> dict[str, object]:
    safe_topic = validate_topic(topic)
    for version in range(1, 1000):
        paths = package_paths(safe_topic, version, output_root)
        targets = (paths["narration"], paths["diagnosis"], paths["publishing"])
        if not any(path.exists() or path.is_symlink() for path in targets):
            return {
                "topic": safe_topic,
                "version": f"v{version:03d}",
                "directory": str(paths["directory"]),
                "files": {
                    "narration": str(paths["narration"]),
                    "diagnosis": str(paths["diagnosis"]),
                    "publishing": str(paths["publishing"]),
                },
            }
    raise ContractError("选题版本已用尽：v001-v999")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="只读解析下一创作包版本，并可校验及哈希一个旧稿源文件。"
    )
    parser.add_argument("--topic", required=True, help="单一知识选题")
    source_group = parser.add_mutually_exclusive_group()
    source_group.add_argument("--source-file", type=Path, help="明确旧稿路径")
    source_group.add_argument(
        "--default-source",
        action="store_true",
        help="使用 script-resource/<选题>/<选题>_口播稿.txt",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        result = resolve_next(args.topic)
        source_path = default_source_path(args.topic) if args.default_source else args.source_file
        if source_path is not None:
            result["source"] = validate_source_file(source_path)
            result["mode"] = "旧稿改写"
        else:
            result["mode"] = "从零创作"
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (ContractError, OSError) as error:
        print(f"next_output_paths failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
