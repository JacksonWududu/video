import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createFlipbookManifest, FLIPBOOK_RENDERER} from '../contract.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const FIXTURE_PREFIX = 'leverage-video/src/shared/flipbook-video/fixtures/';
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
};
const chunk = (name, bytes) => {
  const type = Buffer.from(name); const result = Buffer.alloc(bytes.length + 12);
  result.writeUInt32BE(bytes.length); type.copy(result, 4); bytes.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([type, bytes])), bytes.length + 8); return result;
};

export const syntheticPng = (variant = 0, {width = 1920, height = 1080} = {}) => {
  const data = Buffer.alloc((width * 3 + 1) * height);
  const colors = [[65, 87, 97], [153, 103, 68], [72, 110, 89]];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let color = [246, 238, 220];
      const u = x / width * 1920; const v = y / height * 1080;
      const box = variant === 1
        ? (u - 640) ** 2 + (v - 430) ** 2 < 260 ** 2 || (u > 1050 && u < 1550 && v > 320 && v < 800)
        : u > 180 && u < 1740 && v > 250 && v < 790 && Math.floor((u - 180) / 390) % 2 === 0;
      if (box) color = colors[variant % colors.length];
      const offset = y * (width * 3 + 1) + 1 + x * 3;
      data[offset] = color[0]; data[offset + 1] = color[1]; data[offset + 2] = color[2];
    }
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(data)), chunk('IEND', Buffer.alloc(0))]);
};

export const pcmWav = (pcm) => {
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(pcm.length + 36, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22);
  header.writeUInt32LE(44100, 24); header.writeUInt32LE(44100 * 4, 28); header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
};

export const narrationPcmFrames = (pcm) => {
  if (pcm.length === 0 || pcm.length % 4 !== 0) throw new Error('test narration contains no complete PCM audio samples; check system voice service access');
  return Math.ceil(pcm.length / 4 / 1470);
};

const syntheticTone = (frames, tone) => {
  const samples = frames * 1470; const pcm = Buffer.alloc(samples * 4);
  for (let i = 0; i < samples; i += 1) {
    const amplitude = Math.round(Math.sin(i / 44100 * Math.PI * 2 * tone) * 2600 * Math.min(1, i / 500, (samples - i) / 500));
    pcm.writeInt16LE(amplitude, i * 4); pcm.writeInt16LE(amplitude, i * 4 + 2);
  }
  return pcm;
};

export const createSyntheticFixture = (directory, {repositoryRoot = REPOSITORY_ROOT, systemVoice = null} = {}) => {
  const relative = path.relative(repositoryRoot, path.resolve(directory)).split(path.sep).join('/');
  if (!relative.startsWith(FIXTURE_PREFIX)) throw new Error('synthetic fixture must live under the dedicated shared fixtures directory');
  if (fs.existsSync(directory) && fs.readdirSync(directory).length) throw new Error('synthetic fixture directory must be new or empty');
  if (systemVoice) {
    const voices = execFileSync('/usr/bin/say', ['-v', '?'], {encoding: 'utf8'});
    if (!voices.split('\n').some((line) => line.startsWith(`${systemVoice} `))) throw new Error('requested fixture voice is not already installed');
  }
  fs.mkdirSync(directory, {recursive: true});
  const texts = [
    ['先看一幅完整的图。', '正文依照声音逐句出现，已经读过的文字仍留在纸上。'],
    ['翻过这一页，图和文字交换了位置。', '左右位置只抽取一次，预览与重录保持相同。'],
    ['图片保留完整比例，文字不挤进字幕留白。', '书外的按钮与提示全部隐藏，视频直接从第一组双页开始。'],
  ];
  const audio = []; const spreads = []; let frame = 0;
  for (const [index, phrases] of texts.entries()) {
    const shotId = `S0${index + 1}`; const startFrame = frame; let byte = 0; const reveals = [];
    for (const [phraseIndex, text] of phrases.entries()) {
      let pcm;
      if (systemVoice) {
        const file = path.join(directory, `${shotId}-${phraseIndex}.aiff`);
        execFileSync('/usr/bin/say', ['-v', systemVoice, '-r', '230', '-o', file, text]);
        pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ar', '44100', '-ac', '2', '-f', 's16le', '-'], {maxBuffer: 20 * 1024 * 1024});
      } else pcm = syntheticTone(45, 320 + index * 110 + phraseIndex * 45);
      const durationFrames = narrationPcmFrames(pcm);
      const padded = Buffer.alloc(durationFrames * 1470 * 4); pcm.copy(padded); audio.push(padded);
      reveals.push({id: `${shotId}-text-${phraseIndex + 1}`, source_start_byte: byte, source_end_byte: byte + Buffer.byteLength(text), start_frame: frame, end_frame: frame + 6});
      byte += Buffer.byteLength(text); frame += durationFrames;
    }
    // A synthetic pause reserves the approved page turn without stretching speech.
    audio.push(Buffer.alloc(30 * 1470 * 4)); frame += 30;
    const image = syntheticPng(index); const imageName = `${shotId}.png`; fs.writeFileSync(path.join(directory, imageName), image);
    const sourceText = phrases.join('');
    spreads.push({shot_id: shotId, scene_class: index === 1 ? 'narrative_illustration' : 'structural_explanation',
      visual_generation_route: index === 1 ? 'imagegen' : 'ian-handdrawn-ppt', white_cat_present: false,
      start_frame: startFrame, duration_frames: frame - startFrame,
      image: {path: `${relative}/${imageName}`, checksum_sha256: hash(image), width: 1920, height: 1080},
      static_spread: {contract_version: 'knowledge-video-static-spread-v1', source_text: sourceText, source_text_sha256: hash(sourceText)}, text_reveals: reveals,
      transition_out: index === texts.length - 1 ? null : {kind: 'book-page-turn', renderer: FLIPBOOK_RENDERER, start_frame: frame - 15, duration_in_frames: 15,
        user_selection: {status: 'approved', presented_map_sha256: hash('synthetic-fixture-approved-page-turn-only')}}});
  }
  const wav = pcmWav(Buffer.concat(audio)); fs.writeFileSync(path.join(directory, 'narration.wav'), wav);
  const manifest = createFlipbookManifest({contract_version: 'knowledge-video-flipbook-v1', style_id: 'illustrated-flipbook', presentation_mode: 'illustrated-flipbook',
    action_classification: 'project_maintenance', fixture_provenance: {synthetic: true, episode_data_used: false,
      audio_kind: systemVoice ? 'installed-system-voice-test-only' : 'synthetic-tone-test-only', system_voice: systemVoice},
    canvas: {width: 1920, height: 1080, fps: 30}, layout_seed: 'synthetic-flipbook-layout-20260904', total_frames: frame,
    narration: {path: `${relative}/narration.wav`, checksum_sha256: hash(wav)}, spreads});
  fs.writeFileSync(path.join(directory, 'input.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = process.argv[2]; const systemVoice = process.argv[3] ?? null;
  if (!output) throw new Error('usage: node fixtures/synthetic.mjs <new-fixture-directory> [already-installed-system-voice]');
  const result = createSyntheticFixture(output, {systemVoice});
  console.log(JSON.stringify({input: path.join(output, 'input.json'), total_frames: result.total_frames, audio: result.fixture_provenance.audio_kind}));
}
