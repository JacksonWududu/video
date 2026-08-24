import assert from 'node:assert/strict';
import test from 'node:test';

import {
  approveOneClickFinalVisualReview,
  assertOneClickProtectedActionAllowed,
  buildOneClickApprovalPolicySha256,
  buildOneClickFinalVisualMapSha256,
  buildVisualDensitySelectionSha256,
  buildWorkflowApprovalModeSha256,
  calculateSelectionInvalidation,
  resolveLegacyDensity,
  validateApprovalSelectionSequence,
  validateOneClickApprovalPolicy,
  validateRevoiceDensityLock,
} from './contract.mjs';

const gate2 = '1'.repeat(64);
const decision = (message) => ({status: 'selected', exact_message: message, decided_at: '2026-08-22T10:00:00+08:00'});

const buildSelections = ({densityMode = 'rich', approvalMode = 'one_click'} = {}) => {
  const density = {
    contract_version: 'visual-density-selection-v1',
    gate2_script_sha256: gate2,
    density_mode: densityMode,
    decision: decision(densityMode),
  };
  density.selection_sha256 = buildVisualDensitySelectionSha256(density);
  const mode = {
    contract_version: 'workflow-approval-mode-v1',
    gate2_script_sha256: gate2,
    visual_density_selection_sha256: density.selection_sha256,
    approval_mode: approvalMode,
    decision: decision(approvalMode),
  };
  mode.selection_sha256 = buildWorkflowApprovalModeSha256(mode);
  const policy = approvalMode === 'one_click' ? {
    contract_version: 'one-click-approval-policy-v1',
    gate2_script_sha256: gate2,
    visual_density_selection_sha256: density.selection_sha256,
    workflow_approval_mode_selection_sha256: mode.selection_sha256,
    preauthorizations: {
      audio_lookup: true,
      deterministic_visual_direction_recommendations: true,
      deterministic_transition_recommendations: true,
      storyboard_review: true,
      continue_during_visual_production: true,
    },
    user_has_reviewed_specific_maps: false,
    final_visual_review_required: true,
    qa_bypass_forbidden: true,
  } : null;
  if (policy) policy.policy_sha256 = buildOneClickApprovalPolicySha256(policy);
  return {density, mode, policy};
};

test('selection order requires density before approval mode and exact hashes', () => {
  const {density, mode, policy} = buildSelections();
  assert.equal(validateApprovalSelectionSequence({gate2ScriptSha256: gate2, density, mode, policy}).result, 'pass');
  assert.throws(
    () => validateApprovalSelectionSequence({gate2ScriptSha256: gate2, density: null, mode, policy}),
    /visual density selection authority mismatch/,
  );
  mode.visual_density_selection_sha256 = '2'.repeat(64);
  assert.throws(
    () => validateApprovalSelectionSequence({gate2ScriptSha256: gate2, density, mode, policy}),
    /stale or selected before visual density/,
  );
});

test('Gate 2 change invalidates both selections', () => {
  const {density, mode, policy} = buildSelections();
  assert.throws(
    () => validateApprovalSelectionSequence({gate2ScriptSha256: '3'.repeat(64), density, mode, policy}),
    /stale after Gate 2 change/,
  );
  assert.deepEqual(calculateSelectionInvalidation({change: 'gate2_script'}), {
    keep_locked_script: false,
    keep_audio: false,
    invalidate_visual_density_selection: true,
    invalidate_workflow_approval_mode: true,
    invalidate_from: 'gate2',
  });
});

test('density change preserves valid script and audio but restarts storyboard', () => {
  assert.deepEqual(calculateSelectionInvalidation({change: 'visual_density'}), {
    keep_locked_script: true,
    keep_audio: true,
    invalidate_visual_density_selection: false,
    invalidate_workflow_approval_mode: true,
    invalidate_from: 'storyboard_construction',
  });
});

test('forged one-click policy fails closed', () => {
  const {density, mode, policy} = buildSelections();
  policy.user_has_reviewed_specific_maps = true;
  policy.policy_sha256 = buildOneClickApprovalPolicySha256(policy);
  assert.throws(
    () => validateOneClickApprovalPolicy(policy, {
      gate2ScriptSha256: gate2,
      visualDensitySelectionSha256: density.selection_sha256,
      workflowApprovalModeSelectionSha256: mode.selection_sha256,
    }),
    /may not claim specific-map review/,
  );
});

