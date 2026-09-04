import {isFlipbookRow} from '../flipbook-video/profile.mjs';
import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {loadAndValidateSharedSoundEffectLibrary} from './contract.mjs';

export const LEGACY_KNOWLEDGE_VIDEO_SOUND_DESIGN_VERSION = 'knowledge-video-sound-design-v1';
export const KNOWLEDGE_VIDEO_SOUND_DESIGN_VERSION = 'knowledge-video-sound-design-v2';
export const GLOBAL_SOUND_EFFECT_RENDER_OWNER = 'global_sound_effect_track_v1';
export const IAN_SOUND_EFFECT_RENDER_OWNER = 'ian_layered_scene';

const SHA256 = /^[a-f0-9]{64}$/;
const LEGACY_POLICY = Object.freeze({
  non_ian_max_cues_per_shot: 2,
  strong_min_gap_frames: 30,
  generic_ian_conflict_window_frames: 12,
  narration_gain: 1,
  normalization: 'disabled',
  runtime_audio_transform: 'forbidden',
});
const POLICY_PATH = 'leverage-video/src/shared/sound-effects/sound-design-policy-v2.json';
const POLICY_URL = new URL('./sound-design-policy-v2.json', import.meta.url);
const POLICY = Object.freeze(JSON.parse(fs.readFileSync(POLICY_URL, 'utf8')));
export const KNOWLEDGE_VIDEO_SOUND_DESIGN_POLICY_BINDING = Object.freeze({
  path: POLICY_PATH,
  checksum_sha256: crypto.createHash('sha256').update(fs.readFileSync(POLICY_URL)).digest('hex'),
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

const deriveLegacySoundDesignCandidateEvents = (shots) => {
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
      add(`action-state:${occurrence.state_id}`, 'action-state-entry',
        shot.start_frame + occurrence.at_frame);
    }
    for (const transition of shot.intra_shot_transitions ?? []) {
      add(`intra-transition:${transition.from_asset_id}:${transition.to_asset_id}`,
        'intra-shot-transition', shot.start_frame + transition.at_frame,
        {transition_kind: transition.kind});
    }
    for (const [position, segment] of (shot.whiteboard?.timing_segments ?? []).entries()) {
      add(`whiteboard-segment:${position + 1}`, 'whiteboard-segment',
        shot.start_frame + segment.output_start_frame);
    }
    for (const entry of shot.ian_layered_scene?.entry_effects?.layers ?? []) {
      add(`ian-layer:${entry.layer_id}`, 'ian-layer-entry',
        shot.start_frame + entry.entry_frame, {ian_layer_id: entry.layer_id});
    }
    if (shot.transition !== null && shot.transition !== undefined) {
      const cueFrame = shot.transition.kind === 'cut'
        ? Math.max(shot.start_frame, shot.end_frame - 1)
        : Math.max(shot.start_frame,
          shot.end_frame - (shot.transition.duration_in_frames ?? 0));
      add('outgoing-transition', 'inter-shot-transition', cueFrame,
        {transition_kind: shot.transition.kind});
    }
  }
  return events;
};

