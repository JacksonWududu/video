import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  buildReconciledState,
  buildStandardItems,
  hasUnchangedVisualContract,
  hasPassingReusableEvidence,
  inspectVisualContractChange,
  preserveReusableMechanicalOverrideBlockers,
  validateFreshActionScheduleSet,
} from './reconcile-approved-storyboard.mjs';
import {
  buildActionStatePlanSha256,
  buildActionStateScheduleV4,
} from '../action-state-schedule/contract.mjs';

const DENSITY_SELECTION_SHA256 = 'd'.repeat(64);

const buildSemanticStates = (count, totalFrames) => {
  const characters = [...'甲乙丙丁戊己庚辛壬癸'].slice(0, count);
  let byteCursor = 0;
  return characters.map((character, index) => {
    const byteLength = Buffer.byteLength(character);
    const state = {
      state_id: `pose-${index + 1}`,
      semantic_state: `姿态-${index + 1}`,
      narration_byte_start: byteCursor,
      narration_byte_end: byteCursor + byteLength,
      narration_text: character,
      at_frame: Math.floor(index * totalFrames / count),
      semantic_hold_reason: null,
    };
    byteCursor += byteLength;
    return state;
  });
};

const buildHeroScheduleFixture = ({shotId, poseCount, startFrame = 0}) => {
  const totalFrames = poseCount * 30;
  const sourceText = [...'甲乙丙丁戊己庚辛壬癸'].slice(0, poseCount).join('');
  const schedule = buildActionStateScheduleV4({
    totalFrames,
    sourceText,
    motionTier: 'hero_pose',
    states: buildSemanticStates(poseCount, totalFrames),
    densityMode: 'standard',
    visualDensitySelectionSha256: DENSITY_SELECTION_SHA256,
    backgroundAssetId: `${shotId}-background`,
    splitAssessment: poseCount === 6 ? {
      natural_semantic_pause_available: false,
      rationale: '六个姿态构成一段不可拆的连续动作。',
    } : null,
  });
  return {
    shot_id: shotId,
    shot_start_frame: startFrame,
    shot_end_frame: startFrame + totalFrames,
    state_plan_sha256: buildActionStatePlanSha256(schedule),
    schedule,
  };
};

test('fresh action schedules are validated from their data, not a self-reported QA flag', () => {
  const entries = [
    buildHeroScheduleFixture({shotId: 'S01', poseCount: 4}),
    buildHeroScheduleFixture({shotId: 'S02', poseCount: 6, startFrame: 120}),
  ];
  const rhythm = {
    contract_version: 'storyboard-visual-rhythm-v2',
    density_mode: 'standard',
    visual_density_selection_sha256: DENSITY_SELECTION_SHA256,
    shots: entries.map((entry) => ({
      shot_id: entry.shot_id,
      motion_tier: 'hero_pose',
      start_frame: entry.shot_start_frame,
      end_frame: entry.shot_end_frame,
    })),
  };
  const actionSchedules = {
    contract_version: 'action-state-schedule-set-v1',
    schedule_count: entries.length,
    schedules: entries,
    qa: {all_schedules_validated: true},
  };
  assert.doesNotThrow(() => validateFreshActionScheduleSet({rhythm, actionSchedules}));
  const stale = structuredClone(actionSchedules);
  stale.schedules[0].state_plan_sha256 = '0'.repeat(64);
  assert.throws(
    () => validateFreshActionScheduleSet({rhythm, actionSchedules: stale}),
    /action schedule binding is stale/,
  );
});

test('hero-pose queue size follows each schedule instead of a fixed shot count', () => {
  for (const poseCount of [4, 6]) {
    const actionSchedule = buildHeroScheduleFixture({shotId: 'S03', poseCount});
    const items = buildStandardItems({
      shotId: actionSchedule.shot_id,
      row: {
        scene_class: 'narrative_illustration',
        user_selection: {visual_generation_route: 'imagegen'},
      },
      count: poseCount,
      actionSchedule,
    });
    assert.equal(items.length, poseCount + 1);
    assert.equal(items[0].role, 'base/master');
    assert.equal(items[0].asset_kind, 'hero_pose_background');
    assert.equal(items[0].state_index, null);
    assert.equal(items[0].white_cat_present, false);
    assert.deepEqual(items.slice(1).map((item) => item.asset_kind),
      Array.from({length: poseCount}, () => 'hero_pose'));
    assert.deepEqual(items.slice(1).map((item) => item.state_index),
      Array.from({length: poseCount}, (_, index) => index));
    assert.ok(items.slice(1).every((item) => item.depends_on[0] === items[0].asset_id));
  }
});

