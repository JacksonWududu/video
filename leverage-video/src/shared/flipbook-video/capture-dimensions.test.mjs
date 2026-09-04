import assert from 'node:assert/strict';
import test from 'node:test';
import {validateCapturedMediaDimensions} from './serve-flipbook.mjs';

const media = {streams: [{codec_type: 'video', width: 3024, height: 1700}]};
const proof = {capture: {width: 3024, height: 1700, observed_frame: {width: 3024, height: 1700},
  initial_track_settings: {width: 3024, height: 1964}, settled_track_settings: {width: 3024, height: 1700}}};

test('encoded dimensions match the actual decoded frame and ignore transitional device settings', () => {
  assert.equal(validateCapturedMediaDimensions(media, proof), media.streams[0]);
  const diagnosticOnly = structuredClone(proof);
  diagnosticOnly.capture.settled_track_settings.height = 1964;
  assert.equal(validateCapturedMediaDimensions(media, diagnosticOnly), media.streams[0]);
});

test('encoded dimensions cannot disagree with the proof or the decoded frame', () => {
  for (const mutate of [
    (value) => { value.capture.height = 1964; },
    (value) => { value.capture.observed_frame.height = 1964; },
    (value) => { delete value.capture.observed_frame; },
  ]) {
    const changed = structuredClone(proof); mutate(changed);
    assert.throws(() => validateCapturedMediaDimensions(media, changed), /encoded browser capture dimensions differ/);
  }
});

test('actual capture still requires one silent native 1080p video stream', () => {
  for (const streams of [[], [...media.streams, {codec_type: 'audio'}], [...media.streams, ...media.streams],
    [{codec_type: 'video', width: 1280, height: 720}]]) {
    assert.throws(() => validateCapturedMediaDimensions({streams}, proof), /native 1080p-or-larger silent video stream/);
  }
});
