import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {resolveTransitionRecommendation} from '../scene-transitions/contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_BYTES = fs.readFileSync(path.join(HERE, 'catalog.json'));

export const VISUAL_LANGUAGE_CATALOG = JSON.parse(CATALOG_BYTES);
export const VISUAL_LANGUAGE_CATALOG_CHECKSUM_SHA256 = crypto
  .createHash('sha256')
  .update(CATALOG_BYTES)
  .digest('hex');
export const VISUAL_STRUCTURE_IDS = Object.freeze(
  VISUAL_LANGUAGE_CATALOG.visual_structures.map((item) => item.visual_structure_id),
);
export const TREATMENT_PROFILE_IDS = Object.freeze(
  VISUAL_LANGUAGE_CATALOG.treatment_profiles.map((item) => item.treatment_profile_id),
);
export const COMPOSITION_LAYOUT_IDS = Object.freeze(
  VISUAL_LANGUAGE_CATALOG.composition_layouts.map((item) => item.composition_layout_id),
);

const SHA256 = /^[a-f0-9]{64}$/;
const structures = new Map(
  VISUAL_LANGUAGE_CATALOG.visual_structures.map((item) => [item.visual_structure_id, item]),
);
const treatments = new Map(
  VISUAL_LANGUAGE_CATALOG.treatment_profiles.map((item) => [item.treatment_profile_id, item]),
);
const treatmentLayoutCompatibility = new Map(
  VISUAL_LANGUAGE_CATALOG.treatment_layout_compatibility
    .map((item) => [item.treatment_profile_id, item]),
);
const comic = VISUAL_LANGUAGE_CATALOG.comic_contract;

