#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  LEGACY_SCENE_TRANSITION_CATALOG_VERSION,
  LEGACY_TRANSITION_CATALOG,
  validateUserApprovedTransition,
} from './contract.mjs';

assert.equal(LEGACY_SCENE_TRANSITION_CATALOG_VERSION, 'scene-transition-catalog-v2');
for (const kind of [
  'dissolve',
  'paper-wipe',
  'watercolor-bloom',
  'match-cut',
  'fade',
  'slide',
  'wipe',
  'flip',
  'clock-wipe',
  'iris',
  'linear-blur',
  'zoom-blur',
]) {
  assert.ok(LEGACY_TRANSITION_CATALOG.some((entry) => entry.kind === kind), `missing ${kind}`);
}

const approvedSlide = {
  contract_version: 'scene-transition-v2',
  catalog_version: 'scene-transition-catalog-v2',
  source_shot_id: 'S01',
  next_shot_id: 'S02',
  kind: 'slide',
  options: {direction: 'from-left'},
  duration_seconds: 0.4,
  duration_in_frames: 12,
  source_intent: 'S01→S02 使用从左进入的 slide，0.4 秒',
  renderer: 'leverage-video/src/shared/scene-transitions',
  user_selection: {
    status: 'approved',
    exact_message: '确认推荐表里的全部转场',
    decided_at: '2026-08-14T10:00:00+08:00',
    presented_map_sha256: 'b'.repeat(64),
  },
};

assert.deepEqual(
  validateUserApprovedTransition(approvedSlide, {
    fps: 30,
    sourceShotId: 'S01',
    nextShotId: 'S02',
  }),
  approvedSlide,
);

for (const invalid of [
  {...approvedSlide, kind: 'none'},
  {...approvedSlide, kind: 'cube'},
  {...approvedSlide, user_selection: {...approvedSlide.user_selection, status: 'pending'}},
  {...approvedSlide, user_selection: {...approvedSlide.user_selection, exact_message: ''}},
  {...approvedSlide, user_selection: {...approvedSlide.user_selection, presented_map_sha256: 'short'}},
  {...approvedSlide, source_shot_id: 'S99'},
  {...approvedSlide, next_shot_id: 'S99'},
  {...approvedSlide, options: {}},
]) {
  assert.throws(
    () => validateUserApprovedTransition(invalid, {
      fps: 30,
      sourceShotId: 'S01',
      nextShotId: 'S02',
    }),
  );
}

console.log('scene_transition_selection_v2=pass');
