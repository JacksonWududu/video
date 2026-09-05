import crypto from 'node:crypto';

export const ONE_TIME_USER_GATE_OVERRIDE_VERSION =
  'one-time-explicit-user-mechanical-gate-override-v1';

const SHA256 = /^[a-f0-9]{64}$/;

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

const projection = (value) => ({
  contract_version: value.contract_version,
  episode_id: value.episode_id,
  scope_id: value.scope_id,
  gate_ids: value.gate_ids,
  acknowledged_failures: value.acknowledged_failures,
  bound_artifacts: value.bound_artifacts,
  decision: value.decision,
  consumption: value.consumption,
  reuse_forbidden: value.reuse_forbidden,
});

export const buildOneTimeUserGateOverrideSha256 = (value) => digest(projection(value));

const requireText = (value, label) => {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} is required`);
};

const requireSha256 = (value, label) => {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new Error(`${label} must be a lowercase SHA-256`);
};

const sameJson = (left, right) => JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));

export const validateOneTimeUserGateOverride = (value, {
  episodeId,
  requiredScopeId = null,
  requiredGateIds,
  requiredArtifacts,
  fromPhase,
  toPhase,
  requiredStatus = 'consumed',
}) => {
  if (value?.contract_version !== ONE_TIME_USER_GATE_OVERRIDE_VERSION) {
    throw new Error('one-time user gate override authority mismatch');
  }
  requireText(episodeId, 'expected episode id');
  requireText(value.episode_id, 'override episode id');
  requireText(value.scope_id, 'override scope id');
  if (value.episode_id !== episodeId) throw new Error('one-time user gate override episode mismatch');
  if (requiredScopeId !== null) {
    requireText(requiredScopeId, 'expected override scope id');
    if (value.scope_id !== requiredScopeId) {
      throw new Error('one-time user gate override scope id mismatch');
    }
  }

  if (!Array.isArray(value.gate_ids) || value.gate_ids.length === 0
    || new Set(value.gate_ids).size !== value.gate_ids.length
    || value.gate_ids.some((gateId) => typeof gateId !== 'string' || gateId.trim() === '')
    || !sameJson([...value.gate_ids].sort(), [...requiredGateIds].sort())) {
    throw new Error('one-time user gate override scope mismatch');
  }

  if (!Array.isArray(value.acknowledged_failures)
    || value.acknowledged_failures.length !== value.gate_ids.length
    || !sameJson(
      value.acknowledged_failures.map((row) => row?.gate_id).sort(),
      [...value.gate_ids].sort(),
    )) {
    throw new Error('one-time user gate override failure evidence mismatch');
  }
  for (const failure of value.acknowledged_failures) {
    requireText(failure?.observed_result, 'override observed result');
    requireText(failure?.reason, 'override failure reason');
    if (failure.observed_result === 'pass') {
      throw new Error('one-time user gate override may not rewrite a failure as pass');
    }
  }

  if (!Array.isArray(value.bound_artifacts)
    || value.bound_artifacts.length === 0
    || !sameJson(value.bound_artifacts, requiredArtifacts)) {
    throw new Error('one-time user gate override artifact binding mismatch');
  }
  for (const artifact of value.bound_artifacts) {
    requireText(artifact?.path, 'override artifact path');
    requireSha256(artifact?.checksum_sha256, 'override artifact checksum');
  }

  requireText(value.decision?.exact_user_message, 'override exact user message');
  if (value.decision?.disposition !== 'allow_once'
    || typeof value.decision?.decided_at !== 'string'
    || Number.isNaN(Date.parse(value.decision.decided_at))) {
    throw new Error('one-time user gate override decision is invalid');
  }
  let latestDecisionAt = Date.parse(value.decision.decided_at);
  if (Object.hasOwn(value.decision, 'supplemental_exact_user_messages')) {
    const supplemental = value.decision.supplemental_exact_user_messages;
    if (!Array.isArray(supplemental) || supplemental.length === 0) {
      throw new Error('one-time user gate override supplemental exact user messages must be a non-empty array');
    }
    const supplementalGateIds = new Set();
    for (const [index, row] of supplemental.entries()) {
      requireText(row?.exact_user_message, `override supplemental exact user message ${index + 1}`);
      const decidedAt = typeof row?.decided_at === 'string' ? Date.parse(row.decided_at) : Number.NaN;
      if (row?.disposition !== 'allow_once'
        || typeof row?.decided_at !== 'string'
        || Number.isNaN(decidedAt)) {
        throw new Error('one-time user gate override supplemental exact user message decision is invalid');
      }
      if (decidedAt < latestDecisionAt) {
        throw new Error('one-time user gate override supplemental exact user message decisions must be ordered');
      }
      if (!Array.isArray(row.gate_ids) || row.gate_ids.length === 0
        || new Set(row.gate_ids).size !== row.gate_ids.length
        || row.gate_ids.some((gateId) => typeof gateId !== 'string' || gateId.trim() === '')) {
        throw new Error('one-time user gate override supplemental gate ids are invalid');
      }
      for (const gateId of row.gate_ids) {
        if (!value.gate_ids.includes(gateId)) {
          throw new Error('one-time user gate override supplemental gate id is outside the override scope');
        }
        if (supplementalGateIds.has(gateId)) {
          throw new Error('one-time user gate override supplemental gate id is duplicated');
        }
        supplementalGateIds.add(gateId);
      }
      latestDecisionAt = decidedAt;
    }
  }
  if (value.reuse_forbidden !== true) throw new Error('one-time user gate override must forbid reuse');

  if (value.consumption?.from_phase !== fromPhase
    || value.consumption?.to_phase !== toPhase
    || value.consumption?.status !== requiredStatus) {
    throw new Error('one-time user gate override transition or status mismatch');
  }
  if (requiredStatus === 'consumed') {
    requireText(value.consumption?.consumed_transition_id, 'override consumed transition id');
    if (typeof value.consumption?.consumed_at !== 'string'
      || Number.isNaN(Date.parse(value.consumption.consumed_at))) {
      throw new Error('one-time user gate override consumption time is invalid');
    }
    if (Date.parse(value.consumption.consumed_at) < latestDecisionAt) {
      throw new Error('one-time user gate override cannot be consumed before its decision');
    }
  } else if (requiredStatus === 'available'
    && (value.consumption?.consumed_transition_id !== undefined
      || value.consumption?.consumed_at !== undefined)) {
    throw new Error('available override may not contain consumption evidence');
  }

  const expected = buildOneTimeUserGateOverrideSha256(value);
  if (value.override_sha256 !== expected) throw new Error('one-time user gate override checksum is stale');
  return {result: 'pass_with_user_override', override_sha256: expected};
};

export const consumeOneTimeUserGateOverride = (value, {
  episodeId,
  requiredScopeId = null,
  requiredGateIds,
  requiredArtifacts,
  fromPhase,
  toPhase,
  consumedTransitionId,
  consumedAt,
}) => {
  validateOneTimeUserGateOverride(value, {
    episodeId,
    requiredScopeId,
    requiredGateIds,
    requiredArtifacts,
    fromPhase,
    toPhase,
    requiredStatus: 'available',
  });
  requireText(consumedTransitionId, 'override consumed transition id');
  if (typeof consumedAt !== 'string' || Number.isNaN(Date.parse(consumedAt))) {
    throw new Error('one-time user gate override consumption time is invalid');
  }
  const consumed = structuredClone(value);
  consumed.consumption = {
    ...consumed.consumption,
    status: 'consumed',
    consumed_transition_id: consumedTransitionId,
    consumed_at: consumedAt,
  };
  consumed.override_sha256 = buildOneTimeUserGateOverrideSha256(consumed);
  validateOneTimeUserGateOverride(consumed, {
    episodeId,
    requiredScopeId,
    requiredGateIds,
    requiredArtifacts,
    fromPhase,
    toPhase,
    requiredStatus: 'consumed',
  });
  return consumed;
};
