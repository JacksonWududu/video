import {
  EDITORIAL_PROFILE_IDS,
  EDITORIAL_ROUNDING,
  secondsToFrame,
  stableEditorialHash,
} from '../src/editorialPrimitives.mjs';

export const EDITORIAL_CUE_KINDS = Object.freeze([
  'narration-word',
  'narration-phrase',
  'sentence',
  'semantic-emphasis',
  'sfx-onset',
  'sfx-peak',
  'sfx-tail',
  'music-beat',
  'music-bar',
  'music-accent',
  'manual',
]);
export const EDITORIAL_BINDING_TARGETS = Object.freeze([
  'scene-boundary',
  'typography-reveal',
  'typography-emphasis',
  'graphic-action',
  'annotation-lifecycle',
  'data-state',
  'editorial-transition',
]);
export const ADVANCED_TRANSITION_TYPES = Object.freeze([
  'match-cut',
  'graphic-match',
  'shape-match',
  'position-scale-match',
  'color-value-match',
  'within-shot-card-switch',
  'panel-replace',
  'data-state-transition',
]);
export const MATCH_DIMENSIONS = Object.freeze([
  'shape',
  'position',
  'scale',
  'color',
  'value',
]);

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;
const normalizedRectangle = (value) =>
  value &&
  [value.x, value.y, value.width, value.height].every(finite) &&
  value.x >= 0 &&
  value.y >= 0 &&
  value.width > 0 &&
  value.height > 0 &&
  value.x + value.width <= 1 &&
  value.y + value.height <= 1;

const issue = (code, message, location) => ({code, message, location});

