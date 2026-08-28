# 题字子契约与逐字 QA

本参考只负责完整封面提示词中的题字部分；不得以此替代主题词、口播稿和白猫角色驱动的封面策划。

## 生成前契约

记录：

- 原文：`<EXACT_TITLE>`
- 有序字符：`<CHARACTER_LIST>`
- 部件约束：`<CHARACTER_COMPONENTS>`
- 画幅：`<ASPECT_RATIO>`
- 图片角色：edit target / typography-style reference
- 禁止额外文字：是

## 加入完整封面提示词的题字块

```text
Integrate the exact title “<EXACT_TITLE>” directly into the complete cover artwork as original Chinese brush calligraphy.
Text (verbatim): “<EXACT_TITLE>”

MANDATORY CHARACTER ACCURACY:
- Exact ordered character list: <CHARACTER_LIST>.
- Structural requirements: <CHARACTER_COMPONENTS>.
- Render every repeated character separately and correctly.
- No invented strokes, variant substitutions, duplicated marks or other text.

Typography: authentic brush texture with controlled dry-brush gaps; expressive but fully legible; match the narration-derived conceptual contrast without deforming character structure.
Composition: adapt specifically to <ASPECT_RATIO>; preserve safe margins; keep the title clear of the white cat's face, ears and action.
Constraints: no banner, box, outline, glow, sticker, seal or subtitle unless requested.
Avoid: malformed Chinese characters, martial-arts clichés, festive signage, exaggerated splatter, cheap red-and-gold styling.
```

## 逐字验收

按原文顺序建立表内检查，不可凭整体语义猜字：

| 序号 | 目标字符 | 结构要求 | 观察结果 | 判定 |
|---|---|---|---|---|
| 1 | `<CHAR>` | `<RADICAL + COMPONENT>` | `<OBSERVED>` | pass / reject |

检查每字：

1. 偏旁是否正确。
2. 主体部件是否正确。
3. 是否缺笔、多笔、粘连或断裂。
4. 是否被狂草化到无法唯一辨认。
5. 同字重复出现时，每处是否分别正确。
6. 拉丁字母大小写、数字和标点是否准确。
7. 是否出现原文之外的文字或符号。

任一项为 reject，整图不得交付为可用封面。

## 示例：酒神 VS 日神

- 原文：`酒神 VS 日神`
- 有序字符：`酒`、`神`、`V`、`S`、`日`、`神`
- `酒`：左部 `氵`，右部 `酉`
- 两个 `神`：左部 `礻`，右部 `申`；须分别核对
- `V`、`S`：均为大写
- `日`：封闭外框，中间一横；不得写成 `目`、`白` 或伪字
