import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import sharp from 'sharp';

import {
  buildActionStatePlanSha256,
  buildActionStateScheduleV3,
  validateActionStateSchedule,
} from '../action-state-schedule/contract.mjs';
import {coverGeometry} from '../episode-tooling/raster-contract.mjs';
import {
  IAN_CANONICAL_STYLE_ANCHOR_PATH,
  IAN_LAYERED_SCENE_PACKAGE_VERSION,
  IAN_LAYERED_SCENE_PLAN_VERSION,
  IAN_LAYERED_SCENE_RENDERER_VERSION,
  IAN_LAYER_ENTRY_DURATION_FRAMES,
  IAN_LAYER_ENTRY_TRANSITION_VERSION,
  deriveIanLayeredSceneV2Bytes,
  sha256Canonical as sha256IanCanonical,
  sha256Text,
} from '../ian-layered-scene/contract.mjs';
import {buildTransitionReviewPresentedMapSha256} from '../scene-transitions/build-review-proposal.mjs';
import {resolveTransitionRecommendation} from '../scene-transitions/contract.mjs';
import {
  buildStoryboardVisualRhythmMapSha256,
} from '../storyboard-visual-rhythm/contract.mjs';
import {
  buildVisualAssetsManifest,
  canonicalJson,
  lockVisualAssets,
  validateVisualAssetsManifest,
} from './finalize-visual-assets-manifest.mjs';

const NOW = '2026-08-22T10:00:00+08:00';
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const canonicalSha256 = (value) => sha256(Buffer.from(canonicalJson(value)));
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
const withGptImage2Observation = (png) => {
  const iend = png.lastIndexOf(Buffer.from('IEND', 'ascii')) - 4;
  assert.ok(iend >= 8);
  return Buffer.concat([
    png.subarray(0, iend),
    pngChunk('caBX', c2paObservationPayload()),
    png.subarray(iend),
  ]);
};

const write = (root, relative, bytes) => {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, bytes);
  return target;
};

const writeJson = (root, relative, value) => write(root, relative, jsonBytes(value));
const readJson = (root, relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));

const makeRaster = (width, height, background) => sharp({
  create: {width, height, channels: 3, background},
}).png({compressionLevel: 9, adaptiveFiltering: false, palette: false}).toBuffer();

const normalize = (bytes) => sharp(bytes, {failOn: 'error'})
  .resize(1920, 1080, {
    fit: 'cover',
    position: 'centre',
    kernel: sharp.kernel.lanczos3,
  })
  .png({compressionLevel: 9, adaptiveFiltering: false, palette: false})
  .toBuffer();

const normalizationEvidence = ({
  sourcePath,
  sourceBytes,
  sourceDimensions,
  outputPath,
  outputBytes,
}) => ({
  contract_version: 'normalized-raster-evidence-v1',
  result: 'pass',
  source: {
    path: sourcePath,
    checksum_sha256: sha256(sourceBytes),
    dimensions: sourceDimensions,
    relative_aspect_ratio_error: 0,
  },
  normalized: {
    path: outputPath,
    checksum_sha256: sha256(outputBytes),
    dimensions: [1920, 1080],
  },
  geometry: coverGeometry(...sourceDimensions),
  method: 'sharp-lanczos3-scale-to-cover-centered-minimal-crop-png9-v1',
  stretch: false,
  padding: false,
});

const performancePlan = () => ({
  character_goal: '看懂因果',
  emotion: '专注',
  anticipation: '视线前移',
  main_action: '指向关键节点',
  contact_and_weight: '手掌稳定接触桌面',
  impact: '节点被强调',
  recoil: '手腕轻微回弹',
  follow_through: '视线跟随信息',
  settled_pose: '稳定站定',
  allowed_environment_responses: ['节点亮起'],
  camera_motion_complexity: 'simple',
});

const continuity = (risk = 'low') => ({
  identity: risk,
  action: risk,
  prop: risk,
  space: risk,
  lighting: risk,
  eyeline: risk,
  ...(risk === 'high' ? {
    exit_state: '手指指向节点',
    entry_state: '节点已经亮起',
    invariants: ['人物身份', '节点位置'],
    allowed_changes: ['节点亮度'],
    edit_motivation: '从建立切到结果',
  } : {}),
});

const passingQaFields = () => ({
  technical_qa: {result: 'pass'},
  semantic_qa: {result: 'pass'},
  visible_text_qa: {result: 'pass'},
  style_qa: {result: 'pass'},
  visual_qa: {result: 'pass'},
});

const buildBatchPayload = (assets) => ({
  contract_version: 'visual-asset-batch-manifest-v1',
  assets: assets.map(({asset_id: assetId, checksum_sha256: checksum}) => ({
    asset_id: assetId,
    checksum_sha256: checksum,
  })),
});

const buildIanPackageReview = (item) => {
  const payload = {
    contract_version: IAN_LAYERED_SCENE_PACKAGE_VERSION,
    manifest: {
      path: item.scene_package_manifest_path,
      checksum_sha256: item.scene_package_manifest_checksum_sha256,
    },
    scene_plan_sha256: item.ian_scene_plan_sha256,
    members: item.ian_scene_package_members,
  };
  return {...payload, package_review_sha256: canonicalSha256(payload)};
};

