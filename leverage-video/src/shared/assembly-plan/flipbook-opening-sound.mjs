import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {loadAndValidateKnowledgeVideoSoundDesign} from '../sound-effects/sound-design.mjs';
import {verifyFileChecksum} from '../episode-tooling/file-integrity.mjs';
import {probeMedia} from '../render-qa/media-qa.mjs';
import {buildSoundMixInputs, preflightSoundMix, soundEffectsProjectionSha256} from '../../../../.agents/skills/assemble-video-master/scripts/preflight-sound-mix.mjs';

const SAMPLES_PER_FRAME = 1470;
const CHANNELS = 2;
const fail = message => {throw new Error(`flipbook opening sound: ${message}`);};
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : JSON.stringify(canonical(value))).digest('hex');
const equal = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const openingFrames = cover => {
  if (cover?.hold_frames !== 24 || cover?.open_frames !== 30) fail('explicit 24+30 frame opening required');
  return 54;
};
const boundFile = (repositoryRoot, binding, prefix) => {
  if (typeof binding?.path !== 'string' || !binding.path.startsWith(prefix)
    || path.isAbsolute(binding.path) || binding.path.split('/').some(part => ['', '.', '..'].includes(part))) fail('safe episode binding required');
  let file = repositoryRoot;
  for (const part of binding.path.split('/')) {
    file = path.join(file, part);
    if (fs.lstatSync(file).isSymbolicLink()) fail('bound files cannot follow symlinks');
  }
  verifyFileChecksum(file, binding.checksum_sha256);
  return file;
};

// These are presentation sound scopes, never storyboard rows or new image assets.
export const buildFlipbookOpeningSoundScopes = ({openingCover, bodyFrames}) => {
  const offset = openingFrames(openingCover);
  if (!Number.isInteger(bodyFrames) || bodyFrames < 1) fail('body frame count required');
  return [{shot_id: 'FLIPBOOK-COVER', start_frame: 0, end_frame: offset,
    transition: {kind: 'book-page-turn', duration_in_frames: openingCover.open_frames}},
  {shot_id: 'FLIPBOOK-BODY-ENTRY', start_frame: offset, end_frame: offset + bodyFrames, transition: null}];
};

export const buildFlipbookOpeningSoundBinding = ({openingCover, bodyPlan}) => ({
  contract_version: 'knowledge-video-flipbook-opening-sound-adapter-v1',
  opening_cover: structuredClone(openingCover),
  body_assembly_plan_sha256: digest(bodyPlan),
});

export const loadFlipbookOpeningSoundDesign = ({repositoryRoot, episodeWorkspace, manifest, bodyPlan}) => {
  const binding = manifest.opening_sound_design;
  boundFile(repositoryRoot, binding, `${episodeWorkspace}/schema/`);
  const scopes = buildFlipbookOpeningSoundScopes({openingCover: manifest.opening_cover, bodyFrames: bodyPlan.full_master_frames});
  const evidence = loadAndValidateKnowledgeVideoSoundDesign({repositoryRoot, episodeWorkspace, binding,
    shots: scopes, durationFrames: bodyPlan.full_master_frames + 54,
    expectedBindings: bodyPlan.qa_contract.sound_design.bindings});
  if (!equal(evidence.value.opening_adapter, buildFlipbookOpeningSoundBinding({openingCover: manifest.opening_cover, bodyPlan}))) fail('opening adapter or body-plan hash is stale');
  if (evidence.value.events.length !== 2 || evidence.validation.audible_cues.length !== 2
    || evidence.validation.bus_gain_multiplier !== bodyPlan.sound_effects.bus_gain_multiplier) fail('both cover anchors require the unchanged common SFX bus');
  return evidence;
};

export const buildFlipbookOpeningSoundMix = ({repositoryRoot, episodeWorkspace, manifest, bodyPlan}) => {
  const opening = loadFlipbookOpeningSoundDesign({repositoryRoot, episodeWorkspace, manifest, bodyPlan});
  const offset = openingFrames(manifest.opening_cover);
  const plan = structuredClone(bodyPlan);
  plan.full_master_frames += offset;
  plan.sound_effects.cues = [...opening.validation.audible_cues,
    ...bodyPlan.sound_effects.cues.map(cue => ({...structuredClone(cue),
      cue_frame: cue.cue_frame + offset, sync_frame: cue.sync_frame + offset}))];
  if (new Set(plan.sound_effects.cues.map(cue => cue.cue_group_id)).size !== plan.sound_effects.cues.length) fail('cover and body cue group identities overlap');
  const narrationBinding = {path: bodyPlan.narration_asset.startsWith('leverage-video/src/')
    ? bodyPlan.narration_asset : `leverage-video/src/${bodyPlan.narration_asset}`,
  checksum_sha256: bodyPlan.qa_contract.sound_design.bindings.narration_master.checksum_sha256};
  const narrationPath = boundFile(repositoryRoot, narrationBinding, `${episodeWorkspace}/assets/audio/`);
  const mix = buildSoundMixInputs({repositoryRoot, narrationPath, cues: plan.sound_effects.cues,
    sound: plan.sound_effects, fullMasterFrames: plan.full_master_frames});
  if (mix.filters[0] !== '[0:a]aresample=44100,volume=1[narration]') fail('shared narration filter contract changed');
  const sampleCount = plan.full_master_frames * SAMPLES_PER_FRAME;
  mix.filters[0] = `[0:a]aresample=44100,volume=1,adelay=delays=${offset * SAMPLES_PER_FRAME}S:all=1,`
    + `apad=whole_len=${sampleCount},atrim=end_sample=${sampleCount}[narration]`;
  return {plan, opening, inputArgs: mix.inputArgs, filters: mix.filters, sampleCount, offset};
};

