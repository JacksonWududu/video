export const FULL_FRAME_MASK_HOLD_SECONDS = 3;

export type FullFrameMaskSweepTiming = {
  shouldAnimate: boolean;
  holdFrames: number;
  sweepFrames: number;
  holdStartFrame: number;
  holdEndFrame: number;
};

export const shouldUseStaticFullFrame = ({
  shouldAnimate,
  frame,
  sweepFrames,
}: {
  shouldAnimate: boolean;
  frame: number;
  sweepFrames: number;
}): boolean => !shouldAnimate || frame >= sweepFrames;

export const getFullFrameMaskSweepTiming = ({
  durationInFrames,
  fps,
}: {
  durationInFrames: number;
  fps: number;
}): FullFrameMaskSweepTiming => {
  if (!Number.isInteger(durationInFrames) || durationInFrames <= 0) {
    throw new Error('durationInFrames must be a positive integer.');
  }

  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error('fps must be a positive number.');
  }

  const holdFrames = Math.round(fps * FULL_FRAME_MASK_HOLD_SECONDS);

  if (durationInFrames <= holdFrames) {
    return {
      shouldAnimate: false,
      holdFrames: durationInFrames,
      sweepFrames: 0,
      holdStartFrame: 0,
      holdEndFrame: durationInFrames - 1,
    };
  }

  const sweepFrames = durationInFrames - holdFrames;

  return {
    shouldAnimate: true,
    holdFrames,
    sweepFrames,
    holdStartFrame: sweepFrames,
    holdEndFrame: durationInFrames - 1,
  };
};
