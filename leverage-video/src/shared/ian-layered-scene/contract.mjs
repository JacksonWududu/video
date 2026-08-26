import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

import {
  IAN_LAYERED_SCENE_PACKAGE_VERSION,
  IAN_LAYERED_SCENE_RENDERER_VERSION,
  IAN_LAYER_ENTRY_DURATION_FRAMES,
  IAN_LAYER_ENTRY_TRANSITION_VERSION,
} from './runtime.mjs';

export {
  IAN_LAYERED_SCENE_PACKAGE_VERSION,
  IAN_LAYERED_SCENE_RENDERER_VERSION,
  IAN_LAYER_ENTRY_DURATION_FRAMES,
  IAN_LAYER_ENTRY_TRANSITION_VERSION,
} from './runtime.mjs';

export const IAN_LAYERED_SCENE_PLAN_VERSION = 'ian-layered-scene-plan-v1';
export const IAN_LAYERED_SCENE_LEGACY_PACKAGE_VERSION = 'ian-knowledge-video-layered-scene-v1';
export const IAN_MASTER_GENERATION_VERSION = 'ian-gpt-image-2-text-free-master-v1';
export const IAN_MODEL_PROVENANCE_VERSION = 'codex-native-imagegen-gpt-image-2-provenance-v1';
export const IAN_SEMANTIC_SPLIT_VERSION = 'ian-semantic-region-alpha-split-v1';
export const IAN_TEXT_OVERLAY_VERSION = 'ian-deterministic-layer-text-overlay-v1';
export const IAN_CANONICAL_STYLE_ANCHOR_PATH = '.agents/skills/ian-handdrawn-ppt/assets/reference-handdrawn-article-illustration-style.png';

const SHA256 = /^[a-f0-9]{64}$/;
const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;
const FPS = 30;
const MINIMUM_TEXT_INSET_PX = 8;
const OUTSIDE_UNION_MAX_VISIBLE_PIXELS = 1024;

const fail = (message) => {
  throw new Error(message);
};

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
};

export const canonicalJson = (value) => JSON.stringify(stableValue(value));
export const sha256Canonical = (value) => crypto
  .createHash('sha256')
  .update(Buffer.from(canonicalJson(value)))
  .digest('hex');
export const sha256Text = (value) => crypto
  .createHash('sha256')
  .update(Buffer.from(value, 'utf8'))
  .digest('hex');

const assertObject = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value;
};

const assertExactKeys = (value, keys, label) => {
  assertObject(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} must contain exact keys: ${expected.join(', ')}`);
  }
};

const assertString = (value, label) => {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} must be non-empty`);
  return value;
};

const assertInteger = (value, label, minimum = 0) => {
  if (!Number.isInteger(value) || value < minimum) {
    fail(`${label} must be an integer >= ${minimum}`);
  }
  return value;
};

const assertSha256 = (value, label) => {
  if (typeof value !== 'string' || !SHA256.test(value)) fail(`${label} must be a SHA-256`);
  return value;
};

const assertRootRelative = (value, label) => {
  assertString(value, label);
  if (path.isAbsolute(value) || value.replaceAll('\\', '/').split('/').includes('..')) {
    fail(`${label} must be repository-root-relative`);
  }
  return path.posix.normalize(value.replaceAll('\\', '/'));
};

const exactMotionPolicy = Object.freeze({
  scene_transform: 'forbidden',
  layer_transform: 'forbidden',
  mask_reveal: 'forbidden',
  internal_cut: 'forbidden',
  opacity_animation: IAN_LAYER_ENTRY_TRANSITION_VERSION,
});

const validateMotionPolicy = (value, label) => {
  assertExactKeys(value, Object.keys(exactMotionPolicy), label);
  if (canonicalJson(value) !== canonicalJson(exactMotionPolicy)) {
    fail(`${label} must forbid scene/layer transforms, masks, and internal cuts`);
  }
  return {...exactMotionPolicy};
};

const validateEntryTransition = (value, label) => {
  assertExactKeys(value, ['contract_version', 'duration_frames', 'easing'], label);
  if (value.contract_version !== IAN_LAYER_ENTRY_TRANSITION_VERSION
      || value.duration_frames !== IAN_LAYER_ENTRY_DURATION_FRAMES
      || value.easing !== 'linear') {
    fail(`${label} must use the fixed ${IAN_LAYER_ENTRY_TRANSITION_VERSION} transition`);
  }
  return {
    contract_version: IAN_LAYER_ENTRY_TRANSITION_VERSION,
    duration_frames: IAN_LAYER_ENTRY_DURATION_FRAMES,
    easing: 'linear',
  };
};

const validateLayerPlan = (layer, index, sourceBytes, durationFrames, previous) => {
  const label = `layers[${index}]`;
  assertExactKeys(layer, [
    'layer_id',
    'z_index',
    'semantic_role',
    'source_text_start_byte',
    'source_text_end_byte_exclusive',
    'source_text',
    'entry_frame',
  ], label);
  if (layer.layer_id !== `L${String(index + 1).padStart(2, '0')}`) {
    fail(`${label}.layer_id must follow ordered L01 numbering`);
  }
  if (layer.z_index !== index + 1) fail(`${label}.z_index must be contiguous from 1`);
  assertString(layer.semantic_role, `${label}.semantic_role`);
  const start = assertInteger(layer.source_text_start_byte, `${label}.source_text_start_byte`);
  const end = assertInteger(
    layer.source_text_end_byte_exclusive,
    `${label}.source_text_end_byte_exclusive`,
    1,
  );
  if (start !== previous.sourceEnd || end <= start || end > sourceBytes.length) {
    fail(`${label} source byte ranges must be positive, contiguous, and in bounds`);
  }
  const decoded = sourceBytes.subarray(start, end).toString('utf8');
  if (decoded !== layer.source_text || Buffer.from(decoded, 'utf8').length !== end - start) {
    fail(`${label}.source_text must equal its exact UTF-8 byte slice`);
  }
  const entry = assertInteger(layer.entry_frame, `${label}.entry_frame`);
  if ((index === 0 && entry !== 0)
      || (index > 0 && entry < previous.entryFrame + IAN_LAYER_ENTRY_DURATION_FRAMES)
      || entry + IAN_LAYER_ENTRY_DURATION_FRAMES > durationFrames) {
    fail(`${label}.entry_frame must be ordered, non-overlapping, and complete within the shot`);
  }
  return {
    layer_id: layer.layer_id,
    z_index: layer.z_index,
    semantic_role: layer.semantic_role,
    source_text_start_byte: start,
    source_text_end_byte_exclusive: end,
    source_text: layer.source_text,
    entry_frame: entry,
  };
};

export const validateIanLayeredScenePlan = (plan, {
  shotId,
  sourceText,
  durationFrames,
  fps = FPS,
} = {}) => {
  assertExactKeys(plan, [
    'contract_version',
    'shot_id',
    'narration_source_text_sha256',
    'scene_renderer',
    'background_policy',
    'layer_asset_policy',
    'layer_entry_transition',
    'motion_policy',
    'layer_count',
    'layers',
  ], 'Ian layered scene plan');
  if (plan.contract_version !== IAN_LAYERED_SCENE_PLAN_VERSION) {
    fail(`Ian plan must use ${IAN_LAYERED_SCENE_PLAN_VERSION}`);
  }
  const resolvedShotId = assertString(shotId ?? plan.shot_id, 'shotId');
  if (plan.shot_id !== resolvedShotId) fail('Ian plan shot_id mismatch');
  if (typeof sourceText !== 'string' || sourceText.length === 0) {
    fail('Ian plan requires exact narration source text');
  }
  const resolvedDuration = assertInteger(durationFrames, 'durationFrames', 1);
  if (fps !== FPS) fail('Ian layered scenes require 30 fps');
  if (plan.narration_source_text_sha256 !== sha256Text(sourceText)) {
    fail('Ian plan narration source-text checksum is stale');
  }
  if (plan.scene_renderer !== IAN_LAYERED_SCENE_RENDERER_VERSION
      || plan.background_policy !== 'static-paper-background-v1'
      || plan.layer_asset_policy !== 'full-canvas-transparent-png-v1') {
    fail('Ian plan renderer or raster policy is unsupported');
  }
  const transition = validateEntryTransition(
    plan.layer_entry_transition,
    'Ian plan layer_entry_transition',
  );
  const motionPolicy = validateMotionPolicy(plan.motion_policy, 'Ian plan motion_policy');
  if (!Array.isArray(plan.layers) || plan.layers.length < 1
      || plan.layer_count !== plan.layers.length) {
    fail('Ian plan requires a non-empty exact layer count');
  }
  const sourceBytes = Buffer.from(sourceText, 'utf8');
  let previous = {sourceEnd: 0, entryFrame: -IAN_LAYER_ENTRY_DURATION_FRAMES};
  const layers = plan.layers.map((layer, index) => {
    const validated = validateLayerPlan(layer, index, sourceBytes, resolvedDuration, previous);
    previous = {
      sourceEnd: validated.source_text_end_byte_exclusive,
      entryFrame: validated.entry_frame,
    };
    return validated;
  });
  if (previous.sourceEnd !== sourceBytes.length) {
    fail('Ian plan layers must cover the complete narration source text exactly once');
  }
  return {
    contract_version: IAN_LAYERED_SCENE_PLAN_VERSION,
    shot_id: resolvedShotId,
    narration_source_text_sha256: plan.narration_source_text_sha256,
    scene_renderer: IAN_LAYERED_SCENE_RENDERER_VERSION,
    background_policy: 'static-paper-background-v1',
    layer_asset_policy: 'full-canvas-transparent-png-v1',
    layer_entry_transition: transition,
    motion_policy: motionPolicy,
    layer_count: layers.length,
    layers,
  };
};

