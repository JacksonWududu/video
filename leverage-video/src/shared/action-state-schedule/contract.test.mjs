import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTION_STATE_SCHEDULE_VERSION,
  MIN_CLEAN_HOLD_FRAMES,
  buildActionStateSchedule,
  retimeActionStateScheduleForRevoice,
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
