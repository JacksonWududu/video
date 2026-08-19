import {AbsoluteFill, CanvasImage, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';

import {WatercolorBloomImage} from '../watercolor-bloom';
import {
  INTRA_SHOT_CUT_KIND,
  INTRA_SHOT_TRANSITION_VERSION,
  validateIntraShotTransitionSequence,
} from './contract.mjs';
import type {IntraShotTransitionV1} from './contract.mjs';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

export type IntraShotImageOccurrence = {
  readonly assetId: string;
  readonly src: string;
  readonly from: number;
  readonly durationInFrames: number;
};

export const IntraShotImageSequence: React.FC<{
  readonly occurrences: readonly IntraShotImageOccurrence[];
  readonly transitions: readonly IntraShotTransitionV1[];
  readonly backgroundSrc?: string;
  readonly firstOccurrenceContent?: React.ReactNode;
}> = ({occurrences, transitions, backgroundSrc, firstOccurrenceContent}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  validateIntraShotTransitionSequence({
    imageSequence: occurrences.map((occurrence) => ({
      asset_id: occurrence.assetId,
      from: occurrence.from,
      duration_in_frames: occurrence.durationInFrames,
    })),
    transitions,
    fps,
  });

  let occurrenceIndex = 0;
  for (let index = 1; index < occurrences.length; index += 1) {
    if (frame < occurrences[index].from) break;
    occurrenceIndex = index;
  }
  const active = occurrences[occurrenceIndex];
  const transition = occurrenceIndex === 0 ? null : transitions[occurrenceIndex - 1];
  const previous = occurrenceIndex === 0 ? null : occurrences[occurrenceIndex - 1];
  const localFrame = frame - active.from;
  const progress = !transition || transition.duration_in_frames <= 1
    ? 1
    : interpolate(
        localFrame,
        [0, transition.duration_in_frames - 1],
        [0, 1],
        clamp,
      );
  const renderActiveOccurrence = () => {
    if (occurrenceIndex === 0 && firstOccurrenceContent !== undefined) {
      return firstOccurrenceContent;
    }
    if (transition?.kind === 'watercolor-bloom') {
      if (!previous) throw new Error('watercolor-bloom requires a previous image occurrence');
      return (
        <>
          <CanvasImage
            src={previous.src}
            width={1920}
            height={1080}
            fit="fill"
            style={{position: 'absolute', inset: 0}}
          />
          <WatercolorBloomImage
            src={active.src}
            progress={progress}
            occurrenceIndex={occurrenceIndex}
          />
        </>
      );
    }
    if (transition === null || transition.kind === INTRA_SHOT_CUT_KIND) {
      return (
        <CanvasImage
          src={active.src}
          width={1920}
          height={1080}
          fit="fill"
          style={{position: 'absolute', inset: 0}}
        />
      );
    }
    throw new Error(`Unsupported intra-shot transition renderer: ${String(transition.kind)}`);
  };

  return (
    <AbsoluteFill
      data-intra-shot-transition-contract={INTRA_SHOT_TRANSITION_VERSION}
      data-intra-shot-transition-kind={transition?.kind ?? 'initial'}
      style={{backgroundColor: '#f5efe2'}}
    >
      {backgroundSrc ? (
        <CanvasImage
          src={backgroundSrc}
          width={1920}
          height={1080}
          fit="fill"
          style={{position: 'absolute', inset: 0}}
        />
      ) : null}
      {renderActiveOccurrence()}
    </AbsoluteFill>
  );
};
