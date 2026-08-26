import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

import {
  MERGE_REQUEST_CONTRACT_VERSION,
  MERGE_RENUMBER_STRATEGY,
  SUBMISSION_CONTRACT_VERSION,
  applyBulkEdit,
  buildCompactShotMergePlan,
  buildVisualDirectionFormModel,
  compatibleRoutesForSelection,
  parseStoryboardSummary,
  resolveTreatmentProfile,
  validateApprovedDirectionSynchronization,
  validateStoryboardShotMergeRequest,
  validateVisualDirectionFormSubmission,
} from './contract.mjs';
import {loadEpisodeFormModel, renderVisualDirectionReviewForm} from './render-form.mjs';
import {validateEpisodeMergeRequestFile} from './validate-merge-request.mjs';
import {validateEpisodeSubmissionFile} from './validate-submission.mjs';
import {
  CATALOG_CHECKSUM_SHA256,
  buildPresentedMapSha256,
} from '../visual-generation-routes/contract.mjs';
import {VISUAL_LANGUAGE_CATALOG_CHECKSUM_SHA256} from '../visual-language/contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const EPISODE_WORKSPACE = 'leverage-video/src/topic4';
const reviewPath = path.join(ROOT, EPISODE_WORKSPACE, 'schema/per-shot-visual-direction-review-v3.json');
const storyboardPath = path.join(ROOT, EPISODE_WORKSPACE, 'assets/narration/storyboard-draft-v1.md');
const pendingSelection = () => ({
  status: 'pending',
  white_cat_present: null,
  visual_structure_id: null,
  treatment_profile_id: null,
  visual_generation_route: null,
  comic_plan: null,
  visible_text_mode: null,
  exact_visible_text: null,
  visible_text_placement: null,
  local_video_source_path: null,
  exact_message: null,
  decided_at: null,
  presented_map_sha256: null,
});
const summaryCell = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('|', '&#124;')
  .replaceAll('\n', '<br>');
const normalizeSummaryToRecommendations = (storyboardMarkdown, review) => {
  const rows = new Map(review.rows.map((row) => [row.shot_id, row]));
  const durations = new Map([...storyboardMarkdown.matchAll(
    /^## (OPEN-00|S\d+)\n[\s\S]*?^- 时间 \/ 帧：[0-9.]+–[0-9.]+ 秒；旁白与合成 `\[(\d+), (\d+)\)`/gm,
  )].map((match) => [match[1], ((Number(match[3]) - Number(match[2])) / 30).toFixed(3)]));
  return storyboardMarkdown
    .replace(
      '| 镜头 | 画面 | 白猫 | 生图方式 | 可见文字 | 锁稿原文 |',
      '| 镜头 | 时长（秒） | 画面 | 白猫 | 分镜生成方式 | 可见文字 | 锁稿原文 |',
    )
    .replace('|---|---|---|---|---|---|', '|---|---|---|---|---|---|---|')
    .split(/\r?\n/).map((line) => {
    if (!/^\| (?:OPEN-00|S\d+) \|/.test(line)) return line;
    let cells = line.slice(1, -1).split('|').map((cell) => cell.trim());
    if (cells.length === 6) cells = [cells[0], durations.get(cells[0]), ...cells.slice(1)];
    if (cells[0] === 'OPEN-00') return `| ${cells.join(' | ')} |`;
    const row = rows.get(cells[0]);
    if (!row || cells.length !== 7) return line;
    const visibleText = row.visible_text_mode === 'none' ? '无' : row.exact_visible_text;
    return `| ${cells[0]} | ${cells[1]} | ${cells[2]} | ${row.white_cat_recommendation.recommended} | ${row.recommended_route} | ${summaryCell(visibleText)} | ${cells[6]} |`;
  }).join('\n');
};
const readFixture = () => {
  const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8')
    .replaceAll('"doodle-slides"', '"ink-doodle-knowledge-card"')
    .replaceAll('doodle-playful-explainer', 'ink-doodle-knowledge-card'));
  review.catalog_checksum_sha256 = CATALOG_CHECKSUM_SHA256;
  review.visual_language_catalog_checksum_sha256 = VISUAL_LANGUAGE_CATALOG_CHECKSUM_SHA256;
  review.status = 'awaiting_user_selection';
  review.rows.forEach((row) => {
    delete row.presented_candidate_selection;
    row.user_selection = pendingSelection();
  });
  const storyboardMarkdown = normalizeSummaryToRecommendations(
    fs.readFileSync(storyboardPath, 'utf8'),
    review,
  );
  review.storyboard.checksum_sha256 = crypto
    .createHash('sha256')
    .update(storyboardMarkdown)
    .digest('hex');
  review.presented_map_sha256 = buildPresentedMapSha256(review);
  return {review, storyboardMarkdown};
};

