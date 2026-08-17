# GEN-THINK 共享循环镜头五图整批审批 v01

## 审批范围

- 审批对象：`GEN-THINK` 共享可复用视觉族的五张 AI 源图原字节。
- 共享库：`leverage-video/src/shared/gen-think`。
- 分类：`project_maintenance`；不归属于任何单一期 episode。
- 使用映射：本批次不决定应用到哪些分镜；消费分镜与准确帧区间由用户另行决定。
- 循环要求：`master → action-01 → action-02 → action-03 → action-04 → master`；五张批准状态图字节不变，每张图均以 0.4 秒 Fade 进入。
- 当前门禁：五张原图获批前，不创建 1920×1080 派生图，不实现 Remotion 组件，不生成过渡视频。
- 本文只审批下列五张原图；接触表仅为总览辅助，不是审批对象。

## 接触表总览

排列顺序：上排从左到右为母图、动作 01、动作 02；下排从左到右为动作 03、动作 04。

![GEN-THINK 五状态接触表](../assets/image/gen-think-review-sheet-v01.png)

- 接触表路径：`leverage-video/src/shared/gen-think/assets/image/gen-think-review-sheet-v01.png`
- 接触表 SHA-256：`ac0d039e4d75ad8bd579b1c79ec26d69f8bd48725e3f628fdc529bfc27ce1740`
- 注意：接触表经过缩放和排版，仅用于观察动作连续性。正式审批以以下五张原图路径及 SHA-256 为准。

## 五张原图

### 1. GEN-THINK-master-v04

![GEN-THINK master v04](../assets/image/gen-think-master-v04.png)

- 角色：静止母图；两只前爪、两只后爪全部落地。
- 路径：`leverage-video/src/shared/gen-think/assets/image/gen-think-master-v04.png`
- SHA-256：`d3a3f7a146cb44eb4aa571bf73e7cc80c8bf0492dc35ac3c41fc3425b6595093`
- 尺寸：`1672×940`；相对 16:9 误差 `0.053191%`，通过 `≤0.5%` 门禁。

### 2. GEN-THINK-action-01-v01

![GEN-THINK action 01 v01](../assets/image/gen-think-action-01-v01.png)

- 动作：头部轻微偏转并抬高目光；四爪接触保持稳定。
- 路径：`leverage-video/src/shared/gen-think/assets/image/gen-think-action-01-v01.png`
- SHA-256：`fa3f9551d627597de601cc22bf0744f4afb91526c9b28f9036de258f9baff505`
- 尺寸：`1672×940`；相对 16:9 误差 `0.053191%`，通过 `≤0.5%` 门禁。

### 3. GEN-THINK-action-02-v02

![GEN-THINK action 02 v02](../assets/image/gen-think-action-02-v02.png)

- 动作：一只前爪沿短弧抬到胡须下缘；另一只前爪和两只后爪保持落地。
- 路径：`leverage-video/src/shared/gen-think/assets/image/gen-think-action-02-v02.png`
- SHA-256：`8febdc5675db8950ac94744b30c5079a7483877ffe88dfc40aa385240808fca4`
- 尺寸：`1672×940`；相对 16:9 误差 `0.053191%`，通过 `≤0.5%` 门禁。

### 4. GEN-THINK-action-03-v01

![GEN-THINK action 03 v01](../assets/image/gen-think-action-03-v01.png)

- 动作：保持同一前爪托腮，眉眼收紧，躯干轻微前倾。
- 路径：`leverage-video/src/shared/gen-think/assets/image/gen-think-action-03-v01.png`
- SHA-256：`fb5c85763ff5f81de0b3edfc5a9f0473f3b4601895503fde7d85d2fbca161030`
- 尺寸：`1672×940`；相对 16:9 误差 `0.053191%`，通过 `≤0.5%` 门禁。

### 5. GEN-THINK-action-04-v01

![GEN-THINK action 04 v01](../assets/image/gen-think-action-04-v01.png)

- 动作：托腮前爪回落到母图落点，头部和肩胸打开，准备闭环回到母图。
- 路径：`leverage-video/src/shared/gen-think/assets/image/gen-think-action-04-v01.png`
- SHA-256：`27935232ce09f71d881f7436653d2df331e2fb44c0487ccf5c9606400bc07f26`
- 尺寸：`1672×940`；相对 16:9 误差 `0.053191%`，通过 `≤0.5%` 门禁。

## 内部 QA 结论

- 五张图均为 PNG，可完整解码，尺寸一致，满足 16:9 横构图误差门禁。
- 每张图均保持一只白猫、两条前肢、两条后肢和四只可追踪爪；无第三前爪。
- 身份特征、衣袍、前胸背带、解剖学右侧蓝包、纸莎草卷和猫头鹰挂件保持。
- 画面无可见文字、伪文字、问号、灯泡、对白框或水印。
- 相邻状态的动作方向、支撑点、重心与因果顺序通过人工逐帧审查；`action-04 → master` 可由前爪回落和表情放松闭合。
- 动作子图均由同一未改母图加 canonical v2 身份图独立生成，没有使用子图接子图。
- 内部拒绝版本保留在共享库并记录于审查清单，不属于本次审批对象。

## 审批操作

- 若批准以上五张原图的精确字节，请回复：`批准 GEN-THINK 五图`。
- 若需要修改，请写明资产 ID 与修改意见，例如：`GEN-THINK-action-03-v01：……`。
- 本审批与 topic3 现有 37 张图片整批审批相互独立；批准本批不会自动批准那 37 张，反之亦然。

审查清单：`leverage-video/src/shared/gen-think/schema/gen-think-review-v01.json`
