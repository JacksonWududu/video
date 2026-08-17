import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  VISUAL_LANGUAGE_CATALOG,
  VISUAL_LANGUAGE_CATALOG_CHECKSUM_SHA256,
  validateComicShotPlan,
  validateVisualLanguageSelection,
} from '../visual-language/contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_BYTES = fs.readFileSync(path.join(HERE, 'catalog.json'));
export const CATALOG = JSON.parse(CATALOG_BYTES);
export const CATALOG_CHECKSUM_SHA256 = crypto.createHash('sha256').update(CATALOG_BYTES).digest('hex');
export const ROUTE_IDS = Object.freeze(CATALOG.routes.map((route) => route.route_id));
export const RETIRED_ROUTE_IDS = Object.freeze(['comic-imagegen', 'doodle-slides']);
export const ACTIVE_ROUTE_IDS = Object.freeze(
  ROUTE_IDS.filter((routeId) => !RETIRED_ROUTE_IDS.includes(routeId)),
);
export const XUAN_PAPER_DIORAMA_ROUTE_ID = 'xuan-paper-diorama';
export const INK_DOODLE_KNOWLEDGE_CARD_ROUTE_ID = 'ink-doodle-knowledge-card';
const ROUTES_BY_ID = new Map(CATALOG.routes.map((route) => [route.route_id, route]));

export const LEGACY_CATALOG_VERSION = 'visual-generation-route-catalog-v1';
export const LEGACY_CATALOG_CHECKSUM_SHA256 = '4cb3f5b4c90aa98192eb82c12e37a3594cb38878f8fb9c179f8344ca954198d4';
const LEGACY_ROUTE_IDS = Object.freeze([
  'imagegen',
  'ian-handdrawn-ppt',
  'doodle-slides',
  'srt-whiteboard-animation',
]);
const LEGACY_V2_ROUTE_IDS = Object.freeze([
  'imagegen',
  'comic-imagegen',
  'ian-handdrawn-ppt',
  'doodle-slides',
  'srt-whiteboard-animation',
]);
export const LEGACY_V2_CATALOG_CHECKSUM_SHA256 = '9bf0d8b38002ae4e5e441a148eaa73f900937ba178dd2b777be764f68c4abca8';
export const LEGACY_V2_VISUAL_LANGUAGE_CATALOG_CHECKSUM_SHA256 = 'a267bf4254fdc8bad1e1217dc50deb4417fe0606776159943b4439de72e9b255';

const SHA256 = /^[a-f0-9]{64}$/;
const GENERIC_AUTHORIZATION = new Set([
  '继续', '默认', '你看着办', '确认分镜', '批准分镜', '确认storyboard',
  'storyboard review', '按推荐来', '照推荐', '好的', '可以', '行', '都行',
  '随便', 'ok', 'okay',
]);
const SCENE_CLASSES = new Set(['narrative_illustration', 'structured_graphic']);
const STRUCTURED_KINDS = new Set(CATALOG.structured_visual_kinds);

