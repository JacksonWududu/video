import crypto from 'node:crypto';
import {FLIPBOOK_STYLE_ID, isFlipbookRow, isFlipbookStyle} from '../flipbook-video/profile.mjs';
import {validateStaticSpread} from '../storyboard/static-spread.mjs';

import {
  ACTIVE_ROUTE_IDS,
  CATALOG,
  CATALOG_CHECKSUM_SHA256,
  buildPresentedMapSha256,
  resolveRouteVisibleTextPolicy,
} from '../visual-generation-routes/contract.mjs';
import {
  VISUAL_LANGUAGE_CATALOG,
  VISUAL_LANGUAGE_CATALOG_CHECKSUM_SHA256,
  validateVisualLanguageSelection,
} from '../visual-language/contract.mjs';
import {validateConciseSummaryVisibleText} from '../visible-text-review/contract.mjs';
import {resolveWhiteCatVisualStyleOption} from '../workflow-approval/contract.mjs';

export const FORM_MODEL_CONTRACT_VERSION = 'visual-direction-review-form-v3';
export const SUBMISSION_CONTRACT_VERSION = 'visual-direction-form-submission-v3';
export const MERGE_REQUEST_CONTRACT_VERSION = 'storyboard-shot-merge-request-v1';
export const MERGE_RENUMBER_STRATEGY = 'compact_after_merge';
export const MERGE_VISUAL_INHERITANCE_POLICY = 'first-shot-visual-inheritance-v1';
export const MERGE_ACTION_STATE_POLICY = 'play-first-shot-action-family-once-then-hold-final-state';

const SHA256 = /^[a-f0-9]{64}$/;
const GENERATED_SHOT_ID = /^S([0-9]{2,})$/;
const SUMMARY_HEADER = ['镜头', '时长（秒）', '画面', '白猫', '分镜生成方式', '可见文字', '锁稿原文'];
const FIXED_TREATMENTS = Object.freeze({
  'xuan-paper-diorama': 'xuan-paper-diorama',
  'ian-handdrawn-ppt': 'ian-handdrawn-technical',
  'ink-doodle-knowledge-card': 'ink-doodle-knowledge-card',
  'srt-whiteboard-animation': 'whiteboard-clean-progressive',
  'local-video-file': 'source-video-native',
});
const DEFAULT_IMAGEGEN_TREATMENT = 'imagegen-watercolor-narrative';
const ROUTE_LABELS = Object.freeze(Object.fromEntries(
  CATALOG.routes
    .filter((route) => ACTIVE_ROUTE_IDS.includes(route.route_id))
    .map((route) => [route.route_id, route.label]),
));

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

const sameArray = (left, right) => Array.isArray(left)
  && Array.isArray(right)
  && left.length === right.length
  && left.every((value, index) => value === right[index]);

const sameNullable = (left, right) => (left ?? null) === (right ?? null);

const requireExactKeys = (value, expectedKeys, label) => {
  const actual = Object.keys(requireObject(value, label)).sort();
  const expected = [...expectedKeys].sort();
  if (!sameArray(actual, expected)) throw new Error(`${label} contains missing or unknown fields`);
};

const sha256Text = (value) => crypto.createHash('sha256').update(value).digest('hex');

const canonicalShotSequence = (shotIds) => {
  if (!Array.isArray(shotIds) || shotIds.length === 0) {
    throw new Error('active generated shot IDs are required');
  }
  const firstMatch = GENERATED_SHOT_ID.exec(shotIds[0]);
  if (!firstMatch) throw new Error('active generated shot IDs must use canonical uppercase S numbering');
  const width = firstMatch[1].length;
  const format = (number) => `S${String(number).padStart(width, '0')}`;
  shotIds.forEach((shotId, index) => {
    if (shotId !== format(index + 1)) {
      throw new Error('active generated shot IDs must be continuous canonical uppercase S numbering');
    }
  });
  return {width, format};
};

