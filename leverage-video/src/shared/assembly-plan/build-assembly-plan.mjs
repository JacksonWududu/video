import {FLIPBOOK_STYLE_ID, FLIPBOOK_RENDERER, FLIPBOOK_TRANSITION_KIND, isFlipbookRow, isFlipbookStyle} from '../flipbook-video/profile.mjs';
import {validateStaticSpread} from '../storyboard/static-spread.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  validateRevoiceTransitionLock,
  validateUserApprovedTransition,
} from '../scene-transitions/contract.mjs';
import {
  ACTION_STATE_SCHEDULE_V3_VERSION,
  ACTION_STATE_SCHEDULE_V4_VERSION,
  buildActionStatePlanSha256,
  calculateActionStateCadenceAdvisory,
  validateActionStateSchedule,
} from '../action-state-schedule/contract.mjs';
import {
  INTRA_SHOT_TRANSITION_VERSION,
  validateIntraShotTransitionSequence,
} from '../intra-shot-transitions/contract.mjs';
import {
  atomicWriteJson,
  readJson,
  sha256File,
} from '../episode-tooling/file-integrity.mjs';
import {validateReuseDecision} from '../reuse-registry/validate-reuse-decision.mjs';
import {validateVisualLanguageSelection} from '../visual-language/contract.mjs';
import {
  CATALOG as VISUAL_ROUTE_CATALOG,
  INK_DOODLE_KNOWLEDGE_CARD_ROUTE_ID,
  XUAN_PAPER_DIORAMA_ROUTE_ID,
  resolveRouteVisibleTextPolicy,
  validateVisualDirectionArtifactPolicy,
  validateVisualDirectionReview,
} from '../visual-generation-routes/contract.mjs';
import {
  INTRA_SHOT_WATERCOLOR_BLOOM_KIND,
  INTRA_SHOT_WATERCOLOR_BLOOM_RENDERER,
  INTRA_SHOT_WATERCOLOR_BLOOM_RULE_ID,
  INTRA_SHOT_WATERCOLOR_BLOOM_SECONDS,
  getIntraShotWatercolorBloomDurationInFrames,
} from '../watercolor-bloom/contract.mjs';
import {
  LOCAL_VIDEO_ROUTE_ID,
  validateLocalVideoMatchBinding,
} from '../local-video-match/contract.mjs';
import {validateStoryboardVisualRhythm} from '../storyboard-visual-rhythm/contract.mjs';
import {
  assertOneClickProtectedActionAllowed,
  validateLegacyStylelessApprovalSelectionSequence,
  validateApprovalSelectionSequence,
} from '../workflow-approval/contract.mjs';
import {
  IAN_LAYERED_SCENE_PACKAGE_VERSION,
  IAN_LAYERED_SCENE_RENDERER_VERSION,
  sha256Canonical as sha256IanCanonical,
  validateIanLayeredScenePackage,
  validateIanLayeredSceneRhythmBinding,
} from '../ian-layered-scene/contract.mjs';
import {
  IAN_INK_DRAW_REVEAL_VERSION,
  IAN_LAYERED_ENTRY_RENDERER_VERSION,
  IAN_SOFT_SETTLE_VERSION,
  validateIanLayeredEntryEffectsPlan,
} from '../ian-layered-entry-effects/contract.mjs';
import {loadAndValidateSharedSoundEffectLibrary} from '../sound-effects/contract.mjs';
import {
  KNOWLEDGE_VIDEO_SOUND_DESIGN_POLICY_BINDING,
  loadAndValidateKnowledgeVideoSoundDesign,
} from '../sound-effects/sound-design.mjs';
import {validateIanStoryboardLayeredSceneSection} from '../storyboard/validate-final-storyboard.mjs';

const SHA256 = /^[a-f0-9]{64}$/;
const WHITEBOARD_ROUTE = 'srt-whiteboard-animation';
const COMIC_ROUTE = 'comic-imagegen';
const IAN_ROUTE = 'ian-handdrawn-ppt';
const XUAN_ROUTE = XUAN_PAPER_DIORAMA_ROUTE_ID;
const INK_DOODLE_ROUTE = INK_DOODLE_KNOWLEDGE_CARD_ROUTE_ID;
const LOCAL_VIDEO_ROUTE = LOCAL_VIDEO_ROUTE_ID;
const STYLE_BACKED_ROUTE_IDS = Object.freeze([XUAN_ROUTE, INK_DOODLE_ROUTE]);
const STYLE_ROUTE_CONFIGS = new Map(STYLE_BACKED_ROUTE_IDS.map((routeId) => [
  routeId,
  VISUAL_ROUTE_CATALOG.routes.find(({route_id: itemRouteId}) => itemRouteId === routeId),
]));
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(HERE, '../../../..');

export const isActiveVisualDirectionArtifactBasename = (basename) => [
  'per-shot-visual-direction-review-v1.json',
  'per-shot-visual-direction-review-v2.json',
  'per-shot-visual-direction-review-v3.json',
].includes(basename)
  || /^per-shot-visual-direction-review-v3-approved-v[1-9][0-9]*\.json$/.test(basename)
  || /^per-shot-visual-direction-review-v3-revision-[0-9]{2,}\.json$/.test(basename);

export const isActiveStoryboardVisualRhythmArtifactBasename = (basename) => [
  'storyboard-visual-rhythm-v1.json',
  'storyboard-visual-rhythm-v2.json',
].includes(basename)
  || /^storyboard-visual-rhythm-v[12]-revision-[0-9]{2,}\.json$/.test(basename);

const requireInteger = (value, label, minimum = 0) => {
  if (!Number.isInteger(value) || value < minimum) throw new Error(`${label} must be an integer >= ${minimum}`);
  return value;
};

const requireSha256 = (value, label) => {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256`);
  }
  return value;
};

const requireAssetReference = (value, label, extension) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} asset reference is required`);
  }
  if (typeof value.asset !== 'string' || value.asset === '') {
    throw new Error(`${label}.asset is required`);
  }
  if (path.extname(value.asset).toLowerCase() !== extension) {
    throw new Error(`${label} must use ${extension}`);
  }
  return {asset: value.asset, checksum_sha256: requireSha256(value.checksum_sha256, `${label}.checksum_sha256`)};
};

const elementOrderSha256 = (elementOrder) => crypto
  .createHash('sha256')
  .update(JSON.stringify(elementOrder))
  .digest('hex');

const validateWhiteboardReview = (shot, whiteboard, references) => {
  const review = whiteboard.review;
  if (review?.contract_version !== 'whiteboard-visual-asset-review-v1') {
    throw new Error(`${shot.shot_id} whiteboard three-stage review is required`);
  }
  const source = review.source_image_review;
  if (source?.status !== 'approved'
    || source.approved_source_image_checksum_sha256 !== references.source_image.checksum_sha256) {
    throw new Error(`${shot.shot_id} whiteboard source image is not approved`);
  }
  const annotation = review.annotation_review;
  if (annotation?.status !== 'approved'
    || annotation.approved_annotation_checksum_sha256 !== references.annotation.checksum_sha256
    || annotation.approved_preview_checksum_sha256 !== references.preview.checksum_sha256) {
    throw new Error(`${shot.shot_id} whiteboard annotation and preview are not approved`);
  }
  const clip = review.clip_review;
  if (clip?.status !== 'approved'
    || clip.approved_clip_checksum_sha256 !== references.clip.checksum_sha256
    || clip.approved_render_evidence_checksum_sha256 !== references.render_evidence.checksum_sha256) {
    throw new Error(`${shot.shot_id} whiteboard clip is not approved`);
  }
};

const validateWhiteboardTimingSegments = (shot, whiteboard, durationFrames) => {
  if (!Array.isArray(whiteboard.timing_segments) || whiteboard.timing_segments.length === 0) {
    throw new Error(`${shot.shot_id} whiteboard timing segments are required`);
  }
  let expectedSource = 0;
  let expectedOutput = 0;
  let previousSpanEnd = 0;
  const segments = whiteboard.timing_segments.map((segment, index) => {
    const sourceStart = requireInteger(segment.source_start_frame, `${shot.shot_id}.whiteboard.timing_segments[${index}].source_start_frame`);
    const sourceEnd = requireInteger(segment.source_end_frame, `${shot.shot_id}.whiteboard.timing_segments[${index}].source_end_frame`, 1);
    const outputStart = requireInteger(segment.output_start_frame, `${shot.shot_id}.whiteboard.timing_segments[${index}].output_start_frame`);
    const outputEnd = requireInteger(segment.output_end_frame, `${shot.shot_id}.whiteboard.timing_segments[${index}].output_end_frame`, 1);
    if (sourceStart !== expectedSource || outputStart !== expectedOutput
      || sourceEnd <= sourceStart || outputEnd <= outputStart) {
      throw new Error(`${shot.shot_id} whiteboard timing segments must be positive and consecutive`);
    }
    if (!Array.isArray(segment.element_ids) || segment.element_ids.length === 0
      || segment.element_ids.some((value) => typeof value !== 'string' || value === '')) {
      throw new Error(`${shot.shot_id} whiteboard timing segment element_ids are required`);
    }
    const span = segment.subtitle_span;
    const spanStart = requireInteger(span?.start, `${shot.shot_id}.whiteboard.timing_segments[${index}].subtitle_span.start`);
    const spanEnd = requireInteger(span?.end, `${shot.shot_id}.whiteboard.timing_segments[${index}].subtitle_span.end`, 1);
    if (spanStart < previousSpanEnd || spanEnd <= spanStart
      || typeof span?.text !== 'string' || span.text === '') {
      throw new Error(`${shot.shot_id} whiteboard timing subtitle spans must be ordered`);
    }
    expectedSource = sourceEnd;
    expectedOutput = outputEnd;
    previousSpanEnd = spanEnd;
    const sourceFrames = sourceEnd - sourceStart;
    const outputFrames = outputEnd - outputStart;
    return {
      source_start_frame: sourceStart,
      source_end_frame: sourceEnd,
      output_start_frame: outputStart,
      output_end_frame: outputEnd,
      playback_rate: sourceFrames / outputFrames,
      element_ids: [...segment.element_ids],
      subtitle_span: {start: spanStart, end: spanEnd, text: span.text},
    };
  });
  if (expectedSource !== whiteboard.source_duration_frames) {
    throw new Error(`${shot.shot_id} whiteboard timing segments must cover the complete approved source clip`);
  }
  if (expectedOutput !== durationFrames) {
    throw new Error(`${shot.shot_id} whiteboard timing segments must cover the complete output shot`);
  }
  if (whiteboard.retiming_mode === 'identity-v1') {
    if (segments.length !== 1 || whiteboard.source_duration_frames !== durationFrames
      || segments[0].playback_rate !== 1) {
      throw new Error(`${shot.shot_id} identity whiteboard timing must preserve every frame`);
    }
  } else if (whiteboard.retiming_mode === 'piecewise-element-span-v1') {
    if (segments.length < 2
      || whiteboard.immutable_parent_clip_checksum_sha256 !== whiteboard.clip.checksum_sha256) {
      throw new Error(`${shot.shot_id} revoice whiteboard timing requires piecewise segments and immutable parent clip bytes`);
    }
  } else {
    throw new Error(`${shot.shot_id} whiteboard retiming_mode is unsupported`);
  }
  return segments;
};

