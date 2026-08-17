import sharp from 'sharp';

const parseKeyColor = (value) => {
  if (!/^#[0-9a-fA-F]{6}$/.test(value ?? '')) {
    throw new Error(`无效色键：${value ?? ''}`);
  }
  return [1, 3, 5].map((index) =>
    Number.parseInt(value.slice(index, index + 2), 16));
};

const keyPlaneDistance = (red, green, blue, key) => {
  const keyMagnitudeSquared =
    key[0] * key[0] +
    key[1] * key[1] +
    key[2] * key[2];
  const projection = Math.max(
    0,
    Math.min(
      1.25,
      (red * key[0] + green * key[1] + blue * key[2]) /
        keyMagnitudeSquared,
    ),
  );
  const residual = Math.hypot(
    red - projection * key[0],
    green - projection * key[1],
    blue - projection * key[2],
  );
  // A provider often paints shadows by darkening the key plane. Euclidean
  // distance mistakes those same-hue shadows for opaque artwork. Measure the
  // distance to the key-colour ray instead, while forcing near-black pixels
  // opaque so genuine ink contours are not erased.
  const darknessPenalty = Math.max(0, 0.35 - projection) * 441.7;
  return Math.hypot(residual, darknessPenalty);
};

const minimumFilter = ({data, width, height, radius}) => {
  if (radius <= 0) return data;
  const horizontal = new Uint8Array(data.length);
  const output = new Uint8Array(data.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let minimum = 255;
      for (
        let sample = Math.max(0, x - radius);
        sample <= Math.min(width - 1, x + radius);
        sample += 1
      ) {
        minimum = Math.min(minimum, data[y * width + sample]);
      }
      horizontal[y * width + x] = minimum;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let minimum = 255;
      for (
        let sample = Math.max(0, y - radius);
        sample <= Math.min(height - 1, y + radius);
        sample += 1
      ) {
        minimum = Math.min(
          minimum,
          horizontal[sample * width + x],
        );
      }
      output[y * width + x] = minimum;
    }
  }
  return output;
};

const padTransparentRgb = ({
  rgb,
  alpha,
  width,
  height,
  iterations,
}) => {
  const output = Float32Array.from(rgb);
  const filled = new Uint8Array(alpha.length);
  for (let index = 0; index < alpha.length; index += 1) {
    filled[index] = alpha[index] > 0 ? 1 : 0;
  }
  const neighbors = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const pending = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (filled[index]) continue;
        const total = [0, 0, 0];
        let count = 0;
        for (const [dx, dy] of neighbors) {
          const sampleX = x + dx;
          const sampleY = y + dy;
          if (
            sampleX < 0 ||
            sampleX >= width ||
            sampleY < 0 ||
            sampleY >= height
          ) continue;
          const sample = sampleY * width + sampleX;
          if (!filled[sample]) continue;
          total[0] += output[sample * 3];
          total[1] += output[sample * 3 + 1];
          total[2] += output[sample * 3 + 2];
          count += 1;
        }
        if (count > 0) {
          pending.push({
            index,
            color: total.map((channel) => channel / count),
          });
        }
      }
    }
    if (pending.length === 0) break;
    for (const {index, color} of pending) {
      output[index * 3] = color[0];
      output[index * 3 + 1] = color[1];
      output[index * 3 + 2] = color[2];
      filled[index] = 1;
    }
  }
  for (let index = 0; index < filled.length; index += 1) {
    if (filled[index]) continue;
    output[index * 3] = 235;
    output[index * 3 + 1] = 235;
    output[index * 3 + 2] = 235;
  }
  return output;
};

