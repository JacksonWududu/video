import fs from 'node:fs/promises';

const slug = 'trump-retro-speech-30s-v2';
const projectFile = `projects/${slug}/project.json`;
const storyboard = JSON.parse(await fs.readFile(`projects/${slug}/storyboard.json`, 'utf8'));
const manifest = JSON.parse(await fs.readFile(`projects/${slug}/assets-manifest.json`, 'utf8'));
const project = JSON.parse(await fs.readFile(projectFile, 'utf8'));
const asset = (id) => manifest.assets.find((x) => x.assetId === id && x.lifecycle?.status === 'active');
const identity = asset('story-style-sample-v3-normalized');
const src = (p) => p.replace(/^public\//, '');
const still = {keyframes: [{at: 0, scale: 1}, {at: 1, scale: 1}]};
const full = {x: 0, y: 0, width: 1, height: 1, anchorX: 0, anchorY: 0};
const stateFiles = {
  'neutral-at-podium': `projects/${slug}/assets/poses/trump-gesture-core/trump-gesture-core-neutral.png`,
  'raised-hand-emphasis': `projects/${slug}/assets/poses/trump-gesture-core/trump-gesture-core-raised.png`,
  'open-palm-close': `projects/${slug}/assets/poses/trump-gesture-core/trump-gesture-core-open-palm.png`,
};
const stateNode = (sceneId, planned, z, transform) => ({
  id: 'trump-speaker', kind: 'state-sequence', assetRole: 'character', poseFamilyId: 'trump-gesture-core',
  registration: {id: 'trump-gesture-registration', sourceMasterAssetId: 'podium-master', canvas: {width: 470, height: 520}, origin: 'top-left'},
  anchorPolicy: {requiredAnchorIds: ['torso'], maximumDrift: 0.05},
  states: planned.states.map((s) => ({id: s.id, src: stateFiles[s.id], at: s.at, facing: s.facing, anchors: [{id: 'torso', x: 0.5, y: 0.57}], identityReferenceAssetId: identity.assetId, identityReferenceSha256: identity.sha256})),
  playback: planned.playback, transition: {type: planned.transition, durationSeconds: 0}, z, transform,
  motion: {keyframes: [{at: 0, offsetY: 0}, {at: 0.66, offsetY: -0.008, ease: 'ease-in-out'}, {at: 1, offsetY: 0, ease: 'ease-out'}]},
});
const podiumChild = (id, role, z, depth) => ({id, kind: 'asset', assetRole: 'environment', src: src(asset(id).file), slot: role, z, depth, registrationId: 'draft-podium-registration', transform: full, motion: still});
const scene1Plan = storyboard.scenes[0].compositionPlan.stateSequences[0];
const scene2Plan = storyboard.scenes[1].compositionPlan.stateSequences[0];
const podiumGroup = {
  id: 'podium-depth-stack', kind: 'group', pattern: 'registered-depth-stack', z: 1,
  coordinateSpace: {width: 512, height: 512}, transform: {x: 0.17, y: 0.02, width: 0.66, height: 0.9, anchorX: 0, anchorY: 0},
  motion: {keyframes: [{at: 0, offsetX: -0.01, scale: 1.02}, {at: 1, offsetX: 0.01, scale: 1.04, ease: 'ease-in-out'}]},
  registration: {id: 'draft-podium-registration', sourceMasterAssetId: 'podium-master', canvas: {width: 512, height: 512}, origin: 'top-left'},
  layerStack: {sourcePackageId: 'draft-podium-stack', sourceStrategy: 'registered-layer-sheet', motionCapability: 'bounded-relative', revealEnvelope: storyboard.scenes[0].compositionPlan.layerStacks[0].revealEnvelope},
  children: [podiumChild('podium-rear','support-rear',0,-0.7), podiumChild('podium-subject','subject',1,0), podiumChild('podium-front','support-front',2,0.72)],
};
const headline = {
  id: 'headline-strip', kind: 'typography', text: 'STEADY WORK\nHONEST CHOICES',
  treatment: {fit: {minFontSize: 38, maxFontSize: 76, maxLines: 2, overflow: 'error'}, style: {color: '#342d27', fontWeight: 900, lineHeight: 0.9, align: 'left', letterSpacing: -2, fontFamily: 'Georgia, Times New Roman, serif'}, effects: {pad: {color: 'rgba(243,232,208,.84)', padding: 18, radius: 2}}, highlights: [], reveal: {mode: 'none', editPointIds: []}, emphasis: [], safeAreaMode: 'inside', avoidZoneIds: []},
  z: 8, transform: {x: 0.07, y: 0.25, width: 0.38, height: 0.28, anchorX: 0, anchorY: 0},
  motion: {keyframes: [{at: 0, offsetY: 0.018, opacity: 0}, {at: 0.32, offsetY: 0, opacity: 1, ease: 'ease-out'}, {at: 1, offsetY: -0.005, opacity: 1}]},
};
const closingSrc = `projects/${slug}/assets/closing/closing-archive-master-1920.png`;
const closingGroup = {
  id: 'closing-archive-master', kind: 'group', pattern: 'supported-subject', z: 0,
  depth: -0.9, coordinateSpace: {width: 512, height: 512}, transform: full,
  motion: {keyframes:[{at:0,opacity:0.001},{at:1,opacity:0.001}]},
  registration: {id: 'draft-podium-registration', sourceMasterAssetId: 'podium-master', canvas: {width: 512, height: 512}, origin: 'top-left'},
  support: {subjectId: 'podium-subject', layering: 'between-supports', contactAnchor: {x: 0.5, y: 0.68}, contactZone: [[0.15,0.5],[0.85,0.5],[0.85,0.9],[0.15,0.9]], occlusionZone: [[0.1,0.62],[0.9,0.62],[0.9,0.95],[0.1,0.95]]},
  children: [podiumChild('podium-rear','support-rear',0,-0.7), podiumChild('podium-subject','subject',1,0), podiumChild('podium-front','support-front',2,0.72)]
};
const narration = [
  {src: `projects/${slug}/audio/voicebox/scene-01-jackson.m4a`, durationSeconds: 7.28, text: 'Tonight, I want to speak about a simple promise. Public service should be clear, practical, and focused on the people who carry our communities forward every day.'},
  {src: `projects/${slug}/audio/voicebox/scene-02-jackson.m4a`, durationSeconds: 8.16, text: 'Progress does not arrive as a headline. It is built through steady work, honest choices, and the courage to listen. Let us leave the page better than we found it.'}
];
project.voice = {mode: 'fictional', provider: 'voicebox', displayName: 'Voicebox — Jackson'};
project.scenes = storyboard.scenes.map((s, i) => {
  const incoming = i === 0 ? 0 : storyboard.sceneTransitions[0].treatment.durationSeconds;
  const visibleClosing = {id:'closing-visible-plate',kind:'asset',assetRole:'background',src:closingSrc,z:0,depth:-0.6,transform:full,motion:{keyframes:[{at:0,scale:1.01},{at:1,scale:1.035,ease:'ease-in-out'}]}};
  const sceneState = stateNode(s.id, i===0?scene1Plan:scene2Plan, i===0?5:6, i===0?{x:0.34,y:0.10,width:0.32,height:0.62,anchorX:0,anchorY:0}:{x:0.50,y:0.18,width:0.28,height:0.56,anchorX:0,anchorY:0});
  sceneState.depth = 0.25;
  headline.depth = 0.65;
  const nodes = i === 0 ? [podiumGroup, sceneState] : [closingGroup, visibleClosing, sceneState, headline];
  return {id: s.id, label: s.title, eyebrow: `ARCHIVE ${i+1}`, tailSeconds: i === 0 ? 1 : 1.8,
    motion: {blueprint: s.blueprint, intensity: 0.58, seed: 81+i, proofTimes: s.proofTimes},
    composition: {coordinateSpace: {width: 1920, height: 1080}, nodes},
    camera: {preset: 'push', intensity: 0.32, keyframes: [{at:0,x:-8,y:2,zoom:1.04},{at:1,x:8,y:-2,zoom:1.07}], parallax: {enabled:true,strength:0.22,focalDepth:-1}},
    narration: {src: narration[i].src, startSeconds: i===0?5.68:6.53, durationSeconds: narration[i].durationSeconds, text: narration[i].text},
    subtitles: [{fromSeconds:i===0?5.68:6.53,toSeconds:i===0?9.1:10.3,text:i===0?'Tonight: a simple promise.':'Progress is more than a headline.'},{fromSeconds:i===0?9.2:10.4,toSeconds:(i===0?5.68:6.53)+narration[i].durationSeconds,text:i===0?'Clear, practical public service.':'Steady work. Honest choices. Listen.'}],
    events: s.beats.map((b,j)=>({id:`${b.id}-event`,beatId:b.id,proofTimeId:b.proofTimeId,at:b.at,targetId:b.treatments.find(t=>t.targetId!=='scene-camera')?.targetId ?? nodes[0].id,visual:{kind:'emphasis',action:j===0?'lift':'settle',durationSeconds:2,intensity:0.3}}))};
});
project.sceneTransitions = storyboard.sceneTransitions;
await fs.writeFile(projectFile, `${JSON.stringify(project,null,2)}\n`);
console.log(`✓ bootstrapped ${projectFile}`);
