import {buildStaticSpread} from '../storyboard/static-spread.mjs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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

const buildLegacyV1MapSha256 = (artifact) => crypto
  .createHash('sha256')
  .update(JSON.stringify({
    contract_version: 'storyboard-visual-rhythm-v1',
    profile: artifact.profile,
    storyboard: artifact.storyboard,
    visual_direction_review: artifact.visual_direction_review,
    shots: artifact.shots.map((shot) => ({
      shot_id: shot.shot_id,
      start_frame: shot.start_frame,
      end_frame: shot.end_frame,
      motion_tier: shot.motion_tier,
      attention_function: shot.attention_function,
      visual_question: shot.visual_question,
      visual_payoff: shot.visual_payoff,
      visual_structure_id: shot.visual_structure_id,
      asset_plan: shot.asset_plan,
      state_count_rationale: shot.state_count_rationale ?? null,
      split_assessment: shot.split_assessment ?? null,
      meaningful_change_events: shot.meaningful_change_events,
      intra_shot_transition_plan: shot.intra_shot_transition_plan.map((transition) => ({
        from_asset_id: transition.from_asset_id,
        to_asset_id: transition.to_asset_id,
        kind: transition.kind,
      })),
      performance_plan: shot.performance_plan,
      continuity: shot.continuity,
    })),
  }))
  .digest('hex');

test('v1 map hashing remains byte-compatible with already approved legacy artifacts', () => {
  const artifact = buildArtifact();
  assert.equal(buildStoryboardVisualRhythmMapSha256(artifact), buildLegacyV1MapSha256(artifact));
});

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

const asV2 = (artifact, densityMode = 'rich') => {
  artifact.contract_version = 'storyboard-visual-rhythm-v2';
  artifact.density_mode = densityMode;
  artifact.visual_density_selection_sha256 = 'd'.repeat(64);
  artifact.shots.forEach((shot) => {
    shot.density_fallback ??= null;
    shot.quantity_rationale ??= null;
  });
  artifact.presented_map_sha256 = buildStoryboardVisualRhythmMapSha256(artifact);
  artifact.approval.presented_map_sha256 = artifact.presented_map_sha256;
  return artifact;
};

test('v2 rich stateful supports 4–6 and requires fallback for 2–3', () => {
  for (const count of [4, 5, 6]) {
    const artifact = asV2(buildArtifact());
    artifact.shots[0].asset_plan.main_image_count = count;
    artifact.shots[0].intra_shot_transition_plan = Array.from({length: count - 1}, (_, index) => ({
      from_asset_id: `state-${index + 1}`,
      to_asset_id: `state-${index + 2}`,
      kind: 'cut',
    }));
    artifact.presented_map_sha256 = buildStoryboardVisualRhythmMapSha256(artifact);
    artifact.approval.presented_map_sha256 = artifact.presented_map_sha256;
    assert.equal(validateStoryboardVisualRhythm(artifact).result, 'pass');
  }
  const fallback = asV2(buildArtifact());
  fallback.shots[0].density_fallback = {
    target_minimum: 4,
    actual_count: 3,
    maximum_feasible_count: 3,
    reason_code: 'insufficient_semantic_beats',
    rationale: '仅三段独立语义。',
  };
  fallback.presented_map_sha256 = buildStoryboardVisualRhythmMapSha256(fallback);
  fallback.approval.presented_map_sha256 = fallback.presented_map_sha256;
  assert.equal(validateStoryboardVisualRhythm(fallback).result, 'pass');
  fallback.shots[0].density_fallback = null;
  fallback.presented_map_sha256 = buildStoryboardVisualRhythmMapSha256(fallback);
  fallback.approval.presented_map_sha256 = fallback.presented_map_sha256;
  assert.throws(() => validateStoryboardVisualRhythm(fallback), /density fallback/);
});

test('v2 rich hero hard range and 13-pose longest path bind split and quantity rationale', () => {
  const artifact = asV2(buildArtifact());
  const shot = artifact.shots[0];
  shot.motion_tier = 'hero_pose';
  shot.asset_plan = {
    main_image_count: 1,
    layer_count: 0,
    pose_count: 13,
    reuse_plan: ['复用锁定背景'],
  };
  shot.intra_shot_transition_plan = Array.from({length: 12}, (_, index) => ({
    from_asset_id: `pose-${index + 1}`,
    to_asset_id: `pose-${index + 2}`,
    kind: 'cut',
  }));
  shot.split_assessment = {natural_semantic_pause_available: false, rationale: '连续动作不可拆。'};
  shot.quantity_rationale = '十三个姿态逐一承载不可合并的动作节点。';
  artifact.presented_map_sha256 = buildStoryboardVisualRhythmMapSha256(artifact);
  artifact.approval.presented_map_sha256 = artifact.presented_map_sha256;
  assert.equal(validateStoryboardVisualRhythm(artifact).result, 'pass');
  shot.quantity_rationale = null;
  artifact.presented_map_sha256 = buildStoryboardVisualRhythmMapSha256(artifact);
  artifact.approval.presented_map_sha256 = artifact.presented_map_sha256;
  assert.throws(() => validateStoryboardVisualRhythm(artifact), /quantity_rationale/);
});

test('v2 canonical hash binds density mode, selection hash, fallback, and split assessment', () => {
  const artifact = asV2(buildArtifact());
  artifact.shots[0].density_fallback = {
    target_minimum: 4,
    actual_count: 3,
    maximum_feasible_count: 3,
    reason_code: 'insufficient_semantic_beats',
    rationale: '三段。',
  };
  const before = buildStoryboardVisualRhythmMapSha256(artifact);
  artifact.visual_density_selection_sha256 = 'e'.repeat(64);
  assert.notEqual(buildStoryboardVisualRhythmMapSha256(artifact), before);
});

test('flipbook standard and rich mean static information density without layers or poses', () => {
  for (const density of ['standard', 'rich']) {
    const artifact = buildArtifact();
    artifact.contract_version = 'storyboard-visual-rhythm-v2';
    artifact.presentation_mode = 'illustrated-flipbook';
    artifact.density_mode = density;
    artifact.visual_density_selection_sha256 = 'd'.repeat(64);
    for (const shot of artifact.shots) {
      shot.presentation_mode = 'illustrated-flipbook';
      shot.static_spread = buildStaticSpread('完整锁稿，保持原字与标点。');
      shot.motion_tier = 'static_spread';
      shot.asset_plan = {main_image_count: 1, layer_count: 0, pose_count: 0,
        information_density: density, diagram_detail: '按本镜语义表达关系与必要细节。', reuse_plan: ['复用翻书版式']};
      shot.performance_plan = null;
      shot.intra_shot_transition_plan = [];
    }
    artifact.presented_map_sha256 = buildStoryboardVisualRhythmMapSha256(artifact);
    artifact.approval.presented_map_sha256 = artifact.presented_map_sha256;
    assert.equal(validateStoryboardVisualRhythm(artifact).result, 'pass');
    assert.ok(!validateStoryboardVisualRhythm(artifact).rhythm_qa.warnings.some((item) => item.code.startsWith('hero-pose')));
    const changed = structuredClone(artifact);
    changed.shots[0].asset_plan.layer_count = 3;
    assert.throws(() => validateStoryboardVisualRhythm(changed), /zero layers or poses/);
    const missingMode = structuredClone(artifact);
    delete missingMode.presentation_mode;
    assert.throws(() => validateStoryboardVisualRhythm(missingMode), /selected presentation/);
  }
});
