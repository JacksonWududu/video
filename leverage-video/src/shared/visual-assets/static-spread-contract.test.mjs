import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import sharp from 'sharp';
import {buildFlipbookStyleSelection} from '../workflow-approval/contract.mjs';
import {FLIPBOOK_PROFILE_BYTES} from '../flipbook-video/profile.mjs';
import {buildStaticSpread} from '../storyboard/static-spread.mjs';
import {buildPendingVisibleTextBatchReview, approveVisibleTextBatchReview, buildVisibleTextBatchMapSha256} from '../visible-text-review/contract.mjs';
import {ACTIVE_ROUTE_IDS, CATALOG_CHECKSUM_SHA256, buildPresentedMapSha256, authorizeVisualDirectionRecommendationsOneClick} from '../visual-generation-routes/contract.mjs';
import {VISUAL_LANGUAGE_CATALOG_CHECKSUM_SHA256} from '../visual-language/contract.mjs';
import {buildStandardItems} from './reconcile-approved-storyboard.mjs';
import {resolveFinalReviewTimelineOpening} from './build-final-production-asset-review.mjs';
import {
  buildScenes,
  parseStoryboardSourceTexts,
  resolveVisualManifestTimelineOpening,
} from './finalize-visual-assets-manifest.mjs';
import {inspectStaticSpreadAsset, buildStaticSpreadReadabilityPreview, STATIC_SPREAD_PROMPT_MARKERS, STATIC_SPREAD_QA_CONTRACT} from './static-spread-contract.mjs';