export const buildCompactShotMergePlan = (allShotIds, mergeShotIds) => {
  const {width, format} = canonicalShotSequence(allShotIds);
  if (!Array.isArray(mergeShotIds) || mergeShotIds.length < 2) {
    throw new Error('storyboard shot merge requires at least two shots');
  }
  if (mergeShotIds.includes('OPEN-00')) throw new Error('OPEN-00 cannot be merged');
  if (new Set(mergeShotIds).size !== mergeShotIds.length) {
    throw new Error('storyboard shot merge contains duplicate shots');
  }
  const unknown = mergeShotIds.filter((shotId) => !allShotIds.includes(shotId));
  if (unknown.length > 0) throw new Error(`storyboard shot merge contains unknown shots: ${unknown.join(', ')}`);
  const indexes = mergeShotIds.map((shotId) => allShotIds.indexOf(shotId));
  if (indexes.some((index, position) => position > 0 && index !== indexes[position - 1] + 1)) {
    throw new Error('storyboard shot merge shots must be contiguous and in active storyboard order');
  }

  const firstIndex = indexes[0];
  const lastIndex = indexes.at(-1);
  const removedShotCount = mergeShotIds.length - 1;
  const survivingShotId = mergeShotIds[0];
  const renumberMap = allShotIds.map((oldShotId, index) => {
    if (index < firstIndex) {
      return {old_shot_id: oldShotId, new_shot_id: oldShotId, disposition: 'unchanged'};
    }
    if (index === firstIndex) {
      return {old_shot_id: oldShotId, new_shot_id: survivingShotId, disposition: 'merged_survivor'};
    }
    if (index <= lastIndex) {
      return {old_shot_id: oldShotId, new_shot_id: survivingShotId, disposition: 'merged_into'};
    }
    return {
      old_shot_id: oldShotId,
      new_shot_id: format(index + 1 - removedShotCount),
      disposition: 'renumbered',
    };
  });
  const activeShotIdsAfterMerge = [
    ...allShotIds.slice(0, firstIndex),
    survivingShotId,
    ...renumberMap.slice(lastIndex + 1).map((entry) => entry.new_shot_id),
  ];
  const transitionBoundaries = activeShotIdsAfterMerge.slice(0, -1).map((sourceShotId, index) => ({
    source_shot_id: sourceShotId,
    next_shot_id: activeShotIdsAfterMerge[index + 1],
  }));
  const firstReopenedBoundaryIndex = Math.max(0, firstIndex - 1);
  return {
    renumber_strategy: MERGE_RENUMBER_STRATEGY,
    shot_id_width: width,
    surviving_shot_id: survivingShotId,
    merged_source_shot_ids: [...mergeShotIds],
    superseded_shot_ids: mergeShotIds.slice(1),
    removed_shot_count: removedShotCount,
    renumber_map: renumberMap,
    renumbered_downstream_shot_ids: renumberMap
      .filter((entry) => entry.disposition === 'renumbered')
      .map((entry) => entry.old_shot_id),
    active_shot_ids_after_merge: activeShotIdsAfterMerge,
    preserved_visual_direction_shot_ids: activeShotIdsAfterMerge.slice(0, firstIndex),
    reopened_visual_direction_shot_ids: activeShotIdsAfterMerge.slice(firstIndex),
    removed_internal_transition_boundaries: mergeShotIds.slice(0, -1).map((sourceShotId, index) => ({
      source_shot_id: sourceShotId,
      next_shot_id: mergeShotIds[index + 1],
    })),
    preserved_transition_boundaries: transitionBoundaries.slice(0, firstReopenedBoundaryIndex),
    reopened_transition_boundaries: transitionBoundaries.slice(firstReopenedBoundaryIndex),
  };
};

const decodeSummaryCell = (cell) => cell
  .replaceAll('<br>', '\n')
  .replaceAll('&#124;', '|')
  .replaceAll('&gt;', '>')
  .replaceAll('&lt;', '<')
  .replaceAll('&amp;', '&');

const splitSummaryRow = (line) => {
  if (!line.startsWith('|') || !line.endsWith('|')) return null;
  return line.slice(1, -1).split('|').map((cell) => {
    const withoutLeadingPad = cell.startsWith(' ') ? cell.slice(1) : cell;
    const withoutTablePadding = withoutLeadingPad.endsWith(' ')
      ? withoutLeadingPad.slice(0, -1)
      : withoutLeadingPad;
    return decodeSummaryCell(withoutTablePadding);
  });
};

export const parseStoryboardSummary = (storyboardMarkdown) => {
  requireNonEmptyString(storyboardMarkdown, 'storyboard Markdown');
  const lines = storyboardMarkdown.split(/\r?\n/);
  const markerIndex = lines.indexOf('## 分镜 Summary');
  if (markerIndex < 0) throw new Error('storyboard lacks the 分镜 Summary marker');
  let lineIndex = markerIndex + 1;
  while (lines[lineIndex] === '') lineIndex += 1;
  const header = splitSummaryRow(lines[lineIndex] ?? '');
  if (!sameArray(header, SUMMARY_HEADER)) throw new Error('storyboard Summary must use the exact seven-column header');
  const divider = splitSummaryRow(lines[lineIndex + 1] ?? '');
  if (!divider || divider.length !== 7 || divider.some((cell) => !/^---+$/.test(cell))) {
    throw new Error('storyboard Summary divider is invalid');
  }
  const rows = [];
  for (lineIndex += 2; lineIndex < lines.length && lines[lineIndex].startsWith('|'); lineIndex += 1) {
    const cells = splitSummaryRow(lines[lineIndex]);
    if (!cells || cells.length !== 7) throw new Error('storyboard Summary row must contain exactly seven cells');
    const [shotId, durationSeconds, visualDescription, whiteCat, route, visibleText, lockedNarration] = cells;
    if (!/^\d+(?:\.\d{3})$/.test(durationSeconds) || Number(durationSeconds) <= 0) {
      throw new Error(`${shotId} Summary duration must be a positive value with three decimal places`);
    }
    rows.push({
      shot_id: requireNonEmptyString(shotId, 'Summary shot ID'),
      duration_seconds: Number(durationSeconds),
      duration_seconds_display: durationSeconds,
      visual_description: requireNonEmptyString(visualDescription, `${shotId} Summary visual description`),
      white_cat: requireNonEmptyString(whiteCat, `${shotId} Summary white cat`),
      visual_generation_route: requireNonEmptyString(route, `${shotId} Summary route`),
      visible_text: requireNonEmptyString(visibleText, `${shotId} Summary visible text`),
      locked_narration: requireNonEmptyString(lockedNarration, `${shotId} Summary locked narration`),
    });
  }
  if (rows.length === 0) throw new Error('storyboard Summary has no rows');
  const ids = rows.map((row) => row.shot_id);
  if (new Set(ids).size !== ids.length) throw new Error('storyboard Summary contains duplicate shots');
  return rows;
};

