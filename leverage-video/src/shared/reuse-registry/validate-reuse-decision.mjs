import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {readJson, sha256File} from '../episode-tooling/file-integrity.mjs';

const ALLOWED_DECISIONS = new Set(['reuse', 'extend_shared', 'not_applicable']);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(HERE, '../../../..');
const EPISODE_ROOT = path.resolve(REPOSITORY_ROOT, 'leverage-video/src');
const IGNORED_NAMES = new Set(['.DS_Store', '__pycache__']);

export const resolveEpisodeWorkspace = (episodeWorkspace) => {
  if (typeof episodeWorkspace !== 'string' || episodeWorkspace === '' || path.isAbsolute(episodeWorkspace)) {
    throw new Error('episode_workspace must be a repository-relative path');
  }
  const resolved = path.resolve(REPOSITORY_ROOT, episodeWorkspace);
  const relative = path.relative(EPISODE_ROOT, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative) || relative.split(path.sep).length !== 1) {
    throw new Error('episode_workspace must be one direct child of leverage-video/src');
  }
  if (relative === 'shared') throw new Error('shared is not an episode workspace');
  return resolved;
};

export const registryChecksum = (registry) => crypto
  .createHash('sha256')
  .update(JSON.stringify(registry))
  .digest('hex');

const inventoryDigest = (inventory) => crypto
  .createHash('sha256')
  .update(JSON.stringify(inventory))
  .digest('hex');

const compareBytewisePath = (left, right) => {
  if (left.path < right.path) return -1;
  if (left.path > right.path) return 1;
  return 0;
};

const moduleFiles = (directory) => {
  const results = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, {withFileTypes: true})) {
      if (IGNORED_NAMES.has(entry.name) || entry.name.endsWith('.example.json')) continue;
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`shared module contains symbolic link: ${target}`);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile()) results.push(target);
    }
  };
  visit(directory);
  return results.sort();
};

export const buildModuleFingerprint = (module) => {
  const modulePath = path.resolve(REPOSITORY_ROOT, module.path);
  if (!fs.statSync(modulePath).isDirectory()) throw new Error(`shared module path is invalid: ${module.path}`);
  const hash = crypto.createHash('sha256');
  hash.update(`${module.module_id}\0${module.path}\0${module.use_when}\0`);
  for (const file of moduleFiles(modulePath)) {
    hash.update(`${path.relative(modulePath, file)}\0${sha256File(file)}\0`);
  }
  return hash.digest('hex');
};

const inventoryScripts = (episodeWorkspace) => {
  const scriptDirectory = path.join(resolveEpisodeWorkspace(episodeWorkspace), 'script');
  if (!fs.existsSync(scriptDirectory)) return [];
  return moduleFiles(scriptDirectory).map((file) => ({
    path: path.relative(REPOSITORY_ROOT, file),
    checksum_sha256: sha256File(file),
  }));
};

const validateInventoryEntries = (inventory, episodeWorkspace, label) => {
  if (!Array.isArray(inventory)) throw new Error(`${label} array is required`);
  const scriptDirectory = path.resolve(resolveEpisodeWorkspace(episodeWorkspace), 'script');
  const seen = new Set();
  for (const item of inventory) {
    if (typeof item?.path !== 'string' || item.path === '') throw new Error(`${label} path is required`);
    if (seen.has(item.path)) throw new Error(`${label} contains duplicate path: ${item.path}`);
    seen.add(item.path);
    const file = path.resolve(REPOSITORY_ROOT, item.path);
    const relativeToScript = path.relative(scriptDirectory, file);
    if (relativeToScript === '' || relativeToScript.startsWith('..') || path.isAbsolute(relativeToScript)) {
      throw new Error(`${label} path must be inside the episode script directory`);
    }
    if (!/^[a-f0-9]{64}$/.test(item.checksum_sha256 ?? '')) {
      throw new Error(`${label} checksum is invalid: ${item.path}`);
    }
  }
};

