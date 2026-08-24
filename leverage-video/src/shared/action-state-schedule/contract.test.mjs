import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  ACTION_STATE_SCHEDULE_VERSION,
  ACTION_STATE_SCHEDULE_V3_VERSION,
  ACTION_STATE_SCHEDULE_V4_VERSION,
  MIN_CLEAN_HOLD_FRAMES,
  TERMINAL_HOLD_EXTENSION_POLICY,
  buildActionStateSchedule,
  buildActionStatePlanSha256,
  buildActionStateScheduleV3,
  buildActionStateScheduleV4,
  retimeActionStateScheduleForRevoice,
  retimeActionStateScheduleV3,
  retimeActionStateScheduleV4,
  validateActionStateSchedule,
} from './contract.mjs';

const expected = new Map([
  [1, [1]],
  [45, [45]],
  [67, [67]],
  [68, [34, 34]],
  [75, [38, 37]],
  [76, [38, 38]],
  [225, [45, 45, 45, 45, 45]],
  [375, [75, 75, 75, 75, 75]],
]);

for (const [totalFrames, durations] of expected) {
  test(`builds the mechanical v2 state schedule for F=${totalFrames}`, () => {
    const schedule = buildActionStateSchedule({totalFrames, fps: 30});
    assert.equal(schedule.contract_version, ACTION_STATE_SCHEDULE_VERSION);
    assert.equal(schedule.state_count_total, durations.length);
    assert.equal(schedule.action_variant_count, durations.length - 1);
    assert.deepEqual(schedule.occurrences.map((item) => item.duration_in_frames), durations);
    assert.deepEqual(
      schedule.occurrences.map((item) => item.transition_in_frames),
      durations.map((_, index) => index === 0 ? 0 : 18),
    );
    assert.deepEqual(
      schedule.occurrences.map((item) => item.clean_hold_in_frames),
      durations.map((duration, index) => duration - (index === 0 ? 0 : 18)),
    );
    assert.equal(schedule.occurrences[0].start_frame, 0);
    assert.equal(schedule.occurrences.at(-1).end_frame, totalFrames);
    assert.equal(schedule.intra_shot_transitions.length, Math.max(0, durations.length - 1));
    assert.equal(validateActionStateSchedule(schedule, {totalFrames, fps: 30}).result, 'pass');
  });
}

test('requires a semantic shot split when the formula exceeds five states', () => {
  assert.throws(
    () => buildActionStateSchedule({totalFrames: 376, fps: 30}),
    /split.*shot|shot.*split/i,
  );
});

test('extends the final approved state through a terminal inheritance hold', () => {
  const schedule = buildActionStateSchedule({
    totalFrames: 584,
    fps: 30,
    visualProgressionFrames: 158,
    terminalHoldExtensionPolicy: TERMINAL_HOLD_EXTENSION_POLICY,
  });
  assert.equal(schedule.state_count_total, 4);
  assert.deepEqual(schedule.occurrences.map((item) => item.duration_in_frames), [40, 40, 39, 465]);
  assert.equal(schedule.occurrences.at(-1).end_frame, 584);
  assert.equal(schedule.visual_progression_frames, 158);
  assert.equal(schedule.terminal_hold_extension_frames, 426);
  assert.equal(validateActionStateSchedule(schedule, {totalFrames: 584, fps: 30}).result, 'pass');

  schedule.terminal_hold_extension_frames -= 1;
  assert.throws(
    () => validateActionStateSchedule(schedule, {totalFrames: 584, fps: 30}),
    /terminal hold extension/i,
  );
});

test('rejects uneven coverage, illegal holds, and a non-N-1 watercolor chain', () => {
  const coverage = buildActionStateSchedule({totalFrames: 225, fps: 30});
  coverage.occurrences[2].end_frame -= 1;
  assert.throws(() => validateActionStateSchedule(coverage, {totalFrames: 225, fps: 30}), /coverage|consecutive/i);

  const hold = buildActionStateSchedule({totalFrames: 76, fps: 30});
  Object.assign(hold.occurrences[0], {duration_in_frames: 17, end_frame: 17});
  Object.assign(hold.occurrences[1], {duration_in_frames: 59, start_frame: 17, end_frame: 76});
  assert.throws(() => validateActionStateSchedule(hold, {totalFrames: 76, fps: 30}), /18.*75/i);

  const chain = buildActionStateSchedule({totalFrames: 68, fps: 30});
  chain.intra_shot_transitions = [];
  assert.throws(() => validateActionStateSchedule(chain, {totalFrames: 68, fps: 30}), /N - 1|N-1/i);

  const cleanHold = buildActionStateSchedule({totalFrames: 68, fps: 30});
  cleanHold.occurrences[1].clean_hold_in_frames = MIN_CLEAN_HOLD_FRAMES - 1;
  assert.throws(
    () => validateActionStateSchedule(cleanHold, {totalFrames: 68, fps: 30}),
    /clean hold|15/i,
  );
});

