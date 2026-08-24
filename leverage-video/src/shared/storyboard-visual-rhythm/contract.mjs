import crypto from 'node:crypto';

export const STORYBOARD_VISUAL_RHYTHM_VERSION = 'storyboard-visual-rhythm-v1';
export const STORYBOARD_VISUAL_RHYTHM_V2_VERSION = 'storyboard-visual-rhythm-v2';
export const VISUAL_DENSITY_SELECTION_VERSION = 'visual-density-selection-v1';
export const MEDIUM_HIGH_VISUAL_RHYTHM_PROFILE = 'medium_high_v1';
export const MOTION_TIERS = Object.freeze(['layered', 'stateful', 'hero_pose']);
export const MEANINGFUL_CHANGE_MAX_GAP_FRAMES = 120;
export const STRUCTURE_CHANGE_MAX_GAP_FRAMES = 540;
export const FIRST_WINDOW_FRAMES = 900;

const SHA256 = /^[a-f0-9]{64}$/;
const ATTENTION_FUNCTIONS = new Set([
  'hook',
  'contrast',
  'risk',
  'reveal',
  'explain',
  'evidence',
  'payoff',
  'bridge',
]);

const requireNonEmptyString = (value, label) => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
};

const requireSha256 = (value, label) => {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256`);
  }
  return value;
};

const requireInteger = (value, label, minimum = 0) => {
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${label} must be an integer >= ${minimum}`);
  }
  return value;
};

const requireStringArray = (value, label, {minimum = 1} = {}) => {
  if (!Array.isArray(value) || value.length < minimum
    || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw new Error(`${label} must contain at least ${minimum} non-empty strings`);
  }
  return value;
};

const canonicalRows = (artifact) => artifact.shots.map((shot) => ({
  shot_id: shot.shot_id,
  start_frame: shot.start_frame,
  end_frame: shot.end_frame,
  motion_tier: shot.motion_tier,
  attention_function: shot.attention_function,
  visual_question: shot.visual_question,
  visual_payoff: shot.visual_payoff,
  visual_structure_id: shot.visual_structure_id,
  asset_plan: shot.asset_plan,
  ...(artifact.contract_version === STORYBOARD_VISUAL_RHYTHM_V2_VERSION
    ? {density_fallback: shot.density_fallback ?? null}
    : {}),
  state_count_rationale: shot.state_count_rationale ?? null,
  ...(artifact.contract_version === STORYBOARD_VISUAL_RHYTHM_V2_VERSION
    ? {quantity_rationale: shot.quantity_rationale ?? null}
    : {}),
  split_assessment: shot.split_assessment ?? null,
  meaningful_change_events: shot.meaningful_change_events,
  intra_shot_transition_plan: shot.intra_shot_transition_plan.map((transition) => ({
    from_asset_id: transition.from_asset_id,
    to_asset_id: transition.to_asset_id,
    kind: transition.kind,
  })),
  performance_plan: shot.performance_plan,
  continuity: shot.continuity,
}));

export const buildStoryboardVisualRhythmMapSha256 = (artifact) => crypto
  .createHash('sha256')
  .update(JSON.stringify({
    contract_version: artifact.contract_version,
    ...(artifact.contract_version === STORYBOARD_VISUAL_RHYTHM_V2_VERSION
      ? {
        density_mode: artifact.density_mode ?? null,
        visual_density_selection_sha256: artifact.visual_density_selection_sha256 ?? null,
      }
      : {}),
    profile: artifact.profile,
    storyboard: artifact.storyboard,
    visual_direction_review: artifact.visual_direction_review,
    shots: canonicalRows(artifact),
  }))
  .digest('hex');

