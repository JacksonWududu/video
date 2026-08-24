import {
  AbsoluteFill,
  CanvasImage,
  Easing,
  Interactive,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

import {
  getFullFrameMaskSweepTiming,
  shouldUseStaticFullFrame,
} from './timing';

export type FullFrameMaskSweepProps = {
  src: string;
  durationInFrames: number;
  backgroundColor?: string;
  layerName?: string;
};

export const FullFrameMaskSweep: React.FC<FullFrameMaskSweepProps> = ({
  src,
  durationInFrames,
  backgroundColor = '#fbfaf7',
  layerName = 'Full-frame mask sweep',
}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const {shouldAnimate, sweepFrames} = getFullFrameMaskSweepTiming({
    durationInFrames,
    fps,
  });

  if (shouldUseStaticFullFrame({shouldAnimate, frame, sweepFrames})) {
    return (
      <AbsoluteFill style={{backgroundColor, overflow: 'hidden'}}>
        <CanvasImage
          src={src}
          style={{
            position: 'absolute',
            inset: 0,
            width,
            height,
          }}
        />
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{backgroundColor, overflow: 'hidden'}}>
      <Interactive.Div
        name={layerName}
        style={{
          position: 'absolute',
          inset: 0,
          maskImage: 'linear-gradient(#000 0 0)',
          WebkitMaskImage: 'linear-gradient(#000 0 0)',
          maskSize: `${width}px ${height}px`,
          WebkitMaskSize: `${width}px ${height}px`,
          maskRepeat: 'no-repeat',
          WebkitMaskRepeat: 'no-repeat',
          maskPosition: interpolate(
            frame,
            [0, sweepFrames],
            [`-${width}px 0px`, '0px 0px'],
            {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
              easing: Easing.bezier(0.45, 0, 0.55, 1),
            },
          ),
          WebkitMaskPosition: interpolate(
            frame,
            [0, sweepFrames],
            [`-${width}px 0px`, '0px 0px'],
            {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
              easing: Easing.bezier(0.45, 0, 0.55, 1),
            },
          ),
        }}
      >
        <CanvasImage
          src={src}
          style={{
            position: 'absolute',
            inset: 0,
            width,
            height,
          }}
        />
      </Interactive.Div>
    </AbsoluteFill>
  );
};
