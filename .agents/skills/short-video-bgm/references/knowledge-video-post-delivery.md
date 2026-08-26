# 知识视频交付后 BGM 推荐契约

## 适用范围

当 `$run-knowledge-video` 完成一期标准视频或 `revoice_variant` 的交付事务后，执行 `knowledge-video-post-delivery-bgm-recommendation-v1`。此步骤每期必做，只提供候选建议，不下载音乐、不混音、不改写、不覆盖、不重新渲染已交付视频。

旧的已完成 episode 若没有本契约证据，保持只读有效；此后新建或恢复并产生新交付事务的标准 episode 与 revoice 事务都必须执行。

## 输入与顺序

1. 先确认活动交付事务已通过，交付 manifest 的角色集合严格等于 `required_delivery_roles`，并且用户交付副本与内部完整成片校验和一致。
2. 若交付角色含 `caption_free_master`，只分析它；否则分析 `captioned_master`。`both` 也只分析一次，字幕层不参与配乐判断。
3. 同时读取该事务绑定的主题、锁定口播、已批准分镜、真实成片时长、镜头节奏、情绪弧、旁白强度、音效密度、当前 `bgm.mode`，以及已记录的平台和商用意图。未知的平台或商用意图必须写为 `unknown`，不得猜测。
4. 检查实际交付成片及上述状态证据。以内容语义、情绪弧、旁白让位、节奏/段落、授权边界为推荐依据；知识口播通常从 90–110 BPM 的轻背景、纯音乐、可循环候选开始筛选，但具体视频证据优先。
5. 联网核验每个候选的官方曲目页与当前授权页。只能给可直接试听或定位到该曲目的真实链接，不得用曲库首页冒充曲目链接，不得编造曲名、BPM、作者、授权或可商用结论。BPM 未发布且未实测时使用 `null` 和 `unpublished`。

## 推荐输出

给出 3–5 首有排序的候选。每首必须包含：

- 曲名、作者/创作者、来源库；
- 直接试听曲目链接、官方授权链接；
- 授权类型、署名要求、商用边界、平台限制、风险等级；
- BPM 数值或 `null`、BPM 依据；
- 情绪、与本期内容/情绪/节奏/旁白的匹配理由；
- 循环、裁切、起播位置或避让旁白的剪辑建议；
- 链接与授权核验时间。

把用户可读报告写入 `docs/post-delivery-bgm-recommendation-v1.md`，把同一证据写入 `schema/post-delivery-bgm-recommendation-v1.json`。状态只保存这两个文件的根相对路径和 SHA-256。

JSON 至少采用以下字段：

```json
{
  "contract_version": "knowledge-video-post-delivery-bgm-recommendation-v1",
  "status": "complete",
  "scope": "advisory_only_no_media_mutation",
  "delivery_transaction_manifest": {
    "path": "leverage-video/src/topicN/schema/delivery-transaction-vN.json",
    "checksum_sha256": "..."
  },
  "analysis_master": {
    "role": "caption_free_master",
    "path": "leverage-video/src/topicN/assets/video/master.mp4",
    "checksum_sha256": "..."
  },
  "recommendation_basis": {
    "content_track": "knowledge_explainer",
    "topic": "...",
    "emotion_arc": "...",
    "pacing": "...",
    "narration_and_sfx": "...",
    "distribution_intent": "unknown"
  },
  "recommendations": [
    {
      "rank": 1,
      "title": "...",
      "creator": "...",
      "source_name": "...",
      "audition_url": "https://...",
      "license_url": "https://...",
      "license_type": "...",
      "attribution_requirement": "...",
      "commercial_boundary": "...",
      "platform_restrictions": "...",
      "risk_level": "low",
      "verified_at": "...",
      "bpm": null,
      "bpm_basis": "unpublished",
      "emotion": "...",
      "fit_reason": "...",
      "editing_note": "..."
    }
  ],
  "mutation_evidence": {
    "music_downloaded": false,
    "music_mixed": false,
    "delivered_master_changed": false
  },
  "report": {
    "path": "leverage-video/src/topicN/docs/post-delivery-bgm-recommendation-v1.md",
    "checksum_sha256": "..."
  }
}
```

## 阻断与恢复

交付事务通过后先把 phase 设为 `awaiting_post_delivery_bgm_recommendation`。若曲目页、授权页、网络或 Skill 不可用，保留已交付视频不变，在 `blockers` 中记录原因，停在此 phase；不得用未核实候选凑数，也不得声称整期工作流完成。恢复时只重做推荐与核验，不重新渲染。

只有 3–5 首候选、两个报告文件、交付绑定、成片绑定、授权字段和零媒体变更证据都通过验证后，才把标准 episode 写为 `delivered`，或把派生事务写为 `revoice_variant_delivered`。最终回复先列出交付视频，再列出每首候选的直接试听链接和授权边界。