export const validateIanLayeredSceneRhythmBinding = (plan, {
  shotStartFrame,
  rhythmShot,
} = {}) => {
  assertObject(plan, 'Ian layered scene plan');
  const resolvedStartFrame = assertInteger(shotStartFrame, 'Ian shotStartFrame');
  assertObject(rhythmShot, 'Ian storyboard visual rhythm shot');
  if (rhythmShot.shot_id !== plan.shot_id) {
    fail('Ian storyboard visual rhythm shot_id differs from the scene plan');
  }
  const events = rhythmShot.meaningful_change_events;
  if (!Array.isArray(events) || !Array.isArray(plan.layers)
      || events.length < 1 || events.length !== plan.layers.length
      || rhythmShot.asset_plan?.layer_count !== plan.layers.length) {
    fail('Ian layers must equal the approved visual-rhythm layer and event count');
  }
  const entryFrames = events.map((event, index) => {
    assertObject(event, `Ian rhythm meaningful_change_events[${index}]`);
    const globalFrame = assertInteger(
      event.at_frame,
      `Ian rhythm meaningful_change_events[${index}].at_frame`,
    );
    const description = assertString(
      event.description,
      `Ian rhythm meaningful_change_events[${index}].description`,
    );
    const localFrame = globalFrame - resolvedStartFrame;
    if (localFrame !== plan.layers[index].entry_frame
        || description !== plan.layers[index].semantic_role) {
      fail(`Ian layer ${plan.layers[index].layer_id} differs from its approved narration-rhythm event`);
    }
    return localFrame;
  });
  return {
    contract_version: 'ian-layered-scene-rhythm-binding-v1',
    result: 'pass',
    shot_id: plan.shot_id,
    layer_count: plan.layers.length,
    entry_frames: entryFrames,
  };
};

const validateBinding = (value, label, {role, alpha, exact = true}) => {
  const bindingKeys = [
    'path', 'checksum_sha256', 'width', 'height', 'role', 'has_alpha',
  ];
  if (exact) assertExactKeys(value, bindingKeys, label);
  else {
    assertObject(value, label);
    for (const key of bindingKeys) {
      if (!Object.hasOwn(value, key)) fail(`${label}.${key} is required`);
    }
  }
  const binding = {
    path: assertRootRelative(value.path, `${label}.path`),
    checksum_sha256: assertSha256(value.checksum_sha256, `${label}.checksum_sha256`),
    width: value.width,
    height: value.height,
    role: value.role,
    has_alpha: value.has_alpha,
  };
  if (binding.width !== CANVAS_WIDTH || binding.height !== CANVAS_HEIGHT
      || binding.role !== role || binding.has_alpha !== alpha) {
    fail(`${label} has an invalid canvas, role, or alpha declaration`);
  }
  return binding;
};

export const validateLegacyIanLayeredScenePackageV1 = (manifest, {
  episodeWorkspace,
  queueItemId,
  shotId,
  treatmentProfileId,
  storyboardBinding,
  visualDirectionBinding,
  sourceText,
  shotStartFrame,
  shotEndFrame,
  scenePlan,
} = {}) => {
  assertExactKeys(manifest, [
    'contract_version',
    'episode_workspace',
    'queue_item_id',
    'shot_id',
    'visual_generation_route',
    'treatment_profile_id',
    'storyboard_binding',
    'visual_direction_review',
    'canvas',
    'timing',
    'narration_source_text',
    'narration_source_text_sha256',
    'scene_plan',
    'scene_plan_sha256',
    'generation_constraints',
    'background',
    'layers',
    'final_composite',
    'verified_visible_text',
  ], 'Ian layered scene package');
  if (manifest.contract_version !== IAN_LAYERED_SCENE_LEGACY_PACKAGE_VERSION
      || manifest.visual_generation_route !== 'ian-handdrawn-ppt') {
    fail(`legacy Ian package must use ${IAN_LAYERED_SCENE_LEGACY_PACKAGE_VERSION}`);
  }
  if (episodeWorkspace !== undefined && manifest.episode_workspace !== episodeWorkspace) {
    fail('Ian package episode_workspace mismatch');
  }
  if (queueItemId !== undefined && manifest.queue_item_id !== queueItemId) {
    fail('Ian package queue_item_id mismatch');
  }
  if (shotId !== undefined && manifest.shot_id !== shotId) fail('Ian package shot_id mismatch');
  if (treatmentProfileId !== undefined
      && manifest.treatment_profile_id !== treatmentProfileId) {
    fail('Ian package treatment_profile_id mismatch');
  }
  if (storyboardBinding !== undefined
      && canonicalJson(manifest.storyboard_binding) !== canonicalJson(storyboardBinding)) {
    fail('Ian package storyboard binding is stale');
  }
  if (visualDirectionBinding !== undefined
      && canonicalJson(manifest.visual_direction_review) !== canonicalJson(visualDirectionBinding)) {
    fail('Ian package visual-direction binding is stale');
  }
  assertExactKeys(manifest.canvas, ['width', 'height', 'fps'], 'Ian package canvas');
  if (manifest.canvas.width !== CANVAS_WIDTH || manifest.canvas.height !== CANVAS_HEIGHT
      || manifest.canvas.fps !== FPS) fail('Ian package canvas must be 1920x1080 at 30 fps');
  assertExactKeys(
    manifest.timing,
    ['shot_start_frame', 'shot_end_frame', 'duration_frames'],
    'Ian package timing',
  );
  const duration = manifest.timing.shot_end_frame - manifest.timing.shot_start_frame;
  if (!Number.isInteger(manifest.timing.shot_start_frame)
      || !Number.isInteger(manifest.timing.shot_end_frame)
      || manifest.timing.shot_start_frame < 0
      || manifest.timing.shot_end_frame <= manifest.timing.shot_start_frame
      || manifest.timing.duration_frames !== duration
      || (shotStartFrame !== undefined && manifest.timing.shot_start_frame !== shotStartFrame)
      || (shotEndFrame !== undefined && manifest.timing.shot_end_frame !== shotEndFrame)) {
    fail('Ian package timing is invalid or stale');
  }
  const resolvedSourceText = sourceText ?? manifest.narration_source_text;
  if (manifest.narration_source_text !== resolvedSourceText
      || manifest.narration_source_text_sha256 !== sha256Text(resolvedSourceText)) {
    fail('Ian package narration source text is stale');
  }
  const resolvedPlan = validateIanLayeredScenePlan(scenePlan ?? manifest.scene_plan, {
    shotId: manifest.shot_id,
    sourceText: resolvedSourceText,
    durationFrames: duration,
    fps: manifest.canvas.fps,
  });
  if (canonicalJson(manifest.scene_plan) !== canonicalJson(resolvedPlan)
      || manifest.scene_plan_sha256 !== sha256Canonical(resolvedPlan)) {
    fail('Ian package scene plan or checksum is stale');
  }
  const expectedConstraints = {
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
  assertExactKeys(
    manifest.generation_constraints,
    Object.keys(expectedConstraints),
    'Ian package generation_constraints',
  );
  if (canonicalJson(manifest.generation_constraints) !== canonicalJson(expectedConstraints)) {
    fail('Ian package generation constraints permit unsupported behavior');
  }
  const background = validateBinding(
    manifest.background,
    'Ian package background',
    {role: 'static-paper-background', alpha: false},
  );
  if (!Array.isArray(manifest.layers) || manifest.layers.length !== resolvedPlan.layer_count) {
    fail('Ian package layer assets do not match the scene plan');
  }
  const layers = manifest.layers.map((layer, index) => {
    const planLayer = resolvedPlan.layers[index];
    assertExactKeys(layer, [
      ...Object.keys(planLayer),
      'path',
      'checksum_sha256',
      'width',
      'height',
      'role',
      'has_alpha',
    ], `Ian package layers[${index}]`);
    for (const [key, value] of Object.entries(planLayer)) {
      if (layer[key] !== value) fail(`Ian package layers[${index}].${key} differs from the plan`);
    }
    const binding = validateBinding(layer, `Ian package layers[${index}]`, {
      role: 'transparent-semantic-element',
      alpha: true,
      exact: false,
    });
    return {...planLayer, ...binding};
  });
  const finalComposite = validateBinding(
    manifest.final_composite,
    'Ian package final_composite',
    {role: 'final-composite-review-raster', alpha: false},
  );
  if (!Array.isArray(manifest.verified_visible_text)
      || manifest.verified_visible_text.some((value) => typeof value !== 'string')) {
    fail('Ian package verified_visible_text must be an array of strings');
  }
  return {
    ...structuredClone(manifest),
    scene_plan: resolvedPlan,
    background,
    layers,
    final_composite: finalComposite,
  };
};

const expectedGenerationConstraintsV2 = Object.freeze({
  imagegen_call_count: 1,
  text_free_complete_master: true,
  independent_member_generation: false,
  deterministic_master_normalization: true,
  deterministic_semantic_region_split: true,
  deterministic_layer_text_overlay: true,
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
});

const validateFileBinding = (value, label) => {
  assertExactKeys(value, ['path', 'checksum_sha256'], label);
  return {
    path: assertRootRelative(value.path, `${label}.path`),
    checksum_sha256: assertSha256(value.checksum_sha256, `${label}.checksum_sha256`),
  };
};

const validateExternalFileBinding = (value, label) => {
  assertExactKeys(value, ['path', 'checksum_sha256', 'font_family'], label);
  const filePath = assertString(value.path, `${label}.path`);
  if (!path.isAbsolute(filePath)) fail(`${label}.path must be an absolute external font path`);
  return {
    path: filePath,
    checksum_sha256: assertSha256(value.checksum_sha256, `${label}.checksum_sha256`),
    font_family: assertString(value.font_family, `${label}.font_family`),
  };
};

const validateReferenceInput = (value, index) => {
  const label = `Ian master reference_inputs[${index}]`;
  assertExactKeys(value, ['role', 'path', 'checksum_sha256'], label);
  if (value.role !== 'visual_style_reference_only') {
    fail(`${label}.role must be visual_style_reference_only`);
  }
  if (value.path !== IAN_CANONICAL_STYLE_ANCHOR_PATH) {
    fail(`${label}.path must be the canonical Ian style anchor`);
  }
  return {
    role: value.role,
    ...validateFileBinding(
      {path: value.path, checksum_sha256: value.checksum_sha256},
      `${label} file`,
    ),
  };
};

const validateSourceMasterBinding = (value, label) => {
  assertExactKeys(value, [
    'path', 'checksum_sha256', 'width', 'height', 'role', 'has_alpha',
  ], label);
  const binding = {
    path: assertRootRelative(value.path, `${label}.path`),
    checksum_sha256: assertSha256(value.checksum_sha256, `${label}.checksum_sha256`),
    width: assertInteger(value.width, `${label}.width`, 1),
    height: assertInteger(value.height, `${label}.height`, 1),
    role: value.role,
    has_alpha: value.has_alpha,
  };
  if (binding.role !== 'text-free-complete-master-source' || binding.has_alpha !== false) {
    fail(`${label} must be an opaque text-free complete master source`);
  }
  const aspectError = Math.abs((binding.width / binding.height) - (16 / 9)) / (16 / 9);
  if (aspectError > 0.005) fail(`${label} must be within 0.5% of 16:9`);
  return binding;
};

const validateByteColor = (value, label, length) => {
  if (!Array.isArray(value) || value.length !== length
      || value.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 255)) {
    fail(`${label} must contain ${length} integer byte channels`);
  }
  return [...value];
};

