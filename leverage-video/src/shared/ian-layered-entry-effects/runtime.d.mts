import type {IanLayeredEntryEffectsPlan} from './contract.mjs';

export const IAN_LAYERED_ENTRY_EFFECTS_VERSION: 'ian-layered-entry-effects-v2';
export const IAN_LAYERED_ENTRY_RENDERER_VERSION: 'ian-layered-entry-effects-renderer-v2';
export const IAN_LAYER_ENTRY_LANGUAGE_POLICY_VERSION: 'ian-layer-entry-language-policy-v1';
export const IAN_SOFT_SETTLE_VERSION: 'soft-settle-v1';
export const IAN_INK_DRAW_REVEAL_VERSION: 'ink-draw-reveal-v1';
export const IAN_FADE_ONLY_VERSION: 'fade-only-v1';
export const IAN_LAYER_ENTRY_SFX_CUE_VERSION: 'ian-layer-entry-sfx-cue-v2';
export const IAN_LAYER_ENTRY_SAMPLE_RATE: 44100;
export const IAN_LAYER_ENTRY_FPS: 30;
export const IAN_SAMPLES_PER_FRAME: 1470;
export const IAN_LAYERED_ENTRY_EFFECTS_POLICY_SHA256: string;
export const IAN_ENTRY_CLASS_PROFILES: Readonly<Record<string, Readonly<Record<string, string | number>>>>;
export function softSettleOffset(
  localEffectFrame: number,
  effect: {axis: 'x' | 'y'; direction: -1 | 1; max_displacement_px: 10},
): {x: number; y: number};
export function validateIanLayeredEntryEffectsRenderPlan(
  plan: IanLayeredEntryEffectsPlan,
  expected: Record<string, unknown>,
): IanLayeredEntryEffectsPlan;
