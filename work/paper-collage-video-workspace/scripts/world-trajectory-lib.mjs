import {resolveSequenceState} from './state-sequence-lib.mjs';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const rectangleWithin = (rectangle, container, tolerance = 1e-6) =>
  rectangle.left >= container.left - tolerance &&
  rectangle.top >= container.top - tolerance &&
  rectangle.left + rectangle.width <= container.left + container.width + tolerance &&
  rectangle.top + rectangle.height <= container.top + container.height + tolerance;

const ease = (value, name = 'ease-in-out') => {
  const t = clamp01(value);
  if (name === 'ease-in') return t * t;
  if (name === 'ease-out') return 1 - (1 - t) * (1 - t);
  if (name === 'ease-in-out') return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  if (name === 'hold') return 0;
  return t;
};

const motionValueAt = ({motion = {}, progress, property, fallback}) => {
  const frames = [...(motion.keyframes ?? [])].sort((left, right) => left.at - right.at);
  if (frames.length === 0) return fallback;
  if (progress <= frames[0].at) return frames[0][property] ?? fallback;
  if (progress >= frames.at(-1).at) return frames.at(-1)[property] ?? fallback;
  const rightIndex = frames.findIndex(({at}) => at >= progress);
  const left = frames[rightIndex - 1];
  const right = frames[rightIndex];
  const amount = ease((progress - left.at) / Math.max(1e-9, right.at - left.at), right.ease);
  return (left[property] ?? fallback) + ((right[property] ?? fallback) - (left[property] ?? fallback)) * amount;
};

const rectForNode = ({node, parent, progress}) => {
  const transform = node.transform ?? {};
  const motion = {
    x: motionValueAt({motion: node.motion, progress, property: 'offsetX', fallback: 0}),
    y: motionValueAt({motion: node.motion, progress, property: 'offsetY', fallback: 0}),
    scale: motionValueAt({motion: node.motion, progress, property: 'scale', fallback: 1}),
  };
  const initialWidth = Number(transform.width ?? 1) * parent.width;
  const initialHeight = node.kind === 'group' && transform.height === undefined
    ? initialWidth * node.coordinateSpace.height / node.coordinateSpace.width
    : Number(transform.height ?? transform.width ?? 1) * parent.height;
  const width = initialWidth * motion.scale * Number(transform.scale ?? 1);
  const height = initialHeight * motion.scale * Number(transform.scale ?? 1);
  return {
    left: parent.left + (Number(transform.x ?? 0) + motion.x) * parent.width - Number(transform.anchorX ?? 0) * width,
    top: parent.top + (Number(transform.y ?? 0) + motion.y) * parent.height - Number(transform.anchorY ?? 0) * height,
    width,
    height,
  };
};

const resolveNodeRect = ({scene, nodeId, progress}) => {
  let result = null;
  const visit = (nodes, parent, path = []) => {
    for (const node of nodes ?? []) {
      const rect = rectForNode({node, parent, progress});
      const nextPath = [...path, node];
      if (node.id === nodeId) result = {node, rect, path: nextPath};
      if (node.kind === 'group') visit(node.children, rect, nextPath);
    }
  };
  visit(scene.composition?.nodes, {left: 0, top: 0, width: 1, height: 1});
  return result;
};

const proofFor = (scene, proofTimeId) =>
  (scene.motion?.proofTimes ?? []).find(({id}) => id === proofTimeId) ?? null;

const proofWindow = ({scene, fromProofTimeId, throughProofTimeId}) => {
  const from = proofFor(scene, fromProofTimeId);
  const through = proofFor(scene, throughProofTimeId);
  if (!from || !through || through.at < from.at) return null;
  return (scene.motion?.proofTimes ?? []).filter(({at}) => at >= from.at && at <= through.at);
};