const validateDensityFallback = (shot, {densityMode}) => {
  const assetTotal = shot.motion_tier === 'hero_pose'
    ? shot.asset_plan.pose_count + 1
    : shot.asset_plan.main_image_count;
  const targetMinimum = shot.motion_tier === 'hero_pose' ? 10 : 4;
  const required = densityMode === 'rich'
    && ['stateful', 'hero_pose'].includes(shot.motion_tier)
    && assetTotal < targetMinimum;
  if (!required) {
    if (shot.density_fallback !== null && shot.density_fallback !== undefined) {
      throw new Error(`${shot.shot_id} density_fallback is allowed only below the rich target range`);
    }
    return;
  }
  const fallback = shot.density_fallback;
  if (!fallback || typeof fallback !== 'object' || Array.isArray(fallback)
    || fallback.target_minimum !== targetMinimum
    || fallback.actual_count !== assetTotal
    || fallback.maximum_feasible_count !== assetTotal
    || !['insufficient_semantic_beats', 'insufficient_clean_hold_capacity'].includes(fallback.reason_code)) {
    throw new Error(`${shot.shot_id} rich density fallback is incomplete`);
  }
  requireNonEmptyString(fallback.rationale, `${shot.shot_id}.density_fallback.rationale`);
};

const validateAssetPlan = (shot, {contractVersion, densityMode}) => {
  const plan = shot.asset_plan;
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new Error(`${shot.shot_id} asset_plan is required`);
  }
  const mainImages = requireInteger(plan.main_image_count, `${shot.shot_id}.asset_plan.main_image_count`);
  const layers = requireInteger(plan.layer_count, `${shot.shot_id}.asset_plan.layer_count`);
  const poses = requireInteger(plan.pose_count, `${shot.shot_id}.asset_plan.pose_count`);
  if (shot.motion_tier === 'layered') {
    if (mainImages !== 1 || layers < 3 || layers > 10 || poses !== 0) {
      throw new Error(`${shot.shot_id} layered requires one master image, 3–10 layers, and no pose family`);
    }
  } else if (shot.motion_tier === 'stateful') {
    const maximum = contractVersion === STORYBOARD_VISUAL_RHYTHM_V2_VERSION && densityMode === 'rich' ? 6 : 4;
    if (mainImages < 2 || mainImages > maximum || layers !== 0 || poses !== 0) {
      throw new Error(`${shot.shot_id} stateful requires 2–${maximum} complete scene images`);
    }
    if (densityMode !== 'rich' && mainImages === 4) {
      requireNonEmptyString(shot.state_count_rationale, `${shot.shot_id}.state_count_rationale`);
    }
  } else if (shot.motion_tier === 'hero_pose') {
    const maximum = contractVersion === STORYBOARD_VISUAL_RHYTHM_V2_VERSION && densityMode === 'rich' ? 13 : 6;
    if (mainImages !== 1 || layers !== 0 || poses < 4 || poses > maximum) {
      throw new Error(`${shot.shot_id} hero_pose requires one background and 4–${maximum} pose assets`);
    }
    if (densityMode !== 'rich' && poses === 6) {
      if (shot.split_assessment?.natural_semantic_pause_available !== false) {
        throw new Error(`${shot.shot_id} sixth hero pose requires a no-split assessment`);
      }
      requireNonEmptyString(
        shot.split_assessment.rationale,
        `${shot.shot_id}.split_assessment.rationale`,
      );
    }
    if (densityMode === 'rich' && poses + 1 >= 13) {
      if (shot.split_assessment?.natural_semantic_pause_available !== false) {
        throw new Error(`${shot.shot_id} rich hero total 13–14 requires a no-split assessment`);
      }
      requireNonEmptyString(shot.split_assessment.rationale, `${shot.shot_id}.split_assessment.rationale`);
      requireNonEmptyString(shot.quantity_rationale, `${shot.shot_id}.quantity_rationale`);
    }
  }
  requireStringArray(plan.reuse_plan, `${shot.shot_id}.asset_plan.reuse_plan`);
  validateDensityFallback(shot, {densityMode});
};

const validatePerformancePlan = (shot) => {
  const plan = shot.performance_plan;
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new Error(`${shot.shot_id} performance_plan is required`);
  }
  const required = [
    'character_goal',
    'emotion',
    'anticipation',
    'main_action',
    'contact_and_weight',
    'impact',
    'recoil',
    'follow_through',
    'settled_pose',
  ];
  required.forEach((field) => requireNonEmptyString(
    plan[field],
    `${shot.shot_id}.performance_plan.${field}`,
  ));
  requireStringArray(plan.allowed_environment_responses, `${shot.shot_id}.performance_plan.allowed_environment_responses`);
  if (!['locked', 'simple', 'moderate'].includes(plan.camera_motion_complexity)) {
    throw new Error(`${shot.shot_id}.performance_plan.camera_motion_complexity is unsupported`);
  }
};

