import assert from 'node:assert/strict';
import fs from 'node:fs';

const skill = fs.readFileSync('.agents/skills/assemble-video-master/SKILL.md', 'utf8');
const reference = fs.readFileSync(
  '.agents/skills/assemble-video-master/references/remotion-assembly-and-render.md',
  'utf8',
);
const orchestrator = fs.readFileSync('.agents/skills/run-knowledge-video/SKILL.md', 'utf8');
const projectInstructions = fs.readFileSync('AGENTS.md', 'utf8');
const combined = `${skill}\n${reference}\n${orchestrator}`;

assert.match(combined, /leverage-video\/src\/shared\/reuse-registry\/registry\.json/);
assert.match(combined, /shared-reuse-decision-v1\.json/);
assert.match(combined, /validate-reuse-decision\.mjs/);
assert.match(combined, /create-reuse-decision\.mjs/);
assert.match(combined, /create-legacy-reuse-decision\.mjs/);
assert.match(combined, /--phase pre-script/);
assert.match(combined, /--phase legacy-migration/);
assert.match(combined, /--phase consumption/);
assert.match(combined, /consumer.*checksum.*import-marker|consumer source path, checksum, shared import marker/is);
assert.match(combined, /absent or empty|empty pre-script inventory/i);
assert.match(combined, /rerun consumption validation|reruns consumption validation/i);
assert.match(combined, /before creating or copying any episode-local script/i);
assert.match(combined, /every registered shared module/i);
assert.match(combined, /exact user authorization|explicit user authorization/i);
assert.match(combined, /full.*existing.*script.*inventory|complete.*legacy.*script.*inventory/is);
assert.match(combined, /must not.*move|must not.*clear|do not.*move|do not.*clear/is);
assert.match(combined, /reuse|extend_shared|not_applicable/);
assert.match(combined, /must not copy|do not copy/i);
assert.match(orchestrator, /shared-reuse-decision-v1\.json/);
assert.match(projectInstructions, /reuse-registry/);
assert.match(projectInstructions, /shared-reuse pre-script validation/);
assert.doesNotMatch(projectInstructions, /shared-reuse-decision-v1\.json/);

console.log('shared_reuse_skill_contract=pass');