const validatePendingReviewAuthority = (review, storyboardMarkdown) => {
  requireObject(review, 'visual direction review');
  if (review.contract_version !== 'per-shot-visual-direction-review-v3') {
    throw new Error('interactive form requires per-shot-visual-direction-review-v3');
  }
  if (review.catalog_version !== CATALOG.schema_version
    || review.catalog_checksum_sha256 !== CATALOG_CHECKSUM_SHA256) {
    throw new Error('visual direction form route catalog is stale');
  }
  if (review.visual_language_catalog_version !== VISUAL_LANGUAGE_CATALOG.schema_version
    || review.visual_language_catalog_checksum_sha256 !== VISUAL_LANGUAGE_CATALOG_CHECKSUM_SHA256) {
    throw new Error('visual direction form visual-language catalog is stale');
  }
  if (!['awaiting_user_selection', 'partially_approved', 'approved'].includes(review.status)) {
    throw new Error('visual direction review status cannot be presented in the form');
  }
  if (!Array.isArray(review.rows) || review.rows.length === 0
    || review.generated_shot_count !== review.rows.length) {
    throw new Error('visual direction review rows are incomplete');
  }
  if (!SHA256.test(review.presented_map_sha256 ?? '')
    || review.presented_map_sha256 !== buildPresentedMapSha256(review)) {
    throw new Error('visual direction presented map is stale');
  }
  if (!SHA256.test(review?.storyboard?.checksum_sha256 ?? '')
    || review.storyboard.checksum_sha256 !== sha256Text(storyboardMarkdown)) {
    throw new Error('visual direction form storyboard checksum is stale');
  }
  const flipbook = isFlipbookStyle(review.white_cat_visual_style_binding);
  if (flipbook !== isFlipbookRow(review) || review.rows.some((row) => isFlipbookRow(row) !== flipbook)) {
    throw new Error('illustrated-flipbook form rows must match the episode style');
  }
  if (flipbook) for (const row of review.rows) {
    if (row.white_cat_recommendation?.recommended !== false) throw new Error(`${row.shot_id} flipbook forbids white cat`);
    validateStaticSpread(row.static_spread, {shotId: row.shot_id});
  }
  const ids = review.rows.map((row) => row.shot_id);
  if (ids.includes('OPEN-00') || new Set(ids).size !== ids.length) {
    throw new Error('visual direction review shot IDs are invalid');
  }
};

export const compatibleRoutesForSelection = (row, whiteCatPresent) => {
  if (typeof whiteCatPresent !== 'boolean') throw new Error('white_cat_present must be boolean');
  if (isFlipbookRow(row)) return whiteCatPresent ? [] : ACTIVE_ROUTE_IDS.filter((routeId) => ['ian-handdrawn-ppt', 'imagegen'].includes(routeId));
  if (row.scene_class === 'structured_graphic') {
    if (whiteCatPresent) return [];
    return ACTIVE_ROUTE_IDS.filter((routeId) => [
      'ian-handdrawn-ppt',
      'ink-doodle-knowledge-card',
      'srt-whiteboard-animation',
      'local-video-file',
    ].includes(routeId));
  }
  if (row.scene_class !== 'narrative_illustration') {
    throw new Error(`${row.shot_id} has unsupported scene_class`);
  }
  const allowed = whiteCatPresent
    ? (row.white_cat_visual_style_id ? ['imagegen'] : ['imagegen', 'xuan-paper-diorama'])
    : ['imagegen', 'xuan-paper-diorama', 'srt-whiteboard-animation', 'local-video-file'];
  return ACTIVE_ROUTE_IDS.filter((routeId) => allowed.includes(routeId));
};

const presentedSelection = (row) => {
  const approved = row?.user_selection?.status === 'approved';
  const candidate = !approved ? row?.presented_candidate_selection : null;
  if (candidate) {
    requireObject(candidate, `${row.shot_id} presented candidate selection`);
    const compatibleRoutes = compatibleRoutesForSelection(row, candidate.white_cat_present);
    if (!compatibleRoutes.includes(candidate.visual_generation_route)) {
      throw new Error(`${row.shot_id} presented candidate route is incompatible`);
    }
    if (candidate.visible_text_mode !== row.visible_text_mode
      || !sameNullable(candidate.exact_visible_text, row.exact_visible_text)
      || !sameNullable(candidate.visible_text_placement, row.visible_text_placement)) {
      throw new Error(`${row.shot_id} presented candidate visible text differs from its map projection`);
    }
    if (!sameNullable(candidate.local_video_source_path, row.local_video_source_path)) {
      throw new Error(`${row.shot_id} presented candidate local video path differs from its map projection`);
    }
  }
  return {
    white_cat_present: candidate
      ? candidate.white_cat_present
      : (approved
      ? row.user_selection.white_cat_present
      : row.white_cat_recommendation.recommended),
    visual_structure_id: candidate
      ? candidate.visual_structure_id
      : (approved
      ? row.user_selection.visual_structure_id
      : row.visual_language_recommendation.visual_structure_id),
    treatment_profile_id: candidate
      ? candidate.treatment_profile_id
      : (approved
      ? row.user_selection.treatment_profile_id
      : row.visual_language_recommendation.treatment_profile_id),
    visual_generation_route: candidate
      ? candidate.visual_generation_route
      : (approved
      ? row.user_selection.visual_generation_route
      : row.recommended_route),
    visible_text_mode: candidate
      ? candidate.visible_text_mode
      : (approved
      ? row.user_selection.visible_text_mode
      : row.visible_text_mode),
    exact_visible_text: candidate
      ? candidate.exact_visible_text
      : (approved
      ? row.user_selection.exact_visible_text
      : row.exact_visible_text),
    visible_text_placement: candidate
      ? candidate.visible_text_placement
      : (approved
      ? row.user_selection.visible_text_placement
      : row.visible_text_placement),
    local_video_source_path: candidate
      ? (candidate.local_video_source_path ?? null)
      : (approved
      ? (row.user_selection.local_video_source_path ?? null)
      : (row.local_video_source_path ?? null)),
    white_cat_visual_style_id: row.white_cat_visual_style_id ?? null,
    white_cat_visual_style_selection_sha256: row.white_cat_visual_style_selection_sha256 ?? null,
    visual_cohesion_profile_id: row.visual_cohesion_profile_id ?? null,
  };
};

