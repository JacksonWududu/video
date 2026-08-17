const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const cleanZero = (value) => Object.is(value, -0) ? 0 : value;

export const resolveParallaxState = ({
  depth = 0,
  cameraX = 0,
  cameraY = 0,
  cameraZoom = 1,
  parallax,
} = {}) => {
  if (!parallax?.enabled) return {x: 0, y: 0, scale: 1};
  const relativeDepth = depth - (parallax.focalDepth ?? 0);
  const amount = relativeDepth * parallax.strength;
  return {
    x: cleanZero(cameraX * amount),
    y: cleanZero(cameraY * amount),
    scale: Math.max(0.01, 1 + (cameraZoom - 1) * amount),
  };
};

export const collectParallaxDepths = (nodes = []) =>
  nodes.flatMap((node) => (
    node?.kind === 'group' &&
    node.renderParticipation === 'derivation-only'
      ? []
      : [
    {
      id: node?.id,
      kind: node?.kind,
      depth: node?.depth ?? 0,
    },
    ...(node?.kind === 'group' ? collectParallaxDepths(node.children ?? []) : []),
      ]
  ));

const collectFrozenWorldDepthNodeIds = (nodes = [], frozenAncestor = false) =>
  nodes.flatMap((node) => {
    if (
      node?.kind === 'group' &&
      node.renderParticipation === 'derivation-only'
    ) {
      return [];
    }
    const frozen = frozenAncestor || (
      node?.kind === 'group' &&
      node.pattern === 'looping-environment' &&
      node.loopingEnvironment?.travel?.frozen === true
    );
    return [
      ...(frozen && node?.depth !== undefined ? [node.id] : []),
      ...(node?.kind === 'group'
        ? collectFrozenWorldDepthNodeIds(node.children ?? [], frozen)
        : []),
    ];
  });

const cameraKeyframesForValidation = (camera = {}) =>
  Array.isArray(camera.keyframes) && camera.keyframes.length >= 2
    ? camera.keyframes
    : camera.preset === 'static'
      ? [{x: 0, y: 0, zoom: 1}, {x: 0, y: 0, zoom: 1}]
      : [{x: 0, y: 0, zoom: 1}, {x: camera.intensity ?? 1, y: 0, zoom: 1.01}];

export const cameraHasVisibleMovement = (camera = {}) => {
  if (
    camera?.follow &&
    typeof camera.follow.targetNodeId === 'string' &&
    camera.follow.targetNodeId.length > 0 &&
    typeof camera.follow.worldNodeId === 'string' &&
    camera.follow.worldNodeId.length > 0
  ) {
    return true;
  }
  const keyframes = cameraKeyframesForValidation(camera);
  const values = (property, fallback) => keyframes.map((keyframe) => keyframe?.[property] ?? fallback);
  const spread = (items) => Math.max(...items) - Math.min(...items);
  return (
    spread(values('x', 0)) >= 0.5 ||
    spread(values('y', 0)) >= 0.5 ||
    spread(values('zoom', 1)) >= 0.002
  );
};

export const validateParallaxRig = ({
  camera,
  composition,
  location = 'camera.parallax',
} = {}) => {
  const issues = [];
  const add = (code, message, issueLocation) =>
    issues.push({level: 'error', code, message, location: issueLocation});
  const parallax = camera?.parallax;
  const nodes = collectParallaxDepths(composition?.nodes ?? []);
  const explicitlyDepthAuthored = nodes.filter(({id}) => {
    const find = (items = []) => {
      for (const node of items) {
        if (node?.id === id) return node;
        if (node?.kind === 'group') {
          const found = find(node.children ?? []);
          if (found) return found;
        }
      }
      return null;
    };
    return find(composition?.nodes ?? [])?.depth !== undefined;
  });
  const frozenWorldDepthNodeIds = new Set(
    collectFrozenWorldDepthNodeIds(composition?.nodes ?? []),
  );

  if (!parallax?.enabled) {
    for (const node of explicitlyDepthAuthored) {
      if (frozenWorldDepthNodeIds.has(node.id)) continue;
      add(
        'parallax-depth-without-rig',
        '节点声明 depth 时，镜头必须启用 camera.parallax。',
        `${location.replace(/camera\.parallax$/, 'composition')}#${node.id}.depth`,
      );
    }
    return issues;
  }
  if (!(finite(parallax.strength) && parallax.strength > 0 && parallax.strength <= 2)) {
    add('parallax-strength', 'camera.parallax.strength 必须位于 0..2。', `${location}.strength`);
  }
  if (!(finite(parallax.focalDepth) && parallax.focalDepth >= -1 && parallax.focalDepth <= 1)) {
    add('parallax-focal-depth', 'camera.parallax.focalDepth 必须位于 -1..1。', `${location}.focalDepth`);
  }
  if (!cameraHasVisibleMovement(camera)) {
    add('parallax-camera-motion', '启用景深视差时，camera 必须包含可见的平移或缩放。', location.replace(/\.parallax$/, ''));
  }
  const distinctDepths = new Set(nodes.map(({depth}) => depth));
  if (distinctDepths.size < 2) {
    add('parallax-depth-spread', '启用景深视差时，画面至少需要两个不同的 depth 层级。', location);
  }
  for (const node of nodes) {
    if (!(finite(node.depth) && node.depth >= -1 && node.depth <= 1)) {
      add(
        'parallax-node-depth',
        '节点 depth 必须位于 -1..1。',
        `${location.replace(/camera\.parallax$/, 'composition')}#${node.id}.depth`,
      );
    }
  }
  const walk = (items = [], parent = null) => {
    for (const node of items) {
      if (
        parent?.kind === 'group' &&
        !['free', 'registered-depth-stack', 'looping-environment'].includes(parent.pattern) &&
        node.depth !== undefined
      ) {
        add(
          'parallax-coupled-child-depth',
          '除 registered-depth-stack 与 looping-environment 外，耦合组合的子节点不得单独声明 depth；应由 group 作为景深载体。',
          `${location.replace(/camera\.parallax$/, 'composition')}#${node.id}.depth`,
        );
      }
      if (node?.kind === 'group' && node.pattern === 'registered-depth-stack') {
        const shrinking = (node.children ?? [])
          .filter(({depth}) => finite(depth))
          .some(({depth}) =>
            cameraKeyframesForValidation(camera).some((keyframe) =>
              resolveParallaxState({
                depth,
                cameraZoom: keyframe.zoom ?? 1,
                parallax,
              }).scale < 1 - 1e-9,
            ),
          );
        if (shrinking) {
          add(
            'parallax-layer-scale-shrink',
            'registered-depth-stack 的 camera parallax 不得让任何成员缩小到 scale < 1；调整 focalDepth/zoom 或扩大源包安全 bleed。',
            `${location.replace(/camera\.parallax$/, 'composition')}#${node.id}`,
          );
        }
      }
      if (node?.kind === 'group') walk(node.children ?? [], node);
    }
  };
  walk(composition?.nodes ?? []);
  return issues;
};