const validateWhiteboard = (shot, durationFrames, imageSequence) => {
  if (shot.white_cat_present !== false) throw new Error(`${shot.shot_id} white cat rejects the whiteboard route`);
  if (imageSequence.length !== 1 || path.extname(imageSequence[0].asset).toLowerCase() !== '.png') {
    throw new Error(`${shot.shot_id} whiteboard route requires one approved normalized PNG tableau`);
  }
  const whiteboard = shot.whiteboard;
  if (whiteboard?.contract_version !== 'whiteboard-scene-input-v1') {
    throw new Error(`${shot.shot_id} whiteboard scene input is required`);
  }
  const references = {
    source_image: requireAssetReference(whiteboard.source_image, `${shot.shot_id}.whiteboard.source_image`, '.png'),
    normalized_image: requireAssetReference(whiteboard.normalized_image, `${shot.shot_id}.whiteboard.normalized_image`, '.png'),
    annotation: requireAssetReference(whiteboard.annotation, `${shot.shot_id}.whiteboard.annotation`, '.json'),
    preview: requireAssetReference(whiteboard.preview, `${shot.shot_id}.whiteboard.preview`, '.png'),
    clip: requireAssetReference(whiteboard.clip, `${shot.shot_id}.whiteboard.clip`, '.mp4'),
    render_evidence: requireAssetReference(whiteboard.render_evidence, `${shot.shot_id}.whiteboard.render_evidence`, '.json'),
  };
  if (references.normalized_image.asset !== imageSequence[0].asset
    || references.normalized_image.checksum_sha256 !== imageSequence[0].checksum_sha256) {
    throw new Error(`${shot.shot_id} whiteboard normalized PNG must equal the locked image sequence`);
  }
  if (!Number.isInteger(whiteboard.source_duration_frames) || whiteboard.source_duration_frames < 1) {
    throw new Error(`${shot.shot_id} whiteboard source_duration_frames is invalid`);
  }
  if (!Array.isArray(whiteboard.source_dimensions)
    || whiteboard.source_dimensions.length !== 2
    || !whiteboard.source_dimensions.every((value) => Number.isInteger(value) && value > 0)
    || whiteboard.source_dimensions[0] <= whiteboard.source_dimensions[1]
    || typeof whiteboard.source_aspect_ratio_relative_error !== 'number'
    || whiteboard.source_aspect_ratio_relative_error < 0
    || whiteboard.source_aspect_ratio_relative_error > 0.005) {
    throw new Error(`${shot.shot_id} whiteboard source image is outside the 16:9 tolerance`);
  }
  const measuredAspectError = Math.abs(
    whiteboard.source_dimensions[0] / whiteboard.source_dimensions[1] - 16 / 9,
  ) / (16 / 9);
  if (measuredAspectError > 0.005
    || Math.abs(measuredAspectError - whiteboard.source_aspect_ratio_relative_error) > 1e-6) {
    throw new Error(`${shot.shot_id} whiteboard source aspect evidence does not match its dimensions`);
  }
  if (whiteboard.normalized_width !== 1920 || whiteboard.normalized_height !== 1080) {
    throw new Error(`${shot.shot_id} whiteboard normalized image must be 1920x1080`);
  }
  const media = whiteboard.render_evidence.media;
  if (whiteboard.render_evidence.contract_version !== 'whiteboard-render-evidence-v1'
    || media?.width !== 1920 || media?.height !== 1080 || media?.fps !== 30
    || media?.codec !== 'h264' || media?.audio_streams !== 0
    || media?.frame_count !== whiteboard.source_duration_frames
    || media?.final_frame_verified !== true
    || media?.full_frame_hold_verified_frames < 15) {
    throw new Error(`${shot.shot_id} whiteboard render evidence is not assembly-safe`);
  }
  if (!Array.isArray(whiteboard.element_order) || whiteboard.element_order.length === 0
    || whiteboard.element_order.some((value) => typeof value !== 'string' || value === '')) {
    throw new Error(`${shot.shot_id} whiteboard element order is required`);
  }
  const orderChecksum = elementOrderSha256(whiteboard.element_order);
  if (whiteboard.element_order_checksum_sha256 !== orderChecksum) {
    throw new Error(`${shot.shot_id} whiteboard element order checksum mismatch`);
  }
  validateWhiteboardReview(shot, whiteboard, references);
  const timingSegments = validateWhiteboardTimingSegments(shot, whiteboard, durationFrames);
  return {
    contract_version: 'whiteboard-scene-v1',
    ...references,
    render_evidence: {
      ...references.render_evidence,
      contract_version: 'whiteboard-render-evidence-v1',
      media: {...media},
    },
    source_duration_frames: whiteboard.source_duration_frames,
    timing_segments: timingSegments,
    retiming_mode: whiteboard.retiming_mode,
    visual_sequence_lock: {
      contract_version: 'whiteboard-visual-sequence-lock-v1',
      source_image_sha256: references.source_image.checksum_sha256,
      normalized_image_sha256: references.normalized_image.checksum_sha256,
      annotation_sha256: references.annotation.checksum_sha256,
      preview_sha256: references.preview.checksum_sha256,
      clip_sha256: references.clip.checksum_sha256,
      render_evidence_sha256: references.render_evidence.checksum_sha256,
      element_order: [...whiteboard.element_order],
      element_order_checksum_sha256: orderChecksum,
    },
  };
};

const projectIntraShotTransition = (item) => ({
  contract_version: item.contract_version,
  from_asset_id: item.from_asset_id,
  to_asset_id: item.to_asset_id,
  at_frame: item.at_frame,
  kind: item.kind,
  duration_seconds: item.duration_seconds,
  duration_in_frames: item.duration_in_frames,
  from_image_index: item.from_image_index,
  to_image_index: item.to_image_index,
  renderer: item.renderer,
  user_selection: item.user_selection ?? null,
});

