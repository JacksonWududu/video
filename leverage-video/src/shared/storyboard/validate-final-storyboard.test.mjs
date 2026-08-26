import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  buildFinalStoryboardTitle,
  extractLockedNarrationBody,
  openingDetailCutMarker,
  openingWorkcardScheduleMarker,
  validateIanStoryboardLayeredSceneSection,
  validateOpeningFirstSentenceRecord,
  validateSummaryDurationSeconds,
} from './validate-final-storyboard.mjs';

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

test('validates the review duration as exact shot frames divided by 30', () => {
  assert.equal(validateSummaryDurationSeconds(
    {shot_id: 'S01', duration_seconds_display: '4.100'},
    {startFrame: 90, endFrame: 213},
  ), '4.100');
  assert.throws(() => validateSummaryDurationSeconds(
    {shot_id: 'S01', duration_seconds_display: '4.1'},
    {startFrame: 90, endFrame: 213},
  ), /does not match exact 30 fps frame timing/);
});

test('uses the episode topic and real first-sentence end frame', () => {
  assert.equal(buildFinalStoryboardTitle({title: '习得性无助'}), '# 《习得性无助》知识视频分镜 v1\n');
  assert.equal(buildFinalStoryboardTitle('行动偏差'), '# 《行动偏差》知识视频分镜 v1\n');
  assert.equal(openingDetailCutMarker(137), '第 137 帧固定零重叠硬切至 S01，不进入转场审核');
  assert.equal(openingWorkcardScheduleMarker(137), 'OPEN-00 从第 0 帧同步承载首句，于第 137 帧零重叠硬切到 S01');
  assert.throws(() => buildFinalStoryboardTitle({title: ''}), /topic title/);
  assert.throws(() => openingDetailCutMarker(0), /positive integer/);
});

test('validates a flat opening-first-sentence record against locked UTF-8 bytes and OPEN-00', () => {
  const prefix = '习得性无助口播稿\n\n';
  const sentence = '苏格拉底的猫，今天聊的是，习得性无助。';
  const lockedBytes = Buffer.from(`${prefix}${sentence}\n后文。`);
  const checksum = sha256(lockedBytes);
  const byteStart = Buffer.byteLength(prefix);
  const byteEnd = byteStart + Buffer.byteLength(sentence);
  const evidence = {
    rule_id: 'opening-first-sentence-record-v1',
    status: 'pass',
    candidate_checksum_sha256: checksum,
    exact_first_sentence: sentence,
    byte_start: byteStart,
    byte_end_exclusive: byteEnd,
    byte_length: byteEnd - byteStart,
    brand_prefix_validation: 'not_applicable',
    topic_extraction: 'not_performed',
  };

  assert.equal(validateOpeningFirstSentenceRecord({
    lockedBytes,
    lockedChecksum: checksum,
    evidence,
    openSourceText: sentence,
  }).result, 'pass');
  assert.throws(() => validateOpeningFirstSentenceRecord({
    lockedBytes,
    lockedChecksum: '0'.repeat(64),
    evidence,
    openSourceText: sentence,
  }), /locked narration checksum is stale/);
  assert.throws(() => validateOpeningFirstSentenceRecord({
    lockedBytes,
    lockedChecksum: checksum,
    evidence: {...evidence, candidate_checksum_sha256: '0'.repeat(64)},
    openSourceText: sentence,
  }), /evidence checksum is stale/);
  assert.throws(() => validateOpeningFirstSentenceRecord({
    lockedBytes,
    lockedChecksum: checksum,
    evidence: {...evidence, byte_start: byteStart + 1, byte_length: byteEnd - byteStart - 1},
    openSourceText: sentence,
  }), /not valid UTF-8|does not match locked bytes/);
  assert.throws(() => validateOpeningFirstSentenceRecord({
    lockedBytes,
    lockedChecksum: checksum,
    evidence: {...evidence, exact_first_sentence: '被篡改的首句。'},
    openSourceText: sentence,
  }), /does not match locked bytes/);
  assert.throws(() => validateOpeningFirstSentenceRecord({
    lockedBytes,
    lockedChecksum: checksum,
    evidence,
    openSourceText: '不一致的 OPEN-00。',
  }), /OPEN-00 source_text/);
});

test('accepts the recorder nested candidate checksum and rejects conflicting projections', () => {
  const sentence = '今天讲一个不带品牌模板的开场。';
  const lockedBytes = Buffer.from(sentence);
  const checksum = sha256(lockedBytes);
  const evidence = {
    rule_id: 'opening-first-sentence-record-v1',
    status: 'pass',
    candidate: {checksum_sha256: checksum, byte_size: lockedBytes.length},
    exact_first_sentence: sentence,
    byte_start: 0,
    byte_end_exclusive: lockedBytes.length,
    byte_length: lockedBytes.length,
    brand_prefix_validation: 'not_applicable',
    topic_extraction: 'not_performed',
  };
  const args = {lockedBytes, lockedChecksum: checksum, evidence, openSourceText: sentence};
  assert.equal(validateOpeningFirstSentenceRecord(args).result, 'pass');
  assert.throws(() => validateOpeningFirstSentenceRecord({
    ...args,
    evidence: {...evidence, candidate_checksum_sha256: 'f'.repeat(64)},
  }), /conflicting candidate checksums/);
});

