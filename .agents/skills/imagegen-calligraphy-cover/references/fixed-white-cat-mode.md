# 固定白猫居中模式

仅在 `white_cat_mode: fixed_centered_reference` 时读取。此模式锁定白猫本身，不锁定背景、题字或封面风格。

## 注册固定参考

- 路径：`/Users/jackson/Desktop/video-edit/video-resource/cover.png`
- SHA-256：`7fd8671fdadf5901cf008d35ffd010b34f30b95792aed304c1c7fe386b114282`
- 尺寸：`1672×940`
- 角色：白猫 identity、pose、silhouette、expression、clothing、satchel、pendant and anatomy reference

每次使用前以 `view_image` 查看，并核验真实文件的尺寸与 SHA-256。缺失、校验和变化、软链接替代或不可解码均停止。只有用户明确批准另一张固定参考时，才可记录新路径、尺寸与 SHA-256 并使用；不得静默回退到叙事模式或另一张白猫图。

## 形态锁

白猫必须与注册参考保持同一：

- 正面站姿、头身比例、外轮廓及尾巴弧线。
- 脸型、蓝眼、耳朵、鼻口、毛发体积和表情。
- 四肢位置与数量，双前爪、双后腿均完整可见。
- 白色服装、蓝色滚边、蓝色斜挎包、卷轴及猫头鹰吊坠的位置、形状和颜色关系。

仅允许把完整白猫作为一个整体平移和等比缩放。禁止重画、换姿、换表情、镜像、旋转、透视变形、横纵非等比缩放、裁切、遮挡、换装、增删配饰、让道具穿过身体，或把背景元素并入白猫轮廓。

## 画幅比例规则

先取注册参考中完整白猫的紧致包围框 `reference_bbox`，含耳尖、尾尖、四爪、挎包、卷轴和吊坠。按 `uniform_contain_reference_bbox_v1` 将其等比放入对应安全框：

| 画幅 | 安全框宽度/画布宽度 | 安全框高度/画布高度 | 白猫包围框中心 |
|---|---:|---:|---:|
| `16:9` | `0.40` | `0.84` | `(0.50, 0.50)` |
| `4:3` | `0.44` | `0.68` | `(0.50, 0.50)` |
| `9:16` | `0.84` | `0.64` | `(0.50, 0.50)` |

缩放公式为 `scale = min(safe_box_width / reference_bbox_width, safe_box_height / reference_bbox_height)`；横纵共用同一 `scale`。居中验收容差为横纵各 `±0.02` 画布比例。安全框是上限而非拉伸目标：一边先触边即停止放大，另一边保留空白。`4:3` 有意使用较小白猫，为四角、题字与叙事象征保留更多负空间。三画幅分别让 ImageGen 原生重构画布；不得从已通过画幅裁切、补边或拉伸。

## 场景与题字

- 白猫固定在几何中心且为第一视觉锚点。
- 背景、象征物、光色与空间秩序表达口播冲突；不得要求白猫表演动作或改变情绪。
- `16:9` 优先利用左右负空间；`4:3` 利用四角与上下负空间；`9:16` 利用白猫上方和下方空间。
- 题字及任何叙事元素不得覆盖脸、耳、尾、四肢、挎包、卷轴或吊坠，也不得贴边形成伪轮廓。

## 记录与 QA

每个画幅的 `white_cat_layout` 记录：

- `mode: fixed_centered_reference`
- `scale_policy: uniform_contain_reference_bbox_v1`
- 对应安全框宽高比例
- `center_x_ratio`、`center_y_ratio`
- `reference_form_preserved: true`

结构化 QA 还须有：

- `fixed_reference_form: pass`
- `geometric_centering: pass`
- `aspect_relative_scale: pass`

任一形态锁、中心容差、安全框、完整轮廓或等比缩放检查失败，整张图 rejected；只重做该画幅。
