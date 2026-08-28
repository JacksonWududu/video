import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(skillRoot, '../../..');
const readSkill = (relativePath) => fs.readFileSync(path.join(skillRoot, relativePath), 'utf8');
const readRepository = (relativePath) => fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');

const production = readSkill('SKILL.md');
const review = readSkill('references/visual-asset-review.md');
const routing = readRepository('.agents/skills/run-knowledge-video/references/visual-language-and-comic-routing.md');
const whiteboard = readRepository('.agents/skills/srt-whiteboard-animation/SKILL.md');
const routeCatalogSource = readRepository('leverage-video/src/shared/visual-generation-routes/catalog.json');
const routeCatalog = JSON.parse(routeCatalogSource);

test('episode cohesion binds one post-cover style snapshot across current v3 work', () => {
  assert.match(routing, /episode-visual-cohesion-v2/);
  assert.match(routing, /selection SHA-256, style ID,[\s\S]*episode profile SHA-256,[\s\S]*cohesion ID[\s\S]*every current v3[\s\S]*QA record, and visual manifest/i);
  assert.match(routing, /No shot may silently select, mix, or substitute another style/i);
  assert.match(production, /WHITE-CAT VISUAL STYLE: <style_id>/);
  assert.match(production, /EPISODE VISUAL COHESION: <visual_cohesion_profile_id>/);
  assert.match(production, /EPISODE STYLE PROFILE SHA256: <style_profile_checksum_sha256>/);
});

test('each active visual route keeps its medium-specific authority', () => {
  assert.match(routing, /loose-line-vivid-watercolor[\s\S]*warm-paper-watercolor-cohesion-v1/i);
  assert.match(routing, /twilight-neon-animation[\s\S]*twilight-luminous-cohesion-v1/i);
  assert.match(routing, /gilded-mythic-storybook[\s\S]*gilded-mythic-cohesion-v1/i);
  assert.match(routing, /cover-derived-episode-style[\s\S]*cover-derived-cohesion-v1/i);
  assert.match(routing, /Ian remains Ian[\s\S]*pale-lavender or warm-white paper[\s\S]*indigo\/gray-violet fine[\s\S]*periwinkle[\s\S]*light-peach\/coral/i);
  assert.match(routing, /Forbid dark cinematic backgrounds, neon signs, heavy bloom,[\s\S]*plastic 3D modeling[\s\S]*second Style Anchor/i);
  assert.match(whiteboard, /暖白纸底、深灰细线、浅蓝\/灰紫\/浅桃点色与适量留白/);
  assert.match(whiteboard, /逐笔标注与渲染机制保持不变/);
});

test('publishing covers stay outside cohesion and normal cross-medium differences remain explicit', () => {
  assert.match(routing, /`local-video-file` remains a pixel-preserving exception/i);
  assert.match(routing, /Publishing covers are[\s\S]*outside the episode timeline and cohesion contract/i);
  assert.match(routing, /Never recolor local-video[\s\S]*bytes/i);
  assert.match(routing, /Ian and white-cat ImageGen may retain normal medium[\s\S]*differences/i);
  assert.match(review, /Ian and white-cat medium differences are[\s\S]*expected/i);
});

test('cohesion overview joins the existing final review without a new decision', () => {
  assert.match(review, /manual mode, include it with the final already-required asset approval/i);
  assert.match(review, /one-click mode, include it with the existing complete exact asset list/i);
  assert.match(review, /node leverage-video\/src\/shared\/visual-assets\/build-visual-cohesion-overview\.mjs <episode-workspace> <output\.png>/);
  assert.match(review, /exactly one representative per shot in storyboard[\s\S]*master for ImageGen\/Xuan\/Ink[\s\S]*Ian's final composite[\s\S]*Whiteboard's[\s\S]*region preview/i);
  assert.match(review, /Exclude publishing covers, historical opening covers, and local-video shots/i);
  assert.match(review, /exact `1920×1080` PNG[\s\S]*proportional contain plus padding[\s\S]*never stretched/i);
  assert.match(review, /adds no new Gate or user reply/i);
  assert.match(review, /command fails/i);
  assert.match(review, /representative[\s\S]*images sequentially in storyboard\/shot order/i);
  assert.match(review, /inability to inspect the complete[\s\S]*blocks visual lock/i);
  assert.match(review, /`无明显跳脱`[\s\S]*`镜头 ID \+ 突兀原因`/);
  assert.match(review, /palette family, luminance, saturation, negative space, line weight,[\s\S]*visual[\s\S]*density, and adjacent-shot visual weight/i);
  assert.match(review, /Any named anomaly rejects the affected item before approval\/lock/i);
});

test('xuan and ink profiles remain checksum-pinned after the style catalog update', () => {
  const byId = Object.fromEntries(routeCatalog.routes.map((route) => [route.route_id, route]));
  assert.equal(byId['xuan-paper-diorama'].style_profile_id, 'xuan-paper-diorama');
  assert.equal(path.posix.basename(byId['xuan-paper-diorama'].style_profile_path), 'xuan-paper-diorama.md');
  assert.equal(path.posix.basename(byId['xuan-paper-diorama'].style_skill_path), 'SKILL.md');
  assert.equal(byId['xuan-paper-diorama'].style_skill_checksum_sha256, '319f127e6ce025db47b8a3d7af4c92136090ebaaf8116da1f84b5bcb9c236013');
  assert.equal(byId['xuan-paper-diorama'].style_profile_checksum_sha256, 'f4fca8d3e00dfeaa69c9c6eef5d4b04375872e51ae1785e4a2ac9ac83f3e7f89');
  assert.equal(byId['ink-doodle-knowledge-card'].style_profile_id, 'ink-doodle-knowledge-card');
  assert.equal(path.posix.basename(byId['ink-doodle-knowledge-card'].style_profile_path), 'ink-doodle-knowledge-card.md');
  assert.equal(path.posix.basename(byId['ink-doodle-knowledge-card'].style_skill_path), 'SKILL.md');
  assert.equal(byId['ink-doodle-knowledge-card'].style_skill_checksum_sha256, '319f127e6ce025db47b8a3d7af4c92136090ebaaf8116da1f84b5bcb9c236013');
  assert.equal(byId['ink-doodle-knowledge-card'].style_profile_checksum_sha256, 'f993cf7c84bd1a738d84c90385502864ba83c54c10d5accb564ec23be06d2588');
  assert.match(routing, /Fixed profile bytes and[\s\S]*checksums never change/i);
});

test('cohesion does not mutate pinned route style bytes', () => {
  assert.match(routing, /Fixed profile bytes and[\s\S]*checksums never change/i);
  assert.match(review, /never authorizes an automatic restyle/i);
});
