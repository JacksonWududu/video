import {
  INTRA_SHOT_WATERCOLOR_BLOOM_KIND,
  INTRA_SHOT_WATERCOLOR_BLOOM_RENDERER,
  INTRA_SHOT_WATERCOLOR_BLOOM_SECONDS,
  getIntraShotWatercolorBloomDurationInFrames,
} from '../watercolor-bloom/contract.mjs';

export const INTRA_SHOT_TRANSITION_VERSION = 'intra-shot-transition-v1';
export const INTRA_SHOT_CUT_KIND = 'cut';
export const INTRA_SHOT_CUT_SECONDS = 0;
export const INTRA_SHOT_CUT_RENDERER = null;
export const INTRA_SHOT_TRANSITION_KINDS = Object.freeze([
  INTRA_SHOT_CUT_KIND,
  INTRA_SHOT_WATERCOLOR_BLOOM_KIND,
]);
export const MIN_INTRA_SHOT_CLEAN_HOLD_FRAMES = 15;
const SHA256 = /^[a-f0-9]{64}$/;

const requireFps = (fps) => {
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error(`intra-shot-transition-v1 requires a positive fps, received ${fps}`);
  }
  return fps;
};

const requireNonEmptyString = (value, label) => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
};

const itemId = (item, index) => requireNonEmptyString(
  item?.asset_id ?? item?.state_id,
  `intra-shot image ${index} ID`,
);

const itemFrom = (item, index) => {
  const value = item?.from ?? item?.at_frame ?? item?.start_frame;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`intra-shot image ${index} start frame must be a non-negative integer`);
  }
  return value;
};

const itemDuration = (item, index) => {
  const value = item?.duration_in_frames ?? item?.durationInFrames;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`intra-shot image ${index} duration must be a positive integer`);
  }
  return value;
};

const validateImageSequence = (imageSequence) => {
  if (!Array.isArray(imageSequence) || imageSequence.length === 0) {
    throw new Error('intra-shot-transition-v1 requires a non-empty image sequence');
  }
  const ids = new Set();
  let expectedFrom = 0;
  return imageSequence.map((item, index) => {
    const id = itemId(item, index);
    if (ids.has(id)) throw new Error(`intra-shot image ID is duplicated: ${id}`);
    ids.add(id);
    const from = itemFrom(item, index);
    const durationInFrames = itemDuration(item, index);
    if (from !== expectedFrom) {
      throw new Error(`intra-shot image sequence must be consecutive at index ${index}`);
    }
    expectedFrom += durationInFrames;
    return {id, from, duration_in_frames: durationInFrames};
  });
};

export const getIntraShotTransitionDurationInFrames = (kind, fps) => {
  requireFps(fps);
  if (kind === INTRA_SHOT_CUT_KIND) return 0;
  if (kind === INTRA_SHOT_WATERCOLOR_BLOOM_KIND) {
    return getIntraShotWatercolorBloomDurationInFrames(fps);
  }
  throw new Error(`unsupported intra-shot transition kind: ${kind}`);
};

const transitionShape = ({kind, from, to, fromImageIndex, toImageIndex, fps}) => {
  const durationInFrames = getIntraShotTransitionDurationInFrames(kind, fps);
  return {
    contract_version: INTRA_SHOT_TRANSITION_VERSION,
    from_asset_id: from.id,
    to_asset_id: to.id,
    at_frame: to.from,
    duration_seconds: kind === INTRA_SHOT_CUT_KIND
      ? INTRA_SHOT_CUT_SECONDS
      : INTRA_SHOT_WATERCOLOR_BLOOM_SECONDS,
    duration_in_frames: durationInFrames,
    from_image_index: fromImageIndex,
    to_image_index: toImageIndex,
    kind,
    renderer: kind === INTRA_SHOT_CUT_KIND
      ? INTRA_SHOT_CUT_RENDERER
      : INTRA_SHOT_WATERCOLOR_BLOOM_RENDERER,
    user_selection: null,
  };
};

export const buildDefaultIntraShotTransitions = ({imageSequence, fps = 30}) => {
  requireFps(fps);
  const items = validateImageSequence(imageSequence);
  return items.slice(1).map((to, index) => transitionShape({
    kind: INTRA_SHOT_CUT_KIND,
    from: items[index],
    to,
    fromImageIndex: index,
    toImageIndex: index + 1,
    fps,
  }));
};

export const validateIntraShotTransition = (
  transition,
  {fps, from, to, fromImageIndex, toImageIndex},
) => {
  requireFps(fps);
  if (!transition || typeof transition !== 'object' || Array.isArray(transition)) {
    throw new Error('intra-shot transition must be an object');
  }
  if (!INTRA_SHOT_TRANSITION_KINDS.includes(transition.kind)) {
    throw new Error(`unsupported intra-shot transition kind: ${transition.kind}`);
  }
  const expected = transitionShape({
    kind: transition.kind,
    from,
    to,
    fromImageIndex,
    toImageIndex,
    fps,
  });
  for (const [key, expectedValue] of Object.entries(expected).filter(([key]) => key !== 'user_selection')) {
    if (transition[key] !== expectedValue) {
      throw new Error(`${INTRA_SHOT_TRANSITION_VERSION} contract mismatch at ${key}`);
    }
  }
  if (transition.kind === INTRA_SHOT_CUT_KIND) {
    if (transition.user_selection !== null) {
      throw new Error('default cut must not carry an effect-specific user selection');
    }
  } else {
    const selection = transition.user_selection;
    if (selection?.status !== 'approved'
      || typeof selection.exact_message !== 'string' || selection.exact_message.trim() === ''
      || typeof selection.decided_at !== 'string' || Number.isNaN(Date.parse(selection.decided_at))
      || typeof selection.presented_map_sha256 !== 'string'
      || !SHA256.test(selection.presented_map_sha256)) {
      throw new Error('watercolor-bloom requires explicit approved user selection evidence');
    }
  }
  return transition;
};

export const validateIntraShotTransitionSequence = ({
  imageSequence,
  transitions,
  fps = 30,
}) => {
  requireFps(fps);
  const items = validateImageSequence(imageSequence);
  if (!Array.isArray(transitions) || transitions.length !== items.length - 1) {
    throw new Error('intra-shot-transition-v1 requires exactly N - 1 transition records');
  }
  if (items[0].duration_in_frames < MIN_INTRA_SHOT_CLEAN_HOLD_FRAMES) {
    throw new Error('the first intra-shot image requires at least a 15-frame clean hold');
  }
  transitions.forEach((transition, index) => {
    validateIntraShotTransition(transition, {
      fps,
      from: items[index],
      to: items[index + 1],
      fromImageIndex: index,
      toImageIndex: index + 1,
    });
    const cleanHold = items[index + 1].duration_in_frames - transition.duration_in_frames;
    if (cleanHold < MIN_INTRA_SHOT_CLEAN_HOLD_FRAMES) {
      throw new Error(`${transition.kind} target state requires at least a 15-frame clean hold`);
    }
  });
  return {
    result: 'pass',
    contract_version: INTRA_SHOT_TRANSITION_VERSION,
    image_count: items.length,
    transition_count: transitions.length,
  };
};
