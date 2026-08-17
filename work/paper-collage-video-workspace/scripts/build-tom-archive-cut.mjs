import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const sourceSlug = 'tom-cat-chases-mouse';
const targetSlug = 'tom-cat-chases-mouse-archive';
const sourceProps = path.resolve('dist', sourceSlug, 'final-cut-project.json');
const targetPublic = path.resolve('public', 'projects', targetSlug);
const targetPlates = path.join(targetPublic, 'assets', 'plates');
const targetDist = path.resolve('dist', targetSlug);
const project = JSON.parse(await fs.readFile(sourceProps, 'utf8'));
const moves = [
  {x0: -0.016, y0: 0.006, x1: 0.012, y1: -0.008, s0: 1.035, s1: 1.085},
  {x0: 0.018, y0: 0.004, x1: -0.018, y1: -0.006, s0: 1.04, s1: 1.095},
  {x0: -0.02, y0: 0.008, x1: 0.02, y1: -0.008, s0: 1.035, s1: 1.09},
  {x0: 0.014, y0: -0.004, x1: -0.014, y1: 0.007, s0: 1.04, s1: 1.095},
  {x0: -0.01, y0: 0.004, x1: 0.01, y1: -0.005, s0: 1.035, s1: 1.075},
];

await fs.mkdir(targetPlates, {recursive: true});
await fs.mkdir(targetDist, {recursive: true});

project.slug = targetSlug;
project.title = '蓝灰猫与棕色小鼠：复古档案拼贴版';

for (let index = 0; index < project.scenes.length; index += 1) {
  const number = String(index + 1).padStart(2, '0');
  const input = path.join(targetPlates, `scene-${number}-archive-native.png`);
  const output = path.join(targetPlates, `scene-${number}-archive.png`);
  const foreground = path.join(targetPlates, `scene-${number}-archive-front.png`);
  await sharp(input)
    .resize(1920, 1080, {fit: 'cover', position: 'centre'})
    .modulate({saturation: 0.88, brightness: 0.98})
    .sharpen({sigma: 0.35})
    .png({compressionLevel: 9})
    .toFile(output);

  const borderMask = Buffer.from(`
    <svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">
      <path d="M0 0H1920V128H0Z M0 128H155V930H0Z M1765 128H1920V930H1765Z M0 930H1920V1080H0Z" fill="white"/>
      <path d="M0 0H420L345 205L0 275Z" fill="white"/>
      <path d="M1920 0H1540L1630 255L1920 315Z" fill="white"/>
      <path d="M0 1080H520L410 825L0 760Z" fill="white"/>
      <path d="M1920 1080H1435L1555 815L1920 745Z" fill="white"/>
    </svg>
  `);
  await sharp(output)
    .ensureAlpha()
    .composite([{input: borderMask, blend: 'dest-in'}])
    .png({compressionLevel: 9})
    .toFile(foreground);

  const move = moves[index];
  const scene = project.scenes[index];
  scene.composition.nodes = [{
    id: `archive-scene-${number}-plate`,
    kind: 'asset',
    assetRole: 'environment',
    src: `projects/${targetSlug}/assets/plates/scene-${number}-archive.png`,
    z: 0,
    transform: {x: 0, y: 0, width: 1, height: 1, anchorX: 0, anchorY: 0},
    motion: {
      keyframes: [
        {at: 0, offsetX: move.x0, offsetY: move.y0, scale: move.s0},
        {at: 0.48, offsetX: (move.x0 + move.x1) / 2, offsetY: (move.y0 + move.y1) / 2, scale: (move.s0 + move.s1) / 2, ease: 'ease-in-out'},
        {at: 1, offsetX: move.x1, offsetY: move.y1, scale: move.s1, ease: 'ease-in-out'},
      ],
    },
  }, {
    id: `archive-scene-${number}-foreground`,
    kind: 'asset',
    assetRole: 'foreground-occluder',
    src: `projects/${targetSlug}/assets/plates/scene-${number}-archive-front.png`,
    z: 4,
    transform: {x: 0, y: 0, width: 1, height: 1, anchorX: 0, anchorY: 0},
    motion: {
      keyframes: [
        {at: 0, offsetX: -move.x0 * 1.8, offsetY: -move.y0 * 1.4, scale: move.s0 + 0.012, rotation: -0.18},
        {at: 0.48, offsetX: -(move.x0 + move.x1) * 0.9, offsetY: -(move.y0 + move.y1) * 0.7, scale: (move.s0 + move.s1) / 2 + 0.014, rotation: 0.08, ease: 'ease-in-out'},
        {at: 1, offsetX: -move.x1 * 1.8, offsetY: -move.y1 * 1.4, scale: move.s1 + 0.016, rotation: 0.2, ease: 'ease-in-out'},
      ],
    },
  }];
}

await fs.writeFile(
  path.join(targetDist, 'final-cut-project.json'),
  `${JSON.stringify(project, null, 2)}\n`,
  'utf8',
);

console.log(`Prepared archival collage cut at ${targetDist}`);
