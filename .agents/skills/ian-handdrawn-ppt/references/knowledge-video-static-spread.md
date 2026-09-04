# Ian 图文翻书静态整图适配

仅当已选 `illustrated-flipbook` 且 v3 行明确绑定该呈现模式时，读取并严格遵循
`../../produce-video-visuals/references/static-spread.md`。它是静态生产与 QA 唯一入口。

每镜只生成一张完整 16:9 图，无猫，不进入 layered-scene v2，不造透明图层、不做
分层入场，不预留 23% 底部字幕带。批准的图中短标签可直接生成；需要确定性精确文字
覆盖时，覆盖结果成为另一个待审核的完整图，保留来源与变换绑定，不继承旧图批准。
原文在相对书页上由 HTML 呈现，不能烘焙成整段图中文字。

原 Ian 色彩、亮度、线条风格与规范 Style Anchor 保留。其他知识视频风格继续完整
遵循 `knowledge-video-frame.md`，不得用此分支逃避层包、字幕带或审批要求。
