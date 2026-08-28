import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {loadAndValidateSharedSoundEffectLibrary} from './contract.mjs';

export const KNOWLEDGE_VIDEO_SOUND_DESIGN_VERSION = 'knowledge-video-sound-design-v1';
export const GLOBAL_SOUND_EFFECT_RENDER_OWNER = 'global_sound_effect_track_v1';
export const IAN_SOUND_EFFECT_RENDER_OWNER = 'ian_layered_scene';

const SHA256 = /^[a-f0-9]{64}$/;
const POLICY = Object.freeze({
  non_ian_max_cues_per_shot: 2,
  strong_min_gap_frames: 30,
  generic_ian_conflict_window_frames: 12,
  narration_gain: 1,
  normalization: 'disabled',
  runtime_audio_transform: 'forbidden',
});

const REVOICE_RETIMER_VERSION = 'sound-design-revoice-retime-v1';
const AUDIBLE_SEMANTIC_ANCHORS = new Set([
  'visible-action',
  'visible-reveal',
  'visible-feedback',
  'visible-emphasis',
  'visible-transition',
  'local-video-visible-action',
]);

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
};

const sha256Canonical = (value) => crypto
  .createHash('sha256')
  .update(JSON.stringify(canonicalize(value)))
  .digest('hex');

const sha256File = (filePath) => crypto
  .createHash('sha256')
  .update(fs.readFileSync(filePath))
  .digest('hex');

const fail = (message) => {
  throw new Error(message);
};

const rootRelative = (repositoryRoot, value, label) => {
  if (typeof value !== 'string' || value === '' || path.isAbsolute(value)
      || value.replaceAll('\\', '/').split('/').includes('..')) {
    fail(`${label} must be repository-root-relative`);
  }
  const resolved = path.resolve(repositoryRoot, value);
  const relative = path.relative(repositoryRoot, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    fail(`${label} escapes repository`);
  }
  return resolved;
};

const requireBinding = (value, label) => {
  if (typeof value?.path !== 'string' || !SHA256.test(value?.checksum_sha256 ?? '')) {
    fail(`${label} binding is invalid`);
  }
  return {path: value.path, checksum_sha256: value.checksum_sha256};
};

const transitionFrame = (shot) => shot.transition?.kind === 'cut'
  ? Math.max(shot.start_frame, shot.end_frame - 1)
  : Math.max(shot.start_frame, shot.end_frame - (shot.transition?.duration_in_frames ?? 0));

export const deriveSoundDesignCandidateEvents = (shots) => {
  if (!Array.isArray(shots) || shots.length === 0) fail('sound-design shots are required');
  const events = [];
  for (const shot of shots) {
    const add = (suffix, anchorKind, cueFrame, details = {}) => events.push({
      event_id: `${shot.shot_id}:${suffix}`,
      shot_id: shot.shot_id,
      anchor_kind: anchorKind,
      cue_frame: cueFrame,
      candidate_source: 'mechanical',
      ...details,
    });
    add('shot-start', 'shot-start', shot.start_frame);
    for (const occurrence of shot.action_state_schedule?.occurrences ?? []) {
      add(
        `action-state:${occurrence.state_id}`,
        'action-state-entry',
        shot.start_frame + occurrence.at_frame,
      );
    }
    for (const transition of shot.intra_shot_transitions ?? []) {
      add(
        `intra-transition:${transition.from_asset_id}:${transition.to_asset_id}`,
        'intra-shot-transition',
        shot.start_frame + transition.at_frame,
        {transition_kind: transition.kind},
      );
    }
    for (const [position, segment] of (shot.whiteboard?.timing_segments ?? []).entries()) {
      add(
        `whiteboard-segment:${position + 1}`,
        'whiteboard-segment',
        shot.start_frame + segment.output_start_frame,
      );
    }
    for (const entry of shot.ian_layered_scene?.entry_effects?.layers ?? []) {
      add(
        `ian-layer:${entry.layer_id}`,
        'ian-layer-entry',
        shot.start_frame + entry.entry_frame,
        {ian_layer_id: entry.layer_id},
      );
    }
    if (shot.transition !== null && shot.transition !== undefined) {
      add('outgoing-transition', 'inter-shot-transition', transitionFrame(shot), {
        transition_kind: shot.transition.kind,
      });
    }
  }
  return events;
};