const validateBbox = (value, label) => {
  assertExactKeys(value, ['x', 'y', 'width', 'height'], label);
  const bbox = {
    x: assertInteger(value.x, `${label}.x`),
    y: assertInteger(value.y, `${label}.y`),
    width: assertInteger(value.width, `${label}.width`, 1),
    height: assertInteger(value.height, `${label}.height`, 1),
  };
  if (bbox.x + bbox.width > CANVAS_WIDTH || bbox.y + bbox.height > CANVAS_HEIGHT) {
    fail(`${label} must stay inside canvas bounds`);
  }
  return bbox;
};

const rectangleDistance = (first, second) => {
  const horizontal = Math.max(
    first.x - (second.x + second.width),
    second.x - (first.x + first.width),
    0,
  );
  const vertical = Math.max(
    first.y - (second.y + second.height),
    second.y - (first.y + first.height),
    0,
  );
  return Math.hypot(horizontal, vertical);
};

const validateSplitSpec = (value, scenePlan) => {
  assertExactKeys(value, [
    'contract_version',
    'normalization',
    'matte_rgb',
    'alpha_distance_low',
    'alpha_distance_high',
    'blur_sigma_px',
    'paper_background_rgba',
    'minimum_inter_layer_gutter_px',
    'outside_union_max_visible_pixels',
    'layers',
  ], 'Ian split_spec');
  if (value.contract_version !== IAN_SEMANTIC_SPLIT_VERSION) {
    fail(`Ian split_spec must use ${IAN_SEMANTIC_SPLIT_VERSION}`);
  }
  assertExactKeys(
    value.normalization,
    ['fit', 'position', 'kernel', 'stretch', 'padding'],
    'Ian split_spec normalization',
  );
  const normalization = {
    fit: 'cover',
    position: 'centre',
    kernel: 'lanczos3',
    stretch: false,
    padding: false,
  };
  if (canonicalJson(value.normalization) !== canonicalJson(normalization)) {
    fail('Ian master normalization must use deterministic center-cover lanczos3');
  }
  const matte = validateByteColor(value.matte_rgb, 'Ian split_spec matte_rgb', 3);
  const paper = validateByteColor(
    value.paper_background_rgba,
    'Ian split_spec paper_background_rgba',
    4,
  );
  if (paper[3] !== 255) fail('Ian paper background must be fully opaque');
  const low = value.alpha_distance_low;
  const high = value.alpha_distance_high;
  if (typeof low !== 'number' || typeof high !== 'number'
      || low < 0 || high <= low || high > 64) {
    fail('Ian split alpha-distance thresholds are invalid');
  }
  const blur = value.blur_sigma_px;
  if (typeof blur !== 'number' || blur < 0.3 || blur > 2) {
    fail('Ian split blur_sigma_px must be between 0.3 and 2');
  }
  if (!Number.isInteger(value.minimum_inter_layer_gutter_px)
      || value.minimum_inter_layer_gutter_px < 8) {
    fail('Ian semantic regions require at least an 8 px gutter');
  }
  if (value.outside_union_max_visible_pixels !== OUTSIDE_UNION_MAX_VISIBLE_PIXELS) {
    fail(`Ian split outside-union limit must be ${OUTSIDE_UNION_MAX_VISIBLE_PIXELS}`);
  }
  if (!Array.isArray(value.layers) || value.layers.length !== scenePlan.layers.length) {
    fail('Ian split regions must match the scene-plan layer count');
  }
  const layers = value.layers.map((item, index) => {
    assertExactKeys(item, ['layer_id', 'bbox'], `Ian split_spec layers[${index}]`);
    if (item.layer_id !== scenePlan.layers[index].layer_id) {
      fail('Ian split regions must follow the scene-plan layer order');
    }
    return {layer_id: item.layer_id, bbox: validateBbox(item.bbox, `Ian split_spec ${item.layer_id} bbox`)};
  });
  for (let first = 0; first < layers.length; first += 1) {
    for (let second = first + 1; second < layers.length; second += 1) {
      const distance = rectangleDistance(layers[first].bbox, layers[second].bbox);
      if (distance < value.minimum_inter_layer_gutter_px) {
        fail(`Ian semantic regions ${layers[first].layer_id}/${layers[second].layer_id} overlap or lack the approved gutter`);
      }
    }
  }
  return {
    contract_version: IAN_SEMANTIC_SPLIT_VERSION,
    normalization,
    matte_rgb: matte,
    alpha_distance_low: low,
    alpha_distance_high: high,
    blur_sigma_px: blur,
    paper_background_rgba: paper,
    minimum_inter_layer_gutter_px: value.minimum_inter_layer_gutter_px,
    outside_union_max_visible_pixels: OUTSIDE_UNION_MAX_VISIBLE_PIXELS,
    layers,
  };
};

const validateTextBackground = (value, label) => {
  if (value === null) return null;
  assertExactKeys(value, [
    'fill', 'opacity', 'radius', 'stroke', 'stroke_opacity', 'stroke_width',
  ], label);
  for (const key of ['fill', 'stroke']) {
    if (typeof value[key] !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value[key])) {
      fail(`${label}.${key} must be a six-digit hex color`);
    }
  }
  for (const key of ['opacity', 'stroke_opacity']) {
    if (typeof value[key] !== 'number' || value[key] < 0 || value[key] > 1) {
      fail(`${label}.${key} must be between 0 and 1`);
    }
  }
  for (const key of ['radius', 'stroke_width']) {
    if (typeof value[key] !== 'number' || value[key] < 0) {
      fail(`${label}.${key} must be non-negative`);
    }
  }
  return structuredClone(value);
};

const validateTextOverlay = (value, splitSpec, {exactVisibleText} = {}) => {
  assertExactKeys(value, [
    'contract_version', 'mode', 'font', 'minimum_inset_px', 'labels',
  ], 'Ian text_overlay');
  if (value.contract_version !== IAN_TEXT_OVERLAY_VERSION) {
    fail(`Ian text_overlay must use ${IAN_TEXT_OVERLAY_VERSION}`);
  }
  if (!['none', 'required'].includes(value.mode)) fail('Ian text_overlay mode is invalid');
  if (value.minimum_inset_px !== MINIMUM_TEXT_INSET_PX) {
    fail(`Ian text overlay requires ${MINIMUM_TEXT_INSET_PX} px minimum inset`);
  }
  if (!Array.isArray(value.labels)) fail('Ian text_overlay labels must be an array');
  if (value.mode === 'none' && (value.font !== null || value.labels.length !== 0)) {
    fail('text-free Ian scenes may not carry a font or labels');
  }
  if (value.mode === 'required' && (value.font === null || value.labels.length === 0)) {
    fail('required Ian visible text needs a bound font and labels');
  }
  const font = value.font === null ? null : validateExternalFileBinding(value.font, 'Ian text_overlay font');
  const regionById = new Map(splitSpec.layers.map((item) => [item.layer_id, item.bbox]));
  const labels = value.labels.map((label, index) => {
    const name = `Ian text_overlay labels[${index}]`;
    assertExactKeys(label, [
      'layer_id',
      'text',
      'lines',
      'container_bbox',
      'font_size',
      'font_weight',
      'letter_spacing',
      'fill',
      'background',
    ], name);
    if (!regionById.has(label.layer_id)) fail(`${name}.layer_id is not a semantic layer`);
    const text = assertString(label.text, `${name}.text`);
    if (!Array.isArray(label.lines) || label.lines.length < 1
        || label.lines.some((line) => typeof line !== 'string' || line.length === 0)
        || label.lines.join('') !== text) {
      fail(`${name}.lines must reproduce the exact approved text`);
    }
    const container = validateBbox(label.container_bbox, `${name}.container_bbox`);
    const region = regionById.get(label.layer_id);
    if (container.x < region.x || container.y < region.y
        || container.x + container.width > region.x + region.width
        || container.y + container.height > region.y + region.height) {
      fail(`${name}.container_bbox must stay inside its owning semantic region`);
    }
    if (!Number.isInteger(label.font_size) || label.font_size < 8
        || !Number.isInteger(label.font_weight) || label.font_weight < 100
        || label.font_weight > 900 || !Number.isFinite(label.letter_spacing)) {
      fail(`${name} typography is invalid`);
    }
    if (typeof label.fill !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(label.fill)) {
      fail(`${name}.fill must be a six-digit hex color`);
    }
    return {
      layer_id: label.layer_id,
      text,
      lines: [...label.lines],
      container_bbox: container,
      font_size: label.font_size,
      font_weight: label.font_weight,
      letter_spacing: label.letter_spacing,
      fill: label.fill,
      background: validateTextBackground(label.background, `${name}.background`),
    };
  });
  const joined = labels.map((label) => label.text).join('｜');
  if (exactVisibleText !== undefined
      && joined !== (value.mode === 'none' ? '' : exactVisibleText)) {
    fail('Ian text overlay does not equal the exact approved visible text');
  }
  return {
    contract_version: IAN_TEXT_OVERLAY_VERSION,
    mode: value.mode,
    font,
    minimum_inset_px: MINIMUM_TEXT_INSET_PX,
    labels,
  };
};

