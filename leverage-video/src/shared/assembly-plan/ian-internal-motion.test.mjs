import assert from 'node:assert/strict';
import test from 'node:test';

import {
  IAN_STATIC_FULL_FRAME_CONTRACT,
  IAN_SUBTLE_RASTER_MOTION_CONTRACT,
  validateIanSceneMotion,
} from './ian-internal-motion.mjs';

const subtleMotion = (overrides = {}) => ({
  mode: 'single_segment',
  start: {scale: 1, x_px: 0, y_px: 0},
  end: {scale: 1.04, x_px: 30, y_px: -18},
  easing: 'ease-in-out',
  origin: 'center',
  ...overrides,
});

test('keeps Ian static unless an exact subtle raster plan is present', () => {
  assert.deepEqual(validateIanSceneMotion({
    shotId: 'S02',
    internalMotionContract: IAN_STATIC_FULL_FRAME_CONTRACT,
    internalMotion: null,
  }), {
    internal_motion_contract: IAN_STATIC_FULL_FRAME_CONTRACT,
    internal_motion: null,
  });
  assert.throws(() => validateIanSceneMotion({
    shotId: 'S02',
    internalMotionContract: IAN_SUBTLE_RASTER_MOTION_CONTRACT,
    internalMotion: null,
  }), /exact internal_motion plan/i);
});

test('accepts one exact Ian scale-and-translate segment within the 5% overscan envelope', () => {
  const motion = subtleMotion();
  assert.deepEqual(validateIanSceneMotion({
    shotId: 'S02',
    internalMotionContract: IAN_SUBTLE_RASTER_MOTION_CONTRACT,
    internalMotion: motion,
  }), {
    internal_motion_contract: IAN_SUBTLE_RASTER_MOTION_CONTRACT,
    internal_motion: motion,
  });
});

test('rejects zoom, translation, delta, or shape drift outside the Ian subtle contract', () => {
  assert.throws(() => validateIanSceneMotion({
    shotId: 'S02',
    internalMotionContract: IAN_SUBTLE_RASTER_MOTION_CONTRACT,
    internalMotion: subtleMotion({end: {scale: 1.051, x_px: 0, y_px: 0}}),
  }), /scale.*1\.000.*1\.050/i);
  assert.throws(() => validateIanSceneMotion({
    shotId: 'S02',
    internalMotionContract: IAN_SUBTLE_RASTER_MOTION_CONTRACT,
    internalMotion: subtleMotion({end: {scale: 1.01, x_px: 10, y_px: 0}}),
  }), /overscan envelope/i);
  assert.throws(() => validateIanSceneMotion({
    shotId: 'S02',
    internalMotionContract: IAN_SUBTLE_RASTER_MOTION_CONTRACT,
    internalMotion: subtleMotion({
      start: {scale: 1.05, x_px: -48, y_px: 0},
      end: {scale: 1.05, x_px: 48, y_px: 0},
    }),
  }), /total x change.*48/i);
  assert.throws(() => validateIanSceneMotion({
    shotId: 'S02',
    internalMotionContract: IAN_SUBTLE_RASTER_MOTION_CONTRACT,
    internalMotion: {...subtleMotion(), rotation: 1},
  }), /exact keys/i);
});

test('requires an identity start for S01 so OPEN-00 retains sole entry ownership', () => {
  assert.throws(() => validateIanSceneMotion({
    shotId: 'S01',
    internalMotionContract: IAN_SUBTLE_RASTER_MOTION_CONTRACT,
    internalMotion: subtleMotion({start: {scale: 1.01, x_px: 0, y_px: 0}}),
  }), /S01.*identity/i);
});
