#!/usr/bin/env node
import crypto from 'node:crypto';
import {isFlipbookRow} from '../flipbook-video/profile.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  validateFinalStoryboard,
  validateIanStoryboardLayeredSceneSection,
} from '../storyboard/validate-final-storyboard.mjs';
import {
  canonicalJson,
  sha256Canonical as sha256IanCanonical,
} from '../ian-layered-scene/contract.mjs';
import {parseStoryboardSummary} from '../visual-direction-review-form/contract.mjs';
import {
  buildActionStatePlanSha256,
  validateActionStateSchedule,
} from '../action-state-schedule/contract.mjs';
import {validateStoryboardVisualRhythm} from '../storyboard-visual-rhythm/contract.mjs';
import {buildPresentedMapSha256 as buildVisualDirectionMapSha256} from '../visual-generation-routes/contract.mjs';
import {validateWhiteCatVisualStyleSelection} from '../workflow-approval/contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(HERE, '../../../..');
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const CHINESE_COUNT = new Map([['一', 1], ['二', 2], ['三', 3], ['四', 4], ['五', 5]]);
const LOCAL_VIDEO_ROUTE = 'local-video-file';
const SHA256 = /^[a-f0-9]{64}$/;
const PRESERVED_REBIND_STATUS = 'preserved_exact_bytes_pending_current_storyboard_rebind';
const PRESERVED_REBIND_POLICY = 'preserve_exact_historical_bytes_and_rebind_unchanged_non_Ian_assets_later';

const resolveRootRelative = (rootRelativePath, label) => {
  if (typeof rootRelativePath !== 'string' || rootRelativePath === '' || path.isAbsolute(rootRelativePath)) {
    throw new Error(`${label} must be root-relative`);
  }
  const resolved = path.resolve(REPOSITORY_ROOT, rootRelativePath);
  if (!resolved.startsWith(`${REPOSITORY_ROOT}${path.sep}`)) throw new Error(`${label} escapes repository root`);
  return resolved;
};

