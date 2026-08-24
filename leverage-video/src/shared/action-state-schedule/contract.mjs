import crypto from 'node:crypto';

import {
  INTRA_SHOT_TRANSITION_VERSION,
  buildDefaultIntraShotTransitions,
  validateIntraShotTransitionSequence,
} from '../intra-shot-transitions/contract.mjs';
import {
  INTRA_SHOT_WATERCOLOR_BLOOM_KIND,
  INTRA_SHOT_WATERCOLOR_BLOOM_RENDERER,
  INTRA_SHOT_WATERCOLOR_BLOOM_RULE_ID,
  INTRA_SHOT_WATERCOLOR_BLOOM_SECONDS,
  getIntraShotWatercolorBloomDurationInFrames,
  validateIntraShotWatercolorTransition,
} from '../watercolor-bloom/contract.mjs';

export const ACTION_STATE_SCHEDULE_VERSION = 'action-state-schedule-v2';
export const ACTION_STATE_SCHEDULE_V3_VERSION = 'action-state-schedule-v3';
export const ACTION_STATE_SCHEDULE_V4_VERSION = 'action-state-schedule-v4';
export const ACTION_STATE_FPS = 30;
export const MIN_MULTI_STATE_HOLD_FRAMES = 18;
export const MAX_STATE_HOLD_FRAMES = 75;
export const MIN_CLEAN_HOLD_FRAMES = 15;
export const MAX_ACTION_STATE_COUNT = 5;
export const TERMINAL_HOLD_EXTENSION_POLICY = 'first-shot-visual-inheritance-v1';
export const ACTION_STATE_V3_MOTION_TIERS = Object.freeze(['stateful', 'hero_pose']);
export const ACTION_STATE_CADENCE_ADVISORY_VERSION = 'action-state-cadence-advisory-v1';
export const VISUAL_DENSITY_SELECTION_VERSION = 'visual-density-selection-v1';
export const DENSITY_FALLBACK_REASON_CODES = Object.freeze([
  'insufficient_semantic_beats',
  'insufficient_clean_hold_capacity',
]);

const SHA256 = /^[a-f0-9]{64}$/;

const requireTotalFrames = (value) => {
  if (!Number.isInteger(value) || value < 1) throw new Error('action-state totalFrames must be a positive integer');
  return value;
};

const requireFps = (fps) => {
  if (fps !== ACTION_STATE_FPS) throw new Error('knowledge-video action-state schedules require 30 fps');
  return fps;
};

const buildOccurrenceTiming = ({duration, index, fps}) => {
  const transitionInFrames = index === 0 ? 0 : getIntraShotWatercolorBloomDurationInFrames(fps);
  return {
    transition_in_frames: transitionInFrames,
    clean_hold_in_frames: duration - transitionInFrames,
  };
};

const resolveTerminalHoldExtension = ({
  totalFrames,
  visualProgressionFrames,
  terminalHoldExtensionPolicy,
}) => {
  const hasProgression = visualProgressionFrames !== null;
  const hasPolicy = terminalHoldExtensionPolicy !== null;
  if (hasProgression !== hasPolicy) {
    throw new Error('terminal hold extension requires both a policy and visual progression frames');
  }
  if (!hasPolicy) return {progressionFrames: totalFrames, extensionFrames: 0};
  if (terminalHoldExtensionPolicy !== TERMINAL_HOLD_EXTENSION_POLICY) {
    throw new Error('terminal hold extension policy is unsupported');
  }
  const progressionFrames = requireTotalFrames(visualProgressionFrames);
  if (progressionFrames >= totalFrames) {
    throw new Error('terminal hold extension requires visual progression shorter than the complete shot');
  }
  return {
    progressionFrames,
    extensionFrames: totalFrames - progressionFrames,
  };
};

export const calculateActionStateCount = (totalFrames) => {
  const frames = requireTotalFrames(totalFrames);
  const preferred = Math.min(MAX_ACTION_STATE_COUNT, Math.max(1, Math.floor(frames / 45 + 0.5)));
  const requiredForMaxHold = Math.ceil(frames / MAX_STATE_HOLD_FRAMES);
  const stateCountTotal = Math.max(preferred, requiredForMaxHold);
  if (stateCountTotal > MAX_ACTION_STATE_COUNT) {
    throw new Error('action-state schedule exceeds five states; split the shot at a natural semantic pause');
  }
  return stateCountTotal;
};

const stateId = (index) => index === 0 ? 'base/master' : `action-${String(index).padStart(2, '0')}`;

export const buildActionStateSchedule = ({
  totalFrames,
  fps = ACTION_STATE_FPS,
  visualProgressionFrames = null,
  terminalHoldExtensionPolicy = null,
}) => {
  const frames = requireTotalFrames(totalFrames);
  requireFps(fps);
  const {progressionFrames, extensionFrames} = resolveTerminalHoldExtension({
    totalFrames: frames,
    visualProgressionFrames,
    terminalHoldExtensionPolicy,
  });
  const stateCountTotal = calculateActionStateCount(progressionFrames);
  const quotient = Math.floor(progressionFrames / stateCountTotal);
  const remainder = progressionFrames % stateCountTotal;
  let cursor = 0;
  const occurrences = Array.from({length: stateCountTotal}, (_, index) => {
    const duration = quotient + (index < remainder ? 1 : 0);
    const occurrence = {
      state_index: index,
      state_id: stateId(index),
      start_frame: cursor,
      end_frame: cursor + duration,
      duration_in_frames: duration,
      ...buildOccurrenceTiming({duration, index, fps}),
    };
    cursor += duration;
    return occurrence;
  });
  if (extensionFrames > 0) {
    const finalOccurrence = occurrences.at(-1);
    finalOccurrence.end_frame += extensionFrames;
    finalOccurrence.duration_in_frames += extensionFrames;
    finalOccurrence.clean_hold_in_frames += extensionFrames;
  }
  const transitionFrames = getIntraShotWatercolorBloomDurationInFrames(fps);
  const intraShotTransitions = Array.from({length: Math.max(0, stateCountTotal - 1)}, (_, index) => ({
    contract_version: INTRA_SHOT_WATERCOLOR_BLOOM_RULE_ID,
    kind: INTRA_SHOT_WATERCOLOR_BLOOM_KIND,
    duration_seconds: INTRA_SHOT_WATERCOLOR_BLOOM_SECONDS,
    duration_in_frames: transitionFrames,
    from_image_index: index,
    to_image_index: index + 1,
    renderer: INTRA_SHOT_WATERCOLOR_BLOOM_RENDERER,
  }));
  return {
    contract_version: ACTION_STATE_SCHEDULE_VERSION,
    fps,
    total_frames: frames,
    state_count_total: stateCountTotal,
    action_variant_count: stateCountTotal - 1,
    occurrences,
    intra_shot_transitions: intraShotTransitions,
    ...(extensionFrames > 0 ? {
      terminal_hold_extension_policy: terminalHoldExtensionPolicy,
      visual_progression_frames: progressionFrames,
      terminal_hold_extension_frames: extensionFrames,
    } : {}),
  };
};

