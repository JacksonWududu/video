import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  INTRA_SHOT_WATERCOLOR_BLOOM_KIND,
  INTRA_SHOT_WATERCOLOR_BLOOM_RENDERER,
  INTRA_SHOT_WATERCOLOR_BLOOM_RULE_ID,
  INTRA_SHOT_WATERCOLOR_BLOOM_SECONDS,
  getIntraShotWatercolorBloomDurationInFrames,
  validateIntraShotWatercolorTransition,
} from './contract.mjs';

const source = fs.readFileSync(new URL('./WatercolorBloomImage.tsx', import.meta.url), 'utf8');
const entriesBetween = (start, end) => {
  const section = source.slice(source.indexOf(start), source.indexOf(end));
  return (section.match(/^  \{/gm) ?? []).length;
};

assert.equal(INTRA_SHOT_WATERCOLOR_BLOOM_RULE_ID, 'intra-shot-watercolor-bloom-v1');
assert.equal(INTRA_SHOT_WATERCOLOR_BLOOM_KIND, 'watercolor-bloom');
assert.equal(INTRA_SHOT_WATERCOLOR_BLOOM_SECONDS, 0.6);
assert.equal(INTRA_SHOT_WATERCOLOR_BLOOM_RENDERER, 'leverage-video/src/shared/watercolor-bloom');
assert.equal(getIntraShotWatercolorBloomDurationInFrames(30), 18);
assert.throws(() => getIntraShotWatercolorBloomDurationInFrames(0), /positive fps/);

const validTransition = {
  contract_version: INTRA_SHOT_WATERCOLOR_BLOOM_RULE_ID,
  kind: INTRA_SHOT_WATERCOLOR_BLOOM_KIND,
  duration_seconds: INTRA_SHOT_WATERCOLOR_BLOOM_SECONDS,
  duration_in_frames: 18,
  from_image_index: 0,
  to_image_index: 1,
  renderer: INTRA_SHOT_WATERCOLOR_BLOOM_RENDERER,
};
assert.equal(
  validateIntraShotWatercolorTransition(validTransition, {fps: 30, fromImageIndex: 0, toImageIndex: 1}),
  validTransition,
);
for (const invalid of [
  {...validTransition, duration_seconds: 0.5},
  {...validTransition, duration_in_frames: 15},
  {...validTransition, from_image_index: 1},
  {...validTransition, renderer: 'wrong/renderer'},
]) {
  assert.throws(
    () => validateIntraShotWatercolorTransition(invalid, {fps: 30, fromImageIndex: 0, toImageIndex: 1}),
    /contract mismatch/,
  );
}

assert.match(source, /WatercolorImageSequence/);
assert.match(source, /revealFirst = false/);
assert.match(source, /firstOccurrenceContent/);
assert.match(source, /non-consecutive watercolor image sequence/);
assert.equal(entriesBetween('const SPLASH_LAYOUTS', 'const PIGMENT_PALETTES'), 4);
assert.equal(entriesBetween('const INK_LOBES', 'const SATELLITES'), 8);
assert.equal(entriesBetween('const SATELLITES', 'const clamp'), 12);
assert.match(source, /\['#F3C95F', '#E7A83E', '#C88442'\]/);
assert.match(source, /\['#F2BD6B', '#E99655', '#C87145'\]/);
assert.match(source, /\['#EFCF70', '#E9A648', '#D67A4A'\]/);
assert.match(source, /paint\(lobe\.pigment\)/);
assert.match(source, /paint\(satellite\.pigment\)/);
assert.doesNotMatch(source, /Tendril|TENDRILS|tendril-|strokeDasharray|strokeDashoffset/);
assert.match(source, /<radialGradient/);
assert.doesNotMatch(source, /maskedImageOpacity/);
assert.match(source, /primaryWashOpacity/);
assert.match(source, /secondaryWashOpacity/);
assert.match(source, /depositOpacity/);
assert.match(source, /dilutedWashOpacity/);
assert.match(source, /\[0, 0\.48, 0\.44, 0\.28, 0\]/);
assert.match(source, /data-pigment-layer="primary-wash"/);
assert.match(source, /data-pigment-layer="diluted-wash"/);
assert.match(source, /-diluted-wash/);
assert.match(source, /mixBlendMode: 'normal'/);
assert.match(source, /feTurbulence/);
assert.match(source, /feDisplacementMap/);
assert.match(source, /feMorphology/);
assert.match(source, /feComposite/);
assert.match(source, /mixBlendMode: 'multiply'/);
assert.match(source, /deterministicSvgId/);
assert.match(source, /getIntraShotWatercolorBloomDurationInFrames\(fps\)/);
assert.doesNotMatch(source, /<ellipse|five-main-drops|245, 217, 189/);
assert.doesNotMatch(source, /#3e4948|mode="rim"|mode: 'mask' \| 'rim'|\[0, 0\.34, 0\.22, 0\]/i);
assert.doesNotMatch(source, /#365b78|#a94f42|#3f7180|#9d5066|#527568|#455f8a/i);
assert.doesNotMatch(source, /Math\.random|Date\.now|setTimeout|requestAnimationFrame|animation:/);

console.log('shared_watercolor_bloom_contract=pass');
