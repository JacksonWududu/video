const TAU = Math.PI * 2;
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const wrap01 = (value) => ((value % 1) + 1) % 1;

export const MAX_MOTIF_INSTANCES_PER_FIELD = 64;
export const MAX_MOTIF_INSTANCES_PER_SCENE = 192;
export const MAX_MOTIF_PLACEMENT_ATTEMPTS = 256;

const hashSeed = (seed, salt) => {
  let value = (seed >>> 0) ^ 2166136261;
  for (const character of String(salt)) {
    value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  }
  return value >>> 0;
};

const mulberry32 = (seed) => {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ mixed >>> 15, mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ mixed >>> 7, mixed | 61);
    return ((mixed ^ mixed >>> 14) >>> 0) / 4294967296;
  };
};

const between = (random, [minimum, maximum]) =>
  minimum + (maximum - minimum) * random();

const edgePoint = (amount) => {
  const position = (amount % 1) * 4;
  if (position < 1) return {x: position, y: 0};
  if (position < 2) return {x: 1, y: position - 1};
  if (position < 3) return {x: 3 - position, y: 1};
  return {x: 0, y: 4 - position};
};

const normalizeBounds = (bounds) => bounds ?? {x: 0, y: 0, width: 1, height: 1};

export const isPointInsideMotifExclusion = (
  point,
  zone,
  clearance = 0,
) => {
  const padding = Math.max(0, zone.padding ?? 0) + Math.max(0, clearance);
  const left = zone.x - padding;
  const top = zone.y - padding;
  const width = zone.width + padding * 2;
  const height = zone.height + padding * 2;
  if (zone.shape === 'ellipse') {
    const radiusX = width / 2;
    const radiusY = height / 2;
    const centerX = left + radiusX;
    const centerY = top + radiusY;
    if (radiusX <= 0 || radiusY <= 0) return false;
    const normalizedX = (point.x - centerX) / radiusX;
    const normalizedY = (point.y - centerY) / radiusY;
    return normalizedX ** 2 + normalizedY ** 2 <= 1;
  }
  return (
    point.x >= left &&
    point.x <= left + width &&
    point.y >= top &&
    point.y <= top + height
  );
};

const resolveCandidatePoint = ({
  distribution,
  index,
  attempt,
  count,
  columns,
  rows,
  random,
}) => {
  if (distribution === 'grid') {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const jitter = attempt === 0 ? 0.28 : 0.88;
    return {
      x: (column + 0.5 + (random() - 0.5) * jitter) / columns,
      y: (row + 0.5 + (random() - 0.5) * jitter) / rows,
    };
  }
  if (distribution === 'edge') {
    return edgePoint((index + random() * Math.max(0.5, attempt + 1)) / Math.max(1, count));
  }
  return {x: random(), y: random()};
};

export const resolveMotifFieldInstances = (node) => {
  const random = mulberry32(hashSeed(node.seed, node.id));
  const count = Math.max(
    0,
    Math.min(MAX_MOTIF_INSTANCES_PER_FIELD, Math.floor(node.count)),
  );
  const bounds = normalizeBounds(node.bounds);
  const exclusions = node.exclusionZones ?? [];
  const maxScale = Math.max(...(node.variation?.scale ?? [1]));
  const motifClearance = Math.max(0, (node.baseSize ?? 0) * maxScale);
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.max(1, Math.ceil(count / columns));
  return Array.from({length: count}, (_, index) => {
    let point = null;
    for (let attempt = 0; attempt < MAX_MOTIF_PLACEMENT_ATTEMPTS; attempt += 1) {
      const candidate = resolveCandidatePoint({
        distribution: node.distribution,
        index,
        attempt,
        count,
        columns,
        rows,
        random,
      });
      const normalized = {
        x: bounds.x + candidate.x * bounds.width,
        y: bounds.y + candidate.y * bounds.height,
      };
      if (!exclusions.some((zone) =>
        isPointInsideMotifExclusion(normalized, zone, motifClearance)
      )) {
        point = normalized;
        break;
      }
    }
    if (!point) {
      throw new Error(
        `motif-field ${node.id} 无法在 ${MAX_MOTIF_PLACEMENT_ATTEMPTS} 次确定性尝试内避开 exclusionZones。`,
      );
    }
    return {
      id: `${node.id}-motif-${index + 1}`,
      src: node.motifs[index % node.motifs.length].src,
      x: point.x,
      y: point.y,
      scale: between(random, node.variation.scale),
      rotation: between(random, node.variation.rotation),
      opacity: between(random, node.variation.opacity),
      phase: random(),
    };
  });
};

