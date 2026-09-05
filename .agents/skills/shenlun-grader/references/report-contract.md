# 批改报告契约 v1

## 对话输出

普通对话按下列顺序输出；没有内容的部分省略：

1. **批改依据**：题型、模式、量表 ID、评分来源、评分点图与缺失项。
2. **结果**：`full` 给非官方训练估分、区间、置信度；`limited` 只给总体定性判断。
3. **分项评价**：每项含得分或等级、最短证据、判断理由。
4. **逐点诊断**：命中、部分命中、重复、无材料支持、方向错误、遗漏。
5. **优先修改**：至多五项，按可能提分收益排序，说明如何改。
6. **修改稿**：仅用户要求时提供，与原答案评分分开。

不得使用“内容不够丰富”“逻辑有待加强”等无证据评价。引用只取完成判断所需的最短原文。

## 数值账本

分项得分是唯一“原始分制”账本。逐点诊断只记录语义判定及用于反算的无量纲 `scoring_units`，不记录正负 `score_effect`；同一缺陷不得既降低分项得分，又作为额外扣分再次计算。

- 全部数值沿用题目原始分制。
- 分项得分之和等于中心估分；分项满分之和等于题目满分。
- 默认训练量表的中心估分与分项实得分使用 0.5 分粒度。外部量表的分项实得分服从各维度声明的 `score_increment`，中心估分为这些分项之和；其结果可以不是 0.5 分网格。
- 两类量表的区间端点均保守取至 0.5 分；外部量表声明更粗粒度时，分项得分仍须同时服从该粒度。
- 所有训练估分区间总宽不得小于题目满分的 10% 向上取至 0.5 分后的值，且必须包含中心估分。
- 有争议项目时，下限按保守判断，上限按可成立判断；须说明区间由何而来。

默认量表先用最大余数法把分项满分确定性分配到 0.5 分网格：权重原始单位向下取整，剩余半分单位按小数余数降序、同余数按量表维度顺序补足。默认短题的内容维度再由锁定评分点的 `scoring_units` 机械反算；评分点图必须完整，不得只列若干示例。默认短题的非内容维度以及默认作文各维度使用统一等级：`strong` 为 `[85%, 100%]`、中心 `92.5%`；`adequate` 为 `[70%, 85%)`、中心 `77.5%`；`developing` 为 `[45%, 70%)`、中心 `57.5%`；`weak` 为 `[0, 45%)`、中心 `22.5%`。维度实得分取中心比例并按四舍五入取至 0.5 分。

默认量表区间由各评分点上下限和维度等级区间机械合成；因逐维取至 0.5 分而使中心估分落在原始边界外时，先扩展原始边界以包含中心估分。外部量表区间由报告所选各 `level_band` 的上下限合成。两者都先以完整精度求和，总下限向下、总上限向上取至 0.5 分；不足最低宽度时先向下扩展，空间不足再向上扩展。上述默认等级阈值只属于 `diagnostic_default`，不得套用到用户或官方量表；外部量表的数值维度、满分、粒度和等级区间均以结构化细则为准。

## 置信度

- `high`：仅限输入完整，且实际评分细则已经从其正式来源核验。
- `medium`：输入完整，采用本 Skill 训练量表，题干与材料清楚。
- `low`：输入、OCR、题型、材料完整性或评分依据存在重要不确定性；外部细则含未绑定规则时必须使用此级别。

官方考试大纲不等于评分细则。`limited` 模式不得标为 `high`。

## 结构化 case

case 及其材料、细则、维度、等级区间、评分点和材料证据对象均为封闭结构，只能使用下述字段；附加分数、扣分、答案提示或其他旁路字段会被拒绝。

```json
{
  "schema_version": "shenlun-grading-case-v1",
  "question_id": "Q1",
  "question_type": "summary",
  "grading_mode": "full",
  "mode_reason": "complete_input",
  "missing_inputs": [],
  "prompt": "题干原文",
  "prompt_requirements": [],
  "requirements_lock": "sha256:ff37c34469d34adcc951d9521fd8d1ddaa6d397ac4f98c1e2d12c6ba3effa691",
  "answer": "考生原答案",
  "materials": [{"id": "M1", "text": "材料原文"}],
  "materials_complete": true,
  "max_score": 20,
  "rubric_version": "diagnostic-short-v1",
  "rubric_source": "diagnostic_default",
  "rubric_entries": [],
  "rubric_dimensions": [],
  "criteria": [{
    "id": "C1",
    "dimension_id": "content_points",
    "counting_key": "C1:材料要点",
    "expected_meaning": "材料要点",
    "material_evidence": [{
      "source_id": "M1",
      "locator": "chars:0-4",
      "excerpt": "材料原文"
    }]
  }],
  "criteria_lock": "sha256:835836e7ef88fe55ac9355a6af40556b22a8b91c831e3f56218032728da35adb"
}
```

