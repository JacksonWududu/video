import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Ajv2020 from 'ajv/dist/2020.js';
import sharp from 'sharp';

import {
  IAN_LAYERED_SCENE_PACKAGE_VERSION,
  deriveIanLayeredSceneV2Bytes,
  inspectIanLayeredScenePackage,
  observeGptImage2SoftwareAgent,
  sha256Canonical,
  sha256Text,
  validateIanLayeredScenePackage,
} from './contract.mjs';

const checksum = (value) => crypto.createHash('sha256').update(value).digest('hex');
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
const pngChunk = (type, payload) => {
  const typeBytes = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + payload.length);
  chunk.writeUInt32BE(payload.length, 0);
  typeBytes.copy(chunk, 4);
  payload.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, payload])), 8 + payload.length);
  return chunk;
};
const isoBox = (type, payload) => {
  const box = Buffer.alloc(8 + payload.length);
  box.writeUInt32BE(box.length, 0);
  box.write(type, 4, 4, 'ascii');
  payload.copy(box, 8);
  return box;
};
const jumd = (label, contentType = 'cbor') => isoBox('jumd', Buffer.concat([
  Buffer.from(`${contentType}\u0000\u0011\u0000\u0010\u0080\u0000\u0000\u00aa\u00008\u009bq`, 'latin1'),
  Buffer.from([3]),
  Buffer.from(`${label}\u0000`, 'utf8'),
]));
const jumb = (label, children, contentType = 'cbor') => isoBox('jumb', Buffer.concat([
  jumd(label, contentType),
  ...children,
]));
const cborText = (value) => {
  const bytes = Buffer.from(value, 'utf8');
  assert.ok(bytes.length < 24);
  return Buffer.concat([Buffer.from([0x60 + bytes.length]), bytes]);
};
const c2paObservationPayload = () => {
  const actions = Buffer.concat([
    Buffer.from([0xa1]), cborText('actions'), Buffer.from([0x81, 0xa2]),
    cborText('action'), cborText('c2pa.created'),
    cborText('softwareAgent'), Buffer.from([0xa2]),
    cborText('name'), cborText('gpt-image'),
    cborText('version'), cborText('2.0'),
  ]);
  return jumb('c2pa', [
    jumb('c2pa.actions.v2', [isoBox('cbor', actions)]),
    jumb('c2pa.claim.v2', [isoBox('cbor', Buffer.from([0xa0]))]),
    jumb('c2pa.signature', [isoBox('cbor', Buffer.from([0xa0]))]),
  ], 'c2pa');
};
const insertBeforeIend = (png, chunk) => {
  const iend = png.lastIndexOf(Buffer.from('IEND', 'ascii')) - 4;
  assert.ok(iend >= 8);
  return Buffer.concat([png.subarray(0, iend), chunk, png.subarray(iend)]);
};
const sourceText = '一次结果，不等于无法改变。';
const sourceBytes = Buffer.from(sourceText, 'utf8');
const splitByte = Buffer.from('一次结果，', 'utf8').length;
const canonicalStyleAnchorPath = '.agents/skills/ian-handdrawn-ppt/assets/reference-handdrawn-article-illustration-style.png';

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
      source_text_end_byte_exclusive: splitByte,
      source_text: sourceBytes.subarray(0, splitByte).toString('utf8'),
      entry_frame: 0,
    },
    {
      layer_id: 'L02',
      z_index: 2,
      semantic_role: 'change-path',
      source_text_start_byte: splitByte,
      source_text_end_byte_exclusive: sourceBytes.length,
      source_text: sourceBytes.subarray(splitByte).toString('utf8'),
      entry_frame: 18,
    },
  ],
});

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

const binding = (relativePath, bytes, role, hasAlpha, width = 1920, height = 1080) => ({
  path: relativePath,
  checksum_sha256: checksum(bytes),
  width,
  height,
  role,
  has_alpha: hasAlpha,
});

const write = (root, relativePath, bytes) => {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, bytes);
};

