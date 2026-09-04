import fs from 'node:fs';
import path from 'node:path';

const fail = (message) => { throw new Error(message); };
const absolute = (value, repositoryRoot, label) => {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} requires an explicit path`);
  return path.resolve(repositoryRoot, value);
};

export const assertNoSymlinkAncestors = (value, {repositoryRoot, label = 'path'} = {}) => {
  const file = absolute(value, repositoryRoot, label);
  const root = path.resolve(repositoryRoot);
  const boundary = file === root || file.startsWith(root + path.sep) ? root : path.parse(file).root;
  for (let cursor = file; ; cursor = path.dirname(cursor)) {
    let status;
    try { status = fs.lstatSync(cursor); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (status?.isSymbolicLink()) fail(`${label} may not follow symbolic links: ${cursor}`);
    if (status && cursor !== file && !status.isDirectory()) fail(`${label} has a non-directory parent: ${cursor}`);
    if (cursor === boundary) break;
  }
  return file;
};

const episodeWorkspace = (manifest) => {
  const value = manifest.production_authority?.episode_workspace ?? manifest.episode_workspace;
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || value.split('/').includes('..')) {
    fail('production CLI requires a root-relative episode_workspace');
  }
  if (manifest.episode_workspace != null && value !== manifest.episode_workspace) fail('production episode workspace bindings differ');
  return value;
};

const inCategory = (value, category, manifest, {repositoryRoot, label, allowCategoryRoot = false}) => {
  const file = absolute(value, repositoryRoot, label);
  const categoryRoot = path.resolve(repositoryRoot, episodeWorkspace(manifest), category);
  if (!(allowCategoryRoot && file === categoryRoot) && !file.startsWith(categoryRoot + path.sep)) {
    fail(`${label} must stay inside its episode ${category} category`);
  }
  return assertNoSymlinkAncestors(file, {repositoryRoot, label});
};

export const validateFlipbookProductionDirectories = (manifest, {repositoryRoot}) => {
  if (manifest.action_classification === 'project_maintenance') return;
  for (const category of ['docs', 'script', 'schema', 'assets/video', 'assets/image']) {
    inCategory(path.resolve(repositoryRoot, episodeWorkspace(manifest), category), category, manifest,
      {repositoryRoot, label: category, allowCategoryRoot: true});
  }
};

export const validateFlipbookBuildTarget = (manifest, target, {repositoryRoot}) => {
  const output = assertNoSymlinkAncestors(target, {repositoryRoot, label: 'build output'});
  if (manifest.action_classification === 'project_maintenance') return output;
  validateFlipbookProductionDirectories(manifest, {repositoryRoot});
  inCategory(output, 'docs', manifest, {repositoryRoot, label: 'build output'});
  const id = path.basename(output);
  if (!/^flipbook-[a-z0-9-]+$/.test(id)
    || path.dirname(output) !== path.resolve(repositoryRoot, episodeWorkspace(manifest), 'docs')) {
    fail('build output must be the direct docs/flipbook-<id> directory');
  }
  for (const relative of [`script/${id}`, `schema/${id}-manifest.json`, `schema/${id}-build.json`]) {
    assertNoSymlinkAncestors(path.resolve(repositoryRoot, episodeWorkspace(manifest), relative), {repositoryRoot, label: 'build artifact'});
  }
  return output;
};

export const validateFlipbookMuxPaths = (config, manifest, {repositoryRoot}) => {
  const manifestPath = assertNoSymlinkAncestors(config.manifest_path, {repositoryRoot, label: 'manifest_path'});
  if (path.extname(manifestPath) !== '.json') fail('manifest_path must name its explicit JSON file');
  const production = manifest.action_classification !== 'project_maintenance';
  if (production) {
    inCategory(manifestPath, 'schema', manifest, {repositoryRoot, label: 'manifest_path'});
    if (!/^flipbook-[a-z0-9-]+-manifest\.json$/.test(path.basename(manifestPath))) {
      fail('production manifest_path must retain its flipbook-<id>-manifest.json basename');
    }
  }
  const captureRoot = assertNoSymlinkAncestors(config.capture_root, {repositoryRoot, label: 'capture_root'});
  const outputPaths = {};
  for (const [field, category, extension] of [['output_path', 'assets/video', '.mp4'], ['evidence_path', 'schema', '.json'], ['caption_image_directory', 'assets/image', null]]) {
    if (field === 'caption_image_directory' && config[field] == null) { outputPaths[field] = null; continue; }
    const file = production ? inCategory(config[field], category, manifest, {repositoryRoot, label: field})
      : assertNoSymlinkAncestors(config[field], {repositoryRoot, label: field});
    if (extension && path.extname(file) !== extension) fail(`${field} must end in ${extension}`);
    if (file === manifestPath) fail('output must not replace the immutable input manifest');
    outputPaths[field] = file;
  }
  return {manifestPath, captureRoot, outputPath: outputPaths.output_path, evidencePath: outputPaths.evidence_path,
    captionImageDirectory: outputPaths.caption_image_directory};
};
