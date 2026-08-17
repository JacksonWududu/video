import {createEditorialFixture} from './editorial-fixture.mjs';
import {compileStoryboardDirecting} from '../scripts/storyboard-lib.mjs';
import {
  createMotionDirectionFixture,
  FIXTURE_STYLE_PROFILE,
} from './motion-contract-fixture.mjs';

export const LOOPING_WORLD_SLUG = 'vox-looping-world-proof';
export const LOOPING_WORLD_SCENE_ID = 'road-journey';
export const LOOPING_WORLD_GROUP_ID = 'road-world';
export const LOOPING_WORLD_FPS = 30;
export const LOOPING_WORLD_DURATION_SECONDS = 12;
export const LOOPING_WORLD_UPDATED_AT = '2026-07-24T00:00:00.000Z';

export const LOOPING_WORLD_PROFILES = Object.freeze([
  {
    id: '16:9',
    width: 960,
    height: 540,
    safeArea: {x: 0.05, y: 0.05, width: 0.9, height: 0.9},
    densityBudget: 12,
    typographyScale: 1,
    parallaxScale: 1,
    exclusionZones: [],
  },
  {
    id: '9:16',
    width: 540,
    height: 960,
    safeArea: {x: 0.06, y: 0.04, width: 0.88, height: 0.92},
    densityBudget: 10,
    typographyScale: 0.9,
    parallaxScale: 0.75,
    exclusionZones: [],
  },
  {
    id: '1:1',
    width: 720,
    height: 720,
    safeArea: {x: 0.06, y: 0.06, width: 0.88, height: 0.88},
    densityBudget: 11,
    typographyScale: 0.95,
    parallaxScale: 0.86,
    exclusionZones: [],
  },
]);

export const LOOPING_WORLD_STRIPS = Object.freeze([
  {
    id: 'mountain-strip',
    stripId: 'mountains',
    sourceAssetId: 'mountain-source',
    assetId: 'mountain-loop',
    role: 'far',
    surfaceRole: 'backdrop',
    depth: -0.9,
    z: 0,
    sourceWidth: 1920,
    sourceHeight: 720,
    y: 0,
    height: 0.74,
  },
  {
    id: 'tree-strip',
    stripId: 'trees',
    sourceAssetId: 'tree-source',
    assetId: 'tree-loop',
    role: 'mid',
    surfaceRole: 'scenery',
    depth: -0.25,
    z: 2,
    sourceWidth: 2560,
    sourceHeight: 720,
    y: 0.18,
    height: 0.65,
  },
  {
    id: 'road-strip',
    stripId: 'road',
    sourceAssetId: 'road-source',
    assetId: 'road-loop',
    role: 'ground',
    surfaceRole: 'walkable-ground',
    depth: 0.38,
    z: 3,
    sourceWidth: 3840,
    sourceHeight: 720,
    y: 0.58,
    height: 0.42,
  },
  {
    id: 'grass-strip',
    stripId: 'grass',
    sourceAssetId: 'grass-source',
    assetId: 'grass-loop',
    role: 'near',
    surfaceRole: 'foreground-occluder',
    depth: 0.9,
    z: 8,
    sourceWidth: 3840,
    sourceHeight: 720,
    y: 0.42,
    height: 0.6,
  },
]);

const motion = (keyframes = [{at: 0, scale: 1}, {at: 1, scale: 1}]) => ({
  keyframes,
});

const transform = (
  x,
  y,
  width,
  height,
  anchorX = 0,
  anchorY = 0,
) => ({x, y, width, height, anchorX, anchorY});

