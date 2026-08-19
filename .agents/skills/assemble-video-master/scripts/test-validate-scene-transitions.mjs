#!/usr/bin/env node
import assert from 'node:assert/strict';
import {validateSceneTransitions} from './validate-scene-transitions.mjs';

const transition = (kind = 'slide') => ({
  contract_version: 'scene-transition-v2',
  catalog_version: 'scene-transition-catalog-v2',
  source_shot_id: 'S01',
  next_shot_id: 'S02',
  kind,
  options: kind === 'slide' ? {direction: 'from-left'} : {},
  duration_seconds: 0.4,
  duration_in_frames: 12,
  source_intent: `0.4s ${kind}`,
  renderer: 'leverage-video/src/shared/scene-transitions',
  user_selection: {
    status: 'approved',
    exact_message: '确认推荐表里的全部转场',
    decided_at: '2026-08-14T10:00:00+08:00',
    presented_map_sha256: 'b'.repeat(64),
  },
});

const goodPlan = {
  canvas: {fps: 30},
  opening: {
    contract_version: 'cover-only-v1',
    shot_id: 'OPEN-00',
    cover_source: '/Users/jackson/Desktop/video-edit/video-resource/cover.png',
    source_is_regular_file: true,
    source_is_symlink: false,
    source_format: 'png',
    source_decode_result: 'pass',
    source_aspect_ratio_relative_error: 0.000532,
    normalized_width: 1920,
    normalized_height: 1080,
    text_overlay: false,
    start_frame: 0,
    narration_start_frame: 0,
    first_sentence_end_frame: 100,
    episode_opening_frames: 100,
    narration_master_frames: 300,
    final_master_frames: 300,
  },
  qa_contract: {
    scene_transition_contract: 'scene-transition-v2',
    transition_selection_review: {
      status: 'approved',
      catalog_version: 'scene-transition-catalog-v2',
      path: 'leverage-video/src/example/schema/transition-selection-review-v1.json',
      checksum_sha256: 'd'.repeat(64),
      presented_map_sha256: 'b'.repeat(64),
      ordinary_boundary_count: 1,
    },
    scene_routing_contract: 'explicit-visual-generation-route-v1',
    visual_direction_review: {
      result: 'pass',
      status: 'approved',
      contract_version: 'per-shot-visual-direction-review-v1',
      catalog_version: 'visual-generation-route-catalog-v1',
      catalog_checksum_sha256: 'a'.repeat(64),
      presented_map_sha256: 'c'.repeat(64),
      generated_shot_count: 2,
      path: 'leverage-video/src/example/schema/per-shot-visual-direction-review-v1.json',
      checksum_sha256: 'e'.repeat(64),
    },
    visual_direction_artifact_policy: {
      result: 'pass',
      artifact_mode: 'legacy_read_only',
      contract_version: 'per-shot-visual-direction-review-v1',
      modified_shot_ids: [],
    },
    ordinary_boundaries_with_animated_transitions: 1,
    opening_hard_cut_exceptions: ['OPEN-00→S01'],
  },
  scenes: [
    {shot_id: 'S01', scene_type: 'narrative', white_cat_present: false, visual_generation_route: 'imagegen', start_frame: 100, end_frame: 200, transition_intent: '0.4s slide', transition: transition()},
    {shot_id: 'S02', scene_type: 'narrative', white_cat_present: false, visual_generation_route: 'imagegen', start_frame: 200, end_frame: 300, transition_intent: 'clean hold to end', transition: null},
  ],
};
const goodSource = `
import {TransitionedScene} from '../../../shared/scene-transitions';
const openingContractVersion = 'cover-only-v1';
<EpisodeOpening coverSource={opening.cover_source} durationInFrames={opening.first_sentence_end_frame} narrationStartFrame={0} />;
<TransitionedScene transition={scene.transition} durationInFrames={scene.duration_frames} isTerminal={sceneIndex === scenes.length - 1}></TransitionedScene>;
<GraphicScene visualGenerationRoute={scene.visual_generation_route ?? ''} />;
<DoodleScene visualGenerationRoute={scene.visual_generation_route} />;
<ComicScene visualGenerationRoute={scene.visual_generation_route} comicPlan={scene.comic_plan!} />;
<IntraShotImageSequence occurrences={scene.image_sequence} transitions={scene.intra_shot_transitions} />;
`;
const sharedWrapperSource = `
import {KnowledgeVideo} from '../../../shared/video-scenes';
export const Topic3CaptionFree=()=> <KnowledgeVideo plan={plan} />;
`;

