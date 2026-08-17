#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  INTRA_SHOT_WATERCOLOR_BLOOM_RULE_ID,
  validateIntraShotWatercolorTransition,
} from '../../../../leverage-video/src/shared/watercolor-bloom/contract.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, '../../../..');

const [planPath, compositionPath] = process.argv.slice(2);
if (!planPath || !compositionPath) {
  console.error('usage: validate-intra-shot-watercolor-transitions.mjs <assembly-plan.json> <composition-source.tsx>');
  process.exit(2);
}

const fail = (message) => {
  console.error(`FAIL ${message}`);
  process.exit(1);
};

const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const fps = plan?.canvas?.fps;
if (!Number.isFinite(fps) || fps <= 0) fail('assembly plan must declare a positive canvas.fps');
let source = fs.readFileSync(compositionPath, 'utf8');
if (/shared\/video-scenes/.test(source) && /KnowledgeVideo/.test(source)) {
  source = [
    source,
    fs.readFileSync(path.join(repositoryRoot, 'leverage-video/src/shared/video-scenes/NarrativeScene.tsx'), 'utf8'),
    fs.readFileSync(path.join(repositoryRoot, 'leverage-video/src/shared/video-scenes/GraphicScene.tsx'), 'utf8'),
    fs.readFileSync(path.join(repositoryRoot, 'leverage-video/src/shared/video-scenes/DoodleScene.tsx'), 'utf8'),
    fs.readFileSync(path.join(repositoryRoot, 'leverage-video/src/shared/video-scenes/ComicScene.tsx'), 'utf8'),
  ].join('\n');
}
if (!/(?:shared\/|\.\.\/)watercolor-bloom/.test(source) || !/WatercolorImageSequence/.test(source)) {
  fail('composition is not bound to leverage-video/src/shared/watercolor-bloom');
}

let requiredPairs = 0;
for (const scene of plan.scenes ?? []) {
  const images = scene.image_sequence ?? [];
  if (!Array.isArray(images)) fail(`${scene.id ?? 'unknown'} image_sequence must be an array`);
  const transitions = scene.intra_shot_transitions ?? [];
  if (!Array.isArray(transitions)) fail(`${scene.id ?? 'unknown'} intra_shot_transitions must be an array`);
  const expected = Math.max(0, images.length - 1);
  if (transitions.length !== expected) {
    fail(`${scene.id ?? 'unknown'} must have exactly N - 1 intra-shot transitions (${expected}), found ${transitions.length}`);
  }
  requiredPairs += expected;
  transitions.forEach((transition, index) => {
    try {
      validateIntraShotWatercolorTransition(transition, {
        fps,
        fromImageIndex: index,
        toImageIndex: index + 1,
      });
    } catch {
      fail(`${scene.id ?? scene.shot_id ?? 'unknown'} pair ${index}->${index + 1} violates ${INTRA_SHOT_WATERCOLOR_BLOOM_RULE_ID}`);
    }
  });
}

console.log(`PASS ${INTRA_SHOT_WATERCOLOR_BLOOM_RULE_ID} pairs=${requiredPairs}`);