test('Gate-2 twilight binding forces white-cat ImageGen treatment and route', () => {
  const row = {
    shot_id: 'S01',
    scene_class: 'narrative_illustration',
    compatible_routes: ['imagegen', 'xuan-paper-diorama'],
    white_cat_visual_style_id: 'twilight-neon-animation',
    white_cat_visual_style_selection_sha256: 'a'.repeat(64),
    visual_cohesion_profile_id: 'twilight-luminous-cohesion-v1',
    visual_language_recommendation: {
      visual_structure_id: 'single-scene',
      treatment_profile_id: 'imagegen-twilight-neon-narrative',
    },
    user_selection: {
      treatment_profile_id: 'imagegen-twilight-neon-narrative',
    },
  };
  assert.deepEqual(compatibleRoutesForSelection(row, true), ['imagegen']);
  assert.equal(resolveTreatmentProfile({
    row,
    whiteCatPresent: true,
    routeId: 'imagegen',
  }), 'imagegen-twilight-neon-narrative');
});

const buildFixtureModel = () => {
  const {review, storyboardMarkdown} = readFixture();
  return buildVisualDirectionFormModel({
    review,
    storyboardMarkdown,
    episodeWorkspace: EPISODE_WORKSPACE,
  });
};

const submittedRowFromModel = (row, overrides = {}) => ({
  shot_id: row.shot_id,
  visual_description: row.visual_description,
  white_cat_present: row.white_cat_present,
  visual_generation_route: row.visual_generation_route,
  visible_text_mode: row.visible_text_mode,
  exact_visible_text: row.exact_visible_text,
  visible_text_placement: row.visible_text_placement,
  local_video_source_path: row.local_video_source_path,
  ...overrides,
});

const submissionFor = (model, rows, mode = 'selected') => ({
  contract_version: SUBMISSION_CONTRACT_VERSION,
  episode_workspace: EPISODE_WORKSPACE,
  presented_map_sha256: model.presented_map_sha256,
  storyboard_checksum_sha256: model.storyboard.checksum_sha256,
  submission_scope: {mode, shot_ids: rows.map((row) => row.shot_id)},
  rows,
});

const validate = (submission, fixture = readFixture()) => validateVisualDirectionFormSubmission({
  ...fixture,
  submission,
  episodeWorkspace: EPISODE_WORKSPACE,
});

const mergeRequestFor = (model, shotIds) => ({
  contract_version: MERGE_REQUEST_CONTRACT_VERSION,
  episode_workspace: EPISODE_WORKSPACE,
  presented_map_sha256: model.presented_map_sha256,
  storyboard_checksum_sha256: model.storyboard.checksum_sha256,
  shot_ids: shotIds,
  renumber_strategy: MERGE_RENUMBER_STRATEGY,
});

const validateMerge = (request, fixture = readFixture()) => validateStoryboardShotMergeRequest({
  ...fixture,
  request,
  episodeWorkspace: EPISODE_WORKSPACE,
  episodeState: {
    workspace_path: EPISODE_WORKSPACE,
    request_classification: 'new_video',
    current_phase: 'awaiting_visual_direction_review',
  },
});

test('builds every active row in the seven-column model with duration and a read-only OPEN-00', () => {
  const model = buildFixtureModel();
  assert.deepEqual(model.columns, ['镜头', '时长（秒）', '画面', '白猫', '分镜生成方式', '可见文字', '锁稿原文']);
  assert.match(model.rows[0].duration_seconds_display, /^\d+\.\d{3}$/);
  assert.equal(model.row_count, model.editable_row_count + 1);
  assert.equal(model.editable_row_count, readFixture().review.rows.length);
  assert.equal(model.rows[0].shot_id, 'OPEN-00');
  assert.equal(model.rows[0].read_only, true);
  assert.equal(model.rows.filter((row) => !row.read_only).length, 20);
});

