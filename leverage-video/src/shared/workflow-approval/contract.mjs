import crypto from 'node:crypto';
import path from 'node:path';

import {FLIPBOOK_STYLE_ID, FLIPBOOK_PROFILE_SHA256} from '../flipbook-video/profile.mjs';

import {validateCoverStyleScopeSelection} from '../publishing-cover/contract.mjs';

export const WHITE_CAT_VISUAL_STYLE_SELECTION_VERSION = 'white-cat-visual-style-selection-v1';
export const WHITE_CAT_VISUAL_STYLE_SELECTION_VERSION_V2 = 'white-cat-visual-style-selection-v2';
export const VISUAL_DENSITY_SELECTION_VERSION = 'visual-density-selection-v1';
export const WORKFLOW_APPROVAL_MODE_VERSION = 'workflow-approval-mode-v1';
export const ONE_CLICK_APPROVAL_POLICY_VERSION = 'one-click-approval-policy-v1';
export const NARRATION_AUDIO_SOURCE_SELECTION_VERSION = 'narration-audio-source-selection-v1';
export const POST_COVER_SELECTION_BATCH_VERSION = 'post-cover-selection-batch-v1';
export const POST_COVER_SELECTION_BATCH_PHASE = 'awaiting_post_cover_selection_batch';
export const ONE_CLICK_VISUAL_REVIEW_VERSION = 'visual-asset-review-v3';
export const ONE_CLICK_FINAL_REVIEW_MODE = 'one_click_final_review_v1';
export const ONE_CLICK_FINAL_REVIEW_PHASE = 'awaiting_precomposition_visual_review';
export const CAPTION_CHOICE_PHASE = 'awaiting_caption_delivery_choice';

const SHA256 = /^[a-f0-9]{64}$/;
export const WHITE_CAT_VISUAL_STYLE_OPTIONS = Object.freeze({
  'loose-line-vivid-watercolor': Object.freeze({
    treatment_profile_id: 'imagegen-watercolor-narrative',
    visual_cohesion_profile_id: 'warm-paper-watercolor-cohesion-v1',
    style_skill_path: '/Users/jackson/.codex/skills/generate-visual-styles/SKILL.md',
    style_skill_checksum_sha256: '319f127e6ce025db47b8a3d7af4c92136090ebaaf8116da1f84b5bcb9c236013',
    style_profile_path: '/Users/jackson/.codex/skills/generate-visual-styles/references/loose-line-vivid-watercolor.md',
    style_profile_checksum_sha256: 'cdf1fc7f6b70f4e6a888e03803ce60cbe8b0ef2ff3ff9a7a566c7be2c3956f36',
  }),
  'twilight-neon-animation': Object.freeze({
    treatment_profile_id: 'imagegen-twilight-neon-narrative',
    visual_cohesion_profile_id: 'twilight-luminous-cohesion-v1',
    style_skill_path: '/Users/jackson/.codex/skills/generate-visual-styles/SKILL.md',
    style_skill_checksum_sha256: '319f127e6ce025db47b8a3d7af4c92136090ebaaf8116da1f84b5bcb9c236013',
    style_profile_path: '/Users/jackson/.codex/skills/generate-visual-styles/references/twilight-neon-animation.md',
    style_profile_checksum_sha256: 'dcf85c2fbf05d5d798a4a4635f5076362b933fb6f82b990673d9924fad8ed335',
  }),
  'gilded-mythic-storybook': Object.freeze({
    treatment_profile_id: 'imagegen-gilded-mythic-narrative',
    visual_cohesion_profile_id: 'gilded-mythic-cohesion-v1',
    style_skill_path: '/Users/jackson/.codex/skills/generate-visual-styles/SKILL.md',
    style_skill_checksum_sha256: '319f127e6ce025db47b8a3d7af4c92136090ebaaf8116da1f84b5bcb9c236013',
    style_profile_path: '/Users/jackson/.codex/skills/generate-visual-styles/references/gilded-mythic-storybook.md',
    style_profile_checksum_sha256: 'c5f6e16744e5d5d825b4d97b92d8446577c6f4f179f1752d0ce28ffc7bce1428',
  }),
});
const DENSITY_MODES = new Set(['standard', 'rich']);
const APPROVAL_MODES = new Set(['manual', 'one_click']);
const NARRATION_AUDIO_SOURCE_MODES = new Set(['colocated_voice', 'edge_tts', 'user_media_audio']);
const DYNAMIC_STYLE_SOURCES = new Set(['episode_cover', 'registered_custom', 'builtin_flipbook']);
const FLIPBOOK_STYLE_OPTION = Object.freeze({
  style_id: FLIPBOOK_STYLE_ID,
  treatment_profile_id: 'imagegen-watercolor-narrative',
  visual_cohesion_profile_id: 'illustrated-flipbook-cohesion-v1',
});
const DYNAMIC_STYLE_OPTION = Object.freeze({
  style_id: 'cover-derived-episode-style',
  treatment_profile_id: 'imagegen-cover-derived-narrative',
  visual_cohesion_profile_id: 'cover-derived-cohesion-v1',
});
const EDGE_TTS_VOICE = 'zh-CN-YunjianNeural';
const EDGE_TTS_RATE = '+20%';
const REQUIRED_PREAUTHORIZATIONS = Object.freeze([
  'audio_lookup',
  'deterministic_visual_direction_recommendations',
  'deterministic_transition_recommendations',
  'storyboard_review',
  'continue_during_visual_production',
]);

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
};