const fixture = async (t, {withText = false} = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ian-layered-v2-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const episode = 'leverage-video/src/topic-test';
  const assetRoot = `${episode}/assets`;
  const promptPath = `${assetRoot}/prompt.txt`;
  const stylePath = canonicalStyleAnchorPath;
  const sourcePath = `${assetRoot}/master-source.png`;
  const normalizedPath = `${assetRoot}/master-normalized.png`;
  const backgroundPath = `${assetRoot}/background.png`;
  const preLayerPaths = [`${assetRoot}/L01-pre.png`, `${assetRoot}/L02-pre.png`];
  const layerPaths = [`${assetRoot}/L01.png`, `${assetRoot}/L02.png`];
  const finalPath = `${assetRoot}/final.png`;
  const promptBytes = Buffer.from('16:9 landscape composition; no visible text; two separated semantic zones.');
  const styleBytes = await sharp({
    create: {width: 1920, height: 1080, channels: 3, background: '#fdfcf9'},
  }).png().toBuffer();
  const baseMaster = await sharp({
    create: {width: 1920, height: 1080, channels: 3, background: '#fdfcf9'},
  }).composite([
    {input: Buffer.from('<svg width="420" height="500"><rect x="30" y="30" width="360" height="440" rx="30" fill="#5d82a8"/></svg>'), left: 80, top: 180},
    {input: Buffer.from('<svg width="440" height="420"><circle cx="220" cy="210" r="180" fill="#cf7f5e"/></svg>'), left: 1260, top: 300},
  ]).removeAlpha().png({compressionLevel: 9, adaptiveFiltering: false, palette: false}).toBuffer();
  const masterBytes = insertBeforeIend(
    baseMaster,
    pngChunk('caBX', c2paObservationPayload()),
  );
  write(root, promptPath, promptBytes);
  write(root, stylePath, styleBytes);
  write(root, sourcePath, masterBytes);

  const scenePlan = plan();
  const splitSpec = {
    contract_version: 'ian-semantic-region-alpha-split-v1',
    normalization: {
      fit: 'cover',
      position: 'centre',
      kernel: 'lanczos3',
      stretch: false,
      padding: false,
    },
    matte_rgb: [253, 252, 249],
    alpha_distance_low: 7,
    alpha_distance_high: 18,
    blur_sigma_px: 0.6,
    paper_background_rgba: [251, 250, 245, 255],
    minimum_inter_layer_gutter_px: 8,
    outside_union_max_visible_pixels: 1024,
    layers: [
      {layer_id: 'L01', bbox: {x: 48, y: 144, width: 520, height: 600}},
      {layer_id: 'L02', bbox: {x: 1200, y: 240, width: 600, height: 600}},
    ],
  };
  const fontPath = '/System/Library/Fonts/STHeiti Light.ttc';
  const textOverlay = withText ? {
    contract_version: 'ian-deterministic-layer-text-overlay-v1',
    mode: 'required',
    font: {
      path: fontPath,
      checksum_sha256: checksum(fs.readFileSync(fontPath)),
      font_family: 'Heiti SC',
    },
    minimum_inset_px: 8,
    labels: [{
      layer_id: 'L01',
      text: '一次结果≠无法改变',
      lines: ['一次结果≠无法改变'],
      container_bbox: {x: 120, y: 560, width: 380, height: 100},
      font_size: 34,
      font_weight: 500,
      letter_spacing: 0,
      fill: '#26333a',
      background: null,
    }],
  } : {
    contract_version: 'ian-deterministic-layer-text-overlay-v1',
    mode: 'none',
    font: null,
    minimum_inset_px: 8,
    labels: [],
  };
  const derived = await deriveIanLayeredSceneV2Bytes({
    sourceMasterBytes: masterBytes,
    splitSpec,
    textOverlay,
    scenePlan,
  });
  write(root, normalizedPath, derived.normalizedMaster);
  write(root, backgroundPath, derived.background);
  derived.preTextLayers.forEach((bytes, index) => write(root, preLayerPaths[index], bytes));
  derived.layers.forEach((bytes, index) => write(root, layerPaths[index], bytes));
  write(root, finalPath, derived.finalComposite);

  const manifest = {
    contract_version: 'ian-knowledge-video-layered-scene-v2',
    episode_workspace: episode,
    queue_item_id: 'S17-ian-v02',
    shot_id: 'S17',
    visual_generation_route: 'ian-handdrawn-ppt',
    treatment_profile_id: 'ian-handdrawn-technical',
    storyboard_binding: {path: `${episode}/storyboard.md`, checksum_sha256: '1'.repeat(64)},
    visual_direction_review: {
      path: `${episode}/schema/direction.json`,
      checksum_sha256: '2'.repeat(64),
      presented_map_sha256: '3'.repeat(64),
    },
    canvas: {width: 1920, height: 1080, fps: 30},
    timing: {shot_start_frame: 100, shot_end_frame: 160, duration_frames: 60},
    narration_source_text: sourceText,
    narration_source_text_sha256: sha256Text(sourceText),
    scene_plan: scenePlan,
    scene_plan_sha256: sha256Canonical(scenePlan),
    generation_constraints: generationConstraints,
    master_generation: {
      contract_version: 'ian-gpt-image-2-text-free-master-v1',
      generator: 'codex-native-imagegen',
      model_id: 'gpt-image-2',
      prompt: {path: promptPath, checksum_sha256: checksum(promptBytes)},
      reference_inputs: [{
        role: 'visual_style_reference_only',
        path: stylePath,
        checksum_sha256: checksum(styleBytes),
      }],
      selection_status: 'selected',
      visible_text_mode: 'none',
      source_master: binding(
        sourcePath,
        masterBytes,
        'text-free-complete-master-source',
        false,
        1920,
        1080,
      ),
      visual_qa: {
        result: 'pass',
        inspection: 'human-original-resolution-v1',
        observed_visible_text: [],
        observed_pseudo_text: false,
      },
    },
    model_provenance: {
      contract_version: 'codex-native-imagegen-gpt-image-2-provenance-v1',
      generator: 'codex-native-imagegen',
      canonical_model: 'gpt-image-2',
      evidence_kind: 'embedded-c2pa-software-agent-observation-v1',
      source_master_checksum_sha256: checksum(masterBytes),
      expected_software_agent: {name: 'gpt-image', version: '2.0'},
    },
    normalized_master: binding(
      normalizedPath,
      derived.normalizedMaster,
      'text-free-complete-master-normalized',
      false,
    ),
    split_spec: splitSpec,
    background: binding(backgroundPath, derived.background, 'static-paper-background', false),
    pre_text_layers: scenePlan.layers.map((layer, index) => ({
      ...layer,
      ...binding(
        preLayerPaths[index],
        derived.preTextLayers[index],
        'transparent-semantic-element-pre-text',
        true,
      ),
    })),
    text_overlay: textOverlay,
    layers: scenePlan.layers.map((layer, index) => ({
      ...layer,
      ...binding(
        layerPaths[index],
        derived.layers[index],
        'transparent-semantic-element',
        true,
      ),
    })),
    final_composite: binding(
      finalPath,
      derived.finalComposite,
      'final-composite-review-raster',
      false,
    ),
    verified_visible_text: withText ? ['一次结果≠无法改变'] : [],
  };
  return {root, manifest, derived, stylePath, styleBytes, masterBytes};
};

