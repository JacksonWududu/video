import assert from 'node:assert/strict';
import test from 'node:test';
import {validateCompositionStructure} from '../scripts/composition-lib.mjs';
import {
  inspectSpatialContract,
  prepareSceneResolution,
  resolvePreparedNodeAt,
  spatialContractDebugOverlay,
} from '../scripts/spatial-contract-lib.mjs';
import {
  resolveCameraFollowAtFrame,
  resolvePathMotionAtFrame,
  validateCameraFollow,
  validatePathMotion,
} from '../src/pathMotion.mjs';

const path = {
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
    {at: 1, distance: 1, ease: 'linear'},
  ],
  orientation: {
    mode: 'path-tangent',
    forwardAngleDegrees: 0,
    smoothingSeconds: 0.04,
    maximumTurnDegreesPerSecond: 120,
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
};

const still = {
  keyframes: [
    {at: 0, scale: 1},
    {at: 1, scale: 1},
  ],
};

const world = {
  id: 'pond-world',
  kind: 'asset',
  assetRole: 'background',
  src: 'fixtures/path-locomotion/pond-world.png',
  z: 0,
  transform: {
    x: 0.5,
    y: 0.5,
    width: 3,
    height: 3,
    anchorX: 0.5,
    anchorY: 0.5,
  },
  motion: {
    keyframes: [
      {at: 0, offsetX: 0},
      {at: 1, offsetX: 0},
    ],
  },
};

const swimmer = {
  id: 'tadpoles',
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
  states: [
    {
      id: 'tail-left',
      src: 'fixtures/path-locomotion/tail-left.png',
      at: 0,
      facing: 'neutral',
      anchors: [{id: 'body-center', x: 0.5, y: 0.5}],
      identityReferenceAssetId: 'tadpole-master',
      identityReferenceSha256: 'a'.repeat(64),
    },
    {
      id: 'tail-right',
      src: 'fixtures/path-locomotion/tail-right.png',
      at: 0.5,
      facing: 'neutral',
      anchors: [{id: 'body-center', x: 0.5, y: 0.5}],
      identityReferenceAssetId: 'tadpole-master',
      identityReferenceSha256: 'a'.repeat(64),
    },
  ],
  playback: {mode: 'loop', cycles: 16},
  transition: {type: 'cut', durationSeconds: 0},
  z: 2,
  transform: {
    x: 0.5,
    y: 0.5,
    width: 0.12,
    height: 0.12,
    anchorX: 0.5,
    anchorY: 0.5,
    rotation: 0,
  },
  motion: {
    keyframes: [{at: 0, opacity: 1}, {at: 1, opacity: 1}],
    path,
  },
};

const proofs = [
  {id: 'start', at: 0.05, kind: 'establish', label: 'start', assertions: []},
  {id: 'turn-east', at: 0.25, kind: 'action', label: 'east turn', assertions: []},
  {id: 'turn-south', at: 0.5, kind: 'action', label: 'south turn', assertions: []},
  {id: 'turn-west', at: 0.75, kind: 'action', label: 'west turn', assertions: []},
  {id: 'end', at: 0.95, kind: 'final', label: 'end', assertions: []},
];

const camera = {
  preset: 'static',
  intensity: 1,
  follow: {
    targetNodeId: 'tadpoles',
    worldNodeId: 'pond-world',
    framing: {x: 0.5, y: 0.54},
    lookAheadSeconds: 0.15,
    smoothingSeconds: 0.18,
    zoom: 1,
    worldBounds: {x: -1, y: -1, width: 3, height: 3},
  },
};

const scene = {
  id: 'pond',
  label: 'pond',
  eyebrow: 'pond',
  tailSeconds: 0,
  durationInFrames: 240,
  motion: {
    blueprint: 'map-journey',
    intensity: 1,
    seed: 7,
    proofTimes: proofs,
  },
  composition: {
    coordinateSpace: {width: 1000, height: 1000},
    nodes: [world, swimmer],
  },
  camera,
  narration: {
    src: 'fixtures/path-locomotion/narration.wav',
    startSeconds: 0,
    durationSeconds: 8,
    text: 'tadpoles swim',
  },
  subtitles: [],
  events: [],
};

