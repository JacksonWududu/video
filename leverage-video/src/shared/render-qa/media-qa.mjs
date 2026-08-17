import {execFileSync} from 'node:child_process';

import {assertRegularFile, sha256File} from '../episode-tooling/file-integrity.mjs';

export const probeMedia = (file) => {
  const resolved = assertRegularFile(file, {nonEmpty: true});
  return JSON.parse(execFileSync('ffprobe', [
    '-v', 'error',
    '-count_frames',
    '-show_entries',
    'format=duration:stream=index,codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,nb_read_frames,sample_rate,channels',
    '-of', 'json',
    resolved,
  ], {encoding: 'utf8'}));
};

export const fullyDecodeMedia = (file) => {
  const resolved = assertRegularFile(file, {nonEmpty: true});
  execFileSync('ffmpeg', ['-v', 'error', '-i', resolved, '-f', 'null', '-'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {result: 'pass'};
};

export const validateVideo = (file, contract = {}) => {
  const media = probeMedia(file);
  const videoStreams = media.streams.filter((stream) => stream.codec_type === 'video');
  const audioStreams = media.streams.filter((stream) => stream.codec_type === 'audio');
  const subtitleStreams = media.streams.filter((stream) => stream.codec_type === 'subtitle');
  if (videoStreams.length !== 1) throw new Error('exactly one video stream required');
  const video = videoStreams[0];
  if (contract.codec && video.codec_name !== contract.codec) throw new Error(`unexpected video codec: ${video.codec_name}`);
  if (contract.width && video.width !== contract.width) throw new Error(`unexpected video width: ${video.width}`);
  if (contract.height && video.height !== contract.height) throw new Error(`unexpected video height: ${video.height}`);
  if (contract.fps && video.avg_frame_rate !== contract.fps) throw new Error(`unexpected video fps: ${video.avg_frame_rate}`);
  if (contract.frames && Number(video.nb_read_frames) !== contract.frames) {
    throw new Error(`unexpected decoded frames: ${video.nb_read_frames}`);
  }
  if (contract.requireAudio && audioStreams.length === 0) throw new Error('audio stream required');
  if (subtitleStreams.length !== 0) throw new Error('subtitle streams are forbidden');
  fullyDecodeMedia(file);
  return {
    result: 'pass',
    checksum_sha256: sha256File(file),
    video,
    audio_stream_count: audioStreams.length,
    subtitle_stream_count: subtitleStreams.length,
    full_decode_result: 'pass',
  };
};