const sha256 = (value) => crypto.createHash('sha256')
  .update(JSON.stringify(canonicalize(value)))
  .digest('hex');

const requireSha256 = (value, label) => {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new Error(`${label} must be a lowercase SHA-256`);
};

const requireDecision = (value, label) => {
  if (value?.status !== 'selected'
    || typeof value.exact_message !== 'string' || value.exact_message.trim() === ''
    || typeof value.decided_at !== 'string' || Number.isNaN(Date.parse(value.decided_at))) {
    throw new Error(`${label} requires an explicit user selection`);
  }
};

export const resolveWhiteCatVisualStyleOption = (styleId) => {
  const option = WHITE_CAT_VISUAL_STYLE_OPTIONS[styleId];
  if (!option) {
    throw new Error(`white-cat visual style must be one of: ${Object.keys(WHITE_CAT_VISUAL_STYLE_OPTIONS).join(', ')}`);
  }
  return option;
};

const whiteCatVisualStyleProjection = (selection) => {
  const common = {
    contract_version: selection.contract_version,
    gate2_script_sha256: selection.gate2_script_sha256,
    style_id: selection.style_id,
    treatment_profile_id: selection.treatment_profile_id,
    visual_cohesion_profile_id: selection.visual_cohesion_profile_id,
    style_profile_path: selection.style_profile_path,
    style_profile_checksum_sha256: selection.style_profile_checksum_sha256,
    decision: {
      status: selection.decision?.status,
      exact_message: selection.decision?.exact_message,
      decided_at: selection.decision?.decided_at,
    },
  };
  if (selection.contract_version === WHITE_CAT_VISUAL_STYLE_SELECTION_VERSION_V2) {
    return {
      ...common,
      style_source: selection.style_source,
      source_style_id: selection.source_style_id ?? null,
      style_label: selection.style_label,
      publishing_cover_package_path: selection.publishing_cover_package_path ?? null,
      publishing_cover_package_sha256: selection.publishing_cover_package_sha256 ?? null,
    };
  }
  return {
    ...common,
    contract_version: WHITE_CAT_VISUAL_STYLE_SELECTION_VERSION,
    style_skill_path: selection.style_skill_path,
    style_skill_checksum_sha256: selection.style_skill_checksum_sha256,
  };
};

export const buildWhiteCatVisualStyleSelectionSha256 = (selection) => (
  sha256(whiteCatVisualStyleProjection(selection))
);