const contract = {
  id: 'tadpole-path',
  kind: 'path-locomotion',
  sceneId: 'pond',
  nodeId: 'tadpoles',
  worldNodeId: 'pond-world',
  fromProofTimeId: 'start',
  throughProofTimeId: 'end',
  turnProofTimeIds: ['turn-east', 'turn-south', 'turn-west'],
  stateIds: ['tail-left', 'tail-right'],
  minimumChangesPerSecond: 3,
  continueThroughWindowEnd: true,
  minimumTravel: 2,
  minimumDepthTravel: 2,
  minimumProjectionScaleDelta: 0.4,
  requiredDepthDirections: ['toward-camera', 'away-camera'],
  minimumDirectionSectors: 8,
  maximumHeadingErrorDegrees: 18,
  maximumTurnDegreesPerSecond: 120,
  screenSafeBand: {
    minX: 0,
    maxX: 1,
    minY: 0,
    maxY: 1,
    rationale: 'registered swimmer canvas stays inside the visible water field',
  },
  requireCameraFollow: true,
};

const project = {
  slug: 'path-locomotion-test',
  video: {width: 1000, height: 1000, fps: 30},
  scenes: [scene],
  sceneTransitions: [],
  editorial: {
    activeProfile: '1:1',
    responsiveProfiles: [],
    responsivePlans: [],
  },
  spatialContracts: [contract],
};

test('cubic path uses arc-length progress and bounded tangent orientation', () => {
  assert.deepEqual(validatePathMotion(path), []);
  const frames = Array.from({length: 240}, (_, frame) =>
    resolvePathMotionAtFrame({
      pathMotion: path,
      frame,
      durationInFrames: 240,
      fps: 30,
    }),
  );
  const stepLengths = frames.slice(1).map((sample, index) =>
    Math.hypot(
      sample.x - frames[index].x,
      sample.y - frames[index].y,
      (sample.z - frames[index].z) * path.projection.depthDistanceScale,
    ),
  );
  const nonZero = stepLengths.filter((value) => value > 1e-8);
  const stepRatio = Math.max(...nonZero) / Math.min(...nonZero);
  assert.ok(stepRatio < 1.08, `3D arc-length step ratio=${stepRatio}`);
  const maximumTurnRate = Math.max(
    ...frames.slice(1).map((sample, index) => {
      let delta = (sample.rotationDegrees - frames[index].rotationDegrees) % 360;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      return Math.abs(delta) * 30;
    }),
  );
  assert.ok(maximumTurnRate <= 120 + 1e-6);
});

test('path heading and arc length use physical aspect ratio', () => {
  const diagonal = {
    ...path,
    start: {x: -0.3, y: -0.3, z: 0},
    segments: [
      {
        control1: {x: -0.1, y: -0.1, z: 0},
        control2: {x: 0.1, y: 0.1, z: 0},
        end: {x: 0.3, y: 0.3, z: 0},
      },
    ],
    orientation: {
      ...path.orientation,
      smoothingSeconds: 0,
      maximumTurnDegreesPerSecond: 360,
    },
  };
  const sample = resolvePathMotionAtFrame({
    pathMotion: diagonal,
    frame: 60,
    durationInFrames: 120,
    fps: 30,
    parentWidth: 1600,
    parentHeight: 900,
  });
  const expectedHeading = Math.atan2(0.6 * 900, 0.6 * 1600) * 180 / Math.PI;
  assert.ok(Math.abs(sample.headingDegrees - expectedHeading) < 0.1);
  assert.ok(Math.abs(sample.rotationDegrees - expectedHeading) < 0.1);
});