const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const when = '2026-09-04T12:00:00Z';
const repositoryRoot = path.resolve(import.meta.dirname, '../../../..');
const fixture = async (t, route = 'imagegen') => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'static-spread-test-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const prefix = 'leverage-video/src/topic99999';
  const put = (relative, bytes) => {
    const target = path.join(root, relative); fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, bytes); return {path: relative, checksum_sha256: sha(bytes)};
  };
  const putJson = (relative, value) => put(relative, JSON.stringify(value));
  const profilePath = `${prefix}/schema/flipbook-profile.json`;
  put(profilePath, FLIPBOOK_PROFILE_BYTES);
  const selection = buildFlipbookStyleSelection({gate2ScriptSha256: 'a'.repeat(64), profilePath,
    decision: {status: 'selected', exact_message: '选择图文翻书', decided_at: when}});
  const selectionFile = putJson(`${prefix}/schema/style-selection.json`, selection);
  const spread = buildStaticSpread('这是一段完整锁定口播，保留原来的顺序与标点。');
  const direction = {contract_version: 'per-shot-visual-direction-review-v3',
    catalog_version: 'visual-generation-route-catalog-v2', catalog_checksum_sha256: CATALOG_CHECKSUM_SHA256,
    visual_language_catalog_version: 'visual-language-catalog-v1', visual_language_catalog_checksum_sha256: VISUAL_LANGUAGE_CATALOG_CHECKSUM_SHA256,
    storyboard: {path: `${prefix}/script/storyboard.md`, checksum_sha256: 'b'.repeat(64)},
    presentation_mode: 'illustrated-flipbook', white_cat_visual_style_binding: selection,
    status: 'approved', generated_shot_count: 1, presentation: {presented_at: when, exact_message: '确认完整分镜'}, rows: []};
  const treatment = route === 'imagegen' ? 'imagegen-watercolor-narrative' : 'ian-handdrawn-technical';
  const styleFields = {white_cat_visual_style_id: selection.style_id, white_cat_visual_style_selection_sha256: selection.selection_sha256,
    visual_cohesion_profile_id: selection.visual_cohesion_profile_id};
  const row = {shot_id: 'S01', scene_class: 'narrative_illustration', structured_visual_kind: null,
    presentation_mode: 'illustrated-flipbook', static_spread: spread, ...styleFields,
    factual_identity: {contains_real_or_historical_subject: false, white_cat_replaces_factual_identity: false},
    white_cat_recommendation: {recommended: false, rationale: '正文禁止白猫。'},
    visual_language_recommendation: {visual_structure_id: 'single-scene', treatment_profile_id: treatment},
    comic_eligibility: {eligible: false, recommend_comic_route: false, reasons: ['一张静态图片。']}, comic_plan_candidate: null,
    compatible_routes: ACTIVE_ROUTE_IDS.filter((id) => ['imagegen', 'ian-handdrawn-ppt'].includes(id)),
    incompatible_routes: ACTIVE_ROUTE_IDS.filter((id) => !['imagegen', 'ian-handdrawn-ppt'].includes(id)),
    recommended_route: 'imagegen', recommendation_reason: '叙事使用整图。', visible_text_mode: 'none', exact_visible_text: null,
    visible_text_placement: null, local_video_source_path: null,
    user_selection: {status: 'approved', presentation_mode: 'illustrated-flipbook', static_spread: spread,
      white_cat_present: false, visual_generation_route: route, visual_structure_id: 'single-scene', treatment_profile_id: treatment,
      ...styleFields, visible_text_mode: 'none', exact_visible_text: null, visible_text_placement: null,
      local_video_source_path: null, comic_plan: null, exact_message: '确认 S01', decided_at: when}};
  row.incompatible_route_reasons = Object.fromEntries(row.incompatible_routes.map((id) => [id, '静态分支只使用两条路线。']));
  direction.rows.push(row);
  const syncDirection = () => {
    direction.presented_map_sha256 = buildPresentedMapSha256(direction);
    row.user_selection.presented_map_sha256 = direction.presented_map_sha256;
    const file = putJson(`${prefix}/schema/direction.json`, direction);
    return file;
  };
  const directionFile = syncDirection();
  const sourceBytes = await sharp({create: {width: 1920, height: 1080, channels: 3, background: '#eee8dc'}}).png().toBuffer();
  const output = put(`${prefix}/assets/image/source.png`, sourceBytes);
  const preview = put(`${prefix}/assets/image/review/half-page.png`, await buildStaticSpreadReadabilityPreview(sourceBytes));
  const prompt = put(`${prefix}/assets/image/prompt.txt`, STATIC_SPREAD_PROMPT_MARKERS.join('\n'));
  const references = route === 'ian-handdrawn-ppt' ? [{...put('.agents/skills/ian-handdrawn-ppt/assets/reference-handdrawn-article-illustration-style.png', sourceBytes), role: 'visual_style_reference_only'}] : [];
  const qa = {contract_version: STATIC_SPREAD_QA_CONTRACT, result: 'pass', asset_id: 'S01-static-v01', output, prompt,
    static_spread: spread, white_cat_present: false, actual_reference_inputs: references,
    technical_qa: {result: 'pass'}, semantic_qa: {result: 'pass'}, style_qa: {result: 'pass'}, visual_qa: {result: 'pass'},
    visible_text_qa: {result: 'pass', mode: 'none', exact_text: null},
    half_page_readability: {display_width_px: 708, display_height_px: 398.25, fit: 'contain', text_readable: true,
      no_crop: true, observed_white_cat_present: false, reviewed_source_checksum_sha256: output.checksum_sha256, preview}};
  const qaFile = putJson(`${prefix}/schema/static-qa.json`, qa);
  const item = {...buildStandardItems({shotId: 'S01', row, count: 1})[0], ...row.user_selection,
    asset_id: 'S01-static-v01', shot_id: 'S01', status: 'awaiting_batch_qa',
    scene_class: row.scene_class, presentation_mode: row.presentation_mode, static_spread: spread,
    narration_source_text: spread.source_text, visual_direction_review_path: directionFile.path,
    visual_direction_review_checksum_sha256: directionFile.checksum_sha256, visual_direction_presented_map_sha256: direction.presented_map_sha256,
    path: output.path, checksum_sha256: output.checksum_sha256, measured_dimensions: [1920, 1080],
    prompt_path: prompt.path, prompt_checksum_sha256: prompt.checksum_sha256,
    qa_evidence_path: qaFile.path, qa_evidence_checksum_sha256: qaFile.checksum_sha256,
    qa_contract_version: qa.contract_version, actual_reference_inputs: references};
  for (const field of ['technical_qa', 'semantic_qa', 'style_qa', 'visual_qa', 'visible_text_qa']) item[field] = qa[field];
  const state = {white_cat_visual_style_selection: {...selection, status: 'selected', path: selectionFile.path, file_checksum_sha256: selectionFile.checksum_sha256},
    visual_direction_review: directionFile,
    visual_asset_review: {contract_version: 'visual-asset-review-v2', mode: 'hybrid_batch_v1', batch_size: 4,
      queue_generation_allowed: true, queue: [item], generation_aspect_ratio: [16, 9], generation_aspect_ratio_max_relative_error: 0.005}};
  return {repositoryRoot: root, state, item, row, direction, qa, put, putJson, output, prefix, syncDirection};
};

