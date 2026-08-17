const clamp01 = (value) => Math.max(0, Math.min(1, value));

export const resolveSequencePhase = ({progress, mode, cycles, activeFrom, activeUntil}) => {
  const start = activeFrom ?? 0;
  const end = activeUntil ?? 1;
  const activeProgress = clamp01((progress - start) / Math.max(end - start, 1e-9));
  const scaled = activeProgress * cycles;
  if (mode === 'once') return activeProgress;
  if (activeProgress >= 1) return mode === 'ping-pong' ? 0 : 1;
  const cycle = scaled - Math.floor(scaled);
  if (mode === 'loop') return cycle;
  return cycle <= 0.5 ? cycle * 2 : (1 - cycle) * 2;
};

const orderedStates = (node) => [...(node.states ?? [])].sort((left, right) => left.at - right.at);

const activeStatesFor = (node) => {
  const states = orderedStates(node);
  if (!node.playback.activeStateIds) return states;
  const byId = new Map(states.map((state) => [state.id, state]));
  return node.playback.activeStateIds.flatMap((id) => {
    const state = byId.get(id);
    return state ? [state] : [];
  });
};

const preludeStatesFor = (node) => {
  const states = orderedStates(node);
  if (!node.playback.activeStateIds) return states;
  const activeIds = new Set(node.playback.activeStateIds);
  return states.filter(({id}) => !activeIds.has(id));
};

const exitStatesFor = (node) => {
  if (node.playback.activeUntil === undefined) return [];
  const hold = node.states.find(
    ({id}) => id === node.playback.holdStateId,
  );
  if (!node.playback.activeStateIds) {
    return hold
      ? [{...hold, at: node.playback.activeUntil}]
      : [];
  }
  const activeIds = new Set(node.playback.activeStateIds);
  const authored = orderedStates(node).filter(
    (state) =>
      !activeIds.has(state.id) &&
      state.at >= node.playback.activeUntil,
  );
  if (authored.length > 0) return authored;
  return hold
    ? [{...hold, at: node.playback.activeUntil}]
    : [];
};

const resolveStateAt = ({states, phase}) => {
  let active = states[0] ?? null;
  for (const state of states) {
    if (state.at > phase) break;
    active = state;
  }
  return active;
};

const normalizeActiveStates = (states, evenlyDistributed = false) => {
  if (evenlyDistributed) return states.map((state, index) => ({...state, phaseAt: index / states.length}));
  return states.map((state) => ({...state, phaseAt: state.at}));
};

const smoothstep = (edge0, edge1, value) => {
  if (edge1 <= edge0) return value >= edge1 ? 1 : 0;
  const amount = clamp01((value - edge0) / (edge1 - edge0));
  return amount * amount * (3 - 2 * amount);
};

export const resolvePathViewWeights = ({node, pathDepthVelocity = 0}) => {
  const binding = node.pathViewBinding;
  if (!binding) return [{stateIds: undefined, weight: 1, view: 'authored'}];
  const lower = Math.max(0, binding.depthVelocityThreshold - binding.transitionWidth);
  const upper = binding.depthVelocityThreshold + binding.transitionWidth;
  const toward = smoothstep(lower, upper, pathDepthVelocity);
  const away = smoothstep(lower, upper, -pathDepthVelocity);
  const planar = Math.max(0, 1 - Math.max(toward, away));
  return [
    {stateIds: binding.planarStateIds, weight: planar, view: 'planar'},
    {stateIds: binding.towardStateIds, weight: toward, view: 'toward-camera'},
    {stateIds: binding.awayStateIds, weight: away, view: 'away-camera'},
  ].filter(({weight}) => weight > 1e-6);
};

const statesForIds = (node, stateIds) => {
  if (!stateIds) return activeStatesFor(node);
  const byId = new Map(orderedStates(node).map((state) => [state.id, state]));
  return stateIds.flatMap((id) => {
    const state = byId.get(id);
    return state ? [state] : [];
  });
};