const validateAssets = (
  shot,
  durationFrames,
  fps,
  visualGenerationRoute,
  requireActionSchedule = false,
  requireV3Contracts = false,
  visualRhythmMapSha256 = null,
  expectedActionScheduleVersion = ACTION_STATE_SCHEDULE_V3_VERSION,
) => {
  if (!Array.isArray(shot.assets) || shot.assets.length === 0) {
    throw new Error(`${shot.shot_id} requires at least one approved raster`);
  }
  const ids = new Set();
  let expectedFrom = 0;
  const imageSequence = shot.assets.map((asset, index) => {
    if (typeof asset.asset_id !== 'string' || asset.asset_id === '') {
      throw new Error(`${shot.shot_id} asset ${index} has no asset_id`);
    }
    if (ids.has(asset.asset_id)) throw new Error(`${shot.shot_id} has duplicate asset_id ${asset.asset_id}`);
    ids.add(asset.asset_id);
    if (typeof asset.asset !== 'string' || asset.asset === '') {
      throw new Error(`${shot.shot_id} asset ${asset.asset_id} has no public asset path`);
    }
    const from = requireInteger(asset.from, `${shot.shot_id}/${asset.asset_id}.from`);
    const occurrenceDuration = requireInteger(
      asset.duration_in_frames,
      `${shot.shot_id}/${asset.asset_id}.duration_in_frames`,
      1,
    );
    if (from !== expectedFrom) throw new Error(`${shot.shot_id} image sequence must be consecutive`);
    expectedFrom += occurrenceDuration;
    if (asset.visual_generation_route !== visualGenerationRoute) {
      throw new Error(`${shot.shot_id} asset route mismatch: ${asset.asset_id}`);
    }
    if (['doodle-slides', COMIC_ROUTE, ...STYLE_BACKED_ROUTE_IDS].includes(visualGenerationRoute)
      && path.extname(asset.asset).toLowerCase() !== '.png') {
      throw new Error(`${shot.shot_id} ${visualGenerationRoute} accepts approved PNG assets only`);
    }
    if (visualGenerationRoute === COMIC_ROUTE) {
      requireSha256(asset.checksum_sha256, `${shot.shot_id}/${asset.asset_id}.checksum_sha256`);
      if (asset.generator !== 'codex-native-imagegen') {
        throw new Error(`${shot.shot_id} comic assets must use Codex native imagegen`);
      }
      if (asset.review_status !== 'approved') {
        throw new Error(`${shot.shot_id} comic assets require sequential approval`);
      }
      if (asset.width !== 1920 || asset.height !== 1080) {
        throw new Error(`${shot.shot_id} comic assets must be 1920x1080`);
      }
      if (typeof asset.prompt_asset !== 'string' || asset.prompt_asset.trim() === ''
        || !SHA256.test(asset.prompt_checksum_sha256 ?? '')) {
        throw new Error(`${shot.shot_id} comic assets require a locked prompt and checksum`);
      }
      if (!Array.isArray(asset.reference_checksums_sha256)
        || asset.reference_checksums_sha256.some((checksum) => !SHA256.test(checksum))) {
        throw new Error(`${shot.shot_id} comic assets require an explicit reference checksum list`);
      }
    }
    if (STYLE_BACKED_ROUTE_IDS.includes(visualGenerationRoute)) {
      const routeConfig = STYLE_ROUTE_CONFIGS.get(visualGenerationRoute);
      requireSha256(asset.checksum_sha256, `${shot.shot_id}/${asset.asset_id}.checksum_sha256`);
      if (asset.generator !== 'codex-native-imagegen') {
        throw new Error(`${shot.shot_id} ${visualGenerationRoute} assets must use Codex native imagegen through generate-visual-styles`);
      }
      if (asset.review_status !== 'approved') {
        throw new Error(`${shot.shot_id} ${visualGenerationRoute} assets require exact-byte approval`);
      }
      if (asset.width !== 1920 || asset.height !== 1080) {
        throw new Error(`${shot.shot_id} ${visualGenerationRoute} assets must be 1920x1080`);
      }
      if (typeof asset.prompt_asset !== 'string' || asset.prompt_asset.trim() === ''
        || !SHA256.test(asset.prompt_checksum_sha256 ?? '')) {
        throw new Error(`${shot.shot_id} ${visualGenerationRoute} assets require a locked prompt and checksum`);
      }
      if (!Array.isArray(asset.reference_checksums_sha256)
        || asset.reference_checksums_sha256.some((checksum) => !SHA256.test(checksum))) {
        throw new Error(`${shot.shot_id} ${visualGenerationRoute} assets require an explicit reference checksum list`);
      }
      if (asset.style_profile_id !== routeConfig?.style_profile_id
        || asset.style_profile_checksum_sha256 !== routeConfig?.style_profile_checksum_sha256
        || asset.style_skill_checksum_sha256 !== routeConfig?.style_skill_checksum_sha256) {
        throw new Error(`${shot.shot_id} ${visualGenerationRoute} style profile binding is stale`);
      }
    }
    return {
      asset_id: asset.asset_id,
      asset: asset.asset,
      checksum_sha256: asset.checksum_sha256 ?? null,
      from,
      duration_in_frames: occurrenceDuration,
      visual_generation_route: asset.visual_generation_route,
      ...(visualGenerationRoute === COMIC_ROUTE ? {
        generator: asset.generator,
        review_status: asset.review_status,
        width: asset.width,
        height: asset.height,
        prompt_asset: asset.prompt_asset,
        prompt_checksum_sha256: asset.prompt_checksum_sha256,
        reference_checksums_sha256: [...asset.reference_checksums_sha256],
      } : {}),
      ...(STYLE_BACKED_ROUTE_IDS.includes(visualGenerationRoute) ? {
        generator: asset.generator,
        review_status: asset.review_status,
        width: asset.width,
        height: asset.height,
        prompt_asset: asset.prompt_asset,
        prompt_checksum_sha256: asset.prompt_checksum_sha256,
        reference_checksums_sha256: [...asset.reference_checksums_sha256],
        style_profile_id: asset.style_profile_id,
        style_profile_checksum_sha256: asset.style_profile_checksum_sha256,
        style_skill_checksum_sha256: asset.style_skill_checksum_sha256,
      } : {}),
    };
  });
  if (expectedFrom !== durationFrames) {
    throw new Error(`${shot.shot_id} image sequence must cover the complete shot duration`);
  }
  if (visualGenerationRoute === COMIC_ROUTE
    && imageSequence.at(-1).duration_in_frames < Math.round(fps * 0.5)) {
    throw new Error(`${shot.shot_id} comic final state must hold for at least 0.5 seconds`);
  }

  let intraShotTransitions;
  if (requireV3Contracts) {
    if (!Array.isArray(shot.intra_shot_transitions)) {
      throw new Error(`${shot.shot_id} v3 requires an explicit complete intra-shot transition map`);
    }
    intraShotTransitions = structuredClone(shot.intra_shot_transitions);
    validateIntraShotTransitionSequence({
      imageSequence,
      transitions: intraShotTransitions,
      fps,
    });
    if (intraShotTransitions.some((transition) => (
      transition.kind === INTRA_SHOT_WATERCOLOR_BLOOM_KIND
      && transition.user_selection.presented_map_sha256 !== visualRhythmMapSha256
    ))) {
      throw new Error(`${shot.shot_id} watercolor-bloom approval is not bound to the active visual rhythm map`);
    }
  } else {
    const transitionFrames = getIntraShotWatercolorBloomDurationInFrames(fps);
    intraShotTransitions = imageSequence.slice(1).map((image, index) => ({
      contract_version: INTRA_SHOT_WATERCOLOR_BLOOM_RULE_ID,
      from_asset_id: imageSequence[index].asset_id,
      to_asset_id: image.asset_id,
      at_frame: image.from,
      duration_seconds: INTRA_SHOT_WATERCOLOR_BLOOM_SECONDS,
      duration_in_frames: transitionFrames,
      from_image_index: index,
      to_image_index: index + 1,
      kind: INTRA_SHOT_WATERCOLOR_BLOOM_KIND,
      renderer: INTRA_SHOT_WATERCOLOR_BLOOM_RENDERER,
    }));
  }
  let actionStateSchedule = null;
  if (requireActionSchedule) {
    actionStateSchedule = shot.action_state_schedule;
    if (requireV3Contracts
      && actionStateSchedule?.contract_version !== expectedActionScheduleVersion) {
      throw new Error(`${shot.shot_id} current character action requires ${expectedActionScheduleVersion}`);
    }
    validateActionStateSchedule(actionStateSchedule, {
      totalFrames: durationFrames,
      fps,
      densityMode: expectedActionScheduleVersion === ACTION_STATE_SCHEDULE_V4_VERSION
        ? shot.density_mode
        : null,
      densitySelectionSha256: expectedActionScheduleVersion === ACTION_STATE_SCHEDULE_V4_VERSION
        ? shot.visual_density_selection_sha256
        : null,
      revoiceLock: shot.revoice_parent_action_state_ids
        ? {
            state_ids: shot.revoice_parent_action_state_ids,
            state_plan_sha256: shot.revoice_parent_action_state_plan_sha256,
            density_mode: shot.revoice_parent_density_mode,
            visual_density_selection_sha256: shot.revoice_parent_visual_density_selection_sha256,
          }
        : null,
    });
    if (actionStateSchedule.occurrences.length !== imageSequence.length
      || actionStateSchedule.occurrences.some((occurrence, index) => (
        occurrence.state_id !== imageSequence[index].asset_id
        || (requireV3Contracts ? occurrence.at_frame : occurrence.start_frame) !== imageSequence[index].from
        || occurrence.duration_in_frames !== imageSequence[index].duration_in_frames
      ))) {
      throw new Error(`${shot.shot_id} action-state schedule does not match the exact image sequence`);
    }
    if (JSON.stringify(actionStateSchedule.intra_shot_transitions.map(projectIntraShotTransition))
      !== JSON.stringify(intraShotTransitions.map(projectIntraShotTransition))) {
      throw new Error(`${shot.shot_id} action-state schedule intra-shot transition map is stale`);
    }
  }
  return {imageSequence, intraShotTransitions, actionStateSchedule};
};

const validateLocalVideo = (shot, durationFrames, fps) => {
  if (shot.white_cat_present !== false) {
    throw new Error(`${shot.shot_id} local-video-file forbids the white cat`);
  }
  if (Array.isArray(shot.assets) && shot.assets.length > 0) {
    throw new Error(`${shot.shot_id} local-video-file must not carry raster image assets`);
  }
  if (Array.isArray(shot.intra_shot_transitions) && shot.intra_shot_transitions.length > 0) {
    throw new Error(`${shot.shot_id} local-video-file must not carry raster intra-shot transitions`);
  }
  const binding = validateLocalVideoMatchBinding(shot.local_video, {
    shotId: shot.shot_id,
    targetDurationFrames: durationFrames,
    fps,
  });
  if (binding.selected_source_path !== shot.local_video_source_path) {
    throw new Error(`${shot.shot_id} local video binding differs from the approved source path`);
  }
  return binding;
};

const validateHeroPoseBackground = (shot, visualGenerationRoute) => {
  const background = shot.hero_pose_background;
  if (!background || typeof background !== 'object' || Array.isArray(background)
    || typeof background.asset_id !== 'string' || background.asset_id.trim() === ''
    || typeof background.asset !== 'string' || background.asset.trim() === ''
    || background.visual_generation_route !== visualGenerationRoute) {
    throw new Error(`${shot.shot_id} hero_pose requires one locked route-matched background asset`);
  }
  return {
    asset_id: background.asset_id,
    asset: background.asset,
    checksum_sha256: requireSha256(
      background.checksum_sha256,
      `${shot.shot_id}.hero_pose_background.checksum_sha256`,
    ),
    visual_generation_route: visualGenerationRoute,
  };
};

