#!/usr/bin/env node

import crypto from 'node:crypto';
import {isFlipbookRow} from '../flipbook-video/profile.mjs';
import {inspectStaticSpreadAsset} from './static-spread-contract.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

import sharp from 'sharp';

import {
  composeIanLayeredSceneBytes,
  inspectIanLayeredScenePackage,
} from '../ian-layered-scene/contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(HERE, '../../../..');
const REVIEW_PHASE = 'awaiting_precomposition_visual_review';
const REVIEW_CONTRACT = 'final-production-asset-review-package-v1';
const DIRECT_FIRST_SHOT_CONTRACT = 'direct-first-shot-v1';
const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;
const ASSETS_PER_PAGE = 12;
const SHA256 = /^[a-f0-9]{64}$/;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

export class FinalProductionAssetReviewError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FinalProductionAssetReviewError';
  }
}

const fail = (message) => {
  throw new FinalProductionAssetReviewError(message);
};

const sha256Bytes = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
};
const canonicalBytes = (value) => Buffer.from(JSON.stringify(canonicalize(value)));
const posixPath = (value) => value.split(path.sep).join('/');
const isWithin = (parent, candidate) => {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`)
    && relative !== '..' && !path.isAbsolute(relative));
};

const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const escapeXml = escapeHtml;

const readJson = (target, label) => {
  let bytes;
  try {
    bytes = fs.readFileSync(target);
  } catch {
    fail(`${label} is missing`);
  }
  try {
    return {bytes, value: JSON.parse(bytes.toString('utf8'))};
  } catch {
    fail(`${label} is invalid JSON`);
  }
};

const resolveWorkspace = (repositoryRoot, episodeWorkspace) => {
  if (typeof episodeWorkspace !== 'string' || episodeWorkspace.trim() === ''
      || path.isAbsolute(episodeWorkspace)) {
    fail('episode workspace must be repository-root-relative');
  }
  const repository = fs.realpathSync(repositoryRoot);
  const candidate = path.resolve(repository, episodeWorkspace);
  if (!isWithin(repository, candidate)) fail('episode workspace escapes repository root');
  let resolved;
  try {
    resolved = fs.realpathSync(candidate);
  } catch {
    fail(`episode workspace does not exist: ${episodeWorkspace}`);
  }
  const status = fs.lstatSync(resolved);
  if (!isWithin(repository, resolved) || status.isSymbolicLink() || !status.isDirectory()) {
    fail('episode workspace must be a real directory inside repository root');
  }
  return {repository, resolved, relative: posixPath(path.relative(repository, resolved))};
};

const requireRegularFile = (target, label) => {
  let status;
  try {
    status = fs.lstatSync(target);
  } catch {
    fail(`${label} is missing`);
  }
  if (status.isSymbolicLink() || !status.isFile() || status.size === 0) {
    fail(`${label} must be a regular non-symlink non-empty file`);
  }
  return status;
};

const resolveEpisodeFile = (workspace, relativePath, checksum, label) => {
  if (typeof relativePath !== 'string' || relativePath.trim() === '' || path.isAbsolute(relativePath)) {
    fail(`${label} path must be repository-root-relative`);
  }
  if (!SHA256.test(checksum ?? '')) fail(`${label} checksum is invalid`);
  const candidate = path.resolve(workspace.repository, relativePath);
  if (!isWithin(workspace.resolved, candidate)) fail(`${label} escapes episode workspace`);
  requireRegularFile(candidate, label);
  const real = fs.realpathSync(candidate);
  if (!isWithin(workspace.resolved, real)) fail(`${label} resolves outside episode workspace`);
  const bytes = fs.readFileSync(real);
  if (sha256Bytes(bytes) !== checksum) fail(`${label} checksum is stale`);
  return {absolute: real, relative: posixPath(path.relative(workspace.repository, real)), bytes};
};

const resolveExternalFile = (absolutePath, checksum, label) => {
  if (typeof absolutePath !== 'string' || !path.isAbsolute(absolutePath)) {
    fail(`${label} path must be absolute`);
  }
  if (!SHA256.test(checksum ?? '')) fail(`${label} checksum is invalid`);
  requireRegularFile(absolutePath, label);
  const real = fs.realpathSync(absolutePath);
  const bytes = fs.readFileSync(real);
  if (sha256Bytes(bytes) !== checksum) fail(`${label} checksum is stale`);
  return {absolute: real, path: absolutePath, bytes};
};

const inspectImage = async (file, label) => {
  if (!IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase())) {
    fail(`${label} must be a supported still image`);
  }
  let metadata;
  try {
    const image = sharp(file, {failOn: 'error'});
    metadata = await image.metadata();
    await image.raw().toBuffer();
  } catch {
    fail(`${label} must fully decode as an image`);
  }
  if (!Number.isInteger(metadata.width) || !Number.isInteger(metadata.height)
      || metadata.width <= 0 || metadata.height <= 0) {
    fail(`${label} dimensions are invalid`);
  }
  return {width: metadata.width, height: metadata.height, format: metadata.format};
};

const sameJson = (left, right) => canonicalBytes(left).equals(canonicalBytes(right));

const completeFinalReviewProjection = (review) => ({
  contract_version: 'visual-asset-review-v3',
  mode: 'one_click_final_review_v1',
  storyboard_sha256: review.storyboard_sha256,
  policy_sha256: review.policy_sha256,
  assets: review.assets.map((asset) => ({
    asset_id: asset.asset_id,
    path: asset.path,
    checksum_sha256: asset.checksum_sha256,
    qa_status: asset.qa_status,
    ...(asset.static_spread_review === undefined
      ? {} : {static_spread_review: asset.static_spread_review}),
    ...(asset.ian_layered_scene_package === undefined
      ? {} : {ian_layered_scene_package: asset.ian_layered_scene_package}),
    ...(asset.white_cat_anatomy_review === undefined
      ? {} : {white_cat_anatomy_review: asset.white_cat_anatomy_review}),
  })),
});

export const buildCompleteFinalVisualMapSha256 = (review) => sha256Bytes(
  canonicalBytes(completeFinalReviewProjection(review)),
);

const validateCompleteFinalVisualReview = (review) => {
  if (review?.contract_version !== 'visual-asset-review-v3'
      || review.mode !== 'one_click_final_review_v1'
      || !Array.isArray(review.assets) || review.assets.length === 0) {
    fail('one-click final visual review is missing');
  }
  if (!SHA256.test(review.storyboard_sha256 ?? '') || !SHA256.test(review.policy_sha256 ?? '')) {
    fail('one-click final visual review bindings are invalid');
  }
  const ids = new Set();
  review.assets.forEach((asset) => {
    if (typeof asset?.asset_id !== 'string' || asset.asset_id.trim() === '' || ids.has(asset.asset_id)) {
      fail('one-click final visual review asset IDs must be unique');
    }
    ids.add(asset.asset_id);
    if (typeof asset.path !== 'string' || asset.path.trim() === ''
        || !SHA256.test(asset.checksum_sha256 ?? '')
        || asset.qa_status !== 'qa_passed_pending_final_review') {
      fail(`${asset.asset_id} has incomplete final-review evidence`);
    }
  });
  const expected = buildCompleteFinalVisualMapSha256(review);
  if (review.presented_map_sha256 !== expected) fail('one-click complete final visual map checksum is stale');
  return {result: 'pass', presented_map_sha256: expected, asset_count: review.assets.length};
};

const packageMembers = (value) => [
  {
    member_role: 'source-master',
    layer_id: 'source-master',
    path: value.master_generation.source_master.path,
    checksum_sha256: value.master_generation.source_master.checksum_sha256,
    width: value.master_generation.source_master.width,
    height: value.master_generation.source_master.height,
    has_alpha: value.master_generation.source_master.has_alpha,
  },
  {
    member_role: 'normalized-master',
    layer_id: 'normalized-master',
    path: value.normalized_master.path,
    checksum_sha256: value.normalized_master.checksum_sha256,
    width: value.normalized_master.width,
    height: value.normalized_master.height,
    has_alpha: value.normalized_master.has_alpha,
  },
  {
    member_role: 'background',
    layer_id: 'background',
    path: value.background.path,
    checksum_sha256: value.background.checksum_sha256,
    width: value.background.width,
    height: value.background.height,
    has_alpha: value.background.has_alpha,
  },
  ...value.pre_text_layers.map((member) => ({
    member_role: 'pre-text-layer',
    layer_id: member.layer_id,
    path: member.path,
    checksum_sha256: member.checksum_sha256,
    width: member.width,
    height: member.height,
    has_alpha: member.has_alpha,
  })),
  ...value.layers.map((member) => ({
    member_role: 'semantic-layer',
    layer_id: member.layer_id,
    path: member.path,
    checksum_sha256: member.checksum_sha256,
    width: member.width,
    height: member.height,
    has_alpha: member.has_alpha,
  })),
  {
    member_role: 'final-composite',
    layer_id: 'final-composite',
    path: value.final_composite.path,
    checksum_sha256: value.final_composite.checksum_sha256,
    width: value.final_composite.width,
    height: value.final_composite.height,
    has_alpha: value.final_composite.has_alpha,
  },
];

const validateNarrationSource = (state) => {
  const source = state.narration_script_source;
  if (source?.origin !== 'script_resource') fail('narration script source is not locked to script_resource');
  return resolveExternalFile(
    source.source_path,
    source.source_checksum_sha256,
    'resolved narration source',
  );
};

const validateCover = async (state) => {
  const cover = state.opening_cover;
  if (cover?.contract_version !== 'cover-only-v1' || cover.no_added_text !== true) {
    fail('cover-only-v1 evidence is missing');
  }
  const file = resolveExternalFile(cover.source_path, cover.source_checksum_sha256, 'opening cover');
  const image = await inspectImage(file.absolute, 'opening cover');
  return {
    contract_version: 'cover-only-v1',
    review_scope: 'fixed-opening-input-outside-visual-final-review-queue',
    path: cover.source_path,
    checksum_sha256: cover.source_checksum_sha256,
    dimensions: image,
    absolute: file.absolute,
  };
};

export const resolveFinalReviewTimelineOpening = ({activeQueue, state}) => {
  if (!Array.isArray(activeQueue)) fail('active final-review queue is missing');
  const flipbookCount = activeQueue.filter(isFlipbookRow).length;
  if (flipbookCount !== 0 && flipbookCount !== activeQueue.length) {
    fail('final review cannot mix flipbook and non-flipbook assets');
  }
  if (flipbookCount === 0) return null;
  if (activeQueue[0]?.shot_id !== 'S01'
      || activeQueue[0]?.shot_start_frame !== 0
      || state?.storyboard_draft?.direct_first_shot_contract !== DIRECT_FIRST_SHOT_CONTRACT) {
    fail('flipbook final review must bind direct-first S01 at frame zero');
  }
  return {
    contract_version: DIRECT_FIRST_SHOT_CONTRACT,
    first_shot_id: 'S01',
    start_frame: 0,
    fixed_opening_cover: false,
    publishing_cover_included: false,
  };
};

const selectGrid = (count, fixedColumns = null) => {
  const header = 74;
  const footer = 50;
  const gap = 18;
  const margin = 24;
  const candidates = fixedColumns === null
    ? Array.from({length: count}, (unused, index) => index + 1)
    : [fixedColumns];
  let selected = null;
  for (const columns of candidates) {
    const rows = Math.ceil(count / columns);
    const cellWidth = Math.floor((CANVAS_WIDTH - (margin * 2) - (gap * (columns - 1))) / columns);
    const cellHeight = Math.floor((CANVAS_HEIGHT - header - footer - (gap * (rows - 1))) / rows);
    const tileWidth = Math.floor(Math.min(cellWidth, (cellHeight * 16) / 9));
    const tileHeight = Math.floor(tileWidth * 9 / 16);
    const area = tileWidth * tileHeight;
    if (!selected || area > selected.area || (area === selected.area && columns > selected.columns)) {
      selected = {columns, rows, cellWidth, cellHeight, tileWidth, tileHeight, area, header, footer, gap, margin};
    }
  }
  return selected;
};

const labelOverlay = ({title, footer, entries, grid}) => {
  const labels = entries.map((entry, index) => {
    const column = index % grid.columns;
    const row = Math.floor(index / grid.columns);
    const cellX = grid.margin + column * (grid.cellWidth + grid.gap);
    const cellY = grid.header + row * (grid.cellHeight + grid.gap);
    const x = cellX + Math.floor((grid.cellWidth - grid.tileWidth) / 2);
    const y = cellY + Math.floor((grid.cellHeight - grid.tileHeight) / 2);
    const boxHeight = Math.min(42, Math.max(32, Math.floor(grid.tileHeight * 0.16)));
    const fontSize = Math.min(25, Math.max(16, Math.floor(boxHeight * 0.56)));
    return `<rect x="${x}" y="${y + grid.tileHeight - boxHeight}" width="${grid.tileWidth}" height="${boxHeight}" fill="#111827" fill-opacity="0.78"/>`
      + `<text x="${x + 10}" y="${y + grid.tileHeight - Math.floor(boxHeight * 0.28)}" font-family="PingFang SC,Arial,sans-serif" font-size="${fontSize}" font-weight="650" fill="#ffffff">${escapeXml(entry.label)}</text>`;
  }).join('');
  return Buffer.from(`
    <svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <text x="24" y="46" font-family="PingFang SC,Arial,sans-serif" font-size="30" font-weight="700" fill="#20242a">${escapeXml(title)}</text>
      ${labels}
      <text x="24" y="1048" font-family="Menlo,monospace" font-size="17" fill="#4b5563">${escapeXml(footer)}</text>
    </svg>
  `);
};

export const buildLabeledReviewSheet = async ({entries, title, footer, fixedColumns = null}) => {
  if (!Array.isArray(entries) || entries.length === 0) fail('review sheet requires at least one entry');
  const grid = selectGrid(entries.length, fixedColumns);
  const composites = [];
  for (let index = 0; index < entries.length; index += 1) {
    const column = index % grid.columns;
    const row = Math.floor(index / grid.columns);
    const cellX = grid.margin + column * (grid.cellWidth + grid.gap);
    const cellY = grid.header + row * (grid.cellHeight + grid.gap);
    const left = cellX + Math.floor((grid.cellWidth - grid.tileWidth) / 2);
    const top = cellY + Math.floor((grid.cellHeight - grid.tileHeight) / 2);
    const input = entries[index].bytes ?? entries[index].absolute;
    const tile = await sharp(input, {failOn: 'error'})
      .resize(grid.tileWidth, grid.tileHeight, {
        fit: 'contain',
        background: {r: 236, g: 231, b: 220, alpha: 1},
        kernel: sharp.kernel.lanczos3,
      })
      .png({compressionLevel: 9, adaptiveFiltering: false, palette: false})
      .toBuffer();
    composites.push({input: tile, left, top});
  }
  composites.push({input: labelOverlay({title, footer, entries, grid}), left: 0, top: 0});
  return sharp({
    create: {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      channels: 3,
      background: {r: 244, g: 240, b: 232},
    },
  })
    .composite(composites)
    .png({compressionLevel: 9, adaptiveFiltering: false, palette: false})
    .toBuffer();
};

const htmlFileLink = (absolutePath) => pathToFileURL(absolutePath).href;

const renderIanDetails = (asset, stageOutput) => {
  const production = asset.ian.production_inputs.map((member) => `
    <li><code>${escapeHtml(member.layer_id)}</code> · ${escapeHtml(member.path)}<br><span class="hash">${escapeHtml(member.checksum_sha256)}</span></li>`).join('');
  const evidence = asset.ian.evidence_members.map((member) => `
    <li>${escapeHtml(member.member_role)} · <code>${escapeHtml(member.layer_id)}</code> · ${escapeHtml(member.path)}</li>`).join('');
  return `
    <section class="ian-package" data-ian-package="1">
      <h4>${escapeHtml(asset.shot_id)} Ian 完整分层包</h4>
      <p><strong>画面终审：</strong>final-composite。<strong>Remotion 实际输入：</strong>background + 最终 semantic layers。</p>
      <img class="stage-sheet" src="${escapeHtml(htmlFileLink(stageOutput.absolute))}" alt="${escapeHtml(asset.shot_id)} Ian 分层累积预览">
      <details>
        <summary>查看实际生产输入与完整证据成员</summary>
        <h5>实际生产输入</h5><ol>${production}</ol>
        <h5>来源、标准化、pre-text 与终审证据</h5><ul>${evidence}</ul>
        <p class="hash">package manifest: ${escapeHtml(asset.ian.manifest.path)}<br>${escapeHtml(asset.ian.manifest.checksum_sha256)}</p>
      </details>
    </section>`;
};

const renderHtml = ({workspace, digest, phase, createdAt, assets, cover, pages, stageOutputs}) => {
  const byShot = new Map();
  assets.forEach((asset) => {
    if (!byShot.has(asset.shot_id)) byShot.set(asset.shot_id, []);
    byShot.get(asset.shot_id).push(asset);
  });
  const pageMarkup = pages.map((page, index) => `
    <figure><img src="${escapeHtml(htmlFileLink(page.absolute))}" alt="候选素材总览第 ${index + 1} 页"><figcaption>第 ${index + 1} 页 · ${page.asset_ids.map(escapeHtml).join('、')}</figcaption></figure>`).join('');
  const shotMarkup = [...byShot.entries()].map(([shotId, shotAssets]) => {
    const cards = shotAssets.map((asset) => `
      <article class="asset" data-final-review-asset="1" data-asset-id="${escapeHtml(asset.asset_id)}">
        <img src="${escapeHtml(htmlFileLink(asset.absolute))}" alt="${escapeHtml(asset.asset_id)}">
        <div class="asset-body">
          <h3>${escapeHtml(asset.asset_id)}</h3>
          <p><span class="badge">${escapeHtml(asset.role)}</span><span class="badge">${escapeHtml(asset.route)}</span><span class="badge ok">${escapeHtml(asset.qa_status)}</span></p>
          <p><strong>原始路径</strong><br><a href="${escapeHtml(htmlFileLink(asset.absolute))}">${escapeHtml(asset.path)}</a></p>
          <p class="hash"><strong>SHA-256</strong><br>${escapeHtml(asset.checksum_sha256)}</p>
          <p>${asset.static_spread_review !== null ? '完整静态图片等比置入书页；已按半页尺寸检查可读性。' : asset.ian === null ? '批准后由此精确源图派生 1920×1080 合成栅格。' : '此图为 final-composite；批准对象是下方完整 Ian 分层包。'}</p>
        </div>
      </article>`).join('');
    const ian = shotAssets.find((asset) => asset.ian !== null);
    return `<section class="shot"><h2>${escapeHtml(shotId)}</h2><div class="asset-grid">${cards}</div>${ian ? renderIanDetails(ian, stageOutputs.get(ian.asset_id)) : ''}</section>`;
  }).join('');
  const openingMarkup = cover === null
    ? '<section class="notice"><strong>时间线开场：</strong><code>direct-first-shot-v1</code>；S01 从第 0 帧开始。发布封面只可由已批准的图文翻书 opening adapter 另行引入。</section>'
    : `<section class="cover"><h2>固定开场封面</h2><img src="${escapeHtml(htmlFileLink(cover.absolute))}" alt="固定开场封面"><p>此图会进入成片，但依据 <code>cover-only-v1</code> 不属于视觉终审队列。</p><p class="hash">${escapeHtml(cover.path)}<br>${escapeHtml(cover.checksum_sha256)}</p></section>`;
  return Buffer.from(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="final-production-review-contract" content="${REVIEW_CONTRACT}">
  <meta name="final-production-review-map-sha256" content="${escapeHtml(digest)}">
  <meta name="final-production-review-asset-count" content="${assets.length}">
  <meta name="final-production-review-ian-package-count" content="${stageOutputs.size}">
  <title>最终视频素材统一审核 · ${escapeHtml(digest.slice(0, 8))}</title>
  <style>
    :root{color-scheme:light;--paper:#f6f1e7;--ink:#20242a;--muted:#667085;--line:#d9d2c5;--accent:#4f61a8}
    *{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:"PingFang SC","Microsoft YaHei",sans-serif;line-height:1.55}
    main{max-width:1500px;margin:auto;padding:36px}.lead,.notice,.cover,.ian-package{background:#fffdfa;border:1px solid var(--line);border-radius:16px;padding:20px;margin:18px 0}
    .notice{border-left:6px solid var(--accent)}code,.hash{font-family:Menlo,Consolas,monospace;overflow-wrap:anywhere;font-size:12px}.overview-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.overview-grid img,.cover img,.stage-sheet{display:block;width:100%;height:auto;border:1px solid var(--line);border-radius:10px;background:#eee7dc}.overview-grid figcaption{font-size:12px;color:var(--muted);overflow-wrap:anywhere}
    .shot{margin:42px 0}.asset-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:18px}.asset{background:#fffdfa;border:1px solid var(--line);border-radius:14px;overflow:hidden}.asset>img{display:block;width:100%;aspect-ratio:16/9;object-fit:contain;background:#ece7dc}.asset-body{padding:16px}.asset h3{margin:0 0 8px}.badge{display:inline-block;margin:0 6px 6px 0;padding:3px 8px;border-radius:999px;background:#ececf7;font-size:12px}.badge.ok{background:#e5f5e9;color:#166534}a{color:#3047a0}details{margin-top:16px}li{margin:8px 0}@media(max-width:900px){main{padding:18px}.overview-grid{grid-template-columns:1fr}}
  </style>
</head>
<body><main>
  <h1>最终视频素材统一审核</h1>
  <section class="lead"><p><strong>当前阶段：</strong>${escapeHtml(phase)}<br><strong>完整清单摘要：</strong><span class="hash">${escapeHtml(digest)}</span><br><strong>候选素材：</strong>${assets.length} 项；<strong>镜头：</strong>${byShot.size} 个；<strong>生成时间：</strong>${escapeHtml(createdAt)}</p></section>
  <section class="notice"><strong>审核边界：</strong>本页只展示当前 <code>final_review.assets</code>。QA 图、提示词、旧版与废弃图均未纳入。生成本页不代表批准，也不改变审批状态。</section>
  <h2>分页总览</h2><div class="overview-grid">${pageMarkup}</div>
  ${openingMarkup}
  ${shotMarkup}
  <section class="notice"><strong>批准含义：</strong>批准须绑定本页顶部完整摘要。Ian 批准的是完整分层包，不只是 final-composite。</section>
</main></body></html>`, 'utf8');
};

