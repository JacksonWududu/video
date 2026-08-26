import {SHARED_SOUND_EFFECT_LIBRARY_PATHS} from '../sound-effects/paths.mjs';

export const IAN_LAYERED_ENTRY_EFFECTS_VERSION = 'ian-layered-entry-effects-v2';
export const IAN_LAYERED_ENTRY_RENDERER_VERSION = 'ian-layered-entry-effects-renderer-v2';
export const IAN_LAYER_ENTRY_LANGUAGE_POLICY_VERSION = 'ian-layer-entry-language-policy-v2';
export const IAN_SOFT_SETTLE_VERSION = 'soft-settle-v1';
export const IAN_INK_DRAW_REVEAL_VERSION = 'ink-draw-reveal-v1';
export const IAN_FADE_ONLY_VERSION = 'fade-only-v1';
export const IAN_LAYER_ENTRY_SFX_CUE_VERSION = 'ian-layer-entry-sfx-cue-v2';
export const IAN_LAYER_ENTRY_SAMPLE_RATE = 44100;
export const IAN_LAYER_ENTRY_FPS = 30;
export const IAN_SAMPLES_PER_FRAME = IAN_LAYER_ENTRY_SAMPLE_RATE / IAN_LAYER_ENTRY_FPS;
export const IAN_LAYERED_ENTRY_EFFECTS_POLICY_SHA256 = 'b4cbd8726b8caed4ca7981fd627b7cafeb49d93d296397f61bcd026e52f50e30';

export const IAN_ENTRY_CLASS_PROFILES = Object.freeze({
  paper_card: Object.freeze({language_family: IAN_SOFT_SETTLE_VERSION}),
  solid_node: Object.freeze({language_family: IAN_SOFT_SETTLE_VERSION}),
  mechanism: Object.freeze({language_family: IAN_SOFT_SETTLE_VERSION}),
  closed_outline: Object.freeze({language_family: IAN_INK_DRAW_REVEAL_VERSION}),
  open_path: Object.freeze({language_family: IAN_INK_DRAW_REVEAL_VERSION}),
  broad_region: Object.freeze({language_family: IAN_SOFT_SETTLE_VERSION}),
});

const soundProfile = (soundRole, assetId, extension, timbreFamily, gainMultiplier) => Object.freeze({
  sound_role: soundRole,
  sound_asset_id: assetId,
  sound_path: `leverage-video/src/shared/sound-effects/assets/${assetId}.${extension}`,
  timbre_family: timbreFamily,
  gain_multiplier: gainMultiplier,
});

export const IAN_ENTRY_SOUND_PROFILES = Object.freeze({
  'paper-slide-mixkit-1530': soundProfile('paper_slide', 'paper-slide-mixkit-1530', 'wav', 'paper', 0.17),
  'writing-pencil-mixkit-3194': soundProfile('writing_pencil', 'writing-pencil-mixkit-3194', 'wav', 'writing', 0.17),
  'typewriter-soft-click-mixkit-1125': soundProfile('typewriter_click', 'typewriter-soft-click-mixkit-1125', 'wav', 'click', 0.31),
  'short-transition-sweep-mixkit-175': soundProfile('short_sweep', 'short-transition-sweep-mixkit-175', 'wav', 'whoosh', 0.22),
  'air-woosh-mixkit-1489': soundProfile('air_woosh', 'air-woosh-mixkit-1489', 'wav', 'whoosh', 0.19),
  'arrow-whoosh-mixkit-1491': soundProfile('arrow_whoosh', 'arrow-whoosh-mixkit-1491', 'wav', 'whoosh', 0.18),
  'explainer-pop-whoosh-mixkit-3005': soundProfile('explainer_pop', 'explainer-pop-whoosh-mixkit-3005', 'wav', 'pop', 0.2),
  'message-pop-alert-mixkit-2354': soundProfile('message_pop', 'message-pop-alert-mixkit-2354', 'mp3', 'pop', 0.23),
  'relaxing-bell-chime-mixkit-3109': soundProfile('insight_chime', 'relaxing-bell-chime-mixkit-3109', 'wav', 'tone', 0.35),
  'page-turn-single-mixkit-1104': soundProfile('page_turn', 'page-turn-single-mixkit-1104', 'wav', 'paper', 0.23),
  'mechanical-tool-click-mixkit-1131': soundProfile('mechanical_click', 'mechanical-tool-click-mixkit-1131', 'wav', 'click', 0.19),
  'writing-scribble-mixkit-2369': soundProfile('writing_scribble', 'writing-scribble-mixkit-2369', 'wav', 'writing', 0.35),
  'fast-small-sweep-transition-mixkit-166': soundProfile('fast_sweep', 'fast-small-sweep-transition-mixkit-166', 'wav', 'whoosh', 0.16),
  'technology-transition-slide-mixkit-3120': soundProfile('technology_slide', 'technology-transition-slide-mixkit-3120', 'wav', 'whoosh', 0.34),
  'select-click-mixkit-1109': soundProfile('select_click', 'select-click-mixkit-1109', 'wav', 'click', 0.25),
  'click-error-mixkit-1110': soundProfile('error_click', 'click-error-mixkit-1110', 'wav', 'click', 0.25),
  'success-software-tone-mixkit-2865': soundProfile('success_tone', 'success-software-tone-mixkit-2865', 'wav', 'tone', 0.17),
  'confirmation-tone-mixkit-2867': soundProfile('confirmation_tone', 'confirmation-tone-mixkit-2867', 'wav', 'tone', 0.17),
  'pen-marker-line-mixkit-2998': soundProfile('marker_line', 'pen-marker-line-mixkit-2998', 'wav', 'writing', 0.25),
  'paper-quick-movement-mixkit-2380': soundProfile('paper_quick', 'paper-quick-movement-mixkit-2380', 'wav', 'paper', 0.2),
  'chalk-line-sound-mixkit-2372': soundProfile('chalk_line', 'chalk-line-sound-mixkit-2372', 'wav', 'writing', 0.16),
  'quick-zoom-impact-mixkit-772': soundProfile('quick_zoom_impact', 'quick-zoom-impact-mixkit-772', 'wav', 'impact', 0.18),
});

