import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {
  transactAssetManifest,
} from '../scripts/asset-manifest-lib.mjs';
import {
  validateEncounterAuthoring,
  validateEncounterExecution,
} from '../scripts/encounter-contract-lib.mjs';
import {
  inspectVerticalSeamSalience,
} from '../scripts/looping-strip-lib.mjs';
import {verifyOutputFile} from '../scripts/provider-lib.mjs';
import {
  assertWorldTopologyBinding,
  buildWorldTopologyProof,
} from '../scripts/world-topology-proof-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const manifestRecord = (assetId, suffix) => ({
  recordId: suffix.repeat(64),
  assetId,
  lifecycle: {
    status: 'active',
    changedAt: '2026-08-04T00:00:00.000Z',
    reason: 'fixture',
    supersededBy: null,
  },
});

test('asset manifest transactions preserve concurrent derivation records', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'manifest-transaction-'));
  try {
    const manifestFile = path.join(root, 'assets-manifest.json');
    await fs.writeFile(
      manifestFile,
      `${JSON.stringify({
        schemaVersion: 4,
        projectSlug: 'atomic-test',
        assets: [],
      })}\n`,
    );
    await Promise.all([
      transactAssetManifest({
        manifestFile,
        projectSlug: 'atomic-test',
        mutate: async (manifest) => {
          await new Promise((resolve) => setTimeout(resolve, 30));
          manifest.assets.push(manifestRecord('first', 'a'));
          return manifest;
        },
      }),
      transactAssetManifest({
        manifestFile,
        projectSlug: 'atomic-test',
        mutate: async (manifest) => {
          manifest.assets.push(manifestRecord('second', 'b'));
          return manifest;
        },
      }),
    ]);
    const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
    assert.deepEqual(
      manifest.assets.map(({assetId}) => assetId).sort(),
      ['first', 'second'],
    );
  } finally {
    await fs.rm(root, {recursive: true, force: true});
  }
});

test('provider-native image dimensions remain recordable with deterministic normalization provenance', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-native-'));
  try {
    const output = path.join(root, 'image.png');
    await sharp({
      create: {
        width: 1672,
        height: 941,
        channels: 3,
        background: '#94b7ad',
      },
    }).png().toFile(output);
    const request = {
      schemaVersion: 8,
      capability: 'image',
      compositionBinding: {
        canvas: {width: 1920, height: 1080},
      },
      outputSurface: {mode: 'opaque'},
      providerSource: {
        mode: 'provider-native',
        minimumWidth: 1600,
        minimumHeight: 900,
        aspectRatioTolerance: 0.002,
        normalization: {
          method: 'deterministic-resize',
          targetCanvas: {width: 1920, height: 1080},
        },
      },
    };
    const verified = await verifyOutputFile(output, request);
    assert.deepEqual(
      verified.providerSourceObservation.rawCanvas,
      {width: 1672, height: 941},
    );
    assert.equal(
      verified.providerSourceObservation.normalizationRequired,
      true,
    );
    const exactOnly = structuredClone(request);
    delete exactOnly.providerSource;
    await assert.rejects(
      verifyOutputFile(output, exactOnly),
      /与请求画布 1920x1080 不一致/,
    );
  } finally {
    await fs.rm(root, {recursive: true, force: true});
  }
});

