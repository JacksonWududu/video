const TARGET_ASPECT = 16 / 9;

export const assertLandscape16By9 = (width, height, tolerance = 0.005) => {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`invalid raster dimensions: ${width}x${height}`);
  }
  if (width <= height) throw new Error(`landscape raster required: ${width}x${height}`);
  const relativeAspectError = Math.abs(width / height - TARGET_ASPECT) / TARGET_ASPECT;
  if (relativeAspectError > tolerance) {
    throw new Error(`raster exceeds 16:9 tolerance: ${width}x${height}`);
  }
  return {width, height, relativeAspectError};
};

export const assertExactCompositionRaster = (width, height) => {
  if (width !== 1920 || height !== 1080) {
    throw new Error(`composition raster must be exactly 1920x1080: ${width}x${height}`);
  }
  return {width, height};
};

export const coverGeometry = (
  width,
  height,
  outputWidth = 1920,
  outputHeight = 1080,
) => {
  if (![width, height, outputWidth, outputHeight].every((value) => Number.isInteger(value) && value > 0)) {
    throw new Error('cover geometry requires positive integer dimensions');
  }
  const scale = Math.max(outputWidth / width, outputHeight / height);
  const resizedWidth = Math.round(width * scale);
  const resizedHeight = Math.round(height * scale);
  return {
    scale,
    resizedWidth,
    resizedHeight,
    cropLeft: Math.floor((resizedWidth - outputWidth) / 2),
    cropTop: Math.floor((resizedHeight - outputHeight) / 2),
    outputWidth,
    outputHeight,
  };
};