export const validateWhiteCatVisualStyleSelection = (selection, {gate2ScriptSha256}) => {
  if (![WHITE_CAT_VISUAL_STYLE_SELECTION_VERSION, WHITE_CAT_VISUAL_STYLE_SELECTION_VERSION_V2]
    .includes(selection?.contract_version)) {
    throw new Error('white-cat visual style selection authority mismatch');
  }
  requireSha256(gate2ScriptSha256, 'current Gate 2 script checksum');
  if (selection.gate2_script_sha256 !== gate2ScriptSha256) {
    throw new Error('white-cat visual style selection is stale after Gate 2 change');
  }
  let option;
  if (selection.contract_version === WHITE_CAT_VISUAL_STYLE_SELECTION_VERSION) {
    option = resolveWhiteCatVisualStyleOption(selection.style_id);
    for (const [field, expected] of Object.entries(option)) {
      if (selection[field] !== expected) {
        throw new Error(`white-cat visual style selection has stale or substituted ${field}`);
      }
    }
  } else {
    option = selection.style_source === 'builtin_flipbook' ? FLIPBOOK_STYLE_OPTION : DYNAMIC_STYLE_OPTION;
    if (!DYNAMIC_STYLE_SOURCES.has(selection.style_source)) {
      throw new Error('white-cat visual style v2 source must be episode_cover or registered_custom');
    }
    if (selection.style_id !== option.style_id
      || selection.treatment_profile_id !== option.treatment_profile_id
      || selection.visual_cohesion_profile_id !== option.visual_cohesion_profile_id) {
      throw new Error('white-cat visual style v2 runtime treatment is stale or substituted');
    }
    if (typeof selection.style_label !== 'string' || selection.style_label.trim() === ''
      || typeof selection.style_profile_path !== 'string' || selection.style_profile_path.trim() === '') {
      throw new Error('white-cat visual style v2 requires an episode-local label and profile path');
    }
    requireSha256(selection.style_profile_checksum_sha256, 'white-cat visual style v2 profile checksum');
    if (selection.style_source === 'builtin_flipbook') {
      if (selection.source_style_id !== FLIPBOOK_STYLE_ID
        || selection.style_profile_checksum_sha256 !== FLIPBOOK_PROFILE_SHA256
        || !/^leverage-video\/src\/topic[0-9]+\/schema\/[^/]+\.json$/.test(selection.style_profile_path)
        || selection.style_profile_path.includes('..')
        || selection.publishing_cover_package_path !== null
        || selection.publishing_cover_package_sha256 !== null) {
        throw new Error('flipbook style requires its immutable episode-local profile snapshot');
      }
    } else if (selection.style_source === 'episode_cover') {
      if (selection.source_style_id !== null
        || typeof selection.publishing_cover_package_path !== 'string'
        || selection.publishing_cover_package_path.trim() === '') {
        throw new Error('episode-cover style must bind its publishing-cover package');
      }
      requireSha256(selection.publishing_cover_package_sha256, 'publishing-cover package checksum');
    } else if (typeof selection.source_style_id !== 'string' || selection.source_style_id.trim() === ''
      || selection.publishing_cover_package_path !== null
      || selection.publishing_cover_package_sha256 !== null) {
      throw new Error('registered custom style must bind its source ID without an episode cover');
    }
  }
  requireDecision(selection.decision, 'white-cat visual style');
  const expected = buildWhiteCatVisualStyleSelectionSha256(selection);
  if (selection.selection_sha256 !== expected) {
    throw new Error('white-cat visual style selection checksum is stale');
  }
  return {
    result: 'pass',
    style_id: selection.style_id,
    style_source: selection.style_source ?? 'core_catalog',
    source_style_id: selection.source_style_id ?? null,
    treatment_profile_id: option.treatment_profile_id,
    visual_cohesion_profile_id: option.visual_cohesion_profile_id,
    style_profile_path: selection.style_profile_path,
    style_profile_checksum_sha256: selection.style_profile_checksum_sha256,
    selection_sha256: expected,
  };
};

const densityProjection = (selection) => ({
  contract_version: VISUAL_DENSITY_SELECTION_VERSION,
  gate2_script_sha256: selection.gate2_script_sha256,
  white_cat_visual_style_selection_sha256: selection.white_cat_visual_style_selection_sha256,
  density_mode: selection.density_mode,
  decision: {
    status: selection.decision?.status,
    exact_message: selection.decision?.exact_message,
    decided_at: selection.decision?.decided_at,
  },
});

export const buildFlipbookStyleSelection = ({gate2ScriptSha256, profilePath, decision}) => {
  const selection = {
    contract_version: WHITE_CAT_VISUAL_STYLE_SELECTION_VERSION_V2,
    gate2_script_sha256: gate2ScriptSha256,
    ...FLIPBOOK_STYLE_OPTION,
    style_source: 'builtin_flipbook',
    source_style_id: FLIPBOOK_STYLE_ID,
    style_label: '图文翻书',
    style_profile_path: profilePath,
    style_profile_checksum_sha256: FLIPBOOK_PROFILE_SHA256,
    publishing_cover_package_path: null,
    publishing_cover_package_sha256: null,
    decision: structuredClone(decision),
  };
  selection.selection_sha256 = buildWhiteCatVisualStyleSelectionSha256(selection);
  validateWhiteCatVisualStyleSelection(selection, {gate2ScriptSha256});
  return selection;
};

export const buildVisualDensitySelectionSha256 = (selection) => sha256(densityProjection(selection));

export const validateVisualDensitySelection = (
  selection,
  {gate2ScriptSha256, whiteCatVisualStyleSelectionSha256},
) => {
  if (selection?.contract_version !== VISUAL_DENSITY_SELECTION_VERSION) {
    throw new Error('visual density selection authority mismatch');
  }
  requireSha256(gate2ScriptSha256, 'current Gate 2 script checksum');
  if (selection.gate2_script_sha256 !== gate2ScriptSha256) {
    throw new Error('visual density selection is stale after Gate 2 change');
  }
  requireSha256(whiteCatVisualStyleSelectionSha256, 'white-cat visual style selection checksum');
  if (selection.white_cat_visual_style_selection_sha256 !== whiteCatVisualStyleSelectionSha256) {
    throw new Error('visual density selection is stale or selected before white-cat visual style');
  }
  if (!DENSITY_MODES.has(selection.density_mode)) throw new Error('visual density must be standard or rich');
  requireDecision(selection.decision, 'visual density');
  const expected = buildVisualDensitySelectionSha256(selection);
  if (selection.selection_sha256 !== expected) throw new Error('visual density selection checksum is stale');
  return {result: 'pass', density_mode: selection.density_mode, selection_sha256: expected};
};