export const buildSoundDesignMapSha256 = (value) => {
  const copy = structuredClone(value);
  delete copy.event_map_sha256;
  delete copy.result;
  return sha256Canonical(copy);
};

const probeDerivedWav = (filePath, label) => {
  const probe = spawnSync('ffprobe', [
    '-v', 'error', '-select_streams', 'a:0',
    '-show_entries', 'stream=codec_name,sample_rate,channels', '-of', 'json', filePath,
  ], {encoding: 'utf8'});
  if (probe.status !== 0) fail(`${label} ffprobe failed`);
  const stream = JSON.parse(probe.stdout).streams?.[0];
  if (stream?.codec_name !== 'pcm_s16le' || Number(stream.sample_rate) !== 44100
      || Number(stream.channels) !== 2) {
    fail(`${label} must be pre-trimmed stereo 44.1 kHz pcm_s16le WAV`);
  }
};

const validateAudibleEvent = ({
  event,
  expected,
  shot,
  libraryAssets,
  repositoryRoot,
  episodeWorkspace,
  durationFrames,
  verifyFiles,
}) => {
  if (typeof event.semantic_role !== 'string' || event.semantic_role === ''
      || !['micro', 'strong'].includes(event.intensity)
      || ![GLOBAL_SOUND_EFFECT_RENDER_OWNER, IAN_SOUND_EFFECT_RENDER_OWNER]
        .includes(event.render_owner)
      || typeof event.reason !== 'string' || event.reason === ''
      || typeof event.gain_multiplier !== 'number' || event.gain_multiplier <= 0
      || event.gain_multiplier > 1 || event.qa_result !== 'pass') {
    fail(`${event.event_id} audible decision is incomplete`);
  }
  if (event.cue_frame < shot.start_frame || event.cue_frame >= shot.end_frame) {
    fail(`${event.event_id} cue frame is outside its shot`);
  }
  if (expected && event.cue_frame !== expected.cue_frame) {
    fail(`${event.event_id} cue frame differs from its mechanical anchor`);
  }
  if (event.anchor_kind === 'ian-layer-entry'
      ? event.render_owner !== IAN_SOUND_EFFECT_RENDER_OWNER
      : event.render_owner !== GLOBAL_SOUND_EFFECT_RENDER_OWNER) {
    fail(`${event.event_id} render owner is invalid`);
  }
  const source = event.source;
  const asset = libraryAssets.find(({asset_id}) => asset_id === source?.asset_id);
  if (!asset || source.path !== asset.path || source.checksum_sha256 !== asset.checksum_sha256
      || !asset.semantic_roles.includes(event.semantic_role)
      || source.provider !== asset.provider || source.source_item_url !== asset.source_item_url
      || source.license_url !== asset.license_url) {
    fail(`${event.event_id} source differs from the active semantic library`);
  }
  const derived = event.derived_asset;
  if (typeof derived?.path !== 'string' || typeof derived?.asset !== 'string'
      || !SHA256.test(derived?.checksum_sha256 ?? '')
      || derived.sample_rate_hz !== 44100 || derived.channels !== 2
      || derived.format !== 'wav'
      || !Number.isInteger(derived.source_sample_rate_hz)
      || derived.source_sample_rate_hz <= 0
      || !Number.isInteger(derived.trim_start_sample) || derived.trim_start_sample < 0
      || !Number.isInteger(derived.trim_end_sample)
      || derived.trim_end_sample <= derived.trim_start_sample
      || !Number.isInteger(derived.duration_in_frames)
      || derived.duration_in_frames !== Math.ceil(
        ((derived.trim_end_sample - derived.trim_start_sample)
          / derived.source_sample_rate_hz) * 30,
      )
      || event.cue_frame + derived.duration_in_frames > durationFrames
      || derived.runtime_transform !== 'forbidden'
      || !derived.path.startsWith(`${episodeWorkspace}/assets/audio/sfx/`)
      || derived.asset !== derived.path.replace(/^leverage-video\/src\//, '')) {
    fail(`${event.event_id} derived WAV binding is invalid`);
  }
  if (verifyFiles) {
    const derivedPath = rootRelative(repositoryRoot, derived.path, `${event.event_id}.derived.path`);
    const status = fs.lstatSync(derivedPath);
    if (!status.isFile() || status.isSymbolicLink()
        || sha256File(derivedPath) !== derived.checksum_sha256) {
      fail(`${event.event_id} derived WAV bytes are missing or stale`);
    }
    probeDerivedWav(derivedPath, event.event_id);
  }
};

export const validateKnowledgeVideoSoundDesign = (value, {
  shots,
  durationFrames,
  episodeWorkspace,
  repositoryRoot,
  libraryValidation,
  expectedBindings = null,
  verifyFiles = true,
  revoiceVariant = false,
  parentDesign = null,
} = {}) => {
  if (value?.contract_version !== KNOWLEDGE_VIDEO_SOUND_DESIGN_VERSION
      || value.status !== 'qa_passed'
      || value.resume_mode !== (revoiceVariant ? 'revoice_variant' : 'standard')
      || value.fps !== 30 || value.duration_frames !== durationFrames
      || value.episode_workspace !== episodeWorkspace
      || JSON.stringify(value.policy) !== JSON.stringify(POLICY)
      || typeof value.bus_gain_multiplier !== 'number'
      || value.bus_gain_multiplier <= 0 || value.bus_gain_multiplier > 1
      || !Array.isArray(value.events) || !Array.isArray(value.shot_analysis)) {
    fail('knowledge-video sound design header or policy is invalid');
  }
  if (!revoiceVariant) {
    if (value.revoice !== null) fail('standard sound design must not carry revoice evidence');
  } else if (value.revoice?.contract_version !== REVOICE_RETIMER_VERSION
      || value.revoice.reanalysis !== false
      || value.revoice.downloaded_new_assets !== false
      || !Array.isArray(value.revoice.added_event_ids)
      || value.revoice.added_event_ids.length !== 0) {
    fail('revoice sound design must be an exact retiming-only variant');
  }
  const bindings = Object.fromEntries(Object.entries(value.bindings ?? {}).map(
    ([key, binding]) => [key, requireBinding(binding, `bindings.${key}`)],
  ));
  const requiredBindings = [
    'storyboard', 'narration_master', 'visual_manifest', 'visual_rhythm',
    'transition_review', 'sound_effect_library',
  ];
  if (JSON.stringify(Object.keys(bindings).sort()) !== JSON.stringify(requiredBindings.sort())) {
    fail('knowledge-video sound design bindings are incomplete');
  }
  if (expectedBindings) {
    for (const key of requiredBindings) {
      if (JSON.stringify(bindings[key]) !== JSON.stringify(expectedBindings[key])) {
        fail(`sound design binding is stale: ${key}`);
      }
    }
  }
  if (bindings.sound_effect_library.path !== libraryValidation.manifest.path
      || bindings.sound_effect_library.checksum_sha256 !== libraryValidation.manifest.checksum_sha256
      || libraryValidation.manifest.path !== libraryValidation.index?.active_manifest?.path
      || libraryValidation.manifest.checksum_sha256
        !== libraryValidation.index?.active_manifest?.checksum_sha256) {
    fail('sound design library binding is stale');
  }
  const expectedEvents = deriveSoundDesignCandidateEvents(shots);
  const expectedById = new Map(expectedEvents.map((event) => [event.event_id, event]));
  const actualById = new Map();
  const shotsById = new Map(shots.map((shot) => [shot.shot_id, shot]));
  for (const event of value.events) {
    if (typeof event?.event_id !== 'string' || actualById.has(event.event_id)
        || typeof event.reason !== 'string' || event.reason === ''
        || !['audible', 'silent'].includes(event.decision)) {
      fail('sound-design event identity or decision is invalid');
    }
    const expected = expectedById.get(event.event_id);
    const semantic = event.candidate_source === 'semantic'
      && event.event_id.startsWith(`${event.shot_id}:semantic:`);
    if (!expected && !semantic) fail(`unexpected sound-design event: ${event.event_id}`);
    if (expected && (event.shot_id !== expected.shot_id
        || event.anchor_kind !== expected.anchor_kind
        || event.candidate_source !== 'mechanical'
        || event.cue_frame !== expected.cue_frame)) {
      fail(`${event.event_id} differs from the mechanical candidate`);
    }
    const shot = shotsById.get(event.shot_id);
    if (!shot) fail(`${event.event_id} references an unknown shot`);
    if (!Number.isInteger(event.cue_frame)
        || event.cue_frame < shot.start_frame || event.cue_frame >= shot.end_frame) {
      fail(`${event.event_id} candidate frame is outside its shot`);
    }
    if (semantic && !AUDIBLE_SEMANTIC_ANCHORS.has(event.anchor_kind)) {
      fail(`${event.event_id} is not a visible semantic event`);
    }
    if (event.decision === 'silent') {
      if (event.semantic_role !== null || event.intensity !== null || event.render_owner !== null
          || event.source !== null || event.derived_asset !== null
          || event.gain_multiplier !== null || event.qa_result !== null) {
        fail(`${event.event_id} silent decision carries audible fields`);
      }
    } else {
      if (event.anchor_kind === 'shot-start') {
        fail(`${event.event_id} bare shot start cannot be audible`);
      }
      if (['inter-shot-transition', 'intra-shot-transition'].includes(event.anchor_kind)
          && event.transition_kind === 'cut') {
        fail(`${event.event_id} ordinary cut cannot be audible`);
      }
      validateAudibleEvent({
        event,
        expected,
        shot,
        libraryAssets: libraryValidation.assets,
        repositoryRoot,
        episodeWorkspace,
        durationFrames,
        verifyFiles,
      });
    }
    actualById.set(event.event_id, event);
  }
  for (const expected of expectedEvents) {
    if (!actualById.has(expected.event_id)) fail(`missing sound-design candidate: ${expected.event_id}`);
  }
  if (value.shot_analysis.length !== shots.length) {
    fail('sound design must analyze every shot exactly once');
  }
  for (const [index, shot] of shots.entries()) {
    const analysis = value.shot_analysis[index];
    const expectedLocalVideoStatus = shot.local_video == null ? 'not_applicable' : 'complete';
    const eventIds = value.events.filter(({shot_id: shotId}) => shotId === shot.shot_id)
      .map(({event_id: eventId}) => eventId);
    if (analysis?.shot_id !== shot.shot_id
        || analysis.storyboard_content_analyzed !== true
        || analysis.visible_action_analysis !== 'complete'
        || analysis.local_video_action_analysis !== expectedLocalVideoStatus
        || JSON.stringify(analysis.candidate_event_ids) !== JSON.stringify(eventIds)) {
      fail(`${shot.shot_id} sound-design analysis coverage is incomplete`);
    }
    if (shot.local_video != null && !(revoiceVariant && parentDesign === null)
        && !value.events.some((event) => (
      event.shot_id === shot.shot_id
      && event.candidate_source === 'semantic'
      && event.anchor_kind === 'local-video-visible-action'
    ))) {
      fail(`${shot.shot_id} local-video visible actions were not analyzed`);
    }
  }
  for (const shot of shots) {
    for (const entry of shot.ian_layered_scene?.entry_effects?.layers ?? []) {
      const event = actualById.get(`${shot.shot_id}:ian-layer:${entry.layer_id}`);
      const cue = entry.sound_effect;
      if (cue === null && event?.decision !== 'silent') {
        fail(`${event?.event_id ?? entry.layer_id} must preserve the silent Ian entry decision`);
      }
      if (cue !== null && (event?.decision !== 'audible'
          || event.semantic_role !== cue.role
          || event.reason !== cue.selection_reason
          || event.gain_multiplier !== cue.gain_multiplier
          || event.source?.asset_id !== cue.source.asset_id
          || event.source?.path !== cue.source.path
          || event.source?.checksum_sha256 !== cue.source.checksum_sha256
          || event.derived_asset?.trim_start_sample !== cue.source.trim_start_sample
          || event.derived_asset?.trim_end_sample !== cue.source.trim_end_sample_exclusive
          || event.derived_asset?.asset !== cue.derived_asset.asset
          || event.derived_asset?.checksum_sha256 !== cue.derived_asset.checksum_sha256
          || event.derived_asset?.sample_rate_hz !== cue.derived_asset.sample_rate_hz
          || event.derived_asset?.channels !== cue.derived_asset.channels)) {
        fail(`${event?.event_id ?? entry.layer_id} differs from the Ian-owned sound-effect cue`);
      }
    }
  }
  for (const shot of shots) {
    const nonIanAudible = value.events.filter((event) => event.shot_id === shot.shot_id
      && event.decision === 'audible' && event.render_owner === GLOBAL_SOUND_EFFECT_RENDER_OWNER);
    if (nonIanAudible.length > POLICY.non_ian_max_cues_per_shot) {
      fail(`${shot.shot_id} has too many non-Ian cues`);
    }
  }
  const cueKeys = new Set();
  for (const event of value.events.filter(({decision}) => decision === 'audible')) {
    const cueKey = `${event.render_owner}:${event.cue_frame}:${event.source.asset_id}`;
    if (cueKeys.has(cueKey)) fail(`${event.event_id} duplicates an audible cue`);
    cueKeys.add(cueKey);
  }
  const strongFrames = value.events.filter((event) => event.decision === 'audible'
    && event.intensity === 'strong').map(({cue_frame}) => cue_frame).sort((a, b) => a - b);
  if (strongFrames.some((frame, index) => index > 0
      && frame - strongFrames[index - 1] < POLICY.strong_min_gap_frames)) {
    fail('strong sound-effect cues are too dense');
  }
  const ianFrames = value.events.filter((event) => event.decision === 'audible'
    && event.render_owner === IAN_SOUND_EFFECT_RENDER_OWNER).map(({cue_frame}) => cue_frame);
  const genericConflict = value.events.find((event) => event.decision === 'audible'
    && event.render_owner === GLOBAL_SOUND_EFFECT_RENDER_OWNER
    && ianFrames.some((frame) => Math.abs(frame - event.cue_frame)
      < POLICY.generic_ian_conflict_window_frames));
  if (genericConflict) fail(`${genericConflict.event_id} conflicts with an Ian cue`);
  if (!SHA256.test(value.event_map_sha256 ?? '')
      || value.event_map_sha256 !== buildSoundDesignMapSha256(value)
      || value.result !== 'pass') {
    fail('sound-design canonical map hash or result is invalid');
  }
  if (revoiceVariant && parentDesign) {
    const parentBinding = requireBinding(
      value.revoice.parent_sound_design,
      'revoice.parent_sound_design',
    );
    if (JSON.stringify(parentBinding) !== JSON.stringify(parentDesign.binding)
        || value.revoice.parent_event_map_sha256 !== parentDesign.value.event_map_sha256
        || parentDesign.value.resume_mode !== 'standard') {
      fail('revoice parent sound-design binding is stale');
    }
    const stripCueFrame = (event) => {
      const copy = structuredClone(event);
      delete copy.cue_frame;
      return copy;
    };
    if (JSON.stringify(value.shot_analysis) !== JSON.stringify(parentDesign.value.shot_analysis)
        || value.events.length !== parentDesign.value.events.length
        || value.events.some((event, index) => (
          event.event_id !== parentDesign.value.events[index]?.event_id
          || JSON.stringify(stripCueFrame(event))
            !== JSON.stringify(stripCueFrame(parentDesign.value.events[index]))
        ))) {
      fail('revoice may only change existing cue frames');
    }
  } else if (revoiceVariant) {
    if (value.revoice.parent_sound_design !== null
        || value.revoice.parent_event_map_sha256 !== null
        || value.revoice.legacy_soundless_parent?.contract_version
          !== 'legacy-soundless-parent-evidence-v1'
        || value.revoice.legacy_soundless_parent.sound_effect_cue_count !== 0
        || value.revoice.legacy_soundless_parent.sound_effect_track_present !== false
        || !requireBinding(
          value.revoice.legacy_soundless_parent.delivery_manifest,
          'revoice.legacy_soundless_parent.delivery_manifest',
        )
        || value.events.some(({decision}) => decision !== 'silent')) {
      fail('legacy soundless revoice must remain soundless without analysis or acquisition');
    }
  }
  return {
    contract_version: 'knowledge-video-sound-design-validation-v1',
    result: 'pass',
    resume_mode: value.resume_mode,
    bindings,
    event_map_sha256: value.event_map_sha256,
    bus_gain_multiplier: value.bus_gain_multiplier,
    events: structuredClone(value.events),
    audible_cues: value.events.filter(({decision}) => decision === 'audible'),
  };
};

export const loadAndValidateKnowledgeVideoSoundDesign = ({
  repositoryRoot,
  episodeWorkspace,
  binding,
  shots,
  durationFrames,
  expectedBindings,
  revoiceVariant = false,
} = {}) => {
  const soundDesignBinding = requireBinding(binding, 'sound design');
  if (!soundDesignBinding.path.startsWith(`${episodeWorkspace}/schema/`)) {
    fail('sound design must be stored in the active episode schema');
  }
  const designPath = rootRelative(repositoryRoot, soundDesignBinding.path, 'sound design path');
  if (sha256File(designPath) !== soundDesignBinding.checksum_sha256) {
    fail('sound design checksum mismatch');
  }
  const value = JSON.parse(fs.readFileSync(designPath, 'utf8'));
  let parentDesign = null;
  if (revoiceVariant && value.revoice?.parent_sound_design !== null) {
    const parentBinding = requireBinding(
      value.revoice?.parent_sound_design,
      'revoice.parent_sound_design',
    );
    const parentPath = rootRelative(repositoryRoot, parentBinding.path, 'revoice parent sound design');
    if (sha256File(parentPath) !== parentBinding.checksum_sha256) {
      fail('revoice parent sound-design checksum mismatch');
    }
    parentDesign = {
      binding: parentBinding,
      value: JSON.parse(fs.readFileSync(parentPath, 'utf8')),
    };
    if (parentDesign.value.contract_version !== KNOWLEDGE_VIDEO_SOUND_DESIGN_VERSION
        || parentDesign.value.status !== 'qa_passed'
        || parentDesign.value.result !== 'pass'
        || parentDesign.value.resume_mode !== 'standard'
        || !Array.isArray(parentDesign.value.events)
        || parentDesign.value.event_map_sha256 !== buildSoundDesignMapSha256(parentDesign.value)) {
      fail('revoice parent sound design is not an internally valid standard artifact');
    }
  }
  const library = loadAndValidateSharedSoundEffectLibrary({
    repositoryRoot,
    manifestPath: value.bindings?.sound_effect_library?.path,
    expectedManifestSha256: value.bindings?.sound_effect_library?.checksum_sha256,
  });
  return {
    path: soundDesignBinding.path,
    checksum_sha256: soundDesignBinding.checksum_sha256,
    value,
    validation: validateKnowledgeVideoSoundDesign(value, {
      shots,
      durationFrames,
      episodeWorkspace,
      repositoryRoot,
      libraryValidation: library,
      expectedBindings,
      verifyFiles: true,
      revoiceVariant,
      parentDesign,
    }),
  };
};

export const retimeKnowledgeVideoSoundDesignForRevoice = ({
  parentBinding,
  parentValue,
  shots,
  durationFrames,
  episodeWorkspace,
  bindings,
  semanticCueFramesByEventId = {},
  repositoryRoot,
  libraryValidation,
  verifyFiles = true,
  legacySoundlessParentEvidence = null,
} = {}) => {
  if (parentValue == null) {
    const deliveryManifest = requireBinding(
      legacySoundlessParentEvidence?.delivery_manifest,
      'legacy soundless parent delivery manifest',
    );
    if (legacySoundlessParentEvidence?.contract_version
        !== 'legacy-soundless-parent-evidence-v1'
        || legacySoundlessParentEvidence.sound_effect_cue_count !== 0
        || legacySoundlessParentEvidence.sound_effect_track_present !== false) {
      fail('legacy soundless parent evidence is invalid');
    }
    const events = deriveSoundDesignCandidateEvents(shots).map((candidate) => ({
      ...candidate,
      decision: 'silent',
      reason: '已完成旧父项目无音效，revoice 保持无音效',
      semantic_role: null,
      intensity: null,
      render_owner: null,
      source: null,
      derived_asset: null,
      gain_multiplier: null,
      qa_result: null,
    }));
    const value = {
      contract_version: KNOWLEDGE_VIDEO_SOUND_DESIGN_VERSION,
      status: 'qa_passed',
      resume_mode: 'revoice_variant',
      revoice: {
        contract_version: REVOICE_RETIMER_VERSION,
        parent_sound_design: null,
        parent_event_map_sha256: null,
        legacy_soundless_parent: {
          ...structuredClone(legacySoundlessParentEvidence),
          delivery_manifest: deliveryManifest,
        },
        reanalysis: false,
        downloaded_new_assets: false,
        added_event_ids: [],
      },
      episode_workspace: episodeWorkspace,
      fps: 30,
      duration_frames: durationFrames,
      policy: structuredClone(POLICY),
      bindings: structuredClone(bindings),
      bus_gain_multiplier: 1,
      shot_analysis: shots.map((shot) => ({
        shot_id: shot.shot_id,
        storyboard_content_analyzed: true,
        visible_action_analysis: 'complete',
        local_video_action_analysis: shot.local_video == null ? 'not_applicable' : 'complete',
        candidate_event_ids: events.filter(({shot_id: shotId}) => shotId === shot.shot_id)
          .map(({event_id: eventId}) => eventId),
      })),
      events,
      event_map_sha256: '',
      result: 'pass',
    };
    value.event_map_sha256 = buildSoundDesignMapSha256(value);
    validateKnowledgeVideoSoundDesign(value, {
      shots, durationFrames, episodeWorkspace, repositoryRoot, libraryValidation,
      expectedBindings: bindings, verifyFiles, revoiceVariant: true, parentDesign: null,
    });
    return value;
  }
  const validatedParentBinding = requireBinding(parentBinding, 'parent sound design');
  if (parentValue?.contract_version !== KNOWLEDGE_VIDEO_SOUND_DESIGN_VERSION
      || parentValue.status !== 'qa_passed' || parentValue.result !== 'pass'
      || parentValue.resume_mode !== 'standard'
      || parentValue.event_map_sha256 !== buildSoundDesignMapSha256(parentValue)) {
    fail('revoice requires an internally valid standard parent sound design');
  }
  const mechanicalById = new Map(deriveSoundDesignCandidateEvents(shots).map(
    (candidate) => [candidate.event_id, candidate],
  ));
  const events = parentValue.events.map((event) => {
    const mechanical = mechanicalById.get(event.event_id);
    if (mechanical) return {...structuredClone(event), cue_frame: mechanical.cue_frame};
    const cueFrame = semanticCueFramesByEventId[event.event_id];
    if (!Number.isInteger(cueFrame)) {
      fail(`revoice semantic cue frame is missing: ${event.event_id}`);
    }
    return {...structuredClone(event), cue_frame: cueFrame};
  });
  if (mechanicalById.size !== events.filter(({candidate_source: source}) => source === 'mechanical').length) {
    fail('revoice shots do not preserve the parent mechanical event identities');
  }
  const value = {
    ...structuredClone(parentValue),
    resume_mode: 'revoice_variant',
    revoice: {
      contract_version: REVOICE_RETIMER_VERSION,
      parent_sound_design: validatedParentBinding,
      parent_event_map_sha256: parentValue.event_map_sha256,
      reanalysis: false,
      downloaded_new_assets: false,
      added_event_ids: [],
    },
    episode_workspace: episodeWorkspace,
    duration_frames: durationFrames,
    bindings: structuredClone(bindings),
    events,
    event_map_sha256: '',
    result: 'pass',
  };
  value.event_map_sha256 = buildSoundDesignMapSha256(value);
  validateKnowledgeVideoSoundDesign(value, {
    shots,
    durationFrames,
    episodeWorkspace,
    repositoryRoot,
    libraryValidation,
    expectedBindings: bindings,
    verifyFiles,
    revoiceVariant: true,
    parentDesign: {binding: validatedParentBinding, value: parentValue},
  });
  return value;
};

export const KNOWLEDGE_VIDEO_SOUND_DESIGN_POLICY = POLICY;
