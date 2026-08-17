import {staticFile} from 'remotion';

import {FullFrameMaskSweep} from '../full-frame-mask-sweep';
import {WatercolorImageSequence} from '../watercolor-bloom';
import type {ImageOccurrence} from './types';

export const GraphicScene: React.FC<{
  readonly imageSequence: readonly ImageOccurrence[];
  readonly durationInFrames: number;
  readonly visualGenerationRoute: string | null;
}> = ({imageSequence, durationInFrames, visualGenerationRoute}) => {
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
  return (
    <WatercolorImageSequence
      occurrences={occurrences}
      firstOccurrenceContent={visualGenerationRoute === 'ian-handdrawn-ppt' ? (
        <FullFrameMaskSweep
          src={staticFile(firstOccurrence.asset)}
          durationInFrames={firstOccurrence.duration_in_frames}
        />
      ) : undefined}
    />
  );
};