const buildWithLockedIds = ({stateIds, totalFrames, fps}) => {
  const frames = requireTotalFrames(totalFrames);
  requireFps(fps);
  if (!Array.isArray(stateIds) || stateIds.length < 1 || stateIds.length > MAX_ACTION_STATE_COUNT) {
    throw new Error('revoice parent action-state order is invalid');
  }
  const quotient = Math.floor(frames / stateIds.length);
  const remainder = frames % stateIds.length;
  const durations = stateIds.map((_, index) => quotient + (index < remainder ? 1 : 0));
  if (stateIds.length > 1 && durations.some(
    (duration) => duration < MIN_MULTI_STATE_HOLD_FRAMES || duration > MAX_STATE_HOLD_FRAMES,
  )) throw new Error('revoice timing cannot preserve every locked state occurrence within 18–75 frames');
  if (stateIds.length > 1 && durations.some(
    (duration, index) => buildOccurrenceTiming({duration, index, fps}).clean_hold_in_frames < MIN_CLEAN_HOLD_FRAMES,
  )) throw new Error('revoice timing cannot preserve a 15-frame clean hold after watercolor reveal');
  let cursor = 0;
  const occurrences = stateIds.map((id, index) => {
    const duration = durations[index];
    const value = {
      state_index: index,
      state_id: id,
      start_frame: cursor,
      end_frame: cursor + duration,
      duration_in_frames: duration,
      ...buildOccurrenceTiming({duration, index, fps}),
    };
    cursor += duration;
    return value;
  });
  const transitionFrames = getIntraShotWatercolorBloomDurationInFrames(fps);
  return {
    contract_version: ACTION_STATE_SCHEDULE_VERSION,
    fps,
    total_frames: frames,
    state_count_total: stateIds.length,
    action_variant_count: stateIds.length - 1,
    occurrences,
    intra_shot_transitions: stateIds.slice(1).map((_, index) => ({
      contract_version: INTRA_SHOT_WATERCOLOR_BLOOM_RULE_ID,
      kind: INTRA_SHOT_WATERCOLOR_BLOOM_KIND,
      duration_seconds: INTRA_SHOT_WATERCOLOR_BLOOM_SECONDS,
      duration_in_frames: transitionFrames,
      from_image_index: index,
      to_image_index: index + 1,
      renderer: INTRA_SHOT_WATERCOLOR_BLOOM_RENDERER,
    })),
  };
};

export const retimeActionStateScheduleForRevoice = ({parentSchedule, totalFrames, fps = ACTION_STATE_FPS}) => {
  if (parentSchedule?.contract_version !== ACTION_STATE_SCHEDULE_VERSION
    || !Array.isArray(parentSchedule?.occurrences)) {
    throw new Error('revoice requires a parent action-state-schedule-v2');
  }
  return buildWithLockedIds({
    stateIds: parentSchedule.occurrences.map((item) => item.state_id),
    totalFrames,
    fps,
  });
};

const sameArray = (left, right) => Array.isArray(left)
  && Array.isArray(right)
  && left.length === right.length
  && left.every((value, index) => value === right[index]);

