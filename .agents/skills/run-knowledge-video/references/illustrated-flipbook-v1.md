# 图文翻书条件分支 v1

本文件是 `run-knowledge-video` 的条件编排合同。仅当封面后的整期风格选择为 `illustrated-flipbook`（图文翻书），且 `white-cat-visual-style-selection-v2` 的 `style_source: builtin_flipbook`、准确用户选择和快照校验均有效时适用。本文件明确限定下述静态镜头、正文与浏览器后端差异；其他风格继续执行原合同。不得将旧 `ian-static-full-frame-v1`、旧试片或一次性机械放行用作本分支授权。

## 选择、恢复与回滚

保留 Gate 1、Gate 2、封面白猫模式选择、三比例发布封面及完整 post-cover batch。现有风格表单新增“图文翻书”；其后仍选择 `standard | rich`、`manual | one_click` 和已支持的音频来源。图文翻书不要求 cover-style scope，不改发布封面字节。用户明确选择封面开书时，按下文 `opening_cover` 展示适配使用当前 16:9 发布封面；这是本分支对发布封面不得进入 master 的明确例外，不新增品牌、标题或封面图层审批关卡。

用 `leverage-video/src/shared/flipbook-video/profile.mjs` 的 `FLIPBOOK_PROFILE_BYTES` 创建只读单集 `schema/` 快照，再用 `workflow-approval/contract.mjs::buildFlipbookStyleSelection` 建立 v2 选择。`FLIPBOOK_PROFILE_SHA256` 是该版本的精确快照哈希。继续使用 `validatePostCoverSelectionBatch` 原哈希链和一次原子状态写入；不增加自动默认或独立审批捷径。

已批准选择、快照、正文、时间表、图片、随机种子及分配结果均为不可变输入。任一改变按现有回滚矩阵使依赖审批和下游输出失效。音频字节和已批准未变图片可按原规则保留。恢复时复验磁盘哈希，不重新随机。旧记录不迁移。

## 分镜与正文

沿用 v3 全镜头方向审核及七列 Summary。每行和选择证据记录 `presentation_mode: illustrated-flipbook`，绑定顶层选中风格、快照和 cohesion。必须保留真实 machine scene class。两条路线为 `ian-handdrawn-ppt` 与 `imagegen`：概念、结构、对比优先 Ian；叙事、人物、场景优先 ImageGen，选择在现有审核呈现。

所有正文图片 `white_cat_present: false`，方向、提示词、生成 QA 和终稿再次验证。不得由发布封面的猫推断正文猫。每镜恰好一组双页、一张完整 16:9 静态图、一段连续准确口播，使用 `motion_tier: static_spread`；不生成透明图层、姿态序列、分层入场和虚构图层音效。`standard/rich` 表达信息密度与图解细节，不增加层/姿态数量。

`storyboard/static-spread.mjs` 管理 `knowledge-video-static-spread-v1`：`source_text` 保留锁稿原文字符、顺序、空白和标点，`source_text_sha256` 绑定 UTF-8 字节。它独立于图中短标签、书页标题和底部字幕。正文纳入已有完整 `visible-text-batch-review-v1`，以 `locked-narration-spread-body-v1` 绑定；短标签仍须通过原 28 字简述合同。无字幕只关闭底部字幕，正文仍在；两版只差底部字幕。

每页全文先完成排版。正文以黑色宋体为主，导语有字号与字重层次；按真实音频词句时间逐短句淡入、轻微上移，已出现文字保留。动画不改变行宽、行高或后续文字位置。`text_reveals` 以连续 UTF-8 区间和全局帧绑定每句；不得按字数估算替代真实音频时点。长文先按语义拆镜，不极端缩字号、不拉伸配音。

## 静态图片与版式

Ian 和 ImageGen 均执行新增静态 QA 合同；Ian 原 v2 分层包、8 px 层文本内缩和 23% 字幕留白要求在此条件分支不适用。图片不预留字幕带，只保留构图所需留白、页边和防裁切边界。必须经 `visual-assets/static-spread-contract.mjs` 检验来源、提示词、无猫观测、完整性、精确正文绑定和实际半页尺寸可读性，不能仅写 `pass`。

