#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  buildFinalStoryboardTitle,
  validateFinalStoryboard,
} from './validate-final-storyboard.mjs';
import {validateEpisodeTransitionReviewProposal} from '../scene-transitions/validate-review-proposal.mjs';

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

const nextVersionedRelativePath = ({episodeWorkspace, directory, basename, extension}) => {
  const absoluteDirectory = resolveRootRelative(`${episodeWorkspace}/${directory}`, 'versioned output directory');
  const pattern = new RegExp(`^${basename}-v(\\d+)\\.${extension}$`);
  const versions = fs.readdirSync(absoluteDirectory, {withFileTypes: true})
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => Number(entry.name.match(pattern)[1]));
  const next = (versions.length === 0 ? 0 : Math.max(...versions)) + 1;
  return `${episodeWorkspace}/${directory}/${basename}-v${next}.${extension}`;
};

export const finalizeStoryboardMarkdown = ({
  draftMarkdown,
  transitionRows,
  authorizationMode = 'manual',
  topic = null,
}) => {
  if (!['manual', 'one_click'].includes(authorizationMode)) {
    throw new Error('storyboard finalization authorization mode is invalid');
  }
  const draftTitle = draftMarkdown.match(/^# 《([^》\r\n]+)》知识视频分镜草案 v\d+\n/);
  if (!draftTitle || draftTitle[1] !== draftTitle[1].trim()) {
    throw new Error('active storyboard draft title is unexpected');
  }
  const statusLines = [...draftMarkdown.matchAll(/^- 当前状态：.*$/gm)];
  if (statusLines.length !== 1) throw new Error('active storyboard draft must contain exactly one current-status line');
  let transitionIndex = 0;
  const finalTitle = topic === null
    ? `# 《${draftTitle[1]}》知识视频分镜 v1\n`
    : buildFinalStoryboardTitle(topic);
  let markdown = draftMarkdown
    .replace(draftTitle[0], finalTitle)
    .replace(
      statusLines[0][0],
      authorizationMode === 'one_click'
        ? `- 当前状态：视觉方向与 ${transitionRows.length} 条普通 \`scene-transition-v3\` 边界均已按一键策略授权；不表示用户已查看具体映射，等待本文件绑定同一策略。`
        : `- 当前状态：视觉方向与 ${transitionRows.length} 条普通 \`scene-transition-v3\` 边界均已明确批准；等待本文件的 Storyboard Review。`,
    )
    .replaceAll('- 动态：候选 Ian 全幅遮罩扫入', '- 动态：锁定 Ian 全幅遮罩扫入')
    .replace(/^- 出场转场：待逐边界审核。$/gm, () => {
      const row = transitionRows[transitionIndex];
      if (!row) throw new Error('storyboard has more pending transition lines than approved rows');
      transitionIndex += 1;
      return `- 出场转场：映射键 \`${row.source_shot_id}→${row.next_shot_id}\`，\`${row.kind}\` / ${row.duration_in_frames} 帧（${row.duration_seconds} 秒）；options \`${JSON.stringify(row.options)}\`；共享渲染器 \`${row.renderer}\`。`;
    });
  if (transitionIndex !== transitionRows.length) {
    throw new Error('storyboard pending transition line count differs from approved row count');
  }
  if (markdown.includes('待逐边界审核') || markdown.includes('知识视频分镜草案')) {
    throw new Error('storyboard still contains draft transition or title markers');
  }
  markdown = `${markdown.trimEnd()}\n\n## 锁定 scene-transition-v3 映射\n\n\`\`\`json\n${JSON.stringify(transitionRows, null, 2)}\n\`\`\`\n`;
  return markdown;
};

const buildArtifacts = ({episodeWorkspace, presentedAt}) => {
  const transitionValidation = validateEpisodeTransitionReviewProposal(episodeWorkspace);
  if (transitionValidation.pending_boundary_count !== 0) throw new Error('transition review still has pending rows');
  const workspacePath = resolveRootRelative(episodeWorkspace, 'episode workspace');
  const statePath = path.join(workspacePath, 'schema/episode-state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const oneClick = state.workflow_approval_mode?.approval_mode === 'one_click';
  const freshOneClickReview = state.storyboard_review === null
    || (state.storyboard_review?.status === 'not_started'
      && state.storyboard_review.presented_path == null
      && state.storyboard_review.approved_path == null);
  if (oneClick) {
    const policySha256 = state.one_click_approval_policy?.policy_sha256;
    if (state.current_phase !== 'transition_policy_authorized'
      || state.transition_review?.status !== 'policy_authorized'
      || !/^[a-f0-9]{64}$/.test(policySha256 ?? '')
      || state.one_click_approval_policy?.preauthorizations?.storyboard_review !== true
      || state.one_click_approval_policy?.user_has_reviewed_specific_maps !== false
      || state.transition_review.policy_sha256 !== policySha256
      || state.transition_review.user_has_reviewed_specific_map !== false
      || !freshOneClickReview
      || state.storyboard_qa !== null
      || state.active_storyboard?.prior_approved_storyboard != null) {
      throw new Error('episode lacks fresh one-click storyboard policy authorization');
    }
  } else if (state.current_phase !== 'transition_review_approved'
    || state.storyboard_review?.status !== 'changes_requested') {
    throw new Error('episode is not ready to finalize a revised storyboard');
  }
  const sourceRelative = state.active_storyboard.path;
  const sourcePath = resolveRootRelative(sourceRelative, 'active storyboard draft path');
  const sourceBytes = fs.readFileSync(sourcePath);
  if (sha256(sourceBytes) !== state.active_storyboard.checksum_sha256
    || sha256(sourceBytes) !== state.storyboard_construction.draft_checksum_sha256) {
    throw new Error('active storyboard draft checksum is stale');
  }
  const transitionPath = resolveRootRelative(state.transition_review.path, 'approved transition review path');
  const transitionBytes = fs.readFileSync(transitionPath);
  if (sha256(transitionBytes) !== state.transition_review.checksum_sha256) {
    throw new Error('approved transition review checksum is stale');
  }
  const transitionReview = JSON.parse(transitionBytes);
  const finalRelative = nextVersionedRelativePath({
    episodeWorkspace,
    directory: 'assets/narration',
    basename: 'storyboard',
    extension: 'md',
  });
  const finalBytes = Buffer.from(finalizeStoryboardMarkdown({
    draftMarkdown: sourceBytes.toString('utf8'),
    transitionRows: transitionReview.rows,
    authorizationMode: oneClick ? 'one_click' : 'manual',
    topic: state.topic,
  }));
  const finalChecksum = sha256(finalBytes);
  const qaRelative = nextVersionedRelativePath({
    episodeWorkspace,
    directory: 'schema',
    basename: 'storyboard-qa',
    extension: 'json',
  });
  const presentationMessage = oneClick
    ? null
    : `现呈交 ${finalRelative}（SHA-256 ${finalChecksum}）及已验证旁白音频，等待用户明确批准此精确分镜版本。`;
  const nextState = structuredClone(state);
  nextState.active_storyboard = {
    status: 'final_qa_pending_file_validation',
    path: finalRelative,
    checksum_sha256: finalChecksum,
    source_draft_path: sourceRelative,
    source_draft_checksum_sha256: sha256(sourceBytes),
    prior_approved_storyboard: oneClick
      ? state.active_storyboard.prior_approved_storyboard ?? null
      : state.active_storyboard.prior_approved_storyboard,
  };
  nextState.storyboard_construction = {
    ...nextState.storyboard_construction,
    status: 'final_storyboard_qa_pending_file_validation',
    ordinary_transition_status: 'approved_and_bound',
    final_storyboard_path: finalRelative,
    final_storyboard_checksum_sha256: finalChecksum,
  };
  nextState.current_phase = 'transition_review_approved';
  const provisionalStateBytes = jsonBytes(nextState);
  return {
    sourceRelative,
    final: {relative: finalRelative, bytes: finalBytes, checksum: finalChecksum},
    qaRelative,
    presentationMessage,
    presentedAt,
    oneClick,
    state,
    provisionalState: {relative: `${episodeWorkspace}/schema/episode-state.json`, bytes: provisionalStateBytes},
  };
};

const applyArtifacts = (artifacts, episodeWorkspace) => {
  const finalTarget = resolveRootRelative(artifacts.final.relative, 'final storyboard path');
  const qaTarget = resolveRootRelative(artifacts.qaRelative, 'storyboard QA path');
  const stateTarget = resolveRootRelative(artifacts.provisionalState.relative, 'episode state path');
  if (fs.existsSync(finalTarget) || fs.existsSync(qaTarget)) throw new Error('versioned storyboard or QA output already exists');
  fs.writeFileSync(finalTarget, artifacts.final.bytes, {flag: 'wx'});
  fs.writeFileSync(stateTarget, artifacts.provisionalState.bytes);
  let qa;
  try {
    qa = {
      ...validateFinalStoryboard(episodeWorkspace, artifacts.final.relative),
      evaluated_at: artifacts.presentedAt,
    };
  } catch (error) {
    fs.unlinkSync(finalTarget);
    fs.writeFileSync(stateTarget, jsonBytes(artifacts.state));
    throw error;
  }
  const qaBytes = jsonBytes(qa);
  fs.writeFileSync(qaTarget, qaBytes, {flag: 'wx'});
  const finalState = structuredClone(artifacts.state);
  finalState.active_storyboard = {
    status: 'final_qa_passed_pending_storyboard_review',
    path: artifacts.final.relative,
    checksum_sha256: artifacts.final.checksum,
    source_draft_path: artifacts.sourceRelative,
    source_draft_checksum_sha256: artifacts.state.active_storyboard.checksum_sha256,
    prior_approved_storyboard: artifacts.oneClick
      ? artifacts.state.active_storyboard.prior_approved_storyboard ?? null
      : artifacts.state.active_storyboard.prior_approved_storyboard,
  };
  finalState.storyboard_construction = {
    ...finalState.storyboard_construction,
    status: 'storyboard_qa_passed_awaiting_storyboard_review',
    ordinary_transition_status: 'approved_and_bound',
    final_storyboard_path: artifacts.final.relative,
    final_storyboard_checksum_sha256: artifacts.final.checksum,
  };
  finalState.storyboard_qa = {
    status: 'pass',
    contract_version: qa.contract_version,
    path: artifacts.qaRelative,
    checksum_sha256: sha256(qaBytes),
    evaluated_at: artifacts.presentedAt,
    checks: qa.checks,
    prior_result: artifacts.oneClick
      ? artifacts.state.storyboard_qa?.prior_result ?? null
      : artifacts.state.storyboard_qa.prior_result,
  };
  finalState.storyboard_review = {
    ...finalState.storyboard_review,
    status: 'pending',
    revised_draft_pending_qa: false,
    active_path: artifacts.final.relative,
    active_checksum_sha256: artifacts.final.checksum,
    presented_path: artifacts.final.relative,
    presented_checksum_sha256: artifacts.final.checksum,
    presented_at: artifacts.oneClick ? null : artifacts.presentedAt,
    exact_presentation_message: artifacts.presentationMessage,
    approved_path: null,
    approved_checksum_sha256: null,
    exact_decision_message: null,
    decided_at: null,
    ...(artifacts.oneClick ? {
      policy_sha256: artifacts.state.one_click_approval_policy.policy_sha256,
      user_has_reviewed_specific_storyboard: false,
    } : {}),
  };
  finalState.superseded_artifacts = [
    ...(finalState.superseded_artifacts ?? []),
    {
      record_type: 'superseded_storyboard_review_candidate',
      reason: artifacts.oneClick
        ? 'one_click_initial_storyboard_finalized_after_policy_authorized_mappings'
        : (artifacts.state.storyboard_revision?.change_set_id
          ? 'storyboard_visual_contract_revision_completed'
          : 'visual_route_and_affected_transition_revision_completed'),
      superseded_at: artifacts.presentedAt,
      prior_artifact_path: artifacts.sourceRelative,
      prior_artifact_checksum_sha256: artifacts.state.active_storyboard.checksum_sha256,
      replacement_artifact_path: artifacts.final.relative,
      replacement_artifact_checksum_sha256: artifacts.final.checksum,
    },
  ];
  finalState.blockers = artifacts.oneClick
    ? (artifacts.state.blockers ?? []).filter((blocker) => (
        blocker?.type !== 'awaiting_exact_storyboard_review_approval'
      ))
    : [{
        type: 'awaiting_exact_storyboard_review_approval',
        storyboard_path: artifacts.final.relative,
        storyboard_checksum_sha256: artifacts.final.checksum,
        recorded_at: artifacts.presentedAt,
      }];
  finalState.current_phase = 'awaiting_storyboard_review';
  fs.writeFileSync(stateTarget, jsonBytes(finalState));
  return {qa, qaChecksum: sha256(qaBytes), stateChecksum: sha256(jsonBytes(finalState))};
};

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const [episodeWorkspace, presentedAt, mode] = process.argv.slice(2);
  if (!episodeWorkspace || !presentedAt || !['--dry-run', '--apply'].includes(mode)
    || process.argv.length !== 5
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(presentedAt)) {
    console.error('usage: node finalize-approved-storyboard.mjs <episode-workspace> <ISO-8601-with-offset> <--dry-run|--apply>');
    process.exit(2);
  }
  try {
    const artifacts = buildArtifacts({episodeWorkspace, presentedAt});
    const applied = mode === '--apply' ? applyArtifacts(artifacts, episodeWorkspace) : null;
    process.stdout.write(`${JSON.stringify({
      result: 'pass',
      mode,
      storyboard: {path: artifacts.final.relative, checksum_sha256: artifacts.final.checksum},
      qa: applied ? {path: artifacts.qaRelative, checksum_sha256: applied.qaChecksum} : null,
      state_checksum_sha256: applied?.stateChecksum ?? null,
    }, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
