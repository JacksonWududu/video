# 白猫四肢拓扑校验 v2 详细设计方案

状态：合同、machine schema、记录器与兼容边界已实施；本次为 project_maintenance，未改写 episode workspace  
适用范围：知识视频中的白猫生成图与修订图  
当前兼容边界：`leverage-video/src/topic5` 已处于 `final_rendering`，视觉队列 45/45 均为 `approved`；S14、S18、S19 均为历史 v1，不重生、不改写。v2 只约束未来新建白猫资产，或用户明确要求重做、修订、替换、重新批准的既有白猫资产。

## 1. 问题

v1 流程虽要求填写前肢、后肢和爪子的数量，但校验器主要检查 QA JSON 的字段和值，并不能证明图像像素中的四肢确实正确。视觉检查也容易受动作语义影响：看到“推箱子”时，会先入为主地认为贴着箱子的两只爪就是全部前爪，从而漏掉胸腹下多出来的第三前肢。

这会产生一种危险的假通过：图中实际有三条前肢和两条后肢，QA 却填写为两条前肢、两条后肢，结构校验仍然通过。

### 1.1 v1 实施前为什么拦不住

旧版实现的关键入口是：

- `record-generated-imagegen-strict.py` 中的 `validate_white_cat_identity_qa()`，负责严格审批母版。
- `record-generated-imagegen-hybrid-qa.py` 通过 helper 复用同一个函数，负责动作图与严格修订图。

旧版函数只比较以下自报字段：

```text
cat_count == 1
foreleg_count == 2
hindleg_count == 2
paw_count == 4
accessory_geometry_correct == true
```

因此，旧版能发现 JSON 写成 `foreleg_count: 3`，却无法发现图片里有三条前肢、JSON 仍写成 `2`。v2 已把“图像证据与计数之间的绑定”纳入合同、machine schema 与记录器校验。

这不是一个普通的计数 bug，而是证据模型缺失：校验器验证了声明，却没有验证声明依据。

### 1.2 典型误判路径

以推物姿势为例，误判通常按下面的顺序发生：

1. 审核者先识别“白猫正在用两只前爪推物体”。
2. 视觉注意力集中在物体接触面，忽略胸腹下方或袍子边缘多出的爪。
3. 多余前肢因接近后腿区域，被错误归类为后肢或背景形状。
4. QA 按预期姿势填写为两前肢、两后肢。
5. 校验器只看到合法数字，因此通过。

新方案必须打断第 1 步带来的先验影响：先枚举所有爪状端点，再分类前后肢。

## 2. 目标

新方案解决三件事：

1. 不再根据整体印象数四肢，而是逐条追踪每只爪到肩部或髋部。
2. 没有证据的数量声明不得通过校验。
3. 新规则只约束未来新建，或用户明确要求重做、修订、替换、重新批准的素材；不破坏已经批准的文件、哈希与审批证据。

本方案不试图用普通文本字段完成可靠的像素识别，也不承诺完全自动化识别所有风格化动物姿势。难以确认时一律判退。

## 3. 核心规则

白猫图必须满足以下 P0 条件：

- 恰好两条前肢，每条前肢都有一只爪，并能连续追溯到肩部。
- 恰好两条后肢，每条后肢都有一只爪，并能连续追溯到髋部。
- 总爪数恰好为四。
- 未归属的爪状区域为零。
- 无法追溯、被遮挡到无法确认、疑似融合或疑似分叉的肢体区域为零。
- 尾巴、袍子褶皱、包带和背景物体不得被当作肢体证据。

任何一项不满足，`result` 必须是 `fail`。不得用“动作合理”“大概被遮住”或提示词中写了“四肢正确”替代图像证据。

## 4. 逐肢追踪方法

检查顺序固定如下：

1. 从所有可见爪端开始编号，不先判断前后肢。
2. 沿每个爪端向躯干追踪连续的腿部轮廓。
3. 接入胸肩区域的标记为 `F1`、`F2`；接入骨盆或后胯区域的标记为 `H1`、`H2`。
4. 无法接入躯干的标记为 `U1`、`U2`，表示未归属。
5. 同一条腿出现分叉、同一肩部伸出两条完整前臂，或同一爪与两条腿相连，均记录为拓扑异常。
6. 只有最终集合精确等于 `{F1, F2, H1, H2}`，且没有 `U*` 或模糊区域，才能通过。

