import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

import {
  LEGACY_SHARED_SOUND_EFFECT_LIBRARY_PATH,
  SHARED_SOUND_EFFECT_LIBRARY_INDEX_PATH,
  SHARED_SOUND_EFFECT_LIBRARY_PATH,
  SHARED_SOUND_EFFECT_LIBRARY_PATHS,
  isSharedSoundEffectLibraryManifestPath,
} from './paths.mjs';

export {
  LEGACY_SHARED_SOUND_EFFECT_LIBRARY_PATH,
  SHARED_SOUND_EFFECT_LIBRARY_INDEX_PATH,
  SHARED_SOUND_EFFECT_LIBRARY_PATH,
  SHARED_SOUND_EFFECT_LIBRARY_PATHS,
  isSharedSoundEffectLibraryManifestPath,
};

export const LEGACY_SHARED_SOUND_EFFECT_LIBRARY_VERSION = 'shared-sound-effect-library-v1';
export const SHARED_SOUND_EFFECT_LIBRARY_VERSION = 'shared-sound-effect-library-v2';
export const SHARED_SOUND_EFFECT_LIBRARY_INDEX_VERSION = 'shared-sound-effect-library-index-v1';

const SHA256 = /^[a-f0-9]{64}$/;
const ALLOWED_PROVIDERS = new Set(['Mixkit', 'Pixabay']);
const ALLOWED_FORMATS = new Set(['wav', 'mp3']);
const PROVIDER_HOSTS = Object.freeze({
  Mixkit: {
    item: new Set(['mixkit.co', 'www.mixkit.co']),
    download: new Set(['assets.mixkit.co']),
  },
  Pixabay: {
    item: new Set(['pixabay.com', 'www.pixabay.com']),
    download: new Set(['cdn.pixabay.com']),
  },
});
const MEDIA_PROBE_CACHE = new Map();

export const sha256SoundEffectFile = (filePath) => crypto
  .createHash('sha256')
  .update(fs.readFileSync(filePath))
  .digest('hex');

const fail = (message) => {
  throw new Error(message);
};

const resolveRootRelative = (repositoryRoot, rootRelativePath, label) => {
  if (typeof rootRelativePath !== 'string' || rootRelativePath === ''
      || path.isAbsolute(rootRelativePath)
      || rootRelativePath.replaceAll('\\', '/').split('/').includes('..')) {
    fail(`${label} must be repository-root-relative`);
  }
  const resolved = path.resolve(repositoryRoot, rootRelativePath);
  const relative = path.relative(repositoryRoot, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    fail(`${label} escapes the repository`);
  }
  return resolved;
};

const readJson = (filePath, label) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(`${label} is not readable JSON: ${error.message}`);
  }
};

const validateLibraryIndex = (repositoryRoot) => {
  const indexPath = resolveRootRelative(
    repositoryRoot,
    SHARED_SOUND_EFFECT_LIBRARY_INDEX_PATH,
    'sound-effect library index path',
  );
  const index = readJson(indexPath, 'sound-effect library index');
  if (index.contract_version !== SHARED_SOUND_EFFECT_LIBRARY_INDEX_VERSION
      || !Array.isArray(index.manifests) || index.manifests.length < 1) {
    fail('sound-effect library index is invalid');
  }
  const paths = new Set();
  const revisions = new Set();
  for (const [position, binding] of index.manifests.entries()) {
    if (typeof binding?.path !== 'string' || !SHA256.test(binding?.checksum_sha256 ?? '')
        || !Number.isInteger(binding?.catalog_revision) || binding.catalog_revision < 1
        || !['active', 'legacy_read_only'].includes(binding?.status)
        || paths.has(binding.path) || revisions.has(binding.catalog_revision)) {
      fail(`sound-effect library index manifests[${position}] is invalid`);
    }
    const manifestPath = resolveRootRelative(repositoryRoot, binding.path, `manifests[${position}].path`);
    if (sha256SoundEffectFile(manifestPath) !== binding.checksum_sha256) {
      fail(`sound-effect library index checksum mismatch: ${binding.path}`);
    }
    paths.add(binding.path);
    revisions.add(binding.catalog_revision);
  }
  const active = index.manifests.find(({status}) => status === 'active');
  if (!active || index.manifests.filter(({status}) => status === 'active').length !== 1
      || active.path !== index.active_manifest?.path
      || active.checksum_sha256 !== index.active_manifest?.checksum_sha256) {
    fail('sound-effect library index active manifest is inconsistent');
  }
  return {index, active, byPath: new Map(index.manifests.map((item) => [item.path, item]))};
};

