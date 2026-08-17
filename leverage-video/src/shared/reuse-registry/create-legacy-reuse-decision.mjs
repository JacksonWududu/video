import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {atomicWriteJson, readJson, sha256File} from '../episode-tooling/file-integrity.mjs';
import {
  buildModuleFingerprint,
  registryChecksum,
  resolveEpisodeWorkspace,
} from './validate-reuse-decision.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, '../../../..');
const ignoredNames = new Set(['.DS_Store', '__pycache__']);

const inventoryScripts = (episodeWorkspace) => {
  const directory = path.join(resolveEpisodeWorkspace(episodeWorkspace), 'script');
  if (!fs.existsSync(directory)) return [];
  const files = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, {withFileTypes: true})) {
      if (ignoredNames.has(entry.name)) continue;
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`episode script contains symbolic link: ${target}`);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile()) files.push(target);
    }
  };
  visit(directory);
  return files.sort().map((file) => ({
    path: path.relative(repositoryRoot, file),
    checksum_sha256: sha256File(file),
  }));
};

const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};

const main = () => {
  const episodeWorkspace = process.argv[2];
  const exactUserMessage = argument('--authorization-message');
  const authorizedAt = argument('--authorized-at');
  if (!episodeWorkspace || typeof exactUserMessage !== 'string' || exactUserMessage.trim() === '') {
    throw new Error('usage: create-legacy-reuse-decision.mjs <episode-workspace> --authorization-message <exact-message> --authorized-at <ISO-time>');
  }
  if (Number.isNaN(Date.parse(authorizedAt))) throw new Error('--authorized-at must be an ISO date-time');
  const episodeDirectory = resolveEpisodeWorkspace(episodeWorkspace);
  const output = path.join(episodeDirectory, 'schema/shared-reuse-decision-v1.json');
  if (fs.existsSync(output)) throw new Error(`reuse decision already exists: ${output}`);
  const legacyScriptInventory = inventoryScripts(episodeWorkspace);
  if (legacyScriptInventory.length === 0) {
    throw new Error('legacy migration requires a non-empty existing episode script directory');
  }
  const registry = readJson(path.join(here, 'registry.json'));
  atomicWriteJson(output, {
    schema_version: 'shared-reuse-decision-v1',
    audit_mode: 'authorized_legacy_migration-v1',
    episode_workspace: episodeWorkspace,
    registry_checksum_sha256: registryChecksum(registry),
    audited_at: new Date().toISOString(),
    pre_script_inventory: null,
    legacy_script_inventory: legacyScriptInventory,
    legacy_script_inventory_digest_sha256: crypto
      .createHash('sha256')
      .update(JSON.stringify(legacyScriptInventory))
      .digest('hex'),
    legacy_additions: [],
    authorization: {
      exact_user_message: exactUserMessage,
      authorized_at: authorizedAt,
      scope: 'One-time shared reuse migration for the identified legacy episode only.',
    },
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