for (const route of ['imagegen', 'ian-handdrawn-ppt']) test(`${route} accepts one complete static PNG without layers or subtitle band`, async (t) => {
  const f = await fixture(t, route);
  const evidence = await inspectStaticSpreadAsset(f);
  assert.equal(evidence.image_fit, 'contain'); assert.equal(evidence.layered_scene_required, false);
  assert.equal(evidence.subtitle_safe_area_required, false);
  assert.equal(f.item.ian_scene_plan, undefined);
});

test('static branch rejects cat, retired QA, changed text, missing approval and forged style selection', async (t) => {
  const cases = [
    [(f) => {f.item.white_cat_present = true;}, /white cats|white-cat choice mismatch/],
    [(f) => {f.item.qa_contract_version = 'ian-static-full-frame-v1';}, /QA output/],
    [(f) => {f.item.static_spread = {...f.item.static_spread, source_text: '改写。'};}, /narration contract|static spread shot binding/],
    [(f) => {f.state.white_cat_visual_style_selection.style_id = 'cover-derived-episode-style';}, /requires selected/],
    [(f) => {f.direction.status = 'pending'; const file = f.syncDirection(); f.state.visual_direction_review = file; f.item.visual_direction_review_checksum_sha256 = file.checksum_sha256;}, /must be approved/],
  ];
  for (const [mutate, pattern] of cases) {const f = await fixture(t); mutate(f); await assert.rejects(inspectStaticSpreadAsset(f), pattern);}
});

test('current source, prompt, profile, QA and half-page preview bytes are required', async (t) => {
  for (const target of ['source', 'prompt', 'profile', 'qa', 'preview']) {
    const f = await fixture(t);
    const relative = {source: f.item.path, prompt: f.item.prompt_path,
      profile: f.state.white_cat_visual_style_selection.style_profile_path,
      qa: f.item.qa_evidence_path, preview: f.qa.half_page_readability.preview.path}[target];
    fs.appendFileSync(path.join(f.repositoryRoot, relative), 'changed');
    await assert.rejects(inspectStaticSpreadAsset(f), /checksum is stale/);
  }
});

test('no-cat QA and deterministic half-page evidence cannot be replaced with pass flags', async (t) => {
  for (const modify of [(f) => {f.qa.half_page_readability.observed_white_cat_present = true;},
    (f) => {f.qa.half_page_readability.preview = f.output;}]) {
    const f = await fixture(t); modify(f);
    f.item.qa_evidence_checksum_sha256 = f.putJson(f.item.qa_evidence_path, f.qa).checksum_sha256;
    await assert.rejects(inspectStaticSpreadAsset(f), /observation|deterministic contain/);
  }
});

test('existing Python approval gate rechecks static QA before binding user approval', async (t) => {
  const f = await fixture(t);
  f.item.static_spread_review = await inspectStaticSpreadAsset(f);
  f.item.presented_static_spread_review = structuredClone(f.item.static_spread_review);
  f.item.strict_review = true; f.item.status = 'awaiting_user_approval';
  f.item.presented_checksum_sha256 = f.item.checksum_sha256;
  f.item.presented_at = when;
  const payload = {root: f.repositoryRoot, state: f.state, gate: path.join(repositoryRoot, '.agents/skills/run-knowledge-video/scripts/validate_visual_approval_state.py')};
  const program = `import sys,json,importlib.util,pathlib\na=json.load(sys.stdin)\ns=importlib.util.spec_from_file_location('gate',a['gate']);g=importlib.util.module_from_spec(s);s.loader.exec_module(g)\ng.REPOSITORY_ROOT=pathlib.Path(a['root'])\ng.STATIC_SPREAD_VALIDATOR_PATH=pathlib.Path(a['gate']).parents[4]/'leverage-video/src/shared/visual-assets/static-spread-contract.mjs'\ng.record_approval(a['state'],'S01-static-v01','批准','${when}',repository_root=a['root'])\nprint('approved')`;
  const run = () => spawnSync('python3', ['-c', program], {input: JSON.stringify(payload), encoding: 'utf8', env: {...process.env, PYTHONDONTWRITEBYTECODE: '1'}});
  const accepted = run(); assert.equal(accepted.status, 0, accepted.stderr);
  fs.appendFileSync(path.join(f.repositoryRoot, f.item.prompt_path), 'changed');
  const rejected = run(); assert.notEqual(rejected.status, 0); assert.match(rejected.stderr, /prompt checksum is stale/);
});


