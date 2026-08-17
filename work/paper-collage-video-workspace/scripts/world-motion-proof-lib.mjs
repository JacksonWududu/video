import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {flattenCompositionNodes, hashCompositionValue} from './composition-lib.mjs';
import {fileExists, resolvePublicFile} from './project-lib.mjs';
import {resolveParallaxState} from '../src/parallax.mjs';
import {
  inspectWorldStripCoverage,
  resolveWorldStripCopies,
  resolveWorldStripFrame,
  resolveWorldStripSpeedFactor,
  resolveWorldStripTileGeometry,
} from '../src/worldStrip.mjs';
import {resolveSequenceState} from './state-sequence-lib.mjs';

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const clamp01 = (value) => clamp(value, 0, 1);
const cleanNumber = (value) => Number(value.toFixed(6));
const EDITABLE_SHAPE_MINIMUM_SCREEN_OCCUPANCY = 0.00025;

export const evaluateNearLayerRelation = ({
  nearOcclusion,
  requireNearOverlap = true,
  subjectZ,
  nearStripZ,
  verticalOverlap,
  hasSubjectGeometry,
  hasNearGeometry,
}) => {
  const zPassed = nearOcclusion === 'behind-near'
    ? nearStripZ > subjectZ
    : subjectZ > nearStripZ;
  return Boolean(
    hasSubjectGeometry &&
    hasNearGeometry &&
    zPassed &&
    (
      nearOcclusion === 'above-near' ||
      requireNearOverlap === false ||
      verticalOverlap >= 0.02
    )
  );
};

const ease = (value, name = 'ease-in-out') => {
  const t = clamp01(value);
  if (name === 'linear') return t;
  if (name === 'ease-in') return t * t;
  if (name === 'ease-out') return 1 - (1 - t) ** 2;
  if (name === 'hold') return 0;
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
};

const resolveKeyframeValue = (keyframes, progress, property, fallback) => {
  const sorted = [...(keyframes ?? [])].sort((left, right) => left.at - right.at);
  if (sorted.length === 0) return fallback;
  if (progress <= sorted[0].at) return sorted[0][property] ?? fallback;
  if (progress >= sorted.at(-1).at) return sorted.at(-1)[property] ?? fallback;
  const rightIndex = sorted.findIndex(({at}) => at >= progress);
  const left = sorted[rightIndex - 1];
  const right = sorted[rightIndex];
  const amount = ease(
    (progress - left.at) / Math.max(1e-9, right.at - left.at),
    right.ease,
  );
  return (left[property] ?? fallback) +
    ((right[property] ?? fallback) - (left[property] ?? fallback)) * amount;
};

const cameraFrames = (scene) =>
  scene.camera?.keyframes?.length >= 2
    ? [...scene.camera.keyframes].sort((left, right) => left.at - right.at)
    : scene.camera?.preset === 'static'
      ? [{at: 0, x: 0, y: 0, zoom: 1}, {at: 1, x: 0, y: 0, zoom: 1}]
      : [{at: 0, x: -10, y: 0, zoom: 1.01}, {at: 1, x: 18, y: 0, zoom: 1.028}];

const cameraAt = (scene, progress) => {
  const frames = cameraFrames(scene);
  return {
    x: resolveKeyframeValue(frames, progress, 'x', 0),
    y: resolveKeyframeValue(frames, progress, 'y', 0),
    zoom: resolveKeyframeValue(frames, progress, 'zoom', 1),
  };
};

const nodeEntry = (scene, nodeId, video) => {
  let result = null;
  const visit = (nodes, parentRect) => {
    for (const node of nodes ?? []) {
      const transform = node.transform ?? {};
      const width = Number(transform.width ?? 1) * parentRect.width;
      const height = node.kind === 'group'
        ? (
            transform.height === undefined
              ? width * node.coordinateSpace.height / node.coordinateSpace.width
              : Number(transform.height) * parentRect.height
          )
        : node.kind === 'state-sequence' && transform.height === undefined
          ? width * node.registration.canvas.height / node.registration.canvas.width
          : Number(transform.height ?? 1) * parentRect.height;
      const rect = {
        left:
          parentRect.left +
          Number(transform.x ?? 0) * parentRect.width -
          Number(transform.anchorX ?? 0) * width,
        top:
          parentRect.top +
          Number(transform.y ?? 0) * parentRect.height -
          Number(transform.anchorY ?? 0) * height,
        width,
        height,
      };
      if (node.id === nodeId) result = {node, parentRect, rect};
      if (node.kind === 'group') visit(node.children, rect);
    }
  };
  visit(scene.composition?.nodes, {left: 0, top: 0, width: video.width, height: video.height});
  return result;
};

