import assert from 'node:assert/strict';
import fs from 'node:fs';

const files = {
  storyboard: fs.readFileSync('.agents/skills/build-video-storyboard/SKILL.md', 'utf8'),
  storyboardContract: fs.readFileSync('.agents/skills/build-video-storyboard/references/storyboard-contract.md', 'utf8'),
  visuals: fs.readFileSync('.agents/skills/produce-video-visuals/SKILL.md', 'utf8'),
  assetLock: fs.readFileSync('.agents/skills/produce-video-visuals/references/cover-data-and-asset-lock.md', 'utf8'),
  assembly: fs.readFileSync('.agents/skills/assemble-video-master/SKILL.md', 'utf8'),
  renderContract: fs.readFileSync('.agents/skills/assemble-video-master/references/remotion-assembly-and-render.md', 'utf8'),
  orchestrator: fs.readFileSync('.agents/skills/run-knowledge-video/SKILL.md', 'utf8'),
};

for (const [name, source] of Object.entries(files)) {
  assert.match(source, /scene-transition-v3/, `${name} lacks the inter-shot transition rule`);
}

for (const kind of ['fade', 'slide', 'wipe', 'flip', 'clock-wipe', 'iris', 'linear-blur', 'zoom-blur']) {
  assert.match(files.storyboardContract, new RegExp(kind));
  assert.match(files.renderContract, new RegExp(kind));
}

assert.match(files.storyboardContract, /every outgoing non-terminal shot/);
assert.match(files.assetLock, /every outgoing non-terminal shot/);
assert.match(files.storyboard, /Per-Boundary Transition Review/);
assert.match(files.orchestrator, /Per-Boundary Transition Review/);
assert.match(files.storyboardContract, /presented_map_sha256/);
assert.match(files.orchestrator, /validate-scene-transitions\.mjs/);
assert.match(files.orchestrator, /adjacent pre\/post frames/);

console.log('inter_shot_transition_skill_contract=pass');
