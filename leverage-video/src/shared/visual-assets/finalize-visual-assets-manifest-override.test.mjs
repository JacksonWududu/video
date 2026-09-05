import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {buildOneTimeUserGateOverrideSha256} from '../user-gate-override/contract.mjs';
import {
  validateVisibleSymbolOverrideEvidence,
  validateWhiteCatP2OverrideEvidence,
} from './finalize-visual-assets-manifest.mjs';

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

const makeFixture = ({
  withPromptMarkerOverride = false,
  withForwardReverseOverride = false,
} = {}) => {
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-finalizer-override-'));
  const episodeWorkspace = 'episodes/episode-test';
  const relative = (name) => `${episodeWorkspace}/${name}`;
  const write = (name, bytes) => {
    const target = path.join(repositoryRoot, relative(name));
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, bytes);
    return {path: relative(name), checksum_sha256: sha256(bytes)};
  };
  const source = write('assets/image/review/S01-action-02-v01.png', Buffer.from('final-rgba'));
  const prompt = write(
    'assets/image/prompts/S01-action-02-attempt-03.txt',
    Buffer.from(withPromptMarkerOverride
      ? [
        'FINAL P2 CAMERA AND BAG-END LAYOUT — BLOCKING PRIORITY:',
        'HERO-POSE ASSET: full-canvas transparent RGBA after deterministic chroma conversion, with fixed registration anchors.',
        'CAT FACING MAP: torso three-quarter screen-left; anatomical front and chest map screen-left; anatomical rear and rump map screen-right.',
      ].join('\n')
      : [
        'WHITE-CAT SATCHEL STRAP LOCK:',
        'HERO-POSE ASSET: full-canvas transparent RGBA with fixed registration anchors.',
        'CAT FACING MAP: torso three-quarter screen-left; anatomical front and chest map screen-left; anatomical rear and rump map screen-right.',
      ].join('\n')),
  );
  const map = write('assets/image/review/S01-action-02-v01-limb-map.png', Buffer.from('map'));
  const outputs = [1, 2, 3].map((attempt) => write(
    `assets/image/generated/S01-action-02-rejected-attempt-0${attempt}.png`,
    Buffer.from(`failed-${attempt}`),
  ));
  const identityQa = {
    result: 'fail',
    cat_count: 1,
    foreleg_count: 2,
    hindleg_count: 2,
    paw_count: 4,
    anatomy_evidence: {
      contract_version: 'white-cat-anatomy-qa-v2',
      result: 'pass',
      source_image: source,
      inspection_evidence: {
        methods: ['full_resolution', 'numbered_limb_map'],
        numbered_limb_map_path: map.path,
        numbered_limb_map_checksum_sha256: map.checksum_sha256,
        numbered_limb_map_source_checksum_sha256: source.checksum_sha256,
        numbered_limb_map_limb_ids: ['F1', 'F2', 'H1', 'H2'],
      },
    },
    accessory_geometry_correct: false,
    front_strap_attached_to_forward_bag_end: true,
    rear_strap_attached_to_rear_bag_end: false,
    bag_end_attachment_count: 1,
    both_bag_end_anchors_visibly_traceable: false,
    source_retry_policy_compliant: false,
  };
  const combinedFailureReason = (
    'P0_FORWARD_REVERSE_MISMATCH: anatomical front is screen-right and rear is '
    + 'screen-left; the rear wide blue path also fails to reach a distinct rear '
    + 'bag-end ring.'
  );
  if (withForwardReverseOverride) {
    Object.assign(identityQa, {
      cat_facing_screen_direction: 'three-quarter-screen-right',
      anatomical_front_maps_to_screen: 'screen-right',
      anatomical_rear_maps_to_screen: 'screen-left',
      forward_reverse_mapping_qa: {
        contract_version: 'white-cat-forward-reverse-mapping-qa-v1',
        result: 'fail',
        error_code: 'P0_FORWARD_REVERSE_MISMATCH',
        expected_cat_facing_screen_direction: 'three-quarter-screen-left',
        expected_anatomical_front_maps_to_screen: 'screen-left',
        expected_anatomical_rear_maps_to_screen: 'screen-right',
        observed_cat_facing_screen_direction: 'three-quarter-screen-right',
        observed_anatomical_front_maps_to_screen: 'screen-right',
        observed_anatomical_rear_maps_to_screen: 'screen-left',
        failure_reason: combinedFailureReason,
      },
    });
  }
  const qa = {
    contract_version: 'ordinary-imagegen-white-cat-action-qa-v2',
    result: 'fail',
    asset_id: 'S01-action-02-v01',
    selected_source: source,
    selected_prompt: prompt,
    identity_qa: identityQa,
    ...(withForwardReverseOverride ? {
      waivable_mechanical_failures: [
        {
          error_code: 'P0_FORWARD_REVERSE_MISMATCH',
          observed_result: 'fail',
          reason: combinedFailureReason,
        },
        {
          error_code: 'P2_SATCHEL_TOPOLOGY',
          observed_result: 'fail',
          reason: combinedFailureReason,
        },
      ],
    } : {}),
    transparent_pose_qa: {
      result: 'pass',
      source_checksum_sha256: source.checksum_sha256,
      full_canvas_rgba: true,
      transparent_background: true,
      registration_anchor_policy: 'fixed-full-canvas-v1',
    },
  };
  const qaBytes = Buffer.from(`${JSON.stringify(qa, null, 2)}\n`);
  const qaBinding = write('schema/S01-action-02-v01-qa.json', qaBytes);
  const failures = outputs.map((output, index) => ({
    attempt_number: index + 1,
    prompt,
    output,
    failure_reason: `P2 failure ${index + 1}`,
    error_code: 'P2_SATCHEL_TOPOLOGY',
    qa_time: `2026-08-29T18:0${index + 1}:00+08:00`,
  }));
  failures[2].failure_reason = 'P2_SATCHEL_TOPOLOGY: rear bag-end anchor missing';
  if (withForwardReverseOverride) {
    failures[2].error_code = 'P0_FORWARD_REVERSE_MISMATCH';
    failures[2].failure_reason = combinedFailureReason;
  }
  const item = {
    asset_id: qa.asset_id,
    shot_id: 'S01',
    role: 'action-02',
    asset_kind: 'hero_pose',
    visual_generation_route: 'imagegen',
    white_cat_present: true,
    status: 'approved',
    generation_attempt_scope_id: 'S01:action-02',
    path: source.path,
    checksum_sha256: source.checksum_sha256,
    prompt_path: prompt.path,
    prompt_checksum_sha256: prompt.checksum_sha256,
    qa_evidence_path: qaBinding.path,
    qa_evidence_checksum_sha256: qaBinding.checksum_sha256,
    identity_qa: identityQa,
    transparent_pose_qa: {
      ...qa.transparent_pose_qa,
      measured_alpha: {
        width: 2,
        height: 1,
        min_alpha: 0,
        max_alpha: 255,
        transparent_pixel_count: 1,
        nontransparent_pixel_count: 1,
      },
    },
    image_generation_qa_failures: structuredClone(failures),
    white_cat_imagegen_qa_failures: structuredClone(failures),
    image_generation_attempt_control: {
      contract_version: 'storyboard-image-generation-attempt-limit-v1',
      generation_attempt_scope_id: 'S01:action-02',
      maximum_automatic_rejected_generations: 3,
      rejected_generation_count: 3,
      automatic_retry_status: 'stopped_user_takeover_required',
    },
    white_cat_generation_attempt_control: {
      contract_version: 'white-cat-imagegen-attempt-limit-v1',
      maximum_automatic_qa_failures: 3,
      qa_failed_generation_count: 3,
      automatic_retry_status: 'stopped_user_takeover_required',
    },
    mechanical_qa_result: 'failed_but_waived_once',
    user_mechanical_gate_override_result: 'pass_with_user_override',
  };
  const attemptGate = 'storyboard-image-generation-attempt-limit:S01:action-02';
  const p0Gate = `visual_asset.${item.asset_id}.P0_FORWARD_REVERSE_MISMATCH`;
  const p2Gate = `visual_asset.${item.asset_id}.P2_SATCHEL_TOPOLOGY`;
  const promptMarkerFailures = withPromptMarkerOverride ? [
    {
      gate_id: `visual_asset.${item.asset_id}.P2_PROMPT_FIXED_MARKER`,
      observed_result: 'fail',
      reason: 'P2_PROMPT_FIXED_MARKER: required literal is missing: WHITE-CAT SATCHEL STRAP LOCK:',
    },
    {
      gate_id: `visual_asset.${item.asset_id}.HERO_POSE_PROMPT_FIXED_MARKER`,
      observed_result: 'fail',
      reason: 'HERO_POSE_PROMPT_FIXED_MARKER: required literal is missing: HERO-POSE ASSET: full-canvas transparent RGBA with fixed registration anchors.',
    },
  ] : [];
  const gateIds = [
    attemptGate,
    ...(withForwardReverseOverride ? [p0Gate] : []),
    p2Gate,
    ...promptMarkerFailures.map((failure) => failure.gate_id),
  ];
  const artifacts = [source, prompt, qaBinding, map, outputs[2]];
  const override = {
    contract_version: 'one-time-explicit-user-mechanical-gate-override-v1',
    episode_id: 'episode-test',
    scope_id: 'S01:action-02',
    gate_ids: gateIds,
    acknowledged_failures: [
      {
        gate_id: attemptGate,
        observed_result: 'stopped_user_takeover_required',
        reason: 'three distinct generated outputs were rejected',
      },
      {
        ...(withForwardReverseOverride ? {
          gate_id: p0Gate,
          observed_result: 'fail',
          reason: failures[2].failure_reason,
        } : {
          gate_id: p2Gate,
          observed_result: 'fail',
          reason: failures[2].failure_reason,
        }),
      },
      ...(withForwardReverseOverride ? [{
        gate_id: p2Gate,
        observed_result: 'fail',
        reason: failures[2].failure_reason,
      }] : []),
      ...promptMarkerFailures,
    ],
    bound_artifacts: artifacts,
    decision: {
      exact_user_message: withForwardReverseOverride
        ? '接受 S01-action-02-v01 第三次失败图，并仅此一次放行三次尝试限制、P0 前后朝向门禁与 P2 背带拓扑门禁；保留真实提示词及失败证据。'
        : '接受 S01-action-02-v01 的 P2 背带失败并放行三次限制，仅此一次',
      decided_at: '2026-08-29T18:20:00+08:00',
      disposition: 'allow_once',
      ...(withPromptMarkerOverride ? {
        supplemental_exact_user_messages: [{
          exact_user_message: '对 S01-action-02-v01 本次转换，追加一次性放行 P2 提示词固定标记缺失与 HERO-POSE 固定标记不完全匹配门禁；保留真实提示词及失败证据。',
          decided_at: '2026-08-29T18:20:00+08:00',
          disposition: 'allow_once',
          gate_ids: promptMarkerFailures.map((failure) => failure.gate_id),
        }],
      } : {}),
    },
    consumption: {
      from_phase: 'awaiting_visual_asset_review',
      to_phase: 'visual_production',
      status: 'consumed',
      consumed_transition_id: 'episode-test:S01-action-02:p2:1',
      consumed_at: '2026-08-29T18:20:01+08:00',
    },
    reuse_forbidden: true,
  };
  override.override_sha256 = buildOneTimeUserGateOverrideSha256(override);
  Object.assign(item, {
    user_mechanical_gate_override: override,
    waived_mechanical_gate_ids: gateIds,
    override_bound_artifacts: artifacts,
    ...(withPromptMarkerOverride ? {
      prompt_contract_qa: {
        contract_version: 'white-cat-prompt-fixed-marker-qa-v1',
        result: 'failed_but_waived_once',
        prompt,
        failures: promptMarkerFailures,
      },
    } : {}),
  });
  const state = {
    episode_id: 'episode-test',
    blockers: [{
      blocker_id: attemptGate,
      contract_version: 'storyboard-image-generation-attempt-limit-v1',
      asset_id: item.asset_id,
      generation_attempt_scope_id: item.generation_attempt_scope_id,
      status: 'failed_but_waived_once',
      user_mechanical_gate_override_sha256: override.override_sha256,
    }],
    visual_asset_review: {queue: [item]},
  };
  return {repositoryRoot, episodeWorkspace, state, item, qa, promptMarkerFailures};
};

