import {hashCompositionValue} from './composition-lib.mjs';

export const PERFORMANCE_ROLES = [
  'establish',
  'anticipate',
  'action',
  'follow-through',
  'settle',
  'hold',
  'transition',
];

export const MOTION_CONTRACT_CHECKS = [
  'motion-grammar-consistent',
  'pacing-cadence-consistent',
  'camera-strategy-consistent',
  'transition-strategy-consistent',
  'ambient-strategy-consistent',
  'sync-anchors-current',
];

const nonEmpty = (value) =>
  typeof value === 'string' && value.trim().length > 0;

const addIssue = (issues, code, message, location) =>
  issues.push({code, message, location});

const collectTreatments = (scene) =>
  (scene.beats ?? []).flatMap((beat) =>
    (beat.treatments ?? []).map((treatment) => ({
      beat,
      treatment,
    })),
  );

const isHeroAction = (treatment) =>
  treatment.importance === 'hero' &&
  treatment.necessity === 'required' &&
  treatment.changeClass !== 'static-hold';

const performanceRoleOrder = (grammar) =>
  new Map(grammar.map((role, index) => [role, index]));

export const validateMotionDirection = (
  direction,
  {scenes = [], sceneTransitions = [], styleProfile = null} = {},
) => {
  const issues = [];
  if (!direction || typeof direction !== 'object') {
    addIssue(
      issues,
      'motion-direction-required',
      'storyboard 必须包含结构化 motionDirection。',
      'motionDirection',
    );
    return issues;
  }
  if (direction.schemaVersion !== 1) {
    addIssue(
      issues,
      'motion-direction-version',
      'motionDirection.schemaVersion 必须为 1。',
      'motionDirection.schemaVersion',
    );
  }
  if (!nonEmpty(direction.summary)) {
    addIssue(
      issues,
      'motion-direction-summary',
      'motionDirection.summary 必须说明整片动作语言。',
      'motionDirection.summary',
    );
  }
  if (!['gentle', 'playful', 'measured', 'dynamic'].includes(direction.pacing)) {
    addIssue(
      issues,
      'motion-direction-pacing',
      'motionDirection.pacing 必须为 gentle、playful、measured 或 dynamic。',
      'motionDirection.pacing',
    );
  }
  const grammar = direction.performance?.grammar;
  if (
    !Array.isArray(grammar) ||
    grammar.length < 3 ||
    new Set(grammar).size !== grammar.length ||
    grammar.some((role) => !PERFORMANCE_ROLES.includes(role)) ||
    !['establish', 'action', 'settle'].every((role) =>
      grammar.includes(role),
    )
  ) {
    addIssue(
      issues,
      'motion-direction-grammar',
      'performance.grammar 必须是无重复的动作阶段顺序，并至少包含 establish、action、settle。',
      'motionDirection.performance.grammar',
    );
  }
  const anticipation = direction.performance?.anticipation;
  if (!['none', 'selective', 'required-for-hero'].includes(anticipation)) {
    addIssue(
      issues,
      'motion-direction-anticipation',
      'performance.anticipation 无效。',
      'motionDirection.performance.anticipation',
    );
  }
  const followThrough = direction.performance?.followThrough;
  if (!['none', 'selective', 'required-for-hero'].includes(followThrough)) {
    addIssue(
      issues,
      'motion-direction-follow-through',
      'performance.followThrough 无效。',
      'motionDirection.performance.followThrough',
    );
  }
  if (
    !['continuous-led', 'pose-to-pose', 'mixed'].includes(
      direction.performance?.poseStrategy,
    )
  ) {
    addIssue(
      issues,
      'motion-direction-pose-strategy',
      'performance.poseStrategy 无效。',
      'motionDirection.performance.poseStrategy',
    );
  }
  const minimumFinalHoldRatio =
    direction.performance?.minimumFinalHoldRatio;
  if (
    !Number.isFinite(minimumFinalHoldRatio) ||
    minimumFinalHoldRatio < 0.05 ||
    minimumFinalHoldRatio > 0.3
  ) {
    addIssue(
      issues,
      'motion-direction-final-hold',
      'performance.minimumFinalHoldRatio 必须位于 0.05..0.3。',
      'motionDirection.performance.minimumFinalHoldRatio',
    );
  }
  if (
    !['locked', 'motivated', 'expressive'].includes(
      direction.camera?.strategy,
    )
  ) {
    addIssue(
      issues,
      'motion-direction-camera',
      'camera.strategy 无效。',
      'motionDirection.camera.strategy',
    );
  }
  if (
    !['story-led', 'rhythmic-accented', 'chapter-led'].includes(
      direction.transitions?.strategy,
    )
  ) {
    addIssue(
      issues,
      'motion-direction-transitions',
      'transitions.strategy 无效。',
      'motionDirection.transitions.strategy',
    );
  }
  if (
    !['minimal', 'selective', 'persistent'].includes(
      direction.ambient?.strategy,
    )
  ) {
    addIssue(
      issues,
      'motion-direction-ambient',
      'ambient.strategy 无效。',
      'motionDirection.ambient.strategy',
    );
  }
  if (
    styleProfile?.motion?.pacing &&
    direction.pacing !== styleProfile.motion.pacing &&
    !nonEmpty(direction.styleDeviationRationale)
  ) {
    addIssue(
      issues,
      'motion-direction-style-deviation',
      `项目节奏 ${direction.pacing} 偏离 Style Profile 默认 ${styleProfile.motion.pacing}，必须写明 styleDeviationRationale。`,
      'motionDirection.styleDeviationRationale',
    );
  }
  if (
    direction.styleDeviationRationale !== null &&
    direction.styleDeviationRationale !== undefined &&
    !nonEmpty(direction.styleDeviationRationale)
  ) {
    addIssue(
      issues,
      'motion-direction-style-rationale',
      'styleDeviationRationale 必须为非空字符串或 null。',
      'motionDirection.styleDeviationRationale',
    );
  }

  if (!Array.isArray(grammar)) return issues;
  const order = performanceRoleOrder(grammar);
  let totalStateSequences = 0;
  let totalCameraTreatments = 0;
  for (const [sceneIndex, scene] of scenes.entries()) {
    const sceneLocation = `scenes[${sceneIndex}]`;
    const beats = scene.beats ?? [];
    const roles = beats.map(({performanceRole}) => performanceRole);
    if (
      roles.some((role) => !order.has(role)) ||
      roles.some(
        (role, index) =>
          index > 0 && order.get(role) < order.get(roles[index - 1]),
      )
    ) {
      addIssue(
        issues,
        'motion-direction-scene-order',
        `镜头 ${scene.id} 的 performanceRole 必须遵守全片 grammar 顺序。`,
        `${sceneLocation}.beats`,
      );
    }
    const requiredRoles =
      scene.motionPolicy === 'locked-static'
        ? ['establish', 'settle']
        : ['establish', 'action', 'settle'];
    for (const role of requiredRoles) {
      if (!roles.includes(role)) {
        addIssue(
          issues,
          'motion-direction-scene-role',
          `镜头 ${scene.id} 缺少 ${role} 动作阶段。`,
          `${sceneLocation}.beats`,
        );
      }
    }
    for (const [beatIndex, beat] of beats.entries()) {
      if (!PERFORMANCE_ROLES.includes(beat.performanceRole)) {
        addIssue(
          issues,
          'motion-direction-beat-role',
          `beat ${beat.id} 缺少合法 performanceRole。`,
          `${sceneLocation}.beats[${beatIndex}].performanceRole`,
        );
      }
      if (!nonEmpty(beat.proofTimeId)) {
        addIssue(
          issues,
          'motion-direction-sync-anchor',
          `动作阶段 ${beat.id} 必须绑定 proofTimeId，作为可执行同步锚点。`,
          `${sceneLocation}.beats[${beatIndex}].proofTimeId`,
        );
      }
    }
    const settleBeat = [...beats]
      .reverse()
      .find(({performanceRole}) => performanceRole === 'settle');
    if (
      settleBeat &&
      Number.isFinite(minimumFinalHoldRatio) &&
      settleBeat.at > 1 - minimumFinalHoldRatio + 1e-9
    ) {
      addIssue(
        issues,
        'motion-direction-settle-window',
        `镜头 ${scene.id} 的 settle 开始过晚，必须至少保留 ${minimumFinalHoldRatio} 的结尾稳定窗口。`,
        `${sceneLocation}.beats`,
      );
    }
    const proofById = new Map(
      (scene.proofTimes ?? []).map((proof) => [proof.id, proof]),
    );
    if (
      settleBeat &&
      proofById.get(settleBeat.proofTimeId)?.kind !== 'final'
    ) {
      addIssue(
        issues,
        'motion-direction-settle-proof',
        `镜头 ${scene.id} 的 settle 必须绑定 kind=final 的 proofTime。`,
        `${sceneLocation}.beats`,
      );
    }
    const treatmentEntries = collectTreatments(scene);
    const heroActions = treatmentEntries.filter(({treatment}) =>
      isHeroAction(treatment),
    );
    totalStateSequences += treatmentEntries.filter(
      ({treatment}) => treatment.motion?.kind === 'state-sequence',
    ).length;
    const cameraTreatments = treatmentEntries.filter(
      ({treatment}) =>
        treatment.changeClass === 'camera-change' ||
        treatment.changeClass === 'depth-parallax' ||
        treatment.motion?.preset === 'camera' ||
        treatment.motion?.preset === 'parallax-camera' ||
        treatment.motion?.cameraFollow,
    );
    totalCameraTreatments += cameraTreatments.length;
    const ambientTreatments = treatmentEntries.filter(
      ({treatment}) =>
        treatment.importance === 'ambient' &&
        treatment.motion?.kind !== 'static',
    );
    if (
      direction.camera?.strategy === 'locked' &&
      cameraTreatments.length > 0
    ) {
      addIssue(
        issues,
        'motion-direction-camera-locked',
        `镜头 ${scene.id} 含镜头运动，但全片 camera.strategy=locked。`,
        `${sceneLocation}.beats`,
      );
    }
    if (
      direction.ambient?.strategy === 'minimal' &&
      ambientTreatments.length > 1
    ) {
      addIssue(
        issues,
        'motion-direction-ambient-minimal',
        `镜头 ${scene.id} 的 ambient 动效超过 minimal 策略允许的单个目标。`,
        `${sceneLocation}.beats`,
      );
    }
    if (
      direction.ambient?.strategy === 'persistent' &&
      scene.motionPolicy !== 'locked-static' &&
      ambientTreatments.length === 0
    ) {
      addIssue(
        issues,
        'motion-direction-ambient-persistent',
        `镜头 ${scene.id} 必须实现至少一个 ambient 动效。`,
        `${sceneLocation}.beats`,
      );
    }
    if (heroActions.length > 0) {
      const firstHeroIndex = beats.findIndex((beat) =>
        heroActions.some(({beat: candidate}) => candidate.id === beat.id),
      );
      const lastHeroIndex = beats.length - 1 - [...beats]
        .reverse()
        .findIndex((beat) =>
          heroActions.some(({beat: candidate}) => candidate.id === beat.id),
        );
      if (
        anticipation === 'required-for-hero' &&
        !beats
          .slice(0, firstHeroIndex)
          .some(({performanceRole}) => performanceRole === 'anticipate')
      ) {
        addIssue(
          issues,
          'motion-direction-anticipation-required',
          `镜头 ${scene.id} 的 hero action 前缺少 anticipate 阶段。`,
          `${sceneLocation}.beats`,
        );
      }
      if (
        followThrough === 'required-for-hero' &&
        !beats
          .slice(lastHeroIndex + 1)
          .some(({performanceRole}) => performanceRole === 'follow-through')
      ) {
        addIssue(
          issues,
          'motion-direction-follow-through-required',
          `镜头 ${scene.id} 的 hero action 后缺少 follow-through 阶段。`,
          `${sceneLocation}.beats`,
        );
      }
    }
  }
  if (
    direction.performance?.poseStrategy === 'pose-to-pose' &&
    totalStateSequences === 0
  ) {
    addIssue(
      issues,
      'motion-direction-pose-to-pose',
      'poseStrategy=pose-to-pose 至少需要一个 state-sequence treatment。',
      'motionDirection.performance.poseStrategy',
    );
  }
  if (
    direction.camera?.strategy === 'expressive' &&
    totalCameraTreatments === 0
  ) {
    addIssue(
      issues,
      'motion-direction-camera-expressive',
      'camera.strategy=expressive 至少需要一个实际镜头运动 treatment。',
      'motionDirection.camera.strategy',
    );
  }
  if (
    direction.transitions?.strategy === 'story-led' &&
    sceneTransitions.some(
      ({treatment}) => treatment?.motivation === 'rhythmic',
    )
  ) {
    addIssue(
      issues,
      'motion-direction-transition-story-led',
      'story-led 转场策略不能包含 rhythmic cut。',
      'sceneTransitions',
    );
  }
  if (
    direction.transitions?.strategy === 'rhythmic-accented' &&
    sceneTransitions.length > 0 &&
    !sceneTransitions.some(
      ({treatment}) => treatment?.motivation === 'rhythmic',
    )
  ) {
    addIssue(
      issues,
      'motion-direction-transition-rhythmic',
      'rhythmic-accented 转场策略至少需要一个 rhythmic cut。',
      'sceneTransitions',
    );
  }
  if (
    direction.transitions?.strategy === 'chapter-led' &&
    sceneTransitions.length > 0 &&
    !sceneTransitions.some(({intent}) => intent === 'chapter-reset')
  ) {
    addIssue(
      issues,
      'motion-direction-transition-chapter',
      'chapter-led 转场策略至少需要一个 chapter-reset。',
      'sceneTransitions',
    );
  }
  return issues;
};