const ensureOutputDirectory = (workspace, relativeDirectory) => {
  const target = path.resolve(workspace.repository, relativeDirectory);
  if (!isWithin(workspace.resolved, target)) fail('review output directory escapes episode workspace');
  const relative = path.relative(workspace.resolved, target);
  let current = workspace.resolved;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (fs.existsSync(current)) {
      const status = fs.lstatSync(current);
      if (status.isSymbolicLink() || !status.isDirectory()) {
        fail(`review output directory component is not a real directory: ${current}`);
      }
    } else {
      fs.mkdirSync(current);
    }
  }
};

const writeOutputsExclusive = (outputs) => {
  outputs.forEach((output) => {
    if (fs.existsSync(output.absolute)) fail(`refusing to overwrite existing review output: ${output.relative}`);
  });
  const written = [];
  try {
    outputs.forEach((output) => {
      fs.writeFileSync(output.absolute, output.bytes, {flag: 'wx'});
      const status = fs.lstatSync(output.absolute);
      written.push({path: output.absolute, device: status.dev, inode: status.ino, checksum: sha256Bytes(output.bytes)});
    });
  } catch (error) {
    for (const owned of written.reverse()) {
      if (!fs.existsSync(owned.path)) continue;
      const status = fs.lstatSync(owned.path);
      if (!status.isSymbolicLink() && status.isFile() && status.dev === owned.device
          && status.ino === owned.inode && sha256Bytes(fs.readFileSync(owned.path)) === owned.checksum) {
        fs.unlinkSync(owned.path);
      }
    }
    throw error;
  }
};

