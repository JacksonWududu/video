#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  buildTransitionReviewPresentedMapSha256,
  rebindUnaffectedTransitionApprovals,
} from './build-review-proposal.mjs';
import {
  approvePendingTransitionRows,
  authorizePendingTransitionRowsOneClick,
} from './approve-review-proposal.mjs';

import {
  SCENE_TRANSITION_CATALOG_VERSION,
  RETIRED_TRANSITION_KINDS_V3,
  TRANSITION_CATALOG,
  TRANSITION_KINDS_V3,
  TRANSITION_RECOMMENDATION_DIVERSITY_RULE_ID,
  applyTransitionRecommendationDiversity,
  resolveTransitionRecommendation,
  validateRevoiceTransitionLock,
  validateUserApprovedTransition,
} from './contract.mjs';

assert.equal(SCENE_TRANSITION_CATALOG_VERSION, 'scene-transition-catalog-v3');
assert.ok(TRANSITION_CATALOG.some((entry) => entry.kind === 'cut'));
assert.deepEqual(RETIRED_TRANSITION_KINDS_V3, [
  'zoom-blur',
  'flip',
  'slide',
  'clock-wipe',
]);
for (const kind of RETIRED_TRANSITION_KINDS_V3) {
  assert.ok(!TRANSITION_CATALOG.some((entry) => entry.kind === kind), `active catalog contains ${kind}`);
  assert.ok(!TRANSITION_KINDS_V3.includes(kind), `active kind list contains ${kind}`);
}

const base = {
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
  source_intent: '连续动作直接切到下一镜',
  renderer: 'leverage-video/src/shared/scene-transitions',
  user_selection: {
    status: 'approved',
    exact_message: '确认 S01 到 S02 使用 cut',
    decided_at: '2026-08-15T10:00:00+08:00',
    presented_map_sha256: 'a'.repeat(64),
  },
};

assert.deepEqual(validateUserApprovedTransition(base, {
  fps: 30,
  sourceShotId: 'S01',
  nextShotId: 'S02',
}), base);

for (const invalid of [
  {...base, duration_seconds: 0.4, duration_in_frames: 12},
  {...base, options: {direction: 'from-left'}},
  {...base, kind: 'none'},
  {...base, boundary_change_class: 'unknown'},
  {...base, source_white_cat_present: null},
  {...base, renderer: 'local-fallback'},
  {...base, recommended_transition: {kind: 'fade', options: {}}},
  {...base, recommendation_source: {authority: 'shared-fallback', rule_id: 'spoofed'}},
]) {
  assert.throws(() => validateUserApprovedTransition(invalid, {
    fps: 30,
    sourceShotId: 'S01',
    nextShotId: 'S02',
  }));
}

const visible = {
  ...base,
  boundary_change_class: 'contrast_or_warning',
  recommended_transition: {kind: 'wipe', options: {direction: 'from-left'}},
  kind: 'wipe',
  options: {direction: 'from-left'},
  duration_seconds: 0.4,
  duration_in_frames: 12,
};
assert.equal(validateUserApprovedTransition(visible, {
  fps: 30,
  sourceShotId: 'S01',
  nextShotId: 'S02',
}).kind, 'wipe');
for (const kind of RETIRED_TRANSITION_KINDS_V3) {
  assert.throws(() => validateUserApprovedTransition({
    ...visible,
    kind,
    options: kind === 'slide'
      ? {direction: 'from-left'}
      : kind === 'flip'
        ? {direction: 'horizontal'}
        : {},
  }, {fps: 30, sourceShotId: 'S01', nextShotId: 'S02'}), /unsupported transition kind/);
}

for (const duration_seconds of [0.29, 0.61]) {
  assert.throws(() => validateUserApprovedTransition({
    ...visible,
    duration_seconds,
    duration_in_frames: Math.round(duration_seconds * 30),
  }, {fps: 30, sourceShotId: 'S01', nextShotId: 'S02'}), /0.3.*0.6/);
}

const whiteboard = {
  ...visible,
  boundary_change_class: 'route_change',
  source_visual_generation_route: 'imagegen',
  next_visual_generation_route: 'srt-whiteboard-animation',
  recommended_transition: {kind: 'wipe', options: {direction: 'from-left'}},
};
assert.equal(validateUserApprovedTransition(whiteboard, {
  fps: 30,
  sourceShotId: 'S01',
  nextShotId: 'S02',
}).boundary_change_class, 'route_change');

