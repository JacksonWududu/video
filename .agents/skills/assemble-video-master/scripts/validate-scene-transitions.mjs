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
import {resolveRouteVisibleTextPolicy} from '../../../../leverage-video/src/shared/visual-generation-routes/contract.mjs';

const LEGACY_ALLOWED_KINDS = new Set(TRANSITION_KINDS);
const COVER_SOURCE = '/Users/jackson/Desktop/video-edit/video-resource/cover.png';
const SHA256 = /^[a-f0-9]{64}$/;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(HERE, '../../../..');

const expandSharedRendererSource = (source) => {
  if (!/shared\/video-scenes/.test(source) || !/KnowledgeVideo/.test(source)) return source;
  return [
    source,
    fs.readFileSync(path.join(REPOSITORY_ROOT, 'leverage-video/src/shared/video-scenes/KnowledgeVideo.tsx'), 'utf8'),
    fs.readFileSync(path.join(REPOSITORY_ROOT, 'leverage-video/src/shared/video-scenes/EpisodeOpening.tsx'), 'utf8'),
    fs.readFileSync(path.join(REPOSITORY_ROOT, 'leverage-video/src/shared/video-scenes/ComicScene.tsx'), 'utf8'),
    fs.readFileSync(path.join(REPOSITORY_ROOT, 'leverage-video/src/shared/video-scenes/GraphicScene.tsx'), 'utf8'),
    fs.readFileSync(path.join(REPOSITORY_ROOT, 'leverage-video/src/shared/video-scenes/DoodleScene.tsx'), 'utf8'),
    fs.readFileSync(path.join(REPOSITORY_ROOT, 'leverage-video/src/shared/video-scenes/WhiteboardScene.tsx'), 'utf8'),
  ].join('\n');
};

