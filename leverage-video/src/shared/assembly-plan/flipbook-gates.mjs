import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {buildKnowledgeVideoAssemblyPlan} from './build-assembly-plan.mjs';
import {verifyFileChecksum} from '../episode-tooling/file-integrity.mjs';
import {isFlipbookStyle} from '../flipbook-video/profile.mjs';
import {validatePublishingCoverPackage} from '../publishing-cover/contract.mjs';
import {validateWhiteCatVisualStyleSelection, assertOneClickProtectedActionAllowed} from '../workflow-approval/contract.mjs';

const fail = (text) => {throw new Error(`flipbook gate: ${text}`);};
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const publicPath = (value) => value.startsWith('leverage-video/src/') ? value : `leverage-video/src/${value}`;
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value;
const digest = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

const boundFile = (repositoryRoot, binding, workspace, category) => {
  if (typeof binding?.path !== 'string' || !binding.path.startsWith(`${workspace}/${category}/`)
    || binding.path.split('/').some(part => ['..', '.', ''].includes(part)) || path.isAbsolute(binding.path)) fail(`authority must live in the episode ${category} directory`);
  let current = repositoryRoot;
  for (const part of binding.path.split('/')) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) fail('authority cannot follow symlinks');
  }
  verifyFileChecksum(current, binding.checksum_sha256);
  return current;
};
const boundJson = (repositoryRoot, binding, workspace) =>
  JSON.parse(fs.readFileSync(boundFile(repositoryRoot, binding, workspace, 'schema'), 'utf8'));
const runValidator = (repositoryRoot, args) => {
  const result = spawnSync('python3', args, {cwd: repositoryRoot, encoding: 'utf8'});
  if (result.status !== 0) fail(`required validator failed: ${args[0]}\n${result.stdout}\n${result.stderr}`);
};

// Use the existing storyboard-shot-timing-v1 byte authority, including unspoken gaps.
export const validateFlipbookNarrationCoverage = ({spreads, timingAuthority, lockedBytes}) => {
  const rows = timingAuthority?.shots ?? timingAuthority?.rows;
  if (timingAuthority?.contract_version !== 'storyboard-shot-timing-v1'
    || !Array.isArray(rows) || !Array.isArray(spreads) || rows.length !== spreads.length
    || rows.length === 0 || !Buffer.isBuffer(lockedBytes)) fail('storyboard timing authority is missing or stale');
  let cursor = 0;
  const narration = rows.map((row, index) => {
    const body = spreads[index]?.static_spread?.source_text;
    if (typeof body !== 'string' || row.shot_id !== spreads[index]?.shot_id
      || row.source_text !== body || row.locked_utf8_byte_start !== cursor
      || row.locked_utf8_spoken_end_exclusive !== cursor + Buffer.byteLength(body)
      || typeof row.inter_shot_gap_text !== 'string') fail('timing narration-byte binding differs from spread bodies');
    cursor += Buffer.byteLength(body) + Buffer.byteLength(row.inter_shot_gap_text);
    return body + row.inter_shot_gap_text;
  }).join('');
  if (cursor !== lockedBytes.length || !Buffer.from(narration, 'utf8').equals(lockedBytes)) {
    fail('spread bodies and timing gaps must cover the locked narration exactly');
  }
};

const requireBinding = (actual, expected, label) => {
  if (typeof expected?.path !== 'string' || !/^[a-f0-9]{64}$/.test(expected?.checksum_sha256 ?? '')
    || actual?.path !== expected.path || actual?.checksum_sha256 !== expected.checksum_sha256) fail(`${label} differs from current authority`);
};

