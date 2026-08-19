#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

import {atomicWriteJson} from '../episode-tooling/file-integrity.mjs';

import {
  LOCAL_VIDEO_AUDIO_POLICY,
  LOCAL_VIDEO_FIT_POLICY,
  LOCAL_VIDEO_FRAME_POLICY,
  LOCAL_VIDEO_MATCH_CONTRACT_VERSION,
  LOCAL_VIDEO_ROUTE_ID,
  validateLocalVideoMediaEvidence,
} from './contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(HERE, '../../../..');

const sha256File = (filePath) => {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const count = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
};

const resolveRootRelative = (value, label) => {
  if (typeof value !== 'string' || value === '' || path.isAbsolute(value)
    || value.split('/').includes('..')) {
    throw new Error(`${label} must be root-relative and traversal-free`);
  }
  const resolved = path.resolve(REPOSITORY_ROOT, value);
  if (!resolved.startsWith(`${REPOSITORY_ROOT}${path.sep}`)) throw new Error(`${label} escapes repository root`);
  return resolved;
};

const readBoundJson = (binding, label) => {
  const filePath = resolveRootRelative(binding?.path, `${label} path`);
  const bytes = fs.readFileSync(filePath);
  const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
  if (checksum !== binding?.checksum_sha256) throw new Error(`${label} checksum is stale`);
  return JSON.parse(bytes);
};

const parseRate = (value) => {
  const [numerator, denominator] = String(value ?? '').split('/').map(Number);
  const rate = denominator ? numerator / denominator : Number(value);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
};

