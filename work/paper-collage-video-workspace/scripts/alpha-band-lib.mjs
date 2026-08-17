import sharp from 'sharp';

export const DEFAULT_ALPHA_BAND_THRESHOLDS = Object.freeze({
  lowAlphaMinimum: 4,
  lowAlphaMaximum: 96,
  minimumRunPixels: 24,
  minimumRunRatio: 0.42,
  warningRunRatio: 0.75,
  maximumBandThicknessRatio: 0.025,
  boundaryToleranceRatio: 0.012,
  rectangleMinimumSeparationRatio: 0.08,
});

export const DEFAULT_ALPHA_TOPOLOGY_THRESHOLDS = Object.freeze({
  alphaMinimum: 12,
  maximumAnalysisDimension: 1024,
  minimumDetachedPixels: 20,
  minimumDetachedAreaRatio: 0.00004,
  minimumDetachedSeparationRatio: 0.015,
  minimumRectangularFillRatio: 0.68,
  derivationRectangleFillRatio: 0.82,
  derivationBoundaryToleranceRatio: 0.012,
  minimumDerivationComponentAreaRatio: 0.004,
});

const clamp = (value, minimum, maximum) =>
  Math.max(minimum, Math.min(maximum, value));

const median = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const longestLowAlphaRun = ({
  data,
  channels,
  width,
  height,
  orientation,
  coordinate,
  thresholds,
}) => {
  const length = orientation === 'horizontal' ? width : height;
  let bestStart = 0;
  let bestLength = 0;
  let currentStart = 0;
  let currentLength = 0;
  for (let axis = 0; axis < length; axis += 1) {
    const x = orientation === 'horizontal' ? axis : coordinate;
    const y = orientation === 'horizontal' ? coordinate : axis;
    const alpha = data[(y * width + x) * channels + 3];
    if (
      alpha >= thresholds.lowAlphaMinimum &&
      alpha <= thresholds.lowAlphaMaximum
    ) {
      if (currentLength === 0) currentStart = axis;
      currentLength += 1;
      if (currentLength > bestLength) {
        bestStart = currentStart;
        bestLength = currentLength;
      }
    } else {
      currentLength = 0;
    }
  }
  return {start: bestStart, end: bestStart + bestLength - 1, length: bestLength};
};

const overlapRatio = (left, right) => {
  const overlap = Math.max(
    0,
    Math.min(left.end, right.end) - Math.max(left.start, right.start) + 1,
  );
  return overlap / Math.max(1, Math.min(left.length, right.length));
};

const collectRawCandidates = ({
  data,
  info,
  orientation,
  thresholds,
}) => {
  const count = orientation === 'horizontal' ? info.height : info.width;
  const axisLength = orientation === 'horizontal' ? info.width : info.height;
  const candidates = [];
  for (let coordinate = 0; coordinate < count; coordinate += 1) {
    const run = longestLowAlphaRun({
      data,
      channels: info.channels,
      width: info.width,
      height: info.height,
      orientation,
      coordinate,
      thresholds,
    });
    if (
      run.length >= thresholds.minimumRunPixels &&
      run.length / axisLength >= thresholds.minimumRunRatio
    ) {
      candidates.push({coordinate, ...run});
    }
  }
  return candidates;
};