const requireNonEmptyString = (value, label) => {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string`);
  return value;
};
const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
};
const sha256Canonical = (value) => crypto
  .createHash('sha256')
  .update(JSON.stringify(canonicalize(value)))
  .digest('hex');
const sameCanonical = (left, right) => sha256Canonical(left) === sha256Canonical(right);
const arrayEquals = (left, right) => Array.isArray(left)
  && left.length === right.length
  && left.every((value, index) => value === right[index]);

const isV2 = (review) => [
  'per-shot-visual-direction-review-v2',
  'per-shot-visual-direction-review-v3',
].includes(review?.contract_version);
const isV3 = (review) => review?.contract_version === 'per-shot-visual-direction-review-v3';
const presentedRow = (row, version2, version3) => ({
  shot_id: row.shot_id,
  scene_class: row.scene_class,
  structured_visual_kind: row.structured_visual_kind ?? null,
  factual_identity: row.factual_identity,
  white_cat_recommendation: row.white_cat_recommendation,
  cat_removal_revision: row.cat_removal_revision ?? null,
  cat_addition_review: row.cat_addition_review ?? null,
  ...(version2 ? {
    visual_language_recommendation: row.visual_language_recommendation,
    comic_eligibility: row.comic_eligibility,
    comic_plan_candidate: row.comic_plan_candidate ?? null,
  } : {}),
  ...(version3 ? {
    visible_text_mode: row.visible_text_mode,
    exact_visible_text: row.exact_visible_text ?? null,
    visible_text_placement: row.visible_text_placement ?? null,
    ...(row.merge_visual_inheritance ? {
      merge_visual_inheritance: row.merge_visual_inheritance,
    } : {}),
    ...(row.presented_candidate_selection ? {
      presented_candidate_selection: row.presented_candidate_selection,
    } : {}),
  } : {}),
  compatible_routes: row.compatible_routes,
  incompatible_routes: row.incompatible_routes,
  incompatible_route_reasons: row.incompatible_route_reasons,
  recommended_route: row.recommended_route,
  recommendation_reason: row.recommendation_reason,
});

export const buildPresentedMapSha256 = (review) => sha256Canonical({
  contract_version: review?.contract_version,
  catalog_version: review?.catalog_version,
  catalog_checksum_sha256: review?.catalog_checksum_sha256,
  ...(isV2(review) ? {
    visual_language_catalog_version: review?.visual_language_catalog_version,
    visual_language_catalog_checksum_sha256: review?.visual_language_catalog_checksum_sha256,
  } : {}),
  storyboard: review?.storyboard,
  rows: Array.isArray(review?.rows)
    ? review.rows.map((row) => presentedRow(row, isV2(review), isV3(review)))
    : review?.rows,
});

const validateKnownRoutes = (routes, label, routeIds) => {
  if (!Array.isArray(routes) || routes.length === 0) throw new Error(`${label} must list at least one route`);
  if (new Set(routes).size !== routes.length) throw new Error(`${label} contains duplicate routes`);
  for (const route of routes) {
    if (!routeIds.includes(route)) throw new Error(`${label} contains unknown route: ${route}`);
  }
};

const expectedCompatibleRoutes = (row, whiteCatPresent, version2, version3) => {
  if (!version2) {
    if (whiteCatPresent) return ['imagegen'];
    return row.scene_class === 'structured_graphic'
      ? ['ian-handdrawn-ppt', 'doodle-slides', 'srt-whiteboard-animation']
      : ['imagegen', 'srt-whiteboard-animation'];
  }
  if (row.scene_class === 'structured_graphic') {
    return version3
      ? ['ian-handdrawn-ppt', INK_DOODLE_KNOWLEDGE_CARD_ROUTE_ID, 'srt-whiteboard-animation']
      : ['ian-handdrawn-ppt', 'doodle-slides', 'srt-whiteboard-animation'];
  }
  if (version3) return whiteCatPresent
    ? ['imagegen', XUAN_PAPER_DIORAMA_ROUTE_ID]
    : ['imagegen', XUAN_PAPER_DIORAMA_ROUTE_ID, 'srt-whiteboard-animation'];
  const comicEligible = row?.comic_eligibility?.eligible === true;
  if (whiteCatPresent) return comicEligible ? ['imagegen', 'comic-imagegen'] : ['imagegen'];
  return comicEligible
    ? ['imagegen', 'comic-imagegen', 'srt-whiteboard-animation']
    : ['imagegen', 'srt-whiteboard-animation'];
};

const expectedRecommendedRoute = (row, whiteCatPresent, version2, version3) => {
  if (!whiteCatPresent && row.scene_class === 'structured_graphic') return 'ian-handdrawn-ppt';
  if (version2 && !version3 && row?.comic_eligibility?.eligible === true
    && row.comic_eligibility.recommend_comic_route === true) return 'comic-imagegen';
  return 'imagegen';
};

const validateClassificationAndIdentity = (row) => {
  requireNonEmptyString(row?.shot_id, 'visual direction shot_id');
  if (row.shot_id === 'OPEN-00') throw new Error('OPEN-00 is fixed cover-only-v1 and must not enter visual direction review');
  if (!SCENE_CLASSES.has(row?.scene_class)) throw new Error(`${row.shot_id} has unsupported scene_class`);
  if (row.scene_class === 'structured_graphic') {
    if (!STRUCTURED_KINDS.has(row.structured_visual_kind)) {
      throw new Error(`${row.shot_id} structured graphic requires a supported structured_visual_kind`);
    }
  } else if (row.structured_visual_kind !== null && row.structured_visual_kind !== undefined) {
    throw new Error(`${row.shot_id} narrative illustration must not declare structured_visual_kind`);
  }
  if (typeof row?.white_cat_recommendation?.recommended !== 'boolean') {
    throw new Error(`${row.shot_id} requires a white-cat recommendation`);
  }
  requireNonEmptyString(row.white_cat_recommendation.rationale, `${row.shot_id} white-cat rationale`);
  if (typeof row?.factual_identity?.contains_real_or_historical_subject !== 'boolean'
    || typeof row?.factual_identity?.white_cat_replaces_factual_identity !== 'boolean') {
    throw new Error(`${row.shot_id} requires factual identity evidence`);
  }
  if (row.factual_identity.white_cat_replaces_factual_identity) {
    throw new Error(`${row.shot_id} white cat must not replace a factual identity`);
  }
};

const validateV2LanguageAndComicPresentation = (row, version3) => {
  requireNonEmptyString(
    row?.visual_language_recommendation?.visual_structure_id,
    `${row.shot_id} recommended visual_structure_id`,
  );
  requireNonEmptyString(
    row?.visual_language_recommendation?.treatment_profile_id,
    `${row.shot_id} recommended treatment_profile_id`,
  );
  if (typeof row?.comic_eligibility?.eligible !== 'boolean'
    || typeof row?.comic_eligibility?.recommend_comic_route !== 'boolean'
    || !Array.isArray(row?.comic_eligibility?.reasons)
    || row.comic_eligibility.reasons.length === 0) {
    throw new Error(`${row.shot_id} requires explicit comic eligibility evidence`);
  }
  if (row.scene_class === 'structured_graphic' && row.comic_eligibility.eligible) {
    throw new Error(`${row.shot_id} structured graphics are never comic-imagegen eligible`);
  }
  if (row.comic_eligibility.recommend_comic_route && !row.comic_eligibility.eligible) {
    throw new Error(`${row.shot_id} cannot recommend an ineligible comic route`);
  }
  if (row.comic_eligibility.eligible && row.comic_plan_candidate === null) {
    throw new Error(`${row.shot_id} eligible comic route requires a presented comic plan candidate`);
  }
  if (!row.comic_eligibility.eligible && row.comic_plan_candidate !== null) {
    throw new Error(`${row.shot_id} ineligible comic route must not present a comic plan`);
  }
  if (version3 && (row.comic_eligibility.eligible
    || row.comic_eligibility.recommend_comic_route
    || row.comic_plan_candidate !== null)) {
    throw new Error(`${row.shot_id} comic-imagegen is retired for new or modified v3 work`);
  }
};

const validateV3VisibleText = (row) => {
  if (!['none', 'required'].includes(row.visible_text_mode)) {
    throw new Error(`${row.shot_id} approved v3 visible text mode must be none or required`);
  }
  if (row.visible_text_mode === 'none') {
    if (row.exact_visible_text !== null || row.visible_text_placement !== null) {
      throw new Error(`${row.shot_id} visible text none requires null exact copy and placement`);
    }
  } else {
    requireNonEmptyString(row.exact_visible_text, `${row.shot_id} exact visible text`);
    requireNonEmptyString(row.visible_text_placement, `${row.shot_id} visible text placement`);
  }
};

export const resolveRouteVisibleTextPolicy = ({visual_generation_route: routeId, white_cat_present: whiteCatPresent}) => {
  const route = ROUTES_BY_ID.get(routeId);
  if (!route) throw new Error(`unknown visual generation route: ${routeId}`);
  const visibleTextPolicy = routeId === 'imagegen' && whiteCatPresent === true
    ? route.white_cat_visible_text_policy
    : (routeId === 'srt-whiteboard-animation' ? 'whiteboard-annotation-v2' : route.visible_text_policy);
  if (typeof visibleTextPolicy !== 'string' || visibleTextPolicy === '') {
    throw new Error(`${routeId} lacks a visible-text policy`);
  }
  if (route.assembly_text_policy !== 'asset-owned-no-timeline-overlay-v1') {
    throw new Error(`${routeId} lacks the asset-owned assembly text policy`);
  }
  return {
    visible_text_policy: visibleTextPolicy,
    assembly_text_policy: route.assembly_text_policy,
  };
};

const validateRouteResolvedVisibleText = (row, selection) => {
  const policy = resolveRouteVisibleTextPolicy(selection);
  if (policy.visible_text_policy === 'text-free-v1' && row.visible_text_mode !== 'none') {
    if (selection.visual_generation_route === 'imagegen' && selection.white_cat_present === true) {
      throw new Error(`${row.shot_id} white-cat ordinary imagegen must be text-free and cannot use a top title`);
    }
    throw new Error(`${row.shot_id} ${selection.visual_generation_route} must be text-free`);
  }
  return policy;
};

const validateRow = (row, presentedMapSha256, version2, version3) => {
  validateClassificationAndIdentity(row);
  const routeIds = version3 ? ACTIVE_ROUTE_IDS : (version2 ? LEGACY_V2_ROUTE_IDS : LEGACY_ROUTE_IDS);
  if (version3 && RETIRED_ROUTE_IDS.includes(row?.user_selection?.visual_generation_route)) {
    throw new Error(`${row.shot_id} ${row.user_selection.visual_generation_route} is retired for new or modified v3 work`);
  }
  if (version2) validateV2LanguageAndComicPresentation(row, version3);
  if (version3) validateV3VisibleText(row);

  validateKnownRoutes(row.compatible_routes, `${row.shot_id} compatible_routes`, routeIds);
  if (!Array.isArray(row.incompatible_routes)) throw new Error(`${row.shot_id} incompatible_routes must be an array`);
  for (const route of row.incompatible_routes) {
    if (!routeIds.includes(route)) throw new Error(`${row.shot_id} incompatible_routes contains unknown route: ${route}`);
  }
  if (!row.incompatible_route_reasons || typeof row.incompatible_route_reasons !== 'object'
    || Array.isArray(row.incompatible_route_reasons)) {
    throw new Error(`${row.shot_id} incompatible route reasons are required`);
  }
  const reasonRoutes = Object.keys(row.incompatible_route_reasons);
  if (reasonRoutes.length !== row.incompatible_routes.length
    || reasonRoutes.some((route) => !row.incompatible_routes.includes(route))) {
    throw new Error(`${row.shot_id} incompatible route reasons must cover exactly every incompatible route`);
  }
  for (const route of row.incompatible_routes) {
    requireNonEmptyString(row.incompatible_route_reasons[route], `${row.shot_id} incompatible route reason for ${route}`);
  }
  if (!routeIds.includes(row.recommended_route)) throw new Error(`${row.shot_id} has unknown route: ${row.recommended_route}`);
  if (!row.compatible_routes.includes(row.recommended_route)) throw new Error(`${row.shot_id} recommended route is not compatible`);
  requireNonEmptyString(row.recommendation_reason, `${row.shot_id} route recommendation reason`);

  const selection = row.user_selection;
  if (selection?.status !== 'approved') throw new Error(`${row.shot_id} requires an explicit approved selection`);
  if (typeof selection.white_cat_present !== 'boolean') throw new Error(`${row.shot_id} requires an explicit white-cat selection`);
  if (!routeIds.includes(selection.visual_generation_route)) {
    throw new Error(`${row.shot_id} has unknown route: ${selection.visual_generation_route}`);
  }
  if (selection.white_cat_present
    && ![
      'imagegen',
      ...(version3 ? [XUAN_PAPER_DIORAMA_ROUTE_ID] : []),
      ...(version2 && !version3 ? ['comic-imagegen'] : []),
    ].includes(selection.visual_generation_route)) {
    throw new Error(`${row.shot_id} white cat requires an approved imagegen-backed route`);
  }
  if (row.white_cat_recommendation.recommended && !selection.white_cat_present) {
    const revision = row.cat_removal_revision;
    if (revision?.status !== 'rewritten_and_represented'
      || revision?.narration_semantics_unchanged !== true
      || revision?.visual_description_rewritten !== true
      || revision?.compatibility_recomputed !== true) {
      throw new Error(`${row.shot_id} cat removal requires visual rewrite, unchanged narration semantics, compatibility recomputation, and re-presentation`);
    }
  }
  if (!row.white_cat_recommendation.recommended && selection.white_cat_present) {
    const addition = row.cat_addition_review;
    if (addition?.status !== 'recomputed_and_represented'
      || addition?.semantic_necessity_passed !== true
      || addition?.factual_identity_check_passed !== true) {
      throw new Error(`${row.shot_id} cat addition requires semantic necessity, factual identity review, and re-presentation`);
    }
  }
  const expectedRoutes = expectedCompatibleRoutes(row, selection.white_cat_present, version2, version3);
  if (!arrayEquals(row.compatible_routes, expectedRoutes)) {
    if ([INK_DOODLE_KNOWLEDGE_CARD_ROUTE_ID, 'doodle-slides']
      .includes(selection.visual_generation_route)) {
      throw new Error(`${row.shot_id} ink/Doodle routes are compatible only with a no-cat structured graphic`);
    }
    throw new Error(`${row.shot_id} compatible routes do not match its cat, comic eligibility, and scene classification`);
  }
  const expectedIncompatible = routeIds.filter((route) => !expectedRoutes.includes(route));
  if (!arrayEquals(row.incompatible_routes, expectedIncompatible)) {
    throw new Error(`${row.shot_id} incompatible routes are incomplete or out of catalog order`);
  }
  if (!row.compatible_routes.includes(selection.visual_generation_route)) {
    throw new Error(`${row.shot_id} selected route is incompatible`);
  }
  const expectedRecommendation = expectedRecommendedRoute(row, selection.white_cat_present, version2, version3);
  if (row.recommended_route !== expectedRecommendation) {
    throw new Error(`${row.shot_id} default route recommendation changed unexpectedly`);
  }

  if (version2) {
    requireNonEmptyString(selection.visual_structure_id, `${row.shot_id} selected visual_structure_id`);
    requireNonEmptyString(selection.treatment_profile_id, `${row.shot_id} selected treatment_profile_id`);
    if (row.comic_eligibility.eligible) {
      validateComicShotPlan(row.comic_plan_candidate, {
        sceneClass: row.scene_class,
        visualStructureId: row.visual_language_recommendation.visual_structure_id,
        treatmentProfileId: row.visual_language_recommendation.treatment_profile_id,
        whiteCatPresent: selection.white_cat_present,
        requireApprovedCharacterReference: false,
      });
    }
    if (selection.visual_generation_route === 'comic-imagegen') {
      if (!row.comic_eligibility.eligible || !sameCanonical(selection.comic_plan, row.comic_plan_candidate)) {
        throw new Error(`${row.shot_id} comic route lacks the exact presented eligible comic plan`);
      }
    } else if (selection.comic_plan !== null) {
      throw new Error(`${row.shot_id} non-comic route must not lock a comic plan`);
    }
    validateVisualLanguageSelection({
      scene_class: row.scene_class,
      visual_structure_id: selection.visual_structure_id,
      treatment_profile_id: selection.treatment_profile_id,
      visual_generation_route: selection.visual_generation_route,
      white_cat_present: selection.white_cat_present,
      comic_plan: selection.comic_plan,
    }, {requireApprovedCharacterReference: false});
  }
  if (version3) {
    if (selection.visible_text_mode !== row.visible_text_mode
      || (selection.exact_visible_text ?? null) !== (row.exact_visible_text ?? null)
      || (selection.visible_text_placement ?? null) !== (row.visible_text_placement ?? null)) {
      throw new Error(`${row.shot_id} visible text selection must equal the exact presented decision`);
    }
    validateRouteResolvedVisibleText(row, selection);
  }

  const exactMessage = requireNonEmptyString(selection.exact_message, `${row.shot_id} exact selection message`);
  if (GENERIC_AUTHORIZATION.has(exactMessage.trim().toLowerCase())) {
    throw new Error(`${row.shot_id} generic authorization is not a visual direction selection`);
  }
  if (exactMessage.trim() === '确认全部推荐'
    && (selection.white_cat_present !== row.white_cat_recommendation.recommended
      || selection.visual_generation_route !== row.recommended_route
      || (version2 && (
        selection.visual_structure_id !== row.visual_language_recommendation.visual_structure_id
        || selection.treatment_profile_id !== row.visual_language_recommendation.treatment_profile_id
      )))) {
    throw new Error(`${row.shot_id} confirm all recommendations must select the recommended route and every recommended visual decision`);
  }
  requireNonEmptyString(selection.decided_at, `${row.shot_id} selection time`);
  if (selection.presented_map_sha256 !== presentedMapSha256) {
    throw new Error(`${row.shot_id} selection is bound to a stale presented map`);
  }
};

const validateReviewAuthority = (review) => {
  const version2 = isV2(review);
  if (!version2 && review.contract_version !== 'per-shot-visual-direction-review-v1') {
    throw new Error('unsupported visual direction review contract');
  }
  if (version2) {
    const currentAuthority = review.catalog_version === CATALOG.schema_version
      && review.catalog_checksum_sha256 === CATALOG_CHECKSUM_SHA256
      && review.visual_language_catalog_version === VISUAL_LANGUAGE_CATALOG.schema_version
      && review.visual_language_catalog_checksum_sha256 === VISUAL_LANGUAGE_CATALOG_CHECKSUM_SHA256;
    const legacyV2Authority = review.contract_version === 'per-shot-visual-direction-review-v2'
      && review.catalog_version === 'visual-generation-route-catalog-v2'
      && review.catalog_checksum_sha256 === LEGACY_V2_CATALOG_CHECKSUM_SHA256
      && review.visual_language_catalog_version === 'visual-language-catalog-v1'
      && review.visual_language_catalog_checksum_sha256 === LEGACY_V2_VISUAL_LANGUAGE_CATALOG_CHECKSUM_SHA256;
    if (!currentAuthority && !legacyV2Authority) {
      throw new Error('visual route catalog version or checksum mismatch');
    }
  } else if (review.catalog_version !== LEGACY_CATALOG_VERSION
    || review.catalog_checksum_sha256 !== LEGACY_CATALOG_CHECKSUM_SHA256) {
    throw new Error('legacy visual route catalog checksum mismatch or unsupported version');
  }
  return version2;
};

export const validateVisualDirectionReview = (review, {shots = []} = {}) => {
  if (!review || typeof review !== 'object') throw new Error('visual direction review object required');
  const version2 = validateReviewAuthority(review);
  requireNonEmptyString(review?.storyboard?.path, 'visual direction storyboard path');
  if (!SHA256.test(review?.storyboard?.checksum_sha256 ?? '')) throw new Error('visual direction storyboard checksum is invalid');
  if (typeof review?.presentation?.presented_at !== 'string' || review.presentation.presented_at.trim() === ''
    || typeof review?.presentation?.exact_message !== 'string' || review.presentation.exact_message.trim() === '') {
    throw new Error('complete visual direction table presentation evidence is required');
  }
  if (review.status !== 'approved') throw new Error('visual direction review must be approved');
  if (!Array.isArray(review.rows) || review.rows.length === 0) throw new Error('visual direction review rows are required');
  if (review.generated_shot_count !== review.rows.length) throw new Error('visual direction generated shot count mismatch');
  if (!SHA256.test(review.presented_map_sha256 ?? '')
    || review.presented_map_sha256 !== buildPresentedMapSha256(review)) {
    throw new Error('visual direction presented map checksum mismatch');
  }
  const ids = new Set();
  for (const row of review.rows) {
    if (ids.has(row.shot_id)) throw new Error(`duplicate visual direction row: ${row.shot_id}`);
    ids.add(row.shot_id);
    validateRow(row, review.presented_map_sha256, version2, isV3(review));
  }
  if (!Array.isArray(shots) || shots.length !== review.rows.length) {
    throw new Error('visual direction review must cover every generated shot exactly once');
  }
  shots.forEach((shot, index) => {
    const row = review.rows[index];
    const selection = row.user_selection;
    if (shot.shot_id !== row.shot_id) throw new Error('visual direction shot order mismatch');
    if (shot.scene_class !== row.scene_class
      || (shot.structured_visual_kind ?? null) !== (row.structured_visual_kind ?? null)) {
      throw new Error(`${shot.shot_id} scene classification mismatch`);
    }
    if (shot.white_cat_present !== selection.white_cat_present) throw new Error(`${shot.shot_id} white-cat choice mismatch`);
    if (shot.visual_generation_route !== selection.visual_generation_route) throw new Error(`${shot.shot_id} route mismatch`);
    if (version2 && (
      shot.visual_structure_id !== selection.visual_structure_id
      || shot.treatment_profile_id !== selection.treatment_profile_id
      || !sameCanonical(shot.comic_plan ?? null, selection.comic_plan ?? null)
    )) throw new Error(`${shot.shot_id} visual language or comic plan mismatch`);
    if (isV3(review) && (
      shot.visible_text_mode !== selection.visible_text_mode
      || (shot.exact_visible_text ?? null) !== (selection.exact_visible_text ?? null)
      || (shot.visible_text_placement ?? null) !== (selection.visible_text_placement ?? null)
    )) throw new Error(`${shot.shot_id} visible text decision mismatch`);
  });
  return {
    result: 'pass',
    status: 'approved',
    contract_version: review.contract_version,
    catalog_version: review.catalog_version,
    catalog_checksum_sha256: review.catalog_checksum_sha256,
    ...(version2 ? {
      visual_language_catalog_version: review.visual_language_catalog_version,
      visual_language_catalog_checksum_sha256: review.visual_language_catalog_checksum_sha256,
    } : {}),
    presented_map_sha256: review.presented_map_sha256,
    generated_shot_count: review.generated_shot_count,
  };
};

export const validateVisualDirectionArtifactPolicy = (review, policy = {}) => {
  if (!review || typeof review !== 'object') throw new Error('visual direction review object required');
  const modifiedShotIds = policy.modified_shot_ids;
  if (!Array.isArray(modifiedShotIds)
    || modifiedShotIds.some((shotId) => typeof shotId !== 'string' || shotId.trim() === '')) {
    throw new Error('visual direction artifact policy requires modified_shot_ids');
  }
  if (isV3(review)) {
    if (policy.artifact_mode !== 'current_v3') {
      throw new Error('new or modified visual direction artifacts must use current_v3');
    }
    return {
      result: 'pass',
      artifact_mode: 'current_v3',
      contract_version: review.contract_version,
      modified_shot_ids: [...modifiedShotIds],
    };
  }
  if (!['per-shot-visual-direction-review-v1', 'per-shot-visual-direction-review-v2']
    .includes(review.contract_version)) {
    throw new Error('unsupported visual direction review contract');
  }
  if (policy.artifact_mode !== 'legacy_read_only'
    || policy.episode_completed !== true
    || modifiedShotIds.length !== 0) {
    throw new Error('v1/v2 visual direction evidence is legacy read-only; any reopened shot requires v3');
  }
  return {
    result: 'pass',
    artifact_mode: 'legacy_read_only',
    contract_version: review.contract_version,
    modified_shot_ids: [],
  };
};
