#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  resolveTransitionTailProgress,
  resolveTransitionTailStyle,
} from './visual-state.mjs';

assert.equal(resolveTransitionTailProgress({tailFrame: 0, durationInFrames: 12}), 0);
assert.equal(resolveTransitionTailProgress({tailFrame: 11, durationInFrames: 12}), 11 / 12);
assert.ok(
  resolveTransitionTailProgress({tailFrame: 11, durationInFrames: 12}) < 1,
  'the last of 12 visible transition frames must retain a visible outgoing edge',
);

const paperStart = resolveTransitionTailStyle({kind: 'paper-wipe', options: {}, progress: 0});
const paperMiddle = resolveTransitionTailStyle({kind: 'paper-wipe', options: {}, progress: 0.5});
const paperLastVisible = resolveTransitionTailStyle({kind: 'paper-wipe', options: {}, progress: 11 / 12});
assert.match(paperStart.transform, /^translate3d\(/);
assert.match(paperMiddle.transform, /^translate3d\(/);
assert.match(paperLastVisible.transform, /^translate3d\(/);
assert.equal(paperStart.clipPath, undefined, 'paper wipe must not clip a frozen Canvas subtree');
assert.equal(paperMiddle.clipPath, undefined, 'paper wipe must remain compositor-stable mid-transition');
assert.notEqual(paperMiddle.transform, paperLastVisible.transform);

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