test('revoice preserves state count and order, and blocks incompatible timing', () => {
  const parent = buildActionStateSchedule({totalFrames: 225, fps: 30});
  const retimed = retimeActionStateScheduleForRevoice({parentSchedule: parent, totalFrames: 165, fps: 30});
  assert.equal(validateActionStateSchedule(retimed, {
    totalFrames: 165,
    fps: 30,
    revoiceLock: {state_ids: parent.occurrences.map((item) => item.state_id)},
  }).result, 'pass');

  assert.throws(() => validateActionStateSchedule(retimed, {
    totalFrames: 165,
    fps: 30,
    revoiceLock: {state_ids: parent.occurrences.map((item) => item.state_id).toReversed()},
  }), /revoice.*order|order.*revoice/i);
  assert.throws(
    () => retimeActionStateScheduleForRevoice({parentSchedule: parent, totalFrames: 164, fps: 30}),
    /clean hold|15|revoice/i,
  );
});

const buildV3States = (count, {step = 30, text = '甲乙丙丁戊己'} = {}) => {
  const characters = [...text].slice(0, count);
  let byteCursor = 0;
  return characters.map((character, index) => {
    const byteLength = Buffer.byteLength(character, 'utf8');
    const state = {
      state_id: `state-${index + 1}`,
      semantic_state: `语义状态-${index + 1}`,
      narration_byte_start: byteCursor,
      narration_byte_end: byteCursor + byteLength,
      narration_text: character,
      at_frame: index * step,
      semantic_hold_reason: null,
    };
    byteCursor += byteLength;
    return state;
  });
};

const buildLegacyV3PlanSha256 = (schedule) => crypto
  .createHash('sha256')
  .update(JSON.stringify({
    contract_version: ACTION_STATE_SCHEDULE_V3_VERSION,
    fps: schedule.fps,
    motion_tier: schedule.motion_tier,
    state_count_total: schedule.state_count_total,
    state_count_rationale: schedule.state_count_rationale ?? null,
    states: schedule.occurrences.map((occurrence) => ({
      state_id: occurrence.state_id,
      semantic_state: occurrence.semantic_state,
      narration_byte_start: occurrence.narration_byte_start,
      narration_byte_end: occurrence.narration_byte_end,
      narration_text: occurrence.narration_text,
    })),
    intra_shot_transitions: schedule.intra_shot_transitions.map((transition) => ({
      from_asset_id: transition.from_asset_id,
      to_asset_id: transition.to_asset_id,
      from_image_index: transition.from_image_index,
      to_image_index: transition.to_image_index,
      kind: transition.kind,
      duration_seconds: transition.duration_seconds,
      duration_in_frames: transition.duration_in_frames,
      renderer: transition.renderer,
    })),
  }))
  .digest('hex');

test('v3 plan hashing remains byte-compatible with already approved schedules', () => {
  const schedule = buildActionStateScheduleV3({
    totalFrames: 90,
    sourceText: '甲乙丙',
    motionTier: 'stateful',
    states: buildV3States(3),
  });
  assert.equal(buildActionStatePlanSha256(schedule), buildLegacyV3PlanSha256(schedule));
});

for (const count of [2, 3, 4]) {
  test(`builds a semantic stateful v3 schedule with ${count} states`, () => {
    const sourceText = [...'甲乙丙丁'].slice(0, count).join('');
    const schedule = buildActionStateScheduleV3({
      totalFrames: count * 30,
      sourceText,
      motionTier: 'stateful',
      states: buildV3States(count),
      stateCountRationale: count === 4 ? '旁白明确包含建立、接触、变化和稳定四个语义节点。' : null,
    });
    assert.equal(schedule.contract_version, ACTION_STATE_SCHEDULE_V3_VERSION);
    assert.equal(schedule.state_count_total, count);
    assert.deepEqual(schedule.intra_shot_transitions.map(({kind}) => kind), Array(count - 1).fill('cut'));
    assert.equal(validateActionStateSchedule(schedule, {
      totalFrames: count * 30,
      fps: 30,
    }).result, 'pass');
  });
}

