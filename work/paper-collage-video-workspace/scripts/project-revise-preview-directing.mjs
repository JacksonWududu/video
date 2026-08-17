#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {resolveWorkspacePath} from './provider-lib.mjs';
import {loadProject, writeJson} from './project-lib.mjs';
import {
  loadProduction,
  syncReviewFromProduction,
} from './production-state.mjs';
import {loadStoryboard, storyboardFileFor} from './storyboard-lib.mjs';
import {prepareDirectingRevision} from './directing-revision-lib.mjs';
import {motionLanguageCard} from './motion-contract-lib.mjs';

const args = process.argv.slice(2);
const slug = args.find((arg) => !arg.startsWith('--'));
const input = args.find((arg) => arg.startsWith('--input='))?.slice('--input='.length);
const source = args.find((arg) => arg.startsWith('--source='))?.slice('--source='.length) ?? 'preview';
const json = args.includes('--json');

try {
  if (!slug || !input) {
    throw new Error('用法：project:revise-preview-directing -- <slug> --input=<storyboard.json> [--source=style-review|preview|asset-production] [--json]');
  }
  const [{project}, {paths, state}, currentStoryboard] = await Promise.all([
    loadProject(slug),
    loadProduction(slug),
    loadStoryboard(slug),
  ]);
  const suppliedStoryboard = JSON.parse(
    await fs.readFile(resolveWorkspacePath(input, '导演重编 storyboard 输入路径'), 'utf8'),
  );
  const reportPath = path.posix.join('projects', slug, 'directing-revision.json');
  const result = prepareDirectingRevision({
    currentStoryboard,
    suppliedStoryboard,
    plan: project.plan,
    styleProfile: project.styleProfile,
    production: state,
    reportPath,
    source,
  });
  await writeJson(storyboardFileFor(slug), result.storyboard);
  await writeJson(paths.projectFile, {
    ...project,
    motionContract: result.storyboard.motionContract,
    editorial: result.storyboard.editorial,
  });
  await writeJson(
    paths.motionLanguageCardFile,
    motionLanguageCard(result.storyboard.motionContract),
  );
  await writeJson(path.join(paths.projectDirectory, 'directing-revision.json'), result.report);
  await writeJson(paths.productionFile, result.production);
  await syncReviewFromProduction(slug, result.production);
  if (json) console.log(JSON.stringify(result.report, null, 2));
  else {
    console.log(`✓ 正式导演重编已记录：${result.report.changedSceneIds.join(', ')}`);
    console.log('  已保护概念、动作语言批准与风格批准；请同步 project.json 执行树后重新验证和预览。');
    console.log(`  报告：${reportPath}`);
  }
} catch (error) {
  console.error(`project:revise-preview-directing failed: ${error.message}`);
  process.exitCode = 1;
}
