#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  authorizeVisualDirectionRecommendationsOneClick,
  buildPresentedMapSha256,
} from '../visual-generation-routes/contract.mjs';
import {
  buildStoryboardVisualRhythmMapSha256,
  validateStoryboardVisualRhythm,
} from '../storyboard-visual-rhythm/contract.mjs';
import {validateConciseSummaryVisibleText} from './contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(HERE, '../../../..');
const SHA256 = /^[a-f0-9]{64}$/;

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

const fail = (message) => {
  throw new Error(message);
};

const resolveRootRelative = (relative, label, {mustExist = true} = {}) => {
  if (typeof relative !== 'string' || relative === '' || path.isAbsolute(relative)) {
    fail(`${label} must be repository-root-relative`);
  }
  const resolved = path.resolve(REPOSITORY_ROOT, relative);
  if (resolved !== REPOSITORY_ROOT && !resolved.startsWith(`${REPOSITORY_ROOT}${path.sep}`)) {
    fail(`${label} escapes repository root`);
  }
  if (mustExist) {
    const status = fs.lstatSync(resolved);
    if (!status.isFile() || status.isSymbolicLink()) fail(`${label} must be a real file`);
  }
  return resolved;
};

const nextNumberedPath = ({directory, pattern, format}) => {
  const numbers = fs.readdirSync(directory, {withFileTypes: true})
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name.match(pattern))
    .filter(Boolean)
    .map((match) => Number(match[1]));
  return format((numbers.length === 0 ? 0 : Math.max(...numbers)) + 1);
};

