import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  buildKnowledgeVideoAssemblyPlan as buildPlanWithVerification,
  isActiveVisualDirectionArtifactBasename,
} from './build-assembly-plan.mjs';
import {
  CATALOG as VISUAL_ROUTE_CATALOG,
  CATALOG_CHECKSUM_SHA256,
  LEGACY_CATALOG_CHECKSUM_SHA256,
  buildPresentedMapSha256,
  validateVisualDirectionArtifactPolicy,
  validateVisualDirectionReview,
} from '../visual-generation-routes/contract.mjs';
import {VISUAL_LANGUAGE_CATALOG_CHECKSUM_SHA256} from '../visual-language/contract.mjs';
import {
  buildActionStateSchedule,
  buildActionStateScheduleV3,
  buildActionStateScheduleV4,
} from '../action-state-schedule/contract.mjs';
import {buildDefaultIntraShotTransitions} from '../intra-shot-transitions/contract.mjs';
import {
  buildVisualDensitySelectionSha256,
  buildWorkflowApprovalModeSha256,
} from '../workflow-approval/contract.mjs';
import {sha256Canonical, sha256Text} from '../ian-layered-scene/contract.mjs';

const buildVisualDirectionReview = () => {
  const review = {
    contract_version: 'per-shot-visual-direction-review-v1',
    catalog_version: 'visual-generation-route-catalog-v1',
    catalog_checksum_sha256: LEGACY_CATALOG_CHECKSUM_SHA256,
    path: 'leverage-video/src/example/schema/per-shot-visual-direction-review-v1.json',
    checksum_sha256: 'e'.repeat(64),
    storyboard: {
      path: 'leverage-video/src/example/script/storyboard.md',
      checksum_sha256: 'f'.repeat(64),
    },
    status: 'approved',
    generated_shot_count: 2,
    presentation: {
      presented_at: '2026-08-15T09:55:00+08:00',
      exact_message: '请确认以下完整逐镜视觉方向表。',
    },
    rows: [
      {
        shot_id: 'S01',
        scene_class: 'narrative_illustration',
        structured_visual_kind: null,
        factual_identity: {
          contains_real_or_historical_subject: false,
          white_cat_replaces_factual_identity: false,
        },
        white_cat_recommendation: {recommended: false, rationale: '叙事隐喻无需白猫。'},
        compatible_routes: ['imagegen', 'srt-whiteboard-animation'],
        incompatible_routes: ['ian-handdrawn-ppt', 'doodle-slides'],
        incompatible_route_reasons: {
          'ian-handdrawn-ppt': '叙事插画不兼容结构图路线。',
          'doodle-slides': '叙事插画不兼容结构图路线。',
        },
        recommended_route: 'imagegen',
        recommendation_reason: '叙事插画。',
        user_selection: {
          status: 'approved',
          white_cat_present: false,
          visual_generation_route: 'imagegen',
          exact_message: '确认 S01 使用 imagegen',
          decided_at: '2026-08-15T10:00:00+08:00',
          presented_map_sha256: null,
        },
      },
      {
        shot_id: 'S02',
        scene_class: 'structured_graphic',
        structured_visual_kind: 'cause_effect',
        factual_identity: {
          contains_real_or_historical_subject: false,
          white_cat_replaces_factual_identity: false,
        },
        white_cat_recommendation: {recommended: false, rationale: '结构图不使用装饰角色。'},
        compatible_routes: ['ian-handdrawn-ppt', 'doodle-slides', 'srt-whiteboard-animation'],
        incompatible_routes: ['imagegen'],
        incompatible_route_reasons: {imagegen: '无白猫结构图不兼容叙事插画路线。'},
        recommended_route: 'ian-handdrawn-ppt',
        recommendation_reason: '默认 Ian 结构图。',
        user_selection: {
          status: 'approved',
          white_cat_present: false,
          visual_generation_route: 'ian-handdrawn-ppt',
          exact_message: '确认 S02 使用 Ian',
          decided_at: '2026-08-15T10:00:00+08:00',
          presented_map_sha256: null,
        },
      },
    ],
  };
  review.presented_map_sha256 = buildPresentedMapSha256(review);
  for (const row of review.rows) row.user_selection.presented_map_sha256 = review.presented_map_sha256;
  return review;
};

const baseInput = {
  episodeId: 'example-episode',
  episodeWorkspace: 'leverage-video/src/example',
  fps: 30,
  narrationFrames: 300,
  narrationAsset: 'example/assets/audio/narration.mp3',
  sharedReuseDecision: {
    path: 'leverage-video/src/example/schema/shared-reuse-decision-v1.json',
    checksum_sha256: 'a'.repeat(64),
  },
  transitionSelectionReview: {
    status: 'approved',
    catalog_version: 'scene-transition-catalog-v2',
    path: 'leverage-video/src/example/schema/transition-selection-review-v1.json',
    checksum_sha256: 'd'.repeat(64),
    presented_map_sha256: 'b'.repeat(64),
    ordinary_boundary_count: 1,
  },
  visualDirectionReview: buildVisualDirectionReview(),
  visualDirectionArtifactPolicy: {
    artifact_mode: 'legacy_read_only',
    episode_completed: true,
    modified_shot_ids: [],
  },
  opening: {
    coverAsset: 'example/assets/image/cover-1920x1080.png',
    coverSource: '/Users/jackson/Desktop/video-edit/video-resource/cover.png',
    sourceIsRegularFile: true,
    sourceIsSymlink: false,
    sourceFormat: 'png',
    sourceDecodeResult: 'pass',
    sourceAspectRatioRelativeError: 0.000532,
    normalizedWidth: 1920,
    normalizedHeight: 1080,
    firstSentenceEndFrame: 60,
  },
  shots: [
    {
      shot_id: 'S01',
      scene_class: 'narrative_illustration',
      structured_visual_kind: null,
      white_cat_present: false,
      visual_generation_route: 'imagegen',
      start_frame: 60,
      end_frame: 180,
      transition: {
        contract_version: 'scene-transition-v2',
        catalog_version: 'scene-transition-catalog-v2',
        source_shot_id: 'S01',
        next_shot_id: 'S02',
        kind: 'slide',
        options: {direction: 'from-left'},
        duration_seconds: 0.4,
        duration_in_frames: 12,
        source_intent: 'S01→S02 使用从左进入的 slide，0.4 秒',
        renderer: 'leverage-video/src/shared/scene-transitions',
        user_selection: {
          status: 'approved',
          exact_message: '确认推荐表里的全部转场',
          decided_at: '2026-08-14T10:00:00+08:00',
          presented_map_sha256: 'b'.repeat(64),
        },
      },
      assets: [
        {asset_id: 'S01-a', asset: 'example/assets/image/s01-a.png', from: 0, duration_in_frames: 60, visual_generation_route: 'imagegen'},
        {asset_id: 'S01-b', asset: 'example/assets/image/s01-b.png', from: 60, duration_in_frames: 60, visual_generation_route: 'imagegen'},
      ],
    },
    {
      shot_id: 'S02',
      scene_class: 'structured_graphic',
      structured_visual_kind: 'cause_effect',
      white_cat_present: false,
      visual_generation_route: 'ian-handdrawn-ppt',
      start_frame: 180,
      end_frame: 300,
      transition: null,
      assets: [
        {
          asset_id: 'S02-ian',
          asset: 'example/assets/image/s02-ian.png',
          from: 0,
          duration_in_frames: 120,
          visual_generation_route: 'ian-handdrawn-ppt',
        },
      ],
    },
  ],
};

test('accepts immutable approved v3 review artifacts but rejects arbitrary archive names', () => {
  assert.equal(isActiveVisualDirectionArtifactBasename('per-shot-visual-direction-review-v3-approved-v2.json'), true);
  assert.equal(isActiveVisualDirectionArtifactBasename('per-shot-visual-direction-review-v3-approved-v0.json'), false);
  assert.equal(isActiveVisualDirectionArtifactBasename('per-shot-visual-direction-review-v3-draft-v2.json'), false);
});

