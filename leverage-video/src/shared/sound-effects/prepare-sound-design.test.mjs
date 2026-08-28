import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {prepareKnowledgeVideoSoundDesign} from './prepare-sound-design.mjs';

const manifest = (revision) => ({
  path: `leverage-video/src/shared/sound-effects/manifest-v${revision}.json`,
  checksum_sha256: String(revision).repeat(64),
});
const asset = {
  asset_id: 'exact-reveal', semantic_roles: ['exact_reveal'], timbre_family: 'paper',
};
const input = {
  resume_mode: 'standard',
  episode_workspace: 'leverage-video/src/topic99',
  bindings: {sound_effect_library: manifest(3)},
  event_decisions: [{
    event_id: 'S01:semantic:reveal', decision: 'audible', semantic_role: 'exact_reveal',
    reason: '纸卡真实入场', intensity: 'micro', gain_multiplier: 0.2,
    selection_basis: {
      selection_method: 'hard-gates-then-deterministic-ranking-v1',
      semantic_role: 'exact_reveal',
      selected_asset_id: 'exact-reveal',
      hard_gate_results: {
        license: true, media: true, semantic_role: true, motion_direction: true,
      },
    },
    acquisition_request: {
      asset_id: 'exact-reveal', title: 'Exact reveal', semantic_roles: ['exact_reveal'],
    },
    derivative_request: {
      output_path: 'leverage-video/src/topic99/assets/audio/sfx/exact-reveal.wav',
      trim_start_sample: 0, trim_end_sample: 4410,
    },
  }],
};

test('announces, acquires an exact missing role, refreshes the library binding, and continues', async () => {
  let current = {manifest: manifest(3), assets: []};
  const announcements = [];
  const result = await prepareKnowledgeVideoSoundDesign(input, {
    repositoryRoot: '/tmp/repository',
    loadLibraryImpl: () => current,
    acquireImpl: async () => { current = {manifest: manifest(4), assets: [asset]}; },
    buildDerivedImpl: ({outputPath}) => ({path: outputPath, asset: outputPath}),
    buildDesignImpl: (prepared, options) => ({prepared, options}),
    announceImpl: (message) => announcements.push(message),
  });
  assert.match(announcements[0], /将下载音效“Exact reveal”/);
  assert.equal(result.prepared.bindings.sound_effect_library.path, manifest(4).path);
  assert.equal(result.prepared.event_decisions[0].asset_id, 'exact-reveal');
  assert.equal(result.prepared.event_decisions[0].acquisition_request, undefined);
  assert.equal(result.options.libraryValidation.manifest.path, manifest(4).path);
});

test('reuses an exact active asset without downloading', async () => {
  let acquisitionCalls = 0;
  const result = await prepareKnowledgeVideoSoundDesign(input, {
    repositoryRoot: '/tmp/repository',
    loadLibraryImpl: () => ({manifest: manifest(3), assets: [asset]}),
    acquireImpl: async () => { acquisitionCalls += 1; },
    buildDerivedImpl: ({outputPath}) => ({path: outputPath, asset: outputPath}),
    buildDesignImpl: (prepared) => prepared,
    announceImpl: () => { throw new Error('reuse must not announce a download'); },
  });
  assert.equal(acquisitionCalls, 0);
  assert.equal(result.event_decisions[0].asset_id, 'exact-reveal');
});

test('blocks absent licensing input and never substitutes an approximate role', async () => {
  const missing = structuredClone(input);
  delete missing.event_decisions[0].acquisition_request;
  await assert.rejects(() => prepareKnowledgeVideoSoundDesign(missing, {
    repositoryRoot: '/tmp/repository',
    loadLibraryImpl: () => ({
      manifest: manifest(3),
      assets: [{asset_id: 'approximate', semantic_roles: ['other_role']}],
    }),
  }), /exact official acquisition request/);
});

test('blocks failed hard-gate evidence before reuse or acquisition', async () => {
  const blocked = structuredClone(input);
  blocked.event_decisions[0].selection_basis.hard_gate_results.motion_direction = false;
  let acquisitionCalls = 0;
  await assert.rejects(() => prepareKnowledgeVideoSoundDesign(blocked, {
    repositoryRoot: '/tmp/repository',
    loadLibraryImpl: () => ({manifest: manifest(3), assets: [asset]}),
    acquireImpl: async () => { acquisitionCalls += 1; },
  }), /hard-gate selection evidence/);
  assert.equal(acquisitionCalls, 0);
});

test('cleans only derivatives created by the failed preparation transaction', async (t) => {
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sound-prepare-test-'));
  t.after(() => fs.rmSync(repositoryRoot, {recursive: true, force: true}));
  const relative = input.event_decisions[0].derivative_request.output_path;
  const absolute = path.join(repositoryRoot, relative);
  await assert.rejects(() => prepareKnowledgeVideoSoundDesign(input, {
    repositoryRoot,
    loadLibraryImpl: () => ({manifest: manifest(3), assets: [asset]}),
    buildDerivedImpl: () => {
      fs.mkdirSync(path.dirname(absolute), {recursive: true});
      fs.writeFileSync(absolute, 'task-created');
      return {path: relative, asset: relative};
    },
    buildDesignImpl: () => { throw new Error('design failed'); },
  }), /design failed/);
  assert.equal(fs.existsSync(absolute), false);
});

test('revoice cannot analyze, acquire, or add sound effects', async () => {
  await assert.rejects(() => prepareKnowledgeVideoSoundDesign({resume_mode: 'revoice_variant'}),
    /forbidden for revoice/);
});
