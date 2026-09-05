#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  TRANSITION_KINDS,
  validateRevoiceTransitionLock,
  validateUserApprovedTransition,
} from '../../../../leverage-video/src/shared/scene-transitions/contract.mjs';
import {validateIntraShotWatercolorTransition} from '../../../../leverage-video/src/shared/watercolor-bloom/contract.mjs';
import {
  INTRA_SHOT_TRANSITION_VERSION,
  validateIntraShotTransitionSequence,
} from '../../../../leverage-video/src/shared/intra-shot-transitions/contract.mjs';
import {
  ACTION_STATE_SCHEDULE_V3_VERSION,
  ACTION_STATE_SCHEDULE_V4_VERSION,
  validateActionStateSchedule,
} from '../../../../leverage-video/src/shared/action-state-schedule/contract.mjs';
import {resolveRouteVisibleTextPolicy} from '../../../../leverage-video/src/shared/visual-generation-routes/contract.mjs';
import {
  IAN_LAYERED_SCENE_PACKAGE_VERSION,
  IAN_LAYERED_SCENE_RENDERER_VERSION,
  IAN_LAYER_ENTRY_DURATION_FRAMES,
  IAN_LAYER_ENTRY_TRANSITION_VERSION,
} from '../../../../leverage-video/src/shared/ian-layered-scene/contract.mjs';
import {
  IAN_LAYERED_ENTRY_RENDERER_VERSION,
  validateIanLayeredEntryEffectsPlan,
} from '../../../../leverage-video/src/shared/ian-layered-entry-effects/contract.mjs';

const LEGACY_ALLOWED_KINDS = new Set(TRANSITION_KINDS);
const SHA256 = /^[a-f0-9]{64}$/;
const IAN_ROUTE = 'ian-handdrawn-ppt';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(HERE, '../../../..');

const expandSharedRendererSource = (source) => {
  if (!/shared\/video-scenes/.test(source) || !/KnowledgeVideo/.test(source)) return source;
  return [
    source,
    fs.readFileSync(path.join(REPOSITORY_ROOT, 'leverage-video/src/shared/video-scenes/KnowledgeVideo.tsx'), 'utf8'),
    fs.readFileSync(path.join(REPOSITORY_ROOT, 'leverage-video/src/shared/video-scenes/ComicScene.tsx'), 'utf8'),
    fs.readFileSync(path.join(REPOSITORY_ROOT, 'leverage-video/src/shared/video-scenes/NarrativeScene.tsx'), 'utf8'),
    fs.readFileSync(path.join(REPOSITORY_ROOT, 'leverage-video/src/shared/video-scenes/GraphicScene.tsx'), 'utf8'),
    fs.readFileSync(path.join(REPOSITORY_ROOT, 'leverage-video/src/shared/video-scenes/IanLayeredScene.tsx'), 'utf8'),
    fs.readFileSync(path.join(REPOSITORY_ROOT, 'leverage-video/src/shared/video-scenes/DoodleScene.tsx'), 'utf8'),
    fs.readFileSync(path.join(REPOSITORY_ROOT, 'leverage-video/src/shared/video-scenes/WhiteboardScene.tsx'), 'utf8'),
    fs.readFileSync(path.join(REPOSITORY_ROOT, 'leverage-video/src/shared/video-scenes/LocalVideoScene.tsx'), 'utf8'),
  ].join('\n');
};

