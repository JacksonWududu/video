import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);

export const TIMING_CONTINUITY_THRESHOLDS = Object.freeze({
  regularTailMaxSeconds: 1.2,
  finalTailMaxSeconds: 1.8,
  intentionalHoldMaxSeconds: 2.5,
  intentionalHoldJoinToleranceSeconds: 0.1,
  explicitDurationToleranceSeconds: 0.5,
  explicitDurationToleranceRatio: 0.02,
  deadAirWarningSeconds: 0.8,
  deadAirErrorSeconds: 1.2,
  deadAirMaxRatio: 0.08,
  silenceNoiseDb: -45,
  silenceMinimumSeconds: 0.3,
  motionSampleFps: 5,
  motionSampleWidth: 160,
  motionSampleHeight: 90,
  motionMeanDifferenceThreshold: 0.65,
  lowMotionMinimumSeconds: 0.6,
  lowMotionMergeGapSeconds: 0.25,
});

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const roundTime = (value) => Number(Math.max(0, value).toFixed(6));

export const rangeDuration = (range) =>
  Math.max(0, Number(range?.endSeconds ?? 0) - Number(range?.startSeconds ?? 0));

export const mergeTimeRanges = (
  ranges,
  {maximumGapSeconds = 0, minimumDurationSeconds = 0} = {},
) => {
  const sorted = (ranges ?? [])
    .filter(
      (range) =>
        finite(range?.startSeconds) &&
        finite(range?.endSeconds) &&
        range.endSeconds > range.startSeconds,
    )
    .map((range) => ({
      startSeconds: roundTime(range.startSeconds),
      endSeconds: roundTime(range.endSeconds),
    }))
    .sort((left, right) => left.startSeconds - right.startSeconds);
  const merged = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (
      previous &&
      range.startSeconds <= previous.endSeconds + maximumGapSeconds + 1e-6
    ) {
      previous.endSeconds = roundTime(
        Math.max(previous.endSeconds, range.endSeconds),
      );
    } else {
      merged.push({...range});
    }
  }
  return merged
    .filter((range) => rangeDuration(range) + 1e-6 >= minimumDurationSeconds)
    .map((range) => ({...range, durationSeconds: roundTime(rangeDuration(range))}));
};

export const intersectTimeRanges = (leftRanges, rightRanges) => {
  const left = mergeTimeRanges(leftRanges);
  const right = mergeTimeRanges(rightRanges);
  const intersections = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftRange = left[leftIndex];
    const rightRange = right[rightIndex];
    const startSeconds = Math.max(
      leftRange.startSeconds,
      rightRange.startSeconds,
    );
    const endSeconds = Math.min(leftRange.endSeconds, rightRange.endSeconds);
    if (endSeconds > startSeconds) intersections.push({startSeconds, endSeconds});
    if (leftRange.endSeconds <= rightRange.endSeconds) leftIndex += 1;
    else rightIndex += 1;
  }
  return mergeTimeRanges(intersections);
};

export const subtractTimeRanges = (sourceRanges, excludedRanges) => {
  const excluded = mergeTimeRanges(excludedRanges);
  const output = [];
  for (const source of mergeTimeRanges(sourceRanges)) {
    let fragments = [source];
    for (const exclusion of excluded) {
      fragments = fragments.flatMap((fragment) => {
        if (
          exclusion.endSeconds <= fragment.startSeconds ||
          exclusion.startSeconds >= fragment.endSeconds
        ) {
          return [fragment];
        }
        const next = [];
        if (exclusion.startSeconds > fragment.startSeconds) {
          next.push({
            startSeconds: fragment.startSeconds,
            endSeconds: exclusion.startSeconds,
          });
        }
        if (exclusion.endSeconds < fragment.endSeconds) {
          next.push({
            startSeconds: exclusion.endSeconds,
            endSeconds: fragment.endSeconds,
          });
        }
        return next;
      });
    }
    output.push(...fragments);
  }
  return mergeTimeRanges(output);
};

export const parseSilenceDetect = (stderr, durationSeconds) => {
  const ranges = [];
  let silenceStart = null;
  for (const line of String(stderr ?? '').split(/\r?\n/)) {
    const start = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (start) {
      silenceStart = Math.max(0, Number(start[1]));
      continue;
    }
    const end = line.match(/silence_end:\s*(-?[\d.]+)/);
    if (end) {
      const endSeconds = Math.min(durationSeconds, Math.max(0, Number(end[1])));
      if (silenceStart !== null && endSeconds > silenceStart) {
        ranges.push({startSeconds: silenceStart, endSeconds});
      }
      silenceStart = null;
    }
  }
  if (silenceStart !== null && durationSeconds > silenceStart) {
    ranges.push({startSeconds: silenceStart, endSeconds: durationSeconds});
  }
  return mergeTimeRanges(ranges);
};

