#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  validateCaptionVariantSoundIdentity,
  validateSoundDesignPlan,
} from './validate-sound-design.mjs';

const binding = (character) => ({
  path: `leverage-video/src/example/schema/${character}.json`,
  checksum_sha256: character.repeat(64).slice(0, 64),
});
const source = `
import {KnowledgeVideo} from '../../../shared/video-scenes';
export const Video = () => <KnowledgeVideo plan={plan} />;
`;
const cue = {
  event_id: 'S01:semantic:reveal', shot_id: 'S01', cue_frame: 30,
  semantic_role: 'fact_pop_in', intensity: 'micro',
  render_owner: 'global_sound_effect_track_v1', gain_multiplier: 0.2,
  source: {asset_id: 'source', path: 'source.wav', checksum_sha256: 'a'.repeat(64)},
  derived_asset: {
    asset: 'example/assets/audio/sfx/reveal.wav', checksum_sha256: 'b'.repeat(64),
    sample_rate_hz: 44100, channels: 2, format: 'wav',
    source_sample_rate_hz: 44100,
    trim_start_sample: 0, trim_end_sample: 4410, duration_in_frames: 3,
    runtime_transform: 'forbidden',
  },
};
const soundDesign = binding('d');
const library = binding('e');
const goodPlan = {
  schema_version: 'knowledge-video-assembly-plan-v3',
  full_master_frames: 120,
  narration_frames: 120,
  narration_asset: 'example/assets/audio/narration.mp3',
  bgm: {mode: 'disabled', source: null, track: null},
  sound_effects: {
    contract_version: 'knowledge-video-sound-effect-track-v1',
    design: {...soundDesign, event_map_sha256: 'f'.repeat(64)},
    library,
    narration_gain: 1,
    normalization: 'disabled',
    peak_ceiling_dbfs: -1,
    overflow_action: 'lower-sfx-bus-uniformly',
    bus_gain_multiplier: 0.8,
    cues: [cue],
  },
  scenes: [{
    shot_id: 'S01', start_frame: 0, end_frame: 120, duration_frames: 120,
    ian_layered_scene: null,
  }],
  qa_contract: {
    sound_design: {
      contract_version: 'knowledge-video-sound-design-validation-v1',
      result: 'pass',
      ...soundDesign,
      event_map_sha256: 'f'.repeat(64),
      bindings: {sound_effect_library: library},
    },
  },
};

assert.deepEqual(validateSoundDesignPlan({plan: goodPlan, source}), {
  contract_version: 'knowledge-video-sound-effect-track-v1',
  result: 'pass',
  cue_count: 1,
  global_cue_count: 1,
  ian_cue_count: 0,
  bus_gain_multiplier: 0.8,
  narration_gain: 1,
  bgm: 'disabled',
});

const missing = structuredClone(goodPlan);
delete missing.sound_effects;
assert.throws(
  () => validateSoundDesignPlan({plan: missing, source}),
  /missing or stale sound-design/i,
);

const duplicate = structuredClone(goodPlan);
duplicate.sound_effects.cues.push(structuredClone(cue));
assert.throws(
  () => validateSoundDesignPlan({plan: duplicate, source}),
  /duplicate sound-effect cue/i,
);

const duplicateRender = structuredClone(goodPlan);
duplicateRender.sound_effects.cues.push({
  ...structuredClone(cue),
  event_id: 'S01:semantic:duplicate-render',
});
assert.throws(
  () => validateSoundDesignPlan({plan: duplicateRender, source}),
  /duplicate rendered sound-effect cue/i,
);

const ian = structuredClone(goodPlan);
ian.sound_effects.cues[0].render_owner = 'ian_layered_scene';
assert.throws(
  () => validateSoundDesignPlan({plan: ian, source}),
  /owned exactly once/i,
);

const captioned = structuredClone(goodPlan);
captioned.captions = {mode: 'burned-in-v1', cues: []};
assert.equal(validateCaptionVariantSoundIdentity(goodPlan, captioned).result, 'pass');
captioned.sound_effects.bus_gain_multiplier = 0.7;
assert.throws(
  () => validateCaptionVariantSoundIdentity(goodPlan, captioned),
  /byte-identical sound-effect/i,
);

assert.deepEqual(validateSoundDesignPlan({
  plan: {schema_version: 'knowledge-video-assembly-plan-v2', scenes: []},
  source,
}), {
  contract_version: 'knowledge-video-sound-effect-track-legacy-v2',
  result: 'pass',
  cue_count: 0,
});

process.stdout.write('sound-design validator tests passed\n');
