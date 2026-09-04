import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {resolveFlipbookDeliveryRoles, validateFlipbookCurrentAuthorityBindings, validateFlipbookNarrationCoverage,
  validateFlipbookOpeningCoverBinding, validateFlipbookPresentationPlan, verifyFlipbookProduction} from './flipbook-gates.mjs';
import {buildPublishingCoverPackageSha256} from '../publishing-cover/contract.mjs';

const fixture = () => {
  const bodies = ['第一句。', '第二句。'];
  const gaps = ['\r\n  ', '\n'];
  let cursor = 0;
  const shots = bodies.map((source_text, index) => {
    const row = {shot_id: `S0${index + 1}`, source_text,
      locked_utf8_byte_start: cursor,
      locked_utf8_spoken_end_exclusive: cursor + Buffer.byteLength(source_text),
      inter_shot_gap_text: gaps[index]};
    cursor += Buffer.byteLength(source_text + gaps[index]);
    return row;
  });
  return {spreads: shots.map(row => ({shot_id: row.shot_id, static_spread: {source_text: row.source_text}})),
    timingAuthority: {contract_version: 'storyboard-shot-timing-v1', shots},
    lockedBytes: Buffer.from(shots.map(row => row.source_text + row.inter_shot_gap_text).join(''))};
};

test('flipbook narration preserves checksum-bound timing gaps and accepts the existing rows alias', () => {
  const input = fixture();
  assert.doesNotThrow(() => validateFlipbookNarrationCoverage(input));
  input.timingAuthority.rows = input.timingAuthority.shots;
  delete input.timingAuthority.shots;
  assert.doesNotThrow(() => validateFlipbookNarrationCoverage(input));
});

test('flipbook narration rejects stale byte offsets, omitted gaps, changed bodies and extra locked words', () => {
  const mutations = [
    input => { input.timingAuthority.shots[1].locked_utf8_byte_start -= 1; },
    input => { input.timingAuthority.shots[0].inter_shot_gap_text = ''; },
    input => { input.spreads[1].static_spread.source_text = '篡改文案。'; },
    input => { input.lockedBytes = Buffer.concat([input.lockedBytes, Buffer.from('遗失正文')]); },
    input => { input.timingAuthority.shots.reverse(); },
  ];
  for (const mutate of mutations) {
    const input = fixture();
    mutate(input);
    assert.throws(() => validateFlipbookNarrationCoverage(input), /timing narration-byte|cover the locked narration/);
  }
});

test('production gate refuses a prior approved state snapshot even if the current state is different', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flipbook-gate-state-'));
  try {
    const workspace = 'leverage-video/src/topic99999';
    fs.mkdirSync(path.join(root, workspace, 'schema'), {recursive: true});
    fs.writeFileSync(path.join(root, workspace, 'schema/episode-state.json'), JSON.stringify({current_phase: 'storyboard_construction'}));
    fs.writeFileSync(path.join(root, workspace, 'schema/prior-approved.json'), JSON.stringify({current_phase: 'visual_assets_locked'}));
    const manifest = {production_authority: {episode_workspace: workspace,
      episode_state: {path: `${workspace}/schema/prior-approved.json`, checksum_sha256: 'a'.repeat(64)}}};
    assert.throws(() => verifyFlipbookProduction({manifest, repositoryRoot: root}), /current episode-state.json/);
  } finally {
    fs.rmSync(root, {recursive: true});
  }
});

