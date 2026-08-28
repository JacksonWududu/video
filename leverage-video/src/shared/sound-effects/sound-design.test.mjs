import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

import {loadAndValidateSharedSoundEffectLibrary} from './contract.mjs';
import {
  KNOWLEDGE_VIDEO_SOUND_DESIGN_POLICY,
  buildSoundDesignMapSha256,
  deriveSoundDesignCandidateEvents,
  retimeKnowledgeVideoSoundDesignForRevoice,
  validateKnowledgeVideoSoundDesign,
} from './sound-design.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const episodeWorkspace = 'leverage-video/src/example';
const library = loadAndValidateSharedSoundEffectLibrary({repositoryRoot});
const bindings = {
  storyboard: {path: `${episodeWorkspace}/script/storyboard.md`, checksum_sha256: '1'.repeat(64)},
  narration_master: {path: `${episodeWorkspace}/assets/audio/narration.mp3`, checksum_sha256: '2'.repeat(64)},
  visual_manifest: {path: `${episodeWorkspace}/schema/visual-assets-manifest-v3.json`, checksum_sha256: '3'.repeat(64)},
  visual_rhythm: {path: `${episodeWorkspace}/schema/storyboard-visual-rhythm-v2.json`, checksum_sha256: '4'.repeat(64)},
  transition_review: {path: `${episodeWorkspace}/schema/transition-selection-review-v1.json`, checksum_sha256: '5'.repeat(64)},
  sound_effect_library: structuredClone(library.manifest),
};

const shots = [{
  shot_id: 'S01', start_frame: 0, end_frame: 120,
  local_video: null,
  action_state_schedule: {occurrences: [
    {state_id: 'A', at_frame: 0},
    {state_id: 'B', at_frame: 45},
  ]},
  intra_shot_transitions: [{
    from_asset_id: 'A', to_asset_id: 'B', at_frame: 45, kind: 'cut',
  }],
  ian_layered_scene: null,
  whiteboard: null,
  transition: null,
}];

const silent = (event) => ({
  ...event,
  decision: 'silent',
  reason: event.anchor_kind === 'shot-start'
    ? '镜头开始本身不是可听事件'
    : '画面变化不需要额外强调',
  semantic_role: null,
  intensity: null,
  render_owner: null,
  source: null,
  derived_asset: null,
  gain_multiplier: null,
  qa_result: null,
});

const buildValue = () => {
  const events = deriveSoundDesignCandidateEvents(shots).map(silent);
  const value = {
    contract_version: 'knowledge-video-sound-design-v1',
    status: 'qa_passed',
    resume_mode: 'standard',
    revoice: null,
    episode_workspace: episodeWorkspace,
    fps: 30,
    duration_frames: 120,
    policy: structuredClone(KNOWLEDGE_VIDEO_SOUND_DESIGN_POLICY),
    bindings: structuredClone(bindings),
    bus_gain_multiplier: 1,
    shot_analysis: [{
      shot_id: 'S01',
      storyboard_content_analyzed: true,
      visible_action_analysis: 'complete',
      local_video_action_analysis: 'not_applicable',
      candidate_event_ids: events.map(({event_id}) => event_id),
    }],
    events,
    event_map_sha256: '',
    result: 'pass',
  };
  value.event_map_sha256 = buildSoundDesignMapSha256(value);
  return value;
};

const makeAudible = (event, {
  role = 'state_change',
  intensity = 'micro',
  cueFrame = event.cue_frame,
  owner = 'global_sound_effect_track_v1',
} = {}) => {
  const asset = library.assets.find(({semantic_roles: roles}) => roles.includes(role));
  return {
    ...event,
    cue_frame: cueFrame,
    decision: 'audible',
    reason: '可见状态发生真实变化',
    semantic_role: role,
    intensity,
    render_owner: owner,
    source: {
      asset_id: asset.asset_id,
      path: asset.path,
      checksum_sha256: asset.checksum_sha256,
      provider: asset.provider,
      source_item_url: asset.source_item_url,
      license_url: asset.license_url,
    },
    derived_asset: {
      path: `${episodeWorkspace}/assets/audio/sfx/test.wav`,
      asset: 'example/assets/audio/sfx/test.wav',
      checksum_sha256: 'a'.repeat(64),
      sample_rate_hz: 44100,
      channels: 2,
      format: 'wav',
      source_sample_rate_hz: 44100,
      trim_start_sample: 0,
      trim_end_sample: 4410,
      duration_in_frames: 3,
      runtime_transform: 'forbidden',
    },
    gain_multiplier: 0.2,
    qa_result: 'pass',
  };
};

