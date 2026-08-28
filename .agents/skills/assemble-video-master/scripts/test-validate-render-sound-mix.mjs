#!/usr/bin/env node
import assert from 'node:assert/strict';

import {soundEffectsProjectionSha256} from './preflight-sound-mix.mjs';
import {validateRenderSoundMix} from './validate-render-sound-mix.mjs';

const plan = {
  schema_version: 'knowledge-video-assembly-plan-v3',
  full_master_frames: 120,
  narration_asset: 'topic99/assets/audio/narration.wav',
  bgm: {mode: 'disabled', source: null, track: null},
  sound_effects: {
    contract_version: 'knowledge-video-sound-effect-track-v2',
    resume_mode: 'standard',
    narration_gain: 1,
    normalization: 'disabled',
    peak_ceiling_dbfs: -1,
    overflow_action: 'lower-sfx-bus-uniformly',
    audio_preflight_policy: 'required-before-first-full-render-v1',
    bus_gain_multiplier: 0.75,
    cues: [{event_id: 'S01:semantic:reveal'}],
  },
  qa_contract: {sound_design: {resume_mode: 'standard'}},
};
const preflightEvidence = {
  contract_version: 'knowledge-video-sound-audio-preflight-v1',
  result: 'pass',
  sound_effects_projection_sha256: soundEffectsProjectionSha256(plan.sound_effects),
  narration: {asset: plan.narration_asset, checksum_sha256: 'a'.repeat(64), gain: 1},
  normalization: 'disabled',
  bus_gain_multiplier: 0.75,
  cue_groups: [{cue_group_id: 'cue:S01:semantic:reveal'}],
  full_master_frames: plan.full_master_frames,
  measured_peak_dbfs: -1.5,
  peak_ceiling_dbfs: -1,
  full_video_rendered: false,
};

assert.equal(validateRenderSoundMix({
  plan, preflightEvidence, renderPath: 'proof.mp4', measureImpl: () => -1.2,
}).result, 'pass');
assert.throws(() => validateRenderSoundMix({
  plan, preflightEvidence, renderPath: 'proof.mp4', measureImpl: () => -0.8,
}), /lower only the unified SFX bus/);
const narrationChanged = structuredClone(plan);
narrationChanged.sound_effects.narration_gain = 0.9;
assert.throws(() => validateRenderSoundMix({
  plan: narrationChanged, preflightEvidence, renderPath: 'proof.mp4', measureImpl: () => -2,
}), /locked narration\/SFX\/BGM policy/);
const legacyStandard = structuredClone(plan);
legacyStandard.sound_effects.contract_version = 'knowledge-video-sound-effect-track-v1';
assert.throws(() => validateRenderSoundMix({
  plan: legacyStandard, preflightEvidence, renderPath: 'proof.mp4', measureImpl: () => -2,
}), /locked narration\/SFX\/BGM policy/);
const legacyRevoice = structuredClone(legacyStandard);
legacyRevoice.sound_effects.resume_mode = 'revoice_variant';
legacyRevoice.qa_contract.sound_design.resume_mode = 'revoice_variant';
const legacyPreflight = structuredClone(preflightEvidence);
legacyPreflight.sound_effects_projection_sha256 = soundEffectsProjectionSha256(
  legacyRevoice.sound_effects,
);
assert.equal(validateRenderSoundMix({
  plan: legacyRevoice,
  preflightEvidence: legacyPreflight,
  renderPath: 'proof.mp4',
  measureImpl: () => -2,
}).result, 'pass');
const stalePreflight = structuredClone(preflightEvidence);
stalePreflight.bus_gain_multiplier = 0.5;
assert.throws(() => validateRenderSoundMix({
  plan, preflightEvidence: stalePreflight, renderPath: 'proof.mp4', measureImpl: () => -2,
}), /audio-only preflight/);

process.stdout.write('render sound-mix validator tests passed\n');
