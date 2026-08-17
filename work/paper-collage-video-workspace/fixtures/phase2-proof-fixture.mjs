import {compileStoryboardDirecting} from '../scripts/storyboard-lib.mjs';
import {
  applyResponsiveDirectingPlan,
  stableEditorialHash,
} from '../src/editorialPrimitives.mjs';
import {
  createMotionDirectionFixture,
  FIXTURE_STYLE_PROFILE,
} from './motion-contract-fixture.mjs';

export const PHASE2_PROOF_SLUG = 'vox-phase2-proof';
export const PHASE2_PROOF_FPS = 30;
export const PHASE2_PROOF_UPDATED_AT = '2026-07-23T00:00:00.000Z';
export const PHASE2_REGISTERED_FAMILY = Object.freeze({
  familyId: 'phase2-depth-family',
  registration: {
    id: 'phase2-depth-registration',
    sourceMasterAssetId: 'phase2-depth-reference',
    canvas: {width: 480, height: 320},
    origin: 'top-left',
  },
  groupId: 'phase2-depth-stack',
  members: [
    {
      assetId: 'phase2-support-rear',
      nodeId: 'phase2-support-rear',
      role: 'support-rear',
      file: 'fixtures/vox-phase2-proof/registered-family/support-rear.png',
      maskAssetId: 'phase2-mask-rear',
    },
    {
      assetId: 'phase2-subject',
      nodeId: 'phase2-subject',
      role: 'subject',
      file: 'fixtures/vox-phase2-proof/registered-family/subject.png',
      maskAssetId: 'phase2-mask-subject',
    },
    {
      assetId: 'phase2-support-front',
      nodeId: 'phase2-support-front',
      role: 'support-front',
      file: 'fixtures/vox-phase2-proof/registered-family/support-front.png',
      maskAssetId: 'phase2-mask-front',
    },
  ],
});

export const PHASE2_REVEAL_ENVELOPE = Object.freeze({
  '16:9': {x: 0.02, y: 0.02, scale: 0.08, rotationDegrees: 1},
  '9:16': {x: 0.015, y: 0.02, scale: 0.08, rotationDegrees: 1},
  '1:1': {x: 0.018, y: 0.018, scale: 0.08, rotationDegrees: 1},
});

const still = () => ({
  keyframes: [{at: 0, scale: 1}, {at: 1, scale: 1}],
});

const transform = (
  x,
  y,
  width,
  height,
  anchorX = 0,
  anchorY = 0,
) => ({x, y, width, height, anchorX, anchorY});

const shape = ({
  id,
  x,
  y,
  width,
  height,
  fill = '#f2c14e',
  shape: shapeKind = 'rectangle',
  z = 2,
}) => ({
  id,
  kind: 'shape',
  shape: shapeKind,
  style: {fill, stroke: '#162b35', strokeWidth: 3, radius: shapeKind === 'ellipse' ? 999 : 12},
  z,
  depth: z === 0 ? -1 : 0.1,
  transform: transform(x, y, width, height),
  motion: still(),
});

const typographyTreatment = ({
  revealMode,
  editPointIds,
  units,
  align = 'left',
}) => ({
  fit: {minFontSize: 28, maxFontSize: 82, maxLines: 3, overflow: 'error'},
  style: {
    color: '#162b35',
    fontWeight: 900,
    lineHeight: 1.02,
    align,
    letterSpacing: -1,
    fontFamily: 'Arial, Helvetica, sans-serif',
  },
  effects: {
    stroke: {color: '#fffaf0', width: 1},
    shadow: {color: 'rgba(22,43,53,.24)', x: 5, y: 7, blur: 0},
    pad: {color: 'rgba(255,250,240,.9)', padding: 18, radius: 12},
  },
  highlights: [
    {text: '42', color: '#d1495b'},
    {text: 'DATA', color: '#00798c'},
    {text: '数据', color: '#00798c'},
  ],
  reveal: {mode: revealMode, editPointIds, ...(units ? {units} : {})},
  emphasis: revealMode === 'word'
    ? [{
        text: '42',
        editPointId: 'ep-s1-emphasis',
        durationFrames: 16,
        scale: 1.2,
        offsetX: 0,
        offsetY: -8,
        color: '#d1495b',
      }]
    : [],
  safeAreaMode: 'inside',
  avoidZoneIds: ['motif-zone'],
});

const typography = ({
  id,
  text,
  revealMode,
  editPointIds,
  units,
  x = 0.08,
  y = 0.07,
  width = 0.58,
  height = 0.22,
  z = 10,
}) => ({
  id,
  kind: 'typography',
  text,
  treatment: typographyTreatment({revealMode, editPointIds, units}),
  z,
  depth: 0.5,
  transform: transform(x, y, width, height),
  motion: {
    keyframes: [{at: 0, offsetY: 0.01}, {at: 1, offsetY: -0.005}],
  },
});

const annotation = ({
  id,
  annotationKind,
  label,
  value,
  sceneIndex,
  enterEditPointId,
}) => ({
  id,
  kind: 'annotation',
  annotationKind,
  anchor: {targetId: `annotation-origin-${sceneIndex}`, anchor: 'center'},
  target: {targetId: `annotation-target-${sceneIndex}`, anchor: 'center'},
  routing: 'orthogonal',
  avoidZoneIds: ['title-zone', 'subtitle-zone', 'motif-zone'],
  label,
  value,
  style: {
    color: '#162b35',
    background: '#fffaf0',
    strokeWidth: 3,
    fontSize: 12,
  },
  lifecycle: {
    enterEditPointId,
    enterFrames: 6,
  },
  z: 50,
  transform: transform(0, 0, 1, 1),
  motion: still(),
});

const dataStyle = {
  ink: '#162b35',
  paper: '#fffaf0',
  accent: '#f2c14e',
  muted: '#80b9ad',
  fontSize: 7,
};

const state = (id, editPointId, reveal, focusIds = []) => ({
  id,
  editPointId,
  reveal,
  focusIds,
});