const buildScene = (
  shot,
  index,
  shots,
  fps,
  requireV3Contracts,
  revoiceVariant,
  visualRhythmMapSha256,
  expectedActionScheduleVersion,
  ianLayeredSceneEvidence,
) => {
  const flipbook = isFlipbookRow(shot);
  if (flipbook) {
    validateStaticSpread(shot.static_spread, {sourceText: shot.narration_source_text, shotId: shot.shot_id});
    if (shot.white_cat_present !== false || shot.motion_tier !== 'static_spread'
      || !['imagegen', IAN_ROUTE].includes(shot.visual_generation_route)
      || shot.assets?.length !== 1 || shot.ian_layered_scene != null
      || shot.action_state_schedule != null || shot.internal_motion != null) {
      throw new Error(`${shot.shot_id} flipbook requires one no-cat static spread without layered or action assets`);
    }
  }
  const startFrame = requireInteger(shot.start_frame, `${shot.shot_id}.start_frame`);
  const endFrame = requireInteger(shot.end_frame, `${shot.shot_id}.end_frame`, 1);
  if (endFrame <= startFrame) throw new Error(`${shot.shot_id} must have positive duration`);
  const durationFrames = endFrame - startFrame;
  const visualGenerationRoute = shot.visual_generation_route;
  if (![
    'imagegen',
    XUAN_ROUTE,
    INK_DOODLE_ROUTE,
    COMIC_ROUTE,
    IAN_ROUTE,
    'doodle-slides',
    WHITEBOARD_ROUTE,
    LOCAL_VIDEO_ROUTE,
  ].includes(visualGenerationRoute)) {
    throw new Error(`${shot.shot_id} requires an explicit visual_generation_route`);
  }
  if (visualGenerationRoute === COMIC_ROUTE) {
    throw new Error(`${shot.shot_id} comic-imagegen is legacy read-only and cannot enter assembly or create a new output`);
  }
  if (requireV3Contracts) {
    for (const field of ['top_title', 'top_title_reason', 'top_title_overlay', 'timeline_text_overlays']) {
      if (Object.hasOwn(shot, field)) {
        throw new Error(`${shot.shot_id} assembly must not receive a generic top-title or timeline text overlay field`);
      }
    }
    if (!(flipbook ? ['static_spread'] : ['layered', 'stateful', 'hero_pose']).includes(shot.motion_tier)) {
      throw new Error(`${shot.shot_id} requires a locked v3 motion_tier`);
    }
  }
  const routeTextPolicy = requireV3Contracts
    ? resolveRouteVisibleTextPolicy({
        visual_generation_route: visualGenerationRoute,
        white_cat_present: shot.white_cat_present,
      })
    : null;
  if (shot.visual_structure_id !== undefined || shot.treatment_profile_id !== undefined
    || shot.comic_plan !== undefined || visualGenerationRoute === COMIC_ROUTE) {
    validateVisualLanguageSelection({
      scene_class: shot.scene_class,
      presentation_mode: shot.presentation_mode,
      visual_structure_id: shot.visual_structure_id,
      treatment_profile_id: shot.treatment_profile_id,
      visual_generation_route: visualGenerationRoute,
      white_cat_present: shot.white_cat_present,
      comic_plan: shot.comic_plan ?? null,
    });
  }
  const requiresCharacterSchedule = requireV3Contracts
    && ['stateful', 'hero_pose'].includes(shot.motion_tier)
    && ['imagegen', XUAN_ROUTE, IAN_ROUTE, INK_DOODLE_ROUTE].includes(visualGenerationRoute);
  const localVideo = visualGenerationRoute === LOCAL_VIDEO_ROUTE
    ? validateLocalVideo(shot, durationFrames, fps)
    : null;
  const {
    imageSequence,
    intraShotTransitions,
    actionStateSchedule,
  } = localVideo
    ? {imageSequence: [], intraShotTransitions: [], actionStateSchedule: null}
    : validateAssets(
      shot,
      durationFrames,
      fps,
      visualGenerationRoute,
      requiresCharacterSchedule,
      requireV3Contracts,
      visualRhythmMapSha256,
      expectedActionScheduleVersion,
    );
  const whiteboard = visualGenerationRoute === WHITEBOARD_ROUTE
    ? validateWhiteboard(shot, durationFrames, imageSequence)
    : null;
  if (requireV3Contracts && !whiteboard && !localVideo) {
    if (shot.motion_tier === 'layered' && imageSequence.length !== 1) {
      throw new Error(`${shot.shot_id} layered requires exactly one complete master raster`);
    }
    if (shot.motion_tier === 'stateful' && (imageSequence.length < 2 || imageSequence.length > 4)) {
      throw new Error(`${shot.shot_id} stateful requires 2–4 complete scene rasters`);
    }
    if (shot.motion_tier === 'hero_pose'
      && (imageSequence.length < 4 || imageSequence.length > 6)) {
      throw new Error(`${shot.shot_id} hero_pose requires 4–6 pose occurrences`);
    }
  }
  const heroPoseBackground = requireV3Contracts && shot.motion_tier === 'hero_pose'
    ? validateHeroPoseBackground(shot, visualGenerationRoute)
    : null;
  if (shot.motion_tier === 'hero_pose'
    && !['imagegen', XUAN_ROUTE].includes(visualGenerationRoute)) {
    throw new Error(`${shot.shot_id} hero_pose requires an active narrative image route`);
  }
  if (shot.motion_tier !== 'hero_pose' && shot.hero_pose_background !== undefined) {
    throw new Error(`${shot.shot_id} non-hero shot must not carry a hero_pose_background`);
  }
  if (actionStateSchedule && actionStateSchedule.motion_tier !== shot.motion_tier) {
    throw new Error(`${shot.shot_id} action-state motion tier differs from the approved shot tier`);
  }
  const sceneType = flipbook ? 'flipbook-spread' : {
    imagegen: 'narrative',
    [XUAN_ROUTE]: 'narrative',
    [COMIC_ROUTE]: 'comic',
    [IAN_ROUTE]: requireV3Contracts ? 'ian-layered' : 'graphic',
    [INK_DOODLE_ROUTE]: 'graphic',
    'doodle-slides': 'doodle',
    [WHITEBOARD_ROUTE]: 'whiteboard',
    [LOCAL_VIDEO_ROUTE]: 'local-video',
  }[visualGenerationRoute];
  const isTerminal = index === shots.length - 1;
  if (isTerminal && shot.transition !== null) {
    throw new Error(`terminal shot must use a clean hold with no outgoing transition: ${shot.shot_id}`);
  }
  if (!isTerminal && requireV3Contracts
    && (shot.transition?.source_visual_generation_route !== visualGenerationRoute
      || shot.transition?.next_visual_generation_route !== shots[index + 1].visual_generation_route)) {
    throw new Error(`${shot.shot_id} transition recommendation routes do not match the adjacent shots`);
  }
  if (!isTerminal && flipbook && (shot.transition?.kind !== FLIPBOOK_TRANSITION_KIND
    || shot.transition?.renderer !== FLIPBOOK_RENDERER
    || shot.transition?.white_cat_visual_style_id !== FLIPBOOK_STYLE_ID)) {
    throw new Error(`${shot.shot_id} flipbook transition must execute its style-bound book-page-turn`);
  }
  let transition = isTerminal
    ? null
    : validateUserApprovedTransition(shot.transition, {
        fps,
        sourceShotId: shot.shot_id,
        nextShotId: shots[index + 1].shot_id,
      });
  if (revoiceVariant) {
    if (!Object.hasOwn(shot, 'revoice_parent_transition')) {
      throw new Error(`${shot.shot_id} revoice requires an exact parent transition snapshot`);
    }
    if (isTerminal) {
      if (shot.revoice_parent_transition !== null) {
        throw new Error(`${shot.shot_id} revoice terminal transition lock must remain null`);
      }
    } else {
      transition = validateRevoiceTransitionLock(shot.revoice_parent_transition, transition, {
        fps,
        sourceShotId: shot.shot_id,
        nextShotId: shots[index + 1].shot_id,
        shotDurationFrames: durationFrames,
      });
    }
  }
  let ianLayeredScene = null;
  if (requireV3Contracts && visualGenerationRoute === IAN_ROUTE && !flipbook) {
    if (shot.internal_motion_contract != null || shot.internal_motion != null) {
      throw new Error(`${shot.shot_id} Ian whole-raster motion is retired; use a layered scene package`);
    }
    if (!ianLayeredSceneEvidence || ianLayeredSceneEvidence.shot_id !== shot.shot_id) {
      throw new Error(`${shot.shot_id} requires checksum-bound Ian layered-scene package evidence`);
    }
    const packageValue = validateIanLayeredScenePackage(ianLayeredSceneEvidence.package, {
      episodeWorkspace: ianLayeredSceneEvidence.package.episode_workspace,
      queueItemId: imageSequence[0]?.asset_id,
      shotId: shot.shot_id,
      treatmentProfileId: shot.treatment_profile_id,
      sourceText: shot.narration_source_text,
      shotStartFrame: startFrame,
      shotEndFrame: endFrame,
      visibleTextMode: shot.visible_text_mode,
      exactVisibleText: shot.exact_visible_text,
    });
    if (imageSequence.length !== 1
      || ianLayeredSceneEvidence.storyboard_scene_plan_sha256 !== packageValue.scene_plan_sha256
      || imageSequence[0].from !== 0
      || imageSequence[0].duration_in_frames !== durationFrames
      || imageSequence[0].checksum_sha256 !== packageValue.final_composite.checksum_sha256
      || ianLayeredSceneEvidence.render_assets?.final_composite?.asset
        !== imageSequence[0].asset
      || ianLayeredSceneEvidence.render_assets?.final_composite?.checksum_sha256
        !== packageValue.final_composite.checksum_sha256) {
      throw new Error(`${shot.shot_id} Ian review composite differs from its layered package`);
    }
    const backgroundAsset = ianLayeredSceneEvidence.render_assets?.background;
    const layerAssets = ianLayeredSceneEvidence.render_assets?.layers;
    if (backgroundAsset?.checksum_sha256 !== packageValue.background.checksum_sha256
      || !Array.isArray(layerAssets)
      || JSON.stringify(layerAssets.map((item) => item.layer_id))
        !== JSON.stringify(packageValue.layers.map((item) => item.layer_id))
      || layerAssets.some((item, index) => (
        item.checksum_sha256 !== packageValue.layers[index].checksum_sha256
        || typeof item.asset !== 'string'
        || item.asset === ''
      ))) {
      throw new Error(`${shot.shot_id} Ian public render assets differ from the package members`);
    }
    const entryEffects = ianLayeredSceneEvidence.entry_effects == null
      ? null
      : validateIanLayeredEntryEffectsPlan(ianLayeredSceneEvidence.entry_effects, {
          shotId: shot.shot_id,
          scenePlanSha256: packageValue.scene_plan_sha256,
          packageManifest: ianLayeredSceneEvidence.package_manifest,
          durationFrames,
          layerEntries: packageValue.layers.map(({layer_id, entry_frame}) => ({layer_id, entry_frame})),
          libraryManifestSha256: ianLayeredSceneEvidence.entry_effects.sound_effect_library.checksum_sha256,
        });
    ianLayeredScene = {
      contract_version: entryEffects === null
        ? IAN_LAYERED_SCENE_RENDERER_VERSION
        : IAN_LAYERED_ENTRY_RENDERER_VERSION,
      package_contract_version: IAN_LAYERED_SCENE_PACKAGE_VERSION,
      package_manifest: structuredClone(ianLayeredSceneEvidence.package_manifest),
      scene_plan_sha256: packageValue.scene_plan_sha256,
      storyboard_scene_plan_sha256: ianLayeredSceneEvidence.storyboard_scene_plan_sha256,
      background: {
        asset: backgroundAsset.asset,
        checksum_sha256: backgroundAsset.checksum_sha256,
      },
      layers: packageValue.layers.map((layer, index) => ({
        layer_id: layer.layer_id,
        z_index: layer.z_index,
        semantic_role: layer.semantic_role,
        source_text_start_byte: layer.source_text_start_byte,
        source_text_end_byte_exclusive: layer.source_text_end_byte_exclusive,
        source_text: layer.source_text,
        entry_frame: layer.entry_frame,
        asset: layerAssets[index].asset,
        checksum_sha256: layer.checksum_sha256,
      })),
      final_composite: {
        asset: imageSequence[0].asset,
        checksum_sha256: packageValue.final_composite.checksum_sha256,
      },
      ...(entryEffects === null ? {
        layer_entry_transition: structuredClone(packageValue.scene_plan.layer_entry_transition),
        motion_policy: structuredClone(packageValue.scene_plan.motion_policy),
      } : {
        entry_effects: entryEffects,
      }),
    };
  } else if (requireV3Contracts
    && (shot.internal_motion_contract != null || shot.internal_motion != null)) {
    throw new Error(`${shot.shot_id} non-Ian scene must not carry retired Ian internal motion`);
  }
  return {
    shot_id: shot.shot_id,
    start_frame: startFrame,
    end_frame: endFrame,
    duration_frames: durationFrames,
    scene_type: sceneType,
    ...(flipbook ? {presentation_mode: FLIPBOOK_STYLE_ID, static_spread: structuredClone(shot.static_spread),
      text_reveals: structuredClone(shot.text_reveals ?? [])} : {}),
    scene_class: shot.scene_class,
    structured_visual_kind: shot.structured_visual_kind ?? null,
    visual_structure_id: shot.visual_structure_id ?? null,
    treatment_profile_id: shot.treatment_profile_id ?? null,
    comic_plan: visualGenerationRoute === COMIC_ROUTE ? shot.comic_plan : null,
    white_cat_present: shot.white_cat_present,
    visual_generation_route: visualGenerationRoute,
    ian_layered_scene: ianLayeredScene,
    motion_tier: requireV3Contracts ? shot.motion_tier : null,
    density_mode: expectedActionScheduleVersion === ACTION_STATE_SCHEDULE_V4_VERSION
      ? shot.density_mode
      : null,
    visual_density_selection_sha256: expectedActionScheduleVersion === ACTION_STATE_SCHEDULE_V4_VERSION
      ? shot.visual_density_selection_sha256
      : null,
    ...(requireV3Contracts ? {
      visible_text_mode: shot.visible_text_mode,
      exact_visible_text: shot.exact_visible_text ?? null,
      visible_text_placement: shot.visible_text_placement ?? null,
      visible_text_policy: routeTextPolicy.visible_text_policy,
      assembly_text_policy: routeTextPolicy.assembly_text_policy,
      timeline_text_overlays: [],
    } : {}),
    image_sequence: imageSequence,
    intra_shot_transition_contract: requireV3Contracts
      ? INTRA_SHOT_TRANSITION_VERSION
      : INTRA_SHOT_WATERCOLOR_BLOOM_RULE_ID,
    intra_shot_transitions: whiteboard ? [] : intraShotTransitions,
    action_state_schedule: actionStateSchedule,
    action_state_plan_sha256: [
      ACTION_STATE_SCHEDULE_V3_VERSION,
      ACTION_STATE_SCHEDULE_V4_VERSION,
    ].includes(actionStateSchedule?.contract_version)
      ? buildActionStatePlanSha256(actionStateSchedule)
      : null,
    hero_pose_background: heroPoseBackground,
    whiteboard,
    local_video: localVideo,
    transition_intent: transition?.source_intent ?? 'clean hold',
    transition,
    ...(revoiceVariant ? {revoice_parent_transition: shot.revoice_parent_transition} : {}),
  };
};

