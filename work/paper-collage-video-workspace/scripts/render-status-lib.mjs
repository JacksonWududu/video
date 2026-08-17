import fs from 'node:fs/promises';
import path from 'node:path';
import {fileExists, projectPaths, readJson, ROOT, writeJson} from './project-lib.mjs';

export const renderStatusFileFor = (slug) =>
  path.join(projectPaths(slug).distDirectory, 'render-status.json');

export const writeRenderStatus = async ({slug, mode, phase, artifact = null, detail = null, startedAt = null, error = null}) => {
  const file = renderStatusFileFor(slug);
  const prior = (await fileExists(file)) ? await readJson(file).catch(() => null) : null;
  const now = new Date().toISOString();
  const next = {
    schemaVersion: 1,
    projectSlug: slug,
    mode,
    phase,
    artifact: artifact ? path.relative(ROOT, artifact) : prior?.artifact ?? null,
    startedAt: startedAt ?? prior?.startedAt ?? now,
    updatedAt: now,
    completedAt: ['completed', 'failed', 'reused'].includes(phase) ? now : null,
    progress: null,
    progressAvailability: 'Remotion CLI log is intentionally quiet; exact frame percentage is unavailable. Status reflects a persisted lifecycle phase, never an inferred percentage.',
    detail,
    error,
  };
  await fs.mkdir(path.dirname(file), {recursive: true});
  await writeJson(file, next);
  return {file, status: next};
};

export const readRenderStatus = async (slug) => {
  const file = renderStatusFileFor(slug);
  if (!(await fileExists(file))) return {file, status: null};
  const status = await readJson(file);
  let artifact = null;
  if (status.artifact) {
    const absolute = path.resolve(ROOT, status.artifact);
    const stat = await fs.stat(absolute).catch(() => null);
    artifact = {
      file: status.artifact,
      exists: Boolean(stat?.isFile()),
      bytes: stat?.isFile() ? stat.size : null,
      modifiedAt: stat?.isFile() ? stat.mtime.toISOString() : null,
    };
  }
  return {file, status, artifact};
};
