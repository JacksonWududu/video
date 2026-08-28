#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const probeRender = (renderPath) => {
  const probe = spawnSync('ffprobe', [
    '-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', renderPath,
  ], {encoding: 'utf8'});
  if (probe.status !== 0) throw new Error('render audio probe failed');
  const streams = JSON.parse(probe.stdout).streams ?? [];
  if (streams.filter(({codec_type: type}) => type === 'audio').length !== 1) {
    throw new Error('render must contain exactly one mixed audio stream');
  }
  const measured = spawnSync('ffmpeg', [
    '-hide_banner', '-nostdin', '-i', renderPath,
    '-map', '0:a:0', '-af', 'volumedetect', '-f', 'null', '-',
  ], {encoding: 'utf8'});
  if (measured.status !== 0) throw new Error('render peak measurement failed');
  const match = measured.stderr.match(/max_volume:\s*(-?(?:[0-9]+(?:\.[0-9]+)?|inf)) dB/);
  if (!match) throw new Error('render max_volume evidence is missing');
  return Number(match[1]);
};

export const validateRenderSoundMix = ({plan, renderPath, measureImpl = probeRender}) => {
  if (plan?.schema_version !== 'knowledge-video-assembly-plan-v3'
      || plan.sound_effects?.narration_gain !== 1
      || plan.sound_effects?.normalization !== 'disabled'
      || plan.sound_effects?.peak_ceiling_dbfs !== -1
      || plan.sound_effects?.overflow_action !== 'lower-sfx-bus-uniformly'
      || typeof plan.sound_effects?.bus_gain_multiplier !== 'number'
      || !Array.isArray(plan.sound_effects?.cues)
      || plan.bgm?.mode !== 'disabled'
      || plan.bgm?.source !== null || plan.bgm?.track !== null) {
    throw new Error('render mix plan is missing its locked narration/SFX/BGM policy');
  }
  const peakDbfs = measureImpl(renderPath);
  if (!Number.isFinite(peakDbfs)) throw new Error('render peak is not finite');
  if (peakDbfs > -1) {
    throw new Error(
      `render peak ${peakDbfs} dBFS exceeds -1 dBFS; lower only the unified SFX bus and rerender`,
    );
  }
  return {
    contract_version: 'knowledge-video-render-sound-mix-qa-v1',
    result: 'pass',
    render_path: renderPath,
    narration_gain: 1,
    normalization: 'disabled',
    sfx_bus_gain_multiplier: plan.sound_effects.bus_gain_multiplier,
    sound_effect_cue_count: plan.sound_effects.cues.length,
    max_peak_dbfs: peakDbfs,
    peak_ceiling_dbfs: -1,
    bgm: 'disabled',
  };
};

const main = () => {
  const [planPath, renderPath] = process.argv.slice(2);
  if (!planPath || !renderPath) {
    throw new Error('usage: validate-render-sound-mix.mjs <assembly-plan.json> <render.mp4>');
  }
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  process.stdout.write(`${JSON.stringify(validateRenderSoundMix({plan, renderPath}), null, 2)}\n`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
