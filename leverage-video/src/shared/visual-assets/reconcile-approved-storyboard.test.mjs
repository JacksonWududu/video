import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';

import {buildReconciledState} from './reconcile-approved-storyboard.mjs';
import {parseStoryboardSummary} from '../visual-direction-review-form/contract.mjs';
import {canonicalJson} from '../ian-layered-scene/contract.mjs';

const ROOT = new URL('../../../../', import.meta.url);

const toSevenColumnStoryboard = (bytes) => {
  const markdown = bytes.toString('utf8');
  const durations = new Map([...markdown.matchAll(
    /^## (OPEN-00|S\d+)\n[\s\S]*?^- 时间 \/ 帧：[0-9.]+–[0-9.]+ 秒；旁白与合成 `\[(\d+), (\d+)\)`/gm,
  )].map((match) => [
    match[1],
    ((Number(match[3]) - Number(match[2])) / 30).toFixed(3),
  ]));
  const converted = markdown.split('\n').map((line) => {
    if (line === '| 镜头 | 画面 | 白猫 | 生图方式 | 可见文字 | 锁稿原文 |') {
      return '| 镜头 | 时长（秒） | 画面 | 白猫 | 分镜生成方式 | 可见文字 | 锁稿原文 |';
    }
    if (line === '|---|---|---|---|---|---|') return '|---|---|---|---|---|---|---|';
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length === 6 && durations.has(cells[0])) {
      return `| ${cells[0]} | ${durations.get(cells[0])} | ${cells.slice(1).join(' | ')} |`;
    }
    return line;
  }).join('\n');
  return Buffer.from(converted);
};

const withIanLayeredPlans = (storyboardBytes, directionBytes) => {
  let markdown = storyboardBytes.toString('utf8');
  const direction = JSON.parse(directionBytes);
  const narrationByShot = new Map(
    parseStoryboardSummary(markdown).map((row) => [row.shot_id, row.locked_narration]),
  );
  for (const row of direction.rows) {
    if (row.user_selection.visual_generation_route !== 'ian-handdrawn-ppt') continue;
    const shotId = row.shot_id;
    const sectionPattern = new RegExp(
      `^## ${shotId}\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`,
      'm',
    );
    const sectionMatch = markdown.match(sectionPattern);
    assert.ok(sectionMatch, `${shotId} section is missing`);
    const timing = sectionMatch[1].match(
      /- 时间 \/ 帧：[0-9.]+–[0-9.]+ 秒；旁白与合成 `\[(\d+), (\d+)\)`/,
    );
    assert.ok(timing, `${shotId} timing is missing`);
    const sourceText = narrationByShot.get(shotId);
    assert.equal(typeof sourceText, 'string');
    const plan = {
      contract_version: 'ian-layered-scene-plan-v1',
      shot_id: shotId,
      narration_source_text_sha256: crypto.createHash('sha256').update(sourceText).digest('hex'),
      scene_renderer: 'ian-static-layered-scene-v1',
      background_policy: 'static-paper-background-v1',
      layer_asset_policy: 'full-canvas-transparent-png-v1',
      layer_entry_transition: {
        contract_version: 'ian-layer-entry-fade-v1',
        duration_frames: 8,
        easing: 'linear',
      },
      motion_policy: {
        scene_transform: 'forbidden',
        layer_transform: 'forbidden',
        mask_reveal: 'forbidden',
        internal_cut: 'forbidden',
        opacity_animation: 'ian-layer-entry-fade-v1',
      },
      layer_count: 1,
      layers: [{
        layer_id: 'L01',
        z_index: 1,
        semantic_role: '完整结构说明',
        source_text_start_byte: 0,
        source_text_end_byte_exclusive: Buffer.byteLength(sourceText),
        source_text: sourceText,
        entry_frame: 0,
      }],
    };
    const marker = `- Ian 分层场景计划：\`ian-layered-scene-plan-v1\`；精确计划 \`${JSON.stringify(plan)}\`。\n`;
    markdown = markdown.replace(sectionPattern, (section) => `${section.trimEnd()}\n${marker}`);
  }
  return Buffer.from(markdown);
};