export const createLoopingWorldPlan = () => ({
  schemaVersion: 4,
  slug: LOOPING_WORLD_SLUG,
  status: 'resolved',
  inputMode: 'both',
  productionProfile: 'full-depth',
  assetBudget: {
    backgrounds: 1,
    environmentLayers: 2,
    characterSheets: 2,
    styleSamples: 1,
    baseImageAttempts: 6,
    layerPackageAttemptReserve: 8,
    maxGeneratedImages: 14,
  },
  motionBudget: {
    maxPoseSheetCalls: 2,
    maxStatesPerSheet: 6,
    maxContinuousTargets: 6,
  },
  approvedImageBudget: {
    imageAttemptLimit: 0,
    expectedProviderImageCalls: 0,
    profileHardCeiling: 14,
    approvedAt: LOOPING_WORLD_UPDATED_AT,
  },
  requested: {
    durationSeconds: LOOPING_WORLD_DURATION_SECONDS,
    sceneCount: 1,
  },
  resolved: {
    durationSeconds: LOOPING_WORLD_DURATION_SECONDS,
    sceneCount: 1,
    estimatedNarrationSeconds: LOOPING_WORLD_DURATION_SECONDS,
    rationale: 'A zero-provider deterministic fixture proves looping world travel, depth-relative speed, seam continuity, foreground occlusion, and camera-compensated subject readability.',
    resolvedAt: LOOPING_WORLD_UPDATED_AT,
  },
  updatedAt: LOOPING_WORLD_UPDATED_AT,
});

const staticTreatment = ({id, targetId, proofTimeId}) => ({
  id,
  targetId,
  importance: 'supporting',
  necessity: 'required',
  changeClass: 'static-hold',
  motion: {kind: 'static'},
  composition: {pattern: 'free'},
  graphic: null,
  semanticRisk: 'decorative',
  proofTimeId,
  rationale: 'The proof frame holds long enough to inspect the authored world state.',
});

const worldTravelTreatment = () => ({
  id: 'road-world-travel',
  targetId: LOOPING_WORLD_GROUP_ID,
  importance: 'hero',
  necessity: 'required',
  changeClass: 'world-travel',
  motion: {kind: 'continuous-transform', preset: 'scroll-world-x'},
  composition: {
    pattern: 'looping-environment',
    world: {
      axis: 'x',
      direction: 'left',
      distanceViewports: 34,
      speedRange: {far: 0.4, near: 1},
      groundStripId: 'road-strip',
      subjectBindings: [{
        nodeId: 'paper-car',
        role: 'tracked',
        anchorMode: 'screen',
        nearOcclusion: 'behind-near',
        proofTimeIds: ['world-before', 'world-seam', 'world-after'],
      }, {
        nodeId: 'finish-marker',
        role: 'participant',
        anchorMode: 'world',
        nearOcclusion: 'behind-near',
        proofTimeIds: ['world-before', 'world-marker-move'],
      }],
      seamProofTimeIds: {
        before: 'world-before',
        seam: 'world-seam',
        after: 'world-after',
      },
      closedLoop: false,
      startPhase: 0.13,
      activeFrom: 0.12,
      strips: LOOPING_WORLD_STRIPS.map(({id, role, surfaceRole, depth}) => ({id, role, surfaceRole, depth})),
    },
  },
  graphic: null,
  semanticRisk: 'decorative',
  proofTimeId: 'world-seam',
  rationale: 'A stationary tracked car remains readable while four seamless paper strips travel at strictly increasing depth-relative speeds.',
});

const createLoopingWorldEditorial = ({media}) => {
  const editorial = createEditorialFixture({
    sceneIds: [LOOPING_WORLD_SCENE_ID],
    fps: LOOPING_WORLD_FPS,
    mediaId: media.id,
    mediaSrc: media.src,
    mediaSha256: media.sha256,
    mediaDurationSeconds: media.durationSeconds,
    timingDataSrc: media.timingDataSrc,
  });
  editorial.responsiveProfiles = structuredClone(LOOPING_WORLD_PROFILES);
  editorial.sceneDirecting = [{
    sceneId: LOOPING_WORLD_SCENE_ID,
    compositionProfile: 'looping-paper-road',
    typographyProfile: 'minimal-road-label',
    subjectFraming: {mode: 'contain', focusPoint: {x: 0.5, y: 0.64}},
    parallaxScale: {'16:9': 1, '9:16': 0.75, '1:1': 0.86},
    cropFocus: {
      '16:9': {x: 0.5, y: 0.58},
      '9:16': {x: 0.5, y: 0.58},
      '1:1': {x: 0.5, y: 0.58},
    },
    placements: [],
  }];
  delete editorial.activeProfile;
  return editorial;
};

