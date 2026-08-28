import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

import {loadAndValidateSharedSoundEffectLibrary} from './contract.mjs';
import {
  KNOWLEDGE_VIDEO_SOUND_DESIGN_POLICY,
  KNOWLEDGE_VIDEO_SOUND_DESIGN_POLICY_BINDING,
  KNOWLEDGE_VIDEO_SOUND_DESIGN_VERSION,
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
  sound_design_policy: structuredClone(KNOWLEDGE_VIDEO_SOUND_DESIGN_POLICY_BINDING),
  sound_effect_library: structuredClone(library.manifest),
};

const shots = [
  {
    shot_id: 'S01', start_frame: 0, end_frame: 120, local_video: null,
    action_state_schedule: {occurrences: [
      {state_id: 'A', at_frame: 0},
      {state_id: 'B', at_frame: 45},
    ]},
    intra_shot_transitions: [{
      from_asset_id: 'A', to_asset_id: 'B', at_frame: 45, kind: 'cut',
    }],
    ian_layered_scene: null,
    whiteboard: null,
    transition: {kind: 'cut', duration_in_frames: 0},
  },
  {
    shot_id: 'S02', start_frame: 120, end_frame: 240, local_video: null,
    action_state_schedule: null, intra_shot_transitions: [],
    ian_layered_scene: null, whiteboard: null, transition: null,
  },
];

const assetFor = (role) => {
  const asset = library.assets.find(({semantic_roles: roles}) => roles.includes(role));
  assert.ok(asset, `missing fixture role ${role}`);
  return asset;
};

const silent = (event, reason = '可选画面事件不需额外强调') => ({
  ...event,
  decision: 'silent',
  reason,
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
});

const makeAudible = (event, {
  role = 'state_change',
  intensity = 'micro',
  owner = 'global_sound_effect_track_v1',
  groupId = `cue:${event.event_id}`,
  primaryEventId = event.event_id,
  coveredEventIds = [event.event_id],
  asset = assetFor(role),
} = {}) => ({
  ...event,
  decision: 'audible',
  reason: '画面结构发生真实且可见的变化',
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
    path: `${episodeWorkspace}/assets/audio/sfx/${event.event_id.replaceAll(':', '-')}.wav`,
    asset: `example/assets/audio/sfx/${event.event_id.replaceAll(':', '-')}.wav`,
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
  gain_multiplier: 0.24,
  cue_group_id: groupId,
  primary_render_event_id: primaryEventId,
  covered_event_ids: coveredEventIds,
  selection_basis: {
    selection_method: 'hard-gates-then-deterministic-ranking-v1',
    visible_event: '画面结构发生真实且可见的变化',
    visual_route: 'imagegen',
    material: asset.timbre_family,
    motion_direction: 'none',
    energy: intensity,
    attack_class: 'transient',
    duration_fit: 'pretrimmed',
    narration_masking_risk: 'low',
    semantic_role: role,
    selected_asset_id: asset.asset_id,
    selected_reason: '画面结构发生真实且可见的变化',
    hard_gate_results: {
      license: true,
      media: true,
      semantic_role: true,
      motion_direction: true,
    },
    rejected_candidates: [],
  },
  qa_result: 'pass',
});

const buildValue = (targetShots = shots, durationFrames = 240) => {
  const events = deriveSoundDesignCandidateEvents(targetShots).map((event) => (
    event.required_audible ? makeAudible(event) : silent(event)
  ));
  const value = {
    contract_version: KNOWLEDGE_VIDEO_SOUND_DESIGN_VERSION,
    status: 'qa_passed',
    resume_mode: 'standard',
    revoice: null,
    episode_workspace: episodeWorkspace,
    fps: 30,
    duration_frames: durationFrames,
    policy: structuredClone(KNOWLEDGE_VIDEO_SOUND_DESIGN_POLICY),
    bindings: structuredClone(bindings),
    bus_gain_multiplier: 1.12,
    shot_analysis: targetShots.map((shot) => ({
      shot_id: shot.shot_id,
      storyboard_content_analyzed: true,
      visible_action_analysis: 'complete',
      local_video_action_analysis: shot.local_video == null ? 'not_applicable' : 'complete',
      candidate_event_ids: events.filter(({shot_id: shotId}) => shotId === shot.shot_id)
        .map(({event_id}) => event_id),
    })),
    events,
    event_map_sha256: '',
    result: 'pass',
  };
  value.event_map_sha256 = buildSoundDesignMapSha256(value);
  return value;
};

const validate = (value, targetShots = shots, durationFrames = 240, options = {}) => (
  validateKnowledgeVideoSoundDesign(value, {
    shots: targetShots,
    durationFrames,
    episodeWorkspace,
    repositoryRoot,
    libraryValidation: library,
    expectedBindings: bindings,
    verifyFiles: false,
    ...options,
  })
);