export const resolveTreatmentProfile = ({
  row,
  routeId,
  currentTreatmentProfileId,
  visualStructureId = row.visual_language_recommendation.visual_structure_id,
  whiteCatPresent = false,
}) => {
  if (routeId === 'imagegen' && whiteCatPresent && row.white_cat_visual_style_id) {
    const option = resolveWhiteCatVisualStyleOption(row.white_cat_visual_style_id);
    if (!SHA256.test(row.white_cat_visual_style_selection_sha256 ?? '')
      || row.visual_cohesion_profile_id !== option.visual_cohesion_profile_id) {
      throw new Error(`${row.shot_id} white-cat visual style binding is stale`);
    }
    validateVisualLanguageSelection({
      presentation_mode: row.presentation_mode,
      scene_class: row.scene_class,
      visual_structure_id: visualStructureId,
      treatment_profile_id: option.treatment_profile_id,
      visual_generation_route: routeId,
      white_cat_present: true,
      comic_plan: null,
    }, {requireApprovedCharacterReference: false});
    return option.treatment_profile_id;
  }
  let treatmentProfileId = FIXED_TREATMENTS[routeId];
  if (routeId === 'imagegen' && typeof currentTreatmentProfileId === 'string'
    && currentTreatmentProfileId !== '') {
    try {
      validateVisualLanguageSelection({
        presentation_mode: row.presentation_mode,
        scene_class: row.scene_class,
        visual_structure_id: visualStructureId,
        treatment_profile_id: currentTreatmentProfileId,
        visual_generation_route: 'imagegen',
        white_cat_present: whiteCatPresent,
        comic_plan: null,
      }, {requireApprovedCharacterReference: false});
      return currentTreatmentProfileId;
    } catch {
      // The deterministic watercolor profile below is the imagegen fallback.
    }
  }
  if (routeId === 'imagegen') treatmentProfileId = DEFAULT_IMAGEGEN_TREATMENT;
  if (!treatmentProfileId) throw new Error(`no treatment binding for route: ${routeId}`);
  validateVisualLanguageSelection({
    presentation_mode: row.presentation_mode,
    scene_class: row.scene_class,
    visual_structure_id: visualStructureId,
    treatment_profile_id: treatmentProfileId,
    visual_generation_route: routeId,
    white_cat_present: whiteCatPresent,
    comic_plan: null,
  }, {requireApprovedCharacterReference: false});
  return treatmentProfileId;
};

const normalizeTextForRoute = ({routeId, whiteCatPresent, visibleTextMode, exactVisibleText, placement}) => {
  const policy = resolveRouteVisibleTextPolicy({
    visual_generation_route: routeId,
    white_cat_present: whiteCatPresent,
  });
  if (['text-free-v1', 'source-video-pixels-preserved-no-added-text-v1']
    .includes(policy.visible_text_policy)) {
    return {visible_text_mode: 'none', exact_visible_text: null, visible_text_placement: null};
  }
  return {
    visible_text_mode: visibleTextMode,
    exact_visible_text: exactVisibleText ?? null,
    visible_text_placement: placement ?? null,
  };
};

