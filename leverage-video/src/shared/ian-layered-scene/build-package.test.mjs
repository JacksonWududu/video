import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import sharp from 'sharp';

import {buildIanLayeredScenePackage} from './build-package.mjs';
import {
  inspectIanLayeredScenePackage,
  sha256Text,
  validateIanLayeredScenePackage,
} from './contract.mjs';

const root = path.resolve(import.meta.dirname, '../../../..');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, value, {flag: 'wx'});
};
const relative = (file) => path.relative(root, file).replaceAll(path.sep, '/');

const crc32Table = Array.from({length: 256}, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});
const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crc32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};
const box = (type, payload) => {
  const value = Buffer.alloc(8 + payload.length);
  value.writeUInt32BE(value.length, 0);
  value.write(type, 4, 4, 'ascii');
  payload.copy(value, 8);
  return value;
};
const jumd = (label, contentType = 'cbor') => box('jumd', Buffer.concat([
  Buffer.from(`${contentType}\u0000\u0011\u0000\u0010\u0080\u0000\u0000\u00aa\u00008\u009bq`, 'latin1'),
  Buffer.from([3]), Buffer.from(`${label}\u0000`),
]));
const jumb = (label, children, contentType = 'cbor') => box('jumb', Buffer.concat([
  jumd(label, contentType), ...children,
]));
const text = (value) => Buffer.concat([Buffer.from([0x60 + Buffer.byteLength(value)]), Buffer.from(value)]);
const c2paPayload = () => {
  const actions = Buffer.concat([
    Buffer.from([0xa1]), text('actions'), Buffer.from([0x81, 0xa2]),
    text('action'), text('c2pa.created'), text('softwareAgent'), Buffer.from([0xa2]),
    text('name'), text('gpt-image'), text('version'), text('2.0'),
  ]);
  return jumb('c2pa', [
    jumb('c2pa.actions.v2', [box('cbor', actions)]),
    jumb('c2pa.claim.v2', [box('cbor', Buffer.from([0xa0]))]),
    jumb('c2pa.signature', [box('cbor', Buffer.from([0xa0]))]),
  ], 'c2pa');
};
const withC2pa = (png) => {
  const type = Buffer.from('caBX');
  const payload = c2paPayload();
  const chunk = Buffer.alloc(12 + payload.length);
  chunk.writeUInt32BE(payload.length, 0);
  type.copy(chunk, 4); payload.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([type, payload])), 8 + payload.length);
  const offset = png.lastIndexOf(Buffer.from('IEND')) - 4;
  return Buffer.concat([png.subarray(0, offset), chunk, png.subarray(offset)]);
};

const planFor = (narration) => ({
  contract_version: 'ian-layered-scene-plan-v1', shot_id: 'S02',
  narration_source_text_sha256: sha256Text(narration),
  scene_renderer: 'ian-static-layered-scene-v1', background_policy: 'static-paper-background-v1',
  layer_asset_policy: 'full-canvas-transparent-png-v1',
  layer_entry_transition: {contract_version: 'ian-layer-entry-fade-v1', duration_frames: 8, easing: 'linear'},
  motion_policy: {scene_transform: 'forbidden', layer_transform: 'forbidden', mask_reveal: 'forbidden', internal_cut: 'forbidden', opacity_animation: 'ian-layer-entry-fade-v1'},
  layer_count: 2,
  layers: [
    {layer_id: 'L01', z_index: 1, semantic_role: 'first', source_text_start_byte: 0, source_text_end_byte_exclusive: 6, source_text: narration.slice(0, 2), entry_frame: 0},
    {layer_id: 'L02', z_index: 2, semantic_role: 'second', source_text_start_byte: 6, source_text_end_byte_exclusive: Buffer.byteLength(narration), source_text: narration.slice(2), entry_frame: 18},
  ],
});

