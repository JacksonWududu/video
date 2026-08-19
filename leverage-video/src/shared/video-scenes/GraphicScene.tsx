import {staticFile} from 'remotion';

import {FullFrameMaskSweep} from '../full-frame-mask-sweep';
import {
  INTRA_SHOT_TRANSITION_VERSION,
  IntraShotImageSequence,
} from '../intra-shot-transitions';
import type {IntraShotTransitionV1} from '../intra-shot-transitions';
import {WatercolorImageSequence} from '../watercolor-bloom';
import type {ImageOccurrence, LegacyIntraShotWatercolorTransition} from './types';

export const GraphicScene: React.FC<{
  readonly imageSequence: readonly ImageOccurrence[];
  readonly intraShotTransitionContract: 'intra-shot-transition-v1' | 'intra-shot-watercolor-bloom-v1';
  readonly intraShotTransitions: readonly (IntraShotTransitionV1 | LegacyIntraShotWatercolorTransition)[];
  readonly durationInFrames: number;
  readonly visualGenerationRoute: string | null;
}> = ({
  imageSequence,
  intraShotTransitionContract,
  intraShotTransitions,
  durationInFrames,
  visualGenerationRoute,
}) => {
  const supportedRoutes = ['ian-handdrawn-ppt', 'ink-doodle-knowledge-card'];
  if (!visualGenerationRoute || !supportedRoutes.includes(visualGenerationRoute)) {
    throw new Error('GraphicScene requires an approved structured graphic route');
  }
  if (imageSequence.length === 0) {
    throw new Error('GraphicScene requires at least one approved structured raster');
  }
  let expectedFrom = 0;
  imageSequence.forEach((occurrence, index) => {
    if (occurrence.visual_generation_route !== visualGenerationRoute) {
      throw new Error(`GraphicScene image ${index} route must match its scene route`);
    }
    if (occurrence.from !== expectedFrom) {
      throw new Error(`GraphicScene image sequence must be consecutive at index ${index}`);
    }
    if (!Number.isInteger(occurrence.duration_in_frames) || occurrence.duration_in_frames < 1) {
      throw new Error(`GraphicScene image ${index} requires a positive integer duration`);
    }
    expectedFrom += occurrence.duration_in_frames;
  });
  if (expectedFrom !== durationInFrames) {
    throw new Error('GraphicScene image sequence must cover the complete scene duration');
  }

  const occurrences = imageSequence.map((occurrence) => ({
    src: staticFile(occurrence.asset),
    from: occurrence.from,
    durationInFrames: occurrence.duration_in_frames,
  }));
  const firstOccurrence = imageSequence[0];
  const firstOccurrenceContent = visualGenerationRoute === 'ian-handdrawn-ppt' ? (
    <FullFrameMaskSweep
      src={staticFile(firstOccurrence.asset)}
      durationInFrames={firstOccurrence.duration_in_frames}
    />
  ) : undefined;
  return intraShotTransitionContract === INTRA_SHOT_TRANSITION_VERSION ? (
    <IntraShotImageSequence
      occurrences={imageSequence.map((occurrence) => ({
        assetId: occurrence.asset_id,
        src: staticFile(occurrence.asset),
        from: occurrence.from,
        durationInFrames: occurrence.duration_in_frames,
      }))}
      transitions={intraShotTransitions as readonly IntraShotTransitionV1[]}
      firstOccurrenceContent={firstOccurrenceContent}
    />
  ) : intraShotTransitionContract === 'intra-shot-watercolor-bloom-v1' ? (
    <WatercolorImageSequence
      occurrences={occurrences}
      firstOccurrenceContent={firstOccurrenceContent}
    />
  ) : (() => {
    throw new Error(`Unsupported intra-shot transition contract: ${intraShotTransitionContract}`);
  })();
};