assert.deepEqual(validateSceneTransitions({plan: goodPlan, source: goodSource}), {
  contract_version: 'scene-transition-v2',
  ordinary_boundary_count: 1,
  animated_transition_count: 1,
  source_binding: 'pass',
  scene_routing: 'pass_explicit_visual_generation_routes',
  whiteboard_scene_count: 0,
  comic_scene_count: 0,
  opening_contract_version: 'cover-only-v1',
  opening_hard_cut_exceptions: ['OPEN-00→S01'],
});
assert.equal(
  validateSceneTransitions({plan: goodPlan, source: sharedWrapperSource}).source_binding,
  'pass',
);

const v3Plan = structuredClone(goodPlan);
v3Plan.qa_contract.scene_transition_contract = 'scene-transition-v3';
v3Plan.qa_contract.transition_selection_review.catalog_version = 'scene-transition-catalog-v3';
v3Plan.qa_contract.scene_routing_contract = 'explicit-visual-generation-route-v3';
v3Plan.qa_contract.visual_direction_review.contract_version = 'per-shot-visual-direction-review-v3';
v3Plan.qa_contract.visual_direction_review.catalog_version = 'visual-generation-route-catalog-v2';
v3Plan.qa_contract.visual_direction_artifact_policy = {
  result: 'pass',
  artifact_mode: 'current_v3',
  contract_version: 'per-shot-visual-direction-review-v3',
  modified_shot_ids: ['S01', 'S02'],
};
v3Plan.qa_contract.storyboard_visual_rhythm = {
  result: 'pass',
  contract_version: 'storyboard-visual-rhythm-v1',
};
v3Plan.qa_contract.intra_shot_transition_contract = 'intra-shot-transition-v1';
v3Plan.qa_contract.ordinary_boundaries_with_transition_decisions = 1;
v3Plan.qa_contract.ordinary_boundaries_with_animated_transitions = 0;
v3Plan.qa_contract.ordinary_boundaries_with_cuts = 1;
v3Plan.scenes.forEach((scene) => Object.assign(scene, {
  duration_frames: scene.end_frame - scene.start_frame,
  motion_tier: 'layered',
  intra_shot_transition_contract: 'intra-shot-transition-v1',
  image_sequence: [{
    asset_id: `${scene.shot_id}-master`,
    asset: `${scene.shot_id}.png`,
    from: 0,
    duration_in_frames: scene.end_frame - scene.start_frame,
  }],
  intra_shot_transitions: [],
  visible_text_mode: 'none',
  exact_visible_text: null,
  visible_text_placement: null,
  visible_text_policy: 'approved-raster-v1',
  assembly_text_policy: 'asset-owned-no-timeline-overlay-v1',
  timeline_text_overlays: [],
}));
v3Plan.scenes[0].transition_intent = '连续语义直接切到下一镜';
v3Plan.scenes[0].transition = {
  contract_version: 'scene-transition-v3',
  catalog_version: 'scene-transition-catalog-v3',
  source_shot_id: 'S01',
  next_shot_id: 'S02',
  boundary_change_class: 'continuity',
  source_visual_generation_route: 'imagegen',
  next_visual_generation_route: 'imagegen',
  source_white_cat_present: false,
  next_white_cat_present: false,
  recommended_transition: {kind: 'cut', options: {}},
  recommendation_source: {
    authority: 'shared-fallback',
    rule_id: 'scene-transition-semantic-fallback-v1',
  },
  kind: 'cut',
  options: {},
  duration_seconds: 0,
  duration_in_frames: 0,
  source_intent: v3Plan.scenes[0].transition_intent,
  renderer: 'leverage-video/src/shared/scene-transitions',
  user_selection: {
    status: 'approved',
    exact_message: '确认 S01 到 S02 使用 cut',
    decided_at: '2026-08-15T10:00:00+08:00',
    presented_map_sha256: 'b'.repeat(64),
  },
};
assert.deepEqual(validateSceneTransitions({plan: v3Plan, source: goodSource}), {
  contract_version: 'scene-transition-v3',
  ordinary_boundary_count: 1,
  animated_transition_count: 0,
  cut_count: 1,
  source_binding: 'pass',
  scene_routing: 'pass_explicit_visual_generation_routes',
  whiteboard_scene_count: 0,
  comic_scene_count: 0,
  opening_contract_version: 'cover-only-v1',
  opening_hard_cut_exceptions: ['OPEN-00→S01'],
});
const staleSchemaPolicyPlan = structuredClone(v3Plan);
staleSchemaPolicyPlan.qa_contract.visual_direction_artifact_policy.artifact_mode = 'legacy_read_only';
assert.throws(
  () => validateSceneTransitions({plan: staleSchemaPolicyPlan, source: goodSource}),
  /current_v3 visual direction evidence/i,
);
const modifiedLegacyPolicyPlan = structuredClone(goodPlan);
modifiedLegacyPolicyPlan.qa_contract.visual_direction_artifact_policy.modified_shot_ids = ['S01'];
assert.throws(
  () => validateSceneTransitions({plan: modifiedLegacyPolicyPlan, source: goodSource}),
  /unchanged legacy read-only/i,
);
const whiteCatTextPlan = structuredClone(v3Plan);
whiteCatTextPlan.scenes[0].white_cat_present = true;
whiteCatTextPlan.scenes[0].visible_text_mode = 'required';
whiteCatTextPlan.scenes[0].exact_visible_text = '警惕误区';
whiteCatTextPlan.scenes[0].visible_text_placement = '顶部';
whiteCatTextPlan.scenes[0].visible_text_policy = 'text-free-v1';
assert.throws(
  () => validateSceneTransitions({plan: whiteCatTextPlan, source: goodSource}),
  /text-free route.*visible text.*top title/i,
);
const genericTitleSource = `${goodSource}\nconst TopTitle = () => null;`;
assert.throws(
  () => validateSceneTransitions({plan: v3Plan, source: genericTitleSource}),
  /generic top-title timeline overlay/i,
);
const staleV3Counts = structuredClone(v3Plan);
staleV3Counts.qa_contract.ordinary_boundaries_with_cuts = 0;
assert.throws(
  () => validateSceneTransitions({plan: staleV3Counts, source: goodSource}),
  /semantic transition counts/i,
);