test('nested path proof resolves parent aspect and rotation once', () => {
  const video = {width: 1600, height: 900, fps: 30};
  const nestedScene = {
    ...scene,
    durationInFrames: 240,
    composition: {
      coordinateSpace: {width: 1600, height: 900},
      nodes: [
        world,
        {
          id: 'rotated-pond-layer',
          kind: 'group',
          pattern: 'free',
          z: 1,
          coordinateSpace: {width: 1600, height: 900},
          transform: {
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            anchorX: 0,
            anchorY: 0,
            rotation: 30,
          },
          motion: still,
          children: [swimmer],
        },
      ],
    },
    camera: {preset: 'static', intensity: 1},
  };
  const prepared = prepareSceneResolution({scene: nestedScene, video});
  const left = resolvePreparedNodeAt({
    prepared,
    nodeId: swimmer.id,
    progress: 80 / 239,
  });
  const right = resolvePreparedNodeAt({
    prepared,
    nodeId: swimmer.id,
    progress: 81 / 239,
  });
  const center = (entry) => ({
    x:
      entry.localMatrix[0] * entry.width * 0.5 +
      entry.localMatrix[2] * entry.height * 0.5 +
      entry.localMatrix[4],
    y:
      entry.localMatrix[1] * entry.width * 0.5 +
      entry.localMatrix[3] * entry.height * 0.5 +
      entry.localMatrix[5],
  });
  const from = center(left);
  const to = center(right);
  const movementHeading =
    Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;
  const renderedHeading =
    Math.atan2(right.localMatrix[1], right.localMatrix[0]) *
      180 / Math.PI +
    path.orientation.forwardAngleDegrees;
  let delta = (movementHeading - renderedHeading) % 360;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  assert.ok(Math.abs(delta) < 18);
  assert.ok(
    Math.abs(
      right.pathMotion.headingDegrees -
      resolvePathMotionAtFrame({
        pathMotion: path,
        frame: 81,
        durationInFrames: 240,
        fps: 30,
        parentWidth: 1600,
        parentHeight: 900,
      }).headingDegrees,
    ) < 1e-6,
  );
});

test('path locomotion proves eight directions, continuous turning, gait, and camera coverage', async () => {
  assert.deepEqual(validateCameraFollow({scene, video: project.video}), []);
  const inspection = await inspectSpatialContract(project, contract);
  assert.equal(
    inspection.passed,
    true,
    JSON.stringify(inspection.checks.filter(({passed}) => !passed), null, 2),
  );
  assert.ok(
    inspection.checks.some(
      ({id, actual}) =>
        id === 'path-locomotion-direction-sectors' &&
        actual.count === 8,
    ),
  );
  assert.ok(
    inspection.checks.some(
      ({id, passed}) =>
        id === 'path-locomotion-depth-projection' && passed,
    ),
  );
  assert.ok(
    inspection.checks.some(
      ({id, passed}) =>
        id === 'path-locomotion-camera-coverage' && passed,
    ),
  );
  assert.ok(
    inspection.checks.some(
      ({id, passed}) =>
        id === 'path-locomotion-screen-safe-band' && passed,
    ),
  );
  const overlay = spatialContractDebugOverlay({
    proof: {
      contractId: contract.id,
      kind: contract.kind,
      ...inspection,
    },
    sceneId: 'pond',
    proofTimeId: 'turn-south',
    width: 1000,
    height: 1000,
  });
  assert.match(overlay.toString(), /polyline/);
  assert.match(overlay.toString(), /heading-arrow/);
  const followed = resolveCameraFollowAtFrame({
    scene,
    video: project.video,
    frame: 120,
    fps: 30,
  });
  assert.ok(followed);
  assert.ok([followed.x, followed.y, followed.zoom].every(Number.isFinite));
});

test('path locomotion rejects a transformed registered canvas outside its screen safe band', async () => {
  const invalidContract = structuredClone(contract);
  invalidContract.screenSafeBand = {
    minX: 0.45,
    maxX: 0.55,
    minY: 0.45,
    maxY: 0.55,
    rationale: 'deliberately too tight',
  };
  const inspection = await inspectSpatialContract(project, invalidContract);
  const safeBand = inspection.checks.find(
    ({id}) => id === 'path-locomotion-screen-safe-band',
  );
  assert.equal(safeBand?.passed, false);
  assert.ok(safeBand.actual.violationFrames.length > 0);
});

