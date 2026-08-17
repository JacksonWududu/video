import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {
  compilePhase2Storyboard,
  createPhase2EditorialAuthoring,
  createPhase2Project,
} from '../fixtures/phase2-proof-fixture.mjs';
import {
  compileEditorialSystem,
  validateEditorialAuthoring,
  validateEditorialTransitionExecution,
} from '../scripts/editorial-system-lib.mjs';
import {validateProject} from '../scripts/project-lib.mjs';
import {preparePhase2Media} from '../scripts/phase2-proof-lib.mjs';
import {
  ASSET_HARDENING_PROOF_DIR,
  prepareAlphaBandProof,
  prepareRegisteredFamilyProof,
} from '../scripts/asset-hardening-proof-lib.mjs';
import {
  applyResponsiveDirectingPlan,
  fitEditorialTypography,
  resolveAnnotationRoute,
  resolveDataDomain,
  secondsToFrame,
  stableEditorialHash,
  validateDataGraphicNode,
} from '../src/editorialPrimitives.mjs';

const media = await preparePhase2Media();
const registeredFamily = await prepareRegisteredFamilyProof();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('browser-compatible editorial fingerprints are standard SHA-256', () => {
  const value = {mixed: '中文 English 123', nested: [true, 3.5, null]};
  const expected = createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex');
  assert.equal(stableEditorialHash(value), expected);
});

test('v9 actual-audio edit points resolve media, scene, and render frames deterministically', () => {
  const storyboard = compilePhase2Storyboard({media});
  const points = new Map(
    storyboard.editorial.resolvedEditPoints.map((point) => [point.id, point]),
  );
  assert.equal(points.get('ep-s1-word-1').mediaFrame, secondsToFrame(0.45, 30));
  assert.equal(points.get('ep-s1-word-1').sceneFrame, 14);
  assert.equal(points.get('ep-s1-word-1').renderFrame, 14);
  assert.equal(points.get('ep-s2-data-1').mediaFrame, secondsToFrame(3.45, 30));
  assert.equal(points.get('ep-s2-data-1').sceneFrame, 14);
  assert.equal(points.get('ep-s2-data-1').renderFrame, 104);
  assert.equal(points.get('ep-sfx-onset').renderFrame, 25);
  assert.equal(points.get('ep-boundary').renderFrame, 90);
  assert.deepEqual(points.get('ep-s1-emphasis').sources, ['authored', 'detected']);
  assert.ok(
    storyboard.editorial.conflicts.some(
      ({editPointIds, resolution}) =>
        editPointIds.includes('ep-music-conflict') &&
        resolution === 'offset-within-window',
    ),
  );
});

test('v9 word timing policy blocks or explicitly degrades missing word timestamps', () => {
  const authoring = createPhase2EditorialAuthoring({media});
  authoring.cues = authoring.cues.filter(
    ({sceneId, kind}) =>
      sceneId !== 'phase2-scene-1' || kind !== 'narration-word',
  );
  authoring.editPoints = authoring.editPoints.filter(
    ({cueIds}) => cueIds.every((id) => authoring.cues.some((cue) => cue.id === id)),
  );
  authoring.bindings = authoring.bindings.filter(
    ({editPointId}) =>
      authoring.editPoints.some(({id}) => id === editPointId),
  );
  authoring.bindings.push({
    id: 'binding-word-policy-proof',
    sceneId: 'phase2-scene-1',
    targetType: 'typography-reveal',
    targetId: 'title-1',
    editPointId: 'ep-s1-open',
    mode: 'word',
  });
  let issues = validateEditorialAuthoring(authoring, {
    fps: 30,
    scenes: [{id: 'phase2-scene-1'}, {id: 'phase2-scene-2'}],
  });
  assert.ok(issues.some(({code}) => code === 'editorial-word-timing-missing'));
  authoring.wordTimingPolicy = 'phrase-fallback';
  issues = validateEditorialAuthoring(authoring, {
    fps: 30,
    scenes: [{id: 'phase2-scene-1'}, {id: 'phase2-scene-2'}],
  });
  assert.ok(!issues.some(({code}) => code === 'editorial-word-timing-missing'));
});

test('typography fits mixed Chinese English and digits and reports deterministic overflow', () => {
  const fitted = fitEditorialTypography({
    text: '数据 DATA 42 帧精准编辑',
    width: 520,
    height: 150,
    minFontSize: 24,
    maxFontSize: 84,
    maxLines: 2,
    lineHeight: 1.05,
    letterSpacing: -1,
  });
  assert.equal(fitted.overflow, false);
  assert.ok(fitted.fontSize >= 24 && fitted.fontSize <= 84);
  const overflow = fitEditorialTypography({
    text: '这是一段故意非常非常长的中文 English 123 mixed typography overflow fixture',
    width: 80,
    height: 22,
    minFontSize: 28,
    maxFontSize: 48,
    maxLines: 1,
    lineHeight: 1.2,
  });
  assert.equal(overflow.overflow, true);
});

