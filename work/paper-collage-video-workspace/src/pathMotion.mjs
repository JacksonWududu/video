const clamp = (value, minimum, maximum) =>
  Math.max(minimum, Math.min(maximum, value));
const clamp01 = (value) => clamp(value, 0, 1);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const pointIsFinite = (point) =>
  point && finite(point.x) && finite(point.y);
const pathPointIsFinite = (point) =>
  point && finite(point.x) && finite(point.y) && finite(point.z);
const EPSILON = 1e-9;
const GEOMETRY_SAMPLES_PER_SEGMENT = 256;

const ease = (value, name = 'linear') => {
  const t = clamp01(value);
  if (name === 'ease-in') return t * t;
  if (name === 'ease-out') return 1 - (1 - t) * (1 - t);
  if (name === 'ease-in-out') {
    return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  }
  if (name === 'hold') return 0;
  return t;
};

const cubicPoint = (start, control1, control2, end, t) => {
  const oneMinus = 1 - t;
  const a = oneMinus ** 3;
  const b = 3 * oneMinus ** 2 * t;
  const c = 3 * oneMinus * t ** 2;
  const d = t ** 3;
  return {
    x: a * start.x + b * control1.x + c * control2.x + d * end.x,
    y: a * start.y + b * control1.y + c * control2.y + d * end.y,
    z: a * start.z + b * control1.z + c * control2.z + d * end.z,
  };
};

const cubicDerivative = (start, control1, control2, end, t) => {
  const oneMinus = 1 - t;
  return {
    x:
      3 * oneMinus ** 2 * (control1.x - start.x) +
      6 * oneMinus * t * (control2.x - control1.x) +
      3 * t ** 2 * (end.x - control2.x),
    y:
      3 * oneMinus ** 2 * (control1.y - start.y) +
      6 * oneMinus * t * (control2.y - control1.y) +
      3 * t ** 2 * (end.y - control2.y),
    z:
      3 * oneMinus ** 2 * (control1.z - start.z) +
      6 * oneMinus * t * (control2.z - control1.z) +
      3 * t ** 2 * (end.z - control2.z),
  };
};

const circularDeltaDegrees = (from, to) => {
  let delta = (to - from) % 360;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
};

export const angleDifferenceDegrees = (left, right) =>
  Math.abs(circularDeltaDegrees(left, right));

const pathCache = new Map();
const frameCache = new Map();
const cameraCache = new Map();

const cacheKey = (value) => JSON.stringify(value);

const buildGeometry = (
  pathMotion,
  parentWidth = 1,
  parentHeight = 1,
) => {
  const minimumDimension = Math.max(
    EPSILON,
    Math.min(parentWidth, parentHeight),
  );
  const scaleX = parentWidth / minimumDimension;
  const scaleY = parentHeight / minimumDimension;
  const scaleZ = pathMotion.projection.depthDistanceScale;
  const key = cacheKey({
    start: pathMotion.start,
    segments: pathMotion.segments,
    scaleX,
    scaleY,
    scaleZ,
  });
  const cached = pathCache.get(key);
  if (cached) return cached;

  const samples = [];
  let segmentStart = pathMotion.start;
  let totalLength = 0;
  let previousPoint = segmentStart;
  for (const [segmentIndex, segment] of pathMotion.segments.entries()) {
    for (
      let sampleIndex = 0;
      sampleIndex <= GEOMETRY_SAMPLES_PER_SEGMENT;
      sampleIndex += 1
    ) {
      if (segmentIndex > 0 && sampleIndex === 0) continue;
      const t = sampleIndex / GEOMETRY_SAMPLES_PER_SEGMENT;
      const point = cubicPoint(
        segmentStart,
        segment.control1,
        segment.control2,
        segment.end,
        t,
      );
      if (samples.length > 0) {
        totalLength += Math.hypot(
          (point.x - previousPoint.x) * scaleX,
          (point.y - previousPoint.y) * scaleY,
          (point.z - previousPoint.z) * scaleZ,
        );
      }
      samples.push({
        segmentIndex,
        t,
        point,
        cumulativeLength: totalLength,
      });
      previousPoint = point;
    }
    segmentStart = segment.end;
  }

  const geometry = {samples, totalLength, scaleX, scaleY, scaleZ};
  pathCache.set(key, geometry);
  return geometry;
};

