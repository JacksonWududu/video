import React from 'react';
import {Composition} from 'remotion';

import {GenThinkLoop} from './GenThinkLoop';
import {normalizeGenThinkDuration} from './timing';

export const GenThinkRoot: React.FC = () => (
  <Composition
    id="GenThinkLoop"
    component={GenThinkLoop}
    durationInFrames={300}
    fps={30}
    width={1920}
    height={1080}
    defaultProps={{durationInFrames: 300}}
    calculateMetadata={({props}) => ({
      durationInFrames: normalizeGenThinkDuration(props.durationInFrames),
    })}
  />
);
