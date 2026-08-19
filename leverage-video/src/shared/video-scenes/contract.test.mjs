import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(directory, name), 'utf8');

test('shared narrative scenes consume v3 transition maps while retaining legacy watercolor', () => {
  const source = read('NarrativeScene.tsx');
  assert.match(source, /IntraShotImageSequence/);
  assert.match(source, /intraShotTransitionContract/);
  assert.match(source, /heroPoseBackground/);
  assert.match(source, /WatercolorImageSequence/);
  assert.match(source, /useCurrentFrame/);
  assert.match(source, /deterministic-narrative-detail-motion-v1/);
  assert.doesNotMatch(source, /Math\.floor\(frame\s*\/\s*45\)/);
});

test('shared graphic routing accepts Ian and Ink but applies mask sweep only to Ian', () => {
  const source = read('GraphicScene.tsx');
  assert.match(source, /'ian-handdrawn-ppt', 'ink-doodle-knowledge-card'/);
  assert.match(source, /visualGenerationRoute === 'ian-handdrawn-ppt'/);
  assert.match(source, /FullFrameMaskSweep/);
  assert.match(source, /IntraShotImageSequence/);
  assert.match(source, /WatercolorImageSequence/);
  assert.match(source, /imageSequence\.map/);
  assert.match(source, /durationInFrames: occurrence\.duration_in_frames/);
});

test('shared Doodle routing consumes approved PNGs without Ian mask sweep', () => {
  const source = read('DoodleScene.tsx');
  assert.match(source, /visualGenerationRoute !== 'doodle-slides'/);
  assert.match(source, /WatercolorImageSequence/);
  assert.match(source, /IntraShotImageSequence/);
  assert.match(source, /\.png/);
  assert.doesNotMatch(source, /FullFrameMaskSweep/);
  assert.doesNotMatch(source, /\.svg|\.html/);
});

test('legacy ComicScene remains inspectable without crop, pan, or panel recomposition', () => {
  const source = read('ComicScene.tsx');
  assert.match(source, /visualGenerationRoute !== 'comic-imagegen'/);
  assert.match(source, /comic-shot-plan-v1/);
  assert.match(source, /WatercolorImageSequence/);
  assert.match(source, /1920x1080 PNG/);
  assert.match(source, /duration_in_frames < 15/);
  assert.doesNotMatch(source, /useCurrentFrame|transform|translate|scale|crop|clipPath|FullFrameMaskSweep/);
});

test('shared video consumes the inter-shot transition renderer', () => {
  const source = read('KnowledgeVideo.tsx');
  assert.match(source, /TransitionedScene/);
  assert.match(source, /scene\.scene_type === 'doodle'/);
  assert.match(source, /<DoodleScene/);
  assert.match(source, /intraShotTransitionContract/);
  assert.match(source, /intraShotTransitions/);
  assert.match(source, /scene\.scene_type === 'whiteboard'/);
  assert.match(source, /<WhiteboardScene/);
  assert.match(source, /scene\.scene_type === 'local-video'/);
  assert.match(source, /<LocalVideoScene/);
  assert.match(source, /comic-imagegen is historical read-only/);
  assert.doesNotMatch(source, /<ComicScene/);
});

test('versioned burned-in caption component consumes only active display text', () => {
  const source = read('NarrationCaptionsV1.tsx');
  assert.match(source, /narration-captions-v1/);
  assert.match(source, /cue\.display_text/);
  assert.match(source, /frame >= item\.start_frame && frame < item\.end_frame/);
  assert.match(source, /zIndex: 10000/);
  assert.doesNotMatch(source, /source_text|\.srt|\.vtt|\.ass/);
});

test('shared local-video scene maps the complete source to exact shot frames with muted playback', () => {
  const source = read('LocalVideoScene.tsx');
  assert.match(source, /OffthreadVideo/);
  assert.match(source, /playbackRate=\{localVideo\.playback_rate\}/);
  assert.match(source, /target_duration_frames !== durationInFrames/);
  assert.match(source, /muted/);
  assert.match(source, /local-video-match-v1/);
  assert.doesNotMatch(source, /loop|trimBefore|trimAfter|objectFit|WatercolorImageSequence/);
});

test('shared whiteboard scene consumes approved MP4 with piecewise trim and playback rate', () => {
  const source = read('WhiteboardScene.tsx');
  assert.match(source, /OffthreadVideo/);
  assert.match(source, /trimBefore=\{segment\.source_start_frame\}/);
  assert.match(source, /trimAfter=\{segment\.source_end_frame\}/);
  assert.match(source, /playbackRate=\{segment\.playback_rate\}/);
  assert.match(source, /muted/);
  assert.doesNotMatch(source, /WatercolorImageSequence|FullFrameMaskSweep/);
});

test('renderer keeps legacy null-route narrative plans readable without weakening new builder validation', () => {
  const source = read('types.ts');
  assert.match(source, /CurrentKnowledgeVideoScene/);
  assert.match(source, /LegacyNarrativeScene/);
  assert.match(source, /scene_type: 'narrative'/);
  assert.match(source, /visual_generation_route: null/);
  assert.match(source, /'xuan-paper-diorama'/);
  assert.match(source, /'srt-whiteboard-animation'/);
  assert.match(source, /'local-video-file'/);
  assert.match(source, /'comic-imagegen'/);
  assert.match(source, /intra_shot_transition_contract/);
  assert.match(source, /hero_pose_background/);
  assert.match(source, /IntraShotTransitionV1/);
});