export const reviseStoryboardVisibleText = (
  markdown,
  shotId,
  nextDraftVersion,
  {mode = 'none', exactVisibleText = null, visibleTextPlacement = null} = {},
) => {
  if (!['none', 'required'].includes(mode)) fail('visible text mode must be none or required');
  if (mode === 'none') {
    if (exactVisibleText !== null || visibleTextPlacement !== null) {
      fail('visible text none requires null exact copy and placement');
    }
  } else {
    validateConciseSummaryVisibleText(exactVisibleText, {shotId});
    if (typeof visibleTextPlacement !== 'string' || visibleTextPlacement.trim() === '') {
      fail('required visible text placement is empty');
    }
    if (exactVisibleText.includes('|')) fail('visible text must not contain a Markdown table separator');
  }
  const lines = markdown.split('\n');
  const matchingSummaryRows = lines
    .map((line, index) => ({line, index}))
    .filter(({line}) => line.startsWith(`| ${shotId} |`));
  if (matchingSummaryRows.length !== 1) fail(`${shotId} Summary row must appear exactly once`);
  const summary = matchingSummaryRows[0];
  const cells = summary.line.split('|');
  if (cells.length !== 9) fail(`${shotId} Summary row must contain seven columns`);
  cells[6] = mode === 'none'
    ? ' 无 '
    : ` ${exactVisibleText.replaceAll('\n', '<br>')} `;
  lines[summary.index] = cells.join('|');

  let next = lines.join('\n');
  const sectionStart = next.indexOf(`## ${shotId}\n`);
  if (sectionStart < 0) fail(`${shotId} detailed section is missing`);
  const followingSection = next.indexOf('\n## ', sectionStart + 4);
  const sectionEnd = followingSection < 0 ? next.length : followingSection;
  const section = next.slice(sectionStart, sectionEnd);
  const matches = section.match(/^- 可见文字：[\s\S]*?(?=^- )/gm) ?? [];
  if (matches.length !== 1) fail(`${shotId} detailed visible-text projection must appear exactly once`);
  const placementSuffix = mode === 'required'
    ? `${visibleTextPlacement.trim()}${/[。！？!?]$/u.test(visibleTextPlacement.trim()) ? '' : '。'}`
    : null;
  const revisedProjection = mode === 'none'
    ? '- 可见文字：`none`\n'
    : `- 可见文字：\`required\`；\`${exactVisibleText}\`；${placementSuffix}\n`;
  const revisedSection = section.replace(
    /^- 可见文字：[\s\S]*?(?=^- )/m,
    revisedProjection,
  );
  next = `${next.slice(0, sectionStart)}${revisedSection}${next.slice(sectionEnd)}`;
  next = next.replace(/^(# .+分镜草案 v)\d+$/m, `$1${nextDraftVersion}`);
  return next;
};

export const reviseStoryboardVisibleTextToNone = (markdown, shotId, nextDraftVersion) => (
  reviseStoryboardVisibleText(markdown, shotId, nextDraftVersion)
);

export const buildRevisedDirectionReview = ({
  priorReview,
  shotId,
  storyboardPath,
  storyboardChecksumSha256,
  policySha256,
  authorizedAt,
  visibleTextMode = 'none',
  exactVisibleText = null,
  visibleTextPlacement = null,
}) => {
  if (priorReview?.contract_version !== 'per-shot-visual-direction-review-v3'
    || priorReview.status !== 'policy_authorized'
    || priorReview.presented_map_sha256 !== buildPresentedMapSha256(priorReview)) {
    fail('current visual-direction review is stale or unsupported');
  }
  const next = structuredClone(priorReview);
  next.storyboard = {path: storyboardPath, checksum_sha256: storyboardChecksumSha256};
  const rows = next.rows.filter((row) => row.shot_id === shotId);
  if (rows.length !== 1) fail(`${shotId} visual-direction row must appear exactly once`);
  const row = rows[0];
  if (!['none', 'required'].includes(visibleTextMode)) fail('visible text mode must be none or required');
  if (visibleTextMode === 'none') {
    if (exactVisibleText !== null || visibleTextPlacement !== null) {
      fail('visible text none requires null exact copy and placement');
    }
  } else {
    validateConciseSummaryVisibleText(exactVisibleText, {shotId});
    if (typeof visibleTextPlacement !== 'string' || visibleTextPlacement.trim() === '') {
      fail('required visible text placement is empty');
    }
  }
  row.visible_text_mode = visibleTextMode;
  row.exact_visible_text = exactVisibleText;
  row.visible_text_placement = visibleTextPlacement;
  next.presented_map_sha256 = buildPresentedMapSha256(next);
  return authorizeVisualDirectionRecommendationsOneClick(next, {policySha256, authorizedAt});
};

export const buildRevisedDraftActiveStoryboardBinding = ({path: storyboardPath, checksumSha256}) => {
  if (typeof storyboardPath !== 'string' || storyboardPath === '' || path.isAbsolute(storyboardPath)
    || !SHA256.test(checksumSha256 ?? '')) {
    fail('revised active storyboard draft binding is invalid');
  }
  return {
    status: 'draft_visual_direction_policy_authorized',
    path: storyboardPath,
    checksum_sha256: checksumSha256,
    prior_approved_storyboard: null,
  };
};

export const rebindPolicyAuthorizedVisualRhythm = ({
  priorRhythm,
  storyboard,
  visualDirectionReview,
  policySha256,
  authorizedAt,
}) => {
  if (priorRhythm?.contract_version !== 'storyboard-visual-rhythm-v2'
    || priorRhythm.status !== 'policy_authorized'
    || priorRhythm.policy_authorization?.policy_sha256 !== policySha256
    || !SHA256.test(policySha256 ?? '')
    || typeof authorizedAt !== 'string' || Number.isNaN(Date.parse(authorizedAt))) {
    fail('storyboard visual rhythm cannot be policy-rebound');
  }
  const next = structuredClone(priorRhythm);
  next.storyboard = structuredClone(storyboard);
  next.visual_direction_review = structuredClone(visualDirectionReview);
  const nextMapSha256 = buildStoryboardVisualRhythmMapSha256(next);
  next.presented_map_sha256 = nextMapSha256;
  next.policy_authorization = {
    ...next.policy_authorization,
    authorized_at: authorizedAt,
    presented_map_sha256: nextMapSha256,
  };
  for (const shot of next.shots ?? []) {
    for (const transition of shot.intra_shot_transition_plan ?? []) {
      if (transition.user_selection?.status === 'policy_authorized') {
        transition.user_selection.authorized_at = authorizedAt;
        transition.user_selection.presented_map_sha256 = nextMapSha256;
      }
    }
    if (shot.extended_family_approval?.status === 'policy_authorized') {
      shot.extended_family_approval.authorized_at = authorizedAt;
      shot.extended_family_approval.presented_map_sha256 = nextMapSha256;
    }
  }
  return next;
};

export const rebindPolicyAuthorizedActionScheduleSet = ({
  priorActionScheduleSet,
  storyboard,
  visualRhythm,
  reboundAt,
}) => {
  if (priorActionScheduleSet?.contract_version !== 'action-state-schedule-set-v1'
    || !Array.isArray(priorActionScheduleSet.schedules)
    || priorActionScheduleSet.schedule_count !== priorActionScheduleSet.schedules.length
    || typeof reboundAt !== 'string' || Number.isNaN(Date.parse(reboundAt))) {
    fail('action-state schedule set cannot be policy-rebound');
  }
  const next = structuredClone(priorActionScheduleSet);
  next.storyboard = structuredClone(storyboard);
  next.visual_rhythm = structuredClone(visualRhythm);
  next.generated_at = reboundAt;
  next.qa = {...next.qa, checked_at: reboundAt};
  return next;
};

const buildArtifacts = ({
  episodeWorkspace,
  shotId,
  exactMessage,
  requestedAt,
  exactVisibleText = null,
  visibleTextPlacement = null,
}) => {
  if (!/^S\d{2,}$/.test(shotId)) fail('shot ID is invalid');
  if (typeof exactMessage !== 'string' || exactMessage.trim() === '') fail('change request message is empty');
  if (typeof requestedAt !== 'string' || Number.isNaN(Date.parse(requestedAt))) fail('requested time is invalid');

  const workspace = resolveRootRelative(`${episodeWorkspace}/schema/episode-state.json`, 'episode state');
  const workspaceDirectory = path.dirname(path.dirname(workspace));
  if (path.relative(path.resolve(REPOSITORY_ROOT, 'leverage-video/src'), workspaceDirectory).startsWith('..')) {
    fail('episode workspace is outside leverage-video/src');
  }
  const stateBytes = fs.readFileSync(workspace);
  const state = JSON.parse(stateBytes);
  if (state.workspace_path !== episodeWorkspace
    || state.workflow_approval_mode?.approval_mode !== 'one_click'
    || state.current_phase !== 'visual_production'
    || state.visual_asset_review?.final_review != null) {
    fail('episode must be a requeued one-click visual production without an active final review');
  }
  const sourcePath = state.narration_script_source?.source_path;
  const sourceChecksum = state.narration_script_source?.source_checksum_sha256;
  if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath) || !SHA256.test(sourceChecksum ?? '')) {
    fail('narration source binding is invalid');
  }
  const sourceStatus = fs.lstatSync(sourcePath);
  if (!sourceStatus.isFile() || sourceStatus.isSymbolicLink()
    || sha256(fs.readFileSync(sourcePath)) !== sourceChecksum) {
    fail('narration source changed; return to Gate 2');
  }

  const priorDirectionPath = resolveRootRelative(state.visual_direction_review?.path, 'visual-direction review');
  const priorDirectionBytes = fs.readFileSync(priorDirectionPath);
  if (sha256(priorDirectionBytes) !== state.visual_direction_review.checksum_sha256) {
    fail('visual-direction review checksum is stale');
  }
  const priorDirection = JSON.parse(priorDirectionBytes);
  const priorStoryboardPath = resolveRootRelative(priorDirection.storyboard?.path, 'storyboard draft');
  const priorStoryboardBytes = fs.readFileSync(priorStoryboardPath);
  if (sha256(priorStoryboardBytes) !== priorDirection.storyboard.checksum_sha256) {
    fail('storyboard draft checksum is stale');
  }

  const narrationDirectory = path.join(workspaceDirectory, 'assets/narration');
  const nextDraftName = nextNumberedPath({
    directory: narrationDirectory,
    pattern: /^storyboard-draft-v(\d+)\.md$/,
    format: (version) => `storyboard-draft-v${version}.md`,
  });
  const nextDraftVersion = Number(nextDraftName.match(/v(\d+)\.md$/)[1]);
  const nextStoryboardRelative = `${episodeWorkspace}/assets/narration/${nextDraftName}`;
  const visibleTextMode = exactVisibleText === null ? 'none' : 'required';
  const nextStoryboardBytes = Buffer.from(reviseStoryboardVisibleText(
    priorStoryboardBytes.toString('utf8'),
    shotId,
    nextDraftVersion,
    {mode: visibleTextMode, exactVisibleText, visibleTextPlacement},
  ));

  const schemaDirectory = path.join(workspaceDirectory, 'schema');
  const nextDirectionName = nextNumberedPath({
    directory: schemaDirectory,
    pattern: /^per-shot-visual-direction-review-v3-revision-(\d+)\.json$/,
    format: (version) => `per-shot-visual-direction-review-v3-revision-${String(version).padStart(2, '0')}.json`,
  });
  const nextDirectionRelative = `${episodeWorkspace}/schema/${nextDirectionName}`;
  const nextDirection = buildRevisedDirectionReview({
    priorReview: priorDirection,
    shotId,
    storyboardPath: nextStoryboardRelative,
    storyboardChecksumSha256: sha256(nextStoryboardBytes),
    policySha256: state.one_click_approval_policy?.policy_sha256,
    authorizedAt: requestedAt,
    visibleTextMode,
    exactVisibleText,
    visibleTextPlacement,
  });
  const nextDirectionBytes = jsonBytes(nextDirection);

  const priorRhythmPath = resolveRootRelative(
    state.storyboard_visual_rhythm?.path,
    'storyboard visual rhythm',
  );
  const priorRhythmBytes = fs.readFileSync(priorRhythmPath);
  if (sha256(priorRhythmBytes) !== state.storyboard_visual_rhythm.checksum_sha256) {
    fail('storyboard visual rhythm checksum is stale');
  }
  const priorRhythm = JSON.parse(priorRhythmBytes);
  const nextRhythmName = nextNumberedPath({
    directory: schemaDirectory,
    pattern: /^storyboard-visual-rhythm-v2-revision-(\d+)\.json$/,
    format: (version) => `storyboard-visual-rhythm-v2-revision-${String(version).padStart(2, '0')}.json`,
  });
  const nextRhythmRelative = `${episodeWorkspace}/schema/${nextRhythmName}`;
  const nextRhythm = rebindPolicyAuthorizedVisualRhythm({
    priorRhythm,
    storyboard: {path: nextStoryboardRelative, checksum_sha256: sha256(nextStoryboardBytes)},
    visualDirectionReview: {path: nextDirectionRelative, checksum_sha256: sha256(nextDirectionBytes)},
    policySha256: state.one_click_approval_policy.policy_sha256,
    authorizedAt: requestedAt,
  });
  validateStoryboardVisualRhythm(nextRhythm, {shotIds: nextDirection.rows.map((row) => row.shot_id)});
  const nextRhythmBytes = jsonBytes(nextRhythm);

  const priorActionSchedulePath = resolveRootRelative(
    state.storyboard_visual_rhythm?.action_state_schedule_set_path,
    'action-state schedule set',
  );
  const priorActionScheduleBytes = fs.readFileSync(priorActionSchedulePath);
  if (sha256(priorActionScheduleBytes)
    !== state.storyboard_visual_rhythm.action_state_schedule_set_checksum_sha256) {
    fail('action-state schedule set checksum is stale');
  }
  const priorActionScheduleSet = JSON.parse(priorActionScheduleBytes);
  const nextActionScheduleName = nextNumberedPath({
    directory: schemaDirectory,
    pattern: /^action-state-schedules-v4-revision-(\d+)\.json$/,
    format: (version) => `action-state-schedules-v4-revision-${String(version).padStart(2, '0')}.json`,
  });
  const nextActionScheduleRelative = `${episodeWorkspace}/schema/${nextActionScheduleName}`;
  const nextActionScheduleSet = rebindPolicyAuthorizedActionScheduleSet({
    priorActionScheduleSet,
    storyboard: {path: nextStoryboardRelative, checksum_sha256: sha256(nextStoryboardBytes)},
    visualRhythm: {path: nextRhythmRelative, checksum_sha256: sha256(nextRhythmBytes)},
    reboundAt: requestedAt,
  });
  const nextActionScheduleBytes = jsonBytes(nextActionScheduleSet);

  let nextClassification = null;
  if (state.transition_boundary_classification != null) {
    const priorClassificationPath = resolveRootRelative(
      state.transition_boundary_classification.path,
      'transition boundary classification',
    );
    const priorClassificationBytes = fs.readFileSync(priorClassificationPath);
    if (sha256(priorClassificationBytes) !== state.transition_boundary_classification.checksum_sha256) {
      fail('transition boundary classification checksum is stale');
    }
    const nextClassificationName = nextNumberedPath({
      directory: schemaDirectory,
      pattern: /^scene-transition-boundary-classification-v1-revision-(\d+)\.json$/,
      format: (version) => `scene-transition-boundary-classification-v1-revision-${String(version).padStart(2, '0')}.json`,
    });
    const nextClassificationRelative = `${episodeWorkspace}/schema/${nextClassificationName}`;
    const nextClassificationValue = JSON.parse(priorClassificationBytes);
    nextClassificationValue.storyboard_checksum_sha256 = sha256(nextStoryboardBytes);
    nextClassificationValue.visual_direction_review_checksum_sha256 = sha256(nextDirectionBytes);
    nextClassificationValue.visual_direction_presented_map_sha256 = nextDirection.presented_map_sha256;
    nextClassification = {
      path: nextClassificationRelative,
      bytes: jsonBytes(nextClassificationValue),
      value: nextClassificationValue,
    };
  }

  const nextState = structuredClone(state);
  nextState.superseded_artifacts = [
    ...(nextState.superseded_artifacts ?? []),
    {
      record_type: 'visible_text_candidate_revision',
      reason: visibleTextMode === 'none'
        ? `user_removed_visible_text_from_${shotId}`
        : `user_revised_visible_text_for_${shotId}`,
      requested_at: requestedAt,
      exact_user_request: exactMessage.trim(),
      shot_id: shotId,
      prior_visual_direction_review: structuredClone(state.visual_direction_review),
      prior_visible_text_review: structuredClone(state.visible_text_review),
      prior_transition_boundary_classification: structuredClone(state.transition_boundary_classification),
      prior_transition_review: structuredClone(state.transition_review),
      prior_storyboard_review: structuredClone(state.storyboard_review),
      prior_active_storyboard: structuredClone(state.active_storyboard),
      prior_storyboard_visual_rhythm: structuredClone(state.storyboard_visual_rhythm),
      files_deleted: false,
    },
  ];
  nextState.visual_direction_review = {
    status: 'policy_authorized',
    contract_version: nextDirection.contract_version,
    path: nextDirectionRelative,
    checksum_sha256: sha256(nextDirectionBytes),
    presented_map_sha256: nextDirection.presented_map_sha256,
    generated_shot_count: nextDirection.rows.length,
    policy_sha256: state.one_click_approval_policy.policy_sha256,
    authorized_at: requestedAt,
    deterministic_recommendation_selected: true,
    user_has_reviewed_specific_map: false,
  };
  nextState.storyboard_draft = {
    ...nextState.storyboard_draft,
    status: 'visual_direction_policy_authorized_awaiting_visible_text_review',
    version: nextDraftVersion,
    path: nextStoryboardRelative,
    checksum_sha256: sha256(nextStoryboardBytes),
    transition_status: 'blocked_by_visible_text_review',
  };
  nextState.storyboard_construction = {
    ...nextState.storyboard_construction,
    status: 'visual_direction_policy_authorized_awaiting_visible_text_review',
    draft_path: nextStoryboardRelative,
    draft_checksum_sha256: sha256(nextStoryboardBytes),
    ordinary_transition_status: 'blocked_by_visible_text_review',
    built_at: requestedAt,
  };
  delete nextState.storyboard_construction.final_storyboard_path;
  delete nextState.storyboard_construction.final_storyboard_checksum_sha256;
  nextState.transition_boundary_classification = nextClassification === null
    ? null
    : {
        status: 'ready_after_visible_text_approval',
        contract_version: nextClassification.value.contract_version,
        path: nextClassification.path,
        checksum_sha256: sha256(nextClassification.bytes),
        ordinary_boundary_count: nextClassification.value.rows.length,
        storyboard_checksum_sha256: nextClassification.value.storyboard_checksum_sha256,
        visual_direction_presented_map_sha256:
          nextClassification.value.visual_direction_presented_map_sha256,
      };
  nextState.transition_review = null;
  nextState.active_storyboard = buildRevisedDraftActiveStoryboardBinding({
    path: nextStoryboardRelative,
    checksumSha256: sha256(nextStoryboardBytes),
  });
  nextState.storyboard_review = null;
  nextState.storyboard_qa = null;
  nextState.storyboard_visual_rhythm = {
    ...nextState.storyboard_visual_rhythm,
    path: nextRhythmRelative,
    checksum_sha256: sha256(nextRhythmBytes),
    presented_map_sha256: nextRhythm.presented_map_sha256,
    action_state_schedule_set_path: nextActionScheduleRelative,
    action_state_schedule_set_checksum_sha256: sha256(nextActionScheduleBytes),
    action_state_schedule_qa: structuredClone(nextActionScheduleSet.qa),
    authorized_at: requestedAt,
  };
  nextState.gates = {
    ...nextState.gates,
    visual_direction_review: 'policy_authorized',
    visible_text_review: 'pending',
    transition_review: 'pending',
    storyboard_review: 'pending',
    visual_asset_review: 'pending',
  };
  nextState.phase = 'visual_direction_review_approved';
  nextState.current_phase = 'visual_direction_review_approved';
  nextState.blockers = [];

  return {
    result: 'pass',
    episodeWorkspace,
    shotId,
    nextStoryboard: {path: nextStoryboardRelative, bytes: nextStoryboardBytes},
    nextDirection: {path: nextDirectionRelative, bytes: nextDirectionBytes, value: nextDirection},
    nextRhythm: {path: nextRhythmRelative, bytes: nextRhythmBytes, value: nextRhythm},
    nextActionSchedule: {
      path: nextActionScheduleRelative,
      bytes: nextActionScheduleBytes,
      value: nextActionScheduleSet,
    },
    nextClassification,
    nextState: {path: `${episodeWorkspace}/schema/episode-state.json`, bytes: jsonBytes(nextState)},
  };
};

