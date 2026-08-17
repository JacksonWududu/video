import {createEditorialFixture} from './editorial-fixture.mjs';
import {
  createMotionDirectionFixture,
  FIXTURE_STYLE_PROFILE,
} from './motion-contract-fixture.mjs';
import {compileStoryboardDirecting} from '../scripts/storyboard-lib.mjs';

export const PATH_LOCOMOTION_SLUG = 'path-locomotion-proof';
export const PATH_LOCOMOTION_SCENE_ID = 'pond-route';
export const PATH_LOCOMOTION_NODE_ID = 'tadpole-swimmer';
export const PATH_LOCOMOTION_WORLD_ID = 'pond-world';
export const PATH_LOCOMOTION_CONTRACT_ID = 'tadpole-path-contract';
export const PATH_LOCOMOTION_FPS = 30;
export const PATH_LOCOMOTION_DURATION_SECONDS = 8;
export const PATH_LOCOMOTION_UPDATED_AT = '2026-08-01T00:00:00.000Z';

export const PATH_LOCOMOTION_PROFILES = Object.freeze([
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

export const PATH_LOCOMOTION_PATH = Object.freeze({
  kind: 'cubic-bezier-3d',
  coordinateSpace: 'parent-normalized-depth',
  start: {x: 0, y: -0.4, z: -0.6},
  segments: [
    {
      control1: {x: 0.22, y: -0.4, z: -0.6},
      control2: {x: 0.4, y: -0.22, z: 0.6},
      end: {x: 0.4, y: 0, z: 0.6},
    },
    {
      control1: {x: 0.4, y: 0.22, z: 0.6},
      control2: {x: 0.22, y: 0.4, z: -0.2},
      end: {x: 0, y: 0.4, z: -0.2},
    },
    {
      control1: {x: -0.22, y: 0.4, z: -0.2},
      control2: {x: -0.4, y: 0.22, z: 0.7},
      end: {x: -0.4, y: 0, z: 0.7},
    },
    {
      control1: {x: -0.4, y: -0.22, z: 0.7},
      control2: {x: -0.22, y: -0.4, z: -0.6},
      end: {x: 0, y: -0.4, z: -0.6},
    },
  ],
  progress: [
    {at: 0, distance: 0, ease: 'linear'},
    {at: 0.9, distance: 1, ease: 'linear'},
    {at: 1, distance: 1, ease: 'hold'},
  ],
  orientation: {
    mode: 'path-tangent',
    forwardAngleDegrees: 0,
    smoothingSeconds: 0.06,
    maximumTurnDegreesPerSecond: 150,
  },
  projection: {
    depthDistanceScale: 0.65,
    farScale: 0.62,
    nearScale: 1.42,
    farOpacity: 0.68,
    nearOpacity: 1,
    farBlurPx: 2.4,
    nearBlurPx: 0,
    depthOrderSpan: 40,
  },
});

export const PATH_LOCOMOTION_CAMERA_FOLLOW = Object.freeze({
  targetNodeId: PATH_LOCOMOTION_NODE_ID,
  worldNodeId: PATH_LOCOMOTION_WORLD_ID,
  framing: {x: 0.5, y: 0.54},
  lookAheadSeconds: 0.14,
  smoothingSeconds: 0.2,
  zoom: 1.04,
  worldBounds: {x: -1, y: -1, width: 3, height: 3},
});

const pathContract = () => ({
  id: PATH_LOCOMOTION_CONTRACT_ID,
  kind: 'path-locomotion',
  sceneId: PATH_LOCOMOTION_SCENE_ID,
  nodeId: PATH_LOCOMOTION_NODE_ID,
  worldNodeId: PATH_LOCOMOTION_WORLD_ID,
  fromProofTimeId: 'path-start',
  throughProofTimeId: 'path-end',
  turnProofTimeIds: ['turn-east', 'turn-south', 'turn-west'],
  stateIds: ['tail-left', 'tail-up', 'tail-right', 'tail-down'],
  minimumChangesPerSecond: 3,
  continueThroughWindowEnd: true,
  minimumTravel: 2,
  minimumDepthTravel: 2,
  minimumProjectionScaleDelta: 0.4,
  requiredDepthDirections: ['toward-camera', 'away-camera'],
  minimumDirectionSectors: 8,
  maximumHeadingErrorDegrees: 18,
  maximumTurnDegreesPerSecond: 150,
  requireCameraFollow: true,
});

export const createPathLocomotionPlan = () => ({
  schemaVersion: 4,
  slug: PATH_LOCOMOTION_SLUG,
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
    imageAttemptLimit: 1,
    expectedProviderImageCalls: 1,
    profileHardCeiling: 14,
    approvedAt: PATH_LOCOMOTION_UPDATED_AT,
  },
  requested: {
    durationSeconds: PATH_LOCOMOTION_DURATION_SECONDS,
    sceneCount: 1,
  },
  resolved: {
    durationSeconds: PATH_LOCOMOTION_DURATION_SECONDS,
    sceneCount: 1,
    estimatedNarrationSeconds: PATH_LOCOMOTION_DURATION_SECONDS,
    rationale:
      'A zero-provider fixture proves one continuous two-dimensional Bézier route, tangent orientation, a bound registered gait loop, and coherent camera follow.',
    resolvedAt: PATH_LOCOMOTION_UPDATED_AT,
  },
  updatedAt: PATH_LOCOMOTION_UPDATED_AT,
});

const stateTreatment = ({id, stateId, at, proofTimeId, visualChange}) => ({
  id,
  targetId: PATH_LOCOMOTION_NODE_ID,
  importance: 'hero',
  necessity: 'required',
  changeClass: 'pose-change',
  motion: {
    kind: 'state-sequence',
    poseFamilyId: 'tadpole-swim',
    stateId,
    facing: 'neutral',
    visualChange,
    playback: 'loop',
    transition: 'cut',
    cycles: 16,
  },
  composition: {pattern: 'free'},
  graphic: null,
  semanticRisk: 'identity',
  proofTimeId,
  rationale: `Registered swim state ${stateId} is bound at ${at}.`,
});

const pathTreatment = () => ({
  id: 'tadpole-path-motion',
  targetId: PATH_LOCOMOTION_NODE_ID,
  importance: 'hero',
  necessity: 'required',
  changeClass: 'path-travel',
  motion: {
    kind: 'path-locomotion',
    path: structuredClone(PATH_LOCOMOTION_PATH),
    cameraFollow: structuredClone(PATH_LOCOMOTION_CAMERA_FOLLOW),
  },
  composition: {pattern: 'free'},
  graphic: null,
  semanticRisk: 'identity',
  proofTimeId: 'path-start',
  rationale:
    'One route owns position and tangent heading while a separate registered state sequence owns the swim cycle.',
});

const staticTreatment = () => ({
  id: 'pond-final-hold',
  targetId: PATH_LOCOMOTION_WORLD_ID,
  importance: 'supporting',
  necessity: 'required',
  changeClass: 'static-hold',
  motion: {kind: 'static'},
  composition: {pattern: 'free'},
  graphic: null,
  semanticRisk: 'decorative',
  proofTimeId: 'path-end',
  rationale: 'The final frame holds for route and background inspection.',
});

const createEditorial = ({media}) => {
  const editorial = createEditorialFixture({
    sceneIds: [PATH_LOCOMOTION_SCENE_ID],
    fps: PATH_LOCOMOTION_FPS,
    mediaId: media.id,
    mediaSrc: media.src,
    mediaSha256: media.sha256,
    mediaDurationSeconds: media.durationSeconds,
    timingDataSrc: media.timingDataSrc,
  });
  editorial.responsiveProfiles = structuredClone(PATH_LOCOMOTION_PROFILES);
  editorial.sceneDirecting = [{
    sceneId: PATH_LOCOMOTION_SCENE_ID,
    compositionProfile: 'continuous-pond-map',
    typographyProfile: 'minimal-engineering-proof',
    subjectFraming: {mode: 'contain', focusPoint: {x: 0.5, y: 0.54}},
    parallaxScale: {'16:9': 1, '9:16': 0.75, '1:1': 0.86},
    cropFocus: {
      '16:9': {x: 0.5, y: 0.5},
      '9:16': {x: 0.5, y: 0.5},
      '1:1': {x: 0.5, y: 0.5},
    },
    placements: [],
  }];
  delete editorial.activeProfile;
  return editorial;
};

export const createPathLocomotionStoryboardAuthoring = ({media}) => ({
  $schema: '../../schemas/storyboard-authoring.schema.json',
  schemaVersion: 12,
  slug: PATH_LOCOMOTION_SLUG,
  status: 'ready',
  arc:
    'A registered paper tadpole swims one uninterrupted closed route while its body turns with the curve and the pond remains one coherent world.',
  style: {
    visualThesis:
      'A single oversized paper pond behaves as stable world geometry while the subject follows a true two-dimensional route.',
    compositionRules: [
      'Keep route position, tangent heading, gait state, and camera follow on separate explicit contracts.',
      'Use one registered swim-state family at every heading instead of generating directional duplicates.',
    ],
    layerStrategy:
      'One oversized pond world sits behind one registered tadpole state sequence; camera follow reveals different parts of the same world.',
  },
  motionDirection: createMotionDirectionFixture({
    summary:
      'Establish the pond, complete one continuous curved swim with four readable turns, then settle without breaking the world.',
  }),
  editorial: createEditorial({media}),
  spatialContracts: [pathContract()],
  scenes: [{
    id: PATH_LOCOMOTION_SCENE_ID,
    title: 'One continuous pond route',
    narrativeRole: 'demonstration',
    message:
      'The same tadpole family loops continuously, rotates with the path tangent, and stays framed by a world-bounded camera.',
    blueprint: 'map-journey',
    estimatedDurationSeconds: PATH_LOCOMOTION_DURATION_SECONDS,
    beats: [
      {
        id: 'path-open',
        at: 0,
        performanceRole: 'establish',
        purpose: 'establish',
        visual: 'The tadpole begins at the upper pond and starts swimming east.',
        soundCue: null,
        proofTimeId: 'path-start',
        treatments: [
          stateTreatment({
            id: 'tail-left-state',
            stateId: 'tail-left',
            at: 0,
            proofTimeId: 'path-start',
            visualChange: 'Tail bends left.',
          }),
          pathTreatment(),
        ],
      },
      {
        id: 'turn-east-beat',
        at: 0.25,
        performanceRole: 'action',
        purpose: 'demonstrate',
        visual: 'The tadpole rounds the right side of the pond.',
        soundCue: null,
        proofTimeId: 'turn-east',
        treatments: [stateTreatment({
          id: 'tail-up-state',
          stateId: 'tail-up',
          at: 0.25,
          proofTimeId: 'turn-east',
          visualChange: 'Tail crosses the center upward.',
        })],
      },
      {
        id: 'turn-south-beat',
        at: 0.5,
        performanceRole: 'action',
        purpose: 'demonstrate',
        visual: 'The tadpole rounds the bottom of the pond.',
        soundCue: null,
        proofTimeId: 'turn-south',
        treatments: [stateTreatment({
          id: 'tail-right-state',
          stateId: 'tail-right',
          at: 0.5,
          proofTimeId: 'turn-south',
          visualChange: 'Tail bends right.',
        })],
      },
      {
        id: 'turn-west-beat',
        at: 0.75,
        performanceRole: 'action',
        purpose: 'demonstrate',
        visual: 'The tadpole rounds the left side and returns upward.',
        soundCue: null,
        proofTimeId: 'turn-west',
        treatments: [stateTreatment({
          id: 'tail-down-state',
          stateId: 'tail-down',
          at: 0.75,
          proofTimeId: 'turn-west',
          visualChange: 'Tail crosses the center downward.',
        })],
      },
      {
        id: 'path-settle',
        at: 0.9,
        performanceRole: 'settle',
        purpose: 'resolve',
        visual: 'The completed route settles without a background cut.',
        soundCue: null,
        proofTimeId: 'path-end',
        treatments: [staticTreatment()],
      },
    ],
    proofTimes: [
      {
        id: 'path-start',
        at: 0.01,
        label: 'Route begins',
        kind: 'establish',
        assertions: ['The swimmer, route landmarks, and single pond world are readable.'],
        stateAssertions: [{
          nodeId: PATH_LOCOMOTION_NODE_ID,
          stateId: 'tail-left',
        }],
      },
      {
        id: 'turn-east',
        at: 0.27,
        label: 'East turn',
        kind: 'action',
        assertions: ['The tangent heading turns continuously through the right side.'],
        stateAssertions: [{
          nodeId: PATH_LOCOMOTION_NODE_ID,
          stateId: 'tail-up',
        }],
      },
      {
        id: 'turn-south',
        at: 0.535,
        label: 'South turn',
        kind: 'action',
        assertions: ['The gait loop remains active at the bottom turn.'],
        stateAssertions: [{
          nodeId: PATH_LOCOMOTION_NODE_ID,
          stateId: 'tail-right',
        }],
      },
      {
        id: 'turn-west',
        at: 0.8,
        label: 'West turn',
        kind: 'action',
        assertions: ['The camera reveals the same coherent pond surface at the left turn.'],
        stateAssertions: [{
          nodeId: PATH_LOCOMOTION_NODE_ID,
          stateId: 'tail-down',
        }],
      },
      {
        id: 'path-end',
        at: 0.9,
        label: 'Route completed',
        kind: 'final',
        assertions: ['The route completes with no heading snap or background discontinuity.'],
        stateAssertions: [],
      },
    ],
  }],
  sceneTransitions: [],
  updatedAt: PATH_LOCOMOTION_UPDATED_AT,
});

export const compilePathLocomotionStoryboard = ({media}) =>
  compileStoryboardDirecting(
    createPathLocomotionStoryboardAuthoring({media}),
    {
      plan: createPathLocomotionPlan(),
      styleProfile: FIXTURE_STYLE_PROFILE,
    },
  );

const stillMotion = () => ({
  keyframes: [{at: 0, scale: 1}, {at: 1, scale: 1}],
});

export const createPathLocomotionProject = ({
  media,
  profileId,
  worldSrc,
  stateSources,
  identitySha256,
}) => {
  const profile = PATH_LOCOMOTION_PROFILES.find(({id}) => id === profileId);
  if (!profile) throw new Error(`未知 path locomotion profile：${profileId}`);
  const storyboard = compilePathLocomotionStoryboard({media});
  const stateIds = ['tail-left', 'tail-up', 'tail-right', 'tail-down'];
  return {
    $schema: '../../schemas/project.schema.json',
    schemaVersion: 12,
    slug: PATH_LOCOMOTION_SLUG,
    title: `2D Path Locomotion Proof · ${profileId}`,
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
      note: 'Deterministic zero-provider engineering proof fixture.',
      updatedAt: PATH_LOCOMOTION_UPDATED_AT,
    },
    styleProfile: null,
    motionContract: storyboard.motionContract,
    plan: createPathLocomotionPlan(),
    quality: {minimumAssetScale: 1},
    video: {
      width: profile.width,
      height: profile.height,
      fps: PATH_LOCOMOTION_FPS,
    },
    theme: {
      canvas: '#8fc9c5',
      sceneBackground: '#8fc9c5',
      accent: '#f4c35a',
      ink: '#203c45',
      subtitle: '#fff8ea',
      subtitleBackground: 'rgba(32,60,69,.78)',
      foreground: '#203c45',
      fontFamily: 'Arial, Helvetica, sans-serif',
      surface: {
        texture: {
          src: 'textures/paper-grain.png',
          opacity: 0.06,
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
          offsetYPx: 7,
          blurPx: 5,
          color: 'rgba(12,38,42,.25)',
        },
      },
    },
    voice: {
      mode: 'fictional',
      provider: 'local-deterministic-fixture',
      displayName: 'Path locomotion engineering tone',
    },
    audio: {
      narration: {volume: 0.018},
      music: null,
      mastering: {targetLufs: -16, toleranceLufs: 3, truePeakDbtp: -1},
    },
    editorial: {...storyboard.editorial, activeProfile: profileId},
    spatialContracts: [pathContract()],
    scenes: [{
      id: PATH_LOCOMOTION_SCENE_ID,
      label: '3D PATH\nLOCOMOTION',
      eyebrow: 'ENGINEERING PROOF',
      tailSeconds: 0,
      appearance: {
        background: '#8fc9c5',
        surfaceTexture: {visible: true, opacity: 0.06, blendMode: 'multiply'},
        chapter: {visible: false},
        subtitles: {variant: 'hidden'},
      },
      motion: {
        blueprint: 'map-journey',
        intensity: 0.9,
        seed: 2081,
        proofTimes: structuredClone(storyboard.scenes[0].proofTimes),
      },
      composition: {
        coordinateSpace: {width: profile.width, height: profile.height},
        nodes: [
          {
            id: PATH_LOCOMOTION_WORLD_ID,
            kind: 'asset',
            assetRole: 'background',
            src: worldSrc,
            z: 0,
            transform: {
              x: 0.5,
              y: 0.5,
              width: 3,
              height: 3,
              anchorX: 0.5,
              anchorY: 0.5,
            },
            motion: stillMotion(),
          },
          {
            id: PATH_LOCOMOTION_NODE_ID,
            kind: 'state-sequence',
            assetRole: 'character',
            poseFamilyId: 'tadpole-swim',
            registration: {
              id: 'tadpole-swim-registration',
              sourceMasterAssetId: 'tadpole-swim-sheet',
              canvas: {width: 512, height: 512},
              origin: 'top-left',
            },
            anchorPolicy: {
              requiredAnchorIds: ['body-center'],
              maximumDrift: 0.01,
            },
            states: stateIds.map((id, index) => ({
              id,
              src: stateSources[id],
              at: index / stateIds.length,
              facing: 'neutral',
              anchors: [{id: 'body-center', x: 0.5, y: 0.5}],
              identityReferenceAssetId: 'tadpole-identity',
              identityReferenceSha256: identitySha256,
            })),
            playback: {mode: 'loop', cycles: 16},
            transition: {type: 'cut', durationSeconds: 0},
            z: 4,
            transform: {
              x: 0.5,
              y: 0.5,
              width: 0.22,
              height: 0.22,
              anchorX: 0.5,
              anchorY: 0.5,
              rotation: 0,
            },
            motion: {
              keyframes: [{at: 0, opacity: 1}, {at: 1, opacity: 1}],
              path: structuredClone(PATH_LOCOMOTION_PATH),
            },
          },
        ],
      },
      camera: {
        preset: 'static',
        intensity: 1,
        follow: structuredClone(PATH_LOCOMOTION_CAMERA_FOLLOW),
        parallax: {enabled: false, strength: 0, focalDepth: 0},
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
        ['path-open', 0, 'path-start'],
        ['turn-east-beat', 0.25, 'turn-east'],
        ['turn-south-beat', 0.5, 'turn-south'],
        ['turn-west-beat', 0.75, 'turn-west'],
        ['path-settle', 0.9, 'path-end'],
      ].map(([beatId, at, proofTimeId]) => ({
        id: `${beatId}-event`,
        beatId,
        at,
        targetId: 'scene',
        visual: {kind: 'hold', durationSeconds: 0.5},
        proofTimeId,
      })),
    }],
    sceneTransitions: [],
  };
};
