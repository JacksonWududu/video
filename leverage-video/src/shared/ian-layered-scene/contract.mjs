import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

export const IAN_LAYERED_SCENE_PLAN_VERSION = 'ian-layered-scene-plan-v1';
export const IAN_LAYERED_SCENE_PACKAGE_VERSION = 'ian-knowledge-video-layered-scene-v1';
export const IAN_LAYERED_SCENE_RENDERER_VERSION = 'ian-static-layered-scene-v1';
export const IAN_LAYER_ENTRY_TRANSITION_VERSION = 'ian-layer-entry-fade-v1';
export const IAN_LAYER_ENTRY_DURATION_FRAMES = 8;

const SHA256 = /^[a-f0-9]{64}$/;
const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;
const FPS = 30;

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
  if (manifest.contract_version !== IAN_LAYERED_SCENE_PACKAGE_VERSION
      || manifest.visual_generation_route !== 'ian-handdrawn-ppt') {
    fail(`Ian package must use ${IAN_LAYERED_SCENE_PACKAGE_VERSION}`);
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

export const inspectIanLayeredScenePackage = async (manifest, {
  repositoryRoot,
  episodeWorkspace,
  ...expected
}) => {
  const validated = validateIanLayeredScenePackage(manifest, {
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
    contract_version: IAN_LAYERED_SCENE_PACKAGE_VERSION,
    result: 'pass',
    package: validated,
    member_count: 2 + validated.layers.length,
    deterministic_composite_match: true,
  };
};
