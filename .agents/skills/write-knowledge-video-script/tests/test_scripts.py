#!/usr/bin/env python3
from pathlib import Path
import sys
import tempfile
import unittest


SKILL_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL_DIR / "scripts"))

from next_output_paths import (  # noqa: E402
    ContractError,
    package_paths,
    resolve_next,
    validate_source_file,
    validate_topic,
)
from validate_package import spoken_character_count, validate_package  # noqa: E402


TOPIC = "聚光灯效应"
DOMESTIC_RELEVANCE_BLOCK = """- 国内大众切口：
  - 目标人群：需要在团队会议中发言的国内职场人
  - 现实需求：减少口误后的反复内耗，并判断是否需要补救
  - 具体痛点：缺少判断同事仍在关注口误的可观察标准
  - 可感知槽点：别人已经散会，自己却还像在接受全场审判
  - 正文原句：想象你开会时说错一个词，散会以后还在反复回想。
  - 泛化边界：该场景不代表所有职场人的共同经历，也不证明真实反馈不重要。"""


def narration_text(topic: str = TOPIC, opening_topic: str | None = None) -> str:
    opening = opening_topic if opening_topic is not None else topic
    return (
        f"苏格拉底的猫今天聊的是，{opening}\n\n"
        "真正让你紧张的，往往不是别人看见了你，而是你高估了别人会看你多久。\n\n"
        "想象你开会时说错一个词，散会以后还在反复回想。可同桌的人已经在赶下一项任务。"
        "这种注意力差异，正是理解这个概念的入口。\n\n"
        "它并不表示别人永远不会注意你，也不能替代对真实反馈的判断。"
        "更稳妥的问题是：眼前有多少可以观察的证据，能说明别人仍在关注这件事？\n"
    )


def expanded_narration_text(minimum_spoken_characters: int) -> str:
    narration = narration_text()
    paragraph = "\n\n这个例子还可以继续检验行动是否改变了结果，以及哪些条件仍然没有变化。"
    while spoken_character_count(narration) < minimum_spoken_characters:
        narration += paragraph
    return narration


def diagnosis_text(
    narration: str,
    topic: str = TOPIC,
    version: str = "v001",
    mode: str = "从零创作",
    source_path: str | None = None,
    source_sha256: str | None = None,
    include_source_link: bool = True,
    extension_basis: str | None = None,
    domestic_relevance: str | None = DOMESTIC_RELEVANCE_BLOCK,
) -> str:
    count = spoken_character_count(narration)
    source_info = ""
    modification = ""
    if mode == "旧稿改写":
        source_info = f"\n- 源文件：{source_path}\n- 写作前 SHA-256：{source_sha256}"
        modification = "\n## 主要修改对照\n\n- 将泛问句改为可核验的注意力冲突。\n"
    extension_line = (
        f"\n- 延长依据：{extension_basis}" if extension_basis is not None else ""
    )
    link = "[原始研究](https://example.edu/research)" if include_source_link else "无"
    domestic_line = (
        f"\n{domestic_relevance}"
        if domestic_relevance is not None
        else ""
    )
    return f"""# 创作诊断

## 基本信息

- 选题：{topic}
- 创作模式：{mode}
- 版本：{version}{source_info}

## 所选方向

从高估关注切入，解释注意力判断偏差。{domestic_line}

## 钩子依据

第二句把主观紧张与他人实际注意时间放在一起。

## 结构图

紧张场景 → 概念解释 → 适用边界 → 判断问题。

## 五维诊断

- 钩子：强 冲突明确。
- 逻辑：强 单一问题连续推进。
- 具体性：可用 含会议场景。
- AI 味：强 无元评论和排比堆叠。
- 传播力：可用 有可复用判断。

## 事实—证据—边界

| 主张 | 核验结论 | 证据边界 | 来源 |
| --- | --- | --- | --- |
| 人会高估他人对自己的注意 | 有实验支持 | 不代表他人从不关注 | {link} |

## 来源

- {link}

## 字数与估时

- 去标点字符数：{count}
- 4.0 字/秒：{count / 4.0:.1f} 秒
- 4.5 字/秒：{count / 4.5:.1f} 秒
- 默认目标区间：180–240 秒；本测试短稿只验证结构，且未超过 600 秒硬上限。{extension_line}
{modification}"""


