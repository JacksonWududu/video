import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const slug = 'tom-cat-chases-mouse';
const projectDir = path.resolve('projects', slug);
const publicDir = path.resolve('public', 'projects', slug);
const plateDir = path.join(publicDir, 'assets', 'plates');
const outputDir = path.resolve('dist', slug);
const project = JSON.parse(await fs.readFile(path.join(projectDir, 'project.json'), 'utf8'));
const sceneDurations = [5.5, 5.5, 7, 6, 6];
const moves = [
  {x0: -0.012, y0: 0.004, x1: 0.014, y1: -0.006, s0: 1.035, s1: 1.085},
  {x0: 0.014, y0: 0.004, x1: -0.014, y1: -0.008, s0: 1.045, s1: 1.095},
  {x0: -0.018, y0: 0.008, x1: 0.018, y1: -0.008, s0: 1.035, s1: 1.085},
  {x0: 0.012, y0: -0.004, x1: -0.012, y1: 0.006, s0: 1.04, s1: 1.09},
  {x0: -0.008, y0: 0.004, x1: 0.008, y1: -0.004, s0: 1.035, s1: 1.07},
];

await fs.mkdir(plateDir, {recursive: true});
await fs.mkdir(outputDir, {recursive: true});

for (let index = 0; index < project.scenes.length; index += 1) {
  const number = String(index + 1).padStart(2, '0');
  const input = path.join(plateDir, `scene-${number}-native.png`);
  const output = path.join(plateDir, `scene-${number}.png`);
  await sharp(input)
    .resize(1920, 1080, {fit: 'cover', position: 'centre'})
    .png({compressionLevel: 9})
    .toFile(output);

  const scene = project.scenes[index];
  const narrationOffset = scene.narration.startSeconds ?? 0;
  const move = moves[index];
  scene.narration.startSeconds = 0;
  scene.tailSeconds = Math.max(0, sceneDurations[index] - scene.narration.durationSeconds);
  scene.subtitles = (scene.subtitles ?? []).map((subtitle) => ({
    ...subtitle,
    fromSeconds: Math.max(0, subtitle.fromSeconds - narrationOffset),
    toSeconds: Math.max(0.1, subtitle.toSeconds - narrationOffset),
  }));
  scene.composition = {
    coordinateSpace: {width: 1920, height: 1080},
    nodes: [{
      id: `scene-${number}-plate`,
      kind: 'asset',
      assetRole: 'environment',
      src: `projects/${slug}/assets/plates/scene-${number}.png`,
      z: 0,
      transform: {x: 0, y: 0, width: 1, height: 1, anchorX: 0, anchorY: 0},
      motion: {
        keyframes: [
          {at: 0, offsetX: move.x0, offsetY: move.y0, scale: move.s0},
          {at: 1, offsetX: move.x1, offsetY: move.y1, scale: move.s1, ease: 'ease-in-out'},
        ],
      },
    }],
  };
}

project.sceneTransitions = [];
await fs.writeFile(
  path.join(outputDir, 'final-cut-project.json'),
  `${JSON.stringify(project, null, 2)}\n`,
  'utf8',
);

console.log(`Prepared ${project.scenes.length} scene plates and final-cut props in ${outputDir}`);