const routeOwned = resolveTransitionRecommendation({
  boundaryChangeClass: 'route_change',
  sourceVisualGenerationRoute: 'comic-imagegen',
  nextVisualGenerationRoute: 'srt-whiteboard-animation',
});
assert.deepEqual(routeOwned, {
  recommended_transition: {kind: 'wipe', options: {direction: 'from-right'}},
  recommendation_source: {
    authority: 'visual-generation-route',
    route_id: 'comic-imagegen',
    rule_id: 'legacy-comic-to-whiteboard-v1',
  },
});
assert.deepEqual(resolveTransitionRecommendation({
  boundaryChangeClass: 'route_change',
  sourceVisualGenerationRoute: 'imagegen',
  nextVisualGenerationRoute: 'srt-whiteboard-animation',
}).recommended_transition, {kind: 'wipe', options: {direction: 'from-left'}});

const whiteCatPriority = resolveTransitionRecommendation({
  boundaryChangeClass: 'route_change',
  sourceVisualGenerationRoute: 'ian-handdrawn-ppt',
  nextVisualGenerationRoute: 'imagegen',
  sourceWhiteCatPresent: false,
  nextWhiteCatPresent: true,
});
assert.deepEqual(whiteCatPriority, {
  recommended_transition: {kind: 'watercolor-bloom', options: {}},
  recommendation_source: {
    authority: 'white-cat-transition-policy',
    rule_id: 'imagegen-white-cat-watercolor-bloom-priority-v1',
    matched_boundary_roles: ['next'],
  },
});
assert.equal(resolveTransitionRecommendation({
  boundaryChangeClass: 'route_change',
  sourceVisualGenerationRoute: 'imagegen',
  nextVisualGenerationRoute: 'ian-handdrawn-ppt',
  sourceWhiteCatPresent: true,
  nextWhiteCatPresent: false,
}).recommended_transition.kind, 'watercolor-bloom');
assert.equal(resolveTransitionRecommendation({
  boundaryChangeClass: 'route_change',
  sourceVisualGenerationRoute: 'xuan-paper-diorama',
  nextVisualGenerationRoute: 'ian-handdrawn-ppt',
  sourceWhiteCatPresent: true,
  nextWhiteCatPresent: false,
}).recommended_transition.kind, 'paper-wipe');

const whiteCatApproved = {
  ...visible,
  boundary_change_class: 'route_change',
  source_visual_generation_route: 'ian-handdrawn-ppt',
  next_visual_generation_route: 'imagegen',
  source_white_cat_present: false,
  next_white_cat_present: true,
  recommended_transition: whiteCatPriority.recommended_transition,
  recommendation_source: whiteCatPriority.recommendation_source,
  kind: 'watercolor-bloom',
  options: {},
};
assert.equal(validateUserApprovedTransition(whiteCatApproved, {
  fps: 30,
  sourceShotId: 'S01',
  nextShotId: 'S02',
}).kind, 'watercolor-bloom');

const diversityClasses = [
  'route_change',
  'time_place_change',
  'time_place_change',
  'route_change',
  'route_change',
  'continuity',
  'route_change',
  'route_change',
  'continuity',
  'section_change',
  'route_change',
  'route_change',
  'route_change',
  'route_change',
  'contrast_or_warning',
  'section_change',
  'route_change',
];
const diversityInput = diversityClasses.map((boundaryChangeClass, index) => {
  const resolved = resolveTransitionRecommendation({
    boundaryChangeClass,
    sourceVisualGenerationRoute: 'imagegen',
    nextVisualGenerationRoute: 'ian-handdrawn-ppt',
  });
  return {
    source_shot_id: `S${String(index + 1).padStart(2, '0')}`,
    boundary_change_class: boundaryChangeClass,
    ...resolved,
  };
});
const diversified = applyTransitionRecommendationDiversity(diversityInput);
assert.equal(diversified.policy.rule_id, TRANSITION_RECOMMENDATION_DIVERSITY_RULE_ID);
assert.equal(diversified.policy.max_identical_visible_kind_uses, 4);
assert.equal(diversified.policy.max_identical_visible_kind_absolute_uses, 5);
assert.equal(diversified.policy.max_identical_visible_kind_share, 0.3);
assert.equal(diversified.policy.max_identical_visible_kind_share_uses, 4);
assert.equal(diversified.policy.max_consecutive_identical_visible_kind_uses, 3);
assert.equal(diversified.rows.length, diversityInput.length);
assert.ok(diversified.rows.some((row) => row.diversity_adjustment.applied));
const visibleKindCounts = new Map();
let priorVisibleKind = null;
let visibleRunLength = 0;
let longestVisibleRun = 0;
for (const row of diversified.rows) {
  assert.ok(TRANSITION_CATALOG.some((entry) => entry.kind === row.proposed_transition.kind));
  if (row.proposed_transition.kind === 'cut') {
    priorVisibleKind = null;
    visibleRunLength = 0;
    continue;
  }
  visibleKindCounts.set(
    row.proposed_transition.kind,
    (visibleKindCounts.get(row.proposed_transition.kind) ?? 0) + 1,
  );
  visibleRunLength = priorVisibleKind === row.proposed_transition.kind ? visibleRunLength + 1 : 1;
  longestVisibleRun = Math.max(longestVisibleRun, visibleRunLength);
  priorVisibleKind = row.proposed_transition.kind;
}
assert.ok([...visibleKindCounts.values()].every((count) => count <= 4));
assert.ok([...visibleKindCounts.values()].every((count) => count / diversified.policy.visible_boundary_count <= 0.3));
assert.ok(longestVisibleRun <= 3);
assert.ok(diversified.rows.some((row, index) => (
  index > 0
  && row.proposed_transition.kind !== 'cut'
  && row.proposed_transition.kind === diversified.rows[index - 1].proposed_transition.kind
)), 'the updated rule must permit adjacent identical visible transitions');

