import assert from 'node:assert/strict';
import test from 'node:test';

import {validateSummaryDurationSeconds} from './validate-final-storyboard.mjs';

test('validates the review duration as exact shot frames divided by 30', () => {
  assert.equal(validateSummaryDurationSeconds(
    {shot_id: 'S01', duration_seconds_display: '4.100'},
    {startFrame: 90, endFrame: 213},
  ), '4.100');
  assert.throws(() => validateSummaryDurationSeconds(
    {shot_id: 'S01', duration_seconds_display: '4.1'},
    {startFrame: 90, endFrame: 213},
  ), /does not match exact 30 fps frame timing/);
});
