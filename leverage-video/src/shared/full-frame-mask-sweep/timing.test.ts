import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FULL_FRAME_MASK_HOLD_SECONDS,
  getFullFrameMaskSweepTiming,
} from './timing.ts';

test('derives a 7-second sweep plus a 3-second hold for a 10-second shot', () => {
  assert.equal(FULL_FRAME_MASK_HOLD_SECONDS, 3);
  assert.deepEqual(
    getFullFrameMaskSweepTiming({durationInFrames: 300, fps: 30}),
    {
      shouldAnimate: true,
      holdFrames: 90,
      sweepFrames: 210,
      holdStartFrame: 210,
      holdEndFrame: 299,
    },
  );
});

test('adapts the sweep to the actual shot duration and fps', () => {
  assert.deepEqual(
    getFullFrameMaskSweepTiming({durationInFrames: 240, fps: 30}),
    {
      shouldAnimate: true,
      holdFrames: 90,
      sweepFrames: 150,
      holdStartFrame: 150,
      holdEndFrame: 239,
    },
  );

  assert.deepEqual(
    getFullFrameMaskSweepTiming({durationInFrames: 150, fps: 24}),
    {
      shouldAnimate: true,
      holdFrames: 72,
      sweepFrames: 78,
      holdStartFrame: 78,
      holdEndFrame: 149,
    },
  );
});

test('uses a static full-image hold for a shot equal to 3 seconds', () => {
  assert.deepEqual(
    getFullFrameMaskSweepTiming({durationInFrames: 90, fps: 30}),
    {
      shouldAnimate: false,
      holdFrames: 90,
      sweepFrames: 0,
      holdStartFrame: 0,
      holdEndFrame: 89,
    },
  );
});

test('uses a static full-image hold for a shot shorter than 3 seconds', () => {
  assert.deepEqual(
    getFullFrameMaskSweepTiming({durationInFrames: 60, fps: 30}),
    {
      shouldAnimate: false,
      holdFrames: 60,
      sweepFrames: 0,
      holdStartFrame: 0,
      holdEndFrame: 59,
    },
  );
});

test('rejects invalid frame and fps inputs', () => {
  assert.throws(
    () => getFullFrameMaskSweepTiming({durationInFrames: 300.5, fps: 30}),
    /positive integer/,
  );
  assert.throws(
    () => getFullFrameMaskSweepTiming({durationInFrames: 300, fps: 0}),
    /positive number/,
  );
});