`question_type` 取 `summary`、`analysis`、`countermeasure`、`implementation`、`composite`、`essay` 或 `unknown`。`full` 不得使用 `unknown`。

`full` 要求完整题干、答案、全部材料、正数满分，且 `missing_inputs` 为空。默认量表还要求满分不低于 5 且位于 0.5 分网格，才能为每个维度分配正数满分。`limited` 允许缺题干、材料或满分，但须准确列出实际缺失项并写明对应 `mode_reason`；不得把已有输入伪报为缺失。用户主动只要定性意见时，`missing_inputs` 可为空，`mode_reason` 写 `user_requested_qualitative`。

用户或官方评分细则放入 `rubric_entries`，每项含 `id`、原文 `text` 和 `rule_type`。`rule_type` 取 `dimension_band` 或 `non_additive`：前者能完整表达为独立相加的分项等级区间，后者包括整题封顶、固定加扣分、比例或乘数调整、整体降档、跨维度条件和先后适用规则。常见非加性措辞若误标为 `dimension_band`，验证器会拒绝；启发式不能穷尽或完全理解自然语言，语义分类仍须人工复核。使用 `verified_official` 时，每项还须有 `source_title`、`source_url` 和 ISO 日期 `retrieved_on`。考试大纲只能放在考试档案中，不得冒充评分细则。

读答案前先建立 `prompt_requirements`。每项只含唯一 `id`、`subject`、`locator` 和 `excerpt`；`subject` 取 `title/word_limit/format/genre/identity/other`，后两项必须精确选中题干原文。验证器会逐个发现常见标题、限字、格式、文体及身份措辞，不能用同类别的一条要求替代另一条；自然语言检测只是下限，仍须人工逐句复核。运行 `python3 .agents/skills/shenlun-grader/scripts/requirements_lock.py <case.json>`，将结果写入 `requirements_lock`。哈希绑定题号、题型、题干与完整要求表，但排除答案；有题干时即使要求表为空也必须生成，缺题干时方为 `null`。

默认短题随后建立 `criteria`。每点包含唯一 `id`、内容维度 ID、稳定 `counting_key`、`expected_meaning`，以及至少一处能被精确定位的 `material_evidence`。运行 `python3 .agents/skills/shenlun-grader/scripts/criteria_lock.py <case.json>`，将结果写入 `criteria_lock`；哈希绑定题干要求表、材料、题目满分、量表和评分点，但排除答案。材料不完整、OCR 未确认、评分点无法消除歧义而使用 `rule_ambiguity`、作文、未知题型及非默认量表的 `criteria` 为空且 `criteria_lock` 为 `null`。

非默认量表通常还须提供 `rubric_dimensions`。每项包含唯一 `id`、不含分数语言的名称、`max_score`、全部依据原文的 `rubric_entry_ids`、`scoring_method: level_band`、不小于 0.1 的 `score_increment`，以及按该粒度从 0 无断档覆盖至分项满分的 `level_bands`；每个 band 含 `name/min_score/max_score`。满分只能写入 `max_score` 或来源原文，不得塞入名称。维度只能绑定 `dimension_band`。`full` 下，每条绑定原文仅能绑定一个维度，并须严格写成 `<维度名>满分<数值>分，以<粒度>分计；<等级名><下限>至<上限>分，……`：维度名须由验证器允许的评分维度原子构成，等级名须取封闭标签（如“优秀、良好、一般、较差、一类文、二类文、A档”），不得用自然语言条件句充当名称。维度名、满分、粒度、等级名及全部边界逐项等于结构化字段，原文不得合并多个维度、彼此补缺或附加其他评分条款。不能无损表达为该封闭格式的真实细则一律转 `limited`，不得为了通过验证而改写来源原文。`full` 不得含 `non_additive`，全部 `dimension_band` 必须被绑定，各维度满分之和必须等于题目满分；报告中每个外部数值维度必须同时引用题干、材料、答案和该维度绑定的全部细则。只要存在 `non_additive`、未绑定规则或规范化失败，就使用 `limited`，已有外部分项全部标为 `unassessable`，每条 `non_additive` 用一个 `check` 记录；若全部规则均为 `non_additive`，允许 `rubric_dimensions` 与报告 `dimensions/findings` 为空，由 `checks` 独立承载诊断。输入无其他缺失时，`mode_reason` 使用 `rule_ambiguity`；同时存在输入缺失时使用相应缺失原因。默认训练量表的 `rubric_entries` 与 `rubric_dimensions` 均为空，由量表版本固定维度和权重。

## 结构化 report

顶层字段：

- 身份：`schema_version`、`question_id`、`grading_mode`、`rubric_version`、`rubric_source`。
- 结论：`disclaimer`、`overall_assessment`、`estimated_score`、`score_range`、`confidence`。
- 证据：`dimensions`、`evidence`、`findings`、`checks`、`priority_fixes`。

