#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {buildTransitionReviewPresentedMapSha256} from './build-review-proposal.mjs';
import {validateEpisodeTransitionReviewProposal} from './validate-review-proposal.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(HERE, '../../../..');

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

const resolveRootRelative = (rootRelativePath, label) => {
  if (typeof rootRelativePath !== 'string' || rootRelativePath === '' || path.isAbsolute(rootRelativePath)) {
    throw new Error(`${label} must be root-relative`);
  }
  const resolved = path.resolve(REPOSITORY_ROOT, rootRelativePath);
  if (!resolved.startsWith(`${REPOSITORY_ROOT}${path.sep}`)) throw new Error(`${label} escapes repository root`);
  return resolved;
};

export const approvePendingTransitionRows = ({proposal, exactMessage, decidedAt}) => {
  if (proposal.status !== 'awaiting_user_selection'
    || typeof exactMessage !== 'string' || exactMessage.trim() === ''
    || typeof decidedAt !== 'string' || Number.isNaN(Date.parse(decidedAt))) {
    throw new Error('transition approval input or proposal status is invalid');
  }
  const presentedMapSha256 = buildTransitionReviewPresentedMapSha256(proposal);
  if (proposal.presented_map_sha256 !== presentedMapSha256) {
    throw new Error('transition approval proposal presented map is stale');
  }
  const pendingBoundaryIds = proposal.rows
    .filter((row) => row.user_selection?.status === 'pending')
    .map((row) => `${row.source_shot_id}->${row.next_shot_id}`);
  if (pendingBoundaryIds.length === 0) throw new Error('transition approval proposal has no pending boundary');
  const nextProposal = structuredClone(proposal);
  nextProposal.status = 'approved';
  for (const row of nextProposal.rows) {
    if (row.user_selection?.status !== 'pending') continue;
    row.user_selection = {
      status: 'approved',
      exact_message: exactMessage,
      decided_at: decidedAt,
      presented_map_sha256: presentedMapSha256,
    };
  }
  nextProposal.approval = {
    approved_pending_boundary_ids: pendingBoundaryIds,
    exact_message: exactMessage,
    decided_at: decidedAt,
    presented_map_sha256: presentedMapSha256,
  };
  return {proposal: nextProposal, pendingBoundaryIds, presentedMapSha256};
};

export const authorizePendingTransitionRowsOneClick = ({proposal, policySha256, authorizedAt}) => {
  if (proposal.status !== 'awaiting_user_selection'
    || !/^[a-f0-9]{64}$/.test(policySha256 ?? '')
    || typeof authorizedAt !== 'string' || Number.isNaN(Date.parse(authorizedAt))) {
    throw new Error('one-click transition authorization input or proposal status is invalid');
  }
  const presentedMapSha256 = buildTransitionReviewPresentedMapSha256(proposal);
  if (proposal.presented_map_sha256 !== presentedMapSha256) {
    throw new Error('one-click transition canonical map is stale');
  }
  const pendingBoundaryIds = proposal.rows
    .filter((row) => row.user_selection?.status === 'pending')
    .map((row) => `${row.source_shot_id}->${row.next_shot_id}`);
  if (pendingBoundaryIds.length !== proposal.rows.length) {
    throw new Error('one-click transition authorization requires a complete deterministic pending map');
  }
  const nextProposal = structuredClone(proposal);
  nextProposal.status = 'policy_authorized';
  nextProposal.rows.forEach((row) => {
    row.user_selection = {
      status: 'policy_authorized',
      policy_sha256: policySha256,
      deterministic_recommendation_selected: true,
      user_has_reviewed_specific_map: false,
      exact_message: null,
      decided_at: null,
      authorized_at: authorizedAt,
      presented_map_sha256: presentedMapSha256,
    };
  });
  nextProposal.policy_authorization = {
    policy_sha256: policySha256,
    authorized_at: authorizedAt,
    user_has_reviewed_specific_map: false,
    presented_map_sha256: presentedMapSha256,
  };
  return {proposal: nextProposal, pendingBoundaryIds, presentedMapSha256};
};