const alphaBoundsForSource = async (source) => {
  const file = resolvePublicFile(source);
  if (!(await fileExists(file))) return null;
  const {data, info} = await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject: true});
  let left = info.width;
  let right = -1;
  let top = info.height;
  let bottom = -1;
  const alpha = info.channels - 1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * info.channels + alpha] <= 8) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) {
    return {x: 0, y: 0, width: 0, height: 0};
  }
  return {
    x: left / info.width,
    y: top / info.height,
    width: (right - left + 1) / info.width,
    height: (bottom - top + 1) / info.height,
  };
};

const sourceForNode = (node, progress) => {
  if (node.kind === 'asset') return node.src;
  if (node.kind !== 'state-sequence') return null;
  return resolveSequenceState({node, progress})?.src ?? null;
};

const visualIsolationForNode = async (node, progress) => {
  const source = sourceForNode(node, progress);
  if (source) {
    const alphaBounds = await alphaBoundsForSource(source);
    return {
      source,
      sourceKind: 'asset',
      alphaBounds,
    };
  }
  if (node.kind === 'group') {
    const bounds = [];
    for (const child of node.children ?? []) {
      const isolation = await visualIsolationForNode(child, progress);
      if (!isolation?.alphaBounds) continue;
      const width = Number(child.transform?.width ?? 1);
      const height = Number(child.transform?.height ?? width);
      const left =
        Number(child.transform?.x ?? 0) -
        Number(child.transform?.anchorX ?? 0) * width +
        isolation.alphaBounds.x * width;
      const top =
        Number(child.transform?.y ?? 0) -
        Number(child.transform?.anchorY ?? 0) * height +
        isolation.alphaBounds.y * height;
      bounds.push({
        left,
        top,
        right: left + isolation.alphaBounds.width * width,
        bottom: top + isolation.alphaBounds.height * height,
      });
    }
    if (bounds.length > 0) {
      const left = Math.min(...bounds.map((bound) => bound.left));
      const top = Math.min(...bounds.map((bound) => bound.top));
      const right = Math.max(...bounds.map((bound) => bound.right));
      const bottom = Math.max(...bounds.map((bound) => bound.bottom));
      return {
        source: `group:${node.id}`,
        sourceKind: 'composition-group',
        alphaBounds: {
          x: left,
          y: top,
          width: right - left,
          height: bottom - top,
        },
      };
    }
  }
  if (node.kind === 'shape') {
    return {
      source: `shape:${node.shape}`,
      sourceKind: 'editable-shape',
      alphaBounds: {x: 0, y: 0, width: 1, height: 1},
    };
  }
  return null;
};

