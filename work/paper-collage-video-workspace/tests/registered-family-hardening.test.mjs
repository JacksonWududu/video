import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import {prepareRegisteredFamilyProof} from '../scripts/asset-hardening-proof-lib.mjs';
import {
  DEFAULT_ALPHA_BAND_THRESHOLDS,
  inspectAlphaBands,
  inspectAlphaTopology,
} from '../scripts/alpha-band-lib.mjs';
import {
  REGISTERED_FAMILY_RECOVERY_POLICY,
  applyRegisteredFamilyToProject,
  assertRegisteredFamilyGroupMembers,
  assertRegisteredFamilyRecords,
  deriveRegisteredFamily,
  sha256File,
  validateRegisteredFamilySpec,
} from '../scripts/registered-family-lib.mjs';
import {
  expectedRegisteredFamilyAlphaEvidenceCount,
  stateSequenceRegistrationStatus,
} from '../scripts/quality-lib.mjs';

const writeImageRecord = async ({
  root,
  assetId,
  file,
  adapter = 'manual',
  compositionBinding = null,
  extra = {},
  index,
}) => {
  const absolute = path.join(root, file);
  const metadata = await sharp(absolute).metadata();
  return {
    recordId: String(index).padStart(64, '0'),
    assetId,
    capability: 'image',
    file,
    provider: adapter === 'host' ? 'fixture-provider' : 'local',
    adapter,
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
    recordedAt: '2026-07-23T00:00:00.000Z',
    request: {},
    compositionBinding,
    lifecycle: {
      status: 'active',
      changedAt: '2026-07-23T00:00:00.000Z',
      reason: 'fixture',
      supersededBy: null,
    },
    ...extra,
  };
};

const writeMask = async ({file, width, height, shape}) => {
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="transparent"/>${shape}</svg>`,
  );
  await sharp(svg).png().toFile(file);
};

const makeFamilyFixture = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'registered-family-'));
  const publicDirectory = path.join(root, 'public', 'projects', 'family-proof');
  await fs.mkdir(publicDirectory, {recursive: true});
  const canvas = {width: 240, height: 160};
  const masterFile = path.join(publicDirectory, 'master.png');
  await sharp({
    create: {
      ...canvas,
      channels: 4,
      background: {r: 211, g: 185, b: 134, alpha: 1},
    },
  }).png().toFile(masterFile);
  const rear = await sharp(Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="240" height="160">
      <rect width="240" height="160" fill="#d3b986"/>
      <path d="M18 86 H222 V142 H18 Z" fill="#795336"/>
    </svg>
  `)).png().toBuffer();
  const subject = await sharp(Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="240" height="160">
      <rect width="240" height="160" fill="transparent"/>
      <ellipse cx="120" cy="72" rx="34" ry="58" fill="#b56b49"/>
    </svg>
  `)).png().toBuffer();
  const front = await sharp(Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="240" height="160">
      <rect width="240" height="160" fill="transparent"/>
      <path d="M12 116 Q120 86 228 116 V152 H12 Z" fill="#c1905d"/>
    </svg>
  `)).png().toBuffer();
  const layerSheetFile = path.join(
    publicDirectory,
    'registered-layer-sheet.png',
  );
  await sharp({
    create: {
      width: 480,
      height: 320,
      channels: 4,
      background: '#00000000',
    },
  }).composite([
    {input: masterFile, left: 0, top: 0},
    {input: rear, left: 240, top: 0},
    {input: subject, left: 0, top: 160},
    {input: front, left: 240, top: 160},
  ]).png().toFile(layerSheetFile);
  const relative = (file) => path.relative(root, file);
  const registration = {
    id: 'fixture-registration',
    sourceMasterAssetId: 'fixture-master',
    canvas,
    origin: 'top-left',
  };
  const records = [
    await writeImageRecord({
      root,
      assetId: 'fixture-master',
      file: relative(masterFile),
      adapter: 'host',
      compositionBinding: {
        sceneId: 'scene',
        nodeId: 'rig',
        pattern: 'supported-subject',
        registrationId: registration.id,
        sourceMasterAssetId: registration.sourceMasterAssetId,
        outputRole: 'source-master',
        canvas,
        derivation: {method: 'provider-generation', parentAssetId: null},
      },
      index: 1,
    }),
  ];
  const memberAssetIds = [
    'family-rear',
    'family-subject',
    'family-front',
  ];
  const layerPackageBinding = {
    sourcePackageId: 'fixture-layer-package',
    pattern: 'supported-subject',
    motionCapability: 'bounded-relative',
    sourceStrategy: 'registered-layer-sheet',
    registrationId: registration.id,
    sourceMasterAssetId: registration.sourceMasterAssetId,
    canvas,
    packageRole: 'registered-sheet',
    completeness: null,
    memberAssetIds,
    referenceAssetIds: [registration.sourceMasterAssetId],
    sheetLayout: {
      columns: 2,
      rows: 2,
      cells: [
        {packageRole: 'reference', row: 0, column: 0},
        {packageRole: 'support-rear', row: 0, column: 1},
        {packageRole: 'subject', row: 1, column: 0},
        {packageRole: 'support-front', row: 1, column: 1},
      ],
    },
    recoveryPolicy: {
      completeSourceContext: true,
      localDeterministicFixFirst: true,
      isolatedMemberGeneration: 'forbidden',
      providerRepair: 'masked-complete-source-edit',
      fallback: 'full-source-regeneration',
    },
  };
  records.push(await writeImageRecord({
    root,
    assetId: 'fixture-layer-sheet',
    file: relative(layerSheetFile),
    adapter: 'host',
    compositionBinding: {
      sceneId: 'scene',
      nodeId: 'rig',
      pattern: 'supported-subject',
      registrationId: registration.id,
      sourceMasterAssetId: registration.sourceMasterAssetId,
      outputRole: 'registered-layer-sheet',
      canvas: {width: 480, height: 320},
      derivation: {
        method: 'provider-generation',
        parentAssetId: registration.sourceMasterAssetId,
      },
    },
    extra: {request: {layerPackageBinding}},
    index: 2,
  }));
  const manifest = {
    schemaVersion: 4,
    projectSlug: 'family-proof',
    assets: records,
  };
  const members = [
    ['family-rear', 'rear-node', 'support-rear'],
    ['family-subject', 'subject-node', 'subject'],
    ['family-front', 'front-node', 'support-front'],
  ].map(([assetId, nodeId, role]) => ({
    assetId,
    nodeId,
    role,
    slot: role,
    output: `public/projects/family-proof/${assetId}.png`,
    completeness: {
      'support-rear': 'clean-plate',
      subject: 'full-silhouette',
      'support-front': 'full-overlay',
    }[role],
    source: {
      kind: 'registered-layer-sheet',
      assetId: 'fixture-layer-sheet',
      packageRole: role,
    },
    derivation: {},
  }));
  const spec = {
    schemaVersion: 2,
    projectSlug: 'family-proof',
    sceneId: 'scene',
    groupId: 'rig',
    familyId: 'fixture-family',
    pattern: 'supported-subject',
    motionCapability: 'bounded-relative',
    sourcePackageId: 'fixture-layer-package',
    sourceStrategy: 'registered-layer-sheet',
    revealEnvelope: {
      '16:9': {x: 0.02, y: 0.02, scale: 0.04, rotationDegrees: 1},
      '9:16': {x: 0.015, y: 0.02, scale: 0.04, rotationDegrees: 1},
      '1:1': {x: 0.018, y: 0.018, scale: 0.04, rotationDegrees: 1},
    },
    registration,
    members,
    recoveryPolicy: REGISTERED_FAMILY_RECOVERY_POLICY,
    applyToProject: true,
  };
  return {root, manifest, spec, registration};
};