const segmentStartFor = (pathMotion, segmentIndex) =>
  segmentIndex === 0
    ? pathMotion.start
    : pathMotion.segments[segmentIndex - 1].end;

const sampleGeometry = (
  pathMotion,
  normalizedDistance,
  parentWidth = 1,
  parentHeight = 1,
) => {
  const geometry = buildGeometry(pathMotion, parentWidth, parentHeight);
  const targetLength = clamp01(normalizedDistance) * geometry.totalLength;
  let low = 0;
  let high = geometry.samples.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (geometry.samples[middle].cumulativeLength < targetLength) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  const right = geometry.samples[low];
  const left = geometry.samples[Math.max(0, low - 1)];
  const span = Math.max(
    EPSILON,
    right.cumulativeLength - left.cumulativeLength,
  );
  const amount = clamp01(
    (targetLength - left.cumulativeLength) / span,
  );
  const sameSegment = left.segmentIndex === right.segmentIndex;
  const segmentIndex = right.segmentIndex;
  const t = sameSegment
    ? left.t + (right.t - left.t) * amount
    : right.t * amount;
  const segment = pathMotion.segments[segmentIndex];
  const start = segmentStartFor(pathMotion, segmentIndex);
  const point = cubicPoint(
    start,
    segment.control1,
    segment.control2,
    segment.end,
    t,
  );
  let tangent = cubicDerivative(
    start,
    segment.control1,
    segment.control2,
    segment.end,
    t,
  );
  if (Math.hypot(tangent.x, tangent.y, tangent.z) < EPSILON) {
    const before = geometry.samples[Math.max(0, low - 1)]?.point ?? point;
    const after =
      geometry.samples[Math.min(geometry.samples.length - 1, low + 1)]?.point ??
      point;
    tangent = {
      x: after.x - before.x,
      y: after.y - before.y,
      z: after.z - before.z,
    };
  }
  const screenTangentLength = Math.hypot(
    tangent.x * geometry.scaleX,
    tangent.y * geometry.scaleY,
  );
  const headingDegrees =
    Math.atan2(
      tangent.y * geometry.scaleY,
      tangent.x * geometry.scaleX,
    ) * 180 / Math.PI;
  const depthAmount = clamp01((point.z + 1) / 2);
  const projection = pathMotion.projection;
  return {
    x: point.x,
    y: point.y,
    z: point.z,
    depthVelocity: tangent.z,
    depthDirection:
      Math.abs(tangent.z) < EPSILON
        ? 'planar'
        : tangent.z > 0
          ? 'toward-camera'
          : 'away-camera',
    projectionScale:
      projection.farScale +
      (projection.nearScale - projection.farScale) * depthAmount,
    projectionOpacity:
      projection.farOpacity +
      (projection.nearOpacity - projection.farOpacity) * depthAmount,
    projectionBlurPx:
      projection.farBlurPx +
      (projection.nearBlurPx - projection.farBlurPx) * depthAmount,
    depthOrder: Math.round(point.z * projection.depthOrderSpan),
    screenTangentLength,
    headingDegrees,
    distance: clamp01(normalizedDistance),
    pathLength: geometry.totalLength,
  };
};

const distanceAtProgress = (pathMotion, progress) => {
  const frames = [...pathMotion.progress].sort(
    (left, right) => left.at - right.at,
  );
  if (progress <= frames[0].at) return frames[0].distance;
  if (progress >= frames.at(-1).at) return frames.at(-1).distance;
  const rightIndex = frames.findIndex(({at}) => at >= progress);
  const left = frames[rightIndex - 1];
  const right = frames[rightIndex];
  const amount = ease(
    (progress - left.at) / Math.max(EPSILON, right.at - left.at),
    right.ease ?? 'linear',
  );
  return left.distance + (right.distance - left.distance) * amount;
};

