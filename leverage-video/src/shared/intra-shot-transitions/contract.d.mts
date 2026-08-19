export type IntraShotTransitionKind = 'cut' | 'watercolor-bloom';

export type IntraShotTransitionV1 = {
  readonly contract_version: 'intra-shot-transition-v1';
  readonly from_asset_id: string;
  readonly to_asset_id: string;
  readonly at_frame: number;
  readonly duration_seconds: 0 | 0.6;
  readonly duration_in_frames: number;
  readonly from_image_index: number;
  readonly to_image_index: number;
  readonly kind: IntraShotTransitionKind;
  readonly renderer: null | 'leverage-video/src/shared/watercolor-bloom';
  readonly user_selection: null | {
    readonly status: 'approved';
    readonly exact_message: string;
    readonly decided_at: string;
    readonly presented_map_sha256: string;
  };
};

export const INTRA_SHOT_TRANSITION_VERSION: 'intra-shot-transition-v1';
export const INTRA_SHOT_CUT_KIND: 'cut';
export const INTRA_SHOT_CUT_SECONDS: 0;
export const INTRA_SHOT_CUT_RENDERER: null;
export const INTRA_SHOT_TRANSITION_KINDS: readonly IntraShotTransitionKind[];
export const MIN_INTRA_SHOT_CLEAN_HOLD_FRAMES: 15;

export function getIntraShotTransitionDurationInFrames(
  kind: IntraShotTransitionKind,
  fps: number,
): number;

export function buildDefaultIntraShotTransitions(input: {
  imageSequence: readonly Readonly<Record<string, unknown>>[];
  fps?: number;
}): IntraShotTransitionV1[];

export function validateIntraShotTransition(
  transition: IntraShotTransitionV1,
  context: Readonly<Record<string, unknown>>,
): IntraShotTransitionV1;

export function validateIntraShotTransitionSequence(input: {
  imageSequence: readonly Readonly<Record<string, unknown>>[];
  transitions: readonly IntraShotTransitionV1[];
  fps?: number;
}): {
  result: 'pass';
  contract_version: 'intra-shot-transition-v1';
  image_count: number;
  transition_count: number;
};
