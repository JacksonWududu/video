import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WHITE_CAT_VISUAL_STYLE_OPTIONS,
  approveOneClickFinalVisualReview,
  assertOneClickProtectedActionAllowed,
  buildOneClickApprovalPolicySha256,
  buildOneClickFinalVisualMapSha256,
  buildNarrationAudioSourceSelectionSha256,
  buildVisualDensitySelectionSha256,
  buildWhiteCatVisualStyleSelectionSha256,
  buildWorkflowApprovalModeSha256,
  calculateSelectionInvalidation,
  resolveLegacyDensity,
  validateApprovalSelectionSequence,
  validateOneClickApprovalPolicy,
  validateNarrationAudioSourceSelection,
  validateRevoiceDensityLock,
  validateWhiteCatVisualStyleSelection,
} from './contract.mjs';

const gate2 = '1'.repeat(64);
const decision = (message) => ({status: 'selected', exact_message: message, decided_at: '2026-08-22T10:00:00+08:00'});

const buildSelections = ({
  whiteCatStyleId = 'loose-line-vivid-watercolor',
  densityMode = 'rich',
  approvalMode = 'one_click',
} = {}) => {
  const whiteCatStyle = {
    contract_version: 'white-cat-visual-style-selection-v1',
    gate2_script_sha256: gate2,
    style_id: whiteCatStyleId,
    ...WHITE_CAT_VISUAL_STYLE_OPTIONS[whiteCatStyleId],
    decision: decision(whiteCatStyleId),
  };
  whiteCatStyle.selection_sha256 = buildWhiteCatVisualStyleSelectionSha256(whiteCatStyle);
  const density = {
    contract_version: 'visual-density-selection-v1',
    gate2_script_sha256: gate2,
    white_cat_visual_style_selection_sha256: whiteCatStyle.selection_sha256,
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
    white_cat_visual_style_selection_sha256: whiteCatStyle.selection_sha256,
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
  return {whiteCatStyle, density, mode, policy};
};

test('selection order requires white-cat style, density, approval mode, and exact hashes', () => {
  const {whiteCatStyle, density, mode, policy} = buildSelections();
  assert.equal(validateApprovalSelectionSequence({
    gate2ScriptSha256: gate2, whiteCatStyle, density, mode, policy,
  }).result, 'pass');
  assert.throws(
    () => validateApprovalSelectionSequence({gate2ScriptSha256: gate2, whiteCatStyle: null, density, mode, policy}),
    /white-cat visual style selection authority mismatch/,
  );
  assert.throws(
    () => validateApprovalSelectionSequence({gate2ScriptSha256: gate2, whiteCatStyle, density: null, mode, policy}),
    /visual density selection authority mismatch/,
  );
  mode.visual_density_selection_sha256 = '2'.repeat(64);
  assert.throws(
    () => validateApprovalSelectionSequence({gate2ScriptSha256: gate2, whiteCatStyle, density, mode, policy}),
    /stale or selected before visual density/,
  );
});

test('Gate 2 white-cat style selection accepts only the two pinned profiles', () => {
  const twilight = buildSelections({whiteCatStyleId: 'twilight-neon-animation'}).whiteCatStyle;
  assert.equal(validateWhiteCatVisualStyleSelection(twilight, {gate2ScriptSha256: gate2}).style_id,
    'twilight-neon-animation');
  const substituted = structuredClone(twilight);
  substituted.style_profile_checksum_sha256 = '0'.repeat(64);
  substituted.selection_sha256 = buildWhiteCatVisualStyleSelectionSha256(substituted);
  assert.throws(
    () => validateWhiteCatVisualStyleSelection(substituted, {gate2ScriptSha256: gate2}),
    /stale or substituted style_profile_checksum_sha256/,
  );
});

test('Gate 2 change invalidates all downstream selections', () => {
  const {whiteCatStyle, density, mode, policy} = buildSelections();
  assert.throws(
    () => validateApprovalSelectionSequence({
      gate2ScriptSha256: '3'.repeat(64), whiteCatStyle, density, mode, policy,
    }),
    /white-cat visual style selection is stale after Gate 2 change/,
  );
  assert.deepEqual(calculateSelectionInvalidation({change: 'gate2_script'}), {
    keep_locked_script: false,
    keep_audio: false,
    invalidate_white_cat_visual_style_selection: true,
    invalidate_visual_density_selection: true,
    invalidate_workflow_approval_mode: true,
    invalidate_narration_audio_source_selection: true,
    invalidate_from: 'gate2',
  });
});

test('white-cat style change preserves valid script and audio but restarts post-Gate-2 choices', () => {
  assert.deepEqual(calculateSelectionInvalidation({change: 'white_cat_visual_style'}), {
    keep_locked_script: true,
    keep_audio: true,
    invalidate_white_cat_visual_style_selection: false,
    invalidate_visual_density_selection: true,
    invalidate_workflow_approval_mode: true,
    invalidate_narration_audio_source_selection: true,
    invalidate_from: 'awaiting_visual_density_selection',
  });
});

test('density change preserves valid script and audio but restarts storyboard', () => {
  assert.deepEqual(calculateSelectionInvalidation({change: 'visual_density'}), {
    keep_locked_script: true,
    keep_audio: true,
    invalidate_white_cat_visual_style_selection: false,
    invalidate_visual_density_selection: false,
    invalidate_workflow_approval_mode: true,
    invalidate_narration_audio_source_selection: true,
    invalidate_from: 'storyboard_construction',
  });
});

test('narration audio source change preserves selections but rebuilds audio timing', () => {
  assert.deepEqual(calculateSelectionInvalidation({change: 'narration_audio_source'}), {
    keep_locked_script: true,
    keep_audio: false,
    invalidate_white_cat_visual_style_selection: false,
    invalidate_visual_density_selection: false,
    invalidate_workflow_approval_mode: false,
    invalidate_narration_audio_source_selection: false,
    invalidate_from: 'audio_validation',
  });
});

test('forged one-click policy fails closed', () => {
  const {whiteCatStyle, density, mode, policy} = buildSelections();
  policy.user_has_reviewed_specific_maps = true;
  policy.policy_sha256 = buildOneClickApprovalPolicySha256(policy);
  assert.throws(
    () => validateOneClickApprovalPolicy(policy, {
      gate2ScriptSha256: gate2,
      whiteCatVisualStyleSelectionSha256: whiteCatStyle.selection_sha256,
      visualDensitySelectionSha256: density.selection_sha256,
      workflowApprovalModeSelectionSha256: mode.selection_sha256,
    }),
    /may not claim specific-map review/,
  );
});

test('one-click policy cannot preauthorize visible-text approval', () => {
  const {whiteCatStyle, density, mode, policy} = buildSelections();
  policy.preauthorizations.visible_text_approval = true;
  policy.policy_sha256 = buildOneClickApprovalPolicySha256(policy);
  assert.throws(
    () => validateOneClickApprovalPolicy(policy, {
      gate2ScriptSha256: gate2,
      whiteCatVisualStyleSelectionSha256: whiteCatStyle.selection_sha256,
      visualDensitySelectionSha256: density.selection_sha256,
      workflowApprovalModeSelectionSha256: mode.selection_sha256,
    }),
    /unknown or forged preauthorization fields/,
  );
});

test('manual mode preserves existing approval checkpoints and rejects one-click policy', () => {
  const {whiteCatStyle, density, mode} = buildSelections({densityMode: 'standard', approvalMode: 'manual'});
  assert.equal(validateApprovalSelectionSequence({
    gate2ScriptSha256: gate2, whiteCatStyle, density, mode, policy: null,
  }).approval_mode, 'manual');
  assert.throws(
    () => validateApprovalSelectionSequence({gate2ScriptSha256: gate2, whiteCatStyle, density, mode, policy: {}}),
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

test('narration audio source requires an explicit locked-script-bound choice', () => {
  const {mode} = buildSelections();
  const selection = {
    contract_version: 'narration-audio-source-selection-v1',
    gate2_script_sha256: gate2,
    workflow_approval_mode_selection_sha256: mode.selection_sha256,
    source_mode: 'edge_tts',
    edge_tts: {
      provider: 'edge-tts',
      voice: 'zh-CN-YunjianNeural',
      rate: '+20%',
      network_access_authorized: true,
    },
    decision: decision('使用 edge-tts，云健，+20%'),
  };
  selection.selection_sha256 = buildNarrationAudioSourceSelectionSha256(selection);
  assert.equal(validateNarrationAudioSourceSelection(selection, {
    gate2ScriptSha256: gate2,
    workflowApprovalModeSelectionSha256: mode.selection_sha256,
  }).source_mode, 'edge_tts');
  selection.edge_tts.voice = 'zh-CN-YunxiNeural';
  selection.selection_sha256 = buildNarrationAudioSourceSelectionSha256(selection);
  assert.throws(
    () => validateNarrationAudioSourceSelection(selection, {
      gate2ScriptSha256: gate2,
      workflowApprovalModeSelectionSha256: mode.selection_sha256,
    }),
    /YunjianNeural/,
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
