export const IAN_STATIC_FULL_FRAME_CONTRACT = 'ian-static-full-frame-v1';
export const IAN_SUBTLE_RASTER_MOTION_CONTRACT = 'ian-subtle-raster-motion-v1';

const CANVAS_HALF_WIDTH = 960;
const CANVAS_HALF_HEIGHT = 540;
const MAX_SCALE = 1.05;
const MAX_X_DELTA = 48;
const MAX_Y_DELTA = 27;
const EPSILON = 1e-9;

const assertExactKeys = (value, keys, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object with exact keys`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} must contain exact keys: ${expected.join(', ')}`);
  }
};

const validatePoint = (point, label) => {
  assertExactKeys(point, ['scale', 'x_px', 'y_px'], label);
  for (const key of ['scale', 'x_px', 'y_px']) {
    if (!Number.isFinite(point[key])) throw new Error(`${label}.${key} must be finite`);
  }
  if (point.scale < 1 - EPSILON || point.scale > MAX_SCALE + EPSILON) {
    throw new Error(`${label}.scale must remain within 1.000–1.050`);
  }
  const xLimit = CANVAS_HALF_WIDTH * (point.scale - 1);
  const yLimit = CANVAS_HALF_HEIGHT * (point.scale - 1);
  if (Math.abs(point.x_px) > xLimit + EPSILON || Math.abs(point.y_px) > yLimit + EPSILON) {
    throw new Error(`${label} translation exceeds the scale-derived overscan envelope`);
  }
  return {scale: point.scale, x_px: point.x_px, y_px: point.y_px};
};

const validateSubtleMotion = (shotId, motion) => {
  assertExactKeys(motion, ['mode', 'start', 'end', 'easing', 'origin'], `${shotId}.internal_motion`);
  if (motion.mode !== 'single_segment') {
    throw new Error(`${shotId}.internal_motion.mode must be single_segment`);
  }
  if (motion.easing !== 'ease-in-out') {
    throw new Error(`${shotId}.internal_motion.easing must be ease-in-out`);
  }
  if (motion.origin !== 'center') {
    throw new Error(`${shotId}.internal_motion.origin must be center`);
  }
  const start = validatePoint(motion.start, `${shotId}.internal_motion.start`);
  const end = validatePoint(motion.end, `${shotId}.internal_motion.end`);
  if (Math.abs(end.scale - start.scale) > 0.05 + EPSILON) {
    throw new Error(`${shotId}.internal_motion total scale change exceeds 0.050`);
  }
  if (Math.abs(end.x_px - start.x_px) > MAX_X_DELTA + EPSILON) {
    throw new Error(`${shotId}.internal_motion total x change exceeds 48 px`);
  }
  if (Math.abs(end.y_px - start.y_px) > MAX_Y_DELTA + EPSILON) {
    throw new Error(`${shotId}.internal_motion total y change exceeds 27 px`);
  }
  if (shotId === 'S01'
    && (start.scale !== 1 || start.x_px !== 0 || start.y_px !== 0)) {
    throw new Error('S01 Ian subtle raster motion must start at identity');
  }
  return {
    mode: 'single_segment',
    start,
    end,
    easing: 'ease-in-out',
    origin: 'center',
  };
};

export const validateIanSceneMotion = ({
  shotId,
  internalMotionContract,
  internalMotion,
}) => {
  if (typeof shotId !== 'string' || shotId === '') throw new Error('Ian shotId is required');
  if (internalMotionContract === IAN_STATIC_FULL_FRAME_CONTRACT) {
    if (internalMotion !== null && internalMotion !== undefined) {
      throw new Error(`${shotId} static Ian scene must not carry internal_motion`);
    }
    return {
      internal_motion_contract: IAN_STATIC_FULL_FRAME_CONTRACT,
      internal_motion: null,
    };
  }
  if (internalMotionContract === IAN_SUBTLE_RASTER_MOTION_CONTRACT) {
    if (internalMotion === null || internalMotion === undefined) {
      throw new Error(`${shotId} subtle Ian scene requires an exact internal_motion plan`);
    }
    return {
      internal_motion_contract: IAN_SUBTLE_RASTER_MOTION_CONTRACT,
      internal_motion: validateSubtleMotion(shotId, internalMotion),
    };
  }
  throw new Error(`${shotId} has an unsupported Ian internal-motion contract`);
};
