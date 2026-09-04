#!/usr/bin/env node
import {isFlipbookRow} from '../flipbook-video/profile.mjs';
import {validateStaticSpread, validateStaticSpreadStoryboardSection} from './static-spread.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {validateEpisodeTransitionReviewProposal} from '../scene-transitions/validate-review-proposal.mjs';
import {parseStoryboardSummary} from '../visual-direction-review-form/contract.mjs';
import {
  buildActionStatePlanSha256,
  validateActionStateSchedule,
} from '../action-state-schedule/contract.mjs';
import {
  IAN_LAYERED_SCENE_PLAN_VERSION,
  validateIanLayeredScenePlan,
  validateIanLayeredSceneRhythmBinding,
} from '../ian-layered-scene/contract.mjs';
import {validateApprovedVisibleTextReviewState} from '../visible-text-review/state-gate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(HERE, '../../../..');
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
};
const sameCanonical = (left, right) => JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));

const resolveRootRelative = (rootRelativePath, label) => {
  if (typeof rootRelativePath !== 'string' || rootRelativePath === '' || path.isAbsolute(rootRelativePath)) {
    throw new Error(`${label} must be root-relative`);
  }
  const resolved = path.resolve(REPOSITORY_ROOT, rootRelativePath);
  if (!resolved.startsWith(`${REPOSITORY_ROOT}${path.sep}`)) throw new Error(`${label} escapes repository root`);
  return resolved;
};

const readChecksumBoundJson = (binding, label) => {
  const absolute = resolveRootRelative(binding?.path, `${label} path`);
  const bytes = fs.readFileSync(absolute);
  if (sha256(bytes) !== binding?.checksum_sha256) throw new Error(`${label} checksum is stale`);
  return JSON.parse(bytes);
};

