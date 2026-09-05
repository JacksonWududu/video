import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCoverDerivedStyleProfileSha256,
  buildCoverStyleScopeSelectionSha256,
  buildPublishingCoverPackageSha256,
  validateCoverDerivedStyleProfile,
  validateCoverStyleScopeSelection,
  validatePublishingCoverPackage,
} from './contract.mjs';
import {buildOneTimeUserGateOverrideSha256} from '../user-gate-override/contract.mjs';

const sha = (character) => character.repeat(64);
const packageBindings = {
  episodeId: 'episode-test',
  gate1TopicSha256: sha('1'), gate1ExactThemeWords: '知识', gate2ScriptSha256: sha('2'),
  canonicalWhiteCatReferencePath: '/canonical/white-cat.png',
  canonicalWhiteCatReferenceSha256: sha('3'),
};
const characterChecks = [{index: 1, expected: '知', observed: '知', result: 'pass'}];
const fixedSafeBox = {
  landscape_16_9: {width: 0.40, height: 0.84},
  portrait_9_16: {width: 0.84, height: 0.64},
  landscape_4_3: {width: 0.44, height: 0.68},
};
const asset = (role, width, height, checksum, whiteCatMode) => {
  const fixed = whiteCatMode === 'fixed_centered_reference';
  return {
    role, path: `topic/assets/image/${role}.png`, checksum_sha256: checksum,
    prompt_checksum_sha256: sha('e'), width, height, qa_status: 'qa_accepted_by_codex',
    generation_attempt_scope_id: `publishing-cover:${role}`,
    generation_attempt_count: 1, rejected_outputs: [], automatic_retry_status: 'accepted',
    white_cat_layout: fixed ? {
      mode: whiteCatMode,
      scale_policy: 'uniform_contain_reference_bbox_v1',
      safe_box_width_ratio: fixedSafeBox[role].width,
      safe_box_height_ratio: fixedSafeBox[role].height,
      center_x_ratio: 0.5,
      center_y_ratio: 0.5,
      reference_form_preserved: true,
    } : {mode: whiteCatMode},
    qa: {
      narration_consistency: 'pass', white_cat_identity: 'pass', text_accuracy: 'pass',
      cover_effectiveness: 'pass', style_transferability: 'pass', extra_text_count: 0,
      character_checks: characterChecks,
      ...(fixed ? {
        fixed_reference_form: 'pass',
        geometric_centering: 'pass',
        aspect_relative_scale: 'pass',
      } : {}),
    },
  };
};

const buildPackage = (whiteCatMode = 'narrative_adaptive') => {
  const value = {
    contract_version: 'publishing-cover-generation-v1',
    episode_id: 'episode-test',
    gate1_topic_sha256: sha('1'), gate2_script_sha256: sha('2'),
    exact_theme_words: '知识', title_source: 'gate1_exact_topic',
    white_cat_reference: {path: '/canonical/white-cat.png', checksum_sha256: sha('3')},
    generation_policy: {
      contract_version: 'publishing-cover-generation-policy-v2',
      style_mode: 'open_unconstrained', style_reference_count: 0,
      independent_aspect_compositions: true, maximum_automatic_rounds: 3,
      white_cat_mode: whiteCatMode,
      white_cat_mode_selection: {
        status: 'selected', value: whiteCatMode,
        exact_message: whiteCatMode === 'narrative_adaptive' ? '选择叙事白猫' : '选择固定白猫',
        decided_at: '2026-08-28T10:00:00+08:00',
      },
    },
    generation_rounds_used: 1,
    delegated_review: {
      authority: 'user_delegated_cover_qa', status: 'qa_accepted_by_codex',
      user_approval_claimed: false, exact_authorization_message: '生成完之后代我确认',
    },
    assets: {
      landscape_16_9: asset('landscape_16_9', 1920, 1080, sha('4'), whiteCatMode),
      portrait_9_16: asset('portrait_9_16', 1080, 1920, sha('5'), whiteCatMode),
      landscape_4_3: asset('landscape_4_3', 1600, 1200, sha('6'), whiteCatMode),
    },
  };
  value.package_sha256 = buildPublishingCoverPackageSha256(value);
  return value;
};

test('delegated QA accepts an exact Gate-bound three-aspect publishing cover package', () => {
  const value = buildPackage();
  assert.equal(validatePublishingCoverPackage(value, packageBindings).result, 'pass');
});