完整 16:9 图以 contain 等比放入单页，不能裁切、拉伸或拆图。每组双页仅在初次排版生成一次随机 seed 和 `image_side/text_side`，存入 manifest；审核、预览、录制、重渲染验证并复用同一结果。不得固定图片左或每次启动重抽。

## 浏览器组装与真实翻页

经 `create-photo-flipbook-ui` 的知识视频入口调用共享 `flipbook-video`；只复制 vendored runtime，不读写其库源码。通用相册入口不变。正文 HTML 页是本入口的正式差异，不是允许重做其他风格成品页。

保留米白背景、居中书本、书脊阴影与真实翻页。捕获期间隐藏全部外围标题、双页阅读标签、页码、按钮、提示、录制和调试状态；仅保留经审核的书页内部内容。

仅当 manifest 显式绑定 `opening_cover: {image: {path, checksum_sha256, width, height}, hold_frames: 24, open_frames: 30}` 时，先以闭合书居中近景展示项目封面 24 帧，再用 30 帧打开封面并同步拉远至左右双页。封面必须等于当前 `state.publishing_cover_generation` 包的 `assets.landscape_16_9`；复验整包规范、canonical package SHA-256、当前 Gate-2 锁稿、图片路径/哈希/尺寸，不能替换为任意图片。封面不是正文镜头，不增加 `OPEN-00`、方向审核行、姿态资产或短标题。

正文 assembly plan、锁稿、配音字节、正文分镜审批和音效计划仍使用从第 0 帧开始的原时间。展示适配统一把正文镜头、文字显现及普通出场转场平移 54 帧；S01 与旁白从展示第 54 帧开始，总展示帧数等于正文 plan 帧数加 54，首句 QA 结束帧亦加 54。闭书和开封面只由上述显式适配负责，不伪装为普通 9–18 帧镜间转场。无 `opening_cover` 的 manifest 保留原有第 0 帧直接开讲行为。

每个普通边界注册 `scene-transition-v3` 的 `book-page-turn`，renderer 指向 `flipbook-video/browser-runtime.js`，带准确选择、目录和 map 哈希。时长 9–18 帧（0.3–0.6 秒）；当前 runtime 一片使用同一已批准时长。它是物理翻页，不能以 cut 或其他 effect 替代以满足转场多样性。翻页结束对齐下一镜开始，当前页全部正文须在翻页前显完；只允许末镜 clean hold 无转场。

每次受保护动作前执行 `assembly-plan/flipbook-gates.mjs::verifyFlipbookProduction`：重读 state 与原始 assembly input、运行 workspace/visual-lock 校验、复验风格/模式/字幕门禁，并调用原 `buildKnowledgeVideoAssemblyPlan` 复验共享复用、方向、节奏、转场与 sound-design。manifest 必须逐镜等于重建计划经过显式封面适配后的结果；不得改写正文源计划来凑齐展示时间。生产 build/serve/录制 POST 接收执行该函数的 callback，不能接受调用方 JSON 中自报通过。维护模式只接受 `shared/flipbook-video/fixtures/` 的合成输入，或用户明确要求并完成独立复制及授权证据绑定的图片预览。后者使用 `knowledge-video-maintenance-preview-provenance-v1`，运行工件不得保留原 episode 路径或运行依赖，不能转为生产交付；维护实现和测试仍不得读取真实 episode。

生产 HTML、程序、图片、JSON 和录像各入 episode 的 `docs/`、`script/`、`assets/image/`、`schema/` 和 `assets/video/`。通过服务端 URL 映射组合网页，不在一个 bundle 中混放工件。生成文件不得逸出已解析 workspace。

