import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(skillRoot, relativePath), 'utf8');

test('visual production is gated by the approved per-shot direction map', () => {
  const source = read('SKILL.md');
  assert.match(source, /per-shot-visual-direction-review-v3/);
  assert.match(source, /approved and checksum-current/);
  assert.match(source, /imagegen/);
  assert.match(source, /xuan-paper-diorama.*\$generate-visual-styles.*宣纸微缩叠景/s);
  assert.match(source, /style_profile_id.*style-profile checksum.*Skill checksum/s);
  assert.match(source, /comic-imagegen.*retired.*block new or modified production/is);
  assert.match(source, /ian-handdrawn-ppt.*default no-cat structured PNGs.*ink-doodle-knowledge-card.*generate-visual-styles.*no-cat structured PNGs/s);
  assert.match(source, /comic-imagegen.*doodle-slides.*retired.*block new or modified production/is);
  assert.match(source, /srt-whiteboard-animation/);
  assert.match(source, /route mismatch/i);
});

test('Ink Doodle production binds pinned style provenance and exact PNG bytes', () => {
  const source = read('SKILL.md');
  const lock = read('references/cover-data-and-asset-lock.md');
  assert.match(source, /ink-doodle-knowledge-card.*generate-visual-styles/s);
  assert.match(source, /style_profile_id.*style-profile checksum.*Skill checksum/s);
  assert.match(lock, /ink-doodle-knowledge-card-route-v1/);
  assert.match(source, /1920×1080/);
  assert.match(lock, /Remotion consumes only the approved PNG/i);
  assert.match(lock, /exact prompt\/reference\/style fingerprints/i);
});

test('action variants inherit active narrative routes and reject legacy Comic derivatives', () => {
  const source = read('references/action-family-contract.md');
  assert.match(source, /inherit.*approved `imagegen` or `xuan-paper-diorama` route/i);
  assert.match(source, /宣纸 family preserves the same checksum-pinned style profile/i);
  assert.match(source, /Historical `comic-imagegen` families are read-only/i);
  assert.match(source, /not.*independent.*route/i);
});

test('retired Comic and Doodle routes cannot generate or derive new assets', () => {
  const source = read('SKILL.md');
  const action = read('references/action-family-contract.md');
  assert.match(source, /historical read-only evidence/i);
  assert.match(source, /Never generate, revise, normalize, reapprove, or derive/i);
  assert.match(source, /comic-imagegen.*doodle-slides.*historical read-only evidence/is);
  assert.match(action, /cannot receive a new state or derivative/i);
});

test('Whiteboard production preserves its three-stage approval and route-only exemption', () => {
  const source = read('SKILL.md');
  const review = read('references/visual-asset-review.md');
  const action = read('references/action-family-contract.md');
  assert.match(source, /source_image_review[\s\S]*annotation_review[\s\S]*clip_review/);
  assert.match(review, /Whiteboard three-stage item/);
  assert.match(review, /Batch review cannot bypass/);
  assert.match(action, /whiteboard-element-sequence-replaces-action-family-v1/);
});

test('visual approvals and the final lock reread exact disk bytes', () => {
  const source = read('SKILL.md');
  const review = read('references/visual-asset-review.md');
  assert.match(source, /visual-assets-lock-verification-v1/);
  assert.match(review, /record_hybrid_batch_approval.*repository root/i);
  assert.match(review, /recompute SHA-256 and PNG dimensions/i);
  assert.match(review, /validate_visual_approval_state\.py validate-locked/);
  assert.match(review, /immediately before assembly/i);
});
