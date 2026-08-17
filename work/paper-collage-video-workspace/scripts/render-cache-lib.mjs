import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  collectRuntimeVisibleCompositionSources,
  collectCompositionGroups,
  hashCompositionValue,
} from './composition-lib.mjs';
import {collectProjectAudioEvents} from './audio-preflight-lib.mjs';
import {
  ROOT,
  fileExists,
  projectPaths,
  readJson,
  resolvePublicFile,
  writeJson,
} from './project-lib.mjs';
import {createRuntimeSurfaceFingerprint} from './runtime-build-lib.mjs';

export const hashFileStream = async (file) =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolve(hash.digest('hex')));
  });

const hashPublicSources = async (sources) => {
  const result = {};
  for (const source of [...new Set(sources.filter(Boolean))].sort()) {
    const file = resolvePublicFile(source);
    result[source] = (await fileExists(file)) ? await hashFileStream(file) : null;
  }
  return result;
};

const runtimeVisibleNodes = (nodes = []) =>
  nodes
    .filter(
      (node) =>
        !(
          node.kind === 'group' &&
          node.renderParticipation === 'derivation-only'
        ),
    )
    .map((node) =>
      node.kind === 'group'
        ? {...node, children: runtimeVisibleNodes(node.children)}
        : node.kind === 'editorial-switch'
          ? {
              ...node,
              panels: node.panels.map((panel) => ({
                ...panel,
                node:
                  runtimeVisibleNodes([panel.node])[0] ?? panel.node,
              })),
            }
          : node,
    );

const visualScene = (scene) => ({
  ...scene,
  composition: {
    ...scene.composition,
    nodes: runtimeVisibleNodes(scene.composition?.nodes),
  },
  narration: {
    startSeconds: scene.narration.startSeconds,
    durationSeconds: scene.narration.durationSeconds,
    text: scene.narration.text,
  },
  events: (scene.events ?? []).map(({sound: _sound, ...event}) => event),
});

const compositionProofScene = (scene) => ({
  ...visualScene(scene),
  narration: {
    startSeconds: scene.narration.startSeconds,
    durationSeconds: scene.narration.durationSeconds,
  },
  subtitles: [],
  appearance: {
    ...scene.appearance,
    subtitles: {variant: 'hidden'},
  },
});

export const createCompositionProofProject = (project) => ({
  ...structuredClone(project),
  scenes: (project.scenes ?? []).map((scene) => ({
    ...structuredClone(scene),
    subtitles: [],
    appearance: {
      ...structuredClone(scene.appearance ?? {}),
      subtitles: {variant: 'hidden'},
    },
  })),
});

export const createVisualFingerprint = async (project, mode) => {
  const runtimeBuildFingerprint =
    await createRuntimeSurfaceFingerprint('final-visual');
  const sources = [project.theme.surface?.texture?.src, project.theme.fontFile];
  for (const scene of project.scenes ?? []) {
    sources.push(
      ...collectRuntimeVisibleCompositionSources(scene.composition),
    );
    for (const {node, renderParticipation} of collectCompositionGroups(scene.composition)) {
      if (renderParticipation !== 'visible') continue;
      for (const boundary of node.boundaries ?? []) {
        sources.push(boundary.upperMaskSrc, boundary.lowerMaskSrc);
      }
    }
  }
  return hashCompositionValue({
    mode,
    title: project.title,
    video: project.video,
    styleProfile: project.styleProfile,
    motionContract: project.motionContract,
    theme: project.theme,
    scenes: (project.scenes ?? []).map(visualScene),
    sceneTransitions: project.sceneTransitions,
    sourceHashes: await hashPublicSources(sources),
    runtimeBuildFingerprint,
  });
};

export const createSceneProofFingerprint = async ({
  project,
  scene,
  proof,
  absoluteFrame,
  surface = 'final-visual',
}) => {
  const runtimeFingerprint = await createRuntimeSurfaceFingerprint(surface);
  const sources = [project.theme.surface?.texture?.src, project.theme.fontFile];
  sources.push(
    ...collectRuntimeVisibleCompositionSources(scene.composition),
  );
  for (const {node, renderParticipation} of collectCompositionGroups(scene.composition)) {
    if (renderParticipation !== 'visible') continue;
    for (const boundary of node.boundaries ?? []) {
      sources.push(boundary.upperMaskSrc, boundary.lowerMaskSrc);
    }
  }
  return hashCompositionValue({
    video: project.video,
    styleProfile: project.styleProfile,
    motionContract: project.motionContract,
    theme: project.theme,
    scene:
      surface === 'composition-proof'
        ? compositionProofScene(scene)
        : visualScene(scene),
    proof,
    absoluteFrame,
    sourceHashes: await hashPublicSources(sources),
    runtimeSurface: surface,
    runtimeFingerprint,
  });
};

export const createAudioFingerprint = async (project) => {
  const {timeline, events} = collectProjectAudioEvents(project);
  const sourceHashes = await hashPublicSources(events.map(({src}) => src));
  return hashCompositionValue({
    audio: project.audio,
    durationInFrames: timeline.durationInFrames,
    events,
    sourceHashes,
    runtimeFingerprint:
      await createRuntimeSurfaceFingerprint('audio-delivery'),
  });
};

export const createRenderFingerprints = async (project, mode) => ({
  visual: await createVisualFingerprint(project, mode),
  audio: await createAudioFingerprint(project),
});

export const renderCacheFileFor = (slug) =>
  path.join(projectPaths(slug).distDirectory, 'render-cache.json');

export const readRenderCache = async (slug) => {
  const file = renderCacheFileFor(slug);
  if (!(await fileExists(file))) {
    return {schemaVersion: 1, projectSlug: slug, modes: {}};
  }
  const cache = await readJson(file);
  if (cache.schemaVersion !== 1 || cache.projectSlug !== slug) {
    return {schemaVersion: 1, projectSlug: slug, modes: {}};
  }
  return cache;
};

export const classifyRenderCache = async ({
  cache,
  mode,
  artifact,
  fingerprints,
}) => {
  const entry = cache.modes?.[mode];
  if (!entry || !(await fileExists(artifact))) return 'miss';
  const artifactSha256 = await hashFileStream(artifact);
  if (artifactSha256 !== entry.artifactSha256) return 'miss';
  if (entry.visualFingerprint !== fingerprints.visual) return 'miss';
  if (entry.audioFingerprint === fingerprints.audio) return 'exact';
  return 'visual-only';
};

export const updateRenderCache = async ({
  slug,
  cache,
  mode,
  artifact,
  fingerprints,
}) => {
  const file = renderCacheFileFor(slug);
  const next = {
    schemaVersion: 1,
    projectSlug: slug,
    updatedAt: new Date().toISOString(),
    modes: {
      ...(cache.modes ?? {}),
      [mode]: {
        artifact: path.relative(ROOT, artifact),
        artifactSha256: await hashFileStream(artifact),
        visualFingerprint: fingerprints.visual,
        audioFingerprint: fingerprints.audio,
        updatedAt: new Date().toISOString(),
      },
    },
  };
  await fs.mkdir(path.dirname(file), {recursive: true});
  await writeJson(file, next);
  return next;
};
