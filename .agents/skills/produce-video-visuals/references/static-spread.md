# 图文翻书静态整图合同

只有已选择 `style_id: illustrated-flipbook`，且当前 v3 方向表、行和队列都绑定
`presentation_mode: illustrated-flipbook` 时，启用本合同。其他风格保持原路线要求。
此入口使用 `knowledge-video-static-spread-v1`，不复活任何已退役 Ian static 合同。
机械唯一权威为 `leverage-video/src/shared/visual-assets/static-spread-contract.mjs`；
呈现策略来自 `leverage-video/src/shared/flipbook-video/profile.mjs` 的精确快照。

## 输入和生成

保留准确 scene class，按语义使用 `ian-handdrawn-ppt` 或 `imagegen`。每镜一张完整
16:9 PNG，`state_count_total: 1`、`state_index: 0`，无依赖、透明分层、动作变体、
入场状态或镜内转场。正文镜头始终 `white_cat_present: false`。发布封面继续独立流程。
`static_spread` 只含合同版本、完整锁稿 `source_text`、UTF-8 `source_text_sha256`；
图中短标签继续服从原 v3 文字批准，完整书页正文不能冒充图中短标签。

生成前仍运行现有工作区、分镜审批、队列和尝试次数门禁。静态校验重读风格选择、
profile 快照与 v3 审批文件，核实文件 SHA-256、map SHA-256、当前行、路由及锁稿。
`standard`、`rich` 表示信息密度与图解细节；不得据此增造姿态或图层。

两条路线均不预留字幕安全区；必要页边与防裁切留白按构图决定。Ian 只继承既定色盘、
亮度和留白风格，并使用其唯一规范风格参考作为真实输入。静态 Ian 直接使用完整图的
普通生成能力，不进入 layered-scene v2 的无字母版、切层和 23% 字幕带流程。
必须保留生成模型与实际参考输入的路径及 SHA-256；不得用代码绘图代替图像生成。

生产提示词须逐字包含共享模块导出的 `STATIC_SPREAD_PROMPT_MARKERS`：

```text
16:9 landscape composition
PRESENTATION MODE: illustrated-flipbook.
WHITE CAT: absent; no cat anywhere in the body illustration.
STATIC IMAGE: one complete image; no transparent layers or animation states.
SUBTITLE SAFE AREA: none; do not reserve a bottom subtitle band.
```

## QA 与审批

完整解码源 PNG，尺寸相对 16:9 偏差不得超过 0.5%。最终书页 `contain` 直接消费
批准源图，不缩放裁切为另一个构图。实际 1920×1080 视频中图片显示为 708×398.25
逻辑像素；用 `buildStaticSpreadReadabilityPreview` 派生 708×399 PNG 供精确半页审图。
检查完整源图与半页图，确认无猫、图中文字准确且可读、图意清晰、无裁切；不靠缩小
字体解决超载，退回语义拆镜。生成或 QA 失败仍沿用三次失败暂停规则。

QA JSON 保存于工作区 `schema/`，使用 `knowledge-video-static-spread-qa-v1`，含现有 `asset_id`、`result`、
`technical_qa`、`semantic_qa`、`visible_text_qa`、`style_qa`、`visual_qa`，以及：

- `output`、`prompt`：精确 `{path, checksum_sha256}`；`static_spread` 与行逐字相同；
- `white_cat_present: false`，`actual_reference_inputs` 为真实参考绑定；
- `visible_text_qa.mode/exact_text` 等于 v3 图中短标签批准；
- `half_page_readability`：`display_width_px: 708`、`display_height_px: 398.25`、
  `fit: contain`、`text_readable: true`、`no_crop: true`、`observed_white_cat_present: false`、
  `reviewed_source_checksum_sha256` 和 `preview: {path, checksum_sha256}`。

用 `record-generated-static-spread-qa.py <episode-workspace> <asset-id> <qa-path> --qa-time <ISO>`
写入现有队列。它从磁盘重验源图、提示词、QA、参考、profile、方向批准和确定性半页图，
只记录 QA；不生成用户批准。`static_spread_review` 把 QA、提示词、原文与半页图绑定入
现有整批/一键最终审核。严格单图呈现时记录 `presented_static_spread_review`；批准另绑定 `approved_static_spread_review`。严格单图批准、整批批准及视觉锁定再次核磁盘字节，任一变更
即失效。静态 Ian 不要求累计图层接触表；最终审核展示完整源图及半页可读性证据。