const authorityFixture = () => {
  const workspace = 'leverage-video/src/topic99999';
  const binding = (name, category = 'schema') => ({path: `${workspace}/${category}/${name}`, checksum_sha256: 'a'.repeat(64)});
  const approved = name => ({...binding(name), status: 'approved', presented_map_sha256: 'b'.repeat(64)});
  const storyboard = {...binding('storyboard-v2.md', 'assets/narration'), status: 'approved'};
  const audio = binding('narration-v1.wav', 'assets/audio');
  const image = binding('S01.png', 'assets/image');
  const staticSpread = {contract_version: 'knowledge-video-static-spread-v1', source_text: '测试。', source_text_sha256: 'c'.repeat(64)};
  const state = {
    workflow_approval_mode: {approval_mode: 'manual'},
    visual_direction_review: approved('direction-v3.json'),
    storyboard_visual_rhythm: approved('rhythm-v2.json'),
    transition_review: approved('transition-v1.json'),
    active_storyboard: storyboard,
    storyboard_review: {status: 'approved', approved_path: storyboard.path, approved_checksum_sha256: storyboard.checksum_sha256,
      presented_path: storyboard.path, presented_checksum_sha256: storyboard.checksum_sha256,
      exact_decision_message: '确认这个分镜版本。', decided_at: '2026-09-04T10:00:00Z'},
    active_visual_manifest: {...binding('visual-manifest-v1.json'), status: 'active_locked',
      input_storyboard_path: storyboard.path, input_storyboard_checksum_sha256: storyboard.checksum_sha256,
      narration_master_checksum_sha256: audio.checksum_sha256},
    narration_audio: {status: 'validated_master', archive_path: audio.path, checksum_sha256: audio.checksum_sha256, duration_seconds: 4},
    visual_asset_review: {queue: [{asset_id: 'S01-main', shot_id: 'S01', status: 'approved',
      presentation_mode: 'illustrated-flipbook', white_cat_present: false, visual_generation_route: 'imagegen',
      ...image, approved_checksum_sha256: image.checksum_sha256, static_spread: staticSpread}]},
  };
  const input = {visualDirectionReview: {...state.visual_direction_review, storyboard},
    storyboardVisualRhythm: {...state.storyboard_visual_rhythm}, transitionSelectionReview: {...state.transition_review},
    visualManifest: {...state.active_visual_manifest}, narrationMaster: audio,
    narrationAsset: audio.path.slice('leverage-video/src/'.length), narrationFrames: 120,
    shots: [{shot_id: 'S01', assets: [{asset_id: 'S01-main'}]}]};
  const manifest = {narration: audio, spreads: [{shot_id: 'S01', visual_generation_route: 'imagegen',
    image, static_spread: staticSpread}]};
  return structuredClone({state, input, manifest});
};

test('production input consumes the current approved storyboard, maps, audio and exact queue bytes', () => {
  assert.doesNotThrow(() => validateFlipbookCurrentAuthorityBindings(authorityFixture()));
  const input = authorityFixture();
  const draft = {path: 'leverage-video/src/topic99999/assets/narration/storyboard-draft-v1.md', checksum_sha256: 'd'.repeat(64)};
  input.state.active_storyboard.source_draft_path = draft.path;
  input.state.active_storyboard.source_draft_checksum_sha256 = draft.checksum_sha256;
  input.input.visualDirectionReview.storyboard = draft;
  assert.doesNotThrow(() => validateFlipbookCurrentAuthorityBindings(input));
  input.input.visualDirectionReview.storyboard = {...draft, path: 'leverage-video/src/topic99999/assets/narration/older-draft.md'};
  assert.throws(() => validateFlipbookCurrentAuthorityBindings(input), /current storyboard/);
});

