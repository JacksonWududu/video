import crypto from 'node:crypto';

export const STORYBOARD_VISUAL_RHYTHM_VERSION = 'storyboard-visual-rhythm-v1';
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
  state_count_rationale: shot.state_count_rationale ?? null,
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
    contract_version: STORYBOARD_VISUAL_RHYTHM_VERSION,
    profile: artifact.profile,
    storyboard: artifact.storyboard,
    visual_direction_review: artifact.visual_direction_review,
    shots: canonicalRows(artifact),
  }))
  .digest('hex');

const validateAssetPlan = (shot) => {
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
    if (mainImages < 2 || mainImages > 4 || layers !== 0 || poses !== 0) {
      throw new Error(`${shot.shot_id} stateful requires 2–4 complete scene images`);
    }
    if (mainImages === 4) {
      requireNonEmptyString(shot.state_count_rationale, `${shot.shot_id}.state_count_rationale`);
    }
  } else if (shot.motion_tier === 'hero_pose') {
    if (mainImages !== 1 || layers !== 0 || poses < 4 || poses > 6) {
      throw new Error(`${shot.shot_id} hero_pose requires one background and 4–6 pose assets`);
    }
    if (poses === 6) {
      if (shot.split_assessment?.natural_semantic_pause_available !== false) {
        throw new Error(`${shot.shot_id} sixth hero pose requires a no-split assessment`);
      }
      requireNonEmptyString(
        shot.split_assessment.rationale,
        `${shot.shot_id}.split_assessment.rationale`,
      );
    }
  }
  requireStringArray(plan.reuse_plan, `${shot.shot_id}.asset_plan.reuse_plan`);
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

const validateShot = (shot, index) => {
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
  validateAssetPlan(shot);
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
    contract_version: STORYBOARD_VISUAL_RHYTHM_VERSION,
    profile: MEDIUM_HIGH_VISUAL_RHYTHM_PROFILE,
    status: warnings.length === 0 ? 'pass' : 'pass-with-warnings',
    warnings,
  };
};

export const validateStoryboardVisualRhythm = (artifact, {shotIds = null} = {}) => {
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)
    || artifact.contract_version !== STORYBOARD_VISUAL_RHYTHM_VERSION
    || artifact.profile !== MEDIUM_HIGH_VISUAL_RHYTHM_PROFILE) {
    throw new Error('storyboard-visual-rhythm-v1 authority mismatch');
  }
  for (const authority of ['storyboard', 'visual_direction_review']) {
    requireNonEmptyString(artifact[authority]?.path, `${authority}.path`);
    requireSha256(artifact[authority]?.checksum_sha256, `${authority}.checksum_sha256`);
  }
  if (!Array.isArray(artifact.shots) || artifact.shots.length === 0) {
    throw new Error('storyboard visual rhythm shots are required');
  }
  artifact.shots.forEach(validateShot);
  const ids = artifact.shots.map(({shot_id: shotId}) => shotId);
  if (new Set(ids).size !== ids.length) throw new Error('storyboard visual rhythm shot IDs must be unique');
  if (shotIds !== null && JSON.stringify(ids) !== JSON.stringify(shotIds)) {
    throw new Error('storyboard visual rhythm shot set does not match the active storyboard');
  }
  const mapHash = buildStoryboardVisualRhythmMapSha256(artifact);
  artifact.shots.flatMap((shot) => shot.intra_shot_transition_plan).filter((transition) => (
    transition.kind === 'watercolor-bloom'
  )).forEach((transition) => {
    const selection = transition.user_selection;
    if (selection?.status !== 'approved'
      || typeof selection.exact_message !== 'string' || selection.exact_message.trim() === ''
      || typeof selection.decided_at !== 'string' || Number.isNaN(Date.parse(selection.decided_at))
      || selection.presented_map_sha256 !== mapHash) {
      throw new Error('storyboard watercolor-bloom requires explicit map-bound approval');
    }
  });
  artifact.shots.filter((shot) => (
    shot.motion_tier === 'hero_pose' && shot.asset_plan.pose_count === 6
  )).forEach((shot) => {
    const approval = shot.extended_family_approval;
    if (approval?.status !== 'approved'
      || typeof approval.exact_message !== 'string' || approval.exact_message.trim() === ''
      || typeof approval.decided_at !== 'string' || Number.isNaN(Date.parse(approval.decided_at))
      || approval.presented_map_sha256 !== mapHash
      || typeof approval.state_plan_sha256 !== 'string'
      || !SHA256.test(approval.state_plan_sha256)) {
      throw new Error(`${shot.shot_id} sixth hero pose requires exact map-bound approved evidence`);
    }
  });
  if (artifact.presented_map_sha256 !== mapHash
    || artifact.approval?.status !== 'approved'
    || artifact.approval?.presented_map_sha256 !== mapHash) {
    throw new Error('storyboard visual rhythm approval is missing or stale');
  }
  requireNonEmptyString(artifact.approval.exact_message, 'storyboard visual rhythm approval exact_message');
  if (typeof artifact.approval.decided_at !== 'string'
    || Number.isNaN(Date.parse(artifact.approval.decided_at))) {
    throw new Error('storyboard visual rhythm approval decided_at must be an ISO date-time');
  }
  return {
    result: 'pass',
    contract_version: STORYBOARD_VISUAL_RHYTHM_VERSION,
    shot_count: artifact.shots.length,
    rhythm_qa: analyzeStoryboardVisualRhythm(artifact),
  };
};
