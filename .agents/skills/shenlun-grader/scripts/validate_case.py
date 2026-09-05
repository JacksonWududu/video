#!/usr/bin/env python3

import argparse
import datetime as dt
import hashlib
import json
import math
import re
import sys
from pathlib import Path
from urllib.parse import urlparse


SCHEMA_VERSION = "shenlun-grading-case-v1"
VALID_MODES = {"full", "limited"}
VALID_MODE_REASONS = {
    "complete_input",
    "missing_input",
    "materials_incomplete",
    "ocr_uncertain",
    "user_requested_qualitative",
    "rule_ambiguity",
}
VALID_QUESTION_TYPES = {
    "summary",
    "analysis",
    "countermeasure",
    "implementation",
    "composite",
    "essay",
    "unknown",
}
SHORT_TYPES = VALID_QUESTION_TYPES - {"essay", "unknown"}
VALID_RUBRIC_SOURCES = {
    "verified_official",
    "user_claimed_official",
    "institutional_reference",
    "diagnostic_default",
}
VALID_RUBRIC_RULE_TYPES = {"dimension_band", "non_additive"}
VALID_MISSING_INPUTS = {"prompt", "materials", "max_score", "ocr"}
VALID_PROMPT_REQUIREMENT_SUBJECTS = {
    "title",
    "word_limit",
    "format",
    "genre",
    "identity",
    "other",
}
SHORT_CONTENT_BY_TYPE = {
    "summary": "content_points",
    "analysis": "analysis_chain",
    "countermeasure": "solution_quality",
    "implementation": "content_points",
    "composite": "subtask_content",
}
LOCATOR_PATTERN = re.compile(r"chars:(\d{1,9})-(\d{1,9})")
MAX_NUMERIC_MAGNITUDE = 1_000_000
CAP_RULE_PATTERNS = (
    re.compile(
        r"(?:总分|本题|该题|全文|整题|答卷).{0,12}"
        r"(?:不得超过|不能超过|不超过|不得高于|不能高于|不高于|至多|最多|最高分?|封顶|上限)"
        r"\s*(?:为|计|得|是|约|大约|可得|可计|只能得|只能计|控制在|限定为)?\s*"
        r"(?P<value>[0-9]+(?:\.[0-9]+)?|[零〇一二两三四五六七八九十百]+)\s*分"
    ),
    re.compile(
        r"(?:总分|本题|该题|全文|整题|答卷).{0,12}"
        r"(?P<value>[0-9]+(?:\.[0-9]+)?|[零〇一二两三四五六七八九十百]+)\s*分"
        r".{0,6}(?:封顶|为上限|以下|以内)"
    ),
    re.compile(
        r"(?:偏题|跑题|离题|立意错误|主题错误|方向(?:错误|不符)|任务(?:错误|不符)|"
        r"文种(?:错误|不符)|未完成|空白卷?|身份(?:错误|不符)|无标题|标题缺失)"
        r".{0,16}(?:不得超过|不能超过|不超过|不得高于|不能高于|不高于|至多|最多|"
        r"最高(?:只能)?)\s*(?:为|给|得|计|可得|可计)?\s*"
        r"(?P<value>[0-9]+(?:\.[0-9]+)?|[零〇一二两三四五六七八九十百]+)\s*分"
    ),
)
DIRECT_ADJUSTMENT_RULE_PATTERN = re.compile(
    r"(?:扣除|扣分|减分|加分|判零|记零分|计零分|得零分|按零分|"
    r"不予评分|不作评分|不给评分|取消评分|不计成绩|不计分|不给分|"
    r"作零分处理)"
    r"|(?:扣除?|扣掉|扣去|减去?|减掉|加上?|下调|上调)\s*"
    r"(?:[0-9]+(?:\.[0-9]+)?|[零〇一二两三四五六七八九十百]+)\s*分"
    r"|(?:每|缺少|未按|少).{0,12}(?:扣|减|加)\s*[0-9零〇一二两三四五六七八九十百]"
)
NEGATIVE_CONDITION_PATTERN = re.compile(
    r"错误|不当|不正确|不符合|未符合|不满足|未满足|答非所问|偏题|跑题|离题|"
    r"偏离|偏差|"
    r"缺失|没有|无标题|未按|未完成|空白|抄袭|雷同"
)
DIMENSION_BAND_CONTEXT_PATTERN = re.compile(
    r"本维度|该维度|内容|语言|表达|结构|组织|论证|材料转化|任务契合|"
    r"文种与任务契合|要点"
)
GLOBAL_SCORE_CONTEXT_PATTERN = re.compile(r"总分|本题|该题|全文|整题|答卷|成绩")
SCORE_LIMIT_PREDICATE_PATTERN = re.compile(
    r"只给|仅给|只能|按.{0,12}计|控制在|限制在|限定在|不得超过|不能超过|"
    r"不超过|不得高于|不能高于|不高于|上限|为限|为界|限于|至多|最多|"
    r"封顶|最高"
)
SCORE_VALUE_PATTERN = re.compile(
    r"(?:[0-9]+(?:\.[0-9]+)?|[零〇一二两三四五六七八九十百]+)\s*分"
)
SCORE_RATIO_RULE_PATTERN = re.compile(
    r"(?:总分|本题满分|本题分值|满分)(?:的)?\s*"
    r"(?:[0-9]+(?:\.[0-9]+)?\s*[%％]|[一二两三四五六七八九十]+\s*成|"
    r"一半|二分之一)"
)
SCORE_MULTIPLIER_VALUE = (
    r"(?:[0-9]+(?:\.[0-9]+)?\s*[%％]|百分之(?:[0-9]+(?:\.[0-9]+)?|"
    r"[零一二三四五六七八九十百]+)|[一二两三四五六七八九十]+\s*成|"
    r"(?:0?\.\d+|1\.0+)|[零一二两三四五六七八九十0-9]+\s*折|一半|"
    r"[二三四五六七八九十]+分之一)"
)
MULTIPLICATIVE_ADJUSTMENT_RULE_PATTERN = re.compile(
    r"(?:按\s*)?(?:总成绩|总分|最终得分|原得分|所得(?:成绩|得分)|"
    r"本题(?:成绩|得分|分值|满分)?|成绩)(?:的)?\s*"
    + SCORE_MULTIPLIER_VALUE
    + r"\s*(?:计分|计|给分|折算|计算)?"
    r"|(?:总成绩|总分|最终得分|原得分|所得(?:成绩|得分)|本题得分|成绩)"
    r"[^。；;\n]{0,8}(?:乘以|乘|×)\s*(?:0?\.\d+|1\.0+)"
    r"|(?:扣|减|增加|加)\s*(?:总成绩|总分|最终得分|原得分|所得(?:成绩|得分)|"
    r"本题得分|成绩)(?:的)?\s*"
    + SCORE_MULTIPLIER_VALUE
    + r"|(?:按\s*)?(?:总成绩|总分|最终得分|原得分|所得(?:成绩|得分)|"
    r"本题得分|成绩)[^。；;\n]{0,8}打\s*"
    r"(?:[零一二两三四五六七八九十]+|[0-9]+(?:\.[0-9]+)?)\s*折"
    r"|保留\s*(?:总成绩|总分|最终得分|原得分|所得(?:成绩|得分)|"
    r"本题得分|成绩)(?:的)?\s*"
    + SCORE_MULTIPLIER_VALUE
    + r"|(?:总成绩|总分|最终得分|原得分|所得(?:成绩|得分)|本题得分|成绩)"
    r"\s*(?:折半|减半)"
    r"|(?:总成绩|总分|最终得分|原得分|所得(?:成绩|得分)|本题得分|成绩)"
    r"\s*(?:比例|系数)\s*(?:为|是|[:：])?\s*(?:0?\.\d+|1\.0+)"
)
GRADE_ADJUSTMENT_RULE_PATTERN = re.compile(
    r"(?:降|下调|降低)\s*(?:一个|一|[二两三四五六七八九十])?\s*档(?:次)?"
    r"|按\s*(?:下|低)\s*(?:一个|一|[二两三四五六七八九十])?\s*档(?:次)?处理"
    r"|(?:直接)?(?:判为|评定为|归入|归为|列为|列入)\s*"
    r"[一二两三四五六七八九十]\s*类(?:文)?"
    r"|不得\s*(?:进入|评为)\s*[^，。；;\n]{0,10}(?:档|类文)"
    r"|(?:最高|至多|只能)(?:只能)?\s*评为\s*"
    r"[一二两三四五六七八九十]\s*类文"
    r"|(?:只能|仅能)\s*进入\s*[一二两三四五六七八九十]\s*类(?:文)?"
    r"(?:及以下)?"
    r"|按\s*本档\s*(?:最低|最高)\s*档次(?:确定|计分|评分)?"
    r"|(?:划入|归入)\s*最低档"
    r"|(?:上浮|下浮)\s*(?:一个|一|[二两三四五六七八九十])?\s*档(?:次)?"
)
SEQUENTIAL_RULE_PATTERN = re.compile(
    r"先[^。；;\n]{0,40}(?:分|档|内容|立意|论证)"
    r"[^。；;\n]{0,40}再[^。；;\n]{0,40}(?:分|档|表达|结构|浮动|调整)"
    r"|(?:内容|立意|论证|材料|任务)[^。；;\n]{0,12}"
    r"(?:定档|确定档次|评定档次|划定档次)后[^。；;\n]{0,40}"
    r"(?:语言|表达|结构|卷面)[^。；;\n]{0,20}"
    r"(?:档内|位置|浮动|调整|定分|计分)"
)
OTHER_NONADDITIVE_OPERATION_PATTERN = re.compile(
    r"(?:若|如|当)[^。；;\n]{0,24}(?:为零|0\s*分)"
    r"[^。；;\n]{0,30}(?:不再计入|不计入|不得分|计零|记零)"
    r"|(?:内容|表达|语言|结构|论证|材料)[^。；;\n]{0,12}"
    r"(?:与|和)[^。；;\n]{0,16}(?:取较低者|取较高者|择高|择低|取低|取高)"
    r"|(?:最低给|最低得|至少给|保底)\s*"
    r"(?:[0-9]+(?:\.[0-9]+)?|[零〇一二两三四五六七八九十百]+)\s*分"
    r"|(?:总分|成绩|得分)[^。；;\n]{0,12}"
    r"(?:四舍五入|向上取整|向下取整|直接取整|取整)"
    r"|(?:上浮|下浮|上下浮动|浮动|增加或减少|增加|减少|增减)"
    r"[^。；;\n]{0,12}"
    r"(?:[0-9]+(?:\.[0-9]+)?|[零〇一二两三四五六七八九十百]+)\s*分"
)
PROMPT_REQUIREMENT_PATTERNS = {
    "title": re.compile(
        r"(?:自拟|拟|拟定|拟写|拟出|确定|设置|另加|加上).{0,6}"
        r"(?:主标题|副标题|小标题|标题|题目|副题)"
        r"|(?:主标题|副标题|小标题|标题|题目|副题)"
        r"(?:\s*(?:与|和|、)\s*(?:主标题|副标题|小标题|标题|题目|副题))*"
        r"\s*(?:均|都)?\s*(?:须|需|应|要)?\s*"
        r"(?:自拟|拟写|拟定|拟出|设置|加上)"
        r"|(?:主标题|副标题|小标题|标题|题目|副题).{0,4}"
        r"(?:自拟|为|是|[:：])"
        r"|以[^。；\n]{1,40}为题"
    ),
    "word_limit": re.compile(
        r"(?:(?:单项答案|每项答案|单项|每项|总体|总计|全文|每条|每点|各项)\s*)?"
        r"(?:不超过|不得超过|不高于|不得高于|不少于|不得少于|不低于|"
        r"不得低于|不得逾|至少|最少|至多|最多|须达|需达|应达|控制在|"
        r"限定在|限|字数|篇幅)"
        r"[^字。；;\n]{0,12}?(?:[0-9]+|[零〇一二两三四五六七八九十百千]+)\s*字"
        r"|(?:字数|篇幅|作答字数)\s*(?:应|须|需)?\s*(?:控制)?\s*在?\s*"
        r"(?:[0-9]+|[零〇一二两三四五六七八九十百千]+)\s*"
        r"(?:至|到|[-—–~～])\s*"
        r"(?:[0-9]+|[零〇一二两三四五六七八九十百千]+)\s*(?:字)?(?:之间)?"
        r"|(?:[0-9]+|[零〇一二两三四五六七八九十百千]+)\s*字"
        r"(?:以内|以上|以下|左右)"
    ),
    "format": re.compile(
        r"(?:(?:须|需|应)(?:有|包括|包含|设置|写明)"
        r"(?=[^。；\n]{0,50}(?:称谓|正文|结语|落款|署名|日期))"
        r"[^。；\n]{1,50})|格式|称谓|落款|署名|具名|日期|分条|分点"
    ),
    "genre": re.compile(
        r"(?:撰写|写|拟写|起草|草拟|形成|作答|拟)\s*"
        r"(?:一篇|一份|一则|一封|一段)?\s*"
        r"(?:文章|讲话稿|发言稿|倡议书|建议书|公开信|通知|通报|报告|提纲|纲要|"
        r"短评|编者按|导言|宣传稿|讲解稿|回复|回信|评论)"
    ),
    "identity": re.compile(
        r"(?:假如|如果|设想)?你是|"
        r"作为[^，。；\n]{0,24}(?:工作人员|负责人|成员|代表|干部|书记|主任|"
        r"局长|记者|编辑|志愿者|社区工作者)|"
        r"以[^，。；\n]{1,24}(?:身份|名义)"
    ),
}
RULE_NUMBER_TEXT = r"[0-9]+(?:\.[0-9]+)?"
MAXIMUM_DECLARATION_PATTERNS = (
    re.compile(
        rf"(?:满分|最高分|分值上限)\s*(?:为|是|计)?\s*"
        rf"(?P<value>{RULE_NUMBER_TEXT})\s*分"
    ),
    re.compile(
        rf"(?P<value>{RULE_NUMBER_TEXT})\s*分\s*(?:满分|为满分)"
    ),
)
INCREMENT_DECLARATION_PATTERNS = (
    re.compile(
        rf"(?:以|按|每)\s*(?P<value>{RULE_NUMBER_TEXT})\s*分\s*"
        rf"(?:计|为单位|作为单位|一档|一个档)"
    ),
    re.compile(
        rf"(?:计分精度|计分单位|分值单位)\s*(?:为|是|[:：])?\s*"
        rf"(?P<value>{RULE_NUMBER_TEXT})\s*分"
    ),
)
STRICT_RUBRIC_LABEL_FORBIDDEN_PATTERN = re.compile(
    r"[\r\n，,。；;:：]"
    r"|(?:满分|总分|得分|成绩|分数|扣|减|增加|加分|乘|除|折|比例|系数|"
    r"保留|计入|取整|四舍五入|封顶|上限|下限|最低给|最高给|若|如果|"
    r"之后|先|再|择高|择低|较高者|较低者|不再|浮动|调整|处理|违规)"
)
DIMENSION_NAME_SCORE_PATTERN = re.compile(
    r"(?:[0-9]+(?:\.[0-9]+)?|[零〇一二两三四五六七八九十百]+)\s*分"
    r"|[0-9]+(?:\.[0-9]+)?\s*[%％]"
    r"|百分之(?:[0-9]+(?:\.[0-9]+)?|[零〇一二三四五六七八九十百]+)"
    r"|[零〇一二两三四五六七八九十]+\s*成"
    r"|(?:估分|预计得分|预估得分|得分|分数|成绩|评分结果|分值)"
)
CANONICAL_DIMENSION_ATOMS = {
    "任务",
    "任务契合",
    "文种",
    "文体",
    "格式",
    "标题",
    "字数",
    "内容",
    "内容要点",
    "概括",
    "分析",
    "分析链条",
    "对策",
    "对策质量",
    "子任务内容",
    "组织",
    "组织表达",
    "表达",
    "立意",
    "论证",
    "论据",
    "材料",
    "材料转化",
    "结构",
    "语言",
    "逻辑",
    "观点",
    "主题",
    "卷面",
    "书写",
    "准确性",
    "完整性",
    "条理性",
    "规范性",
    "针对性",
    "可行性",
}
CANONICAL_LEVEL_LABELS = {
    "优",
    "优秀",
    "优等",
    "良",
    "良好",
    "较好",
    "好",
    "中",
    "中等",
    "一般",
    "合格",
    "基本合格",
    "较差",
    "差",
    "不合格",
    "强",
    "较强",
    "较弱",
    "弱",
    "完整",
    "较完整",
    "基本完整",
    "不完整",
    "充分",
    "较充分",
    "基本充分",
    "不充分",
}
for _level_number in "一二三四五六七八九十":
    for _level_suffix in ("类", "类文", "档", "档次", "级", "等"):
        CANONICAL_LEVEL_LABELS.add(f"{_level_number}{_level_suffix}")
        CANONICAL_LEVEL_LABELS.add(f"第{_level_number}{_level_suffix}")
