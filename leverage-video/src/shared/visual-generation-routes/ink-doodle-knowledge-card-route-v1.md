# ink-doodle-knowledge-card-route-v1

`ink-doodle-knowledge-card` 是知识视频的显式可选结构化栅格路线。它调用 `$generate-visual-styles`，锁定 `ink-doodle-knowledge-card`（墨线知识卡）配置，并取代 `doodle-slides` 在新建或修改分镜中的可选位置；Ian 仍是结构图默认推荐。

## 选择契约

- 仅兼容 `structured_graphic`，禁止白猫。
- `treatment_profile_id` 必须为 `ink-doodle-knowledge-card`，结构所解析的布局不得落入 treatment-layout 矩阵的 `avoid`。
- `visible_text_mode` 可为 `none` 或 `required`；`required` 只允许当前 v3 行批准的精确中文、数字、符号及位置，禁止新增标题、标签、伪文字、签名、Logo 或水印。
- 每镜必须在 `per-shot-visual-direction-review-v3` 中显式选择；不得由“继续”“默认”或后续审核推断。
- `doodle-slides` 仅保留历史只读解析，不得出现在新建或修改分镜的兼容、推荐或选择列表中。

## 生产契约

- 生产前重读并校验路线目录钉住的 `$generate-visual-styles` Skill 与配置文件 SHA-256；任一字节变化即停止，并重建路线目录校验和与逐镜审核映射。
- 使用 `$generate-visual-styles` 的 `ink-doodle-knowledge-card` 配置，并依其 `imagegen` 路径逐张生成；不得用普通图标、SVG、HTML、纸纹覆盖或 Remotion 重绘冒充。
- 每个状态分别生成与审核。提示词须锁定结构、事实、原文、信息层级、主体身份、布局、安全区与禁用项；用户锁定文字必须逐字一致。
- 画面须为 16:9 米白纸黑墨知识卡：粗笔标题、钢笔速写、三至五个信息簇、语义手绘箭头、充足留白；文字存在时优先保证准确、清晰与完整。
- 最终审核对象须为 1920×1080 PNG。若生成源尺寸不同，只能先制作非破坏性规范化派生图，再把该派生图作为新的精确字节审核对象；未审核源图不得进入合成。
- 每项资产记录 `codex-native-imagegen`、最终 PNG SHA-256、尺寸、锁定提示词及校验和、全部参考图校验和，以及 Skill/配置文件钉住校验和。
- 多状态镜头沿用 `intra-shot-watercolor-bloom-v1`；本路线没有专属镜间转场推荐，使用共享语义回退并进入逐边界审核。

## 组装契约

- Remotion 以无 Ian 遮罩扫动的 `GraphicScene` 消费已批准完整栅格序列；不得重绘、加字或重组画面。
- 组装必须拒绝非 PNG、非 1920×1080、未审核、提示词/参考/配置绑定缺失、可见文字不符或校验和陈旧的资产。
