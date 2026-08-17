# GEN-THINK 共享循环镜头 v01

## 当前状态

- 五张源图已按用户消息 `批准 GEN-THINK 五图` 批准精确字节。
- `topic3` 现有 37 张图片未获批准，本共享镜头不解锁或推进 `topic3` 装配。
- 消费分镜数量仍为 `0`；由用户决定哪些分镜使用以及各自准确帧区间。
- 所有 GEN-THINK 资产、代码、清单和 QA 证据均位于 `leverage-video/src/shared/gen-think`。

## 循环合同

循环顺序固定为：

`master-v04 → action-01-v01 → action-02-v02 → action-03-v01 → action-04-v01 → master-v04`

- 首张母图直接完整显示；其后每个相邻状态边界均用 `intra-shot-watercolor-bloom-v1` 进入：0.6 秒（30 fps 下 18 帧）暖色彩墨落纸、炸开、沿纸纤维渗散并显图。
- 可见颜料固定使用藤黄／蜜金／浅赭、杏黄／珊瑚橙／琥珀、鹅黄／暖橙／淡朱砂三组暖色；中心浓、外缘透明，积色边与主体同色，禁止灰、黑或中性色可见墨边。
- 泼墨只揭示批准图原字节对应的 1920×1080 派生图；使用共享 `WatercolorImageSequence` 的确定性 SVG 墨核、墨瓣、纸纤维扩散与飞溅，不绘制放射渗流线，不生成中间图，不使用交叉淡化、morph、光流或插帧。
- 调用方传入 `durationInFrames`；时长先向下规范为整数帧。
- 最短时长为 `5` 帧，确保五个批准状态至少各出现一次。
- 较长时长只增加完整五状态循环，每个状态目标停留不超过约 `1.5` 秒。
- 非整除时长把余帧从前往后均匀分配，最终覆盖准确目标帧数，无空洞、无越界。

## Remotion 入口

- 独立入口：`leverage-video/src/shared/gen-think/script/index.ts`
- Composition ID：`GenThinkLoop`
- 组件：`leverage-video/src/shared/gen-think/script/GenThinkLoop.tsx`
- 时长算法：`leverage-video/src/shared/gen-think/script/timing.ts`
- 测试：`leverage-video/src/shared/gen-think/script/timing.test.ts`
- 转场契约测试：`leverage-video/src/shared/gen-think/script/watercolor-contract.test.mjs`
- 固定画布：`1920×1080`、`30 fps`、横屏 `16:9`。
- 默认预览：`300` 帧，即 `10` 秒、两次完整循环。

独立渲染示例：

```bash
npx remotion render \
  src/shared/gen-think/script/index.ts \
  GenThinkLoop \
  src/shared/gen-think/assets/video/gen-think-loop-custom.mp4 \
  --props='{"durationInFrames":451}' \
  --codec=h264 \
  --muted \
  --concurrency=1 \
  --browser-executable='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
```

被其他 composition 使用时，直接导入 `GenThinkLoop`，并把该消费窗口的准确帧长同时传给外层 `Sequence` 和组件的 `durationInFrames`。具体消费分镜必须等待用户指定。

## 最终预览与 QA

- 视频：`leverage-video/src/shared/gen-think/assets/video/gen-think-loop-preview-10s-v09.mp4`
- SHA-256：`4572713e6ffb66ce049f46a15391722993d2367c73cc9aae2706a611e90e473f`
- 规格：H.264、`1920×1080`、30 fps、300 帧、10.000 秒。
- 音频流：`0`；字幕流：`0`；BGM disabled。
- 全片解码：通过；黑帧检查：未发现。
- 泼墨转场接触表：`leverage-video/src/shared/gen-think/assets/image/gen-think-loop-preview-watercolor-contact-sheet-v09.png`
- 第 39 帧独立重复渲染 SHA-256 均为 `faad2a6a73cd08d0a5b716734cc7e6cffcb64e5315588c81edb3bae546c462d1`，确定性一致。
- 非整除时长证据：`451` 帧 composition 的第 `450` 帧已成功渲染。
- 历史 `v07`、`v08` 预览均保留，未覆盖；已锁定 `topic3` 未重渲。

生产清单：`leverage-video/src/shared/gen-think/schema/gen-think-production-v01.json`
