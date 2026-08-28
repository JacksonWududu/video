import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

import {buildKnowledgeVideoSoundDesign} from './build-sound-design.mjs';
import {loadAndValidateSharedSoundEffectLibrary} from './contract.mjs';
import {deriveSoundDesignCandidateEvents} from './sound-design.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const library = loadAndValidateSharedSoundEffectLibrary({repositoryRoot});
const episodeWorkspace = 'leverage-video/src/example';
const shots = [{
  shot_id: 'S01', start_frame: 0, end_frame: 90, local_video: null,
  action_state_schedule: null, intra_shot_transitions: [], whiteboard: null,
  ian_layered_scene: null, transition: null,
}];
const asset = library.assets.find(({semantic_roles}) => semantic_roles.includes('state_change'));
const opening = deriveSoundDesignCandidateEvents(shots)[0];
const input = {
  resume_mode: 'standard',
  episode_workspace: episodeWorkspace,
  duration_frames: 90,
  shots,
  semantic_events: [],
  event_decisions: [{
    event_id: opening.event_id,
    decision: 'audible',
    reason: 'S01 从第零帧进入，使用低遮蔽微瞬态标记开场',
    semantic_role: 'state_change',
    intensity: 'micro',
    asset_id: asset.asset_id,
    gain_multiplier: 0.24,
    derived_asset: {
      path: `${episodeWorkspace}/assets/audio/sfx/opening.wav`,
      asset: 'example/assets/audio/sfx/opening.wav',
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
    selection_basis: {
      selection_method: 'hard-gates-then-deterministic-ranking-v1',
      visible_event: 'S01 从第零帧进入',
      visual_route: 'imagegen',
      material: asset.timbre_family,
      motion_direction: 'none',
      energy: 'micro',
      attack_class: 'transient',
      duration_fit: 'pretrimmed',
      narration_masking_risk: 'low',
      semantic_role: 'state_change',
      selected_asset_id: asset.asset_id,
      selected_reason: 'S01 从第零帧进入，使用低遮蔽微瞬态标记开场',
      hard_gate_results: {
        license: true, media: true, semantic_role: true, motion_direction: true,
      },
      rejected_candidates: [],
    },
  }],
  bindings: {
    storyboard: {path: 'storyboard', checksum_sha256: '1'.repeat(64)},
    narration_master: {path: 'narration', checksum_sha256: '2'.repeat(64)},
    visual_manifest: {path: 'visual', checksum_sha256: '3'.repeat(64)},
    visual_rhythm: {path: 'rhythm', checksum_sha256: '4'.repeat(64)},
    transition_review: {path: 'transition', checksum_sha256: '5'.repeat(64)},
    sound_effect_library: structuredClone(library.manifest),
  },
};

test('builds v2 with mandatory frame-zero opening, policy binding, and louder initial bus', () => {
  const value = buildKnowledgeVideoSoundDesign(input, {
    repositoryRoot, libraryValidation: library, verifyFiles: false,
  });
  assert.equal(value.contract_version, 'knowledge-video-sound-design-v2');
  assert.equal(value.events[0].decision, 'audible');
  assert.equal(value.events[0].cue_frame, 0);
  assert.equal(value.events[0].sync_frame, 0);
  assert.equal(value.events[0].selection_basis.selected_asset_id, asset.asset_id);
  assert.equal(value.bindings.sound_design_policy.path.endsWith('sound-design-policy-v2.json'), true);
  assert.equal(value.bus_gain_multiplier, 1.12);
});

test('fails rather than silently accepting a missing structural decision', () => {
  const incomplete = structuredClone(input);
  incomplete.event_decisions = [];
  assert.throws(() => buildKnowledgeVideoSoundDesign(incomplete, {
    repositoryRoot, libraryValidation: library, verifyFiles: false,
  }), /analysis is missing/);
});

test('fails when a required opening is explicitly marked silent', () => {
  const silent = structuredClone(input);
  silent.event_decisions[0] = {
    event_id: opening.event_id,
    decision: 'silent',
    reason: '错误地让开场静音',
  };
  assert.throws(() => buildKnowledgeVideoSoundDesign(silent, {
    repositoryRoot, libraryValidation: library, verifyFiles: false,
  }), /required structural event cannot be silent/);
});