const validateIanLayeredSceneCoverage = ({evidence, scenes}) => {
  const expectedShotIds = scenes
    .filter((scene) => scene.visual_generation_route === IAN_ROUTE)
    .map((scene) => scene.shot_id);
  if (evidence?.contract_version !== 'ian-layered-scene-consumption-evidence-v1'
    || evidence?.result !== 'pass'
    || JSON.stringify(evidence?.shot_ids) !== JSON.stringify(expectedShotIds)
    || !Array.isArray(evidence?.records)
    || JSON.stringify(evidence.records.map((record) => record?.shot_id))
      !== JSON.stringify(expectedShotIds)) {
    throw new Error('v3 assembly lacks complete Ian layered-scene package evidence');
  }
  const sceneByShotId = new Map(scenes.map((scene) => [scene.shot_id, scene]));
  const rendererVersions = new Set();
  for (const record of evidence.records) {
    const scene = sceneByShotId.get(record.shot_id);
    const binding = scene?.ian_layered_scene;
    const packageValue = record.package;
    const commonInvalid = ![IAN_LAYERED_SCENE_RENDERER_VERSION, IAN_LAYERED_ENTRY_RENDERER_VERSION]
      .includes(binding?.contract_version)
      || binding.package_contract_version !== IAN_LAYERED_SCENE_PACKAGE_VERSION
      || packageValue?.contract_version !== IAN_LAYERED_SCENE_PACKAGE_VERSION
      || JSON.stringify(binding.package_manifest) !== JSON.stringify(record.package_manifest)
      || binding.scene_plan_sha256 !== packageValue.scene_plan_sha256
      || !Array.isArray(binding.layers)
      || binding.layers.length !== packageValue.layers?.length
      || binding.layers.some((layer, index) => (
        layer.layer_id !== packageValue.layers[index].layer_id
        || layer.checksum_sha256 !== packageValue.layers[index].checksum_sha256
        || layer.entry_frame !== packageValue.layers[index].entry_frame
      ));
    if (commonInvalid) {
      throw new Error(`${record.shot_id} Ian layered-scene binding is stale or permits motion`);
    }
    if (binding.contract_version === IAN_LAYERED_SCENE_RENDERER_VERSION) {
      if (binding.layer_entry_transition?.contract_version !== IAN_LAYER_ENTRY_TRANSITION_VERSION
        || binding.layer_entry_transition?.duration_frames !== IAN_LAYER_ENTRY_DURATION_FRAMES
        || binding.layer_entry_transition?.easing !== 'linear'
        || binding.motion_policy?.scene_transform !== 'forbidden'
        || binding.motion_policy?.layer_transform !== 'forbidden'
        || binding.motion_policy?.mask_reveal !== 'forbidden'
        || binding.motion_policy?.internal_cut !== 'forbidden'
        || binding.motion_policy?.opacity_animation !== IAN_LAYER_ENTRY_TRANSITION_VERSION) {
        throw new Error(`${record.shot_id} legacy Ian binding is stale or permits motion`);
      }
    } else {
      if (JSON.stringify(binding.entry_effects) !== JSON.stringify(record.entry_effects)) {
        throw new Error(`${record.shot_id} Ian entry-effects evidence differs from the rendered binding`);
      }
      validateIanLayeredEntryEffectsPlan(binding.entry_effects, {
        shotId: record.shot_id,
        scenePlanSha256: binding.scene_plan_sha256,
        packageManifest: binding.package_manifest,
        durationFrames: scene.duration_frames,
        layerEntries: binding.layers.map(({layer_id, entry_frame}) => ({layer_id, entry_frame})),
        libraryManifestSha256: binding.entry_effects.sound_effect_library.checksum_sha256,
      });
    }
    rendererVersions.add(binding.contract_version);
  }
  if (rendererVersions.size > 1) {
    throw new Error('one assembly may not mix legacy and active Ian entry renderer contracts');
  }
  return {
    contract_version: [...rendererVersions][0] ?? IAN_LAYERED_SCENE_RENDERER_VERSION,
    shot_ids: expectedShotIds,
  };
};

const validateDirectFirstShot = ({plan, source}) => {
  const timeline = plan?.timeline;
  if (!['knowledge-video-assembly-plan-v2', 'knowledge-video-assembly-plan-v3']
    .includes(plan?.schema_version)
    || timeline?.contract_version !== 'direct-first-shot-v1'
    || timeline?.fixed_opening_cover !== false
    || timeline?.publishing_cover_timeline_consumed !== false) {
    throw new Error('assembly plan does not declare direct-first-shot-v1 without a timeline cover');
  }
  if (timeline?.narration_start_frame !== 0 || timeline?.first_shot_start_frame !== 0
    || timeline?.first_shot_id !== 'S01' || plan.scenes[0]?.shot_id !== 'S01'
    || plan.scenes[0]?.start_frame !== 0) {
    throw new Error('S01 and narration must begin at frame zero');
  }
  if (!Number.isInteger(timeline?.first_sentence_end_frame)
    || timeline.first_sentence_end_frame <= 0
    || timeline.first_sentence_end_frame >= plan.narration_frames
    || timeline.final_master_frames !== timeline.narration_master_frames
    || timeline.final_master_frames !== plan.full_master_frames) {
    throw new Error('direct-first-shot timeline duration evidence is invalid');
  }
  if (Object.hasOwn(plan, 'opening')
    || JSON.stringify(plan?.qa_contract?.opening_hard_cut_exceptions) !== '[]') {
    throw new Error('retired opening data or hard-cut exceptions remain active');
  }
  if (/EpisodeOpening|OPEN-0[01]|cover-only-v1|plan\.opening|opening\.cover/.test(source)) {
    throw new Error('composition still consumes a retired fixed opening cover');
  }
  if (!/<NarrationTrack[\s\S]*?from=\{0\}/.test(source)) {
    throw new Error('composition does not bind narration to frame zero');
  }
  return [];
};

