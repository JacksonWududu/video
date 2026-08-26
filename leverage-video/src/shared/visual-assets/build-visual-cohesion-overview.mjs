#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '../../../..');
const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;
const NORMAL_ROUTES = new Set([
  'imagegen',
  'xuan-paper-diorama',
  'ink-doodle-knowledge-card',
]);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

export class VisualCohesionContractError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VisualCohesionContractError';
  }
}

const fail = (message) => {
  throw new VisualCohesionContractError(message);
};

const isWithin = (parent, candidate) => {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

const resolveWorkspace = (repositoryRoot, episodeWorkspace) => {
  if (typeof episodeWorkspace !== 'string' || episodeWorkspace.trim() === '') {
    fail('episode workspace is required');
  }
  if (path.isAbsolute(episodeWorkspace)) {
    fail('episode workspace must be repository-root-relative');
  }
  const repository = fs.realpathSync(repositoryRoot);
  const candidate = path.resolve(repository, episodeWorkspace);
  if (!isWithin(repository, candidate)) fail('episode workspace must be inside repository root');
  let resolved;
  try {
    resolved = fs.realpathSync(candidate);
  } catch {
    fail(`episode workspace does not exist: ${episodeWorkspace}`);
  }
  if (!isWithin(repository, resolved)) fail('episode workspace resolves outside repository root');
  if (!fs.statSync(resolved).isDirectory()) fail('episode workspace must be a directory');
  return {repository, resolved, relative: path.relative(repository, resolved)};
};

const ensureDirectoryTree = (root, target) => {
  if (!isWithin(root, target)) fail('output directory escapes episode workspace');
  const relative = path.relative(root, target);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (fs.existsSync(current)) {
      const status = fs.lstatSync(current);
      if (status.isSymbolicLink() || !status.isDirectory()) {
        fail(`output directory component is not a real directory: ${current}`);
      }
    } else {
      fs.mkdirSync(current);
    }
  }
};

const resolveOutput = ({workspace, outputPath}) => {
  if (typeof outputPath !== 'string' || outputPath.trim() === '') fail('output path is required');
  if (path.isAbsolute(outputPath)) fail('output path must be repository-root-relative');
  const reviewDirectory = path.join(workspace.resolved, 'assets', 'image', 'review');
  let candidate;
  if (path.dirname(outputPath) === '.') {
    candidate = path.resolve(reviewDirectory, outputPath);
  } else if (outputPath === 'assets' || outputPath.startsWith(`assets${path.sep}`)) {
    candidate = path.resolve(workspace.resolved, outputPath);
  } else {
    candidate = path.resolve(workspace.repository, outputPath);
  }
  if (!isWithin(reviewDirectory, candidate) || candidate === reviewDirectory) {
    fail('output path must be inside the episode assets/image/review directory');
  }
  if (path.extname(candidate).toLowerCase() !== '.png') fail('output must be a .png file');
  if (fs.existsSync(candidate)) fail(`refusing to overwrite existing output: ${outputPath}`);
  return {
    absolute: candidate,
    relative: path.relative(workspace.repository, candidate),
  };
};

const artifactPath = (value) => {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  for (const key of ['path', 'asset', 'preview_path', 'approved_preview_path', 'output_path', 'image_path']) {
    if (typeof value[key] === 'string' && value[key] !== '') return value[key];
  }
  return null;
};

const finalCompositeFromPackage = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  for (const candidate of [
    value.final_composite,
    value.package?.final_composite,
    value.record?.final_composite,
    value.scene_package_manifest?.record?.final_composite,
  ]) {
    const selected = artifactPath(candidate);
    if (selected) return selected;
  }
  for (const members of [value.members, value.package?.members, value.record?.members]) {
    if (!Array.isArray(members)) continue;
    const member = members.find((entry) => (
      ['final-composite', 'final_composite', 'final-composite-review-raster'].includes(entry?.member_role)
      || ['final-composite', 'final_composite', 'final-composite-review-raster'].includes(entry?.role)
    ));
    const selected = artifactPath(member);
    if (selected) return selected;
  }
  return null;
};

const ianPath = (item) => {
  for (const candidate of [
    item.ian_layered_scene_package,
    item.approved_ian_layered_scene_package,
    item.presented_ian_layered_scene_package,
    item.final_review?.ian_layered_scene_package,
    {members: item.ian_scene_package_members},
  ]) {
    const selected = finalCompositeFromPackage(candidate);
    if (selected) return selected;
  }
  return null;
};

const whiteboardPath = (item) => {
  for (const candidate of [
    item.whiteboard?.preview,
    item.whiteboard?.annotation_preview,
    item.whiteboard?.region_preview,
    item.whiteboard_review?.annotation_review?.preview,
    item.whiteboard_review?.annotation_review?.preview_path,
    item.whiteboard_render_evidence?.preview,
    item.annotation_review?.preview,
    item.annotation_review?.approved_preview,
    item.annotation_review?.approved_preview_path,
    item.preview,
    item.annotation_preview,
    item.region_preview,
  ]) {
    const selected = artifactPath(candidate);
    if (selected) return selected;
  }
  return null;
};

