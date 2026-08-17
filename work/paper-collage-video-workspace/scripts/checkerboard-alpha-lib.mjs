import sharp from 'sharp';

export const BAKED_CHECKERBOARD_MODE = 'baked-checkerboard-alpha';
export const BAKED_CHECKERBOARD_POLICY_ID = 'checkerboard-alpha-v1';

const clamp01 = (value) => Math.max(0, Math.min(1, value));

const classify = ({x, y, cellSize, offsetX, offsetY}) =>
  (
    Math.floor((x + offsetX) / cellSize) +
    Math.floor((y + offsetY) / cellSize)
  ) & 1;

export const inspectBakedCheckerboardPixels = ({
  data,
  width,
  height,
  channels,
}) => {
  const sampleHeight = Math.max(8, Math.floor(height * 0.45));
  let neutralLightPixels = 0;
  let sampledPixels = 0;
  let sampledLuminance = 0;
  for (let y = 0; y < sampleHeight; y += 4) {
    for (let x = 0; x < width; x += 4) {
      const offset = (y * width + x) * channels;
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      const minimum = Math.min(red, green, blue);
      const maximum = Math.max(red, green, blue);
      const luminance = (red + green + blue) / 3;
      sampledPixels += 1;
      sampledLuminance += luminance;
      if (minimum >= 225 && maximum - minimum <= 10) {
        neutralLightPixels += 1;
      }
    }
  }
  let best = null;
  for (let cellSize = 12; cellSize <= 40; cellSize += 1) {
    for (let offsetX = 0; offsetX < cellSize; offsetX += 2) {
      for (let offsetY = 0; offsetY < cellSize; offsetY += 2) {
        const totals = [0, 0];
        const squares = [0, 0];
        const counts = [0, 0];
        for (let y = 0; y < sampleHeight; y += 6) {
          for (let x = 0; x < width; x += 6) {
            const offset = (y * width + x) * channels;
            const luminance =
              (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
            const bucket = classify({
              x,
              y,
              cellSize,
              offsetX,
              offsetY,
            });
            totals[bucket] += luminance;
            squares[bucket] += luminance * luminance;
            counts[bucket] += 1;
          }
        }
        const means = totals.map((total, index) => total / counts[index]);
        const variances = squares.map(
          (total, index) =>
            total / counts[index] - means[index] * means[index],
        );
        const contrast = Math.abs(means[0] - means[1]);
        const noise = Math.sqrt(Math.max(0, variances[0])) +
          Math.sqrt(Math.max(0, variances[1]));
        const score = contrast - noise * 0.35;
        if (!best || score > best.score) {
          best = {
            cellSize,
            offsetX,
            offsetY,
            means,
            contrast,
            noise,
            score,
          };
        }
      }
    }
  }
  const neutralLightShare = neutralLightPixels / sampledPixels;
  const meanLuminance = sampledLuminance / sampledPixels;
  const passed =
    best !== null &&
    neutralLightShare >= 0.92 &&
    meanLuminance >= 235;
  return {
    passed,
    reasons: passed ? [] : ['checkerboard-pattern-not-stable'],
    sampleHeight,
    neutralLightShare,
    meanLuminance,
    ...best,
  };
};

export const removeBakedCheckerboard = async ({
  input,
  transparentDistance = 8,
  opaqueDistance = 32,
}) => {
  if (
    !(
      Number.isFinite(transparentDistance) &&
      transparentDistance >= 0 &&
      Number.isFinite(opaqueDistance) &&
      opaqueDistance > transparentDistance
    )
  ) {
    throw new Error(
      'checkerboard alpha thresholds 必须满足 0 <= transparentDistance < opaqueDistance。',
    );
  }
  const {data, info} = await sharp(input)
    .removeAlpha()
    .raw()
    .toBuffer({resolveWithObject: true});
  const inspection = inspectBakedCheckerboardPixels({
    data,
    width: info.width,
    height: info.height,
    channels: info.channels,
  });
  if (!inspection.passed) {
    throw new Error(
      `无法可靠识别烘焙棋盘格：${inspection.reasons.join('、')}`,
    );
  }
  const rgba = Buffer.alloc(info.width * info.height * 4);
  let transparentPixels = 0;
  let opaquePixels = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const source = (y * info.width + x) * info.channels;
      const target = (y * info.width + x) * 4;
      const red = data[source];
      const green = data[source + 1];
      const blue = data[source + 2];
      const minimum = Math.min(red, green, blue);
      const maximum = Math.max(red, green, blue);
      const saturationDistance = (maximum - minimum) * 1.5;
      const darknessDistance = Math.max(0, 235 - minimum);
      const distance = Math.max(saturationDistance, darknessDistance);
      const alpha = Math.round(
        clamp01(
          (distance - transparentDistance) /
          (opaqueDistance - transparentDistance),
        ) * 255,
      );
      rgba[target] = data[source];
      rgba[target + 1] = data[source + 1];
      rgba[target + 2] = data[source + 2];
      rgba[target + 3] = alpha;
      if (alpha === 0) transparentPixels += 1;
      if (alpha === 255) opaquePixels += 1;
    }
  }
  return {
    buffer: await sharp(rgba, {
      raw: {
        width: info.width,
        height: info.height,
        channels: 4,
      },
    }).png().toBuffer(),
    metadata: {
      schemaVersion: 1,
      mode: BAKED_CHECKERBOARD_MODE,
      policyId: BAKED_CHECKERBOARD_POLICY_ID,
      transparentDistance,
      opaqueDistance,
      inspection,
      transparentPixels,
      opaquePixels,
      totalPixels: info.width * info.height,
    },
  };
};