const makeFixture = async () => {
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-finalizer-v1-'));
  const episodeWorkspace = 'episodes/fixture';
  const prefix = episodeWorkspace;
  const paths = {
    state: `${prefix}/schema/episode-state.json`,
    manifest: `${prefix}/schema/visual-assets-manifest-v1.json`,
    storyboard: `${prefix}/assets/narration/storyboard-v1.md`,
    draft: `${prefix}/assets/narration/storyboard-draft-v1.md`,
    narration: `${prefix}/assets/audio/narration-master-v1.mp3`,
    direction: `${prefix}/schema/per-shot-visual-direction-review-v3.json`,
    rhythm: `${prefix}/schema/storyboard-visual-rhythm-v1.json`,
    schedules: `${prefix}/schema/action-state-schedules-v3.json`,
    transitions: `${prefix}/schema/per-boundary-transition-review-v1.json`,
    coverEvidence: `${prefix}/schema/cover-normalization-v1.json`,
    normalizationDirectory: `${prefix}/schema/normalization`,
    reference: `${prefix}/assets/reference/style-reference.txt`,
    ianReference: '.agents/skills/ian-handdrawn-ppt/assets/reference-handdrawn-article-illustration-style.png',
  };

  const storyboardBytes = Buffer.from([
    '## OPEN-00',
    '- 锁稿原文 source_text：',
    '```text',
    '封面',
    '```',
    '',
    '## S01',
    '- 锁稿原文 source_text：',
    '```text',
    '测试图解',
    '```',
    '',
    '## S02',
    '- 锁稿原文 source_text：',
    '```text',
    '甲乙',
    '```',
    '',
  ].join('\n'));
  const draftBytes = Buffer.from('# source draft\n');
  const narrationBytes = Buffer.from('fixture narration bytes\n');
  const referenceBytes = Buffer.from('locked style reference\n');
  const ianReferenceBytes = await makeRaster(1920, 1080, '#fdfcf9');
  write(repositoryRoot, paths.storyboard, storyboardBytes);
  write(repositoryRoot, paths.draft, draftBytes);
  write(repositoryRoot, paths.narration, narrationBytes);
  write(repositoryRoot, paths.reference, referenceBytes);
  write(repositoryRoot, paths.ianReference, ianReferenceBytes);

  const storyboardChecksum = sha256(storyboardBytes);
  const draftChecksum = sha256(draftBytes);

  const direction = {
    contract_version: 'per-shot-visual-direction-review-v3',
    status: 'approved',
    catalog_version: 'visual-direction-catalog-v3',
    catalog_checksum_sha256: '1'.repeat(64),
    visual_language_catalog_version: 'visual-language-catalog-v1',
    visual_language_catalog_checksum_sha256: '2'.repeat(64),
    storyboard: {path: paths.draft, checksum_sha256: draftChecksum},
    presented_map_sha256: '3'.repeat(64),
    approval: {
      status: 'approved',
      exact_message: '批准视觉方向。',
      decided_at: NOW,
      presented_map_sha256: '3'.repeat(64),
    },
    rows: [
      {
        shot_id: 'S01',
        scene_class: 'structured_graphic',
        user_selection: {
          status: 'approved',
          white_cat_present: false,
          visual_generation_route: 'ian-handdrawn-ppt',
          visual_structure_id: 'timeline',
          treatment_profile_id: 'ian-handdrawn-technical',
          visible_text_mode: 'none',
          exact_visible_text: null,
          visible_text_placement: null,
          exact_message: '批准 S01 方向。',
          decided_at: NOW,
          presented_map_sha256: '3'.repeat(64),
        },
      },
      {
        shot_id: 'S02',
        scene_class: 'narrative_illustration',
        user_selection: {
          status: 'approved',
          white_cat_present: false,
          visual_generation_route: 'imagegen',
          visual_structure_id: 'single-scene',
          treatment_profile_id: 'imagegen-watercolor-narrative',
          visible_text_mode: 'none',
          exact_visible_text: null,
          visible_text_placement: null,
          exact_message: '批准 S02 方向。',
          decided_at: NOW,
          presented_map_sha256: '3'.repeat(64),
        },
      },
    ],
  };
  writeJson(repositoryRoot, paths.direction, direction);
  const directionChecksum = sha256(fs.readFileSync(path.join(repositoryRoot, paths.direction)));

  const schedule = buildActionStateScheduleV3({
    totalFrames: 60,
    sourceText: '甲乙',
    motionTier: 'stateful',
    states: [
      {
        state_id: 'S02-state-01',
        semantic_state: '先理解',
        narration_byte_start: 0,
        narration_byte_end: 3,
        narration_text: '甲',
        at_frame: 0,
      },
      {
        state_id: 'S02-state-02',
        semantic_state: '再行动',
        narration_byte_start: 3,
        narration_byte_end: 6,
        narration_text: '乙',
        at_frame: 30,
      },
    ],
  });
  const schedulePlanSha256 = buildActionStatePlanSha256(schedule);
  const scheduleValidation = validateActionStateSchedule(schedule, {totalFrames: 60, fps: 30});

  const rhythm = {
    contract_version: 'storyboard-visual-rhythm-v1',
    profile: 'medium_high_v1',
    status: 'approved',
    storyboard: {path: paths.draft, checksum_sha256: draftChecksum},
    visual_direction_review: {path: paths.direction, checksum_sha256: directionChecksum},
    shots: [
      {
        shot_id: 'S01',
        start_frame: 0,
        end_frame: 60,
        motion_tier: 'layered',
        attention_function: 'hook',
        visual_question: '图解要说明什么？',
        visual_payoff: '结构清晰出现',
        visual_structure_id: 'timeline',
        state_count_rationale: null,
        asset_plan: {
          main_image_count: 1,
          layer_count: 3,
          pose_count: 0,
          reuse_plan: ['复用锁定画布'],
        },
        meaningful_change_events: [
          {at_frame: 0, kind: 'attention-shift', description: '聚焦标题区'},
          {at_frame: 30, kind: 'information-reveal', description: '结构逐层出现'},
        ],
        intra_shot_transition_plan: [],
        performance_plan: performancePlan(),
        continuity: continuity(),
      },
      {
        shot_id: 'S02',
        start_frame: 60,
        end_frame: 120,
        motion_tier: 'stateful',
        attention_function: 'payoff',
        visual_question: '理解如何变成行动？',
        visual_payoff: '行动结果出现',
        visual_structure_id: 'single-scene',
        state_count_rationale: null,
        asset_plan: {
          main_image_count: 2,
          layer_count: 0,
          pose_count: 0,
          reuse_plan: ['复用锁定背景'],
        },
        meaningful_change_events: [
          {at_frame: 60, kind: 'causal-action', description: '人物开始行动'},
          {at_frame: 90, kind: 'information-reveal', description: '行动结果出现'},
        ],
        intra_shot_transition_plan: schedule.intra_shot_transitions.map((transition) => ({
          from_asset_id: transition.from_asset_id,
          to_asset_id: transition.to_asset_id,
          kind: transition.kind,
        })),
        performance_plan: performancePlan(),
        continuity: continuity('high'),
      },
    ],
    approval: {
      status: 'approved',
      exact_message: '批准视觉节奏。',
      decided_at: NOW,
      presented_map_sha256: null,
    },
    presented_map_sha256: null,
  };
  rhythm.presented_map_sha256 = buildStoryboardVisualRhythmMapSha256(rhythm);
  rhythm.approval.presented_map_sha256 = rhythm.presented_map_sha256;
  writeJson(repositoryRoot, paths.rhythm, rhythm);
  const rhythmChecksum = sha256(fs.readFileSync(path.join(repositoryRoot, paths.rhythm)));

  const scheduleSet = {
    contract_version: 'action-state-schedule-set-v1',
    storyboard: {path: paths.draft, checksum_sha256: draftChecksum},
    visual_rhythm: {path: paths.rhythm, checksum_sha256: rhythmChecksum},
    schedule_count: 1,
    qa: {
      all_schedules_validated: true,
      exact_utf8_coverage: true,
      complete_frame_coverage: true,
    },
    schedules: [{
      shot_id: 'S02',
      shot_start_frame: 60,
      shot_end_frame: 120,
      state_plan_sha256: schedulePlanSha256,
      validation: scheduleValidation,
      schedule,
    }],
  };
  writeJson(repositoryRoot, paths.schedules, scheduleSet);
  const schedulesChecksum = sha256(fs.readFileSync(path.join(repositoryRoot, paths.schedules)));

  const recommended = resolveTransitionRecommendation({
    boundaryChangeClass: 'route_change',
    sourceVisualGenerationRoute: 'ian-handdrawn-ppt',
    nextVisualGenerationRoute: 'imagegen',
    sourceWhiteCatPresent: false,
    nextWhiteCatPresent: false,
  });
  const transitionRow = {
    contract_version: 'scene-transition-v3',
    catalog_version: 'scene-transition-catalog-v3',
    source_shot_id: 'S01',
    next_shot_id: 'S02',
    boundary_change_class: 'route_change',
    source_visual_generation_route: 'ian-handdrawn-ppt',
    next_visual_generation_route: 'imagegen',
    source_white_cat_present: false,
    next_white_cat_present: false,
    recommended_transition: recommended.recommended_transition,
    recommendation_source: recommended.recommendation_source,
    kind: recommended.recommended_transition.kind,
    options: recommended.recommended_transition.options,
    duration_seconds: 0.4,
    duration_in_frames: 12,
    source_intent: '以纸张质感切换视觉路线',
    renderer: 'leverage-video/src/shared/scene-transitions',
    user_selection: {
      status: 'approved',
      exact_message: '批准边界转场。',
      decided_at: NOW,
      presented_map_sha256: null,
    },
  };
  const transitions = {
    contract_version: 'per-boundary-transition-review-v1',
    status: 'approved',
    catalog_version: 'scene-transition-catalog-v3',
    fps: 30,
    storyboard: {path: paths.draft, checksum_sha256: draftChecksum},
    visual_direction_review: {path: paths.direction, checksum_sha256: directionChecksum},
    ordinary_boundary_count: 1,
    rows: [transitionRow],
    presented_map_sha256: null,
    approval: {
      status: 'approved',
      exact_message: '批准全部边界转场。',
      decided_at: NOW,
      presented_map_sha256: null,
    },
  };
  const transitionMapSha256 = buildTransitionReviewPresentedMapSha256(transitions);
  transitions.presented_map_sha256 = transitionMapSha256;
  transitions.approval.presented_map_sha256 = transitionMapSha256;
  transitionRow.user_selection.presented_map_sha256 = transitionMapSha256;
  writeJson(repositoryRoot, paths.transitions, transitions);
  const transitionsChecksum = sha256(fs.readFileSync(path.join(repositoryRoot, paths.transitions)));

  const ianSourceMasterPng = await sharp({
    create: {
      width: 1920,
      height: 1080,
      channels: 3,
      background: {r: 244, g: 240, b: 231},
    },
  }).composite([{
    input: Buffer.from('<svg width="1920" height="1080"><rect x="260" y="250" width="560" height="260" rx="24" fill="#587ea8"/><rect x="1080" y="570" width="580" height="250" rx="24" fill="#bd7358"/></svg>'),
  }]).removeAlpha().png({compressionLevel: 9, adaptiveFiltering: false, palette: false}).toBuffer();
  const ianSourceMaster = withGptImage2Observation(ianSourceMasterPng);
  const ianSplitSpec = {
    contract_version: 'ian-semantic-region-alpha-split-v1',
    normalization: {
      fit: 'cover',
      position: 'centre',
      kernel: 'lanczos3',
      stretch: false,
      padding: false,
    },
    matte_rgb: [244, 240, 231],
    alpha_distance_low: 6,
    alpha_distance_high: 24,
    blur_sigma_px: 0.8,
    paper_background_rgba: [244, 240, 231, 255],
    minimum_inter_layer_gutter_px: 24,
    outside_union_max_visible_pixels: 1024,
    layers: [
      {layer_id: 'L01', bbox: {x: 220, y: 210, width: 640, height: 340}},
      {layer_id: 'L02', bbox: {x: 1040, y: 530, width: 660, height: 330}},
    ],
  };
  const ianTextOverlay = {
    contract_version: 'ian-deterministic-layer-text-overlay-v1',
    mode: 'none',
    font: null,
    minimum_inset_px: 8,
    labels: [],
  };
  const ianSourceMasterPath = `${prefix}/assets/image/ian/S01/source-master-v01.png`;
  const ianNormalizedMasterPath = `${prefix}/assets/image/ian/S01/normalized-master-v01.png`;
  const ianBackgroundPath = `${prefix}/assets/image/ian/S01/background-v01.png`;
  const ianPreTextLayerOnePath = `${prefix}/assets/image/ian/S01/pre-text-layer-L01-v01.png`;
  const ianPreTextLayerTwoPath = `${prefix}/assets/image/ian/S01/pre-text-layer-L02-v01.png`;
  const ianLayerOnePath = `${prefix}/assets/image/ian/S01/layer-L01-v01.png`;
  const ianLayerTwoPath = `${prefix}/assets/image/ian/S01/layer-L02-v01.png`;
  const ianFinalCompositePath = `${prefix}/assets/image/ian/S01/final-composite-v01.png`;
  write(repositoryRoot, ianSourceMasterPath, ianSourceMaster);
  const ianScenePlan = {
    contract_version: IAN_LAYERED_SCENE_PLAN_VERSION,
    shot_id: 'S01',
    narration_source_text_sha256: sha256Text('测试图解'),
    scene_renderer: IAN_LAYERED_SCENE_RENDERER_VERSION,
    background_policy: 'static-paper-background-v1',
    layer_asset_policy: 'full-canvas-transparent-png-v1',
    layer_entry_transition: {
      contract_version: IAN_LAYER_ENTRY_TRANSITION_VERSION,
      duration_frames: IAN_LAYER_ENTRY_DURATION_FRAMES,
      easing: 'linear',
    },
    motion_policy: {
      scene_transform: 'forbidden',
      layer_transform: 'forbidden',
      mask_reveal: 'forbidden',
      internal_cut: 'forbidden',
      opacity_animation: IAN_LAYER_ENTRY_TRANSITION_VERSION,
    },
    layer_count: 2,
    layers: [
      {
        layer_id: 'L01',
        z_index: 1,
        semantic_role: '核心概念',
        source_text_start_byte: 0,
        source_text_end_byte_exclusive: 6,
        source_text: '测试',
        entry_frame: 0,
      },
      {
        layer_id: 'L02',
        z_index: 2,
        semantic_role: '解释图解',
        source_text_start_byte: 6,
        source_text_end_byte_exclusive: 12,
        source_text: '图解',
        entry_frame: 30,
      },
    ],
  };
  const ianDerived = await deriveIanLayeredSceneV2Bytes({
    sourceMasterBytes: ianSourceMaster,
    splitSpec: ianSplitSpec,
    textOverlay: ianTextOverlay,
    scenePlan: ianScenePlan,
  });
  const ianBackground = ianDerived.background;
  const [ianPreTextLayerOne, ianPreTextLayerTwo] = ianDerived.preTextLayers;
  const [ianLayerOne, ianLayerTwo] = ianDerived.layers;
  const ianFinalComposite = ianDerived.finalComposite;
  write(repositoryRoot, ianNormalizedMasterPath, ianDerived.normalizedMaster);
  write(repositoryRoot, ianBackgroundPath, ianBackground);
  write(repositoryRoot, ianPreTextLayerOnePath, ianPreTextLayerOne);
  write(repositoryRoot, ianPreTextLayerTwoPath, ianPreTextLayerTwo);
  write(repositoryRoot, ianLayerOnePath, ianLayerOne);
  write(repositoryRoot, ianLayerTwoPath, ianLayerTwo);
  write(repositoryRoot, ianFinalCompositePath, ianFinalComposite);
  const imageMaster = await makeRaster(1600, 900, '#afc7d8');
  const imageAction = await makeRaster(1600, 900, '#d8c3af');
  const imageMasterProduction = await normalize(imageMaster);
  const imageActionProduction = await normalize(imageAction);
  const rasterDefinitions = [
    {
      assetId: 'S01-master-v01',
      sourcePath: ianFinalCompositePath,
      sourceBytes: ianFinalComposite,
    },
    {
      assetId: 'S02-master-v01',
      sourcePath: `${prefix}/assets/image/s02-master-v01.png`,
      sourceBytes: imageMaster,
      productionBytes: imageMasterProduction,
    },
    {
      assetId: 'S02-action-01-v01',
      sourcePath: `${prefix}/assets/image/s02-action-01-v01.png`,
      sourceBytes: imageAction,
      productionBytes: imageActionProduction,
    },
  ];
  for (const definition of rasterDefinitions) {
    write(repositoryRoot, definition.sourcePath, definition.sourceBytes);
    if (definition.productionBytes) {
      const productionPath = `${prefix}/assets/image/production/${definition.assetId.toLowerCase()}-1920x1080-v1.png`;
      const evidencePath = `${paths.normalizationDirectory}/${definition.assetId.toLowerCase()}-normalization-v1.json`;
      write(repositoryRoot, productionPath, definition.productionBytes);
      writeJson(repositoryRoot, evidencePath, normalizationEvidence({
        sourcePath: definition.sourcePath,
        sourceBytes: definition.sourceBytes,
        sourceDimensions: [1600, 900],
        outputPath: productionPath,
        outputBytes: definition.productionBytes,
      }));
    }
  }

  const commonQueue = ({
    assetId,
    shotId,
    role,
    stateIndex,
    scheduleStateId,
    route,
    sourcePath,
    sourceBytes,
    sourceDimensions,
    startFrame,
    endFrame,
    narrationSourceText,
    directionRow,
  }) => {
    const promptPath = `${prefix}/assets/prompts/${assetId.toLowerCase()}.txt`;
    const promptBytes = Buffer.from(`镜头：${assetId}\n`);
    const qaPath = `${prefix}/schema/qa/${assetId.toLowerCase()}-qa-v1.json`;
    const qaFields = passingQaFields();
    const checksum = sha256(sourceBytes);
    write(repositoryRoot, promptPath, promptBytes);
    const item = {
      asset_id: assetId,
      shot_id: shotId,
      role,
      state_index: stateIndex,
      schedule_state_id: scheduleStateId,
      depends_on: stateIndex === 0 ? [] : ['S02-master-v01'],
      status: 'approved',
      active_for_current_storyboard: true,
      storyboard_path: paths.storyboard,
      storyboard_checksum_sha256: storyboardChecksum,
      storyboard_rebind_qa: {
        result: 'pass',
        path: paths.storyboard,
        checksum_sha256: storyboardChecksum,
      },
      narration_source_text: narrationSourceText,
      visual_generation_route: route,
      scene_class: directionRow.scene_class,
      visual_structure_id: directionRow.user_selection.visual_structure_id,
      treatment_profile_id: directionRow.user_selection.treatment_profile_id,
      white_cat_present: directionRow.user_selection.white_cat_present,
      visible_text_mode: directionRow.user_selection.visible_text_mode,
      exact_visible_text: directionRow.user_selection.exact_visible_text,
      visible_text_placement: directionRow.user_selection.visible_text_placement,
      shot_start_frame: startFrame,
      shot_end_frame: endFrame,
      shot_duration_frames: endFrame - startFrame,
      path: sourcePath,
      checksum_sha256: checksum,
      measured_dimensions: sourceDimensions,
      measured_aspect_ratio_relative_error: 0,
      prompt_path: promptPath,
      prompt_checksum_sha256: sha256(promptBytes),
      actual_reference_inputs: [{
        role: 'style-reference',
        path: paths.reference,
        checksum_sha256: sha256(referenceBytes),
      }],
      qa_evidence_path: qaPath,
      visual_direction_review_path: paths.direction,
      visual_direction_review_checksum_sha256: directionChecksum,
      visual_direction_presented_map_sha256: direction.presented_map_sha256,
      ...qaFields,
      presented_checksum_sha256: checksum,
      approved_checksum_sha256: checksum,
      approval_disk_checksum_sha256: checksum,
      approval_disk_measured_dimensions: sourceDimensions,
      approval_disk_verified_at: NOW,
      presented_at: NOW,
      decision_message: `批准 ${assetId}`,
      decision_time: NOW,
      exact_presentation_message: `请审核 ${assetId}`,
      strict_review: true,
      generator: {tool: 'fixture-generator', route},
      generation_lineage: [{
        stage: 'fixture-generation',
        prompt: {path: promptPath, checksum_sha256: sha256(promptBytes)},
        reference_inputs: [{path: paths.reference, checksum_sha256: sha256(referenceBytes)}],
        output: {path: sourcePath, checksum_sha256: checksum},
        selection_status: 'selected',
      }],
      rejected_attempts: [],
    };
    writeJson(repositoryRoot, qaPath, {contract_version: 'visual-asset-qa-v1', asset_id: assetId, result: 'pass', ...qaFields});
    item.qa_evidence_checksum_sha256 = sha256(fs.readFileSync(path.join(repositoryRoot, qaPath)));
    return item;
  };

  const queue = [
    commonQueue({
      assetId: 'S01-master-v01',
      shotId: 'S01',
      role: 'master',
      stateIndex: 0,
      scheduleStateId: null,
      route: 'ian-handdrawn-ppt',
      sourcePath: rasterDefinitions[0].sourcePath,
      sourceBytes: ianFinalComposite,
      sourceDimensions: [1920, 1080],
      startFrame: 0,
      endFrame: 60,
      narrationSourceText: '测试图解',
      directionRow: direction.rows[0],
    }),
    commonQueue({
      assetId: 'S02-master-v01',
      shotId: 'S02',
      role: 'master',
      stateIndex: 0,
      scheduleStateId: 'S02-state-01',
      route: 'imagegen',
      sourcePath: rasterDefinitions[1].sourcePath,
      sourceBytes: imageMaster,
      sourceDimensions: [1600, 900],
      startFrame: 60,
      endFrame: 120,
      narrationSourceText: '甲乙',
      directionRow: direction.rows[1],
    }),
    commonQueue({
      assetId: 'S02-action-01-v01',
      shotId: 'S02',
      role: 'action-state',
      stateIndex: 1,
      scheduleStateId: 'S02-state-02',
      route: 'imagegen',
      sourcePath: rasterDefinitions[2].sourcePath,
      sourceBytes: imageAction,
      sourceDimensions: [1600, 900],
      startFrame: 60,
      endFrame: 120,
      narrationSourceText: '甲乙',
      directionRow: direction.rows[1],
    }),
  ];

  const ianScenePlanSha256 = sha256IanCanonical(ianScenePlan);
  const ianScenePackagePath = `${prefix}/schema/ian/s01-layered-scene-v2.json`;
  const ianMasterPromptPath = `${prefix}/assets/prompts/s01-ian-master.txt`;
  const ianMasterPromptBytes = Buffer.from(
    '16:9 landscape composition\nno visible text\nclean non-overlapping semantic zones\n',
  );
  write(repositoryRoot, ianMasterPromptPath, ianMasterPromptBytes);
  const ianMasterPrompt = {
    path: ianMasterPromptPath,
    checksum_sha256: sha256(ianMasterPromptBytes),
  };
  const ianReferences = [{
    role: 'visual_style_reference_only',
    path: paths.ianReference,
    checksum_sha256: sha256(ianReferenceBytes),
  }];
  queue[0].actual_reference_inputs = structuredClone(ianReferences);
  const ianScenePackage = {
    contract_version: IAN_LAYERED_SCENE_PACKAGE_VERSION,
    episode_workspace: episodeWorkspace,
    queue_item_id: queue[0].asset_id,
    shot_id: queue[0].shot_id,
    visual_generation_route: queue[0].visual_generation_route,
    treatment_profile_id: queue[0].treatment_profile_id,
    storyboard_binding: {
      path: paths.storyboard,
      checksum_sha256: storyboardChecksum,
    },
    visual_direction_review: {
      path: paths.direction,
      checksum_sha256: directionChecksum,
      presented_map_sha256: direction.presented_map_sha256,
    },
    canvas: {width: 1920, height: 1080, fps: 30},
    timing: {shot_start_frame: 0, shot_end_frame: 60, duration_frames: 60},
    narration_source_text: queue[0].narration_source_text,
    narration_source_text_sha256: sha256Text(queue[0].narration_source_text),
    scene_plan: ianScenePlan,
    scene_plan_sha256: ianScenePlanSha256,
    generation_constraints: {
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
    },
    master_generation: {
      contract_version: 'ian-gpt-image-2-text-free-master-v1',
      generator: 'codex-native-imagegen',
      model_id: 'gpt-image-2',
      prompt: ianMasterPrompt,
      reference_inputs: structuredClone(ianReferences),
      selection_status: 'selected',
      visible_text_mode: 'none',
      source_master: {
        path: ianSourceMasterPath,
        checksum_sha256: sha256(ianSourceMaster),
        width: 1920,
        height: 1080,
        role: 'text-free-complete-master-source',
        has_alpha: false,
      },
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
      source_master_checksum_sha256: sha256(ianSourceMaster),
      expected_software_agent: {name: 'gpt-image', version: '2.0'},
    },
    normalized_master: {
      path: ianNormalizedMasterPath,
      checksum_sha256: sha256(ianDerived.normalizedMaster),
      width: 1920,
      height: 1080,
      role: 'text-free-complete-master-normalized',
      has_alpha: false,
    },
    split_spec: ianSplitSpec,
    background: {
      path: ianBackgroundPath,
      checksum_sha256: sha256(ianBackground),
      width: 1920,
      height: 1080,
      role: 'static-paper-background',
      has_alpha: false,
    },
    pre_text_layers: ianScenePlan.layers.map((layer, index) => ({
      ...layer,
      path: [ianPreTextLayerOnePath, ianPreTextLayerTwoPath][index],
      checksum_sha256: sha256([ianPreTextLayerOne, ianPreTextLayerTwo][index]),
      width: 1920,
      height: 1080,
      role: 'transparent-semantic-element-pre-text',
      has_alpha: true,
    })),
    text_overlay: ianTextOverlay,
    layers: ianScenePlan.layers.map((layer, index) => ({
      ...layer,
      path: [ianLayerOnePath, ianLayerTwoPath][index],
      checksum_sha256: sha256([ianLayerOne, ianLayerTwo][index]),
      width: 1920,
      height: 1080,
      role: 'transparent-semantic-element',
      has_alpha: true,
    })),
    final_composite: {
      path: queue[0].path,
      checksum_sha256: queue[0].approved_checksum_sha256,
      width: 1920,
      height: 1080,
      role: 'final-composite-review-raster',
      has_alpha: false,
    },
    verified_visible_text: [],
  };
  writeJson(repositoryRoot, ianScenePackagePath, ianScenePackage);
  const ianScenePackageMembers = [
    {
      member_role: 'source-master',
      layer_id: 'source-master',
      ...ianScenePackage.master_generation.source_master,
    },
    {
      member_role: 'normalized-master',
      layer_id: 'normalized-master',
      ...ianScenePackage.normalized_master,
    },
    {member_role: 'background', layer_id: 'background', ...ianScenePackage.background},
    ...ianScenePackage.pre_text_layers.map((layer) => ({member_role: 'pre-text-layer', ...layer})),
    ...ianScenePackage.layers.map((layer) => ({member_role: 'semantic-layer', ...layer})),
    {member_role: 'final-composite', layer_id: 'final-composite', ...ianScenePackage.final_composite},
  ].map((member) => ({
    member_role: member.member_role,
    layer_id: member.layer_id,
    path: member.path,
    checksum_sha256: member.checksum_sha256,
    width: member.width,
    height: member.height,
    has_alpha: member.has_alpha,
  }));
  const ianGenerationLineage = [{
    stage: 'complete-master-generation',
    generation_mode: 'codex-native-imagegen-gpt-image-2-text-free-master-v1',
    model_id: 'gpt-image-2',
    prompt: ianMasterPrompt,
    reference_inputs: structuredClone(ianReferences),
    output: {
      path: ianScenePackage.master_generation.source_master.path,
      checksum_sha256: ianScenePackage.master_generation.source_master.checksum_sha256,
    },
    selection_status: 'selected',
  }];
  Object.assign(queue[0], {
    qa_contract_version: 'ian-layered-scene-qa-v2',
    scene_package_manifest_path: ianScenePackagePath,
    scene_package_manifest_checksum_sha256: sha256(fs.readFileSync(
      path.join(repositoryRoot, ianScenePackagePath),
    )),
    ian_scene_plan: ianScenePlan,
    ian_scene_plan_sha256: ianScenePlanSha256,
    ian_scene_package_members: ianScenePackageMembers,
    generation_lineage: ianGenerationLineage,
    style_skill: {id: 'ian-handdrawn-ppt', status: 'generation-time-recorded'},
  });
  queue[0].presented_ian_layered_scene_package = buildIanPackageReview(queue[0]);
  queue[0].approved_ian_layered_scene_package = buildIanPackageReview(queue[0]);

  queue.slice(1).forEach((item, index) => {
    Object.assign(item, {
      motion_tier: 'stateful',
      action_state_schedule_contract_version: 'action-state-schedule-v3',
      action_state_plan_sha256: schedulePlanSha256,
      semantic_state: schedule.occurrences[index].semantic_state,
      strict_review: false,
      exact_presentation_message: null,
    });
  });

  const batchAssets = queue.slice(1).map((item) => ({
    asset_id: item.asset_id,
    checksum_sha256: item.approved_checksum_sha256,
  }));
  const batchPayload = buildBatchPayload(batchAssets);
  const batchManifestSha256 = canonicalSha256(batchPayload);
  const batchManifest = {
    ...batchPayload,
    episode_workspace: episodeWorkspace,
    storyboard_path: paths.storyboard,
    storyboard_checksum_sha256: storyboardChecksum,
    asset_ids: batchAssets.map(({asset_id: assetId}) => assetId),
    checksum_map: Object.fromEntries(batchAssets.map((asset) => [asset.asset_id, asset.checksum_sha256])),
    manifest_sha256: batchManifestSha256,
    presented_at: NOW,
    exact_presentation_message: '请审核 S02 两张资产。',
    review_assets: queue.slice(1).map((item) => ({
      asset_id: item.asset_id,
      path: item.path,
      checksum_sha256: item.approved_checksum_sha256,
      narration_source_text: item.narration_source_text,
      technical_qa: item.technical_qa,
    })),
  };
  writeJson(repositoryRoot, `${prefix}/schema/visual-asset-batch-s02-v1.json`, batchManifest);
  queue.slice(1).forEach((item) => {
    item.presented_batch_manifest_sha256 = batchManifestSha256;
    item.batch_manifest_sha256 = batchManifestSha256;
    item.batch_qa_checksum_sha256 = '5'.repeat(64);
    item.batch_qa_time = NOW;
  });

  const externalCoverBytes = await makeRaster(1600, 900, '#f2dfba');
  const coverProductionBytes = await normalize(externalCoverBytes);
  const externalCoverTarget = write(repositoryRoot, 'approved-external-cover.png', externalCoverBytes);
  const externalCoverPath = fs.realpathSync(externalCoverTarget);
  const coverArchivePath = `${prefix}/assets/image/cover-source-v1.png`;
  const coverProductionPath = `${prefix}/assets/image/cover-1920x1080-v1.png`;
  write(repositoryRoot, coverArchivePath, externalCoverBytes);
  write(repositoryRoot, coverProductionPath, coverProductionBytes);
  writeJson(repositoryRoot, paths.coverEvidence, normalizationEvidence({
    sourcePath: coverArchivePath,
    sourceBytes: externalCoverBytes,
    sourceDimensions: [1600, 900],
    outputPath: coverProductionPath,
    outputBytes: coverProductionBytes,
  }));

  const state = {
    contract_version: 'knowledge-video-episode-state-v1',
    workspace_path: episodeWorkspace,
    phase: 'visual_production',
    current_phase: 'visual_production',
    active_storyboard: {
      status: 'approved',
      path: paths.storyboard,
      checksum_sha256: storyboardChecksum,
      source_draft_path: paths.draft,
      source_draft_checksum_sha256: draftChecksum,
      approved_at: NOW,
      exact_approval_message: '批准分镜。',
    },
    storyboard_review: {
      status: 'approved',
      presented_path: paths.storyboard,
      presented_checksum_sha256: storyboardChecksum,
      approved_path: paths.storyboard,
      approved_checksum_sha256: storyboardChecksum,
      exact_decision_message: '批准分镜。',
      decided_at: NOW,
    },
    visual_direction_review: {
      status: 'approved',
      path: paths.direction,
      checksum_sha256: directionChecksum,
      presented_map_sha256: direction.presented_map_sha256,
    },
    storyboard_visual_rhythm: {
      status: 'approved',
      path: paths.rhythm,
      checksum_sha256: rhythmChecksum,
      presented_map_sha256: rhythm.presented_map_sha256,
      approval: rhythm.approval,
      action_state_schedule_set_path: paths.schedules,
      action_state_schedule_set_checksum_sha256: schedulesChecksum,
    },
    transition_review: {
      status: 'approved',
      path: paths.transitions,
      checksum_sha256: transitionsChecksum,
      presented_map_sha256: transitionMapSha256,
      ordinary_boundary_count: 1,
    },
    narration_audio: {
      archive_path: paths.narration,
      checksum_sha256: sha256(narrationBytes),
      duration_seconds: 4,
    },
    opening_cover: {
      contract_version: 'cover-only-v1',
      source_path: externalCoverPath,
      source_checksum_sha256: sha256(externalCoverBytes),
      size_bytes: externalCoverBytes.length,
      codec: 'png',
      pixel_format: 'rgb24',
      width: 1600,
      height: 900,
      relative_aspect_ratio_error_percent: 0,
      regular_non_symlink_nonempty: 'pass',
      decode_result: 'pass',
      no_added_text: true,
    },
    visual_asset_review: {
      mode: 'hybrid_batch_v1',
      status: 'in_progress',
      active_batch: null,
      queue_generation_allowed: true,
      queue,
    },
    blockers: [],
  };
  writeJson(repositoryRoot, paths.state, state);

  return {
    repositoryRoot,
    episodeWorkspace,
    paths,
    state,
    queue,
    schedule,
    batchManifest,
    production: {
      master: `${prefix}/assets/image/production/s02-master-v01-1920x1080-v1.png`,
      action: `${prefix}/assets/image/production/s02-action-01-v01-1920x1080-v1.png`,
    },
  };
};

