import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import sharp from 'sharp';

import {
  composeIanLayeredSceneBytes,
  sha256Canonical,
  sha256Text,
} from '../ian-layered-scene/contract.mjs';

import {
  assertContained,
  assertLayerRepairBindings,
  assertV2OverlayBindings,
  measureLabelGlyphBounds,
  validateIanTextContainment,
} from './validate-ian-text-containment.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(HERE, '../../../..');
const checksum = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const rootRelative = (value) => path.relative(REPOSITORY_ROOT, value).replaceAll(path.sep, '/');

assert.throws(
  () => assertContained(
    {x: 957, y: 660, width: 187, height: 79},
    {x: 890, y: 672, width: 380, height: 256},
    12,
    '一次结果≠无法改变',
  ),
  /escape the intended container/,
);

assert.doesNotThrow(() => assertContained(
  {x: 957, y: 750, width: 187, height: 79},
  {x: 890, y: 672, width: 380, height: 256},
  12,
  '一次结果≠无法改变',
));

await assert.doesNotReject(() => measureLabelGlyphBounds({
  text: '个人理性\n集体收缩',
  lines: ['个人理性', '集体收缩'],
  x: 700,
  y: 470,
  width: 520,
  height: 180,
  font_size: 40,
  font_weight: 500,
  letter_spacing: 0,
  font_family: 'STHeiti',
}));

const layer = {layer_id: 'L02', path: 'episode/L02.png', checksum_sha256: 'b'.repeat(64)};
const finalComposite = {path: 'episode/final.png', checksum_sha256: 'c'.repeat(64)};
const repairConfig = {path: 'episode/repair.json', checksum_sha256: 'd'.repeat(64)};
const repairEvidence = {
  contract_version: 'ian-layer-text-repair-evidence-v1',
  asset_id: 'S17-ian-v02',
  layer_id: 'L02',
  source: {path: 'episode/L02-blank.png', checksum_sha256: 'a'.repeat(64)},
  repair: {config_checksum_sha256: repairConfig.checksum_sha256},
  repaired: {path: layer.path, checksum_sha256: layer.checksum_sha256},
};

assert.doesNotThrow(() => assertLayerRepairBindings({
  assetId: 'S17-ian-v02',
  manifest: {layers: [layer], final_composite: finalComposite},
  raster: finalComposite,
  repairs: [{repairConfig, repairEvidence}],
}));

assert.throws(() => assertLayerRepairBindings({
  assetId: 'S17-ian-v02',
  manifest: {layers: [layer], final_composite: finalComposite},
  raster: finalComposite,
  repairs: [{
    repairConfig,
    repairEvidence: {...repairEvidence, repaired: finalComposite},
  }],
}), /must target one manifest semantic layer/);

const v2Manifest = {
  contract_version: 'ian-knowledge-video-layered-scene-v2',
  final_composite: finalComposite,
  text_overlay: {
    contract_version: 'ian-deterministic-layer-text-overlay-v1',
    mode: 'required',
    minimum_inset_px: 8,
    font: {font_family: 'STHeiti'},
    labels: [{
      layer_id: 'L02',
      text: '一次结果≠无法改变',
      container_bbox: {x: 890, y: 672, width: 380, height: 256},
      lines: ['一次结果≠无法改变'],
      font_size: 36,
      font_weight: 500,
      letter_spacing: 0,
      fill: '#26333a',
      background: null,
    }],
  },
};
const v2Region = {
  layer_id: 'L02',
  text: '一次结果≠无法改变',
  container_bbox: {x: 890, y: 672, width: 380, height: 256},
  min_inset_px: 8,
};
assert.equal(assertV2OverlayBindings({
  assetId: 'S17-ian-v02',
  manifest: v2Manifest,
  raster: finalComposite,
  regions: [v2Region],
})[0].font_family, 'STHeiti');
assert.throws(() => assertV2OverlayBindings({
  assetId: 'S17-ian-v02',
  manifest: v2Manifest,
  raster: finalComposite,
  regions: [{...v2Region, min_inset_px: 7}],
}), /stale or ambiguous/);

