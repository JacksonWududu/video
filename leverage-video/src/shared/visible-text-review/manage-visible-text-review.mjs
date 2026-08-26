#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {parseStoryboardSummary} from '../visual-direction-review-form/contract.mjs';
import {
  approveVisibleTextBatchReview,
  buildPendingVisibleTextBatchReview,
  validateVisibleTextBatchReview,
} from './contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(HERE, '../../../..');
const SHA256 = /^[a-f0-9]{64}$/;
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

const resolveRootRelative = (repositoryRoot, relative, label) => {
  if (typeof relative !== 'string' || relative === '' || path.isAbsolute(relative)) {
    throw new Error(`${label} must be repository-root-relative`);
  }
  const root = path.resolve(repositoryRoot);
  const resolved = path.resolve(root, relative);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${label} escapes repository root`);
  }
  return resolved;
};

const readChecksumBoundFile = (repositoryRoot, binding, label) => {
  const target = resolveRootRelative(repositoryRoot, binding?.path, `${label} path`);
  const status = fs.lstatSync(target);
  if (!status.isFile() || status.isSymbolicLink()) throw new Error(`${label} must be a real file`);
  const bytes = fs.readFileSync(target);
  if (!SHA256.test(binding?.checksum_sha256 ?? '') || sha256(bytes) !== binding.checksum_sha256) {
    throw new Error(`${label} checksum is stale`);
  }
  return bytes;
};

const readChecksumBoundJson = (repositoryRoot, binding, label) => {
  const bytes = readChecksumBoundFile(repositoryRoot, binding, label);
  return {bytes, value: JSON.parse(bytes)};
};

const readContext = ({episodeWorkspace, repositoryRoot}) => {
  const workspacePath = resolveRootRelative(repositoryRoot, episodeWorkspace, 'episode workspace');
  const statePath = path.join(workspacePath, 'schema/episode-state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  if (state.workspace_path !== episodeWorkspace) throw new Error('episode workspace binding is stale');
  const direction = readChecksumBoundJson(
    repositoryRoot,
    state.visual_direction_review,
    'visual-direction review',
  );
  const storyboardBytes = readChecksumBoundFile(
    repositoryRoot,
    direction.value.storyboard,
    'storyboard',
  );
  if (direction.value.presented_map_sha256 !== state.visual_direction_review.presented_map_sha256) {
    throw new Error('visual-direction presented map binding is stale');
  }
  return {
    statePath,
    state,
    directionReview: direction.value,
    storyboardBinding: direction.value.storyboard,
    storyboardMarkdown: storyboardBytes.toString('utf8'),
    summaryRows: parseStoryboardSummary(storyboardBytes.toString('utf8')),
  };
};

const nextReviewPath = ({repositoryRoot, episodeWorkspace}) => {
  const schemaDirectory = resolveRootRelative(
    repositoryRoot,
    `${episodeWorkspace}/schema`,
    'episode schema directory',
  );
  const versions = fs.readdirSync(schemaDirectory, {withFileTypes: true})
    .filter((entry) => entry.isFile() && /^visible-text-batch-review-v\d+\.json$/.test(entry.name))
    .map((entry) => Number(entry.name.match(/-v(\d+)\.json$/)[1]));
  const next = (versions.length === 0 ? 0 : Math.max(...versions)) + 1;
  return `${episodeWorkspace}/schema/visible-text-batch-review-v${next}.json`;
};

const stateBinding = (reviewPath, reviewBytes, review) => ({
  contract_version: review.contract_version,
  status: review.status,
  path: reviewPath,
  checksum_sha256: sha256(reviewBytes),
  presented_map_sha256: review.presented_map_sha256,
  presentation: structuredClone(review.presentation),
  exact_decision_message: review.approval?.exact_message ?? null,
  decided_at: review.approval?.decided_at ?? null,
  approval_scope: review.approval?.scope ?? null,
  user_has_reviewed_complete_map: review.approval?.user_has_reviewed_complete_map ?? false,
  row_by_row_approval_performed: false,
});

export const buildPresentArtifacts = ({
  episodeWorkspace,
  presentedAt,
  exactMessage,
  repositoryRoot = REPOSITORY_ROOT,
}) => {
  const context = readContext({episodeWorkspace, repositoryRoot});
  const oneClick = context.state.workflow_approval_mode?.approval_mode === 'one_click';
  const expectedDirectionStatus = oneClick ? 'policy_authorized' : 'approved';
  if (context.state.current_phase !== 'visual_direction_review_approved'
    || context.state.visual_direction_review?.status !== expectedDirectionStatus
    || context.directionReview.status !== expectedDirectionStatus) {
    throw new Error('episode is not ready for complete visible-text presentation');
  }
  if (![undefined, null, 'not_started'].includes(context.state.transition_review?.status)) {
    throw new Error('transition review must be rolled back before visible-text re-presentation');
  }
  const review = buildPendingVisibleTextBatchReview({
    episodeWorkspace,
    storyboard: context.storyboardBinding,
    visualDirectionReviewBinding: context.state.visual_direction_review,
    visualDirectionReview: context.directionReview,
    summaryRows: context.summaryRows,
    presentedAt,
    exactMessage,
  });
  const reviewPath = nextReviewPath({repositoryRoot, episodeWorkspace});
  const reviewBytes = jsonBytes(review);
  const state = structuredClone(context.state);
  if (state.visible_text_review) {
    state.superseded_artifacts = Array.isArray(state.superseded_artifacts)
      ? state.superseded_artifacts
      : [];
    state.superseded_artifacts.push({
      record_type: 'superseded_visible_text_batch_review',
      superseded_at: presentedAt,
      prior_binding: state.visible_text_review,
      replacement_presented_map_sha256: review.presented_map_sha256,
      files_deleted: false,
    });
  }
  state.visible_text_review = stateBinding(reviewPath, reviewBytes, review);
  state.phase = 'awaiting_visible_text_review';
  state.current_phase = 'awaiting_visible_text_review';
  state.blockers = [];
  return {
    operation: 'present',
    reviewPath,
    reviewBytes,
    review,
    statePath: `${episodeWorkspace}/schema/episode-state.json`,
    stateBytes: jsonBytes(state),
    state,
  };
};

export const buildApproveArtifacts = ({
  episodeWorkspace,
  presentedMapSha256,
  exactMessage,
  decidedAt,
  repositoryRoot = REPOSITORY_ROOT,
}) => {
  const context = readContext({episodeWorkspace, repositoryRoot});
  if (context.state.current_phase !== 'awaiting_visible_text_review'
    || context.state.visible_text_review?.status !== 'pending') {
    throw new Error('episode is not awaiting complete visible-text approval');
  }
  const binding = context.state.visible_text_review;
  const current = readChecksumBoundJson(repositoryRoot, binding, 'visible-text batch review');
  validateVisibleTextBatchReview(current.value, {
    episodeWorkspace,
    storyboard: context.storyboardBinding,
    visualDirectionReviewBinding: context.state.visual_direction_review,
    visualDirectionReview: context.directionReview,
    summaryRows: context.summaryRows,
    requireApproved: false,
  });
  const review = approveVisibleTextBatchReview(current.value, {
    presentedMapSha256,
    exactMessage,
    decidedAt,
  });
  validateVisibleTextBatchReview(review, {
    episodeWorkspace,
    storyboard: context.storyboardBinding,
    visualDirectionReviewBinding: context.state.visual_direction_review,
    visualDirectionReview: context.directionReview,
    summaryRows: context.summaryRows,
    requireApproved: true,
  });
  const reviewBytes = jsonBytes(review);
  const state = structuredClone(context.state);
  state.visible_text_review = stateBinding(binding.path, reviewBytes, review);
  state.gates = {...(state.gates ?? {}), visible_text_review: 'approved'};
  state.phase = 'visible_text_review_approved';
  state.current_phase = 'visible_text_review_approved';
  state.blockers = [];
  return {
    operation: 'approve',
    reviewPath: binding.path,
    reviewBytes,
    review,
    statePath: `${episodeWorkspace}/schema/episode-state.json`,
    stateBytes: jsonBytes(state),
    state,
  };
};

export const writeVisibleTextReviewArtifacts = (
  artifacts,
  {repositoryRoot = REPOSITORY_ROOT} = {},
) => {
  const reviewTarget = resolveRootRelative(repositoryRoot, artifacts.reviewPath, 'visible-text review path');
  const stateTarget = resolveRootRelative(repositoryRoot, artifacts.statePath, 'episode state path');
  const reviewTemporary = `${reviewTarget}.visible-text-review.tmp`;
  const stateTemporary = `${stateTarget}.visible-text-review.tmp`;
  if (fs.existsSync(reviewTemporary) || fs.existsSync(stateTemporary)) {
    throw new Error('visible-text review temporary file already exists');
  }
  try {
    fs.writeFileSync(reviewTemporary, artifacts.reviewBytes, {flag: 'wx'});
    fs.writeFileSync(stateTemporary, artifacts.stateBytes, {flag: 'wx'});
    fs.renameSync(reviewTemporary, reviewTarget);
    fs.renameSync(stateTemporary, stateTarget);
  } catch (error) {
    if (fs.existsSync(reviewTemporary)) fs.unlinkSync(reviewTemporary);
    if (fs.existsSync(stateTemporary)) fs.unlinkSync(stateTemporary);
    throw error;
  }
};

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const [operation, episodeWorkspace, first, second, third, mode] = process.argv.slice(2);
  const present = operation === 'present';
  const validMode = ['--dry-run', '--apply'].includes(present ? third : mode);
  if (!validMode || (present && process.argv.length !== 7) || (!present && (
    operation !== 'approve' || process.argv.length !== 8
  ))) {
    console.error('usage: manage-visible-text-review.mjs present <episode-workspace> <presented-at> <exact-presentation-message> <--dry-run|--apply>');
    console.error('   or: manage-visible-text-review.mjs approve <episode-workspace> <presented-map-sha256> <exact-user-message> <decided-at> <--dry-run|--apply>');
    process.exit(2);
  }
  try {
    const artifacts = present
      ? buildPresentArtifacts({
          episodeWorkspace,
          presentedAt: first,
          exactMessage: second,
        })
      : buildApproveArtifacts({
          episodeWorkspace,
          presentedMapSha256: first,
          exactMessage: second,
          decidedAt: third,
        });
    const apply = (present ? third : mode) === '--apply';
    if (apply) writeVisibleTextReviewArtifacts(artifacts);
    process.stdout.write(`${JSON.stringify({
      result: 'pass',
      operation,
      applied: apply,
      review_path: artifacts.reviewPath,
      review_checksum_sha256: sha256(artifacts.reviewBytes),
      presented_map_sha256: artifacts.review.presented_map_sha256,
      status: artifacts.review.status,
      rows: artifacts.review.rows,
      next_phase: artifacts.state.current_phase,
    }, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
