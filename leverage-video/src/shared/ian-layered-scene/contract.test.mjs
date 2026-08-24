import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import sharp from 'sharp';

import {
  composeIanLayeredSceneBytes,
  inspectIanLayeredScenePackage,
  sha256Canonical,
  sha256Text,
  validateIanLayeredScenePackage,
  validateIanLayeredScenePlan,
  validateIanLayeredSceneRhythmBinding,
} from './contract.mjs';

const checksum = (value) => crypto.createHash('sha256').update(value).digest('hex');
const constraints = {
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
};

const sourceText = '一次结果，不等于无法改变。';
const sourceBytes = Buffer.from(sourceText, 'utf8');
const split = Buffer.from('一次结果，', 'utf8').length;
const plan = () => ({
  contract_version: 'ian-layered-scene-plan-v1',
  shot_id: 'S17',
  narration_source_text_sha256: sha256Text(sourceText),
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
  layer_count: 2,
  layers: [
    {
      layer_id: 'L01',
      z_index: 1,
      semantic_role: 'single-result-card',
      source_text_start_byte: 0,
      source_text_end_byte_exclusive: split,
      source_text: sourceBytes.subarray(0, split).toString('utf8'),
      entry_frame: 0,
    },
    {
      layer_id: 'L02',
      z_index: 2,
      semantic_role: 'change-path',
      source_text_start_byte: split,
      source_text_end_byte_exclusive: sourceBytes.length,
      source_text: sourceBytes.subarray(split).toString('utf8'),
      entry_frame: 18,
    },
  ],
});

const binding = (file, role, hasAlpha) => ({
  path: file,
  checksum_sha256: '0'.repeat(64),
  width: 1920,
  height: 1080,
  role,
  has_alpha: hasAlpha,
});

const manifest = () => {
  const scenePlan = plan();
  return {
    contract_version: 'ian-knowledge-video-layered-scene-v1',
    episode_workspace: 'leverage-video/src/topic-test',
    queue_item_id: 'S17-ian-v01',
    shot_id: 'S17',
    visual_generation_route: 'ian-handdrawn-ppt',
    treatment_profile_id: 'ian-handdrawn-technical',
    storyboard_binding: {path: 'leverage-video/src/topic-test/storyboard.md', checksum_sha256: '1'.repeat(64)},
    visual_direction_review: {
      path: 'leverage-video/src/topic-test/schema/direction.json',
      checksum_sha256: '2'.repeat(64),
      presented_map_sha256: '3'.repeat(64),
    },
    canvas: {width: 1920, height: 1080, fps: 30},
    timing: {shot_start_frame: 100, shot_end_frame: 160, duration_frames: 60},
    narration_source_text: sourceText,
    narration_source_text_sha256: sha256Text(sourceText),
    scene_plan: scenePlan,
    scene_plan_sha256: sha256Canonical(scenePlan),
    generation_constraints: constraints,
    background: binding('leverage-video/src/topic-test/assets/background.png', 'static-paper-background', false),
    layers: scenePlan.layers.map((layer) => ({
      ...layer,
      ...binding(
        `leverage-video/src/topic-test/assets/${layer.layer_id}.png`,
        'transparent-semantic-element',
        true,
      ),
    })),
    final_composite: binding(
      'leverage-video/src/topic-test/assets/final.png',
      'final-composite-review-raster',
      false,
    ),
    verified_visible_text: ['一次结果≠无法改变'],
  };
};

test('plan binds ordered static layers to exact narration bytes and frames', () => {
  const value = validateIanLayeredScenePlan(plan(), {
    shotId: 'S17',
    sourceText,
    durationFrames: 60,
    fps: 30,
  });
  assert.equal(value.layer_count, 2);
  assert.equal(value.layers.at(-1).source_text_end_byte_exclusive, sourceBytes.length);
});

test('plan rejects gaps, overlapping fades, transforms, and stale text slices', () => {
  const gap = plan();
  gap.layers[1].source_text_start_byte += 1;
  assert.throws(() => validateIanLayeredScenePlan(gap, {
    shotId: 'S17', sourceText, durationFrames: 60,
  }), /contiguous/);
  const overlap = plan();
  overlap.layers[1].entry_frame = 7;
  assert.throws(() => validateIanLayeredScenePlan(overlap, {
    shotId: 'S17', sourceText, durationFrames: 60,
  }), /non-overlapping/);
  const motion = plan();
  motion.motion_policy.scene_transform = 'allowed';
  assert.throws(() => validateIanLayeredScenePlan(motion, {
    shotId: 'S17', sourceText, durationFrames: 60,
  }), /forbid/);
  const stale = plan();
  stale.layers[0].source_text = '错误';
  assert.throws(() => validateIanLayeredScenePlan(stale, {
    shotId: 'S17', sourceText, durationFrames: 60,
  }), /UTF-8/);
});