test('registered family derives three deterministic full-canvas members and lifecycle records', async () => {
  const fixture = await makeFamilyFixture();
  try {
    assert.deepEqual(validateRegisteredFamilySpec(fixture.spec), []);
    const first = await deriveRegisteredFamily({
      root: fixture.root,
      spec: fixture.spec,
      manifest: structuredClone(fixture.manifest),
      now: '2026-07-23T01:00:00.000Z',
    });
    assert.equal(first.records.length, 3);
    assert.equal(first.report.providerImageCalls, 1);
    assert.equal(first.report.localDerivatives, 3);
    assert.equal(first.report.avoidedCalls, 3);
    assert.deepEqual(
      first.records.map(({registeredFamilyBinding}) => registeredFamilyBinding.role).sort(),
      ['subject', 'support-front', 'support-rear'],
    );
    assert.ok(first.records.every((record) =>
      record.media.width === fixture.registration.canvas.width &&
      record.media.height === fixture.registration.canvas.height &&
      record.registeredFamilyBinding.registrationId === fixture.registration.id &&
      record.registeredFamilyBinding.sourceMasterAssetId === fixture.registration.sourceMasterAssetId &&
      record.registeredFamilyBinding.derivation.outputCanvasPreserved === true &&
      record.registeredFamilyBinding.derivation.trimmed === false));
    assert.equal(assertRegisteredFamilyRecords({
      records: first.records,
      registration: fixture.registration,
    }).passed, true);

    const project = {
      scenes: [{
        id: 'scene',
        composition: {
          nodes: [{
            id: 'rig',
            kind: 'group',
            pattern: 'supported-subject',
            coordinateSpace: {width: 1, height: 1},
            registration: fixture.registration,
            children: fixture.spec.members.map((member) => ({
              id: member.nodeId,
              kind: 'asset',
              slot: member.slot,
              src: 'unbound.png',
              registrationId: 'unbound',
            })),
          }],
        },
      }],
    };
    applyRegisteredFamilyToProject({
      project,
      spec: fixture.spec,
      records: first.records,
    });
    assert.deepEqual(
      project.scenes[0].composition.nodes[0].children.map(({registrationId}) => registrationId),
      [fixture.registration.id, fixture.registration.id, fixture.registration.id],
    );

    const second = await deriveRegisteredFamily({
      root: fixture.root,
      spec: fixture.spec,
      manifest: first.manifest,
      now: '2026-07-23T02:00:00.000Z',
    });
    assert.equal(second.familyFingerprint, first.familyFingerprint);
    assert.equal(
      second.manifest.assets.filter(({assetId, lifecycle}) =>
        assetId === 'family-subject' && lifecycle.status === 'superseded').length,
      1,
    );
    assert.equal(
      second.manifest.assets.filter(({assetId, lifecycle}) =>
        assetId === 'family-subject' && lifecycle.status === 'active').length,
      1,
    );
  } finally {
    await fs.rm(fixture.root, {recursive: true, force: true});
  }
});