const normalPath = (item) => {
  for (const candidate of [item.path, item.asset, item.image_path, item.output]) {
    const selected = artifactPath(candidate);
    if (selected) return selected;
  }
  return null;
};

const rolePriority = (item) => {
  const role = String(item.role ?? '').toLowerCase();
  if (['base', 'master', 'main', 'primary', 'hero', 'source-image'].includes(role)) return 0;
  if (role.includes('master') || role.includes('main') || role.includes('primary')) return 1;
  if (Number.isInteger(item.state_index) && item.state_index >= 0) return 10 + item.state_index;
  if (role.includes('action') || role.includes('variant') || role.includes('state')) return 100;
  return 50;
};

const excludedItem = (item) => {
  const shotId = String(item?.shot_id ?? '');
  const role = String(item?.role ?? '').toLowerCase();
  const assetId = String(item?.asset_id ?? '').toLowerCase();
  return item?.active_for_current_storyboard === false
    || item?.status === 'superseded'
    || shotId === 'OPEN-00'
    || shotId.toLowerCase() === 'cover'
    || role === 'cover'
    || assetId === 'cover'
    || assetId.startsWith('open-00')
    || item?.visual_generation_route === 'local-video-file';
};

const resolveSource = ({workspace, sourcePath}) => {
  if (path.isAbsolute(sourcePath)) fail(`representative image path must be repository-root-relative: ${sourcePath}`);
  const absolute = path.resolve(workspace.repository, sourcePath);
  if (!isWithin(workspace.resolved, absolute)) {
    fail(`representative image escapes episode workspace: ${sourcePath}`);
  }
  if (!IMAGE_EXTENSIONS.has(path.extname(absolute).toLowerCase())) return {usable: false, reason: 'not a supported still image'};
  if (!fs.existsSync(absolute)) return {usable: false, reason: 'file is missing'};
  const status = fs.lstatSync(absolute);
  if (status.isSymbolicLink() || !status.isFile() || status.size === 0) {
    return {usable: false, reason: 'file is not a nonempty regular image'};
  }
  const real = fs.realpathSync(absolute);
  if (!isWithin(workspace.resolved, real)) fail(`representative image resolves outside episode workspace: ${sourcePath}`);
  return {usable: true, absolute: real};
};

export const selectVisualRepresentatives = ({state, episodeWorkspace, repositoryRoot = REPOSITORY_ROOT}) => {
  const workspace = resolveWorkspace(repositoryRoot, episodeWorkspace);
  const queue = state?.visual_asset_review?.queue;
  if (!Array.isArray(queue)) fail('episode state visual_asset_review.queue must be an array');
  const warnings = [];
  const groups = new Map();
  queue.forEach((item, queueIndex) => {
    if (!item || typeof item !== 'object' || excludedItem(item)) return;
    if (typeof item.shot_id !== 'string' || item.shot_id === '') {
      warnings.push(`queue[${queueIndex}] has no shot_id; skipped`);
      return;
    }
    if (!groups.has(item.shot_id)) groups.set(item.shot_id, []);
    groups.get(item.shot_id).push({item, queueIndex});
  });

  const representatives = [];
  for (const [shotId, entries] of groups) {
    const ranked = [...entries].sort((left, right) => (
      rolePriority(left.item) - rolePriority(right.item) || left.queueIndex - right.queueIndex
    ));
    let selected = null;
    for (const {item, queueIndex} of ranked) {
      const route = item.visual_generation_route;
      let sourcePath = null;
      let selection = null;
      if (route === 'ian-handdrawn-ppt') {
        sourcePath = ianPath(item);
        selection = 'ian-final-composite';
      } else if (route === 'srt-whiteboard-animation') {
        sourcePath = whiteboardPath(item);
        selection = 'whiteboard-annotation-preview';
      } else if (NORMAL_ROUTES.has(route)) {
        sourcePath = normalPath(item);
        selection = 'main-still';
      } else {
        warnings.push(`${shotId} queue[${queueIndex}] uses unsupported route ${String(route)}; skipped`);
        continue;
      }
      if (!sourcePath) {
        warnings.push(`${shotId} queue[${queueIndex}] lacks a ${selection}; skipped`);
        continue;
      }
      const resolved = resolveSource({workspace, sourcePath});
      if (!resolved.usable) {
        warnings.push(`${shotId} ${sourcePath}: ${resolved.reason}; skipped`);
        continue;
      }
      selected = {
        shot_id: shotId,
        asset_id: item.asset_id ?? null,
        route,
        role: item.role ?? null,
        source_path: sourcePath,
        selection,
        absolute_path: resolved.absolute,
      };
      break;
    }
    if (selected) representatives.push(selected);
    else warnings.push(`${shotId} has no usable representative image; skipped`);
  }
  return {workspace, representatives, warnings};
};