test('camera follow accepts the tracked screen subject inside a top-level looping world', () => {
  const nested = structuredClone(scene);
  const nestedSwimmer = nested.composition.nodes.find(
    ({id}) => id === 'tadpoles',
  );
  nested.composition.nodes = [
    nested.composition.nodes.find(({id}) => id === 'pond-world'),
    {
      id: 'looping-pond',
      kind: 'group',
      pattern: 'looping-environment',
      z: 1,
      coordinateSpace: {width: 1000, height: 1000},
      transform: {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        anchorX: 0,
        anchorY: 0,
      },
      motion: still,
      loopingEnvironment: {
        axis: 'x',
        groundStripId: 'ground',
        subjectBindings: [{
          nodeId: 'tadpoles',
          role: 'tracked',
          anchorMode: 'screen',
          nearOcclusion: 'behind-near',
          proofTimeIds: ['start', 'end'],
        }],
        seamProofTimeIds: {
          before: 'start',
          seam: 'turn-south',
          after: 'end',
        },
        travel: {
          direction: 'left',
          distanceViewports: 2,
          closedLoop: false,
          startPhase: 0,
          activeFrom: 0,
          activeUntil: 1,
          easing: 'linear',
        },
        speedRange: {far: 0.2, near: 1},
        overscanPx: 2,
      },
      children: [nestedSwimmer],
    },
  ];
  assert.deepEqual(
    validateCameraFollow({scene: nested, video: project.video}),
    [],
  );
  const invalid = structuredClone(nested);
  invalid.composition.nodes[1].loopingEnvironment.subjectBindings[0].anchorMode =
    'world';
  assert.ok(
    validateCameraFollow({scene: invalid, video: project.video}).some(
      ({code}) => code === 'camera-follow-target',
    ),
  );
});

test('path locomotion measures a registered body anchor without inventing reversals at eased turns', async () => {
  const anchored = structuredClone(project);
  const anchoredScene = anchored.scenes[0];
  const anchoredSwimmer = anchoredScene.composition.nodes.find(
    ({id}) => id === 'tadpoles',
  );
  anchoredSwimmer.transform.anchorX = 0.62;
  anchoredSwimmer.states.forEach((state) => {
    state.anchors = [{id: 'body-center', x: 0.62, y: 0.5}];
  });
  anchoredSwimmer.motion.path.progress = [
    {at: 0, distance: 0, ease: 'ease-in-out'},
    {at: 0.25, distance: 0.25, ease: 'ease-in-out'},
    {at: 0.5, distance: 0.5, ease: 'ease-in-out'},
    {at: 0.75, distance: 0.75, ease: 'ease-in-out'},
    {at: 1, distance: 1, ease: 'ease-in-out'},
  ];
  anchoredScene.camera.parallax = {
    enabled: true,
    strength: 0.35,
    focalDepth: 0,
  };
  anchoredSwimmer.depth = 0.4;

  const inspection = await inspectSpatialContract(
    anchored,
    anchored.spatialContracts[0],
  );
  assert.equal(
    inspection.passed,
    true,
    JSON.stringify(inspection.checks.filter(({passed}) => !passed), null, 2),
  );
  assert.ok(
    inspection.checks.some(
      ({id, passed}) =>
        id === 'path-locomotion-heading' && passed,
    ),
  );
});

test('composition validation rejects competing keyframe motion on a path target', () => {
  const invalid = structuredClone(scene.composition);
  invalid.nodes[1].motion.keyframes[0].offsetX = 0;
  invalid.nodes[1].motion.keyframes[1].offsetX = 0.2;
  const result = validateCompositionStructure({
    composition: invalid,
    video: project.video,
    proofTimes: proofs,
    durationSeconds: 8,
    location: 'scene.composition',
    editorial: project.editorial,
    sceneId: 'pond',
  });
  assert.ok(
    result.issues.some(
      ({code}) => code === 'composition-path-keyframe-conflict',
    ),
  );
});

test('camera follow rejects an undersized or unrelated world surface', () => {
  const invalid = structuredClone(scene);
  invalid.camera.follow.worldNodeId = 'missing-world';
  invalid.camera.follow.worldBounds = {x: 0, y: 0, width: 0.5, height: 0.5};
  const issues = validateCameraFollow({scene: invalid, video: project.video});
  assert.ok(issues.some(({code}) => code === 'camera-follow-world'));
  assert.ok(
    issues.some(({code}) => code === 'camera-follow-world-bounds'),
  );
});
