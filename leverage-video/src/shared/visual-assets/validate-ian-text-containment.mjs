#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import sharp from 'sharp';

import {
  inspectIanLayeredScenePackage,
  inspectLegacyIanLayeredScenePackageV1,
} from '../ian-layered-scene/contract.mjs';

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
    <text text-anchor="middle" font-family="${escapeXml(label.font_family ?? 'STHeiti')}, Heiti SC, sans-serif"
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

const rasterProjection = (binding) => ({
  path: binding?.path,
  checksum_sha256: binding?.checksum_sha256,
});

export const assertLayerRepairBindings = ({assetId, manifest, raster, repairs}) => {
  if (JSON.stringify(rasterProjection(manifest?.final_composite))
      !== JSON.stringify(rasterProjection(raster))) {
    throw new Error('containment raster must equal the deterministic final composite');
  }
  if (!Array.isArray(repairs) || repairs.length === 0) {
    throw new Error('layer containment requires at least one repaired semantic layer');
  }
  const seen = new Set();
  return repairs.map(({repairConfig, repairEvidence}) => {
    const layerId = repairEvidence?.layer_id;
    const layer = manifest?.layers?.find((candidate) => candidate.layer_id === layerId);
    if (!layer
        || seen.has(layerId)
        || repairEvidence?.contract_version !== 'ian-layer-text-repair-evidence-v1'
        || repairEvidence?.asset_id !== assetId
        || repairEvidence?.repair?.config_checksum_sha256 !== repairConfig?.checksum_sha256
        || JSON.stringify(repairEvidence?.repaired) !== JSON.stringify(rasterProjection(layer))
        || JSON.stringify(repairEvidence?.source) === JSON.stringify(repairEvidence?.repaired)) {
      throw new Error(`${layerId ?? 'unknown'} text repair must target one manifest semantic layer`);
    }
    seen.add(layerId);
    return {layer_id: layerId, repaired_layer: rasterProjection(layer)};
  });
};

export const assertV2OverlayBindings = ({assetId, manifest, raster, regions}) => {
  if (manifest?.contract_version !== 'ian-knowledge-video-layered-scene-v2'
      || JSON.stringify(rasterProjection(manifest?.final_composite))
        !== JSON.stringify(rasterProjection(raster))
      || manifest?.text_overlay?.contract_version
        !== 'ian-deterministic-layer-text-overlay-v1'
      || manifest?.text_overlay?.mode !== 'required') {
    throw new Error('v2 containment must bind the deterministic owning-layer overlay package');
  }
  const labels = manifest.text_overlay.labels;
  if (!Array.isArray(labels) || !Array.isArray(regions) || labels.length !== regions.length) {
    throw new Error('v2 containment regions must cover every deterministic label exactly once');
  }
  return labels.map((label) => {
    const matches = regions.filter((region) => (
      region.layer_id === label.layer_id && region.text === label.text
    ));
    if (matches.length !== 1
        || JSON.stringify(matches[0].container_bbox)
          !== JSON.stringify(label.container_bbox)
        || matches[0].min_inset_px !== manifest.text_overlay.minimum_inset_px) {
      throw new Error(`v2 containment region is stale or ambiguous: ${label.text}`);
    }
    return {
      ...label,
      x: label.container_bbox.x,
      y: label.container_bbox.y,
      width: label.container_bbox.width,
      height: label.container_bbox.height,
      font_family: manifest.text_overlay.font.font_family,
    };
  });
};