export const createLoopingWorldStoryboardAuthoring = ({media}) => ({
  $schema: '../../schemas/storyboard-authoring.schema.json',
  schemaVersion: 12,
  slug: LOOPING_WORLD_SLUG,
  status: 'ready',
  arc: 'A paper car crosses a continuous world whose mountains, trees, road, and foreground grass reveal distinct travel speeds without visible seams.',
  style: {
    visualThesis: 'Oversized horizontal paper environments behave as continuous world geometry instead of viewport-sized backdrops.',
    compositionRules: [
      'Keep the tracked car inside the focal corridor while far, mid, ground, and near strips scroll behind and in front of it.',
      'Use the foreground grass as a real occluder and keep every looping strip wider than its target viewport.',
    ],
    layerStrategy: 'Far mountains, mid trees, ground road, tracked paper car, and near grass share one semantic looping environment stack.',
  },
  motionDirection: createMotionDirectionFixture({
    summary:
      'Establish the layered road, sustain one continuous world-travel action, then settle with the tracked car readable.',
  }),
  editorial: createLoopingWorldEditorial({media}),
  scenes: [{
    id: LOOPING_WORLD_SCENE_ID,
    title: 'A continuous paper road',
    narrativeRole: 'demonstration',
    message: 'The world moves relative to the car, every strip crosses multiple seams, and the near grass genuinely occludes the subject.',
    blueprint: 'map-journey',
    estimatedDurationSeconds: LOOPING_WORLD_DURATION_SECONDS,
    beats: [
      {
        id: 'world-open',
        at: 0.12,
        performanceRole: 'establish',
        purpose: 'establish',
        visual: 'The paper car and four depth planes are readable.',
        soundCue: null,
        proofTimeId: 'world-before',
        treatments: [staticTreatment({
          id: 'world-open-hold',
          targetId: 'paper-car',
          proofTimeId: 'world-before',
        })],
      },
      {
        id: 'world-travel',
        at: 0.5,
        performanceRole: 'action',
        purpose: 'demonstrate',
        visual: 'The continuous paper world crosses a seam at depth-relative speeds.',
        soundCue: null,
        proofTimeId: 'world-seam',
        treatments: [worldTravelTreatment()],
      },
      {
        id: 'world-resolve',
        at: 0.88,
        performanceRole: 'settle',
        purpose: 'resolve',
        visual: 'The car remains readable after multiple wraps and a camera pull-back.',
        soundCue: null,
        proofTimeId: 'world-after',
        treatments: [staticTreatment({
          id: 'world-resolve-hold',
          targetId: 'paper-car',
          proofTimeId: 'world-after',
        })],
      },
    ],
    proofTimes: [
      {
        id: 'world-before',
        at: 0.12,
        label: 'World travel established',
        kind: 'establish',
        assertions: ['All four depth planes and the tracked car are readable.'],
        stateAssertions: [],
      },
      {
        id: 'world-marker-move',
        at: 0.13,
        label: 'World-anchored marker begins to leave',
        kind: 'action',
        assertions: ['The finish marker moves with the ground while the tracked car remains screen anchored.'],
        stateAssertions: [],
      },
      {
        id: 'world-seam',
        at: 0.5,
        label: 'Seam crossing and camera push',
        kind: 'action',
        assertions: ['Every strip remains gap-free while the foreground grass occludes the car locally.'],
        stateAssertions: [],
      },
      {
        id: 'world-after',
        at: 0.88,
        label: 'Multiple wraps resolved',
        kind: 'final',
        assertions: ['The car remains in the focal corridor after the world travels more than one viewport.'],
        stateAssertions: [],
      },
    ],
  }],
  sceneTransitions: [],
  updatedAt: LOOPING_WORLD_UPDATED_AT,
});

export const compileLoopingWorldStoryboard = ({media}) =>
  compileStoryboardDirecting(
    createLoopingWorldStoryboardAuthoring({media}),
    {
      plan: createLoopingWorldPlan(),
      styleProfile: FIXTURE_STYLE_PROFILE,
    },
  );