test('publishing cover accepts fixed centered white-cat layouts for every aspect', () => {
  const value = buildPackage('fixed_centered_reference');
  assert.equal(validatePublishingCoverPackage(value, packageBindings).result, 'pass');

  value.assets.portrait_9_16.white_cat_layout.center_x_ratio = 0.53;
  value.package_sha256 = buildPublishingCoverPackageSha256(value);
  assert.throws(() => validatePublishingCoverPackage(value, packageBindings), /fixed white-cat layout/);

  value.assets.portrait_9_16.white_cat_layout.center_x_ratio = 0.5;
  value.assets.portrait_9_16.qa.fixed_reference_form = 'reject';
  value.package_sha256 = buildPublishingCoverPackageSha256(value);
  assert.throws(() => validatePublishingCoverPackage(value, packageBindings), /fixed white-cat QA/);
});

test('publishing cover preserves failed QA but advances once with an exact consumed user override', () => {
  const value = buildPackage('fixed_centered_reference');
  for (const cover of Object.values(value.assets)) {
    cover.prompt_checksum_sha256 = null;
    cover.prompt_evidence_status = 'not_projected_from_tool_call_waived_once';
  }
  const portrait = value.assets.portrait_9_16;
  portrait.generation_attempt_count = 3;
  portrait.rejected_outputs = ['a', 'b', 'c'].map((marker, index) => ({
    prompt_checksum_sha256: null,
    prompt_evidence_status: 'not_projected_from_tool_call_waived_once',
    output_checksum_sha256: sha(marker),
    reason: index === 2 ? 'fixed centered geometry' : `earlier rejection ${index + 1}`,
  }));
  portrait.automatic_retry_status = 'stopped_user_takeover_required';
  portrait.selected_rejected_output_attempt = 3;
  portrait.mechanical_result = 'rejected_fixed_centered_geometry';
  portrait.qa_status = 'rejected_with_user_override';
  portrait.white_cat_layout.center_y_ratio = 0.56;
  portrait.qa.geometric_centering = 'reject';

  value.generation_rounds_used = 3;
  value.delegated_review.status = 'pass_with_user_override';
  value.delegated_review.user_approval_claimed = true;
  const gateIds = [
    'publishing_cover.prompt_evidence_projection',
    'publishing_cover.portrait_9_16.fixed_centered_geometry',
  ];
  value.user_mechanical_gate_override = {
    contract_version: 'one-time-explicit-user-mechanical-gate-override-v1',
    episode_id: 'episode-test',
    scope_id: 'episode-test:publishing-cover:v1',
    gate_ids: gateIds,
    acknowledged_failures: gateIds.map((gateId) => ({
      gate_id: gateId,
      observed_result: 'fail',
      reason: 'current cover evidence failed this gate',
    })),
    bound_artifacts: ['landscape_16_9', 'portrait_9_16', 'landscape_4_3'].map((role) => ({
      path: value.assets[role].path,
      checksum_sha256: value.assets[role].checksum_sha256,
    })),
    decision: {
      exact_user_message: '放行当前封面门禁',
      decided_at: '2026-08-29T15:00:00+08:00',
      disposition: 'allow_once',
    },
    consumption: {
      from_phase: 'stopped_user_takeover_required',
      to_phase: 'awaiting_video_style_selection',
      status: 'consumed',
      consumed_transition_id: 'episode-test:cover-to-style:1',
      consumed_at: '2026-08-29T15:00:01+08:00',
    },
    reuse_forbidden: true,
  };
  value.user_mechanical_gate_override.override_sha256 =
    buildOneTimeUserGateOverrideSha256(value.user_mechanical_gate_override);
  value.package_sha256 = buildPublishingCoverPackageSha256(value);

  assert.equal(validatePublishingCoverPackage(value, packageBindings).result, 'pass_with_user_override');

  value.user_mechanical_gate_override.consumption.status = 'available';
  value.user_mechanical_gate_override.override_sha256 =
    buildOneTimeUserGateOverrideSha256(value.user_mechanical_gate_override);
  value.package_sha256 = buildPublishingCoverPackageSha256(value);
  assert.throws(() => validatePublishingCoverPackage(value, packageBindings), /transition or status mismatch/);
});