export const resolveMotifFieldMotion = ({
  instance,
  preset,
  progress,
  cycles,
  horizontalAmplitude,
}) => {
  const phase = wrap01(progress * cycles + instance.phase);
  const wave = Math.sin(phase * TAU);
  const cosine = Math.cos(phase * TAU);
  const driftAmplitude = horizontalAmplitude ?? (
    preset === 'drift' ? 0.025 : 0.018
  );
  switch (preset) {
    case 'rise-drift': {
      const respawnFade = clamp01(Math.min(phase, 1 - phase) / 0.08);
      const absoluteY = 1.08 - phase * 1.16;
      return {
        x: wave * driftAmplitude,
        y: absoluteY - instance.y,
        rotation: wave * 5,
        scale: 0.82 + phase * 0.22,
        opacity: respawnFade,
      };
    }
    case 'fall-drift': {
      const respawnFade = clamp01(Math.min(phase, 1 - phase) / 0.12);
      return {
        x: wave * driftAmplitude,
        y: phase * 0.2 - 0.1,
        rotation: wave * 12,
        scale: 1,
        opacity: respawnFade,
      };
    }
    case 'burst': {
      const angle = instance.phase * TAU;
      const burstPhase = wrap01(progress * cycles);
      const envelope = Math.sin(burstPhase * Math.PI);
      const radius = envelope * 0.09;
      return {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        rotation: burstPhase * 90,
        scale: 0.82 + envelope * 0.28,
        opacity: clamp01(envelope / 0.15),
      };
    }
    case 'orbit':
      return {x: cosine * 0.035, y: wave * 0.035, rotation: phase * 360, scale: 1, opacity: 1};
    case 'drift':
    default:
      return {x: wave * driftAmplitude, y: cosine * 0.016, rotation: wave * 7, scale: 1, opacity: 1};
  }
};

export const resolveWorldBoundMotifX = ({
  instanceX,
  localOffsetX,
  worldDisplacementPx,
  viewportWidth,
  bounds,
}) => {
  if (!(Number.isFinite(viewportWidth) && viewportWidth > 0)) {
    throw new Error('world-bound motif viewportWidth 必须大于 0。');
  }
  const normalizedBounds = normalizeBounds(bounds);
  if (!(Number.isFinite(normalizedBounds.width) && normalizedBounds.width > 0)) {
    throw new Error('world-bound motif bounds.width 必须大于 0。');
  }
  const localX = instanceX - normalizedBounds.x;
  const displacement = worldDisplacementPx / viewportWidth;
  return normalizedBounds.x + wrap01(
    (localX + localOffsetX + displacement) / normalizedBounds.width,
  ) * normalizedBounds.width;
};

export const verifyMotifFieldLoop = ({preset, cycles}) => {
  const instance = {phase: 0};
  const period = 1 / cycles;
  const epsilon = Math.min(1e-5, period / 1000);
  const before = resolveMotifFieldMotion({
    instance,
    preset,
    progress: period - epsilon,
    cycles,
  });
  const after = resolveMotifFieldMotion({
    instance,
    preset,
    progress: period,
    cycles,
  });
  const rotationDelta = Math.abs(
    ((((before.rotation - after.rotation) % 360) + 540) % 360) - 180,
  ) / 360;
  const transformDelta = Math.max(
    Math.abs(before.x - after.x),
    Math.abs(before.y - after.y),
    Math.abs(before.scale - after.scale),
    rotationDelta,
  );
  const edgeOpacity = Math.max(before.opacity, after.opacity);
  return {
    passed: transformDelta <= 0.001 || edgeOpacity <= 0.001,
    transformDelta,
    edgeOpacity,
  };
};