const validateLicenseObservation = (value, label) => {
  if (!value || typeof value !== 'object'
      || value.commercial_use !== true
      || value.cross_platform !== true
      || value.attribution_required !== false
      || typeof value.verified_at !== 'string' || value.verified_at === ''
      || typeof value.license_url !== 'string' || !value.license_url.startsWith('https://')
      || !Array.isArray(value.verified_phrases) || value.verified_phrases.length < 2
      || value.verified_phrases.some((phrase) => typeof phrase !== 'string' || phrase === '')) {
    fail(`${label} must prove current cross-platform commercial no-attribution use`);
  }
  return structuredClone(value);
};

const requireOfficialHttpsUrl = (value, hosts, label) => {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${label} must be an official HTTPS URL`);
  }
  if (parsed.protocol !== 'https:' || !hosts.has(parsed.hostname)) {
    fail(`${label} must use the provider's official host`);
  }
};

const validateAssetBytes = ({repositoryRoot, asset, label}) => {
  if (typeof asset.asset_id !== 'string' || asset.asset_id === ''
      || typeof asset.path !== 'string' || !SHA256.test(asset.checksum_sha256 ?? '')
      || !Number.isInteger(asset.byte_size) || asset.byte_size <= 0
      || !Number.isInteger(asset.sample_rate_hz) || asset.sample_rate_hz <= 0
      || !Number.isInteger(asset.channels) || asset.channels < 1 || asset.channels > 2
      || !ALLOWED_FORMATS.has(asset.format)
      || path.extname(asset.path).slice(1).toLowerCase() !== asset.format
      || (asset.format === 'wav' && !/^pcm_(?:s16|s24|s32|f32)le$/.test(asset.codec ?? ''))
      || (asset.format === 'mp3' && asset.codec !== 'mp3')
      || typeof asset.duration_seconds !== 'number' || asset.duration_seconds <= 0) {
    fail(`${label} metadata is unsupported`);
  }
  const assetPath = resolveRootRelative(repositoryRoot, asset.path, `${label}.path`);
  const status = fs.lstatSync(assetPath);
  if (!status.isFile() || status.isSymbolicLink() || status.size !== asset.byte_size
      || sha256SoundEffectFile(assetPath) !== asset.checksum_sha256) {
    fail(`${label} bytes are missing or stale`);
  }
  let observed = MEDIA_PROBE_CACHE.get(asset.checksum_sha256);
  if (!observed) {
    const probe = spawnSync('ffprobe', [
      '-v', 'error', '-select_streams', 'a:0',
      '-show_entries', 'stream=codec_name,sample_rate,channels:format=duration',
      '-of', 'json', assetPath,
    ], {encoding: 'utf8'});
    if (probe.status !== 0) fail(`${label} is not a probeable audio file`);
    const parsed = JSON.parse(probe.stdout);
    const stream = parsed.streams?.[0];
    observed = {
      codec: stream?.codec_name,
      sample_rate_hz: Number(stream?.sample_rate),
      channels: Number(stream?.channels),
      duration_seconds: Number(parsed.format?.duration),
    };
    MEDIA_PROBE_CACHE.set(asset.checksum_sha256, observed);
  }
  if (observed.codec !== asset.codec
      || observed.sample_rate_hz !== asset.sample_rate_hz
      || observed.channels !== asset.channels
      || !Number.isFinite(observed.duration_seconds)
      || Math.abs(observed.duration_seconds - asset.duration_seconds) > 0.001) {
    fail(`${label} probed media differs from the manifest metadata`);
  }
};