const setup = async (t) => {
  const fixture = await makeFixture();
  t.after(() => {
    const resolved = fs.realpathSync(fixture.repositoryRoot);
    const temporaryRoot = fs.realpathSync(os.tmpdir());
    assert.ok(resolved.startsWith(`${temporaryRoot}${path.sep}`));
    fs.rmSync(resolved, {recursive: true});
  });
  return fixture;
};

const buildOptions = (fixture) => ({
  episodeWorkspace: fixture.episodeWorkspace,
  repositoryRoot: fixture.repositoryRoot,
  lockedAt: NOW,
});

const rewriteState = (fixture, mutate) => {
  const state = readJson(fixture.repositoryRoot, fixture.paths.state);
  mutate(state);
  writeJson(fixture.repositoryRoot, fixture.paths.state, state);
  return state;
};

const authorizeFixtureOneClick = (
  fixture,
  {fabricateDirectionSelection = false, fabricateTransitionApproval = false} = {},
) => {
  const policySha256 = 'f'.repeat(64);
  const authorization = (presentedMapSha256) => ({
    policy_sha256: policySha256,
    authorized_at: NOW,
    user_has_reviewed_specific_map: false,
    presented_map_sha256: presentedMapSha256,
  });
  const selectionAuthorization = (selection, presentedMapSha256) => ({
    ...selection,
    status: 'policy_authorized',
    policy_sha256: policySha256,
    deterministic_recommendation_selected: true,
    user_has_reviewed_specific_map: false,
    exact_message: null,
    decided_at: null,
    authorized_at: NOW,
    presented_map_sha256: presentedMapSha256,
  });

  const direction = readJson(fixture.repositoryRoot, fixture.paths.direction);
  direction.status = 'policy_authorized';
  delete direction.approval;
  direction.policy_authorization = authorization(direction.presented_map_sha256);
  direction.rows.forEach((row) => {
    row.user_selection = selectionAuthorization(row.user_selection, direction.presented_map_sha256);
  });
  if (fabricateDirectionSelection) {
    direction.rows[0].user_selection.exact_message = '伪造已看过具体视觉方向表';
  }
  writeJson(fixture.repositoryRoot, fixture.paths.direction, direction);
  const directionChecksum = sha256(fs.readFileSync(path.join(fixture.repositoryRoot, fixture.paths.direction)));

  const rhythm = readJson(fixture.repositoryRoot, fixture.paths.rhythm);
  rhythm.status = 'policy_authorized';
  delete rhythm.approval;
  rhythm.visual_direction_review.checksum_sha256 = directionChecksum;
  rhythm.presented_map_sha256 = buildStoryboardVisualRhythmMapSha256(rhythm);
  rhythm.policy_authorization = {
    status: 'policy_authorized',
    deterministic_recommendation_selected: true,
    ...authorization(rhythm.presented_map_sha256),
  };
  writeJson(fixture.repositoryRoot, fixture.paths.rhythm, rhythm);
  const rhythmChecksum = sha256(fs.readFileSync(path.join(fixture.repositoryRoot, fixture.paths.rhythm)));

  const schedules = readJson(fixture.repositoryRoot, fixture.paths.schedules);
  schedules.visual_rhythm.checksum_sha256 = rhythmChecksum;
  writeJson(fixture.repositoryRoot, fixture.paths.schedules, schedules);
  const schedulesChecksum = sha256(fs.readFileSync(path.join(fixture.repositoryRoot, fixture.paths.schedules)));

  const transitions = readJson(fixture.repositoryRoot, fixture.paths.transitions);
  transitions.status = 'policy_authorized';
  delete transitions.approval;
  transitions.visual_direction_review.checksum_sha256 = directionChecksum;
  transitions.presented_map_sha256 = buildTransitionReviewPresentedMapSha256(transitions);
  transitions.policy_authorization = authorization(transitions.presented_map_sha256);
  transitions.rows.forEach((row) => {
    row.user_selection = selectionAuthorization(row.user_selection, transitions.presented_map_sha256);
  });
  if (fabricateTransitionApproval) {
    transitions.approval = {
      status: 'approved',
      exact_message: '伪造已看过具体转场表',
      decided_at: NOW,
      presented_map_sha256: transitions.presented_map_sha256,
    };
  }
  writeJson(fixture.repositoryRoot, fixture.paths.transitions, transitions);
  const transitionsChecksum = sha256(fs.readFileSync(path.join(fixture.repositoryRoot, fixture.paths.transitions)));

  const state = readJson(fixture.repositoryRoot, fixture.paths.state);
  const queue = state.visual_asset_review.queue;
  const ianScenePackage = readJson(fixture.repositoryRoot, queue[0].scene_package_manifest_path);
  ianScenePackage.visual_direction_review.checksum_sha256 = directionChecksum;
  writeJson(fixture.repositoryRoot, queue[0].scene_package_manifest_path, ianScenePackage);
  const ianScenePackageChecksum = sha256(fs.readFileSync(
    path.join(fixture.repositoryRoot, queue[0].scene_package_manifest_path),
  ));

  queue.forEach((item) => {
    item.status = 'approved';
    item.decision_message = '批准完整精确哈希清单';
    item.decision_time = NOW;
    item.visual_direction_review_checksum_sha256 = directionChecksum;
    item.visual_direction_presented_map_sha256 = direction.presented_map_sha256;
    for (const field of [
      'approval_disk_checksum_sha256',
      'approval_disk_measured_dimensions',
      'approval_disk_verified_at',
      'presented_at',
      'exact_presentation_message',
      'strict_review',
      'batch_qa_checksum_sha256',
      'batch_qa_time',
      'presented_batch_manifest_sha256',
      'batch_manifest_sha256',
    ]) delete item[field];
  });
  queue[0].scene_package_manifest_checksum_sha256 = ianScenePackageChecksum;
  queue[0].presented_ian_layered_scene_package = buildIanPackageReview(queue[0]);
  queue[0].approved_ian_layered_scene_package = buildIanPackageReview(queue[0]);

  const pendingAssets = queue.map((item) => ({
    asset_id: item.asset_id,
    path: item.path,
    checksum_sha256: item.checksum_sha256,
    qa_status: 'qa_passed_pending_final_review',
    ...(item.visual_generation_route === 'ian-handdrawn-ppt'
      ? {ian_layered_scene_package: buildIanPackageReview(item)}
      : {}),
  }));
  const finalReviewPayload = {
    contract_version: 'visual-asset-review-v3',
    mode: 'one_click_final_review_v1',
    storyboard_sha256: state.active_storyboard.checksum_sha256,
    policy_sha256: policySha256,
    assets: pendingAssets,
  };
  const presentedMapSha256 = canonicalSha256(finalReviewPayload);

  Object.assign(state.active_storyboard, {
    status: 'policy_authorized',
    policy_sha256: policySha256,
    authorized_at: NOW,
    user_has_reviewed_specific_storyboard: false,
  });
  delete state.active_storyboard.approved_at;
  delete state.active_storyboard.exact_approval_message;
  Object.assign(state.storyboard_review, {
    status: 'policy_authorized',
    exact_decision_message: null,
    decided_at: null,
    policy_sha256: policySha256,
    authorized_at: NOW,
    user_has_reviewed_specific_storyboard: false,
  });
  state.visual_direction_review = {
    status: 'policy_authorized',
    path: fixture.paths.direction,
    checksum_sha256: directionChecksum,
    presented_map_sha256: direction.presented_map_sha256,
    policy_sha256: policySha256,
    user_has_reviewed_specific_map: false,
  };
  state.storyboard_visual_rhythm = {
    status: 'policy_authorized',
    path: fixture.paths.rhythm,
    checksum_sha256: rhythmChecksum,
    presented_map_sha256: rhythm.presented_map_sha256,
    policy_authorization: rhythm.policy_authorization,
    action_state_schedule_set_path: fixture.paths.schedules,
    action_state_schedule_set_checksum_sha256: schedulesChecksum,
  };
  state.transition_review = {
    status: 'policy_authorized',
    path: fixture.paths.transitions,
    checksum_sha256: transitionsChecksum,
    presented_map_sha256: transitions.presented_map_sha256,
    ordinary_boundary_count: transitions.rows.length,
    policy_sha256: policySha256,
    user_has_reviewed_specific_map: false,
  };
  state.workflow_approval_mode = {approval_mode: 'one_click'};
  state.one_click_approval_policy = {
    contract_version: 'one-click-approval-policy-v1',
    policy_sha256: policySha256,
    preauthorizations: {
      deterministic_visual_direction_recommendations: true,
      deterministic_transition_recommendations: true,
      continue_during_visual_production: true,
    },
    user_has_reviewed_specific_maps: false,
  };
  state.visual_asset_review = {
    contract_version: 'visual-asset-review-v3',
    mode: 'one_click_final_review_v1',
    status: 'in_progress',
    storyboard_sha256: state.active_storyboard.checksum_sha256,
    policy_sha256: policySha256,
    active_batch: null,
    queue_generation_allowed: true,
    queue,
    final_review: {
      ...finalReviewPayload,
      assets: pendingAssets.map((asset) => ({...asset, qa_status: 'approved'})),
      presented_map_sha256: presentedMapSha256,
      status: 'approved',
      exact_hash_list_approved: true,
      asset_list_sha256: presentedMapSha256,
      decision_message: '批准完整精确哈希清单',
      decision_time: NOW,
    },
  };
  state.phase = 'awaiting_caption_delivery_choice';
  state.current_phase = 'awaiting_caption_delivery_choice';
  writeJson(fixture.repositoryRoot, fixture.paths.state, state);
  return {policySha256, presentedMapSha256};
};