const buildFrameTable = ({
  pathMotion,
  durationInFrames,
  fps,
  parentWidth = 1,
  parentHeight = 1,
}) => {
  const key = cacheKey({
    pathMotion,
    durationInFrames,
    fps,
    parentWidth,
    parentHeight,
  });
  const cached = frameCache.get(key);
  if (cached) return cached;
  const frameCount = Math.max(1, Math.round(durationInFrames));
  const orientation = pathMotion.orientation;
  const smoothingSeconds = orientation.smoothingSeconds;
  const smoothingAlpha =
    smoothingSeconds <= 0
      ? 1
      : 1 - Math.exp(-1 / Math.max(EPSILON, smoothingSeconds * fps));
  const maximumStep =
    orientation.maximumTurnDegreesPerSecond / Math.max(1, fps);
  const frames = [];
  let previousDesired = null;
  let previousRotation = null;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const progress = frame / Math.max(1, frameCount - 1);
    const distance = distanceAtProgress(pathMotion, progress);
    const geometry = sampleGeometry(
      pathMotion,
      distance,
      parentWidth,
      parentHeight,
    );
    let desiredRotation =
      geometry.screenTangentLength < EPSILON && previousDesired !== null
        ? previousDesired
        : geometry.headingDegrees - orientation.forwardAngleDegrees;
    if (previousDesired !== null) {
      desiredRotation =
        previousDesired +
        circularDeltaDegrees(previousDesired, desiredRotation);
    }
    const smoothed =
      previousRotation === null
        ? desiredRotation
        : previousRotation +
          circularDeltaDegrees(previousRotation, desiredRotation) *
            smoothingAlpha;
    const rotation =
      previousRotation === null
        ? smoothed
        : previousRotation +
          clamp(
            circularDeltaDegrees(previousRotation, smoothed),
            -maximumStep,
            maximumStep,
          );
    frames.push({
      ...geometry,
      rotationDegrees: rotation,
      desiredRotationDegrees: desiredRotation,
    });
    previousDesired = desiredRotation;
    previousRotation = rotation;
  }
  frameCache.set(key, frames);
  return frames;
};

export const resolvePathMotionAtFrame = ({
  pathMotion,
  frame,
  durationInFrames,
  fps,
  parentWidth = 1,
  parentHeight = 1,
}) => {
  if (!pathMotion) {
    return {
      x: 0,
      y: 0,
      z: 0,
      depthVelocity: 0,
      depthDirection: 'planar',
      projectionScale: 1,
      projectionOpacity: 1,
      projectionBlurPx: 0,
      depthOrder: 0,
      screenTangentLength: 0,
      rotationDegrees: 0,
      desiredRotationDegrees: 0,
      headingDegrees: 0,
      distance: 0,
      pathLength: 0,
    };
  }
  const frames = buildFrameTable({
    pathMotion,
    durationInFrames,
    fps,
    parentWidth,
    parentHeight,
  });
  return frames[clamp(Math.round(frame), 0, frames.length - 1)];
};

export const samplePathPolyline = (
  pathMotion,
  count = 97,
  parentWidth = 1,
  parentHeight = 1,
) =>
  Array.from({length: Math.max(2, count)}, (_, index) =>
    sampleGeometry(
      pathMotion,
      index / Math.max(1, count - 1),
      parentWidth,
      parentHeight,
    ),
  );