const dataGraphic = ({
  id,
  graphicKind,
  data,
  geometry,
  states = [state('revealed', 'ep-s2-data-1', 1)],
  x = 0,
  y = 0,
  width = 1,
  height = 1,
  z = 5,
}) => ({
  id,
  kind: 'data-graphic',
  graphicKind,
  data,
  ...(geometry ? {geometry} : {}),
  scale: {domain: [0, 100]},
  format: {unit: '%', decimals: 0},
  states,
  style: dataStyle,
  z,
  transform: transform(x, y, width, height),
  motion: still(),
});

const sharedValues = [
  {id: 'alpha', label: 'A', value: 24},
  {id: 'beta', label: 'B', value: 58},
  {id: 'gamma', label: 'C', value: 86},
];

const dataPanels = () => [
  {
    id: 'bar',
    node: dataGraphic({
      id: 'data-bar',
      graphicKind: 'bar-chart',
      data: {values: sharedValues},
    }),
  },
  {
    id: 'column',
    node: dataGraphic({
      id: 'data-column',
      graphicKind: 'column-chart',
      data: {values: sharedValues},
    }),
  },
  {
    id: 'line',
    node: dataGraphic({
      id: 'data-line',
      graphicKind: 'line-chart',
      data: {points: sharedValues},
    }),
  },
  {
    id: 'table',
    node: dataGraphic({
      id: 'data-table',
      graphicKind: 'comparison-table',
      data: {
        columns: ['2025', '2026'],
        rows: [
          {id: 'north', label: '北', values: [42, 68]},
          {id: 'south', label: '南', values: [37, 74]},
          {id: 'west', label: '西', values: [29, 55]},
        ],
      },
    }),
  },
  {
    id: 'timeline',
    node: dataGraphic({
      id: 'data-timeline',
      graphicKind: 'timeline',
      data: {values: [
        {id: 'draft', label: '草图', value: 12},
        {id: 'edit', label: '编辑', value: 52},
        {id: 'proof', label: '证明', value: 92},
      ]},
    }),
  },
  {
    id: 'map',
    node: dataGraphic({
      id: 'data-map',
      graphicKind: 'map',
      data: {regions: [
        {regionId: 'north', value: 80},
        {regionId: 'south', value: 45},
        {regionId: 'west', value: 62},
      ]},
      geometry: [
        {regionId: 'north', path: 'M12 12 H54 V44 H12 Z'},
        {regionId: 'south', path: 'M48 48 H90 V88 H48 Z'},
        {regionId: 'west', path: 'M10 50 H42 V90 H10 Z'},
      ],
    }),
  },
  {
    id: 'flow',
    node: dataGraphic({
      id: 'data-flow',
      graphicKind: 'flow',
      data: {
        nodes: [
          {id: 'cue', label: 'Cue', x: 18, y: 50},
          {id: 'plan', label: 'Plan', x: 50, y: 30},
          {id: 'frame', label: 'Frame', x: 82, y: 50},
        ],
        edges: [
          {from: 'cue', to: 'plan'},
          {from: 'plan', to: 'frame'},
        ],
      },
    }),
  },
];

const dataSwitch = () => ({
  id: 'data-switch',
  kind: 'editorial-switch',
  panels: dataPanels(),
  changes: [
    {id: 'switch-column', editPointId: 'ep-s2-data-1', fromPanelId: 'bar', toPanelId: 'column', treatment: 'card-switch', durationFrames: 8},
    {id: 'switch-line', editPointId: 'ep-s2-data-2', fromPanelId: 'column', toPanelId: 'line', treatment: 'card-switch', durationFrames: 8},
    {id: 'switch-table', editPointId: 'ep-s2-data-3', fromPanelId: 'line', toPanelId: 'table', treatment: 'panel-replace', durationFrames: 8},
    {id: 'switch-timeline', editPointId: 'ep-s2-data-4', fromPanelId: 'table', toPanelId: 'timeline', treatment: 'panel-replace', durationFrames: 8},
    {id: 'switch-map', editPointId: 'ep-s2-data-5', fromPanelId: 'timeline', toPanelId: 'map', treatment: 'data-state', durationFrames: 8},
    {id: 'switch-flow', editPointId: 'ep-s2-data-6', fromPanelId: 'map', toPanelId: 'flow', treatment: 'data-state', durationFrames: 8},
  ],
  z: 8,
  transform: transform(0.49, 0.28, 0.43, 0.48),
  motion: still(),
});

const boundaryData = (id) => dataGraphic({
  id,
  graphicKind: 'bar-chart',
  data: {values: sharedValues},
  states: [state('match', id.includes('source') ? 'ep-s1-manual' : 'ep-s2-open', 1)],
  x: 0.79,
  y: 0.3,
  width: 0.14,
  height: 0.18,
  z: 7,
});

const registeredFamilyGroup = () => ({
  id: PHASE2_REGISTERED_FAMILY.groupId,
  kind: 'group',
  pattern: 'registered-depth-stack',
  z: 18,
  coordinateSpace: PHASE2_REGISTERED_FAMILY.registration.canvas,
  transform: transform(0.08, 0.32, 0.28, 0.34),
  motion: {
    keyframes: [
      {at: 0, offsetX: 0, offsetY: 0, rotation: -0.4},
      {at: 0.55, offsetX: 0.008, offsetY: -0.006, rotation: 0.5},
      {at: 1, offsetX: 0, offsetY: 0, rotation: -0.2},
    ],
  },
  registration: PHASE2_REGISTERED_FAMILY.registration,
  layerStack: {
    sourcePackageId: 'phase2-layer-package',
    sourceStrategy: 'registered-layer-sheet',
    motionCapability: 'bounded-relative',
    revealEnvelope: PHASE2_REVEAL_ENVELOPE,
  },
  children: PHASE2_REGISTERED_FAMILY.members.map((member, index) => ({
    id: member.nodeId,
    kind: 'asset',
    assetRole:
      member.role === 'subject'
        ? 'character'
        : member.role === 'support-rear'
          ? 'environment'
          : 'prop',
    src: member.file,
    z: index,
    depth: [-0.7, 0, 0.7][index],
    slot: member.role,
    registrationId: PHASE2_REGISTERED_FAMILY.registration.id,
    transform: transform(0, 0, 1, 1),
    motion: {
      keyframes: [
        {at: 0, offsetX: [-0.005, 0.003, 0.008][index]},
        {at: 1, offsetX: [0.005, -0.003, -0.008][index]},
      ],
    },
  })),
});

