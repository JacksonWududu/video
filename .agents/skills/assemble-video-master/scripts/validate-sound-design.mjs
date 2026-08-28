#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const SHA256 = /^[a-f0-9]{64}$/;
const GLOBAL_OWNER = 'global_sound_effect_track_v1';
const IAN_OWNER = 'ian_layered_scene';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(HERE, '../../../..');

const expandSharedSource = (source) => {
  if (!/shared\/video-scenes/.test(source) || !/KnowledgeVideo/.test(source)) return source;
  return [
    source,
    fs.readFileSync(path.join(
      REPOSITORY_ROOT,
      'leverage-video/src/shared/video-scenes/KnowledgeVideo.tsx',
    ), 'utf8'),
    fs.readFileSync(path.join(
      REPOSITORY_ROOT,
      'leverage-video/src/shared/video-scenes/SoundEffectTrack.tsx',
    ), 'utf8'),
    fs.readFileSync(path.join(
      REPOSITORY_ROOT,
      'leverage-video/src/shared/video-scenes/IanLayeredScene.tsx',
    ), 'utf8'),
    fs.readFileSync(path.join(
      REPOSITORY_ROOT,
      'leverage-video/src/shared/video-scenes/NarrationTrack.tsx',
    ), 'utf8'),
  ].join('\n');
};

const validateCue = (cue, durationFrames) => {
  const derived = cue?.derived_asset;
  if (typeof cue?.event_id !== 'string' || cue.event_id === ''
      || typeof cue.shot_id !== 'string' || cue.shot_id === ''
      || ![GLOBAL_OWNER, IAN_OWNER].includes(cue.render_owner)
      || !Number.isInteger(cue.cue_frame) || cue.cue_frame < 0
      || typeof cue.gain_multiplier !== 'number'
      || cue.gain_multiplier <= 0 || cue.gain_multiplier > 1
      || typeof derived?.asset !== 'string' || !derived.asset.endsWith('.wav')
      || !SHA256.test(derived?.checksum_sha256 ?? '')
      || derived.sample_rate_hz !== 44100 || derived.channels !== 2
      || derived.format !== 'wav' || derived.runtime_transform !== 'forbidden'
      || !Number.isInteger(derived.source_sample_rate_hz)
      || derived.source_sample_rate_hz < 1
      || !Number.isInteger(derived.duration_in_frames) || derived.duration_in_frames < 1
      || cue.cue_frame + derived.duration_in_frames > durationFrames) {
    throw new Error(`invalid sound-effect cue: ${cue?.event_id ?? 'unknown'}`);
  }
};

const sameIanCue = (cue, shot, layer) => {
  const owned = layer.sound_effect;
  return cue.shot_id === shot.shot_id
    && cue.cue_frame === shot.start_frame + owned.cue_frame
    && cue.semantic_role === owned.role
    && cue.gain_multiplier === owned.gain_multiplier
    && cue.source?.asset_id === owned.source.asset_id
    && cue.source?.path === owned.source.path
    && cue.source?.checksum_sha256 === owned.source.checksum_sha256
    && cue.derived_asset.asset === owned.derived_asset.asset
    && cue.derived_asset.checksum_sha256 === owned.derived_asset.checksum_sha256;
};