const mergeCandidates = ({candidates, orientation, width, height}) => {
  const groups = [];
  for (const candidate of candidates) {
    const previous = groups.at(-1);
    if (
      previous &&
      candidate.coordinate === previous.coordinateEnd + 1 &&
      overlapRatio(candidate, previous.last) >= 0.7
    ) {
      previous.rows.push(candidate);
      previous.coordinateEnd = candidate.coordinate;
      previous.last = candidate;
    } else {
      groups.push({
        orientation,
        coordinateStart: candidate.coordinate,
        coordinateEnd: candidate.coordinate,
        rows: [candidate],
        last: candidate,
      });
    }
  }
  return groups.map(({rows, last: _last, ...group}, index) => {
    const start = median(rows.map((row) => row.start));
    const end = median(rows.map((row) => row.end));
    const length = Math.max(0, end - start + 1);
    const axisLength = orientation === 'horizontal' ? width : height;
    const crossLength = orientation === 'horizontal' ? height : width;
    const thickness = group.coordinateEnd - group.coordinateStart + 1;
    return {
      id: `${orientation}-${index + 1}`,
      orientation,
      coordinateStart: group.coordinateStart,
      coordinateEnd: group.coordinateEnd,
      coordinate: Math.round((group.coordinateStart + group.coordinateEnd) / 2),
      spanStart: start,
      spanEnd: end,
      runPixels: length,
      runRatio: length / Math.max(1, axisLength),
      thicknessPixels: thickness,
      thicknessRatio: thickness / Math.max(1, crossLength),
    };
  });
};

const scaleRect = (rect, from, to) => ({
  left: rect.left * to.width / from.width,
  top: rect.top * to.height / from.height,
  width: rect.width * to.width / from.width,
  height: rect.height * to.height / from.height,
});

const correlationFor = ({
  candidate,
  width,
  height,
  regions,
  thresholds,
}) => {
  const crossLength =
    candidate.orientation === 'horizontal' ? height : width;
  const axisLength =
    candidate.orientation === 'horizontal' ? width : height;
  const tolerance = Math.max(
    2,
    Math.round(crossLength * thresholds.boundaryToleranceRatio),
  );
  const correlations = [];
  if (
    candidate.coordinateStart <= tolerance ||
    candidate.coordinateEnd >= crossLength - 1 - tolerance
  ) {
    correlations.push({
      kind: 'canvas-boundary',
      edge: candidate.coordinateStart <= tolerance ? 'start' : 'end',
      distancePixels: Math.min(
        candidate.coordinateStart,
        crossLength - 1 - candidate.coordinateEnd,
      ),
    });
  }
  for (const region of regions) {
    const edges = candidate.orientation === 'horizontal'
      ? [
          {edge: 'top', coordinate: region.rect.top},
          {edge: 'bottom', coordinate: region.rect.top + region.rect.height},
        ]
      : [
          {edge: 'left', coordinate: region.rect.left},
          {edge: 'right', coordinate: region.rect.left + region.rect.width},
        ];
    const regionStart = candidate.orientation === 'horizontal'
      ? region.rect.left
      : region.rect.top;
    const regionEnd = candidate.orientation === 'horizontal'
      ? region.rect.left + region.rect.width
      : region.rect.top + region.rect.height;
    const overlap = Math.max(
      0,
      Math.min(candidate.spanEnd, regionEnd) -
        Math.max(candidate.spanStart, regionStart),
    );
    for (const edge of edges) {
      const distance = Math.abs(candidate.coordinate - edge.coordinate);
      if (
        distance <= tolerance &&
        overlap / Math.max(1, Math.min(candidate.runPixels, regionEnd - regionStart)) >= 0.55
      ) {
        correlations.push({
          kind: region.kind,
          id: region.id,
          edge: edge.edge,
          distancePixels: distance,
        });
      }
    }
  }
  return {
    tolerancePixels: tolerance,
    axisLength,
    correlations,
  };
};