export const validateEditorialAuthoring = (editorial, {fps, scenes = []} = {}) => {
  const issues = [];
  const sceneIds = new Set(scenes.map(({id}) => id));
  if (!editorial || typeof editorial !== 'object') {
    return [issue('editorial-required', 'v9 必须声明 editorial。', 'editorial')];
  }
  if (!finite(editorial.timebase?.fps) || editorial.timebase.fps <= 0) {
    issues.push(issue('editorial-timebase-fps', 'editorial.timebase.fps 必须大于 0。', 'editorial.timebase.fps'));
  } else if (finite(fps) && editorial.timebase.fps !== fps) {
    issues.push(issue('editorial-timebase-drift', 'editorial timebase 必须与项目 fps 一致。', 'editorial.timebase.fps'));
  }
  if (!EDITORIAL_ROUNDING.includes(editorial.timebase?.rounding)) {
    issues.push(issue('editorial-rounding', 'timebase.rounding 必须为 nearest、floor 或 ceil。', 'editorial.timebase.rounding'));
  }
  if (!['require', 'phrase-fallback', 'block'].includes(editorial.wordTimingPolicy)) {
    issues.push(issue('editorial-word-policy', '必须明确无词级时间戳时的 require、phrase-fallback 或 block 规则。', 'editorial.wordTimingPolicy'));
  }

  const media = new Map();
  for (const [index, item] of (editorial.media ?? []).entries()) {
    const location = `editorial.media[${index}]`;
    if (!nonEmpty(item.id) || media.has(item.id)) {
      issues.push(issue('editorial-media-id', '媒体 id 缺失或重复。', `${location}.id`));
    }
    if (!nonEmpty(item.src) || !/^[a-f0-9]{64}$/.test(item.sha256 ?? '') || !finite(item.durationSeconds) || item.durationSeconds <= 0) {
      issues.push(issue('editorial-media-proof', '媒体必须声明本地 src、实际 SHA-256 和正 durationSeconds。', location));
    }
    if (!['scene-local', 'global'].includes(item.timelineMode)) {
      issues.push(issue('editorial-media-timeline', '媒体必须声明 scene-local 或 global 时间轴模式。', `${location}.timelineMode`));
    }
    if (item.sceneOffsetSeconds !== undefined && (!finite(item.sceneOffsetSeconds) || item.sceneOffsetSeconds < 0)) {
      issues.push(issue('editorial-media-offset', '媒体 sceneOffsetSeconds 必须是非负数。', `${location}.sceneOffsetSeconds`));
    }
    media.set(item.id, item);
  }

  const cues = new Map();
  for (const [index, cue] of (editorial.cues ?? []).entries()) {
    const location = `editorial.cues[${index}]`;
    if (!nonEmpty(cue.id) || cues.has(cue.id)) issues.push(issue('editorial-cue-id', 'cue id 缺失或重复。', `${location}.id`));
    if (!EDITORIAL_CUE_KINDS.includes(cue.kind)) issues.push(issue('editorial-cue-kind', `未知 cue 类型：${cue.kind}`, `${location}.kind`));
    if (!['authored', 'detected'].includes(cue.source)) issues.push(issue('editorial-cue-source', 'cue.source 必须区分 authored 或 detected。', `${location}.source`));
    if (!['actual-audio', 'manual'].includes(cue.timingBasis)) issues.push(issue('editorial-cue-basis', 'cue.timingBasis 必须为 actual-audio 或 manual。', `${location}.timingBasis`));
    if (cue.source === 'detected' && cue.timingBasis !== 'actual-audio') {
      issues.push(issue('editorial-detected-basis', 'detected cue 必须来自 actual-audio 时间数据。', `${location}.timingBasis`));
    }
    if (cue.kind !== 'manual' && cue.timingBasis !== 'actual-audio') {
      issues.push(issue('editorial-audio-cue-basis', '非 manual cue 必须绑定最终本地音频时间。', `${location}.timingBasis`));
    }
    if (cue.kind === 'manual' && (cue.source !== 'authored' || cue.timingBasis !== 'manual')) {
      issues.push(issue('editorial-manual-cue', 'manual cue 必须同时声明 source=authored 与 timingBasis=manual。', location));
    }
    if (!media.has(cue.mediaId)) issues.push(issue('editorial-cue-media', `cue 引用了未知媒体：${cue.mediaId}`, `${location}.mediaId`));
    if (!sceneIds.has(cue.sceneId)) issues.push(issue('editorial-cue-scene', `cue 引用了未知镜头：${cue.sceneId}`, `${location}.sceneId`));
    if (!finite(cue.atSeconds) || cue.atSeconds < 0) issues.push(issue('editorial-cue-time', 'cue.atSeconds 必须是非负实际媒体时间。', `${location}.atSeconds`));
    const mediaDuration = media.get(cue.mediaId)?.durationSeconds;
    if (finite(mediaDuration) && cue.atSeconds > mediaDuration + 1e-6) {
      issues.push(issue('editorial-cue-duration', 'cue 超出本地媒体时长。', `${location}.atSeconds`));
    }
    if (cue.endSeconds !== undefined && (!finite(cue.endSeconds) || cue.endSeconds <= cue.atSeconds || (finite(mediaDuration) && cue.endSeconds > mediaDuration + 1e-6))) {
      issues.push(issue('editorial-cue-end', 'cue.endSeconds 必须晚于 atSeconds 且不超出本地媒体。', `${location}.endSeconds`));
    }
    if (cue.source === 'detected' && !media.get(cue.mediaId)?.timingDataSrc) {
      issues.push(issue('editorial-detected-timing-proof', 'detected cue 的媒体必须声明 timingDataSrc。', `${location}.mediaId`));
    }
    if (!Number.isInteger(cue.priority) || cue.priority < 0 || cue.priority > 100) issues.push(issue('editorial-cue-priority', 'cue.priority 必须为 0..100 整数。', `${location}.priority`));
    if (!finite(cue.toleranceSeconds) || cue.toleranceSeconds < 0 || cue.toleranceSeconds > 1) issues.push(issue('editorial-cue-tolerance', 'cue.toleranceSeconds 必须位于 0..1。', `${location}.toleranceSeconds`));
    cues.set(cue.id, cue);
  }

  const wordCueScenes = new Set(
    [...cues.values()].filter(({kind}) => kind === 'narration-word').map(({sceneId}) => sceneId),
  );
  const phraseCueScenes = new Set(
    [...cues.values()].filter(({kind}) => kind === 'narration-phrase').map(({sceneId}) => sceneId),
  );
  const wordBindings = (editorial.bindings ?? []).filter(
    ({targetType, mode}) => targetType === 'typography-reveal' && mode === 'word',
  );
  for (const binding of wordBindings) {
    if (wordCueScenes.has(binding.sceneId)) continue;
    if (editorial.wordTimingPolicy === 'phrase-fallback' && phraseCueScenes.has(binding.sceneId)) continue;
    issues.push(issue('editorial-word-timing-missing', `镜头 ${binding.sceneId} 的逐词 reveal 没有词级时间；当前策略不允许降级。`, 'editorial.wordTimingPolicy'));
  }

  const editPointIds = new Set();
  for (const [index, point] of (editorial.editPoints ?? []).entries()) {
    const location = `editorial.editPoints[${index}]`;
    if (!nonEmpty(point.id) || editPointIds.has(point.id)) issues.push(issue('editorial-edit-point-id', 'edit point id 缺失或重复。', `${location}.id`));
    if (!Array.isArray(point.cueIds) || point.cueIds.length === 0 || point.cueIds.some((id) => !cues.has(id))) {
      issues.push(issue('editorial-edit-point-cues', 'edit point 必须引用一个或多个有效 cue。', `${location}.cueIds`));
    } else if (new Set(point.cueIds.map((id) => cues.get(id).sceneId)).size !== 1) {
      issues.push(issue('editorial-edit-point-scene', '同一 edit point 的 cue 必须属于同一镜头。', `${location}.cueIds`));
    }
    if (!['merge', 'highest-priority', 'offset-within-window', 'reject'].includes(point.conflictPolicy)) {
      issues.push(issue('editorial-conflict-policy', 'edit point 必须声明冲突策略。', `${location}.conflictPolicy`));
    }
    editPointIds.add(point.id);
  }
  const sfxByMedia = new Map();
  for (const cue of cues.values()) {
    if (!cue.kind.startsWith('sfx-')) continue;
    const group = sfxByMedia.get(cue.mediaId) ?? {};
    group[cue.kind] = cue.atSeconds;
    sfxByMedia.set(cue.mediaId, group);
  }
  for (const [mediaId, timings] of sfxByMedia) {
    if (
      timings['sfx-onset'] !== undefined &&
      timings['sfx-peak'] !== undefined &&
      timings['sfx-onset'] > timings['sfx-peak']
    ) issues.push(issue('editorial-sfx-order', `SFX ${mediaId} 的 onset 必须不晚于 peak。`, 'editorial.cues'));
    if (
      timings['sfx-peak'] !== undefined &&
      timings['sfx-tail'] !== undefined &&
      timings['sfx-peak'] > timings['sfx-tail']
    ) issues.push(issue('editorial-sfx-order', `SFX ${mediaId} 的 peak 必须不晚于 tail。`, 'editorial.cues'));
  }
  const bindingIds = new Set();
  for (const [index, binding] of (editorial.bindings ?? []).entries()) {
    const location = `editorial.bindings[${index}]`;
    if (!nonEmpty(binding.id) || bindingIds.has(binding.id)) issues.push(issue('editorial-binding-id', 'binding id 缺失或重复。', `${location}.id`));
    if (!EDITORIAL_BINDING_TARGETS.includes(binding.targetType)) issues.push(issue('editorial-binding-target', `未知绑定目标：${binding.targetType}`, `${location}.targetType`));
    if (!editPointIds.has(binding.editPointId)) issues.push(issue('editorial-binding-point', `绑定引用未知 edit point：${binding.editPointId}`, `${location}.editPointId`));
    if (!sceneIds.has(binding.sceneId)) issues.push(issue('editorial-binding-scene', `绑定引用未知镜头：${binding.sceneId}`, `${location}.sceneId`));
    if (binding.offsetSeconds !== undefined && (!finite(binding.offsetSeconds) || Math.abs(binding.offsetSeconds) > 1)) {
      issues.push(issue('editorial-binding-offset', 'binding.offsetSeconds 必须位于 -1..1。', `${location}.offsetSeconds`));
    }
    bindingIds.add(binding.id);
  }

  const profileIds = new Set();
  for (const [index, profile] of (editorial.responsiveProfiles ?? []).entries()) {
    const location = `editorial.responsiveProfiles[${index}]`;
    if (!EDITORIAL_PROFILE_IDS.includes(profile.id) || profileIds.has(profile.id)) issues.push(issue('editorial-profile-id', '响应式 profile 必须唯一覆盖 16:9、9:16、1:1。', `${location}.id`));
    if (!Number.isInteger(profile.width) || !Number.isInteger(profile.height) || profile.width <= 0 || profile.height <= 0) issues.push(issue('editorial-profile-size', '响应式 profile 必须声明正整数画布。', location));
    if (!normalizedRectangle(profile.safeArea)) issues.push(issue('editorial-safe-area', 'safeArea 必须位于归一化画布内。', `${location}.safeArea`));
    if (!Number.isInteger(profile.densityBudget) || profile.densityBudget < 1) issues.push(issue('editorial-density-budget', 'densityBudget 必须为正整数。', `${location}.densityBudget`));
    const exclusionIds = new Set();
    for (const [zoneIndex, zone] of (profile.exclusionZones ?? []).entries()) {
      if (!nonEmpty(zone.id) || exclusionIds.has(zone.id) || !normalizedRectangle(zone)) {
        issues.push(issue('editorial-exclusion-zone', 'exclusion zone 必须有唯一 id 且完整位于画布内。', `${location}.exclusionZones[${zoneIndex}]`));
      }
      exclusionIds.add(zone.id);
    }
    profileIds.add(profile.id);
  }
  for (const required of EDITORIAL_PROFILE_IDS) {
    if (!profileIds.has(required)) issues.push(issue('editorial-profile-missing', `缺少响应式 profile：${required}`, 'editorial.responsiveProfiles'));
  }
  const directingSceneIds = new Set();
  for (const [index, directing] of (editorial.sceneDirecting ?? []).entries()) {
    const location = `editorial.sceneDirecting[${index}]`;
    if (!sceneIds.has(directing.sceneId) || directingSceneIds.has(directing.sceneId)) {
      issues.push(issue('editorial-scene-directing-id', 'sceneDirecting 必须唯一绑定有效镜头。', `${location}.sceneId`));
    }
    const placementIds = new Set();
    for (const [placementIndex, placement] of (directing.placements ?? []).entries()) {
      if (!nonEmpty(placement.targetId) || placementIds.has(placement.targetId)) {
        issues.push(issue('editorial-placement-id', '同一镜头的 placement targetId 必须唯一。', `${location}.placements[${placementIndex}].targetId`));
      }
      for (const [profileId, override] of Object.entries(placement.profileOverrides ?? {})) {
        if (!EDITORIAL_PROFILE_IDS.includes(profileId) || !normalizedRectangle(override)) {
          issues.push(issue('editorial-placement-override', 'placement profile override 必须绑定有效画幅并位于画布内。', `${location}.placements[${placementIndex}].profileOverrides.${profileId}`));
        }
      }
      placementIds.add(placement.targetId);
    }
    directingSceneIds.add(directing.sceneId);
  }
  for (const sceneId of sceneIds) {
    if (!directingSceneIds.has(sceneId)) {
      issues.push(issue('editorial-scene-directing-missing', `镜头 ${sceneId} 缺少响应式导演意图。`, 'editorial.sceneDirecting'));
    }
  }
  return issues;
};