const buildComicInput = () => {
  const input = structuredClone(baseInput);
  const comicPlan = {
    contract_version: 'comic-shot-plan-v1',
    panel_count: 2,
    panel_beats: [
      {panel_index: 1, purpose: '建立问题', visual_action: '主体发现异常'},
      {panel_index: 2, purpose: '展示反应', visual_action: '主体采取行动'},
    ],
    layout: 'standard',
    character_continuity_group_id: null,
    character_continuity_group_size: 0,
    treatment_profile_id: 'comic-manga-warm',
    visible_text_mode: 'none',
    requires_panel_order_contract: true,
    character_reference_review: null,
  };
  const rows = input.visualDirectionReview.rows;
  rows[0] = {
    ...rows[0],
    visual_language_recommendation: {
      visual_structure_id: 'sequential-panels',
      treatment_profile_id: 'comic-manga-warm',
    },
    comic_eligibility: {
      eligible: true,
      recommend_comic_route: true,
      reasons: ['存在两个有序叙事节拍。'],
    },
    comic_plan_candidate: comicPlan,
    compatible_routes: ['imagegen', 'comic-imagegen', 'srt-whiteboard-animation'],
    incompatible_routes: ['ian-handdrawn-ppt', 'doodle-slides'],
    incompatible_route_reasons: {
      'ian-handdrawn-ppt': '叙事漫画不兼容结构图路线。',
      'doodle-slides': '叙事漫画不兼容结构图路线。',
    },
    recommended_route: 'comic-imagegen',
    recommendation_reason: '漫画节拍明显且资格成立。',
    user_selection: {
      ...rows[0].user_selection,
      visual_structure_id: 'sequential-panels',
      treatment_profile_id: 'comic-manga-warm',
      visual_generation_route: 'comic-imagegen',
      comic_plan: comicPlan,
      exact_message: '确认 S01 使用两格漫画路线',
    },
  };
  rows[1] = {
    ...rows[1],
    visual_language_recommendation: {
      visual_structure_id: 'fishbone',
      treatment_profile_id: 'ian-handdrawn-technical',
    },
    comic_eligibility: {
      eligible: false,
      recommend_comic_route: false,
      reasons: ['结构图不得进入漫画路线。'],
    },
    comic_plan_candidate: null,
    incompatible_routes: ['imagegen', 'comic-imagegen'],
    incompatible_route_reasons: {
      imagegen: '结构图不兼容叙事插画路线。',
      'comic-imagegen': '结构图不得进入漫画路线。',
    },
    user_selection: {
      ...rows[1].user_selection,
      visual_structure_id: 'fishbone',
      treatment_profile_id: 'ian-handdrawn-technical',
      comic_plan: null,
    },
  };
  input.visualDirectionReview = {
    ...input.visualDirectionReview,
    contract_version: 'per-shot-visual-direction-review-v2',
    catalog_version: 'visual-generation-route-catalog-v2',
    catalog_checksum_sha256: CATALOG_CHECKSUM_SHA256,
    visual_language_catalog_version: 'visual-language-catalog-v1',
    visual_language_catalog_checksum_sha256: VISUAL_LANGUAGE_CATALOG_CHECKSUM_SHA256,
    path: 'leverage-video/src/example/schema/per-shot-visual-direction-review-v2.json',
    rows,
  };
  input.visualDirectionReview.presented_map_sha256 = buildPresentedMapSha256(input.visualDirectionReview);
  for (const row of rows) row.user_selection.presented_map_sha256 = input.visualDirectionReview.presented_map_sha256;
  input.shots[0] = {
    ...input.shots[0],
    visual_structure_id: 'sequential-panels',
    treatment_profile_id: 'comic-manga-warm',
    visual_generation_route: 'comic-imagegen',
    comic_plan: comicPlan,
    assets: input.shots[0].assets.map((asset) => ({
      ...asset,
      checksum_sha256: asset.asset_id.endsWith('a') ? '1'.repeat(64) : '2'.repeat(64),
      visual_generation_route: 'comic-imagegen',
      generator: 'codex-native-imagegen',
      review_status: 'approved',
      width: 1920,
      height: 1080,
      prompt_asset: `example/assets/narration/${asset.asset_id}-prompt.md`,
      prompt_checksum_sha256: '3'.repeat(64),
      reference_checksums_sha256: [],
    })),
  };
  input.shots[1] = {
    ...input.shots[1],
    visual_structure_id: 'fishbone',
    treatment_profile_id: 'ian-handdrawn-technical',
    comic_plan: null,
  };
  return input;
};

const passingVerifier = () => ({
  path: 'leverage-video/src/example/schema/shared-reuse-decision-v1.json',
  checksum_sha256: 'a'.repeat(64),
  validation_phase: 'consumption',
  checked_modules: 10,
  result: 'pass',
});

const passingVisualDirectionVerifier = (input) => input.visualDirectionReview && ({
  review: input.visualDirectionReview,
  path: input.visualDirectionReview.path,
  checksum_sha256: input.visualDirectionReview.checksum_sha256,
});

const passingStoryboardVisualRhythmVerifier = (input) => ({
  artifact: {
    presented_map_sha256: '8'.repeat(64),
    storyboard: structuredClone(input.visualDirectionReview.storyboard),
    visual_direction_review: {
      path: input.visualDirectionReview.path,
      checksum_sha256: input.visualDirectionReview.checksum_sha256,
    },
    shots: input.shots.map((shot) => ({
      shot_id: shot.shot_id,
      motion_tier: shot.motion_tier,
      asset_plan: {
        main_image_count: shot.motion_tier === 'hero_pose' ? 1 : Math.max(1, shot.assets?.length ?? 0),
        layer_count: shot.visual_generation_route === 'ian-handdrawn-ppt'
          ? 1
          : shot.motion_tier === 'layered' ? 3 : 0,
        pose_count: shot.motion_tier === 'hero_pose' ? shot.assets.length : 0,
      },
      meaningful_change_events: [{
        at_frame: shot.start_frame,
        kind: 'composition-change',
        description: shot.visual_generation_route === 'ian-handdrawn-ppt'
          ? 'knowledge-structure'
          : 'initial-state',
      }],
      intra_shot_transition_plan: (shot.intra_shot_transitions ?? []).map((transition) => ({
        from_asset_id: transition.from_asset_id,
        to_asset_id: transition.to_asset_id,
        kind: transition.kind,
        user_selection: transition.user_selection,
      })),
    })),
  },
  path: `${input.episodeWorkspace}/schema/storyboard-visual-rhythm-v1.json`,
  checksum_sha256: '9'.repeat(64),
  validation: {
    result: 'pass',
    contract_version: 'storyboard-visual-rhythm-v1',
    shot_count: input.shots.length,
    rhythm_qa: {status: 'pass-with-warnings', warnings: []},
  },
});

const buildIanLayeredPackage = (input, shot) => {
  const sourceText = shot.narration_source_text;
  const byteLength = Buffer.byteLength(sourceText);
  const scenePlan = {
    contract_version: 'ian-layered-scene-plan-v1',
    shot_id: shot.shot_id,
    narration_source_text_sha256: sha256Text(sourceText),
    scene_renderer: 'ian-static-layered-scene-v1',
    background_policy: 'static-paper-background-v1',
    layer_asset_policy: 'full-canvas-transparent-png-v1',
    layer_entry_transition: {
      contract_version: 'ian-layer-entry-fade-v1', duration_frames: 8, easing: 'linear',
    },
    motion_policy: {
      scene_transform: 'forbidden', layer_transform: 'forbidden',
      mask_reveal: 'forbidden', internal_cut: 'forbidden',
      opacity_animation: 'ian-layer-entry-fade-v1',
    },
    layer_count: 1,
    layers: [{
      layer_id: 'L01', z_index: 1, semantic_role: 'knowledge-structure',
      source_text_start_byte: 0, source_text_end_byte_exclusive: byteLength,
      source_text: sourceText, entry_frame: 0,
    }],
  };
  const raster = (path, checksum, role, hasAlpha) => ({
    path, checksum_sha256: checksum, width: 1920, height: 1080, role, has_alpha: hasAlpha,
  });
  return {
    contract_version: 'ian-knowledge-video-layered-scene-v1',
    episode_workspace: input.episodeWorkspace,
    queue_item_id: shot.assets[0].asset_id,
    shot_id: shot.shot_id,
    visual_generation_route: 'ian-handdrawn-ppt',
    treatment_profile_id: shot.treatment_profile_id,
    storyboard_binding: structuredClone(input.visualDirectionReview.storyboard),
    visual_direction_review: {
      path: input.visualDirectionReview.path,
      checksum_sha256: input.visualDirectionReview.checksum_sha256,
      presented_map_sha256: input.visualDirectionReview.presented_map_sha256,
    },
    canvas: {width: 1920, height: 1080, fps: 30},
    timing: {
      shot_start_frame: shot.start_frame,
      shot_end_frame: shot.end_frame,
      duration_frames: shot.end_frame - shot.start_frame,
    },
    narration_source_text: sourceText,
    narration_source_text_sha256: sha256Text(sourceText),
    scene_plan: scenePlan,
    scene_plan_sha256: sha256Canonical(scenePlan),
    generation_constraints: {
      background_raster_count: 1, final_composite_raster_count: 1,
      layer_rasters_are_full_canvas_rgba: true,
      scene_translation: false, scene_scaling: false,
      layer_translation: false, layer_scaling: false, layer_rotation: false,
      mask_reveal: false, internal_cut: false,
      automatic_page_number: false, automatic_title: false,
      automatic_subtitle: false, automatic_labels: false, signature: false,
    },
    background: raster(
      `${input.episodeWorkspace}/assets/image/${shot.shot_id}-background.png`,
      '4'.repeat(64), 'static-paper-background', false,
    ),
    layers: [{
      ...scenePlan.layers[0],
      ...raster(
        `${input.episodeWorkspace}/assets/image/${shot.shot_id}-L01.png`,
        '5'.repeat(64), 'transparent-semantic-element', true,
      ),
    }],
    final_composite: raster(
      `${input.episodeWorkspace}/assets/image/${shot.shot_id}-final.png`,
      shot.assets[0].checksum_sha256, 'final-composite-review-raster', false,
    ),
    verified_visible_text: [],
  };
};