test('static scenes consume one source and never infer Ian layers or action schedules', async (t) => {
  for (const route of ['imagegen', 'ian-handdrawn-ppt']) {
    const f = await fixture(t, route);
    f.item.shot_start_frame = 0; f.item.shot_end_frame = 90;
    const params = {queue: [f.item], assets: [{asset_id: f.item.asset_id, role: f.item.role, state_index: 0,
      production: {path: f.item.path, checksum_sha256: f.item.checksum_sha256, fit: 'contain'}}],
      directionAuthority: {value: f.direction}, rhythmAuthority: {value: {shots: [{shot_id: 'S01',
        start_frame: 0, end_frame: 90, motion_tier: 'static_spread', intra_shot_transition_plan: []}]}},
      scheduleSet: {schedules: []}, storyboardSourceTexts: new Map([['S01', f.item.narration_source_text]]),
      expectedDirectionStatus: 'approved'};
    const result = buildScenes(params);
    assert.equal(result.scenes[0].image_sequence.length, 1);
    assert.equal(result.scenes[0].ian_layered_scene, null);
    assert.equal(result.scenes[0].action_state_schedule, null);
    assert.deepEqual(result.scenes[0].static_spread, f.row.static_spread);
    f.item.static_spread = buildStaticSpread('改写后的文案。');
    assert.throws(() => buildScenes(params), /static spread queue binding/);
  }
});

test('flipbook alone uses direct-first opening while ordinary stories retain OPEN-00', () => {
  const flipbookState = {
    white_cat_visual_style_selection: {style_id: 'illustrated-flipbook', style_source: 'builtin_flipbook'},
    storyboard_draft: {direct_first_shot_contract: 'direct-first-shot-v1'},
  };
  const flipbookQueue = [{shot_id: 'S01', shot_start_frame: 0, presentation_mode: 'illustrated-flipbook'}];
  assert.deepEqual(resolveFinalReviewTimelineOpening({activeQueue: flipbookQueue, state: flipbookState}), {
    contract_version: 'direct-first-shot-v1', first_shot_id: 'S01', start_frame: 0,
    fixed_opening_cover: false, publishing_cover_included: false,
  });
  assert.deepEqual(resolveVisualManifestTimelineOpening(flipbookState), {
    contract_version: 'direct-first-shot-v1', first_shot_id: 'S01', start_frame: 0,
    fixed_opening_cover: false, publishing_cover_included: false,
  });
  assert.throws(
    () => resolveFinalReviewTimelineOpening({activeQueue: [{...flipbookQueue[0], shot_start_frame: 1}], state: flipbookState}),
    /frame zero/,
  );
  assert.throws(
    () => resolveVisualManifestTimelineOpening({...flipbookState, storyboard_draft: {}}),
    /direct-first-shot-v1/,
  );

  const directStoryboard = '## S01\n- 锁稿原文 source_text：\n```text\n正文\n```\n';
  assert.equal(parseStoryboardSourceTexts(directStoryboard, {flipbookPresentation: true}).get('S01'), '正文');
  assert.throws(() => parseStoryboardSourceTexts(directStoryboard), /lacks OPEN-00/);
  assert.equal(resolveFinalReviewTimelineOpening({activeQueue: [{shot_id: 'OPEN-00'}], state: {}}), null);
  assert.equal(resolveVisualManifestTimelineOpening({}), null);
});


test('static recorder stages a real hybrid batch; QA never supplies user approval', async (t) => {
  const f = await fixture(t, 'ian-handdrawn-ppt');
  f.item.status = 'pending_generation';
  const payload = {root: f.repositoryRoot, state: f.state, qa: f.item.qa_evidence_path,
    recorder: path.join(repositoryRoot, 'leverage-video/src/shared/visual-assets/record-generated-static-spread-qa.py')};
  const program = `import sys,json,importlib.util,pathlib\na=json.load(sys.stdin)\ns=importlib.util.spec_from_file_location('recorder',a['recorder']);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nv=m.record_static_spread_qa(a['state'],'S01-static-v01',a['qa'],'${when}',repository_root=a['root'])\nassert v['visual_asset_review']['queue'][0]['status']=='qa_passed_pending_batch_review'\nassert 'approved_checksum_sha256' not in v['visual_asset_review']['queue'][0]\nassert v['visual_asset_review']['active_batch']['assets'][0]['static_spread_review']['image_fit']=='contain'\ng=m.load_gate();g.REPOSITORY_ROOT=pathlib.Path(a['root'])\ng.record_hybrid_batch_approval(v,None,'批准','${when}',repository_root=a['root'])\nassert v['visual_asset_review']['queue'][0]['status']=='approved'\nprint('approved after explicit decision')`;
  const result = spawnSync('python3', ['-c', program], {input: JSON.stringify(payload), encoding: 'utf8', env: {...process.env, PYTHONDONTWRITEBYTECODE: '1'}});
  assert.equal(result.status, 0, result.stderr);
});

