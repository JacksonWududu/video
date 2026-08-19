#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  validateApprovedDirectionSynchronization,
} from './contract.mjs';
import {validateEpisodeSubmissionFile} from './validate-submission.mjs';
import {buildPresentedMapSha256} from '../visual-generation-routes/contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(HERE, '../../../..');
const SHA256 = /^[a-f0-9]{64}$/;

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

const assertRegularFile = (filePath, label) => {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a real regular non-symlink file`);
};

const parseDetailedProjection = ({storyboardMarkdown, normalizedRows}) => {
  const sectionMatches = [...storyboardMarkdown.matchAll(/^## (S[0-9]{2,})\n/gm)];
  const sections = new Map(sectionMatches.map((match, index) => [
    match[1],
    storyboardMarkdown.slice(match.index, sectionMatches[index + 1]?.index ?? storyboardMarkdown.length),
  ]));
  return normalizedRows.map((row) => {
    const section = sections.get(row.shot_id);
    if (!section) throw new Error(`${row.shot_id} detailed storyboard section is missing`);
    const visualDescription = section.match(/^- 画面：(.+)$/m)?.[1];
    if (visualDescription !== row.visual_description) {
      throw new Error(`${row.shot_id} detailed storyboard visual description is stale`);
    }
    for (const token of [row.visual_structure_id, row.treatment_profile_id, row.visual_generation_route]) {
      if (!section.includes(token)) throw new Error(`${row.shot_id} detailed storyboard lacks ${token}`);
    }
    if (!section.includes(`白猫 \`${String(row.white_cat_present)}\``)) {
      throw new Error(`${row.shot_id} detailed storyboard white-cat value is stale`);
    }
    if (row.visible_text_mode === 'none') {
      if (!section.includes('可见文字 `none`') && !section.includes('可见文字：`none`')) {
        throw new Error(`${row.shot_id} detailed storyboard visible-text mode is stale`);
      }
    } else {
      for (const token of [row.visible_text_mode, row.exact_visible_text, row.visible_text_placement]) {
        if (!section.includes(token)) throw new Error(`${row.shot_id} detailed storyboard visible-text projection is stale`);
      }
    }
    if (row.visual_generation_route === 'local-video-file') {
      if (!row.local_video_source_path || !section.includes(row.local_video_source_path)) {
        throw new Error(`${row.shot_id} detailed storyboard lacks the exact local video source path`);
      }
    }
    return {
      shot_id: row.shot_id,
      visual_description: visualDescription,
      white_cat_present: row.white_cat_present,
      visual_structure_id: row.visual_structure_id,
      treatment_profile_id: row.treatment_profile_id,
      visual_generation_route: row.visual_generation_route,
      visible_text_mode: row.visible_text_mode,
      exact_visible_text: row.exact_visible_text,
      visible_text_placement: row.visible_text_placement,
      local_video_source_path: row.local_video_source_path,
    };
  });
};

