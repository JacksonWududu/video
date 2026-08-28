import crypto from 'node:crypto';

export const PUBLISHING_COVER_GENERATION_VERSION = 'publishing-cover-generation-v1';
export const COVER_DERIVED_STYLE_PROFILE_VERSION = 'cover-derived-style-profile-v1';
export const COVER_STYLE_SCOPE_SELECTION_VERSION = 'cover-style-scope-selection-v1';

const SHA256 = /^[a-f0-9]{64}$/;
const REQUIRED_STYLE_AXES = Object.freeze([
  'medium_and_substrate',
  'mark_making',
  'palette',
  'contrast_and_lighting',
  'edge_behavior',
  'texture',
  'shape_modeling',
  'composition_and_negative_space',
  'mood',
  'transformation_strength',
]);

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
};

const digest = (value) => crypto.createHash('sha256')
  .update(JSON.stringify(canonicalize(value)))
  .digest('hex');

const requireSha256 = (value, label) => {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new Error(`${label} must be a lowercase SHA-256`);
};

const requireText = (value, label) => {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} is required`);
};

const coverAssetProjection = (asset) => ({
  role: asset?.role,
  path: asset?.path,
  checksum_sha256: asset?.checksum_sha256,
  prompt_checksum_sha256: asset?.prompt_checksum_sha256,
  width: asset?.width,
  height: asset?.height,
  generation_attempt_scope_id: asset?.generation_attempt_scope_id,
  generation_attempt_count: asset?.generation_attempt_count,
  rejected_outputs: asset?.rejected_outputs,
  automatic_retry_status: asset?.automatic_retry_status,
  qa_status: asset?.qa_status,
  qa: asset?.qa,
});

const packageProjection = (value) => ({
  contract_version: PUBLISHING_COVER_GENERATION_VERSION,
  gate1_topic_sha256: value.gate1_topic_sha256,
  gate2_script_sha256: value.gate2_script_sha256,
  exact_theme_words: value.exact_theme_words,
  title_source: value.title_source,
  white_cat_reference: value.white_cat_reference,
  generation_policy: value.generation_policy,
  generation_rounds_used: value.generation_rounds_used,
  delegated_review: value.delegated_review,
  assets: {
    landscape_16_9: coverAssetProjection(value.assets?.landscape_16_9),
    portrait_9_16: coverAssetProjection(value.assets?.portrait_9_16),
    landscape_4_3: coverAssetProjection(value.assets?.landscape_4_3),
  },
});

export const buildPublishingCoverPackageSha256 = (value) => digest(packageProjection(value));

const validateCoverAsset = (asset, {role, ratio}) => {
  if (asset?.role !== role) throw new Error(`publishing cover ${role} role mismatch`);
  requireText(asset.path, `publishing cover ${role} path`);
  requireSha256(asset.checksum_sha256, `publishing cover ${role} checksum`);
  requireSha256(asset.prompt_checksum_sha256, `publishing cover ${role} prompt checksum`);
  if (!Number.isInteger(asset.width) || !Number.isInteger(asset.height)
    || asset.width < 1 || asset.height < 1
    || Math.abs((asset.width / asset.height) - ratio) / ratio > 0.005) {
    throw new Error(`publishing cover ${role} aspect ratio is invalid`);
  }
  requireText(asset.generation_attempt_scope_id, `publishing cover ${role} attempt scope`);
  if (!Number.isInteger(asset.generation_attempt_count)
    || asset.generation_attempt_count < 1 || asset.generation_attempt_count > 3
    || !Array.isArray(asset.rejected_outputs)
    || asset.rejected_outputs.length !== asset.generation_attempt_count - 1
    || asset.rejected_outputs.length > 2
    || asset.automatic_retry_status !== 'accepted') {
    throw new Error(`publishing cover ${role} attempt evidence is invalid`);
  }
  const rejectedChecksums = new Set();
  for (const rejected of asset.rejected_outputs) {
    requireSha256(rejected?.prompt_checksum_sha256, `publishing cover ${role} rejected prompt checksum`);
    requireSha256(rejected?.output_checksum_sha256, `publishing cover ${role} rejected output checksum`);
    requireText(rejected?.reason, `publishing cover ${role} rejection reason`);
    if (rejectedChecksums.has(rejected.output_checksum_sha256)) {
      throw new Error(`publishing cover ${role} rejected outputs must be distinct`);
    }
    rejectedChecksums.add(rejected.output_checksum_sha256);
  }
  if (asset.qa_status !== 'qa_accepted_by_codex') {
    throw new Error(`publishing cover ${role} lacks delegated QA acceptance`);
  }
  const qa = asset.qa;
  if (qa?.narration_consistency !== 'pass'
    || qa?.white_cat_identity !== 'pass'
    || qa?.text_accuracy !== 'pass'
    || qa?.cover_effectiveness !== 'pass'
    || qa?.style_transferability !== 'pass'
    || qa?.extra_text_count !== 0
    || !Array.isArray(qa.character_checks)
    || qa.character_checks.length === 0
    || qa.character_checks.some((row) => row?.result !== 'pass')) {
    throw new Error(`publishing cover ${role} structured QA is incomplete or rejected`);
  }
};

export const validatePublishingCoverPackage = (value, {
  gate1TopicSha256,
  gate1ExactThemeWords,
  gate2ScriptSha256,
  canonicalWhiteCatReferencePath,
  canonicalWhiteCatReferenceSha256,
}) => {
  if (value?.contract_version !== PUBLISHING_COVER_GENERATION_VERSION) {
    throw new Error('publishing cover generation authority mismatch');
  }
  requireSha256(gate1TopicSha256, 'current Gate 1 topic checksum');
  requireSha256(gate2ScriptSha256, 'current Gate 2 script checksum');
  if (value.gate1_topic_sha256 !== gate1TopicSha256
    || value.gate2_script_sha256 !== gate2ScriptSha256) {
    throw new Error('publishing cover package is stale after topic or Gate 2 change');
  }
  requireText(gate1ExactThemeWords, 'current Gate 1 exact theme words');
  if (value.exact_theme_words !== gate1ExactThemeWords) {
    throw new Error('publishing cover title is not the exact Gate 1 topic');
  }
  if (value.title_source !== 'gate1_exact_topic') throw new Error('publishing cover title must use the exact Gate 1 topic');
  requireText(canonicalWhiteCatReferencePath, 'canonical white-cat reference path');
  requireSha256(canonicalWhiteCatReferenceSha256, 'canonical white-cat reference checksum');
  if (value.white_cat_reference?.path !== canonicalWhiteCatReferencePath
    || value.white_cat_reference?.checksum_sha256 !== canonicalWhiteCatReferenceSha256) {
    throw new Error('publishing cover white-cat reference is stale or substituted');
  }
  if (value.generation_policy?.style_mode !== 'open_unconstrained'
    || value.generation_policy?.style_reference_count !== 0
    || value.generation_policy?.independent_aspect_compositions !== true
    || value.generation_policy?.maximum_automatic_rounds !== 3
    || !Number.isInteger(value.generation_rounds_used)
    || value.generation_rounds_used < 1 || value.generation_rounds_used > 3) {
    throw new Error('publishing cover generation policy is invalid');
  }
  if (value.delegated_review?.authority !== 'user_delegated_cover_qa'
    || value.delegated_review?.status !== 'qa_accepted_by_codex'
    || value.delegated_review?.user_approval_claimed !== false
    || typeof value.delegated_review?.exact_authorization_message !== 'string'
    || value.delegated_review.exact_authorization_message.trim() === '') {
    throw new Error('publishing cover delegated review evidence is invalid');
  }
  validateCoverAsset(value.assets?.landscape_16_9, {role: 'landscape_16_9', ratio: 16 / 9});
  validateCoverAsset(value.assets?.portrait_9_16, {role: 'portrait_9_16', ratio: 9 / 16});
  validateCoverAsset(value.assets?.landscape_4_3, {role: 'landscape_4_3', ratio: 4 / 3});
  if (value.generation_rounds_used !== Math.max(
    value.assets.landscape_16_9.generation_attempt_count,
    value.assets.portrait_9_16.generation_attempt_count,
    value.assets.landscape_4_3.generation_attempt_count,
  )) {
    throw new Error('publishing cover package round count does not match independent aspect attempts');
  }
  const expected = buildPublishingCoverPackageSha256(value);
  if (value.package_sha256 !== expected) throw new Error('publishing cover package checksum is stale');
  return {result: 'pass', package_sha256: expected};
};

const styleProjection = (value) => ({
  contract_version: COVER_DERIVED_STYLE_PROFILE_VERSION,
  publishing_cover_package_path: value.publishing_cover_package_path,
  publishing_cover_package_sha256: value.publishing_cover_package_sha256,
  reference_assets: value.reference_assets,
  transferable_style_axes: value.transferable_style_axes,
  route_adaptation: value.route_adaptation,
  typography_transfer: value.typography_transfer,
  content_leakage_forbidden: value.content_leakage_forbidden,
});

export const buildCoverDerivedStyleProfileSha256 = (value) => digest(styleProjection(value));

export const validateCoverDerivedStyleProfile = (value, {
  publishingCoverPackageSha256,
  publishingCoverPackage,
}) => {
  if (value?.contract_version !== COVER_DERIVED_STYLE_PROFILE_VERSION) {
    throw new Error('cover-derived style profile authority mismatch');
  }
  requireText(value.publishing_cover_package_path, 'cover-derived style package path');
  requireSha256(publishingCoverPackageSha256, 'publishing cover package checksum');
  if (value.publishing_cover_package_sha256 !== publishingCoverPackageSha256) {
    throw new Error('cover-derived style profile is stale after cover change');
  }
  if (!Array.isArray(value.reference_assets) || value.reference_assets.length !== 3) {
    throw new Error('cover-derived style profile requires all three cover references');
  }
  const expectedReferences = [
    publishingCoverPackage?.assets?.landscape_16_9,
    publishingCoverPackage?.assets?.portrait_9_16,
    publishingCoverPackage?.assets?.landscape_4_3,
  ].map((asset) => ({path: asset?.path, checksum_sha256: asset?.checksum_sha256}));
  for (const [index, reference] of value.reference_assets.entries()) {
    requireText(reference?.path, 'cover-derived style reference path');
    requireSha256(reference?.checksum_sha256, 'cover-derived style reference checksum');
    if (reference.path !== expectedReferences[index].path
      || reference.checksum_sha256 !== expectedReferences[index].checksum_sha256) {
      throw new Error('cover-derived style profile substituted a publishing-cover reference');
    }
  }
  for (const axis of REQUIRED_STYLE_AXES) requireText(value.transferable_style_axes?.[axis], `cover-derived style axis ${axis}`);
  if (value.route_adaptation?.imagegen !== 'full_transferable_style'
    || value.route_adaptation?.ian_handdrawn_ppt !== 'palette_luminance_negative_space_only'
    || value.route_adaptation?.other_fixed_routes !== 'palette_luminance_negative_space_only'
    || value.typography_transfer !== 'cover_only_excluded_from_storyboard_images'
    || value.content_leakage_forbidden !== true) {
    throw new Error('cover-derived style route adaptation is invalid');
  }
  const expected = buildCoverDerivedStyleProfileSha256(value);
  if (value.profile_sha256 !== expected) throw new Error('cover-derived style profile checksum is stale');
  return {result: 'pass', profile_sha256: expected};
};

const scopeProjection = (value) => ({
  contract_version: COVER_STYLE_SCOPE_SELECTION_VERSION,
  white_cat_visual_style_selection_sha256: value.white_cat_visual_style_selection_sha256,
  cover_derived_style_profile_sha256: value.cover_derived_style_profile_sha256,
  scope: value.scope,
  decision: value.decision,
});

export const buildCoverStyleScopeSelectionSha256 = (value) => digest(scopeProjection(value));

export const validateCoverStyleScopeSelection = (value, bindings) => {
  if (value?.contract_version !== COVER_STYLE_SCOPE_SELECTION_VERSION) {
    throw new Error('cover style scope selection authority mismatch');
  }
  if (!['episode_only', 'persist_global'].includes(value.scope)) throw new Error('cover style scope is invalid');
  if (value.white_cat_visual_style_selection_sha256 !== bindings.whiteCatVisualStyleSelectionSha256
    || value.cover_derived_style_profile_sha256 !== bindings.coverDerivedStyleProfileSha256) {
    throw new Error('cover style scope selection is stale');
  }
  if (value.decision?.status !== 'selected'
    || typeof value.decision?.exact_message !== 'string' || value.decision.exact_message.trim() === ''
    || typeof value.decision?.decided_at !== 'string' || Number.isNaN(Date.parse(value.decision.decided_at))) {
    throw new Error('cover style scope requires an explicit user selection');
  }
  const expected = buildCoverStyleScopeSelectionSha256(value);
  if (value.selection_sha256 !== expected) throw new Error('cover style scope selection checksum is stale');
  return {result: 'pass', scope: value.scope, selection_sha256: expected};
};
