#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {inspectIanLayeredScenePackage} from '../../../../leverage-video/src/shared/ian-layered-scene/contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(HERE, '../../../..');

const resolveRootRelative = (value, label) => {
  if (typeof value !== 'string' || value === '' || path.isAbsolute(value)
    || value.replaceAll('\\', '/').split('/').includes('..')) {
    throw new Error(`${label} must be repository-root-relative`);
  }
  const resolved = path.resolve(REPOSITORY_ROOT, value);
  const relative = path.relative(REPOSITORY_ROOT, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes repository root`);
  }
  return resolved;
};

export const validateKnowledgeVideoLayeredScene = async (
  episodeWorkspace,
  manifestPath,
) => {
  const workspace = resolveRootRelative(episodeWorkspace, 'episode workspace');
  const manifestFile = resolveRootRelative(manifestPath, 'Ian layered-scene manifest');
  const relative = path.relative(workspace, manifestFile);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Ian layered-scene manifest must be inside the episode workspace');
  }
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  return inspectIanLayeredScenePackage(manifest, {
    repositoryRoot: REPOSITORY_ROOT,
    episodeWorkspace,
  });
};

const main = async () => {
  const [episodeWorkspace, manifestPath] = process.argv.slice(2);
  if (!episodeWorkspace || !manifestPath) {
    throw new Error(
      'usage: node validate_knowledge_video_layered_scene.mjs <episode-workspace> <manifest-root-relative-path>',
    );
  }
  process.stdout.write(`${JSON.stringify(
    await validateKnowledgeVideoLayeredScene(episodeWorkspace, manifestPath),
    null,
    2,
  )}\n`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

