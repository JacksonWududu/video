# 完整封面策划与提示词

## 来源契约

记录：

- 主题词原文：`<EXACT_THEME_WORDS>`
- 口播稿：`<APPROVED_NARRATION_PATH_OR_TEXT>`
- 白猫角色参考：`<APPROVED_CAT_REFERENCE>`
- 风格模式：`open_unconstrained / approved_style_reference`
- 已批准视觉风格：`<APPROVED_STYLE_OR_NULL>`
- 目标画幅：`<ASPECT_RATIO>`

`$run-knowledge-video` 的视频风格选择前封面固定为 `open_unconstrained`，此时 `APPROVED_STYLE_OR_NULL = null`，style reference 数量必须为 `0`。白猫身份参考不属于风格参考。

知识视频主流程须分别以 `16:9`、`9:16`、`4:3` 填写并执行本契约。三个画幅各自原生构图、独立生成、独立 QA；不得从另一画幅裁切、补边或拉伸取得。

## 从口播到封面

填写且只选一个主命题：

- 大众痛点：`<PAIN>`
- 核心冲突：`<CONFLICT>`
- 观众价值：`<PAYOFF>`
- 视觉隐喻：`<ONE_SYMBOLIC_PAIR_OR_SCENE>`
- 白猫动作：`<ONE_ACTION>`
- 白猫情绪：`<ONE_EMOTION>`
- 封面命题：`<WHO + CONFLICT + REASON_TO_CLICK>`

逐项检查其能否在口播稿中找到直接依据；找不到便删除，不得自行扩写新论点。

## 完整生成提示词骨架

```text
Use case: ads-marketing
Asset type: <ASPECT_RATIO> knowledge-video cover

Source contract:
- Exact visible theme words: “<EXACT_THEME_WORDS>”.
- Narration-derived audience pain: <PAIN>.
- Narration-derived central conflict: <CONFLICT>.
- Audience payoff: <PAYOFF>.

Input images:
- Image 1 is the approved white-cat identity and character reference. Preserve face, white fur, blue eyes, proportions and canonical accessories.
- Image 2 is the approved visual-style reference. <Use only in approved_style_reference mode; omit in open_unconstrained mode.>
- Image 3 is the edit target. <Use only when revising an existing clean cover.>

Style mode: <STYLE_MODE>. In open_unconstrained mode, invent the strongest narration-grounded visual treatment freely; do not imitate, inherit, or name any preset video style.

Primary request: Create a complete cover, not a typography sample. Make the white cat the main narrative anchor. Show the cat <ONE_ACTION> with <ONE_EMOTION> inside <ONE_SYMBOLIC_PAIR_OR_SCENE>, so the image clearly expresses <CONFLICT> and gives viewers a reason to click.

Composition: adapt specifically to <ASPECT_RATIO>; establish a single focal hierarchy: white cat, conflict, exact title. Preserve platform safe margins and thumbnail legibility.
Typography: integrate the exact title as part of the artwork; use the separately defined calligraphy and character-accuracy contract.
Constraints: exactly one white cat unless requested otherwise; correct anatomy; no generic standing-and-smiling pose; no unrelated symbols; no extra text; no logo; no watermark.
Avoid: generic poster unrelated to the narration, crowded concept collage, mascot sticker placement, malformed Chinese, cheap martial-arts or restaurant-signage styling.
```

## 画面验收

回答：

1. 不看标题，能否看出核心冲突？
2. 白猫动作是否承载口播含义，而非只作装饰？
3. 每个主要象征物是否能回溯到口播稿？
4. 画面是否回应痛点或承诺价值，而非只说明主题名称？
5. 缩小为手机列表缩略图后，白猫、冲突和标题是否仍依次可见？
6. 去除标题与原题材后，能否清楚描述并迁移媒介、笔触、色板、光线、边缘、纹理、造型、留白与情绪？
7. 风格是否避免依赖封面原场景、标题字形或专属文案？

任一答案为否，整图不得作为正式封面。