test('one-click exact review map binds static QA and rejects changed prompt bytes', async (t) => {
  const f = await fixture(t);
  const policy = 'e'.repeat(64);
  const direction = authorizeVisualDirectionRecommendationsOneClick(f.direction, {policySha256: policy, authorizedAt: when});
  const file = f.putJson(`${f.prefix}/schema/direction.json`, direction);
  f.state.visual_direction_review = file;
  f.item.visual_direction_review_checksum_sha256 = file.checksum_sha256;
  f.item.status = 'qa_passed_pending_final_review';
  f.state.visual_asset_review = {...f.state.visual_asset_review, mode: 'one_click_final_review_v1',
    contract_version: 'visual-asset-review-v3', policy_sha256: policy, storyboard_sha256: 'b'.repeat(64)};
  f.item.static_spread_review = await inspectStaticSpreadAsset(f);
  const payload = {root: f.repositoryRoot, state: f.state, gate: path.join(repositoryRoot, '.agents/skills/run-knowledge-video/scripts/validate_visual_approval_state.py')};
  const program = `import sys,json,importlib.util,pathlib\na=json.load(sys.stdin)\ns=importlib.util.spec_from_file_location('gate',a['gate']);g=importlib.util.module_from_spec(s);s.loader.exec_module(g);g.REPOSITORY_ROOT=pathlib.Path(a['root'])\nr=g._one_click_final_review_payload(a['state'])\nassert 'static_spread_review' in r['assets'][0]\nassert 'ian_layered_scene_package' not in r['assets'][0]`;
  const run = () => spawnSync('python3', ['-c', program], {input: JSON.stringify(payload), encoding: 'utf8', env: {...process.env, PYTHONDONTWRITEBYTECODE: '1'}});
  const before = run(); assert.equal(before.status, 0, before.stderr);
  fs.appendFileSync(path.join(f.repositoryRoot, f.item.prompt_path), 'changed');
  const after = run(); assert.notEqual(after.status, 0); assert.match(after.stderr, /prompt checksum is stale/);
});


const workspaceFixture = async (t, route = 'imagegen') => {
  const f = await fixture(t, route);
  for (const directory of ['assets/audio', 'assets/image', 'assets/narration', 'assets/video', 'script', 'schema', 'docs']) {
    fs.mkdirSync(path.join(f.repositoryRoot, f.prefix, directory), {recursive: true});
  }
  f.state.current_phase = 'visual_production';
  f.state.visual_direction_review.presented_map_sha256 = f.direction.presented_map_sha256;
  const review = buildPendingVisibleTextBatchReview({episodeWorkspace: f.prefix, storyboard: f.direction.storyboard,
    visualDirectionReviewBinding: f.state.visual_direction_review, visualDirectionReview: f.direction,
    summaryRows: [{shot_id: 'S01', locked_narration: f.item.narration_source_text, visible_text: '无'}],
    presentedAt: when, exactMessage: '请整批审核正文与短标签。'});
  const visible = approveVisibleTextBatchReview(review, {presentedMapSha256: review.presented_map_sha256,
    exactMessage: '批准全部正文与短标签', decidedAt: when});
  const syncVisible = () => {
    visible.presented_map_sha256 = buildVisibleTextBatchMapSha256(visible);
    visible.approval.presented_map_sha256 = visible.presented_map_sha256;
    const binding = f.putJson(`${f.prefix}/schema/visible-text.json`, visible);
    f.state.visible_text_review = {...binding, contract_version: visible.contract_version, status: 'approved',
      approval_scope: 'complete_presented_map', user_has_reviewed_complete_map: true, row_by_row_approval_performed: false,
      presented_map_sha256: visible.presented_map_sha256, exact_decision_message: visible.approval.exact_message,
      decided_at: visible.approval.decided_at};
  };
  syncVisible();
  f.item.static_spread_review = await inspectStaticSpreadAsset(f);
  const validator = path.join(repositoryRoot, '.agents/skills/run-knowledge-video/scripts/validate_episode_workspace.py');
  const run = () => {
    f.putJson(`${f.prefix}/schema/episode-state.json`, f.state);
    const program = `import sys,json,importlib.util,pathlib\ns=importlib.util.spec_from_file_location('workspace_gate',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nerrors=m.validate_episode_workspace(pathlib.Path(sys.argv[2]),pathlib.Path(sys.argv[3]))\nprint(json.dumps(errors,ensure_ascii=False));sys.exit(bool(errors))`;
    return spawnSync('python3', ['-c', program, validator, f.repositoryRoot, f.prefix], {
      encoding: 'utf8', env: {...process.env, PYTHONDONTWRITEBYTECODE: '1'},
    });
  };
  return {...f, visible, syncVisible, run};
};