export const validateFlipbookCurrentAuthorityBindings = ({state, input, manifest}) => {
  const oneClick = state.workflow_approval_mode?.approval_mode === 'one_click';
  const authorized = oneClick ? 'policy_authorized' : 'approved';
  for (const [inputKey, stateKey] of [['visualDirectionReview', 'visual_direction_review'],
    ['storyboardVisualRhythm', 'storyboard_visual_rhythm'], ['transitionSelectionReview', 'transition_review']]) {
    requireBinding(input[inputKey], state[stateKey], stateKey);
    if (state[stateKey].status !== authorized) fail(`${stateKey} is not currently authorized`);
  }
  for (const [inputKey, stateKey] of [['visualDirectionReview', 'visual_direction_review'],
    ['transitionSelectionReview', 'transition_review']]) {
    if (input[inputKey].presented_map_sha256 !== state[stateKey].presented_map_sha256) fail(`${stateKey} map is stale`);
  }
  const storyboard = state.active_storyboard;
  const review = state.storyboard_review;
  const sourceDraft = {path: storyboard?.source_draft_path, checksum_sha256: storyboard?.source_draft_checksum_sha256};
  const assemblyStoryboard = input.visualDirectionReview.storyboard;
  requireBinding(assemblyStoryboard, assemblyStoryboard?.path === sourceDraft.path ? sourceDraft : storyboard, 'current storyboard');
  requireBinding({path: review?.approved_path, checksum_sha256: review?.approved_checksum_sha256}, storyboard, 'storyboard approval');
  requireBinding({path: review?.presented_path, checksum_sha256: review?.presented_checksum_sha256}, storyboard, 'storyboard presentation');
  if (storyboard.status !== authorized || review.status !== authorized) fail('storyboard is not currently authorized');
  if (oneClick) {
    if (input.workflowApproval?.policy?.policy_sha256 !== state.one_click_approval_policy?.policy_sha256
      || review.policy_sha256 !== state.one_click_approval_policy?.policy_sha256
      || review.user_has_reviewed_specific_storyboard !== false) fail('storyboard policy binding is stale');
  } else if (typeof review.exact_decision_message !== 'string' || !review.exact_decision_message.trim()
    || Number.isNaN(Date.parse(review.decided_at))) fail('storyboard exact approval is missing');
  requireBinding(input.visualManifest, state.active_visual_manifest, 'visual manifest');
  if (state.active_visual_manifest.status !== 'active_locked') fail('visual manifest is not currently locked');
  requireBinding({path: state.active_visual_manifest.input_storyboard_path,
    checksum_sha256: state.active_visual_manifest.input_storyboard_checksum_sha256}, storyboard, 'visual manifest storyboard');

  const audio = state.narration_audio;
  const audioBinding = {path: audio?.archive_path, checksum_sha256: audio?.checksum_sha256};
  requireBinding(manifest.narration, audioBinding, 'narration audio');
  requireBinding(input.narrationMaster, audioBinding, 'assembly narration master');
  if (audio?.status !== 'validated_master' || !Number.isFinite(audio.duration_seconds) || audio.duration_seconds <= 0
    || input.narrationFrames !== Math.ceil(audio.duration_seconds * 30)
    || publicPath(input.narrationAsset ?? '') !== audio.archive_path
    || state.active_visual_manifest.narration_master_checksum_sha256 !== audio.checksum_sha256) fail('validated narration master is stale');

  const queue = state.visual_asset_review?.queue?.filter(item => item.active_for_current_storyboard !== false && item.status !== 'superseded');
  if (!Array.isArray(queue) || queue.length !== manifest.spreads?.length || input.shots?.length !== queue.length) fail('current approved asset coverage differs');
  const seen = new Set();
  manifest.spreads.forEach((spread, index) => {
    const matches = queue.filter(item => item.shot_id === spread.shot_id);
    if (matches.length !== 1) fail(`${spread.shot_id} requires one current approved image`);
    const item = matches[0];
    if (seen.has(item.asset_id) || item.status !== 'approved'
      || item.presentation_mode !== 'illustrated-flipbook' || item.white_cat_present !== false
      || item.visual_generation_route !== spread.visual_generation_route
      || !equal(item.static_spread, spread.static_spread)
      || item.path !== spread.image.path || item.checksum_sha256 !== spread.image.checksum_sha256
      || item.approved_checksum_sha256 !== spread.image.checksum_sha256
      || input.shots[index].assets?.length !== 1 || input.shots[index].assets[0].asset_id !== item.asset_id) fail(`${spread.shot_id} image differs from the current approved queue`);
    seen.add(item.asset_id);
  });
};

export const resolveFlipbookDeliveryRoles = (state) => Object.fromEntries(
  ['required_delivery_roles', 'required_internal_qa_roles'].map(key => {
    const nested = state.caption_delivery?.[key];
    const top = state[key];
    if (nested !== undefined && top !== undefined && !equal(nested, top)) fail(`${key} has conflicting current bindings`);
    return [key, nested ?? top];
  }),
);

