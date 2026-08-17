import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {
  EMPHASIS_ACTIONS,
  deriveEventTimeline,
  hashCompositionValue,
  pointInPolygon,
  validateCompositionStructure,
} from '../scripts/composition-lib.mjs';
import {resolveSequencePhase, resolveSequenceState} from '../scripts/state-sequence-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const still = () => ({keyframes: [{at: 0, offsetX: 0}, {at: 1, offsetX: 0}]});
const fullTransform = () => ({x: 0, y: 0, width: 1, height: 1, anchorX: 0, anchorY: 0});
const withStateContract = (node) => node.kind !== 'state-sequence' ? node : ({
  ...node,
  anchorPolicy: {requiredAnchorIds: ['ground-contact'], maximumDrift: 0.02},
  states: node.states.map((state) => ({
    ...state,
    facing: 'right',
    anchors: [{id: 'ground-contact', x: 0.5, y: 0.9}],
    identityReferenceAssetId: `${node.poseFamilyId}-identity`,
    identityReferenceSha256: 'd'.repeat(64),
  })),
});
const asset = ({id, slot, role = 'prop', clip, semanticCoverage}) => ({
  id,
  kind: 'asset',
  assetRole: role,
  src: `projects/fixture/${id}.png`,
  z: 0,
  slot,
  registrationId: 'family-01',
  ...(clip ? {clip} : {}),
  ...(semanticCoverage ? {semanticCoverage} : {}),
  transform: fullTransform(),
  motion: still(),
});

const supportedGroup = () => ({
  id: 'boat-rig',
  kind: 'group',
  pattern: 'supported-subject',
  z: 2,
  coordinateSpace: {width: 100, height: 100},
  transform: fullTransform(),
  motion: still(),
  registration: {id: 'family-01', sourceMasterAssetId: 'boat-master', canvas: {width: 100, height: 100}, origin: 'top-left'},
  support: {
    subjectId: 'traveler',
    contactAnchor: {x: 0.5, y: 0.7},
    contactZone: [[0.3, 0.55], [0.75, 0.55], [0.78, 0.85], [0.28, 0.85]],
    occlusionZone: [[0.2, 0.58], [0.82, 0.58], [0.82, 0.9], [0.2, 0.9]],
  },
  children: [
    asset({id: 'boat-rear', slot: 'support-rear'}),
    asset({id: 'traveler', slot: 'subject', role: 'character'}),
    asset({id: 'boat-front', slot: 'support-front'}),
  ],
});

const registeredGroup = () => ({
  id: 'river-stack',
  kind: 'group',
  pattern: 'registered-environment',
  z: 0,
  coordinateSpace: {width: 100, height: 100},
  transform: fullTransform(),
  motion: still(),
  registration: {id: 'family-01', sourceMasterAssetId: 'river-master', canvas: {width: 100, height: 100}, origin: 'top-left'},
  boundaries: [{id: 'shoreline', normalizedY: 0.55, upperSemantic: 'land', lowerSemantic: 'water'}],
  children: [
    asset({id: 'bank', slot: 'upper-band', role: 'environment', clip: {boundaryId: 'shoreline', side: 'upper'}, semanticCoverage: ['bank', 'trees']}),
    asset({id: 'water', slot: 'lower-band', role: 'environment', clip: {boundaryId: 'shoreline', side: 'lower'}, semanticCoverage: ['water']}),
  ],
});

const depthStackGroup = () => ({
  id: 'boat-depth-stack',
  kind: 'group',
  pattern: 'registered-depth-stack',
  z: 0,
  coordinateSpace: {width: 100, height: 100},
  transform: fullTransform(),
  motion: still(),
  registration: {
    id: 'family-01',
    sourceMasterAssetId: 'boat-master',
    canvas: {width: 100, height: 100},
    origin: 'top-left',
  },
  layerStack: {
    sourcePackageId: 'boat-package',
    sourceStrategy: 'registered-layer-sheet',
    motionCapability: 'bounded-relative',
    revealEnvelope: {
      '16:9': {x: 0.04, y: 0.04, scale: 0.05, rotationDegrees: 2},
      '9:16': {x: 0.03, y: 0.04, scale: 0.04, rotationDegrees: 1},
      '1:1': {x: 0.03, y: 0.03, scale: 0.04, rotationDegrees: 1},
    },
  },
  children: [
    {...asset({id: 'rear', slot: 'support-rear', role: 'environment'}), depth: -0.7},
    {...asset({id: 'boat', slot: 'subject', role: 'character'}), depth: 0},
    {...asset({id: 'front', slot: 'support-front', role: 'environment'}), depth: 0.7},
  ],
});

