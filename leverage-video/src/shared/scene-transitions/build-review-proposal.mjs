#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  BOUNDARY_CHANGE_CLASSES,
  SCENE_TRANSITION_CATALOG_VERSION,
  TRANSITION_CATALOG,
  applyTransitionRecommendationDiversity,
  resolveTransitionRecommendation,
} from './contract.mjs';
import {buildPresentedMapSha256 as buildVisualDirectionMapSha256} from '../visual-generation-routes/contract.mjs';
import {validateApprovedVisibleTextReviewState} from '../visible-text-review/state-gate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(HERE, '../../../..');
const RENDERER = 'leverage-video/src/shared/scene-transitions';
const FPS = 30;

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
};
const sha256Canonical = (value) => sha256(Buffer.from(JSON.stringify(canonicalize(value))));
const sameCanonical = (left, right) =>
  JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));

const resolveRootRelative = (rootRelativePath, label) => {
  if (typeof rootRelativePath !== 'string' || rootRelativePath === '' || path.isAbsolute(rootRelativePath)) {
    throw new Error(`${label} must be root-relative`);
  }
  const resolved = path.resolve(REPOSITORY_ROOT, rootRelativePath);
  if (!resolved.startsWith(`${REPOSITORY_ROOT}${path.sep}`)) throw new Error(`${label} escapes repository root`);
  return resolved;
};

const requireExactKeys = (value, expected, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error(`${label} contains missing or unknown fields`);
};

const presentedProjection = (proposal) => ({
  contract_version: proposal.contract_version,
  catalog_version: proposal.catalog_version,
  storyboard: proposal.storyboard,
  visual_direction_review: proposal.visual_direction_review,
  fps: proposal.fps,
  diversity_policy: proposal.diversity_policy,
  ...(proposal.refresh_lineage ? {refresh_lineage: proposal.refresh_lineage} : {}),
  user_requested_transition_overrides: proposal.user_requested_transition_overrides ?? null,
  fixed_exemptions: proposal.fixed_exemptions,
  rows: proposal.rows.map((row) => ({
    contract_version: row.contract_version,
    catalog_version: row.catalog_version,
    source_shot_id: row.source_shot_id,
    next_shot_id: row.next_shot_id,
    boundary_change_class: row.boundary_change_class,
    source_visual_generation_route: row.source_visual_generation_route,
    next_visual_generation_route: row.next_visual_generation_route,
    source_white_cat_present: row.source_white_cat_present,
    next_white_cat_present: row.next_white_cat_present,
    white_cat_visual_style_id: row.white_cat_visual_style_id,
    recommended_transition: row.recommended_transition,
    recommendation_source: row.recommendation_source,
    user_requested_transition: row.user_requested_transition ?? null,
    diversity_adjustment: row.diversity_adjustment,
    kind: row.kind,
    options: row.options,
    duration_seconds: row.duration_seconds,
    duration_in_frames: row.duration_in_frames,
    source_intent: row.source_intent,
    renderer: row.renderer,
  })),
});

export const buildTransitionReviewPresentedMapSha256 = (proposal) =>
  sha256Canonical(presentedProjection(proposal));

const TRANSITION_REVIEW_FILENAME = /^per-boundary-transition-review-v(\d+)\.json$/;

export const nextTransitionReviewVersion = ({
  existingFilenames,
  versionSourcePath,
  replacingOrRefreshing,
}) => {
  if (!Array.isArray(existingFilenames)
    || existingFilenames.some((filename) => typeof filename !== 'string')) {
    throw new Error('existing transition review filenames are invalid');
  }
  const existingVersions = existingFilenames
    .map((filename) => Number(filename.match(TRANSITION_REVIEW_FILENAME)?.[1]))
    .filter((version) => Number.isInteger(version) && version >= 0);
  let sourceVersion = 0;
  if (replacingOrRefreshing) {
    sourceVersion = Number(
      path.posix.basename(versionSourcePath ?? '').match(TRANSITION_REVIEW_FILENAME)?.[1],
    );
    if (!Number.isInteger(sourceVersion) || sourceVersion < 0) {
      throw new Error('current transition review path is not versioned');
    }
  }
  return Math.max(0, sourceVersion, ...existingVersions) + 1;
};