const materializeManifest = ({repositoryRoot, manifestPath, expectedSha256, index, seen}) => {
  const binding = index.byPath.get(manifestPath);
  if (!binding) fail('sound-effect manifest path is not registered');
  if (seen.has(manifestPath)) fail('sound-effect manifest ancestry is cyclic');
  const nextSeen = new Set(seen).add(manifestPath);
  const resolvedPath = resolveRootRelative(repositoryRoot, manifestPath, 'sound-effect manifest path');
  const manifestSha256 = sha256SoundEffectFile(resolvedPath);
  if (manifestSha256 !== binding.checksum_sha256
      || (expectedSha256 !== null && expectedSha256 !== manifestSha256)) {
    fail('sound-effect manifest checksum mismatch');
  }
  const manifest = readJson(resolvedPath, 'sound-effect manifest');
  if (manifest.contract_version === LEGACY_SHARED_SOUND_EFFECT_LIBRARY_VERSION) {
    if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) {
      fail('legacy shared sound-effect library manifest is invalid');
    }
    const observedTerms = new Set(manifest.license_observation?.observed_terms ?? []);
    const normalizedLicense = observedTerms.has('commercial_and_personal_project_use')
      && observedTerms.has('attribution_not_required')
      ? {
          verified_at: manifest.last_extended_at ?? manifest.downloaded_at,
          license_url: manifest.license_observation.license_url,
          commercial_use: true,
          cross_platform: true,
          attribution_required: false,
          observation: manifest.license_observation.note,
        }
      : null;
    return {
      manifest,
      manifestSha256,
      assets: manifest.assets.map((asset) => ({
        ...structuredClone(asset),
        semantic_roles: [],
        timbre_family: null,
        provider: manifest.provider ?? null,
        source_item_url: asset.source_category_url ?? null,
        source_download_url: asset.source_download_url ?? null,
        license_url: manifest.license_observation?.license_url ?? null,
        license_observation: normalizedLicense,
      })),
    };
  }
  if (manifest.contract_version !== SHARED_SOUND_EFFECT_LIBRARY_VERSION
      || !Number.isInteger(manifest.catalog_revision)
      || manifest.catalog_revision !== binding.catalog_revision
      || typeof manifest.parent_manifest?.path !== 'string'
      || !SHA256.test(manifest.parent_manifest?.checksum_sha256 ?? '')
      || !Array.isArray(manifest.semantic_profiles)
      || !Array.isArray(manifest.additions)) {
    fail('shared sound-effect library v2 manifest is invalid');
  }
  const parent = materializeManifest({
    repositoryRoot,
    manifestPath: manifest.parent_manifest.path,
    expectedSha256: manifest.parent_manifest.checksum_sha256,
    index,
    seen: nextSeen,
  });
  const profiles = new Map();
  for (const [position, profile] of manifest.semantic_profiles.entries()) {
    if (typeof profile?.asset_id !== 'string' || profiles.has(profile.asset_id)
        || !Array.isArray(profile.semantic_roles) || profile.semantic_roles.length < 1
        || profile.semantic_roles.some((role) => typeof role !== 'string' || role === '')
        || typeof profile.timbre_family !== 'string' || profile.timbre_family === '') {
      fail(`semantic_profiles[${position}] is invalid`);
    }
    profiles.set(profile.asset_id, structuredClone(profile));
  }
  const assets = parent.assets.map((asset) => {
    const profile = profiles.get(asset.asset_id);
    return profile ? {...asset, ...profile} : asset;
  });
  for (const [position, addition] of manifest.additions.entries()) {
    if (!ALLOWED_PROVIDERS.has(addition?.provider)
        || typeof addition?.source_item_id !== 'string' || addition.source_item_id === ''
        || typeof addition?.source_item_url !== 'string'
        || typeof addition?.source_download_url !== 'string'
        || !addition.source_item_url.startsWith('https://')
        || !addition.source_download_url.startsWith('https://')
        || !Array.isArray(addition?.semantic_roles) || addition.semantic_roles.length < 1
        || addition.semantic_roles.some((role) => typeof role !== 'string' || role === '')
        || typeof addition?.timbre_family !== 'string' || addition.timbre_family === '') {
      fail(`additions[${position}] source or semantics are invalid`);
    }
    const providerHosts = PROVIDER_HOSTS[addition.provider];
    requireOfficialHttpsUrl(
      addition.source_item_url,
      providerHosts.item,
      `additions[${position}].source_item_url`,
    );
    requireOfficialHttpsUrl(
      addition.source_download_url,
      providerHosts.download,
      `additions[${position}].source_download_url`,
    );
    const licenseObservation = validateLicenseObservation(
      addition.license_observation,
      `additions[${position}].license_observation`,
    );
    requireOfficialHttpsUrl(
      licenseObservation.license_url,
      providerHosts.item,
      `additions[${position}].license_observation.license_url`,
    );
    assets.push({...structuredClone(addition), license_observation: licenseObservation});
  }
  if (manifest.status === 'active' && assets.some(({semantic_roles}) => semantic_roles.length < 1)) {
    fail('active shared sound-effect library has unclassified assets');
  }
  return {manifest, manifestSha256, assets};
};