实际录制 Codex 内部浏览器当前可见标签页。使用 Computer Use 前按当前用户权限请求批准，仅操作指定应用；本合同不授予 UI 权限。鼠标启动后由墙钟时间轴自动翻页。先检查真实 visibility、字体 ready、所有图片 decode、稳定版式与第一组页，再通过页面按钮请求 `getDisplayMedia`；只接受 browser surface 和可验证当前标签页。保留真实 MediaRecorder WebM、捕获设置、逐事件实测时间、renderer 翻页完成事件和文件哈希。不得改为 headless/Playwright 截图或其他翻页外观。

录制 proof 保留真实 `requestVideoFrameCallback` 源帧的 `capture_at_ms` 与同步的时间轴零点。组装前用 `flipbook-video/capture-clock.mjs::measureBrowserCaptureClock` 探测原 WebM 包时间戳，逐帧匹配源时钟，复验录像、proof、manifest 的准确哈希。来源不完整、匹配歧义、残差超限或丢失开场时阻断，不以 MediaRecorder 异步 start 事件或目测偏差裁片。以微秒 timebase 平移 PTS 后统一为 30 fps；仅末页文字与翻页全部完成、有真实静止帧证据时允许最多 150 ms 复用最后真实帧。原录制与 proof 不改写，最终仍须真实像素和音画 QA。

## 声音、字幕与交付

沿用 sound-design v2 和共享音源。S01 开场与每次真实翻页是必要结构事件；正文显现通常静音并记录理由。静态镜头不产生 Ian layer-entry。合入配音时沿用公共音频 preflight 的逐样本调度、narration gain 1、统一 SFX bus、禁 normalization 和 -1 dBFS 上限。BGM 默认关闭；不得另选或混入未经授权音乐。

启用封面适配时，锁定配音与正文 SFX 的完整混音统一延后 54 帧，不拉伸音频、不重写正文 cue。封面展示与开封面的声效计划单独绑定并验证后再与正文混合；未完成该计划和最终整体音频 QA 时，必须记录生产音频接续未完成，不得因浏览器样片通过而宣称正式生产通过。

生产 manifest 的 `opening_sound_design: {path, checksum_sha256}` 指向 episode `schema/` 内独立的标准 `knowledge-video-sound-design-v2`。在该 design 中添加 `opening_adapter: {contract_version: knowledge-video-flipbook-opening-sound-adapter-v1, opening_cover, body_assembly_plan_sha256}`，再用原 `buildSoundDesignMapSha256` 计算包含该字段的 canonical map SHA-256；没有此字段的旧 design 哈希不变。其七类源绑定、共享 library、policy 和 SFX bus 必须与当前 body plan 一致。`FLIPBOOK-COVER` 和 `FLIPBOOK-BODY-ENTRY` 仅是声音适配器内部的两个展示范围，不是新分镜：复用现有机械事件验证得到展示开场 `cue/sync=0/0`、开封面 `cue/sync=24/54`，两者都必须为可听事件。开封面的 30 帧属于显式特殊封面动作，不接受普通镜间转场的 9–18 帧限制，也不得进入普通转场审核行。

使用 `assembly-plan/flipbook-opening-sound.mjs::preflightFlipbookOpeningSound` 读取并重新验证该 design、真实 library 源和派生 WAV，执行原 body preflight，再用同一个共享逐样本混音器生成完整参考 PCM。它保持 narration gain 1 和同一 SFX bus，旁白延迟准确 `79380` 个 44.1 kHz 样本，最终样本数等于展示帧数乘 `1470`，重新测量整体峰值。返回的 `inputArgs/filters` 直接用于 mux；`referencePcm` 是供 QA 比较的临时内存内容，不写入 JSON。完成 mux 后执行 `validateFlipbookOpeningRenderAudio`，只允许完整 master 或锁定首句 prefix，检查唯一 stereo 44.1 kHz 音轨、准确长度、峰值，以及封面段和正文段各自与参考 PCM 的同样本偏移匹配。AAC 解码只容许尾部至多一个 1024 样本编码帧的填充。源码中已验证的 canonical 封面/正文绑定与真实混音结果缺一不可；不能用调用方 JSON 的自报 `pass` 代替。

