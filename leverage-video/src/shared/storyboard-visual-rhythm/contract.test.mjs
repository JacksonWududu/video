import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildStoryboardVisualRhythmMapSha256,
  validateStoryboardVisualRhythm,
} from './contract.mjs';

const performancePlan = () => ({
  character_goal: '拿到答案',
  emotion: '专注',
  anticipation: '身体前倾',
  main_action: '伸手触碰机关',
  contact_and_weight: '手掌压住机关并承重',
  impact: '机关下沉',
  recoil: '手腕轻微回弹',
  follow_through: '视线跟随亮光',
  settled_pose: '稳定站定',
  allowed_environment_responses: ['机关亮起'],
  camera_motion_complexity: 'simple',
});

const continuity = (risk = 'low') => ({
  identity: risk,
  action: risk,
  prop: risk,
  space: risk,
  lighting: risk,
  eyeline: risk,
  ...(risk === 'high' ? {
    exit_state: '手压机关',
    entry_state: '机关已下沉',
    invariants: ['角色身份', '机关位置'],
    allowed_changes: ['机关亮度'],
    edit_motivation: '从接触切到结果',
  } : {}),
});

const buildArtifact = () => {
  const artifact = {
    contract_version: 'storyboard-visual-rhythm-v1',
    profile: 'medium_high_v1',
    storyboard: {path: 'episode/script/storyboard.md', checksum_sha256: 'a'.repeat(64)},
    visual_direction_review: {path: 'episode/schema/review.json', checksum_sha256: 'b'.repeat(64)},
    shots: [
      {
        shot_id: 'S01', start_frame: 0, end_frame: 90,
        motion_tier: 'stateful', attention_function: 'hook',
        visual_question: '机关会发生什么？', visual_payoff: '机关亮起', visual_structure_id: 'cause-effect',
        state_count_rationale: null,
        asset_plan: {main_image_count: 3, layer_count: 0, pose_count: 0, reuse_plan: ['复用锁定背景']},
        meaningful_change_events: [
          {at_frame: 0, kind: 'attention-shift', description: '聚焦机关'},
          {at_frame: 30, kind: 'causal-action', description: '手掌接触机关'},
          {at_frame: 60, kind: 'information-reveal', description: '机关亮起'},
        ],
        intra_shot_transition_plan: [
          {from_asset_id: 'state-1', to_asset_id: 'state-2', kind: 'cut'},
          {from_asset_id: 'state-2', to_asset_id: 'state-3', kind: 'cut'},
        ],
        performance_plan: performancePlan(), continuity: continuity('high'),
      },
      {
        shot_id: 'S02', start_frame: 90, end_frame: 180,
        motion_tier: 'layered', attention_function: 'explain',
        visual_question: '亮光如何扩散？', visual_payoff: '路径完整出现', visual_structure_id: 'flow-map',
        state_count_rationale: null,
        asset_plan: {main_image_count: 1, layer_count: 4, pose_count: 0, reuse_plan: ['复用机关图标']},
        meaningful_change_events: [
          {at_frame: 90, kind: 'composition-change', description: '切换为路径图'},
          {at_frame: 135, kind: 'information-reveal', description: '逐段揭示路径'},
        ],
        intra_shot_transition_plan: [],
        performance_plan: performancePlan(), continuity: continuity(),
      },
    ],
    approval: {
      status: 'approved', exact_message: '批准视觉方向表及节奏详情。',
      decided_at: '2026-08-19T10:00:00+08:00', presented_map_sha256: null,
    },
    presented_map_sha256: null,
  };
  artifact.presented_map_sha256 = buildStoryboardVisualRhythmMapSha256(artifact);
  artifact.approval.presented_map_sha256 = artifact.presented_map_sha256;
  return artifact;
};

test('validates the approved rhythm map and keeps cadence findings as warnings', () => {
  const artifact = buildArtifact();
  const result = validateStoryboardVisualRhythm(artifact, {shotIds: ['S01', 'S02']});
  assert.equal(result.result, 'pass');
  assert.match(result.rhythm_qa.status, /^pass/);
});

test('enforces asset tier counts and fourth-state rationale', () => {
  const artifact = buildArtifact();
  artifact.shots[0].asset_plan.main_image_count = 4;
  artifact.presented_map_sha256 = buildStoryboardVisualRhythmMapSha256(artifact);
  artifact.approval.presented_map_sha256 = artifact.presented_map_sha256;
  assert.throws(() => validateStoryboardVisualRhythm(artifact), /state_count_rationale/);
});

test('rejects transitions disguised as meaningful changes and stale approval hashes', () => {
  const transitionEvent = buildArtifact();
  transitionEvent.shots[0].meaningful_change_events[1].kind = 'transition';
  transitionEvent.presented_map_sha256 = buildStoryboardVisualRhythmMapSha256(transitionEvent);
  transitionEvent.approval.presented_map_sha256 = transitionEvent.presented_map_sha256;
  assert.throws(() => validateStoryboardVisualRhythm(transitionEvent), /not meaningful visual changes/);

  const stale = buildArtifact();
  stale.shots[0].visual_payoff = '另一结果';
  assert.throws(() => validateStoryboardVisualRhythm(stale), /missing or stale/);
});

test('sixth hero pose requires no-split and exact map-bound approval evidence', () => {
  const artifact = buildArtifact();
  const shot = artifact.shots[0];
  shot.motion_tier = 'hero_pose';
  shot.asset_plan = {
    main_image_count: 1,
    layer_count: 0,
    pose_count: 6,
    reuse_plan: ['复用锁定背景'],
  };
  shot.intra_shot_transition_plan = Array.from({length: 5}, (_, index) => ({
    from_asset_id: `pose-${index + 1}`,
    to_asset_id: `pose-${index + 2}`,
    kind: 'cut',
  }));
  shot.split_assessment = {
    natural_semantic_pause_available: false,
    rationale: '六姿态属于同一次不可拆的冲击动作。',
  };
  artifact.presented_map_sha256 = buildStoryboardVisualRhythmMapSha256(artifact);
  artifact.approval.presented_map_sha256 = artifact.presented_map_sha256;
  assert.throws(() => validateStoryboardVisualRhythm(artifact), /exact map-bound approved evidence/);

  shot.extended_family_approval = {
    status: 'approved',
    exact_message: '批准 S01 使用六张 hero_pose 姿态图。',
    decided_at: '2026-08-19T10:00:00+08:00',
    presented_map_sha256: artifact.presented_map_sha256,
    state_plan_sha256: 'c'.repeat(64),
  };
  assert.equal(validateStoryboardVisualRhythm(artifact).result, 'pass');
});

test('watercolor transition choice is part of the rhythm map and needs explicit bound approval', () => {
  const artifact = buildArtifact();
  const transition = artifact.shots[0].intra_shot_transition_plan[0];
  transition.kind = 'watercolor-bloom';
  artifact.presented_map_sha256 = buildStoryboardVisualRhythmMapSha256(artifact);
  artifact.approval.presented_map_sha256 = artifact.presented_map_sha256;
  assert.throws(() => validateStoryboardVisualRhythm(artifact), /explicit map-bound approval/);
  transition.user_selection = {
    status: 'approved',
    exact_message: '确认该镜内边界使用 watercolor-bloom。',
    decided_at: '2026-08-19T10:00:00+08:00',
    presented_map_sha256: artifact.presented_map_sha256,
  };
  assert.equal(validateStoryboardVisualRhythm(artifact).result, 'pass');
});
