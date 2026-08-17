import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TIMING_CONTINUITY_THRESHOLDS,
  analyzeLowMotionFrames,
  assessRenderedContinuity,
  assessTimelineContinuity,
  intersectTimeRanges,
  parseSilenceDetect,
  reconcileInferredTails,
  subtractTimeRanges,
} from '../scripts/timeline-continuity-lib.mjs';

const scene = ({id, tailSeconds, durationSeconds = 10, events = []}) => ({
  id,
  tailSeconds,
  narration: {startSeconds: 0, durationSeconds},
  durationInFrames: Math.ceil((durationSeconds + tailSeconds) * 30),
  from: 0,
  motion: {
    proofTimes: [
      {id: 'establish', at: 0.08},
      {id: 'action', at: 0.5},
      {id: 'final', at: 0.9},
    ],
  },
  events,
});

const project = ({requestedDuration = null, scenes}) => ({
  plan: {requested: {durationSeconds: requestedDuration}},
  video: {fps: 30},
  scenes,
});

test('inferred timelines cap padding tails but explicit timelines remain authored', () => {
  for (const inputMode of ['none', 'scenes-only']) {
    const inferred = project({
      scenes: [
        scene({id: 'one', tailSeconds: 4.5}),
        scene({id: 'two', tailSeconds: 5.2}),
      ],
    });
    inferred.plan.inputMode = inputMode;
    assert.deepEqual(reconcileInferredTails(inferred), [
      {sceneId: 'one', beforeSeconds: 4.5, afterSeconds: 1.2},
      {sceneId: 'two', beforeSeconds: 5.2, afterSeconds: 1.8},
    ]);
    assert.deepEqual(
      inferred.scenes.map(({tailSeconds}) => tailSeconds),
      [1.2, 1.8],
    );
  }

  for (const inputMode of ['duration-only', 'both']) {
    const explicit = project({
      requestedDuration: 30,
      scenes: [scene({id: 'one', tailSeconds: 4.5})],
    });
    explicit.plan.inputMode = inputMode;
    assert.deepEqual(reconcileInferredTails(explicit), []);
    assert.equal(explicit.scenes[0].tailSeconds, 4.5);
  }
});

test('tail validation reports padding and permits only a bounded proof-backed hold', () => {
  const padded = scene({id: 'padded', tailSeconds: 4.5});
  const paddedIssues = assessTimelineContinuity(
    project({scenes: [padded]}),
    {scenes: [padded]},
  );
  assert.ok(paddedIssues.some(({code}) => code === 'scene-tail-budget'));

  const held = scene({
    id: 'held',
    tailSeconds: 2.2,
    events: [
      {
        id: 'hold-final',
        beatId: 'final',
        at: 10 / 12.2,
        targetId: 'scene',
        visual: {kind: 'hold', durationSeconds: 2.2},
        proofTimeId: 'final',
      },
    ],
  });
  held.motion.proofTimes[2].at = 0.9;
  assert.deepEqual(
    assessTimelineContinuity(
      project({scenes: [held]}),
      {scenes: [held]},
    ),
    [],
  );

  held.events[0].visual.durationSeconds = 3;
  const overlong = assessTimelineContinuity(
    project({scenes: [held]}),
    {scenes: [held]},
  );
  assert.ok(overlong.some(({code}) => code === 'scene-hold-duration'));
  assert.ok(overlong.some(({code}) => code === 'scene-tail-budget'));
});

test('range math parses silence and subtracts only declared hold windows', () => {
  const silent = parseSilenceDetect(
    '[silencedetect] silence_start: 1.2\n[silencedetect] silence_end: 4.7 | silence_duration: 3.5\n[silencedetect] silence_start: 8.1',
    10,
  );
  assert.deepEqual(silent, [
    {startSeconds: 1.2, endSeconds: 4.7, durationSeconds: 3.5},
    {startSeconds: 8.1, endSeconds: 10, durationSeconds: 1.9},
  ]);
  assert.deepEqual(
    intersectTimeRanges(silent, [
      {startSeconds: 2, endSeconds: 5},
      {startSeconds: 7, endSeconds: 9},
    ]),
    [
      {startSeconds: 2, endSeconds: 4.7, durationSeconds: 2.7},
      {startSeconds: 8.1, endSeconds: 9, durationSeconds: 0.9},
    ],
  );
  assert.deepEqual(
    subtractTimeRanges(
      [{startSeconds: 2, endSeconds: 5}],
      [{startSeconds: 3, endSeconds: 4}],
    ),
    [
      {startSeconds: 2, endSeconds: 3, durationSeconds: 1},
      {startSeconds: 4, endSeconds: 5, durationSeconds: 1},
    ],
  );
});

test('low-motion sampling distinguishes repeated frames from visible changes', () => {
  const width = 4;
  const height = 2;
  const staticFrames = Buffer.alloc(width * height * 11, 80);
  const staticResult = analyzeLowMotionFrames({
    buffer: staticFrames,
    durationSeconds: 2,
    width,
    height,
    fps: 5,
  });
  assert.deepEqual(staticResult.ranges, [
    {startSeconds: 0, endSeconds: 2, durationSeconds: 2},
  ]);

  const changingFrames = Buffer.concat(
    Array.from({length: 11}, (_, index) =>
      Buffer.alloc(width * height, index % 2 === 0 ? 0 : 255),
    ),
  );
  assert.deepEqual(
    analyzeLowMotionFrames({
      buffer: changingFrames,
      durationSeconds: 2,
      width,
      height,
      fps: 5,
    }).ranges,
    [],
  );
});

test('rendered continuity fails only where silence and low motion overlap', () => {
  const timeline = {
    scenes: [
      {...scene({id: 'one', tailSeconds: 0, durationSeconds: 5}), from: 0},
    ],
  };
  const failed = assessRenderedContinuity({
    silentRanges: [{startSeconds: 1, endSeconds: 4}],
    lowMotionRanges: [{startSeconds: 2, endSeconds: 5}],
    approvedHoldRanges: [],
    timeline,
    fps: 30,
    durationSeconds: 5,
  });
  assert.equal(failed.passed, false);
  assert.deepEqual(failed.deadAirRanges, [
    {startSeconds: 2, endSeconds: 4, durationSeconds: 2},
  ]);
  assert.equal(failed.perScene[0].sceneId, 'one');

  const activeVideo = assessRenderedContinuity({
    silentRanges: [{startSeconds: 0, endSeconds: 5}],
    lowMotionRanges: [],
    approvedHoldRanges: [],
    timeline,
    fps: 30,
    durationSeconds: 5,
  });
  assert.equal(activeVideo.passed, true);

  const spokenStatic = assessRenderedContinuity({
    silentRanges: [],
    lowMotionRanges: [{startSeconds: 0, endSeconds: 5}],
    approvedHoldRanges: [],
    timeline,
    fps: 30,
    durationSeconds: 5,
  });
  assert.equal(spokenStatic.passed, true);

  const held = assessRenderedContinuity({
    silentRanges: [{startSeconds: 1, endSeconds: 3}],
    lowMotionRanges: [{startSeconds: 1, endSeconds: 3}],
    approvedHoldRanges: [{startSeconds: 1, endSeconds: 3}],
    timeline,
    fps: 30,
    durationSeconds: 5,
  });
  assert.equal(held.passed, true);
  assert.deepEqual(held.deadAirRanges, []);
  assert.equal(
    TIMING_CONTINUITY_THRESHOLDS.deadAirErrorSeconds,
    1.2,
  );
});