for _level_letter in "ABCDE":
    for _level_suffix in ("", "类", "档", "级"):
        CANONICAL_LEVEL_LABELS.add(f"{_level_letter}{_level_suffix}")


def is_number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    if isinstance(value, int):
        return abs(value) <= MAX_NUMERIC_MAGNITUDE
    return math.isfinite(value) and abs(value) <= MAX_NUMERIC_MAGNITUDE


def is_half_step(value):
    return is_number(value) and math.isclose(
        value * 2,
        round(value * 2),
        rel_tol=0,
        abs_tol=1e-6,
    )


def is_nonempty_string(value):
    return isinstance(value, str) and bool(value.strip())


def is_enum_value(value, choices):
    return isinstance(value, str) and value in choices


def validate_exact_keys(item, allowed, path, errors):
    if not isinstance(item, dict):
        return
    extras = sorted(set(item) - set(allowed))
    if extras:
        errors.append(f"{path} has unsupported fields: {', '.join(extras)}")


def load_json(path):
    with Path(path).open("r", encoding="utf-8") as handle:
        return json.load(handle)


def is_http_url(value):
    if not is_nonempty_string(value):
        return False
    try:
        parsed = urlparse(value)
    except ValueError:
        return False
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def is_iso_date(value):
    if not is_nonempty_string(value):
        return False
    try:
        dt.date.fromisoformat(value)
    except ValueError:
        return False
    return True


