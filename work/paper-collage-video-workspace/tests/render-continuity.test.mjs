import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import test from 'node:test';
import {
  analyzeRenderedContinuityArtifact,
} from '../scripts/timeline-continuity-lib.mjs';

const execFileAsync = promisify(execFile);

const makeClip = async ({output, videoSource, audioSource}) => {
  await execFileAsync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      videoSource,
      '-f',
      'lavfi',
      '-i',
      audioSource,
      '-t',
      '2.4',
      '-c:v',
      'mpeg4',
      '-q:v',
      '4',
      '-c:a',
      'aac',
      '-y',
      output,
    ],
    {maxBuffer: 16 * 1024 * 1024},
  );
};

const makeTimeline = ({hold = false} = {}) => ({
  durationInFrames: 72,
  durationSeconds: 2.4,
  scenes: [
    {
      id: 'fixture',
      from: 0,
      durationInFrames: 72,
      motion: {proofTimes: [{id: 'observe', at: 0.5}]},
      events: hold
        ? [
            {
              id: 'observe-hold',
              beatId: 'observe',
              at: 0,
              targetId: 'scene',
              visual: {kind: 'hold', durationSeconds: 2.4},
              proofTimeId: 'observe',
            },
          ]
        : [],
    },
  ],
});

test('ffmpeg continuity analysis checks real audio-video unions', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'continuity-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const staticSilent = path.join(directory, 'static-silent.mp4');
  const movingSilent = path.join(directory, 'moving-silent.mp4');
  const staticSpoken = path.join(directory, 'static-spoken.mp4');
  await Promise.all([
    makeClip({
      output: staticSilent,
      videoSource: 'color=c=#6e1e19:s=320x180:r=30',
      audioSource: 'anullsrc=r=48000:cl=mono',
    }),
    makeClip({
      output: movingSilent,
      videoSource: 'testsrc2=s=320x180:r=30',
      audioSource: 'anullsrc=r=48000:cl=mono',
    }),
    makeClip({
      output: staticSpoken,
      videoSource: 'color=c=#6e1e19:s=320x180:r=30',
      audioSource: 'sine=frequency=440:sample_rate=48000',
    }),
  ]);

  const common = {
    durationSeconds: 2.4,
    hasAudio: true,
    timeline: makeTimeline(),
    fps: 30,
  };
  const dead = await analyzeRenderedContinuityArtifact({
    ...common,
    artifact: staticSilent,
  });
  assert.equal(dead.passed, false);
  assert.ok(dead.failingRanges.some(({durationSeconds}) => durationSeconds >= 2));

  const moving = await analyzeRenderedContinuityArtifact({
    ...common,
    artifact: movingSilent,
  });
  assert.equal(moving.passed, true);

  const spoken = await analyzeRenderedContinuityArtifact({
    ...common,
    artifact: staticSpoken,
  });
  assert.equal(spoken.passed, true);

  const approvedHold = await analyzeRenderedContinuityArtifact({
    ...common,
    artifact: staticSilent,
    timeline: makeTimeline({hold: true}),
  });
  assert.equal(approvedHold.passed, true);
  assert.deepEqual(approvedHold.deadAirRanges, []);
});
