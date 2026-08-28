import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

import {acquireSoundEffect} from './acquire-sound-effect.mjs';
import {loadAndValidateSharedSoundEffectLibrary} from './contract.mjs';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

const buildWav = () => {
  const sampleFrames = 4410;
  const dataBytes = sampleFrames * 2 * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(44100, 24);
  buffer.writeUInt32LE(44100 * 4, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataBytes, 40);
  buffer.writeInt16LE(1, 44);
  return buffer;
};

const request = {
  provider: 'Mixkit',
  asset_id: 'test-verified-reveal-mixkit-9999',
  source_item_id: '9999',
  title: 'Verified reveal',
  semantic_roles: ['test_verified_reveal'],
  timbre_family: 'test',
  source_item_url: 'https://mixkit.co/free-sound-effects/transition/',
  license_url: 'https://mixkit.co/license/',
  source_download_url: 'https://assets.mixkit.co/active_storage/sfx/9999/9999.wav',
  commercial_use: true,
  cross_platform: true,
  attribution_required: false,
  license_verified_at: '2026-08-27T12:00:00Z',
  license_observation: 'Official pages confirmed commercial cross-platform use without attribution.',
  license_page_required_phrases: ['commercial use', 'attribution not required'],
};

const makeRepository = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sound-library-test-'));
  const target = path.join(root, 'leverage-video/src/shared/sound-effects');
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.cpSync(path.join(sourceRoot, 'leverage-video/src/shared/sound-effects'), target, {
    recursive: true,
  });
  for (const name of fs.readdirSync(target)) {
    if (name.endsWith('.test.mjs')) fs.rmSync(path.join(target, name));
  }
  return root;
};

const nextManifestName = (repositoryRoot) => {
  const index = JSON.parse(fs.readFileSync(path.join(
    repositoryRoot,
    'leverage-video/src/shared/sound-effects/library-index.json',
  ), 'utf8'));
  const nextRevision = Math.max(...index.manifests.map(({catalog_revision}) => catalog_revision)) + 1;
  return `manifest-v${nextRevision}.json`;
};

const makeFetch = (audioBytes, {failDownload = false} = {}) => async (url) => {
  const isDownload = String(url).includes('assets.mixkit.co');
  const isLicense = String(url).includes('/license/');
  return {
    ok: !(isDownload && failDownload),
    status: isDownload && failDownload ? 503 : 200,
    url: String(url),
    text: async () => isLicense
      ? 'Commercial use. Attribution not required.'
      : 'Official sound effect item 9999.',
    arrayBuffer: async () => audioBytes.buffer.slice(
      audioBytes.byteOffset,
      audioBytes.byteOffset + audioBytes.byteLength,
    ),
  };
};

test('acquires, probes, atomically publishes, and cleans its temporary paths', async (t) => {
  const repositoryRoot = makeRepository();
  t.after(() => fs.rmSync(repositoryRoot, {recursive: true, force: true}));
  const expectedManifestName = nextManifestName(repositoryRoot);
  const initialAssetCount = loadAndValidateSharedSoundEffectLibrary({repositoryRoot}).asset_count;
  const temporaryBefore = new Set(fs.readdirSync(os.tmpdir())
    .filter((name) => name.startsWith('knowledge-video-sfx-')));
  const result = await acquireSoundEffect({
    request,
    repositoryRoot,
    fetchImpl: makeFetch(buildWav()),
    probeImpl: () => ({
      codec: 'pcm_s16le', sample_rate_hz: 44100, channels: 2, duration_seconds: 0.1,
    }),
    now: () => '2026-08-27T12:00:00Z',
  });
  assert.equal(result.result, 'pass');
  assert.equal(result.temporary_directory_cleaned, true);
  assert.equal(result.manifest.path.endsWith(expectedManifestName), true);
  assert.equal(
    loadAndValidateSharedSoundEffectLibrary({repositoryRoot}).asset_count,
    initialAssetCount + 1,
  );
  const soundRoot = path.join(repositoryRoot, 'leverage-video/src/shared/sound-effects');
  assert.equal(fs.readdirSync(soundRoot).some((name) => name.startsWith('.library-index-')), false);
  const temporaryAfter = fs.readdirSync(os.tmpdir())
    .filter((name) => name.startsWith('knowledge-video-sfx-') && !temporaryBefore.has(name));
  assert.deepEqual(temporaryAfter, []);
});

