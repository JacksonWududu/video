import {
  loadStyleCatalog,
  materializeStyleProfile,
} from '../scripts/style-catalog-lib.mjs';

const catalog = await loadStyleCatalog();

export const FIXTURE_STYLE_PROFILE = Object.freeze(
  materializeStyleProfile(catalog, 'childrens-picture-book-paper'),
);

export const createMotionDirectionFixture = (overrides = {}) => ({
  schemaVersion: 1,
  summary:
    'Establish the paper world, perform one legible story action, then settle into a readable final composition.',
  pacing: 'gentle',
  performance: {
    grammar: ['establish', 'action', 'settle'],
    anticipation: 'selective',
    followThrough: 'selective',
    poseStrategy: 'mixed',
    minimumFinalHoldRatio: 0.1,
  },
  camera: {strategy: 'motivated'},
  transitions: {strategy: 'story-led'},
  ambient: {strategy: 'selective'},
  styleDeviationRationale: null,
  ...overrides,
});
