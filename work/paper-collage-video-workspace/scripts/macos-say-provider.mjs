#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const valueFor = (name) => args[args.indexOf(name) + 1];
const text = valueFor('--text');
const output = valueFor('--output');
const voice = valueFor('--voice') || 'Fred';
const rate = valueFor('--rate') || '145';
if (!text || !output) {
  console.error('usage: macos-say-provider --text <text> --output <wav> [--voice Fred] [--rate 145]');
  process.exit(2);
}

fs.mkdirSync(path.dirname(output), {recursive: true});
const temp = path.join(os.tmpdir(), `paper-collage-say-${process.pid}.aiff`);
try {
  const spoken = spawnSync('/usr/bin/say', ['-v', voice, '-r', rate, '-o', temp, text], {stdio: 'inherit'});
  if (spoken.status !== 0) process.exit(spoken.status ?? 1);
  const converted = spawnSync('/opt/homebrew/bin/ffmpeg', ['-y', '-i', temp, '-c:a', 'pcm_s16le', '-ar', '44100', '-ac', '1', output], {stdio: 'inherit'});
  if (converted.status !== 0) process.exit(converted.status ?? 1);
} finally {
  try { fs.unlinkSync(temp); } catch {}
}