const revoicePlan = structuredClone(v3Plan);
revoicePlan.qa_contract.revoice_transition_lock = 'strict-parent-transition-v1';
revoicePlan.scenes[0].revoice_parent_transition = structuredClone(revoicePlan.scenes[0].transition);
revoicePlan.scenes[1].revoice_parent_transition = null;
assert.equal(
  validateSceneTransitions({plan: revoicePlan, source: goodSource}).contract_version,
  'scene-transition-v3',
);
const revoiceDrift = structuredClone(revoicePlan);
revoiceDrift.scenes[0].transition = {
  ...revoiceDrift.scenes[0].transition,
  kind: 'dissolve',
  duration_seconds: 0.4,
  duration_in_frames: 12,
};
assert.throws(
  () => validateSceneTransitions({plan: revoiceDrift, source: goodSource}),
  /revoice must preserve parent transition/i,
);

const doodlePlan = structuredClone(goodPlan);
doodlePlan.scenes[0].scene_type = 'doodle';
doodlePlan.scenes[0].visual_generation_route = 'doodle-slides';
assert.throws(
  () => validateSceneTransitions({plan: doodlePlan, source: goodSource}),
  /doodle-slides.*legacy read-only/i,
);

const inkPlan = structuredClone(v3Plan);
inkPlan.scenes[0].scene_type = 'graphic';
inkPlan.scenes[0].visual_generation_route = 'ink-doodle-knowledge-card';
inkPlan.scenes[0].visible_text_policy = 'approved-exact-text-raster-v1';
inkPlan.scenes[0].transition.source_visual_generation_route = 'ink-doodle-knowledge-card';
assert.equal(
  validateSceneTransitions({plan: inkPlan, source: goodSource}).scene_routing,
  'pass_explicit_visual_generation_routes',
);

