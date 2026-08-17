import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';

import {
  ACTIVE_ROUTE_IDS,
  CATALOG,
  CATALOG_CHECKSUM_SHA256,
  LEGACY_CATALOG_CHECKSUM_SHA256,
  buildPresentedMapSha256,
  resolveRouteVisibleTextPolicy,
  validateVisualDirectionReview,
} from './contract.mjs';
import {
  VISUAL_LANGUAGE_CATALOG_CHECKSUM_SHA256,
} from '../visual-language/contract.mjs';

const approvedAt = '2026-08-15T10:00:00+08:00';

const row = ({
  shotId,
  sceneClass,
  structuredVisualKind = null,
  catRecommended,
  compatibleRoutes,
  recommendedRoute,
  selectedCat,
  selectedRoute,
  exactMessage = `确认 ${shotId}`,
}) => ({
  shot_id: shotId,
  scene_class: sceneClass,
  structured_visual_kind: structuredVisualKind,
  factual_identity: {
    contains_real_or_historical_subject: false,
    white_cat_replaces_factual_identity: false,
  },
  white_cat_recommendation: {
    recommended: catRecommended,
    rationale: catRecommended ? '白猫承担提问者动作。' : '结构图不使用装饰角色。',
  },
  compatible_routes: compatibleRoutes,
  incompatible_routes: [
    ...(['imagegen', 'ian-handdrawn-ppt', 'doodle-slides', 'srt-whiteboard-animation']
      .filter((route) => !compatibleRoutes.includes(route))),
  ],
  incompatible_route_reasons: Object.fromEntries(
    ['imagegen', 'ian-handdrawn-ppt', 'doodle-slides', 'srt-whiteboard-animation']
      .filter((route) => !compatibleRoutes.includes(route))
      .map((route) => [route, `${route} 不兼容当前镜头的场景分类或白猫决定。`]),
  ),
  recommended_route: recommendedRoute,
  recommendation_reason: '按镜头语义推荐。',
  user_selection: {
    status: 'approved',
    white_cat_present: selectedCat,
    visual_generation_route: selectedRoute,
    exact_message: exactMessage,
    decided_at: approvedAt,
    presented_map_sha256: null,
  },
});

const buildReview = (rows) => {
  const review = {
    contract_version: 'per-shot-visual-direction-review-v1',
    catalog_version: 'visual-generation-route-catalog-v1',
    catalog_checksum_sha256: LEGACY_CATALOG_CHECKSUM_SHA256,
    storyboard: {
      path: 'leverage-video/src/example/script/storyboard.md',
      checksum_sha256: 'a'.repeat(64),
    },
    status: 'approved',
    generated_shot_count: rows.length,
    presentation: {
      presented_at: '2026-08-15T09:55:00+08:00',
      exact_message: '请确认以下完整逐镜视觉方向表。',
    },
    rows,
  };
  review.presented_map_sha256 = buildPresentedMapSha256(review);
  for (const item of review.rows) {
    item.user_selection.presented_map_sha256 = review.presented_map_sha256;
  }
  return review;
};

const catRow = () => row({
  shotId: 'S01',
  sceneClass: 'narrative_illustration',
  catRecommended: true,
  compatibleRoutes: ['imagegen'],
  recommendedRoute: 'imagegen',
  selectedCat: true,
  selectedRoute: 'imagegen',
});

const structuredRow = (route = 'ian-handdrawn-ppt') => row({
  shotId: 'S02',
  sceneClass: 'structured_graphic',
  structuredVisualKind: 'cause_effect',
  catRecommended: false,
  compatibleRoutes: ['ian-handdrawn-ppt', 'doodle-slides', 'srt-whiteboard-animation'],
  recommendedRoute: 'ian-handdrawn-ppt',
  selectedCat: false,
  selectedRoute: route,
});

const matchingShots = (review) => review.rows.map((item) => ({
  shot_id: item.shot_id,
  scene_class: item.scene_class,
  structured_visual_kind: item.structured_visual_kind,
  white_cat_present: item.user_selection.white_cat_present,
  visual_generation_route: item.user_selection.visual_generation_route,
}));

test('accepts white cat with imagegen', () => {
  const review = buildReview([catRow()]);
  assert.equal(validateVisualDirectionReview(review, {shots: matchingShots(review)}).result, 'pass');
});

