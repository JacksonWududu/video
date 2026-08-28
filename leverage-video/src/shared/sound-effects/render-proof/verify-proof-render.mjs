#!/usr/bin/env node
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const FPS = 30;
const CUE_FRAME = 30;
const BUS_GAIN = 0.25;

const decode = (file) => {
  const result = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-i', file,
    '-map', '0:a:0', '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS),
    '-f', 's16le', '-acodec', 'pcm_s16le', '-',
  ], {encoding: null, maxBuffer: 32 * 1024 * 1024});
  if (result.status !== 0) throw new Error(`cannot decode ${file}`);
  return new Int16Array(result.stdout.buffer, result.stdout.byteOffset, result.stdout.byteLength / 2);
};

const firstNonZeroFrame = (samples, threshold = 2) => {
  for (let index = 0; index < samples.length; index += CHANNELS) {
    if (Math.abs(samples[index]) > threshold || Math.abs(samples[index + 1]) > threshold) {
      return index / CHANNELS;
    }
  }
  return -1;
};

const fitGain = (output, input, outputStartFrame, inputStartFrame, frameCount) => {
  let numerator = 0;
  let denominator = 0;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < CHANNELS; channel += 1) {
      const source = input[(inputStartFrame + frame) * CHANNELS + channel] ?? 0;
      const target = output[(outputStartFrame + frame) * CHANNELS + channel] ?? 0;
      numerator += source * target;
      denominator += source * source;
    }
  }
  return numerator / denominator;
};

const [mixedPath, baselinePath, narrationPath, sfxPath] = process.argv.slice(2);
if (!mixedPath || !baselinePath || !narrationPath || !sfxPath) {
  throw new Error('usage: verify-proof-render.mjs <mixed> <baseline> <narration.wav> <sfx.wav>');
}

const mixed = decode(mixedPath);
const baseline = decode(baselinePath);
const narration = decode(narrationPath);
const sfx = decode(sfxPath);
assert.equal(mixed.length, baseline.length, 'proof renders must have equal audio lengths');

const difference = new Int16Array(mixed.length);
for (let index = 0; index < mixed.length; index += 1) {
  difference[index] = mixed[index] - baseline[index];
}

const sourceOnset = firstNonZeroFrame(sfx);
const mixedOnset = firstNonZeroFrame(difference);
const cueSampleFrame = CUE_FRAME * SAMPLE_RATE / FPS;
assert.equal(Number.isInteger(cueSampleFrame), true, 'cue frame must map to an exact sample');
assert.ok(sourceOnset >= 0, 'proof SFX must be audible');
assert.equal(
  Math.floor(mixedOnset / (SAMPLE_RATE / FPS)),
  CUE_FRAME,
  `SFX onset ${mixedOnset} does not occur in cue frame ${CUE_FRAME}`,
);

const narrationFrames = Math.min(narration.length, baseline.length) / CHANNELS;
const narrationGain = fitGain(baseline, narration, 0, 0, Math.floor(narrationFrames));
assert.ok(Math.abs(narrationGain - 1) < 0.002, `narration gain changed to ${narrationGain}`);

const comparableSfxFrames = Math.min(
  sfx.length / CHANNELS,
  difference.length / CHANNELS - cueSampleFrame,
);
const fittedBusGain = fitGain(difference, sfx, cueSampleFrame, 0, Math.floor(comparableSfxFrames));
assert.ok(Math.abs(fittedBusGain - BUS_GAIN) < 0.003, `SFX bus changed to ${fittedBusGain}`);

process.stdout.write(`${JSON.stringify({
  contract_version: 'knowledge-video-sound-render-proof-v1',
  result: 'pass',
  cue_frame: CUE_FRAME,
  cue_sample_frame: cueSampleFrame,
  source_onset_sample_frame: sourceOnset,
  mixed_onset_sample_frame: mixedOnset,
  mixed_onset_video_frame: Math.floor(mixedOnset / (SAMPLE_RATE / FPS)),
  narration_gain: narrationGain,
  sfx_bus_gain_multiplier: fittedBusGain,
  bgm: 'disabled',
}, null, 2)}\n`);
