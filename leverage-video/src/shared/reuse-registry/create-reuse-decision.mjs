import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {atomicWriteJson, readJson, sha256File} from '../episode-tooling/file-integrity.mjs';
import {
  buildModuleFingerprint,
  registryChecksum,
  resolveEpisodeWorkspace,
} from './validate-reuse-decision.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(HERE, '../../../..');

const inventory = (episodeWorkspace) => {
  const directory = path.join(resolveEpisodeWorkspace(episodeWorkspace), 'script');
  if (!fs.existsSync(directory)) return [];
  const files = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, {withFileTypes: true})) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile()) files.push(target);
    }
  };
  visit(directory);
  return files.sort().map((file) => ({
    path: path.relative(REPOSITORY_ROOT, file),
    checksum_sha256: sha256File(file),
  }));
};

const main = () => {
  const episodeWorkspace = process.argv[2];
  if (!episodeWorkspace) throw new Error('usage: create-reuse-decision.mjs <episode-workspace>');
  const registry = readJson(path.join(HERE, 'registry.json'));
  const output = path.join(resolveEpisodeWorkspace(episodeWorkspace), 'schema/shared-reuse-decision-v1.json');
  if (fs.existsSync(output)) throw new Error(`reuse decision already exists: ${output}`);
  const preScriptInventory = inventory(episodeWorkspace);
  if (preScriptInventory.length !== 0) {
    throw new Error('new episode reuse audit must run before any episode-local script exists');
  }
  atomicWriteJson(output, {
    schema_version: 'shared-reuse-decision-v1',
    episode_workspace: episodeWorkspace,
    registry_checksum_sha256: registryChecksum(registry),
    audited_at: new Date().toISOString(),
    pre_script_inventory: preScriptInventory,
    decisions: registry.modules.map((module) => ({
      module_id: module.module_id,
      module_fingerprint_sha256: buildModuleFingerprint(module),
      decision: null,
      reason: '',
      consumers: [],
      verification: [],
    })),
  });
  process.stdout.write(`${output}\n`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