test('production refuses stale approvals, paths, maps, audio, historical assets and unapproved replacements', () => {
  const changes = [
    data => { data.input.visualDirectionReview.path = 'old-direction.json'; },
    data => { data.input.storyboardVisualRhythm.checksum_sha256 = 'd'.repeat(64); },
    data => { data.state.transition_review.status = 'pending'; },
    data => { data.input.transitionSelectionReview.presented_map_sha256 = 'd'.repeat(64); },
    data => { data.state.storyboard_review.approved_checksum_sha256 = 'd'.repeat(64); },
    data => { data.state.storyboard_review.presented_path = 'old-storyboard.md'; },
    data => { data.state.active_storyboard.status = 'pending'; },
    data => { data.state.storyboard_review.exact_decision_message = ''; },
    data => { data.state.active_visual_manifest.status = 'superseded'; },
    data => { data.state.active_visual_manifest.narration_master_checksum_sha256 = 'd'.repeat(64); },
    data => { data.state.narration_audio.status = 'generated_pending_audio_validation'; },
    data => { data.state.narration_audio.archive_path = 'old-audio.wav'; },
    data => { data.input.narrationFrames -= 1; },
    data => { data.input.narrationMaster.checksum_sha256 = 'd'.repeat(64); },
    data => { data.state.visual_asset_review.queue[0].active_for_current_storyboard = false; },
    data => { data.state.visual_asset_review.queue[0].approved_checksum_sha256 = 'd'.repeat(64); },
    data => { data.input.shots[0].assets[0].asset_id = 'S01-replacement'; },
    data => { data.state.visual_asset_review.queue.push(structuredClone(data.state.visual_asset_review.queue[0])); },
  ];
  for (const change of changes) {
    const data = authorityFixture();
    change(data);
    assert.throws(() => validateFlipbookCurrentAuthorityBindings(data), /flipbook gate:/);
  }
});

test('current caption choice role lists preserve both existing locations and reject conflicting evidence', () => {
  const roles = {required_delivery_roles: ['caption_free_master'], required_internal_qa_roles: ['caption_free_first_shot_prefix']};
  assert.deepEqual(resolveFlipbookDeliveryRoles({caption_delivery: roles}), roles);
  assert.deepEqual(resolveFlipbookDeliveryRoles(roles), roles);
  assert.deepEqual(resolveFlipbookDeliveryRoles({...roles, caption_delivery: roles}), roles);
  assert.throws(() => resolveFlipbookDeliveryRoles({...roles,
    caption_delivery: {...roles, required_delivery_roles: ['captioned_master']}}), /conflicting current bindings/);
});

const coverFixture = () => {
  const checksum = 'a'.repeat(64);
  const asset = (role, width, height) => ({role, path: `leverage-video/src/topic99999/assets/image/${role}.png`,
    checksum_sha256: checksum, prompt_checksum_sha256: checksum, width, height, qa_status: 'qa_accepted_by_codex',
    generation_attempt_scope_id: `publishing-cover:${role}`, generation_attempt_count: 1,
    rejected_outputs: [], automatic_retry_status: 'accepted', white_cat_layout: {mode: 'narrative_adaptive'},
    qa: {narration_consistency: 'pass', white_cat_identity: 'pass', text_accuracy: 'pass', cover_effectiveness: 'pass',
      style_transferability: 'pass', extra_text_count: 0, character_checks: [{index: 1, expected: '知', observed: '知', result: 'pass'}]}});
  const publishingCover = {contract_version: 'publishing-cover-generation-v1', episode_id: 'fixture',
    gate1_topic_sha256: checksum, gate2_script_sha256: checksum, exact_theme_words: '知识', title_source: 'gate1_exact_topic',
    white_cat_reference: {path: '/canonical/white-cat.png', checksum_sha256: checksum},
    generation_policy: {contract_version: 'publishing-cover-generation-policy-v2', style_mode: 'open_unconstrained',
      style_reference_count: 0, independent_aspect_compositions: true, maximum_automatic_rounds: 3,
      white_cat_mode: 'narrative_adaptive', white_cat_mode_selection: {status: 'selected', value: 'narrative_adaptive',
        exact_message: '选择叙事白猫', decided_at: '2026-09-04T10:00:00Z'}},
    generation_rounds_used: 1, delegated_review: {authority: 'user_delegated_cover_qa', status: 'qa_accepted_by_codex',
      user_approval_claimed: false, exact_authorization_message: '生成后代我确认'},
    assets: {landscape_16_9: asset('landscape_16_9', 1920, 1080), portrait_9_16: asset('portrait_9_16', 1080, 1920),
      landscape_4_3: asset('landscape_4_3', 1600, 1200)}};
  publishingCover.package_sha256 = buildPublishingCoverPackageSha256(publishingCover);
  const image = publishingCover.assets.landscape_16_9;
  return {publishingCover, lockedScriptSha256: checksum, openingCover: {hold_frames: 24, open_frames: 30,
    image: {path: image.path, checksum_sha256: image.checksum_sha256, width: image.width, height: image.height}}};
};

