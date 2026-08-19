#!/usr/bin/env node
import assert from 'node:assert/strict';

import {finalizeStoryboardMarkdown} from './finalize-approved-storyboard.mjs';
import {buildApprovedStoryboardReviewState} from './approve-storyboard-review.mjs';

const draft = `# 《知行合一》知识视频分镜草案 v4

- 当前状态：全部旧 \`doodle-slides\` 镜头已按用户明确批准改为 \`ink-doodle-knowledge-card\`；S01 与 S05 的 Ink 路线均已锁定；受影响逐边界转场尚未重审。

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
assert.match(finalized, /^# 《知行合一》知识视频分镜 v1$/m);
assert.match(finalized, /映射键 `S01→S02`，`paper-wipe` \/ 12 帧/);
assert.match(finalized, /动态：锁定 Ian 全幅遮罩扫入/);
assert.match(finalized, /## 锁定 scene-transition-v3 映射/);
assert.ok(!finalized.includes('待逐边界审核'));
assert.throws(() => finalizeStoryboardMarkdown({draftMarkdown: draft, transitionRows: []}), /more pending/);

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

console.log('finalize_approved_storyboard=pass');
