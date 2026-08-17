export type IntraShotWatercolorTransition = {
  readonly contract_version: 'intra-shot-watercolor-bloom-v1';
  readonly kind: 'watercolor-bloom';
  readonly duration_seconds: 0.6;
  readonly duration_in_frames: number;
  readonly from_image_index: number;
  readonly to_image_index: number;
  readonly renderer: 'leverage-video/src/shared/watercolor-bloom';
};

export const INTRA_SHOT_WATERCOLOR_BLOOM_RULE_ID: 'intra-shot-watercolor-bloom-v1';
export const INTRA_SHOT_WATERCOLOR_BLOOM_KIND: 'watercolor-bloom';
export const INTRA_SHOT_WATERCOLOR_BLOOM_SECONDS: 0.6;
export const INTRA_SHOT_WATERCOLOR_BLOOM_RENDERER: 'leverage-video/src/shared/watercolor-bloom';

export function getIntraShotWatercolorBloomDurationInFrames(fps: number): number;

export function validateIntraShotWatercolorTransition(
  transition: unknown,
  context: {fps: number; fromImageIndex: number; toImageIndex: number},
): IntraShotWatercolorTransition;
