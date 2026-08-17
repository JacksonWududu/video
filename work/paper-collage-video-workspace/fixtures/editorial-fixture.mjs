const digest = '1c14b9f9cc430154dd3a74fc5267a83233f2e04e492444376c27dd956134177f';

export const createEditorialFixture = ({
  sceneIds,
  fps = 30,
  activeProfile = '16:9',
  mediaId = 'fixture-audio',
  mediaSrc = 'fixtures/vox-primitives/tone.wav',
  mediaSha256 = digest,
  mediaDurationSeconds = 1,
  timingDataSrc = 'fixtures/vox-primitives/timing.json',
} = {}) => {
  const ids = sceneIds ?? ['scene-1'];
  const cues = ids.map((sceneId, index) => ({
    id: `${sceneId}-fixture-cue`,
    kind: 'narration-phrase',
    source: 'authored',
    timingBasis: 'actual-audio',
    mediaId,
    sceneId,
    atSeconds: Math.min(mediaDurationSeconds - 0.01, 0.08 + index * 0.01),
    priority: 50,
    toleranceSeconds: 0.04,
  }));
  return {
    timebase: {fps, rounding: 'nearest'},
    wordTimingPolicy: 'phrase-fallback',
    media: [{
      id: mediaId,
      kind: 'narration',
      src: mediaSrc,
      sha256: mediaSha256,
      durationSeconds: mediaDurationSeconds,
      timelineMode: 'scene-local',
      timingDataSrc,
    }],
    cues,
    editPoints: cues.map((cue) => ({
      id: `${cue.sceneId}-fixture-point`,
      cueIds: [cue.id],
      conflictPolicy: 'highest-priority',
    })),
    bindings: [],
    responsiveProfiles: [
      {id: '16:9', width: 1920, height: 1080, safeArea: {x: 0.06, y: 0.06, width: 0.88, height: 0.88}, densityBudget: 12, typographyScale: 1, parallaxScale: 1, exclusionZones: []},
      {id: '9:16', width: 1080, height: 1920, safeArea: {x: 0.08, y: 0.05, width: 0.84, height: 0.9}, densityBudget: 10, typographyScale: 0.9, parallaxScale: 0.75, exclusionZones: []},
      {id: '1:1', width: 1080, height: 1080, safeArea: {x: 0.07, y: 0.07, width: 0.86, height: 0.86}, densityBudget: 11, typographyScale: 0.95, parallaxScale: 0.85, exclusionZones: []},
    ],
    sceneDirecting: ids.map((sceneId) => ({
      sceneId,
      compositionProfile: 'fixture',
      typographyProfile: 'fixture',
      subjectFraming: {mode: 'contain', focusPoint: {x: 0.5, y: 0.5}},
      placements: [],
    })),
    transitions: [],
    activeProfile,
  };
};

export const compileEditorialFixture = ({
  scenes = [],
  sceneTransitions = [],
  fps = 30,
  ...options
} = {}) => compileEditorialSystem({
  editorial: createEditorialFixture({
    sceneIds: scenes.map(({id}) => id),
    fps,
    ...options,
  }),
  scenes,
  sceneTransitions,
  fps,
});

export const withCompiledEditorialFixture = (project, options = {}) => ({
  ...project,
  schemaVersion: 12,
  editorial: compileEditorialFixture({
    scenes: project.scenes ?? [],
    sceneTransitions: project.sceneTransitions ?? [],
    fps: project.video?.fps ?? 30,
    ...options,
  }),
});
import {compileEditorialSystem} from '../scripts/editorial-system-lib.mjs';
