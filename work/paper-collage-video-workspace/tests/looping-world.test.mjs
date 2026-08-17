import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import {validateCompositionStructure} from '../scripts/composition-lib.mjs';
import {
  deriveLoopingStrip,
  LOOPING_STRIP_RECOVERY_POLICY,
} from '../scripts/looping-strip-lib.mjs';
import {removeChromaKey} from '../scripts/chroma-key-lib.mjs';
import {validateTreatment} from '../scripts/motion-treatment-lib.mjs';
import {
  evaluateNearLayerRelation,
  inspectStripVisibleSurface,
} from '../scripts/world-motion-proof-lib.mjs';
import {
  inspectWorldStripCoverage,
  resolveWorldStripCopies,
  resolveWorldStripFrame,
  resolveWorldStripSpeedFactor,
  resolveWorldStripTileGeometry,
} from '../src/worldStrip.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const still = {keyframes: [{at: 0, offsetX: 0}, {at: 1, offsetX: 0}]};
const transform = (height = 1) => ({
  x: 0,
  y: 0,
  width: 1,
  height,
  anchorX: 0,
  anchorY: 0,
});

const binding = (id, role, width = 400, height = 100) => ({
  schemaVersion: 1,
  stripId: id,
  role,
  sourceAssetId: `${id}-source`,
  axis: 'x',
  seamStrategy: 'exact',
  source: {
    sha256: 'a'.repeat(64),
    width,
    height,
    provider: 'fixture',
    adapter: 'manual',
    recordId: 'b'.repeat(64),
  },
  canonicalTile: {left: 0, top: 0, width, height},
  output: {width, height, hasAlpha: false},
  minimumViewportSpan: 2,
  edgeBandPixels: 4,
  derivationFingerprint: 'c'.repeat(64),
});

test('world-strip phase wraps deterministically with gap-free internal copies', () => {
  const geometry = resolveWorldStripTileGeometry({
    viewportWidth: 1920,
    viewportHeight: 1080,
    renderHeight: 720,
    sourceWidth: 3840,
    sourceHeight: 720,
    overscanPx: 2,
  });
  assert.equal(geometry.viewportSpan, 2);
  const speed = resolveWorldStripSpeedFactor({depth: 0.5, far: 0.2, near: 1.2});
  assert.equal(speed, 0.95);
  const start = resolveWorldStripFrame({
    progress: 0,
    viewportWidth: 1920,
    tileWidth: geometry.tileWidth,
    direction: 'left',
    distanceViewports: 18,
    speedFactor: speed,
    startPhase: 0.1,
  });
  const end = resolveWorldStripFrame({
    progress: 1,
    viewportWidth: 1920,
    tileWidth: geometry.tileWidth,
    direction: 'left',
    distanceViewports: 18,
    speedFactor: speed,
    startPhase: 0.1,
  });
  assert.ok(end.wraps >= 8);
  assert.ok(end.cameraCompensatedDisplacement < start.cameraCompensatedDisplacement);
  const rasterCopies = resolveWorldStripCopies({
    firstCopyX: 0.25,
    tileWidth: geometry.tileWidth,
    copyCount: geometry.copyCount,
  });
  assert.equal(rasterCopies[0].width, geometry.tileWidth + 2);
  assert.equal(
    rasterCopies[1].x,
    rasterCopies[0].x + geometry.tileWidth,
    'raster overlap must not change logical world phase',
  );
  for (let index = 0; index <= 100; index += 1) {
    const frame = resolveWorldStripFrame({
      progress: index / 100,
      viewportWidth: 1920,
      tileWidth: geometry.tileWidth,
      direction: 'left',
      distanceViewports: 18,
      speedFactor: speed,
      startPhase: 0.1,
    });
    const coverage = inspectWorldStripCoverage({
      copies: resolveWorldStripCopies({
        firstCopyX: frame.firstCopyX,
        tileWidth: geometry.tileWidth,
        copyCount: geometry.copyCount,
      }),
      viewportWidth: 1920,
    });
    assert.equal(coverage.uncoveredPixels, 0);
    for (const cameraOffset of [-64, -16, 0, 16, 64]) {
      const cameraFrame = resolveWorldStripFrame({
        progress: index / 100,
        viewportWidth: 1920,
        tileWidth: geometry.tileWidth,
        direction: 'left',
        distanceViewports: 18,
        speedFactor: speed,
        startPhase: 0.1,
        phaseOffsetPx: cameraOffset,
      });
      const cameraCoverage = inspectWorldStripCoverage({
        copies: resolveWorldStripCopies({
          firstCopyX: cameraFrame.firstCopyX,
          tileWidth: geometry.tileWidth,
          copyCount: geometry.copyCount,
        }),
        viewportWidth: 1920,
      });
      assert.equal(cameraCoverage.uncoveredPixels, 0);
    }
  }
});