const validateMasterGeneration = (value) => {
  assertExactKeys(value, [
    'contract_version',
    'generator',
    'model_id',
    'prompt',
    'reference_inputs',
    'selection_status',
    'visible_text_mode',
    'source_master',
    'visual_qa',
  ], 'Ian master_generation');
  if (value.contract_version !== IAN_MASTER_GENERATION_VERSION
      || value.generator !== 'codex-native-imagegen'
      || value.model_id !== 'gpt-image-2') {
    fail('Ian master generation must use the direct Codex gpt-image-2 route');
  }
  if (value.selection_status !== 'selected' || value.visible_text_mode !== 'none') {
    fail('Ian master generation must select one text-free complete master');
  }
  if (!Array.isArray(value.reference_inputs) || value.reference_inputs.length !== 1) {
    fail('Ian master generation must bind exactly one approved style reference');
  }
  assertExactKeys(
    value.visual_qa,
    ['result', 'inspection', 'observed_visible_text', 'observed_pseudo_text'],
    'Ian master_generation visual_qa',
  );
  if (value.visual_qa.result !== 'pass'
      || value.visual_qa.inspection !== 'human-original-resolution-v1'
      || !Array.isArray(value.visual_qa.observed_visible_text)
      || value.visual_qa.observed_visible_text.length !== 0
      || value.visual_qa.observed_pseudo_text !== false) {
    fail('Ian master visual QA must confirm no visible or pseudo text');
  }
  return {
    contract_version: IAN_MASTER_GENERATION_VERSION,
    generator: 'codex-native-imagegen',
    model_id: 'gpt-image-2',
    prompt: validateFileBinding(value.prompt, 'Ian master_generation prompt'),
    reference_inputs: value.reference_inputs.map(validateReferenceInput),
    selection_status: 'selected',
    visible_text_mode: 'none',
    source_master: validateSourceMasterBinding(
      value.source_master,
      'Ian master_generation source_master',
    ),
    visual_qa: structuredClone(value.visual_qa),
  };
};

const validateModelProvenance = (value, sourceMaster) => {
  assertExactKeys(value, [
    'contract_version',
    'generator',
    'canonical_model',
    'evidence_kind',
    'source_master_checksum_sha256',
    'expected_software_agent',
  ], 'Ian model_provenance');
  assertExactKeys(
    value.expected_software_agent,
    ['name', 'version'],
    'Ian model_provenance expected_software_agent',
  );
  if (value.contract_version !== IAN_MODEL_PROVENANCE_VERSION
      || value.generator !== 'codex-native-imagegen'
      || value.canonical_model !== 'gpt-image-2'
      || value.evidence_kind !== 'embedded-c2pa-software-agent-observation-v1'
      || value.source_master_checksum_sha256 !== sourceMaster.checksum_sha256
      || value.expected_software_agent.name !== 'gpt-image'
      || value.expected_software_agent.version !== '2.0') {
    fail('Ian model provenance must bind the gpt-image-2 C2PA software-agent observation');
  }
  return structuredClone(value);
};

const validatePlanLayerBindings = (values, plan, {role, label}) => {
  if (!Array.isArray(values) || values.length !== plan.layers.length) {
    fail(`${label} must match the exact scene-plan layer count`);
  }
  return values.map((value, index) => {
    const planLayer = plan.layers[index];
    assertExactKeys(value, [
      ...Object.keys(planLayer),
      'path',
      'checksum_sha256',
      'width',
      'height',
      'role',
      'has_alpha',
    ], `${label}[${index}]`);
    for (const [key, expected] of Object.entries(planLayer)) {
      if (value[key] !== expected) fail(`${label}[${index}].${key} differs from the scene plan`);
    }
    return {
      ...planLayer,
      ...validateBinding(value, `${label}[${index}]`, {role, alpha: true, exact: false}),
    };
  });
};

export const validateIanLayeredScenePackage = (manifest, {
  episodeWorkspace,
  queueItemId,
  shotId,
  treatmentProfileId,
  storyboardBinding,
  visualDirectionBinding,
  sourceText,
  shotStartFrame,
  shotEndFrame,
  scenePlan,
  visibleTextMode,
  exactVisibleText,
} = {}) => {
  assertExactKeys(manifest, [
    'contract_version',
    'episode_workspace',
    'queue_item_id',
    'shot_id',
    'visual_generation_route',
    'treatment_profile_id',
    'storyboard_binding',
    'visual_direction_review',
    'canvas',
    'timing',
    'narration_source_text',
    'narration_source_text_sha256',
    'scene_plan',
    'scene_plan_sha256',
    'generation_constraints',
    'master_generation',
    'model_provenance',
    'normalized_master',
    'split_spec',
    'background',
    'pre_text_layers',
    'text_overlay',
    'layers',
    'final_composite',
    'verified_visible_text',
  ], 'Ian layered scene package v2');
  if (manifest.contract_version !== IAN_LAYERED_SCENE_PACKAGE_VERSION
      || manifest.visual_generation_route !== 'ian-handdrawn-ppt') {
    fail(`active Ian package must use ${IAN_LAYERED_SCENE_PACKAGE_VERSION}`);
  }
  if (episodeWorkspace !== undefined && manifest.episode_workspace !== episodeWorkspace) {
    fail('Ian package episode_workspace mismatch');
  }
  if (queueItemId !== undefined && manifest.queue_item_id !== queueItemId) {
    fail('Ian package queue_item_id mismatch');
  }
  if (shotId !== undefined && manifest.shot_id !== shotId) fail('Ian package shot_id mismatch');
  if (treatmentProfileId !== undefined
      && manifest.treatment_profile_id !== treatmentProfileId) {
    fail('Ian package treatment_profile_id mismatch');
  }
  if (storyboardBinding !== undefined
      && canonicalJson(manifest.storyboard_binding) !== canonicalJson(storyboardBinding)) {
    fail('Ian package storyboard binding is stale');
  }
  if (visualDirectionBinding !== undefined
      && canonicalJson(manifest.visual_direction_review) !== canonicalJson(visualDirectionBinding)) {
    fail('Ian package visual-direction binding is stale');
  }
  assertExactKeys(manifest.canvas, ['width', 'height', 'fps'], 'Ian package canvas');
  if (manifest.canvas.width !== CANVAS_WIDTH || manifest.canvas.height !== CANVAS_HEIGHT
      || manifest.canvas.fps !== FPS) fail('Ian package canvas must be 1920x1080 at 30 fps');
  assertExactKeys(
    manifest.timing,
    ['shot_start_frame', 'shot_end_frame', 'duration_frames'],
    'Ian package timing',
  );
  const duration = manifest.timing.shot_end_frame - manifest.timing.shot_start_frame;
  if (!Number.isInteger(manifest.timing.shot_start_frame)
      || !Number.isInteger(manifest.timing.shot_end_frame)
      || manifest.timing.shot_start_frame < 0
      || manifest.timing.shot_end_frame <= manifest.timing.shot_start_frame
      || manifest.timing.duration_frames !== duration
      || (shotStartFrame !== undefined && manifest.timing.shot_start_frame !== shotStartFrame)
      || (shotEndFrame !== undefined && manifest.timing.shot_end_frame !== shotEndFrame)) {
    fail('Ian package timing is invalid or stale');
  }
  const resolvedSourceText = sourceText ?? manifest.narration_source_text;
  if (manifest.narration_source_text !== resolvedSourceText
      || manifest.narration_source_text_sha256 !== sha256Text(resolvedSourceText)) {
    fail('Ian package narration source text is stale');
  }
  const resolvedPlan = validateIanLayeredScenePlan(scenePlan ?? manifest.scene_plan, {
    shotId: manifest.shot_id,
    sourceText: resolvedSourceText,
    durationFrames: duration,
    fps: manifest.canvas.fps,
  });
  if (canonicalJson(manifest.scene_plan) !== canonicalJson(resolvedPlan)
      || manifest.scene_plan_sha256 !== sha256Canonical(resolvedPlan)) {
    fail('Ian package scene plan or checksum is stale');
  }
  assertExactKeys(
    manifest.generation_constraints,
    Object.keys(expectedGenerationConstraintsV2),
    'Ian package generation_constraints',
  );
  if (canonicalJson(manifest.generation_constraints)
      !== canonicalJson(expectedGenerationConstraintsV2)) {
    fail('Ian package generation constraints permit unsupported behavior');
  }
  const masterGeneration = validateMasterGeneration(manifest.master_generation);
  const modelProvenance = validateModelProvenance(
    manifest.model_provenance,
    masterGeneration.source_master,
  );
  const normalizedMaster = validateBinding(
    manifest.normalized_master,
    'Ian package normalized_master',
    {role: 'text-free-complete-master-normalized', alpha: false},
  );
  const splitSpec = validateSplitSpec(manifest.split_spec, resolvedPlan);
  const background = validateBinding(
    manifest.background,
    'Ian package background',
    {role: 'static-paper-background', alpha: false},
  );
  const preTextLayers = validatePlanLayerBindings(manifest.pre_text_layers, resolvedPlan, {
    role: 'transparent-semantic-element-pre-text',
    label: 'Ian package pre_text_layers',
  });
  const resolvedVisibleTextMode = visibleTextMode ?? manifest.text_overlay?.mode;
  if (!['none', 'required'].includes(resolvedVisibleTextMode)) {
    fail('Ian package requires an exact visible-text mode');
  }
  const textOverlay = validateTextOverlay(manifest.text_overlay, splitSpec, {exactVisibleText});
  if (textOverlay.mode !== resolvedVisibleTextMode) {
    fail('Ian text overlay mode differs from the approved visible-text mode');
  }
  const layers = validatePlanLayerBindings(manifest.layers, resolvedPlan, {
    role: 'transparent-semantic-element',
    label: 'Ian package layers',
  });
  const finalComposite = validateBinding(
    manifest.final_composite,
    'Ian package final_composite',
    {role: 'final-composite-review-raster', alpha: false},
  );
  const expectedVerifiedText = textOverlay.mode === 'none'
    ? []
    : [textOverlay.labels.map((label) => label.text).join('｜')];
  if (canonicalJson(manifest.verified_visible_text) !== canonicalJson(expectedVerifiedText)) {
    fail('Ian package verified_visible_text differs from its deterministic layer overlay');
  }
  return {
    ...structuredClone(manifest),
    scene_plan: resolvedPlan,
    generation_constraints: {...expectedGenerationConstraintsV2},
    master_generation: masterGeneration,
    model_provenance: modelProvenance,
    normalized_master: normalizedMaster,
    split_spec: splitSpec,
    background,
    pre_text_layers: preTextLayers,
    text_overlay: textOverlay,
    layers,
    final_composite: finalComposite,
    verified_visible_text: expectedVerifiedText,
  };
};