const compileSceneTimings = ({scenes, sceneTransitions, fps}) => {
  const timings = new Map();
  let cursor = 0;
  for (const [index, scene] of scenes.entries()) {
    const incoming = index > 0 ? sceneTransitions[index - 1] : null;
    const overlapFrames = incoming?.treatment?.type === 'cut'
      ? 0
      : Math.max(0, Math.round(Number(incoming?.treatment?.durationSeconds ?? 0) * fps));
    const startFrame = index === 0 ? 0 : Math.max(0, cursor - overlapFrames);
    const durationSeconds = finite(scene.narration?.durationSeconds)
      ? Number(scene.narration.startSeconds ?? 0) +
        scene.narration.durationSeconds +
        Number(scene.tailSeconds ?? 0)
      : Number(scene.estimatedDurationSeconds ?? 1);
    const durationFrames = Math.max(1, Math.ceil(durationSeconds * fps));
    timings.set(scene.id, {
      startFrame,
      narrationStartFrame: Math.round(Number(scene.narration?.startSeconds ?? 0) * fps),
      durationFrames,
    });
    cursor = startFrame + durationFrames;
  }
  return timings;
};

const resolveEditPoint = ({point, cues, media, sceneTimings, fps, rounding}) => {
  const members = point.cueIds.map((id) => cues.get(id)).filter(Boolean);
  const winner = [...members].sort((left, right) =>
    right.priority - left.priority ||
    left.atSeconds - right.atSeconds ||
    left.id.localeCompare(right.id)
  )[0];
  const timingCue = point.conflictPolicy === 'merge'
    ? [...members].sort((left, right) => left.atSeconds - right.atSeconds || left.id.localeCompare(right.id))[0]
    : winner;
  const resolvedSeconds = timingCue.atSeconds;
  const timingMedia = media.get(timingCue.mediaId);
  const sceneTiming = sceneTimings.get(timingCue.sceneId) ?? {
    startFrame: 0,
    narrationStartFrame: 0,
    durationFrames: Number.MAX_SAFE_INTEGER,
  };
  const mediaFrame = secondsToFrame(resolvedSeconds, fps, rounding);
  const offsetFrame = secondsToFrame(
    timingMedia.sceneOffsetSeconds ??
      (timingMedia.kind === 'narration' ? sceneTiming.narrationStartFrame / fps : 0),
    fps,
    rounding,
  );
  const renderFrame = timingMedia.timelineMode === 'global'
    ? mediaFrame + offsetFrame
    : sceneTiming.startFrame + mediaFrame + offsetFrame;
  const sceneFrame = renderFrame - sceneTiming.startFrame;
  if (sceneFrame < 0 || sceneFrame > sceneTiming.durationFrames) {
    throw new Error(`edit point ${point.id} 在镜头 ${timingCue.sceneId} 的最终帧 ${sceneFrame} 越界。`);
  }
  return {
    id: point.id,
    sceneId: timingCue.sceneId,
    cueIds: point.cueIds,
    resolvedSeconds,
    mediaFrame,
    sceneFrame,
    renderFrame,
    priority: point.priority ?? Math.max(...members.map(({priority}) => priority)),
    toleranceSeconds: Math.min(
      point.toleranceSeconds ?? Infinity,
      ...members.map(({toleranceSeconds}) => toleranceSeconds),
    ),
    conflictPolicy: point.conflictPolicy,
    sources: [...new Set(members.map(({source}) => source))].sort(),
    timingBasis: [...new Set(members.map(({timingBasis}) => timingBasis))].sort(),
  };
};