export const rebindUnaffectedTransitionApprovals = ({
  rows,
  priorRows,
  affectedBoundaryIds,
  priorPresentedMapSha256,
  nextPresentedMapSha256,
  reboundAt,
}) => {
  const affectedBoundarySet = new Set(affectedBoundaryIds);
  const priorRowByBoundary = new Map(priorRows.map((row) => [
    `${row.source_shot_id}->${row.next_shot_id}`,
    row,
  ]));
  return structuredClone(rows).map((row) => {
    const boundaryId = `${row.source_shot_id}->${row.next_shot_id}`;
    const priorRow = priorRowByBoundary.get(boundaryId);
    if (!priorRow) throw new Error(`prior transition row is missing: ${boundaryId}`);
    if (affectedBoundarySet.has(boundaryId)) {
      row.prior_user_selection = priorRow.user_selection;
      return row;
    }
    const unchangedContext = {
      source_visual_generation_route: row.source_visual_generation_route,
      next_visual_generation_route: row.next_visual_generation_route,
      source_white_cat_present: row.source_white_cat_present,
      next_white_cat_present: row.next_white_cat_present,
      white_cat_visual_style_id: row.white_cat_visual_style_id,
      boundary_change_class: row.boundary_change_class,
      source_intent: row.source_intent,
    };
    const priorContext = Object.fromEntries(Object.keys(unchangedContext).map((key) => [key, priorRow[key]]));
    const unchangedSelection = {
      kind: row.kind,
      options: row.options,
      duration_seconds: row.duration_seconds,
      duration_in_frames: row.duration_in_frames,
    };
    const priorSelection = Object.fromEntries(Object.keys(unchangedSelection).map((key) => [key, priorRow[key]]));
    if (!sameCanonical(unchangedContext, priorContext)
      || !sameCanonical(unchangedSelection, priorSelection)
      || priorRow.user_selection?.status !== 'approved'
      || priorRow.user_selection.presented_map_sha256 !== priorPresentedMapSha256) {
      throw new Error(`unaffected transition approval cannot be preserved: ${boundaryId}`);
    }
    row.user_selection = {
      ...priorRow.user_selection,
      presented_map_sha256: nextPresentedMapSha256,
      prior_presented_map_sha256: priorRow.user_selection.presented_map_sha256,
      binding_basis: 'mechanically_rebound_after_visual_direction_change_with_unchanged_boundary_selection',
      rebound_at: reboundAt,
    };
    return row;
  });
};

