import crypto from 'node:crypto';
import path from 'node:path';

import {SHARED_SOUND_EFFECT_LIBRARY_PATHS} from '../sound-effects/paths.mjs';

import {
  IAN_ENTRY_CLASS_PROFILES,
  IAN_ENTRY_SOUND_PROFILES,
  IAN_FADE_ONLY_VERSION,
  IAN_INK_DRAW_REVEAL_VERSION,
  IAN_LAYERED_ENTRY_EFFECTS_POLICY_SHA256,
  IAN_LAYERED_ENTRY_EFFECTS_VERSION,
  IAN_LAYERED_ENTRY_RENDERER_VERSION,
  IAN_LAYER_ENTRY_FPS,
  IAN_LAYER_ENTRY_LANGUAGE_POLICY_VERSION,
  IAN_LAYER_ENTRY_SAMPLE_RATE,
  IAN_LAYER_ENTRY_SFX_CUE_VERSION,
  IAN_SAMPLES_PER_FRAME,
  IAN_SOFT_SETTLE_VERSION,
} from './runtime.mjs';

export {
  IAN_FADE_ONLY_VERSION,
  IAN_INK_DRAW_REVEAL_VERSION,
  IAN_LAYERED_ENTRY_EFFECTS_POLICY_SHA256,
  IAN_LAYERED_ENTRY_EFFECTS_VERSION,
  IAN_LAYERED_ENTRY_RENDERER_VERSION,
  IAN_LAYER_ENTRY_FPS,
  IAN_LAYER_ENTRY_LANGUAGE_POLICY_VERSION,
  IAN_LAYER_ENTRY_SAMPLE_RATE,
  IAN_LAYER_ENTRY_SFX_CUE_VERSION,
  IAN_SAMPLES_PER_FRAME,
  IAN_SOFT_SETTLE_VERSION,
  softSettleOffset,
} from './runtime.mjs';

const SHA256 = /^[a-f0-9]{64}$/;
const SVG_PATH = /^[Mm][0-9eE+.,\-\sA-Za-z]+$/;
const CLASS_PROFILES = IAN_ENTRY_CLASS_PROFILES;

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
};

const canonicalJson = (value) => JSON.stringify(stableValue(value));
const sha256Canonical = (value) => crypto
  .createHash('sha256')
  .update(Buffer.from(canonicalJson(value)))
  .digest('hex');

const policy = Object.freeze({
  contract_version: IAN_LAYER_ENTRY_LANGUAGE_POLICY_VERSION,
  max_language_families_per_shot: 2,
  audible_cues_per_shot: Object.freeze({minimum: 2, maximum: 3, single_layer: 1}),
  max_same_asset_uses_per_shot: 2,
  adjacent_audible_timbre: 'different',
  unselected_layers_are_silent: true,
  semantic_selection_reason: 'required',
  pitch_or_speed_only_variation: 'forbidden',
  text_moves_with_owning_layer: true,
  randomness: 'forbidden',
  incoming_transition_owner: 'scene-transition-v3',
  timing_change: 'forbidden',
  scale: 'forbidden',
  rotation: 'forbidden',
  soft_settle_max_displacement_px: 10,
  soft_settle_edge_margin_px: 12,
  contour_and_path_share_language_family: IAN_INK_DRAW_REVEAL_VERSION,
  class_profiles: CLASS_PROFILES,
  sound_profiles: IAN_ENTRY_SOUND_PROFILES,
});

if (sha256Canonical(policy) !== IAN_LAYERED_ENTRY_EFFECTS_POLICY_SHA256) {
  throw new Error('Ian layered entry-effects runtime policy checksum is stale');
}

const fail = (message) => {
  throw new Error(message);
};

const assertObject = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
};

const assertExactKeys = (value, keys, label) => {
  assertObject(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} must contain exact keys: ${expected.join(', ')}`);
  }
};

const assertString = (value, label) => {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} must be non-empty`);
  return value;
};

const assertInteger = (value, label, minimum = 0) => {
  if (!Number.isInteger(value) || value < minimum) fail(`${label} must be an integer >= ${minimum}`);
  return value;
};

const assertSha256 = (value, label) => {
  if (typeof value !== 'string' || !SHA256.test(value)) fail(`${label} must be a SHA-256`);
  return value;
};

const assertRootRelative = (value, label) => {
  assertString(value, label);
  if (path.isAbsolute(value) || value.replaceAll('\\', '/').split('/').includes('..')) {
    fail(`${label} must be root-relative`);
  }
  return value.replaceAll('\\', '/');
};

export const buildIanLayeredEntryEffectsMapSha256 = (value) => {
  if (value && typeof value === 'object' && !Array.isArray(value)
      && Object.hasOwn(value, 'presented_map_sha256')) {
    const {presented_map_sha256: ignored, ...payload} = value;
    return sha256Canonical(payload);
  }
  return sha256Canonical(value);
};