test('registered family places an active state-sheet cell as a full-context subject', async () => {
  const fixture = await makeFamilyFixture();
  try {
    const stateFile = path.join(
      fixture.root,
      'public',
      'projects',
      'family-proof',
      'frog-waiting.png',
    );
    await sharp(Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="80" height="96">
        <rect width="80" height="96" fill="transparent"/>
        <ellipse cx="40" cy="51" rx="28" ry="38" fill="#79a84d"/>
      </svg>
    `)).png().toFile(stateFile);
    const stateRecord = await writeImageRecord({
      root: fixture.root,
      assetId: 'frog-waiting',
      file: path.relative(fixture.root, stateFile),
      adapter: 'registered-sheet-cell',
      compositionBinding: {
        sceneId: 'scene',
        nodeId: 'frog',
        pattern: 'state-sequence',
        registrationId: 'frog-pose-registration',
        sourceMasterAssetId: 'frog-pose-sheet',
        outputRole: 'registered-state',
        canvas: {width: 80, height: 96},
        derivation: {method: 'crop', parentAssetId: 'frog-pose-sheet'},
      },
      extra: {
        sourceSheetAssetId: 'frog-pose-sheet',
        familyFingerprint: 'a'.repeat(64),
        stateBinding: {
          poseFamilyId: 'frog-reactions',
          stateId: 'waiting',
          registrationId: 'frog-pose-registration',
          sourceMasterAssetId: 'frog-pose-sheet',
          facing: 'left',
          anchors: [{id: 'seat-contact', x: 0.5, y: 0.85}],
          identityReferenceAssetId: 'frog-reference',
          identityReferenceSha256: 'b'.repeat(64),
        },
      },
      index: 3,
    });
    const manifest = structuredClone(fixture.manifest);
    manifest.assets.push(stateRecord);
    const spec = structuredClone(fixture.spec);
    spec.familyId = 'frog-waiting-family';
    const subject = spec.members.find(({role}) => role === 'subject');
    subject.source = {
      kind: 'state-sheet-cell',
      assetId: 'frog-waiting',
      poseFamilyId: 'frog-reactions',
      stateId: 'waiting',
    };
    subject.derivation = {
      placement: {left: 80, top: 40, width: 80, height: 96},
    };

    assert.deepEqual(validateRegisteredFamilySpec(spec), []);
    const result = await deriveRegisteredFamily({
      root: fixture.root,
      spec,
      manifest,
      now: '2026-07-23T03:00:00.000Z',
    });
    const derivedSubject = result.records.find(
      ({registeredFamilyBinding}) =>
        registeredFamilyBinding.role === 'subject',
    );
    assert.equal(
      derivedSubject.registeredFamilyBinding.source.kind,
      'state-sheet-cell',
    );
    assert.equal(
      derivedSubject.registeredFamilyBinding.source.stateId,
      'waiting',
    );
    assert.deepEqual(
      derivedSubject.registeredFamilyBinding.derivation.placement,
      {left: 80, top: 40, width: 80, height: 96},
    );
    assert.equal(
      assertRegisteredFamilyRecords({
        records: result.records,
        registration: fixture.registration,
      }).passed,
      true,
    );
  } finally {
    await fs.rm(fixture.root, {recursive: true, force: true});
  }
});

test('registered family derives provider-native mixed-surface sheets with explicit rects and chroma provenance', async () => {
  const fixture = await makeFamilyFixture();
  try {
    const sourceRecord = fixture.manifest.assets.find(
      ({assetId}) => assetId === 'fixture-layer-sheet',
    );
    const sourceFile = path.join(fixture.root, sourceRecord.file);
    await sharp(Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="364" height="244">
        <rect width="364" height="244" fill="#ffffff"/>
        <rect x="0" y="0" width="180" height="120" fill="#d3b986"/>
        <path d="M18 66 H162 V106 H18 Z" fill="#795336"/>
        <rect x="184" y="0" width="180" height="120" fill="#d3b986"/>
        <path d="M18 66 H162 V106 H18 Z" transform="translate(184 0)" fill="#795336"/>
        <rect x="0" y="124" width="180" height="120" fill="#ff00ff"/>
        <ellipse cx="90" cy="180" rx="31" ry="45" fill="#b56b49"/>
        <circle cx="90" cy="180" r="10" fill="#ff00ff"/>
        <rect x="184" y="124" width="180" height="120" fill="#ff00ff"/>
        <path d="M196 212 Q274 164 352 212 V244 H196 Z" fill="#2f733f"/>
      </svg>
    `)).png().toFile(sourceFile);
    const sourceMetadata = await sharp(sourceFile).metadata();
    sourceRecord.sha256 = await sha256File(sourceFile);
    sourceRecord.sizeBytes = (await fs.stat(sourceFile)).size;
    sourceRecord.media = {
      width: sourceMetadata.width,
      height: sourceMetadata.height,
      format: sourceMetadata.format,
      hasAlpha: sourceMetadata.hasAlpha === true,
    };
    sourceRecord.request.layerPackageBinding.sheetLayout = {
      columns: 2,
      rows: 2,
      providerSource: {
        canvasMode: 'provider-native',
        minimumWidth: 320,
        minimumHeight: 220,
        cellExtraction: 'explicit-rects',
      },
      cells: [
        {packageRole: 'reference', row: 0, column: 0, outputSurface: {mode: 'opaque'}},
        {packageRole: 'support-rear', row: 0, column: 1, outputSurface: {mode: 'opaque'}},
        {packageRole: 'subject', row: 1, column: 0, outputSurface: {mode: 'chroma-key', keyColor: '#ff00ff', tolerance: 8}},
        {packageRole: 'support-front', row: 1, column: 1, outputSurface: {mode: 'chroma-key', keyColor: '#ff00ff', tolerance: 8}},
      ],
    };
    const rects = {
      'support-rear': {left: 184, top: 0, width: 180, height: 120},
      subject: {left: 0, top: 124, width: 180, height: 120},
      'support-front': {left: 184, top: 124, width: 180, height: 120},
    };
    fixture.spec.members = fixture.spec.members.map((member) => ({
      ...member,
      derivation: {
        sourceRect: rects[member.role],
        placement: {
          left: 0,
          top: 0,
          width: fixture.registration.canvas.width,
          height: fixture.registration.canvas.height,
        },
        ...(['subject', 'support-front'].includes(member.role)
          ? {
              keying: {
                keyColor: '#ff00ff',
                transparentThreshold: 18,
                opaqueThreshold: 95,
                edgeFeather: 0.6,
                matteErode: 1,
                edgePadding: 6,
              },
            }
          : {}),
      },
    }));
    const result = await deriveRegisteredFamily({
      root: fixture.root,
      spec: fixture.spec,
      manifest: fixture.manifest,
      now: '2026-07-23T01:30:00.000Z',
    });
    assert.equal(result.records.length, 3);
    assert.equal(result.report.providerImageCalls, 1);
    assert.equal(result.report.localDerivatives, 3);
    const rear = result.records.find(
      ({registeredFamilyBinding}) =>
        registeredFamilyBinding.role === 'support-rear',
    );
    const subject = result.records.find(
      ({registeredFamilyBinding}) =>
        registeredFamilyBinding.role === 'subject',
    );
    assert.equal(rear.registeredFamilyBinding.derivation.keying, null);
    assert.equal(
      subject.registeredFamilyBinding.derivation.sourceSurface.mode,
      'chroma-key',
    );
    assert.equal(
      subject.registeredFamilyBinding.derivation.keying.keyColor,
      '#ff00ff',
    );
    assert.match(
      subject.registeredFamilyBinding.derivation.keyingMetadataSha256,
      /^[a-f0-9]{64}$/,
    );
    assert.equal(
      await fs.stat(path.join(fixture.root, `${subject.file}.key.json`))
        .then(() => true),
      true,
    );
    const alpha = await sharp(path.join(fixture.root, subject.file))
      .ensureAlpha()
      .extractChannel(3)
      .raw()
      .toBuffer();
    assert.ok(alpha.some((value) => value === 0));
    assert.ok(alpha.some((value) => value === 255));
    assert.equal(
      assertRegisteredFamilyRecords({
        records: result.records,
        registration: fixture.registration,
      }).passed,
      true,
    );
  } finally {
    await fs.rm(fixture.root, {recursive: true, force: true});
  }
});

