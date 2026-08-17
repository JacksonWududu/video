const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;

export const SCENE_TRANSITION_TYPES = Object.freeze([
  'cut',
  'wipe',
  'dip',
  'slide',
  'iris',
  'page-turn',
  'shutters',
]);

export const SCENE_TRANSITION_INTENTS = Object.freeze([
  'continuity',
  'location-change',
  'time-passage',
  'focus-reveal',
  'chapter-reset',
  'impact',
]);

export const SCENE_TRANSITION_MOTIVATIONS = Object.freeze([
  'semantic-default',
  'authored',
  'rhythmic',
  'impact',
]);

export const TRANSITION_DIRECTIONS = Object.freeze([
  'left-to-right',
  'right-to-left',
  'top-to-bottom',
  'bottom-to-top',
]);

export const TRANSITION_RECIPE_SETS = Object.freeze({
  'paper-story': Object.freeze({
    continuity: Object.freeze({treatment: Object.freeze({type: 'slide', edgeStyle: 'paper', motivation: 'semantic-default', durationSeconds: 0.45, direction: 'right-to-left'})}),
    'location-change': Object.freeze({treatment: Object.freeze({type: 'wipe', edgeStyle: 'paper', motivation: 'semantic-default', durationSeconds: 0.5, direction: 'left-to-right'})}),
    'time-passage': Object.freeze({treatment: Object.freeze({type: 'page-turn', edgeStyle: 'paper', motivation: 'semantic-default', durationSeconds: 0.7, direction: 'right-to-left'})}),
    'focus-reveal': Object.freeze({treatment: Object.freeze({type: 'iris', edgeStyle: 'paper', motivation: 'semantic-default', durationSeconds: 0.55})}),
    'chapter-reset': Object.freeze({treatment: Object.freeze({type: 'shutters', edgeStyle: 'paper', motivation: 'semantic-default', durationSeconds: 0.65})}),
    impact: Object.freeze({treatment: Object.freeze({type: 'cut', motivation: 'impact', durationSeconds: 0})}),
  }),
  'clean-video': Object.freeze({
    continuity: Object.freeze({treatment: Object.freeze({type: 'slide', edgeStyle: 'clean', motivation: 'semantic-default', durationSeconds: 0.4, direction: 'right-to-left'})}),
    'location-change': Object.freeze({treatment: Object.freeze({type: 'wipe', edgeStyle: 'clean', motivation: 'semantic-default', durationSeconds: 0.45, direction: 'left-to-right'})}),
    'time-passage': Object.freeze({treatment: Object.freeze({type: 'dip', edgeStyle: 'clean', motivation: 'semantic-default', durationSeconds: 0.5})}),
    'focus-reveal': Object.freeze({treatment: Object.freeze({type: 'iris', edgeStyle: 'clean', motivation: 'semantic-default', durationSeconds: 0.45})}),
    'chapter-reset': Object.freeze({treatment: Object.freeze({type: 'dip', edgeStyle: 'clean', motivation: 'semantic-default', durationSeconds: 0.55})}),
    impact: Object.freeze({treatment: Object.freeze({type: 'cut', motivation: 'impact', durationSeconds: 0})}),
  }),
});

export const materializeSceneTransitionRecipes = (
  sceneTransitions = [],
  transitionSet = 'paper-story',
) =>
  sceneTransitions.map((transition) => {
    if (transition?.treatment !== undefined) return transition;
    const recipes = TRANSITION_RECIPE_SETS[transitionSet];
    if (!recipes) {
      throw new Error(`未知场景转场集合：${transitionSet}。`);
    }
    const recipe = recipes[transition?.intent];
    return recipe
      ? {...transition, treatment: {...recipe.treatment}}
      : transition;
  });

export const summarizeSceneTransitions = (sceneTransitions = []) => {
  const countBy = (selector) => Object.fromEntries(
    [...new Set(sceneTransitions.map(selector))]
      .filter((value) => value !== undefined)
      .sort()
      .map((value) => [value, sceneTransitions.filter((transition) => selector(transition) === value).length]),
  );
  const cutCount = sceneTransitions.filter(({treatment}) => treatment?.type === 'cut').length;
  return {
    total: sceneTransitions.length,
    animatedCount: sceneTransitions.length - cutCount,
    cutCount,
    cutRatio: sceneTransitions.length === 0 ? 0 : cutCount / sceneTransitions.length,
    typeCounts: countBy((transition) => transition.treatment?.type),
    intentCounts: countBy((transition) => transition.intent),
    motivationCounts: countBy((transition) => transition.treatment?.motivation),
  };
};

