import crypto from 'node:crypto';

export const VISUAL_DENSITY_SELECTION_VERSION = 'visual-density-selection-v1';
export const WORKFLOW_APPROVAL_MODE_VERSION = 'workflow-approval-mode-v1';
export const ONE_CLICK_APPROVAL_POLICY_VERSION = 'one-click-approval-policy-v1';
export const ONE_CLICK_VISUAL_REVIEW_VERSION = 'visual-asset-review-v3';
export const ONE_CLICK_FINAL_REVIEW_MODE = 'one_click_final_review_v1';
export const ONE_CLICK_FINAL_REVIEW_PHASE = 'awaiting_precomposition_visual_review';
export const CAPTION_CHOICE_PHASE = 'awaiting_caption_delivery_choice';

const SHA256 = /^[a-f0-9]{64}$/;
const DENSITY_MODES = new Set(['standard', 'rich']);
const APPROVAL_MODES = new Set(['manual', 'one_click']);
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

const densityProjection = (selection) => ({
  contract_version: VISUAL_DENSITY_SELECTION_VERSION,
  gate2_script_sha256: selection.gate2_script_sha256,
  density_mode: selection.density_mode,
  decision: {
    status: selection.decision?.status,
    exact_message: selection.decision?.exact_message,
    decided_at: selection.decision?.decided_at,
  },
});

export const buildVisualDensitySelectionSha256 = (selection) => sha256(densityProjection(selection));

export const validateVisualDensitySelection = (selection, {gate2ScriptSha256}) => {
  if (selection?.contract_version !== VISUAL_DENSITY_SELECTION_VERSION) {
    throw new Error('visual density selection authority mismatch');
  }
  requireSha256(gate2ScriptSha256, 'current Gate 2 script checksum');
  if (selection.gate2_script_sha256 !== gate2ScriptSha256) {
    throw new Error('visual density selection is stale after Gate 2 change');
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

const policyProjection = (policy) => ({
  contract_version: ONE_CLICK_APPROVAL_POLICY_VERSION,
  gate2_script_sha256: policy.gate2_script_sha256,
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

export const validateApprovalSelectionSequence = ({gate2ScriptSha256, density, mode, policy = null}) => {
  const densityResult = validateVisualDensitySelection(density, {gate2ScriptSha256});
  const modeResult = validateWorkflowApprovalMode(mode, {
    gate2ScriptSha256,
    visualDensitySelectionSha256: densityResult.selection_sha256,
  });
  if (mode.approval_mode === 'manual') {
    if (policy !== null) throw new Error('manual mode must not carry one-click policy');
  } else {
    validateOneClickApprovalPolicy(policy, {
      gate2ScriptSha256,
      visualDensitySelectionSha256: densityResult.selection_sha256,
      workflowApprovalModeSelectionSha256: modeResult.selection_sha256,
    });
  }
  return {result: 'pass', density_mode: density.density_mode, approval_mode: mode.approval_mode};
};

export const resolveLegacyDensity = ({episodeStarted, densitySelection, explicitRebuild = false}) => {
  if (densitySelection) return densitySelection.density_mode;
  if (episodeStarted && !explicitRebuild) return 'legacy_standard';
  throw new Error('new or explicitly rebuilt episode requires visual density selection');
};

export const calculateSelectionInvalidation = ({change, lockedScriptValid = true, audioValid = true}) => {
  if (change === 'gate2_script') return {
    keep_locked_script: false,
    keep_audio: false,
    invalidate_visual_density_selection: true,
    invalidate_workflow_approval_mode: true,
    invalidate_from: 'gate2',
  };
  if (change === 'visual_density') return {
    keep_locked_script: lockedScriptValid,
    keep_audio: audioValid,
    invalidate_visual_density_selection: false,
    invalidate_workflow_approval_mode: true,
    invalidate_from: 'storyboard_construction',
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
    qa_status: asset.qa_status,
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
  review.assets.forEach((asset) => {
    if (typeof asset.asset_id !== 'string' || asset.asset_id.trim() === '' || ids.has(asset.asset_id)) {
      throw new Error('one-click final visual review asset IDs must be unique');
    }
    ids.add(asset.asset_id);
    if (typeof asset.path !== 'string' || asset.path.trim() === '') throw new Error('one-click final review asset path is missing');
    requireSha256(asset.checksum_sha256, `${asset.asset_id} checksum`);
    const allowed = allowApproved ? ['qa_passed_pending_final_review', 'approved'] : ['qa_passed_pending_final_review'];
    if (!allowed.includes(asset.qa_status)) throw new Error(`${asset.asset_id} has not passed QA for final review`);
  });
  const expected = buildOneClickFinalVisualMapSha256(review);
  if (review.presented_map_sha256 !== expected) throw new Error('one-click final visual map checksum is stale');
  return {result: 'pass', presented_map_sha256: expected, asset_count: review.assets.length};
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
    assets: review.assets.map((asset) => ({...asset, qa_status: 'approved'})),
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