const SHA256 = /^[a-f0-9]{64}$/;
const SOFT_SETTLE_COEFFICIENTS = Object.freeze([1, -0.55, 0.3, -0.15, 0.07, -0.03, 0.01, 0]);

const fail = (message) => {
  throw new Error(message);
};

const rootRelative = (value) => typeof value === 'string'
  && value.length > 0
  && !value.startsWith('/')
  && !/^[A-Za-z]:[\\/]/.test(value)
  && !value.replaceAll('\\', '/').split('/').includes('..');

export const softSettleOffset = (localEffectFrame, effect) => {
  const frame = Math.max(0, Math.min(7, Number.isFinite(localEffectFrame) ? localEffectFrame : 7));
  const coefficient = SOFT_SETTLE_COEFFICIENTS[Math.floor(frame)];
  const value = Number((effect.max_displacement_px * effect.direction * coefficient).toFixed(4));
  return effect.axis === 'x' ? {x: value, y: 0} : {x: 0, y: value};
};

const validateEffect = (layer, label) => {
  const {effect, element_class: elementClass, language_family: languageFamily} = layer;
  const profile = IAN_ENTRY_CLASS_PROFILES[elementClass];
  if (!profile || !effect || typeof effect !== 'object') fail(`${label} effect is invalid`);
  if (effect.contract_version === IAN_SOFT_SETTLE_VERSION) {
    if (profile.language_family !== IAN_SOFT_SETTLE_VERSION
      || languageFamily !== IAN_SOFT_SETTLE_VERSION
      || effect.duration_frames !== 8
      || effect.opacity_easing !== 'linear'
      || effect.translation_profile !== 'fixed-damped-v1'
      || !['x', 'y'].includes(effect.axis)
      || ![-1, 1].includes(effect.direction)
      || effect.max_displacement_px !== 10
      || !Number.isFinite(effect.edge_margin_px)
      || effect.edge_margin_px < 12) {
      fail(`${label} soft-settle effect is stale or unsafe`);
    }
    return;
  }
  if (effect.contract_version === IAN_INK_DRAW_REVEAL_VERSION) {
    if (profile.language_family !== IAN_INK_DRAW_REVEAL_VERSION
      || languageFamily !== IAN_INK_DRAW_REVEAL_VERSION
      || effect.duration_frames !== 12
      || effect.easing !== 'ease-in-out'
      || !rootRelative(effect.vector_asset?.asset)
      || !SHA256.test(effect.vector_asset?.checksum_sha256 ?? '')
      || JSON.stringify(effect.path_spec?.view_box) !== JSON.stringify([0, 0, 1920, 1080])
      || !Array.isArray(effect.path_spec?.paths)
      || effect.path_spec.paths.length < 1
      || effect.path_spec.paths.some((item) => typeof item?.d !== 'string'
        || !Number.isFinite(item?.length) || item.length <= 0
        || !Number.isFinite(item?.stroke_width) || item.stroke_width <= 0)
      || !SHA256.test(effect.path_spec_sha256 ?? '')) {
      fail(`${label} ink-draw effect is stale or unsafe`);
    }
    return;
  }
  if (effect.contract_version === IAN_FADE_ONLY_VERSION) {
    if (languageFamily !== IAN_FADE_ONLY_VERSION
      || effect.duration_frames !== 8
      || effect.easing !== 'linear'
      || typeof effect.fallback_reason !== 'string'
      || effect.fallback_reason.length < 1) {
      fail(`${label} fade-only effect is invalid`);
    }
    return;
  }
  fail(`${label} effect contract is unsupported`);
};