test('accepts full and selected submissions without losing their scope', () => {
  const model = buildFixtureModel();
  const editable = model.rows.filter((row) => !row.read_only);
  const fullRows = editable.map((row) => submittedRowFromModel(row));
  const full = validate(submissionFor(model, fullRows, 'all'));
  assert.equal(full.normalized_rows.length, 20);
  assert.equal(full.submission_scope.mode, 'all');

  const selectedRows = editable.slice(0, 2).map((row) => submittedRowFromModel(row));
  const selected = validate(submissionFor(model, selectedRows));
  assert.deepEqual(selected.submission_scope.shot_ids, ['S01', 'S02']);
});

test('bulk route edits apply only to compatible shots and list skipped reasons', () => {
  const model = buildFixtureModel();
  const result = applyBulkEdit(model.rows, {
    shotIds: ['S01', 'S02'],
    field: 'visual_generation_route',
    value: 'xuan-paper-diorama',
  });
  assert.deepEqual(result.applied_shot_ids, ['S02']);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].shot_id, 'S01');
  assert.match(result.skipped[0].reason, /不兼容/);
});

test('binds every selectable route to its required treatment profile', () => {
  const model = buildFixtureModel();
  const s01 = model.rows.find((row) => row.shot_id === 'S01');
  const s02 = model.rows.find((row) => row.shot_id === 'S02');
  const cases = [
    [s02, 'xuan-paper-diorama', 'xuan-paper-diorama'],
    [s01, 'ian-handdrawn-ppt', 'ian-handdrawn-technical'],
    [s01, 'ink-doodle-knowledge-card', 'ink-doodle-knowledge-card'],
    [s01, 'srt-whiteboard-animation', 'whiteboard-clean-progressive'],
    [s01, 'local-video-file', 'source-video-native'],
    [s02, 'imagegen', 'imagegen-watercolor-narrative'],
  ];
  for (const [row, route, treatment] of cases) {
    const result = validate(submissionFor(model, [submittedRowFromModel(row, {
      visual_generation_route: route,
      visible_text_mode: route === 'local-video-file' ? 'none' : row.visible_text_mode,
      exact_visible_text: route === 'local-video-file' ? null : row.exact_visible_text,
      visible_text_placement: route === 'local-video-file' ? null : row.visible_text_placement,
      local_video_source_path: route === 'local-video-file' ? '/Users/jackson/Videos/s01.mp4' : null,
    })]));
    assert.equal(result.normalized_rows[0].treatment_profile_id, treatment);
  }
});

test('local video requires an absolute per-shot path and re-presentation before approval', () => {
  const model = buildFixtureModel();
  const s01 = model.rows.find((row) => row.shot_id === 'S01');
  const base = {
    visual_generation_route: 'local-video-file',
    visible_text_mode: 'none',
    exact_visible_text: null,
    visible_text_placement: null,
  };
  assert.throws(() => validate(submissionFor(model, [submittedRowFromModel(s01, {
    ...base,
    local_video_source_path: 'relative.mp4',
  })])), /absolute \.mp4 path/);
  assert.throws(() => validate(submissionFor(model, [submittedRowFromModel(s01, {
    ...base,
    local_video_source_path: '/Users/jackson/Videos/s01.mov',
  })])), /absolute \.mp4 path/);
  const result = validate(submissionFor(model, [submittedRowFromModel(s01, {
    ...base,
    local_video_source_path: '/Users/jackson/Videos/s01.mp4',
  })]));
  assert.equal(result.normalized_rows[0].treatment_profile_id, 'source-video-native');
  assert.equal(result.normalized_rows[0].resolution, 'requires_candidate_map_refresh');
  assert.deepEqual(result.reopened_shot_ids, ['S01']);
});