test('world-strip holds its phase before activeFrom and completes authored travel afterwards', () => {
  const base = {
    viewportWidth: 1920,
    tileWidth: 1920,
    direction: 'left',
    distanceViewports: 4,
    speedFactor: 1,
    startPhase: 0.25,
    activeFrom: 0.25,
  };
  const hold = resolveWorldStripFrame({...base, progress: 0.2});
  const cue = resolveWorldStripFrame({...base, progress: 0.25});
  const halfway = resolveWorldStripFrame({...base, progress: 0.625});
  const end = resolveWorldStripFrame({...base, progress: 1});
  assert.equal(hold.travelProgress, 0);
  assert.equal(cue.travelProgress, 0);
  assert.equal(hold.cameraCompensatedDisplacement, 0);
  assert.equal(halfway.travelProgress, 0.5);
  assert.equal(end.travelProgress, 1);
  assert.equal(end.cameraCompensatedDisplacement, -4 * 1920);
});

test('world-strip eases to and permanently holds its completed phase after activeUntil', () => {
  const base = {
    viewportWidth: 1920,
    tileWidth: 1920,
    direction: 'left',
    distanceViewports: 2,
    speedFactor: 1,
    startPhase: 0.1,
    activeFrom: 0.2,
    activeUntil: 0.6,
    easing: 'ease-out',
  };
  const before = resolveWorldStripFrame({...base, progress: 0.15});
  const midway = resolveWorldStripFrame({...base, progress: 0.4});
  const lock = resolveWorldStripFrame({...base, progress: 0.6});
  const late = resolveWorldStripFrame({...base, progress: 0.95});
  assert.equal(before.travelProgress, 0);
  assert.ok(midway.travelProgress > 0.5, 'ease-out should cover more than half the route halfway through its active window');
  assert.equal(lock.travelProgress, 1);
  assert.equal(late.travelProgress, 1);
  assert.equal(late.phase, lock.phase);
  assert.equal(late.cameraCompensatedDisplacement, lock.cameraCompensatedDisplacement);
});

