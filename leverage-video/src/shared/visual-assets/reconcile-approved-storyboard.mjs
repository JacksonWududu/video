#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {validateFinalStoryboard} from '../storyboard/validate-final-storyboard.mjs';
import {parseStoryboardSummary} from '../visual-direction-review-form/contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(HERE, '../../../..');
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const CHINESE_COUNT = new Map([['一', 1], ['二', 2], ['三', 3], ['四', 4], ['五', 5]]);
const LOCAL_VIDEO_ROUTE = 'local-video-file';

const resolveRootRelative = (rootRelativePath, label) => {
  if (typeof rootRelativePath !== 'string' || rootRelativePath === '' || path.isAbsolute(rootRelativePath)) {
    throw new Error(`${label} must be root-relative`);
  }
  const resolved = path.resolve(REPOSITORY_ROOT, rootRelativePath);
  if (!resolved.startsWith(`${REPOSITORY_ROOT}${path.sep}`)) throw new Error(`${label} escapes repository root`);
  return resolved;
};

const parseSections = (markdown) => new Map(
  [...markdown.matchAll(/^## (OPEN-00|S\d+)\n([\s\S]*?)(?=^## |(?![\s\S]))/gm)]
    .map((match) => [match[1], match[2]]),
);

const parseTiming = (section, shotId) => {
  const match = section.match(/- 时间 \/ 帧：([0-9.]+)–([0-9.]+) 秒；旁白与合成 `\[(\d+), (\d+)\)`/);
  if (!match) throw new Error(`${shotId} lacks timing/frame binding`);
  return {startFrame: Number(match[3]), endFrame: Number(match[4])};
};

const stateCountFor = (section, row, priorItems) => {
  const route = row.user_selection.visual_generation_route;
  if (route === LOCAL_VIDEO_ROUTE) return 1;
  if (route === 'ink-doodle-knowledge-card') {
    const match = section.match(/墨线知识卡([一二三四五])个独立 1920×1080 栅格状态/);
    const count = CHINESE_COUNT.get(match?.[1]);
    if (!count) throw new Error(`${row.shot_id} lacks an exact Ink state count`);
    return count;
  }
  if (row.scene_class === 'narrative_illustration') {
    const match = section.match(/- 动作族：(?:`action-state-schedule-v2`，)?(\d+) 状态、\d+ 变体/);
    if (!match) throw new Error(`${row.shot_id} lacks an action-family state count`);
    return Number(match[1]);
  }
  if (route === 'ian-handdrawn-ppt') return 1;
  const priorCounts = new Set(priorItems.map((item) => item.state_count_total));
  if (priorCounts.size !== 1 || !Number.isInteger([...priorCounts][0])) {
    throw new Error(`${row.shot_id} state count cannot be reconciled`);
  }
  return [...priorCounts][0];
};

const cleanPendingItem = (item) => {
  const next = structuredClone(item);
  for (const key of [
    'prior_status', 'blocked_at', 'path', 'checksum_sha256', 'measured_dimensions',
    'source_svg_path', 'source_svg_checksum_sha256', 'render_evidence_path',
    'render_evidence_checksum_sha256', 'technical_qa', 'semantic_qa', 'visible_text_qa',
    'visual_qa', 'measured_aspect_ratio_relative_error', 'batch_qa_checksum_sha256',
    'batch_qa_time', 'approved_checksum_sha256', 'decision_message', 'decision_time',
    'selected_source_path', 'media', 'local_video_match', 'local_video_import_manifest',
    'approval_disk_media', 'approval_disk_checksum_sha256', 'approval_disk_verified_at',
  ]) delete next[key];
  next.status = 'pending_generation';
  next.active_for_current_storyboard = true;
  return next;
};

const buildInkItems = (shotId, count) => Array.from({length: count}, (_, stateIndex) => ({
  asset_id: `${shotId}-ink-state-${String(stateIndex).padStart(2, '0')}-v01`,
  shot_id: shotId,
  role: 'standalone-graphic-state',
  depends_on: [],
  status: 'pending_generation',
  active_for_current_storyboard: true,
  strict_review: false,
  has_downstream_action_variants: false,
  state_count_total: count,
  state_index: stateIndex,
}));

const buildLocalVideoItem = (shotId) => ({
  asset_id: `${shotId}-local-video-v01`,
  shot_id: shotId,
  role: 'local-video-source',
  depends_on: [],
  status: 'pending_generation',
  active_for_current_storyboard: true,
  strict_review: true,
  has_downstream_action_variants: false,
  state_count_total: 1,
  state_index: 0,
  processing_order: 'deferred-after-generated-visuals-v1',
});

const bindItem = ({item, row, summaryRow, section, timing, storyboard, direction}) => ({
  ...item,
  visual_generation_route: row.user_selection.visual_generation_route,
  scene_class: row.scene_class,
  visual_structure_id: row.user_selection.visual_structure_id,
  treatment_profile_id: row.user_selection.treatment_profile_id,
  white_cat_present: row.user_selection.white_cat_present,
  visible_text_mode: row.user_selection.visible_text_mode,
  exact_visible_text: row.user_selection.exact_visible_text,
  visible_text_placement: row.user_selection.visible_text_placement,
  local_video_source_path: row.user_selection.local_video_source_path ?? null,
  storyboard_path: storyboard.path,
  storyboard_checksum_sha256: storyboard.checksum_sha256,
  visual_direction_review_path: direction.path,
  visual_direction_review_checksum_sha256: direction.checksum_sha256,
  visual_direction_presented_map_sha256: direction.presented_map_sha256,
  narration_source_text: summaryRow.locked_narration,
  shot_start_frame: timing.startFrame,
  shot_end_frame: timing.endFrame,
  shot_duration_frames: timing.endFrame - timing.startFrame,
  storyboard_rebind_qa: {
    result: 'pass',
    basis: 'approved_visual_contract_and_exact_narration_timing_reconciled',
  },
});

export const buildReconciledState = ({state, storyboardBytes, directionBytes, reconciledAt}) => {
  const storyboardChecksum = sha256(storyboardBytes);
  const directionChecksum = sha256(directionBytes);
  const markdown = storyboardBytes.toString('utf8');
  const direction = JSON.parse(directionBytes);
  const summary = parseStoryboardSummary(markdown).filter((row) => row.shot_id !== 'OPEN-00');
  const sections = parseSections(markdown);
  const review = state.visual_asset_review;
  if (state.current_phase !== 'storyboard_review_approved'
    || state.storyboard_review?.status !== 'approved'
    || state.storyboard_review.approved_checksum_sha256 !== storyboardChecksum
    || state.active_storyboard?.checksum_sha256 !== storyboardChecksum
    || direction.status !== 'approved'
    || state.visual_direction_review?.checksum_sha256 !== directionChecksum
    || !review || review.mode !== 'hybrid_batch_v1' || review.batch_size !== 4
    || !Array.isArray(review.queue)) {
    throw new Error('visual queue reconciliation authority is incomplete or stale');
  }
  const summaryById = new Map(summary.map((row) => [row.shot_id, row]));
  const rebindCandidates = review.queue.filter((item) => (
    item.status !== 'superseded'
    && (item.active_for_current_storyboard !== false
      || (item.status === 'blocked_pending_reapproved_storyboard' && item.prior_status))
  ));
  const priorByShot = Map.groupBy(rebindCandidates, (item) => item.shot_id);
  const activeQueueInStoryboardOrder = [];
  const replacedShots = new Set();
  for (const row of direction.rows) {
    const shotId = row.shot_id;
    const priorItems = priorByShot.get(shotId) ?? [];
    const section = sections.get(shotId);
    const summaryRow = summaryById.get(shotId);
    if (!section || !summaryRow || row.user_selection?.status !== 'approved') {
      throw new Error(`${shotId} lacks approved storyboard/direction evidence`);
    }
    const count = stateCountFor(section, row, priorItems);
    let items;
    if (row.user_selection.visual_generation_route === 'ink-doodle-knowledge-card') {
      items = buildInkItems(shotId, count);
      replacedShots.add(shotId);
    } else if (row.user_selection.visual_generation_route === LOCAL_VIDEO_ROUTE) {
      if (priorItems.length === 1 && priorItems[0].visual_generation_route === LOCAL_VIDEO_ROUTE) {
        items = priorItems.map(cleanPendingItem);
      } else {
        items = [buildLocalVideoItem(shotId)];
        replacedShots.add(shotId);
      }
    } else {
      if (priorItems.length !== count || priorItems.some((item) => item.visual_generation_route !== row.user_selection.visual_generation_route)) {
        throw new Error(`${shotId} prior queue cannot be safely rebound`);
      }
      items = priorItems.map(cleanPendingItem);
    }
    const timing = parseTiming(section, shotId);
    const binding = {
      storyboard: {path: state.storyboard_review.approved_path, checksum_sha256: storyboardChecksum},
      direction: {
        path: state.visual_direction_review.path,
        checksum_sha256: directionChecksum,
        presented_map_sha256: direction.presented_map_sha256,
      },
    };
    activeQueueInStoryboardOrder.push(...items.map((item) => bindItem({
      item, row, summaryRow, section, timing, ...binding,
    })));
  }
  const activeQueue = [
    ...activeQueueInStoryboardOrder.filter((item) => item.visual_generation_route !== LOCAL_VIDEO_ROUTE),
    ...activeQueueInStoryboardOrder.filter((item) => item.visual_generation_route === LOCAL_VIDEO_ROUTE),
  ];
  const replacedHistorical = rebindCandidates
    .filter((item) => replacedShots.has(item.shot_id))
    .map((item) => ({...item, active_for_current_storyboard: false}));
  const retainedHistorical = review.queue.filter((item) => !rebindCandidates.includes(item));
  const historical = [...retainedHistorical, ...replacedHistorical];
  const ids = activeQueue.map((item) => item.asset_id);
  if (activeQueue.length === 0 || new Set(ids).size !== ids.length
    || activeQueue.some((item) => ['doodle-slides', 'comic-imagegen'].includes(item.visual_generation_route))) {
    throw new Error('reconciled active queue is incomplete, duplicated, or uses a retired route');
  }
  const nextState = structuredClone(state);
  nextState.current_phase = 'visual_production';
  nextState.blockers = [];
  nextState.visual_asset_review = {
    ...review,
    status: 'in_progress',
    queue_generation_allowed: true,
    current_asset_id: activeQueue[0].asset_id,
    active_storyboard_binding: {
      path: state.storyboard_review.approved_path,
      checksum_sha256: storyboardChecksum,
      approved_at: state.storyboard_review.decided_at,
      status: 'active',
    },
    queue: [...activeQueue, ...historical],
    reconciled_at: reconciledAt,
    reconciliation: {
      contract_version: 'visual-asset-queue-reconciliation-v1',
      result: 'pass',
      active_asset_count: activeQueue.length,
      preserved_unchanged_asset_count: activeQueue
        .filter((item) => !replacedShots.has(item.shot_id)).length,
      replaced_route_asset_count: activeQueue
        .filter((item) => replacedShots.has(item.shot_id)).length,
      historical_asset_count: historical.length,
      changed_shots: [...replacedShots],
    },
  };
  delete nextState.visual_asset_review.active_batch;
  return nextState;
};

const buildArtifacts = ({episodeWorkspace, reconciledAt}) => {
  const workspacePath = resolveRootRelative(episodeWorkspace, 'episode workspace');
  const statePath = path.join(workspacePath, 'schema/episode-state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const storyboardPath = resolveRootRelative(state.storyboard_review?.approved_path, 'approved storyboard path');
  const storyboardBytes = fs.readFileSync(storyboardPath);
  validateFinalStoryboard(episodeWorkspace, state.storyboard_review.approved_path);
  const directionPath = resolveRootRelative(state.visual_direction_review?.path, 'visual direction path');
  const directionBytes = fs.readFileSync(directionPath);
  const nextState = buildReconciledState({state, storyboardBytes, directionBytes, reconciledAt});
  return {statePath, bytes: jsonBytes(nextState), nextState};
};

const applyArtifacts = ({statePath, bytes}) => {
  const temporary = `${statePath}.visual-queue-reconciliation.tmp`;
  if (fs.existsSync(temporary)) throw new Error('visual queue reconciliation temporary path already exists');
  fs.writeFileSync(temporary, bytes, {flag: 'wx'});
  fs.renameSync(temporary, statePath);
};

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const [episodeWorkspace, reconciledAt, mode] = process.argv.slice(2);
  if (!episodeWorkspace || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(reconciledAt ?? '')
    || !['--dry-run', '--apply'].includes(mode) || process.argv.length !== 5) {
    console.error('usage: node reconcile-approved-storyboard.mjs <episode-workspace> <ISO-8601-with-offset> <--dry-run|--apply>');
    process.exit(2);
  }
  try {
    const artifacts = buildArtifacts({episodeWorkspace, reconciledAt});
    if (mode === '--apply') applyArtifacts(artifacts);
    const active = artifacts.nextState.visual_asset_review.queue
      .filter((item) => item.active_for_current_storyboard !== false);
    process.stdout.write(`${JSON.stringify({
      result: 'pass',
      applied: mode === '--apply',
      state_checksum_sha256: sha256(artifacts.bytes),
      active_asset_count: active.length,
      current_asset_id: artifacts.nextState.visual_asset_review.current_asset_id,
    }, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