export const validatePathMotion = (pathMotion) => {
  const issues = [];
  const add = (code, message, location) =>
    issues.push({code, message, location});
  if (!pathMotion || typeof pathMotion !== 'object') {
    add('path-motion-object', 'path motion 必须是对象。', 'path');
    return issues;
  }
  if (pathMotion.kind !== 'cubic-bezier-3d') {
    add(
      'path-motion-kind',
      'path motion.kind 必须是 cubic-bezier-3d。',
      'path.kind',
    );
  }
  if (pathMotion.coordinateSpace !== 'parent-normalized-depth') {
    add(
      'path-motion-coordinate-space',
      '三维路径必须使用 parent-normalized-depth 坐标。',
      'path.coordinateSpace',
    );
  }
  if (!pathPointIsFinite(pathMotion.start)) {
    add(
      'path-motion-start',
      'path.start 必须包含有限 x/y/z。',
      'path.start',
    );
  }
  if (
    !Array.isArray(pathMotion.segments) ||
    pathMotion.segments.length < 1 ||
    pathMotion.segments.length > 32
  ) {
    add(
      'path-motion-segments',
      'path.segments 必须包含 1..32 个三次贝塞尔段。',
      'path.segments',
    );
  } else {
    for (const [index, segment] of pathMotion.segments.entries()) {
      for (const pointName of ['control1', 'control2', 'end']) {
        if (!pathPointIsFinite(segment?.[pointName])) {
          add(
            'path-motion-segment-point',
            `${pointName} 必须包含有限 x/y/z。`,
            `path.segments[${index}].${pointName}`,
          );
        }
      }
    }
  }
  if (!Array.isArray(pathMotion.progress) || pathMotion.progress.length < 2) {
    add(
      'path-motion-progress',
      'path.progress 至少需要两个时间到弧长的关键帧。',
      'path.progress',
    );
  } else {
    let previousAt = -Infinity;
    let previousDistance = -Infinity;
    for (const [index, keyframe] of pathMotion.progress.entries()) {
      const location = `path.progress[${index}]`;
      if (
        !finite(keyframe?.at) ||
        keyframe.at < 0 ||
        keyframe.at > 1 ||
        keyframe.at <= previousAt
      ) {
        add(
          'path-motion-progress-at',
          'path progress.at 必须位于 0..1 且严格递增。',
          `${location}.at`,
        );
      }
      if (
        !finite(keyframe?.distance) ||
        keyframe.distance < 0 ||
        keyframe.distance > 1 ||
        keyframe.distance < previousDistance
      ) {
        add(
          'path-motion-progress-distance',
          'path progress.distance 必须位于 0..1 且单调不减。',
          `${location}.distance`,
        );
      }
      if (
        keyframe?.ease !== undefined &&
        !['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold'].includes(
          keyframe.ease,
        )
      ) {
        add(
          'path-motion-progress-ease',
          `未知 path progress ease：${keyframe.ease}`,
          `${location}.ease`,
        );
      }
      previousAt = keyframe?.at;
      previousDistance = keyframe?.distance;
    }
    if (pathMotion.progress[0]?.distance !== 0) {
      add(
        'path-motion-progress-start',
        'path progress 必须从 distance=0 开始。',
        'path.progress[0].distance',
      );
    }
    if (pathMotion.progress.at(-1)?.distance !== 1) {
      add(
        'path-motion-progress-end',
        'path progress 必须以 distance=1 结束。',
        `path.progress[${pathMotion.progress.length - 1}].distance`,
      );
    }
  }
  const orientation = pathMotion.orientation;
  if (
    orientation?.mode !== 'path-tangent' ||
    !finite(orientation?.forwardAngleDegrees) ||
    orientation.forwardAngleDegrees < -360 ||
    orientation.forwardAngleDegrees > 360 ||
    !finite(orientation?.smoothingSeconds) ||
    orientation.smoothingSeconds < 0 ||
    orientation.smoothingSeconds > 1 ||
    !finite(orientation?.maximumTurnDegreesPerSecond) ||
    orientation.maximumTurnDegreesPerSecond <= 0 ||
    orientation.maximumTurnDegreesPerSecond > 1080
  ) {
    add(
      'path-motion-orientation',
      'orientation 必须声明切线朝向、源素材前向角、0..1 秒平滑和 0..1080°/s 转弯上限。',
      'path.orientation',
    );
  }
  const projection = pathMotion.projection;
  if (
    !projection ||
    !finite(projection.depthDistanceScale) ||
    projection.depthDistanceScale <= 0 ||
    projection.depthDistanceScale > 4 ||
    !finite(projection.farScale) ||
    !finite(projection.nearScale) ||
    projection.farScale <= 0 ||
    projection.nearScale < projection.farScale ||
    projection.nearScale > 4 ||
    !finite(projection.farOpacity) ||
    !finite(projection.nearOpacity) ||
    projection.farOpacity < 0.2 ||
    projection.nearOpacity < projection.farOpacity ||
    projection.nearOpacity > 1 ||
    !finite(projection.farBlurPx) ||
    !finite(projection.nearBlurPx) ||
    projection.farBlurPx < 0 ||
    projection.farBlurPx > 20 ||
    projection.nearBlurPx < 0 ||
    projection.nearBlurPx > projection.farBlurPx ||
    !Number.isInteger(projection.depthOrderSpan) ||
    projection.depthOrderSpan < 1 ||
    projection.depthOrderSpan > 1000
  ) {
    add(
      'path-motion-projection',
      'projection 必须声明合法的深度距离、远近尺寸、透明度、柔化和动态层级跨度。',
      'path.projection',
    );
  }
  for (const [index, point] of [
    pathMotion.start,
    ...(pathMotion.segments ?? []).flatMap(
      ({control1, control2, end}) => [control1, control2, end],
    ),
  ].entries()) {
    if (finite(point?.z) && (point.z < -1 || point.z > 1)) {
      add(
        'path-motion-depth-range',
        '路径 z 必须位于 -1..1；-1 为远处，1 为镜头近处。',
        `path.points[${index}].z`,
      );
    }
  }
  if (issues.length === 0 && buildGeometry(pathMotion).totalLength <= 0.001) {
    add(
      'path-motion-length',
      '三维路径总长度必须大于 0.001 个父画布单位。',
      'path.segments',
    );
  }
  return issues;
};