export const resolveTargetViewportSnapshot = async ({
  scene,
  nodeId,
  progress,
  video,
  worldAnchorOffsetX = 0,
}) => {
  const entry = nodeEntry(scene, nodeId, video);
  if (!entry) throw new Error(`worldMotionProof target 不存在：${nodeId}`);
  const isolation = await visualIsolationForNode(entry.node, progress);
  if (!isolation) {
    throw new Error(`worldMotionProof target ${nodeId} 没有可隔离的视觉来源。`);
  }
  const {source, sourceKind, alphaBounds: alpha} = isolation;
  if (!alpha) throw new Error(`worldMotionProof target ${nodeId} 来源不存在：${source}`);
  const authored = {
    x: resolveKeyframeValue(entry.node.motion?.keyframes, progress, 'offsetX', 0),
    y: resolveKeyframeValue(entry.node.motion?.keyframes, progress, 'offsetY', 0),
    scale: resolveKeyframeValue(entry.node.motion?.keyframes, progress, 'scale', 1),
  };
  const camera = cameraAt(scene, progress);
  const parallax = resolveParallaxState({
    depth: entry.node.depth ?? 0,
    cameraX: camera.x,
    cameraY: camera.y,
    cameraZoom: camera.zoom,
    parallax: scene.camera?.parallax,
  });
  const scale = Number(entry.node.transform?.scale ?? 1) * authored.scale * parallax.scale;
  const nodeRect = {
    left: entry.rect.left + authored.x * entry.parentRect.width + parallax.x + worldAnchorOffsetX,
    top: entry.rect.top + authored.y * entry.parentRect.height + parallax.y,
    width: entry.rect.width * scale,
    height: entry.rect.height * scale,
  };
  const isolated = {
    left: nodeRect.left + alpha.x * nodeRect.width,
    top: nodeRect.top + alpha.y * nodeRect.height,
    width: alpha.width * nodeRect.width,
    height: alpha.height * nodeRect.height,
  };
  const origin = {x: video.width * 0.5, y: video.height * 0.54};
  const cameraRect = {
    left: (isolated.left - origin.x) * camera.zoom + origin.x + camera.x,
    top: (isolated.top - origin.y) * camera.zoom + origin.y + camera.y,
    width: isolated.width * camera.zoom,
    height: isolated.height * camera.zoom,
  };
  const visible = {
    left: clamp(cameraRect.left, 0, video.width),
    top: clamp(cameraRect.top, 0, video.height),
    right: clamp(cameraRect.left + cameraRect.width, 0, video.width),
    bottom: clamp(cameraRect.top + cameraRect.height, 0, video.height),
  };
  const area = Math.max(0, cameraRect.width * cameraRect.height);
  const visibleArea = Math.max(0, visible.right - visible.left) * Math.max(0, visible.bottom - visible.top);
  return {
    progress,
    source,
    sourceKind,
    alphaBounds: alpha,
    viewportBounds: Object.fromEntries(Object.entries(cameraRect).map(([key, value]) => [key, cleanNumber(value)])),
    centroid: {
      x: cleanNumber((cameraRect.left + cameraRect.width / 2) / video.width),
      y: cleanNumber((cameraRect.top + cameraRect.height / 2) / video.height),
    },
    visibleAreaRatio: cleanNumber(area === 0 ? 0 : visibleArea / area),
    screenOccupancy: cleanNumber(visibleArea / (video.width * video.height)),
    camera: Object.fromEntries(Object.entries(camera).map(([key, value]) => [key, cleanNumber(value)])),
    authoredDisplacement: {
      x: cleanNumber(authored.x * entry.parentRect.width),
      y: cleanNumber(authored.y * entry.parentRect.height),
    },
  };
};