const resolvePackageMember = (repositoryRoot, episodeWorkspace, binding, label) => {
  const root = path.resolve(repositoryRoot);
  const episodeRoot = path.resolve(root, episodeWorkspace);
  const resolved = path.resolve(root, binding.path);
  const relative = path.relative(episodeRoot, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    fail(`${label} must be inside the active episode workspace`);
  }
  const status = fs.lstatSync(resolved);
  if (!status.isFile() || status.isSymbolicLink() || status.size === 0) {
    fail(`${label} must be a regular non-symlink non-empty file`);
  }
  const checksum = crypto.createHash('sha256').update(fs.readFileSync(resolved)).digest('hex');
  if (checksum !== binding.checksum_sha256) fail(`${label} checksum is stale`);
  return resolved;
};

const inspectPng = async (file, label) => {
  const image = sharp(file, {failOn: 'error'});
  const metadata = await image.metadata();
  if (metadata.format !== 'png' || metadata.width !== CANVAS_WIDTH
      || metadata.height !== CANVAS_HEIGHT) {
    fail(`${label} must decode as a 1920x1080 PNG`);
  }
  const {data, info} = await image.ensureAlpha().raw().toBuffer({resolveWithObject: true});
  let transparent = 0;
  let visible = 0;
  for (let offset = 3; offset < data.length; offset += info.channels) {
    if (data[offset] === 0) transparent += 1;
    else visible += 1;
  }
  return {metadata, data, info, transparent, visible};
};

export const composeIanLayeredSceneBytes = async ({backgroundPath, layerPaths}) => sharp(backgroundPath)
  .composite(layerPaths.map((input) => ({input, blend: 'over'})))
  .png({compressionLevel: 9, adaptiveFiltering: false, palette: false})
  .toBuffer();

const deterministicPng = Object.freeze({
  compressionLevel: 9,
  adaptiveFiltering: false,
  palette: false,
});

const smoothstep = (edge0, edge1, value) => {
  const ratio = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return ratio * ratio * (3 - (2 * ratio));
};

const escapeXml = (value) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

const labelBackgroundSvg = (label) => Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}"
    viewBox="0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}">
    <rect x="${label.container_bbox.x}" y="${label.container_bbox.y}"
      width="${label.container_bbox.width}" height="${label.container_bbox.height}"
      rx="${label.background.radius}" fill="${label.background.fill}"
      fill-opacity="${label.background.opacity}" stroke="${label.background.stroke}"
      stroke-opacity="${label.background.stroke_opacity}"
      stroke-width="${label.background.stroke_width}"/>
  </svg>
