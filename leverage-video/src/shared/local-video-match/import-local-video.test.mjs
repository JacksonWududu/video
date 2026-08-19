import assert from 'node:assert/strict';
import test from 'node:test';

import {validateDeferredQueuePosition} from './import-local-video.mjs';

const state = () => ({
  visual_asset_review: {
    mode: 'hybrid_batch_v1',
    batch_size: 4,
    queue_generation_allowed: true,
    queue: [
      {
        asset_id: 'S01-image-v01',
        shot_id: 'S01',
        visual_generation_route: 'imagegen',
        status: 'approved',
      },
      {
        asset_id: 'S02-local-v01',
        shot_id: 'S02',
        visual_generation_route: 'local-video-file',
        status: 'pending_generation',
      },
      {
        asset_id: 'S03-local-v01',
        shot_id: 'S03',
        visual_generation_route: 'local-video-file',
        status: 'pending_generation',
      },
    ],
  },
});

test('unlocks local video only after every generated visual is approved', () => {
  assert.equal(validateDeferredQueuePosition(state(), 'S02').asset_id, 'S02-local-v01');
  const pendingGenerated = state();
  pendingGenerated.visual_asset_review.queue[0].status = 'pending_generation';
  assert.throws(
    () => validateDeferredQueuePosition(pendingGenerated, 'S02'),
    /not the next deferred|must be approved/,
  );
});

test('keeps deferred local video items last and sequential', () => {
  const outOfOrder = state();
  outOfOrder.visual_asset_review.queue.push({
    asset_id: 'S04-image-v01',
    shot_id: 'S04',
    visual_generation_route: 'imagegen',
    status: 'approved',
  });
  assert.throws(
    () => validateDeferredQueuePosition(outOfOrder, 'S02'),
    /must follow every generated visual/,
  );
  assert.throws(
    () => validateDeferredQueuePosition(state(), 'S03'),
    /not the next deferred local-video import target/,
  );
});
