import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMPOSITION_LAYOUT_IDS,
  TREATMENT_PROFILE_IDS,
  VISUAL_LANGUAGE_CATALOG,
  recommendComicBoundaryTransition,
  resolveTreatmentLayoutCompatibility,
  validateComicShotPlan,
  validateVisualLanguageSelection,
} from './contract.mjs';
import {resolveTransitionRecommendation} from '../scene-transitions/contract.mjs';

const referenceReview = (role = 'person') => ({
  contract_version: 'comic-character-reference-review-v1',
  status: 'approved',
  reference_asset: 'visual-assets/character-reference.png',
  reference_checksum_sha256: 'a'.repeat(64),
  reference_role: role,
  existing_reference: true,
  identity_preserved: true,
  redesign_forbidden: true,
});

const comicPlan = (overrides = {}) => ({
  contract_version: 'comic-shot-plan-v1',
  panel_count: 2,
  panel_beats: [
    {panel_index: 1, purpose: '建立问题', visual_action: '角色看到异常'},
    {panel_index: 2, purpose: '给出反应', visual_action: '角色采取行动'},
  ],
  layout: 'standard',
  character_continuity_group_id: null,
  character_continuity_group_size: 0,
  treatment_profile_id: 'comic-manga-warm',
  visible_text_mode: 'none',
  requires_panel_order_contract: true,
  character_reference_review: null,
  ...overrides,
});

test('catalog pins Baoyu source and exposes five comic treatments', () => {
  assert.equal(VISUAL_LANGUAGE_CATALOG.source_revision.commit, '6b7a2e417500561a5ecdd0b168332f4142584617');
  assert.equal(
    VISUAL_LANGUAGE_CATALOG.treatment_profiles.filter((item) => item.family === 'comic').length,
    5,
  );
});

test('XHS-derived treatment-layout matrix classifies every internal pairing exactly once', () => {
  assert.equal(COMPOSITION_LAYOUT_IDS.length, 8);
  for (const treatmentProfileId of TREATMENT_PROFILE_IDS) {
    for (const compositionLayoutId of COMPOSITION_LAYOUT_IDS) {
      const result = resolveTreatmentLayoutCompatibility({treatmentProfileId, compositionLayoutId});
      assert.match(result.compatibility, /^(recommended|supported|avoid)$/);
    }
  }
  assert.equal(resolveTreatmentLayoutCompatibility({
    treatmentProfileId: 'comic-ink-brush-dramatic',
    compositionLayoutId: 'dense',
  }).compatibility, 'avoid');
  assert.equal(resolveTreatmentLayoutCompatibility({
    treatmentProfileId: 'comic-chalk-explainer',
    compositionLayoutId: 'flow',
  }).compatibility, 'recommended');
});

test('single comic-styled illustration remains imagegen without a comic plan', () => {
  assert.equal(validateVisualLanguageSelection({
    scene_class: 'narrative_illustration',
    visual_structure_id: 'single-scene',
    treatment_profile_id: 'comic-ligne-claire-neutral',
    visual_generation_route: 'imagegen',
    white_cat_present: false,
    comic_plan: null,
  }).result, 'pass');
});

test('xuan-paper-diorama accepts sparse narrative structures and rejects mismatched treatments', () => {
  assert.equal(validateVisualLanguageSelection({
    scene_class: 'narrative_illustration',
    visual_structure_id: 'single-scene',
    treatment_profile_id: 'xuan-paper-diorama',
    visual_generation_route: 'xuan-paper-diorama',
    white_cat_present: false,
    comic_plan: null,
  }).result, 'pass');
  assert.throws(() => validateVisualLanguageSelection({
    scene_class: 'narrative_illustration',
    visual_structure_id: 'single-scene',
    treatment_profile_id: 'imagegen-watercolor-narrative',
    visual_generation_route: 'xuan-paper-diorama',
    white_cat_present: false,
    comic_plan: null,
  }), /treatment profile is incompatible/i);
});

test('accepts two to three ordered panels and cross-shot single-panel continuity', () => {
  assert.equal(validateComicShotPlan(comicPlan(), {
    sceneClass: 'narrative_illustration',
    visualStructureId: 'sequential-panels',
    treatmentProfileId: 'comic-manga-warm',
  }).result, 'pass');
  const single = comicPlan({
    panel_count: 1,
    panel_beats: [{panel_index: 1, purpose: '延续动作', visual_action: '同一角色继续前进'}],
    character_continuity_group_id: 'hero-a',
    character_continuity_group_size: 2,
    character_reference_review: referenceReview(),
  });
  assert.equal(validateComicShotPlan(single, {
    sceneClass: 'narrative_illustration',
    visualStructureId: 'single-scene',
    treatmentProfileId: 'comic-manga-warm',
  }).result, 'pass');
});