const markRectangularSets = ({candidates, width, height, thresholds}) => {
  const horizontal = candidates.filter(
    (candidate) =>
      candidate.orientation === 'horizontal' &&
      candidate.thicknessRatio <= thresholds.maximumBandThicknessRatio,
  );
  const vertical = candidates.filter(
    (candidate) =>
      candidate.orientation === 'vertical' &&
      candidate.thicknessRatio <= thresholds.maximumBandThicknessRatio,
  );
  const tolerance = Math.max(
    3,
    Math.round(Math.min(width, height) * thresholds.boundaryToleranceRatio),
  );
  const marked = new Set();
  for (let firstH = 0; firstH < horizontal.length; firstH += 1) {
    for (let secondH = firstH + 1; secondH < horizontal.length; secondH += 1) {
      const top = horizontal[firstH];
      const bottom = horizontal[secondH];
      if (
        Math.abs(bottom.coordinate - top.coordinate) <
        height * thresholds.rectangleMinimumSeparationRatio
      ) continue;
      for (let firstV = 0; firstV < vertical.length; firstV += 1) {
        for (let secondV = firstV + 1; secondV < vertical.length; secondV += 1) {
          const left = vertical[firstV];
          const right = vertical[secondV];
          if (
            Math.abs(right.coordinate - left.coordinate) <
            width * thresholds.rectangleMinimumSeparationRatio
          ) continue;
          const horizontalContainsVertical =
            left.coordinate >= top.spanStart - tolerance &&
            right.coordinate <= top.spanEnd + tolerance &&
            left.coordinate >= bottom.spanStart - tolerance &&
            right.coordinate <= bottom.spanEnd + tolerance;
          const verticalContainsHorizontal =
            top.coordinate >= left.spanStart - tolerance &&
            bottom.coordinate <= left.spanEnd + tolerance &&
            top.coordinate >= right.spanStart - tolerance &&
            bottom.coordinate <= right.spanEnd + tolerance;
          if (horizontalContainsVertical && verticalContainsHorizontal) {
            [top, bottom, left, right].forEach(({id}) => marked.add(id));
          }
        }
      }
    }
  }
  return marked;
};

export const analyzeAlphaBandPixels = ({
  data,
  info,
  regions = [],
  thresholds = DEFAULT_ALPHA_BAND_THRESHOLDS,
  label = 'original',
}) => {
  const horizontal = mergeCandidates({
    candidates: collectRawCandidates({
      data,
      info,
      orientation: 'horizontal',
      thresholds,
    }),
    orientation: 'horizontal',
    width: info.width,
    height: info.height,
  });
  const vertical = mergeCandidates({
    candidates: collectRawCandidates({
      data,
      info,
      orientation: 'vertical',
      thresholds,
    }),
    orientation: 'vertical',
    width: info.width,
    height: info.height,
  });
  const candidates = [...horizontal, ...vertical];
  const rectangular = markRectangularSets({
    candidates,
    width: info.width,
    height: info.height,
    thresholds,
  });
  const diagnostics = candidates.map((candidate) => {
    const correlation = correlationFor({
      candidate,
      width: info.width,
      height: info.height,
      regions,
      thresholds,
    });
    const thin =
      candidate.thicknessRatio <= thresholds.maximumBandThicknessRatio;
    const boundaryCorrelated = correlation.correlations.length > 0;
    const rectangleDetected = rectangular.has(candidate.id);
    let severity = 'info';
    let classification = 'normal-contour-or-soft-shadow';
    if (!thin) {
      classification = 'broad-soft-transition';
    } else if (rectangleDetected) {
      severity = 'error';
      classification = 'rectangular-alpha-residue';
    } else if (
      boundaryCorrelated &&
      candidate.runRatio >= thresholds.minimumRunRatio
    ) {
      severity = 'error';
      classification = 'boundary-correlated-alpha-band';
    } else if (candidate.runRatio >= thresholds.warningRunRatio) {
      severity = 'warning';
      classification = 'long-straight-alpha-band-unconfirmed';
    }
    return {
      ...candidate,
      ...correlation,
      thin,
      rectangleDetected,
      severity,
      classification,
    };
  });
  const failures = diagnostics
    .filter(({severity}) => severity === 'error')
    .map((diagnostic) => ({
      id: diagnostic.id,
      message:
        `${label} ${diagnostic.orientation} low-alpha band at ` +
        `${diagnostic.coordinateStart}-${diagnostic.coordinateEnd}px ` +
        `spans ${diagnostic.spanStart}-${diagnostic.spanEnd}px; ` +
        `${diagnostic.classification}`,
      diagnostic,
    }));
  return {
    label,
    width: info.width,
    height: info.height,
    passed: failures.length === 0,
    severity: failures.length > 0
      ? 'error'
      : diagnostics.some(({severity}) => severity === 'warning')
        ? 'warning'
        : 'info',
    diagnostics,
    failures,
  };
};

