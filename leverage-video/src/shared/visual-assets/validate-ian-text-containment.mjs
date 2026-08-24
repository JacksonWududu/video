#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(HERE, '../../../..');
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

const resolveRootRelative = (value, label) => {
  if (!value || path.isAbsolute(value)) throw new Error(`${label} must be root-relative`);
  const resolved = path.resolve(REPOSITORY_ROOT, value);
  if (!resolved.startsWith(`${REPOSITORY_ROOT}${path.sep}`)) throw new Error(`${label} escapes repository root`);
  return resolved;
};

const readBoundJson = (binding, label) => {
  const file = resolveRootRelative(binding?.path, `${label} path`);
  const bytes = fs.readFileSync(file);
  if (sha256(bytes) !== binding?.checksum_sha256) throw new Error(`${label} checksum is stale`);
  return {file, bytes, value: JSON.parse(bytes)};
};

const escapeXml = (value) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

const labelTextSvg = (label) => {
  const lines = label.lines ?? [label.text];
  if (lines.join('') !== label.text) throw new Error(`label lines do not reproduce exact text: ${label.text}`);
  const lineHeight = Math.round(label.font_size * 1.24);
  const blockHeight = lineHeight * lines.length;
  const startY = label.y + ((label.height - blockHeight) / 2) + Math.round(label.font_size * 0.88);
  const spans = lines.map((line, index) => (
    `<tspan x="${label.x + (label.width / 2)}" y="${startY + (index * lineHeight)}">${escapeXml(line)}</tspan>`
  )).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
    <text text-anchor="middle" font-family="STHeiti, Heiti SC, sans-serif"
      font-size="${label.font_size}" font-weight="${label.font_weight ?? 500}"
      letter-spacing="${label.letter_spacing ?? 0}" fill="#000000">${spans}</text>
  </svg>`;
};

export const measureLabelGlyphBounds = async (label) => {
  const {data, info} = await sharp(Buffer.from(labelTextSvg(label)))
    .ensureAlpha()
    .raw()
    .toBuffer({resolveWithObject: true});
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[((y * info.width) + x) * info.channels + 3] === 0) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) throw new Error(`label rendered no glyph pixels: ${label.text}`);
  return {x: left, y: top, width: right - left + 1, height: bottom - top + 1};
};

export const assertContained = (glyph, container, minInsetPx, text) => {
  const inner = {
    left: container.x + minInsetPx,
    top: container.y + minInsetPx,
    right: container.x + container.width - minInsetPx,
    bottom: container.y + container.height - minInsetPx,
  };
  if (glyph.x < inner.left || glyph.y < inner.top
      || glyph.x + glyph.width > inner.right || glyph.y + glyph.height > inner.bottom) {
    throw new Error(`label glyphs escape the intended container: ${text}`);
  }
};

export const validateIanTextContainment = async (specPathValue) => {
  const specPath = resolveRootRelative(specPathValue, 'spec path');
  const specBytes = fs.readFileSync(specPath);
  const spec = JSON.parse(specBytes);
  if (spec.contract_version !== 'ian-text-container-qa-spec-v1') throw new Error('unsupported containment spec');
  const configRecord = readBoundJson(spec.repair_config, 'repair config');
  const repairRecord = readBoundJson(spec.repair_evidence, 'repair evidence');
  if (configRecord.value.asset_id !== spec.asset_id || repairRecord.value.asset_id !== spec.asset_id) {
    throw new Error('containment asset binding mismatch');
  }
  if (repairRecord.value.repair?.config_checksum_sha256 !== spec.repair_config.checksum_sha256) {
    throw new Error('repair evidence does not bind the containment config');
  }
  const rasterPath = resolveRootRelative(spec.raster?.path, 'raster path');
  const rasterBytes = fs.readFileSync(rasterPath);
  if (sha256(rasterBytes) !== spec.raster?.checksum_sha256
      || repairRecord.value.repaired?.checksum_sha256 !== spec.raster?.checksum_sha256) {
    throw new Error('containment raster binding is stale');
  }
  const labels = configRecord.value.labels;
  if (!Array.isArray(labels) || !Array.isArray(spec.regions) || labels.length !== spec.regions.length) {
    throw new Error('containment regions must cover every repaired label exactly once');
  }
  const validatedRegions = [];
  for (const label of labels) {
    const matches = spec.regions.filter((region) => region.text === label.text);
    if (matches.length !== 1) throw new Error(`containment region is missing or ambiguous: ${label.text}`);
    const region = matches[0];
    const inset = region.min_inset_px;
    if (!Number.isInteger(inset) || inset < 8) throw new Error(`minimum inset is invalid: ${label.text}`);
    const glyph = await measureLabelGlyphBounds(label);
    assertContained(glyph, region.container_bbox, inset, label.text);
    validatedRegions.push({
      text: label.text,
      glyph_bbox: glyph,
      container_bbox: region.container_bbox,
      min_inset_px: inset,
      result: 'pass',
    });
  }
  const evidence = {
    contract_version: 'ian-text-container-qa-evidence-v1',
    result: 'pass',
    asset_id: spec.asset_id,
    spec: {path: specPathValue, checksum_sha256: sha256(specBytes)},
    repair_config: spec.repair_config,
    repair_evidence: spec.repair_evidence,
    raster: spec.raster,
    inspection: {
      method: 'sharp-rendered-glyph-alpha-bounds-inside-human-verified-container-v1',
      regions: validatedRegions,
    },
  };
  const evidencePath = resolveRootRelative(spec.evidence_path, 'containment evidence path');
  fs.mkdirSync(path.dirname(evidencePath), {recursive: true});
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, {flag: 'wx'});
  return evidence;
};

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const [specPath] = process.argv.slice(2);
  if (!specPath || process.argv.length !== 3) {
    console.error('usage: node validate-ian-text-containment.mjs <root-relative-spec.json>');
    process.exit(2);
  }
  try {
    process.stdout.write(`${JSON.stringify(await validateIanTextContainment(specPath), null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
