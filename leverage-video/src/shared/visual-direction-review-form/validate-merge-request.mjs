#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {validateStoryboardShotMergeRequest} from './contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(HERE, '../../../..');

const resolveRootRelative = (rootRelativePath, label) => {
  if (typeof rootRelativePath !== 'string' || rootRelativePath === '' || path.isAbsolute(rootRelativePath)) {
    throw new Error(`${label} must be root-relative`);
  }
  const resolved = path.resolve(REPOSITORY_ROOT, rootRelativePath);
  if (!resolved.startsWith(`${REPOSITORY_ROOT}${path.sep}`)) throw new Error(`${label} escapes repository root`);
  return resolved;
};

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

export const validateEpisodeMergeRequestFile = ({episodeWorkspace, requestPath}) => {
  const workspacePath = resolveRootRelative(episodeWorkspace, 'episode workspace');
  const state = JSON.parse(fs.readFileSync(path.join(workspacePath, 'schema/episode-state.json'), 'utf8'));
  if (state.workspace_path !== episodeWorkspace || state.current_phase !== 'awaiting_visual_direction_review') {
    throw new Error('episode is not at awaiting_visual_direction_review');
  }
  if (state.resume_mode === 'revoice_variant') {
    throw new Error('revoice_variant forbids shot merging and renumbering');
  }
  const reviewPath = resolveRootRelative(state?.visual_direction_review?.path, 'visual direction review path');
  const reviewBytes = fs.readFileSync(reviewPath);
  if (sha256(reviewBytes) !== state.visual_direction_review.checksum_sha256) {
    throw new Error('episode-state visual direction review checksum is stale');
  }
  const review = JSON.parse(reviewBytes);
  if (review.presented_map_sha256 !== state.visual_direction_review.presented_map_sha256) {
    throw new Error('episode-state visual direction map is stale');
  }
  const storyboardPath = resolveRootRelative(review.storyboard.path, 'storyboard path');
  const storyboardMarkdown = fs.readFileSync(storyboardPath, 'utf8');
  const request = JSON.parse(fs.readFileSync(path.resolve(requestPath), 'utf8'));
  return validateStoryboardShotMergeRequest({
    review,
    request,
    storyboardMarkdown,
    episodeWorkspace,
    episodeState: state,
  });
};

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  if (process.argv.length !== 4) {
    console.error('usage: node validate-merge-request.mjs <episode-workspace> <request.json>');
    process.exit(2);
  }
  try {
    const result = validateEpisodeMergeRequestFile({
      episodeWorkspace: process.argv[2],
      requestPath: process.argv[3],
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