const loadBoundWhiteCatVisualStyleSelection = (binding) => {
  const hasFileBinding = binding?.path !== undefined || binding?.file_checksum_sha256 !== undefined;
  if (!hasFileBinding) return binding;
  if (!SHA256.test(binding?.file_checksum_sha256 ?? '')) {
    throw new Error('white-cat visual style selection file checksum is invalid');
  }
  const target = resolveRootRelative(binding.path, 'white-cat visual style selection path');
  const status = fs.lstatSync(target);
  if (!status.isFile() || status.isSymbolicLink()) {
    throw new Error('white-cat visual style selection path must be a regular non-symlink file');
  }
  const bytes = fs.readFileSync(target);
  if (sha256(bytes) !== binding.file_checksum_sha256) {
    throw new Error('white-cat visual style selection file checksum is stale');
  }
  const selection = JSON.parse(bytes);
  const metadataFields = new Set(['status', 'path', 'file_checksum_sha256']);
  for (const [field, value] of Object.entries(binding)) {
    if (metadataFields.has(field) || !Object.hasOwn(selection, field)) continue;
    if (canonicalJson(selection[field]) !== canonicalJson(value)) {
      throw new Error(`white-cat visual style selection summary is stale at ${field}`);
    }
  }
  return selection;
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

const stateCountFor = (section, row, priorItems, rhythmShot = null, actionSchedule = null) => {
  const route = row.user_selection.visual_generation_route;
  if (isFlipbookRow(row)) return 1;
  if (route === LOCAL_VIDEO_ROUTE) return 1;
  if (route === 'ink-doodle-knowledge-card') {
    const match = section.match(/墨线知识卡([一二三四五])个独立 1920×1080 栅格状态/);
    const count = CHINESE_COUNT.get(match?.[1]);
    if (!count) throw new Error(`${row.shot_id} lacks an exact Ink state count`);
    return count;
  }
  if (row.scene_class === 'narrative_illustration') {
    const scheduledCount = actionSchedule?.schedule?.state_count_total;
    const rhythmCount = rhythmShot?.motion_tier === 'hero_pose'
      ? rhythmShot?.asset_plan?.pose_count
      : rhythmShot?.asset_plan?.main_image_count;
    if (Number.isInteger(scheduledCount) && scheduledCount > 0 && scheduledCount === rhythmCount) {
      return scheduledCount;
    }
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

const queueItemCountFor = (stateCount, actionSchedule) => (
  actionSchedule?.schedule?.contract_version === 'action-state-schedule-v4'
    && actionSchedule.schedule.motion_tier === 'hero_pose'
    ? stateCount + 1
    : stateCount
);

export const buildStandardItems = ({shotId, row, count, actionSchedule}) => {
  const route = row.user_selection.visual_generation_route;
  if (isFlipbookRow(row)) {
    if (count !== 1 || !['ian-handdrawn-ppt', 'imagegen'].includes(route) || row.white_cat_recommendation?.recommended !== false) {
      throw new Error(`${shotId} flipbook queue requires one no-cat static image`);
    }
    return [{asset_id: `${shotId}-static-v01`, shot_id: shotId, role: 'standalone-graphic',
      depends_on: [], status: 'pending_generation', active_for_current_storyboard: true,
      strict_review: false, has_downstream_action_variants: false, state_count_total: 1, state_index: 0}];
  }
  if (route === 'ian-handdrawn-ppt') {
    if (count !== 1) throw new Error(`${shotId} Ian queue must contain exactly one layered-scene package`);
    return [{
      asset_id: `${shotId}-ian-v01`,
      shot_id: shotId,
      role: 'standalone-graphic',
      depends_on: [],
      status: 'pending_generation',
      active_for_current_storyboard: true,
      strict_review: false,
      has_downstream_action_variants: false,
      state_count_total: 1,
      state_index: 0,
    }];
  }
  if (route !== 'imagegen' || row.scene_class !== 'narrative_illustration') {
    throw new Error(`${shotId} has no fresh visual queue builder for route ${route}`);
  }
  const occurrences = actionSchedule?.schedule?.occurrences;
  if (!Array.isArray(occurrences) || occurrences.length !== count
    || occurrences.some((occurrence, index) => occurrence.state_index !== index)) {
    throw new Error(`${shotId} action schedule cannot initialize its visual queue`);
  }
  const masterId = `${shotId}-master-v01`;
  if (actionSchedule.schedule.contract_version === 'action-state-schedule-v4'
    && actionSchedule.schedule.motion_tier === 'hero_pose') {
    const scheduleBackgroundAssetId = actionSchedule.schedule.background_asset_id;
    if (typeof scheduleBackgroundAssetId !== 'string' || scheduleBackgroundAssetId === '') {
      throw new Error(`${shotId} hero-pose schedule lacks its independent background`);
    }
    const actionStateBinding = {
      motion_tier: actionSchedule.schedule.motion_tier,
      schedule_background_asset_id: scheduleBackgroundAssetId,
      action_state_schedule_contract_version: actionSchedule.schedule.contract_version,
      action_state_plan_sha256: actionSchedule.state_plan_sha256,
    };
    return [{
      asset_id: masterId,
      asset_kind: 'hero_pose_background',
      shot_id: shotId,
      role: 'base/master',
      depends_on: [],
      status: 'pending_generation',
      active_for_current_storyboard: true,
      strict_review: true,
      has_downstream_action_variants: true,
      white_cat_present: false,
      state_count_total: count,
      state_index: null,
      ...actionStateBinding,
    }, ...occurrences.map((occurrence, stateIndex) => ({
      asset_id: `${shotId}-action-${String(stateIndex + 1).padStart(2, '0')}-v01`,
      asset_kind: 'hero_pose',
      shot_id: shotId,
      role: `action-${String(stateIndex + 1).padStart(2, '0')}`,
      depends_on: [masterId],
      status: 'pending_generation',
      active_for_current_storyboard: true,
      strict_review: false,
      has_downstream_action_variants: false,
      state_count_total: count,
      state_index: stateIndex,
      schedule_state_id: occurrence.state_id,
      semantic_state: occurrence.semantic_state,
      ...actionStateBinding,
    }))];
  }
  return occurrences.map((occurrence, stateIndex) => ({
    asset_id: stateIndex === 0 ? masterId : `${shotId}-action-${String(stateIndex).padStart(2, '0')}-v01`,
    shot_id: shotId,
    role: stateIndex === 0 ? 'base/master' : `action-${String(stateIndex).padStart(2, '0')}`,
    depends_on: stateIndex === 0 ? [] : [masterId],
    status: 'pending_generation',
    active_for_current_storyboard: true,
    strict_review: stateIndex === 0,
    has_downstream_action_variants: stateIndex === 0,
    state_count_total: count,
    state_index: stateIndex,
    schedule_state_id: occurrence.state_id,
    semantic_state: occurrence.semantic_state,
    motion_tier: actionSchedule.schedule.motion_tier,
    action_state_schedule_contract_version: actionSchedule.schedule.contract_version,
    action_state_plan_sha256: actionSchedule.state_plan_sha256,
  }));
};

export const validateFreshActionScheduleSet = ({rhythm, actionSchedules}) => {
  if (!Array.isArray(rhythm?.shots)
    || !Array.isArray(actionSchedules?.schedules)
    || actionSchedules.contract_version !== 'action-state-schedule-set-v1'
    || actionSchedules.schedule_count !== actionSchedules.schedules.length) {
    throw new Error('fresh visual queue initialization lacks approved rhythm/action authority');
  }
  const rhythmByShot = new Map(rhythm.shots.map((shot) => [shot.shot_id, shot]));
  const expectedScheduledShotIds = rhythm.shots
    .filter((shot) => ['stateful', 'hero_pose'].includes(shot.motion_tier))
    .map((shot) => shot.shot_id);
  const scheduledShotIds = actionSchedules.schedules.map((entry) => entry.shot_id);
  if (JSON.stringify(scheduledShotIds) !== JSON.stringify(expectedScheduledShotIds)) {
    throw new Error('fresh visual queue action schedules do not exactly cover stateful and hero-pose shots');
  }
  for (const entry of actionSchedules.schedules) {
    const rhythmShot = rhythmByShot.get(entry.shot_id);
    const expectedVersion = rhythm.contract_version === 'storyboard-visual-rhythm-v2'
      ? 'action-state-schedule-v4'
      : 'action-state-schedule-v3';
    if (!rhythmShot || entry.schedule?.contract_version !== expectedVersion) {
      throw new Error(`fresh visual queue ${entry.shot_id} action schedule version is stale`);
    }
    const validation = validateActionStateSchedule(entry.schedule, {
      totalFrames: rhythmShot.end_frame - rhythmShot.start_frame,
      fps: 30,
      densityMode: expectedVersion === 'action-state-schedule-v4' ? rhythm.density_mode : null,
      densitySelectionSha256: expectedVersion === 'action-state-schedule-v4'
        ? rhythm.visual_density_selection_sha256
        : null,
    });
    if (validation.result !== 'pass'
      || entry.shot_start_frame !== rhythmShot.start_frame
      || entry.shot_end_frame !== rhythmShot.end_frame
      || entry.state_plan_sha256 !== buildActionStatePlanSha256(entry.schedule)) {
      throw new Error(`fresh visual queue ${entry.shot_id} action schedule binding is stale`);
    }
  }
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
    'scene_package_manifest_path', 'scene_package_manifest_checksum_sha256',
    'ian_scene_plan', 'ian_scene_plan_sha256', 'ian_scene_package_members',
    'presented_ian_layered_scene_package', 'approved_ian_layered_scene_package',
    'static_spread_review', 'presented_static_spread_review', 'approved_static_spread_review',
    'qa_contract_version',
  ]) delete next[key];
  next.status = 'pending_generation';
  next.active_for_current_storyboard = true;
  return next;
};

const verifyPreservedFile = (binding, label) => {
  if (!SHA256.test(binding?.checksum_sha256 ?? '')) {
    throw new Error(`${label} checksum is invalid`);
  }
  const target = resolveRootRelative(binding.path, `${label} path`);
  const status = fs.lstatSync(target);
  if (!status.isFile() || status.isSymbolicLink() || sha256(fs.readFileSync(target)) !== binding.checksum_sha256) {
    throw new Error(`${label} changed on disk`);
  }
};

const preservedRebindAssetIds = ({state, review}) => {
  const items = review.queue.filter(
    (item) => item.rebind_status === PRESERVED_REBIND_STATUS,
  );
  if (items.length === 0) return new Set();
  const migration = [...(state.superseded_artifacts ?? [])].reverse().find(
    (record) => record?.record_type === 'unfinished_ian_layered_scene_contract_migration'
      && record.preservation_policy === PRESERVED_REBIND_POLICY,
  );
  if (!migration || migration.preserved_non_ian_asset_count !== items.length) {
    throw new Error('preserved non-Ian migration evidence is missing or incomplete');
  }
  const projection = items.map((item) => ({
    asset_id: item.asset_id,
    path: item.path,
    checksum_sha256: item.checksum_sha256,
    status: item.status,
  }));
  if (sha256(Buffer.from(canonicalJson(projection)))
      !== migration.preserved_non_ian_ordered_binding_digest_sha256) {
    throw new Error('preserved non-Ian binding digest is stale');
  }
  for (const item of items) {
    if (item.visual_generation_route === 'ian-handdrawn-ppt'
      || item.active_for_current_storyboard !== false
      || item.status !== 'qa_passed_pending_final_review'
      || item.technical_qa?.result !== 'pass'
      || item.semantic_qa?.result !== 'pass'
      || item.visible_text_qa?.result !== 'pass'
      || item.visual_qa?.result !== 'pass') {
      throw new Error(`${item.asset_id} is not eligible for exact-byte preservation`);
    }
    verifyPreservedFile(item, `${item.asset_id} preserved asset`);
    verifyPreservedFile({
      path: item.qa_evidence_path,
      checksum_sha256: item.qa_evidence_checksum_sha256,
    }, `${item.asset_id} preserved QA evidence`);
  }
  return new Set(items.map((item) => item.asset_id));
};

const assertPreservedVisualContract = ({item, row, summaryRow, timing, count, actionSchedule}) => {
  if (isFlipbookRow(item) !== isFlipbookRow(row)
    || (isFlipbookRow(row) && canonicalJson(item.static_spread) !== canonicalJson(row.static_spread))) {
    throw new Error(`${item.asset_id} static spread contract changed`);
  }
  const heroPoseBackground = actionSchedule?.schedule?.contract_version === 'action-state-schedule-v4'
    && actionSchedule.schedule.motion_tier === 'hero_pose'
    && item.role === 'base/master'
    && item.state_index === null;
  const expected = {
    visual_generation_route: row.user_selection.visual_generation_route,
    scene_class: row.scene_class,
    visual_structure_id: row.user_selection.visual_structure_id,
    treatment_profile_id: row.user_selection.treatment_profile_id,
    white_cat_present: heroPoseBackground ? false : row.user_selection.white_cat_present,
    white_cat_visual_style_id: row.user_selection.white_cat_visual_style_id ?? null,
    white_cat_visual_style_selection_sha256:
      row.user_selection.white_cat_visual_style_selection_sha256 ?? null,
    visual_cohesion_profile_id: row.user_selection.visual_cohesion_profile_id ?? null,
    visible_text_mode: row.user_selection.visible_text_mode,
    exact_visible_text: row.user_selection.exact_visible_text,
    visible_text_placement: row.user_selection.visible_text_placement,
    local_video_source_path: row.user_selection.local_video_source_path ?? null,
    narration_source_text: summaryRow.locked_narration,
    shot_start_frame: timing.startFrame,
    shot_end_frame: timing.endFrame,
    shot_duration_frames: timing.endFrame - timing.startFrame,
    state_count_total: count,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (canonicalJson(item[field] ?? null) !== canonicalJson(value ?? null)) {
      throw new Error(`${item.asset_id} preserved visual contract changed at ${field}`);
    }
  }
  if (actionSchedule) {
    if (heroPoseBackground) {
      if (item.schedule_background_asset_id !== actionSchedule.schedule.background_asset_id
        || item.motion_tier !== actionSchedule.schedule.motion_tier
        || item.action_state_schedule_contract_version !== actionSchedule.schedule.contract_version
        || item.action_state_plan_sha256 !== actionSchedule.state_plan_sha256) {
        throw new Error(`${item.asset_id} preserved hero-pose background binding changed`);
      }
      return;
    }
    const occurrence = actionSchedule.schedule?.occurrences?.[item.state_index];
    if (!occurrence
      || item.schedule_state_id !== occurrence.state_id
      || item.semantic_state !== occurrence.semantic_state
      || (actionSchedule.schedule.contract_version === 'action-state-schedule-v4'
        && actionSchedule.schedule.motion_tier === 'hero_pose'
        && item.schedule_background_asset_id !== actionSchedule.schedule.background_asset_id)
      || item.motion_tier !== actionSchedule.schedule.motion_tier
      || item.action_state_schedule_contract_version !== actionSchedule.schedule.contract_version
      || item.action_state_plan_sha256 !== actionSchedule.state_plan_sha256) {
      throw new Error(`${item.asset_id} preserved action-state binding changed`);
    }
  }
};

export const inspectVisualContractChange = (values) => {
  try {
    assertPreservedVisualContract(values);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

export const hasUnchangedVisualContract = (values) => inspectVisualContractChange(values) === null;

export const hasPassingReusableEvidence = (item) => {
  const ordinaryPass = [
    'approved',
    'qa_passed_pending_batch_review',
    'qa_passed_pending_final_review',
  ].includes(item.status)
    && item.technical_qa?.result === 'pass'
    && item.semantic_qa?.result === 'pass'
    && item.visible_text_qa?.result === 'pass'
    && item.visual_qa?.result === 'pass';
  const releasedMechanicalFailure = item.status
      === 'qa_failed_but_waived_once_pending_final_review'
    && item.user_mechanical_gate_override_result === 'pass_with_user_override';
  return ordinaryPass || releasedMechanicalFailure;
};

export const preserveReusableMechanicalOverrideBlockers = ({blockers, activeQueue}) => {
  const carriedOverrideHashes = new Set(
    activeQueue
      .filter((item) => item.status === 'qa_failed_but_waived_once_pending_final_review'
        && hasPassingReusableEvidence(item))
      .map((item) => item.user_mechanical_gate_override_sha256
        ?? item.user_mechanical_gate_override?.override_sha256)
      .filter((value) => SHA256.test(value ?? '')),
  );
  return (Array.isArray(blockers) ? blockers : [])
    .filter((blocker) => carriedOverrideHashes.has(
      blocker?.user_mechanical_gate_override_sha256,
    ))
    .map((blocker) => structuredClone(blocker));
};

const verifyReusableEvidence = (item) => {
  verifyPreservedFile(item, `${item.asset_id} preserved asset`);
  verifyPreservedFile({
    path: item.qa_evidence_path,
    checksum_sha256: item.qa_evidence_checksum_sha256,
  }, `${item.asset_id} preserved QA evidence`);
};

const preserveExactItem = (item) => {
  const next = structuredClone(item);
  delete next.rebind_status;
  next.active_for_current_storyboard = true;
  return next;
};

const nextShotAssetVersion = (shotId, queue) => {
  const versions = queue
    .filter((item) => item.shot_id === shotId)
    .map((item) => Number(item.asset_id?.match(/-v(\d+)$/)?.[1]))
    .filter(Number.isInteger);
  return versions.length === 0 ? 1 : Math.max(...versions) + 1;
};

const versionFreshItems = (items, version) => items.map((item) => ({
  ...item,
  asset_id: item.asset_id.replace(/-v01$/, `-v${String(version).padStart(2, '0')}`),
  depends_on: item.depends_on.map(
    (assetId) => assetId.replace(/-v01$/, `-v${String(version).padStart(2, '0')}`),
  ),
}));

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

const bindItem = ({
  item,
  row,
  summaryRow,
  section,
  timing,
  storyboard,
  direction,
  ianScenePlan = null,
  preservedExactBytes = false,
}) => ({
  ...item,
  ...(isFlipbookRow(row) ? {presentation_mode: row.presentation_mode, structured_visual_kind: row.structured_visual_kind ?? null, static_spread: structuredClone(row.static_spread)} : {}),
  visual_generation_route: row.user_selection.visual_generation_route,
  scene_class: row.scene_class,
  visual_structure_id: row.user_selection.visual_structure_id,
  treatment_profile_id: row.user_selection.treatment_profile_id,
  white_cat_present: Object.hasOwn(item, 'white_cat_present')
    ? item.white_cat_present
    : row.user_selection.white_cat_present,
  white_cat_visual_style_id: row.user_selection.white_cat_visual_style_id ?? null,
  white_cat_visual_style_selection_sha256:
    row.user_selection.white_cat_visual_style_selection_sha256 ?? null,
  visual_cohesion_profile_id: row.user_selection.visual_cohesion_profile_id ?? null,
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
  ...(ianScenePlan === null ? {} : {
    ian_scene_plan: ianScenePlan,
    ian_scene_plan_sha256: sha256IanCanonical(ianScenePlan),
  }),
  storyboard_rebind_qa: {
    result: 'pass',
    basis: preservedExactBytes
      ? 'preserved_exact_bytes_after_unchanged_visual_contract_rebind'
      : 'approved_visual_contract_and_exact_narration_timing_reconciled',
  },
});

export const buildReconciledState = ({
  state,
  storyboardBytes,
  directionBytes,
  rhythmBytes = null,
  actionScheduleBytes = null,
  reconciledAt,
}) => {
  const storyboardChecksum = sha256(storyboardBytes);
  const directionChecksum = sha256(directionBytes);
  const markdown = storyboardBytes.toString('utf8');
  const direction = JSON.parse(directionBytes);
  const summary = parseStoryboardSummary(markdown).filter((row) => row.shot_id !== 'OPEN-00');
  const sections = parseSections(markdown);
  const initializing = state.visual_asset_review == null;
  const oneClick = state.workflow_approval_mode?.approval_mode === 'one_click';
  const review = state.visual_asset_review ?? {
    contract_version: oneClick ? 'visual-asset-review-v3' : 'visual-asset-review-v2',
    status: 'in_progress',
    mode: oneClick ? 'one_click_final_review_v1' : 'hybrid_batch_v1',
    ...(oneClick ? {
      policy_sha256: state.one_click_approval_policy?.policy_sha256,
      storyboard_sha256: storyboardChecksum,
    } : {batch_size: 4}),
    generation_aspect_ratio: [16, 9],
    generation_aspect_ratio_max_relative_error: 0.005,
    queue_generation_allowed: true,
    current_asset_id: null,
    initialized_at: reconciledAt,
    queue: [],
  };
  const rhythm = rhythmBytes == null ? null : JSON.parse(rhythmBytes);
  const actionSchedules = actionScheduleBytes == null ? null : JSON.parse(actionScheduleBytes);
  const expectedAuthorityStatus = oneClick ? 'policy_authorized' : 'approved';
  const expectedPhase = oneClick ? 'storyboard_policy_authorized' : 'storyboard_review_approved';
  const policySha256 = state.one_click_approval_policy?.policy_sha256;
  const styleBinding = direction.white_cat_visual_style_binding ?? null;
  if (styleBinding !== null) {
    const styleSelection = loadBoundWhiteCatVisualStyleSelection(
      state.white_cat_visual_style_selection,
    );
    const styleValidation = validateWhiteCatVisualStyleSelection(styleSelection, {
      gate2ScriptSha256: styleSelection?.gate2_script_sha256,
    });
    if (styleBinding.contract_version !== styleSelection.contract_version
      || styleBinding.style_id !== styleSelection.style_id
      || styleBinding.treatment_profile_id !== styleSelection.treatment_profile_id
      || styleBinding.visual_cohesion_profile_id !== styleSelection.visual_cohesion_profile_id
      || styleBinding.selection_sha256 !== styleValidation.selection_sha256) {
      throw new Error('visual direction white-cat style binding differs from Gate 2 selection');
    }
  }
  const policyAuthorizationInvalid = oneClick && (
    !SHA256.test(policySha256 ?? '')
    || state.one_click_approval_policy?.contract_version !== 'one-click-approval-policy-v1'
    || state.one_click_approval_policy?.preauthorizations
      ?.deterministic_visual_direction_recommendations !== true
    || state.one_click_approval_policy?.preauthorizations
      ?.continue_during_visual_production !== true
    || state.one_click_approval_policy?.user_has_reviewed_specific_maps !== false
    || direction.presented_map_sha256 !== state.visual_direction_review?.presented_map_sha256
    || direction.presented_map_sha256 !== buildVisualDirectionMapSha256(direction)
    || direction.policy_authorization?.policy_sha256 !== policySha256
    || direction.policy_authorization?.user_has_reviewed_specific_map !== false
    || direction.policy_authorization?.presented_map_sha256 !== direction.presented_map_sha256
    || typeof direction.policy_authorization?.authorized_at !== 'string'
    || Number.isNaN(Date.parse(direction.policy_authorization.authorized_at))
    || !Array.isArray(direction.rows)
    || direction.rows.some((row) => row.user_selection?.status !== expectedAuthorityStatus
      || row.user_selection.presented_map_sha256 !== direction.presented_map_sha256
      || row.user_selection.policy_sha256 !== policySha256
      || row.user_selection.deterministic_recommendation_selected !== true
      || row.user_selection.user_has_reviewed_specific_map !== false
      || row.user_selection.exact_message !== null
      || row.user_selection.decided_at !== null
      || row.user_selection.authorized_at !== direction.policy_authorization.authorized_at)
  );
  if (state.current_phase !== expectedPhase
    || state.storyboard_review?.status !== expectedAuthorityStatus
    || state.storyboard_review.approved_checksum_sha256 !== storyboardChecksum
    || state.active_storyboard?.checksum_sha256 !== storyboardChecksum
    || direction.status !== expectedAuthorityStatus
    || state.visual_direction_review?.checksum_sha256 !== directionChecksum
    || (oneClick
      ? (review.mode !== 'one_click_final_review_v1'
        || review.contract_version !== 'visual-asset-review-v3'
        || review.policy_sha256 !== state.one_click_approval_policy?.policy_sha256)
      : (review.mode !== 'hybrid_batch_v1' || review.batch_size !== 4))
    || !Array.isArray(review.queue)) {
    throw new Error('visual queue reconciliation authority is incomplete or stale');
  }
  if (policyAuthorizationInvalid) {
    throw new Error('visual direction policy authorization is incomplete, stale, or fabricates concrete-map review');
  }
  if (initializing && (
    rhythm?.status !== expectedAuthorityStatus
    || !Array.isArray(rhythm.shots)
    || !Array.isArray(actionSchedules?.schedules)
    || actionSchedules?.contract_version !== 'action-state-schedule-set-v1'
    || actionSchedules.schedule_count !== actionSchedules.schedules.length
  )) {
    throw new Error('fresh visual queue initialization lacks approved rhythm/action authority');
  }
  if (initializing) {
    const expectedMappingStatus = oneClick ? 'policy_authorized' : 'approved';
    const newDensityWorkflow = state.visual_density_selection != null;
    if (newDensityWorkflow && (
      rhythm.contract_version !== 'storyboard-visual-rhythm-v2'
      || rhythm.density_mode !== state.visual_density_selection.density_mode
      || rhythm.visual_density_selection_sha256 !== state.visual_density_selection.selection_sha256
    )) {
      throw new Error('fresh visual queue density/rhythm binding is stale');
    }
    if (rhythm.status !== expectedMappingStatus) {
      throw new Error('fresh visual queue rhythm authorization status is stale');
    }
    validateStoryboardVisualRhythm(rhythm, {
      shotIds: direction.rows.map((row) => row.shot_id),
    });
    validateFreshActionScheduleSet({rhythm, actionSchedules});
  }
  const summaryById = new Map(summary.map((row) => [row.shot_id, row]));
  const rhythmById = new Map((rhythm?.shots ?? []).map((shot) => [shot.shot_id, shot]));
  const actionScheduleById = new Map((actionSchedules?.schedules ?? []).map((schedule) => [schedule.shot_id, schedule]));
  const preservedRebindIds = preservedRebindAssetIds({state, review});
  const rebindCandidates = review.queue.filter((item) => (
    item.status !== 'superseded'
    && (item.active_for_current_storyboard !== false
      || (item.status === 'blocked_pending_reapproved_storyboard' && item.prior_status)
      || preservedRebindIds.has(item.asset_id))
  ));
  const priorByShot = Map.groupBy(rebindCandidates, (item) => item.shot_id);
  const activeQueueInStoryboardOrder = [];
  const replacedShots = new Set();
  const requeuedShotReasons = new Map();
  for (const row of direction.rows) {
    const shotId = row.shot_id;
    const priorItems = priorByShot.get(shotId) ?? [];
    const section = sections.get(shotId);
    const summaryRow = summaryById.get(shotId);
    if (!section || !summaryRow || row.user_selection?.status !== expectedAuthorityStatus) {
      throw new Error(`${shotId} lacks authorized storyboard/direction evidence`);
    }
    const actionSchedule = actionScheduleById.get(shotId) ?? null;
    const timing = parseTiming(section, shotId);
    const ianScenePlan = !isFlipbookRow(row) && row.user_selection.visual_generation_route === 'ian-handdrawn-ppt'
      ? validateIanStoryboardLayeredSceneSection(section, shotId, {
          sourceText: summaryRow.locked_narration,
          durationFrames: timing.endFrame - timing.startFrame,
        })
      : null;
    const count = stateCountFor(section, row, priorItems, rhythmById.get(shotId) ?? null, actionSchedule);
    const queueItemCount = queueItemCountFor(count, actionSchedule);
    const preservingExactBytes = priorItems.length > 0
      && priorItems.every((item) => preservedRebindIds.has(item.asset_id));
    const contractChangeReasons = priorItems.map((item) => inspectVisualContractChange({
          item,
          row,
          summaryRow,
          timing,
          count,
          actionSchedule,
        })).filter(Boolean);
    const unchangedExistingContract = priorItems.length === queueItemCount
      && priorItems.every((item) => (
        item.visual_generation_route === row.user_selection.visual_generation_route
        && hasPassingReusableEvidence(item)
      ))
      && contractChangeReasons.length === 0;
    if (priorItems.length > 0 && !preservingExactBytes && !unchangedExistingContract) {
      replacedShots.add(shotId);
      requeuedShotReasons.set(shotId, [
        ...(priorItems.length === queueItemCount ? [] : [
          `asset count changed from ${priorItems.length} to ${queueItemCount}`,
        ]),
        ...priorItems
          .filter((item) => item.visual_generation_route !== row.user_selection.visual_generation_route)
          .map((item) => `${item.asset_id} route changed`),
        ...priorItems
          .filter((item) => !hasPassingReusableEvidence(item))
          .map((item) => `${item.asset_id} has no reusable passing evidence`),
        ...contractChangeReasons,
      ]);
    }
    let items;
    if (preservingExactBytes) {
      if (priorItems.length !== queueItemCount
        || priorItems.some((item) => item.visual_generation_route !== row.user_selection.visual_generation_route)) {
        throw new Error(`${shotId} preserved queue cannot be safely rebound`);
      }
      for (const item of priorItems) {
        assertPreservedVisualContract({
          item,
          row,
          summaryRow,
          timing,
          count,
          actionSchedule,
        });
      }
      items = priorItems.map(preserveExactItem);
    } else if (unchangedExistingContract
      && !isFlipbookRow(row) && row.user_selection.visual_generation_route === 'ian-handdrawn-ppt') {
      // Ian pixels remain reusable, but the package manifest is checksum-bound to
      // storyboard/direction authority and must be deterministically rebuilt.
      items = priorItems.map(cleanPendingItem);
    } else if (unchangedExistingContract) {
      priorItems.forEach(verifyReusableEvidence);
      items = priorItems.map(preserveExactItem);
    } else if (row.user_selection.visual_generation_route === 'ink-doodle-knowledge-card') {
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
      if (initializing && priorItems.length === 0) {
        items = buildStandardItems({shotId, row, count, actionSchedule});
      } else if (row.user_selection.visual_generation_route === 'ian-handdrawn-ppt'
        && priorItems.length === 0
        && review.queue.some((item) => item.shot_id === shotId
          && item.visual_generation_route === 'ian-handdrawn-ppt'
          && item.status === 'superseded'
          && item.active_for_current_storyboard === false)) {
        items = versionFreshItems(
          buildStandardItems({shotId, row, count, actionSchedule}),
          nextShotAssetVersion(shotId, review.queue),
        );
        replacedShots.add(shotId);
      } else if (priorItems.length !== queueItemCount || priorItems.some((item) => item.visual_generation_route !== row.user_selection.visual_generation_route)) {
        throw new Error(`${shotId} prior queue cannot be safely rebound`);
      } else {
        items = priorItems.map(cleanPendingItem);
      }
    }
    const binding = {
      storyboard: {path: state.storyboard_review.approved_path, checksum_sha256: storyboardChecksum},
      direction: {
        path: state.visual_direction_review.path,
        checksum_sha256: directionChecksum,
        presented_map_sha256: direction.presented_map_sha256,
      },
    };
    activeQueueInStoryboardOrder.push(...items.map((item) => bindItem({
      item,
      row,
      summaryRow,
      section,
      timing,
      ianScenePlan,
      preservedExactBytes: preservedRebindIds.has(item.asset_id),
      ...binding,
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
  const completedQueueStatuses = new Set([
    'approved',
    'qa_passed_pending_batch_review',
    'qa_passed_pending_final_review',
    'qa_failed_but_waived_once_pending_final_review',
  ]);
  const currentItem = activeQueue.find((item) => !completedQueueStatuses.has(item.status));
  nextState.phase = 'visual_production';
  nextState.current_phase = 'visual_production';
  nextState.blockers = preserveReusableMechanicalOverrideBlockers({
    blockers: state.blockers,
    activeQueue,
  });
  nextState.visual_asset_review = {
    ...review,
    status: 'in_progress',
    queue_generation_allowed: true,
    ...(oneClick ? {storyboard_sha256: storyboardChecksum} : {}),
    current_asset_id: currentItem?.asset_id ?? null,
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
      requeued_shot_reasons: Object.fromEntries(requeuedShotReasons),
      initialization_mode: initializing ? 'fresh_from_approved_storyboard_v1' : 'reconcile_existing_queue_v1',
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
  const rhythmPath = resolveRootRelative(state.storyboard_visual_rhythm?.path, 'visual rhythm path');
  const rhythmBytes = fs.readFileSync(rhythmPath);
  if (state.storyboard_visual_rhythm?.checksum_sha256 !== sha256(rhythmBytes)) {
    throw new Error('visual rhythm checksum is stale');
  }
  const actionSchedulePath = resolveRootRelative(
    state.storyboard_visual_rhythm?.action_state_schedule_set_path,
    'action schedule path',
  );
  const actionScheduleBytes = fs.readFileSync(actionSchedulePath);
  if (state.storyboard_visual_rhythm?.action_state_schedule_set_checksum_sha256 !== sha256(actionScheduleBytes)) {
    throw new Error('action schedule checksum is stale');
  }
  const nextState = buildReconciledState({
    state,
    storyboardBytes,
    directionBytes,
    rhythmBytes,
    actionScheduleBytes,
    reconciledAt,
  });
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
      reconciliation: artifacts.nextState.visual_asset_review.reconciliation,
    }, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
