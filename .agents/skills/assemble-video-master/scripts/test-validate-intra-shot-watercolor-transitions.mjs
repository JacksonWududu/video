import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

import {
  INTRA_SHOT_WATERCOLOR_BLOOM_KIND,
  INTRA_SHOT_WATERCOLOR_BLOOM_RENDERER,
  INTRA_SHOT_WATERCOLOR_BLOOM_RULE_ID,
  INTRA_SHOT_WATERCOLOR_BLOOM_SECONDS,
} from '../../../../leverage-video/src/shared/watercolor-bloom/contract.mjs';

const root = mkdtempSync(path.join(tmpdir(), 'intra-shot-watercolor-test-'));
const validator = path.resolve('.agents/skills/assemble-video-master/scripts/validate-intra-shot-watercolor-transitions.mjs');
const source = path.join(root, 'Composition.tsx');
writeFileSync(source, "import {WatercolorImageSequence} from 'leverage-video/src/shared/watercolor-bloom';\nexport const C=()=> <WatercolorImageSequence occurrences={[]}/>;\n");
const sharedWrapperSource = path.join(root, 'SharedComposition.tsx');
writeFileSync(sharedWrapperSource, "import {KnowledgeVideo} from '../../../shared/video-scenes';\nexport const C=()=> <KnowledgeVideo plan={plan}/>;\n");

const run = (scenes) => {
  const plan = path.join(root, 'plan.json');
  writeFileSync(plan, JSON.stringify({canvas: {fps: 30}, scenes}));
  return spawnSync(process.execPath, [validator, plan, source], {encoding: 'utf8'});
};

const transition = (overrides = {}) => ({
  contract_version: INTRA_SHOT_WATERCOLOR_BLOOM_RULE_ID,
  kind: INTRA_SHOT_WATERCOLOR_BLOOM_KIND,
  duration_seconds: INTRA_SHOT_WATERCOLOR_BLOOM_SECONDS,
  duration_in_frames: 18,
  from_image_index: 0,
  to_image_index: 1,
  renderer: INTRA_SHOT_WATERCOLOR_BLOOM_RENDERER,
  ...overrides,
});

const pass = run([{id: 'S01', image_sequence: ['a.png', 'b.png', 'c.png'], intra_shot_transitions: [
  transition(),
  transition({from_image_index: 1, to_image_index: 2}),
]}]);
assert.equal(pass.status, 0, pass.stderr);

const sharedPass = spawnSync(process.execPath, [validator, path.join(root, 'plan.json'), sharedWrapperSource], {encoding: 'utf8'});
assert.equal(sharedPass.status, 0, sharedPass.stderr);

const missing = run([{id: 'S01', image_sequence: ['a.png', 'b.png'], intra_shot_transitions: []}]);
assert.notEqual(missing.status, 0);
assert.match(missing.stderr, /exactly N - 1/);

const hardCut = run([{id: 'S01', image_sequence: ['a.png', 'b.png'], intra_shot_transitions: [
  transition({contract_version: 'hard-cut', kind: 'cut', duration_seconds: 0, duration_in_frames: 0}),
]}]);
assert.notEqual(hardCut.status, 0);
assert.match(hardCut.stderr, /intra-shot-watercolor-bloom-v1/);

for (const invalid of [
  transition({duration_seconds: 0.5}),
  transition({duration_in_frames: 15}),
  transition({from_image_index: 1}),
  transition({renderer: 'wrong/renderer'}),
]) {
  const result = run([{id: 'S01', image_sequence: ['a.png', 'b.png'], intra_shot_transitions: [invalid]}]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /intra-shot-watercolor-bloom-v1/);
}

rmSync(root, {recursive: true});

console.log('validate_intra_shot_watercolor_transitions=pass');
