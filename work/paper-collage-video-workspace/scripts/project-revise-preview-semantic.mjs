#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {resolveWorkspacePath} from './provider-lib.mjs';
import {
  fileExists,
  loadProject,
  readJson,
  writeJson,
} from './project-lib.mjs';
import {
  loadProduction,
  syncReviewFromProduction,
} from './production-state.mjs';
import {
  loadStoryboard,
  storyboardFileFor,
} from './storyboard-lib.mjs';
import {prepareSemanticRevision} from './directing-revision-lib.mjs';
import {motionLanguageCard} from './motion-contract-lib.mjs';

const args = process.argv.slice(2);
const slug = args.find((arg) => !arg.startsWith('--'));
const valueFor = (name) =>
  args
    .find((argument) => argument.startsWith(`${name}=`))
    ?.slice(name.length + 1);
const input = valueFor('--input');
const authorizationInput = valueFor('--authorization');
const json = args.includes('--json');

try {
  if (!slug || !input || !authorizationInput) {
    throw new Error(
      '用法：project:revise-preview-semantic -- <slug> --input=<storyboard.json> --authorization=<semantic-revision-authorization.json> [--json]',
    );
  }
  const [
    {project, paths},
    {paths: productionPaths, state},
    currentStoryboard,
    suppliedStoryboard,
    authorization,
  ] = await Promise.all([
    loadProject(slug),
    loadProduction(slug),
    loadStoryboard(slug),
    fs
      .readFile(
        resolveWorkspacePath(input, '语义重编 storyboard 输入路径'),
        'utf8',
      )
      .then(JSON.parse),
    fs
      .readFile(
        resolveWorkspacePath(
          authorizationInput,
          '语义重编人工授权输入路径',
        ),
        'utf8',
      )
      .then(JSON.parse),
  ]);
  let scenarioOption = null;
  if (
    project.plan?.scenarioBinding &&
    await fileExists(paths.planningScenariosFile)
  ) {
    const scenarios = await readJson(paths.planningScenariosFile);
    scenarioOption = scenarios.options?.find(
      ({id}) => id === project.plan.scenarioBinding.optionId,
    ) ?? null;
  }
  const reportPath = path.posix.join(
    'projects',
    slug,
    'semantic-revision.json',
  );
  const result = prepareSemanticRevision({
    currentStoryboard,
    suppliedStoryboard,
    plan: project.plan,
    styleProfile: project.styleProfile,
    production: state,
    authorization,
    reportPath,
    scenarioOption,
  });
  await Promise.all([
    writeJson(storyboardFileFor(slug), result.storyboard),
    writeJson(
      paths.projectFile,
      {
        ...project,
        plan: result.plan,
        motionContract: result.storyboard.motionContract,
        editorial: result.storyboard.editorial,
      },
    ),
    writeJson(
      paths.motionLanguageCardFile,
      motionLanguageCard(result.storyboard.motionContract),
    ),
    writeJson(
      path.join(productionPaths.projectDirectory, 'semantic-revision.json'),
      result.report,
    ),
    writeJson(productionPaths.productionFile, result.production),
  ]);
  await syncReviewFromProduction(slug, result.production);
  if (json) {
    console.log(JSON.stringify(result.report, null, 2));
  } else {
    console.log(
      `✓ 人工授权语义重编已记录：${result.report.semanticChangedSceneIds.join(', ')}`,
    );
    if (result.report.profilePromiseRecalculation?.changed) {
      console.log(
        `  locked-static 重算：${result.report.profilePromiseRecalculation.lockedSceneIds.join(', ')}`,
      );
    }
    console.log('  旧 style/composition/render 证据已失效；请同步执行树并重新证明。');
    console.log(`  报告：${reportPath}`);
  }
} catch (error) {
  console.error(`project:revise-preview-semantic failed: ${error.message}`);
  process.exitCode = 1;
}