const proofTimesFor = (sceneIndex) => [
  {
    id: `s${sceneIndex}-establish`,
    at: 0.08,
    label: 'Editorial layout established',
    kind: 'establish',
    assertions: ['Responsive title and anchor field are readable.'],
    stateAssertions: [],
  },
  {
    id: `s${sceneIndex}-action`,
    at: 0.52,
    label: 'Editorial state change visible',
    kind: 'action',
    assertions: ['Edit-point-driven primitives expose a deterministic state.'],
    stateAssertions: [],
  },
  {
    id: `s${sceneIndex}-final`,
    at: 0.9,
    label: 'Outgoing state locked',
    kind: 'final',
    assertions: ['The final frame is readable before the boundary.'],
    stateAssertions: [],
  },
];

const sceneComposition = (sceneIndex) => {
  const first = sceneIndex === 1;
  const nodes = [
    shape({
      id: `paper-field-${sceneIndex}`,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      fill: first ? '#e9d8a6' : '#dce8d2',
      z: 0,
    }),
    typography({
      id: `title-${sceneIndex}`,
      text: first ? '数据 DATA 42 帧精准编辑' : '从音频\n到 SVG 证明',
      revealMode: first ? 'word' : 'line',
      editPointIds: first
        ? ['ep-s1-word-1', 'ep-s1-word-2', 'ep-s1-emphasis', 'ep-s1-sentence', 'ep-s1-manual']
        : ['ep-s2-line-1', 'ep-s2-line-2'],
      units: first
        ? [
            {id: 'word-data-cn', text: '数据 '},
            {id: 'word-data-en', text: 'DATA '},
            {id: 'word-42', text: '42 '},
            {id: 'word-frame', text: '帧精准'},
            {id: 'word-edit', text: '编辑'},
          ]
        : undefined,
    }),
    shape({
      id: `annotation-origin-${sceneIndex}`,
      x: 0.16,
      y: 0.58,
      width: 0.045,
      height: 0.06,
      fill: '#d1495b',
      shape: 'ellipse',
      z: 12,
    }),
    shape({
      id: `annotation-target-${sceneIndex}`,
      x: 0.38,
      y: 0.58,
      width: 0.045,
      height: 0.06,
      fill: '#00798c',
      shape: 'ellipse',
      z: 12,
    }),
    shape({
      id: `match-${first ? 'source' : 'destination'}`,
      x: 0.7,
      y: 0.72,
      width: 0.09,
      height: 0.12,
      fill: '#d1495b',
      shape: 'ellipse',
      z: 12,
    }),
    boundaryData(`boundary-data-${first ? 'source' : 'destination'}`),
  ];
  if (first) {
    nodes.push(
      registeredFamilyGroup(),
      annotation({id: 'annotation-arrow', annotationKind: 'arrow', label: 'arrow', value: 0, sceneIndex, enterEditPointId: 'ep-s1-open'}),
      annotation({id: 'annotation-leader', annotationKind: 'leader-line', label: 'leader', value: 0, sceneIndex, enterEditPointId: 'ep-s1-word-1'}),
      annotation({id: 'annotation-label', annotationKind: 'label', label: 'LABEL', value: 0, sceneIndex, enterEditPointId: 'ep-s1-word-2'}),
      annotation({id: 'annotation-badge', annotationKind: 'badge', label: 'BADGE', value: 0, sceneIndex, enterEditPointId: 'ep-s1-sentence'}),
      annotation({id: 'annotation-card', annotationKind: 'explainer-card', label: 'WHY', value: 0, sceneIndex, enterEditPointId: 'ep-s1-manual'}),
    );
  } else {
    nodes.push(
      dataSwitch(),
      annotation({id: 'annotation-callout', annotationKind: 'callout', label: 'CALLOUT', value: 0, sceneIndex, enterEditPointId: 'ep-s2-open'}),
      annotation({id: 'annotation-bracket', annotationKind: 'bracket', label: 'RANGE', value: 0, sceneIndex, enterEditPointId: 'ep-s2-data-1'}),
      annotation({id: 'annotation-number', annotationKind: 'numeric-counter', label: '', value: 4200, sceneIndex, enterEditPointId: 'ep-s2-data-2'}),
      annotation({id: 'annotation-percent', annotationKind: 'percentage-counter', label: '', value: 86, sceneIndex, enterEditPointId: 'ep-s2-data-3'}),
    );
  }
  return {
    coordinateSpace: {width: 1920, height: 1080},
    nodes,
  };
};

const storyboardBeat = ({
  sceneIndex,
  id,
  at,
  performanceRole,
  purpose,
  proofTimeId,
  targetId,
}) => ({
  id,
  at,
  performanceRole,
  purpose,
  visual: `Deterministic editorial state ${id}.`,
  soundCue: null,
  proofTimeId,
  treatments: [{
    id: `${id}-treatment`,
    targetId,
    importance: 'hero',
    necessity: 'required',
    changeClass: 'static-hold',
    motion: {kind: 'static'},
    composition: {pattern: 'free'},
    graphic: null,
    semanticRisk: sceneIndex === 2 ? 'diagram' : 'decorative',
    proofTimeId,
    rationale: 'The proof gallery holds a compiled first-class editorial primitive at this beat.',
  }],
});