export const validateFlipbookOpeningCoverBinding = ({openingCover, publishingCover, lockedScriptSha256}) => {
  if (openingCover == null) return 0;
  if (openingCover.hold_frames !== 24 || openingCover.open_frames !== 30) fail('opening cover requires a 24-frame hold and 30-frame physical opening');
  validatePublishingCoverPackage(publishingCover, {
    episodeId: publishingCover?.episode_id,
    gate1TopicSha256: publishingCover?.gate1_topic_sha256,
    gate1ExactThemeWords: publishingCover?.exact_theme_words,
    gate2ScriptSha256: lockedScriptSha256,
    canonicalWhiteCatReferencePath: publishingCover?.white_cat_reference?.path,
    canonicalWhiteCatReferenceSha256: publishingCover?.white_cat_reference?.checksum_sha256,
  });
  const image = publishingCover.assets.landscape_16_9;
  requireBinding(openingCover.image, image, 'opening cover image');
  if (openingCover.image.width !== image.width || openingCover.image.height !== image.height) fail('opening cover dimensions differ from the current publishing cover');
  return openingCover.hold_frames + openingCover.open_frames;
};

export const validateFlipbookPresentationPlan = ({plan, manifest, openingFrames = 0}) => {
  if (plan.render_backend !== 'codex-browser-flipbook' || plan.full_master_frames + openingFrames !== manifest.total_frames
    || plan.scenes.length !== manifest.spreads.length
    || publicPath(plan.narration_asset) !== manifest.narration.path) fail('manifest timing or audio differs from the verified assembly');
  for (const [i, scene] of plan.scenes.entries()) {
    const spread = manifest.spreads[i];
    const reveals = scene.text_reveals.map(reveal => ({...reveal,
      start_frame: reveal.start_frame + openingFrames, end_frame: reveal.end_frame + openingFrames}));
    if (scene.shot_id !== spread.shot_id || scene.start_frame + openingFrames !== spread.start_frame
      || scene.duration_frames !== spread.duration_frames || scene.scene_class !== spread.scene_class
      || scene.visual_generation_route !== spread.visual_generation_route
      || scene.white_cat_present !== false || !equal(scene.static_spread, spread.static_spread)
      || !equal(reveals, spread.text_reveals) || scene.image_sequence.length !== 1
      || publicPath(scene.image_sequence[0].asset) !== spread.image.path
      || scene.image_sequence[0].checksum_sha256 !== spread.image.checksum_sha256) fail(`${scene.shot_id} manifest differs from approved assembly`);
    const turn = spread.transition_out;
    if (scene.transition === null ? turn != null : !turn) fail('transition coverage differs');
    if (turn) {
      const {start_frame: startFrame, ...contract} = turn;
      if (startFrame !== scene.start_frame + scene.duration_frames - scene.transition.duration_in_frames + openingFrames
        || !equal(scene.transition, contract)) fail('page-turn approval differs from the shared transition contract');
    }
  }
};

