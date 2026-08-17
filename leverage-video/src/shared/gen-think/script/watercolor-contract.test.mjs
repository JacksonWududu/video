import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'GenThinkLoop.tsx'), 'utf8');
const watercolorSource = fs.readFileSync(
  path.join(here, '../../watercolor-bloom/WatercolorBloomImage.tsx'),
  'utf8',
);

assert.match(source, /import \{WatercolorImageSequence\} from '\.\.\/\.\.\/watercolor-bloom'/);
assert.match(source, /buildGenThinkSchedule\(normalizedDuration, fps\)/);
assert.match(source, /src: staticFile\(DERIVATIVE_BY_STATE\[occurrence\.assetId\]\)/);
assert.match(source, /from: occurrence\.from/);
assert.match(source, /durationInFrames: occurrence\.durationInFrames/);
assert.match(source, /<WatercolorImageSequence occurrences=\{occurrences\} \/>/);
assert.doesNotMatch(source, /intra-shot-fade-v1|GEN_THINK_FADE|opacity:|interpolate\(/);
assert.doesNotMatch(source, /Math\.random|Date\.now|setTimeout|requestAnimationFrame|transition:/);

for (const palette of [
  "['#F3C95F', '#E7A83E', '#C88442']",
  "['#F2BD6B', '#E99655', '#C87145']",
  "['#EFCF70', '#E9A648', '#D67A4A']",
]) {
  assert.ok(watercolorSource.includes(palette), `missing GEN-THINK warm watercolor palette: ${palette}`);
}
assert.match(watercolorSource, /data-pigment-layer="diluted-wash"/);
assert.match(watercolorSource, /data-pigment-layer="primary-wash"/);
assert.match(watercolorSource, /mode: 'mask' \| 'wash' \| 'deposit'/);
assert.doesNotMatch(watercolorSource, /#3e4948|mode: 'rim'|mode="rim"/i);
assert.doesNotMatch(watercolorSource, /Tendril|TENDRILS|tendril-|strokeDasharray|strokeDashoffset/);

console.log('gen_think_watercolor_contract=pass');