const buildArtifacts = ({episodeWorkspace, submissionPath, processedAt}) => {
  const validation = validateEpisodeSubmissionFile({episodeWorkspace, submissionPath});
  if (validation.requires_represented_map_refresh || validation.reopened_shot_ids.length > 0) {
    throw new Error('submission contains shots that require re-presentation and cannot be approved directly');
  }
  if (validation.selection_ready_shot_ids.length !== validation.normalized_rows.length) {
    throw new Error('not every submitted shot is selection-ready');
  }

  const workspacePath = resolveRootRelative(episodeWorkspace, 'episode workspace');
  const statePath = path.join(workspacePath, 'schema/episode-state.json');
  const stateBytes = fs.readFileSync(statePath);
  const state = JSON.parse(stateBytes);
  const reviewPath = resolveRootRelative(state.visual_direction_review.path, 'visual direction review path');
  const reviewBytes = fs.readFileSync(reviewPath);
  const review = JSON.parse(reviewBytes);
  const storyboardPath = resolveRootRelative(review.storyboard.path, 'storyboard path');
  const storyboardBytes = fs.readFileSync(storyboardPath);
  const storyboardMarkdown = storyboardBytes.toString('utf8');
  const submissionBytes = fs.readFileSync(path.resolve(submissionPath));
  const submission = JSON.parse(submissionBytes);

  assertRegularFile(state.narration_script.source_path, 'narration source');
  if (sha256(fs.readFileSync(state.narration_script.source_path)) !== state.narration_script.source_checksum_sha256) {
    throw new Error('narration source checksum changed; return to Gate 2');
  }
  const lockedPath = resolveRootRelative(state.locked_script.path, 'locked script path');
  if (sha256(fs.readFileSync(lockedPath)) !== state.locked_script.checksum_sha256) {
    throw new Error('locked narration checksum is stale');
  }
  if (sha256(storyboardBytes) !== review.storyboard.checksum_sha256) {
    throw new Error('storyboard checksum is stale');
  }

  const submittedById = new Map(submission.rows.map((row) => [row.shot_id, row]));
  const normalizedById = new Map(validation.normalized_rows.map((row) => [row.shot_id, row]));
  const nextReview = structuredClone(review);
  nextReview.rows = nextReview.rows.map((row) => {
    const normalized = normalizedById.get(row.shot_id);
    if (!normalized) return row;
    const next = structuredClone(row);
    if (next.user_selection?.status === 'approved') {
      next.selection_history = [
        ...(next.selection_history ?? []),
        {reason: 'visual_direction_full_submission_reaffirmed', prior_user_selection: next.user_selection},
      ];
    }
    next.user_selection = {
      status: 'approved',
      white_cat_present: normalized.white_cat_present,
      visual_structure_id: normalized.visual_structure_id,
      treatment_profile_id: normalized.treatment_profile_id,
      visual_generation_route: normalized.visual_generation_route,
      comic_plan: null,
      visible_text_mode: normalized.visible_text_mode,
      exact_visible_text: normalized.exact_visible_text,
      visible_text_placement: normalized.visible_text_placement,
      local_video_source_path: normalized.local_video_source_path,
      exact_message: JSON.stringify(submittedById.get(row.shot_id)),
      decided_at: processedAt,
      presented_map_sha256: review.presented_map_sha256,
    };
    return next;
  });
  nextReview.status = nextReview.rows.every((row) => row.user_selection?.status === 'approved')
    ? 'approved'
    : 'partially_approved';
  if (nextReview.status !== 'approved') throw new Error('full submission did not approve every active shot');
  if (buildPresentedMapSha256(nextReview) !== review.presented_map_sha256) {
    throw new Error('approval unexpectedly changed the presented candidate map');
  }

  const detailedRows = parseDetailedProjection({storyboardMarkdown, normalizedRows: validation.normalized_rows});
  const synchronizationQa = validateApprovedDirectionSynchronization({
    review: nextReview,
    storyboardMarkdown,
    detailedRows,
  });
  nextReview.visual_direction_synchronization_qa = {
    ...synchronizationQa,
    checked_at: processedAt,
    storyboard_path: review.storyboard.path,
    storyboard_checksum_sha256: review.storyboard.checksum_sha256,
  };

  const stamp = processedAt.replaceAll('-', '').replaceAll(':', '');
  const submissionRelative = `${episodeWorkspace}/schema/visual-direction-form-submission-${stamp}-v3.json`;
  const validationRelative = `${episodeWorkspace}/schema/visual-direction-form-validation-${stamp}-v3.json`;
  const reviewRelative = `${episodeWorkspace}/schema/per-shot-visual-direction-review-v3-approved-v1.json`;
  const processingValidation = {
    ...validation,
    processing_result: 'pass',
    processed_at: processedAt,
    approval_rule: 'selection_ready_only_no_direct_approval_for_represented_shots',
    approved_shot_ids: validation.selection_ready_shot_ids,
    synchronization_qa: synchronizationQa,
  };
  const validationBytes = jsonBytes(processingValidation);
  const historyEntry = {
    submission_path: submissionRelative,
    submission_checksum_sha256: sha256(submissionBytes),
    validation_path: validationRelative,
    validation_checksum_sha256: sha256(validationBytes),
    submitted_presented_map_sha256: submission.presented_map_sha256,
    resulting_presented_map_sha256: review.presented_map_sha256,
    processed_at: processedAt,
    selection_ready_shot_ids: validation.selection_ready_shot_ids,
    reopened_shot_ids: [],
    reopened_transition_boundaries: [],
  };
  nextReview.form_submission_history = [
    ...(nextReview.form_submission_history ?? []),
    historyEntry,
  ];
  nextReview.approval = {
    status: 'approved',
    approved_at: processedAt,
    basis_contract_version: submission.contract_version,
    submission_path: submissionRelative,
    submission_checksum_sha256: sha256(submissionBytes),
    presented_map_sha256: review.presented_map_sha256,
    approved_shot_ids: validation.selection_ready_shot_ids,
  };
  const nextReviewBytes = jsonBytes(nextReview);

  const summaryRowCount = (storyboardMarkdown.match(/^\| (?:OPEN-00|S[0-9]{2,}) \|/gm) ?? []).length;
  const nextState = structuredClone(state);
  nextState.storyboard_construction = {
    ...nextState.storyboard_construction,
    status: 'visual_direction_approved_awaiting_transition_review',
    draft_path: review.storyboard.path,
    draft_checksum_sha256: review.storyboard.checksum_sha256,
    shot_count_including_opening: summaryRowCount,
    generated_shot_count: review.rows.length,
    ordinary_transition_status: 'ready_for_per_boundary_proposal',
  };
  nextState.visual_direction_review = {
    ...nextState.visual_direction_review,
    status: 'approved',
    path: reviewRelative,
    checksum_sha256: sha256(nextReviewBytes),
    presented_map_sha256: review.presented_map_sha256,
    generated_shot_count: review.rows.length,
    decided_at: processedAt,
    user_selection: {
      contract_version: submission.contract_version,
      submission_path: submissionRelative,
      submission_checksum_sha256: sha256(submissionBytes),
      submitted_presented_map_sha256: submission.presented_map_sha256,
      mode: submission.submission_scope.mode,
      approved_shot_ids: validation.selection_ready_shot_ids,
    },
    form_submission_history: [
      ...(nextState.visual_direction_review.form_submission_history ?? []),
      historyEntry,
    ],
    synchronization_qa: nextReview.visual_direction_synchronization_qa,
  };
  nextState.current_phase = 'visual_direction_review_approved';
  const nextStateBytes = jsonBytes(nextState);

  return {
    result: 'pass',
    processed_at: processedAt,
    presented_map_sha256: review.presented_map_sha256,
    synchronization_qa: synchronizationQa,
    output: {
      submission: {relative: submissionRelative, bytes: submissionBytes},
      validation: {relative: validationRelative, bytes: validationBytes},
      review: {relative: reviewRelative, bytes: nextReviewBytes},
      state: {relative: `${episodeWorkspace}/schema/episode-state.json`, bytes: nextStateBytes},
    },
  };
};