test('accepts no-cat structured shots with Ian or Doodle', () => {
  for (const route of ['ian-handdrawn-ppt', 'doodle-slides', 'srt-whiteboard-animation']) {
    const review = buildReview([structuredRow(route)]);
    assert.equal(validateVisualDirectionReview(review, {shots: matchingShots(review)}).result, 'pass');
  }
});

test('accepts optional whiteboard for a no-cat narrative without changing the imagegen recommendation', () => {
  const item = catRow();
  item.white_cat_recommendation.recommended = false;
  item.compatible_routes = ['imagegen', 'srt-whiteboard-animation'];
  item.incompatible_routes = ['ian-handdrawn-ppt', 'doodle-slides'];
  item.incompatible_route_reasons = Object.fromEntries(
    item.incompatible_routes.map((route) => [route, `${route} 不兼容叙事插画。`]),
  );
  item.user_selection.white_cat_present = false;
  item.user_selection.visual_generation_route = 'srt-whiteboard-animation';
  item.user_selection.exact_message = '确认 S01 使用白板路线';
  const review = buildReview([item]);
  assert.equal(validateVisualDirectionReview(review, {shots: matchingShots(review)}).result, 'pass');
  assert.equal(item.recommended_route, 'imagegen');
});

test('rejects white cat with any non-imagegen route', () => {
  for (const route of ['ian-handdrawn-ppt', 'doodle-slides', 'srt-whiteboard-animation']) {
    const item = catRow();
    item.compatible_routes = ['imagegen', route];
    item.incompatible_routes = [
      ...(['ian-handdrawn-ppt', 'doodle-slides', 'srt-whiteboard-animation']
        .filter((value) => value !== route)),
    ];
    item.incompatible_route_reasons = Object.fromEntries(
      item.incompatible_routes.map((value) => [value, `${value} 与当前白猫决定不兼容。`]),
    );
    item.user_selection.visual_generation_route = route;
    const review = buildReview([item]);
    assert.throws(() => validateVisualDirectionReview(review, {shots: matchingShots(review)}), /white cat.*imagegen/i);
  }
});

test('rejects Doodle for a narrative illustration', () => {
  const item = catRow();
  item.white_cat_recommendation.recommended = false;
  item.compatible_routes = ['imagegen', 'doodle-slides'];
  item.incompatible_routes = ['ian-handdrawn-ppt', 'srt-whiteboard-animation'];
  item.incompatible_route_reasons = {
    'ian-handdrawn-ppt': '当前测试强制错误地把叙事插画改成 Doodle。',
    'srt-whiteboard-animation': '当前测试强制错误地把叙事插画改成 Doodle。',
  };
  item.user_selection.white_cat_present = false;
  item.user_selection.visual_generation_route = 'doodle-slides';
  const review = buildReview([item]);
  assert.throws(() => validateVisualDirectionReview(review, {shots: matchingShots(review)}), /Doodle.*structured/i);
});

test('rejects unknown routes and pending selections', () => {
  const unknown = structuredRow();
  unknown.compatible_routes = ['mystery'];
  unknown.recommended_route = 'mystery';
  unknown.user_selection.visual_generation_route = 'mystery';
  let review = buildReview([unknown]);
  assert.throws(() => validateVisualDirectionReview(review, {shots: matchingShots(review)}), /unknown route/i);

  review = buildReview([structuredRow()]);
  review.rows[0].user_selection.status = 'pending';
  assert.throws(() => validateVisualDirectionReview(review, {shots: matchingShots(review)}), /explicit approved selection/i);
});

test('rejects generic authorization words', () => {
  for (const exactMessage of ['继续', '默认', '你看着办', '按推荐来', '好的', '随便']) {
    const item = structuredRow();
    item.user_selection.exact_message = exactMessage;
    const review = buildReview([item]);
    assert.throws(() => validateVisualDirectionReview(review, {shots: matchingShots(review)}), /generic authorization/i);
  }
});

