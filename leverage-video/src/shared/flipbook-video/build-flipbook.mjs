import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createFlipbookManifest, exactRevealText, isIndependentCopyPreview} from './contract.mjs';
import {sha256File, verifyFileChecksum, atomicWriteJson} from '../episode-tooling/file-integrity.mjs';
import {probeMedia} from '../render-qa/media-qa.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(HERE, '../../../..');
const runtime = path.join(REPOSITORY_ROOT, '.agents/skills/create-photo-flipbook-ui/assets/html');
const escape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

export const resolveInput = (value, root = REPOSITORY_ROOT) => {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || value.split('/').includes('..')) {
    throw new Error('flipbook input paths must be root-relative and traversal-free');
  }
  const file = path.resolve(root, value);
  for (let item = file; item !== path.resolve(root); item = path.dirname(item)) {
    if (fs.lstatSync(item).isSymbolicLink()) throw new Error('flipbook inputs may not follow symbolic links');
  }
  return file;
};

export const buildFlipbook = (input, outputDirectory, {repositoryRoot = REPOSITORY_ROOT, productionPreflight, captureMethod = 'cursor-never'} = {}) => {
  const manifest = createFlipbookManifest(input);
  const production = manifest.action_classification !== 'project_maintenance';
  if (!['cursor-never', 'pointer-lock', 'pointer-outside'].includes(captureMethod)) throw new Error('unsupported browser capture method');
  if (captureMethod !== 'cursor-never' && (production || !isIndependentCopyPreview(manifest))) {
    throw new Error('temporary pointer handling is authorized only for an explicitly built independent-copy maintenance preview');
  }
  let productionEvidence = null;
  if (manifest.action_classification === 'project_maintenance') {
    for (const value of [manifest.narration.path, ...manifest.spreads.map((spread) => spread.image.path), ...(manifest.opening_cover ? [manifest.opening_cover.image.path] : [])]) {
      if (!value.startsWith('leverage-video/src/shared/flipbook-video/fixtures/')) {
        throw new Error('maintenance builds may consume only dedicated flipbook fixtures (synthetic or authorized independent copies)');
      }
    }
  } else {
    if (typeof productionPreflight !== 'function') throw new Error('production flipbook build requires an executing productionPreflight gate');
    productionEvidence = productionPreflight({manifest, outputDirectory, action: 'build'});
    if (!productionEvidence || productionEvidence.then) throw new Error('productionPreflight must synchronously return current verified bindings');
  }
  const output = path.resolve(outputDirectory);
  if (fs.existsSync(output) && fs.readdirSync(output).length !== 0) {
    throw new Error('flipbook output must be a new or empty directory; do not replace an approved build');
  }
  let scriptOutput = output;
  let manifestOutput = path.join(output, 'manifest.json');
  let buildDescriptor = path.join(output, 'build-evidence.json');
  if (production) {
    const episode = manifest.episode_workspace;
    const id = path.basename(output);
    if (typeof episode !== 'string' || !episode || path.isAbsolute(episode) || episode.split('/').includes('..')
      || !/^flipbook-[a-z0-9-]+$/.test(id)
      || path.dirname(output) !== path.resolve(repositoryRoot, episode, 'docs')) {
      throw new Error('production output must be <episode_workspace>/docs/flipbook-<id>');
    }
    scriptOutput = path.resolve(repositoryRoot, episode, 'script', id);
    manifestOutput = path.resolve(repositoryRoot, episode, 'schema', `${id}-manifest.json`);
    buildDescriptor = path.resolve(repositoryRoot, episode, 'schema', `${id}-build.json`);
    if ([scriptOutput, manifestOutput, buildDescriptor].some((file) => fs.existsSync(file))) throw new Error('production flipbook version already exists');
  }
  const relativeFile = (file) => path.relative(repositoryRoot, file).split(path.sep).join('/');
  const destination = (name) => name === 'index.html' ? path.join(output, name)
    : production && name === 'vendor/PAGE-FLIP-LICENSE' ? path.join(output, name)
    : name === 'manifest.json' ? manifestOutput : path.join(scriptOutput, name);
  verifyFileChecksum(resolveInput(manifest.narration.path, repositoryRoot), manifest.narration.checksum_sha256);
  const verifyImage = (image, label) => {
    const source = resolveInput(image.path, repositoryRoot);
    verifyFileChecksum(source, image.checksum_sha256);
    if (isIndependentCopyPreview(manifest) && (!fs.statSync(source).isFile() || fs.statSync(source).nlink !== 1)) {
      throw new Error('independent-copy preview images must be regular files without hard links');
    }
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(source).toLowerCase())) {
      throw new Error('flipbook images must be supplied raster files');
    }
    const media = probeMedia(source);
    const images = media.streams.filter((stream) => stream.codec_type === 'video');
    if (images.length !== 1 || images[0].width !== image.width || images[0].height !== image.height) {
      throw new Error(`${label}: measured raster dimensions differ from the manifest`);
    }
    return source;
  };
  const inputs = manifest.spreads.map((spread) => verifyImage(spread.image, spread.shot_id));
  const coverInput = manifest.opening_cover && verifyImage(manifest.opening_cover.image, 'opening cover');
  fs.mkdirSync(output, {recursive: true});
  if (!production) fs.mkdirSync(path.join(output, 'assets/images'), {recursive: true});
  fs.mkdirSync(path.join(scriptOutput, 'vendor'), {recursive: true});
  const copied = [];
  for (const name of ['page-flip.browser.js', 'PAGE-FLIP-LICENSE']) {
    const target = destination(`vendor/${name}`);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.copyFileSync(path.join(runtime, 'vendor', name), target);
  }
  fs.copyFileSync(path.join(HERE, 'browser-runtime.js'), path.join(scriptOutput, 'browser-runtime.js'));
  fs.copyFileSync(path.join(HERE, 'cursor-capture.mjs'), path.join(scriptOutput, 'cursor-capture.mjs'));
  fs.copyFileSync(path.join(HERE, 'pointer-lock-capture.mjs'), path.join(scriptOutput, 'pointer-lock-capture.mjs'));
  fs.copyFileSync(path.join(HERE, 'pointer-outside-capture.mjs'), path.join(scriptOutput, 'pointer-outside-capture.mjs'));
  fs.copyFileSync(path.join(HERE, 'video.css'), path.join(scriptOutput, 'video.css'));
  const copyImage = (source, inputPath, asset) => {
    if (!production) fs.copyFileSync(source, path.join(output, asset));
    copied.push({source: inputPath, output: asset, ...(production ? {physical_path: inputPath} : {}),
      checksum_sha256: sha256File(production ? source : path.join(output, asset))});
  };
  let coverLeaf = '';
  if (coverInput) {
    const image = manifest.opening_cover.image;
    const asset = `assets/images/opening-cover${path.extname(coverInput).toLowerCase()}`;
    copyImage(coverInput, image.path, asset);
    coverLeaf = `<article class="book-page cover-page" data-page-role="cover" data-density="hard"><div class="image-box"><img src="${asset}" alt="" width="${image.width}" height="${image.height}"></div></article>`;
  }
  const leaves = manifest.spreads.map((spread, index) => {
    const asset = `assets/images/${spread.shot_id}${path.extname(inputs[index]).toLowerCase()}`;
    copyImage(inputs[index], spread.image.path, asset);
    const text = spread.text_reveals.map((reveal, i) => `<span class="reveal${i === 0 ? ' lead' : ''}" data-reveal-id="${escape(reveal.id)}">${escape(exactRevealText(spread, reveal))}</span>`).join('');
    const imagePage = `<article class="book-page image-page" data-shot-id="${escape(spread.shot_id)}" data-page-role="image"><div class="image-box"><img src="${asset}" alt="" width="${spread.image.width}" height="${spread.image.height}"></div></article>`;
    const textPage = `<article class="book-page text-page" data-shot-id="${escape(spread.shot_id)}" data-page-role="text"><div class="body-copy">${text}</div></article>`;
    return spread.image_side === 'left' ? imagePage + textPage : textPage + imagePage;
  }).join('\n');
  fs.writeFileSync(path.join(output, 'index.html'), `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>图文翻书视频</title><link rel="stylesheet" href="video.css"></head>
<body data-capture-method="${captureMethod}"><main id="video-stage"><section class="stage"><div id="book-camera"><div id="book">${coverLeaf}${leaves}${coverLeaf ? '<article class="book-page back-cover-page" data-page-role="back-cover" data-density="hard"></article>' : ''}</div></div></section></main><div id="recording-controls"><button id="inspect-cursor-capture" disabled>检查无指针捕获</button><button id="start-recording" disabled>启动当前标签页录制</button><output id="recording-status">正在核验图片与字体</output></div><output id="capture-diagnostics" hidden aria-live="polite"></output><script src="vendor/page-flip.browser.js"></script><script type="module" src="browser-runtime.js"></script></body></html>\n`);
  atomicWriteJson(manifestOutput, manifest);
  const files = ['index.html', 'video.css', 'browser-runtime.js', 'cursor-capture.mjs', 'pointer-lock-capture.mjs', 'pointer-outside-capture.mjs', 'vendor/page-flip.browser.js', 'vendor/PAGE-FLIP-LICENSE', 'manifest.json'];
  const build = {contract_version: 'knowledge-video-flipbook-build-v1', presentation_mode: manifest.presentation_mode,
    capture_method: captureMethod,
    action_classification: manifest.action_classification, production_preflight: productionEvidence,
    manifest_checksum_sha256: sha256File(manifestOutput),
    ...(production ? {episode_workspace: manifest.episode_workspace, recording_layout: {
      video_directory: `${manifest.episode_workspace}/assets/video`, evidence_directory: `${manifest.episode_workspace}/schema`, prefix: path.basename(output)}} : {}),
    source_inputs: copied, files: files.map((name) => ({path: name, ...(production ? {physical_path: relativeFile(destination(name))} : {}), checksum_sha256: sha256File(destination(name))})),
    build_id: crypto.randomBytes(12).toString('hex')};
  atomicWriteJson(buildDescriptor, build);
  return {output, manifest, build, build_descriptor: buildDescriptor};
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4) throw new Error('usage: node build-flipbook.mjs <input.json> <new-output-directory>');
  const result = buildFlipbook(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), process.argv[3]);
  console.log(JSON.stringify({output: result.output, manifest_checksum_sha256: result.build.manifest_checksum_sha256}));
}
