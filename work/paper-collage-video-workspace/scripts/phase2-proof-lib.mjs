import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPhase2EditorialAuthoring} from '../fixtures/phase2-proof-fixture.mjs';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const PHASE2_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
export const PHASE2_PROOF_DIR = path.join(PHASE2_ROOT, 'dist', 'vox-phase2-proof');
export const PHASE2_PUBLIC_DIR = path.join(
  PHASE2_ROOT,
  'public',
  'fixtures',
  'vox-phase2-proof',
);
export const PHASE2_MEDIA_PUBLIC_PREFIX = 'fixtures/vox-phase2-proof';

export const writeJson = async (file, value) => {
  await fs.mkdir(path.dirname(file), {recursive: true});
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
};

export const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));

export const sha256File = async (file) =>
  createHash('sha256').update(await fs.readFile(file)).digest('hex');

export const sha256Value = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

const wavBuffer = ({
  durationSeconds,
  frequency,
  pulses,
  sampleRate = 48_000,
}) => {
  const sampleCount = Math.round(durationSeconds * sampleRate);
  const bytesPerSample = 2;
  const dataBytes = sampleCount * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / sampleRate;
    const base = Math.sin(2 * Math.PI * frequency * time) * 0.035;
    const pulse = pulses.reduce((sum, point, pulseIndex) => {
      const distance = Math.abs(time - point);
      if (distance >= 0.065) return sum;
      const envelope = Math.pow(1 - distance / 0.065, 2);
      return sum + Math.sin(2 * Math.PI * (frequency * (1.4 + pulseIndex * 0.09)) * time) * envelope * 0.14;
    }, 0);
    const sample = Math.max(-1, Math.min(1, base + pulse));
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + index * bytesPerSample);
  }
  return buffer;
};

const mediaDefinitions = [
  {
    id: 'narration-1',
    kind: 'narration',
    filename: 'narration-1.wav',
    durationSeconds: 3,
    frequency: 196,
    pulses: [0.15, 0.45, 0.9, 1.35, 1.75, 2.25],
    timelineMode: 'scene-local',
  },
  {
    id: 'narration-2',
    kind: 'narration',
    filename: 'narration-2.wav',
    durationSeconds: 3,
    frequency: 247,
    pulses: [0.15, 0.3, 0.45, 0.75, 0.8, 1.15, 1.5, 1.9, 2.3],
    timelineMode: 'scene-local',
  },
  {
    id: 'sfx',
    kind: 'sfx',
    filename: 'sfx.wav',
    durationSeconds: 3,
    frequency: 330,
    pulses: [0.6, 0.72, 1.05],
    timelineMode: 'scene-local',
    sceneOffsetSeconds: 0.24,
  },
  {
    id: 'music',
    kind: 'music',
    filename: 'music.wav',
    durationSeconds: 6,
    frequency: 110,
    pulses: [0.6, 1.2, 3, 3.45, 3.8, 4.15, 4.5, 4.9, 5.3],
    timelineMode: 'global',
  },
];

export const preparePhase2Media = async () => {
  await fs.mkdir(PHASE2_PUBLIC_DIR, {recursive: true});
  const media = [];
  for (const definition of mediaDefinitions) {
    const file = path.join(PHASE2_PUBLIC_DIR, definition.filename);
    await fs.writeFile(file, wavBuffer(definition));
    const timingFilename = definition.filename.replace(/\.wav$/u, '.timing.json');
    media.push({
      id: definition.id,
      kind: definition.kind,
      src: `${PHASE2_MEDIA_PUBLIC_PREFIX}/${definition.filename}`,
      sha256: await sha256File(file),
      durationSeconds: definition.durationSeconds,
      timingDataSrc: `${PHASE2_MEDIA_PUBLIC_PREFIX}/${timingFilename}`,
      timelineMode: definition.timelineMode,
      ...(definition.sceneOffsetSeconds !== undefined
        ? {sceneOffsetSeconds: definition.sceneOffsetSeconds}
        : {}),
    });
  }
  const editorial = createPhase2EditorialAuthoring({media});
  for (const item of media) {
    const timingFile = path.join(
      PHASE2_PUBLIC_DIR,
      path.basename(item.timingDataSrc),
    );
    const cues = editorial.cues
      .filter(({mediaId, timingBasis}) =>
        mediaId === item.id && timingBasis === 'actual-audio'
      )
      .map(({id, kind, source, atSeconds, endSeconds, text}) => ({
        id,
        kind,
        source,
        atSeconds,
        ...(endSeconds !== undefined ? {endSeconds} : {}),
        ...(text !== undefined ? {text} : {}),
      }));
    await writeJson(timingFile, {
      schemaVersion: 1,
      mediaId: item.id,
      mediaSha256: item.sha256,
      durationSeconds: item.durationSeconds,
      source: 'deterministic-local-waveform-analysis-fixture',
      sampleRate: 48_000,
      cues,
    });
  }
  return media;
};

export const listFilesRecursively = async (directory) => {
  const entries = await fs.readdir(directory, {withFileTypes: true});
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFilesRecursively(file));
    else if (entry.isFile()) files.push(file);
  }
  return files;
};

export const hashFiles = async (files, {relativeTo = PHASE2_ROOT} = {}) =>
  Object.fromEntries(await Promise.all(
    [...files].sort().map(async (file) => [
      path.relative(relativeTo, file),
      await sha256File(file),
    ]),
  ));
