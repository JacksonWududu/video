#!/usr/bin/env python3
"""Validate a completed knowledge-narration package without modifying it."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import stat
import sys
import unicodedata

from next_output_paths import (
    ContractError,
    OUTPUT_ROOT,
    package_paths,
    validate_source_file,
    validate_topic,
)


DIAGNOSIS_HEADINGS = (
    "# 创作诊断",
    "## 基本信息",
    "## 所选方向",
    "## 钩子依据",
    "## 结构图",
    "## 五维诊断",
    "## 事实—证据—边界",
    "## 来源",
    "## 字数与估时",
)
PUBLISHING_HEADINGS = (
    "# B站发布包",
    "## 标题候选",
    "## 封面文案",
    "## 视频简介",
    "## 标签建议",
    "## 置顶评论问题",
    "## 抖音横屏复用文案",
    "## 视频号复用文案",
)
DIAGNOSTIC_DIMENSIONS = ("钩子", "逻辑", "具体性", "AI 味", "传播力")
FORBIDDEN_TXT_PATTERNS = (
    (re.compile(r"(?m)^#{1,6}\s"), "口播稿不得含 Markdown 标题"),
    (re.compile(r"```|https?://|\*\*|\[[^\n]*\]"), "口播稿不得含代码围栏、链接或 Markdown 标记"),
    (re.compile(r"(?mi)^\s*[-*+]\s+"), "口播稿不得含项目符号"),
    (re.compile(r"(?m)^\s*\d+[.、]\s*"), "口播稿不得含可见编号"),
    (re.compile(r"核心观点|第一部分|第二部分|第三部分|镜头|BGM|停顿|预[计估]时长|参考资料|事实依据"), "口播稿含内部结构或制作标签"),
    (re.compile(r"请(?:大家)?(?:点赞|关注|收藏|转发)|记得(?:点赞|关注|收藏|转发)|点赞关注|一键三连"), "口播稿不得默认索取互动"),
)
FORBIDDEN_PROMISES = re.compile(r"必火|保证播放量|百分之百爆|科学证明所有人|所有人都会")
DEFAULT_TARGET_MIN_SECONDS = 180.0
DEFAULT_TARGET_MAX_SECONDS = 240.0
HARD_MAX_SECONDS = 600.0
EXTENSION_BASIS_TERMS = ("证据", "机制", "边界", "反例", "可执行方法")
MIN_EXTENSION_BASIS_CHARACTERS = 12
DOMESTIC_RELEVANCE_FIELDS = (
    "目标人群",
    "现实需求",
    "具体痛点",
    "可感知槽点",
    "正文原句",
    "泛化边界",
)
MIN_DOMESTIC_FIELD_CHARACTERS = 4
MIN_DOMESTIC_EXCERPT_CHARACTERS = 8
GENERIC_DOMESTIC_AUDIENCES = {
    "中国人",
    "国内大众",
    "中国大众",
    "中国大陆普通公众",
    "大家",
    "所有人",
    "普通人",
    "当代年轻人",
}


def _read_regular_utf8(path: Path, label: str, errors: list[str]) -> str:
    if path.is_symlink():
        errors.append(f"{label}不得是符号链接：{path}")
        return ""
    try:
        metadata = path.lstat()
    except FileNotFoundError:
        errors.append(f"缺少{label}：{path}")
        return ""
    if not stat.S_ISREG(metadata.st_mode):
        errors.append(f"{label}必须是普通文件：{path}")
        return ""
    try:
        return path.read_bytes().decode("utf-8-sig")
    except UnicodeDecodeError:
        errors.append(f"{label}必须是 UTF-8 或 UTF-8-SIG：{path}")
        return ""


def spoken_character_count(text: str) -> int:
    return sum(
        1
        for character in text
        if not character.isspace()
        and not unicodedata.category(character).startswith("P")
    )


def _check_heading_order(text: str, headings: tuple[str, ...], label: str, errors: list[str]) -> None:
    positions: list[int] = []
    for heading in headings:
        match = re.search(rf"(?m)^{re.escape(heading)}\s*$", text)
        if not match:
            errors.append(f"{label}缺少标题：{heading}")
        else:
            positions.append(match.start())
    if len(positions) == len(headings) and positions != sorted(positions):
        errors.append(f"{label}标题顺序不符合契约")


def _section(text: str, heading: str) -> str:
    match = re.search(rf"(?m)^{re.escape(heading)}\s*$", text)
    if not match:
        return ""
    start = match.end()
    next_heading = re.search(r"(?m)^#{1,2}\s+", text[start:])
    end = start + next_heading.start() if next_heading else len(text)
    return text[start:end].strip()


def _numbered_items(section: str) -> list[tuple[int, str]]:
    return [
        (int(match.group(1)), match.group(2).strip())
        for match in re.finditer(r"(?m)^\s*(\d+)\.\s+(.+?)\s*$", section)
    ]


def _parse_version(value: str) -> int:
    normalized = value.strip().lower()
    if normalized.startswith("v"):
        normalized = normalized[1:]
    if not re.fullmatch(r"\d{3}", normalized):
        raise ContractError("版本必须是 NNN 或 vNNN，例如 001")
    version = int(normalized)
    if version < 1 or version > 999:
        raise ContractError("版本号必须在 001 到 999 之间")
    return version


def validate_package(
    topic: str,
    version: int,
    output_root: Path = OUTPUT_ROOT,
    source_file: Path | None = None,
    source_sha256: str | None = None,
) -> dict[str, object]:
    safe_topic = validate_topic(topic)
    paths = package_paths(safe_topic, version, output_root)
    errors: list[str] = []
    warnings: list[str] = []

    narration = _read_regular_utf8(paths["narration"], "口播稿", errors)
    diagnosis = _read_regular_utf8(paths["diagnosis"], "创作诊断", errors)
    publishing = _read_regular_utf8(paths["publishing"], "B站发布包", errors)

    if narration:
        lines = narration.splitlines()
        opening = f"苏格拉底的猫今天聊的是，{safe_topic}"
        if not lines or lines[0] != opening:
            errors.append(f"口播稿第一行必须严格等于：{opening}")
        if len(lines) < 3 or lines[1] != "":
            errors.append("固定首行后必须空一行")
        nonempty = [line.strip() for line in lines if line.strip()]
        if len(nonempty) < 2 or spoken_character_count(nonempty[1]) < 8:
            errors.append("第二个非空段落必须存在，且应能承担增长钩子")
        for pattern, message in FORBIDDEN_TXT_PATTERNS:
            if pattern.search(narration):
                errors.append(message)
        if FORBIDDEN_PROMISES.search(narration):
            errors.append("口播钩子或正文含无法保证的传播或证据承诺")

    character_count = spoken_character_count(narration) if narration else 0
    slow_seconds = round(character_count / 4.0, 1) if character_count else 0.0
    fast_seconds = round(character_count / 4.5, 1) if character_count else 0.0
    if character_count:
        if slow_seconds > HARD_MAX_SECONDS:
            errors.append(
                f"估算时长约 {fast_seconds}-{slow_seconds} 秒，超过 600 秒（10 分钟）硬上限"
            )
        elif fast_seconds < DEFAULT_TARGET_MIN_SECONDS:
            warnings.append(
                f"估算时长约 {fast_seconds}-{slow_seconds} 秒，低于 180-240 秒默认目标区间"
            )

    if diagnosis:
        _check_heading_order(diagnosis, DIAGNOSIS_HEADINGS, "创作诊断", errors)
        for expected in (
            f"选题：{safe_topic}",
            f"版本：v{version:03d}",
        ):
            if expected not in diagnosis:
                errors.append(f"创作诊断缺少基本信息：{expected}")

        mode_match = re.search(r"创作模式[：:]\s*(从零创作|旧稿改写)", diagnosis)
        mode = mode_match.group(1) if mode_match else None
        if not mode:
            errors.append("创作诊断必须声明创作模式：从零创作或旧稿改写")

        selected_direction = _section(diagnosis, "## 所选方向")
        if not re.search(
            r"(?m)^\s*[-*]\s+国内大众切口[：:]\s*$", selected_direction
        ):
            errors.append("所选方向必须记录国内大众切口")
        domestic_fields: dict[str, str] = {}
        for field in DOMESTIC_RELEVANCE_FIELDS:
            field_match = re.search(
                rf"(?m)^\s*[-*]\s+{re.escape(field)}[：:]\s*(\S.*?)\s*$",
                selected_direction,
            )
            if not field_match:
                errors.append(f"国内大众切口缺少字段：{field}")
                continue
            value = field_match.group(1).strip()
            domestic_fields[field] = value
            minimum = (
                MIN_DOMESTIC_EXCERPT_CHARACTERS
                if field == "正文原句"
                else MIN_DOMESTIC_FIELD_CHARACTERS
            )
            if spoken_character_count(value) < minimum:
                errors.append(f"国内大众切口字段过于空泛：{field}")

        target_audience = domestic_fields.get("目标人群", "")
        normalized_audience = re.sub(r"[\s，。、“”'\"：:；;]+", "", target_audience)
        if normalized_audience in GENERIC_DOMESTIC_AUDIENCES:
            errors.append("国内大众切口的目标人群不得只写泛化群体标签")

        narration_excerpt = domestic_fields.get("正文原句", "").strip("“”'\"")
        if narration and narration_excerpt and narration_excerpt not in narration:
            errors.append("国内大众切口的正文原句必须逐字存在于口播稿")

        for dimension in DIAGNOSTIC_DIMENSIONS:
            if not re.search(
                rf"(?m)^\s*[-*]?\s*{re.escape(dimension)}[：:]\s*(强|可用|需改)(?:\s|$)",
                diagnosis,
            ):
                errors.append(f"五维诊断缺少合法评级：{dimension}")

        normalized_table_header = re.sub(r"\s+", "", diagnosis)
        if "|主张|核验结论|证据边界|来源|" not in normalized_table_header:
            errors.append("事实—证据—边界表缺少固定列")
        evidence_section = _section(diagnosis, "## 事实—证据—边界")
        evidence_rows = [
            line
            for line in evidence_section.splitlines()
            if line.strip().startswith("|")
            and "主张" not in line
            and not re.fullmatch(r"[|\s:-]+", line)
        ]
        if not evidence_rows:
            errors.append("事实—证据—边界表至少需要一条实质性主张记录")
        if not re.search(r"\]\(https://[^)]+\)", diagnosis):
            errors.append("创作诊断必须包含至少一个直接 HTTPS Markdown 来源链接")
        timing = _section(diagnosis, "## 字数与估时")
        if str(character_count) not in timing:
            errors.append("字数与估时未记录口播稿实际去标点字符数")
        if "4.0 字/秒" not in timing or "4.5 字/秒" not in timing:
            errors.append("字数与估时必须同时记录 4.0 与 4.5 字/秒估算")
        if DEFAULT_TARGET_MAX_SECONDS < slow_seconds <= HARD_MAX_SECONDS:
            extension_match = re.search(
                r"(?m)^\s*[-*]?\s*延长依据[：:]\s*(\S.*?)\s*$", timing
            )
            if not extension_match:
                errors.append("超过 4 分钟的口播必须在字数与估时中记录延长依据")
            else:
                extension_basis = extension_match.group(1).strip()
                has_information_function = any(
                    term in extension_basis for term in EXTENSION_BASIS_TERMS
                )
                if (
                    not has_information_function
                    or spoken_character_count(extension_basis)
                    < MIN_EXTENSION_BASIS_CHARACTERS
                ):
                    errors.append(
                        "延长依据必须具体说明新增的证据、机制、边界、反例或可执行方法"
                    )

        if mode == "旧稿改写":
            if not re.search(r"(?m)^## 主要修改对照\s*$", diagnosis):
                errors.append("旧稿改写的诊断必须包含主要修改对照")
            if source_file is None or source_sha256 is None:
                errors.append("旧稿改写必须提供源文件和写作前 SHA-256 进行校验")
        elif source_file is not None or source_sha256 is not None:
            errors.append("从零创作不应传入旧稿校验参数")

    if publishing:
        _check_heading_order(publishing, PUBLISHING_HEADINGS, "B站发布包", errors)
        titles = _numbered_items(_section(publishing, "## 标题候选"))
        if [number for number, _ in titles] != [1, 2, 3, 4, 5]:
            errors.append("标题候选必须恰好使用 1-5 编号")
        covers = _numbered_items(_section(publishing, "## 封面文案"))
        if [number for number, _ in covers] != [1, 2, 3]:
            errors.append("封面文案必须恰好使用 1-3 编号")
        for _, cover in covers:
            if len(re.sub(r"\s+", "", cover)) > 12:
                errors.append(f"封面文案超过 12 个字符：{cover}")
        tag_lines = re.findall(
            r"(?m)^\s*-\s+\S.+?$", _section(publishing, "## 标签建议")
        )
        if not 6 <= len(tag_lines) <= 10:
            errors.append("标签建议必须为 6-10 个逐行项目")
        for heading in (
            "## 视频简介",
            "## 置顶评论问题",
            "## 抖音横屏复用文案",
            "## 视频号复用文案",
        ):
            if not _section(publishing, heading):
                errors.append(f"B站发布包内容不能为空：{heading}")
        if FORBIDDEN_PROMISES.search(publishing):
            errors.append("B站发布包含无法保证的传播或证据承诺")

    if source_file is not None or source_sha256 is not None:
        if source_file is None or source_sha256 is None:
            errors.append("源文件与写作前 SHA-256 必须同时提供")
        else:
            try:
                current_source = validate_source_file(source_file)
                if not re.fullmatch(r"[0-9a-f]{64}", source_sha256):
                    errors.append("写作前 SHA-256 格式无效")
                elif current_source["sha256"] != source_sha256:
                    errors.append("源稿 SHA-256 已变化，违反只读要求")
                if diagnosis:
                    if str(current_source["path"]) not in diagnosis:
                        errors.append("创作诊断未记录源文件路径")
                    if source_sha256 not in diagnosis:
                        errors.append("创作诊断未记录写作前 SHA-256")
            except (ContractError, OSError) as error:
                errors.append(str(error))

    return {
        "passed": not errors,
        "topic": safe_topic,
        "version": f"v{version:03d}",
        "files": {key: str(value) for key, value in paths.items() if key != "directory"},
        "stats": {
            "spoken_characters": character_count,
            "estimated_seconds_at_4_5": fast_seconds,
            "estimated_seconds_at_4_0": slow_seconds,
        },
        "warnings": warnings,
        "errors": errors,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="只读校验知识口播创作包。")
    parser.add_argument("--topic", required=True)
    parser.add_argument("--version", required=True, help="NNN 或 vNNN")
    parser.add_argument("--source-file", type=Path)
    parser.add_argument("--source-sha256")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        report = validate_package(
            topic=args.topic,
            version=_parse_version(args.version),
            source_file=args.source_file,
            source_sha256=args.source_sha256,
        )
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0 if report["passed"] else 1
    except (ContractError, OSError) as error:
        print(f"validate_package failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
