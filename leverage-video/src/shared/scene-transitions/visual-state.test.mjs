#!/usr/bin/env node
import assert from 'node:assert/strict';

import {resolveTransitionTailStyle} from './visual-state.mjs';

const noOptions = {};
for (const kind of [
  'dissolve',
  'paper-wipe',
  'watercolor-bloom',
  'match-cut',
  'fade',
  'clock-wipe',
  'iris',
  'linear-blur',
  'zoom-blur',
]) {
  const start = resolveTransitionTailStyle({kind, options: noOptions, progress: 0});
  const middle = resolveTransitionTailStyle({kind, options: noOptions, progress: 0.5});
  const end = resolveTransitionTailStyle({kind, options: noOptions, progress: 1});
  assert.notDeepEqual(start, middle, `${kind} must visibly animate`);
  assert.notDeepEqual(middle, end, `${kind} must visibly animate through its end`);
}

for (const [kind, options] of [
  ['slide', {direction: 'from-left'}],
  ['wipe', {direction: 'from-right'}],
  ['flip', {direction: 'horizontal'}],
]) {
  const start = resolveTransitionTailStyle({kind, options, progress: 0});
  const end = resolveTransitionTailStyle({kind, options, progress: 1});
  assert.notDeepEqual(start, end, `${kind} must consume its locked option`);
}

assert.throws(
  () => resolveTransitionTailStyle({kind: 'slide', options: {}, progress: 0.5}),
  /direction/,
);
assert.throws(
  () => resolveTransitionTailStyle({kind: 'none', options: {}, progress: 0.5}),
  /Unsupported/,
);

console.log('scene_transition_visual_state=pass');