test('one-click policy cannot preauthorize visible-text approval', () => {
  const {density, mode, policy} = buildSelections();
  policy.preauthorizations.visible_text_approval = true;
  policy.policy_sha256 = buildOneClickApprovalPolicySha256(policy);
  assert.throws(
    () => validateOneClickApprovalPolicy(policy, {
      gate2ScriptSha256: gate2,
      visualDensitySelectionSha256: density.selection_sha256,
      workflowApprovalModeSelectionSha256: mode.selection_sha256,
    }),
    /unknown or forged preauthorization fields/,
  );
});

test('manual mode preserves existing approval checkpoints and rejects one-click policy', () => {
  const {density, mode} = buildSelections({densityMode: 'standard', approvalMode: 'manual'});
  assert.equal(validateApprovalSelectionSequence({gate2ScriptSha256: gate2, density, mode, policy: null}).approval_mode, 'manual');
  assert.throws(
    () => validateApprovalSelectionSequence({gate2ScriptSha256: gate2, density, mode, policy: {}}),
    /manual mode must not carry/,
  );
});

test('started episode without selection stays legacy standard unless rebuilt', () => {
  assert.equal(resolveLegacyDensity({episodeStarted: true, densitySelection: null}), 'legacy_standard');
  assert.throws(
    () => resolveLegacyDensity({episodeStarted: true, densitySelection: null, explicitRebuild: true}),
    /requires visual density selection/,
  );
});

const buildFinalReview = () => {
  const review = {
    contract_version: 'visual-asset-review-v3',
    mode: 'one_click_final_review_v1',
    storyboard_sha256: '4'.repeat(64),
    policy_sha256: '5'.repeat(64),
    assets: [
      {asset_id: 'S01-state-01', path: 'assets/s01.png', checksum_sha256: '6'.repeat(64), qa_status: 'qa_passed_pending_final_review'},
      {asset_id: 'S01-state-02', path: 'assets/s02.png', checksum_sha256: '7'.repeat(64), qa_status: 'qa_passed_pending_final_review'},
    ],
  };
  review.presented_map_sha256 = buildOneClickFinalVisualMapSha256(review);
  return review;
};

test('one-click production continues after QA but blocks composition until final approval and caption choice', () => {
  const review = buildFinalReview();
  assert.throws(
    () => assertOneClickProtectedActionAllowed({
      phase: 'awaiting_precomposition_visual_review',
      captionDelivery: null,
      visualReview: review,
    }, 'composition'),
    /forbidden before final visual approval/,
  );
  const approved = approveOneClickFinalVisualReview(review, {
    status: 'approved',
    exact_message: '批准完整精确哈希清单',
    decided_at: '2026-08-22T11:00:00+08:00',
    presented_map_sha256: review.presented_map_sha256,
  });
  assert.equal(approved.next_phase, 'awaiting_caption_delivery_choice');
  assert.ok(approved.assets.every(({qa_status}) => qa_status === 'approved'));
  assert.throws(
    () => assertOneClickProtectedActionAllowed({phase: approved.next_phase, captionDelivery: null, visualReview: approved}, 'still'),
    /before caption delivery choice/,
  );
  assert.equal(assertOneClickProtectedActionAllowed({
    phase: 'assembly_preflight',
    captionDelivery: {status: 'selected'},
    visualReview: approved,
  }, 'preview').result, 'pass');
});

test('final approval rejects stale or partial exact hash list', () => {
  const review = buildFinalReview();
  review.assets[0].checksum_sha256 = '8'.repeat(64);
  assert.throws(
    () => approveOneClickFinalVisualReview(review, {
      status: 'approved',
      exact_message: '批准',
      decided_at: '2026-08-22T11:00:00+08:00',
      presented_map_sha256: review.presented_map_sha256,
    }),
    /map checksum is stale/,
  );
});

test('revoice density count order and hashes are immutable', () => {
  const parent = {
    density_mode: 'rich',
    visual_density_selection_sha256: 'a'.repeat(64),
    rhythm_sha256: 'b'.repeat(64),
    action_schedule_set_sha256: 'c'.repeat(64),
    asset_counts: [5, 12],
    asset_order: ['S01-a', 'S01-b'],
  };
  assert.equal(validateRevoiceDensityLock({parent, derivative: structuredClone(parent)}).result, 'pass');
  const derivative = structuredClone(parent);
  derivative.density_mode = 'standard';
  assert.throws(() => validateRevoiceDensityLock({parent, derivative}), /preserve parent density/);
});