const modeProjection = (selection) => ({
  contract_version: WORKFLOW_APPROVAL_MODE_VERSION,
  gate2_script_sha256: selection.gate2_script_sha256,
  visual_density_selection_sha256: selection.visual_density_selection_sha256,
  approval_mode: selection.approval_mode,
  decision: {
    status: selection.decision?.status,
    exact_message: selection.decision?.exact_message,
    decided_at: selection.decision?.decided_at,
  },
});

export const buildWorkflowApprovalModeSha256 = (selection) => sha256(modeProjection(selection));

export const validateWorkflowApprovalMode = (
  selection,
  {gate2ScriptSha256, visualDensitySelectionSha256},
) => {
  if (selection?.contract_version !== WORKFLOW_APPROVAL_MODE_VERSION) {
    throw new Error('workflow approval mode authority mismatch');
  }
  requireSha256(visualDensitySelectionSha256, 'visual density selection checksum');
  if (selection.gate2_script_sha256 !== gate2ScriptSha256
    || selection.visual_density_selection_sha256 !== visualDensitySelectionSha256) {
    throw new Error('workflow approval mode is stale or selected before visual density');
  }
  if (!APPROVAL_MODES.has(selection.approval_mode)) throw new Error('approval mode must be manual or one_click');
  requireDecision(selection.decision, 'workflow approval mode');
  const expected = buildWorkflowApprovalModeSha256(selection);
  if (selection.selection_sha256 !== expected) throw new Error('workflow approval mode checksum is stale');
  return {result: 'pass', approval_mode: selection.approval_mode, selection_sha256: expected};
};

const narrationAudioSourceProjection = (selection) => ({
  contract_version: NARRATION_AUDIO_SOURCE_SELECTION_VERSION,
  gate2_script_sha256: selection.gate2_script_sha256,
  workflow_approval_mode_selection_sha256: selection.workflow_approval_mode_selection_sha256,
  source_mode: selection.source_mode,
  edge_tts: selection.edge_tts ?? null,
  ...(selection.source_mode === 'user_media_audio'
    ? {user_media_audio: selection.user_media_audio}
    : {}),
  decision: {
    status: selection.decision?.status,
    exact_message: selection.decision?.exact_message,
    decided_at: selection.decision?.decided_at,
  },
});

export const buildNarrationAudioSourceSelectionSha256 = (selection) => (
  sha256(narrationAudioSourceProjection(selection))
);

export const validateNarrationAudioSourceSelection = (
  selection,
  {gate2ScriptSha256, workflowApprovalModeSelectionSha256},
) => {
  if (selection?.contract_version !== NARRATION_AUDIO_SOURCE_SELECTION_VERSION) {
    throw new Error('narration audio source selection authority mismatch');
  }
  requireSha256(gate2ScriptSha256, 'current Gate 2 script checksum');
  requireSha256(workflowApprovalModeSelectionSha256, 'workflow approval mode checksum');
  if (selection.gate2_script_sha256 !== gate2ScriptSha256
    || selection.workflow_approval_mode_selection_sha256 !== workflowApprovalModeSelectionSha256) {
    throw new Error('narration audio source selection is stale');
  }
  if (!NARRATION_AUDIO_SOURCE_MODES.has(selection.source_mode)) {
    throw new Error('narration audio source must be colocated_voice, edge_tts, or user_media_audio');
  }
  requireDecision(selection.decision, 'narration audio source');
  if (selection.source_mode === 'edge_tts') {
    if (selection.edge_tts?.provider !== 'edge-tts'
      || selection.edge_tts?.voice !== EDGE_TTS_VOICE
      || selection.edge_tts?.rate !== EDGE_TTS_RATE
      || selection.edge_tts?.network_access_authorized !== true) {
      throw new Error('edge_tts requires edge-tts, zh-CN-YunjianNeural, +20%, and explicit network authorization');
    }
  } else if (selection.edge_tts !== null && selection.edge_tts !== undefined) {
    throw new Error(`${selection.source_mode} must not carry edge_tts settings`);
  }
  if (selection.source_mode === 'user_media_audio') {
    const media = selection.user_media_audio;
    if (typeof media?.path !== 'string' || !path.isAbsolute(media.path)
      || path.normalize(media.path) !== media.path || media.path.includes('\0')) {
      throw new Error('user-media audio requires an exact normalized absolute media path');
    }
    requireSha256(media.checksum_sha256, 'user-media audio source checksum');
    if (!Number.isSafeInteger(media.audio_stream_index) || media.audio_stream_index < 0
      || media.extraction_mode !== 'stream_copy'
      || media.source_access_authorized !== true
      || media.fallback_allowed !== false) {
      throw new Error('user-media audio requires an explicit stream index, authorized stream copy, and no fallback');
    }
  } else if (selection.user_media_audio !== null && selection.user_media_audio !== undefined) {
    throw new Error(`${selection.source_mode} must not carry user_media_audio settings`);
  }
  const expected = buildNarrationAudioSourceSelectionSha256(selection);
  if (selection.selection_sha256 !== expected) {
    throw new Error('narration audio source selection checksum is stale');
  }
  return {result: 'pass', source_mode: selection.source_mode, selection_sha256: expected};
};

