import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import sharp from 'sharp';

import {composeIanLayeredSceneBytes} from '../ian-layered-scene/contract.mjs';
import {
  FinalProductionAssetReviewError,
  buildFinalProductionAssetReview,
} from './build-final-production-asset-review.mjs';

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
};
const completeReviewDigest = (review) => sha256(Buffer.from(JSON.stringify(canonicalize({
  contract_version: review.contract_version,
  mode: review.mode,
  storyboard_sha256: review.storyboard_sha256,
  policy_sha256: review.policy_sha256,
  assets: review.assets,
}))));

const writeBytes = (target, bytes) => {
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, bytes);
  return sha256(bytes);
};

const writeJson = (target, value) => writeBytes(target, Buffer.from(`${JSON.stringify(value, null, 2)}\n`));

const png = ({width = 1920, height = 1080, background}) => sharp({
  create: {width, height, channels: 4, background},
}).png({compressionLevel: 9, adaptiveFiltering: false, palette: false}).toBuffer();

const makeFixture = async ({assetCount = 13} = {}) => {
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'final-production-review-'));
  const episodeWorkspace = 'leverage-video/src/episode-test';
  const root = path.join(repositoryRoot, episodeWorkspace);
  const relative = (value) => `${episodeWorkspace}/${value}`;
  const absolute = (value) => path.join(repositoryRoot, value);
  ['assets/image/generated', 'assets/image/ian/S13', 'assets/image/review', 'docs', 'schema'].forEach(
    (directory) => fs.mkdirSync(path.join(root, directory), {recursive: true}),
  );
  const ordinaryPath = relative('assets/image/generated/ordinary.png');
  const ordinaryBytes = await png({width: 1672, height: 940, background: {r: 220, g: 185, b: 120, alpha: 1}});
  const ordinaryChecksum = writeBytes(absolute(ordinaryPath), ordinaryBytes);

  const ianRoot = relative('assets/image/ian/S13');
  const sourceBytes = await png({width: 1672, height: 941, background: {r: 238, g: 233, b: 221, alpha: 1}});
  const normalizedBytes = await png({background: {r: 238, g: 233, b: 221, alpha: 1}});
  const backgroundBytes = await png({background: {r: 246, g: 241, b: 230, alpha: 1}});
  const layerBytes = await sharp({
    create: {width: 1920, height: 1080, channels: 4, background: {r: 0, g: 0, b: 0, alpha: 0}},
  }).composite([{input: Buffer.from('<svg width="1920" height="1080"><circle cx="960" cy="540" r="260" fill="#5367aa"/></svg>')}])
    .png({compressionLevel: 9, adaptiveFiltering: false, palette: false}).toBuffer();
  const sourcePath = `${ianRoot}/source-master-v01.png`;
  const normalizedPath = `${ianRoot}/normalized-master-v01.png`;
  const backgroundPath = `${ianRoot}/background-v01.png`;
  const preTextPath = `${ianRoot}/L01-pre-v01.png`;
  const layerPath = `${ianRoot}/L01-v01.png`;
  const finalPath = `${ianRoot}/final-composite-v01.png`;
  const sourceChecksum = writeBytes(absolute(sourcePath), sourceBytes);
  const normalizedChecksum = writeBytes(absolute(normalizedPath), normalizedBytes);
  const backgroundChecksum = writeBytes(absolute(backgroundPath), backgroundBytes);
  const preTextChecksum = writeBytes(absolute(preTextPath), layerBytes);
  const layerChecksum = writeBytes(absolute(layerPath), layerBytes);
  const finalBytes = await composeIanLayeredSceneBytes({
    backgroundPath: absolute(backgroundPath),
    layerPaths: [absolute(layerPath)],
  });
  const finalChecksum = writeBytes(absolute(finalPath), finalBytes);
  const binding = (target, checksum, width, height, hasAlpha, role) => ({
    path: target, checksum_sha256: checksum, width, height, has_alpha: hasAlpha, role,
  });
  const layerPlan = {
    layer_id: 'L01', z_index: 1, semantic_role: 'concept', source_text_start_byte: 0,
    source_text_end_byte_exclusive: 3, source_text: '测试', entry_frame: 0,
  };
  const ianPackage = {
    contract_version: 'ian-knowledge-video-layered-scene-v2',
    shot_id: 'S13',
    scene_plan_sha256: 'a'.repeat(64),
    master_generation: {
      source_master: binding(sourcePath, sourceChecksum, 1672, 941, false, 'text-free-complete-master-source'),
    },
    normalized_master: binding(normalizedPath, normalizedChecksum, 1920, 1080, false, 'text-free-complete-master-normalized'),
    background: binding(backgroundPath, backgroundChecksum, 1920, 1080, false, 'static-paper-background'),
    pre_text_layers: [{...layerPlan, ...binding(preTextPath, preTextChecksum, 1920, 1080, true, 'transparent-semantic-element-pre-text')}],
    layers: [{...layerPlan, ...binding(layerPath, layerChecksum, 1920, 1080, true, 'transparent-semantic-element')}],
    final_composite: binding(finalPath, finalChecksum, 1920, 1080, false, 'final-composite-review-raster'),
  };
  const manifestPath = relative('schema/S13-ian-layered-scene-v1.json');
  const manifestChecksum = writeJson(absolute(manifestPath), {fixture: true});
  const packageMembers = [
    {member_role: 'source-master', layer_id: 'source-master', path: sourcePath, checksum_sha256: sourceChecksum, width: 1672, height: 941, has_alpha: false},
    {member_role: 'normalized-master', layer_id: 'normalized-master', path: normalizedPath, checksum_sha256: normalizedChecksum, width: 1920, height: 1080, has_alpha: false},
    {member_role: 'background', layer_id: 'background', path: backgroundPath, checksum_sha256: backgroundChecksum, width: 1920, height: 1080, has_alpha: false},
    {member_role: 'pre-text-layer', layer_id: 'L01', path: preTextPath, checksum_sha256: preTextChecksum, width: 1920, height: 1080, has_alpha: true},
    {member_role: 'semantic-layer', layer_id: 'L01', path: layerPath, checksum_sha256: layerChecksum, width: 1920, height: 1080, has_alpha: true},
    {member_role: 'final-composite', layer_id: 'final-composite', path: finalPath, checksum_sha256: finalChecksum, width: 1920, height: 1080, has_alpha: false},
  ];

  const queue = [];
  const assets = [];
  for (let index = 1; index <= assetCount; index += 1) {
    const shotId = `S${String(index).padStart(2, '0')}`;
    const isIan = index === assetCount;
    const assetId = isIan ? `${shotId}-ian-v01` : `${shotId}-master-v01`;
    const item = {
      asset_id: assetId,
      shot_id: shotId,
      role: isIan ? 'standalone-graphic' : 'base/master',
      visual_generation_route: isIan ? 'ian-handdrawn-ppt' : 'imagegen',
      status: 'qa_passed_pending_final_review',
      path: isIan ? finalPath : ordinaryPath,
      checksum_sha256: isIan ? finalChecksum : ordinaryChecksum,
    };
    queue.push(item);
    assets.push({
      asset_id: assetId,
      path: item.path,
      checksum_sha256: item.checksum_sha256,
      qa_status: 'qa_passed_pending_final_review',
      ...(isIan ? {
        ian_layered_scene_package: {
          contract_version: 'ian-knowledge-video-layered-scene-v2',
          manifest: {path: manifestPath, checksum_sha256: manifestChecksum},
          scene_plan_sha256: ianPackage.scene_plan_sha256,
          members: packageMembers,
          package_review_sha256: 'b'.repeat(64),
        },
      } : {}),
    });
  }
  const finalReview = {
    contract_version: 'visual-asset-review-v3',
    mode: 'one_click_final_review_v1',
    storyboard_sha256: 'c'.repeat(64),
    policy_sha256: 'd'.repeat(64),
    assets,
    status: 'pending',
  };
  finalReview.presented_map_sha256 = completeReviewDigest(finalReview);
  const narrationPath = path.join(repositoryRoot, 'source-script.txt');
  const narrationBytes = Buffer.from('测试口播稿');
  const narrationChecksum = writeBytes(narrationPath, narrationBytes);
  const coverPath = path.join(repositoryRoot, 'cover.png');
  const coverBytes = await png({width: 1672, height: 940, background: {r: 210, g: 220, b: 230, alpha: 1}});
  const coverChecksum = writeBytes(coverPath, coverBytes);
  const state = {
    phase: 'awaiting_precomposition_visual_review',
    current_phase: 'awaiting_precomposition_visual_review',
    narration_script_source: {
      origin: 'script_resource', source_path: narrationPath, source_checksum_sha256: narrationChecksum,
    },
    opening_cover: {
      contract_version: 'cover-only-v1', source_path: coverPath,
      source_checksum_sha256: coverChecksum, no_added_text: true,
    },
    visual_asset_review: {
      mode: 'one_click_final_review_v1', status: 'in_progress', queue, final_review: finalReview,
    },
  };
  const statePath = path.join(root, 'schema', 'episode-state.json');
  writeJson(statePath, state);
  return {
    repositoryRoot, episodeWorkspace, root, statePath, state, finalReview, ianPackage,
    inspectIanPackage: async () => ({result: 'pass', package: structuredClone(ianPackage)}),
  };
};