const writeOutputs = (artifacts) => {
  for (const key of ['submission', 'validation', 'review']) {
    const target = resolveRootRelative(artifacts.output[key].relative, `${key} output path`);
    if (fs.existsSync(target)) throw new Error(`${key} output already exists: ${artifacts.output[key].relative}`);
  }
  for (const key of ['submission', 'validation', 'review', 'state']) {
    const item = artifacts.output[key];
    const target = resolveRootRelative(item.relative, `${key} output path`);
    fs.writeFileSync(target, item.bytes);
  }
};

const outputProjection = (artifacts) => ({
  result: artifacts.result,
  processed_at: artifacts.processed_at,
  presented_map_sha256: artifacts.presented_map_sha256,
  synchronization_qa: artifacts.synchronization_qa,
  outputs: Object.fromEntries(Object.entries(artifacts.output).map(([key, item]) => [key, {
    path: item.relative,
    checksum_sha256: sha256(item.bytes),
  }])),
});

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const [episodeWorkspace, submissionPath, processedAt, mode] = process.argv.slice(2);
  if (!episodeWorkspace || !submissionPath || !processedAt || !['--dry-run', '--apply'].includes(mode)
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(processedAt)) {
    console.error('usage: node approve-submission.mjs <episode-workspace> <submission.json> <ISO-8601-with-offset> <--dry-run|--apply>');
    process.exit(2);
  }
  try {
    const artifacts = buildArtifacts({episodeWorkspace, submissionPath, processedAt});
    if (mode === '--apply') writeOutputs(artifacts);
    process.stdout.write(`${JSON.stringify({...outputProjection(artifacts), applied: mode === '--apply'}, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