report 顶层及所有子对象均为封闭结构，不得添加 `official_score`、`raw_score`、`points` 等未声明字段。任何模式的叙述、理由、诊断、建议与置信度理由均不得重复书写具体分数，数值只存在于 `estimated_score`、`score_range` 和分项账本；`limited` 的分项等级也不得暗示具体估分。题干与外部规则原有数字只能保留在逐字 `evidence` 及相应 check 的 `requirement` 中。

`priority_fixes` 是最多五个非空字符串组成的数组，不是对象数组。每个字符串在一句话内写清问题与具体改法，并按预期提分收益降序排列。

每个 `dimension` 包含唯一 `id`、名称、分项满分、实得分、定性等级、独立 `reason` 及证据引用。默认量表的等级为 `strong/adequate/developing/weak/unassessable`；外部量表须使用已配置 band 名称。`limited` 下报告的分项满分与实得分均为 `null`。默认作文 `full` 报告的每个维度至少须有一项同维度 finding。

默认量表的缺输入规则：缺题干时，任务与材料依赖维度为 `unassessable`；缺或未完整提供材料时，内容、材料理解与材料转化维度为 `unassessable`；OCR 有关键不确定时全部维度为 `unassessable`。题型未知时仅保留 `expression`，不得自创可绕过证据要求的维度。

每个 `evidence` 包含唯一 `id`、`source`、`source_id`、`locator`、`excerpt`。`source` 取 `prompt`、`answer`、`material` 或 `rubric`；`locator` 使用半开字符区间 `chars:start-end`，且截取结果必须与 `excerpt` 完全一致。`M1-P2`、`A-P1` 等段落号是展示标签或 `source_id`，不是机器 `locator`。

每个非数值 `check` 只含 `id/kind/subject/status/rule_entry_id/requirement/reason/score_effect/evidence_refs`，且 `score_effect` 恒为 `null`：

- 题干显式要求使用 `kind: requirement`；`subject` 取 `title/word_limit/format/genre/identity/other`，`status` 取 `satisfied/violated/uncertain/not_applicable`，`rule_entry_id` 为 `null`。`requirement` 必须逐字等于其引用的题干片段，并以 `subject + locator + excerpt` 对应一个锁定要求，同时引用答案证据。每个锁定要求恰有一个 check；同类别的多项要求及相同文字的不同出现位置须分别检查。
- 非加性外部规则使用 `kind: non_additive_rule`、`subject: external_rule`；`status` 取 `triggered/not_triggered/uncertain/unsupported`，`rule_entry_id` 指向 `non_additive`，`requirement` 必须逐字等于该规则原文，同时引用该规则与答案。每条 `non_additive` 恰有一个 check。

每个 `finding` 包含唯一 `id`、`type`、`criterion_id`、稳定 `counting_key`、所属维度、`judgment`、证据引用和解释。合法组合：

- `credit` 配 `full` 或 `partial`。
- `omission` 配 `missing`。
- `deduction` 配 `unsupported` 或 `misdirected`。
- `flag` 配 `uncertain` 或 `duplicate`。

每个 finding 还必须有 `scoring_units`。只要默认短题存在锁定评分点，无论 `full` 或 `limited`，内容维度中每个锁定点都须恰好对应一个 finding：`full=1/1`、`partial=1/0.5`、`missing=1/0`、`misdirected=1/0`、`uncertain=1/0.5`；不新占评分点的 `unsupported` 与 `duplicate` 为 `0/0`。没有锁定评分点、其他量表或其他维度一律为 `null`。

`duplicate` 只能引用先前已经 `full` 或 `partial` 命中的同一 `counting_key`。`full`、`partial` 与 `uncertain` 均须引用造成该判断的答案原句；`uncertain` 不能仅凭材料依据领取半个单位。findings 不含额外数值扣分；默认短题内容分或定性等级必须与全部 `scoring_units` 推导值一致，且每个主评分点须引用锁定时的精确材料证据。非默认量表的每个分项须引用该维度配置绑定的全部评分细则原文，每个 finding 至少引用其中一项。

结构化字段的机械权威为 `.agents/skills/shenlun-grader/scripts/validate_case.py` 与 `.agents/skills/shenlun-grader/scripts/validate_report.py`。可通过样例见 `.agents/skills/shenlun-grader/tests/test_grading_contract.py`。验证器能证明默认量表算分、外部等级边界、`full` 外部数值维度存在四源证据链、`limited` 非加性规则均有逐字 check、已锁定的题干要求逐项核销、来源定位、锁定后未删点以及已声明证据的一致性；不能完全理解任意自然语言题干或评分规则，不能证明所引材料在语义上确实支持分项，也不能证明材料语义抽取本身正确或锁定动作在现实时间上确早于阅读答案，故仍需盲测与人工复核。