const validatePackageBinding = (value, label) => {
  assertExactKeys(value, ['path', 'checksum_sha256'], label);
  return {
    path: assertRootRelative(value.path, `${label}.path`),
    checksum_sha256: assertSha256(value.checksum_sha256, `${label}.checksum_sha256`),
  };
};

const validatePublicAssetBinding = (value, label, extension) => {
  assertExactKeys(value, ['asset', 'checksum_sha256'], label);
  const asset = assertRootRelative(value.asset, `${label}.asset`);
  if (path.extname(asset).toLowerCase() !== extension) {
    fail(`${label} must use ${extension}`);
  }
  return {
    asset,
    checksum_sha256: assertSha256(value.checksum_sha256, `${label}.checksum_sha256`),
  };
};

const validateEffect = (effect, label, elementClass, languageFamily) => {
  assertObject(effect, label);
  if (effect.contract_version === IAN_SOFT_SETTLE_VERSION) {
    assertExactKeys(effect, [
      'contract_version', 'duration_frames', 'opacity_easing', 'translation_profile',
      'axis', 'direction', 'max_displacement_px', 'edge_margin_px',
    ], label);
    if (languageFamily !== IAN_SOFT_SETTLE_VERSION
        || CLASS_PROFILES[elementClass].language_family !== IAN_SOFT_SETTLE_VERSION
        || effect.duration_frames !== 8 || effect.opacity_easing !== 'linear'
        || effect.translation_profile !== 'fixed-damped-v1'
        || !['x', 'y'].includes(effect.axis) || ![-1, 1].includes(effect.direction)
        || effect.max_displacement_px !== 10) {
      fail(`${label} must use deterministic translation-only soft settle with maximum 10 px`);
    }
    if (!Number.isFinite(effect.edge_margin_px) || effect.edge_margin_px < 12) {
      fail(`${label} must use fade-only when edge margin is below 12 px`);
    }
    return structuredClone(effect);
  }
  if (effect.contract_version === IAN_INK_DRAW_REVEAL_VERSION) {
    assertExactKeys(effect, [
      'contract_version', 'reveal_kind', 'duration_frames', 'easing',
      'vector_asset', 'path_spec', 'path_spec_sha256',
    ], label);
    if (languageFamily !== IAN_INK_DRAW_REVEAL_VERSION
        || CLASS_PROFILES[elementClass].language_family !== IAN_INK_DRAW_REVEAL_VERSION
        || effect.duration_frames !== 12 || effect.easing !== 'ease-in-out'
        || !['contour-draw', 'path-grow'].includes(effect.reveal_kind)
        || (elementClass === 'closed_outline' && effect.reveal_kind !== 'contour-draw')
        || (elementClass === 'open_path' && effect.reveal_kind !== 'path-grow')) {
      fail(`${label} has an invalid contour/path reveal profile`);
    }
    const vector = validatePublicAssetBinding(effect.vector_asset, `${label}.vector_asset`, '.svg');
    assertExactKeys(effect.path_spec, ['view_box', 'paths'], `${label}.path_spec`);
    if (JSON.stringify(effect.path_spec.view_box) !== JSON.stringify([0, 0, 1920, 1080])
        || !Array.isArray(effect.path_spec.paths) || effect.path_spec.paths.length < 1) {
      fail(`${label}.path_spec must use the full 1920x1080 view box and at least one path`);
    }
    const paths = effect.path_spec.paths.map((item, index) => {
      assertExactKeys(item, ['d', 'length', 'stroke_width'], `${label}.path_spec.paths[${index}]`);
      if (typeof item.d !== 'string' || item.d.length < 4 || item.d.length > 20000
          || !SVG_PATH.test(item.d) || /(?:url|script|href|<|>)/i.test(item.d)
          || !Number.isFinite(item.length) || item.length <= 0
          || !Number.isFinite(item.stroke_width) || item.stroke_width <= 0 || item.stroke_width > 1920) {
        fail(`${label}.path_spec.paths[${index}] is invalid`);
      }
      return structuredClone(item);
    });
    if (effect.path_spec_sha256 !== buildIanLayeredEntryEffectsMapSha256(paths)) {
      fail(`${label}.path_spec_sha256 is stale`);
    }
    return {...structuredClone(effect), vector_asset: vector, path_spec: {...effect.path_spec, paths}};
  }
  if (effect.contract_version === IAN_FADE_ONLY_VERSION) {
    assertExactKeys(effect, [
      'contract_version', 'duration_frames', 'easing', 'fallback_reason',
    ], label);
    if (languageFamily !== IAN_FADE_ONLY_VERSION || effect.duration_frames !== 8
        || effect.easing !== 'linear' || typeof effect.fallback_reason !== 'string'
        || effect.fallback_reason.length === 0) {
      fail(`${label}.fallback_reason is required for fade-only`);
    }
    return structuredClone(effect);
  }
  fail(`${label} uses an unsupported entry effect`);
};