test('download failure leaves the active index and library bytes unchanged', async (t) => {
  const repositoryRoot = makeRepository();
  t.after(() => fs.rmSync(repositoryRoot, {recursive: true, force: true}));
  const expectedManifestName = nextManifestName(repositoryRoot);
  const indexPath = path.join(
    repositoryRoot,
    'leverage-video/src/shared/sound-effects/library-index.json',
  );
  const before = fs.readFileSync(indexPath);
  await assert.rejects(() => acquireSoundEffect({
    request,
    repositoryRoot,
    fetchImpl: makeFetch(buildWav(), {failDownload: true}),
    probeImpl: () => {
      throw new Error('probe must not run');
    },
  }), /download failed/);
  assert.deepEqual(fs.readFileSync(indexPath), before);
  assert.equal(fs.existsSync(path.join(
    repositoryRoot,
    'leverage-video/src/shared/sound-effects',
    expectedManifestName,
  )), false);
});

test('post-publish invalid media validation rolls back the index, manifest, asset, and temp files', async (t) => {
  const repositoryRoot = makeRepository();
  t.after(() => fs.rmSync(repositoryRoot, {recursive: true, force: true}));
  const expectedManifestName = nextManifestName(repositoryRoot);
  const indexPath = path.join(
    repositoryRoot,
    'leverage-video/src/shared/sound-effects/library-index.json',
  );
  const before = fs.readFileSync(indexPath);
  await assert.rejects(() => acquireSoundEffect({
    request,
    repositoryRoot,
    fetchImpl: makeFetch(Buffer.from('not audio')),
    probeImpl: () => ({
      codec: 'pcm_s16le', sample_rate_hz: 44100, channels: 2, duration_seconds: 0.1,
    }),
  }), /not a probeable audio file/);
  assert.deepEqual(fs.readFileSync(indexPath), before);
  const soundRoot = path.dirname(indexPath);
  assert.equal(fs.existsSync(path.join(soundRoot, expectedManifestName)), false);
  assert.equal(fs.existsSync(path.join(soundRoot, 'assets', `${request.asset_id}.wav`)), false);
  assert.equal(fs.readdirSync(soundRoot).some((name) => name.startsWith('.library-index-')), false);
});

test('rejects byte-duplicate sources before publishing a new manifest', async (t) => {
  const repositoryRoot = makeRepository();
  t.after(() => fs.rmSync(repositoryRoot, {recursive: true, force: true}));
  const duplicate = fs.readFileSync(path.join(
    repositoryRoot,
    'leverage-video/src/shared/sound-effects/assets/paper-slide-mixkit-1530.wav',
  ));
  await assert.rejects(() => acquireSoundEffect({
    request,
    repositoryRoot,
    fetchImpl: makeFetch(duplicate),
    probeImpl: () => ({
      codec: 'pcm_s16le', sample_rate_hz: 44100, channels: 2, duration_seconds: 1,
    }),
  }), /duplicates an immutable library source/);
});

test('rejects non-official source and ambiguous license evidence before download', async () => {
  await assert.rejects(() => acquireSoundEffect({
    request: {...request, source_item_url: 'https://example.com/sound/9999'},
    repositoryRoot: sourceRoot,
    fetchImpl: makeFetch(buildWav()),
  }), /host is not approved/);
  await assert.rejects(() => acquireSoundEffect({
    request: {...request, commercial_use: false},
    repositoryRoot: sourceRoot,
    fetchImpl: makeFetch(buildWav()),
  }), /license evidence/);
});
