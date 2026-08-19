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
  whiteboard: fs.readFileSync('.agents/skills/srt-whiteboard-animation/SKILL.md', 'utf8'),
  actionFamily: fs.readFileSync('.agents/skills/produce-video-visuals/references/action-family-contract.md', 'utf8'),
  visualLanguage: fs.readFileSync('.agents/skills/run-knowledge-video/references/visual-language-and-comic-routing.md', 'utf8'),
};

for (const [name, source] of Object.entries(files)) {
  assert.match(source, /intra-shot-transition-v1|raster transition map|intra-shot transitions/i, `${name} lacks the v3 transition rule`);
}

assert.match(files.storyboardContract, /image_sequence/);
assert.match(files.storyboardContract, /intra_shot_transitions/);
assert.match(files.assetLock, /exactly N - 1/);
assert.match(files.renderContract, /IntraShotImageSequence/);
assert.match(files.renderContract, /default.*cut|normally zero-frame cuts/i);
assert.match(files.renderContract, /watercolor.*explicit/i);
assert.match(files.renderContract, /validate-intra-shot-transitions\.mjs/);
assert.doesNotMatch(files.storyboard, /use hard swaps without interpolation/);
assert.match(files.whiteboard, /scene-transition-v3/);
assert.doesNotMatch(files.whiteboard, /2[–-]4 张动作状态图|scene-transition-v2/);
assert.match(files.actionFamily, /action-state-schedule-v3/);
assert.match(files.actionFamily, /stateful.*2[–-]4/);
assert.match(files.actionFamily, /hero_pose.*4[–-]6/);
assert.doesNotMatch(files.visuals, /each locked to `intra-shot-watercolor-bloom-v1`/);
assert.doesNotMatch(files.actionFamily, /two-to-four action variants/);
assert.match(files.visualLanguage, /Use v3 and an active route for every new shot/);
assert.doesNotMatch(files.visualLanguage, /Use v2 for every new shot/);

console.log('intra_shot_transition_skill_contract=pass');