const validate = (node, proofTimes = [{id: 'establish', at: 0.08}, {id: 'action', at: 0.5}, {id: 'final', at: 0.9}]) => validateCompositionStructure({
  composition: {coordinateSpace: {width: 100, height: 100}, nodes: [withStateContract(node)]},
  video: {width: 100, height: 100},
  proofTimes,
});

test('v5 supported subjects require contact, front occlusion and one carrier motion', () => {
  assert.deepEqual(validate(supportedGroup()).issues, []);
  const subjectFront = supportedGroup();
  subjectFront.support.layering = 'subject-front';
  assert.deepEqual(validate(subjectFront).issues, []);
  const missingFront = supportedGroup();
  missingFront.children = missingFront.children.filter(({slot}) => slot !== 'support-front');
  assert.ok(validate(missingFront).issues.some(({code}) => code === 'composition-support-slot'));

  const detached = supportedGroup();
  detached.support.contactAnchor = {x: 0.95, y: 0.1};
  assert.ok(validate(detached).issues.some(({code}) => code === 'composition-support-contact'));

  const duplicated = supportedGroup();
  duplicated.motion = {keyframes: [{at: 0, offsetX: 0}, {at: 1, offsetX: 0.1}]};
  duplicated.children[1].motion = structuredClone(duplicated.motion);
  assert.ok(validate(duplicated).issues.some(({code}) => code === 'composition-duplicated-carrier-motion'));
});

test('v5 registered environments enforce a shared canvas, boundary and exclusive semantics', () => {
  assert.deepEqual(validate(registeredGroup()).issues, []);
  const shifted = registeredGroup();
  shifted.children[1].transform.x = 0.02;
  assert.ok(validate(shifted).issues.some(({code}) => code === 'composition-registration-transform'));
  const duplicated = registeredGroup();
  duplicated.children[1].semanticCoverage.push('trees');
  assert.ok(validate(duplicated).issues.some(({code}) => code === 'composition-semantic-duplicate'));
});

test('visible assets cannot be duplicated at the same transform and clip', () => {
  const first = asset({id: 'foreground-a', role: 'environment'});
  const second = {
    ...asset({id: 'foreground-b', role: 'environment'}),
    src: first.src,
  };
  const result = validateCompositionStructure({
    composition: {
      coordinateSpace: {width: 100, height: 100},
      nodes: [first, second],
    },
    video: {width: 100, height: 100},
    proofTimes: [],
  });
  assert.ok(
    result.issues.some(
      ({code}) => code === 'composition-duplicate-visible-asset',
    ),
  );
});