test('looping-environment validates semantic strips, tracked subject, seam proofs, and monotonic depth speed', () => {
  const strips = [
    {id: 'mountains', role: 'far', surfaceRole: 'backdrop', depth: -0.8, z: 0},
    {id: 'trees', role: 'mid', surfaceRole: 'scenery', depth: -0.1, z: 1},
    {id: 'road', role: 'ground', surfaceRole: 'walkable-ground', depth: 0.55, z: 2},
  ].map((strip) => ({
    ...strip,
    kind: 'world-strip',
    src: `${strip.id}.png`,
    loopingStripBinding: binding(strip.id, strip.role),
    transform: transform(),
    motion: still,
  }));
  const composition = {
    coordinateSpace: {width: 200, height: 100},
    nodes: [
      {
        id: 'road-world',
        kind: 'group',
        pattern: 'looping-environment',
        z: 0,
        coordinateSpace: {width: 200, height: 100},
        transform: transform(),
        motion: still,
        loopingEnvironment: {
          axis: 'x',
          groundStripId: 'road',
          subjectBindings: [{
            nodeId: 'car',
            role: 'tracked',
            anchorMode: 'screen',
            nearOcclusion: 'above-near',
            proofTimeIds: ['before', 'seam', 'after'],
          }, {
            nodeId: 'finish-marker',
            role: 'participant',
            anchorMode: 'world',
            nearOcclusion: 'above-near',
            proofTimeIds: ['before', 'seam'],
          }],
          seamProofTimeIds: {before: 'before', seam: 'seam', after: 'after'},
          travel: {
            direction: 'left',
            distanceViewports: 8,
            closedLoop: false,
            startPhase: 0.1,
            activeFrom: 0.2,
            activeUntil: 0.8,
            easing: 'ease-out',
          },
          speedRange: {far: 0.2, near: 1.2},
          overscanPx: 2,
        },
        children: [
          ...strips,
          {
            id: 'car',
            kind: 'asset',
            assetRole: 'character',
            src: 'car.png',
            z: 4,
            depth: 0.25,
            transform: {x: 0.5, y: 0.72, width: 0.3, height: 0.2, anchorX: 0.5, anchorY: 1},
            motion: still,
          },
          {
            id: 'finish-marker',
            kind: 'group',
            pattern: 'free',
            z: 5,
            coordinateSpace: {width: 100, height: 100},
            transform: {x: 0.8, y: 0.72, width: 0.08, height: 0.2, anchorX: 0.5, anchorY: 1},
            motion: still,
            children: [
              {
                id: 'finish-support',
                kind: 'asset',
                assetRole: 'prop',
                src: 'finish-support.png',
                z: 0,
                transform: transform(),
                motion: still,
              },
              {
                id: 'finish-sign',
                kind: 'asset',
                assetRole: 'prop',
                src: 'finish-marker.png',
                z: 1,
                transform: transform(),
                motion: still,
              },
            ],
          },
        ],
      },
    ],
  };
  const result = validateCompositionStructure({
    composition,
    video: {width: 200, height: 100},
    proofTimes: [
      {id: 'before', at: 0.2, stateAssertions: []},
      {id: 'seam', at: 0.5, stateAssertions: []},
      {id: 'after', at: 0.8, stateAssertions: []},
    ],
  });
  assert.deepEqual(result.issues.filter(({level}) => level === 'error'), []);
  const missingParticipant = structuredClone(composition);
  missingParticipant.nodes[0].children = missingParticipant.nodes[0].children.filter(
    ({id}) => id !== 'finish-marker',
  );
  assert.ok(
    validateCompositionStructure({
      composition: missingParticipant,
      video: {width: 200, height: 100},
      proofTimes: [
        {id: 'before', at: 0.2, stateAssertions: []},
        {id: 'seam', at: 0.5, stateAssertions: []},
        {id: 'after', at: 0.8, stateAssertions: []},
      ],
    }).issues.some(({code}) => code === 'composition-looping-members'),
  );
  const invalidCue = structuredClone(composition);
  invalidCue.nodes[0].loopingEnvironment.travel.activeFrom = 1;
  const invalidCueResult = validateCompositionStructure({
    composition: invalidCue,
    video: {width: 200, height: 100},
    proofTimes: [
      {id: 'before', at: 0.2, stateAssertions: []},
      {id: 'seam', at: 0.5, stateAssertions: []},
      {id: 'after', at: 0.8, stateAssertions: []},
    ],
  });
  assert.ok(
    invalidCueResult.issues.some(({code}) => code === 'composition-looping-travel'),
  );
  const invalidLock = structuredClone(composition);
  invalidLock.nodes[0].loopingEnvironment.travel.activeUntil = 0.1;
  assert.ok(
    validateCompositionStructure({
      composition: invalidLock,
      video: {width: 200, height: 100},
      proofTimes: [
        {id: 'before', at: 0.2, stateAssertions: []},
        {id: 'seam', at: 0.5, stateAssertions: []},
        {id: 'after', at: 0.8, stateAssertions: []},
      ],
    }).issues.some(({code}) => code === 'composition-looping-travel'),
  );
  const frozen = structuredClone(composition);
  delete frozen.nodes[0].loopingEnvironment.travel.activeFrom;
  delete frozen.nodes[0].loopingEnvironment.travel.activeUntil;
  frozen.nodes[0].loopingEnvironment.travel.frozen = true;
  assert.deepEqual(
    validateCompositionStructure({
      composition: frozen,
      video: {width: 200, height: 100},
      proofTimes: [
        {id: 'before', at: 0.2, stateAssertions: []},
        {id: 'seam', at: 0.5, stateAssertions: []},
        {id: 'after', at: 0.8, stateAssertions: []},
      ],
    }).issues.filter(({level}) => level === 'error'),
    [],
  );
  frozen.nodes[0].loopingEnvironment.travel.activeFrom = 0.2;
  assert.ok(
    validateCompositionStructure({
      composition: frozen,
      video: {width: 200, height: 100},
      proofTimes: [
        {id: 'before', at: 0.2, stateAssertions: []},
        {id: 'seam', at: 0.5, stateAssertions: []},
        {id: 'after', at: 0.8, stateAssertions: []},
      ],
    }).issues.some(({code}) => code === 'composition-looping-travel'),
  );
  const invalid = structuredClone(composition);
  invalid.nodes[0].children[2].depth = -0.2;
  const invalidResult = validateCompositionStructure({
    composition: invalid,
    video: {width: 200, height: 100},
    proofTimes: [
      {id: 'before', at: 0.2, stateAssertions: []},
      {id: 'seam', at: 0.5, stateAssertions: []},
      {id: 'after', at: 0.8, stateAssertions: []},
    ],
  });
  assert.ok(
    invalidResult.issues.some(({code}) => code === 'composition-looping-depth-order'),
  );
});