const buildFixedFormOverridePackage = (failedChecks = ['fixed_reference_form', 'aspect_relative_scale']) => {
  const value = buildPackage('fixed_centered_reference');
  const portrait = value.assets.portrait_9_16;
  Object.assign(portrait, {
    generation_attempt_count: 3,
    rejected_outputs: ['a', 'b', '5'].map((marker, index) => ({
      prompt_checksum_sha256: sha('e'), output_checksum_sha256: sha(marker),
      reason: index === 2 ? failedChecks.join(', ') : `earlier rejection ${index + 1}`,
    })),
    automatic_retry_status: 'stopped_user_takeover_required',
    selected_rejected_output_attempt: 3,
    mechanical_result: 'rejected_fixed_reference_form_or_aspect_relative_scale',
    qa_status: 'rejected_with_user_override',
  });
  for (const check of failedChecks) portrait.qa[check] = 'reject';
  portrait.white_cat_layout.reference_form_preserved = !failedChecks.includes('fixed_reference_form');
  value.generation_rounds_used = 3;
  value.delegated_review.status = 'pass_with_user_override';
  value.delegated_review.user_approval_claimed = true;
  const gateIds = failedChecks.map((check) => `publishing_cover.portrait_9_16.${check}`);
  value.user_mechanical_gate_override = {
    contract_version: 'one-time-explicit-user-mechanical-gate-override-v1',
    episode_id: 'episode-test', scope_id: 'episode-test:publishing-cover:v2',
    gate_ids: gateIds,
    acknowledged_failures: gateIds.map((gateId) => ({
      gate_id: gateId, observed_result: 'reject', reason: 'current fixed white-cat QA rejected',
    })),
    bound_artifacts: Object.values(value.assets).map((cover) => ({
      path: cover.path, checksum_sha256: cover.checksum_sha256,
    })),
    decision: {
      exact_user_message: '放行当前固定白猫形态与比例门禁',
      decided_at: '2026-09-04T10:00:00+08:00', disposition: 'allow_once',
    },
    consumption: {
      from_phase: 'stopped_user_takeover_required',
      to_phase: 'awaiting_post_cover_selection_batch', status: 'consumed',
      consumed_transition_id: 'episode-test:cover-to-selection-batch:1',
      consumed_at: '2026-09-04T10:00:01+08:00',
    },
    reuse_forbidden: true,
  };
  return refreshOverridePackage(value);
};

const refreshOverridePackage = (value) => {
  if (value.user_mechanical_gate_override) {
    value.user_mechanical_gate_override.override_sha256 =
      buildOneTimeUserGateOverrideSha256(value.user_mechanical_gate_override);
  }
  value.package_sha256 = buildPublishingCoverPackageSha256(value);
  return value;
};

for (const failedChecks of [
  ['fixed_reference_form'], ['aspect_relative_scale'], ['fixed_reference_form', 'aspect_relative_scale'],
]) {
  test(`publishing cover waives only rejected ${failedChecks.join(' and ')} without rewriting evidence`, () => {
    const value = buildFixedFormOverridePackage(failedChecks);
    const original = structuredClone(value);
    assert.equal(validatePublishingCoverPackage(value, packageBindings).result, 'pass_with_user_override');
    assert.deepEqual(value, original);
  });
}

test('fixed form and scale failures require the exact complete override gate set', () => {
  const value = buildFixedFormOverridePackage();
  delete value.user_mechanical_gate_override;
  refreshOverridePackage(value);
  assert.throws(() => validatePublishingCoverPackage(value, packageBindings), /require an exact one-time user override/);

  const missingGate = buildFixedFormOverridePackage();
  missingGate.user_mechanical_gate_override.gate_ids.pop();
  missingGate.user_mechanical_gate_override.acknowledged_failures.pop();
  refreshOverridePackage(missingGate);
  assert.throws(() => validatePublishingCoverPackage(missingGate, packageBindings), /scope mismatch/);
});

test('fixed form override rejects stale hashes and wrong consumption state or phases', () => {
  for (const [mutate, error] of [
    [(value) => { value.assets.portrait_9_16.checksum_sha256 = sha('9'); }, /artifact binding mismatch/],
    [(value) => { delete value.user_mechanical_gate_override.bound_artifacts[0].checksum_sha256; }, /artifact binding mismatch/],
    [(value) => { value.user_mechanical_gate_override.consumption.status = 'available'; }, /transition or status mismatch/],
    [(value) => { value.user_mechanical_gate_override.consumption.from_phase = 'audio_validation'; }, /transition or status mismatch/],
    [(value) => { value.user_mechanical_gate_override.consumption.to_phase = 'audio_validation'; }, /transition/],
  ]) {
    const value = buildFixedFormOverridePackage();
    mutate(value);
    refreshOverridePackage(value);
    assert.throws(() => validatePublishingCoverPackage(value, packageBindings), error);
  }
  const stale = buildFixedFormOverridePackage();
  stale.user_mechanical_gate_override.override_sha256 = sha('0');
  stale.package_sha256 = buildPublishingCoverPackageSha256(stale);
  assert.throws(() => validatePublishingCoverPackage(stale, packageBindings), /override checksum is stale/);
});

