import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertVoxSampleProofPassed,
  buildVoxSampleProofReport,
  parseMediaFrameRate,
} from '../scripts/vox-sample-proof-lib.mjs';

const digest = 'a'.repeat(64);
const contract = {
  sample: 'vox-primitives',
  review: {status: 'approved-direction'},
  expected: {
    width: 960,
    height: 540,
    fps: 30,
    durationSeconds: 6,
    durationToleranceSeconds: 0.08,
    videoCodec: 'h264',
    audioCodec: 'aac',
    parallaxSceneCount: 2,
    motifFieldCount: 2,
    boundary: {frame: 90, type: 'cut', motivation: 'rhythmic', beatId: 'world-cut'},
    proofTimeIds: ['one-a', 'one-b', 'two-a', 'two-b'],
  },
};
const project = {
  schemaVersion: 12,
  scenes: [
    {
      id: 'one',
      camera: {parallax: {enabled: true}},
      composition: {nodes: [{id: 'field-one', kind: 'motif-field', exclusionZones: [{}]}]},
    },
    {
      id: 'two',
      camera: {parallax: {enabled: true}},
      composition: {nodes: [{id: 'field-two', kind: 'motif-field', exclusionZones: [{}]}]},
    },
  ],
  sceneTransitions: [{
    treatment: {type: 'cut', motivation: 'rhythmic', beatId: 'world-cut'},
  }],
};
const storyboard = {schemaVersion: 12};
const compiledStoryboard = {scenes: [{}, {}], sceneTransitions: project.sceneTransitions};
const timeline = {
  scenes: [
    {id: 'one', from: 0, motion: {proofTimes: [{id: 'one-a'}, {id: 'one-b'}]}},
    {id: 'two', from: 90, motion: {proofTimes: [{id: 'two-a'}, {id: 'two-b'}]}},
  ],
};
const media = {
  streams: [
    {codec_type: 'video', codec_name: 'h264', width: 960, height: 540, avg_frame_rate: '30/1'},
    {codec_type: 'audio', codec_name: 'aac'},
  ],
  format: {duration: '6.000'},
};

const build = (overrides = {}) => buildVoxSampleProofReport({
  contract,
  project,
  storyboard,
  compiledStoryboard,
  timeline,
  media,
  runtimeBuild: {fingerprint: digest},
  fingerprints: {project: digest, storyboard: digest, preview: digest, assets: {one: digest}},
  proofSamples: Array.from({length: 6}, (_, index) => ({frame: index})),
  artifacts: {preview: 'preview.mp4', contactSheet: 'contact-sheet.jpg'},
  generatedAt: '2026-07-23T00:00:00.000Z',
  ...overrides,
});

test('formal VOX proof binds media, v12 inputs, fingerprints, primitives, and the rhythmic boundary', () => {
  assert.equal(parseMediaFrameRate('30000/1000'), 30);
  const report = build();
  assert.equal(report.status, 'passed');
  assert.equal(report.boundary.frame, 90);
  assert.deepEqual(report.checks[0], {
    id: 'project-contract-v12',
    passed: true,
    expected: 12,
    actual: {project: 12, storyboard: 12},
  });
  assert.equal(report.checks.every(({passed}) => passed), true);
  assert.equal(assertVoxSampleProofPassed(report), report);
});

test('formal VOX proof fails when the encoded artifact drifts', () => {
  const report = build({
    media: {
      ...media,
      streams: [
        {...media.streams[0], width: 1280},
        media.streams[1],
      ],
    },
  });
  assert.equal(report.status, 'failed');
  assert.ok(report.checks.some(({id, passed}) => id === 'video-dimensions' && !passed));
  assert.throws(() => assertVoxSampleProofPassed(report), /video-dimensions/);
});