test('v2 package is master-first, GPT Image 2-bound, deterministically split, and recomposed', async (t) => {
  const {root, manifest} = await fixture(t);
  const schema = JSON.parse(fs.readFileSync(new URL(
    '../../../../.agents/skills/ian-handdrawn-ppt/references/knowledge-video-layered-scene-v2.schema.json',
    import.meta.url,
  )));
  const validateSchema = new Ajv2020({strict: false}).compile(schema);
  assert.equal(validateSchema(manifest), true, JSON.stringify(validateSchema.errors));
  assert.equal(IAN_LAYERED_SCENE_PACKAGE_VERSION, 'ian-knowledge-video-layered-scene-v2');
  const validated = validateIanLayeredScenePackage(manifest, {
    episodeWorkspace: manifest.episode_workspace,
    queueItemId: manifest.queue_item_id,
    sourceText,
    shotStartFrame: 100,
    shotEndFrame: 160,
  });
  assert.equal(validated.master_generation.model_id, 'gpt-image-2');
  const inspected = await inspectIanLayeredScenePackage(manifest, {
    repositoryRoot: root,
    episodeWorkspace: manifest.episode_workspace,
    sourceText,
    shotStartFrame: 100,
    shotEndFrame: 160,
  });
  assert.equal(inspected.model_provenance_observation.software_agent_version, '2.0');
  assert.equal(inspected.deterministic_master_normalization_match, true);
  assert.equal(inspected.deterministic_semantic_split_match, true);
  assert.equal(inspected.deterministic_text_overlay_match, true);
  assert.equal(inspected.deterministic_composite_match, true);
});

test('model observation requires a CRC-valid PNG caBX/JUMBF actions assertion', async (t) => {
  const plainPng = await sharp({
    create: {width: 32, height: 18, channels: 3, background: '#fdfcf9'},
  }).png().toBuffer();
  const trailingAsciiSpoof = Buffer.concat([
    plainPng,
    Buffer.from('c2pa.actions.v2 softwareAgent name gpt-image version 2.0'),
  ]);
  assert.throws(
    () => observeGptImage2SoftwareAgent(trailingAsciiSpoof),
    /PNG|caBX|JUMBF|C2PA/i,
  );

  const {masterBytes} = await fixture(t);
  const corruptedCrc = Buffer.from(masterBytes);
  const caBxType = corruptedCrc.indexOf(Buffer.from('caBX', 'ascii'));
  assert.ok(caBxType > 0);
  corruptedCrc[caBxType + 12] ^= 1;
  assert.throws(
    () => observeGptImage2SoftwareAgent(corruptedCrc),
    /CRC|PNG|caBX/i,
  );
});