def publishing_text(extra_title: str = "", promise: str = "") -> str:
    return f"""# B站发布包

## 标题候选

1. 为什么一次口误会困住你一整天
2. 聚光灯效应：别人没你想得那么在意
3. 总觉得被注视，可能错在这个判断
4. 如何判断别人是否真的在关注你
5. 聚光灯效应到底是什么{extra_title}

## 封面文案

1. 别人没那么在意
2. 谁在盯着你
3. 放大的是注意

## 视频简介

用会议口误的场景解释聚光灯效应，以及它不能替代真实反馈的边界。{promise}

## 标签建议

- 心理学
- 知识科普
- 聚光灯效应
- 认知偏差
- 社会心理学
- 自我判断

## 置顶评论问题

你最近一次以为大家都在注意你，后来发现实际情况怎样？

## 抖音横屏复用文案

一次口误，别人究竟会记多久？用一个心理学概念重新判断。

## 视频号复用文案

我们常高估别人对自己的关注，但真实反馈仍然重要。
"""


class PathResolverTests(unittest.TestCase):
    def test_resolves_v001_without_writing(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            result = resolve_next(TOPIC, root)
            self.assertEqual(result["version"], "v001")
            self.assertFalse((root / TOPIC).exists())

    def test_partial_version_occupies_the_whole_version(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            paths = package_paths(TOPIC, 1, root)
            paths["directory"].mkdir(parents=True)
            paths["narration"].write_text("occupied", encoding="utf-8")
            self.assertEqual(resolve_next(TOPIC, root)["version"], "v002")

    def test_rejects_unsafe_topic(self) -> None:
        for topic in ("", "..", "心理/学", " 心理学", "心理学\n"):
            with self.subTest(topic=topic), self.assertRaises(ContractError):
                validate_topic(topic)

    def test_source_must_exist_and_be_read_only_input(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "source.txt"
            with self.assertRaises(ContractError):
                validate_source_file(source)
            source.write_text("原始口播", encoding="utf-8")
            before = validate_source_file(source)
            after = validate_source_file(source)
            self.assertEqual(before["sha256"], after["sha256"])


class PackageValidatorTests(unittest.TestCase):
    def _write_package(
        self,
        root: Path,
        narration: str,
        diagnosis: str,
        publishing: str,
    ) -> None:
        paths = package_paths(TOPIC, 1, root)
        paths["directory"].mkdir(parents=True)
        paths["narration"].write_text(narration, encoding="utf-8")
        paths["diagnosis"].write_text(diagnosis, encoding="utf-8")
        paths["publishing"].write_text(publishing, encoding="utf-8")

    def test_valid_from_scratch_package_passes_with_only_length_warning(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            narration = narration_text()
            self._write_package(
                root, narration, diagnosis_text(narration), publishing_text()
            )
            report = validate_package(TOPIC, 1, root)
            self.assertTrue(report["passed"], report["errors"])
            self.assertTrue(report["warnings"])

    def test_default_duration_package_has_no_length_warning(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            narration = expanded_narration_text(820)
            self._write_package(
                root, narration, diagnosis_text(narration), publishing_text()
            )
            report = validate_package(TOPIC, 1, root)
            self.assertTrue(report["passed"], report["errors"])
            self.assertFalse(report["warnings"], report["warnings"])

    def test_justified_extension_up_to_ten_minutes_passes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            narration = expanded_narration_text(1200)
            diagnosis = diagnosis_text(
                narration,
                extension_basis="补充必要的研究证据、作用机制、证据边界和可执行方法。",
            )
            self._write_package(root, narration, diagnosis, publishing_text())
            report = validate_package(TOPIC, 1, root)
            self.assertTrue(report["passed"], report["errors"])
            self.assertFalse(report["warnings"], report["warnings"])

    def test_extension_without_basis_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            narration = expanded_narration_text(1200)
            self._write_package(
                root, narration, diagnosis_text(narration), publishing_text()
            )
            report = validate_package(TOPIC, 1, root)
            self.assertFalse(report["passed"])
            self.assertTrue(any("延长依据" in item for item in report["errors"]))

    def test_generic_extension_basis_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            narration = expanded_narration_text(1200)
            diagnosis = diagnosis_text(
                narration, extension_basis="内容丰富，需要讲得更加完整。"
            )
            self._write_package(root, narration, diagnosis, publishing_text())
            report = validate_package(TOPIC, 1, root)
            self.assertFalse(report["passed"])
            self.assertTrue(
                any("新增的证据" in item for item in report["errors"])
            )

    def test_duration_over_ten_minutes_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            narration = expanded_narration_text(2500)
            diagnosis = diagnosis_text(
                narration,
                extension_basis="补充必要的研究证据、作用机制、证据边界和可执行方法。",
            )
            self._write_package(
                root, narration, diagnosis, publishing_text()
            )
            report = validate_package(TOPIC, 1, root)
            self.assertFalse(report["passed"])
            self.assertTrue(any("10 分钟" in item for item in report["errors"]))

    def test_wrong_opening_and_exaggerated_promise_fail(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            narration = narration_text(opening_topic="别的选题")
            self._write_package(
                root,
                narration,
                diagnosis_text(narration),
                publishing_text(promise="保证播放量，必火。"),
            )
            report = validate_package(TOPIC, 1, root)
            self.assertFalse(report["passed"])
            self.assertTrue(any("第一行" in item for item in report["errors"]))
            self.assertTrue(any("传播或证据承诺" in item for item in report["errors"]))

    def test_missing_evidence_link_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            narration = narration_text()
            self._write_package(
                root,
                narration,
                diagnosis_text(narration, include_source_link=False),
                publishing_text(),
            )
            report = validate_package(TOPIC, 1, root)
            self.assertFalse(report["passed"])
            self.assertTrue(any("HTTPS" in item for item in report["errors"]))

    def test_missing_domestic_relevance_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            narration = narration_text()
            self._write_package(
                root,
                narration,
                diagnosis_text(narration, domestic_relevance=None),
                publishing_text(),
            )
            report = validate_package(TOPIC, 1, root)
            self.assertFalse(report["passed"])
            self.assertTrue(any("国内大众切口" in item for item in report["errors"]))

    def test_incomplete_domestic_relevance_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            narration = narration_text()
            incomplete = DOMESTIC_RELEVANCE_BLOCK.replace(
                "  - 具体痛点：缺少判断同事仍在关注口误的可观察标准\n", ""
            )
            self._write_package(
                root,
                narration,
                diagnosis_text(narration, domestic_relevance=incomplete),
                publishing_text(),
            )
            report = validate_package(TOPIC, 1, root)
            self.assertFalse(report["passed"])
            self.assertTrue(any("具体痛点" in item for item in report["errors"]))

    def test_domestic_relevance_excerpt_must_exist_in_narration(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            narration = narration_text()
            wrong_excerpt = DOMESTIC_RELEVANCE_BLOCK.replace(
                "想象你开会时说错一个词，散会以后还在反复回想。",
                "这句只写在诊断里，从未出现在口播稿中。",
            )
            self._write_package(
                root,
                narration,
                diagnosis_text(narration, domestic_relevance=wrong_excerpt),
                publishing_text(),
            )
            report = validate_package(TOPIC, 1, root)
            self.assertFalse(report["passed"])
            self.assertTrue(any("正文原句" in item for item in report["errors"]))

    def test_domestic_relevance_keyword_pile_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            narration = narration_text()
            self._write_package(
                root,
                narration,
                diagnosis_text(
                    narration,
                    domestic_relevance="- 国内大众切口：中国 需求 痛点 槽点",
                ),
                publishing_text(),
            )
            report = validate_package(TOPIC, 1, root)
            self.assertFalse(report["passed"])
            self.assertTrue(any("国内大众切口" in item for item in report["errors"]))

    def test_revision_passes_then_detects_source_mutation(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "output"
            source = Path(temporary) / "source.txt"
            source.write_text("原始口播", encoding="utf-8")
            source_info = validate_source_file(source)
            narration = narration_text()
            diagnosis = diagnosis_text(
                narration,
                mode="旧稿改写",
                source_path=str(source.resolve()),
                source_sha256=str(source_info["sha256"]),
            )
            self._write_package(root, narration, diagnosis, publishing_text())
            report = validate_package(
                TOPIC, 1, root, source, str(source_info["sha256"])
            )
            self.assertTrue(report["passed"], report["errors"])

            source.write_text("原始口播被改变", encoding="utf-8")
            changed = validate_package(
                TOPIC, 1, root, source, str(source_info["sha256"])
            )
            self.assertFalse(changed["passed"])
            self.assertTrue(any("已变化" in item for item in changed["errors"]))


if __name__ == "__main__":
    unittest.main()