const DIRECTIONAL_TYPES = new Set(['wipe', 'slide']);
const HORIZONTAL_TYPES = new Set(['page-turn']);
const NON_DIRECTIONAL_TYPES = new Set(['cut', 'dip', 'iris', 'shutters']);
const HORIZONTAL_DIRECTIONS = new Set(['left-to-right', 'right-to-left']);
const MINIMUM_DURATION = Object.freeze({
  wipe: 0.2,
  dip: 0.3,
  slide: 0.25,
  iris: 0.3,
  'page-turn': 0.4,
  shutters: 0.4,
});
const TYPES_BY_INTENT = Object.freeze({
  continuity: new Set(['slide', 'wipe']),
  'location-change': new Set(['slide', 'wipe']),
  'time-passage': new Set(['page-turn', 'wipe', 'dip']),
  'focus-reveal': new Set(['iris']),
  'chapter-reset': new Set(['shutters', 'dip', 'page-turn']),
  impact: new Set(['cut']),
});

const durationFramesFor = (transition, fps) =>
  transition?.treatment?.type === 'cut'
    ? 0
    : Math.max(1, Math.round(Number(transition?.treatment?.durationSeconds ?? 0) * fps));

export const validateSceneTransitionSequence = ({
  scenes = [],
  beatScenes = scenes,
  sceneTransitions = [],
} = {}) => {
  const issues = [];
  const add = (code, message, location) => issues.push({code, message, location});
  if (!Array.isArray(sceneTransitions)) {
    add('scene-transitions-array', 'sceneTransitions 必须是数组。', 'sceneTransitions');
    return issues;
  }
  const expected = Math.max(0, scenes.length - 1);
  if (sceneTransitions.length !== expected) {
    add(
      'scene-transitions-count',
      `sceneTransitions 必须为每对相邻镜头声明一个边界；需要 ${expected} 个，当前为 ${sceneTransitions.length} 个。`,
      'sceneTransitions',
    );
  }
  const ids = new Set();
  for (const [index, transition] of sceneTransitions.entries()) {
    const location = `sceneTransitions[${index}]`;
    const outgoing = scenes[index];
    const incoming = scenes[index + 1];
    const outgoingBeatScene = beatScenes[index];
    const incomingBeatScene = beatScenes[index + 1];
    if (!transition?.id || ids.has(transition.id)) {
      add('scene-transition-id', '场景边界 id 缺失或重复。', `${location}.id`);
    }
    ids.add(transition?.id);
    if (transition?.fromSceneId !== outgoing?.id || transition?.toSceneId !== incoming?.id) {
      add(
        'scene-transition-adjacency',
        `场景边界必须连接相邻镜头 ${outgoing?.id ?? 'missing'} → ${incoming?.id ?? 'missing'}。`,
        location,
      );
    }
    if (!SCENE_TRANSITION_INTENTS.includes(transition?.intent)) {
      add('scene-transition-intent', `未知转场意图：${transition?.intent}`, `${location}.intent`);
    }
    const treatment = transition?.treatment;
    if (!treatment || typeof treatment !== 'object') {
      add('scene-transition-treatment', '每个场景边界都必须声明独立的 treatment。', `${location}.treatment`);
      continue;
    }
    if (!SCENE_TRANSITION_TYPES.includes(treatment.type)) {
      add('scene-transition-type', `未知场景转场：${treatment.type}`, `${location}.treatment.type`);
      continue;
    }
    if (!SCENE_TRANSITION_MOTIVATIONS.includes(treatment.motivation)) {
      add('scene-transition-motivation', `未知剪辑动机：${treatment.motivation}`, `${location}.treatment.motivation`);
    }
    if (treatment.type === 'cut') {
      if (treatment.edgeStyle !== undefined) {
        add('scene-transition-edge-style-forbidden', 'cut 不得声明 edgeStyle。', `${location}.treatment.edgeStyle`);
      }
    } else if (!['clean', 'paper', 'torn'].includes(treatment.edgeStyle)) {
      add('scene-transition-edge-style', '动画转场必须声明 clean、paper 或 torn edgeStyle。', `${location}.treatment.edgeStyle`);
    } else if (treatment.edgeStyle === 'torn' && treatment.type !== 'wipe') {
      add('scene-transition-torn-edge-type', 'torn edgeStyle 只适用于 wipe。', `${location}.treatment.edgeStyle`);
    }
    const isRhythmicCut = treatment.type === 'cut' && treatment.motivation === 'rhythmic';
    const isImpactCut = treatment.type === 'cut' && treatment.motivation === 'impact';
    if (
      SCENE_TRANSITION_INTENTS.includes(transition?.intent) &&
      !isRhythmicCut &&
      !TYPES_BY_INTENT[transition.intent].has(treatment.type)
    ) {
      add(
        'scene-transition-intent-type',
        `${transition.intent} 不应使用 ${treatment.type}；请让叙事意图与执行处理保持一致。`,
        `${location}.treatment.type`,
      );
    }
    if (transition.intent === 'impact' && !isImpactCut) {
      add(
        'scene-transition-impact-treatment',
        'impact 意图必须使用 motivation=impact 的 cut。',
        `${location}.treatment`,
      );
    }
    if (transition.intent !== 'impact' && isImpactCut) {
      add(
        'scene-transition-impact-intent',
        'motivation=impact 的 cut 必须配合 impact 意图。',
        `${location}.intent`,
      );
    }
    if (treatment.type === 'cut' && !['rhythmic', 'impact'].includes(treatment.motivation)) {
      add(
        'scene-transition-cut-motivation',
        'cut 必须明确由 rhythmic 或 impact 驱动。',
        `${location}.treatment.motivation`,
      );
    }
    if (treatment.type !== 'cut' && ['rhythmic', 'impact'].includes(treatment.motivation)) {
      add(
        'scene-transition-paper-motivation',
        '动画转场的 motivation 必须为 semantic-default 或 authored。',
        `${location}.treatment.motivation`,
      );
    }
    if (!nonEmpty(transition?.rationale)) {
      add('scene-transition-rationale', '每个场景边界都必须说明转场理由。', `${location}.rationale`);
    }
    if (!finite(treatment.durationSeconds) || treatment.durationSeconds < 0) {
      add('scene-transition-duration', '场景转场 durationSeconds 必须是非负数。', `${location}.treatment.durationSeconds`);
      continue;
    }
    if (treatment.type === 'cut') {
      if (treatment.durationSeconds !== 0) {
        add('scene-transition-cut-duration', 'cut 的 durationSeconds 必须为 0。', `${location}.treatment.durationSeconds`);
      }
    } else {
      const minimum = MINIMUM_DURATION[treatment.type];
      if (treatment.durationSeconds < minimum || treatment.durationSeconds > 1.5) {
        add(
          'scene-transition-duration-bounds',
          `${treatment.type} 必须位于 ${minimum}–1.5 秒，避免难以辨认的闪烁或拖沓遮挡。`,
          `${location}.treatment.durationSeconds`,
        );
      }
    }
    if (DIRECTIONAL_TYPES.has(treatment.type)) {
      if (!TRANSITION_DIRECTIONS.includes(treatment.direction)) {
        add('scene-transition-direction', `${treatment.type} 必须声明受支持的 direction。`, `${location}.treatment.direction`);
      }
    } else if (HORIZONTAL_TYPES.has(treatment.type)) {
      if (!HORIZONTAL_DIRECTIONS.has(treatment.direction)) {
        add('scene-transition-direction', 'page-turn 只支持水平翻页方向。', `${location}.treatment.direction`);
      }
    } else if (NON_DIRECTIONAL_TYPES.has(treatment.type) && treatment.direction !== undefined) {
      add('scene-transition-direction-forbidden', `${treatment.type} 不得声明 direction。`, `${location}.treatment.direction`);
    }
    if (isRhythmicCut) {
      if (!nonEmpty(treatment.beatId)) {
        add('scene-transition-rhythmic-beat', 'rhythmic cut 必须声明 beatId。', `${location}.treatment.beatId`);
      } else {
        const outgoingBeat = outgoingBeatScene?.beats?.find(({id}) => id === treatment.beatId);
        const incomingBeat = incomingBeatScene?.beats?.find(({id}) => id === treatment.beatId);
        const aligned = (outgoingBeat && outgoingBeat.at >= 0.8) || (incomingBeat && incomingBeat.at <= 0.2);
        if (!aligned) {
          add(
            'scene-transition-rhythmic-alignment',
            'rhythmic cut 的 beatId 必须指向出场末段（at≥0.8）或入场开段（at≤0.2）的节拍。',
            `${location}.treatment.beatId`,
          );
        }
      }
    } else if (treatment.beatId !== undefined) {
      add('scene-transition-beat-forbidden', '只有 rhythmic cut 可以声明 beatId。', `${location}.treatment.beatId`);
    }
    if (treatment.type === 'cut') continue;
    if (finite(outgoing?.tailSeconds) && outgoing.tailSeconds + 1e-6 < treatment.durationSeconds) {
      add(
        'scene-transition-tail-budget',
        `出场镜头 tailSeconds 必须至少覆盖 ${treatment.durationSeconds}s 转场。`,
        `scenes[${index}].tailSeconds`,
      );
    }
    if (
      finite(incoming?.narration?.startSeconds) &&
      incoming.narration.startSeconds + 1e-6 < treatment.durationSeconds
    ) {
      add(
        'scene-transition-narration-lead',
        `入场镜头 narration.startSeconds 必须至少为 ${treatment.durationSeconds}s，避免旁白在转场完成前开始。`,
        `scenes[${index + 1}].narration.startSeconds`,
      );
    }
  }
  return issues;
};