test('rejects invalid stateful counts, duplicate semantics, incomplete text, and missing fourth-state rationale', () => {
  assert.throws(() => buildActionStateScheduleV3({
    totalFrames: 30,
    sourceText: '甲',
    motionTier: 'stateful',
    states: buildV3States(1),
  }), /stateful requires 2–4/);
  assert.throws(() => buildActionStateScheduleV3({
    totalFrames: 150,
    sourceText: '甲乙丙丁戊',
    motionTier: 'stateful',
    states: buildV3States(5),
    stateCountRationale: '错误地尝试增加第五张。',
  }), /stateful requires 2–4/);
  assert.throws(() => buildActionStateScheduleV3({
    totalFrames: 120,
    sourceText: '甲乙丙丁',
    motionTier: 'stateful',
    states: buildV3States(4),
  }), /state_count_rationale/);
  const duplicate = buildV3States(2);
  duplicate[1].semantic_state = duplicate[0].semantic_state;
  assert.throws(() => buildActionStateScheduleV3({
    totalFrames: 60,
    sourceText: '甲乙',
    motionTier: 'stateful',
    states: duplicate,
  }), /semantic_state is duplicated/);
  const incomplete = buildV3States(2);
  incomplete[1].narration_byte_end -= 1;
  assert.throws(() => buildActionStateScheduleV3({
    totalFrames: 60,
    sourceText: '甲乙',
    motionTier: 'stateful',
    states: incomplete,
  }), /byte range|UTF-8|cover/i);
});

test('accepts an explicitly approved six-pose hero plan but rejects stale or missing approval', () => {
  const candidate = buildActionStateScheduleV3({
    totalFrames: 180,
    sourceText: '甲乙丙丁戊己',
    motionTier: 'hero_pose',
    states: buildV3States(6),
    stateCountRationale: '高潮动作需要六个物理可达的关键姿态。',
    splitAssessment: {
      natural_semantic_pause_available: false,
      rationale: '六个姿态共同构成一次不可拆的连续动作。',
    },
  });
  assert.throws(
    () => validateActionStateSchedule(candidate, {totalFrames: 180, fps: 30}),
    /explicit approved evidence/,
  );
  candidate.extended_family_approval = {
    status: 'approved',
    exact_message: '批准该镜头使用六张关键姿态图。',
    decided_at: '2026-08-19T12:00:00+08:00',
    presented_map_sha256: 'a'.repeat(64),
    state_plan_sha256: buildActionStatePlanSha256(candidate),
  };
  assert.equal(validateActionStateSchedule(candidate, {totalFrames: 180, fps: 30}).result, 'pass');
  candidate.extended_family_approval.state_plan_sha256 = 'b'.repeat(64);
  assert.throws(
    () => validateActionStateSchedule(candidate, {totalFrames: 180, fps: 30}),
    /hash is stale/,
  );
});

test('v3 supports mixed cut/watercolor timing and blocks unreadable target holds', () => {
  const sourceText = '甲乙丙';
  const candidate = buildActionStateScheduleV3({
    totalFrames: 90,
    sourceText,
    motionTier: 'stateful',
    states: buildV3States(3),
  });
  candidate.intra_shot_transitions[0] = {
    ...candidate.intra_shot_transitions[0],
    kind: 'watercolor-bloom',
    duration_seconds: 0.6,
    duration_in_frames: 18,
    renderer: 'leverage-video/src/shared/watercolor-bloom',
    user_selection: {
      status: 'approved',
      exact_message: '批准该相邻状态使用 watercolor-bloom。',
      decided_at: '2026-08-19T10:00:00+08:00',
      presented_map_sha256: 'a'.repeat(64),
    },
  };
  candidate.occurrences[1].transition_in_frames = 18;
  candidate.occurrences[1].clean_hold_in_frames = 12;
  assert.throws(
    () => validateActionStateSchedule(candidate, {totalFrames: 90, fps: 30}),
    /15-frame clean hold/,
  );

  const readable = buildActionStateScheduleV3({
    totalFrames: 99,
    sourceText,
    motionTier: 'stateful',
    states: buildV3States(3, {step: 33}),
  });
  readable.intra_shot_transitions[0] = {
    ...readable.intra_shot_transitions[0],
    kind: 'watercolor-bloom',
    duration_seconds: 0.6,
    duration_in_frames: 18,
    renderer: 'leverage-video/src/shared/watercolor-bloom',
    user_selection: {
      status: 'approved',
      exact_message: '批准该相邻状态使用 watercolor-bloom。',
      decided_at: '2026-08-19T10:00:00+08:00',
      presented_map_sha256: 'a'.repeat(64),
    },
  };
  readable.occurrences[1].transition_in_frames = 18;
  readable.occurrences[1].clean_hold_in_frames = 15;
  assert.equal(validateActionStateSchedule(readable, {totalFrames: 99, fps: 30}).result, 'pass');
});

