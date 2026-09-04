import {FLIPBOOK_STYLE_ID, FLIPBOOK_TRANSITION_KIND, FLIPBOOK_RENDERER} from '../flipbook-video/profile.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const TRANSITION_KINDS = Object.freeze([
  'dissolve',
  'paper-wipe',
  'watercolor-bloom',
  'match-cut',
]);

export const LEGACY_SCENE_TRANSITION_CATALOG_VERSION = 'scene-transition-catalog-v2';
export const SCENE_TRANSITION_CATALOG_VERSION = 'scene-transition-catalog-v3';

export const LEGACY_TRANSITION_CATALOG = Object.freeze([
  {kind: 'cut', label: '直接切', family: 'structural', required_options: []},
  {kind: 'dissolve', label: '溶解', family: 'shared-custom', required_options: []},
  {kind: 'paper-wipe', label: '纸张擦除', family: 'shared-custom', required_options: []},
  {kind: 'watercolor-bloom', label: '水彩晕染', family: 'shared-custom', required_options: []},
  {kind: 'match-cut', label: '匹配剪辑', family: 'shared-custom', required_options: []},
  {kind: 'fade', label: '淡入淡出', family: 'remotion', required_options: []},
  {kind: 'slide', label: '滑动', family: 'remotion', required_options: ['direction']},
  {kind: 'wipe', label: '擦除', family: 'remotion', required_options: ['direction']},
  {kind: 'flip', label: '翻转', family: 'remotion', required_options: ['direction']},
  {kind: 'clock-wipe', label: '时钟擦除', family: 'remotion', required_options: []},
  {kind: 'iris', label: '光圈', family: 'remotion', required_options: []},
  {kind: 'linear-blur', label: '线性模糊', family: 'remotion', required_options: []},
  {kind: 'zoom-blur', label: '缩放模糊', family: 'remotion', required_options: []},
].map((entry) => Object.freeze(entry)));

export const RETIRED_TRANSITION_KINDS_V3 = Object.freeze([
  'zoom-blur',
  'flip',
  'slide',
  'clock-wipe',
]);

const RETIRED_TRANSITION_KIND_SET_V3 = new Set(RETIRED_TRANSITION_KINDS_V3);

export const TRANSITION_CATALOG = Object.freeze(
  [...LEGACY_TRANSITION_CATALOG.filter((entry) => !RETIRED_TRANSITION_KIND_SET_V3.has(entry.kind)),
    Object.freeze({kind: FLIPBOOK_TRANSITION_KIND, label: '书页翻动', family: 'flipbook-browser', required_options: []})],
);

export const TRANSITION_KINDS_V2 = Object.freeze(
  LEGACY_TRANSITION_CATALOG.filter((entry) => entry.kind !== 'cut').map((entry) => entry.kind),
);

export const TRANSITION_KINDS_V3 = Object.freeze(
  TRANSITION_CATALOG.map((entry) => entry.kind),
);

export const BOUNDARY_CHANGE_CLASSES = Object.freeze([
  'continuity',
  'match_continuity',
  'section_change',
  'route_change',
  'time_place_change',
  'contrast_or_warning',
]);

export const TRANSITION_RECOMMENDATION_DIVERSITY_RULE_ID =
  'scene-transition-recommendation-diversity-v2';
export const WHITE_CAT_TRANSITION_RECOMMENDATION_RULE_ID =
  'imagegen-white-cat-watercolor-bloom-priority-v1';
export const TWILIGHT_WHITE_CAT_TRANSITION_RECOMMENDATION_RULE_ID =
  'imagegen-white-cat-twilight-dissolve-priority-v1';
export const GILDED_WHITE_CAT_TRANSITION_RECOMMENDATION_RULE_ID =
  'imagegen-white-cat-gilded-dissolve-priority-v1';
