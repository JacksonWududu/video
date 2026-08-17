const PHASES = ['enter', 'approach', 'answer', 'exit'];

const issue = (code, message, location) => ({code, message, location});

const worldForContract = ({scene, contract}) =>
  scene.compositionPlan?.loopingEnvironments?.find(
    ({targetId}) => targetId === contract.worldNodeId,
  );

export const validateEncounterAuthoring = (scene, {location = 'scene'} = {}) => {
  const issues = [];
  const ids = new Set();
  const cues = new Set();
  const targets = new Set();
  const beats = new Map((scene.beats ?? []).map((beat) => [beat.id, beat]));
  for (const [index, contract] of (scene.encounters ?? []).entries()) {
    const contractLocation = `${location}.encounters[${index}]`;
    if (!contract?.id || ids.has(contract.id)) {
      issues.push(issue(
        'encounter-id',
        'encounter contract id 必须非空且唯一。',
        `${contractLocation}.id`,
      ));
    }
    ids.add(contract?.id);
    if (cues.has(contract?.narrationCueId)) {
      issues.push(issue(
        'encounter-cue-unique',
        '同一个旁白 cue 只能识别一个相遇对象。',
        `${contractLocation}.narrationCueId`,
      ));
    }
    cues.add(contract?.narrationCueId);
    if (targets.has(contract?.targetNodeId)) {
      issues.push(issue(
        'encounter-target-unique',
        '同一镜头中的相遇对象必须各自拥有一个生命周期合同。',
        `${contractLocation}.targetNodeId`,
      ));
    }
    targets.add(contract?.targetNodeId);
    const phaseBeats = PHASES.map(
      (phase) => beats.get(contract?.phaseBeatIds?.[phase]),
    );
    if (
      phaseBeats.some((beat) => !beat) ||
      phaseBeats.some((beat, phaseIndex) =>
        phaseIndex > 0 && beat.at <= phaseBeats[phaseIndex - 1]?.at
      ) ||
      phaseBeats.some((beat) => !beat?.proofTimeId)
    ) {
      issues.push(issue(
        'encounter-phase-order',
        'enter、approach、answer、exit 必须绑定存在、带证明且严格递增的四个节拍。',
        `${contractLocation}.phaseBeatIds`,
      ));
    }
    const world = worldForContract({scene, contract});
    const traveler = world?.subjectBindings?.find(
      ({nodeId, role, anchorMode}) =>
        nodeId === contract.travelerNodeId &&
        role === 'tracked' &&
        anchorMode === 'screen',
    );
    const target = world?.subjectBindings?.find(
      ({nodeId, role, anchorMode}) =>
        nodeId === contract.targetNodeId &&
        role === 'participant' &&
        anchorMode === 'world',
    );
    if (!world || !traveler || !target) {
      issues.push(issue(
        'encounter-world-binding',
        '相遇合同必须把旅行主体绑定为 screen tracked，把相遇对象绑定为同一世界的 world participant。',
        contractLocation,
      ));
    } else {
      const expectedEntry = world.direction === 'left' ? 'right' : 'left';
      const expectedExit = world.direction === 'left' ? 'left' : 'right';
      if (
        contract.entryEdge !== expectedEntry ||
        contract.exitEdge !== expectedExit ||
        contract.entryEdge === contract.exitEdge
      ) {
        issues.push(issue(
          'encounter-edge-direction',
          `world direction=${world.direction} 时对象必须从 ${expectedEntry} 入画并从 ${expectedExit} 离画。`,
          contractLocation,
        ));
      }
      if (
        !Number.isFinite(contract.minimumTravelViewports) ||
        contract.minimumTravelViewports < 1 ||
        world.distanceViewports < contract.minimumTravelViewports
      ) {
        issues.push(issue(
          'encounter-travel-distance',
          '世界位移必须达到 encounter minimumTravelViewports，确保对象能物理入画和离画。',
          `${contractLocation}.minimumTravelViewports`,
        ));
      }
    }
    if (
      !Number.isFinite(contract?.cueToleranceSeconds) ||
      contract.cueToleranceSeconds < 0 ||
      contract.cueToleranceSeconds > 0.5
    ) {
      issues.push(issue(
        'encounter-cue-tolerance',
        'cueToleranceSeconds 必须位于 0..0.5 秒。',
        `${contractLocation}.cueToleranceSeconds`,
      ));
    }
  }
  return issues;
};