const passingIanLayeredSceneVerifier = (input) => ({
  contract_version: 'ian-layered-scene-consumption-evidence-v1',
  result: 'pass',
  records: input.shots
    .filter((shot) => shot.visual_generation_route === 'ian-handdrawn-ppt')
    .map((shot) => {
      const packageValue = buildIanLayeredPackage(input, shot);
      return {
        shot_id: shot.shot_id,
        storyboard_scene_plan_sha256: packageValue.scene_plan_sha256,
        package_manifest: structuredClone(shot.ian_layered_scene.package_manifest),
        package: packageValue,
        render_assets: structuredClone(shot.ian_layered_scene.render_assets),
      };
    }),
});

const passingV2StoryboardVisualRhythmVerifier = (input) => {
  const result = passingStoryboardVisualRhythmVerifier(input);
  result.artifact.contract_version = 'storyboard-visual-rhythm-v2';
  result.artifact.density_mode = input.workflowApproval.density.density_mode;
  result.artifact.visual_density_selection_sha256 = input.workflowApproval.density.selection_sha256;
  result.path = `${input.episodeWorkspace}/schema/storyboard-visual-rhythm-v2.json`;
  result.validation.contract_version = 'storyboard-visual-rhythm-v2';
  return result;
};

const buildKnowledgeVideoAssemblyPlan = (input, options = {}) => buildPlanWithVerification(input, {
  verifyVisualDirectionReviewEvidence: passingVisualDirectionVerifier,
  verifyStoryboardVisualRhythmEvidence: passingStoryboardVisualRhythmVerifier,
  verifyIanLayeredScenePackageEvidence: passingIanLayeredSceneVerifier,
  ...options,
});

const buildV3Input = ({characterSchedule = false} = {}) => {
  const input = buildComicInput();
  const firstRow = input.visualDirectionReview.rows[0];
  firstRow.comic_eligibility = {
    eligible: false,
    recommend_comic_route: false,
    reasons: ['comic-imagegen 已退出新工作流。'],
  };
  firstRow.comic_plan_candidate = null;
  firstRow.compatible_routes = [
    'imagegen', 'xuan-paper-diorama', 'srt-whiteboard-animation', 'local-video-file',
  ];
  firstRow.incompatible_routes = ['ian-handdrawn-ppt', 'ink-doodle-knowledge-card'];
  firstRow.incompatible_route_reasons = {
    'ian-handdrawn-ppt': '叙事插画不兼容结构图路线。',
    'ink-doodle-knowledge-card': '叙事插画不兼容结构图路线。',
  };
  firstRow.recommended_route = 'imagegen';
  firstRow.recommendation_reason = '新工作流的叙事插画使用 imagegen。';
  Object.assign(firstRow.user_selection, {
    visual_generation_route: 'imagegen',
    comic_plan: null,
    exact_message: '确认 S01 使用 imagegen',
  });
  const secondRow = input.visualDirectionReview.rows[1];
  secondRow.compatible_routes = [
    'ian-handdrawn-ppt',
    'ink-doodle-knowledge-card',
    'srt-whiteboard-animation',
    'local-video-file',
  ];
  secondRow.incompatible_routes = ['imagegen', 'xuan-paper-diorama'];
  secondRow.incompatible_route_reasons = {
    imagegen: '结构图不兼容叙事插画路线。',
    'xuan-paper-diorama': '宣纸微缩叠景仅兼容叙事插画。',
  };
  Object.assign(input.shots[0], {
    visual_generation_route: 'imagegen',
    comic_plan: null,
    assets: input.shots[0].assets.map((asset) => ({
      ...asset,
      visual_generation_route: 'imagegen',
    })),
  });
  input.visualDirectionReview.contract_version = 'per-shot-visual-direction-review-v3';
  input.visualDirectionArtifactPolicy = {
    artifact_mode: 'current_v3',
    episode_completed: false,
    modified_shot_ids: input.shots.map((shot) => shot.shot_id),
  };
  input.visualDirectionReview.path = 'leverage-video/src/example/schema/per-shot-visual-direction-review-v3.json';
  input.visualDirectionReview.rows.forEach((row, index) => {
    row.visible_text_mode = 'none';
    row.exact_visible_text = null;
    row.visible_text_placement = null;
    row.local_video_source_path = null;
    Object.assign(row.user_selection, {
      visible_text_mode: 'none',
      exact_visible_text: null,
      visible_text_placement: null,
      local_video_source_path: null,
    });
    Object.assign(input.shots[index], {
      motion_tier: 'layered',
      visible_text_mode: 'none',
      exact_visible_text: null,
      visible_text_placement: null,
      local_video_source_path: null,
    });
  });
  input.shots.forEach((shot) => {
    shot.intra_shot_transitions = buildDefaultIntraShotTransitions({
      imageSequence: shot.assets,
      fps: 30,
    });
  });
  input.shots[0].motion_tier = 'stateful';
  input.shots[0].action_state_schedule = buildActionStateScheduleV3({
    totalFrames: 120,
    fps: 30,
    sourceText: '甲乙',
    motionTier: 'stateful',
    states: input.shots[0].assets.map((asset, index) => ({
      state_id: asset.asset_id,
      semantic_state: ['建立', '结果'][index],
      narration_byte_start: index * 3,
      narration_byte_end: (index + 1) * 3,
      narration_text: ['甲', '乙'][index],
      at_frame: asset.from,
      semantic_hold_reason: null,
    })),
    intraShotTransitions: input.shots[0].intra_shot_transitions,
  });
  input.visualDirectionReview.presented_map_sha256 = buildPresentedMapSha256(input.visualDirectionReview);
  input.visualDirectionReview.rows.forEach((row) => {
    row.user_selection.presented_map_sha256 = input.visualDirectionReview.presented_map_sha256;
  });
  const ianShot = input.shots[1];
  ianShot.narration_source_text = '一次结果，不等于无法改变。';
  ianShot.assets[0].checksum_sha256 = '6'.repeat(64);
  ianShot.ian_layered_scene = {
    package_manifest: {
      path: `${input.episodeWorkspace}/schema/visual-assets/S02-ian-layered-scene-v1.json`,
      checksum_sha256: '7'.repeat(64),
    },
    render_assets: {
      background: {
        asset: 'example/assets/image/S02-background.png',
        checksum_sha256: '4'.repeat(64),
      },
      layers: [{
        layer_id: 'L01',
        asset: 'example/assets/image/S02-L01.png',
        checksum_sha256: '5'.repeat(64),
      }],
      final_composite: {
        asset: ianShot.assets[0].asset,
        checksum_sha256: ianShot.assets[0].checksum_sha256,
      },
    },
  };
  input.transitionSelectionReview.catalog_version = 'scene-transition-catalog-v3';
  input.shots[0].transition = {
    contract_version: 'scene-transition-v3',
    catalog_version: 'scene-transition-catalog-v3',
    source_shot_id: 'S01',
    next_shot_id: 'S02',
    boundary_change_class: 'continuity',
    source_visual_generation_route: 'imagegen',
    next_visual_generation_route: 'ian-handdrawn-ppt',
    source_white_cat_present: false,
    next_white_cat_present: false,
    recommended_transition: {kind: 'cut', options: {}},
    recommendation_source: {
      authority: 'shared-fallback',
      rule_id: 'scene-transition-semantic-fallback-v1',
    },
    kind: 'cut',
    options: {},
    duration_seconds: 0,
    duration_in_frames: 0,
    source_intent: '连续语义直接切到下一镜',
    renderer: 'leverage-video/src/shared/scene-transitions',
    user_selection: {
      status: 'approved',
      exact_message: '确认 S01 到 S02 使用 cut',
      decided_at: '2026-08-15T10:00:00+08:00',
      presented_map_sha256: input.transitionSelectionReview.presented_map_sha256,
    },
  };
  if (characterSchedule) {
    input.shots[0].character_state_required = true;
    input.shots[0].motion_tier = 'stateful';
    const template = input.shots[0].assets[0];
    input.shots[0].assets = ['S01-a', 'S01-b', 'S01-c'].map((assetId, index) => ({
      ...template,
      asset_id: assetId,
      asset: `example/assets/image/${assetId}.png`,
      checksum_sha256: String(index + 1).repeat(64),
      from: index * 40,
      duration_in_frames: 40,
    }));
    input.shots[0].intra_shot_transitions = buildDefaultIntraShotTransitions({
      imageSequence: input.shots[0].assets,
      fps: 30,
    });
    const schedule = buildActionStateScheduleV3({
      totalFrames: 120,
      fps: 30,
      sourceText: '甲乙丙',
      motionTier: 'stateful',
      states: input.shots[0].assets.map((asset, index) => ({
        state_id: asset.asset_id,
        semantic_state: ['预备', '接触', '结果'][index],
        narration_byte_start: index * 3,
        narration_byte_end: (index + 1) * 3,
        narration_text: ['甲', '乙', '丙'][index],
        at_frame: asset.from,
        semantic_hold_reason: null,
      })),
      intraShotTransitions: input.shots[0].intra_shot_transitions,
    });
    input.shots[0].action_state_schedule = schedule;
  }
  return input;
};