const repeatedRouteOwned = diversityInput.map((row, index) => index < 4
  ? {
    source_shot_id: `LEGACY-${index + 1}`,
    boundary_change_class: 'route_change',
    ...routeOwned,
  }
  : row);
assert.throws(
  () => applyTransitionRecommendationDiversity(repeatedRouteOwned),
  /route-specific.*diversity/i,
);

const explicitFadeInput = diversityInput.map((row, index) => index >= 1 && index <= 3
  ? {
    ...row,
    user_requested_transition: {
      transition: {kind: 'fade', options: {}},
      exact_message: 'S02→S03 S03→S04 S04→S05 使用fade',
      requested_at: '2026-08-17T18:00:00+08:00',
      based_on_presented_map_sha256: 'c'.repeat(64),
    },
  }
  : row);
const explicitFadeResult = applyTransitionRecommendationDiversity(explicitFadeInput);
assert.deepEqual(
  explicitFadeResult.rows.slice(1, 4).map((row) => row.proposed_transition.kind),
  ['fade', 'fade', 'fade'],
);
assert.ok(explicitFadeResult.rows.slice(1, 4).every((row) => (
  row.diversity_adjustment.reason.startsWith('explicit-user-request')
)));

const diversifiedApproved = {
  ...visible,
  boundary_change_class: 'route_change',
  recommended_transition: {kind: 'paper-wipe', options: {}},
  kind: 'wipe',
  options: {direction: 'from-left'},
  diversity_adjustment: {
    rule_id: TRANSITION_RECOMMENDATION_DIVERSITY_RULE_ID,
    applied: true,
    base_transition: {kind: 'paper-wipe', options: {}},
    reason: 'balanced-visible-transition-kind-frequency',
  },
};
assert.equal(validateUserApprovedTransition(diversifiedApproved, {
  fps: 30,
  sourceShotId: 'S01',
  nextShotId: 'S02',
}).kind, 'wipe');
assert.throws(() => validateUserApprovedTransition({
  ...diversifiedApproved,
  diversity_adjustment: {...diversifiedApproved.diversity_adjustment, applied: false},
}, {fps: 30, sourceShotId: 'S01', nextShotId: 'S02'}), /diversity adjustment/);

assert.equal(validateRevoiceTransitionLock(visible, structuredClone(visible), {
  fps: 30,
  sourceShotId: 'S01',
  nextShotId: 'S02',
  shotDurationFrames: 90,
}).duration_in_frames, 12);
for (const changed of [
  {...visible, kind: 'fade'},
  {...visible, options: {direction: 'from-right'}},
  {...visible, duration_seconds: 0.5, duration_in_frames: 15},
  {...visible, duration_in_frames: 13},
]) {
  assert.throws(() => validateRevoiceTransitionLock(visible, changed, {
    fps: 30,
    sourceShotId: 'S01',
    nextShotId: 'S02',
    shotDurationFrames: 90,
  }), /revoice|transition/i);
}
assert.throws(() => validateRevoiceTransitionLock(visible, structuredClone(visible), {
  fps: 30,
  sourceShotId: 'S01',
  nextShotId: 'S02',
  shotDurationFrames: 11,
}), /cannot fit/i);

const rendererSource = fs.readFileSync(
  new URL('./TransitionedScene.tsx', import.meta.url),
  'utf8',
);
assert.match(rendererSource, /transition\.kind !== 'cut'/);
assert.match(rendererSource, /transition\?\.kind === 'cut' \? 0/);