test('publishing cover override can bind the expected registered transition explicitly', () => {
  const value = buildFixedFormOverridePackage();
  assert.equal(validatePublishingCoverPackage(value, {
    ...packageBindings, overrideToPhase: 'awaiting_post_cover_selection_batch',
  }).result, 'pass_with_user_override');
  assert.throws(() => validatePublishingCoverPackage(value, {
    ...packageBindings, overrideToPhase: 'awaiting_video_style_selection',
  }), /transition or status mismatch/);
  assert.throws(() => validatePublishingCoverPackage(value, {
    ...packageBindings, overrideToPhase: 'audio_validation',
  }), /target transition is invalid/);
});

test('fixed form override may not rewrite rejected QA, layout, or the three-rejection stop', () => {
  for (const mutate of [
    (value) => { value.assets.portrait_9_16.qa.fixed_reference_form = 'pass'; },
    (value) => { value.assets.portrait_9_16.white_cat_layout.reference_form_preserved = true; },
    (value) => { value.assets.portrait_9_16.qa_status = 'qa_accepted_by_codex'; },
    (value) => { value.assets.portrait_9_16.rejected_outputs.pop(); },
    (value) => { value.assets.portrait_9_16.mechanical_result = 'pass'; },
    (value) => {
      Object.assign(value.assets.portrait_9_16, {
        generation_attempt_count: 1, rejected_outputs: [], automatic_retry_status: 'accepted',
      });
      value.generation_rounds_used = 1;
    },
  ]) {
    const value = buildFixedFormOverridePackage();
    mutate(value);
    refreshOverridePackage(value);
    assert.throws(() => validatePublishingCoverPackage(value, packageBindings));
  }
});

test('fixed form override leaves unwaived centering and other QA failures blocked', () => {
  for (const [mutate, error] of [
    [(value) => { value.assets.portrait_9_16.white_cat_layout.center_y_ratio = 0.56; }, /fixed white-cat layout/],
    [(value) => { value.assets.portrait_9_16.qa.white_cat_identity = 'reject'; }, /structured QA/],
    [(value) => { delete value.generation_policy.contract_version; }, /override mode is invalid/],
  ]) {
    const value = buildFixedFormOverridePackage();
    mutate(value);
    refreshOverridePackage(value);
    assert.throws(() => validatePublishingCoverPackage(value, packageBindings), error);
  }
});

test('fixed centered 4:3 cover uses the reduced white-cat safe box', () => {
  const value = buildPackage('fixed_centered_reference');
  value.assets.landscape_4_3.white_cat_layout.safe_box_width_ratio = 0.50;
  value.assets.landscape_4_3.white_cat_layout.safe_box_height_ratio = 0.78;
  value.package_sha256 = buildPublishingCoverPackageSha256(value);
  assert.throws(() => validatePublishingCoverPackage(value, packageBindings), /fixed white-cat layout/);
});

test('current publishing cover policy requires an explicit white-cat mode selection', () => {
  const value = buildPackage();
  delete value.generation_policy.white_cat_mode_selection;
  value.package_sha256 = buildPublishingCoverPackageSha256(value);
  assert.throws(() => validatePublishingCoverPackage(value, packageBindings), /mode selection/);
});

test('unchanged legacy publishing cover policy remains readable', () => {
  const value = buildPackage();
  delete value.generation_policy.contract_version;
  delete value.generation_policy.white_cat_mode;
  delete value.generation_policy.white_cat_mode_selection;
  for (const cover of Object.values(value.assets)) delete cover.white_cat_layout;
  value.package_sha256 = buildPublishingCoverPackageSha256(value);
  assert.equal(validatePublishingCoverPackage(value, packageBindings).result, 'pass');
});

test('publishing cover rejects substituted topic words and white-cat references', () => {
  const value = buildPackage();
  value.exact_theme_words = '近似标题';
  value.package_sha256 = buildPublishingCoverPackageSha256(value);
  assert.throws(() => validatePublishingCoverPackage(value, packageBindings), /exact Gate 1 topic/);
  value.exact_theme_words = '知识';
  value.white_cat_reference.checksum_sha256 = sha('9');
  value.package_sha256 = buildPublishingCoverPackageSha256(value);
  assert.throws(() => validatePublishingCoverPackage(value, packageBindings), /stale or substituted/);
});

test('publishing cover may not fabricate user approval or exceed three rounds', () => {
  const value = buildPackage();
  value.delegated_review.user_approval_claimed = true;
  value.package_sha256 = buildPublishingCoverPackageSha256(value);
  assert.throws(() => validatePublishingCoverPackage(value, packageBindings), /delegated review/);
  value.delegated_review.user_approval_claimed = false;
  value.generation_rounds_used = 4;
  value.package_sha256 = buildPublishingCoverPackageSha256(value);
  assert.throws(() => validatePublishingCoverPackage(value, packageBindings), /generation policy/);
});

