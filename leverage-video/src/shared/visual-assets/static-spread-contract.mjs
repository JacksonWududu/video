import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {FLIPBOOK_STYLE_ID, FLIPBOOK_STATIC_CONTRACT, FLIPBOOK_PROFILE_SHA256, isFlipbookStyle, isFlipbookRow} from '../flipbook-video/profile.mjs';
import {validateWhiteCatVisualStyleSelection} from '../workflow-approval/contract.mjs';
import {buildPresentedMapSha256, validateVisualDirectionReview} from '../visual-generation-routes/contract.mjs';

export const STATIC_SPREAD_QA_CONTRACT = 'knowledge-video-static-spread-qa-v1';
export const STATIC_SPREAD_PROMPT_MARKERS = [
  '16:9 landscape composition',
  'PRESENTATION MODE: illustrated-flipbook.',
  'WHITE CAT: absent; no cat anywhere in the body illustration.',
  'STATIC IMAGE: one complete image; no transparent layers or animation states.',
  'SUBTITLE SAFE AREA: none; do not reserve a bottom subtitle band.',
];
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fail = (message) => { throw new Error(`static spread: ${message}`); };
const checksum = (root, binding, label) => {
  const relative = binding?.path;
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)
      || relative.split('/').some((part) => !part || part === '..' || part === '.')) fail(`${label} path must be root-relative`);
  let target = path.resolve(root);
  for (const part of relative.split('/')) {
    target = path.join(target, part);
    if (fs.lstatSync(target).isSymbolicLink()) fail(`${label} cannot use symlinks`);
  }
  if (!fs.statSync(target).isFile()) fail(`${label} must be a regular file`);
  const bytes = fs.readFileSync(target);
  if (!bytes.length || sha(bytes) !== binding.checksum_sha256) fail(`${label} checksum is stale`);
  return {target, bytes};
};
const json = (root, binding, label) => JSON.parse(checksum(root, binding, label).bytes);
const selectionBinding = (state) => ({path: state.white_cat_visual_style_selection?.path, checksum_sha256: state.white_cat_visual_style_selection?.file_checksum_sha256});