const makeVisibleSymbolFixture = () => {
  const fixture = makeFixture();
  const {repositoryRoot, item, qa, state} = fixture;
  qa.identity_qa.result = 'pass';
  item.identity_qa = structuredClone(qa.identity_qa);
  qa.visible_text_qa = {
    result: 'fail',
    no_visible_text: true,
    no_pseudotext: true,
    no_decorative_symbols: false,
  };
  item.visible_text_qa = structuredClone(qa.visible_text_qa);
  const latest = item.image_generation_qa_failures[2];
  latest.output = {path: item.path, checksum_sha256: item.checksum_sha256};
  latest.failure_reason = '可见符号失败：金币仍有花形浮雕。';
  delete item.white_cat_generation_attempt_control;
  delete item.white_cat_imagegen_qa_failures;
  qa.waivable_mechanical_failures = [{
    error_code: 'VISIBLE_SYMBOL_FREE',
    observed_result: 'fail',
    reason: latest.failure_reason,
  }];
  const qaPath = path.join(repositoryRoot, item.qa_evidence_path);
  fs.writeFileSync(qaPath, `${JSON.stringify(qa, null, 2)}\n`);
  item.qa_evidence_checksum_sha256 = sha256(fs.readFileSync(qaPath));
  const inspection = qa.identity_qa.anatomy_evidence.inspection_evidence;
  const artifacts = [
    {path: item.path, checksum_sha256: item.checksum_sha256},
    {path: item.prompt_path, checksum_sha256: item.prompt_checksum_sha256},
    {path: item.qa_evidence_path, checksum_sha256: item.qa_evidence_checksum_sha256},
    {
      path: inspection.numbered_limb_map_path,
      checksum_sha256: inspection.numbered_limb_map_checksum_sha256,
    },
  ];
  const attemptGate = 'storyboard-image-generation-attempt-limit:S01:action-02';
  const visibleGate = `visual_asset.${item.asset_id}.VISIBLE_SYMBOL_FREE`;
  const gateIds = [attemptGate, visibleGate];
  const override = {
    contract_version: 'one-time-explicit-user-mechanical-gate-override-v1',
    episode_id: 'episode-test',
    scope_id: 'S01:action-02',
    gate_ids: gateIds,
    acknowledged_failures: [
      {
        gate_id: attemptGate,
        observed_result: 'stopped_user_takeover_required',
        reason: 'three distinct generated outputs were rejected',
      },
      {
        gate_id: visibleGate,
        observed_result: 'fail',
        reason: latest.failure_reason,
      },
    ],
    bound_artifacts: artifacts,
    decision: {
      exact_user_message: '接受 S01-action-02-v01 第三次失败图，并仅此一次放行三次尝试限制及可见符号门禁；保留真实失败证据。',
      decided_at: '2026-08-29T18:20:00+08:00',
      disposition: 'allow_once',
    },
    consumption: {
      from_phase: 'awaiting_visual_asset_review',
      to_phase: 'visual_production',
      status: 'consumed',
      consumed_transition_id: 'episode-test:S01-action-02:visible-symbol:1',
      consumed_at: '2026-08-29T18:20:01+08:00',
    },
    reuse_forbidden: true,
  };
  override.override_sha256 = buildOneTimeUserGateOverrideSha256(override);
  item.user_mechanical_gate_override = override;
  item.waived_mechanical_gate_ids = gateIds;
  item.override_bound_artifacts = artifacts;
  state.blockers[0].user_mechanical_gate_override_sha256 = override.override_sha256;
  return fixture;
};