export const derivationRegionsFromBinding = (binding) => {
  const derivation = binding?.derivation;
  if (!derivation) return [];
  const regions = [];
  if (derivation.placement) {
    regions.push({
      id: `${binding.role ?? 'member'}-placement`,
      kind: 'rectangular-derivation-region',
      rect: derivation.placement,
    });
  }
  if (derivation.clip?.kind === 'rectangle') {
    regions.push({
      id: `${binding.role ?? 'member'}-clip`,
      kind: 'crop-boundary',
      rect: derivation.clip.rect,
    });
  }
  return regions;
};

export const inspectAlphaBands = async ({
  file,
  renderSize = null,
  derivationRegions = [],
  thresholds = DEFAULT_ALPHA_BAND_THRESHOLDS,
}) => {
  const original = await sharp(file)
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({resolveWithObject: true});
  const sourceSize = {
    width: original.info.width,
    height: original.info.height,
  };
  const scales = [];
  scales.push(analyzeAlphaBandPixels({
    data: original.data,
    info: original.info,
    regions: derivationRegions,
    thresholds,
    label: 'original',
  }));
  if (
    renderSize &&
    Number.isFinite(renderSize.width) &&
    Number.isFinite(renderSize.height)
  ) {
    const target = {
      width: clamp(Math.round(renderSize.width), 1, 8192),
      height: clamp(Math.round(renderSize.height), 1, 8192),
    };
    if (target.width !== sourceSize.width || target.height !== sourceSize.height) {
      const rendered = await sharp(file)
        .toColourspace('srgb')
        .ensureAlpha()
        .resize(target.width, target.height, {fit: 'fill', kernel: 'lanczos3'})
        .raw()
        .toBuffer({resolveWithObject: true});
      scales.push(analyzeAlphaBandPixels({
        data: rendered.data,
        info: rendered.info,
        regions: derivationRegions.map((region) => ({
          ...region,
          rect: scaleRect(region.rect, sourceSize, target),
        })),
        thresholds,
        label: 'render-scale',
      }));
    }
  }
  const failures = scales.flatMap(({label, failures: scaleFailures}) =>
    scaleFailures.map((failure) => ({scale: label, ...failure})),
  );
  return {
    schemaVersion: 1,
    thresholds,
    derivationRegions,
    sourceSize,
    renderSize: scales.find(({label}) => label === 'render-scale')
      ? renderSize
      : null,
    passed: failures.length === 0,
    severity: failures.length > 0
      ? 'error'
      : scales.some(({severity}) => severity === 'warning')
        ? 'warning'
        : 'info',
    scales,
    failures,
    failureMessage: failures.length > 0
      ? failures.map(({message}) => message).join('; ')
      : null,
  };
};

const componentGap = (left, right) => {
  const horizontal = Math.max(
    0,
    left.left - right.right - 1,
    right.left - left.right - 1,
  );
  const vertical = Math.max(
    0,
    left.top - right.bottom - 1,
    right.top - left.bottom - 1,
  );
  return Math.hypot(horizontal, vertical);
};

const componentRect = (component) => ({
  left: component.left,
  top: component.top,
  width: component.right - component.left + 1,
  height: component.bottom - component.top + 1,
});