const buildXuanInput = () => {
  const input = buildV3Input();
  const xuan = VISUAL_ROUTE_CATALOG.routes.find((route) => route.route_id === 'xuan-paper-diorama');
  const row = input.visualDirectionReview.rows[0];
  Object.assign(row.user_selection, {
    treatment_profile_id: 'xuan-paper-diorama',
    visual_generation_route: 'xuan-paper-diorama',
    exact_message: '确认 S01 使用宣纸微缩叠景',
  });
  Object.assign(input.shots[0], {
    treatment_profile_id: 'xuan-paper-diorama',
    visual_generation_route: 'xuan-paper-diorama',
    assets: input.shots[0].assets.map((asset, index) => ({
      ...asset,
      visual_generation_route: 'xuan-paper-diorama',
      checksum_sha256: String(index + 1).repeat(64),
      generator: 'codex-native-imagegen',
      review_status: 'approved',
      width: 1920,
      height: 1080,
      prompt_asset: `example/assets/narration/S01-${index + 1}-xuan-prompt.md`,
      prompt_checksum_sha256: '8'.repeat(64),
      reference_checksums_sha256: [],
      style_profile_id: xuan.style_profile_id,
      style_profile_checksum_sha256: xuan.style_profile_checksum_sha256,
      style_skill_checksum_sha256: xuan.style_skill_checksum_sha256,
    })),
  });
  input.shots[0].transition.source_visual_generation_route = 'xuan-paper-diorama';
  input.visualDirectionReview.presented_map_sha256 = buildPresentedMapSha256(input.visualDirectionReview);
  input.visualDirectionReview.rows.forEach((item) => {
    item.user_selection.presented_map_sha256 = input.visualDirectionReview.presented_map_sha256;
  });
  return input;
};

const buildInkInput = () => {
  const input = buildV3Input();
  const ink = VISUAL_ROUTE_CATALOG.routes.find(
    (route) => route.route_id === 'ink-doodle-knowledge-card',
  );
  const row = input.visualDirectionReview.rows[1];
  Object.assign(row.user_selection, {
    treatment_profile_id: 'ink-doodle-knowledge-card',
    visual_generation_route: 'ink-doodle-knowledge-card',
    exact_message: '确认 S02 使用墨线知识卡',
  });
  Object.assign(input.shots[1], {
    treatment_profile_id: 'ink-doodle-knowledge-card',
    visual_generation_route: 'ink-doodle-knowledge-card',
    assets: input.shots[1].assets.map((asset, index) => ({
      ...asset,
      visual_generation_route: 'ink-doodle-knowledge-card',
      checksum_sha256: String(index + 1).repeat(64),
      generator: 'codex-native-imagegen',
      review_status: 'approved',
      width: 1920,
      height: 1080,
      prompt_asset: `example/assets/narration/S02-${index + 1}-ink-prompt.md`,
      prompt_checksum_sha256: '8'.repeat(64),
      reference_checksums_sha256: [],
      style_profile_id: ink.style_profile_id,
      style_profile_checksum_sha256: ink.style_profile_checksum_sha256,
      style_skill_checksum_sha256: ink.style_skill_checksum_sha256,
    })),
  });
  input.shots[0].transition.next_visual_generation_route = 'ink-doodle-knowledge-card';
  input.visualDirectionReview.presented_map_sha256 = buildPresentedMapSha256(input.visualDirectionReview);
  input.visualDirectionReview.rows.forEach((item) => {
    item.user_selection.presented_map_sha256 = input.visualDirectionReview.presented_map_sha256;
  });
  return input;
};

const whiteboardInput = ({sourceDurationFrames = 120, outputDurationFrames = 120, retimingMode = 'identity-v1'} = {}) => {
  const elementOrder = ['outline', 'result'];
  const clipChecksum = '5'.repeat(64);
  const timingSegments = retimingMode === 'identity-v1'
    ? [{
        source_start_frame: 0,
        source_end_frame: sourceDurationFrames,
        output_start_frame: 0,
        output_end_frame: outputDurationFrames,
        element_ids: elementOrder,
        subtitle_span: {start: 0, end: 4, text: '完整锁稿'},
      }]
    : [
        {
          source_start_frame: 0,
          source_end_frame: 40,
          output_start_frame: 0,
          output_end_frame: 50,
          element_ids: ['outline'],
          subtitle_span: {start: 0, end: 2, text: '完整'},
        },
        {
          source_start_frame: 40,
          source_end_frame: sourceDurationFrames,
          output_start_frame: 50,
          output_end_frame: outputDurationFrames,
          element_ids: ['result'],
          subtitle_span: {start: 2, end: 4, text: '锁稿'},
        },
      ];
  return {
    contract_version: 'whiteboard-scene-input-v1',
    source_image: {asset: 'example/assets/image/s02-whiteboard-source.png', checksum_sha256: '1'.repeat(64)},
    normalized_image: {asset: 'example/assets/image/s02-whiteboard-1920x1080.png', checksum_sha256: '2'.repeat(64)},
    annotation: {asset: 'example/schema/s02-whiteboard-annotation-v2.json', checksum_sha256: '3'.repeat(64)},
    preview: {asset: 'example/assets/image/s02-whiteboard-preview.png', checksum_sha256: '4'.repeat(64)},
    clip: {asset: 'example/assets/video/s02-whiteboard.mp4', checksum_sha256: clipChecksum},
    render_evidence: {
      asset: 'example/schema/s02-whiteboard-render-evidence-v1.json',
      checksum_sha256: '6'.repeat(64),
      contract_version: 'whiteboard-render-evidence-v1',
      media: {
        width: 1920,
        height: 1080,
        fps: 30,
        codec: 'h264',
        audio_streams: 0,
        frame_count: sourceDurationFrames,
        final_frame_verified: true,
        full_frame_hold_verified_frames: 15,
      },
    },
    source_duration_frames: sourceDurationFrames,
    source_dimensions: [1672, 941],
    source_aspect_ratio_relative_error: 0.000532,
    normalized_width: 1920,
    normalized_height: 1080,
    element_order: elementOrder,
    element_order_checksum_sha256: crypto.createHash('sha256').update(JSON.stringify(elementOrder)).digest('hex'),
    retiming_mode: retimingMode,
    immutable_parent_clip_checksum_sha256: retimingMode === 'piecewise-element-span-v1' ? clipChecksum : null,
    timing_segments: timingSegments,
    review: {
      contract_version: 'whiteboard-visual-asset-review-v1',
      source_image_review: {
        status: 'approved',
        approved_source_image_checksum_sha256: '1'.repeat(64),
      },
      annotation_review: {
        status: 'approved',
        approved_annotation_checksum_sha256: '3'.repeat(64),
        approved_preview_checksum_sha256: '4'.repeat(64),
      },
      clip_review: {
        status: 'approved',
        approved_clip_checksum_sha256: clipChecksum,
        approved_render_evidence_checksum_sha256: '6'.repeat(64),
      },
    },
  };
};

const routeSecondShotToWhiteboard = (input, whiteboard = whiteboardInput()) => {
  const shot = input.shots[1];
  shot.visual_generation_route = 'srt-whiteboard-animation';
  shot.assets = [{
    asset_id: 'S02-whiteboard-tableau',
    asset: whiteboard.normalized_image.asset,
    checksum_sha256: whiteboard.normalized_image.checksum_sha256,
    from: 0,
    duration_in_frames: shot.end_frame - shot.start_frame,
    visual_generation_route: 'srt-whiteboard-animation',
  }];
  shot.whiteboard = whiteboard;
  input.visualDirectionReview.rows[1].user_selection.visual_generation_route = 'srt-whiteboard-animation';
  input.visualDirectionReview.rows[1].user_selection.exact_message = '确认 S02 使用白板路线';
};

