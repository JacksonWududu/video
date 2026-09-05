import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';

import {buildCoverStyleScopeSelectionSha256} from '../publishing-cover/contract.mjs';

import {
  WHITE_CAT_VISUAL_STYLE_OPTIONS,
  WHITE_CAT_VISUAL_STYLE_SELECTION_VERSION_V2,
  approveOneClickFinalVisualReview,
  assertOneClickProtectedActionAllowed,
  buildOneClickApprovalPolicySha256,
  buildOneClickFinalVisualMapSha256,
  buildNarrationAudioSourceSelectionSha256,
  buildPostCoverSelectionBatchSha256,
  buildVisualDensitySelectionSha256,
  buildWhiteCatVisualStyleSelectionSha256,
  buildWorkflowApprovalModeSha256,
  calculateSelectionInvalidation,
  resolveLegacyDensity,
  validateApprovalSelectionSequence,
  validateOneClickFinalVisualReview,
  validateOneClickApprovalPolicy,
  validateNarrationAudioSourceSelection,
  validatePostCoverSelectionBatch,
  validateRevoiceDensityLock,
  validateWhiteCatVisualStyleSelection,
} from './contract.mjs';

const gate2 = '1'.repeat(64);
const decision = (message) => ({status: 'selected', exact_message: message, decided_at: '2026-08-22T10:00:00+08:00'});