const validateContinuity = (shot) => {
  const continuity = shot.continuity;
  if (!continuity || typeof continuity !== 'object' || Array.isArray(continuity)) {
    throw new Error(`${shot.shot_id} continuity ledger is required`);
  }
  for (const field of ['identity', 'action', 'prop', 'space', 'lighting', 'eyeline']) {
    if (!['low', 'medium', 'high'].includes(continuity[field])) {
      throw new Error(`${shot.shot_id}.continuity.${field} must be low, medium, or high`);
    }
  }
  if (Object.values(continuity).includes('high')) {
    for (const field of ['exit_state', 'entry_state', 'edit_motivation']) {
      requireNonEmptyString(continuity[field], `${shot.shot_id}.continuity.${field}`);
    }
    requireStringArray(continuity.invariants, `${shot.shot_id}.continuity.invariants`);
    requireStringArray(continuity.allowed_changes, `${shot.shot_id}.continuity.allowed_changes`);
  }
};

const validateShot = (shot, index, artifact) => {
  requireNonEmptyString(shot?.shot_id, `shots[${index}].shot_id`);
  const startFrame = requireInteger(shot.start_frame, `${shot.shot_id}.start_frame`);
  const endFrame = requireInteger(shot.end_frame, `${shot.shot_id}.end_frame`, 1);
  if (endFrame <= startFrame) throw new Error(`${shot.shot_id} must have positive duration`);
  if (!MOTION_TIERS.includes(shot.motion_tier)) {
    throw new Error(`${shot.shot_id} motion_tier is unsupported`);
  }
  if (!ATTENTION_FUNCTIONS.has(shot.attention_function)) {
    throw new Error(`${shot.shot_id} attention_function is unsupported`);
  }
  for (const field of ['visual_question', 'visual_payoff', 'visual_structure_id']) {
    requireNonEmptyString(shot[field], `${shot.shot_id}.${field}`);
  }
  if (!Array.isArray(shot.meaningful_change_events) || shot.meaningful_change_events.length === 0) {
    throw new Error(`${shot.shot_id} meaningful_change_events are required`);
  }
  let previous = -1;
  shot.meaningful_change_events.forEach((event, eventIndex) => {
    const atFrame = requireInteger(event?.at_frame, `${shot.shot_id}.meaningful_change_events[${eventIndex}].at_frame`);
    if (atFrame < startFrame || atFrame >= endFrame || atFrame <= previous) {
      throw new Error(`${shot.shot_id} meaningful change events must be ordered inside the shot`);
    }
    if (event.kind === 'transition') {
      throw new Error(`${shot.shot_id} transitions are not meaningful visual changes`);
    }
    if (!['attention-shift', 'information-reveal', 'causal-action', 'composition-change'].includes(event.kind)) {
      throw new Error(`${shot.shot_id} meaningful change event kind is unsupported`);
    }
    requireNonEmptyString(event.description, `${shot.shot_id}.meaningful_change_events[${eventIndex}].description`);
    previous = atFrame;
  });
  validateAssetPlan(shot, {
    contractVersion: artifact.contract_version,
    densityMode: artifact.density_mode ?? 'standard',
  });
  const expectedTransitions = shot.motion_tier === 'layered'
    ? 0
    : (shot.motion_tier === 'stateful'
        ? shot.asset_plan.main_image_count - 1
        : shot.asset_plan.pose_count - 1);
  if (!Array.isArray(shot.intra_shot_transition_plan)
    || shot.intra_shot_transition_plan.length !== expectedTransitions) {
    throw new Error(`${shot.shot_id} intra-shot transition plan must contain exactly N - 1 entries`);
  }
  shot.intra_shot_transition_plan.forEach((transition, transitionIndex) => {
    requireNonEmptyString(
      transition?.from_asset_id,
      `${shot.shot_id}.intra_shot_transition_plan[${transitionIndex}].from_asset_id`,
    );
    requireNonEmptyString(
      transition?.to_asset_id,
      `${shot.shot_id}.intra_shot_transition_plan[${transitionIndex}].to_asset_id`,
    );
    if (!['cut', 'watercolor-bloom'].includes(transition.kind)) {
      throw new Error(`${shot.shot_id} intra-shot transition plan kind is unsupported`);
    }
  });
  validatePerformancePlan(shot);
  validateContinuity(shot);
};

