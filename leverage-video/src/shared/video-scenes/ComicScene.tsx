import {staticFile} from 'remotion';

import {WatercolorImageSequence} from '../watercolor-bloom';
import type {ComicShotPlan, ImageOccurrence} from './types';

export const ComicScene: React.FC<{
  readonly imageSequence: readonly ImageOccurrence[];
  readonly durationInFrames: number;
  readonly visualGenerationRoute: string;
  readonly comicPlan: ComicShotPlan;
}> = ({imageSequence, durationInFrames, visualGenerationRoute, comicPlan}) => {
  if (visualGenerationRoute !== 'comic-imagegen') {
    throw new Error('ComicScene requires visual_generation_route=comic-imagegen');
  }
  if (comicPlan?.contract_version !== 'comic-shot-plan-v1') {
    throw new Error('ComicScene requires comic-shot-plan-v1');
  }
  if (imageSequence.length === 0) throw new Error('ComicScene requires at least one approved PNG');

  let expectedFrom = 0;
  imageSequence.forEach((occurrence, index) => {
    if (occurrence.visual_generation_route !== 'comic-imagegen') {
      throw new Error(`ComicScene image ${index} requires visual_generation_route=comic-imagegen`);
    }
    if (!occurrence.asset.toLowerCase().endsWith('.png')) {
      throw new Error(`ComicScene image ${index} must be an approved 1920x1080 PNG`);
    }
    if (occurrence.width !== 1920 || occurrence.height !== 1080
      || occurrence.review_status !== 'approved'
      || occurrence.generator !== 'codex-native-imagegen') {
      throw new Error(`ComicScene image ${index} lacks approved native-imagegen evidence`);
    }
    if (occurrence.from !== expectedFrom) {
      throw new Error(`ComicScene image sequence must be consecutive at index ${index}`);
    }
    if (!Number.isInteger(occurrence.duration_in_frames) || occurrence.duration_in_frames < 1) {
      throw new Error(`ComicScene image ${index} requires a positive integer duration`);
    }
    expectedFrom += occurrence.duration_in_frames;
  });
  if (expectedFrom !== durationInFrames) {
    throw new Error('ComicScene image sequence must cover the complete scene duration');
  }
  if (imageSequence.at(-1)!.duration_in_frames < 15) {
    throw new Error('ComicScene final approved state must hold for at least 0.5 seconds at 30 fps');
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