test('build preserves accepted-asset evidence and complete timing maps', async (t) => {
  const fixture = await setup(t);
  const manifest = await buildVisualAssetsManifest(buildOptions(fixture));

  assert.equal(manifest.result, 'pass');
  assert.equal('approval' in manifest.provenance.visual_direction_review, true);
  assert.equal('authorization' in manifest.provenance.visual_direction_review, false);
  assert.equal('approval' in manifest.provenance.storyboard_visual_rhythm, true);
  assert.equal('authorization' in manifest.provenance.storyboard_visual_rhythm, false);
  assert.deepEqual(manifest.counts, {
    scene_count: 2,
    active_asset_count: 3,
    intra_shot_transition_count: 1,
    ordinary_scene_transition_count: 1,
    visual_batch_manifest_count: 1,
  });
  assert.deepEqual(manifest.scenes.map((scene) => scene.narration_source_text), ['测试图解', '甲乙']);
  assert.equal(manifest.scenes[1].action_state_schedule.occurrence_asset_bindings.length, 2);
  assert.equal(manifest.scenes[1].action_state_schedule.validation.result, 'pass');
  assert.equal(
    manifest.assets[0].review_evidence.ian.scene_package_manifest.record.final_composite.role,
    'final-composite-review-raster',
  );
  assert.equal(manifest.assets[0].review_evidence.ian.package_review.members.length, 8);
  assert.deepEqual(
    manifest.assets[0].review_evidence.ian.package_review.members.map((member) => member.member_role),
    [
      'source-master', 'normalized-master', 'background',
      'pre-text-layer', 'pre-text-layer',
      'semantic-layer', 'semantic-layer', 'final-composite',
    ],
  );
  assert.equal(manifest.assets[0].review_evidence.generation_lineage.length, 1);
  assert.equal(
    manifest.assets[0].review_evidence.actual_reference_inputs[0].path,
    IAN_CANONICAL_STYLE_ANCHOR_PATH,
  );
  assert.equal(
    manifest.assets[0].review_evidence.ian.validation.model_provenance_observation.software_agent_version,
    '2.0',
  );
  assert.equal(manifest.scenes[0].ian_layered_scene.package.layers.length, 2);
  assert.equal(manifest.assets[1].review_evidence.selected_prompt.text_utf8, '镜头：S02-master-v01\n');
  assert.equal(manifest.assets[1].review_evidence.actual_reference_inputs[0].inspection.scope, 'repository-reference');
  assert.equal(manifest.assets[1].review_evidence.generation_lineage_file_bindings.length, 3);
  assert.equal(manifest.assets[1].review_evidence.batch_manifest.artifact.record.review_assets.length, 2);
  assert.equal(manifest.assets[1].deterministic_normalization_rerun_identical, true);
  assert.equal(manifest.cover.approved_external_source.path, fixture.state.opening_cover.source_path);
  assert.equal(manifest.cover.episode_archive.exact_bytes_equal_external_source, true);
  assert.equal(manifest.scene_transitions[0].renderer, 'leverage-video/src/shared/scene-transitions');
});