const findTopLevelNode = (scene, nodeId) =>
  (scene.composition?.nodes ?? []).find(({id}) => id === nodeId) ?? null;

const findCompositionNodeEntry = ({scene, nodeId, video}) => {
  let result = null;
  const visit = (nodes, parentRect, ancestors = []) => {
    for (const node of nodes ?? []) {
      const width = Number(node.transform?.width ?? 1) * parentRect.width;
      const height = node.transform?.height !== undefined
        ? Number(node.transform.height) * parentRect.height
        : node.kind === 'group'
          ? width *
            Number(node.coordinateSpace?.height ?? 1) /
            Number(node.coordinateSpace?.width ?? 1) *
            video.width /
            video.height
          : node.kind === 'state-sequence'
            ? width *
              Number(node.registration?.canvas?.height ?? 1) /
              Number(node.registration?.canvas?.width ?? 1) *
              video.width /
              video.height
            : width * video.width / video.height;
      const rect = {
        x:
          parentRect.x +
          Number(node.transform?.x ?? 0) * parentRect.width -
          Number(node.transform?.anchorX ?? 0) * width,
        y:
          parentRect.y +
          Number(node.transform?.y ?? 0) * parentRect.height -
          Number(node.transform?.anchorY ?? 0) * height,
        width,
        height,
      };
      if (node.id === nodeId) {
        result = {node, parentRect, rect, ancestors};
        return;
      }
      if (node.kind === 'group') {
        visit(node.children, rect, [...ancestors, node]);
        if (result) return;
      }
    }
  };
  visit(
    scene.composition?.nodes,
    {x: 0, y: 0, width: 1, height: 1},
  );
  return result;
};

const isAllowedFollowTarget = (entry) => {
  if (!entry) return false;
  if (entry.ancestors.length === 0) return true;
  if (entry.ancestors.length !== 1) return false;
  const parent = entry.ancestors[0];
  const binding = parent.loopingEnvironment?.subjectBindings?.find(
    ({nodeId}) => nodeId === entry.node.id,
  );
  return (
    parent.pattern === 'looping-environment' &&
    binding?.role === 'tracked' &&
    binding.anchorMode === 'screen'
  );
};