const storyboardScene = (sceneIndex) => {
  const id = `phase2-scene-${sceneIndex}`;
  const beats = [
    storyboardBeat({sceneIndex, id: `s${sceneIndex}-open-beat`, at: 0.08, performanceRole: 'establish', purpose: 'establish', proofTimeId: `s${sceneIndex}-establish`, targetId: `title-${sceneIndex}`}),
    storyboardBeat({sceneIndex, id: `s${sceneIndex}-action-beat`, at: 0.52, performanceRole: 'action', purpose: 'explain', proofTimeId: `s${sceneIndex}-action`, targetId: sceneIndex === 1 ? 'annotation-card' : 'data-switch'}),
    storyboardBeat({sceneIndex, id: `s${sceneIndex}-final-beat`, at: 0.9, performanceRole: 'settle', purpose: 'resolve', proofTimeId: `s${sceneIndex}-final`, targetId: `match-${sceneIndex === 1 ? 'source' : 'destination'}`}),
  ];
  if (sceneIndex === 1) {
    beats[1].treatments.push({
      id: 'phase2-layer-stack-treatment',
      targetId: PHASE2_REGISTERED_FAMILY.groupId,
      importance: 'hero',
      necessity: 'required',
      changeClass: 'depth-layer-separation',
      motion: {kind: 'continuous-transform', preset: 'drift'},
      composition: {
        pattern: 'registered-depth-stack',
        motionCapability: 'bounded-relative',
        sourcePackageId: 'phase2-layer-package',
        sourceStrategy: 'registered-layer-sheet',
        layers: PHASE2_REGISTERED_FAMILY.members.map((member, index) => ({
          id: member.nodeId,
          role: member.role,
          completeness: {
            'support-rear': 'clean-plate',
            subject: 'full-silhouette',
            'support-front': 'full-overlay',
          }[member.role],
          depth: [-0.7, 0, 0.7][index],
        })),
        revealEnvelope: PHASE2_REVEAL_ENVELOPE,
      },
      graphic: null,
      semanticRisk: 'topology',
      proofTimeId: `s${sceneIndex}-action`,
      rationale: 'The deterministic proof family exposes complete rear, subject, and front planes under bounded relative depth motion.',
    });
  }
  return {
    id,
    title: sceneIndex === 1 ? 'Audio becomes edit points' : 'Edit points direct graphics',
    narrativeRole: sceneIndex === 1 ? 'setup' : 'resolution',
    message: sceneIndex === 1
      ? 'Actual local audio timestamps deterministically drive words, emphasis, and a hard boundary.'
      : 'The same contract directs annotations, data graphics, and responsive states.',
    blueprint: sceneIndex === 1 ? 'layered-reveal' : 'chapter-tableau',
    estimatedDurationSeconds: 3,
    beats,
    proofTimes: proofTimesFor(sceneIndex),
  };
};

const exclusionZones = {
  '16:9': [
    {id: 'title-zone', role: 'title', x: 0.05, y: 0.03, width: 0.62, height: 0.23, padding: 0.01},
    {id: 'subtitle-zone', role: 'subtitle', x: 0.08, y: 0.88, width: 0.84, height: 0.08, padding: 0.01},
    {id: 'motif-zone', role: 'motif-field', x: 0.01, y: 0.35, width: 0.08, height: 0.36, padding: 0.01},
  ],
  '9:16': [
    {id: 'title-zone', role: 'title', x: 0.06, y: 0.03, width: 0.88, height: 0.2, padding: 0.01},
    {id: 'subtitle-zone', role: 'subtitle', x: 0.08, y: 0.9, width: 0.84, height: 0.06, padding: 0.01},
    {id: 'motif-zone', role: 'motif-field', x: 0.01, y: 0.34, width: 0.07, height: 0.42, padding: 0.01},
  ],
  '1:1': [
    {id: 'title-zone', role: 'title', x: 0.05, y: 0.03, width: 0.9, height: 0.23, padding: 0.01},
    {id: 'subtitle-zone', role: 'subtitle', x: 0.08, y: 0.88, width: 0.84, height: 0.08, padding: 0.01},
    {id: 'motif-zone', role: 'motif-field', x: 0.01, y: 0.35, width: 0.07, height: 0.38, padding: 0.01},
  ],
};

export const PHASE2_PROOF_PROFILES = [
  {
    id: '16:9',
    width: 960,
    height: 540,
    safeArea: {x: 0.05, y: 0.04, width: 0.9, height: 0.92},
    densityBudget: 18,
    typographyScale: 1,
    parallaxScale: 1,
    exclusionZones: exclusionZones['16:9'],
  },
  {
    id: '9:16',
    width: 540,
    height: 960,
    safeArea: {x: 0.06, y: 0.04, width: 0.88, height: 0.92},
    densityBudget: 18,
    typographyScale: 0.88,
    parallaxScale: 0.72,
    exclusionZones: exclusionZones['9:16'],
  },
  {
    id: '1:1',
    width: 720,
    height: 720,
    safeArea: {x: 0.05, y: 0.04, width: 0.9, height: 0.92},
    densityBudget: 18,
    typographyScale: 0.94,
    parallaxScale: 0.84,
    exclusionZones: exclusionZones['1:1'],
  },
];

const profileOverrides = (kind, sceneIndex) => {
  const first = sceneIndex === 1;
  const presets = {
    title: {
      '16:9': {x: 0.08, y: 0.07, width: 0.56, height: 0.2},
      '9:16': {x: 0.1, y: 0.07, width: 0.8, height: 0.16},
      '1:1': {x: 0.08, y: 0.07, width: 0.84, height: 0.2},
    },
    data: {
      '16:9': {x: 0.49, y: 0.3, width: 0.43, height: 0.48},
      '9:16': {x: 0.12, y: 0.34, width: 0.76, height: 0.38},
      '1:1': {x: 0.2, y: 0.32, width: 0.6, height: 0.46},
    },
    origin: {
      '16:9': {x: 0.16, y: 0.58, width: 0.045, height: 0.06},
      '9:16': {x: 0.15, y: 0.8, width: 0.06, height: 0.035},
      '1:1': {x: 0.14, y: 0.8, width: 0.05, height: 0.05},
    },
    target: {
      '16:9': {x: 0.38, y: 0.58, width: 0.045, height: 0.06},
      '9:16': {x: 0.38, y: 0.8, width: 0.06, height: 0.035},
      '1:1': {x: 0.38, y: 0.8, width: 0.05, height: 0.05},
    },
    match: {
      '16:9': {x: 0.7, y: 0.72, width: 0.09, height: 0.12},
      '9:16': {x: 0.7, y: 0.78, width: 0.09, height: 0.06},
      '1:1': {x: 0.7, y: 0.78, width: 0.09, height: 0.09},
    },
    boundaryData: {
      '16:9': {x: 0.79, y: 0.3, width: 0.14, height: 0.18},
      '9:16': {x: 0.72, y: 0.25, width: 0.18, height: 0.12},
      '1:1': {x: 0.74, y: 0.27, width: 0.16, height: 0.16},
    },
    family: {
      '16:9': {x: 0.08, y: 0.32, width: 0.28, height: 0.34},
      '9:16': {x: 0.12, y: 0.3, width: 0.55, height: 0.22},
      '1:1': {x: 0.1, y: 0.34, width: 0.44, height: 0.3},
    },
  };
  if (kind === 'data' && first) return presets.boundaryData;
  return presets[kind];
};

