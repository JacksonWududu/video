export type IanElementClass =
  | 'paper_card'
  | 'solid_node'
  | 'mechanism'
  | 'closed_outline'
  | 'open_path'
  | 'broad_region';

export type IanSoftSettleEffect = {
  readonly contract_version: 'soft-settle-v1';
  readonly duration_frames: 8;
  readonly opacity_easing: 'linear';
  readonly translation_profile: 'fixed-damped-v1';
  readonly axis: 'x' | 'y';
  readonly direction: -1 | 1;
  readonly max_displacement_px: 10;
  readonly edge_margin_px: number;
};

export type IanInkDrawRevealEffect = {
  readonly contract_version: 'ink-draw-reveal-v1';
  readonly reveal_kind: 'contour-draw' | 'path-grow';
  readonly duration_frames: 12;
  readonly easing: 'ease-in-out';
  readonly vector_asset: {readonly asset: string; readonly checksum_sha256: string};
  readonly path_spec: {
    readonly view_box: readonly [0, 0, 1920, 1080];
    readonly paths: readonly {
      readonly d: string;
      readonly length: number;
      readonly stroke_width: number;
    }[];
  };
  readonly path_spec_sha256: string;
};

export type IanFadeOnlyEffect = {
  readonly contract_version: 'fade-only-v1';
  readonly duration_frames: 8;
  readonly easing: 'linear';
  readonly fallback_reason: string;
};

export type IanLayeredEntryEffectsPlan = {
  readonly contract_version: 'ian-layered-entry-effects-v2';
  readonly shot_id: string;
  readonly scene_plan_sha256: string;
  readonly package_manifest: {readonly path: string; readonly checksum_sha256: string};
  readonly fps: 30;
  readonly duration_frames: number;
  readonly policy_authorization: {
    readonly status: 'policy_authorized';
    readonly policy_sha256: string;
    readonly user_has_reviewed_specific_map: false;
  };
  readonly sound_effect_library: {readonly path: string; readonly checksum_sha256: string};
  readonly mix_policy: {
    readonly narration_gain: 1;
    readonly normalize: false;
    readonly peak_ceiling_dbfs: -1;
    readonly narration_mean_loudness_change_max_db: 0.5;
    readonly overflow_action: 'lower-sfx-bus-uniformly';
  };
  readonly language_families: readonly ('soft-settle-v1' | 'ink-draw-reveal-v1')[];
  readonly layer_count: number;
  readonly layers: readonly {
    readonly layer_id: string;
    readonly entry_frame: number;
    readonly element_class: IanElementClass;
    readonly language_family: 'soft-settle-v1' | 'ink-draw-reveal-v1' | 'fade-only-v1';
    readonly effect: IanSoftSettleEffect | IanInkDrawRevealEffect | IanFadeOnlyEffect;
    readonly sound_effect: null | {
      readonly contract_version: 'ian-layer-entry-sfx-cue-v2';
      readonly role: string;
      readonly selection_reason: string;
      readonly source: {
        readonly asset_id: string;
        readonly path: string;
        readonly checksum_sha256: string;
        readonly trim_start_sample: number;
        readonly trim_end_sample_exclusive: number;
      };
      readonly derived_asset: {
        readonly asset: string;
        readonly checksum_sha256: string;
        readonly sample_rate_hz: 44100;
        readonly channels: 2;
      };
      readonly cue_frame: number;
      readonly cue_sample: number;
      readonly gain_multiplier: number;
    };
  }[];
  readonly presented_map_sha256: string;
};

export const IAN_LAYERED_ENTRY_EFFECTS_VERSION: 'ian-layered-entry-effects-v2';
export const IAN_LAYERED_ENTRY_RENDERER_VERSION: 'ian-layered-entry-effects-renderer-v2';
export const IAN_SOFT_SETTLE_VERSION: 'soft-settle-v1';
export const IAN_INK_DRAW_REVEAL_VERSION: 'ink-draw-reveal-v1';
export const IAN_FADE_ONLY_VERSION: 'fade-only-v1';
export const IAN_LAYERED_ENTRY_EFFECTS_POLICY_SHA256: string;
export function buildIanLayeredEntryEffectsMapSha256(value: unknown): string;
export function softSettleOffset(
  localEffectFrame: number,
  effect: {axis: 'x' | 'y'; direction: -1 | 1; max_displacement_px: 10},
): {x: number; y: number};
export function validateIanLayeredEntryEffectsPlan(
  plan: IanLayeredEntryEffectsPlan,
  expected: Record<string, unknown>,
): IanLayeredEntryEffectsPlan;
