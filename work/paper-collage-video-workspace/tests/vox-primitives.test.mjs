import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {
  collectCompositionVisualSources,
  validateCompositionStructure,
} from '../scripts/composition-lib.mjs';
import {collectCompositeQualityTargets} from '../scripts/quality-lib.mjs';
import {
  compileStoryboardDirecting,
  validateDirectingExecution,
} from '../scripts/motion-treatment-lib.mjs';
import {validateSceneTransitionSequence} from '../src/sceneTimeline.mjs';
import {
  MAX_MOTIF_INSTANCES_PER_SCENE,
  isPointInsideMotifExclusion,
  resolveMotifFieldInstances,
  resolveMotifFieldMotion,
  resolveWorldBoundMotifX,
  verifyMotifFieldLoop,
} from '../src/motifField.mjs';
import {
  resolveParallaxState,
  validateParallaxRig,
} from '../src/parallax.mjs';
import {
  createEditorialFixture,
  withCompiledEditorialFixture,
} from '../fixtures/editorial-fixture.mjs';
import {FIXTURE_STYLE_PROFILE} from '../fixtures/motion-contract-fixture.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const still = {keyframes: [{at: 0, offsetX: 0}, {at: 1, offsetX: 0}]};
const transform = {x: 0, y: 0, width: 1, height: 1, anchorX: 0, anchorY: 0};

const motifField = (overrides = {}) => ({
  id: 'petal-field',
  kind: 'motif-field',
  motifs: [
    {id: 'petal-a', src: 'motifs/petal-a.svg'},
    {id: 'petal-b', src: 'motifs/petal-b.svg'},
  ],
  count: 12,
  seed: 42,
  distribution: 'scattered',
  fieldMotion: {preset: 'fall-drift', cycles: 2},
  baseSize: 0.08,
  variation: {
    scale: [0.7, 1.25],
    rotation: [-24, 24],
    opacity: [0.45, 0.9],
  },
  bounds: {x: 0.05, y: 0.08, width: 0.9, height: 0.82},
  exclusionZones: [{
    id: 'title-zone',
    shape: 'rectangle',
    x: 0.3,
    y: 0.3,
    width: 0.4,
    height: 0.35,
    padding: 0.02,
  }],
  z: 3,
  depth: 0.7,
  transform,
  motion: still,
  ...overrides,
});

test('motif fields expand deterministically without authoring one node per particle', () => {
  const node = motifField();
  const first = resolveMotifFieldInstances(node);
  const second = resolveMotifFieldInstances(structuredClone(node));
  assert.deepEqual(first, second);
  assert.equal(first.length, 12);
  assert.equal(new Set(first.map(({id}) => id)).size, 12);
  assert.notDeepEqual(
    first,
    resolveMotifFieldInstances(motifField({seed: 43})),
  );
  assert.ok(first.every((point) =>
    !node.exclusionZones.some((zone) =>
      isPointInsideMotifExclusion(
        point,
        zone,
        node.baseSize * node.variation.scale[1],
      )
    )
  ));
  const motion = resolveMotifFieldMotion({
    instance: first[0],
    preset: node.fieldMotion.preset,
    progress: 0.5,
    cycles: node.fieldMotion.cycles,
  });
  assert.ok(Object.values(motion).every(Number.isFinite));
  assert.deepEqual(
    collectCompositionVisualSources({nodes: [node]}),
    ['motifs/petal-a.svg', 'motifs/petal-b.svg'],
  );
});

test('world-bound motif instances wrap with their environment while keeping local drift small', () => {
  const bounds = {x: 0.1, y: 0.08, width: 0.8, height: 0.68};
  assert.equal(
    resolveWorldBoundMotifX({
      instanceX: 0.2,
      localOffsetX: 0.004,
      worldDisplacementPx: -480,
      viewportWidth: 1920,
      bounds,
    }),
    0.754,
  );
  const wrapped = resolveWorldBoundMotifX({
    instanceX: 0.86,
    localOffsetX: 0.004,
    worldDisplacementPx: 240,
    viewportWidth: 1920,
    bounds,
  });
  assert.ok(wrapped >= bounds.x && wrapped <= bounds.x + bounds.width);
  const motion = resolveMotifFieldMotion({
    instance: {phase: 0.1, x: 0.5, y: 0.5},
    preset: 'rise-drift',
    progress: 0.2,
    cycles: 4,
    horizontalAmplitude: 0.004,
  });
  assert.ok(Math.abs(motion.x) <= 0.004 + Number.EPSILON);
});

