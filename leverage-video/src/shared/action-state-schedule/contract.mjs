import {
  INTRA_SHOT_WATERCOLOR_BLOOM_KIND,
  INTRA_SHOT_WATERCOLOR_BLOOM_RENDERER,
  INTRA_SHOT_WATERCOLOR_BLOOM_RULE_ID,
  INTRA_SHOT_WATERCOLOR_BLOOM_SECONDS,
  getIntraShotWatercolorBloomDurationInFrames,
  validateIntraShotWatercolorTransition,
} from '../watercolor-bloom/contract.mjs';

export const ACTION_STATE_SCHEDULE_VERSION = 'action-state-schedule-v2';
export const ACTION_STATE_FPS = 30;
export const MIN_MULTI_STATE_HOLD_FRAMES = 18;
export const MAX_STATE_HOLD_FRAMES = 75;
export const MIN_CLEAN_HOLD_FRAMES = 15;
export const MAX_ACTION_STATE_COUNT = 5;

const requireTotalFrames = (value) => {
  if (!Number.isInteger(value) || value < 1) throw new Error('action-state totalFrames must be a positive integer');
  return value;
};

const requireFps = (fps) => {
  if (fps !== ACTION_STATE_FPS) throw new Error('action-state-schedule-v2 requires 30 fps');
  return fps;
};

const buildOccurrenceTiming = ({duration, index, fps}) => {
  const transitionInFrames = index === 0 ? 0 : getIntraShotWatercolorBloomDurationInFrames(fps);
  return {
    transition_in_frames: transitionInFrames,
    clean_hold_in_frames: duration - transitionInFrames,
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

export const buildActionStateSchedule = ({totalFrames, fps = ACTION_STATE_FPS}) => {
  const frames = requireTotalFrames(totalFrames);
  requireFps(fps);
  const stateCountTotal = calculateActionStateCount(frames);
  const quotient = Math.floor(frames / stateCountTotal);
  const remainder = frames % stateCountTotal;
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

export const validateActionStateSchedule = (
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
  const expectedCount = revoiceLock === null
    ? calculateActionStateCount(frames)
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
    if (expectedCount > 1
      && (duration < MIN_MULTI_STATE_HOLD_FRAMES || duration > MAX_STATE_HOLD_FRAMES)) {
      throw new Error('multi-state action occurrence spans must be 18–75 frames');
    }
    const expectedTiming = buildOccurrenceTiming({duration, index, fps});
    if (occurrence.transition_in_frames !== expectedTiming.transition_in_frames
      || occurrence.clean_hold_in_frames !== expectedTiming.clean_hold_in_frames) {
      throw new Error('action-state occurrence reveal and clean hold fields must match renderer timing');
    }
    if (expectedCount > 1 && occurrence.clean_hold_in_frames < MIN_CLEAN_HOLD_FRAMES) {
      throw new Error('multi-state action occurrences require at least a 15-frame clean hold after reveal');
    }
    cursor = occurrence.end_frame;
  });
  if (cursor !== frames) throw new Error('action-state occurrences do not cover the complete shot');
  const durations = schedule.occurrences.map((item) => item.duration_in_frames);
  if (Math.max(...durations) - Math.min(...durations) > 1
    || durations.some((duration, index) => index > 0 && duration > durations[index - 1])) {
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
