import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

import registry from './registry.json' with {type: 'json'};
import {
  buildModuleFingerprint,
  registryChecksum,
  validateReuseDecision,
} from './validate-reuse-decision.mjs';
import {sha256File} from '../episode-tooling/file-integrity.mjs';

const episodeWorkspace = 'leverage-video/src/example';
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

const completeDecision = () => ({
  schema_version: 'shared-reuse-decision-v1',
  episode_workspace: episodeWorkspace,
  registry_checksum_sha256: registryChecksum(registry),
  audited_at: '2026-08-14T00:00:00.000Z',
  pre_script_inventory: [],
  decisions: registry.modules.map((module) => ({
    module_id: module.module_id,
    module_fingerprint_sha256: buildModuleFingerprint(module),
    decision: module.required_for_new_episode_script ? 'reuse' : 'not_applicable',
    reason: module.required_for_new_episode_script
      ? 'The active episode contract consumes this mandatory shared module.'
      : 'The active storyboard has no feature that requires this optional module.',
    consumers: [],
    verification: [],
  })),
});

const completeLegacyDecision = (workspace, scriptInventory) => ({
  ...completeDecision(),
  episode_workspace: workspace,
  audit_mode: 'authorized_legacy_migration-v1',
  pre_script_inventory: null,
  legacy_script_inventory: scriptInventory,
  legacy_script_inventory_digest_sha256: crypto
    .createHash('sha256')
    .update(JSON.stringify(scriptInventory))
    .digest('hex'),
  legacy_additions: [],
  authorization: {
    exact_user_message: '授权',
    authorized_at: '2026-08-14T00:00:00.000Z',
    scope: 'One-time shared reuse migration for the identified legacy episode only.',
  },
});

test('registers v3 action, visual rhythm, generic intra-shot transitions, routing, and specialized scenes', () => {
  const actionSchedule = registry.modules.find((module) => module.module_id === 'action-state-schedule');
  assert.equal(actionSchedule?.path, 'leverage-video/src/shared/action-state-schedule');
  assert.match(actionSchedule?.use_when ?? '', /v3 semantic action states.*revoice/i);
  const intraShotTransitions = registry.modules.find((module) => module.module_id === 'intra-shot-transitions');
  assert.equal(intraShotTransitions?.path, 'leverage-video/src/shared/intra-shot-transitions');
  assert.match(intraShotTransitions?.use_when ?? '', /explicit cut.*user-approved watercolor-bloom/i);
  const visualRhythm = registry.modules.find((module) => module.module_id === 'storyboard-visual-rhythm');
  assert.equal(visualRhythm?.path, 'leverage-video/src/shared/storyboard-visual-rhythm');
  assert.match(visualRhythm?.use_when ?? '', /motion tiers.*meaningful visual changes.*QA warnings/i);
  const routeCatalog = registry.modules.find((module) => module.module_id === 'visual-generation-routes');
  assert.equal(routeCatalog?.path, 'leverage-video/src/shared/visual-generation-routes');
  assert.match(routeCatalog?.use_when ?? '', /per-shot.*white-cat.*route/i);
  const videoScenes = registry.modules.find((module) => module.module_id === 'video-scenes');
  assert.match(videoScenes?.use_when ?? '', /Ink/);
  assert.match(videoScenes?.use_when ?? '', /DoodleScene.*historical read-only/);
  assert.match(videoScenes?.use_when ?? '', /WhiteboardScene/);
  assert.match(videoScenes?.use_when ?? '', /LocalVideoScene/);
  assert.match(videoScenes?.use_when ?? '', /ComicScene/);
  assert.match(routeCatalog?.use_when ?? '', /comic-imagegen/);
  assert.match(routeCatalog?.use_when ?? '', /optional Whiteboard or local-video-file/i);
  const visualLanguage = registry.modules.find((module) => module.module_id === 'visual-language');
  assert.equal(visualLanguage?.path, 'leverage-video/src/shared/visual-language');
  assert.match(visualLanguage?.use_when ?? '', /visual_structure_id.*treatment_profile_id.*Comic/i);
  const reviewForm = registry.modules.find((module) => module.module_id === 'visual-direction-review-form');
  assert.equal(reviewForm?.path, 'leverage-video/src/shared/visual-direction-review-form');
  assert.match(reviewForm?.use_when ?? '', /seven-column.*partial structured submissions.*route treatments/i);
  const localVideo = registry.modules.find((module) => module.module_id === 'local-video-match');
  assert.equal(localVideo?.path, 'leverage-video/src/shared/local-video-match');
  assert.match(localVideo?.use_when ?? '', /Deferring.*exact source bytes.*exact shot frames/i);
});