const verifySharedReuseEvidence = (input) => {
  if (typeof input.episodeWorkspace !== 'string' || input.episodeWorkspace === '') {
    throw new Error('episodeWorkspace is required for shared reuse verification');
  }
  const evidence = input.sharedReuseDecision;
  const expectedPath = `${input.episodeWorkspace}/schema/shared-reuse-decision-v1.json`;
  if (evidence?.path !== expectedPath) throw new Error('shared reuse decision path does not match the active episode');
  const decisionPath = path.resolve(REPOSITORY_ROOT, evidence.path);
  const checksum = sha256File(decisionPath);
  if (checksum !== evidence.checksum_sha256) throw new Error('shared reuse decision checksum mismatch');
  const registryPath = path.resolve(REPOSITORY_ROOT, 'leverage-video/src/shared/reuse-registry/registry.json');
  const validation = validateReuseDecision(readJson(registryPath), readJson(decisionPath), {
    episodeWorkspace: input.episodeWorkspace,
    phase: 'consumption',
    decisionPath,
  });
  return {
    path: evidence.path,
    checksum_sha256: checksum,
    validation_phase: validation.phase,
    checked_modules: validation.checked_modules,
    result: validation.result,
  };
};

const verifyVisualDirectionReviewEvidence = (input) => {
  const evidence = input.visualDirectionReview;
  if (typeof input.episodeWorkspace !== 'string' || input.episodeWorkspace === '') {
    throw new Error('episodeWorkspace is required for visual direction review verification');
  }
  if (typeof evidence?.path !== 'string' || !SHA256.test(evidence?.checksum_sha256 ?? '')) {
    throw new Error('visual direction review artifact path and checksum are required');
  }
  const episodeRoot = path.resolve(REPOSITORY_ROOT, input.episodeWorkspace);
  const schemaRoot = path.join(episodeRoot, 'schema');
  const artifactPath = path.resolve(REPOSITORY_ROOT, evidence.path);
  const relativeToSchema = path.relative(schemaRoot, artifactPath);
  if (relativeToSchema.startsWith('..') || path.isAbsolute(relativeToSchema)
    || !isActiveVisualDirectionArtifactBasename(path.basename(artifactPath))) {
    throw new Error('visual direction review artifact must be the active episode schema artifact');
  }
  let checksum;
  let review;
  try {
    checksum = sha256File(artifactPath);
    review = readJson(artifactPath);
  } catch (error) {
    throw new Error(`visual direction review artifact is unreadable: ${error.message}`);
  }
  if (checksum !== evidence.checksum_sha256) {
    throw new Error('visual direction review artifact checksum mismatch');
  }
  return {review, path: evidence.path, checksum_sha256: checksum};
};

const verifyStoryboardVisualRhythmEvidence = (input) => {
  const evidence = input.storyboardVisualRhythm;
  if (typeof input.episodeWorkspace !== 'string' || input.episodeWorkspace === '') {
    throw new Error('episodeWorkspace is required for storyboard visual rhythm verification');
  }
  const expectedSchemaRoot = `${input.episodeWorkspace}/schema/`;
  if (typeof evidence?.path !== 'string'
      || !evidence.path.startsWith(expectedSchemaRoot)
      || evidence.path.slice(expectedSchemaRoot.length).includes('/')
      || !isActiveStoryboardVisualRhythmArtifactBasename(path.basename(evidence.path))
      || !SHA256.test(evidence?.checksum_sha256 ?? '')) {
    throw new Error('storyboard visual rhythm artifact path and checksum are required');
  }
  const artifactPath = path.resolve(REPOSITORY_ROOT, evidence.path);
  let checksum;
  let artifact;
  try {
    checksum = sha256File(artifactPath);
    artifact = readJson(artifactPath);
  } catch (error) {
    throw new Error(`storyboard visual rhythm artifact is unreadable: ${error.message}`);
  }
  if (checksum !== evidence.checksum_sha256) {
    throw new Error('storyboard visual rhythm artifact checksum mismatch');
  }
  return {
    artifact,
    path: evidence.path,
    checksum_sha256: checksum,
    validation: validateStoryboardVisualRhythm(artifact, {
      shotIds: input.shots.map(({shot_id: shotId}) => shotId),
    }),
  };
};

const requireSoundDesignBinding = (value, label) => {
  if (typeof value?.path !== 'string' || value.path === ''
      || !SHA256.test(value?.checksum_sha256 ?? '')) {
    throw new Error(`${label} path and checksum are required`);
  }
  return {path: value.path, checksum_sha256: value.checksum_sha256};
};

const buildExpectedSoundDesignBindings = (input, visualRhythmEvidence) => ({
  storyboard: requireSoundDesignBinding(input.visualDirectionReview?.storyboard, 'storyboard'),
  narration_master: requireSoundDesignBinding(input.narrationMaster, 'narration master'),
  visual_manifest: requireSoundDesignBinding(input.visualManifest, 'visual manifest'),
  visual_rhythm: requireSoundDesignBinding({
    path: visualRhythmEvidence?.path,
    checksum_sha256: visualRhythmEvidence?.checksum_sha256,
  }, 'visual rhythm'),
  transition_review: requireSoundDesignBinding(input.transitionSelectionReview, 'transition review'),
  sound_design_policy: structuredClone(KNOWLEDGE_VIDEO_SOUND_DESIGN_POLICY_BINDING),
  sound_effect_library: requireSoundDesignBinding(input.soundEffectLibrary, 'sound-effect library'),
});

const verifySoundDesignEvidence = (input, {shots, durationFrames, expectedBindings}) => (
  loadAndValidateKnowledgeVideoSoundDesign({
    repositoryRoot: REPOSITORY_ROOT,
    episodeWorkspace: input.episodeWorkspace,
    binding: input.soundDesign,
    shots,
    durationFrames,
    expectedBindings,
    revoiceVariant: input.resumeMode === 'revoice_variant',
  })
);

const validateSoundDesignEvidence = ({evidence, input, expectedBindings, revoiceVariant}) => {
  const soundDesign = requireSoundDesignBinding(input.soundDesign, 'sound design');
  const validation = evidence?.validation;
  const currentV2 = validation?.contract_version === 'knowledge-video-sound-design-validation-v2';
  const legacyRevoice = revoiceVariant
    && validation?.contract_version === 'knowledge-video-sound-design-validation-v1';
  if (evidence?.path !== soundDesign.path
      || evidence?.checksum_sha256 !== soundDesign.checksum_sha256
      || (!currentV2 && !legacyRevoice)
      || validation?.result !== 'pass'
      || validation?.resume_mode !== (revoiceVariant ? 'revoice_variant' : 'standard')
      || !SHA256.test(validation?.event_map_sha256 ?? '')
      || typeof validation?.bus_gain_multiplier !== 'number'
      || !Number.isFinite(validation.bus_gain_multiplier)
      || validation.bus_gain_multiplier <= 0
      || !Array.isArray(validation?.audible_cues)) {
    throw new Error('passing current sound-design evidence is required');
  }
  for (const [key, binding] of Object.entries(expectedBindings)) {
    if (legacyRevoice && key === 'sound_design_policy') continue;
    if (JSON.stringify(validation.bindings?.[key]) !== JSON.stringify(binding)) {
      throw new Error(`sound-design evidence has a stale ${key} binding`);
    }
  }
  const cueIds = new Set();
  for (const cue of validation.audible_cues) {
    if (typeof cue?.event_id !== 'string' || cueIds.has(cue.event_id)
        || !['global_sound_effect_track_v1', 'ian_layered_scene'].includes(cue.render_owner)) {
      throw new Error('sound-design audible cues have duplicate identities or invalid render owners');
    }
    cueIds.add(cue.event_id);
  }
  return {
    path: soundDesign.path,
    checksum_sha256: soundDesign.checksum_sha256,
    ...structuredClone(validation),
  };
};