const policyProjection = (policy) => ({
  contract_version: ONE_CLICK_APPROVAL_POLICY_VERSION,
  gate2_script_sha256: policy.gate2_script_sha256,
  white_cat_visual_style_selection_sha256: policy.white_cat_visual_style_selection_sha256,
  visual_density_selection_sha256: policy.visual_density_selection_sha256,
  workflow_approval_mode_selection_sha256: policy.workflow_approval_mode_selection_sha256,
  preauthorizations: policy.preauthorizations,
  user_has_reviewed_specific_maps: false,
  final_visual_review_required: true,
  qa_bypass_forbidden: true,
});

export const buildOneClickApprovalPolicySha256 = (policy) => sha256(policyProjection(policy));

export const validateOneClickApprovalPolicy = (policy, bindings) => {
  if (policy?.contract_version !== ONE_CLICK_APPROVAL_POLICY_VERSION) {
    throw new Error('one-click approval policy authority mismatch');
  }
  if (policy.gate2_script_sha256 !== bindings.gate2ScriptSha256
    || policy.white_cat_visual_style_selection_sha256 !== bindings.whiteCatVisualStyleSelectionSha256
    || policy.visual_density_selection_sha256 !== bindings.visualDensitySelectionSha256
    || policy.workflow_approval_mode_selection_sha256 !== bindings.workflowApprovalModeSelectionSha256) {
    throw new Error('one-click approval policy binding is stale');
  }
  for (const field of REQUIRED_PREAUTHORIZATIONS) {
    if (policy.preauthorizations?.[field] !== true) throw new Error(`one-click preauthorization is missing: ${field}`);
  }
  if (Object.keys(policy.preauthorizations ?? {}).sort().join(',') !== [...REQUIRED_PREAUTHORIZATIONS].sort().join(',')) {
    throw new Error('one-click policy contains unknown or forged preauthorization fields');
  }
  if (policy.user_has_reviewed_specific_maps !== false
    || policy.final_visual_review_required !== true
    || policy.qa_bypass_forbidden !== true) {
    throw new Error('one-click policy may not claim specific-map review or bypass QA');
  }
  const expected = buildOneClickApprovalPolicySha256(policy);
  if (policy.policy_sha256 !== expected) throw new Error('one-click approval policy checksum is stale or forged');
  return {result: 'pass', policy_sha256: expected};
};

export const validateApprovalSelectionSequence = ({
  gate2ScriptSha256,
  whiteCatStyle,
  density,
  mode,
  policy = null,
}) => {
  const whiteCatStyleResult = validateWhiteCatVisualStyleSelection(
    whiteCatStyle,
    {gate2ScriptSha256},
  );
  const densityResult = validateVisualDensitySelection(density, {
    gate2ScriptSha256,
    whiteCatVisualStyleSelectionSha256: whiteCatStyleResult.selection_sha256,
  });
  const modeResult = validateWorkflowApprovalMode(mode, {
    gate2ScriptSha256,
    visualDensitySelectionSha256: densityResult.selection_sha256,
  });
  if (mode.approval_mode === 'manual') {
    if (policy !== null) throw new Error('manual mode must not carry one-click policy');
  } else {
    validateOneClickApprovalPolicy(policy, {
      gate2ScriptSha256,
      whiteCatVisualStyleSelectionSha256: whiteCatStyleResult.selection_sha256,
      visualDensitySelectionSha256: densityResult.selection_sha256,
      workflowApprovalModeSelectionSha256: modeResult.selection_sha256,
    });
  }
  return {
    result: 'pass',
    white_cat_visual_style_id: whiteCatStyleResult.style_id,
    visual_cohesion_profile_id: whiteCatStyleResult.visual_cohesion_profile_id,
    density_mode: density.density_mode,
    approval_mode: mode.approval_mode,
  };
};

const postCoverSelectionBatchProjection = (batch) => ({
  contract_version: POST_COVER_SELECTION_BATCH_VERSION,
  gate2_script_sha256: batch.gate2_script_sha256,
  decision: {
    status: batch.decision?.status,
    exact_message: batch.decision?.exact_message,
    decided_at: batch.decision?.decided_at,
  },
  white_cat_visual_style_selection_sha256: batch.white_cat_visual_style_selection_sha256,
  cover_style_scope_selection_sha256: batch.cover_style_scope_selection_sha256 ?? null,
  visual_density_selection_sha256: batch.visual_density_selection_sha256,
  workflow_approval_mode_selection_sha256: batch.workflow_approval_mode_selection_sha256,
  one_click_approval_policy_sha256: batch.one_click_approval_policy_sha256 ?? null,
  narration_audio_source_selection_sha256: batch.narration_audio_source_selection_sha256,
});

