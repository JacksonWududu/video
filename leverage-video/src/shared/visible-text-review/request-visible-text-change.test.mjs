import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRevisedDraftActiveStoryboardBinding,
  buildRevisedDirectionReview,
  rebindPolicyAuthorizedActionScheduleSet,
  rebindPolicyAuthorizedVisualRhythm,
  reviseStoryboardVisibleTextToNone,
} from './request-visible-text-change.mjs';
import {buildPresentedMapSha256} from '../visual-generation-routes/contract.mjs';
import {buildStoryboardVisualRhythmMapSha256} from '../storyboard-visual-rhythm/contract.mjs';

test('revises only the selected Summary and detailed visible-text projection', () => {
  const input = `# 测试分镜草案 v3

## 分镜 Summary

| 镜头 | 时长（秒） | 画面 | 白猫 | 分镜生成方式 | 可见文字 | 锁稿原文 |
|---|---|---|---|---|---|---|
| S11 | 1.000 | 甲 | false | ian-handdrawn-ppt | 无 | 原文甲 |
| S12 | 2.000 | 乙 | false | ian-handdrawn-ppt | 旧文字<br>第二行 | 原文乙 |

## S11
- 可见文字：\`none\`
- 本地视频源：\`null\`。

## S12
- 可见文字：\`required\`；\`旧文字
第二行\`；主信息区。
- 本地视频源：\`null\`。
`;
  const output = reviseStoryboardVisibleTextToNone(input, 'S12', 4);
  assert.match(output, /^# 测试分镜草案 v4/m);
  assert.match(output, /^\| S12 \| 2\.000 \| 乙 \| false \| ian-handdrawn-ppt \| 无 \| 原文乙 \|$/m);
  assert.match(output, /## S12\n- 可见文字：\`none\`\n- 本地视频源/);
  assert.match(output, /## S11\n- 可见文字：\`none\`/);
  assert.doesNotMatch(output, /旧文字/);
});

test('rebinds and policy-authorizes the complete revised visual-direction map', () => {
  const policySha256 = 'a'.repeat(64);
  const priorReview = {
    contract_version: 'per-shot-visual-direction-review-v3',
    catalog_version: 'catalog',
    catalog_checksum_sha256: 'b'.repeat(64),
    visual_language_catalog_version: 'language',
    visual_language_catalog_checksum_sha256: 'c'.repeat(64),
    storyboard: {path: 'old.md', checksum_sha256: 'd'.repeat(64)},
    status: 'policy_authorized',
    rows: [{
      shot_id: 'S12',
      scene_class: 'structured_graphic',
      structured_visual_kind: 'comparison',
      factual_identity: {},
      white_cat_recommendation: {recommended: false},
      visual_language_recommendation: {
        visual_structure_id: 'binary-comparison',
        treatment_profile_id: 'ian-handdrawn-technical',
      },
      comic_eligibility: {},
      comic_plan_candidate: null,
      visible_text_mode: 'required',
      exact_visible_text: '旧文字',
      visible_text_placement: '主信息区',
      local_video_source_path: null,
      compatible_routes: ['ian-handdrawn-ppt'],
      incompatible_routes: ['imagegen'],
      incompatible_route_reasons: {imagegen: '不兼容'},
      recommended_route: 'ian-handdrawn-ppt',
      recommendation_reason: '结构化镜头',
      user_selection: {},
    }],
  };
  priorReview.presented_map_sha256 = buildPresentedMapSha256(priorReview);
  const revised = buildRevisedDirectionReview({
    priorReview,
    shotId: 'S12',
    storyboardPath: 'new.md',
    storyboardChecksumSha256: 'e'.repeat(64),
    policySha256,
    authorizedAt: '2026-08-26T12:56:10+08:00',
  });
  assert.equal(revised.rows[0].visible_text_mode, 'none');
  assert.equal(revised.rows[0].exact_visible_text, null);
  assert.equal(revised.rows[0].user_selection.visible_text_mode, 'none');
  assert.equal(revised.status, 'policy_authorized');
  assert.equal(revised.presented_map_sha256, buildPresentedMapSha256(revised));
});

test('keeps the revised draft as the active storyboard input for finalization', () => {
  assert.deepEqual(buildRevisedDraftActiveStoryboardBinding({
    path: 'leverage-video/src/topic8/assets/narration/storyboard-draft-v4.md',
    checksumSha256: 'f'.repeat(64),
  }), {
    status: 'draft_visual_direction_policy_authorized',
    path: 'leverage-video/src/topic8/assets/narration/storyboard-draft-v4.md',
    checksum_sha256: 'f'.repeat(64),
    prior_approved_storyboard: null,
  });
});

test('rebinds unchanged rhythm and action schedules to the revised storyboard authority', () => {
  const policySha256 = 'a'.repeat(64);
  const priorRhythm = {
    contract_version: 'storyboard-visual-rhythm-v2',
    status: 'policy_authorized',
    profile: 'medium_high_v1',
    density_mode: 'rich',
    visual_density_selection_sha256: 'b'.repeat(64),
    storyboard: {path: 'old.md', checksum_sha256: 'c'.repeat(64)},
    visual_direction_review: {path: 'old-direction.json', checksum_sha256: 'd'.repeat(64)},
    shots: [],
    presented_map_sha256: 'e'.repeat(64),
    policy_authorization: {
      status: 'policy_authorized',
      policy_sha256: policySha256,
      authorized_at: '2026-08-25T10:00:00+08:00',
      deterministic_recommendation_selected: true,
      user_has_reviewed_specific_map: false,
      exact_message: null,
      decided_at: null,
      presented_map_sha256: 'e'.repeat(64),
    },
  };
  const storyboard = {path: 'new.md', checksum_sha256: 'f'.repeat(64)};
  const direction = {path: 'new-direction.json', checksum_sha256: '1'.repeat(64)};
  const reboundRhythm = rebindPolicyAuthorizedVisualRhythm({
    priorRhythm,
    storyboard,
    visualDirectionReview: direction,
    policySha256,
    authorizedAt: '2026-08-26T10:00:00+08:00',
  });
  assert.deepEqual(reboundRhythm.storyboard, storyboard);
  assert.deepEqual(reboundRhythm.visual_direction_review, direction);
  assert.equal(reboundRhythm.presented_map_sha256, buildStoryboardVisualRhythmMapSha256(reboundRhythm));
  assert.equal(reboundRhythm.policy_authorization.presented_map_sha256, reboundRhythm.presented_map_sha256);

  const reboundSchedules = rebindPolicyAuthorizedActionScheduleSet({
    priorActionScheduleSet: {
      contract_version: 'action-state-schedule-set-v1',
      storyboard: priorRhythm.storyboard,
      visual_rhythm: {path: 'old-rhythm.json', checksum_sha256: '2'.repeat(64)},
      schedules: [],
      schedule_count: 0,
      generated_at: '2026-08-25T10:00:00+08:00',
      qa: {checked_at: '2026-08-25T10:00:00+08:00'},
    },
    storyboard,
    visualRhythm: {path: 'new-rhythm.json', checksum_sha256: '3'.repeat(64)},
    reboundAt: '2026-08-26T10:00:00+08:00',
  });
  assert.deepEqual(reboundSchedules.storyboard, storyboard);
  assert.deepEqual(reboundSchedules.visual_rhythm, {path: 'new-rhythm.json', checksum_sha256: '3'.repeat(64)});
  assert.equal(reboundSchedules.generated_at, '2026-08-26T10:00:00+08:00');
  assert.equal(reboundSchedules.qa.checked_at, '2026-08-26T10:00:00+08:00');
});