export const analyzeStoryboardVisualRhythm = (artifact) => {
  const warnings = [];
  const shots = artifact.shots;
  const events = shots.flatMap((shot) => shot.meaningful_change_events.map((event) => ({
    ...event,
    shot_id: shot.shot_id,
  }))).sort((left, right) => left.at_frame - right.at_frame);
  let previousFrame = 0;
  for (const event of events) {
    if (event.at_frame - previousFrame > MEANINGFUL_CHANGE_MAX_GAP_FRAMES) {
      warnings.push({code: 'meaningful-change-gap-over-4s', from_frame: previousFrame, to_frame: event.at_frame});
    }
    previousFrame = event.at_frame;
  }
  const finalFrame = shots.at(-1).end_frame;
  if (finalFrame - previousFrame > MEANINGFUL_CHANGE_MAX_GAP_FRAMES) {
    warnings.push({code: 'meaningful-change-gap-over-4s', from_frame: previousFrame, to_frame: finalFrame});
  }
  shots.forEach((shot, index) => {
    if (index > 1
      && shots[index - 1].visual_structure_id === shot.visual_structure_id
      && shots[index - 2].visual_structure_id === shot.visual_structure_id) {
      warnings.push({code: 'visual-structure-repeated-more-than-twice', shot_id: shot.shot_id});
    }
  });
  let lastStructureChange = shots[0].start_frame;
  shots.slice(1).forEach((shot, index) => {
    if (shot.visual_structure_id !== shots[index].visual_structure_id) {
      if (shot.start_frame - lastStructureChange > STRUCTURE_CHANGE_MAX_GAP_FRAMES) {
        warnings.push({code: 'structure-change-gap-over-18s', at_frame: shot.start_frame});
      }
      lastStructureChange = shot.start_frame;
    }
  });
  if (finalFrame - lastStructureChange > STRUCTURE_CHANGE_MAX_GAP_FRAMES) {
    warnings.push({code: 'structure-change-gap-over-18s', at_frame: finalFrame});
  }
  const firstWindowShots = shots.filter((shot) => shot.start_frame < FIRST_WINDOW_FRAMES);
  const firstWindowStructures = new Set(firstWindowShots.map((shot) => shot.visual_structure_id));
  const firstWindowFunctions = new Set(firstWindowShots.map((shot) => shot.attention_function));
  if (firstWindowStructures.size < 3
    || ![...firstWindowFunctions].some((value) => ['hook', 'contrast', 'risk', 'reveal'].includes(value))) {
    warnings.push({code: 'first-30s-variety-or-dramatic-function-insufficient'});
  }
  const heroCount = shots.filter((shot) => shot.motion_tier === 'hero_pose').length;
  const heroRatio = heroCount / shots.length;
  if (heroRatio < 0.1 || heroRatio > 0.25) {
    warnings.push({code: 'hero-pose-ratio-outside-10-25-percent', ratio: heroRatio});
  }
  return {
    contract_version: artifact.contract_version,
    profile: MEDIUM_HIGH_VISUAL_RHYTHM_PROFILE,
    status: warnings.length === 0 ? 'pass' : 'pass-with-warnings',
    warnings,
  };
};

