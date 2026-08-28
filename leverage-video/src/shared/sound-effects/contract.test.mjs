import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

import {
  LEGACY_SHARED_SOUND_EFFECT_LIBRARY_PATH,
  loadAndValidateSharedSoundEffectLibrary,
} from './contract.mjs';
import {IAN_ENTRY_SOUND_PROFILES} from '../ian-layered-entry-effects/runtime.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

test('current shared sound-effect library binds every downloaded source byte', () => {
  const result = loadAndValidateSharedSoundEffectLibrary({repositoryRoot: root});
  assert.equal(result.contract_version, 'shared-sound-effect-library-validation-v2');
  assert.equal(result.result, 'pass');
  assert.equal(result.manifest.path, 'leverage-video/src/shared/sound-effects/manifest-v24.json');
  assert.equal(result.index.active_manifest.status, 'active');
  assert.equal(result.asset_count, 42);
  assert.equal(result.assets.length, 42);
  assert.equal(result.assets.every(({semantic_roles}) => semantic_roles.length > 0), true);
});

test('current semantic library includes every locked Ian cue role as an exact role', () => {
  const result = loadAndValidateSharedSoundEffectLibrary({repositoryRoot: root});
  for (const profile of Object.values(IAN_ENTRY_SOUND_PROFILES)) {
    const asset = result.assets.find(({asset_id: assetId}) => assetId === profile.sound_asset_id);
    assert.ok(asset, `missing Ian sound asset: ${profile.sound_asset_id}`);
    assert.ok(
      asset.semantic_roles.includes(profile.sound_role),
      `missing Ian semantic role ${profile.sound_role} on ${profile.sound_asset_id}`,
    );
  }
});

test('legacy shared sound-effect library remains checksum-valid and immutable', () => {
  const result = loadAndValidateSharedSoundEffectLibrary({
    repositoryRoot: root,
    manifestPath: LEGACY_SHARED_SOUND_EFFECT_LIBRARY_PATH,
    expectedManifestSha256: 'b3fca6c32bf1455000a100cab527e6fc75198084ae874d98ab3bed0045358abf',
  });
  assert.equal(result.asset_count, 12);
  assert.equal(result.manifest.path, LEGACY_SHARED_SOUND_EFFECT_LIBRARY_PATH);
});

test('shared sound-effect library rejects a stale manifest checksum', () => {
  assert.throws(() => loadAndValidateSharedSoundEffectLibrary({
    repositoryRoot: root,
    expectedManifestSha256: '0'.repeat(64),
  }), /manifest checksum/);
});

test('shared sound-effect library rejects an unregistered manifest path', () => {
  assert.throws(() => loadAndValidateSharedSoundEffectLibrary({
    repositoryRoot: root,
    manifestPath: 'leverage-video/src/shared/sound-effects/other.json',
  }), /not registered/);
});

test('registered historical manifest bytes cannot be rewritten', (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sound-manifest-test-'));
  t.after(() => fs.rmSync(temporaryRoot, {recursive: true, force: true}));
  const target = path.join(temporaryRoot, 'leverage-video/src/shared/sound-effects');
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.cpSync(path.join(root, 'leverage-video/src/shared/sound-effects'), target, {recursive: true});
  fs.appendFileSync(path.join(target, 'manifest-v2.json'), '\n');
  assert.throws(() => loadAndValidateSharedSoundEffectLibrary({
    repositoryRoot: temporaryRoot,
  }), /index checksum mismatch/);
});