const routeSecondShotToLocalVideo = (input) => {
  const shot = input.shots[1];
  const selectedPath = '/Users/jackson/Videos/s02.mp4';
  shot.visual_generation_route = 'local-video-file';
  shot.treatment_profile_id = 'source-video-native';
  shot.assets = [];
  shot.local_video_source_path = selectedPath;
  shot.local_video = {
    contract_version: 'local-video-match-v1',
    visual_generation_route: 'local-video-file',
    shot_id: 'S02',
    selected_source_path: selectedPath,
    asset: 'leverage-video/src/example/assets/video/user-source/s02-local-source-v01.mp4',
    checksum_sha256: '9'.repeat(64),
    media: {
      video_streams: 1,
      audio_streams: 1,
      width: 1920,
      height: 1080,
      codec: 'h264',
      rotation_degrees: 0,
      source_duration_seconds: 8,
      source_fps: 30,
      probe_result: 'pass',
      full_decode_result: 'pass',
    },
    target_duration_frames: 120,
    target_duration_seconds: 4,
    playback_rate: 2,
    match_status: 'matched',
    frame_mapping_policy: 'complete-source-to-exact-shot-frames-v1',
    fit_policy: 'native-1920x1080-no-resize-crop-or-pad-v1',
    audio_policy: 'mute-source-audio-v1',
    approval: {
      status: 'approved',
      approved_checksum_sha256: '9'.repeat(64),
      exact_message: '批准 S02 本地视频匹配预览',
      decided_at: '2026-08-18T10:00:00+08:00',
    },
  };
  const row = input.visualDirectionReview.rows[1];
  row.treatment_profile_id = 'source-video-native';
  row.local_video_source_path = selectedPath;
  Object.assign(row.user_selection, {
    visual_generation_route: 'local-video-file',
    treatment_profile_id: 'source-video-native',
    local_video_source_path: selectedPath,
    exact_message: '确认 S02 使用本地视频',
  });
  input.shots[0].transition.next_visual_generation_route = 'local-video-file';
  input.visualDirectionReview.presented_map_sha256 = buildPresentedMapSha256(
    input.visualDirectionReview,
  );
  input.visualDirectionReview.rows.forEach((candidate) => {
    candidate.user_selection.presented_map_sha256 = input.visualDirectionReview.presented_map_sha256;
  });
  return input;
};

test('routes explicit imagegen visuals to narrative and exact Ian markers to graphic', () => {
  const plan = buildKnowledgeVideoAssemblyPlan(baseInput, {verifySharedReuseEvidence: passingVerifier});
  assert.equal(plan.schema_version, 'knowledge-video-assembly-plan-v1');
  assert.equal(plan.scenes[0].scene_type, 'narrative');
  assert.equal(plan.scenes[0].visual_generation_route, 'imagegen');
  assert.equal(plan.scenes[1].scene_type, 'graphic');
  assert.equal(plan.scenes[0].image_sequence.length, 2);
  assert.equal(plan.scenes[0].intra_shot_transitions.length, 1);
  assert.equal(plan.scenes[0].intra_shot_transitions[0].kind, 'watercolor-bloom');
  assert.equal(plan.scenes[0].intra_shot_transitions[0].from_image_index, 0);
  assert.equal(plan.scenes[0].intra_shot_transitions[0].to_image_index, 1);
  assert.equal(plan.scenes[0].transition.kind, 'slide');
  assert.deepEqual(plan.scenes[0].transition.options, {direction: 'from-left'});
  assert.equal(plan.scenes[0].transition.user_selection.status, 'approved');
  assert.equal(plan.scenes[0].transition.next_shot_id, 'S02');
  assert.equal(plan.scenes[1].transition, null);
  assert.equal(plan.opening.shot_id, 'OPEN-00');
  assert.equal(plan.opening.cover_source, '/Users/jackson/Desktop/video-edit/video-resource/cover.png');
  assert.equal(plan.opening.episode_opening_frames, 60);
  assert.equal(plan.opening.final_master_frames, 300);
  assert.equal(plan.qa_contract.ordinary_boundaries_with_animated_transitions, 1);
  assert.equal(plan.qa_contract.scene_transition_contract, 'scene-transition-v2');
  assert.deepEqual(plan.qa_contract.transition_selection_review, {
    status: 'approved',
    catalog_version: 'scene-transition-catalog-v2',
    path: 'leverage-video/src/example/schema/transition-selection-review-v1.json',
    checksum_sha256: 'd'.repeat(64),
    presented_map_sha256: 'b'.repeat(64),
    ordinary_boundary_count: 1,
  });
  assert.equal(plan.qa_contract.visual_direction_review.status, 'approved');
  assert.equal(plan.qa_contract.scene_routing_contract, 'explicit-visual-generation-route-v1');
});

test('v3 continuity cut adds no transition duration and records semantic boundary counts', () => {
  const plan = buildKnowledgeVideoAssemblyPlan(buildV3Input(), {verifySharedReuseEvidence: passingVerifier});
  assert.equal(plan.scenes[0].transition.kind, 'cut');
  assert.equal(plan.scenes[0].transition.duration_in_frames, 0);
  assert.equal(plan.qa_contract.scene_transition_contract, 'scene-transition-v3');
  assert.equal(plan.qa_contract.ordinary_boundaries_with_transition_decisions, 1);
  assert.equal(plan.qa_contract.ordinary_boundaries_with_animated_transitions, 0);
  assert.equal(plan.qa_contract.ordinary_boundaries_with_cuts, 1);
  assert.equal(plan.scenes[0].visible_text_policy, 'approved-raster-v1');
  assert.equal(plan.scenes[1].visible_text_policy, 'approved-exact-text-raster-v1');
  assert.equal(plan.scenes[0].assembly_text_policy, 'asset-owned-no-timeline-overlay-v1');
  assert.deepEqual(plan.scenes[0].timeline_text_overlays, []);
  assert.deepEqual(plan.scenes[0].intra_shot_transitions.map(({kind}) => kind), ['cut']);
  assert.equal(plan.scenes[0].intra_shot_transition_contract, 'intra-shot-transition-v1');
  assert.equal(plan.qa_contract.intra_shot_transition_contract, 'intra-shot-transition-v1');
  assert.equal(plan.scenes[0].ian_layered_scene, null);
  assert.equal(plan.scenes[1].scene_type, 'ian-layered');
  assert.equal(plan.scenes[1].ian_layered_scene.contract_version, 'ian-static-layered-scene-v1');
  assert.equal(plan.scenes[1].ian_layered_scene.layers.length, 1);
  assert.equal(plan.scenes[1].ian_layered_scene.layers[0].entry_frame, 0);
  assert.equal(plan.scenes[1].ian_layered_scene.motion_policy.scene_transform, 'forbidden');
  assert.equal(
    plan.qa_contract.ian_layered_scene_packages.contract_version,
    'ian-layered-scene-consumption-evidence-v1',
  );
  assert.deepEqual(plan.qa_contract.ian_layered_scene_packages.shot_ids, ['S02']);
});

test('v3 rejects retired Ian pan/zoom fields instead of translating the full raster', () => {
  const input = buildV3Input();
  input.shots[1].internal_motion_contract = 'ian-subtle-raster-motion-v1';
  input.shots[1].internal_motion = {
    mode: 'single_segment',
    start: {scale: 1, x_px: 0, y_px: 0},
    end: {scale: 1.04, x_px: 30, y_px: -18},
    easing: 'ease-in-out',
    origin: 'center',
  };
  assert.throws(
    () => buildKnowledgeVideoAssemblyPlan(input, {verifySharedReuseEvidence: passingVerifier}),
    /whole-raster motion is retired/i,
  );
});

test('v3 assembly fails closed on missing, stale, or incomplete Ian layered packages', () => {
  const missing = buildV3Input();
  delete missing.shots[1].ian_layered_scene;
  assert.throws(
    () => buildKnowledgeVideoAssemblyPlan(missing, {
      verifySharedReuseEvidence: passingVerifier,
      verifyIanLayeredScenePackageEvidence: () => ({
        contract_version: 'ian-layered-scene-consumption-evidence-v1',
        result: 'pass',
        records: [],
      }),
    }),
    /does not cover/i,
  );

  const stale = buildV3Input();
  assert.throws(
    () => buildKnowledgeVideoAssemblyPlan(stale, {
      verifySharedReuseEvidence: passingVerifier,
      verifyIanLayeredScenePackageEvidence: (input) => {
        const evidence = passingIanLayeredSceneVerifier(input);
        evidence.records[0].package.scene_plan_sha256 = '0'.repeat(64);
        return evidence;
      },
    }),
    /stale storyboard scene-plan binding/i,
  );

  const transformed = buildV3Input();
  assert.throws(
    () => buildKnowledgeVideoAssemblyPlan(transformed, {
      verifySharedReuseEvidence: passingVerifier,
      verifyIanLayeredScenePackageEvidence: (input) => {
        const evidence = passingIanLayeredSceneVerifier(input);
        evidence.records[0].package.scene_plan.motion_policy.scene_transform = 'allowed';
        return evidence;
      },
    }),
    /forbid scene\/layer transforms/i,
  );

  const missingLayer = buildV3Input();
  assert.throws(
    () => buildKnowledgeVideoAssemblyPlan(missingLayer, {
      verifySharedReuseEvidence: passingVerifier,
      verifyIanLayeredScenePackageEvidence: (input) => {
        const evidence = passingIanLayeredSceneVerifier(input);
        evidence.records[0].render_assets.layers = [];
        return evidence;
      },
    }),
    /public render assets differ/i,
  );

  const staleRhythm = buildV3Input();
  assert.throws(
    () => buildKnowledgeVideoAssemblyPlan(staleRhythm, {
      verifySharedReuseEvidence: passingVerifier,
      verifyStoryboardVisualRhythmEvidence: (input) => {
        const evidence = passingStoryboardVisualRhythmVerifier(input);
        evidence.artifact.shots[1].meaningful_change_events[0].at_frame += 1;
        return evidence;
      },
    }),
    /narration-rhythm event/i,
  );
});

