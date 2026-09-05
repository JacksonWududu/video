import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildOneTimeUserGateOverrideSha256,
  consumeOneTimeUserGateOverride,
  validateOneTimeUserGateOverride,
} from './contract.mjs';

const sha = (character) => character.repeat(64);
const bindings = {
  episodeId: 'episode-test',
  requiredGateIds: ['cover.geometry'],
  requiredArtifacts: [{path: 'episode-test/cover.png', checksum_sha256: sha('a')}],
  fromPhase: 'cover',
  toPhase: 'style',
};

const supplementalGateIds = [
  'cover.geometry.prompt-marker',
  'cover.geometry.hero-pose-marker',
];
const supplementalBindings = {
  ...bindings,
  requiredGateIds: [...bindings.requiredGateIds, ...supplementalGateIds],
};

const buildOverride = () => {
  const value = {
    contract_version: 'one-time-explicit-user-mechanical-gate-override-v1',
    episode_id: 'episode-test',
    scope_id: 'episode-test:cover:geometry:v1',
    gate_ids: ['cover.geometry'],
    acknowledged_failures: [{
      gate_id: 'cover.geometry',
      observed_result: 'fail',
      reason: 'center outside tolerance',
    }],
    bound_artifacts: bindings.requiredArtifacts,
    decision: {
      exact_user_message: '放行当前封面几何门禁',
      decided_at: '2026-08-29T15:00:00+08:00',
      disposition: 'allow_once',
    },
    consumption: {
      from_phase: 'cover',
      to_phase: 'style',
      status: 'consumed',
      consumed_transition_id: 'episode-test:cover-to-style:1',
      consumed_at: '2026-08-29T15:00:01+08:00',
    },
    reuse_forbidden: true,
  };
  value.override_sha256 = buildOneTimeUserGateOverrideSha256(value);
  return value;
};

const buildSupplementalOverride = () => {
  const value = buildOverride();
  value.gate_ids.push(...supplementalGateIds);
  value.acknowledged_failures.push(
    {
      gate_id: supplementalGateIds[0],
      observed_result: 'fail',
      reason: 'prompt marker is absent',
    },
    {
      gate_id: supplementalGateIds[1],
      observed_result: 'fail',
      reason: 'hero pose marker is incomplete',
    },
  );
  value.decision.supplemental_exact_user_messages = [
    {
      exact_user_message: '追加放行提示词固定标记门禁',
      decided_at: '2026-08-29T15:00:00+08:00',
      disposition: 'allow_once',
      gate_ids: [supplementalGateIds[0]],
    },
    {
      exact_user_message: '追加放行 HERO-POSE 固定标记门禁',
      decided_at: '2026-08-29T15:00:01+08:00',
      disposition: 'allow_once',
      gate_ids: [supplementalGateIds[1]],
    },
  ];
  value.override_sha256 = buildOneTimeUserGateOverrideSha256(value);
  return value;
};

test('accepts one exact consumed transition', () => {
  assert.equal(validateOneTimeUserGateOverride(buildOverride(), bindings).result, 'pass_with_user_override');
});

test('accepts one exact three-gate attempt/P0/P2 override without contract changes', () => {
  const value = buildOverride();
  const gateIds = [
    'storyboard-image-generation-attempt-limit:S01:action-05',
    'visual_asset.S01-action-05-v01.P0_FORWARD_REVERSE_MISMATCH',
    'visual_asset.S01-action-05-v01.P2_SATCHEL_TOPOLOGY',
  ];
  value.scope_id = 'S01:action-05';
  value.gate_ids = gateIds;
  value.acknowledged_failures = [
    {
      gate_id: gateIds[0],
      observed_result: 'stopped_user_takeover_required',
      reason: 'three distinct generated outputs were rejected',
    },
    {
      gate_id: gateIds[1],
      observed_result: 'fail',
      reason: 'P0_FORWARD_REVERSE_MISMATCH: front and rear are reversed',
    },
    {
      gate_id: gateIds[2],
      observed_result: 'fail',
      reason: 'rear strap does not reach the opposite bag-end ring',
    },
  ];
  value.decision.exact_user_message = (
    '接受 S01-action-05-v01 第三次失败图，并仅此一次放行三次尝试限制、'
    + 'P0 前后朝向门禁与 P2 背带拓扑门禁'
  );
  value.override_sha256 = buildOneTimeUserGateOverrideSha256(value);
  assert.equal(
    validateOneTimeUserGateOverride(value, {
      ...bindings,
      requiredScopeId: 'S01:action-05',
      requiredGateIds: gateIds,
    }).result,
    'pass_with_user_override',
  );
});

test('keeps legacy records checksum-compatible when supplemental decisions are absent', () => {
  const value = buildOverride();
  assert.equal(
    value.override_sha256,
    'a3e5ddfe75ce151dcaab04075d75dd0bf7701e4372c6445827220371a266c6da',
  );
  assert.equal(validateOneTimeUserGateOverride(value, bindings).result, 'pass_with_user_override');
});

test('accepts ordered supplemental exact user messages with globally unique gates', () => {
  const value = buildSupplementalOverride();
  assert.equal(
    validateOneTimeUserGateOverride(value, supplementalBindings).result,
    'pass_with_user_override',
  );
});

test('rejects an empty or non-array supplemental exact user message field', () => {
  for (const invalid of [[], {}, null]) {
    const value = buildSupplementalOverride();
    value.decision.supplemental_exact_user_messages = invalid;
    value.override_sha256 = buildOneTimeUserGateOverrideSha256(value);
    assert.throws(
      () => validateOneTimeUserGateOverride(value, supplementalBindings),
      /supplemental exact user messages must be a non-empty array/,
    );
  }
});