const validateSound = (layer, label) => {
  const cue = layer.sound_effect;
  if (cue === null) return null;
  const profile = IAN_ENTRY_SOUND_PROFILES[cue?.source?.asset_id];
  if (!cue || !profile || cue.contract_version !== IAN_LAYER_ENTRY_SFX_CUE_VERSION
    || cue.role !== profile.sound_role
    || cue.source?.asset_id !== profile.sound_asset_id
    || cue.source?.path !== profile.sound_path
    || typeof cue.selection_reason !== 'string'
    || cue.selection_reason.trim().length < 4
    || !SHA256.test(cue.source?.checksum_sha256 ?? '')
    || !Number.isInteger(cue.source?.trim_start_sample)
    || !Number.isInteger(cue.source?.trim_end_sample_exclusive)
    || cue.source.trim_end_sample_exclusive <= cue.source.trim_start_sample
    || !rootRelative(cue.derived_asset?.asset)
    || !cue.derived_asset.asset.toLowerCase().endsWith('.wav')
    || !SHA256.test(cue.derived_asset?.checksum_sha256 ?? '')
    || cue.derived_asset.sample_rate_hz !== IAN_LAYER_ENTRY_SAMPLE_RATE
    || cue.derived_asset.channels !== 2
    || cue.cue_frame !== layer.entry_frame
    || cue.cue_sample !== layer.entry_frame * IAN_SAMPLES_PER_FRAME
    || cue.gain_multiplier !== profile.gain_multiplier) {
    fail(`${label} sound cue is stale or unsafe`);
  }
  return profile;
};

export const validateIanLayeredEntryEffectsRenderPlan = (plan, {
  shotId,
  scenePlanSha256,
  packageManifest,
  durationFrames,
  layerEntries,
  libraryManifestSha256,
} = {}) => {
  if (!plan || plan.contract_version !== IAN_LAYERED_ENTRY_EFFECTS_VERSION
    || plan.shot_id !== shotId
    || plan.scene_plan_sha256 !== scenePlanSha256
    || !SHA256.test(plan.scene_plan_sha256 ?? '')
    || plan.fps !== IAN_LAYER_ENTRY_FPS
    || plan.duration_frames !== durationFrames
    || JSON.stringify(plan.package_manifest) !== JSON.stringify(packageManifest)
    || plan.policy_authorization?.status !== 'policy_authorized'
    || plan.policy_authorization?.policy_sha256 !== IAN_LAYERED_ENTRY_EFFECTS_POLICY_SHA256
    || plan.policy_authorization?.user_has_reviewed_specific_map !== false
    || !SHARED_SOUND_EFFECT_LIBRARY_PATHS.includes(plan.sound_effect_library?.path)
    || plan.sound_effect_library?.checksum_sha256 !== libraryManifestSha256
    || plan.mix_policy?.narration_gain !== 1
    || plan.mix_policy?.normalize !== false
    || plan.mix_policy?.peak_ceiling_dbfs !== -1
    || plan.mix_policy?.narration_mean_loudness_change_max_db !== 0.5
    || plan.mix_policy?.overflow_action !== 'lower-sfx-bus-uniformly'
    || !Array.isArray(plan.layers)
    || !Array.isArray(layerEntries)
    || plan.layer_count !== plan.layers.length
    || plan.layers.length !== layerEntries.length
    || !SHA256.test(plan.presented_map_sha256 ?? '')) {
    fail('Ian layered entry-effects render binding is stale');
  }
  const audible = [];
  plan.layers.forEach((layer, index) => {
    const expected = layerEntries[index];
    const label = `Ian render entry layers[${index}]`;
    if (layer.layer_id !== expected?.layer_id || layer.entry_frame !== expected?.entry_frame) {
      fail(`${label} identity or timing is stale`);
    }
    validateEffect(layer, label);
    const soundProfileValue = validateSound(layer, label);
    if (soundProfileValue) audible.push({
      asset_id: layer.sound_effect.source.asset_id,
      timbre_family: soundProfileValue.timbre_family,
    });
  });
  const minimumCueCount = plan.layers.length === 1 ? 1 : Math.min(2, plan.layers.length);
  const maximumCueCount = Math.min(3, plan.layers.length);
  if (audible.length < minimumCueCount || audible.length > maximumCueCount) {
    fail('Ian render entry sound design must use only 2-3 key-layer cues');
  }
  const assetCounts = new Map();
  audible.forEach((item, index) => {
    assetCounts.set(item.asset_id, (assetCounts.get(item.asset_id) ?? 0) + 1);
    if (index > 0 && audible[index - 1].timbre_family === item.timbre_family) {
      fail('Ian render adjacent audible cues must use different timbres');
    }
  });
  if ([...assetCounts.values()].some((count) => count > 2)) {
    fail('Ian render sound design repeats one asset more than twice in a shot');
  }
  const families = [...new Set(plan.layers
    .map((layer) => layer.language_family)
    .filter((family) => family !== IAN_FADE_ONLY_VERSION))];
  if (families.length > 2 || JSON.stringify(families) !== JSON.stringify(plan.language_families)) {
    fail('Ian render entry language families are stale');
  }
  return plan;
};