const temporaryWorkspace = fs.mkdtempSync(path.join(
  REPOSITORY_ROOT,
  'leverage-video/src/ian-containment-legacy-v1-',
));
try {
  const episodeWorkspace = rootRelative(temporaryWorkspace);
  const assetsDirectory = path.join(temporaryWorkspace, 'assets');
  const schemaDirectory = path.join(temporaryWorkspace, 'schema');
  fs.mkdirSync(assetsDirectory);
  fs.mkdirSync(schemaDirectory);

  const backgroundPath = path.join(assetsDirectory, 'background.png');
  const sourceLayerPath = path.join(assetsDirectory, 'L01-source.png');
  const repairedLayerPath = path.join(assetsDirectory, 'L01-repaired.png');
  const finalPath = path.join(assetsDirectory, 'final.png');
  await sharp({
    create: {width: 1920, height: 1080, channels: 4, background: '#f7f1e5ff'},
  }).png().toFile(backgroundPath);
  await sharp({
    create: {width: 1920, height: 1080, channels: 4, background: '#00000000'},
  }).composite([{
    input: Buffer.from('<svg width="720" height="240"><rect width="720" height="240" rx="24" fill="#f4dfad"/></svg>'),
    left: 600,
    top: 420,
  }]).png().toFile(sourceLayerPath);
  await sharp(sourceLayerPath).composite([{
    input: Buffer.from('<svg width="24" height="24"><circle cx="12" cy="12" r="10" fill="#26333a"/></svg>'),
    left: 620,
    top: 440,
  }]).png().toFile(repairedLayerPath);
  fs.writeFileSync(finalPath, await composeIanLayeredSceneBytes({
    backgroundPath,
    layerPaths: [repairedLayerPath],
  }));

  const narration = '一次结果≠无法改变';
  const narrationBytes = Buffer.from(narration, 'utf8');
  const scenePlan = {
    contract_version: 'ian-layered-scene-plan-v1',
    shot_id: 'S17',
    narration_source_text_sha256: sha256Text(narration),
    scene_renderer: 'ian-static-layered-scene-v1',
    background_policy: 'static-paper-background-v1',
    layer_asset_policy: 'full-canvas-transparent-png-v1',
    layer_entry_transition: {
      contract_version: 'ian-layer-entry-fade-v1',
      duration_frames: 8,
      easing: 'linear',
    },
    motion_policy: {
      scene_transform: 'forbidden',
      layer_transform: 'forbidden',
      mask_reveal: 'forbidden',
      internal_cut: 'forbidden',
      opacity_animation: 'ian-layer-entry-fade-v1',
    },
    layer_count: 1,
    layers: [{
      layer_id: 'L01',
      z_index: 1,
      semantic_role: '一次结果不等于无法改变',
      source_text_start_byte: 0,
      source_text_end_byte_exclusive: narrationBytes.length,
      source_text: narration,
      entry_frame: 0,
    }],
  };
  const rasterBinding = (file, role, hasAlpha) => ({
    path: rootRelative(file),
    checksum_sha256: checksum(fs.readFileSync(file)),
    width: 1920,
    height: 1080,
    role,
    has_alpha: hasAlpha,
  });
  const repairedBinding = {
    ...scenePlan.layers[0],
    ...rasterBinding(repairedLayerPath, 'transparent-semantic-element', true),
  };
  const legacyManifest = {
    contract_version: 'ian-knowledge-video-layered-scene-v1',
    episode_workspace: episodeWorkspace,
    queue_item_id: 'S17-ian-v01',
    shot_id: 'S17',
    visual_generation_route: 'ian-handdrawn-ppt',
    treatment_profile_id: 'ian-handdrawn-technical',
    storyboard_binding: {path: `${episodeWorkspace}/storyboard.md`, checksum_sha256: '1'.repeat(64)},
    visual_direction_review: {
      path: `${episodeWorkspace}/schema/direction.json`,
      checksum_sha256: '2'.repeat(64),
      presented_map_sha256: '3'.repeat(64),
    },
    canvas: {width: 1920, height: 1080, fps: 30},
    timing: {shot_start_frame: 0, shot_end_frame: 30, duration_frames: 30},
    narration_source_text: narration,
    narration_source_text_sha256: sha256Text(narration),
    scene_plan: scenePlan,
    scene_plan_sha256: sha256Canonical(scenePlan),
    generation_constraints: {
      background_raster_count: 1,
      final_composite_raster_count: 1,
      layer_rasters_are_full_canvas_rgba: true,
      scene_translation: false,
      scene_scaling: false,
      layer_translation: false,
      layer_scaling: false,
      layer_rotation: false,
      mask_reveal: false,
      internal_cut: false,
      automatic_page_number: false,
      automatic_title: false,
      automatic_subtitle: false,
      automatic_labels: false,
      signature: false,
    },
    background: rasterBinding(backgroundPath, 'static-paper-background', false),
    layers: [repairedBinding],
    final_composite: rasterBinding(finalPath, 'final-composite-review-raster', false),
    verified_visible_text: [narration],
  };
  const manifestPath = path.join(schemaDirectory, 'legacy-scene-package.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(legacyManifest, null, 2)}\n`);

  const repairConfig = {
    asset_id: 'S17-ian-v01',
    layer_id: 'L01',
    labels: [{
      text: narration,
      lines: [narration],
      x: 700,
      y: 470,
      width: 520,
      height: 140,
      font_size: 40,
      font_weight: 500,
      letter_spacing: 0,
    }],
  };
  const repairConfigPath = path.join(schemaDirectory, 'repair-config.json');
  fs.writeFileSync(repairConfigPath, `${JSON.stringify(repairConfig, null, 2)}\n`);
  const repairEvidence = {
    contract_version: 'ian-layer-text-repair-evidence-v1',
    asset_id: 'S17-ian-v01',
    layer_id: 'L01',
    source: rasterBinding(sourceLayerPath, 'transparent-semantic-element', true),
    repair: {config_checksum_sha256: checksum(fs.readFileSync(repairConfigPath))},
    repaired: {
      path: repairedBinding.path,
      checksum_sha256: repairedBinding.checksum_sha256,
    },
  };
  const repairEvidencePath = path.join(schemaDirectory, 'repair-evidence.json');
  fs.writeFileSync(repairEvidencePath, `${JSON.stringify(repairEvidence, null, 2)}\n`);
  const spec = {
    contract_version: 'ian-layer-text-container-qa-spec-v1',
    asset_id: 'S17-ian-v01',
    scene_package_manifest: {
      path: rootRelative(manifestPath),
      checksum_sha256: checksum(fs.readFileSync(manifestPath)),
    },
    layer_repairs: [{
      repair_config: {
        path: rootRelative(repairConfigPath),
        checksum_sha256: checksum(fs.readFileSync(repairConfigPath)),
      },
      repair_evidence: {
        path: rootRelative(repairEvidencePath),
        checksum_sha256: checksum(fs.readFileSync(repairEvidencePath)),
      },
    }],
    raster: {
      path: legacyManifest.final_composite.path,
      checksum_sha256: legacyManifest.final_composite.checksum_sha256,
    },
    regions: [{
      layer_id: 'L01',
      text: narration,
      container_bbox: {x: 700, y: 470, width: 520, height: 140},
      min_inset_px: 8,
    }],
    evidence_path: `${episodeWorkspace}/schema/containment-evidence.json`,
  };
  const specPath = path.join(schemaDirectory, 'containment-spec.json');
  fs.writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`);

  const legacyEvidence = await validateIanTextContainment(rootRelative(specPath));
  assert.equal(legacyEvidence.repair_mode, 'layer-before-deterministic-composite-v1');
  assert.equal(legacyEvidence.inspection.regions[0].layer_id, 'L01');

  const invalidFinalPath = path.join(assetsDirectory, 'final-invalid.png');
  fs.copyFileSync(backgroundPath, invalidFinalPath);
  const invalidManifest = structuredClone(legacyManifest);
  invalidManifest.final_composite = rasterBinding(
    invalidFinalPath,
    'final-composite-review-raster',
    false,
  );
  const invalidManifestPath = path.join(schemaDirectory, 'legacy-scene-package-invalid.json');
  fs.writeFileSync(invalidManifestPath, `${JSON.stringify(invalidManifest, null, 2)}\n`);
  const invalidSpec = structuredClone(spec);
  invalidSpec.scene_package_manifest = {
    path: rootRelative(invalidManifestPath),
    checksum_sha256: checksum(fs.readFileSync(invalidManifestPath)),
  };
  invalidSpec.raster = {
    path: invalidManifest.final_composite.path,
    checksum_sha256: invalidManifest.final_composite.checksum_sha256,
  };
  invalidSpec.evidence_path = `${episodeWorkspace}/schema/invalid-containment-evidence.json`;
  const invalidSpecPath = path.join(schemaDirectory, 'invalid-containment-spec.json');
  fs.writeFileSync(invalidSpecPath, `${JSON.stringify(invalidSpec, null, 2)}\n`);
  await assert.rejects(
    () => validateIanTextContainment(rootRelative(invalidSpecPath)),
    /differs from deterministic background-plus-layers recomposition/,
  );
} finally {
  fs.rmSync(temporaryWorkspace, {recursive: true, force: true});
}

process.stdout.write('Ian text containment tests passed\n');
