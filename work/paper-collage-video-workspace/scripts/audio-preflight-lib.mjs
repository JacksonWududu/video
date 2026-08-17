import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ROOT,
  deriveTimeline,
  resolvePublicFile,
  runCommand,
} from './project-lib.mjs';

const parseLoudness = (stderr) => {
  const match = stderr
    .match(/\{\s*"input_i"[\s\S]*?"target_offset"\s*:\s*"[^"]+"\s*\}/g)
    ?.at(-1);
  if (!match) {
    return {
      integratedLufs: null,
      truePeakDbtp: null,
      loudnessRangeLu: null,
      thresholdLufs: null,
      targetOffsetLu: null,
    };
  }
  const parsed = JSON.parse(match);
  const numberOrNull = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  return {
    integratedLufs: numberOrNull(parsed.input_i),
    truePeakDbtp: numberOrNull(parsed.input_tp),
    loudnessRangeLu: numberOrNull(parsed.input_lra),
    thresholdLufs: numberOrNull(parsed.input_thresh),
    targetOffsetLu: numberOrNull(parsed.target_offset),
  };
};

const clamp = (value, minimum, maximum) =>
  Math.max(minimum, Math.min(maximum, value));

export const AUDIO_DELIVERY_PROFILES = Object.freeze([
  {mode: 'preview', bitrate: '96k'},
  {mode: 'render', bitrate: '192k'},
]);

export const deliveryAudioFileForMode = (mixOutput, mode) => {
  const profile = AUDIO_DELIVERY_PROFILES.find((entry) => entry.mode === mode);
  if (!profile) throw new Error(`未知音频交付模式：${mode}`);
  const extension = path.extname(mixOutput);
  const base = extension.length > 0 ? mixOutput.slice(0, -extension.length) : mixOutput;
  return `${base}-${profile.mode}.m4a`;
};

export const collectProjectAudioEvents = (project) => {
  const timeline = deriveTimeline(project);
  const fps = project.video.fps;
  const events = [];
  if (project.audio.music) {
    events.push({
      kind: 'music',
      id: 'music',
      src: project.audio.music.src,
      startSeconds: 0,
      volume: project.audio.music.volume,
    });
  }
  for (const scene of timeline.scenes) {
    events.push({
      kind: 'narration',
      id: `narration:${scene.id}`,
      sceneId: scene.id,
      src: scene.narration.src,
      startSeconds: (scene.from + scene.narrationStartFrame) / fps,
      volume: project.audio.narration.volume,
    });
    for (const event of scene.events ?? []) {
      if (!event.sound) continue;
      events.push({
        kind: 'event',
        id: `event:${scene.id}:${event.id}`,
        sceneId: scene.id,
        src: event.sound.src,
        startSeconds:
          (scene.from + Math.min(
            scene.durationInFrames - 1,
            Math.round(event.at * scene.durationInFrames),
          )) / fps,
        volume: event.sound.volume,
      });
    }
  }
  return {timeline, events};
};

export const renderProjectAudioMix = async ({project, output}) => {
  const {timeline, events} = collectProjectAudioEvents(project);
  if (events.length === 0) throw new Error('项目没有可用于响度预检的音频事件。');
  const durationSeconds = timeline.durationSeconds;
  const args = ['-v', 'error'];
  for (const event of events) args.push('-i', resolvePublicFile(event.src));
  const filters = events.map((event, index) => {
    const delay = Math.max(0, Math.round(event.startSeconds * 1000));
    return (
      `[${index}:a]aformat=sample_rates=48000:channel_layouts=stereo,` +
      `volume=${event.volume},adelay=${delay}:all=1,` +
      `apad=pad_dur=${durationSeconds.toFixed(6)},` +
      `atrim=duration=${durationSeconds.toFixed(6)}[a${index}]`
    );
  });
  filters.push(
    `${events.map((_, index) => `[a${index}]`).join('')}amix=inputs=${events.length}:duration=longest:normalize=0,` +
      `atrim=duration=${durationSeconds.toFixed(6)},asetpts=N/SR/TB[mix]`,
  );
  args.push(
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[mix]',
    '-c:a',
    'pcm_s16le',
    '-y',
    output,
  );
  await runCommand('ffmpeg', args);
  return {output, durationSeconds, events};
};

export const analyzeAudioLoudness = async ({file, mastering}) => {
  // loudnorm's target parameters are part of its analysis configuration, not
  // the acceptance thresholds. Keep them inside FFmpeg's legal ranges while
  // assessAudioPreflight still evaluates the measured values against the
  // project's exact mastering contract (which may intentionally be stricter).
  const analysisTargetLufs = clamp(mastering.targetLufs, -70, -5);
  const analysisTruePeakDbtp = clamp(mastering.truePeakDbtp, -9, 0);
  const {stderr} = await runCommand('ffmpeg', [
    '-i',
    file,
    '-af',
    `loudnorm=I=${analysisTargetLufs}:TP=${analysisTruePeakDbtp}:LRA=11:print_format=json`,
    '-f',
    'null',
    '-',
  ]);
  return parseLoudness(stderr);
};

const masteringOutputFor = (output) => {
  const extension = path.extname(output);
  const base = extension.length > 0
    ? output.slice(0, -extension.length)
    : output;
  return `${base}-unmastered${extension || '.wav'}`;
};

export const masterAudioMix = async ({
  input,
  output,
  mastering,
  targetLufs = mastering.targetLufs,
  targetTruePeakDbtp = Math.min(mastering.truePeakDbtp - 1, -1.5),
}) => {
  const normalizedTargetLufs = clamp(targetLufs, -70, -5);
  const normalizedTruePeakDbtp = clamp(targetTruePeakDbtp, -9, 0);
  const analysis = await analyzeAudioLoudness({
    file: input,
    mastering: {
      ...mastering,
      targetLufs: normalizedTargetLufs,
      truePeakDbtp: normalizedTruePeakDbtp,
    },
  });
  if (
    !Number.isFinite(analysis.integratedLufs) ||
    !Number.isFinite(analysis.truePeakDbtp) ||
    !Number.isFinite(analysis.loudnessRangeLu) ||
    !Number.isFinite(analysis.thresholdLufs) ||
    !Number.isFinite(analysis.targetOffsetLu)
  ) {
    throw new Error('自动母带无法测量完整 loudnorm 参数。');
  }
  const filter = [
    `loudnorm=I=${normalizedTargetLufs}`,
    `TP=${normalizedTruePeakDbtp}`,
    'LRA=11',
    `measured_I=${analysis.integratedLufs}`,
    `measured_TP=${analysis.truePeakDbtp}`,
    `measured_LRA=${analysis.loudnessRangeLu}`,
    `measured_thresh=${analysis.thresholdLufs}`,
    `offset=${analysis.targetOffsetLu}`,
    'linear=true',
    'print_format=summary',
  ].join(':');
  await runCommand('ffmpeg', [
    '-v',
    'error',
    '-i',
    input,
    '-af',
    filter,
    '-ar',
    '48000',
    '-ac',
    '2',
    '-c:a',
    'pcm_s16le',
    '-y',
    output,
  ]);
  return {
    applied: true,
    method: 'two-pass-loudnorm',
    input: path.relative(ROOT, input),
    output: path.relative(ROOT, output),
    sourceLoudness: analysis,
    targetLufs: normalizedTargetLufs,
    targetTruePeakDbtp: normalizedTruePeakDbtp,
  };
};

export const assessAudioPreflight = ({project, loudness}) => {
  const mastering = project.audio.mastering;
  const loudnessDelta =
    loudness.integratedLufs === null
      ? null
      : mastering.targetLufs - loudness.integratedLufs;
  const currentNarrationVolume = project.audio.narration.volume;
  const loudnessGain = loudnessDelta === null ? 0 : loudnessDelta;
  const peakHeadroom =
    loudness.truePeakDbtp === null
      ? loudnessGain
      : mastering.truePeakDbtp - loudness.truePeakDbtp;
  const safeGainDb = loudnessGain > 0
    ? Math.min(loudnessGain, peakHeadroom)
    : loudnessGain;
  const recommendedNarrationVolume = clamp(
    currentNarrationVolume * 10 ** (safeGainDb / 20),
    0.01,
    4,
  );
  const loudnessPassed =
    loudness.integratedLufs !== null &&
    Math.abs(loudness.integratedLufs - mastering.targetLufs) <=
      mastering.toleranceLufs;
  const truePeakPassed =
    loudness.truePeakDbtp !== null &&
    loudness.truePeakDbtp <= mastering.truePeakDbtp;
  return {
    passed: loudnessPassed && truePeakPassed,
    mastering,
    loudness,
    loudnessPassed,
    truePeakPassed,
    currentNarrationVolume,
    recommendedNarrationVolume,
    recommendationIsApproximate: true,
  };
};

export const encodeAudioDeliveryProbe = async ({
  input,
  output,
  bitrate,
}) => {
  await runCommand('ffmpeg', [
    '-v',
    'error',
    '-i',
    input,
    '-vn',
    '-c:a',
    'aac',
    '-b:a',
    bitrate,
    '-ar',
    '48000',
    '-ac',
    '2',
    '-movflags',
    '+faststart',
    '-y',
    output,
  ]);
  return output;
};

export const muxAuthoritativeAudio = async ({
  video,
  audio,
  output,
}) => {
  await runCommand('ffmpeg', [
    '-v',
    'error',
    '-i',
    video,
    '-i',
    audio,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-c:v',
    'copy',
    '-c:a',
    'copy',
    '-shortest',
    '-movflags',
    '+faststart',
    '-y',
    output,
  ]);
  return output;
};

export const runAudioPreflight = async ({project, output}) => {
  const rawOutput = masteringOutputFor(output);
  const mixed = await renderProjectAudioMix({project, output: rawOutput});
  await fs.copyFile(rawOutput, output);

  const inspectDelivery = async () => {
    const probes = [];
    for (const profile of AUDIO_DELIVERY_PROFILES) {
      const probeFile = deliveryAudioFileForMode(output, profile.mode);
      await encodeAudioDeliveryProbe({
        input: output,
        output: probeFile,
        bitrate: profile.bitrate,
      });
      const loudness = await analyzeAudioLoudness({
        file: probeFile,
        mastering: project.audio.mastering,
      });
      probes.push({
        mode: profile.mode,
        bitrate: profile.bitrate,
        file: path.relative(ROOT, probeFile),
        ...assessAudioPreflight({project, loudness}),
      });
    }
    const limitingProbe =
      probes.find((probe) => !probe.passed) ??
      probes.find((probe) => probe.mode === 'render') ??
      probes[0];
    return {
      probes,
      limitingProbe,
      passed: probes.every((probe) => probe.passed),
    };
  };

  let delivery = await inspectDelivery();
  let masteringProcessing = {
    applied: false,
    method: 'none',
    input: path.relative(ROOT, rawOutput),
    output: path.relative(ROOT, output),
    attempts: [],
  };
  let targetLufs = project.audio.mastering.targetLufs;
  let targetTruePeakDbtp = Math.min(
    project.audio.mastering.truePeakDbtp - 1,
    -1.5,
  );
  for (let attempt = 1; !delivery.passed && attempt <= 3; attempt += 1) {
    const applied = await masterAudioMix({
      input: rawOutput,
      output,
      mastering: project.audio.mastering,
      targetLufs,
      targetTruePeakDbtp,
    });
    delivery = await inspectDelivery();
    masteringProcessing = {
      ...applied,
      attempts: [
        ...(masteringProcessing.attempts ?? []),
        {
          attempt,
          targetLufs: applied.targetLufs,
          targetTruePeakDbtp: applied.targetTruePeakDbtp,
          probes: delivery.probes.map(
            ({mode, passed, loudness}) => ({mode, passed, loudness}),
          ),
        },
      ],
    };
    if (!delivery.passed) {
      const measuredLufs = delivery.limitingProbe.loudness.integratedLufs;
      const measuredPeak = delivery.limitingProbe.loudness.truePeakDbtp;
      if (Number.isFinite(measuredLufs)) {
        targetLufs +=
          project.audio.mastering.targetLufs - measuredLufs;
      }
      if (
        Number.isFinite(measuredPeak) &&
        measuredPeak > project.audio.mastering.truePeakDbtp
      ) {
        targetTruePeakDbtp -=
          measuredPeak - project.audio.mastering.truePeakDbtp + 0.5;
      }
    }
  }
  return {
    ...delivery.limitingProbe,
    passed: delivery.passed,
    deliveryEquivalent: true,
    analysisSurface: 'delivery-encoded-aac',
    probes: delivery.probes,
    masteringProcessing,
    mix: {
      file: path.relative(ROOT, output),
      unmasteredFile: path.relative(ROOT, rawOutput),
      durationSeconds: mixed.durationSeconds,
      eventCount: mixed.events.length,
      events: mixed.events,
    },
  };
};
