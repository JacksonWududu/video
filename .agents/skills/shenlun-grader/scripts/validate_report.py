#!/usr/bin/env python3

import argparse
import math
import re
import sys
from fractions import Fraction

from validate_case import (
    is_enum_value,
    is_nonempty_string,
    is_number,
    load_json,
    validate_case,
)


SCHEMA_VERSION = "shenlun-grading-report-v1"
VALID_CONFIDENCE_LEVELS = {"low", "medium", "high"}
DEFAULT_LEVELS = {"strong", "adequate", "developing", "weak", "unassessable"}
LEVEL_CENTERS = {
    "strong": 0.925,
    "adequate": 0.775,
    "developing": 0.575,
    "weak": 0.225,
}
LEVEL_BOUNDS = {
    "strong": (0.85, 1.00),
    "adequate": (0.70, 0.85),
    "developing": (0.45, 0.70),
    "weak": (0.00, 0.45),
}
VALID_EVIDENCE_SOURCES = {"prompt", "answer", "material", "rubric"}
VALID_FINDING_COMBINATIONS = {
    ("credit", "full"),
    ("credit", "partial"),
    ("omission", "missing"),
    ("deduction", "unsupported"),
    ("deduction", "misdirected"),
    ("flag", "uncertain"),
    ("flag", "duplicate"),
}
VALID_CHECK_KINDS = {"requirement", "non_additive_rule"}
VALID_CHECK_SUBJECTS = {
    "title",
    "word_limit",
    "format",
    "genre",
    "identity",
    "other",
    "external_rule",
}
VALID_REQUIREMENT_STATUSES = {"satisfied", "violated", "uncertain", "not_applicable"}
VALID_RULE_STATUSES = {"triggered", "not_triggered", "uncertain", "unsupported"}
DEFAULT_DIMENSIONS = {
    "summary": {
        "task_fit": ("任务契合", 0.10),
        "content_points": ("内容要点", 0.65),
        "organization": ("组织", 0.15),
        "expression": ("表达", 0.10),
    },
    "analysis": {
        "task_fit": ("任务契合", 0.10),
        "analysis_chain": ("分析链条", 0.70),
        "organization": ("组织", 0.10),
        "expression": ("表达", 0.10),
    },
    "countermeasure": {
        "task_fit": ("任务契合", 0.10),
        "solution_quality": ("对策质量", 0.70),
        "organization": ("组织", 0.10),
        "expression": ("表达", 0.10),
    },
    "implementation": {
        "genre_task_fit": ("文种与任务契合", 0.25),
        "content_points": ("内容要点", 0.55),
        "organization": ("组织", 0.10),
        "expression": ("表达", 0.10),
    },
    "composite": {
        "task_fit": ("任务契合", 0.10),
        "subtask_content": ("子任务内容", 0.70),
        "organization": ("组织", 0.10),
        "expression": ("表达", 0.10),
    },
    "essay": {
        "thesis_alignment": ("立意", 0.25),
        "argumentation": ("论证", 0.30),
        "material_transformation": ("材料转化", 0.20),
        "structure": ("结构", 0.15),
        "language": ("语言", 0.10),
    },
}
SHORT_CONTENT_DIMENSIONS = {
    "content_points",
    "analysis_chain",
    "solution_quality",
    "subtask_content",
}
TASK_DIMENSIONS = {"task_fit", "genre_task_fit"}
MATERIAL_DEPENDENT_DIMENSIONS = SHORT_CONTENT_DIMENSIONS | {
    "thesis_alignment",
    "argumentation",
    "material_transformation",
}
ANSWER_ONLY_DIMENSIONS = {"organization", "expression", "structure", "language"}
LOCATOR_PATTERN = re.compile(r"chars:(\d{1,9})-(\d{1,9})")
ARABIC_SCORE_TEXT_PATTERN = re.compile(
    r"\d+(?:\.\d+)?\s*分(?!钟|类|组|段|项|析|别|布|工|配|解|开)"
    r"|\d+(?:\.\d+)?\s*[/／]\s*\d+(?:\.\d+)?"
    r"|(?:[一二两三四五六七八九]分|十[一二三四五六七八九]分|"
    r"[二三四五六七八九]十[一二三四五六七八九]?分|"
    r"[一二三四五六七八九]百[零一二三四五六七八九十百]*分)"
    r"(?!钟|之|法|为|类|组|段|项|析|别|布|工|配|解|开)"
)
LABELED_SCORE_TEXT_PATTERN = re.compile(
    r"(?:估分|得分|总分|分数|评分结果|成绩)\s*"
    r"(?:为|是|在|约|约在|大约|大概|大致|大致落在|落在|介于|[:：])?\s*"
    r"(?:\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百]+)"
)
CONTEXTUAL_SCORE_TEXT_PATTERN = re.compile(
    r"(?:最多|至多|只能|仅能|可得|可拿|能得|能拿|约|大约|大概|预计|估计|预估)"
    r"\s*(?:为|是|得|拿|计|有)?\s*"
    r"(?:\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百]+)"
    r"\s*(?:余|来|多)?\s*分"
    r"(?=$|[\s，。；、！？,.!?）)]|左右|上下|以上|以下)"
)
CONTEXTUAL_UNITLESS_SCORE_PATTERN = re.compile(
    r"(?:最多|至多|只能|仅能|预计|估计|预估|约|大约|大概)"
    r"\s*(?:为|是|能|可|得|拿|拿到|得到)?\s*"
    r"(?:\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百]+)"
    r"\s*(?:左右|上下|余|来|多)?"
    r"(?=$|[\s，。；、！？,.!?）)])"
)
SCORE_RATIO_VALUE_TEXT = (
    r"(?:\d+(?:\.\d+)?\s*[%％]|百分之(?:\d+(?:\.\d+)?|"
    r"[零一二三四五六七八九十百]+)|[零一二三四五六七八九十]+\s*成|"
    r"[一二三四五六七八九十]+\s*折|"
    r"[一二两三四五六七八九十百]+分之[一二两三四五六七八九十百]+|一半|"
    r"(?:0?\.\d+|1\.0+)\s*(?:倍)?)"
)
SCORE_RATIO_TEXT_PATTERN = re.compile(
    r"(?:得分率|得分比例|分数比例|评分比例|成绩比例)"
    r"\s*(?:为|约为|是|约|大约|大概|介于|[:：])?\s*"
    + SCORE_RATIO_VALUE_TEXT
    + r"|(?:得分|分数|成绩)\s*(?:约|大约|大概)?\s*"
    r"(?:占|达到|相当于)\s*(?:总分|满分)(?:的)?\s*"
    + SCORE_RATIO_VALUE_TEXT
    + r"|(?:约|大约|大概|预计)?\s*(?:占|达到|相当于)\s*"
    r"(?:总分|满分)(?:的)?\s*"
    + SCORE_RATIO_VALUE_TEXT
    + r"|(?:此答|答案|答卷|作文|文章).{0,12}"
    r"(?:(?:约|大约|大概|预计)?\s*(?:能得|可得|只能得|预计得|能拿到|可拿到))"
    r"\s*(?:(?:总分|满分)(?:的)?\s*)?"
    + SCORE_RATIO_VALUE_TEXT
    + r"|(?:可取得|可获得|能取得|能获得)\s*(?:总分|满分)(?:的)?\s*"
    + SCORE_RATIO_VALUE_TEXT
    + r"|(?:折算后|换算后)\s*(?:约|大约|大概)?\s*(?:为|是)?\s*"
    + SCORE_RATIO_VALUE_TEXT
    + r"|(?:训练)?(?:得分|评分|成绩)(?:比例)?系数\s*(?:为|是|[:：])?\s*"
    + SCORE_RATIO_VALUE_TEXT
)
POSTFIX_SCORE_RATIO_TEXT_PATTERN = re.compile(
    r"(?:此答|答案|答卷|作文|文章|结果).{0,16}"
    + SCORE_RATIO_VALUE_TEXT
    + r"\s*(?:成绩|得分|分数|得分水平|成绩水平|满分表现|满分)"
    + r"|"
    + SCORE_RATIO_VALUE_TEXT
    + r"\s*(?:左右|上下)?\s*(?:的)?\s*"
    r"(?:得分水平|成绩水平|满分表现|得分|成绩)"
    + r"|(?:此答|答案|答卷|作文|文章|结果).{0,12}"
    r"(?:约|大约|大概|为|是)?\s*(?:总分|满分)(?:的)?\s*"
    + SCORE_RATIO_VALUE_TEXT
    + r"|(?:表现|得分|成绩|分数).{0,8}(?:落在|约在|介于|为|是)?\s*"
    + SCORE_RATIO_VALUE_TEXT
    + r"\s*(?:至|到|[-—–~～])\s*"
    + SCORE_RATIO_VALUE_TEXT
    + r"(?:之间|左右)?"
)
ANSWER_UNITLESS_SCORE_PATTERN = re.compile(
    r"(?:(?:此|这|该)(?:份)?(?:答|答案|答卷|作文|文章)\s*)?"
    r"(?:约|大约|大概|预计|估计|预估)?\s*"
    r"(?:能拿|可拿|拿到|能得|可得|得到|可获|能获|获得)\s*"
    r"(?:到|为)?\s*"
    r"(?:\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百]+)"
    r"\s*(?:左右|上下|余|来|多)?"
    r"(?=$|[\s，。；、！？,.!?）)])"
)
DIRECT_RATIO_SCORE_PATTERN = re.compile(
    r"(?:得分|成绩|分数)\s*(?:约为|大约为|为|是|打|按|约|大约|大概)?\s*"
    + SCORE_RATIO_VALUE_TEXT
    + r"|(?:(?:此|这|该)(?:份)?(?:答|答案|答卷|作文|文章))[^。；;\n]{0,12}"
    + SCORE_RATIO_VALUE_TEXT
    + r"\s*(?:水平|成绩|得分|分数)?"
    r"|(?:约|大约|大概|预计|估计|预估)?\s*"
    r"(?:只能拿|仅能拿|能拿|可拿|只能得|仅能得|能得|可得)\s*"
    + SCORE_RATIO_VALUE_TEXT
)
TOLERANCE = 1e-6