export const validateSoundDesignPlan = ({plan, source}) => {
  if (plan?.schema_version === 'knowledge-video-assembly-plan-v2') {
    if (Object.hasOwn(plan, 'sound_effects')) {
      throw new Error('legacy v2 assembly plan must remain sound-effect read-only');
    }
    return {
      contract_version: 'knowledge-video-sound-effect-track-legacy-v2',
      result: 'pass',
      cue_count: 0,
    };
  }
  if (plan?.schema_version !== 'knowledge-video-assembly-plan-v3') {
    throw new Error('unsupported knowledge-video assembly plan version');
  }
  const sound = plan.sound_effects;
  const qa = plan.qa_contract?.sound_design;
  if (sound?.contract_version !== 'knowledge-video-sound-effect-track-v1'
      || qa?.contract_version !== 'knowledge-video-sound-design-validation-v1'
      || qa?.result !== 'pass'
      || qa.path !== sound.design?.path
      || qa.checksum_sha256 !== sound.design?.checksum_sha256
      || qa.event_map_sha256 !== sound.design?.event_map_sha256
      || !SHA256.test(sound.design?.checksum_sha256 ?? '')
      || !SHA256.test(sound.design?.event_map_sha256 ?? '')
      || JSON.stringify(qa.bindings?.sound_effect_library) !== JSON.stringify(sound.library)
      || sound.narration_gain !== 1
      || sound.normalization !== 'disabled'
      || sound.peak_ceiling_dbfs !== -1
      || sound.overflow_action !== 'lower-sfx-bus-uniformly'
      || typeof sound.bus_gain_multiplier !== 'number'
      || sound.bus_gain_multiplier <= 0 || sound.bus_gain_multiplier > 1
      || !Array.isArray(sound.cues)
      || plan.bgm?.mode !== 'disabled'
      || plan.bgm?.source !== null || plan.bgm?.track !== null) {
    throw new Error('current assembly has missing or stale sound-design/mix evidence');
  }
  const ids = new Set();
  const cueKeys = new Set();
  for (const cue of sound.cues) {
    validateCue(cue, plan.full_master_frames);
    if (ids.has(cue.event_id)) throw new Error(`duplicate sound-effect cue: ${cue.event_id}`);
    const cueKey = `${cue.render_owner}:${cue.cue_frame}:${cue.source?.asset_id}`;
    if (cueKeys.has(cueKey)) throw new Error(`duplicate rendered sound-effect cue: ${cue.event_id}`);
    ids.add(cue.event_id);
    cueKeys.add(cueKey);
  }
  const ianOwned = sound.cues.filter(({render_owner: owner}) => owner === IAN_OWNER);
  const sceneIanCues = [];
  for (const shot of plan.scenes) {
    for (const layer of shot.ian_layered_scene?.entry_effects?.layers ?? []) {
      if (layer.sound_effect !== null) sceneIanCues.push({shot, layer});
    }
  }
  if (ianOwned.length !== sceneIanCues.length
      || sceneIanCues.some(({shot, layer}) => !ianOwned.some(
        (cue) => sameIanCue(cue, shot, layer),
      ))) {
    throw new Error('Ian sound-effect cues are not owned exactly once by IanLayeredScene');
  }
  source = expandSharedSource(source);
  if (!/SoundEffectTrack/.test(source)
      || !/render_owner[^\n]+global_sound_effect_track_v1/.test(source)
      || !/gain_multiplier \* soundEffects\.bus_gain_multiplier/.test(source)
      || !/soundEffectBusGain/.test(source)
      || !/gain_multiplier \* soundEffectBusGain/.test(source)
      || !/<NarrationTrack[\s\S]*?from=\{0\}/.test(source)
      || !/<Audio[^>]+volume=\{1\}/.test(source)) {
    throw new Error('composition does not consume the unified exactly-once SFX bus');
  }
  const trackSource = fs.readFileSync(path.join(
    REPOSITORY_ROOT,
    'leverage-video/src/shared/video-scenes/SoundEffectTrack.tsx',
  ), 'utf8');
  if (/playbackRate|trimBefore|trimAfter|normalize\s*\(/.test(trackSource)) {
    throw new Error('SoundEffectTrack performs a forbidden runtime audio transform');
  }
  return {
    contract_version: 'knowledge-video-sound-effect-track-v1',
    result: 'pass',
    cue_count: sound.cues.length,
    global_cue_count: sound.cues.length - ianOwned.length,
    ian_cue_count: ianOwned.length,
    bus_gain_multiplier: sound.bus_gain_multiplier,
    narration_gain: 1,
    bgm: 'disabled',
  };
};

export const validateCaptionVariantSoundIdentity = (left, right) => {
  if (left?.schema_version !== 'knowledge-video-assembly-plan-v3'
      || right?.schema_version !== 'knowledge-video-assembly-plan-v3'
      || JSON.stringify(left.sound_effects) !== JSON.stringify(right.sound_effects)) {
    throw new Error('caption variants must share byte-identical sound-effect plan inputs');
  }
  return {contract_version: 'caption-variant-sound-identity-v1', result: 'pass'};
};

const main = () => {
  const [planPath, sourcePath] = process.argv.slice(2);
  if (!planPath || !sourcePath) {
    throw new Error('usage: validate-sound-design.mjs <assembly-plan.json> <composition.tsx>');
  }
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const source = fs.readFileSync(sourcePath, 'utf8');
  process.stdout.write(`${JSON.stringify(validateSoundDesignPlan({plan, source}), null, 2)}\n`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
