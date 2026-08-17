import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GEN_THINK_STATE_IDS,
  buildGenThinkSchedule,
  getGenThinkStateAtFrame,
  normalizeGenThinkDuration,
} from './timing.ts';

test('builds a complete five-state loop for a short reusable shot', () => {
  const schedule = buildGenThinkSchedule(120, 30);

  assert.deepEqual(
    schedule.map((occurrence) => occurrence.assetId),
    GEN_THINK_STATE_IDS,
  );
  assert.equal(schedule.reduce((sum, occurrence) => sum + occurrence.durationInFrames, 0), 120);
  assert.equal(getGenThinkStateAtFrame(schedule, 0).assetId, 'GEN-THINK-master-v04');
  assert.equal(getGenThinkStateAtFrame(schedule, 119).assetId, 'GEN-THINK-action-04-v01');
});

test('repeats only whole ordered cycles for a long consumer duration', () => {
  const schedule = buildGenThinkSchedule(900, 30);

  assert.equal(schedule.length, 20);
  assert.deepEqual(
    schedule.map((occurrence) => occurrence.assetId),
    [
      ...GEN_THINK_STATE_IDS,
      ...GEN_THINK_STATE_IDS,
      ...GEN_THINK_STATE_IDS,
      ...GEN_THINK_STATE_IDS,
    ],
  );
  assert.ok(schedule.every((occurrence) => occurrence.durationInFrames <= 45));
});

test('covers a non-divisible duration without gaps or overrun', () => {
  const schedule = buildGenThinkSchedule(451, 30);

  assert.equal(schedule.reduce((sum, occurrence) => sum + occurrence.durationInFrames, 0), 451);
  assert.equal(schedule[0].from, 0);
  assert.equal(schedule.at(-1)?.toExclusive, 451);
  for (let frame = 0; frame < 451; frame += 1) {
    const state = getGenThinkStateAtFrame(schedule, frame);
    assert.ok(frame >= state.from && frame < state.toExclusive);
  }
});

test('rejects durations too short to show every approved state once', () => {
  assert.throws(() => buildGenThinkSchedule(4, 30), /at least 5 frames/);
});

test('normalizes consumer duration to a usable whole-frame value', () => {
  assert.equal(normalizeGenThinkDuration(451.9), 451);
  assert.throws(() => normalizeGenThinkDuration(4.9), /at least 5 frames/);
  assert.throws(() => normalizeGenThinkDuration(Number.NaN), /finite number/);
});