const sceneCoverage = (scene) => {
  const treatments = collectTreatments(scene);
  const phraseRows = (scene.beats ?? []).map((beat) => ({
    role: beat.performanceRole,
    beatId: beat.id,
    at: beat.at,
    proofTimeId: beat.proofTimeId,
  }));
  const treatmentIds = (predicate) =>
    treatments
      .filter(({treatment}) => predicate(treatment))
      .map(({treatment}) => treatment.id);
  const settle = [...phraseRows]
    .reverse()
    .find(({role}) => role === 'settle');
  return {
    sceneId: scene.id,
    motionPolicy: scene.motionPolicy ?? 'standard',
    phrases: phraseRows,
    heroActionBeatIds: [
      ...new Set(
        treatments
          .filter(({treatment}) => isHeroAction(treatment))
          .map(({beat}) => beat.id),
      ),
    ],
    stateSequenceTreatmentIds: treatmentIds(
      (treatment) => treatment.motion?.kind === 'state-sequence',
    ),
    continuousTreatmentIds: treatmentIds(
      (treatment) =>
        ['continuous-transform', 'path-locomotion'].includes(
          treatment.motion?.kind,
        ),
    ),
    cameraTreatmentIds: treatmentIds(
      (treatment) =>
        treatment.changeClass === 'camera-change' ||
        treatment.changeClass === 'depth-parallax' ||
        treatment.motion?.preset === 'camera' ||
        treatment.motion?.preset === 'parallax-camera' ||
        treatment.motion?.cameraFollow,
    ),
    ambientTreatmentIds: treatmentIds(
      (treatment) =>
        treatment.importance === 'ambient' &&
        treatment.motion?.kind !== 'static',
    ),
    finalHoldRatio: settle ? Number((1 - settle.at).toFixed(6)) : 0,
    exception:
      scene.motionPolicy === 'locked-static'
        ? {
            kind: 'locked-static',
            rationale: scene.staticRationale,
          }
        : null,
  };
};

