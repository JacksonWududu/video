export type IanMotionPoint = {
  scale: number;
  x_px: number;
  y_px: number;
};

export type IanSubtleRasterMotion = {
  mode: 'single_segment';
  start: IanMotionPoint;
  end: IanMotionPoint;
  easing: 'ease-in-out';
  origin: 'center';
};

export const IAN_STATIC_FULL_FRAME_CONTRACT: 'ian-static-full-frame-v1';
export const IAN_SUBTLE_RASTER_MOTION_CONTRACT: 'ian-subtle-raster-motion-v1';

export function validateIanSceneMotion(input: {
  shotId: string;
  internalMotionContract:
    | typeof IAN_STATIC_FULL_FRAME_CONTRACT
    | typeof IAN_SUBTLE_RASTER_MOTION_CONTRACT;
  internalMotion?: IanSubtleRasterMotion | null;
}): {
  internal_motion_contract:
    | typeof IAN_STATIC_FULL_FRAME_CONTRACT
    | typeof IAN_SUBTLE_RASTER_MOTION_CONTRACT;
  internal_motion: IanSubtleRasterMotion | null;
};