const addSemantic = (value, suffix, frame, decision = 'silent') => {
  const candidate = {
    event_id: `S01:semantic:${suffix}`,
    shot_id: 'S01',
    anchor_kind: 'visible-reveal',
    cue_frame: frame,
    sync_frame: frame,
    required_audible: false,
    candidate_source: 'semantic',
  };
  value.events.push(decision === 'audible' ? makeAudible(candidate) : silent(candidate));
  value.shot_analysis[0].candidate_event_ids.push(candidate.event_id);
  value.event_map_sha256 = buildSoundDesignMapSha256(value);
  return candidate.event_id;
};

test('derives one frame-zero opening, one merged incoming boundary, and audible cut transitions', () => {
  const events = deriveSoundDesignCandidateEvents(shots);
  assert.deepEqual(events.filter(({required_audible: required}) => required).map((event) => ({
    id: event.event_id,
    kind: event.anchor_kind,
    cue: event.cue_frame,
    sync: event.sync_frame,
  })), [
    {id: 'S01:opening', kind: 'shot-opening', cue: 0, sync: 0},
    {id: 'S01:intra-transition:A:B', kind: 'intra-shot-transition', cue: 45, sync: 45},
    {id: 'S02:incoming-boundary', kind: 'shot-boundary', cue: 120, sync: 120},
  ]);
  assert.equal(events.some(({event_id}) => event_id.endsWith('outgoing-transition')), false);
});

test('requires every structural opening, boundary, and intra-shot cut to be audible', () => {
  const value = buildValue();
  assert.equal(validate(value).structural_coverage_result, 'pass');
  const opening = value.events.findIndex(({anchor_kind}) => anchor_kind === 'shot-opening');
  value.events[opening] = silent(value.events[opening]);
  value.event_map_sha256 = buildSoundDesignMapSha256(value);
  assert.throws(() => validate(value), /required structural event cannot be silent/);
});

test('merges compatible concurrent anchors into one rendered cue group', () => {
  const value = buildValue();
  const transition = value.events.find(({anchor_kind}) => anchor_kind === 'intra-shot-transition');
  const semanticId = addSemantic(value, 'same-change', transition.cue_frame, 'audible');
  const groupId = 'cue:S01:combined-change';
  const covered = [transition.event_id, semanticId];
  const primary = transition.event_id;
  const shared = makeAudible(transition, {
    groupId, primaryEventId: primary, coveredEventIds: covered,
  });
  value.events[value.events.findIndex(({event_id}) => event_id === transition.event_id)] = shared;
  value.events[value.events.findIndex(({event_id}) => event_id === semanticId)] = {
    ...shared,
    event_id: semanticId,
    anchor_kind: 'visible-reveal',
    candidate_source: 'semantic',
    required_audible: false,
  };
  value.event_map_sha256 = buildSoundDesignMapSha256(value);
  const result = validate(value);
  assert.equal(result.events.filter(({cue_group_id: id}) => id === groupId).length, 2);
  assert.equal(result.audible_cues.filter(({cue_group_id: id}) => id === groupId).length, 1);
});

test('rejects incomplete cue-group coverage and incomplete selection evidence', () => {
  const group = buildValue();
  group.events[0].covered_event_ids = ['missing'];
  group.event_map_sha256 = buildSoundDesignMapSha256(group);
  assert.throws(() => validate(group), /cue group coverage/);

  const selection = buildValue();
  selection.events[0].selection_basis.hard_gate_results.motion_direction = false;
  selection.event_map_sha256 = buildSoundDesignMapSha256(selection);
  assert.throws(() => validate(selection), /selection basis/);
});

test('keeps abstract narration invalid and optional visible events reasoned', () => {
  const value = buildValue();
  addSemantic(value, 'optional', 80, 'silent');
  assert.equal(validate(value).result, 'pass');

  const invalid = buildValue();
  const event = silent({
    event_id: 'S01:semantic:noun', shot_id: 'S01', anchor_kind: 'narration-emphasis',
    cue_frame: 80, sync_frame: 80, required_audible: false, candidate_source: 'semantic',
  });
  invalid.events.push(event);
  invalid.shot_analysis[0].candidate_event_ids.push(event.event_id);
  invalid.event_map_sha256 = buildSoundDesignMapSha256(invalid);
  assert.throws(() => validate(invalid), /optional visible semantic event/);

  const outside = buildValue();
  addSemantic(outside, 'outside-shot', 220, 'silent');
  assert.throws(() => validate(outside), /outside its shot/);
});

test('enforces duration-based optional budgets, strong spacing, and burst density', () => {
  const budget = buildValue();
  addSemantic(budget, 'one', 75, 'audible');
  addSemantic(budget, 'two', 100, 'audible');
  assert.throws(() => validate(budget), /optional cue budget/);

  const strong = buildValue();
  addSemantic(strong, 'one', 75, 'audible');
  addSemantic(strong, 'two', 95, 'audible');
  for (const id of ['S01:semantic:one', 'S01:semantic:two']) {
    strong.events.find(({event_id}) => event_id === id).intensity = 'strong';
    strong.events.find(({event_id}) => event_id === id).selection_basis.energy = 'strong';
  }
  strong.event_map_sha256 = buildSoundDesignMapSha256(strong);
  assert.throws(() => validate(strong), /strong sound-effect cue groups are too dense/);

  const burstShots = [{
    shot_id: 'S01', start_frame: 0, end_frame: 600, local_video: null,
    action_state_schedule: null, intra_shot_transitions: [],
    ian_layered_scene: null, whiteboard: null, transition: null,
  }];
  const burst = buildValue(burstShots, 600);
  addSemantic(burst, 'one', 5, 'audible');
  addSemantic(burst, 'two', 10, 'audible');
  addSemantic(burst, 'three', 15, 'audible');
  assert.throws(() => validate(burst, burstShots, 600), /30-frame burst limit/);
});