test('rejects stale catalog and presented-map checksums', () => {
  let review = buildReview([structuredRow()]);
  review.catalog_checksum_sha256 = '0'.repeat(64);
  assert.throws(() => validateVisualDirectionReview(review, {shots: matchingShots(review)}), /catalog checksum mismatch/i);

  review = buildReview([structuredRow()]);
  review.presented_map_sha256 = '0'.repeat(64);
  assert.throws(() => validateVisualDirectionReview(review, {shots: matchingShots(review)}), /presented map checksum mismatch/i);
});

test('rejects shot mappings that drift from the approved review', () => {
  const review = buildReview([structuredRow('doodle-slides')]);
  const shots = matchingShots(review);
  shots[0].visual_generation_route = 'ian-handdrawn-ppt';
  assert.throws(() => validateVisualDirectionReview(review, {shots}), /route mismatch/i);
});

test('rejects white-cat replacement of factual identity', () => {
  const item = catRow();
  item.factual_identity = {
    contains_real_or_historical_subject: true,
    white_cat_replaces_factual_identity: true,
  };
  const review = buildReview([item]);
  assert.throws(() => validateVisualDirectionReview(review, {shots: matchingShots(review)}), /factual identity/i);
});

test('requires rewrite and re-presentation evidence when a recommended cat is removed', () => {
  const item = catRow();
  item.scene_class = 'structured_graphic';
  item.structured_visual_kind = 'comparison';
  item.compatible_routes = ['ian-handdrawn-ppt', 'doodle-slides', 'srt-whiteboard-animation'];
  item.incompatible_routes = ['imagegen'];
  item.incompatible_route_reasons = {imagegen: '移除白猫后已重写为结构图。'};
  item.recommended_route = 'ian-handdrawn-ppt';
  item.user_selection.white_cat_present = false;
  item.user_selection.visual_generation_route = 'doodle-slides';
  item.user_selection.exact_message = '移除白猫，改用 Doodle';
  let review = buildReview([item]);
  assert.throws(() => validateVisualDirectionReview(review, {shots: matchingShots(review)}), /cat removal.*rewrite.*re-present/i);

  item.cat_removal_revision = {
    status: 'rewritten_and_represented',
    narration_semantics_unchanged: true,
    visual_description_rewritten: true,
    compatibility_recomputed: true,
  };
  review = buildReview([item]);
  assert.equal(validateVisualDirectionReview(review, {shots: matchingShots(review)}).result, 'pass');
});

test('requires semantic and factual review when a non-recommended cat is added', () => {
  const item = catRow();
  item.white_cat_recommendation.recommended = false;
  item.user_selection.exact_message = '增加白猫并使用 imagegen';
  let review = buildReview([item]);
  assert.throws(() => validateVisualDirectionReview(review, {shots: matchingShots(review)}), /cat addition.*semantic.*factual.*re-present/i);

  item.cat_addition_review = {
    status: 'recomputed_and_represented',
    semantic_necessity_passed: true,
    factual_identity_check_passed: true,
  };
  review = buildReview([item]);
  assert.equal(validateVisualDirectionReview(review, {shots: matchingShots(review)}).result, 'pass');
});

test('accepts confirm-all-recommendations only with complete presentation evidence', () => {
  const item = structuredRow();
  item.user_selection.exact_message = '确认全部推荐';
  let review = buildReview([item]);
  assert.equal(validateVisualDirectionReview(review, {shots: matchingShots(review)}).result, 'pass');

  review = buildReview([structuredRow()]);
  delete review.presentation;
  assert.throws(() => validateVisualDirectionReview(review, {shots: matchingShots(review)}), /complete visual direction table presentation/i);
});

test('rejects a presented row without a reason for every incompatible route', () => {
  const item = structuredRow();
  item.incompatible_route_reasons = {};
  const review = buildReview([item]);
  assert.throws(
    () => validateVisualDirectionReview(review, {shots: matchingShots(review)}),
    /incompatible route reason/i,
  );
});

test('confirm-all-recommendations cannot approve a non-recommended route', () => {
  const item = structuredRow('doodle-slides');
  item.user_selection.exact_message = '确认全部推荐';
  const review = buildReview([item]);
  assert.throws(
    () => validateVisualDirectionReview(review, {shots: matchingShots(review)}),
    /confirm all recommendations.*recommended route/i,
  );
});

