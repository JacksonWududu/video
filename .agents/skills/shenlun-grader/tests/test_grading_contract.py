#!/usr/bin/env python3

import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SKILL = Path(__file__).resolve().parents[1]
SCRIPTS = SKILL / "scripts"
sys.path.insert(0, str(SCRIPTS))

from validate_case import (
    detected_prompt_requirements,
    expected_criteria_lock,
    expected_requirements_lock,
    looks_non_additive_rule,
    validate_case,
)
from validate_report import allocate_default_maxima, validate_report


PROMPT = "请概括基层治理应采取的措施。"
ANSWER = "基层干部应耐心服务群众，并完善沟通机制。"
MATERIAL = "基层治理需要耐心服务群众，建立顺畅的沟通机制，并定期公开问题处理进展。"


def evidence(item_id, source, source_id, text):
    return {
        "id": item_id,
        "source": source,
        "source_id": source_id,
        "locator": f"chars:0-{len(text)}",
        "excerpt": text,
    }


def excerpt_evidence(item_id, source, source_id, source_text, excerpt):
    start = source_text.index(excerpt)
    return {
        "id": item_id,
        "source": source,
        "source_id": source_id,
        "locator": f"chars:{start}-{start + len(excerpt)}",
        "excerpt": excerpt,
    }


def prompt_requirement(item_id, subject, prompt, excerpt):
    start = prompt.index(excerpt)
    return {
        "id": item_id,
        "subject": subject,
        "locator": f"chars:{start}-{start + len(excerpt)}",
        "excerpt": excerpt,
    }


def criterion(item_id, counting_key, expected_meaning, excerpt):
    start = MATERIAL.index(excerpt)
    return {
        "id": item_id,
        "dimension_id": "content_points",
        "counting_key": counting_key,
        "expected_meaning": expected_meaning,
        "material_evidence": [
            {
                "source_id": "M1",
                "locator": f"chars:{start}-{start + len(excerpt)}",
                "excerpt": excerpt,
            }
        ],
    }


def finding(
    item_id,
    finding_type,
    judgment,
    criterion_id,
    counting_key,
    evidence_refs,
    explanation,
    scoring_units,
    dimension_id="content_points",
):
    return {
        "id": item_id,
        "type": finding_type,
        "criterion_id": criterion_id,
        "counting_key": counting_key,
        "dimension_id": dimension_id,
        "judgment": judgment,
        "scoring_units": scoring_units,
        "evidence_refs": evidence_refs,
        "explanation": explanation,
    }


def full_case():
    case = {
        "schema_version": "shenlun-grading-case-v1",
        "question_id": "Q1",
        "question_type": "summary",
        "grading_mode": "full",
        "mode_reason": "complete_input",
        "missing_inputs": [],
        "prompt": PROMPT,
        "prompt_requirements": [],
        "requirements_lock": None,
        "answer": ANSWER,
        "materials": [{"id": "M1", "text": MATERIAL}],
        "materials_complete": True,
        "max_score": 20,
        "rubric_version": "diagnostic-short-v1",
        "rubric_source": "diagnostic_default",
        "rubric_entries": [],
        "rubric_dimensions": [],
        "criteria": [
            criterion("C1", "C1:耐心服务群众", "耐心服务群众", "耐心服务群众"),
            criterion("C2", "C2:建立沟通机制", "建立顺畅的沟通机制", "建立顺畅的沟通机制"),
            criterion("C3", "C3:公开处理进展", "定期公开问题处理进展", "定期公开问题处理进展"),
        ],
        "criteria_lock": None,
    }
    case["requirements_lock"] = expected_requirements_lock(case)
    case["criteria_lock"] = expected_criteria_lock(case)
    return case


def full_report():
    return {
        "schema_version": "shenlun-grading-report-v1",
        "question_id": "Q1",
        "grading_mode": "full",
        "rubric_version": "diagnostic-short-v1",
        "rubric_source": "diagnostic_default",
        "disclaimer": "非官方训练估分",
        "overall_assessment": "任务方向正确，三项材料要点命中两项。",
        "estimated_score": 13.5,
        "score_range": {"min": 12.5, "max": 14.5},
        "dimensions": [
            {
                "id": "task_fit",
                "name": "任务契合",
                "max_score": 2,
                "score": 2,
                "qualitative_level": "strong",
                "reason": "答案围绕题干所问措施作答。",
                "evidence_refs": ["E1", "E5"],
            },
            {
                "id": "content_points",
                "name": "内容要点",
                "max_score": 13,
                "score": 8.5,
                "qualitative_level": "developing",
                "reason": "三个锁定要点命中两个。",
                "evidence_refs": ["E1", "E2", "E3", "E4"],
            },
            {
                "id": "organization",
                "name": "组织",
                "max_score": 3,
                "score": 1.5,
                "qualitative_level": "developing",
                "reason": "两项措施并列清楚，但未形成完整分类。",
                "evidence_refs": ["E1"],
            },
            {
                "id": "expression",
                "name": "表达",
                "max_score": 2,
                "score": 1.5,
                "qualitative_level": "adequate",
                "reason": "表述简洁通顺，语义可辨。",
                "evidence_refs": ["E1"],
            },
        ],
        "evidence": [
            evidence("E1", "answer", "answer", ANSWER),
            excerpt_evidence("E2", "material", "M1", MATERIAL, "耐心服务群众"),
            excerpt_evidence("E3", "material", "M1", MATERIAL, "建立顺畅的沟通机制"),
            excerpt_evidence("E4", "material", "M1", MATERIAL, "定期公开问题处理进展"),
            evidence("E5", "prompt", "prompt", PROMPT),
        ],
        "findings": [
            finding(
                "F1",
                "credit",
                "full",
                "C1",
                "C1:耐心服务群众",
                ["E1", "E2"],
                "答出了耐心服务群众。",
                {"max": 1, "awarded": 1},
            ),
            finding(
                "F2",
                "credit",
                "full",
                "C2",
                "C2:建立沟通机制",
                ["E1", "E3"],
                "答出了建立沟通机制。",
                {"max": 1, "awarded": 1},
            ),
            finding(
                "F3",
                "omission",
                "missing",
                "C3",
                "C3:公开处理进展",
                ["E4"],
                "未涉及定期公开问题处理进展。",
                {"max": 1, "awarded": 0},
            ),
        ],
        "checks": [],
        "priority_fixes": ["补入“定期公开问题处理进展”这一独立措施。"],
        "confidence": {
            "level": "medium",
            "reasons": ["输入完整，但采用非官方训练量表。"],
        },
    }


def limited_case():
    case = full_case()
    case.update(
        {
            "question_type": "unknown",
            "grading_mode": "limited",
            "mode_reason": "missing_input",
            "missing_inputs": ["prompt", "materials", "max_score"],
            "prompt": None,
            "prompt_requirements": [],
            "requirements_lock": None,
            "materials": [],
            "materials_complete": False,
            "max_score": None,
            "rubric_version": "qualitative-only-v1",
            "criteria": [],
            "criteria_lock": None,
        }
    )
    return case


def limited_report():
    return {
        "schema_version": "shenlun-grading-report-v1",
        "question_id": "Q1",
        "grading_mode": "limited",
        "rubric_version": "qualitative-only-v1",
        "rubric_source": "diagnostic_default",
        "disclaimer": "非官方定性诊断",
        "overall_assessment": "仅能判断语言可读性，不能判断任务与采点。",
        "estimated_score": None,
        "score_range": None,
        "dimensions": [
            {
                "id": "expression",
                "name": "表达",
                "max_score": None,
                "score": None,
                "qualitative_level": "adequate",
                "reason": "现有答案语句可读，但无法核对任务。",
                "evidence_refs": ["E1"],
            }
        ],
        "evidence": [evidence("E1", "answer", "answer", ANSWER)],
        "findings": [
            finding(
                "F1",
                "flag",
                "uncertain",
                "C1",
                "C1:缺少题干材料",
                ["E1"],
                "缺少题干与材料，无法核验采点覆盖。",
                None,
                dimension_id="expression",
            )
        ],
        "checks": [],
        "priority_fixes": ["补充题干和全部给定材料后重新批改。"],
        "confidence": {"level": "low", "reasons": ["题干与材料缺失。"]},
    }


def materials_missing_case():
    case = full_case()
    case.update(
        {
            "grading_mode": "limited",
            "mode_reason": "missing_input",
            "missing_inputs": ["materials"],
            "materials": [],
            "materials_complete": False,
            "criteria": [],
            "criteria_lock": None,
        }
    )
    return case


