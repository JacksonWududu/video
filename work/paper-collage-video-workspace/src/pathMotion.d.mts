import type {
  NormalizedProjectScene,
  PathMotion,
} from './project';

export type ResolvedPathMotion = {
  x: number;
  y: number;
  z: number;
  depthVelocity: number;
  depthDirection: 'planar' | 'toward-camera' | 'away-camera';
  projectionScale: number;
  projectionOpacity: number;
  projectionBlurPx: number;
  depthOrder: number;
  screenTangentLength: number;
  rotationDegrees: number;
  desiredRotationDegrees: number;
  headingDegrees: number;
  distance: number;
  pathLength: number;
};

export const angleDifferenceDegrees: (
  left: number,
  right: number,
) => number;

export const resolvePathMotionAtFrame: (input: {
  pathMotion?: PathMotion;
  frame: number;
  durationInFrames: number;
  fps: number;
  parentWidth?: number;
  parentHeight?: number;
}) => ResolvedPathMotion;

export const samplePathPolyline: (
  pathMotion: PathMotion,
  count?: number,
  parentWidth?: number,
  parentHeight?: number,
) => ResolvedPathMotion[];

export const validatePathMotion: (
  pathMotion: unknown,
) => Array<{code: string; message: string; location: string}>;

export const resolveCameraFollowAtFrame: (input: {
  scene: NormalizedProjectScene;
  video: {width: number; height: number};
  frame: number;
  fps: number;
}) =>
  | {
      x: number;
      y: number;
      zoom: number;
      targetPoint: {x: number; y: number};
    }
  | null;

export const validateCameraFollow: (input: {
  scene: NormalizedProjectScene;
  video: {width: number; height: number; fps: number};
}) => Array<{code: string; message: string; location: string}>;
