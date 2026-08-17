#!/usr/bin/env node
import fs from 'node:fs/promises';
import {resolveWorkspacePath} from './provider-lib.mjs';
import {
  ASPECT_RATIOS,
  PARALLAX_PREFERENCES,
  confirmIntake,
  intakeDecisionFingerprint,
} from './intake-lib.mjs';
import {loadProject, writeJson} from './project-lib.mjs';
import {loadProduction} from './production-state.mjs';
import {
  loadStyleCatalog,
  materializeStyleProfile,
  styleCatalogDecision,
} from './style-catalog-lib.mjs';

const args = process.argv.slice(2);
const slug = args.find((arg) => !arg.startsWith('--'));
const json = args.includes('--json');
const valueFor = (name) =>
  args.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);

const printGate = ({project, catalog}) => {
  const payload = {
    gate: 'intake',
    title: project.title,
    status: project.intake?.status ?? 'pending',
    instruction:
      '先向用户展示当前目录中的全部 styleCards，再收集画幅、一个视觉风格和视差偏好；风格卡是目录参考，不是项目风格样张。',
    questions: [
      {
        id: 'aspectRatio',
        label: '尺寸比例',
        options: Object.entries(ASPECT_RATIOS).map(([id, value]) => ({
          id,
          label: value.label,
          resolution: `${value.width}x${value.height}`,
        })),
      },
      {
        id: 'visualStylePreset',
        label: '视觉风格',
        options: styleCatalogDecision(catalog).styles,
      },
      {
        id: 'parallaxPreference',
        label: '分层视差',
        options: Object.entries(PARALLAX_PREFERENCES).map(([id, value]) => ({
          id,
          ...value,
        })),
      },
    ],
    current: project.intake ?? null,
  };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  console.log(`项目：${project.title}`);
  console.log(`等待 intake：画幅、${catalog.styles.length} 选一视觉风格、分层视差偏好。`);
  for (const style of payload.questions[1].options) {
    console.log(`  ${style.id}: ${style.label} · ${style.absolutePath}`);
  }
  console.log(`结构化输出：npm run project:intake -- ${project.slug} --json`);
};

try {
  if (!slug) throw new Error('用法：project:intake -- <slug> [--json|--input=<selection.json>|--selection=<json>]');
  const {state} = await loadProduction(slug);
  if (state.stage !== 'capability-review') {
    throw new Error(`project:intake 只能在 capability-review 阶段运行；当前为 ${state.stage}。`);
  }
  const {paths, project} = await loadProject(slug);
  const catalog = await loadStyleCatalog();
  const input = valueFor('--input');
  const inline = valueFor('--selection');
  if (input && inline) throw new Error('--input 和 --selection 不能同时提供。');
  if (!input && !inline) {
    printGate({project, catalog});
  } else {
    if (project.plan?.status === 'resolved') {
      throw new Error('Creative Plan 已锁定；改变 intake 会使方案失效，请新建项目。');
    }
    const selection = input
      ? JSON.parse(await fs.readFile(resolveWorkspacePath(input, 'intake selection 路径'), 'utf8'))
      : JSON.parse(inline);
    const intake = confirmIntake({selection, catalog});
    const styleProfile = materializeStyleProfile(
      catalog,
      intake.visualStylePreset,
    );
    const video = {
      ...project.video,
      width: ASPECT_RATIOS[intake.aspectRatio].width,
      height: ASPECT_RATIOS[intake.aspectRatio].height,
    };
    await writeJson(paths.projectFile, {
      ...project,
      intake,
      styleProfile,
      theme: structuredClone(styleProfile.render.theme),
      video,
    });
    console.log(`✓ intake 已确认：${intake.aspectRatio} · ${intake.visualStylePreset} · parallax=${intake.parallaxPreference}`);
    console.log(`✓ intake fingerprint：${intakeDecisionFingerprint(intake)}`);
    console.log('下一步：生成共同故事骨架与三个 planning scenarios；此时仍不得调用图片 provider。');
  }
} catch (error) {
  console.error(`project:intake failed: ${error.message}`);
  process.exitCode = 1;
}
