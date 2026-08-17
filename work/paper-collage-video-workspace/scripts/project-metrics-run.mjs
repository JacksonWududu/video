#!/usr/bin/env node
import {spawn} from 'node:child_process';
import path from 'node:path';
import {ROOT} from './project-lib.mjs';
import {
  finishMetricSegment,
  startMetricSegment,
} from './production-metrics-lib.mjs';

const args = process.argv.slice(2);
const valueFor = (name) =>
  args.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);
const separator = args.indexOf('--');
const childArgs = separator >= 0 ? args.slice(separator + 1) : [];
const category = valueFor('--category');
const operation = valueFor('--operation');
const script = valueFor('--script');
const slugIndex = Number(valueFor('--slug-index') ?? 0);
const qualityActions = new Set([
  'prepare',
  'status',
  'scaffold',
  'contact-sheet',
  'record',
  'record-batch',
]);
const slug =
  script === 'scripts/project-quality.mjs' &&
  qualityActions.has(childArgs[0])
    ? childArgs[1]
    : childArgs[slugIndex];

const run = (file, commandArgs) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [file, ...commandArgs], {
    cwd: ROOT,
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  child.once('error', reject);
  child.once('exit', (code, signal) => resolve({code, signal}));
});

let segment = null;
try {
  const helpRequested = childArgs.includes('--help') || childArgs.includes('-h');
  if (!category || !operation || !script || (!helpRequested && !slug) || !Number.isInteger(slugIndex)) {
    throw new Error(
      '用法：project-metrics-run.mjs --category=<category> --operation=<name> --script=<file> --slug-index=<n> -- <child args>',
    );
  }
  if (helpRequested) {
    const result = await run(path.resolve(ROOT, script), childArgs);
    if (result.code !== 0) process.exitCode = result.code ?? 1;
  } else {
  segment = await startMetricSegment({
    slug,
    category,
    operation,
    measurement: 'command-wall-clock',
    source: 'command-wrapper',
    metadata: {script, arguments: childArgs},
  });
  const result = await run(path.resolve(ROOT, script), childArgs);
  await finishMetricSegment({
    slug,
    segmentId: segment.id,
    status: result.code === 0 ? 'completed' : 'failed',
    metadata: {exitCode: result.code, signal: result.signal ?? null},
  });
  if (result.code !== 0) process.exitCode = result.code ?? 1;
  }
} catch (error) {
  if (segment) {
    await finishMetricSegment({
      slug,
      segmentId: segment.id,
      status: 'failed',
      metadata: {error: error.message},
    }).catch(() => {});
  }
  console.error(`production metrics wrapper failed: ${error.message}`);
  process.exitCode = 1;
}