每个 v2 白猫资产都必须有编号检查图；复杂动作只是更需细查，并非编号图的启用条件。编号检查图只用于审核，不进入最终视频。原图本身保持不变。

### 4.1 双向追踪，避免漏数

每张图执行两次方向相反的检查：

正向检查从爪到躯干：

1. 扫描整张图，列出所有爪状端点。
2. 为每个端点建立独立区域编号，例如 `P1`、`P2`。
3. 沿像素轮廓向躯干追踪，判断其接入肩部、髋部，还是无法确认。

反向检查从躯干到爪：

1. 分别检查左右肩部与左右髋部区域。
2. 从每个躯干连接点向外追踪完整肢体。
3. 确认每条肢体只对应一个爪端，且没有分叉或融合。

两次检查必须形成一一映射。正向发现的端点数量与反向发现的肢体数量不同，立即失败。

### 4.2 全画面扫尾

完成 F1、F2、H1、H2 标注后，再单独扫描以下高风险区域：

- 胸口至腹部下缘
- 袍子下摆两侧
- 挎包下方与包体后侧
- 道具接触面
- 尾巴根部附近
- 地面阴影与前后爪重叠区

如果出现未被四条追踪线覆盖的爪垫、脚趾轮廓、腕部或小腿形状，记录为 `unassigned_paw_like_shape`，不能解释成“可能是衣褶”。

### 4.3 遮挡规则

允许局部遮挡，但必须满足：

- 爪端可见。
- 肢体进入遮挡前的方向明确。
- 遮挡后的连接位置与肩部或髋部一致。
- 不存在另一条肢体共享同一个出口。

若袍子、挎包、箱子或身体完全遮住关键连接，以至于无法判断是两条腿还是三条腿，结果必须是 `fail`，错误码为 `P0_AMBIGUOUS_TRACE`。不得使用提示词、姿势常识或上一张图补全当前图的不可见结构。

## 5. QA 合同与证据结构

### 5.1 合同版本

新建或明确重做的白猫母版和动作图采用：

- `ordinary-imagegen-white-cat-master-qa-v2`
- `ordinary-imagegen-white-cat-action-qa-v2`

历史人物图合同不变。白猫 v1 合同仅作为已经批准资产的历史记录，新的白猫母版、动作图和严格修订图均不得继续登记 v1。

`identity_qa` 保留身份和挎包字段，并新增 `anatomy_evidence`。这样队列中仍能读取统一的 `identity_qa`，同时可以明确区分 P0 四肢证据与 P2 配件证据。

P0 合同为 `white-cat-anatomy-qa-v2`。唯一 machine schema 位于：

`leverage-video/src/shared/visual-assets/schemas/white-cat-anatomy-qa-v2.schema.json`

以下为与该 schema 对齐的结构示例：