test('motif fields enforce bounded density, exclusions, placement, and scene budget', () => {
  const valid = validateCompositionStructure({
    composition: {coordinateSpace: {width: 1920, height: 1080}, nodes: [motifField()]},
    video: {width: 1920, height: 1080},
    proofTimes: [],
  });
  assert.deepEqual(valid.issues, []);
  assert.equal(valid.motifFields.length, 1);

  const invalid = motifField({
    count: 65,
    variation: {scale: [1, 0.5], rotation: [-10, 10], opacity: [-0.1, 1]},
    bounds: {x: 0.8, y: 0, width: 0.4, height: 1},
    exclusionZones: [
      {id: 'duplicate', shape: 'rectangle', x: 0, y: 0, width: 1, height: 1},
      {id: 'duplicate', shape: 'triangle', x: 0, y: 0, width: 1, height: 1},
    ],
  });
  const codes = new Set(validateCompositionStructure({
    composition: {coordinateSpace: {width: 1920, height: 1080}, nodes: [invalid]},
    video: {width: 1920, height: 1080},
  }).issues.map(({code}) => code));
  assert.ok(codes.has('composition-motif-count'));
  assert.ok(codes.has('composition-motif-variation'));
  assert.ok(codes.has('composition-motif-opacity'));
  assert.ok(codes.has('composition-motif-bounds'));
  assert.ok(codes.has('composition-motif-exclusion-id'));
  assert.ok(codes.has('composition-motif-exclusion-shape'));

  const denseFields = Array.from({length: 4}, (_, index) =>
    motifField({
      id: `field-${index}`,
      count: MAX_MOTIF_INSTANCES_PER_SCENE / 3,
      exclusionZones: [],
    })
  );
  assert.ok(validateCompositionStructure({
    composition: {coordinateSpace: {width: 1920, height: 1080}, nodes: denseFields},
    video: {width: 1920, height: 1080},
  }).issues.some(({code}) => code === 'composition-motif-scene-budget'));
});

test('fall, rise, and burst fields hide deterministic respawns while cycles affect timing', () => {
  for (const preset of ['drift', 'fall-drift', 'rise-drift', 'burst', 'orbit']) {
    assert.equal(verifyMotifFieldLoop({preset, cycles: 2}).passed, true);
  }
  const instance = {...resolveMotifFieldInstances(motifField({exclusionZones: []}))[0], phase: 0};
  const oneCycle = resolveMotifFieldMotion({
    instance,
    preset: 'burst',
    progress: 0.25,
    cycles: 1,
  });
  const twoCycles = resolveMotifFieldMotion({
    instance,
    preset: 'burst',
    progress: 0.25,
    cycles: 2,
  });
  assert.notDeepEqual(oneCycle, twoCycles);
  const respawn = resolveMotifFieldMotion({
    instance,
    preset: 'fall-drift',
    progress: 0.5,
    cycles: 2,
  });
  assert.equal(respawn.opacity, 0);

  const lower = resolveMotifFieldMotion({
    instance,
    preset: 'rise-drift',
    progress: 0.1,
    cycles: 1,
  });
  const upper = resolveMotifFieldMotion({
    instance,
    preset: 'rise-drift',
    progress: 0.8,
    cycles: 1,
  });
  assert.ok(instance.y + lower.y > instance.y + upper.y);
  assert.ok(instance.y + lower.y > 0.9);
  assert.ok(instance.y + upper.y < 0.2);
});