export const buildTargetWorldMotionProof = async ({
  scene,
  nodeId,
  proofTimes,
  video,
  minimumVisibleAreaRatio = 0.35,
  minimumScreenOccupancy = 0.002,
  maximumScreenOccupancy = 0.85,
  minimumDisplacementRatio = 0.1,
  requireMotion = true,
  worldAnchorOffsetAt = () => 0,
}) => {
  const snapshots = [];
  for (const proof of proofTimes) {
    snapshots.push({
      proofTimeId: proof.id,
      ...await resolveTargetViewportSnapshot({
        scene,
        nodeId,
        progress: proof.at,
        video,
        worldAnchorOffsetX: worldAnchorOffsetAt(proof.at),
      }),
    });
  }
  const first = snapshots[0];
  const last = snapshots.at(-1);
  const effectiveMinimumScreenOccupancy = snapshots.every(
    ({sourceKind}) => sourceKind === 'editable-shape',
  )
    ? Math.min(
        minimumScreenOccupancy,
        EDITABLE_SHAPE_MINIMUM_SCREEN_OCCUPANCY,
      )
    : minimumScreenOccupancy;
  const displacement = first && last ? {
    x: cleanNumber(
      (last.centroid.x - first.centroid.x) * video.width -
      (last.camera.x - first.camera.x),
    ),
    y: cleanNumber(
      (last.centroid.y - first.centroid.y) * video.height -
      (last.camera.y - first.camera.y),
    ),
  } : {x: 0, y: 0};
  const readabilityPassed = snapshots.every(
    ({visibleAreaRatio, screenOccupancy}) =>
      visibleAreaRatio >= minimumVisibleAreaRatio &&
      screenOccupancy >= effectiveMinimumScreenOccupancy &&
      screenOccupancy <= maximumScreenOccupancy,
  );
  const displacementPixels = Math.hypot(displacement.x, displacement.y);
  const motionResolvable =
    displacementPixels >=
    Math.min(video.width, video.height) * minimumDisplacementRatio;
  return {
    schemaVersion: 1,
    targetId: nodeId,
    thresholds: {
      minimumVisibleAreaRatio,
      minimumScreenOccupancy: effectiveMinimumScreenOccupancy,
      maximumScreenOccupancy,
      minimumDisplacementRatio,
      requireMotion,
    },
    snapshots,
    cameraCompensatedDisplacement: displacement,
    displacementPixels: cleanNumber(displacementPixels),
    readabilityPassed,
    motionResolvable,
    passed: readabilityPassed && (!requireMotion || motionResolvable),
  };
};

export const inspectStripVisibleSurface = async ({source, role, surfaceRole, edgeBandPixels = 4}) => {
  const file = resolvePublicFile(source);
  if (!(await fileExists(file))) {
    return {
      source,
      role,
      surfaceRole,
      passed: false,
      reason: 'source-missing',
    };
  }
  const {data, info} = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({resolveWithObject: true});
  const alphaChannel = info.channels - 1;
  const edge = Math.max(1, Math.min(edgeBandPixels, Math.floor(info.width / 4)));
  let visiblePixels = 0;
  let leftVisible = 0;
  let rightVisible = 0;
  let top = info.height;
  let bottom = -1;
  let left = info.width;
  let right = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * info.channels + alphaChannel] <= 8) continue;
      visiblePixels += 1;
      if (x < edge) leftVisible += 1;
      if (x >= info.width - edge) rightVisible += 1;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  const visiblePixelRatio = visiblePixels / (info.width * info.height);
  const leftEdgeSupportRatio = leftVisible / (edge * info.height);
  const rightEdgeSupportRatio = rightVisible / (edge * info.height);
  const horizontalVisibleSpanRatio = right < left
    ? 0
    : (right - left + 1) / info.width;
  const verticalVisibleBand = bottom < top
    ? {top: 0, bottom: 0, height: 0}
    : {
        top: cleanNumber(top / info.height),
        bottom: cleanNumber((bottom + 1) / info.height),
        height: cleanNumber((bottom - top + 1) / info.height),
      };
  const edgeSupportRequired = surfaceRole === 'walkable-ground';
  const minimumHorizontalVisibleSpanRatio = [
    'backdrop',
    'walkable-ground',
  ].includes(surfaceRole)
    ? 0.85
    : 0.25;
  const passed =
    visiblePixelRatio >= 0.002 &&
    horizontalVisibleSpanRatio >= minimumHorizontalVisibleSpanRatio &&
    (
      !edgeSupportRequired ||
      (leftEdgeSupportRatio >= 0.02 && rightEdgeSupportRatio >= 0.02)
    );
  return {
    source,
    role,
    surfaceRole,
    dimensions: {width: info.width, height: info.height},
    thresholds: {
      minimumVisiblePixelRatio: 0.002,
      minimumHorizontalVisibleSpanRatio,
      minimumGroundEdgeSupportRatio: edgeSupportRequired ? 0.02 : null,
    },
    visiblePixelRatio: cleanNumber(visiblePixelRatio),
    horizontalVisibleSpanRatio: cleanNumber(horizontalVisibleSpanRatio),
    leftEdgeSupportRatio: cleanNumber(leftEdgeSupportRatio),
    rightEdgeSupportRatio: cleanNumber(rightEdgeSupportRatio),
    verticalVisibleBand,
    passed,
  };
};