def materials_missing_report():
    return {
        "schema_version": "shenlun-grading-report-v1",
        "question_id": "Q1",
        "grading_mode": "limited",
        "rubric_version": "diagnostic-short-v1",
        "rubric_source": "diagnostic_default",
        "disclaimer": "非官方定性诊断",
        "overall_assessment": "缺少材料，内容覆盖不可评。",
        "estimated_score": None,
        "score_range": None,
        "dimensions": [
            {
                "id": "task_fit",
                "name": "任务契合",
                "max_score": None,
                "score": None,
                "qualitative_level": "adequate",
                "reason": "答案围绕现有题干中的措施任务作答。",
                "evidence_refs": ["E1", "E2"],
            },
            {
                "id": "content_points",
                "name": "内容要点",
                "max_score": None,
                "score": None,
                "qualitative_level": "unassessable",
                "reason": "材料缺失，无法建立完整采点表。",
                "evidence_refs": ["E1"],
            },
            {
                "id": "organization",
                "name": "组织",
                "max_score": None,
                "score": None,
                "qualitative_level": "developing",
                "reason": "并列关系可辨，但分类不足。",
                "evidence_refs": ["E1"],
            },
            {
                "id": "expression",
                "name": "表达",
                "max_score": None,
                "score": None,
                "qualitative_level": "adequate",
                "reason": "文字简洁通顺。",
                "evidence_refs": ["E1"],
            },
        ],
        "evidence": [
            evidence("E1", "answer", "answer", ANSWER),
            evidence("E2", "prompt", "prompt", PROMPT),
        ],
        "findings": [
            finding(
                "F1",
                "flag",
                "uncertain",
                "C1",
                "C1:材料缺失",
                ["E1"],
                "没有材料，无法建立内容评分点。",
                None,
            )
        ],
        "checks": [],
        "priority_fixes": ["补充全部给定材料。"],
        "confidence": {"level": "low", "reasons": ["材料缺失。"]},
    }


def official_case():
    case = full_case()
    case.update(
        {
            "rubric_version": "official-example-v1",
            "rubric_source": "verified_official",
            "rubric_entries": [
                {
                    "id": "R1",
                    "rule_type": "dimension_band",
                    "text": "内容满分14分，以0.5分计；一般0至8.5分，较好9至14分。",
                    "source_title": "示例正式评分细则",
                    "source_url": "https://example.gov.cn/rubric",
                    "retrieved_on": "2026-09-02",
                },
                {
                    "id": "R2",
                    "rule_type": "dimension_band",
                    "text": "组织表达满分6分，以0.5分计；一般0至4分，较好4.5至6分。",
                    "source_title": "示例正式评分细则",
                    "source_url": "https://example.gov.cn/rubric",
                    "retrieved_on": "2026-09-02",
                },
            ],
            "rubric_dimensions": [
                {
                    "id": "official_content",
                    "name": "内容",
                    "max_score": 14,
                    "rubric_entry_ids": ["R1"],
                    "scoring_method": "level_band",
                    "score_increment": 0.5,
                    "level_bands": [
                        {"name": "一般", "min_score": 0, "max_score": 8.5},
                        {"name": "较好", "min_score": 9, "max_score": 14},
                    ],
                },
                {
                    "id": "official_form",
                    "name": "组织表达",
                    "max_score": 6,
                    "rubric_entry_ids": ["R2"],
                    "scoring_method": "level_band",
                    "score_increment": 0.5,
                    "level_bands": [
                        {"name": "一般", "min_score": 0, "max_score": 4},
                        {"name": "较好", "min_score": 4.5, "max_score": 6},
                    ],
                },
            ],
            "criteria": [],
            "criteria_lock": None,
        }
    )
    return case


def official_report():
    case = official_case()
    rule_one = case["rubric_entries"][0]["text"]
    rule_two = case["rubric_entries"][1]["text"]
    return {
        "schema_version": "shenlun-grading-report-v1",
        "question_id": "Q1",
        "grading_mode": "full",
        "rubric_version": "official-example-v1",
        "rubric_source": "verified_official",
        "disclaimer": "非官方模拟评分",
        "overall_assessment": "主要内容成立，组织表达一般。",
        "estimated_score": 14,
        "score_range": {"min": 9, "max": 18},
        "dimensions": [
            {
                "id": "official_content",
                "name": "内容",
                "max_score": 14,
                "score": 10,
                "qualitative_level": "较好",
                "reason": "答案命中主要措施，但覆盖尚不完整。",
                "evidence_refs": ["E1", "E2", "E4", "E5"],
            },
            {
                "id": "official_form",
                "name": "组织表达",
                "max_score": 6,
                "score": 4,
                "qualitative_level": "一般",
                "reason": "表达清楚，组织层次仍可加强。",
                "evidence_refs": ["E1", "E3", "E4", "E5"],
            },
        ],
        "evidence": [
            evidence("E1", "answer", "answer", ANSWER),
            evidence("E2", "rubric", "R1", rule_one),
            evidence("E3", "rubric", "R2", rule_two),
            evidence("E4", "material", "M1", MATERIAL),
            evidence("E5", "prompt", "prompt", PROMPT),
        ],
        "findings": [
            finding(
                "F1",
                "credit",
                "full",
                "R1-C1",
                "R1-C1:主要措施",
                ["E1", "E2"],
                "答案写出两项主要措施。",
                None,
                dimension_id="official_content",
            )
        ],
        "checks": [],
        "priority_fixes": ["补足尚未概括的独立措施。"],
        "confidence": {"level": "high", "reasons": ["正式评分细则已核验。"]},
    }


def essay_case():
    case = full_case()
    prompt = "围绕基层治理写一篇文章。"
    case.update(
        {
            "question_id": "Q2",
            "question_type": "essay",
            "prompt": prompt,
            "prompt_requirements": [
                prompt_requirement("P1", "genre", prompt, "写一篇文章")
            ],
            "requirements_lock": None,
            "answer": (
                "让基层治理既有温度又有尺度。基层治理连接千家万户，既要以耐心回应群众，"
                "也要以制度提升效能。材料中的服务、沟通和公开，正说明温度与尺度不可偏废。"
                "首先，干部耐心倾听，才能识别群众真正的急难愁盼，使治理从管理事务转向解决问题。"
                "其次，建立顺畅的沟通机制，可以让意见及时进入决策和办理流程，减少信息梗阻。"
                "再次，定期公开处理进展，以透明倒逼责任落实，也让群众形成稳定预期。"
                "因此，基层治理应把服务态度、沟通机制和公开监督贯通起来，在有温度的互动中形成"
                "有尺度的制度，让每一项治理措施真正落到群众生活之中。"
            ),
            "max_score": 40,
            "rubric_version": "diagnostic-essay-v1",
            "criteria": [],
            "criteria_lock": None,
        }
    )
    case["requirements_lock"] = expected_requirements_lock(case)
    return case