test('finalizer rejects an Ian queue record that substitutes an arbitrary style reference', async (t) => {
  const fixture = await setup(t);
  rewriteState(fixture, (state) => {
    state.visual_asset_review.queue[0].actual_reference_inputs[0] = {
      role: 'visual_style_reference_only',
      path: fixture.paths.reference,
      checksum_sha256: sha256(fs.readFileSync(path.join(
        fixture.repositoryRoot,
        fixture.paths.reference,
      ))),
    };
  });
  await assert.rejects(
    buildVisualAssetsManifest(buildOptions(fixture)),
    /single canonical Ian style anchor/,
  );
});

test('one-click exact-list approval builds and locks from caption choice without manual approval fields', async (t) => {
  const fixture = await setup(t);
  const {presentedMapSha256} = authorizeFixtureOneClick(fixture);

  const manifest = await buildVisualAssetsManifest(buildOptions(fixture));
  assert.equal(manifest.provenance.visual_direction_review.authorization.user_has_reviewed_specific_map, false);
  assert.equal('approval' in manifest.provenance.visual_direction_review, false);
  assert.equal(manifest.provenance.scene_transition_review.authorization.user_has_reviewed_specific_map, false);
  assert.equal('approval' in manifest.provenance.scene_transition_review, false);
  assert.equal(manifest.assets[0].review_evidence.batch_manifest, null);
  assert.equal(manifest.assets[0].review_evidence.one_click_final_review.presented_map_sha256, presentedMapSha256);
  assert.equal(manifest.assets[0].approval.exact_presentation_message, null);
  assert.equal(manifest.assets[0].approval.current_disk_verification.result, 'pass');
  writeJson(fixture.repositoryRoot, fixture.paths.manifest, manifest);
  assert.equal((await validateVisualAssetsManifest({
    episodeWorkspace: fixture.episodeWorkspace,
    repositoryRoot: fixture.repositoryRoot,
  })).result, 'pass');

  assert.equal((await lockVisualAssets(buildOptions(fixture))).result, 'pass');
  const lockedState = readJson(fixture.repositoryRoot, fixture.paths.state);
  assert.equal(lockedState.current_phase, 'awaiting_caption_delivery_choice');
  assert.equal(lockedState.phase, 'awaiting_caption_delivery_choice');
  assert.equal(lockedState.active_visual_manifest.status, 'active_locked');
  assert.equal(lockedState.visual_asset_review.status, 'locked');
});