test('camera-coupled parallax separates depth while keeping the focal plane stable', () => {
  const parallax = {enabled: true, strength: 1, focalDepth: 0};
  assert.deepEqual(resolveParallaxState({
    depth: 0,
    cameraX: 20,
    cameraY: -10,
    cameraZoom: 1.04,
    parallax,
  }), {x: 0, y: 0, scale: 1});
  assert.deepEqual(resolveParallaxState({
    depth: 1,
    cameraX: 20,
    cameraY: -10,
    cameraZoom: 1.04,
    parallax,
  }), {x: 20, y: -10, scale: 1.04});
  assert.deepEqual(resolveParallaxState({
    depth: -1,
    cameraX: 20,
    cameraY: -10,
    cameraZoom: 1.04,
    parallax,
  }), {x: -20, y: 10, scale: 0.96});
});

test('parallax rigs require camera motion and distinct legal depth layers', () => {
  const asset = (id, depth) => ({
    id,
    kind: 'asset',
    assetRole: 'decorative',
    src: `${id}.svg`,
    z: depth,
    depth,
    transform,
    motion: still,
  });
  const camera = {
    preset: 'pan-right',
    intensity: 1,
    keyframes: [{at: 0, x: -20, y: 0, zoom: 1}, {at: 1, x: 20, y: 0, zoom: 1.03}],
    parallax: {enabled: true, strength: 0.8, focalDepth: 0},
  };
  assert.deepEqual(validateParallaxRig({
    camera,
    composition: {nodes: [asset('back', -1), asset('front', 1)]},
  }), []);
  const invalid = validateParallaxRig({
    camera: {...camera, preset: 'static', keyframes: [{at: 0}, {at: 1}]},
    composition: {nodes: [asset('back', 0), asset('front', 0)]},
  });
  assert.ok(invalid.some(({code}) => code === 'parallax-camera-motion'));
  assert.ok(invalid.some(({code}) => code === 'parallax-depth-spread'));
  assert.ok(
    !validateParallaxRig({
      camera: {
        preset: 'static',
        intensity: 1,
        follow: {
          targetNodeId: 'swimmer',
          worldNodeId: 'pond-world',
        },
        parallax: {enabled: true, strength: 0.8, focalDepth: 0},
      },
      composition: {nodes: [asset('back', -1), asset('front', 1)]},
    }).some(({code}) => code === 'parallax-camera-motion'),
  );

  const depthStack = {
    id: 'depth-stack',
    kind: 'group',
    pattern: 'registered-depth-stack',
    children: [
      asset('rear', -0.7),
      asset('subject', 0),
      asset('front', 0.7),
    ],
  };
  assert.ok(
    validateParallaxRig({
      camera,
      composition: {nodes: [depthStack]},
    }).some(({code}) => code === 'parallax-layer-scale-shrink'),
  );
  assert.ok(
    !validateParallaxRig({
      camera: {
        ...camera,
        parallax: {...camera.parallax, focalDepth: -1},
      },
      composition: {nodes: [depthStack]},
    }).some(({code}) => code === 'parallax-layer-scale-shrink'),
  );
});

test('a frozen looping environment retains depth ordering without enabling camera parallax', () => {
  const frozenWorld = {
    id: 'still-race-world',
    kind: 'group',
    pattern: 'looping-environment',
    loopingEnvironment: {travel: {frozen: true}},
    children: [
      {id: 'far', kind: 'world-strip', depth: -0.7},
      {id: 'runner', kind: 'state-sequence', depth: 0.2},
      {id: 'near', kind: 'world-strip', depth: 0.7},
    ],
  };
  assert.deepEqual(validateParallaxRig({
    camera: {preset: 'static', parallax: {enabled: false}},
    composition: {nodes: [frozenWorld]},
  }), []);
});