const verifyRootRelativeBinding = (binding, label, episodeWorkspace, {schemaOnly = false} = {}) => {
  if (typeof binding?.path !== 'string' || binding.path === '' || path.isAbsolute(binding.path)) {
    throw new Error(`${label} path must be repository-relative`);
  }
  requireSha256(binding.checksum_sha256, `${label}.checksum_sha256`);
  const episodeRoot = path.resolve(REPOSITORY_ROOT, episodeWorkspace);
  const resolved = path.resolve(REPOSITORY_ROOT, binding.path);
  const allowedRoot = schemaOnly ? path.join(episodeRoot, 'schema') : episodeRoot;
  const relative = path.relative(allowedRoot, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} path is outside the active episode${schemaOnly ? ' schema' : ''}`);
  }
  if (sha256File(resolved) !== binding.checksum_sha256) {
    throw new Error(`${label} checksum mismatch`);
  }
};

const verifyPublicIanAsset = (asset, checksum, label) => {
  if (typeof asset !== 'string' || asset === '' || path.isAbsolute(asset)
    || asset.replaceAll('\\', '/').split('/').includes('..')) {
    throw new Error(`${label} must be relative to the configured leverage-video/src public root`);
  }
  requireSha256(checksum, `${label}.checksum_sha256`);
  const publicRoot = path.resolve(REPOSITORY_ROOT, 'leverage-video/src');
  const resolved = path.resolve(publicRoot, asset);
  const relative = path.relative(publicRoot, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes the configured leverage-video/src public root`);
  }
  const status = fs.lstatSync(resolved);
  if (!status.isFile() || status.isSymbolicLink() || status.size === 0
    || sha256File(resolved) !== checksum) {
    throw new Error(`${label} public bytes are missing or stale`);
  }
};

const extractStoryboardShotSection = (markdown, shotId) => {
  const escapedShotId = shotId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = markdown.match(new RegExp(
    `^## ${escapedShotId}\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`,
    'm',
  ));
  if (!match) throw new Error(`${shotId} is missing from the bound storyboard`);
  return match[1];
};

const verifyIanLayeredScenePackageEvidence = (input) => {
  if (typeof input.episodeWorkspace !== 'string' || input.episodeWorkspace === '') {
    throw new Error('episodeWorkspace is required for Ian layered-scene verification');
  }
  const records = input.shots
    .filter((shot) => shot.visual_generation_route === IAN_ROUTE && !isFlipbookRow(shot))
    .map((shot) => {
      const binding = shot.ian_layered_scene;
      const manifestBinding = binding?.package_manifest;
      if (typeof manifestBinding?.path !== 'string'
        || !manifestBinding.path.startsWith(`${input.episodeWorkspace}/schema/`)
        || path.extname(manifestBinding.path) !== '.json') {
        throw new Error(`${shot.shot_id} Ian package manifest must be in the active episode schema`);
      }
      requireSha256(
        manifestBinding.checksum_sha256,
        `${shot.shot_id}.ian_layered_scene.package_manifest.checksum_sha256`,
      );
      const manifestPath = path.resolve(REPOSITORY_ROOT, manifestBinding.path);
      if (sha256File(manifestPath) !== manifestBinding.checksum_sha256) {
        throw new Error(`${shot.shot_id} Ian package manifest checksum mismatch`);
      }
      const packageValue = readJson(manifestPath);
      const validatedPackage = validateIanLayeredScenePackage(packageValue, {
        episodeWorkspace: input.episodeWorkspace,
        queueItemId: shot.assets?.[0]?.asset_id,
        shotId: shot.shot_id,
        treatmentProfileId: shot.treatment_profile_id,
        storyboardBinding: input.visualDirectionReview.storyboard,
        visualDirectionBinding: {
          path: input.visualDirectionReview.path,
          checksum_sha256: input.visualDirectionReview.checksum_sha256,
          presented_map_sha256: input.visualDirectionReview.presented_map_sha256,
        },
        sourceText: shot.narration_source_text,
        shotStartFrame: shot.start_frame,
        shotEndFrame: shot.end_frame,
        visibleTextMode: shot.visible_text_mode,
        exactVisibleText: shot.exact_visible_text,
      });
      const storyboardPath = path.resolve(REPOSITORY_ROOT, input.visualDirectionReview.storyboard.path);
      const storyboardSection = extractStoryboardShotSection(
        fs.readFileSync(storyboardPath, 'utf8'),
        shot.shot_id,
      );
      const storyboardScenePlan = validateIanStoryboardLayeredSceneSection(
        storyboardSection,
        shot.shot_id,
        {
          sourceText: shot.narration_source_text,
          durationFrames: shot.end_frame - shot.start_frame,
        },
      );
      const storyboardScenePlanSha256 = sha256IanCanonical(storyboardScenePlan);
      if (validatedPackage.scene_plan_sha256 !== storyboardScenePlanSha256
        || JSON.stringify(validatedPackage.scene_plan) !== JSON.stringify(storyboardScenePlan)) {
        throw new Error(`${shot.shot_id} Ian package scene plan differs from the bound storyboard`);
      }
      const renderAssets = binding?.render_assets;
      verifyPublicIanAsset(
        renderAssets?.background?.asset,
        renderAssets?.background?.checksum_sha256,
        `${shot.shot_id} Ian background`,
      );
      for (const [index, layer] of (renderAssets?.layers ?? []).entries()) {
        if (layer.layer_id !== packageValue.layers[index]?.layer_id) {
          throw new Error(`${shot.shot_id} Ian layer render order is stale`);
        }
        verifyPublicIanAsset(
          layer.asset,
          layer.checksum_sha256,
          `${shot.shot_id} Ian layer ${layer.layer_id}`,
        );
      }
      verifyPublicIanAsset(
        renderAssets?.final_composite?.asset,
        renderAssets?.final_composite?.checksum_sha256,
        `${shot.shot_id} Ian final composite`,
      );
      let entryEffects = null;
      if (binding?.entry_effects_manifest != null) {
        verifyRootRelativeBinding(
          binding.entry_effects_manifest,
          `${shot.shot_id} Ian entry-effects manifest`,
          input.episodeWorkspace,
          {schemaOnly: true},
        );
        const entryEffectsValue = readJson(path.resolve(
          REPOSITORY_ROOT,
          binding.entry_effects_manifest.path,
        ));
        const library = loadAndValidateSharedSoundEffectLibrary({
          repositoryRoot: REPOSITORY_ROOT,
          manifestPath: entryEffectsValue.sound_effect_library?.path,
        });
        const edgeMargins = packageValue.split_spec.layers.map(({bbox}) => Math.min(
          bbox.x,
          bbox.y,
          1920 - bbox.x - bbox.width,
          1080 - bbox.y - bbox.height,
        ));
        entryEffects = validateIanLayeredEntryEffectsPlan(entryEffectsValue, {
          shotId: shot.shot_id,
          scenePlanSha256: packageValue.scene_plan_sha256,
          packageManifest: manifestBinding,
          durationFrames: shot.end_frame - shot.start_frame,
          layerEntries: packageValue.layers.map(({layer_id, entry_frame}) => ({layer_id, entry_frame})),
          libraryManifestSha256: library.manifest.checksum_sha256,
          libraryAssets: library.assets,
          layerEdgeMargins: edgeMargins,
        });
        entryEffects.layers.forEach((entry) => {
          if (entry.sound_effect !== null) {
            verifyPublicIanAsset(
              entry.sound_effect.derived_asset.asset,
              entry.sound_effect.derived_asset.checksum_sha256,
              `${shot.shot_id} Ian ${entry.layer_id} entry SFX`,
            );
          }
          if (entry.effect.contract_version === IAN_INK_DRAW_REVEAL_VERSION) {
            verifyPublicIanAsset(
              entry.effect.vector_asset.asset,
              entry.effect.vector_asset.checksum_sha256,
              `${shot.shot_id} Ian ${entry.layer_id} reveal vector`,
            );
          } else if (![IAN_SOFT_SETTLE_VERSION, 'fade-only-v1'].includes(entry.effect.contract_version)) {
            throw new Error(`${shot.shot_id} Ian ${entry.layer_id} entry effect is unsupported`);
          }
        });
      }
      return {
        shot_id: shot.shot_id,
        storyboard_scene_plan_sha256: storyboardScenePlanSha256,
        package_manifest: structuredClone(manifestBinding),
        package: packageValue,
        render_assets: structuredClone(renderAssets),
        entry_effects: entryEffects,
      };
    });
  return {
    contract_version: 'ian-layered-scene-consumption-evidence-v1',
    result: 'pass',
    records,
  };
};

export const validateIanLayeredSceneEvidence = ({evidence, input}) => {
  const expectedShotIds = input.shots
    .filter((shot) => shot.visual_generation_route === IAN_ROUTE && !isFlipbookRow(shot))
    .map((shot) => shot.shot_id);
  if (evidence?.contract_version !== 'ian-layered-scene-consumption-evidence-v1'
    || evidence.result !== 'pass'
    || !Array.isArray(evidence.records)
    || JSON.stringify(evidence.records.map((record) => record?.shot_id))
      !== JSON.stringify(expectedShotIds)) {
    throw new Error('Ian layered-scene evidence does not cover the ordered active Ian shots');
  }
  if (evidence.records.some((record) => (
    !SHA256.test(record?.storyboard_scene_plan_sha256 ?? '')
    || record.storyboard_scene_plan_sha256 !== record.package?.scene_plan_sha256
  ))) {
    throw new Error('Ian layered-scene evidence has a stale storyboard scene-plan binding');
  }
  return {
    contract_version: 'ian-layered-scene-consumption-evidence-v1',
    result: 'pass',
    shot_ids: expectedShotIds,
    records: structuredClone(evidence.records),
  };
};