const createWorldGroup = ({profile, stripAssets, carSrc, finishMarkerSrc}) => ({
  id: LOOPING_WORLD_GROUP_ID,
  kind: 'group',
  pattern: 'looping-environment',
  z: 0,
  coordinateSpace: {width: profile.width, height: profile.height},
  transform: transform(0, 0, 1, 1),
  motion: motion(),
  loopingEnvironment: {
    axis: 'x',
    groundStripId: 'road-strip',
    subjectBindings: [{
      nodeId: 'paper-car',
      role: 'tracked',
      anchorMode: 'screen',
      nearOcclusion: 'behind-near',
      proofTimeIds: ['world-before', 'world-seam', 'world-after'],
    }, {
      nodeId: 'finish-marker',
      role: 'participant',
      anchorMode: 'world',
      nearOcclusion: 'behind-near',
      proofTimeIds: ['world-before', 'world-marker-move'],
    }],
    seamProofTimeIds: {
      before: 'world-before',
      seam: 'world-seam',
      after: 'world-after',
    },
    travel: {
      direction: 'left',
      distanceViewports: 34,
      easing: 'linear',
      closedLoop: false,
      startPhase: 0.13,
      activeFrom: 0.12,
    },
    speedRange: {far: 0.4, near: 1},
    overscanPx: 2,
  },
  children: [
    ...LOOPING_WORLD_STRIPS.map((strip) => ({
      id: strip.id,
      kind: 'world-strip',
      role: strip.role,
      surfaceRole: strip.surfaceRole,
      src: stripAssets[strip.id].src,
      loopingStripBinding: stripAssets[strip.id].binding,
      z: strip.z,
      depth: strip.depth,
      transform: transform(0, strip.y, 1, strip.height),
      motion: motion(),
    })),
    {
      id: 'paper-car',
      kind: 'asset',
      assetRole: 'character',
      src: carSrc,
      z: 5,
      depth: 0.14,
      transform: transform(0.5, 0.77, 0.3, 0.24, 0.5, 1),
      motion: {
        keyframes: [
          {at: 0, offsetX: -0.035, offsetY: 0, scale: 0.94, rotation: -1.5, ease: 'ease-in-out'},
          {at: 0.22, offsetX: 0.012, offsetY: -0.018, scale: 1.04, rotation: 1.2, ease: 'ease-in-out'},
          {at: 0.5, offsetX: 0.04, offsetY: 0.006, scale: 1.08, rotation: -0.8, ease: 'ease-in-out'},
          {at: 0.74, offsetX: -0.014, offsetY: -0.014, scale: 0.98, rotation: 1.4, ease: 'ease-in-out'},
          {at: 1, offsetX: 0.025, offsetY: 0, scale: 1.02, rotation: -0.6, ease: 'ease-in-out'},
        ],
        idle: {preset: 'grind', intensity: 0.45, cycleSeconds: 0.72, phase: 0.2},
        pivot: {x: 0.5, y: 0.82},
      },
    },
    {
      id: 'finish-marker',
      kind: 'asset',
      assetRole: 'prop',
      src: finishMarkerSrc,
      z: 5,
      depth: 0.14,
      transform: transform(0.65, 0.77, 0.11, 0.26, 0.5, 1),
      motion: motion(),
    },
  ],
});