test('registered family recovers one-pixel provider edge drift for full-context chroma members without resizing', async () => {
  const fixture = await makeFamilyFixture();
  try {
    const {canvas} = fixture.registration;
    const publicDirectory = path.join(
      fixture.root,
      'public',
      'projects',
      'family-proof',
    );
    const files = {
      'support-rear': path.join(publicDirectory, 'edit-rear.png'),
      subject: path.join(publicDirectory, 'edit-subject.png'),
      'support-front': path.join(publicDirectory, 'edit-front.png'),
    };
    await sharp({
      create: {
        ...canvas,
        channels: 4,
        background: '#d3b986',
      },
    }).png().toFile(files['support-rear']);
    await sharp(Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="239" height="160">
        <rect width="239" height="160" fill="#ff00ff"/>
        <ellipse cx="118" cy="78" rx="34" ry="56" fill="#b56b49"/>
      </svg>
    `)).png().toFile(files.subject);
    await sharp(Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="240" height="160">
        <rect width="240" height="160" fill="#ff00ff"/>
        <path d="M12 116 Q120 86 228 116 V152 H12 Z" fill="#2f733f"/>
      </svg>
    `)).png().toFile(files['support-front']);

    const sourcePackageId = 'fixture-context-edits';
    const memberAssetIds = fixture.spec.members.map(({assetId}) => assetId);
    const layerBinding = (role) => ({
      sourcePackageId,
      pattern: fixture.spec.pattern,
      motionCapability: 'bounded-relative',
      sourceStrategy: 'context-preserving-layer-edits',
      registrationId: fixture.registration.id,
      sourceMasterAssetId: fixture.registration.sourceMasterAssetId,
      canvas,
      packageRole: role,
      completeness: {
        'support-rear': 'clean-plate',
        subject: 'full-silhouette',
        'support-front': 'full-overlay',
      }[role],
      memberAssetIds,
      referenceAssetIds: [fixture.registration.sourceMasterAssetId],
      sheetLayout: null,
      recoveryPolicy: {
        completeSourceContext: true,
        localDeterministicFixFirst: true,
        isolatedMemberGeneration: 'forbidden',
        providerRepair: 'masked-complete-source-edit',
        fallback: 'full-source-regeneration',
      },
    });
    const sourceRecords = [];
    for (const [index, role] of [
      'support-rear',
      'subject',
      'support-front',
    ].entries()) {
      const recovery = role === 'subject';
      sourceRecords.push(await writeImageRecord({
        root: fixture.root,
        assetId: `edit-${role}`,
        file: path.relative(fixture.root, files[role]),
        adapter: 'host',
        compositionBinding: {
          sceneId: 'scene',
          nodeId: 'rig',
          pattern: fixture.spec.pattern,
          registrationId: fixture.registration.id,
          sourceMasterAssetId: fixture.registration.sourceMasterAssetId,
          outputRole: role,
          canvas,
          derivation: {
            method: 'provider-edit',
            parentAssetId: fixture.registration.sourceMasterAssetId,
          },
        },
        extra: {
          request: {
            outputSurface: role === 'support-rear'
              ? {mode: 'opaque'}
              : {
                  mode: 'chroma-key',
                  keyColor: '#ff00ff',
                  tolerance: 24,
                },
            layerPackageBinding: layerBinding(role),
          },
          ...(recovery
            ? {
                lifecycle: {
                  status: 'recovery-source',
                  changedAt: '2026-07-23T00:00:00.000Z',
                  reason: 'provider returned one pixel less width',
                  supersededBy: null,
                },
                providerObservation: {
                  schemaVersion: 1,
                  mode: 'provider-native-observed',
                  policyId: 'flat-v1',
                  policyFingerprint: '1'.repeat(64),
                  observationFingerprint: '2'.repeat(64),
                  cells: [{
                    packageRole: 'image',
                    passed: true,
                    requestedKeyColor: '#ff00ff',
                    observedKeyColor: '#ff00ff',
                    policyFingerprint: '1'.repeat(64),
                    metrics: {},
                  }],
                },
              }
            : {}),
        },
        index: index + 10,
      }));
    }
    fixture.manifest.assets = [
      fixture.manifest.assets.find(
        ({assetId}) => assetId === fixture.registration.sourceMasterAssetId,
      ),
      ...sourceRecords,
    ];
    fixture.spec.sourcePackageId = sourcePackageId;
    fixture.spec.sourceStrategy = 'context-preserving-layer-edits';
    fixture.spec.members = fixture.spec.members.map((member) => ({
      ...member,
      source: {
        kind: 'layer-package-member',
        assetId: `edit-${member.role}`,
      },
      derivation: {
        ...(member.role === 'subject'
          ? {
              placement: {
                left: 0,
                top: 0,
                width: 239,
                height: 160,
              },
            }
          : {}),
        ...(['subject', 'support-front'].includes(member.role)
          ? {
              keying: {
                keyColor: '#ff00ff',
                transparentThreshold: 18,
                opaqueThreshold: 95,
                edgeFeather: 0.6,
                matteErode: 1,
                edgePadding: 6,
              },
            }
          : {}),
      },
    }));

    assert.deepEqual(validateRegisteredFamilySpec(fixture.spec), []);
    const result = await deriveRegisteredFamily({
      root: fixture.root,
      spec: fixture.spec,
      manifest: fixture.manifest,
      now: '2026-07-23T03:00:00.000Z',
    });
    const subject = result.records.find(
      ({registeredFamilyBinding}) =>
        registeredFamilyBinding.role === 'subject',
    );
    const {data, info} = await sharp(path.join(fixture.root, subject.file))
      .ensureAlpha()
      .raw()
      .toBuffer({resolveWithObject: true});
    assert.equal(info.width, 240);
    assert.equal(info.height, 160);
    assert.equal(data[(80 * info.width + 239) * 4 + 3], 0);
    assert.ok(data[(80 * info.width + 118) * 4 + 3] > 200);
    assert.equal(subject.registeredFamilyBinding.derivation.placement.width, 239);
    assert.equal(subject.registeredFamilyBinding.derivation.outputCanvasPreserved, true);

    const collidingSpec = structuredClone(fixture.spec);
    collidingSpec.familyId = 'fixture-colliding-family';
    collidingSpec.members = collidingSpec.members.map((member) => ({
      ...member,
      assetId: member.source.assetId,
      nodeId: `colliding-${member.role}`,
      output:
        `public/projects/family-proof/registered/colliding-${member.role}.png`,
    }));
    const firstCollision = await deriveRegisteredFamily({
      root: fixture.root,
      spec: collidingSpec,
      manifest: result.manifest,
      now: '2026-07-23T04:00:00.000Z',
    });
    const secondCollisionSpec = structuredClone(collidingSpec);
    secondCollisionSpec.members[0].nodeId = 'colliding-rear-rebound';
    const secondCollision = await deriveRegisteredFamily({
      root: fixture.root,
      spec: secondCollisionSpec,
      manifest: firstCollision.manifest,
      now: '2026-07-23T05:00:00.000Z',
    });
    assert.equal(secondCollision.report.providerImageCalls, 3);
    assert.equal(
      secondCollision.records.find(
        ({registeredFamilyBinding}) =>
          registeredFamilyBinding.role === 'support-rear',
      ).registeredFamilyBinding.nodeId,
      'colliding-rear-rebound',
    );
    assert.equal(
      secondCollision.manifest.assets.filter(
        ({assetId, lifecycle}) =>
          assetId === 'edit-support-rear' &&
          lifecycle.status === 'active',
      ).length,
      1,
    );
  } finally {
    await fs.rm(fixture.root, {recursive: true, force: true});
  }
});