const pendingReference = {
  contract_version: 'comic-character-reference-review-v1',
  status: 'pending',
};

const comicPlanCandidate = ({panelCount = 2, continuityGroupId = null, continuityGroupSize = 0} = {}) => ({
  contract_version: 'comic-shot-plan-v1',
  panel_count: panelCount,
  panel_beats: Array.from({length: panelCount}, (_, index) => ({
    panel_index: index + 1,
    purpose: `节拍 ${index + 1}`,
    visual_action: `动作 ${index + 1}`,
  })),
  layout: 'standard',
  character_continuity_group_id: continuityGroupId,
  character_continuity_group_size: continuityGroupSize,
  treatment_profile_id: 'comic-manga-warm',
  visible_text_mode: 'none',
  requires_panel_order_contract: true,
  character_reference_review: continuityGroupId === null ? null : pendingReference,
});

const v2Row = ({
  route = 'comic-imagegen',
  eligible = true,
  recommendComic = true,
  visualStructureId = 'sequential-panels',
  treatmentProfileId = route === 'comic-imagegen' ? 'comic-manga-warm' : 'imagegen-watercolor-narrative',
  plan = eligible ? comicPlanCandidate() : null,
} = {}) => {
  const compatibleRoutes = eligible
    ? ['imagegen', 'comic-imagegen', 'srt-whiteboard-animation']
    : ['imagegen', 'srt-whiteboard-animation'];
  const allRoutes = ['imagegen', 'comic-imagegen', 'ian-handdrawn-ppt', 'doodle-slides', 'srt-whiteboard-animation'];
  const incompatibleRoutes = allRoutes.filter((item) => !compatibleRoutes.includes(item));
  return {
    shot_id: 'S01',
    scene_class: 'narrative_illustration',
    structured_visual_kind: null,
    factual_identity: {
      contains_real_or_historical_subject: false,
      white_cat_replaces_factual_identity: false,
    },
    white_cat_recommendation: {recommended: false, rationale: '本镜无需白猫。'},
    visual_language_recommendation: {
      visual_structure_id: visualStructureId,
      treatment_profile_id: treatmentProfileId,
    },
    comic_eligibility: {
      eligible,
      recommend_comic_route: recommendComic,
      reasons: [eligible ? '存在两个有序故事节拍。' : '仅为单幅漫画审美。'],
    },
    comic_plan_candidate: plan,
    compatible_routes: compatibleRoutes,
    incompatible_routes: incompatibleRoutes,
    incompatible_route_reasons: Object.fromEntries(
      incompatibleRoutes.map((item) => [item, `${item} 不兼容当前结构。`]),
    ),
    recommended_route: recommendComic ? 'comic-imagegen' : 'imagegen',
    recommendation_reason: recommendComic ? '漫画节拍明显。' : '单幅插画默认使用 imagegen。',
    user_selection: {
      status: 'approved',
      white_cat_present: false,
      visual_structure_id: visualStructureId,
      treatment_profile_id: treatmentProfileId,
      visual_generation_route: route,
      comic_plan: route === 'comic-imagegen' ? plan : null,
      exact_message: '确认 S01 的视觉结构、处理配置与路线',
      decided_at: approvedAt,
      presented_map_sha256: null,
    },
  };
};

const buildV2Review = (rows) => {
  const review = {
    contract_version: 'per-shot-visual-direction-review-v2',
    catalog_version: 'visual-generation-route-catalog-v2',
    catalog_checksum_sha256: CATALOG_CHECKSUM_SHA256,
    visual_language_catalog_version: 'visual-language-catalog-v1',
    visual_language_catalog_checksum_sha256: VISUAL_LANGUAGE_CATALOG_CHECKSUM_SHA256,
    storyboard: {path: 'episode/script/storyboard.md', checksum_sha256: 'b'.repeat(64)},
    status: 'approved',
    generated_shot_count: rows.length,
    presentation: {presented_at: approvedAt, exact_message: '请确认完整逐镜视觉方向表 v2。'},
    rows,
  };
  review.presented_map_sha256 = buildPresentedMapSha256(review);
  for (const item of rows) item.user_selection.presented_map_sha256 = review.presented_map_sha256;
  return review;
};

