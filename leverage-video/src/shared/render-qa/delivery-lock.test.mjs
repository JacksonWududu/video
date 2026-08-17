import assert from 'node:assert/strict';
import test from 'node:test';

import {validateDeliveryRoleSet} from './delivery-lock.mjs';

test('requires exact delivery role equality', () => {
  assert.deepEqual(
    validateDeliveryRoleSet(['caption_free_master'], {caption_free_master: {}}),
    ['caption_free_master'],
  );
  assert.throws(
    () => validateDeliveryRoleSet(['caption_free_master'], {
      caption_free_master: {},
      captioned_master: {},
    }),
    /delivery role mismatch/,
  );
});
