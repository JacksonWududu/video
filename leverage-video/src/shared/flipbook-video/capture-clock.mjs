import crypto from 'node:crypto';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {RECORDING_VERSION, validateFlipbookManifest} from './contract.mjs';

const fail = (message) => { throw new Error(`capture clock: ${message}`); };
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const hashFile = (file) => {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(file, 'r');
  const chunk = Buffer.alloc(1024 * 1024);
  try {
    let length;
    while ((length = fs.readSync(descriptor, chunk, 0, chunk.length, null))) hash.update(chunk.subarray(0, length));
    return hash.digest('hex');
  } finally { fs.closeSync(descriptor); }
};
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const lowerBound = (values, target) => {
  let lo = 0; let hi = values.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (values[mid] < target) lo = mid + 1; else hi = mid; }
  return lo;
};
// WebM has a 1 ms timebase here; captureTime is exposed to 0.1 ms precision.
const CLUSTER_WIDTH_MS = 1.3;
const MAX_RESIDUAL_MS = 0.7;
const MAX_ORIGIN_DISTANCE_MS = 1000;

export const inferBrowserCaptureClock = ({proof, manifest, manifestChecksum, packets}) => {
  validateFlipbookManifest(manifest);
  if (!/^[a-f0-9]{64}$/.test(manifestChecksum ?? '') || proof?.contract_version !== RECORDING_VERSION
    || proof.manifest_checksum_sha256 !== manifestChecksum || proof.total_frames !== manifest.total_frames) {
    fail('proof must bind the exact manifest bytes and frame count');
  }
  const timing = proof.capture?.timing;
  const epoch = timing?.timeline_zero_at_ms;
  if (!Number.isFinite(epoch) || epoch < 0 || !Number.isFinite(timing.time_origin_ms) || timing.time_origin_ms <= 0
    || timing.recorder_start_called_at_ms !== epoch) fail('explicit common timeline/start-call epoch required');
  const samples = proof.capture?.frame_clock_samples;
  if (!Array.isArray(samples) || samples.length < 30) fail('at least 30 real source frame clock samples required');
  for (const [index, sample] of samples.entries()) {
    const prior = samples[index - 1];
    if (sample.method !== 'HTMLVideoElement.requestVideoFrameCallback'
      || !Number.isFinite(sample.capture_at_ms) || !Number.isFinite(sample.media_time_seconds)
      || !Number.isFinite(sample.callback_at_ms) || sample.capture_at_ms > sample.callback_at_ms
      || !Number.isInteger(sample.presented_frames) || sample.presented_frames < 1
      || (prior && (sample.capture_at_ms <= prior.capture_at_ms || sample.media_time_seconds <= prior.media_time_seconds
        || sample.presented_frames <= prior.presented_frames))) fail('finite monotonic source capture timestamps required');
  }
  if (!Array.isArray(packets) || packets.length < samples.length) fail('source video packet timestamps required');
  const pts = packets.map((packet) => Number(packet.pts_time) * 1000);
  if (pts[0] !== 0 || pts.some((value, index) => !Number.isFinite(value) || (index && value <= pts[index - 1]))) {
    fail('strictly increasing WebM packet PTS beginning at zero required');
  }
  if (samples.length / pts.length < 0.95) fail('source callback coverage is below 95% of video packets');

  // Search every plausible source/packet pairing, not a wall-clock start event or a frame-index guess.
  const differences = [];
  for (const sample of samples) {
    const first = lowerBound(pts, sample.capture_at_ms - epoch - MAX_ORIGIN_DISTANCE_MS);
    for (let index = first; index < pts.length && pts[index] <= sample.capture_at_ms - epoch + MAX_ORIGIN_DISTANCE_MS; index++) {
      differences.push(sample.capture_at_ms - pts[index]);
    }
  }
  differences.sort((a, b) => a - b);
  const clusters = [];
  let left = 0;
  for (let right = 0; right < differences.length; right++) {
    while (differences[right] - differences[left] > CLUSTER_WIDTH_MS + 1e-7) left++;
    clusters.push({count: right - left + 1, center: (differences[right] + differences[left]) / 2});
  }
  clusters.sort((a, b) => b.count - a.count || a.center - b.center);
  const best = clusters[0];
  if (!best || best.count < samples.length) fail('no complete timestamp fingerprint match within 1.3 ms');
  const runnerUp = clusters.find((row) => Math.abs(row.center - best.center) > CLUSTER_WIDTH_MS * 2);
  if (runnerUp && runnerUp.count >= samples.length * 0.9) fail('timestamp origin is ambiguous; a competing frame alignment remains');
  const matches = samples.map((sample) => {
    const expected = sample.capture_at_ms - best.center;
    const upper = lowerBound(pts, expected);
    const indexes = [...new Set([Math.max(0, upper - 1), Math.min(pts.length - 1, upper)])];
    const near = indexes.filter((index) => Math.abs(pts[index] - expected) <= MAX_RESIDUAL_MS);
    if (near.length !== 1) fail('each source frame must match one unambiguous packet');
    return near[0];
  });
  if (matches[0] !== 0 || matches.at(-1) !== pts.length - 1
    || matches.some((value, index) => index && value <= matches[index - 1])) fail('one-to-one ordered matching must cover both video endpoints');
  const origins = samples.map((sample, index) => sample.capture_at_ms - pts[matches[index]]);
  const origin = median(origins);
  const residual = Math.max(...origins.map((value) => Math.abs(value - origin)));
  if (residual > MAX_RESIDUAL_MS + 1e-7) fail('capture/packet clock residual exceeds 0.7 ms');
  const offsetMs = epoch - origin;
  if (offsetMs < 0 || offsetMs > MAX_ORIGIN_DISTANCE_MS) fail('recording lacks the real timeline opening or exceeds supported preroll');

  const durationMs = manifest.total_frames / 30 * 1000;
  const lastCaptureTimelineMs = samples.at(-1).capture_at_ms - epoch;
  const tailGapMs = Math.max(0, durationMs - lastCaptureTimelineMs);
  const packetDurationMs = Number(packets.at(-1).duration_time ?? 0) * 1000;
  if (!Number.isFinite(packetDurationMs) || packetDurationMs < 0) fail('invalid last packet duration');
  const packetTailGapMs = Math.max(0, durationMs + offsetMs - pts.at(-1) - packetDurationMs);
  let terminalHold = null;
  if (tailGapMs > 0 || packetTailGapMs > 0) {
    if (Math.max(tailGapMs, packetTailGapMs) > 150) fail('captured terminal duration is short by more than 150 ms');
    const lastSpread = manifest.spreads.at(-1);
    let settledMs = lastSpread.start_frame / 30 * 1000;
    if (lastSpread.transition_out != null) fail('tail padding requires terminal clean hold without an outgoing turn');
    for (const reveal of lastSpread.text_reveals) {
      const events = proof.events?.filter((event) => event.type === 'text-reveal' && event.shot_id === lastSpread.shot_id && event.id === reveal.id);
      if (events?.length !== 1 || events[0].expected_frame !== reveal.start_frame || !Number.isFinite(events[0].actual_ms)
        || Math.abs(events[0].actual_ms - reveal.start_frame / 30 * 1000) > 100) fail('terminal text reveal completion evidence required');
      settledMs = Math.max(settledMs, events[0].actual_ms + (reveal.end_frame - reveal.start_frame) / 30 * 1000);
    }
    if (manifest.spreads.length > 1 || manifest.opening_cover) {
      const eventType = manifest.spreads.length > 1 ? 'renderer-turn-complete' : 'renderer-cover-open-complete';
      const complete = proof.events?.filter((event) => event.type === eventType).at(-1);
      if (!Number.isFinite(complete?.actual_ms) || Math.abs(complete.actual_ms - lastSpread.start_frame / 30 * 1000) > 100) {
        fail('terminal page renderer completion evidence required');
      }
      settledMs = Math.max(settledMs, complete.actual_ms);
    }
    // These are actual captured source frames after all terminal animations, not start callbacks.
    const settledFrames = samples.filter((sample) => sample.capture_at_ms - epoch >= settledMs + 1000 / 30);
    if (settledFrames.length < 2) fail('terminal text/turn animation was not complete in captured source frames');
    if (proof.events?.some((event) => ['page-turn', 'cover-open'].includes(event.type) && event.actual_ms > settledMs)) {
      fail('a later page motion prevents terminal clean hold');
    }
    terminalHold = {shot_id: lastSpread.shot_id, settled_at_timeline_ms: settledMs,
      captured_frames_after_settle: settledFrames.length, outgoing_transition: null,
      restriction: 'Hold only the final real frame; existing visual QA still applies.'};
  }
  const evidence = {contract_version: 'knowledge-video-capture-clock-v1', manifest_checksum_sha256: manifestChecksum,
    method: 'source-capture-time-to-webm-packet-pts', time_origin_ms: timing.time_origin_ms,
    timeline_zero_at_ms: epoch, webm_zero_at_ms: origin, offset_seconds: offsetMs / 1000,
    source_sample_count: samples.length, packet_count: pts.length, matched_packet_count: matches.length,
    packet_coverage: samples.length / pts.length, max_residual_ms: residual,
    cluster_width_ms: CLUSTER_WIDTH_MS, competing_cluster_pairs: runnerUp?.count ?? 0,
    origin_range_ms: [Math.min(...origins), Math.max(...origins)],
    last_capture_timeline_ms: lastCaptureTimelineMs, tail_gap_ms: tailGapMs,
    last_packet_pts_ms: pts.at(-1), packet_tail_gap_ms: packetTailGapMs,
    pad_last_frame_seconds: Math.max(tailGapMs, packetTailGapMs) / 1000, terminal_clean_hold: terminalHold};
  return {offset_seconds: evidence.offset_seconds, tail_gap_ms: tailGapMs,
    pad_last_frame_seconds: evidence.pad_last_frame_seconds, evidence};
};