const WHITE_CAT_VISUAL_STYLE_IDS = new Set([
  FLIPBOOK_STYLE_ID,
  'loose-line-vivid-watercolor',
  'twilight-neon-animation',
  'gilded-mythic-storybook',
  'cover-derived-episode-style',
]);

const DIVERSITY_CANDIDATES = Object.freeze({
  continuity: [{kind: 'cut', options: {}}],
  match_continuity: [
    {kind: 'match-cut', options: {}},
    {kind: 'dissolve', options: {}},
    {kind: 'iris', options: {}},
    {kind: 'linear-blur', options: {}},
  ],
  section_change: [
    {kind: 'dissolve', options: {}},
    {kind: 'fade', options: {}},
    {kind: 'iris', options: {}},
    {kind: 'linear-blur', options: {}},
  ],
  route_change: [
    {kind: 'paper-wipe', options: {}},
    {kind: 'wipe', options: {direction: 'from-left'}},
    {kind: 'linear-blur', options: {}},
    {kind: 'iris', options: {}},
  ],
  time_place_change: [
    {kind: 'fade', options: {}},
    {kind: 'dissolve', options: {}},
    {kind: 'iris', options: {}},
    {kind: 'linear-blur', options: {}},
  ],
  contrast_or_warning: [
    {kind: 'wipe', options: {direction: 'from-left'}},
    {kind: 'linear-blur', options: {}},
    {kind: 'iris', options: {}},
    {kind: 'dissolve', options: {}},
  ],
});

const DIRECTIONAL_KINDS = new Set(['slide', 'wipe']);
const CARDINAL_DIRECTIONS = new Set(['from-left', 'from-right', 'from-top', 'from-bottom']);
const FLIP_DIRECTIONS = new Set(['horizontal', 'vertical']);
const SHA256 = /^[a-f0-9]{64}$/;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROUTE_CATALOG = JSON.parse(fs.readFileSync(
  path.join(HERE, '../visual-generation-routes/catalog.json'),
  'utf8',
));
const ROUTE_TRANSITION_RECOMMENDATIONS = JSON.parse(fs.readFileSync(
  path.join(HERE, '../visual-generation-routes/transition-recommendations.json'),
  'utf8',
));
const ROUTES_BY_ID = new Map(ROUTE_CATALOG.routes.map((route) => [route.route_id, route]));
const SHARED_FALLBACK_RULE_ID = ROUTE_TRANSITION_RECOMMENDATIONS.shared_fallback_rule_id;

const validateOptions = (kind, options) => {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error(`transition options must be an object: ${kind}`);
  }
  const keys = Object.keys(options);
  if (DIRECTIONAL_KINDS.has(kind)) {
    if (keys.length !== 1 || !CARDINAL_DIRECTIONS.has(options.direction)) {
      throw new Error(`${kind} requires one direction: from-left, from-right, from-top, or from-bottom`);
    }
    return;
  }
  if (kind === 'flip') {
    if (keys.length !== 1 || !FLIP_DIRECTIONS.has(options.direction)) {
      throw new Error('flip requires one direction: horizontal or vertical');
    }
    return;
  }
  if (keys.length !== 0) throw new Error(`${kind} does not accept transition options`);
};

export const getRecommendedTransition = ({boundaryChangeClass, nextVisualGenerationRoute = null}) => {
  switch (boundaryChangeClass) {
    case 'continuity': return {kind: 'cut', options: {}};
    case 'match_continuity': return {kind: 'match-cut', options: {}};
    case 'section_change': return {kind: 'dissolve', options: {}};
    case 'route_change': return nextVisualGenerationRoute === 'srt-whiteboard-animation'
      ? {kind: 'wipe', options: {direction: 'from-left'}}
      : {kind: 'paper-wipe', options: {}};
    case 'time_place_change': return {kind: 'fade', options: {}};
    case 'contrast_or_warning': return {kind: 'wipe', options: {direction: 'from-left'}};
    default: throw new Error(`unsupported boundary_change_class: ${boundaryChangeClass}`);
  }
};

