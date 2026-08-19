import {AbsoluteFill, OffthreadVideo, staticFile} from 'remotion';

import type {LocalVideoSceneBinding} from './types';

export const LocalVideoScene: React.FC<{
  readonly localVideo: LocalVideoSceneBinding;
  readonly durationInFrames: number;
  readonly visualGenerationRoute: string | null;
}> = ({localVideo, durationInFrames, visualGenerationRoute}) => {
  if (visualGenerationRoute !== 'local-video-file') {
    throw new Error('LocalVideoScene requires visual_generation_route=local-video-file');
  }
  if (localVideo.contract_version !== 'local-video-match-v1'
    || localVideo.match_status !== 'matched'
    || localVideo.target_duration_frames !== durationInFrames
    || localVideo.media.width !== 1920
    || localVideo.media.height !== 1080
    || localVideo.audio_policy !== 'mute-source-audio-v1') {
    throw new Error('LocalVideoScene requires a matched 1920x1080 local-video binding');
  }
  return (
    <AbsoluteFill
      data-local-video-scene="local-video-match-v1"
      data-local-video-playback-rate={localVideo.playback_rate}
      style={{backgroundColor: '#000', overflow: 'hidden'}}
    >
      <OffthreadVideo
        src={staticFile(localVideo.asset)}
        playbackRate={localVideo.playback_rate}
        muted
        pauseWhenBuffering
        style={{width: '100%', height: '100%'}}
      />
    </AbsoluteFill>
  );
};