test('reconciles the approved storyboard into one ordered active queue', () => {
  const state = JSON.parse(fs.readFileSync(new URL('leverage-video/src/topic4/schema/episode-state.json', ROOT)));
  let storyboardBytes = toSevenColumnStoryboard(
    fs.readFileSync(new URL('leverage-video/src/topic4/assets/narration/storyboard-v2.md', ROOT)),
  );
  const directionBytes = fs.readFileSync(new URL('leverage-video/src/topic4/schema/per-shot-visual-direction-review-v3-approved-v2.json', ROOT));
  storyboardBytes = withIanLayeredPlans(storyboardBytes, directionBytes);
  const storyboardChecksum = crypto.createHash('sha256').update(storyboardBytes).digest('hex');
  state.current_phase = 'storyboard_review_approved';
  state.storyboard_review.approved_checksum_sha256 = storyboardChecksum;
  state.active_storyboard.checksum_sha256 = storyboardChecksum;
  state.visual_asset_review.status = 'invalidated_by_visual_contract_change';
  state.visual_asset_review.queue_generation_allowed = false;
  state.visual_asset_review.queue = state.visual_asset_review.queue
    .filter((item) => item.visual_generation_route !== 'ink-doodle-knowledge-card')
    .map((item) => item.active_for_current_storyboard === false ? item : ({
      ...item,
      active_for_current_storyboard: false,
      status: 'blocked_pending_reapproved_storyboard',
      prior_status: 'pending_generation',
    }));
  const result = buildReconciledState({
    state,
    storyboardBytes,
    directionBytes,
    reconciledAt: '2026-08-17T21:54:36+08:00',
  });
  const active = result.visual_asset_review.queue.filter((item) => item.active_for_current_storyboard !== false);
  assert.equal(result.current_phase, 'visual_production');
  assert.equal(active.length, 48);
  assert.equal(active[0].asset_id, 'S01-ink-state-00-v01');
  assert.equal(active.at(-1).asset_id, 'S18-action-03-v01');
  assert.equal(active.filter((item) => item.shot_id === 'S01').length, 4);
  assert.equal(active.filter((item) => item.shot_id === 'S05').length, 3);
  assert.equal(active.some((item) => ['doodle-slides', 'comic-imagegen'].includes(item.visual_generation_route)), false);
});

test('initializes a fresh approved v3 storyboard into the hybrid visual queue', () => {
  const state = JSON.parse(fs.readFileSync(new URL('leverage-video/src/topic5/schema/episode-state.json', ROOT)));
  let storyboardBytes = fs.readFileSync(new URL('leverage-video/src/topic5/assets/narration/storyboard-v1.md', ROOT));
  const directionBytes = fs.readFileSync(new URL('leverage-video/src/topic5/schema/per-shot-visual-direction-review-v3-approved-v1.json', ROOT));
  storyboardBytes = withIanLayeredPlans(storyboardBytes, directionBytes);
  const rhythmBytes = fs.readFileSync(new URL('leverage-video/src/topic5/schema/storyboard-visual-rhythm-v1.json', ROOT));
  const actionScheduleBytes = fs.readFileSync(new URL('leverage-video/src/topic5/schema/action-state-schedules-v3.json', ROOT));
  const storyboardChecksum = crypto.createHash('sha256').update(storyboardBytes).digest('hex');
  state.phase = 'awaiting_storyboard_review';
  state.current_phase = 'storyboard_review_approved';
  state.storyboard_review.approved_checksum_sha256 = storyboardChecksum;
  state.active_storyboard.checksum_sha256 = storyboardChecksum;
  state.visual_asset_review = null;
  const result = buildReconciledState({
    state,
    storyboardBytes,
    directionBytes,
    rhythmBytes,
    actionScheduleBytes,
    reconciledAt: '2026-08-20T21:20:00+08:00',
  });
  const active = result.visual_asset_review.queue.filter((item) => item.active_for_current_storyboard !== false);
  assert.equal(result.phase, 'visual_production');
  assert.equal(result.current_phase, 'visual_production');
  assert.equal(result.visual_asset_review.mode, 'hybrid_batch_v1');
  assert.equal(active.length, 45);
  assert.equal(active[0].asset_id, 'S01-ian-v01');
  assert.equal(active[0].ian_scene_plan.contract_version, 'ian-layered-scene-plan-v1');
  assert.equal(active[0].ian_scene_plan.layers[0].entry_frame, 0);
  assert.match(active[0].ian_scene_plan_sha256, /^[a-f0-9]{64}$/);
  assert.equal(active[1].asset_id, 'S02-master-v01');
  assert.equal(active[5].asset_id, 'S02-action-04-v01');
  assert.equal(active.at(-1).asset_id, 'S20-ian-v01');
  assert.equal(active.filter((item) => item.strict_review === true).length, 8);
  assert.equal(active.find((item) => item.asset_id === 'S19-action-03-v01').semantic_state, '完成第一个无字进度勾选');
});