const cameraFrameTable = ({scene, video, fps}) => {
  const follow = scene.camera?.follow;
  const targetEntry = follow
    ? findCompositionNodeEntry({
        scene,
        nodeId: follow.targetNodeId,
        video,
      })
    : null;
  const target = isAllowedFollowTarget(targetEntry)
    ? targetEntry.node
    : null;
  const durationInFrames = scene.durationInFrames;
  const key = cacheKey({
    follow,
    target: target
      ? {
          id: target.id,
          transform: target.transform,
          path: target.motion?.path,
          parentRect: targetEntry.parentRect,
        }
      : null,
    video,
    durationInFrames,
    fps,
  });
  const cached = cameraCache.get(key);
  if (cached) return cached;
  if (!follow || !target?.motion?.path) return null;

  const frameCount = Math.max(1, Math.round(durationInFrames));
  const origin = {x: video.width * 0.5, y: video.height * 0.54};
  const zoom = follow.zoom;
  const alpha =
    follow.smoothingSeconds <= 0
      ? 1
      : 1 -
        Math.exp(-1 / Math.max(EPSILON, follow.smoothingSeconds * fps));
  const bounds = {
    left: follow.worldBounds.x * video.width,
    top: follow.worldBounds.y * video.height,
    right:
      (follow.worldBounds.x + follow.worldBounds.width) * video.width,
    bottom:
      (follow.worldBounds.y + follow.worldBounds.height) * video.height,
  };
  const minimumX =
    video.width - origin.x - zoom * (bounds.right - origin.x);
  const maximumX = -origin.x - zoom * (bounds.left - origin.x);
  const minimumY =
    video.height - origin.y - zoom * (bounds.bottom - origin.y);
  const maximumY = -origin.y - zoom * (bounds.top - origin.y);
  const frames = [];
  let prior = null;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const lookAheadFrame = clamp(
      frame + Math.round(follow.lookAheadSeconds * fps),
      0,
      frameCount - 1,
    );
    const path = resolvePathMotionAtFrame({
      pathMotion: target.motion.path,
      frame: lookAheadFrame,
      durationInFrames: frameCount,
      fps,
      parentWidth: targetEntry.parentRect.width * video.width,
      parentHeight: targetEntry.parentRect.height * video.height,
    });
    const targetPoint = {
      x:
        (
          targetEntry.parentRect.x +
          (target.transform.x + path.x) * targetEntry.parentRect.width
        ) *
        video.width,
      y:
        (
          targetEntry.parentRect.y +
          (target.transform.y + path.y) * targetEntry.parentRect.height
        ) *
        video.height,
    };
    const desired = {
      x:
        follow.framing.x * video.width -
        origin.x -
        zoom * (targetPoint.x - origin.x),
      y:
        follow.framing.y * video.height -
        origin.y -
        zoom * (targetPoint.y - origin.y),
    };
    const smoothed = prior
      ? {
          x: prior.x + (desired.x - prior.x) * alpha,
          y: prior.y + (desired.y - prior.y) * alpha,
        }
      : desired;
    const current = {
      x: clamp(smoothed.x, minimumX, maximumX),
      y: clamp(smoothed.y, minimumY, maximumY),
      zoom,
      targetPoint,
    };
    frames.push(current);
    prior = current;
  }
  cameraCache.set(key, frames);
  return frames;
};

export const resolveCameraFollowAtFrame = ({
  scene,
  video,
  frame,
  fps,
}) => {
  const frames = cameraFrameTable({scene, video, fps});
  if (!frames) return null;
  return frames[clamp(Math.round(frame), 0, frames.length - 1)];
};