const placementsForScene = (sceneIndex) => {
  const first = sceneIndex === 1;
  const entries = [
    {targetId: `title-${sceneIndex}`, role: 'title', preferredAnchor: 'top-left', densityCost: 3, profileOverrides: profileOverrides('title', sceneIndex)},
    {targetId: `annotation-origin-${sceneIndex}`, role: 'annotation', preferredAnchor: 'left', densityCost: 1, profileOverrides: profileOverrides('origin', sceneIndex)},
    {targetId: `annotation-target-${sceneIndex}`, role: 'annotation', preferredAnchor: 'center', densityCost: 1, profileOverrides: profileOverrides('target', sceneIndex)},
    {targetId: `match-${first ? 'source' : 'destination'}`, role: 'subject', preferredAnchor: 'bottom-right', densityCost: 2, profileOverrides: profileOverrides('match', sceneIndex)},
    {targetId: `boundary-data-${first ? 'source' : 'destination'}`, role: 'data', preferredAnchor: 'right', densityCost: 3, profileOverrides: profileOverrides('boundaryData', sceneIndex)},
  ];
  if (first) {
    entries.push({
      targetId: PHASE2_REGISTERED_FAMILY.groupId,
      role: 'subject',
      preferredAnchor: 'left',
      densityCost: 4,
      profileOverrides: profileOverrides('family', sceneIndex),
    });
  }
  if (!first) {
    entries.push({
      targetId: 'data-switch',
      role: 'data',
      preferredAnchor: 'center',
      densityCost: 6,
      profileOverrides: profileOverrides('data', sceneIndex),
    });
  }
  return entries;
};

const cue = ({
  id,
  kind,
  source,
  mediaId,
  sceneId,
  atSeconds,
  priority,
  toleranceSeconds = 0.04,
  text,
}) => ({
  id,
  kind,
  source,
  timingBasis: kind === 'manual' ? 'manual' : 'actual-audio',
  mediaId,
  sceneId,
  atSeconds,
  ...(text ? {text} : {}),
  priority,
  toleranceSeconds,
});

const editPoint = (id, cueIds, conflictPolicy = 'highest-priority', extra = {}) => ({
  id,
  cueIds,
  conflictPolicy,
  ...extra,
});

const binding = (id, sceneId, targetType, targetId, editPointId, mode, offsetSeconds) => ({
  id,
  sceneId,
  targetType,
  targetId,
  editPointId,
  ...(mode ? {mode} : {}),
  ...(offsetSeconds !== undefined ? {offsetSeconds} : {}),
});

const transition = ({
  id,
  type,
  sceneId,
  destinationSceneId,
  editPointId,
  sourceTargetId,
  destinationTargetId,
  matchDimensions,
  treatment,
}) => ({
  id,
  scope: destinationSceneId ? 'scene-boundary' : 'within-shot',
  type,
  sceneId,
  ...(destinationSceneId ? {destinationSceneId} : {}),
  editPointId,
  semanticIntent: `${type} preserves declared ${matchDimensions.join('/')} continuity at an actual-audio edit point.`,
  sourceAnchor: {
    targetId: sourceTargetId,
    anchor: 'center',
    ...(!destinationSceneId ? {point: {x: 0.5, y: 0.5}} : {}),
  },
  destinationAnchor: {
    targetId: destinationTargetId,
    anchor: 'center',
    ...(!destinationSceneId ? {point: {x: 0.5, y: 0.5}} : {}),
  },
  sourceDescriptor: descriptorForTarget(sourceTargetId),
  destinationDescriptor: descriptorForTarget(destinationTargetId),
  matchDimensions,
  continuityTolerance: 0.001,
  invalidPolicy: 'reject',
  treatment,
});

const descriptorForTarget = (targetId) => {
  if (targetId.startsWith('match-')) {
    return {
      shape: 'ellipse',
      color: '#d1495b',
    };
  }
  if (targetId.startsWith('boundary-data-')) {
    return {
      shape: 'bar-chart',
      color: '#f2c14e',
      value: stableEditorialHash({values: sharedValues}),
    };
  }
  const kinds = {
    'data-bar': 'bar-chart',
    'data-column': 'column-chart',
    'data-line': 'line-chart',
    'data-table': 'comparison-table',
    'data-timeline': 'timeline',
    'data-map': 'map',
  };
  return {
    shape: kinds[targetId] ?? 'flow',
    color: '#f2c14e',
    width: 1,
    height: 1,
  };
};

