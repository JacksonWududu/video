import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildApproveArtifacts,
  buildPresentArtifacts,
  writeVisibleTextReviewArtifacts,
} from './manage-visible-text-review.mjs';

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

const buildRepository = () => {
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'visible-text-review-'));
  const episodeWorkspace = 'leverage-video/src/topic8';
  const workspace = path.join(repositoryRoot, episodeWorkspace);
  fs.mkdirSync(path.join(workspace, 'assets/narration'), {recursive: true});
  fs.mkdirSync(path.join(workspace, 'schema'), {recursive: true});
  const storyboardRelative = `${episodeWorkspace}/assets/narration/storyboard-draft-v1.md`;
  const storyboard = `# 《测试》知识视频分镜草案 v1

## 分镜 Summary

| 镜头 | 时长（秒） | 画面 | 白猫 | 分镜生成方式 | 可见文字 | 锁稿原文 |
|---|---|---|---|---|---|---|
| OPEN-00 | 1.000 | 固定封面 | 不适用 | 固定封面（cover-only-v1） | 无 | 片头首句。 |
| S01 | 2.000 | 对比结论 | false | ian-handdrawn-ppt | 一次结果 ≠ 无法改变 | 一次结果，并不等于永远无法改变。 |
`;
  const storyboardBytes = Buffer.from(storyboard);
  fs.writeFileSync(path.join(repositoryRoot, storyboardRelative), storyboardBytes);

  const directionRelative = `${episodeWorkspace}/schema/per-shot-visual-direction-review-v3.json`;
  const direction = {
    contract_version: 'per-shot-visual-direction-review-v3',
    status: 'policy_authorized',
    storyboard: {path: storyboardRelative, checksum_sha256: sha256(storyboardBytes)},
    presented_map_sha256: 'c'.repeat(64),
    rows: [{
      shot_id: 'S01',
      user_selection: {
        visible_text_mode: 'required',
        exact_visible_text: '一次结果 ≠ 无法改变',
        visible_text_placement: '中心结论框',
      },
    }],
  };
  const directionBytes = jsonBytes(direction);
  fs.writeFileSync(path.join(repositoryRoot, directionRelative), directionBytes);
  const state = {
    workspace_path: episodeWorkspace,
    current_phase: 'visual_direction_review_approved',
    workflow_approval_mode: {approval_mode: 'one_click'},
    visual_direction_review: {
      status: 'policy_authorized',
      path: directionRelative,
      checksum_sha256: sha256(directionBytes),
      presented_map_sha256: direction.presented_map_sha256,
    },
    visible_text_review: null,
    transition_review: {status: 'not_started'},
    blockers: [],
    superseded_artifacts: [],
  };
  fs.writeFileSync(path.join(workspace, 'schema/episode-state.json'), jsonBytes(state));
  return {repositoryRoot, episodeWorkspace};
};

test('present writes one complete batch and pauses both approval modes', () => {
  const fixture = buildRepository();
  const artifacts = buildPresentArtifacts({
    ...fixture,
    presentedAt: '2026-08-24T15:00:00+08:00',
    exactMessage: '请整批审核以下全部可见文字。',
  });
  assert.equal(artifacts.review.status, 'pending');
  assert.equal(artifacts.review.rows.length, 1);
  assert.equal(artifacts.state.current_phase, 'awaiting_visible_text_review');
  assert.equal(artifacts.state.visible_text_review.status, 'pending');
  writeVisibleTextReviewArtifacts(artifacts, {repositoryRoot: fixture.repositoryRoot});
  assert.ok(fs.existsSync(path.join(fixture.repositoryRoot, artifacts.reviewPath)));
});

test('one batch approval advances to the pre-transition phase without row approvals', () => {
  const fixture = buildRepository();
  const presented = buildPresentArtifacts({
    ...fixture,
    presentedAt: '2026-08-24T15:00:00+08:00',
    exactMessage: '请整批审核以下全部可见文字。',
  });
  writeVisibleTextReviewArtifacts(presented, {repositoryRoot: fixture.repositoryRoot});
  const approved = buildApproveArtifacts({
    ...fixture,
    presentedMapSha256: presented.review.presented_map_sha256,
    exactMessage: '批准全部可见文字',
    decidedAt: '2026-08-24T15:02:00+08:00',
  });
  assert.equal(approved.review.status, 'approved');
  assert.ok(approved.review.rows.every((row) => !Object.hasOwn(row, 'approval')));
  assert.equal(approved.state.current_phase, 'visible_text_review_approved');
  assert.equal(approved.state.visible_text_review.status, 'approved');
  assert.equal(approved.state.visible_text_review.exact_decision_message, '批准全部可见文字');
});

test('presentation fails outside the visual-direction handoff', () => {
  const fixture = buildRepository();
  const statePath = path.join(
    fixture.repositoryRoot,
    fixture.episodeWorkspace,
    'schema/episode-state.json',
  );
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  state.current_phase = 'visual_production';
  fs.writeFileSync(statePath, jsonBytes(state));
  assert.throws(
    () => buildPresentArtifacts({
      ...fixture,
      presentedAt: '2026-08-24T15:00:00+08:00',
      exactMessage: '请整批审核以下全部可见文字。',
    }),
    /not ready for complete visible-text presentation/,
  );
});