export const inspectStaticSpreadAuthority = ({repositoryRoot, state, item}) => {
  const summary = state.white_cat_visual_style_selection;
  if (!isFlipbookStyle(summary) || !isFlipbookRow(item)) fail('requires selected illustrated-flipbook style and row');
  const selection = json(repositoryRoot, selectionBinding(state), 'style selection');
  validateWhiteCatVisualStyleSelection(selection, {gate2ScriptSha256: selection.gate2_script_sha256});
  if (summary.status !== 'selected' || !isFlipbookStyle(selection)) fail('style selection is not active');
  for (const key of ['style_id', 'selection_sha256', 'style_profile_path', 'style_profile_checksum_sha256']) {
    if (summary[key] !== selection[key]) fail(`style selection ${key} is stale`);
  }
  checksum(repositoryRoot, {path: selection.style_profile_path, checksum_sha256: FLIPBOOK_PROFILE_SHA256}, 'style profile');
  const reviewBinding = {path: item.visual_direction_review_path, checksum_sha256: item.visual_direction_review_checksum_sha256};
  if (state.visual_direction_review?.path !== reviewBinding.path
      || state.visual_direction_review?.checksum_sha256 !== reviewBinding.checksum_sha256) fail('direction state binding is stale');
  const review = json(repositoryRoot, reviewBinding, 'direction review');
  const queue = state.visual_asset_review?.queue ?? [];
  validateVisualDirectionReview(review, {shots: queue.filter((entry) => entry.active_for_current_storyboard !== false && entry.status !== 'superseded')});
  const status = state.visual_asset_review?.mode === 'one_click_final_review_v1' ? 'policy_authorized' : 'approved';
  if (review.contract_version !== 'per-shot-visual-direction-review-v3'
      || review.status !== status || review.presented_map_sha256 !== buildPresentedMapSha256(review)
      || item.visual_direction_presented_map_sha256 !== review.presented_map_sha256
      || review.white_cat_visual_style_binding?.selection_sha256 !== selection.selection_sha256) fail('direction approval is stale');
  const rows = review.rows.filter((row) => row.shot_id === item.shot_id);
  const row = rows[0];
  if (rows.length !== 1 || !isFlipbookRow(row) || !isFlipbookRow(row.user_selection)
      || row.user_selection.status !== status) fail('direction row is not approved');
  for (const record of [row, row.user_selection, item]) {
    if ((record === row ? record.white_cat_recommendation?.recommended : record.white_cat_present) !== false) fail('white cats are forbidden');
    if (!['ian-handdrawn-ppt', 'imagegen'].includes(record.visual_generation_route ?? record.user_selection?.visual_generation_route)) fail('route is unsupported');
    if (!same(record.static_spread, row.static_spread)) fail('static narration contract is substituted');
  }
  for (const key of ['visual_generation_route', 'visible_text_mode', 'exact_visible_text', 'visible_text_placement']) {
    if (item[key] !== row.user_selection[key]) fail(`${key} differs from the approved row`);
  }
  const spread = row.static_spread;
  if (spread?.contract_version !== FLIPBOOK_STATIC_CONTRACT
      || typeof spread.source_text !== 'string' || !spread.source_text
      || sha(spread.source_text) !== spread.source_text_sha256
      || item.narration_source_text !== spread.source_text) fail('locked narration bytes are stale');
  if (item.state_count_total !== 1 || item.state_index !== 0
      || item.white_cat_visual_style_id !== FLIPBOOK_STYLE_ID
      || item.white_cat_visual_style_selection_sha256 !== selection.selection_sha256
      || item.scene_package_manifest_path != null || item.ian_scene_plan != null
      || (item.depends_on ?? []).length !== 0) fail('requires exactly one independent static image');
  if (status === 'policy_authorized' && (review.policy_authorization?.policy_sha256 !== state.visual_asset_review.policy_sha256
      || row.user_selection.policy_sha256 !== review.policy_authorization.policy_sha256)) fail('one-click policy binding is stale');
  return {selection, row};
};

// Direction/text review precedes the production queue. Project approved rows for
// read-only contract validation; never persist these projections as queue assets.
export const inspectStaticSpreadDirection = ({repositoryRoot, state}) => {
  const binding = state.visual_direction_review;
  const review = json(repositoryRoot, binding, 'direction review');
  const oneClick = state.workflow_approval_mode?.approval_mode === 'one_click';
  const mode = state.visual_asset_review?.mode ?? (oneClick ? 'one_click_final_review_v1' : 'hybrid_batch_v1');
  const queue = (review.rows ?? []).map((row) => ({...row.user_selection,
    shot_id: row.shot_id, scene_class: row.scene_class, structured_visual_kind: row.structured_visual_kind ?? null,
    narration_source_text: row.static_spread?.source_text, state_count_total: 1, state_index: 0, depends_on: [],
    visual_direction_review_path: binding.path, visual_direction_review_checksum_sha256: binding.checksum_sha256,
    visual_direction_presented_map_sha256: review.presented_map_sha256}));
  if (!queue.length) fail('direction review has no static spreads');
  const validationState = {...state, visual_asset_review: {...state.visual_asset_review, mode, queue,
    policy_sha256: state.visual_asset_review?.policy_sha256 ?? state.one_click_approval_policy?.policy_sha256}};
  inspectStaticSpreadAuthority({repositoryRoot, state: validationState, item: queue[0]});
  return {result: 'pass', presented_map_sha256: review.presented_map_sha256};
};

export const buildStaticSpreadReadabilityPreview = async (bytes) => sharp(bytes, {failOn: 'error'})
  .resize(708, 399, {fit: 'contain', background: '#fffaf0'})
  .png({compressionLevel: 9}).toBuffer();

