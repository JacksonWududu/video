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

const sha = (character) => character.repeat(64);
const packageBindings = {
  gate1TopicSha256: sha('1'), gate1ExactThemeWords: '知识', gate2ScriptSha256: sha('2'),
  canonicalWhiteCatReferencePath: '/canonical/white-cat.png',
  canonicalWhiteCatReferenceSha256: sha('3'),
};
const characterChecks = [{index: 1, expected: '知', observed: '知', result: 'pass'}];
const asset = (role, width, height, checksum) => ({
  role, path: `topic/assets/image/${role}.png`, checksum_sha256: checksum,
  prompt_checksum_sha256: sha('e'), width, height, qa_status: 'qa_accepted_by_codex',
  generation_attempt_scope_id: `publishing-cover:${role}`,
  generation_attempt_count: 1, rejected_outputs: [], automatic_retry_status: 'accepted',
  qa: {
    narration_consistency: 'pass', white_cat_identity: 'pass', text_accuracy: 'pass',
    cover_effectiveness: 'pass', style_transferability: 'pass', extra_text_count: 0,
    character_checks: characterChecks,
  },
});

const buildPackage = () => {
  const value = {
    contract_version: 'publishing-cover-generation-v1',
    gate1_topic_sha256: sha('1'), gate2_script_sha256: sha('2'),
    exact_theme_words: '知识', title_source: 'gate1_exact_topic',
    white_cat_reference: {path: '/canonical/white-cat.png', checksum_sha256: sha('3')},
    generation_policy: {
      style_mode: 'open_unconstrained', style_reference_count: 0,
      independent_aspect_compositions: true, maximum_automatic_rounds: 3,
    },
    generation_rounds_used: 1,
    delegated_review: {
      authority: 'user_delegated_cover_qa', status: 'qa_accepted_by_codex',
      user_approval_claimed: false, exact_authorization_message: '生成完之后代我确认',
    },
    assets: {
      landscape_16_9: asset('landscape_16_9', 1920, 1080, sha('4')),
      portrait_9_16: asset('portrait_9_16', 1080, 1920, sha('5')),
      landscape_4_3: asset('landscape_4_3', 1600, 1200, sha('6')),
    },
  };
  value.package_sha256 = buildPublishingCoverPackageSha256(value);
  return value;
};

test('delegated QA accepts an exact Gate-bound three-aspect publishing cover package', () => {
  const value = buildPackage();
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
