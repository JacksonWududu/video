import crypto from 'node:crypto';
import {isFlipbookRow, FLIPBOOK_STYLE_ID} from '../flipbook-video/profile.mjs';
import {FLIPBOOK_BODY_TEXT_CONTRACT, validateStaticSpread} from '../storyboard/static-spread.mjs';

export const VISIBLE_TEXT_BATCH_REVIEW_VERSION = 'visible-text-batch-review-v1';
export const CONCISE_VISIBLE_TEXT_STYLE_VERSION = 'concise-summary-visible-text-v1';

const SHA256 = /^[a-f0-9]{64}$/;
const NON_APPROVAL_MESSAGES = new Set([
  '继续', '默认', '你看着办', '按推荐来', '照推荐', '随便', '都行', '可以', '好的',
  'ok', 'okay',
]);
const SPOKEN_MARKERS = Object.freeze([
  '你看', '你会发现', '你可以', '我们', '咱们', '大家', '其实', '说白了',
  '换句话说', '也就是说', '简单来说', '然后呢', '那么', '所以说', '这就是',
  '有没有', '怎么办', '来看', '想一想', '别急',
]);
const PROSE_PUNCTUATION = /[。！？!?；;]/gu;
const TERMINAL_PARTICLE = /[吧嘛呢呀啊哦啦呗]$/u;

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
};

const canonicalJson = (value) => JSON.stringify(canonicalize(value));
const sha256Canonical = (value) => crypto
  .createHash('sha256')
  .update(canonicalJson(value))
  .digest('hex');
const sha256Text = (value) => crypto.createHash('sha256').update(value).digest('hex');

const requireObject = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
};

const requireNonEmptyString = (value, label) => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
};

