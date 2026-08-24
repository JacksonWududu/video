#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {validateFinalStoryboard} from './validate-final-storyboard.mjs';

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

export const buildApprovedStoryboardReviewState = ({state, storyboardChecksum, exactMessage, decidedAt}) => {
  if (state.current_phase !== 'awaiting_storyboard_review'
    || state.storyboard_review?.status !== 'pending'
    || typeof exactMessage !== 'string' || exactMessage.trim() === ''
    || typeof decidedAt !== 'string' || Number.isNaN(Date.parse(decidedAt))
    || storyboardChecksum !== state.storyboard_review.active_checksum_sha256
    || storyboardChecksum !== state.storyboard_review.presented_checksum_sha256
    || state.storyboard_review.active_path !== state.storyboard_review.presented_path) {
    throw new Error('storyboard approval evidence is incomplete, stale, or targets another version');
  }
  const nextState = structuredClone(state);
  nextState.active_storyboard = {
    ...nextState.active_storyboard,
    status: 'approved',
    approved_at: decidedAt,
    exact_approval_message: exactMessage,
  };
  nextState.storyboard_review = {
    ...nextState.storyboard_review,
    status: 'approved',
    approved_path: state.storyboard_review.active_path,
    approved_checksum_sha256: storyboardChecksum,
    exact_decision_message: exactMessage,
    decided_at: decidedAt,
  };
  nextState.blockers = [];
  nextState.current_phase = 'storyboard_review_approved';
  return nextState;
};

export const buildPolicyAuthorizedStoryboardReviewState = ({
  state, storyboardChecksum, policySha256, authorizedAt,
}) => {
  if (state.current_phase !== 'awaiting_storyboard_review'
    || state.storyboard_review?.status !== 'pending'
    || !/^[a-f0-9]{64}$/.test(policySha256 ?? '')
    || typeof authorizedAt !== 'string' || Number.isNaN(Date.parse(authorizedAt))
    || storyboardChecksum !== state.storyboard_review.active_checksum_sha256
    || storyboardChecksum !== state.storyboard_review.presented_checksum_sha256
    || state.storyboard_review.active_path !== state.storyboard_review.presented_path) {
    throw new Error('storyboard policy authorization is incomplete, stale, or targets another version');
  }
  const nextState = structuredClone(state);
  nextState.active_storyboard = {
    ...nextState.active_storyboard,
    status: 'policy_authorized',
    authorized_at: authorizedAt,
    policy_sha256: policySha256,
    user_has_reviewed_specific_storyboard: false,
  };
  nextState.storyboard_review = {
    ...nextState.storyboard_review,
    status: 'policy_authorized',
    approved_path: state.storyboard_review.active_path,
    approved_checksum_sha256: storyboardChecksum,
    exact_decision_message: null,
    decided_at: null,
    policy_sha256: policySha256,
    authorized_at: authorizedAt,
    user_has_reviewed_specific_storyboard: false,
  };
  nextState.blockers = [];
  nextState.current_phase = 'storyboard_policy_authorized';
  return nextState;
};

const buildArtifacts = ({episodeWorkspace, exactMessage = null, decidedAt, policySha256 = null}) => {
  const workspacePath = resolveRootRelative(episodeWorkspace, 'episode workspace');
  const statePath = path.join(workspacePath, 'schema/episode-state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const activePath = resolveRootRelative(state.storyboard_review?.active_path, 'active storyboard path');
  const activeBytes = fs.readFileSync(activePath);
  const activeChecksum = sha256(activeBytes);
  validateFinalStoryboard(episodeWorkspace, state.storyboard_review.active_path);
  const nextState = policySha256 === null
    ? buildApprovedStoryboardReviewState({
        state, storyboardChecksum: activeChecksum, exactMessage, decidedAt,
      })
    : buildPolicyAuthorizedStoryboardReviewState({
        state, storyboardChecksum: activeChecksum, policySha256, authorizedAt: decidedAt,
      });
  return {
    result: 'pass',
    storyboard: {path: state.storyboard_review.active_path, checksum_sha256: activeChecksum},
    state: {relative: `${episodeWorkspace}/schema/episode-state.json`, bytes: jsonBytes(nextState)},
  };
};

const writeArtifacts = (artifacts) => {
  const stateTarget = resolveRootRelative(artifacts.state.relative, 'episode state path');
  const temporary = `${stateTarget}.storyboard-approval.tmp`;
  if (fs.existsSync(temporary)) throw new Error('storyboard approval temporary path already exists');
  fs.writeFileSync(temporary, artifacts.state.bytes, {flag: 'wx'});
  fs.renameSync(temporary, stateTarget);
};

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const [episodeWorkspace, decisionOrPolicy, decidedAt, mode] = process.argv.slice(2);
  const oneClick = ['--one-click-dry-run', '--one-click-apply'].includes(mode);
  if (!episodeWorkspace || !decisionOrPolicy || !decidedAt
    || !['--dry-run', '--apply', '--one-click-dry-run', '--one-click-apply'].includes(mode)
    || process.argv.length !== 6
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(decidedAt)) {
    console.error('usage: node approve-storyboard-review.mjs <episode-workspace> <exact-message|policy-sha256> <ISO-8601-with-offset> <--dry-run|--apply|--one-click-dry-run|--one-click-apply>');
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
      storyboard: artifacts.storyboard,
      state_checksum_sha256: sha256(artifacts.state.bytes),
      applied: ['--apply', '--one-click-apply'].includes(mode),
    }, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