const motionSampleTimes = ({path, from, through}) => {
  const times = new Set([from, through]);
  for (const node of path ?? []) {
    for (const frame of node.motion?.keyframes ?? []) {
      if (frame.at >= from && frame.at <= through) times.add(frame.at);
    }
  }
  return [...times].sort((left, right) => left - right);
};

const sceneById = (project) => new Map((project.scenes ?? []).map((scene, index) => [scene.id, {...scene, sceneIndex: index}]));

const add = (issues, code, message, location) =>
  issues.push({level: 'error', code, message, location});

export const validateWorldContracts = (project) => {
  const issues = [];
  if (project.worlds === undefined) return issues;
  if (!Array.isArray(project.worlds)) {
    add(issues, 'world-contracts-type', 'worlds 必须为数组。', 'worlds');
    return issues;
  }
  const scenes = sceneById(project);
  const ids = new Set();
  for (const [worldIndex, world] of project.worlds.entries()) {
    const location = `worlds[${worldIndex}]`;
    if (!nonEmpty(world?.id) || ids.has(world.id)) {
      add(issues, 'world-contract-id', 'world id 缺失或重复。', `${location}.id`);
      continue;
    }
    ids.add(world.id);
    if (!Array.isArray(world.sceneIds) || world.sceneIds.length === 0) {
      add(issues, 'world-contract-scenes', 'world 必须至少绑定一个镜头。', `${location}.sceneIds`);
      continue;
    }
    const requiredRoles = new Set(world.requiredStripRoles ?? []);
    if (!['far', 'mid', 'ground', 'near'].every((role) => requiredRoles.has(role))) {
      add(issues, 'world-contract-layer-roles', '连续世界必须声明 far、mid、ground、near 四类世界图层。', `${location}.requiredStripRoles`);
    }
    const sourceByRole = new Map();
    for (const [sourceIndex, source] of (world.stripSources ?? []).entries()) {
      if (!requiredRoles.has(source?.role) || !nonEmpty(source?.sourceAssetId) || sourceByRole.has(source.role)) {
        add(issues, 'world-contract-strip-sources', '连续世界必须为每个 far、mid、ground、near 图层声明唯一的 sourceAssetId。', `${location}.stripSources[${sourceIndex}]`);
        continue;
      }
      sourceByRole.set(source.role, source.sourceAssetId);
    }
    for (const role of requiredRoles) {
      if (!sourceByRole.has(role)) add(issues, 'world-contract-strip-sources', `连续世界缺少 ${role} 图层的 sourceAssetId。`, `${location}.stripSources`);
    }
    for (const sceneId of world.sceneIds) {
      const scene = scenes.get(sceneId);
      const sceneLocation = `${location}.sceneIds`;
      if (!scene) {
        add(issues, 'world-contract-scene-missing', `world 引用了不存在的镜头 ${sceneId}。`, sceneLocation);
        continue;
      }
      const binding = scene.composition?.world;
      if (binding?.id !== world.id) {
        add(issues, 'world-contract-scene-binding', `镜头 ${sceneId} 必须绑定连续世界 ${world.id}。`, `scenes.${sceneId}.composition.world`);
        continue;
      }
      const group = resolveNodeRect({scene, nodeId: binding.groupId, progress: 0})?.node;
      if (group?.kind !== 'group' || group.pattern !== 'looping-environment') {
        add(issues, 'world-contract-group', '连续世界必须绑定 looping-environment 组。', `scenes.${sceneId}.composition.world.groupId`);
        continue;
      }
      const actualRoles = new Set((group.children ?? []).filter(({kind}) => kind === 'world-strip').map(({role}) => role));
      for (const role of requiredRoles) {
        if (!actualRoles.has(role)) add(issues, 'world-contract-strip-role', `世界组缺少 ${role} 图层。`, `scenes.${sceneId}.composition.world.groupId`);
      }
      for (const strip of (group.children ?? []).filter(({kind}) => kind === 'world-strip')) {
        const expectedSource = sourceByRole.get(strip.role);
        if (expectedSource && strip.loopingStripBinding?.sourceAssetId !== expectedSource) {
          add(issues, 'world-contract-strip-source', `世界图层 ${strip.role} 必须复用连续世界声明的 sourceAssetId。`, `scenes.${sceneId}.composition.world.groupId`);
        }
      }
      const route = binding.route;
      const band = route?.subjectSafeBand;
      if (![band?.x, band?.y, band?.width, band?.height].every(finite) || band.x < 0 || band.y < 0 || band.width <= 0 || band.height <= 0 || band.x + band.width > 1 || band.y + band.height > 1) {
        add(issues, 'world-route-safe-band', '路线 subjectSafeBand 必须是画布内的规范矩形。', `scenes.${sceneId}.composition.world.route.subjectSafeBand`);
        continue;
      }
      const travelers = route?.travelers ?? [];
      if (!Array.isArray(travelers) || travelers.length === 0) {
        add(issues, 'world-route-subjects', '路线必须绑定至少一个行进主体。', `scenes.${sceneId}.composition.world.route.travelers`);
      }
      const travelerIds = new Set();
      for (const [travelerIndex, traveler] of travelers.entries()) {
        const travelerLocation = `scenes.${sceneId}.composition.world.route.travelers[${travelerIndex}]`;
        if (!nonEmpty(traveler?.nodeId) || travelerIds.has(traveler.nodeId)) {
          add(issues, 'world-route-traveler-id', '路线行者 nodeId 缺失或重复。', travelerLocation);
          continue;
        }
        travelerIds.add(traveler.nodeId);
        const proofs = proofWindow({
          scene,
          fromProofTimeId: traveler.fromProofTimeId,
          throughProofTimeId: traveler.throughProofTimeId,
        });
        if (!proofs || proofs.length === 0) {
          add(issues, 'world-route-traveler-window', '路线行者必须声明同幕、非递减的 proof 窗口。', travelerLocation);
          continue;
        }
        for (const proof of proofs) {
          const subject = resolveNodeRect({scene, nodeId: traveler.nodeId, progress: proof.at});
          if (!subject) {
            add(issues, 'world-route-subject-missing', `路线主体不存在：${traveler.nodeId}。`, travelerLocation);
            break;
          }
          if (!rectangleWithin(subject.rect, {left: band.x, top: band.y, width: band.width, height: band.height})) {
            add(issues, 'world-route-subject-outside-band', `主体 ${traveler.nodeId} 在证明时刻 ${proof.id} 离开路线安全带。`, `scenes.${sceneId}.motion.proofTimes`);
          }
        }
      }
      const markerIds = route?.markerNodeIds ?? [];
      if (!Array.isArray(markerIds)) {
        add(issues, 'world-route-markers', '路线 markerNodeIds 必须为数组。', `scenes.${sceneId}.composition.world.route.markerNodeIds`);
      } else {
        for (const markerId of markerIds) {
          const marker = resolveNodeRect({scene, nodeId: markerId, progress: 0});
          if (!marker) {
            add(issues, 'world-route-marker-missing', `路线标记不存在：${markerId}。`, `scenes.${sceneId}.composition.world.route.markerNodeIds`);
          } else if (marker.rect.top + marker.rect.height < band.y || marker.rect.top > band.y + band.height) {
            add(issues, 'world-route-marker-floating', `路线标记 ${markerId} 必须锚定在路线地带，而不是悬在画面中。`, `scenes.${sceneId}.composition.world.route.markerNodeIds`);
          }
        }
      }
    }
  }
  return issues;
};