`);

const decodeUtf16Be = (bytes) => {
  if (bytes.length % 2 !== 0) fail('Ian text-overlay font has an invalid UTF-16BE name');
  let value = '';
  for (let offset = 0; offset < bytes.length; offset += 2) {
    value += String.fromCharCode(bytes.readUInt16BE(offset));
  }
  return value;
};

const normalizeFontFamily = (value) => value
  .normalize('NFKC')
  .replaceAll('\u0000', '')
  .trim()
  .replace(/\s+/g, ' ')
  .toLowerCase();

const sfntFaceOffsets = (bytes) => {
  if (bytes.length < 12) fail('Ian text-overlay font must be a valid SFNT font file');
  if (bytes.toString('ascii', 0, 4) !== 'ttcf') return [0];
  const count = bytes.readUInt32BE(8);
  if (count < 1 || count > 256 || 12 + (count * 4) > bytes.length) {
    fail('Ian text-overlay font has an invalid TrueType Collection header');
  }
  return Array.from({length: count}, (_, index) => bytes.readUInt32BE(12 + (index * 4)));
};

const sfntFamilyNames = (bytes) => {
  const families = new Set();
  for (const faceOffset of sfntFaceOffsets(bytes)) {
    if (faceOffset + 12 > bytes.length) fail('Ian text-overlay font has a truncated SFNT face');
    const scaler = bytes.toString('ascii', faceOffset, faceOffset + 4);
    const scalerNumber = bytes.readUInt32BE(faceOffset);
    if (scalerNumber !== 0x00010000 && !['OTTO', 'true', 'typ1'].includes(scaler)) {
      fail('Ian text-overlay font has an unsupported SFNT scaler type');
    }
    const tableCount = bytes.readUInt16BE(faceOffset + 4);
    const recordsEnd = faceOffset + 12 + (tableCount * 16);
    if (tableCount < 1 || tableCount > 512 || recordsEnd > bytes.length) {
      fail('Ian text-overlay font has an invalid SFNT table directory');
    }
    const tables = new Map();
    for (let index = 0; index < tableCount; index += 1) {
      const record = faceOffset + 12 + (index * 16);
      const tag = bytes.toString('ascii', record, record + 4);
      const offset = bytes.readUInt32BE(record + 8);
      const length = bytes.readUInt32BE(record + 12);
      if (offset + length > bytes.length || tables.has(tag)) {
        fail('Ian text-overlay font has an invalid SFNT table binding');
      }
      tables.set(tag, {offset, length});
    }
    for (const required of ['cmap', 'head', 'maxp', 'name']) {
      if (!tables.has(required)) fail(`Ian text-overlay font lacks required ${required} table`);
    }
    if (!['glyf', 'CFF ', 'CFF2'].some((tag) => tables.has(tag))) {
      fail('Ian text-overlay font lacks a supported glyph-outline table');
    }
    const name = tables.get('name');
    if (name.length < 6) fail('Ian text-overlay font has a truncated name table');
    const count = bytes.readUInt16BE(name.offset + 2);
    const stringsOffset = bytes.readUInt16BE(name.offset + 4);
    if (name.offset + 6 + (count * 12) > name.offset + name.length
        || stringsOffset > name.length) {
      fail('Ian text-overlay font has an invalid name-table directory');
    }
    for (let index = 0; index < count; index += 1) {
      const record = name.offset + 6 + (index * 12);
      const platform = bytes.readUInt16BE(record);
      const nameId = bytes.readUInt16BE(record + 6);
      if (![1, 16, 21].includes(nameId)) continue;
      const length = bytes.readUInt16BE(record + 8);
      const relativeOffset = bytes.readUInt16BE(record + 10);
      const start = name.offset + stringsOffset + relativeOffset;
      const end = start + length;
      if (start < name.offset || end > name.offset + name.length) {
        fail('Ian text-overlay font has an out-of-bounds family name');
      }
      const raw = bytes.subarray(start, end);
      const decoded = platform === 0 || platform === 3
        ? decodeUtf16Be(raw)
        : raw.toString('latin1');
      const normalized = normalizeFontFamily(decoded);
      if (normalized.length > 0) families.add(normalized);
    }
  }
  if (families.size === 0) fail('Ian text-overlay font declares no usable family name');
  return families;
};

const resolveBoundFontFile = (binding) => {
  const resolved = path.resolve(binding.path);
  let status;
  try {
    status = fs.lstatSync(resolved);
  } catch {
    fail('Ian text-overlay font file is missing');
  }
  if (!status.isFile() || status.isSymbolicLink() || status.size === 0) {
    fail('Ian text-overlay font must be a regular non-symlink non-empty file');
  }
  const bytes = fs.readFileSync(resolved);
  const observedChecksum = crypto.createHash('sha256').update(bytes).digest('hex');
  if (observedChecksum !== binding.checksum_sha256) {
    fail('Ian text-overlay font checksum is stale');
  }
  const declaredFamilies = sfntFamilyNames(bytes);
  if (!declaredFamilies.has(normalizeFontFamily(binding.font_family))) {
    fail('Ian text-overlay font_family is not declared by its checksum-bound font file');
  }
  return resolved;
};

const renderBoundLabel = async (label, font, fontFilePath) => {
  const box = label.container_bbox;
  const lineHeight = Math.round(label.font_size * 1.24);
  const blockHeight = lineHeight * label.lines.length;
  const blockTop = box.y + ((box.height - blockHeight) / 2);
  const composites = [];
  if (label.background) composites.push({input: labelBackgroundSvg(label), left: 0, top: 0});
  let left = CANVAS_WIDTH;
  let top = CANVAS_HEIGHT;
  let right = -1;
  let bottom = -1;
  for (let index = 0; index < label.lines.length; index += 1) {
    const markup = `<span foreground="${label.fill}" font_weight="${label.font_weight}"
      letter_spacing="${Math.round(label.letter_spacing * 1024)}">${escapeXml(label.lines[index])}</span>`;
    let glyphBytes;
    try {
      glyphBytes = await sharp({
        text: {
          text: markup,
          font: `${font.font_family} ${label.font_size}`,
          fontfile: fontFilePath,
          rgba: true,
          dpi: 72,
          wrap: 'none',
        },
      }).png(deterministicPng).toBuffer();
    } catch {
      fail(`Ian label could not render with its checksum-bound font: ${label.text}`);
    }
    const {data, info} = await sharp(glyphBytes)
      .ensureAlpha()
      .raw()
      .toBuffer({resolveWithObject: true});
    const glyphLeft = Math.round(box.x + ((box.width - info.width) / 2));
    const glyphTop = Math.round(
      blockTop + (index * lineHeight) + ((lineHeight - info.height) / 2),
    );
    let localLeft = info.width;
    let localTop = info.height;
    let localRight = -1;
    let localBottom = -1;
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        if (data[((y * info.width) + x) * info.channels + 3] === 0) continue;
        localLeft = Math.min(localLeft, x);
        localTop = Math.min(localTop, y);
        localRight = Math.max(localRight, x);
        localBottom = Math.max(localBottom, y);
      }
    }
    if (localRight < localLeft || localBottom < localTop) {
      fail(`Ian label rendered no glyph pixels: ${label.text}`);
    }
    left = Math.min(left, glyphLeft + localLeft);
    top = Math.min(top, glyphTop + localTop);
    right = Math.max(right, glyphLeft + localRight);
    bottom = Math.max(bottom, glyphTop + localBottom);
    composites.push({input: glyphBytes, left: glyphLeft, top: glyphTop});
  }
  return {
    composites,
    glyph: {x: left, y: top, width: right - left + 1, height: bottom - top + 1},
  };
};

const assertGlyphContained = (glyph, label, minimumInset) => {
  const box = label.container_bbox;
  if (glyph.x < box.x + minimumInset
      || glyph.y < box.y + minimumInset
      || glyph.x + glyph.width > box.x + box.width - minimumInset
      || glyph.y + glyph.height > box.y + box.height - minimumInset) {
    fail(`Ian label glyphs escape their approved container: ${label.text}`);
  }
};

const composeIanLayeredSceneBuffers = async ({background, layers}) => sharp(background)
  .composite(layers.map((input) => ({input, blend: 'over'})))
  .png(deterministicPng)
  .toBuffer();

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const crc32Table = Array.from({length: 256}, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return crc >>> 0;
});

const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crc32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const parsePngChunks = (bytes) => {
  if (!Buffer.isBuffer(bytes) || bytes.length < PNG_SIGNATURE.length
      || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    fail('Ian model-provenance observation requires raw PNG bytes');
  }
  const chunks = [];
  let offset = PNG_SIGNATURE.length;
  let sawIend = false;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) fail('Ian source master has a truncated PNG chunk');
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) fail('Ian source master has a truncated PNG chunk payload');
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString('ascii');
    if (!/^[A-Za-z]{4}$/.test(type)) fail('Ian source master has an invalid PNG chunk type');
    const payload = bytes.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = bytes.readUInt32BE(offset + 8 + length);
    const observedCrc = crc32(Buffer.concat([typeBytes, payload]));
    if (expectedCrc !== observedCrc) fail(`Ian source master PNG ${type} chunk CRC is invalid`);
    chunks.push({type, payload});
    offset = end;
    if (type === 'IEND') {
      if (length !== 0) fail('Ian source master PNG IEND chunk must be empty');
      sawIend = true;
      break;
    }
  }
  if (!sawIend || offset !== bytes.length) {
    fail('Ian source master PNG must end exactly at its IEND chunk');
  }
  if (chunks[0]?.type !== 'IHDR') fail('Ian source master PNG must begin with IHDR');
  return chunks;
};

const parseJumbfBoxes = (bytes, label, depth = 0) => {
  if (depth > 32) fail(`${label} exceeds the JUMBF nesting limit`);
  const boxes = [];
  let offset = 0;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) fail(`${label} has a truncated JUMBF box header`);
    const size32 = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    let headerSize = 8;
    let size = size32;
    if (size32 === 1) {
      if (offset + 16 > bytes.length) fail(`${label} has a truncated extended JUMBF box header`);
      const size64 = bytes.readBigUInt64BE(offset + 8);
      if (size64 > BigInt(Number.MAX_SAFE_INTEGER)) fail(`${label} JUMBF box is too large`);
      size = Number(size64);
      headerSize = 16;
    } else if (size32 === 0) {
      size = bytes.length - offset;
    }
    if (size < headerSize || offset + size > bytes.length || !/^[\x20-\x7e]{4}$/.test(type)) {
      fail(`${label} has an invalid JUMBF box boundary or type`);
    }
    const payload = bytes.subarray(offset + headerSize, offset + size);
    const box = {type, payload, children: []};
    if (type === 'jumb') box.children = parseJumbfBoxes(payload, `${label}/jumb`, depth + 1);
    boxes.push(box);
    offset += size;
  }
  return boxes;
};

const jumbfDescriptionLabel = (box) => {
  const description = box.children[0];
  if (box.type !== 'jumb' || description?.type !== 'jumd'
      || description.payload.length < 19) return null;
  const end = description.payload.indexOf(0, 17);
  if (end <= 17) return null;
  return description.payload.toString('utf8', 17, end);
};

const collectJumbfSuperboxes = (boxes, output = []) => {
  for (const box of boxes) {
    if (box.type !== 'jumb') continue;
    output.push(box);
    collectJumbfSuperboxes(box.children, output);
  }
  return output;
};

const decodeCbor = (bytes) => {
  let offset = 0;
  const readLength = (additional) => {
    if (additional < 24) return additional;
    const widths = new Map([[24, 1], [25, 2], [26, 4], [27, 8]]);
    const width = widths.get(additional);
    if (!width || offset + width > bytes.length) fail('Ian C2PA actions assertion has invalid CBOR length');
    let value;
    if (width === 1) value = bytes.readUInt8(offset);
    else if (width === 2) value = bytes.readUInt16BE(offset);
    else if (width === 4) value = bytes.readUInt32BE(offset);
    else {
      const large = bytes.readBigUInt64BE(offset);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) fail('Ian C2PA actions CBOR value is too large');
      value = Number(large);
    }
    offset += width;
    return value;
  };
  const parse = (depth = 0) => {
    if (depth > 32 || offset >= bytes.length) fail('Ian C2PA actions assertion has invalid CBOR nesting');
    const initial = bytes[offset];
    offset += 1;
    const major = initial >>> 5;
    const additional = initial & 31;
    if (additional === 31) fail('Ian C2PA actions assertion may not use indefinite CBOR values');
    const length = readLength(additional);
    if (major === 0) return length;
    if (major === 1) return -1 - length;
    if (major === 2 || major === 3) {
      if (offset + length > bytes.length) fail('Ian C2PA actions assertion has truncated CBOR data');
      const value = bytes.subarray(offset, offset + length);
      offset += length;
      return major === 2 ? Buffer.from(value) : value.toString('utf8');
    }
    if ((major === 4 || major === 5) && length > bytes.length) {
      fail('Ian C2PA actions assertion has an unreasonable CBOR collection length');
    }
    if (major === 4) return Array.from({length}, () => parse(depth + 1));
    if (major === 5) {
      const value = Object.create(null);
      for (let index = 0; index < length; index += 1) {
        const key = parse(depth + 1);
        if (typeof key !== 'string' || Object.hasOwn(value, key)) {
          fail('Ian C2PA actions assertion requires unique text CBOR map keys');
        }
        value[key] = parse(depth + 1);
      }
      return value;
    }
    if (major === 6) return parse(depth + 1);
    if (major === 7 && [20, 21, 22].includes(additional)) {
      return additional === 20 ? false : (additional === 21 ? true : null);
    }
    fail('Ian C2PA actions assertion uses unsupported CBOR data');
  };
  const value = parse();
  if (offset !== bytes.length) fail('Ian C2PA actions assertion has trailing CBOR data');
  return value;
};

export const observeGptImage2SoftwareAgent = (bytes) => {
  const caBxPayloads = parsePngChunks(bytes)
    .filter((chunk) => chunk.type === 'caBX')
    .map((chunk) => chunk.payload);
  if (caBxPayloads.length === 0) {
    fail('Ian source master lacks the required C2PA gpt-image/2.0 software-agent observation');
  }
  let observed = false;
  for (let index = 0; index < caBxPayloads.length && !observed; index += 1) {
    const topLevel = parseJumbfBoxes(caBxPayloads[index], `Ian PNG caBX[${index}]`);
    const roots = topLevel.filter((box) => jumbfDescriptionLabel(box) === 'c2pa');
    for (const root of roots) {
      const superboxes = collectJumbfSuperboxes([root]);
      const byLabel = (value) => superboxes.find((box) => jumbfDescriptionLabel(box) === value);
      const actionsBox = byLabel('c2pa.actions.v2');
      const claimBox = byLabel('c2pa.claim.v2');
      const signatureBox = byLabel('c2pa.signature');
      if (!actionsBox || !claimBox || !signatureBox) continue;
      const actionPayloads = actionsBox.children.filter((box) => box.type === 'cbor');
      if (actionPayloads.length !== 1) continue;
      const assertion = decodeCbor(actionPayloads[0].payload);
      if (!Array.isArray(assertion?.actions)) continue;
      observed = assertion.actions.some((action) => (
        action?.action === 'c2pa.created'
        && action?.softwareAgent?.name === 'gpt-image'
        && action?.softwareAgent?.version === '2.0'
      ));
      if (observed) break;
    }
  }
  if (!observed) {
    fail('Ian source master lacks the required C2PA gpt-image/2.0 software-agent observation');
  }
  return {
    contract_version: 'embedded-c2pa-software-agent-observation-v1',
    evidence_kind: 'observation-not-signature-verification',
    software_agent_name: 'gpt-image',
    software_agent_version: '2.0',
  };
};

export const deriveIanLayeredSceneV2Bytes = async ({
  sourceMasterBytes,
  splitSpec,
  textOverlay,
  scenePlan,
}) => {
  const resolvedSplit = validateSplitSpec(splitSpec, scenePlan);
  const resolvedText = validateTextOverlay(textOverlay, resolvedSplit);
  const fontFilePath = resolvedText.font === null
    ? null
    : resolveBoundFontFile(resolvedText.font);
  const normalizedMaster = await sharp(sourceMasterBytes, {failOn: 'error'})
    .resize(CANVAS_WIDTH, CANVAS_HEIGHT, {
      fit: 'cover',
      position: 'centre',
      kernel: sharp.kernel.lanczos3,
    })
    .removeAlpha()
    .png(deterministicPng)
    .toBuffer();
  const {data: rgb, info} = await sharp(normalizedMaster)
    .removeAlpha()
    .raw()
    .toBuffer({resolveWithObject: true});
  if (info.width !== CANVAS_WIDTH || info.height !== CANVAS_HEIGHT || info.channels !== 3) {
    fail('Ian normalized master did not decode as 1920x1080 RGB');
  }
  const regionIndex = new Int16Array(CANVAS_WIDTH * CANVAS_HEIGHT);
  regionIndex.fill(-1);
  for (let index = 0; index < resolvedSplit.layers.length; index += 1) {
    const {bbox} = resolvedSplit.layers[index];
    for (let y = bbox.y; y < bbox.y + bbox.height; y += 1) {
      for (let x = bbox.x; x < bbox.x + bbox.width; x += 1) {
        const pixel = (y * CANVAS_WIDTH) + x;
        if (regionIndex[pixel] !== -1) fail('Ian semantic split regions overlap');
        regionIndex[pixel] = index;
      }
    }
  }
  let outsideUnionVisiblePixels = 0;
  for (let pixel = 0; pixel < regionIndex.length; pixel += 1) {
    if (regionIndex[pixel] !== -1) continue;
    const offset = pixel * 3;
    const distance = Math.hypot(
      rgb[offset] - resolvedSplit.matte_rgb[0],
      rgb[offset + 1] - resolvedSplit.matte_rgb[1],
      rgb[offset + 2] - resolvedSplit.matte_rgb[2],
    );
    if (distance > resolvedSplit.alpha_distance_low) outsideUnionVisiblePixels += 1;
  }
  if (outsideUnionVisiblePixels > resolvedSplit.outside_union_max_visible_pixels) {
    fail(`Ian master has ${outsideUnionVisiblePixels} visible pixels outside approved semantic regions`);
  }
  const paper = resolvedSplit.paper_background_rgba;
  const background = await sharp({
    create: {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      channels: 4,
      background: {r: paper[0], g: paper[1], b: paper[2], alpha: paper[3] / 255},
    },
  }).png(deterministicPng).toBuffer();
  const alphaBuffers = [];
  const preTextLayers = [];
  for (let index = 0; index < resolvedSplit.layers.length; index += 1) {
    const {bbox} = resolvedSplit.layers[index];
    const alphaSeed = Buffer.alloc(CANVAS_WIDTH * CANVAS_HEIGHT);
    for (let y = bbox.y; y < bbox.y + bbox.height; y += 1) {
      for (let x = bbox.x; x < bbox.x + bbox.width; x += 1) {
        const pixel = (y * CANVAS_WIDTH) + x;
        const offset = pixel * 3;
        const distance = Math.hypot(
          rgb[offset] - resolvedSplit.matte_rgb[0],
          rgb[offset + 1] - resolvedSplit.matte_rgb[1],
          rgb[offset + 2] - resolvedSplit.matte_rgb[2],
        );
        alphaSeed[pixel] = Math.round(smoothstep(
          resolvedSplit.alpha_distance_low,
          resolvedSplit.alpha_distance_high,
          distance,
        ) * 255);
      }
    }
    const {data: blurred, info: blurInfo} = await sharp(alphaSeed, {
      raw: {width: CANVAS_WIDTH, height: CANVAS_HEIGHT, channels: 1},
    }).blur(resolvedSplit.blur_sigma_px).raw().toBuffer({resolveWithObject: true});
    const alpha = Buffer.alloc(CANVAS_WIDTH * CANVAS_HEIGHT);
    let visible = 0;
    let transparent = 0;
    for (let pixel = 0; pixel < alpha.length; pixel += 1) {
      const value = blurred[pixel * blurInfo.channels];
      alpha[pixel] = value < 1 ? 0 : (value > 254 ? 255 : value);
      if (alpha[pixel] === 0) transparent += 1;
      else visible += 1;
    }
    if (visible === 0 || transparent === 0) {
      fail(`Ian derived layer ${resolvedSplit.layers[index].layer_id} lacks visible or transparent pixels`);
    }
    alphaBuffers.push(alpha);
    const rgba = Buffer.alloc(CANVAS_WIDTH * CANVAS_HEIGHT * 4);
    for (let pixel = 0; pixel < alpha.length; pixel += 1) {
      const alphaByte = alpha[pixel];
      const rgbOffset = pixel * 3;
      const rgbaOffset = pixel * 4;
      if (alphaByte > 0) {
        const fraction = alphaByte / 255;
        for (let channel = 0; channel < 3; channel += 1) {
          const recovered = (
            rgb[rgbOffset + channel]
            - ((1 - fraction) * resolvedSplit.matte_rgb[channel])
          ) / fraction;
          rgba[rgbaOffset + channel] = Math.max(0, Math.min(255, Math.round(recovered)));
        }
      }
      rgba[rgbaOffset + 3] = alphaByte;
    }
    preTextLayers.push(await sharp(rgba, {
      raw: {width: CANVAS_WIDTH, height: CANVAS_HEIGHT, channels: 4},
    }).png(deterministicPng).toBuffer());
  }
  for (let first = 0; first < alphaBuffers.length; first += 1) {
    for (let second = first + 1; second < alphaBuffers.length; second += 1) {
      for (let pixel = 0; pixel < alphaBuffers[first].length; pixel += 1) {
        if (alphaBuffers[first][pixel] > 1 && alphaBuffers[second][pixel] > 1) {
          fail(`Ian derived layers ${resolvedSplit.layers[first].layer_id}/${resolvedSplit.layers[second].layer_id} overlap`);
        }
      }
    }
  }
  const glyphMeasurements = [];
  const layers = [];
  for (let index = 0; index < preTextLayers.length; index += 1) {
    const layerId = resolvedSplit.layers[index].layer_id;
    const labels = resolvedText.labels.filter((label) => label.layer_id === layerId);
    if (labels.length === 0) {
      layers.push(preTextLayers[index]);
      continue;
    }
    const composites = [];
    for (const label of labels) {
      const rendered = await renderBoundLabel(label, resolvedText.font, fontFilePath);
      assertGlyphContained(rendered.glyph, label, resolvedText.minimum_inset_px);
      glyphMeasurements.push({
        layer_id: layerId,
        text: label.text,
        glyph_bbox: rendered.glyph,
      });
      composites.push(...rendered.composites);
    }
    layers.push(await sharp(preTextLayers[index])
      .composite(composites.map((item) => ({...item, blend: 'over'})))
      .png(deterministicPng)
      .toBuffer());
  }
  const finalComposite = await composeIanLayeredSceneBuffers({background, layers});
  return {
    normalizedMaster,
    background,
    preTextLayers,
    layers,
    finalComposite,
    outsideUnionVisiblePixels,
    glyphMeasurements,
  };
};

export const inspectLegacyIanLayeredScenePackageV1 = async (manifest, {
  repositoryRoot,
  episodeWorkspace,
  ...expected
}) => {
  const validated = validateLegacyIanLayeredScenePackageV1(manifest, {
    episodeWorkspace,
    ...expected,
  });
  const backgroundPath = resolvePackageMember(
    repositoryRoot,
    episodeWorkspace,
    validated.background,
    'Ian background',
  );
  const background = await inspectPng(backgroundPath, 'Ian background');
  if (background.transparent !== 0) fail('Ian background must be fully opaque');
  const layerPaths = [];
  for (const layer of validated.layers) {
    const layerPath = resolvePackageMember(
      repositoryRoot,
      episodeWorkspace,
      layer,
      `Ian layer ${layer.layer_id}`,
    );
    const pixels = await inspectPng(layerPath, `Ian layer ${layer.layer_id}`);
    if (pixels.transparent === 0 || pixels.visible === 0) {
      fail(`Ian layer ${layer.layer_id} must contain both transparent and visible pixels`);
    }
    layerPaths.push(layerPath);
  }
  const finalPath = resolvePackageMember(
    repositoryRoot,
    episodeWorkspace,
    validated.final_composite,
    'Ian final composite',
  );
  const final = await inspectPng(finalPath, 'Ian final composite');
  if (final.transparent !== 0) fail('Ian final composite must be fully opaque');
  const recomposed = await composeIanLayeredSceneBytes({backgroundPath, layerPaths});
  if (!recomposed.equals(fs.readFileSync(finalPath))) {
    fail('Ian final composite differs from deterministic background-plus-layers recomposition');
  }
  return {
    contract_version: IAN_LAYERED_SCENE_LEGACY_PACKAGE_VERSION,
    result: 'pass',
    package: validated,
    member_count: 2 + validated.layers.length,
    deterministic_composite_match: true,
  };
};

const resolveRepositoryFile = (repositoryRoot, binding, label) => {
  const root = path.resolve(repositoryRoot);
  const resolved = path.resolve(root, binding.path);
  if (!resolved.startsWith(`${root}${path.sep}`)) fail(`${label} escapes repository root`);
  const status = fs.lstatSync(resolved);
  if (!status.isFile() || status.isSymbolicLink() || status.size === 0) {
    fail(`${label} must be a regular non-symlink non-empty file`);
  }
  const bytes = fs.readFileSync(resolved);
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== binding.checksum_sha256) {
    fail(`${label} checksum is stale`);
  }
  return {resolved, bytes};
};

const inspectSourceMaster = async (file, binding) => {
  const metadata = await sharp(file, {failOn: 'error'}).metadata();
  if (metadata.format !== 'png' || metadata.width !== binding.width
      || metadata.height !== binding.height || metadata.hasAlpha === true) {
    fail('Ian source master must decode as its declared opaque PNG dimensions');
  }
  return metadata;
};

const inspectCanonicalStyleAnchor = async (file, label) => {
  let metadata;
  try {
    const image = sharp(file, {failOn: 'error'});
    metadata = await image.metadata();
    await image.raw().toBuffer();
  } catch {
    fail(`${label} must decode as the canonical 1920x1080 RGB/RGBA PNG`);
  }
  if (metadata.format !== 'png'
      || metadata.width !== CANVAS_WIDTH
      || metadata.height !== CANVAS_HEIGHT
      || ![3, 4].includes(metadata.channels)
      || metadata.depth !== 'uchar'
      || metadata.isPalette === true) {
    fail(`${label} must decode as the canonical 1920x1080 RGB/RGBA PNG`);
  }
  return metadata;
};

const compareDerivedMember = (actualBytes, expectedBytes, label) => {
  if (!actualBytes.equals(expectedBytes)) fail(`${label} differs from deterministic derivation`);
};

export const inspectIanLayeredScenePackage = async (manifest, {
  repositoryRoot,
  episodeWorkspace,
  ...expected
}) => {
  const validated = validateIanLayeredScenePackage(manifest, {
    episodeWorkspace,
    ...expected,
  });
  const promptPath = resolvePackageMember(
    repositoryRoot,
    episodeWorkspace,
    validated.master_generation.prompt,
    'Ian complete-master prompt',
  );
  const prompt = {resolved: promptPath, bytes: fs.readFileSync(promptPath)};
  const promptText = prompt.bytes.toString('utf8');
  const normalizedPromptText = promptText.toLowerCase();
  if (!promptText.includes('16:9 landscape composition')
      || ![
        'no visible text',
        'text: none',
        'no written characters',
      ].some((phrase) => normalizedPromptText.includes(phrase))) {
    fail('Ian complete-master prompt must require 16:9 landscape composition and an explicit text-free master');
  }
  for (let index = 0; index < validated.master_generation.reference_inputs.length; index += 1) {
    const reference = resolveRepositoryFile(
      repositoryRoot,
      validated.master_generation.reference_inputs[index],
      `Ian master style anchor ${index}`,
    );
    await inspectCanonicalStyleAnchor(
      reference.resolved,
      `Ian master style anchor ${index}`,
    );
  }
  const sourceMasterPath = resolvePackageMember(
    repositoryRoot,
    episodeWorkspace,
    validated.master_generation.source_master,
    'Ian complete source master',
  );
  await inspectSourceMaster(sourceMasterPath, validated.master_generation.source_master);
  const sourceMasterBytes = fs.readFileSync(sourceMasterPath);
  const modelObservation = observeGptImage2SoftwareAgent(sourceMasterBytes);
  const derived = await deriveIanLayeredSceneV2Bytes({
    sourceMasterBytes,
    splitSpec: validated.split_spec,
    textOverlay: validated.text_overlay,
    scenePlan: validated.scene_plan,
  });
  const normalizedPath = resolvePackageMember(
    repositoryRoot,
    episodeWorkspace,
    validated.normalized_master,
    'Ian normalized complete master',
  );
  compareDerivedMember(
    fs.readFileSync(normalizedPath),
    derived.normalizedMaster,
    'Ian normalized complete master',
  );
  const normalizedInspection = await inspectPng(normalizedPath, 'Ian normalized complete master');
  if (normalizedInspection.transparent !== 0) fail('Ian normalized complete master must be opaque');
  const backgroundPath = resolvePackageMember(
    repositoryRoot,
    episodeWorkspace,
    validated.background,
    'Ian background',
  );
  compareDerivedMember(fs.readFileSync(backgroundPath), derived.background, 'Ian background');
  const backgroundInspection = await inspectPng(backgroundPath, 'Ian background');
  if (backgroundInspection.transparent !== 0) fail('Ian background must be fully opaque');
  const preTextPaths = [];
  const layerPaths = [];
  for (let index = 0; index < validated.layers.length; index += 1) {
    const preTextPath = resolvePackageMember(
      repositoryRoot,
      episodeWorkspace,
      validated.pre_text_layers[index],
      `Ian pre-text layer ${validated.pre_text_layers[index].layer_id}`,
    );
    compareDerivedMember(
      fs.readFileSync(preTextPath),
      derived.preTextLayers[index],
      `Ian pre-text layer ${validated.pre_text_layers[index].layer_id}`,
    );
    const preTextPixels = await inspectPng(
      preTextPath,
      `Ian pre-text layer ${validated.pre_text_layers[index].layer_id}`,
    );
    if (preTextPixels.transparent === 0 || preTextPixels.visible === 0) {
      fail(`Ian pre-text layer ${validated.pre_text_layers[index].layer_id} must contain transparent and visible pixels`);
    }
    preTextPaths.push(preTextPath);
    const layerPath = resolvePackageMember(
      repositoryRoot,
      episodeWorkspace,
      validated.layers[index],
      `Ian layer ${validated.layers[index].layer_id}`,
    );
    compareDerivedMember(
      fs.readFileSync(layerPath),
      derived.layers[index],
      `Ian layer ${validated.layers[index].layer_id}`,
    );
    const pixels = await inspectPng(layerPath, `Ian layer ${validated.layers[index].layer_id}`);
    if (pixels.transparent === 0 || pixels.visible === 0) {
      fail(`Ian layer ${validated.layers[index].layer_id} must contain transparent and visible pixels`);
    }
    layerPaths.push(layerPath);
  }
  const finalPath = resolvePackageMember(
    repositoryRoot,
    episodeWorkspace,
    validated.final_composite,
    'Ian final composite',
  );
  compareDerivedMember(fs.readFileSync(finalPath), derived.finalComposite, 'Ian final composite');
  const final = await inspectPng(finalPath, 'Ian final composite');
  if (final.transparent !== 0) fail('Ian final composite must be fully opaque');
  const recomposed = await composeIanLayeredSceneBytes({backgroundPath, layerPaths});
  if (!recomposed.equals(fs.readFileSync(finalPath))) {
    fail('Ian final composite differs from deterministic background-plus-layers recomposition');
  }
  return {
    contract_version: IAN_LAYERED_SCENE_PACKAGE_VERSION,
    result: 'pass',
    package: validated,
    member_count: 4 + (validated.layers.length * 2),
    model_provenance_observation: modelObservation,
    deterministic_master_normalization_match: true,
    deterministic_semantic_split_match: true,
    deterministic_text_overlay_match: true,
    deterministic_composite_match: true,
    outside_union_visible_pixels: derived.outsideUnionVisiblePixels,
    glyph_measurements: derived.glyphMeasurements,
  };
};