const resolveConflicts = (points, fps) => {
  const groups = new Map();
  for (const point of points) {
    const key = String(point.renderFrame);
    const group = groups.get(key) ?? [];
    group.push(point);
    groups.set(key, group);
  }
  const conflicts = [];
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    const ranked = [...group].sort((left, right) =>
      right.priority - left.priority || left.id.localeCompare(right.id)
    );
    const rejected = ranked.some(({conflictPolicy}) => conflictPolicy === 'reject');
    if (rejected && ranked[0].priority === ranked[1].priority) {
      throw new Error(`edit point 冲突无法解析：${key}（同优先级 reject）`);
    }
    const occupied = new Set([ranked[0].renderFrame]);
    for (const point of ranked.slice(1)) {
      if (point.conflictPolicy !== 'offset-within-window') continue;
      const toleranceFrames = Math.floor(point.toleranceSeconds * fps);
      let resolved = null;
      for (let offset = 1; offset <= toleranceFrames; offset += 1) {
        if (!occupied.has(point.renderFrame + offset)) {
          resolved = point.renderFrame + offset;
          break;
        }
        if (point.renderFrame - offset >= 0 && !occupied.has(point.renderFrame - offset)) {
          resolved = point.renderFrame - offset;
          break;
        }
      }
      if (resolved === null) throw new Error(`edit point ${point.id} 无法在容差窗口内避让。`);
      const delta = resolved - point.renderFrame;
      point.renderFrame = resolved;
      point.sceneFrame += delta;
      point.mediaFrame += delta;
      point.resolvedSeconds = point.mediaFrame / fps;
      occupied.add(resolved);
    }
    conflicts.push({
      sceneId: ranked[0].sceneId,
      sourceRenderFrame: Number(key),
      editPointIds: ranked.map(({id}) => id),
      winnerId: ranked[0].id,
      resolution: rejected ? 'highest-priority' : ranked.some(({conflictPolicy}) => conflictPolicy === 'offset-within-window') ? 'offset-within-window' : 'merged',
    });
  }
  return conflicts;
};

