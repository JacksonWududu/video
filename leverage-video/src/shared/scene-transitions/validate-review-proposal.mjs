#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {buildTransitionReviewPresentedMapSha256} from './build-review-proposal.mjs';
import {
  SCENE_TRANSITION_CATALOG_VERSION,
  applyTransitionRecommendationDiversity,
  resolveTransitionRecommendation,
  validateUserApprovedTransition,
} from './contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(HERE, '../../../..');
const RENDERER = 'leverage-video/src/shared/scene-transitions';

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
};
const sameCanonical = (left, right) => JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
const requireExactKeys = (value, expected, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  if (!sameCanonical(Object.keys(value).sort(), [...expected].sort())) {
    throw new Error(`${label} contains missing or unknown fields`);
  }
};

const resolveRootRelative = (rootRelativePath, label) => {
  if (typeof rootRelativePath !== 'string' || rootRelativePath === '' || path.isAbsolute(rootRelativePath)) {
    throw new Error(`${label} must be root-relative`);
  }
  const resolved = path.resolve(REPOSITORY_ROOT, rootRelativePath);
  if (!resolved.startsWith(`${REPOSITORY_ROOT}${path.sep}`)) throw new Error(`${label} escapes repository root`);
  return resolved;
};

export const validateEpisodeTransitionReviewProposal = (episodeWorkspace) => {
  const workspacePath = resolveRootRelative(episodeWorkspace, 'episode workspace');
  const state = JSON.parse(fs.readFileSync(path.join(workspacePath, 'schema/episode-state.json'), 'utf8'));
  const approved = [
    'transition_review_approved',
    'transition_policy_authorized',
    'storyboard_qa_passed',
    'awaiting_storyboard_review',
    'storyboard_review_approved',
    'storyboard_policy_authorized',
    'visual_production',
    'awaiting_visual_asset_review',
    'awaiting_precomposition_visual_review',
    'visual_assets_locked',
    'composition_locked',
    'awaiting_caption_delivery_choice',
    'final_rendering',
    'delivered',
  ].includes(state.current_phase);
  const oneClick = state.workflow_approval_mode?.approval_mode === 'one_click';
  const finalizedStatus = oneClick ? 'policy_authorized' : 'approved';
  if (state.workspace_path !== episodeWorkspace
    || (!approved && state.current_phase !== 'awaiting_transition_review')) {
    throw new Error('episode is not at awaiting_transition_review or transition_review_approved');
  }
  const proposalPath = resolveRootRelative(state.transition_review?.path, 'transition review path');
  const proposalBytes = fs.readFileSync(proposalPath);
  if (sha256(proposalBytes) !== state.transition_review.checksum_sha256) {
    throw new Error('transition review artifact checksum is stale');
  }
  const proposal = JSON.parse(proposalBytes);
  if (proposal.contract_version !== 'per-boundary-transition-review-v1'
    || proposal.status !== (approved ? finalizedStatus : 'awaiting_user_selection')
    || state.transition_review.status !== (approved ? finalizedStatus : 'awaiting_user_selection')
    || proposal.catalog_version !== SCENE_TRANSITION_CATALOG_VERSION
    || proposal.fps !== 30
    || proposal.ordinary_boundary_count !== proposal.rows?.length
    || state.transition_review.ordinary_boundary_count !== proposal.rows.length) {
    throw new Error('transition review proposal authority or coverage is invalid');
  }
  const refreshLineage = proposal.refresh_lineage ?? null;
  let priorApprovedReview = null;
  let affectedBoundarySet = new Set();
  if (refreshLineage !== null) {
    requireExactKeys(refreshLineage, [
      'contract_version',
      'reason',
      'affected_boundary_ids',
      'preserved_approved_boundary_count',
      'prior_approval',
    ], 'affected-boundary transition refresh lineage');
    requireExactKeys(refreshLineage.prior_approval, [
      'path',
      'checksum_sha256',
      'presented_map_sha256',
    ], 'affected-boundary prior approval');
    affectedBoundarySet = new Set(refreshLineage.affected_boundary_ids);
    if (refreshLineage.contract_version !== 'affected-boundary-transition-refresh-v1'
      || !Array.isArray(refreshLineage.affected_boundary_ids)
      || refreshLineage.affected_boundary_ids.length === 0
      || affectedBoundarySet.size !== refreshLineage.affected_boundary_ids.length
      || refreshLineage.preserved_approved_boundary_count
        !== proposal.rows.length - refreshLineage.affected_boundary_ids.length) {
      throw new Error('affected-boundary transition refresh lineage is invalid');
    }
    const priorApprovalPath = resolveRootRelative(
      refreshLineage.prior_approval.path,
      'affected-boundary prior approval path',
    );
    const priorApprovalBytes = fs.readFileSync(priorApprovalPath);
    priorApprovedReview = JSON.parse(priorApprovalBytes);
    if (sha256(priorApprovalBytes) !== refreshLineage.prior_approval.checksum_sha256
      || priorApprovedReview.status !== 'approved'
      || priorApprovedReview.presented_map_sha256 !== refreshLineage.prior_approval.presented_map_sha256
      || priorApprovedReview.rows?.length !== proposal.rows.length) {
      throw new Error('affected-boundary prior approval is stale or incomplete');
    }
  }
  const storyboardPath = resolveRootRelative(proposal.storyboard.path, 'storyboard path');
  if (sha256(fs.readFileSync(storyboardPath)) !== proposal.storyboard.checksum_sha256) {
    throw new Error('transition review storyboard checksum is stale');
  }
  const reviewPath = resolveRootRelative(proposal.visual_direction_review.path, 'visual direction review path');
  const reviewBytes = fs.readFileSync(reviewPath);
  if (sha256(reviewBytes) !== proposal.visual_direction_review.checksum_sha256) {
    throw new Error('transition review visual-direction checksum is stale');
  }
  const review = JSON.parse(reviewBytes);
  const directionStatus = oneClick ? 'policy_authorized' : 'approved';
  if (review.status !== directionStatus
    || review.presented_map_sha256 !== proposal.visual_direction_review.presented_map_sha256
    || review.rows.some((row) => row.user_selection?.status !== directionStatus)) {
    throw new Error('transition review lacks authorized visual-direction evidence');
  }
  const overrideByBoundary = new Map();
  const overrideBinding = proposal.user_requested_transition_overrides;
  if (overrideBinding !== undefined) {
    requireExactKeys(overrideBinding, [
      'contract_version',
      'path',
      'checksum_sha256',
      'based_on_presented_map_sha256',
      'row_count',
    ], 'transition user-request override binding');
    const overridePath = resolveRootRelative(overrideBinding.path, 'transition user-request override path');
    const overrideBytes = fs.readFileSync(overridePath);
    const override = JSON.parse(overrideBytes);
    if (overrideBinding.contract_version !== 'transition-review-user-request-v1'
      || sha256(overrideBytes) !== overrideBinding.checksum_sha256
      || override.contract_version !== overrideBinding.contract_version
      || override.episode_workspace !== episodeWorkspace
      || override.based_on_presented_map_sha256 !== overrideBinding.based_on_presented_map_sha256
      || override.rows?.length !== overrideBinding.row_count
      || !state.superseded_artifacts?.some((record) => (
        record.prior_presented_map_sha256 === overrideBinding.based_on_presented_map_sha256
      ))) {
      throw new Error('transition user-request override binding is stale or invalid');
    }
    for (const input of override.rows) {
      const key = `${input.source_shot_id}\u0000${input.next_shot_id}`;
      if (overrideByBoundary.has(key)) throw new Error(`duplicate transition user request: ${input.source_shot_id}`);
      overrideByBoundary.set(key, {
        transition: {kind: input.kind, options: input.options},
        exact_message: override.exact_message,
        requested_at: override.requested_at,
        based_on_presented_map_sha256: override.based_on_presented_map_sha256,
      });
    }
  }
  const expectedPairs = review.rows.slice(0, -1).map((row, index) => [row.shot_id, review.rows[index + 1].shot_id]);
  if (proposal.rows.length !== expectedPairs.length) {
    throw new Error('transition review does not cover every ordinary boundary');
  }
  const reviewById = new Map(review.rows.map((row) => [row.shot_id, row]));
  const baseRows = proposal.rows.map((row, index) => {
    const [sourceShotId, nextShotId] = expectedPairs[index];
    if (row.source_shot_id !== sourceShotId || row.next_shot_id !== nextShotId) {
      throw new Error(`transition review boundary order mismatch: ${sourceShotId}`);
    }
    const sourceSelection = reviewById.get(sourceShotId).user_selection;
    const nextSelection = reviewById.get(nextShotId).user_selection;
    if (row.source_visual_generation_route !== sourceSelection.visual_generation_route
      || row.next_visual_generation_route !== nextSelection.visual_generation_route
      || row.source_white_cat_present !== sourceSelection.white_cat_present
      || row.next_white_cat_present !== nextSelection.white_cat_present) {
      throw new Error(`transition visual-direction context is stale: ${row.source_shot_id}`);
    }
    const expectedRecommendation = resolveTransitionRecommendation({
      boundaryChangeClass: row.boundary_change_class,
      sourceVisualGenerationRoute: row.source_visual_generation_route,
      nextVisualGenerationRoute: row.next_visual_generation_route,
      sourceWhiteCatPresent: row.source_white_cat_present,
      nextWhiteCatPresent: row.next_white_cat_present,
    });
    if (!sameCanonical(row.recommended_transition, expectedRecommendation.recommended_transition)
      || !sameCanonical(row.recommendation_source, expectedRecommendation.recommendation_source)) {
      throw new Error(`transition base recommendation is stale: ${row.source_shot_id}`);
    }
    const rowSelectionStatus = row.user_selection?.status;
    if (row.renderer !== RENDERER
      || !['pending', 'approved', 'policy_authorized'].includes(rowSelectionStatus)
      || (approved && rowSelectionStatus !== finalizedStatus)
      || (!approved && refreshLineage === null && rowSelectionStatus !== 'pending')) {
      throw new Error(`transition proposal row status or renderer is invalid: ${row.source_shot_id}`);
    }
    const expectedUserRequest = overrideByBoundary.get(`${sourceShotId}\u0000${nextShotId}`);
    if (!sameCanonical(row.user_requested_transition ?? null, expectedUserRequest ?? null)) {
      throw new Error(`transition user request mapping is stale: ${row.source_shot_id}`);
    }
    const expectedSeconds = row.kind === 'cut' ? 0 : 0.4;
    if (row.duration_seconds !== expectedSeconds
      || row.duration_in_frames !== Math.round(expectedSeconds * proposal.fps)) {
      throw new Error(`transition proposal duration is invalid: ${row.source_shot_id}`);
    }
    return {
      source_shot_id: row.source_shot_id,
      boundary_change_class: row.boundary_change_class,
      recommended_transition: row.recommended_transition,
      recommendation_source: row.recommendation_source,
      ...(row.user_requested_transition ? {user_requested_transition: row.user_requested_transition} : {}),
    };
  });
  if (overrideByBoundary.size !== proposal.rows.filter((row) => row.user_requested_transition).length) {
    throw new Error('transition user-request override coverage is incomplete');
  }
  const expectedDiversity = applyTransitionRecommendationDiversity(baseRows);
  const recordedDiversityPolicy = proposal.diversity_policy?.rule_id === 'scene-transition-recommendation-diversity-v2'
    && proposal.diversity_policy.white_cat_imagegen_watercolor_bloom_priority === true
    && proposal.diversity_policy.white_cat_style_bound_priority === undefined
    ? {
        ...proposal.diversity_policy,
        white_cat_style_bound_priority: true,
        white_cat_imagegen_watercolor_bloom_priority: undefined,
      }
    : proposal.diversity_policy;
  if (!sameCanonical(recordedDiversityPolicy, expectedDiversity.policy)) {
    throw new Error('transition diversity policy is stale');
  }
  proposal.rows.forEach((row, index) => {
    const expected = expectedDiversity.rows[index];
    if (!sameCanonical({kind: row.kind, options: row.options}, expected.proposed_transition)
      || !sameCanonical(row.diversity_adjustment, expected.diversity_adjustment)) {
      throw new Error(`transition diversity mapping is stale: ${row.source_shot_id}`);
    }
  });
  const presentedMapSha256 = buildTransitionReviewPresentedMapSha256(proposal);
  if (proposal.presented_map_sha256 !== presentedMapSha256
    || state.transition_review.presented_map_sha256 !== presentedMapSha256) {
    throw new Error('transition review presented map is stale');
  }
  const pendingBoundaryIds = [];
  const approvedBoundaryIds = [];
  proposal.rows.forEach((row, index) => {
    const boundaryId = `${row.source_shot_id}->${row.next_shot_id}`;
    if (['approved', 'policy_authorized'].includes(row.user_selection.status)) {
      validateUserApprovedTransition(row, {
        fps: proposal.fps,
        sourceShotId: row.source_shot_id,
        nextShotId: row.next_shot_id,
      });
      if (row.user_selection.presented_map_sha256 !== presentedMapSha256) {
        throw new Error(`transition approval references another presented map: ${row.source_shot_id}`);
      }
      approvedBoundaryIds.push(boundaryId);
      if (!approved && refreshLineage !== null) {
        if (affectedBoundarySet.has(boundaryId)
          || row.user_selection.binding_basis
            !== 'mechanically_rebound_after_visual_direction_change_with_unchanged_boundary_selection'
          || row.user_selection.rebound_at !== proposal.presentation.presented_at) {
          throw new Error(`preserved transition approval binding is invalid: ${row.source_shot_id}`);
        }
        const priorRow = priorApprovedReview.rows[index];
        const unchangedContext = {
          source_shot_id: row.source_shot_id,
          next_shot_id: row.next_shot_id,
          boundary_change_class: row.boundary_change_class,
          source_visual_generation_route: row.source_visual_generation_route,
          next_visual_generation_route: row.next_visual_generation_route,
          source_white_cat_present: row.source_white_cat_present,
          next_white_cat_present: row.next_white_cat_present,
          source_intent: row.source_intent,
          kind: row.kind,
          options: row.options,
          duration_seconds: row.duration_seconds,
          duration_in_frames: row.duration_in_frames,
        };
        const priorContext = Object.fromEntries(Object.keys(unchangedContext).map((key) => [key, priorRow[key]]));
        if (!sameCanonical(unchangedContext, priorContext)
          || row.user_selection.prior_presented_map_sha256
            !== refreshLineage.prior_approval.presented_map_sha256
          || row.user_selection.exact_message !== priorRow.user_selection.exact_message
          || row.user_selection.decided_at !== priorRow.user_selection.decided_at) {
          throw new Error(`preserved transition approval changed: ${row.source_shot_id}`);
        }
      }
    } else {
      pendingBoundaryIds.push(boundaryId);
      if (approved
        || refreshLineage !== null && !affectedBoundarySet.has(boundaryId)
        || row.user_selection.exact_message !== null
        || row.user_selection.decided_at !== null
        || row.user_selection.presented_map_sha256 !== null) {
        throw new Error(`pending transition selection is invalid: ${row.source_shot_id}`);
      }
    }
  });
  if (!approved && refreshLineage !== null) {
    if (!sameCanonical(pendingBoundaryIds, refreshLineage.affected_boundary_ids)
      || state.transition_review.pending_boundary_count !== pendingBoundaryIds.length
      || state.transition_review.approved_boundary_count !== approvedBoundaryIds.length
      || !sameCanonical(state.transition_review.pending_boundary_ids, pendingBoundaryIds)) {
      throw new Error('affected-boundary transition refresh status counts are stale');
    }
  }
  const visibleKindCounts = Object.fromEntries([...proposal.rows
    .filter((row) => row.kind !== 'cut')
    .reduce((counts, row) => counts.set(row.kind, (counts.get(row.kind) ?? 0) + 1), new Map())
    .entries()].sort(([left], [right]) => left.localeCompare(right)));
  return {
    contract_version: 'per-boundary-transition-review-validation-v1',
    result: 'pass',
    ordinary_boundary_count: proposal.rows.length,
    pending_boundary_count: pendingBoundaryIds.length,
    approved_boundary_count: approvedBoundaryIds.length,
    pending_boundary_ids: pendingBoundaryIds,
    presented_map_sha256: presentedMapSha256,
    diversity_policy: proposal.diversity_policy,
    visible_kind_counts: visibleKindCounts,
  };
};

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  if (process.argv.length !== 3) {
    console.error('usage: node validate-review-proposal.mjs <episode-workspace>');
    process.exit(2);
  }
  try {
    process.stdout.write(`${JSON.stringify(validateEpisodeTransitionReviewProposal(process.argv[2]), null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