test('annotation routing validates anchors, exclusions, bounds, and invalid targets', () => {
  const project = createPhase2Project({media, profileId: '16:9'});
  const scene = project.scenes[0];
  const annotation = scene.composition.nodes.find(
    ({id}) => id === 'annotation-arrow',
  );
  const zones = project.editorial.responsiveProfiles.find(
    ({id}) => id === '16:9',
  ).exclusionZones;
  const route = resolveAnnotationRoute({
    node: annotation,
    nodes: scene.composition.nodes,
    zones,
  });
  assert.equal(route.valid, true);
  assert.equal(route.directBlocked, false);
  const invalid = resolveAnnotationRoute({
    node: {
      ...annotation,
      target: {targetId: 'missing-target', anchor: 'center'},
    },
    nodes: scene.composition.nodes,
    zones,
  });
  assert.equal(invalid.valid, false);
  assert.equal(invalid.reason, 'invalid-target');
});

test('data SVG contracts validate all graphic kinds, domains, empty input, and map geometry', () => {
  const project = createPhase2Project({media, profileId: '16:9'});
  const dataNodes = project.scenes.flatMap((scene) => {
    const result = [];
    const visit = (nodes) => {
      for (const node of nodes) {
        if (node.kind === 'data-graphic') result.push(node);
        if (node.kind === 'group') visit(node.children);
        if (node.kind === 'editorial-switch') {
          visit(node.panels.map(({node: panel}) => panel));
        }
      }
    };
    visit(scene.composition.nodes);
    return result;
  });
  assert.deepEqual(
    [...new Set(dataNodes.map(({graphicKind}) => graphicKind))].sort(),
    [
      'bar-chart',
      'column-chart',
      'comparison-table',
      'flow',
      'line-chart',
      'map',
      'timeline',
    ],
  );
  assert.ok(dataNodes.every((node) => validateDataGraphicNode(node).length === 0));
  assert.deepEqual(resolveDataDomain(dataNodes[0]), [0, 100]);
  const empty = structuredClone(dataNodes.find(({graphicKind}) => graphicKind === 'bar-chart'));
  empty.data.values = [];
  assert.ok(validateDataGraphicNode(empty).some(({code}) => code === 'data-empty'));
  const map = structuredClone(dataNodes.find(({graphicKind}) => graphicKind === 'map'));
  map.data.regions.push({regionId: 'missing', value: 42});
  assert.ok(
    validateDataGraphicNode(map).some(
      ({code}) => code === 'map-region-geometry',
    ),
  );
});

test('one semantic storyboard compiles three explicit responsive plans without renderer branches', () => {
  const storyboard = compilePhase2Storyboard({media});
  assert.deepEqual(
    storyboard.editorial.responsivePlans.map(({profileId}) => profileId),
    ['16:9', '9:16', '1:1'],
  );
  for (const profileId of ['16:9', '9:16', '1:1']) {
    const project = createPhase2Project({media, profileId});
    const reapplied = applyResponsiveDirectingPlan(project);
    assert.deepEqual(reapplied, project);
    assert.ok(
      project.scenes.every(
        (scene) =>
          scene.composition.coordinateSpace.width === project.video.width &&
          scene.composition.coordinateSpace.height === project.video.height,
      ),
    );
    const plan = project.editorial.responsivePlans.find(
      ({profileId: candidate}) => candidate === profileId,
    );
    assert.ok(
      plan.scenes.every(({densityUsed}) => densityUsed <= plan.densityBudget),
    );
  }
});

test('advanced transitions prove declared dimensions and reject disguised fades or descriptor drift', () => {
  const storyboard = compilePhase2Storyboard({media});
  assert.deepEqual(
    storyboard.editorial.transitionPlans.map(({type}) => type),
    [
      'match-cut',
      'graphic-match',
      'shape-match',
      'position-scale-match',
      'color-value-match',
      'within-shot-card-switch',
      'panel-replace',
      'data-state-transition',
    ],
  );
  assert.ok(
    storyboard.editorial.transitionPlans.every(
      ({continuity, invalidProfiles}) =>
        invalidProfiles.length === 0 &&
        continuity.every(
          ({valid, dimensionChecks}) =>
            valid &&
            Object.values(dimensionChecks).every((check) => check.valid),
        ),
    ),
  );
  const project = createPhase2Project({media, profileId: '16:9'});
  assert.deepEqual(
    validateEditorialTransitionExecution({
      editorial: project.editorial,
      scenes: project.scenes,
    }),
    [],
  );
  const drifted = structuredClone(project);
  drifted.scenes[1].composition.nodes.find(
    ({id}) => id === 'match-destination',
  ).style.fill = '#000000';
  assert.ok(
    validateEditorialTransitionExecution({
      editorial: drifted.editorial,
      scenes: drifted.scenes,
    }).some(({code}) => code === 'editorial-transition-destination-descriptor'),
  );
  const authoring = createPhase2EditorialAuthoring({media});
  authoring.transitions[0].treatment = 'slide';
  assert.throws(
    () =>
      compileEditorialSystem({
        editorial: authoring,
        scenes: [
          {id: 'phase2-scene-1', estimatedDurationSeconds: 3},
          {id: 'phase2-scene-2', estimatedDurationSeconds: 3},
        ],
        sceneTransitions: [],
        fps: 30,
      }),
    /必须使用 hard-cut/,
  );
});