def essay_report():
    case = essay_case()
    answer = case["answer"]
    prompt = case["prompt"]
    return {
        "schema_version": "shenlun-grading-report-v1",
        "question_id": "Q2",
        "grading_mode": "full",
        "rubric_version": "diagnostic-essay-v1",
        "rubric_source": "diagnostic_default",
        "disclaimer": "非官方训练估分",
        "overall_assessment": "立意明确、结构完整，论证和材料转化仍偏简略。",
        "estimated_score": 27,
        "score_range": {"min": 23, "max": 31},
        "dimensions": [
            {
                "id": "thesis_alignment",
                "name": "立意",
                "max_score": 10,
                "score": 8,
                "qualitative_level": "adequate",
                "reason": "中心论点同时回应服务温度与治理制度。",
                "evidence_refs": ["E1", "E2", "E3"],
            },
            {
                "id": "argumentation",
                "name": "论证",
                "max_score": 12,
                "score": 7,
                "qualitative_level": "developing",
                "reason": "三个分论点支持中心，但推理层次较短。",
                "evidence_refs": ["E1", "E2"],
            },
            {
                "id": "material_transformation",
                "name": "材料转化",
                "max_score": 8,
                "score": 4.5,
                "qualitative_level": "developing",
                "reason": "能转化材料三项措施，但拓展深度有限。",
                "evidence_refs": ["E1", "E2"],
            },
            {
                "id": "structure",
                "name": "结构",
                "max_score": 6,
                "score": 4.5,
                "qualitative_level": "adequate",
                "reason": "开篇立论、分层展开、结尾收束较完整。",
                "evidence_refs": ["E1"],
            },
            {
                "id": "language",
                "name": "语言",
                "max_score": 4,
                "score": 3,
                "qualitative_level": "adequate",
                "reason": "语言通顺得体，但表达变化不多。",
                "evidence_refs": ["E1"],
            },
        ],
        "evidence": [
            evidence("E1", "answer", "answer", answer),
            evidence("E2", "material", "M1", MATERIAL),
            evidence("E3", "prompt", "prompt", prompt),
            excerpt_evidence("E4", "prompt", "prompt", prompt, "写一篇文章"),
        ],
        "findings": [
            finding(
                "F1",
                "credit",
                "full",
                "C1",
                "C1:基层治理服务群众",
                ["E1", "E2", "E3"],
                "中心方向回应题干与材料。",
                None,
                dimension_id="thesis_alignment",
            ),
            finding(
                "F2",
                "credit",
                "partial",
                "C2",
                "C2:分论点支持中心",
                ["E1", "E2"],
                "分论点与中心相关，但论据到结论的解释较短。",
                None,
                dimension_id="argumentation",
            ),
            finding(
                "F3",
                "credit",
                "partial",
                "C3",
                "C3:材料转化",
                ["E1", "E2"],
                "把三项材料措施转为论述框架，深化不足。",
                None,
                dimension_id="material_transformation",
            ),
            finding(
                "F4",
                "credit",
                "full",
                "C4",
                "C4:结构闭合",
                ["E1"],
                "文章具备开头、三个主体层次和结尾。",
                None,
                dimension_id="structure",
            ),
            finding(
                "F5",
                "credit",
                "full",
                "C5",
                "C5:语言可读",
                ["E1"],
                "句意连贯，语体符合议论表达。",
                None,
                dimension_id="language",
            ),
        ],
        "checks": [
            {
                "id": "K1",
                "kind": "requirement",
                "subject": "genre",
                "status": "satisfied",
                "rule_entry_id": None,
                "requirement": "写一篇文章",
                "reason": "答案采用完整议论文章形态。",
                "score_effect": None,
                "evidence_refs": ["E1", "E4"],
            }
        ],
        "priority_fixes": ["补出论据为何支持中心论点的推理链。"],
        "confidence": {
            "level": "medium",
            "reasons": ["输入完整，但采用非官方训练量表。"],
        },
    }


