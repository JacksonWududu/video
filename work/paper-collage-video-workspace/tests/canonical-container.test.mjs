import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import {
  applyCanonicalContainerToProject,
  buildCanonicalContainerProof,
  deriveCanonicalContainer,
  inspectCanonicalContainerGroupMembers,
  validateCanonicalContainerSpec,
} from '../scripts/canonical-container-lib.mjs';
import {
  canonicalContainerPackageBindingMatchesPlan,
  CANONICAL_CONTAINER_RECOVERY_POLICY,
  CANONICAL_CONTAINER_SOURCE_STRATEGY,
  compileCanonicalContainerPlan,
  validateCanonicalContainerIntent,
} from '../scripts/container-source-plan-lib.mjs';
import {validateCompositionStructure} from '../scripts/composition-lib.mjs';
import {
  CANONICAL_CONTAINER_PROMPT_DIRECTIVES,
  validateAssetRequest,
  verifyOutputFile,
} from '../scripts/provider-lib.mjs';
import {
  assertCanonicalContainerStyleProof,
} from '../scripts/style-proof-lib.mjs';

const sha256File = async (file) =>
  createHash('sha256').update(await fs.readFile(file)).digest('hex');

const stillMotion = () => ({
  keyframes: [
    {at: 0, opacity: 1},
    {at: 1, opacity: 1},
  ],
  idle: {
    preset: 'still',
    intensity: 0,
    cycleSeconds: 1,
  },
});

const fullTransform = () => ({
  x: 0,
  y: 0,
  width: 1,
  height: 1,
  anchorX: 0,
  anchorY: 0,
});

const sourceRecord = async ({
  root,
  assetId,
  file,
  index,
  canvas,
  outputRole,
}) => {
  const absolute = path.join(root, file);
  const metadata = await sharp(absolute).metadata();
  return {
    recordId: String(index).padStart(64, '0'),
    assetId,
    capability: 'image',
    file,
    provider: 'fixture',
    adapter: 'manual',
    tool: 'fixture',
    model: null,
    externalId: null,
    attemptId: null,
    requestFingerprint: String(index + 100).padStart(64, '0'),
    reusedFrom: null,
    sha256: await sha256File(absolute),
    sizeBytes: (await fs.stat(absolute)).size,
    media: {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      hasAlpha: metadata.hasAlpha === true,
    },
    recordedAt: '2026-07-30T00:00:00.000Z',
    request: {},
    compositionBinding: {
      sceneId: 'scene-container',
      nodeId: 'vessel-rig',
      pattern: 'canonical-container',
      registrationId: 'vessel-registration',
      sourceMasterAssetId: 'vessel-master',
      outputRole,
      canvas,
      derivation: {
        method: 'manual-import',
      },
    },
    familyFingerprint: null,
    lifecycle: {
      status: 'active',
      changedAt: '2026-07-30T00:00:00.000Z',
      reason: 'fixture',
      supersededBy: null,
    },
  };
};

