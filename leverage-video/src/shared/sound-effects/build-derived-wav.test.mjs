import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

import {buildSoundEffectDerivedWav} from './build-derived-wav.mjs';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

test('creates one immutable pre-trimmed stereo 44.1 kHz WAV without runtime transforms', (t) => {
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'derived-sfx-test-'));
  t.after(() => fs.rmSync(repositoryRoot, {recursive: true, force: true}));
  const sourceRelative = 'leverage-video/src/shared/sound-effects/assets/source.wav';
  const sourcePath = path.join(repositoryRoot, sourceRelative);
  fs.mkdirSync(path.dirname(sourcePath), {recursive: true});
  fs.copyFileSync(path.join(
    sourceRoot,
    'leverage-video/src/shared/sound-effects/assets/paper-slide-mixkit-1530.wav',
  ), sourcePath);
  const libraryValidation = {
    assets: [{
      asset_id: 'source', path: sourceRelative, checksum_sha256: 'unused',
      sample_rate_hz: 44100,
    }],
  };
  const outputPath = 'leverage-video/src/example/assets/audio/sfx/reveal.wav';
  const derived = buildSoundEffectDerivedWav({
    repositoryRoot,
    episodeWorkspace: 'leverage-video/src/example',
    assetId: 'source',
    outputPath,
    trimStartSample: 0,
    trimEndSample: 4410,
    libraryValidation,
  });
  assert.equal(derived.asset, 'example/assets/audio/sfx/reveal.wav');
  assert.equal(derived.sample_rate_hz, 44100);
  assert.equal(derived.channels, 2);
  assert.equal(derived.duration_in_frames, 3);
  assert.equal(derived.runtime_transform, 'forbidden');
  assert.throws(() => buildSoundEffectDerivedWav({
    repositoryRoot,
    episodeWorkspace: 'leverage-video/src/example',
    assetId: 'source',
    outputPath,
    trimStartSample: 0,
    trimEndSample: 4410,
    libraryValidation,
  }), /immutable and already exists/);
  assert.equal(fs.existsSync(`${path.join(repositoryRoot, outputPath)}.tmp-${process.pid}.wav`), false);
});