test('real workspace gate accepts both static routes and correctly classifies page HTML/CSS', async (t) => {
  for (const route of ['ian-handdrawn-ppt', 'imagegen']) {
    const f = await workspaceFixture(t, route);
    f.put(`${f.prefix}/docs/book.html`, '<html></html>');
    f.put(`${f.prefix}/script/book.css`, 'body{}');
    const pass = f.run(); assert.equal(pass.status, 0, pass.stdout + pass.stderr);
    f.put(`${f.prefix}/script/misplaced.html`, '<html></html>');
    const misplaced = f.run(); assert.notEqual(misplaced.status, 0); assert.match(misplaced.stdout, /expected under docs/);
  }
});

test('real workspace gate validates pending static authority without demanding layers or pixels', async (t) => {
  const f = await workspaceFixture(t, 'ian-handdrawn-ppt');
  f.item.status = 'pending_generation';
  fs.unlinkSync(path.join(f.repositoryRoot, f.item.path));
  const pass = f.run(); assert.equal(pass.status, 0, pass.stdout + pass.stderr);
  f.item.white_cat_present = true;
  const cat = f.run(); assert.notEqual(cat.status, 0); assert.match(cat.stdout, /white-cat choice mismatch/);
});

test('real workspace gate rejects current static byte changes and style downgrades', async (t) => {
  for (const mutate of [(f) => fs.appendFileSync(path.join(f.repositoryRoot, f.item.path), 'changed'),
    (f) => {delete f.item.presentation_mode;},
    (f) => {delete f.state.white_cat_visual_style_selection;}]) {
    const f = await workspaceFixture(t); mutate(f);
    const result = f.run(); assert.notEqual(result.status, 0); assert.match(result.stdout, /static spread|flipbook/);
  }
});

test('workspace body approval binds exact text separately from the unchanged concise-label rule', async (t) => {
  const f = await workspaceFixture(t);
  f.visible.rows[0].static_spread = buildStaticSpread('你看，这段正文被换成了另一段，虽然重签哈希仍须拒绝。');
  f.visible.rows[0].source_text_sha256 = f.visible.rows[0].static_spread.source_text_sha256;
  f.syncVisible();
  const body = f.run(); assert.notEqual(body.status, 0); assert.match(body.stdout, /exact flipbook body is stale/);
  const second = await workspaceFixture(t);
  second.visible.rows[0].visible_text_mode = 'required';
  second.visible.rows[0].exact_visible_text = '这是一条超过二十八个字的图中短标签，用来检验新正文合同不能放宽原有简述规则';
  second.visible.rows[0].visible_text_placement = '图中';
  second.visible.rows[0].text_style_qa.result = 'pass';
  second.syncVisible();
  const labels = second.run(); assert.notEqual(labels.status, 0); assert.match(labels.stdout, /28 non-whitespace|28/);
});


test('pre-queue text review rechecks selected style/profile without manufacturing production assets', async (t) => {
  const f = await workspaceFixture(t);
  f.state.visual_asset_review.queue = [];
  const pass = f.run(); assert.equal(pass.status, 0, pass.stdout + pass.stderr);
  fs.appendFileSync(path.join(f.repositoryRoot, f.state.white_cat_visual_style_selection.style_profile_path), 'changed');
  const fail = f.run(); assert.notEqual(fail.status, 0); assert.match(fail.stdout, /style profile checksum is stale/);
});
