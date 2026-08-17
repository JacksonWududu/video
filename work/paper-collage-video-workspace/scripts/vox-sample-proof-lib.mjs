const nearlyEqual = (left, right, tolerance) =>
  Number.isFinite(left) && Math.abs(left - right) <= tolerance;

export const parseMediaFrameRate = (value) => {
  const [numerator, denominator] = String(value ?? '0/1').split('/').map(Number);
  return denominator ? numerator / denominator : 0;
};

export const buildVoxSampleProofReport = ({
  contract,
  project,
  storyboard,
  compiledStoryboard,
  timeline,
  media,
  runtimeBuild,
  fingerprints,
  proofSamples,
  artifacts,
  generatedAt,
}) => {
  const videoStream = media.streams?.find(({codec_type: type}) => type === 'video');
  const audioStream = media.streams?.find(({codec_type: type}) => type === 'audio');
  const frameRate = parseMediaFrameRate(
    videoStream?.avg_frame_rate ?? videoStream?.r_frame_rate,
  );
  const durationSeconds = Number(
    media.format?.duration ?? videoStream?.duration ?? 0,
  );
  const expected = contract.expected;
  const fields = project.scenes.flatMap((scene) =>
    (scene.composition?.nodes ?? []).filter(({kind}) => kind === 'motif-field')
  );
  const parallaxScenes = project.scenes.filter(
    (scene) => scene.camera?.parallax?.enabled,
  );
  const boundary = project.sceneTransitions?.[0];
  const actualBoundaryFrame = timeline.scenes?.[1]?.from ?? null;
  const proofIds = timeline.scenes.flatMap((scene) =>
    (scene.motion?.proofTimes ?? []).map(({id}) => id)
  );
  const checks = [
    {
      id: 'project-contract-v12',
      passed: project.schemaVersion === 12 && storyboard.schemaVersion === 12,
      expected: 12,
      actual: {project: project.schemaVersion, storyboard: storyboard.schemaVersion},
    },
    {
      id: 'compiled-directing-current',
      passed:
        JSON.stringify(compiledStoryboard.sceneTransitions) ===
          JSON.stringify(project.sceneTransitions) &&
        compiledStoryboard.scenes.length === project.scenes.length,
      expected: 'compiled storyboard matches project boundary and scene count',
      actual: {
        sceneCount: compiledStoryboard.scenes.length,
        boundary: compiledStoryboard.sceneTransitions?.[0] ?? null,
      },
    },
    {
      id: 'video-dimensions',
      passed:
        videoStream?.width === expected.width &&
        videoStream?.height === expected.height,
      expected: `${expected.width}x${expected.height}`,
      actual: `${videoStream?.width ?? 0}x${videoStream?.height ?? 0}`,
    },
    {
      id: 'video-frame-rate',
      passed: nearlyEqual(frameRate, expected.fps, 0.001),
      expected: expected.fps,
      actual: frameRate,
    },
    {
      id: 'video-duration',
      passed: nearlyEqual(
        durationSeconds,
        expected.durationSeconds,
        expected.durationToleranceSeconds,
      ),
      expected: `${expected.durationSeconds} ± ${expected.durationToleranceSeconds}s`,
      actual: durationSeconds,
    },
    {
      id: 'media-codecs',
      passed:
        videoStream?.codec_name === expected.videoCodec &&
        audioStream?.codec_name === expected.audioCodec,
      expected: `${expected.videoCodec}/${expected.audioCodec}`,
      actual: `${videoStream?.codec_name ?? 'missing'}/${audioStream?.codec_name ?? 'missing'}`,
    },
    {
      id: 'rhythmic-cut-boundary',
      passed:
        actualBoundaryFrame === expected.boundary.frame &&
        boundary?.treatment?.type === expected.boundary.type &&
        boundary?.treatment?.motivation === expected.boundary.motivation &&
        boundary?.treatment?.beatId === expected.boundary.beatId,
      expected: expected.boundary,
      actual: {
        frame: actualBoundaryFrame,
        type: boundary?.treatment?.type ?? null,
        motivation: boundary?.treatment?.motivation ?? null,
        beatId: boundary?.treatment?.beatId ?? null,
      },
    },
    {
      id: 'camera-parallax-coverage',
      passed: parallaxScenes.length === expected.parallaxSceneCount,
      expected: expected.parallaxSceneCount,
      actual: parallaxScenes.map(({id}) => id),
    },
    {
      id: 'motif-field-coverage',
      passed:
        fields.length === expected.motifFieldCount &&
        fields.every((field) =>
          Array.isArray(field.exclusionZones) &&
          field.exclusionZones.length > 0
        ),
      expected: `${expected.motifFieldCount} fields with exclusions`,
      actual: fields.map(({id, exclusionZones}) => ({
        id,
        exclusionZoneCount: exclusionZones?.length ?? 0,
      })),
    },
    {
      id: 'proof-times-covered',
      passed:
        expected.proofTimeIds.every((id) => proofIds.includes(id)) &&
        proofSamples.length >= expected.proofTimeIds.length + 2,
      expected: expected.proofTimeIds,
      actual: {proofIds, sampleCount: proofSamples.length},
    },
    {
      id: 'fingerprints-complete',
      passed:
        /^[a-f0-9]{64}$/.test(runtimeBuild.fingerprint) &&
        /^[a-f0-9]{64}$/.test(fingerprints.project) &&
        /^[a-f0-9]{64}$/.test(fingerprints.storyboard) &&
        /^[a-f0-9]{64}$/.test(fingerprints.preview) &&
        Object.values(fingerprints.assets).every((digest) =>
          /^[a-f0-9]{64}$/.test(digest)
        ),
      expected: 'sha256 for runtime, project, storyboard, preview, and every fixture asset',
      actual: {
        runtime: runtimeBuild.fingerprint,
        project: fingerprints.project,
        storyboard: fingerprints.storyboard,
        preview: fingerprints.preview,
        assetCount: Object.keys(fingerprints.assets).length,
      },
    },
    {
      id: 'review-direction-recorded',
      passed: contract.review.status === 'approved-direction',
      expected: 'approved-direction',
      actual: contract.review.status,
    },
  ];
  return {
    schemaVersion: 1,
    sample: contract.sample,
    status: checks.every(({passed}) => passed) ? 'passed' : 'failed',
    generatedAt,
    review: contract.review,
    media: {
      width: videoStream?.width ?? null,
      height: videoStream?.height ?? null,
      fps: frameRate,
      durationSeconds,
      videoCodec: videoStream?.codec_name ?? null,
      audioCodec: audioStream?.codec_name ?? null,
    },
    boundary: {
      frame: actualBoundaryFrame,
      seconds: actualBoundaryFrame / expected.fps,
      transition: boundary,
    },
    proofSamples,
    fingerprints: {
      runtimeBuild,
      ...fingerprints,
    },
    artifacts,
    checks,
  };
};

export const assertVoxSampleProofPassed = (report) => {
  if (report.status === 'passed') return report;
  const failures = report.checks
    .filter(({passed}) => !passed)
    .map(({id, expected, actual}) =>
      `${id}: expected ${JSON.stringify(expected)}, actual ${JSON.stringify(actual)}`
    );
  throw new Error(`VOX 样片正式证明失败：\n${failures.join('\n')}`);
};
