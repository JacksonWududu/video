import {AbsoluteFill, staticFile, useCurrentFrame} from 'remotion';

import {
  INTRA_SHOT_TRANSITION_VERSION,
  IntraShotImageSequence,
} from '../intra-shot-transitions';
import {WatercolorImageSequence} from '../watercolor-bloom';
import type {
  LegacyIntraShotWatercolorTransition,
  RenderableImageOccurrence,
} from './types';
import type {IntraShotTransitionV1} from '../intra-shot-transitions';

export const NarrativeScene: React.FC<{
  readonly imageSequence: readonly RenderableImageOccurrence[];
  readonly intraShotTransitionContract: 'intra-shot-transition-v1' | 'intra-shot-watercolor-bloom-v1';
  readonly intraShotTransitions: readonly (IntraShotTransitionV1 | LegacyIntraShotWatercolorTransition)[];
  readonly heroPoseBackground?: string | null;
  readonly shotId: string;
}> = ({
  imageSequence,
  intraShotTransitionContract,
  intraShotTransitions,
  heroPoseBackground = null,
  shotId,
}) => {
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
      {intraShotTransitionContract === INTRA_SHOT_TRANSITION_VERSION ? (
        <IntraShotImageSequence
          occurrences={imageSequence.map((occurrence) => ({
            assetId: occurrence.asset_id,
            src: staticFile(occurrence.asset),
            from: occurrence.from,
            durationInFrames: occurrence.duration_in_frames,
          }))}
          transitions={intraShotTransitions as readonly IntraShotTransitionV1[]}
          backgroundSrc={heroPoseBackground ? staticFile(heroPoseBackground) : undefined}
        />
      ) : intraShotTransitionContract === 'intra-shot-watercolor-bloom-v1' ? (
        <WatercolorImageSequence
          occurrences={imageSequence.map((occurrence) => ({
            src: staticFile(occurrence.asset),
            from: occurrence.from,
            durationInFrames: occurrence.duration_in_frames,
          }))}
        />
      ) : (() => {
        throw new Error(`Unsupported intra-shot transition contract: ${intraShotTransitionContract}`);
      })()}
    </AbsoluteFill>
  );
};