const matchingV2Shots = (review) => review.rows.map((item) => ({
  shot_id: item.shot_id,
  scene_class: item.scene_class,
  structured_visual_kind: item.structured_visual_kind,
  white_cat_present: item.user_selection.white_cat_present,
  visual_structure_id: item.user_selection.visual_structure_id,
  treatment_profile_id: item.user_selection.treatment_profile_id,
  visual_generation_route: item.user_selection.visual_generation_route,
  comic_plan: item.user_selection.comic_plan,
}));

test('v2 accepts an explicitly eligible comic route with a locked panel plan', () => {
  const review = buildV2Review([v2Row()]);
  assert.equal(validateVisualDirectionReview(review, {shots: matchingV2Shots(review)}).result, 'pass');
});

test('v2 keeps a single comic-styled illustration on ordinary imagegen', () => {
  const review = buildV2Review([v2Row({
    route: 'imagegen',
    eligible: false,
    recommendComic: false,
    visualStructureId: 'single-scene',
    treatmentProfileId: 'comic-ligne-claire-neutral',
    plan: null,
  })]);
  assert.equal(validateVisualDirectionReview(review, {shots: matchingV2Shots(review)}).result, 'pass');
});

test('v2 rejects comic route without eligibility and exact presented plan', () => {
  let review = buildV2Review([v2Row({
    route: 'comic-imagegen',
    eligible: false,
    recommendComic: false,
    visualStructureId: 'single-scene',
    plan: null,
  })]);
  assert.throws(() => validateVisualDirectionReview(review, {shots: matchingV2Shots(review)}), /incompatible|comic plan/i);

  const item = v2Row();
  item.user_selection.comic_plan = {...item.comic_plan_candidate, layout: 'cinematic'};
  review = buildV2Review([item]);
  assert.throws(() => validateVisualDirectionReview(review, {shots: matchingV2Shots(review)}), /exact presented/i);
});

test('v2 rejects a malformed presented Comic candidate even when imagegen is selected', () => {
  const review = buildV2Review([v2Row({
    route: 'imagegen',
    recommendComic: true,
    treatmentProfileId: 'comic-manga-warm',
  })]);
  review.rows[0].comic_plan_candidate.panel_count = 4;
  review.rows[0].comic_plan_candidate.panel_beats.push({
    panel_index: 4,
    purpose: '过密节拍',
    visual_action: '把第四个动作塞入漫画页',
  });
  review.presented_map_sha256 = buildPresentedMapSha256(review);
  review.rows[0].user_selection.presented_map_sha256 = review.presented_map_sha256;
  assert.throws(
    () => validateVisualDirectionReview(review, {shots: matchingV2Shots(review)}),
    /panel_count must be an integer from 1 to 3/i,
  );
});

test('v1 review remains readable only with the pinned legacy checksum', () => {
  const review = buildReview([structuredRow()]);
  assert.equal(validateVisualDirectionReview(review, {shots: matchingShots(review)}).result, 'pass');
  review.catalog_checksum_sha256 = CATALOG_CHECKSUM_SHA256;
  assert.throws(() => validateVisualDirectionReview(review, {shots: matchingShots(review)}), /legacy.*checksum/i);
});

const buildV3Review = ({
  eligible = false,
  route = 'imagegen',
  visibleTextMode = 'none',
  whiteCatPresent = true,
} = {}) => {
  const item = v2Row({
    eligible,
    route,
    recommendComic: eligible,
    treatmentProfileId: route === 'xuan-paper-diorama'
      ? 'xuan-paper-diorama'
      : (eligible ? 'comic-manga-warm' : 'imagegen-watercolor-narrative'),
  });
  item.white_cat_recommendation = {
    recommended: whiteCatPresent,
    rationale: whiteCatPresent ? '白猫承担连续叙事动作。' : '本镜不需要白猫。',
  };
  item.user_selection.white_cat_present = whiteCatPresent;
  if (eligible && whiteCatPresent) item.comic_plan_candidate.character_reference_review = pendingReference;
  item.compatible_routes = whiteCatPresent
    ? ['imagegen', 'xuan-paper-diorama']
    : ['imagegen', 'xuan-paper-diorama', 'srt-whiteboard-animation'];
  item.incompatible_routes = ACTIVE_ROUTES_FOR_TEST.filter(
    (candidate) => !item.compatible_routes.includes(candidate),
  );
  item.incompatible_route_reasons = Object.fromEntries(
    item.incompatible_routes.map((candidate) => [candidate, `${candidate} 不兼容当前分类。`]),
  );
  item.recommended_route = 'imagegen';
  item.visible_text_mode = visibleTextMode;
  item.exact_visible_text = visibleTextMode === 'required' ? '知行合一' : null;
  item.visible_text_placement = visibleTextMode === 'required' ? '画面中央标题区' : null;
  Object.assign(item.user_selection, {
    visible_text_mode: item.visible_text_mode,
    exact_visible_text: item.exact_visible_text,
    visible_text_placement: item.visible_text_placement,
  });
  const review = buildV2Review([item]);
  review.contract_version = 'per-shot-visual-direction-review-v3';
  review.presentation.exact_message = '请确认完整逐镜视觉方向表 v3。';
  review.presented_map_sha256 = buildPresentedMapSha256(review);
  item.user_selection.presented_map_sha256 = review.presented_map_sha256;
  return review;
};