const writeArtifacts = (artifacts) => {
  const newFiles = [
    artifacts.nextStoryboard,
    artifacts.nextDirection,
    artifacts.nextRhythm,
    artifacts.nextActionSchedule,
    artifacts.nextClassification,
  ].filter(Boolean);
  for (const artifact of newFiles) {
    const target = resolveRootRelative(artifact.path, `${artifact.path} output`, {mustExist: false});
    if (fs.existsSync(target)) fail(`refusing to overwrite ${artifact.path}`);
  }
  const temporaryFiles = [];
  try {
    for (const artifact of newFiles) {
      const target = resolveRootRelative(artifact.path, `${artifact.path} output`, {mustExist: false});
      const temporary = `${target}.visible-text-change.tmp`;
      fs.writeFileSync(temporary, artifact.bytes, {flag: 'wx'});
      temporaryFiles.push({temporary, target});
    }
    const stateTarget = resolveRootRelative(artifacts.nextState.path, 'episode state');
    const stateTemporary = `${stateTarget}.visible-text-change.tmp`;
    fs.writeFileSync(stateTemporary, artifacts.nextState.bytes, {flag: 'wx'});
    temporaryFiles.push({temporary: stateTemporary, target: stateTarget});
    for (const item of temporaryFiles) fs.renameSync(item.temporary, item.target);
  } catch (error) {
    for (const item of temporaryFiles) {
      if (fs.existsSync(item.temporary)) fs.unlinkSync(item.temporary);
    }
    throw error;
  }
};

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const [
    episodeWorkspace,
    shotId,
    exactMessage,
    requestedAt,
    mode,
    exactVisibleText,
    visibleTextPlacement,
  ] = process.argv.slice(2);
  if (!episodeWorkspace || !shotId || !exactMessage || !requestedAt
    || !['--dry-run', '--apply'].includes(mode)
    || ((exactVisibleText === undefined) !== (visibleTextPlacement === undefined))) {
    console.error('usage: node request-visible-text-change.mjs <episode-workspace> <shot-id> <exact-message> <ISO-8601> <--dry-run|--apply> [<exact-visible-text> <visible-text-placement>]');
    process.exit(2);
  }
  try {
    const artifacts = buildArtifacts({
      episodeWorkspace,
      shotId,
      exactMessage,
      requestedAt,
      exactVisibleText: exactVisibleText ?? null,
      visibleTextPlacement: visibleTextPlacement ?? null,
    });
    if (mode === '--apply') writeArtifacts(artifacts);
    process.stdout.write(`${JSON.stringify({
      result: artifacts.result,
      applied: mode === '--apply',
      shot_id: shotId,
      storyboard: {path: artifacts.nextStoryboard.path, checksum_sha256: sha256(artifacts.nextStoryboard.bytes)},
      visual_direction_review: {
        path: artifacts.nextDirection.path,
        checksum_sha256: sha256(artifacts.nextDirection.bytes),
        presented_map_sha256: artifacts.nextDirection.value.presented_map_sha256,
      },
      storyboard_visual_rhythm: {
        path: artifacts.nextRhythm.path,
        checksum_sha256: sha256(artifacts.nextRhythm.bytes),
        presented_map_sha256: artifacts.nextRhythm.value.presented_map_sha256,
      },
      action_state_schedule_set: {
        path: artifacts.nextActionSchedule.path,
        checksum_sha256: sha256(artifacts.nextActionSchedule.bytes),
      },
      transition_boundary_classification: artifacts.nextClassification === null
        ? null
        : {
            path: artifacts.nextClassification.path,
            checksum_sha256: sha256(artifacts.nextClassification.bytes),
          },
      next_phase: 'visual_direction_review_approved',
    }, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