const extendFirstSceneToFrameZero = (scene, leadInFrames) => {
  if (leadInFrames === 0) return scene;
  if (scene.start_frame !== leadInFrames || scene.shot_id !== 'S01') {
    throw new Error('legacy first-shot lead-in must end exactly where S01 begins');
  }
  if (scene.ian_layered_scene || scene.whiteboard || scene.local_video
    || !Array.isArray(scene.image_sequence) || scene.image_sequence.length === 0) {
    throw new Error('legacy first-shot lead-in migration requires an approved raster state family');
  }
  const extendOccurrence = (occurrence, index, recordSemanticReason = false) => index === 0
    ? {
        ...occurrence,
        end_frame: occurrence.end_frame + leadInFrames,
        duration_in_frames: occurrence.duration_in_frames + leadInFrames,
        clean_hold_in_frames: occurrence.clean_hold_in_frames + leadInFrames,
        ...(recordSemanticReason && !occurrence.semantic_hold_reason ? {
          semantic_hold_reason: 'approved S01 state replaces the retired fixed opening cover',
        } : {}),
      }
    : {
        ...occurrence,
        at_frame: occurrence.at_frame + leadInFrames,
        end_frame: occurrence.end_frame + leadInFrames,
      };
  const shiftTransition = (transition) => ({
    ...transition,
    at_frame: transition.at_frame + leadInFrames,
  });
  const imageSequence = scene.image_sequence.map((image, index) => index === 0
    ? {...image, duration_in_frames: image.duration_in_frames + leadInFrames}
    : {...image, from: image.from + leadInFrames});
  const intraShotTransitions = scene.intra_shot_transitions.map(shiftTransition);
  const actionStateSchedule = scene.action_state_schedule ? {
    ...scene.action_state_schedule,
    total_frames: scene.action_state_schedule.total_frames + leadInFrames,
    shot_start_frame: 0,
    cadence_advisory: calculateActionStateCadenceAdvisory(
      scene.action_state_schedule.total_frames + leadInFrames,
    ),
    occurrences: scene.action_state_schedule.occurrences
      .map((occurrence, index) => extendOccurrence(occurrence, index, true)),
    occurrence_asset_bindings: scene.action_state_schedule.occurrence_asset_bindings?.map(extendOccurrence),
    intra_shot_transitions: scene.action_state_schedule.intra_shot_transitions.map(shiftTransition),
  } : null;
  if (actionStateSchedule) {
    actionStateSchedule.validation = validateActionStateSchedule(actionStateSchedule, {
      totalFrames: scene.duration_frames + leadInFrames,
      fps: actionStateSchedule.fps,
      densityMode: actionStateSchedule.density_mode ?? null,
      densitySelectionSha256: actionStateSchedule.visual_density_selection_sha256 ?? null,
    });
  }
  return {
    ...scene,
    start_frame: 0,
    duration_frames: scene.duration_frames + leadInFrames,
    image_sequence: imageSequence,
    intra_shot_transitions: intraShotTransitions,
    ...(actionStateSchedule ? {action_state_schedule: actionStateSchedule} : {}),
    legacy_first_shot_lead_in: {
      contract_version: 'legacy-first-shot-approved-state-hold-v1',
      duration_frames: leadInFrames,
      source_asset_id: imageSequence[0].asset_id,
      source_asset_checksum_sha256: imageSequence[0].checksum_sha256 ?? null,
      image_regeneration: false,
    },
  };
};