const placementBox = ({role, profile, index}) => {
  const safe = profile.safeArea;
  const defaults = {
    title: {x: safe.x, y: safe.y, width: safe.width, height: safe.height * 0.22},
    subtitle: {x: safe.x, y: safe.y + safe.height * 0.82, width: safe.width, height: safe.height * 0.18},
    subject: {x: safe.x + safe.width * 0.05, y: safe.y + safe.height * 0.2, width: safe.width * 0.5, height: safe.height * 0.58},
    data: {x: safe.x + safe.width * 0.45, y: safe.y + safe.height * 0.23, width: safe.width * 0.52, height: safe.height * 0.52},
    annotation: {x: safe.x + safe.width * 0.55, y: safe.y + safe.height * 0.08, width: safe.width * 0.38, height: safe.height * 0.2},
    card: {x: safe.x + safe.width * 0.12, y: safe.y + safe.height * 0.18, width: safe.width * 0.76, height: safe.height * 0.62},
    motif: {x: safe.x, y: safe.y, width: safe.width, height: safe.height},
  };
  const box = defaults[role] ?? defaults.subject;
  const stagger = Math.min(index, 4) * 0.008;
  return {...box, y: Math.min(box.y + stagger, 1 - box.height)};
};

const compileResponsivePlans = ({editorial, scenes}) =>
  editorial.responsiveProfiles.map((profile) => ({
    profileId: profile.id,
    width: profile.width,
    height: profile.height,
    safeArea: profile.safeArea,
    exclusionZones: profile.exclusionZones ?? [],
    densityBudget: profile.densityBudget,
    scenes: scenes.map((scene) => {
      const intent = editorial.sceneDirecting?.find(({sceneId}) => sceneId === scene.id);
      const placements = (intent?.placements ?? []).map((placement, index) => ({
        ...placement,
        transform: placement.profileOverrides?.[profile.id] ??
          placementBox({role: placement.role, profile, index}),
      }));
      const densityUsed = placements.reduce((sum, placement) => sum + (placement.densityCost ?? 1), 0);
      if (densityUsed > profile.densityBudget) {
        throw new Error(`${scene.id}/${profile.id} density ${densityUsed} 超过预算 ${profile.densityBudget}。`);
      }
      return {
        sceneId: scene.id,
        compositionProfile: intent?.compositionProfile ?? 'editorial-balanced',
        typographyProfile: intent?.typographyProfile ?? profile.id,
        subjectFraming: intent?.subjectFraming ?? {mode: 'contain', focusPoint: {x: 0.5, y: 0.5}},
        parallaxScale: intent?.parallaxScale?.[profile.id] ?? 1,
        cropFocus: intent?.cropFocus?.[profile.id] ?? intent?.subjectFraming?.focusPoint ?? {x: 0.5, y: 0.5},
        densityUsed,
        placements,
      };
    }),
  }));

const anchorFraction = (anchor) => ({
  top: {x: 0.5, y: 0},
  'top-right': {x: 1, y: 0},
  right: {x: 1, y: 0.5},
  'bottom-right': {x: 1, y: 1},
  bottom: {x: 0.5, y: 1},
  'bottom-left': {x: 0, y: 1},
  left: {x: 0, y: 0.5},
  'top-left': {x: 0, y: 0},
  center: {x: 0.5, y: 0.5},
}[anchor] ?? {x: 0.5, y: 0.5});

const findNode = (nodes, targetId) => {
  for (const node of nodes ?? []) {
    if (node.id === targetId) return node;
    if (node.kind === 'group') {
      const nested = findNode(node.children, targetId);
      if (nested) return nested;
    }
    if (node.kind === 'editorial-switch') {
      for (const panel of node.panels ?? []) {
        const nested = findNode([panel.node], targetId);
        if (nested) return nested;
      }
    }
  }
  return null;
};

const transitionNodeColor = (node) =>
  node?.style?.fill ??
  node?.style?.accent ??
  node?.style?.color ??
  node?.treatment?.style?.color ??
  null;

const transitionNodeShape = (node) =>
  node?.shape ??
  node?.graphicKind ??
  node?.annotationKind ??
  node?.kind ??
  null;

const transitionNodeValue = (node) => {
  if (node?.value !== undefined) return stableEditorialHash(node.value);
  if (node?.data !== undefined) return stableEditorialHash(node.data);
  if (node?.text !== undefined) return stableEditorialHash(node.text);
  return null;
};