const priorPresentedMapSha256 = 'd'.repeat(64);
const nextPresentedMapSha256 = 'e'.repeat(64);
const priorRefreshRows = [
  {
    ...structuredClone(visible),
    user_selection: {
      ...visible.user_selection,
      presented_map_sha256: priorPresentedMapSha256,
    },
  },
  {
    ...structuredClone(visible),
    source_shot_id: 'S02',
    next_shot_id: 'S03',
    user_selection: {
      ...visible.user_selection,
      presented_map_sha256: priorPresentedMapSha256,
    },
  },
];
const pendingRefreshRows = priorRefreshRows.map((row) => ({
  ...structuredClone(row),
  user_selection: {
    status: 'pending',
    exact_message: null,
    decided_at: null,
    presented_map_sha256: null,
  },
}));
const reboundRefreshRows = rebindUnaffectedTransitionApprovals({
  rows: pendingRefreshRows,
  priorRows: priorRefreshRows,
  affectedBoundaryIds: ['S02->S03'],
  priorPresentedMapSha256,
  nextPresentedMapSha256,
  reboundAt: '2026-08-17T21:10:19+08:00',
});
assert.equal(reboundRefreshRows[0].user_selection.status, 'approved');
assert.equal(reboundRefreshRows[0].user_selection.presented_map_sha256, nextPresentedMapSha256);
assert.equal(reboundRefreshRows[0].user_selection.prior_presented_map_sha256, priorPresentedMapSha256);
assert.equal(reboundRefreshRows[1].user_selection.status, 'pending');
assert.equal(reboundRefreshRows[1].prior_user_selection.status, 'approved');
assert.throws(() => rebindUnaffectedTransitionApprovals({
  rows: [{...pendingRefreshRows[0], kind: 'fade'}],
  priorRows: [priorRefreshRows[0]],
  affectedBoundaryIds: [],
  priorPresentedMapSha256,
  nextPresentedMapSha256,
  reboundAt: '2026-08-17T21:10:19+08:00',
}), /cannot be preserved/);

const pendingApprovalProposal = {
  contract_version: 'per-boundary-transition-review-v1',
  status: 'awaiting_user_selection',
  catalog_version: 'scene-transition-catalog-v3',
  storyboard: {path: 'storyboard.md', checksum_sha256: '1'.repeat(64)},
  visual_direction_review: {
    path: 'visual-direction.json',
    checksum_sha256: '2'.repeat(64),
    presented_map_sha256: '3'.repeat(64),
  },
  fps: 30,
  diversity_policy: {rule_id: TRANSITION_RECOMMENDATION_DIVERSITY_RULE_ID},
  fixed_exemptions: {},
  rows: pendingRefreshRows,
};
pendingApprovalProposal.presented_map_sha256 = buildTransitionReviewPresentedMapSha256(
  pendingApprovalProposal,
);
const approvedPending = approvePendingTransitionRows({
  proposal: pendingApprovalProposal,
  exactMessage: '批准这三条转场',
  decidedAt: '2026-08-17T21:20:00+08:00',
});
assert.equal(approvedPending.proposal.status, 'approved');
assert.ok(approvedPending.proposal.rows.every((row) => row.user_selection.status === 'approved'));
assert.deepEqual(approvedPending.pendingBoundaryIds, ['S01->S02', 'S02->S03']);
assert.throws(() => approvePendingTransitionRows({
  proposal: {...pendingApprovalProposal, presented_map_sha256: 'f'.repeat(64)},
  exactMessage: '批准这三条转场',
  decidedAt: '2026-08-17T21:20:00+08:00',
}), /presented map is stale/);

const policyAuthorized = authorizePendingTransitionRowsOneClick({
  proposal: pendingApprovalProposal,
  policySha256: 'e'.repeat(64),
  authorizedAt: '2026-08-17T21:20:00+08:00',
});
assert.equal(policyAuthorized.proposal.status, 'policy_authorized');
assert.ok(policyAuthorized.proposal.rows.every((row) => (
  row.user_selection.status === 'policy_authorized'
  && row.user_selection.user_has_reviewed_specific_map === false
  && row.user_selection.exact_message === null
)));
assert.throws(() => authorizePendingTransitionRowsOneClick({
  proposal: pendingApprovalProposal,
  policySha256: 'forged',
  authorizedAt: '2026-08-17T21:20:00+08:00',
}), /input/);

console.log('scene_transition_selection_v3=pass');