test('sparse near layers may prove depth order without forcing subject overlap', () => {
  const base = {
    nearOcclusion: 'behind-near',
    subjectZ: 60,
    nearStripZ: 90,
    verticalOverlap: 0,
    hasSubjectGeometry: true,
    hasNearGeometry: true,
  };
  assert.equal(
    evaluateNearLayerRelation({...base, requireNearOverlap: true}),
    false,
  );
  assert.equal(
    evaluateNearLayerRelation({...base, requireNearOverlap: false}),
    true,
  );
  assert.equal(
    evaluateNearLayerRelation({
      ...base,
      requireNearOverlap: false,
      nearStripZ: 40,
    }),
    false,
    'optional overlap must not weaken declared z-order',
  );
});

test('world-travel authoring compiles only through looping-environment and scroll-world-x', () => {
  const treatment = {
    id: 'road-travel',
    targetId: 'road-world',
    importance: 'hero',
    necessity: 'required',
    changeClass: 'world-travel',
    motion: {kind: 'continuous-transform', preset: 'scroll-world-x'},
    composition: {
      pattern: 'looping-environment',
      world: {
        axis: 'x',
        direction: 'left',
        distanceViewports: 8,
        speedRange: {far: 0.2, near: 1.2},
        groundStripId: 'road',
        subjectBindings: [{
          nodeId: 'car',
          role: 'tracked',
          anchorMode: 'screen',
          nearOcclusion: 'above-near',
          requireNearOverlap: false,
          proofTimeIds: ['proof-before', 'proof-seam', 'proof-after'],
        }],
        seamProofTimeIds: {before: 'proof-before', seam: 'proof-seam', after: 'proof-after'},
        closedLoop: false,
        startPhase: 0.1,
        activeFrom: 0.2,
        activeUntil: 0.8,
        easing: 'ease-out',
        strips: [
          {id: 'mountains', role: 'far', surfaceRole: 'backdrop', depth: -0.8},
          {id: 'trees', role: 'mid', surfaceRole: 'scenery', depth: -0.1},
          {id: 'road', role: 'ground', surfaceRole: 'walkable-ground', depth: 0.55},
        ],
      },
    },
    graphic: null,
    semanticRisk: 'decorative',
    proofTimeId: 'proof-seam',
    rationale: 'The tracked car stays readable while a proved world passes behind it.',
  };
  assert.deepEqual(validateTreatment(treatment, {beatAt: 0.5}), []);
  const invalidOverlap = structuredClone(treatment);
  invalidOverlap.composition.world.subjectBindings[0].requireNearOverlap = 'no';
  assert.ok(
    validateTreatment(invalidOverlap, {beatAt: 0.5})
      .some(({code}) => code === 'treatment-looping-subject-overlap'),
  );
  const wrong = structuredClone(treatment);
  wrong.motion.preset = 'drift';
  assert.ok(
    validateTreatment(wrong, {beatAt: 0.5})
      .some(({code}) => code === 'treatment-looping-preset'),
  );
});

test('sparse scenery strips use a semantic span threshold while backdrops stay continuous', async () => {
  const source = 'fixtures/looping-world/sparse-scenery.svg';
  const scenery = await inspectStripVisibleSurface({
    source,
    role: 'mid',
    surfaceRole: 'scenery',
  });
  const backdrop = await inspectStripVisibleSurface({
    source,
    role: 'far',
    surfaceRole: 'backdrop',
  });
  assert.equal(scenery.passed, true);
  assert.equal(
    scenery.thresholds.minimumHorizontalVisibleSpanRatio,
    0.25,
  );
  assert.equal(backdrop.passed, false);
  assert.equal(
    backdrop.thresholds.minimumHorizontalVisibleSpanRatio,
    0.85,
  );
});

