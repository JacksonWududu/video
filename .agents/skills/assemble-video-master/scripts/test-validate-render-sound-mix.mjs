#!/usr/bin/env node
import assert from 'node:assert/strict';

import {validateRenderSoundMix} from './validate-render-sound-mix.mjs';

const plan = {
  schema_version: 'knowledge-video-assembly-plan-v3',
  bgm: {mode: 'disabled', source: null, track: null},
  sound_effects: {
    narration_gain: 1,
    normalization: 'disabled',
    peak_ceiling_dbfs: -1,
    overflow_action: 'lower-sfx-bus-uniformly',
    bus_gain_multiplier: 0.75,
    cues: [{event_id: 'S01:semantic:reveal'}],
  },
};

assert.equal(validateRenderSoundMix({
  plan, renderPath: 'proof.mp4', measureImpl: () => -1.2,
}).result, 'pass');
assert.throws(() => validateRenderSoundMix({
  plan, renderPath: 'proof.mp4', measureImpl: () => -0.8,
}), /lower only the unified SFX bus/);
const narrationChanged = structuredClone(plan);
narrationChanged.sound_effects.narration_gain = 0.9;
assert.throws(() => validateRenderSoundMix({
  plan: narrationChanged, renderPath: 'proof.mp4', measureImpl: () => -2,
}), /locked narration\/SFX\/BGM policy/);

process.stdout.write('render sound-mix validator tests passed\n');
