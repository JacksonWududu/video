#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  loadAndValidateSharedSoundEffectLibrary,
  sha256SoundEffectFile,
} from './contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPOSITORY_ROOT = path.resolve(HERE, '../../../..');

const run = (executable, args, label) => {
  const result = spawnSync(executable, args, {encoding: 'utf8'});
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result;
};

const resolveInside = (root, relative, label) => {
  if (typeof relative !== 'string' || relative === '' || path.isAbsolute(relative)
      || relative.replaceAll('\\', '/').split('/').includes('..')) {
    throw new Error(`${label} must be repository-root-relative`);
  }
  const resolved = path.resolve(root, relative);
  const relation = path.relative(root, resolved);
  if (relation.startsWith('..') || path.isAbsolute(relation)) throw new Error(`${label} escapes repository`);
  return resolved;
};

export const buildSoundEffectDerivedWav = ({
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
  episodeWorkspace,
  assetId,
  outputPath,
  trimStartSample,
  trimEndSample,
  libraryValidation = null,
  ffmpegPath = 'ffmpeg',
  ffprobePath = 'ffprobe',
} = {}) => {
  const library = libraryValidation ?? loadAndValidateSharedSoundEffectLibrary({repositoryRoot});
  const source = library.assets.find(({asset_id: id}) => id === assetId);
  if (!source) throw new Error(`sound-effect asset is not in the active library: ${assetId}`);
  if (!Number.isInteger(trimStartSample) || trimStartSample < 0
      || !Number.isInteger(trimEndSample) || trimEndSample <= trimStartSample) {
    throw new Error('sound-effect trim sample range is invalid');
  }
  if (typeof episodeWorkspace !== 'string' || episodeWorkspace === ''
      || !outputPath.startsWith(`${episodeWorkspace}/assets/audio/sfx/`)
      || path.extname(outputPath).toLowerCase() !== '.wav') {
    throw new Error('derived sound effect must be a WAV inside the episode SFX directory');
  }
  const sourcePath = resolveInside(repositoryRoot, source.path, 'source sound effect');
  const targetPath = resolveInside(repositoryRoot, outputPath, 'derived sound effect');
  if (fs.existsSync(targetPath)) throw new Error('derived sound effect is immutable and already exists');
  fs.mkdirSync(path.dirname(targetPath), {recursive: true});
  const temporaryPath = `${targetPath}.tmp-${process.pid}.wav`;
  try {
    run(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-i', sourcePath,
      '-af', `atrim=start_sample=${trimStartSample}:end_sample=${trimEndSample},asetpts=PTS-STARTPTS`,
      '-ar', '44100', '-ac', '2', '-c:a', 'pcm_s16le',
      '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact',
      temporaryPath,
    ], 'build sound-effect derivative');
    const probe = JSON.parse(run(ffprobePath, [
      '-v', 'error', '-select_streams', 'a:0',
      '-show_entries', 'stream=codec_name,sample_rate,channels,duration_ts,time_base',
      '-of', 'json', temporaryPath,
    ], 'probe sound-effect derivative').stdout);
    const stream = probe.streams?.[0];
    if (stream?.codec_name !== 'pcm_s16le' || stream?.sample_rate !== '44100'
        || stream?.channels !== 2 || stream?.time_base !== '1/44100'
        || !Number.isInteger(stream?.duration_ts) || stream.duration_ts < 1) {
      throw new Error('derived sound effect is not stereo 44.1 kHz pcm_s16le WAV');
    }
    fs.renameSync(temporaryPath, targetPath);
    return {
      path: outputPath,
      asset: outputPath.replace(/^leverage-video\/src\//, ''),
      checksum_sha256: sha256SoundEffectFile(targetPath),
      sample_rate_hz: 44100,
      channels: 2,
      format: 'wav',
      source_sample_rate_hz: source.sample_rate_hz,
      trim_start_sample: trimStartSample,
      trim_end_sample: trimEndSample,
      duration_in_frames: Math.ceil((stream.duration_ts / 44100) * 30),
      runtime_transform: 'forbidden',
    };
  } finally {
    fs.rmSync(temporaryPath, {force: true});
  }
};

const main = () => {
  const [requestPath] = process.argv.slice(2);
  if (!requestPath) throw new Error('usage: build-derived-wav.mjs <request.json>');
  const request = JSON.parse(fs.readFileSync(path.resolve(requestPath), 'utf8'));
  process.stdout.write(`${JSON.stringify(buildSoundEffectDerivedWav(request), null, 2)}\n`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