const createFixture = async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'canonical-container-'),
  );
  const projectSlug = 'canonical-container-proof';
  const publicDirectory = path.join(
    root,
    'public',
    'projects',
    projectSlug,
  );
  await fs.mkdir(publicDirectory, {recursive: true});
  const canvas = {width: 200, height: 120};
  const plateFile = path.join(publicDirectory, 'clean-plate.png');
  const frameFile = path.join(publicDirectory, 'canonical-frame.png');
  const sheetFile = path.join(publicDirectory, 'content-sheet.png');
  await sharp(
    Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="200" height="120">
        <rect width="200" height="120" fill="#ead8b8"/>
        <path d="M0 102 H200 V120 H0 Z" fill="#b97d45"/>
      </svg>
    `),
  ).png().toFile(plateFile);
  await sharp(
    Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="200" height="120">
        <rect width="200" height="120" fill="transparent"/>
        <path d="M40 12 H160 V108 H40 Z" fill="none" stroke="#8b5d35" stroke-width="8"/>
        <path d="M34 8 H166 V18 H34 Z" fill="#d8b47c"/>
      </svg>
    `),
  ).png().toFile(frameFile);
  await sharp(
    Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="600" height="120">
        <rect width="600" height="120" fill="transparent"/>
        <rect x="58" y="73" width="100" height="29" fill="#54a8cf"/>
        <rect x="258" y="44" width="100" height="58" fill="#54a8cf"/>
        <rect x="458" y="16" width="100" height="86" fill="#54a8cf"/>
      </svg>
    `),
  ).png().toFile(sheetFile);
  const relative = (file) => path.relative(root, file);
  const registration = {
    id: 'vessel-registration',
    sourceMasterAssetId: 'vessel-master',
    canvas,
    origin: 'top-left',
  };
  const spec = {
    schemaVersion: 1,
    projectSlug,
    sceneId: 'scene-container',
    groupId: 'vessel-rig',
    familyId: 'vessel-family',
    sourcePackageId: 'vessel-source-package',
    sourceStrategy: CANONICAL_CONTAINER_SOURCE_STRATEGY,
    authoritativeSurfaceId: 'vessel-water',
    registration,
    assets: {
      cleanPlateAssetId: 'vessel-clean-plate',
      canonicalFrameAssetId: 'vessel-canonical-frame',
      contentSheetAssetId: 'vessel-content-sheet',
      interiorMaskAssetId: 'vessel-interior-mask',
      interiorMaskOutput:
        `public/projects/${projectSlug}/vessel-interior-mask.png`,
    },
    sheetLayout: {
      columns: 3,
      rows: 1,
    },
    interiorShape: {
      kind: 'polygon',
      points: [
        [0.2, 0.1],
        [0.8, 0.1],
        [0.8, 0.9],
        [0.2, 0.9],
      ],
    },
    alignmentPolicy: {
      mode: 'center-bottom',
      maximumTranslationX: 0.1,
      maximumTranslationY: 0.1,
      maximumCenterDrift: 0.02,
      maximumBottomGap: 0.02,
      maximumFillLevelDeviation: 0.04,
      minimumInteriorRetention: 0.95,
    },
    states: [
      {
        id: 'low',
        row: 0,
        column: 0,
        at: 0,
        fillLevel: 0.3,
        outputAssetId: 'vessel-water-low',
        output:
          `public/projects/${projectSlug}/vessel-water-low.png`,
      },
      {
        id: 'middle',
        row: 0,
        column: 1,
        at: 0.5,
        fillLevel: 0.6,
        outputAssetId: 'vessel-water-middle',
        output:
          `public/projects/${projectSlug}/vessel-water-middle.png`,
      },
      {
        id: 'high',
        row: 0,
        column: 2,
        at: 1,
        fillLevel: 0.9,
        outputAssetId: 'vessel-water-high',
        output:
          `public/projects/${projectSlug}/vessel-water-high.png`,
      },
    ],
    terminalStateId: 'high',
    terminalPolicy: {
      minimumFillLevel: 0.88,
      maximumRimGap: 0.12,
      minimumBottomBandCoverage: 0.75,
      bottomBandHeight: 0.1,
    },
    recoveryPolicy: CANONICAL_CONTAINER_RECOVERY_POLICY,
    applyToProject: true,
  };
  const manifest = {
    schemaVersion: 4,
    projectSlug,
    assets: [
      await sourceRecord({
        root,
        assetId: spec.assets.cleanPlateAssetId,
        file: relative(plateFile),
        index: 1,
        canvas,
        outputRole: 'container-clean-plate',
      }),
      await sourceRecord({
        root,
        assetId: spec.assets.canonicalFrameAssetId,
        file: relative(frameFile),
        index: 2,
        canvas,
        outputRole: 'container-frame',
      }),
      await sourceRecord({
        root,
        assetId: spec.assets.contentSheetAssetId,
        file: relative(sheetFile),
        index: 3,
        canvas: {
          width: canvas.width * spec.sheetLayout.columns,
          height: canvas.height * spec.sheetLayout.rows,
        },
        outputRole: 'container-content-state-sheet',
      }),
    ],
  };
  return {root, canvas, registration, spec, manifest};
};

const makeProject = ({canvas, registration}) => ({
  scenes: [
    {
      id: 'scene-container',
      composition: {
        coordinateSpace: canvas,
        nodes: [
          {
            id: 'vessel-rig',
            kind: 'group',
            pattern: 'canonical-container',
            z: 0,
            coordinateSpace: canvas,
            registration,
            transform: fullTransform(),
            motion: stillMotion(),
            children: [
              {
                id: 'vessel-clean-plate-node',
                kind: 'asset',
                assetRole: 'environment',
                slot: 'container-clean-plate',
                src: 'placeholder.png',
                registrationId: registration.id,
                z: 0,
                transform: fullTransform(),
                motion: stillMotion(),
              },
              {
                id: 'vessel-contents-node',
                kind: 'state-sequence',
                assetRole: 'prop',
                slot: 'container-contents',
                poseFamilyId: 'placeholder-family',
                registration,
                anchorPolicy: {
                  requiredAnchorIds: ['content-bottom'],
                  maximumDrift: 0.1,
                },
                states: [
                  {
                    id: 'placeholder-a',
                    src: 'placeholder-a.png',
                    at: 0,
                    facing: 'neutral',
                    anchors: [{id: 'content-bottom', x: 0.5, y: 0.9}],
                    identityReferenceAssetId: 'placeholder',
                    identityReferenceSha256: '0'.repeat(64),
                  },
                  {
                    id: 'placeholder-b',
                    src: 'placeholder-b.png',
                    at: 1,
                    facing: 'neutral',
                    anchors: [{id: 'content-bottom', x: 0.5, y: 0.9}],
                    identityReferenceAssetId: 'placeholder',
                    identityReferenceSha256: '0'.repeat(64),
                  },
                ],
                playback: {mode: 'once', cycles: 1},
                transition: {type: 'cut', durationSeconds: 0},
                z: 1,
                transform: fullTransform(),
                motion: stillMotion(),
              },
              {
                id: 'vessel-frame-node',
                kind: 'asset',
                assetRole: 'prop',
                slot: 'container-frame',
                src: 'placeholder.png',
                registrationId: registration.id,
                z: 2,
                transform: fullTransform(),
                motion: stillMotion(),
              },
            ],
          },
        ],
      },
    },
  ],
});

test('canonical container aligns, clips and proves one authoritative internal surface', async () => {
  const fixture = await createFixture();
  try {
    assert.doesNotThrow(() =>
      validateCanonicalContainerSpec(fixture.spec));
    const derived = await deriveCanonicalContainer({
      root: fixture.root,
      spec: fixture.spec,
      manifest: fixture.manifest,
      now: '2026-07-30T01:00:00.000Z',
    });
    assert.equal(derived.records.length, 4);
    assert.equal(derived.report.localDerivatives, 4);
    assert.equal(derived.report.avoidedCalls, 2);
    assert.ok(
      derived.report.states.every(
        ({metrics}) =>
          metrics.translation.x === -8 &&
          metrics.translation.y === 6 &&
          metrics.outsideMaskPixels === 0 &&
          metrics.interiorRetention === 1,
      ),
    );
    assert.ok(
      derived.manifest.assets
        .filter(({assetId}) =>
          [
            fixture.spec.assets.cleanPlateAssetId,
            fixture.spec.assets.canonicalFrameAssetId,
            fixture.spec.assets.contentSheetAssetId,
          ].includes(assetId),
        )
        .every(({canonicalContainerBinding}) =>
          canonicalContainerBinding?.familyFingerprint ===
            derived.familyFingerprint),
    );

    const project = makeProject(fixture);
    const group = applyCanonicalContainerToProject({
      project,
      spec: fixture.spec,
      manifest: derived.manifest,
      records: derived.records,
    });
    const proofTimes = fixture.spec.states.map((state, index) => ({
      id: `proof-${state.id}`,
      at: index / (fixture.spec.states.length - 1),
      stateAssertions: [
        {
          nodeId: 'vessel-contents-node',
          stateId: state.id,
        },
      ],
    }));
    const validation = validateCompositionStructure({
      composition: project.scenes[0].composition,
      video: fixture.canvas,
      durationSeconds: 3,
      proofTimes,
      sceneId: 'scene-container',
    });
    assert.deepEqual(
      validation.issues.filter(({level}) => level === 'error'),
      [],
    );
    assert.equal(
      group.children[0].slot,
      'container-clean-plate',
    );
    assert.equal(group.children[1].slot, 'container-contents');
    assert.equal(group.children[2].slot, 'container-frame');

    const inspection = await inspectCanonicalContainerGroupMembers({
      root: fixture.root,
      group,
      manifest: derived.manifest,
    });
    assert.equal(inspection.passed, true, inspection.errors.join('\n'));
    const proof = await buildCanonicalContainerProof({
      root: fixture.root,
      group,
      manifest: derived.manifest,
      directory: path.join(fixture.root, 'dist', 'proof'),
      evidenceId: 'vessel',
    });
    assert.equal(proof.passed, true);
    assert.equal(Object.keys(proof.artifacts).length, 3);
    assert.ok(
      Object.values(proof.artifactHashes).every((hash) =>
        /^[a-f0-9]{64}$/.test(hash)),
    );
    const styleProof = {
      compositeId:
        'canonical-container:scene-container:vessel-rig',
      canonicalContainerProof: {
        ...proof,
        familyFingerprint: derived.familyFingerprint,
        artifacts: Object.fromEntries(
          Object.entries(proof.artifacts).map(([key, file]) => [
            key,
            path.relative(fixture.root, file),
          ]),
        ),
        artifactHashes: Object.fromEntries(
          Object.entries(proof.artifactHashes).map(
            ([file, hash]) => [
              path.relative(fixture.root, file),
              hash,
            ],
          ),
        ),
      },
    };
    await assert.doesNotReject(
      assertCanonicalContainerStyleProof({
        target: {
          pattern: 'canonical-container',
          group,
        },
        proof: styleProof,
        root: fixture.root,
      }),
    );
    await fs.writeFile(
      proof.artifacts.terminalState,
      'mutated proof',
    );
    await assert.rejects(
      assertCanonicalContainerStyleProof({
        target: {
          pattern: 'canonical-container',
          group,
        },
        proof: styleProof,
        root: fixture.root,
      }),
      /证明文件已变化/,
    );

    const duplicate = structuredClone(project.scenes[0].composition);
    duplicate.nodes.push({
      id: 'duplicate-water-surface',
      kind: 'asset',
      assetRole: 'prop',
      src: group.children[1].states[0].src,
      semanticCoverage: ['container-surface:vessel-water'],
      z: 4,
      transform: fullTransform(),
      motion: stillMotion(),
    });
    const duplicateValidation = validateCompositionStructure({
      composition: duplicate,
      video: fixture.canvas,
      durationSeconds: 3,
      proofTimes,
      sceneId: 'scene-container',
    });
    assert.ok(
      duplicateValidation.issues.some(
        ({code}) =>
          code === 'composition-container-surface-duplicate',
      ),
    );
  } finally {
    await fs.rm(fixture.root, {recursive: true, force: true});
  }
});

test('canonical container rejects excessive repair, missing alpha and incomplete terminal fill', async () => {
  const fixture = await createFixture();
  try {
    const shifted = structuredClone(fixture.spec);
    shifted.alignmentPolicy.maximumTranslationX = 0.01;
    await assert.rejects(
      deriveCanonicalContainer({
        root: fixture.root,
        spec: shifted,
        manifest: fixture.manifest,
      }),
      /超过 center-bottom 自动修复上限/,
    );

    const impossibleTerminal = structuredClone(fixture.spec);
    impossibleTerminal.terminalPolicy.minimumFillLevel = 0.98;
    await assert.rejects(
      deriveCanonicalContainer({
        root: fixture.root,
        spec: impossibleTerminal,
        manifest: fixture.manifest,
      }),
      /终态未达到可量化目标/,
    );

    const opaqueSheet = path.join(
      fixture.root,
      'public',
      'projects',
      fixture.spec.projectSlug,
      'opaque-sheet.png',
    );
    await sharp({
      create: {
        width:
          fixture.canvas.width *
          fixture.spec.sheetLayout.columns,
        height: fixture.canvas.height,
        channels: 3,
        background: '#54a8cf',
      },
    }).png().toFile(opaqueSheet);
    await assert.rejects(
      verifyOutputFile(opaqueSheet, {
        schemaVersion: 8,
        capability: 'image',
        compositionBinding: {
          canvas: {
            width:
              fixture.canvas.width *
              fixture.spec.sheetLayout.columns,
            height: fixture.canvas.height,
          },
        },
        outputSurface: {mode: 'alpha'},
      }),
      /未提供真实透明像素/,
    );
  } finally {
    await fs.rm(fixture.root, {recursive: true, force: true});
  }
});

test('canonical container compiler and provider roots preserve one complete state-sheet context', () => {
  const fixtureIntent = {
    groupId: 'vessel-rig',
    familyId: 'vessel-family',
    sourcePackageId: 'vessel-source-package',
    sourceStrategy: CANONICAL_CONTAINER_SOURCE_STRATEGY,
    registrationId: 'vessel-registration',
    sourceMasterAssetId: 'vessel-master',
    cleanPlateAssetId: 'vessel-clean-plate',
    canonicalFrameAssetId: 'vessel-canonical-frame',
    contentSheetAssetId: 'vessel-content-sheet',
    interiorMaskAssetId: 'vessel-interior-mask',
    authoritativeSurfaceId: 'vessel-water',
    terminalStateId: 'high',
    canvas: {width: 200, height: 120},
    interiorShape: {
      kind: 'polygon',
      points: [
        [0.2, 0.1],
        [0.8, 0.1],
        [0.8, 0.9],
        [0.2, 0.9],
      ],
    },
    alignmentPolicy: {
      mode: 'center-bottom',
      maximumTranslationX: 0.1,
      maximumTranslationY: 0.1,
      maximumCenterDrift: 0.02,
      maximumBottomGap: 0.02,
      maximumFillLevelDeviation: 0.04,
      minimumInteriorRetention: 0.95,
    },
    states: [
      {id: 'low', row: 0, column: 0, at: 0, fillLevel: 0.3},
      {id: 'middle', row: 0, column: 1, at: 0.5, fillLevel: 0.6},
      {id: 'high', row: 0, column: 2, at: 1, fillLevel: 0.9},
    ],
    sheetLayout: {columns: 3, rows: 1},
    terminalPolicy: {
      minimumFillLevel: 0.88,
      maximumRimGap: 0.12,
      minimumBottomBandCoverage: 0.75,
      bottomBandHeight: 0.1,
    },
    recoveryPolicy: CANONICAL_CONTAINER_RECOVERY_POLICY,
  };
  const treatment = {
    id: 'vessel-fill-treatment',
    targetId: 'vessel-contents-node',
    changeClass: 'mechanism-state',
    semanticRisk: 'mechanism',
    proofTimeId: 'proof-high',
    motion: {
      kind: 'state-sequence',
      poseFamilyId: 'vessel-family',
      stateId: 'high',
    },
    composition: {
      pattern: 'canonical-container',
      container: fixtureIntent,
    },
  };
  assert.deepEqual(
    validateCanonicalContainerIntent(
      treatment.composition,
      {treatment},
    ),
    [],
  );
  const plan = compileCanonicalContainerPlan({
    sceneId: 'scene-container',
    treatment,
  });
  assert.equal(plan.providerImageCalls, 3);
  assert.equal(plan.localDerivatives, 4);
  assert.equal(plan.avoidedCalls, 2);
  assert.deepEqual(plan.sheetLayout, fixtureIntent.sheetLayout);

  const packageBase = {
    familyId: fixtureIntent.familyId,
    sourcePackageId: fixtureIntent.sourcePackageId,
    sourceStrategy: fixtureIntent.sourceStrategy,
    registrationId: fixtureIntent.registrationId,
    sourceMasterAssetId: fixtureIntent.sourceMasterAssetId,
    canvas: fixtureIntent.canvas,
    cleanPlateAssetId: fixtureIntent.cleanPlateAssetId,
    canonicalFrameAssetId: fixtureIntent.canonicalFrameAssetId,
    contentSheetAssetId: fixtureIntent.contentSheetAssetId,
    interiorMaskAssetId: fixtureIntent.interiorMaskAssetId,
    authoritativeSurfaceId: fixtureIntent.authoritativeSurfaceId,
    interiorShape: fixtureIntent.interiorShape,
    alignmentPolicy: fixtureIntent.alignmentPolicy,
    states: fixtureIntent.states.map(
      ({id, row, column, at, fillLevel}) => ({
        stateId: id,
        row,
        column,
        at,
        fillLevel,
      }),
    ),
    sheetLayout: fixtureIntent.sheetLayout,
    terminalStateId: fixtureIntent.terminalStateId,
    terminalPolicy: fixtureIntent.terminalPolicy,
    frameRedrawPolicy: 'forbidden-in-content-states',
    duplicateSurfacePolicy:
      'single-authoritative-state-sequence',
    recoveryPolicy: fixtureIntent.recoveryPolicy,
  };
  const roleContract = {
    'clean-plate': {
      assetId: fixtureIntent.cleanPlateAssetId,
      outputRole: 'container-clean-plate',
      canvas: fixtureIntent.canvas,
      outputSurface: {mode: 'opaque'},
      roleChecks: ['clean-plate-clear'],
    },
    'canonical-frame': {
      assetId: fixtureIntent.canonicalFrameAssetId,
      outputRole: 'container-frame',
      canvas: fixtureIntent.canvas,
      outputSurface: {mode: 'alpha'},
      roleChecks: ['canonical-frame-only'],
    },
    'content-state-sheet': {
      assetId: fixtureIntent.contentSheetAssetId,
      outputRole: 'container-content-state-sheet',
      canvas: {
        width:
          fixtureIntent.canvas.width *
          fixtureIntent.sheetLayout.columns,
        height:
          fixtureIntent.canvas.height *
          fixtureIntent.sheetLayout.rows,
      },
      outputSurface: {mode: 'alpha'},
      roleChecks: [
        'container-content-only',
        'container-state-separation',
        'container-fill-progression',
      ],
    },
  };
  const requests = Object.entries(roleContract).map(
    ([
      packageRole,
      {
        assetId,
        outputRole,
        canvas,
        outputSurface,
        roleChecks,
      },
    ]) => ({
      schemaVersion: 8,
      projectSlug: 'canonical-container-proof',
      assetId,
      capability: 'image',
      output: `public/projects/canonical-container-proof/${assetId}.png`,
      prompt:
        `${CANONICAL_CONTAINER_PROMPT_DIRECTIVES[packageRole]} ` +
        'hand-drawn paper collage container source',
      styleProfileBinding: {
        schemaVersion: 1,
        id: 'hand-drawn-cutout-explainer',
        catalogVersion: 'fixture',
        profileFingerprint: 'a'.repeat(64),
        directives: [
          'fixture ink',
          'fixture paper',
          'Avoid: fixture gloss',
        ],
      },
      compositionBinding: {
        sceneId: 'scene-container',
        nodeId: fixtureIntent.groupId,
        pattern: 'canonical-container',
        registrationId: fixtureIntent.registrationId,
        sourceMasterAssetId: fixtureIntent.sourceMasterAssetId,
        outputRole,
        canvas,
        derivation: {method: 'provider-generation'},
      },
      containerPackageBinding: {
        ...packageBase,
        packageRole,
      },
      semanticBinding: {
        riskClass: 'mechanism-critical',
        contractIds: ['vessel-mechanism'],
      },
      outputSurface,
      quality: {
        kind: 'mechanism',
        requiredChecks: [
          'style-profile-conformant',
          'mechanism-complete',
          'load-path-readable',
          'physical-plausibility',
          'reference-conformant',
          ...roleChecks,
        ],
      },
    }),
  );
  for (const request of requests) {
    assert.doesNotThrow(() => validateAssetRequest(request));
    assert.equal(
      canonicalContainerPackageBindingMatchesPlan({
        binding: request.containerPackageBinding,
        plan,
      }),
      true,
    );
  }
  const driftedBinding = structuredClone(
    requests.at(-1).containerPackageBinding,
  );
  driftedBinding.states[1].column = 2;
  assert.equal(
    canonicalContainerPackageBindingMatchesPlan({
      binding: driftedBinding,
      plan,
    }),
    false,
  );
  const driftedRequest = structuredClone(requests.at(-1));
  driftedRequest.containerPackageBinding = driftedBinding;
  assert.throws(
    () => validateAssetRequest(driftedRequest),
    /唯一 row\/column 格位/,
  );
  const invalid = structuredClone(requests.at(-1));
  invalid.prompt = 'generic water level';
  assert.throws(
    () => validateAssetRequest(invalid),
    /CONTENT_STATES_ONLY_NO_CONTAINER_FRAME_OR_EXTRA_SURFACE/,
  );
});