const validateActionStateScheduleV2 = (
  schedule,
  {totalFrames, fps = ACTION_STATE_FPS, revoiceLock = null} = {},
) => {
  const frames = requireTotalFrames(totalFrames);
  requireFps(fps);
  if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) {
    throw new Error('action-state schedule object is required');
  }
  if (schedule.contract_version !== ACTION_STATE_SCHEDULE_VERSION
    || schedule.fps !== fps
    || schedule.total_frames !== frames) {
    throw new Error('action-state-schedule-v2 authority mismatch');
  }
  const extensionFieldsPresent = [
    'terminal_hold_extension_policy',
    'visual_progression_frames',
    'terminal_hold_extension_frames',
  ].map((key) => Object.hasOwn(schedule, key));
  if (extensionFieldsPresent.some(Boolean) && !extensionFieldsPresent.every(Boolean)) {
    throw new Error('terminal hold extension fields must be complete');
  }
  const hasTerminalHoldExtension = extensionFieldsPresent.every(Boolean);
  if (hasTerminalHoldExtension && revoiceLock !== null) {
    throw new Error('revoice does not support a terminal hold extension without a parent extension lock');
  }
  const progressionFrames = hasTerminalHoldExtension
    ? schedule.visual_progression_frames
    : frames;
  const extensionFrames = hasTerminalHoldExtension
    ? schedule.terminal_hold_extension_frames
    : 0;
  if (hasTerminalHoldExtension) {
    if (schedule.terminal_hold_extension_policy !== TERMINAL_HOLD_EXTENSION_POLICY
      || !Number.isInteger(progressionFrames)
      || progressionFrames < 1
      || progressionFrames >= frames
      || !Number.isInteger(extensionFrames)
      || extensionFrames !== frames - progressionFrames) {
      throw new Error('terminal hold extension fields do not match the complete shot');
    }
  }
  const expectedCount = revoiceLock === null
    ? calculateActionStateCount(progressionFrames)
    : revoiceLock?.state_ids?.length;
  if (!Number.isInteger(expectedCount) || expectedCount < 1 || expectedCount > MAX_ACTION_STATE_COUNT) {
    throw new Error('revoice action-state lock is invalid');
  }
  if (schedule.state_count_total !== expectedCount
    || schedule.action_variant_count !== expectedCount - 1
    || !Array.isArray(schedule.occurrences)
    || schedule.occurrences.length !== expectedCount) {
    throw new Error('action-state count does not match the mechanical formula');
  }
  let cursor = 0;
  const progressionDurations = [];
  schedule.occurrences.forEach((occurrence, index) => {
    const duration = occurrence?.duration_in_frames;
    if (occurrence?.state_index !== index
      || typeof occurrence?.state_id !== 'string'
      || occurrence.state_id === ''
      || occurrence.start_frame !== cursor
      || occurrence.end_frame !== cursor + duration) {
      throw new Error('action-state occurrences must provide consecutive complete frame coverage');
    }
    if (!Number.isInteger(duration) || duration < 1) {
      throw new Error('action-state duration must be a positive integer');
    }
    const progressionDuration = duration - (index === expectedCount - 1 ? extensionFrames : 0);
    if (!Number.isInteger(progressionDuration) || progressionDuration < 1) {
      throw new Error('terminal hold extension must preserve a positive final progression state');
    }
    if (expectedCount > 1
      && (progressionDuration < MIN_MULTI_STATE_HOLD_FRAMES
        || progressionDuration > MAX_STATE_HOLD_FRAMES)) {
      throw new Error('multi-state action occurrence spans must be 18–75 frames');
    }
    const expectedTiming = buildOccurrenceTiming({duration, index, fps});
    if (occurrence.transition_in_frames !== expectedTiming.transition_in_frames
      || occurrence.clean_hold_in_frames !== expectedTiming.clean_hold_in_frames) {
      throw new Error('action-state occurrence reveal and clean hold fields must match renderer timing');
    }
    const progressionCleanHold = occurrence.clean_hold_in_frames
      - (index === expectedCount - 1 ? extensionFrames : 0);
    if (expectedCount > 1 && progressionCleanHold < MIN_CLEAN_HOLD_FRAMES) {
      throw new Error('multi-state action occurrences require at least a 15-frame clean hold after reveal');
    }
    progressionDurations.push(progressionDuration);
    cursor = occurrence.end_frame;
  });
  if (cursor !== frames) throw new Error('action-state occurrences do not cover the complete shot');
  if (progressionDurations.reduce((sum, duration) => sum + duration, 0) !== progressionFrames
    || Math.max(...progressionDurations) - Math.min(...progressionDurations) > 1
    || progressionDurations.some((duration, index) => index > 0 && duration > progressionDurations[index - 1])) {
    throw new Error('action-state durations must use quotient/remainder allocation from front to back');
  }
  if (!Array.isArray(schedule.intra_shot_transitions)
    || schedule.intra_shot_transitions.length !== expectedCount - 1) {
    throw new Error('action-state schedule requires exactly N - 1 watercolor transitions');
  }
  schedule.intra_shot_transitions.forEach((transition, index) => {
    validateIntraShotWatercolorTransition(transition, {
      fps,
      fromImageIndex: index,
      toImageIndex: index + 1,
    });
  });
  if (revoiceLock !== null) {
    const lockedIds = revoiceLock?.state_ids;
    const currentIds = schedule.occurrences.map((item) => item.state_id);
    if (!sameArray(currentIds, lockedIds)) {
      throw new Error('revoice must preserve the parent action-state count and order');
    }
  }
  return {result: 'pass', contract_version: ACTION_STATE_SCHEDULE_VERSION, state_count_total: expectedCount};
};

const requireNonEmptyString = (value, label) => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
};

