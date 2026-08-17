const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const clamp01 = (value) => clamp(value, 0, 1);

const SHA256_INITIAL = Object.freeze([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);
const SHA256_CONSTANTS = Object.freeze([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotateRight = (value, shift) =>
  (value >>> shift) | (value << (32 - shift));

const sha256Hex = (text) => {
  const bytes = new TextEncoder().encode(text);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const hash = [...SHA256_INITIAL];
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const previous = words[index - 15];
      const secondPrevious = words[index - 2];
      const sigma0 =
        rotateRight(previous, 7) ^ rotateRight(previous, 18) ^ (previous >>> 3);
      const sigma1 =
        rotateRight(secondPrevious, 17) ^
        rotateRight(secondPrevious, 19) ^
        (secondPrevious >>> 10);
      words[index] =
        (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temporary1 =
        (h + sum1 + choose + SHA256_CONSTANTS[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }
  return hash.map((value) => value.toString(16).padStart(8, '0')).join('');
};

export const EDITORIAL_PROFILE_IDS = Object.freeze(['16:9', '9:16', '1:1']);
export const EDITORIAL_ROUNDING = Object.freeze(['nearest', 'floor', 'ceil']);
export const ANNOTATION_KINDS = Object.freeze([
  'arrow',
  'leader-line',
  'label',
  'badge',
  'explainer-card',
  'callout',
  'bracket',
  'numeric-counter',
  'percentage-counter',
]);
export const DATA_GRAPHIC_KINDS = Object.freeze([
  'bar-chart',
  'column-chart',
  'line-chart',
  'comparison-table',
  'timeline',
  'map',
  'flow',
]);

export const stableEditorialHash = (value) =>
  sha256Hex(JSON.stringify(value));

export const secondsToFrame = (seconds, fps, rounding = 'nearest') => {
  if (!finite(seconds) || seconds < 0) throw new Error(`无效媒体时间：${seconds}`);
  if (!finite(fps) || fps <= 0) throw new Error(`无效帧率：${fps}`);
  if (!EDITORIAL_ROUNDING.includes(rounding)) throw new Error(`未知取整规则：${rounding}`);
  const raw = seconds * fps;
  if (rounding === 'floor') return Math.floor(raw + 1e-9);
  if (rounding === 'ceil') return Math.ceil(raw - 1e-9);
  return Math.round(raw);
};

export const frameToSeconds = (frame, fps) => {
  if (!Number.isInteger(frame) || frame < 0) throw new Error(`无效帧：${frame}`);
  if (!finite(fps) || fps <= 0) throw new Error(`无效帧率：${fps}`);
  return frame / fps;
};

export const resolvedEditPointFor = (editorial, editPointId, sceneId) =>
  editorial?.resolvedEditPoints?.find(
    (point) => point.id === editPointId && (!sceneId || point.sceneId === sceneId),
  ) ?? null;

export const editPointFrameFor = (editorial, editPointId, sceneId) => {
  const point = resolvedEditPointFor(editorial, editPointId, sceneId);
  if (!point) throw new Error(`缺少已编译 edit point：${editPointId}`);
  return point.sceneFrame;
};

export const editPointProgress = ({
  editorial,
  editPointId,
  sceneId,
  frame,
  durationFrames = 1,
}) => {
  const at = editPointFrameFor(editorial, editPointId, sceneId);
  return clamp01((frame - at) / Math.max(1, durationFrames));
};

const glyphUnits = (character) => {
  if (/\s/u.test(character)) return 0.32;
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(character)) return 1;
  if (/[A-Z0-9]/u.test(character)) return 0.68;
  if (/[a-z]/u.test(character)) return 0.56;
  if (/[,.;:!?，。；：！？、'"“”‘’()\[\]{}]/u.test(character)) return 0.38;
  return 0.62;
};

export const measureEditorialText = (text, fontSize, letterSpacing = 0) => {
  const characters = [...String(text ?? '')];
  const units = characters.reduce((sum, character) => sum + glyphUnits(character), 0);
  return units * fontSize + Math.max(0, characters.length - 1) * letterSpacing;
};

const breakToken = ({token, maxWidth, fontSize, letterSpacing}) => {
  const pieces = [];
  let current = '';
  for (const character of [...token]) {
    const candidate = current + character;
    if (current && measureEditorialText(candidate, fontSize, letterSpacing) > maxWidth) {
      pieces.push(current);
      current = character;
    } else {
      current = candidate;
    }
  }
  if (current) pieces.push(current);
  return pieces;
};

export const wrapEditorialText = ({
  text,
  maxWidth,
  fontSize,
  letterSpacing = 0,
}) => {
  const paragraphs = String(text ?? '').split('\n');
  const lines = [];
  for (const paragraph of paragraphs) {
    if (paragraph === '') {
      lines.push('');
      continue;
    }
    const tokens = paragraph.match(/[\p{Script=Han}]|[^\p{Script=Han}\s]+|\s+/gu) ?? [paragraph];
    let current = '';
    for (const token of tokens) {
      const candidate = current + token;
      if (!current || measureEditorialText(candidate, fontSize, letterSpacing) <= maxWidth) {
        current = candidate;
        continue;
      }
      lines.push(current.trimEnd());
      const pieces = measureEditorialText(token, fontSize, letterSpacing) > maxWidth
        ? breakToken({token, maxWidth, fontSize, letterSpacing})
        : [token.trimStart()];
      current = pieces.pop() ?? '';
      lines.push(...pieces);
    }
    lines.push(current.trimEnd());
  }
  return lines;
};

export const fitEditorialTypography = ({
  text,
  width,
  height,
  minFontSize,
  maxFontSize,
  maxLines,
  lineHeight,
  letterSpacing = 0,
}) => {
  if (![width, height, minFontSize, maxFontSize, maxLines, lineHeight].every(finite)) {
    throw new Error('typography fit 参数必须是有限数值。');
  }
  let lower = Math.floor(minFontSize);
  let upper = Math.floor(maxFontSize);
  let best = null;
  const evaluate = (fontSize) => {
    const lines = wrapEditorialText({text, maxWidth: width, fontSize, letterSpacing});
    const requiredHeight = lines.length * fontSize * lineHeight;
    return {
      fontSize,
      lines,
      requiredHeight,
      overflow: lines.length > maxLines || requiredHeight > height + 1e-6,
    };
  };
  while (lower <= upper) {
    const candidate = Math.floor((lower + upper) / 2);
    const result = evaluate(candidate);
    if (result.overflow) {
      upper = candidate - 1;
    } else {
      best = result;
      lower = candidate + 1;
    }
  }
  return best ?? evaluate(Math.floor(minFontSize));
};

export const typographyRevealUnits = (node, lines) => {
  const mode = node.treatment?.reveal?.mode ?? 'none';
  if (mode === 'line') return lines.map((text, index) => ({id: `line-${index + 1}`, text}));
  if (mode === 'word') {
    const authored = node.treatment.reveal.units;
    if (Array.isArray(authored) && authored.length > 0) return authored;
    return String(node.text ?? '')
      .match(/[\p{Script=Han}]|[\p{L}\p{N}]+|[^\s]/gu)
      ?.map((text, index) => ({id: `word-${index + 1}`, text})) ?? [];
  }
  return [{id: 'all', text: String(node.text ?? '')}];
};

export const resolveTypographyReveal = ({
  node,
  editorial,
  sceneId,
  frame,
  lines,
}) => {
  const reveal = node.treatment?.reveal ?? {mode: 'none'};
  const units = typographyRevealUnits(node, lines);
  if (reveal.mode === 'none') return units.map((unit) => ({...unit, visible: true}));
  const bindings = reveal.editPointIds ?? [];
  return units.map((unit, index) => {
    const editPointId = bindings[Math.min(index, bindings.length - 1)];
    const point = editPointId
      ? resolvedEditPointFor(editorial, editPointId, sceneId)
      : null;
    return {...unit, editPointId: editPointId ?? null, visible: point ? frame >= point.sceneFrame : false};
  });
};

export const resolveTypographyEmphasis = ({node, editorial, sceneId, frame}) => {
  const active = (node.treatment?.emphasis ?? []).filter(({editPointId, durationFrames = 1}) => {
    const point = resolvedEditPointFor(editorial, editPointId, sceneId);
    return point && frame >= point.sceneFrame && frame <= point.sceneFrame + durationFrames;
  });
  return active;
};

const anchorFraction = (anchor) => {
  switch (anchor) {
    case 'top': return {x: 0.5, y: 0};
    case 'top-right': return {x: 1, y: 0};
    case 'right': return {x: 1, y: 0.5};
    case 'bottom-right': return {x: 1, y: 1};
    case 'bottom': return {x: 0.5, y: 1};
    case 'bottom-left': return {x: 0, y: 1};
    case 'left': return {x: 0, y: 0.5};
    case 'top-left': return {x: 0, y: 0};
    case 'center':
    default:
      return {x: 0.5, y: 0.5};
  }
};

export const resolveSemanticAnchor = ({reference, nodes}) => {
  if (reference?.point && finite(reference.point.x) && finite(reference.point.y)) {
    return {x: reference.point.x, y: reference.point.y};
  }
  const target = nodes.find(({id}) => id === reference?.targetId);
  if (!target) return null;
  const fraction = anchorFraction(reference.anchor);
  const transform = target.transform;
  return {
    x: transform.x + (fraction.x - transform.anchorX) * transform.width,
    y:
      transform.y +
      (fraction.y - transform.anchorY) *
        (transform.height ?? transform.width),
  };
};

const composeAnchorTransform = (transform, parent) => ({
  ...transform,
  x: parent.x - parent.anchorX * parent.width + transform.x * parent.width,
  y: parent.y - parent.anchorY * parent.height + transform.y * parent.height,
  width: transform.width * parent.width,
  height: (transform.height ?? transform.width) * parent.height,
});

export const flattenEditorialAnchorNodes = (
  nodes,
  parent = {x: 0, y: 0, width: 1, height: 1, anchorX: 0, anchorY: 0},
) => (nodes ?? []).flatMap((node) => {
  const transform = composeAnchorTransform(node.transform, parent);
  const flattened = [{...node, transform}];
  if (node.kind === 'group') {
    flattened.push(...flattenEditorialAnchorNodes(node.children, transform));
  } else if (node.kind === 'editorial-switch') {
    for (const panel of node.panels ?? []) {
      flattened.push(...flattenEditorialAnchorNodes([panel.node], transform));
    }
  }
  return flattened;
});

const applyResponsivePlacements = (nodes, placements) =>
  (nodes ?? []).map((node) => {
    const placement = placements.get(node.id);
    const transform = placement
      ? {...node.transform, ...placement}
      : node.transform;
    if (node.kind === 'group') {
      return {
        ...node,
        transform,
        children: applyResponsivePlacements(node.children, placements),
      };
    }
    if (node.kind === 'editorial-switch') {
      return {
        ...node,
        transform,
        panels: node.panels.map((panel) => ({
          ...panel,
          node: applyResponsivePlacements([panel.node], placements)[0],
        })),
      };
    }
    return {...node, transform};
  });

const findResponsiveNode = (nodes, targetId) => {
  for (const node of nodes ?? []) {
    if (node.id === targetId) return node;
    if (node.kind === 'group') {
      const nested = findResponsiveNode(node.children, targetId);
      if (nested) return nested;
    }
    if (node.kind === 'editorial-switch') {
      for (const panel of node.panels ?? []) {
        const nested = findResponsiveNode([panel.node], targetId);
        if (nested) return nested;
      }
    }
  }
  return null;
};

const placementAlreadyMaterialized = (node, placement) =>
  node &&
  ['x', 'y', 'width', 'height'].every((key) =>
    placement[key] === undefined ||
    Math.abs(Number(node.transform?.[key]) - Number(placement[key])) <= 1e-9
  );

export const applyResponsiveDirectingPlan = (project) => {
  const profileId = project.editorial?.activeProfile;
  if (!profileId) return project;
  const profile = project.editorial.responsivePlans.find(
    (candidate) => candidate.profileId === profileId,
  );
  if (!profile) throw new Error(`缺少已编译响应式导演计划：${profileId}`);
  if (project.video.width !== profile.width || project.video.height !== profile.height) {
    throw new Error(
      `video ${project.video.width}x${project.video.height} 与 activeProfile ${profileId} 的 ${profile.width}x${profile.height} 不一致。`,
    );
  }
  const alreadyMaterialized = project.scenes.every((scene) => {
    const plan = profile.scenes.find(({sceneId}) => sceneId === scene.id);
    return (
      plan &&
      scene.composition?.coordinateSpace?.width === profile.width &&
      scene.composition?.coordinateSpace?.height === profile.height &&
      plan.placements.every(({targetId, transform: placement}) =>
        placementAlreadyMaterialized(
          findResponsiveNode(scene.composition?.nodes, targetId),
          placement,
        )
      )
    );
  });
  if (alreadyMaterialized) return project;
  return {
    ...project,
    scenes: project.scenes.map((scene) => {
      const plan = profile.scenes.find(({sceneId}) => sceneId === scene.id);
      if (!plan) throw new Error(`响应式导演计划 ${profileId} 缺少镜头 ${scene.id}。`);
      const placements = new Map(
        plan.placements.map(({targetId, transform}) => [targetId, transform]),
      );
      return {
        ...scene,
        camera: {
          ...scene.camera,
          parallax: scene.camera.parallax
            ? {
                ...scene.camera.parallax,
                strength: scene.camera.parallax.strength * plan.parallaxScale,
              }
            : scene.camera.parallax,
        },
        composition: {
          ...scene.composition,
          coordinateSpace: {width: profile.width, height: profile.height},
          nodes: applyResponsivePlacements(scene.composition.nodes, placements),
        },
      };
    }),
  };
};

const segmentsIntersectRectangle = ({from, to, zone}) => {
  const steps = 48;
  for (let index = 0; index <= steps; index += 1) {
    const progress = index / steps;
    const x = from.x + (to.x - from.x) * progress;
    const y = from.y + (to.y - from.y) * progress;
    const padding = zone.padding ?? 0;
    if (
      x >= zone.x - padding &&
      x <= zone.x + zone.width + padding &&
      y >= zone.y - padding &&
      y <= zone.y + zone.height + padding
    ) return true;
  }
  return false;
};

export const resolveAnnotationRoute = ({node, nodes, zones = []}) => {
  const semanticNodes = flattenEditorialAnchorNodes(nodes);
  const from = resolveSemanticAnchor({reference: node.anchor, nodes: semanticNodes});
  const to = resolveSemanticAnchor({reference: node.target, nodes: semanticNodes});
  if (!from || !to) {
    return {valid: false, reason: 'invalid-target', from, to, points: []};
  }
  const protectedZones = zones.filter(({id}) => (node.avoidZoneIds ?? []).includes(id));
  const directBlocked = protectedZones.some((zone) =>
    segmentsIntersectRectangle({from, to, zone})
  );
  let points = [from, to];
  if (directBlocked && node.routing === 'orthogonal') {
    const candidates = [
      [from, {x: from.x, y: to.y}, to],
      [from, {x: to.x, y: from.y}, to],
    ];
    points =
      candidates.find((candidate) =>
        !candidate.slice(0, -1).some((point, index) =>
          protectedZones.some((zone) =>
            segmentsIntersectRectangle({from: point, to: candidate[index + 1], zone})
          )
        )
      ) ?? [];
  }
  const outOfBounds = points.some(({x, y}) => x < 0 || x > 1 || y < 0 || y > 1);
  return {
    valid: points.length >= 2 && !outOfBounds,
    reason: points.length < 2 ? 'collision' : outOfBounds ? 'out-of-bounds' : null,
    from,
    to,
    points,
    directBlocked,
  };
};

const dataValues = (node) => {
  if (Array.isArray(node.data?.values)) return node.data.values.map(({value}) => value);
  if (Array.isArray(node.data?.points)) return node.data.points.map(({value}) => value);
  if (Array.isArray(node.data?.rows)) {
    return node.data.rows.flatMap(({values}) => values ?? []).filter(finite);
  }
  if (Array.isArray(node.data?.regions)) return node.data.regions.map(({value}) => value);
  return [];
};

export const resolveDataDomain = (node) => {
  const values = dataValues(node);
  const authored = node.scale?.domain;
  const minimum = authored?.[0] ?? Math.min(0, ...values);
  const maximum = authored?.[1] ?? Math.max(1, ...values);
  return [minimum, maximum === minimum ? minimum + 1 : maximum];
};

export const formatDataValue = (value, format = {}) => {
  const decimals = Number.isInteger(format.decimals) ? format.decimals : 0;
  const scaled = value * (format.multiplier ?? 1);
  return `${format.prefix ?? ''}${scaled.toFixed(decimals)}${format.unit ?? ''}${format.suffix ?? ''}`;
};

export const validateDataGraphicNode = (node, location = `node:${node?.id ?? 'unknown'}`) => {
  const issues = [];
  const add = (code, message, suffix = '') =>
    issues.push({code, message, location: `${location}${suffix}`});
  if (!DATA_GRAPHIC_KINDS.includes(node?.graphicKind)) {
    add('data-graphic-kind', `未知数据图形：${node?.graphicKind}`, '.graphicKind');
    return issues;
  }
  const values = dataValues(node);
  if (node.graphicKind !== 'flow' && values.length === 0) add('data-empty', '数据图形不能为空。', '.data');
  if (values.some((value) => !finite(value))) add('data-invalid-number', '数据必须是有限数值。', '.data');
  const [minimum, maximum] = resolveDataDomain(node);
  if (!finite(minimum) || !finite(maximum) || maximum <= minimum) {
    add('data-domain', 'scale.domain 必须是严格递增的有限区间。', '.scale.domain');
  }
  if (values.some((value) => value < minimum || value > maximum)) {
    add('data-outside-domain', '数据值超出已声明 domain。', '.data');
  }
  if (node.graphicKind === 'map') {
    const geometryIds = new Set((node.geometry ?? []).map(({regionId}) => regionId));
    for (const region of node.data?.regions ?? []) {
      if (!geometryIds.has(region.regionId)) {
        add('map-region-geometry', `区域 ${region.regionId} 没有注册 geometry。`, '.geometry');
      }
    }
  }
  if (node.graphicKind === 'flow') {
    const ids = new Set((node.data?.nodes ?? []).map(({id}) => id));
    if (ids.size === 0 || !(node.data?.edges ?? []).length) {
      add('flow-empty', '关系图必须至少包含一个节点和一条边。', '.data');
    }
    for (const edge of node.data?.edges ?? []) {
      if (!ids.has(edge.from) || !ids.has(edge.to)) {
        add('flow-edge-target', `关系 ${edge.from} → ${edge.to} 引用了无效节点。`, '.data.edges');
      }
    }
  }
  return issues;
};

export const resolveDataState = ({node, editorial, sceneId, frame}) => {
  const states = node.states ?? [];
  let active = states[0] ?? {
    id: 'default',
    reveal: 1,
    focusIds: [],
  };
  for (const state of states) {
    const point = resolvedEditPointFor(editorial, state.editPointId, sceneId);
    if (point && frame >= point.sceneFrame) active = state;
  }
  return active;
};

export const resolveEditorialSwitch = ({node, editorial, sceneId, frame}) => {
  let activePanelId = node.panels?.[0]?.id ?? null;
  let activeChange = null;
  for (const change of node.changes ?? []) {
    const point = resolvedEditPointFor(editorial, change.editPointId, sceneId);
    if (point && frame >= point.sceneFrame) {
      activePanelId = change.toPanelId;
      activeChange = {...change, frame: point.sceneFrame};
    }
  }
  const transitionProgress = activeChange
    ? clamp01((frame - activeChange.frame) / Math.max(1, activeChange.durationFrames))
    : 1;
  return {activePanelId, activeChange, transitionProgress};
};

export const lifecycleOpacity = ({lifecycle, editorial, sceneId, frame}) => {
  if (!lifecycle) return 1;
  const enter = lifecycle.enterEditPointId
    ? resolvedEditPointFor(editorial, lifecycle.enterEditPointId, sceneId)
    : null;
  const exit = lifecycle.exitEditPointId
    ? resolvedEditPointFor(editorial, lifecycle.exitEditPointId, sceneId)
    : null;
  const enterFrames = Math.max(1, lifecycle.enterFrames ?? 1);
  const exitFrames = Math.max(1, lifecycle.exitFrames ?? 1);
  const entered = enter ? clamp01((frame - enter.sceneFrame) / enterFrames) : 1;
  const exited = exit ? 1 - clamp01((frame - exit.sceneFrame) / exitFrames) : 1;
  return Math.min(entered, exited);
};
