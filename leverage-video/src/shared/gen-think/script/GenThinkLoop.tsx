import React from 'react';
import {staticFile, useVideoConfig} from 'remotion';

import {WatercolorImageSequence} from '../../watercolor-bloom';

import {
  buildGenThinkSchedule,
  normalizeGenThinkDuration,
  type GenThinkStateId,
} from './timing';

export type GenThinkLoopProps = {
  readonly durationInFrames: number;
};

const DERIVATIVE_BY_STATE: Readonly<Record<GenThinkStateId, string>> = {
  'GEN-THINK-master-v04':
    'shared/gen-think/assets/image/gen-think-master-v04-1920x1080-v01.png',
  'GEN-THINK-action-01-v01':
    'shared/gen-think/assets/image/gen-think-action-01-v01-1920x1080-v01.png',
  'GEN-THINK-action-02-v02':
    'shared/gen-think/assets/image/gen-think-action-02-v02-1920x1080-v01.png',
  'GEN-THINK-action-03-v01':
    'shared/gen-think/assets/image/gen-think-action-03-v01-1920x1080-v01.png',
  'GEN-THINK-action-04-v01':
    'shared/gen-think/assets/image/gen-think-action-04-v01-1920x1080-v01.png',
};

export const GenThinkLoop: React.FC<GenThinkLoopProps> = ({durationInFrames}) => {
  const {fps} = useVideoConfig();
  const normalizedDuration = normalizeGenThinkDuration(durationInFrames);
  const schedule = buildGenThinkSchedule(normalizedDuration, fps);
  const occurrences = schedule.map((occurrence) => ({
    src: staticFile(DERIVATIVE_BY_STATE[occurrence.assetId]),
    from: occurrence.from,
    durationInFrames: occurrence.durationInFrames,
  }));

  return <WatercolorImageSequence occurrences={occurrences} />;
};