test('parallax and motif primitives produce fingerprinted proof targets', async () => {
  const project = {
    slug: 'quality-primitives',
    sceneTransitions: [],
    editorial: {
      fingerprint: 'f'.repeat(64),
      responsivePlans: [
        {profileId: '16:9', width: 1920, height: 1080},
        {profileId: '9:16', width: 1080, height: 1920},
        {profileId: '1:1', width: 1080, height: 1080},
      ].map((profile) => ({
        ...profile,
        densityBudget: 8,
        scenes: [{
          sceneId: 'scene',
          densityUsed: 1,
          placements: [{targetId: 'background'}],
        }],
      })),
    },
    scenes: [{
      id: 'scene',
      camera: {
        preset: 'pan-right',
        intensity: 1,
        parallax: {enabled: true, strength: 0.8, focalDepth: 0},
      },
      motion: {
        proofTimes: [
          {id: 'establish', at: 0.08},
          {id: 'action', at: 0.5},
          {id: 'final', at: 0.9},
        ],
      },
      narration: {durationSeconds: 4},
      tailSeconds: 0,
      events: [],
      composition: {
        nodes: [
          {
            id: 'background',
            kind: 'asset',
            assetRole: 'background',
            src: 'missing/background.svg',
            depth: -1,
            z: 0,
            transform,
            motion: still,
          },
          motifField(),
        ],
      },
    }],
  };
  const targets = await collectCompositeQualityTargets(project, {
    manifest: {assets: []},
  });
  const parallax = targets.find(({pattern}) => pattern === 'parallax-rig');
  const motifs = targets.find(({pattern}) => pattern === 'motif-field');
  const responsive = targets.filter(
    ({pattern}) => pattern === 'responsive-directing',
  );
  assert.ok(parallax);
  assert.ok(motifs);
  assert.equal(responsive.length, 3);
  assert.ok(
    responsive.every(
      (target) =>
        target.proofShots.length > 0 &&
        target.proofShots.every(
          ({proofTimeIds}) => proofTimeIds.length === 1,
        ),
    ),
  );
  assert.match(parallax.fingerprint, /^[a-f0-9]{64}$/);
  assert.match(motifs.fingerprint, /^[a-f0-9]{64}$/);
  assert.ok(parallax.requiredChecks.includes('camera-coupling-clean'));
  assert.ok(motifs.requiredChecks.includes('field-density-readable'));
});

test('the no-provider VOX fixture compiles and executes every new primitive', () => {
  const storyboardInput = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'fixtures', 'vox-primitives', 'storyboard-input.json'),
    'utf8',
  ));
  storyboardInput.editorial = createEditorialFixture({
    sceneIds: storyboardInput.scenes.map(({id}) => id),
    mediaSrc: 'fixtures/vox-primitives/tone.wav',
    mediaSha256: '1c14b9f9cc430154dd3a74fc5267a83233f2e04e492444376c27dd956134177f',
    durationSeconds: 6,
  });
  const project = withCompiledEditorialFixture(JSON.parse(fs.readFileSync(
    path.join(ROOT, 'fixtures', 'vox-primitives', 'project.json'),
    'utf8',
  )), {
    mediaSrc: 'fixtures/vox-primitives/tone.wav',
    mediaSha256: '1c14b9f9cc430154dd3a74fc5267a83233f2e04e492444376c27dd956134177f',
    durationSeconds: 6,
  });
  const storyboard = compileStoryboardDirecting(storyboardInput, {
    plan: project.plan,
    styleProfile: FIXTURE_STYLE_PROFILE,
  });
  project.motionContract = storyboard.motionContract;
  assert.equal(project.plan.assetBudget.maxGeneratedImages, 25);
  assert.deepEqual(
    validateSceneTransitionSequence({
      scenes: storyboard.scenes,
      sceneTransitions: storyboard.sceneTransitions,
    }),
    [],
  );
  assert.deepEqual(project.sceneTransitions, storyboard.sceneTransitions);
  for (const [index, scene] of project.scenes.entries()) {
    for (const source of collectCompositionVisualSources(scene.composition)) {
      assert.ok(
        fs.existsSync(path.join(ROOT, 'public', source)),
        `missing sample visual source: ${source}`,
      );
    }
    assert.ok(
      fs.existsSync(path.join(ROOT, 'public', scene.narration.src)),
      `missing sample narration source: ${scene.narration.src}`,
    );
    assert.deepEqual(validateCompositionStructure({
      composition: scene.composition,
      video: project.video,
      proofTimes: scene.motion.proofTimes,
      durationSeconds: 3,
      location: `scenes[${index}].composition`,
    }).issues, []);
    assert.deepEqual(validateParallaxRig({
      camera: scene.camera,
      composition: scene.composition,
      location: `scenes[${index}].camera.parallax`,
    }), []);
    assert.deepEqual(validateDirectingExecution({
      scene,
      storyboardScene: storyboard.scenes[index],
      location: `scenes[${index}]`,
    }), []);
  }
});