const fixture = async (t, {mode = 'none', c2pa = true, gutter = 8, badBbox = false} = {}) => {
  const directory = fs.mkdtempSync(path.join(root, 'leverage-video/src/ian-build-package-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const episode = relative(directory);
  const assets = path.join(directory, 'assets');
  const narration = '甲乙丙丁';
  const master = await sharp({create: {width: 1920, height: 1080, channels: 3, background: '#fdfcf9'}})
    .composite([
      {input: Buffer.from('<svg width="400" height="400"><rect width="400" height="400" fill="#557a9b"/></svg>'), left: 80, top: 200},
      {input: Buffer.from('<svg width="400" height="400"><circle cx="200" cy="200" r="190" fill="#ca765a"/></svg>'), left: 1400, top: 300},
    ]).removeAlpha().png().toBuffer();
  const source = c2pa ? withC2pa(master) : master;
  const sourcePath = path.join(assets, 'source.png');
  const promptPath = path.join(assets, 'prompt.txt');
  write(sourcePath, source);
  write(promptPath, '16:9 landscape composition; no visible text; separated zones. IAN BOTTOM SUBTITLE SAFE AREA: x=0, y=832, width=1920, height=248.');
  const fontPath = '/System/Library/Fonts/STHeiti Light.ttc';
  const config = {
    queue_item: {
      asset_id: 'S02-ian-v01', shot_id: 'S02', treatment_profile_id: 'ian-handdrawn-technical',
      storyboard_path: `${episode}/storyboard.md`, storyboard_checksum_sha256: '1'.repeat(64),
      visual_direction_review_path: `${episode}/schema/direction.json`, visual_direction_review_checksum_sha256: '2'.repeat(64), visual_direction_presented_map_sha256: '3'.repeat(64),
      narration_source_text: narration, shot_start_frame: 100, shot_end_frame: 160,
      visible_text_mode: mode,
      exact_visible_text: mode === 'required' ? '个人理性\n集体收缩' : null,
      visible_text_placement: mode === 'required' ? '左右对照区，各自居中' : null,
      ian_scene_plan: planFor(narration),
    },
    source_master: {path: relative(sourcePath), checksum_sha256: sha256(source)},
    prompt: {path: relative(promptPath), checksum_sha256: sha256(fs.readFileSync(promptPath))},
    reference_inputs: [{role: 'visual_style_reference_only', path: '.agents/skills/ian-handdrawn-ppt/assets/reference-handdrawn-article-illustration-style.png', checksum_sha256: sha256(fs.readFileSync(path.join(root, '.agents/skills/ian-handdrawn-ppt/assets/reference-handdrawn-article-illustration-style.png')))}],
    split_spec: {
      contract_version: 'ian-semantic-region-alpha-split-v1', normalization: {fit: 'cover', position: 'centre', kernel: 'lanczos3', stretch: false, padding: false},
      matte_rgb: [253, 252, 249], alpha_distance_low: 7, alpha_distance_high: 18, blur_sigma_px: 0.6, paper_background_rgba: [251, 250, 245, 255],
      minimum_inter_layer_gutter_px: gutter, outside_union_max_visible_pixels: 1024,
      layers: [{layer_id: 'L01', bbox: {x: 48, y: 160, width: 520, height: 560}}, {layer_id: 'L02', bbox: badBbox ? {x: 1900, y: 260, width: 640, height: 560} : {x: 1200, y: 260, width: 640, height: 560}}],
    },
    text_overlay: mode === 'none' ? {contract_version: 'ian-deterministic-layer-text-overlay-v1', mode: 'none', font: null, minimum_inset_px: 8, labels: []} : {
      contract_version: 'ian-deterministic-layer-text-overlay-v1', mode: 'required', minimum_inset_px: 8,
      font: {path: fontPath, checksum_sha256: sha256(fs.readFileSync(fontPath)), font_family: 'Heiti SC'},
      labels: [
        {layer_id: 'L01', text: '个人理性', lines: ['个人理性'], container_bbox: {x: 120, y: 560, width: 300, height: 100}, font_size: 34, font_weight: 500, letter_spacing: 0, fill: '#26333a', background: null},
        {layer_id: 'L02', text: '集体收缩', lines: ['集体收缩'], container_bbox: {x: 1300, y: 600, width: 300, height: 100}, font_size: 34, font_weight: 500, letter_spacing: 0, fill: '#26333a', background: null},
      ],
    },
    output: {
      manifest_path: `${episode}/schema/ian-package.json`, qa_skeleton_path: `${episode}/schema/ian-qa.json`,
      normalized_master_path: `${episode}/assets/normalized.png`, background_path: `${episode}/assets/background.png`,
      pre_text_layer_paths: [`${episode}/assets/L01-pre.png`, `${episode}/assets/L02-pre.png`], layer_paths: [`${episode}/assets/L01.png`, `${episode}/assets/L02.png`], final_composite_path: `${episode}/assets/final.png`,
      containment_spec_path: `${episode}/schema/containment-spec.json`, containment_evidence_path: `${episode}/schema/containment-evidence.json`,
    },
  };
  return {config, episode};
};

test('builds a text-free package and skeleton that inspector replays', async (t) => {
  const {config, episode} = await fixture(t);
  const result = await buildIanLayeredScenePackage({episodeWorkspace: episode, config});
  assert.equal(result.containment_evidence, null);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, config.output.manifest_path)));
  assert.equal(manifest.text_overlay.mode, 'none');
  assert.deepEqual(manifest.split_spec.subtitle_safe_area.safe_area, {
    x: 0, y: 832, width: 1920, height: 248,
  });
  assert.deepEqual(manifest.verified_visible_text, []);
  assert.equal((await inspectIanLayeredScenePackage(manifest, {repositoryRoot: root, episodeWorkspace: episode})).result, 'pass');
});