export const measureBrowserCaptureClock = ({capturePath, proofPath, manifestPath}) => {
  const manifestBytes = fs.readFileSync(manifestPath);
  const proofBytes = fs.readFileSync(proofPath);
  const captureBefore = fs.statSync(capturePath);
  const captureChecksum = hashFile(capturePath);
  const measured = JSON.parse(execFileSync('ffprobe', ['-v', 'error',
    '-show_packets', '-show_streams', '-show_entries', 'stream=codec_type,codec_name,time_base:packet=pts_time,duration_time',
    '-of', 'json', capturePath], {encoding: 'utf8', maxBuffer: 32 * 1024 * 1024}));
  const captureAfter = fs.statSync(capturePath);
  if (captureBefore.size !== captureAfter.size || captureBefore.mtimeMs !== captureAfter.mtimeMs
    || captureBefore.ino !== captureAfter.ino) fail('source capture changed during clock measurement');
  if (measured.streams?.length !== 1 || measured.streams[0].codec_type !== 'video' || measured.streams[0].time_base !== '1/1000'
    || !['vp8', 'vp9'].includes(measured.streams[0].codec_name)) fail('one supported WebM video stream with 1 ms timebase required');
  const result = inferBrowserCaptureClock({proof: JSON.parse(proofBytes), manifest: JSON.parse(manifestBytes),
    manifestChecksum: digest(manifestBytes), packets: measured.packets});
  result.evidence.inputs = {capture: {path: capturePath, checksum_sha256: captureChecksum},
    proof: {path: proofPath, checksum_sha256: digest(proofBytes)}, manifest: {path: manifestPath, checksum_sha256: digest(manifestBytes)}};
  return result;
};