test('plan binds every semantic layer to one approved narration-rhythm event', () => {
  const value = plan();
  value.layers[0].semantic_role = '一次结果';
  value.layers[1].semantic_role = '不等于无法改变';
  const rhythmShot = {
    shot_id: 'S17',
    asset_plan: {layer_count: 2},
    meaningful_change_events: [
      {at_frame: 100, description: '一次结果'},
      {at_frame: 118, description: '不等于无法改变'},
    ],
  };
  assert.deepEqual(validateIanLayeredSceneRhythmBinding(value, {
    shotStartFrame: 100,
    rhythmShot,
  }).entry_frames, [0, 18]);

  const stale = structuredClone(rhythmShot);
  stale.meaningful_change_events[1].at_frame = 119;
  assert.throws(() => validateIanLayeredSceneRhythmBinding(value, {
    shotStartFrame: 100,
    rhythmShot: stale,
  }), /narration-rhythm event/);
});

test('package structure binds the plan, background, transparent layers, and review raster', () => {
  const value = validateIanLayeredScenePackage(manifest(), {
    episodeWorkspace: 'leverage-video/src/topic-test',
    queueItemId: 'S17-ian-v01',
    shotId: 'S17',
    sourceText,
    shotStartFrame: 100,
    shotEndFrame: 160,
  });
  assert.equal(value.layers.length, 2);
  assert.equal(value.final_composite.role, 'final-composite-review-raster');
});

test('disk inspection rejects opaque element layers and verifies deterministic composition', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ian-layered-scene-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const workspace = path.join(root, 'leverage-video/src/topic-test/assets');
  fs.mkdirSync(workspace, {recursive: true});
  const backgroundPath = path.join(workspace, 'background.png');
  const layer1Path = path.join(workspace, 'L01.png');
  const layer2Path = path.join(workspace, 'L02.png');
  const finalPath = path.join(workspace, 'final.png');
  await sharp({create: {width: 1920, height: 1080, channels: 4, background: '#f7f1e5ff'}})
    .png().toFile(backgroundPath);
  await sharp({create: {width: 1920, height: 1080, channels: 4, background: '#00000000'}})
    .composite([{input: Buffer.from('<svg width="320" height="180"><rect width="320" height="180" fill="#334455"/></svg>'), left: 100, top: 100}])
    .png().toFile(layer1Path);
  await sharp({create: {width: 1920, height: 1080, channels: 4, background: '#00000000'}})
    .composite([{input: Buffer.from('<svg width="200" height="200"><circle cx="100" cy="100" r="90" fill="#cc6633"/></svg>'), left: 800, top: 500}])
    .png().toFile(layer2Path);
  fs.writeFileSync(finalPath, await composeIanLayeredSceneBytes({
    backgroundPath,
    layerPaths: [layer1Path, layer2Path],
  }));
  const value = manifest();
  for (const item of [value.background, ...value.layers, value.final_composite]) {
    const file = path.join(root, item.path);
    item.checksum_sha256 = checksum(fs.readFileSync(file));
  }
  const inspected = await inspectIanLayeredScenePackage(value, {
    repositoryRoot: root,
    episodeWorkspace: value.episode_workspace,
    sourceText,
    shotStartFrame: 100,
    shotEndFrame: 160,
  });
  assert.equal(inspected.deterministic_composite_match, true);

  await sharp({create: {width: 1920, height: 1080, channels: 4, background: '#334455ff'}})
    .png().toFile(layer1Path);
  value.layers[0].checksum_sha256 = checksum(fs.readFileSync(layer1Path));
  await assert.rejects(() => inspectIanLayeredScenePackage(value, {
    repositoryRoot: root,
    episodeWorkspace: value.episode_workspace,
    sourceText,
    shotStartFrame: 100,
    shotEndFrame: 160,
  }), /both transparent and visible/);
});