test('forces xuan and white-cat ImageGen rows to be text-free', () => {
  const model = buildFixtureModel();
  const s02 = model.rows.find((row) => row.shot_id === 'S02');
  const s08 = model.rows.find((row) => row.shot_id === 'S08');
  assert.throws(() => validate(submissionFor(model, [submittedRowFromModel(s02, {
    visual_generation_route: 'xuan-paper-diorama',
    visible_text_mode: 'required',
    exact_visible_text: '不允许',
    visible_text_placement: '中央',
  })])), /text-free/);
  assert.throws(() => validate(submissionFor(model, [submittedRowFromModel(s08, {
    visible_text_mode: 'required',
    exact_visible_text: '不允许',
    visible_text_placement: '中央',
  })])), /text-free/);
});

test('required visible text needs exact copy and placement', () => {
  const model = buildFixtureModel();
  const s01 = model.rows.find((row) => row.shot_id === 'S01');
  assert.throws(() => validate(submissionFor(model, [submittedRowFromModel(s01, {
    exact_visible_text: '',
  })])), /exact visible text/);
  assert.throws(() => validate(submissionFor(model, [submittedRowFromModel(s01, {
    visible_text_placement: '',
  })])), /visible text placement/);
});

test('cat removal and visible-text edits reopen only affected shots and adjacent boundaries', () => {
  const model = buildFixtureModel();
  const s08 = model.rows.find((row) => row.shot_id === 'S08');
  const catRemoval = validate(submissionFor(model, [submittedRowFromModel(s08, {
    white_cat_present: false,
  })]));
  assert.deepEqual(catRemoval.reopened_shot_ids, ['S08']);
  assert.equal(catRemoval.normalized_rows[0].resolution, 'requires_semantic_rebuild_and_represent');
  assert.deepEqual(catRemoval.reopened_transition_boundaries, [
    {source_shot_id: 'S07', next_shot_id: 'S08'},
    {source_shot_id: 'S08', next_shot_id: 'S09'},
  ]);

  const s01 = model.rows.find((row) => row.shot_id === 'S01');
  const textEdit = validate(submissionFor(model, [submittedRowFromModel(s01, {
    exact_visible_text: '进士｜为官｜平叛｜讲学',
  })]));
  assert.equal(textEdit.normalized_rows[0].resolution, 'requires_candidate_map_refresh');
  assert.equal(textEdit.requires_represented_map_refresh, true);
});

test('visual-description edits require semantic rebuild, re-presentation, and adjacent transition review', () => {
  const model = buildFixtureModel();
  const s08 = model.rows.find((row) => row.shot_id === 'S08');
  const result = validate(submissionFor(model, [submittedRowFromModel(s08, {
    visual_description: '白猫闻到气味后先停步，再后仰遮鼻并主动离开。',
  })]));
  assert.equal(result.normalized_rows[0].changes.visual_description, true);
  assert.equal(
    result.normalized_rows[0].resolution,
    'requires_visual_semantic_rebuild_and_represent',
  );
  assert.deepEqual(result.reopened_shot_ids, ['S08']);
  assert.deepEqual(result.reopened_transition_boundaries, [
    {source_shot_id: 'S07', next_shot_id: 'S08'},
    {source_shot_id: 'S08', next_shot_id: 'S09'},
  ]);
  assert.equal(result.requires_represented_map_refresh, true);
});

test('compatible route-only edits are immediately selection-ready', () => {
  const model = buildFixtureModel();
  const s02 = model.rows.find((row) => row.shot_id === 'S02');
  const result = validate(submissionFor(model, [submittedRowFromModel(s02, {
    visual_generation_route: 'xuan-paper-diorama',
  })]));
  assert.deepEqual(result.selection_ready_shot_ids, ['S02']);
  assert.deepEqual(result.reopened_shot_ids, []);
});