export const buildPostCoverSelectionBatchSha256 = (batch) => (
  sha256(postCoverSelectionBatchProjection(batch))
);

const requireSameBatchDecision = (decision, expected) => {
  requireDecision(decision, 'post-cover selection batch member');
  if (decision.exact_message !== expected.exact_message || decision.decided_at !== expected.decided_at) {
    throw new Error('post-cover selections must come from one complete user response');
  }
};

export const validatePostCoverSelectionBatch = ({
  batch,
  gate2ScriptSha256,
  whiteCatStyle,
  coverStyleScope = null,
  coverDerivedStyleProfileSha256 = null,
  density,
  mode,
  policy = null,
  narrationAudioSource,
}) => {
  if (batch?.contract_version !== POST_COVER_SELECTION_BATCH_VERSION) {
    throw new Error('post-cover selection batch authority mismatch');
  }
  requireSha256(gate2ScriptSha256, 'current Gate 2 script checksum');
  if (batch.gate2_script_sha256 !== gate2ScriptSha256) {
    throw new Error('post-cover selection batch is stale after Gate 2 change');
  }
  requireDecision(batch.decision, 'post-cover selection batch');

  const styleResult = validateWhiteCatVisualStyleSelection(whiteCatStyle, {gate2ScriptSha256});
  let scopeResult = null;
  if (styleResult.style_source === 'episode_cover') {
    requireSha256(coverDerivedStyleProfileSha256, 'cover-derived style profile checksum');
    scopeResult = validateCoverStyleScopeSelection(coverStyleScope, {
      whiteCatVisualStyleSelectionSha256: styleResult.selection_sha256,
      coverDerivedStyleProfileSha256,
    });
  } else if (coverStyleScope !== null || coverDerivedStyleProfileSha256 !== null) {
    throw new Error('only an episode-cover style may carry a cover-style scope selection');
  }

  validateApprovalSelectionSequence({
    gate2ScriptSha256,
    whiteCatStyle,
    density,
    mode,
    policy,
  });
  const audioResult = validateNarrationAudioSourceSelection(narrationAudioSource, {
    gate2ScriptSha256,
    workflowApprovalModeSelectionSha256: mode.selection_sha256,
  });

  [whiteCatStyle.decision, density.decision, mode.decision, narrationAudioSource.decision]
    .concat(scopeResult === null ? [] : [coverStyleScope.decision])
    .forEach((decision) => requireSameBatchDecision(decision, batch.decision));

  const expectedBindings = {
    white_cat_visual_style_selection_sha256: styleResult.selection_sha256,
    cover_style_scope_selection_sha256: scopeResult?.selection_sha256 ?? null,
    visual_density_selection_sha256: density.selection_sha256,
    workflow_approval_mode_selection_sha256: mode.selection_sha256,
    one_click_approval_policy_sha256: mode.approval_mode === 'one_click' ? policy.policy_sha256 : null,
    narration_audio_source_selection_sha256: audioResult.selection_sha256,
  };
  for (const [field, expected] of Object.entries(expectedBindings)) {
    if ((batch[field] ?? null) !== expected) {
      throw new Error(`post-cover selection batch has stale or missing ${field}`);
    }
  }
  const expectedSha256 = buildPostCoverSelectionBatchSha256(batch);
  if (batch.batch_sha256 !== expectedSha256) {
    throw new Error('post-cover selection batch checksum is stale');
  }
  return {
    result: 'pass',
    batch_sha256: expectedSha256,
    style_id: styleResult.style_id,
    scope: scopeResult?.scope ?? null,
    density_mode: density.density_mode,
    approval_mode: mode.approval_mode,
    source_mode: audioResult.source_mode,
  };
};

export const validateLegacyStylelessApprovalSelectionSequence = ({
  gate2ScriptSha256,
  density,
  mode,
  policy = null,
}) => {
  requireSha256(gate2ScriptSha256, 'current Gate 2 script checksum');
  if (density?.contract_version !== VISUAL_DENSITY_SELECTION_VERSION
    || density.gate2_script_sha256 !== gate2ScriptSha256
    || density.white_cat_visual_style_selection_sha256 !== undefined
    || !DENSITY_MODES.has(density.density_mode)) {
    throw new Error('legacy styleless density selection authority mismatch');
  }
  requireDecision(density.decision, 'legacy styleless visual density');
  const densitySha256 = buildVisualDensitySelectionSha256(density);
  if (density.selection_sha256 !== densitySha256) {
    throw new Error('legacy styleless density selection checksum is stale');
  }
  const modeResult = validateWorkflowApprovalMode(mode, {
    gate2ScriptSha256,
    visualDensitySelectionSha256: densitySha256,
  });
  if (mode.approval_mode === 'manual') {
    if (policy !== null) throw new Error('manual mode must not carry one-click policy');
  } else {
    if (policy?.white_cat_visual_style_selection_sha256 !== undefined) {
      throw new Error('legacy styleless policy must not carry a style selection checksum');
    }
    validateOneClickApprovalPolicy(policy, {
      gate2ScriptSha256,
      whiteCatVisualStyleSelectionSha256: undefined,
      visualDensitySelectionSha256: densitySha256,
      workflowApprovalModeSelectionSha256: modeResult.selection_sha256,
    });
  }
  return {
    result: 'pass',
    legacy_compatibility: 'started-before-white-cat-style-selection-v1',
    white_cat_visual_style_id: null,
    visual_cohesion_profile_id: null,
    density_mode: density.density_mode,
    approval_mode: mode.approval_mode,
  };
};