export const deriveSceneTimeline = (project) => {
  const fps = Number(project.video?.fps ?? 30);
  const transitions = project.sceneTransitions ?? [];
  const normalizedTransitions = [];
  let cursor = 0;
  const scenes = (project.scenes ?? []).map((scene, index) => {
    const narrationFrames = Math.ceil(Number(scene.narration?.durationSeconds ?? 0) * fps);
    const narrationStartFrame = Math.round(Number(scene.narration?.startSeconds ?? 0) * fps);
    const tailFrames = Math.ceil(Number(scene.tailSeconds ?? 0) * fps);
    const durationInFrames = narrationStartFrame + narrationFrames + tailFrames;
    const sourceTransition = index === 0 ? null : transitions[index - 1] ?? null;
    const enterTransitionFrames = durationFramesFor(sourceTransition, fps);
    const from = index === 0 ? 0 : Math.max(0, cursor - enterTransitionFrames);
    const enterTransition = sourceTransition
      ? {...sourceTransition, from, durationInFrames: enterTransitionFrames}
      : null;
    if (enterTransition) normalizedTransitions.push(enterTransition);
    cursor = from + durationInFrames;
    return {
      ...scene,
      from,
      durationInFrames,
      narrationFrames,
      narrationStartFrame,
      enterTransitionFrames,
      exitTransitionFrames: 0,
      enterTransition,
    };
  });
  for (let index = 0; index < scenes.length - 1; index += 1) {
    scenes[index].exitTransitionFrames = scenes[index + 1].enterTransitionFrames;
  }
  return {
    durationInFrames: scenes.length === 0 ? fps : cursor,
    durationSeconds: (scenes.length === 0 ? fps : cursor) / fps,
    scenes,
    transitions: normalizedTransitions,
  };
};

