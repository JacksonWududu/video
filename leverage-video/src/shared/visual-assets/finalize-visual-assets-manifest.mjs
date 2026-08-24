#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import sharp from 'sharp';

import {
  assertRegularFile,
  readJson,
  sha256File,
  verifyFileChecksum,
} from '../episode-tooling/file-integrity.mjs';
import {
  assertExactCompositionRaster,
  assertLandscape16By9,
  coverGeometry,
} from '../episode-tooling/raster-contract.mjs';
import {
  buildActionStatePlanSha256,
  validateActionStateSchedule,
} from '../action-state-schedule/contract.mjs';
import {buildTransitionReviewPresentedMapSha256} from '../scene-transitions/build-review-proposal.mjs';
import {validateUserApprovedTransition} from '../scene-transitions/contract.mjs';
import {validateEpisodeTransitionReviewProposal} from '../scene-transitions/validate-review-proposal.mjs';
import {
  buildStoryboardVisualRhythmMapSha256,
  validateStoryboardVisualRhythm,
} from '../storyboard-visual-rhythm/contract.mjs';
import {inspectIanLayeredScenePackage} from '../ian-layered-scene/contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPOSITORY_ROOT = path.resolve(HERE, '../../../..');

const SHA256 = /^[a-f0-9]{64}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const NORMALIZATION_METHOD = 'sharp-lanczos3-scale-to-cover-centered-minimal-crop-png9-v1';
const SUPPORTED_ROUTES = new Set(['imagegen', 'ian-handdrawn-ppt']);
const VISUAL_MANIFEST_CONTRACT = 'visual-assets-manifest-v1';
const VISUAL_LOCK_FILE = '.visual-assets-finalizer.lock';
const VISUAL_BUILD_PHASES = ['visual_production', 'visual_assets_locked'];
const VISUAL_VALIDATION_PHASES = [
  ...VISUAL_BUILD_PHASES,
  'composition_locked',
  'awaiting_caption_delivery_choice',
  'final_rendering',
  'delivered',
  'complete',
  'revoice_assembly',
  'revoice_variant_rendering',
  'revoice_variant_delivered',
];

const fail = (message) => {
  throw new Error(message);
};

const assertObject = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
};

const assertArray = (value, label) => {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  return value;
};

