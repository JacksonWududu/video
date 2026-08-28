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
  sync_frame: 30, cue_group_id: 'cue:S01:semantic:reveal',
  primary_render_event_id: 'S01:semantic:reveal',
  covered_event_ids: ['S01:semantic:reveal'],
  semantic_role: 'fact_pop_in', intensity: 'standard',
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
const policy = binding('a');
const goodPlan = {
  schema_version: 'knowledge-video-assembly-plan-v3',
  full_master_frames: 120,
  narration_frames: 120,
  narration_asset: 'example/assets/audio/narration.mp3',
  bgm: {mode: 'disabled', source: null, track: null},
  sound_effects: {
    contract_version: 'knowledge-video-sound-effect-track-v2',
    resume_mode: 'standard',
    design: {...soundDesign, event_map_sha256: 'f'.repeat(64)},
    library,
    policy,
    narration_gain: 1,
    normalization: 'disabled',
    peak_ceiling_dbfs: -1,
    overflow_action: 'lower-sfx-bus-uniformly',
    audio_preflight_policy: 'required-before-first-full-render-v1',
    bus_gain_multiplier: 1.12,
    cues: [cue],
  },
  scenes: [{
    shot_id: 'S01', start_frame: 0, end_frame: 120, duration_frames: 120,
    ian_layered_scene: null,
  }],
  qa_contract: {
    sound_design: {
      contract_version: 'knowledge-video-sound-design-validation-v2',
      resume_mode: 'standard',
      result: 'pass',
      ...soundDesign,
      event_map_sha256: 'f'.repeat(64),
      bindings: {sound_effect_library: library, sound_design_policy: policy},
      structural_coverage_result: 'pass',
    },
  },
};

assert.deepEqual(validateSoundDesignPlan({plan: goodPlan, source}), {
  contract_version: 'knowledge-video-sound-effect-track-v2',
  result: 'pass',
  cue_count: 1,
  global_cue_count: 1,
  ian_cue_count: 0,
  bus_gain_multiplier: 1.12,
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

const legacyStandard = structuredClone(goodPlan);
legacyStandard.sound_effects.contract_version = 'knowledge-video-sound-effect-track-v1';
legacyStandard.qa_contract.sound_design.contract_version = 'knowledge-video-sound-design-validation-v1';
assert.throws(
  () => validateSoundDesignPlan({plan: legacyStandard, source}),
  /missing or stale sound-design/i,
);

const legacyRevoice = structuredClone(legacyStandard);
legacyRevoice.sound_effects.resume_mode = 'revoice_variant';
legacyRevoice.sound_effects.policy = null;
legacyRevoice.qa_contract.sound_design.resume_mode = 'revoice_variant';
delete legacyRevoice.qa_contract.sound_design.bindings.sound_design_policy;
delete legacyRevoice.qa_contract.sound_design.structural_coverage_result;
for (const legacyCue of legacyRevoice.sound_effects.cues) {
  delete legacyCue.sync_frame;
  delete legacyCue.cue_group_id;
  delete legacyCue.primary_render_event_id;
  delete legacyCue.covered_event_ids;
}
assert.equal(validateSoundDesignPlan({plan: legacyRevoice, source}).result, 'pass');

const duplicateRender = structuredClone(goodPlan);
duplicateRender.sound_effects.cues.push({
  ...structuredClone(cue),
  event_id: 'S01:semantic:duplicate-render',
  cue_group_id: 'cue:S01:semantic:duplicate-render',
  primary_render_event_id: 'S01:semantic:duplicate-render',
  covered_event_ids: ['S01:semantic:duplicate-render'],
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
