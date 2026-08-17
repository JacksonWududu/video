---
name: srt-whiteboard-animation
description: "Use only when a knowledge-video shot has the explicitly approved visual_generation_route srt-whiteboard-animation and needs a frame-locked whiteboard source, annotation preview, or silent MP4. 中文：仅用于已明确批准 srt-whiteboard-animation 路线的知识视频镜头，制作或验证白板源图、标注预览与静音逐帧 MP4。"
---

# SRT Whiteboard Animation（项目适配版）

此 Skill 只执行知识视频既有音频定时分镜中的单镜白板素材生产。不得自行解析 SRT、拆幕、合并 MP4、启动或操作浏览器，也不得使用 Computer Use。

## 前置条件

- 已解析唯一 episode workspace，且活动分镜、旁白、逐镜视觉方向和路线选择均已锁定。
- 当前镜头须为 `white_cat_present: false`，`scene_class` 仅可为 `narrative_illustration` 或 `structured_graphic`，且 `visual_generation_route` 精确为 `srt-whiteboard-animation`。
- 源图由 ImageGen 生成：暖米黄纸张、深灰线条、少量红橙蓝点缀、横版，距 16:9 的相对误差不超过 `0.5%`。批准后按共享栅格规则归一化为 `1920×1080`。
- 叙事白板禁止可见文字。新建或修改的结构白板直接使用上游同名枚举 `visible_text_mode: required`，只可使用 v3 分镜已批准的精确中文与位置，并须先经 `whiteboard-exact-text-overlay-v2` 和 `overlay_exact_text.py` 确定性叠加，再把所得 PNG 作为源图审批对象；禁止图像模型自行拼写。

## 单项三级审批

同一 `visual_asset_review.queue[]` 项必须严格依次完成：

1. `source_image_review`：展示并批准源 PNG 精确字节。
2. `annotation_review`：展示并批准 `whiteboard-annotation-v2` JSON 与区域预览 PNG 的精确字节。
3. `clip_review`：展示并批准 `whiteboard-render-evidence-v1` 绑定的静音 MP4 精确字节。

三者皆批准后，队列项总体状态方可为 `approved`，下一素材方可解锁。修改某步时，只回滚该步及其后续派生物。批量审批不得绕过此顺序。

表演型人物或动物采用 `whiteboard-element-sequence-replaces-action-family-v1`：只生成一张已批准全景图，再按元素顺序绘制；仅此路线豁免 `action-state-schedule-v2` 的多图状态族及 `intra-shot-watercolor-bloom-v1`。普通镜间边界仍须执行已批准的 `scene-transition-v3` 决定。

## 标注与渲染

- 新工作以 [whiteboard-annotation-v2.schema.json](references/whiteboard-annotation-v2.schema.json) 与 [whiteboard-render-evidence-v1.schema.json](references/whiteboard-render-evidence-v1.schema.json) 为机器接口。v2 直接使用 `none | required`，并强制记录 repository-root-relative v3 review 路径、文件 SHA-256、`presented_map_sha256`、shot ID、精确文字与位置。旧 [whiteboard-annotation-v1.schema.json](references/whiteboard-annotation-v1.schema.json) 仅供完成且未改的历史证据只读解析，不能生成 preview 或 clip。
- 标注必须通过 `scripts/validate_whiteboard_annotation.py`；验证器会从 episode workspace 重读 v3 工件，并与固定 `schema/episode-state.json` 中当前已批准的 `artifact_path`、`artifact_checksum_sha256`、`presented_map_sha256` 指针及逐镜字段比较，不接受 annotation 自报的“approved”文字或旧 v3 工件。所有 workspace 内路径必须 repository-root-relative。画布固定 `1920×1080`、帧率固定 `30`；区域和保护区均为画布内整数坐标；元素按 `sequence` 串行、不重叠；字幕跨度须精确回指锁稿；底部字幕安全区不得被绘制元素侵入；完整画面最终停留不少于 15 帧。
- 区域预览只用 `scripts/render_annotation_preview.py` 生成静态 PNG，并在对话中展示审批。
- 成片只用 `scripts/render_whiteboard_clip.py`。输出必须为 `1920×1080`、30 fps、H.264、无音轨、帧数等于镜头帧数；不得延长镜头。
- 运行时使用本 Skill 的 `.venv/bin/python`。依赖固定为 `opencv-python-headless==5.0.0.93`、`numpy==2.5.1`、`Pillow==12.3.0`；不得运行时自动安装，不得安装或回退到 PyAV。只用已有系统 ffmpeg。

```bash
.agents/skills/srt-whiteboard-animation/.venv/bin/python \
  .agents/skills/srt-whiteboard-animation/scripts/overlay_exact_text.py \
  --episode-workspace <episode-workspace> \
  <input.png> <whiteboard-exact-text-overlay-v2.json> <output.png> <overlay-evidence.json>

.agents/skills/srt-whiteboard-animation/.venv/bin/python \
  .agents/skills/srt-whiteboard-animation/scripts/validate_whiteboard_annotation.py \
  --episode-workspace <episode-workspace> \
  <annotation.json>

.agents/skills/srt-whiteboard-animation/.venv/bin/python \
  .agents/skills/srt-whiteboard-animation/scripts/render_annotation_preview.py \
  --episode-workspace <episode-workspace> \
  <normalized.png> <annotation.json> <preview.png>

.agents/skills/srt-whiteboard-animation/.venv/bin/python \
  .agents/skills/srt-whiteboard-animation/scripts/render_whiteboard_clip.py \
  --episode-workspace <episode-workspace> \
  --source-image <approved-source.png> \
  --normalized-image <approved-normalized-1920x1080.png> \
  --annotation <approved-annotation.json> \
  --preview <approved-preview.png> \
  --output <silent-whiteboard.mp4> \
  --evidence <whiteboard-render-evidence-v1.json>
```

## 组装与换音色

Remotion 只用共享 `WhiteboardScene` 通过 `OffthreadVideo` 消费已批准 MP4。换音色版本必须保持源图、归一化图、v2 标注、预览与 MP4 字节不变；依据标注元素的 `subtitle_span` 建立逐段 `trim/playbackRate` 映射，禁止全镜头统一缩放。

上游来源、许可和保留文件哈希见 [references/upstream-provenance.md](references/upstream-provenance.md)。