export const validateSceneTransitions = ({plan, source}) => {
  source = expandSharedRendererSource(source);
  if (!Array.isArray(plan?.scenes) || plan.scenes.length < 1) throw new Error('assembly plan has no scenes');
  const fps = plan?.canvas?.fps;
  if (!Number.isInteger(fps) || fps <= 0) throw new Error('assembly plan has invalid fps');
  const transitionContract = plan?.qa_contract?.scene_transition_contract;
  if (!['scene-transition-v1', 'scene-transition-v2', 'scene-transition-v3'].includes(transitionContract)) {
    throw new Error('assembly plan does not declare a supported scene-transition contract');
  }
  const ordinaryBoundaryCount = plan.scenes.length - 1;
  if (transitionContract === 'scene-transition-v3') {
    if (plan?.qa_contract?.ordinary_boundaries_with_transition_decisions !== ordinaryBoundaryCount) {
      throw new Error('assembly plan transition decisions do not cover every ordinary boundary');
    }
  } else if (plan?.qa_contract?.ordinary_boundaries_with_animated_transitions !== ordinaryBoundaryCount) {
    throw new Error('assembly plan transition count does not cover every ordinary boundary');
  }
  const transitionSelectionReview = plan?.qa_contract?.transition_selection_review;
  const expectedTransitionCatalog = transitionContract === 'scene-transition-v3'
    ? 'scene-transition-catalog-v3'
    : 'scene-transition-catalog-v2';
  const transitionReviewStatusIsValid = transitionSelectionReview?.status === 'approved'
    || (transitionSelectionReview?.status === 'policy_authorized'
      && plan?.qa_contract?.workflow_approval?.result === 'pass'
      && plan.qa_contract.workflow_approval.approval_mode === 'one_click'
      && plan.scenes.slice(0, -1).every((scene) => (
        scene.transition?.user_selection?.status === 'policy_authorized'
        && SHA256.test(scene.transition.user_selection.policy_sha256 ?? '')
      )));
  if (['scene-transition-v2', 'scene-transition-v3'].includes(transitionContract)
    && (!transitionReviewStatusIsValid
      || transitionSelectionReview?.catalog_version !== expectedTransitionCatalog
      || typeof transitionSelectionReview?.path !== 'string'
      || transitionSelectionReview.path.trim() === ''
      || !SHA256.test(transitionSelectionReview?.checksum_sha256 ?? '')
      || !SHA256.test(transitionSelectionReview?.presented_map_sha256 ?? '')
      || transitionSelectionReview?.ordinary_boundary_count !== plan.scenes.length - 1)) {
    throw new Error('assembly plan lacks a passing transition selection review');
  }
  const openingExceptions = validateDirectFirstShot({plan, source});
  const sceneRoutingContract = plan?.qa_contract?.scene_routing_contract;
  if (![
    'explicit-visual-generation-route-v1',
    'explicit-visual-generation-route-v2',
    'explicit-visual-generation-route-v3',
  ].includes(sceneRoutingContract)) {
    throw new Error('assembly plan does not declare a supported explicit visual-generation route contract');
  }
  const visualDirectionReview = plan?.qa_contract?.visual_direction_review;
  const expectedDirectionContract = {
    'explicit-visual-generation-route-v1': 'per-shot-visual-direction-review-v1',
    'explicit-visual-generation-route-v2': 'per-shot-visual-direction-review-v2',
    'explicit-visual-generation-route-v3': 'per-shot-visual-direction-review-v3',
  }[sceneRoutingContract];
  const expectedCatalogVersion = sceneRoutingContract === 'explicit-visual-generation-route-v1'
    ? 'visual-generation-route-catalog-v1'
    : 'visual-generation-route-catalog-v2';
  const visualDirectionStatusIsValid = visualDirectionReview?.status === 'approved'
    || (visualDirectionReview?.status === 'policy_authorized'
      && plan?.qa_contract?.workflow_approval?.result === 'pass'
      && plan.qa_contract.workflow_approval.approval_mode === 'one_click');
  if (visualDirectionReview?.result !== 'pass'
    || !visualDirectionStatusIsValid
    || visualDirectionReview?.contract_version !== expectedDirectionContract
    || visualDirectionReview?.catalog_version !== expectedCatalogVersion
    || !SHA256.test(visualDirectionReview?.catalog_checksum_sha256 ?? '')
    || !SHA256.test(visualDirectionReview?.presented_map_sha256 ?? '')
    || !SHA256.test(visualDirectionReview?.checksum_sha256 ?? '')
    || typeof visualDirectionReview?.path !== 'string'
    || visualDirectionReview.path.trim() === ''
    || visualDirectionReview?.generated_shot_count !== plan.scenes.length) {
    throw new Error('assembly plan lacks a passing per-shot visual direction review');
  }
  const visualDirectionArtifactPolicy = plan?.qa_contract?.visual_direction_artifact_policy;
  const modifiedShotIds = visualDirectionArtifactPolicy?.modified_shot_ids;
  if (!Array.isArray(modifiedShotIds)) {
    throw new Error('assembly plan lacks visual direction artifact policy evidence');
  }
  let ianLayeredSceneValidation = null;
  if (sceneRoutingContract === 'explicit-visual-generation-route-v3') {
    if (plan.schema_version !== 'knowledge-video-assembly-plan-v3'
      || visualDirectionArtifactPolicy?.result !== 'pass'
      || visualDirectionArtifactPolicy?.artifact_mode !== 'current_v3'
      || visualDirectionArtifactPolicy?.contract_version !== 'per-shot-visual-direction-review-v3') {
      throw new Error('new or modified assembly requires current_v3 visual direction evidence');
    }
    if (plan?.qa_contract?.storyboard_visual_rhythm?.result !== 'pass'
      || !['storyboard-visual-rhythm-v1', 'storyboard-visual-rhythm-v2'].includes(
        plan.qa_contract.storyboard_visual_rhythm?.contract_version,
      )) {
      throw new Error('v3 assembly lacks approved storyboard visual rhythm evidence');
    }
    if (plan.qa_contract.storyboard_visual_rhythm.contract_version === 'storyboard-visual-rhythm-v2'
      && (plan.qa_contract.workflow_approval?.result !== 'pass'
        || !['manual', 'one_click'].includes(plan.qa_contract.workflow_approval?.approval_mode))) {
      throw new Error('v2 rhythm assembly lacks valid workflow approval selection evidence');
    }
    if (plan?.qa_contract?.intra_shot_transition_contract !== INTRA_SHOT_TRANSITION_VERSION
      || !/IntraShotImageSequence/.test(source)) {
      throw new Error('v3 assembly is not bound to the generic intra-shot transition renderer');
    }
    ianLayeredSceneValidation = validateIanLayeredSceneCoverage({
      evidence: plan?.qa_contract?.ian_layered_scene_packages,
      scenes: plan.scenes,
    });
    if (/FullFrameMaskSweep|full-frame-mask-sweep/.test(source)) {
      throw new Error('Ian renderer still consumes forbidden full-frame mask sweep code');
    }
  } else if (plan.schema_version !== 'knowledge-video-assembly-plan-v2'
    || visualDirectionArtifactPolicy?.result !== 'pass'
    || visualDirectionArtifactPolicy?.artifact_mode !== 'legacy_read_only'
    || visualDirectionArtifactPolicy?.contract_version !== expectedDirectionContract
    || modifiedShotIds.length !== 0) {
    throw new Error('v1/v2 assembly evidence must be unchanged legacy read-only');
  }
  if (sceneRoutingContract === 'explicit-visual-generation-route-v3'
    && /\b(?:TopTitle|topTitle|top_title|topTitleOverlay|top_title_overlay)\b/.test(source)) {
    throw new Error('composition must not create a generic top-title timeline overlay');
  }

  for (const scene of plan.scenes) {
    const isIan = scene.visual_generation_route === 'ian-handdrawn-ppt';
    const isInk = scene.visual_generation_route === 'ink-doodle-knowledge-card';
    const isDoodle = scene.visual_generation_route === 'doodle-slides';
    const isImagegen = scene.visual_generation_route === 'imagegen';
    const isXuan = scene.visual_generation_route === 'xuan-paper-diorama';
    const isComic = scene.visual_generation_route === 'comic-imagegen';
    const isWhiteboard = scene.visual_generation_route === 'srt-whiteboard-animation';
    const isLocalVideo = scene.visual_generation_route === 'local-video-file';
    if (![isIan, isInk, isDoodle, isImagegen, isXuan, isComic, isWhiteboard, isLocalVideo].some(Boolean)) {
      throw new Error(`unknown visual generation route: ${scene.shot_id}`);
    }
    if (isComic || isDoodle) {
      throw new Error(`${scene.visual_generation_route} is legacy read-only and cannot enter preview, render, or assembly: ${scene.shot_id}`);
    }
    if (typeof scene.white_cat_present !== 'boolean') {
      throw new Error(`scene lacks explicit white-cat selection: ${scene.shot_id}`);
    }
    if (scene.white_cat_present && !isImagegen && !isXuan) {
      throw new Error(`white-cat scene must use imagegen or xuan-paper-diorama: ${scene.shot_id}`);
    }
    if (sceneRoutingContract === 'explicit-visual-generation-route-v3') {
      const routeTextPolicy = resolveRouteVisibleTextPolicy({
        visual_generation_route: scene.visual_generation_route,
        white_cat_present: scene.white_cat_present,
      });
      if (!['none', 'required'].includes(scene.visible_text_mode)) {
        throw new Error(`scene lacks a final route-resolved visible-text mode: ${scene.shot_id}`);
      }
      if (scene.visible_text_mode === 'none'
        && (scene.exact_visible_text !== null || scene.visible_text_placement !== null)) {
        throw new Error(`visible text none requires null exact copy and placement: ${scene.shot_id}`);
      }
      if (scene.visible_text_mode === 'required'
        && (typeof scene.exact_visible_text !== 'string' || scene.exact_visible_text.trim() === ''
          || typeof scene.visible_text_placement !== 'string' || scene.visible_text_placement.trim() === '')) {
        throw new Error(`visible text required lacks exact copy or placement: ${scene.shot_id}`);
      }
      if (routeTextPolicy.visible_text_policy === 'text-free-v1' && scene.visible_text_mode !== 'none') {
        throw new Error(`text-free route cannot carry visible text or a top title: ${scene.shot_id}`);
      }
      if (scene.visible_text_policy !== routeTextPolicy.visible_text_policy
        || scene.assembly_text_policy !== routeTextPolicy.assembly_text_policy
        || !Array.isArray(scene.timeline_text_overlays)
        || scene.timeline_text_overlays.length !== 0) {
        throw new Error(`scene text policy is stale or permits a timeline overlay: ${scene.shot_id}`);
      }
      if (scene.intra_shot_transition_contract !== INTRA_SHOT_TRANSITION_VERSION) {
        throw new Error(`scene lacks the active v3 intra-shot transition contract: ${scene.shot_id}`);
      }
      const images = scene.image_sequence ?? [];
      const transitions = scene.intra_shot_transitions ?? [];
      if (!Array.isArray(images) || !Array.isArray(transitions)) {
        throw new Error(`scene image sequence or intra-shot transition map is invalid: ${scene.shot_id}`);
      }
      if (images.length === 0) {
        if (!isWhiteboard && !isLocalVideo) {
          throw new Error(`raster scene has no approved image occurrence: ${scene.shot_id}`);
        }
        if (transitions.length !== 0) {
          throw new Error(`non-raster scene carries intra-shot transitions: ${scene.shot_id}`);
        }
      } else {
        validateIntraShotTransitionSequence({imageSequence: images, transitions, fps});
      }
      if (!['layered', 'stateful', 'hero_pose'].includes(scene.motion_tier)) {
        throw new Error(`scene lacks a locked v3 motion tier: ${scene.shot_id}`);
      }
      if (isIan) {
        const layered = scene.ian_layered_scene;
        if (scene.internal_motion_contract != null || scene.internal_motion != null) {
          throw new Error(`Ian whole-raster motion is retired: ${scene.shot_id}`);
        }
        if (scene.scene_type !== 'ian-layered'
          || ![IAN_LAYERED_SCENE_RENDERER_VERSION, IAN_LAYERED_ENTRY_RENDERER_VERSION]
            .includes(layered?.contract_version)
          || !Array.isArray(layered.layers)
          || layered.layers.length < 1
          || images.length !== 1
          || images[0].from !== 0
          || images[0].duration_in_frames !== scene.duration_frames
          || layered.final_composite?.asset !== images[0].asset
          || layered.final_composite?.checksum_sha256 !== images[0].checksum_sha256) {
          throw new Error(`Ian scene lacks its static layered package: ${scene.shot_id}`);
        }
      }
      if (!isIan && scene.ian_layered_scene != null) {
        throw new Error(`non-Ian scene carries an Ian layered-scene package: ${scene.shot_id}`);
      }
      if (!isWhiteboard && !isLocalVideo && scene.motion_tier === 'layered' && images.length !== 1) {
        throw new Error(`layered scene must carry one master raster: ${scene.shot_id}`);
      }
      const rich = scene.density_mode === 'rich';
      const rhythmV2 = plan.qa_contract.storyboard_visual_rhythm?.contract_version
        === 'storyboard-visual-rhythm-v2';
      if (rhythmV2 && !['standard', 'rich'].includes(scene.density_mode)) {
        throw new Error(`v2 rhythm scene lacks a valid density binding: ${scene.shot_id}`);
      }
      const statefulMaximum = rich ? 6 : 4;
      if (scene.motion_tier === 'stateful' && (images.length < 2 || images.length > statefulMaximum)) {
        throw new Error(`stateful scene must carry 2–${statefulMaximum} complete rasters: ${scene.shot_id}`);
      }
      if (scene.motion_tier === 'hero_pose') {
        const poseMaximum = rich ? 13 : 6;
        if (images.length < 4 || images.length > poseMaximum
          || !scene.hero_pose_background?.asset
          || !SHA256.test(scene.hero_pose_background?.checksum_sha256 ?? '')
          || !/backgroundSrc/.test(source)) {
          throw new Error(`hero_pose scene lacks its locked background and 4–${poseMaximum} poses: ${scene.shot_id}`);
        }
      }
      if (['stateful', 'hero_pose'].includes(scene.motion_tier)) {
        const expectedScheduleVersion = rhythmV2
          ? ACTION_STATE_SCHEDULE_V4_VERSION
          : ACTION_STATE_SCHEDULE_V3_VERSION;
        if (scene.action_state_schedule?.contract_version !== expectedScheduleVersion) {
          throw new Error(`stateful or hero scene lacks ${expectedScheduleVersion}: ${scene.shot_id}`);
        }
        validateActionStateSchedule(scene.action_state_schedule, {
          totalFrames: scene.duration_frames,
          fps,
          densityMode: rhythmV2 ? scene.density_mode : null,
          densitySelectionSha256: rhythmV2 ? scene.visual_density_selection_sha256 : null,
        });
        const occurrenceAssetBindings = scene.action_state_schedule.occurrence_asset_bindings;
        let assetIdByState = null;
        if (occurrenceAssetBindings !== undefined) {
          if (!Array.isArray(occurrenceAssetBindings)
            || occurrenceAssetBindings.length !== scene.action_state_schedule.occurrences.length) {
            throw new Error(`occurrence asset bindings are incomplete: ${scene.shot_id}`);
          }
          assetIdByState = new Map();
          const boundAssetIds = new Set();
          occurrenceAssetBindings.forEach((binding, index) => {
            const occurrence = scene.action_state_schedule.occurrences[index];
            if (binding?.state_id !== occurrence.state_id
              || binding?.state_index !== occurrence.state_index
              || binding?.at_frame !== occurrence.at_frame
              || binding?.duration_in_frames !== occurrence.duration_in_frames
              || typeof binding?.asset_id !== 'string' || binding.asset_id.trim() === ''
              || assetIdByState.has(binding.state_id)
              || boundAssetIds.has(binding.asset_id)) {
              throw new Error(`occurrence asset bindings are stale or ambiguous: ${scene.shot_id}`);
            }
            assetIdByState.set(binding.state_id, binding.asset_id);
            boundAssetIds.add(binding.asset_id);
          });
        }
        const scheduledTransitions = scene.action_state_schedule.intra_shot_transitions
          .map((transition) => ({
            ...transition,
            from_asset_id: assetIdByState?.get(transition.from_asset_id)
              ?? transition.from_asset_id,
            to_asset_id: assetIdByState?.get(transition.to_asset_id) ?? transition.to_asset_id,
          }));
        if (scene.action_state_schedule.occurrences.length !== images.length
          || scene.action_state_schedule.occurrences.some((occurrence, index) => (
            (assetIdByState?.get(occurrence.state_id) ?? occurrence.state_id)
              !== images[index].asset_id
            || occurrence.at_frame !== images[index].from
            || occurrence.duration_in_frames !== images[index].duration_in_frames
          ))
          || JSON.stringify(scheduledTransitions) !== JSON.stringify(transitions)) {
          throw new Error(`action-state schedule differs from rendered assets or effects: ${scene.shot_id}`);
        }
      }
    }
    if (isWhiteboard && (scene.white_cat_present || scene.scene_type !== 'whiteboard')) {
      throw new Error(`whiteboard route requires a no-cat whiteboard scene: ${scene.shot_id}`);
    }
    if (scene.scene_type === 'whiteboard' && !isWhiteboard) {
      throw new Error(`whiteboard scene lacks the whiteboard generation marker: ${scene.shot_id}`);
    }
    if (isLocalVideo) {
      const localVideo = scene.local_video;
      if (scene.white_cat_present || scene.scene_type !== 'local-video'
        || localVideo?.contract_version !== 'local-video-match-v1'
        || localVideo?.match_status !== 'matched'
        || localVideo?.target_duration_frames !== scene.duration_frames
        || localVideo?.media?.width !== 1920 || localVideo?.media?.height !== 1080
        || localVideo?.media?.codec !== 'h264'
        || localVideo?.media?.probe_result !== 'pass'
        || localVideo?.media?.full_decode_result !== 'pass') {
        throw new Error(`local-video scene lacks approved exact-frame media evidence: ${scene.shot_id}`);
      }
    } else if (scene.scene_type === 'local-video') {
      throw new Error(`local-video scene lacks the local-video-file marker: ${scene.shot_id}`);
    }
    if (isWhiteboard) {
      const whiteboard = scene.whiteboard;
      const media = whiteboard?.render_evidence?.media;
      if (whiteboard?.contract_version !== 'whiteboard-scene-v1'
        || whiteboard?.clip?.asset?.toLowerCase().endsWith('.mp4') !== true
        || !SHA256.test(whiteboard?.clip?.checksum_sha256 ?? '')
        || whiteboard?.render_evidence?.contract_version !== 'whiteboard-render-evidence-v1'
        || media?.width !== 1920 || media?.height !== 1080 || media?.fps !== 30
        || media?.codec !== 'h264' || media?.audio_streams !== 0
        || media?.frame_count !== whiteboard?.source_duration_frames
        || media?.final_frame_verified !== true
        || media?.full_frame_hold_verified_frames < 15
        || whiteboard?.visual_sequence_lock?.clip_sha256 !== whiteboard?.clip?.checksum_sha256) {
        throw new Error(`whiteboard scene lacks approved media and sequence-lock evidence: ${scene.shot_id}`);
      }
      if (!Array.isArray(whiteboard.timing_segments) || whiteboard.timing_segments.length === 0) {
        throw new Error(`whiteboard scene lacks timing segments: ${scene.shot_id}`);
      }
      let sourceFrame = 0;
      let outputFrame = 0;
      for (const segment of whiteboard.timing_segments) {
        if (segment.source_start_frame !== sourceFrame || segment.output_start_frame !== outputFrame
          || segment.source_end_frame <= sourceFrame || segment.output_end_frame <= outputFrame
          || segment.playback_rate !== (segment.source_end_frame - sourceFrame)
            / (segment.output_end_frame - outputFrame)) {
          throw new Error(`whiteboard timing segments are stale or non-consecutive: ${scene.shot_id}`);
        }
        sourceFrame = segment.source_end_frame;
        outputFrame = segment.output_end_frame;
      }
      if (sourceFrame !== whiteboard.source_duration_frames || outputFrame !== scene.duration_frames) {
        throw new Error(`whiteboard timing segments do not cover the scene: ${scene.shot_id}`);
      }
    }
    if (isIan && scene.scene_type !== 'ian-layered') {
      throw new Error(`Ian scene is not routed to IanLayeredScene: ${scene.shot_id}`);
    }
    if (isInk && scene.scene_type !== 'graphic') {
      throw new Error(`Ink structured raster is not routed to GraphicScene: ${scene.shot_id}`);
    }
    if (scene.scene_type === 'graphic' && !isInk) {
      throw new Error(`graphic scene lacks an active structured generation marker: ${scene.shot_id}`);
    }
    if (scene.scene_type === 'ian-layered' && !isIan) {
      throw new Error(`Ian layered scene lacks the Ian generation marker: ${scene.shot_id}`);
    }
    if ((isImagegen || isXuan) && !['narrative', 'gen-think'].includes(scene.scene_type)) {
      throw new Error(`imagegen raster is not routed to narrative: ${scene.shot_id}`);
    }
    if (isComic) {
      const watercolorTransitionsValid = Array.isArray(scene.intra_shot_transitions)
        && scene.intra_shot_transitions.every((transition, index) => {
          try {
            validateIntraShotWatercolorTransition(transition, {
              fps,
              fromImageIndex: index,
              toImageIndex: index + 1,
            });
            return true;
          } catch {
            return false;
          }
        });
      if (!['explicit-visual-generation-route-v2', 'explicit-visual-generation-route-v3'].includes(sceneRoutingContract)
        || scene.scene_type !== 'comic'
        || scene.scene_class !== 'narrative_illustration'
        || scene.comic_plan?.contract_version !== 'comic-shot-plan-v1'
        || !Array.isArray(scene.image_sequence)
        || scene.image_sequence.length < 1
        || scene.image_sequence.some((image) => image.visual_generation_route !== 'comic-imagegen'
          || image.asset?.toLowerCase().endsWith('.png') !== true
          || image.width !== 1920 || image.height !== 1080
          || image.review_status !== 'approved'
          || image.generator !== 'codex-native-imagegen')
        || scene.image_sequence.at(-1).duration_in_frames < 15
        || !Array.isArray(scene.intra_shot_transitions)
        || scene.intra_shot_transitions.length !== scene.image_sequence.length - 1
        || !watercolorTransitionsValid) {
        throw new Error(`comic scene lacks approved whole-PNG and watercolor-state evidence: ${scene.shot_id}`);
      }
    } else if (scene.scene_type === 'comic') {
      throw new Error(`comic scene lacks comic-imagegen generation marker: ${scene.shot_id}`);
    }
  }

  let animatedTransitionCount = 0;
  let cutCount = 0;
  const strictRevoiceTransitionLock = plan?.qa_contract?.revoice_transition_lock
    === 'strict-parent-transition-v1';
  for (let index = 0; index < plan.scenes.length - 1; index += 1) {
    const scene = plan.scenes[index];
    const next = plan.scenes[index + 1];
    if (scene.end_frame !== next.start_frame) throw new Error(`scene boundary is not contiguous: ${scene.shot_id}→${next.shot_id}`);
    const transition = scene.transition;
    if (!transition) throw new Error(`missing structured transition: ${scene.shot_id}→${next.shot_id}`);
    if (transition.contract_version !== transitionContract) throw new Error(`wrong transition contract: ${scene.shot_id}`);
    if (['scene-transition-v2', 'scene-transition-v3'].includes(transitionContract)) {
      if (transitionContract === 'scene-transition-v3'
        && (transition.source_visual_generation_route !== scene.visual_generation_route
          || transition.next_visual_generation_route !== next.visual_generation_route)) {
        throw new Error(`transition recommendation routes do not match adjacent scenes: ${scene.shot_id}`);
      }
      validateUserApprovedTransition(transition, {
        fps,
        sourceShotId: scene.shot_id,
        nextShotId: next.shot_id,
      });
      if (strictRevoiceTransitionLock) {
        validateRevoiceTransitionLock(scene.revoice_parent_transition, transition, {
          fps,
          sourceShotId: scene.shot_id,
          nextShotId: next.shot_id,
          shotDurationFrames: Number.isInteger(scene.duration_frames)
            ? scene.duration_frames
            : scene.end_frame - scene.start_frame,
        });
      }
      if (transition.user_selection.presented_map_sha256
        !== transitionSelectionReview.presented_map_sha256) {
        throw new Error(`transition review checksum mismatch: ${scene.shot_id}`);
      }
    } else if (!LEGACY_ALLOWED_KINDS.has(transition.kind)) {
      throw new Error(`unsupported transition kind: ${transition.kind}`);
    }
    if (typeof transition.source_intent !== 'string' || transition.source_intent !== scene.transition_intent) {
      throw new Error(`transition intent binding mismatch: ${scene.shot_id}`);
    }
    if (transition.kind === 'cut') {
      if (transition.duration_seconds !== 0 || transition.duration_in_frames !== 0) {
        throw new Error(`cut transition must have zero duration: ${scene.shot_id}`);
      }
      cutCount += 1;
    } else {
      if (transition.duration_seconds < 0.3 || transition.duration_seconds > 0.6) {
        throw new Error(`transition duration out of range: ${scene.shot_id}`);
      }
      animatedTransitionCount += 1;
    }
    if (transition.duration_in_frames !== Math.round(transition.duration_seconds * fps)) throw new Error(`transition frame mismatch: ${scene.shot_id}`);
  }
  if (transitionContract === 'scene-transition-v3'
    && (plan.qa_contract.ordinary_boundaries_with_animated_transitions !== animatedTransitionCount
      || plan.qa_contract.ordinary_boundaries_with_cuts !== cutCount
      || animatedTransitionCount + cutCount !== ordinaryBoundaryCount)) {
    throw new Error('assembly plan semantic transition counts are stale');
  }
  if (plan.scenes.at(-1).transition !== null) throw new Error('terminal scene must not have an outgoing transition');
  if (strictRevoiceTransitionLock && plan.scenes.at(-1).revoice_parent_transition !== null) {
    throw new Error('revoice terminal transition lock must remain null');
  }

  if (!/import\s*\{[\s\S]*?TransitionedScene[\s\S]*?\}\s*from\s*['"][^'"]*(?:shared\/|\.\.\/)scene-transitions['"]/.test(source)) {
    throw new Error('composition does not import the shared TransitionedScene renderer');
  }
  if (!/<TransitionedScene\b/.test(source) || !/<\/TransitionedScene>/.test(source)) {
    throw new Error('composition does not consume TransitionedScene');
  }
  if (!/transition=\{scene\.transition\}/.test(source)) throw new Error('composition does not bind structured scene.transition');
  if (!/isTerminal=\{sceneIndex === (?:plan\.)?scenes\.length - 1\}/.test(source)) {
    throw new Error('composition does not bind the terminal-scene exception narrowly');
  }
  if (!/visualGenerationRoute=\{scene\.visual_generation_route \?\? ''\}/.test(source)
    && !/visualGenerationRoute=\{scene\.visual_generation_route\}/.test(source)) {
    throw new Error('composition does not bind visual generation routes to scene renderers');
  }
  if (plan.scenes.some((scene) => scene.visual_generation_route === 'ink-doodle-knowledge-card')
    && !/<GraphicScene\b/.test(source)) {
    throw new Error('composition does not register the shared GraphicScene renderer');
  }
  if (plan.scenes.some((scene) => scene.visual_generation_route === IAN_ROUTE)
    && (!/<IanLayeredScene\b/.test(source)
      || !/scene=\{scene\.ian_layered_scene!\}/.test(source)
      || !/<CanvasImage\b/.test(source)
      || !/useCurrentFrame/.test(source)
      || !/interpolate/.test(source)
      || !/layer\.entry_frame/.test(source)
      || !/opacity/.test(source)
      || /validateIanSceneMotion|translate3d/.test(source))) {
    throw new Error('composition does not consume the Ian layered-scene renderer');
  }
  if (plan.scenes.some((scene) => scene.ian_layered_scene?.contract_version
      === IAN_LAYERED_ENTRY_RENDERER_VERSION)
    && (!/<Audio\b/.test(source)
      || !/gain_multiplier/.test(source)
      || !/softSettleOffset/.test(source)
      || !/strokeDasharray/.test(source)
      || !/strokeDashoffset/.test(source)
      || !/<mask\b/.test(source)
      || /const AnimatedLayer[\s\S]*?(?:Math\.random|scale\(|rotate\()[\s\S]*?export const IanLayeredScene/.test(source))) {
    throw new Error('composition does not consume the approved Ian entry motion and SFX renderer');
  }
  if (plan.scenes.some((scene) => scene.visual_generation_route === 'comic-imagegen')) {
    if (!/<ComicScene\b/.test(source)
      || !/visualGenerationRoute=\{scene\.visual_generation_route\}/.test(source)
      || !/comicPlan=\{scene\.comic_plan!\}/.test(source)) {
      throw new Error('composition does not consume approved comic PNGs through ComicScene');
    }
  }
  if (plan.scenes.some((scene) => scene.visual_generation_route === 'srt-whiteboard-animation')) {
    if (!/<WhiteboardScene\b/.test(source)
      || !/<OffthreadVideo\b/.test(source)
      || !/trimBefore=\{segment\.source_start_frame\}/.test(source)
      || !/playbackRate=\{segment\.playback_rate\}/.test(source)
      || !/\bmuted\b/.test(source)) {
      throw new Error('composition does not consume approved whiteboard MP4 through WhiteboardScene');
    }
  }

  return {
    contract_version: transitionContract,
    ordinary_boundary_count: plan.scenes.length - 1,
    animated_transition_count: transitionContract === 'scene-transition-v3'
      ? animatedTransitionCount
      : ordinaryBoundaryCount,
    ...(transitionContract === 'scene-transition-v3' ? {cut_count: cutCount} : {}),
    source_binding: 'pass',
    scene_routing: 'pass_explicit_visual_generation_routes',
    whiteboard_scene_count: plan.scenes.filter(
      (scene) => scene.visual_generation_route === 'srt-whiteboard-animation',
    ).length,
    comic_scene_count: plan.scenes.filter(
      (scene) => scene.visual_generation_route === 'comic-imagegen',
    ).length,
    ian_layered_scene_contract: sceneRoutingContract === 'explicit-visual-generation-route-v3'
      ? ianLayeredSceneValidation.contract_version
      : null,
    opening_contract_version: 'direct-first-shot-v1',
    opening_hard_cut_exceptions: openingExceptions,
  };
};

const main = () => {
  const [planArg, sourceArg] = process.argv.slice(2);
  if (!planArg || !sourceArg) throw new Error('usage: validate-scene-transitions.mjs <assembly-plan.json> <composition-source.tsx>');
  const planPath = path.resolve(planArg);
  const sourcePath = path.resolve(sourceArg);
  const result = validateSceneTransitions({
    plan: JSON.parse(fs.readFileSync(planPath, 'utf8')),
    source: fs.readFileSync(sourcePath, 'utf8'),
  });
  console.log(JSON.stringify({
    result: 'pass',
    plan: path.relative(process.cwd(), planPath),
    source: path.relative(process.cwd(), sourcePath),
    ...result,
  }, null, 2));
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