const resolveTransitionTarget = ({
  reference,
  profilePlan,
  scene,
}) => {
  const node = findNode(scene?.composition?.nodes, reference.targetId);
  const placement =
    profilePlan?.placements?.find(({targetId}) => targetId === reference.targetId)?.transform ??
    null;
  const transform = node?.transform
    ? {...node.transform, ...(placement ?? {})}
    : placement;
  if (!transform) {
    return reference.point
      ? {node: null, transform: null, anchor: reference.point}
      : null;
  }
  const fraction = anchorFraction(reference.anchor);
  return {
    node,
    transform,
    anchor: {
      x: transform.x + (fraction.x - (transform.anchorX ?? 0)) * transform.width,
      y: transform.y +
        (fraction.y - (transform.anchorY ?? 0)) * (transform.height ?? transform.width),
    },
  };
};

const transitionDimensionChecks = ({
  transition,
  sourceTarget,
  destinationTarget,
}) => {
  const tolerance = transition.continuityTolerance;
  const source = sourceTarget?.anchor ?? null;
  const destination = destinationTarget?.anchor ?? null;
  const sourceTransform = sourceTarget?.transform;
  const destinationTransform = destinationTarget?.transform;
  const anchorDistance = source && destination
    ? Math.hypot(source.x - destination.x, source.y - destination.y)
    : null;
  const sourceScale = sourceTransform
    ? {
        width: sourceTransform.width,
        height: sourceTransform.height ?? sourceTransform.width,
      }
    : transition.sourceDescriptor?.width && transition.sourceDescriptor?.height
      ? {
          width: transition.sourceDescriptor.width,
          height: transition.sourceDescriptor.height,
        }
      : null;
  const destinationScale = destinationTransform
    ? {
        width: destinationTransform.width,
        height: destinationTransform.height ?? destinationTransform.width,
      }
    : transition.destinationDescriptor?.width && transition.destinationDescriptor?.height
      ? {
          width: transition.destinationDescriptor.width,
          height: transition.destinationDescriptor.height,
        }
      : null;
  const scaleDistance = sourceScale && destinationScale
    ? Math.max(
        Math.abs(sourceScale.width - destinationScale.width),
        Math.abs(sourceScale.height - destinationScale.height),
      )
    : null;
  const sourceShape = transition.sourceDescriptor?.shape ?? null;
  const destinationShape = transition.destinationDescriptor?.shape ?? null;
  const sourceColor = transition.sourceDescriptor?.color ?? null;
  const destinationColor = transition.destinationDescriptor?.color ?? null;
  const sourceValue = transition.sourceDescriptor?.value ?? null;
  const destinationValue = transition.destinationDescriptor?.value ?? null;
  const all = {
    position: {
      source,
      destination,
      delta: anchorDistance,
      valid: anchorDistance !== null && anchorDistance <= tolerance + 1e-9,
    },
    scale: {
      source: sourceScale,
      destination: destinationScale,
      delta: scaleDistance,
      valid: scaleDistance !== null && scaleDistance <= tolerance + 1e-9,
    },
    shape: {
      source: sourceShape,
      destination: destinationShape,
      valid: sourceShape !== null && sourceShape === destinationShape,
    },
    color: {
      source: sourceColor,
      destination: destinationColor,
      valid: sourceColor !== null && sourceColor === destinationColor,
    },
    value: {
      source: sourceValue,
      destination: destinationValue,
      valid: sourceValue !== null && sourceValue === destinationValue,
    },
  };
  return Object.fromEntries(
    transition.matchDimensions.map((dimension) => [dimension, all[dimension]]),
  );
};