export const loadAndValidateSharedSoundEffectLibrary = ({
  repositoryRoot,
  manifestPath: requestedManifestPath = null,
  expectedManifestSha256 = null,
} = {}) => {
  if (typeof repositoryRoot !== 'string' || repositoryRoot === '') fail('repositoryRoot is required');
  const index = validateLibraryIndex(repositoryRoot);
  const selectedManifestPath = requestedManifestPath ?? index.active.path;
  const materialized = materializeManifest({
    repositoryRoot,
    manifestPath: selectedManifestPath,
    expectedSha256: expectedManifestSha256,
    index,
    seen: new Set(),
  });
  const ids = new Set();
  const paths = new Set();
  const checksums = new Set();
  const assets = materialized.assets.map((asset, position) => {
    const label = `sound-effect assets[${position}]`;
    if (ids.has(asset.asset_id) || paths.has(asset.path)
        || checksums.has(asset.checksum_sha256)) {
      fail(`${label} id/path/checksum must be unique`);
    }
    validateAssetBytes({repositoryRoot, asset, label});
    ids.add(asset.asset_id);
    paths.add(asset.path);
    checksums.add(asset.checksum_sha256);
    return {
      asset_id: asset.asset_id,
      title: asset.title ?? asset.asset_id,
      path: asset.path,
      checksum_sha256: asset.checksum_sha256,
      byte_size: asset.byte_size,
      format: asset.format,
      sample_rate_hz: asset.sample_rate_hz,
      channels: asset.channels,
      duration_seconds: asset.duration_seconds,
      semantic_roles: structuredClone(asset.semantic_roles),
      timbre_family: asset.timbre_family,
      provider: asset.provider ?? null,
      source_item_id: asset.source_item_id ?? null,
      source_item_url: asset.source_item_url ?? null,
      source_download_url: asset.source_download_url ?? null,
      license_url: asset.license_observation?.license_url ?? asset.license_url ?? null,
      license_observation: asset.license_observation ?? null,
    };
  });
  return {
    contract_version: 'shared-sound-effect-library-validation-v2',
    result: 'pass',
    index: {
      path: SHARED_SOUND_EFFECT_LIBRARY_INDEX_PATH,
      active_manifest: structuredClone(index.active),
    },
    manifest: {path: selectedManifestPath, checksum_sha256: materialized.manifestSha256},
    catalog_revision: materialized.manifest.catalog_revision ?? 1,
    asset_count: assets.length,
    assets,
  };
};
