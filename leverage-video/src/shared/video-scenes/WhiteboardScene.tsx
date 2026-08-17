import {AbsoluteFill, OffthreadVideo, Sequence, staticFile} from 'remotion';

import type {WhiteboardSceneBinding} from './types';

export const WhiteboardScene: React.FC<{
  readonly whiteboard: WhiteboardSceneBinding;
  readonly durationInFrames: number;
  readonly visualGenerationRoute: string | null;
}> = ({whiteboard, durationInFrames, visualGenerationRoute}) => {
  if (visualGenerationRoute !== 'srt-whiteboard-animation') {
    throw new Error('WhiteboardScene requires visual_generation_route=srt-whiteboard-animation');
  }
  if (whiteboard.contract_version !== 'whiteboard-scene-v1') {
    throw new Error('WhiteboardScene requires whiteboard-scene-v1');
  }
  let expectedSource = 0;
  let expectedOutput = 0;
  whiteboard.timing_segments.forEach((segment, index) => {
    if (segment.source_start_frame !== expectedSource
      || segment.output_start_frame !== expectedOutput
      || segment.source_end_frame <= segment.source_start_frame
      || segment.output_end_frame <= segment.output_start_frame) {
      throw new Error(`WhiteboardScene timing segments must be consecutive at index ${index}`);
    }
    expectedSource = segment.source_end_frame;
    expectedOutput = segment.output_end_frame;
  });
  if (expectedSource !== whiteboard.source_duration_frames || expectedOutput !== durationInFrames) {
    throw new Error('WhiteboardScene timing segments must cover source and output durations');
  }

  return (
    <AbsoluteFill
      data-whiteboard-scene="whiteboard-scene-v1"
      data-whiteboard-retiming={whiteboard.retiming_mode}
      style={{backgroundColor: '#F5EBD7', overflow: 'hidden'}}
    >
      {whiteboard.timing_segments.map((segment, index) => {
        const outputFrames = segment.output_end_frame - segment.output_start_frame;
        return (
          <Sequence
            key={`${segment.source_start_frame}-${segment.source_end_frame}-${index}`}
            from={segment.output_start_frame}
            durationInFrames={outputFrames}
            name={`whiteboard-segment-${index + 1}`}
          >
            <OffthreadVideo
              src={staticFile(whiteboard.clip.asset)}
              trimBefore={segment.source_start_frame}
              trimAfter={segment.source_end_frame}
              playbackRate={segment.playback_rate}
              muted
              pauseWhenBuffering
              style={{width: '100%', height: '100%', objectFit: 'cover'}}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