const cleanup = (fixture) => {
  const resolved = fs.realpathSync(fixture.repositoryRoot);
  assert.ok(resolved.startsWith(`${fs.realpathSync(os.tmpdir())}${path.sep}`));
  fs.rmSync(resolved, {recursive: true});
};

test('builds immutable HTML, paged sheets, Ian cumulative sheet, and JSON without changing state', async () => {
  const fixture = await makeFixture();
  try {
    const stateBefore = fs.readFileSync(fixture.statePath);
    const report = await buildFinalProductionAssetReview({
      episodeWorkspace: fixture.episodeWorkspace,
      expectedPresentedMapSha256: fixture.finalReview.presented_map_sha256,
      repositoryRoot: fixture.repositoryRoot,
      createdAt: '2026-08-26T12:00:00+08:00',
      inspectIanPackage: fixture.inspectIanPackage,
    });
    assert.equal(report.status, 'created');
    assert.deepEqual(report.counts, {shot_count: 13, asset_count: 13, page_count: 2, ian_package_count: 1});
    assert.equal(report.pages.length, 2);
    assert.equal(report.ian_stage_sheets.length, 1);
    assert.deepEqual(fs.readFileSync(fixture.statePath), stateBefore);
    for (const output of [...report.pages, ...report.ian_stage_sheets]) {
      const metadata = await sharp(path.join(fixture.repositoryRoot, output.path)).metadata();
      assert.deepEqual({width: metadata.width, height: metadata.height}, {width: 1920, height: 1080});
    }
    const html = fs.readFileSync(path.join(fixture.repositoryRoot, report.html.path), 'utf8');
    assert.equal((html.match(/data-final-review-asset="1"/g) ?? []).length, 13);
    assert.equal((html.match(/data-ian-package="1"/g) ?? []).length, 1);
    assert.equal((html.match(/data-asset-id=/g) ?? []).length, 13);
    assert.match(html, /final-production-review-contract/);
    assert.match(html, /final-production-review-asset-count" content="13"/);
    assert.match(html, new RegExp(fixture.finalReview.presented_map_sha256));
    const manifest = JSON.parse(fs.readFileSync(path.join(fixture.repositoryRoot, report.manifest.path), 'utf8'));
    assert.equal(manifest.approval_effect, 'none-display-aid-only');
    assert.equal(manifest.episode_state_mutated, false);
    assert.deepEqual(
      manifest.assets.at(-1).ian_layered_scene_package.production_inputs.map((entry) => entry.member_role),
      ['background', 'semantic-layer'],
    );
  } finally {
    cleanup(fixture);
  }
});

test('renders and preserves a hash-bound failed-but-waived mechanical disposition', async () => {
  const fixture = await makeFixture({assetCount: 2});
  try {
    const state = JSON.parse(fs.readFileSync(fixture.statePath, 'utf8'));
    const queueItem = state.visual_asset_review.queue[0];
    const reviewAsset = state.visual_asset_review.final_review.assets[0];
    const overrideEvidence = {
      mechanical_qa_result: 'failed_but_waived_once',
      user_mechanical_gate_override_result: 'pass_with_user_override',
      user_mechanical_gate_override_sha256: '8'.repeat(64),
    };
    Object.assign(queueItem, {
      status: 'qa_failed_but_waived_once_pending_final_review',
      ...overrideEvidence,
    });
    Object.assign(reviewAsset, {
      qa_status: 'qa_failed_but_waived_once_pending_final_review',
      ...overrideEvidence,
    });
    state.visual_asset_review.final_review.presented_map_sha256 = completeReviewDigest(
      state.visual_asset_review.final_review,
    );
    writeJson(fixture.statePath, state);

    const report = await buildFinalProductionAssetReview({
      episodeWorkspace: fixture.episodeWorkspace,
      expectedPresentedMapSha256: state.visual_asset_review.final_review.presented_map_sha256,
      repositoryRoot: fixture.repositoryRoot,
      createdAt: '2026-08-29T16:00:00+08:00',
      inspectIanPackage: fixture.inspectIanPackage,
    });
    const html = fs.readFileSync(path.join(fixture.repositoryRoot, report.html.path), 'utf8');
    const manifest = JSON.parse(fs.readFileSync(
      path.join(fixture.repositoryRoot, report.manifest.path),
      'utf8',
    ));
    assert.match(html, /机械门禁失败已获一次性用户放行/);
    assert.match(html, new RegExp(overrideEvidence.user_mechanical_gate_override_sha256));
    assert.deepEqual(
      Object.fromEntries(Object.entries(manifest.assets[0]).filter(([key]) => key in overrideEvidence)),
      overrideEvidence,
    );
  } finally {
    cleanup(fixture);
  }
});

test('rejects a failed-but-waived final-review asset without complete override evidence', async () => {
  const fixture = await makeFixture({assetCount: 2});
  try {
    const state = JSON.parse(fs.readFileSync(fixture.statePath, 'utf8'));
    state.visual_asset_review.queue[0].status = 'qa_failed_but_waived_once_pending_final_review';
    state.visual_asset_review.final_review.assets[0].qa_status = 'qa_failed_but_waived_once_pending_final_review';
    state.visual_asset_review.final_review.presented_map_sha256 = completeReviewDigest(
      state.visual_asset_review.final_review,
    );
    writeJson(fixture.statePath, state);
    await assert.rejects(
      buildFinalProductionAssetReview({
        episodeWorkspace: fixture.episodeWorkspace,
        expectedPresentedMapSha256: state.visual_asset_review.final_review.presented_map_sha256,
        repositoryRoot: fixture.repositoryRoot,
        inspectIanPackage: fixture.inspectIanPackage,
      }),
      /mechanical override evidence is incomplete/,
    );
  } finally {
    cleanup(fixture);
  }
});

test('direct-first review excludes publishing covers from HTML and manifest', async () => {
  const fixture = await makeFixture({assetCount: 2});
  try {
    const state = JSON.parse(fs.readFileSync(fixture.statePath, 'utf8'));
    state.storyboard_timing = {direct_first_shot_contract: 'direct-first-shot-v1'};
    state.storyboard_draft = {direct_first_shot_contract: 'direct-first-shot-v1'};
    state.publishing_cover = structuredClone(state.opening_cover);
    delete state.opening_cover;
    state.visual_asset_review.queue.forEach((item) => {
      item.shot_start_frame = item.shot_id === 'S01' ? 0 : 30;
    });
    writeJson(fixture.statePath, state);

    const report = await buildFinalProductionAssetReview({
      episodeWorkspace: fixture.episodeWorkspace,
      expectedPresentedMapSha256: fixture.finalReview.presented_map_sha256,
      repositoryRoot: fixture.repositoryRoot,
      createdAt: '2026-08-29T16:00:00+08:00',
      inspectIanPackage: fixture.inspectIanPackage,
    });
    const html = fs.readFileSync(path.join(fixture.repositoryRoot, report.html.path), 'utf8');
    const manifest = JSON.parse(fs.readFileSync(
      path.join(fixture.repositoryRoot, report.manifest.path),
      'utf8',
    ));
    assert.doesNotMatch(html, /固定开场封面|cover-only-v1/);
    assert.match(html, /发布封面不进入视频生产/);
    assert.equal(Object.hasOwn(manifest, 'cover'), false);
    assert.deepEqual(manifest.timeline_opening, {
      contract_version: 'direct-first-shot-v1',
      first_shot_id: 'S01',
      start_frame: 0,
      fixed_opening_cover: false,
      publishing_cover_included: false,
    });
    assert.equal(JSON.stringify(manifest).includes('cover.png'), false);
  } finally {
    cleanup(fixture);
  }
});

test('fails closed on stale expected map before writing outputs', async () => {
  const fixture = await makeFixture({assetCount: 2});
  try {
    await assert.rejects(
      buildFinalProductionAssetReview({
        episodeWorkspace: fixture.episodeWorkspace,
        expectedPresentedMapSha256: '0'.repeat(64),
        repositoryRoot: fixture.repositoryRoot,
        inspectIanPackage: fixture.inspectIanPackage,
      }),
      FinalProductionAssetReviewError,
    );
    assert.deepEqual(fs.readdirSync(path.join(fixture.root, 'assets', 'image', 'review')), []);
  } finally {
    cleanup(fixture);
  }
});

test('fails closed when a final-review asset changes on disk', async () => {
  const fixture = await makeFixture({assetCount: 2});
  try {
    const target = path.join(fixture.repositoryRoot, fixture.finalReview.assets[0].path);
    fs.appendFileSync(target, 'changed');
    await assert.rejects(
      buildFinalProductionAssetReview({
        episodeWorkspace: fixture.episodeWorkspace,
        expectedPresentedMapSha256: fixture.finalReview.presented_map_sha256,
        repositoryRoot: fixture.repositoryRoot,
        inspectIanPackage: fixture.inspectIanPackage,
      }),
      /checksum is stale/,
    );
  } finally {
    cleanup(fixture);
  }
});

test('refuses to overwrite an existing digest-bound output', async () => {
  const fixture = await makeFixture({assetCount: 2});
  try {
    const options = {
      episodeWorkspace: fixture.episodeWorkspace,
      expectedPresentedMapSha256: fixture.finalReview.presented_map_sha256,
      repositoryRoot: fixture.repositoryRoot,
      inspectIanPackage: fixture.inspectIanPackage,
    };
    await buildFinalProductionAssetReview(options);
    await assert.rejects(buildFinalProductionAssetReview(options), /refusing to overwrite/);
  } finally {
    cleanup(fixture);
  }
});
