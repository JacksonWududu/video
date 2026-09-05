#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import sharp from 'sharp';

import {
  IAN_BOTTOM_SUBTITLE_SAFE_AREA_POLICY,
  IAN_BOTTOM_SUBTITLE_SAFE_AREA_PROMPT_MARKER,
  IAN_CANONICAL_STYLE_ANCHOR_PATH,
  deriveIanLayeredSceneV2Bytes,
  inspectIanLayeredScenePackage,
  observeGptImage2SoftwareAgent,
  sha256Canonical,
  sha256Text,
  validateIanLayeredScenePlan,
  validateIanLayeredScenePackage,
  validateIanBottomSubtitleSafeArea,
} from './contract.mjs';
import {validateIanTextContainment} from '../visual-assets/validate-ian-text-containment.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(HERE, '../../../..');
const SHA256 = /^[a-f0-9]{64}$/;
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const generationConstraints = {
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
};

const fail = (message) => { throw new Error(message); };
const resolveRootRelative = (value, label) => {
  if (typeof value !== 'string' || value === '' || path.isAbsolute(value)
    || value.replaceAll('\\', '/').split('/').includes('..')) fail(`${label} must be root-relative`);
  const resolved = path.resolve(REPOSITORY_ROOT, value);
  if (!resolved.startsWith(`${REPOSITORY_ROOT}${path.sep}`)) fail(`${label} escapes repository root`);
  return resolved;
};
const resolveEpisodeMember = (episodeWorkspace, value, label) => {
  const episode = resolveRootRelative(episodeWorkspace, 'episode workspace');
  const resolved = resolveRootRelative(value, label);
  const relative = path.relative(episode, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    fail(`${label} must be inside episode workspace`);
  }
  return resolved;
};
const readBinding = (binding, label, {episodeWorkspace, insideEpisode = false} = {}) => {
  if (!binding || typeof binding !== 'object' || !SHA256.test(binding.checksum_sha256 ?? '')) {
    fail(`${label} binding is invalid`);
  }
  const resolved = insideEpisode
    ? resolveEpisodeMember(episodeWorkspace, binding.path, `${label} path`)
    : resolveRootRelative(binding.path, `${label} path`);
  const status = fs.lstatSync(resolved);
  if (!status.isFile() || status.isSymbolicLink() || status.size === 0) {
    fail(`${label} must be a regular non-empty file`);
  }
  const bytes = fs.readFileSync(resolved);
  if (sha256(bytes) !== binding.checksum_sha256) fail(`${label} checksum is stale`);
  return {resolved, bytes};
};
const assertOutputPaths = (episodeWorkspace, output, count, required) => {
  const names = [
    'manifest_path', 'qa_skeleton_path', 'normalized_master_path', 'background_path',
    'final_composite_path',
    ...(required ? ['containment_spec_path', 'containment_evidence_path'] : []),
  ];
  if (!Array.isArray(output?.pre_text_layer_paths) || output.pre_text_layer_paths.length !== count
    || !Array.isArray(output?.layer_paths) || output.layer_paths.length !== count) {
    fail('output layer paths must match scene-plan layer count');
  }
  const paths = [...names.map((name) => output?.[name]), ...output.pre_text_layer_paths, ...output.layer_paths];
  if (paths.some((value) => typeof value !== 'string' || value === '')) fail('output paths are incomplete');
  const resolved = paths.map((value, index) => resolveEpisodeMember(episodeWorkspace, value, `output path ${index}`));
  if (new Set(resolved).size !== resolved.length) fail('output paths must be unique');
  if (resolved.some((value) => fs.existsSync(value))) fail('refusing to overwrite an existing output');
  return {paths, resolved};
};
const writeExclusive = (target, bytes) => {
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, bytes, {flag: 'wx'});
};
const rasterBinding = (relativePath, bytes, role, hasAlpha, width = 1920, height = 1080) => ({
  path: relativePath,
  checksum_sha256: sha256(bytes),
  width,
  height,
  role,
  has_alpha: hasAlpha,
});
const layerBinding = (planLayer, relativePath, bytes, role) => ({
  ...planLayer,
  ...rasterBinding(relativePath, bytes, role, true),
});

