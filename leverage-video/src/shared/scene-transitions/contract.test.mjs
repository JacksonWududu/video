#!/usr/bin/env node
import assert from 'node:assert/strict';
import {resolveTransitionIntent, TRANSITION_KINDS} from './contract.mjs';

assert.deepEqual(TRANSITION_KINDS, [
  'dissolve',
  'paper-wipe',
  'watercolor-bloom',
  'match-cut',
]);

const cases = [
  ['0.4s dissolve to timeline', 'dissolve', 12],
  ['0.4s paper wipe', 'paper-wipe', 12],
  ['0.3s hard paper cut', 'paper-wipe', 9],
  ['0.5s watercolor bloom', 'watercolor-bloom', 15],
  ['0.4s match cut on watch circle', 'match-cut', 12],
  ['0.4s cut on stopped token', 'match-cut', 12],
  ['0.3s hard swap into concept arrows', 'paper-wipe', 9],
  ['0.4s paper slide', 'paper-wipe', 12],
  ['0.5s fade to feedback loop', 'dissolve', 15],
  ['0.3s hard cut', 'paper-wipe', 9],
];

for (const [intent, kind, frames] of cases) {
  const resolved = resolveTransitionIntent({intent, fps: 30, isTerminal: false});
  assert.equal(resolved.kind, kind, intent);
  assert.equal(resolved.duration_in_frames, frames, intent);
  assert.equal(resolved.source_intent, intent);
  assert.equal(resolved.contract_version, 'scene-transition-v1');
}

assert.equal(
  resolveTransitionIntent({
    intent: 'clean hold within S19 to the audio end',
    fps: 30,
    isTerminal: true,
  }),
  null,
);

assert.throws(
  () => resolveTransitionIntent({intent: '', fps: 30, isTerminal: false}),
  /missing transition intent/,
);
assert.throws(
  () => resolveTransitionIntent({intent: '0.2s dissolve', fps: 30, isTerminal: false}),
  /0\.3–0\.6 seconds/,
);
assert.throws(
  () => resolveTransitionIntent({intent: '0.7s dissolve', fps: 30, isTerminal: false}),
  /0\.3–0\.6 seconds/,
);
assert.throws(
  () => resolveTransitionIntent({intent: '0.4s glitch vortex', fps: 30, isTerminal: false}),
  /unmapped transition intent/,
);
assert.throws(
  () => resolveTransitionIntent({intent: '0.4s dissolve', fps: 30, isTerminal: true}),
  /terminal scene/,
);

console.log('scene_transition_contract=pass');
