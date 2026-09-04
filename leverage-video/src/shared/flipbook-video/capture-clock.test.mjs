import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import test from 'node:test';
import {createFlipbookManifest} from './contract.mjs';
import {inferBrowserCaptureClock, measureBrowserCaptureClock} from './capture-clock.mjs';

const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const manifest = () => createFlipbookManifest({contract_version: 'knowledge-video-flipbook-v1',
  style_id: 'illustrated-flipbook', presentation_mode: 'illustrated-flipbook', layout_seed: 'capture-clock-test',
  canvas: {width: 1920, height: 1080, fps: 30}, total_frames: 180,
  narration: {path: 'fixtures/voice.wav', checksum_sha256: 'b'.repeat(64)},
  spreads: [{shot_id: 'S01', scene_class: 'concept', visual_generation_route: 'imagegen', white_cat_present: false,
    start_frame: 0, duration_frames: 180, image: {path: 'fixtures/image.png', checksum_sha256: 'a'.repeat(64), width: 1920, height: 1080},
    static_spread: {contract_version: 'knowledge-video-static-spread-v1', source_text: '合成测试。', source_text_sha256: sha('合成测试。')},
    text_reveals: [{id: 'body', source_start_byte: 0, source_end_byte: Buffer.byteLength('合成测试。'), start_frame: 0, end_frame: 6}],
    transition_out: null}]});
const fixture = () => {
  let seed = 17; let current = 0;
  const pts = [0];
  while (current < 6010) { seed = (seed * 1664525 + 1013904223) >>> 0; current += 25 + seed % 20; pts.push(current); }
  pts.push(6060);
  const value = manifest();
  const bytes = Buffer.from(JSON.stringify(value));
  const packets = pts.map((ms) => ({pts_time: (ms / 1000).toFixed(3), duration_time: '0.001'}));
  return {manifest: value, manifestChecksum: sha(bytes), packets,
    proof: {contract_version: 'knowledge-video-browser-recording-v1', manifest_checksum_sha256: sha(bytes), total_frames: 180,
      capture: {timing: {time_origin_ms: 1788000000000, timeline_zero_at_ms: 1000, recorder_start_called_at_ms: 1000, recorder_started_at_ms: 1151},
        frame_clock_samples: pts.map((ms, index) => ({method: 'HTMLVideoElement.requestVideoFrameCallback', presented_frames: index + 5,
          capture_at_ms: 925.2 + ms + (index % 11) / 10, callback_at_ms: 1100 + ms,
          media_time_seconds: ms / 1000 + 0.2 + Math.sin(index) * 0.005}))
          .filter((sample, index) => ![13, 51, 110].includes(index))},
      events: [{type: 'text-reveal', shot_id: 'S01', id: 'body', expected_frame: 0, actual_ms: 2}]}};
};

test('irregular encoded timestamps identify the source clock despite omitted callbacks and a different preview mediaTime', () => {
  const input = fixture();
  const result = inferBrowserCaptureClock(input);
  assert.ok(Math.abs(result.offset_seconds - 0.0743) < 0.0002);
  assert.equal(result.evidence.matched_packet_count, input.proof.capture.frame_clock_samples.length);
  assert.ok(result.evidence.packet_coverage > 0.95);
  assert.ok(result.evidence.max_residual_ms <= 0.7);
  assert.ok(result.evidence.competing_cluster_pairs < result.evidence.matched_packet_count * 0.9);
  assert.ok(result.pad_last_frame_seconds > 0 && result.pad_last_frame_seconds < 0.15);
  assert.ok(result.evidence.terminal_clean_hold.captured_frames_after_settle >= 2);
  input.proof.capture.timing.recorder_started_at_ms += 500;
  assert.equal(inferBrowserCaptureClock(input).offset_seconds, result.offset_seconds);
});

test('missing, stale, nonmonotonic or drifted source clocks fail instead of accepting start-event timing', () => {
  for (const mutate of [
    (value) => { delete value.proof.capture.frame_clock_samples; },
    (value) => { value.proof.manifest_checksum_sha256 = 'f'.repeat(64); },
    (value) => { value.proof.total_frames++; },
    (value) => { delete value.proof.capture.frame_clock_samples[0].capture_at_ms; },
    (value) => { value.proof.capture.frame_clock_samples[4].presented_frames = 1; },
    (value) => { value.proof.capture.frame_clock_samples[4].capture_at_ms += 4; },
    (value) => { value.proof.capture.frame_clock_samples.forEach((sample, index) => { sample.capture_at_ms += index / 100; }); },
  ]) { const input = fixture(); mutate(input); assert.throws(() => inferBrowserCaptureClock(input), /capture clock/); }
});