const validateReference = async (reference) => {
  if (!Array.isArray(reference) || reference.length !== 1
    || reference[0]?.role !== 'visual_style_reference_only'
    || reference[0]?.path !== IAN_CANONICAL_STYLE_ANCHOR_PATH) {
    fail('reference_inputs must contain exactly the canonical Ian style anchor');
  }
  const anchor = readBinding(reference[0], 'Ian style anchor');
  const image = sharp(anchor.bytes, {failOn: 'error'});
  const metadata = await image.metadata();
  await image.raw().toBuffer();
  if (metadata.format !== 'png' || metadata.width !== 1920 || metadata.height !== 1080
    || ![3, 4].includes(metadata.channels) || metadata.depth !== 'uchar' || metadata.isPalette === true) {
    fail('Ian style anchor must decode as canonical 1920x1080 RGB/RGBA PNG');
  }
  return reference;
};
const validateFont = (overlay) => {
  if (overlay?.mode === 'none') return;
  const font = overlay?.font;
  if (!font || !path.isAbsolute(font.path) || !SHA256.test(font.checksum_sha256 ?? '')) {
    fail('required text overlay needs a checksum-bound absolute font');
  }
  const status = fs.lstatSync(font.path);
  if (!status.isFile() || status.isSymbolicLink() || sha256(fs.readFileSync(font.path)) !== font.checksum_sha256) {
    fail('Ian text overlay font checksum is stale');
  }
};

const validateRejectedAttempts = (values, episodeWorkspace) => {
  if (values === undefined) return [];
  if (!Array.isArray(values)) fail('rejected_attempts must be an array');
  return values.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(['checksum_sha256', 'path'])) {
      fail(`rejected_attempts[${index}] must be an exact file binding`);
    }
    readBinding(value, `rejected attempt ${index}`, {episodeWorkspace, insideEpisode: true});
    return {...value};
  });
};