test('rejects ineligible single panels, more than three panels, forbidden layouts, visible text, and diagrams', () => {
  assert.throws(() => validateComicShotPlan(comicPlan({
    panel_count: 1,
    panel_beats: [{panel_index: 1, purpose: '装饰', visual_action: '单幅定格'}],
  }), {
    sceneClass: 'narrative_illustration',
    visualStructureId: 'single-scene',
    treatmentProfileId: 'comic-manga-warm',
  }), /not eligible|single-panel/i);
  assert.throws(() => validateComicShotPlan(comicPlan({
    panel_count: 4,
    panel_beats: Array.from({length: 4}, (_, index) => ({panel_index: index + 1, purpose: '节拍', visual_action: '动作'})),
  }), {
    sceneClass: 'narrative_illustration',
    visualStructureId: 'sequential-panels',
    treatmentProfileId: 'comic-manga-warm',
  }), /1 to 3/i);
  assert.throws(() => validateComicShotPlan(comicPlan({layout: 'webtoon'}), {
    sceneClass: 'narrative_illustration',
    visualStructureId: 'sequential-panels',
    treatmentProfileId: 'comic-manga-warm',
  }), /layout/i);
  assert.throws(() => validateComicShotPlan(comicPlan({visible_text_mode: 'dialogue-bubble'}), {
    sceneClass: 'narrative_illustration',
    visualStructureId: 'sequential-panels',
    treatmentProfileId: 'comic-manga-warm',
  }), /visible_text_mode/i);
  assert.throws(() => validateComicShotPlan(comicPlan(), {
    sceneClass: 'structured_graphic',
    visualStructureId: 'architecture',
    treatmentProfileId: 'comic-manga-warm',
  }), /narrative_illustration/i);
});

test('blocks unapproved character references and requires canonical white-cat identity', () => {
  const pending = comicPlan({
    character_continuity_group_id: 'hero-a',
    character_continuity_group_size: 2,
    character_reference_review: {...referenceReview(), status: 'pending'},
  });
  assert.throws(() => validateComicShotPlan(pending, {
    sceneClass: 'narrative_illustration',
    visualStructureId: 'sequential-panels',
    treatmentProfileId: 'comic-manga-warm',
  }), /approved/i);
  assert.throws(() => validateComicShotPlan(comicPlan({
    character_reference_review: referenceReview('person'),
  }), {
    sceneClass: 'narrative_illustration',
    visualStructureId: 'sequential-panels',
    treatmentProfileId: 'comic-manga-warm',
    whiteCatPresent: true,
  }), /canonical white-cat/i);
});

test('recommends only registered inter-shot effects without bypassing approval', () => {
  assert.equal(recommendComicBoundaryTransition({
    sourceRoute: 'comic-imagegen',
    nextRoute: 'imagegen',
    sameCharacterOrObjectPosition: true,
  }).recommended_kind, 'match-cut');
  for (const nextRoute of ['ian-handdrawn-ppt', 'doodle-slides']) {
    assert.equal(recommendComicBoundaryTransition({
      sourceRoute: 'comic-imagegen',
      nextRoute,
    }).recommended_kind, 'paper-wipe');
  }
  assert.deepEqual(recommendComicBoundaryTransition({
    sourceRoute: 'comic-imagegen',
    nextRoute: 'srt-whiteboard-animation',
  }), {
    recommended_kind: 'wipe',
    recommended_options: {direction: 'from-right'},
    alternatives: ['dissolve'],
    recommendation_source: {
      authority: 'visual-generation-route',
      route_id: 'comic-imagegen',
      rule_id: 'legacy-comic-to-whiteboard-v1',
    },
  });
  assert.deepEqual(
    recommendComicBoundaryTransition({
      sourceRoute: 'comic-imagegen',
      nextRoute: 'srt-whiteboard-animation',
    }).recommended_options,
    resolveTransitionRecommendation({
      boundaryChangeClass: 'route_change',
      sourceVisualGenerationRoute: 'comic-imagegen',
      nextVisualGenerationRoute: 'srt-whiteboard-animation',
    }).recommended_transition.options,
  );
  assert.equal(recommendComicBoundaryTransition({
    sourceRoute: 'comic-imagegen',
    nextRoute: 'comic-imagegen',
  }).recommended_kind, 'dissolve');
});