const parseSections = (markdown) => {
  const matches = [...markdown.matchAll(/^## (OPEN-00|S\d+)\n([\s\S]*?)(?=^## |(?![\s\S]))/gm)];
  const sections = new Map(matches.map((match) => [match[1], match[2]]));
  if (sections.size !== matches.length) throw new Error('storyboard contains duplicate detailed shot sections');
  return sections;
};

const parseSourceText = (section, shotId) => {
  const match = section.match(/- 锁稿原文 source_text：\n```text\n([\s\S]*?)\n```/);
  if (!match) throw new Error(`${shotId} lacks exact source_text`);
  return match[1];
};

const parseTiming = (section, shotId) => {
  const match = section.match(/- 时间 \/ 帧：([0-9.]+)–([0-9.]+) 秒；旁白与合成 `\[(\d+), (\d+)\)`/);
  if (!match) throw new Error(`${shotId} lacks timing/frame binding`);
  return {
    startSeconds: Number(match[1]),
    endSeconds: Number(match[2]),
    startFrame: Number(match[3]),
    endFrame: Number(match[4]),
  };
};

const selectedVisibleText = (selection) => selection.visible_text_mode === 'none'
  ? '无'
  : selection.exact_visible_text;

export const buildFinalStoryboardTitle = (topic) => {
  const title = typeof topic === 'string' ? topic : topic?.title;
  if (typeof title !== 'string' || title === '' || title !== title.trim() || /[\r\n》]/.test(title)) {
    throw new Error('episode topic title is missing or invalid');
  }
  return `# 《${title}》知识视频分镜 v1\n`;
};

export const DIRECT_FIRST_SHOT_VERSION = 'direct-first-shot-v1';
export const directFirstShotWorkcardMarker = () =>
  `开场：\`${DIRECT_FIRST_SHOT_VERSION}\`；S01 与旁白从第 0 帧同时开始；无 OPEN-00；发布封面不进入分镜或时间轴`;

export const extractLockedNarrationBody = ({lockedBytes, openingByteStart}) => {
  if (!Buffer.isBuffer(lockedBytes)
    || !Number.isInteger(openingByteStart)
    || openingByteStart < 0
    || openingByteStart >= lockedBytes.length) {
    throw new Error('locked narration opening byte start is invalid');
  }
  try {
    return new TextDecoder('utf-8', {fatal: true}).decode(lockedBytes.subarray(openingByteStart));
  } catch {
    throw new Error('locked narration body is not valid UTF-8');
  }
};

export const openingDetailCutMarker = (firstSentenceEndFrame) => {
  if (!Number.isInteger(firstSentenceEndFrame) || firstSentenceEndFrame <= 0) {
    throw new Error('first_sentence_end_frame must be a positive integer');
  }
  return `第 ${firstSentenceEndFrame} 帧固定零重叠硬切至 S01，不进入转场审核`;
};

export const openingWorkcardScheduleMarker = (firstSentenceEndFrame) => {
  if (!Number.isInteger(firstSentenceEndFrame) || firstSentenceEndFrame <= 0) {
    throw new Error('first_sentence_end_frame must be a positive integer');
  }
  return `OPEN-00 从第 0 帧同步承载首句，于第 ${firstSentenceEndFrame} 帧零重叠硬切到 S01`;
};

export const validateIanStoryboardLayeredSceneSection = (
  section,
  shotId,
  {sourceText, durationFrames} = {},
) => {
  if (typeof section !== 'string' || typeof shotId !== 'string' || shotId === '') {
    throw new Error('Ian storyboard section and shot id are required');
  }
  const match = section.match(
    /Ian 分层场景计划：`ian-layered-scene-plan-v1`；精确计划 `([^`\n]+)`/,
  );
  if (!match) throw new Error(`${shotId} lacks the exact Ian layered-scene JSON plan`);
  let scenePlan;
  try {
    scenePlan = JSON.parse(match[1]);
  } catch {
    throw new Error(`${shotId} Ian layered-scene JSON plan is invalid`);
  }
  if (scenePlan.contract_version !== IAN_LAYERED_SCENE_PLAN_VERSION) {
    throw new Error(`${shotId} Ian layered-scene plan version is invalid`);
  }
  return validateIanLayeredScenePlan(scenePlan, {
    shotId,
    sourceText,
    durationFrames,
    fps: 30,
  });
};

export const validateOpeningFirstSentenceRecord = ({
  lockedBytes,
  lockedChecksum,
  evidence,
  openSourceText,
}) => {
  if (!Buffer.isBuffer(lockedBytes)) throw new Error('locked narration bytes are missing');
  const actualChecksum = sha256(lockedBytes);
  if (lockedChecksum !== actualChecksum) throw new Error('locked narration checksum is stale');
  if (evidence?.rule_id !== 'opening-first-sentence-record-v1' || evidence?.status !== 'pass') {
    throw new Error('opening first-sentence evidence is missing or invalid');
  }
  const flatChecksum = evidence.candidate_checksum_sha256;
  const nestedChecksum = evidence.candidate?.checksum_sha256;
  const checksumPattern = /^[a-f0-9]{64}$/;
  if ((flatChecksum !== undefined && !checksumPattern.test(flatChecksum))
    || (nestedChecksum !== undefined && !checksumPattern.test(nestedChecksum))) {
    throw new Error('opening first-sentence evidence candidate checksum is invalid');
  }
  if (flatChecksum !== undefined && nestedChecksum !== undefined && flatChecksum !== nestedChecksum) {
    throw new Error('opening first-sentence evidence has conflicting candidate checksums');
  }
  const evidenceChecksum = nestedChecksum ?? flatChecksum;
  if (evidenceChecksum !== actualChecksum) {
    throw new Error('opening first-sentence evidence checksum is stale');
  }
  if (evidence.candidate?.byte_size !== undefined
    && evidence.candidate.byte_size !== lockedBytes.length) {
    throw new Error('opening first-sentence evidence byte size is stale');
  }
  const start = evidence.byte_start;
  const end = evidence.byte_end_exclusive;
  if (!Number.isInteger(start) || !Number.isInteger(end)
    || start < 0 || end <= start || end > lockedBytes.length
    || evidence.byte_length !== end - start) {
    throw new Error('opening first-sentence byte range is invalid');
  }
  let exactSlice;
  try {
    exactSlice = new TextDecoder('utf-8', {fatal: true}).decode(lockedBytes.subarray(start, end));
  } catch {
    throw new Error('opening first-sentence byte range is not valid UTF-8');
  }
  if (typeof evidence.exact_first_sentence !== 'string'
    || evidence.exact_first_sentence === ''
    || exactSlice !== evidence.exact_first_sentence) {
    throw new Error('opening first-sentence exact text does not match locked bytes');
  }
  if (openSourceText !== evidence.exact_first_sentence) {
    throw new Error('OPEN-00 source_text does not match opening first-sentence evidence');
  }
  if ((evidence.brand_prefix_validation !== undefined
      && evidence.brand_prefix_validation !== 'not_applicable')
    || (evidence.topic_extraction !== undefined
      && evidence.topic_extraction !== 'not_performed')) {
    throw new Error('opening evidence must not enforce brand wording or extract a topic');
  }
  return {
    rule_id: 'opening-first-sentence-record-v1',
    result: 'pass',
    checksum_sha256: actualChecksum,
    byte_start: start,
    byte_end_exclusive: end,
    exact_first_sentence: exactSlice,
  };
};

export const validateSummaryDurationSeconds = (summaryRow, timing, fps = 30) => {
  if (fps !== 30 || !Number.isInteger(timing.startFrame) || !Number.isInteger(timing.endFrame)
    || timing.endFrame <= timing.startFrame) {
    throw new Error(`${summaryRow.shot_id} Summary duration requires positive integer 30 fps timing`);
  }
  const expected = ((timing.endFrame - timing.startFrame) / fps).toFixed(3);
  if (summaryRow.duration_seconds_display !== expected) {
    throw new Error(`${summaryRow.shot_id} Summary duration does not match exact 30 fps frame timing`);
  }
  return expected;
};

export const validateFinalStoryboard = (episodeWorkspace, storyboardRelativePath) => {
  const workspacePath = resolveRootRelative(episodeWorkspace, 'episode workspace');
  const storyboardPath = resolveRootRelative(storyboardRelativePath, 'storyboard path');
  if (!storyboardPath.startsWith(`${workspacePath}${path.sep}`)) throw new Error('storyboard is outside episode workspace');

  const state = JSON.parse(fs.readFileSync(path.join(workspacePath, 'schema/episode-state.json'), 'utf8'));
  if (state.workspace_path !== episodeWorkspace || ![
    'transition_review_approved',
    'storyboard_qa_passed',
    'awaiting_storyboard_review',
    'storyboard_review_approved',
    'storyboard_policy_authorized',
    'visual_production',
    'awaiting_visual_asset_review',
    'awaiting_precomposition_visual_review',
    'visual_assets_locked',
    'composition_locked',
    'awaiting_caption_delivery_choice',
    'final_rendering',
    'delivered',
  ].includes(state.current_phase)) {
    throw new Error('episode is not ready for final storyboard QA');
  }
  const transitionValidation = validateEpisodeTransitionReviewProposal(episodeWorkspace);
  if (transitionValidation.pending_boundary_count !== 0) throw new Error('transition review still has pending rows');

  const storyboardBytes = fs.readFileSync(storyboardPath);
  const markdown = storyboardBytes.toString('utf8');
  if (!markdown.startsWith(buildFinalStoryboardTitle(state.topic)) || markdown.includes('知识视频分镜草案')) {
    throw new Error('final storyboard title is not locked');
  }
  const summary = parseStoryboardSummary(markdown);
  const sections = parseSections(markdown);
  const review = readChecksumBoundJson(state.visual_direction_review, 'visual direction review');
  const proposal = readChecksumBoundJson(state.transition_review, 'transition review');
  validateApprovedVisibleTextReviewState({
    repositoryRoot: REPOSITORY_ROOT,
    episodeWorkspace,
    state,
    visualDirectionReview: review,
    storyboardMarkdown: markdown,
  });
  const expectedMappingStatus = state.workflow_approval_mode?.approval_mode === 'one_click'
    ? 'policy_authorized'
    : 'approved';
  if (review.status !== expectedMappingStatus || proposal.status !== expectedMappingStatus) {
    throw new Error('direction or transition authorization is missing');
  }

  const flipbookRowCount = review.rows.filter(isFlipbookRow).length;
  const flipbookPresentation = isFlipbookRow(review);
  if (flipbookRowCount !== (flipbookPresentation ? review.rows.length : 0)) {
    throw new Error('storyboard cannot mix flipbook and non-flipbook rows');
  }
  const expectedShotIds = flipbookPresentation
    ? review.rows.map((row) => row.shot_id)
    : ['OPEN-00', ...review.rows.map((row) => row.shot_id)];
  if (!sameCanonical(summary.map((row) => row.shot_id), expectedShotIds)
    || !sameCanonical([...sections.keys()], expectedShotIds)) {
    throw new Error('Summary and detailed shot order differ from the approved active map');
  }
  if (flipbookPresentation && (
    expectedShotIds[0] !== 'S01'
    || /^\| OPEN-00 \||^## OPEN-00$/m.test(markdown)
    || markdown.includes('固定封面（cover-only-v1）')
  )) {
    throw new Error('flipbook storyboard must use direct-first-shot-v1 without an opening row');
  }

  const sourceTexts = [];
  const timings = [];
  const firstSentenceEndFrame = flipbookPresentation ? null
    : state.opening_first_sentence_boundary?.first_sentence_end_frame
      ?? state.first_sentence_timing?.first_sentence_end_frame;
  const detailCutMarker = flipbookPresentation ? null : openingDetailCutMarker(firstSentenceEndFrame);
  for (const [index, summaryRow] of summary.entries()) {
    const shotId = summaryRow.shot_id;
    const section = sections.get(shotId);
    const visualMatch = section.match(/^- 画面：(.+)$/m);
    if (!visualMatch || visualMatch[1] !== summaryRow.visual_description) {
      throw new Error(`${shotId} Summary/detail visual description mismatch`);
    }
    const sourceText = parseSourceText(section, shotId);
    if (sourceText !== summaryRow.locked_narration) throw new Error(`${shotId} Summary/detail narration mismatch`);
    sourceTexts.push(sourceText);
    const timing = {shotId, ...parseTiming(section, shotId)};
    validateSummaryDurationSeconds(summaryRow, timing);
    timings.push(timing);

    if (!flipbookPresentation && shotId === 'OPEN-00') {
      if (summaryRow.white_cat !== '不适用'
        || summaryRow.visual_generation_route !== '固定封面（cover-only-v1）'
        || summaryRow.visible_text !== '无'
        || !section.includes(detailCutMarker)) {
        throw new Error('OPEN-00 fixed contract is invalid');
      }
      continue;
    }
    const row = review.rows[flipbookPresentation ? index : index - 1];
    const decision = row?.user_selection;
    if (isFlipbookRow(row)) {
      validateStaticSpread(row.static_spread, {sourceText, shotId});
      validateStaticSpreadStoryboardSection(section, shotId, {sourceText});
    }
    if (decision?.status !== expectedMappingStatus
      || summaryRow.white_cat !== String(decision.white_cat_present)
      || summaryRow.visual_generation_route !== decision.visual_generation_route
      || summaryRow.visible_text !== selectedVisibleText(decision)) {
      throw new Error(`${shotId} Summary does not match authorized visual direction`);
    }
    if (!section.includes(`白猫 \`${decision.white_cat_present}\``)
      || !section.includes(decision.visual_generation_route)) {
      throw new Error(`${shotId} detail does not bind approved cat/route`);
    }
    if (decision.visual_generation_route === 'local-video-file'
      && !section.includes(`本地视频源：\`${decision.local_video_source_path}\``)) {
      throw new Error(`${shotId} detail does not bind the approved local video path`);
    }
    if (decision.visible_text_mode === 'none') {
      if (!section.includes('可见文字：`none`') && !section.includes('可见文字 `none`')) {
        throw new Error(`${shotId} detail must forbid visible text`);
      }
    } else if (!section.includes(`- 可见文字：\`required\`；\`${decision.exact_visible_text}\`；${decision.visible_text_placement}`)) {
      throw new Error(`${shotId} detail does not bind approved visible text`);
    }
  }

  const lockedScript = flipbookPresentation
    ? state.locked_script ?? {
      path: state.narration_script_source?.locked_script_path,
      checksum_sha256: state.narration_script_source?.locked_script_checksum_sha256,
    }
    : state.locked_script;
  const lockedBytes = fs.readFileSync(resolveRootRelative(lockedScript.path, 'locked narration path'));
  if (flipbookPresentation) {
    if (sha256(lockedBytes) !== lockedScript.checksum_sha256) {
      throw new Error('locked narration checksum is stale');
    }
    let lockedNarration;
    try {
      lockedNarration = new TextDecoder('utf-8', {fatal: true}).decode(lockedBytes);
    } catch {
      throw new Error('locked narration is not valid UTF-8');
    }
    const timingAuthority = readChecksumBoundJson(state.storyboard_timing, 'storyboard timing');
    const timingRows = timingAuthority.shots ?? timingAuthority.rows;
    if (timingAuthority.contract_version !== 'storyboard-shot-timing-v1'
        || !Array.isArray(timingRows)
        || timingRows.length !== expectedShotIds.length) {
      throw new Error('flipbook direct-first storyboard timing authority is missing or stale');
    }
    let lockedByteCursor = 0;
    const reconstructedNarration = timingRows.map((row, index) => {
      const sourceBytes = Buffer.from(sourceTexts[index], 'utf8');
      if (row.shot_id !== expectedShotIds[index]
          || row.source_text !== sourceTexts[index]
          || row.locked_utf8_byte_start !== lockedByteCursor
          || row.locked_utf8_spoken_end_exclusive !== lockedByteCursor + sourceBytes.length
          || typeof row.inter_shot_gap_text !== 'string') {
        throw new Error(`${expectedShotIds[index]} timing narration-byte binding is stale`);
      }
      lockedByteCursor += sourceBytes.length + Buffer.byteLength(row.inter_shot_gap_text);
      return `${row.source_text}${row.inter_shot_gap_text}`;
    }).join('');
    if (lockedByteCursor !== lockedBytes.length || reconstructedNarration !== lockedNarration) {
      throw new Error('flipbook storyboard narration does not cover the locked script exactly once in order');
    }
  } else {
    validateOpeningFirstSentenceRecord({
      lockedBytes,
      lockedChecksum: lockedScript.checksum_sha256,
      evidence: state.opening_narration_evidence,
      openSourceText: sourceTexts[0],
    });
    const lockedBody = extractLockedNarrationBody({
      lockedBytes,
      openingByteStart: state.opening_narration_evidence.byte_start,
    });
    const reconstructedBody = `${sourceTexts.join('\n')}${lockedBody.endsWith('\n') ? '\n' : ''}`;
    if (reconstructedBody !== lockedBody) {
      throw new Error('storyboard narration does not cover the locked body exactly once in order');
    }
  }

  const fps = 30;
  const masterFrames = Math.ceil(state.narration_audio.duration_seconds * fps);
  for (const [index, timing] of timings.entries()) {
    if (!Number.isFinite(timing.startSeconds) || !Number.isFinite(timing.endSeconds)
      || timing.startSeconds < 0 || timing.endSeconds <= timing.startSeconds
      || timing.startFrame !== (index === 0 ? 0 : timings[index - 1].endFrame)
      || timing.endFrame <= timing.startFrame) {
      throw new Error(`${timing.shotId} timing is not monotonic and contiguous`);
    }
  }
  if (flipbookPresentation) {
    if (timings[0].startFrame !== 0 || timings.at(-1).endFrame !== masterFrames) {
      throw new Error('flipbook direct-first or final master frame coverage is invalid');
    }
    if (!markdown.includes('画布：16:9，1920×1080，30 fps')
        || !markdown.includes(directFirstShotWorkcardMarker())
        || state.storyboard_draft?.direct_first_shot_contract !== DIRECT_FIRST_SHOT_VERSION) {
      throw new Error('flipbook canvas or direct-first workcard binding is missing');
    }
  } else {
    if (timings.at(-1).endFrame !== masterFrames || timings[0].endFrame !== firstSentenceEndFrame) {
      throw new Error('opening or final master frame coverage is invalid');
    }
    if (!markdown.includes('画布：16:9，1920×1080，30 fps')
        || !markdown.includes(openingWorkcardScheduleMarker(firstSentenceEndFrame))) {
      throw new Error('canvas or opening schedule workcard binding is missing');
    }
  }

  const audioPath = resolveRootRelative(state.narration_audio.archive_path, 'narration audio path');
  if (state.narration_audio.status !== 'validated_master'
    || sha256(fs.readFileSync(audioPath)) !== state.narration_audio.checksum_sha256) {
    throw new Error('validated narration master is stale');
  }
  const audioValidation = readChecksumBoundJson({
    path: state.narration_audio.audio_validation_path,
    checksum_sha256: state.narration_audio.audio_validation_checksum_sha256,
  }, 'audio validation');
  if (audioValidation.status !== 'pass'
    || typeof audioValidation.qa_result !== 'string'
    || !audioValidation.qa_result.startsWith('pass')) {
    throw new Error('audio validation did not pass');
  }
  for (const timestampPath of [
    state.narration_audio.word_timestamps_primary_path,
    state.narration_audio.word_timestamps_check_path,
  ]) {
    const timestamp = JSON.parse(fs.readFileSync(resolveRootRelative(timestampPath, 'word timestamp path'), 'utf8'));
    if (!Array.isArray(timestamp.segments) || timestamp.segments.length === 0
      || Math.abs(timestamp.duration - state.narration_audio.duration_seconds) > 0.001) {
      throw new Error('word timestamp authority is missing or duration-stale');
    }
  }

  const mappingMatch = markdown.match(/## 锁定 scene-transition-v3 映射[\s\S]*?```json\n([\s\S]*?)\n```\s*$/);
  if (!mappingMatch) throw new Error('storyboard lacks its locked structured transition mapping');
  const embeddedTransitions = JSON.parse(mappingMatch[1]);
  if (!sameCanonical(embeddedTransitions, proposal.rows)) {
    throw new Error('storyboard transition mapping differs from the approved review artifact');
  }
  proposal.rows.forEach((row, index) => {
    const section = sections.get(row.source_shot_id);
    const exactBinding = `映射键 \`${row.source_shot_id}→${row.next_shot_id}\`，\`${row.kind}\` / ${row.duration_in_frames} 帧`;
    if (!section.includes(exactBinding)) throw new Error(`${row.source_shot_id} outgoing transition binding is missing`);
    const timing = timings[flipbookPresentation ? index : index + 1];
    if (row.duration_in_frames > timing.endFrame - timing.startFrame) {
      throw new Error(`${row.source_shot_id} transition is longer than the source shot`);
    }
  });
  if (!sections.get(expectedShotIds.at(-1)).includes('终端干净保持，无出场转场')) {
    throw new Error('terminal clean hold is missing');
  }

  const narrativeIds = review.rows.filter((row) => (
    row.scene_class === 'narrative_illustration'
    && !isFlipbookRow(row)
    && row.user_selection.visual_generation_route !== 'local-video-file'
  )).map((row) => row.shot_id);
  const visualRhythm = readChecksumBoundJson(state.storyboard_visual_rhythm, 'storyboard visual rhythm');
  if (!['storyboard-visual-rhythm-v1', 'storyboard-visual-rhythm-v2'].includes(
    visualRhythm.contract_version,
  )) {
    throw new Error('storyboard visual rhythm version is unsupported');
  }
  const expectedScheduleVersion = visualRhythm.contract_version === 'storyboard-visual-rhythm-v2'
    ? 'action-state-schedule-v4'
    : 'action-state-schedule-v3';
  const actionScheduleSet = readChecksumBoundJson({
    path: state.storyboard_visual_rhythm?.action_state_schedule_set_path,
    checksum_sha256: state.storyboard_visual_rhythm?.action_state_schedule_set_checksum_sha256,
  }, 'action state schedule set');
  if (actionScheduleSet.contract_version !== 'action-state-schedule-set-v1'
    || actionScheduleSet.storyboard?.path !== review.storyboard.path
    || actionScheduleSet.storyboard?.checksum_sha256 !== review.storyboard.checksum_sha256
    || actionScheduleSet.visual_rhythm?.path !== state.storyboard_visual_rhythm.path
    || actionScheduleSet.visual_rhythm?.checksum_sha256 !== state.storyboard_visual_rhythm.checksum_sha256
    || !Array.isArray(actionScheduleSet.schedules)
    || actionScheduleSet.schedule_count !== actionScheduleSet.schedules.length) {
    throw new Error(`${expectedScheduleVersion} set is missing or stale`);
  }
  const actionScheduleByShotId = new Map(actionScheduleSet.schedules.map((entry) => [entry.shot_id, entry]));
  if (!sameCanonical([...actionScheduleByShotId.keys()], narrativeIds)) {
    throw new Error(`${expectedScheduleVersion} set does not cover every narrative shot exactly once`);
  }
  for (const shotId of narrativeIds) {
    const section = sections.get(shotId);
    const timing = timings.find((entry) => entry.shotId === shotId);
    const shotFrames = timing.endFrame - timing.startFrame;
    const scheduleEntry = actionScheduleByShotId.get(shotId);
    const schedule = scheduleEntry?.schedule;
    const validation = validateActionStateSchedule(schedule, {
      totalFrames: shotFrames,
      fps,
      densityMode: expectedScheduleVersion === 'action-state-schedule-v4'
        ? visualRhythm.density_mode
        : null,
      densitySelectionSha256: expectedScheduleVersion === 'action-state-schedule-v4'
        ? visualRhythm.visual_density_selection_sha256
        : null,
    });
    if (schedule?.contract_version !== expectedScheduleVersion
      || validation.result !== 'pass'
      || scheduleEntry.shot_start_frame !== timing.startFrame
      || scheduleEntry.shot_end_frame !== timing.endFrame
      || schedule.source_text !== parseSourceText(section, shotId)
      || scheduleEntry.state_plan_sha256 !== buildActionStatePlanSha256(schedule)
      || !section.includes(`motion_tier: ${schedule.motion_tier}`)
      || !section.includes('`intra-shot-transition-v1`')) {
      throw new Error(`${shotId} ${expectedScheduleVersion} storyboard binding is stale`);
    }
  }

  const ianRows = review.rows.filter(
    (candidate) => candidate.user_selection.visual_generation_route === 'ian-handdrawn-ppt' && !isFlipbookRow(candidate),
  );
  const rhythmShotById = new Map(
    (visualRhythm.shots ?? []).map((rhythmShot) => [rhythmShot.shot_id, rhythmShot]),
  );
  for (const row of review.rows.filter(isFlipbookRow)) {
    const rhythmShot = rhythmShotById.get(row.shot_id);
    if (!isFlipbookRow(rhythmShot) || rhythmShot.motion_tier !== 'static_spread'
      || !sameCanonical(rhythmShot.static_spread, row.static_spread)) {
      throw new Error(`${row.shot_id} static spread rhythm binding is stale`);
    }
  }
  for (const row of ianRows) {
    const section = sections.get(row.shot_id);
    const timing = timings.find((entry) => entry.shotId === row.shot_id);
    const plan = validateIanStoryboardLayeredSceneSection(section, row.shot_id, {
      sourceText: parseSourceText(section, row.shot_id),
      durationFrames: timing.endFrame - timing.startFrame,
    });
    validateIanLayeredSceneRhythmBinding(plan, {
      shotStartFrame: timing.startFrame,
      rhythmShot: rhythmShotById.get(row.shot_id),
    });
  }

  const result = {
    contract_version: 'storyboard-final-qa-v1',
    result: 'pass',
    episode_workspace: episodeWorkspace,
    storyboard: {
      path: storyboardRelativePath,
      checksum_sha256: sha256(storyboardBytes),
    },
    checks: {
      workcard_artifacts: 'pass_storyboard_and_validated_narration_audio',
      visual_direction_selection_binding: 'pass',
      summary_table_equality: 'pass',
      summary_duration_seconds: 'pass_exact_frames_divided_by_30_three_decimals',
      transition_selection_binding: 'pass',
      narration_coverage: 'pass_exact_body_bytes_once_in_order',
      ...(flipbookPresentation ? {
        direct_first_shot: 'pass_s01_and_narration_start_at_frame_zero_without_timeline_cover',
      } : {
        opening_first_sentence_record: 'pass_checksum_utf8_byte_range_and_open_source_text',
        opening_schedule: 'pass',
      }),
      timing_source: 'pass_validated_master_and_dual_offline_word_timestamps',
      canvas: 'pass_1920x1080_30fps',
      subtitle_normalization: 'pass_source_text_spans_preserved',
      action_continuity_plan: 'pass',
      ian_layered_scene_plan: 'pass_static_layers_exact_text_ranges_and_visual_rhythm_events',
    },
    generated_shot_count: review.rows.length,
    ordinary_boundary_count: proposal.rows.length,
    final_master_frames: masterFrames,
  };
  return result;
};

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  if (process.argv.length !== 4) {
    console.error('usage: node validate-final-storyboard.mjs <episode-workspace> <storyboard-root-relative-path>');
    process.exit(2);
  }
  try {
    process.stdout.write(`${JSON.stringify(validateFinalStoryboard(process.argv[2], process.argv[3]), null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