test('one-click finalizer ignores superseded queue history outside the approved active list', async (t) => {
  const fixture = await setup(t);
  authorizeFixtureOneClick(fixture);
  rewriteState(fixture, (state) => {
    state.visual_asset_review.queue.push({
      ...structuredClone(state.visual_asset_review.queue[1]),
      asset_id: 'S02-master-v00',
      status: 'superseded',
      active_for_current_storyboard: false,
    });
  });

  const manifest = await buildVisualAssetsManifest(buildOptions(fixture));
  assert.equal(manifest.counts.active_asset_count, 3);
  assert.deepEqual(manifest.assets.map((asset) => asset.asset_id), [
    'S01-master-v01',
    'S02-master-v01',
    'S02-action-01-v01',
  ]);
});

test('one-click transition policy authorization rejects fabricated concrete review evidence', async (t) => {
  const fixture = await setup(t);
  authorizeFixtureOneClick(fixture, {fabricateTransitionApproval: true});
  await assert.rejects(
    buildVisualAssetsManifest(buildOptions(fixture)),
    /fabricates concrete review/,
  );
});

test('one-click direction policy authorization rejects a fabricated concrete selection', async (t) => {
  const fixture = await setup(t);
  authorizeFixtureOneClick(fixture, {fabricateDirectionSelection: true});
  await assert.rejects(
    buildVisualAssetsManifest(buildOptions(fixture)),
    /fabricates concrete review/,
  );
});