export const buildIanLayeredScenePackage = async ({episodeWorkspace, config}) => {
  if (!config || typeof config !== 'object') fail('build config must be an object');
  const item = config.queue_item;
  if (!item || typeof item !== 'object') fail('queue_item is required');
  const source = readBinding(config.source_master, 'source master', {episodeWorkspace, insideEpisode: true});
  const sourceMetadata = await sharp(source.bytes, {failOn: 'error'}).metadata();
  if (sourceMetadata.format !== 'png' || sourceMetadata.hasAlpha === true) {
    fail('source master must be an opaque PNG');
  }
  const observation = observeGptImage2SoftwareAgent(source.bytes);
  const prompt = readBinding(config.prompt, 'generation prompt', {episodeWorkspace, insideEpisode: true});
  const promptText = prompt.bytes.toString('utf8');
  if (!promptText.includes('16:9 landscape composition')
    || !['no visible text', 'text: none', 'no written characters'].some((phrase) => promptText.toLowerCase().includes(phrase))) {
    fail('generation prompt must require 16:9 and a text-free master');
  }
  const referenceInputs = await validateReference(config.reference_inputs);
  validateFont(config.text_overlay);
  const rejectedAttempts = validateRejectedAttempts(config.rejected_attempts, episodeWorkspace);
  const scenePlan = validateIanLayeredScenePlan(item.ian_scene_plan, {
    shotId: item.shot_id,
    sourceText: item.narration_source_text,
    durationFrames: item.shot_end_frame - item.shot_start_frame,
  });
  if (item.asset_id == null || item.treatment_profile_id == null
    || !SHA256.test(item.storyboard_checksum_sha256 ?? '')
    || !SHA256.test(item.visual_direction_review_checksum_sha256 ?? '')
    || !SHA256.test(item.visual_direction_presented_map_sha256 ?? '')) {
    fail('queue_item bindings are incomplete');
  }
  const required = config.text_overlay?.mode === 'required';
  if (Object.hasOwn(config.split_spec ?? {}, 'subtitle_safe_area')) {
    validateIanBottomSubtitleSafeArea(
      config.split_spec.subtitle_safe_area,
      'build config split_spec.subtitle_safe_area',
    );
  }
  const repairFailure = config.split_spec?.layout_repair?.source_failure;
  const sameBinding = (left, right) => left?.path === right?.path
    && left?.checksum_sha256 === right?.checksum_sha256;
  const auditedHistoricalPromptRelayout = Object.hasOwn(
    config.split_spec ?? {},
    'subtitle_safe_area',
  )
    && config.split_spec?.layout_repair?.contract_version
      === 'ian-pre-split-layout-repair-v1'
    && typeof config.split_spec.layout_repair.authorization?.exact_user_message === 'string'
    && config.split_spec.layout_repair.authorization.exact_user_message.trim() !== ''
    && sameBinding(repairFailure?.prompt, config.prompt)
    && sameBinding(repairFailure?.output, config.source_master)
    && rejectedAttempts.some((binding) => sameBinding(binding, config.source_master));
  if (!promptText.includes(IAN_BOTTOM_SUBTITLE_SAFE_AREA_PROMPT_MARKER)
      && !auditedHistoricalPromptRelayout) {
    fail('generation prompt must require the Ian 23% bottom subtitle safe area; only an audited deterministic relayout may reuse an earlier rejected source and its unchanged historical prompt');
  }
  const splitSpec = {
    ...config.split_spec,
    subtitle_safe_area: structuredClone(IAN_BOTTOM_SUBTITLE_SAFE_AREA_POLICY),
  };
  if (!['none', 'required'].includes(item.visible_text_mode)
    || config.text_overlay?.mode !== item.visible_text_mode
    || (required
      ? (typeof item.exact_visible_text !== 'string' || item.exact_visible_text.trim() === ''
        || typeof item.visible_text_placement !== 'string'
        || item.visible_text_placement.trim() === '')
      : (item.exact_visible_text !== null || item.visible_text_placement !== null))) {
    fail('Ian text overlay must bind the approved visible text mode, exact copy, and placement');
  }
  assertOutputPaths(episodeWorkspace, config.output, scenePlan.layer_count, required);
  const derived = await deriveIanLayeredSceneV2Bytes({
    sourceMasterBytes: source.bytes,
    splitSpec,
    textOverlay: config.text_overlay,
    scenePlan,
  });
  const output = config.output;
  const manifest = {
    contract_version: 'ian-knowledge-video-layered-scene-v2',
    episode_workspace: episodeWorkspace,
    queue_item_id: item.asset_id,
    shot_id: item.shot_id,
    visual_generation_route: 'ian-handdrawn-ppt',
    treatment_profile_id: item.treatment_profile_id,
    storyboard_binding: {path: item.storyboard_path, checksum_sha256: item.storyboard_checksum_sha256},
    visual_direction_review: {
      path: item.visual_direction_review_path,
      checksum_sha256: item.visual_direction_review_checksum_sha256,
      presented_map_sha256: item.visual_direction_presented_map_sha256,
    },
    canvas: {width: 1920, height: 1080, fps: 30},
    timing: {
      shot_start_frame: item.shot_start_frame,
      shot_end_frame: item.shot_end_frame,
      duration_frames: item.shot_end_frame - item.shot_start_frame,
    },
    narration_source_text: item.narration_source_text,
    narration_source_text_sha256: sha256Text(item.narration_source_text),
    scene_plan: scenePlan,
    scene_plan_sha256: sha256Canonical(scenePlan),
    generation_constraints: generationConstraints,
    master_generation: {
      contract_version: 'ian-gpt-image-2-text-free-master-v1',
      generator: 'codex-native-imagegen',
      model_id: 'gpt-image-2',
      prompt: config.prompt,
      reference_inputs: referenceInputs,
      selection_status: 'selected',
      visible_text_mode: 'none',
      source_master: rasterBinding(config.source_master.path, source.bytes, 'text-free-complete-master-source', false, sourceMetadata.width, sourceMetadata.height),
      visual_qa: {result: 'pass', inspection: 'human-original-resolution-v1', observed_visible_text: [], observed_pseudo_text: false},
    },
    model_provenance: {
      contract_version: 'codex-native-imagegen-gpt-image-2-provenance-v1',
      generator: 'codex-native-imagegen', canonical_model: 'gpt-image-2',
      evidence_kind: 'embedded-c2pa-software-agent-observation-v1',
      source_master_checksum_sha256: sha256(source.bytes),
      expected_software_agent: {name: 'gpt-image', version: '2.0'},
    },
    normalized_master: rasterBinding(output.normalized_master_path, derived.normalizedMaster, 'text-free-complete-master-normalized', false),
    split_spec: splitSpec,
    background: rasterBinding(output.background_path, derived.background, 'static-paper-background', false),
    pre_text_layers: scenePlan.layers.map((layer, index) => layerBinding(layer, output.pre_text_layer_paths[index], derived.preTextLayers[index], 'transparent-semantic-element-pre-text')),
    text_overlay: config.text_overlay,
    layers: scenePlan.layers.map((layer, index) => layerBinding(layer, output.layer_paths[index], derived.layers[index], 'transparent-semantic-element')),
    final_composite: rasterBinding(output.final_composite_path, derived.finalComposite, 'final-composite-review-raster', false),
    verified_visible_text: required ? [item.exact_visible_text] : [],
  };
  const expectedPackageBinding = {
    episodeWorkspace,
    queueItemId: item.asset_id,
    shotId: item.shot_id,
    treatmentProfileId: item.treatment_profile_id,
    sourceText: item.narration_source_text,
    shotStartFrame: item.shot_start_frame,
    shotEndFrame: item.shot_end_frame,
    visibleTextMode: item.visible_text_mode,
    exactVisibleText: item.exact_visible_text,
  };
  validateIanLayeredScenePackage(manifest, expectedPackageBinding);
  const files = [
    [output.normalized_master_path, derived.normalizedMaster],
    [output.background_path, derived.background],
    ...output.pre_text_layer_paths.map((file, index) => [file, derived.preTextLayers[index]]),
    ...output.layer_paths.map((file, index) => [file, derived.layers[index]]),
    [output.final_composite_path, derived.finalComposite],
    [output.manifest_path, jsonBytes(manifest)],
  ];
  for (const [file, bytes] of files) writeExclusive(resolveEpisodeMember(episodeWorkspace, file, 'package output'), bytes);
  const manifestBytes = fs.readFileSync(resolveEpisodeMember(episodeWorkspace, output.manifest_path, 'manifest output'));
  const manifestBinding = {path: output.manifest_path, checksum_sha256: sha256(manifestBytes)};
  const inspection = await inspectIanLayeredScenePackage(manifest, {
    repositoryRoot: REPOSITORY_ROOT,
    ...expectedPackageBinding,
  });
  let containmentEvidence = null;
  if (required) {
    const containmentSpec = {
      contract_version: 'ian-layer-text-container-qa-spec-v2',
      asset_id: item.asset_id,
      scene_package_manifest: manifestBinding,
      raster: {path: output.final_composite_path, checksum_sha256: manifest.final_composite.checksum_sha256},
      regions: config.text_overlay.labels.map((label) => ({
        layer_id: label.layer_id,
        text: label.text,
        container_bbox: label.container_bbox,
        min_inset_px: config.text_overlay.minimum_inset_px,
      })),
      evidence_path: output.containment_evidence_path,
    };
    writeExclusive(resolveEpisodeMember(episodeWorkspace, output.containment_spec_path, 'containment spec output'), jsonBytes(containmentSpec));
    containmentEvidence = await validateIanTextContainment(output.containment_spec_path);
  }
  const skillPath = '.agents/skills/ian-handdrawn-ppt/SKILL.md';
  const skeleton = {
    contract_version: 'ian-layered-scene-qa-v2',
    result: 'pending_human_qa',
    asset_id: item.asset_id,
    generator: 'codex-native-imagegen',
    style_profile: {
      id: item.treatment_profile_id,
      skill_path: skillPath,
      skill_checksum_sha256: sha256(fs.readFileSync(resolveRootRelative(skillPath, 'Ian skill path'))),
      style_anchor_path: referenceInputs[0].path,
      style_anchor_checksum_sha256: referenceInputs[0].checksum_sha256,
    },
    prompt: config.prompt,
    actual_reference_inputs: referenceInputs,
    generation_lineage: [{
      stage: 'complete-master-generation',
      generation_mode: 'codex-native-imagegen-gpt-image-2-text-free-master-v1',
      model_id: 'gpt-image-2', prompt: config.prompt, reference_inputs: referenceInputs,
      output: {path: config.source_master.path, checksum_sha256: sha256(source.bytes)}, selection_status: 'selected',
    }],
    rejected_attempts: rejectedAttempts,
    scene_package_manifest: manifestBinding,
    model_provenance_observation: observation,
    deterministic_package_validation: inspection,
    text_container_qa: containmentEvidence === null ? null : {
      path: output.containment_evidence_path,
      checksum_sha256: sha256(fs.readFileSync(resolveEpisodeMember(episodeWorkspace, output.containment_evidence_path, 'containment evidence output'))),
    },
    human_qa_required: ['semantic_qa', 'visible_text_qa', 'style_qa', 'visual_qa'],
  };
  writeExclusive(resolveEpisodeMember(episodeWorkspace, output.qa_skeleton_path, 'QA skeleton output'), jsonBytes(skeleton));
  return {result: 'pass', manifest: manifestBinding, containment_evidence: containmentEvidence, qa_skeleton_path: output.qa_skeleton_path};
};

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const [episodeWorkspace, configPath] = process.argv.slice(2);
  if (!episodeWorkspace || !configPath || process.argv.length !== 4) {
    console.error('usage: node build-package.mjs <episode-workspace> <build-config-root-relative-path>');
    process.exit(2);
  }
  try {
    const config = JSON.parse(fs.readFileSync(resolveEpisodeMember(episodeWorkspace, configPath, 'build config'), 'utf8'));
    process.stdout.write(`${JSON.stringify(await buildIanLayeredScenePackage({episodeWorkspace, config}), null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