test('requires one explicit decision for every registered shared module', () => {
  const decision = completeDecision();
  assert.equal(validateReuseDecision(registry, decision, {episodeWorkspace}).result, 'pass');

  decision.decisions.pop();
  assert.throws(
    () => validateReuseDecision(registry, decision, {episodeWorkspace}),
    /missing decision/,
  );
});

test('rejects empty reasons and unknown modules', () => {
  const decision = completeDecision();
  decision.decisions[0].reason = '';
  assert.throws(
    () => validateReuseDecision(registry, decision, {episodeWorkspace}),
    /concrete reason/,
  );
});

test('rejects stale registry and module fingerprints', () => {
  const decision = completeDecision();
  decision.registry_checksum_sha256 = '0'.repeat(64);
  assert.throws(
    () => validateReuseDecision(registry, decision, {episodeWorkspace}),
    /registry checksum mismatch/,
  );
  decision.registry_checksum_sha256 = registryChecksum(registry);
  decision.decisions[0].module_fingerprint_sha256 = '0'.repeat(64);
  assert.throws(
    () => validateReuseDecision(registry, decision, {episodeWorkspace}),
    /module fingerprint mismatch/,
  );
});

test('reuse decisions require verified consumer source files', () => {
  const decision = completeDecision();
  decision.decisions[0] = {
    ...decision.decisions[0],
    decision: 'reuse',
    reason: 'The episode assembly imports the shared plan builder.',
  };
  assert.throws(
    () => validateReuseDecision(registry, decision, {episodeWorkspace, phase: 'consumption'}),
    /consumer source/,
  );
});

test('mandatory modules cannot be marked not applicable', () => {
  const decision = completeDecision();
  decision.decisions.find((item) => item.module_id === 'video-scenes').decision = 'not_applicable';
  assert.throws(
    () => validateReuseDecision(registry, decision, {episodeWorkspace}),
    /mandatory for every new episode script/,
  );
});

test('rejects non-empty pre-script inventories', () => {
  const decision = completeDecision();
  decision.pre_script_inventory = [{path: 'leverage-video/src/example/script/video.tsx'}];
  assert.throws(
    () => validateReuseDecision(registry, decision, {episodeWorkspace}),
    /pre-script inventory must be empty/,
  );
});

test('rejects consumer paths that traverse outside the episode script directory', () => {
  const decision = completeDecision();
  const item = decision.decisions.find((candidate) => candidate.module_id === 'assembly-plan');
  item.consumers = [{
    kind: 'source',
    path: 'leverage-video/src/example/script/../../shared/assembly-plan/build-assembly-plan.mjs',
    checksum_sha256: '0'.repeat(64),
    shared_import_marker: 'shared/assembly-plan',
  }];
  assert.throws(
    () => validateReuseDecision(registry, decision, {episodeWorkspace, phase: 'consumption'}),
    /inside the episode script directory/,
  );
});

