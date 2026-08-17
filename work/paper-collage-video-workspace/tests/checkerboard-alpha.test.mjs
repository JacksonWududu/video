import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import {
  BAKED_CHECKERBOARD_MODE,
  inspectBakedCheckerboardPixels,
  removeBakedCheckerboard,
} from '../scripts/checkerboard-alpha-lib.mjs';
import {composeDecorativeScatter} from '../scripts/decorative-scatter-lib.mjs';

const checkerFixture = async () => sharp(Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="240" height="160">
    <defs>
      <pattern id="checker" width="32" height="32" patternUnits="userSpaceOnUse">
        <rect width="16" height="16" fill="#f4f4f4"/>
        <rect x="16" width="16" height="16" fill="#fefefe"/>
        <rect y="16" width="16" height="16" fill="#fefefe"/>
        <rect x="16" y="16" width="16" height="16" fill="#f4f4f4"/>
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#checker)"/>
    <path d="M24 150 Q36 78 48 150 Z" fill="#4c8c43"/>
    <path d="M170 150 Q188 94 205 150 Z" fill="#d0aa35"/>
  </svg>
`)).png().toBuffer();

test('baked transparency checkerboards are observed and removed without another provider call', async () => {
  const fixture = await checkerFixture();
  const pixels = await sharp(fixture).removeAlpha().raw().toBuffer({
    resolveWithObject: true,
  });
  const inspection = inspectBakedCheckerboardPixels({
    data: pixels.data,
    width: pixels.info.width,
    height: pixels.info.height,
    channels: pixels.info.channels,
  });
  assert.equal(inspection.passed, true, JSON.stringify(inspection, null, 2));
  const result = await removeBakedCheckerboard({
    input: fixture,
    transparentDistance: 12,
    opaqueDistance: 36,
  });
  assert.equal(result.metadata.mode, BAKED_CHECKERBOARD_MODE);
  assert.ok(result.metadata.transparentPixels > 20_000);
  assert.ok(result.metadata.opaquePixels > 500);
  assert.equal((await sharp(result.buffer).metadata()).hasAlpha, true);
});

test('decorative scatter reuses isolated source regions with explicit reproducible transforms', async () => {
  const source = await sharp(Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
      <path d="M10 90 Q30 15 50 90 Z" fill="#347a43"/>
      <path d="M120 90 Q145 35 170 90 Z" fill="#d0aa35"/>
    </svg>
  `)).png().toBuffer();
  const input = {
    source,
    canvas: {width: 320, height: 120},
    regions: [
      {id: 'green', left: 0, top: 0, width: 70, height: 100},
      {id: 'yellow', left: 105, top: 0, width: 80, height: 100},
    ],
    placements: [
      {sourceId: 'yellow', x: 0.2, y: 1, scale: 0.7, rotation: -3, flipX: true, anchorX: 0.5, anchorY: 1},
      {sourceId: 'green', x: 0.75, y: 1, scale: 0.55, rotation: 4, flipX: false, anchorX: 0.5, anchorY: 1},
    ],
  };
  const first = await composeDecorativeScatter(input);
  const second = await composeDecorativeScatter(input);
  assert.deepEqual(first, second);
  const metadata = await sharp(first).metadata();
  assert.deepEqual(
    {width: metadata.width, height: metadata.height, hasAlpha: metadata.hasAlpha},
    {width: 320, height: 120, hasAlpha: true},
  );
});