const alignedDerivationEdges = ({
  component,
  region,
  width,
  height,
  thresholds,
}) => {
  const tolerance = Math.max(
    2,
    Math.round(
      Math.min(width, height) *
        thresholds.derivationBoundaryToleranceRatio,
    ),
  );
  const rect = componentRect(component);
  const edges = [
    ['left', rect.left, region.rect.left],
    ['top', rect.top, region.rect.top],
    ['right', rect.left + rect.width, region.rect.left + region.rect.width],
    ['bottom', rect.top + rect.height, region.rect.top + region.rect.height],
  ]
    .filter(([, actual, expected]) => Math.abs(actual - expected) <= tolerance)
    .map(([edge]) => edge);
  const perpendicular =
    (edges.includes('left') || edges.includes('right')) &&
    (edges.includes('top') || edges.includes('bottom'));
  return {edges, perpendicular, tolerance};
};

export const analyzeAlphaTopologyPixels = ({
  data,
  info,
  derivationRegions = [],
  expectedComponents = [],
  allowDetachedComponents = false,
  thresholds = DEFAULT_ALPHA_TOPOLOGY_THRESHOLDS,
}) => {
  const {width, height, channels} = info;
  const pixelCount = width * height;
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const components = [];
  const alphaAt = (index) => data[index * channels + 3];
  for (let start = 0; start < pixelCount; start += 1) {
    if (visited[start] || alphaAt(start) < thresholds.alphaMinimum) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    let pixels = 0;
    let left = width;
    let right = -1;
    let top = height;
    let bottom = -1;
    while (head < tail) {
      const current = queue[head++];
      const x = current % width;
      const y = Math.floor(current / width);
      pixels += 1;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        const nextY = y + offsetY;
        if (nextY < 0 || nextY >= height) continue;
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) continue;
          const nextX = x + offsetX;
          if (nextX < 0 || nextX >= width) continue;
          const next = nextY * width + nextX;
          if (
            visited[next] ||
            alphaAt(next) < thresholds.alphaMinimum
          ) continue;
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    const boxPixels = Math.max(1, (right - left + 1) * (bottom - top + 1));
    components.push({
      id: `component-${components.length + 1}`,
      pixels,
      areaRatio: pixels / Math.max(1, pixelCount),
      left,
      top,
      right,
      bottom,
      fillRatio: pixels / boxPixels,
    });
  }
  components.sort((left, right) => right.pixels - left.pixels);
  const primary = components[0] ?? null;
  const diagonal = Math.hypot(width, height);
  const diagnostics = [];
  const expectedComponentTolerance = Math.max(
    2,
    Math.round(
      Math.min(width, height) *
        thresholds.derivationBoundaryToleranceRatio,
    ),
  );
  const matchesExpectedComponent = (component) =>
    expectedComponents.some((expected) => {
      const expectedRight = expected.left + expected.width - 1;
      const expectedBottom = expected.top + expected.height - 1;
      return (
        component.left >= expected.left - expectedComponentTolerance &&
        component.top >= expected.top - expectedComponentTolerance &&
        component.right <= expectedRight + expectedComponentTolerance &&
        component.bottom <= expectedBottom + expectedComponentTolerance
      );
    });
  if (primary && !allowDetachedComponents) {
    for (const component of components.slice(1)) {
      const separationRatio =
        componentGap(primary, component) / Math.max(1, diagonal);
      if (
        component.pixels >= thresholds.minimumDetachedPixels &&
        component.areaRatio >= thresholds.minimumDetachedAreaRatio &&
        separationRatio >= thresholds.minimumDetachedSeparationRatio &&
        component.fillRatio >= thresholds.minimumRectangularFillRatio &&
        !matchesExpectedComponent(component)
      ) {
        diagnostics.push({
          id: component.id,
          classification: 'detached-rectangular-alpha-fragment',
          severity: 'error',
          separationRatio,
          component,
        });
      }
    }
  }
  for (const component of components) {
    const rect = componentRect(component);
    if (
      component.areaRatio < thresholds.minimumDerivationComponentAreaRatio ||
      component.fillRatio < thresholds.derivationRectangleFillRatio ||
      rect.width * rect.height >= pixelCount * 0.98
    ) continue;
    for (const region of derivationRegions) {
      const alignment = alignedDerivationEdges({
        component,
        region,
        width,
        height,
        thresholds,
      });
      if (!alignment.perpendicular) continue;
      diagnostics.push({
        id: `${component.id}:${region.id}`,
        classification: 'hard-rectangular-derivation-boundary',
        severity: 'error',
        component,
        region,
        alignment,
      });
    }
  }
  const failures = diagnostics.map((diagnostic) => ({
    id: diagnostic.id,
    message:
      diagnostic.classification === 'detached-rectangular-alpha-fragment'
        ? `${diagnostic.id} is a detached rectangular alpha fragment`
        : `${diagnostic.id} follows a hard rectangular derivation boundary`,
    diagnostic,
  }));
  return {
    width,
    height,
    thresholds,
    components,
    diagnostics,
    failures,
    passed: failures.length === 0,
  };
};