```json
{
  "contract_version": "white-cat-anatomy-qa-v2",
  "result": "pass",
  "source_image": {
    "path": "root-relative/path.png",
    "checksum_sha256": "..."
  },
  "canvas": {
    "width": 1672,
    "height": 940
  },
  "limb_traces": [
    {
      "id": "F1",
      "class": "forelimb",
      "paw_region_id": "P1",
      "paw_bbox_normalized": [0.42, 0.40, 0.06, 0.09],
      "paw_visible": true,
      "continuous_to_torso": true,
      "torso_anchor": "shoulder",
      "torso_anchor_point_normalized": [0.58, 0.46],
      "trace_polyline_normalized": [[0.45, 0.44], [0.51, 0.45], [0.58, 0.46]],
      "occlusion_status": "none"
    },
    {
      "id": "F2",
      "class": "forelimb",
      "paw_region_id": "P2",
      "paw_bbox_normalized": [0.43, 0.48, 0.06, 0.09],
      "paw_visible": true,
      "continuous_to_torso": true,
      "torso_anchor": "shoulder",
      "torso_anchor_point_normalized": [0.59, 0.50],
      "trace_polyline_normalized": [[0.46, 0.52], [0.52, 0.51], [0.59, 0.50]],
      "occlusion_status": "none"
    },
    {
      "id": "H1",
      "class": "hindlimb",
      "paw_region_id": "P3",
      "paw_bbox_normalized": [0.64, 0.72, 0.06, 0.08],
      "paw_visible": true,
      "continuous_to_torso": true,
      "torso_anchor": "hip",
      "torso_anchor_point_normalized": [0.68, 0.61],
      "trace_polyline_normalized": [[0.67, 0.76], [0.67, 0.68], [0.68, 0.61]],
      "occlusion_status": "partial",
      "occlusion_reason": "himation edge"
    },
    {
      "id": "H2",
      "class": "hindlimb",
      "paw_region_id": "P4",
      "paw_bbox_normalized": [0.78, 0.72, 0.06, 0.08],
      "paw_visible": true,
      "continuous_to_torso": true,
      "torso_anchor": "hip",
      "torso_anchor_point_normalized": [0.72, 0.61],
      "trace_polyline_normalized": [[0.81, 0.76], [0.77, 0.69], [0.72, 0.61]],
      "occlusion_status": "none"
    }
  ],
  "forward_trace_ids": ["F1", "F2", "H1", "H2"],
  "reverse_trace_ids": ["F1", "F2", "H1", "H2"],
  "unassigned_paw_like_shapes": 0,
  "ambiguous_limb_regions": 0,
  "branched_or_fused_limb_regions": 0,
  "inspection_evidence": {
    "methods": ["full_resolution", "numbered_limb_map"],
    "numbered_limb_map_path": "root-relative/path-anatomy-map.png",
    "numbered_limb_map_checksum_sha256": "...",
    "numbered_limb_map_source_checksum_sha256": "...",
    "numbered_limb_map_limb_ids": ["F1", "F2", "H1", "H2"]
  }
}
```

坐标采用相对于整张图的归一化值，范围为 `0.0–1.0`。示例坐标仅说明结构，不是任何当前素材的真实标注。

校验器需要机械验证：

- `F*` 正好两个，`H*` 正好两个。
- 四项均有可见爪端和连续躯干连接。
- 前肢只允许接入肩部，后肢只允许接入髋部。
- 四个 `paw_region_id` 必须唯一，四个边界框必须在画布内。
- 每条追踪线至少包含爪端、中间肢体、躯干锚点三个位置。
- 正向和反向追踪 ID 集合必须完全一致。
- 三类异常计数都必须为零。
- 原图与编号图均须完整解码为 PNG；编号图与原图路径、字节必须不同，尺寸必须一致。
- 编号图须绑定原图 SHA-256，并记录精确 limb IDs `F1/F2/H1/H2`；路径、哈希和审核记录必须完整。
- `result` 必须由上述字段推导，不能由调用者任意填写。

编号和 JSON 仍然不能单独证明像素事实，因此视觉审核环节必须真正查看原尺寸图和编号图。校验器负责防止证据缺失、自相矛盾或被替换。

### 5.2 编号检查图规格

编号图必须满足：

- 与原图尺寸一致，不裁剪、不拉伸。
- 必须是可完整解码的 PNG，不得只凭 PNG 文件头或尺寸元数据通过。
- 必须使用独立路径与独立字节；不得直接把原图冒充编号图。
- 原图以低透明度显示，不能用重绘轮廓替代原像素。
- F1、F2 使用同一类颜色，H1、H2 使用另一类颜色。
- 每条肢体绘制从爪端到躯干锚点的折线。
- 爪端有边界框，躯干连接处有锚点圆标。
- 可疑但未归属区域使用红色 `U*` 标记。
- 图上不得覆盖原图关键连接区域；标签放在区域外并以引线连接。
- 编号图文件哈希、绑定的原图 SHA-256 及精确 limb IDs `F1/F2/H1/H2` 必须写入 QA；原图变化后旧编号图自动失效。

### 5.3 错误码

使用稳定错误码，便于测试与统计：

