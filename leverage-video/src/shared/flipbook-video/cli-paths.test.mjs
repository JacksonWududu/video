import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {assertNoSymlinkAncestors, validateFlipbookBuildTarget, validateFlipbookMuxPaths, validateFlipbookProductionDirectories} from './cli-paths.mjs';

const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'flipbook-cli-paths-')));
test.after(() => fs.rmSync(temporary, {recursive: true, force: true}));
const fixture = () => {
  const repositoryRoot = fs.mkdtempSync(path.join(temporary, 'repository-'));
  const workspace = 'leverage-video/src/shared/flipbook-video/fixtures/production-paths';
  for (const category of ['docs', 'script', 'schema', 'assets/image', 'assets/video']) fs.mkdirSync(path.join(repositoryRoot, workspace, category), {recursive: true});
  const manifest = {action_classification: 'episode', episode_workspace: workspace, production_authority: {episode_workspace: workspace}};
  const config = {manifest_path: `${workspace}/schema/flipbook-v02-manifest.json`, capture_root: repositoryRoot,
    output_path: `${workspace}/assets/video/caption-free-v01.mp4`, evidence_path: `${workspace}/schema/caption-free-v01.json`,
    caption_image_directory: `${workspace}/assets/image/captions-v01`};
  fs.writeFileSync(path.join(repositoryRoot, config.manifest_path), '{}');
  return {repositoryRoot, workspace, manifest, config};
};

test('explicit production manifest basename is preserved without capture-root guessing', () => {
  const data = fixture();
  const result = validateFlipbookMuxPaths(data.config, data.manifest, data);
  assert.equal(result.manifestPath, path.join(data.repositoryRoot, data.config.manifest_path));
  assert.equal(path.basename(result.manifestPath), 'flipbook-v02-manifest.json');
  assert.equal(result.outputPath, path.join(data.repositoryRoot, data.config.output_path));
  assert.throws(() => validateFlipbookMuxPaths({...data.config, manifest_path: `${data.workspace}/schema/manifest.json`}, data.manifest, data), /retain.*basename/);
});

test('maintenance accepts its explicitly named JSON and cannot overwrite it', () => {
  const data = fixture(); const manifest = {action_classification: 'project_maintenance'};
  const config = {...data.config, manifest_path: 'custom-fixture-manifest.json'};
  fs.writeFileSync(path.join(data.repositoryRoot, config.manifest_path), '{}');
  assert.equal(path.basename(validateFlipbookMuxPaths(config, manifest, data).manifestPath), 'custom-fixture-manifest.json');
  assert.throws(() => validateFlipbookMuxPaths({...config, evidence_path: config.manifest_path}, manifest, data), /immutable input manifest/);
});

test('each output category rejects a symlink parent even with a lexically valid prefix', () => {
  for (const [field, category, suffix] of [['output_path', 'assets/video', 'out.mp4'], ['evidence_path', 'schema', 'proof.json'], ['caption_image_directory', 'assets/image', 'frames']]) {
    const data = fixture();
    const outside = fs.mkdtempSync(path.join(temporary, 'outside-'));
    fs.symlinkSync(outside, path.join(data.repositoryRoot, data.workspace, category, 'redirect'), 'dir');
    assert.throws(() => validateFlipbookMuxPaths({...data.config, [field]: `${data.workspace}/${category}/redirect/${suffix}`}, data.manifest, data), /symbolic links/);
    assert.deepEqual(fs.readdirSync(outside), []);
  }
});

test('category siblings, wrong extensions and missing workspaces fail before output', () => {
  const data = fixture();
  for (const output of [`${data.workspace}/assets/video-other/out.mp4`, `${data.workspace}/assets/video`, `${data.workspace}/assets/video/out.webm`]) {
    assert.throws(() => validateFlipbookMuxPaths({...data.config, output_path: output}, data.manifest, data), /category|\.mp4/);
  }
  assert.throws(() => validateFlipbookMuxPaths(data.config, {action_classification: 'episode'}, data), /episode_workspace/);
});

test('broken symlink leaves and manifest/capture-root ancestors are rejected', () => {
  const data = fixture();
  const dangling = path.join(data.repositoryRoot, data.workspace, 'assets/video/broken.mp4');
  fs.symlinkSync(path.join(temporary, 'does-not-exist'), dangling);
  assert.throws(() => validateFlipbookMuxPaths({...data.config, output_path: dangling}, data.manifest, data), /symbolic links/);
  const alias = path.join(data.repositoryRoot, 'alias'); fs.symlinkSync(data.repositoryRoot, alias, 'dir');
  assert.throws(() => assertNoSymlinkAncestors(path.join(alias, data.config.manifest_path), {...data, label: 'manifest'}), /symbolic links/);
  assert.throws(() => validateFlipbookMuxPaths({...data.config, capture_root: alias}, data.manifest, data), /symbolic links/);
});

test('build validates secondary script and schema paths as well as its docs target', () => {
  const data = fixture();
  const target = `${data.workspace}/docs/flipbook-v01`;
  assert.equal(validateFlipbookBuildTarget(data.manifest, target, data), path.join(data.repositoryRoot, target));
  fs.symlinkSync(path.join(temporary, 'absent-build'), path.join(data.repositoryRoot, data.workspace, 'schema/flipbook-v01-build.json'));
  assert.throws(() => validateFlipbookBuildTarget(data.manifest, target, data), /symbolic links/);
  assert.throws(() => validateFlipbookBuildTarget(data.manifest, `${data.workspace}/docs/nested/flipbook-v01`, data), /direct docs/);
});

test('production directory check catches an artifact-root replacement on a later preflight', () => {
  const data = fixture();
  validateFlipbookProductionDirectories(data.manifest, data);
  const directory = path.join(data.repositoryRoot, data.workspace, 'assets/video');
  fs.rmdirSync(directory); fs.symlinkSync(temporary, directory, 'dir');
  assert.throws(() => validateFlipbookProductionDirectories(data.manifest, data), /symbolic links/);
});