test('v10 registered depth stacks require full-canvas ordered layers inside every reveal envelope', () => {
  assert.deepEqual(validate(depthStackGroup()).issues, []);

  const flat = depthStackGroup();
  flat.layerStack.sourceStrategy = 'rigid-master';
  assert.ok(
    validate(flat).issues.some(
      ({code}) => code === 'composition-layer-source-strategy',
    ),
  );

  const cropped = depthStackGroup();
  cropped.children[1].transform.width = 0.5;
  assert.ok(
    validate(cropped).issues.some(
      ({code}) => code === 'composition-layer-canvas',
    ),
  );

  const overTravel = depthStackGroup();
  overTravel.children[1].motion = {
    keyframes: [{at: 0, offsetX: 0}, {at: 1, offsetX: 0.035}],
  };
  assert.ok(
    validate(overTravel).issues.some(
      ({code}) => code === 'composition-layer-reveal-exceeded',
    ),
  );

  const shrinking = depthStackGroup();
  shrinking.children[0].motion = {
    keyframes: [{at: 0, scale: 1}, {at: 1, scale: 0.98}],
  };
  assert.ok(
    validate(shrinking).issues.some(
      ({code}) => code === 'composition-layer-scale-shrink',
    ),
  );

  const sceneStack = depthStackGroup();
  sceneStack.stackingContext = 'scene';
  sceneStack.transform = {
    x: 0.5,
    y: 0.5,
    width: 3,
    height: 2.5,
    anchorX: 0.5,
    anchorY: 0.5,
  };
  sceneStack.children[0].z = 0;
  sceneStack.children[1].z = 1;
  sceneStack.children[2].z = 4;
  assert.deepEqual(validate(sceneStack).issues, []);

  const movingSceneStack = structuredClone(sceneStack);
  movingSceneStack.motion = {
    keyframes: [{at: 0, scale: 1}, {at: 1, scale: 1.02}],
  };
  assert.ok(
    validate(movingSceneStack).issues.some(
      ({code}) => code === 'composition-scene-stacking-carrier',
    ),
  );

  const duplicateSceneZ = structuredClone(sceneStack);
  duplicateSceneZ.children[2].z = 1;
  assert.ok(
    validate(duplicateSceneZ).issues.some(
      ({code}) => code === 'composition-scene-stacking-z',
    ),
  );
});

test('geometry, event catalog and fingerprints remain deterministic', () => {
  assert.equal(pointInPolygon([0.5, 0.5], [[0, 0], [1, 0], [1, 1], [0, 1]]), true);
  assert.equal(pointInPolygon([1.5, 0.5], [[0, 0], [1, 0], [1, 1], [0, 1]]), false);
  assert.ok(EMPHASIS_ACTIONS.includes('drop-impact'));
  assert.ok(EMPHASIS_ACTIONS.includes('carve'));
  const first = hashCompositionValue(supportedGroup());
  const changed = supportedGroup();
  changed.support.contactAnchor.x = 0.51;
  assert.notEqual(first, hashCompositionValue(changed));
  assert.equal(first, hashCompositionValue(supportedGroup()));
  const stackHash = hashCompositionValue(depthStackGroup());
  const sceneStack = depthStackGroup();
  sceneStack.stackingContext = 'scene';
  assert.notEqual(stackHash, hashCompositionValue(sceneStack));

  const events = deriveEventTimeline({
    scene: {id: 'scene', durationInFrames: 100, events: [{id: 'impact', beatId: 'fall', at: 0.5, targetId: 'sword', visual: {kind: 'emphasis', action: 'drop-impact', durationSeconds: 0.4, intensity: 1}, proofTimeId: 'proof-impact', sound: {src: 'impact.wav'}}]},
    sceneFrom: 20,
    fps: 20,
  });
  assert.deepEqual(events[0], {
    sceneId: 'scene',
    eventId: 'impact',
    beatId: 'fall',
    targetId: 'sword',
    visualKind: 'emphasis',
    action: 'drop-impact',
    localFrame: 50,
    absoluteFrame: 70,
    seconds: 3.5,
    proofTimeId: 'proof-impact',
    sound: 'impact.wav',
  });
});