export const resolveTransitionRecommendation = ({
  boundaryChangeClass,
  sourceVisualGenerationRoute,
  nextVisualGenerationRoute,
  sourceWhiteCatPresent = false,
  nextWhiteCatPresent = false,
  whiteCatVisualStyleId = 'loose-line-vivid-watercolor',
}) => {
  if (typeof sourceWhiteCatPresent !== 'boolean' || typeof nextWhiteCatPresent !== 'boolean') {
    throw new Error('transition white-cat recommendation context must use booleans');
  }
  if (!WHITE_CAT_VISUAL_STYLE_IDS.has(whiteCatVisualStyleId)) {
    throw new Error('transition white-cat visual style is unsupported');
  }
  const sourceRoute = ROUTES_BY_ID.get(sourceVisualGenerationRoute);
  const nextRoute = ROUTES_BY_ID.get(nextVisualGenerationRoute);
  if (!sourceRoute) throw new Error(`unknown source visual generation route: ${sourceVisualGenerationRoute}`);
  if (!nextRoute) throw new Error(`unknown next visual generation route: ${nextVisualGenerationRoute}`);
  if (whiteCatVisualStyleId === FLIPBOOK_STYLE_ID) {
    if (sourceWhiteCatPresent || nextWhiteCatPresent
      || !['imagegen', 'ian-handdrawn-ppt'].includes(sourceVisualGenerationRoute)
      || !['imagegen', 'ian-handdrawn-ppt'].includes(nextVisualGenerationRoute)
      || !BOUNDARY_CHANGE_CLASSES.includes(boundaryChangeClass)) {
      throw new Error('flipbook transitions require two supported no-cat static spreads');
    }
    return Object.freeze({
      recommended_transition: {kind: FLIPBOOK_TRANSITION_KIND, options: {}},
      recommendation_source: {
        authority: 'visual-generation-route',
        route_id: sourceVisualGenerationRoute,
        rule_id: 'illustrated-flipbook-physical-page-turn-v1',
      },
    });
  }
  const matchingRules = ROUTE_TRANSITION_RECOMMENDATIONS.rules.filter((rule) => (
    rule.source_route === sourceVisualGenerationRoute
    && rule.boundary_change_class === boundaryChangeClass
    && (rule.next_route === undefined || rule.next_route === nextVisualGenerationRoute)
  ));
  if (matchingRules.length > 1) {
    throw new Error(`ambiguous route transition recommendation: ${sourceVisualGenerationRoute}`);
  }
  if (matchingRules.length === 1) {
    const rule = matchingRules[0];
    if (!TRANSITION_KINDS_V3.includes(rule.kind)) {
      throw new Error(`route transition recommendation uses unsupported kind: ${rule.kind}`);
    }
    validateOptions(rule.kind, rule.options);
    return Object.freeze({
      recommended_transition: {kind: rule.kind, options: {...rule.options}},
      recommendation_source: {
        authority: 'visual-generation-route',
        route_id: sourceVisualGenerationRoute,
        rule_id: rule.rule_id,
      },
    });
  }
  const matchedBoundaryRoles = [];
  if (sourceVisualGenerationRoute === 'imagegen' && sourceWhiteCatPresent) {
    matchedBoundaryRoles.push('source');
  }
  if (nextVisualGenerationRoute === 'imagegen' && nextWhiteCatPresent) {
    matchedBoundaryRoles.push('next');
  }
  if (matchedBoundaryRoles.length > 0) {
    if (whiteCatVisualStyleId === 'cover-derived-episode-style') {
      return Object.freeze({
        recommended_transition: getRecommendedTransition({
          boundaryChangeClass,
          nextVisualGenerationRoute,
        }),
        recommendation_source: {
          authority: 'shared-fallback',
          rule_id: SHARED_FALLBACK_RULE_ID,
        },
      });
    }
    const usesDissolve = [
      'twilight-neon-animation',
      'gilded-mythic-storybook',
    ].includes(whiteCatVisualStyleId);
    const ruleId = whiteCatVisualStyleId === 'twilight-neon-animation'
      ? TWILIGHT_WHITE_CAT_TRANSITION_RECOMMENDATION_RULE_ID
      : whiteCatVisualStyleId === 'gilded-mythic-storybook'
        ? GILDED_WHITE_CAT_TRANSITION_RECOMMENDATION_RULE_ID
        : WHITE_CAT_TRANSITION_RECOMMENDATION_RULE_ID;
    return Object.freeze({
      recommended_transition: {kind: usesDissolve ? 'dissolve' : 'watercolor-bloom', options: {}},
      recommendation_source: {
        authority: 'white-cat-transition-policy',
        rule_id: ruleId,
        matched_boundary_roles: matchedBoundaryRoles,
      },
    });
  }
  return Object.freeze({
    recommended_transition: getRecommendedTransition({
      boundaryChangeClass,
      nextVisualGenerationRoute,
    }),
    recommendation_source: {
      authority: 'shared-fallback',
      rule_id: SHARED_FALLBACK_RULE_ID,
    },
  });
};