const assertString = (value, label) => {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} must be a non-empty string`);
  return value;
};

const assertChecksum = (value, label) => {
  if (typeof value !== 'string' || !SHA256.test(value)) fail(`${label} must be a SHA-256 checksum`);
  return value;
};

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
};

export const canonicalJson = (value) => JSON.stringify(stableValue(value));
const sha256Bytes = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const sha256Canonical = (value) => sha256Bytes(Buffer.from(canonicalJson(value)));

const sameJson = (left, right) => canonicalJson(left) === canonicalJson(right);
const requireSameJson = (actual, expected, label) => {
  if (!sameJson(actual, expected)) fail(`${label} does not match its current authority`);
};

const normalizeRootRelative = (relative, label) => {
  assertString(relative, label);
  if (path.isAbsolute(relative)) fail(`${label} must be repository-root-relative`);
  const portable = relative.replaceAll('\\', '/');
  if (portable.split('/').includes('..')) fail(`${label} escapes repository root`);
  const normalized = path.posix.normalize(portable);
  if (normalized === '..' || normalized.startsWith('../') || normalized === '.') {
    fail(`${label} escapes repository root`);
  }
  return normalized;
};

const isPathInside = (parent, candidate) => {
  const fromParent = path.relative(parent, candidate);
  return fromParent === '' || (
    fromParent !== '..'
    && !fromParent.startsWith(`..${path.sep}`)
    && !path.isAbsolute(fromParent)
  );
};

const assertPathComponentsSafe = (
  containmentRoot,
  target,
  label,
  {allowMissingFinal = false} = {},
) => {
  const root = path.resolve(containmentRoot);
  const resolved = path.resolve(target);
  if (!isPathInside(root, resolved)) fail(`${label} escapes its containment root`);
  const rootStat = fs.lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    fail(`${label} containment root must be a real directory`);
  }
  const parts = path.relative(root, resolved).split(path.sep).filter(Boolean);
  let cursor = root;
  parts.forEach((part, index) => {
    cursor = path.join(cursor, part);
    if (!fs.existsSync(cursor)) {
      if (allowMissingFinal && index === parts.length - 1) return;
      fail(`${label} path component is missing: ${cursor}`);
    }
    const status = fs.lstatSync(cursor);
    if (status.isSymbolicLink()) fail(`${label} path contains a symbolic link: ${cursor}`);
    if (index < parts.length - 1 && !status.isDirectory()) {
      fail(`${label} parent component is not a directory: ${cursor}`);
    }
  });
  return resolved;
};

const resolveRootRelative = (
  repositoryRoot,
  relative,
  label,
  {allowMissingFinal = false} = {},
) => {
  const normalized = normalizeRootRelative(relative, label);
  const root = path.resolve(repositoryRoot);
  if (!fs.existsSync(root)) fail('repository root does not exist');
  const resolved = path.resolve(root, normalized);
  assertPathComponentsSafe(root, resolved, label, {allowMissingFinal});
  return {relative: normalized, resolved};
};

const resolveEpisodeRelative = (
  repositoryRoot,
  episodeWorkspace,
  relative,
  label,
  options = {},
) => {
  const workspace = normalizeRootRelative(episodeWorkspace, 'episode workspace');
  const target = resolveRootRelative(repositoryRoot, relative, label, options);
  const episodeRoot = resolveRootRelative(repositoryRoot, workspace, 'episode workspace').resolved;
  if (!isPathInside(episodeRoot, target.resolved)) fail(`${label} is outside episode workspace`);
  return target;
};

const resolveExternalRegularFile = (absolute, label) => {
  assertString(absolute, label);
  if (!path.isAbsolute(absolute)) fail(`${label} must be absolute`);
  const resolved = path.resolve(absolute);
  assertPathComponentsSafe(path.parse(resolved).root, resolved, label);
  assertRegularFile(resolved, {nonEmpty: true});
  return resolved;
};

const defaultPaths = (episodeWorkspace) => ({
  state: `${episodeWorkspace}/schema/episode-state.json`,
  manifest: `${episodeWorkspace}/schema/visual-assets-manifest-v1.json`,
  coverEvidence: `${episodeWorkspace}/schema/cover-normalization-v1.json`,
  normalizationDirectory: `${episodeWorkspace}/schema/normalization`,
});

const requireCurrentFile = (
  repositoryRoot,
  relative,
  expectedChecksum,
  label,
  {episodeWorkspace = null} = {},
) => {
  const target = episodeWorkspace === null
    ? resolveRootRelative(repositoryRoot, relative, label)
    : resolveEpisodeRelative(repositoryRoot, episodeWorkspace, relative, label);
  assertChecksum(expectedChecksum, `${label} checksum`);
  assertRegularFile(target.resolved, {nonEmpty: true});
  verifyFileChecksum(target.resolved, expectedChecksum);
  return target;
};

const rasterMetadata = async (file, label) => {
  assertRegularFile(file, {nonEmpty: true});
  const metadata = await sharp(file, {failOn: 'error'}).metadata();
  if (!Number.isInteger(metadata.width) || !Number.isInteger(metadata.height)) {
    fail(`${label} has no decodable raster dimensions`);
  }
  return metadata;
};

const normalizeRasterBytes = async (bytes) => sharp(bytes, {failOn: 'error'})
  .resize(1920, 1080, {
    fit: 'cover',
    position: 'centre',
    kernel: sharp.kernel.lanczos3,
  })
  .png({compressionLevel: 9, adaptiveFiltering: false, palette: false})
  .toBuffer();

const assertEvidenceGeometry = (evidence, sourceRaster, label) => {
  if (evidence.contract_version !== 'normalized-raster-evidence-v1' || evidence.result !== 'pass') {
    fail(`${label} is not passing normalized-raster-evidence-v1`);
  }
  if (evidence.method !== NORMALIZATION_METHOD || evidence.stretch !== false || evidence.padding !== false) {
    fail(`${label} normalization method is unsupported`);
  }
  requireSameJson(evidence.geometry, coverGeometry(sourceRaster.width, sourceRaster.height), `${label} geometry`);
};

const sourceApprovalLock = (review, queue) => {
  const payload = {
    contract_version: 'visual-assets-lock-verification-v1',
    mode: review.mode,
    assets: queue.map((item) => ({
      asset_id: item.asset_id,
      checksum_sha256: item.approved_checksum_sha256,
    })),
  };
  return {
    ...payload,
    active_asset_count: queue.length,
    verification_sha256: sha256Canonical(payload),
    result: 'pass',
  };
};

const inspectAuthority = (
  repositoryRoot,
  episodeWorkspace,
  pointer,
  label,
  contractVersion,
) => {
  assertObject(pointer, label);
  const target = requireCurrentFile(
    repositoryRoot,
    pointer.path,
    pointer.checksum_sha256,
    label,
    {episodeWorkspace},
  );
  const value = readJson(target.resolved);
  const allowedVersions = Array.isArray(contractVersion) ? contractVersion : [contractVersion];
  if (contractVersion && !allowedVersions.includes(value.contract_version)) {
    fail(`${label} must use ${allowedVersions.join(' or ')}`);
  }
  return {
    path: target.relative,
    checksum_sha256: pointer.checksum_sha256,
    value,
  };
};

const parseStoryboardSourceTexts = (markdown) => {
  const matches = [...markdown.matchAll(/^## (OPEN-00|S\d+)\n([\s\S]*?)(?=^## |(?![\s\S]))/gm)];
  const sections = new Map();
  for (const match of matches) {
    if (sections.has(match[1])) fail(`storyboard contains duplicate section ${match[1]}`);
    const source = match[2].match(/- 锁稿原文 source_text：\n```text\n([\s\S]*?)\n```/);
    if (!source) fail(`storyboard section ${match[1]} lacks exact source_text`);
    sections.set(match[1], source[1]);
  }
  if (!sections.has('OPEN-00')) fail('storyboard lacks OPEN-00 source_text');
  return sections;
};

const inspectRootOrExternalReference = ({repositoryRoot, pathValue, checksum, label}) => {
  assertChecksum(checksum, `${label} checksum`);
  let resolved;
  let scope;
  if (path.isAbsolute(pathValue)) {
    resolved = resolveExternalRegularFile(pathValue, label);
    scope = 'approved-external-reference';
  } else {
    resolved = resolveRootRelative(repositoryRoot, pathValue, label).resolved;
    assertRegularFile(resolved, {nonEmpty: true});
    scope = 'repository-reference';
  }
  verifyFileChecksum(resolved, checksum);
  return {path: pathValue, checksum_sha256: checksum, scope};
};

const inspectEmbeddedFileBindings = ({repositoryRoot, value, label}) => {
  const bindings = [];
  const visit = (node, pointer) => {
    if (Array.isArray(node)) {
      node.forEach((entry, index) => visit(entry, `${pointer}/${index}`));
      return;
    }
    if (!node || typeof node !== 'object') return;
    const hasPath = Object.hasOwn(node, 'path');
    const hasChecksum = Object.hasOwn(node, 'checksum_sha256');
    if (hasPath !== hasChecksum) fail(`${label} file binding is incomplete at ${pointer || '/'}`);
    if (hasPath) {
      const inspection = inspectRootOrExternalReference({
        repositoryRoot,
        pathValue: node.path,
        checksum: node.checksum_sha256,
        label: `${label} ${pointer || '/'}`,
      });
      bindings.push({json_pointer: pointer || '/', ...inspection});
    }
    for (const [key, entry] of Object.entries(node)) {
      const escaped = key.replaceAll('~', '~0').replaceAll('/', '~1');
      visit(entry, `${pointer}/${escaped}`);
    }
  };
  visit(value, '');
  return bindings;
};

const inspectPrompt = ({repositoryRoot, episodeWorkspace, item, prefix = ''}) => {
  const pathKey = prefix ? `${prefix}_prompt_path` : 'prompt_path';
  const checksumKey = prefix ? `${prefix}_prompt_checksum_sha256` : 'prompt_checksum_sha256';
  if (item[pathKey] === undefined && item[checksumKey] === undefined) return null;
  const target = requireCurrentFile(
    repositoryRoot,
    item[pathKey],
    item[checksumKey],
    `asset ${item.asset_id} ${prefix || 'selected'} prompt`,
    {episodeWorkspace},
  );
  return {
    path: target.relative,
    checksum_sha256: item[checksumKey],
    text_utf8: fs.readFileSync(target.resolved, 'utf8'),
  };
};

const assertPassingQa = (item, qa) => {
  if (typeof qa.contract_version !== 'string' || qa.contract_version.trim() === ''
      || qa.result !== 'pass' || qa.asset_id !== item.asset_id) {
    fail(`asset ${item.asset_id} QA evidence is not a passing record for the asset`);
  }
  for (const field of ['technical_qa', 'semantic_qa', 'visible_text_qa', 'style_qa', 'visual_qa']) {
    if (item[field]?.result !== 'pass') fail(`asset ${item.asset_id} ${field} is not passing`);
    if (qa[field] !== undefined) requireSameJson(qa[field], item[field], `asset ${item.asset_id} ${field}`);
  }
  for (const field of ['identity_qa', 'historical_identity_qa', 'continuity_qa']) {
    if (item[field] !== undefined && item[field] !== null) {
      if (item[field].result !== 'pass') fail(`asset ${item.asset_id} ${field} is not passing`);
      if (qa[field] !== undefined) requireSameJson(qa[field], item[field], `asset ${item.asset_id} ${field}`);
    }
  }
};

const inspectQaEvidence = ({repositoryRoot, episodeWorkspace, item}) => {
  const target = requireCurrentFile(
    repositoryRoot,
    item.qa_evidence_path,
    item.qa_evidence_checksum_sha256,
    `asset ${item.asset_id} QA evidence`,
    {episodeWorkspace},
  );
  const record = readJson(target.resolved);
  assertPassingQa(item, record);
  return {path: target.relative, checksum_sha256: item.qa_evidence_checksum_sha256, record};
};

const batchPayload = (assets) => ({
  contract_version: 'visual-asset-batch-manifest-v1',
  assets: assets.map(({asset_id: assetId, checksum_sha256: checksum}) => ({
    asset_id: assetId,
    checksum_sha256: checksum,
  })),
});

const validateBatchManifest = ({record, episodeWorkspace, storyboard, label}) => {
  const assets = assertArray(record.assets, `${label}.assets`);
  const payload = batchPayload(assets);
  const assetIds = assets.map((asset) => assertString(asset.asset_id, `${label} asset_id`));
  if (new Set(assetIds).size !== assetIds.length) fail(`${label} contains duplicate asset IDs`);
  assets.forEach((asset) => assertChecksum(asset.checksum_sha256, `${label} asset checksum`));
  const checksumMap = Object.fromEntries(assets.map((asset) => [asset.asset_id, asset.checksum_sha256]));
  const expectedDigest = sha256Canonical(payload);
  if (record.contract_version !== payload.contract_version
      || !sameJson(record.asset_ids, assetIds)
      || !sameJson(record.checksum_map, checksumMap)
      || record.manifest_sha256 !== expectedDigest
      || record.episode_workspace !== episodeWorkspace
      || record.storyboard_path !== storyboard.path
      || record.storyboard_checksum_sha256 !== storyboard.checksum_sha256
      || typeof record.presented_at !== 'string'
      || Number.isNaN(Date.parse(record.presented_at))
      || typeof record.exact_presentation_message !== 'string'
      || record.exact_presentation_message.trim() === '') {
    fail(`${label} is stale or malformed`);
  }
  const reviewAssets = assertArray(record.review_assets, `${label}.review_assets`);
  if (reviewAssets.length !== assets.length) fail(`${label} review asset coverage is incomplete`);
  reviewAssets.forEach((asset, index) => {
    if (asset.asset_id !== assets[index].asset_id
        || asset.checksum_sha256 !== assets[index].checksum_sha256
        || asset.narration_source_text === undefined
        || asset.technical_qa?.result !== 'pass') {
      fail(`${label} review asset ${index} is stale or incomplete`);
    }
  });
  return expectedDigest;
};

const buildBatchManifestIndex = ({repositoryRoot, episodeWorkspace, storyboard}) => {
  const schema = resolveEpisodeRelative(
    repositoryRoot,
    episodeWorkspace,
    `${episodeWorkspace}/schema`,
    'episode schema directory',
  );
  const index = new Map();
  for (const entry of fs.readdirSync(schema.resolved, {withFileTypes: true})) {
    if (!entry.name.startsWith('visual-asset-batch-') || !entry.name.endsWith('.json')) continue;
    const relative = `${episodeWorkspace}/schema/${entry.name}`;
    const target = resolveEpisodeRelative(
      repositoryRoot,
      episodeWorkspace,
      relative,
      `visual batch manifest ${entry.name}`,
    );
    assertRegularFile(target.resolved, {nonEmpty: true});
    const record = readJson(target.resolved);
    const digest = validateBatchManifest({record, episodeWorkspace, storyboard, label: entry.name});
    if (index.has(digest)) fail(`duplicate visual batch manifest digest: ${digest}`);
    index.set(digest, {
      path: target.relative,
      checksum_sha256: sha256File(target.resolved),
      manifest_sha256: digest,
      record,
    });
  }
  return index;
};

const assertPolicyMapAuthorization = (
  authorization,
  {label, policySha256, presentedMapSha256, authorizedAt = null, deterministicRequired = false},
) => {
  assertObject(authorization, `${label} policy_authorization`);
  if (authorization.policy_sha256 !== policySha256
      || authorization.presented_map_sha256 !== presentedMapSha256
      || authorization.user_has_reviewed_specific_map !== false
      || typeof authorization.authorized_at !== 'string'
      || Number.isNaN(Date.parse(authorization.authorized_at))
      || (authorizedAt !== null && authorization.authorized_at !== authorizedAt)
      || (deterministicRequired && authorization.deterministic_recommendation_selected !== true)
      || (authorization.exact_message !== undefined && authorization.exact_message !== null)
      || (authorization.decided_at !== undefined && authorization.decided_at !== null)) {
    fail(`${label} policy authorization is incomplete, stale, or fabricates concrete review`);
  }
  return authorization.authorized_at;
};

const assertPolicySelection = (
  selection,
  {label, policySha256, presentedMapSha256, authorizedAt},
) => {
  if (selection?.status !== 'policy_authorized'
      || selection.policy_sha256 !== policySha256
      || selection.presented_map_sha256 !== presentedMapSha256
      || selection.deterministic_recommendation_selected !== true
      || selection.user_has_reviewed_specific_map !== false
      || selection.exact_message !== null
      || selection.decided_at !== null
      || selection.authorized_at !== authorizedAt) {
    fail(`${label} policy authorization is incomplete, stale, or fabricates concrete review`);
  }
};

const assertReviewReady = (state) => {
  const review = assertObject(state.visual_asset_review, 'visual_asset_review');
  if (!['hybrid_batch_v1', 'one_click_final_review_v1'].includes(review.mode)) {
    fail('visual_asset_review must use hybrid_batch_v1 or one_click_final_review_v1');
  }
  if (review.active_batch !== undefined && review.active_batch !== null) {
    fail('visual_asset_review still has an active batch');
  }
  if (review.queue_generation_allowed !== true) {
    fail('visual_asset_review has a closed approval boundary');
  }
  const queue = assertArray(review.queue, 'visual_asset_review.queue');
  if (queue.length === 0) fail('visual_asset_review.queue is empty');
  if (queue.some((item) => item?.status !== 'approved')) fail('every visual asset queue item must be approved');
  const ids = queue.map((item) => item.asset_id);
  if (ids.some((assetId) => typeof assetId !== 'string' || assetId.length === 0)
      || new Set(ids).size !== ids.length) {
    fail('visual asset queue contains a missing or duplicate asset_id');
  }
  let oneClickFinalReview = null;
  if (review.mode === 'one_click_final_review_v1') {
    const finalReview = assertObject(review.final_review, 'visual_asset_review.final_review');
    const finalAssets = assertArray(finalReview.assets, 'visual_asset_review.final_review.assets');
    if (finalAssets.length !== queue.length) {
      fail('one-click final visual approval does not exactly match the current ordered queue');
    }
    const pendingAssets = finalAssets.map((asset, index) => {
      const item = queue[index];
      if (!item
          || asset?.asset_id !== item.asset_id
          || asset.path !== item.path
          || asset.checksum_sha256 !== item.checksum_sha256
          || asset.qa_status !== 'approved'
          || item.presented_checksum_sha256 !== item.checksum_sha256
          || item.approved_checksum_sha256 !== item.checksum_sha256
          || item.decision_message !== finalReview.decision_message
          || item.decision_time !== finalReview.decision_time) {
        fail('one-click final visual approval does not exactly match the current ordered queue');
      }
      return {
        asset_id: asset.asset_id,
        path: asset.path,
        checksum_sha256: asset.checksum_sha256,
        qa_status: 'qa_passed_pending_final_review',
        ...(asset.white_cat_anatomy_review === undefined
          ? {}
          : {white_cat_anatomy_review: structuredClone(asset.white_cat_anatomy_review)}),
        ...(asset.ian_layered_scene_package === undefined
          ? {}
          : {ian_layered_scene_package: structuredClone(asset.ian_layered_scene_package)}),
      };
    });
    const payload = {
      contract_version: 'visual-asset-review-v3',
      mode: 'one_click_final_review_v1',
      storyboard_sha256: review.storyboard_sha256,
      policy_sha256: review.policy_sha256,
      assets: pendingAssets,
    };
    const expectedMapSha256 = sha256Canonical(payload);
    if (review.contract_version !== payload.contract_version
        || !SHA256.test(review.storyboard_sha256 ?? '')
        || !SHA256.test(review.policy_sha256 ?? '')
        || finalReview.contract_version !== payload.contract_version
        || finalReview.mode !== payload.mode
        || finalReview.storyboard_sha256 !== review.storyboard_sha256
        || finalReview.policy_sha256 !== review.policy_sha256
        || finalReview.status !== 'approved'
        || finalReview.exact_hash_list_approved !== true
        || finalReview.presented_map_sha256 !== expectedMapSha256
        || finalReview.asset_list_sha256 !== expectedMapSha256
        || typeof finalReview.decision_message !== 'string'
        || finalReview.decision_message.trim() === ''
        || typeof finalReview.decision_time !== 'string'
        || Number.isNaN(Date.parse(finalReview.decision_time))) {
      fail('one-click visual assets require approved complete exact hash-list evidence');
    }
    oneClickFinalReview = finalReview;
  }
  return {review, queue, oneClickFinalReview};
};

const inspectBatchBinding = ({item, batchIndex}) => {
  const presented = item.presented_batch_manifest_sha256 ?? null;
  const approved = item.batch_manifest_sha256 ?? null;
  if (typeof item.presented_at !== 'string' || Number.isNaN(Date.parse(item.presented_at))) {
    fail(`asset ${item.asset_id} presentation time is invalid`);
  }
  if (presented === null && approved === null) {
    if (item.strict_review !== true
        || typeof item.exact_presentation_message !== 'string'
        || item.exact_presentation_message.trim() === '') {
      fail(`asset ${item.asset_id} strict review evidence is incomplete`);
    }
    return {
      review_mode: 'strict-per-item',
      artifact: null,
      exact_presentation_message: item.exact_presentation_message,
    };
  }
  if (item.strict_review !== false
      || !SHA256.test(item.batch_qa_checksum_sha256 ?? '')
      || typeof item.batch_qa_time !== 'string'
      || Number.isNaN(Date.parse(item.batch_qa_time))) {
    fail(`asset ${item.asset_id} batch QA evidence is incomplete`);
  }
  if (presented !== approved) fail(`asset ${item.asset_id} batch manifest approval is stale`);
  assertChecksum(approved, `asset ${item.asset_id} batch manifest checksum`);
  const artifact = batchIndex.get(approved);
  if (!artifact) fail(`asset ${item.asset_id} batch manifest artifact is missing`);
  const member = artifact.record.assets.find((entry) => entry.asset_id === item.asset_id);
  const reviewAsset = artifact.record.review_assets.find((entry) => entry.asset_id === item.asset_id);
  if (!member || member.checksum_sha256 !== item.approved_checksum_sha256
      || !reviewAsset
      || reviewAsset.path !== item.path
      || reviewAsset.checksum_sha256 !== item.approved_checksum_sha256
      || reviewAsset.narration_source_text !== item.narration_source_text
      || artifact.record.presented_at !== item.presented_at) {
    fail(`asset ${item.asset_id} batch manifest membership is stale`);
  }
  return {
    review_mode: 'hybrid-batch-member',
    artifact,
    exact_presentation_message: artifact.record.exact_presentation_message,
  };
};

const inspectIanEvidence = async ({
  repositoryRoot,
  episodeWorkspace,
  item,
  direction,
  expectedDirectionStatus,
}) => {
  const manifestTarget = requireCurrentFile(
    repositoryRoot,
    item.scene_package_manifest_path,
    item.scene_package_manifest_checksum_sha256,
    `asset ${item.asset_id} Ian layered-scene manifest`,
    {episodeWorkspace},
  );
  const manifest = readJson(manifestTarget.resolved);
  const selected = direction.user_selection;
  if (selected.status !== expectedDirectionStatus
      || item.qa_contract_version !== 'ian-layered-scene-qa-v1') {
    fail(`asset ${item.asset_id} Ian layered-scene authorization is stale`);
  }
  const inspection = await inspectIanLayeredScenePackage(manifest, {
    repositoryRoot,
    episodeWorkspace,
    queueItemId: item.asset_id,
    shotId: item.shot_id,
    treatmentProfileId: item.treatment_profile_id,
    storyboardBinding: {
      path: item.storyboard_path,
      checksum_sha256: item.storyboard_checksum_sha256,
    },
    visualDirectionBinding: {
      path: item.visual_direction_review_path,
      checksum_sha256: item.visual_direction_review_checksum_sha256,
      presented_map_sha256: item.visual_direction_presented_map_sha256,
    },
    sourceText: item.narration_source_text,
    shotStartFrame: item.shot_start_frame,
    shotEndFrame: item.shot_end_frame,
  });
  const expectedVerifiedText = item.visible_text_mode === 'none' ? [] : [item.exact_visible_text];
  if (!sameJson(manifest.verified_visible_text, expectedVerifiedText)
      || manifest.final_composite.path !== item.path
      || manifest.final_composite.checksum_sha256 !== item.approved_checksum_sha256
      || !sameJson(manifest.scene_plan, item.ian_scene_plan)
      || manifest.scene_plan_sha256 !== item.ian_scene_plan_sha256) {
    fail(`asset ${item.asset_id} Ian layered-scene output or visible-text binding is stale`);
  }
  const expectedMembers = [
    {member_role: 'background', layer_id: 'background', ...manifest.background},
    ...manifest.layers.map((layer) => ({member_role: 'semantic-layer', ...layer})),
    {member_role: 'final-composite', layer_id: 'final-composite', ...manifest.final_composite},
  ].map((member) => ({
    member_role: member.member_role,
    layer_id: member.layer_id,
    path: member.path,
    checksum_sha256: member.checksum_sha256,
    width: member.width,
    height: member.height,
    has_alpha: member.has_alpha,
  }));
  if (!sameJson(item.ian_scene_package_members, expectedMembers)) {
    fail(`asset ${item.asset_id} Ian layered-scene member list is stale`);
  }
  const expectedGeneratedMembers = expectedMembers.slice(0, -1);
  const generationLineage = item.generation_lineage;
  if (!Array.isArray(generationLineage)
      || generationLineage.length !== expectedGeneratedMembers.length
      || generationLineage.some((stage, index) => (
        stage?.stage !== 'independent-member-generation'
        || stage.generation_mode !== 'codex-native-imagegen-independent-member-v1'
        || stage.member_role !== expectedGeneratedMembers[index].member_role
        || stage.layer_id !== expectedGeneratedMembers[index].layer_id
        || stage.selection_status !== 'selected'
        || !sameJson(stage.reference_inputs, item.actual_reference_inputs)
        || !sameJson(stage.output, {
          path: expectedGeneratedMembers[index].path,
          checksum_sha256: expectedGeneratedMembers[index].checksum_sha256,
        })
      ))) {
    fail(`asset ${item.asset_id} Ian source members lack independent generation lineage`);
  }
  const reviewPayload = {
    contract_version: 'ian-knowledge-video-layered-scene-v1',
    manifest: {
      path: manifestTarget.relative,
      checksum_sha256: item.scene_package_manifest_checksum_sha256,
    },
    scene_plan_sha256: manifest.scene_plan_sha256,
    members: expectedMembers,
  };
  const packageReview = {
    ...reviewPayload,
    package_review_sha256: sha256Canonical(reviewPayload),
  };
  return {
    scene_package_manifest: {
      path: manifestTarget.relative,
      checksum_sha256: item.scene_package_manifest_checksum_sha256,
      record: manifest,
    },
    package_review: packageReview,
    validation: inspection,
  };
};

const inspectQueueEvidence = async ({
  repositoryRoot,
  episodeWorkspace,
  item,
  storyboard,
  storyboardSourceText,
  direction,
  rhythm,
  batchIndex,
  reviewMode,
  oneClickFinalReview,
}) => {
  if (item.active_for_current_storyboard !== true
      || item.storyboard_path !== storyboard.path
      || item.storyboard_checksum_sha256 !== storyboard.checksum_sha256
      || item.storyboard_rebind_qa?.result !== 'pass'
      || item.narration_source_text !== storyboardSourceText
      || item.shot_start_frame !== rhythm.start_frame
      || item.shot_end_frame !== rhythm.end_frame
      || item.shot_duration_frames !== rhythm.end_frame - rhythm.start_frame) {
    fail(`asset ${item.asset_id} storyboard or rhythm rebind is stale`);
  }
  if (item.visual_direction_review_path !== direction.review_path
      || item.visual_direction_review_checksum_sha256 !== direction.review_checksum_sha256
      || item.visual_direction_presented_map_sha256 !== direction.presented_map_sha256) {
    fail(`asset ${item.asset_id} visual-direction binding is stale`);
  }
  const prompt = inspectPrompt({repositoryRoot, episodeWorkspace, item});
  if (!prompt) fail(`asset ${item.asset_id} selected prompt is missing`);
  const basePrompt = inspectPrompt({repositoryRoot, episodeWorkspace, item, prefix: 'base'});
  const references = assertArray(item.actual_reference_inputs, `asset ${item.asset_id} references`).map(
    (reference, index) => ({
      ...structuredClone(reference),
      inspection: inspectRootOrExternalReference({
        repositoryRoot,
        pathValue: reference.path,
        checksum: reference.checksum_sha256,
        label: `asset ${item.asset_id} reference ${index}`,
      }),
    }),
  );
  const qa = inspectQaEvidence({repositoryRoot, episodeWorkspace, item});
  const batchManifest = reviewMode === 'one_click_final_review_v1'
    ? null
    : inspectBatchBinding({item, batchIndex});
  const whiteCatPointers = {};
  for (const prefix of [
    'character_reference',
    'character_bible',
    'generation_constraints',
    'satchel_accuracy_rule',
    'supporting_geometry_reference',
  ]) {
    const pathValue = item[`${prefix}_path`];
    const checksum = item[`${prefix}_checksum_sha256`];
    if (pathValue === undefined && checksum === undefined) continue;
    whiteCatPointers[prefix] = inspectRootOrExternalReference({
      repositoryRoot,
      pathValue,
      checksum,
      label: `asset ${item.asset_id} ${prefix}`,
    });
  }
  if (item.white_cat_present === true && item.visual_generation_route === 'imagegen') {
    if (item.visible_text_mode !== 'none'
        || item.exact_visible_text !== null
        || item.visible_text_placement !== null) {
      fail(`asset ${item.asset_id} violates white-cat imagegen text-free policy`);
    }
  }
  const ian = item.visual_generation_route === 'ian-handdrawn-ppt'
    ? await inspectIanEvidence({
        repositoryRoot,
        episodeWorkspace,
        item,
        direction,
        expectedDirectionStatus: reviewMode === 'one_click_final_review_v1'
          ? 'policy_authorized'
          : 'approved',
      })
    : null;
  const finalReviewAsset = reviewMode === 'one_click_final_review_v1'
    ? oneClickFinalReview.assets.find((asset) => asset.asset_id === item.asset_id)
    : null;
  if (reviewMode === 'one_click_final_review_v1' && !finalReviewAsset) {
    fail(`asset ${item.asset_id} is absent from one-click final exact-list approval`);
  }
  if (ian !== null) {
    if (reviewMode === 'one_click_final_review_v1') {
      if (!sameJson(finalReviewAsset.ian_layered_scene_package, ian.package_review)) {
        fail(`asset ${item.asset_id} one-click approval does not bind the Ian layered package`);
      }
    } else if (batchManifest.artifact === null) {
      if (!sameJson(item.presented_ian_layered_scene_package, ian.package_review)
          || !sameJson(item.approved_ian_layered_scene_package, ian.package_review)) {
        fail(`asset ${item.asset_id} strict approval does not bind the Ian layered package`);
      }
    } else {
      const reviewAsset = batchManifest.artifact.record.review_assets.find(
        (asset) => asset.asset_id === item.asset_id,
      );
      const manifestAsset = batchManifest.artifact.record.assets.find(
        (asset) => asset.asset_id === item.asset_id,
      );
      if (!sameJson(reviewAsset?.ian_layered_scene_package, ian.package_review)
          || !sameJson(manifestAsset?.ian_layered_scene_package, ian.package_review)) {
        fail(`asset ${item.asset_id} batch approval does not bind the Ian layered package`);
      }
    }
  }
  const generationLineage = structuredClone(item.generation_lineage ?? []);
  const rejectedAttempts = structuredClone(item.rejected_attempts ?? []);
  const imagegenQaFailures = structuredClone(item.white_cat_imagegen_qa_failures ?? []);
  const userTakeoverSource = structuredClone(item.user_takeover_source ?? null);
  return {
    queue_record_contract: reviewMode === 'one_click_final_review_v1'
      ? 'visual-asset-review-v3-approved-record'
      : 'visual-asset-review-v2-approved-record',
    queue_record_sha256: sha256Canonical(item),
    queue_record: structuredClone(item),
    storyboard_binding: {
      path: storyboard.path,
      checksum_sha256: storyboard.checksum_sha256,
      narration_source_text: storyboardSourceText,
      storyboard_rebind_qa: structuredClone(item.storyboard_rebind_qa),
    },
    visual_direction_binding: {
      path: direction.review_path,
      checksum_sha256: direction.review_checksum_sha256,
      presented_map_sha256: direction.presented_map_sha256,
      row: structuredClone(direction),
    },
    visual_rhythm_binding: structuredClone(rhythm),
    selected_prompt: prompt,
    base_prompt: basePrompt,
    actual_reference_inputs: references,
    qa_evidence: qa,
    batch_manifest: batchManifest,
    ...(finalReviewAsset === null ? {} : {
      one_click_final_review: {
        contract_version: oneClickFinalReview.contract_version,
        mode: oneClickFinalReview.mode,
        presented_map_sha256: oneClickFinalReview.presented_map_sha256,
        asset_list_sha256: oneClickFinalReview.asset_list_sha256,
        exact_hash_list_approved: oneClickFinalReview.exact_hash_list_approved,
        decision_message: oneClickFinalReview.decision_message,
        decision_time: oneClickFinalReview.decision_time,
        asset: structuredClone(finalReviewAsset),
      },
    }),
    ian,
    generation_lineage: generationLineage,
    generation_lineage_file_bindings: inspectEmbeddedFileBindings({
      repositoryRoot,
      value: generationLineage,
      label: `asset ${item.asset_id} generation lineage`,
    }),
    rejected_attempts: rejectedAttempts,
    rejected_attempt_file_bindings: inspectEmbeddedFileBindings({
      repositoryRoot,
      value: rejectedAttempts,
      label: `asset ${item.asset_id} rejected attempts`,
    }),
    white_cat_generation_evidence: {
      derived_text_policy: item.white_cat_present === true && item.visual_generation_route === 'imagegen'
        ? {policy: 'text-free-v1', mode: 'none', exact_copy: null, placement: null, no_title: true}
        : null,
      pointers: whiteCatPointers,
      generation_attempt_control: structuredClone(item.white_cat_generation_attempt_control ?? null),
      imagegen_qa_failures: imagegenQaFailures,
      imagegen_qa_failure_file_bindings: inspectEmbeddedFileBindings({
        repositoryRoot,
        value: imagegenQaFailures,
        label: `asset ${item.asset_id} white-cat QA failures`,
      }),
      rule_migration: structuredClone(item.white_cat_rule_migration ?? null),
      user_takeover_source: userTakeoverSource,
      user_takeover_source_file_bindings: inspectEmbeddedFileBindings({
        repositoryRoot,
        value: userTakeoverSource,
        label: `asset ${item.asset_id} user-takeover source`,
      }),
      user_takeover_adopted_at: item.user_takeover_adopted_at ?? null,
    },
  };
};

const inspectApprovedSource = async (repositoryRoot, episodeWorkspace, item, {oneClick}) => {
  const label = `asset ${item.asset_id}`;
  if (!SUPPORTED_ROUTES.has(item.visual_generation_route)) {
    fail(`${label} uses unsupported route ${item.visual_generation_route}`);
  }
  const approved = assertChecksum(item.approved_checksum_sha256, `${label} approved checksum`);
  const checksumBindings = [
    ['checksum_sha256', item.checksum_sha256],
    ['presented_checksum_sha256', item.presented_checksum_sha256],
    ...(oneClick ? [] : [['approval_disk_checksum_sha256', item.approval_disk_checksum_sha256]]),
  ];
  for (const [field, value] of checksumBindings) {
    if (value !== approved) fail(`${label} ${field} is stale`);
  }
  const source = requireCurrentFile(
    repositoryRoot,
    item.path,
    approved,
    `${label} source`,
    {episodeWorkspace},
  );
  const metadata = await rasterMetadata(source.resolved, `${label} source`);
  if (metadata.format !== 'png') fail(`${label} source must decode as PNG`);
  const measuredDimensions = [metadata.width, metadata.height];
  if (!sameJson(measuredDimensions, item.measured_dimensions)
      || (!oneClick && !sameJson(measuredDimensions, item.approval_disk_measured_dimensions))) {
    fail(`${label} source dimensions differ from approval evidence`);
  }
  let aspect;
  if (item.visual_generation_route === 'ian-handdrawn-ppt') {
    assertExactCompositionRaster(metadata.width, metadata.height);
    aspect = {width: metadata.width, height: metadata.height, relativeAspectError: 0};
  } else {
    aspect = assertLandscape16By9(metadata.width, metadata.height);
  }
  if (typeof item.measured_aspect_ratio_relative_error === 'number'
      && Math.abs(item.measured_aspect_ratio_relative_error - aspect.relativeAspectError) > 1e-12) {
    fail(`${label} source aspect-ratio evidence is stale`);
  }
  return {source, metadata, approved, measuredDimensions, aspect};
};

const inspectProductionAsset = async ({
  repositoryRoot,
  episodeWorkspace,
  normalizationDirectory,
  item,
  reviewEvidence,
  reviewMode,
  lockedAt,
}) => {
  const oneClick = reviewMode === 'one_click_final_review_v1';
  const source = await inspectApprovedSource(repositoryRoot, episodeWorkspace, item, {oneClick});
  const decisionMessage = assertString(
    item.decision_message,
    `asset ${item.asset_id} decision_message`,
  );
  const decisionTime = assertString(item.decision_time, `asset ${item.asset_id} decision_time`);
  if (Number.isNaN(Date.parse(decisionTime))) fail(`asset ${item.asset_id} decision_time is invalid`);
  if (!oneClick && (typeof item.approval_disk_verified_at !== 'string'
      || Number.isNaN(Date.parse(item.approval_disk_verified_at)))) {
    fail(`asset ${item.asset_id} approval_disk_verified_at is invalid`);
  }
  const common = {
    asset_id: item.asset_id,
    shot_id: item.shot_id,
    role: item.role,
    state_index: item.state_index ?? 0,
    schedule_state_id: item.schedule_state_id ?? null,
    depends_on: item.depends_on ?? [],
    visual_generation_route: item.visual_generation_route,
    status: 'active',
    source: {
      path: source.source.relative,
      checksum_sha256: source.approved,
      dimensions: source.measuredDimensions,
      relative_aspect_ratio_error: source.aspect.relativeAspectError,
      decode: {
        result: 'pass',
        format: source.metadata.format,
        color_space: source.metadata.space ?? null,
        channels: source.metadata.channels ?? null,
        has_alpha: source.metadata.hasAlpha ?? false,
      },
    },
    approval: oneClick ? {
      status: 'approved',
      presented_checksum_sha256: item.presented_checksum_sha256,
      approved_checksum_sha256: item.approved_checksum_sha256,
      decision_message: decisionMessage,
      decision_time: decisionTime,
      presented_at: null,
      exact_presentation_message: null,
      strict_review: false,
      batch_qa_checksum_sha256: null,
      batch_qa_time: null,
      presented_batch_manifest_sha256: null,
      batch_manifest_sha256: null,
      current_disk_verification: {
        result: 'pass',
        basis: 'manifest-build-current-disk-recheck-bound-to-approved-exact-hash-list',
        checksum_sha256: source.approved,
        measured_dimensions: structuredClone(source.measuredDimensions),
        verified_at: lockedAt,
      },
    } : {
      status: 'approved',
      presented_checksum_sha256: item.presented_checksum_sha256,
      approved_checksum_sha256: item.approved_checksum_sha256,
      approval_disk_checksum_sha256: item.approval_disk_checksum_sha256,
      decision_message: decisionMessage,
      decision_time: decisionTime,
      presented_at: item.presented_at,
      exact_presentation_message: reviewEvidence.batch_manifest.exact_presentation_message,
      strict_review: item.strict_review === true,
      batch_qa_checksum_sha256: item.batch_qa_checksum_sha256 ?? null,
      batch_qa_time: item.batch_qa_time ?? null,
      presented_batch_manifest_sha256: item.presented_batch_manifest_sha256 ?? null,
      batch_manifest_sha256: item.batch_manifest_sha256 ?? null,
      approval_disk_measured_dimensions: structuredClone(item.approval_disk_measured_dimensions),
      approval_disk_verified_at: item.approval_disk_verified_at,
    },
    review_evidence: reviewEvidence,
  };

  if (item.visual_generation_route === 'ian-handdrawn-ppt') {
    return {
      ...common,
      production: {
        path: source.source.relative,
        checksum_sha256: source.approved,
        dimensions: source.measuredDimensions,
      },
      normalization_evidence: null,
      ian_layered_scene: {
        contract_version: 'ian-static-layered-scene-v1',
        package_manifest: structuredClone(reviewEvidence.ian.scene_package_manifest),
        package_review: structuredClone(reviewEvidence.ian.package_review),
        package: structuredClone(reviewEvidence.ian.scene_package_manifest.record),
      },
    };
  }

  const lowerAssetId = item.asset_id.toLowerCase();
  const productionRelative = `${episodeWorkspace}/assets/image/production/${lowerAssetId}-1920x1080-v1.png`;
  const evidenceRelative = `${normalizationDirectory}/${lowerAssetId}-normalization-v1.json`;
  const production = resolveEpisodeRelative(
    repositoryRoot,
    episodeWorkspace,
    productionRelative,
    `asset ${item.asset_id} production`,
  );
  const evidenceTarget = resolveEpisodeRelative(
    repositoryRoot,
    episodeWorkspace,
    evidenceRelative,
    `asset ${item.asset_id} evidence`,
  );
  assertRegularFile(production.resolved, {nonEmpty: true});
  assertRegularFile(evidenceTarget.resolved, {nonEmpty: true});
  const productionChecksum = sha256File(production.resolved);
  const evidenceChecksum = sha256File(evidenceTarget.resolved);
  const productionMetadata = await rasterMetadata(production.resolved, `asset ${item.asset_id} production`);
  assertExactCompositionRaster(productionMetadata.width, productionMetadata.height);
  const evidence = readJson(evidenceTarget.resolved);
  const sourceRaster = assertLandscape16By9(source.metadata.width, source.metadata.height);
  assertEvidenceGeometry(evidence, sourceRaster, `asset ${item.asset_id} evidence`);
  requireSameJson(evidence.source, {
    path: source.source.relative,
    checksum_sha256: source.approved,
    dimensions: source.measuredDimensions,
    relative_aspect_ratio_error: sourceRaster.relativeAspectError,
  }, `asset ${item.asset_id} evidence source`);
  requireSameJson(evidence.normalized, {
    path: production.relative,
    checksum_sha256: productionChecksum,
    dimensions: [productionMetadata.width, productionMetadata.height],
  }, `asset ${item.asset_id} evidence output`);
  const rerun = await normalizeRasterBytes(fs.readFileSync(source.source.resolved));
  const productionBytes = fs.readFileSync(production.resolved);
  if (!rerun.equals(productionBytes)) {
    fail(`asset ${item.asset_id} production raster differs from deterministic normalization rerun`);
  }

  return {
    ...common,
    production: {
      path: production.relative,
      checksum_sha256: productionChecksum,
      dimensions: [productionMetadata.width, productionMetadata.height],
    },
    normalization_evidence: {
      path: evidenceTarget.relative,
      checksum_sha256: evidenceChecksum,
      contract_version: evidence.contract_version,
      method: evidence.method,
      record: evidence,
    },
    deterministic_normalization_rerun_identical: true,
  };
};

const inspectCover = async ({repositoryRoot, episodeWorkspace, coverEvidenceRelative, state}) => {
  const evidenceTarget = resolveEpisodeRelative(
    repositoryRoot,
    episodeWorkspace,
    coverEvidenceRelative,
    'cover normalization evidence',
  );
  assertRegularFile(evidenceTarget.resolved, {nonEmpty: true});
  const evidence = readJson(evidenceTarget.resolved);
  const sourceRelative = `${episodeWorkspace}/assets/image/cover-source-v1.png`;
  const normalizedRelative = `${episodeWorkspace}/assets/image/cover-1920x1080-v1.png`;
  const archive = resolveEpisodeRelative(
    repositoryRoot,
    episodeWorkspace,
    sourceRelative,
    'cover source archive',
  );
  const normalized = resolveEpisodeRelative(
    repositoryRoot,
    episodeWorkspace,
    normalizedRelative,
    'cover production raster',
  );
  assertRegularFile(archive.resolved, {nonEmpty: true});
  assertRegularFile(normalized.resolved, {nonEmpty: true});
  const opening = assertObject(state.opening_cover, 'opening_cover');
  if (opening.contract_version !== 'cover-only-v1') fail('opening cover must use cover-only-v1');
  const externalSource = resolveExternalRegularFile(opening.source_path, 'approved external cover source');
  const sourceChecksum = sha256File(externalSource);
  const archiveChecksum = sha256File(archive.resolved);
  const normalizedChecksum = sha256File(normalized.resolved);
  const sourceMetadata = await rasterMetadata(externalSource, 'approved external cover source');
  const archiveMetadata = await rasterMetadata(archive.resolved, 'cover source archive');
  const normalizedMetadata = await rasterMetadata(normalized.resolved, 'cover production raster');
  const sourceRaster = assertLandscape16By9(sourceMetadata.width, sourceMetadata.height);
  assertLandscape16By9(archiveMetadata.width, archiveMetadata.height);
  assertExactCompositionRaster(normalizedMetadata.width, normalizedMetadata.height);
  const pixelFormat = sourceMetadata.channels === 3 ? 'rgb24'
    : sourceMetadata.channels === 4 ? 'rgba' : null;
  const relativeAspectPercent = sourceRaster.relativeAspectError * 100;
  if (opening.source_checksum_sha256 !== sourceChecksum
      || opening.size_bytes !== fs.statSync(externalSource).size
      || opening.codec !== 'png'
      || sourceMetadata.format !== 'png'
      || !['rgb24', 'rgba'].includes(opening.pixel_format)
      || opening.pixel_format !== pixelFormat
      || opening.width !== sourceMetadata.width
      || opening.height !== sourceMetadata.height
      || typeof opening.relative_aspect_ratio_error_percent !== 'number'
      || Math.abs(opening.relative_aspect_ratio_error_percent - relativeAspectPercent) > 0.0001
      || opening.regular_non_symlink_nonempty !== 'pass'
      || opening.decode_result !== 'pass'
      || opening.no_added_text !== true) {
    fail('approved external cover evidence is stale or incomplete');
  }
  if (archiveChecksum !== sourceChecksum
      || !fs.readFileSync(archive.resolved).equals(fs.readFileSync(externalSource))
      || !sameJson(
        [archiveMetadata.width, archiveMetadata.height],
        [sourceMetadata.width, sourceMetadata.height],
      )) {
    fail('episode cover archive does not preserve exact approved external bytes');
  }
  assertEvidenceGeometry(evidence, sourceRaster, 'cover normalization evidence');
  requireSameJson(evidence.source, {
    path: archive.relative,
    checksum_sha256: sourceChecksum,
    dimensions: [sourceMetadata.width, sourceMetadata.height],
    relative_aspect_ratio_error: sourceRaster.relativeAspectError,
  }, 'cover evidence source');
  requireSameJson(evidence.normalized, {
    path: normalized.relative,
    checksum_sha256: normalizedChecksum,
    dimensions: [normalizedMetadata.width, normalizedMetadata.height],
  }, 'cover evidence output');

  const storyboardReview = assertObject(state.storyboard_review, 'storyboard_review');
  if (!['approved', 'policy_authorized'].includes(storyboardReview.status)) {
    fail('storyboard review is not authorized');
  }
  const storyboard = requireCurrentFile(
    repositoryRoot,
    storyboardReview.approved_path,
    storyboardReview.approved_checksum_sha256,
    'approved storyboard',
    {episodeWorkspace},
  );
  const rerun = await normalizeRasterBytes(fs.readFileSync(externalSource));
  const normalizedBytes = fs.readFileSync(normalized.resolved);
  if (!rerun.equals(normalizedBytes)) {
    fail('cover production raster differs from deterministic normalization rerun');
  }

  return {
    contract_version: 'cover-production-v1',
    approved_external_source: {
      path: opening.source_path,
      checksum_sha256: sourceChecksum,
      size_bytes: opening.size_bytes,
      codec: opening.codec,
      pixel_format: opening.pixel_format,
      dimensions: [sourceMetadata.width, sourceMetadata.height],
      relative_aspect_ratio_error: sourceRaster.relativeAspectError,
      relative_aspect_ratio_error_percent: relativeAspectPercent,
      regular_non_symlink_nonempty: opening.regular_non_symlink_nonempty,
      decode_result: opening.decode_result,
      decode: {
        format: sourceMetadata.format,
        color_space: sourceMetadata.space ?? null,
        channels: sourceMetadata.channels ?? null,
        has_alpha: sourceMetadata.hasAlpha ?? false,
      },
    },
    episode_archive: {
      path: archive.relative,
      checksum_sha256: archiveChecksum,
      dimensions: [archiveMetadata.width, archiveMetadata.height],
      exact_bytes_equal_external_source: true,
    },
    production: {
      path: normalized.relative,
      checksum_sha256: normalizedChecksum,
      dimensions: [normalizedMetadata.width, normalizedMetadata.height],
    },
    normalization_evidence: {
      path: evidenceTarget.relative,
      checksum_sha256: sha256File(evidenceTarget.resolved),
      contract_version: evidence.contract_version,
      method: evidence.method,
      record: evidence,
    },
    deterministic_rerun_identical: true,
    no_added_text: true,
    approved_storyboard_binding: {
      path: storyboard.relative,
      checksum_sha256: storyboardReview.approved_checksum_sha256,
      decision_message: storyboardReview.exact_decision_message,
      decided_at: storyboardReview.decided_at,
    },
  };
};

const buildScenes = ({
  queue,
  assets,
  directionAuthority,
  rhythmAuthority,
  scheduleSet,
  storyboardSourceTexts,
  expectedDirectionStatus,
}) => {
  const direction = directionAuthority.value;
  const rhythm = rhythmAuthority.value;
  const queueByShot = new Map();
  for (const item of queue) {
    const shotItems = queueByShot.get(item.shot_id) ?? [];
    shotItems.push(item);
    queueByShot.set(item.shot_id, shotItems);
  }
  const assetById = new Map(assets.map((asset) => [asset.asset_id, asset]));
  const directionByShot = new Map(direction.rows.map((row) => [row.shot_id, row]));
  const rhythmByShot = new Map(rhythm.shots.map((shot) => [shot.shot_id, shot]));
  const scheduleByShot = new Map(scheduleSet.schedules.map((schedule) => [schedule.shot_id, schedule]));
  const shotIds = rhythm.shots.map((shot) => shot.shot_id);
  const storyboardShotIds = [...storyboardSourceTexts.keys()].filter((shotId) => shotId !== 'OPEN-00');
  if (shotIds.length === 0 || new Set(shotIds).size !== shotIds.length
      || queueByShot.size !== shotIds.length || directionByShot.size !== shotIds.length
      || direction.rows.length !== shotIds.length
      || !sameJson(storyboardShotIds, shotIds)) {
    fail('shot coverage differs across queue, direction review, and visual rhythm');
  }
  shotIds.forEach((shotId, index) => {
    if (direction.rows[index]?.shot_id !== shotId) fail('direction and rhythm shot order differ');
    if (!storyboardSourceTexts.has(shotId)) fail(`storyboard lacks source_text for ${shotId}`);
    if (index > 0 && rhythm.shots[index - 1].end_frame !== rhythm.shots[index].start_frame) {
      fail(`visual rhythm is not frame-contiguous at ${shotId}`);
    }
  });
  const scheduledRhythmIds = rhythm.shots.filter((shot) => (
    shot.motion_tier === 'stateful' || shot.motion_tier === 'hero_pose'
  )).map((shot) => shot.shot_id);
  if (!sameJson([...scheduleByShot.keys()], scheduledRhythmIds)) {
    fail('action-state schedule set does not exactly cover stateful and hero-pose shots');
  }

  const allIntraShotTransitions = [];
  const scenes = shotIds.map((shotId) => {
    const row = directionByShot.get(shotId);
    const rhythmShot = rhythmByShot.get(shotId);
    const selected = row?.user_selection;
    const shotQueue = queueByShot.get(shotId);
    if (!row || !rhythmShot || !Array.isArray(shotQueue) || shotQueue.length === 0
        || selected?.status !== expectedDirectionStatus) {
      fail(`shot ${shotId} is missing authorized direction, rhythm, or assets`);
    }
    shotQueue.sort((left, right) => (left.state_index ?? 0) - (right.state_index ?? 0));
    const stateIndexes = shotQueue.map((item) => item.state_index ?? 0);
    requireSameJson(stateIndexes, stateIndexes.map((_, index) => index), `shot ${shotId} state indexes`);
    for (const item of shotQueue) {
      if (item.scene_class !== row.scene_class
          || item.visual_generation_route !== selected.visual_generation_route
          || item.visual_structure_id !== selected.visual_structure_id
          || item.treatment_profile_id !== selected.treatment_profile_id
          || item.white_cat_present !== selected.white_cat_present
          || item.visible_text_mode !== selected.visible_text_mode
          || item.exact_visible_text !== selected.exact_visible_text
          || item.visible_text_placement !== selected.visible_text_placement
          || item.shot_start_frame !== rhythmShot.start_frame
          || item.shot_end_frame !== rhythmShot.end_frame
          || item.narration_source_text !== storyboardSourceTexts.get(shotId)) {
        fail(`shot ${shotId} queue item ${item.asset_id} conflicts with approved direction or rhythm`);
      }
    }
    const imageSequence = shotQueue.map((item) => {
      const asset = assetById.get(item.asset_id);
      if (!asset) fail(`shot ${shotId} is missing production asset ${item.asset_id}`);
      return {
        asset_id: asset.asset_id,
        role: asset.role,
        state_index: asset.state_index,
        schedule_state_id: asset.schedule_state_id,
        production_path: asset.production.path,
        production_checksum_sha256: asset.production.checksum_sha256,
      };
    });

    const scheduleRecord = scheduleByShot.get(shotId) ?? null;
    let actionStateSchedule = null;
    let intraShotTransitions = [];
    if (scheduleRecord) {
      const expectedScheduleVersion = rhythmAuthority.value.contract_version === 'storyboard-visual-rhythm-v2'
        ? 'action-state-schedule-v4'
        : 'action-state-schedule-v3';
      if (scheduleRecord.schedule?.contract_version !== expectedScheduleVersion) {
        fail(`shot ${shotId} action-state schedule is not a validated ${expectedScheduleVersion} schedule`);
      }
      const schedule = scheduleRecord.schedule;
      const shotFrames = rhythmShot.end_frame - rhythmShot.start_frame;
      const validation = validateActionStateSchedule(schedule, {
        totalFrames: shotFrames,
        fps: 30,
        densityMode: expectedScheduleVersion === 'action-state-schedule-v4'
          ? rhythmAuthority.value.density_mode
          : null,
        densitySelectionSha256: expectedScheduleVersion === 'action-state-schedule-v4'
          ? rhythmAuthority.value.visual_density_selection_sha256
          : null,
      });
      requireSameJson(scheduleRecord.validation, validation, `shot ${shotId} schedule validation`);
      const statePlanSha256 = buildActionStatePlanSha256(schedule);
      const expectedCount = rhythmShot.motion_tier === 'stateful'
        ? rhythmShot.asset_plan.main_image_count
        : rhythmShot.asset_plan.pose_count;
      if (scheduleRecord.shot_start_frame !== rhythmShot.start_frame
          || scheduleRecord.shot_end_frame !== rhythmShot.end_frame
          || schedule.occurrences.length !== imageSequence.length
          || schedule.state_count_total !== imageSequence.length
          || schedule.state_count_total !== expectedCount
          || schedule.total_frames !== shotFrames
          || schedule.fps !== 30
          || schedule.source_text !== storyboardSourceTexts.get(shotId)
          || schedule.motion_tier !== rhythmShot.motion_tier
          || scheduleRecord.state_plan_sha256 !== statePlanSha256) {
        fail(`shot ${shotId} action-state schedule does not match scene assets`);
      }
      const scheduleTransitionProjection = schedule.intra_shot_transitions.map((transition) => ({
        from_asset_id: transition.from_asset_id,
        to_asset_id: transition.to_asset_id,
        kind: transition.kind,
      }));
      requireSameJson(
        scheduleTransitionProjection,
        rhythmShot.intra_shot_transition_plan,
        `shot ${shotId} schedule/rhythm transition plan`,
      );
      const occurrences = schedule.occurrences.map((occurrence, index) => {
        const item = shotQueue[index];
        if (occurrence.state_index !== index
            || occurrence.state_id !== item.schedule_state_id
            || item.motion_tier !== schedule.motion_tier
            || item.action_state_schedule_contract_version !== schedule.contract_version
            || item.action_state_plan_sha256 !== statePlanSha256
            || item.semantic_state !== occurrence.semantic_state) {
          fail(`shot ${shotId} occurrence ${index} does not bind the approved asset state`);
        }
        return {...occurrence, asset_id: item.asset_id};
      });
      intraShotTransitions = schedule.intra_shot_transitions.map((transition, index) => {
        const from = shotQueue[index];
        const to = shotQueue[index + 1];
        const bound = {
          ...transition,
          schedule_contract_version: schedule.contract_version,
          planned_from_state_id: transition.from_asset_id,
          planned_to_state_id: transition.to_asset_id,
          from_asset_id: from.asset_id,
          to_asset_id: to.asset_id,
        };
        allIntraShotTransitions.push({shot_id: shotId, ...bound});
        return bound;
      });
      actionStateSchedule = {
        ...structuredClone(schedule),
        state_plan_sha256: statePlanSha256,
        shot_start_frame: scheduleRecord.shot_start_frame,
        shot_end_frame: scheduleRecord.shot_end_frame,
        validation,
        occurrence_asset_bindings: occurrences,
      };
    } else if (imageSequence.length !== 1
        || rhythmShot.motion_tier !== 'layered'
        || rhythmShot.intra_shot_transition_plan.length !== 0) {
      fail(`shot ${shotId} has multiple assets without a validated v3 action-state schedule`);
    }

    let ianLayeredScene = null;
    if (selected.visual_generation_route === 'ian-handdrawn-ppt') {
      const productionAsset = assetById.get(shotQueue[0].asset_id);
      if (imageSequence.length !== 1
          || productionAsset?.ian_layered_scene?.contract_version
            !== 'ian-static-layered-scene-v1') {
        fail(`shot ${shotId} lacks one validated Ian layered-scene package`);
      }
      ianLayeredScene = structuredClone(productionAsset.ian_layered_scene);
    } else if (shotQueue.some((item) => assetById.get(item.asset_id)?.ian_layered_scene != null)) {
      fail(`shot ${shotId} non-Ian route carries an Ian layered-scene package`);
    }

    return {
      shot_id: shotId,
      scene_class: row.scene_class,
      narration_source_text: storyboardSourceTexts.get(shotId),
      visual_direction: {
        review_path: directionAuthority.path,
        review_checksum_sha256: directionAuthority.checksum_sha256,
        catalog_version: direction.catalog_version,
        catalog_checksum_sha256: direction.catalog_checksum_sha256,
        visual_language_catalog_version: direction.visual_language_catalog_version,
        visual_language_catalog_checksum_sha256: direction.visual_language_catalog_checksum_sha256,
        presented_map_sha256: direction.presented_map_sha256,
        row: structuredClone(row),
        user_selection: structuredClone(selected),
      },
      visual_rhythm: {
        artifact_path: rhythmAuthority.path,
        artifact_checksum_sha256: rhythmAuthority.checksum_sha256,
        presented_map_sha256: rhythm.presented_map_sha256,
        row: structuredClone(rhythmShot),
      },
      image_sequence: imageSequence,
      ian_layered_scene: ianLayeredScene,
      action_state_schedule: actionStateSchedule,
      intra_shot_transitions: intraShotTransitions,
    };
  });
  return {scenes, allIntraShotTransitions};
};

const inspectSceneTransitions = (review, scenes, {oneClick, policySha256}) => {
  const shotIds = scenes.map((scene) => scene.shot_id);
  const presentedMapSha256 = buildTransitionReviewPresentedMapSha256(review);
  const expectedStatus = oneClick ? 'policy_authorized' : 'approved';
  if (review.contract_version !== 'per-boundary-transition-review-v1'
      || review.status !== expectedStatus
      || review.catalog_version !== 'scene-transition-catalog-v3'
      || review.fps !== 30
      || review.presented_map_sha256 !== presentedMapSha256) {
    fail(oneClick
      ? 'scene transition review is not an authorized v3 review'
      : 'scene transition review is not an approved v3 review');
  }
  let authorizedAt = null;
  if (oneClick) {
    if (review.approval !== undefined && review.approval !== null) {
      fail('scene transition policy authorization fabricates concrete review');
    }
    authorizedAt = assertPolicyMapAuthorization(review.policy_authorization, {
      label: 'scene transition review',
      policySha256,
      presentedMapSha256,
    });
  } else if (review.approval?.presented_map_sha256 !== review.presented_map_sha256
      || typeof review.approval?.exact_message !== 'string'
      || typeof review.approval?.decided_at !== 'string'
      || Number.isNaN(Date.parse(review.approval.decided_at))) {
    fail('scene transition review is not an approved v3 review');
  }
  const rows = assertArray(review.rows, 'scene transition review rows');
  if (rows.length !== Math.max(0, shotIds.length - 1)
      || review.ordinary_boundary_count !== rows.length) {
    fail('scene transition review has incomplete ordinary-boundary coverage');
  }
  rows.forEach((row, index) => {
    if (row.source_shot_id !== shotIds[index]
        || row.next_shot_id !== shotIds[index + 1]
        || row.user_selection?.presented_map_sha256 !== review.presented_map_sha256) {
      fail(`scene transition boundary ${index} is stale, unapproved, or incomplete`);
    }
    if (oneClick) {
      assertPolicySelection(row.user_selection, {
        label: `scene transition ${row.source_shot_id}->${row.next_shot_id}`,
        policySha256,
        presentedMapSha256,
        authorizedAt,
      });
    }
    validateUserApprovedTransition(row, {
      fps: review.fps,
      sourceShotId: row.source_shot_id,
      nextShotId: row.next_shot_id,
    });
    const source = scenes[index].visual_direction.user_selection;
    const next = scenes[index + 1].visual_direction.user_selection;
    if (row.source_visual_generation_route !== source.visual_generation_route
        || row.next_visual_generation_route !== next.visual_generation_route
        || row.source_white_cat_present !== source.white_cat_present
        || row.next_white_cat_present !== next.white_cat_present) {
      fail(`scene transition ${row.source_shot_id}->${row.next_shot_id} route context is stale`);
    }
  });
  return rows.map((row) => structuredClone(row));
};

const loadBuildContext = async ({
  episodeWorkspace,
  repositoryRoot = REPOSITORY_ROOT,
  manifestRelative,
  coverEvidenceRelative,
  normalizationDirectory,
  lockedAt,
  allowedPhases = VISUAL_BUILD_PHASES,
}) => {
  const workspace = normalizeRootRelative(episodeWorkspace, 'episode workspace');
  resolveRootRelative(repositoryRoot, workspace, 'episode workspace');
  const defaults = defaultPaths(workspace);
  const stateTarget = resolveEpisodeRelative(
    repositoryRoot,
    workspace,
    defaults.state,
    'episode state',
  );
  assertRegularFile(stateTarget.resolved, {nonEmpty: true});
  const stateChecksum = sha256File(stateTarget.resolved);
  const state = readJson(stateTarget.resolved);
  if (state.workspace_path && state.workspace_path !== workspace) fail('episode state workspace_path mismatch');
  const oneClickCaptionBuild = state.current_phase === 'awaiting_caption_delivery_choice'
    && (state.phase ?? state.current_phase) === 'awaiting_caption_delivery_choice'
    && state.visual_asset_review?.mode === 'one_click_final_review_v1'
    && state.visual_asset_review?.final_review?.status === 'approved';
  if ((!allowedPhases.includes(state.current_phase) || !allowedPhases.includes(state.phase ?? state.current_phase))
      && !oneClickCaptionBuild) {
    fail(`episode phase does not permit visual manifest operation: ${state.current_phase ?? 'missing'}`);
  }
  if (!ISO_INSTANT.test(lockedAt) || Number.isNaN(Date.parse(lockedAt))) {
    fail('locked_at must be an ISO-8601 instant with timezone');
  }
  const manifest = normalizeRootRelative(manifestRelative ?? defaults.manifest, 'visual manifest path');
  resolveEpisodeRelative(
    repositoryRoot,
    workspace,
    manifest,
    'visual manifest path',
    {allowMissingFinal: true},
  );
  const coverEvidence = normalizeRootRelative(
    coverEvidenceRelative ?? defaults.coverEvidence,
    'cover evidence path',
  );
  const normalizations = normalizeRootRelative(
    normalizationDirectory ?? defaults.normalizationDirectory,
    'normalization directory',
  );
  resolveEpisodeRelative(
    repositoryRoot,
    workspace,
    coverEvidence,
    'cover evidence path',
  );
  resolveEpisodeRelative(
    repositoryRoot,
    workspace,
    normalizations,
    'normalization directory',
  );
  const {review, queue, oneClickFinalReview} = assertReviewReady(state);
  const oneClick = review.mode === 'one_click_final_review_v1';
  const policySha256 = oneClick
    ? assertChecksum(review.policy_sha256, 'one-click visual review policy_sha256')
    : null;
  if (oneClick && (state.workflow_approval_mode?.approval_mode !== 'one_click'
      || state.one_click_approval_policy?.policy_sha256 !== policySha256
      || review.storyboard_sha256 !== state.active_storyboard?.checksum_sha256)) {
    fail('one-click final visual review authority binding is stale');
  }

  const storyboard = requireCurrentFile(
    repositoryRoot,
    state.active_storyboard?.path,
    state.active_storyboard?.checksum_sha256,
    'active storyboard',
    {episodeWorkspace: workspace},
  );
  const expectedStoryboardStatus = oneClick ? 'policy_authorized' : 'approved';
  if (state.active_storyboard?.status !== expectedStoryboardStatus
      || state.storyboard_review?.status !== expectedStoryboardStatus
      || state.storyboard_review?.approved_path !== storyboard.relative
      || state.storyboard_review?.approved_checksum_sha256 !== state.active_storyboard.checksum_sha256) {
    fail('active storyboard and Storyboard Review authorization are not identical');
  }
  if (state.storyboard_review.presented_path !== storyboard.relative
      || state.storyboard_review.presented_checksum_sha256 !== state.active_storyboard.checksum_sha256
      || (oneClick
        ? (!SHA256.test(state.storyboard_review.policy_sha256 ?? '')
          || state.storyboard_review.user_has_reviewed_specific_storyboard !== false)
        : (typeof state.storyboard_review.exact_decision_message !== 'string'
          || typeof state.storyboard_review.decided_at !== 'string'
          || Number.isNaN(Date.parse(state.storyboard_review.decided_at))))) {
    fail('Storyboard Review exact-byte authorization evidence is stale');
  }
  const sourceDraft = requireCurrentFile(
    repositoryRoot,
    state.active_storyboard.source_draft_path,
    state.active_storyboard.source_draft_checksum_sha256,
    'source storyboard draft',
    {episodeWorkspace: workspace},
  );
  const storyboardSourceTexts = parseStoryboardSourceTexts(fs.readFileSync(storyboard.resolved, 'utf8'));
  const direction = inspectAuthority(
    repositoryRoot,
    workspace,
    state.visual_direction_review,
    'visual direction review',
    'per-shot-visual-direction-review-v3',
  );
  const expectedMappingStatus = oneClick ? 'policy_authorized' : 'approved';
  if (state.visual_direction_review.status !== expectedMappingStatus
      || direction.value.status !== expectedMappingStatus
      || state.visual_direction_review.presented_map_sha256 !== direction.value.presented_map_sha256) {
    fail('visual direction review is not authorized');
  }
  if (oneClick) {
    if (direction.value.approval !== undefined && direction.value.approval !== null) {
      fail('visual direction policy authorization fabricates concrete review');
    }
    const directionAuthorizedAt = assertPolicyMapAuthorization(
      direction.value.policy_authorization,
      {
        label: 'visual direction review',
        policySha256,
        presentedMapSha256: direction.value.presented_map_sha256,
      },
    );
    if (state.visual_direction_review.policy_sha256 !== policySha256
        || state.visual_direction_review.user_has_reviewed_specific_map !== false) {
      fail('visual direction state policy authorization is incomplete, stale, or fabricates concrete review');
    }
    direction.value.rows.forEach((row) => assertPolicySelection(row.user_selection, {
      label: `visual direction ${row.shot_id}`,
      policySha256,
      presentedMapSha256: direction.value.presented_map_sha256,
      authorizedAt: directionAuthorizedAt,
    }));
  }
  const rhythm = inspectAuthority(
    repositoryRoot,
    workspace,
    state.storyboard_visual_rhythm,
    'storyboard visual rhythm',
    ['storyboard-visual-rhythm-v1', 'storyboard-visual-rhythm-v2'],
  );
  if (state.storyboard_visual_rhythm.status !== expectedMappingStatus
      || rhythm.value.status !== expectedMappingStatus) {
    fail('storyboard visual rhythm is not authorized');
  }
  const directionShotIds = direction.value.rows?.map((row) => row.shot_id);
  const rhythmValidation = validateStoryboardVisualRhythm(rhythm.value, {shotIds: directionShotIds});
  const rhythmMapSha256 = buildStoryboardVisualRhythmMapSha256(rhythm.value);
  const rhythmAuthorization = oneClick
    ? state.storyboard_visual_rhythm.policy_authorization
    : state.storyboard_visual_rhythm.approval;
  if (oneClick) {
    if (rhythm.value.approval !== undefined && rhythm.value.approval !== null) {
      fail('storyboard visual rhythm policy authorization fabricates concrete review');
    }
    const rhythmAuthorizedAt = assertPolicyMapAuthorization(
      rhythm.value.policy_authorization,
      {
        label: 'storyboard visual rhythm',
        policySha256,
        presentedMapSha256: rhythmMapSha256,
        deterministicRequired: true,
      },
    );
    assertPolicyMapAuthorization(rhythmAuthorization, {
      label: 'storyboard visual rhythm state',
      policySha256,
      presentedMapSha256: rhythmMapSha256,
      authorizedAt: rhythmAuthorizedAt,
      deterministicRequired: true,
    });
  }
  if (state.storyboard_visual_rhythm.presented_map_sha256 !== rhythmMapSha256
      || rhythmAuthorization?.presented_map_sha256 !== rhythmMapSha256
      || direction.value.storyboard?.path !== sourceDraft.relative
      || direction.value.storyboard?.checksum_sha256 !== state.active_storyboard.source_draft_checksum_sha256
      || rhythm.value.storyboard?.path !== sourceDraft.relative
      || rhythm.value.storyboard?.checksum_sha256 !== state.active_storyboard.source_draft_checksum_sha256
      || rhythm.value.visual_direction_review?.path !== direction.path
      || rhythm.value.visual_direction_review?.checksum_sha256 !== direction.checksum_sha256) {
    fail('visual direction/rhythm source-draft authority binding is stale');
  }
  const schedulePointer = {
    path: state.storyboard_visual_rhythm.action_state_schedule_set_path,
    checksum_sha256: state.storyboard_visual_rhythm.action_state_schedule_set_checksum_sha256,
  };
  const schedules = inspectAuthority(
    repositoryRoot,
    workspace,
    schedulePointer,
    'action-state schedule set',
    'action-state-schedule-set-v1',
  );
  if (schedules.value.schedule_count !== schedules.value.schedules?.length
      || schedules.value.qa?.all_schedules_validated !== true
      || schedules.value.qa?.exact_utf8_coverage !== true
      || schedules.value.qa?.complete_frame_coverage !== true) {
    fail('action-state schedule set QA is incomplete');
  }
  if (schedules.value.storyboard?.path !== sourceDraft.relative
      || schedules.value.storyboard?.checksum_sha256 !== state.active_storyboard.source_draft_checksum_sha256
      || schedules.value.visual_rhythm?.path !== rhythm.path
      || schedules.value.visual_rhythm?.checksum_sha256 !== rhythm.checksum_sha256) {
    fail('action-state schedule set authority binding is stale');
  }
  const transitions = inspectAuthority(
    repositoryRoot,
    workspace,
    state.transition_review,
    'scene transition review',
    'per-boundary-transition-review-v1',
  );
  if (state.transition_review.status !== expectedMappingStatus
      || state.transition_review.presented_map_sha256 !== transitions.value.presented_map_sha256
      || state.transition_review.ordinary_boundary_count !== transitions.value.rows?.length) {
    fail('scene transition review is not authorized');
  }
  if (oneClick && (state.transition_review.policy_sha256 !== policySha256
      || state.transition_review.user_has_reviewed_specific_map !== false)) {
    fail('scene transition state policy authorization is incomplete, stale, or fabricates concrete review');
  }
  if (transitions.value.storyboard?.path !== sourceDraft.relative
      || transitions.value.storyboard?.checksum_sha256 !== state.active_storyboard.source_draft_checksum_sha256
      || transitions.value.visual_direction_review?.path !== direction.path
      || transitions.value.visual_direction_review?.checksum_sha256 !== direction.checksum_sha256) {
    fail('scene transition review authority binding is stale');
  }
  const strictTransitionValidation = path.resolve(repositoryRoot) === REPOSITORY_ROOT
    ? validateEpisodeTransitionReviewProposal(workspace)
    : null;
  const narration = requireCurrentFile(
    repositoryRoot,
    state.narration_audio?.archive_path,
    state.narration_audio?.checksum_sha256,
    'narration master',
    {episodeWorkspace: workspace},
  );

  const batchIndex = oneClick ? new Map() : buildBatchManifestIndex({
    repositoryRoot,
    episodeWorkspace: workspace,
    storyboard: {
      path: storyboard.relative,
      checksum_sha256: state.active_storyboard.checksum_sha256,
    },
  });
  const activeBatchManifestChecksums = [...new Set(queue
    .map((item) => item.batch_manifest_sha256 ?? null)
    .filter((checksum) => checksum !== null))].sort();
  const directionByShot = new Map(direction.value.rows.map((row) => [row.shot_id, row]));
  const rhythmByShot = new Map(rhythm.value.shots.map((shot) => [shot.shot_id, shot]));
  const assets = [];
  for (const item of queue) {
    const directionRow = directionByShot.get(item.shot_id);
    const rhythmRow = rhythmByShot.get(item.shot_id);
    if (!directionRow || !rhythmRow) fail(`asset ${item.asset_id} has no direction/rhythm row`);
    const reviewEvidence = await inspectQueueEvidence({
      repositoryRoot,
      episodeWorkspace: workspace,
      item,
      storyboard: {
        path: storyboard.relative,
        checksum_sha256: state.active_storyboard.checksum_sha256,
      },
      storyboardSourceText: storyboardSourceTexts.get(item.shot_id),
      direction: {
        ...directionRow,
        review_path: direction.path,
        review_checksum_sha256: direction.checksum_sha256,
        presented_map_sha256: direction.value.presented_map_sha256,
      },
      rhythm: rhythmRow,
      batchIndex,
      reviewMode: review.mode,
      oneClickFinalReview,
    });
    assets.push(await inspectProductionAsset({
      repositoryRoot,
      episodeWorkspace: workspace,
      normalizationDirectory: normalizations,
      item,
      reviewEvidence,
      reviewMode: review.mode,
      lockedAt,
    }));
  }
  const cover = await inspectCover({
    repositoryRoot,
    episodeWorkspace: workspace,
    coverEvidenceRelative: coverEvidence,
    state,
  });
  const {scenes, allIntraShotTransitions} = buildScenes({
    queue,
    assets,
    directionAuthority: direction,
    rhythmAuthority: rhythm,
    scheduleSet: schedules.value,
    storyboardSourceTexts,
    expectedDirectionStatus: expectedMappingStatus,
  });
  const sceneTransitions = inspectSceneTransitions(
    transitions.value,
    scenes,
    {oneClick, policySha256},
  );
  const approvalLock = sourceApprovalLock(review, queue);

  const value = {
    contract_version: VISUAL_MANIFEST_CONTRACT,
    result: 'pass',
    episode_workspace: workspace,
    locked_at: lockedAt,
    canvas: {aspect: '16:9', width: 1920, height: 1080, fps: 30, orientation: 'landscape'},
    provenance: {
      episode_state_path: stateTarget.relative,
      approved_storyboard: {
        path: storyboard.relative,
        checksum_sha256: state.active_storyboard.checksum_sha256,
        ...(oneClick ? {
          policy_sha256: state.active_storyboard.policy_sha256,
          authorized_at: state.active_storyboard.authorized_at,
          user_has_reviewed_specific_storyboard: false,
        } : {
          approved_at: state.active_storyboard.approved_at,
          exact_approval_message: state.active_storyboard.exact_approval_message,
        }),
        storyboard_review: structuredClone(state.storyboard_review),
      },
      source_storyboard_draft: {
        path: sourceDraft.relative,
        checksum_sha256: state.active_storyboard.source_draft_checksum_sha256,
        relationship: 'original-direction-rhythm-transition-authority-before-final-storyboard-rebind',
      },
      visual_direction_review: {
        path: direction.path,
        checksum_sha256: direction.checksum_sha256,
        presented_map_sha256: direction.value.presented_map_sha256,
        catalog_version: direction.value.catalog_version,
        catalog_checksum_sha256: direction.value.catalog_checksum_sha256,
        visual_language_catalog_version: direction.value.visual_language_catalog_version,
        visual_language_catalog_checksum_sha256: direction.value.visual_language_catalog_checksum_sha256,
        ...(oneClick
          ? {authorization: structuredClone(direction.value.policy_authorization)}
          : {approval: structuredClone(direction.value.approval)}),
      },
      storyboard_visual_rhythm: {
        path: rhythm.path,
        checksum_sha256: rhythm.checksum_sha256,
        presented_map_sha256: rhythm.value.presented_map_sha256,
        validation: rhythmValidation,
        ...(oneClick
          ? {authorization: structuredClone(rhythm.value.policy_authorization)}
          : {approval: structuredClone(rhythm.value.approval)}),
      },
      action_state_schedule_set: {
        path: schedules.path,
        checksum_sha256: schedules.checksum_sha256,
        qa: structuredClone(schedules.value.qa),
      },
      scene_transition_review: {
        path: transitions.path,
        checksum_sha256: transitions.checksum_sha256,
        presented_map_sha256: transitions.value.presented_map_sha256,
        catalog_version: transitions.value.catalog_version,
        ...(oneClick
          ? {authorization: structuredClone(transitions.value.policy_authorization)}
          : {approval: structuredClone(transitions.value.approval)}),
        strict_episode_validator: strictTransitionValidation ?? {
          contract_version: 'per-boundary-transition-review-validation-v1',
          result: 'pass-equivalent-for-injected-repository-root',
          ordinary_boundary_count: sceneTransitions.length,
          presented_map_sha256: transitions.value.presented_map_sha256,
        },
      },
      narration_master: {
        path: narration.relative,
        checksum_sha256: state.narration_audio.checksum_sha256,
        duration_seconds: state.narration_audio.duration_seconds,
      },
    },
    approval_lock: approvalLock,
    cover,
    counts: {
      scene_count: scenes.length,
      active_asset_count: assets.length,
      intra_shot_transition_count: allIntraShotTransitions.length,
      ordinary_scene_transition_count: sceneTransitions.length,
      visual_batch_manifest_count: activeBatchManifestChecksums.length,
    },
    scenes,
    assets,
    intra_shot_transitions: allIntraShotTransitions,
    scene_transitions: sceneTransitions,
  };
  return {
    value,
    state,
    stateChecksum,
    statePath: stateTarget.resolved,
    manifestRelative: manifest,
    manifestPath: resolveEpisodeRelative(
      repositoryRoot,
      workspace,
      manifest,
      'visual manifest',
      {allowMissingFinal: true},
    ).resolved,
    repositoryRoot: path.resolve(repositoryRoot),
  };
};

export const buildVisualAssetsManifest = async (options) => (
  await loadBuildContext(options)
).value;

const assertLockedStateBindings = ({context, manifest, manifestChecksum}) => {
  const {state} = context;
  const declaredPhase = state.phase ?? state.current_phase;
  if (state.current_phase === 'visual_production' && declaredPhase === 'visual_production') return;
  const oneClickCaptionPrelock = state.current_phase === 'awaiting_caption_delivery_choice'
    && declaredPhase === 'awaiting_caption_delivery_choice'
    && state.visual_asset_review?.mode === 'one_click_final_review_v1'
    && state.visual_asset_review?.final_review?.status === 'approved'
    && state.visual_asset_review?.status !== 'locked'
    && (state.active_visual_manifest === undefined || state.active_visual_manifest === null)
    && (state.visual_assets_lock === undefined || state.visual_assets_lock === null);
  if (oneClickCaptionPrelock) return;
  if (state.current_phase !== declaredPhase) {
    fail('locked episode phase/current_phase disagree');
  }
  const active = state.active_visual_manifest;
  if (active?.status !== 'active_locked'
      || active.path !== context.manifestRelative
      || active.checksum_sha256 !== manifestChecksum
      || active.active_asset_count !== manifest.counts.active_asset_count) {
    fail('active_visual_manifest does not bind the current manifest bytes');
  }
  const expectedLock = manifest.approval_lock;
  const stateLock = state.visual_assets_lock;
  for (const key of [
    'contract_version', 'mode', 'assets', 'active_asset_count', 'verification_sha256', 'result',
  ]) {
    requireSameJson(stateLock?.[key], expectedLock[key], `visual_assets_lock.${key}`);
  }
  if (stateLock.manifest_path !== context.manifestRelative
      || stateLock.manifest_checksum_sha256 !== manifestChecksum) {
    fail('visual_assets_lock manifest binding is stale');
  }
  if (state.visual_asset_review?.status !== 'locked' || !Array.isArray(state.blockers)
      || state.blockers.length !== 0) {
    fail('locked visual state is incomplete');
  }
};

export const validateVisualAssetsManifest = async ({
  episodeWorkspace,
  repositoryRoot = REPOSITORY_ROOT,
  manifestRelative,
  coverEvidenceRelative,
  normalizationDirectory,
}) => {
  const workspace = normalizeRootRelative(episodeWorkspace, 'episode workspace');
  const selectedManifest = normalizeRootRelative(
    manifestRelative ?? defaultPaths(workspace).manifest,
    'visual manifest path',
  );
  const manifestTarget = resolveEpisodeRelative(
    repositoryRoot,
    workspace,
    selectedManifest,
    'visual manifest',
  );
  assertRegularFile(manifestTarget.resolved, {nonEmpty: true});
  const manifest = readJson(manifestTarget.resolved);
  if (manifest.contract_version !== VISUAL_MANIFEST_CONTRACT
      || manifest.result !== 'pass') {
    fail('visual manifest is not a passing visual-assets-manifest-v1');
  }
  const context = await loadBuildContext({
    episodeWorkspace: workspace,
    repositoryRoot,
    manifestRelative: selectedManifest,
    coverEvidenceRelative,
    normalizationDirectory,
    lockedAt: manifest.locked_at,
    allowedPhases: VISUAL_VALIDATION_PHASES,
  });
  requireSameJson(manifest, context.value, 'visual manifest');
  const manifestChecksum = sha256File(manifestTarget.resolved);
  assertLockedStateBindings({context, manifest, manifestChecksum});
  return {
    contract_version: 'visual-assets-manifest-validation-v1',
    result: 'pass',
    manifest_path: selectedManifest,
    manifest_checksum_sha256: manifestChecksum,
    active_asset_count: manifest.counts.active_asset_count,
    scene_count: manifest.counts.scene_count,
    intra_shot_transition_count: manifest.counts.intra_shot_transition_count,
    ordinary_scene_transition_count: manifest.counts.ordinary_scene_transition_count,
    cover_deterministic_rerun_identical: manifest.cover.deterministic_rerun_identical,
  };
};

const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

const writeTemporaryExclusive = (target, bytes) => {
  const temporary = `${target}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    return temporary;
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    throw error;
  }
};