const comicPlan = structuredClone(goodPlan);
comicPlan.qa_contract.scene_routing_contract = 'explicit-visual-generation-route-v2';
comicPlan.qa_contract.visual_direction_review.contract_version = 'per-shot-visual-direction-review-v2';
comicPlan.qa_contract.visual_direction_review.catalog_version = 'visual-generation-route-catalog-v2';
comicPlan.qa_contract.visual_direction_artifact_policy.contract_version = 'per-shot-visual-direction-review-v2';
comicPlan.scenes[0] = {
  ...comicPlan.scenes[0],
  scene_type: 'comic',
  scene_class: 'narrative_illustration',
  visual_generation_route: 'comic-imagegen',
  duration_frames: 100,
  comic_plan: {contract_version: 'comic-shot-plan-v1'},
  image_sequence: [
    {
      asset: 'example/assets/image/s01-comic-a.png',
      visual_generation_route: 'comic-imagegen',
      width: 1920,
      height: 1080,
      review_status: 'approved',
      generator: 'codex-native-imagegen',
      duration_in_frames: 50,
    },
    {
      asset: 'example/assets/image/s01-comic-b.png',
      visual_generation_route: 'comic-imagegen',
      width: 1920,
      height: 1080,
      review_status: 'approved',
      generator: 'codex-native-imagegen',
      duration_in_frames: 50,
    },
  ],
  intra_shot_transitions: [{
    contract_version: 'intra-shot-watercolor-bloom-v1',
    kind: 'watercolor-bloom',
    duration_seconds: 0.6,
    duration_in_frames: 18,
    from_image_index: 0,
    to_image_index: 1,
    renderer: 'leverage-video/src/shared/watercolor-bloom',
  }],
};
assert.throws(
  () => validateSceneTransitions({plan: comicPlan, source: goodSource}),
  /comic-imagegen.*legacy read-only/i,
);

const whiteboardPlan = structuredClone(goodPlan);
whiteboardPlan.scenes[0] = {
  ...whiteboardPlan.scenes[0],
  scene_type: 'whiteboard',
  visual_generation_route: 'srt-whiteboard-animation',
  duration_frames: 100,
  whiteboard: {
    contract_version: 'whiteboard-scene-v1',
    clip: {asset: 'example/assets/video/s01-whiteboard.mp4', checksum_sha256: '1'.repeat(64)},
    render_evidence: {
      contract_version: 'whiteboard-render-evidence-v1',
      media: {
        width: 1920,
        height: 1080,
        fps: 30,
        codec: 'h264',
        audio_streams: 0,
        frame_count: 100,
        final_frame_verified: true,
        full_frame_hold_verified_frames: 15,
      },
    },
    source_duration_frames: 100,
    timing_segments: [{
      source_start_frame: 0,
      source_end_frame: 100,
      output_start_frame: 0,
      output_end_frame: 100,
      playback_rate: 1,
    }],
    visual_sequence_lock: {clip_sha256: '1'.repeat(64)},
  },
};
const whiteboardSource = `${goodSource}
<WhiteboardScene><OffthreadVideo trimBefore={segment.source_start_frame} playbackRate={segment.playback_rate} muted /></WhiteboardScene>;
`;
assert.equal(
  validateSceneTransitions({plan: whiteboardPlan, source: whiteboardSource}).whiteboard_scene_count,
  1,
);
assert.throws(
  () => validateSceneTransitions({plan: whiteboardPlan, source: goodSource}),
  /does not consume approved whiteboard MP4/i,
);

