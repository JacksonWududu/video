export const INTRA_SHOT_WATERCOLOR_BLOOM_RULE_ID = 'intra-shot-watercolor-bloom-v1';
export const INTRA_SHOT_WATERCOLOR_BLOOM_KIND = 'watercolor-bloom';
export const INTRA_SHOT_WATERCOLOR_BLOOM_SECONDS = 0.6;
export const INTRA_SHOT_WATERCOLOR_BLOOM_RENDERER = 'leverage-video/src/shared/watercolor-bloom';

export const getIntraShotWatercolorBloomDurationInFrames = (fps) => {
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error(`intra-shot watercolor bloom requires a positive fps, received ${fps}`);
  }
  return Math.round(fps * INTRA_SHOT_WATERCOLOR_BLOOM_SECONDS);
};

export const validateIntraShotWatercolorTransition = (
  transition,
  {fps, fromImageIndex, toImageIndex},
) => {
  if (!transition || typeof transition !== 'object' || Array.isArray(transition)) {
    throw new Error('intra-shot watercolor transition must be an object');
  }
  const durationInFrames = getIntraShotWatercolorBloomDurationInFrames(fps);
  if (
    transition.contract_version !== INTRA_SHOT_WATERCOLOR_BLOOM_RULE_ID
    || transition.kind !== INTRA_SHOT_WATERCOLOR_BLOOM_KIND
    || transition.duration_seconds !== INTRA_SHOT_WATERCOLOR_BLOOM_SECONDS
    || transition.duration_in_frames !== durationInFrames
    || transition.from_image_index !== fromImageIndex
    || transition.to_image_index !== toImageIndex
    || transition.renderer !== INTRA_SHOT_WATERCOLOR_BLOOM_RENDERER
  ) {
    throw new Error(`${INTRA_SHOT_WATERCOLOR_BLOOM_RULE_ID} contract mismatch`);
  }
  return transition;
};