export const analyzeLowMotionFrames = ({
  buffer,
  durationSeconds,
  width = TIMING_CONTINUITY_THRESHOLDS.motionSampleWidth,
  height = TIMING_CONTINUITY_THRESHOLDS.motionSampleHeight,
  fps = TIMING_CONTINUITY_THRESHOLDS.motionSampleFps,
  differenceThreshold =
    TIMING_CONTINUITY_THRESHOLDS.motionMeanDifferenceThreshold,
  minimumDurationSeconds =
    TIMING_CONTINUITY_THRESHOLDS.lowMotionMinimumSeconds,
  mergeGapSeconds = TIMING_CONTINUITY_THRESHOLDS.lowMotionMergeGapSeconds,
}) => {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? []);
  const frameSize = width * height;
  const frameCount = Math.floor(bytes.length / frameSize);
  if (frameCount <= 1) {
    const ranges =
      durationSeconds > 0
        ? [{startSeconds: 0, endSeconds: durationSeconds}]
        : [];
    return {
      ranges: mergeTimeRanges(ranges),
      frameCount,
      meanDifference: 0,
      maximumDifference: 0,
    };
  }

  const lowIntervals = [];
  let differenceTotal = 0;
  let maximumDifference = 0;
  for (let frameIndex = 1; frameIndex < frameCount; frameIndex += 1) {
    const previousOffset = (frameIndex - 1) * frameSize;
    const currentOffset = frameIndex * frameSize;
    let absoluteDifference = 0;
    for (let pixel = 0; pixel < frameSize; pixel += 1) {
      absoluteDifference += Math.abs(
        bytes[previousOffset + pixel] - bytes[currentOffset + pixel],
      );
    }
    const meanDifference = absoluteDifference / frameSize;
    differenceTotal += meanDifference;
    maximumDifference = Math.max(maximumDifference, meanDifference);
    if (meanDifference <= differenceThreshold) {
      lowIntervals.push({
        startSeconds: (frameIndex - 1) / fps,
        endSeconds: Math.min(durationSeconds, frameIndex / fps),
      });
    }
  }
  const lastSampleSeconds = (frameCount - 1) / fps;
  if (
    lowIntervals.at(-1) &&
    lowIntervals.at(-1).endSeconds >= lastSampleSeconds - 1e-6
  ) {
    lowIntervals.at(-1).endSeconds = durationSeconds;
  }
  return {
    ranges: mergeTimeRanges(lowIntervals, {
      maximumGapSeconds: mergeGapSeconds,
      minimumDurationSeconds,
    }),
    frameCount,
    meanDifference: Number(
      (differenceTotal / Math.max(1, frameCount - 1)).toFixed(6),
    ),
    maximumDifference: Number(maximumDifference.toFixed(6)),
  };
};

const eventLocalRange = (scene, event, fps) => {
  const sceneDurationSeconds = scene.durationInFrames / fps;
  const startSeconds = Math.min(
    sceneDurationSeconds,
    Math.max(0, event.at * sceneDurationSeconds),
  );
  return {
    startSeconds,
    endSeconds: Math.min(
      sceneDurationSeconds,
      startSeconds + event.visual.durationSeconds,
    ),
  };
};

const isBoundedHold = (scene, event, fps, thresholds) => {
  if (
    event.visual?.kind !== 'hold' ||
    event.targetId !== 'scene' ||
    !event.proofTimeId ||
    !finite(event.visual.durationSeconds) ||
    event.visual.durationSeconds > thresholds.intentionalHoldMaxSeconds
  ) {
    return false;
  }
  const proof = scene.motion?.proofTimes?.find(({id}) => id === event.proofTimeId);
  if (!proof) return false;
  const range = eventLocalRange(scene, event, fps);
  const proofSeconds = proof.at * (scene.durationInFrames / fps);
  return (
    proofSeconds >= range.startSeconds - 0.01 &&
    proofSeconds <= range.endSeconds + 0.01
  );
};

export const deriveIntentionalHoldRanges = ({
  timeline,
  fps,
  thresholds = TIMING_CONTINUITY_THRESHOLDS,
}) =>
  mergeTimeRanges(
    (timeline?.scenes ?? []).flatMap((scene) =>
      (scene.events ?? [])
        .filter((event) => isBoundedHold(scene, event, fps, thresholds))
        .map((event) => {
          const local = eventLocalRange(scene, event, fps);
          return {
            startSeconds: scene.from / fps + local.startSeconds,
            endSeconds: scene.from / fps + local.endSeconds,
          };
        }),
    ),
  );

