# xuan-paper-diorama-route-v1

`xuan-paper-diorama` 是知识视频的显式可选叙事栅格路线。它调用外部 `$generate-visual-styles`，并锁定其 `xuan-paper-diorama`（宣纸微缩叠景）配置；不改变默认 `imagegen` 推荐。

## 选择契约

- 仅兼容 `narrative_illustration`。
- 可保留白猫，但必须把 canonical 白猫图作为真实身份参考；具名历史人物也必须使用相应身份/时代参考，白猫不得替代事实主体。
- `visual_structure_id` 只可使用叙事结构；`treatment_profile_id` 必须是 `xuan-paper-diorama`，且对应布局不得为目录中的 `avoid`。
- `visible_text_mode` 固定为 `none`；禁止标题、标签、招牌、伪文字、签名、Logo 与水印。
- 每镜必须在 `per-shot-visual-direction-review-v3` 中显式选择；不得由“继续”“默认”或后续审核推断。

## 生产契约

- 生产前重读并校验路线目录所钉住的 Skill 与配置文件 SHA-256；任一字节变化即停止，并重建路线目录校验和与逐镜审核映射。
- 通过 `$generate-visual-styles` 使用 `xuan-paper-diorama` 配置，再由其规定的 `imagegen` 路径生成；不得仅给普通插画叠加纸纹冒充此路线。
- 每个 master/action 状态分别生成与审核。输入必须锁定主体身份、动作方向、时代、建筑、景深层次、前中后景因果和无文字要求。
- 画面须为 16:9 宣纸微缩世界：四至七个可辨深度层、纤维纸边、折痕、叠层缝隙、可信接触阴影、暖纸中性色和一个克制矿物色点睛。
- 最终审核对象须为 1920×1080 PNG。若生成源尺寸不同，只能先制作非破坏性规范化派生图，再把该最终派生图作为新的精确字节审核对象；未审核源图不得直接进入合成。
- 每个资产记录 `codex-native-imagegen`、最终 PNG SHA-256、尺寸、锁定提示词及校验和、全部参考图校验和，以及 Skill/配置文件的钉住校验和。
- 多状态镜头沿用 `action-state-schedule-v2` 与相邻状态 `intra-shot-watercolor-bloom-v1`；本路线没有专属镜间转场推荐，使用共享语义回退并进入逐边界审核。

## 组装契约

- Remotion 把它作为 `NarrativeScene` 的已批准完整栅格序列消费；不得重绘、加字或重组纸层。
- 组装必须拒绝非 PNG、非 1920×1080、未审核、提示词/参考/配置绑定缺失或校验和陈旧的资产。