export const removeChromaKey = async ({
  input,
  keyColor,
  transparentThreshold,
  opaqueThreshold,
  edgeFeather,
  matteErode,
  edgePadding,
}) => {
  if (
    !Number.isFinite(transparentThreshold) ||
    !Number.isFinite(opaqueThreshold) ||
    opaqueThreshold <= transparentThreshold
  ) {
    throw new Error('色键 opaqueThreshold 必须大于 transparentThreshold');
  }
  const key = parseKeyColor(keyColor);
  const source = await sharp(input)
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({resolveWithObject: true});
  const {width, height, channels} = source.info;
  const rgb = new Float32Array(width * height * 3);
  let alpha = new Uint8Array(width * height);
  for (let index = 0; index < width * height; index += 1) {
    const sourceOffset = index * channels;
    const targetOffset = index * 3;
    const red = source.data[sourceOffset];
    const green = source.data[sourceOffset + 1];
    const blue = source.data[sourceOffset + 2];
    rgb[targetOffset] = red;
    rgb[targetOffset + 1] = green;
    rgb[targetOffset + 2] = blue;
    const distance = keyPlaneDistance(red, green, blue, key);
    const normalized = Math.max(
      0,
      Math.min(
        1,
        (distance - transparentThreshold) /
          (opaqueThreshold - transparentThreshold),
      ),
    );
    alpha[index] = Math.round(normalized * 255);
  }
  alpha = minimumFilter({
    data: alpha,
    width,
    height,
    radius: matteErode,
  });
  if (edgeFeather > 0) {
    const blurred = await sharp(Buffer.from(alpha), {
      raw: {width, height, channels: 1},
    })
      .blur(edgeFeather)
      .raw()
      .toBuffer({resolveWithObject: true});
    alpha = new Uint8Array(width * height);
    for (let index = 0; index < alpha.length; index += 1) {
      alpha[index] = blurred.data[index * blurred.info.channels];
    }
  }
  const keyMean = (key[0] + key[1] + key[2]) / 3;
  const keyChroma = key.map((channel) => channel - keyMean);
  const keyMagnitude = Math.hypot(...keyChroma);
  if (keyMagnitude >= 1) {
    const direction = keyChroma.map((channel) => channel / keyMagnitude);
    for (let index = 0; index < alpha.length; index += 1) {
      if (alpha[index] <= 0 || alpha[index] >= 255) continue;
      const offset = index * 3;
      const mean =
        (rgb[offset] + rgb[offset + 1] + rgb[offset + 2]) / 3;
      const chroma = [
        rgb[offset] - mean,
        rgb[offset + 1] - mean,
        rgb[offset + 2] - mean,
      ];
      const spill = Math.max(
        0,
        chroma.reduce(
          (total, channel, channelIndex) =>
            total + channel * direction[channelIndex],
          0,
        ),
      );
      const edgeStrength = Math.pow(1 - alpha[index] / 255, 0.72);
      const strength = spill * edgeStrength;
      rgb[offset] -= strength * direction[0];
      rgb[offset + 1] -= strength * direction[1];
      rgb[offset + 2] -= strength * direction[2];
    }
  }
  const padded = padTransparentRgb({
    rgb,
    alpha,
    width,
    height,
    iterations: edgePadding,
  });
  const rgba = Buffer.alloc(width * height * 4);
  let transparentPixels = 0;
  let partialPixels = 0;
  for (let index = 0; index < alpha.length; index += 1) {
    const sourceOffset = index * 3;
    const outputOffset = index * 4;
    rgba[outputOffset] = Math.max(
      0,
      Math.min(255, Math.round(padded[sourceOffset])),
    );
    rgba[outputOffset + 1] = Math.max(
      0,
      Math.min(255, Math.round(padded[sourceOffset + 1])),
    );
    rgba[outputOffset + 2] = Math.max(
      0,
      Math.min(255, Math.round(padded[sourceOffset + 2])),
    );
    rgba[outputOffset + 3] = alpha[index];
    if (alpha[index] === 0) transparentPixels += 1;
    if (alpha[index] > 0 && alpha[index] < 255) partialPixels += 1;
  }
  return {
    buffer: await sharp(rgba, {
      raw: {width, height, channels: 4},
    }).png().toBuffer(),
    metadata: {
      schemaVersion: 2,
      keyColor: keyColor.toLowerCase(),
      transparentThreshold,
      opaqueThreshold,
      edgeFeather,
      matteErode,
      distanceMetric: 'key-ray-with-darkness-floor-v1',
      despill: 'key-chroma-edge',
      transparentRgb: {
        mode: 'edge-pad-neutral',
        paddingPixels: edgePadding,
        neutralRgb: [235, 235, 235],
      },
      transparentPixels,
      partialPixels,
      totalPixels: width * height,
    },
  };
};