const compileTransitionPlans = ({
  editorial,
  scenes,
  sceneTransitions,
  resolvedEditPoints,
  responsivePlans,
}) => {
  const authored = [
    ...(editorial.transitions ?? []),
    ...sceneTransitions
      .filter(({treatment}) => ['match-cut', 'graphic-match'].includes(treatment?.type))
      .map((transition) => ({
        id: transition.id,
        scope: 'scene-boundary',
        type: transition.treatment.type,
        sceneId: transition.fromSceneId,
        destinationSceneId: transition.toSceneId,
        editPointId: transition.treatment.editPointId,
        semanticIntent: transition.treatment.semanticIntent,
        sourceAnchor: transition.treatment.sourceAnchor,
        destinationAnchor: transition.treatment.destinationAnchor,
        matchDimensions: transition.treatment.matchDimensions,
        continuityTolerance: transition.treatment.continuityTolerance,
        invalidPolicy: transition.treatment.invalidPolicy,
        fallback: transition.treatment.fallback,
      })),
  ];
  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
  const editPointById = new Map(resolvedEditPoints.map((point) => [point.id, point]));
  const bindingByTransition = new Map(
    editorial.bindings
      .filter(({targetType}) => targetType === 'editorial-transition')
      .map((binding) => [binding.targetId, binding]),
  );
  return authored.map((transition) => {
    if (!ADVANCED_TRANSITION_TYPES.includes(transition.type)) throw new Error(`未知高级切换：${transition.type}`);
    if (!nonEmpty(transition.semanticIntent)) throw new Error(`高级切换 ${transition.id} 缺少 semanticIntent。`);
    if (!Array.isArray(transition.matchDimensions) || transition.matchDimensions.some((dimension) => !MATCH_DIMENSIONS.includes(dimension))) {
      throw new Error(`高级切换 ${transition.id} 的 matchDimensions 无效。`);
    }
    for (const dimension of transition.matchDimensions.filter(
      (candidate) => ['shape', 'color', 'value'].includes(candidate),
    )) {
      if (
        transition.sourceDescriptor?.[dimension] === undefined ||
        transition.destinationDescriptor?.[dimension] === undefined
      ) {
        throw new Error(`高级切换 ${transition.id} 的 ${dimension} 匹配缺少 source/destination descriptor。`);
      }
    }
    if (!finite(transition.continuityTolerance) || transition.continuityTolerance < 0 || transition.continuityTolerance > 1) {
      throw new Error(`高级切换 ${transition.id} 的 continuityTolerance 无效。`);
    }
    if (!['reject', 'fallback'].includes(transition.invalidPolicy)) throw new Error(`高级切换 ${transition.id} 必须声明 invalidPolicy。`);
    if (transition.invalidPolicy === 'fallback' && !transition.fallback) throw new Error(`高级切换 ${transition.id} 缺少 fallback。`);
    const boundaryType = [
      'match-cut',
      'graphic-match',
      'shape-match',
      'position-scale-match',
      'color-value-match',
    ].includes(transition.type);
    if ((transition.scope === 'scene-boundary') !== boundaryType) {
      throw new Error(`高级切换 ${transition.id} 的 scope 与 type 不匹配。`);
    }
    if (boundaryType && transition.treatment !== 'hard-cut') {
      throw new Error(`高级匹配切换 ${transition.id} 必须使用 hard-cut；不得以 crossfade 冒充匹配剪辑。`);
    }
    const sourceScene = sceneById.get(transition.sceneId);
    const destinationSceneId = transition.scope === 'scene-boundary'
      ? transition.destinationSceneId
      : transition.sceneId;
    const destinationScene = sceneById.get(destinationSceneId);
    if (!sourceScene || !destinationScene) {
      throw new Error(`高级切换 ${transition.id} 引用了未知镜头。`);
    }
    const editPoint = editPointById.get(transition.editPointId);
    if (!editPoint || editPoint.sceneId !== transition.sceneId) {
      throw new Error(`高级切换 ${transition.id} 必须绑定来源镜头内的有效 edit point。`);
    }
    const binding = bindingByTransition.get(transition.id);
    if (!binding || binding.editPointId !== transition.editPointId) {
      throw new Error(`高级切换 ${transition.id} 缺少一致的 editorial-transition binding。`);
    }
    const continuity = responsivePlans.map((profile) => {
      const sourcePlan = profile.scenes.find(({sceneId}) => sceneId === transition.sceneId);
      const destinationPlan = profile.scenes.find(({sceneId}) => sceneId === destinationSceneId);
      const sourceTarget = resolveTransitionTarget({
        reference: transition.sourceAnchor,
        profilePlan: sourcePlan,
        scene: sourceScene,
      });
      const destinationTarget = resolveTransitionTarget({
        reference: transition.destinationAnchor,
        profilePlan: destinationPlan,
        scene: destinationScene,
      });
      const source = sourceTarget?.anchor ?? null;
      const destination = destinationTarget?.anchor ?? null;
      const distance = source && destination
        ? Math.hypot(source.x - destination.x, source.y - destination.y)
        : null;
      const dimensionChecks = transitionDimensionChecks({
        transition,
        sourceTarget,
        destinationTarget,
      });
      const valid =
        Object.keys(dimensionChecks).length > 0 &&
        Object.values(dimensionChecks).every((check) => check.valid);
      return {
        profileId: profile.profileId,
        source,
        destination,
        distance,
        dimensionChecks,
        valid,
        runtimeTreatment: valid
          ? boundaryType ? 'hard-anchor-cut' : transition.treatment
          : transition.invalidPolicy === 'fallback' ? transition.fallback : 'invalid',
      };
    });
    const invalidProfiles = continuity.filter(({valid}) => !valid).map(({profileId}) => profileId);
    if (invalidProfiles.length > 0 && transition.invalidPolicy === 'reject') {
      throw new Error(`高级切换 ${transition.id} 在 ${invalidProfiles.join('、')} 连续性超出容差。`);
    }
    return {
      ...transition,
      editPointFrame: editPoint.renderFrame,
      continuity,
      invalidProfiles,
      runtimeTreatment: invalidProfiles.length === 0
        ? boundaryType ? 'hard-anchor-cut' : transition.treatment
        : transition.fallback,
      proofFrameIds: [`${transition.id}:before`, `${transition.id}:at`, `${transition.id}:after`],
    };
  });
};