test('project validation binds final local audio, timing evidence, fonts, and compiled v9 editorial', async () => {
  const storyboard = compilePhase2Storyboard({media});
  const project = createPhase2Project({media, profileId: '1:1'});
  const result = await validateProject(project, {
    storyboard,
    manifest: registeredFamily.manifest,
  });
  assert.ok(!result.issues.some(({level}) => level === 'error'));
  const missingFont = structuredClone(project);
  missingFont.theme.fontFile = 'fixtures/vox-phase2-proof/missing-font.woff2';
  const missingFontResult = await validateProject(missingFont, {
    storyboard,
    manifest: registeredFamily.manifest,
  });
  assert.ok(
    missingFontResult.issues.some(
      ({code}) => code === 'shared-asset-missing',
    ),
  );
  const invalidFontFile = path.join(
    ROOT,
    'public',
    'fixtures',
    'vox-phase2-proof',
    'invalid-font.woff2',
  );
  try {
    await fs.writeFile(invalidFontFile, 'not-a-font');
    const invalidFont = structuredClone(project);
    invalidFont.theme.fontFile = 'fixtures/vox-phase2-proof/invalid-font.woff2';
    const invalidFontResult = await validateProject(invalidFont, {
      storyboard,
      manifest: registeredFamily.manifest,
    });
    assert.ok(
      invalidFontResult.issues.some(
        ({code}) => code === 'font-load-invalid',
      ),
    );
  } finally {
    await fs.rm(invalidFontFile, {force: true});
  }
});

test('project validation reports low-alpha rectangular residue independently from key-edge checks', async () => {
  await prepareAlphaBandProof();
  const storyboard = compilePhase2Storyboard({media});
  const project = createPhase2Project({media, profileId: '16:9'});
  const source = path.join(
    ASSET_HARDENING_PROOF_DIR,
    'alpha-bands',
    'positive.png',
  );
  const destination = path.join(
    ROOT,
    'public',
    'fixtures',
    'vox-phase2-proof',
    'registered-family',
    'project-validation-positive.png',
  );
  try {
    await fs.copyFile(source, destination);
    const group = project.scenes[0].composition.nodes.find(
      ({id}) => id === 'phase2-depth-stack',
    );
    group.children.find(({id}) => id === 'phase2-subject').src =
      'fixtures/vox-phase2-proof/registered-family/project-validation-positive.png';
    const manifest = structuredClone(registeredFamily.manifest);
    const original = manifest.assets.find(
      ({assetId, lifecycle}) =>
        assetId === 'phase2-subject' && lifecycle.status === 'active',
    );
    original.lifecycle = {
      status: 'superseded',
      changedAt: '2026-07-23T00:00:01.000Z',
      reason: 'project-validation-positive-fixture',
      supersededBy: 'b'.repeat(64),
    };
    manifest.assets.push({
      ...structuredClone(original),
      recordId: 'b'.repeat(64),
      file: path.relative(ROOT, destination),
      lifecycle: {
        status: 'active',
        changedAt: '2026-07-23T00:00:01.000Z',
        reason: 'project-validation-positive-fixture',
        supersededBy: null,
      },
      registeredFamilyBinding: {
        ...structuredClone(original.registeredFamilyBinding),
        derivation: {
          ...structuredClone(original.registeredFamilyBinding.derivation),
          clip: {
            kind: 'rectangle',
            rect: {left: 92, top: 58, width: 296, height: 214},
          },
        },
      },
    });
    const result = await validateProject(project, {
      storyboard,
      manifest,
    });
    assert.ok(
      result.issues.some(
        ({code}) => code === 'composition-rectangular-alpha-band',
      ),
    );
    assert.ok(
      !result.issues
        .filter(({code}) => code === 'composition-key-edge')
        .some(({message}) => message.includes('矩形裁切带')),
    );
  } finally {
    await fs.rm(destination, {force: true});
  }
});