| 错误码 | 含义 |
|---|---|
| `P0_CAT_COUNT` | 白猫数量不是一只 |
| `P0_FORELIMB_COUNT` | 前肢不是两条 |
| `P0_HINDLIMB_COUNT` | 后肢不是两条 |
| `P0_PAW_COUNT` | 可见爪端不是四个 |
| `P0_UNASSIGNED_PAW` | 存在未归属爪状区域 |
| `P0_AMBIGUOUS_TRACE` | 存在无法确认的躯干连接 |
| `P0_BRANCH_OR_FUSION` | 肢体分叉、融合或共享爪端 |
| `P0_FORWARD_REVERSE_MISMATCH` | 双向追踪集合不一致 |
| `P0_EVIDENCE_STALE` | 原图、编号图或哈希不匹配 |
| `P2_SATCHEL_TOPOLOGY` | 双带或包体两端连接不合格 |

拒绝记录应保存最具体的错误码，不能只写笼统的 `identity incorrect`。P0/P2 失败写入失败台账时，`reason` 必须以最具体的稳定 P0/P2 码开头，例如 `P0_AMBIGUOUS_TRACE: ...` 或 `P2_SATCHEL_TOPOLOGY: ...`。

## 6. 校验器设计

### 6.1 拆分 P0 与 P2

v2 将基本四肢字段和挎包字段拆为三个函数：

```python
validate_white_cat_anatomy_qa_v2(identity_qa, selected_source)
validate_white_cat_accessory_qa(identity_qa)
validate_white_cat_identity_qa_v2(identity_qa, selected_source)
```

第三个函数依次调用前两个。P0 失败时立即停止，不继续用 P2 结果掩盖人体结构问题。动作图脚本继续复用严格母版脚本中的 helper，避免两套逻辑漂移。

### 6.2 机械判定伪代码

```text
assert anatomy.contract_version == white-cat-anatomy-qa-v2
assert anatomy.source_image.path == selected_source.path
assert anatomy.source_image.sha256 == selected_source.sha256
assert anatomy.canvas == decoded_png_dimensions

traces = anatomy.limb_traces
assert trace ids == {F1, F2, H1, H2}
assert unique paw_region_ids == 4
assert classes == {forelimb: 2, hindlimb: 2}

for trace in traces:
    assert paw_visible is true
    assert continuous_to_torso is true
    assert bbox and every polyline point are inside canvas
    assert forelimb -> shoulder
    assert hindlimb -> hip
    assert occlusion_status in {none, partial}
    if partial: assert non-empty occlusion_reason

assert forward_trace_ids == reverse_trace_ids == trace ids
assert unassigned_paw_like_shapes == 0
assert ambiguous_limb_regions == 0
assert branched_or_fused_limb_regions == 0
assert numbered map is a separate-path, separate-byte, fully decodable PNG
assert numbered map sha256 and dimensions match its binding
assert numbered map source sha256 == selected source sha256
assert numbered map limb ids == [F1, F2, H1, H2]

derive result = pass
```

若任何断言失败，脚本不得更新 `episode-state.json`，不得把素材状态改为 `awaiting_user_approval` 或 `awaiting_batch_qa`。

### 6.3 与现有记录流程的接入点

严格母版脚本目前在读取 QA、验证提示词、源图、参考图和 generation lineage 后，调用身份 QA，再写入 `episode-state.json`。v2 应放在同一身份 QA 位置，但必须额外接收已经校验过哈希的 `selected_source`。

动作图脚本复用严格脚本的 helper，并确认动作图来自精确批准的母版。保持以下顺序：

1. 校验动作图源文件、尺寸和哈希。
2. 校验精确批准母版绑定。
3. 校验生成参考与 lineage。
4. 校验动作图自己的四肢证据。
5. 校验挎包双带。
6. 校验连续性、可见文字和风格。
7. 最后才写入队列状态。

母版通过不代表动作图自动通过。每张动作图都必须有自己的编号图与四肢追踪。

`xuan-paper-diorama` 的顶层路线 QA 合同保持 `xuan-paper-diorama-asset-qa-v1` / `xuan-paper-diorama-action-qa-v1`，但其中每个新建或明确重做的白猫最终 normalized PNG 都必须包含自己的 `identity_qa.anatomy_evidence` v2，绑定最终 1920×1080 字节；不得继承标准化前源图的 P0 证据。

### 6.4 原子写入与失败行为

现有记录器使用临时 JSON 后再替换 `episode-state.json`。这一行为应保留。新增要求：