const run = (command, args, label) => {
  const result = spawnSync(command, args, {encoding: 'utf8', maxBuffer: 20 * 1024 * 1024});
  if (result.error?.code === 'ENOENT') throw new Error(`${command} is required for ${label}`);
  if (result.status !== 0) throw new Error(`${label} failed: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout;
};

export const probeLocalVideo = (sourcePath) => {
  const output = run('ffprobe', [
    '-v', 'error', '-show_streams', '-show_format', '-of', 'json', sourcePath,
  ], 'local video probe');
  const probe = JSON.parse(output);
  const videoStreams = (probe.streams ?? []).filter((stream) => stream.codec_type === 'video');
  const audioStreams = (probe.streams ?? []).filter((stream) => stream.codec_type === 'audio');
  const video = videoStreams[0] ?? {};
  const sideRotation = (video.side_data_list ?? [])
    .find((entry) => Number.isFinite(Number(entry.rotation)))?.rotation;
  const rotation = Number(sideRotation ?? video.tags?.rotate ?? 0);
  const duration = Number(video.duration ?? probe.format?.duration);
  const media = {
    video_streams: videoStreams.length,
    audio_streams: audioStreams.length,
    width: Number(video.width),
    height: Number(video.height),
    codec: video.codec_name,
    rotation_degrees: Number.isFinite(rotation) ? rotation : 0,
    source_duration_seconds: duration,
    source_fps: parseRate(video.avg_frame_rate ?? video.r_frame_rate),
    probe_result: 'pass',
    full_decode_result: 'pending',
  };
  run('ffmpeg', ['-v', 'error', '-i', sourcePath, '-map', '0:v:0', '-f', 'null', '-'], 'local video full decode');
  media.full_decode_result = 'pass';
  return validateLocalVideoMediaEvidence(media);
};

const nextVersionedPath = (directory, basename, extension) => {
  for (let version = 1; version < 10000; version += 1) {
    const candidate = path.join(
      directory,
      `${basename}-v${String(version).padStart(2, '0')}${extension}`,
    );
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`${basename} version space is exhausted`);
};

export const validateDeferredQueuePosition = (state, shotId) => {
  const review = state.visual_asset_review;
  const queue = (review?.queue ?? []).filter((item) => (
    item.active_for_current_storyboard !== false && item.status !== 'superseded'
  ));
  if (review?.mode !== 'hybrid_batch_v1' || review.active_batch != null
    || review.queue_generation_allowed === false) {
    throw new Error('local video import requires an open hybrid visual-asset queue');
  }
  let localSeen = false;
  for (const item of queue) {
    if (item.visual_generation_route === LOCAL_VIDEO_ROUTE_ID) localSeen = true;
    else if (localSeen) throw new Error('local video queue items must follow every generated visual');
  }
  const pending = queue.find((item) => !['approved', 'qa_passed_pending_batch_review'].includes(item.status));
  if (!pending || pending.shot_id !== shotId
    || pending.visual_generation_route !== LOCAL_VIDEO_ROUTE_ID
    || !['pending_generation', 'changes_requested'].includes(pending.status)) {
    throw new Error(`${shotId} is not the next deferred local-video import target`);
  }
  if (queue.some((item) => (
    item.visual_generation_route !== LOCAL_VIDEO_ROUTE_ID && item.status !== 'approved'
  ))) {
    throw new Error('all generated visual assets must be approved before local video import');
  }
  return pending;
};

export const buildImportPlan = ({episodeWorkspace, shotId, selectedPath, targetDurationFrames}) => {
  if (!/^S[0-9]{2,}$/.test(shotId)) throw new Error('shot ID must use canonical S numbering');
  if (!Number.isInteger(targetDurationFrames) || targetDurationFrames < 1) {
    throw new Error('target duration frames must be a positive integer');
  }
  if (!path.isAbsolute(selectedPath) || path.extname(selectedPath).toLowerCase() !== '.mp4') {
    throw new Error('selected local video must be an absolute .mp4 path');
  }
  const sourceStat = fs.lstatSync(selectedPath);
  if (sourceStat.isSymbolicLink() || !sourceStat.isFile() || sourceStat.size < 1) {
    throw new Error('selected local video must be a non-empty regular non-symlink file');
  }
  const workspacePath = resolveRootRelative(episodeWorkspace, 'episode workspace');
  const statePath = path.join(workspacePath, 'schema/episode-state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  if (state.workspace_path !== episodeWorkspace
    || !['visual_production', 'awaiting_visual_asset_review'].includes(state.current_phase)
    || state.storyboard_review?.status !== 'approved'
    || state.storyboard_review.active_checksum_sha256 !== state.storyboard_review.approved_checksum_sha256
    || state.storyboard_review.presented_checksum_sha256 !== state.storyboard_review.approved_checksum_sha256) {
    throw new Error('local video import requires the exact approved storyboard and visual-production phase');
  }
  const review = readBoundJson(state.visual_direction_review, 'visual direction review');
  const row = review.rows?.find((candidate) => candidate.shot_id === shotId);
  if (row?.user_selection?.status !== 'approved'
    || row.user_selection.visual_generation_route !== LOCAL_VIDEO_ROUTE_ID
    || path.resolve(row.user_selection.local_video_source_path ?? '') !== path.resolve(selectedPath)) {
    throw new Error(`${shotId} local video path is not the exact approved visual-direction selection`);
  }
  const queueItem = validateDeferredQueuePosition(state, shotId);
  const media = probeLocalVideo(selectedPath);
  const checksum = sha256File(selectedPath);
  const targetDurationSeconds = targetDurationFrames / 30;
  const playbackRate = media.source_duration_seconds / targetDurationSeconds;
  const archiveDirectory = path.join(workspacePath, 'assets/video/user-source');
  const archivePath = nextVersionedPath(
    archiveDirectory,
    `${shotId.toLowerCase()}-local-source`,
    '.mp4',
  );
  const archiveRelative = path.relative(REPOSITORY_ROOT, archivePath).split(path.sep).join('/');
  const manifestDirectory = path.join(workspacePath, 'schema');
  const manifestPath = nextVersionedPath(
    manifestDirectory,
    `${shotId.toLowerCase()}-local-video-import`,
    '.json',
  );
  const manifestRelative = path.relative(REPOSITORY_ROOT, manifestPath).split(path.sep).join('/');
  return {
    contract_version: 'local-video-source-import-v1',
    match_contract_version: LOCAL_VIDEO_MATCH_CONTRACT_VERSION,
    status: 'pending_exact_byte_visual_asset_review',
    episode_workspace: episodeWorkspace,
    shot_id: shotId,
    selected_source_path: selectedPath,
    source_checksum_sha256: checksum,
    archived_asset: archiveRelative,
    media,
    target_duration_frames: targetDurationFrames,
    target_duration_seconds: targetDurationSeconds,
    playback_rate: playbackRate,
    match_status: 'matched',
    frame_mapping_policy: LOCAL_VIDEO_FRAME_POLICY,
    fit_policy: LOCAL_VIDEO_FIT_POLICY,
    audio_policy: LOCAL_VIDEO_AUDIO_POLICY,
    storyboard_checksum_sha256: state.storyboard_review.approved_checksum_sha256,
    visual_direction_presented_map_sha256: review.presented_map_sha256,
    visual_asset_id: queueItem.asset_id,
    processing_order: 'deferred-after-generated-visuals-v1',
    manifest_path: manifestRelative,
  };
};

export const applyImportPlan = (plan) => {
  const archivePath = resolveRootRelative(plan.archived_asset, 'local video archive');
  const manifestPath = resolveRootRelative(plan.manifest_path, 'local video import manifest');
  const workspacePath = resolveRootRelative(plan.episode_workspace, 'episode workspace');
  const statePath = path.join(workspacePath, 'schema/episode-state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const queueItem = validateDeferredQueuePosition(state, plan.shot_id);
  if (queueItem.asset_id !== plan.visual_asset_id
    || state.storyboard_review?.approved_checksum_sha256 !== plan.storyboard_checksum_sha256) {
    throw new Error('local video import plan is stale against the active episode state');
  }
  fs.mkdirSync(path.dirname(archivePath), {recursive: true});
  if (fs.existsSync(archivePath) || fs.existsSync(manifestPath)) throw new Error('versioned local video output already exists');
  fs.copyFileSync(plan.selected_source_path, archivePath, fs.constants.COPYFILE_EXCL);
  if (sha256File(archivePath) !== plan.source_checksum_sha256) {
    fs.unlinkSync(archivePath);
    throw new Error('archived local video checksum mismatch');
  }
  fs.writeFileSync(manifestPath, `${JSON.stringify(plan, null, 2)}\n`, {flag: 'wx'});
  queueItem.status = 'awaiting_user_approval';
  queueItem.strict_review = true;
  queueItem.role = 'local-video-source';
  queueItem.path = plan.archived_asset;
  queueItem.selected_source_path = plan.selected_source_path;
  queueItem.checksum_sha256 = plan.source_checksum_sha256;
  queueItem.presented_checksum_sha256 = plan.source_checksum_sha256;
  queueItem.media = plan.media;
  queueItem.local_video_match = {
    contract_version: LOCAL_VIDEO_MATCH_CONTRACT_VERSION,
    target_duration_frames: plan.target_duration_frames,
    target_duration_seconds: plan.target_duration_seconds,
    playback_rate: plan.playback_rate,
    match_status: plan.match_status,
    frame_mapping_policy: plan.frame_mapping_policy,
    fit_policy: plan.fit_policy,
    audio_policy: plan.audio_policy,
  };
  queueItem.technical_qa = {
    result: 'pass',
    probe_result: plan.media.probe_result,
    full_decode_result: plan.media.full_decode_result,
    archived_checksum_verified: true,
    timing_match_verified: true,
  };
  queueItem.local_video_import_manifest = {
    path: plan.manifest_path,
    checksum_sha256: sha256File(manifestPath),
  };
  queueItem.processing_order = plan.processing_order;
  state.current_phase = 'awaiting_visual_asset_review';
  atomicWriteJson(statePath, state);
};

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const [episodeWorkspace, shotId, selectedPath, frameValue, mode] = process.argv.slice(2);
  if (!episodeWorkspace || !shotId || !selectedPath || !frameValue
    || !['--dry-run', '--apply'].includes(mode) || process.argv.length !== 7) {
    console.error('usage: import-local-video.mjs <episode-workspace> <shot-id> <absolute-source.mp4> <target-frames> <--dry-run|--apply>');
    process.exit(2);
  }
  try {
    const plan = buildImportPlan({
      episodeWorkspace,
      shotId,
      selectedPath,
      targetDurationFrames: Number(frameValue),
    });
    if (mode === '--apply') applyImportPlan(plan);
    process.stdout.write(`${JSON.stringify({...plan, mode}, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