const writeNewManifest = (manifestPath, value) => {
  const bytes = jsonBytes(value);
  const temporary = writeTemporaryExclusive(manifestPath, bytes);
  try {
    fs.linkSync(temporary, manifestPath);
  } catch (error) {
    fs.unlinkSync(temporary);
    if (error?.code === 'EEXIST') fail(`refusing to overwrite existing manifest: ${manifestPath}`);
    throw error;
  }
  fs.unlinkSync(temporary);
  const status = fs.lstatSync(manifestPath);
  return {
    checksum_sha256: sha256Bytes(bytes),
    device: status.dev,
    inode: status.ino,
  };
};

const atomicReplaceIfChecksum = (target, expectedChecksum, bytes, label) => {
  const temporary = writeTemporaryExclusive(target, bytes);
  try {
    if (sha256File(target) !== expectedChecksum) fail(`${label} changed during transaction`);
    fs.renameSync(temporary, target);
  } catch (error) {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    throw error;
  }
};

const removeOwnedFile = (target, ownership) => {
  if (!ownership || !fs.existsSync(target)) return;
  const status = fs.lstatSync(target);
  if (status.isSymbolicLink() || !status.isFile()
      || status.dev !== ownership.device || status.ino !== ownership.inode
      || sha256File(target) !== ownership.checksum_sha256) {
    fail(`refusing rollback of changed or replaced file: ${target}`);
  }
  fs.unlinkSync(target);
};