export const applyTransitionRecommendationDiversity = (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('transition recommendation diversity requires ordered boundary rows');
  }
  const requestedTransition = (row) => row?.user_requested_transition?.transition ?? null;
  for (const row of rows) {
    const request = row?.user_requested_transition;
    if (request === undefined) continue;
    if (!request || typeof request !== 'object' || Array.isArray(request)
      || typeof request.exact_message !== 'string' || request.exact_message.trim() === ''
      || typeof request.requested_at !== 'string' || Number.isNaN(Date.parse(request.requested_at))
      || typeof request.based_on_presented_map_sha256 !== 'string'
      || !SHA256.test(request.based_on_presented_map_sha256)
      || !request.transition || typeof request.transition !== 'object'
      || !TRANSITION_KINDS_V3.includes(request.transition.kind)) {
      throw new Error(`transition user request is invalid: ${row?.source_shot_id}`);
    }
    validateOptions(request.transition.kind, request.transition.options);
  }
  const visibleCount = rows.filter((row) => (
    (requestedTransition(row) ?? row?.recommended_transition)?.kind !== 'cut'
  )).length;
  const maxIdenticalVisibleKindAbsoluteUses = 5;
  const maxIdenticalVisibleKindShare = 0.3;
  const maxIdenticalVisibleKindShareUses = Math.floor(visibleCount * maxIdenticalVisibleKindShare);
  const maxIdenticalVisibleKindUses = visibleCount === 0
    ? 0
    : Math.min(maxIdenticalVisibleKindAbsoluteUses, maxIdenticalVisibleKindShareUses);
  const maxConsecutiveIdenticalVisibleKindUses = 3;
  const policy = Object.freeze({
    rule_id: TRANSITION_RECOMMENDATION_DIVERSITY_RULE_ID,
    applies_to: 'visible-transition-kinds-only',
    cut_exempt: true,
    visible_boundary_count: visibleCount,
    max_identical_visible_kind_uses: maxIdenticalVisibleKindUses,
    max_identical_visible_kind_absolute_uses: maxIdenticalVisibleKindAbsoluteUses,
    max_identical_visible_kind_share: maxIdenticalVisibleKindShare,
    max_identical_visible_kind_share_denominator: 'visible_boundary_count',
    max_identical_visible_kind_share_uses: maxIdenticalVisibleKindShareUses,
    max_consecutive_identical_visible_kind_uses: maxConsecutiveIdenticalVisibleKindUses,
    route_specific_recommendations_keep_priority: true,
    white_cat_style_bound_priority: true,
  });
  const counts = new Map();
  let previousKind = null;
  let consecutiveKindUses = 0;
  const outputRows = rows.map((row) => {
    if (!BOUNDARY_CHANGE_CLASSES.includes(row?.boundary_change_class)) {
      throw new Error(`unsupported boundary_change_class for diversity: ${row?.boundary_change_class}`);
    }
    const base = row.recommended_transition;
    if (!base || !TRANSITION_KINDS_V3.includes(base.kind)) {
      throw new Error(`transition diversity base recommendation is invalid: ${row?.source_shot_id}`);
    }
    validateOptions(base.kind, base.options);
    const request = requestedTransition(row);
    const preferred = request ?? base;
    if (row.white_cat_visual_style_id === FLIPBOOK_STYLE_ID) {
      if (preferred.kind !== FLIPBOOK_TRANSITION_KIND || base.kind !== FLIPBOOK_TRANSITION_KIND) {
        throw new Error('flipbook physical page turns cannot be replaced by diversity effects');
      }
      return {...row, proposed_transition: {...preferred, options: {}}, diversity_adjustment: {
        rule_id: TRANSITION_RECOMMENDATION_DIVERSITY_RULE_ID, applied: false,
        base_transition: {...base, options: {}}, reason: 'physical-page-turn-owned-by-flipbook-renderer',
      }};
    }
    if (preferred.kind === 'cut') {
      previousKind = null;
      consecutiveKindUses = 0;
      const adjusted = canonical(preferred) !== canonical(base);
      return {
        ...row,
        proposed_transition: {kind: preferred.kind, options: {...preferred.options}},
        diversity_adjustment: {
          rule_id: TRANSITION_RECOMMENDATION_DIVERSITY_RULE_ID,
          applied: adjusted,
          base_transition: {kind: base.kind, options: {...base.options}},
          reason: request
            ? adjusted ? 'explicit-user-request-within-diversity-limits' : 'explicit-user-request-matches-base'
            : 'cut-is-structural-and-exempt',
        },
      };
    }

    const routeSpecific = !request && row.recommendation_source?.authority === 'visual-generation-route';
    const preferredWouldExceedTotal = (counts.get(preferred.kind) ?? 0) >= maxIdenticalVisibleKindUses;
    const preferredWouldExceedConsecutive = previousKind === preferred.kind
      && consecutiveKindUses >= maxConsecutiveIdenticalVisibleKindUses;
    if (request && (preferredWouldExceedTotal || preferredWouldExceedConsecutive)) {
      throw new Error(`user-requested transition violates diversity policy: ${row?.source_shot_id}`);
    }
    if (routeSpecific && (preferredWouldExceedTotal || preferredWouldExceedConsecutive)) {
      throw new Error(
        `route-specific transition recommendation violates diversity policy: ${row?.source_shot_id}`,
      );
    }

    const semanticCandidates = DIVERSITY_CANDIDATES[row.boundary_change_class] ?? [];
    const candidates = [preferred, base, ...semanticCandidates]
      .filter((candidate, index, all) => all.findIndex((entry) => canonical(entry) === canonical(candidate)) === index)
      .map((candidate) => ({kind: candidate.kind, options: {...candidate.options}}));
    for (const candidate of candidates) {
      if (!TRANSITION_KINDS_V3.includes(candidate.kind)) {
        throw new Error(`transition diversity candidate is not registered: ${candidate.kind}`);
      }
      validateOptions(candidate.kind, candidate.options);
    }
    const preferredWithinLimits = !preferredWouldExceedTotal && !preferredWouldExceedConsecutive;
    let eligible = request || routeSpecific || preferredWithinLimits
      ? [preferred]
      : candidates.filter((candidate) => (
        candidate.kind !== preferred.kind
        && (candidate.kind !== previousKind
          || consecutiveKindUses < maxConsecutiveIdenticalVisibleKindUses)
        && (counts.get(candidate.kind) ?? 0) < maxIdenticalVisibleKindUses
      ));
    if (eligible.length === 0) {
      throw new Error(`transition diversity cannot resolve boundary: ${row?.source_shot_id}`);
    }
    const candidateOrder = new Map(candidates.map((candidate, index) => [canonical(candidate), index]));
    eligible.sort((left, right) => (
      (counts.get(left.kind) ?? 0) - (counts.get(right.kind) ?? 0)
      || candidateOrder.get(canonical(left)) - candidateOrder.get(canonical(right))
    ));
    const proposed = eligible[0];
    counts.set(proposed.kind, (counts.get(proposed.kind) ?? 0) + 1);
    consecutiveKindUses = previousKind === proposed.kind ? consecutiveKindUses + 1 : 1;
    previousKind = proposed.kind;
    const adjusted = canonical(proposed) !== canonical(base);
    return {
      ...row,
      proposed_transition: proposed,
      diversity_adjustment: {
        rule_id: TRANSITION_RECOMMENDATION_DIVERSITY_RULE_ID,
        applied: adjusted,
        base_transition: {kind: base.kind, options: {...base.options}},
        reason: request
          ? adjusted ? 'explicit-user-request-within-diversity-limits' : 'explicit-user-request-matches-base'
          : adjusted
            ? 'balanced-visible-transition-kind-frequency'
            : 'base-recommendation-within-diversity-limits',
      },
    };
  });
  return Object.freeze({policy, rows: outputRows});
};

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
};
const canonical = (value) => JSON.stringify(canonicalize(value));