export const createPhase2EditorialAuthoring = ({media}) => {
  const cues = [
    cue({id: 'cue-s1-open', kind: 'narration-phrase', source: 'authored', mediaId: 'narration-1', sceneId: 'phase2-scene-1', atSeconds: 0.15, priority: 40, text: '数据'}),
    cue({id: 'cue-s1-word-1', kind: 'narration-word', source: 'detected', mediaId: 'narration-1', sceneId: 'phase2-scene-1', atSeconds: 0.45, priority: 65, text: '数据'}),
    cue({id: 'cue-s1-word-2', kind: 'narration-word', source: 'detected', mediaId: 'narration-1', sceneId: 'phase2-scene-1', atSeconds: 0.9, priority: 65, text: 'DATA'}),
    cue({id: 'cue-s1-word-3', kind: 'narration-word', source: 'detected', mediaId: 'narration-1', sceneId: 'phase2-scene-1', atSeconds: 1.35, priority: 65, text: '42'}),
    cue({id: 'cue-s1-emphasis', kind: 'semantic-emphasis', source: 'authored', mediaId: 'narration-1', sceneId: 'phase2-scene-1', atSeconds: 1.35, priority: 90, text: '42'}),
    cue({id: 'cue-s1-sentence', kind: 'sentence', source: 'detected', mediaId: 'narration-1', sceneId: 'phase2-scene-1', atSeconds: 1.75, priority: 70}),
    cue({id: 'cue-s1-manual', kind: 'manual', source: 'authored', mediaId: 'narration-1', sceneId: 'phase2-scene-1', atSeconds: 2.25, priority: 35}),
    cue({id: 'cue-sfx-onset', kind: 'sfx-onset', source: 'detected', mediaId: 'sfx', sceneId: 'phase2-scene-1', atSeconds: 0.6, priority: 75}),
    cue({id: 'cue-sfx-peak', kind: 'sfx-peak', source: 'detected', mediaId: 'sfx', sceneId: 'phase2-scene-1', atSeconds: 0.72, priority: 80}),
    cue({id: 'cue-sfx-tail', kind: 'sfx-tail', source: 'detected', mediaId: 'sfx', sceneId: 'phase2-scene-1', atSeconds: 1.05, priority: 55}),
    cue({id: 'cue-conflict-primary', kind: 'narration-phrase', source: 'authored', mediaId: 'narration-1', sceneId: 'phase2-scene-1', atSeconds: 0.6, priority: 80, text: 'conflict'}),
    cue({id: 'cue-music-beat-conflict', kind: 'music-beat', source: 'detected', mediaId: 'music', sceneId: 'phase2-scene-1', atSeconds: 0.6, priority: 50, toleranceSeconds: 0.08}),
    cue({id: 'cue-music-bar', kind: 'music-bar', source: 'detected', mediaId: 'music', sceneId: 'phase2-scene-1', atSeconds: 1.2, priority: 60}),
    cue({id: 'cue-boundary-accent', kind: 'music-accent', source: 'detected', mediaId: 'music', sceneId: 'phase2-scene-1', atSeconds: 3, priority: 100}),
    cue({id: 'cue-s2-open', kind: 'narration-phrase', source: 'authored', mediaId: 'narration-2', sceneId: 'phase2-scene-2', atSeconds: 0.15, priority: 45}),
    cue({id: 'cue-s2-line-1', kind: 'sentence', source: 'detected', mediaId: 'narration-2', sceneId: 'phase2-scene-2', atSeconds: 0.3, priority: 65}),
    cue({id: 'cue-s2-line-2', kind: 'sentence', source: 'detected', mediaId: 'narration-2', sceneId: 'phase2-scene-2', atSeconds: 0.75, priority: 65}),
    ...[3.45, 3.8, 4.15, 4.5, 4.9, 5.3].map((atSeconds, index) =>
      cue({
        id: `cue-s2-data-${index + 1}`,
        kind: index % 2 === 0 ? 'music-beat' : 'music-accent',
        source: 'detected',
        mediaId: 'music',
        sceneId: 'phase2-scene-2',
        atSeconds,
        priority: 55 + index,
      })
    ),
  ];
  const editPoints = [
    editPoint('ep-s1-open', ['cue-s1-open']),
    editPoint('ep-s1-word-1', ['cue-s1-word-1']),
    editPoint('ep-s1-word-2', ['cue-s1-word-2']),
    editPoint('ep-s1-emphasis', ['cue-s1-word-3', 'cue-s1-emphasis']),
    editPoint('ep-s1-sentence', ['cue-s1-sentence']),
    editPoint('ep-s1-manual', ['cue-s1-manual']),
    editPoint('ep-sfx-onset', ['cue-sfx-onset']),
    editPoint('ep-sfx-peak', ['cue-sfx-peak']),
    editPoint('ep-sfx-tail', ['cue-sfx-tail']),
    editPoint('ep-conflict-primary', ['cue-conflict-primary']),
    editPoint('ep-music-conflict', ['cue-music-beat-conflict'], 'offset-within-window'),
    editPoint('ep-music-bar', ['cue-music-bar']),
    editPoint('ep-boundary', ['cue-boundary-accent']),
    editPoint('ep-s2-open', ['cue-s2-open']),
    editPoint('ep-s2-line-1', ['cue-s2-line-1']),
    editPoint('ep-s2-line-2', ['cue-s2-line-2']),
    ...Array.from({length: 6}, (_, index) =>
      editPoint(`ep-s2-data-${index + 1}`, [`cue-s2-data-${index + 1}`])
    ),
  ];
  const boundaryTransitions = [
    transition({id: 'transition-match-cut', type: 'match-cut', sceneId: 'phase2-scene-1', destinationSceneId: 'phase2-scene-2', editPointId: 'ep-boundary', sourceTargetId: 'match-source', destinationTargetId: 'match-destination', matchDimensions: ['position', 'scale'], treatment: 'hard-cut'}),
    transition({id: 'transition-graphic-match', type: 'graphic-match', sceneId: 'phase2-scene-1', destinationSceneId: 'phase2-scene-2', editPointId: 'ep-boundary', sourceTargetId: 'boundary-data-source', destinationTargetId: 'boundary-data-destination', matchDimensions: ['shape', 'position', 'scale', 'value'], treatment: 'hard-cut'}),
    transition({id: 'transition-shape-match', type: 'shape-match', sceneId: 'phase2-scene-1', destinationSceneId: 'phase2-scene-2', editPointId: 'ep-boundary', sourceTargetId: 'match-source', destinationTargetId: 'match-destination', matchDimensions: ['shape'], treatment: 'hard-cut'}),
    transition({id: 'transition-position-scale', type: 'position-scale-match', sceneId: 'phase2-scene-1', destinationSceneId: 'phase2-scene-2', editPointId: 'ep-boundary', sourceTargetId: 'match-source', destinationTargetId: 'match-destination', matchDimensions: ['position', 'scale'], treatment: 'hard-cut'}),
    transition({id: 'transition-color-value', type: 'color-value-match', sceneId: 'phase2-scene-1', destinationSceneId: 'phase2-scene-2', editPointId: 'ep-boundary', sourceTargetId: 'boundary-data-source', destinationTargetId: 'boundary-data-destination', matchDimensions: ['color', 'value'], treatment: 'hard-cut'}),
  ];
  const withinTransitions = [
    transition({id: 'transition-card-switch', type: 'within-shot-card-switch', sceneId: 'phase2-scene-2', editPointId: 'ep-s2-data-1', sourceTargetId: 'data-bar', destinationTargetId: 'data-column', matchDimensions: ['position', 'scale'], treatment: 'card-switch'}),
    transition({id: 'transition-panel-replace', type: 'panel-replace', sceneId: 'phase2-scene-2', editPointId: 'ep-s2-data-3', sourceTargetId: 'data-line', destinationTargetId: 'data-table', matchDimensions: ['position', 'scale'], treatment: 'panel-replace'}),
    transition({id: 'transition-data-state', type: 'data-state-transition', sceneId: 'phase2-scene-2', editPointId: 'ep-s2-data-5', sourceTargetId: 'data-timeline', destinationTargetId: 'data-map', matchDimensions: ['position', 'scale'], treatment: 'data-state'}),
  ];
  const transitions = [...boundaryTransitions, ...withinTransitions];
  const bindings = [
    binding('binding-s1-word', 'phase2-scene-1', 'typography-reveal', 'title-1', 'ep-s1-word-1', 'word'),
    binding('binding-s1-emphasis', 'phase2-scene-1', 'typography-emphasis', 'title-1', 'ep-s1-emphasis', 'element'),
    binding('binding-s1-graphic', 'phase2-scene-1', 'graphic-action', 'boundary-data-source', 'ep-music-bar', 'state'),
    binding('binding-s1-annotation', 'phase2-scene-1', 'annotation-lifecycle', 'annotation-card', 'ep-s1-manual', 'element'),
    binding('binding-boundary', 'phase2-scene-1', 'scene-boundary', 'phase2-boundary', 'ep-boundary', 'boundary'),
    binding('binding-s2-line', 'phase2-scene-2', 'typography-reveal', 'title-2', 'ep-s2-line-1', 'line'),
    ...Array.from({length: 6}, (_, index) =>
      binding(`binding-data-${index + 1}`, 'phase2-scene-2', 'data-state', 'data-switch', `ep-s2-data-${index + 1}`, 'state')
    ),
    ...transitions.map((item) =>
      binding(`binding-${item.id}`, item.sceneId, 'editorial-transition', item.id, item.editPointId, item.scope === 'scene-boundary' ? 'boundary' : 'state')
    ),
  ];
  return {
    timebase: {fps: PHASE2_PROOF_FPS, rounding: 'nearest'},
    wordTimingPolicy: 'require',
    media,
    cues,
    editPoints,
    bindings,
    responsiveProfiles: PHASE2_PROOF_PROFILES,
    sceneDirecting: [1, 2].map((sceneIndex) => ({
      sceneId: `phase2-scene-${sceneIndex}`,
      compositionProfile: 'editorial-proof-gallery',
      typographyProfile: 'mixed-script-editorial',
      subjectFraming: {mode: sceneIndex === 1 ? 'contain' : 'data-focus', focusPoint: {x: 0.56, y: 0.5}},
      parallaxScale: {'16:9': 1, '9:16': 0.72, '1:1': 0.84},
      cropFocus: {'16:9': {x: 0.56, y: 0.5}, '9:16': {x: 0.5, y: 0.48}, '1:1': {x: 0.52, y: 0.5}},
      placements: placementsForScene(sceneIndex),
    })),
    transitions,
  };
};

