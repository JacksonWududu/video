import assert from 'node:assert/strict';
import test from 'node:test';

import {
  IAN_LAYERED_ENTRY_EFFECTS_POLICY_SHA256,
  buildIanLayeredEntryEffectsMapSha256,
  softSettleOffset,
  validateIanLayeredEntryEffectsPlan,
} from './contract.mjs';
import {validateIanLayeredEntryEffectsRenderPlan} from './runtime.mjs';
import {IAN_ENTRY_SOUND_PROFILES} from './runtime.mjs';

const sha = (value) => value.repeat(64);

const effectFor = (elementClass) => {
  if (['closed_outline', 'open_path'].includes(elementClass)) {
    const paths = [{d: 'M 100 100 L 400 100', length: 300, stroke_width: 64}];
    return {
      contract_version: 'ink-draw-reveal-v1',
      reveal_kind: elementClass === 'closed_outline' ? 'contour-draw' : 'path-grow',
      duration_frames: 12,
      easing: 'ease-in-out',
      vector_asset: {asset: 'episode-test/assets/vector/S17-L02.svg', checksum_sha256: sha('a')},
      path_spec: {view_box: [0, 0, 1920, 1080], paths},
      path_spec_sha256: buildIanLayeredEntryEffectsMapSha256(paths),
    };
  }
  return {
    contract_version: 'soft-settle-v1',
    duration_frames: 8,
    opacity_easing: 'linear',
    translation_profile: 'fixed-damped-v1',
    axis: 'x',
    direction: 1,
    max_displacement_px: 10,
    edge_margin_px: 24,
  };
};

const soundFor = (assetId, entryFrame) => {
  const profile = IAN_ENTRY_SOUND_PROFILES[assetId];
  return {
    contract_version: 'ian-layer-entry-sfx-cue-v2',
    role: profile.sound_role,
    selection_reason: '关键语义节点，采用匹配的真实音色',
    source: {
      asset_id: assetId,
      path: profile.sound_path,
      checksum_sha256: sha('1'),
      trim_start_sample: 0,
      trim_end_sample_exclusive: 8820,
    },
    derived_asset: {
      asset: `episode-test/assets/audio/sfx/${assetId}.wav`,
      checksum_sha256: sha('b'),
      sample_rate_hz: 44100,
      channels: 2,
    },
    cue_frame: entryFrame,
    cue_sample: entryFrame * 1470,
    gain_multiplier: profile.gain_multiplier,
  };
};

const makePlan = () => {
  const layers = [
    ['L01', 0, 'paper_card'],
    ['L02', 88, 'open_path'],
    ['L03', 177, 'mechanism'],
  ].map(([layerId, entryFrame, elementClass], index) => ({
    layer_id: layerId,
    entry_frame: entryFrame,
    element_class: elementClass,
    language_family: ['closed_outline', 'open_path'].includes(elementClass)
      ? 'ink-draw-reveal-v1'
      : 'soft-settle-v1',
    effect: effectFor(elementClass),
    sound_effect: index === 1 ? null : soundFor(
      index === 0 ? 'paper-slide-mixkit-1530' : 'typewriter-soft-click-mixkit-1125',
      entryFrame,
    ),
  }));
  const value = {
    contract_version: 'ian-layered-entry-effects-v2',
    shot_id: 'S17',
    scene_plan_sha256: sha('c'),
    package_manifest: {path: 'leverage-video/src/episode-test/schema/S17.json', checksum_sha256: sha('d')},
    fps: 30,
    duration_frames: 355,
    policy_authorization: {
      status: 'policy_authorized',
      policy_sha256: IAN_LAYERED_ENTRY_EFFECTS_POLICY_SHA256,
      user_has_reviewed_specific_map: false,
    },
    sound_effect_library: {
      path: 'leverage-video/src/shared/sound-effects/manifest.json',
      checksum_sha256: sha('e'),
    },
    mix_policy: {
      narration_gain: 1,
      normalize: false,
      peak_ceiling_dbfs: -1,
      narration_mean_loudness_change_max_db: 0.5,
      overflow_action: 'lower-sfx-bus-uniformly',
    },
    language_families: ['soft-settle-v1', 'ink-draw-reveal-v1'],
    layer_count: layers.length,
    layers,
    presented_map_sha256: '',
  };
  value.presented_map_sha256 = buildIanLayeredEntryEffectsMapSha256(value);
  return value;
};

const expected = (value) => ({
  shotId: 'S17',
  scenePlanSha256: sha('c'),
  packageManifest: value.package_manifest,
  durationFrames: 355,
  layerEntries: value.layers.map(({layer_id, entry_frame}) => ({layer_id, entry_frame})),
  libraryManifestSha256: sha('e'),
});

test('entry effects accept selective, varied key-layer SFX', () => {
  const value = makePlan();
  const result = validateIanLayeredEntryEffectsPlan(value, expected(value));
  const renderResult = validateIanLayeredEntryEffectsRenderPlan(value, expected(value));
  assert.equal(result.layers[0].sound_effect.gain_multiplier, 0.17);
  assert.equal(result.layers[1].sound_effect, null);
  assert.equal(result.layers[2].sound_effect.gain_multiplier, 0.31);
  assert.equal(result.presented_map_sha256, value.presented_map_sha256);
  assert.equal(renderResult, value);
});