export const buildKnowledgeVideoAssemblyPlan = (input, options = {}) => {
  if (!input || typeof input !== 'object') throw new Error('assembly input object required');
  const fps = requireInteger(input.fps, 'fps', 1);
  if (fps !== 30) throw new Error('knowledge-video assembly requires 30 fps');
  const narrationFrames = requireInteger(input.narrationFrames, 'narrationFrames', 1);
  const revoiceVariant = input.resumeMode === 'revoice_variant';
  if (input.timeline?.contractVersion !== 'direct-first-shot-v1'
    || input.timeline?.narrationStartFrame !== 0
    || input.timeline?.firstShotId !== 'S01') {
    throw new Error('assembly input must declare direct-first-shot-v1 at frame zero');
  }
  const firstSentenceEndFrame = requireInteger(
    input.timeline.firstSentenceEndFrame,
    'timeline.firstSentenceEndFrame',
    1,
  );
  if (firstSentenceEndFrame >= narrationFrames) throw new Error('first sentence must end before narration master');
  const legacyFirstShotLeadInFrames = requireInteger(
    input.timeline.legacyFirstShotLeadInFrames ?? 0,
    'timeline.legacyFirstShotLeadInFrames',
  );
  if (typeof input.narrationAsset !== 'string' || input.narrationAsset === '') {
    throw new Error('narrationAsset is required');
  }
  const sharedReuseDecision = (options.verifySharedReuseEvidence ?? verifySharedReuseEvidence)(input);
  if (sharedReuseDecision?.validation_phase !== 'consumption' || sharedReuseDecision?.result !== 'pass') {
    throw new Error('passing shared reuse consumption evidence is required');
  }
  if (!Array.isArray(input.shots) || input.shots.length === 0) throw new Error('shots are required');
  const visualDirectionEvidence = (
    options.verifyVisualDirectionReviewEvidence ?? verifyVisualDirectionReviewEvidence
  )(input);
  if (!visualDirectionEvidence?.review
    || typeof visualDirectionEvidence?.path !== 'string'
    || !SHA256.test(visualDirectionEvidence?.checksum_sha256 ?? '')) {
    throw new Error('passing visual direction review artifact evidence is required');
  }
  const visualDirectionReview = visualDirectionEvidence.review;
  const visualDirectionArtifactPolicy = validateVisualDirectionArtifactPolicy(
    visualDirectionReview,
    input.visualDirectionArtifactPolicy,
  );
  const visualDirectionValidation = validateVisualDirectionReview(visualDirectionReview, {
    shots: input.shots,
  });
  input.shots.forEach((shot, index) => {
    const expectedStart = index === 0 ? legacyFirstShotLeadInFrames : input.shots[index - 1].end_frame;
    if (shot.start_frame !== expectedStart) throw new Error('narration-bound shots must be consecutive');
  });
  if (input.shots.at(-1).end_frame !== narrationFrames) {
    throw new Error('shots must end at narrationFrames');
  }
  const requireV3Contracts = visualDirectionReview.contract_version === 'per-shot-visual-direction-review-v3';
  const visualRhythmEvidence = requireV3Contracts
    ? (options.verifyStoryboardVisualRhythmEvidence ?? verifyStoryboardVisualRhythmEvidence)(input)
    : null;
  if (requireV3Contracts) {
    if (visualRhythmEvidence?.validation?.result !== 'pass'
      || visualRhythmEvidence.artifact?.visual_direction_review?.path !== visualDirectionEvidence.path
      || visualRhythmEvidence.artifact?.visual_direction_review?.checksum_sha256
        !== visualDirectionEvidence.checksum_sha256
      || visualRhythmEvidence.artifact?.storyboard?.path !== visualDirectionReview.storyboard?.path
      || visualRhythmEvidence.artifact?.storyboard?.checksum_sha256
        !== visualDirectionReview.storyboard?.checksum_sha256) {
      throw new Error('approved storyboard visual rhythm evidence is missing or stale');
    }
    input.shots.forEach((shot, index) => {
      if (visualRhythmEvidence.artifact.shots[index]?.motion_tier !== shot.motion_tier) {
        throw new Error(`${shot.shot_id} motion tier differs from the approved visual rhythm map`);
      }
    });
  }
  const expectedActionScheduleVersion = visualRhythmEvidence?.artifact?.contract_version
    === 'storyboard-visual-rhythm-v2'
    ? ACTION_STATE_SCHEDULE_V4_VERSION
    : ACTION_STATE_SCHEDULE_V3_VERSION;
  let workflowApprovalValidation = null;
  if (expectedActionScheduleVersion === ACTION_STATE_SCHEDULE_V4_VERSION) {
    const workflow = input.workflowApproval;
    if (!workflow || typeof workflow !== 'object') {
      throw new Error('new storyboard assembly requires workflow approval selection evidence');
    }
    workflowApprovalValidation = workflow.legacyStylelessCompatibility === true
      ? validateLegacyStylelessApprovalSelectionSequence({
          gate2ScriptSha256: workflow.gate2ScriptSha256,
          density: workflow.density,
          mode: workflow.mode,
          policy: workflow.policy ?? null,
        })
      : validateApprovalSelectionSequence({
          gate2ScriptSha256: workflow.gate2ScriptSha256,
          whiteCatStyle: workflow.whiteCatStyle,
          density: workflow.density,
          mode: workflow.mode,
          policy: workflow.policy ?? null,
        });
    const styleBinding = visualDirectionReview.white_cat_visual_style_binding;
    if (workflow.legacyStylelessCompatibility === true) {
      if (styleBinding !== null && styleBinding !== undefined) {
        throw new Error('legacy styleless workflow cannot carry a visual-direction style binding');
      }
    } else if (!styleBinding
      || styleBinding.style_id !== workflow.whiteCatStyle.style_id
      || styleBinding.treatment_profile_id !== workflow.whiteCatStyle.treatment_profile_id
      || styleBinding.visual_cohesion_profile_id
        !== workflow.whiteCatStyle.visual_cohesion_profile_id
      || styleBinding.selection_sha256 !== workflow.whiteCatStyle.selection_sha256) {
        throw new Error('workflow white-cat style selection differs from visual direction binding');
    }
    if (workflow.density.selection_sha256
      !== visualRhythmEvidence.artifact.visual_density_selection_sha256
      || workflow.density.density_mode !== visualRhythmEvidence.artifact.density_mode) {
      throw new Error('workflow density selection differs from storyboard visual rhythm');
    }
    if (workflow.mode.approval_mode === 'one_click') {
      assertOneClickProtectedActionAllowed({
        phase: workflow.phase,
        captionDelivery: workflow.captionDelivery,
        visualReview: workflow.visualReview,
      }, 'composition');
    }
  }
  const flipbook = isFlipbookStyle(input.workflowApproval?.whiteCatStyle);
  if (input.shots.some((shot) => isFlipbookRow(shot) !== flipbook)) {
    throw new Error('flipbook shot mode must equal the episode-wide approved style selection');
  }
  if (flipbook && (!requireV3Contracts || legacyFirstShotLeadInFrames !== 0)) {
    throw new Error('flipbook requires current v3 direction and a direct frame-zero start');
  }
  const transitionContract = requireV3Contracts ? 'scene-transition-v3' : 'scene-transition-v2';
  const transitionCatalog = requireV3Contracts ? 'scene-transition-catalog-v3' : 'scene-transition-catalog-v2';
  if (requireV3Contracts && input.ianInternalMotionPolicy !== undefined) {
    throw new Error('Ian internal-motion policies are retired; rebuild Ian as layered scene packages');
  }
  const ianLayeredSceneEvidence = requireV3Contracts
    ? validateIanLayeredSceneEvidence({
        evidence: (
          options.verifyIanLayeredScenePackageEvidence
          ?? verifyIanLayeredScenePackageEvidence
        )(input),
        input,
      })
    : null;
  const ianLayeredSceneByShot = new Map(
    (ianLayeredSceneEvidence?.records ?? []).map((record) => [record.shot_id, record]),
  );
  const sourceScenes = input.shots.map((shot, index) => buildScene(
    shot,
    index,
    input.shots,
    fps,
    requireV3Contracts,
    revoiceVariant,
    visualRhythmEvidence?.artifact?.presented_map_sha256 ?? null,
    expectedActionScheduleVersion,
    ianLayeredSceneByShot.get(shot.shot_id) ?? null,
  ));
  if (requireV3Contracts) {
    sourceScenes.forEach((scene, index) => {
      const rhythmShot = visualRhythmEvidence.artifact.shots[index];
      if (scene.visual_generation_route === IAN_ROUTE && !isFlipbookRow(scene)) {
        const layeredEvidence = ianLayeredSceneByShot.get(scene.shot_id);
        validateIanLayeredSceneRhythmBinding(layeredEvidence.package.scene_plan, {
          shotStartFrame: scene.start_frame,
          rhythmShot,
        });
      }
      const expectedAssetCount = scene.motion_tier === 'hero_pose'
        ? rhythmShot.asset_plan.pose_count
        : rhythmShot.asset_plan.main_image_count;
      const actualTransitionPlan = scene.intra_shot_transitions.map((transition) => ({
        from_asset_id: transition.from_asset_id,
        to_asset_id: transition.to_asset_id,
        kind: transition.kind,
      }));
      const approvedTransitionPlan = rhythmShot.intra_shot_transition_plan.map((transition) => ({
        from_asset_id: transition.from_asset_id,
        to_asset_id: transition.to_asset_id,
        kind: transition.kind,
      }));
      if (!['srt-whiteboard-animation', LOCAL_VIDEO_ROUTE].includes(scene.visual_generation_route)
        && scene.image_sequence.length !== expectedAssetCount) {
        throw new Error(`${scene.shot_id} asset count differs from the approved visual rhythm map`);
      }
      if (JSON.stringify(actualTransitionPlan) !== JSON.stringify(approvedTransitionPlan)) {
        throw new Error(`${scene.shot_id} intra-shot effects differ from the approved visual rhythm map`);
      }
    });
  }
  const scenes = sourceScenes.map((scene, index) => index === 0
    ? extendFirstSceneToFrameZero(scene, legacyFirstShotLeadInFrames)
    : scene);
  const transitionSelectionReview = input.transitionSelectionReview;
  if (transitionSelectionReview?.status !== 'approved'
    || transitionSelectionReview?.catalog_version !== transitionCatalog
    || typeof transitionSelectionReview?.path !== 'string'
    || !transitionSelectionReview.path.startsWith(`${input.episodeWorkspace}/schema/`)
    || !SHA256.test(transitionSelectionReview?.checksum_sha256 ?? '')
    || !SHA256.test(transitionSelectionReview?.presented_map_sha256 ?? '')
    || transitionSelectionReview?.ordinary_boundary_count !== Math.max(0, scenes.length - 1)) {
    throw new Error('passing transition selection review is required');
  }
  for (const scene of scenes.slice(0, -1)) {
    if (scene.transition.contract_version !== transitionContract) {
      throw new Error(`transition contract does not match the active visual-direction contract: ${scene.shot_id}`);
    }
    if (scene.transition.user_selection.presented_map_sha256
      !== transitionSelectionReview.presented_map_sha256) {
      throw new Error(`transition review checksum mismatch: ${scene.shot_id}`);
    }
  }
  const expectedSoundDesignBindings = requireV3Contracts
    ? buildExpectedSoundDesignBindings(input, visualRhythmEvidence)
    : null;
  const soundDesignEvidence = requireV3Contracts
    ? validateSoundDesignEvidence({
        evidence: (options.verifySoundDesignEvidence ?? verifySoundDesignEvidence)(input, {
          shots: scenes,
          durationFrames: narrationFrames,
          expectedBindings: expectedSoundDesignBindings,
        }),
        input,
        expectedBindings: expectedSoundDesignBindings,
        revoiceVariant,
      })
    : null;
  return {
    schema_version: requireV3Contracts
      ? 'knowledge-video-assembly-plan-v3'
      : 'knowledge-video-assembly-plan-v2',
    episode_id: input.episodeId,
    ...(flipbook ? {presentation_mode: FLIPBOOK_STYLE_ID, render_backend: 'codex-browser-flipbook'} : {}),
    canvas: {width: 1920, height: 1080, fps, aspect: '16:9'},
    full_master_frames: narrationFrames,
    narration_frames: narrationFrames,
    timeline: {
      contract_version: 'direct-first-shot-v1',
      fixed_opening_cover: false,
      first_shot_id: 'S01',
      first_shot_start_frame: 0,
      first_sentence_end_frame: firstSentenceEndFrame,
      narration_start_frame: 0,
      narration_master_frames: narrationFrames,
      final_master_frames: narrationFrames,
      legacy_first_shot_lead_in_frames: legacyFirstShotLeadInFrames,
      publishing_cover_timeline_consumed: false,
    },
    narration_asset: input.narrationAsset,
    captions: input.captions ?? {mode: 'caption-neutral-base', cues: []},
    bgm: input.bgm ?? {mode: 'disabled', source: null, track: null},
    ...(soundDesignEvidence === null ? {} : {
      sound_effects: {
        contract_version: soundDesignEvidence.contract_version
          === 'knowledge-video-sound-design-validation-v2'
          ? 'knowledge-video-sound-effect-track-v2'
          : 'knowledge-video-sound-effect-track-v1',
        resume_mode: soundDesignEvidence.resume_mode,
        design: {
          path: soundDesignEvidence.path,
          checksum_sha256: soundDesignEvidence.checksum_sha256,
          event_map_sha256: soundDesignEvidence.event_map_sha256,
        },
        library: structuredClone(soundDesignEvidence.bindings.sound_effect_library),
        policy: soundDesignEvidence.bindings.sound_design_policy == null
          ? null
          : structuredClone(soundDesignEvidence.bindings.sound_design_policy),
        narration_gain: 1,
        normalization: 'disabled',
        peak_ceiling_dbfs: -1,
        overflow_action: 'lower-sfx-bus-uniformly',
        audio_preflight_policy: 'required-before-first-full-render-v1',
        bus_gain_multiplier: soundDesignEvidence.bus_gain_multiplier,
        cues: structuredClone(soundDesignEvidence.audible_cues),
      },
    }),
    scenes,
    qa_contract: {
      shared_reuse_decision: sharedReuseDecision,
      scene_routing_contract: {
        'per-shot-visual-direction-review-v1': 'explicit-visual-generation-route-v1',
        'per-shot-visual-direction-review-v2': 'explicit-visual-generation-route-v2',
        'per-shot-visual-direction-review-v3': 'explicit-visual-generation-route-v3',
      }[visualDirectionReview.contract_version],
      visual_direction_review: {
        ...visualDirectionValidation,
        path: visualDirectionEvidence.path,
        checksum_sha256: visualDirectionEvidence.checksum_sha256,
        storyboard: visualDirectionReview.storyboard,
      },
      visual_direction_artifact_policy: visualDirectionArtifactPolicy,
      scene_transition_contract: transitionContract,
      transition_selection_review: transitionSelectionReview,
      storyboard_visual_rhythm: visualRhythmEvidence === null ? null : {
        path: visualRhythmEvidence.path,
        checksum_sha256: visualRhythmEvidence.checksum_sha256,
        ...visualRhythmEvidence.validation,
      },
      workflow_approval: workflowApprovalValidation,
      ian_layered_scene_packages: ianLayeredSceneEvidence,
      sound_design: soundDesignEvidence,
      intra_shot_transition_contract: requireV3Contracts
        ? INTRA_SHOT_TRANSITION_VERSION
        : INTRA_SHOT_WATERCOLOR_BLOOM_RULE_ID,
      whiteboard_scene_contract: 'whiteboard-scene-v1',
      whiteboard_action_family_exemption: 'whiteboard-element-sequence-replaces-action-family-v1',
      local_video_scene_contract: 'local-video-match-v1',
      local_video_action_family_exemption: 'local-video-source-replaces-image-action-family-v1',
      comic_scene_contract: 'comic-scene-v1',
      revoice_transition_lock: revoiceVariant ? 'strict-parent-transition-v1' : null,
      ordinary_boundaries_with_transition_decisions: Math.max(0, scenes.length - 1),
      ordinary_boundaries_with_animated_transitions: scenes.slice(0, -1)
        .filter((scene) => scene.transition.kind !== 'cut').length,
      ordinary_boundaries_with_cuts: scenes.slice(0, -1)
        .filter((scene) => scene.transition.kind === 'cut').length,
      opening_hard_cut_exceptions: [],
    },
  };
};

const main = () => {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) {
    throw new Error('usage: build-assembly-plan.mjs <assembly-input.json> <assembly-plan.json>');
  }
  atomicWriteJson(outputPath, buildKnowledgeVideoAssemblyPlan(readJson(inputPath)));
  process.stdout.write(`${path.resolve(outputPath)}\n`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