class GradingContractTests(unittest.TestCase):
    def assert_report_error(self, case, report, fragment):
        errors = validate_report(case, report)
        self.assertTrue(any(fragment in error for error in errors), (fragment, errors))

    def test_valid_default_full_and_limited(self):
        self.assertEqual(validate_case(full_case()), [])
        self.assertEqual(validate_report(full_case(), full_report()), [])
        self.assertEqual(validate_case(limited_case()), [])
        self.assertEqual(validate_report(limited_case(), limited_report()), [])

    def test_documented_case_example_validates(self):
        contract = (SKILL / "references" / "report-contract.md").read_text(
            encoding="utf-8"
        )
        case_block = contract.split("```json", 1)[1].split("```", 1)[0]
        self.assertEqual(validate_case(json.loads(case_block)), [])

    def test_full_requires_complete_inputs(self):
        case = full_case()
        case.update({"prompt": None, "materials_complete": False, "max_score": None})
        errors = validate_case(case)
        self.assertTrue(
            any("requires prompt, complete materials" in error for error in errors)
        )

    def test_limited_declares_exact_missing_inputs_and_reason(self):
        case = limited_case()
        case["missing_inputs"] = []
        errors = validate_case(case)
        self.assertTrue(any("must include prompt" in error for error in errors))
        self.assertTrue(any("must include materials" in error for error in errors))

        case = full_case()
        case.update(
            {
                "grading_mode": "limited",
                "mode_reason": "missing_input",
                "missing_inputs": ["prompt"],
            }
        )
        self.assertTrue(
            any("falsely declares" in error for error in validate_case(case))
        )

        case = full_case()
        case.update(
            {
                "grading_mode": "limited",
                "mode_reason": "missing_input",
                "missing_inputs": ["materials"],
                "materials_complete": False,
            }
        )
        self.assertTrue(
            any("materials_incomplete" in error for error in validate_case(case))
        )

    def test_default_rubric_is_bound_to_question_type(self):
        case = full_case()
        case["question_type"] = "essay"
        self.assertTrue(
            any("diagnostic-essay-v1" in error for error in validate_case(case))
        )

        report = full_report()
        report["dimensions"] = [
            {
                "id": "invented",
                "name": "自创维度",
                "max_score": 20,
                "score": 13.5,
                "qualitative_level": "adequate",
                "reason": "用于验证非法自创维度。",
                "evidence_refs": ["E1"],
            }
        ]
        self.assert_report_error(full_case(), report, "dimensions do not match")

        report = limited_report()
        report["dimensions"][0]["id"] = "invented"
        self.assert_report_error(limited_case(), report, "dimensions do not match")

    def test_default_weights_names_and_totals_are_checked(self):
        report = full_report()
        report["dimensions"][1]["max_score"] = 12.5
        report["dimensions"][2]["max_score"] = 3.5
        self.assert_report_error(full_case(), report, "does not match default weight")

        report = full_report()
        report["dimensions"][0]["name"] = "自创任务项"
        self.assert_report_error(full_case(), report, "name does not match")

        report = full_report()
        report["dimensions"][0]["score"] = 1.5
        self.assert_report_error(full_case(), report, "dimension scores must sum")

    def test_short_content_score_is_derived_from_complete_criterion_map(self):
        report = full_report()
        report["dimensions"][1]["score"] = 9
        report["estimated_score"] = 14
        self.assert_report_error(full_case(), report, "does not match scoring_units")

        report = full_report()
        report["findings"].pop()
        self.assert_report_error(full_case(), report, "does not match scoring_units")

        report = full_report()
        report["findings"][1]["criterion_id"] = "C1"
        self.assert_report_error(full_case(), report, "repeats a scored criterion")

    def test_locked_criteria_cannot_be_changed_or_omitted_from_report(self):
        case = full_case()
        case["criteria"][2]["expected_meaning"] = "改写后的标准"
        self.assertTrue(
            any("criteria_lock does not match" in error for error in validate_case(case))
        )

        case = full_case()
        case["max_score"] = 15
        self.assertTrue(
            any("criteria_lock does not match" in error for error in validate_case(case))
        )

        report = full_report()
        report["findings"].pop()
        report["dimensions"][1].update(
            {"score": 13, "qualitative_level": "strong"}
        )
        report["estimated_score"] = 18
        self.assert_report_error(full_case(), report, "locked criterion C3")

    def test_scored_criterion_must_cite_its_exact_locked_material(self):
        report = full_report()
        report["findings"][2]["evidence_refs"] = ["E2"]
        self.assert_report_error(full_case(), report, "exact material evidence")

    def test_prompt_requirement_lock_excludes_answer_and_binds_prompt_basis(self):
        case = essay_case()
        locked = case["requirements_lock"]
        case["answer"] = "替换后的考生答案。"
        self.assertEqual(expected_requirements_lock(case), locked)

        case = essay_case()
        case["prompt_requirements"][0]["subject"] = "title"
        self.assertTrue(
            any("requirements_lock does not match" in error for error in validate_case(case))
        )

        case = essay_case()
        case["prompt"] += "限1000字以内。"
        self.assertTrue(
            any("requirements_lock does not match" in error for error in validate_case(case))
        )

    def test_common_fifteen_point_scale_has_a_valid_half_point_allocation(self):
        case = full_case()
        case["max_score"] = 15
        case["criteria_lock"] = expected_criteria_lock(case)
        case["answer"] = "耐心服务群众，建立顺畅的沟通机制，定期公开问题处理进展。"
        report = full_report()
        report["evidence"][0] = evidence("E1", "answer", "answer", case["answer"])
        report["findings"][2].update(
            {
                "type": "credit",
                "judgment": "full",
                "scoring_units": {"max": 1, "awarded": 1},
                "evidence_refs": ["E1", "E4"],
                "explanation": "答出了公开处理进展。",
            }
        )
        maxima = [1.5, 10, 2, 1.5]
        scores = [1.5, 10, 1.5, 1]
        levels = ["strong", "strong", "adequate", "adequate"]
        for dimension, maximum, score, level in zip(
            report["dimensions"], maxima, scores, levels
        ):
            dimension["max_score"] = maximum
            dimension["score"] = score
            dimension["qualitative_level"] = level
        report["estimated_score"] = 14
        report["score_range"] = {"min": 13, "max": 14.5}
        self.assertEqual(validate_case(case), [])
        self.assertEqual(validate_report(case, report), [])

        self.assertEqual(
            allocate_default_maxima(25, "implementation"),
            {
                "genre_task_fit": 6.5,
                "content_points": 13.5,
                "organization": 2.5,
                "expression": 2.5,
            },
        )

    def test_uncertain_criterion_mechanically_expands_default_range(self):
        case = full_case()
        case["answer"] = "基层干部应耐心服务群众，建立顺畅的沟通机制，并适时公开。"
        report = full_report()
        report["evidence"][0] = evidence("E1", "answer", "answer", case["answer"])
        report["findings"][2].update(
            {
                "type": "flag",
                "judgment": "uncertain",
                "scoring_units": {"max": 1, "awarded": 0.5},
                "evidence_refs": ["E1", "E4"],
                "explanation": "“适时公开”是否包含定期公开问题处理进展，表意不够明确。",
            }
        )
        report["dimensions"][1].update(
            {"score": 11, "qualitative_level": "adequate"}
        )
        report["estimated_score"] = 16
        report["score_range"] = {"min": 13, "max": 19}
        self.assertEqual(validate_report(case, report), [])

        report["score_range"] = {"min": 14, "max": 18}
        self.assert_report_error(
            case, report, "does not match default evidence bounds"
        )

        report = full_report()
        report["findings"][2].update(
            {
                "type": "flag",
                "judgment": "uncertain",
                "scoring_units": {"max": 1, "awarded": 0.5},
            }
        )
        report["dimensions"][1].update(
            {"score": 11, "qualitative_level": "adequate"}
        )
        report["estimated_score"] = 16
        report["score_range"] = {"min": 13, "max": 19}
        self.assert_report_error(
            full_case(), report, "uncertain judgment requires answer evidence"
        )

    def test_default_range_includes_center_after_dimension_rounding(self):
        case = full_case()
        case["max_score"] = 10
        case["criteria_lock"] = expected_criteria_lock(case)
        report = full_report()
        report["findings"][1].update(
            {
                "judgment": "partial",
                "scoring_units": {"max": 1, "awarded": 0.5},
                "explanation": "提到沟通机制，但没有概括顺畅这一要求。",
            }
        )
        maxima = [1, 6.5, 1.5, 1]
        scores = [1, 3.5, 1.5, 1]
        levels = ["adequate", "developing", "strong", "adequate"]
        for dimension, maximum, score, level in zip(
            report["dimensions"], maxima, scores, levels
        ):
            dimension["max_score"] = maximum
            dimension["score"] = score
            dimension["qualitative_level"] = level
        report["estimated_score"] = 7
        report["score_range"] = {"min": 5.5, "max": 7}
        self.assertEqual(validate_case(case), [])
        self.assertEqual(validate_report(case, report), [])

    def test_default_noncontent_and_essay_scores_use_level_centers(self):
        report = full_report()
        report["dimensions"][2]["score"] = 2
        report["estimated_score"] = 14
        self.assert_report_error(full_case(), report, "qualitative level center")

        self.assertEqual(validate_case(essay_case()), [])
        self.assertEqual(validate_report(essay_case(), essay_report()), [])
        report = essay_report()
        report["dimensions"][3]["score"] = 4
        report["estimated_score"] = 30
        self.assert_report_error(essay_case(), report, "qualitative level center")

        report = essay_report()
        report["findings"].pop()
        self.assert_report_error(essay_case(), report, "essay dimension language")

    def test_default_precision_and_interval_width_are_checked(self):
        case = full_case()
        case["max_score"] = 15.25
        self.assertTrue(any("max_score must use 0.5" in error for error in validate_case(case)))

        report = full_report()
        report["estimated_score"] = 13.2
        self.assert_report_error(full_case(), report, "0.5-point precision")

        report = full_report()
        report["score_range"] = {"min": 13, "max": 14}
        self.assert_report_error(full_case(), report, "score_range is too narrow")

    def test_limited_forbids_numeric_scores(self):
        report = limited_report()
        report["estimated_score"] = 1
        report["score_range"] = {"min": 0, "max": 2}
        report["dimensions"][0]["score"] = 1
        report["dimensions"][0]["max_score"] = 2
        errors = validate_report(limited_case(), report)
        for fragment in (
            "estimated_score must be null",
            "score_range must be null",
            ".score must be null",
            ".max_score must be null",
        ):
            self.assertTrue(
                any(fragment in error for error in errors), (fragment, errors)
            )

    def test_missing_materials_force_content_unassessable(self):
        case = materials_missing_case()
        report = materials_missing_report()
        self.assertEqual(validate_case(case), [])
        self.assertEqual(validate_report(case, report), [])

        report["dimensions"][1]["qualitative_level"] = "strong"
        self.assert_report_error(case, report, "must be unassessable")

    def test_limited_with_only_missing_max_score_still_derives_content_level(self):
        case = full_case()
        case.update(
            {
                "grading_mode": "limited",
                "mode_reason": "missing_input",
                "missing_inputs": ["max_score"],
                "max_score": None,
            }
        )
        case["criteria_lock"] = expected_criteria_lock(case)
        report = full_report()
        report.update(
            {
                "grading_mode": "limited",
                "estimated_score": None,
                "score_range": None,
                "confidence": {"level": "low", "reasons": ["题目满分缺失。"]},
            }
        )
        for dimension in report["dimensions"]:
            dimension["max_score"] = None
            dimension["score"] = None
        self.assertEqual(validate_case(case), [])
        self.assertEqual(validate_report(case, report), [])

        report["dimensions"][1]["qualitative_level"] = "strong"
        self.assert_report_error(case, report, "does not match scoring_units")

    def test_default_rule_ambiguity_does_not_force_a_fake_criterion_map(self):
        case = full_case()
        case.update(
            {
                "grading_mode": "limited",
                "mode_reason": "rule_ambiguity",
                "criteria": [],
                "criteria_lock": None,
            }
        )
        report = full_report()
        report.update(
            {
                "grading_mode": "limited",
                "estimated_score": None,
                "score_range": None,
                "overall_assessment": "材料要点存在无法消除的聚合歧义，只作定性诊断。",
                "confidence": {"level": "low", "reasons": ["评分点分母无法可靠锁定。"]},
            }
        )
        for dimension in report["dimensions"]:
            dimension["max_score"] = None
            dimension["score"] = None
        report["dimensions"][1].update(
            {
                "qualitative_level": "unassessable",
                "reason": "同一材料动作应合并还是拆分，现有依据无法确定。",
            }
        )
        report["findings"] = [
            finding(
                "F1",
                "flag",
                "uncertain",
                "C-AMB",
                "C-AMB:评分点聚合",
                ["E1", "E2"],
                "材料动作的独立性存在歧义，不能可靠确定内容覆盖等级。",
                None,
            )
        ]
        self.assertEqual(validate_case(case), [])
        self.assertEqual(validate_report(case, report), [])

    def test_locator_and_required_evidence_mix_are_checked(self):
        report = full_report()
        report["evidence"][0]["locator"] = "nonsense"
        self.assert_report_error(full_case(), report, "must use chars:start-end")

        report = full_report()
        report["dimensions"][1]["evidence_refs"] = ["E1", "E5"]
        self.assert_report_error(full_case(), report, "requires answer and material")

        report = essay_report()
        report["dimensions"][2]["evidence_refs"] = ["E1", "E3"]
        self.assert_report_error(
            essay_case(), report, "requires answer and material evidence"
        )

    def test_official_rubric_dimensions_and_evidence_are_bound(self):
        case = official_case()
        report = official_report()
        self.assertEqual(validate_case(case), [])
        self.assertEqual(validate_report(case, report), [])

        report["dimensions"][0]["evidence_refs"] = ["E1", "E3"]
        self.assert_report_error(case, report, "configured rubric entries")

        report = official_report()
        report["dimensions"][0]["max_score"] = 13
        report["dimensions"][1]["max_score"] = 7
        self.assert_report_error(case, report, "must match rubric_dimensions")

        case["rubric_entries"][0].pop("source_url")
        self.assertTrue(any("source_url" in error for error in validate_case(case)))

        case = official_case()
        case["rubric_entries"].append(
            {
                "id": "R3",
                "rule_type": "non_additive",
                "text": "方向错误时总分不得超过10分。",
                "source_title": "示例正式评分细则",
                "source_url": "https://example.gov.cn/rubric",
                "retrieved_on": "2026-09-02",
            }
        )
        self.assertTrue(
            any("full mode cannot use non_additive" in error for error in validate_case(case))
        )

        case["rubric_dimensions"][0]["rubric_entry_ids"].append("R3")
        self.assertTrue(
            any("cannot bind a non_additive rule" in error for error in validate_case(case))
        )

        case = official_case()
        disguised_rule = {
            "id": "R3",
            "rule_type": "dimension_band",
            "text": "方向错误时总分不得超过10分。",
            "source_title": "示例正式评分细则",
            "source_url": "https://example.gov.cn/rubric",
            "retrieved_on": "2026-09-02",
        }
        case["rubric_entries"].append(disguised_rule)
        case["rubric_dimensions"][0]["rubric_entry_ids"].append("R3")
        self.assertTrue(
            any("appears non-additive" in error for error in validate_case(case))
        )

        case = official_case()
        case["rubric_entries"][0]["text"] = (
            "内容满分5分，以0.5分计；一般0至2分，较好2.5至5分。"
        )
        errors = validate_case(case)
        self.assertTrue(any("max_score is not declared" in error for error in errors), errors)
        self.assertTrue(any("level_bands[0] is not declared" in error for error in errors), errors)

        case = official_case()
        case["rubric_entries"].append(
            {
                "id": "R3",
                "rule_type": "dimension_band",
                "text": "本条另有条件。",
                "source_title": "示例正式评分细则",
                "source_url": "https://example.gov.cn/rubric",
                "retrieved_on": "2026-09-02",
            }
        )
        case["rubric_dimensions"][0]["rubric_entry_ids"].append("R3")
        errors = validate_case(case)
        self.assertTrue(
            any("bound rubric entry R3" in error for error in errors),
            errors,
        )

    def test_nonadditive_rule_heuristic_distinguishes_total_maximum_from_cap(self):
        legal_total_and_bands = (
            "本题最高20分，其中内容14分、组织表达6分；"
            "内容一般0至8.5分，较好9至14分。"
        )
        self.assertFalse(looks_non_additive_rule(legal_total_and_bands, 20))
        self.assertFalse(
            looks_non_additive_rule("内容维度得分最高14分，表达维度最高6分。", 20)
        )
        self.assertFalse(looks_non_additive_rule("本题最高二十分。", 20))
        self.assertTrue(looks_non_additive_rule("本题至多计10分。", 20))
        self.assertTrue(
            looks_non_additive_rule("方向错误时总分不得超过10分。", 20)
        )
        self.assertTrue(looks_non_additive_rule("本题最高十九分。", 20))
        self.assertTrue(
            looks_non_additive_rule(
                "本题最高20分。若方向错误，本题总分不得超过10分。", 20
            )
        )
        for rule in (
            "内容满分14分；无标题者扣2分。",
            "标题缺失，扣2分。",
            "错别字三个扣1分。",
            "格式错误扣1分。",
            "完全偏题不得高于10分。",
            "方向错误最高给10分。",
            "任务错误只给5分。",
            "不符合文种要求按5分计。",
            "立意不当控制在10分以内。",
            "答非所问，成绩不得超过10分。",
            "材料使用不当，上限10分。",
            "观点不正确，至多10分。",
            "方向错误时，总分不得超过本题满分的50%。",
            "方向错误，按总分的五成计。",
            "偏题者最多得总分的一半。",
            "答案雷同，按本题分值的50%计分。",
            "跑题只给满分的三成。",
            "抄袭材料原文，最高不超过总分一半。",
            "偏离题意者降一个档次。",
            "未按文种作答，整体降一档。",
            "字数严重不足，酌情降档。",
            "抄袭材料者直接判为四类文。",
            "没有标题的，在原档次基础上下调一档。",
            "结构不完整者不得进入一类文。",
            "方向错误不得评为优秀档。",
            "缺少标题，在原得分基础上减去2分。",
            "字数不足800字，按下一档处理。",
            "完全脱离材料，归入四类文。",
            "有重大政治错误，作文不予评分。",
            "不符合文种要求，得分按本档最低档次确定。",
            "每少50字从总成绩中减去1分。",
            "未拟标题者，在原得分基础上下调两分。",
            "中心不明确，最高只能评为三类文。",
            "跑题文列为四类。",
            "不满600字，只能进入三类及以下。",
            "无标题者从所得成绩里扣掉2分。",
            "有政治性错误，不作评分。",
            "方向偏离时，所得分值以10分为限。",
            "完全抄录材料者划入最低档。",
            "跑题文列入四类文。",
            "有政治性错误，作零分处理。",
            "严重跑题者评定为四类文。",
            "无标题者从总成绩中扣去2分。",
            "方向有偏差时，得分以10分为界。",
            "先按内容确定档次，再依据表达在档内浮动。",
            "完全抄袭材料者不给分。",
            "有创新性者可上浮一档。",
            "偏题者限于10分以内赋分。",
            "文种错误，按总成绩的80%计分。",
            "未按格式作答，最终得分乘以0.8。",
            "无标题者扣总分的10%。",
            "字数不足，按原得分打八折。",
            "雷同卷只保留原得分的八成。",
            "跑题者，最终成绩折半。",
            "缺标题者，最终成绩系数为0.9。",
            "违规者，只保留原得分的一半。",
            "内容定档后，语言表现决定在档内的具体位置。",
            "若内容项为零，组织表达分不再计入。",
            "内容分与表达分取较低者计入。",
            "内容和表达两项择高计分。",
            "达到基本要求者，本题最低给10分。",
            "总分按四舍五入取整。",
            "在内容得分基础上，根据表达情况上浮或下浮2分。",
            "视表达情况上下浮动2分。",
            "在原分基础上酌情浮动1至2分。",
            "根据书写情况增加或减少2分。",
        ):
            self.assertTrue(looks_non_additive_rule(rule, 20), rule)

        case = official_case()
        case["rubric_entries"][0]["text"] = "内容满分14分；无标题者扣2分。"
        self.assertTrue(
            any("appears non-additive" in error for error in validate_case(case))
        )

        for appended_rule in (
            "跑题者，最终成绩折半。",
            "缺标题者，最终成绩系数为0.9。",
            "违规者，只保留原得分的一半。",
            "内容定档后，语言表现决定在档内的具体位置。",
        ):
            case = official_case()
            case["rubric_entries"][0]["text"] += "；" + appended_rule
            self.assertTrue(
                any("appears non-additive" in error for error in validate_case(case)),
                appended_rule,
            )

        for legal_band in (
            "内容有错误、概括不全面的，最高得8分；内容准确全面的，9至14分。",
            "语言错误较少，最高得6分。",
            "语言错误较多，只给0至3分；错误较少，计4至6分。",
            "本维度不满足完整准确要求者，最高8分。",
            "内容错误时，按内容满分的50%计。",
        ):
            self.assertFalse(looks_non_additive_rule(legal_band, 20), legal_band)

    def test_nonadditive_external_rule_forces_cited_qualitative_mode(self):
        case = official_case()
        global_rule = {
            "id": "R3",
            "rule_type": "non_additive",
            "text": "方向错误时总分不得超过10分。",
            "source_title": "示例正式评分细则",
            "source_url": "https://example.gov.cn/rubric",
            "retrieved_on": "2026-09-02",
        }
        case.update({"grading_mode": "limited", "mode_reason": "rule_ambiguity"})
        case["rubric_entries"].append(global_rule)

        report = official_report()
        report.update(
            {
                "grading_mode": "limited",
                "estimated_score": None,
                "score_range": None,
                "overall_assessment": "存在非加性封顶规则，只作定性诊断。",
                "confidence": {"level": "low", "reasons": ["当前数值模型不支持总分封顶。"]},
            }
        )
        report["evidence"].append(evidence("E6", "rubric", "R3", global_rule["text"]))
        for dimension in report["dimensions"]:
            dimension.update(
                {
                    "max_score": None,
                    "score": None,
                    "qualitative_level": "unassessable",
                    "reason": "总分封顶规则无法由独立分项相加模型执行。",
                }
            )
        report["dimensions"][0]["evidence_refs"].append("E6")
        report["checks"] = [
            {
                "id": "K1",
                "kind": "non_additive_rule",
                "subject": "external_rule",
                "status": "unsupported",
                "rule_entry_id": "R3",
                "requirement": global_rule["text"],
                "reason": "该封顶规则不能由独立分项相加模型执行。",
                "score_effect": None,
                "evidence_refs": ["E1", "E6"],
            }
        ]
        report["findings"][0].update(
            {
                "type": "flag",
                "judgment": "uncertain",
                "scoring_units": None,
                "evidence_refs": ["E1", "E2", "E6"],
                "explanation": "外部细则含总分封顶，当前契约不输出数值。",
            }
        )
        self.assertEqual(validate_case(case), [])
        self.assertEqual(validate_report(case, report), [])

        case["mode_reason"] = "user_requested_qualitative"
        report["confidence"] = {"level": "medium", "reasons": ["用户只要定性意见。"]}
        self.assert_report_error(case, report, "requires low confidence")
        report["confidence"] = {"level": "low", "reasons": ["存在未绑定外部规则。"]}
        self.assertEqual(validate_report(case, report), [])

        report["checks"][0]["requirement"] = "本次估分为19分"
        self.assert_report_error(case, report, "must equal its non_additive rubric text")
        report["checks"][0]["requirement"] = global_rule["text"]

        report["dimensions"][0]["evidence_refs"].remove("E6")
        report["findings"][0]["evidence_refs"].remove("E6")
        report["checks"][0]["evidence_refs"].remove("E6")
        self.assert_report_error(case, report, "exact non_additive rubric entry")

    def test_only_nonadditive_external_rules_have_a_checks_only_report(self):
        case = official_case()
        global_rule = {
            "id": "R1",
            "rule_type": "non_additive",
            "text": "方向错误时本题至多计10分。",
            "source_title": "示例正式评分细则",
            "source_url": "https://example.gov.cn/rubric",
            "retrieved_on": "2026-09-02",
        }
        case.update(
            {
                "grading_mode": "limited",
                "mode_reason": "rule_ambiguity",
                "rubric_entries": [global_rule],
                "rubric_dimensions": [],
            }
        )
        report = {
            "schema_version": "shenlun-grading-report-v1",
            "question_id": "Q1",
            "grading_mode": "limited",
            "rubric_version": "official-example-v1",
            "rubric_source": "verified_official",
            "disclaimer": "非官方定性诊断",
            "overall_assessment": "外部细则只有非加性规则，当前契约不作数值模拟。",
            "estimated_score": None,
            "score_range": None,
            "dimensions": [],
            "evidence": [
                evidence("E1", "answer", "answer", ANSWER),
                evidence("E2", "rubric", "R1", global_rule["text"]),
            ],
            "findings": [],
            "checks": [
                {
                    "id": "K1",
                    "kind": "non_additive_rule",
                    "subject": "external_rule",
                    "status": "unsupported",
                    "rule_entry_id": "R1",
                    "requirement": global_rule["text"],
                    "reason": "该规则不能由独立分项相加模型执行。",
                    "score_effect": None,
                    "evidence_refs": ["E1", "E2"],
                }
            ],
            "priority_fixes": ["补充可独立相加的完整分项细则后再估分。"],
            "confidence": {"level": "low", "reasons": ["数值规则结构不受支持。"]},
        }
        self.assertEqual(validate_case(case), [])
        self.assertEqual(validate_report(case, report), [])

    def test_limited_rejects_hidden_numeric_scores_and_extra_fields(self):
        report = limited_report()
        report["official_score"] = 19
        self.assert_report_error(limited_case(), report, "unsupported fields")

        report = limited_report()
        report["dimensions"][0]["raw_score"] = 19
        self.assert_report_error(limited_case(), report, "unsupported fields")

        report = limited_report()
        report["findings"][0]["points"] = 19
        self.assert_report_error(limited_case(), report, "unsupported fields")

        report = limited_report()
        report["overall_assessment"] = "非官方估分为19分。"
        self.assert_report_error(limited_case(), report, "must not state a numeric score")

        for leaked_score in (
            "此答最多十分，须重写。",
            "此答只能拿零分。",
            "此答得分率约70%。",
            "此答大概十余分。",
            "此答约10余分。",
            "此答约13／20。",
            "得分比例约为百分之七十。",
            "得分占满分的70%。",
            "估分约在13—15之间。",
            "此答估分约在18到20之间。",
            "此答预计拿到18左右。",
            "此答最多拿18。",
            "此答大约为十八上下。",
            "此答约占满分七成。",
            "此答能得百分之七十。",
            "此答成绩在18左右。",
            "得分相当于满分的四分之三。",
            "可取得满分的70%。",
            "此答大约能拿到满分的七成。",
            "折算后约为百分之七十二。",
            "此答大约可获七成成绩。",
            "大致是70%的得分水平。",
            "此答接近四分之三的满分表现。",
            "表现落在七成至八成之间。",
            "得分约占满分的0.7。",
            "成绩相当于满分的0.7倍。",
            "得分比例介于0.6和0.7之间。",
            "此答大约可获0.7倍满分。",
            "训练得分系数为0.68。",
            "此答约满分的一半。",
            "此答大约总分的50%。",
            "结果为满分一半。",
            "七成左右的成绩。",
            "这答案能拿18左右。",
            "此答可拿十八上下。",
            "大约能拿18。",
            "能得十八左右。",
            "得分约为七折。",
            "成绩打七折。",
            "相当于满分的七折。",
            "这份答案大约七折水平。",
            "大概只能拿七成。",
        ):
            report = limited_report()
            report["overall_assessment"] = leaked_score
            self.assert_report_error(
                limited_case(), report, "must not state a numeric score"
            )

        report = limited_report()
        report["overall_assessment"] = "表述大概十分准确，但任务依据仍不完整。"
        self.assertEqual(validate_report(limited_case(), report), [])

        case = official_case()
        case.update(
            {
                "grading_mode": "limited",
                "mode_reason": "user_requested_qualitative",
            }
        )
        case["rubric_dimensions"][0]["name"] = "内容（预计19分）"
        self.assertTrue(
            any("name must not contain score language" in error for error in validate_case(case))
        )

        case = materials_missing_case()
        report = materials_missing_report()
        report["checks"] = [
            {
                "id": "K1",
                "kind": "requirement",
                "subject": "format",
                "status": "violated",
                "rule_entry_id": None,
                "requirement": "估分为19分",
                "reason": "该文字试图绕过定性模式。",
                "score_effect": None,
                "evidence_refs": ["E1", "E2"],
            }
        ]
        self.assert_report_error(case, report, "checks[0].requirement")

    def test_full_narrative_cannot_contradict_the_numeric_ledger(self):
        report = full_report()
        report["overall_assessment"] = "非官方训练估分20分，表现优秀。"
        self.assert_report_error(
            full_case(), report, "must not state a numeric score outside the numeric ledger"
        )

        report = full_report()
        report["dimensions"][1]["reason"] = "内容得分13分。"
        self.assert_report_error(
            full_case(), report, "must not state a numeric score outside the numeric ledger"
        )

    def test_case_schema_rejects_hidden_rule_and_answer_fields(self):
        case = full_case()
        case["official_score"] = 19
        self.assertTrue(any("unsupported fields" in error for error in validate_case(case)))

        case = official_case()
        case["rubric_entries"][0]["global_cap"] = 10
        self.assertTrue(any("unsupported fields" in error for error in validate_case(case)))

        case = official_case()
        case["rubric_dimensions"][0]["deduction"] = 2
        self.assertTrue(any("unsupported fields" in error for error in validate_case(case)))

        case = full_case()
        case["criteria"][0]["answer_hint"] = "照抄答案"
        self.assertTrue(any("unsupported fields" in error for error in validate_case(case)))

    def test_requirement_check_records_nonnumeric_exam_constraints(self):
        self.assertEqual(validate_report(essay_case(), essay_report()), [])

        report = essay_report()
        report["checks"] = []
        self.assert_report_error(
            essay_case(), report, "locked prompt requirement genre@"
        )

        report = essay_report()
        report["checks"].append(copy.deepcopy(report["checks"][0]))
        report["checks"][1]["id"] = "K2"
        self.assert_report_error(
            essay_case(), report, "duplicates a locked prompt requirement"
        )

        numeric_title_prompt = "请以“一分部署，九分落实”为题写一篇文章。"
        case = essay_case()
        case["prompt"] = numeric_title_prompt
        case["prompt_requirements"] = [
            {"id": f"P{index}", **item}
            for index, item in enumerate(
                detected_prompt_requirements(numeric_title_prompt), start=1
            )
        ]
        case["requirements_lock"] = expected_requirements_lock(case)
        self.assertEqual(validate_case(case), [])

        report = essay_report()
        report["evidence"][2] = evidence(
            "E3", "prompt", "prompt", numeric_title_prompt
        )
        report["evidence"][3] = excerpt_evidence(
            "E4", "prompt", "prompt", numeric_title_prompt, "写一篇文章"
        )
        report["evidence"].append(
            excerpt_evidence(
                "E5",
                "prompt",
                "prompt",
                numeric_title_prompt,
                "以“一分部署，九分落实”为题",
            )
        )
        report["checks"].append(
            {
                "id": "K2",
                "kind": "requirement",
                "subject": "title",
                "status": "violated",
                "rule_entry_id": None,
                "requirement": "以“一分部署，九分落实”为题",
                "reason": "答案未使用题干指定标题。",
                "score_effect": None,
                "evidence_refs": ["E1", "E5"],
            }
        )
        self.assertEqual(validate_report(case, report), [])

    def test_detected_prompt_requirements_cannot_be_omitted(self):
        prompt = "请概括材料，限200字，并拟标题。"
        case = full_case()
        case["prompt"] = prompt
        case["prompt_requirements"] = []
        case["requirements_lock"] = expected_requirements_lock(case)
        case["criteria_lock"] = expected_criteria_lock(case)
        errors = validate_case(case)
        self.assertTrue(any("detected title" in error for error in errors), errors)
        self.assertTrue(any("detected word_limit" in error for error in errors), errors)

        case["prompt_requirements"] = [
            prompt_requirement("P1", "word_limit", prompt, "限200字"),
            prompt_requirement("P2", "title", prompt, "拟标题"),
        ]
        case["requirements_lock"] = expected_requirements_lock(case)
        case["criteria_lock"] = expected_criteria_lock(case)
        self.assertEqual(validate_case(case), [])

        report = full_report()
        report["evidence"][4] = evidence("E5", "prompt", "prompt", prompt)
        report["evidence"].extend(
            [
                excerpt_evidence("E6", "prompt", "prompt", prompt, "限200字"),
                excerpt_evidence("E7", "prompt", "prompt", prompt, "拟标题"),
            ]
        )
        report["checks"] = [
            {
                "id": "K1",
                "kind": "requirement",
                "subject": "word_limit",
                "status": "satisfied",
                "rule_entry_id": None,
                "requirement": "限200字",
                "reason": "答案篇幅符合题干限制。",
                "score_effect": None,
                "evidence_refs": ["E1", "E6"],
            },
            {
                "id": "K2",
                "kind": "requirement",
                "subject": "title",
                "status": "violated",
                "rule_entry_id": None,
                "requirement": "拟标题",
                "reason": "答案没有单列标题。",
                "score_effect": None,
                "evidence_refs": ["E1", "E7"],
            },
        ]
        self.assertEqual(validate_report(case, report), [])

        multi_limit_prompt = "正文不少于150字，且不超过200字。"
        case = full_case()
        case["prompt"] = multi_limit_prompt
        case["prompt_requirements"] = [
            prompt_requirement(
                "P1", "word_limit", multi_limit_prompt, "不少于150字"
            )
        ]
        case["requirements_lock"] = expected_requirements_lock(case)
        case["criteria_lock"] = expected_criteria_lock(case)
        self.assertTrue(
            any("不超过200字" in error for error in validate_case(case)),
            validate_case(case),
        )

        alternate_limit_prompt = (
            "请概括材料，不得少于150字。内容完整、条理清晰。最多写200字。"
        )
        case = full_case()
        case["prompt"] = alternate_limit_prompt
        case["prompt_requirements"] = [
            prompt_requirement(
                "P1", "word_limit", alternate_limit_prompt, "不得少于150字"
            )
        ]
        case["requirements_lock"] = expected_requirements_lock(case)
        case["criteria_lock"] = expected_criteria_lock(case)
        self.assertTrue(
            any("最多写200字" in error for error in validate_case(case)),
            validate_case(case),
        )

        high_limit_prompt = (
            "请概括材料，不少于150字。请确保内容完整、条理清晰。不得高于200字。"
        )
        detected = detected_prompt_requirements(high_limit_prompt)
        self.assertEqual(
            [
                item["excerpt"]
                for item in detected
                if item["subject"] == "word_limit"
            ],
            ["不少于150字", "不得高于200字"],
        )

        format_prompt = "须有称谓、正文、结语、落款和日期。"
        self.assertEqual(
            [
                item["excerpt"]
                for item in detected_prompt_requirements(format_prompt)
                if item["subject"] == "format"
            ],
            ["须有称谓、正文、结语、落款和日期"],
        )

        title_prompt = "自拟主标题，并设置副题。"
        self.assertEqual(
            [
                item["excerpt"]
                for item in detected_prompt_requirements(title_prompt)
                if item["subject"] == "title"
            ],
            ["自拟主标题", "设置副题"],
        )

        coordinated_title_prompt = "请概括基层治理措施，主标题与副标题均须拟写。"
        self.assertEqual(
            [
                item["excerpt"]
                for item in detected_prompt_requirements(coordinated_title_prompt)
                if item["subject"] == "title"
            ],
            ["主标题与副标题均须拟写"],
        )
        case = full_case()
        case["prompt"] = coordinated_title_prompt
        case["prompt_requirements"] = []
        case["requirements_lock"] = expected_requirements_lock(case)
        case["criteria_lock"] = expected_criteria_lock(case)
        self.assertTrue(
            any("detected title" in error for error in validate_case(case)),
            validate_case(case),
        )

        scoped_limit_prompt = "单项答案不超过50字，总体不得超过200字。"
        self.assertEqual(
            [
                item["excerpt"]
                for item in detected_prompt_requirements(scoped_limit_prompt)
                if item["subject"] == "word_limit"
            ],
            ["单项答案不超过50字", "总体不得超过200字"],
        )

        for range_prompt, expected_excerpt in (
            ("字数应在150到200之间。", "字数应在150到200之间"),
            ("须达150字且不得逾200字。", "须达150字"),
        ):
            detected_excerpts = [
                item["excerpt"]
                for item in detected_prompt_requirements(range_prompt)
                if item["subject"] == "word_limit"
            ]
            self.assertIn(expected_excerpt, detected_excerpts)

        subtitle_prompt = "请拟定标题，并另加小标题。"
        self.assertEqual(
            [
                item["excerpt"]
                for item in detected_prompt_requirements(subtitle_prompt)
                if item["subject"] == "title"
            ],
            ["拟定标题", "另加小标题"],
        )

        for neutral_prompt in (
            "请分析该报告存在的问题。",
            "请说明如何把公开作为治理抓手。",
        ):
            case = full_case()
            case["prompt"] = neutral_prompt
            case["requirements_lock"] = expected_requirements_lock(case)
            case["criteria_lock"] = expected_criteria_lock(case)
            self.assertEqual(validate_case(case), [])

    def test_external_full_dimensions_require_complete_evidence_chain(self):
        report = official_report()
        report["dimensions"][0]["evidence_refs"].remove("E4")
        self.assert_report_error(
            official_case(), report, "requires prompt, material, answer, and rubric"
        )

    def test_external_full_requires_one_canonical_rule_per_dimension(self):
        case = official_case()
        combined_rule = (
            "内容满分14分，以0.5分计；一般0至8.5分，较好9至14分；"
            "组织表达满分6分，以0.5分计；一般0至4分，较好4.5至6分。"
        )
        case["rubric_entries"] = [
            {
                "id": "RALL",
                "rule_type": "dimension_band",
                "text": combined_rule,
                "source_title": "示例正式评分细则",
                "source_url": "https://example.gov.cn/rubric",
                "retrieved_on": "2026-09-02",
            }
        ]
        content, form = case["rubric_dimensions"]
        content.update(
            {
                "max_score": 6,
                "rubric_entry_ids": ["RALL"],
                "level_bands": [
                    {"name": "一般", "min_score": 0, "max_score": 4},
                    {"name": "较好", "min_score": 4.5, "max_score": 6},
                ],
            }
        )
        form.update(
            {
                "max_score": 14,
                "rubric_entry_ids": ["RALL"],
                "level_bands": [
                    {"name": "一般", "min_score": 0, "max_score": 8.5},
                    {"name": "较好", "min_score": 9, "max_score": 14},
                ],
            }
        )
        errors = validate_case(case)
        self.assertTrue(any("canonical one-dimension" in error for error in errors), errors)
        self.assertTrue(any("must bind exactly one" in error for error in errors), errors)

        for extra_operation in (
            "若内容项为零，组织表达分不再计入。",
            "内容分与表达分取较低者计入。",
            "内容和表达两项择高计分。",
            "达到基本要求者，本题最低给10分。",
            "总分按四舍五入取整。",
            "另有未结构化评分条件。",
        ):
            case = official_case()
            case["rubric_entries"][0]["text"] += "；" + extra_operation
            self.assertTrue(
                any("canonical one-dimension" in error for error in validate_case(case)),
                extra_operation,
            )

        case = official_case()
        hidden_gate = "内容不合格时表达无效"
        case["rubric_dimensions"][0]["level_bands"][0]["name"] = hidden_gate
        case["rubric_entries"][0]["text"] = (
            f"内容满分14分，以0.5分计；{hidden_gate}：0至8.5分，较好：9至14分。"
        )
        self.assertTrue(
            any("canonical one-dimension" in error for error in validate_case(case))
        )

        case = official_case()
        case["rubric_dimensions"][0]["name"] = hidden_gate
        case["rubric_entries"][0]["text"] = (
            f"{hidden_gate}满分14分，以0.5分计；一般0至8.5分，较好9至14分。"
        )
        self.assertTrue(
            any("canonical one-dimension" in error for error in validate_case(case))
        )

        report = official_report()
        report["dimensions"][1]["evidence_refs"].remove("E5")
        self.assert_report_error(
            official_case(), report, "requires prompt, material, answer, and rubric"
        )

    def test_external_scores_follow_declared_increment_band_and_uncertainty_floor(self):
        case = official_case()
        report = official_report()
        report["dimensions"][0]["score"] = 10.1
        report["estimated_score"] = 14.1
        report["score_range"] = {"min": 14.1, "max": 14.1}
        errors = validate_report(case, report)
        self.assertTrue(any("score_increment" in error for error in errors), errors)
        self.assertTrue(any("score_range is too narrow" in error for error in errors), errors)

        report = official_report()
        report["dimensions"][0]["qualitative_level"] = "一般"
        self.assert_report_error(case, report, "conflicts with rubric level band")

    def test_external_non_half_increment_has_a_valid_report(self):
        case = official_case()
        rule = "内容满分14分，以0.2分计；一般0至8.4分，较好8.6至14分。"
        case["rubric_entries"][0]["text"] = rule
        case["rubric_dimensions"][0].update(
            {
                "score_increment": 0.2,
                "level_bands": [
                    {"name": "一般", "min_score": 0, "max_score": 8.4},
                    {"name": "较好", "min_score": 8.6, "max_score": 14},
                ],
            }
        )
        report = official_report()
        report["evidence"][1] = evidence("E2", "rubric", "R1", rule)
        report["dimensions"][0]["score"] = 10.2
        report["estimated_score"] = 14.2
        report["score_range"] = {"min": 8.5, "max": 18}
        self.assertEqual(validate_case(case), [])
        self.assertEqual(validate_report(case, report), [])

    def test_nondefault_case_requires_structured_dimensions(self):
        case = official_case()
        case["rubric_dimensions"] = []
        self.assertTrue(
            any("requires rubric_dimensions" in error for error in validate_case(case))
        )

        case = official_case()
        case["rubric_dimensions"][0]["max_score"] = 13
        self.assertTrue(
            any("must sum to max_score" in error for error in validate_case(case))
        )

    def test_invalid_json_types_return_errors_not_exceptions(self):
        for key in ("grading_mode", "mode_reason", "question_type", "rubric_source"):
            case = full_case()
            case[key] = []
            self.assertTrue(validate_case(case))

        for path in (
            ("evidence", 0, "source"),
            ("evidence", 0, "source_id"),
            ("dimensions", 0, "id"),
            ("dimensions", 0, "qualitative_level"),
            ("findings", 0, "type"),
            ("findings", 0, "judgment"),
            ("findings", 0, "dimension_id"),
            ("findings", 0, "criterion_id"),
        ):
            report = full_report()
            report[path[0]][path[1]][path[2]] = []
            self.assertTrue(validate_report(full_case(), report))

        report = full_report()
        report["confidence"]["level"] = []
        self.assertTrue(validate_report(full_case(), report))

        report = essay_report()
        for key in ("status", "requirement"):
            for malformed in ([], {}):
                candidate = copy.deepcopy(report)
                candidate["checks"][0][key] = malformed
                self.assertTrue(validate_report(essay_case(), candidate))

    def test_malformed_url_and_giant_locator_do_not_crash(self):
        case = official_case()
        case["rubric_entries"][0]["source_url"] = "http://["
        self.assertTrue(validate_case(case))

        report = full_report()
        report["evidence"][0]["locator"] = "chars:" + "9" * 5000 + "-1"
        self.assertTrue(validate_report(full_case(), report))

        case = full_case()
        case["max_score"] = 10**1000
        self.assertTrue(validate_case(case))

        report = full_report()
        report["estimated_score"] = 1e308
        self.assertTrue(validate_report(full_case(), report))

    def test_finding_combinations_and_numeric_ledger_are_checked(self):
        report = full_report()
        report["findings"][0]["judgment"] = "missing"
        self.assert_report_error(full_case(), report, "combination is unsupported")

        report = full_report()
        report["findings"][0]["score_effect"] = 3
        self.assert_report_error(full_case(), report, "score_effect is forbidden")

        report = full_report()
        report["findings"][0]["scoring_units"] = {"max": 1, "awarded": 0.5}
        self.assert_report_error(full_case(), report, "conflicts with finding judgment")

        report = essay_report()
        report["findings"][0]["scoring_units"] = {"max": 1, "awarded": 1}
        self.assert_report_error(essay_case(), report, "must be null outside")

    def test_duplicate_requires_prior_credit_and_adds_no_units(self):
        report = full_report()
        duplicate = copy.deepcopy(report["findings"][0])
        duplicate.update(
            {
                "id": "F4",
                "type": "flag",
                "judgment": "duplicate",
                "scoring_units": {"max": 0, "awarded": 0},
            }
        )
        report["findings"].append(duplicate)
        self.assertEqual(validate_report(full_case(), report), [])

        report = full_report()
        report["findings"][0].update(
            {
                "type": "omission",
                "judgment": "missing",
                "evidence_refs": ["E2"],
                "scoring_units": {"max": 1, "awarded": 0},
            }
        )
        report["findings"].append(duplicate)
        self.assert_report_error(full_case(), report, "must follow a credited")

    def test_confidence_rules_are_checked(self):
        report = full_report()
        report["confidence"]["level"] = "high"
        self.assert_report_error(full_case(), report, "high confidence requires")

        report = limited_report()
        report["confidence"]["level"] = "medium"
        self.assert_report_error(
            limited_case(), report, "requires low confidence"
        )

        self.assertEqual(
            validate_report(official_case(), official_report()),
            [],
        )

    def test_cli_smoke(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            case_path = root / "case.json"
            report_path = root / "report.json"
            case_path.write_text(
                json.dumps(full_case(), ensure_ascii=False), encoding="utf-8"
            )
            report_path.write_text(
                json.dumps(full_report(), ensure_ascii=False), encoding="utf-8"
            )
            result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPTS / "validate_report.py"),
                    str(case_path),
                    str(report_path),
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("grading_report=pass", result.stdout)

            lock_result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPTS / "criteria_lock.py"),
                    str(case_path),
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(lock_result.returncode, 0, lock_result.stderr)
            self.assertEqual(lock_result.stdout.strip(), full_case()["criteria_lock"])

            requirement_lock_result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPTS / "requirements_lock.py"),
                    str(case_path),
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(
                requirement_lock_result.returncode, 0, requirement_lock_result.stderr
            )
            self.assertEqual(
                requirement_lock_result.stdout.strip(),
                full_case()["requirements_lock"],
            )


if __name__ == "__main__":
    unittest.main()
