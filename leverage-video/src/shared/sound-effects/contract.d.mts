export const LEGACY_SHARED_SOUND_EFFECT_LIBRARY_PATH: 'leverage-video/src/shared/sound-effects/manifest.json';
export const SHARED_SOUND_EFFECT_LIBRARY_INDEX_PATH: 'leverage-video/src/shared/sound-effects/library-index.json';
export const SHARED_SOUND_EFFECT_LIBRARY_PATH: 'leverage-video/src/shared/sound-effects/manifest-v24.json';
export const SHARED_SOUND_EFFECT_LIBRARY_PATHS: readonly [
  'leverage-video/src/shared/sound-effects/manifest.json',
  'leverage-video/src/shared/sound-effects/manifest-v2.json',
  'leverage-video/src/shared/sound-effects/manifest-v3.json',
  'leverage-video/src/shared/sound-effects/manifest-v24.json',
];
export const SHARED_SOUND_EFFECT_LIBRARY_VERSION: 'shared-sound-effect-library-v2';
export const SHARED_SOUND_EFFECT_LIBRARY_INDEX_VERSION: 'shared-sound-effect-library-index-v1';
export function isSharedSoundEffectLibraryManifestPath(value: unknown): boolean;

export function loadAndValidateSharedSoundEffectLibrary(input: {
  repositoryRoot: string;
  manifestPath?: string;
  expectedManifestSha256?: string | null;
}): {
  contract_version: 'shared-sound-effect-library-validation-v2';
  result: 'pass';
  index: {
    path: typeof SHARED_SOUND_EFFECT_LIBRARY_INDEX_PATH;
    active_manifest: {
      path: string;
      checksum_sha256: string;
      catalog_revision: number;
      status: 'active';
    };
  };
  manifest: {path: string; checksum_sha256: string};
  catalog_revision: number;
  asset_count: number;
  assets: readonly {
    asset_id: string;
    path: string;
    checksum_sha256: string;
    byte_size: number;
    format: 'wav' | 'mp3';
    sample_rate_hz: number;
    channels: 1 | 2;
    duration_seconds: number;
    semantic_roles: readonly string[];
    timbre_family: string | null;
    provider: string | null;
    source_item_id: string | null;
    source_item_url: string | null;
    source_download_url: string | null;
    license_url: string | null;
  }[];
};