test('v5 state sequences resolve discrete poses and require proof coverage', () => {
  const node = {
    id: 'reader',
    kind: 'state-sequence',
    assetRole: 'character',
    poseFamilyId: 'reader-family',
    registration: {id: 'reader-registration', sourceMasterAssetId: 'reader-sheet', canvas: {width: 100, height: 100}, origin: 'top-left'},
    states: [
      {id: 'book-open', src: 'reader-open.png', at: 0},
      {id: 'page-turn', src: 'reader-turn.png', at: 0.35},
      {id: 'pointing', src: 'reader-point.png', at: 0.7},
    ],
    playback: {mode: 'once', cycles: 1},
    transition: {type: 'cut', durationSeconds: 0},
    z: 1,
    transform: fullTransform(),
    motion: still(),
  };
  const proofTimes = [
    {id: 'open', at: 0.1, stateAssertions: [{nodeId: 'reader', stateId: 'book-open'}]},
    {id: 'turn', at: 0.5, stateAssertions: [{nodeId: 'reader', stateId: 'page-turn'}]},
    {id: 'point', at: 0.9, stateAssertions: [{nodeId: 'reader', stateId: 'pointing'}]},
  ];
  assert.equal(resolveSequenceState({node, progress: 0.5}).id, 'page-turn');
  assert.equal(resolveSequencePhase({progress: 0.75, mode: 'ping-pong', cycles: 2}), 1);
  assert.deepEqual(validate(node, proofTimes).issues, []);
  const wrong = structuredClone(proofTimes);
  wrong[1].stateAssertions[0].stateId = 'pointing';
  assert.ok(validate(node, wrong).issues.some(({code}) => code === 'composition-sequence-proof-mismatch'));

  const compoundCoverage = [{
    id: 'reader-family-coverage',
    at: 0.5,
    stateAssertions: [
      {nodeId: 'reader', stateId: 'book-open'},
      {nodeId: 'reader', stateId: 'page-turn'},
      {nodeId: 'reader', stateId: 'pointing'},
    ],
  }];
  assert.deepEqual(validate(node, compoundCoverage).issues, []);
  const missingResolvedState = structuredClone(compoundCoverage);
  missingResolvedState[0].stateAssertions.splice(1, 1);
  assert.ok(
    validate(node, missingResolvedState).issues.some(
      ({code}) => code === 'composition-sequence-proof-mismatch',
    ),
  );
});

test('v5 state sequences can loop during motion and hold a registered contact state', () => {
  const node = {
    id: 'butterfly',
    kind: 'state-sequence',
    assetRole: 'character',
    poseFamilyId: 'butterfly-flight',
    registration: {id: 'butterfly-registration', sourceMasterAssetId: 'butterfly-sheet', canvas: {width: 100, height: 100}, origin: 'top-left'},
    states: [
      {id: 'folded', src: 'folded.png', at: 0},
      {id: 'open', src: 'open.png', at: 0.25},
      {id: 'up', src: 'up.png', at: 0.5},
      {id: 'level', src: 'level.png', at: 0.75},
    ],
    playback: {mode: 'loop', cycles: 4, activeUntil: 0.6, holdStateId: 'folded'},
    transition: {type: 'cut', durationSeconds: 0},
    z: 1,
    transform: fullTransform(),
    motion: still(),
  };
  assert.equal(resolveSequenceState({node, progress: 0.2}).id, 'open');
  assert.equal(resolveSequenceState({node, progress: 0.7}).id, 'folded');
  const proofTimes = [
    {id: 'folded-flight', at: 0.01, stateAssertions: [{nodeId: 'butterfly', stateId: 'folded'}]},
    {id: 'open-flight', at: 0.05, stateAssertions: [{nodeId: 'butterfly', stateId: 'open'}]},
    {id: 'up-flight', at: 0.09, stateAssertions: [{nodeId: 'butterfly', stateId: 'up'}]},
    {id: 'level-flight', at: 0.13, stateAssertions: [{nodeId: 'butterfly', stateId: 'level'}]},
    {id: 'landed', at: 0.8, stateAssertions: [{nodeId: 'butterfly', stateId: 'folded'}]},
  ];
  assert.deepEqual(validate(node, proofTimes).issues, []);
  const unknownHold = structuredClone(node);
  unknownHold.playback.holdStateId = 'missing';
  assert.ok(validate(unknownHold, proofTimes).issues.some(({code}) => code === 'composition-sequence-hold-state'));
});

