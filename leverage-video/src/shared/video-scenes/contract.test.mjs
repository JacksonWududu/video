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

test('Ian preserves legacy fade and consumes checksum-bound entry motion, vector reveal, and SFX', () => {
  const source = read('IanLayeredScene.tsx');
  assert.match(source, /visualGenerationRoute !== 'ian-handdrawn-ppt'/);
  assert.match(source, /ian-static-layered-scene-v1/);
  assert.match(source, /IAN_LAYERED_ENTRY_RENDERER_VERSION/);
  assert.match(source, /validateIanLayeredEntryEffectsRenderPlan/);
  assert.match(source, /IAN_LAYER_ENTRY_TRANSITION_VERSION/);
  assert.match(source, /useCurrentFrame/);
  assert.match(source, /interpolate/);
  assert.match(source, /softSettleOffset/);
  assert.match(source, /layer\.entry_frame/);
  assert.match(source, /opacity/);
  assert.match(source, /strokeDasharray/);
  assert.match(source, /strokeDashoffset/);
  assert.match(source, /<mask/);
  assert.match(source, /<Audio/);
  assert.match(source, /gain_multiplier/);
  assert.match(source, /<CanvasImage/);
  assert.match(source, /width=\{1920\}/);
  assert.match(source, /height=\{1080\}/);
  assert.match(source, /fit="fill"/);
  assert.doesNotMatch(source, /FullFrameMaskSweep|full-frame-mask-sweep|Math\.random|scale\(|rotate\(/);
  const graphic = read('GraphicScene.tsx');
  assert.match(graphic, /ink-doodle-knowledge-card/);
  assert.doesNotMatch(graphic, /ian-handdrawn-ppt|ian-static|ian-subtle|translate3d|scale\(/);
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
  assert.match(source, /scene\.scene_type === 'ian-layered'/);
  assert.match(source, /<IanLayeredScene/);
  assert.match(source, /scene=\{scene\.ian_layered_scene!\}/);
  assert.match(source, /<SoundEffectTrack/);
  assert.match(source, /soundEffectBusGain=\{soundEffectBusGain\}/);
  assert.doesNotMatch(source, /internalMotionContract|internalMotion/);
  assert.match(source, /comic-imagegen is historical read-only/);
  assert.doesNotMatch(source, /<ComicScene/);
});

test('current generic and Ian sound renderers share one bus and one owner each', () => {
  const track = read('SoundEffectTrack.tsx');
  const ian = read('IanLayeredScene.tsx');
  assert.match(track, /global_sound_effect_track_v1/);
  assert.match(track, /gain_multiplier \* soundEffects\.bus_gain_multiplier/);
  assert.match(track, /durationInFrames=\{cue\.derived_asset\.duration_in_frames\}/);
  assert.doesNotMatch(track, /playbackRate|trimBefore|trimAfter|normalize\s*\(/);
  assert.match(ian, /gain_multiplier \* soundEffectBusGain/);
  assert.match(ian, /requires the unified SFX bus multiplier/);
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
  assert.match(source, /knowledge-video-assembly-plan-v3/);
  assert.match(source, /KnowledgeVideoSoundEffectCue/);
  assert.match(source, /IntraShotTransitionV1/);
});