test('re-presents a submitted route and visible-text candidate before approval', () => {
  const fixture = readFixture();
  const s01 = fixture.review.rows.find((row) => row.shot_id === 'S01');
  s01.visible_text_mode = 'required';
  s01.exact_visible_text = '进士｜当官｜平叛｜阳明心学';
  s01.visible_text_placement = '横向时间线四节点';
  s01.presented_candidate_selection = {
    white_cat_present: false,
    visual_structure_id: 'timeline',
    treatment_profile_id: 'ink-doodle-knowledge-card',
    visual_generation_route: 'ink-doodle-knowledge-card',
    visible_text_mode: 'required',
    exact_visible_text: '进士｜当官｜平叛｜阳明心学',
    visible_text_placement: '横向时间线四节点',
  };
  const priorMap = fixture.review.presented_map_sha256;
  fixture.review.presented_map_sha256 = buildPresentedMapSha256(fixture.review);
  assert.notEqual(fixture.review.presented_map_sha256, priorMap);

  const model = buildVisualDirectionFormModel({
    ...fixture,
    episodeWorkspace: EPISODE_WORKSPACE,
  });
  const candidate = model.rows.find((row) => row.shot_id === 'S01');
  assert.equal(candidate.visual_generation_route, 'ink-doodle-knowledge-card');
  assert.equal(candidate.treatment_profile_id, 'ink-doodle-knowledge-card');
  assert.equal(candidate.exact_visible_text, '进士｜当官｜平叛｜阳明心学');

  const result = validate(submissionFor(model, [submittedRowFromModel(candidate)]), fixture);
  assert.deepEqual(result.selection_ready_shot_ids, ['S01']);
  assert.deepEqual(result.reopened_shot_ids, []);
});

test('rejects stale forms, unknown or duplicate rows, retired and incompatible routes', () => {
  const model = buildFixtureModel();
  const s01 = model.rows.find((row) => row.shot_id === 'S01');
  const base = submittedRowFromModel(s01);
  const stale = submissionFor(model, [base]);
  stale.presented_map_sha256 = '0'.repeat(64);
  assert.throws(() => validate(stale), /stale presented map/);

  const staleStoryboard = submissionFor(model, [base]);
  staleStoryboard.storyboard_checksum_sha256 = '0'.repeat(64);
  assert.throws(() => validate(staleStoryboard), /stale storyboard checksum/);

  const unknown = submissionFor(model, [{...base, shot_id: 'S99'}]);
  assert.throws(() => validate(unknown), /unknown shots/);

  const duplicate = submissionFor(model, [base, {...base}]);
  assert.throws(() => validate(duplicate), /duplicate shots/);

  const retired = submissionFor(model, [{...base, visual_generation_route: 'comic-imagegen'}]);
  assert.throws(() => validate(retired), /unknown or retired/);

  const incompatible = submissionFor(model, [{...base, visual_generation_route: 'imagegen'}]);
  assert.throws(() => validate(incompatible), /incompatible/);
});

test('rejects incomplete full submissions, OPEN-00 edits, and unknown fields', () => {
  const model = buildFixtureModel();
  const s01 = model.rows.find((row) => row.shot_id === 'S01');
  assert.throws(() => validate(submissionFor(model, [submittedRowFromModel(s01)], 'all')), /must contain every/);
  const opening = submittedRowFromModel({...s01, shot_id: 'OPEN-00'});
  assert.throws(() => validate(submissionFor(model, [opening])), /OPEN-00/);
  const tampered = submissionFor(model, [{...submittedRowFromModel(s01), treatment_profile_id: 'tampered'}]);
  assert.throws(() => validate(tampered), /missing or unknown fields/);
});

test('preserves approved evidence outside a partial submission', () => {
  const fixture = readFixture();
  const approvedRow = fixture.review.rows.find((row) => row.shot_id === 'S02');
  approvedRow.user_selection = {
    status: 'approved',
    white_cat_present: false,
    visual_structure_id: approvedRow.visual_language_recommendation.visual_structure_id,
    treatment_profile_id: approvedRow.visual_language_recommendation.treatment_profile_id,
    visual_generation_route: approvedRow.recommended_route,
    comic_plan: null,
    visible_text_mode: approvedRow.visible_text_mode,
    exact_visible_text: approvedRow.exact_visible_text,
    visible_text_placement: approvedRow.visible_text_placement,
    exact_message: 'S02 保持推荐',
    decided_at: '2026-08-17T14:00:00+08:00',
    presented_map_sha256: fixture.review.presented_map_sha256,
  };
  const model = buildVisualDirectionFormModel({
    ...fixture,
    episodeWorkspace: EPISODE_WORKSPACE,
  });
  const s01 = model.rows.find((row) => row.shot_id === 'S01');
  const result = validate(submissionFor(model, [submittedRowFromModel(s01)]), fixture);
  assert.deepEqual(result.preserved_approved_shot_ids, ['S02']);
});

