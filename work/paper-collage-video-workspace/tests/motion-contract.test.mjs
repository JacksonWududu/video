import assert from 'node:assert/strict';
import test from 'node:test';
import {
  motionLanguageCard,
  validateMotionContractExecution,
} from '../scripts/motion-contract-lib.mjs';
import {compileStoryboardDirecting} from '../scripts/storyboard-lib.mjs';
import {
  directingRevisionAuthoring,
  directingRevisionPlan,
  directingRevisionStyleProfile,
} from '../fixtures/directing-revision-fixture.mjs';

const compile = (authoring = structuredClone(directingRevisionAuthoring)) =>
  compileStoryboardDirecting(authoring, {
    plan: directingRevisionPlan,
    styleProfile: directingRevisionStyleProfile,
  });

test('v12 compiles one attributable whole-film motion contract and action-language card', () => {
  const storyboard = compile();
  assert.equal(storyboard.motionContract.schemaVersion, 1);
  assert.equal(
    storyboard.directingSummary.styleProofPlan.motionContractFingerprint,
    storyboard.motionContract.fingerprint,
  );
  assert.deepEqual(
    storyboard.motionContract.scenes[0].phrases.map(({role}) => role),
    ['establish', 'action', 'settle'],
  );
  assert.equal(storyboard.motionContract.scenes[0].finalHoldRatio, 0.15);
  assert.match(storyboard.motionContract.approvalFingerprint, /^[a-f0-9]{64}$/);
  assert.match(storyboard.motionContract.fingerprint, /^[a-f0-9]{64}$/);

  const card = motionLanguageCard(storyboard.motionContract);
  assert.equal(
    card.approvalFingerprint,
    storyboard.motionContract.approvalFingerprint,
  );
  assert.deepEqual(
    card.scenes[0].phraseSequence.map(({role}) => role),
    ['establish', 'action', 'settle'],
  );
});

test('execution timing can change without fabricating a new human motion approval', () => {
  const baseline = compile();
  const revisedAuthoring = structuredClone(directingRevisionAuthoring);
  revisedAuthoring.scenes[0].beats[1].at = 0.5;
  const revised = compile(revisedAuthoring);
  assert.equal(
    revised.motionContract.approvalFingerprint,
    baseline.motionContract.approvalFingerprint,
  );
  assert.notEqual(
    revised.motionContract.fingerprint,
    baseline.motionContract.fingerprint,
  );
});

test('motion direction rejects ungrounded style deviations and missing hero anticipation', () => {
  const pacingDeviation = structuredClone(directingRevisionAuthoring);
  pacingDeviation.motionDirection.pacing = 'playful';
  assert.throws(
    () => compile(pacingDeviation),
    /styleDeviationRationale/,
  );

  const missingAnticipation = structuredClone(directingRevisionAuthoring);
  missingAnticipation.motionDirection.performance = {
    ...missingAnticipation.motionDirection.performance,
    grammar: ['establish', 'anticipate', 'action', 'settle'],
    anticipation: 'required-for-hero',
  };
  assert.throws(
    () => compile(missingAnticipation),
    /缺少 anticipate/,
  );
});

test('runtime execution must bind every approved performance phrase to an event and proof', () => {
  const storyboard = compile();
  const coverage = storyboard.motionContract.scenes[0];
  const project = {
    motionContract: storyboard.motionContract,
    scenes: [{
      id: coverage.sceneId,
      motion: {
        proofTimes: coverage.phrases.map(({proofTimeId}) => ({
          id: proofTimeId,
        })),
      },
      events: coverage.phrases.map(({beatId, proofTimeId}) => ({
        beatId,
        proofTimeId,
      })),
    }],
  };
  assert.deepEqual(
    validateMotionContractExecution({project, storyboard}),
    [],
  );

  project.scenes[0].events.pop();
  assert.ok(
    validateMotionContractExecution({project, storyboard}).some(
      ({code}) => code === 'motion-contract-event-missing',
    ),
  );

  project.scenes[0].events.push({
    beatId: coverage.phrases.at(-1).beatId,
    proofTimeId: coverage.phrases[0].proofTimeId,
  });
  assert.ok(
    validateMotionContractExecution({project, storyboard}).some(
      ({code}) => code === 'motion-contract-event-proof-drift',
    ),
  );
});
