#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {atomicWriteJson} from '../episode-tooling/file-integrity.mjs';
import {acquireSoundEffect} from './acquire-sound-effect.mjs';
import {buildSoundEffectDerivedWav} from './build-derived-wav.mjs';
import {buildKnowledgeVideoSoundDesign} from './build-sound-design.mjs';
import {loadAndValidateSharedSoundEffectLibrary} from './contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPOSITORY_ROOT = path.resolve(HERE, '../../../..');

const resolveRepositoryPath = (repositoryRoot, rootRelativePath) => {
  if (typeof rootRelativePath !== 'string' || rootRelativePath === ''
      || path.isAbsolute(rootRelativePath)
      || rootRelativePath.replaceAll('\\', '/').split('/').includes('..')) {
    throw new Error('task-created derivative path is invalid');
  }
  const resolved = path.resolve(repositoryRoot, rootRelativePath);
  const relative = path.relative(repositoryRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('task-created derivative path escapes repository');
  }
  return resolved;
};

const selectExistingAsset = (decision, library) => {
  const matches = library.assets.filter(({semantic_roles: roles}) => (
    roles.includes(decision.semantic_role)
  ));
  const requestedAssetId = decision.asset_id ?? decision.acquisition_request?.asset_id ?? null;
  if (requestedAssetId !== null) {
    return matches.find(({asset_id: assetId}) => assetId === requestedAssetId) ?? null;
  }
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(`${decision.event_id} has multiple exact semantic matches; asset_id is required`);
  }
  return null;
};

const validateAcquisitionRequest = (decision) => {
  const request = decision.acquisition_request;
  if (!request || !Array.isArray(request.semantic_roles)
      || !request.semantic_roles.includes(decision.semantic_role)
      || (decision.asset_id && decision.asset_id !== request.asset_id)) {
    throw new Error(
      `${decision.event_id} needs an exact official acquisition request for ${decision.semantic_role}`,
    );
  }
  return request;
};

const validateSelectionGateEvidence = (decision) => {
  const basis = decision.selection_basis;
  const gates = basis?.hard_gate_results;
  if (basis?.selection_method !== 'hard-gates-then-deterministic-ranking-v1'
      || basis.semantic_role !== decision.semantic_role
      || typeof basis.selected_asset_id !== 'string' || basis.selected_asset_id === ''
      || gates?.license !== true || gates?.media !== true
      || gates?.semantic_role !== true || gates?.motion_direction !== true) {
    throw new Error(`${decision.event_id} has incomplete hard-gate selection evidence`);
  }
};

const buildDerivative = ({decision, input, library, repositoryRoot, buildDerivedImpl}) => {
  if (decision.derived_asset) return null;
  const request = decision.derivative_request;
  if (!request || typeof request.output_path !== 'string') {
    throw new Error(`${decision.event_id} needs an episode derivative request`);
  }
  decision.derived_asset = buildDerivedImpl({
    repositoryRoot,
    episodeWorkspace: input.episode_workspace,
    assetId: decision.asset_id,
    outputPath: request.output_path,
    trimStartSample: request.trim_start_sample,
    trimEndSample: request.trim_end_sample,
    libraryValidation: library,
  });
  return decision.derived_asset.path;
};

export const prepareKnowledgeVideoSoundDesign = async (input, {
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
  loadLibraryImpl = loadAndValidateSharedSoundEffectLibrary,
  acquireImpl = acquireSoundEffect,
  buildDerivedImpl = buildSoundEffectDerivedWav,
  buildDesignImpl = buildKnowledgeVideoSoundDesign,
  announceImpl = (message) => process.stderr.write(`${message}\n`),
  verifyFiles = true,
} = {}) => {
  if (input?.resume_mode !== 'standard') {
    throw new Error('automatic sound preparation is forbidden for revoice variants');
  }
  const prepared = structuredClone(input);
  let library = loadLibraryImpl({repositoryRoot});
  const createdDerivatives = [];
  try {
    for (const decision of prepared.event_decisions ?? []) {
      if (decision.decision !== 'audible') continue;
      validateSelectionGateEvidence(decision);
      let asset = selectExistingAsset(decision, library);
      if (!asset) {
        const request = validateAcquisitionRequest(decision);
        announceImpl(`将下载音效“${request.title}”，用于 ${decision.event_id}：${decision.reason}`);
        await acquireImpl({request, repositoryRoot});
        library = loadLibraryImpl({repositoryRoot});
        asset = selectExistingAsset(decision, library);
        if (!asset) {
          throw new Error(`${decision.event_id} acquisition did not publish the exact semantic role`);
        }
      }
      if (decision.selection_basis.selected_asset_id !== asset.asset_id) {
        throw new Error(`${decision.event_id} selected asset differs from its ranking evidence`);
      }
      decision.asset_id = asset.asset_id;
      const derivative = buildDerivative({
        decision, input: prepared, library, repositoryRoot, buildDerivedImpl,
      });
      if (derivative) createdDerivatives.push(derivative);
      delete decision.acquisition_request;
      delete decision.derivative_request;
    }
    prepared.bindings.sound_effect_library = structuredClone(library.manifest);
    return buildDesignImpl(prepared, {
      repositoryRoot,
      libraryValidation: library,
      verifyFiles,
    });
  } catch (error) {
    for (const relativePath of createdDerivatives.reverse()) {
      fs.rmSync(resolveRepositoryPath(repositoryRoot, relativePath), {force: true});
    }
    throw error;
  }
};

const main = async () => {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) {
    throw new Error('usage: prepare-sound-design.mjs <analysis-input.json> <sound-design.json>');
  }
  const input = JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8'));
  const value = await prepareKnowledgeVideoSoundDesign(input);
  atomicWriteJson(outputPath, value);
  process.stdout.write(`${path.resolve(outputPath)}\n`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`prepare-sound-design failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