export const resolveSequenceState = ({node, progress, pathDepthVelocity = 0}) => {
  const activeFrom = node.playback.activeFrom ?? 0;
  if (progress < activeFrom) return resolveStateAt({states: preludeStatesFor(node), phase: progress});
  if (node.playback.activeUntil !== undefined && progress >= node.playback.activeUntil) {
    return resolveStateAt({
      states: exitStatesFor(node),
      phase: progress,
    });
  }
  const phase = resolveSequencePhase({...node.playback, progress});
  const selected = resolvePathViewWeights({node, pathDepthVelocity})
    .sort((left, right) => right.weight - left.weight)[0];
  const states = normalizeActiveStates(
    statesForIds(node, selected?.stateIds),
    Boolean(node.playback.activeStateIds) || Boolean(node.pathViewBinding),
  );
  return resolveStateAt({states: states.map(({phaseAt, ...state}) => ({...state, at: phaseAt})), phase});
};

const activeLayersForStates = ({node, states, progress, durationSeconds}) => {
  const activeFrom = node.playback.activeFrom ?? 0;
  const activeUntil = node.playback.activeUntil ?? 1;
  const phase = resolveSequencePhase({...node.playback, progress});
  const normalized = normalizeActiveStates(
    states,
    Boolean(node.playback.activeStateIds) || Boolean(node.pathViewBinding),
  );
  let activeIndex = 0;
  for (const [index, state] of normalized.entries()) {
    if (state.phaseAt > phase) break;
    activeIndex = index;
  }
  const active = normalized[activeIndex];
  if (!active) return [];
  if (node.transition.type === 'cut' || activeIndex === 0) return [{...active, opacity: 1}];
  const activeDurationSeconds = durationSeconds * (activeUntil - activeFrom);
  const cycleDuration = activeDurationSeconds / Math.max(node.playback.cycles, 1e-9);
  const phaseDuration = node.playback.mode === 'ping-pong' ? cycleDuration / 2 : cycleDuration;
  const fadePhase = node.transition.durationSeconds / Math.max(phaseDuration, 1e-9);
  const amount = clamp01((phase - active.phaseAt) / Math.max(fadePhase, 1e-9));
  if (amount >= 1) return [{...active, opacity: 1}];
  return [
    {...normalized[activeIndex - 1], opacity: 1 - amount},
    {...active, opacity: amount},
  ];
};

export const resolveSequenceLayers = ({
  node,
  progress,
  durationSeconds,
  pathDepthVelocity = 0,
}) => {
  const activeFrom = node.playback.activeFrom ?? 0;
  const activeUntil = node.playback.activeUntil ?? 1;
  if (progress < activeFrom) {
    const prelude = resolveStateAt({states: preludeStatesFor(node), phase: progress});
    return prelude ? [{...prelude, opacity: 1}] : [];
  }
  if (node.playback.activeUntil !== undefined && progress >= node.playback.activeUntil) {
    const exitStates = exitStatesFor(node);
    const active = resolveStateAt({states: exitStates, phase: progress});
    if (!active) return [];
    if (node.transition.type === 'cut') return [{...active, opacity: 1}];
    const activeIndex = exitStates.findIndex(({id}) => id === active.id);
    if (activeIndex <= 0) return [{...active, opacity: 1}];
    const fadeProgress = clamp01(
      (progress - active.at) /
        Math.max(node.transition.durationSeconds / durationSeconds, 1e-9),
    );
    if (fadeProgress >= 1) return [{...active, opacity: 1}];
    return [
      {...exitStates[activeIndex - 1], opacity: 1 - fadeProgress},
      {...active, opacity: fadeProgress},
    ];
  }
  return resolvePathViewWeights({node, pathDepthVelocity}).flatMap(
    ({stateIds, weight}) =>
      activeLayersForStates({
        node,
        states: statesForIds(node, stateIds),
        progress,
        durationSeconds,
      }).map((layer) => ({...layer, opacity: layer.opacity * weight})),
  );
};

export const collectSequenceProofCoverage = ({node, proofTimes = []}) => {
  const covered = new Set();
  for (const proof of proofTimes) {
    for (const assertion of proof.stateAssertions ?? []) {
      if (assertion.nodeId === node.id) covered.add(assertion.stateId);
    }
  }
  return covered;
};