export const validateUserApprovedTransition = (
  transition,
  {fps, sourceShotId, nextShotId},
) => {
  if (!transition || typeof transition !== 'object' || Array.isArray(transition)) {
    throw new Error('missing user-approved structured transition');
  }
  if (!Number.isInteger(fps) || fps <= 0) throw new Error(`invalid fps: ${fps}`);
  const version2 = transition.contract_version === 'scene-transition-v2';
  const version3 = transition.contract_version === 'scene-transition-v3';
  if (!version2 && !version3) {
    throw new Error('user-approved transition must use scene-transition-v2 or scene-transition-v3');
  }
  const expectedCatalogVersion = version3
    ? SCENE_TRANSITION_CATALOG_VERSION
    : LEGACY_SCENE_TRANSITION_CATALOG_VERSION;
  if (transition.catalog_version !== expectedCatalogVersion) {
    throw new Error('transition catalog version mismatch');
  }
  if (transition.source_shot_id !== sourceShotId) {
    throw new Error(`transition source shot mismatch: ${sourceShotId}`);
  }
  if (transition.next_shot_id !== nextShotId) {
    throw new Error(`transition next shot mismatch: ${sourceShotId}`);
  }
  if (!(version3 ? TRANSITION_KINDS_V3 : TRANSITION_KINDS_V2).includes(transition.kind)) {
    throw new Error(`unsupported transition kind: ${transition.kind}`);
  }
  validateOptions(transition.kind, transition.options);
  if (version3) {
    if (!BOUNDARY_CHANGE_CLASSES.includes(transition.boundary_change_class)) {
      throw new Error(`unsupported boundary_change_class: ${transition.boundary_change_class}`);
    }
    if (typeof transition.source_visual_generation_route !== 'string'
      || typeof transition.next_visual_generation_route !== 'string') {
      throw new Error(`transition route recommendation context is missing: ${sourceShotId}`);
    }
    if (typeof transition.source_white_cat_present !== 'boolean'
      || typeof transition.next_white_cat_present !== 'boolean') {
      throw new Error(`transition white-cat recommendation context is missing: ${sourceShotId}`);
    }
    const expectedRecommendation = resolveTransitionRecommendation({
      boundaryChangeClass: transition.boundary_change_class,
      sourceVisualGenerationRoute: transition.source_visual_generation_route,
      nextVisualGenerationRoute: transition.next_visual_generation_route,
      sourceWhiteCatPresent: transition.source_white_cat_present,
      nextWhiteCatPresent: transition.next_white_cat_present,
      whiteCatVisualStyleId:
        transition.white_cat_visual_style_id ?? 'loose-line-vivid-watercolor',
    });
    if (canonical(transition.recommended_transition)
      !== canonical(expectedRecommendation.recommended_transition)) {
      throw new Error(`transition recommendation does not match boundary_change_class: ${sourceShotId}`);
    }
    if (canonical(transition.recommendation_source)
      !== canonical(expectedRecommendation.recommendation_source)) {
      throw new Error(`transition recommendation authority is stale or spoofed: ${sourceShotId}`);
    }
    const diversity = transition.diversity_adjustment;
    if (diversity !== undefined) {
      if (diversity?.rule_id !== TRANSITION_RECOMMENDATION_DIVERSITY_RULE_ID
        || typeof diversity?.applied !== 'boolean'
        || canonical(diversity?.base_transition) !== canonical(transition.recommended_transition)
        || typeof diversity?.reason !== 'string' || diversity.reason.trim() === '') {
        throw new Error(`transition diversity adjustment is invalid: ${sourceShotId}`);
      }
      const selectedDiffersFromBase = canonical({kind: transition.kind, options: transition.options})
        !== canonical(transition.recommended_transition);
      if (selectedDiffersFromBase !== diversity.applied) {
        throw new Error(`transition diversity adjustment does not match selected kind: ${sourceShotId}`);
      }
    }
  }
  if (transition.kind === 'cut') {
    if (transition.duration_seconds !== 0 || transition.duration_in_frames !== 0
      || Object.keys(transition.options).length !== 0) {
      throw new Error(`cut must use zero seconds, zero frames, and empty options: ${sourceShotId}`);
    }
  } else if (typeof transition.duration_seconds !== 'number'
    || transition.duration_seconds < 0.3
    || transition.duration_seconds > 0.6) {
    throw new Error(`visible transitions must last 0.3–0.6 seconds: ${sourceShotId}`);
  }
  if (transition.duration_in_frames !== Math.round(transition.duration_seconds * fps)) {
    throw new Error(`transition frame mismatch: ${sourceShotId}`);
  }
  if (typeof transition.source_intent !== 'string' || transition.source_intent.trim() === '') {
    throw new Error(`transition source intent is missing: ${sourceShotId}`);
  }
  const flipbook = transition.white_cat_visual_style_id === FLIPBOOK_STYLE_ID;
  if (flipbook !== (transition.kind === FLIPBOOK_TRANSITION_KIND)) {
    throw new Error('book-page-turn is required only for the selected illustrated-flipbook style');
  }
  if (transition.renderer !== (flipbook ? FLIPBOOK_RENDERER : 'leverage-video/src/shared/scene-transitions')) {
    throw new Error(`transition renderer mismatch: ${sourceShotId}`);
  }
  const selection = transition.user_selection;
  const policyAuthorized = selection?.status === 'policy_authorized';
  if (selection?.status !== 'approved' && !policyAuthorized) {
    throw new Error(`transition user selection is neither approved nor policy-authorized: ${sourceShotId}`);
  }
  if (policyAuthorized) {
    if (!SHA256.test(selection.policy_sha256 ?? '')
      || selection.deterministic_recommendation_selected !== true
      || selection.user_has_reviewed_specific_map !== false
      || selection.exact_message !== null
      || typeof selection.authorized_at !== 'string'
      || Number.isNaN(Date.parse(selection.authorized_at))) {
      throw new Error(`transition policy authorization is invalid or fabricates review: ${sourceShotId}`);
    }
  } else {
    if (typeof selection.exact_message !== 'string' || selection.exact_message.trim() === '') {
      throw new Error(`transition user selection message is missing: ${sourceShotId}`);
    }
    if (typeof selection.decided_at !== 'string' || Number.isNaN(Date.parse(selection.decided_at))) {
      throw new Error(`transition user selection time is invalid: ${sourceShotId}`);
    }
  }
  if (typeof selection.presented_map_sha256 !== 'string'
    || !SHA256.test(selection.presented_map_sha256)) {
    throw new Error(`transition presented-map checksum is invalid: ${sourceShotId}`);
  }
  return transition;
};