test('finalizer recognizes exact P2 waiver while preserving failed identity QA', () => {
  const fixture = makeFixture();
  try {
    const result = validateWhiteCatP2OverrideEvidence(fixture);
    assert.equal(result.result, 'pass_with_user_override');
    assert.equal(fixture.qa.result, 'fail');
    assert.equal(fixture.qa.identity_qa.result, 'fail');
    assert.equal(result.prompt_contract_qa, undefined);
  } finally {
    fs.rmSync(fixture.repositoryRoot, {recursive: true});
  }
});

test('finalizer accepts either single missing satchel end for an exact P2 waiver', () => {
  const fixture = makeFixture();
  try {
    fixture.qa.identity_qa.front_strap_attached_to_forward_bag_end = false;
    fixture.qa.identity_qa.rear_strap_attached_to_rear_bag_end = true;
    const result = validateWhiteCatP2OverrideEvidence(fixture);
    assert.equal(result.result, 'pass_with_user_override');
  } finally {
    fs.rmSync(fixture.repositoryRoot, {recursive: true});
  }
});

test('finalizer recognizes exact visible-symbol waiver while preserving failed QA', () => {
  const fixture = makeVisibleSymbolFixture();
  try {
    const result = validateVisibleSymbolOverrideEvidence(fixture);
    assert.equal(result.result, 'pass_with_user_override');
    assert.equal(fixture.qa.result, 'fail');
    assert.equal(fixture.qa.identity_qa.result, 'pass');
    assert.equal(fixture.qa.visible_text_qa.result, 'fail');
  } finally {
    fs.rmSync(fixture.repositoryRoot, {recursive: true});
  }
});