const acquireEpisodeLock = (repositoryRoot, episodeWorkspace) => {
  const target = resolveEpisodeRelative(
    repositoryRoot,
    episodeWorkspace,
    `${episodeWorkspace}/schema/${VISUAL_LOCK_FILE}`,
    'visual finalizer transaction lock',
    {allowMissingFinal: true},
  );
  let descriptor;
  let ownership = null;
  try {
    descriptor = fs.openSync(target.resolved, 'wx', 0o600);
    const opened = fs.fstatSync(descriptor);
    ownership = {device: opened.dev, inode: opened.ino};
    fs.writeFileSync(descriptor, `${process.pid}\n`);
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (error?.code === 'EEXIST') fail('another visual finalizer transaction is active');
    if (ownership && fs.existsSync(target.resolved)) {
      const current = fs.lstatSync(target.resolved);
      if (current.isSymbolicLink() || !current.isFile()
          || current.dev !== ownership.device || current.ino !== ownership.inode) {
        fail('visual finalizer transaction lock was replaced during initialization');
      }
      fs.unlinkSync(target.resolved);
    }
    throw error;
  }
  const status = fs.fstatSync(descriptor);
  return {
    path: target.resolved,
    descriptor,
    device: status.dev,
    inode: status.ino,
  };
};

const releaseEpisodeLock = (lock) => {
  fs.closeSync(lock.descriptor);
  if (!fs.existsSync(lock.path)) fail('visual finalizer transaction lock disappeared');
  const status = fs.lstatSync(lock.path);
  if (status.isSymbolicLink() || !status.isFile()
      || status.dev !== lock.device || status.ino !== lock.inode) {
    fail('visual finalizer transaction lock was replaced');
  }
  fs.unlinkSync(lock.path);
};