test('rejects malformed, unordered, or duplicate supplemental decisions', () => {
  const invalidMutations = [
    (rows) => { rows[0].exact_user_message = '   '; },
    (rows) => { rows[0].decided_at = 'not-a-date'; },
    (rows) => { rows[0].decided_at = '2026-08-29T14:59:59+08:00'; },
    (rows) => { rows[1].decided_at = '2026-08-29T14:59:59+08:00'; },
    (rows) => { rows[0].disposition = 'allow_many'; },
    (rows) => { rows[0].gate_ids = []; },
    (rows) => { rows[0].gate_ids = ['duplicate', 'duplicate']; },
    (rows) => { rows[0].gate_ids = ['']; },
    (rows) => { rows[0].gate_ids = [42]; },
    (rows) => { rows[0].gate_ids = ['outside.top-level.scope']; },
    (rows) => { rows[1].gate_ids = [rows[0].gate_ids[0]]; },
  ];

  for (const mutate of invalidMutations) {
    const value = buildSupplementalOverride();
    mutate(value.decision.supplemental_exact_user_messages);
    value.override_sha256 = buildOneTimeUserGateOverrideSha256(value);
    assert.throws(
      () => validateOneTimeUserGateOverride(value, supplementalBindings),
      /supplemental exact user message|supplemental gate ids|supplemental gate id/,
    );
  }
});

test('rejects consumption before the final supplemental decision', () => {
  const value = buildSupplementalOverride();
  value.decision.supplemental_exact_user_messages[1].decided_at = '2026-08-29T15:00:02+08:00';
  value.override_sha256 = buildOneTimeUserGateOverrideSha256(value);
  assert.throws(
    () => validateOneTimeUserGateOverride(value, supplementalBindings),
    /cannot be consumed before its decision/,
  );

  value.consumption = {
    from_phase: 'cover',
    to_phase: 'style',
    status: 'available',
  };
  value.override_sha256 = buildOneTimeUserGateOverrideSha256(value);
  assert.throws(
    () => consumeOneTimeUserGateOverride(value, {
      ...supplementalBindings,
      requiredScopeId: 'episode-test:cover:geometry:v1',
      consumedTransitionId: 'episode-test:cover-to-style:supplemental',
      consumedAt: '2026-08-29T15:00:01+08:00',
    }),
    /cannot be consumed before its decision/,
  );
});

test('rejects reuse for another transition or changed bytes', () => {
  const value = buildOverride();
  assert.throws(
    () => validateOneTimeUserGateOverride(value, {...bindings, toPhase: 'storyboard'}),
    /transition or status mismatch/,
  );
  assert.throws(
    () => validateOneTimeUserGateOverride(value, {
      ...bindings,
      requiredArtifacts: [{path: 'episode-test/cover.png', checksum_sha256: sha('b')}],
    }),
    /artifact binding mismatch/,
  );
});

test('rejects an unconsumed or broadened override', () => {
  const value = buildOverride();
  value.consumption.status = 'available';
  value.override_sha256 = buildOneTimeUserGateOverrideSha256(value);
  assert.throws(() => validateOneTimeUserGateOverride(value, bindings), /transition or status mismatch/);

  const broadened = buildOverride();
  broadened.gate_ids.push('storyboard.review');
  broadened.override_sha256 = buildOneTimeUserGateOverrideSha256(broadened);
  assert.throws(() => validateOneTimeUserGateOverride(broadened, bindings), /scope mismatch/);
});

test('consumes one available override without mutating the source record', () => {
  const available = buildOverride();
  available.consumption = {
    from_phase: 'cover',
    to_phase: 'style',
    status: 'available',
  };
  available.override_sha256 = buildOneTimeUserGateOverrideSha256(available);
  const sourceBytes = JSON.stringify(available);

  const consumed = consumeOneTimeUserGateOverride(available, {
    ...bindings,
    requiredScopeId: 'episode-test:cover:geometry:v1',
    consumedTransitionId: 'episode-test:cover-to-style:2',
    consumedAt: '2026-08-29T15:01:00+08:00',
  });

  assert.equal(JSON.stringify(available), sourceBytes);
  assert.equal(consumed.consumption.status, 'consumed');
  assert.equal(consumed.consumption.consumed_transition_id, 'episode-test:cover-to-style:2');
  assert.equal(
    validateOneTimeUserGateOverride(consumed, {
      ...bindings,
      requiredScopeId: 'episode-test:cover:geometry:v1',
    }).result,
    'pass_with_user_override',
  );
});

test('refuses to consume a wrong-scope, already-consumed, or prefilled available override', () => {
  const available = buildOverride();
  available.consumption = {
    from_phase: 'cover',
    to_phase: 'style',
    status: 'available',
  };
  available.override_sha256 = buildOneTimeUserGateOverrideSha256(available);
  const consume = (value) => consumeOneTimeUserGateOverride(value, {
    ...bindings,
    requiredScopeId: 'episode-test:cover:geometry:v1',
    consumedTransitionId: 'episode-test:cover-to-style:2',
    consumedAt: '2026-08-29T15:01:00+08:00',
  });

  const wrongScope = structuredClone(available);
  wrongScope.scope_id = 'episode-test:other';
  wrongScope.override_sha256 = buildOneTimeUserGateOverrideSha256(wrongScope);
  assert.throws(() => consume(wrongScope), /scope id mismatch/);
  assert.throws(() => consume(buildOverride()), /transition or status mismatch/);

  const prefilled = structuredClone(available);
  prefilled.consumption.consumed_transition_id = 'already-present';
  prefilled.override_sha256 = buildOneTimeUserGateOverrideSha256(prefilled);
  assert.throws(() => consume(prefilled), /available override may not contain consumption evidence/);
});