export const buildVisualDirectionFormModel = ({review, storyboardMarkdown, episodeWorkspace}) => {
  requireNonEmptyString(episodeWorkspace, 'episode workspace');
  if (episodeWorkspace.startsWith('/') || episodeWorkspace.split('/').includes('..')) {
    throw new Error('episode workspace must be root-relative and traversal-free');
  }
  validatePendingReviewAuthority(review, storyboardMarkdown);
  const summaryRows = parseStoryboardSummary(storyboardMarkdown);
  const expectedIds = [...(isFlipbookRow(review) ? [] : ['OPEN-00']), ...review.rows.map((row) => row.shot_id)];
  if (!sameArray(summaryRows.map((row) => row.shot_id), expectedIds)) {
    throw new Error('storyboard Summary row order does not match the visual direction review');
  }
  const reviewById = new Map(review.rows.map((row) => [row.shot_id, row]));
  const rows = summaryRows.map((summary) => {
    if (summary.shot_id === 'OPEN-00') {
      return {
        ...summary,
        row_kind: 'fixed_opening',
        read_only: true,
        selected: false,
      };
    }
    const reviewRow = reviewById.get(summary.shot_id);
    const base = presentedSelection(reviewRow);
    if (isFlipbookRow(reviewRow)) validateStaticSpread(reviewRow.static_spread, {sourceText: summary.locked_narration, shotId: summary.shot_id});
    const routeOptionsByWhiteCat = Object.fromEntries([false, true].map((whiteCatPresent) => [
      String(whiteCatPresent),
      compatibleRoutesForSelection(reviewRow, whiteCatPresent).map((routeId) => ({
        route_id: routeId,
        label: ROUTE_LABELS[routeId],
      })),
    ]));
    return {
      ...summary,
      row_kind: 'generated_shot',
      ...(isFlipbookRow(reviewRow) ? {presentation_mode: FLIPBOOK_STYLE_ID, static_spread: structuredClone(reviewRow.static_spread), white_cat_locked: true} : {}),
      read_only: false,
      selected: false,
      scene_class: reviewRow.scene_class,
      structured_visual_kind: reviewRow.structured_visual_kind ?? null,
      approval_status: reviewRow.user_selection?.status ?? 'pending',
      white_cat_present: base.white_cat_present,
      visual_generation_route: base.visual_generation_route,
      treatment_profile_id: resolveTreatmentProfile({
        row: reviewRow,
        routeId: base.visual_generation_route,
        currentTreatmentProfileId: base.treatment_profile_id,
        visualStructureId: base.visual_structure_id,
        whiteCatPresent: base.white_cat_present,
      }),
      visible_text_mode: base.visible_text_mode,
      exact_visible_text: base.exact_visible_text ?? null,
      visible_text_placement: base.visible_text_placement ?? null,
      local_video_source_path: base.local_video_source_path ?? null,
      route_options_by_white_cat: routeOptionsByWhiteCat,
      incompatible_route_reasons: reviewRow.incompatible_route_reasons,
      original_presented_selection: base,
    };
  });
  return {
    contract_version: FORM_MODEL_CONTRACT_VERSION,
    ...(isFlipbookRow(review) ? {presentation_mode: FLIPBOOK_STYLE_ID} : {}),
    submission_contract_version: SUBMISSION_CONTRACT_VERSION,
    merge_request_contract_version: MERGE_REQUEST_CONTRACT_VERSION,
    merge_renumber_strategy: MERGE_RENUMBER_STRATEGY,
    merge_visual_inheritance_policy: MERGE_VISUAL_INHERITANCE_POLICY,
    episode_workspace: episodeWorkspace,
    presented_map_sha256: review.presented_map_sha256,
    storyboard: review.storyboard,
    columns: [...SUMMARY_HEADER],
    route_labels: ROUTE_LABELS,
    route_treatment_bindings: {
      ...FIXED_TREATMENTS,
      imagegen: 'preserve-compatible-current-otherwise-imagegen-watercolor-narrative',
    },
    row_count: rows.length,
    editable_row_count: review.rows.length,
    rows,
  };
};

export const validateStoryboardShotMergeRequest = ({
  review,
  request,
  storyboardMarkdown,
  episodeWorkspace,
  episodeState,
}) => {
  validatePendingReviewAuthority(review, storyboardMarkdown);
  requireObject(episodeState, 'episode state');
  if (episodeState.workspace_path !== episodeWorkspace) {
    throw new Error('episode state targets another workspace');
  }
  if (episodeState.resume_mode === 'revoice_variant') {
    throw new Error('revoice_variant forbids shot merging and renumbering');
  }
  if (episodeState.current_phase !== 'awaiting_visual_direction_review') {
    throw new Error('storyboard shot merge is allowed only at awaiting_visual_direction_review');
  }
  requireExactKeys(request, [
    'contract_version',
    'episode_workspace',
    'presented_map_sha256',
    'storyboard_checksum_sha256',
    'shot_ids',
    'renumber_strategy',
  ], 'storyboard shot merge request');
  if (request.contract_version !== MERGE_REQUEST_CONTRACT_VERSION) {
    throw new Error('unsupported storyboard shot merge request contract');
  }
  if (request.episode_workspace !== episodeWorkspace) {
    throw new Error('storyboard shot merge request targets another episode workspace');
  }
  if (request.presented_map_sha256 !== review.presented_map_sha256) {
    throw new Error('storyboard shot merge request is bound to a stale presented map');
  }
  if (!SHA256.test(request.storyboard_checksum_sha256 ?? '')
    || request.storyboard_checksum_sha256 !== review.storyboard.checksum_sha256
    || request.storyboard_checksum_sha256 !== sha256Text(storyboardMarkdown)) {
    throw new Error('storyboard shot merge request is bound to a stale storyboard checksum');
  }
  if (request.renumber_strategy !== MERGE_RENUMBER_STRATEGY) {
    throw new Error('storyboard shot merge requires compact_after_merge');
  }
  const plan = buildCompactShotMergePlan(review.rows.map((row) => row.shot_id), request.shot_ids);
  return {
    contract_version: 'storyboard-shot-merge-validation-v1',
    result: 'pass',
    episode_workspace: episodeWorkspace,
    presented_map_sha256: review.presented_map_sha256,
    storyboard_checksum_sha256: review.storyboard.checksum_sha256,
    current_active_row_count: review.rows.length + 1,
    resulting_active_row_count: plan.active_shot_ids_after_merge.length + 1,
    requires_semantic_rebuild_before_mutation: false,
    requires_survivor_visual_contract_validation_before_mutation: true,
    requires_represented_map_refresh: true,
    historical_review_files_are_immutable: true,
    merged_source_text_policy: 'concatenate_exact_source_text_in_original_order_without_insertions',
    merged_timing_policy: 'first_source_start_through_last_source_end',
    merged_visual_contract_policy: MERGE_VISUAL_INHERITANCE_POLICY,
    merged_visual_contract_source_shot_id: plan.surviving_shot_id,
    ignored_member_visual_contract_shot_ids: [...plan.superseded_shot_ids],
    merged_action_state_policy: MERGE_ACTION_STATE_POLICY,
    ...plan,
  };
};