export const createPhase2StoryboardAuthoring = ({media}) => ({
  $schema: '../../schemas/storyboard-authoring.schema.json',
  schemaVersion: 12,
  slug: PHASE2_PROOF_SLUG,
  status: 'ready',
  arc: 'Actual local audio becomes deterministic edit points, which direct reusable typography, annotation, data, responsive, and transition primitives.',
  style: {
    visualThesis: 'A restrained editorial paper system makes timing and semantic anchors visibly inspectable.',
    compositionRules: [
      'Keep text, data, annotation routes, and match anchors inside each compiled responsive plan.',
      'Use SVG and component primitives rather than baked editorial overlays.',
    ],
    layerStrategy: 'Paper field, editorial typography, semantic targets, SVG data layer, and vector annotation overlay.',
  },
  motionDirection: createMotionDirectionFixture({
    summary:
      'Establish the editorial surface, execute every authored audio-synchronized action, then settle on an inspectable final state.',
  }),
  editorial: createPhase2EditorialAuthoring({media}),
  scenes: [storyboardScene(1), storyboardScene(2)],
  sceneTransitions: [{
    id: 'phase2-boundary',
    fromSceneId: 'phase2-scene-1',
    toSceneId: 'phase2-scene-2',
    intent: 'impact',
    rationale: 'The music accent and matched source/destination anchors create a real hard editorial cut.',
    treatment: {
      type: 'cut',
      motivation: 'impact',
      durationSeconds: 0,
    },
  }],
  updatedAt: PHASE2_PROOF_UPDATED_AT,
});

export const createPhase2Plan = () => ({
  schemaVersion: 4,
  slug: PHASE2_PROOF_SLUG,
  status: 'resolved',
  inputMode: 'both',
  productionProfile: 'full-depth',
  assetBudget: {
    backgrounds: 2,
    environmentLayers: 4,
    characterSheets: 2,
    styleSamples: 1,
    baseImageAttempts: 9,
    layerPackageAttemptReserve: 16,
    maxGeneratedImages: 25,
  },
  motionBudget: {
    maxPoseSheetCalls: 2,
    maxStatesPerSheet: 6,
    maxContinuousTargets: 12,
  },
  approvedImageBudget: {
    imageAttemptLimit: 1,
    expectedProviderImageCalls: 1,
    profileHardCeiling: 25,
    approvedAt: PHASE2_PROOF_UPDATED_AT,
  },
  requested: {durationSeconds: 6, sceneCount: 2},
  resolved: {
    durationSeconds: 6,
    sceneCount: 2,
    estimatedNarrationSeconds: 6,
    rationale: 'Two deterministic local-audio scenes cover the complete Phase 2 proof matrix without provider calls.',
    resolvedAt: PHASE2_PROOF_UPDATED_AT,
  },
  updatedAt: PHASE2_PROOF_UPDATED_AT,
});