test('looping strip derivation accepts a recovery source and proves source/render seams at three ratios', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'looping-strip-test-'));
  try {
    const publicDirectory = path.join(root, 'public');
    await fs.mkdir(publicDirectory, {recursive: true});
    const width = 400;
    const height = 100;
    const pixels = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const seamX = x >= width - 4 ? x - (width - 4) : x;
        const wave = Math.sin((seamX / (width - 4)) * Math.PI * 2);
        const offset = (y * width + x) * 4;
        pixels[offset] = Math.round(128 + wave * 34 + (y % 9));
        pixels[offset + 1] = Math.round(142 + wave * 26 + (y % 7));
        pixels[offset + 2] = (y * 5 + 90) % 255;
        pixels[offset + 3] = 255;
      }
    }
    const sourceFile = path.join(publicDirectory, 'source.png');
    await sharp(pixels, {raw: {width, height, channels: 4}}).png().toFile(sourceFile);
    const sourceBytes = await fs.readFile(sourceFile);
    const sourceSha = hash(sourceBytes);
    const sourceRecord = {
      recordId: 'd'.repeat(64),
      assetId: 'mountain-source',
      capability: 'image',
      file: 'public/source.png',
      provider: 'local-fixture',
      adapter: 'manual',
      tool: null,
      model: null,
      externalId: null,
      attemptId: null,
      requestFingerprint: 'e'.repeat(64),
      reusedFrom: null,
      sha256: sourceSha,
      sizeBytes: sourceBytes.length,
      media: {width, height, format: 'png', hasAlpha: true},
      recordedAt: '2026-07-24T00:00:00.000Z',
      request: {},
      compositionBinding: null,
      familyFingerprint: null,
      lifecycle: {
        status: 'recovery-source',
        changedAt: '2026-07-24T00:00:00.000Z',
        reason: 'fixture observed provider-native color plane',
        supersededBy: null,
      },
    };
    const manifest = {
      schemaVersion: 4,
      projectSlug: 'looping-test',
      assets: [sourceRecord],
    };
    const spec = {
      schemaVersion: 1,
      projectSlug: 'looping-test',
      sceneId: 'scene-01',
      groupId: 'road-world',
      nodeId: 'mountains',
      stripId: 'mountains',
      assetId: 'mountains-loop',
      role: 'far',
      sourceAssetId: 'mountain-source',
      output: 'public/mountains-loop.png',
      axis: 'x',
      seamStrategy: 'exact',
      canonicalTile: {left: 0, top: 0, width, height},
      edgeBandPixels: 4,
      thresholds: {
        rgbMean: 0,
        rgbMaximum: 0,
        alphaMean: 0,
        alphaMaximum: 0,
      },
      minimumViewportSpan: 2,
      proofViewports: [
        {profile: '16:9', width: 200, height: 100, renderHeight: 100},
        {profile: '9:16', width: 100, height: 200, renderHeight: 100},
        {profile: '1:1', width: 100, height: 100, renderHeight: 100},
      ],
      recoveryPolicy: LOOPING_STRIP_RECOVERY_POLICY,
      applyToProject: false,
    };
    const result = await deriveLoopingStrip({root, spec, manifest});
    assert.equal(result.report.passed, true);
    assert.equal(result.report.providerImageCalls, 0);
    assert.equal(result.report.localDerivatives, 1);
    assert.equal(result.record.adapter, 'looping-strip-derivative');
    assert.equal(result.binding.source.recordId, sourceRecord.recordId);
    assert.equal(result.binding.minimumViewportSpan, 2);
    assert.ok(await fs.stat(path.join(root, result.report.evidence.stitchFile)));
  } finally {
    await fs.rm(root, {recursive: true, force: true});
  }
});