test('registered family rejects an isolated legacy member source', async () => {
  const fixture = await makeFamilyFixture();
  try {
    const tightFile = path.join(
      fixture.root,
      'public',
      'projects',
      'family-proof',
      'tight.png',
    );
    await sharp({
      create: {
        width: 48,
        height: 72,
        channels: 4,
        background: '#74513dff',
      },
    }).png().toFile(tightFile);
    fixture.manifest.assets.push(await writeImageRecord({
      root: fixture.root,
      assetId: 'tight-sheet-member',
      file: path.relative(fixture.root, tightFile),
      index: 10,
      extra: {
        stateBinding: {
          poseFamilyId: 'pose-family',
          stateId: 'subject',
          registrationId: fixture.registration.id,
          sourceMasterAssetId: fixture.registration.sourceMasterAssetId,
        },
        sourceSheetAssetId: 'fixture-master',
        familyFingerprint: 'f'.repeat(64),
      },
    }));
    fixture.spec.members[1] = {
      ...fixture.spec.members[1],
      source: {kind: 'registered-sheet-member', assetId: 'tight-sheet-member'},
      derivation: {},
    };
    await assert.rejects(
      () => deriveRegisteredFamily({
        root: fixture.root,
        spec: fixture.spec,
        manifest: fixture.manifest,
      }),
      /registered family spec 无效.*source 无效/,
    );
  } finally {
    await fs.rm(fixture.root, {recursive: true, force: true});
  }
});