const smoothstep = (value) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

const coverSwapEnvelope = (rawProgress) => {
  if (rawProgress < 0.42) return smoothstep(rawProgress / 0.42);
  if (rawProgress <= 0.58) return 1;
  return 1 - smoothstep((rawProgress - 0.58) / 0.42);
};

const wipeClipPath = (direction, progress) => {
  const hidden = (1 - progress) * 100;
  switch (direction) {
    case 'right-to-left':
      return `inset(0 0 0 ${hidden}%)`;
    case 'top-to-bottom':
      return `inset(0 0 ${hidden}% 0)`;
    case 'bottom-to-top':
      return `inset(${hidden}% 0 0 0)`;
    case 'left-to-right':
    default:
      return `inset(0 ${hidden}% 0 0)`;
  }
};

const slideTransform = (direction, progress) => {
  const distance = (1 - progress) * 100;
  switch (direction) {
    case 'left-to-right': return `translate3d(${-distance}%, 0, 0)`;
    case 'top-to-bottom': return `translate3d(0, ${-distance}%, 0)`;
    case 'bottom-to-top': return `translate3d(0, ${distance}%, 0)`;
    case 'right-to-left':
    default: return `translate3d(${distance}%, 0, 0)`;
  }
};

const TORN_OFFSETS = Object.freeze([0, -0.72, 0.48, -0.34, 0.82, -0.58, 0.3, -0.76, 0]);

const resolveTornEdgePoints = (direction, progress) => {
  const boundary = progress * 100;
  const amplitude = Math.min(1.5, boundary, 100 - boundary);
  return TORN_OFFSETS.map((offset, index) => {
    const cross = (index / (TORN_OFFSETS.length - 1)) * 100;
    const along = Math.max(0, Math.min(100, boundary + offset * amplitude));
    return direction === 'left-to-right' || direction === 'right-to-left'
      ? {x: along, y: cross}
      : {x: cross, y: along};
  });
};

