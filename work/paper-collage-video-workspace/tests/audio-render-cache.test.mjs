import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {
  analyzeAudioLoudness,
  assessAudioPreflight,
  collectProjectAudioEvents,
  deliveryAudioFileForMode,
  muxAuthoritativeAudio,
  runAudioPreflight,
} from '../scripts/audio-preflight-lib.mjs';
import {
  createAudioCalibrationSourceFingerprint,
  validateAudioCalibration,
} from '../scripts/audio-calibration-lib.mjs';
import {createRenderFingerprints} from '../scripts/render-cache-lib.mjs';
import {withCompiledEditorialFixture} from '../fixtures/editorial-fixture.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const makeProject = (slug) => withCompiledEditorialFixture({
  slug,
  title: 'Cache Test',
  styleProfile: {
    id: 'hand-drawn-cutout-explainer',
    profileFingerprint: 'a'.repeat(64),
  },
  video: {width: 1920, height: 1080, fps: 30},
  theme: {
    canvas: '#000',
    sceneBackground: '#000',
    accent: '#fff',
    ink: '#fff',
    subtitle: '#fff',
    subtitleBackground: '#000',
    foreground: '#fff',
    surface: {
      texture: {
        src: `projects/${slug}/texture.png`,
        opacity: 0.14,
        blendMode: 'multiply',
      },
      subjectEdge: {mode: 'paper-outline', color: '#fff', widthPx: 3},
      subjectShadow: {
        mode: 'drop-shadow',
        offsetXPx: 0,
        offsetYPx: 10,
        blurPx: 7,
        color: 'rgba(20,15,12,.28)',
      },
    },
  },
  audio: {
    narration: {volume: 1},
    music: null,
    mastering: {targetLufs: -16, toleranceLufs: 3, truePeakDbtp: -1},
  },
  scenes: [{
    id: 'scene-01',
    label: 'Scene',
    eyebrow: '',
    tailSeconds: 0.2,
    motion: {blueprint: 'layered-reveal', intensity: 1, seed: 1, proofTimes: []},
    camera: {preset: 'push', intensity: 1},
    narration: {
      src: `projects/${slug}/narration.wav`,
      startSeconds: 0.1,
      durationSeconds: 1,
      text: 'test',
    },
    subtitles: [{fromSeconds: 0.1, toSeconds: 0.9, text: 'test'}],
    events: [],
    composition: {
      coordinateSpace: {width: 1920, height: 1080},
      nodes: [{
        id: 'background',
        kind: 'asset',
        assetRole: 'background',
        src: `projects/${slug}/visual.png`,
        z: 0,
        transform: {x: 0, y: 0, width: 1, height: 1, anchorX: 0, anchorY: 0},
        motion: {keyframes: [{at: 0, scale: 1}, {at: 1, scale: 1.01}]},
      }],
    },
  }],
  sceneTransitions: [],
});