test('registered family rejects a non-2x2 layer sheet', async () => {
  const fixture = await makeFamilyFixture();
  try {
    const sheetFile = path.join(
      fixture.root,
      'public',
      'projects',
      'family-proof',
      'registered-sheet.png',
    );
    await sharp(Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="720" height="160">
        <rect width="720" height="160" fill="transparent"/>
        <path d="M18 92 H222 V148 H18 Z" fill="#795336"/>
        <ellipse cx="360" cy="78" rx="38" ry="68" fill="#b56b49"/>
        <path d="M492 116 Q600 80 708 116 V152 H492 Z" fill="#c1905d"/>
      </svg>
    `)).png().toFile(sheetFile);
    fixture.manifest.assets.push(await writeImageRecord({
      root: fixture.root,
      assetId: 'fixture-registered-sheet',
      file: path.relative(fixture.root, sheetFile),
      index: 11,
      extra: {
        request: {
          layerPackageBinding: {
          sourcePackageId: fixture.spec.sourcePackageId,
          pattern: fixture.spec.pattern,
          motionCapability: fixture.spec.motionCapability,
          sourceStrategy: fixture.spec.sourceStrategy,
          registrationId: fixture.registration.id,
          sourceMasterAssetId: fixture.registration.sourceMasterAssetId,
          canvas: fixture.registration.canvas,
          packageRole: 'registered-sheet',
          completeness: null,
          memberAssetIds: fixture.spec.members.map(({assetId}) => assetId),
          referenceAssetIds: [fixture.registration.sourceMasterAssetId],
          sheetLayout: {
            columns: 3,
            rows: 1,
            cells: [
            {packageRole: 'reference', row: 0, column: 0},
            {packageRole: 'support-rear', row: 0, column: 0},
            {packageRole: 'subject', row: 0, column: 1},
            {packageRole: 'support-front', row: 0, column: 2},
          ],
          },
          recoveryPolicy: {
            completeSourceContext: true,
            localDeterministicFixFirst: true,
            isolatedMemberGeneration: 'forbidden',
            providerRepair: 'masked-complete-source-edit',
            fallback: 'full-source-regeneration',
          },
        },
        },
      },
    }));
    fixture.spec.members = fixture.spec.members.map((member, index) => ({
      ...member,
      source: {
        kind: 'registered-layer-sheet',
        assetId: 'fixture-registered-sheet',
        packageRole: ['support-rear', 'subject', 'support-front'][index],
      },
      derivation: {},
    }));
    await assert.rejects(
      () => deriveRegisteredFamily({
        root: fixture.root,
        spec: fixture.spec,
        manifest: fixture.manifest,
      }),
      /必须是 reference \+ 三层的完整 2x2 sheet/,
    );
  } finally {
    await fs.rm(fixture.root, {recursive: true, force: true});
  }
});

test('registered-family CLI writes manifest provenance and a proof report without manual field repair', async () => {
  const prepared = await prepareRegisteredFamilyProof();
  const slug = `registered-family-cli-${process.pid}`;
  const root = process.cwd();
  const projectDirectory = path.join(root, 'projects', slug);
  const publicDirectory = path.join(root, 'public', 'projects', slug);
  const distDirectory = path.join(root, 'dist', slug);
  try {
    await fs.mkdir(projectDirectory, {recursive: true});
    const manifest = structuredClone(prepared.manifest);
    manifest.projectSlug = slug;
    const spec = {
      ...structuredClone(prepared.spec),
      projectSlug: slug,
      familyId: 'cli-family',
      applyToProject: false,
      members: prepared.spec.members.map((member) => ({
        ...member,
        assetId: `cli-${member.role}`,
        output: `public/projects/${slug}/${member.role}.png`,
      })),
    };
    await Promise.all([
      fs.writeFile(
        path.join(projectDirectory, 'project.json'),
        '{}\n',
        'utf8',
      ),
      fs.writeFile(
        path.join(projectDirectory, 'assets-manifest.json'),
        `${JSON.stringify(manifest, null, 2)}\n`,
        'utf8',
      ),
      fs.writeFile(
        path.join(projectDirectory, 'registered-family.json'),
        `${JSON.stringify(spec, null, 2)}\n`,
        'utf8',
      ),
    ]);
    const result = spawnSync(
      process.execPath,
      [
        path.join(root, 'scripts', 'derive-registered-family.mjs'),
        path.join('projects', slug, 'registered-family.json'),
      ],
      {cwd: root, encoding: 'utf8'},
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /provider image calls 0，avoided calls 3/);
    const updated = JSON.parse(await fs.readFile(
      path.join(projectDirectory, 'assets-manifest.json'),
      'utf8',
    ));
    const active = updated.assets.filter(
      ({assetId, lifecycle}) =>
        assetId.startsWith('cli-') && lifecycle.status === 'active',
    );
    assert.equal(active.length, 3);
    assert.ok(active.every(
      ({registeredFamilyBinding}) =>
        registeredFamilyBinding?.familyId === 'cli-family',
    ));
    const report = JSON.parse(await fs.readFile(
      path.join(distDirectory, 'registered-family', 'cli-family-report.json'),
      'utf8',
    ));
    assert.deepEqual(
      {
        providerImageCalls: report.providerImageCalls,
        localDerivatives: report.localDerivatives,
        avoidedCalls: report.avoidedCalls,
      },
      {providerImageCalls: 0, localDerivatives: 3, avoidedCalls: 3},
    );
  } finally {
    await fs.rm(projectDirectory, {recursive: true, force: true});
    await fs.rm(publicDirectory, {recursive: true, force: true});
    await fs.rm(distDirectory, {recursive: true, force: true});
  }
});

test('registered family group accepts a state-sequence subject only when every state keeps complete family context', async () => {
  const fixture = await makeFamilyFixture();
  try {
    const first = await deriveRegisteredFamily({
      root: fixture.root,
      spec: fixture.spec,
      manifest: structuredClone(fixture.manifest),
      now: '2026-07-23T01:00:00.000Z',
    });
    const variantFingerprint = 'a'.repeat(64);
    const variant = first.records.map((record) => {
      const cloned = structuredClone(record);
      cloned.assetId = `variant-${record.assetId}`;
      cloned.familyFingerprint = variantFingerprint;
      cloned.registeredFamilyBinding.familyId = 'fixture-family-variant';
      cloned.registeredFamilyBinding.familyFingerprint = variantFingerprint;
      cloned.registeredFamilyBinding.nodeId =
        `variant-${record.registeredFamilyBinding.nodeId}`;
      return cloned;
    });
    const recordForRole = (records, role) =>
      records.find(
        ({registeredFamilyBinding}) =>
          registeredFamilyBinding.role === role,
      );
    const rear = recordForRole(first.records, 'support-rear');
    const front = recordForRole(first.records, 'support-front');
    const subject = recordForRole(first.records, 'subject');
    const variantSubject = recordForRole(variant, 'subject');
    const group = {
      id: 'rig',
      kind: 'group',
      pattern: 'supported-subject',
      registration: fixture.registration,
      children: [
        {
          id: rear.registeredFamilyBinding.nodeId,
          kind: 'asset',
          slot: 'support-rear',
        },
        {
          id: 'water-levels',
          kind: 'state-sequence',
          slot: 'subject',
          states: [{src: 'low.png'}, {src: 'high.png'}],
        },
        {
          id: front.registeredFamilyBinding.nodeId,
          kind: 'asset',
          slot: 'support-front',
        },
      ],
    };
    const members = [
      {node: group.children[0], records: [rear]},
      {
        node: group.children[1],
        records: [subject, variantSubject],
      },
      {node: group.children[2], records: [front]},
    ];
    const complete = assertRegisteredFamilyGroupMembers({
      group,
      members,
      allRecords: [...first.records, ...variant],
    });
    assert.equal(complete.passed, true, complete.errors.join('\n'));
    assert.equal(complete.stateful, true);
    assert.deepEqual(
      complete.familyIds,
      ['fixture-family', 'fixture-family-variant'],
    );

    const incomplete = assertRegisteredFamilyGroupMembers({
      group,
      members,
      allRecords: [
        ...first.records,
        ...variant.filter(
          ({registeredFamilyBinding}) =>
            registeredFamilyBinding.role !== 'support-rear',
        ),
      ],
    });
    assert.equal(incomplete.passed, false);
    assert.match(incomplete.errors.join('\n'), /上下文不完整/);
  } finally {
    await fs.rm(fixture.root, {recursive: true, force: true});
  }
});

test('quality accepts registered-family state sequences and counts every visual state for alpha evidence', () => {
  const sequence = {
    id: 'water-levels',
    kind: 'state-sequence',
    slot: 'subject',
    poseFamilyId: 'water-levels',
    registration: {
      id: 'jar-registration',
      sourceMasterAssetId: 'jar-master',
      canvas: {width: 1920, height: 1080},
      origin: 'top-left',
    },
    states: ['low', 'mid', 'high'].map((id) => ({
      id,
      facing: 'neutral',
      anchors: {base: {x: 0.5, y: 0.85}},
      identityReferenceAssetId: 'jar-master',
      identityReferenceSha256: 'a'.repeat(64),
    })),
  };
  const stateRecords = sequence.states.map(({id}) => ({
    assetId: `jar-${id}`,
    registeredFamilyBinding: {
      familyId: `jar-family-${id}`,
      registrationId: 'jar-registration',
      sourceMasterAssetId: 'jar-master',
      slot: 'subject',
      canvas: {width: 1920, height: 1080},
      origin: 'top-left',
    },
  }));
  const status = stateSequenceRegistrationStatus({
    sequence,
    stateRecords,
    registeredFamily: {passed: true},
  });
  assert.equal(status.passed, true);
  assert.equal(status.mode, 'registered-family');
  assert.equal(status.poseStateRegistrationsBound, false);
  assert.equal(status.registeredFamilyStatesBound, true);

  assert.equal(
    expectedRegisteredFamilyAlphaEvidenceCount({
      group: {children: [{}, {}, {}]},
      familyRecords: [{}, {}, {}, {}, {}],
    }),
    5,
  );
  assert.equal(
    stateSequenceRegistrationStatus({
      sequence,
      stateRecords,
      registeredFamily: {passed: false},
    }).passed,
    false,
  );
});

const writeAlphaFixture = async ({file, residue = false, extreme = false}) => {
  const width = 240;
  const height = 180;
  const base = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs><filter id="shadow"><feGaussianBlur stdDeviation="5"/></filter></defs>
      <ellipse cx="120" cy="98" rx="56" ry="62" fill="#00000030" filter="url(#shadow)"/>
      <path d="M120 26 C82 32 62 70 68 113 C73 147 98 160 120 157 C146 160 171 143 174 108 C177 66 154 32 120 26 Z" fill="#a96f45"/>
      ${residue ? `<rect x="${extreme ? 4 : 48}" y="${extreme ? 4 : 42}" width="${extreme ? 232 : 144}" height="${extreme ? 172 : 116}" fill="none" stroke="#ffffff48" stroke-width="${extreme ? 1 : 2}"/>` : ''}
    </svg>
  `);
  await sharp(base).png().toFile(file);
  return {width, height};
};

test('alpha-band detector distinguishes natural contour/shadow from rectangular residue at both proof scales', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alpha-band-'));
  try {
    const negativeFile = path.join(root, 'negative.png');
    const positiveFile = path.join(root, 'positive.png');
    const extremeFile = path.join(root, 'extreme.png');
    await writeAlphaFixture({file: negativeFile});
    await writeAlphaFixture({file: positiveFile, residue: true});
    await writeAlphaFixture({file: extremeFile, residue: true, extreme: true});
    const negative = await inspectAlphaBands({
      file: negativeFile,
      renderSize: {width: 120, height: 90},
    });
    const positive = await inspectAlphaBands({
      file: positiveFile,
      renderSize: {width: 120, height: 90},
      derivationRegions: [{
        id: 'fixture-crop',
        kind: 'crop-boundary',
        rect: {left: 48, top: 42, width: 144, height: 116},
      }],
    });
    const extreme = await inspectAlphaBands({
      file: extremeFile,
      renderSize: {width: 96, height: 72},
    });
    assert.equal(negative.passed, true);
    assert.equal(positive.passed, false);
    assert.ok(positive.scales.some(({label}) => label === 'render-scale'));
    assert.ok(positive.failures.some(({diagnostic}) =>
      diagnostic.classification === 'rectangular-alpha-residue' ||
      diagnostic.classification === 'boundary-correlated-alpha-band'));
    assert.equal(extreme.passed, false);
    assert.equal(DEFAULT_ALPHA_BAND_THRESHOLDS.lowAlphaMaximum, 96);
  } finally {
    await fs.rm(root, {recursive: true, force: true});
  }
});

test('alpha topology rejects detached fragments and hard derivation rectangles', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alpha-topology-'));
  try {
    const cleanFile = path.join(root, 'clean.png');
    const fragmentFile = path.join(root, 'fragment.png');
    const cropFile = path.join(root, 'crop.png');
    const cleanSvg = Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="300" height="200">
        <path d="M70 30 C30 80 45 170 140 175 C230 180 265 95 220 35 C175 5 105 5 70 30 Z" fill="#9b6542"/>
      </svg>
    `);
    const fragmentSvg = Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="300" height="200">
        <path d="M70 30 C30 80 45 170 140 175 C230 180 265 95 220 35 C175 5 105 5 70 30 Z" fill="#9b6542"/>
        <rect x="272" y="8" width="18" height="28" fill="#9b6542"/>
      </svg>
    `);
    const cropSvg = Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="300" height="200">
        <rect x="60" y="40" width="180" height="120" fill="#9b6542"/>
      </svg>
    `);
    await sharp(cleanSvg).png().toFile(cleanFile);
    await sharp(fragmentSvg).png().toFile(fragmentFile);
    await sharp(cropSvg).png().toFile(cropFile);
    const clean = await inspectAlphaTopology({file: cleanFile});
    const fragment = await inspectAlphaTopology({file: fragmentFile});
    const declaredFragment = await inspectAlphaTopology({
      file: fragmentFile,
      expectedComponents: [{
        left: 272,
        top: 8,
        width: 18,
        height: 28,
      }],
    });
    const semanticScenery = await inspectAlphaTopology({
      file: fragmentFile,
      allowDetachedComponents: true,
    });
    const crop = await inspectAlphaTopology({
      file: cropFile,
      derivationRegions: [{
        id: 'fixture-clip',
        kind: 'crop-boundary',
        rect: {left: 60, top: 40, width: 180, height: 120},
      }],
    });
    assert.equal(clean.passed, true);
    assert.equal(fragment.passed, false);
    assert.ok(fragment.failures.some(({diagnostic}) =>
      diagnostic.classification === 'detached-rectangular-alpha-fragment'));
    assert.equal(declaredFragment.passed, true);
    assert.equal(semanticScenery.passed, true);
    assert.equal(semanticScenery.allowDetachedComponents, true);
    assert.equal(crop.passed, false);
    const semanticCrop = await inspectAlphaTopology({
      file: cropFile,
      derivationRegions: [{
        id: 'fixture-clip',
        kind: 'crop-boundary',
        rect: {left: 60, top: 40, width: 180, height: 120},
      }],
      allowDetachedComponents: true,
    });
    assert.equal(semanticCrop.passed, false);
    assert.ok(crop.failures.some(({diagnostic}) =>
      diagnostic.classification === 'hard-rectangular-derivation-boundary'));
  } finally {
    await fs.rm(root, {recursive: true, force: true});
  }
});

test('registered-family fixture proof rejects misleading project arguments', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/prove-registered-family.mjs', 'not-a-project-proof'],
    {cwd: path.resolve('.',), encoding: 'utf8'},
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /内置 fixture 证明/);
  assert.match(result.stderr, /project:composition-proof/);
});