def close(left, right, tolerance=TOLERANCE):
    return math.isclose(left, right, rel_tol=0, abs_tol=tolerance)


def round_half_up(value):
    return math.floor(value * 2 + 0.5 + TOLERANCE) / 2


def floor_half(value):
    return math.floor(value * 2 + TOLERANCE) / 2


def ceil_half(value):
    return math.ceil(value * 2 - TOLERANCE) / 2


def is_half_step(value):
    return is_number(value) and close(value * 2, round(value * 2))


def validate_exact_keys(item, allowed, path, errors):
    if not isinstance(item, dict):
        return
    extras = sorted(set(item) - set(allowed))
    if extras:
        errors.append(f"{path} has unsupported fields: {', '.join(extras)}")


def contains_numeric_score_language(value):
    return isinstance(value, str) and (
        bool(ARABIC_SCORE_TEXT_PATTERN.search(value))
        or bool(LABELED_SCORE_TEXT_PATTERN.search(value))
        or bool(CONTEXTUAL_SCORE_TEXT_PATTERN.search(value))
        or bool(CONTEXTUAL_UNITLESS_SCORE_PATTERN.search(value))
        or bool(SCORE_RATIO_TEXT_PATTERN.search(value))
        or bool(POSTFIX_SCORE_RATIO_TEXT_PATTERN.search(value))
        or bool(ANSWER_UNITLESS_SCORE_PATTERN.search(value))
        or bool(DIRECT_RATIO_SCORE_PATTERN.search(value))
    )


def default_level_for_ratio(ratio):
    if ratio >= 0.85 - TOLERANCE:
        return "strong"
    if ratio >= 0.70 - TOLERANCE:
        return "adequate"
    if ratio >= 0.45 - TOLERANCE:
        return "developing"
    return "weak"


