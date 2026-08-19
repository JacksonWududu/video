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

const buildArtifacts = ({episodeWorkspace, exactMessage, decidedAt}) => {
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
  const approval = approvePendingTransitionRows({
    proposal: JSON.parse(proposalBytes),
    exactMessage,
    decidedAt,
  });
  if (JSON.stringify(approval.pendingBoundaryIds) !== JSON.stringify(validation.pending_boundary_ids)) {
    throw new Error('pending transition boundary set changed before approval');
  }
  const nextProposalBytes = jsonBytes(approval.proposal);
  const nextState = structuredClone(state);
  nextState.storyboard_construction = {
    ...nextState.storyboard_construction,
    status: 'transition_review_approved_pending_final_qa',
    ordinary_transition_status: 'approved_pending_storyboard_binding_and_final_qa',
  };
  nextState.transition_review = {
    ...nextState.transition_review,
    status: 'approved',
    checksum_sha256: sha256(nextProposalBytes),
    pending_boundary_ids: [],
    pending_boundary_count: 0,
    approved_boundary_count: approval.proposal.rows.length,
    newly_approved_boundary_ids: approval.pendingBoundaryIds,
    exact_decision_message: exactMessage,
    decided_at: decidedAt,
  };
  nextState.current_phase = 'transition_review_approved';
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
  const [episodeWorkspace, exactMessage, decidedAt, mode] = process.argv.slice(2);
  if (!episodeWorkspace || !exactMessage || !decidedAt || !['--dry-run', '--apply'].includes(mode)
    || process.argv.length !== 6
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(decidedAt)) {
    console.error('usage: node approve-review-proposal.mjs <episode-workspace> <exact-message> <ISO-8601-with-offset> <--dry-run|--apply>');
    process.exit(2);
  }
  try {
    const artifacts = buildArtifacts({episodeWorkspace, exactMessage, decidedAt});
    if (mode === '--apply') writeArtifacts(artifacts);
    process.stdout.write(`${JSON.stringify({
      result: artifacts.result,
      approved_boundary_ids: artifacts.approved_boundary_ids,
      presented_map_sha256: artifacts.presented_map_sha256,
      proposal_checksum_sha256: sha256(artifacts.proposal.bytes),
      state_checksum_sha256: sha256(artifacts.state.bytes),
      applied: mode === '--apply',
    }, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
