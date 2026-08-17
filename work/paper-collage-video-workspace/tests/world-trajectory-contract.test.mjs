import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateProductionContracts,
  validateTrajectoryContracts,
  validateWorldContracts,
} from '../scripts/world-trajectory-lib.mjs';

const still = () => ({keyframes: [{at: 0, offsetX: 0}, {at: 1, offsetX: 0}]});
const transform = ({x, y, width, height = width}) => ({x, y, width, height, anchorX: 0, anchorY: 0});
const surfaceRole = {
  far: 'backdrop',
  mid: 'scenery',
  ground: 'walkable-ground',
  near: 'foreground-occluder',
};
const strip = (role) => ({id: `${role}-strip`, kind: 'world-strip', role, surfaceRole: surfaceRole[role], src: `${role}.png`, z: 0, depth: 0, transform: transform({x: 0, y: 0, width: 1, height: 1}), motion: still(), loopingStripBinding: {sourceAssetId: `forest-${role}-source`}});
const stateNode = (id, x) => ({
  id,
  kind: 'state-sequence',
  assetRole: 'character',
  poseFamilyId: `${id}-poses`,
  registration: {id: `${id}-registration`, sourceMasterAssetId: `${id}-sheet`, canvas: {width: 100, height: 100}, origin: 'top-left'},
  states: [{id: 'sleep', src: 'sleep.png', at: 0}, {id: 'run-a', src: 'run-a.png', at: 0.4}, {id: 'run-b', src: 'run-b.png', at: 0.7}],
  playback: {mode: 'once', cycles: 1},
  transition: {type: 'cut', durationSeconds: 0},
  z: 2,
  transform: transform({x, y: 0.58, width: 0.12, height: 0.12}),
  motion: {keyframes: [{at: 0, offsetX: 0}, {at: 1, offsetX: 0.44}]},
});

const scene = ({id, includeMarker = true}) => ({
  id,
  composition: {
    coordinateSpace: {width: 100, height: 100},
    world: {
      id: 'forest-track',
      groupId: 'world',
      route: {
        travelers: [
          {nodeId: 'hare', fromProofTimeId: 'sleep', throughProofTimeId: 'finish'},
          {nodeId: 'turtle', fromProofTimeId: 'sleep', throughProofTimeId: 'finish'},
        ],
        subjectSafeBand: {x: 0, y: 0.5, width: 1, height: 0.3},
        markerNodeIds: includeMarker ? ['start-flag'] : [],
      },
    },
    nodes: [
      {
        id: 'world', kind: 'group', pattern: 'looping-environment', z: 0,
        coordinateSpace: {width: 100, height: 100}, transform: transform({x: 0, y: 0, width: 1, height: 1}), motion: still(),
        loopingEnvironment: {}, children: ['far', 'mid', 'ground', 'near'].map(strip),
      },
      stateNode('hare', 0.1),
      {...stateNode('turtle', 0.02), motion: {keyframes: [{at: 0, offsetX: 0}, {at: 1, offsetX: 0.08}]}},
      {id: 'start-flag', kind: 'shape', shape: 'rectangle', style: {fill: '#cc0000', stroke: '#000000', strokeWidth: 1, radius: 0}, z: 3, transform: transform({x: 0.01, y: 0.55, width: 0.05, height: 0.12}), motion: still()},
    ],
  },
  motion: {
    proofTimes: [
      {id: 'sleep', at: 0.1},
      {id: 'run', at: 0.5},
      {id: 'finish', at: 0.9},
    ],
  },
});

const project = () => ({
  scenes: [scene({id: 'scene-01'}), scene({id: 'scene-02'})],
  worlds: [{
    id: 'forest-track', sceneIds: ['scene-01', 'scene-02'], requiredStripRoles: ['far', 'mid', 'ground', 'near'],
    stripSources: ['far', 'mid', 'ground', 'near'].map((role) => ({role, sourceAssetId: `forest-${role}-source`})),
  }],
  trajectoryContracts: [{
    id: 'race-order',
    assertions: [
      {id: 'hare-sleeps', kind: 'state-at', sceneId: 'scene-01', proofTimeId: 'sleep', nodeId: 'hare', stateId: 'sleep'},
      {id: 'hare-runs', kind: 'state-at', sceneId: 'scene-01', proofTimeId: 'run', nodeId: 'hare', stateId: 'run-a'},
      {id: 'hare-leads', kind: 'relative-order', sceneId: 'scene-01', proofTimeId: 'run', leadingNodeId: 'hare', trailingNodeId: 'turtle', leadingSide: 'right', minimumGap: 0.08},
      {id: 'hare-travels', kind: 'travel', sceneId: 'scene-01', proofTimeId: 'finish', nodeId: 'hare', fromProofTimeId: 'run', toProofTimeId: 'finish', direction: 'right', minimumDelta: 0.1},
    ],
    sequence: ['hare-sleeps', 'hare-runs', 'hare-leads', 'hare-travels'],
  }],
});