const validateSoundEffect = (cue, label, elementClass, entryFrame) => {
  if (cue === null) return null;
  assertExactKeys(cue, [
    'contract_version', 'role', 'selection_reason', 'source', 'derived_asset',
    'cue_frame', 'cue_sample', 'gain_multiplier',
  ], label);
  const profile = IAN_ENTRY_SOUND_PROFILES[cue.source?.asset_id];
  if (cue.contract_version !== IAN_LAYER_ENTRY_SFX_CUE_VERSION
      || !profile
      || cue.role !== profile.sound_role || cue.cue_frame !== entryFrame
      || cue.cue_sample !== entryFrame * IAN_SAMPLES_PER_FRAME
      || cue.gain_multiplier !== profile.gain_multiplier) {
    fail(`${label} role, cue_sample, or gain differs from the approved sound profile`);
  }
  if (typeof cue.selection_reason !== 'string' || cue.selection_reason.trim().length < 4) {
    fail(`${label}.selection_reason must explain why this key layer is audible`);
  }
  assertExactKeys(cue.source, [
    'asset_id', 'path', 'checksum_sha256', 'trim_start_sample', 'trim_end_sample_exclusive',
  ], `${label}.source`);
  if (cue.source.asset_id !== profile.sound_asset_id || cue.source.path !== profile.sound_path
      || !Number.isInteger(cue.source.trim_start_sample) || cue.source.trim_start_sample < 0
      || !Number.isInteger(cue.source.trim_end_sample_exclusive)
      || cue.source.trim_end_sample_exclusive <= cue.source.trim_start_sample) {
    fail(`${label}.source differs from the approved sound profile`);
  }
  assertSha256(cue.source.checksum_sha256, `${label}.source.checksum_sha256`);
  assertExactKeys(cue.derived_asset, [
    'asset', 'checksum_sha256', 'sample_rate_hz', 'channels',
  ], `${label}.derived_asset`);
  if (cue.derived_asset.sample_rate_hz !== IAN_LAYER_ENTRY_SAMPLE_RATE
      || cue.derived_asset.channels !== 2
      || path.extname(cue.derived_asset.asset).toLowerCase() !== '.wav') {
    fail(`${label}.derived_asset must be a stereo 44.1 kHz WAV`);
  }
  assertRootRelative(cue.derived_asset.asset, `${label}.derived_asset.asset`);
  assertSha256(cue.derived_asset.checksum_sha256, `${label}.derived_asset.checksum_sha256`);
  return {cue: structuredClone(cue), profile};
};