export const validateStoryboardVisualRhythm = (artifact, {shotIds = null} = {}) => {
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)
    || ![STORYBOARD_VISUAL_RHYTHM_VERSION, STORYBOARD_VISUAL_RHYTHM_V2_VERSION].includes(artifact.contract_version)
    || artifact.profile !== MEDIUM_HIGH_VISUAL_RHYTHM_PROFILE) {
    throw new Error('storyboard visual rhythm authority mismatch');
  }
  if (artifact.contract_version === STORYBOARD_VISUAL_RHYTHM_V2_VERSION) {
    if (!['standard', 'rich'].includes(artifact.density_mode)) {
      throw new Error('storyboard-visual-rhythm-v2 density_mode must be standard or rich');
    }
    requireSha256(artifact.visual_density_selection_sha256, 'visual_density_selection_sha256');
  } else if (artifact.density_mode !== undefined || artifact.visual_density_selection_sha256 !== undefined) {
    throw new Error('legacy storyboard-visual-rhythm-v1 cannot be rewritten with density fields');
  }
  for (const authority of ['storyboard', 'visual_direction_review']) {
    requireNonEmptyString(artifact[authority]?.path, `${authority}.path`);
    requireSha256(artifact[authority]?.checksum_sha256, `${authority}.checksum_sha256`);
  }
  if (!Array.isArray(artifact.shots) || artifact.shots.length === 0) {
    throw new Error('storyboard visual rhythm shots are required');
  }
  artifact.shots.forEach((shot, index) => validateShot(shot, index, artifact));
  const ids = artifact.shots.map(({shot_id: shotId}) => shotId);
  if (new Set(ids).size !== ids.length) throw new Error('storyboard visual rhythm shot IDs must be unique');
  if (shotIds !== null && JSON.stringify(ids) !== JSON.stringify(shotIds)) {
    throw new Error('storyboard visual rhythm shot set does not match the active storyboard');
  }
  const mapHash = buildStoryboardVisualRhythmMapSha256(artifact);
  const policyAuthorized = artifact.status === 'policy_authorized';
  const validateMapSelection = (selection, label) => {
    if (selection?.presented_map_sha256 !== mapHash) {
      throw new Error(`${label} requires explicit map-bound approval; map binding is stale`);
    }
    if (policyAuthorized) {
      if (selection.status !== 'policy_authorized'
        || !SHA256.test(selection.policy_sha256 ?? '')
        || selection.user_has_reviewed_specific_map !== false
        || selection.deterministic_recommendation_selected !== true) {
        throw new Error(`${label} policy authorization is invalid or fabricates review`);
      }
      return;
    }
    if (selection?.status !== 'approved'
      || typeof selection.exact_message !== 'string' || selection.exact_message.trim() === ''
      || typeof selection.decided_at !== 'string' || Number.isNaN(Date.parse(selection.decided_at))) {
      throw new Error(`${label} requires explicit approval`);
    }
  };
  artifact.shots.flatMap((shot) => shot.intra_shot_transition_plan).filter((transition) => (
    transition.kind === 'watercolor-bloom'
  )).forEach((transition) => {
    validateMapSelection(transition.user_selection, 'storyboard watercolor-bloom');
  });
  artifact.shots.filter((shot) => (
    shot.motion_tier === 'hero_pose'
    && shot.asset_plan.pose_count === 6
    && (artifact.contract_version === STORYBOARD_VISUAL_RHYTHM_VERSION
      || artifact.density_mode === 'standard')
  )).forEach((shot) => {
    const approval = shot.extended_family_approval;
    validateMapSelection(approval, `${shot.shot_id} sixth hero pose exact map-bound approved evidence`);
    if (typeof approval.state_plan_sha256 !== 'string'
      || !SHA256.test(approval.state_plan_sha256)) {
      throw new Error(`${shot.shot_id} sixth hero pose requires exact map-bound approved evidence`);
    }
  });
  if (artifact.presented_map_sha256 !== mapHash) {
    throw new Error('storyboard visual rhythm approval is missing or stale');
  }
  validateMapSelection(
    policyAuthorized ? artifact.policy_authorization : artifact.approval,
    'storyboard visual rhythm',
  );
  return {
    result: 'pass',
    contract_version: artifact.contract_version,
    shot_count: artifact.shots.length,
    rhythm_qa: analyzeStoryboardVisualRhythm(artifact),
  };
};