const revoiceTransitionProjection = (transition) => ({
  contract_version: transition.contract_version,
  catalog_version: transition.catalog_version,
  source_shot_id: transition.source_shot_id,
  next_shot_id: transition.next_shot_id,
  boundary_change_class: transition.boundary_change_class,
  source_visual_generation_route: transition.source_visual_generation_route,
  next_visual_generation_route: transition.next_visual_generation_route,
  source_white_cat_present: transition.source_white_cat_present,
  next_white_cat_present: transition.next_white_cat_present,
  ...(transition.white_cat_visual_style_id === undefined
    ? {} : {white_cat_visual_style_id: transition.white_cat_visual_style_id}),
  recommended_transition: transition.recommended_transition,
  recommendation_source: transition.recommendation_source,
  diversity_adjustment: transition.diversity_adjustment ?? null,
  kind: transition.kind,
  options: transition.options,
  duration_seconds: transition.duration_seconds,
  duration_in_frames: transition.duration_in_frames,
  source_intent: transition.source_intent,
  renderer: transition.renderer,
  user_selection: transition.user_selection,
});

export const validateRevoiceTransitionLock = (
  parentTransition,
  derivativeTransition,
  {fps, sourceShotId, nextShotId, shotDurationFrames},
) => {
  validateUserApprovedTransition(parentTransition, {fps, sourceShotId, nextShotId});
  validateUserApprovedTransition(derivativeTransition, {fps, sourceShotId, nextShotId});
  if (canonical(revoiceTransitionProjection(parentTransition))
    !== canonical(revoiceTransitionProjection(derivativeTransition))) {
    throw new Error(`revoice must preserve parent transition kind, options, duration, frames, and approval evidence: ${sourceShotId}`);
  }
  if (!Number.isInteger(shotDurationFrames)
    || shotDurationFrames < derivativeTransition.duration_in_frames) {
    throw new Error(`revoice shot cannot fit its locked parent transition: ${sourceShotId}`);
  }
  return derivativeTransition;
};