test('renders every fixture row, visible native checks, batch actions, and structured follow-ups', () => {
  const html = renderVisualDirectionReviewForm(buildFixtureModel());
  assert.equal((html.match(/data-shot-id=/g) ?? []).length, 21);
  assert.equal((html.match(/<th scope="col">/g) ?? []).length, 7);
  assert.match(html, /data-shot-id="OPEN-00" data-read-only="true"/);
  assert.match(html, /id="select-all"/);
  assert.match(html, /id="apply-bulk"/);
  assert.match(html, /id="submit-selected"/);
  assert.match(html, /id="submit-all"/);
  assert.match(html, /id="merge-selected"/);
  assert.match(html, /sendFollowUpMessage/);
  assert.match(html, /visual-direction-form-submission-v3/);
  assert.match(html, /storyboard-shot-merge-request-v1/);
  assert.match(html, /compact_after_merge/);
  assert.match(html, /视觉继承：仅沿用首镜/);
  assert.match(html, /其余被合并镜头只并入原文与时间/);
  assert.match(html, /dirtyShotIds/);
  assert.match(html, /请先提交字段修改/);
  assert.match(html, /selectAll\.indeterminate/);
  const firstEditableMarkup = html.match(/<tr data-shot-id="S01"[\s\S]*?<\/tr>/)?.[0] ?? '';
  assert.match(firstEditableMarkup, /<div class="form-check[^\"]*">[\s\S]*?class="form-check-input vdr-row-select"/);
  assert.match(firstEditableMarkup, /class="form-check-label font-monospace"/);
  assert.match(firstEditableMarkup, /class="form-control form-control-sm vdr-visual-description"/);
  const openingMarkup = html.match(/<tr class="bg-secondary-subtle"[\s\S]*?<\/tr>/)?.[0] ?? '';
  assert.doesNotMatch(openingMarkup, /<input|<select|<textarea/);
});

