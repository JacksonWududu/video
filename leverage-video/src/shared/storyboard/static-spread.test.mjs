import assert from 'node:assert/strict';
import test from 'node:test';
import {buildStaticSpread, validateStaticSpread, validateStaticSpreadStoryboardSection} from './static-spread.mjs';

test('static spread preserves narration bytes including punctuation and Unicode', () => {
  const sourceText = '先看这一页：甲、乙与丙。\n再问，为什么？🙂';
  const spread = buildStaticSpread(sourceText);
  assert.equal(validateStaticSpread(spread, {sourceText}).result, 'pass');
  const section = '- 图文双页：`knowledge-video-static-spread-v1`；精确计划 `' + JSON.stringify(spread) + '`。';
  assert.deepEqual(validateStaticSpreadStoryboardSection(section, 'S01', {sourceText}), spread);
  assert.throws(() => validateStaticSpread(spread, {sourceText: sourceText.replace('？', '?')}), /stale/);
  assert.throws(() => validateStaticSpreadStoryboardSection(section + '\nmotion_tier: layered', 'S01', {sourceText}), /must not contain/);
  assert.throws(() => validateStaticSpread({...spread, contract_version: 'ian-static-full-frame-v1'}), /unsupported/);
});
