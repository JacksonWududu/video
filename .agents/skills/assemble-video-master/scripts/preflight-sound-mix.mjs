#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

import {
  atomicWriteJson,
  assertRegularFile,
  sha256File,
  verifyFileChecksum,
} from '../../../../leverage-video/src/shared/episode-tooling/file-integrity.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(HERE, '../../../..');
const SHA256 = /^[a-f0-9]{64}$/;
const SAMPLES_PER_FRAME = 1470;
const RENDER_OWNERS = new Set(['global_sound_effect_track_v1', 'ian_layered_scene']);

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
};

export const soundEffectsProjectionSha256 = (soundEffects) => crypto
  .createHash('sha256')
  .update(JSON.stringify(canonicalize(soundEffects)))
  .digest('hex');

const resolveMediaAsset = (repositoryRoot, asset, label) => {
  if (typeof asset !== 'string' || asset === '' || path.isAbsolute(asset)
      || asset.replaceAll('\\', '/').split('/').includes('..')) {
    throw new Error(`${label} must be a safe public or repository-root-relative asset`);
  }
  const relative = asset.startsWith('leverage-video/src/')
    ? asset
    : `leverage-video/src/${asset}`;
  const resolved = path.resolve(repositoryRoot, relative);
  const inside = path.relative(repositoryRoot, resolved);
  if (inside.startsWith('..') || path.isAbsolute(inside)) {
    throw new Error(`${label} escapes the repository`);
  }
  return assertRegularFile(resolved, {nonEmpty: true});
};

const validatePlan = (plan) => {
  const sound = plan?.sound_effects;
  const currentV2 = sound?.contract_version === 'knowledge-video-sound-effect-track-v2'
    && ['standard', 'revoice_variant'].includes(sound?.resume_mode)
    && sound?.policy != null;
  const legacyRevoice = sound?.contract_version === 'knowledge-video-sound-effect-track-v1'
    && sound?.resume_mode === 'revoice_variant';
  if (plan?.schema_version !== 'knowledge-video-assembly-plan-v3'
      || (!currentV2 && !legacyRevoice)
      || !Number.isInteger(plan.full_master_frames) || plan.full_master_frames < 1
      || typeof plan.narration_asset !== 'string' || plan.narration_asset === ''
      || sound.narration_gain !== 1 || sound.normalization !== 'disabled'
      || sound.peak_ceiling_dbfs !== -1
      || sound.overflow_action !== 'lower-sfx-bus-uniformly'
      || sound.audio_preflight_policy !== 'required-before-first-full-render-v1'
      || typeof sound.bus_gain_multiplier !== 'number'
      || !Number.isFinite(sound.bus_gain_multiplier) || sound.bus_gain_multiplier <= 0
      || !Array.isArray(sound.cues)
      || plan.bgm?.mode !== 'disabled'
      || plan.bgm?.source !== null || plan.bgm?.track !== null) {
    throw new Error('audio-only preflight requires a current sound-mix plan');
  }
  const groups = new Set();
  for (const cue of sound.cues) {
    const groupId = currentV2 ? cue?.cue_group_id : `legacy:${cue?.event_id}`;
    if (typeof cue?.event_id !== 'string' || cue.event_id === ''
        || typeof groupId !== 'string' || groupId === ''
        || groups.has(groupId)
        || (currentV2 && (cue.primary_render_event_id !== cue.event_id
          || !Array.isArray(cue.covered_event_ids)
          || !cue.covered_event_ids.includes(cue.event_id)
          || !Number.isInteger(cue.sync_frame) || cue.sync_frame < cue.cue_frame))
        || !RENDER_OWNERS.has(cue.render_owner)
        || !Number.isInteger(cue.cue_frame) || cue.cue_frame < 0
        || cue.cue_frame >= plan.full_master_frames
        || typeof cue.gain_multiplier !== 'number' || cue.gain_multiplier <= 0
        || typeof cue.derived_asset?.asset !== 'string'
        || !SHA256.test(cue.derived_asset?.checksum_sha256 ?? '')) {
      throw new Error(`audio-only preflight cue is invalid: ${cue?.event_id ?? 'unknown'}`);
    }
    groups.add(groupId);
  }
  return sound;
};

