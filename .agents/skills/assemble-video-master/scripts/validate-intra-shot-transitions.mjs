#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  INTRA_SHOT_TRANSITION_VERSION,
  validateIntraShotTransitionSequence,
} from '../../../../leverage-video/src/shared/intra-shot-transitions/contract.mjs';
import {
  INTRA_SHOT_WATERCOLOR_BLOOM_RULE_ID,
  validateIntraShotWatercolorTransition,
} from '../../../../leverage-video/src/shared/watercolor-bloom/contract.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, '../../../..');
const [planPath, compositionPath] = process.argv.slice(2);

if (!planPath || !compositionPath) {
  console.error('usage: validate-intra-shot-transitions.mjs <assembly-plan.json> <composition-source.tsx>');
  process.exit(2);
}

const fail = (message) => {
  console.error(`FAIL ${message}`);
  process.exit(1);
};

const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const fps = plan?.canvas?.fps;
if (!Number.isFinite(fps) || fps <= 0) fail('assembly plan must declare a positive canvas.fps');
const contractVersion = plan?.qa_contract?.intra_shot_transition_contract;
if (![INTRA_SHOT_TRANSITION_VERSION, INTRA_SHOT_WATERCOLOR_BLOOM_RULE_ID].includes(contractVersion)) {
  fail('assembly plan declares no supported intra-shot transition contract');
}

let source = fs.readFileSync(compositionPath, 'utf8');
if (/shared\/video-scenes/.test(source) && /KnowledgeVideo/.test(source)) {
  source = [
    source,
    fs.readFileSync(path.join(repositoryRoot, 'leverage-video/src/shared/video-scenes/NarrativeScene.tsx'), 'utf8'),
    fs.readFileSync(path.join(repositoryRoot, 'leverage-video/src/shared/video-scenes/GraphicScene.tsx'), 'utf8'),
    fs.readFileSync(path.join(repositoryRoot, 'leverage-video/src/shared/video-scenes/DoodleScene.tsx'), 'utf8'),
  ].join('\n');
}
if (contractVersion === INTRA_SHOT_TRANSITION_VERSION
  && (!/intra-shot-transitions/.test(source) || !/IntraShotImageSequence/.test(source))) {
  fail('v3 composition is not bound to IntraShotImageSequence');
}
if (contractVersion === INTRA_SHOT_WATERCOLOR_BLOOM_RULE_ID
  && (!/watercolor-bloom/.test(source) || !/WatercolorImageSequence/.test(source))) {
  fail('legacy composition is not bound to WatercolorImageSequence');
}

let pairCount = 0;
for (const scene of plan.scenes ?? []) {
  const shotId = scene.shot_id ?? scene.id ?? 'unknown';
  const images = scene.image_sequence ?? [];
  const transitions = scene.intra_shot_transitions ?? [];
  if (!Array.isArray(images) || !Array.isArray(transitions)) {
    fail(`${shotId} image_sequence and intra_shot_transitions must be arrays`);
  }
  if (contractVersion === INTRA_SHOT_TRANSITION_VERSION
    && scene.intra_shot_transition_contract !== INTRA_SHOT_TRANSITION_VERSION) {
    fail(`${shotId} scene contract does not match the active v3 intra-shot contract`);
  }
  if (images.length === 0) {
    if (transitions.length !== 0) fail(`${shotId} non-raster scene must not carry intra-shot transitions`);
    continue;
  }
  try {
    if (contractVersion === INTRA_SHOT_TRANSITION_VERSION) {
      validateIntraShotTransitionSequence({imageSequence: images, transitions, fps});
    } else {
      if (transitions.length !== images.length - 1) {
        throw new Error('legacy transition count mismatch');
      }
      transitions.forEach((transition, index) => validateIntraShotWatercolorTransition(transition, {
        fps,
        fromImageIndex: index,
        toImageIndex: index + 1,
      }));
    }
  } catch (error) {
    fail(`${shotId} violates ${contractVersion}: ${error.message}`);
  }
  pairCount += transitions.length;
}

console.log(`PASS ${contractVersion} pairs=${pairCount}`);