const allowedTailSeconds = ({scene, isFinal, fps, thresholds}) => {
  const base = isFinal
    ? thresholds.finalTailMaxSeconds
    : thresholds.regularTailMaxSeconds;
  const narrationEnd =
    Number(scene.narration?.startSeconds ?? 0) +
    Number(scene.narration?.durationSeconds ?? 0);
  let authorizedTail = base;
  for (const event of scene.events ?? []) {
    if (!isBoundedHold(scene, event, fps, thresholds)) continue;
    const range = eventLocalRange(scene, event, fps);
    if (
      range.startSeconds >
      narrationEnd + thresholds.intentionalHoldJoinToleranceSeconds
    ) {
      continue;
    }
    authorizedTail = Math.max(
      authorizedTail,
      range.endSeconds - narrationEnd,
    );
  }
  return roundTime(authorizedTail);
};

export const reconcileInferredTails = (
  project,
  thresholds = TIMING_CONTINUITY_THRESHOLDS,
) => {
  if (project?.plan?.requested?.durationSeconds != null) return [];
  const fps = Number(project.video?.fps ?? 30);
  const scenes = project.scenes ?? [];
  const changes = [];
  for (const [index, scene] of scenes.entries()) {
    const maximum = allowedTailSeconds({
      scene: {
        ...scene,
        durationInFrames: Math.ceil(
          (Number(scene.narration?.startSeconds ?? 0) +
            Number(scene.narration?.durationSeconds ?? 0) +
            Number(scene.tailSeconds ?? 0)) *
            fps,
        ),
      },
      isFinal: index === scenes.length - 1,
      fps,
      thresholds,
    });
    if (Number(scene.tailSeconds ?? 0) <= maximum + 1e-6) continue;
    changes.push({
      sceneId: scene.id,
      beforeSeconds: scene.tailSeconds,
      afterSeconds: maximum,
    });
    scene.tailSeconds = maximum;
  }
  return changes;
};

export const assessTimelineContinuity = (
  project,
  timeline,
  thresholds = TIMING_CONTINUITY_THRESHOLDS,
) => {
  const issues = [];
  const fps = Number(project.video?.fps ?? 30);
  const scenes = timeline?.scenes ?? [];
  for (const [index, scene] of scenes.entries()) {
    const location = `scenes[${index}]`;
    const maximum = allowedTailSeconds({
      scene,
      isFinal: index === scenes.length - 1,
      fps,
      thresholds,
    });
    if (scene.tailSeconds > maximum + 1e-6) {
      issues.push({
        level: 'error',
        code: 'scene-tail-budget',
        message: `tailSeconds 为 ${scene.tailSeconds}s，超过本幕 ${maximum}s 的技术收尾预算；请增加真实叙事内容、缩短时长，或用绑定 proof 的 hold 显式声明有意停顿。`,
        location: `${location}.tailSeconds`,
      });
    }
    for (const [eventIndex, event] of (scene.events ?? []).entries()) {
      if (event.visual?.kind !== 'hold') continue;
      const eventLocation = `${location}.events[${eventIndex}]`;
      if (event.targetId !== 'scene') {
        issues.push({
          level: 'error',
          code: 'scene-hold-target',
          message: 'hold 必须以 scene 为目标，不能伪装成局部动画。',
          location: `${eventLocation}.targetId`,
        });
      }
      if (!event.proofTimeId) {
        issues.push({
          level: 'error',
          code: 'scene-hold-proof-required',
          message: '有意停顿必须绑定 proofTimeId，明确观众需要观察的画面。',
          location: `${eventLocation}.proofTimeId`,
        });
      }
      if (event.visual.durationSeconds > thresholds.intentionalHoldMaxSeconds) {
        issues.push({
          level: 'error',
          code: 'scene-hold-duration',
          message: `有意停顿最长 ${thresholds.intentionalHoldMaxSeconds}s，当前为 ${event.visual.durationSeconds}s。`,
          location: `${eventLocation}.visual.durationSeconds`,
        });
      }
    }
  }
  return issues;
};

export const mapRangesToScenes = ({ranges, timeline, fps}) =>
  (ranges ?? []).flatMap((range) =>
    (timeline?.scenes ?? []).flatMap((scene) => {
      const sceneStart = scene.from / fps;
      const sceneEnd = (scene.from + scene.durationInFrames) / fps;
      const startSeconds = Math.max(sceneStart, range.startSeconds);
      const endSeconds = Math.min(sceneEnd, range.endSeconds);
      if (endSeconds <= startSeconds) return [];
      return [
        {
          sceneId: scene.id,
          startSeconds: roundTime(startSeconds),
          endSeconds: roundTime(endSeconds),
          durationSeconds: roundTime(endSeconds - startSeconds),
        },
      ];
    }),
  );