export const inspectAlphaTopology = async ({
  file,
  derivationRegions = [],
  expectedComponents = [],
  allowDetachedComponents = false,
  thresholds = DEFAULT_ALPHA_TOPOLOGY_THRESHOLDS,
}) => {
  const metadata = await sharp(file).metadata();
  const scale = Math.min(
    1,
    thresholds.maximumAnalysisDimension /
      Math.max(metadata.width ?? 1, metadata.height ?? 1),
  );
  const width = Math.max(1, Math.round((metadata.width ?? 1) * scale));
  const height = Math.max(1, Math.round((metadata.height ?? 1) * scale));
  const image = sharp(file).toColourspace('srgb').ensureAlpha();
  const analyzed = await (
    scale < 1 ? image.resize(width, height, {fit: 'fill', kernel: 'nearest'}) : image
  )
    .raw()
    .toBuffer({resolveWithObject: true});
  const sourceSize = {
    width: metadata.width ?? analyzed.info.width,
    height: metadata.height ?? analyzed.info.height,
  };
  const analysisSize = {
    width: analyzed.info.width,
    height: analyzed.info.height,
  };
  const inspection = analyzeAlphaTopologyPixels({
    data: analyzed.data,
    info: analyzed.info,
    thresholds,
    derivationRegions: derivationRegions.map((region) => ({
      ...region,
      rect: scaleRect(region.rect, sourceSize, analysisSize),
    })),
    expectedComponents: expectedComponents.map((component) =>
      scaleRect(component, sourceSize, analysisSize)),
    allowDetachedComponents,
  });
  return {
    schemaVersion: 1,
    sourceSize,
    analysisSize,
    derivationRegions,
    expectedComponents,
    allowDetachedComponents,
    ...inspection,
  };
};

export const alphaBandOverlaySvg = ({inspection, width, height}) => {
  const original =
    inspection.scales.find(({label}) => label === 'original') ??
    inspection.scales[0];
  const lines = (original?.diagnostics ?? []).map((diagnostic) => {
    const color = diagnostic.severity === 'error'
      ? '#ff2d55'
      : diagnostic.severity === 'warning'
        ? '#ff9f0a'
        : '#30d158';
    if (diagnostic.orientation === 'horizontal') {
      return `<rect x="${diagnostic.spanStart}" y="${diagnostic.coordinateStart}" width="${Math.max(1, diagnostic.runPixels)}" height="${Math.max(1, diagnostic.thicknessPixels)}" fill="none" stroke="${color}" stroke-width="3"/>`;
    }
    return `<rect x="${diagnostic.coordinateStart}" y="${diagnostic.spanStart}" width="${Math.max(1, diagnostic.thicknessPixels)}" height="${Math.max(1, diagnostic.runPixels)}" fill="none" stroke="${color}" stroke-width="3"/>`;
  }).join('');
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="none"/>${lines}</svg>`,
  );
};
