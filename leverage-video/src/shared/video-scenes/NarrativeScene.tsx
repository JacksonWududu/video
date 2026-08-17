import {AbsoluteFill, staticFile, useCurrentFrame} from 'remotion';

import {WatercolorImageSequence} from '../watercolor-bloom';
import type {RenderableImageOccurrence} from './types';

export const NarrativeScene: React.FC<{
  readonly imageSequence: readonly RenderableImageOccurrence[];
  readonly shotId: string;
}> = ({imageSequence, shotId}) => {
  if (imageSequence.length === 0) {
    throw new Error(`NarrativeScene requires at least one approved raster: ${shotId}`);
  }
  const frame = useCurrentFrame();
  const motionStartFrame = imageSequence.length > 1 ? 180 : 0;
  const motionFrame = Math.max(0, frame - motionStartFrame);
  const motionActive = frame >= motionStartFrame;
  const direction = Number(shotId.slice(1)) % 2 === 0 ? -1 : 1;
  const scale = motionActive ? 1.035 + 0.028 * (1 + Math.sin(motionFrame / 42)) / 2 : 1;
  const translateX = motionActive ? direction * 24 * Math.sin(motionFrame / 53) : 0;
  const translateY = motionActive ? 13 * Math.cos(motionFrame / 61) : 0;

  return (
    <AbsoluteFill
      data-narrative-motion="deterministic-narrative-detail-motion-v1"
      style={{
        overflow: 'hidden',
        transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`,
        transformOrigin: direction < 0 ? '42% 52%' : '58% 52%',
      }}
    >
      <WatercolorImageSequence
        occurrences={imageSequence.map((occurrence) => ({
          src: staticFile(occurrence.asset),
          from: occurrence.from,
          durationInFrames: occurrence.duration_in_frames,
        }))}
      />
    </AbsoluteFill>
  );
};