test('real v3 assembly path requires a checksum-current storyboard visual rhythm artifact', () => {
  const input = buildV3Input();
  assert.throws(
    () => buildPlanWithVerification(input, {
      verifySharedReuseEvidence: passingVerifier,
      verifyVisualDirectionReviewEvidence: passingVisualDirectionVerifier,
    }),
    /storyboard visual rhythm artifact path and checksum are required/i,
  );
});

test('v3 assembly fails closed on missing or unapproved intra-shot transition records', () => {
  const missing = buildV3Input();
  delete missing.shots[0].intra_shot_transitions;
  assert.throws(
    () => buildKnowledgeVideoAssemblyPlan(missing, {verifySharedReuseEvidence: passingVerifier}),
    /explicit complete intra-shot transition map/i,
  );

  const unknown = buildV3Input();
  unknown.shots[0].intra_shot_transitions[0].kind = 'none';
  assert.throws(
    () => buildKnowledgeVideoAssemblyPlan(unknown, {verifySharedReuseEvidence: passingVerifier}),
    /unsupported intra-shot transition kind/i,
  );
});

test('v3 assembly accepts only map-bound explicit watercolor selection', () => {
  const input = buildV3Input();
  Object.assign(input.shots[0].intra_shot_transitions[0], {
    kind: 'watercolor-bloom',
    duration_seconds: 0.6,
    duration_in_frames: 18,
    renderer: 'leverage-video/src/shared/watercolor-bloom',
    user_selection: {
      status: 'approved',
      exact_message: '确认 S01 第一处镜内切换使用 watercolor-bloom。',
      decided_at: '2026-08-19T10:00:00+08:00',
      presented_map_sha256: '8'.repeat(64),
    },
  });
  input.shots[0].action_state_schedule.intra_shot_transitions[0] = structuredClone(
    input.shots[0].intra_shot_transitions[0],
  );
  input.shots[0].action_state_schedule.occurrences[1].transition_in_frames = 18;
  input.shots[0].action_state_schedule.occurrences[1].clean_hold_in_frames = 42;
  const plan = buildKnowledgeVideoAssemblyPlan(input, {verifySharedReuseEvidence: passingVerifier});
  assert.equal(plan.scenes[0].intra_shot_transitions[0].kind, 'watercolor-bloom');

  input.shots[0].intra_shot_transitions[0].user_selection.presented_map_sha256 = '7'.repeat(64);
  assert.throws(
    () => buildKnowledgeVideoAssemblyPlan(input, {verifySharedReuseEvidence: passingVerifier}),
    /not bound to the active visual rhythm map/i,
  );
});

test('routes a deferred approved local video through exact-frame matched playback', () => {
  const input = routeSecondShotToLocalVideo(buildV3Input());
  const plan = buildKnowledgeVideoAssemblyPlan(input, {verifySharedReuseEvidence: passingVerifier});
  const scene = plan.scenes[1];
  assert.equal(scene.scene_type, 'local-video');
  assert.equal(scene.duration_frames, 120);
  assert.equal(scene.local_video.match_status, 'matched');
  assert.equal(scene.local_video.playback_rate, 2);
  assert.deepEqual(scene.image_sequence, []);

  input.shots[1].local_video.target_duration_frames = 119;
  assert.throws(
    () => buildKnowledgeVideoAssemblyPlan(input, {verifySharedReuseEvidence: passingVerifier}),
    /timing or policy is stale/i,
  );
});

test('routes approved xuan-paper-diorama PNGs to NarrativeScene with pinned style provenance', () => {
  const input = buildXuanInput();
  const plan = buildKnowledgeVideoAssemblyPlan(input, {verifySharedReuseEvidence: passingVerifier});
  assert.equal(plan.scenes[0].scene_type, 'narrative');
  assert.equal(plan.scenes[0].visual_generation_route, 'xuan-paper-diorama');
  assert.equal(plan.scenes[0].visible_text_policy, 'text-free-v1');
  assert.equal(plan.scenes[0].image_sequence[0].style_profile_id, 'xuan-paper-diorama');

  input.shots[0].assets[0].style_profile_checksum_sha256 = '0'.repeat(64);
  assert.throws(
    () => buildKnowledgeVideoAssemblyPlan(input, {verifySharedReuseEvidence: passingVerifier}),
    /style profile binding is stale/i,
  );
});

test('routes approved Ink Doodle Knowledge Card PNGs to GraphicScene without Ian-only behavior', () => {
  const input = buildInkInput();
  const plan = buildKnowledgeVideoAssemblyPlan(input, {verifySharedReuseEvidence: passingVerifier});
  assert.equal(plan.scenes[1].scene_type, 'graphic');
  assert.equal(plan.scenes[1].visual_generation_route, 'ink-doodle-knowledge-card');
  assert.equal(plan.scenes[1].visible_text_policy, 'approved-exact-text-raster-v1');
  assert.equal(plan.scenes[1].image_sequence[0].style_profile_id, 'ink-doodle-knowledge-card');

  input.shots[1].assets[0].style_skill_checksum_sha256 = '0'.repeat(64);
  assert.throws(
    () => buildKnowledgeVideoAssemblyPlan(input, {verifySharedReuseEvidence: passingVerifier}),
    /style profile binding is stale/i,
  );
});

test('legacy v2 Comic direction evidence is readable but no Comic assembly is allowed', () => {
  const legacyInput = buildComicInput();
  assert.equal(validateVisualDirectionReview(legacyInput.visualDirectionReview, {
    shots: legacyInput.shots,
  }).result, 'pass');
  assert.throws(
    () => buildKnowledgeVideoAssemblyPlan(legacyInput, {verifySharedReuseEvidence: passingVerifier}),
    /comic-imagegen.*legacy read-only/i,
  );

  const input = buildComicInput();
  input.visualDirectionReview.contract_version = 'per-shot-visual-direction-review-v3';
  input.visualDirectionArtifactPolicy = {
    artifact_mode: 'current_v3',
    episode_completed: false,
    modified_shot_ids: input.shots.map((shot) => shot.shot_id),
  };
  input.visualDirectionReview.path = 'leverage-video/src/example/schema/per-shot-visual-direction-review-v3.json';
  input.visualDirectionReview.rows.forEach((row, index) => {
    row.visible_text_mode = 'none';
    row.exact_visible_text = null;
    row.visible_text_placement = null;
    Object.assign(row.user_selection, {
      visible_text_mode: 'none',
      exact_visible_text: null,
      visible_text_placement: null,
    });
    Object.assign(input.shots[index], {
      visible_text_mode: 'none',
      exact_visible_text: null,
      visible_text_placement: null,
    });
  });
  input.visualDirectionReview.presented_map_sha256 = buildPresentedMapSha256(input.visualDirectionReview);
  input.visualDirectionReview.rows.forEach((row) => {
    row.user_selection.presented_map_sha256 = input.visualDirectionReview.presented_map_sha256;
  });
  assert.throws(
    () => buildKnowledgeVideoAssemblyPlan(input, {verifySharedReuseEvidence: passingVerifier}),
    /comic-imagegen.*retired|legacy read-only/i,
  );
});

test('visual direction schema policy permits v1/v2 only for unchanged completed legacy evidence', () => {
  const legacy = buildVisualDirectionReview();
  assert.equal(validateVisualDirectionArtifactPolicy(legacy, {
    artifact_mode: 'legacy_read_only',
    episode_completed: true,
    modified_shot_ids: [],
  }).artifact_mode, 'legacy_read_only');
  assert.throws(
    () => validateVisualDirectionArtifactPolicy(legacy, {
      artifact_mode: 'legacy_read_only',
      episode_completed: true,
      modified_shot_ids: ['S01'],
    }),
    /reopened shot requires v3/i,
  );
  assert.throws(
    () => validateVisualDirectionArtifactPolicy(legacy, {
      artifact_mode: 'current_v3',
      episode_completed: false,
      modified_shot_ids: [],
    }),
    /legacy read-only/i,
  );
  const current = buildV3Input();
  assert.equal(validateVisualDirectionArtifactPolicy(
    current.visualDirectionReview,
    current.visualDirectionArtifactPolicy,
  ).artifact_mode, 'current_v3');
});