const renderPcm = (args, sampleCount) => {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', ...args,
    '-ar', '44100', '-ac', String(CHANNELS), '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1'],
  {maxBuffer: (sampleCount + 2048) * CHANNELS * 4 + 1024 * 1024});
  if (result.status !== 0) fail(`PCM verification failed: ${result.stderr?.toString()}`);
  return {pcm: result.stdout, log: result.stderr.toString()};
};
const requirePeak = log => {
  const match = log.match(/max_volume:\s*(-?(?:[0-9]+(?:\.[0-9]+)?|inf)) dB/);
  const peak = match ? Number(match[1]) : NaN;
  if (!Number.isFinite(peak) || peak > -1) fail('combined peak exceeds -1 dBFS; lower the common SFX bus');
  return peak;
};

export const preflightFlipbookOpeningSound = (options) => {
  const bodyPreflight = preflightSoundMix({plan: options.bodyPlan, repositoryRoot: options.repositoryRoot});
  const mix = buildFlipbookOpeningSoundMix(options);
  const {pcm, log} = renderPcm([...mix.inputArgs, '-filter_complex', mix.filters.join(';'), '-map', '[mix]'], mix.sampleCount);
  if (pcm.length !== mix.sampleCount * CHANNELS * 4) fail('presentation sample count differs from exact frame count');
  const peak = requirePeak(log);
  const evidence = {contract_version: 'knowledge-video-flipbook-opening-audio-preflight-v1', result: 'pass',
    body_assembly_plan_sha256: digest(options.bodyPlan), body_preflight: bodyPreflight,
    opening_sound_design: structuredClone(options.manifest.opening_sound_design),
    opening_frames: mix.offset, narration_delay_samples: mix.offset * SAMPLES_PER_FRAME,
    full_master_frames: mix.plan.full_master_frames, sample_rate_hz: 44100, channels: CHANNELS,
    first_sentence_end_frame: Number.isInteger(options.bodyPlan.timeline?.first_sentence_end_frame)
      ? options.bodyPlan.timeline.first_sentence_end_frame + mix.offset : null,
    decoded_sample_count: mix.sampleCount, reference_pcm_sha256: digest(pcm),
    sound_effects_projection_sha256: soundEffectsProjectionSha256(mix.plan.sound_effects),
    measured_peak_dbfs: peak, peak_ceiling_dbfs: -1};
  return {evidence, referencePcm: pcm, plan: mix.plan, inputArgs: mix.inputArgs, filters: mix.filters};
};

const compareWindow = (expected, actual, start, end) => {
  let power = 0; let actualPower = 0; let cross = 0; let error = 0;
  for (let index = start * CHANNELS; index < end * CHANNELS; index += 1) {
    const left = expected.readFloatLE(index * 4); const right = actual.readFloatLE(index * 4);
    if (!Number.isFinite(left) || !Number.isFinite(right)) fail('decoded audio contains nonfinite samples');
    power += left * left; actualPower += right * right; cross += left * right; error += (left - right) ** 2;
  }
  if (power <= 0 || actualPower <= 0) fail('required cover/body audio is silent');
  const correlation = cross / Math.sqrt(power * actualPower);
  const relativeError = error / power;
  if (correlation < 0.95 || relativeError > 0.12) fail('decoded output differs from the sample-aligned cover/body mix');
  return {correlation, relative_squared_error: relativeError};
};

export const validateFlipbookOpeningRenderAudio = ({renderPath, preflight, renderFrames = null}) => {
  const evidence = preflight?.evidence;
  if (evidence?.contract_version !== 'knowledge-video-flipbook-opening-audio-preflight-v1'
    || evidence.result !== 'pass' || evidence.opening_frames !== 54
    || evidence.narration_delay_samples !== 54 * SAMPLES_PER_FRAME
    || !Buffer.isBuffer(preflight.referencePcm)
    || digest(preflight.referencePcm) !== evidence.reference_pcm_sha256) fail('executed sample-bound preflight required');
  const frames = renderFrames ?? evidence.full_master_frames;
  if (!Number.isInteger(frames) || frames <= evidence.opening_frames
    || (frames !== evidence.full_master_frames && frames !== evidence.first_sentence_end_frame)) fail('render frame count is not a locked full master or first-sentence prefix');
  const audio = probeMedia(renderPath).streams.filter(stream => stream.codec_type === 'audio');
  if (audio.length !== 1 || Number(audio[0].sample_rate) !== 44100 || audio[0].channels !== CHANNELS) fail('render must contain exactly one stereo 44.1 kHz mix');
  const sampleCount = frames * SAMPLES_PER_FRAME;
  const {pcm, log} = renderPcm(['-i', renderPath, '-map', '0:a:0', '-af', 'volumedetect'], sampleCount);
  const peak = requirePeak(log);
  const actualSamples = pcm.length / (CHANNELS * 4);
  // AAC may retain up to one encoder frame of trailing padding after decoding.
  if (!Number.isInteger(actualSamples) || actualSamples < sampleCount || actualSamples > sampleCount + 1024) fail('rendered audio sample count is stale');
  const cover = compareWindow(preflight.referencePcm, pcm, 0, evidence.narration_delay_samples);
  const body = compareWindow(preflight.referencePcm, pcm, evidence.narration_delay_samples, sampleCount);
  return {contract_version: 'knowledge-video-flipbook-opening-audio-qa-v1', result: 'pass',
    narration_delay_samples: evidence.narration_delay_samples, expected_sample_count: sampleCount,
    decoded_sample_count: actualSamples, reference_pcm_sha256: evidence.reference_pcm_sha256,
    measured_peak_dbfs: peak, peak_ceiling_dbfs: -1, cover_alignment: cover, body_alignment: body};
};
