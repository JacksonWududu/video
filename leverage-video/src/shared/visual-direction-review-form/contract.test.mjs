import crypto from 'node:crypto';
import {buildStaticSpread} from '../storyboard/static-spread.mjs';
import {CATALOG, CATALOG_CHECKSUM_SHA256, buildPresentedMapSha256} from '../visual-generation-routes/contract.mjs';
import {VISUAL_LANGUAGE_CATALOG, VISUAL_LANGUAGE_CATALOG_CHECKSUM_SHA256} from '../visual-language/contract.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  buildVisualDirectionFormModel,
  validateVisualDirectionFormSubmission,
  compatibleRoutesForSelection,
  resolveTreatmentProfile,
} from './contract.mjs';

test('Gate-2 style binding forces the selected white-cat ImageGen treatment and route', () => {
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

test('shared form contract has no concrete episode-workspace read', () => {
  const source = fs.readFileSync(new URL('./contract.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /leverage-video\/src\/topic\d+|topic-round-/);
});

test('flipbook form presents direct-first single spread with locked cat and exact body', () => {
  const sourceText = '这一段原文完整保留，图中短标签可以为空。';
  const storyboardMarkdown = '## 分镜 Summary\n\n| 镜头 | 时长（秒） | 画面 | 白猫 | 分镜生成方式 | 可见文字 | 锁稿原文 |\n| --- | --- | --- | --- | --- | --- | --- |\n| S01 | 3.000 | 一幅完整叙事插画 | false | imagegen | 无 | ' + sourceText + ' |\n';
  const item = {
    shot_id: 'S01', scene_class: 'narrative_illustration', structured_visual_kind: null,
    presentation_mode: 'illustrated-flipbook', static_spread: buildStaticSpread(sourceText),
    white_cat_recommendation: {recommended: false, rationale: '图文翻书正文禁止白猫。'},
    white_cat_visual_style_id: 'illustrated-flipbook',
    white_cat_visual_style_selection_sha256: 'a'.repeat(64),
    visual_cohesion_profile_id: 'illustrated-flipbook-cohesion-v1',
    recommended_route: 'imagegen',
    visual_language_recommendation: {visual_structure_id: 'single-scene', treatment_profile_id: 'imagegen-watercolor-narrative'},
    visible_text_mode: 'none', exact_visible_text: null, visible_text_placement: null,
    local_video_source_path: null,
  };
  const review = {
    contract_version: 'per-shot-visual-direction-review-v3', status: 'awaiting_user_selection',
    presentation_mode: 'illustrated-flipbook', white_cat_visual_style_binding: {style_id: 'illustrated-flipbook'},
    catalog_version: CATALOG.schema_version, catalog_checksum_sha256: CATALOG_CHECKSUM_SHA256,
    visual_language_catalog_version: VISUAL_LANGUAGE_CATALOG.schema_version,
    visual_language_catalog_checksum_sha256: VISUAL_LANGUAGE_CATALOG_CHECKSUM_SHA256,
    storyboard: {path: 'synthetic/flipbook/storyboard.md', checksum_sha256: crypto.createHash('sha256').update(storyboardMarkdown).digest('hex')},
    generated_shot_count: 1, rows: [item],
  };
  review.presented_map_sha256 = buildPresentedMapSha256(review);
  const model = buildVisualDirectionFormModel({review, storyboardMarkdown, episodeWorkspace: 'synthetic/flipbook'});
  assert.equal(model.row_count, 1);
  assert.equal(model.rows[0].white_cat_locked, true);
  assert.deepEqual(model.rows[0].route_options_by_white_cat.true, []);
  assert.equal(model.rows[0].route_options_by_white_cat.false.length, 2);
  assert.equal(model.rows[0].static_spread.source_text, sourceText);
  const submission = {
    contract_version: 'visual-direction-form-submission-v3', episode_workspace: 'synthetic/flipbook',
    presented_map_sha256: review.presented_map_sha256, storyboard_checksum_sha256: review.storyboard.checksum_sha256,
    submission_scope: {mode: 'all', shot_ids: ['S01']},
    rows: [{shot_id: 'S01', visual_description: '一幅完整叙事插画', white_cat_present: false,
      visual_generation_route: 'ian-handdrawn-ppt', visible_text_mode: 'none', exact_visible_text: null,
      visible_text_placement: null, local_video_source_path: null}],
  };
  const validated = validateVisualDirectionFormSubmission({review, submission, storyboardMarkdown, episodeWorkspace: 'synthetic/flipbook'});
  assert.equal(validated.normalized_rows[0].treatment_profile_id, 'ian-handdrawn-technical');
  assert.deepEqual(validated.normalized_rows[0].static_spread, item.static_spread);
  submission.rows[0].white_cat_present = true;
  assert.throws(() => validateVisualDirectionFormSubmission({review, submission, storyboardMarkdown, episodeWorkspace: 'synthetic/flipbook'}), /incompatible/);
});