const outputBinding = (workspace, relative, bytes, extra = {}) => ({
  path: relative,
  checksum_sha256: sha256Bytes(bytes),
  width: CANVAS_WIDTH,
  height: CANVAS_HEIGHT,
  ...extra,
  absolute: path.resolve(workspace.repository, relative),
  bytes,
});

const publicOutput = ({absolute, bytes, ...value}) => value;

export const buildFinalProductionAssetReview = async ({
  episodeWorkspace,
  expectedPresentedMapSha256,
  repositoryRoot = REPOSITORY_ROOT,
  createdAt = new Date().toISOString(),
  inspectIanPackage = inspectIanLayeredScenePackage,
  composeIan = composeIanLayeredSceneBytes,
} = {}) => {
  if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) fail('createdAt must be an ISO timestamp');
  const workspace = resolveWorkspace(repositoryRoot, episodeWorkspace);
  const statePath = path.join(workspace.resolved, 'schema', 'episode-state.json');
  const stateRecord = readJson(statePath, 'episode state');
  const state = stateRecord.value;
  const declaredPhase = state.phase ?? state.current_phase;
  if (state.current_phase !== REVIEW_PHASE || declaredPhase !== REVIEW_PHASE) {
    fail(`episode must be in ${REVIEW_PHASE}`);
  }
  if (state.visual_asset_review?.mode !== 'one_click_final_review_v1'
      || state.visual_asset_review.status !== 'in_progress') {
    fail('episode is not in one-click final visual review');
  }
  const finalReview = state.visual_asset_review.final_review;
  if (finalReview?.status !== 'pending') fail('one-click final visual review must still be pending');
  const reviewValidation = validateCompleteFinalVisualReview(finalReview);
  const digest = reviewValidation.presented_map_sha256;
  if (expectedPresentedMapSha256 !== undefined && expectedPresentedMapSha256 !== digest) {
    fail('expected final visual map checksum is stale');
  }
  const shortDigest = digest.slice(0, 8);
  const source = validateNarrationSource(state);
  const queue = state.visual_asset_review.queue;
  if (!Array.isArray(queue)) fail('visual_asset_review.queue is missing');
  const activeQueue = queue.filter((item) => item?.active_for_current_storyboard !== false && item?.status !== 'superseded');
  const timelineOpening = resolveFinalReviewTimelineOpening({activeQueue, state});
  const directFirst = timelineOpening !== null;
  const cover = directFirst ? null : await validateCover(state);
  if (activeQueue.length !== finalReview.assets.length) fail('final review does not match active queue length');

  const assets = [];
  const ianStages = [];
  for (let index = 0; index < finalReview.assets.length; index += 1) {
    const reviewAsset = finalReview.assets[index];
    const queueItem = activeQueue[index];
    if (reviewAsset.asset_id !== queueItem?.asset_id || reviewAsset.path !== queueItem.path
        || reviewAsset.checksum_sha256 !== queueItem.checksum_sha256
        || reviewAsset.qa_status !== 'qa_passed_pending_final_review'
        || queueItem.status !== 'qa_passed_pending_final_review') {
      fail(`final review asset ${reviewAsset.asset_id} differs from active queue`);
    }
    const file = resolveEpisodeFile(workspace, reviewAsset.path, reviewAsset.checksum_sha256, reviewAsset.asset_id);
    const dimensions = await inspectImage(file.absolute, reviewAsset.asset_id);
    const record = {
      asset_id: reviewAsset.asset_id,
      shot_id: queueItem.shot_id,
      role: queueItem.role,
      route: queueItem.visual_generation_route,
      qa_status: reviewAsset.qa_status,
      path: file.relative,
      checksum_sha256: reviewAsset.checksum_sha256,
      dimensions,
      absolute: file.absolute,
      ian: null,
      static_spread_review: null,
    };
    if (isFlipbookRow(queueItem)) {
      const staticReview = await inspectStaticSpreadAsset({repositoryRoot, state, item: queueItem});
      if (!sameJson(reviewAsset.static_spread_review, staticReview)) fail(`${reviewAsset.asset_id} static spread review is stale`);
      record.static_spread_review = staticReview;
    }
    const anatomyReview = reviewAsset.white_cat_anatomy_review;
    if (queueItem.white_cat_present === true || anatomyReview !== undefined) {
      if (anatomyReview?.numbered_limb_map_source_checksum_sha256 !== reviewAsset.checksum_sha256
          || !sameJson(anatomyReview.numbered_limb_map_limb_ids, ['F1', 'F2', 'H1', 'H2'])) {
        fail(`${reviewAsset.asset_id} white-cat numbered limb map binding is stale`);
      }
      const limbMap = resolveEpisodeFile(
        workspace,
        anatomyReview.numbered_limb_map_path,
        anatomyReview.numbered_limb_map_checksum_sha256,
        `${reviewAsset.asset_id} white-cat numbered limb map`,
      );
      const limbDimensions = await inspectImage(limbMap.absolute, `${reviewAsset.asset_id} white-cat numbered limb map`);
      if (limbDimensions.width !== dimensions.width || limbDimensions.height !== dimensions.height) {
        fail(`${reviewAsset.asset_id} white-cat numbered limb map dimensions are stale`);
      }
    }
    if (!isFlipbookRow(queueItem) && queueItem.visual_generation_route === 'ian-handdrawn-ppt') {
      const packageReview = reviewAsset.ian_layered_scene_package;
      if (packageReview?.contract_version !== 'ian-knowledge-video-layered-scene-v2'
          || !SHA256.test(packageReview.package_review_sha256 ?? '')) {
        fail(`${reviewAsset.asset_id} lacks its complete Ian package review`);
      }
      const manifestFile = resolveEpisodeFile(
        workspace,
        packageReview.manifest?.path,
        packageReview.manifest?.checksum_sha256,
        `${reviewAsset.asset_id} Ian package manifest`,
      );
      const manifest = readJson(manifestFile.absolute, `${reviewAsset.asset_id} Ian package manifest`).value;
      const inspection = await inspectIanPackage(manifest, {
        repositoryRoot: workspace.repository,
        episodeWorkspace: workspace.relative,
      });
      if (inspection?.result !== 'pass') fail(`${reviewAsset.asset_id} Ian package inspection failed`);
      const inspected = inspection.package;
      const expectedMembers = packageMembers(inspected);
      if (packageReview.scene_plan_sha256 !== inspected.scene_plan_sha256
          || reviewAsset.path !== inspected.final_composite.path
          || reviewAsset.checksum_sha256 !== inspected.final_composite.checksum_sha256
          || !sameJson(packageReview.members, expectedMembers)) {
        fail(`${reviewAsset.asset_id} Ian final-review package is stale`);
      }
      for (const member of expectedMembers) {
        const memberFile = resolveEpisodeFile(
          workspace,
          member.path,
          member.checksum_sha256,
          `${reviewAsset.asset_id} Ian member ${member.member_role}/${member.layer_id}`,
        );
        const memberDimensions = await inspectImage(memberFile.absolute, `${reviewAsset.asset_id} Ian member ${member.layer_id}`);
        if (memberDimensions.width !== member.width || memberDimensions.height !== member.height) {
          fail(`${reviewAsset.asset_id} Ian member ${member.layer_id} dimensions are stale`);
        }
      }
      const background = resolveEpisodeFile(
        workspace,
        inspected.background.path,
        inspected.background.checksum_sha256,
        `${reviewAsset.asset_id} Ian background`,
      );
      const layerFiles = inspected.layers.map((member) => resolveEpisodeFile(
        workspace,
        member.path,
        member.checksum_sha256,
        `${reviewAsset.asset_id} Ian layer ${member.layer_id}`,
      ));
      const stages = [];
      for (let layerCount = 0; layerCount <= layerFiles.length; layerCount += 1) {
        const bytes = await composeIan({
          backgroundPath: background.absolute,
          layerPaths: layerFiles.slice(0, layerCount).map((entry) => entry.absolute),
        });
        stages.push({
          label: layerCount === 0 ? 'background' : `+${inspected.layers[layerCount - 1].layer_id}`,
          bytes,
        });
      }
      if (!stages.at(-1).bytes.equals(file.bytes)) {
        fail(`${reviewAsset.asset_id} Ian final cumulative stage differs from final-composite bytes`);
      }
      record.ian = {
        manifest: {
          path: manifestFile.relative,
          checksum_sha256: packageReview.manifest.checksum_sha256,
        },
        package_review_sha256: packageReview.package_review_sha256,
        scene_plan_sha256: packageReview.scene_plan_sha256,
        final_composite: expectedMembers.at(-1),
        production_inputs: [expectedMembers.find((member) => member.member_role === 'background')]
          .concat(expectedMembers.filter((member) => member.member_role === 'semantic-layer')),
        evidence_members: expectedMembers.filter((member) => !['background', 'semantic-layer'].includes(member.member_role)),
      };
      ianStages.push({asset: record, stages});
    } else if (reviewAsset.ian_layered_scene_package !== undefined) {
      fail(`${reviewAsset.asset_id} unexpectedly contains an Ian package review`);
    }
    assets.push(record);
  }

  const reviewDirectory = `${workspace.relative}/assets/image/review`;
  const docsDirectory = `${workspace.relative}/docs`;
  const schemaDirectory = `${workspace.relative}/schema`;
  [reviewDirectory, docsDirectory, schemaDirectory].forEach((directory) => ensureOutputDirectory(workspace, directory));

  const pageOutputs = [];
  for (let start = 0; start < assets.length; start += ASSETS_PER_PAGE) {
    const pageAssets = assets.slice(start, start + ASSETS_PER_PAGE);
    const pageNumber = pageOutputs.length + 1;
    const pageBytes = await buildLabeledReviewSheet({
      entries: pageAssets.map((asset) => ({absolute: asset.absolute, label: asset.asset_id})),
      title: `FINAL PRODUCTION CANDIDATES · ${pageNumber}/${Math.ceil(assets.length / ASSETS_PER_PAGE)}`,
      footer: `map ${digest} · exact final_review.assets order`,
      fixedColumns: 4,
    });
    pageOutputs.push(outputBinding(
      workspace,
      `${reviewDirectory}/final-production-assets-${shortDigest}-page-${String(pageNumber).padStart(2, '0')}.png`,
      pageBytes,
      {asset_ids: pageAssets.map((asset) => asset.asset_id)},
    ));
  }

  const stageOutputs = new Map();
  for (const entry of ianStages) {
    const bytes = await buildLabeledReviewSheet({
      entries: entry.stages,
      title: `${entry.asset.shot_id} · IAN CUMULATIVE LAYERS`,
      footer: `background + ordered semantic layers · final bytes equal final-composite · map ${digest}`,
    });
    stageOutputs.set(entry.asset.asset_id, outputBinding(
      workspace,
      `${reviewDirectory}/final-production-assets-${shortDigest}-${entry.asset.shot_id}-ian-stages.png`,
      bytes,
      {asset_id: entry.asset.asset_id, stage_labels: entry.stages.map((stage) => stage.label)},
    ));
  }

  const htmlRelative = `${docsDirectory}/final-production-asset-review-${shortDigest}.html`;
  const htmlBytes = renderHtml({
    workspace,
    digest,
    phase: REVIEW_PHASE,
    createdAt,
    assets,
    cover,
    pages: pageOutputs,
    stageOutputs,
  });
  const htmlOutput = {
    path: htmlRelative,
    checksum_sha256: sha256Bytes(htmlBytes),
    absolute: path.resolve(workspace.repository, htmlRelative),
    bytes: htmlBytes,
  };
  const manifestRelative = `${schemaDirectory}/final-production-asset-review-${shortDigest}.json`;
  const manifest = {
    contract_version: REVIEW_CONTRACT,
    episode_workspace: workspace.relative,
    phase: REVIEW_PHASE,
    created_at: createdAt,
    presented_map_sha256: digest,
    source_narration: {
      path: state.narration_script_source.source_path,
      checksum_sha256: state.narration_script_source.source_checksum_sha256,
      current_bytes_verified: sha256Bytes(source.bytes) === state.narration_script_source.source_checksum_sha256,
    },
    counts: {
      shot_count: new Set(assets.map((asset) => asset.shot_id)).size,
      asset_count: assets.length,
      page_count: pageOutputs.length,
      ian_package_count: ianStages.length,
    },
    ...(directFirst ? {timeline_opening: timelineOpening} : {
      cover: {
        contract_version: cover.contract_version,
        review_scope: cover.review_scope,
        path: cover.path,
        checksum_sha256: cover.checksum_sha256,
        dimensions: cover.dimensions,
      },
    }),
    assets: assets.map((asset) => ({
      asset_id: asset.asset_id,
      shot_id: asset.shot_id,
      role: asset.role,
      visual_generation_route: asset.route,
      qa_status: asset.qa_status,
      path: asset.path,
      checksum_sha256: asset.checksum_sha256,
      dimensions: asset.dimensions,
      ...(asset.static_spread_review === null
        ? {} : {static_spread_review: asset.static_spread_review}),
      production_behavior: asset.static_spread_review !== null
        ? 'approved-complete-source-contained-in-one-book-page'
        : asset.ian === null
        ? 'approved-source-derives-1920x1080-composition-raster-after-lock'
        : 'remotion-consumes-approved-background-plus-ordered-final-semantic-layers',
      ...(asset.ian === null ? {} : {ian_layered_scene_package: asset.ian}),
    })),
    outputs: {
      html: {path: htmlOutput.path, checksum_sha256: htmlOutput.checksum_sha256},
      pages: pageOutputs.map(publicOutput),
      ian_stage_sheets: [...stageOutputs.values()].map(publicOutput),
    },
    approval_effect: 'none-display-aid-only',
    episode_state_mutated: false,
  };
  const manifestBytes = jsonBytes(manifest);
  const manifestOutput = {
    path: manifestRelative,
    checksum_sha256: sha256Bytes(manifestBytes),
    absolute: path.resolve(workspace.repository, manifestRelative),
    bytes: manifestBytes,
  };
  writeOutputsExclusive([
    ...pageOutputs,
    ...stageOutputs.values(),
    htmlOutput,
    manifestOutput,
  ]);
  if (!fs.readFileSync(statePath).equals(stateRecord.bytes)) {
    fail('episode state changed while building the display-only review package');
  }
  return {
    status: 'created',
    contract_version: REVIEW_CONTRACT,
    presented_map_sha256: digest,
    counts: manifest.counts,
    html: publicOutput(htmlOutput),
    manifest: publicOutput(manifestOutput),
    pages: pageOutputs.map(publicOutput),
    ian_stage_sheets: [...stageOutputs.values()].map(publicOutput),
    episode_state_mutated: false,
  };
};

const isCli = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isCli) {
  try {
    const [episodeWorkspace, flag, expectedPresentedMapSha256, ...rest] = process.argv.slice(2);
    if (!episodeWorkspace || flag !== '--expected-map-sha256' || !SHA256.test(expectedPresentedMapSha256 ?? '')
        || rest.length > 0) {
      fail('usage: build-final-production-asset-review.mjs <episode-workspace> --expected-map-sha256 <sha256>');
    }
    const report = await buildFinalProductionAssetReview({episodeWorkspace, expectedPresentedMapSha256});
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch (error) {
    const report = {
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
    process.stdout.write(`${JSON.stringify(report)}\n`);
    process.exitCode = error instanceof FinalProductionAssetReviewError ? 2 : 1;
  }
}