test('world contracts require continuous depth layers, a route-safe band and grounded markers', () => {
  const valid = project();
  assert.deepEqual(validateWorldContracts(valid), []);
  const missingLayer = project();
  missingLayer.scenes[1].composition.nodes[0].children = missingLayer.scenes[1].composition.nodes[0].children.filter(({role}) => role !== 'near');
  assert.ok(validateWorldContracts(missingLayer).some(({code}) => code === 'world-contract-strip-role'));
  const floating = project();
  floating.scenes[0].composition.nodes.find(({id}) => id === 'start-flag').transform.y = 0.1;
  assert.ok(validateWorldContracts(floating).some(({code}) => code === 'world-route-marker-floating'));
  const sourceDrift = project();
  sourceDrift.scenes[1].composition.nodes[0].children.find(({role}) => role === 'near').loopingStripBinding.sourceAssetId = 'other-near-source';
  assert.ok(validateWorldContracts(sourceDrift).some(({code}) => code === 'world-contract-strip-source'));
});

test('route travelers can leave after their declared safe-band proof window', () => {
  const exiting = project();
  const scene = exiting.scenes[0];
  scene.motion.proofTimes.push({id: 'exit', at: 0.95});
  scene.composition.world.route.travelers.find(({nodeId}) => nodeId === 'turtle').throughProofTimeId = 'run';
  scene.composition.nodes.find(({id}) => id === 'turtle').motion = {
    keyframes: [{at: 0, offsetX: 0}, {at: 0.5, offsetX: 0.08}, {at: 0.95, offsetX: 1.1}],
  };
  exiting.trajectoryContracts[0].assertions.push({id: 'turtle-exits', kind: 'offscreen-at', sceneId: 'scene-01', proofTimeId: 'exit', nodeId: 'turtle', side: 'right'});
  assert.deepEqual(validateWorldContracts(exiting), []);
  assert.deepEqual(validateTrajectoryContracts(exiting).filter(({code}) => code.startsWith('trajectory-offscreen')), []);
});

test('trajectory contracts prove state, speed/order, direction and narrative sequence', () => {
  const valid = project();
  assert.deepEqual(validateTrajectoryContracts(valid), []);
  const reverse = project();
  reverse.scenes[0].composition.nodes.find(({id}) => id === 'hare').motion = {keyframes: [{at: 0, offsetX: 0}, {at: 1, offsetX: -0.2}]};
  assert.ok(validateTrajectoryContracts(reverse).some(({code}) => code === 'trajectory-travel-distance'));
  const unordered = project();
  unordered.trajectoryContracts[0].sequence = ['hare-runs', 'hare-sleeps'];
  assert.ok(validateProductionContracts(unordered).some(({code}) => code === 'trajectory-sequence-order'));
  const monotonic = project();
  monotonic.trajectoryContracts[0].assertions.push({
    id: 'hare-never-backtracks', kind: 'monotonic-travel', sceneId: 'scene-01', proofTimeId: 'finish',
    nodeId: 'hare', fromProofTimeId: 'sleep', direction: 'right', minimumDelta: 0,
  });
  assert.deepEqual(validateTrajectoryContracts(monotonic).filter(({code}) => code.startsWith('trajectory-monotonic')), []);
  monotonic.scenes[0].composition.nodes.find(({id}) => id === 'hare').motion = {
    keyframes: [{at: 0, offsetX: 0}, {at: 0.4, offsetX: 0.3}, {at: 0.7, offsetX: 0.16}, {at: 1, offsetX: 0.44}],
  };
  assert.ok(validateTrajectoryContracts(monotonic).some(({code}) => code === 'trajectory-monotonic-backtrack'));
});