const chooseGrid = (count) => {
  let best = null;
  for (let columns = 1; columns <= count; columns += 1) {
    const rows = Math.ceil(count / columns);
    const cellWidth = Math.floor((CANVAS_WIDTH - 24 - (columns - 1) * 12) / columns);
    const cellHeight = Math.floor((CANVAS_HEIGHT - 24 - (rows - 1) * 12) / rows);
    const containedWidth = Math.min(cellWidth, cellHeight * (16 / 9));
    const containedHeight = containedWidth * (9 / 16);
    const area = containedWidth * containedHeight;
    if (!best || area > best.area || (area === best.area && columns > best.columns)) {
      best = {columns, rows, cellWidth, cellHeight, area};
    }
  }
  return best;
};

export const buildFfmpegArguments = ({sources, outputPath}) => {
  if (!Array.isArray(sources) || sources.length === 0) fail('at least one source image is required');
  const grid = chooseGrid(sources.length);
  const inputArguments = sources.flatMap((source) => ['-i', source]);
  const filters = [`color=c=0xf4f0e8:s=${CANVAS_WIDTH}x${CANVAS_HEIGHT}:r=1:d=1[base]`];
  sources.forEach((unused, index) => {
    filters.push(
      `[${index}:v]scale=${grid.cellWidth}:${grid.cellHeight}:force_original_aspect_ratio=decrease:flags=lanczos,`
      + `pad=${grid.cellWidth}:${grid.cellHeight}:(ow-iw)/2:(oh-ih)/2:color=0xece7dc[tile${index}]`,
    );
    const column = index % grid.columns;
    const row = Math.floor(index / grid.columns);
    const x = 12 + column * (grid.cellWidth + 12);
    const y = 12 + row * (grid.cellHeight + 12);
    const inputLabel = index === 0 ? 'base' : `layer${index - 1}`;
    const outputLabel = index === sources.length - 1 ? 'outv' : `layer${index}`;
    filters.push(`[${inputLabel}][tile${index}]overlay=${x}:${y}:shortest=1[${outputLabel}]`);
  });
  return [
    '-hide_banner', '-loglevel', 'error',
    ...inputArguments,
    '-filter_complex', filters.join(';'),
    '-map', '[outv]',
    '-frames:v', '1',
    '-c:v', 'png',
    '-pix_fmt', 'rgb24',
    '-n',
    outputPath,
  ];
};

export const buildVisualCohesionOverview = ({
  episodeWorkspace,
  outputPath,
  repositoryRoot = REPOSITORY_ROOT,
  ffmpegPath = 'ffmpeg',
} = {}) => {
  const workspace = resolveWorkspace(repositoryRoot, episodeWorkspace);
  const statePath = path.join(workspace.resolved, 'schema', 'episode-state.json');
  let stateBytes;
  try {
    stateBytes = fs.readFileSync(statePath);
  } catch {
    fail('episode schema/episode-state.json is required');
  }
  let state;
  try {
    state = JSON.parse(stateBytes.toString('utf8'));
  } catch {
    fail('episode schema/episode-state.json is invalid JSON');
  }
  const output = resolveOutput({workspace, outputPath});
  const selection = selectVisualRepresentatives({
    state,
    episodeWorkspace: workspace.relative,
    repositoryRoot: workspace.repository,
  });
  const publicRepresentatives = selection.representatives.map(({absolute_path: unused, ...entry}) => entry);
  const report = {
    status: selection.representatives.length === 0 ? 'skipped' : 'pending',
    ordered_representatives: publicRepresentatives,
    warnings: [...selection.warnings],
    output: null,
  };
  if (selection.representatives.length === 0) return report;

  ensureDirectoryTree(workspace.resolved, path.dirname(output.absolute));
  const temporary = path.join(
    path.dirname(output.absolute),
    `.${path.basename(output.absolute, '.png')}.${randomUUID()}.tmp.png`,
  );
  const argumentsList = buildFfmpegArguments({
    sources: selection.representatives.map((entry) => entry.absolute_path),
    outputPath: temporary,
  });
  let command;
  try {
    command = spawnSync(ffmpegPath, argumentsList, {encoding: 'utf8', maxBuffer: 4 * 1024 * 1024});
    if (command.error || command.status !== 0 || !fs.existsSync(temporary)) {
      const detail = command.error?.message || command.stderr?.trim() || `exit ${String(command.status)}`;
      report.status = 'skipped';
      report.warnings.push(`ffmpeg could not build overview: ${detail}`);
      return report;
    }
    try {
      fs.linkSync(temporary, output.absolute);
    } catch (error) {
      if (error?.code === 'EEXIST') fail(`refusing to overwrite existing output: ${output.relative}`);
      throw error;
    }
    report.status = 'created';
    report.output = output.relative;
    return report;
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
};

const isCli = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isCli) {
  try {
    const [episodeWorkspace, outputPath, ...rest] = process.argv.slice(2);
    if (rest.length > 0) fail('usage: build-visual-cohesion-overview.mjs <episode-workspace> <output.png>');
    const report = buildVisualCohesionOverview({episodeWorkspace, outputPath});
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch (error) {
    const report = {
      status: 'error',
      ordered_representatives: [],
      warnings: [error instanceof Error ? error.message : String(error)],
      output: null,
    };
    process.stdout.write(`${JSON.stringify(report)}\n`);
    process.exitCode = error instanceof VisualCohesionContractError ? 2 : 1;
  }
}