test('revoice assembly preserves the exact parent transition contract', () => {
  const input = buildV3Input();
  input.resumeMode = 'revoice_variant';
  Object.assign(input.shots[0].transition, {
    kind: 'dissolve',
    options: {},
    duration_seconds: 0.4,
    duration_in_frames: 12,
    source_intent: '用户批准保留 0.4 秒 dissolve',
  });
  input.shots[0].revoice_parent_transition = structuredClone(input.shots[0].transition);
  input.shots[1].revoice_parent_transition = null;
  const plan = buildKnowledgeVideoAssemblyPlan(input, {verifySharedReuseEvidence: passingVerifier});
  assert.equal(plan.qa_contract.revoice_transition_lock, 'strict-parent-transition-v1');
  assert.deepEqual(plan.scenes[0].transition, plan.scenes[0].revoice_parent_transition);

  input.shots[0].transition.duration_seconds = 0.5;
  input.shots[0].transition.duration_in_frames = 15;
  assert.throws(
    () => buildKnowledgeVideoAssemblyPlan(input, {verifySharedReuseEvidence: passingVerifier}),
    /revoice must preserve parent transition/i,
  );
});

test('v3 assembly rejects generic top-title and timeline text-overlay inputs', () => {
  for (const field of ['top_title', 'top_title_reason', 'top_title_overlay', 'timeline_text_overlays']) {
    const input = buildV3Input();
    input.shots[0][field] = field === 'timeline_text_overlays' ? [] : '禁止进入装配层';
    assert.throws(
      () => buildKnowledgeVideoAssemblyPlan(input, {verifySharedReuseEvidence: passingVerifier}),
      /must not receive a generic top-title or timeline text overlay field/i,
    );
  }
});

test('v3 assembly validates the mechanical action-state schedule and exact asset coverage', () => {
  const input = buildV3Input({characterSchedule: true});
  const plan = buildKnowledgeVideoAssemblyPlan(input, {verifySharedReuseEvidence: passingVerifier});
  assert.equal(plan.scenes[0].action_state_schedule.state_count_total, 3);
  assert.equal(plan.scenes[0].intra_shot_transitions.length, 2);

  input.shots[0].action_state_schedule.occurrences[1].duration_in_frames = 39;
  assert.throws(
    () => buildKnowledgeVideoAssemblyPlan(input, {verifySharedReuseEvidence: passingVerifier}),
    /action-state|coverage|consecutive/i,
  );
});

test('new assembly binds explicit workflow selection, v2 rhythm, and v4 schedule', () => {
  const input = buildV3Input({characterSchedule: true});
  const gate2ScriptSha256 = '4'.repeat(64);
  const density = {
    contract_version: 'visual-density-selection-v1',
    gate2_script_sha256: gate2ScriptSha256,
    density_mode: 'standard',
    decision: {
      status: 'selected',
      exact_message: '选择普通密度',
      decided_at: '2026-08-22T10:00:00+08:00',
    },
  };
  density.selection_sha256 = buildVisualDensitySelectionSha256(density);
  const mode = {
    contract_version: 'workflow-approval-mode-v1',
    gate2_script_sha256: gate2ScriptSha256,
    visual_density_selection_sha256: density.selection_sha256,
    approval_mode: 'manual',
    decision: {
      status: 'selected',
      exact_message: '选择手动审批',
      decided_at: '2026-08-22T10:01:00+08:00',
    },
  };
  mode.selection_sha256 = buildWorkflowApprovalModeSha256(mode);
  input.workflowApproval = {gate2ScriptSha256, density, mode};
  const shot = input.shots[0];
  shot.density_mode = 'standard';
  shot.visual_density_selection_sha256 = density.selection_sha256;
  shot.action_state_schedule = buildActionStateScheduleV4({
    totalFrames: 120,
    fps: 30,
    sourceText: '甲乙丙',
    motionTier: 'stateful',
    densityMode: 'standard',
    visualDensitySelectionSha256: density.selection_sha256,
    states: shot.assets.map((asset, index) => ({
      state_id: asset.asset_id,
      semantic_state: ['预备', '接触', '结果'][index],
      narration_byte_start: index * 3,
      narration_byte_end: (index + 1) * 3,
      narration_text: ['甲', '乙', '丙'][index],
      at_frame: asset.from,
      semantic_hold_reason: null,
    })),
    intraShotTransitions: shot.intra_shot_transitions,
  });
  const plan = buildKnowledgeVideoAssemblyPlan(input, {
    verifySharedReuseEvidence: passingVerifier,
    verifyStoryboardVisualRhythmEvidence: passingV2StoryboardVisualRhythmVerifier,
  });
  assert.equal(plan.scenes[0].action_state_schedule.contract_version, 'action-state-schedule-v4');
  assert.equal(plan.scenes[0].visual_density_selection_sha256, density.selection_sha256);
  assert.equal(plan.qa_contract.workflow_approval.result, 'pass');
});

test('hero_pose carries one locked background behind four transparent pose occurrences', () => {
  const input = buildV3Input();
  const template = input.shots[0].assets[0];
  input.shots[0].motion_tier = 'hero_pose';
  input.shots[0].hero_pose_background = {
    asset_id: 'S01-bg',
    asset: 'example/assets/image/S01-bg.png',
    checksum_sha256: 'a'.repeat(64),
    visual_generation_route: 'imagegen',
  };
  input.shots[0].assets = ['pose-1', 'pose-2', 'pose-3', 'pose-4'].map((assetId, index) => ({
    ...template,
    asset_id: assetId,
    asset: `example/assets/image/${assetId}.png`,
    from: index * 30,
    duration_in_frames: 30,
  }));
  input.shots[0].intra_shot_transitions = buildDefaultIntraShotTransitions({
    imageSequence: input.shots[0].assets,
    fps: 30,
  });
  input.shots[0].action_state_schedule = buildActionStateScheduleV3({
    totalFrames: 120,
    sourceText: '甲乙丙丁',
    motionTier: 'hero_pose',
    states: input.shots[0].assets.map((asset, index) => ({
      state_id: asset.asset_id,
      semantic_state: ['建立', '预备', '冲击', '稳定'][index],
      narration_byte_start: index * 3,
      narration_byte_end: (index + 1) * 3,
      narration_text: ['甲', '乙', '丙', '丁'][index],
      at_frame: asset.from,
      semantic_hold_reason: null,
    })),
    intraShotTransitions: input.shots[0].intra_shot_transitions,
  });
  const plan = buildKnowledgeVideoAssemblyPlan(input, {verifySharedReuseEvidence: passingVerifier});
  assert.equal(plan.scenes[0].hero_pose_background.asset_id, 'S01-bg');
  assert.equal(plan.scenes[0].image_sequence.length, 4);

  delete input.shots[0].hero_pose_background;
  assert.throws(
    () => buildKnowledgeVideoAssemblyPlan(input, {verifySharedReuseEvidence: passingVerifier}),
    /hero_pose requires one locked/i,
  );
});

test('layered accepts one master without fabricating an action-state family', () => {
  const input = buildV3Input();
  input.shots[0].motion_tier = 'layered';
  input.shots[0].assets = [{
    ...input.shots[0].assets[0],
    from: 0,
    duration_in_frames: 120,
  }];
  input.shots[0].intra_shot_transitions = [];
  delete input.shots[0].action_state_schedule;
  const plan = buildKnowledgeVideoAssemblyPlan(input, {verifySharedReuseEvidence: passingVerifier});
  assert.equal(plan.scenes[0].action_state_schedule, null);
  assert.equal(plan.scenes[0].image_sequence.length, 1);

  input.shots[0].motion_tier = 'stateful';
  assert.throws(
    () => buildKnowledgeVideoAssemblyPlan(input, {verifySharedReuseEvidence: passingVerifier}),
    /stateful requires 2–4|action-state-schedule-v3/i,
  );
});

test('Comic retirement blocks before legacy asset-state details can create output', () => {
  const input = buildComicInput();
  input.shots[0].assets[0].duration_in_frames = 106;
  input.shots[0].assets[1].from = 106;
  input.shots[0].assets[1].duration_in_frames = 14;
  assert.throws(
    () => buildKnowledgeVideoAssemblyPlan(input, {verifySharedReuseEvidence: passingVerifier}),
    /comic-imagegen.*legacy read-only/i,
  );
});

test('rejects an intent-only ordinary transition because user selection evidence is missing', () => {
  const input = structuredClone(baseInput);
  delete input.shots[0].transition;
  input.shots[0].transition_intent = '0.4s dissolve';
  assert.throws(
    () => buildKnowledgeVideoAssemblyPlan(input, {verifySharedReuseEvidence: passingVerifier}),
    /user-approved structured transition/,
  );
});

