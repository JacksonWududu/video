import assert from 'node:assert/strict';

import {assertContained} from './validate-ian-text-containment.mjs';

assert.throws(
  () => assertContained(
    {x: 957, y: 660, width: 187, height: 79},
    {x: 890, y: 672, width: 380, height: 256},
    12,
    '一次结果≠无法改变',
  ),
  /escape the intended container/,
);

assert.doesNotThrow(() => assertContained(
  {x: 957, y: 750, width: 187, height: 79},
  {x: 890, y: 672, width: 380, height: 256},
  12,
  '一次结果≠无法改变',
));

process.stdout.write('Ian text containment tests passed\n');