const coverProductionState = (cover, lockedAt) => ({
  contract_version: 'cover-only-v1',
  status: 'completed',
  source_path: cover.approved_external_source.path,
  source_checksum_sha256: cover.approved_external_source.checksum_sha256,
  source_dimensions: cover.approved_external_source.dimensions,
  source_size_bytes: cover.approved_external_source.size_bytes,
  source_codec: cover.approved_external_source.codec,
  source_pixel_format: cover.approved_external_source.pixel_format,
  source_relative_aspect_ratio_error: cover.approved_external_source.relative_aspect_ratio_error,
  source_regular_non_symlink_nonempty: cover.approved_external_source.regular_non_symlink_nonempty,
  source_decode_result: cover.approved_external_source.decode_result,
  archive_path: cover.episode_archive.path,
  archive_checksum_sha256: cover.episode_archive.checksum_sha256,
  archive_dimensions: cover.episode_archive.dimensions,
  archive_exact_bytes_equal_external_source: true,
  normalized_path: cover.production.path,
  normalized_checksum_sha256: cover.production.checksum_sha256,
  normalized_dimensions: cover.production.dimensions,
  evidence_path: cover.normalization_evidence.path,
  evidence_checksum_sha256: cover.normalization_evidence.checksum_sha256,
  deterministic_rerun_identical: true,
  deterministic_rerun_identical_bytes: true,
  no_added_text: true,
  no_redraw: true,
  queue_exempt: true,
  approved_storyboard_path: cover.approved_storyboard_binding.path,
  approved_storyboard_checksum_sha256: cover.approved_storyboard_binding.checksum_sha256,
  completed_at: lockedAt,
});