const buildArtifacts = ({episodeWorkspace, classificationPath, presentedAt, overridePath = null}) => {
  const workspacePath = resolveRootRelative(episodeWorkspace, 'episode workspace');
  const statePath = path.join(workspacePath, 'schema/episode-state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const oneClick = state.workflow_approval_mode?.approval_mode === 'one_click';
  const expectedDirectionStatus = oneClick ? 'policy_authorized' : 'approved';
  const replacingPendingProposal = state.current_phase === 'awaiting_transition_review';
  const refreshingAffectedProposal = state.current_phase === 'visible_text_review_approved'
    && state.transition_review?.status === 'reopen_required_after_visual_direction_review';
  if (state.workspace_path !== episodeWorkspace
    || !['visible_text_review_approved', 'awaiting_transition_review'].includes(state.current_phase)) {
    throw new Error('episode is not ready to build or replace a pending transition proposal');
  }
  if (state.visual_direction_review?.status !== expectedDirectionStatus) {
    throw new Error(oneClick
      ? 'visual direction review is not policy-authorized'
      : 'visual direction review is not approved');
  }
  const reviewPath = resolveRootRelative(state.visual_direction_review.path, 'visual direction review path');
  const reviewBytes = fs.readFileSync(reviewPath);
  if (sha256(reviewBytes) !== state.visual_direction_review.checksum_sha256) {
    throw new Error('visual direction review checksum is stale');
  }
  const review = JSON.parse(reviewBytes);
  const policySha256 = state.one_click_approval_policy?.policy_sha256;
  const policyAuthorizationInvalid = oneClick && (
    !/^[a-f0-9]{64}$/.test(policySha256 ?? '')
    || state.one_click_approval_policy?.preauthorizations
      ?.deterministic_visual_direction_recommendations !== true
    || state.one_click_approval_policy?.preauthorizations
      ?.deterministic_transition_recommendations !== true
    || state.one_click_approval_policy?.user_has_reviewed_specific_maps !== false
    || review.policy_authorization?.policy_sha256 !== policySha256
    || review.policy_authorization?.user_has_reviewed_specific_map !== false
    || review.policy_authorization?.presented_map_sha256 !== review.presented_map_sha256
    || typeof review.policy_authorization?.authorized_at !== 'string'
    || Number.isNaN(Date.parse(review.policy_authorization.authorized_at))
    || review.rows.some((row) => row.user_selection?.policy_sha256 !== policySha256
      || row.user_selection.deterministic_recommendation_selected !== true
      || row.user_selection.user_has_reviewed_specific_map !== false
      || row.user_selection.exact_message !== null
      || row.user_selection.decided_at !== null
      || row.user_selection.authorized_at !== review.policy_authorization.authorized_at)
  );
  if (review.status !== expectedDirectionStatus
    || review.presented_map_sha256 !== state.visual_direction_review.presented_map_sha256
    || review.presented_map_sha256 !== buildVisualDirectionMapSha256(review)
    || review.rows.some((row) => row.user_selection?.status !== expectedDirectionStatus
      || row.user_selection.presented_map_sha256 !== review.presented_map_sha256)
    || policyAuthorizationInvalid) {
    throw new Error(oneClick
      ? 'visual direction policy authorization is incomplete, stale, or fabricates concrete-map review'
      : 'visual direction approval evidence is incomplete or stale');
  }
  const storyboardPath = resolveRootRelative(review.storyboard.path, 'storyboard path');
  const storyboardBytes = fs.readFileSync(storyboardPath);
  if (sha256(storyboardBytes) !== review.storyboard.checksum_sha256) {
    throw new Error('storyboard checksum is stale');
  }
  validateApprovedVisibleTextReviewState({
    repositoryRoot: REPOSITORY_ROOT,
    episodeWorkspace,
    state,
    visualDirectionReview: review,
    storyboardMarkdown: storyboardBytes.toString('utf8'),
  });

  const classificationBytes = fs.readFileSync(path.resolve(classificationPath));
  const classificationInput = JSON.parse(classificationBytes);
  let priorTransitionReview = null;
  let classification = classificationInput;
  if (replacingPendingProposal || refreshingAffectedProposal) {
    const priorBinding = refreshingAffectedProposal
      ? state.transition_review?.prior_approval
      : state.transition_review;
    const currentTransitionPath = resolveRootRelative(
      priorBinding?.path,
      refreshingAffectedProposal ? 'prior approved transition review path' : 'current transition review path',
    );
    const currentTransitionBytes = fs.readFileSync(currentTransitionPath);
    const expectedPriorStatus = refreshingAffectedProposal ? 'approved' : 'awaiting_user_selection';
    if ((!refreshingAffectedProposal && state.transition_review?.status !== expectedPriorStatus)
      || sha256(currentTransitionBytes) !== priorBinding.checksum_sha256) {
      throw new Error('prior transition review checksum or status is stale');
    }
    priorTransitionReview = JSON.parse(currentTransitionBytes);
    if (priorTransitionReview.status !== expectedPriorStatus
      || priorTransitionReview.presented_map_sha256 !== priorBinding.presented_map_sha256) {
      throw new Error('prior transition review authority is stale');
    }
    if (!refreshingAffectedProposal
      && priorTransitionReview.rows.some((row) => row.user_selection?.status !== 'pending')) {
      throw new Error('cannot globally rebuild a transition proposal after any boundary was decided');
    }
    if (refreshingAffectedProposal
      && priorTransitionReview.rows.some((row) => row.user_selection?.status !== 'approved')) {
      throw new Error('affected-boundary refresh requires one fully approved prior transition review');
    }
    if (path.resolve(classificationPath) !== currentTransitionPath
      || sha256(classificationBytes) !== priorBinding.checksum_sha256) {
      throw new Error('transition proposal rebuild must use the checksum-current prior review');
    }
    classification = {
      contract_version: 'scene-transition-boundary-classification-v1',
      episode_workspace: episodeWorkspace,
      storyboard_checksum_sha256: refreshingAffectedProposal
        ? review.storyboard.checksum_sha256
        : priorTransitionReview.storyboard.checksum_sha256,
      visual_direction_review_checksum_sha256: refreshingAffectedProposal
        ? state.visual_direction_review.checksum_sha256
        : priorTransitionReview.visual_direction_review.checksum_sha256,
      visual_direction_presented_map_sha256: refreshingAffectedProposal
        ? review.presented_map_sha256
        : priorTransitionReview.visual_direction_review.presented_map_sha256,
      rows: priorTransitionReview.rows.map((row) => ({
        source_shot_id: row.source_shot_id,
        next_shot_id: row.next_shot_id,
        boundary_change_class: row.boundary_change_class,
        reason: row.source_intent,
      })),
    };
  } else {
    requireExactKeys(classification, [
      'contract_version',
      'episode_workspace',
      'storyboard_checksum_sha256',
      'visual_direction_review_checksum_sha256',
      'visual_direction_presented_map_sha256',
      'rows',
    ], 'transition boundary classification');
  }
  if (classification.contract_version !== 'scene-transition-boundary-classification-v1'
    || classification.episode_workspace !== episodeWorkspace
    || classification.storyboard_checksum_sha256 !== review.storyboard.checksum_sha256
    || classification.visual_direction_review_checksum_sha256 !== state.visual_direction_review.checksum_sha256
    || classification.visual_direction_presented_map_sha256 !== review.presented_map_sha256) {
    throw new Error('transition boundary classification is stale or targets another episode');
  }
  let overrideArtifact = null;
  let overrideBinding = null;
  const inheritedOverrideBinding = refreshingAffectedProposal
    ? priorTransitionReview.user_requested_transition_overrides ?? null
    : null;
  if (overridePath !== null || inheritedOverrideBinding !== null) {
    if (!replacingPendingProposal && !refreshingAffectedProposal) {
      throw new Error('transition user-request override requires a checksum-current pending proposal');
    }
    if (refreshingAffectedProposal && overridePath !== null) {
      throw new Error('affected-boundary refresh must preserve the prior user-request override binding');
    }
    const effectiveOverridePath = inheritedOverrideBinding?.path ?? overridePath;
    const overrideAbsolute = resolveRootRelative(effectiveOverridePath, 'transition user-request override path');
    const overrideBytes = fs.readFileSync(overrideAbsolute);
    overrideArtifact = JSON.parse(overrideBytes);
    requireExactKeys(overrideArtifact, [
      'contract_version',
      'episode_workspace',
      'based_on_presented_map_sha256',
      'exact_message',
      'requested_at',
      'rows',
    ], 'transition user-request override');
    const expectedOverrideBaseMap = inheritedOverrideBinding?.based_on_presented_map_sha256
      ?? state.transition_review.presented_map_sha256;
    if (overrideArtifact.contract_version !== 'transition-review-user-request-v1'
      || overrideArtifact.episode_workspace !== episodeWorkspace
      || overrideArtifact.based_on_presented_map_sha256 !== expectedOverrideBaseMap
      || typeof overrideArtifact.exact_message !== 'string' || overrideArtifact.exact_message.trim() === ''
      || typeof overrideArtifact.requested_at !== 'string'
      || Number.isNaN(Date.parse(overrideArtifact.requested_at))
      || !Array.isArray(overrideArtifact.rows) || overrideArtifact.rows.length === 0) {
      throw new Error('transition user-request override is stale or invalid');
    }
    if (inheritedOverrideBinding !== null
      && (sha256(overrideBytes) !== inheritedOverrideBinding.checksum_sha256
        || overrideArtifact.rows.length !== inheritedOverrideBinding.row_count
        || inheritedOverrideBinding.contract_version !== overrideArtifact.contract_version)) {
      throw new Error('inherited transition user-request override binding is stale');
    }
    overrideBinding = {
      contract_version: overrideArtifact.contract_version,
      path: effectiveOverridePath,
      checksum_sha256: sha256(overrideBytes),
      based_on_presented_map_sha256: overrideArtifact.based_on_presented_map_sha256,
      row_count: overrideArtifact.rows.length,
    };
  }
  const expectedPairs = review.rows.slice(0, -1).map((row, index) => [row.shot_id, review.rows[index + 1].shot_id]);
  if (!Array.isArray(classification.rows) || classification.rows.length !== expectedPairs.length) {
    throw new Error('transition classification does not cover every ordinary boundary');
  }
  const expectedBoundaryIds = expectedPairs.map(([source, next]) => `${source}->${next}`);
  const affectedBoundaryIds = refreshingAffectedProposal
    ? state.transition_review.affected_boundary_ids
    : [];
  if (refreshingAffectedProposal) {
    const reopenedFromDirectionReview = (state.visual_direction_review.reopened_transition_boundaries ?? [])
      .map(({source_shot_id: source, next_shot_id: next}) => `${source}->${next}`);
    if (!Array.isArray(affectedBoundaryIds) || affectedBoundaryIds.length === 0
      || new Set(affectedBoundaryIds).size !== affectedBoundaryIds.length
      || affectedBoundaryIds.some((boundaryId) => !expectedBoundaryIds.includes(boundaryId))
      || !sameCanonical(affectedBoundaryIds, reopenedFromDirectionReview)) {
      throw new Error('affected transition boundary set is missing, stale, or inconsistent with visual direction review');
    }
  }
  const overrideByBoundary = new Map();
  for (const [index, row] of (overrideArtifact?.rows ?? []).entries()) {
    requireExactKeys(row, ['source_shot_id', 'next_shot_id', 'kind', 'options'], `transition override ${index + 1}`);
    const key = `${row.source_shot_id}\u0000${row.next_shot_id}`;
    if (overrideByBoundary.has(key)) throw new Error(`duplicate transition override: ${row.source_shot_id}`);
    if (!expectedPairs.some(([source, next]) => source === row.source_shot_id && next === row.next_shot_id)) {
      throw new Error(`unknown transition override boundary: ${row.source_shot_id}→${row.next_shot_id}`);
    }
    overrideByBoundary.set(key, {
      transition: {kind: row.kind, options: row.options},
      exact_message: overrideArtifact.exact_message,
      requested_at: overrideArtifact.requested_at,
      based_on_presented_map_sha256: overrideArtifact.based_on_presented_map_sha256,
    });
  }

  const reviewById = new Map(review.rows.map((row) => [row.shot_id, row]));
  const baseRows = classification.rows.map((input, index) => {
    requireExactKeys(input, ['source_shot_id', 'next_shot_id', 'boundary_change_class', 'reason'], `boundary ${index + 1}`);
    const [expectedSource, expectedNext] = expectedPairs[index];
    if (input.source_shot_id !== expectedSource || input.next_shot_id !== expectedNext) {
      throw new Error(`transition boundary order mismatch at ${expectedSource}→${expectedNext}`);
    }
    if (!BOUNDARY_CHANGE_CLASSES.includes(input.boundary_change_class)) {
      throw new Error(`unsupported boundary_change_class: ${input.boundary_change_class}`);
    }
    if (typeof input.reason !== 'string' || input.reason.trim() === '') {
      throw new Error(`transition reason is missing: ${input.source_shot_id}`);
    }
    const sourceSelection = reviewById.get(input.source_shot_id).user_selection;
    const nextSelection = reviewById.get(input.next_shot_id).user_selection;
    const sourceRoute = sourceSelection.visual_generation_route;
    const nextRoute = nextSelection.visual_generation_route;
    const sourceWhiteCatPresent = sourceSelection.white_cat_present;
    const nextWhiteCatPresent = nextSelection.white_cat_present;
    const whiteCatVisualStyleId = review.white_cat_visual_style_binding?.style_id
      ?? 'loose-line-vivid-watercolor';
    const resolved = resolveTransitionRecommendation({
      boundaryChangeClass: input.boundary_change_class,
      sourceVisualGenerationRoute: sourceRoute,
      nextVisualGenerationRoute: nextRoute,
      sourceWhiteCatPresent,
      nextWhiteCatPresent,
      whiteCatVisualStyleId,
    });
    const userRequestedTransition = overrideByBoundary.get(
      `${input.source_shot_id}\u0000${input.next_shot_id}`,
    );
    return {
      contract_version: 'scene-transition-v3',
      catalog_version: SCENE_TRANSITION_CATALOG_VERSION,
      source_shot_id: input.source_shot_id,
      next_shot_id: input.next_shot_id,
      boundary_change_class: input.boundary_change_class,
      source_visual_generation_route: sourceRoute,
      next_visual_generation_route: nextRoute,
      source_white_cat_present: sourceWhiteCatPresent,
      next_white_cat_present: nextWhiteCatPresent,
      white_cat_visual_style_id: whiteCatVisualStyleId,
      recommended_transition: resolved.recommended_transition,
      recommendation_source: resolved.recommendation_source,
      ...(userRequestedTransition ? {user_requested_transition: userRequestedTransition} : {}),
      source_intent: input.reason,
      renderer: RENDERER,
    };
  });
  const diversified = applyTransitionRecommendationDiversity(baseRows);
  const rows = diversified.rows.map((diversifiedRow) => {
    const {
      proposed_transition: proposedTransition,
      diversity_adjustment: diversityAdjustment,
      ...baseRow
    } = diversifiedRow;
    const durationSeconds = proposedTransition.kind === 'cut' ? 0 : 0.4;
    return {
      ...baseRow,
      diversity_adjustment: diversityAdjustment,
      kind: proposedTransition.kind,
      options: proposedTransition.options,
      duration_seconds: durationSeconds,
      duration_in_frames: Math.round(durationSeconds * FPS),
      user_selection: {
        status: 'pending',
        exact_message: null,
        decided_at: null,
        presented_map_sha256: null,
      },
    };
  });

  const versionSourcePath = refreshingAffectedProposal
    ? state.transition_review.prior_approval.path
    : state.transition_review?.path;
  const proposalVersion = nextTransitionReviewVersion({
    existingFilenames: fs.readdirSync(path.join(workspacePath, 'schema')),
    versionSourcePath,
    replacingOrRefreshing: replacingPendingProposal || refreshingAffectedProposal,
  });
  const proposalRelative = `${episodeWorkspace}/schema/per-boundary-transition-review-v${proposalVersion}.json`;
  const proposal = {
    contract_version: 'per-boundary-transition-review-v1',
    status: 'awaiting_user_selection',
    episode_workspace: episodeWorkspace,
    catalog_version: SCENE_TRANSITION_CATALOG_VERSION,
    fps: FPS,
    storyboard: {
      path: review.storyboard.path,
      checksum_sha256: review.storyboard.checksum_sha256,
    },
    visual_direction_review: {
      path: state.visual_direction_review.path,
      checksum_sha256: state.visual_direction_review.checksum_sha256,
      presented_map_sha256: review.presented_map_sha256,
    },
    ordinary_boundary_count: rows.length,
    diversity_policy: diversified.policy,
    ...(refreshingAffectedProposal ? {
      refresh_lineage: {
        contract_version: 'affected-boundary-transition-refresh-v1',
        reason: state.transition_review.reason,
        affected_boundary_ids: affectedBoundaryIds,
        preserved_approved_boundary_count: rows.length - affectedBoundaryIds.length,
        prior_approval: state.transition_review.prior_approval,
      },
    } : {}),
    ...(overrideBinding ? {user_requested_transition_overrides: overrideBinding} : {}),
    fixed_exemptions: {
      opening: {
        source_shot_id: 'OPEN-00',
        next_shot_id: review.rows[0].shot_id,
        kind: 'cut',
        options: {},
        duration_seconds: 0,
        duration_in_frames: 0,
        selectable: false,
      },
      terminal: {
        source_shot_id: review.rows.at(-1).shot_id,
        next_shot_id: null,
        kind: 'terminal-clean-hold',
        selectable: false,
      },
    },
    available_catalog_entries: TRANSITION_CATALOG,
    rows,
    presentation: {
      presented_at: oneClick ? null : presentedAt,
      exact_message: oneClick
        ? null
        : (refreshingAffectedProposal
          ? `已按 ${diversified.policy.rule_id} 重建 ${affectedBoundaryIds.length} 条受视觉路线变化影响的 scene-transition-v3 边界；其余 ${rows.length - affectedBoundaryIds.length} 条批准选择在边界视觉上下文与选择均未变化且整期多样性复验通过后机械重绑；等待用户明确批准受影响边界。`
          : `已按 ${diversified.policy.rule_id} 呈现完整 ${rows.length} 条普通边界的 scene-transition-v3 推荐映射及全部注册目录项；白猫 ImageGen 边界优先 watercolor-bloom；同种可见动画连续不超过 ${diversified.policy.max_consecutive_identical_visible_kind_uses} 次，整期不超过 ${diversified.policy.max_identical_visible_kind_absolute_uses} 次且占可见转场不超过 ${Math.round(diversified.policy.max_identical_visible_kind_share * 100)}%；等待用户逐条选择或明确确认全部推荐。`),
      approval_phrase_after_complete_presentation: oneClick ? null : '确认全部推荐',
      ...(oneClick ? {
        generated_at: presentedAt,
        policy_sha256: policySha256,
        user_has_reviewed_specific_map: false,
      } : {}),
    },
  };
  proposal.presented_map_sha256 = buildTransitionReviewPresentedMapSha256(proposal);
  if (refreshingAffectedProposal) {
    proposal.rows = rebindUnaffectedTransitionApprovals({
      rows: proposal.rows,
      priorRows: priorTransitionReview.rows,
      affectedBoundaryIds,
      priorPresentedMapSha256: priorTransitionReview.presented_map_sha256,
      nextPresentedMapSha256: proposal.presented_map_sha256,
      reboundAt: presentedAt,
    });
  }
  const proposalBytes = jsonBytes(proposal);

  const nextState = structuredClone(state);
  nextState.storyboard_construction = {
    ...nextState.storyboard_construction,
    status: oneClick
      ? 'visual_direction_policy_authorized_awaiting_transition_policy_binding'
      : 'visual_direction_approved_awaiting_transition_review',
    ordinary_transition_status: oneClick
      ? 'awaiting_deterministic_policy_authorization'
      : 'awaiting_explicit_per_boundary_review',
  };
  if (priorTransitionReview) {
    const priorBinding = refreshingAffectedProposal
      ? state.transition_review.prior_approval
      : state.transition_review;
    nextState.superseded_artifacts = [
      ...(nextState.superseded_artifacts ?? []),
      {
        record_type: 'superseded_transition_review_presentation',
        reason: refreshingAffectedProposal
          ? 'affected_boundaries_reopened_after_visual_direction_change'
          : 'transition_recommendation_policy_recomputed',
        superseded_at: presentedAt,
        prior_artifact_path: priorBinding.path,
        prior_artifact_checksum_sha256: priorBinding.checksum_sha256,
        prior_presented_map_sha256: priorBinding.presented_map_sha256,
        prior_status: priorTransitionReview.status,
        replacement_artifact_path: proposalRelative,
        replacement_presented_map_sha256: proposal.presented_map_sha256,
        ...(refreshingAffectedProposal ? {
          affected_boundary_ids: affectedBoundaryIds,
          preserved_approved_boundary_count: rows.length - affectedBoundaryIds.length,
        } : {}),
      },
    ];
  }
  nextState.transition_review = {
    status: 'awaiting_user_selection',
    contract_version: proposal.contract_version,
    catalog_version: proposal.catalog_version,
    path: proposalRelative,
    checksum_sha256: sha256(proposalBytes),
    presented_map_sha256: proposal.presented_map_sha256,
    ordinary_boundary_count: rows.length,
    pending_boundary_ids: refreshingAffectedProposal ? affectedBoundaryIds : expectedBoundaryIds,
    pending_boundary_count: refreshingAffectedProposal ? affectedBoundaryIds.length : rows.length,
    approved_boundary_count: refreshingAffectedProposal ? rows.length - affectedBoundaryIds.length : 0,
    ...(refreshingAffectedProposal ? {
      refresh_lineage: proposal.refresh_lineage,
      unaffected_boundary_evidence_preserved: true,
    } : {}),
    diversity_policy: diversified.policy,
    presented_at: oneClick ? null : presentedAt,
    exact_presentation_message: proposal.presentation.exact_message,
    ...(oneClick ? {
      generated_at: presentedAt,
      policy_sha256: policySha256,
      user_has_reviewed_specific_map: false,
    } : {}),
  };
  nextState.current_phase = 'awaiting_transition_review';
  const nextStateBytes = jsonBytes(nextState);

  return {
    result: 'pass',
    presented_map_sha256: proposal.presented_map_sha256,
    proposal: {relative: proposalRelative, bytes: proposalBytes},
    state: {relative: `${episodeWorkspace}/schema/episode-state.json`, bytes: nextStateBytes},
  };
};

const outputProjection = (artifacts) => ({
  result: artifacts.result,
  presented_map_sha256: artifacts.presented_map_sha256,
  proposal: {
    path: artifacts.proposal.relative,
    checksum_sha256: sha256(artifacts.proposal.bytes),
  },
  state: {
    path: artifacts.state.relative,
    checksum_sha256: sha256(artifacts.state.bytes),
  },
});

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const [episodeWorkspace, classificationPath, presentedAt, mode, overridePath = null] = process.argv.slice(2);
  if (!episodeWorkspace || !classificationPath || !presentedAt || !['--dry-run', '--apply'].includes(mode)
    || process.argv.length > 7
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(presentedAt)) {
    console.error('usage: node build-review-proposal.mjs <episode-workspace> <classification.json> <ISO-8601-with-offset> <--dry-run|--apply> [transition-user-request.json]');
    process.exit(2);
  }
  try {
    const artifacts = buildArtifacts({episodeWorkspace, classificationPath, presentedAt, overridePath});
    if (mode === '--apply') {
      const proposalPath = resolveRootRelative(artifacts.proposal.relative, 'proposal output path');
      if (fs.existsSync(proposalPath)) throw new Error(`proposal output already exists: ${artifacts.proposal.relative}`);
      fs.writeFileSync(proposalPath, artifacts.proposal.bytes);
      fs.writeFileSync(resolveRootRelative(artifacts.state.relative, 'state output path'), artifacts.state.bytes);
    }
    process.stdout.write(`${JSON.stringify({...outputProjection(artifacts), applied: mode === '--apply'}, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