export const resolveLegacyDensity = ({episodeStarted, densitySelection, explicitRebuild = false}) => {
  if (densitySelection) return densitySelection.density_mode;
  if (episodeStarted && !explicitRebuild) return 'legacy_standard';
  throw new Error('new or explicitly rebuilt episode requires visual density selection');
};

export const calculateSelectionInvalidation = ({
  change,
  lockedScriptValid = true,
  audioValid = true,
  usesCoverDerivedStyle = false,
}) => {
  if (change === 'gate2_script') return {
    keep_locked_script: false,
    keep_audio: false,
    invalidate_white_cat_visual_style_selection: true,
    invalidate_visual_density_selection: true,
    invalidate_workflow_approval_mode: true,
    invalidate_narration_audio_source_selection: true,
    invalidate_from: 'gate2',
  };
  if (change === 'white_cat_visual_style') return {
    keep_locked_script: lockedScriptValid,
    keep_audio: audioValid,
    invalidate_white_cat_visual_style_selection: false,
    invalidate_visual_density_selection: true,
    invalidate_workflow_approval_mode: true,
    invalidate_narration_audio_source_selection: true,
    invalidate_from: POST_COVER_SELECTION_BATCH_PHASE,
  };
  if (change === 'publishing_cover') return {
    keep_locked_script: lockedScriptValid,
    keep_audio: audioValid,
    invalidate_publishing_cover: false,
    invalidate_white_cat_visual_style_selection: usesCoverDerivedStyle,
    invalidate_visual_density_selection: usesCoverDerivedStyle,
    invalidate_workflow_approval_mode: usesCoverDerivedStyle,
    invalidate_narration_audio_source_selection: usesCoverDerivedStyle,
    invalidate_from: usesCoverDerivedStyle ? POST_COVER_SELECTION_BATCH_PHASE : null,
  };
  if (change === 'visual_density') return {
    keep_locked_script: lockedScriptValid,
    keep_audio: audioValid,
    invalidate_white_cat_visual_style_selection: false,
    invalidate_visual_density_selection: false,
    invalidate_workflow_approval_mode: true,
    invalidate_narration_audio_source_selection: true,
    invalidate_from: POST_COVER_SELECTION_BATCH_PHASE,
  };
  if (change === 'narration_audio_source') return {
    keep_locked_script: lockedScriptValid,
    keep_audio: false,
    invalidate_white_cat_visual_style_selection: false,
    invalidate_visual_density_selection: false,
    invalidate_workflow_approval_mode: false,
    invalidate_narration_audio_source_selection: false,
    invalidate_from: 'audio_validation',
  };
  throw new Error('unsupported selection invalidation change');
};

const finalReviewProjection = (review) => ({
  contract_version: ONE_CLICK_VISUAL_REVIEW_VERSION,
  mode: ONE_CLICK_FINAL_REVIEW_MODE,
  storyboard_sha256: review.storyboard_sha256,
  policy_sha256: review.policy_sha256,
  assets: review.assets.map((asset) => ({
    asset_id: asset.asset_id,
    path: asset.path,
    checksum_sha256: asset.checksum_sha256,
    qa_status: asset.preapproval_qa_status ?? asset.qa_status,
    ...(asset.mechanical_qa_result === undefined
      ? {} : {mechanical_qa_result: asset.mechanical_qa_result}),
    ...(asset.user_mechanical_gate_override_result === undefined
      ? {} : {user_mechanical_gate_override_result: asset.user_mechanical_gate_override_result}),
    ...(asset.user_mechanical_gate_override_sha256 === undefined
      ? {} : {user_mechanical_gate_override_sha256: asset.user_mechanical_gate_override_sha256}),
  })),
});

export const buildOneClickFinalVisualMapSha256 = (review) => sha256(finalReviewProjection(review));