const validateVisibleText = (row, submittedRow) => {
  if (!['none', 'required'].includes(submittedRow.visible_text_mode)) {
    throw new Error(`${row.shot_id} visible_text_mode must be none or required`);
  }
  if (submittedRow.visible_text_mode === 'required') {
    requireNonEmptyString(submittedRow.exact_visible_text, `${row.shot_id} exact visible text`);
    requireNonEmptyString(submittedRow.visible_text_placement, `${row.shot_id} visible text placement`);
    validateConciseSummaryVisibleText(submittedRow.exact_visible_text, {shotId: row.shot_id});
  } else if (submittedRow.exact_visible_text !== null || submittedRow.visible_text_placement !== null) {
    throw new Error(`${row.shot_id} visible text none requires null text and placement`);
  }
  const policy = resolveRouteVisibleTextPolicy({
    visual_generation_route: submittedRow.visual_generation_route,
    white_cat_present: submittedRow.white_cat_present,
  });
  if (['text-free-v1', 'source-video-pixels-preserved-no-added-text-v1']
    .includes(policy.visible_text_policy) && submittedRow.visible_text_mode !== 'none') {
    throw new Error(`${row.shot_id} selected route and white-cat state are text-free`);
  }
};

const adjacentBoundaries = (allShotIds, changedShotIds) => {
  const changed = new Set(changedShotIds);
  const boundaries = [];
  for (let index = 1; index < allShotIds.length - 1; index += 1) {
    const source = allShotIds[index];
    const next = allShotIds[index + 1];
    if (changed.has(source) || changed.has(next)) {
      boundaries.push({source_shot_id: source, next_shot_id: next});
    }
  }
  return boundaries;
};

