import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

import {sha256File, verifyFileChecksum} from '../episode-tooling/file-integrity.mjs';
import {buildIanLayeredEntryEffectsMapSha256} from './contract.mjs';
import {
  IAN_LAYER_ENTRY_SFX_CUE_VERSION,
  IAN_SAMPLES_PER_FRAME,
} from './runtime.mjs';

const run = (executable, args, label) => {
  const result = spawnSync(executable, args, {encoding: 'utf8'});
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return {stdout: result.stdout, stderr: result.stderr};
};

export const effectivePeakDbfs = (sourcePeakDbfs, gainMultiplier) => {
  if (!Number.isFinite(sourcePeakDbfs) || !Number.isFinite(gainMultiplier) || gainMultiplier <= 0) {
    throw new Error('effective peak requires a finite source peak and positive gain');
  }
  return sourcePeakDbfs + (20 * Math.log10(gainMultiplier));
};

export const assertAudibleEntryPeak = (effectivePeak, {
  minimumDbfs = -18,
  maximumDbfs = -12,
} = {}) => {
  if (!Number.isFinite(effectivePeak)
      || effectivePeak < minimumDbfs || effectivePeak > maximumDbfs) {
    throw new Error(`Ian entry SFX effective peak ${effectivePeak} dBFS is outside ${minimumDbfs}..${maximumDbfs}`);
  }
  return effectivePeak;
};

export const buildAudibleTrimmedDerivative = ({
  ffmpegPath,
  ffprobePath,
  sourcePath,
  sourceChecksumSha256,
  outputPath,
  trimStartSample,
  trimEndSampleExclusive,
  gainMultiplier,
  minimumEffectivePeakDbfs = -18,
  maximumEffectivePeakDbfs = -12,
}) => {
  if (!Number.isInteger(trimStartSample) || trimStartSample < 0
      || !Number.isInteger(trimEndSampleExclusive)
      || trimEndSampleExclusive <= trimStartSample) {
    throw new Error('Ian entry SFX trim sample range is invalid');
  }
  verifyFileChecksum(sourcePath, sourceChecksumSha256);
  fs.mkdirSync(path.dirname(outputPath), {recursive: true});
  const temporaryPath = `${outputPath}.tmp.wav`;
  run(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', sourcePath,
    '-af', `atrim=start_sample=${trimStartSample}:end_sample=${trimEndSampleExclusive},asetpts=PTS-STARTPTS`,
    '-ar', '44100', '-ac', '2', '-c:a', 'pcm_s16le',
    '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact',
    temporaryPath,
  ], 'trim Ian entry SFX');
  const probe = JSON.parse(run(ffprobePath, [
    '-v', 'error', '-select_streams', 'a:0',
    '-show_entries', 'stream=sample_rate,channels,duration_ts,time_base',
    '-of', 'json', temporaryPath,
  ], 'probe Ian entry SFX').stdout);
  const stream = probe.streams?.[0];
  if (stream?.sample_rate !== '44100' || stream?.channels !== 2
      || stream?.duration_ts !== trimEndSampleExclusive - trimStartSample
      || stream?.time_base !== '1/44100') {
    throw new Error('Ian entry SFX derivative is not the exact stereo 44.1 kHz sample range');
  }
  const measured = run(ffmpegPath, [
    '-hide_banner', '-i', temporaryPath,
    '-af', `volume=${gainMultiplier},volumedetect`, '-f', 'null', '-',
  ], 'measure Ian entry SFX');
  const match = measured.stderr.match(/max_volume:\s*(-?[0-9]+(?:\.[0-9]+)?) dB/);
  if (!match) throw new Error('Ian entry SFX peak measurement is missing');
  const effectivePeak = Number(match[1]);
  assertAudibleEntryPeak(effectivePeak, {
    minimumDbfs: minimumEffectivePeakDbfs,
    maximumDbfs: maximumEffectivePeakDbfs,
  });
  fs.renameSync(temporaryPath, outputPath);
  return {
    checksum_sha256: sha256File(outputPath),
    sample_rate_hz: 44100,
    channels: 2,
    effective_peak_dbfs: effectivePeak,
  };
};

export const reviseIanEntryEffectsSoundAssets = (plan, profilesByRole) => {
  const revised = structuredClone(plan);
  for (const layer of revised.layers ?? []) {
    const cue = layer.sound_effect;
    const profile = profilesByRole[cue?.role];
    if (!profile || cue.gain_multiplier !== profile.gain_multiplier) {
      throw new Error(`Ian entry SFX profile is missing or stale for ${cue?.role ?? 'unknown'}`);
    }
    cue.source.trim_start_sample = profile.trim_start_sample;
    cue.source.trim_end_sample_exclusive = profile.trim_end_sample_exclusive;
    cue.derived_asset = structuredClone(profile.derived_asset);
  }
  revised.presented_map_sha256 = buildIanLayeredEntryEffectsMapSha256(revised);
  return revised;
};

export const reviseIanEntryEffectsSoundDesign = (plan, {
  selectionsByLayer,
  profilesByAssetId,
} = {}) => {
  if (!selectionsByLayer || !profilesByAssetId) {
    throw new Error('Ian selective sound design requires selections and asset profiles');
  }
  const revised = structuredClone(plan);
  for (const layer of revised.layers ?? []) {
    const selection = selectionsByLayer[layer.layer_id] ?? null;
    if (selection === null) {
      layer.sound_effect = null;
      continue;
    }
    const profile = profilesByAssetId[selection.asset_id];
    if (!profile || typeof selection.reason !== 'string' || selection.reason.trim().length < 4) {
      throw new Error(`Ian entry SFX semantic selection is missing for ${layer.layer_id}`);
    }
    layer.sound_effect = {
      contract_version: IAN_LAYER_ENTRY_SFX_CUE_VERSION,
      role: profile.role,
      selection_reason: selection.reason,
      source: {
        asset_id: profile.asset_id,
        path: profile.source_path,
        checksum_sha256: profile.source_checksum_sha256,
        trim_start_sample: profile.trim_start_sample,
        trim_end_sample_exclusive: profile.trim_end_sample_exclusive,
      },
      derived_asset: structuredClone(profile.derived_asset),
      cue_frame: layer.entry_frame,
      cue_sample: layer.entry_frame * IAN_SAMPLES_PER_FRAME,
      gain_multiplier: profile.gain_multiplier,
    };
  }
  revised.presented_map_sha256 = buildIanLayeredEntryEffectsMapSha256(revised);
  return revised;
};
