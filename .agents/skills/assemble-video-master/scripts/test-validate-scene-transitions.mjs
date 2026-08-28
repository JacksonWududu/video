#!/usr/bin/env node
import assert from 'node:assert/strict';
import {validateSceneTransitions} from './validate-scene-transitions.mjs';
import {
  IAN_LAYERED_ENTRY_EFFECTS_POLICY_SHA256,
  buildIanLayeredEntryEffectsMapSha256,
} from '../../../../leverage-video/src/shared/ian-layered-entry-effects/contract.mjs';

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
  schema_version: 'knowledge-video-assembly-plan-v2',
  full_master_frames: 300,
  narration_frames: 300,
  canvas: {fps: 30},
  timeline: {
    contract_version: 'direct-first-shot-v1',
    fixed_opening_cover: false,
    publishing_cover_timeline_consumed: false,
    first_shot_id: 'S01',
    first_shot_start_frame: 0,
    narration_start_frame: 0,
    first_sentence_end_frame: 100,
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
    opening_hard_cut_exceptions: [],
  },
  scenes: [
    {shot_id: 'S01', scene_type: 'narrative', white_cat_present: false, visual_generation_route: 'imagegen', start_frame: 0, end_frame: 200, transition_intent: '0.4s slide', transition: transition()},
    {shot_id: 'S02', scene_type: 'narrative', white_cat_present: false, visual_generation_route: 'imagegen', start_frame: 200, end_frame: 300, transition_intent: 'clean hold to end', transition: null},
  ],
};
const goodSource = `
import {TransitionedScene} from '../../../shared/scene-transitions';
<NarrationTrack asset={plan.narration_asset} durationInFrames={plan.narration_frames} from={0} />;
<TransitionedScene transition={scene.transition} durationInFrames={scene.duration_frames} isTerminal={sceneIndex === scenes.length - 1}></TransitionedScene>;
<GraphicScene visualGenerationRoute={scene.visual_generation_route ?? ''} />;
<IanLayeredScene scene={scene.ian_layered_scene!} visualGenerationRoute={scene.visual_generation_route} />;
useCurrentFrame; interpolate; layer.entry_frame; opacity;
<CanvasImage src={scene.image_sequence[0].asset} width={1920} height={1080} fit="fill" />;
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
  ian_layered_scene_contract: null,
  opening_contract_version: 'direct-first-shot-v1',
  opening_hard_cut_exceptions: [],
});
assert.equal(
  validateSceneTransitions({plan: goodPlan, source: sharedWrapperSource}).source_binding,
  'pass',
);

const oneClickDirectionPlan = structuredClone(goodPlan);
oneClickDirectionPlan.qa_contract.visual_direction_review.status = 'policy_authorized';
oneClickDirectionPlan.qa_contract.workflow_approval = {
  result: 'pass',
  density_mode: 'standard',
  approval_mode: 'one_click',
};
assert.equal(
  validateSceneTransitions({plan: oneClickDirectionPlan, source: goodSource}).source_binding,
  'pass',
);
const unboundPolicyDirectionPlan = structuredClone(oneClickDirectionPlan);
delete unboundPolicyDirectionPlan.qa_contract.workflow_approval;
assert.throws(
  () => validateSceneTransitions({plan: unboundPolicyDirectionPlan, source: goodSource}),
  /visual direction review/i,
);

const v3Plan = structuredClone(goodPlan);
v3Plan.schema_version = 'knowledge-video-assembly-plan-v3';
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
v3Plan.qa_contract.ian_layered_scene_packages = {
  contract_version: 'ian-layered-scene-consumption-evidence-v1',
  result: 'pass',
  shot_ids: [],
  records: [],
};
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
  ian_layered_scene: null,
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
  ian_layered_scene_contract: 'ian-static-layered-scene-v1',
  opening_contract_version: 'direct-first-shot-v1',
  opening_hard_cut_exceptions: [],
});

const ianPlan = structuredClone(v3Plan);
ianPlan.scenes.forEach((scene) => {
  const finalChecksum = `${scene.shot_id === 'S01' ? '4' : '5'}`.repeat(64);
  scene.image_sequence[0].checksum_sha256 = finalChecksum;
  Object.assign(scene, {
    scene_type: 'ian-layered',
    visual_generation_route: 'ian-handdrawn-ppt',
    visible_text_mode: 'required',
    exact_visible_text: '完整图',
    visible_text_placement: '画面内',
    visible_text_policy: 'approved-exact-text-raster-v1',
    ian_layered_scene: {
      contract_version: 'ian-static-layered-scene-v1',
      package_contract_version: 'ian-knowledge-video-layered-scene-v2',
      package_manifest: {
        path: `leverage-video/src/example/schema/${scene.shot_id}-ian-layered.json`,
        checksum_sha256: '1'.repeat(64),
      },
      scene_plan_sha256: '2'.repeat(64),
      layer_entry_transition: {
        contract_version: 'ian-layer-entry-fade-v1', duration_frames: 8, easing: 'linear',
      },
      background: {asset: `${scene.shot_id}-background.png`, checksum_sha256: '3'.repeat(64)},
      layers: [{
        layer_id: 'L01', z_index: 1, semantic_role: 'knowledge-structure',
        source_text_start_byte: 0, source_text_end_byte_exclusive: 3,
        source_text: '甲', entry_frame: 0,
        asset: `${scene.shot_id}-L01.png`, checksum_sha256: '6'.repeat(64),
      }],
      final_composite: {asset: scene.image_sequence[0].asset, checksum_sha256: finalChecksum},
      motion_policy: {
        scene_transform: 'forbidden', layer_transform: 'forbidden',
        mask_reveal: 'forbidden', internal_cut: 'forbidden',
        opacity_animation: 'ian-layer-entry-fade-v1',
      },
    },
  });
});
ianPlan.scenes[0].transition.source_visual_generation_route = 'ian-handdrawn-ppt';
ianPlan.scenes[0].transition.next_visual_generation_route = 'ian-handdrawn-ppt';
ianPlan.qa_contract.ian_layered_scene_packages = {
  contract_version: 'ian-layered-scene-consumption-evidence-v1',
  result: 'pass',
  shot_ids: ['S01', 'S02'],
  records: ianPlan.scenes.map((scene) => ({
    shot_id: scene.shot_id,
    package_manifest: structuredClone(scene.ian_layered_scene.package_manifest),
    package: {
      contract_version: 'ian-knowledge-video-layered-scene-v2',
      scene_plan_sha256: scene.ian_layered_scene.scene_plan_sha256,
      layers: scene.ian_layered_scene.layers.map((layer) => ({
        layer_id: layer.layer_id,
        checksum_sha256: layer.checksum_sha256,
        entry_frame: layer.entry_frame,
      })),
    },
  })),
};
assert.equal(
  validateSceneTransitions({plan: ianPlan, source: goodSource}).ian_layered_scene_contract,
  'ian-static-layered-scene-v1',
);
const animatedIanPlan = structuredClone(ianPlan);
animatedIanPlan.scenes.forEach((scene, index) => {
  const record = animatedIanPlan.qa_contract.ian_layered_scene_packages.records[index];
  const entryEffects = {
    contract_version: 'ian-layered-entry-effects-v2',
    shot_id: scene.shot_id,
    scene_plan_sha256: scene.ian_layered_scene.scene_plan_sha256,
    package_manifest: structuredClone(scene.ian_layered_scene.package_manifest),
    fps: 30,
    duration_frames: scene.end_frame - scene.start_frame,
    policy_authorization: {
      status: 'policy_authorized',
      policy_sha256: IAN_LAYERED_ENTRY_EFFECTS_POLICY_SHA256,
      user_has_reviewed_specific_map: false,
    },
    sound_effect_library: {
      path: 'leverage-video/src/shared/sound-effects/manifest.json',
      checksum_sha256: '7'.repeat(64),
    },
    mix_policy: {
      narration_gain: 1, normalize: false, peak_ceiling_dbfs: -1,
      narration_mean_loudness_change_max_db: 0.5,
      overflow_action: 'lower-sfx-bus-uniformly',
    },
    language_families: ['soft-settle-v1'],
    layer_count: 1,
    layers: [{
      layer_id: 'L01', entry_frame: 0, element_class: 'paper_card',
      language_family: 'soft-settle-v1',
      effect: {
        contract_version: 'soft-settle-v1', duration_frames: 8,
        opacity_easing: 'linear', translation_profile: 'fixed-damped-v1',
        axis: 'x', direction: 1, max_displacement_px: 10, edge_margin_px: 24,
      },
      sound_effect: {
        contract_version: 'ian-layer-entry-sfx-cue-v2', role: 'paper_slide',
        selection_reason: '关键纸卡入场',
        source: {
          asset_id: 'paper-slide-mixkit-1530',
          path: 'leverage-video/src/shared/sound-effects/assets/paper-slide-mixkit-1530.wav',
          checksum_sha256: '8'.repeat(64),
          trim_start_sample: 0, trim_end_sample_exclusive: 8820,
        },
        derived_asset: {
          asset: `${scene.shot_id}-entry.wav`, checksum_sha256: '9'.repeat(64),
          sample_rate_hz: 44100, channels: 2,
        },
        cue_frame: 0, cue_sample: 0, gain_multiplier: 0.17,
      },
    }],
    presented_map_sha256: '',
  };
  entryEffects.presented_map_sha256 = buildIanLayeredEntryEffectsMapSha256(entryEffects);
  scene.ian_layered_scene.contract_version = 'ian-layered-entry-effects-renderer-v2';
  delete scene.ian_layered_scene.layer_entry_transition;
  delete scene.ian_layered_scene.motion_policy;
  scene.ian_layered_scene.entry_effects = entryEffects;
  record.entry_effects = structuredClone(entryEffects);
});
assert.equal(
  validateSceneTransitions({
    plan: animatedIanPlan,
    source: `${goodSource}\n<Audio volume={entry.sound_effect.gain_multiplier} />; strokeDasharray; strokeDashoffset; <mask />; softSettleOffset;`,
  }).ian_layered_scene_contract,
  'ian-layered-entry-effects-renderer-v2',
);
assert.throws(
  () => validateSceneTransitions({
    plan: animatedIanPlan,
    source: `${goodSource}\n<Audio volume={entry.sound_effect.gain_multiplier} />; strokeDasharray; strokeDashoffset; <mask />; softSettleOffset; const AnimatedLayer = () => scale(1); export const IanLayeredScene = AnimatedLayer;`,
  }),
  /does not consume the approved Ian entry motion/i,
);
const retiredMotionPlan = structuredClone(ianPlan);
retiredMotionPlan.scenes[1].internal_motion_contract = 'ian-subtle-raster-motion-v1';
retiredMotionPlan.scenes[1].internal_motion = {start: {scale: 1}, end: {scale: 1.04}};
assert.throws(
  () => validateSceneTransitions({plan: retiredMotionPlan, source: goodSource}),
  /whole-raster motion is retired/i,
);
const transformedIanPlan = structuredClone(ianPlan);
transformedIanPlan.scenes[0].ian_layered_scene.motion_policy.scene_transform = 'allowed';
assert.throws(
  () => validateSceneTransitions({plan: transformedIanPlan, source: goodSource}),
  /stale or permits motion/i,
);
const staleIanScene = structuredClone(ianPlan);
staleIanScene.scenes[0].ian_layered_scene.layers = [];
assert.throws(
  () => validateSceneTransitions({plan: staleIanScene, source: goodSource}),
  /stale or permits motion|static layered package/i,
);
assert.throws(
  () => validateSceneTransitions({
    plan: ianPlan,
    source: `${goodSource}\n<FullFrameMaskSweep />;`,
  }),
  /forbidden full-frame mask sweep/i,
);
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
<NarrationTrack asset={plan.narration_asset} durationInFrames={plan.narration_frames} from={0} />;
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
        opening_hard_cut_exceptions: ['OPEN-00→S01'],
      },
    },
    source: goodSource,
  }),
  /retired opening data or hard-cut exceptions remain active/,
);
assert.throws(
  () => validateSceneTransitions({
    plan: {...goodPlan, timeline: {...goodPlan.timeline, narration_start_frame: 30}},
    source: goodSource,
  }),
  /must begin at frame zero/,
);
assert.throws(
  () => validateSceneTransitions({
    plan: goodPlan,
    source: `${goodSource}\n<EpisodeOpening />`,
  }),
  /retired fixed opening cover/,
);
assert.throws(
  () => validateSceneTransitions({
    plan: {
      ...goodPlan,
      timeline: {...goodPlan.timeline, first_shot_id: 'S02'},
      scenes: [
        {...goodPlan.scenes[0], shot_id: 'S02'},
        {...goodPlan.scenes[1], shot_id: 'S03'},
      ],
    },
    source: goodSource,
  }),
  /S01 and narration must begin at frame zero/,
);

console.log('validate_scene_transitions_contract=pass');
