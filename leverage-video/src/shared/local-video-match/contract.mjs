import path from 'node:path';

export const LOCAL_VIDEO_ROUTE_ID = 'local-video-file';
export const LOCAL_VIDEO_MATCH_CONTRACT_VERSION = 'local-video-match-v1';
export const LOCAL_VIDEO_AUDIO_POLICY = 'mute-source-audio-v1';
export const LOCAL_VIDEO_FRAME_POLICY = 'complete-source-to-exact-shot-frames-v1';
export const LOCAL_VIDEO_FIT_POLICY = 'native-1920x1080-no-resize-crop-or-pad-v1';

const SHA256 = /^[a-f0-9]{64}$/;

const requirePositiveNumber = (value, label) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number`);
  }
  return value;
};

const requireRootRelativeAsset = (value, label) => {
  if (typeof value !== 'string' || value === '' || path.isAbsolute(value)
    || value.split('/').includes('..')) {
    throw new Error(`${label} must be a root-relative traversal-free path`);
  }
  if (path.extname(value).toLowerCase() !== '.mp4') {
    throw new Error(`${label} must be an .mp4 asset`);
  }
  return value;
};

export const validateLocalVideoMediaEvidence = (media) => {
  if (!media || typeof media !== 'object' || Array.isArray(media)) {
    throw new Error('local video media evidence is required');
  }
  if (media.video_streams !== 1 || media.width !== 1920 || media.height !== 1080
    || media.codec !== 'h264' || media.rotation_degrees !== 0) {
    throw new Error('local video must contain one unrotated 1920x1080 H.264 stream');
  }
  if (!Number.isInteger(media.audio_streams) || media.audio_streams < 0) {
    throw new Error('local video audio stream count is invalid');
  }
  requirePositiveNumber(media.source_duration_seconds, 'local video source duration');
  requirePositiveNumber(media.source_fps, 'local video source fps');
  if (media.probe_result !== 'pass' || media.full_decode_result !== 'pass') {
    throw new Error('local video probe and full decode must pass');
  }
  return media;
};

export const buildLocalVideoMatchBinding = ({
  shotId,
  selectedSourcePath,
  archivedAsset,
  checksumSha256,
  media,
  targetDurationFrames,
  fps = 30,
  approval,
}) => {
  if (typeof shotId !== 'string' || !/^S[0-9]{2,}$/.test(shotId)) {
    throw new Error('local video shot ID is invalid');
  }
  if (typeof selectedSourcePath !== 'string' || !path.isAbsolute(selectedSourcePath)
    || selectedSourcePath.includes('\0')) {
    throw new Error(`${shotId} selected local video path must be absolute`);
  }
  requireRootRelativeAsset(archivedAsset, `${shotId} archived local video`);
  if (!SHA256.test(checksumSha256 ?? '')) throw new Error(`${shotId} local video checksum is invalid`);
  if (fps !== 30 || !Number.isInteger(targetDurationFrames) || targetDurationFrames < 1) {
    throw new Error(`${shotId} local video target must use a positive 30 fps frame count`);
  }
  validateLocalVideoMediaEvidence(media);
  if (approval?.status !== 'approved'
    || approval.approved_checksum_sha256 !== checksumSha256
    || typeof approval.exact_message !== 'string' || approval.exact_message.trim() === ''
    || typeof approval.decided_at !== 'string' || approval.decided_at.trim() === '') {
    throw new Error(`${shotId} local video requires exact-byte approval evidence`);
  }
  const targetDurationSeconds = targetDurationFrames / fps;
  const playbackRate = media.source_duration_seconds / targetDurationSeconds;
  requirePositiveNumber(playbackRate, `${shotId} local video playback rate`);
  return Object.freeze({
    contract_version: LOCAL_VIDEO_MATCH_CONTRACT_VERSION,
    visual_generation_route: LOCAL_VIDEO_ROUTE_ID,
    shot_id: shotId,
    selected_source_path: selectedSourcePath,
    asset: archivedAsset,
    checksum_sha256: checksumSha256,
    media: {...media},
    target_duration_frames: targetDurationFrames,
    target_duration_seconds: targetDurationSeconds,
    playback_rate: playbackRate,
    match_status: 'matched',
    frame_mapping_policy: LOCAL_VIDEO_FRAME_POLICY,
    fit_policy: LOCAL_VIDEO_FIT_POLICY,
    audio_policy: LOCAL_VIDEO_AUDIO_POLICY,
    approval: {...approval},
  });
};

export const validateLocalVideoMatchBinding = (binding, {shotId, targetDurationFrames, fps = 30} = {}) => {
  if (binding?.contract_version !== LOCAL_VIDEO_MATCH_CONTRACT_VERSION
    || binding?.visual_generation_route !== LOCAL_VIDEO_ROUTE_ID) {
    throw new Error(`${shotId ?? 'shot'} local video match binding is required`);
  }
  const rebuilt = buildLocalVideoMatchBinding({
    shotId,
    selectedSourcePath: binding.selected_source_path,
    archivedAsset: binding.asset,
    checksumSha256: binding.checksum_sha256,
    media: binding.media,
    targetDurationFrames,
    fps,
    approval: binding.approval,
  });
  if (binding.target_duration_frames !== rebuilt.target_duration_frames
    || Math.abs(binding.target_duration_seconds - rebuilt.target_duration_seconds) > 1e-9
    || Math.abs(binding.playback_rate - rebuilt.playback_rate) > 1e-9
    || binding.match_status !== 'matched'
    || binding.frame_mapping_policy !== LOCAL_VIDEO_FRAME_POLICY
    || binding.fit_policy !== LOCAL_VIDEO_FIT_POLICY
    || binding.audio_policy !== LOCAL_VIDEO_AUDIO_POLICY) {
    throw new Error(`${shotId} local video match timing or policy is stale`);
  }
  return rebuilt;
};
