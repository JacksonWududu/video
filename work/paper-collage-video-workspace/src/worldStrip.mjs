const finite = (value) => typeof value === 'number' && Number.isFinite(value);

export const WORLD_STRIP_MIN_VIEWPORT_SPAN = 1;
export const WORLD_STRIP_DEFAULT_VIEWPORT_SPAN = 1.5;
export const WORLD_STRIP_MAX_OVERSCAN_PX = 16;
// Chromium can expose a one-device-pixel antialiasing rail when two
// independently scaled image tiles meet at a fractional CSS coordinate.
// Two CSS pixels of deterministic overlap keeps the logical phase unchanged
// while ensuring the later copy fully covers that rasterization edge.
export const WORLD_STRIP_RASTER_OVERLAP_PX = 2;

export const positiveModulo = (value, modulus) => {
  if (!(finite(modulus) && modulus > 0)) {
    throw new Error('world-strip modulus 必须大于 0。');
  }
  return ((value % modulus) + modulus) % modulus;
};

export const resolveWorldStripSpeedFactor = ({depth, far, near}) => {
  if (![depth, far, near].every(finite)) {
    throw new Error('world-strip depth/speedRange 必须是有限数字。');
  }
  const amount = Math.max(0, Math.min(1, (depth + 1) / 2));
  return far + (near - far) * amount;
};

export const resolveWorldStripTileGeometry = ({
  viewportWidth,
  viewportHeight,
  renderHeight,
  sourceWidth,
  sourceHeight,
  overscanPx = 2,
}) => {
  if (
    ![viewportWidth, viewportHeight, renderHeight, sourceWidth, sourceHeight].every(
      (value) => finite(value) && value > 0,
    )
  ) {
    throw new Error('world-strip viewport、renderHeight 与 source dimensions 必须大于 0。');
  }
  if (!(finite(overscanPx) && overscanPx >= 0 && overscanPx <= WORLD_STRIP_MAX_OVERSCAN_PX)) {
    throw new Error(`world-strip overscanPx 必须位于 0..${WORLD_STRIP_MAX_OVERSCAN_PX}。`);
  }
  const tileWidth = (sourceWidth / sourceHeight) * renderHeight;
  const viewportSpan = tileWidth / viewportWidth;
  const copyCount =
    Math.ceil((viewportWidth + 2 * overscanPx) / tileWidth) + 2;
  return {
    tileWidth,
    tileHeight: renderHeight,
    viewportSpan,
    copyCount,
  };
};

export const resolveWorldStripFrame = ({
  progress,
  viewportWidth,
  tileWidth,
  direction,
  distanceViewports,
  speedFactor,
  startPhase = 0,
  activeFrom = 0,
  activeUntil = 1,
  easing = 'linear',
  overscanPx = 2,
  phaseOffsetPx = 0,
}) => {
  if (!(finite(progress) && progress >= 0 && progress <= 1)) {
    throw new Error('world-strip progress 必须位于 0..1。');
  }
  if (![viewportWidth, tileWidth].every((value) => finite(value) && value > 0)) {
    throw new Error('world-strip viewportWidth/tileWidth 必须大于 0。');
  }
  if (!['left', 'right'].includes(direction)) {
    throw new Error('world-strip direction 必须是 left 或 right。');
  }
  if (!(finite(distanceViewports) && distanceViewports > 0)) {
    throw new Error('world-strip distanceViewports 必须大于 0。');
  }
  if (!(finite(speedFactor) && speedFactor > 0)) {
    throw new Error('world-strip speedFactor 必须大于 0。');
  }
  if (!(finite(startPhase) && startPhase >= 0 && startPhase < 1)) {
    throw new Error('world-strip startPhase 必须位于 0..1。');
  }
  if (!(finite(activeFrom) && activeFrom >= 0 && activeFrom < 1)) {
    throw new Error('world-strip activeFrom 必须位于 0..1。');
  }
  if (!(finite(activeUntil) && activeUntil > activeFrom && activeUntil <= 1)) {
    throw new Error('world-strip activeUntil 必须晚于 activeFrom，且位于 0..1。');
  }
  if (!['linear', 'ease-out'].includes(easing)) {
    throw new Error('world-strip easing 必须是 linear 或 ease-out。');
  }
  if (!finite(phaseOffsetPx)) {
    throw new Error('world-strip phaseOffsetPx 必须是有限数字。');
  }
  // `distanceViewports` describes the complete travel inside its explicit
  // active window. The phase is held before `activeFrom` and after
  // `activeUntil`, which supports one continuous take that settles into a
  // genuinely static tableau without replacing the canonical strips.
  const windowProgress = progress <= activeFrom
    ? 0
    : progress >= activeUntil
      ? 1
      : (progress - activeFrom) / (activeUntil - activeFrom);
  const travelProgress = easing === 'ease-out'
    ? 1 - (1 - windowProgress) ** 2
    : windowProgress;
  const signedDistance =
    (direction === 'left' ? -1 : 1) *
    distanceViewports *
    viewportWidth *
    speedFactor *
    travelProgress;
  const unwrappedPhase = startPhase * tileWidth + signedDistance;
  const renderUnwrappedPhase = unwrappedPhase + phaseOffsetPx;
  const phase = positiveModulo(renderUnwrappedPhase, tileWidth);
  const firstCopyX = phase - tileWidth - overscanPx;
  const cameraCompensatedDisplacement = Object.is(signedDistance, -0)
    ? 0
    : signedDistance;
  return {
    phase,
    phaseNormalized: phase / tileWidth,
    unwrappedPhase,
    renderUnwrappedPhase,
    firstCopyX,
    cameraCompensatedDisplacement,
    travelProgress,
    wraps: Math.floor(Math.abs(signedDistance) / tileWidth),
  };
};

export const resolveWorldStripCopies = ({
  firstCopyX,
  tileWidth,
  copyCount,
  overlapPx = WORLD_STRIP_RASTER_OVERLAP_PX,
}) => {
  if (!(Number.isInteger(copyCount) && copyCount >= 2)) {
    throw new Error('world-strip copyCount 必须是至少 2 的整数。');
  }
  return Array.from({length: copyCount}, (_, index) => ({
    index,
    x: firstCopyX + index * tileWidth,
    width: tileWidth + overlapPx,
  }));
};

export const inspectWorldStripCoverage = ({
  copies,
  viewportWidth,
  tolerancePx = 0.51,
}) => {
  const intervals = [...copies]
    .map(({x, width}) => ({start: x, end: x + width}))
    .sort((left, right) => left.start - right.start);
  let cursor = 0;
  let maximumGap = 0;
  for (const interval of intervals) {
    if (interval.end < -tolerancePx || interval.start > viewportWidth + tolerancePx) {
      continue;
    }
    maximumGap = Math.max(maximumGap, interval.start - cursor);
    cursor = Math.max(cursor, interval.end);
  }
  maximumGap = Math.max(maximumGap, viewportWidth - cursor);
  const uncoveredPixels = Math.max(0, maximumGap - tolerancePx);
  return {
    passed: uncoveredPixels <= 1e-9,
    uncoveredPixels,
    maximumGap,
    coveredUntil: cursor,
  };
};

export const validateClosedWorldStripLoop = ({
  distanceViewports,
  viewportWidth,
  speedFactor,
  tileWidth,
  tolerance = 1e-6,
}) => {
  const periods =
    (distanceViewports * viewportWidth * speedFactor) / tileWidth;
  const nearest = Math.round(periods);
  return {
    passed: Math.abs(periods - nearest) <= tolerance,
    periods,
    nearestPeriod: nearest,
    phaseError: Math.abs(periods - nearest),
  };
};
