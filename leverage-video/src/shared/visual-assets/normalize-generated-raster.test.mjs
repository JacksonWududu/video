import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

import sharp from 'sharp';

import {normalizeGeneratedRaster} from './normalize-generated-raster.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(HERE, '../../../..');

test('creates a missing normalized-output directory and safely reuses an exact source archive', async () => {
  const temporary = fs.mkdtempSync(path.join(HERE, '.tmp-normalize-'));
  try {
    const source = path.join(temporary, 'source.png');
    await sharp({
      create: {
        width: 160,
        height: 90,
        channels: 3,
        background: {r: 240, g: 235, b: 220},
      },
    }).png().toFile(source);
    const sourceRelative = path.relative(REPOSITORY_ROOT, source);
    const outputRelative = path.relative(REPOSITORY_ROOT, path.join(temporary, 'nested/output.png'));
    const evidenceRelative = path.relative(REPOSITORY_ROOT, path.join(temporary, 'evidence/normalization.json'));

    const result = await normalizeGeneratedRaster({
      sourceInput: source,
      sourceArchiveRelative: sourceRelative,
      outputRelative,
      evidenceRelative,
    });

    assert.deepEqual(result.normalized.dimensions, [1920, 1080]);
    assert.equal(fs.existsSync(path.join(REPOSITORY_ROOT, outputRelative)), true);
    assert.equal(fs.existsSync(path.join(REPOSITORY_ROOT, evidenceRelative)), true);
  } finally {
    fs.rmSync(temporary, {recursive: true, force: true});
  }
});
