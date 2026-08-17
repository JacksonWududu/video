import {staticFile} from 'remotion';

import {WatercolorImageSequence} from '../watercolor-bloom';
import type {ImageOccurrence} from './types';

export const DoodleScene: React.FC<{
  readonly imageSequence: readonly ImageOccurrence[];
  readonly durationInFrames: number;
  readonly visualGenerationRoute: string;
}> = ({imageSequence, durationInFrames, visualGenerationRoute}) => {
  if (visualGenerationRoute !== 'doodle-slides') {
    throw new Error('DoodleScene requires visual_generation_route=doodle-slides');
  }
  if (imageSequence.length === 0) throw new Error('DoodleScene requires at least one approved PNG');

  let expectedFrom = 0;
  imageSequence.forEach((occurrence, index) => {
    if (occurrence.visual_generation_route !== 'doodle-slides') {
      throw new Error(`DoodleScene image ${index} requires visual_generation_route=doodle-slides`);
    }
    if (!occurrence.asset.toLowerCase().endsWith('.png')) {
      throw new Error(`DoodleScene image ${index} must be an approved PNG`);
    }
    if (occurrence.from !== expectedFrom) {
      throw new Error(`DoodleScene image sequence must be consecutive at index ${index}`);
    }
    if (!Number.isInteger(occurrence.duration_in_frames) || occurrence.duration_in_frames < 1) {
      throw new Error(`DoodleScene image ${index} requires a positive integer duration`);
    }
    expectedFrom += occurrence.duration_in_frames;
  });
  if (expectedFrom !== durationInFrames) {
    throw new Error('DoodleScene image sequence must cover the complete scene duration');
  }

  return (
    <WatercolorImageSequence
      occurrences={imageSequence.map((occurrence) => ({
        src: staticFile(occurrence.asset),
        from: occurrence.from,
        durationInFrames: occurrence.duration_in_frames,
      }))}
    />
  );
};
