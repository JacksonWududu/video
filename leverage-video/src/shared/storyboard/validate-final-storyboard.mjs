#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {validateEpisodeTransitionReviewProposal} from '../scene-transitions/validate-review-proposal.mjs';
import {parseStoryboardSummary} from '../visual-direction-review-form/contract.mjs';

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
  const match = section.match(/- 锁稿原文 source_text：\n```text\n([\s\S]*?)```/);
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
    'visual_production',
    'awaiting_visual_asset_review',
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
  if (!markdown.startsWith('# 《知行合一》知识视频分镜 v1\n') || markdown.includes('知识视频分镜草案')) {
    throw new Error('final storyboard title is not locked');
  }
  const summary = parseStoryboardSummary(markdown);
  const sections = parseSections(markdown);
  const review = readChecksumBoundJson(state.visual_direction_review, 'visual direction review');
  const proposal = readChecksumBoundJson(state.transition_review, 'transition review');
  if (review.status !== 'approved' || proposal.status !== 'approved') {
    throw new Error('direction or transition approval is missing');
  }

  const expectedShotIds = ['OPEN-00', ...review.rows.map((row) => row.shot_id)];
  if (!sameCanonical(summary.map((row) => row.shot_id), expectedShotIds)
    || !sameCanonical([...sections.keys()], expectedShotIds)) {
    throw new Error('Summary and detailed shot order differ from the approved active map');
  }

  const sourceTexts = [];
  const timings = [];
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
    timings.push({shotId, ...parseTiming(section, shotId)});

    if (shotId === 'OPEN-00') {
      if (summaryRow.white_cat !== '不适用'
        || summaryRow.visual_generation_route !== '固定封面（cover-only-v1）'
        || summaryRow.visible_text !== '无'
        || !section.includes('第 88 帧固定零重叠硬切至 S01，不进入转场审核')) {
        throw new Error('OPEN-00 fixed contract is invalid');
      }
      continue;
    }
    const decision = review.rows[index - 1]?.user_selection;
    if (decision?.status !== 'approved'
      || summaryRow.white_cat !== String(decision.white_cat_present)
      || summaryRow.visual_generation_route !== decision.visual_generation_route
      || summaryRow.visible_text !== selectedVisibleText(decision)) {
      throw new Error(`${shotId} Summary does not match approved visual direction`);
    }
    if (!section.includes(`白猫 \`${decision.white_cat_present}\``)
      || !section.includes(decision.visual_generation_route)) {
      throw new Error(`${shotId} detail does not bind approved cat/route`);
    }
    if (decision.visible_text_mode === 'none') {
      if (!section.includes('可见文字：`none`') && !section.includes('可见文字 `none`')) {
        throw new Error(`${shotId} detail must forbid visible text`);
      }
    } else if (!section.includes(`- 可见文字：\`required\`；\`${decision.exact_visible_text}\`；${decision.visible_text_placement}`)) {
      throw new Error(`${shotId} detail does not bind approved visible text`);
    }
  }

  const lockedBytes = fs.readFileSync(resolveRootRelative(state.locked_script.path, 'locked narration path'));
  if (sha256(lockedBytes) !== state.locked_script.checksum_sha256) throw new Error('locked narration checksum is stale');
  const lockedLines = lockedBytes.toString('utf8').split(/\r?\n/);
  if (lockedLines[1] !== '' || sourceTexts.join('') !== lockedLines.slice(2).join('\n')) {
    throw new Error('storyboard narration does not cover the locked body exactly once in order');
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
  if (timings.at(-1).endFrame !== masterFrames || timings[0].endFrame !== state.first_sentence_timing.first_sentence_end_frame) {
    throw new Error('opening or final master frame coverage is invalid');
  }
  if (!markdown.includes('画布：16:9，1920×1080，30 fps')
    || !markdown.includes('OPEN-00 从第 0 帧同步承载首句，于第 88 帧零重叠硬切到 S01')) {
    throw new Error('canvas or opening schedule workcard binding is missing');
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
    if (row.duration_in_frames > timings[index + 1].endFrame - timings[index + 1].startFrame) {
      throw new Error(`${row.source_shot_id} transition is longer than the source shot`);
    }
  });
  if (!sections.get(expectedShotIds.at(-1)).includes('终端干净保持，无出场转场')) {
    throw new Error('terminal clean hold is missing');
  }

  const narrativeIds = review.rows.filter((row) => row.scene_class === 'narrative_illustration').map((row) => row.shot_id);
  for (const shotId of narrativeIds) {
    const section = sections.get(shotId);
    const timing = timings.find((entry) => entry.shotId === shotId);
    const allocatedFamily = section.match(/- 动作族：(?:`action-state-schedule-v2`，)?(\d+) 状态、(\d+) 变体，帧分配 `([0-9/]+)`/);
    const equalFamily = section.match(/- 动作族：(?:`action-state-schedule-v2`，)?(\d+) 状态、(\d+) 变体，各 (\d+) 帧/);
    if (!allocatedFamily && !equalFamily) throw new Error(`${shotId} lacks a machine-checkable action family`);
    const family = allocatedFamily ?? equalFamily;
    const stateCount = Number(family[1]);
    const variantCount = Number(family[2]);
    const allocations = allocatedFamily
      ? allocatedFamily[3].split('/').map(Number)
      : Array(stateCount).fill(Number(equalFamily[3]));
    if (variantCount !== stateCount - 1 || allocations.length !== stateCount) {
      throw new Error(`${shotId} action family count mismatch`);
    }
    const shotFrames = timing.endFrame - timing.startFrame;
    if (shotId === 'S18') {
      if (allocations.reduce((sum, value) => sum + value, 0) !== 158
        || !section.includes('`first-shot-visual-inheritance-v1`')
        || !section.includes('最终视觉态在 `[4543, 4969)` 保持 426 帧')) {
        throw new Error('S18 merged action/hold exception is invalid');
      }
    } else {
      const computed = Math.max(Math.min(Math.max(Math.floor(shotFrames / 45 + 0.5), 1), 5), Math.ceil(shotFrames / 75));
      if (computed > 5 || stateCount !== computed
        || allocations.reduce((sum, value) => sum + value, 0) !== shotFrames
        || allocations.some((value) => value < 18 || value > 75)
        || allocations.slice(1).some((value) => value - 18 < 15)) {
        throw new Error(`${shotId} action cadence violates action-state-schedule-v2`);
      }
    }
    const transitions = section.match(/图片 \/ 镜内转场：[^\n]*；(\d+) 组/)?.[1];
    if (Number(transitions) !== variantCount) throw new Error(`${shotId} intra-shot transition count mismatch`);
  }

  for (const row of review.rows.filter((candidate) => candidate.user_selection.visual_generation_route === 'ian-handdrawn-ppt')) {
    if (!sections.get(row.shot_id).includes('锁定 Ian 全幅遮罩扫入')) {
      throw new Error(`${row.shot_id} lacks ian-full-frame-mask-sweep-v1 planning`);
    }
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
      transition_selection_binding: 'pass',
      narration_coverage: 'pass_exact_body_bytes_once_in_order',
      opening_schedule: 'pass',
      timing_source: 'pass_validated_master_and_dual_offline_word_timestamps',
      canvas: 'pass_1920x1080_30fps',
      subtitle_normalization: 'pass_source_text_spans_preserved',
      action_continuity_plan: 'pass',
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