const matchingV3Shots = (review) => matchingV2Shots(review).map((shot, index) => ({
  ...shot,
  visible_text_mode: review.rows[index].user_selection.visible_text_mode,
  exact_visible_text: review.rows[index].user_selection.exact_visible_text,
  visible_text_placement: review.rows[index].user_selection.visible_text_placement,
}));

const ACTIVE_ROUTES_FOR_TEST = [
  'imagegen',
  'xuan-paper-diorama',
  'ian-handdrawn-ppt',
  'ink-doodle-knowledge-card',
  'srt-whiteboard-animation',
];

test('v3 adds Ink Doodle Knowledge Card and retires Comic plus Doodle Slides', () => {
  assert.deepEqual(ACTIVE_ROUTE_IDS, ACTIVE_ROUTES_FOR_TEST);
  const review = buildV3Review({eligible: true, route: 'comic-imagegen'});
  assert.throws(
    () => validateVisualDirectionReview(review, {shots: matchingV3Shots(review)}),
    /comic-imagegen.*retired/i,
  );
  const doodle = buildV3Review({eligible: false, route: 'doodle-slides'});
  assert.throws(
    () => validateVisualDirectionReview(doodle, {shots: matchingV3Shots(doodle)}),
    /doodle-slides.*retired/i,
  );
});

test('xuan-paper-diorama route pins the current generate-visual-styles Skill and profile bytes', () => {
  const route = CATALOG.routes.find((item) => item.route_id === 'xuan-paper-diorama');
  const checksum = (filePath) => crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
  assert.equal(route.selection_policy, 'explicit-optional-only');
  assert.equal(route.visible_text_policy, 'text-free-v1');
  assert.equal(checksum(route.style_skill_path), route.style_skill_checksum_sha256);
  assert.equal(checksum(route.style_profile_path), route.style_profile_checksum_sha256);
});

test('ink-doodle-knowledge-card pins the current style Skill and profile bytes', () => {
  const route = CATALOG.routes.find((item) => item.route_id === 'ink-doodle-knowledge-card');
  const checksum = (filePath) => crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
  assert.equal(route.selection_policy, 'explicit-optional-only');
  assert.equal(route.visible_text_policy, 'approved-exact-text-raster-v1');
  assert.equal(checksum(route.style_skill_path), route.style_skill_checksum_sha256);
  assert.equal(checksum(route.style_profile_path), route.style_profile_checksum_sha256);
});

test('v3 rejects ineligible white-cat Comic', () => {
  const review = buildV3Review({eligible: false, route: 'comic-imagegen'});
  assert.throws(() => validateVisualDirectionReview(review, {shots: matchingV2Shots(review)}), /incompatible|comic/i);
});

test('v3 accepts only machine scene_class values', () => {
  const review = buildV3Review({eligible: false, route: 'imagegen'});
  review.rows[0].scene_class = '叙事插画';
  review.presented_map_sha256 = buildPresentedMapSha256(review);
  review.rows[0].user_selection.presented_map_sha256 = review.presented_map_sha256;
  assert.throws(() => validateVisualDirectionReview(review, {shots: matchingV2Shots(review)}), /scene_class/i);
});