const validate = (value, options = {}) => validateKnowledgeVideoSoundDesign(value, {
  shots,
  durationFrames: 120,
  episodeWorkspace,
  repositoryRoot,
  libraryValidation: library,
  expectedBindings: bindings,
  verifyFiles: false,
  ...options,
});

const addSemanticAudible = (value, suffix, frame, options = {}) => {
  const candidate = {
    event_id: `S01:semantic:${suffix}`,
    shot_id: 'S01',
    anchor_kind: 'visible-reveal',
    cue_frame: frame,
    candidate_source: 'semantic',
  };
  value.events.push(makeAudible(candidate, options));
  value.shot_analysis[0].candidate_event_ids.push(candidate.event_id);
  value.event_map_sha256 = buildSoundDesignMapSha256(value);
};

test('accepts a complete whole-storyboard analysis with an empty audible cue list', () => {
  const result = validate(buildValue());
  assert.equal(result.result, 'pass');
  assert.deepEqual(result.audible_cues, []);
});

test('requires one audible-or-silent decision for every mechanical candidate', () => {
  const value = buildValue();
  value.events.pop();
  value.shot_analysis[0].candidate_event_ids = value.events.map(({event_id}) => event_id);
  value.event_map_sha256 = buildSoundDesignMapSha256(value);
  assert.throws(() => validate(value), /missing sound-design candidate/);
});

test('rejects sound on a bare shot start and on an ordinary cut', () => {
  const shotStart = buildValue();
  shotStart.events[0] = makeAudible(shotStart.events[0]);
  shotStart.event_map_sha256 = buildSoundDesignMapSha256(shotStart);
  assert.throws(() => validate(shotStart), /bare shot start/);

  const cut = buildValue();
  const index = cut.events.findIndex(({anchor_kind}) => anchor_kind === 'intra-shot-transition');
  cut.events[index] = makeAudible(cut.events[index]);
  cut.event_map_sha256 = buildSoundDesignMapSha256(cut);
  assert.throws(() => validate(cut), /ordinary cut/);
});

test('rejects abstract narration events and out-of-shot silent candidates', () => {
  const abstractNarration = buildValue();
  const narrationEvent = silent({
    event_id: 'S01:semantic:abstract-noun',
    shot_id: 'S01',
    anchor_kind: 'narration-emphasis',
    cue_frame: 30,
    candidate_source: 'semantic',
  });
  abstractNarration.events.push(narrationEvent);
  abstractNarration.shot_analysis[0].candidate_event_ids.push(narrationEvent.event_id);
  abstractNarration.event_map_sha256 = buildSoundDesignMapSha256(abstractNarration);
  assert.throws(() => validate(abstractNarration), /not a visible semantic event/);

  const outside = buildValue();
  const outsideEvent = silent({
    event_id: 'S01:semantic:outside',
    shot_id: 'S01',
    anchor_kind: 'visible-action',
    cue_frame: 120,
    candidate_source: 'semantic',
  });
  outside.events.push(outsideEvent);
  outside.shot_analysis[0].candidate_event_ids.push(outsideEvent.event_id);
  outside.event_map_sha256 = buildSoundDesignMapSha256(outside);
  assert.throws(() => validate(outside), /candidate frame is outside its shot/);
});

test('accepts a semantic library match and rejects stale roles or duplicate event ids', () => {
  const value = buildValue();
  const index = value.events.findIndex(({anchor_kind}) => anchor_kind === 'action-state-entry'
    && value.events.find(({anchor_kind: kind}) => kind === 'action-state-entry'));
  value.events[index] = makeAudible(value.events[index]);
  value.event_map_sha256 = buildSoundDesignMapSha256(value);
  assert.equal(validate(value).audible_cues.length, 1);

  const stale = structuredClone(value);
  stale.events[index].semantic_role = 'missing_role';
  stale.event_map_sha256 = buildSoundDesignMapSha256(stale);
  assert.throws(() => validate(stale), /active semantic library/);

  const duplicate = buildValue();
  duplicate.events.push(structuredClone(duplicate.events[0]));
  duplicate.shot_analysis[0].candidate_event_ids.push(duplicate.events[0].event_id);
  duplicate.event_map_sha256 = buildSoundDesignMapSha256(duplicate);
  assert.throws(() => validate(duplicate), /identity or decision/);
});