const validateCoverOnlyOpening = ({plan, source}) => {
  const opening = plan?.opening;
  if (opening?.contract_version !== 'cover-only-v1') throw new Error('assembly plan does not declare cover-only-v1');
  if (opening?.shot_id !== 'OPEN-00') throw new Error('cover-only opening must use OPEN-00');
  if (opening?.cover_source !== COVER_SOURCE) throw new Error('cover-only opening uses the wrong shared source');
  if (opening?.source_is_regular_file !== true || opening?.source_is_symlink !== false) {
    throw new Error('cover-only opening source type evidence is invalid');
  }
  if (opening?.source_format !== 'png' || opening?.source_decode_result !== 'pass') {
    throw new Error('cover-only opening PNG decode evidence is invalid');
  }
  if (typeof opening?.source_aspect_ratio_relative_error !== 'number'
    || opening.source_aspect_ratio_relative_error < 0
    || opening.source_aspect_ratio_relative_error > 0.005) {
    throw new Error('cover-only opening source aspect ratio is outside tolerance');
  }
  if (opening?.normalized_width !== 1920 || opening?.normalized_height !== 1080) {
    throw new Error('cover-only opening normalized raster is not 1920x1080');
  }
  if (opening?.text_overlay !== false) throw new Error('cover-only opening must not add a text overlay');
  if (opening?.start_frame !== 0 || opening?.narration_start_frame !== 0) {
    throw new Error('cover-only opening and narration must start at frame zero');
  }
  if (!Number.isInteger(opening?.first_sentence_end_frame) || opening.first_sentence_end_frame <= 0) {
    throw new Error('cover-only opening has invalid first_sentence_end_frame');
  }
  if (opening?.episode_opening_frames !== opening.first_sentence_end_frame) {
    throw new Error('cover-only opening duration must equal first_sentence_end_frame');
  }
  if (opening?.final_master_frames !== opening?.narration_master_frames) {
    throw new Error('cover-only final master must have no opening frame offset');
  }

  const firstShotId = plan.scenes[0].shot_id;
  if (firstShotId !== 'S01') throw new Error('cover-only first content shot must be S01');
  const exceptions = [`OPEN-00→${firstShotId}`];
  if (plan.scenes[0].start_frame !== opening.first_sentence_end_frame) {
    throw new Error('first content shot does not begin at the cover-only hard cut');
  }
  if (JSON.stringify(plan?.qa_contract?.opening_hard_cut_exceptions) !== JSON.stringify(exceptions)) {
    throw new Error('opening hard-cut exceptions are missing or overbroad');
  }

  if (!/cover-only-v1/.test(source) || !/<EpisodeOpening\b/.test(source)) {
    throw new Error('composition does not consume the cover-only EpisodeOpening');
  }
  if (!/coverSource=\{opening\.cover_source\}/.test(source)
    && !/coverAsset=\{plan\.opening\.cover_asset\}/.test(source)) {
    throw new Error('composition does not bind opening.cover_source');
  }
  if (!/durationInFrames=\{opening\.first_sentence_end_frame\}/.test(source)
    && !/durationInFrames=\{plan\.opening\.first_sentence_end_frame\}/.test(source)) {
    throw new Error('composition does not bind the cover hold to first_sentence_end_frame');
  }
  if (!/narrationStartFrame=\{0\}/.test(source) && !/from=\{0\}/.test(source)) {
    throw new Error('composition does not bind narration to frame zero');
  }
  if (/titleCard|topicCard|OPEN-01/.test(source)) {
    throw new Error('composition retains a retired second opening stage');
  }

  return exceptions;
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
  if (['scene-transition-v2', 'scene-transition-v3'].includes(transitionContract)
    && (transitionSelectionReview?.status !== 'approved'
      || transitionSelectionReview?.catalog_version !== expectedTransitionCatalog
      || typeof transitionSelectionReview?.path !== 'string'
      || transitionSelectionReview.path.trim() === ''
      || !SHA256.test(transitionSelectionReview?.checksum_sha256 ?? '')
      || !SHA256.test(transitionSelectionReview?.presented_map_sha256 ?? '')
      || transitionSelectionReview?.ordinary_boundary_count !== plan.scenes.length - 1)) {
    throw new Error('assembly plan lacks a passing transition selection review');
  }
  const openingExceptions = validateCoverOnlyOpening({plan, source});
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
  if (visualDirectionReview?.result !== 'pass'
    || visualDirectionReview?.status !== 'approved'
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
  if (sceneRoutingContract === 'explicit-visual-generation-route-v3') {
    if (visualDirectionArtifactPolicy?.result !== 'pass'
      || visualDirectionArtifactPolicy?.artifact_mode !== 'current_v3'
      || visualDirectionArtifactPolicy?.contract_version !== 'per-shot-visual-direction-review-v3') {
      throw new Error('new or modified assembly requires current_v3 visual direction evidence');
    }
  } else if (visualDirectionArtifactPolicy?.result !== 'pass'
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
    if (![isIan, isInk, isDoodle, isImagegen, isXuan, isComic, isWhiteboard].some(Boolean)) {
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
    }
    if (isWhiteboard && (scene.white_cat_present || scene.scene_type !== 'whiteboard')) {
      throw new Error(`whiteboard route requires a no-cat whiteboard scene: ${scene.shot_id}`);
    }
    if (scene.scene_type === 'whiteboard' && !isWhiteboard) {
      throw new Error(`whiteboard scene lacks the whiteboard generation marker: ${scene.shot_id}`);
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
    if ((isIan || isInk) && scene.scene_type !== 'graphic') {
      throw new Error(`structured raster is not routed to graphic: ${scene.shot_id}`);
    }
    if (scene.scene_type === 'graphic' && !isIan && !isInk) {
      throw new Error(`graphic scene lacks an active structured generation marker: ${scene.shot_id}`);
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
  if (plan.scenes.some((scene) => ['ian-handdrawn-ppt', 'ink-doodle-knowledge-card']
    .includes(scene.visual_generation_route)) && !/<GraphicScene\b/.test(source)) {
    throw new Error('composition does not register the shared GraphicScene renderer');
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
    opening_contract_version: 'cover-only-v1',
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