test('builds required text and containment evidence', async (t) => {
  const {config, episode} = await fixture(t, {mode: 'required'});
  const result = await buildIanLayeredScenePackage({episodeWorkspace: episode, config});
  assert.equal(result.containment_evidence.result, 'pass');
  assert.ok(fs.existsSync(path.join(root, config.output.containment_evidence_path)));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, config.output.manifest_path)));
  assert.deepEqual(manifest.text_overlay.labels.map((label) => label.text), ['个人理性', '集体收缩']);
  assert.deepEqual(manifest.verified_visible_text, ['个人理性\n集体收缩']);
  assert.equal((await inspectIanLayeredScenePackage(manifest, {
    repositoryRoot: root,
    episodeWorkspace: episode,
    visibleTextMode: 'required',
    exactVisibleText: '个人理性\n集体收缩',
  })).result, 'pass');

  const substituted = structuredClone(manifest);
  substituted.text_overlay.labels[1].text = '集体扩张';
  substituted.text_overlay.labels[1].lines = ['集体扩张'];
  assert.throws(() => validateIanLayeredScenePackage(substituted, {
    visibleTextMode: 'required',
    exactVisibleText: '个人理性\n集体收缩',
  }), /exact approved visible text/);

  const dropped = structuredClone(manifest);
  dropped.text_overlay.labels.pop();
  assert.throws(() => validateIanLayeredScenePackage(dropped, {
    visibleTextMode: 'required',
    exactVisibleText: '个人理性\n集体收缩',
  }), /exact approved visible text/);
});

test('refuses overwrite, invalid gutter, and source lacking C2PA', async (t) => {
  const first = await fixture(t);
  await buildIanLayeredScenePackage({episodeWorkspace: first.episode, config: first.config});
  await assert.rejects(() => buildIanLayeredScenePackage({episodeWorkspace: first.episode, config: first.config}), /refusing to overwrite/);
  const badGutter = await fixture(t, {gutter: 7});
  await assert.rejects(() => buildIanLayeredScenePackage({episodeWorkspace: badGutter.episode, config: badGutter.config}), /gutter/);
  const badBbox = await fixture(t, {badBbox: true});
  await assert.rejects(() => buildIanLayeredScenePackage({episodeWorkspace: badBbox.episode, config: badBbox.config}), /bbox/);
  const noC2pa = await fixture(t, {c2pa: false});
  await assert.rejects(() => buildIanLayeredScenePackage({episodeWorkspace: noC2pa.episode, config: noC2pa.config}), /C2PA/);
  const missingSafeAreaPrompt = await fixture(t);
  const promptPath = path.join(root, missingSafeAreaPrompt.config.prompt.path);
  const promptBytes = Buffer.from('16:9 landscape composition; no visible text; separated zones.');
  fs.writeFileSync(promptPath, promptBytes);
  missingSafeAreaPrompt.config.prompt.checksum_sha256 = sha256(promptBytes);
  await assert.rejects(
    () => buildIanLayeredScenePackage({
      episodeWorkspace: missingSafeAreaPrompt.episode,
      config: missingSafeAreaPrompt.config,
    }),
    /Ian 23% bottom subtitle safe area/,
  );
});

test('reuses an unchanged pre-policy prompt only for an audited deterministic relayout', async (t) => {
  const {config, episode} = await fixture(t);
  const promptPath = path.join(root, config.prompt.path);
  const promptBytes = Buffer.from('16:9 landscape composition; no visible text; separated zones.');
  fs.writeFileSync(promptPath, promptBytes);
  config.prompt.checksum_sha256 = sha256(promptBytes);
  config.rejected_attempts = [structuredClone(config.source_master)];
  config.split_spec.subtitle_safe_area = {
    contract_version: 'ian-bottom-subtitle-safe-area-v1',
    target_height_percent: 23,
    pixel_rounding: 'nearest-integer-v1',
    safe_area: {x: 0, y: 832, width: 1920, height: 248},
  };
  config.split_spec.layout_repair = {
    contract_version: 'ian-pre-split-layout-repair-v1',
    method: 'matte-alpha-rational-downscale-integer-translate-v1',
    authorization: {
      asset_id: 'S02-ian-v01',
      exact_user_message: '按照新规则修改S02',
    },
    source_failure: {
      attempt_number: 3,
      prompt: structuredClone(config.prompt),
      output: structuredClone(config.source_master),
      failure_reason: 'historical source predates the current Ian subtitle-safe prompt marker',
    },
    source_outside_union_max_visible_pixels: 1024,
    source_bbox_minimum_matte_gutter_px: 8,
    layers: [
      {
        layer_id: 'L01',
        source_bbox: {x: 64, y: 184, width: 432, height: 432},
        scale_numerator: 1,
        scale_denominator: 1,
        target_bbox: {x: 80, y: 200, width: 432, height: 432},
      },
      {
        layer_id: 'L02',
        source_bbox: {x: 1392, y: 292, width: 416, height: 416},
        scale_numerator: 1,
        scale_denominator: 1,
        target_bbox: {x: 1300, y: 300, width: 416, height: 416},
      },
    ],
  };
  const result = await buildIanLayeredScenePackage({episodeWorkspace: episode, config});
  assert.equal(result.result, 'pass');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, config.output.manifest_path)));
  assert.equal(manifest.master_generation.prompt.checksum_sha256, sha256(promptBytes));
  assert.equal(manifest.split_spec.subtitle_safe_area.safe_area.y, 832);
});