export const validateVisualDirectionFormSubmission = ({
  review,
  submission,
  storyboardMarkdown,
  episodeWorkspace,
}) => {
  validatePendingReviewAuthority(review, storyboardMarkdown);
  requireObject(submission, 'visual direction form submission');
  requireExactKeys(submission, [
    'contract_version',
    'episode_workspace',
    'presented_map_sha256',
    'storyboard_checksum_sha256',
    'submission_scope',
    'rows',
  ], 'visual direction form submission');
  if (submission.contract_version !== SUBMISSION_CONTRACT_VERSION) {
    throw new Error('unsupported visual direction form submission contract');
  }
  if (submission.presented_map_sha256 !== review.presented_map_sha256) {
    throw new Error('visual direction form submission is bound to a stale presented map');
  }
  if (!SHA256.test(submission.storyboard_checksum_sha256 ?? '')
    || submission.storyboard_checksum_sha256 !== review.storyboard.checksum_sha256
    || submission.storyboard_checksum_sha256 !== sha256Text(storyboardMarkdown)) {
    throw new Error('visual direction form submission is bound to a stale storyboard checksum');
  }
  requireNonEmptyString(submission.episode_workspace, 'submission episode workspace');
  if (submission.episode_workspace !== requireNonEmptyString(episodeWorkspace, 'episode workspace')) {
    throw new Error('visual direction form submission targets another episode workspace');
  }
  const scope = requireObject(submission.submission_scope, 'submission scope');
  requireExactKeys(scope, ['mode', 'shot_ids'], 'submission scope');
  if (!['all', 'selected'].includes(scope.mode)) throw new Error('submission scope mode must be all or selected');
  if (!Array.isArray(scope.shot_ids)) throw new Error('submission scope shot_ids must be an array');
  if (!Array.isArray(submission.rows) || submission.rows.length === 0) {
    throw new Error('visual direction form submission rows are required');
  }
  const knownIds = review.rows.map((row) => row.shot_id);
  const rowIds = submission.rows.map((row) => requireNonEmptyString(row?.shot_id, 'submission shot ID'));
  if (new Set(rowIds).size !== rowIds.length) throw new Error('visual direction form submission contains duplicate shots');
  if (rowIds.includes('OPEN-00')) throw new Error('OPEN-00 is read-only and cannot be submitted');
  const unknown = rowIds.filter((shotId) => !knownIds.includes(shotId));
  if (unknown.length > 0) throw new Error(`visual direction form submission contains unknown shots: ${unknown.join(', ')}`);
  if (!sameArray(scope.shot_ids, rowIds)) throw new Error('submission scope shot_ids must equal submitted row order');
  if (scope.mode === 'all' && !sameArray(rowIds, knownIds)) {
    throw new Error('full visual direction form submission must contain every generated shot in order');
  }
  const reviewById = new Map(review.rows.map((row) => [row.shot_id, row]));
  const summaryById = new Map(parseStoryboardSummary(storyboardMarkdown)
    .map((row) => [row.shot_id, row]));
  const normalizedRows = submission.rows.map((submittedRow) => {
    requireExactKeys(submittedRow, [
      'shot_id',
      'visual_description',
      'white_cat_present',
      'visual_generation_route',
      'visible_text_mode',
      'exact_visible_text',
      'visible_text_placement',
      'local_video_source_path',
    ], `${submittedRow?.shot_id ?? 'unknown'} submission row`);
    const row = reviewById.get(submittedRow.shot_id);
    const visualDescription = requireNonEmptyString(
      submittedRow.visual_description,
      `${row.shot_id} visual description`,
    );
    if (typeof submittedRow.white_cat_present !== 'boolean') {
      throw new Error(`${row.shot_id} white_cat_present must be boolean`);
    }
    if (!ACTIVE_ROUTE_IDS.includes(submittedRow.visual_generation_route)) {
      throw new Error(`${row.shot_id} visual generation route is unknown or retired`);
    }
    const compatibleRoutes = compatibleRoutesForSelection(row, submittedRow.white_cat_present);
    if (!compatibleRoutes.includes(submittedRow.visual_generation_route)) {
      throw new Error(`${row.shot_id} selected route is incompatible with its white-cat state and scene class`);
    }
    if (submittedRow.white_cat_present
      && !['imagegen', 'xuan-paper-diorama'].includes(submittedRow.visual_generation_route)) {
      throw new Error(`${row.shot_id} white cat requires ImageGen or xuan-paper-diorama`);
    }
    const localVideoSelected = submittedRow.visual_generation_route === 'local-video-file';
    if (localVideoSelected) {
      requireNonEmptyString(submittedRow.local_video_source_path, `${row.shot_id} local video source path`);
      if (!submittedRow.local_video_source_path.startsWith('/')
        || submittedRow.local_video_source_path.includes('\0')
        || !/\.mp4$/i.test(submittedRow.local_video_source_path)) {
        throw new Error(`${row.shot_id} local video source path must be an absolute .mp4 path`);
      }
    } else if (submittedRow.local_video_source_path !== null) {
      throw new Error(`${row.shot_id} non-local-video route requires null local_video_source_path`);
    }
    validateVisibleText(row, submittedRow);
    const base = presentedSelection(row);
    const visualDescriptionChanged = visualDescription
      !== summaryById.get(row.shot_id).visual_description;
    const catChanged = submittedRow.white_cat_present !== base.white_cat_present;
    const textChanged = submittedRow.visible_text_mode !== row.visible_text_mode
      || !sameNullable(submittedRow.exact_visible_text, row.exact_visible_text)
      || !sameNullable(submittedRow.visible_text_placement, row.visible_text_placement);
    const routeChanged = submittedRow.visual_generation_route !== base.visual_generation_route;
    const localVideoPathChanged = (submittedRow.local_video_source_path ?? null)
      !== (base.local_video_source_path ?? null);
    const treatmentProfileId = resolveTreatmentProfile({
      row,
      routeId: submittedRow.visual_generation_route,
      currentTreatmentProfileId: base.treatment_profile_id,
      visualStructureId: base.visual_structure_id,
      whiteCatPresent: submittedRow.white_cat_present,
    });
    const resolution = visualDescriptionChanged
      ? 'requires_visual_semantic_rebuild_and_represent'
      : (catChanged && textChanged
        ? 'requires_semantic_rebuild_and_candidate_map_refresh'
        : (catChanged
          ? 'requires_semantic_rebuild_and_represent'
          : ((textChanged || localVideoPathChanged || (routeChanged && localVideoSelected))
            ? 'requires_candidate_map_refresh'
            : 'selection_ready')));
    return {
      shot_id: row.shot_id,
      ...(isFlipbookRow(row) ? {presentation_mode: FLIPBOOK_STYLE_ID, static_spread: structuredClone(row.static_spread)} : {}),
      visual_description: visualDescription,
      white_cat_present: submittedRow.white_cat_present,
      visual_generation_route: submittedRow.visual_generation_route,
      treatment_profile_id: treatmentProfileId,
      visual_structure_id: base.visual_structure_id,
      visible_text_mode: submittedRow.visible_text_mode,
      exact_visible_text: submittedRow.exact_visible_text ?? null,
      visible_text_placement: submittedRow.visible_text_placement ?? null,
      local_video_source_path: submittedRow.local_video_source_path ?? null,
      changes: {
        visual_description: visualDescriptionChanged,
        white_cat: catChanged,
        route: routeChanged,
        visible_text: textChanged,
        local_video_source_path: localVideoPathChanged,
      },
      resolution,
    };
  });
  const reopenedShotIds = normalizedRows
    .filter((row) => row.resolution !== 'selection_ready')
    .map((row) => row.shot_id);
  const submittedIds = new Set(rowIds);
  return {
    contract_version: 'visual-direction-form-validation-v2',
    result: 'pass',
    presented_map_sha256: review.presented_map_sha256,
    storyboard_checksum_sha256: review.storyboard.checksum_sha256,
    submission_scope: {mode: scope.mode, shot_ids: [...rowIds]},
    normalized_rows: normalizedRows,
    selection_ready_shot_ids: normalizedRows
      .filter((row) => row.resolution === 'selection_ready')
      .map((row) => row.shot_id),
    reopened_shot_ids: reopenedShotIds,
    reopened_transition_boundaries: adjacentBoundaries(['OPEN-00', ...knownIds], reopenedShotIds),
    preserved_approved_shot_ids: review.rows
      .filter((row) => row.user_selection?.status === 'approved' && !submittedIds.has(row.shot_id))
      .map((row) => row.shot_id),
    requires_represented_map_refresh: reopenedShotIds.length > 0,
  };
};