- v2 验证在创建临时状态文件之前完成。
- 失败时只输出错误，不修改队列、当前资产或暂停状态。
- 编号图可以预先存在，但只有被合格 QA 哈希绑定后才成为证据。
- 不自动删除失败图、编号图或拒绝证据。

P0/P1/P2 通过与用户批准是不同状态转换。手动模式只进入对应的待用户或待批次审核边界；一键模式只可进入 `qa_passed_pending_final_review`。QA 不得直接写 `approved`；只有适用的人工逐项决定或最终完整哈希清单决定才可批准。

## 7. 生图与修图策略

### 7.1 生成时降低错误概率

- 复杂动作优先绑定已经批准的姿势参考图。
- 推物姿势中，两只前爪应上下错开，肩部轮廓分别可追踪。
- 两只后爪应一前一后落地，避免被袍子和挎包完全遮挡。
- 包体、包带、道具不得覆盖肩部、胸腹下缘或髋部连接区。
- 提示词继续保留“两前肢、两后肢、四爪”的 P0 约束，但不得把提示词当作验收证据。

### 7.2 修图时拆分问题

一轮只处理一个高风险拓扑问题：

1. 先修四肢，确认 `{F1, F2, H1, H2}`。
2. 四肢通过后，再修挎包双带及包体两端连接。
3. 第二轮修包后重新执行完整四肢检查，防止编辑模型重新生成多肢。

不得在同一轮同时要求模型删除多余肢体、重建两条包带并大幅改变姿势。

## 8. 姿势参考库

建议逐步增加白猫动作参考，而不是一次建立庞大素材库。优先加入容易出错且会反复使用的姿势：

- 双前爪推物
- 双前爪持手机或书本
- 行走与奔跑
- 端坐与伏案
- 单爪操作、另一前爪稳定物体

每张姿势参考都应先通过四肢拓扑和挎包拓扑审核，再登记路径与哈希。后续生成需要记录实际使用的姿势参考，避免只在提示词中声称使用。

## 9. 历史兼容与未来启用边界

`leverage-video/src/topic5` 当前处于 `final_rendering`，`visual_asset_review.queue` 共 45 项且 45/45 均为 `approved`。S14、S18、S19 的白猫母版及动作图均为已批准历史 v1；本次维护绝不重生、修订、替换、重新批准或改写其中任何素材、QA 或 episode state。

本轮开始时记录的 `topic5` 全目录聚合 SHA-256 为：

`e865e7ca570b2e6ec513f48275f135a7fce37528d9f559c9cc7244f6bc517a09`

`topic5` 含被 gitignore 排除的 episode 文件，因此不能用 `git diff` 或“工作树零差异”证明既有字节未变。结束验证须使用相同的全目录聚合算法重新计算并与上述值比较，同时运行 episode workspace validator。

终验期间另一个用户任务于 2026-08-22 09:42–09:50 并发执行 topic5 的 Remotion 预览与预检，写入了 assembly、preview 和 `qa-preflight` 派生文件；因此全目录聚合值稳定为 `3513d4674690d92c18b6857e4258ec95daf7abe6ebe4f23d366295c78449f7ba`，不能再把它与起始值相等作为本次白猫维护的归因证据。本次维护不回退或覆盖这些外部产物。批准视觉仍以 45 项 exact-byte lock 复核：`verification_sha256=c2c921f0991838b0848cbd125caecf2c5f6728e39bae310b0c485cb0790af60c`；`episode-state.json` 保持 2026-08-22 04:26:40 的既有字节时间，白猫历史 v1 未重写。

向前兼容规则如下：

1. 已 `approved` 的历史 ImageGen v1 只读保留；不得补写或伪造 v2 证据。
2. 未来新建白猫资产必须使用 v2。
3. 用户明确要求重做、修订、替换或重新批准任何既有白猫资产时，该目标及其真实依赖视为新工作，必须使用 v2；镜头号、旧文件名或旧日期不构成豁免。
4. 新建或明确重做的白猫 `xuan-paper-diorama` 最终 normalized PNG 也必须在最终字节上执行 v2；不得沿用标准化前的证据。
5. 非白猫图片不受本规则影响。

### 9.1 实施与验证步骤