export const inspectStaticSpreadAsset = async ({repositoryRoot, state, item}) => {
  inspectStaticSpreadAuthority({repositoryRoot, state, item});
  const source = checksum(repositoryRoot, {path: item.path, checksum_sha256: item.checksum_sha256}, 'source image');
  const image = sharp(source.bytes, {failOn: 'error'});
  const metadata = await image.metadata();
  const stats = await image.stats();
  await image.raw().toBuffer();
  if (!stats.isOpaque) fail('complete image must be opaque, not a transparent layer');
  if (metadata.format !== 'png' || metadata.width <= metadata.height
      || Math.abs((metadata.width / metadata.height) / (16 / 9) - 1) > 0.005
      || !same(item.measured_dimensions, [metadata.width, metadata.height])) fail('source must decode as measured 16:9 PNG');
  const promptBinding = {path: item.prompt_path, checksum_sha256: item.prompt_checksum_sha256};
  const prompt = checksum(repositoryRoot, promptBinding, 'prompt').bytes.toString('utf8');
  for (const marker of STATIC_SPREAD_PROMPT_MARKERS) if (!prompt.includes(marker)) fail(`missing prompt marker: ${marker}`);
  const qaBinding = {path: item.qa_evidence_path, checksum_sha256: item.qa_evidence_checksum_sha256};
  const qa = json(repositoryRoot, qaBinding, 'QA evidence');
  if (item.qa_contract_version !== STATIC_SPREAD_QA_CONTRACT || qa.contract_version !== STATIC_SPREAD_QA_CONTRACT
      || qa.result !== 'pass' || qa.asset_id !== item.asset_id
      || !same(qa.output, {path: item.path, checksum_sha256: item.checksum_sha256})
      || !same(qa.prompt, promptBinding) || !same(qa.static_spread, item.static_spread)
      || qa.white_cat_present !== false) fail('QA output, prompt, narration or no-cat binding is stale');
  for (const field of ['technical_qa', 'semantic_qa', 'visible_text_qa', 'style_qa', 'visual_qa']) {
    if (qa[field]?.result !== 'pass' || !same(qa[field], item[field])) fail(`${field} is not passing`);
  }
  if (qa.visible_text_qa.mode !== item.visible_text_mode
      || qa.visible_text_qa.exact_text !== item.exact_visible_text) fail('visible image labels differ from approval');
  const reading = qa.half_page_readability;
  if (reading?.display_width_px !== 708 || reading.display_height_px !== 398.25
      || reading.fit !== 'contain' || reading.text_readable !== true || reading.no_crop !== true
      || reading.observed_white_cat_present !== false
      || reading.reviewed_source_checksum_sha256 !== item.checksum_sha256) fail('half-page readability or no-cat observation is missing');
  const preview = checksum(repositoryRoot, reading.preview, 'half-page review preview');
  if (!(await buildStaticSpreadReadabilityPreview(source.bytes)).equals(preview.bytes)) fail('half-page preview differs from deterministic contain');
  const references = item.actual_reference_inputs;
  if (!Array.isArray(references)) fail('actual reference input list is missing');
  for (const reference of references) checksum(repositoryRoot, reference, 'actual reference');
  if (item.visual_generation_route === 'ian-handdrawn-ppt' && (references.length !== 1
      || references[0].role !== 'visual_style_reference_only'
      || references[0].path !== '.agents/skills/ian-handdrawn-ppt/assets/reference-handdrawn-article-illustration-style.png')) fail('Ian requires its canonical style anchor');
  return {contract_version: FLIPBOOK_STATIC_CONTRACT, qa_evidence: qaBinding,
    prompt: promptBinding, static_spread: item.static_spread, half_page_preview: reading.preview,
    image_fit: 'contain', subtitle_safe_area_required: false, layered_scene_required: false};
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = JSON.parse(fs.readFileSync(0, 'utf8'));
    const result = args.operation === 'direction' ? inspectStaticSpreadDirection(args)
      : args.operation === 'authority' ? inspectStaticSpreadAuthority(args) : await inspectStaticSpreadAsset(args);
    process.stdout.write(JSON.stringify(result));
  } catch (error) { console.error(error.message); process.exit(1); }
}
