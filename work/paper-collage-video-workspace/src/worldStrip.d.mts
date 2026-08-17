export declare const WORLD_STRIP_MIN_VIEWPORT_SPAN: 1;
export declare const WORLD_STRIP_DEFAULT_VIEWPORT_SPAN: 1.5;
export declare const WORLD_STRIP_MAX_OVERSCAN_PX: 16;
export declare const WORLD_STRIP_RASTER_OVERLAP_PX: 0.5;

export declare const positiveModulo: (value: number, modulus: number) => number;

export declare const resolveWorldStripSpeedFactor: (input: {
  depth: number;
  far: number;
  near: number;
}) => number;

export declare const resolveWorldStripTileGeometry: (input: {
  viewportWidth: number;
  viewportHeight: number;
  renderHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  overscanPx?: number;
}) => {
  tileWidth: number;
  tileHeight: number;
  viewportSpan: number;
  copyCount: number;
};

export declare const resolveWorldStripFrame: (input: {
  progress: number;
  viewportWidth: number;
  tileWidth: number;
  direction: 'left' | 'right';
  distanceViewports: number;
  speedFactor: number;
  startPhase?: number;
  activeFrom?: number;
  activeUntil?: number;
  easing?: 'linear' | 'ease-out';
  overscanPx?: number;
  phaseOffsetPx?: number;
}) => {
  phase: number;
  phaseNormalized: number;
  unwrappedPhase: number;
  renderUnwrappedPhase: number;
  firstCopyX: number;
  cameraCompensatedDisplacement: number;
  travelProgress: number;
  wraps: number;
};

export declare const resolveWorldStripCopies: (input: {
  firstCopyX: number;
  tileWidth: number;
  copyCount: number;
  overlapPx?: number;
}) => Array<{index: number; x: number; width: number}>;

export declare const inspectWorldStripCoverage: (input: {
  copies: Array<{x: number; width: number}>;
  viewportWidth: number;
  tolerancePx?: number;
}) => {
  passed: boolean;
  uncoveredPixels: number;
  maximumGap: number;
  coveredUntil: number;
};

export declare const validateClosedWorldStripLoop: (input: {
  distanceViewports: number;
  viewportWidth: number;
  speedFactor: number;
  tileWidth: number;
  tolerance?: number;
}) => {
  passed: boolean;
  periods: number;
  nearestPeriod: number;
  phaseError: number;
};