export const validateIanTextContainment = async (specPathValue) => {
  const specPath = resolveRootRelative(specPathValue, 'spec path');
  const specBytes = fs.readFileSync(specPath);
  const spec = JSON.parse(specBytes);
  const rasterPath = resolveRootRelative(spec.raster?.path, 'raster path');
  const rasterBytes = fs.readFileSync(rasterPath);
  if (sha256(rasterBytes) !== spec.raster?.checksum_sha256) {
    throw new Error('containment raster binding is stale');
  }
  let labels;
  let repairEvidenceProjection;
  if (spec.contract_version === 'ian-text-container-qa-spec-v1') {
    const configRecord = readBoundJson(spec.repair_config, 'repair config');
    const repairRecord = readBoundJson(spec.repair_evidence, 'repair evidence');
    if (configRecord.value.asset_id !== spec.asset_id || repairRecord.value.asset_id !== spec.asset_id) {
      throw new Error('containment asset binding mismatch');
    }
    if (repairRecord.value.repair?.config_checksum_sha256 !== spec.repair_config.checksum_sha256) {
      throw new Error('repair evidence does not bind the containment config');
    }
    if (repairRecord.value.repaired?.checksum_sha256 !== spec.raster?.checksum_sha256) {
      throw new Error('containment raster binding is stale');
    }
    labels = configRecord.value.labels;
    repairEvidenceProjection = {
      repair_mode: 'legacy-final-raster-repair-v1',
      repair_config: spec.repair_config,
      repair_evidence: spec.repair_evidence,
    };
  } else if (spec.contract_version === 'ian-layer-text-container-qa-spec-v1') {
    const manifestRecord = readBoundJson(spec.scene_package_manifest, 'scene package manifest');
    await inspectLegacyIanLayeredScenePackageV1(manifestRecord.value, {
      repositoryRoot: REPOSITORY_ROOT,
      episodeWorkspace: manifestRecord.value.episode_workspace,
    });
    const repairRecords = (spec.layer_repairs ?? []).map((binding, index) => {
      const configRecord = readBoundJson(binding.repair_config, `layer repair ${index} config`);
      const repairRecord = readBoundJson(binding.repair_evidence, `layer repair ${index} evidence`);
      if (configRecord.value.asset_id !== spec.asset_id
          || repairRecord.value.asset_id !== spec.asset_id
          || configRecord.value.layer_id !== repairRecord.value.layer_id) {
        throw new Error('containment layer repair asset or layer binding mismatch');
      }
      for (const [label, member] of [
        ['source', repairRecord.value.source],
        ['repaired', repairRecord.value.repaired],
      ]) {
        const memberPath = resolveRootRelative(member?.path, `layer repair ${index} ${label} path`);
        if (sha256(fs.readFileSync(memberPath)) !== member?.checksum_sha256) {
          throw new Error(`layer repair ${index} ${label} checksum is stale`);
        }
      }
      return {
        binding,
        repairConfig: binding.repair_config,
        config: configRecord.value,
        repairEvidence: repairRecord.value,
      };
    });
    const repairedLayers = assertLayerRepairBindings({
      assetId: spec.asset_id,
      manifest: manifestRecord.value,
      raster: spec.raster,
      repairs: repairRecords,
    });
    labels = repairRecords.flatMap(({config}) => config.labels.map((label) => ({
      ...label,
      layer_id: config.layer_id,
    })));
    repairEvidenceProjection = {
      repair_mode: 'layer-before-deterministic-composite-v1',
      scene_package_manifest: spec.scene_package_manifest,
      layer_repairs: repairRecords.map(({binding}, index) => ({
        ...binding,
        ...repairedLayers[index],
      })),
    };
  } else if (spec.contract_version === 'ian-layer-text-container-qa-spec-v2') {
    const manifestRecord = readBoundJson(spec.scene_package_manifest, 'scene package manifest');
    await inspectIanLayeredScenePackage(manifestRecord.value, {
      repositoryRoot: REPOSITORY_ROOT,
      episodeWorkspace: manifestRecord.value.episode_workspace,
    });
    labels = assertV2OverlayBindings({
      assetId: spec.asset_id,
      manifest: manifestRecord.value,
      raster: spec.raster,
      regions: spec.regions,
    });
    repairEvidenceProjection = {
      repair_mode: 'v2-deterministic-owning-layer-overlay',
      scene_package_manifest: spec.scene_package_manifest,
      layer_overlays: labels.map((label) => ({
        layer_id: label.layer_id,
        text: label.text,
        container_bbox: label.container_bbox,
      })),
    };
  } else {
    throw new Error('unsupported containment spec');
  }
  if (!Array.isArray(labels) || !Array.isArray(spec.regions) || labels.length !== spec.regions.length) {
    throw new Error('containment regions must cover every repaired label exactly once');
  }
  const validatedRegions = [];
  for (const label of labels) {
    const matches = spec.regions.filter((region) => region.text === label.text
      && (label.layer_id === undefined || region.layer_id === label.layer_id));
    if (matches.length !== 1) throw new Error(`containment region is missing or ambiguous: ${label.text}`);
    const region = matches[0];
    const inset = region.min_inset_px;
    if (!Number.isInteger(inset) || inset < 8) throw new Error(`minimum inset is invalid: ${label.text}`);
    const glyph = await measureLabelGlyphBounds(label);
    assertContained(glyph, region.container_bbox, inset, label.text);
    validatedRegions.push({
      text: label.text,
      ...(label.layer_id === undefined ? {} : {layer_id: label.layer_id}),
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
    ...repairEvidenceProjection,
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