test('ground strips reject matching transparent presentation margins and mirror-crop a continuous paper road deterministically', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'looping-ground-edge-test-'));
  try {
    const publicDirectory = path.join(root, 'public');
    await fs.mkdir(publicDirectory, {recursive: true});
    const width = 400;
    const height = 100;
    const pixels = Buffer.alloc(width * height * 4);
    for (let y = 42; y < 82; y += 1) {
      for (let x = 56; x < 344; x += 1) {
        const offset = (y * width + x) * 4;
        pixels[offset] = 190;
        pixels[offset + 1] = 135;
        pixels[offset + 2] = 70;
        pixels[offset + 3] = 255;
      }
    }
    const sourceFile = path.join(publicDirectory, 'road-source.png');
    await sharp(pixels, {raw: {width, height, channels: 4}}).png().toFile(sourceFile);
    const sourceBytes = await fs.readFile(sourceFile);
    const sourceRecord = {
      recordId: 'h'.repeat(64),
      assetId: 'road-source',
      capability: 'image',
      file: 'public/road-source.png',
      provider: 'local-fixture',
      adapter: 'manual',
      tool: null,
      model: null,
      externalId: null,
      attemptId: null,
      requestFingerprint: 'i'.repeat(64),
      reusedFrom: null,
      sha256: hash(sourceBytes),
      sizeBytes: sourceBytes.length,
      media: {width, height, format: 'png', hasAlpha: true},
      recordedAt: '2026-07-24T00:00:00.000Z',
      request: {},
      compositionBinding: null,
      familyFingerprint: null,
      lifecycle: {
        status: 'active',
        changedAt: '2026-07-24T00:00:00.000Z',
        reason: 'fixture',
        supersededBy: null,
      },
    };
    const base = {
      schemaVersion: 1,
      projectSlug: 'looping-test',
      sceneId: 'scene-01',
      groupId: 'road-world',
      nodeId: 'road',
      stripId: 'road',
      assetId: 'road-loop',
      role: 'ground',
      sourceAssetId: 'road-source',
      output: 'public/road-loop.png',
      axis: 'x',
      edgeBandPixels: 4,
      thresholds: {rgbMean: 0, rgbMaximum: 0, alphaMean: 0, alphaMaximum: 0},
      minimumViewportSpan: 1,
      proofViewports: [
        {profile: '16:9', width: 200, height: 100, renderHeight: 100},
        {profile: '9:16', width: 100, height: 200, renderHeight: 100},
        {profile: '1:1', width: 100, height: 100, renderHeight: 100},
      ],
      recoveryPolicy: LOOPING_STRIP_RECOVERY_POLICY,
      applyToProject: false,
    };
    const manifest = {schemaVersion: 4, projectSlug: 'looping-test', assets: [sourceRecord]};
    await assert.rejects(
      deriveLoopingStrip({
        root,
        manifest,
        spec: {...base, seamStrategy: 'exact', canonicalTile: {left: 0, top: 0, width, height}},
      }),
      /ground edge alpha coverage/,
    );
    const result = await deriveLoopingStrip({
      root,
      manifest,
      spec: {
        ...base,
        seamStrategy: 'mirror-crop',
        canonicalTile: {left: 100, top: 0, width: 200, height},
        alphaFeather: {topPixels: 20, bottomPixels: 0},
      },
    });
    assert.equal(result.report.passed, true);
    assert.equal(result.report.seamStrategy, 'mirror-crop');
    assert.ok(result.report.sourceEdgeAlphaCoverage.minimum >= 0.05);
    assert.equal(result.binding.output.width, 400);
    assert.deepEqual(result.binding.alphaFeather, {topPixels: 20, bottomPixels: 0});
    assert.deepEqual(result.report.alphaFeather, {topPixels: 20, bottomPixels: 0});
    const alpha = await sharp(path.join(root, 'public', 'road-loop.png'))
      .ensureAlpha()
      .extractChannel(3)
      .raw()
      .toBuffer();
    assert.equal(alpha[0], 0);
    assert.equal(alpha[50 * 400], 255);
  } finally {
    await fs.rm(root, {recursive: true, force: true});
  }
});

test('chroma key treats darkened key-plane shadows as transparent without erasing warm artwork or black ink', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'key-plane-shadow-test-'));
  try {
    const input = path.join(root, 'key-plane.png');
    const pixels = Buffer.from([
      248, 3, 239,
      124, 2, 120,
      220, 90, 60,
      8, 8, 8,
    ]);
    await sharp(pixels, {raw: {width: 4, height: 1, channels: 3}})
      .png()
      .toFile(input);
    const {buffer, metadata} = await removeChromaKey({
      input,
      keyColor: '#f803ef',
      transparentThreshold: 20,
      opaqueThreshold: 120,
      edgeFeather: 0,
      matteErode: 0,
      edgePadding: 0,
    });
    const rgba = await sharp(buffer).ensureAlpha().raw().toBuffer();
    assert.equal(rgba[3], 0);
    assert.equal(rgba[7], 0);
    assert.ok(rgba[11] >= 250, `warm artwork alpha was damaged: ${rgba[11]}`);
    assert.ok(rgba[15] >= 250, `black ink alpha was damaged: ${rgba[15]}`);
    assert.equal(metadata.distanceMetric, 'key-ray-with-darkness-floor-v1');
  } finally {
    await fs.rm(root, {recursive: true, force: true});
  }
});