const trajectoryTime = ({scene, proof}) => scene.sceneIndex + proof.at;

export const validateTrajectoryContracts = (project) => {
  const issues = [];
  if (project.trajectoryContracts === undefined) return issues;
  if (!Array.isArray(project.trajectoryContracts)) {
    add(issues, 'trajectory-contracts-type', 'trajectoryContracts 必须为数组。', 'trajectoryContracts');
    return issues;
  }
  const scenes = sceneById(project);
  const contractIds = new Set();
  for (const [contractIndex, contract] of project.trajectoryContracts.entries()) {
    const location = `trajectoryContracts[${contractIndex}]`;
    if (!nonEmpty(contract?.id) || contractIds.has(contract.id)) {
      add(issues, 'trajectory-contract-id', '轨迹契约 id 缺失或重复。', `${location}.id`);
      continue;
    }
    contractIds.add(contract.id);
    const assertions = new Map();
    for (const [assertionIndex, assertion] of (contract.assertions ?? []).entries()) {
      const assertionLocation = `${location}.assertions[${assertionIndex}]`;
      if (!nonEmpty(assertion?.id) || assertions.has(assertion.id)) {
        add(issues, 'trajectory-assertion-id', '轨迹断言 id 缺失或重复。', `${assertionLocation}.id`);
        continue;
      }
      assertions.set(assertion.id, assertion);
      const scene = scenes.get(assertion.sceneId);
      const proof = scene && proofFor(scene, assertion.proofTimeId);
      if (!scene || !proof) {
        add(issues, 'trajectory-proof-missing', '轨迹断言必须绑定存在的 sceneId 与 proofTimeId。', assertionLocation);
        continue;
      }
      const resolve = (nodeId, at = proof.at) => resolveNodeRect({scene, nodeId, progress: at});
      if (assertion.kind === 'state-at') {
        const target = resolve(assertion.nodeId);
        if (target?.node?.kind !== 'state-sequence') {
          add(issues, 'trajectory-state-node', 'state-at 必须引用 state-sequence 节点。', `${assertionLocation}.nodeId`);
        } else if (resolveSequenceState({node: target.node, progress: proof.at}).id !== assertion.stateId) {
          add(issues, 'trajectory-state-mismatch', `节点 ${assertion.nodeId} 在 ${assertion.proofTimeId} 未处于状态 ${assertion.stateId}。`, assertionLocation);
        }
      } else if (assertion.kind === 'relative-order') {
        const leading = resolve(assertion.leadingNodeId);
        const trailing = resolve(assertion.trailingNodeId);
        if (!leading || !trailing) {
          add(issues, 'trajectory-order-node', 'relative-order 必须引用存在的两个节点。', assertionLocation);
        } else {
          const gap = assertion.leadingSide === 'right'
            ? leading.rect.left - (trailing.rect.left + trailing.rect.width)
            : trailing.rect.left - (leading.rect.left + leading.rect.width);
          if (gap < assertion.minimumGap) add(issues, 'trajectory-order-gap', `领先关系未满足最小间距 ${assertion.minimumGap}。`, assertionLocation);
        }
      } else if (assertion.kind === 'travel') {
        const fromProof = proofFor(scene, assertion.fromProofTimeId);
        const toProof = proofFor(scene, assertion.toProofTimeId);
        const from = fromProof && resolve(assertion.nodeId, fromProof.at);
        const to = toProof && resolve(assertion.nodeId, toProof.at);
        if (!fromProof || !toProof || !from || !to || toProof.at <= fromProof.at) {
          add(issues, 'trajectory-travel-proof', 'travel 必须引用同幕中严格递增的两个证明时刻与存在节点。', assertionLocation);
        } else {
          const delta = to.rect.left - from.rect.left;
          const signed = assertion.direction === 'right' ? delta : -delta;
          if (signed < assertion.minimumDelta) add(issues, 'trajectory-travel-distance', `节点 ${assertion.nodeId} 未按 ${assertion.direction} 方向移动至少 ${assertion.minimumDelta}。`, assertionLocation);
        }
      } else if (assertion.kind === 'monotonic-travel') {
        const fromProof = proofFor(scene, assertion.fromProofTimeId);
        const from = fromProof && resolve(assertion.nodeId, fromProof.at);
        const to = resolve(assertion.nodeId, proof.at);
        if (!fromProof || !from || !to || proof.at <= fromProof.at) {
          add(issues, 'trajectory-monotonic-proof', 'monotonic-travel 必须引用同幕中严格递增的两个证明时刻与存在节点。', assertionLocation);
        } else {
          const samples = motionSampleTimes({path: to.path, from: fromProof.at, through: proof.at})
            .map((at) => ({at, target: resolve(assertion.nodeId, at)}));
          if (samples.some(({target}) => !target)) {
            add(issues, 'trajectory-monotonic-node', `节点 ${assertion.nodeId} 无法在完整单调窗口中解析。`, assertionLocation);
            continue;
          }
          const direction = assertion.direction === 'right' ? 1 : -1;
          const hasBacktrack = samples.some(({target}, index) =>
            index > 0 && direction * (target.rect.left - samples[index - 1].target.rect.left) < -1e-6);
          if (hasBacktrack) add(issues, 'trajectory-monotonic-backtrack', `节点 ${assertion.nodeId} 在 ${assertion.fromProofTimeId} 至 ${assertion.proofTimeId} 出现反向移动。`, assertionLocation);
          const total = direction * (samples.at(-1).target.rect.left - samples[0].target.rect.left);
          if (total < assertion.minimumDelta) add(issues, 'trajectory-monotonic-distance', `节点 ${assertion.nodeId} 在单调窗口内未完成至少 ${assertion.minimumDelta} 的净位移。`, assertionLocation);
        }
      } else if (assertion.kind === 'offscreen-at') {
        const target = resolve(assertion.nodeId);
        if (!target) add(issues, 'trajectory-offscreen-node', 'offscreen-at 必须引用存在节点。', assertionLocation);
        else {
          const outside = assertion.side === 'left'
            ? target.rect.left + target.rect.width <= 0
            : target.rect.left >= 1;
          if (!outside) add(issues, 'trajectory-offscreen-failed', `节点 ${assertion.nodeId} 在 ${assertion.proofTimeId} 未完全离开${assertion.side === 'left' ? '左' : '右'}侧画面。`, assertionLocation);
        }
      } else {
        add(issues, 'trajectory-kind', `未知轨迹断言类型：${assertion.kind}。`, `${assertionLocation}.kind`);
      }
    }
    let previous = -Infinity;
    const sequenceIds = new Set();
    for (const [sequenceIndex, id] of (contract.sequence ?? []).entries()) {
      const assertion = assertions.get(id);
      if (!assertion || sequenceIds.has(id)) {
        add(issues, 'trajectory-sequence-reference', '轨迹 sequence 必须引用不重复的已声明 assertion。', `${location}.sequence[${sequenceIndex}]`);
        continue;
      }
      sequenceIds.add(id);
      const scene = scenes.get(assertion.sceneId);
      const proof = scene && proofFor(scene, assertion.proofTimeId);
      const at = scene && proof ? trajectoryTime({scene, proof}) : null;
      if (at !== null && at < previous) add(issues, 'trajectory-sequence-order', '轨迹 sequence 必须按全片证明时刻非递减；同一证明时刻可组合多个关系断言。', `${location}.sequence[${sequenceIndex}]`);
      if (at !== null) previous = at;
    }
  }
  return issues;
};

export const validateProductionContracts = (project) => [
  ...validateWorldContracts(project),
  ...validateTrajectoryContracts(project),
];

export const summarizeProductionContracts = (project) => ({
  worlds: (project.worlds ?? []).map(({id, sceneIds, requiredStripRoles, stripSources}) => ({id, sceneIds, requiredStripRoles, stripSources})),
  trajectories: (project.trajectoryContracts ?? []).map(({id, sequence, assertions}) => ({
    id,
    sequence,
    assertionCount: assertions?.length ?? 0,
  })),
});