export const deriveSoundDesignCandidateEvents = (shots) => {
  if (!Array.isArray(shots) || shots.length === 0) fail('sound-design shots are required');
  const events = [];
  for (const [shotIndex, shot] of shots.entries()) {
    const add = (suffix, anchorKind, cueFrame, syncFrame, requiredAudible, details = {}) => events.push({
      event_id: `${shot.shot_id}:${suffix}`,
      shot_id: shot.shot_id,
      anchor_kind: anchorKind,
      cue_frame: cueFrame,
      sync_frame: syncFrame,
      required_audible: requiredAudible,
      candidate_source: 'mechanical',
      ...details,
    });
    if (shotIndex === 0) {
      add('opening', 'shot-opening', shot.start_frame, shot.start_frame, true, {
        from_shot_id: null,
        to_shot_id: shot.shot_id,
        transition_kind: null,
      });
    } else {
      const previous = shots[shotIndex - 1];
      const transition = previous.transition;
      if (transition == null) fail(`${previous.shot_id} is missing its outgoing transition`);
      const durationInFrames = transition.kind === 'cut'
        ? 0
        : transition.duration_in_frames;
      if (!Number.isInteger(durationInFrames) || durationInFrames < 0) {
        fail(`${previous.shot_id} transition duration is invalid`);
      }
      add(
        'incoming-boundary',
        'shot-boundary',
        Math.max(previous.start_frame, shot.start_frame - durationInFrames),
        shot.start_frame,
        true,
        {
          from_shot_id: previous.shot_id,
          to_shot_id: shot.shot_id,
          transition_kind: transition.kind,
          transition_duration_in_frames: durationInFrames,
        },
      );
    }
    if (isFlipbookRow(shot)) {
      if (shot.ian_layered_scene != null || shot.action_state_schedule != null
        || (shot.intra_shot_transitions ?? []).length !== 0) {
        fail(`${shot.shot_id} static spreads cannot invent layer/state sound events`);
      }
      for (const reveal of shot.text_reveals ?? []) {
        add(`text-reveal:${reveal.id}`, 'flipbook-text-reveal', reveal.start_frame,
          reveal.start_frame, false);
      }
    }
    for (const occurrence of shot.action_state_schedule?.occurrences ?? []) {
      add(
        `action-state:${occurrence.state_id}`,
        'action-state-entry',
        shot.start_frame + occurrence.at_frame,
        shot.start_frame + occurrence.at_frame,
        false,
      );
    }
    for (const transition of shot.intra_shot_transitions ?? []) {
      const durationInFrames = transition.kind === 'cut'
        ? 0
        : (transition.duration_in_frames ?? 0);
      add(
        `intra-transition:${transition.from_asset_id}:${transition.to_asset_id}`,
        'intra-shot-transition',
        shot.start_frame + transition.at_frame,
        shot.start_frame + transition.at_frame + durationInFrames,
        true,
        {
          transition_kind: transition.kind,
          transition_duration_in_frames: durationInFrames,
        },
      );
    }
    for (const [position, segment] of (shot.whiteboard?.timing_segments ?? []).entries()) {
      add(
        `whiteboard-segment:${position + 1}`,
        'whiteboard-segment',
        shot.start_frame + segment.output_start_frame,
        shot.start_frame + segment.output_start_frame,
        false,
      );
    }
    for (const entry of shot.ian_layered_scene?.entry_effects?.layers ?? []) {
      add(
        `ian-layer:${entry.layer_id}`,
        'ian-layer-entry',
        shot.start_frame + entry.entry_frame,
        shot.start_frame + entry.entry_frame,
        false,
        {ian_layer_id: entry.layer_id},
      );
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

const validateLegacyKnowledgeVideoSoundDesign = (value, {
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
  if (value?.contract_version !== LEGACY_KNOWLEDGE_VIDEO_SOUND_DESIGN_VERSION
      || value.status !== 'qa_passed'
      || value.resume_mode !== (revoiceVariant ? 'revoice_variant' : 'standard')
      || value.fps !== 30 || value.duration_frames !== durationFrames
      || value.episode_workspace !== episodeWorkspace
      || JSON.stringify(value.policy) !== JSON.stringify(LEGACY_POLICY)
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
  const expectedEvents = deriveLegacySoundDesignCandidateEvents(shots);
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
    if (nonIanAudible.length > LEGACY_POLICY.non_ian_max_cues_per_shot) {
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
      && frame - strongFrames[index - 1] < LEGACY_POLICY.strong_min_gap_frames)) {
    fail('strong sound-effect cues are too dense');
  }
  const ianFrames = value.events.filter((event) => event.decision === 'audible'
    && event.render_owner === IAN_SOUND_EFFECT_RENDER_OWNER).map(({cue_frame}) => cue_frame);
  const genericConflict = value.events.find((event) => event.decision === 'audible'
    && event.render_owner === GLOBAL_SOUND_EFFECT_RENDER_OWNER
    && ianFrames.some((frame) => Math.abs(frame - event.cue_frame)
      < LEGACY_POLICY.generic_ian_conflict_window_frames));
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

const MOTION_DIRECTIONS = new Set([
  'none', 'left', 'right', 'up', 'down', 'inward', 'outward', 'mixed',
]);
const ATTACK_CLASSES = new Set(['soft', 'transient', 'swell', 'sustained']);
const DURATION_FITS = new Set(['exact', 'pretrimmed', 'sync-offset']);
const MASKING_RISKS = new Set(['low', 'medium']);

const optionalCueBudget = (durationFrames) => {
  const seconds = durationFrames / 30;
  const row = POLICY.optional_global_cue_budgets.find(
    ({maximum_shot_seconds: maximum}) => maximum === null || seconds <= maximum,
  );
  return row.maximum_cue_groups;
};

const validateSelectionBasis = (event) => {
  const basis = event.selection_basis;
  const gates = basis?.hard_gate_results;
  if (basis?.selection_method !== POLICY.selection_method
      || typeof basis.visible_event !== 'string' || basis.visible_event === ''
      || typeof basis.visual_route !== 'string' || basis.visual_route === ''
      || typeof basis.material !== 'string' || basis.material === ''
      || !MOTION_DIRECTIONS.has(basis.motion_direction)
      || basis.energy !== event.intensity
      || !ATTACK_CLASSES.has(basis.attack_class)
      || !DURATION_FITS.has(basis.duration_fit)
      || !MASKING_RISKS.has(basis.narration_masking_risk)
      || basis.semantic_role !== event.semantic_role
      || basis.selected_asset_id !== event.source?.asset_id
      || basis.selected_reason !== event.reason
      || gates?.license !== true || gates?.media !== true
      || gates?.semantic_role !== true || gates?.motion_direction !== true
      || !Array.isArray(basis.rejected_candidates)
      || basis.rejected_candidates.some((candidate) => (
        typeof candidate?.asset_id !== 'string' || candidate.asset_id === ''
        || candidate.asset_id === event.source?.asset_id
        || typeof candidate.reason !== 'string' || candidate.reason === ''
      ))) {
    fail(`${event.event_id} selection basis is incomplete`);
  }
};

const validateV2AudibleEvent = ({
  event,
  expected,
  libraryAssets,
  repositoryRoot,
  episodeWorkspace,
  durationFrames,
  verifyFiles,
}) => {
  if (typeof event.semantic_role !== 'string' || event.semantic_role === ''
      || !POLICY.intensity_levels.includes(event.intensity)
      || ![GLOBAL_SOUND_EFFECT_RENDER_OWNER, IAN_SOUND_EFFECT_RENDER_OWNER]
        .includes(event.render_owner)
      || typeof event.reason !== 'string' || event.reason === ''
      || typeof event.gain_multiplier !== 'number' || !Number.isFinite(event.gain_multiplier)
      || event.gain_multiplier <= 0 || event.gain_multiplier > 1
      || typeof event.cue_group_id !== 'string' || event.cue_group_id === ''
      || typeof event.primary_render_event_id !== 'string'
      || !Array.isArray(event.covered_event_ids) || event.covered_event_ids.length < 1
      || new Set(event.covered_event_ids).size !== event.covered_event_ids.length
      || event.qa_result !== 'pass') {
    fail(`${event.event_id} audible decision is incomplete`);
  }
  if (!Number.isInteger(event.cue_frame) || event.cue_frame < 0
      || !Number.isInteger(event.sync_frame) || event.sync_frame < event.cue_frame
      || event.sync_frame >= durationFrames) {
    fail(`${event.event_id} onset or sync frame is invalid`);
  }
  if (expected && (event.cue_frame !== expected.cue_frame
      || event.sync_frame !== expected.sync_frame)) {
    fail(`${event.event_id} onset/sync differs from its mechanical anchor`);
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
  validateSelectionBasis(event);
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

const validateV2KnowledgeVideoSoundDesign = (value, {
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
      || !Number.isFinite(value.bus_gain_multiplier) || value.bus_gain_multiplier <= 0
      || !Array.isArray(value.events) || !Array.isArray(value.shot_analysis)) {
    fail('knowledge-video sound design v2 header or policy is invalid');
  }
  const legacySoundless = revoiceVariant && parentDesign === null;
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
    'transition_review', 'sound_design_policy', 'sound_effect_library',
  ];
  if (JSON.stringify(Object.keys(bindings).sort()) !== JSON.stringify(requiredBindings.sort())) {
    fail('knowledge-video sound design v2 bindings are incomplete');
  }
  if (JSON.stringify(bindings.sound_design_policy)
      !== JSON.stringify(KNOWLEDGE_VIDEO_SOUND_DESIGN_POLICY_BINDING)
      || sha256File(rootRelative(repositoryRoot, bindings.sound_design_policy.path,
        'sound-design policy path')) !== bindings.sound_design_policy.checksum_sha256) {
    fail('sound-design policy binding is stale');
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
        || !['audible', 'silent'].includes(event.decision)
        || typeof event.required_audible !== 'boolean') {
      fail('sound-design event identity or decision is invalid');
    }
    const expected = expectedById.get(event.event_id);
    const semantic = event.candidate_source === 'semantic'
      && event.event_id.startsWith(`${event.shot_id}:semantic:`);
    if (!expected && !semantic) fail(`unexpected sound-design event: ${event.event_id}`);
    if (expected && (event.shot_id !== expected.shot_id
        || event.anchor_kind !== expected.anchor_kind
        || event.candidate_source !== 'mechanical'
        || event.cue_frame !== expected.cue_frame
        || event.sync_frame !== expected.sync_frame
        || event.required_audible !== expected.required_audible)) {
      fail(`${event.event_id} differs from the mechanical candidate`);
    }
    const shot = shotsById.get(event.shot_id);
    if (!shot) fail(`${event.event_id} references an unknown shot`);
    if (semantic && (!AUDIBLE_SEMANTIC_ANCHORS.has(event.anchor_kind)
        || event.required_audible !== false)) {
      fail(`${event.event_id} is not an optional visible semantic event`);
    }
    if (semantic && (event.cue_frame < shot.start_frame || event.sync_frame >= shot.end_frame)) {
      fail(`${event.event_id} semantic timing is outside its shot`);
    }
    if (!Number.isInteger(event.cue_frame) || event.cue_frame < 0
        || !Number.isInteger(event.sync_frame) || event.sync_frame < event.cue_frame
        || event.sync_frame >= durationFrames) {
      fail(`${event.event_id} candidate onset/sync frame is outside the composition`);
    }
    if (event.decision === 'silent') {
      if (event.required_audible && !legacySoundless) {
        fail(`${event.event_id} required structural event cannot be silent`);
      }
      if (event.semantic_role !== null || event.intensity !== null || event.render_owner !== null
          || event.source !== null || event.derived_asset !== null
          || event.gain_multiplier !== null || event.qa_result !== null
          || event.cue_group_id !== null || event.primary_render_event_id !== null
          || event.covered_event_ids !== null || event.selection_basis !== null) {
        fail(`${event.event_id} silent decision carries audible fields`);
      }
    } else {
      validateV2AudibleEvent({
        event,
        expected,
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
    if (shot.local_video != null && !legacySoundless
        && !value.events.some((event) => event.shot_id === shot.shot_id
          && event.candidate_source === 'semantic'
          && event.anchor_kind === 'local-video-visible-action')) {
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
          || event.derived_asset?.trim_start_sample !== cue.source.trim_start_sample
          || event.derived_asset?.trim_end_sample !== cue.source.trim_end_sample_exclusive
          || event.derived_asset?.asset !== cue.derived_asset.asset
          || event.derived_asset?.checksum_sha256 !== cue.derived_asset.checksum_sha256)) {
        fail(`${event?.event_id ?? entry.layer_id} differs from the Ian-owned sound-effect cue`);
      }
    }
  }
  const audible = value.events.filter(({decision}) => decision === 'audible');
  const groups = new Map();
  for (const event of audible) {
    const members = groups.get(event.cue_group_id) ?? [];
    members.push(event);
    groups.set(event.cue_group_id, members);
  }
  const renderedCues = [];
  for (const [groupId, members] of groups) {
    const memberIds = members.map(({event_id: eventId}) => eventId);
    const primaryEventId = members[0].primary_render_event_id;
    const comparable = (event) => JSON.stringify({
      cue_frame: event.cue_frame,
      sync_frame: event.sync_frame,
      semantic_role: event.semantic_role,
      intensity: event.intensity,
      render_owner: event.render_owner,
      source: event.source,
      derived_asset: event.derived_asset,
      gain_multiplier: event.gain_multiplier,
      selection_basis: event.selection_basis,
      covered_event_ids: event.covered_event_ids,
      primary_render_event_id: event.primary_render_event_id,
    });
    if (members.some((event) => event.cue_group_id !== groupId
        || event.primary_render_event_id !== primaryEventId
        || JSON.stringify(event.covered_event_ids) !== JSON.stringify(memberIds)
        || comparable(event) !== comparable(members[0]))
        || members.filter(({event_id: eventId}) => eventId === primaryEventId).length !== 1) {
      fail(`${groupId} cue group coverage or render identity is invalid`);
    }
    renderedCues.push(members.find(({event_id: eventId}) => eventId === primaryEventId));
  }
  const cueKeys = new Set();
  for (const cue of renderedCues) {
    const key = `${cue.render_owner}:${cue.cue_frame}:${cue.source.asset_id}`;
    if (cueKeys.has(key)) fail(`${cue.event_id} duplicates a rendered cue group`);
    cueKeys.add(key);
  }
  const strongFrames = renderedCues.filter(({intensity}) => intensity === 'strong')
    .map(({cue_frame: frame}) => frame).sort((a, b) => a - b);
  if (strongFrames.some((frame, index) => index > 0
      && frame - strongFrames[index - 1] < POLICY.strong_min_gap_frames)) {
    fail('strong sound-effect cue groups are too dense');
  }
  const onsetFrames = renderedCues.map(({cue_frame: frame}) => frame).sort((a, b) => a - b);
  if (onsetFrames.some((frame) => onsetFrames.filter(
    (candidate) => candidate >= frame && candidate < frame + 30,
  ).length > POLICY.maximum_cue_group_onsets_per_30_frames)) {
    fail('sound-effect cue-group onsets exceed the 30-frame burst limit');
  }
  for (const shot of shots) {
    const optionalGroups = renderedCues.filter((cue) => cue.shot_id === shot.shot_id
      && cue.render_owner === GLOBAL_SOUND_EFFECT_RENDER_OWNER
      && groups.get(cue.cue_group_id).every(({required_audible: required}) => !required));
    if (optionalGroups.length > optionalCueBudget(shot.end_frame - shot.start_frame)) {
      fail(`${shot.shot_id} exceeds its duration-based optional cue budget`);
    }
  }
  if (!SHA256.test(value.event_map_sha256 ?? '')
      || value.event_map_sha256 !== buildSoundDesignMapSha256(value)
      || value.result !== 'pass') {
    fail('sound-design canonical map hash or result is invalid');
  }
  if (revoiceVariant && parentDesign) {
    const parentBinding = requireBinding(value.revoice.parent_sound_design,
      'revoice.parent_sound_design');
    const stripTiming = (event) => {
      const copy = structuredClone(event);
      delete copy.cue_frame;
      delete copy.sync_frame;
      return copy;
    };
    if (JSON.stringify(parentBinding) !== JSON.stringify(parentDesign.binding)
        || value.revoice.parent_event_map_sha256 !== parentDesign.value.event_map_sha256
        || parentDesign.value.contract_version !== KNOWLEDGE_VIDEO_SOUND_DESIGN_VERSION
        || parentDesign.value.resume_mode !== 'standard'
        || JSON.stringify(value.shot_analysis) !== JSON.stringify(parentDesign.value.shot_analysis)
        || value.events.length !== parentDesign.value.events.length
        || value.events.some((event, index) => event.event_id !== parentDesign.value.events[index]?.event_id
          || JSON.stringify(stripTiming(event))
            !== JSON.stringify(stripTiming(parentDesign.value.events[index])))) {
      fail('revoice may only retime existing v2 cue anchors');
    }
  } else if (legacySoundless) {
    if (value.revoice.parent_sound_design !== null
        || value.revoice.parent_event_map_sha256 !== null
        || value.revoice.legacy_soundless_parent?.contract_version
          !== 'legacy-soundless-parent-evidence-v1'
        || value.revoice.legacy_soundless_parent.sound_effect_cue_count !== 0
        || value.revoice.legacy_soundless_parent.sound_effect_track_present !== false
        || !requireBinding(value.revoice.legacy_soundless_parent.delivery_manifest,
          'revoice.legacy_soundless_parent.delivery_manifest')
        || audible.length !== 0) {
      fail('legacy soundless revoice must remain soundless without analysis or acquisition');
    }
  }
  const intervals = onsetFrames.slice(1).map((frame, index) => (frame - onsetFrames[index]) / 30);
  const averageInterval = intervals.length === 0
    ? null
    : intervals.reduce((sum, seconds) => sum + seconds, 0) / intervals.length;
  const assetById = new Map(libraryValidation.assets.map((asset) => [asset.asset_id, asset]));
  const diversityWarnings = [];
  for (let index = 1; index < renderedCues.length; index += 1) {
    if (renderedCues[index - 1].source.asset_id === renderedCues[index].source.asset_id) {
      diversityWarnings.push(`adjacent-source:${renderedCues[index].event_id}`);
    }
    const three = renderedCues.slice(Math.max(0, index - 2), index + 1)
      .map((cue) => assetById.get(cue.source.asset_id)?.timbre_family ?? null);
    if (three.length === 3 && three[0] !== null && three.every((family) => family === three[0])) {
      diversityWarnings.push(`three-consecutive-timbres:${renderedCues[index].event_id}`);
    }
  }
  return {
    contract_version: 'knowledge-video-sound-design-validation-v2',
    result: 'pass',
    resume_mode: value.resume_mode,
    bindings,
    event_map_sha256: value.event_map_sha256,
    bus_gain_multiplier: value.bus_gain_multiplier,
    events: structuredClone(value.events),
    audible_cues: structuredClone(renderedCues),
    structural_event_count: expectedEvents.filter(({required_audible: required}) => required).length,
    structural_coverage_result: legacySoundless ? 'legacy-soundless-exempt' : 'pass',
    density_advisory: {
      average_interval_seconds: averageInterval,
      target_minimum_seconds: POLICY.average_audible_interval_advisory_seconds.minimum,
      target_maximum_seconds: POLICY.average_audible_interval_advisory_seconds.maximum,
      diversity_warnings: diversityWarnings,
    },
  };
};

export const validateKnowledgeVideoSoundDesign = (value, options = {}) => {
  if (value?.contract_version === LEGACY_KNOWLEDGE_VIDEO_SOUND_DESIGN_VERSION) {
    if (!options.allowLegacyReadOnly && !options.revoiceVariant) {
      fail('knowledge-video-sound-design-v1 is completed legacy read-only evidence');
    }
    return validateLegacyKnowledgeVideoSoundDesign(value, options);
  }
  return validateV2KnowledgeVideoSoundDesign(value, options);
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
    if (![LEGACY_KNOWLEDGE_VIDEO_SOUND_DESIGN_VERSION,
      KNOWLEDGE_VIDEO_SOUND_DESIGN_VERSION].includes(parentDesign.value.contract_version)
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
      allowLegacyReadOnly: revoiceVariant,
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
      cue_group_id: null,
      primary_render_event_id: null,
      covered_event_ids: null,
      selection_basis: null,
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
      bindings: {
        ...structuredClone(bindings),
        sound_design_policy: structuredClone(KNOWLEDGE_VIDEO_SOUND_DESIGN_POLICY_BINDING),
      },
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
      expectedBindings: value.bindings, verifyFiles, revoiceVariant: true, parentDesign: null,
    });
    return value;
  }
  const validatedParentBinding = requireBinding(parentBinding, 'parent sound design');
  if (parentValue?.contract_version === LEGACY_KNOWLEDGE_VIDEO_SOUND_DESIGN_VERSION) {
    if (parentValue.status !== 'qa_passed' || parentValue.result !== 'pass'
        || parentValue.resume_mode !== 'standard'
        || parentValue.event_map_sha256 !== buildSoundDesignMapSha256(parentValue)) {
      fail('revoice requires an internally valid legacy parent sound design');
    }
    const mechanicalById = new Map(deriveLegacySoundDesignCandidateEvents(shots).map(
      (candidate) => [candidate.event_id, candidate],
    ));
    const events = parentValue.events.map((event) => {
      const mechanical = mechanicalById.get(event.event_id);
      if (mechanical) return {...structuredClone(event), cue_frame: mechanical.cue_frame};
      const cueFrame = semanticCueFramesByEventId[event.event_id];
      if (!Number.isInteger(cueFrame)) fail(`revoice semantic cue frame is missing: ${event.event_id}`);
      return {...structuredClone(event), cue_frame: cueFrame};
    });
    const legacyValue = {
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
    legacyValue.event_map_sha256 = buildSoundDesignMapSha256(legacyValue);
    validateKnowledgeVideoSoundDesign(legacyValue, {
      shots, durationFrames, episodeWorkspace, repositoryRoot, libraryValidation,
      expectedBindings: bindings, verifyFiles, revoiceVariant: true,
      parentDesign: {binding: validatedParentBinding, value: parentValue},
      allowLegacyReadOnly: true,
    });
    return legacyValue;
  }
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
    if (mechanical) return {
      ...structuredClone(event),
      cue_frame: mechanical.cue_frame,
      sync_frame: mechanical.sync_frame,
    };
    const semanticTiming = semanticCueFramesByEventId[event.event_id];
    const syncFrame = Number.isInteger(semanticTiming)
      ? semanticTiming
      : semanticTiming?.sync_frame;
    if (!Number.isInteger(syncFrame)) {
      fail(`revoice semantic cue frame is missing: ${event.event_id}`);
    }
    const syncOffset = event.sync_frame - event.cue_frame;
    return {...structuredClone(event), cue_frame: syncFrame - syncOffset, sync_frame: syncFrame};
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
    bindings: {
      ...structuredClone(bindings),
      sound_design_policy: structuredClone(KNOWLEDGE_VIDEO_SOUND_DESIGN_POLICY_BINDING),
    },
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
    expectedBindings: value.bindings,
    verifyFiles,
    revoiceVariant: true,
    parentDesign: {binding: validatedParentBinding, value: parentValue},
  });
  return value;
};

export const KNOWLEDGE_VIDEO_SOUND_DESIGN_POLICY = POLICY;
