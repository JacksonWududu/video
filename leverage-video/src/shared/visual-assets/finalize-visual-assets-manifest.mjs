#!/usr/bin/env node
import crypto from 'node:crypto';
import {isFlipbookRow} from '../flipbook-video/profile.mjs';
import {inspectStaticSpreadAsset} from './static-spread-contract.mjs';
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
import {
  IAN_CANONICAL_STYLE_ANCHOR_PATH,
  IAN_LAYERED_SCENE_PACKAGE_VERSION,
  inspectIanLayeredScenePackage,
} from '../ian-layered-scene/contract.mjs';
import {validateWhiteCatVisualStyleSelection} from '../workflow-approval/contract.mjs';
import {validateOneTimeUserGateOverride} from '../user-gate-override/contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPOSITORY_ROOT = path.resolve(HERE, '../../../..');

const SHA256 = /^[a-f0-9]{64}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const NORMALIZATION_METHOD = 'sharp-lanczos3-scale-to-cover-centered-minimal-crop-png9-v1';
const SUPPORTED_ROUTES = new Set(['imagegen', 'ian-handdrawn-ppt']);
const VISUAL_MANIFEST_CONTRACT = 'visual-assets-manifest-v1';
const DIRECT_FIRST_SHOT_CONTRACT = 'direct-first-shot-v1';
const LEGACY_OPENING_COVER_CONTRACT = 'cover-only-v1';
const PROMPT_FIXED_MARKER_QA_VERSION = 'white-cat-prompt-fixed-marker-qa-v1';
const P2_PROMPT_FIXED_MARKER = 'WHITE-CAT SATCHEL STRAP LOCK:';
const HERO_POSE_PROMPT_FIXED_MARKER =
  'HERO-POSE ASSET: full-canvas transparent RGBA with fixed registration anchors.';