test('publishing cover counts rejected outputs independently per aspect', () => {
  const value = buildPackage();
  value.assets.landscape_4_3.generation_attempt_count = 2;
  value.assets.landscape_4_3.rejected_outputs = [{
    prompt_checksum_sha256: sha('a'), output_checksum_sha256: sha('b'), reason: 'text_accuracy',
  }];
  value.generation_rounds_used = 2;
  value.package_sha256 = buildPublishingCoverPackageSha256(value);
  assert.equal(validatePublishingCoverPackage(value, packageBindings).result, 'pass');

  value.assets.landscape_4_3.generation_attempt_count = 4;
  value.package_sha256 = buildPublishingCoverPackageSha256(value);
  assert.throws(() => validatePublishingCoverPackage(value, packageBindings), /attempt evidence/);
});

test('publishing cover requires a native 4:3 asset', () => {
  const missing = buildPackage();
  delete missing.assets.landscape_4_3;
  missing.package_sha256 = buildPublishingCoverPackageSha256(missing);
  assert.throws(() => validatePublishingCoverPackage(missing, packageBindings), /landscape_4_3 role mismatch/);

  const wrongRatio = buildPackage();
  wrongRatio.assets.landscape_4_3.width = 1920;
  wrongRatio.assets.landscape_4_3.height = 1080;
  wrongRatio.package_sha256 = buildPublishingCoverPackageSha256(wrongRatio);
  assert.throws(() => validatePublishingCoverPackage(wrongRatio, packageBindings), /landscape_4_3 aspect ratio is invalid/);
});

test('cover-derived style separates transferable style from cover content and typography', () => {
  const cover = buildPackage();
  const axes = Object.fromEntries([
    'medium_and_substrate', 'mark_making', 'palette', 'contrast_and_lighting',
    'edge_behavior', 'texture', 'shape_modeling', 'composition_and_negative_space',
    'mood', 'transformation_strength',
  ].map((key) => [key, key]));
  const profile = {
    contract_version: 'cover-derived-style-profile-v1',
    publishing_cover_package_path: 'topic/schema/publishing-cover-generation-v1.json',
    publishing_cover_package_sha256: cover.package_sha256,
    reference_assets: [
      {path: cover.assets.landscape_16_9.path, checksum_sha256: cover.assets.landscape_16_9.checksum_sha256},
      {path: cover.assets.portrait_9_16.path, checksum_sha256: cover.assets.portrait_9_16.checksum_sha256},
      {path: cover.assets.landscape_4_3.path, checksum_sha256: cover.assets.landscape_4_3.checksum_sha256},
    ],
    transferable_style_axes: axes,
    route_adaptation: {
      imagegen: 'full_transferable_style',
      ian_handdrawn_ppt: 'palette_luminance_negative_space_only',
      other_fixed_routes: 'palette_luminance_negative_space_only',
    },
    typography_transfer: 'cover_only_excluded_from_storyboard_images',
    content_leakage_forbidden: true,
  };
  profile.profile_sha256 = buildCoverDerivedStyleProfileSha256(profile);
  assert.equal(validateCoverDerivedStyleProfile(profile, {
    publishingCoverPackageSha256: cover.package_sha256, publishingCoverPackage: cover,
  }).result, 'pass');

  const substituted = structuredClone(profile);
  substituted.reference_assets[0].checksum_sha256 = sha('8');
  substituted.profile_sha256 = buildCoverDerivedStyleProfileSha256(substituted);
  assert.throws(() => validateCoverDerivedStyleProfile(substituted, {
    publishingCoverPackageSha256: cover.package_sha256, publishingCoverPackage: cover,
  }), /substituted a publishing-cover reference/);

  const scope = {
    contract_version: 'cover-style-scope-selection-v1',
    white_cat_visual_style_selection_sha256: sha('6'),
    cover_derived_style_profile_sha256: profile.profile_sha256,
    scope: 'persist_global',
    decision: {status: 'selected', exact_message: '加入全局', decided_at: '2026-08-27T10:00:00+08:00'},
  };
  scope.selection_sha256 = buildCoverStyleScopeSelectionSha256(scope);
  assert.equal(validateCoverStyleScopeSelection(scope, {
    whiteCatVisualStyleSelectionSha256: sha('6'),
    coverDerivedStyleProfileSha256: profile.profile_sha256,
  }).scope, 'persist_global');
});