test('builds compact renumber maps for middle, head, tail, and multi-shot merges', () => {
  const ids = ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08'];
  const middle = buildCompactShotMergePlan(ids, ['S05', 'S06']);
  assert.deepEqual(middle.active_shot_ids_after_merge, ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07']);
  assert.deepEqual(middle.renumber_map.slice(4), [
    {old_shot_id: 'S05', new_shot_id: 'S05', disposition: 'merged_survivor'},
    {old_shot_id: 'S06', new_shot_id: 'S05', disposition: 'merged_into'},
    {old_shot_id: 'S07', new_shot_id: 'S06', disposition: 'renumbered'},
    {old_shot_id: 'S08', new_shot_id: 'S07', disposition: 'renumbered'},
  ]);
  assert.deepEqual(middle.removed_internal_transition_boundaries, [
    {source_shot_id: 'S05', next_shot_id: 'S06'},
  ]);
  assert.deepEqual(middle.reopened_transition_boundaries[0], {
    source_shot_id: 'S04', next_shot_id: 'S05',
  });

  assert.deepEqual(
    buildCompactShotMergePlan(ids, ['S01', 'S02']).active_shot_ids_after_merge,
    ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07'],
  );
  assert.deepEqual(
    buildCompactShotMergePlan(ids, ['S07', 'S08']).active_shot_ids_after_merge,
    ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07'],
  );
  assert.deepEqual(
    buildCompactShotMergePlan(ids, ['S03', 'S04', 'S05']).active_shot_ids_after_merge,
    ['S01', 'S02', 'S03', 'S04', 'S05', 'S06'],
  );
});

test('preserves canonical uppercase padded shot IDs when compacting', () => {
  const ids = ['S001', 'S002', 'S003', 'S004'];
  const plan = buildCompactShotMergePlan(ids, ['S002', 'S003']);
  assert.deepEqual(plan.active_shot_ids_after_merge, ['S001', 'S002', 'S003']);
  assert.deepEqual(plan.renumber_map.at(-1), {
    old_shot_id: 'S004', new_shot_id: 'S003', disposition: 'renumbered',
  });
});

test('validates a checksum-bound contiguous merge request and returns the rebuild plan', () => {
  const model = buildFixtureModel();
  const result = validateMerge(mergeRequestFor(model, ['S05', 'S06']));
  assert.equal(result.result, 'pass');
  assert.equal(result.surviving_shot_id, 'S05');
  assert.equal(result.resulting_active_row_count, model.row_count - 1);
  assert.deepEqual(result.renumbered_downstream_shot_ids.slice(0, 2), ['S07', 'S08']);
  assert.equal(result.requires_semantic_rebuild_before_mutation, false);
  assert.equal(result.requires_survivor_visual_contract_validation_before_mutation, true);
  assert.equal(result.merged_visual_contract_policy, 'first-shot-visual-inheritance-v1');
  assert.equal(result.merged_visual_contract_source_shot_id, 'S05');
  assert.deepEqual(result.ignored_member_visual_contract_shot_ids, ['S06']);
  assert.equal(
    result.merged_action_state_policy,
    'play-first-shot-action-family-once-then-hold-final-state',
  );
  assert.equal(result.requires_represented_map_refresh, true);
});

test('binds first-shot visual inheritance evidence into the presented map', () => {
  const fixture = readFixture();
  const before = buildPresentedMapSha256(fixture.review);
  fixture.review.rows[0].merge_visual_inheritance = {
    policy: 'first-shot-visual-inheritance-v1',
    source_shot_id: 'S01',
    ignored_visual_contract_shot_ids: ['S02'],
    original_action_window: {start_frame: 88, end_frame: 416},
    final_state_hold: {start_frame: 416, end_frame: 602, duration_in_frames: 186},
  };
  assert.notEqual(buildPresentedMapSha256(fixture.review), before);
});

test('rejects invalid, stale, wrong-phase, and revoice merge requests', () => {
  const model = buildFixtureModel();
  assert.throws(() => validateMerge(mergeRequestFor(model, ['S05'])), /at least two/);
  assert.throws(() => validateMerge(mergeRequestFor(model, ['S05', 'S07'])), /contiguous/);
  assert.throws(() => validateMerge(mergeRequestFor(model, ['S05', 'S05'])), /duplicate/);
  assert.throws(() => validateMerge(mergeRequestFor(model, ['OPEN-00', 'S01'])), /OPEN-00/);
  assert.throws(() => validateMerge(mergeRequestFor(model, ['S05', 'S99'])), /unknown/);

  const stale = mergeRequestFor(model, ['S05', 'S06']);
  stale.presented_map_sha256 = '0'.repeat(64);
  assert.throws(() => validateMerge(stale), /stale presented map/);

  const fixture = readFixture();
  const base = mergeRequestFor(model, ['S05', 'S06']);
  assert.throws(() => validateStoryboardShotMergeRequest({
    ...fixture,
    request: base,
    episodeWorkspace: EPISODE_WORKSPACE,
    episodeState: {workspace_path: EPISODE_WORKSPACE, current_phase: 'awaiting_transition_review'},
  }), /awaiting_visual_direction_review/);
  assert.throws(() => validateStoryboardShotMergeRequest({
    ...fixture,
    request: base,
    episodeWorkspace: EPISODE_WORKSPACE,
    episodeState: {
      workspace_path: EPISODE_WORKSPACE,
      current_phase: 'awaiting_visual_direction_review',
      resume_mode: 'revoice_variant',
    },
  }), /revoice_variant/);
});

test('final Summary, detailed projection, and approved review must match field by field', () => {
  const fixture = readFixture();
  fixture.review.status = 'approved';
  const detailedRows = fixture.review.rows.map((row) => {
    row.user_selection = {
      status: 'approved',
      white_cat_present: row.white_cat_recommendation.recommended,
      visual_structure_id: row.visual_language_recommendation.visual_structure_id,
      treatment_profile_id: row.visual_language_recommendation.treatment_profile_id,
      visual_generation_route: row.recommended_route,
      comic_plan: null,
      visible_text_mode: row.visible_text_mode,
      exact_visible_text: row.exact_visible_text,
      visible_text_placement: row.visible_text_placement,
      exact_message: `${row.shot_id} 确认推荐`,
      decided_at: '2026-08-17T14:00:00+08:00',
      presented_map_sha256: fixture.review.presented_map_sha256,
    };
    return {
      shot_id: row.shot_id,
      visual_description: new Map(
        parseStoryboardSummary(fixture.storyboardMarkdown).map((summary) => [summary.shot_id, summary]),
      ).get(row.shot_id).visual_description,
      white_cat_present: row.user_selection.white_cat_present,
      visual_structure_id: row.user_selection.visual_structure_id,
      treatment_profile_id: row.user_selection.treatment_profile_id,
      visual_generation_route: row.user_selection.visual_generation_route,
      visible_text_mode: row.user_selection.visible_text_mode,
      exact_visible_text: row.user_selection.exact_visible_text,
      visible_text_placement: row.user_selection.visible_text_placement,
    };
  });
  const pass = validateApprovedDirectionSynchronization({...fixture, detailedRows});
  assert.equal(pass.synchronized_shot_count, 20);
  const tampered = structuredClone(detailedRows);
  tampered[1].treatment_profile_id = 'tampered';
  assert.throws(
    () => validateApprovedDirectionSynchronization({...fixture, detailedRows: tampered}),
    /treatment_profile_id mismatch/,
  );
});

test('episode CLI loader follows the state-bound visual-direction phase gate', () => {
  const episodeState = JSON.parse(fs.readFileSync(
    path.join(ROOT, EPISODE_WORKSPACE, 'schema/episode-state.json'),
    'utf8',
  ));
  if (episodeState.current_phase !== 'awaiting_visual_direction_review') {
    assert.throws(
      () => loadEpisodeFormModel(EPISODE_WORKSPACE),
      /episode is not at awaiting_visual_direction_review/,
    );
    return;
  }
  const model = loadEpisodeFormModel(EPISODE_WORKSPACE);
  const s02 = model.rows.find((row) => row.shot_id === 'S02');
  const submission = submissionFor(model, [submittedRowFromModel(s02)]);
  const temporaryDirectory = fs.mkdtempSync('/tmp/visual-direction-form-test-');
  const submissionPath = path.join(temporaryDirectory, 'submission.json');
  fs.writeFileSync(submissionPath, `${JSON.stringify(submission, null, 2)}\n`);
  try {
    const result = validateEpisodeSubmissionFile({
      episodeWorkspace: EPISODE_WORKSPACE,
      submissionPath,
    });
    assert.equal(result.result, 'pass');
    assert.deepEqual(result.selection_ready_shot_ids, ['S02']);
  } finally {
    fs.rmSync(temporaryDirectory, {recursive: true});
  }
});

test('episode merge CLI loader follows the state-bound visual-direction phase gate', () => {
  const episodeState = JSON.parse(fs.readFileSync(
    path.join(ROOT, EPISODE_WORKSPACE, 'schema/episode-state.json'),
    'utf8',
  ));
  if (episodeState.current_phase !== 'awaiting_visual_direction_review') {
    assert.throws(
      () => loadEpisodeFormModel(EPISODE_WORKSPACE),
      /episode is not at awaiting_visual_direction_review/,
    );
    return;
  }
  const model = loadEpisodeFormModel(EPISODE_WORKSPACE);
  const request = mergeRequestFor(model, ['S05', 'S06']);
  const authorityPaths = [
    path.join(ROOT, EPISODE_WORKSPACE, 'schema/episode-state.json'),
    reviewPath,
    storyboardPath,
  ];
  const before = authorityPaths.map((authorityPath) => fs.readFileSync(authorityPath));
  const temporaryDirectory = fs.mkdtempSync('/tmp/storyboard-shot-merge-test-');
  const requestPath = path.join(temporaryDirectory, 'request.json');
  fs.writeFileSync(requestPath, `${JSON.stringify(request, null, 2)}\n`);
  try {
    const result = validateEpisodeMergeRequestFile({
      episodeWorkspace: EPISODE_WORKSPACE,
      requestPath,
    });
    assert.equal(result.result, 'pass');
    assert.equal(result.surviving_shot_id, 'S05');
    authorityPaths.forEach((authorityPath, index) => {
      assert.deepEqual(fs.readFileSync(authorityPath), before[index]);
    });
  } finally {
    fs.rmSync(temporaryDirectory, {recursive: true});
  }
});