test('accepts projected opening evidence without inactive brand or topic fields', () => {
  const sentence = '为什么明明困得要死，还是舍不得睡？';
  const lockedBytes = Buffer.from(sentence);
  const checksum = sha256(lockedBytes);
  const evidence = {
    rule_id: 'opening-first-sentence-record-v1',
    status: 'pass',
    candidate_checksum_sha256: checksum,
    exact_first_sentence: sentence,
    byte_start: 0,
    byte_end_exclusive: lockedBytes.length,
    byte_length: lockedBytes.length,
  };
  const args = {lockedBytes, lockedChecksum: checksum, evidence, openSourceText: sentence};
  assert.equal(validateOpeningFirstSentenceRecord(args).result, 'pass');
  assert.throws(() => validateOpeningFirstSentenceRecord({
    ...args,
    evidence: {...evidence, brand_prefix_validation: 'required'},
  }), /must not enforce brand wording/);
  assert.throws(() => validateOpeningFirstSentenceRecord({
    ...args,
    evidence: {...evidence, topic_extraction: 'performed'},
  }), /must not enforce brand wording/);
});

test('extracts locked narration from the authoritative opening byte instead of assuming a heading', () => {
  const body = '第一句。\n第二句。\n';
  const header = '某期口播稿\n\n';
  assert.equal(extractLockedNarrationBody({
    lockedBytes: Buffer.from(`${header}${body}`),
    openingByteStart: Buffer.byteLength(header),
  }), body);
  assert.equal(extractLockedNarrationBody({
    lockedBytes: Buffer.from(body),
    openingByteStart: 0,
  }), body);
  assert.throws(() => extractLockedNarrationBody({
    lockedBytes: Buffer.from(body),
    openingByteStart: 1,
  }), /valid UTF-8/);
});

test('requires an exact static Ian layered-scene plan and rejects old whole-raster motion', () => {
  const sourceText = '一次结果，不等于无法改变。';
  const split = Buffer.byteLength('一次结果，');
  const bytes = Buffer.from(sourceText);
  const plan = {
    contract_version: 'ian-layered-scene-plan-v1',
    shot_id: 'S17',
    narration_source_text_sha256: sha256(Buffer.from(sourceText)),
    scene_renderer: 'ian-static-layered-scene-v1',
    background_policy: 'static-paper-background-v1',
    layer_asset_policy: 'full-canvas-transparent-png-v1',
    layer_entry_transition: {
      contract_version: 'ian-layer-entry-fade-v1',
      duration_frames: 8,
      easing: 'linear',
    },
    motion_policy: {
      scene_transform: 'forbidden',
      layer_transform: 'forbidden',
      mask_reveal: 'forbidden',
      internal_cut: 'forbidden',
      opacity_animation: 'ian-layer-entry-fade-v1',
    },
    layer_count: 2,
    layers: [
      {
        layer_id: 'L01', z_index: 1, semantic_role: 'result',
        source_text_start_byte: 0, source_text_end_byte_exclusive: split,
        source_text: bytes.subarray(0, split).toString(), entry_frame: 0,
      },
      {
        layer_id: 'L02', z_index: 2, semantic_role: 'change',
        source_text_start_byte: split, source_text_end_byte_exclusive: bytes.length,
        source_text: bytes.subarray(split).toString(), entry_frame: 18,
      },
    ],
  };
  const section = `- Ian 分层场景计划：\`ian-layered-scene-plan-v1\`；精确计划 \`${JSON.stringify(plan)}\`。`;
  assert.equal(validateIanStoryboardLayeredSceneSection(section, 'S17', {
    sourceText,
    durationFrames: 60,
  }).layer_count, 2);
  assert.throws(
    () => validateIanStoryboardLayeredSceneSection(
      '- 内部运动计划：`ian-subtle-raster-motion-v1`。',
      'S17',
      {sourceText, durationFrames: 60},
    ),
    /layered-scene/i,
  );
  const transformed = structuredClone(plan);
  transformed.motion_policy.scene_transform = 'allowed';
  assert.throws(
    () => validateIanStoryboardLayeredSceneSection(
      `- Ian 分层场景计划：\`ian-layered-scene-plan-v1\`；精确计划 \`${JSON.stringify(transformed)}\`。`,
      'S17',
      {sourceText, durationFrames: 60},
    ),
    /forbid/i,
  );
});