export const lockVisualAssets = async ({
  episodeWorkspace,
  repositoryRoot = REPOSITORY_ROOT,
  manifestRelative,
  coverEvidenceRelative,
  normalizationDirectory,
  lockedAt = new Date().toISOString(),
}) => {
  const workspace = normalizeRootRelative(episodeWorkspace, 'episode workspace');
  const selectedManifest = normalizeRootRelative(
    manifestRelative ?? defaultPaths(workspace).manifest,
    'visual manifest path',
  );
  const manifestTarget = resolveEpisodeRelative(
    repositoryRoot,
    workspace,
    selectedManifest,
    'visual manifest',
    {allowMissingFinal: true},
  );
  const lock = acquireEpisodeLock(repositoryRoot, workspace);
  try {
    let context;
    let manifestOwnership = null;
    let stateWritten = false;
    let originalStateBytes = null;
    let nextStateChecksum = null;
    try {
      if (fs.existsSync(manifestTarget.resolved)) {
        const existing = readJson(manifestTarget.resolved);
        if (existing.locked_at !== lockedAt) {
          fail('existing manifest locked_at differs from requested locked_at');
        }
        await validateVisualAssetsManifest({
          episodeWorkspace: workspace,
          repositoryRoot,
          manifestRelative: selectedManifest,
          coverEvidenceRelative,
          normalizationDirectory,
        });
        context = await loadBuildContext({
          episodeWorkspace: workspace,
          repositoryRoot,
          manifestRelative: selectedManifest,
          coverEvidenceRelative,
          normalizationDirectory,
          lockedAt,
        });
      } else {
        context = await loadBuildContext({
          episodeWorkspace: workspace,
          repositoryRoot,
          manifestRelative: selectedManifest,
          coverEvidenceRelative,
          normalizationDirectory,
          lockedAt,
        });
        manifestOwnership = writeNewManifest(context.manifestPath, context.value);
      }
      const declaredPhase = context.state.phase ?? context.state.current_phase;
      const oneClickCaptionLock = context.state.current_phase === 'awaiting_caption_delivery_choice'
        && declaredPhase === 'awaiting_caption_delivery_choice'
        && context.state.visual_asset_review?.mode === 'one_click_final_review_v1'
        && context.state.visual_asset_review?.final_review?.status === 'approved';
      if (!oneClickCaptionLock && (context.state.current_phase !== 'visual_production'
          || declaredPhase !== 'visual_production')) {
        fail('lock requires visual_production phase');
      }
      originalStateBytes = fs.readFileSync(context.statePath);
      if (sha256Bytes(originalStateBytes) !== context.stateChecksum) {
        fail('episode state changed during visual lock transaction');
      }

      const manifestChecksum = sha256File(context.manifestPath);
      const nextState = structuredClone(context.state);
      nextState.opening_cover_production = coverProductionState(context.value.cover, lockedAt);
      nextState.active_visual_manifest = {
        status: 'active_locked',
        contract_version: VISUAL_MANIFEST_CONTRACT,
        path: context.manifestRelative,
        checksum_sha256: manifestChecksum,
        active_asset_count: context.value.counts.active_asset_count,
        input_storyboard_path: context.value.provenance.approved_storyboard.path,
        input_storyboard_checksum_sha256: context.value.provenance.approved_storyboard.checksum_sha256,
        narration_master_checksum_sha256: context.value.provenance.narration_master.checksum_sha256,
        qa_result: 'pass_current_approved_bytes_and_production_rasters',
        locked_at: lockedAt,
      };
      nextState.visual_assets_lock = {
        ...context.value.approval_lock,
        manifest_path: context.manifestRelative,
        manifest_checksum_sha256: manifestChecksum,
        opening_cover_evidence_path: context.value.cover.normalization_evidence.path,
        opening_cover_evidence_checksum_sha256: context.value.cover.normalization_evidence.checksum_sha256,
        locked_at: lockedAt,
        validator_confirmed_at: lockedAt,
        verification_sha256_pending_validator_confirmation: false,
      };
      nextState.visual_asset_review.status = 'locked';
      if (!oneClickCaptionLock) {
        nextState.phase = 'visual_assets_locked';
        nextState.current_phase = 'visual_assets_locked';
      }
      nextState.blockers = [];
      const nextStateBytes = jsonBytes(nextState);
      nextStateChecksum = sha256Bytes(nextStateBytes);
      atomicReplaceIfChecksum(
        context.statePath,
        context.stateChecksum,
        nextStateBytes,
        'episode state',
      );
      stateWritten = true;
      return await validateVisualAssetsManifest({
        episodeWorkspace: workspace,
        repositoryRoot,
        manifestRelative: context.manifestRelative,
        coverEvidenceRelative,
        normalizationDirectory,
      });
    } catch (error) {
      let rollbackError = null;
      try {
        if (stateWritten) {
          atomicReplaceIfChecksum(
            context.statePath,
            nextStateChecksum,
            originalStateBytes,
            'locked episode state rollback',
          );
        }
        removeOwnedFile(context?.manifestPath ?? manifestTarget.resolved, manifestOwnership);
      } catch (candidate) {
        rollbackError = candidate;
      }
      if (rollbackError) {
        throw new Error(`${error instanceof Error ? error.message : String(error)}; rollback blocked: ${rollbackError.message}`);
      }
      throw error;
    }
  } finally {
    releaseEpisodeLock(lock);
  }
};