1. 记录整个 episode 目录的聚合 SHA-256 和当前状态摘要；当前基线为 `final_rendering`、45/45 `approved`。
2. 新增 v2 machine schema、验证函数与测试，不批量改写任何旧 QA JSON。
3. 更新白猫记录器：新母版、新动作图、严格修订图和新/重做宣纸最终 normalized 图均要求嵌套 P0 v2 证据。
4. 运行目标测试，确认五肢样例失败、合法样例通过、独立编号图及完整 PNG 解码绑定有效。
5. 运行 episode workspace validator。
6. 使用与基线相同的聚合算法重算 `topic5` 全目录 SHA-256；若期间无其他 episode 写入，必须仍为 `e865e7ca570b2e6ec513f48275f135a7fce37528d9f559c9cc7244f6bc517a09`。若有已确认的并发用户任务，必须列出其新增/改写文件，且改用 episode state 与 45 项批准视觉 exact-byte lock 证明白猫历史未变，不得回退外部任务产物来伪造聚合相等。
7. 不启动 S14 或其他已批准镜头的生产。只有未来新建资产或用户明确授权重做时，才进入 v2 生产步骤。

### 9.2 审批状态机与 workspace validator 边界

- 新白猫 ImageGen 母版只接受 `ordinary-imagegen-white-cat-master-qa-v2`；新动作图与严格修订图只接受 `ordinary-imagegen-white-cat-action-qa-v2`。
- 新建或明确重做的白猫宣纸资产保留路线顶层 QA 合同 `xuan-paper-diorama-asset-qa-v1` / `xuan-paper-diorama-action-qa-v1`，但其 `identity_qa.anatomy_evidence` 必须是绑定最终 normalized PNG 的 `white-cat-anatomy-qa-v2`。
- QA 通过只允许进入待人工审批状态：手动模式为相应用户/批次边界，一键模式为 `qa_passed_pending_final_review`。QA 本身不得写 `approved`。
- episode workspace validator 对 active 白猫 `imagegen` / `xuan-paper-diorama` 项在 `awaiting_user_approval`、`awaiting_batch_qa`、`qa_passed_pending_batch_review`、`qa_passed_pending_final_review` 状态强制检查当前 v2 合同、QA 文件绑定、结果和源图路径/哈希。
- validator 只对已 `approved`、源文件与 QA 文件哈希仍有效、presented/approved checksum 一致且有决定消息与时间的历史 ImageGen 项允许 v1。任一项进入修订、替换、重新批准或明确重做流程后，即失去该只读豁免。

版本切换依据状态与真实证据，不硬编码 S14，也不依赖日期字符串。

### 9.3 并发与状态风险

共享脚本修改期间不得并发生图、登记或批准操作，否则可能出现：

- 某张图按旧合同生成，登记时脚本已切到 v2。
- 编号图对应旧字节，但源图在另一轮编辑中被覆盖。
- 两个进程同时尝试替换 `episode-state.json`。

本次仅做 project_maintenance；不运行 topic5 生图、登记、批准或渲染写入。测试和只读校验不受影响。

## 10. 实施位置

实施与验证覆盖以下最小范围：

- `.agents/skills/produce-video-visuals/references/character-and-style-lock.md`
- `.agents/skills/produce-video-visuals/references/white-cat-generation-accuracy.md`
- `.agents/skills/produce-video-visuals/references/action-family-contract.md`
- `leverage-video/src/shared/visual-assets/record-generated-imagegen-strict.py`
- `leverage-video/src/shared/visual-assets/record-generated-imagegen-hybrid-qa.py`
- `leverage-video/src/shared/visual-assets/schemas/white-cat-anatomy-qa-v2.schema.json`
- `.agents/skills/run-knowledge-video/scripts/validate_episode_workspace.py`
- 对应测试

P0 使用独立测试文件：

- `leverage-video/src/shared/visual-assets/test_record_generated_imagegen_white_cat_anatomy_qa.py`

现有 `test_record_generated_imagegen_white_cat_accessory_qa.py` 继续负责 P2 双带拓扑，避免把四肢与配件测试混成一个难以定位的套件。

其他文件仅在 CodeGraph 调用关系和失败测试证明必要时修改。不得顺手改动分镜、旁白、时间轴或已批准资产。

## 11. 测试要求

至少覆盖以下用例：