test('entry effects accept the registered v2 sound-effect library', () => {
  const value = makePlan();
  value.sound_effect_library.path = 'leverage-video/src/shared/sound-effects/manifest-v2.json';
  value.presented_map_sha256 = buildIanLayeredEntryEffectsMapSha256(value);
  assert.doesNotThrow(() => validateIanLayeredEntryEffectsPlan(value, expected(value)));
  assert.doesNotThrow(() => validateIanLayeredEntryEffectsRenderPlan(value, expected(value)));
});

test('entry effects reject an unregistered sound-effect library', () => {
  const value = makePlan();
  value.sound_effect_library.path = 'leverage-video/src/shared/sound-effects/other.json';
  value.presented_map_sha256 = buildIanLayeredEntryEffectsMapSha256(value);
  assert.throws(() => validateIanLayeredEntryEffectsPlan(value, expected(value)), /library checksum/);
  assert.throws(() => validateIanLayeredEntryEffectsRenderPlan(value, expected(value)), /render binding/);
});

test('soft settle is deterministic, bounded, and settles exactly', () => {
  assert.deepEqual(softSettleOffset(0, {axis: 'x', direction: 1, max_displacement_px: 10}), {x: 10, y: 0});
  assert.deepEqual(softSettleOffset(7, {axis: 'x', direction: 1, max_displacement_px: 10}), {x: 0, y: 0});
  assert.deepEqual(softSettleOffset(99, {axis: 'y', direction: -1, max_displacement_px: 10}), {x: 0, y: 0});
});

test('entry effects fail closed on drift, unsafe motion, and missing vectors', () => {
  const gain = makePlan();
  gain.layers[0].sound_effect.gain_multiplier = 0.2;
  assert.throws(() => validateIanLayeredEntryEffectsPlan(gain, expected(gain)), /gain/);

  const unsafe = makePlan();
  unsafe.layers[0].effect.max_displacement_px = 11;
  assert.throws(() => validateIanLayeredEntryEffectsPlan(unsafe, expected(unsafe)), /10/);

  const edge = makePlan();
  edge.layers[0].effect.edge_margin_px = 11;
  assert.throws(() => validateIanLayeredEntryEffectsPlan(edge, expected(edge)), /fade-only/);

  const vector = makePlan();
  vector.layers[1].effect.vector_asset = null;
  assert.throws(() => validateIanLayeredEntryEffectsPlan(vector, expected(vector)), /vector_asset/);

  const sample = makePlan();
  sample.layers[2].sound_effect.cue_sample += 1;
  assert.throws(() => validateIanLayeredEntryEffectsPlan(sample, expected(sample)), /cue_sample/);
  assert.throws(
    () => validateIanLayeredEntryEffectsRenderPlan(sample, expected(sample)),
    /sound cue/,
  );
});

test('fade-only requires an explicit fail-safe reason and does not add a language family', () => {
  const value = makePlan();
  value.layers[0].language_family = 'fade-only-v1';
  value.layers[0].effect = {
    contract_version: 'fade-only-v1',
    duration_frames: 8,
    easing: 'linear',
    fallback_reason: 'edge-margin-below-12',
  };
  value.language_families = ['ink-draw-reveal-v1', 'soft-settle-v1'];
  value.presented_map_sha256 = buildIanLayeredEntryEffectsMapSha256(value);
  assert.doesNotThrow(() => validateIanLayeredEntryEffectsPlan(value, expected(value)));

  value.layers[0].effect.fallback_reason = '';
  assert.throws(() => validateIanLayeredEntryEffectsPlan(value, expected(value)), /fallback_reason/);
});

test('entry effects reject too few cues, adjacent same-timbre cues, and pitch-only variants', () => {
  const tooFew = makePlan();
  tooFew.layers[2].sound_effect = null;
  tooFew.presented_map_sha256 = buildIanLayeredEntryEffectsMapSha256(tooFew);
  assert.throws(() => validateIanLayeredEntryEffectsPlan(tooFew, expected(tooFew)), /2-3/);

  const sameTimbre = makePlan();
  sameTimbre.layers[1].sound_effect = soundFor('page-turn-single-mixkit-1104', 88);
  sameTimbre.presented_map_sha256 = buildIanLayeredEntryEffectsMapSha256(sameTimbre);
  assert.throws(() => validateIanLayeredEntryEffectsPlan(sameTimbre, expected(sameTimbre)), /different timbres/);

  const pitchOnly = makePlan();
  pitchOnly.layers[0].sound_effect.playback_rate = 1.1;
  pitchOnly.presented_map_sha256 = buildIanLayeredEntryEffectsMapSha256(pitchOnly);
  assert.throws(() => validateIanLayeredEntryEffectsPlan(pitchOnly, expected(pitchOnly)), /exact keys/);
});