export const validateCameraFollow = ({scene, video}) => {
  const follow = scene?.camera?.follow;
  if (!follow) return [];
  const issues = [];
  const add = (code, message, location) =>
    issues.push({code, message, location});
  const targetEntry = findCompositionNodeEntry({
    scene,
    nodeId: follow.targetNodeId,
    video,
  });
  const target = isAllowedFollowTarget(targetEntry)
    ? targetEntry.node
    : null;
  const world = findTopLevelNode(scene, follow.worldNodeId);
  if (!target) {
    add(
      'camera-follow-target',
      'camera.follow.targetNodeId 必须引用顶层节点，或顶层 looping-environment 中 role=tracked、anchorMode=screen 的直接主体。',
      'camera.follow.targetNodeId',
    );
  } else if (!target.motion?.path) {
    add(
      'camera-follow-target-path',
      'camera follow 目标必须实现 motion.path。',
      'camera.follow.targetNodeId',
    );
  }
  if (!world) {
    add(
      'camera-follow-world',
      'camera.follow.worldNodeId 必须引用顶层世界节点。',
      'camera.follow.worldNodeId',
    );
  }
  if (
    !pointIsFinite(follow.framing) ||
    follow.framing.x < 0 ||
    follow.framing.x > 1 ||
    follow.framing.y < 0 ||
    follow.framing.y > 1
  ) {
    add(
      'camera-follow-framing',
      'camera.follow.framing 必须位于归一化画布内。',
      'camera.follow.framing',
    );
  }
  if (
    !finite(follow.lookAheadSeconds) ||
    follow.lookAheadSeconds < 0 ||
    follow.lookAheadSeconds > 2
  ) {
    add(
      'camera-follow-look-ahead',
      'camera.follow.lookAheadSeconds 必须位于 0..2。',
      'camera.follow.lookAheadSeconds',
    );
  }
  if (
    !finite(follow.smoothingSeconds) ||
    follow.smoothingSeconds < 0 ||
    follow.smoothingSeconds > 2
  ) {
    add(
      'camera-follow-smoothing',
      'camera.follow.smoothingSeconds 必须位于 0..2。',
      'camera.follow.smoothingSeconds',
    );
  }
  if (!finite(follow.zoom) || follow.zoom < 0.5 || follow.zoom > 3) {
    add(
      'camera-follow-zoom',
      'camera.follow.zoom 必须位于 0.5..3。',
      'camera.follow.zoom',
    );
  }
  const bounds = follow.worldBounds;
  if (
    !bounds ||
    ![bounds.x, bounds.y, bounds.width, bounds.height].every(finite) ||
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    bounds.width * follow.zoom < 1 ||
    bounds.height * follow.zoom < 1
  ) {
    add(
      'camera-follow-world-bounds',
      'camera.follow.worldBounds 必须是经 zoom 后完整覆盖画布的有限矩形。',
      'camera.follow.worldBounds',
    );
  }
  if (world && bounds) {
    const height = world.transform.height ?? world.transform.width;
    const left = world.transform.x - world.transform.anchorX * world.transform.width;
    const top = world.transform.y - world.transform.anchorY * height;
    const right = left + world.transform.width;
    const bottom = top + height;
    if (
      left > bounds.x + EPSILON ||
      top > bounds.y + EPSILON ||
      right < bounds.x + bounds.width - EPSILON ||
      bottom < bounds.y + bounds.height - EPSILON
    ) {
      add(
        'camera-follow-world-node-bounds',
        'worldNodeId 的可见矩形必须覆盖 camera.follow.worldBounds。',
        'camera.follow.worldNodeId',
      );
    }
  }
  if (scene.camera?.preset !== 'static') {
    add(
      'camera-follow-preset',
      '启用 camera.follow 时 camera.preset 必须为 static，避免两套位移时间轴。',
      'camera.preset',
    );
  }
  if (scene.camera?.keyframes !== undefined) {
    add(
      'camera-follow-keyframes',
      '启用 camera.follow 时不得再声明 camera.keyframes。',
      'camera.keyframes',
    );
  }
  if (video && follow && issues.length === 0) {
    const frames = cameraFrameTable({scene, video, fps: video.fps});
    if (!frames || frames.some(({x, y, zoom}) => ![x, y, zoom].every(finite))) {
      add(
        'camera-follow-resolution',
        'camera follow 无法确定性解析。',
        'camera.follow',
      );
    }
  }
  return issues;
};
