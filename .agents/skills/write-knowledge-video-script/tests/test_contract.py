#!/usr/bin/env python3
from pathlib import Path
import unittest


SKILL_DIR = Path(__file__).resolve().parents[1]


class WriteKnowledgeVideoScriptContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.skill = (SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")
        cls.method = (
            SKILL_DIR / "references" / "research-and-growth-method.md"
        ).read_text(encoding="utf-8")
        cls.output = (SKILL_DIR / "references" / "output-contract.md").read_text(
            encoding="utf-8"
        )
        cls.interface = (SKILL_DIR / "agents" / "openai.yaml").read_text(
            encoding="utf-8"
        )

    def test_skill_is_explicit_only(self) -> None:
        self.assertIn("Use only when explicitly invoked", self.skill)
        self.assertIn("allow_implicit_invocation: false", self.interface)
        self.assertIn("$write-knowledge-video-script", self.interface)

    def test_skill_is_standalone_and_text_only(self) -> None:
        for required in (
            "不进入任何视频工作流",
            "不修改 `AGENTS.md`",
            "不制作图片、封面图、音频或视频",
            "不要宣称视频工作流已批准",
        ):
            self.assertIn(required, self.skill)

    def test_upstream_methods_are_distilled_without_installing(self) -> None:
        self.assertIn("laoxu-video-script", self.method)
        self.assertIn("qiaomu-book-script", self.method)
        self.assertIn("`social-media-skills` 明确不在来源范围内", self.method)
        self.assertIn("不复制其固定人设", self.method)
        self.assertIn("不安装或调用", self.skill)

    def test_humanizer_zh_is_explicitly_excluded(self) -> None:
        for required in (
            "不安装、调用、读取或套用 `$humanizer-zh`",
            "即使它因中文写作、口播稿或“去 AI 味”任务自动匹配，也必须跳过",
            "文字风格的唯一依据",
        ):
            self.assertIn(required, self.skill)

    def test_direction_gate_requires_three_real_options(self) -> None:
        for required in (
            "只返回三张方向卡",
            "底层问题",
            "第二句增长钩子",
            "观众收益",
            "核心概念",
            "推理路线",
            "事实风险",
            "默认在此停下",
        ):
            self.assertIn(required, self.skill)

    def test_source_is_read_only_and_hashed(self) -> None:
        for required in (
            "非符号链接的普通文件",
            "UTF-8 或 UTF-8-SIG",
            "记录 SHA-256",
            "重新计算并要求完全一致",
            "/Users/jackson/Desktop/video-edit/script-resource",
        ):
            self.assertIn(required, self.skill)

    def test_output_is_versioned_and_never_overwritten(self) -> None:
        self.assertIn("output/codexVoiceScript", self.output)
        self.assertIn("<选题>_口播稿_vNNN.txt", self.output)
        self.assertIn("<选题>_创作诊断_vNNN.md", self.output)
        self.assertIn("<选题>_B站发布包_vNNN.md", self.output)
        self.assertIn("不得覆盖", self.output)

    def test_no_self_learning_or_view_guarantee(self) -> None:
        self.assertIn("不把用户改稿写回本 Skill", self.skill)
        self.assertIn("不承诺爆款、播放量", self.skill)
        self.assertIn("不得虚构预测播放量", self.method)

    def test_natural_narrative_and_duration_contract(self) -> None:
        for required in (
            "自然叙述型知识口播",
            "具体人物、情境、动作或选择",
            "研究和数据只用于支撑解释",
            "做什么、做多少或做到什么范围、观察什么结果",
            "默认目标时长为 180–240 秒",
            "不得用重复结论、同义改写、装饰性故事或形容词堆砌",
            "必须在创作诊断的 `字数与估时` 中写明 `延长依据`",
            "慢速估算不得超过 600 秒（10 分钟）",
        ):
            self.assertIn(required, self.skill)
        self.assertIn("默认目标区间为 180–240 秒", self.output)
        self.assertIn("依据缺失或无效属于校验错误", self.output)
        self.assertIn("超过硬上限属于校验错误", self.output)
        self.assertIn("默认 3–4 分钟", self.interface)

    def test_domestic_public_relevance_is_explicit_and_bounded(self) -> None:
        for required in (
            "中国大陆普通公众",
            "国内大众切口",
            "真实需求",
            "具体痛点",
            "可感知槽点",
            "不得把单一城市、个案、热搜或评论区印象外推为全国事实",
        ):
            self.assertIn(required, self.skill)
        for required in (
            "具体人群",
            "现实需求",
            "具体痛点",
            "可感知槽点",
            "无须强行本土化",
            "热搜、搜索联想、评论区和个案只可帮助发现问题",
        ):
            self.assertIn(required, self.method)
        for required in (
            "国内大众切口",
            "目标人群",
            "现实需求",
            "具体痛点",
            "可感知槽点",
            "正文原句",
            "泛化边界",
        ):
            self.assertIn(required, self.output)
        self.assertIn("不得外推全国", self.output)
        self.assertIn("中国大陆普通公众", self.interface)


if __name__ == "__main__":
    unittest.main()
