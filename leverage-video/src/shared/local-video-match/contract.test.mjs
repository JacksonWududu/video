import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLocalVideoMatchBinding,
  validateLocalVideoMatchBinding,
} from './contract.mjs';

const bindingInput = () => ({
  shotId: 'S03',
  selectedSourcePath: '/Users/jackson/Videos/source.mp4',
  archivedAsset: 'leverage-video/src/topic9/assets/video/user-source/s03-local-source-v01.mp4',
  checksumSha256: 'a'.repeat(64),
  media: {
    video_streams: 1,
    audio_streams: 1,
    width: 1920,
    height: 1080,
    codec: 'h264',
    rotation_degrees: 0,
    source_duration_seconds: 12,
    source_fps: 25,
    probe_result: 'pass',
    full_decode_result: 'pass',
  },
  targetDurationFrames: 180,
  fps: 30,
  approval: {
    status: 'approved',
    approved_checksum_sha256: 'a'.repeat(64),
    exact_message: '批准 S03 本地视频及 matched 预览',
    decided_at: '2026-08-18T12:00:00+08:00',
  },
});

test('maps the complete source duration to the exact target frame duration', () => {
  const binding = buildLocalVideoMatchBinding(bindingInput());
  assert.equal(binding.target_duration_seconds, 6);
  assert.equal(binding.playback_rate, 2);
  assert.equal(binding.match_status, 'matched');
  assert.equal(validateLocalVideoMatchBinding(binding, {
    shotId: 'S03', targetDurationFrames: 180, fps: 30,
  }).playback_rate, 2);
});

test('rejects stale target frames and nonconforming source media', () => {
  const binding = buildLocalVideoMatchBinding(bindingInput());
  assert.throws(() => validateLocalVideoMatchBinding(binding, {
    shotId: 'S03', targetDurationFrames: 181, fps: 30,
  }), /stale/);
  const invalid = bindingInput();
  invalid.media.width = 1080;
  invalid.media.height = 1920;
  assert.throws(() => buildLocalVideoMatchBinding(invalid), /1920x1080/);
});