test('allows an incompatible mandatory boundary and Ian cue to coexist instead of dropping one', () => {
  const ianAsset = assetFor('paper_slide');
  const ianDerived = {
    path: `${episodeWorkspace}/assets/audio/sfx/ian.wav`,
    asset: 'example/assets/audio/sfx/ian.wav', checksum_sha256: 'b'.repeat(64),
    sample_rate_hz: 44100, channels: 2, format: 'wav', source_sample_rate_hz: 44100,
    trim_start_sample: 0, trim_end_sample: 4410, duration_in_frames: 3,
    runtime_transform: 'forbidden',
  };
  const conflictShots = structuredClone(shots);
  conflictShots[1].ian_layered_scene = {entry_effects: {layers: [{
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
  }]}};
  const value = buildValue(conflictShots);
  const ianIndex = value.events.findIndex(({anchor_kind}) => anchor_kind === 'ian-layer-entry');
  const ianEvent = value.events[ianIndex];
  value.events[ianIndex] = makeAudible(ianEvent, {
    role: 'paper_slide', owner: 'ian_layered_scene', asset: ianAsset,
  });
  value.events[ianIndex].reason = '关键纸卡真实入场';
  value.events[ianIndex].selection_basis.visible_event = '关键纸卡真实入场';
  value.events[ianIndex].selection_basis.visual_route = 'ian-handdrawn-ppt';
  value.events[ianIndex].selection_basis.selected_reason = '关键纸卡真实入场';
  value.events[ianIndex].derived_asset = ianDerived;
  value.events[ianIndex].gain_multiplier = 0.2;
  value.shot_analysis[1].candidate_event_ids = value.events
    .filter(({shot_id}) => shot_id === 'S02').map(({event_id}) => event_id);
  value.event_map_sha256 = buildSoundDesignMapSha256(value);
  assert.equal(validate(value, conflictShots).audible_cues
    .filter(({cue_frame}) => cue_frame === 120).length, 2);
});

test('revoice preserves v2 identities and retimes onset/sync only', () => {
  const parentValue = buildValue();
  const revoiceShots = structuredClone(shots);
  revoiceShots[0].end_frame = 150;
  revoiceShots[0].intra_shot_transitions[0].at_frame = 60;
  revoiceShots[0].action_state_schedule.occurrences[1].at_frame = 60;
  revoiceShots[1].start_frame = 150;
  revoiceShots[1].end_frame = 300;
  const revoiceBindings = structuredClone(bindings);
  delete revoiceBindings.sound_design_policy;
  revoiceBindings.narration_master.checksum_sha256 = '9'.repeat(64);
  const value = retimeKnowledgeVideoSoundDesignForRevoice({
    parentBinding: {
      path: `${episodeWorkspace}/schema/parent-sound-design.json`,
      checksum_sha256: '8'.repeat(64),
    },
    parentValue,
    shots: revoiceShots,
    durationFrames: 300,
    episodeWorkspace,
    bindings: revoiceBindings,
    repositoryRoot,
    libraryValidation: library,
    verifyFiles: false,
  });
  assert.equal(value.events.find(({event_id}) => event_id === 'S01:intra-transition:A:B').cue_frame, 60);
  assert.equal(value.events.find(({event_id}) => event_id === 'S02:incoming-boundary').sync_frame, 150);
  assert.equal(value.events[0].selection_basis.selected_asset_id,
    parentValue.events[0].selection_basis.selected_asset_id);
});

test('revoice keeps a completed legacy soundless parent soundless', () => {
  const revoiceBindings = structuredClone(bindings);
  delete revoiceBindings.sound_design_policy;
  const value = retimeKnowledgeVideoSoundDesignForRevoice({
    parentBinding: null,
    parentValue: null,
    legacySoundlessParentEvidence: {
      contract_version: 'legacy-soundless-parent-evidence-v1',
      delivery_manifest: {
        path: `${episodeWorkspace}/schema/delivery.json`, checksum_sha256: '7'.repeat(64),
      },
      sound_effect_cue_count: 0,
      sound_effect_track_present: false,
    },
    shots,
    durationFrames: 240,
    episodeWorkspace,
    bindings: revoiceBindings,
    repositoryRoot,
    libraryValidation: library,
    verifyFiles: false,
  });
  assert.equal(value.events.every(({decision}) => decision === 'silent'), true);
  assert.equal(value.revoice.reanalysis, false);
  assert.equal(value.revoice.downloaded_new_assets, false);
});