export const validateEncounterExecution = ({
  scene,
  storyboardScene,
  nodesById,
  narrationTiming,
  fps,
  location = 'scene',
}) => {
  const issues = validateEncounterAuthoring(storyboardScene, {location});
  const planned = storyboardScene?.encounters ?? [];
  const actual = scene.encounters ?? [];
  if (JSON.stringify(actual) !== JSON.stringify(planned)) {
    issues.push(issue(
      'encounter-contract-drift',
      'project scene.encounters 必须逐项复制当前编译故事板的相遇合同。',
      `${location}.encounters`,
    ));
    return issues;
  }
  const cueById = new Map(
    (narrationTiming?.cues ?? []).map((cue) => [cue.id, cue]),
  );
  const answerCueOwners = new Map();
  const sceneDurationSeconds =
    scene.durationInFrames / Math.max(1, fps);
  for (const [index, contract] of actual.entries()) {
    const contractLocation = `${location}.encounters[${index}]`;
    const targetNode = nodesById.get(contract.targetNodeId);
    if (!targetNode || targetNode.visibility?.initial === 'hidden') {
      issues.push(issue(
        'encounter-target-visible',
        '主要相遇对象必须作为持续存在的物理节点开始，不能从 hidden opacity 突然出现。',
        `${contractLocation}.targetNodeId`,
      ));
    }
    if ((scene.events ?? []).some(
      (event) =>
        event.targetId === contract.targetNodeId &&
        event.visual?.kind === 'visibility',
    )) {
      issues.push(issue(
        'encounter-opacity-lifecycle',
        '主要相遇对象的入画和离画不得使用 visibility/opacity event。',
        `${location}.events`,
      ));
    }
    const phaseEvents = PHASES.map((phase) =>
      (scene.events ?? []).filter(
        (event) =>
          event.beatId === contract.phaseBeatIds[phase] &&
          event.targetId === contract.targetNodeId &&
          event.encounter?.contractId === contract.id &&
          event.encounter?.phase === phase,
      ),
    );
    if (phaseEvents.some((events) => events.length !== 1)) {
      issues.push(issue(
        'encounter-phase-event',
        '每个相遇阶段必须且只能有一个指向正确动物的 encounter event。',
        `${location}.events`,
      ));
      continue;
    }
    const ordered = phaseEvents.map(([event]) => event);
    if (ordered.some((event, eventIndex) =>
      eventIndex > 0 && event.at <= ordered[eventIndex - 1].at
    )) {
      issues.push(issue(
        'encounter-event-order',
        '相遇事件必须按 enter、approach、answer、exit 严格递增。',
        `${location}.events`,
      ));
    }
    const answer = ordered[2];
    if (answer.encounter?.narrationCueId !== contract.narrationCueId) {
      issues.push(issue(
        'encounter-answer-cue',
        'answer event 必须绑定该动物合同唯一的 narrationCueId。',
        `${location}.events`,
      ));
    }
    const cue = cueById.get(contract.narrationCueId);
    const cueAtSeconds = Number.isFinite(cue?.atSeconds)
      ? cue.atSeconds
      : cue?.startSeconds;
    if (!Number.isFinite(cueAtSeconds)) {
      issues.push(issue(
        'encounter-cue-missing',
        `旁白 timing 中不存在相遇 cue：${contract.narrationCueId}。`,
        `${contractLocation}.narrationCueId`,
      ));
    } else {
      const answerSeconds = answer.at * sceneDurationSeconds;
      const cueSeconds =
        Number(scene.narration?.startSeconds ?? 0) + cueAtSeconds;
      if (
        Math.abs(answerSeconds - cueSeconds) >
        contract.cueToleranceSeconds + 1e-9
      ) {
        issues.push(issue(
          'encounter-cue-drift',
          `answer event 与旁白 cue 偏差 ${Math.abs(answerSeconds - cueSeconds).toFixed(3)}s，超过 ${contract.cueToleranceSeconds}s。`,
          `${location}.events`,
        ));
      }
    }
    const priorOwner = answerCueOwners.get(contract.narrationCueId);
    if (priorOwner && priorOwner !== contract.targetNodeId) {
      issues.push(issue(
        'encounter-cue-target-conflict',
        '同一个旁白 cue 不能同时指向不同相遇对象。',
        `${contractLocation}.narrationCueId`,
      ));
    }
    answerCueOwners.set(contract.narrationCueId, contract.targetNodeId);
  }
  return issues;
};