const validateLegacyEvidence = (decision, episodeWorkspace, phase) => {
  if (decision.pre_script_inventory !== null) {
    throw new Error('legacy migration must not masquerade as a pre-script audit');
  }
  const authorization = decision.authorization;
  if (typeof authorization?.exact_user_message !== 'string' || authorization.exact_user_message.trim() === '') {
    throw new Error('legacy migration requires exact user authorization');
  }
  if (Number.isNaN(Date.parse(authorization.authorized_at))) {
    throw new Error('legacy migration authorization time must be an ISO date-time');
  }
  if (typeof authorization.scope !== 'string' || authorization.scope.trim().length < 20) {
    throw new Error('legacy migration authorization scope is incomplete');
  }
  validateInventoryEntries(decision.legacy_script_inventory, episodeWorkspace, 'legacy script inventory');
  if (decision.legacy_script_inventory.length === 0) {
    throw new Error('legacy script inventory must contain the existing episode scripts');
  }
  if (decision.legacy_script_inventory_digest_sha256 !== inventoryDigest(decision.legacy_script_inventory)) {
    throw new Error('legacy script inventory digest mismatch');
  }
  validateInventoryEntries(decision.legacy_additions, episodeWorkspace, 'legacy additions');
  const baselinePaths = new Set(decision.legacy_script_inventory.map((item) => item.path));
  for (const item of decision.legacy_additions) {
    if (baselinePaths.has(item.path)) throw new Error(`legacy addition overlaps baseline: ${item.path}`);
  }
  const expectedInventory = phase === 'legacy-migration'
    ? decision.legacy_script_inventory
    : [...decision.legacy_script_inventory, ...decision.legacy_additions]
      .sort(compareBytewisePath);
  const actualInventory = inventoryScripts(episodeWorkspace);
  if (JSON.stringify(expectedInventory) !== JSON.stringify(actualInventory)) {
    throw new Error('legacy script inventory does not match the active episode script directory');
  }
};

const requireConcreteReason = (item) => {
  if (typeof item.reason !== 'string' || item.reason.trim().length < 20) {
    throw new Error(`${item.module_id} requires a concrete reason of at least 20 characters`);
  }
  if (/^(not applicable|not used|n\/a|unused)[.! ]*$/i.test(item.reason.trim())) {
    throw new Error(`${item.module_id} has a generic reason`);
  }
};

const verifyConsumer = (module, consumer, episodeWorkspace) => {
  if (consumer?.kind !== 'source') throw new Error(`${module.module_id} consumer kind must be source`);
  if (typeof consumer?.path !== 'string' || consumer.path === '') {
    throw new Error(`${module.module_id} requires a consumer source path`);
  }
  const scriptDirectory = path.resolve(resolveEpisodeWorkspace(episodeWorkspace), 'script');
  const file = path.resolve(REPOSITORY_ROOT, consumer.path);
  const relativeToScript = path.relative(scriptDirectory, file);
  if (relativeToScript === '' || relativeToScript.startsWith('..') || path.isAbsolute(relativeToScript)) {
    throw new Error(`${module.module_id} consumer must be inside the episode script directory`);
  }
  if (sha256File(file) !== consumer.checksum_sha256) {
    throw new Error(`${module.module_id} consumer checksum mismatch: ${consumer.path}`);
  }
  const source = fs.readFileSync(file, 'utf8');
  const marker = consumer.shared_import_marker;
  if (typeof marker !== 'string' || marker.length < 3) {
    throw new Error(`${module.module_id} consumer lacks verified shared import marker`);
  }
  const moduleDirectory = path.basename(module.path);
  if (!marker.includes(moduleDirectory)) {
    throw new Error(`${module.module_id} marker does not identify its shared module`);
  }
  const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const importPattern = new RegExp(
    `(?:^|\\n)\\s*(?:import(?:[\\s\\S]*?from\\s*)?|export[\\s\\S]*?from\\s*|const\\s+[^=]+?=\\s*require\\s*\\(|await\\s+import\\s*\\()(['\"])[^'\"\\n]*${escapedMarker}[^'\"\\n]*\\1`,
    'm',
  );
  if (!importPattern.test(source)) {
    throw new Error(`${module.module_id} consumer lacks a real shared import`);
  }
};

