export type ParallaxConfig = {
  enabled: boolean;
  strength: number;
  focalDepth: number;
};

export declare const resolveParallaxState: (input?: {
  depth?: number;
  cameraX?: number;
  cameraY?: number;
  cameraZoom?: number;
  parallax?: ParallaxConfig;
}) => {x: number; y: number; scale: number};

export declare const collectParallaxDepths: (
  nodes?: unknown[],
) => Array<{id?: string; kind?: string; depth: number}>;

export declare const cameraHasVisibleMovement: (camera?: unknown) => boolean;

export declare const validateParallaxRig: (input?: {
  camera?: unknown;
  composition?: unknown;
  location?: string;
}) => Array<{level: 'error'; code: string; message: string; location: string}>;