- 两前肢、两后肢、四爪且证据完整：通过。
- 三前肢、两后肢：失败。
- 两前肢、三后肢：失败。
- 总数填四，但存在一个未归属爪状区域：失败。
- 数量正确，但一条腿无法连续追溯至躯干：失败。
- 四肢正确，但挎包只有一条带：四肢 P0 通过，挎包 P2 失败，整图仍不得登记。
- 已批准历史 v1 资产保持可读。
- 新白猫资产尝试使用 v1：失败。
- 编号图哈希或原图哈希不匹配：失败。
- 编号图与原图路径相同或字节相同：失败。
- 编号图不是完整可解码 PNG、源 SHA-256 绑定错误或 limb IDs 不完整：失败。
- 新建或明确重做的白猫宣纸最终 normalized PNG 缺少自身 v2：失败。

### 11.1 单元测试矩阵

| 场景 | 预期 | 错误码 |
|---|---|---|
| F1、F2、H1、H2 完整 | 通过 | 无 |
| F1、F2、F3、H1、H2 | 失败 | `P0_FORELIMB_COUNT` |
| F1、F2、H1、H2、H3 | 失败 | `P0_HINDLIMB_COUNT` |
| 四条 trace 共用三个 paw region | 失败 | `P0_PAW_COUNT` |
| 四条 trace 外另有 U1 | 失败 | `P0_UNASSIGNED_PAW` |
| F2 接入 hip | 失败 | `P0_AMBIGUOUS_TRACE` 或专用分类错误 |
| 两条前肢共享同一肩部出口并分叉 | 失败 | `P0_BRANCH_OR_FUSION` |
| 正向四条、反向五条 | 失败 | `P0_FORWARD_REVERSE_MISMATCH` |
| 编号图属于旧源图 | 失败 | `P0_EVIDENCE_STALE` |
| P0 合格、P2 缺后带 | 失败 | `P2_SATCHEL_TOPOLOGY` |

### 11.2 集成测试

集成测试至少证明：

- 严格母版记录器遇到 P0 失败时不会修改 episode state。
- 动作图记录器遇到 P0 失败时不会把状态改为 `awaiting_batch_qa`。
- 严格修订图同样强制 v2。
- 历史人物 ImageGen 路线不受白猫 v2 影响。
- 已批准 v1 白猫素材仍可被 episode validator 读取。
- 新 v1 白猫 QA 无法登记。
- active 待审批白猫宣纸 normalized 图缺少嵌套 anatomy v2 时，episode validator 失败。
- 临时状态文件不会在失败后残留并阻塞下一次合法记录。

实施完成后运行相关单元测试、视觉资产脚本测试，以及：

```bash
python3 .agents/skills/run-knowledge-video/scripts/validate_episode_workspace.py leverage-video/src/topic5
```

任何非零结果都阻止恢复生图。

## 12. 时间与 Token 代价

以下为流程估算，不是计费承诺：

| 项目 | 时间增量 | 文本 Token 增量 |
|---|---:|---:|
| 逐肢追踪 QA | 每张约 10–20 秒 | 每张约 300–700 |
| 复杂姿势编号检查图 | 每张约 20–40 秒 | 每张约 300–800 |
| 失败后拆成两轮修图 | 失败图额外约 1–2 分钟 | 约 800–1500，另有一次生图消耗 |
| 首次实现 v2 与测试 | 约 10–30 分钟 | 数千 Token，取决于现有代码结构 |
| 建立单个新姿势参考 | 取决于生图重试次数 | 与图像生成调用分开计算 |

图像生成消耗通常不等同于普通文本 Token，需以实际平台计量为准。新方案的目标不是增加每张图的流程，而是用十几秒的检查避免一次或多次重生。

### 12.1 推荐的成本控制

- 所有 v2 白猫图均做双向逐肢追踪并生成独立编号图。
- 普通站姿或坐姿可不绑定额外复杂姿势参考；推、跑、持物、交叉手臂优先绑定已批准姿势参考并加严人工检查。
- 只有发现 P0 或 P2 失败时才拆成两轮修图。
- 姿势库按实际出现的动作增量建设，不预生成大量可能用不到的姿势。
- 编号图由固定本地脚本叠加标记，不重新调用图像生成模型。

固定叠加脚本若现有环境已经有合适图像库，应直接复用；若没有，不因本方案自动下载依赖。

