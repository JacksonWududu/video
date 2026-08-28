export const LEGACY_SHARED_SOUND_EFFECT_LIBRARY_PATH = 'leverage-video/src/shared/sound-effects/manifest.json';
export const SHARED_SOUND_EFFECT_LIBRARY_INDEX_PATH = 'leverage-video/src/shared/sound-effects/library-index.json';
export const SHARED_SOUND_EFFECT_LIBRARY_PATH = 'leverage-video/src/shared/sound-effects/manifest-v24.json';
export const SHARED_SOUND_EFFECT_LIBRARY_PATHS = Object.freeze([
  LEGACY_SHARED_SOUND_EFFECT_LIBRARY_PATH,
  'leverage-video/src/shared/sound-effects/manifest-v2.json',
  'leverage-video/src/shared/sound-effects/manifest-v3.json',
  SHARED_SOUND_EFFECT_LIBRARY_PATH,
]);

export const isSharedSoundEffectLibraryManifestPath = (value) => (
  SHARED_SOUND_EFFECT_LIBRARY_PATHS.includes(value)
  || /^leverage-video\/src\/shared\/sound-effects\/manifest-v(?:[4-9]|[1-9][0-9]+)\.json$/.test(value)
);