const defaultProfiles = (video) => [
  {profile: '16:9', width: video.width, height: video.height},
  {profile: '9:16', width: 1080, height: 1920},
  {profile: '1:1', width: 1080, height: 1080},
];

export const buildLoopingWorldProof = async ({
  root,
  projectSlug,
  scene,
  group,
  video,
  runtimeBuildFingerprint,
  profiles = defaultProfiles(video),
}) => {
  const environment = group.loopingEnvironment;
  const frozen = environment.travel.frozen === true;
  const proofById = new Map((scene.motion?.proofTimes ?? []).map((proof) => [proof.id, proof]));
  const seamProofs = ['before', 'seam', 'after'].map((key) => proofById.get(environment.seamProofTimeIds[key]));
  const activeUntil = environment.travel.activeUntil ?? null;
  const lockProofs = frozen
    ? (scene.motion?.proofTimes ?? [])
    : activeUntil === null
      ? []
      : (scene.motion?.proofTimes ?? []).filter(({at}) => at >= activeUntil);
  const requiresWorldLock = frozen || activeUntil !== null;
  const strips = [];
  const coverage = [];
  for (const strip of group.children.filter(({kind}) => kind === 'world-strip')) {
    const speedFactor = resolveWorldStripSpeedFactor({
      depth: strip.depth,
      far: environment.speedRange.far,
      near: environment.speedRange.near,
    });
    const activeGeometry = resolveWorldStripTileGeometry({
      viewportWidth: group.coordinateSpace.width,
      viewportHeight: group.coordinateSpace.height,
      renderHeight: strip.transform.height * group.coordinateSpace.height,
      sourceWidth: strip.loopingStripBinding.output.width,
      sourceHeight: strip.loopingStripBinding.output.height,
      overscanPx: environment.overscanPx,
    });
    const snapshots = seamProofs.map((proof) => {
      const frame = resolveWorldStripFrame({
        progress: frozen ? 0 : proof.at,
        viewportWidth: group.coordinateSpace.width,
        tileWidth: activeGeometry.tileWidth,
        direction: environment.travel.direction,
        distanceViewports: environment.travel.distanceViewports,
        speedFactor,
        startPhase: environment.travel.startPhase,
        activeFrom: environment.travel.activeFrom ?? 0,
        activeUntil: environment.travel.activeUntil ?? 1,
        easing: environment.travel.easing,
        overscanPx: environment.overscanPx,
      });
      const proofCoverage = inspectWorldStripCoverage({
        copies: resolveWorldStripCopies({
          firstCopyX: frame.firstCopyX,
          tileWidth: activeGeometry.tileWidth,
          copyCount: activeGeometry.copyCount,
        }),
        viewportWidth: group.coordinateSpace.width,
      });
      return {
        proofTimeId: proof.id,
        at: proof.at,
        travelProgress: cleanNumber(frame.travelProgress),
        phase: cleanNumber(frame.phaseNormalized),
        unwrappedPeriod: cleanNumber(frame.unwrappedPhase / activeGeometry.tileWidth),
        cameraCompensatedDisplacement: cleanNumber(frame.cameraCompensatedDisplacement),
        uncoveredPixels: cleanNumber(proofCoverage.uncoveredPixels),
      };
    });
    const lockedSnapshots = lockProofs.map((proof) => {
      const frame = resolveWorldStripFrame({
        progress: frozen ? 0 : proof.at,
        viewportWidth: group.coordinateSpace.width,
        tileWidth: activeGeometry.tileWidth,
        direction: environment.travel.direction,
        distanceViewports: environment.travel.distanceViewports,
        speedFactor,
        startPhase: environment.travel.startPhase,
        activeFrom: environment.travel.activeFrom ?? 0,
        activeUntil: environment.travel.activeUntil ?? 1,
        easing: environment.travel.easing,
        overscanPx: environment.overscanPx,
      });
      return {
        proofTimeId: proof.id,
        at: proof.at,
        travelProgress: cleanNumber(frame.travelProgress),
        phase: cleanNumber(frame.phaseNormalized),
        cameraCompensatedDisplacement: cleanNumber(frame.cameraCompensatedDisplacement),
      };
    });
    const derivationReportFile = path.join(
      root,
      'dist',
      projectSlug,
      'looping-strip',
      `${strip.loopingStripBinding.stripId}-report.json`,
    );
    const derivationReport = (await fileExists(derivationReportFile))
      ? JSON.parse(await fs.readFile(derivationReportFile, 'utf8'))
      : null;
    const seamPassed =
      derivationReport?.passed === true &&
      derivationReport.derivationFingerprint === strip.loopingStripBinding.derivationFingerprint;
    const visibleSurfaceProof = await inspectStripVisibleSurface({
      source: strip.src,
      role: strip.role,
      surfaceRole: strip.surfaceRole,
      edgeBandPixels: strip.loopingStripBinding.edgeBandPixels,
    });
    strips.push({
      nodeId: strip.id,
      role: strip.role,
      surfaceRole: strip.surfaceRole,
      depth: strip.depth,
      speedFactor: cleanNumber(speedFactor),
      tileWidth: cleanNumber(activeGeometry.tileWidth),
      viewportSpan: cleanNumber(activeGeometry.viewportSpan),
      copyCount: activeGeometry.copyCount,
      wrapCount: Math.floor(
        (frozen ? 0 : environment.travel.distanceViewports) *
        group.coordinateSpace.width *
        speedFactor /
        activeGeometry.tileWidth,
      ),
      seamPassed,
      visibleSurfaceProof,
      derivationReport: derivationReport ? path.relative(root, derivationReportFile) : null,
      snapshots,
      lockedSnapshots,
    });
    for (const profile of profiles) {
      const renderHeight = strip.transform.height * profile.height;
      const geometry = resolveWorldStripTileGeometry({
        viewportWidth: profile.width,
        viewportHeight: profile.height,
        renderHeight,
        sourceWidth: strip.loopingStripBinding.output.width,
        sourceHeight: strip.loopingStripBinding.output.height,
        overscanPx: environment.overscanPx,
      });
      let worstUncovered = 0;
      for (let index = 0; index <= 64; index += 1) {
        const phase = index / 64;
        const copies = resolveWorldStripCopies({
          firstCopyX: phase * geometry.tileWidth - geometry.tileWidth - environment.overscanPx,
          tileWidth: geometry.tileWidth,
          copyCount: geometry.copyCount,
        });
        worstUncovered = Math.max(
          worstUncovered,
          inspectWorldStripCoverage({copies, viewportWidth: profile.width}).uncoveredPixels,
        );
      }
      coverage.push({
        nodeId: strip.id,
        profile: profile.profile,
        viewportSpan: cleanNumber(geometry.viewportSpan),
        copyCount: geometry.copyCount,
        uncoveredPixels: cleanNumber(worstUncovered),
      });
    }
  }
  const speedOrdered = strips.every(
    (strip, index) => index === 0 || strip.speedFactor > strips[index - 1].speedFactor,
  );
  const ground = strips.find(({nodeId}) => nodeId === environment.groundStripId);
  const groundCrossedSeam = ground
    ? Math.floor(ground.snapshots[0].unwrappedPeriod) !==
      Math.floor(ground.snapshots.at(-1).unwrappedPeriod)
    : false;
  const worldLockClean = requiresWorldLock && strips.every(({lockedSnapshots}) => {
    const expectedProgress = frozen ? 0 : 1;
    const expectedDisplacement = lockedSnapshots[0]?.cameraCompensatedDisplacement;
    return lockedSnapshots.length > 0 && lockedSnapshots.every(({travelProgress, cameraCompensatedDisplacement}) =>
      travelProgress === expectedProgress && cameraCompensatedDisplacement === expectedDisplacement,
    );
  });
  const nearStrip = group.children.find(
    ({kind, role}) => kind === 'world-strip' && role === 'near',
  );
  const nearAlpha = nearStrip
    ? await alphaBoundsForSource(nearStrip.src)
    : null;
  const nearTop =
    (nearStrip?.transform?.y ?? 0) +
    (nearAlpha?.y ?? 0) * (nearStrip?.transform?.height ?? 1);
  const nearBottom =
    nearTop +
    (nearAlpha?.height ?? 0) * (nearStrip?.transform?.height ?? 1);
  const groundStrip = group.children.find(
    ({kind, id}) => kind === 'world-strip' && id === environment.groundStripId,
  );
  const groundSpeedFactor = groundStrip
    ? resolveWorldStripSpeedFactor({
        depth: groundStrip.depth,
        far: environment.speedRange.far,
        near: environment.speedRange.near,
      })
    : 0;
  const worldAnchorOffsetAt = (progress) => resolveWorldStripFrame({
    progress: frozen ? 0 : progress,
    viewportWidth: group.coordinateSpace.width,
    tileWidth: group.coordinateSpace.width,
    direction: environment.travel.direction,
    distanceViewports: environment.travel.distanceViewports,
    speedFactor: groundSpeedFactor,
    startPhase: environment.travel.startPhase,
    activeFrom: environment.travel.activeFrom ?? 0,
    activeUntil: environment.travel.activeUntil ?? 1,
    easing: environment.travel.easing,
    overscanPx: environment.overscanPx,
  }).cameraCompensatedDisplacement;
  const subjectProofs = [];
  const subjectOcclusions = [];
  for (const binding of environment.subjectBindings ?? []) {
    const subject = group.children.find(({id}) => id === binding.nodeId);
    const bindingProofs = binding.proofTimeIds
      .map((id) => proofById.get(id))
      .filter(Boolean)
      .sort((left, right) => left.at - right.at);
    const subjectProof = await buildTargetWorldMotionProof({
      scene,
      nodeId: binding.nodeId,
      proofTimes: bindingProofs,
      video,
      minimumVisibleAreaRatio: binding.anchorMode === 'world' ? 0.1 : 0.55,
      minimumScreenOccupancy: 0.002,
      maximumScreenOccupancy: 0.45,
      minimumDisplacementRatio: 0.1,
      requireMotion: binding.anchorMode === 'world',
      worldAnchorOffsetAt:
        binding.anchorMode === 'world' ? worldAnchorOffsetAt : () => 0,
    });
    subjectProofs.push({...binding, proof: subjectProof});
    const subjectIsolation = subject
      ? await visualIsolationForNode(subject, bindingProofs[0].at)
      : null;
    const subjectAlpha = subjectIsolation?.alphaBounds ?? null;
    const subjectHeight =
      subject?.transform?.height ??
      (
        subject?.kind === 'group'
          ? Number(subject.transform?.width ?? 1) *
            Number(subject.coordinateSpace?.height ?? 1) /
            Number(subject.coordinateSpace?.width ?? 1) *
            video.width /
            video.height
          : 1
      );
    const subjectTop =
      (subject?.transform?.y ?? 0) -
      (subject?.transform?.anchorY ?? 0) *
        subjectHeight +
      (subjectAlpha?.y ?? 0) * subjectHeight;
    const subjectBottom =
      subjectTop +
      (subjectAlpha?.height ?? 0) *
        subjectHeight;
    const verticalOverlap = Math.max(
      0,
      Math.min(subjectBottom, nearBottom) - Math.max(subjectTop, nearTop),
    );
    const requireNearOverlap = binding.requireNearOverlap !== false;
    subjectOcclusions.push({
      nodeId: binding.nodeId,
      requiredRelation: binding.nearOcclusion,
      requireNearOverlap,
      subjectZ: subject?.z ?? null,
      nearStripZ: nearStrip?.z ?? null,
      subjectVerticalBand: {
        top: cleanNumber(subjectTop),
        bottom: cleanNumber(subjectBottom),
      },
      nearStripVerticalBand: {
        top: cleanNumber(nearTop),
        bottom: cleanNumber(nearBottom),
      },
      verticalOverlap: cleanNumber(verticalOverlap),
      passed: evaluateNearLayerRelation({
        nearOcclusion: binding.nearOcclusion,
        requireNearOverlap,
        subjectZ: subject?.z,
        nearStripZ: nearStrip?.z,
        verticalOverlap,
        hasSubjectGeometry: Boolean(subjectAlpha),
        hasNearGeometry: Boolean(nearAlpha && nearStrip),
      }),
    });
  }
  const trackedSubjectProof = subjectProofs.find(({role}) => role === 'tracked')?.proof ?? null;
  const foregroundOcclusion = subjectOcclusions.find(
    ({nodeId}) =>
      nodeId === environment.subjectBindings?.find(({role}) => role === 'tracked')?.nodeId,
  ) ?? null;
  const groundWorldDisplacement = ground
    ? Math.abs(ground.snapshots.at(-1).cameraCompensatedDisplacement - ground.snapshots[0].cameraCompensatedDisplacement)
    : 0;
  const groundSignedWorldDisplacement = ground
    ? ground.snapshots.at(-1).cameraCompensatedDisplacement -
      ground.snapshots[0].cameraCompensatedDisplacement
    : 0;
  const expectedDirectionSign = environment.travel.direction === 'left' ? -1 : 1;
  const signedDirectionProof = {
    direction: environment.travel.direction,
    expectedSign: expectedDirectionSign,
    actualSignedDisplacement: cleanNumber(groundSignedWorldDisplacement),
    passed:
      frozen ||
      Math.sign(groundSignedWorldDisplacement) === expectedDirectionSign,
  };
  const groundTotalWorldDisplacement = ground
    ? Math.abs(
        (frozen ? 0 : environment.travel.distanceViewports) *
        group.coordinateSpace.width *
        ground.speedFactor,
      )
    : 0;
  const proof = {
    schemaVersion: 1,
    groupId: group.id,
    subjectBindings: environment.subjectBindings,
    activeFrom: environment.travel.activeFrom ?? 0,
    activeUntil,
    easing: environment.travel.easing,
    frozen,
    lockProofTimeIds: lockProofs.map(({id}) => id),
    runtimeBuildFingerprint,
    strips,
    coverage,
    speedOrdered,
    groundCrossedSeam,
    worldLockClean,
    groundWorldDisplacement: cleanNumber(groundWorldDisplacement),
    signedDirectionProof,
    groundTotalWorldDisplacement: cleanNumber(groundTotalWorldDisplacement),
    trackedSubjectProof,
    foregroundOcclusion,
    subjectProofs,
    subjectOcclusions,
  };
  proof.fingerprint = hashCompositionValue({
    runtimeBuildFingerprint,
    group,
    camera: scene.camera,
    proofTimes: seamProofs,
    stripBindings: strips.map(({nodeId, seamPassed, derivationReport}) => ({nodeId, seamPassed, derivationReport})),
  });
  proof.passed =
    strips.length >= 2 &&
    strips.every(({seamPassed, visibleSurfaceProof}) =>
      seamPassed && visibleSurfaceProof.passed) &&
    speedOrdered &&
    signedDirectionProof.passed &&
    (frozen || (groundCrossedSeam && groundTotalWorldDisplacement >= video.width)) &&
    (!requiresWorldLock || worldLockClean) &&
    coverage.every(({uncoveredPixels, viewportSpan}) =>
      uncoveredPixels === 0 && viewportSpan >= 1,
    ) &&
    subjectProofs.length === environment.subjectBindings.length &&
    subjectProofs.every(({proof: subjectProof}) => subjectProof.passed) &&
    subjectOcclusions.every(({passed}) => passed);
  return proof;
};

export const buildTraverseWorldMotionProofs = async ({
  project,
  scene,
  storyboardScene,
}) => {
  const proofs = [];
  for (const planned of storyboardScene?.compositionPlan?.continuousMotions ?? []) {
    if (planned.preset !== 'traverse') continue;
    const bound = (scene.motion?.proofTimes ?? []).filter(
      (proof) => proof.id === planned.proofTimeId || ['establish', 'final'].includes(proof.kind),
    );
    if (bound.length < 2) continue;
    proofs.push(await buildTargetWorldMotionProof({
      scene,
      nodeId: planned.nodeId,
      proofTimes: bound.sort((left, right) => left.at - right.at),
      video: project.video,
    }));
  }
  return proofs;
};