test('unfinished or new Ian shots reject a legacy flattened storyboard without a layered plan', () => {
  const state = JSON.parse(fs.readFileSync(new URL('leverage-video/src/topic5/schema/episode-state.json', ROOT)));
  const storyboardBytes = fs.readFileSync(new URL(
    'leverage-video/src/topic5/assets/narration/storyboard-v1.md',
    ROOT,
  ));
  const directionBytes = fs.readFileSync(new URL(
    'leverage-video/src/topic5/schema/per-shot-visual-direction-review-v3-approved-v1.json',
    ROOT,
  ));
  const rhythmBytes = fs.readFileSync(new URL(
    'leverage-video/src/topic5/schema/storyboard-visual-rhythm-v1.json',
    ROOT,
  ));
  const actionScheduleBytes = fs.readFileSync(new URL(
    'leverage-video/src/topic5/schema/action-state-schedules-v3.json',
    ROOT,
  ));
  const storyboardChecksum = crypto.createHash('sha256').update(storyboardBytes).digest('hex');
  state.phase = 'awaiting_storyboard_review';
  state.current_phase = 'storyboard_review_approved';
  state.storyboard_review.approved_checksum_sha256 = storyboardChecksum;
  state.active_storyboard.checksum_sha256 = storyboardChecksum;
  state.visual_asset_review = null;

  assert.throws(() => buildReconciledState({
    state,
    storyboardBytes,
    directionBytes,
    rhythmBytes,
    actionScheduleBytes,
    reconciledAt: '2026-08-24T10:00:00+08:00',
  }), /lacks the exact Ian layered-scene JSON plan/);
});

test('fresh explicit density cannot initialize a legacy rhythm or schedule queue', () => {
  const state = JSON.parse(fs.readFileSync(new URL('leverage-video/src/topic5/schema/episode-state.json', ROOT)));
  let storyboardBytes = fs.readFileSync(new URL('leverage-video/src/topic5/assets/narration/storyboard-v1.md', ROOT));
  const directionBytes = fs.readFileSync(new URL('leverage-video/src/topic5/schema/per-shot-visual-direction-review-v3-approved-v1.json', ROOT));
  storyboardBytes = withIanLayeredPlans(storyboardBytes, directionBytes);
  const rhythmBytes = fs.readFileSync(new URL('leverage-video/src/topic5/schema/storyboard-visual-rhythm-v1.json', ROOT));
  const actionScheduleBytes = fs.readFileSync(new URL('leverage-video/src/topic5/schema/action-state-schedules-v3.json', ROOT));
  const storyboardChecksum = crypto.createHash('sha256').update(storyboardBytes).digest('hex');
  state.current_phase = 'storyboard_review_approved';
  state.storyboard_review.approved_checksum_sha256 = storyboardChecksum;
  state.active_storyboard.checksum_sha256 = storyboardChecksum;
  state.visual_asset_review = null;
  state.visual_density_selection = {
    density_mode: 'rich',
    selection_sha256: 'd'.repeat(64),
  };
  assert.throws(() => buildReconciledState({
    state,
    storyboardBytes,
    directionBytes,
    rhythmBytes,
    actionScheduleBytes,
    reconciledAt: '2026-08-20T21:20:00+08:00',
  }), /density\/rhythm binding is stale/);
});