test('rejects two audible events that would render the same source at the same frame', () => {
  const value = buildValue();
  addSemanticAudible(value, 'one', 30, {role: 'state_change'});
  addSemanticAudible(value, 'two', 30, {role: 'state_change'});
  assert.throws(() => validate(value), /duplicates an audible cue/);
});

test('requires an explicit local-video visible-action analysis event', () => {
  const localShots = structuredClone(shots);
  localShots[0].local_video = {contract_version: 'local-video-match-v1'};
  const value = buildValue();
  value.shot_analysis[0].local_video_action_analysis = 'complete';
  value.event_map_sha256 = buildSoundDesignMapSha256(value);
  assert.throws(() => validateKnowledgeVideoSoundDesign(value, {
    shots: localShots, durationFrames: 120, episodeWorkspace, repositoryRoot,
    libraryValidation: library, expectedBindings: bindings, verifyFiles: false,
  }), /local-video visible actions/);
});

test('enforces non-Ian sparsity, strong-cue spacing, frame bounds, and render ownership', () => {
  const tooMany = buildValue();
  addSemanticAudible(tooMany, 'one', 10, {role: 'state_change'});
  addSemanticAudible(tooMany, 'two', 40, {role: 'fact_pop_in'});
  addSemanticAudible(tooMany, 'three', 80, {role: 'success'});
  assert.throws(() => validate(tooMany), /too many non-Ian cues/);

  const strong = buildValue();
  addSemanticAudible(strong, 'one', 40, {role: 'fact_impact', intensity: 'strong'});
  addSemanticAudible(strong, 'two', 60, {role: 'success', intensity: 'strong'});
  assert.throws(() => validate(strong), /strong sound-effect cues are too dense/);

  const owner = buildValue();
  const action = owner.events.findIndex(({anchor_kind}) => anchor_kind === 'action-state-entry');
  owner.events[action] = makeAudible(owner.events[action], {owner: 'ian_layered_scene'});
  owner.event_map_sha256 = buildSoundDesignMapSha256(owner);
  assert.throws(() => validate(owner), /render owner is invalid/);

  const outOfRange = buildValue();
  addSemanticAudible(outOfRange, 'late', 119, {role: 'success'});
  assert.throws(() => validate(outOfRange), /derived WAV binding is invalid/);
});