assert.throws(
  () => validateSceneTransitions({
    plan: {
      ...goodPlan,
      qa_contract: {...goodPlan.qa_contract, visual_direction_review: undefined},
    },
    source: goodSource,
  }),
  /visual direction review/i,
);

assert.throws(
  () => validateSceneTransitions({
    plan: {
      ...goodPlan,
      scenes: [{...goodPlan.scenes[0], scene_type: 'graphic', visual_generation_route: 'doodle-slides'}, goodPlan.scenes[1]],
    },
    source: goodSource,
  }),
  /doodle-slides.*legacy read-only/i,
);

assert.throws(
  () => validateSceneTransitions({
    plan: {...goodPlan, scenes: [{...goodPlan.scenes[0], transition: undefined}, goodPlan.scenes[1]]},
    source: goodSource,
  }),
  /missing structured transition/,
);
assert.throws(
  () => validateSceneTransitions({
    plan: {
      ...goodPlan,
      qa_contract: {
        ...goodPlan.qa_contract,
        transition_selection_review: {
          ...goodPlan.qa_contract.transition_selection_review,
          presented_map_sha256: 'c'.repeat(64),
        },
      },
    },
    source: goodSource,
  }),
  /transition review checksum mismatch/,
);
assert.throws(
  () => validateSceneTransitions({
    plan: {
      ...goodPlan,
      scenes: [{
        ...goodPlan.scenes[0],
        transition: {
          ...transition(),
          user_selection: {...transition().user_selection, status: 'pending'},
        },
      }, goodPlan.scenes[1]],
    },
    source: goodSource,
  }),
  /user selection/i,
);
assert.throws(
  () => validateSceneTransitions({
    plan: {
      ...goodPlan,
      scenes: [{...goodPlan.scenes[0], transition: transition('none')}, goodPlan.scenes[1]],
    },
    source: goodSource,
  }),
  /unsupported transition kind/,
);
assert.throws(
  () => validateSceneTransitions({
    plan: goodPlan,
    source: `
const openingContractVersion = 'cover-only-v1';
<EpisodeOpening coverSource={opening.cover_source} durationInFrames={opening.first_sentence_end_frame} narrationStartFrame={0} />;
<Sequence />;
`,
  }),
  /does not import the shared TransitionedScene renderer/,
);
assert.throws(
  () => validateSceneTransitions({
    plan: {...goodPlan, scenes: [{...goodPlan.scenes[0], transition: transition('glitch')}, goodPlan.scenes[1]]},
    source: goodSource,
  }),
  /unsupported transition kind/,
);
assert.throws(
  () => validateSceneTransitions({
    plan: {
      ...goodPlan,
      qa_contract: {
        ...goodPlan.qa_contract,
        opening_hard_cut_exceptions: ['OPEN-00→OPEN-01', 'OPEN-01→S01'],
      },
    },
    source: goodSource,
  }),
  /opening hard-cut exceptions are missing or overbroad/,
);
assert.throws(
  () => validateSceneTransitions({
    plan: {...goodPlan, opening: {...goodPlan.opening, narration_start_frame: 30}},
    source: goodSource,
  }),
  /must start at frame zero/,
);
assert.throws(
  () => validateSceneTransitions({
    plan: goodPlan,
    source: goodSource.replace('coverSource={opening.cover_source}', 'coverSource={legacyCover}'),
  }),
  /does not bind opening.cover_source/,
);
assert.throws(
  () => validateSceneTransitions({
    plan: {
      ...goodPlan,
      qa_contract: {...goodPlan.qa_contract, opening_hard_cut_exceptions: ['OPEN-00→S02']},
      scenes: [
        {...goodPlan.scenes[0], shot_id: 'S02'},
        {...goodPlan.scenes[1], shot_id: 'S03'},
      ],
    },
    source: goodSource,
  }),
  /first content shot must be S01/,
);

console.log('validate_scene_transitions_contract=pass');