将录制视频与锁定配音及通过 QA 的 SFX 组装成 1920×1080、30 fps H.264 MP4。字幕三选一、同角色首句 QA、全解码、音画同步、接触表、黑帧、精确帧数、文件校验与事务式交付仍保留；caption-neutral 浏览器片段不能直接声称最终交付。字幕版仅加一层锁定底部字幕，不改书页正文、画面顺序、音轨或时间表。

每次正式新交付事务完成后仍调用 `short-video-bgm`，其验证推荐属于完成门禁，仅建议，不下载、不混音、不改成片。

## 可执行入口与绑定字段

生产 manifest 额外记录 `episode_workspace`、`locked_script: {path, checksum_sha256}` 和 `production_authority: {episode_workspace, episode_state: {path, checksum_sha256}, assembly_input: {path, checksum_sha256}}`。状态 authority 必须是当前唯一 `schema/episode-state.json`，不得绑定历史快照；assembly input 也在该 episode 的 `schema/`，locked script 在 `assets/narration/`。读取当前 `state.storyboard_timing` 绑定的 `storyboard-shot-timing-v1`；其中每个 `source_text` 必须与对应双页正文相同，并逐行核对 `locked_utf8_byte_start`、`locked_utf8_spoken_end_exclusive`。按 `source_text + inter_shot_gap_text` 顺序重建完整锁稿字节，保留镜间换行和空白。`assembly_input` 为现有共享 builder 输入，包含当前完整 workflow/direction/rhythm/transition/reuse/sound 证据；不能仅给成品 plan 的自报通过字段。首句 QA 边界沿用该校验和锁定的输入 `timeline.firstSentenceEndFrame` 和所建 plan 的 `timeline.first_sentence_end_frame`，不猜测额外 state 存储键。

用 `.agents/skills/assemble-video-master/scripts/flipbook-video.mjs` 统一执行：

- `build <manifest.json> <episode/docs/flipbook-v01>`：实际执行 gates 后构建分类型工件并返回 schema 中的 build descriptor。
- `serve <build-descriptor.json> [port]`：只监听本机，复验 build、素材与当前 gates；随后才按权限使用 Codex 内部浏览器。
- `mux <config.json>`：config 绑定 `manifest_path/manifest_checksum_sha256`、`capture_root`、`capture_lock: {path, checksum_sha256}`、新 `output_path/evidence_path` 和 `role`。生产 MP4 和证据分别入 assets/video 与 schema。

最终角色为 `caption_free_master` / `captioned_master`；内部首句角色沿用当前 state 的 `required_internal_qa_roles` 精确名单（兼容 `*_opening` 与 `*_first_shot_prefix` 已有命名），使用同一录制源、同一音轨计划直接按首句帧数生成，仅作内部 QA。不得凭命名自行增添角色。manual 的 `caption-neutral-base` 只能用于锁定前验收，不能交付。合成素材使用 `maintenance-preview`，不能记为正式生产/用户审批。

字幕版将现有锁定 cue artifact 记入 `caption_delivery.cue_artifact: {path, checksum_sha256}`，mux config 的 `caption_binding` 必须完全相同，`caption_image_directory` 在 assets/image。`knowledge-video-flipbook-bottom-captions-v1` 用原字幕规范的黑色半透明底、白色中文和固定底边距，把经 `normalizeCaptionDisplayText` 验证的完整 cue 渲染为透明 PNG，再按准确帧区间合成一次；不生成字幕流或交付 sidecar。无字幕版不消费这些 PNG。两版共享同一 browser capture 和音轨输入，首句文件不得从已编码 master 二次裁切代替源渲染。

每个 cue 保留标准 `shot_id`；按镜头顺序合并的 `source_text` 必须逐字节等于当前双页锁定正文，时间须落在该双页范围内。缺字、改字、额外镜头、重排或越界均阻断。录制与合成绑定同一份 manifest 文件路径及 SHA-256，不凭内存对象的自报哈希替代磁盘复验。
