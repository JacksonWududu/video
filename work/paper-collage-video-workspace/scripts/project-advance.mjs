#!/usr/bin/env node
import path from 'node:path';
import {
  ROOT,
  assertSlug,
  fileExists,
  loadProject,
  projectPaths,
  readJson,
} from './project-lib.mjs';
import {advanceProduction, formatProduction} from './production-state.mjs';
import {assertSelectedProvidersReady} from './provider-lib.mjs';
import {assertCreativePlanReady} from './creative-plan-lib.mjs';
import {assertStoryboardReady} from './storyboard-lib.mjs';
import {assertStyleProofReady} from './style-proof-lib.mjs';
import {recordMotionApproval} from './motion-approval-lib.mjs';

const args = process.argv.slice(2);
const positional = args.filter((arg) => !arg.startsWith('--'));
const [slug, action] = positional;
const noteArgument = args.find((arg) => arg.startsWith('--note='));
const note = noteArgument?.slice('--note='.length) ?? '';

const requirePassingArtifact = async (slugValue, filename) => {
  const paths = projectPaths(slugValue);
  const artifact = path.join(paths.distDirectory, filename);
  const reportFile = path.join(paths.distDirectory, 'report.json');
  if (!(await fileExists(artifact)) || !(await fileExists(reportFile))) {
    throw new Error(`${filename} 或 report.json 不存在，不能记录人工批准。`);
  }
  const report = await readJson(reportFile);
  if (!report.passed || path.basename(report.artifact?.file ?? '') !== filename) {
    throw new Error(`report.json 未证明 ${filename} 已通过技术验收。`);
  }
};

try {
  if (!slug || !action) {
    throw new Error('用法：project-advance.mjs <slug> <action> [--note=说明]');
  }
  assertSlug(slug);

  const artifacts = {};
  if (action === 'capabilities-ready') {
    await assertSelectedProvidersReady(slug);
  }
  if (action === 'brief-ready') {
    const {project} = await loadProject(slug);
    assertCreativePlanReady(project.plan, {slug});
    await assertStoryboardReady(
      slug,
      project.plan,
      project.styleProfile,
    );
  }
  if (action === 'approve-style-voice') {
    const styleProof = await assertStyleProofReady(slug);
    if (styleProof.required) {
      console.log(`✓ 风格拓扑证明：${styleProof.composites.join(', ')}`);
      artifacts.styleProof = path.relative(ROOT, styleProof.report);
    }
    const motionApproval = await recordMotionApproval({
      slug,
      humanNote: note,
      styleProof,
    });
    artifacts.motionApproval = path.relative(
      ROOT,
      motionApproval.file,
    );
    console.log(
      `✓ 动作语言批准：${motionApproval.record.motionApprovalFingerprint}`,
    );
  }
  if (action === 'approve-preview') {
    await requirePassingArtifact(slug, 'preview.mp4');
  }
  if (action === 'approve-publish') {
    await requirePassingArtifact(slug, 'final.mp4');
  }

  const state = await advanceProduction(slug, action, {note, artifacts});
  console.log(`✓ 已记录：${action}`);
  console.log(formatProduction(state));
} catch (error) {
  console.error(`project:advance failed: ${error.message}`);
  process.exitCode = 1;
}