const P0_AMBIGUOUS_TRACE = 'P0_AMBIGUOUS_TRACE';
const P0_FORWARD_REVERSE_MISMATCH = 'P0_FORWARD_REVERSE_MISMATCH';
const P2_SATCHEL_TOPOLOGY = 'P2_SATCHEL_TOPOLOGY';
const BOTTOM_SUBTITLE_SAFE_AREA = 'BOTTOM_SUBTITLE_SAFE_AREA';
const FORWARD_REVERSE_MAPPING_QA_VERSION = 'white-cat-forward-reverse-mapping-qa-v1';
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
      ...(item.user_mechanical_gate_override_result === 'pass_with_user_override' ? {
        mechanical_qa_result: item.mechanical_qa_result,
        user_mechanical_gate_override_result: item.user_mechanical_gate_override_result,
        user_mechanical_gate_override_sha256:
          item.user_mechanical_gate_override?.override_sha256,
      } : {}),
    })),
  };
  const hasOverride = queue.some(
    (item) => item.user_mechanical_gate_override_result === 'pass_with_user_override',
  );
  return {
    ...payload,
    active_asset_count: queue.length,
    verification_sha256: sha256Canonical(payload),
    result: hasOverride ? 'pass_with_user_override' : 'pass',
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

const resolveTimelineOpeningContract = (state) => {
  const declarations = [
    state.storyboard_timing?.direct_first_shot_contract,
    state.storyboard_draft?.direct_first_shot_contract,
  ].filter((value) => value !== undefined && value !== null);
  if (declarations.some((value) => value !== DIRECT_FIRST_SHOT_CONTRACT)) {
    fail('storyboard direct-first-shot contract declaration is unsupported');
  }
  if (declarations.length > 0) return DIRECT_FIRST_SHOT_CONTRACT;
  if (state.opening_cover?.contract_version === LEGACY_OPENING_COVER_CONTRACT) {
    return LEGACY_OPENING_COVER_CONTRACT;
  }
  fail('episode lacks an explicit direct-first-shot or historical opening-cover contract');
};

const parseStoryboardSourceTexts = (markdown, openingContract) => {
  const matches = [...markdown.matchAll(/^## (OPEN-00|S\d+)\n([\s\S]*?)(?=^## |(?![\s\S]))/gm)];
  const sections = new Map();
  for (const match of matches) {
    if (sections.has(match[1])) fail(`storyboard contains duplicate section ${match[1]}`);
    const source = match[2].match(/- 锁稿原文 source_text：\n```text\n([\s\S]*?)\n```/);
    if (!source) fail(`storyboard section ${match[1]} lacks exact source_text`);
    sections.set(match[1], source[1]);
  }
  const shotIds = [...sections.keys()];
  if (openingContract === DIRECT_FIRST_SHOT_CONTRACT) {
    if (sections.has('OPEN-00') || shotIds[0] !== 'S01') {
      fail('direct-first-shot-v1 storyboard must begin with S01 and contain no OPEN-00');
    }
  } else if (!sections.has('OPEN-00')) {
    fail('historical cover-only-v1 storyboard lacks OPEN-00 source_text');
  }
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
  if (item.asset_kind === 'hero_pose_background'
      && (item.qa_contract_version !== 'ordinary-imagegen-hero-pose-background-qa-v1'
        || qa.contract_version !== item.qa_contract_version)) {
    fail(`asset ${item.asset_id} hero_pose background QA contract is invalid`);
  }
  if (item.asset_kind === 'hero_pose') {
    const expectedTransparentPoseQa = {
      result: 'pass',
      source_checksum_sha256: item.checksum_sha256,
      full_canvas_rgba: true,
      transparent_background: true,
      registration_anchor_policy: 'fixed-full-canvas-v1',
    };
    const {measured_alpha: measuredAlpha, ...recordedTransparentPoseQa} =
      item.transparent_pose_qa ?? {};
    requireSameJson(
      recordedTransparentPoseQa,
      expectedTransparentPoseQa,
      `asset ${item.asset_id} hero_pose transparent registration QA`,
    );
    if (!measuredAlpha || typeof measuredAlpha !== 'object') {
      fail(`asset ${item.asset_id} hero_pose measured alpha evidence is missing`);
    }
    const {measured_alpha: unusedQaMeasuredAlpha, ...recordedQaTransparentPose} =
      qa.transparent_pose_qa ?? {};
    requireSameJson(
      recordedQaTransparentPose,
      expectedTransparentPoseQa,
      `asset ${item.asset_id} transparent_pose_qa`,
    );
  }
};

const inspectQaEvidence = ({repositoryRoot, episodeWorkspace, item, state}) => {
  const target = requireCurrentFile(
    repositoryRoot,
    item.qa_evidence_path,
    item.qa_evidence_checksum_sha256,
    `asset ${item.asset_id} QA evidence`,
    {episodeWorkspace},
  );
  const record = readJson(target.resolved);
  const hasOverride = item.mechanical_qa_result !== undefined
    || item.user_mechanical_gate_override_result !== undefined
    || item.user_mechanical_gate_override !== undefined;
  let mechanicalOverride = null;
  if (hasOverride) {
    const visibleSymbolGateId = `visual_asset.${item.asset_id}.VISIBLE_SYMBOL_FREE`;
    const isVisibleSymbolOverride = item.waived_mechanical_gate_ids?.includes(
      visibleSymbolGateId,
    );
    const subtitleGateId = `visual_asset.${item.asset_id}.${BOTTOM_SUBTITLE_SAFE_AREA}`;
    const isSubtitleOverride = item.waived_mechanical_gate_ids?.includes(
      subtitleGateId,
    );
    const p0AmbiguousGateId = `visual_asset.${item.asset_id}.${P0_AMBIGUOUS_TRACE}`;
    const isP0AmbiguousOverride = item.waived_mechanical_gate_ids?.includes(
      p0AmbiguousGateId,
    );
    mechanicalOverride = (isVisibleSymbolOverride
      ? validateVisibleSymbolOverrideEvidence
      : (isP0AmbiguousOverride
        ? validateWhiteCatP0AmbiguousTraceOverrideEvidence
        : validateWhiteCatP2OverrideEvidence))({
      repositoryRoot,
      episodeWorkspace,
      state,
      item,
      qa: record,
    });
    for (const field of [
      'technical_qa',
      'semantic_qa',
      'visible_text_qa',
      'style_qa',
      'continuity_qa',
      'visual_qa',
    ]) {
      if (isVisibleSymbolOverride && field === 'visible_text_qa') {
        requireSameJson(record[field], item[field], `asset ${item.asset_id} ${field}`);
        continue;
      }
      if (isSubtitleOverride && field === 'visual_qa') {
        requireSameJson(record[field], item[field], `asset ${item.asset_id} ${field}`);
        continue;
      }
      if (item[field]?.result !== 'pass') {
        fail(`asset ${item.asset_id} ${field} is not passing outside its waived gate`);
      }
      if (record[field] !== undefined) {
        requireSameJson(record[field], item[field], `asset ${item.asset_id} ${field}`);
      }
    }
  } else {
    assertPassingQa(item, record);
  }
  return {
    path: target.relative,
    checksum_sha256: item.qa_evidence_checksum_sha256,
    record,
    mechanical_override: mechanicalOverride,
  };
};

const consumedTransitionIdCount = (value, transitionId) => {
  if (Array.isArray(value)) {
    return value.reduce(
      (count, entry) => count + consumedTransitionIdCount(entry, transitionId),
      0,
    );
  }
  if (!value || typeof value !== 'object') return 0;
  return Object.entries(value).reduce(
    (count, [key, entry]) => count
      + (key === 'consumed_transition_id' && entry === transitionId
        ? 1
        : consumedTransitionIdCount(entry, transitionId)),
    0,
  );
};

const whiteCatPromptFixedMarkerFailures = (item, promptText) => {
  const failures = [];
  if (!promptText.includes(P2_PROMPT_FIXED_MARKER)) {
    failures.push({
      gate_id: `visual_asset.${item.asset_id}.P2_PROMPT_FIXED_MARKER`,
      observed_result: 'fail',
      reason: `P2_PROMPT_FIXED_MARKER: required literal is missing: ${P2_PROMPT_FIXED_MARKER}`,
    });
  }
  if (item.asset_kind === 'hero_pose' && !promptText.includes(HERO_POSE_PROMPT_FIXED_MARKER)) {
    failures.push({
      gate_id: `visual_asset.${item.asset_id}.HERO_POSE_PROMPT_FIXED_MARKER`,
      observed_result: 'fail',
      reason: `HERO_POSE_PROMPT_FIXED_MARKER: required literal is missing: ${HERO_POSE_PROMPT_FIXED_MARKER}`,
    });
  }
  return failures;
};

const validatePromptFixedMarkerSupplement = ({item, override, failures, label}) => {
  const supplements = override.decision?.supplemental_exact_user_messages;
  if (failures.length === 0) {
    if (supplements !== undefined) {
      fail(`${label} has an unnecessary supplemental prompt-marker release`);
    }
    return;
  }
  const expectedGateIds = failures.map((failure) => failure.gate_id);
  if (!Array.isArray(supplements) || supplements.length !== 1) {
    fail(`${label} supplemental prompt-marker release is missing`);
  }
  const supplement = supplements[0];
  if (!supplement || typeof supplement !== 'object' || Array.isArray(supplement)
      || supplement.disposition !== 'allow_once'
      || !sameJson(supplement.gate_ids, expectedGateIds)
      || typeof supplement.decided_at !== 'string'
      || Number.isNaN(Date.parse(supplement.decided_at))
      || typeof supplement.exact_user_message !== 'string') {
    fail(`${label} supplemental prompt-marker release is stale`);
  }
  const message = supplement.exact_user_message.toLowerCase();
  const requiredMarkers = [
    item.asset_id.toLowerCase(),
    '提示词',
    '标记',
    '保留真实提示词',
    '失败证据',
  ];
  if (requiredMarkers.some((marker) => !message.includes(marker))
      || !['放行', '接受', '允许'].some((marker) => message.includes(marker))
      || !['一次', '本次', '仅此一次'].some((marker) => message.includes(marker))
      || (expectedGateIds.some((gateId) => gateId.endsWith('.P2_PROMPT_FIXED_MARKER'))
        && !message.includes('p2'))
      || (expectedGateIds.some((gateId) => gateId.endsWith('.HERO_POSE_PROMPT_FIXED_MARKER'))
        && !message.includes('hero-pose')
        && !message.includes('hero pose'))) {
    fail(`${label} supplemental prompt-marker release is not exact and asset-specific`);
  }
};

const expectedForwardReverseMap = (promptText, label) => {
  const facingLine = promptText.split('\n')
    .find((line) => line.startsWith('CAT FACING MAP:'))?.trim().toLowerCase() ?? '';
  let facing;
  let front;
  let rear;
  if (facingLine.includes('three-quarter screen-left')
      || facingLine.includes('three-quarter-screen-left')) {
    facing = 'three-quarter-screen-left';
    front = 'screen-left';
    rear = 'screen-right';
  } else if (facingLine.includes('three-quarter screen-right')
      || facingLine.includes('three-quarter-screen-right')) {
    facing = 'three-quarter-screen-right';
    front = 'screen-right';
    rear = 'screen-left';
  } else {
    fail(`${label} P0 forward/reverse mapping QA lacks one exact reversible CAT FACING MAP`);
  }
  return {
    expected_cat_facing_screen_direction: facing,
    expected_anatomical_front_maps_to_screen: front,
    expected_anatomical_rear_maps_to_screen: rear,
    observed_cat_facing_screen_direction: facing === 'three-quarter-screen-left'
      ? 'three-quarter-screen-right'
      : 'three-quarter-screen-left',
    observed_anatomical_front_maps_to_screen: rear,
    observed_anatomical_rear_maps_to_screen: front,
  };
};

const validateForwardReverseMappingFailure = ({identity, promptText, label}) => {
  const expected = expectedForwardReverseMap(promptText, label);
  const mapping = identity?.forward_reverse_mapping_qa;
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)
      || mapping.contract_version !== FORWARD_REVERSE_MAPPING_QA_VERSION
      || mapping.result !== 'fail'
      || mapping.error_code !== P0_FORWARD_REVERSE_MISMATCH
      || Object.entries(expected).some(([key, value]) => mapping[key] !== value)
      || typeof mapping.failure_reason !== 'string'
      || !mapping.failure_reason.startsWith(`${P0_FORWARD_REVERSE_MISMATCH}:`)
      || identity.cat_facing_screen_direction
        !== expected.observed_cat_facing_screen_direction
      || identity.anatomical_front_maps_to_screen
        !== expected.observed_anatomical_front_maps_to_screen
      || identity.anatomical_rear_maps_to_screen
        !== expected.observed_anatomical_rear_maps_to_screen) {
    fail(`${label} forward/reverse mapping QA is missing or stale`);
  }
  return mapping;
};

export const validateWhiteCatP0AmbiguousTraceOverrideEvidence = ({
  repositoryRoot,
  episodeWorkspace,
  state,
  item,
  qa,
}) => {
  const label = `asset ${item?.asset_id}`;
  const expectedQaContract = [
    'base/master',
    'white-cat-master',
    'recurring-character-master',
  ].includes(item?.role)
    ? 'ordinary-imagegen-white-cat-master-qa-v2'
    : 'ordinary-imagegen-white-cat-action-qa-v2';
  if (item?.visual_generation_route !== 'imagegen'
      || item.white_cat_present !== true
      || typeof item.asset_id !== 'string'
      || typeof item.generation_attempt_scope_id !== 'string'
      || item.mechanical_qa_result !== 'failed_but_waived_once'
      || item.user_mechanical_gate_override_result !== 'pass_with_user_override'
      || !item.user_mechanical_gate_override
      || qa?.contract_version !== expectedQaContract
      || qa.result !== 'fail'
      || qa.asset_id !== item.asset_id) {
    fail(`${label} P0 ambiguous-trace override disposition is incomplete`);
  }

  const identity = qa.identity_qa;
  const anatomy = identity?.anatomy_evidence;
  if (identity?.result !== 'fail'
      || identity.cat_count !== 1
      || identity.foreleg_count !== 2
      || identity.hindleg_count !== 2
      || identity.paw_count !== 4
      || anatomy?.contract_version !== 'white-cat-anatomy-qa-v2'
      || anatomy.result !== 'fail'
      || anatomy.error_code !== P0_AMBIGUOUS_TRACE
      || typeof anatomy.failure_reason !== 'string'
      || !anatomy.failure_reason.startsWith(`${P0_AMBIGUOUS_TRACE}:`)
      || !sameJson(anatomy.source_image, {
        path: item.path,
        checksum_sha256: item.checksum_sha256,
      })
      || identity.accessory_geometry_correct !== true
      || identity.source_retry_policy_compliant !== true) {
    fail(`${label} does not preserve the exact P0 ambiguous-trace evidence`);
  }
  requireSameJson(identity, item.identity_qa, `${label} failed identity QA`);
  requireSameJson(qa.selected_source, {
    path: item.path,
    checksum_sha256: item.checksum_sha256,
    ...(qa.selected_source?.dimensions === undefined
      ? {} : {dimensions: qa.selected_source.dimensions}),
    ...(qa.selected_source?.relative_aspect_ratio_error === undefined
      ? {} : {relative_aspect_ratio_error: qa.selected_source.relative_aspect_ratio_error}),
  }, `${label} selected source`);
  requireSameJson(qa.selected_prompt, {
    path: item.prompt_path,
    checksum_sha256: item.prompt_checksum_sha256,
  }, `${label} selected prompt`);

  const attemptControl = item.image_generation_attempt_control;
  const whiteCatControl = item.white_cat_generation_attempt_control;
  const generationFailures = assertArray(
    item.image_generation_qa_failures,
    `${label} generation failures`,
  );
  const whiteCatFailures = assertArray(
    item.white_cat_imagegen_qa_failures,
    `${label} white-cat failures`,
  );
  const failureCount = attemptControl?.rejected_generation_count;
  const earlyUserAcceptance = [1, 2].includes(failureCount);
  const expectedRetryStatus = earlyUserAcceptance
    ? 'stopped_by_explicit_user_acceptance'
    : 'stopped_user_takeover_required';
  const selectedWhiteCatFailures = whiteCatFailures.filter((failure) => (
    failure?.error_code === P0_AMBIGUOUS_TRACE
    && sameJson(failure?.output, {path: item.path, checksum_sha256: item.checksum_sha256})
  ));
  if ((!earlyUserAcceptance && failureCount !== 3)
      || attemptControl?.contract_version !== 'storyboard-image-generation-attempt-limit-v1'
      || attemptControl.generation_attempt_scope_id !== item.generation_attempt_scope_id
      || attemptControl.maximum_automatic_rejected_generations !== 3
      || attemptControl.automatic_retry_status !== expectedRetryStatus
      || whiteCatControl?.contract_version !== 'white-cat-imagegen-attempt-limit-v1'
      || whiteCatControl.maximum_automatic_qa_failures !== 3
      || whiteCatControl.qa_failed_generation_count !== failureCount
      || whiteCatControl.automatic_retry_status !== expectedRetryStatus
      || generationFailures.length !== failureCount
      || whiteCatFailures.length !== failureCount
      || !sameJson(
        generationFailures.map((failure) => failure?.attempt_number),
        Array.from({length: failureCount}, (_, index) => index + 1),
      )
      || !sameJson(
        whiteCatFailures.map((failure) => failure?.attempt_number),
        Array.from({length: failureCount}, (_, index) => index + 1),
      )
      || new Set(generationFailures.map(
        (failure) => failure?.output?.checksum_sha256,
      )).size !== failureCount
      || selectedWhiteCatFailures.length !== 1
      || selectedWhiteCatFailures[0].failure_reason !== anatomy.failure_reason) {
    fail(`${label} P0 attempt/failure history is stale`);
  }
  requireSameJson(qa.waivable_mechanical_failures, [{
    error_code: P0_AMBIGUOUS_TRACE,
    observed_result: 'fail',
    reason: anatomy.failure_reason,
  }], `${label} P0 waivable failure`);

  const inspection = anatomy.inspection_evidence;
  if (inspection?.methods?.join(',') !== 'full_resolution,numbered_limb_map'
      || inspection.numbered_limb_map_source_checksum_sha256 !== item.checksum_sha256
      || !sameJson(inspection.numbered_limb_map_limb_ids, ['F1', 'F2', 'H1', 'H2'])) {
    fail(`${label} numbered limb-map evidence is stale`);
  }
  const requiredArtifacts = [
    {path: item.path, checksum_sha256: item.checksum_sha256},
    {path: item.prompt_path, checksum_sha256: item.prompt_checksum_sha256},
    {path: item.qa_evidence_path, checksum_sha256: item.qa_evidence_checksum_sha256},
    {
      path: inspection.numbered_limb_map_path,
      checksum_sha256: inspection.numbered_limb_map_checksum_sha256,
    },
  ];
  const artifacts = assertArray(item.override_bound_artifacts, `${label} override artifacts`);
  if (requiredArtifacts.some(
    (required) => !artifacts.some((artifact) => sameJson(artifact, required)),
  )) {
    fail(`${label} override artifacts omit current P0 evidence`);
  }
  artifacts.forEach((artifact, index) => requireCurrentFile(
    repositoryRoot,
    artifact.path,
    artifact.checksum_sha256,
    `${label} override artifact ${index}`,
    {episodeWorkspace},
  ));

  const scopeId = item.generation_attempt_scope_id;
  const attemptGateId = `storyboard-image-generation-attempt-limit:${scopeId}`;
  const p0GateId = `visual_asset.${item.asset_id}.${P0_AMBIGUOUS_TRACE}`;
  const gateIds = earlyUserAcceptance ? [p0GateId] : [attemptGateId, p0GateId];
  requireSameJson(item.waived_mechanical_gate_ids, gateIds, `${label} waived gate IDs`);
  const override = item.user_mechanical_gate_override;
  requireSameJson(override.gate_ids, gateIds, `${label} override gate IDs`);
  requireSameJson(override.bound_artifacts, artifacts, `${label} override artifacts`);
  const failureByGate = new Map(
    (override.acknowledged_failures ?? []).map((failure) => [failure?.gate_id, failure]),
  );
  if (failureByGate.get(p0GateId)?.observed_result !== 'fail'
      || failureByGate.get(p0GateId)?.reason !== anatomy.failure_reason
      || (!earlyUserAcceptance
        && failureByGate.get(attemptGateId)?.observed_result
          !== 'stopped_user_takeover_required')) {
    fail(`${label} override does not preserve the exact P0 failure`);
  }
  const message = String(override.decision?.exact_user_message ?? '').toLowerCase();
  if (!message.includes(item.asset_id.toLowerCase())
      || !message.includes(P0_AMBIGUOUS_TRACE.toLowerCase())
      || !['放行', '接受', '允许'].some((marker) => message.includes(marker))
      || !['一次', '本次', '仅此一次'].some((marker) => message.includes(marker))
      || (earlyUserAcceptance
        && (!['停止', '不再'].some((marker) => message.includes(marker))
          || !message.includes('重试')
          || !message.includes('保留')
          || !message.includes('失败证据')))
      || (!earlyUserAcceptance
        && !['三次', '3次'].some((marker) => message.includes(marker)))) {
    fail(`${label} override decision is not exact and P0-specific`);
  }
  const result = validateOneTimeUserGateOverride(override, {
    episodeId: state?.episode_id,
    requiredScopeId: scopeId,
    requiredGateIds: gateIds,
    requiredArtifacts: artifacts,
    fromPhase: earlyUserAcceptance ? 'visual_production' : 'awaiting_visual_asset_review',
    toPhase: 'visual_production',
    requiredStatus: 'consumed',
  });
  const blockers = assertArray(state?.blockers, 'episode blockers').filter(
    (blocker) => blocker?.blocker_id === attemptGateId,
  );
  if (earlyUserAcceptance ? blockers.length !== 0 : (
    blockers.length !== 1
    || blockers[0].contract_version !== 'storyboard-image-generation-attempt-limit-v1'
    || blockers[0].asset_id !== item.asset_id
    || blockers[0].generation_attempt_scope_id !== scopeId
    || blockers[0].status !== 'failed_but_waived_once'
    || blockers[0].user_mechanical_gate_override_sha256 !== result.override_sha256
  )) {
    fail(`${label} P0 attempt-limit blocker state is stale`);
  }
  const transitionId = override.consumption?.consumed_transition_id;
  if (typeof transitionId !== 'string'
      || consumedTransitionIdCount(state, transitionId) !== 1) {
    fail(`${label} override transition ID is missing or reused`);
  }
  return {
    result: 'pass_with_user_override',
    mechanical_qa_result: item.mechanical_qa_result,
    override_sha256: result.override_sha256,
    gate_ids: gateIds,
    bound_artifacts: artifacts,
  };
};

export const validateWhiteCatP2OverrideEvidence = ({
  repositoryRoot,
  episodeWorkspace,
  state,
  item,
  qa,
}) => {
  const label = `asset ${item?.asset_id}`;
  if (item?.visual_generation_route !== 'imagegen'
      || item.white_cat_present !== true
      || typeof item.asset_id !== 'string'
      || typeof item.generation_attempt_scope_id !== 'string') {
    fail(`${label} is not an eligible white-cat ImageGen override target`);
  }
  const expectedQaContract = [
    'base/master',
    'white-cat-master',
    'recurring-character-master',
  ].includes(item.role)
    ? 'ordinary-imagegen-white-cat-master-qa-v2'
    : 'ordinary-imagegen-white-cat-action-qa-v2';
  if (item.mechanical_qa_result !== 'failed_but_waived_once'
      || item.user_mechanical_gate_override_result !== 'pass_with_user_override'
      || !item.user_mechanical_gate_override
      || qa?.contract_version !== expectedQaContract
      || qa.result !== 'fail'
      || qa.asset_id !== item.asset_id) {
    fail(`${label} failed-but-waived QA disposition is incomplete`);
  }
  const identity = qa.identity_qa;
  if (identity?.result !== 'fail'
      || identity.cat_count !== 1
      || identity.foreleg_count !== 2
      || identity.hindleg_count !== 2
      || identity.paw_count !== 4
      || identity.anatomy_evidence?.contract_version !== 'white-cat-anatomy-qa-v2'
      || identity.anatomy_evidence.result !== 'pass'
      || identity.accessory_geometry_correct !== false
      || typeof identity.front_strap_attached_to_forward_bag_end !== 'boolean'
      || typeof identity.rear_strap_attached_to_rear_bag_end !== 'boolean'
      || identity.front_strap_attached_to_forward_bag_end
        === identity.rear_strap_attached_to_rear_bag_end
      || identity.bag_end_attachment_count !== 1
      || identity.both_bag_end_anchors_visibly_traceable !== false
      || identity.source_retry_policy_compliant !== false) {
    fail(`${label} does not preserve the exact limb-topology/P2-fail identity evidence`);
  }
  requireSameJson(identity, item.identity_qa, `${label} failed identity QA`);
  if (item.asset_kind === 'hero_pose') {
    const expectedTransparentPoseQa = {
      result: 'pass',
      source_checksum_sha256: item.checksum_sha256,
      full_canvas_rgba: true,
      transparent_background: true,
      registration_anchor_policy: 'fixed-full-canvas-v1',
    };
    const {measured_alpha: measuredAlpha, ...recordedTransparentPoseQa} =
      item.transparent_pose_qa ?? {};
    requireSameJson(
      recordedTransparentPoseQa,
      expectedTransparentPoseQa,
      `${label} transparent pose QA`,
    );
    const {measured_alpha: unusedQaMeasuredAlpha, ...recordedQaTransparentPose} =
      qa.transparent_pose_qa ?? {};
    requireSameJson(
      recordedQaTransparentPose,
      expectedTransparentPoseQa,
      `${label} QA-file transparent pose QA`,
    );
    if (!measuredAlpha || typeof measuredAlpha !== 'object') {
      fail(`${label} measured alpha evidence is missing`);
    }
  }
  requireSameJson(qa.selected_source, {
    path: item.path,
    checksum_sha256: item.checksum_sha256,
    ...(qa.selected_source?.dimensions === undefined
      ? {} : {dimensions: qa.selected_source.dimensions}),
    ...(qa.selected_source?.relative_aspect_ratio_error === undefined
      ? {} : {relative_aspect_ratio_error: qa.selected_source.relative_aspect_ratio_error}),
  }, `${label} selected source`);
  requireSameJson(qa.selected_prompt, {
    path: item.prompt_path,
    checksum_sha256: item.prompt_checksum_sha256,
  }, `${label} selected prompt`);
  const promptTarget = requireCurrentFile(
    repositoryRoot,
    item.prompt_path,
    item.prompt_checksum_sha256,
    `${label} selected prompt`,
    {episodeWorkspace},
  );
  const promptText = fs.readFileSync(promptTarget.resolved, 'utf8');
  const hasForwardReverseOverride = qa.waivable_mechanical_failures?.some(
    (failure) => failure?.error_code === P0_FORWARD_REVERSE_MISMATCH,
  ) === true;
  const forwardReverseMapping = hasForwardReverseOverride
    ? validateForwardReverseMappingFailure({identity, promptText, label})
    : null;
  if (!hasForwardReverseOverride && identity.forward_reverse_mapping_qa !== undefined) {
    fail(`${label} P2-only override has unexpected forward/reverse mapping QA`);
  }
  const promptMarkerFailures = whiteCatPromptFixedMarkerFailures(
    item,
    promptText,
  );
  const expectedPromptContractQa = promptMarkerFailures.length > 0 ? {
    contract_version: PROMPT_FIXED_MARKER_QA_VERSION,
    result: 'failed_but_waived_once',
    prompt: {
      path: item.prompt_path,
      checksum_sha256: item.prompt_checksum_sha256,
    },
    failures: promptMarkerFailures,
  } : undefined;
  if (expectedPromptContractQa === undefined) {
    if (item.prompt_contract_qa !== undefined) {
      fail(`${label} prompt fixed-marker QA is stale`);
    }
  } else {
    requireSameJson(
      item.prompt_contract_qa,
      expectedPromptContractQa,
      `${label} prompt fixed-marker QA`,
    );
  }

  const attemptControl = item.image_generation_attempt_control;
  const whiteCatControl = item.white_cat_generation_attempt_control;
  const generationFailures = assertArray(
    item.image_generation_qa_failures,
    `${label} generation failures`,
  );
  const whiteCatFailures = assertArray(
    item.white_cat_imagegen_qa_failures,
    `${label} white-cat failures`,
  );
  const scopeId = item.generation_attempt_scope_id;
  const expectedLatestErrorCode = hasForwardReverseOverride
    ? P0_FORWARD_REVERSE_MISMATCH
    : P2_SATCHEL_TOPOLOGY;
  const failureCount = attemptControl?.rejected_generation_count;
  const earlyUserAcceptance = [1, 2].includes(failureCount)
    && attemptControl?.automatic_retry_status === 'stopped_by_explicit_user_acceptance'
    && whiteCatControl?.qa_failed_generation_count === failureCount
    && whiteCatControl?.automatic_retry_status === 'stopped_by_explicit_user_acceptance';
  const expectedFailureCount = earlyUserAcceptance ? failureCount : 3;
  const expectedRetryStatus = earlyUserAcceptance
    ? 'stopped_by_explicit_user_acceptance'
    : 'stopped_user_takeover_required';
  if (attemptControl?.contract_version !== 'storyboard-image-generation-attempt-limit-v1'
      || attemptControl.generation_attempt_scope_id !== scopeId
      || attemptControl.maximum_automatic_rejected_generations !== 3
      || attemptControl.rejected_generation_count !== expectedFailureCount
      || attemptControl.automatic_retry_status !== expectedRetryStatus
      || whiteCatControl?.contract_version !== 'white-cat-imagegen-attempt-limit-v1'
      || whiteCatControl.maximum_automatic_qa_failures !== 3
      || whiteCatControl.qa_failed_generation_count !== expectedFailureCount
      || whiteCatControl.automatic_retry_status !== expectedRetryStatus
      || generationFailures.length !== expectedFailureCount
      || whiteCatFailures.length !== expectedFailureCount
      || !sameJson(
        generationFailures.map((failure) => failure?.attempt_number),
        Array.from({length: expectedFailureCount}, (_, index) => index + 1),
      )
      || !sameJson(
        whiteCatFailures.map((failure) => failure?.attempt_number),
        Array.from({length: expectedFailureCount}, (_, index) => index + 1),
      )
      || new Set(generationFailures.map(
        (failure) => failure?.output?.checksum_sha256,
      )).size !== expectedFailureCount
      || whiteCatFailures.at(-1)?.error_code !== expectedLatestErrorCode
      || (earlyUserAcceptance && hasForwardReverseOverride)) {
    fail(`${label} attempt-limit/white-cat failure history is stale`);
  }
  const latestWhiteCatFailure = whiteCatFailures.at(-1);
  const visualQa = qa.visual_qa;
  const hasSubtitleOverride = earlyUserAcceptance
    && visualQa?.result === 'fail'
    && visualQa.bottom_subtitle_safe_area_result === 'fail'
    && visualQa.bottom_subtitle_safe_area_readable === false;
  const expectedWaivableFailures = hasForwardReverseOverride ? [
    {
      error_code: P0_FORWARD_REVERSE_MISMATCH,
      observed_result: 'fail',
      reason: latestWhiteCatFailure.failure_reason,
    },
    {
      error_code: P2_SATCHEL_TOPOLOGY,
      observed_result: 'fail',
      reason: latestWhiteCatFailure.failure_reason,
    },
  ] : earlyUserAcceptance ? [
    {
      error_code: P2_SATCHEL_TOPOLOGY,
      observed_result: 'fail',
      reason: latestWhiteCatFailure.failure_reason,
    },
    ...(hasSubtitleOverride ? [{
      error_code: BOTTOM_SUBTITLE_SAFE_AREA,
      observed_result: 'fail',
      reason: latestWhiteCatFailure.failure_reason,
    }] : []),
  ] : undefined;
  if (hasForwardReverseOverride) {
    requireSameJson(
      qa.waivable_mechanical_failures,
      expectedWaivableFailures,
      `${label} combined P0/P2 failures`,
    );
    if (forwardReverseMapping.failure_reason !== latestWhiteCatFailure.failure_reason) {
      fail(`${label} forward/reverse mapping QA does not preserve the latest failure`);
    }
  } else if (earlyUserAcceptance) {
    requireSameJson(
      qa.waivable_mechanical_failures,
      expectedWaivableFailures,
      `${label} early-acceptance failures`,
    );
  }
  const inspection = identity.anatomy_evidence.inspection_evidence;
  if (inspection?.methods?.join(',') !== 'full_resolution,numbered_limb_map'
      || inspection.numbered_limb_map_source_checksum_sha256 !== item.checksum_sha256
      || !sameJson(inspection.numbered_limb_map_limb_ids, ['F1', 'F2', 'H1', 'H2'])) {
    fail(`${label} numbered limb-map evidence is stale`);
  }
  const artifacts = [
    {path: item.path, checksum_sha256: item.checksum_sha256},
    {path: item.prompt_path, checksum_sha256: item.prompt_checksum_sha256},
    {path: item.qa_evidence_path, checksum_sha256: item.qa_evidence_checksum_sha256},
    {
      path: inspection.numbered_limb_map_path,
      checksum_sha256: inspection.numbered_limb_map_checksum_sha256,
    },
  ];
  const sourceBinding = artifacts[0];
  const promptBinding = artifacts[1];
  const latestGenerationFailure = generationFailures.at(-1);
  if (earlyUserAcceptance
      && (!sameJson(latestWhiteCatFailure.output, sourceBinding)
        || !sameJson(latestWhiteCatFailure.prompt, promptBinding)
        || !sameJson(latestGenerationFailure.output, sourceBinding)
        || !sameJson(latestGenerationFailure.prompt, promptBinding)
        || latestGenerationFailure.failure_reason !== latestWhiteCatFailure.failure_reason)) {
    fail(`${label} source is not the exact accepted failed output`);
  }
  const artifactFailures = earlyUserAcceptance
    ? generationFailures
    : [latestWhiteCatFailure];
  for (const failure of artifactFailures) {
    for (const binding of [failure.output, failure.prompt]) {
      if (!binding || typeof binding !== 'object') fail(`${label} failed artifact binding is missing`);
      if (!artifacts.some((artifact) => sameJson(artifact, binding))) {
        artifacts.push({path: binding.path, checksum_sha256: binding.checksum_sha256});
      }
    }
  }
  const selectionBinding = item.user_source_selection_evidence;
  if (earlyUserAcceptance) {
    if (!selectionBinding || typeof selectionBinding !== 'object') {
      fail(`${label} early-acceptance selection evidence is missing`);
    }
    if (!artifacts.some((artifact) => sameJson(artifact, selectionBinding))) {
      artifacts.push(selectionBinding);
    }
  }
  artifacts.forEach((artifact, index) => requireCurrentFile(
    repositoryRoot,
    artifact.path,
    artifact.checksum_sha256,
    `${label} override artifact ${index}`,
    {episodeWorkspace},
  ));
  requireSameJson(item.override_bound_artifacts, artifacts, `${label} override artifacts`);

  const attemptGateId = `storyboard-image-generation-attempt-limit:${scopeId}`;
  const p0GateId = `visual_asset.${item.asset_id}.P0_FORWARD_REVERSE_MISMATCH`;
  const p2GateId = `visual_asset.${item.asset_id}.P2_SATCHEL_TOPOLOGY`;
  const subtitleGateId = `visual_asset.${item.asset_id}.${BOTTOM_SUBTITLE_SAFE_AREA}`;
  const gateIds = earlyUserAcceptance
    ? [
      p2GateId,
      ...(hasSubtitleOverride ? [subtitleGateId] : []),
      ...promptMarkerFailures.map((failure) => failure.gate_id),
    ]
    : [
      attemptGateId,
      ...(hasForwardReverseOverride ? [p0GateId] : []),
      p2GateId,
      ...promptMarkerFailures.map((failure) => failure.gate_id),
    ];
  requireSameJson(item.waived_mechanical_gate_ids, gateIds, `${label} waived gate IDs`);
  const override = item.user_mechanical_gate_override;
  requireSameJson(override.gate_ids, gateIds, `${label} override gate IDs`);
  const failureByGate = new Map(
    (override.acknowledged_failures ?? []).map((failure) => [failure?.gate_id, failure]),
  );
  if ((!earlyUserAcceptance
        && failureByGate.get(attemptGateId)?.observed_result
          !== 'stopped_user_takeover_required')
      || (hasForwardReverseOverride
        && failureByGate.get(p0GateId)?.reason
          !== latestWhiteCatFailure.failure_reason)
      || failureByGate.get(p2GateId)?.reason
        !== latestWhiteCatFailure.failure_reason
      || (hasSubtitleOverride
        && failureByGate.get(subtitleGateId)?.reason
          !== latestWhiteCatFailure.failure_reason)
      || promptMarkerFailures.some(
        (failure) => !sameJson(failureByGate.get(failure.gate_id), failure),
      )) {
    fail(`${label} override does not preserve the exact failed results`);
  }
  const message = String(override.decision?.exact_user_message ?? '').toLowerCase();
  const ordinalMarkers = expectedFailureCount === 1
    ? ['第一次', '第1次', 'attempt 1']
    : ['第二次', '第2次', 'attempt 2'];
  if (!message.includes(item.asset_id.toLowerCase())
      || !['p2', '背带', '挎包'].some((marker) => message.includes(marker))
      || (hasForwardReverseOverride
        && !['p0', '朝向', '前后'].some((marker) => message.includes(marker)))
      || !(earlyUserAcceptance
        ? (['停止', '不再'].some((marker) => message.includes(marker))
          && message.includes('重试')
          && ordinalMarkers.some((marker) => message.includes(marker)))
        : ['三次', '3次', '重试', 'attempt'].some((marker) => message.includes(marker)))
      || !['放行', '接受', '允许'].some((marker) => message.includes(marker))
      || (earlyUserAcceptance
        && !['一次', '本次', '仅此一次'].some((marker) => message.includes(marker)))
      || (earlyUserAcceptance && !message.includes('保留'))
      || (earlyUserAcceptance && !message.includes('失败证据'))
      || (hasSubtitleOverride
        && !['字幕', '底部18%'].some((marker) => message.includes(marker)))) {
    fail(`${label} override decision is not asset/P0/P2/attempt-limit specific`);
  }
  if (earlyUserAcceptance) {
    const selectionTarget = requireCurrentFile(
      repositoryRoot,
      selectionBinding.path,
      selectionBinding.checksum_sha256,
      `${label} early-acceptance selection evidence`,
      {episodeWorkspace},
    );
    const selection = readJson(selectionTarget.resolved);
    if (selection.contract_version !== 'visual-asset-user-source-selection-v1'
        || selection.episode_id !== state?.episode_id
        || selection.asset_id !== item.asset_id
        || selection.generation_attempt_scope_id !== scopeId
        || selection.selected_attempt_number !== expectedFailureCount
        || !sameJson(selection.selected_generation_source, sourceBinding)
        || !sameJson(selection.selected_prompt, promptBinding)
        || selection.preserved_failure?.attempt_number !== expectedFailureCount
        || selection.preserved_failure?.error_code !== P2_SATCHEL_TOPOLOGY
        || selection.preserved_failure?.failure_reason
          !== latestWhiteCatFailure.failure_reason
        || !sameJson(selection.disclosed_gate_ids, gateIds)
        || selection.gate_effect?.selection_recorded !== true
        || selection.gate_effect?.mechanical_gate_override_consumed !== true
        || !sameJson(selection.gate_effect?.release_decision, override.decision)
        || selection.gate_effect?.consumed_transition_id
          !== override.consumption?.consumed_transition_id) {
      fail(`${label} early-acceptance selection evidence is stale`);
    }
  }
  validatePromptFixedMarkerSupplement({item, override, failures: promptMarkerFailures, label});
  const result = validateOneTimeUserGateOverride(override, {
    episodeId: state?.episode_id,
    requiredScopeId: scopeId,
    requiredGateIds: gateIds,
    requiredArtifacts: artifacts,
    fromPhase: earlyUserAcceptance ? 'visual_production' : 'awaiting_visual_asset_review',
    toPhase: 'visual_production',
    requiredStatus: 'consumed',
  });
  const blockers = assertArray(state?.blockers, 'episode blockers').filter(
    (blocker) => blocker?.blocker_id === attemptGateId,
  );
  if (earlyUserAcceptance && blockers.length !== 0) {
    fail(`${label} early acceptance has an attempt-limit blocker`);
  }
  if (!earlyUserAcceptance && (blockers.length !== 1
      || blockers[0].contract_version !== 'storyboard-image-generation-attempt-limit-v1'
      || blockers[0].asset_id !== item.asset_id
      || blockers[0].generation_attempt_scope_id !== scopeId
      || blockers[0].status !== 'failed_but_waived_once'
      || blockers[0].user_mechanical_gate_override_sha256 !== result.override_sha256)) {
    fail(`${label} attempt-limit blocker does not preserve the consumed override`);
  }
  const transitionId = override.consumption?.consumed_transition_id;
  if (typeof transitionId !== 'string'
      || consumedTransitionIdCount(state, transitionId) !== 1) {
    fail(`${label} override transition ID is missing or reused`);
  }
  return {
    result: 'pass_with_user_override',
    mechanical_qa_result: item.mechanical_qa_result,
    override_sha256: result.override_sha256,
    gate_ids: gateIds,
    bound_artifacts: artifacts,
    ...(expectedPromptContractQa === undefined ? {} : {
      prompt_contract_qa: structuredClone(expectedPromptContractQa),
    }),
  };
};

export const validateVisibleSymbolOverrideEvidence = ({
  repositoryRoot,
  episodeWorkspace,
  state,
  item,
  qa,
}) => {
  const label = `asset ${item?.asset_id}`;
  if (item?.visual_generation_route !== 'imagegen'
      || item.white_cat_present !== true
      || typeof item.asset_id !== 'string'
      || typeof item.generation_attempt_scope_id !== 'string') {
    fail(`${label} is not an eligible visible-symbol override target`);
  }
  if (item.mechanical_qa_result !== 'failed_but_waived_once'
      || item.user_mechanical_gate_override_result !== 'pass_with_user_override'
      || !item.user_mechanical_gate_override
      || qa?.contract_version !== 'ordinary-imagegen-white-cat-action-qa-v2'
      || qa.result !== 'fail'
      || qa.asset_id !== item.asset_id
      || qa.identity_qa?.result !== 'pass') {
    fail(`${label} visible-symbol failed-but-waived disposition is incomplete`);
  }
  requireSameJson(qa.identity_qa, item.identity_qa, `${label} passing identity QA`);
  const visible = qa.visible_text_qa;
  if (visible?.result !== 'fail'
      || visible.no_visible_text !== true
      || visible.no_pseudotext !== true
      || visible.no_decorative_symbols !== false) {
    fail(`${label} does not preserve the exact visible-symbol failure`);
  }
  requireSameJson(visible, item.visible_text_qa, `${label} visible-symbol QA`);
  requireSameJson(qa.selected_source, {
    path: item.path,
    checksum_sha256: item.checksum_sha256,
    ...(qa.selected_source?.dimensions === undefined
      ? {} : {dimensions: qa.selected_source.dimensions}),
    ...(qa.selected_source?.relative_aspect_ratio_error === undefined
      ? {} : {relative_aspect_ratio_error: qa.selected_source.relative_aspect_ratio_error}),
  }, `${label} selected source`);
  requireSameJson(qa.selected_prompt, {
    path: item.prompt_path,
    checksum_sha256: item.prompt_checksum_sha256,
  }, `${label} selected prompt`);

  const scopeId = item.generation_attempt_scope_id;
  const attemptControl = item.image_generation_attempt_control;
  const generationFailures = assertArray(
    item.image_generation_qa_failures,
    `${label} generation failures`,
  );
  if (attemptControl?.contract_version !== 'storyboard-image-generation-attempt-limit-v1'
      || attemptControl.generation_attempt_scope_id !== scopeId
      || attemptControl.maximum_automatic_rejected_generations !== 3
      || attemptControl.rejected_generation_count !== 3
      || attemptControl.automatic_retry_status !== 'stopped_user_takeover_required'
      || generationFailures.length !== 3
      || new Set(generationFailures.map((failure) => failure?.output?.checksum_sha256)).size !== 3) {
    fail(`${label} visible-symbol attempt-limit history is stale`);
  }
  const latestFailure = generationFailures[2];
  if (!sameJson(latestFailure?.output, {
    path: item.path,
    checksum_sha256: item.checksum_sha256,
  }) || !sameJson(latestFailure?.prompt, {
    path: item.prompt_path,
    checksum_sha256: item.prompt_checksum_sha256,
  })) {
    fail(`${label} selected source is not the exact third failed output`);
  }
  const expectedWaivableFailures = [{
    error_code: 'VISIBLE_SYMBOL_FREE',
    observed_result: 'fail',
    reason: latestFailure.failure_reason,
  }];
  requireSameJson(
    qa.waivable_mechanical_failures,
    expectedWaivableFailures,
    `${label} visible-symbol failure`,
  );
  const inspection = qa.identity_qa?.anatomy_evidence?.inspection_evidence;
  if (inspection?.methods?.join(',') !== 'full_resolution,numbered_limb_map'
      || inspection.numbered_limb_map_source_checksum_sha256 !== item.checksum_sha256
      || !sameJson(inspection.numbered_limb_map_limb_ids, ['F1', 'F2', 'H1', 'H2'])) {
    fail(`${label} numbered limb-map evidence is stale`);
  }
  const artifacts = [
    {path: item.path, checksum_sha256: item.checksum_sha256},
    {path: item.prompt_path, checksum_sha256: item.prompt_checksum_sha256},
    {path: item.qa_evidence_path, checksum_sha256: item.qa_evidence_checksum_sha256},
    {
      path: inspection.numbered_limb_map_path,
      checksum_sha256: inspection.numbered_limb_map_checksum_sha256,
    },
  ];
  for (const binding of [latestFailure.output, latestFailure.prompt]) {
    if (!binding || typeof binding !== 'object') fail(`${label} failed artifact binding is missing`);
    if (!artifacts.some((artifact) => sameJson(artifact, binding))) {
      artifacts.push({path: binding.path, checksum_sha256: binding.checksum_sha256});
    }
  }
  artifacts.forEach((artifact, index) => requireCurrentFile(
    repositoryRoot,
    artifact.path,
    artifact.checksum_sha256,
    `${label} override artifact ${index}`,
    {episodeWorkspace},
  ));
  requireSameJson(item.override_bound_artifacts, artifacts, `${label} override artifacts`);

  const attemptGateId = `storyboard-image-generation-attempt-limit:${scopeId}`;
  const visibleSymbolGateId = `visual_asset.${item.asset_id}.VISIBLE_SYMBOL_FREE`;
  const gateIds = [attemptGateId, visibleSymbolGateId];
  requireSameJson(item.waived_mechanical_gate_ids, gateIds, `${label} waived gate IDs`);
  const override = item.user_mechanical_gate_override;
  requireSameJson(override.gate_ids, gateIds, `${label} override gate IDs`);
  const failureByGate = new Map(
    (override.acknowledged_failures ?? []).map((failure) => [failure?.gate_id, failure]),
  );
  if (failureByGate.get(attemptGateId)?.observed_result
        !== 'stopped_user_takeover_required'
      || failureByGate.get(visibleSymbolGateId)?.reason !== latestFailure.failure_reason) {
    fail(`${label} override does not preserve the exact failed results`);
  }
  const message = String(override.decision?.exact_user_message ?? '').toLowerCase();
  if (!message.includes(item.asset_id.toLowerCase())
      || !['可见符号', '符号', '图案', '浮雕'].some((marker) => message.includes(marker))
      || !['三次', '3次', '重试', 'attempt'].some((marker) => message.includes(marker))
      || !['放行', '接受', '允许'].some((marker) => message.includes(marker))) {
    fail(`${label} override decision is not asset/visible-symbol/attempt-limit specific`);
  }
  const result = validateOneTimeUserGateOverride(override, {
    episodeId: state?.episode_id,
    requiredScopeId: scopeId,
    requiredGateIds: gateIds,
    requiredArtifacts: artifacts,
    fromPhase: 'awaiting_visual_asset_review',
    toPhase: 'visual_production',
    requiredStatus: 'consumed',
  });
  const blockers = assertArray(state?.blockers, 'episode blockers').filter(
    (blocker) => blocker?.blocker_id === attemptGateId,
  );
  if (blockers.length !== 1
      || blockers[0].contract_version !== 'storyboard-image-generation-attempt-limit-v1'
      || blockers[0].asset_id !== item.asset_id
      || blockers[0].generation_attempt_scope_id !== scopeId
      || blockers[0].status !== 'failed_but_waived_once'
      || blockers[0].user_mechanical_gate_override_sha256 !== result.override_sha256) {
    fail(`${label} attempt-limit blocker does not preserve the consumed override`);
  }
  const transitionId = override.consumption?.consumed_transition_id;
  if (typeof transitionId !== 'string'
      || consumedTransitionIdCount(state, transitionId) !== 1) {
    fail(`${label} override transition ID is missing or reused`);
  }
  return {
    result: 'pass_with_user_override',
    mechanical_qa_result: item.mechanical_qa_result,
    override_sha256: result.override_sha256,
    gate_ids: gateIds,
    bound_artifacts: artifacts,
  };
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
  const queue = assertArray(review.queue, 'visual_asset_review.queue').filter(
    (item) => item?.active_for_current_storyboard !== false && item?.status !== 'superseded',
  );
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
      const itemWasWaived = item?.mechanical_qa_result === 'failed_but_waived_once'
        || item?.user_mechanical_gate_override_result === 'pass_with_user_override'
        || item?.user_mechanical_gate_override !== undefined;
      const preapprovalQaStatus = asset?.preapproval_qa_status
        ?? (itemWasWaived ? null : 'qa_passed_pending_final_review');
      const expectedOverrideSha256 = item?.user_mechanical_gate_override?.override_sha256;
      if (!item
          || asset?.asset_id !== item.asset_id
          || asset.path !== item.path
          || asset.checksum_sha256 !== item.checksum_sha256
          || asset.qa_status !== 'approved'
          || (itemWasWaived
            ? (preapprovalQaStatus !== 'qa_failed_but_waived_once_pending_final_review'
              || asset.mechanical_qa_result !== 'failed_but_waived_once'
              || asset.user_mechanical_gate_override_result !== 'pass_with_user_override'
              || asset.user_mechanical_gate_override_sha256 !== expectedOverrideSha256
              || !SHA256.test(expectedOverrideSha256 ?? ''))
            : (preapprovalQaStatus !== 'qa_passed_pending_final_review'
              || asset.mechanical_qa_result !== undefined
              || asset.user_mechanical_gate_override_result !== undefined
              || asset.user_mechanical_gate_override_sha256 !== undefined))
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
        qa_status: preapprovalQaStatus,
        ...(itemWasWaived ? {
          mechanical_qa_result: asset.mechanical_qa_result,
          user_mechanical_gate_override_result: asset.user_mechanical_gate_override_result,
          user_mechanical_gate_override_sha256: asset.user_mechanical_gate_override_sha256,
        } : {}),
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
      || item.qa_contract_version !== 'ian-layered-scene-qa-v2') {
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
    visibleTextMode: item.visible_text_mode,
    exactVisibleText: item.exact_visible_text,
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
    {
      member_role: 'source-master',
      layer_id: 'source-master',
      ...manifest.master_generation.source_master,
    },
    {
      member_role: 'normalized-master',
      layer_id: 'normalized-master',
      ...manifest.normalized_master,
    },
    {member_role: 'background', layer_id: 'background', ...manifest.background},
    ...manifest.pre_text_layers.map((layer) => ({member_role: 'pre-text-layer', ...layer})),
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
  const generationLineage = item.generation_lineage;
  if (!Array.isArray(generationLineage)
      || generationLineage.length !== 1
      || generationLineage.some((stage) => (
        !stage
        || JSON.stringify(Object.keys(stage).sort()) !== JSON.stringify([
          'generation_mode', 'model_id', 'output', 'prompt',
          'reference_inputs', 'selection_status', 'stage',
        ])
        || stage.stage !== 'complete-master-generation'
        || stage.generation_mode !== 'codex-native-imagegen-gpt-image-2-text-free-master-v1'
        || stage.model_id !== 'gpt-image-2'
        || stage.selection_status !== 'selected'
        || !sameJson(stage.prompt, manifest.master_generation.prompt)
        || !sameJson(stage.reference_inputs, item.actual_reference_inputs)
        || !sameJson(stage.output, {
          path: manifest.master_generation.source_master.path,
          checksum_sha256: manifest.master_generation.source_master.checksum_sha256,
        })
      ))) {
    fail(`asset ${item.asset_id} Ian source master lacks gpt-image-2 generation lineage`);
  }
  const reviewPayload = {
    contract_version: IAN_LAYERED_SCENE_PACKAGE_VERSION,
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
  state,
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
  const rawReferences = assertArray(
    item.actual_reference_inputs,
    `asset ${item.asset_id} references`,
  );
  if (item.visual_generation_route === 'ian-handdrawn-ppt'
      && (rawReferences.length !== 1
        || rawReferences[0]?.role !== 'visual_style_reference_only'
        || rawReferences[0]?.path !== IAN_CANONICAL_STYLE_ANCHOR_PATH)) {
    fail(`asset ${item.asset_id} must bind the single canonical Ian style anchor`);
  }
  const references = rawReferences.map(
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
  const qa = inspectQaEvidence({repositoryRoot, episodeWorkspace, item, state});
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
  const staticSpread = isFlipbookRow(item)
    ? await inspectStaticSpreadAsset({repositoryRoot, state, item}) : null;
  const ian = !isFlipbookRow(item) && item.visual_generation_route === 'ian-handdrawn-ppt'
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
  if (staticSpread !== null) {
    const approvedSpread = reviewMode === 'one_click_final_review_v1'
      ? finalReviewAsset.static_spread_review
      : batchManifest.artifact === null ? item.approved_static_spread_review
        : batchManifest.artifact.record.assets.find((asset) => asset.asset_id === item.asset_id)?.static_spread_review;
    if (!sameJson(approvedSpread, staticSpread)) fail(`asset ${item.asset_id} static spread approval is stale`);
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
    static_spread: staticSpread,
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
  if (item.asset_kind === 'hero_pose') {
    if (metadata.hasAlpha !== true) {
      fail(`${label} hero_pose source must be a full-canvas transparent PNG`);
    }
    const {data, info} = await sharp(source.resolved, {failOn: 'error'})
      .ensureAlpha()
      .raw()
      .toBuffer({resolveWithObject: true});
    let minAlpha = 255;
    let maxAlpha = 0;
    let transparentPixelCount = 0;
    let nontransparentPixelCount = 0;
    for (let offset = info.channels - 1; offset < data.length; offset += info.channels) {
      const alpha = data[offset];
      minAlpha = Math.min(minAlpha, alpha);
      maxAlpha = Math.max(maxAlpha, alpha);
      if (alpha === 0) transparentPixelCount += 1;
      else nontransparentPixelCount += 1;
    }
    const measuredAlpha = {
      width: info.width,
      height: info.height,
      min_alpha: minAlpha,
      max_alpha: maxAlpha,
      transparent_pixel_count: transparentPixelCount,
      nontransparent_pixel_count: nontransparentPixelCount,
    };
    if (minAlpha !== 0 || maxAlpha <= 0
        || transparentPixelCount < 1 || nontransparentPixelCount < 1
        || !sameJson(item.transparent_pose_qa?.measured_alpha, measuredAlpha)) {
      fail(`${label} hero_pose alpha pixels differ from its measured transparent-subject evidence`);
    }
  }
  const measuredDimensions = [metadata.width, metadata.height];
  if (!sameJson(measuredDimensions, item.measured_dimensions)
      || (!oneClick && !sameJson(measuredDimensions, item.approval_disk_measured_dimensions))) {
    fail(`${label} source dimensions differ from approval evidence`);
  }
  let aspect;
  if (!isFlipbookRow(item) && item.visual_generation_route === 'ian-handdrawn-ppt') {
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
    asset_kind: item.asset_kind ?? null,
    state_index: item.asset_kind === 'hero_pose_background'
      ? null
      : (item.state_index ?? 0),
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
    ...(reviewEvidence.qa_evidence.mechanical_override === null ? {} : {
      mechanical_qa: structuredClone(reviewEvidence.qa_evidence.mechanical_override),
    }),
  };

  if (isFlipbookRow(item)) {
    return {...common, presentation_mode: item.presentation_mode, static_spread: structuredClone(item.static_spread),
      static_spread_review: reviewEvidence.static_spread,
      production: {path: source.source.relative, checksum_sha256: source.approved, dimensions: source.measuredDimensions, fit: 'contain'},
      normalization_evidence: null};
  }
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

export const buildScenes = ({
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
    const heroBackgroundItems = shotQueue.filter(
      (item) => item.asset_kind === 'hero_pose_background',
    );
    const stateQueue = shotQueue.filter(
      (item) => item.asset_kind !== 'hero_pose_background',
    );
    const isHeroPose = rhythmShot.motion_tier === 'hero_pose';
    if (isHeroPose ? heroBackgroundItems.length !== 1 : heroBackgroundItems.length !== 0) {
      fail(`shot ${shotId} hero_pose background coverage is incomplete or misplaced`);
    }
    const heroBackgroundItem = heroBackgroundItems[0] ?? null;
    if (heroBackgroundItem !== null && (
      heroBackgroundItem.role !== 'base/master'
      || heroBackgroundItem.state_index !== null
      || heroBackgroundItem.white_cat_present !== false
      || heroBackgroundItem.strict_review !== true
      || heroBackgroundItem.has_downstream_action_variants !== true
      || !sameJson(heroBackgroundItem.depends_on, [])
      || heroBackgroundItem.qa_contract_version
        !== 'ordinary-imagegen-hero-pose-background-qa-v1'
    )) {
      fail(`shot ${shotId} hero_pose background queue contract is invalid`);
    }
    stateQueue.sort((left, right) => (left.state_index ?? 0) - (right.state_index ?? 0));
    const stateIndexes = stateQueue.map((item) => item.state_index ?? 0);
    requireSameJson(stateIndexes, stateIndexes.map((_, index) => index), `shot ${shotId} state indexes`);
    for (const item of shotQueue) {
      if (isFlipbookRow(row) !== isFlipbookRow(item)
        || (isFlipbookRow(row) && !sameJson(item.static_spread, row.static_spread))) {
        fail(`shot ${shotId} static spread queue binding is stale`);
      }
      const isHeroBackground = item === heroBackgroundItem;
      if (item.scene_class !== row.scene_class
          || item.visual_generation_route !== selected.visual_generation_route
          || item.visual_structure_id !== selected.visual_structure_id
          || item.treatment_profile_id !== selected.treatment_profile_id
          || item.white_cat_present !== (isHeroBackground ? false : selected.white_cat_present)
          || (item.white_cat_visual_style_id ?? null)
            !== (selected.white_cat_visual_style_id ?? null)
          || (item.white_cat_visual_style_selection_sha256 ?? null)
            !== (selected.white_cat_visual_style_selection_sha256 ?? null)
          || (item.visual_cohesion_profile_id ?? null)
            !== (selected.visual_cohesion_profile_id ?? null)
          || item.visible_text_mode !== selected.visible_text_mode
          || item.exact_visible_text !== selected.exact_visible_text
          || item.visible_text_placement !== selected.visible_text_placement
          || item.shot_start_frame !== rhythmShot.start_frame
          || item.shot_end_frame !== rhythmShot.end_frame
          || item.narration_source_text !== storyboardSourceTexts.get(shotId)) {
        fail(`shot ${shotId} queue item ${item.asset_id} conflicts with approved direction or rhythm`);
      }
    }
    if (isHeroPose && stateQueue.some((item, index) => (
      item.asset_kind !== 'hero_pose'
      || item.role !== `action-${String(index + 1).padStart(2, '0')}`
      || item.strict_review !== false
      || !sameJson(item.depends_on, [heroBackgroundItem.asset_id])
    ))) {
      fail(`shot ${shotId} hero_pose occurrence queue contract is invalid`);
    }
    const imageSequence = stateQueue.map((item) => {
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
          || (isHeroPose
            && (schedule.background_asset_id !== heroBackgroundItem.schedule_background_asset_id
              || heroBackgroundItem.motion_tier !== 'hero_pose'
              || heroBackgroundItem.action_state_schedule_contract_version
                !== schedule.contract_version
              || heroBackgroundItem.action_state_plan_sha256 !== statePlanSha256))
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
        const item = stateQueue[index];
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
        const from = stateQueue[index];
        const to = stateQueue[index + 1];
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
        || rhythmShot.motion_tier !== (isFlipbookRow(row) ? 'static_spread' : 'layered')
        || rhythmShot.intra_shot_transition_plan.length !== 0) {
      fail(`shot ${shotId} has multiple assets without a validated v3 action-state schedule`);
    }

    let ianLayeredScene = null;
    if (!isFlipbookRow(row) && selected.visual_generation_route === 'ian-handdrawn-ppt') {
      const productionAsset = assetById.get(stateQueue[0].asset_id);
      if (imageSequence.length !== 1
          || productionAsset?.ian_layered_scene?.contract_version
            !== 'ian-static-layered-scene-v1') {
        fail(`shot ${shotId} lacks one validated Ian layered-scene package`);
      }
      ianLayeredScene = structuredClone(productionAsset.ian_layered_scene);
    } else if (shotQueue.some((item) => assetById.get(item.asset_id)?.ian_layered_scene != null)) {
      fail(`shot ${shotId} non-Ian route carries an Ian layered-scene package`);
    }

    let heroPoseBackground = null;
    if (heroBackgroundItem !== null) {
      const productionAsset = assetById.get(heroBackgroundItem.asset_id);
      if (!productionAsset) fail(`shot ${shotId} lacks its hero_pose background production asset`);
      heroPoseBackground = {
        asset_id: productionAsset.asset_id,
        schedule_background_asset_id: heroBackgroundItem.schedule_background_asset_id,
        asset: productionAsset.production.path,
        checksum_sha256: productionAsset.production.checksum_sha256,
        visual_generation_route: selected.visual_generation_route,
      };
    }

    return {
      shot_id: shotId,
      scene_class: row.scene_class,
      narration_source_text: storyboardSourceTexts.get(shotId),
      ...(isFlipbookRow(row) ? {presentation_mode: row.presentation_mode, static_spread: structuredClone(row.static_spread)} : {}),
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
      ...(heroPoseBackground === null ? {} : {hero_pose_background: heroPoseBackground}),
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
  const openingContract = resolveTimelineOpeningContract(state);
  const directFirst = openingContract === DIRECT_FIRST_SHOT_CONTRACT;
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
  const coverEvidence = directFirst ? null : normalizeRootRelative(
    coverEvidenceRelative ?? defaults.coverEvidence,
    'cover evidence path',
  );
  const normalizations = normalizeRootRelative(
    normalizationDirectory ?? defaults.normalizationDirectory,
    'normalization directory',
  );
  if (coverEvidence !== null) {
    resolveEpisodeRelative(
      repositoryRoot,
      workspace,
      coverEvidence,
      'cover evidence path',
    );
  }
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
  const storyboardSourceTexts = parseStoryboardSourceTexts(
    fs.readFileSync(storyboard.resolved, 'utf8'),
    openingContract,
  );
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
  const styleBinding = direction.value.white_cat_visual_style_binding ?? null;
  if (styleBinding !== null) {
    const styleSelection = state.white_cat_visual_style_selection;
    const styleValidation = validateWhiteCatVisualStyleSelection(styleSelection, {
      gate2ScriptSha256: styleSelection?.gate2_script_sha256,
    });
    if (styleBinding.contract_version !== styleSelection.contract_version
      || styleBinding.style_id !== styleSelection.style_id
      || styleBinding.treatment_profile_id !== styleSelection.treatment_profile_id
      || styleBinding.visual_cohesion_profile_id !== styleSelection.visual_cohesion_profile_id
      || styleBinding.selection_sha256 !== styleValidation.selection_sha256) {
      fail('visual direction white-cat style binding differs from Gate 2 selection');
    }
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
      state,
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
  const cover = directFirst ? null : await inspectCover({
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
  if (directFirst && (scenes[0]?.shot_id !== 'S01'
      || scenes[0]?.visual_rhythm?.row?.start_frame !== 0)) {
    fail('direct-first-shot-v1 requires S01 to begin at frame zero');
  }
  const sceneTransitions = inspectSceneTransitions(
    transitions.value,
    scenes,
    {oneClick, policySha256},
  );
  const approvalLock = sourceApprovalLock(review, queue);
  const waivedBlockerIds = new Set(
    assets
      .map((asset) => asset.mechanical_qa?.gate_ids?.[0] ?? null)
      .filter((gateId) => gateId?.startsWith('storyboard-image-generation-attempt-limit:')),
  );
  const stateBlockers = assertArray(state.blockers ?? [], 'episode blockers');
  if (stateBlockers.length !== waivedBlockerIds.size
      || stateBlockers.some((blocker) => (
        !waivedBlockerIds.has(blocker?.blocker_id)
        || blocker.status !== 'failed_but_waived_once'
      ))) {
    fail('episode blockers contain unresolved or unbound visual failures');
  }

  const value = {
    contract_version: VISUAL_MANIFEST_CONTRACT,
    result: approvalLock.result,
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
        ...(direction.value.white_cat_visual_style_binding === undefined
          ? {}
          : {white_cat_visual_style_binding:
            structuredClone(direction.value.white_cat_visual_style_binding)}),
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
    ...(directFirst ? {
      timeline_opening: {
        contract_version: DIRECT_FIRST_SHOT_CONTRACT,
        first_shot_id: 'S01',
        start_frame: 0,
        fixed_opening_cover: false,
        publishing_cover_included: false,
      },
    } : {cover}),
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
  const waivedBlockerIds = new Set(
    manifest.assets
      .map((asset) => asset.mechanical_qa?.gate_ids?.[0] ?? null)
      .filter((gateId) => gateId?.startsWith('storyboard-image-generation-attempt-limit:')),
  );
  if (state.visual_asset_review?.status !== 'locked' || !Array.isArray(state.blockers)
      || state.blockers.length !== waivedBlockerIds.size
      || state.blockers.some((blocker) => (
        !waivedBlockerIds.has(blocker?.blocker_id)
        || blocker.status !== 'failed_but_waived_once'
      ))) {
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
      || !['pass', 'pass_with_user_override'].includes(manifest.result)) {
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
    result: manifest.result,
    manifest_path: selectedManifest,
    manifest_checksum_sha256: manifestChecksum,
    active_asset_count: manifest.counts.active_asset_count,
    scene_count: manifest.counts.scene_count,
    intra_shot_transition_count: manifest.counts.intra_shot_transition_count,
    ordinary_scene_transition_count: manifest.counts.ordinary_scene_transition_count,
    ...(manifest.timeline_opening?.contract_version === DIRECT_FIRST_SHOT_CONTRACT ? {
      direct_first_shot_contract: DIRECT_FIRST_SHOT_CONTRACT,
      publishing_cover_included: false,
    } : {
      cover_deterministic_rerun_identical: manifest.cover.deterministic_rerun_identical,
    }),
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
      if (context.value.cover !== undefined) {
        nextState.opening_cover_production = coverProductionState(context.value.cover, lockedAt);
      }
      nextState.active_visual_manifest = {
        status: 'active_locked',
        contract_version: VISUAL_MANIFEST_CONTRACT,
        path: context.manifestRelative,
        checksum_sha256: manifestChecksum,
        active_asset_count: context.value.counts.active_asset_count,
        input_storyboard_path: context.value.provenance.approved_storyboard.path,
        input_storyboard_checksum_sha256: context.value.provenance.approved_storyboard.checksum_sha256,
        narration_master_checksum_sha256: context.value.provenance.narration_master.checksum_sha256,
        qa_result: context.value.result === 'pass_with_user_override'
          ? 'pass_with_user_override'
          : 'pass_current_approved_bytes_and_production_rasters',
        locked_at: lockedAt,
      };
      nextState.visual_assets_lock = {
        ...context.value.approval_lock,
        manifest_path: context.manifestRelative,
        manifest_checksum_sha256: manifestChecksum,
        ...(context.value.cover === undefined ? {} : {
          opening_cover_evidence_path: context.value.cover.normalization_evidence.path,
          opening_cover_evidence_checksum_sha256:
            context.value.cover.normalization_evidence.checksum_sha256,
        }),
        locked_at: lockedAt,
        validator_confirmed_at: lockedAt,
        verification_sha256_pending_validator_confirmation: false,
      };
      nextState.visual_asset_review.status = 'locked';
      if (!oneClickCaptionLock) {
        nextState.phase = 'visual_assets_locked';
        nextState.current_phase = 'visual_assets_locked';
      }
      const waivedBlockerIds = new Set(
        context.value.assets
          .map((asset) => asset.mechanical_qa?.gate_ids?.[0] ?? null)
          .filter((gateId) => gateId?.startsWith('storyboard-image-generation-attempt-limit:')),
      );
      nextState.blockers = (nextState.blockers ?? []).filter(
        (blocker) => waivedBlockerIds.has(blocker?.blocker_id),
      );
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
        result: context.value.result,
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