test('drops a generic cue within 12 frames of an Ian-owned cue', () => {
  const ianAsset = library.assets.find(({semantic_roles: roles}) => roles.includes('paper_slide'));
  const ianDerived = {
    path: `${episodeWorkspace}/assets/audio/sfx/ian.wav`,
    asset: 'example/assets/audio/sfx/ian.wav',
    checksum_sha256: 'b'.repeat(64), sample_rate_hz: 44100, channels: 2,
    format: 'wav', source_sample_rate_hz: 44100,
    trim_start_sample: 0, trim_end_sample: 4410,
    duration_in_frames: 3, runtime_transform: 'forbidden',
  };
  const conflictShots = [
    {shot_id: 'S01', start_frame: 0, end_frame: 60, local_video: null,
      action_state_schedule: null, intra_shot_transitions: [], whiteboard: null,
      ian_layered_scene: null, transition: null},
    {shot_id: 'S02', start_frame: 60, end_frame: 120, local_video: null,
      action_state_schedule: null, intra_shot_transitions: [], whiteboard: null,
      transition: null,
      ian_layered_scene: {entry_effects: {layers: [{
        layer_id: 'L01', entry_frame: 0,
        sound_effect: {
          role: 'paper_slide', selection_reason: '关键纸卡真实入场',
          source: {
            asset_id: ianAsset.asset_id, path: ianAsset.path,
            checksum_sha256: ianAsset.checksum_sha256,
            trim_start_sample: 0, trim_end_sample_exclusive: 4410,
          },
          derived_asset: {
            asset: ianDerived.asset, checksum_sha256: ianDerived.checksum_sha256,
            sample_rate_hz: 44100, channels: 2,
          },
          cue_frame: 0, gain_multiplier: 0.2,
        },
      }]}}},
  ];
  const mechanical = deriveSoundDesignCandidateEvents(conflictShots);
  const events = mechanical.map((candidate) => candidate.anchor_kind === 'ian-layer-entry'
    ? {
        ...candidate, decision: 'audible', reason: '关键纸卡真实入场',
        semantic_role: 'paper_slide', intensity: 'micro',
        render_owner: 'ian_layered_scene',
        source: {
          asset_id: ianAsset.asset_id, path: ianAsset.path,
          checksum_sha256: ianAsset.checksum_sha256, provider: ianAsset.provider,
          source_item_url: ianAsset.source_item_url, license_url: ianAsset.license_url,
        },
        derived_asset: ianDerived, gain_multiplier: 0.2, qa_result: 'pass',
      }
    : silent(candidate));
  events.push(makeAudible({
    event_id: 'S01:semantic:near-ian', shot_id: 'S01',
    anchor_kind: 'visible-reveal', cue_frame: 55, candidate_source: 'semantic',
  }));
  const value = {
    ...buildValue(), duration_frames: 120, events,
    shot_analysis: conflictShots.map((shot) => ({
      shot_id: shot.shot_id, storyboard_content_analyzed: true,
      visible_action_analysis: 'complete', local_video_action_analysis: 'not_applicable',
      candidate_event_ids: events.filter(({shot_id: shotId}) => shotId === shot.shot_id)
        .map(({event_id}) => event_id),
    })),
  };
  value.event_map_sha256 = buildSoundDesignMapSha256(value);
  assert.throws(() => validateKnowledgeVideoSoundDesign(value, {
    shots: conflictShots, durationFrames: 120, episodeWorkspace, repositoryRoot,
    libraryValidation: library, expectedBindings: bindings, verifyFiles: false,
  }), /conflicts with an Ian cue/);
});

test('revoice preserves sound identities and changes cue frames only', () => {
  const parentValue = buildValue();
  const revoiceShots = structuredClone(shots);
  revoiceShots[0].end_frame = 150;
  revoiceShots[0].action_state_schedule.occurrences[1].at_frame = 60;
  revoiceShots[0].intra_shot_transitions[0].at_frame = 60;
  const revoiceBindings = structuredClone(bindings);
  revoiceBindings.narration_master.checksum_sha256 = '9'.repeat(64);
  const value = retimeKnowledgeVideoSoundDesignForRevoice({
    parentBinding: {path: `${episodeWorkspace}/schema/parent-sound-design.json`, checksum_sha256: '8'.repeat(64)},
    parentValue,
    shots: revoiceShots,
    durationFrames: 150,
    episodeWorkspace,
    bindings: revoiceBindings,
    repositoryRoot,
    libraryValidation: library,
    verifyFiles: false,
  });
  assert.equal(value.resume_mode, 'revoice_variant');
  assert.equal(value.revoice.reanalysis, false);
  assert.equal(value.revoice.downloaded_new_assets, false);
  assert.deepEqual(value.revoice.added_event_ids, []);
  assert.equal(value.events.find(({event_id}) => event_id === 'S01:action-state:B').cue_frame, 60);
  assert.equal(value.events.find(({event_id}) => event_id === 'S01:shot-start').reason,
    parentValue.events.find(({event_id}) => event_id === 'S01:shot-start').reason);
});

test('revoice keeps a completed legacy soundless parent soundless', () => {
  const value = retimeKnowledgeVideoSoundDesignForRevoice({
    parentBinding: null,
    parentValue: null,
    legacySoundlessParentEvidence: {
      contract_version: 'legacy-soundless-parent-evidence-v1',
      delivery_manifest: {path: `${episodeWorkspace}/schema/delivery.json`, checksum_sha256: '7'.repeat(64)},
      sound_effect_cue_count: 0,
      sound_effect_track_present: false,
    },
    shots,
    durationFrames: 120,
    episodeWorkspace,
    bindings,
    repositoryRoot,
    libraryValidation: library,
    verifyFiles: false,
  });
  assert.equal(value.resume_mode, 'revoice_variant');
  assert.equal(value.events.every(({decision}) => decision === 'silent'), true);
  assert.equal(value.revoice.parent_sound_design, null);
  assert.equal(value.revoice.reanalysis, false);
  assert.equal(value.revoice.downloaded_new_assets, false);
});