test('approved v3 rows cannot retain needs-confirmation visible text', () => {
  const review = buildV3Review({eligible: false, route: 'imagegen', visibleTextMode: 'needs-confirmation'});
  assert.throws(() => validateVisualDirectionReview(review, {shots: matchingV2Shots(review)}), /visible.text.*none.*required/i);
});

test('v3 white-cat ordinary imagegen is text-free and forbids top titles', () => {
  const rejected = buildV3Review({
    eligible: false,
    route: 'imagegen',
    visibleTextMode: 'required',
    whiteCatPresent: true,
  });
  assert.throws(
    () => validateVisualDirectionReview(rejected, {shots: matchingV2Shots(rejected)}),
    /white-cat ordinary imagegen.*text-free.*top title/i,
  );

  const accepted = buildV3Review({
    eligible: false,
    route: 'imagegen',
    visibleTextMode: 'none',
    whiteCatPresent: true,
  });
  assert.equal(validateVisualDirectionReview(accepted, {shots: matchingV3Shots(accepted)}).result, 'pass');
});

test('v3 no-cat ordinary imagegen may keep route-approved exact raster text', () => {
  const review = buildV3Review({
    eligible: false,
    route: 'imagegen',
    visibleTextMode: 'required',
    whiteCatPresent: false,
  });
  assert.equal(validateVisualDirectionReview(review, {shots: matchingV3Shots(review)}).result, 'pass');
});

test('v3 accepts text-free xuan-paper-diorama for narrative shots with or without the white cat', () => {
  for (const whiteCatPresent of [true, false]) {
    const review = buildV3Review({
      eligible: false,
      route: 'xuan-paper-diorama',
      visibleTextMode: 'none',
      whiteCatPresent,
    });
    assert.equal(validateVisualDirectionReview(review, {shots: matchingV3Shots(review)}).result, 'pass');
  }
});

test('v3 xuan-paper-diorama is text-free', () => {
  const review = buildV3Review({
    eligible: false,
    route: 'xuan-paper-diorama',
    visibleTextMode: 'required',
    whiteCatPresent: false,
  });
  assert.throws(
    () => validateVisualDirectionReview(review, {shots: matchingV3Shots(review)}),
    /xuan-paper-diorama.*text-free/i,
  );
});

test('v3 rejects retired Comic before applying its legacy text contract', () => {
  const review = buildV3Review({
    eligible: true,
    route: 'comic-imagegen',
    visibleTextMode: 'required',
    whiteCatPresent: false,
  });
  assert.throws(
    () => validateVisualDirectionReview(review, {shots: matchingV2Shots(review)}),
    /comic-imagegen.*retired/i,
  );
});

test('route catalog keeps non-white-cat routes on their independent visible-text contracts', () => {
  assert.equal(resolveRouteVisibleTextPolicy({
    visual_generation_route: 'imagegen',
    white_cat_present: true,
  }).visible_text_policy, 'text-free-v1');
  assert.equal(resolveRouteVisibleTextPolicy({
    visual_generation_route: 'imagegen',
    white_cat_present: false,
  }).visible_text_policy, 'approved-raster-v1');
  assert.equal(resolveRouteVisibleTextPolicy({
    visual_generation_route: 'xuan-paper-diorama',
    white_cat_present: false,
  }).visible_text_policy, 'text-free-v1');
  assert.equal(resolveRouteVisibleTextPolicy({
    visual_generation_route: 'comic-imagegen',
    white_cat_present: true,
  }).visible_text_policy, 'text-free-v1');
  assert.equal(resolveRouteVisibleTextPolicy({
    visual_generation_route: 'ian-handdrawn-ppt',
    white_cat_present: false,
  }).visible_text_policy, 'approved-exact-text-raster-v1');
  assert.equal(resolveRouteVisibleTextPolicy({
    visual_generation_route: 'doodle-slides',
    white_cat_present: false,
  }).visible_text_policy, 'approved-exact-text-raster-v1');
  assert.equal(resolveRouteVisibleTextPolicy({
    visual_generation_route: 'srt-whiteboard-animation',
    white_cat_present: false,
  }).visible_text_policy, 'whiteboard-annotation-v2');
});
