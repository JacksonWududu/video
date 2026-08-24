import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {parseStoryboardSummary} from '../visual-direction-review-form/contract.mjs';
import {validateVisibleTextBatchReview} from './contract.mjs';

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

const resolveRootRelative = (repositoryRoot, relative, label) => {
  if (typeof relative !== 'string' || relative === '' || path.isAbsolute(relative)) {
    throw new Error(`${label} must be repository-root-relative`);
  }
  const root = path.resolve(repositoryRoot);
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error(`${label} escapes repository root`);
  return resolved;
};

export const validateApprovedVisibleTextReviewState = ({
  repositoryRoot,
  episodeWorkspace,
  state,
  visualDirectionReview,
  storyboardMarkdown,
}) => {
  const binding = state?.visible_text_review;
  if (binding?.contract_version !== 'visible-text-batch-review-v1'
    || binding.status !== 'approved'
    || binding.user_has_reviewed_complete_map !== true
    || binding.row_by_row_approval_performed !== false) {
    throw new Error('complete visible-text batch approval is missing');
  }
  const target = resolveRootRelative(repositoryRoot, binding.path, 'visible-text review path');
  const status = fs.lstatSync(target);
  if (!status.isFile() || status.isSymbolicLink()) {
    throw new Error('visible-text review must be a real file');
  }
  const bytes = fs.readFileSync(target);
  if (sha256(bytes) !== binding.checksum_sha256) {
    throw new Error('visible-text review checksum is stale');
  }
  const review = JSON.parse(bytes);
  const result = validateVisibleTextBatchReview(review, {
    episodeWorkspace,
    storyboard: visualDirectionReview.storyboard,
    visualDirectionReviewBinding: state.visual_direction_review,
    visualDirectionReview,
    summaryRows: parseStoryboardSummary(storyboardMarkdown),
    requireApproved: true,
  });
  if (binding.presented_map_sha256 !== result.presented_map_sha256
    || binding.exact_decision_message !== review.approval.exact_message
    || binding.decided_at !== review.approval.decided_at
    || binding.approval_scope !== 'complete_presented_map') {
    throw new Error('visible-text review state binding is stale');
  }
  return result;
};