const densitySelectionSha256 = 'd'.repeat(64);

const buildV4 = ({
  motionTier,
  densityMode,
  count,
  totalFrames = count * 30,
  densityFallback = null,
  splitAssessment = null,
  quantityRationale = null,
}) => {
  const sourceText = [...'甲乙丙丁戊己庚辛壬癸子丑寅'].slice(0, count).join('');
  return buildActionStateScheduleV4({
    totalFrames,
    sourceText,
    motionTier,
    states: buildV3States(count, {step: Math.floor(totalFrames / count), text: sourceText}),
    densityMode,
    visualDensitySelectionSha256: densitySelectionSha256,
    backgroundAssetId: motionTier === 'hero_pose' ? 'S01-background' : null,
    stateCountRationale: densityMode === 'standard' && motionTier === 'stateful' && count === 4
      ? '四个独立语义状态。'
      : null,
    densityFallback,
    splitAssessment,
    quantityRationale,
  });
};

test('standard v4 counts remain unchanged', () => {
  for (const count of [2, 3, 4]) {
    const schedule = buildV4({motionTier: 'stateful', densityMode: 'standard', count});
    assert.equal(validateActionStateSchedule(schedule, {
      totalFrames: schedule.total_frames,
      densityMode: 'standard',
      densitySelectionSha256,
    }).result, 'pass');
  }
  assert.throws(
    () => buildV4({motionTier: 'stateful', densityMode: 'standard', count: 5}),
    /stateful standard requires 2–4/,
  );
  assert.throws(
    () => buildV4({motionTier: 'hero_pose', densityMode: 'standard', count: 7}),
    /hero_pose standard requires 4–6/,
  );
});

test('rich stateful targets 4–6 and requires fallback for 2–3', () => {
  for (const count of [4, 5, 6]) {
    const schedule = buildV4({motionTier: 'stateful', densityMode: 'rich', count});
    assert.equal(validateActionStateSchedule(schedule, {totalFrames: schedule.total_frames}).result, 'pass');
  }
  for (const count of [2, 3]) {
    assert.throws(
      () => buildV4({motionTier: 'stateful', densityMode: 'rich', count}),
      /density fallback/,
    );
    const schedule = buildV4({
      motionTier: 'stateful',
      densityMode: 'rich',
      count,
      densityFallback: {
        target_minimum: 4,
        actual_count: count,
        maximum_feasible_count: count,
        reason_code: 'insufficient_semantic_beats',
        rationale: '锁稿仅有这些互不重复的完整语义节点。',
      },
    });
    assert.equal(validateActionStateSchedule(schedule, {totalFrames: schedule.total_frames}).result, 'pass');
  }
});

test('rich hero supports total 5–14, fallback 5–9, target 10–12, and longest 13 poses', () => {
  for (const poses of [9, 10, 11]) {
    const schedule = buildV4({motionTier: 'hero_pose', densityMode: 'rich', count: poses});
    assert.equal(validateActionStateSchedule(schedule, {totalFrames: schedule.total_frames}).asset_total, poses + 1);
    assert.equal(schedule.intra_shot_transitions.length, poses - 1);
    assert.equal(schedule.action_variant_count, poses);
  }
  const fallback = buildV4({
    motionTier: 'hero_pose',
    densityMode: 'rich',
    count: 4,
    densityFallback: {
      target_minimum: 10,
      actual_count: 5,
      maximum_feasible_count: 5,
      reason_code: 'insufficient_clean_hold_capacity',
      rationale: '真实音频只能承载四个姿态的净展示。',
    },
  });
  assert.equal(validateActionStateSchedule(fallback, {totalFrames: fallback.total_frames}).asset_total, 5);

  const longest = buildV4({
    motionTier: 'hero_pose',
    densityMode: 'rich',
    count: 13,
    splitAssessment: {
      natural_semantic_pause_available: false,
      rationale: '连续因果动作无法自然拆镜。',
    },
    quantityRationale: '十三个姿态分别承载十三个不可合并的动作节点。',
  });
  assert.equal(validateActionStateSchedule(longest, {totalFrames: longest.total_frames}).asset_total, 14);
  assert.equal(longest.background_asset_id, 'S01-background');
});