test('one-click final approval rejects a partial ordered exact-list', async (t) => {
  const fixture = await setup(t);
  authorizeFixtureOneClick(fixture);
  rewriteState(fixture, (state) => {
    state.visual_asset_review.final_review.assets.pop();
  });
  await assert.rejects(
    buildVisualAssetsManifest(buildOptions(fixture)),
    /does not exactly match the current ordered queue/,
  );
});

test('deterministic ImageGen normalization rejects plausible but different production bytes', async (t) => {
  const fixture = await setup(t);
  const replacement = await makeRaster(1920, 1080, '#ff00aa');
  write(fixture.repositoryRoot, fixture.production.master, replacement);
  const evidencePath = `${fixture.paths.normalizationDirectory}/s02-master-v01-normalization-v1.json`;
  const evidence = readJson(fixture.repositoryRoot, evidencePath);
  evidence.normalized.checksum_sha256 = sha256(replacement);
  writeJson(fixture.repositoryRoot, evidencePath, evidence);

  await assert.rejects(
    buildVisualAssetsManifest(buildOptions(fixture)),
    /deterministic normalization rerun/,
  );
});

test('self-reported schedule QA cannot hide a frame-coverage gap', async (t) => {
  const fixture = await setup(t);
  const schedules = readJson(fixture.repositoryRoot, fixture.paths.schedules);
  schedules.schedules[0].schedule.occurrences[1].at_frame = 31;
  writeJson(fixture.repositoryRoot, fixture.paths.schedules, schedules);
  const checksum = sha256(fs.readFileSync(path.join(fixture.repositoryRoot, fixture.paths.schedules)));
  rewriteState(fixture, (state) => {
    state.storyboard_visual_rhythm.action_state_schedule_set_checksum_sha256 = checksum;
  });

  await assert.rejects(
    buildVisualAssetsManifest(buildOptions(fixture)),
    /consecutive|coverage|at_frame/,
  );
});