export const assessRenderedContinuity = ({
  silentRanges,
  lowMotionRanges,
  approvedHoldRanges,
  timeline,
  fps,
  durationSeconds,
  thresholds = TIMING_CONTINUITY_THRESHOLDS,
}) => {
  const unapprovedRanges = subtractTimeRanges(
    intersectTimeRanges(silentRanges, lowMotionRanges),
    approvedHoldRanges,
  );
  const warningRanges = unapprovedRanges.filter(
    (range) => range.durationSeconds >= thresholds.deadAirWarningSeconds,
  );
  const failingRanges = unapprovedRanges.filter(
    (range) => range.durationSeconds >= thresholds.deadAirErrorSeconds,
  );
  const totalDeadAirSeconds = roundTime(
    unapprovedRanges.reduce((total, range) => total + range.durationSeconds, 0),
  );
  const deadAirRatio =
    durationSeconds > 0
      ? Number((totalDeadAirSeconds / durationSeconds).toFixed(6))
      : 0;
  return {
    silentRanges: mergeTimeRanges(silentRanges),
    lowMotionRanges: mergeTimeRanges(lowMotionRanges),
    approvedHoldRanges: mergeTimeRanges(approvedHoldRanges),
    deadAirRanges: unapprovedRanges,
    warningRanges,
    failingRanges,
    perScene: mapRangesToScenes({
      ranges: unapprovedRanges,
      timeline,
      fps,
    }),
    totalDeadAirSeconds,
    deadAirRatio,
    passed:
      failingRanges.length === 0 &&
      deadAirRatio <= thresholds.deadAirMaxRatio,
  };
};

export const analyzeRenderedContinuityArtifact = async ({
  artifact,
  durationSeconds,
  hasAudio,
  timeline,
  fps,
  thresholds = TIMING_CONTINUITY_THRESHOLDS,
}) => {
  const silentRanges = hasAudio
    ? parseSilenceDetect(
        (
          await execFileAsync(
            'ffmpeg',
            [
              '-hide_banner',
              '-i',
              artifact,
              '-map',
              '0:a:0',
              '-af',
              `silencedetect=noise=${thresholds.silenceNoiseDb}dB:d=${thresholds.silenceMinimumSeconds}`,
              '-f',
              'null',
              '-',
            ],
            {maxBuffer: 16 * 1024 * 1024},
          )
        ).stderr,
        durationSeconds,
      )
    : [{startSeconds: 0, endSeconds: durationSeconds}];
  const video = await execFileAsync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      artifact,
      '-an',
      '-vf',
      `fps=${thresholds.motionSampleFps},scale=${thresholds.motionSampleWidth}:${thresholds.motionSampleHeight}:force_original_aspect_ratio=decrease,pad=${thresholds.motionSampleWidth}:${thresholds.motionSampleHeight}:(ow-iw)/2:(oh-ih)/2,format=gray`,
      '-pix_fmt',
      'gray',
      '-f',
      'rawvideo',
      'pipe:1',
    ],
    {encoding: 'buffer', maxBuffer: 96 * 1024 * 1024},
  );
  const lowMotion = analyzeLowMotionFrames({
    buffer: video.stdout,
    durationSeconds,
    width: thresholds.motionSampleWidth,
    height: thresholds.motionSampleHeight,
    fps: thresholds.motionSampleFps,
    differenceThreshold: thresholds.motionMeanDifferenceThreshold,
    minimumDurationSeconds: thresholds.lowMotionMinimumSeconds,
    mergeGapSeconds: thresholds.lowMotionMergeGapSeconds,
  });
  const approvedHoldRanges = deriveIntentionalHoldRanges({
    timeline,
    fps,
    thresholds,
  });
  return {
    ...assessRenderedContinuity({
      silentRanges,
      lowMotionRanges: lowMotion.ranges,
      approvedHoldRanges,
      timeline,
      fps,
      durationSeconds,
      thresholds,
    }),
    sampling: {
      fps: thresholds.motionSampleFps,
      width: thresholds.motionSampleWidth,
      height: thresholds.motionSampleHeight,
      frameCount: lowMotion.frameCount,
      meanDifference: lowMotion.meanDifference,
      maximumDifference: lowMotion.maximumDifference,
      differenceThreshold: thresholds.motionMeanDifferenceThreshold,
    },
    thresholds,
  };
};