test('rich hero total 13–14 requires no-split assessment and quantity rationale', () => {
  assert.throws(
    () => buildV4({motionTier: 'hero_pose', densityMode: 'rich', count: 12}),
    /no-split assessment/,
  );
  assert.throws(
    () => buildV4({
      motionTier: 'hero_pose',
      densityMode: 'rich',
      count: 12,
      splitAssessment: {natural_semantic_pause_available: false, rationale: '不可拆。'},
    }),
    /quantity_rationale/,
  );
});

test('v4 requires 15*N clean frames plus all transition frames and exact UTF-8 coverage', () => {
  assert.throws(
    () => buildV4({
      motionTier: 'stateful',
      densityMode: 'rich',
      count: 4,
      totalFrames: 59,
    }),
    /15-frame clean hold|15\*N clean frames plus transition frames/,
  );
  const stale = buildV4({motionTier: 'stateful', densityMode: 'rich', count: 4});
  stale.occurrences[1].narration_byte_end -= 1;
  assert.throws(() => validateActionStateSchedule(stale, {totalFrames: stale.total_frames}), /byte range|UTF-8/);
});

test('v4 canonical hash binds density fallback and split assessment', () => {
  const schedule = buildV4({
    motionTier: 'stateful',
    densityMode: 'rich',
    count: 3,
    densityFallback: {
      target_minimum: 4,
      actual_count: 3,
      maximum_feasible_count: 3,
      reason_code: 'insufficient_semantic_beats',
      rationale: '三段语义。',
    },
  });
  const before = buildActionStatePlanSha256(schedule);
  schedule.density_fallback.rationale = '篡改';
  assert.notEqual(buildActionStatePlanSha256(schedule), before);
});

test('v4 revoice preserves density count order and canonical plan hash', () => {
  const parent = buildV4({motionTier: 'stateful', densityMode: 'rich', count: 4});
  const retimed = retimeActionStateScheduleV4({
    parentSchedule: parent,
    totalFrames: 140,
    stateAtFrames: parent.occurrences.map((occurrence, index) => ({
      state_id: occurrence.state_id,
      at_frame: index * 35,
    })),
  });
  assert.equal(buildActionStatePlanSha256(retimed), buildActionStatePlanSha256(parent));
  assert.equal(validateActionStateSchedule(retimed, {
    totalFrames: 140,
    revoiceLock: {
      state_plan_sha256: buildActionStatePlanSha256(parent),
      density_mode: 'rich',
      visual_density_selection_sha256: densitySelectionSha256,
    },
  }).result, 'pass');
  retimed.density_mode = 'standard';
  assert.throws(
    () => validateActionStateSchedule(retimed, {totalFrames: 140, densityMode: 'rich'}),
    /density mode binding is stale/,
  );
});

test('v3 revoice preserves IDs, semantic plan, and effects while retiming frames', () => {
  const parent = buildActionStateScheduleV3({
    totalFrames: 90,
    sourceText: '甲乙丙',
    motionTier: 'stateful',
    states: buildV3States(3),
  });
  const parentPlanHash = buildActionStatePlanSha256(parent);
  const retimed = retimeActionStateScheduleV3({
    parentSchedule: parent,
    totalFrames: 105,
    stateAtFrames: [
      {state_id: 'state-1', at_frame: 0},
      {state_id: 'state-2', at_frame: 36},
      {state_id: 'state-3', at_frame: 72},
    ],
  });
  assert.equal(buildActionStatePlanSha256(retimed), parentPlanHash);
  assert.equal(validateActionStateSchedule(retimed, {
    totalFrames: 105,
    fps: 30,
    revoiceLock: {
      state_ids: parent.occurrences.map(({state_id}) => state_id),
      state_plan_sha256: parentPlanHash,
    },
  }).result, 'pass');
  assert.throws(() => retimeActionStateScheduleV3({
    parentSchedule: parent,
    totalFrames: 59,
    stateAtFrames: [
      {state_id: 'state-1', at_frame: 0},
      {state_id: 'state-2', at_frame: 30},
      {state_id: 'state-3', at_frame: 45},
    ],
  }), /15-frame clean hold/);
});