test('rejects a transition that is not bound to the approved review checksum', () => {
  const input = structuredClone(baseInput);
  input.shots[0].transition.user_selection.presented_map_sha256 = 'c'.repeat(64);
  assert.throws(
    () => buildKnowledgeVideoAssemblyPlan(input, {verifySharedReuseEvidence: passingVerifier}),
    /transition review checksum mismatch/,
  );
});

test('routes multiple consecutive Ian rasters to one graphic scene', () => {
  const input = structuredClone(baseInput);
  input.shots[1].assets[0].duration_in_frames = 60;
  input.shots[1].assets.push({
    asset_id: 'S02-extra',
    asset: 'example/assets/image/s02-extra.png',
    from: 60,
    duration_in_frames: 60,
    visual_generation_route: 'ian-handdrawn-ppt',
  });

  const plan = buildKnowledgeVideoAssemblyPlan(input, {verifySharedReuseEvidence: passingVerifier});
  assert.equal(plan.scenes[1].scene_type, 'graphic');
  assert.equal(plan.scenes[1].image_sequence.length, 2);
  assert.equal(plan.scenes[1].intra_shot_transitions.length, 1);
});

test('routes approved Doodle PNGs to the Doodle scene', () => {
  const input = structuredClone(baseInput);
  input.shots[1].visual_generation_route = 'doodle-slides';
  input.shots[1].assets[0].visual_generation_route = 'doodle-slides';
  input.visualDirectionReview.rows[1].user_selection.visual_generation_route = 'doodle-slides';
  input.visualDirectionReview.rows[1].user_selection.exact_message = '确认 S02 使用 Doodle';
  const plan = buildKnowledgeVideoAssemblyPlan(input, {verifySharedReuseEvidence: passingVerifier});
  assert.equal(plan.scenes[1].scene_type, 'doodle');
  assert.equal(plan.scenes[1].visual_generation_route, 'doodle-slides');
});

test('routes a fully approved whiteboard MP4 to WhiteboardScene without intra-shot watercolor', () => {
  const input = structuredClone(baseInput);
  routeSecondShotToWhiteboard(input);
  const plan = buildKnowledgeVideoAssemblyPlan(input, {verifySharedReuseEvidence: passingVerifier});
  const scene = plan.scenes[1];
  assert.equal(scene.scene_type, 'whiteboard');
  assert.equal(scene.visual_generation_route, 'srt-whiteboard-animation');
  assert.equal(scene.intra_shot_transitions.length, 0);
  assert.equal(scene.whiteboard.contract_version, 'whiteboard-scene-v1');
  assert.equal(scene.whiteboard.clip.checksum_sha256, '5'.repeat(64));
  assert.equal(scene.whiteboard.visual_sequence_lock.annotation_sha256, '3'.repeat(64));
});

test('rejects missing or self-inconsistent whiteboard source dimensions', () => {
  const missing = structuredClone(baseInput);
  const missingWhiteboard = whiteboardInput();
  delete missingWhiteboard.source_dimensions;
  routeSecondShotToWhiteboard(missing, missingWhiteboard);
  assert.throws(
    () => buildKnowledgeVideoAssemblyPlan(missing, {verifySharedReuseEvidence: passingVerifier}),
    /source image is outside/i,
  );

  const inconsistent = structuredClone(baseInput);
  const inconsistentWhiteboard = whiteboardInput();
  inconsistentWhiteboard.source_dimensions = [1600, 900];
  inconsistentWhiteboard.source_aspect_ratio_relative_error = 0.004;
  routeSecondShotToWhiteboard(inconsistent, inconsistentWhiteboard);
  assert.throws(
    () => buildKnowledgeVideoAssemblyPlan(inconsistent, {verifySharedReuseEvidence: passingVerifier}),
    /aspect evidence/i,
  );
});

test('blocks whiteboard assembly until all three exact-byte reviews are approved', () => {
  for (const stage of ['source_image_review', 'annotation_review', 'clip_review']) {
    const input = structuredClone(baseInput);
    const whiteboard = whiteboardInput();
    whiteboard.review[stage].status = 'pending';
    routeSecondShotToWhiteboard(input, whiteboard);
    assert.throws(
      () => buildKnowledgeVideoAssemblyPlan(input, {verifySharedReuseEvidence: passingVerifier}),
      /whiteboard.*not approved/i,
    );
  }
});

test('builds piecewise element-span retiming while preserving parent clip bytes', () => {
  const input = structuredClone(baseInput);
  const whiteboard = whiteboardInput({
    sourceDurationFrames: 100,
    outputDurationFrames: 120,
    retimingMode: 'piecewise-element-span-v1',
  });
  routeSecondShotToWhiteboard(input, whiteboard);
  const scene = buildKnowledgeVideoAssemblyPlan(input, {
    verifySharedReuseEvidence: passingVerifier,
  }).scenes[1];
  assert.equal(scene.whiteboard.timing_segments.length, 2);
  assert.equal(scene.whiteboard.timing_segments[0].playback_rate, 40 / 50);
  assert.equal(scene.whiteboard.timing_segments[1].playback_rate, 60 / 70);
  assert.equal(scene.whiteboard.visual_sequence_lock.clip_sha256, '5'.repeat(64));
});

test('rejects one global playback scaling segment for a revoice whiteboard variant', () => {
  const input = structuredClone(baseInput);
  const whiteboard = whiteboardInput({
    sourceDurationFrames: 100,
    outputDurationFrames: 120,
    retimingMode: 'piecewise-element-span-v1',
  });
  whiteboard.timing_segments = [{
    source_start_frame: 0,
    source_end_frame: 100,
    output_start_frame: 0,
    output_end_frame: 120,
    element_ids: whiteboard.element_order,
    subtitle_span: {start: 0, end: 4, text: '完整锁稿'},
  }];
  routeSecondShotToWhiteboard(input, whiteboard);
  assert.throws(
    () => buildKnowledgeVideoAssemblyPlan(input, {verifySharedReuseEvidence: passingVerifier}),
    /requires piecewise segments/i,
  );
});

test('rejects missing, pending, or stale visual direction review evidence', () => {
  let input = structuredClone(baseInput);
  delete input.visualDirectionReview;
  assert.throws(
    () => buildKnowledgeVideoAssemblyPlan(input, {verifySharedReuseEvidence: passingVerifier}),
    /visual direction review/i,
  );

  input = structuredClone(baseInput);
  input.visualDirectionReview.rows[0].user_selection.status = 'pending';
  assert.throws(
    () => buildKnowledgeVideoAssemblyPlan(input, {verifySharedReuseEvidence: passingVerifier}),
    /selection status|explicit approved selection/i,
  );

  input = structuredClone(baseInput);
  input.visualDirectionReview.presented_map_sha256 = '0'.repeat(64);
  assert.throws(
    () => buildKnowledgeVideoAssemblyPlan(input, {verifySharedReuseEvidence: passingVerifier}),
    /presented map checksum mismatch/i,
  );
});

test('rejects missing shot routes and asset-route mismatches', () => {
  let input = structuredClone(baseInput);
  input.shots[0].visual_generation_route = null;
  assert.throws(
    () => buildKnowledgeVideoAssemblyPlan(input, {verifySharedReuseEvidence: passingVerifier}),
    /route mismatch|requires an explicit visual_generation_route/i,
  );

  input = structuredClone(baseInput);
  input.shots[1].assets[0].visual_generation_route = 'doodle-slides';
  assert.throws(
    () => buildKnowledgeVideoAssemblyPlan(input, {verifySharedReuseEvidence: passingVerifier}),
    /asset route mismatch/i,
  );
});

test('fails closed when a scene mixes asset routes', () => {
  const input = structuredClone(baseInput);
  input.shots[1].assets[0].duration_in_frames = 60;
  input.shots[1].assets.push({
    asset_id: 'S02-extra',
    asset: 'example/assets/image/s02-extra.png',
    from: 60,
    duration_in_frames: 60,
  });
  assert.throws(() => buildKnowledgeVideoAssemblyPlan(input, {verifySharedReuseEvidence: passingVerifier}), /asset route mismatch/);
});

test('fails closed on gaps in the narration-bound timeline', () => {
  const input = structuredClone(baseInput);
  input.shots[1].start_frame = 181;
  assert.throws(
    () => buildKnowledgeVideoAssemblyPlan(input, {verifySharedReuseEvidence: passingVerifier}),
    /consecutive/,
  );
});

test('requires passing shared consumption evidence', () => {
  const input = structuredClone(baseInput);
  assert.throws(
    () => buildKnowledgeVideoAssemblyPlan(input, {
      verifySharedReuseEvidence: () => ({validation_phase: 'pre-script', result: 'pass'}),
    }),
    /shared reuse consumption evidence/,
  );
});

test('does not trust an embedded visual-direction review when its artifact is absent', () => {
  const input = structuredClone(baseInput);
  assert.throws(
    () => buildPlanWithVerification(input, {verifySharedReuseEvidence: passingVerifier}),
    /visual direction review artifact/i,
  );
});