test('finalizer recognizes exact combined P0 forward/reverse and P2 waiver', () => {
  const fixture = makeFixture({withForwardReverseOverride: true});
  try {
    const result = validateWhiteCatP2OverrideEvidence(fixture);
    assert.deepEqual(result.gate_ids, [
      'storyboard-image-generation-attempt-limit:S01:action-02',
      'visual_asset.S01-action-02-v01.P0_FORWARD_REVERSE_MISMATCH',
      'visual_asset.S01-action-02-v01.P2_SATCHEL_TOPOLOGY',
    ]);
    assert.equal(
      fixture.qa.identity_qa.forward_reverse_mapping_qa.result,
      'fail',
    );
  } finally {
    fs.rmSync(fixture.repositoryRoot, {recursive: true});
  }
});

test('finalizer rejects stale combined forward/reverse evidence', () => {
  const fixture = makeFixture({withForwardReverseOverride: true});
  try {
    fixture.qa.identity_qa.forward_reverse_mapping_qa
      .observed_anatomical_front_maps_to_screen = 'screen-left';
    assert.throws(
      () => validateWhiteCatP2OverrideEvidence(fixture),
      /forward\/reverse mapping QA/,
    );
  } finally {
    fs.rmSync(fixture.repositoryRoot, {recursive: true});
  }
});