export const createLoopingWorldProject = ({
  media,
  profileId,
  stripAssets,
  carSrc,
  finishMarkerSrc,
}) => {
  const profile = LOOPING_WORLD_PROFILES.find(({id}) => id === profileId);
  if (!profile) throw new Error(`未知 looping world profile：${profileId}`);
  const storyboard = compileLoopingWorldStoryboard({media});
  return {
    $schema: '../../schemas/project.schema.json',
    schemaVersion: 12,
    slug: LOOPING_WORLD_SLUG,
    title: `VOX Phase 2.5 Looping World · ${profileId}`,
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
      updatedAt: LOOPING_WORLD_UPDATED_AT,
    },
    styleProfile: null,
    motionContract: storyboard.motionContract,
    plan: createLoopingWorldPlan(),
    quality: {minimumAssetScale: 1},
    video: {width: profile.width, height: profile.height, fps: LOOPING_WORLD_FPS},
    theme: {
      canvas: '#b9d7d2',
      sceneBackground: '#b9d7d2',
      accent: '#e5a53d',
      ink: '#23333c',
      subtitle: '#fff8ea',
      subtitleBackground: 'rgba(35,51,60,.78)',
      foreground: '#23333c',
      fontFamily: 'Arial, Helvetica, sans-serif',
      surface: {
        texture: {
          src: 'textures/paper-grain.png',
          opacity: 0.08,
          blendMode: 'multiply',
        },
        subjectEdge: {
          mode: 'paper-outline',
          color: '#fff8ea',
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
      displayName: 'Looping world engineering tone',
    },
    audio: {
      narration: {volume: 0.025},
      music: null,
      mastering: {targetLufs: -16, toleranceLufs: 3, truePeakDbtp: -1},
    },
    editorial: {...storyboard.editorial, activeProfile: profileId},
    scenes: [{
      id: LOOPING_WORLD_SCENE_ID,
      label: 'A CONTINUOUS\nPAPER ROAD',
      eyebrow: 'VOX PHASE 2.5',
      tailSeconds: 0,
      appearance: {
        background: '#b9d7d2',
        surfaceTexture: {visible: true, opacity: 0.08, blendMode: 'multiply'},
        chapter: {visible: false},
        subtitles: {variant: 'hidden'},
      },
      motion: {
        blueprint: 'map-journey',
        intensity: 0.9,
        seed: 2507,
        proofTimes: structuredClone(
          storyboard.scenes[0].proofTimes,
        ),
      },
      composition: {
        coordinateSpace: {width: profile.width, height: profile.height},
        nodes: [
          createWorldGroup({profile, stripAssets, carSrc, finishMarkerSrc}),
          {
            id: 'proof-badge',
            kind: 'group',
            pattern: 'free',
            z: 12,
            coordinateSpace: {width: profile.width, height: profile.height},
            transform: transform(0, 0, 1, 1),
            motion: motion(),
            children: [{
              id: 'proof-badge-dot',
              kind: 'shape',
              shape: 'ellipse',
              style: {
                fill: '#f4c35a',
                stroke: '#24343c',
                strokeWidth: 4,
                radius: 999,
              },
              z: 0,
              depth: 0,
              transform: transform(0.055, 0.07, 0.028, 0.05),
              motion: motion(),
            }],
          },
        ],
      },
      camera: {
        preset: 'static',
        intensity: 0.65,
        keyframes: [
          {at: 0, x: -12, y: 3, zoom: 1},
          {at: 0.38, x: 18, y: -7, zoom: 1.08},
          {at: 0.7, x: -8, y: 5, zoom: 0.985},
          {at: 1, x: 10, y: 0, zoom: 1.025},
        ],
        parallax: {enabled: true, strength: 0.72, focalDepth: 0.12},
      },
      narration: {
        src: media.src,
        timingSrc: media.timingDataSrc,
        startSeconds: 0,
        durationSeconds: media.durationSeconds,
        text: '',
      },
      subtitles: [],
      events: [
        {
          id: 'world-open-event',
          beatId: 'world-open',
          at: 0.12,
          targetId: 'scene',
          visual: {kind: 'hold', durationSeconds: 0.2},
          proofTimeId: 'world-before',
        },
        {
          id: 'world-seam-event',
          beatId: 'world-travel',
          at: 0.5,
          targetId: 'scene',
          visual: {kind: 'hold', durationSeconds: 0.2},
          proofTimeId: 'world-seam',
        },
        {
          id: 'world-after-event',
          beatId: 'world-resolve',
          at: 0.88,
          targetId: 'scene',
          visual: {kind: 'hold', durationSeconds: 0.2},
          proofTimeId: 'world-after',
        },
      ],
    }],
    sceneTransitions: [],
  };
};
