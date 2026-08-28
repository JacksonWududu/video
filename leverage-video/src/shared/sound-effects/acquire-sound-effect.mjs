#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import {constants as fsConstants} from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  SHARED_SOUND_EFFECT_LIBRARY_INDEX_PATH,
  SHARED_SOUND_EFFECT_LIBRARY_VERSION,
  loadAndValidateSharedSoundEffectLibrary,
} from './contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPOSITORY_ROOT = path.resolve(HERE, '../../../..');
const SHA256 = /^[a-f0-9]{64}$/;
const ASSET_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PROVIDERS = Object.freeze({
  Mixkit: {
    itemHosts: new Set(['mixkit.co', 'www.mixkit.co']),
    downloadHosts: new Set(['assets.mixkit.co']),
  },
  Pixabay: {
    itemHosts: new Set(['pixabay.com', 'www.pixabay.com']),
    downloadHosts: new Set(['cdn.pixabay.com']),
  },
});

const sha256Bytes = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

const requireOfficialUrl = (raw, hosts, label) => {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${label} must be an official HTTPS URL`);
  }
  if (parsed.protocol !== 'https:' || !hosts.has(parsed.hostname)) {
    throw new Error(`${label} host is not approved`);
  }
  return parsed;
};

const validateRequest = (request) => {
  const providerPolicy = PROVIDERS[request?.provider];
  if (!providerPolicy) throw new Error('provider must be Mixkit or Pixabay');
  if (!ASSET_ID.test(request.asset_id ?? '')
      || typeof request.source_item_id !== 'string' || request.source_item_id === ''
      || typeof request.title !== 'string' || request.title === ''
      || !Array.isArray(request.semantic_roles) || request.semantic_roles.length < 1
      || request.semantic_roles.some((role) => typeof role !== 'string' || role === '')
      || new Set(request.semantic_roles).size !== request.semantic_roles.length
      || typeof request.timbre_family !== 'string' || request.timbre_family === '') {
    throw new Error('asset identity and semantic metadata are invalid');
  }
  const itemUrl = requireOfficialUrl(
    request.source_item_url,
    providerPolicy.itemHosts,
    'source_item_url',
  );
  const licenseUrl = requireOfficialUrl(
    request.license_url,
    providerPolicy.itemHosts,
    'license_url',
  );
  const downloadUrl = requireOfficialUrl(
    request.source_download_url,
    providerPolicy.downloadHosts,
    'source_download_url',
  );
  if (request.commercial_use !== true || request.cross_platform !== true
      || request.attribution_required !== false
      || typeof request.license_verified_at !== 'string' || request.license_verified_at === ''
      || typeof request.license_observation !== 'string' || request.license_observation === ''
      || !Array.isArray(request.license_page_required_phrases)
      || request.license_page_required_phrases.length < 2
      || request.license_page_required_phrases.some(
        (phrase) => typeof phrase !== 'string' || phrase.trim() === '',
      )) {
    throw new Error('license evidence must prove live cross-platform commercial no-attribution use');
  }
  const extension = path.extname(downloadUrl.pathname).slice(1).toLowerCase();
  if (!['wav', 'mp3'].includes(extension)) throw new Error('download must be an official WAV or MP3');
  return {providerPolicy, itemUrl, licenseUrl, downloadUrl, extension};
};

const fetchWithTimeout = async (fetchImpl, url) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    return await fetchImpl(url, {redirect: 'follow', signal: controller.signal});
  } finally {
    clearTimeout(timeout);
  }
};

const assertOfficialPage = async (fetchImpl, url, allowedHosts, label) => {
  const response = await fetchWithTimeout(fetchImpl, url);
  if (!response.ok) throw new Error(`${label} is unavailable: HTTP ${response.status}`);
  requireOfficialUrl(response.url || url, allowedHosts, `${label} final URL`);
  return response;
};

const probeAudio = (filePath) => {
  const probe = spawnSync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'a:0',
    '-show_entries', 'stream=codec_name,sample_rate,channels:format=duration',
    '-of', 'json',
    filePath,
  ], {encoding: 'utf8'});
  if (probe.status !== 0) {
    throw new Error(`ffprobe failed for downloaded sound effect: ${probe.stderr || 'unavailable'}`);
  }
  const value = JSON.parse(probe.stdout);
  const stream = value.streams?.[0];
  const duration = Number(value.format?.duration);
  const sampleRate = Number(stream?.sample_rate);
  const channels = Number(stream?.channels);
  if (!stream || !Number.isFinite(duration) || duration <= 0
      || !Number.isInteger(sampleRate) || sampleRate <= 0
      || !Number.isInteger(channels) || channels < 1 || channels > 2) {
    throw new Error('downloaded sound effect has unsupported audio metadata');
  }
  return {
    codec: stream.codec_name,
    sample_rate_hz: sampleRate,
    channels,
    duration_seconds: duration,
  };
};

const resolveRepositoryPath = (repositoryRoot, rootRelativePath) => {
  const resolved = path.resolve(repositoryRoot, rootRelativePath);
  const relative = path.relative(repositoryRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('path escapes repository');
  return resolved;
};

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, 'utf8'));

export const acquireSoundEffect = async ({
  request,
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
  fetchImpl = globalThis.fetch,
  probeImpl = probeAudio,
  now = () => new Date().toISOString(),
} = {}) => {
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is unavailable');
  const {providerPolicy, itemUrl, licenseUrl, downloadUrl, extension} = validateRequest(request);
  const current = loadAndValidateSharedSoundEffectLibrary({repositoryRoot});
  if (current.assets.some(({asset_id: id}) => id === request.asset_id)) {
    throw new Error('asset_id already exists in the active sound-effect library');
  }
  const existingRole = request.semantic_roles.find((role) => current.assets.some(
    ({semantic_roles: roles}) => roles.includes(role),
  ));
  if (existingRole) throw new Error(`semantic role already available: ${existingRole}`);

  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-video-sfx-'));
  let finalAssetPath = null;
  let finalManifestPath = null;
  let temporaryIndexPath = null;
  let indexPath = null;
  let originalIndexBytes = null;
  let indexPublished = false;
  let validated = false;
  try {
    const itemPage = await assertOfficialPage(
      fetchImpl, itemUrl.href, providerPolicy.itemHosts, 'official item page',
    );
    const itemBody = (await itemPage.text()).toLowerCase();
    if (!itemBody.includes(request.source_item_id.toLowerCase())) {
      throw new Error('official item page does not contain the requested source item id');
    }
    const licensePage = await assertOfficialPage(
      fetchImpl, licenseUrl.href, providerPolicy.itemHosts, 'official license page',
    );
    const licenseBody = (await licensePage.text()).toLowerCase();
    if (request.license_page_required_phrases.some(
      (phrase) => !licenseBody.includes(phrase.toLowerCase()),
    )) {
      throw new Error('official license page does not contain the recorded live terms');
    }
    const response = await fetchWithTimeout(fetchImpl, downloadUrl.href);
    if (!response.ok) throw new Error(`sound-effect download failed: HTTP ${response.status}`);
    requireOfficialUrl(
      response.url || downloadUrl.href,
      providerPolicy.downloadHosts,
      'download final URL',
    );
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0) throw new Error('downloaded sound effect is empty');
    const checksumSha256 = sha256Bytes(bytes);
    if (current.assets.some(({checksum_sha256: checksum}) => checksum === checksumSha256)) {
      throw new Error('downloaded sound effect duplicates an immutable library source');
    }
    const temporaryAsset = path.join(temporaryDirectory, `${request.asset_id}.${extension}`);
    await fs.writeFile(temporaryAsset, bytes, {flag: 'wx'});
    const media = probeImpl(temporaryAsset);

    indexPath = resolveRepositoryPath(repositoryRoot, SHARED_SOUND_EFFECT_LIBRARY_INDEX_PATH);
    originalIndexBytes = await fs.readFile(indexPath);
    const index = await readJson(indexPath);
    if (index.active_manifest.path !== current.manifest.path
        || index.active_manifest.checksum_sha256 !== current.manifest.checksum_sha256) {
      throw new Error('active sound-effect library changed during acquisition');
    }
    const nextRevision = Math.max(...index.manifests.map(({catalog_revision}) => catalog_revision)) + 1;
    const finalAssetRootRelative = `leverage-video/src/shared/sound-effects/assets/${request.asset_id}.${extension}`;
    finalAssetPath = resolveRepositoryPath(repositoryRoot, finalAssetRootRelative);
    finalManifestPath = resolveRepositoryPath(
      repositoryRoot,
      `leverage-video/src/shared/sound-effects/manifest-v${nextRevision}.json`,
    );
    await fs.access(finalAssetPath).then(
      () => { throw new Error('target sound-effect asset already exists'); },
      () => {},
    );
    await fs.access(finalManifestPath).then(
      () => { throw new Error('target sound-effect manifest already exists'); },
      () => {},
    );

    const addition = {
      asset_id: request.asset_id,
      source_item_id: request.source_item_id,
      title: request.title,
      semantic_roles: request.semantic_roles,
      timbre_family: request.timbre_family,
      path: finalAssetRootRelative,
      checksum_sha256: checksumSha256,
      provider: request.provider,
      source_item_url: itemUrl.href,
      source_download_url: downloadUrl.href,
      license_observation: {
        verified_at: request.license_verified_at,
        license_url: licenseUrl.href,
        commercial_use: true,
        cross_platform: true,
        attribution_required: false,
        observation: request.license_observation,
        verified_phrases: request.license_page_required_phrases,
      },
      format: extension,
      codec: media.codec,
      sample_rate_hz: media.sample_rate_hz,
      channels: media.channels,
      duration_seconds: media.duration_seconds,
      byte_size: bytes.length,
      downloaded_at: now(),
    };
    const manifest = {
      contract_version: SHARED_SOUND_EFFECT_LIBRARY_VERSION,
      catalog_revision: nextRevision,
      status: 'active',
      created_at: now(),
      parent_manifest: structuredClone(index.active_manifest),
      semantic_profiles: [],
      additions: [addition],
    };
    const manifestBytes = jsonBytes(manifest);
    const manifestChecksum = sha256Bytes(manifestBytes);
    const manifestRootRelative = `leverage-video/src/shared/sound-effects/manifest-v${nextRevision}.json`;
    const nextIndex = {
      ...index,
      active_manifest: {path: manifestRootRelative, checksum_sha256: manifestChecksum},
      manifests: [
        ...index.manifests.map((item) => ({
          ...item,
          status: item.status === 'active' ? 'legacy_read_only' : item.status,
        })),
        {
          path: manifestRootRelative,
          checksum_sha256: manifestChecksum,
          catalog_revision: nextRevision,
          status: 'active',
        },
      ],
    };

    await fs.copyFile(temporaryAsset, finalAssetPath, fsConstants.COPYFILE_EXCL);
    await fs.writeFile(finalManifestPath, manifestBytes, {flag: 'wx'});
    temporaryIndexPath = path.join(
      path.dirname(indexPath),
      `.library-index-${process.pid}-${Date.now()}.json`,
    );
    await fs.writeFile(temporaryIndexPath, jsonBytes(nextIndex), {flag: 'wx'});
    await fs.rename(temporaryIndexPath, indexPath);
    temporaryIndexPath = null;
    indexPublished = true;
    const validation = loadAndValidateSharedSoundEffectLibrary({repositoryRoot});
    if (validation.manifest.path !== manifestRootRelative
        || validation.manifest.checksum_sha256 !== manifestChecksum
        || !validation.assets.some(({asset_id}) => asset_id === request.asset_id)) {
      throw new Error('published sound-effect library revision failed validation');
    }
    validated = true;
    return {
      contract_version: 'shared-sound-effect-acquisition-v1',
      result: 'pass',
      temporary_directory_cleaned: true,
      manifest: validation.manifest,
      asset: validation.assets.find(({asset_id}) => asset_id === request.asset_id),
    };
  } catch (error) {
    if (!validated) {
      if (indexPublished && indexPath && originalIndexBytes) {
        const rollbackIndex = path.join(
          path.dirname(indexPath),
          `.library-index-rollback-${process.pid}-${Date.now()}.json`,
        );
        try {
          await fs.writeFile(rollbackIndex, originalIndexBytes, {flag: 'wx'});
          await fs.rename(rollbackIndex, indexPath);
          indexPublished = false;
        } finally {
          await fs.rm(rollbackIndex, {force: true});
        }
      }
      if (!indexPublished) {
        if (finalManifestPath) await fs.rm(finalManifestPath, {force: true});
        if (finalAssetPath) await fs.rm(finalAssetPath, {force: true});
      }
    }
    throw error;
  } finally {
    if (temporaryIndexPath) await fs.rm(temporaryIndexPath, {force: true});
    await fs.rm(temporaryDirectory, {recursive: true, force: true});
  }
};

const main = async () => {
  const [requestPath] = process.argv.slice(2);
  if (!requestPath) throw new Error('usage: acquire-sound-effect.mjs <request.json>');
  const resolved = path.isAbsolute(requestPath)
    ? requestPath
    : resolveRepositoryPath(DEFAULT_REPOSITORY_ROOT, requestPath);
  const request = await readJson(resolved);
  const result = await acquireSoundEffect({request});
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`acquire-sound-effect failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