test('regular frame cadence is ambiguous and cannot authorize an arbitrary frame-shift trim', () => {
  const input = fixture();
  input.packets = Array.from({length: 180}, (_, index) => ({pts_time: index / 30, duration_time: 1 / 30}));
  input.proof.capture.frame_clock_samples = input.packets.map((packet, index) => ({method: 'HTMLVideoElement.requestVideoFrameCallback',
    presented_frames: index + 1, capture_at_ms: 925.7 + packet.pts_time * 1000,
    callback_at_ms: 1100 + packet.pts_time * 1000, media_time_seconds: packet.pts_time}));
  assert.throws(() => inferBrowserCaptureClock(input), /ambiguous/);
});

test('insufficient coverage and unobserved video endpoints cannot produce a clock proof', () => {
  const sparse = fixture(); sparse.proof.capture.frame_clock_samples.splice(10, 20);
  assert.throws(() => inferBrowserCaptureClock(sparse), /coverage/);
  const missingStart = fixture(); missingStart.proof.capture.frame_clock_samples.shift();
  assert.throws(() => inferBrowserCaptureClock(missingStart), /endpoints/);
  const missingEnd = fixture(); missingEnd.proof.capture.frame_clock_samples.pop();
  assert.throws(() => inferBrowserCaptureClock(missingEnd), /endpoints/);
});

test('missing real opening, large tail deficit and unfinished terminal text block padding', () => {
  const missingOpening = fixture();
  missingOpening.proof.capture.frame_clock_samples.forEach((sample) => { sample.capture_at_ms += 100; sample.callback_at_ms += 100; });
  assert.throws(() => inferBrowserCaptureClock(missingOpening), /opening/);
  const short = fixture();
  short.proof.capture.frame_clock_samples = short.proof.capture.frame_clock_samples.filter((sample) => sample.capture_at_ms < 6700);
  short.packets = short.packets.filter((packet) => Number(packet.pts_time) * 1000 < 6700 - 925.2);
  assert.throws(() => inferBrowserCaptureClock(short), /150 ms/);
  const incomplete = fixture();
  incomplete.manifest.spreads[0].text_reveals[0].end_frame = 180;
  incomplete.manifestChecksum = sha(JSON.stringify(incomplete.manifest));
  incomplete.proof.manifest_checksum_sha256 = incomplete.manifestChecksum;
  assert.throws(() => inferBrowserCaptureClock(incomplete), /animation was not complete/);
  const missingEvent = fixture(); missingEvent.proof.events = [];
  assert.throws(() => inferBrowserCaptureClock(missingEvent), /completion evidence/);
});

test('real capture drain covers the timeline without duplicating terminal pixels', () => {
  const input = fixture();
  input.manifest.total_frames = 165;
  input.manifest.spreads[0].duration_frames = 165;
  input.proof.total_frames = 165;
  input.manifestChecksum = sha(JSON.stringify(input.manifest));
  input.proof.manifest_checksum_sha256 = input.manifestChecksum;
  const result = inferBrowserCaptureClock(input);
  assert.equal(result.tail_gap_ms, 0);
  assert.equal(result.pad_last_frame_seconds, 0);
  assert.equal(result.evidence.terminal_clean_hold, null);
});

test('file entry probes an actual irregular WebM and binds exact video, proof and manifest bytes', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flipbook-capture-clock-'));
  try {
    const capturePath = path.join(directory, 'capture.webm');
    const manifestPath = path.join(directory, 'manifest.json');
    const proofPath = path.join(directory, 'recording-proof.json');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=32x18:rate=30:duration=6.3',
      '-vf', 'settb=1/1000,setpts=N*33+5*sin(N*1.717)', '-fps_mode', 'vfr', '-enc_time_base', '1/1000',
      '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-an', capturePath]);
    const packets = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_packets', '-show_entries', 'packet=pts_time,duration_time', '-of', 'json', capturePath])).packets;
    const input = fixture();
    input.proof.capture.frame_clock_samples = packets.map((packet, index) => ({method: 'HTMLVideoElement.requestVideoFrameCallback',
      presented_frames: index + 1, capture_at_ms: 925.7 + Number(packet.pts_time) * 1000,
      callback_at_ms: 1100 + Number(packet.pts_time) * 1000, media_time_seconds: Number(packet.pts_time)}));
    fs.writeFileSync(manifestPath, JSON.stringify(input.manifest));
    fs.writeFileSync(proofPath, JSON.stringify(input.proof));
    const measured = measureBrowserCaptureClock({capturePath, proofPath, manifestPath});
    assert.ok(Math.abs(measured.offset_seconds - 0.0743) < 1e-8);
    for (const [name, file] of [['capture', capturePath], ['proof', proofPath], ['manifest', manifestPath]]) {
      assert.equal(measured.evidence.inputs[name].checksum_sha256, sha(fs.readFileSync(file)));
    }
    fs.appendFileSync(manifestPath, '\n');
    assert.throws(() => measureBrowserCaptureClock({capturePath, proofPath, manifestPath}), /exact manifest bytes/);
  } finally { fs.rmSync(directory, {recursive: true, force: true}); }
});
