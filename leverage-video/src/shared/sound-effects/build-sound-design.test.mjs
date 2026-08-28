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
const input = {
  resume_mode: 'standard',
  episode_workspace: episodeWorkspace,
  duration_frames: 90,
  shots,
  semantic_events: [],
  event_decisions: deriveSoundDesignCandidateEvents(shots).map(({event_id: eventId}) => ({
    event_id: eventId,
    decision: 'silent',
    reason: '无真实动作、揭示、反馈或强调需要配音',
  })),
  bindings: {
    storyboard: {path: 'storyboard', checksum_sha256: '1'.repeat(64)},
    narration_master: {path: 'narration', checksum_sha256: '2'.repeat(64)},
    visual_manifest: {path: 'visual', checksum_sha256: '3'.repeat(64)},
    visual_rhythm: {path: 'rhythm', checksum_sha256: '4'.repeat(64)},
    transition_review: {path: 'transition', checksum_sha256: '5'.repeat(64)},
    sound_effect_library: structuredClone(library.manifest),
  },
};

test('builds a complete standard sound design without inventing missing decisions', () => {
  const value = buildKnowledgeVideoSoundDesign(input, {
    repositoryRoot, libraryValidation: library, verifyFiles: false,
  });
  assert.equal(value.result, 'pass');
  assert.equal(value.events.length, 1);
  assert.equal(value.events[0].decision, 'silent');
  assert.equal(value.shot_analysis[0].visible_action_analysis, 'complete');
  const incomplete = structuredClone(input);
  incomplete.event_decisions = [];
  assert.throws(() => buildKnowledgeVideoSoundDesign(incomplete, {
    repositoryRoot, libraryValidation: library, verifyFiles: false,
  }), /analysis is missing/);
});
