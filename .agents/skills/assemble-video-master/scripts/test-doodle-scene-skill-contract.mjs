import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(skillRoot, relativePath), 'utf8');

test('assembly requires current visual direction evidence', () => {
  const source = read('SKILL.md');
  assert.match(source, /per-shot-visual-direction-review-v3/);
  assert.match(source, /imagegen/);
  assert.match(source, /comic-imagegen.*forbidden/i);
  assert.match(source, /ian-handdrawn-ppt/);
  assert.match(source, /ink-doodle-knowledge-card/);
  assert.match(source, /doodle-slides.*forbidden/i);
  assert.match(source, /exact asset-route equality/);
});

test('Ink Doodle uses GraphicScene PNGs without Ian mask sweep', () => {
  const source = read('references/remotion-assembly-and-render.md');
  assert.match(source, /explicit-visual-generation-route-v3/);
  assert.match(source, /ink-doodle-knowledge-card/);
  assert.match(source, /GraphicScene/);
  assert.match(source, /PNG/);
  assert.match(source, /must not redraw or relabel/i);
  assert.match(source, /must not.*FullFrameMaskSweep/i);
  assert.match(source, /normally zero-frame cuts.*watercolor only when explicitly approved/i);
});

test('ComicScene is retained only for completed unchanged legacy evidence', () => {
  const source = read('references/remotion-assembly-and-render.md');
  assert.match(source, /ComicScene/);
  assert.match(source, /legacy decoder\/consumer/i);
  assert.match(source, /Do not invoke it for a new output or derivative/i);
});