export const validateIanLayeredEntryEffectsPlan = (plan, {
  shotId,
  scenePlanSha256,
  packageManifest,
  durationFrames,
  layerEntries,
  libraryManifestSha256,
  libraryAssets = null,
  layerEdgeMargins = null,
} = {}) => {
  assertExactKeys(plan, [
    'contract_version', 'shot_id', 'scene_plan_sha256', 'package_manifest',
    'fps', 'duration_frames', 'policy_authorization', 'sound_effect_library',
    'mix_policy', 'language_families', 'layer_count', 'layers', 'presented_map_sha256',
  ], 'Ian layered entry-effects plan');
  if (plan.contract_version !== IAN_LAYERED_ENTRY_EFFECTS_VERSION
      || plan.shot_id !== shotId || plan.scene_plan_sha256 !== scenePlanSha256
      || plan.fps !== IAN_LAYER_ENTRY_FPS || plan.duration_frames !== durationFrames) {
    fail('Ian layered entry-effects plan binding is stale');
  }
  assertSha256(plan.scene_plan_sha256, 'Ian entry scene_plan_sha256');
  const manifest = validatePackageBinding(plan.package_manifest, 'Ian entry package_manifest');
  if (JSON.stringify(manifest) !== JSON.stringify(packageManifest)) {
    fail('Ian entry package_manifest differs from the active layered package');
  }
  assertExactKeys(plan.policy_authorization, [
    'status', 'policy_sha256', 'user_has_reviewed_specific_map',
  ], 'Ian entry policy_authorization');
  if (plan.policy_authorization.status !== 'policy_authorized'
      || plan.policy_authorization.policy_sha256 !== IAN_LAYERED_ENTRY_EFFECTS_POLICY_SHA256
      || plan.policy_authorization.user_has_reviewed_specific_map !== false) {
    fail('Ian entry policy authorization is missing or stale');
  }
  const library = validatePackageBinding(plan.sound_effect_library, 'Ian sound_effect_library');
  if (!SHARED_SOUND_EFFECT_LIBRARY_PATHS.includes(library.path)
      || library.checksum_sha256 !== libraryManifestSha256) {
    fail('Ian sound-effect library checksum is stale');
  }
  assertExactKeys(plan.mix_policy, [
    'narration_gain', 'normalize', 'peak_ceiling_dbfs',
    'narration_mean_loudness_change_max_db', 'overflow_action',
  ], 'Ian entry mix_policy');
  if (plan.mix_policy.narration_gain !== 1 || plan.mix_policy.normalize !== false
      || plan.mix_policy.peak_ceiling_dbfs !== -1
      || plan.mix_policy.narration_mean_loudness_change_max_db !== 0.5
      || plan.mix_policy.overflow_action !== 'lower-sfx-bus-uniformly') {
    fail('Ian entry mix policy may never normalize or lower narration');
  }
  if (!Array.isArray(plan.layers) || !Array.isArray(layerEntries)
      || plan.layers.length !== layerEntries.length || plan.layer_count !== plan.layers.length) {
    fail('Ian entry layer count differs from the active scene plan');
  }
  const layers = plan.layers.map((layer, index) => {
    const label = `Ian entry layers[${index}]`;
    assertExactKeys(layer, [
      'layer_id', 'entry_frame', 'element_class', 'language_family', 'effect', 'sound_effect',
    ], label);
    const expectedLayer = layerEntries[index];
    if (layer.layer_id !== expectedLayer?.layer_id || layer.entry_frame !== expectedLayer?.entry_frame
        || !Object.hasOwn(CLASS_PROFILES, layer.element_class)
        || ![IAN_SOFT_SETTLE_VERSION, IAN_INK_DRAW_REVEAL_VERSION, IAN_FADE_ONLY_VERSION]
          .includes(layer.language_family)) {
      fail(`${label} identity, timing, or element class is invalid`);
    }
    if (layer.effect.contract_version === IAN_SOFT_SETTLE_VERSION
        && Array.isArray(layerEdgeMargins)
        && layer.effect.edge_margin_px !== layerEdgeMargins[index]) {
      fail(`${label}.effect.edge_margin_px differs from the package raster bounds`);
    }
    if (Array.isArray(libraryAssets) && layer.sound_effect !== null) {
      const source = libraryAssets.find(({asset_id: assetId}) => assetId === layer.sound_effect?.source?.asset_id);
      if (!source || source.path !== layer.sound_effect.source.path
          || source.checksum_sha256 !== layer.sound_effect.source.checksum_sha256) {
        fail(`${label}.sound_effect.source differs from the checksum-current shared library`);
      }
    }
    const sound = validateSoundEffect(
      layer.sound_effect,
      `${label}.sound_effect`,
      layer.element_class,
      layer.entry_frame,
    );
    return {
      layer_id: layer.layer_id,
      entry_frame: layer.entry_frame,
      element_class: layer.element_class,
      language_family: layer.language_family,
      effect: validateEffect(layer.effect, `${label}.effect`, layer.element_class, layer.language_family),
      sound_effect: sound?.cue ?? null,
      sound_profile: sound?.profile ?? null,
    };
  });
  const audible = layers.filter(({sound_effect: cue}) => cue !== null);
  const minimumCueCount = layers.length === 1 ? 1 : Math.min(2, layers.length);
  const maximumCueCount = Math.min(3, layers.length);
  if (audible.length < minimumCueCount || audible.length > maximumCueCount) {
    fail('Ian entry sound design must use only 2-3 key-layer cues');
  }
  const assetCounts = new Map();
  audible.forEach((layer, index) => {
    const assetId = layer.sound_effect.source.asset_id;
    assetCounts.set(assetId, (assetCounts.get(assetId) ?? 0) + 1);
    if (index > 0 && audible[index - 1].sound_profile.timbre_family
        === layer.sound_profile.timbre_family) {
      fail('Ian adjacent audible cues must use different timbres');
    }
  });
  if ([...assetCounts.values()].some((count) => count > 2)) {
    fail('Ian sound design repeats one asset more than twice in a shot');
  }
  const usedFamilies = [...new Set(layers
    .map(({language_family: family}) => family)
    .filter((family) => family !== IAN_FADE_ONLY_VERSION))];
  if (usedFamilies.length > 2 || JSON.stringify(plan.language_families) !== JSON.stringify(usedFamilies)) {
    fail('Ian shots may use at most two ordered entry language families');
  }
  if (!SHA256.test(plan.presented_map_sha256)
      || plan.presented_map_sha256 !== buildIanLayeredEntryEffectsMapSha256(plan)) {
    fail('Ian entry presented_map_sha256 is stale');
  }
  return {
    ...structuredClone(plan),
    package_manifest: manifest,
    sound_effect_library: library,
    layers: layers.map(({sound_profile: ignored, ...layer}) => layer),
  };
};