const resolveKind = (intent) => {
  const normalized = intent.toLowerCase();
  if (normalized.includes('match cut') || normalized.includes('cut on stopped token')) return 'match-cut';
  if (
    normalized.includes('paper wipe') ||
    normalized.includes('paper slide') ||
    normalized.includes('paper cut') ||
    normalized.includes('hard swap') ||
    normalized.includes('hard cut')
  ) return 'paper-wipe';
  if (normalized.includes('watercolor bloom')) return 'watercolor-bloom';
  if (normalized.includes('dissolve') || normalized.includes('fade')) return 'dissolve';
  throw new Error(`unmapped transition intent: ${intent}`);
};

export const resolveTransitionIntent = ({intent, fps, isTerminal}) => {
  if (typeof intent !== 'string' || intent.trim() === '') {
    throw new Error('missing transition intent');
  }
  if (!Number.isInteger(fps) || fps <= 0) throw new Error(`invalid fps: ${fps}`);
  if (isTerminal) {
    if (!/clean hold/i.test(intent)) throw new Error('terminal scene must use a clean hold with no outgoing transition');
    return null;
  }

  const durationMatch = intent.match(/(\d+(?:\.\d+)?)\s*s\b/i);
  if (!durationMatch) throw new Error(`transition intent has no duration: ${intent}`);
  const durationSeconds = Number(durationMatch[1]);
  if (durationSeconds < 0.3 || durationSeconds > 0.6) {
    throw new Error(`ordinary transitions must last 0.3–0.6 seconds: ${intent}`);
  }

  return Object.freeze({
    contract_version: 'scene-transition-v1',
    kind: resolveKind(intent),
    duration_seconds: durationSeconds,
    duration_in_frames: Math.round(durationSeconds * fps),
    source_intent: intent,
  });
};