test('provider-native normalization CLI preserves the raw source and records an exact zero-call derivative', async () => {
  const slug = `normalization-${process.pid}-${Date.now()}`;
  const projectDirectory = path.join(ROOT, 'projects', slug);
  const publicDirectory = path.join(ROOT, 'public', 'projects', slug);
  try {
    await fs.mkdir(projectDirectory, {recursive: true});
    await fs.mkdir(publicDirectory, {recursive: true});
    const sourceFile = path.join(publicDirectory, 'raw.png');
    await sharp({
      create: {
        width: 1672,
        height: 941,
        channels: 3,
        background: '#94b7ad',
      },
    }).png().toFile(sourceFile);
    const sourceBytes = await fs.readFile(sourceFile);
    const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
    const manifest = {
      $schema: '../../schemas/assets-manifest.schema.json',
      schemaVersion: 4,
      projectSlug: slug,
      assets: [{
        recordId: 'c'.repeat(64),
        assetId: 'raw-source',
        capability: 'image',
        file: path.relative(ROOT, sourceFile),
        provider: 'fixture-provider',
        adapter: 'manual',
        model: null,
        sha256: sourceSha256,
        media: {width: 1672, height: 941, format: 'png', hasAlpha: false},
        providerSource: {
          schemaVersion: 1,
          mode: 'provider-native',
          rawCanvas: {width: 1672, height: 941},
          targetCanvas: {width: 1920, height: 1080},
          normalization: 'deterministic-resize',
          normalizationRequired: true,
          observationFingerprint: 'd'.repeat(64),
        },
        compositionBinding: {canvas: {width: 1920, height: 1080}},
        lifecycle: {
          status: 'active',
          changedAt: '2026-08-04T00:00:00.000Z',
          reason: 'fixture provider root',
          supersededBy: null,
        },
      }],
    };
    await fs.writeFile(
      path.join(projectDirectory, 'assets-manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    const specFile = path.join(projectDirectory, 'normalization.json');
    await fs.writeFile(
      specFile,
      `${JSON.stringify({
        $schema: '../../schemas/provider-source-normalization.schema.json',
        schemaVersion: 1,
        projectSlug: slug,
        sourceAssetId: 'raw-source',
        assetId: 'normalized-source',
        output: path.relative(
          ROOT,
          path.join(publicDirectory, 'normalized.png'),
        ),
        kernel: 'lanczos3',
      }, null, 2)}\n`,
    );
    const command = spawnSync(
      process.execPath,
      [
        path.join(ROOT, 'scripts', 'normalize-provider-source.mjs'),
        `--spec=${path.relative(ROOT, specFile)}`,
      ],
      {cwd: ROOT, encoding: 'utf8'},
    );
    assert.equal(command.status, 0, command.stderr);
    const normalized = await sharp(
      path.join(publicDirectory, 'normalized.png'),
    ).metadata();
    assert.deepEqual(
      {width: normalized.width, height: normalized.height},
      {width: 1920, height: 1080},
    );
    assert.equal(
      createHash('sha256').update(await fs.readFile(sourceFile)).digest('hex'),
      sourceSha256,
    );
    const recorded = JSON.parse(
      await fs.readFile(
        path.join(projectDirectory, 'assets-manifest.json'),
        'utf8',
      ),
    );
    const derivative = recorded.assets.find(
      ({assetId}) => assetId === 'normalized-source',
    );
    assert.equal(derivative.adapter, 'provider-source-derivative');
    assert.equal(derivative.request.derivation, 'provider-source-normalization');
    assert.equal(derivative.lifecycle.status, 'active');
  } finally {
    await fs.rm(projectDirectory, {recursive: true, force: true});
    await fs.rm(publicDirectory, {recursive: true, force: true});
  }
});

test('seam salience rejects a repeated vertical rail even when edge pixels match', async () => {
  const width = 160;
  const height = 90;
  const clean = Buffer.alloc(width * height * 4);
  const rail = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const base = 118 + Math.round(8 * Math.sin(y / 9));
      const isRail = x < 4 || x >= width - 4;
      for (const target of [clean, rail]) {
        target[offset] = base;
        target[offset + 1] = base + 18;
        target[offset + 2] = base + 24;
        target[offset + 3] = 255;
      }
      if (isRail) {
        rail[offset] = 34;
        rail[offset + 1] = 42;
        rail[offset + 2] = 48;
      }
    }
  }
  const cleanPng = await sharp(clean, {
    raw: {width, height, channels: 4},
  }).png().toBuffer();
  const railPng = await sharp(rail, {
    raw: {width, height, channels: 4},
  }).png().toBuffer();
  assert.equal(
    (await inspectVerticalSeamSalience(cleanPng)).passed,
    true,
  );
  const inspection = await inspectVerticalSeamSalience(railPng);
  assert.equal(inspection.passed, false);
  assert.equal(inspection.seams[0].kind, 'tile-boundary');
  assert.ok(inspection.seams[0].verticalCoverage > 0.9);
});

const encounterScene = () => ({
  id: 'pond',
  proofTimes: [
    {id: 'p-enter', at: 0.1},
    {id: 'p-approach', at: 0.3},
    {id: 'p-answer', at: 0.5},
    {id: 'p-exit', at: 0.8},
  ],
  beats: [
    {id: 'duck-enter', at: 0.1, proofTimeId: 'p-enter'},
    {id: 'duck-approach', at: 0.3, proofTimeId: 'p-approach'},
    {id: 'duck-answer', at: 0.5, proofTimeId: 'p-answer'},
    {id: 'duck-exit', at: 0.8, proofTimeId: 'p-exit'},
  ],
  encounters: [{
    id: 'meet-duck',
    travelerNodeId: 'tadpoles',
    targetNodeId: 'duck',
    worldNodeId: 'pond-world',
    narrationCueId: 'cue-duck',
    phaseBeatIds: {
      enter: 'duck-enter',
      approach: 'duck-approach',
      answer: 'duck-answer',
      exit: 'duck-exit',
    },
    entryEdge: 'right',
    exitEdge: 'left',
    minimumTravelViewports: 1,
    cueToleranceSeconds: 0.08,
  }],
  compositionPlan: {
    loopingEnvironments: [{
      targetId: 'pond-world',
      direction: 'left',
      distanceViewports: 4,
      subjectBindings: [
        {
          nodeId: 'tadpoles',
          role: 'tracked',
          anchorMode: 'screen',
        },
        {
          nodeId: 'duck',
          role: 'participant',
          anchorMode: 'world',
        },
      ],
    }],
  },
});