test('finalizer preserves checksum-derived prompt marker failures under one exact supplement', () => {
  const fixture = makeFixture({withPromptMarkerOverride: true});
  try {
    const result = validateWhiteCatP2OverrideEvidence(fixture);
    assert.deepEqual(result.gate_ids, fixture.item.waived_mechanical_gate_ids);
    assert.deepEqual(result.prompt_contract_qa, fixture.item.prompt_contract_qa);
    assert.deepEqual(
      result.prompt_contract_qa.failures,
      fixture.promptMarkerFailures,
    );
  } finally {
    fs.rmSync(fixture.repositoryRoot, {recursive: true});
  }
});

test('finalizer rejects stale prompt marker QA or missing supplemental release', () => {
  const staleQa = makeFixture({withPromptMarkerOverride: true});
  try {
    staleQa.item.prompt_contract_qa.failures[0].reason = 'rewritten failure';
    assert.throws(
      () => validateWhiteCatP2OverrideEvidence(staleQa),
      /prompt fixed-marker QA/,
    );
  } finally {
    fs.rmSync(staleQa.repositoryRoot, {recursive: true});
  }

  const missingSupplement = makeFixture({withPromptMarkerOverride: true});
  try {
    delete missingSupplement.item.user_mechanical_gate_override.decision
      .supplemental_exact_user_messages;
    assert.throws(
      () => validateWhiteCatP2OverrideEvidence(missingSupplement),
      /supplemental prompt-marker release is missing/,
    );
  } finally {
    fs.rmSync(missingSupplement.repositoryRoot, {recursive: true});
  }
});

test('finalizer rejects stale blocker or changed bound bytes', () => {
  const staleBlocker = makeFixture();
  try {
    staleBlocker.state.blockers[0].status = 'resolved';
    assert.throws(
      () => validateWhiteCatP2OverrideEvidence(staleBlocker),
      /attempt-limit blocker/,
    );
  } finally {
    fs.rmSync(staleBlocker.repositoryRoot, {recursive: true});
  }

  const changed = makeFixture();
  try {
    fs.writeFileSync(path.join(changed.repositoryRoot, changed.item.prompt_path), 'changed');
    assert.throws(
      () => validateWhiteCatP2OverrideEvidence(changed),
      /checksum mismatch/,
    );
  } finally {
    fs.rmSync(changed.repositoryRoot, {recursive: true});
  }
});