export const validateReuseDecision = (
  registry,
  decision,
  {episodeWorkspace = decision?.episode_workspace, phase = 'pre-script', decisionPath = null} = {},
) => {
  if (registry?.schema_version !== 'shared-module-registry-v1') throw new Error('unsupported shared module registry');
  if (decision?.schema_version !== 'shared-reuse-decision-v1') throw new Error('unsupported shared reuse decision');
  if (!['pre-script', 'legacy-migration', 'consumption'].includes(phase)) {
    throw new Error(`unsupported validation phase: ${phase}`);
  }
  if (typeof episodeWorkspace !== 'string' || episodeWorkspace === '' || decision.episode_workspace !== episodeWorkspace) {
    throw new Error('episode_workspace does not match the active episode');
  }
  const episodeDirectory = resolveEpisodeWorkspace(episodeWorkspace);
  if (decisionPath) {
    const expected = path.resolve(episodeDirectory, 'schema/shared-reuse-decision-v1.json');
    if (path.resolve(decisionPath) !== expected) throw new Error('reuse decision is outside the active episode schema directory');
  }
  if (decision.registry_checksum_sha256 !== registryChecksum(registry)) throw new Error('registry checksum mismatch');
  if (Number.isNaN(Date.parse(decision.audited_at))) throw new Error('audited_at must be an ISO date-time');
  const isLegacyMigration = decision.audit_mode === 'authorized_legacy_migration-v1';
  if (isLegacyMigration) {
    if (phase === 'pre-script') throw new Error('legacy migration cannot pass the pre-script phase');
    validateLegacyEvidence(decision, episodeWorkspace, phase);
  } else {
    if (phase === 'legacy-migration') throw new Error('legacy-migration phase requires an authorized legacy decision');
    if (!Array.isArray(decision.pre_script_inventory)) throw new Error('pre_script_inventory array is required');
    if (decision.pre_script_inventory.length !== 0) {
      throw new Error('pre-script inventory must be empty for a new episode');
    }
    if (phase === 'pre-script') {
      const expectedInventory = inventoryScripts(episodeWorkspace);
      if (JSON.stringify(decision.pre_script_inventory) !== JSON.stringify(expectedInventory)) {
        throw new Error('pre-script inventory does not match the active episode script directory');
      }
    }
  }
  if (!Array.isArray(decision.decisions)) throw new Error('decisions array is required');

  const registryIds = new Set(registry.modules.map((module) => module.module_id));
  if (registryIds.size !== registry.modules.length) throw new Error('duplicate module_id in registry');
  const sharedRoot = path.resolve(HERE, '..');
  const actualSharedDirectories = fs.readdirSync(sharedRoot, {withFileTypes: true})
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
  const registeredPaths = registry.modules.map((module) => path.basename(module.path)).sort();
  if (JSON.stringify(actualSharedDirectories) !== JSON.stringify(registeredPaths)) {
    throw new Error(`shared registry is incomplete: actual=${actualSharedDirectories.join(',')} registered=${registeredPaths.join(',')}`);
  }

  const moduleById = new Map(registry.modules.map((module) => [module.module_id, module]));
  const seen = new Set();
  for (const item of decision.decisions) {
    const module = moduleById.get(item.module_id);
    if (!module) throw new Error(`unknown shared module: ${item.module_id}`);
    if (seen.has(item.module_id)) throw new Error(`duplicate decision: ${item.module_id}`);
    seen.add(item.module_id);
    if (!ALLOWED_DECISIONS.has(item.decision)) throw new Error(`invalid decision for ${item.module_id}`);
    if (module.required_for_new_episode_script === true && item.decision === 'not_applicable') {
      throw new Error(`${item.module_id} is mandatory for every new episode script`);
    }
    requireConcreteReason(item);
    if (item.module_fingerprint_sha256 !== buildModuleFingerprint(module)) {
      throw new Error(`module fingerprint mismatch: ${item.module_id}`);
    }
    if (!Array.isArray(item.consumers) || !Array.isArray(item.verification)) {
      throw new Error(`${item.module_id} requires consumers and verification arrays`);
    }
    if (phase === 'consumption' && ['reuse', 'extend_shared'].includes(item.decision)) {
      if (item.consumers.length === 0) throw new Error(`${item.module_id} requires a consumer source`);
      item.consumers.forEach((consumer) => verifyConsumer(module, consumer, episodeWorkspace));
    }
  }
  for (const moduleId of registryIds) {
    if (!seen.has(moduleId)) throw new Error(`missing decision: ${moduleId}`);
  }
  return {
    result: 'pass',
    phase,
    audit_mode: isLegacyMigration ? 'authorized_legacy_migration-v1' : 'pre_script-v1',
    checked_modules: registryIds.size,
  };
};

const main = () => {
  const args = process.argv.slice(2);
  const decisionPath = args[0];
  const phaseIndex = args.indexOf('--phase');
  const phase = phaseIndex >= 0 ? args[phaseIndex + 1] : 'pre-script';
  if (!decisionPath) {
    throw new Error('usage: validate-reuse-decision.mjs <decision.json> --phase <pre-script|legacy-migration|consumption>');
  }
  const decision = readJson(decisionPath);
  const result = validateReuseDecision(readJson(path.join(HERE, 'registry.json')), decision, {
    episodeWorkspace: decision.episode_workspace,
    phase,
    decisionPath,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