test('render fingerprints separate visual changes from audio-only changes', async () => {
  const slug = `render-cache-test-${process.pid}`;
  const directory = path.join(ROOT, 'public', 'projects', slug);
  try {
    await fs.mkdir(directory, {recursive: true});
    await sharp({create: {width: 64, height: 64, channels: 4, background: '#884422'}})
      .png()
      .toFile(path.join(directory, 'visual.png'));
    await sharp({create: {width: 32, height: 32, channels: 4, background: '#ffffff'}})
      .png()
      .toFile(path.join(directory, 'texture.png'));
    const audio = spawnSync('ffmpeg', [
      '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
      '-t', '1', '-y', path.join(directory, 'narration.wav'),
    ], {encoding: 'utf8'});
    assert.equal(audio.status, 0, audio.stderr);

    const project = makeProject(slug);
    const original = await createRenderFingerprints(project, 'preview');
    const audioOnly = structuredClone(project);
    audioOnly.audio.narration.volume = 1.5;
    const changedAudio = await createRenderFingerprints(audioOnly, 'preview');
    assert.equal(changedAudio.visual, original.visual);
    assert.notEqual(changedAudio.audio, original.audio);
    assert.equal(
      await createAudioCalibrationSourceFingerprint(audioOnly),
      await createAudioCalibrationSourceFingerprint(project),
    );

    const visualOnly = structuredClone(project);
    visualOnly.scenes[0].camera.intensity = 1.5;
    const changedVisual = await createRenderFingerprints(visualOnly, 'preview');
    assert.notEqual(changedVisual.visual, original.visual);
    assert.equal(changedVisual.audio, original.audio);
    const changedStyleProfile = structuredClone(project);
    changedStyleProfile.styleProfile.profileFingerprint = 'b'.repeat(64);
    changedStyleProfile.styleProfile.id = 'archival-collage';
    const changedStyle = await createRenderFingerprints(
      changedStyleProfile,
      'preview',
    );
    assert.notEqual(changedStyle.visual, original.visual);
    assert.equal(changedStyle.audio, original.audio);
    const retimed = structuredClone(project);
    retimed.scenes[0].narration.startSeconds = 0.2;
    assert.notEqual(
      await createAudioCalibrationSourceFingerprint(retimed),
      await createAudioCalibrationSourceFingerprint(project),
    );

    const {events, timeline} = collectProjectAudioEvents(project);
    assert.equal(events.length, 1);
    assert.equal(events[0].startSeconds, 0.1);
    assert.equal(timeline.durationSeconds, 1.3);

    const strictPeakAnalysis = await analyzeAudioLoudness({
      file: path.join(directory, 'narration.wav'),
      mastering: {targetLufs: -24, toleranceLufs: 3, truePeakDbtp: -18},
    });
    assert.notEqual(strictPeakAnalysis.integratedLufs, null);
    assert.notEqual(strictPeakAnalysis.truePeakDbtp, null);

    const mixFile = path.join(directory, 'audio-preflight.wav');
    const preflight = await runAudioPreflight({project, output: mixFile});
    assert.equal(preflight.analysisSurface, 'delivery-encoded-aac');
    assert.equal(preflight.deliveryEquivalent, true);
    assert.equal(preflight.passed, true);
    assert.equal(typeof preflight.masteringProcessing.applied, 'boolean');
    if (preflight.masteringProcessing.applied) {
      assert.equal(
        preflight.masteringProcessing.method,
        'two-pass-loudnorm',
      );
      assert.ok(preflight.masteringProcessing.attempts.length >= 1);
    }
    assert.deepEqual(
      preflight.probes.map(({mode, bitrate}) => ({mode, bitrate})),
      [
        {mode: 'preview', bitrate: '96k'},
        {mode: 'render', bitrate: '192k'},
      ],
    );
    assert.equal(preflight.probes.every(({passed}) => passed), true);
    const quietProject = structuredClone(project);
    quietProject.audio.narration.volume = 0.02;
    const quietMixFile = path.join(directory, 'audio-preflight-quiet.wav');
    const automaticallyMastered = await runAudioPreflight({
      project: quietProject,
      output: quietMixFile,
    });
    assert.equal(automaticallyMastered.passed, true);
    assert.equal(automaticallyMastered.masteringProcessing.applied, true);
    assert.equal(
      automaticallyMastered.masteringProcessing.method,
      'two-pass-loudnorm',
    );
    assert.ok(automaticallyMastered.masteringProcessing.attempts.length >= 1);
    assert.equal(
      automaticallyMastered.probes.every(({passed}) => passed),
      true,
    );
    const silentVideo = path.join(directory, 'silent.mp4');
    const video = spawnSync('ffmpeg', [
      '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=30',
      '-t', '1.3', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-y', silentVideo,
    ], {encoding: 'utf8'});
    assert.equal(video.status, 0, video.stderr);
    const artifact = path.join(directory, 'artifact.mp4');
    const previewAudio = deliveryAudioFileForMode(mixFile, 'preview');
    await muxAuthoritativeAudio({
      video: silentVideo,
      audio: previewAudio,
      output: artifact,
    });
    const artifactLoudness = await analyzeAudioLoudness({
      file: artifact,
      mastering: project.audio.mastering,
    });
    const previewProbe = preflight.probes.find(({mode}) => mode === 'preview');
    assert.equal(
      artifactLoudness.integratedLufs,
      previewProbe.loudness.integratedLufs,
    );
    assert.equal(
      artifactLoudness.truePeakDbtp,
      previewProbe.loudness.truePeakDbtp,
    );
  } finally {
    await fs.rm(directory, {recursive: true, force: true});
  }
});

test('delivery-encoded audio preflight keeps bounded gain recommendations', () => {
  const project = makeProject('audio-assessment');
  const low = assessAudioPreflight({
    project,
    loudness: {integratedLufs: -22, truePeakDbtp: -8, loudnessRangeLu: 4},
  });
  assert.equal(low.passed, false);
  assert.ok(low.recommendedNarrationVolume > 1);
  assert.ok(low.recommendedNarrationVolume <= 4);
  assert.equal(low.recommendationIsApproximate, true);

  const passing = assessAudioPreflight({
    project,
    loudness: {integratedLufs: -16.2, truePeakDbtp: -2, loudnessRangeLu: 4},
  });
  assert.equal(passing.passed, true);
});

test('technical audio mastering record never encodes a human approval state', () => {
  const calibration = {
    schemaVersion: 2,
    projectSlug: 'audio-assessment',
    status: 'ready',
    sourceFingerprint: 'a'.repeat(64),
    currentNarrationVolume: 1,
    recommendedNarrationVolume: 2,
    processingNote: 'Automatically mastered to the delivery contract.',
  };
  assert.equal(
    validateAudioCalibration(calibration, 'audio-assessment'),
    calibration,
  );
  assert.throws(
    () => validateAudioCalibration({...calibration, processingNote: ''}, 'audio-assessment'),
    /processingNote/,
  );
  assert.throws(
    () => validateAudioCalibration({...calibration, status: 'accepted'}, 'audio-assessment'),
    /ready 或 failed/,
  );
});