const requireString = (value, label) => {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string`);
  return value;
};

export const resolveTreatmentLayoutCompatibility = ({
  treatmentProfileId,
  compositionLayoutId,
} = {}) => {
  if (!treatments.has(treatmentProfileId)) {
    throw new Error(`unknown treatment_profile_id: ${treatmentProfileId}`);
  }
  if (!COMPOSITION_LAYOUT_IDS.includes(compositionLayoutId)) {
    throw new Error(`unknown composition_layout_id: ${compositionLayoutId}`);
  }
  const row = treatmentLayoutCompatibility.get(treatmentProfileId);
  if (!row) throw new Error(`missing treatment-layout compatibility row: ${treatmentProfileId}`);
  const buckets = ['recommended', 'supported', 'avoid'];
  const matches = buckets.filter((bucket) => row[bucket]?.includes(compositionLayoutId));
  if (matches.length !== 1) {
    throw new Error(`treatment-layout matrix must classify ${treatmentProfileId}/${compositionLayoutId} exactly once`);
  }
  return Object.freeze({
    result: 'pass',
    treatment_profile_id: treatmentProfileId,
    composition_layout_id: compositionLayoutId,
    compatibility: matches[0],
    source_style_anchor: row.source_style_anchor,
  });
};

export const validateComicCharacterReferenceReview = (review, {required = true} = {}) => {
  if (!required && (review === null || review === undefined)) return null;
  if (review?.contract_version !== 'comic-character-reference-review-v1'
    || review?.status !== 'approved') {
    throw new Error('comic character reference must have an approved comic-character-reference-review-v1');
  }
  requireString(review.reference_asset, 'comic character reference asset');
  if (!review.reference_asset.toLowerCase().endsWith('.png')) {
    throw new Error('comic character reference must be a PNG');
  }
  if (!SHA256.test(review.reference_checksum_sha256 ?? '')) {
    throw new Error('comic character reference checksum is invalid');
  }
  if (review.identity_preserved !== true || review.redesign_forbidden !== true) {
    throw new Error('comic character reference must preserve identity and forbid redesign');
  }
  return review;
};

export const validateComicShotPlan = (plan, {
  sceneClass,
  visualStructureId,
  treatmentProfileId,
  whiteCatPresent = false,
  requireApprovedCharacterReference = true,
} = {}) => {
  if (plan?.contract_version !== comic.contract_version) {
    throw new Error(`comic route requires ${comic.contract_version}`);
  }
  if (sceneClass !== 'narrative_illustration') {
    throw new Error('comic-imagegen is compatible only with narrative_illustration');
  }
  const panelCount = plan.panel_count;
  if (!Number.isInteger(panelCount)
    || panelCount < comic.panel_count.minimum
    || panelCount > comic.panel_count.maximum) {
    throw new Error('comic panel_count must be an integer from 1 to 3');
  }
  if (!Array.isArray(plan.panel_beats) || plan.panel_beats.length !== panelCount) {
    throw new Error('comic panel_beats must match panel_count exactly');
  }
  plan.panel_beats.forEach((beat, index) => {
    if (beat?.panel_index !== index + 1) throw new Error('comic panel_beats must be ordered from 1');
    requireString(beat.purpose, `comic panel ${index + 1} purpose`);
    requireString(beat.visual_action, `comic panel ${index + 1} visual_action`);
  });
  if (!comic.allowed_layouts.includes(plan.layout)) {
    throw new Error(`comic layout is unsupported or forbidden: ${plan.layout}`);
  }
  if (plan.visible_text_mode !== 'none') {
    throw new Error('comic visible_text_mode must be none; bubbles, captions, sound effects, and generated labels are forbidden');
  }
  if (plan.treatment_profile_id !== treatmentProfileId) {
    throw new Error('comic treatment profile does not match the locked visual direction');
  }
  const treatment = treatments.get(treatmentProfileId);
  if (treatment?.family !== 'comic' || !treatment.compatible_routes.includes('comic-imagegen')) {
    throw new Error('comic-imagegen requires a compatible comic treatment profile');
  }
  if (plan.character_continuity_group_id !== null
    && (typeof plan.character_continuity_group_id !== 'string'
      || plan.character_continuity_group_id.trim() === '')) {
    throw new Error('character_continuity_group_id must be a non-empty string or null');
  }
  const continuityGroupSize = plan.character_continuity_group_id === null
    ? 0
    : plan.character_continuity_group_size;
  if (plan.character_continuity_group_id !== null
    && (!Number.isInteger(continuityGroupSize) || continuityGroupSize < 2)) {
    throw new Error('comic character continuity group must cover at least two shots');
  }
  const orderedGrammar = comic.ordered_panel_structures.includes(visualStructureId)
    && plan.requires_panel_order_contract === true;
  const eligible = panelCount >= 2 || continuityGroupSize >= 2 || orderedGrammar;
  if (!eligible) throw new Error('shot is not eligible for comic-imagegen');
  if (panelCount === 1 && continuityGroupSize < 2) {
    throw new Error('single-panel comic-imagegen requires a character continuity group spanning at least two shots');
  }
  const referenceRequired = plan.character_continuity_group_id !== null || whiteCatPresent;
  if (referenceRequired && !requireApprovedCharacterReference
    && plan.character_reference_review?.contract_version === 'comic-character-reference-review-v1'
    && plan.character_reference_review?.status === 'pending') {
    // Direction review may lock the route before the prerequisite reference is generated.
  } else {
    validateComicCharacterReferenceReview(plan.character_reference_review, {required: referenceRequired});
  }
  if (!referenceRequired && plan.character_reference_review !== null) {
    validateComicCharacterReferenceReview(plan.character_reference_review, {required: true});
  }
  if (whiteCatPresent && requireApprovedCharacterReference) {
    if (plan.character_reference_review?.reference_role !== 'canonical-white-cat') {
      throw new Error('white-cat comic requires the approved canonical white-cat reference');
    }
    if (plan.character_reference_review?.existing_reference !== true) {
      throw new Error('comic must not redesign the white cat');
    }
  }
  return {result: 'pass', eligibility: 'eligible', panel_count: panelCount};
};

export const validateVisualLanguageSelection = ({
  scene_class: sceneClass,
  visual_structure_id: visualStructureId,
  treatment_profile_id: treatmentProfileId,
  visual_generation_route: route,
  white_cat_present: whiteCatPresent = false,
  comic_plan: comicPlan = null,
} = {}, {requireApprovedCharacterReference = true} = {}) => {
  const structure = structures.get(visualStructureId);
  if (!structure) throw new Error(`unknown visual_structure_id: ${visualStructureId}`);
  if (structure.scene_class !== sceneClass) {
    throw new Error('visual structure is incompatible with the locked scene_class');
  }
  const treatment = treatments.get(treatmentProfileId);
  if (!treatment) throw new Error(`unknown treatment_profile_id: ${treatmentProfileId}`);
  if (!treatment.compatible_routes.includes(route)) {
    throw new Error('treatment profile is incompatible with the selected visual route');
  }
  const layoutCompatibility = resolveTreatmentLayoutCompatibility({
    treatmentProfileId,
    compositionLayoutId: structure.composition_layout_id,
  });
  if (layoutCompatibility.compatibility === 'avoid') {
    throw new Error('treatment profile is incompatible with the visual structure composition layout');
  }
  if (route === 'comic-imagegen') {
    validateComicShotPlan(comicPlan, {
      sceneClass,
      visualStructureId,
      treatmentProfileId,
      whiteCatPresent,
      requireApprovedCharacterReference,
    });
  } else if (comicPlan !== null) {
    throw new Error('comic_plan is allowed only on comic-imagegen');
  }
  return {
    result: 'pass',
    visual_structure_id: visualStructureId,
    treatment_profile_id: treatmentProfileId,
    composition_layout_id: structure.composition_layout_id,
    treatment_layout_compatibility: layoutCompatibility.compatibility,
  };
};

export const buildVisualPromptBrief = ({visualStructureId, treatmentProfileId, comicPlan = null}) => {
  const structure = structures.get(visualStructureId);
  const treatment = treatments.get(treatmentProfileId);
  if (!structure || !treatment) throw new Error('known visual structure and treatment are required');
  return Object.freeze({
    contract_version: 'visual-prompt-brief-v1',
    visual_structure_id: visualStructureId,
    structure_family: structure.family,
    composition_layout_id: structure.composition_layout_id,
    treatment_layout_compatibility: resolveTreatmentLayoutCompatibility({
      treatmentProfileId,
      compositionLayoutId: structure.composition_layout_id,
    }).compatibility,
    treatment_profile_id: treatmentProfileId,
    treatment_family: treatment.family,
    comic_panel_order: comicPlan?.panel_beats?.map((beat) => beat.panel_index) ?? null,
    visible_text_mode: comicPlan?.visible_text_mode ?? 'route-default',
  });
};

export const recommendComicBoundaryTransition = ({
  sourceRoute,
  nextRoute,
  sameCharacterOrObjectPosition = false,
} = {}) => {
  if (sourceRoute !== 'comic-imagegen') throw new Error('comic boundary recommendation requires a comic-imagegen source');
  const knownTargets = new Set([
    'imagegen',
    'comic-imagegen',
    'ian-handdrawn-ppt',
    'doodle-slides',
    'srt-whiteboard-animation',
  ]);
  if (!knownTargets.has(nextRoute)) throw new Error(`unknown comic boundary target route: ${nextRoute}`);
  const boundaryChangeClass = sameCharacterOrObjectPosition
    ? 'match_continuity'
    : (['ian-handdrawn-ppt', 'doodle-slides', 'srt-whiteboard-animation'].includes(nextRoute)
        ? 'route_change'
        : 'section_change');
  const resolved = resolveTransitionRecommendation({
    boundaryChangeClass,
    sourceVisualGenerationRoute: sourceRoute,
    nextVisualGenerationRoute: nextRoute,
  });
  return {
    recommended_kind: resolved.recommended_transition.kind,
    recommended_options: resolved.recommended_transition.options,
    alternatives: resolved.recommended_transition.kind === 'dissolve'
      ? ['paper-wipe']
      : ['dissolve'],
    recommendation_source: resolved.recommendation_source,
  };
};
