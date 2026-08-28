#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {preflightSoundMix} from './preflight-sound-mix.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sound-preflight-test-'));
const writeAsset = (asset, bytes) => {
  const file = path.join(root, 'leverage-video/src', asset);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, bytes);
  return crypto.createHash('sha256').update(bytes).digest('hex');
};
const narrationAsset = 'topic99/assets/audio/narration.wav';
writeAsset(narrationAsset, 'narration');
const cueAsset = 'topic99/assets/audio/sfx/opening.wav';
const cueSha = writeAsset(cueAsset, 'cue');

const plan = {
  schema_version: 'knowledge-video-assembly-plan-v3',
  full_master_frames: 90,
  narration_asset: narrationAsset,
  bgm: {mode: 'disabled', source: null, track: null},
  sound_effects: {
    contract_version: 'knowledge-video-sound-effect-track-v2',
    resume_mode: 'standard',
    policy: {path: 'policy.json', checksum_sha256: 'a'.repeat(64)},
    narration_gain: 1,
    normalization: 'disabled',
    peak_ceiling_dbfs: -1,
    overflow_action: 'lower-sfx-bus-uniformly',
    audio_preflight_policy: 'required-before-first-full-render-v1',
    bus_gain_multiplier: 1.12,
    cues: [{
      event_id: 'S01:opening',
      cue_group_id: 'cue:S01:opening',
      primary_render_event_id: 'S01:opening',
      covered_event_ids: ['S01:opening'],
      cue_frame: 30,
      sync_frame: 30,
      render_owner: 'global_sound_effect_track_v1',
      gain_multiplier: 0.5,
      derived_asset: {asset: cueAsset, checksum_sha256: cueSha},
    }],
  },
};

test.after(() => fs.rmSync(root, {recursive: true, force: true}));

test('builds an audio-only exact-frame unified-bus preflight', () => {
  let observedArgs;
  const evidence = preflightSoundMix({
    plan,
    repositoryRoot: root,
    runImpl: (_command, args) => {
      observedArgs = args;
      return {status: 0, stderr: 'max_volume: -1.4 dB\n'};
    },
  });
  const graph = observedArgs[observedArgs.indexOf('-filter_complex') + 1];
  assert.match(graph, /volume=0\.56/);
  assert.match(graph, /adelay=delays=44100S:all=1/);
  assert.match(graph, /amix=inputs=2:duration=first:dropout_transition=0:normalize=0/);
  assert.equal(evidence.measured_peak_dbfs, -1.4);
  assert.equal(evidence.full_video_rendered, false);
  assert.equal(evidence.cue_groups.length, 1);
});

test('blocks peak overflow and requires lowering only the common bus', () => {
  assert.throws(() => preflightSoundMix({
    plan,
    repositoryRoot: root,
    runImpl: () => ({status: 0, stderr: 'max_volume: -0.7 dB\n'}),
  }), /lower only bus_gain_multiplier/);
});

test('rejects a standard v1 sound track as completed read-only history', () => {
  const legacy = structuredClone(plan);
  legacy.sound_effects.contract_version = 'knowledge-video-sound-effect-track-v1';
  assert.throws(() => preflightSoundMix({
    plan: legacy,
    repositoryRoot: root,
    runImpl: () => ({status: 0, stderr: 'max_volume: -2 dB\n'}),
  }), /current sound-mix plan/);
});

test('keeps a v1 parent renderable only as a retiming-only revoice', () => {
  const legacyRevoice = structuredClone(plan);
  legacyRevoice.sound_effects.contract_version = 'knowledge-video-sound-effect-track-v1';
  legacyRevoice.sound_effects.resume_mode = 'revoice_variant';
  legacyRevoice.sound_effects.policy = null;
  delete legacyRevoice.sound_effects.cues[0].cue_group_id;
  delete legacyRevoice.sound_effects.cues[0].primary_render_event_id;
  delete legacyRevoice.sound_effects.cues[0].covered_event_ids;
  delete legacyRevoice.sound_effects.cues[0].sync_frame;
  const evidence = preflightSoundMix({
    plan: legacyRevoice,
    repositoryRoot: root,
    runImpl: () => ({status: 0, stderr: 'max_volume: -2 dB\n'}),
  });
  assert.equal(evidence.cue_groups[0].cue_group_id, 'legacy:S01:opening');
});