test('schedule transition projection must exactly match approved visual rhythm', async (t) => {
  const fixture = await setup(t);
  const rhythm = readJson(fixture.repositoryRoot, fixture.paths.rhythm);
  rhythm.shots[1].intra_shot_transition_plan[0].kind = 'watercolor-bloom';
  rhythm.shots[1].intra_shot_transition_plan[0].user_selection = {
    status: 'approved',
    exact_message: '批准水彩过渡。',
    decided_at: NOW,
    presented_map_sha256: null,
  };
  rhythm.presented_map_sha256 = buildStoryboardVisualRhythmMapSha256(rhythm);
  rhythm.approval.presented_map_sha256 = rhythm.presented_map_sha256;
  rhythm.shots[1].intra_shot_transition_plan[0].user_selection.presented_map_sha256 = rhythm.presented_map_sha256;
  writeJson(fixture.repositoryRoot, fixture.paths.rhythm, rhythm);
  const rhythmChecksum = sha256(fs.readFileSync(path.join(fixture.repositoryRoot, fixture.paths.rhythm)));

  const schedules = readJson(fixture.repositoryRoot, fixture.paths.schedules);
  schedules.visual_rhythm.checksum_sha256 = rhythmChecksum;
  writeJson(fixture.repositoryRoot, fixture.paths.schedules, schedules);
  const schedulesChecksum = sha256(fs.readFileSync(path.join(fixture.repositoryRoot, fixture.paths.schedules)));
  rewriteState(fixture, (state) => {
    state.storyboard_visual_rhythm.checksum_sha256 = rhythmChecksum;
    state.storyboard_visual_rhythm.presented_map_sha256 = rhythm.presented_map_sha256;
    state.storyboard_visual_rhythm.approval = rhythm.approval;
    state.storyboard_visual_rhythm.action_state_schedule_set_checksum_sha256 = schedulesChecksum;
  });

  await assert.rejects(
    buildVisualAssetsManifest(buildOptions(fixture)),
    /schedule\/rhythm transition plan/,
  );
});

test('scene transition catalog validation rejects a renderer substitution', async (t) => {
  const fixture = await setup(t);
  const transitions = readJson(fixture.repositoryRoot, fixture.paths.transitions);
  transitions.rows[0].renderer = 'fixture/fallback-renderer';
  transitions.presented_map_sha256 = buildTransitionReviewPresentedMapSha256(transitions);
  transitions.approval.presented_map_sha256 = transitions.presented_map_sha256;
  transitions.rows[0].user_selection.presented_map_sha256 = transitions.presented_map_sha256;
  writeJson(fixture.repositoryRoot, fixture.paths.transitions, transitions);
  const checksum = sha256(fs.readFileSync(path.join(fixture.repositoryRoot, fixture.paths.transitions)));
  rewriteState(fixture, (state) => {
    state.transition_review.checksum_sha256 = checksum;
    state.transition_review.presented_map_sha256 = transitions.presented_map_sha256;
  });

  await assert.rejects(
    buildVisualAssetsManifest(buildOptions(fixture)),
    /renderer mismatch/,
  );
});

test('scene transition review map is recomputed from exact catalog rows', async (t) => {
  const fixture = await setup(t);
  const transitions = readJson(fixture.repositoryRoot, fixture.paths.transitions);
  transitions.presented_map_sha256 = 'f'.repeat(64);
  transitions.approval.presented_map_sha256 = transitions.presented_map_sha256;
  transitions.rows[0].user_selection.presented_map_sha256 = transitions.presented_map_sha256;
  writeJson(fixture.repositoryRoot, fixture.paths.transitions, transitions);
  const checksum = sha256(fs.readFileSync(path.join(fixture.repositoryRoot, fixture.paths.transitions)));
  rewriteState(fixture, (state) => {
    state.transition_review.checksum_sha256 = checksum;
    state.transition_review.presented_map_sha256 = transitions.presented_map_sha256;
  });

  await assert.rejects(
    buildVisualAssetsManifest(buildOptions(fixture)),
    /approved v3 review/,
  );
});

test('episode-scoped evidence rejects a parent escape through a symlink', async (t) => {
  const fixture = await setup(t);
  const escapedPath = `${fixture.episodeWorkspace}/assets/prompts/escaped.txt`;
  const escapedTarget = path.join(fixture.repositoryRoot, 'outside-prompt.txt');
  fs.writeFileSync(escapedTarget, 'outside\n');
  fs.symlinkSync(escapedTarget, path.join(fixture.repositoryRoot, escapedPath));
  rewriteState(fixture, (state) => {
    state.visual_asset_review.queue[0].prompt_path = escapedPath;
    state.visual_asset_review.queue[0].prompt_checksum_sha256 = sha256(Buffer.from('outside\n'));
  });

  await assert.rejects(
    buildVisualAssetsManifest(buildOptions(fixture)),
    /symbolic link/,
  );
});

test('generation lineage and rejected-attempt file pointers are current-byte evidence', async (t) => {
  const fixture = await setup(t);
  rewriteState(fixture, (state) => {
    state.visual_asset_review.queue[2].generation_lineage[0].output.checksum_sha256 = '0'.repeat(64);
  });

  await assert.rejects(
    buildVisualAssetsManifest(buildOptions(fixture)),
    /checksum mismatch/i,
  );
});

test('manifest validation rereads dependency bytes instead of trusting embedded pass fields', async (t) => {
  const fixture = await setup(t);
  const manifest = await buildVisualAssetsManifest(buildOptions(fixture));
  writeJson(fixture.repositoryRoot, fixture.paths.manifest, manifest);
  assert.equal((await validateVisualAssetsManifest({
    episodeWorkspace: fixture.episodeWorkspace,
    repositoryRoot: fixture.repositoryRoot,
  })).result, 'pass');

  const promptPath = fixture.queue[1].prompt_path;
  write(fixture.repositoryRoot, promptPath, Buffer.from('changed prompt\n'));
  await assert.rejects(
    validateVisualAssetsManifest({
      episodeWorkspace: fixture.episodeWorkspace,
      repositoryRoot: fixture.repositoryRoot,
    }),
    /checksum mismatch/i,
  );
});

test('lock is exclusive, writes once, and validates the locked state', async (t) => {
  const fixture = await setup(t);
  const result = await lockVisualAssets(buildOptions(fixture));
  assert.equal(result.result, 'pass');
  assert.equal(readJson(fixture.repositoryRoot, fixture.paths.state).current_phase, 'visual_assets_locked');
  assert.equal(fs.existsSync(path.join(
    fixture.repositoryRoot,
    fixture.episodeWorkspace,
    'schema',
    '.visual-assets-finalizer.lock',
  )), false);

  const concurrent = await setup(t);
  const lockPath = path.join(
    concurrent.repositoryRoot,
    concurrent.episodeWorkspace,
    'schema',
    '.visual-assets-finalizer.lock',
  );
  fs.writeFileSync(lockPath, 'other-process\n');
  await assert.rejects(lockVisualAssets(buildOptions(concurrent)), /another visual finalizer transaction/);
  assert.equal(fs.existsSync(path.join(concurrent.repositoryRoot, concurrent.paths.manifest)), false);
});

test('locked manifest validation remains fail-closed in downstream phases', async (t) => {
  const fixture = await setup(t);
  await lockVisualAssets(buildOptions(fixture));
  rewriteState(fixture, (state) => {
    state.phase = 'awaiting_caption_delivery_choice';
    state.current_phase = 'awaiting_caption_delivery_choice';
  });

  assert.equal((await validateVisualAssetsManifest({
    episodeWorkspace: fixture.episodeWorkspace,
    repositoryRoot: fixture.repositoryRoot,
  })).result, 'pass');
  await assert.rejects(buildVisualAssetsManifest(buildOptions(fixture)), /does not permit/);

  rewriteState(fixture, (state) => {
    state.active_visual_manifest.checksum_sha256 = '0'.repeat(64);
  });
  await assert.rejects(
    validateVisualAssetsManifest({
      episodeWorkspace: fixture.episodeWorkspace,
      repositoryRoot: fixture.repositoryRoot,
    }),
    /active_visual_manifest/,
  );
});

test('failed lock leaves state and manifest untouched and removes only its own lock', async (t) => {
  const fixture = await setup(t);
  const stateBefore = fs.readFileSync(path.join(fixture.repositoryRoot, fixture.paths.state));
  write(fixture.repositoryRoot, fixture.production.action, await makeRaster(1920, 1080, '#000000'));

  await assert.rejects(lockVisualAssets(buildOptions(fixture)), /evidence output|deterministic normalization/);
  assert.deepEqual(fs.readFileSync(path.join(fixture.repositoryRoot, fixture.paths.state)), stateBefore);
  assert.equal(fs.existsSync(path.join(fixture.repositoryRoot, fixture.paths.manifest)), false);
  assert.equal(fs.existsSync(path.join(
    fixture.repositoryRoot,
    fixture.episodeWorkspace,
    'schema',
    '.visual-assets-finalizer.lock',
  )), false);
});