const buildSelections = ({
  whiteCatStyleId = 'loose-line-vivid-watercolor',
  densityMode = 'rich',
  approvalMode = 'one_click',
  audioSourceMode = 'edge_tts',
  batchMessage = null,
} = {}) => {
  const selected = (fallback) => decision(batchMessage ?? fallback);
  const whiteCatStyle = {
    contract_version: 'white-cat-visual-style-selection-v1',
    gate2_script_sha256: gate2,
    style_id: whiteCatStyleId,
    ...WHITE_CAT_VISUAL_STYLE_OPTIONS[whiteCatStyleId],
    decision: selected(whiteCatStyleId),
  };
  whiteCatStyle.selection_sha256 = buildWhiteCatVisualStyleSelectionSha256(whiteCatStyle);
  const density = {
    contract_version: 'visual-density-selection-v1',
    gate2_script_sha256: gate2,
    white_cat_visual_style_selection_sha256: whiteCatStyle.selection_sha256,
    density_mode: densityMode,
    decision: selected(densityMode),
  };
  density.selection_sha256 = buildVisualDensitySelectionSha256(density);
  const mode = {
    contract_version: 'workflow-approval-mode-v1',
    gate2_script_sha256: gate2,
    visual_density_selection_sha256: density.selection_sha256,
    approval_mode: approvalMode,
    decision: selected(approvalMode),
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
  const narrationAudioSource = {
    contract_version: 'narration-audio-source-selection-v1',
    gate2_script_sha256: gate2,
    workflow_approval_mode_selection_sha256: mode.selection_sha256,
    source_mode: audioSourceMode,
    edge_tts: audioSourceMode === 'edge_tts' ? {
      provider: 'edge-tts',
      voice: 'zh-CN-YunjianNeural',
      rate: '+20%',
      network_access_authorized: true,
    } : null,
    decision: selected(audioSourceMode),
  };
  narrationAudioSource.selection_sha256 = buildNarrationAudioSourceSelectionSha256(narrationAudioSource);
  return {whiteCatStyle, density, mode, policy, narrationAudioSource};
};

const buildCorePostCoverBatch = () => {
  const batchMessage = '风格=水彩；密度=丰富；审批=一键；旁白=Edge TTS';
  const selections = buildSelections({batchMessage});
  const batch = {
    contract_version: 'post-cover-selection-batch-v1',
    gate2_script_sha256: gate2,
    decision: decision(batchMessage),
    white_cat_visual_style_selection_sha256: selections.whiteCatStyle.selection_sha256,
    cover_style_scope_selection_sha256: null,
    visual_density_selection_sha256: selections.density.selection_sha256,
    workflow_approval_mode_selection_sha256: selections.mode.selection_sha256,
    one_click_approval_policy_sha256: selections.policy.policy_sha256,
    narration_audio_source_selection_sha256: selections.narrationAudioSource.selection_sha256,
  };
  batch.batch_sha256 = buildPostCoverSelectionBatchSha256(batch);
  return {...selections, batch};
};

const buildCoverDerivedPostCoverBatch = () => {
  const batchMessage = '风格=当前封面；范围=仅本期；密度=丰富；审批=手动；旁白=同目录';
  const sharedDecision = decision(batchMessage);
  const whiteCatStyle = {
    contract_version: WHITE_CAT_VISUAL_STYLE_SELECTION_VERSION_V2,
    gate2_script_sha256: gate2,
    style_source: 'episode_cover',
    style_id: 'cover-derived-episode-style',
    source_style_id: null,
    style_label: '当前封面风格',
    treatment_profile_id: 'imagegen-cover-derived-narrative',
    visual_cohesion_profile_id: 'cover-derived-cohesion-v1',
    style_profile_path: 'topic/schema/cover-derived-style-profile-v1.json',
    style_profile_checksum_sha256: '4'.repeat(64),
    publishing_cover_package_path: 'topic/schema/publishing-cover-generation-v1.json',
    publishing_cover_package_sha256: '5'.repeat(64),
    decision: sharedDecision,
  };
  whiteCatStyle.selection_sha256 = buildWhiteCatVisualStyleSelectionSha256(whiteCatStyle);
  const coverDerivedStyleProfileSha256 = '6'.repeat(64);
  const coverStyleScope = {
    contract_version: 'cover-style-scope-selection-v1',
    white_cat_visual_style_selection_sha256: whiteCatStyle.selection_sha256,
    cover_derived_style_profile_sha256: coverDerivedStyleProfileSha256,
    scope: 'episode_only',
    decision: sharedDecision,
  };
  coverStyleScope.selection_sha256 = buildCoverStyleScopeSelectionSha256(coverStyleScope);
  const density = {
    contract_version: 'visual-density-selection-v1',
    gate2_script_sha256: gate2,
    white_cat_visual_style_selection_sha256: whiteCatStyle.selection_sha256,
    density_mode: 'rich',
    decision: sharedDecision,
  };
  density.selection_sha256 = buildVisualDensitySelectionSha256(density);
  const mode = {
    contract_version: 'workflow-approval-mode-v1',
    gate2_script_sha256: gate2,
    visual_density_selection_sha256: density.selection_sha256,
    approval_mode: 'manual',
    decision: sharedDecision,
  };
  mode.selection_sha256 = buildWorkflowApprovalModeSha256(mode);
  const narrationAudioSource = {
    contract_version: 'narration-audio-source-selection-v1',
    gate2_script_sha256: gate2,
    workflow_approval_mode_selection_sha256: mode.selection_sha256,
    source_mode: 'colocated_voice',
    edge_tts: null,
    decision: sharedDecision,
  };
  narrationAudioSource.selection_sha256 = buildNarrationAudioSourceSelectionSha256(narrationAudioSource);
  const batch = {
    contract_version: 'post-cover-selection-batch-v1',
    gate2_script_sha256: gate2,
    decision: sharedDecision,
    white_cat_visual_style_selection_sha256: whiteCatStyle.selection_sha256,
    cover_style_scope_selection_sha256: coverStyleScope.selection_sha256,
    visual_density_selection_sha256: density.selection_sha256,
    workflow_approval_mode_selection_sha256: mode.selection_sha256,
    one_click_approval_policy_sha256: null,
    narration_audio_source_selection_sha256: narrationAudioSource.selection_sha256,
  };
  batch.batch_sha256 = buildPostCoverSelectionBatchSha256(batch);
  return {
    batch,
    whiteCatStyle,
    coverStyleScope,
    coverDerivedStyleProfileSha256,
    density,
    mode,
    policy: null,
    narrationAudioSource,
  };
};

test('post-cover selections validate as one atomic core-style response', () => {
  const value = buildCorePostCoverBatch();
  assert.equal(validatePostCoverSelectionBatch({
    ...value,
    gate2ScriptSha256: gate2,
  }).result, 'pass');

  value.narrationAudioSource.decision = decision('只单独回答旁白');
  value.narrationAudioSource.selection_sha256 = buildNarrationAudioSourceSelectionSha256(
    value.narrationAudioSource,
  );
  value.batch.narration_audio_source_selection_sha256 = value.narrationAudioSource.selection_sha256;
  value.batch.batch_sha256 = buildPostCoverSelectionBatchSha256(value.batch);
  assert.throws(
    () => validatePostCoverSelectionBatch({...value, gate2ScriptSha256: gate2}),
    /one complete user response/,
  );
});

test('post-cover selections require scope only for the cover-derived style', () => {
  const value = buildCoverDerivedPostCoverBatch();
  assert.equal(validatePostCoverSelectionBatch({
    ...value,
    gate2ScriptSha256: gate2,
  }).scope, 'episode_only');
  assert.throws(
    () => validatePostCoverSelectionBatch({
      ...value,
      gate2ScriptSha256: gate2,
      coverStyleScope: null,
    }),
    /cover style scope selection authority mismatch/,
  );

  const core = buildCorePostCoverBatch();
  assert.throws(
    () => validatePostCoverSelectionBatch({
      ...core,
      gate2ScriptSha256: gate2,
      coverStyleScope: value.coverStyleScope,
      coverDerivedStyleProfileSha256: value.coverDerivedStyleProfileSha256,
    }),
    /only an episode-cover style/,
  );
});

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

test('Gate 2 white-cat style selection accepts all three pinned profiles and exact bytes', () => {
  for (const styleId of [
    'loose-line-vivid-watercolor',
    'twilight-neon-animation',
    'gilded-mythic-storybook',
  ]) {
    const selection = buildSelections({whiteCatStyleId: styleId}).whiteCatStyle;
    assert.equal(
      validateWhiteCatVisualStyleSelection(selection, {gate2ScriptSha256: gate2}).style_id,
      styleId,
    );
    const checksum = (filePath) => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    assert.equal(checksum(selection.style_skill_path), selection.style_skill_checksum_sha256);
    assert.equal(checksum(selection.style_profile_path), selection.style_profile_checksum_sha256);
  }
  const twilight = buildSelections({whiteCatStyleId: 'twilight-neon-animation'}).whiteCatStyle;
  const substituted = structuredClone(twilight);
  substituted.style_profile_checksum_sha256 = '0'.repeat(64);
  substituted.selection_sha256 = buildWhiteCatVisualStyleSelectionSha256(substituted);
  assert.throws(
    () => validateWhiteCatVisualStyleSelection(substituted, {gate2ScriptSha256: gate2}),
    /stale or substituted style_profile_checksum_sha256/,
  );
});

test('cover-derived style selection v2 binds an immutable episode-local profile and cover package', () => {
  const selection = {
    contract_version: WHITE_CAT_VISUAL_STYLE_SELECTION_VERSION_V2,
    gate2_script_sha256: gate2,
    style_source: 'episode_cover',
    style_id: 'cover-derived-episode-style',
    source_style_id: null,
    style_label: '当前封面风格',
    treatment_profile_id: 'imagegen-cover-derived-narrative',
    visual_cohesion_profile_id: 'cover-derived-cohesion-v1',
    style_profile_path: 'topic/schema/cover-derived-style-profile-v1.json',
    style_profile_checksum_sha256: '4'.repeat(64),
    publishing_cover_package_path: 'topic/schema/publishing-cover-generation-v1.json',
    publishing_cover_package_sha256: '5'.repeat(64),
    decision: decision('使用当前封面风格'),
  };
  selection.selection_sha256 = buildWhiteCatVisualStyleSelectionSha256(selection);
  const result = validateWhiteCatVisualStyleSelection(selection, {gate2ScriptSha256: gate2});
  assert.equal(result.style_source, 'episode_cover');
  assert.equal(result.style_profile_checksum_sha256, '4'.repeat(64));

  const stale = structuredClone(selection);
  stale.style_profile_checksum_sha256 = '6'.repeat(64);
  assert.throws(
    () => validateWhiteCatVisualStyleSelection(stale, {gate2ScriptSha256: gate2}),
    /checksum is stale/,
  );
});

test('registered custom style v2 keeps its source ID but uses the generic runtime treatment', () => {
  const selection = {
    contract_version: WHITE_CAT_VISUAL_STYLE_SELECTION_VERSION_V2,
    gate2_script_sha256: gate2,
    style_source: 'registered_custom',
    style_id: 'cover-derived-episode-style',
    source_style_id: 'moonlit-paper-v1',
    style_label: '月夜纸艺',
    treatment_profile_id: 'imagegen-cover-derived-narrative',
    visual_cohesion_profile_id: 'cover-derived-cohesion-v1',
    style_profile_path: 'topic/schema/episode-style-profile-moonlit-paper-v1.json',
    style_profile_checksum_sha256: '7'.repeat(64),
    publishing_cover_package_path: null,
    publishing_cover_package_sha256: null,
    decision: decision('使用月夜纸艺'),
  };
  selection.selection_sha256 = buildWhiteCatVisualStyleSelectionSha256(selection);
  assert.equal(
    validateWhiteCatVisualStyleSelection(selection, {gate2ScriptSha256: gate2}).source_style_id,
    'moonlit-paper-v1',
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
    invalidate_from: 'awaiting_post_cover_selection_batch',
  });
});