test('v5 state sequences can exit a locomotion loop through landing states before the final hold', () => {
  const node = {
    id: 'crow',
    kind: 'state-sequence',
    assetRole: 'character',
    poseFamilyId: 'crow-flight',
    registration: {id: 'crow-registration', sourceMasterAssetId: 'crow-sheet', canvas: {width: 100, height: 100}, origin: 'top-left'},
    states: [
      {id: 'glide', src: 'glide.png', at: 0},
      {id: 'flap', src: 'flap.png', at: 0.26},
      {id: 'brake', src: 'brake.png', at: 0.54},
      {id: 'grounded', src: 'grounded.png', at: 0.62},
    ],
    playback: {
      mode: 'loop',
      cycles: 6,
      activeFrom: 0.01,
      activeUntil: 0.54,
      holdStateId: 'grounded',
      activeStateIds: ['glide', 'flap'],
    },
    transition: {type: 'cut', durationSeconds: 0},
    z: 1,
    transform: fullTransform(),
    motion: still(),
  };
  assert.equal(resolveSequenceState({node, progress: 0.31}).id, 'glide');
  assert.equal(resolveSequenceState({node, progress: 0.58}).id, 'brake');
  assert.equal(resolveSequenceState({node, progress: 0.8}).id, 'grounded');
  const proofTimes = [
    {id: 'flap', at: 0.08, stateAssertions: [{nodeId: 'crow', stateId: 'flap'}]},
    {id: 'glide', at: 0.31, stateAssertions: [{nodeId: 'crow', stateId: 'glide'}]},
    {id: 'brake', at: 0.58, stateAssertions: [{nodeId: 'crow', stateId: 'brake'}]},
    {id: 'grounded', at: 0.8, stateAssertions: [{nodeId: 'crow', stateId: 'grounded'}]},
  ];
  assert.deepEqual(validate(node, proofTimes).issues, []);

  const gap = structuredClone(node);
  gap.states.find(({id}) => id === 'brake').at = 0.56;
  assert.ok(
    validate(gap, proofTimes).issues.some(
      ({code}) => code === 'composition-sequence-exit-order',
    ),
  );
});

test('state sequences can hold a prelude, then loop only an authored gait pair', () => {
  const node = {
    id: 'hare',
    kind: 'state-sequence',
    assetRole: 'character',
    poseFamilyId: 'hare-actions',
    registration: {id: 'hare-registration', sourceMasterAssetId: 'hare-sheet', canvas: {width: 100, height: 100}, origin: 'top-left'},
    states: [
      {id: 'sleep', src: 'sleep.png', at: 0},
      {id: 'startled', src: 'startled.png', at: 0.2},
      {id: 'stride-a', src: 'stride-a.png', at: 0.44},
      {id: 'stride-b', src: 'stride-b.png', at: 0.72},
    ],
    playback: {mode: 'loop', cycles: 3, activeFrom: 0.44, activeStateIds: ['stride-a', 'stride-b']},
    transition: {type: 'cut', durationSeconds: 0},
    z: 1,
    transform: fullTransform(),
    motion: still(),
  };
  const proofTimes = [
    {id: 'sleep', at: 0.1, stateAssertions: [{nodeId: 'hare', stateId: 'sleep'}]},
    {id: 'startled', at: 0.22, stateAssertions: [{nodeId: 'hare', stateId: 'startled'}]},
    {id: 'stride-a', at: 0.45, stateAssertions: [{nodeId: 'hare', stateId: 'stride-a'}]},
    {id: 'stride-b', at: 0.55, stateAssertions: [{nodeId: 'hare', stateId: 'stride-b'}]},
  ];
  assert.equal(resolveSequenceState({node, progress: 0.1}).id, 'sleep');
  assert.equal(resolveSequenceState({node, progress: 0.22}).id, 'startled');
  assert.equal(resolveSequenceState({node, progress: 0.45}).id, 'stride-a');
  assert.equal(resolveSequenceState({node, progress: 0.55}).id, 'stride-b');
  assert.deepEqual(validate(node, proofTimes).issues, []);

  const unordered = structuredClone(node);
  unordered.playback.activeStateIds.reverse();
  assert.ok(validate(unordered, proofTimes).issues.some(({code}) => code === 'composition-sequence-active-state-order'));
});