test('accepts real source imports for mandatory shared modules', () => {
  const temporaryEpisode = fs.mkdtempSync(path.join(repositoryRoot, 'leverage-video/src/__shared-consumer-'));
  const scriptDirectory = path.join(temporaryEpisode, 'script');
  const sourcePath = path.join(scriptDirectory, 'index.ts');
  fs.mkdirSync(scriptDirectory);
  fs.writeFileSync(sourcePath, [
    "import {buildKnowledgeVideoAssemblyPlan} from '../../shared/assembly-plan/build-assembly-plan.mjs';",
    "import {KnowledgeVideo} from '../../shared/video-scenes';",
    'void buildKnowledgeVideoAssemblyPlan;',
    'void KnowledgeVideo;',
    '',
  ].join('\n'));
  try {
    const workspace = path.relative(repositoryRoot, temporaryEpisode);
    const decision = completeDecision();
    decision.episode_workspace = workspace;
    const consumerPath = path.relative(repositoryRoot, sourcePath);
    const consumers = {
      'assembly-plan': [{
        kind: 'source',
        path: consumerPath,
        checksum_sha256: sha256File(sourcePath),
        shared_import_marker: 'shared/assembly-plan',
      }],
      'video-scenes': [{
        kind: 'source',
        path: consumerPath,
        checksum_sha256: sha256File(sourcePath),
        shared_import_marker: 'shared/video-scenes',
      }],
    };
    for (const item of decision.decisions) item.consumers = consumers[item.module_id] ?? [];
    assert.equal(
      validateReuseDecision(registry, decision, {episodeWorkspace: workspace, phase: 'consumption'}).result,
      'pass',
    );
  } finally {
    fs.unlinkSync(sourcePath);
    fs.rmdirSync(scriptDirectory);
    fs.rmdirSync(temporaryEpisode);
  }
});

test('accepts an explicitly authorized legacy migration with an exact current script inventory', () => {
  const temporaryEpisode = fs.mkdtempSync(path.join(repositoryRoot, 'leverage-video/src/__legacy-reuse-'));
  const scriptDirectory = path.join(temporaryEpisode, 'script');
  const sourcePath = path.join(scriptDirectory, 'index.ts');
  fs.mkdirSync(scriptDirectory);
  fs.writeFileSync(sourcePath, [
    "import {buildKnowledgeVideoAssemblyPlan} from '../../shared/assembly-plan/build-assembly-plan.mjs';",
    "import {KnowledgeVideo} from '../../shared/video-scenes';",
    'void buildKnowledgeVideoAssemblyPlan;',
    'void KnowledgeVideo;',
    '',
  ].join('\n'));
  try {
    const workspace = path.relative(repositoryRoot, temporaryEpisode);
    const consumerPath = path.relative(repositoryRoot, sourcePath);
    const inventory = [{path: consumerPath, checksum_sha256: sha256File(sourcePath)}];
    const decision = completeLegacyDecision(workspace, inventory);
    const consumers = {
      'assembly-plan': [{
        kind: 'source',
        path: consumerPath,
        checksum_sha256: sha256File(sourcePath),
        shared_import_marker: 'shared/assembly-plan',
      }],
      'video-scenes': [{
        kind: 'source',
        path: consumerPath,
        checksum_sha256: sha256File(sourcePath),
        shared_import_marker: 'shared/video-scenes',
      }],
    };
    for (const item of decision.decisions) item.consumers = consumers[item.module_id] ?? [];

    assert.equal(
      validateReuseDecision(registry, decision, {episodeWorkspace: workspace, phase: 'legacy-migration'}).result,
      'pass',
    );
    assert.equal(
      validateReuseDecision(registry, decision, {episodeWorkspace: workspace, phase: 'consumption'}).result,
      'pass',
    );
  } finally {
    fs.unlinkSync(sourcePath);
    fs.rmdirSync(scriptDirectory);
    fs.rmdirSync(temporaryEpisode);
  }
});

