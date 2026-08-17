import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertLandscape16By9,
  coverGeometry,
} from './raster-contract.mjs';

test('computes deterministic centered scale-to-cover geometry', () => {
  assert.deepEqual(coverGeometry(2000, 1200), {
    scale: 0.96,
    resizedWidth: 1920,
    resizedHeight: 1152,
    cropLeft: 0,
    cropTop: 36,
    outputWidth: 1920,
    outputHeight: 1080,
  });
});

test('accepts 16:9 and rejects out-of-tolerance rasters', () => {
  assert.deepEqual(assertLandscape16By9(1920, 1080), {
    width: 1920,
    height: 1080,
    relativeAspectError: 0,
  });
  assert.throws(() => assertLandscape16By9(1600, 1000), /16:9 tolerance/);
});