## 13. 观测指标

启用后记录以下指标，用于判断方案是否真正减少返工：

- 白猫图首次生成通过率。
- P0 四肢失败数量及错误码分布。
- 用户在批准前发现、而内部 QA 未发现的四肢错误数量。
- 每张白猫图平均重生次数。
- 每张图从生成到可提交审批的平均耗时。
- v2 启用后出现的错误自报通过次数，目标必须为零。

不能用“提示词写得更长”或“QA 字段更多”作为成功指标。真正指标是漏检减少且平均返工不增加。

## 14. 验收标准

满足以下条件后才能启用 v2：

- 新规则有唯一 schema 和明确版本号。
- 新白猫素材无法绕过逐肢证据。
- 三前肢加两后肢测试确实失败。
- 挎包双带 P2 规则继续有效。
- `topic5` 仍为 `final_rendering` 且 45/45 视觉项保持 `approved`；S14、S18、S19 历史 v1 未重写。
- 若无并发 episode 写入，使用相同算法重算的 `topic5` 全目录聚合 SHA-256 仍为起始值；本次已有明确并发渲染，故以已枚举的外部派生文件、未变化的 episode state 与 45 项批准视觉 exact-byte lock 作为替代证据，不宣称全目录聚合相等。
- `topic5` 工作区校验通过。
- 新建或用户明确要求重做的白猫 ImageGen 与宣纸最终 normalized 图均经过原尺寸检查、独立编号图检查和完整 PNG 解码后，才进入人工审批边界。

### 14.1 用户未来明确要求重做 S14 时的专项验收

本节不是当前 topic5 的待办，也不授权自动重生。只有用户明确要求重做 S14 后，新版推物母版才按以下标准验收：

- F1、F2：两条前肢都接入肩部，并分别接触任务块。
- H1、H2：两条后肢都接入髋部，一前一后支撑身体。
- 胸腹下方没有第三前爪。
- 挎包下方没有被误认或漏认的额外爪端。
- 两条前肢与两条后肢在编号图中没有共享或分叉。
- 四肢通过后，再确认一只包、两条宽蓝带、包体两端各一个连接点。

任何一项不清楚，都不提交用户审批。

## 15. 实施清单

### 阶段 A：冻结与基线

- [x] 本次不进入 topic5 主视频生产，不重生或改写任何已批准镜头。
- [x] 未运行生图、登记或批准进程。
- [x] 记录 topic5 全目录起始聚合 SHA-256 `e865e7ca570b2e6ec513f48275f135a7fce37528d9f559c9cc7244f6bc517a09`；不以 git diff 代替 episode 字节验证。

### 阶段 B：合同与验证函数

- [x] 定义白猫母版 QA v2。
- [x] 定义白猫动作 QA v2。
- [x] 实现四肢证据校验。
- [x] 保留并复用挎包 P2 校验。
- [x] 定义稳定错误码。

### 阶段 C：记录器接入

- [x] 严格母版记录器只接受新白猫 v2。
- [x] 动作图记录器只接受新白猫 v2。
- [x] 严格修订分支同样执行 v2。
- [x] P0 失败不写 episode state。

### 阶段 D：测试与迁移验证

- [x] 五肢测试失败。
- [x] 合法四肢测试通过。
- [x] P2 双带测试继续通过。
- [ ] 主任务结束时用相同聚合算法复核 topic5 全目录 SHA-256，确认已批准历史素材未变。
- [x] episode workspace validator 通过。

### 阶段 E：未来新建或用户明确重做时执行

- [ ] 对未来新建或用户明确指定重做的白猫资产生成独立编号检查图。
- [ ] 在最终目标字节上先通过 P0，再检查 P1/P2；宣纸路线须对最终 normalized PNG 执行。
- [ ] 只进入对应人工审批边界，不让 QA 直接写 `approved`。
- [ ] 若用户明确要求重做 S14，再执行 14.1；当前 topic5 无此待办。

## 16. 回退原则

若 v2 导致当前工作区出现与新白猫素材无关的失败，应暂停生产并回退本次代码改动，但不得删除已经生成的检查证据或修改已批准资产。回退只恢复执行逻辑，不把失败图片改记为通过。