test('legacy migration and consumption use the same bytewise inventory order', () => {
  const temporaryEpisode = fs.mkdtempSync(path.join(repositoryRoot, 'leverage-video/src/__legacy-order-'));
  const scriptDirectory = path.join(temporaryEpisode, 'script');
  const openingPath = path.join(scriptDirectory, 'video/EpisodeOpening.tsx');
  const demoPath = path.join(scriptDirectory, 'video/demos/Demo.tsx');
  fs.mkdirSync(path.dirname(demoPath), {recursive: true});
  fs.writeFileSync(openingPath, [
    "import {buildKnowledgeVideoAssemblyPlan} from '../../../../shared/assembly-plan/build-assembly-plan.mjs';",
    "import {KnowledgeVideo} from '../../../../shared/video-scenes';",
    'void buildKnowledgeVideoAssemblyPlan;',
    'void KnowledgeVideo;',
    '',
  ].join('\n'));
  fs.writeFileSync(demoPath, 'export const demo = true;\n');
  try {
    const workspace = path.relative(repositoryRoot, temporaryEpisode);
    const inventory = [openingPath, demoPath]
      .sort()
      .map((file) => ({
        path: path.relative(repositoryRoot, file),
        checksum_sha256: sha256File(file),
      }));
    const decision = completeLegacyDecision(workspace, inventory);
    const consumerPath = path.relative(repositoryRoot, openingPath);
    for (const item of decision.decisions) {
      if (item.module_id === 'assembly-plan') {
        item.consumers = [{
          kind: 'source',
          path: consumerPath,
          checksum_sha256: sha256File(openingPath),
          shared_import_marker: 'shared/assembly-plan',
        }];
      }
      if (item.module_id === 'video-scenes') {
        item.consumers = [{
          kind: 'source',
          path: consumerPath,
          checksum_sha256: sha256File(openingPath),
          shared_import_marker: 'shared/video-scenes',
        }];
      }
    }
    assert.equal(
      validateReuseDecision(registry, decision, {episodeWorkspace: workspace, phase: 'legacy-migration'}).result,
      'pass',
    );
    assert.equal(
      validateReuseDecision(registry, decision, {episodeWorkspace: workspace, phase: 'consumption'}).result,
      'pass',
    );
  } finally {
    fs.rmSync(temporaryEpisode, {recursive: true});
  }
});

test('legacy migration rejects missing authorization and changed script bytes', () => {
  const temporaryEpisode = fs.mkdtempSync(path.join(repositoryRoot, 'leverage-video/src/__legacy-reuse-'));
  const scriptDirectory = path.join(temporaryEpisode, 'script');
  const sourcePath = path.join(scriptDirectory, 'index.ts');
  fs.mkdirSync(scriptDirectory);
  fs.writeFileSync(sourcePath, 'export const legacy = true;\n');
  try {
    const workspace = path.relative(repositoryRoot, temporaryEpisode);
    const inventory = [{
      path: path.relative(repositoryRoot, sourcePath),
      checksum_sha256: sha256File(sourcePath),
    }];
    const decision = completeLegacyDecision(workspace, inventory);
    delete decision.authorization;
    assert.throws(
      () => validateReuseDecision(registry, decision, {episodeWorkspace: workspace, phase: 'legacy-migration'}),
      /authorization/,
    );

    decision.authorization = {
      exact_user_message: '授权',
      authorized_at: '2026-08-14T00:00:00.000Z',
      scope: 'One-time shared reuse migration for the identified legacy episode only.',
    };
    fs.appendFileSync(sourcePath, 'export const changed = true;\n');
    assert.throws(
      () => validateReuseDecision(registry, decision, {episodeWorkspace: workspace, phase: 'legacy-migration'}),
      /legacy script inventory/,
    );
  } finally {
    fs.unlinkSync(sourcePath);
    fs.rmdirSync(scriptDirectory);
    fs.rmdirSync(temporaryEpisode);
  }
});

test('legacy migration cannot masquerade as a pre-script audit', () => {
  const decision = completeLegacyDecision(episodeWorkspace, []);
  assert.throws(
    () => validateReuseDecision(registry, decision, {episodeWorkspace, phase: 'pre-script'}),
    /legacy migration.*pre-script|pre-script.*legacy migration/i,
  );
});