const requireSha256 = (value, label) => {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256`);
  }
  return value;
};

const stateProjection = (schedule) => schedule.occurrences.map((occurrence) => ({
  state_id: occurrence.state_id,
  semantic_state: occurrence.semantic_state,
  narration_byte_start: occurrence.narration_byte_start,
  narration_byte_end: occurrence.narration_byte_end,
  narration_text: occurrence.narration_text,
}));

const transitionProjection = (schedule) => schedule.intra_shot_transitions.map((transition) => ({
  from_asset_id: transition.from_asset_id,
  to_asset_id: transition.to_asset_id,
  from_image_index: transition.from_image_index,
  to_image_index: transition.to_image_index,
  kind: transition.kind,
  duration_seconds: transition.duration_seconds,
  duration_in_frames: transition.duration_in_frames,
  renderer: transition.renderer,
}));

const statePlanProjection = (schedule) => schedule.contract_version === ACTION_STATE_SCHEDULE_V4_VERSION
  ? {
    contract_version: schedule.contract_version,
    fps: schedule.fps,
    motion_tier: schedule.motion_tier,
    state_count_total: schedule.state_count_total,
    action_variant_count: schedule.action_variant_count,
    background_asset_id: schedule.background_asset_id ?? null,
    density_mode: schedule.density_mode ?? null,
    visual_density_selection_sha256: schedule.visual_density_selection_sha256 ?? null,
    density_fallback: schedule.density_fallback ?? null,
    state_count_rationale: schedule.state_count_rationale ?? null,
    quantity_rationale: schedule.quantity_rationale ?? null,
    split_assessment: schedule.split_assessment ?? null,
    states: stateProjection(schedule),
    intra_shot_transitions: transitionProjection(schedule),
  }
  : {
    contract_version: ACTION_STATE_SCHEDULE_V3_VERSION,
    fps: schedule.fps,
    motion_tier: schedule.motion_tier,
    state_count_total: schedule.state_count_total,
    state_count_rationale: schedule.state_count_rationale ?? null,
    states: stateProjection(schedule),
    intra_shot_transitions: transitionProjection(schedule),
  };

export const buildActionStatePlanSha256 = (schedule) => crypto
  .createHash('sha256')
  .update(JSON.stringify(statePlanProjection(schedule)))
  .digest('hex');

export const calculateActionStateCadenceAdvisory = (totalFrames) => {
  const frames = requireTotalFrames(totalFrames);
  const preferred = Math.min(MAX_ACTION_STATE_COUNT, Math.max(1, Math.floor(frames / 45 + 0.5)));
  return {
    contract_version: ACTION_STATE_CADENCE_ADVISORY_VERSION,
    suggested_state_count: Math.max(preferred, Math.ceil(frames / MAX_STATE_HOLD_FRAMES)),
    max_hold_frames: MAX_STATE_HOLD_FRAMES,
    enforcement: 'advisory-only',
  };
};

const validateV3StateCount = ({motionTier, stateCount, stateCountRationale}) => {
  if (!ACTION_STATE_V3_MOTION_TIERS.includes(motionTier)) {
    throw new Error('action-state-schedule-v3 motion_tier must be stateful or hero_pose');
  }
  const [minimum, maximum] = motionTier === 'stateful' ? [2, 4] : [4, 6];
  if (!Number.isInteger(stateCount) || stateCount < minimum || stateCount > maximum) {
    throw new Error(`${motionTier} requires ${minimum}–${maximum} semantic states`);
  }
  if ((motionTier === 'stateful' && stateCount === 4) || stateCount > MAX_ACTION_STATE_COUNT) {
    requireNonEmptyString(stateCountRationale, 'state_count_rationale');
  }
};

const validateExtendedFamilyApproval = (schedule, {allowPending = false} = {}) => {
  if (schedule.state_count_total <= MAX_ACTION_STATE_COUNT) {
    if (schedule.split_assessment !== null || schedule.extended_family_approval !== null) {
      throw new Error('extended family evidence is allowed only above five states');
    }
    return;
  }
  const assessment = schedule.split_assessment;
  if (assessment?.natural_semantic_pause_available !== false) {
    throw new Error('extended action family requires a no-split assessment');
  }
  requireNonEmptyString(assessment.rationale, 'split_assessment.rationale');
  const approval = schedule.extended_family_approval;
  if (approval === null && allowPending) return;
  if (approval?.status !== 'approved') {
    throw new Error('extended action family requires explicit approved evidence');
  }
  requireNonEmptyString(approval.exact_message, 'extended_family_approval.exact_message');
  if (typeof approval.decided_at !== 'string' || Number.isNaN(Date.parse(approval.decided_at))) {
    throw new Error('extended_family_approval.decided_at must be an ISO date-time');
  }
  requireSha256(approval.presented_map_sha256, 'extended_family_approval.presented_map_sha256');
  if (approval.state_plan_sha256 !== buildActionStatePlanSha256(schedule)) {
    throw new Error('extended_family_approval state plan hash is stale');
  }
};

const validateUtf8Coverage = (sourceText, occurrences) => {
  requireNonEmptyString(sourceText, 'action-state source_text');
  const bytes = Buffer.from(sourceText, 'utf8');
  let expectedByteStart = 0;
  occurrences.forEach((occurrence, index) => {
    const start = occurrence.narration_byte_start;
    const end = occurrence.narration_byte_end;
    if (!Number.isInteger(start) || !Number.isInteger(end)
      || start !== expectedByteStart || end <= start || end > bytes.length) {
      throw new Error(`action-state narration byte ranges must be consecutive at index ${index}`);
    }
    const decoded = bytes.subarray(start, end).toString('utf8');
    if (decoded.includes('\uFFFD') || decoded !== occurrence.narration_text) {
      throw new Error(`action-state narration text does not match its UTF-8 byte range at index ${index}`);
    }
    expectedByteStart = end;
  });
  if (expectedByteStart !== bytes.length) {
    throw new Error('action-state narration byte ranges must cover source_text exactly once');
  }
};

const normalizeV3States = ({states, totalFrames, sourceText}) => {
  if (!Array.isArray(states) || states.length === 0) {
    throw new Error('action-state-schedule-v3 states are required');
  }
  const ids = new Set();
  const semantics = new Set();
  const normalized = states.map((state, index) => {
    const stateIdValue = requireNonEmptyString(state?.state_id ?? state?.stateId, `state ${index} state_id`);
    const semanticState = requireNonEmptyString(
      state?.semantic_state ?? state?.semanticState,
      `state ${index} semantic_state`,
    );
    if (ids.has(stateIdValue)) throw new Error(`action-state state_id is duplicated: ${stateIdValue}`);
    if (semantics.has(semanticState)) throw new Error(`action-state semantic_state is duplicated: ${semanticState}`);
    ids.add(stateIdValue);
    semantics.add(semanticState);
    const atFrame = state?.at_frame ?? state?.atFrame;
    if (!Number.isInteger(atFrame) || atFrame < 0 || atFrame >= totalFrames) {
      throw new Error(`state ${index} at_frame must be inside the shot`);
    }
    if (index === 0 ? atFrame !== 0 : atFrame <= (states[index - 1]?.at_frame ?? states[index - 1]?.atFrame)) {
      throw new Error('action-state at_frame values must begin at zero and increase strictly');
    }
    const byteStart = state?.narration_byte_start ?? state?.narrationByteStart;
    const byteEnd = state?.narration_byte_end ?? state?.narrationByteEnd;
    const narrationText = state?.narration_text ?? state?.narrationText;
    return {
      state_index: index,
      state_id: stateIdValue,
      semantic_state: semanticState,
      narration_byte_start: byteStart,
      narration_byte_end: byteEnd,
      narration_text: narrationText,
      at_frame: atFrame,
      end_frame: index === states.length - 1
        ? totalFrames
        : (states[index + 1]?.at_frame ?? states[index + 1]?.atFrame),
      semantic_hold_reason: state?.semantic_hold_reason ?? state?.semanticHoldReason ?? null,
    };
  });
  validateUtf8Coverage(sourceText, normalized);
  normalized.forEach((occurrence) => {
    occurrence.duration_in_frames = occurrence.end_frame - occurrence.at_frame;
    if (occurrence.duration_in_frames > MAX_STATE_HOLD_FRAMES) {
      requireNonEmptyString(occurrence.semantic_hold_reason, `${occurrence.state_id}.semantic_hold_reason`);
    } else if (occurrence.semantic_hold_reason !== null
      && (typeof occurrence.semantic_hold_reason !== 'string'
        || occurrence.semantic_hold_reason.trim() === '')) {
      throw new Error(`${occurrence.state_id}.semantic_hold_reason must be null or non-empty`);
    }
  });
  return normalized;
};

const finalizeV3Schedule = ({
  totalFrames,
  fps,
  sourceText,
  motionTier,
  states,
  stateCountRationale,
  intraShotTransitions,
  splitAssessment,
  extendedFamilyApproval,
  allowPendingExtendedApproval = false,
}) => {
  const frames = requireTotalFrames(totalFrames);
  requireFps(fps);
  const occurrences = normalizeV3States({states, totalFrames: frames, sourceText});
  validateV3StateCount({
    motionTier,
    stateCount: occurrences.length,
    stateCountRationale,
  });
  const imageSequence = occurrences.map((occurrence) => ({
    state_id: occurrence.state_id,
    at_frame: occurrence.at_frame,
    duration_in_frames: occurrence.duration_in_frames,
  }));
  const transitions = intraShotTransitions === null || intraShotTransitions === undefined
    ? buildDefaultIntraShotTransitions({imageSequence, fps})
    : structuredClone(intraShotTransitions);
  validateIntraShotTransitionSequence({imageSequence, transitions, fps});
  occurrences.forEach((occurrence, index) => {
    const transitionFrames = index === 0 ? 0 : transitions[index - 1].duration_in_frames;
    occurrence.transition_in_frames = transitionFrames;
    occurrence.clean_hold_in_frames = occurrence.duration_in_frames - transitionFrames;
  });
  const schedule = {
    contract_version: ACTION_STATE_SCHEDULE_V3_VERSION,
    fps,
    total_frames: frames,
    source_text: sourceText,
    motion_tier: motionTier,
    state_count_total: occurrences.length,
    action_variant_count: occurrences.length - 1,
    state_count_rationale: stateCountRationale ?? null,
    cadence_advisory: calculateActionStateCadenceAdvisory(frames),
    occurrences,
    intra_shot_transitions: transitions,
    split_assessment: splitAssessment ?? null,
    extended_family_approval: extendedFamilyApproval ?? null,
  };
  validateExtendedFamilyApproval(schedule, {allowPending: allowPendingExtendedApproval});
  return schedule;
};

export const buildActionStateScheduleV3 = ({
  totalFrames,
  fps = ACTION_STATE_FPS,
  sourceText,
  motionTier,
  states,
  stateCountRationale = null,
  intraShotTransitions = null,
  splitAssessment = null,
  extendedFamilyApproval = null,
}) => finalizeV3Schedule({
  totalFrames,
  fps,
  sourceText,
  motionTier,
  states,
  stateCountRationale,
  intraShotTransitions,
  splitAssessment,
  extendedFamilyApproval,
  allowPendingExtendedApproval: true,
});

export const retimeActionStateScheduleV3 = ({
  parentSchedule,
  totalFrames,
  stateAtFrames,
  fps = ACTION_STATE_FPS,
}) => {
  if (parentSchedule?.contract_version !== ACTION_STATE_SCHEDULE_V3_VERSION) {
    throw new Error('v3 revoice requires a parent action-state-schedule-v3');
  }
  if (!Array.isArray(stateAtFrames)
    || stateAtFrames.length !== parentSchedule.occurrences.length) {
    throw new Error('v3 revoice requires one aligned frame for every locked state');
  }
  const states = parentSchedule.occurrences.map((occurrence, index) => {
    const alignment = stateAtFrames[index];
    if (alignment?.state_id !== occurrence.state_id) {
      throw new Error('v3 revoice must preserve state IDs and order');
    }
    return {
      state_id: occurrence.state_id,
      semantic_state: occurrence.semantic_state,
      narration_byte_start: occurrence.narration_byte_start,
      narration_byte_end: occurrence.narration_byte_end,
      narration_text: occurrence.narration_text,
      at_frame: alignment.at_frame,
      semantic_hold_reason: occurrence.semantic_hold_reason,
    };
  });
  const transitions = parentSchedule.intra_shot_transitions.map((transition) => ({
    ...transition,
    at_frame: states[transition.to_image_index].at_frame,
  }));
  const schedule = finalizeV3Schedule({
    totalFrames,
    fps,
    sourceText: parentSchedule.source_text,
    motionTier: parentSchedule.motion_tier,
    states,
    stateCountRationale: parentSchedule.state_count_rationale,
    intraShotTransitions: transitions,
    splitAssessment: parentSchedule.split_assessment,
    extendedFamilyApproval: parentSchedule.extended_family_approval,
    allowPendingExtendedApproval: false,
  });
  const parentIds = parentSchedule.occurrences.map(({state_id: id}) => id);
  const currentIds = schedule.occurrences.map(({state_id: id}) => id);
  const parentTransitions = parentSchedule.intra_shot_transitions.map((transition) => ({
    kind: transition.kind,
    duration_seconds: transition.duration_seconds,
    duration_in_frames: transition.duration_in_frames,
    renderer: transition.renderer,
  }));
  const currentTransitions = schedule.intra_shot_transitions.map((transition) => ({
    kind: transition.kind,
    duration_seconds: transition.duration_seconds,
    duration_in_frames: transition.duration_in_frames,
    renderer: transition.renderer,
  }));
  if (!sameArray(parentIds, currentIds)
    || JSON.stringify(parentTransitions) !== JSON.stringify(currentTransitions)) {
    throw new Error('v3 revoice must preserve state order and intra-shot effects');
  }
  return schedule;
};

const validateActionStateScheduleV3 = (
  schedule,
  {totalFrames, fps = ACTION_STATE_FPS, revoiceLock = null} = {},
) => {
  const frames = requireTotalFrames(totalFrames);
  requireFps(fps);
  if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)
    || schedule.contract_version !== ACTION_STATE_SCHEDULE_V3_VERSION
    || schedule.fps !== fps || schedule.total_frames !== frames) {
    throw new Error('action-state-schedule-v3 authority mismatch');
  }
  validateV3StateCount({
    motionTier: schedule.motion_tier,
    stateCount: schedule.state_count_total,
    stateCountRationale: schedule.state_count_rationale,
  });
  if (schedule.action_variant_count !== schedule.state_count_total - 1
    || !Array.isArray(schedule.occurrences)
    || schedule.occurrences.length !== schedule.state_count_total) {
    throw new Error('action-state-schedule-v3 state count is inconsistent');
  }
  validateUtf8Coverage(schedule.source_text, schedule.occurrences);
  let expectedFrame = 0;
  const ids = new Set();
  const semantics = new Set();
  schedule.occurrences.forEach((occurrence, index) => {
    if (occurrence.state_index !== index
      || typeof occurrence.state_id !== 'string' || occurrence.state_id.trim() === ''
      || typeof occurrence.semantic_state !== 'string' || occurrence.semantic_state.trim() === ''
      || ids.has(occurrence.state_id) || semantics.has(occurrence.semantic_state)
      || occurrence.at_frame !== expectedFrame
      || occurrence.end_frame !== occurrence.at_frame + occurrence.duration_in_frames) {
      throw new Error('action-state-schedule-v3 occurrences must be unique and consecutive');
    }
    ids.add(occurrence.state_id);
    semantics.add(occurrence.semantic_state);
    if (occurrence.duration_in_frames > MAX_STATE_HOLD_FRAMES) {
      requireNonEmptyString(occurrence.semantic_hold_reason, `${occurrence.state_id}.semantic_hold_reason`);
    }
    expectedFrame = occurrence.end_frame;
  });
  if (expectedFrame !== frames) throw new Error('action-state-schedule-v3 must cover the complete shot');
  const imageSequence = schedule.occurrences.map((occurrence) => ({
    state_id: occurrence.state_id,
    at_frame: occurrence.at_frame,
    duration_in_frames: occurrence.duration_in_frames,
  }));
  validateIntraShotTransitionSequence({
    imageSequence,
    transitions: schedule.intra_shot_transitions,
    fps,
  });
  schedule.occurrences.forEach((occurrence, index) => {
    const transitionFrames = index === 0 ? 0 : schedule.intra_shot_transitions[index - 1].duration_in_frames;
    if (occurrence.transition_in_frames !== transitionFrames
      || occurrence.clean_hold_in_frames !== occurrence.duration_in_frames - transitionFrames) {
      throw new Error('action-state-schedule-v3 clean hold timing is stale');
    }
  });
  if (schedule.cadence_advisory?.contract_version !== ACTION_STATE_CADENCE_ADVISORY_VERSION
    || JSON.stringify(schedule.cadence_advisory) !== JSON.stringify(calculateActionStateCadenceAdvisory(frames))) {
    throw new Error('action-state-schedule-v3 cadence advisory is stale');
  }
  validateExtendedFamilyApproval(schedule);
  if (revoiceLock !== null) {
    const currentIds = schedule.occurrences.map(({state_id: id}) => id);
    if (!sameArray(currentIds, revoiceLock.state_ids)) {
      throw new Error('v3 revoice must preserve the parent state count and order');
    }
    if (revoiceLock.state_plan_sha256
      && buildActionStatePlanSha256(schedule) !== revoiceLock.state_plan_sha256) {
      throw new Error('v3 revoice must preserve the parent semantic state and effect plan');
    }
  }
  return {
    result: 'pass',
    contract_version: ACTION_STATE_SCHEDULE_V3_VERSION,
    state_count_total: schedule.state_count_total,
  };
};

const validateDensityFallback = ({motionTier, densityMode, stateCount, fallback}) => {
  const assetTotal = motionTier === 'hero_pose' ? stateCount + 1 : stateCount;
  const targetMinimum = motionTier === 'hero_pose' ? 10 : 4;
  const requiresFallback = densityMode === 'rich' && assetTotal < targetMinimum;
  if (!requiresFallback) {
    if (fallback !== null) throw new Error('density_fallback is allowed only below the rich target range');
    return;
  }
  if (!fallback || typeof fallback !== 'object' || Array.isArray(fallback)
    || fallback.target_minimum !== targetMinimum
    || fallback.actual_count !== assetTotal
    || fallback.maximum_feasible_count !== assetTotal
    || !DENSITY_FALLBACK_REASON_CODES.includes(fallback.reason_code)) {
    throw new Error('rich density fallback must record target, actual maximum feasible count, and allowed reason code');
  }
  requireNonEmptyString(fallback.rationale, 'density_fallback.rationale');
};

const validateV4Count = (schedule) => {
  if (!ACTION_STATE_V3_MOTION_TIERS.includes(schedule.motion_tier)) {
    throw new Error('action-state-schedule-v4 motion_tier must be stateful or hero_pose');
  }
  if (!['standard', 'rich'].includes(schedule.density_mode)) {
    throw new Error('action-state-schedule-v4 density_mode must be standard or rich');
  }
  requireSha256(schedule.visual_density_selection_sha256, 'visual_density_selection_sha256');
  const count = schedule.state_count_total;
  if (schedule.motion_tier === 'stateful') {
    const maximum = schedule.density_mode === 'rich' ? 6 : 4;
    if (!Number.isInteger(count) || count < 2 || count > maximum) {
      throw new Error(`stateful ${schedule.density_mode} requires 2–${maximum} states`);
    }
    if (schedule.density_mode === 'standard' && count === 4) {
      requireNonEmptyString(schedule.state_count_rationale, 'state_count_rationale');
    }
  } else {
    const maximumPoses = schedule.density_mode === 'rich' ? 13 : 6;
    if (!Number.isInteger(count) || count < 4 || count > maximumPoses) {
      throw new Error(`hero_pose ${schedule.density_mode} requires 4–${maximumPoses} poses`);
    }
    requireNonEmptyString(schedule.background_asset_id, 'hero_pose background_asset_id');
    if (schedule.density_mode === 'standard' && count === 6) {
      if (schedule.split_assessment?.natural_semantic_pause_available !== false) {
        throw new Error('standard sixth hero pose requires a no-split assessment');
      }
      requireNonEmptyString(schedule.split_assessment.rationale, 'split_assessment.rationale');
    }
    const assetTotal = count + 1;
    if (schedule.density_mode === 'rich' && assetTotal >= 13) {
      if (schedule.split_assessment?.natural_semantic_pause_available !== false) {
        throw new Error('rich hero total 13–14 requires a no-split assessment');
      }
      requireNonEmptyString(schedule.split_assessment.rationale, 'split_assessment.rationale');
      requireNonEmptyString(schedule.quantity_rationale, 'quantity_rationale');
    }
  }
  validateDensityFallback({
    motionTier: schedule.motion_tier,
    densityMode: schedule.density_mode,
    stateCount: count,
    fallback: schedule.density_fallback,
  });
};

const finalizeV4Schedule = ({
  totalFrames,
  fps,
  sourceText,
  motionTier,
  states,
  densityMode,
  visualDensitySelectionSha256,
  backgroundAssetId,
  stateCountRationale,
  densityFallback,
  splitAssessment,
  quantityRationale,
  intraShotTransitions,
}) => {
  const frames = requireTotalFrames(totalFrames);
  requireFps(fps);
  const occurrences = normalizeV3States({states, totalFrames: frames, sourceText});
  const imageSequence = occurrences.map((occurrence) => ({
    state_id: occurrence.state_id,
    at_frame: occurrence.at_frame,
    duration_in_frames: occurrence.duration_in_frames,
  }));
  const transitions = intraShotTransitions === null || intraShotTransitions === undefined
    ? buildDefaultIntraShotTransitions({imageSequence, fps})
    : structuredClone(intraShotTransitions);
  validateIntraShotTransitionSequence({imageSequence, transitions, fps});
  occurrences.forEach((occurrence, index) => {
    const transitionFrames = index === 0 ? 0 : transitions[index - 1].duration_in_frames;
    occurrence.transition_in_frames = transitionFrames;
    occurrence.clean_hold_in_frames = occurrence.duration_in_frames - transitionFrames;
  });
  const schedule = {
    contract_version: ACTION_STATE_SCHEDULE_V4_VERSION,
    fps,
    total_frames: frames,
    source_text: sourceText,
    motion_tier: motionTier,
    density_mode: densityMode,
    visual_density_selection_sha256: visualDensitySelectionSha256,
    background_asset_id: motionTier === 'hero_pose' ? backgroundAssetId : null,
    state_count_total: occurrences.length,
    action_variant_count: motionTier === 'hero_pose' ? occurrences.length : occurrences.length - 1,
    state_count_rationale: stateCountRationale ?? null,
    density_fallback: densityFallback ?? null,
    split_assessment: splitAssessment ?? null,
    quantity_rationale: quantityRationale ?? null,
    cadence_advisory: calculateActionStateCadenceAdvisory(frames),
    occurrences,
    intra_shot_transitions: transitions,
  };
  validateV4Count(schedule);
  return schedule;
};

export const buildActionStateScheduleV4 = ({
  totalFrames,
  fps = ACTION_STATE_FPS,
  sourceText,
  motionTier,
  states,
  densityMode,
  visualDensitySelectionSha256,
  backgroundAssetId = null,
  stateCountRationale = null,
  densityFallback = null,
  splitAssessment = null,
  quantityRationale = null,
  intraShotTransitions = null,
}) => finalizeV4Schedule({
  totalFrames,
  fps,
  sourceText,
  motionTier,
  states,
  densityMode,
  visualDensitySelectionSha256,
  backgroundAssetId,
  stateCountRationale,
  densityFallback,
  splitAssessment,
  quantityRationale,
  intraShotTransitions,
});

export const retimeActionStateScheduleV4 = ({
  parentSchedule,
  totalFrames,
  stateAtFrames,
  fps = ACTION_STATE_FPS,
}) => {
  if (parentSchedule?.contract_version !== ACTION_STATE_SCHEDULE_V4_VERSION) {
    throw new Error('v4 revoice requires a parent action-state-schedule-v4');
  }
  if (!Array.isArray(stateAtFrames) || stateAtFrames.length !== parentSchedule.occurrences.length) {
    throw new Error('v4 revoice requires one aligned frame for every locked state');
  }
  const states = parentSchedule.occurrences.map((occurrence, index) => {
    if (stateAtFrames[index]?.state_id !== occurrence.state_id) {
      throw new Error('v4 revoice must preserve state IDs and order');
    }
    return {
      state_id: occurrence.state_id,
      semantic_state: occurrence.semantic_state,
      narration_byte_start: occurrence.narration_byte_start,
      narration_byte_end: occurrence.narration_byte_end,
      narration_text: occurrence.narration_text,
      at_frame: stateAtFrames[index].at_frame,
      semantic_hold_reason: occurrence.semantic_hold_reason,
    };
  });
  const transitions = parentSchedule.intra_shot_transitions.map((transition) => ({
    ...transition,
    at_frame: states[transition.to_image_index].at_frame,
  }));
  const schedule = finalizeV4Schedule({
    totalFrames,
    fps,
    sourceText: parentSchedule.source_text,
    motionTier: parentSchedule.motion_tier,
    states,
    densityMode: parentSchedule.density_mode,
    visualDensitySelectionSha256: parentSchedule.visual_density_selection_sha256,
    backgroundAssetId: parentSchedule.background_asset_id,
    stateCountRationale: parentSchedule.state_count_rationale,
    densityFallback: parentSchedule.density_fallback,
    splitAssessment: parentSchedule.split_assessment,
    quantityRationale: parentSchedule.quantity_rationale,
    intraShotTransitions: transitions,
  });
  if (buildActionStatePlanSha256(schedule) !== buildActionStatePlanSha256(parentSchedule)) {
    throw new Error('v4 revoice must preserve density, state count, order, semantics, and effects');
  }
  return schedule;
};

const validateActionStateScheduleV4 = (
  schedule,
  {totalFrames, fps = ACTION_STATE_FPS, densityMode = null, densitySelectionSha256 = null, revoiceLock = null} = {},
) => {
  const frames = requireTotalFrames(totalFrames);
  requireFps(fps);
  if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)
    || schedule.contract_version !== ACTION_STATE_SCHEDULE_V4_VERSION
    || schedule.fps !== fps || schedule.total_frames !== frames) {
    throw new Error('action-state-schedule-v4 authority mismatch');
  }
  if (densityMode !== null && schedule.density_mode !== densityMode) {
    throw new Error('action-state-schedule-v4 density mode binding is stale');
  }
  if (densitySelectionSha256 !== null
    && schedule.visual_density_selection_sha256 !== densitySelectionSha256) {
    throw new Error('action-state-schedule-v4 density selection hash is stale');
  }
  validateV4Count(schedule);
  const expectedVariants = schedule.motion_tier === 'hero_pose'
    ? schedule.state_count_total
    : schedule.state_count_total - 1;
  if (schedule.action_variant_count !== expectedVariants
    || !Array.isArray(schedule.occurrences)
    || schedule.occurrences.length !== schedule.state_count_total) {
    throw new Error('action-state-schedule-v4 state or pose count is inconsistent');
  }
  validateUtf8Coverage(schedule.source_text, schedule.occurrences);
  let expectedFrame = 0;
  const ids = new Set();
  const semantics = new Set();
  schedule.occurrences.forEach((occurrence, index) => {
    if (occurrence.state_index !== index
      || typeof occurrence.state_id !== 'string' || occurrence.state_id.trim() === ''
      || typeof occurrence.semantic_state !== 'string' || occurrence.semantic_state.trim() === ''
      || ids.has(occurrence.state_id) || semantics.has(occurrence.semantic_state)
      || occurrence.at_frame !== expectedFrame
      || occurrence.end_frame !== occurrence.at_frame + occurrence.duration_in_frames) {
      throw new Error('action-state-schedule-v4 occurrences must be unique and consecutive');
    }
    ids.add(occurrence.state_id);
    semantics.add(occurrence.semantic_state);
    expectedFrame = occurrence.end_frame;
  });
  if (expectedFrame !== frames) throw new Error('action-state-schedule-v4 must cover the complete shot');
  const imageSequence = schedule.occurrences.map((occurrence) => ({
    state_id: occurrence.state_id,
    at_frame: occurrence.at_frame,
    duration_in_frames: occurrence.duration_in_frames,
  }));
  validateIntraShotTransitionSequence({imageSequence, transitions: schedule.intra_shot_transitions, fps});
  const transitionFrameTotal = schedule.intra_shot_transitions.reduce(
    (total, transition) => total + transition.duration_in_frames,
    0,
  );
  const minimumFrames = MIN_CLEAN_HOLD_FRAMES * schedule.state_count_total + transitionFrameTotal;
  if (frames < minimumFrames) {
    throw new Error(`action-state-schedule-v4 requires at least 15*N clean frames plus transition frames (${minimumFrames})`);
  }
  schedule.occurrences.forEach((occurrence, index) => {
    const transitionFrames = index === 0 ? 0 : schedule.intra_shot_transitions[index - 1].duration_in_frames;
    if (occurrence.transition_in_frames !== transitionFrames
      || occurrence.clean_hold_in_frames !== occurrence.duration_in_frames - transitionFrames
      || occurrence.clean_hold_in_frames < MIN_CLEAN_HOLD_FRAMES) {
      throw new Error('action-state-schedule-v4 clean hold timing is stale or below 15 frames');
    }
  });
  if (revoiceLock !== null) {
    if (revoiceLock.state_plan_sha256 !== buildActionStatePlanSha256(schedule)
      || revoiceLock.density_mode !== schedule.density_mode
      || revoiceLock.visual_density_selection_sha256 !== schedule.visual_density_selection_sha256) {
      throw new Error('v4 revoice must preserve density, counts, order, hashes, and effects');
    }
  }
  return {
    result: 'pass',
    contract_version: ACTION_STATE_SCHEDULE_V4_VERSION,
    state_count_total: schedule.state_count_total,
    asset_total: schedule.motion_tier === 'hero_pose'
      ? schedule.state_count_total + 1
      : schedule.state_count_total,
  };
};

export const validateActionStateSchedule = (schedule, context = {}) => {
  if (schedule?.contract_version === ACTION_STATE_SCHEDULE_VERSION) {
    return validateActionStateScheduleV2(schedule, context);
  }
  if (schedule?.contract_version === ACTION_STATE_SCHEDULE_V3_VERSION) {
    return validateActionStateScheduleV3(schedule, context);
  }
  if (schedule?.contract_version === ACTION_STATE_SCHEDULE_V4_VERSION) {
    return validateActionStateScheduleV4(schedule, context);
  }
  throw new Error('unsupported action-state schedule contract_version');
};