const transitionCoverage = (transition) => ({
  id: transition.id,
  intent: transition.intent,
  type: transition.treatment.type,
  motivation: transition.treatment.motivation,
});

export const compileMotionContract = ({
  direction,
  scenes,
  sceneTransitions,
  editorial,
  styleProfile,
}) => {
  const issues = validateMotionDirection(direction, {
    scenes,
    sceneTransitions,
    styleProfile,
  });
  if (
    !styleProfile?.id ||
    !/^[a-f0-9]{64}$/.test(styleProfile?.profileFingerprint ?? '') ||
    !['gentle', 'playful', 'measured', 'dynamic'].includes(
      styleProfile?.motion?.pacing,
    )
  ) {
    addIssue(
      issues,
      'motion-contract-style-binding',
      'motion contract 必须绑定当前 executable Style Profile 的 id、fingerprint 和 pacing。',
      'styleProfile',
    );
  }
  if (!/^[a-f0-9]{64}$/.test(editorial?.fingerprint ?? '')) {
    addIssue(
      issues,
      'motion-contract-editorial-binding',
      'motion contract 必须绑定当前编译 editorial fingerprint。',
      'editorial.fingerprint',
    );
  }
  if (issues.length > 0) {
    const error = new Error(
      issues
        .map(({location, message}) => `${location}: ${message}`)
        .join('\n'),
    );
    error.issues = issues;
    throw error;
  }
  const styleProfileBinding = {
    id: styleProfile.id,
    profileFingerprint: styleProfile.profileFingerprint,
    pacing: styleProfile.motion.pacing,
  };
  const compiledScenes = scenes.map(sceneCoverage);
  const compiledTransitions = sceneTransitions.map(transitionCoverage);
  const approvalBasis = {
    direction,
    styleProfileBinding,
    scenes: compiledScenes.map(({sceneId, motionPolicy, phrases, exception}) => ({
      sceneId,
      motionPolicy,
      phrases: phrases.map(({role, beatId, proofTimeId}) => ({
        role,
        beatId,
        proofTimeId,
      })),
      exception,
    })),
    transitions: compiledTransitions.map(({id, intent}) => ({id, intent})),
  };
  const contract = {
    schemaVersion: 1,
    direction,
    styleProfileBinding,
    scenes: compiledScenes,
    transitions: compiledTransitions,
    editorialFingerprint: editorial.fingerprint,
    requiredCompositeChecks: MOTION_CONTRACT_CHECKS,
    approvalFingerprint: hashCompositionValue(approvalBasis),
  };
  contract.fingerprint = hashCompositionValue(contract);
  return contract;
};

