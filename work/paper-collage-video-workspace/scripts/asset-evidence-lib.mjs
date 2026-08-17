import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {ROOT, fileExists, resolvePublicFile} from './project-lib.mjs';
import {
  alphaBandOverlaySvg,
  derivationRegionsFromBinding,
  inspectAlphaBands,
} from './alpha-band-lib.mjs';

export const safeEvidenceId = (value) =>
  value.replace(/[^a-z0-9-]+/gi, '-').toLowerCase();

const clamp = (value, minimum, maximum) =>
  Math.max(minimum, Math.min(maximum, value));

const checkerboard = ({width, height, cell = 48}) => Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><pattern id="grid" width="${cell * 2}" height="${cell * 2}" patternUnits="userSpaceOnUse">
      <rect width="${cell * 2}" height="${cell * 2}" fill="#ece8df"/>
      <rect width="${cell}" height="${cell}" fill="#8b8275"/>
      <rect x="${cell}" y="${cell}" width="${cell}" height="${cell}" fill="#8b8275"/>
    </pattern></defs>
    <rect width="100%" height="100%" fill="url(#grid)"/>
  </svg>
`);

export const alphaBoundsFor = async (file) => {
  const {data, info} = await sharp(file)
    .ensureAlpha()
    .extractChannel(3)
    .raw()
    .toBuffer({resolveWithObject: true});
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[y * info.width + x] <= 16) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) {
    return {left: 0, top: 0, width: info.width, height: info.height};
  }
  return {left, top, width: right - left + 1, height: bottom - top + 1};
};

export const padEvidenceBounds = (
  bounds,
  {width, height},
  padding = 24,
) => {
  const left = clamp(Math.floor(bounds.left - padding), 0, width - 1);
  const top = clamp(Math.floor(bounds.top - padding), 0, height - 1);
  const right = clamp(Math.ceil(bounds.left + bounds.width + padding), left + 1, width);
  const bottom = clamp(Math.ceil(bounds.top + bounds.height + padding), top + 1, height);
  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
};

const hashFile = async (file) =>
  createHash('sha256').update(await fs.readFile(file)).digest('hex');

const stableJson = (value) => JSON.stringify(value ?? null);

export const assetEvidenceIsCurrent = async (
  entry,
  node,
  {
    renderSize = null,
    registeredFamilyBinding = null,
    canonicalContainerBinding = null,
  } = {},
) => {
  if (!entry || entry.source !== node.src || !entry.sourceSha256) return false;
  if (stableJson(entry.renderSize) !== stableJson(renderSize)) return false;
  if (
    entry.derivationFingerprint !==
    createHash('sha256')
      .update(
        stableJson({
          registeredFamilyBinding,
          canonicalContainerBinding,
        }),
      )
      .digest('hex')
  ) return false;
  const sourceFile = resolvePublicFile(node.src);
  if (!(await fileExists(sourceFile))) return false;
  if (await hashFile(sourceFile) !== entry.sourceSha256) return false;
  return (
    await Promise.all(
      [
        entry.alphaMask,
        entry.checkerboard,
        entry.tightCrop,
        entry.motionStress,
        entry.alphaBandReport,
        entry.alphaBandOverlay,
      ]
        .map((file) => fileExists(path.resolve(ROOT, file ?? ''))),
    )
  ).every(Boolean);
};

export const buildAssetEvidence = async ({
  node,
  directory,
  evidenceId = node.id,
  renderSize = null,
  registeredFamilyBinding = null,
  canonicalContainerBinding = null,
}) => {
  const sourceFile = resolvePublicFile(node.src);
  const metadata = await sharp(sourceFile).metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height) throw new Error(`${node.id} 无法读取尺寸。`);
  const id = safeEvidenceId(evidenceId);
  const alphaMaskFile = path.join(directory, `${id}-alpha.png`);
  const checkerboardFile = path.join(directory, `${id}-checkerboard.png`);
  const tightCropFile = path.join(directory, `${id}-tight.png`);
  const motionStressFile = path.join(directory, `${id}-motion-stress.jpg`);
  const alphaBandReportFile = path.join(directory, `${id}-alpha-bands.json`);
  const alphaBandOverlayFile = path.join(directory, `${id}-alpha-bands.png`);
  const bounds = await alphaBoundsFor(sourceFile);
  const padded = padEvidenceBounds(
    bounds,
    {width, height},
    Math.max(12, Math.round(Math.max(width, height) * 0.015)),
  );
  await sharp(sourceFile).ensureAlpha().extractChannel(3).png().toFile(alphaMaskFile);
  const checker = checkerboard({width, height});
  const normal = await sharp(checker)
    .composite([{input: sourceFile}])
    .png()
    .toBuffer();
  await sharp(normal).png().toFile(checkerboardFile);
  await sharp(normal).extract(padded).png().toFile(tightCropFile);
  const shiftX = Math.max(8, Math.round(width * 0.02));
  const shiftY = Math.max(4, Math.round(height * 0.01));
  const shiftedAsset = await sharp(sourceFile)
    .affine([[1, 0], [0, 1]], {
      idx: shiftX,
      idy: shiftY,
      background: '#00000000',
    })
    .png()
    .toBuffer();
  const shifted = await sharp(checker)
    .composite([{input: shiftedAsset}])
    .png()
    .toBuffer();
  const panels = await Promise.all(
    [normal, shifted].map((input) =>
      sharp(input)
        .resize(640, 360, {fit: 'contain', background: '#2b2622'})
        .jpeg({quality: 92})
        .toBuffer(),
    ),
  );
  await sharp({
    create: {width: 1280, height: 360, channels: 3, background: '#2b2622'},
  })
    .composite([
      {input: panels[0], left: 0, top: 0},
      {input: panels[1], left: 640, top: 0},
    ])
    .jpeg({quality: 92})
    .toFile(motionStressFile);
  const derivationRegions = derivationRegionsFromBinding(
    registeredFamilyBinding,
  );
  const alphaBandInspection = await inspectAlphaBands({
    file: sourceFile,
    renderSize,
    derivationRegions,
  });
  await fs.writeFile(
    alphaBandReportFile,
    `${JSON.stringify(alphaBandInspection, null, 2)}\n`,
    'utf8',
  );
  await sharp(normal)
    .composite([{
      input: alphaBandOverlaySvg({
        inspection: alphaBandInspection,
        width,
        height,
      }),
    }])
    .png()
    .toFile(alphaBandOverlayFile);
  return {
    nodeId: node.id,
    source: node.src,
    sourceSha256: await hashFile(sourceFile),
    renderSize,
    derivationFingerprint: createHash('sha256')
      .update(
        stableJson({
          registeredFamilyBinding,
          canonicalContainerBinding,
        }),
      )
      .digest('hex'),
    alphaBounds: bounds,
    alphaMask: path.relative(ROOT, alphaMaskFile),
    checkerboard: path.relative(ROOT, checkerboardFile),
    tightCrop: path.relative(ROOT, tightCropFile),
    motionStress: path.relative(ROOT, motionStressFile),
    alphaBandReport: path.relative(ROOT, alphaBandReportFile),
    alphaBandOverlay: path.relative(ROOT, alphaBandOverlayFile),
    alphaBandInspection,
  };
};
