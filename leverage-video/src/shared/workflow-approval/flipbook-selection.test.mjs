import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFlipbookStyleSelection, buildWhiteCatVisualStyleSelectionSha256,
  validateWhiteCatVisualStyleSelection,
} from './contract.mjs';
import {FLIPBOOK_PROFILE_SHA256} from '../flipbook-video/profile.mjs';

const gate = 'a'.repeat(64);
const selection = () => buildFlipbookStyleSelection({
  gate2ScriptSha256: gate,
  profilePath: 'leverage-video/src/topic999/schema/flipbook-style-v1.json',
  decision: {status: 'selected', exact_message: '图文翻书，standard，manual，edge_tts', decided_at: '2026-09-05T00:00:00+08:00'},
});
test('flipbook selection is an immutable style snapshot in the existing selection chain', () => {
  const value = selection();
  assert.equal(validateWhiteCatVisualStyleSelection(value, {gate2ScriptSha256: gate}).style_id, 'illustrated-flipbook');
  assert.equal(value.style_profile_checksum_sha256, FLIPBOOK_PROFILE_SHA256);
  assert.equal(value.publishing_cover_package_path, null);
});
test('a changed script, profile, source, or decision cannot reuse flipbook approval', () => {
  assert.throws(() => validateWhiteCatVisualStyleSelection(selection(), {gate2ScriptSha256: 'b'.repeat(64)}), /stale/);
  for (const [key, value] of [
    ['style_profile_checksum_sha256', 'b'.repeat(64)], ['style_source', 'registered_custom'],
    ['style_profile_path', '../active/profile.json'], ['source_style_id', 'loose-line-vivid-watercolor'],
    ['publishing_cover_package_path', 'cover.png'],
  ]) {
    const changed = {...selection(), [key]: value};
    changed.selection_sha256 = buildWhiteCatVisualStyleSelectionSha256(changed);
    assert.throws(() => validateWhiteCatVisualStyleSelection(changed, {gate2ScriptSha256: gate}));
  }
  const stale = selection(); stale.decision.exact_message = '改为其他风格';
  assert.throws(() => validateWhiteCatVisualStyleSelection(stale, {gate2ScriptSha256: gate}), /checksum/);
});