const encounterEvents = () =>
  ['enter', 'approach', 'answer', 'exit'].map((phase, index) => ({
    id: `duck-${phase}`,
    beatId: `duck-${phase}`,
    at: [0.1, 0.3, 0.5, 0.8][index],
    targetId: 'duck',
    visual: {kind: 'hold', durationSeconds: 0.1},
    encounter: {
      contractId: 'meet-duck',
      phase,
      ...(phase === 'answer' ? {narrationCueId: 'cue-duck'} : {}),
    },
  }));

test('cue-bound encounter rejects the wrong animal and opacity teleport', () => {
  const storyboardScene = encounterScene();
  assert.deepEqual(validateEncounterAuthoring(storyboardScene), []);
  const scene = {
    encounters: storyboardScene.encounters,
    durationInFrames: 300,
    narration: {startSeconds: 0.5},
    events: encounterEvents(),
  };
  const nodesById = new Map([
    ['duck', {id: 'duck', visibility: {initial: 'visible'}}],
    ['goldfish', {id: 'goldfish', visibility: {initial: 'visible'}}],
  ]);
  const valid = validateEncounterExecution({
    scene,
    storyboardScene,
    nodesById,
    narrationTiming: {cues: [{id: 'cue-duck', atSeconds: 4.5}]},
    fps: 30,
  });
  assert.deepEqual(valid, []);
  assert.deepEqual(validateEncounterExecution({
    scene,
    storyboardScene,
    nodesById,
    narrationTiming: {cues: [{id: 'cue-duck', startSeconds: 4.5}]},
    fps: 30,
  }), []);
  const wrongAnimal = structuredClone(scene);
  wrongAnimal.events[2].targetId = 'goldfish';
  assert.ok(validateEncounterExecution({
    scene: wrongAnimal,
    storyboardScene,
    nodesById,
    narrationTiming: {cues: [{id: 'cue-duck', atSeconds: 4.5}]},
    fps: 30,
  }).some(({code}) => code === 'encounter-phase-event'));
  const opacityTeleport = structuredClone(scene);
  opacityTeleport.events.push({
    id: 'duck-hide',
    beatId: 'duck-exit',
    at: 0.81,
    targetId: 'duck',
    visual: {
      kind: 'visibility',
      action: 'hide',
      transition: 'cut',
      durationSeconds: 0,
    },
  });
  assert.ok(validateEncounterExecution({
    scene: opacityTeleport,
    storyboardScene,
    nodesById,
    narrationTiming: {cues: [{id: 'cue-duck', atSeconds: 4.5}]},
    fps: 30,
  }).some(({code}) => code === 'encounter-opacity-lifecycle'));
});

test('provider-free world topology proof gates stale or mismatched generation requests', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'world-topology-'));
  try {
    const scene = encounterScene();
    scene.compositionPlan.loopingEnvironments[0] = {
      ...scene.compositionPlan.loopingEnvironments[0],
      speedRange: {far: 0.2, near: 1.1},
      groundStripId: 'pond-ground',
      seamProofTimeIds: {
        before: 'p-enter',
        seam: 'p-answer',
        after: 'p-exit',
      },
      strips: [
        {
          id: 'pond-far',
          role: 'far',
          surfaceRole: 'backdrop',
          depth: -0.8,
        },
        {
          id: 'pond-mid',
          role: 'mid',
          surfaceRole: 'scenery',
          depth: -0.2,
        },
        {
          id: 'pond-ground',
          role: 'ground',
          surfaceRole: 'walkable-ground',
          depth: 0.4,
        },
        {
          id: 'pond-near',
          role: 'near',
          surfaceRole: 'foreground-occluder',
          depth: 0.9,
        },
      ],
    };
    const storyboard = {
      directingSummary: {fingerprint: 'a'.repeat(64)},
      scenes: [scene],
    };
    const report = await buildWorldTopologyProof({
      root,
      projectSlug: 'pond-proof',
      storyboard,
      generatedAt: '2026-08-04T00:00:00.000Z',
    });
    assert.equal(report.passed, true);
    const [world] = report.worlds;
    await fs.stat(path.join(root, world.evidence));
    const request = {
      projectSlug: 'pond-proof',
      compositionBinding: {
        sceneId: 'pond',
        nodeId: 'pond-world',
        pattern: 'looping-environment',
      },
      worldTopologyBinding: {
        schemaVersion: 1,
        proofId: world.proofId,
        fingerprint: world.fingerprint,
        stripId: 'pond-mid',
      },
    };
    assert.equal(
      assertWorldTopologyBinding({request, report, storyboard}).proofId,
      world.proofId,
    );
    const stale = structuredClone(request);
    stale.worldTopologyBinding.fingerprint = 'b'.repeat(64);
    assert.throws(
      () => assertWorldTopologyBinding({request: stale, report, storyboard}),
      /零调用世界拓扑证明/,
    );
  } finally {
    await fs.rm(root, {recursive: true, force: true});
  }
});
