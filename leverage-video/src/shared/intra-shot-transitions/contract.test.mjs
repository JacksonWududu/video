import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDefaultIntraShotTransitions,
  validateIntraShotTransitionSequence,
} from './contract.mjs';

const imageSequence = [
  {asset_id: 'state-01', from: 0, duration_in_frames: 30},
  {asset_id: 'state-02', from: 30, duration_in_frames: 33},
  {asset_id: 'state-03', from: 63, duration_in_frames: 24},
];

test('builds a complete zero-frame cut map by default', () => {
  const transitions = buildDefaultIntraShotTransitions({imageSequence, fps: 30});
  assert.equal(transitions.length, 2);
  assert.deepEqual(transitions.map(({kind, duration_in_frames, renderer}) => ({
    kind,
    duration_in_frames,
    renderer,
  })), [
    {kind: 'cut', duration_in_frames: 0, renderer: null},
    {kind: 'cut', duration_in_frames: 0, renderer: null},
  ]);
  assert.equal(validateIntraShotTransitionSequence({imageSequence, transitions, fps: 30}).result, 'pass');
});

test('accepts an explicit mixed cut and watercolor map', () => {
  const transitions = buildDefaultIntraShotTransitions({imageSequence, fps: 30});
  transitions[0] = {
    ...transitions[0],
    kind: 'watercolor-bloom',
    duration_seconds: 0.6,
    duration_in_frames: 18,
    renderer: 'leverage-video/src/shared/watercolor-bloom',
    user_selection: {
      status: 'approved',
      exact_message: '确认第一次状态切换使用 watercolor-bloom。',
      decided_at: '2026-08-19T10:00:00+08:00',
      presented_map_sha256: 'a'.repeat(64),
    },
  };
  assert.equal(validateIntraShotTransitionSequence({imageSequence, transitions, fps: 30}).result, 'pass');
});

test('rejects missing, unknown, stale, and unreadable transitions', () => {
  const transitions = buildDefaultIntraShotTransitions({imageSequence, fps: 30});
  assert.throws(
    () => validateIntraShotTransitionSequence({imageSequence, transitions: [], fps: 30}),
    /exactly N - 1/,
  );
  assert.throws(
    () => validateIntraShotTransitionSequence({
      imageSequence,
      transitions: [{...transitions[0], kind: 'none'}, transitions[1]],
      fps: 30,
    }),
    /unsupported/,
  );
  assert.throws(
    () => validateIntraShotTransitionSequence({
      imageSequence,
      transitions: [{...transitions[0], to_image_index: 2}, transitions[1]],
      fps: 30,
    }),
    /contract mismatch/,
  );
  const tooShort = imageSequence.map((item, index) => index === 1
    ? {...item, duration_in_frames: 32}
    : item);
  tooShort[2] = {...tooShort[2], from: 62};
  const watercolor = buildDefaultIntraShotTransitions({imageSequence: tooShort, fps: 30});
  watercolor[0] = {
    ...watercolor[0],
    kind: 'watercolor-bloom',
    duration_seconds: 0.6,
    duration_in_frames: 18,
    renderer: 'leverage-video/src/shared/watercolor-bloom',
    user_selection: {
      status: 'approved',
      exact_message: '确认第一次状态切换使用 watercolor-bloom。',
      decided_at: '2026-08-19T10:00:00+08:00',
      presented_map_sha256: 'a'.repeat(64),
    },
  };
  assert.throws(
    () => validateIntraShotTransitionSequence({imageSequence: tooShort, transitions: watercolor, fps: 30}),
    /15-frame clean hold/,
  );
  const unapproved = structuredClone(watercolor);
  unapproved[0].user_selection = null;
  assert.throws(
    () => validateIntraShotTransitionSequence({imageSequence: tooShort, transitions: unapproved, fps: 30}),
    /explicit approved user selection/i,
  );
});