test('final state proofs reject crossfades and states that do not hold to scene end', () => {
  const node = {
    id: 'butterfly',
    kind: 'state-sequence',
    assetRole: 'character',
    poseFamilyId: 'butterfly-family',
    registration: {id: 'butterfly-registration', sourceMasterAssetId: 'butterfly-sheet', canvas: {width: 100, height: 100}, origin: 'top-left'},
    states: [
      {id: 'folded', src: 'folded.png', at: 0},
      {id: 'open', src: 'open.png', at: 0.35},
      {id: 'landed', src: 'landed.png', at: 0.7},
    ],
    playback: {mode: 'once', cycles: 1},
    transition: {type: 'crossfade', durationSeconds: 0.5},
    z: 1,
    transform: fullTransform(),
    motion: still(),
  };
  const baseProofs = [
    {id: 'folded', at: 0.1, kind: 'establish', stateAssertions: [{nodeId: 'butterfly', stateId: 'folded'}]},
    {id: 'open', at: 0.5, kind: 'action', stateAssertions: [{nodeId: 'butterfly', stateId: 'open'}]},
  ];
  const inCrossfade = validateCompositionStructure({
    composition: {coordinateSpace: {width: 100, height: 100}, nodes: [node]},
    video: {width: 100, height: 100},
    durationSeconds: 10,
    proofTimes: [...baseProofs, {id: 'landed', at: 0.72, kind: 'final', stateAssertions: [{nodeId: 'butterfly', stateId: 'landed'}]}],
  });
  assert.ok(inCrossfade.issues.some(({code}) => code === 'composition-sequence-final-unstable'));

  const stable = validateCompositionStructure({
    composition: {coordinateSpace: {width: 100, height: 100}, nodes: [node]},
    video: {width: 100, height: 100},
    durationSeconds: 10,
    proofTimes: [...baseProofs, {id: 'landed', at: 0.9, kind: 'final', stateAssertions: [{nodeId: 'butterfly', stateId: 'landed'}]}],
  });
  assert.ok(!stable.issues.some(({code}) => code === 'composition-sequence-final-unstable'));
});

test('v9 typography and shape nodes keep explanatory UI editable', () => {
  const nodes = [
    {
      id: 'card', kind: 'shape', shape: 'rectangle', style: {fill: '#17191d', stroke: '#5f6670', strokeWidth: 2, radius: 12}, z: 1,
      transform: {x: 0.1, y: 0.1, width: 0.8, height: 0.5, anchorX: 0, anchorY: 0}, motion: still(),
    },
    {
      id: 'question', kind: 'typography', text: '为什么？',
      treatment: {
        fit: {minFontSize: 8, maxFontSize: 16, maxLines: 2, overflow: 'error'},
        style: {
          color: '#ffffff',
          fontWeight: 700,
          lineHeight: 1.2,
          align: 'center',
          fontFamily: 'Arial',
        },
        effects: {},
        highlights: [],
        reveal: {mode: 'none', editPointIds: []},
        emphasis: [],
        safeAreaMode: 'inside',
        avoidZoneIds: [],
      },
      z: 2,
      transform: {x: 0.2, y: 0.2, width: 0.6, height: 0.2, anchorX: 0, anchorY: 0}, motion: still(),
    },
  ];
  const result = validateCompositionStructure({
    composition: {coordinateSpace: {width: 100, height: 100}, nodes},
    video: {width: 100, height: 100},
    proofTimes: [{id: 'establish', at: 0.1}, {id: 'action', at: 0.5}, {id: 'final', at: 0.9}],
  });
  assert.deepEqual(result.issues, []);
});

test('bundled render fixture exercises current registration and state sequence together', () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', 'composition-v4', 'project.json'), 'utf8'));
  const scene = fixture.scenes[0];
  const result = validateCompositionStructure({
    composition: scene.composition,
    video: fixture.video,
    proofTimes: scene.motion.proofTimes,
  });
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.groups.map(({node}) => node.pattern).sort(), ['registered-environment', 'supported-subject']);
  assert.deepEqual(result.sequences.map(({node}) => node.poseFamilyId), ['traveler-poses']);
});