export const validateEditorialTransitionExecution = ({
  editorial,
  scenes = [],
}) => {
  const issues = [];
  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
  for (const [index, transition] of (editorial?.transitions ?? []).entries()) {
    const location = `editorial.transitions[${index}]`;
    const sourceScene = sceneById.get(transition.sceneId);
    const destinationScene = sceneById.get(
      transition.scope === 'scene-boundary'
        ? transition.destinationSceneId
        : transition.sceneId,
    );
    const sourceNode = findNode(
      sourceScene?.composition?.nodes,
      transition.sourceAnchor?.targetId,
    );
    const destinationNode = findNode(
      destinationScene?.composition?.nodes,
      transition.destinationAnchor?.targetId,
    );
    if (!sourceNode) {
      issues.push(issue(
        'editorial-transition-source-target',
        `高级切换 ${transition.id} 的 source target 不存在。`,
        `${location}.sourceAnchor.targetId`,
      ));
      continue;
    }
    if (!destinationNode) {
      issues.push(issue(
        'editorial-transition-destination-target',
        `高级切换 ${transition.id} 的 destination target 不存在。`,
        `${location}.destinationAnchor.targetId`,
      ));
      continue;
    }
    const actualSource = {
      shape: transitionNodeShape(sourceNode),
      color: transitionNodeColor(sourceNode),
      value: transitionNodeValue(sourceNode),
      width: sourceNode.transform?.width ?? null,
      height: sourceNode.transform?.height ?? sourceNode.transform?.width ?? null,
    };
    const actualDestination = {
      shape: transitionNodeShape(destinationNode),
      color: transitionNodeColor(destinationNode),
      value: transitionNodeValue(destinationNode),
      width: destinationNode.transform?.width ?? null,
      height: destinationNode.transform?.height ?? destinationNode.transform?.width ?? null,
    };
    for (const dimension of ['shape', 'color', 'value', 'width', 'height']) {
      if (
        transition.sourceDescriptor?.[dimension] !== undefined &&
        transition.sourceDescriptor[dimension] !== actualSource[dimension]
      ) {
        issues.push(issue(
          'editorial-transition-source-descriptor',
          `高级切换 ${transition.id} 的 source ${dimension} descriptor 与实际节点不一致。`,
          `${location}.sourceDescriptor.${dimension}`,
        ));
      }
      if (
        transition.destinationDescriptor?.[dimension] !== undefined &&
        transition.destinationDescriptor[dimension] !== actualDestination[dimension]
      ) {
        issues.push(issue(
          'editorial-transition-destination-descriptor',
          `高级切换 ${transition.id} 的 destination ${dimension} descriptor 与实际节点不一致。`,
          `${location}.destinationDescriptor.${dimension}`,
        ));
      }
    }
  }
  return issues;
};

export const compileEditorialSystem = ({
  editorial,
  scenes = [],
  sceneTransitions = [],
  fps,
}) => {
  if (editorial?.resolvedEditPoints !== undefined || editorial?.responsivePlans !== undefined || editorial?.transitionPlans !== undefined || editorial?.fingerprint !== undefined) {
    throw new Error('authoring editorial 不得手写编译字段。');
  }
  const issues = validateEditorialAuthoring(editorial, {fps, scenes});
  if (issues.length > 0) {
    const error = new Error(issues.map(({location, message}) => `${location}: ${message}`).join('\n'));
    error.issues = issues;
    throw error;
  }
  const cues = new Map(editorial.cues.map((cue) => [cue.id, cue]));
  const media = new Map(editorial.media.map((item) => [item.id, item]));
  const sceneTimings = compileSceneTimings({scenes, sceneTransitions, fps: editorial.timebase.fps});
  const resolvedEditPoints = editorial.editPoints.map((point) =>
    resolveEditPoint({
      point,
      cues,
      media,
      sceneTimings,
      fps: editorial.timebase.fps,
      rounding: editorial.timebase.rounding,
    })
  );
  const conflicts = resolveConflicts(resolvedEditPoints, editorial.timebase.fps);
  const responsivePlans = compileResponsivePlans({editorial, scenes});
  const transitionPlans = compileTransitionPlans({
    editorial,
    scenes,
    sceneTransitions,
    resolvedEditPoints,
    responsivePlans,
  });
  const compiled = {
    ...editorial,
    resolvedEditPoints,
    conflicts,
    responsivePlans,
    transitionPlans,
  };
  compiled.fingerprint = stableEditorialHash({
    media: compiled.media,
    cues: compiled.cues,
    editPoints: compiled.editPoints,
    bindings: compiled.bindings,
    resolvedEditPoints,
    conflicts,
    responsivePlans,
    transitionPlans,
  });
  return compiled;
};

export const validateCompiledEditorial = ({
  editorial,
  scenes = [],
  sceneTransitions = [],
  fps,
}) => {
  try {
    const {
      resolvedEditPoints,
      conflicts,
      responsivePlans,
      transitionPlans,
      fingerprint,
      ...authoring
    } = editorial ?? {};
    const compiled = compileEditorialSystem({editorial: authoring, scenes, sceneTransitions, fps});
    const issues = [];
    for (const key of ['resolvedEditPoints', 'conflicts', 'responsivePlans', 'transitionPlans', 'fingerprint']) {
      if (JSON.stringify(editorial?.[key]) !== JSON.stringify(compiled[key])) {
        issues.push(issue('editorial-compiled-drift', `editorial.${key} 不是当前 authoring 数据的编译结果。`, `editorial.${key}`));
      }
    }
    return issues;
  } catch (error) {
    return error.issues ?? [issue('editorial-invalid', error.message, 'editorial')];
  }
};
