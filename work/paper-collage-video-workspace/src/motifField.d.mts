export type MotifFieldInstance = {
  id: string;
  src: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  phase: number;
};

export type MotifFieldBounds = {x: number; y: number; width: number; height: number};
export type MotifFieldExclusionZone = MotifFieldBounds & {
  id: string;
  shape: 'rectangle' | 'ellipse';
  padding?: number;
};

export declare const MAX_MOTIF_INSTANCES_PER_FIELD: 64;
export declare const MAX_MOTIF_INSTANCES_PER_SCENE: 192;
export declare const MAX_MOTIF_PLACEMENT_ATTEMPTS: 256;

export declare const isPointInsideMotifExclusion: (
  point: {x: number; y: number},
  zone: MotifFieldExclusionZone,
  clearance?: number,
) => boolean;

export declare const resolveMotifFieldInstances: (
  node: {
    id: string;
    seed: number;
    count: number;
    motifs: Array<{id: string; src: string}>;
    distribution: 'scattered' | 'grid' | 'edge';
    bounds: MotifFieldBounds;
    exclusionZones: MotifFieldExclusionZone[];
    baseSize: number;
    variation: {
      scale: [number, number];
      rotation: [number, number];
      opacity: [number, number];
    };
  },
) => MotifFieldInstance[];

export declare const resolveMotifFieldMotion: (input: {
  instance: MotifFieldInstance;
  preset: 'drift' | 'fall-drift' | 'rise-drift' | 'burst' | 'orbit';
  progress: number;
  cycles: number;
  horizontalAmplitude?: number;
}) => {x: number; y: number; rotation: number; scale: number; opacity: number};

export declare const resolveWorldBoundMotifX: (input: {
  instanceX: number;
  localOffsetX: number;
  worldDisplacementPx: number;
  viewportWidth: number;
  bounds: MotifFieldBounds;
}) => number;

export declare const verifyMotifFieldLoop: (input: {
  preset: 'drift' | 'fall-drift' | 'rise-drift' | 'burst' | 'orbit';
  cycles: number;
}) => {passed: boolean; transformDelta: number; edgeOpacity: number};
