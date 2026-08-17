# FullFrameMaskSweep

一个可复用的 Remotion 整图遮罩组件：图片保持不动，一个与当前画布同尺寸的遮罩从左向右移动，最后完整图片固定停留 3 秒。

## 时长规则

```text
分镜时长 > 3 秒：
  遮罩滑动帧数 = 当前分镜总帧数 - round(fps × 3)
  完整图片停留帧数 = round(fps × 3)

分镜时长 ≤ 3 秒：
  遮罩滑动帧数 = 0
  完整图片从第 0 帧显示到分镜结束
```

3 秒及以下的分镜不会创建遮罩动画，直接按实际分镜时长显示完整图片。只有非正数、非整数帧数或无效 fps 才会报错。

## 用法

```tsx
import {Sequence, staticFile} from 'remotion';
import {FullFrameMaskSweep} from './shared/full-frame-mask-sweep';

const shotDurationInFrames = 240;

<Sequence from={120} durationInFrames={shotDurationInFrames}>
  <FullFrameMaskSweep
    src={staticFile('topic3/assets/image/s15-ian-v01-1920x1080.png')}
    durationInFrames={shotDurationInFrames}
  />
</Sequence>;
```

必须把同一个 `shotDurationInFrames` 同时传给 `Sequence` 和组件。不要传整集 composition 的时长。

组件自动读取当前 Remotion composition 的 `fps`、`width` 和 `height`，因此遮罩和图片会使用当前画布的完整尺寸。默认背景色为 `#fbfaf7`，可通过 `backgroundColor` 修改。