export const validateOneClickFinalVisualReview = (review, {allowApproved = false} = {}) => {
  if (review?.contract_version !== ONE_CLICK_VISUAL_REVIEW_VERSION
    || review.mode !== ONE_CLICK_FINAL_REVIEW_MODE
    || !Array.isArray(review.assets) || review.assets.length === 0) {
    throw new Error('one-click final visual review is missing');
  }
  requireSha256(review.storyboard_sha256, 'one-click final review storyboard checksum');
  requireSha256(review.policy_sha256, 'one-click final review policy checksum');
  const ids = new Set();
  let waivedAssetCount = 0;
  review.assets.forEach((asset) => {
    if (typeof asset.asset_id !== 'string' || asset.asset_id.trim() === '' || ids.has(asset.asset_id)) {
      throw new Error('one-click final visual review asset IDs must be unique');
    }
    ids.add(asset.asset_id);
    if (typeof asset.path !== 'string' || asset.path.trim() === '') throw new Error('one-click final review asset path is missing');
    requireSha256(asset.checksum_sha256, `${asset.asset_id} checksum`);
    const allowed = allowApproved
      ? [
        'qa_passed_pending_final_review',
        'qa_failed_but_waived_once_pending_final_review',
        'approved',
      ]
      : [
        'qa_passed_pending_final_review',
        'qa_failed_but_waived_once_pending_final_review',
      ];
    if (!allowed.includes(asset.qa_status)) throw new Error(`${asset.asset_id} has not passed QA for final review`);
    const preapprovalQaStatus = asset.qa_status === 'approved'
      ? asset.preapproval_qa_status
      : asset.qa_status;
    if (asset.qa_status === 'approved'
        && ![
          'qa_passed_pending_final_review',
          'qa_failed_but_waived_once_pending_final_review',
        ].includes(preapprovalQaStatus)) {
      throw new Error(`${asset.asset_id} approved asset lacks its preapproval QA disposition`);
    }
    const hasOverrideEvidence = [
      asset.mechanical_qa_result,
      asset.user_mechanical_gate_override_result,
      asset.user_mechanical_gate_override_sha256,
    ].some((value) => value !== undefined && value !== null);
    if (preapprovalQaStatus === 'qa_failed_but_waived_once_pending_final_review') {
      if (asset.mechanical_qa_result !== 'failed_but_waived_once'
          || asset.user_mechanical_gate_override_result !== 'pass_with_user_override') {
        throw new Error(`${asset.asset_id} mechanical override evidence is incomplete`);
      }
      requireSha256(
        asset.user_mechanical_gate_override_sha256,
        `${asset.asset_id} user mechanical gate override checksum`,
      );
      waivedAssetCount += 1;
    } else if (hasOverrideEvidence) {
      throw new Error(`${asset.asset_id} ordinary QA status cannot carry mechanical override evidence`);
    }
  });
  const expected = buildOneClickFinalVisualMapSha256(review);
  if (review.presented_map_sha256 !== expected) throw new Error('one-click final visual map checksum is stale');
  return {
    result: waivedAssetCount > 0 ? 'pass_with_user_override' : 'pass',
    presented_map_sha256: expected,
    asset_count: review.assets.length,
    waived_asset_count: waivedAssetCount,
  };
};

export const approveOneClickFinalVisualReview = (review, decision) => {
  validateOneClickFinalVisualReview(review);
  if (decision?.status !== 'approved'
    || decision.presented_map_sha256 !== review.presented_map_sha256) {
    throw new Error('one-click final visual approval must bind the complete exact hash list');
  }
  requireDecision({...decision, status: 'selected'}, 'one-click final visual approval');
  return {
    ...review,
    status: 'approved',
    assets: review.assets.map((asset) => ({
      ...asset,
      preapproval_qa_status: asset.qa_status,
      qa_status: 'approved',
    })),
    approval: decision,
    visual_assets_locked: true,
    next_phase: CAPTION_CHOICE_PHASE,
  };
};

export const assertOneClickProtectedActionAllowed = ({phase, captionDelivery, visualReview}, action) => {
  const protectedActions = new Set(['still', 'studio', 'preview', 'composition', 'render']);
  if (!protectedActions.has(action)) throw new Error(`unknown protected action: ${action}`);
  if (phase === ONE_CLICK_FINAL_REVIEW_PHASE) throw new Error(`${action} forbidden before final visual approval`);
  if (visualReview?.status !== 'approved' || visualReview.visual_assets_locked !== true) {
    throw new Error(`${action} forbidden before final visual approval and lock`);
  }
  if (captionDelivery?.status !== 'selected') throw new Error(`${action} forbidden before caption delivery choice`);
  return {result: 'pass', action};
};

export const validateRevoiceDensityLock = ({parent, derivative}) => {
  for (const field of ['density_mode', 'visual_density_selection_sha256', 'rhythm_sha256', 'action_schedule_set_sha256']) {
    if (parent?.[field] !== derivative?.[field]) throw new Error(`revoice must preserve parent density binding: ${field}`);
  }
  if (JSON.stringify(parent.asset_counts) !== JSON.stringify(derivative.asset_counts)
    || JSON.stringify(parent.asset_order) !== JSON.stringify(derivative.asset_order)) {
    throw new Error('revoice must preserve parent density counts and order');
  }
  return {result: 'pass'};
};