export const buildSoundMixInputs = ({narrationPath, cues, sound, fullMasterFrames, repositoryRoot}) => {
  const inputArgs = ['-i', narrationPath];
  const cueRecords = cues.map((cue, index) => {
    const file = resolveMediaAsset(
      repositoryRoot,
      cue.derived_asset.asset,
      `${cue.event_id}.derived_asset.asset`,
    );
    verifyFileChecksum(file, cue.derived_asset.checksum_sha256);
    inputArgs.push('-i', file);
    return {cue, file, inputIndex: index + 1};
  });
  const filters = ['[0:a]aresample=44100,volume=1[narration]'];
  for (const {cue, inputIndex} of cueRecords) {
    const volume = cue.gain_multiplier * sound.bus_gain_multiplier;
    filters.push(
      `[${inputIndex}:a]aresample=44100,volume=${volume},`
      + `adelay=delays=${cue.cue_frame * SAMPLES_PER_FRAME}S:all=1[sfx${inputIndex}]`,
    );
  }
  const inputs = ['[narration]', ...cueRecords.map(({inputIndex}) => `[sfx${inputIndex}]`)];
  filters.push(
    `${inputs.join('')}amix=inputs=${inputs.length}:duration=first:`
    + `dropout_transition=0:normalize=0,atrim=end_sample=${fullMasterFrames * SAMPLES_PER_FRAME},`
    + 'volumedetect[mix]',
  );
  return {inputArgs, filters, cueRecords};
};

const runFfmpeg = ({narrationPath, cues, sound, fullMasterFrames, repositoryRoot, runImpl}) => {
  const {inputArgs, filters, cueRecords} = buildSoundMixInputs({narrationPath, cues, sound, fullMasterFrames, repositoryRoot});
  const args = [
    '-hide_banner', '-nostdin', ...inputArgs,
    '-filter_complex', filters.join(';'), '-map', '[mix]', '-f', 'null', '-',
  ];
  const result = runImpl('ffmpeg', args, {encoding: 'utf8'});
  if (result.status !== 0) throw new Error(`audio-only preflight ffmpeg failed: ${result.stderr ?? ''}`);
  const match = (result.stderr ?? '').match(/max_volume:\s*(-?(?:[0-9]+(?:\.[0-9]+)?|inf)) dB/);
  if (!match) throw new Error('audio-only preflight peak evidence is missing');
  return {peakDbfs: Number(match[1]), args, cueRecords};
};

export const preflightSoundMix = ({
  plan,
  repositoryRoot = REPOSITORY_ROOT,
  runImpl = spawnSync,
} = {}) => {
  const sound = validatePlan(plan);
  const narrationPath = resolveMediaAsset(repositoryRoot, plan.narration_asset, 'narration_asset');
  const {peakDbfs, cueRecords} = runFfmpeg({
    narrationPath,
    cues: sound.cues,
    sound,
    fullMasterFrames: plan.full_master_frames,
    repositoryRoot,
    runImpl,
  });
  if (!Number.isFinite(peakDbfs)) throw new Error('audio-only preflight peak is not finite');
  if (peakDbfs > sound.peak_ceiling_dbfs) {
    throw new Error(
      `audio-only preflight peak ${peakDbfs} dBFS exceeds -1 dBFS; lower only bus_gain_multiplier`,
    );
  }
  return {
    contract_version: 'knowledge-video-sound-audio-preflight-v1',
    result: 'pass',
    sound_effects_projection_sha256: soundEffectsProjectionSha256(sound),
    narration: {
      asset: plan.narration_asset,
      checksum_sha256: sha256File(narrationPath),
      gain: 1,
    },
    normalization: 'disabled',
    bus_gain_multiplier: sound.bus_gain_multiplier,
    cue_groups: cueRecords.map(({cue}) => ({
      cue_group_id: cue.cue_group_id ?? `legacy:${cue.event_id}`,
      primary_render_event_id: cue.event_id,
      render_owner: cue.render_owner,
      cue_frame: cue.cue_frame,
      asset: cue.derived_asset.asset,
      checksum_sha256: cue.derived_asset.checksum_sha256,
      gain_multiplier: cue.gain_multiplier,
    })),
    full_master_frames: plan.full_master_frames,
    sample_rate_hz: 44100,
    measured_peak_dbfs: peakDbfs,
    peak_ceiling_dbfs: -1,
    full_video_rendered: false,
  };
};

const main = () => {
  const [planPath, evidencePath] = process.argv.slice(2);
  if (!planPath || !evidencePath) {
    throw new Error('usage: preflight-sound-mix.mjs <assembly-plan.json> <preflight-evidence.json>');
  }
  const plan = JSON.parse(fs.readFileSync(assertRegularFile(planPath, {nonEmpty: true}), 'utf8'));
  atomicWriteJson(evidencePath, preflightSoundMix({plan}));
  process.stdout.write(`${path.resolve(evidencePath)}\n`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