export const compilePhase2Storyboard = ({media}) => {
  const plan = createPhase2Plan();
  return compileStoryboardDirecting(createPhase2StoryboardAuthoring({media}), {
    plan,
    styleProfile: FIXTURE_STYLE_PROFILE,
  });
};

const projectScene = ({sceneIndex, media}) => {
  const storyboard = storyboardScene(sceneIndex);
  const narration = media.find(({id}) => id === `narration-${sceneIndex}`);
  const proofTimes = proofTimesFor(sceneIndex);
  return {
    id: storyboard.id,
    label: sceneIndex === 1 ? 'AUDIO → EDIT' : 'EDIT → SVG',
    eyebrow: 'VOX PHASE 2',
    tailSeconds: 0,
    appearance: {
      background: sceneIndex === 1 ? '#e9d8a6' : '#dce8d2',
      surfaceTexture: {visible: true, opacity: 0.08, blendMode: 'multiply'},
      chapter: {visible: false},
      subtitles: {variant: 'hidden'},
    },
    motion: {
      blueprint: storyboard.blueprint,
      intensity: 0.6,
      seed: 200 + sceneIndex,
      proofTimes,
    },
    composition: sceneComposition(sceneIndex),
    camera: {
      preset: 'static',
      intensity: 0.2,
      keyframes: [
        {at: 0, x: 0, y: 0, zoom: 1},
        {at: 1, x: sceneIndex === 1 ? 4 : -4, y: 0, zoom: 1.008},
      ],
      parallax: {enabled: true, strength: 0.3, focalDepth: -1},
    },
    narration: {
      src: narration.src,
      timingSrc: narration.timingDataSrc,
      startSeconds: 0,
      durationSeconds: narration.durationSeconds,
      text: sceneIndex === 1 ? '数据 DATA 四十二帧精准编辑' : '从音频到 SVG 证明',
    },
    subtitles: [],
    events: [
      ...(sceneIndex === 1
        ? [{
            id: 's1-sfx-event',
            beatId: 's1-open-beat',
            at: 0.08,
            targetId: 'title-1',
            visual: null,
            proofTimeId: 's1-establish',
            sound: {src: media.find(({id}) => id === 'sfx').src, volume: 0.12},
          }]
        : []),
      {
        id: `s${sceneIndex}-open-event`,
        beatId: `s${sceneIndex}-open-beat`,
        at: 0.08,
        targetId: 'scene',
        visual: {kind: 'hold', durationSeconds: 0.15},
        proofTimeId: `s${sceneIndex}-establish`,
      },
      {
        id: `s${sceneIndex}-action-event`,
        beatId: `s${sceneIndex}-action-beat`,
        at: 0.52,
        targetId: 'scene',
        visual: {kind: 'hold', durationSeconds: 0.15},
        proofTimeId: `s${sceneIndex}-action`,
      },
      {
        id: `s${sceneIndex}-final-event`,
        beatId: `s${sceneIndex}-final-beat`,
        at: 0.9,
        targetId: 'scene',
        visual: {kind: 'hold', durationSeconds: 0.15},
        proofTimeId: `s${sceneIndex}-final`,
      },
    ],
  };
};

export const createPhase2Project = ({media, profileId}) => {
  const storyboard = compilePhase2Storyboard({media});
  const profile = PHASE2_PROOF_PROFILES.find(({id}) => id === profileId);
  if (!profile) throw new Error(`未知 Phase 2 proof profile：${profileId}`);
  const project = {
    $schema: '../../schemas/project.schema.json',
    schemaVersion: 12,
    slug: PHASE2_PROOF_SLUG,
    title: `VOX Phase 2 Editorial System · ${profileId}`,
    intake: {
      schemaVersion: 2,
      status: 'pending',
      aspectRatio: null,
      visualStylePreset: null,
      parallaxPreference: null,
      styleCatalogVersion: null,
      styleCatalogFingerprint: null,
      styleProfileFingerprint: null,
      confirmedAt: null,
      note: 'Deterministic engineering proof fixture.',
      updatedAt: PHASE2_PROOF_UPDATED_AT,
    },
    styleProfile: null,
    motionContract: storyboard.motionContract,
    plan: createPhase2Plan(),
    quality: {minimumAssetScale: 1},
    video: {width: profile.width, height: profile.height, fps: PHASE2_PROOF_FPS},
    theme: {
      canvas: '#162b35',
      sceneBackground: '#e9d8a6',
      accent: '#f2c14e',
      ink: '#162b35',
      subtitle: '#fffaf0',
      subtitleBackground: 'rgba(22,43,53,.78)',
      foreground: '#162b35',
      fontFamily: 'Arial, Helvetica, sans-serif',
      surface: {
        texture: {
          src: 'textures/paper-grain.png',
          opacity: 0.08,
          blendMode: 'multiply',
        },
        subjectEdge: {
          mode: 'paper-outline',
          color: '#fffaf0',
          widthPx: 3,
        },
        subjectShadow: {
          mode: 'drop-shadow',
          offsetXPx: 0,
          offsetYPx: 10,
          blurPx: 7,
          color: 'rgba(20,15,12,.28)',
        },
      },
    },
    voice: {
      mode: 'fictional',
      provider: 'local-deterministic-fixture',
      displayName: 'Phase 2 synthetic tone',
    },
    audio: {
      narration: {volume: 0.08},
      music: {src: media.find(({id}) => id === 'music').src, volume: 0.04},
      mastering: {targetLufs: -16, toleranceLufs: 3, truePeakDbtp: -1},
    },
    editorial: {...storyboard.editorial, activeProfile: profileId},
    scenes: [
      projectScene({sceneIndex: 1, media}),
      projectScene({sceneIndex: 2, media}),
    ],
    sceneTransitions: storyboard.sceneTransitions,
  };
  return applyResponsiveDirectingPlan(project);
};