test('authority-only rebinding keeps a generic visual contract unchanged', () => {
  const row = {
    user_selection: {
      visual_generation_route: 'imagegen',
      visual_structure_id: 'single-scene',
      treatment_profile_id: 'imagegen-watercolor-narrative',
      white_cat_present: false,
      white_cat_visual_style_id: null,
      white_cat_visual_style_selection_sha256: null,
      visual_cohesion_profile_id: null,
      visible_text_mode: 'none',
      exact_visible_text: null,
      visible_text_placement: null,
      local_video_source_path: null,
    },
    scene_class: 'narrative_illustration',
  };
  const item = {
    asset_id: 'S12-master-v01',
    visual_generation_route: 'imagegen',
    scene_class: 'narrative_illustration',
    visual_structure_id: 'single-scene',
    treatment_profile_id: 'imagegen-watercolor-narrative',
    white_cat_present: false,
    white_cat_visual_style_id: null,
    white_cat_visual_style_selection_sha256: null,
    visual_cohesion_profile_id: null,
    visible_text_mode: 'none',
    exact_visible_text: null,
    visible_text_placement: null,
    local_video_source_path: null,
    narration_source_text: '原文',
    shot_start_frame: 10,
    shot_end_frame: 40,
    shot_duration_frames: 30,
    state_count_total: 1,
    storyboard_path: 'old-storyboard.md',
    storyboard_checksum_sha256: 'a'.repeat(64),
    visual_direction_review_path: 'old-direction.json',
    visual_direction_review_checksum_sha256: 'b'.repeat(64),
  };
  const values = {
    item,
    row,
    summaryRow: {locked_narration: '原文'},
    timing: {startFrame: 10, endFrame: 40},
    count: 1,
    actionSchedule: null,
  };
  assert.equal(hasUnchangedVisualContract(values), true);
  assert.equal(inspectVisualContractChange(values), null);
  assert.equal(hasUnchangedVisualContract({
    ...values,
    row: {
      ...row,
      user_selection: {...row.user_selection, exact_visible_text: '改字', visible_text_mode: 'required'},
    },
  }), false);
  assert.match(inspectVisualContractChange({
    ...values,
    row: {
      ...row,
      user_selection: {...row.user_selection, exact_visible_text: '改字', visible_text_mode: 'required'},
    },
  }), /changed at visible_text_mode/);
});

test('a consumed one-time mechanical release remains reusable for the same unchanged asset', () => {
  assert.equal(hasPassingReusableEvidence({
    status: 'qa_failed_but_waived_once_pending_final_review',
    user_mechanical_gate_override_result: 'pass_with_user_override',
    visual_qa: {result: 'fail'},
  }), true);
  assert.equal(hasPassingReusableEvidence({
    status: 'qa_failed_but_waived_once_pending_final_review',
    user_mechanical_gate_override_result: null,
  }), false);
});

test('reconciliation preserves only blockers bound to carried same-asset mechanical releases', () => {
  const carried = preserveReusableMechanicalOverrideBlockers({
    blockers: [
      {
        blocker_id: 'asset-a:attempt-limit',
        status: 'failed_but_waived_once',
        user_mechanical_gate_override_sha256: 'a'.repeat(64),
      },
      {
        blocker_id: 'asset-b:attempt-limit',
        status: 'failed_but_waived_once',
        user_mechanical_gate_override_sha256: 'b'.repeat(64),
      },
      {blocker_id: 'unrelated-open-blocker', status: 'blocked'},
    ],
    activeQueue: [
      {
        asset_id: 'asset-a',
        status: 'qa_failed_but_waived_once_pending_final_review',
        user_mechanical_gate_override_result: 'pass_with_user_override',
        user_mechanical_gate_override_sha256: 'a'.repeat(64),
      },
    ],
  });
  assert.deepEqual(carried, [{
    blocker_id: 'asset-a:attempt-limit',
    status: 'failed_but_waived_once',
    user_mechanical_gate_override_sha256: 'a'.repeat(64),
  }]);
});

test('the generic reconciler module has no episode-workspace reads', () => {
  const source = fs.readFileSync(new URL('./reconcile-approved-storyboard.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /leverage-video\/src\/topic\d+|topic-round-/);
  assert.equal(buildReconciledState.name, 'buildReconciledState');
});