test('looping strip derives a real alpha tile from an explicitly proven chroma-key source', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'looping-strip-chroma-test-'));
  try {
    const publicDirectory = path.join(root, 'public');
    await fs.mkdir(publicDirectory, {recursive: true});
    const width = 400;
    const height = 100;
    const pixels = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        const tree = x >= 120 && x < 280 && y >= 24;
        pixels[offset] = tree ? 70 : 255;
        pixels[offset + 1] = tree ? 112 : 0;
        pixels[offset + 2] = tree ? 78 : 255;
        pixels[offset + 3] = 255;
      }
    }
    const sourceFile = path.join(publicDirectory, 'tree-source.png');
    await sharp(pixels, {raw: {width, height, channels: 4}}).png().toFile(sourceFile);
    const sourceBytes = await fs.readFile(sourceFile);
    const sourceRecord = {
      recordId: 'f'.repeat(64),
      assetId: 'tree-source',
      capability: 'image',
      file: 'public/tree-source.png',
      provider: 'host-image',
      adapter: 'host',
      tool: null,
      model: null,
      externalId: null,
      attemptId: 'img-fixture',
      requestFingerprint: 'g'.repeat(64),
      reusedFrom: null,
      sha256: hash(sourceBytes),
      sizeBytes: sourceBytes.length,
      media: {width, height, format: 'png', hasAlpha: false},
      recordedAt: '2026-07-24T00:00:00.000Z',
      request: {outputSurface: {mode: 'chroma-key', keyColor: '#ff00ff', tolerance: 24}},
      compositionBinding: null,
      familyFingerprint: null,
      lifecycle: {
        status: 'active',
        changedAt: '2026-07-24T00:00:00.000Z',
        reason: 'fixture',
        supersededBy: null,
      },
    };
    const spec = {
      schemaVersion: 1,
      projectSlug: 'looping-test',
      sceneId: 'scene-01',
      groupId: 'road-world',
      nodeId: 'trees',
      stripId: 'trees',
      assetId: 'trees-loop',
      role: 'mid',
      sourceAssetId: 'tree-source',
      output: 'public/trees-loop.png',
      axis: 'x',
      seamStrategy: 'exact',
      canonicalTile: {left: 0, top: 0, width, height},
      edgeBandPixels: 4,
      thresholds: {
        rgbMean: 0,
        rgbMaximum: 0,
        alphaMean: 0,
        alphaMaximum: 0,
      },
      minimumViewportSpan: 2,
      proofViewports: [
        {profile: '16:9', width: 200, height: 100, renderHeight: 100},
        {profile: '9:16', width: 100, height: 200, renderHeight: 100},
        {profile: '1:1', width: 100, height: 100, renderHeight: 100},
      ],
      recoveryPolicy: LOOPING_STRIP_RECOVERY_POLICY,
      sourceSurface: {mode: 'chroma-key', keyColor: '#ff00ff'},
      keying: {
        keyColor: '#ff00ff',
        transparentThreshold: 18,
        opaqueThreshold: 95,
        edgeFeather: 0.6,
        matteErode: 1,
        edgePadding: 6,
      },
      applyToProject: false,
    };
    const result = await deriveLoopingStrip({
      root,
      spec,
      manifest: {schemaVersion: 4, projectSlug: 'looping-test', assets: [sourceRecord]},
    });
    assert.equal(result.record.media.hasAlpha, true);
    assert.equal(result.binding.source.surface.mode, 'chroma-key');
    assert.equal(result.report.sourceSurface.mode, 'chroma-key');
    assert.match(result.binding.source.keyingMetadataSha256, /^[a-f0-9]{64}$/);
    assert.equal(
      await fs.stat(path.join(root, 'public', 'trees-loop.png.key.json')).then(() => true),
      true,
    );
    const alpha = await sharp(path.join(root, 'public', 'trees-loop.png'))
      .ensureAlpha()
      .extractChannel(3)
      .raw()
      .toBuffer();
    assert.ok(alpha.some((value) => value === 0));
    assert.ok(alpha.some((value) => value === 255));
  } finally {
    await fs.rm(root, {recursive: true, force: true});
  }
});