// This executes existing gates. A serialized {result:"pass"} cannot authorize a browser action.
export const verifyFlipbookProduction = ({manifest, repositoryRoot}) => {
  const authority = manifest.production_authority;
  const workspace = authority?.episode_workspace;
  if (!/^leverage-video\/src\/topic[0-9]+$/.test(workspace ?? '')) fail('one current episode workspace required');
  if (authority.episode_state?.path !== `${workspace}/schema/episode-state.json`) fail('authority must bind the current episode-state.json');
  const state = boundJson(repositoryRoot, authority.episode_state, workspace);
  const input = boundJson(repositoryRoot, authority.assembly_input, workspace);
  if (state.workspace_path !== workspace || input.episodeWorkspace !== workspace || manifest.episode_workspace !== workspace) fail('workspace binding differs');
  validateFlipbookCurrentAuthorityBindings({state, input, manifest});
  const selectionSummary = state.white_cat_visual_style_selection;
  const style = selectionSummary?.path ? boundJson(repositoryRoot, {
    path: selectionSummary.path, checksum_sha256: selectionSummary.file_checksum_sha256,
  }, workspace) : selectionSummary;
  if (!isFlipbookStyle(style) || !equal(input.workflowApproval?.whiteCatStyle, style)) fail('current style selection differs');
  validateWhiteCatVisualStyleSelection(style, {gate2ScriptSha256: input.workflowApproval.gate2ScriptSha256});
  const script = manifest.locked_script;
  if (typeof script?.path !== 'string' || !script.path.startsWith(`${workspace}/assets/narration/`)
    || script.path.split('/').includes('..') || script.checksum_sha256 !== style.gate2_script_sha256) fail('locked narration script binding differs from Gate 2');
  const scriptPath = boundFile(repositoryRoot, script, workspace, 'assets/narration');
  requireBinding(script, state.locked_script ?? {path: state.narration_script_source?.locked_script_path,
    checksum_sha256: state.narration_script_source?.locked_script_checksum_sha256}, 'locked script');
  const coverBinding = state.publishing_cover_generation;
  const publishingCover = manifest.opening_cover == null ? null : coverBinding?.path
    ? boundJson(repositoryRoot, coverBinding, workspace) : coverBinding;
  const openingFrames = validateFlipbookOpeningCoverBinding({openingCover: manifest.opening_cover,
    publishingCover, lockedScriptSha256: script.checksum_sha256});
  if (openingFrames) boundFile(repositoryRoot, manifest.opening_cover.image, workspace, 'assets/image');
  validateFlipbookNarrationCoverage({spreads: manifest.spreads,
    timingAuthority: boundJson(repositoryRoot, state.storyboard_timing, workspace),
    lockedBytes: fs.readFileSync(scriptPath)});
  boundFile(repositoryRoot, {path: style.style_profile_path, checksum_sha256: style.style_profile_checksum_sha256}, workspace, 'schema');
  boundFile(repositoryRoot, state.active_storyboard, workspace, 'assets/narration');
  boundFile(repositoryRoot, input.visualDirectionReview.storyboard, workspace, 'assets/narration');
  boundFile(repositoryRoot, manifest.narration, workspace, 'assets/audio');
  for (const spread of manifest.spreads) boundFile(repositoryRoot, spread.image, workspace, 'assets/image');
  boundJson(repositoryRoot, state.active_visual_manifest, workspace);
  const audioValidation = boundJson(repositoryRoot, {path: state.narration_audio.audio_validation_path,
    checksum_sha256: state.narration_audio.audio_validation_checksum_sha256}, workspace);
  if (audioValidation.status !== 'pass' || typeof audioValidation.qa_result !== 'string'
    || !audioValidation.qa_result.startsWith('pass')) fail('current narration audio validation did not pass');
  for (const [inputKey, stateKey] of [['density','visual_density_selection'],['mode','workflow_approval_mode']]) {
    if (input.workflowApproval[inputKey]?.selection_sha256 !== state[stateKey]?.selection_sha256) fail(`${stateKey} is stale`);
  }
  const phase = state.current_phase ?? state.phase;
  if (!['visual_assets_locked','sound_effect_design','composition_locked','awaiting_caption_delivery_choice','final_rendering','revoice_assembly','revoice_variant_rendering'].includes(phase)) fail('phase does not allow protected browser work');
  runValidator(repositoryRoot, ['.agents/skills/run-knowledge-video/scripts/validate_episode_workspace.py', workspace]);
  runValidator(repositoryRoot, ['.agents/skills/run-knowledge-video/scripts/validate_visual_approval_state.py', 'validate-locked', authority.episode_state.path, '--repository-root', repositoryRoot]);
  if (input.workflowApproval.mode.approval_mode === 'one_click') {
    assertOneClickProtectedActionAllowed({phase, captionDelivery: state.caption_delivery,
      visualReview: {status: state.visual_asset_review?.final_review?.status, visual_assets_locked: true}}, 'preview');
  }
  const plan = buildKnowledgeVideoAssemblyPlan(input);
  validateFlipbookPresentationPlan({plan, manifest, openingFrames});
  return {contract_version: 'knowledge-video-flipbook-production-preflight-v1',
    episode_workspace: workspace, episode_state: authority.episode_state, assembly_input: authority.assembly_input,
    assembly_plan_sha256: digest(plan), caption_delivery: state.caption_delivery, opening_frames: openingFrames,
    ...resolveFlipbookDeliveryRoles(state), plan};
};
