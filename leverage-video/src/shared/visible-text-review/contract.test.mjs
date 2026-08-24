import assert from 'node:assert/strict';
import test from 'node:test';

import {
  approveVisibleTextBatchReview,
  buildPendingVisibleTextBatchReview,
  buildVisibleTextBatchMapSha256,
  validateConciseSummaryVisibleText,
  validateVisibleTextBatchReview,
} from './contract.mjs';

const SHA = (character) => character.repeat(64);

const buildFixture = () => {
  const storyboard = {
    path: 'leverage-video/src/topic8/assets/narration/storyboard-draft-v1.md',
    checksum_sha256: SHA('a'),
  };
  const visualDirectionReviewBinding = {
    path: 'leverage-video/src/topic8/schema/per-shot-visual-direction-review-v3.json',
    checksum_sha256: SHA('b'),
    presented_map_sha256: SHA('c'),
  };
  const visualDirectionReview = {
    contract_version: 'per-shot-visual-direction-review-v3',
    status: 'policy_authorized',
    storyboard,
    presented_map_sha256: visualDirectionReviewBinding.presented_map_sha256,
    rows: [
      {
        shot_id: 'S01',
        user_selection: {
          visible_text_mode: 'required',
          exact_visible_text: '一次结果 ≠ 无法改变',
          visible_text_placement: '中心结论框',
        },
      },
      {
        shot_id: 'S02',
        user_selection: {
          visible_text_mode: 'none',
          exact_visible_text: null,
          visible_text_placement: null,
        },
      },
    ],
  };
  const summaryRows = [
    {
      shot_id: 'OPEN-00',
      locked_narration: '片头首句。',
      visible_text: '无',
    },
    {
      shot_id: 'S01',
      locked_narration: '一次结果，并不等于这件事永远都没有办法改变。',
      visible_text: '一次结果 ≠ 无法改变',
    },
    {
      shot_id: 'S02',
      locked_narration: '接着区分可控和不可控。',
      visible_text: '无',
    },
  ];
  return {storyboard, visualDirectionReviewBinding, visualDirectionReview, summaryRows};
};

test('concise-summary policy accepts compact conclusions and rejects spoken prose', () => {
  assert.equal(
    validateConciseSummaryVisibleText('一次结果 ≠ 无法改变', {
      shotId: 'S01',
      sourceText: '一次结果，并不等于这件事永远都没有办法改变。',
    }).result,
    'pass',
  );
  assert.throws(
    () => validateConciseSummaryVisibleText('你看，其实一次结果不代表什么吧！', {shotId: 'S01'}),
    /spoken or prose-like visible text/,
  );
  assert.throws(
    () => validateConciseSummaryVisibleText('第一层\n第二层\n第三层', {shotId: 'S01'}),
    /at most two lines/,
  );
  assert.throws(
    () => validateConciseSummaryVisibleText('这是一个明显超过二十八个非空白字符而且不够简练的可见文字总结标签', {shotId: 'S01'}),
    /at most 28 non-whitespace code points/,
  );
});

test('pending review covers the complete visible-text map once, without row approvals', () => {
  const fixture = buildFixture();
  const review = buildPendingVisibleTextBatchReview({
    episodeWorkspace: 'leverage-video/src/topic8',
    ...fixture,
    presentedAt: '2026-08-24T14:00:00+08:00',
    exactMessage: '以下为全部镜头的可见文字，请整批审核。',
  });
  assert.equal(review.contract_version, 'visible-text-batch-review-v1');
  assert.equal(review.status, 'pending');
  assert.deepEqual(review.rows.map(({shot_id}) => shot_id), ['S01', 'S02']);
  assert.equal(review.rows[0].text_style_qa.result, 'pass');
  assert.equal(review.rows[1].text_style_qa.result, 'not_applicable');
  assert.ok(review.rows.every((row) => !Object.hasOwn(row, 'approval')));
  assert.equal(review.row_approval_mode, 'forbidden_batch_only');
  assert.equal(review.presented_map_sha256, buildVisibleTextBatchMapSha256(review));
});

test('one explicit decision approves the whole checksum-bound map', () => {
  const fixture = buildFixture();
  const pending = buildPendingVisibleTextBatchReview({
    episodeWorkspace: 'leverage-video/src/topic8',
    ...fixture,
    presentedAt: '2026-08-24T14:00:00+08:00',
    exactMessage: '以下为全部镜头的可见文字，请整批审核。',
  });
  const approved = approveVisibleTextBatchReview(pending, {
    presentedMapSha256: pending.presented_map_sha256,
    exactMessage: '批准全部可见文字',
    decidedAt: '2026-08-24T14:02:00+08:00',
  });
  assert.equal(approved.status, 'approved');
  assert.equal(approved.approval.scope, 'complete_presented_map');
  assert.equal(approved.approval.user_has_reviewed_complete_map, true);
  assert.equal(approved.approval.exact_message, '批准全部可见文字');
  assert.ok(approved.rows.every((row) => !Object.hasOwn(row, 'approval')));
  assert.equal(validateVisibleTextBatchReview(approved, {
    episodeWorkspace: 'leverage-video/src/topic8',
    ...fixture,
    requireApproved: true,
  }).result, 'pass');
});

test('stale, partial, generic, or changed visible-text maps fail closed', () => {
  const fixture = buildFixture();
  const pending = buildPendingVisibleTextBatchReview({
    episodeWorkspace: 'leverage-video/src/topic8',
    ...fixture,
    presentedAt: '2026-08-24T14:00:00+08:00',
    exactMessage: '以下为全部镜头的可见文字，请整批审核。',
  });
  assert.throws(
    () => approveVisibleTextBatchReview(pending, {
      presentedMapSha256: SHA('f'),
      exactMessage: '批准全部可见文字',
      decidedAt: '2026-08-24T14:02:00+08:00',
    }),
    /stale presented map/,
  );
  assert.throws(
    () => approveVisibleTextBatchReview(pending, {
      presentedMapSha256: pending.presented_map_sha256,
      exactMessage: '继续',
      decidedAt: '2026-08-24T14:02:00+08:00',
    }),
    /explicit complete-map approval/,
  );
  const partial = structuredClone(pending);
  partial.rows.pop();
  partial.presented_map_sha256 = buildVisibleTextBatchMapSha256(partial);
  assert.throws(
    () => validateVisibleTextBatchReview(partial, {
      episodeWorkspace: 'leverage-video/src/topic8',
      ...fixture,
      requireApproved: false,
    }),
    /complete active shot set/,
  );
  const changed = structuredClone(pending);
  changed.rows[0].exact_visible_text = '旧映射被修改';
  changed.presented_map_sha256 = buildVisibleTextBatchMapSha256(changed);
  assert.throws(
    () => validateVisibleTextBatchReview(changed, {
      episodeWorkspace: 'leverage-video/src/topic8',
      ...fixture,
      requireApproved: false,
    }),
    /does not match the current visual-direction map/,
  );
});

test('policy-authorized visual direction cannot substitute for batch text approval', () => {
  const fixture = buildFixture();
  const pending = buildPendingVisibleTextBatchReview({
    episodeWorkspace: 'leverage-video/src/topic8',
    ...fixture,
    presentedAt: '2026-08-24T14:00:00+08:00',
    exactMessage: '以下为全部镜头的可见文字，请整批审核。',
  });
  assert.throws(
    () => validateVisibleTextBatchReview(pending, {
      episodeWorkspace: 'leverage-video/src/topic8',
      ...fixture,
      requireApproved: true,
    }),
    /batch review is not approved/,
  );
});
