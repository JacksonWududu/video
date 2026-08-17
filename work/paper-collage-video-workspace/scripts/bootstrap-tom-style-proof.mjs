import fs from 'node:fs/promises';

const slug = 'tom-cat-chases-mouse';
const projectFile = `projects/${slug}/project.json`;
const storyboardFile = `projects/${slug}/storyboard.json`;
const project = JSON.parse(await fs.readFile(projectFile, 'utf8'));
const storyboard = JSON.parse(await fs.readFile(storyboardFile, 'utf8'));
const imageSrc = `projects/${slug}/assets/style/story-style-sample-v3.png`;
const narration = {
  'full-scene-01': ['projects/tom-cat-chases-mouse/audio/narration/scene-01.mp3', 4.704, '厨房静悄悄的。一只小鼠发现了桌上的奶酪。'],
  'full-scene-02': ['projects/tom-cat-chases-mouse/audio/narration/scene-02.mp3', 3.552, '它刚把奶酪抱紧，蓝灰猫就睁开了眼睛！'],
  'full-scene-03': ['projects/tom-cat-chases-mouse/audio/narration/scene-03-v2.mp3', 6.768, '小鼠拔腿就跑，猫紧追不放。椅脚、餐巾和碗，全都乱成一团。'],
  'full-scene-04': ['projects/tom-cat-chases-mouse/audio/narration/scene-04.mp3', 5.784, '眼看就要追上，小鼠突然转弯——猫来不及刹车，一头撞进了纸箱！'],
  'full-scene-05': ['projects/tom-cat-chases-mouse/audio/narration/scene-05.mp3', 4.944, '小鼠平安回到墙洞。这一次，机灵比力气快了一步。'],
};

project.scenes = storyboard.scenes.map((source, sceneIndex) => {
  const targets = [...new Set(source.beats.flatMap((beat) =>
    beat.treatments.map(({targetId}) => targetId).filter((id) => id !== 'scene-camera'),
  ))];
  const nodes = targets.map((id, index) => ({
    id,
    kind: 'asset',
    assetRole: id.includes('dust') ? 'decorative' : 'environment',
    src: imageSrc,
    z: index,
    transform: {x: 0, y: 0, width: 1, height: 1, anchorX: 0, anchorY: 0},
    motion: {
      keyframes: [
        {at: 0, offsetX: -0.006 * ((index % 3) + 1), scale: 1},
        {at: 0.55, offsetX: 0.004 * ((index % 3) + 1), scale: 1.012, ease: 'ease-in-out'},
        {at: 1, offsetX: 0, scale: 1, ease: 'ease-out'},
      ],
    },
  }));
  const [src, durationSeconds, text] = narration[source.id];
  const incomingTransitionSeconds = sceneIndex === 0
    ? 0
    : storyboard.sceneTransitions[sceneIndex - 1].treatment.durationSeconds;
  const outgoingTransitionSeconds = sceneIndex === storyboard.scenes.length - 1
    ? 0
    : storyboard.sceneTransitions[sceneIndex].treatment.durationSeconds;
  return {
    id: source.id,
    label: source.title,
    eyebrow: `SCENE ${sceneIndex + 1}`,
    tailSeconds: Math.max(outgoingTransitionSeconds, 0.2),
    motion: {
      blueprint: source.blueprint,
      intensity: 0.72,
      seed: 71 + sceneIndex,
      proofTimes: source.proofTimes,
    },
    composition: {coordinateSpace: {width: 1920, height: 1080}, nodes},
    camera: {preset: 'push', intensity: 0.45},
    narration: {src, startSeconds: incomingTransitionSeconds, durationSeconds, text},
    subtitles: [{fromSeconds: incomingTransitionSeconds, toSeconds: incomingTransitionSeconds + durationSeconds, text}],
    events: source.beats.map((beat, index) => ({
      id: `${beat.id}-event`,
      beatId: beat.id,
      proofTimeId: beat.proofTimeId,
      at: beat.at,
      targetId: beat.treatments.find(({targetId}) => targetId !== 'scene-camera')?.targetId ?? targets[0],
      visual: {kind: 'emphasis', action: index === 0 ? 'pulse' : 'settle', durationSeconds: 0.25, intensity: 0.35},
    })),
  };
});
project.sceneTransitions = storyboard.sceneTransitions;

await fs.writeFile(projectFile, `${JSON.stringify(project, null, 2)}\n`);
