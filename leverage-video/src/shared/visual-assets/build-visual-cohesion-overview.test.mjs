import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

import {
  VisualCohesionContractError,
  buildFfmpegArguments,
  buildVisualCohesionOverview,
} from './build-visual-cohesion-overview.mjs';

const commandAvailable = (command) => spawnSync(command, ['-version'], {encoding: 'utf8'}).status === 0;
const hasFfmpeg = commandAvailable('ffmpeg') && commandAvailable('ffprobe');

const writeJson = (target, value) => {
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
};

const makeImage = (target, {color, size}) => {
  fs.mkdirSync(path.dirname(target), {recursive: true});
  const result = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=${color}:s=${size}:d=0.1`,
    '-frames:v', '1', '-c:v', 'png', '-pix_fmt', 'rgb24', '-y', target,
  ], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
};

const makeFixture = () => {
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-cohesion-overview-'));
  const episodeWorkspace = 'episodes/cohesion';
  const episodeRoot = path.join(repositoryRoot, episodeWorkspace);
  const relative = (name) => `${episodeWorkspace}/assets/image/production/${name}`;
  const images = {
    ianFinal: relative('s01-final.png'),
    whiteboardPreview: relative('s02-annotation-preview.png'),
    whiteboardSource: relative('s02-source.png'),
    normalAction: relative('s03-action.png'),
    normalMaster: relative('s03-master.png'),
    cover: relative('cover.png'),
  };
  makeImage(path.join(repositoryRoot, images.ianFinal), {color: 'red', size: '800x1200'});
  makeImage(path.join(repositoryRoot, images.whiteboardPreview), {color: 'blue', size: '1200x800'});
  makeImage(path.join(repositoryRoot, images.whiteboardSource), {color: 'cyan', size: '1920x1080'});
  makeImage(path.join(repositoryRoot, images.normalAction), {color: 'green', size: '900x1600'});
  makeImage(path.join(repositoryRoot, images.normalMaster), {color: 'yellow', size: '1600x900'});
  makeImage(path.join(repositoryRoot, images.cover), {color: 'white', size: '1600x900'});

  const statePath = path.join(episodeRoot, 'schema', 'episode-state.json');
  const state = {
    visual_asset_review: {
      queue: [
        {asset_id: 'OPEN-00-cover', shot_id: 'OPEN-00', role: 'cover', visual_generation_route: 'imagegen', path: images.cover},
        {
          asset_id: 'S01-master-v01',
          shot_id: 'S01',
          role: 'master',
          visual_generation_route: 'ian-handdrawn-ppt',
          path: images.ianFinal,
          ian_scene_package_members: [{member_role: 'final-composite', path: images.ianFinal}],
        },
        {
          asset_id: 'S02-whiteboard-v01',
          shot_id: 'S02',
          role: 'master',
          visual_generation_route: 'srt-whiteboard-animation',
          path: images.whiteboardSource,
          whiteboard_review: {annotation_review: {preview_path: images.whiteboardPreview}},
        },
        {
          asset_id: 'S03-action-v01',
          shot_id: 'S03',
          role: 'action-state',
          state_index: 1,
          visual_generation_route: 'imagegen',
          path: images.normalAction,
        },
        {
          asset_id: 'S03-master-v01',
          shot_id: 'S03',
          role: 'base',
          state_index: 0,
          visual_generation_route: 'imagegen',
          path: images.normalMaster,
        },
        {
          asset_id: 'S04-master-v01',
          shot_id: 'S04',
          role: 'master',
          visual_generation_route: 'xuan-paper-diorama',
          path: relative('s04-missing.png'),
        },
        {
          asset_id: 'S05-local-video',
          shot_id: 'S05',
          role: 'master',
          visual_generation_route: 'local-video-file',
          path: `${episodeWorkspace}/assets/video/s05.mp4`,
        },
        {
          asset_id: 'S06-superseded',
          shot_id: 'S06',
          role: 'base',
          status: 'superseded',
          visual_generation_route: 'imagegen',
          path: images.normalAction,
        },
        {
          asset_id: 'S07-inactive',
          shot_id: 'S07',
          role: 'base',
          active_for_current_storyboard: false,
          visual_generation_route: 'imagegen',
          path: images.normalAction,
        },
        {asset_id: 'cover', shot_id: 'cover', role: 'cover', visual_generation_route: 'imagegen', path: images.cover},
      ],
    },
  };
  writeJson(statePath, state);
  return {repositoryRoot, episodeWorkspace, episodeRoot, statePath, images};
};

const cleanup = (fixture) => {
  const resolved = fs.realpathSync(fixture.repositoryRoot);
  assert.ok(resolved.startsWith(`${fs.realpathSync(os.tmpdir())}${path.sep}`));
  fs.rmSync(resolved, {recursive: true});
};

test('uses queue shot order, one role-prioritized representative per shot, and route-specific sources', {skip: !hasFfmpeg}, () => {
  const fixture = makeFixture();
  try {
    const stateBefore = fs.readFileSync(fixture.statePath);
    const outputRelative = `${fixture.episodeWorkspace}/assets/image/review/visual-cohesion.png`;
    const report = buildVisualCohesionOverview({
      episodeWorkspace: fixture.episodeWorkspace,
      outputPath: 'visual-cohesion.png',
      repositoryRoot: fixture.repositoryRoot,
    });

    assert.equal(report.status, 'created');
    assert.equal(report.output, outputRelative);
    assert.deepEqual(
      report.ordered_representatives.map((entry) => entry.shot_id),
      ['S01', 'S02', 'S03'],
    );
    assert.equal(new Set(report.ordered_representatives.map((entry) => entry.shot_id)).size, 3);
    assert.deepEqual(
      report.ordered_representatives.map((entry) => entry.source_path),
      [fixture.images.ianFinal, fixture.images.whiteboardPreview, fixture.images.normalMaster],
    );
    assert.deepEqual(
      report.ordered_representatives.map((entry) => entry.selection),
      ['ian-final-composite', 'whiteboard-annotation-preview', 'main-still'],
    );
    assert.ok(report.warnings.some((warning) => warning.includes('S04') && warning.includes('missing')));
    assert.ok(!report.ordered_representatives.some((entry) => (
      ['OPEN-00', 'cover', 'S05', 'S06', 'S07'].includes(entry.shot_id)
    )));
    assert.deepEqual(fs.readFileSync(fixture.statePath), stateBefore);

    const output = path.join(fixture.repositoryRoot, outputRelative);
    const probe = spawnSync('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,codec_name', '-of', 'json', output,
    ], {encoding: 'utf8'});
    assert.equal(probe.status, 0, probe.stderr);
    const stream = JSON.parse(probe.stdout).streams[0];
    assert.deepEqual({width: stream.width, height: stream.height, codec: stream.codec_name}, {
      width: 1920,
      height: 1080,
      codec: 'png',
    });
  } finally {
    cleanup(fixture);
  }
});

test('ffmpeg graph uses contain plus padding and refuses implicit overwrite', () => {
  const args = buildFfmpegArguments({sources: ['/tmp/tall.png', '/tmp/wide.png'], outputPath: '/tmp/out.png'});
  const filter = args[args.indexOf('-filter_complex') + 1];
  assert.match(filter, /scale=\d+:\d+:force_original_aspect_ratio=decrease:flags=lanczos/);
  assert.match(filter, /pad=\d+:\d+:\(ow-iw\)\/2:\(oh-ih\)\/2/);
  assert.ok(args.includes('-n'));
  assert.ok(!args.includes('-y'));
});

test('missing all representatives is a safe skipped result without output', {skip: !hasFfmpeg}, () => {
  const fixture = makeFixture();
  try {
    const state = JSON.parse(fs.readFileSync(fixture.statePath, 'utf8'));
    state.visual_asset_review.queue = [
      {
        asset_id: 'S09-master-v01',
        shot_id: 'S09',
        role: 'master',
        visual_generation_route: 'ink-doodle-knowledge-card',
        path: `${fixture.episodeWorkspace}/assets/image/production/absent.png`,
      },
      {
        asset_id: 'S10-local',
        shot_id: 'S10',
        visual_generation_route: 'local-video-file',
        path: `${fixture.episodeWorkspace}/assets/video/s10.mp4`,
      },
    ];
    writeJson(fixture.statePath, state);
    const stateBefore = fs.readFileSync(fixture.statePath);
    const outputRelative = `${fixture.episodeWorkspace}/assets/image/review/empty.png`;
    const report = buildVisualCohesionOverview({
      episodeWorkspace: fixture.episodeWorkspace,
      outputPath: outputRelative,
      repositoryRoot: fixture.repositoryRoot,
    });
    assert.equal(report.status, 'skipped');
    assert.deepEqual(report.ordered_representatives, []);
    assert.equal(report.output, null);
    assert.ok(report.warnings.some((warning) => warning.includes('S09') && warning.includes('missing')));
    assert.ok(!fs.existsSync(path.join(fixture.repositoryRoot, outputRelative)));
    assert.ok(!fs.existsSync(path.join(fixture.episodeRoot, 'assets', 'image', 'review')));
    assert.deepEqual(fs.readFileSync(fixture.statePath), stateBefore);
  } finally {
    cleanup(fixture);
  }
});

test('output contract rejects paths outside review and existing files', {skip: !hasFfmpeg}, () => {
  const fixture = makeFixture();
  try {
    assert.throws(
      () => buildVisualCohesionOverview({
        episodeWorkspace: fixture.episodeWorkspace,
        outputPath: `${fixture.episodeWorkspace}/assets/image/outside.png`,
        repositoryRoot: fixture.repositoryRoot,
      }),
      VisualCohesionContractError,
    );
    assert.throws(
      () => buildVisualCohesionOverview({
        episodeWorkspace: fixture.episodeRoot,
        outputPath: 'absolute-workspace.png',
        repositoryRoot: fixture.repositoryRoot,
      }),
      /repository-root-relative/,
    );
    const existing = path.join(fixture.episodeRoot, 'assets', 'image', 'review', 'existing.png');
    fs.mkdirSync(path.dirname(existing), {recursive: true});
    fs.writeFileSync(existing, 'keep');
    assert.throws(
      () => buildVisualCohesionOverview({
        episodeWorkspace: fixture.episodeWorkspace,
        outputPath: `${fixture.episodeWorkspace}/assets/image/review/existing.png`,
        repositoryRoot: fixture.repositoryRoot,
      }),
      /refusing to overwrite/,
    );
    assert.equal(fs.readFileSync(existing, 'utf8'), 'keep');
  } finally {
    cleanup(fixture);
  }
});