test('initializes a fresh one-click storyboard only from policy-bound direction rows', () => {
  const policySha256 = 'f'.repeat(64);
  const authorizedAt = '2026-08-24T10:00:00+08:00';
  const state = JSON.parse(fs.readFileSync(new URL('leverage-video/src/topic5/schema/episode-state.json', ROOT)));
  let storyboardBytes = fs.readFileSync(new URL('leverage-video/src/topic5/assets/narration/storyboard-v1.md', ROOT));
  const direction = JSON.parse(fs.readFileSync(new URL(
    'leverage-video/src/topic5/schema/per-shot-visual-direction-review-v3-approved-v1.json',
    ROOT,
  )));
  const rhythm = JSON.parse(fs.readFileSync(new URL(
    'leverage-video/src/topic5/schema/storyboard-visual-rhythm-v1.json',
    ROOT,
  )));
  const actionScheduleBytes = fs.readFileSync(new URL(
    'leverage-video/src/topic5/schema/action-state-schedules-v3.json',
    ROOT,
  ));
  direction.status = 'policy_authorized';
  direction.policy_authorization = {
    policy_sha256: policySha256,
    authorized_at: authorizedAt,
    user_has_reviewed_specific_map: false,
    presented_map_sha256: direction.presented_map_sha256,
  };
  for (const row of direction.rows) {
    row.user_selection = {
      ...row.user_selection,
      status: 'policy_authorized',
      policy_sha256: policySha256,
      deterministic_recommendation_selected: true,
      user_has_reviewed_specific_map: false,
      exact_message: null,
      decided_at: null,
      authorized_at: authorizedAt,
      presented_map_sha256: direction.presented_map_sha256,
    };
  }
  const directionBytes = Buffer.from(`${JSON.stringify(direction, null, 2)}\n`);
  storyboardBytes = withIanLayeredPlans(storyboardBytes, directionBytes);
  rhythm.status = 'policy_authorized';
  rhythm.policy_authorization = {
    status: 'policy_authorized',
    policy_sha256: policySha256,
    deterministic_recommendation_selected: true,
    user_has_reviewed_specific_map: false,
    authorized_at: authorizedAt,
    presented_map_sha256: rhythm.presented_map_sha256,
  };
  const rhythmBytes = Buffer.from(`${JSON.stringify(rhythm, null, 2)}\n`);
  const storyboardChecksum = crypto.createHash('sha256').update(storyboardBytes).digest('hex');
  const directionChecksum = crypto.createHash('sha256').update(directionBytes).digest('hex');
  state.phase = 'storyboard_policy_authorized';
  state.current_phase = 'storyboard_policy_authorized';
  state.workflow_approval_mode = {approval_mode: 'one_click'};
  state.one_click_approval_policy = {
    contract_version: 'one-click-approval-policy-v1',
    policy_sha256: policySha256,
    preauthorizations: {
      deterministic_visual_direction_recommendations: true,
      continue_during_visual_production: true,
    },
    user_has_reviewed_specific_maps: false,
  };
  state.storyboard_review = {
    ...state.storyboard_review,
    status: 'policy_authorized',
    approved_checksum_sha256: storyboardChecksum,
    exact_decision_message: null,
    decided_at: null,
    policy_sha256: policySha256,
    user_has_reviewed_specific_storyboard: false,
  };
  state.active_storyboard.checksum_sha256 = storyboardChecksum;
  state.visual_direction_review = {
    ...state.visual_direction_review,
    status: 'policy_authorized',
    checksum_sha256: directionChecksum,
    presented_map_sha256: direction.presented_map_sha256,
    policy_sha256: policySha256,
    user_has_reviewed_specific_map: false,
  };
  state.visual_asset_review = null;
  const result = buildReconciledState({
    state,
    storyboardBytes,
    directionBytes,
    rhythmBytes,
    actionScheduleBytes,
    reconciledAt: authorizedAt,
  });
  assert.equal(result.current_phase, 'visual_production');
  assert.equal(result.visual_asset_review.mode, 'one_click_final_review_v1');
  assert.equal(result.visual_asset_review.policy_sha256, policySha256);
  assert.equal(result.visual_asset_review.queue[0].visual_direction_presented_map_sha256, direction.presented_map_sha256);

  const evidencePath = 'leverage-video/src/shared/visual-assets/reconcile-approved-storyboard.test.mjs';
  const evidenceChecksum = crypto.createHash('sha256')
    .update(fs.readFileSync(new URL(evidencePath, ROOT)))
    .digest('hex');
  const migrated = structuredClone(result);
  migrated.phase = 'storyboard_policy_authorized';
  migrated.current_phase = 'storyboard_policy_authorized';
  migrated.visual_asset_review.status = 'invalidated_pending_storyboard_rebind';
  migrated.visual_asset_review.current_asset_id = null;
  migrated.visual_asset_review.active_storyboard_binding = null;
  migrated.visual_asset_review.queue = migrated.visual_asset_review.queue.map((item) => (
    item.visual_generation_route === 'ian-handdrawn-ppt'
      ? {
          ...item,
          status: 'superseded',
          active_for_current_storyboard: false,
          superseded_reason: 'flattened_Ian_raster_replaced_by_layered_scene_contract',
        }
      : {
          ...item,
          status: 'qa_passed_pending_final_review',
          active_for_current_storyboard: false,
          rebind_status: 'preserved_exact_bytes_pending_current_storyboard_rebind',
          path: evidencePath,
          checksum_sha256: evidenceChecksum,
          qa_evidence_path: evidencePath,
          qa_evidence_checksum_sha256: evidenceChecksum,
          technical_qa: {result: 'pass'},
          semantic_qa: {result: 'pass'},
          visible_text_qa: {result: 'pass'},
          visual_qa: {result: 'pass'},
        }
  ));
  const preserved = migrated.visual_asset_review.queue.filter(
    (item) => item.rebind_status === 'preserved_exact_bytes_pending_current_storyboard_rebind',
  );
  const preservedDigest = crypto.createHash('sha256').update(Buffer.from(canonicalJson(
    preserved.map((item) => ({
      asset_id: item.asset_id,
      path: item.path,
      checksum_sha256: item.checksum_sha256,
      status: item.status,
    })),
  ))).digest('hex');
  migrated.superseded_artifacts = [{
    record_type: 'unfinished_ian_layered_scene_contract_migration',
    preserved_non_ian_asset_count: preserved.length,
    preserved_non_ian_ordered_binding_digest_sha256: preservedDigest,
    preservation_policy: 'preserve_exact_historical_bytes_and_rebind_unchanged_non_Ian_assets_later',
  }];

  const rebound = buildReconciledState({
    state: migrated,
    storyboardBytes,
    directionBytes,
    rhythmBytes,
    actionScheduleBytes,
    reconciledAt: '2026-08-24T11:00:00+08:00',
  });
  const reboundActive = rebound.visual_asset_review.queue.filter(
    (item) => item.active_for_current_storyboard !== false,
  );
  const reboundIan = reboundActive.filter(
    (item) => item.visual_generation_route === 'ian-handdrawn-ppt',
  );
  const reboundPreserved = reboundActive.filter(
    (item) => item.visual_generation_route !== 'ian-handdrawn-ppt',
  );
  assert.equal(reboundActive.length, result.visual_asset_review.queue.length);
  assert.ok(reboundIan.length > 0);
  assert.ok(reboundIan.every((item) => /-ian-v02$/.test(item.asset_id)
    && item.status === 'pending_generation'));
  assert.ok(reboundPreserved.every((item) => item.status === 'qa_passed_pending_final_review'
    && item.path === evidencePath
    && item.rebind_status === undefined));
  assert.equal(rebound.visual_asset_review.current_asset_id, reboundIan[0].asset_id);
  assert.equal(rebound.visual_asset_review.storyboard_sha256, storyboardChecksum);
  assert.equal(new Set(rebound.visual_asset_review.queue.map((item) => item.asset_id)).size,
    rebound.visual_asset_review.queue.length);

  const stalePreservation = structuredClone(migrated);
  stalePreservation.superseded_artifacts[0].preserved_non_ian_ordered_binding_digest_sha256 = '0'.repeat(64);
  assert.throws(() => buildReconciledState({
    state: stalePreservation,
    storyboardBytes,
    directionBytes,
    rhythmBytes,
    actionScheduleBytes,
    reconciledAt: '2026-08-24T11:00:00+08:00',
  }), /preserved non-Ian binding digest is stale/);

  const fabricated = structuredClone(direction);
  fabricated.rows[0].user_selection.user_has_reviewed_specific_map = true;
  const fabricatedBytes = Buffer.from(`${JSON.stringify(fabricated, null, 2)}\n`);
  const fabricatedState = structuredClone(state);
  fabricatedState.visual_direction_review.checksum_sha256 = crypto
    .createHash('sha256').update(fabricatedBytes).digest('hex');
  assert.throws(() => buildReconciledState({
    state: fabricatedState,
    storyboardBytes,
    directionBytes: fabricatedBytes,
    rhythmBytes,
    actionScheduleBytes,
    reconciledAt: authorizedAt,
  }), /fabricates concrete-map review/);
});