def parse_rule_number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        pass
    digits = {"零": 0, "〇": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4,
              "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
    units = {"十": 10, "百": 100}
    total = 0
    current = 0
    for character in value if isinstance(value, str) else "":
        if character in digits:
            current = digits[character]
        elif character in units:
            total += (current or 1) * units[character]
            current = 0
        else:
            return None
    return float(total + current) if total or current else 0.0


def declared_values(text, patterns):
    values = []
    for pattern in patterns:
        for match in pattern.finditer(text):
            value = parse_rule_number(match.group("value"))
            if value is not None:
                values.append(value)
    return values


def has_declared_value(text, patterns, expected):
    return is_number(expected) and any(
        math.isclose(value, expected, rel_tol=0, abs_tol=1e-6)
        for value in declared_values(text, patterns)
    )


def has_declared_level_band(text, name, lower, upper):
    if not is_nonempty_string(name) or not is_number(lower) or not is_number(upper):
        return False
    escaped_name = re.escape(name)
    forward = re.compile(
        rf"{escaped_name}[^。；;\n]{{0,20}}?"
        rf"(?P<lower>{RULE_NUMBER_TEXT})\s*(?:至|到|[-—–~～])\s*"
        rf"(?P<upper>{RULE_NUMBER_TEXT})\s*分"
    )
    reverse = re.compile(
        rf"(?P<lower>{RULE_NUMBER_TEXT})\s*(?:至|到|[-—–~～])\s*"
        rf"(?P<upper>{RULE_NUMBER_TEXT})\s*分[^。；;\n]{{0,12}}?"
        rf"(?:为|属|属于|[:：])?\s*{escaped_name}"
    )
    for pattern in (forward, reverse):
        for match in pattern.finditer(text):
            parsed_lower = parse_rule_number(match.group("lower"))
            parsed_upper = parse_rule_number(match.group("upper"))
            if (
                parsed_lower is not None
                and parsed_upper is not None
                and math.isclose(parsed_lower, lower, rel_tol=0, abs_tol=1e-6)
                and math.isclose(parsed_upper, upper, rel_tol=0, abs_tol=1e-6)
            ):
                return True
    return False


def matches_canonical_dimension_band(
    text,
    dimension_name,
    dimension_max,
    increment,
    level_bands,
):
    """Accept only a closed, one-dimension numeric band declaration."""
    dimension_parts = (
        re.split(r"(?:与|和|及|、)", dimension_name)
        if isinstance(dimension_name, str)
        else []
    )
    canonical_dimension_name = (
        dimension_name in CANONICAL_DIMENSION_ATOMS
        or (
            2 <= len(dimension_parts) <= 4
            and all(part in CANONICAL_DIMENSION_ATOMS for part in dimension_parts)
        )
    ) if isinstance(dimension_name, str) else False
    if (
        not is_nonempty_string(text)
        or not is_nonempty_string(dimension_name)
        or not canonical_dimension_name
        or STRICT_RUBRIC_LABEL_FORBIDDEN_PATTERN.search(dimension_name)
        or not is_number(dimension_max)
        or not is_number(increment)
        or not isinstance(level_bands, list)
        or not level_bands
    ):
        return False

    band_patterns = []
    expected_values = [dimension_max, increment]
    for index, band in enumerate(level_bands):
        if not isinstance(band, dict):
            return False
        name = band.get("name")
        lower = band.get("min_score")
        upper = band.get("max_score")
        if (
            not is_nonempty_string(name)
            or name not in CANONICAL_LEVEL_LABELS
            or STRICT_RUBRIC_LABEL_FORBIDDEN_PATTERN.search(name)
            or not is_number(lower)
            or not is_number(upper)
        ):
            return False
        band_patterns.append(
            rf"{re.escape(name)}\s*(?:为|属|属于|[:：])?\s*"
            rf"(?P<band_{index}_min>{RULE_NUMBER_TEXT})\s*"
            rf"(?:至|到|[-—–~～])\s*"
            rf"(?P<band_{index}_max>{RULE_NUMBER_TEXT})\s*分"
        )
        expected_values.extend((lower, upper))

    pattern = re.compile(
        rf"\s*{re.escape(dimension_name)}\s*(?:维度)?\s*"
        rf"(?:满分|最高分|分值上限)\s*(?:为|是|计|[:：])?\s*"
        rf"(?P<dimension_max>{RULE_NUMBER_TEXT})\s*分\s*[,，；;]\s*"
        rf"(?:以|按|每)\s*(?P<increment>{RULE_NUMBER_TEXT})\s*分\s*"
        rf"(?:计|为单位|作为单位|一档|一个档)\s*[；;。]\s*"
        + r"\s*[,，；;]\s*".join(band_patterns)
        + r"\s*[。.]?\s*"
    )
    match = pattern.fullmatch(text)
    if match is None:
        return False
    actual_values = [
        parse_rule_number(match.group("dimension_max")),
        parse_rule_number(match.group("increment")),
    ]
    for index in range(len(level_bands)):
        actual_values.extend(
            (
                parse_rule_number(match.group(f"band_{index}_min")),
                parse_rule_number(match.group(f"band_{index}_max")),
            )
        )
    return all(
        actual is not None
        and math.isclose(actual, expected, rel_tol=0, abs_tol=1e-6)
        for actual, expected in zip(actual_values, expected_values)
    )


def looks_non_additive_rule(text, max_score=None):
    if not is_nonempty_string(text):
        return False
    if (
        DIRECT_ADJUSTMENT_RULE_PATTERN.search(text)
        or MULTIPLICATIVE_ADJUSTMENT_RULE_PATTERN.search(text)
        or GRADE_ADJUSTMENT_RULE_PATTERN.search(text)
        or SEQUENTIAL_RULE_PATTERN.search(text)
        or OTHER_NONADDITIVE_OPERATION_PATTERN.search(text)
    ):
        return True
    for clause in re.split(r"[。；;\n]", text):
        if (
            NEGATIVE_CONDITION_PATTERN.search(clause)
            and SCORE_LIMIT_PREDICATE_PATTERN.search(clause)
            and SCORE_RATIO_RULE_PATTERN.search(clause)
            and (
                GLOBAL_SCORE_CONTEXT_PATTERN.search(clause)
                or not DIMENSION_BAND_CONTEXT_PATTERN.search(clause)
            )
        ):
            return True
        if (
            NEGATIVE_CONDITION_PATTERN.search(clause)
            and SCORE_LIMIT_PREDICATE_PATTERN.search(clause)
            and SCORE_VALUE_PATTERN.search(clause)
            and (
                not DIMENSION_BAND_CONTEXT_PATTERN.search(clause)
                or GLOBAL_SCORE_CONTEXT_PATTERN.search(clause)
            )
        ):
            return True
    for pattern in CAP_RULE_PATTERNS:
        for match in pattern.finditer(text):
            cap = parse_rule_number(match.group("value"))
            if cap is None or not is_number(max_score):
                return True
            if cap < max_score and not math.isclose(
                cap,
                max_score,
                rel_tol=0,
                abs_tol=1e-6,
            ):
                return True
    return False


def detected_prompt_requirement_subjects(prompt):
    return {item["subject"] for item in detected_prompt_requirements(prompt)}


def detected_prompt_requirements(prompt):
    if not is_nonempty_string(prompt):
        return []
    detected = []
    seen = set()
    for subject, pattern in PROMPT_REQUIREMENT_PATTERNS.items():
        for match in pattern.finditer(prompt):
            key = (subject, match.start(), match.end(), match.group(0))
            if key in seen:
                continue
            seen.add(key)
            detected.append(
                {
                    "subject": subject,
                    "locator": f"chars:{match.start()}-{match.end()}",
                    "excerpt": match.group(0),
                }
            )
    return detected


def expected_requirements_lock(case):
    payload = {
        "question_id": case.get("question_id"),
        "question_type": case.get("question_type"),
        "prompt": case.get("prompt"),
        "prompt_requirements": case.get("prompt_requirements"),
    }
    serialized = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    digest = hashlib.sha256(serialized.encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def expected_criteria_lock(case):
    payload = {
        "question_id": case.get("question_id"),
        "question_type": case.get("question_type"),
        "prompt": case.get("prompt"),
        "prompt_requirements": case.get("prompt_requirements"),
        "materials": case.get("materials"),
        "materials_complete": case.get("materials_complete"),
        "max_score": case.get("max_score"),
        "rubric_version": case.get("rubric_version"),
        "rubric_source": case.get("rubric_source"),
        "rubric_entries": case.get("rubric_entries"),
        "criteria": case.get("criteria"),
    }
    serialized = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    digest = hashlib.sha256(serialized.encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def validate_text_entries(
    entries,
    path,
    errors,
    require_official_metadata=False,
    allowed_fields=None,
):
    if not isinstance(entries, list):
        errors.append(f"{path} must be an array")
        return 0

    seen = set()
    valid_count = 0
    for index, entry in enumerate(entries):
        item_path = f"{path}[{index}]"
        if not isinstance(entry, dict):
            errors.append(f"{item_path} must be an object")
            continue
        if allowed_fields is not None:
            validate_exact_keys(entry, allowed_fields, item_path, errors)

        entry_id = entry.get("id")
        text = entry.get("text")
        if not is_nonempty_string(entry_id):
            errors.append(f"{item_path}.id must be a non-empty string")
        elif entry_id in seen:
            errors.append(f"{item_path}.id is duplicated")
        else:
            seen.add(entry_id)
        if not is_nonempty_string(text):
            errors.append(f"{item_path}.text must be a non-empty string")
        if is_nonempty_string(entry_id) and is_nonempty_string(text):
            valid_count += 1

        source_title = entry.get("source_title")
        source_url = entry.get("source_url")
        retrieved_on = entry.get("retrieved_on")
        if require_official_metadata:
            if not is_nonempty_string(source_title):
                errors.append(f"{item_path}.source_title is required for verified_official")
            if not is_http_url(source_url):
                errors.append(f"{item_path}.source_url must be an HTTP(S) URL")
            if not is_iso_date(retrieved_on):
                errors.append(f"{item_path}.retrieved_on must be an ISO date")
        else:
            if source_title is not None and not is_nonempty_string(source_title):
                errors.append(f"{item_path}.source_title must be a non-empty string")
            if source_url is not None and not is_http_url(source_url):
                errors.append(f"{item_path}.source_url must be an HTTP(S) URL")
            if retrieved_on is not None and not is_iso_date(retrieved_on):
                errors.append(f"{item_path}.retrieved_on must be an ISO date")
    return valid_count


def validate_case(case):
    if not isinstance(case, dict):
        return ["root must be an object"]

    errors = []
    required = {
        "schema_version",
        "question_id",
        "question_type",
        "grading_mode",
        "mode_reason",
        "missing_inputs",
        "prompt",
        "prompt_requirements",
        "requirements_lock",
        "answer",
        "materials",
        "materials_complete",
        "max_score",
        "rubric_version",
        "rubric_source",
        "rubric_entries",
        "rubric_dimensions",
        "criteria",
        "criteria_lock",
    }
    for key in sorted(required - case.keys()):
        errors.append(f"{key} is required")
    validate_exact_keys(case, required, "case", errors)

    if case.get("schema_version") != SCHEMA_VERSION:
        errors.append(f"schema_version must be {SCHEMA_VERSION}")
    if not is_nonempty_string(case.get("question_id")):
        errors.append("question_id must be a non-empty string")
    if not is_nonempty_string(case.get("answer")):
        errors.append("answer must be a non-empty string")
    if not is_nonempty_string(case.get("rubric_version")):
        errors.append("rubric_version must be a non-empty string")

    mode = case.get("grading_mode")
    reason = case.get("mode_reason")
    question_type = case.get("question_type")
    rubric_source = case.get("rubric_source")
    if not is_enum_value(mode, VALID_MODES):
        errors.append("grading_mode must be full or limited")
    if not is_enum_value(reason, VALID_MODE_REASONS):
        errors.append("mode_reason is unsupported")
    if not is_enum_value(question_type, VALID_QUESTION_TYPES):
        errors.append("question_type is unsupported")
    elif mode == "full" and question_type == "unknown":
        errors.append("full mode requires a known question_type")
    if not is_enum_value(rubric_source, VALID_RUBRIC_SOURCES):
        errors.append("rubric_source is unsupported")

    prompt = case.get("prompt")
    prompt_available = is_nonempty_string(prompt)
    if prompt is not None and not prompt_available:
        errors.append("prompt must be null or a non-empty string")

    prompt_requirements = case.get("prompt_requirements")
    requirement_keys = set()
    if not isinstance(prompt_requirements, list):
        errors.append("prompt_requirements must be an array")
        prompt_requirements = []
    for index, item in enumerate(prompt_requirements):
        path = f"prompt_requirements[{index}]"
        if not isinstance(item, dict):
            errors.append(f"{path} must be an object")
            continue
        validate_exact_keys(
            item,
            {"id", "subject", "locator", "excerpt"},
            path,
            errors,
        )
        requirement_id = item.get("id")
        subject = item.get("subject")
        locator = item.get("locator")
        excerpt = item.get("excerpt")
        if not is_nonempty_string(requirement_id):
            errors.append(f"{path}.id must be a non-empty string")
        elif any(
            isinstance(earlier, dict) and earlier.get("id") == requirement_id
            for earlier in prompt_requirements[:index]
        ):
            errors.append(f"{path}.id is duplicated")
        if not is_enum_value(subject, VALID_PROMPT_REQUIREMENT_SUBJECTS):
            errors.append(f"{path}.subject is unsupported")
        match = LOCATOR_PATTERN.fullmatch(locator) if isinstance(locator, str) else None
        if match is None:
            errors.append(f"{path}.locator must use chars:start-end with at most 9 digits")
        if not is_nonempty_string(excerpt):
            errors.append(f"{path}.excerpt must be a non-empty string")
        if prompt_available and match is not None and is_nonempty_string(excerpt):
            start, end = map(int, match.groups())
            if not 0 <= start < end <= len(prompt):
                errors.append(f"{path}.locator is outside prompt bounds")
            elif prompt[start:end] != excerpt:
                errors.append(f"{path}.locator does not select excerpt exactly")
            elif is_enum_value(subject, VALID_PROMPT_REQUIREMENT_SUBJECTS):
                requirement_key = (subject, locator, excerpt)
                if requirement_key in requirement_keys:
                    errors.append(f"{path} duplicates a locked prompt requirement")
                requirement_keys.add(requirement_key)
        elif not prompt_available:
            errors.append(f"{path} cannot exist without an available prompt")

    detected_requirement_keys = {
        (item["subject"], item["locator"], item["excerpt"])
        for item in detected_prompt_requirements(prompt)
    }
    for subject, locator, excerpt in sorted(
        detected_requirement_keys - requirement_keys
    ):
        errors.append(
            "prompt_requirements must include detected "
            f"{subject} requirement at {locator}: {excerpt}"
        )

    requirements_lock = case.get("requirements_lock")
    if prompt_available:
        try:
            expected_lock = expected_requirements_lock(case)
        except (TypeError, ValueError, OverflowError, RecursionError):
            errors.append("requirements_lock payload cannot be serialized")
        else:
            if requirements_lock != expected_lock:
                errors.append(
                    "requirements_lock does not match the non-answer prompt requirements"
                )
    elif requirements_lock is not None:
        errors.append("requirements_lock must be null without an available prompt")

    materials_complete = case.get("materials_complete")
    if not isinstance(materials_complete, bool):
        errors.append("materials_complete must be a boolean")
    material_count = validate_text_entries(
        case.get("materials"),
        "materials",
        errors,
        allowed_fields={"id", "text"},
    )

    max_score = case.get("max_score")
    score_available = is_number(max_score) and max_score > 0
    if max_score is not None and not score_available:
        errors.append("max_score must be null or a positive finite number")

    missing_inputs = case.get("missing_inputs")
    declared_missing = set()
    if not isinstance(missing_inputs, list):
        errors.append("missing_inputs must be an array")
    else:
        for index, item in enumerate(missing_inputs):
            if not is_enum_value(item, VALID_MISSING_INPUTS):
                errors.append(f"missing_inputs[{index}] is unsupported")
            elif item in declared_missing:
                errors.append(f"missing_inputs[{index}] is duplicated")
            else:
                declared_missing.add(item)

    actual_missing = set()
    if not prompt_available:
        actual_missing.add("prompt")
    if material_count == 0 or materials_complete is not True:
        actual_missing.add("materials")
    if not score_available:
        actual_missing.add("max_score")

    if mode == "full":
        if reason != "complete_input":
            errors.append("full mode requires mode_reason complete_input")
        if actual_missing:
            errors.append("full mode requires prompt, complete materials, and max_score")
        if declared_missing:
            errors.append("full mode missing_inputs must be empty")
    elif mode == "limited":
        if reason == "complete_input":
            errors.append("limited mode cannot use mode_reason complete_input")
        declared_core_missing = declared_missing - {"ocr"}
        for item in sorted(actual_missing - declared_core_missing):
            errors.append(f"limited mode missing_inputs must include {item}")
        for item in sorted(declared_core_missing - actual_missing):
            errors.append(f"limited mode falsely declares available input as missing: {item}")
        if "ocr" in declared_missing:
            if reason != "ocr_uncertain":
                errors.append("missing OCR input requires mode_reason ocr_uncertain")
        elif reason == "ocr_uncertain":
            errors.append("mode_reason ocr_uncertain requires missing_inputs to include ocr")
        elif actual_missing:
            only_incomplete_materials = (
                actual_missing == {"materials"}
                and material_count > 0
                and materials_complete is False
            )
            expected_reason = "materials_incomplete" if only_incomplete_materials else "missing_input"
            if reason != expected_reason:
                errors.append(
                    f"declared missing inputs require mode_reason {expected_reason}"
                )
        elif not is_enum_value(reason, {"user_requested_qualitative", "rule_ambiguity"}):
            errors.append("limited mode without missing inputs needs an explicit qualitative reason")

    rubric_entries = case.get("rubric_entries")
    rubric_count = validate_text_entries(
        rubric_entries,
        "rubric_entries",
        errors,
        require_official_metadata=rubric_source == "verified_official",
        allowed_fields={
            "id",
            "text",
            "rule_type",
            "source_title",
            "source_url",
            "retrieved_on",
        },
    )
    rubric_entry_types = {}
    rubric_text_by_id = {}
    if isinstance(rubric_entries, list):
        for index, entry in enumerate(rubric_entries):
            if not isinstance(entry, dict):
                continue
            path = f"rubric_entries[{index}]"
            rule_type = entry.get("rule_type")
            if not is_enum_value(rule_type, VALID_RUBRIC_RULE_TYPES):
                errors.append(
                    f"{path}.rule_type must be dimension_band or non_additive"
                )
            elif is_nonempty_string(entry.get("id")):
                rubric_entry_types[entry["id"]] = rule_type
                if is_nonempty_string(entry.get("text")):
                    rubric_text_by_id[entry["id"]] = entry["text"]
            if rule_type == "dimension_band" and looks_non_additive_rule(
                entry.get("text"),
                max_score,
            ):
                errors.append(
                    f"{path}.text appears non-additive and cannot be dimension_band"
                )
    if rubric_source == "diagnostic_default":
        if rubric_count:
            errors.append("diagnostic_default must not include rubric_entries")
        if mode == "full" and score_available and not is_half_step(max_score):
            errors.append("diagnostic_default max_score must use 0.5-point precision")
        if mode == "full" and score_available and max_score < 5:
            errors.append("diagnostic_default max_score must be at least 5")
        expected = None
        if isinstance(question_type, str) and question_type in SHORT_TYPES:
            expected = "diagnostic-short-v1"
        elif question_type == "essay":
            expected = "diagnostic-essay-v1"
        elif question_type == "unknown":
            expected = "qualitative-only-v1"
        if expected and case.get("rubric_version") != expected:
            errors.append(f"diagnostic_default {question_type} requires rubric_version {expected}")
    elif is_enum_value(rubric_source, VALID_RUBRIC_SOURCES) and rubric_count == 0:
        errors.append("non-default rubric_source requires at least one rubric entry")

    rubric_dimensions = case.get("rubric_dimensions")
    if not isinstance(rubric_dimensions, list):
        errors.append("rubric_dimensions must be an array")
        rubric_dimensions = []
    dimension_ids = set()
    rubric_entry_ids = {
        entry.get("id")
        for entry in rubric_entries
        if isinstance(entry, dict) and is_nonempty_string(entry.get("id"))
    } if isinstance(rubric_entries, list) else set()
    bound_rubric_entry_ids = set()
    rubric_entry_binding_paths = {}
    dimension_maxima = []
    for index, dimension in enumerate(rubric_dimensions):
        path = f"rubric_dimensions[{index}]"
        if not isinstance(dimension, dict):
            errors.append(f"{path} must be an object")
            continue
        validate_exact_keys(
            dimension,
            {
                "id",
                "name",
                "max_score",
                "rubric_entry_ids",
                "scoring_method",
                "score_increment",
                "level_bands",
            },
            path,
            errors,
        )
        dimension_id = dimension.get("id")
        if not is_nonempty_string(dimension_id):
            errors.append(f"{path}.id must be a non-empty string")
        elif dimension_id in dimension_ids:
            errors.append(f"{path}.id is duplicated")
        else:
            dimension_ids.add(dimension_id)
        dimension_name = dimension.get("name")
        if not is_nonempty_string(dimension_name):
            errors.append(f"{path}.name must be a non-empty string")
        elif DIMENSION_NAME_SCORE_PATTERN.search(dimension_name):
            errors.append(f"{path}.name must not contain score language")
        dimension_max = dimension.get("max_score")
        if not is_number(dimension_max) or dimension_max <= 0:
            errors.append(f"{path}.max_score must be positive")
        else:
            dimension_maxima.append(dimension_max)
        entry_ids = dimension.get("rubric_entry_ids")
        if not isinstance(entry_ids, list) or not entry_ids:
            errors.append(f"{path}.rubric_entry_ids must be a non-empty array")
        else:
            seen_entry_ids = set()
            for entry_index, entry_id in enumerate(entry_ids):
                if not is_nonempty_string(entry_id):
                    errors.append(f"{path}.rubric_entry_ids[{entry_index}] must be a string")
                elif entry_id in seen_entry_ids:
                    errors.append(f"{path}.rubric_entry_ids[{entry_index}] is duplicated")
                elif entry_id not in rubric_entry_ids:
                    errors.append(f"{path}.rubric_entry_ids[{entry_index}] is unknown")
                else:
                    seen_entry_ids.add(entry_id)
                    bound_rubric_entry_ids.add(entry_id)
                    rubric_entry_binding_paths.setdefault(entry_id, []).append(path)
                    if rubric_entry_types.get(entry_id) == "non_additive":
                        errors.append(
                            f"{path}.rubric_entry_ids[{entry_index}] cannot bind a non_additive rule"
                        )

        if dimension.get("scoring_method") != "level_band":
            errors.append(f"{path}.scoring_method must be level_band")
        increment = dimension.get("score_increment")
        if not is_number(increment) or increment < 0.1:
            errors.append(f"{path}.score_increment must be at least 0.1")
            increment = None
        elif is_number(dimension_max) and increment > dimension_max:
            errors.append(f"{path}.score_increment must not exceed max_score")

        level_bands = dimension.get("level_bands")
        if not isinstance(level_bands, list) or not level_bands:
            errors.append(f"{path}.level_bands must be a non-empty array")
            level_bands = []
        level_names = set()
        previous_max = None
        for band_index, band in enumerate(level_bands):
            band_path = f"{path}.level_bands[{band_index}]"
            if not isinstance(band, dict):
                errors.append(f"{band_path} must be an object")
                continue
            validate_exact_keys(
                band,
                {"name", "min_score", "max_score"},
                band_path,
                errors,
            )
            name = band.get("name")
            lower = band.get("min_score")
            upper = band.get("max_score")
            if not is_nonempty_string(name):
                errors.append(f"{band_path}.name must be a non-empty string")
            elif name in level_names:
                errors.append(f"{band_path}.name is duplicated")
            else:
                level_names.add(name)
            if not is_number(lower) or not is_number(upper):
                errors.append(f"{band_path} score bounds must be finite numbers")
                continue
            if lower < 0 or upper < lower:
                errors.append(f"{band_path} score bounds are invalid")
            if is_number(dimension_max) and upper > dimension_max:
                errors.append(f"{band_path}.max_score exceeds dimension max_score")
            if increment is not None:
                for label, value in (("min_score", lower), ("max_score", upper)):
                    if not math.isclose(
                        value / increment,
                        round(value / increment),
                        rel_tol=0,
                        abs_tol=1e-6,
                    ):
                        errors.append(f"{band_path}.{label} must align to score_increment")
                expected_lower = 0 if previous_max is None else previous_max + increment
                if not math.isclose(lower, expected_lower, rel_tol=0, abs_tol=1e-6):
                    errors.append(f"{band_path} must continue the preceding score band")
            previous_max = upper
        if (
            level_bands
            and is_number(dimension_max)
            and is_number(previous_max)
            and not math.isclose(previous_max, dimension_max, rel_tol=0, abs_tol=1e-6)
        ):
            errors.append(f"{path}.level_bands must cover through max_score")

        if (
            mode == "full"
            and rubric_source != "diagnostic_default"
            and isinstance(entry_ids, list)
            and entry_ids
        ):
            for entry_id in entry_ids:
                if (
                    not isinstance(entry_id, str)
                    or entry_id not in rubric_text_by_id
                    or rubric_entry_types.get(entry_id) != "dimension_band"
                ):
                    continue
                bound_text = rubric_text_by_id[entry_id]
                if not matches_canonical_dimension_band(
                    bound_text,
                    dimension.get("name"),
                    dimension_max,
                    increment,
                    level_bands,
                ):
                    errors.append(
                        f"{path} bound rubric entry {entry_id} must exactly match "
                        "the canonical one-dimension band declaration"
                    )
                if is_number(dimension_max) and not has_declared_value(
                    bound_text,
                    MAXIMUM_DECLARATION_PATTERNS,
                    dimension_max,
                ):
                    errors.append(
                        f"{path}.max_score is not declared by bound rubric entry "
                        f"{entry_id}"
                    )
                if is_number(increment) and not has_declared_value(
                    bound_text,
                    INCREMENT_DECLARATION_PATTERNS,
                    increment,
                ):
                    errors.append(
                        f"{path}.score_increment is not declared by bound rubric entry "
                        f"{entry_id}"
                    )
                for band_index, band in enumerate(level_bands):
                    if not isinstance(band, dict):
                        continue
                    if not has_declared_level_band(
                        bound_text,
                        band.get("name"),
                        band.get("min_score"),
                        band.get("max_score"),
                    ):
                        errors.append(
                            f"{path}.level_bands[{band_index}] is not declared "
                            f"by bound rubric entry {entry_id}"
                        )

    if rubric_source == "diagnostic_default" and rubric_dimensions:
        errors.append("diagnostic_default must not include rubric_dimensions")
    elif is_enum_value(rubric_source, VALID_RUBRIC_SOURCES) and rubric_source != "diagnostic_default":
        non_additive_entry_ids = {
            entry_id
            for entry_id, rule_type in rubric_entry_types.items()
            if rule_type == "non_additive"
        }
        dimension_band_entry_ids = {
            entry_id
            for entry_id, rule_type in rubric_entry_types.items()
            if rule_type == "dimension_band"
        }
        only_non_additive_limited = (
            mode == "limited"
            and bool(rubric_entry_ids)
            and rubric_entry_ids == non_additive_entry_ids
        )
        if not rubric_dimensions and not only_non_additive_limited:
            errors.append("non-default rubric requires rubric_dimensions")
        unbound_entry_ids = dimension_band_entry_ids - bound_rubric_entry_ids
        if mode == "full":
            if non_additive_entry_ids:
                errors.append("full mode cannot use non_additive rubric rules")
            for entry_id in sorted(unbound_entry_ids):
                errors.append(
                    f"rubric entry {entry_id} must be bound to at least one rubric dimension"
                )
            for entry_id in sorted(dimension_band_entry_ids):
                paths = rubric_entry_binding_paths.get(entry_id, [])
                if len(paths) > 1:
                    errors.append(
                        f"rubric entry {entry_id} must bind exactly one rubric dimension "
                        "in full mode"
                    )
        if (
            mode == "full"
            and score_available
            and len(dimension_maxima) == len(rubric_dimensions)
        ):
            if not math.isclose(sum(dimension_maxima), max_score, rel_tol=0, abs_tol=0.01):
                errors.append("rubric dimension max scores must sum to max_score")

    criteria = case.get("criteria")
    if not isinstance(criteria, list):
        errors.append("criteria must be an array")
        criteria = []
    valid_materials = {
        item["id"]: item["text"]
        for item in case.get("materials", [])
        if isinstance(item, dict)
        and is_nonempty_string(item.get("id"))
        and is_nonempty_string(item.get("text"))
    } if isinstance(case.get("materials"), list) else {}
    criterion_ids = set()
    criterion_keys = set()
    expected_content_dimension = (
        SHORT_CONTENT_BY_TYPE.get(question_type)
        if isinstance(question_type, str)
        else None
    )
    for index, criterion in enumerate(criteria):
        path = f"criteria[{index}]"
        if not isinstance(criterion, dict):
            errors.append(f"{path} must be an object")
            continue
        validate_exact_keys(
            criterion,
            {
                "id",
                "dimension_id",
                "counting_key",
                "expected_meaning",
                "material_evidence",
            },
            path,
            errors,
        )
        criterion_id = criterion.get("id")
        counting_key = criterion.get("counting_key")
        if not is_nonempty_string(criterion_id):
            errors.append(f"{path}.id must be a non-empty string")
        elif criterion_id in criterion_ids:
            errors.append(f"{path}.id is duplicated")
        else:
            criterion_ids.add(criterion_id)
        if not is_nonempty_string(counting_key):
            errors.append(f"{path}.counting_key must be a non-empty string")
        elif counting_key in criterion_keys:
            errors.append(f"{path}.counting_key is duplicated")
        else:
            criterion_keys.add(counting_key)
        if criterion.get("dimension_id") != expected_content_dimension:
            errors.append(f"{path}.dimension_id must match the default content dimension")
        if not is_nonempty_string(criterion.get("expected_meaning")):
            errors.append(f"{path}.expected_meaning must be a non-empty string")

        material_evidence = criterion.get("material_evidence")
        if not isinstance(material_evidence, list) or not material_evidence:
            errors.append(f"{path}.material_evidence must be a non-empty array")
            material_evidence = []
        for evidence_index, item in enumerate(material_evidence):
            evidence_path = f"{path}.material_evidence[{evidence_index}]"
            if not isinstance(item, dict):
                errors.append(f"{evidence_path} must be an object")
                continue
            validate_exact_keys(
                item,
                {"source_id", "locator", "excerpt"},
                evidence_path,
                errors,
            )
            source_id = item.get("source_id")
            locator = item.get("locator")
            excerpt = item.get("excerpt")
            if not is_nonempty_string(source_id) or source_id not in valid_materials:
                errors.append(f"{evidence_path}.source_id is unavailable")
                source_text = None
            else:
                source_text = valid_materials[source_id]
            match = LOCATOR_PATTERN.fullmatch(locator) if isinstance(locator, str) else None
            if match is None:
                errors.append(
                    f"{evidence_path}.locator must use chars:start-end with at most 9 digits"
                )
            if not is_nonempty_string(excerpt):
                errors.append(f"{evidence_path}.excerpt must be a non-empty string")
            if source_text is not None and match is not None and is_nonempty_string(excerpt):
                start, end = map(int, match.groups())
                if not 0 <= start < end <= len(source_text):
                    errors.append(f"{evidence_path}.locator is outside source bounds")
                elif source_text[start:end] != excerpt:
                    errors.append(
                        f"{evidence_path}.locator does not select excerpt exactly"
                    )

    should_lock_criteria = (
        rubric_source == "diagnostic_default"
        and isinstance(question_type, str)
        and question_type in SHORT_TYPES
        and prompt_available
        and material_count > 0
        and materials_complete is True
        and "ocr" not in declared_missing
        and reason != "rule_ambiguity"
    )
    if should_lock_criteria and not criteria:
        errors.append("complete default short case requires a locked criteria map")
    elif not should_lock_criteria and criteria:
        errors.append("criteria must be empty without a complete default short scoring basis")

    criteria_lock = case.get("criteria_lock")
    if criteria:
        try:
            expected_lock = expected_criteria_lock(case)
        except (TypeError, ValueError, OverflowError, RecursionError):
            errors.append("criteria_lock payload cannot be serialized")
        else:
            if criteria_lock != expected_lock:
                errors.append("criteria_lock does not match the non-answer scoring basis")
    elif criteria_lock is not None:
        errors.append("criteria_lock must be null when criteria is empty")

    return errors


def main(argv=None):
    parser = argparse.ArgumentParser(description="Validate a Shenlun grading case.")
    parser.add_argument("case")
    args = parser.parse_args(argv)
    try:
        case = load_json(args.case)
    except (OSError, UnicodeError, ValueError, OverflowError, RecursionError) as error:
        print("grading_case=fail", file=sys.stderr)
        print(f"- cannot read JSON: {error}", file=sys.stderr)
        return 1

    errors = validate_case(case)
    if errors:
        print("grading_case=fail", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("grading_case=pass")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