test('model observation still recognizes both real GPT Image 2 raw PNGs', (t) => {
  const rawPaths = [
    new URL('../../../../output/s17-ian-layered-demo-v1/master-imagegen-raw.png', import.meta.url),
    new URL('../../topic7/assets/image/raw-imagegen/S17-ian-v01-raw.png', import.meta.url),
  ];
  const missing = rawPaths.filter((rawPath) => !fs.existsSync(rawPath));
  if (missing.length > 0) {
    t.skip('local real-image regression fixtures are unavailable');
    return;
  }
  for (const rawPath of rawPaths) {
    const observation = observeGptImage2SoftwareAgent(fs.readFileSync(rawPath));
    assert.equal(observation.software_agent_name, 'gpt-image');
    assert.equal(observation.software_agent_version, '2.0');
    assert.equal(observation.evidence_kind, 'observation-not-signature-verification');
  }
});

test('v2 requires the canonical Ian PNG style anchor and its current checksum', async (t) => {
  const {root, manifest, styleBytes} = await fixture(t);
  assert.equal(
    manifest.master_generation.reference_inputs[0].path,
    canonicalStyleAnchorPath,
  );

  const wrongPath = structuredClone(manifest);
  const alternatePath = 'leverage-video/src/shared/ian-layered-scene/alternate-style.png';
  write(root, alternatePath, styleBytes);
  wrongPath.master_generation.reference_inputs[0].path = alternatePath;
  const schema = JSON.parse(fs.readFileSync(new URL(
    '../../../../.agents/skills/ian-handdrawn-ppt/references/knowledge-video-layered-scene-v2.schema.json',
    import.meta.url,
  )));
  const validateSchema = new Ajv2020({strict: false}).compile(schema);
  assert.equal(validateSchema(wrongPath), false);
  assert.throws(
    () => validateIanLayeredScenePackage(wrongPath),
    /canonical Ian style anchor/i,
  );

  const staleChecksum = structuredClone(manifest);
  staleChecksum.master_generation.reference_inputs[0].checksum_sha256 = 'f'.repeat(64);
  await assert.rejects(() => inspectIanLayeredScenePackage(staleChecksum, {
    repositoryRoot: root,
    episodeWorkspace: manifest.episode_workspace,
  }), /style anchor.*checksum|checksum.*style anchor/i);
});

test('v2 rejects a checksum-current text file masquerading as the canonical style anchor', async (t) => {
  const {root, manifest, stylePath} = await fixture(t);
  const textBytes = Buffer.from('not a PNG style reference\n');
  fs.writeFileSync(path.join(root, stylePath), textBytes);
  manifest.master_generation.reference_inputs[0].checksum_sha256 = checksum(textBytes);
  await assert.rejects(() => inspectIanLayeredScenePackage(manifest, {
    repositoryRoot: root,
    episodeWorkspace: manifest.episode_workspace,
  }), /style anchor.*PNG|PNG.*style anchor/i);
});

test('v2 rejects a different model, missing C2PA observation, and independent-member lineage fields', async (t) => {
  const {root, manifest} = await fixture(t);
  const wrongModel = structuredClone(manifest);
  wrongModel.master_generation.model_id = 'gpt-image-1.5';
  assert.throws(() => validateIanLayeredScenePackage(wrongModel), /gpt-image-2/);

  const sourcePath = path.join(root, manifest.master_generation.source_master.path);
  const cleanBytes = await sharp(sourcePath).removeAlpha().png().toBuffer();
  fs.writeFileSync(sourcePath, cleanBytes);
  manifest.master_generation.source_master.checksum_sha256 = checksum(cleanBytes);
  manifest.model_provenance.source_master_checksum_sha256 = checksum(cleanBytes);
  await assert.rejects(() => inspectIanLayeredScenePackage(manifest, {
    repositoryRoot: root,
    episodeWorkspace: manifest.episode_workspace,
  }), /C2PA|software-agent|provenance/i);

  const withLegacyLineage = structuredClone(manifest);
  withLegacyLineage.independent_member_generation = [];
  assert.throws(() => validateIanLayeredScenePackage(withLegacyLineage), /exact keys/);
});

test('v2 rejects overlapping or out-of-bounds semantic regions', async (t) => {
  const {manifest} = await fixture(t);
  const overlap = structuredClone(manifest);
  overlap.split_spec.layers[1].bbox.x = 500;
  assert.throws(() => validateIanLayeredScenePackage(overlap), /overlap|gutter/);
  const outside = structuredClone(manifest);
  outside.split_spec.layers[1].bbox.x = 1800;
  assert.throws(() => validateIanLayeredScenePackage(outside), /bounds/);
});