test('opening adapter binds the current Gate-2 cover package and rejects replacement bytes or timing', () => {
  assert.equal(validateFlipbookOpeningCoverBinding({openingCover: null}), 0);
  assert.equal(validateFlipbookOpeningCoverBinding(coverFixture()), 54);
  for (const mutate of [value => {value.openingCover.image.checksum_sha256 = 'b'.repeat(64);},
    value => {value.openingCover.image.width = 1536;}, value => {value.openingCover.open_frames = 15;},
    value => {value.lockedScriptSha256 = 'b'.repeat(64);}, value => {value.publishingCover.assets.landscape_16_9.qa.text_accuracy = 'reject';}]) {
    const input = coverFixture(); mutate(input);
    assert.throws(() => validateFlipbookOpeningCoverBinding(input));
  }
});

test('cover adapter shifts only presentation frames while preserving the locked body plan', () => {
  const scene = (shotId, start, duration, transition) => ({shot_id: shotId, start_frame: start, duration_frames: duration,
    scene_class: 'narrative', visual_generation_route: 'imagegen', white_cat_present: false,
    static_spread: {source_text: shotId}, text_reveals: [{id: 'R1', start_frame: start, end_frame: start + 6}],
    image_sequence: [{asset: `topic99999/assets/image/${shotId}.png`, checksum_sha256: 'a'.repeat(64)}], transition});
  const plan = {render_backend: 'codex-browser-flipbook', full_master_frames: 645,
    narration_asset: 'topic99999/assets/audio/narration.wav',
    scenes: [scene('S01', 0, 300, {kind: 'book-page-turn', duration_in_frames: 15}), scene('S02', 300, 345, null)]};
  const before = structuredClone(plan);
  const manifestFor = openingFrames => ({total_frames: 645 + openingFrames,
    narration: {path: `leverage-video/src/${plan.narration_asset}`}, spreads: plan.scenes.map(row => ({
      shot_id: row.shot_id, start_frame: row.start_frame + openingFrames, duration_frames: row.duration_frames,
      scene_class: row.scene_class, visual_generation_route: row.visual_generation_route, static_spread: row.static_spread,
      text_reveals: row.text_reveals.map(reveal => ({...reveal, start_frame: reveal.start_frame + openingFrames,
        end_frame: reveal.end_frame + openingFrames})),
      image: {path: `leverage-video/src/${row.image_sequence[0].asset}`, checksum_sha256: row.image_sequence[0].checksum_sha256},
      transition_out: row.transition && {...row.transition, start_frame: row.start_frame + row.duration_frames - 15 + openingFrames}}))});
  assert.doesNotThrow(() => validateFlipbookPresentationPlan({plan, manifest: manifestFor(0)}));
  const manifest = manifestFor(54);
  assert.doesNotThrow(() => validateFlipbookPresentationPlan({plan, manifest, openingFrames: 54}));
  assert.equal(manifest.total_frames, 699);
  assert.equal(manifest.spreads[0].start_frame, 54);
  assert.deepEqual(plan, before);
  for (const mutate of [value => {value.spreads[0].start_frame = 0;},
    value => {value.spreads[0].text_reveals[0].start_frame -= 54;},
    value => {value.spreads[0].transition_out.start_frame -= 1;}, value => {value.total_frames -= 1;}]) {
    const changed = structuredClone(manifest); mutate(changed);
    assert.throws(() => validateFlipbookPresentationPlan({plan, manifest: changed, openingFrames: 54}), /flipbook gate:/);
  }
});