export const validateCompiledMotionContract = ({
  storyboard,
  styleProfile,
}) => {
  try {
    const expected = compileMotionContract({
      direction: storyboard.motionDirection,
      scenes: storyboard.scenes ?? [],
      sceneTransitions: storyboard.sceneTransitions ?? [],
      editorial: storyboard.editorial,
      styleProfile,
    });
    if (
      JSON.stringify(expected) !==
      JSON.stringify(storyboard.motionContract)
    ) {
      return [
        {
          code: 'motion-contract-drift',
          message:
            'motionContract 不是当前 motionDirection、节拍角色、转场、editorial 和 Style Profile 的编译结果。',
          location: 'motionContract',
        },
      ];
    }
    return [];
  } catch (error) {
    return (
      error.issues ?? [
        {
          code: 'motion-contract-invalid',
          message: error.message,
          location: 'motionContract',
        },
      ]
    );
  }
};

export const validateMotionContractExecution = ({
  project,
  storyboard,
}) => {
  const issues = [];
  if (
    JSON.stringify(project.motionContract) !==
    JSON.stringify(storyboard.motionContract)
  ) {
    addIssue(
      issues,
      'motion-contract-project-drift',
      'project.motionContract 必须与已编译 storyboard.motionContract 完全一致。',
      'motionContract',
    );
    return issues;
  }
  const runtimeScenes = new Map(
    (project.scenes ?? []).map((scene) => [scene.id, scene]),
  );
  for (const coverage of storyboard.motionContract?.scenes ?? []) {
    const scene = runtimeScenes.get(coverage.sceneId);
    if (!scene) {
      addIssue(
        issues,
        'motion-contract-scene-missing',
        `项目缺少 motion contract 镜头 ${coverage.sceneId}。`,
        'scenes',
      );
      continue;
    }
    const events = new Map(
      (scene.events ?? []).map((event) => [event.beatId, event]),
    );
    const proofs = new Set(
      (scene.motion?.proofTimes ?? []).map(({id}) => id),
    );
    for (const phrase of coverage.phrases) {
      if (!proofs.has(phrase.proofTimeId)) {
        addIssue(
          issues,
          'motion-contract-proof-missing',
          `${coverage.sceneId}/${phrase.beatId} 缺少同步证明 ${phrase.proofTimeId}。`,
          `scenes#${coverage.sceneId}.motion.proofTimes`,
        );
      }
      const event = events.get(phrase.beatId);
      if (!event) {
        addIssue(
          issues,
          'motion-contract-event-missing',
          `${coverage.sceneId}/${phrase.beatId} 没有运行时 event 落实动作阶段 ${phrase.role}。`,
          `scenes#${coverage.sceneId}.events`,
        );
      } else if (event.proofTimeId !== phrase.proofTimeId) {
        addIssue(
          issues,
          'motion-contract-event-proof-drift',
          `${coverage.sceneId}/${phrase.beatId} 的运行时 event 必须绑定批准的同步证明 ${phrase.proofTimeId}。`,
          `scenes#${coverage.sceneId}.events`,
        );
      }
    }
  }
  return issues;
};

export const motionLanguageCard = (contract) => ({
  schemaVersion: 1,
  title: '全片动作语言卡',
  summary: contract.direction.summary,
  pacing: {
    approved: contract.direction.pacing,
    styleDefault: contract.styleProfileBinding.pacing,
    deviationRationale: contract.direction.styleDeviationRationale,
  },
  performance: contract.direction.performance,
  camera: contract.direction.camera,
  transitions: contract.direction.transitions,
  ambient: contract.direction.ambient,
  scenes: contract.scenes.map(
    ({sceneId, motionPolicy, phrases, finalHoldRatio, exception}) => ({
      sceneId,
      motionPolicy,
      phraseSequence: phrases.map(({role, beatId, proofTimeId}) => ({
        role,
        beatId,
        proofTimeId,
      })),
      finalHoldRatio,
      exception,
    }),
  ),
  approvalFingerprint: contract.approvalFingerprint,
  executionFingerprint: contract.fingerprint,
});