const requireTimestamp = (value, label) => {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be an ISO-8601 timestamp`);
  }
  return value;
};

const sameCanonical = (left, right) => canonicalJson(left) === canonicalJson(right);
const nonWhitespaceCodePoints = (value) => Array.from(value).filter((character) => !/\s/u.test(character));

const normalizedText = (value) => value
  .normalize('NFKC')
  .replace(/[\p{P}\s]/gu, '')
  .toLowerCase();

export const validateConciseSummaryVisibleText = (
  exactVisibleText,
  {shotId = 'visible text', sourceText = null} = {},
) => {
  requireNonEmptyString(exactVisibleText, `${shotId} exact visible text`);
  if (exactVisibleText !== exactVisibleText.trim()) {
    throw new Error(`${shotId} concise visible text must not have outer whitespace`);
  }
  if (/\r/u.test(exactVisibleText)) {
    throw new Error(`${shotId} concise visible text must use LF line breaks`);
  }
  const lines = exactVisibleText.split('\n');
  if (lines.length > 2 || lines.some((line) => line.trim() === '')) {
    throw new Error(`${shotId} concise visible text permits at most two lines with no empty line`);
  }
  const lineCounts = lines.map((line) => nonWhitespaceCodePoints(line).length);
  const characterCount = nonWhitespaceCodePoints(exactVisibleText).length;
  if (characterCount > 28) {
    throw new Error(`${shotId} concise visible text permits at most 28 non-whitespace code points`);
  }
  const punctuationMatches = exactVisibleText.match(PROSE_PUNCTUATION) ?? [];
  const colloquialMarkers = SPOKEN_MARKERS.filter((marker) => exactVisibleText.includes(marker));
  if (/^[我你](?!国)/u.test(exactVisibleText)) colloquialMarkers.push(exactVisibleText[0]);
  if (TERMINAL_PARTICLE.test(exactVisibleText)) colloquialMarkers.push('sentence-final-particle');
  if (punctuationMatches.length > 0 || colloquialMarkers.length > 0) {
    throw new Error(`${shotId} contains spoken or prose-like visible text`);
  }
  return {
    contract_version: CONCISE_VISIBLE_TEXT_STYLE_VERSION,
    result: 'pass',
    line_count: lines.length,
    non_whitespace_code_point_count: characterCount,
    maximum_line_code_point_count: Math.max(...lineCounts),
    prose_punctuation_matches: [],
    colloquial_marker_matches: [],
    source_text_exact_match: typeof sourceText === 'string'
      ? normalizedText(exactVisibleText) === normalizedText(sourceText)
      : null,
  };
};

const validateBinding = (binding, label) => {
  requireObject(binding, label);
  requireNonEmptyString(binding.path, `${label} path`);
  if (!SHA256.test(binding.checksum_sha256 ?? '')) {
    throw new Error(`${label} checksum must be a lowercase SHA-256`);
  }
  return binding;
};

const buildExpectedRows = ({summaryRows, visualDirectionReview}) => {
  if (!Array.isArray(summaryRows) || summaryRows.length < (isFlipbookRow(visualDirectionReview) ? 1 : 2)) {
    throw new Error('visible-text batch review requires the complete storyboard Summary');
  }
  if (!Array.isArray(visualDirectionReview?.rows) || visualDirectionReview.rows.length === 0) {
    throw new Error('visible-text batch review requires visual-direction rows');
  }
  const generatedSummaryRows = summaryRows.filter((row) => row.shot_id !== 'OPEN-00');
  if (generatedSummaryRows.length !== visualDirectionReview.rows.length
    || generatedSummaryRows.some((row, index) => row.shot_id !== visualDirectionReview.rows[index]?.shot_id)) {
    throw new Error('visible-text batch review source maps do not cover the same active shot set');
  }
  return visualDirectionReview.rows.map((row, index) => {
    const summaryRow = generatedSummaryRows[index];
    if (isFlipbookRow(row) !== isFlipbookRow(visualDirectionReview)) {
      throw new Error(`${row.shot_id} static spread body lacks episode presentation binding`);
    }
    if (isFlipbookRow(row)) {
      validateStaticSpread(row.static_spread, {sourceText: summaryRow.locked_narration, shotId: row.shot_id});
      if (!sameCanonical(row.static_spread, row.user_selection?.static_spread)
        || !isFlipbookRow(row.user_selection)) {
        throw new Error(`${row.shot_id} static spread body differs from its approved selection`);
      }
    }
    const selection = requireObject(row.user_selection, `${row.shot_id} visual-direction selection`);
    const mode = selection.visible_text_mode;
    if (!['none', 'required'].includes(mode)) {
      throw new Error(`${row.shot_id} visible text mode must be none or required`);
    }
    const exactVisibleText = selection.exact_visible_text ?? null;
    const placement = selection.visible_text_placement ?? null;
    if (mode === 'none') {
      if (exactVisibleText !== null || placement !== null || summaryRow.visible_text !== '无') {
        throw new Error(`${row.shot_id} no-text selection is inconsistent with the storyboard Summary`);
      }
    } else {
      requireNonEmptyString(exactVisibleText, `${row.shot_id} exact visible text`);
      requireNonEmptyString(placement, `${row.shot_id} visible text placement`);
      if (summaryRow.visible_text !== exactVisibleText) {
        throw new Error(`${row.shot_id} visible text differs between direction selection and Summary`);
      }
    }
    return {
      shot_id: row.shot_id,
      ...(isFlipbookRow(row) ? {
        presentation_mode: FLIPBOOK_STYLE_ID,
        body_text_contract: FLIPBOOK_BODY_TEXT_CONTRACT,
        static_spread: structuredClone(row.static_spread),
      } : {}),
      visible_text_mode: mode,
      exact_visible_text: exactVisibleText,
      visible_text_placement: placement,
      source_text_sha256: sha256Text(summaryRow.locked_narration),
      text_style_contract: CONCISE_VISIBLE_TEXT_STYLE_VERSION,
      text_style_qa: mode === 'required'
        ? validateConciseSummaryVisibleText(exactVisibleText, {
            shotId: row.shot_id,
            sourceText: summaryRow.locked_narration,
          })
        : {
            contract_version: CONCISE_VISIBLE_TEXT_STYLE_VERSION,
            result: 'not_applicable',
            line_count: 0,
            non_whitespace_code_point_count: 0,
            maximum_line_code_point_count: 0,
            prose_punctuation_matches: [],
            colloquial_marker_matches: [],
            source_text_exact_match: null,
          },
    };
  });
};

const visibleTextMapProjection = (review) => ({
  contract_version: review?.contract_version,
  episode_workspace: review?.episode_workspace,
  storyboard: review?.storyboard,
  visual_direction_review: review?.visual_direction_review,
  batch_scope: review?.batch_scope,
  row_approval_mode: review?.row_approval_mode,
  text_style_contract: review?.text_style_contract,
  rows: review?.rows,
  ...(review?.presentation_mode !== undefined ? {presentation_mode: review.presentation_mode, body_text_contract: review.body_text_contract} : {}),
});

export const buildVisibleTextBatchMapSha256 = (review) => sha256Canonical(
  visibleTextMapProjection(review),
);

export const buildPendingVisibleTextBatchReview = ({
  episodeWorkspace,
  storyboard,
  visualDirectionReviewBinding,
  visualDirectionReview,
  summaryRows,
  presentedAt,
  exactMessage,
}) => {
  requireNonEmptyString(episodeWorkspace, 'episode workspace');
  validateBinding(storyboard, 'storyboard binding');
  validateBinding(visualDirectionReviewBinding, 'visual-direction review binding');
  if (visualDirectionReview?.contract_version !== 'per-shot-visual-direction-review-v3'
    || !['approved', 'policy_authorized'].includes(visualDirectionReview.status)) {
    throw new Error('visible-text review requires a current approved or policy-authorized v3 direction map');
  }
  if (!sameCanonical(visualDirectionReview.storyboard, storyboard)
    || visualDirectionReview.presented_map_sha256 !== visualDirectionReviewBinding.presented_map_sha256) {
    throw new Error('visible-text review bindings are stale');
  }
  requireTimestamp(presentedAt, 'visible-text presentation time');
  requireNonEmptyString(exactMessage, 'visible-text presentation message');
  const review = {
    contract_version: VISIBLE_TEXT_BATCH_REVIEW_VERSION,
    episode_workspace: episodeWorkspace,
    status: 'pending',
    storyboard: structuredClone(storyboard),
    visual_direction_review: {
      path: visualDirectionReviewBinding.path,
      checksum_sha256: visualDirectionReviewBinding.checksum_sha256,
      presented_map_sha256: visualDirectionReviewBinding.presented_map_sha256,
      status: visualDirectionReview.status,
    },
    batch_scope: 'complete_active_generated_shot_visible_text_map',
    row_approval_mode: 'forbidden_batch_only',
    text_style_contract: CONCISE_VISIBLE_TEXT_STYLE_VERSION,
    ...(isFlipbookRow(visualDirectionReview) ? {presentation_mode: FLIPBOOK_STYLE_ID, body_text_contract: FLIPBOOK_BODY_TEXT_CONTRACT} : {}),
    rows: buildExpectedRows({summaryRows, visualDirectionReview}),
    presented_map_sha256: null,
    presentation: {
      exact_message: exactMessage,
      presented_at: presentedAt,
      complete_map_presented: true,
    },
    approval: null,
  };
  review.presented_map_sha256 = buildVisibleTextBatchMapSha256(review);
  return review;
};

export const approveVisibleTextBatchReview = (
  review,
  {presentedMapSha256, exactMessage, decidedAt},
) => {
  if (review?.contract_version !== VISIBLE_TEXT_BATCH_REVIEW_VERSION || review.status !== 'pending') {
    throw new Error('visible-text batch review is not pending');
  }
  const currentMapSha256 = buildVisibleTextBatchMapSha256(review);
  if (!SHA256.test(presentedMapSha256 ?? '')
    || presentedMapSha256 !== review.presented_map_sha256
    || presentedMapSha256 !== currentMapSha256) {
    throw new Error('visible-text approval targets a stale presented map');
  }
  requireNonEmptyString(exactMessage, 'visible-text approval message');
  if (NON_APPROVAL_MESSAGES.has(exactMessage.trim().toLowerCase())) {
    throw new Error('visible-text review requires explicit complete-map approval');
  }
  requireTimestamp(decidedAt, 'visible-text approval time');
  const approved = structuredClone(review);
  approved.status = 'approved';
  approved.approval = {
    status: 'approved',
    scope: 'complete_presented_map',
    presented_map_sha256: presentedMapSha256,
    exact_message: exactMessage,
    decided_at: decidedAt,
    user_has_reviewed_complete_map: true,
    row_by_row_approval_performed: false,
  };
  return approved;
};

export const validateVisibleTextBatchReview = (review, {
  episodeWorkspace,
  storyboard,
  visualDirectionReviewBinding,
  visualDirectionReview,
  summaryRows,
  requireApproved = true,
}) => {
  if (review?.contract_version !== VISIBLE_TEXT_BATCH_REVIEW_VERSION) {
    throw new Error('visible-text batch review contract is unsupported');
  }
  if (review.episode_workspace !== episodeWorkspace
    || review.batch_scope !== 'complete_active_generated_shot_visible_text_map'
    || review.row_approval_mode !== 'forbidden_batch_only'
    || review.text_style_contract !== CONCISE_VISIBLE_TEXT_STYLE_VERSION) {
    throw new Error('visible-text batch review scope or authority is invalid');
  }
  if (isFlipbookRow(review) !== isFlipbookRow(visualDirectionReview)
    || (isFlipbookRow(review) && review.body_text_contract !== FLIPBOOK_BODY_TEXT_CONTRACT)) {
    throw new Error('visible-text batch static spread body authority is stale');
  }
  validateBinding(storyboard, 'storyboard binding');
  validateBinding(visualDirectionReviewBinding, 'visual-direction review binding');
  const expectedRows = buildExpectedRows({summaryRows, visualDirectionReview});
  if (!Array.isArray(review.rows) || review.rows.length !== expectedRows.length
    || review.rows.some((row, index) => row.shot_id !== expectedRows[index].shot_id)) {
    throw new Error('visible-text batch review does not cover the complete active shot set');
  }
  if (!sameCanonical(review.storyboard, storyboard)
    || !sameCanonical(review.visual_direction_review, {
      path: visualDirectionReviewBinding.path,
      checksum_sha256: visualDirectionReviewBinding.checksum_sha256,
      presented_map_sha256: visualDirectionReviewBinding.presented_map_sha256,
      status: visualDirectionReview.status,
    })
    || !sameCanonical(review.rows, expectedRows)) {
    throw new Error('visible-text batch review does not match the current visual-direction map');
  }
  for (const row of review.rows) {
    if (['approval', 'status', 'exact_message', 'decided_at'].some((field) => Object.hasOwn(row, field))) {
      throw new Error('visible-text rows must not carry per-shot approval evidence');
    }
  }
  if (review.presentation?.complete_map_presented !== true
    || typeof review.presentation?.exact_message !== 'string'
    || review.presentation.exact_message.trim() === ''
    || typeof review.presentation?.presented_at !== 'string'
    || Number.isNaN(Date.parse(review.presentation.presented_at))) {
    throw new Error('visible-text complete-map presentation evidence is missing');
  }
  const expectedMapSha256 = buildVisibleTextBatchMapSha256(review);
  if (review.presented_map_sha256 !== expectedMapSha256) {
    throw new Error('visible-text batch review presented map is stale');
  }
  if (requireApproved) {
    if (review.status !== 'approved'
      || review.approval?.status !== 'approved'
      || review.approval?.scope !== 'complete_presented_map'
      || review.approval?.presented_map_sha256 !== expectedMapSha256
      || review.approval?.user_has_reviewed_complete_map !== true
      || review.approval?.row_by_row_approval_performed !== false
      || typeof review.approval?.exact_message !== 'string'
      || review.approval.exact_message.trim() === ''
      || typeof review.approval?.decided_at !== 'string'
      || Number.isNaN(Date.parse(review.approval.decided_at))) {
      throw new Error('visible-text batch review is not approved');
    }
  } else if (!['pending', 'approved'].includes(review.status)) {
    throw new Error('visible-text batch review status is invalid');
  }
  return {
    result: 'pass',
    status: review.status,
    row_count: review.rows.length,
    required_text_count: review.rows.filter((row) => row.visible_text_mode === 'required').length,
    presented_map_sha256: expectedMapSha256,
  };
};