const parseCli = (argv) => {
  const [command, episodeWorkspace, ...rest] = argv;
  if (!['build', 'validate', 'lock'].includes(command) || !episodeWorkspace) {
    fail('usage: finalize-visual-assets-manifest.mjs <build|validate|lock> <episode-workspace> [--manifest PATH] [--cover-evidence PATH] [--normalization-directory PATH] [--locked-at ISO]');
  }
  const options = {episodeWorkspace};
  const keys = new Map([
    ['--manifest', 'manifestRelative'],
    ['--cover-evidence', 'coverEvidenceRelative'],
    ['--normalization-directory', 'normalizationDirectory'],
    ['--locked-at', 'lockedAt'],
  ]);
  for (let index = 0; index < rest.length; index += 2) {
    const key = keys.get(rest[index]);
    const value = rest[index + 1];
    if (!key || value === undefined) fail(`unknown or incomplete option: ${rest[index] ?? ''}`);
    options[key] = value;
  }
  return {command, options};
};

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  try {
    const {command, options} = parseCli(process.argv.slice(2));
    let result;
    if (command === 'validate') {
      result = await validateVisualAssetsManifest(options);
    } else if (command === 'lock') {
      result = await lockVisualAssets(options);
    } else {
      const lockedAt = options.lockedAt ?? new Date().toISOString();
      const context = await loadBuildContext({...options, lockedAt});
      writeNewManifest(context.manifestPath, context.value);
      result = {
        contract_version: 'visual-assets-manifest-build-v1',
        result: 'pass',
        manifest_path: context.manifestRelative,
        manifest_checksum_sha256: sha256File(context.manifestPath),
        active_asset_count: context.value.counts.active_asset_count,
        scene_count: context.value.counts.scene_count,
      };
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
