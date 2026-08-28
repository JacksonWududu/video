---
name: imagegen-calligraphy-cover
description: "Use when generating or revising a complete knowledge-video publishing cover with ImageGen from three bound sources: the exact theme words, the approved narration script, and the approved white-cat character reference. Supports the run-knowledge-video pre-style open/unconstrained cover stage, independent 16:9, 9:16, and 4:3 composition, delegated structured QA, direct ImageGen calligraphy, character-by-character text validation, and rejection or regeneration of any semantically weak, off-character, misspelled, or non-transferable result."
---

# ImageGen 白猫知识视频封面

生成完整封面，而非只生成字体。主题词决定标题，口播稿决定封面所讲之事，白猫承担角色、情绪与动作；毛笔题字只是最终构图的一部分。

## 三项强制输入

生成前锁定：

1. **主题词**：用户要求封面显示的准确原文。
2. **口播稿**：优先使用已批准或锁定版本，不以旧稿、摘要或模型记忆替代。
3. **白猫角色参考**：使用已批准角色图；保持脸型、毛色、蓝眼、体态及标志性配饰。主题服装或道具仅在口播稿、已批准视觉方向或用户要求支持时加入。

先在明确的单一项目工作区内寻找现有批准输入；仍缺任一项时，停止生成并向用户索取。不得只凭主题词制作泛化海报。

## 执行流程

### 1. 建立来源契约

- 记录主题词原文、口播稿路径或全文、白猫参考路径与各自角色。
- 使用本地图片前先以 `view_image` 查看。
- 遵守项目既有审批状态、比例和保存规则；不得把未批准草图当角色参考。
- 在 `$run-knowledge-video` 的 Gate 2 后、视频风格选择前，固定使用 `style_mode: open_unconstrained`：不得读取、继承或绑定任何预设视频风格、风格图或历史集风格。独立修订封面时，只有用户或上游已明确批准视觉风格，才可把它作为可选 style reference。
- 调用 ImageGen 前读取并遵循 `$imagegen`。

### 2. 从口播稿提炼封面命题

完整阅读口播稿，提炼：

- 开头钩子对应的大众痛点。
- 全稿唯一的核心冲突或反差。
- 观众看完可获得的认知、选择或行动价值。
- 最能代表主题的一组视觉隐喻。
- 白猫应呈现的单一动作与情绪。

将其压缩为一句封面命题：`谁在什么矛盾中，观众为何要点开`。封面只表达一个核心冲突，不堆叠整篇口播的所有概念。

生成前完整读取 [cover-brief-and-prompt.md](references/cover-brief-and-prompt.md)，建立来源到视觉的映射。

### 3. 设计完整画面

- 让白猫成为第一视觉锚点，不做无关吉祥物或角落贴纸。
- 以姿势、视线、表情和道具表现口播稿中的冲突；避免仅让白猫站立微笑。
- 背景、色彩、光线和象征物均须可回溯到口播稿或已批准视觉方向。
- 主题双方对立时，用构图、光色、空间秩序和猫的处境形成冲突，不依赖大字解释一切。
- 保持缩略图层级：白猫、主题冲突、题字；其余细节退后。

### 4. 建立题字契约

- 将主题词拆成有序字符清单，包括中文、拉丁字母、数字和标点。
- 对易错字写出部件约束。例如：`酒 = 氵 + 酉`，`神 = 礻 + 申`。
- 同字多次出现时逐个编号并分别验收。
- 若采用毛笔字，风格不得破坏字形结构；不得暗中改用程序字体叠字。

生成前完整读取 [prompt-and-text-qa.md](references/prompt-and-text-qa.md)，使用逐字门禁。

### 5. 使用 ImageGen 生成

- 新建封面时，将白猫图标为 identity and character reference；视觉风格图另标为 style reference。
- 修改已有无字底图时，将其标为 edit target；白猫参考仍单独绑定身份。
- 每个画幅单独调用一次。16:9、9:16 与 4:3 均须重新安排标题、白猫和象征物，不得以裁切、补边或拉伸代替原生构图。
- 将主题词、口播命题、痛点、观众价值、白猫身份、动作、场景隐喻、文字部件及禁用项同时写入提示词。
- 已通过 QA 的另一画幅只可作 composition or typography-style reference，不自动批准新画幅。

### 6. 五层 QA

逐层检查；任一层失败，整图 rejected：

1. **口播一致性**：封面表达的是口播稿核心冲突，不是仅与题目有关的泛化图。
2. **白猫一致性**：身份、毛色、蓝眼、体态、配饰、肢体数量及角色气质正确；仅一只白猫，除非用户明确要求多角色。
3. **题字准确性**：按字符清单逐字核对偏旁、主体、缺笔、多笔、粘连、顺序、大小写及额外文字。含混即错误。
4. **封面有效性**：缩略图可读，视觉焦点唯一，主体不被标题遮挡，平台安全区成立，无廉价武侠、餐饮招牌、贴纸描边或过度装饰感。
5. **风格可迁移性**：媒介、笔触、色板、光线、边缘、纹理、造型、留白与情绪可被描述并迁移到正文画面；不得依赖标题字形、封面原题材、原场景布局或封面专属文案才能成立。

失败重做时只收紧失败层的约束，不同时改动已通过的角色身份与核心命题。

在 `$run-knowledge-video` 委托模式中，每个画幅独立累计 QA 拒绝次数；只重做失败画幅。第三个被拒输出后设置 `stopped_user_takeover_required` 并停止自动重试。Codex 可按用户的明确委托记录 `qa_accepted_by_codex`，但必须记录原始授权消息及 `user_approval_claimed: false`；不得伪造 `user_approved`。

### 7. 交付

- 展示每个画幅，并说明主题词、口播命题与白猫动作如何映射到画面。
- 列出逐字验收结果，不得只写“文字正确”。
- 明示使用内置 ImageGen，并附最终提示词或完整结构化摘要。
- 预览稿可留在 ImageGen 默认目录；正式素材须复制到项目工作区，使用版本化文件名，不覆盖旧稿。
- 在知识视频工作流中，将三张正式封面放入当前 episode 的 `assets/image/`，把提示词、逐字检查、结构化 QA 与 `publishing-cover-generation-v1` 放入 `schema/`。展示封面不等于请求批准，也不得将封面加入 storyboard、视觉生产队列、Remotion、master 或内部 QA 角色。

## 通过条件

- 三项输入均已锁定且来源明确。
- 封面命题来自口播稿，并回应大众痛点或价值。
- 白猫是准确且有叙事作用的主角。
- 场景与象征物服务核心冲突。
- 主题词逐字符正确，无额外文字。
- 16:9、9:16 与 4:3 分别原生构图，缩略图层级清楚。
- 三个画幅均通过风格可迁移性 QA；委托模式的授权、尝试次数与验收状态均可机械复核。