test('v2 disk inspection rejects a checksum-current but nondeterministic derived layer', async (t) => {
  const {root, manifest} = await fixture(t);
  const layerPath = path.join(root, manifest.layers[0].path);
  const changed = await sharp(layerPath)
    .composite([{input: Buffer.from('<svg width="24" height="24"><rect width="24" height="24" fill="#000"/></svg>'), left: 900, top: 500}])
    .png({compressionLevel: 9, adaptiveFiltering: false, palette: false})
    .toBuffer();
  fs.writeFileSync(layerPath, changed);
  manifest.layers[0].checksum_sha256 = checksum(changed);
  await assert.rejects(() => inspectIanLayeredScenePackage(manifest, {
    repositoryRoot: root,
    episodeWorkspace: manifest.episode_workspace,
  }), /deterministic derivation/);
});

test('v2 exact text is overlaid only on its owning semantic layer with containment', async (t) => {
  if (!fs.existsSync('/System/Library/Fonts/STHeiti Light.ttc')) t.skip('STHeiti is unavailable');
  const {root, manifest, derived} = await fixture(t, {withText: true});
  assert.notEqual(checksum(derived.preTextLayers[0]), checksum(derived.layers[0]));
  assert.equal(checksum(derived.preTextLayers[1]), checksum(derived.layers[1]));
  const inspected = await inspectIanLayeredScenePackage(manifest, {
    repositoryRoot: root,
    episodeWorkspace: manifest.episode_workspace,
  });
  assert.deepEqual(inspected.package.verified_visible_text, ['一次结果≠无法改变']);

  const escaped = structuredClone(manifest);
  escaped.text_overlay.labels[0].container_bbox.width = 120;
  await assert.rejects(() => inspectIanLayeredScenePackage(escaped, {
    repositoryRoot: root,
    episodeWorkspace: manifest.episode_workspace,
  }), /container|glyph/i);
});

test('v2 text rendering uses the checksum-bound font file and rejects fake or mismatched fonts', async (t) => {
  const menloPath = '/System/Library/Fonts/Menlo.ttc';
  const helveticaPath = '/System/Library/Fonts/HelveticaNeue.ttc';
  if (!fs.existsSync(menloPath) || !fs.existsSync(helveticaPath)) {
    t.skip('required system font fixtures are unavailable');
    return;
  }
  const {root, manifest, masterBytes} = await fixture(t);
  const overlay = (fontPath, fontFamily) => ({
    contract_version: 'ian-deterministic-layer-text-overlay-v1',
    mode: 'required',
    font: {
      path: fontPath,
      checksum_sha256: checksum(fs.readFileSync(fontPath)),
      font_family: fontFamily,
    },
    minimum_inset_px: 8,
    labels: [{
      layer_id: 'L01',
      text: 'WWWWiiii',
      lines: ['WWWWiiii'],
      container_bbox: {x: 120, y: 540, width: 380, height: 120},
      font_size: 42,
      font_weight: 500,
      letter_spacing: 0,
      fill: '#26333a',
      background: null,
    }],
  });
  const deriveWith = (textOverlay) => deriveIanLayeredSceneV2Bytes({
    sourceMasterBytes: masterBytes,
    splitSpec: manifest.split_spec,
    textOverlay,
    scenePlan: manifest.scene_plan,
  });
  const menlo = await deriveWith(overlay(menloPath, 'Menlo'));
  const helvetica = await deriveWith(overlay(helveticaPath, 'Helvetica Neue'));
  assert.notEqual(checksum(menlo.layers[0]), checksum(helvetica.layers[0]));

  const mismatched = overlay(helveticaPath, 'Menlo');
  await assert.rejects(() => deriveWith(mismatched), /font.*family|family.*font/i);

  const fakePath = path.join(root, 'fake-font.ttf');
  const fakeBytes = Buffer.from('not a real SFNT font');
  fs.writeFileSync(fakePath, fakeBytes);
  const fake = overlay(menloPath, 'Menlo');
  fake.font.path = fakePath;
  fake.font.checksum_sha256 = checksum(fakeBytes);
  await assert.rejects(() => deriveWith(fake), /font|SFNT|OpenType|TrueType/i);
});

test('v1 is not accepted by the active package validator', () => {
  assert.throws(() => validateIanLayeredScenePackage({
    contract_version: 'ian-knowledge-video-layered-scene-v1',
  }), /exact keys|v2/);
});
