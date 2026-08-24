#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import sharp from 'sharp';

import {assertExactCompositionRaster, assertLandscape16By9, coverGeometry} from '../episode-tooling/raster-contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(HERE, '../../../..');
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

const resolveOutput = (rootRelativePath, label) => {
  if (!rootRelativePath || path.isAbsolute(rootRelativePath)) throw new Error(`${label} must be root-relative`);
  const resolved = path.resolve(REPOSITORY_ROOT, rootRelativePath);
  if (!resolved.startsWith(`${REPOSITORY_ROOT}${path.sep}`)) throw new Error(`${label} escapes repository root`);
  return resolved;
};

const writeExclusive = (target, bytes) => {
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, bytes, {flag: 'wx'});
};

export const normalizeGeneratedRaster = async ({sourceInput, sourceArchiveRelative, outputRelative, evidenceRelative}) => {
  const sourceArchive = resolveOutput(sourceArchiveRelative, 'source archive');
  const output = resolveOutput(outputRelative, 'normalized output');
  const evidence = resolveOutput(evidenceRelative, 'normalization evidence');
  for (const target of [output, evidence]) {
    if (fs.existsSync(target)) throw new Error(`refusing to overwrite: ${target}`);
  }
  const sourceBytes = fs.readFileSync(sourceInput);
  if (fs.existsSync(sourceArchive)) {
    const archiveStat = fs.lstatSync(sourceArchive);
    if (!archiveStat.isFile() || archiveStat.isSymbolicLink()) {
      throw new Error(`existing source archive is not a regular non-symlink file: ${sourceArchive}`);
    }
    const archivedBytes = fs.readFileSync(sourceArchive);
    if (!archivedBytes.equals(sourceBytes)) {
      throw new Error(`existing source archive bytes do not match source input: ${sourceArchive}`);
    }
  } else {
    writeExclusive(sourceArchive, sourceBytes);
  }
  const sourceMetadata = await sharp(sourceBytes).metadata();
  const sourceRaster = assertLandscape16By9(sourceMetadata.width, sourceMetadata.height);
  const geometry = coverGeometry(sourceRaster.width, sourceRaster.height);
  fs.mkdirSync(path.dirname(output), {recursive: true});
  await sharp(sourceBytes, {failOn: 'error'})
    .resize(1920, 1080, {fit: 'cover', position: 'centre', kernel: sharp.kernel.lanczos3})
    .png({compressionLevel: 9, adaptiveFiltering: false, palette: false})
    .toFile(output);
  const outputBytes = fs.readFileSync(output);
  const outputMetadata = await sharp(outputBytes).metadata();
  assertExactCompositionRaster(outputMetadata.width, outputMetadata.height);
  const record = {
    contract_version: 'normalized-raster-evidence-v1',
    result: 'pass',
    source: {
      path: sourceArchiveRelative,
      checksum_sha256: sha256(sourceBytes),
      dimensions: [sourceRaster.width, sourceRaster.height],
      relative_aspect_ratio_error: sourceRaster.relativeAspectError,
    },
    normalized: {
      path: outputRelative,
      checksum_sha256: sha256(outputBytes),
      dimensions: [outputMetadata.width, outputMetadata.height],
    },
    geometry,
    method: 'sharp-lanczos3-scale-to-cover-centered-minimal-crop-png9-v1',
    stretch: false,
    padding: false,
  };
  writeExclusive(evidence, Buffer.from(`${JSON.stringify(record, null, 2)}\n`));
  return record;
};

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const [sourceInput, sourceArchiveRelative, outputRelative, evidenceRelative] = process.argv.slice(2);
  if (!sourceInput || !sourceArchiveRelative || !outputRelative || !evidenceRelative || process.argv.length !== 6) {
    console.error('usage: node normalize-generated-raster.mjs <source-input> <source-archive-root-relative> <output-root-relative> <evidence-root-relative>');
    process.exit(2);
  }
  try {
    process.stdout.write(`${JSON.stringify(await normalizeGeneratedRaster({
      sourceInput,
      sourceArchiveRelative,
      outputRelative,
      evidenceRelative,
    }), null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