export const applyBulkEdit = (formRows, {shotIds, field, value}) => {
  if (!Array.isArray(formRows) || !Array.isArray(shotIds)) throw new Error('bulk rows and shot IDs are required');
  const selected = new Set(shotIds);
  const applied_shot_ids = [];
  const skipped = [];
  const rows = formRows.map((sourceRow) => {
    const row = structuredClone(sourceRow);
    if (row.read_only || !selected.has(row.shot_id)) return row;
    if (field === 'white_cat_present') {
      const options = row.route_options_by_white_cat[String(value)] ?? [];
      if (options.length === 0) {
        skipped.push({shot_id: row.shot_id, reason: '当前画面语义没有兼容的白猫生图路线'});
        return row;
      }
      row.white_cat_present = value;
      if (!options.some((option) => option.route_id === row.visual_generation_route)) {
        row.visual_generation_route = options[0].route_id;
      }
    } else if (field === 'visual_generation_route') {
      if (value === 'local-video-file') {
        skipped.push({shot_id: row.shot_id, reason: '本地视频须逐镜填写不同的绝对文件路径，不能批量设置'});
        return row;
      }
      const options = row.route_options_by_white_cat[String(row.white_cat_present)] ?? [];
      if (!options.some((option) => option.route_id === value)) {
        skipped.push({shot_id: row.shot_id, reason: '该路线与当前镜头分类或白猫选择不兼容'});
        return row;
      }
      row.visual_generation_route = value;
    } else if (field === 'visible_text') {
      const policy = resolveRouteVisibleTextPolicy({
        visual_generation_route: row.visual_generation_route,
        white_cat_present: row.white_cat_present,
      });
      if (policy.visible_text_policy === 'text-free-v1' && value.visible_text_mode === 'required') {
        skipped.push({shot_id: row.shot_id, reason: '宣纸及白猫 ImageGen 镜头强制无可见文字'});
        return row;
      }
      row.visible_text_mode = value.visible_text_mode;
      row.exact_visible_text = value.exact_visible_text ?? null;
      row.visible_text_placement = value.visible_text_placement ?? null;
    } else {
      throw new Error(`unsupported bulk field: ${field}`);
    }
    const normalizedText = normalizeTextForRoute({
      routeId: row.visual_generation_route,
      whiteCatPresent: row.white_cat_present,
      visibleTextMode: row.visible_text_mode,
      exactVisibleText: row.exact_visible_text,
      placement: row.visible_text_placement,
    });
    Object.assign(row, normalizedText);
    applied_shot_ids.push(row.shot_id);
    return row;
  });
  return {rows, applied_shot_ids, skipped};
};

export const validateApprovedDirectionSynchronization = ({
  review,
  storyboardMarkdown,
  detailedRows,
}) => {
  validatePendingReviewAuthority(review, storyboardMarkdown);
  if (review.status !== 'approved') throw new Error('visual direction review must be approved before synchronization QA');
  if (!Array.isArray(detailedRows) || detailedRows.length !== review.rows.length) {
    throw new Error('detailed storyboard projection must cover every generated shot');
  }
  const summaryRows = parseStoryboardSummary(storyboardMarkdown);
  if (!sameArray(summaryRows.map((row) => row.shot_id), ['OPEN-00', ...review.rows.map((row) => row.shot_id)])) {
    throw new Error('final Summary row set or order does not match review');
  }
  const summaryById = new Map(summaryRows.map((row) => [row.shot_id, row]));
  const synchronized = review.rows.map((row, index) => {
    const selection = row.user_selection;
    if (selection?.status !== 'approved'
      || selection.presented_map_sha256 !== review.presented_map_sha256) {
      throw new Error(`${row.shot_id} lacks checksum-current approved selection evidence`);
    }
    const detail = detailedRows[index];
    if (detail?.shot_id !== row.shot_id) throw new Error(`${row.shot_id} detailed storyboard order mismatch`);
    const expected = {
      visual_description: summaryById.get(row.shot_id).visual_description,
      white_cat_present: selection.white_cat_present,
      visual_structure_id: selection.visual_structure_id,
      treatment_profile_id: selection.treatment_profile_id,
      visual_generation_route: selection.visual_generation_route,
      visible_text_mode: selection.visible_text_mode,
      exact_visible_text: selection.exact_visible_text ?? null,
      visible_text_placement: selection.visible_text_placement ?? null,
      local_video_source_path: selection.local_video_source_path ?? null,
    };
    for (const [field, expectedValue] of Object.entries(expected)) {
      if (!sameNullable(detail[field], expectedValue)) {
        throw new Error(`${row.shot_id} detailed storyboard ${field} mismatch`);
      }
    }
    const summary = summaryById.get(row.shot_id);
    if (summary.white_cat !== String(selection.white_cat_present)) {
      throw new Error(`${row.shot_id} Summary white-cat mismatch`);
    }
    if (summary.visual_generation_route !== selection.visual_generation_route) {
      throw new Error(`${row.shot_id} Summary route mismatch`);
    }
    const expectedVisibleText = selection.visible_text_mode === 'none'
      ? '无'
      : selection.exact_visible_text;
    if (summary.visible_text !== expectedVisibleText) {
      throw new Error(`${row.shot_id} Summary visible-text mismatch`);
    }
    return {shot_id: row.shot_id, ...expected};
  });
  return {
    contract_version: 'visual-direction-synchronization-qa-v1',
    result: 'pass',
    presented_map_sha256: review.presented_map_sha256,
    synchronized_shot_count: synchronized.length,
    synchronized_projection_sha256: sha256Text(JSON.stringify(synchronized)),
  };
};