const tornClipPath = (direction, edgePoints) => {
  const edge = edgePoints.map(({x, y}) => `${x}% ${y}%`);
  switch (direction) {
    case 'right-to-left':
      return `polygon(100% 0, ${edge.join(', ')}, 100% 100%)`;
    case 'top-to-bottom':
      return `polygon(0 0, 100% 0, ${[...edge].reverse().join(', ')})`;
    case 'bottom-to-top':
      return `polygon(0 100%, ${edge.join(', ')}, 100% 100%)`;
    case 'left-to-right':
    default:
      return `polygon(0 0, ${edge.join(', ')}, 0 100%)`;
  }
};

const basePresentation = ({rawProgress = 1, progress = 1} = {}) => ({
  rawProgress,
  progress,
  incomingVisible: true,
  incomingClipPath: 'none',
  incomingTransform: 'none',
  incomingTransformOrigin: '50% 50%',
  coverOpacity: 0,
  edgeProgress: null,
  tornEdgePoints: null,
  irisRadius: null,
  shutterClosure: null,
  pageTurnFold: null,
});

export const resolveSceneTransitionPresentation = ({transition, frame}) => {
  if (!transition || transition.treatment?.type === 'cut' || transition.durationInFrames <= 0) {
    return basePresentation();
  }
  const rawProgress = clamp01(frame / Math.max(1, transition.durationInFrames - 1));
  const progress = smoothstep(rawProgress);
  const base = basePresentation({rawProgress, progress});
  if (transition.treatment.type === 'wipe') {
    if (transition.treatment.edgeStyle === 'torn') {
      const tornEdgePoints = resolveTornEdgePoints(
        transition.treatment.direction,
        progress,
      );
      return {
        ...base,
        incomingClipPath: tornClipPath(
          transition.treatment.direction,
          tornEdgePoints,
        ),
        edgeProgress: progress,
        tornEdgePoints,
      };
    }
    return {...base, incomingClipPath: wipeClipPath(transition.treatment.direction, progress), edgeProgress: progress};
  }
  if (transition.treatment.type === 'slide') {
    return {...base, incomingTransform: slideTransform(transition.treatment.direction, progress), edgeProgress: progress};
  }
  if (transition.treatment.type === 'iris') {
    const irisRadius = progress * 72;
    return {...base, incomingClipPath: `circle(${irisRadius}% at 50% 50%)`, irisRadius};
  }
  if (transition.treatment.type === 'page-turn') {
    return {
      ...base,
      incomingClipPath: wipeClipPath(transition.treatment.direction, progress),
      edgeProgress: progress,
      pageTurnFold: Math.sin(progress * Math.PI),
    };
  }
  if (transition.treatment.type === 'shutters') {
    return {
      ...base,
      incomingVisible: rawProgress >= 0.5,
      shutterClosure: coverSwapEnvelope(rawProgress),
    };
  }
  return {
    ...base,
    incomingVisible: rawProgress >= 0.5,
    coverOpacity: coverSwapEnvelope(rawProgress),
  };
};

export const deriveTransitionProofSamples = ({timeline, fps, durationSeconds}) =>
  (timeline.transitions ?? []).flatMap((transition) => {
    if (transition.treatment.type === 'cut') {
      const before = Math.max(0, transition.from - 1);
      const after = Math.min(timeline.durationInFrames - 1, transition.from);
      return [
        {
          time: before / fps,
          label: `${transition.fromSceneId} → ${transition.toSceneId} · ${transition.intent} · cut 前`,
          transitionId: transition.id,
          progress: 0,
        },
        {
          time: after / fps,
          label: `${transition.fromSceneId} → ${transition.toSceneId} · ${transition.intent} · cut 后`,
          transitionId: transition.id,
          progress: 1,
        },
      ];
    }
    return [0.25, 0.5, 0.75].map((sampleProgress) => {
      const absoluteFrame = transition.from + Math.round(
        Math.max(0, transition.durationInFrames - 1) * sampleProgress,
      );
      return {
        time: Math.max(0, Math.min(durationSeconds - 0.04, absoluteFrame / fps)),
        label: `${transition.fromSceneId} → ${transition.toSceneId} · ${transition.intent} · ${transition.treatment.type} ${Math.round(sampleProgress * 100)}%`,
        transitionId: transition.id,
        progress: sampleProgress,
      };
    });
  });