def allocate_default_maxima(max_score, question_type):
    configured = DEFAULT_DIMENSIONS[question_type]
    total_units = int(round(max_score * 2))
    raw_units = [
        Fraction(str(weight)) * total_units for _, weight in configured.values()
    ]
    allocated = [value.numerator // value.denominator for value in raw_units]
    remaining = total_units - sum(allocated)
    order = sorted(
        range(len(raw_units)),
        key=lambda index: (-(raw_units[index] - allocated[index]), index),
    )
    for index in order[:remaining]:
        allocated[index] += 1
    return {
        dimension_id: units / 2
        for dimension_id, units in zip(configured, allocated)
    }


def minimum_range_width(max_score):
    return ceil_half(max_score * 0.10)


def conservative_score_range(raw_lower, raw_upper, maximum):
    lower = max(0.0, floor_half(raw_lower))
    upper = min(maximum, ceil_half(raw_upper))
    required_width = minimum_range_width(maximum)
    shortfall = max(0.0, required_width - (upper - lower))
    if shortfall > TOLERANCE:
        lower_extension = min(lower, ceil_half(shortfall))
        lower -= lower_extension
        shortfall -= lower_extension
    if shortfall > TOLERANCE:
        upper += min(maximum - upper, ceil_half(shortfall))
    return {"min": lower, "max": upper}


def expected_default_score_range(case, dimension_by_id, unit_totals, center_score):
    raw_lower = 0.0
    raw_upper = 0.0
    question_type = case["question_type"]
    for dimension_id, item in dimension_by_id.items():
        item_max = item.get("max_score")
        if not is_number(item_max):
            return None
        if question_type != "essay" and dimension_id in SHORT_CONTENT_DIMENSIONS:
            totals = unit_totals[dimension_id]
            if totals["max"] <= 0:
                return None
            raw_lower += item_max * totals["lower"] / totals["max"]
            raw_upper += item_max * totals["upper"] / totals["max"]
        else:
            level = item.get("qualitative_level")
            if not isinstance(level, str) or level not in LEVEL_BOUNDS:
                return None
            lower_ratio, upper_ratio = LEVEL_BOUNDS[level]
            raw_lower += item_max * lower_ratio
            raw_upper += item_max * upper_ratio

    if is_number(center_score):
        raw_lower = min(raw_lower, center_score)
        raw_upper = max(raw_upper, center_score)

    return conservative_score_range(raw_lower, raw_upper, case["max_score"])


def expected_external_score_range(case, dimension_by_id, case_dimensions):
    raw_lower = 0.0
    raw_upper = 0.0
    for dimension_id, item in dimension_by_id.items():
        configured = case_dimensions.get(dimension_id)
        level = item.get("qualitative_level")
        if configured is None or not isinstance(level, str):
            return None
        band = next(
            (
                candidate
                for candidate in configured["level_bands"]
                if isinstance(candidate, dict) and candidate.get("name") == level
            ),
            None,
        )
        if band is None:
            return None
        raw_lower += band["min_score"]
        raw_upper += band["max_score"]
    return conservative_score_range(raw_lower, raw_upper, case["max_score"])


def validate_refs(raw_refs, path, evidence_ids, errors):
    if not isinstance(raw_refs, list) or not raw_refs:
        errors.append(f"{path} must be a non-empty array")
        return set()

    seen = set()
    valid = set()
    for index, ref in enumerate(raw_refs):
        ref_path = f"{path}[{index}]"
        if not is_nonempty_string(ref):
            errors.append(f"{ref_path} must be a non-empty string")
        elif ref in seen:
            errors.append(f"{ref_path} is duplicated")
        elif ref not in evidence_ids:
            errors.append(f"{ref_path} references unknown evidence id {ref}")
        else:
            seen.add(ref)
            valid.add(ref)
    return valid


def evidence_source_set(refs, evidence_sources):
    return {evidence_sources.get(ref) for ref in refs}


def validate_default_evidence_mix(
    refs,
    dimension_id,
    level,
    evidence_sources,
    path,
    errors,
):
    if not isinstance(dimension_id, str):
        return
    if level == "unassessable":
        return
    sources = evidence_source_set(refs, evidence_sources)
    if dimension_id in TASK_DIMENSIONS:
        if not {"prompt", "answer"}.issubset(sources):
            errors.append(f"{path} requires prompt and answer evidence")
    elif dimension_id in SHORT_CONTENT_DIMENSIONS:
        if not {"answer", "material"}.issubset(sources):
            errors.append(f"{path} requires answer and material evidence")
    elif dimension_id == "thesis_alignment":
        if not {"prompt", "answer", "material"}.issubset(sources):
            errors.append(f"{path} requires prompt, answer, and material evidence")
    elif dimension_id in {"argumentation", "material_transformation"}:
        if not {"answer", "material"}.issubset(sources):
            errors.append(f"{path} requires answer and material evidence")
    elif dimension_id in ANSWER_ONLY_DIMENSIONS and "answer" not in sources:
        errors.append(f"{path} requires answer evidence")


def expected_default_dimension_ids(case):
    question_type = case["question_type"]
    if question_type == "unknown":
        return {"expression"}
    return set(DEFAULT_DIMENSIONS[question_type])


def required_unassessable_dimensions(case, dimension_ids):
    if case["grading_mode"] != "limited" or case["rubric_source"] != "diagnostic_default":
        return set()
    missing = set(case["missing_inputs"])
    if "ocr" in missing:
        return set(dimension_ids)
    required = set()
    if "prompt" in missing:
        required |= (TASK_DIMENSIONS | MATERIAL_DEPENDENT_DIMENSIONS) & set(dimension_ids)
    if "materials" in missing:
        required |= MATERIAL_DEPENDENT_DIMENSIONS & set(dimension_ids)
    return required


def external_dimensions(case):
    return {
        item["id"]: item
        for item in case["rubric_dimensions"]
        if isinstance(item, dict) and is_nonempty_string(item.get("id"))
    }


def unbound_external_rubric_entries(case):
    all_entries = {
        item["id"]
        for item in case["rubric_entries"]
        if isinstance(item, dict) and is_nonempty_string(item.get("id"))
    }
    bound_entries = {
        entry_id
        for dimension in case["rubric_dimensions"]
        if isinstance(dimension, dict)
        for entry_id in dimension.get("rubric_entry_ids", [])
        if is_nonempty_string(entry_id)
    }
    return all_entries - bound_entries


def non_additive_rubric_entries(case):
    return {
        item["id"]
        for item in case["rubric_entries"]
        if isinstance(item, dict)
        and is_nonempty_string(item.get("id"))
        and item.get("rule_type") == "non_additive"
    }


def validate_external_rubric_refs(
    refs,
    dimension_id,
    case_dimensions,
    evidence_sources,
    evidence_source_ids,
    path,
    errors,
    require_all=False,
):
    if not isinstance(dimension_id, str):
        return
    configured = case_dimensions.get(dimension_id)
    if configured is None:
        return
    permitted = set(configured["rubric_entry_ids"])
    cited = {
        evidence_source_ids.get(ref)
        for ref in refs
        if evidence_sources.get(ref) == "rubric"
    }
    if require_all:
        if not permitted.issubset(cited):
            errors.append(f"{path} must cite all configured rubric entries")
    elif not cited.intersection(permitted):
        errors.append(f"{path} must cite its configured rubric entry")


def validate_scoring_units(raw, path, combination, needs_units, errors):
    if not needs_units:
        if raw is not None:
            errors.append(f"{path} must be null outside a default short-content criterion")
        return None

    if not isinstance(raw, dict) or set(raw) != {"max", "awarded"}:
        errors.append(f"{path} must contain only max and awarded")
        return None
    maximum = raw.get("max")
    awarded = raw.get("awarded")
    if not is_number(maximum) or not is_number(awarded):
        errors.append(f"{path}.max and awarded must be finite numbers")
        return None

    expected_by_combination = {
        ("credit", "full"): (1, 1),
        ("credit", "partial"): (1, 0.5),
        ("omission", "missing"): (1, 0),
        ("deduction", "misdirected"): (1, 0),
        ("deduction", "unsupported"): (0, 0),
        ("flag", "uncertain"): (1, 0.5),
        ("flag", "duplicate"): (0, 0),
    }
    expected = (
        expected_by_combination.get(combination)
        if all(isinstance(item, str) for item in combination)
        else None
    )
    if expected is not None and (
        not close(maximum, expected[0]) or not close(awarded, expected[1])
    ):
        errors.append(f"{path} conflicts with finding judgment")
    return maximum, awarded


def validate_report(case, report):
    case_errors = validate_case(case)
    if case_errors:
        return [f"case: {error}" for error in case_errors]
    if not isinstance(report, dict):
        return ["report root must be an object"]

    errors = []
    required = {
        "schema_version",
        "question_id",
        "grading_mode",
        "rubric_version",
        "rubric_source",
        "disclaimer",
        "overall_assessment",
        "estimated_score",
        "score_range",
        "dimensions",
        "evidence",
        "findings",
        "checks",
        "priority_fixes",
        "confidence",
    }
    for key in sorted(required - report.keys()):
        errors.append(f"{key} is required")
    validate_exact_keys(report, required, "report", errors)

    if report.get("schema_version") != SCHEMA_VERSION:
        errors.append(f"schema_version must be {SCHEMA_VERSION}")
    for key in ("question_id", "grading_mode", "rubric_version", "rubric_source"):
        if report.get(key) != case[key]:
            errors.append(f"{key} must match case")
    if not is_nonempty_string(report.get("disclaimer")) or "非官方" not in report.get(
        "disclaimer", ""
    ):
        errors.append("disclaimer must explicitly state 非官方")
    if not is_nonempty_string(report.get("overall_assessment")):
        errors.append("overall_assessment must be a non-empty string")

    mode = case["grading_mode"]
    max_score = case["max_score"]
    estimated_score = report.get("estimated_score")
    score_range = report.get("score_range")
    diagnostic_default = case["rubric_source"] == "diagnostic_default"

    if mode == "full":
        if not is_number(estimated_score):
            errors.append("full mode estimated_score must be a finite number")
        elif not 0 <= estimated_score <= max_score:
            errors.append("estimated_score must be within case score bounds")
        elif diagnostic_default and not (
            is_half_step(estimated_score) or close(estimated_score, max_score)
        ):
            errors.append("diagnostic_default estimated_score must use 0.5-point precision")

        if not isinstance(score_range, dict):
            errors.append("full mode score_range must be an object")
        else:
            validate_exact_keys(score_range, {"min", "max"}, "score_range", errors)
            lower = score_range.get("min")
            upper = score_range.get("max")
            if not is_number(lower) or not is_number(upper):
                errors.append("score_range min and max must be finite numbers")
            else:
                if lower > upper:
                    errors.append("score_range.min must not exceed score_range.max")
                if lower < 0 or upper > max_score:
                    errors.append("score_range must be within case score bounds")
                if is_number(estimated_score) and not lower <= estimated_score <= upper:
                    errors.append("score_range must contain estimated_score")
                if not (
                    is_half_step(lower)
                    and (is_half_step(upper) or close(upper, max_score))
                ):
                    errors.append("score_range must use conservative 0.5-point precision")
                if upper - lower + TOLERANCE < minimum_range_width(max_score):
                    errors.append("score_range is too narrow")
    else:
        if estimated_score is not None:
            errors.append("limited mode estimated_score must be null")
        if score_range is not None:
            errors.append("limited mode score_range must be null")

    source_texts = {
        "prompt": {"prompt": case.get("prompt")},
        "answer": {"answer": case["answer"]},
        "material": {item["id"]: item["text"] for item in case["materials"]},
        "rubric": {item["id"]: item["text"] for item in case["rubric_entries"]},
    }
    evidence = report.get("evidence")
    evidence_ids = set()
    evidence_sources = {}
    evidence_source_ids = {}
    evidence_records = {}
    used_evidence_refs = set()
    if not isinstance(evidence, list) or not evidence:
        errors.append("evidence must be a non-empty array")
        evidence = []

    for index, item in enumerate(evidence):
        path = f"evidence[{index}]"
        if not isinstance(item, dict):
            errors.append(f"{path} must be an object")
            continue
        validate_exact_keys(
            item,
            {"id", "source", "source_id", "locator", "excerpt"},
            path,
            errors,
        )
        evidence_id = item.get("id")
        source = item.get("source")
        source_id = item.get("source_id")
        locator = item.get("locator")
        excerpt = item.get("excerpt")
        if not is_nonempty_string(evidence_id):
            errors.append(f"{path}.id must be a non-empty string")
        elif evidence_id in evidence_ids:
            errors.append(f"{path}.id is duplicated")
        else:
            evidence_ids.add(evidence_id)
            if is_enum_value(source, VALID_EVIDENCE_SOURCES):
                evidence_sources[evidence_id] = source
                if is_nonempty_string(source_id):
                    evidence_source_ids[evidence_id] = source_id
                if all(
                    is_nonempty_string(value)
                    for value in (source_id, locator, excerpt)
                ):
                    evidence_records[evidence_id] = (
                        source,
                        source_id,
                        locator,
                        excerpt,
                    )

        if not is_enum_value(source, VALID_EVIDENCE_SOURCES):
            errors.append(f"{path}.source is unsupported")
            source_text = None
        elif not is_nonempty_string(source_id) or source_id not in source_texts[source]:
            errors.append(f"{path}.source_id is unavailable for {source}")
            source_text = None
        else:
            source_text = source_texts[source][source_id]
            if not is_nonempty_string(source_text):
                errors.append(f"{path}.source references unavailable text")
                source_text = None

        match = LOCATOR_PATTERN.fullmatch(locator) if isinstance(locator, str) else None
        if match is None:
            errors.append(f"{path}.locator must use chars:start-end with at most 9 digits")
        if not is_nonempty_string(excerpt):
            errors.append(f"{path}.excerpt must be a non-empty string")
        if source_text is not None and match is not None and is_nonempty_string(excerpt):
            try:
                start, end = map(int, match.groups())
            except (TypeError, ValueError):
                errors.append(f"{path}.locator contains invalid integers")
            else:
                if not 0 <= start < end <= len(source_text):
                    errors.append(f"{path}.locator is outside source bounds")
                elif source_text[start:end] != excerpt:
                    errors.append(f"{path}.locator does not select excerpt exactly")

    case_dimensions = external_dimensions(case)
    non_additive_entry_ids = non_additive_rubric_entries(case)
    rubric_text_by_id = {
        item["id"]: item["text"]
        for item in case["rubric_entries"]
        if isinstance(item, dict)
        and is_nonempty_string(item.get("id"))
        and is_nonempty_string(item.get("text"))
    }
    case_prompt_requirement_keys = {
        (item["subject"], item["locator"], item["excerpt"])
        for item in case["prompt_requirements"]
    }
    checks = report.get("checks")
    checked_non_additive_ids = set()
    checked_prompt_requirement_keys = set()
    if not isinstance(checks, list):
        errors.append("checks must be an array")
        checks = []

    for index, item in enumerate(checks):
        path = f"checks[{index}]"
        if not isinstance(item, dict):
            errors.append(f"{path} must be an object")
            continue
        validate_exact_keys(
            item,
            {
                "id",
                "kind",
                "subject",
                "status",
                "rule_entry_id",
                "requirement",
                "reason",
                "score_effect",
                "evidence_refs",
            },
            path,
            errors,
        )
        if not is_nonempty_string(item.get("id")):
            errors.append(f"{path}.id must be a non-empty string")
        elif any(
            earlier.get("id") == item["id"]
            for earlier in checks[:index]
            if isinstance(earlier, dict)
        ):
            errors.append(f"{path}.id is duplicated")
        kind = item.get("kind")
        subject = item.get("subject")
        status = item.get("status")
        rule_entry_id = item.get("rule_entry_id")
        if not is_enum_value(kind, VALID_CHECK_KINDS):
            errors.append(f"{path}.kind is unsupported")
        if not is_enum_value(subject, VALID_CHECK_SUBJECTS):
            errors.append(f"{path}.subject is unsupported")
        if not is_nonempty_string(item.get("requirement")):
            errors.append(f"{path}.requirement must be a non-empty string")
        if not is_nonempty_string(item.get("reason")):
            errors.append(f"{path}.reason must be a non-empty string")
        if item.get("score_effect") is not None:
            errors.append(f"{path}.score_effect must be null")

        refs = validate_refs(
            item.get("evidence_refs"),
            f"{path}.evidence_refs",
            evidence_ids,
            errors,
        )
        used_evidence_refs.update(refs)
        sources = evidence_source_set(refs, evidence_sources)
        if kind == "requirement":
            if not is_enum_value(status, VALID_REQUIREMENT_STATUSES):
                errors.append(f"{path}.status is unsupported for a requirement check")
            if rule_entry_id is not None:
                errors.append(f"{path}.rule_entry_id must be null for a requirement check")
            if subject == "external_rule":
                errors.append(f"{path}.subject cannot be external_rule for a requirement check")
            if not {"prompt", "answer"}.issubset(sources):
                errors.append(f"{path} requirement check needs prompt and answer evidence")
            cited_prompt_records = {
                (record[2], record[3])
                for ref in refs
                if (record := evidence_records.get(ref)) is not None
                and record[0] == "prompt"
            }
            requirement = item.get("requirement")
            if not is_nonempty_string(requirement) or not any(
                excerpt == requirement for _locator, excerpt in cited_prompt_records
            ):
                errors.append(f"{path}.requirement must equal its cited prompt excerpt")
            if is_enum_value(subject, VALID_CHECK_SUBJECTS) and is_nonempty_string(
                requirement
            ):
                matched_requirement_keys = {
                    (subject, locator, excerpt)
                    for locator, excerpt in cited_prompt_records
                    if excerpt == requirement
                    and (subject, locator, excerpt) in case_prompt_requirement_keys
                }
                if len(matched_requirement_keys) != 1:
                    errors.append(f"{path} does not match a locked prompt requirement")
                else:
                    requirement_key = next(iter(matched_requirement_keys))
                    if requirement_key in checked_prompt_requirement_keys:
                        errors.append(f"{path} duplicates a locked prompt requirement")
                    else:
                        checked_prompt_requirement_keys.add(requirement_key)
        elif kind == "non_additive_rule":
            if not is_enum_value(status, VALID_RULE_STATUSES):
                errors.append(f"{path}.status is unsupported for a non_additive_rule check")
            if subject != "external_rule":
                errors.append(f"{path}.subject must be external_rule")
            if not is_nonempty_string(rule_entry_id) or rule_entry_id not in non_additive_entry_ids:
                errors.append(f"{path}.rule_entry_id must reference a non_additive rubric entry")
            else:
                if rule_entry_id in checked_non_additive_ids:
                    errors.append(f"{path}.rule_entry_id is duplicated")
                checked_non_additive_ids.add(rule_entry_id)
                cited_rule_ids = {
                    evidence_source_ids.get(ref)
                    for ref in refs
                    if evidence_sources.get(ref) == "rubric"
                }
                if rule_entry_id not in cited_rule_ids:
                    errors.append(f"{path} must cite its exact non_additive rubric entry")
                if item.get("requirement") != rubric_text_by_id.get(rule_entry_id):
                    errors.append(
                        f"{path}.requirement must equal its non_additive rubric text"
                    )
            if "answer" not in sources:
                errors.append(f"{path} non_additive_rule check needs answer evidence")

    for entry_id in sorted(non_additive_entry_ids - checked_non_additive_ids):
        errors.append(f"non_additive rubric entry {entry_id} needs exactly one check")
    for subject, locator, requirement in sorted(
        case_prompt_requirement_keys - checked_prompt_requirement_keys
    ):
        errors.append(
            f"locked prompt requirement {subject}@{locator}:{requirement} "
            "needs exactly one check"
        )

    dimensions = report.get("dimensions")
    dimension_ids = set()
    dimension_by_id = {}
    dimension_scores = []
    dimension_maxima = []
    allow_empty_dimensions = (
        mode == "limited"
        and not diagnostic_default
        and not case_dimensions
        and bool(non_additive_entry_ids)
    )
    if not isinstance(dimensions, list):
        errors.append("dimensions must be an array")
        dimensions = []
    elif not dimensions and not allow_empty_dimensions:
        errors.append("dimensions must be a non-empty array")

    for index, item in enumerate(dimensions):
        path = f"dimensions[{index}]"
        if not isinstance(item, dict):
            errors.append(f"{path} must be an object")
            continue
        validate_exact_keys(
            item,
            {
                "id",
                "name",
                "max_score",
                "score",
                "qualitative_level",
                "reason",
                "evidence_refs",
            },
            path,
            errors,
        )
        dimension_id = item.get("id")
        level = item.get("qualitative_level")
        if not is_nonempty_string(dimension_id):
            errors.append(f"{path}.id must be a non-empty string")
        elif dimension_id in dimension_ids:
            errors.append(f"{path}.id is duplicated")
        else:
            dimension_ids.add(dimension_id)
            dimension_by_id[dimension_id] = item
        if not is_nonempty_string(item.get("name")):
            errors.append(f"{path}.name must be a non-empty string")
        if not is_nonempty_string(item.get("reason")):
            errors.append(f"{path}.reason must be a non-empty string")
        if diagnostic_default:
            if not is_enum_value(level, DEFAULT_LEVELS):
                errors.append(f"{path}.qualitative_level is unsupported")
        elif not is_nonempty_string(level):
            errors.append(f"{path}.qualitative_level must be a non-empty string")

        score = item.get("score")
        item_max = item.get("max_score")
        if mode == "full":
            if level == "unassessable":
                errors.append(f"{path} cannot be unassessable in full mode")
            if not is_number(score) or score < 0:
                errors.append(f"{path}.score must be a non-negative number")
            else:
                dimension_scores.append(score)
            if not is_number(item_max) or item_max <= 0:
                errors.append(f"{path}.max_score must be positive")
            else:
                dimension_maxima.append(item_max)
            if is_number(score) and is_number(item_max) and score > item_max:
                errors.append(f"{path}.score must not exceed max_score")
            if diagnostic_default and is_number(score) and not (
                is_half_step(score) or (is_number(item_max) and close(score, item_max))
            ):
                errors.append(f"{path}.score must use 0.5-point precision")
        else:
            if score is not None:
                errors.append(f"{path}.score must be null in limited mode")
            if item_max is not None:
                errors.append(f"{path}.max_score must be null in limited mode")

        refs = validate_refs(
            item.get("evidence_refs"),
            f"{path}.evidence_refs",
            evidence_ids,
            errors,
        )
        used_evidence_refs.update(refs)
        if diagnostic_default:
            validate_default_evidence_mix(
                refs,
                dimension_id,
                level,
                evidence_sources,
                path,
                errors,
            )
        else:
            validate_external_rubric_refs(
                refs,
                dimension_id,
                case_dimensions,
                evidence_sources,
                evidence_source_ids,
                path,
                errors,
                require_all=True,
            )
            dimension_sources = evidence_source_set(refs, evidence_sources)
            if level != "unassessable" and "answer" not in dimension_sources:
                errors.append(f"{path} requires answer evidence")
            if mode == "full":
                missing_chain_sources = {
                    "prompt",
                    "material",
                    "answer",
                    "rubric",
                } - dimension_sources
                if missing_chain_sources:
                    errors.append(
                        f"{path} external full score requires prompt, material, "
                        "answer, and rubric evidence"
                    )
            configured = case_dimensions.get(dimension_id) if isinstance(dimension_id, str) else None
            if configured is not None and level != "unassessable":
                bands = {
                    band["name"]: band
                    for band in configured["level_bands"]
                    if isinstance(band, dict) and is_nonempty_string(band.get("name"))
                }
                band = bands.get(level) if isinstance(level, str) else None
                if band is None:
                    errors.append(f"{path}.qualitative_level is absent from rubric level_bands")
                elif mode == "full" and is_number(score):
                    if not band["min_score"] - TOLERANCE <= score <= band["max_score"] + TOLERANCE:
                        errors.append(f"{path}.score conflicts with rubric level band")
                increment = configured.get("score_increment")
                if mode == "full" and is_number(score) and is_number(increment):
                    if not close(score / increment, round(score / increment)):
                        errors.append(f"{path}.score does not align to rubric score_increment")

    if mode == "full" and len(dimension_scores) == len(dimensions):
        if is_number(estimated_score) and not close(sum(dimension_scores), estimated_score):
            errors.append("dimension scores must sum to estimated_score")
    if mode == "full" and len(dimension_maxima) == len(dimensions):
        if not close(sum(dimension_maxima), max_score, tolerance=0.01):
            errors.append("dimension max scores must sum to case max_score")

    if diagnostic_default:
        expected_ids = expected_default_dimension_ids(case)
        if dimension_ids != expected_ids:
            errors.append("diagnostic_default dimensions do not match question_type")
        expected = (
            {"expression": ("表达", 1.0)}
            if case["question_type"] == "unknown"
            else DEFAULT_DIMENSIONS[case["question_type"]]
        )
        allocated_maxima = (
            allocate_default_maxima(max_score, case["question_type"])
            if mode == "full"
            else {}
        )
        for dimension_id, (expected_name, _weight) in expected.items():
            item = dimension_by_id.get(dimension_id)
            if item is None:
                continue
            if item.get("name") != expected_name:
                errors.append(f"dimension {dimension_id} name does not match default rubric")
            if mode == "full" and is_number(item.get("max_score")):
                expected_max = allocated_maxima[dimension_id]
                if not close(item["max_score"], expected_max, tolerance=0.01):
                    errors.append(
                        f"dimension {dimension_id} max_score does not match default weight"
                    )
        required_unassessable = required_unassessable_dimensions(case, dimension_ids)
        for dimension_id in required_unassessable:
            if (
                dimension_by_id.get(dimension_id, {}).get("qualitative_level")
                != "unassessable"
            ):
                errors.append(
                    f"dimension {dimension_id} must be unassessable with missing inputs"
                )
    else:
        expected_ids = set(case_dimensions)
        if dimension_ids != expected_ids:
            errors.append("report dimensions must match configured rubric_dimensions")
        for dimension_id, configured in case_dimensions.items():
            item = dimension_by_id.get(dimension_id)
            if item is None:
                continue
            if item.get("name") != configured["name"]:
                errors.append(f"dimension {dimension_id} name must match rubric_dimensions")
            if mode == "full" and is_number(item.get("max_score")) and not close(
                item["max_score"], configured["max_score"], tolerance=0.01
            ):
                errors.append(
                    f"dimension {dimension_id} max_score must match rubric_dimensions"
                )
        if unbound_external_rubric_entries(case):
            for dimension_id, item in dimension_by_id.items():
                if item.get("qualitative_level") != "unassessable":
                    errors.append(
                        f"dimension {dimension_id} must be unassessable with unbound external rules"
                    )

    if case["mode_reason"] == "rule_ambiguity" and dimensions and not any(
        item.get("qualitative_level") == "unassessable"
        for item in dimensions
        if isinstance(item, dict)
    ):
        errors.append("rule_ambiguity requires at least one unassessable dimension")

    findings = report.get("findings")
    locked_criteria = {
        item["id"]: item
        for item in case["criteria"]
        if isinstance(item, dict) and is_nonempty_string(item.get("id"))
    }
    finding_ids = set()
    credited_keys = set()
    used_keys = set()
    unit_totals = {
        dimension_id: {"max": 0.0, "awarded": 0.0, "lower": 0.0, "upper": 0.0}
        for dimension_id in SHORT_CONTENT_DIMENSIONS
    }
    primary_criteria = {
        dimension_id: set() for dimension_id in SHORT_CONTENT_DIMENSIONS
    }
    matched_locked_criteria = set()
    finding_dimensions = set()
    if not isinstance(findings, list):
        errors.append("findings must be an array")
        findings = []
    elif not findings and not allow_empty_dimensions:
        errors.append("findings must be a non-empty array")

    for index, item in enumerate(findings):
        path = f"findings[{index}]"
        if not isinstance(item, dict):
            errors.append(f"{path} must be an object")
            continue
        validate_exact_keys(
            item,
            {
                "id",
                "type",
                "criterion_id",
                "counting_key",
                "dimension_id",
                "judgment",
                "scoring_units",
                "evidence_refs",
                "explanation",
            },
            path,
            errors,
        )
        if "score_effect" in item:
            errors.append(
                f"{path}.score_effect is forbidden; dimensions are the numeric ledger"
            )
        if "scoring_units" not in item:
            errors.append(f"{path}.scoring_units is required")
        finding_id = item.get("id")
        finding_type = item.get("type")
        judgment = item.get("judgment")
        combination = (finding_type, judgment)
        dimension_id = item.get("dimension_id")
        criterion_id = item.get("criterion_id")
        counting_key = item.get("counting_key")
        if not is_nonempty_string(finding_id):
            errors.append(f"{path}.id must be a non-empty string")
        elif finding_id in finding_ids:
            errors.append(f"{path}.id is duplicated")
        else:
            finding_ids.add(finding_id)
        if not is_nonempty_string(criterion_id):
            errors.append(f"{path}.criterion_id must be a non-empty string")
        if not is_nonempty_string(item.get("explanation")):
            errors.append(f"{path}.explanation must be a non-empty string")
        if not is_nonempty_string(dimension_id) or dimension_id not in dimension_ids:
            errors.append(f"{path}.dimension_id references unknown dimension")
        else:
            finding_dimensions.add(dimension_id)
        if (
            not isinstance(finding_type, str)
            or not isinstance(judgment, str)
            or combination not in VALID_FINDING_COMBINATIONS
        ):
            errors.append(f"{path}.type and judgment combination is unsupported")

        if not is_nonempty_string(counting_key):
            errors.append(f"{path}.counting_key must be a non-empty string")
        elif judgment == "duplicate":
            if counting_key not in credited_keys:
                errors.append(f"{path} duplicate must follow a credited counting_key")
        elif counting_key in used_keys:
            errors.append(f"{path} repeats counting_key without duplicate judgment")
        else:
            used_keys.add(counting_key)
            if finding_type == "credit" and judgment in ("full", "partial"):
                credited_keys.add(counting_key)

        needs_units = (
            diagnostic_default
            and case["question_type"] != "essay"
            and bool(locked_criteria)
            and isinstance(dimension_id, str)
            and dimension_id in SHORT_CONTENT_DIMENSIONS
        )
        units = validate_scoring_units(
            item.get("scoring_units"),
            f"{path}.scoring_units",
            combination,
            needs_units,
            errors,
        )
        if units is not None and isinstance(dimension_id, str) and dimension_id in unit_totals:
            maximum, awarded = units
            unit_totals[dimension_id]["max"] += maximum
            unit_totals[dimension_id]["awarded"] += awarded
            unit_totals[dimension_id]["lower"] += (
                0 if combination == ("flag", "uncertain") else awarded
            )
            unit_totals[dimension_id]["upper"] += (
                1 if combination == ("flag", "uncertain") else awarded
            )
            if close(maximum, 1) and is_nonempty_string(criterion_id):
                if criterion_id in primary_criteria[dimension_id]:
                    errors.append(f"{path}.criterion_id repeats a scored criterion")
                else:
                    primary_criteria[dimension_id].add(criterion_id)
                configured_criterion = (
                    locked_criteria.get(criterion_id)
                    if is_nonempty_string(criterion_id)
                    else None
                )
                if configured_criterion is None:
                    errors.append(f"{path}.criterion_id is absent from locked criteria")
                else:
                    matched_locked_criteria.add(criterion_id)
                    if dimension_id != configured_criterion.get("dimension_id"):
                        errors.append(f"{path}.dimension_id conflicts with locked criterion")
                    if counting_key != configured_criterion.get("counting_key"):
                        errors.append(f"{path}.counting_key conflicts with locked criterion")

        refs = validate_refs(
            item.get("evidence_refs"),
            f"{path}.evidence_refs",
            evidence_ids,
            errors,
        )
        used_evidence_refs.update(refs)
        sources = evidence_source_set(refs, evidence_sources)
        if needs_units and units is not None and close(units[0], 1):
            if "material" not in sources:
                errors.append(f"{path} scored criterion requires material evidence")
            configured_criterion = (
                locked_criteria.get(criterion_id)
                if is_nonempty_string(criterion_id)
                else None
            )
            if configured_criterion is not None:
                expected_material = {
                    (
                        evidence_item.get("source_id"),
                        evidence_item.get("locator"),
                        evidence_item.get("excerpt"),
                    )
                    for evidence_item in configured_criterion["material_evidence"]
                    if isinstance(evidence_item, dict)
                }
                cited_material = {
                    (record[1], record[2], record[3])
                    for ref in refs
                    if (record := evidence_records.get(ref)) is not None
                    and record[0] == "material"
                }
                if not expected_material.intersection(cited_material):
                    errors.append(
                        f"{path} must cite the locked criterion's exact material evidence"
                    )
        if not diagnostic_default:
            validate_external_rubric_refs(
                refs,
                dimension_id,
                case_dimensions,
                evidence_sources,
                evidence_source_ids,
                path,
                errors,
            )
        if finding_type == "credit":
            if "answer" not in sources:
                errors.append(f"{path} credit requires answer evidence")
            if (
                diagnostic_default
                and isinstance(dimension_id, str)
                and dimension_id in SHORT_CONTENT_DIMENSIONS
                and "material" not in sources
            ):
                errors.append(f"{path} short-content credit requires material evidence")
        elif judgment == "missing":
            if not sources.intersection({"prompt", "material", "rubric"}):
                errors.append(f"{path} missing judgment requires scoring-basis evidence")
        elif judgment in ("unsupported", "misdirected"):
            if "answer" not in sources or not sources.intersection(
                {"prompt", "material", "rubric"}
            ):
                errors.append(f"{path} requires answer and scoring-basis evidence")
        elif judgment == "duplicate" and "answer" not in sources:
            errors.append(f"{path} duplicate requires answer evidence")
        elif judgment == "uncertain" and "answer" not in sources:
            errors.append(f"{path} uncertain judgment requires answer evidence")

    for criterion_id in sorted(set(locked_criteria) - matched_locked_criteria):
        errors.append(f"locked criterion {criterion_id} needs exactly one scored finding")

    if not diagnostic_default:
        cited_rubric_entries = {
            evidence_source_ids.get(ref)
            for ref in used_evidence_refs
            if evidence_sources.get(ref) == "rubric"
        }
        case_rubric_entries = {
            item["id"]
            for item in case["rubric_entries"]
            if isinstance(item, dict) and is_nonempty_string(item.get("id"))
        }
        for entry_id in sorted(case_rubric_entries - cited_rubric_entries):
            errors.append(f"rubric entry {entry_id} must be cited in the report")

    if diagnostic_default and case["question_type"] == "essay" and mode == "full":
        for dimension_id in sorted(dimension_ids - finding_dimensions):
            errors.append(f"essay dimension {dimension_id} requires a supporting finding")

    if diagnostic_default:
        question_type = case["question_type"]
        for dimension_id, item in dimension_by_id.items():
            if question_type != "essay" and dimension_id in SHORT_CONTENT_DIMENSIONS:
                totals = unit_totals[dimension_id]
                maximum_units = totals["max"]
                awarded_units = totals["awarded"]
                if maximum_units <= 0:
                    if item.get("qualitative_level") != "unassessable":
                        errors.append(
                            f"dimension {dimension_id} requires a complete scored criterion map"
                        )
                else:
                    expected_level = default_level_for_ratio(
                        awarded_units / maximum_units
                    )
                    if item.get("qualitative_level") != expected_level:
                        errors.append(
                            f"dimension {dimension_id} qualitative level does not match scoring_units"
                        )
                    if mode == "full" and is_number(item.get("max_score")) and is_number(
                        item.get("score")
                    ):
                        expected_score = round_half_up(
                            item["max_score"] * awarded_units / maximum_units
                        )
                        expected_score = min(expected_score, item["max_score"])
                        if not close(item["score"], expected_score):
                            errors.append(
                                f"dimension {dimension_id} score does not match scoring_units"
                            )
            elif mode == "full" and is_number(item.get("max_score")) and is_number(
                item.get("score")
            ):
                level = item.get("qualitative_level")
                if isinstance(level, str) and level in LEVEL_CENTERS:
                    expected_score = round_half_up(
                        item["max_score"] * LEVEL_CENTERS[level]
                    )
                    expected_score = min(expected_score, item["max_score"])
                    if not close(item["score"], expected_score):
                        errors.append(
                            f"dimension {dimension_id} score does not match qualitative level center"
                        )

        if mode == "full":
            center_score = (
                sum(dimension_scores)
                if len(dimension_scores) == len(dimensions)
                else None
            )
            expected_range = expected_default_score_range(
                case,
                dimension_by_id,
                unit_totals,
                center_score,
            )
            if expected_range is not None and isinstance(score_range, dict):
                actual_min = score_range.get("min")
                actual_max = score_range.get("max")
                if (
                    is_number(actual_min)
                    and is_number(actual_max)
                    and (
                        not close(actual_min, expected_range["min"])
                        or not close(actual_max, expected_range["max"])
                    )
                ):
                    errors.append("score_range does not match default evidence bounds")
    elif mode == "full":
        expected_range = expected_external_score_range(
            case,
            dimension_by_id,
            case_dimensions,
        )
        if expected_range is not None and isinstance(score_range, dict):
            actual_min = score_range.get("min")
            actual_max = score_range.get("max")
            if (
                is_number(actual_min)
                and is_number(actual_max)
                and (
                    not close(actual_min, expected_range["min"])
                    or not close(actual_max, expected_range["max"])
                )
            ):
                errors.append("score_range does not match external rubric level bands")

    fixes = report.get("priority_fixes")
    if not isinstance(fixes, list):
        errors.append("priority_fixes must be an array")
    elif len(fixes) > 5:
        errors.append("priority_fixes must contain at most five items")
    elif any(not is_nonempty_string(item) for item in fixes):
        errors.append("priority_fixes entries must be non-empty strings")

    confidence = report.get("confidence")
    if not isinstance(confidence, dict):
        errors.append("confidence must be an object")
    else:
        validate_exact_keys(confidence, {"level", "reasons"}, "confidence", errors)
        level = confidence.get("level")
        if not is_enum_value(level, VALID_CONFIDENCE_LEVELS):
            errors.append("confidence.level must be low, medium, or high")
        reasons = confidence.get("reasons")
        if not isinstance(reasons, list) or not reasons:
            errors.append("confidence.reasons must be a non-empty array")
        elif any(not is_nonempty_string(reason) for reason in reasons):
            errors.append("confidence.reasons entries must be non-empty strings")
        if level == "high" and (
            mode != "full" or case["rubric_source"] != "verified_official"
        ):
            errors.append(
                "high confidence requires full mode and a verified official rubric"
            )
        uncertain_limited = mode == "limited" and (
            bool(case["missing_inputs"])
            or case["mode_reason"] == "rule_ambiguity"
            or bool(unbound_external_rubric_entries(case))
        )
        if uncertain_limited and level != "low":
            errors.append(
                "limited mode with missing or ambiguous inputs requires low confidence"
            )

    authored_texts = [
        ("disclaimer", report.get("disclaimer")),
        ("overall_assessment", report.get("overall_assessment")),
    ]
    authored_texts.extend(
        (f"dimensions[{index}].reason", item.get("reason"))
        for index, item in enumerate(dimensions)
        if isinstance(item, dict)
    )
    if mode == "limited":
        authored_texts.extend(
            (f"dimensions[{index}].{field}", item.get(field))
            for index, item in enumerate(dimensions)
            if isinstance(item, dict)
            for field in ("name", "qualitative_level")
        )
    authored_texts.extend(
        (f"findings[{index}].{field}", item.get(field))
        for index, item in enumerate(findings)
        if isinstance(item, dict)
        for field in ("counting_key", "explanation")
    )
    authored_texts.extend(
        (f"checks[{index}].reason", item.get("reason"))
        for index, item in enumerate(checks)
        if isinstance(item, dict)
    )
    if isinstance(fixes, list):
        authored_texts.extend(
            (f"priority_fixes[{index}]", item)
            for index, item in enumerate(fixes)
        )
    if isinstance(confidence, dict) and isinstance(confidence.get("reasons"), list):
        authored_texts.extend(
            (f"confidence.reasons[{index}]", item)
            for index, item in enumerate(confidence["reasons"])
        )
    for path, value in authored_texts:
        if contains_numeric_score_language(value):
            errors.append(f"{path} must not state a numeric score outside the numeric ledger")

    return errors


def main(argv=None):
    parser = argparse.ArgumentParser(description="Validate a Shenlun grading report.")
    parser.add_argument("case")
    parser.add_argument("report")
    args = parser.parse_args(argv)
    try:
        case = load_json(args.case)
        report = load_json(args.report)
    except (OSError, UnicodeError, ValueError, OverflowError, RecursionError) as error:
        print("grading_report=fail", file=sys.stderr)
        print(f"- cannot read JSON: {error}", file=sys.stderr)
        return 1

    errors = validate_report(case, report)
    if errors:
        print("grading_report=fail", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("grading_report=pass")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
