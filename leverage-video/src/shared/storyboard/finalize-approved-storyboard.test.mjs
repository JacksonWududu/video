#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

import {finalizeStoryboardMarkdown} from './finalize-approved-storyboard.mjs';
import {
  buildApprovedStoryboardReviewState,
  buildPolicyAuthorizedStoryboardReviewState,
} from './approve-storyboard-review.mjs';
import {buildPresentedMapSha256 as buildVisualDirectionMapSha256} from '../visual-generation-routes/contract.mjs';
import {parseStoryboardSummary} from '../visual-direction-review-form/contract.mjs';
import {
  approveVisibleTextBatchReview,
  buildPendingVisibleTextBatchReview,
} from '../visible-text-review/contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(HERE, '../../../..');
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const rootRelative = (absolutePath) => path.relative(REPOSITORY_ROOT, absolutePath).split(path.sep).join('/');

const draft = `# 《习得性无助》知识视频分镜草案 v4

- 当前状态：全部旧 \`doodle-slides\` 镜头已按用户明确批准改为 \`ink-doodle-knowledge-card\`；S01 与 S05 的 Ink 路线均已锁定；受影响逐边界转场尚未重审。

## 分镜 Summary

| 镜头 | 时长（秒） | 画面 | 白猫 | 分镜生成方式 | 可见文字 | 锁稿原文 |
|---|---|---|---|---|---|---|
| OPEN-00 | 1.000 | 固定封面 | 不适用 | 固定封面（cover-only-v1） | 无 | 片头首句。 |
| S01 | 1.000 | 第一镜 | false | imagegen | 无 | 第一镜口播。 |
| S02 | 1.000 | 第二镜 | false | imagegen | 无 | 第二镜口播。 |

## S01
- 动态：候选 Ian 全幅遮罩扫入，末尾完整保持；单图。
- 出场转场：待逐边界审核。

## S02
- 出场转场：终端干净保持，无出场转场。
`;
const row = {
  source_shot_id: 'S01',
  next_shot_id: 'S02',
  kind: 'paper-wipe',
  options: {},
  duration_seconds: 0.4,
  duration_in_frames: 12,
  renderer: 'leverage-video/src/shared/scene-transitions',
};
const finalized = finalizeStoryboardMarkdown({draftMarkdown: draft, transitionRows: [row]});
assert.match(finalized, /^# 《习得性无助》知识视频分镜 v1$/m);
assert.match(finalized, /映射键 `S01→S02`，`paper-wipe` \/ 12 帧/);
assert.match(finalized, /动态：锁定 Ian 全幅遮罩扫入/);
assert.match(finalized, /均已明确批准；等待本文件的 Storyboard Review/);
assert.match(finalized, /## 锁定 scene-transition-v3 映射/);
assert.ok(!finalized.includes('待逐边界审核'));
assert.throws(() => finalizeStoryboardMarkdown({draftMarkdown: draft, transitionRows: []}), /more pending/);
assert.throws(() => finalizeStoryboardMarkdown({
  draftMarkdown: draft.replace('习得性无助', ''),
  transitionRows: [row],
}), /draft title is unexpected/);

const storyboardChecksum = 'a'.repeat(64);
const approvedState = buildApprovedStoryboardReviewState({
  state: {
    current_phase: 'awaiting_storyboard_review',
    active_storyboard: {status: 'final_qa_passed_pending_storyboard_review'},
    storyboard_review: {
      status: 'pending',
      active_path: 'storyboard-v2.md',
      active_checksum_sha256: storyboardChecksum,
      presented_path: 'storyboard-v2.md',
      presented_checksum_sha256: storyboardChecksum,
    },
    blockers: [{type: 'awaiting_exact_storyboard_review_approval'}],
  },
  storyboardChecksum,
  exactMessage: '批准分镜',
  decidedAt: '2026-08-17T21:30:00+08:00',
});
assert.equal(approvedState.current_phase, 'storyboard_review_approved');
assert.equal(approvedState.storyboard_review.status, 'approved');
assert.equal(approvedState.storyboard_review.approved_checksum_sha256, storyboardChecksum);
assert.deepEqual(approvedState.blockers, []);
assert.throws(() => buildApprovedStoryboardReviewState({
  state: approvedState,
  storyboardChecksum,
  exactMessage: '批准分镜',
  decidedAt: '2026-08-17T21:30:00+08:00',
}), /incomplete, stale/);

const policyState = buildPolicyAuthorizedStoryboardReviewState({
  state: {
    current_phase: 'awaiting_storyboard_review',
    active_storyboard: {status: 'final_qa_passed_pending_storyboard_review'},
    storyboard_review: {
      status: 'pending',
      active_path: 'storyboard-v2.md',
      active_checksum_sha256: storyboardChecksum,
      presented_path: 'storyboard-v2.md',
      presented_checksum_sha256: storyboardChecksum,
    },
    blockers: [],
  },
  storyboardChecksum,
  policySha256: 'b'.repeat(64),
  authorizedAt: '2026-08-17T21:30:00+08:00',
});
assert.equal(policyState.current_phase, 'storyboard_policy_authorized');
assert.equal(policyState.storyboard_review.exact_decision_message, null);
assert.equal(policyState.storyboard_review.user_has_reviewed_specific_storyboard, false);

const policySha256 = 'c'.repeat(64);
const fixtureRoot = fs.mkdtempSync(path.join(REPOSITORY_ROOT, 'leverage-video/src/.one-click-storyboard-tooling-'));
try {
  fs.mkdirSync(path.join(fixtureRoot, 'schema'), {recursive: true});
  fs.mkdirSync(path.join(fixtureRoot, 'assets/narration'), {recursive: true});
  const episodeWorkspace = rootRelative(fixtureRoot);
  const draftRelative = `${episodeWorkspace}/assets/narration/storyboard-draft-v1.md`;
  const directionRelative = `${episodeWorkspace}/schema/per-shot-visual-direction-review-v3.json`;
  const classificationPath = path.join(fixtureRoot, 'schema/scene-transition-boundary-classification-v1.json');
  const statePath = path.join(fixtureRoot, 'schema/episode-state.json');
  const draftBytes = Buffer.from(draft);
  fs.writeFileSync(path.join(fixtureRoot, 'assets/narration/storyboard-draft-v1.md'), draftBytes);

  const directionRow = (shotId) => ({
    shot_id: shotId,
    scene_class: 'narrative_illustration',
    structured_visual_kind: null,
    factual_identity: {status: 'not_applicable'},
    white_cat_recommendation: {recommended: false, reason: 'test fixture'},
    visual_language_recommendation: {
      visual_structure_id: 'single-scene-illustration',
      treatment_profile_id: 'imagegen-watercolor-narrative',
    },
    comic_eligibility: {eligible: false},
    comic_plan_candidate: null,
    visible_text_mode: 'none',
    exact_visible_text: null,
    visible_text_placement: null,
    local_video_source_path: null,
    compatible_routes: ['imagegen'],
    incompatible_routes: [],
    incompatible_route_reasons: {},
    recommended_route: 'imagegen',
    recommendation_reason: 'test fixture',
  });
  const directionReview = {
    contract_version: 'per-shot-visual-direction-review-v3',
    status: 'policy_authorized',
    catalog_version: 'test-route-catalog',
    catalog_checksum_sha256: 'd'.repeat(64),
    visual_language_catalog_version: 'test-visual-language-catalog',
    visual_language_catalog_checksum_sha256: 'e'.repeat(64),
    storyboard: {path: draftRelative, checksum_sha256: sha256(draftBytes)},
    generated_shot_count: 2,
    rows: [directionRow('S01'), directionRow('S02')],
  };
  directionReview.presented_map_sha256 = buildVisualDirectionMapSha256(directionReview);
  directionReview.policy_authorization = {
    policy_sha256: policySha256,
    authorized_at: '2026-08-24T10:00:00+08:00',
    user_has_reviewed_specific_map: false,
    presented_map_sha256: directionReview.presented_map_sha256,
  };
  directionReview.rows.forEach((direction) => {
    direction.user_selection = {
      status: 'policy_authorized',
      white_cat_present: false,
      visual_structure_id: direction.visual_language_recommendation.visual_structure_id,
      treatment_profile_id: direction.visual_language_recommendation.treatment_profile_id,
      visual_generation_route: direction.recommended_route,
      comic_plan: null,
      visible_text_mode: 'none',
      exact_visible_text: null,
      visible_text_placement: null,
      local_video_source_path: null,
      policy_sha256: policySha256,
      deterministic_recommendation_selected: true,
      user_has_reviewed_specific_map: false,
      exact_message: null,
      decided_at: null,
      authorized_at: '2026-08-24T10:00:00+08:00',
      presented_map_sha256: directionReview.presented_map_sha256,
    };
  });

  const writeDirectionAndState = ({
    review = directionReview,
    approvalMode = 'one_click',
    includeVisibleTextReview = true,
  } = {}) => {
    const reviewBytes = jsonBytes(review);
    fs.writeFileSync(path.join(fixtureRoot, 'schema/per-shot-visual-direction-review-v3.json'), reviewBytes);
    const directionBinding = {
      status: review.status,
      path: directionRelative,
      checksum_sha256: sha256(reviewBytes),
      presented_map_sha256: review.presented_map_sha256,
    };
    const pendingTextReview = buildPendingVisibleTextBatchReview({
      episodeWorkspace,
      storyboard: review.storyboard,
      visualDirectionReviewBinding: directionBinding,
      visualDirectionReview: review,
      summaryRows: parseStoryboardSummary(draft),
      presentedAt: '2026-08-24T10:00:20+08:00',
      exactMessage: '请整批审核全部可见文字。',
    });
    const visibleTextReview = approveVisibleTextBatchReview(pendingTextReview, {
      presentedMapSha256: pendingTextReview.presented_map_sha256,
      exactMessage: '批准全部可见文字',
      decidedAt: '2026-08-24T10:00:30+08:00',
    });
    const visibleTextRelative = `${episodeWorkspace}/schema/visible-text-batch-review-v1.json`;
    const visibleTextBytes = jsonBytes(visibleTextReview);
    fs.writeFileSync(path.join(fixtureRoot, 'schema/visible-text-batch-review-v1.json'), visibleTextBytes);
    const state = {
      workspace_path: episodeWorkspace,
      current_phase: 'visible_text_review_approved',
      workflow_approval_mode: {approval_mode: approvalMode},
      one_click_approval_policy: {
        contract_version: 'one-click-approval-policy-v1',
        policy_sha256: policySha256,
        preauthorizations: {
          deterministic_visual_direction_recommendations: true,
          deterministic_transition_recommendations: true,
          storyboard_review: true,
        },
        user_has_reviewed_specific_maps: false,
      },
      visual_direction_review: directionBinding,
      visible_text_review: includeVisibleTextReview ? {
        contract_version: visibleTextReview.contract_version,
        status: 'approved',
        path: visibleTextRelative,
        checksum_sha256: sha256(visibleTextBytes),
        presented_map_sha256: visibleTextReview.presented_map_sha256,
        presentation: visibleTextReview.presentation,
        exact_decision_message: visibleTextReview.approval.exact_message,
        decided_at: visibleTextReview.approval.decided_at,
        approval_scope: visibleTextReview.approval.scope,
        user_has_reviewed_complete_map: true,
        row_by_row_approval_performed: false,
      } : null,
      active_storyboard: {
        path: draftRelative,
        checksum_sha256: sha256(draftBytes),
        prior_approved_storyboard: null,
      },
      storyboard_construction: {draft_checksum_sha256: sha256(draftBytes)},
      storyboard_review: null,
      storyboard_qa: null,
      blockers: [],
    };
    fs.writeFileSync(statePath, jsonBytes(state));
  };

  const directionBytes = jsonBytes(directionReview);
  fs.writeFileSync(classificationPath, jsonBytes({
    contract_version: 'scene-transition-boundary-classification-v1',
    episode_workspace: episodeWorkspace,
    storyboard_checksum_sha256: sha256(draftBytes),
    visual_direction_review_checksum_sha256: sha256(directionBytes),
    visual_direction_presented_map_sha256: directionReview.presented_map_sha256,
    rows: [{
      source_shot_id: 'S01',
      next_shot_id: 'S02',
      boundary_change_class: 'continuity',
      reason: 'test fixture continuity',
    }],
  }));
  const buildTool = path.join(REPOSITORY_ROOT, 'leverage-video/src/shared/scene-transitions/build-review-proposal.mjs');
  const approveTool = path.join(REPOSITORY_ROOT, 'leverage-video/src/shared/scene-transitions/approve-review-proposal.mjs');
  const finalizeTool = path.join(REPOSITORY_ROOT, 'leverage-video/src/shared/storyboard/finalize-approved-storyboard.mjs');
  const run = (script, args) => spawnSync(process.execPath, [script, ...args], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
  });

  writeDirectionAndState();
  const policyDirectionDryRun = run(buildTool, [
    episodeWorkspace,
    classificationPath,
    '2026-08-24T10:01:00+08:00',
    '--dry-run',
  ]);
  assert.equal(policyDirectionDryRun.status, 0, policyDirectionDryRun.stderr);

  writeDirectionAndState({includeVisibleTextReview: false});
  const policyWithoutVisibleTextApproval = run(buildTool, [
    episodeWorkspace,
    classificationPath,
    '2026-08-24T10:01:00+08:00',
    '--dry-run',
  ]);
  assert.notEqual(policyWithoutVisibleTextApproval.status, 0);
  assert.match(policyWithoutVisibleTextApproval.stderr, /complete visible-text batch approval is missing/);

  writeDirectionAndState({approvalMode: 'manual'});
  const manualWithPolicyDirection = run(buildTool, [
    episodeWorkspace,
    classificationPath,
    '2026-08-24T10:01:00+08:00',
    '--dry-run',
  ]);
  assert.notEqual(manualWithPolicyDirection.status, 0);

  const fabricatedReview = structuredClone(directionReview);
  fabricatedReview.policy_authorization.user_has_reviewed_specific_map = true;
  fabricatedReview.rows[0].user_selection.user_has_reviewed_specific_map = true;
  writeDirectionAndState({review: fabricatedReview});
  const fabricatedDirectionReview = run(buildTool, [
    episodeWorkspace,
    classificationPath,
    '2026-08-24T10:01:00+08:00',
    '--dry-run',
  ]);
  assert.notEqual(fabricatedDirectionReview.status, 0);
  assert.match(fabricatedDirectionReview.stderr, /fabricates concrete-map review/);

  writeDirectionAndState();
  const built = run(buildTool, [
    episodeWorkspace,
    classificationPath,
    '2026-08-24T10:01:00+08:00',
    '--apply',
  ]);
  assert.equal(built.status, 0, built.stderr);
  const builtState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const builtProposal = JSON.parse(fs.readFileSync(
    path.join(REPOSITORY_ROOT, builtState.transition_review.path),
    'utf8',
  ));
  assert.equal(builtProposal.presentation.presented_at, null);
  assert.equal(builtProposal.presentation.exact_message, null);
  assert.equal(builtProposal.presentation.user_has_reviewed_specific_map, false);
  assert.equal(builtState.transition_review.presented_at, null);
  assert.equal(builtState.transition_review.exact_presentation_message, null);
  assert.equal(builtState.transition_review.user_has_reviewed_specific_map, false);
  const authorized = run(approveTool, [
    episodeWorkspace,
    policySha256,
    '2026-08-24T10:02:00+08:00',
    '--one-click-apply',
  ]);
  assert.equal(authorized.status, 0, authorized.stderr);

  const oneClickFinalized = finalizeStoryboardMarkdown({
    draftMarkdown: draft,
    transitionRows: [row],
    authorizationMode: 'one_click',
  });
  assert.match(oneClickFinalized, /均已按一键策略授权/);
  assert.ok(!oneClickFinalized.includes('均已明确批准'));

  const finalizationDryRun = run(finalizeTool, [
    episodeWorkspace,
    '2026-08-24T10:03:00+08:00',
    '--dry-run',
  ]);
  assert.equal(finalizationDryRun.status, 0, finalizationDryRun.stderr);
} finally {
  fs.rmSync(fixtureRoot, {recursive: true, force: true});
}

console.log('finalize_approved_storyboard=pass');