test('publishing-cover change reopens the selection batch only for a derived profile', () => {
  assert.deepEqual(calculateSelectionInvalidation({change: 'publishing_cover', usesCoverDerivedStyle: true}), {
    keep_locked_script: true,
    keep_audio: true,
    invalidate_publishing_cover: false,
    invalidate_white_cat_visual_style_selection: true,
    invalidate_visual_density_selection: true,
    invalidate_workflow_approval_mode: true,
    invalidate_narration_audio_source_selection: true,
    invalidate_from: 'awaiting_post_cover_selection_batch',
  });
  assert.deepEqual(calculateSelectionInvalidation({change: 'publishing_cover', usesCoverDerivedStyle: false}), {
    keep_locked_script: true,
    keep_audio: true,
    invalidate_publishing_cover: false,
    invalidate_white_cat_visual_style_selection: false,
    invalidate_visual_density_selection: false,
    invalidate_workflow_approval_mode: false,
    invalidate_narration_audio_source_selection: false,
    invalidate_from: null,
  });
});

test('density change preserves valid script and audio but reopens dependent batch choices', () => {
  assert.deepEqual(calculateSelectionInvalidation({change: 'visual_density'}), {
    keep_locked_script: true,
    keep_audio: true,
    invalidate_white_cat_visual_style_selection: false,
    invalidate_visual_density_selection: false,
    invalidate_workflow_approval_mode: true,
    invalidate_narration_audio_source_selection: true,
    invalidate_from: 'awaiting_post_cover_selection_batch',
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

const userMediaAudio = () => ({
  path: '/media/user-selected-video.mp4',
  checksum_sha256: '3'.repeat(64),
  audio_stream_index: 0,
  extraction_mode: 'stream_copy',
  source_access_authorized: true,
  fallback_allowed: false,
});

const buildUserMediaSelection = () => {
  const selection = {
    contract_version: 'narration-audio-source-selection-v1',
    gate2_script_sha256: gate2,
    workflow_approval_mode_selection_sha256: '2'.repeat(64),
    source_mode: 'user_media_audio', edge_tts: null,
    user_media_audio: userMediaAudio(),
    decision: decision('提取指定视频的音频作为本期旁白'),
  };
  selection.selection_sha256 = buildNarrationAudioSourceSelectionSha256(selection);
  return selection;
};

const mediaSelectionBindings = {
  gate2ScriptSha256: gate2, workflowApprovalModeSelectionSha256: '2'.repeat(64),
};

test('explicit user-media audio binds exact media bytes and a global audio stream index', () => {
  const selection = buildUserMediaSelection();
  const original = structuredClone(selection);
  assert.equal(validateNarrationAudioSourceSelection(selection, mediaSelectionBindings).source_mode, 'user_media_audio');
  assert.deepEqual(selection, original);
  for (const [field, value] of [
    ['path', '/media/another-video.mp4'], ['checksum_sha256', '4'.repeat(64)], ['audio_stream_index', 1],
  ]) {
    const changed = structuredClone(selection);
    changed.user_media_audio[field] = value;
    assert.throws(() => validateNarrationAudioSourceSelection(changed, mediaSelectionBindings), /checksum is stale/);
  }
});

test('user-media audio rejects incomplete, ambiguous, unauthorized, or fallback-enabled sources', () => {
  for (const [field, value] of [
    ['path', undefined], ['path', 'relative/video.mp4'], ['path', 'https://example.com/video.mp4'],
    ['path', '/media/../video.mp4'], ['path', '/media/video\u0000.mp4'],
    ['checksum_sha256', undefined], ['checksum_sha256', 'not-a-sha256'],
    ['audio_stream_index', undefined], ['audio_stream_index', -1], ['audio_stream_index', 0.5], ['audio_stream_index', '0'],
    ['extraction_mode', undefined], ['extraction_mode', 'transcode'],
    ['source_access_authorized', undefined], ['source_access_authorized', false],
    ['fallback_allowed', undefined], ['fallback_allowed', true],
  ]) {
    const selection = buildUserMediaSelection();
    selection.user_media_audio[field] = value;
    selection.selection_sha256 = buildNarrationAudioSourceSelectionSha256(selection);
    assert.throws(() => validateNarrationAudioSourceSelection(selection, mediaSelectionBindings), /user.media audio/);
  }
  const noDecision = buildUserMediaSelection();
  noDecision.decision.status = 'pending';
  noDecision.selection_sha256 = buildNarrationAudioSourceSelectionSha256(noDecision);
  assert.throws(() => validateNarrationAudioSourceSelection(noDecision, mediaSelectionBindings), /explicit user selection/);
  assert.throws(() => validateNarrationAudioSourceSelection(buildUserMediaSelection(), {
    ...mediaSelectionBindings, gate2ScriptSha256: '9'.repeat(64),
  }), /selection is stale/);
  assert.throws(() => validateNarrationAudioSourceSelection(buildUserMediaSelection(), {
    ...mediaSelectionBindings, workflowApprovalModeSelectionSha256: '9'.repeat(64),
  }), /selection is stale/);
});

test('narration source modes may not carry competing source settings', () => {
  const media = buildUserMediaSelection();
  media.edge_tts = {provider: 'edge-tts'};
  media.selection_sha256 = buildNarrationAudioSourceSelectionSha256(media);
  assert.throws(() => validateNarrationAudioSourceSelection(media, mediaSelectionBindings), /must not carry edge_tts/);
  for (const sourceMode of ['colocated_voice', 'edge_tts']) {
    const {narrationAudioSource: selection, mode} = buildSelections({audioSourceMode: sourceMode});
    selection.user_media_audio = userMediaAudio();
    selection.selection_sha256 = buildNarrationAudioSourceSelectionSha256(selection);
    assert.throws(() => validateNarrationAudioSourceSelection(selection, {
      gate2ScriptSha256: gate2, workflowApprovalModeSelectionSha256: mode.selection_sha256,
    }), /must not carry user_media_audio/);
  }
});

test('existing narration source hashes stay unchanged and user media works in a complete batch', () => {
  const expectedHashes = {
    edge_tts: 'ae90ea86278f11fd3505f2f98f90b0018268462fe3c9397870701cfbac66d4be',
    colocated_voice: '23d0b00a202f20eb4fb120c7f57569337b3c0665d452a2d8598257b45ab2ebfd',
  };
  for (const sourceMode of Object.keys(expectedHashes)) {
    const {narrationAudioSource: selection} = buildSelections({audioSourceMode: sourceMode});
    selection.workflow_approval_mode_selection_sha256 = '2'.repeat(64);
    selection.decision = {status: 'selected', exact_message: '使用指定音源', decided_at: '2026-09-04T12:00:00Z'};
    assert.equal(buildNarrationAudioSourceSelectionSha256(selection), expectedHashes[sourceMode]);
  }
  const value = buildCorePostCoverBatch();
  Object.assign(value.narrationAudioSource, {source_mode: 'user_media_audio', edge_tts: null, user_media_audio: userMediaAudio()});
  value.narrationAudioSource.selection_sha256 = buildNarrationAudioSourceSelectionSha256(value.narrationAudioSource);
  value.batch.narration_audio_source_selection_sha256 = value.narrationAudioSource.selection_sha256;
  value.batch.batch_sha256 = buildPostCoverSelectionBatchSha256(value.batch);
  assert.equal(validatePostCoverSelectionBatch({...value, gate2ScriptSha256: gate2}).source_mode, 'user_media_audio');
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

test('one-click final review preserves and hashes an exact mechanical override disposition', () => {
  const review = buildFinalReview();
  review.assets[0] = {
    ...review.assets[0],
    qa_status: 'qa_failed_but_waived_once_pending_final_review',
    mechanical_qa_result: 'failed_but_waived_once',
    user_mechanical_gate_override_result: 'pass_with_user_override',
    user_mechanical_gate_override_sha256: '8'.repeat(64),
  };
  review.presented_map_sha256 = buildOneClickFinalVisualMapSha256(review);
  const originalDigest = review.presented_map_sha256;

  assert.equal(validateOneClickFinalVisualReview(review).result, 'pass_with_user_override');
  const tampered = structuredClone(review);
  tampered.assets[0].user_mechanical_gate_override_sha256 = '9'.repeat(64);
  assert.throws(
    () => validateOneClickFinalVisualReview(tampered),
    /map checksum is stale/,
  );

  const approved = approveOneClickFinalVisualReview(review, {
    status: 'approved',
    exact_message: '批准含一次机械放行警示的完整精确哈希清单',
    decided_at: '2026-08-22T11:00:00+08:00',
    presented_map_sha256: originalDigest,
  });
  assert.equal(approved.assets[0].qa_status, 'approved');
  assert.equal(
    approved.assets[0].preapproval_qa_status,
    'qa_failed_but_waived_once_pending_final_review',
  );
  assert.equal(approved.assets[0].mechanical_qa_result, 'failed_but_waived_once');
  assert.equal(
    approved.assets[0].user_mechanical_gate_override_result,
    'pass_with_user_override',
  );
  assert.equal(approved.presented_map_sha256, originalDigest);
  assert.equal(
    validateOneClickFinalVisualReview(approved, {allowApproved: true}).result,
    'pass_with_user_override',
  );
});

test('one-click final review rejects incomplete or disguised mechanical override evidence', () => {
  const incomplete = buildFinalReview();
  incomplete.assets[0].qa_status = 'qa_failed_but_waived_once_pending_final_review';
  incomplete.presented_map_sha256 = buildOneClickFinalVisualMapSha256(incomplete);
  assert.throws(
    () => validateOneClickFinalVisualReview(incomplete),
    /mechanical override evidence is incomplete/,
  );

  const disguised = buildFinalReview();
  disguised.assets[0].user_mechanical_gate_override_result = 'pass_with_user_override';
  disguised.presented_map_sha256 = buildOneClickFinalVisualMapSha256(disguised);
  assert.throws(
    () => validateOneClickFinalVisualReview(disguised),
    /ordinary QA status cannot carry mechanical override evidence/,
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
