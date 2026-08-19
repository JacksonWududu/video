import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

import {buildDefaultIntraShotTransitions} from '../../../../leverage-video/src/shared/intra-shot-transitions/contract.mjs';

const root = mkdtempSync(path.join(tmpdir(), 'intra-shot-v3-validator-'));
const validator = path.resolve('.agents/skills/assemble-video-master/scripts/validate-intra-shot-transitions.mjs');
const source = path.join(root, 'Composition.tsx');
writeFileSync(source, "import {IntraShotImageSequence} from 'leverage-video/src/shared/intra-shot-transitions';\n");
const images = [
  {asset_id: 'a', asset: 'a.png', from: 0, duration_in_frames: 30},
  {asset_id: 'b', asset: 'b.png', from: 30, duration_in_frames: 33},
];
const buildPlan = (transitions) => ({
  canvas: {fps: 30},
  qa_contract: {intra_shot_transition_contract: 'intra-shot-transition-v1'},
  scenes: [{
    shot_id: 'S01',
    intra_shot_transition_contract: 'intra-shot-transition-v1',
    image_sequence: images,
    intra_shot_transitions: transitions,
  }],
});
const run = (plan) => {
  const planPath = path.join(root, 'plan.json');
  writeFileSync(planPath, JSON.stringify(plan));
  return spawnSync(process.execPath, [validator, planPath, source], {encoding: 'utf8'});
};

const cuts = buildDefaultIntraShotTransitions({imageSequence: images, fps: 30});
const pass = run(buildPlan(cuts));
assert.equal(pass.status, 0, pass.stderr);

const missing = run(buildPlan([]));
assert.notEqual(missing.status, 0);
assert.match(missing.stderr, /N - 1|violates/i);

const unknown = structuredClone(cuts);
unknown[0].kind = 'none';
const unknownResult = run(buildPlan(unknown));
assert.notEqual(unknownResult.status, 0);
assert.match(unknownResult.stderr, /unsupported/i);

const watercolor = structuredClone(cuts);
Object.assign(watercolor[0], {
  kind: 'watercolor-bloom',
  duration_seconds: 0.6,
  duration_in_frames: 18,
  renderer: 'leverage-video/src/shared/watercolor-bloom',
  user_selection: {
    status: 'approved',
    exact_message: '确认使用 watercolor-bloom。',
    decided_at: '2026-08-19T10:00:00+08:00',
    presented_map_sha256: 'a'.repeat(64),
  },
});
const watercolorPass = run(buildPlan(watercolor));
assert.equal(watercolorPass.status, 0, watercolorPass.stderr);

watercolor[0].user_selection = null;
const unapproved = run(buildPlan(watercolor));
assert.notEqual(unapproved.status, 0);
assert.match(unapproved.stderr, /explicit approved/i);

rmSync(root, {recursive: true});
console.log('validate_intra_shot_transitions=pass');