const buildArtifacts = ({episodeWorkspace, exactMessage = null, decidedAt, policySha256 = null}) => {
  const validation = validateEpisodeTransitionReviewProposal(episodeWorkspace);
  if (validation.pending_boundary_count === 0) throw new Error('transition review has no pending boundary');
  const workspacePath = resolveRootRelative(episodeWorkspace, 'episode workspace');
  const statePath = path.join(workspacePath, 'schema/episode-state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const proposalPath = resolveRootRelative(state.transition_review.path, 'transition review path');
  const proposalBytes = fs.readFileSync(proposalPath);
  if (sha256(proposalBytes) !== state.transition_review.checksum_sha256) {
    throw new Error('transition review checksum changed before approval');
  }
  const oneClick = policySha256 !== null;
  const approval = oneClick
    ? authorizePendingTransitionRowsOneClick({
        proposal: JSON.parse(proposalBytes), policySha256, authorizedAt: decidedAt,
      })
    : approvePendingTransitionRows({
        proposal: JSON.parse(proposalBytes), exactMessage, decidedAt,
      });
  if (JSON.stringify(approval.pendingBoundaryIds) !== JSON.stringify(validation.pending_boundary_ids)) {
    throw new Error('pending transition boundary set changed before approval');
  }
  const nextProposalBytes = jsonBytes(approval.proposal);
  const nextState = structuredClone(state);
  nextState.storyboard_construction = {
    ...nextState.storyboard_construction,
    status: oneClick
      ? 'transition_policy_authorized_pending_final_qa'
      : 'transition_review_approved_pending_final_qa',
    ordinary_transition_status: oneClick
      ? 'policy_authorized_pending_storyboard_binding_and_final_qa'
      : 'approved_pending_storyboard_binding_and_final_qa',
  };
  nextState.transition_review = {
    ...nextState.transition_review,
    status: oneClick ? 'policy_authorized' : 'approved',
    checksum_sha256: sha256(nextProposalBytes),
    pending_boundary_ids: [],
    pending_boundary_count: 0,
    approved_boundary_count: approval.proposal.rows.length,
    newly_approved_boundary_ids: approval.pendingBoundaryIds,
    exact_decision_message: oneClick ? null : exactMessage,
    decided_at: oneClick ? null : decidedAt,
    ...(oneClick ? {
      policy_sha256: policySha256,
      authorized_at: decidedAt,
      user_has_reviewed_specific_map: false,
    } : {}),
  };
  nextState.current_phase = oneClick ? 'transition_policy_authorized' : 'transition_review_approved';
  const nextStateBytes = jsonBytes(nextState);
  return {
    result: 'pass',
    presented_map_sha256: approval.presentedMapSha256,
    approved_boundary_ids: approval.pendingBoundaryIds,
    proposal: {
      relative: state.transition_review.path,
      bytes: nextProposalBytes,
    },
    state: {
      relative: `${episodeWorkspace}/schema/episode-state.json`,
      bytes: nextStateBytes,
    },
  };
};

const writeArtifacts = (artifacts) => {
  const proposalTarget = resolveRootRelative(artifacts.proposal.relative, 'transition proposal path');
  const stateTarget = resolveRootRelative(artifacts.state.relative, 'episode state path');
  const proposalTemporary = `${proposalTarget}.approval.tmp`;
  const stateTemporary = `${stateTarget}.transition-approval.tmp`;
  if (fs.existsSync(proposalTemporary) || fs.existsSync(stateTemporary)) {
    throw new Error('transition approval temporary path already exists');
  }
  fs.writeFileSync(proposalTemporary, artifacts.proposal.bytes, {flag: 'wx'});
  fs.writeFileSync(stateTemporary, artifacts.state.bytes, {flag: 'wx'});
  fs.renameSync(proposalTemporary, proposalTarget);
  fs.renameSync(stateTemporary, stateTarget);
};

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const [episodeWorkspace, decisionOrPolicy, decidedAt, mode] = process.argv.slice(2);
  const oneClick = ['--one-click-dry-run', '--one-click-apply'].includes(mode);
  if (!episodeWorkspace || !decisionOrPolicy || !decidedAt
    || !['--dry-run', '--apply', '--one-click-dry-run', '--one-click-apply'].includes(mode)
    || process.argv.length !== 6
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(decidedAt)) {
    console.error('usage: node approve-review-proposal.mjs <episode-workspace> <exact-message|policy-sha256> <ISO-8601-with-offset> <--dry-run|--apply|--one-click-dry-run|--one-click-apply>');
    process.exit(2);
  }
  try {
    const artifacts = buildArtifacts({
      episodeWorkspace,
      exactMessage: oneClick ? null : decisionOrPolicy,
      policySha256: oneClick ? decisionOrPolicy : null,
      decidedAt,
    });
    if (['--apply', '--one-click-apply'].includes(mode)) writeArtifacts(artifacts);
    process.stdout.write(`${JSON.stringify({
      result: artifacts.result,
      approved_boundary_ids: artifacts.approved_boundary_ids,
      presented_map_sha256: artifacts.presented_map_sha256,
      proposal_checksum_sha256: sha256(artifacts.proposal.bytes),
      state_checksum_sha256: sha256(artifacts.state.bytes),
      applied: ['--apply', '--one-click-apply'].includes(mode),
    }, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
