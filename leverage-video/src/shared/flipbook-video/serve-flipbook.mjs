import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {validateFlipbookManifest, validateBrowserRecordingProof, isIndependentCopyPreview} from './contract.mjs';
import {sha256File, verifyFileChecksum, atomicWriteJson} from '../episode-tooling/file-integrity.mjs';
import {resolveInput} from './build-flipbook.mjs';
import {probeMedia, fullyDecodeMedia} from '../render-qa/media-qa.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

const mime = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp'};
const bodyJson = async (request) => {
  const buffers = []; let bytes = 0;
  for await (const buffer of request) {
    bytes += buffer.length;
    if (bytes > 2 * 1024 * 1024) throw new Error('JSON payload exceeds 2 MiB');
    buffers.push(buffer);
  }
  return JSON.parse(Buffer.concat(buffers).toString('utf8'));
};

export const validateCapturedMediaDimensions = (media, proof) => {
  const video = media.streams.filter((stream) => stream.codec_type === 'video');
  if (video.length !== 1 || video[0].width < 1920 || video[0].height < 1080
    || media.streams.some((stream) => stream.codec_type !== 'video')) throw new Error('browser capture must be one native 1080p-or-larger silent video stream');
  const capture = proof.capture;
  const observed = capture?.observed_frame;
  if (video[0].width !== capture?.width || video[0].height !== capture?.height
    || video[0].width !== observed?.width || video[0].height !== observed?.height) {
    throw new Error('encoded browser capture dimensions differ from the observed decoded frame');
  }
  return video[0];
};

export const createFlipbookServer = (outputDirectory, {productionPreflight, repositoryRoot = REPOSITORY_ROOT} = {}) => {
  const selected = fs.realpathSync(outputDirectory);
  const isDescriptor = fs.statSync(selected).isFile();
  const root = isDescriptor ? repositoryRoot : selected;
  const build = JSON.parse(fs.readFileSync(isDescriptor ? selected : path.join(root, 'build-evidence.json'), 'utf8'));
  const allowed = new Map([...build.files, ...build.source_inputs.map((item) => ({path: item.output, physical_path: item.physical_path, checksum_sha256: item.checksum_sha256}))]
    .map((item) => [item.path, {checksum: item.checksum_sha256, file: isDescriptor ? resolveInput(item.physical_path, repositoryRoot) : path.join(root, item.path)}]));
  const verifyBuild = (action = 'server-start') => {
    for (const entry of allowed.values()) verifyFileChecksum(entry.file, entry.checksum);
    const manifest = validateFlipbookManifest(JSON.parse(fs.readFileSync(allowed.get('manifest.json').file, 'utf8')));
    if (['pointer-lock', 'pointer-outside'].includes(build.capture_method) && !isIndependentCopyPreview(manifest)) {
      throw new Error('temporary pointer handling is restricted to the independent-copy maintenance preview');
    }
    if ((manifest.action_classification !== 'project_maintenance') !== isDescriptor) {
      throw new Error('production serving requires its categorized build descriptor');
    }
    if (manifest.action_classification === 'project_maintenance') {
      for (const value of [manifest.narration.path, ...manifest.spreads.map((spread) => spread.image.path), ...(manifest.opening_cover ? [manifest.opening_cover.image.path] : [])]) {
        if (!value.startsWith('leverage-video/src/shared/flipbook-video/fixtures/')) throw new Error('maintenance server requires dedicated fixtures (synthetic or authorized independent copies)');
      }
      if (isIndependentCopyPreview(manifest)) {
        for (const image of build.source_inputs) {
          const file = allowed.get(image.output)?.file;
          if (!file || !fs.lstatSync(file).isFile() || fs.lstatSync(file).nlink !== 1) {
            throw new Error('independent-copy preview must serve regular copied image files without links');
          }
        }
      }
    } else {
      const prefix = path.basename(path.dirname(allowed.get('index.html').file));
      if (build.recording_layout?.video_directory !== `${manifest.episode_workspace}/assets/video`
        || build.recording_layout?.evidence_directory !== `${manifest.episode_workspace}/schema`
        || build.recording_layout?.prefix !== prefix) throw new Error('recording artifact categories differ from the episode contract');
      if (typeof productionPreflight !== 'function') throw new Error('production browser server requires an executing productionPreflight gate');
      const evidence = productionPreflight({manifest, build, outputDirectory: path.dirname(allowed.get('index.html').file), action});
      if (!evidence || evidence.then) throw new Error('productionPreflight must synchronously return current verified bindings');
    }
    return manifest;
  };
  const manifest = verifyBuild();
  const sessions = new Map();
  const server = http.createServer(async (request, response) => {
    const reply = (code, value) => {
      response.writeHead(code, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
      response.end(JSON.stringify(value));
    };
    try {
      const origin = `http://127.0.0.1:${server.address().port}`;
      if (request.headers.host !== `127.0.0.1:${server.address().port}`) throw new Error('loopback Host mismatch');
      const url = new URL(request.url, origin);
      if (request.method === 'POST') {
        if (request.headers.origin !== origin) throw new Error('same-origin browser request required');
        verifyBuild(url.pathname.endsWith('/start') ? 'recording-start' : url.pathname.endsWith('/video') ? 'video-upload' : 'proof-validation');
        if (url.pathname === '/recordings/start') {
          if (request.headers['content-type'] !== 'application/json') throw new Error('JSON content type required');
          const data = await bodyJson(request);
          if (data.manifest_checksum_sha256 !== build.manifest_checksum_sha256) throw new Error('recording manifest checksum is stale');
          const id = crypto.randomBytes(16).toString('hex');
          const directory = isDescriptor ? path.resolve(root, build.recording_layout.evidence_directory) : path.join(root, 'recordings', id);
          const videoDirectory = isDescriptor ? path.resolve(root, build.recording_layout.video_directory) : directory;
          fs.mkdirSync(directory, {recursive: true}); fs.mkdirSync(videoDirectory, {recursive: true});
          const prefix = isDescriptor ? `${build.recording_layout.prefix}-${id}` : '';
          const session = {directory, state: 'created', video_file: path.join(videoDirectory, prefix ? `${prefix}.webm` : 'capture.webm'),
            proof_file: path.join(directory, prefix ? `${prefix}-proof.json` : 'recording-proof.json'),
            lock_file: path.join(directory, prefix ? `${prefix}-capture-lock.json` : 'capture-lock.json')};
          sessions.set(id, session);
          atomicWriteJson(path.join(directory, prefix ? `${prefix}-session.json` : 'session.json'), {...data, id, build_id: build.build_id});
          reply(201, {id}); return;
        }
        const match = url.pathname.match(/^\/recordings\/([a-f0-9]{32})\/(video|proof)$/);
        const session = match && sessions.get(match[1]);
        if (!session) throw new Error('unknown recording session');
        if (match[2] === 'video') {
          if (session.state !== 'created' || request.headers['content-type'] !== 'application/octet-stream') throw new Error('recording upload state or content type is invalid');
          session.state = 'uploading';
          let bytes = 0;
          const limiter = new Transform({transform(chunk, encoding, callback) {
            bytes += chunk.length;
            callback(bytes > 2 * 1024 * 1024 * 1024 ? new Error('recording exceeds 2 GiB') : null, chunk);
          }});
          const file = session.video_file;
          await pipeline(request, limiter, fs.createWriteStream(file, {flags: 'wx'}));
          if (bytes === 0) throw new Error('recording upload is empty');
          session.state = 'uploaded';
          session.video_checksum_sha256 = sha256File(file);
          reply(201, {bytes, checksum_sha256: session.video_checksum_sha256}); return;
        }
        if (session.state !== 'uploaded' || request.headers['content-type'] !== 'application/json') throw new Error('upload video before recording proof');
        const proof = await bodyJson(request);
        // Preserve measured failure evidence, but never turn it into a successful recording.
        atomicWriteJson(session.proof_file, proof);
        if ((proof.capture?.cursor_suppression?.method ?? 'cursor-never') !== (build.capture_method ?? 'cursor-never')) {
          throw new Error('recorded cursor suppression method differs from the reviewed build');
        }
        validateBrowserRecordingProof(proof, manifest, build.manifest_checksum_sha256);
        const media = probeMedia(session.video_file);
        validateCapturedMediaDimensions(media, proof);
        fullyDecodeMedia(session.video_file);
        const result = {contract_version: 'knowledge-video-browser-capture-lock-v1', result: 'pass',
          manifest_checksum_sha256: build.manifest_checksum_sha256,
          media, full_decode_result: 'pass',
          capture: {path: path.relative(root, session.video_file).split(path.sep).join('/'), checksum_sha256: session.video_checksum_sha256},
          proof: {path: path.relative(root, session.proof_file).split(path.sep).join('/'), checksum_sha256: sha256File(session.proof_file)}};
        atomicWriteJson(session.lock_file, result);
        session.state = 'complete'; reply(201, result); return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') { reply(405, {error: 'method not allowed'}); return; }
      const name = decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
      if (!allowed.has(name)) { reply(404, {error: 'not found'}); return; }
      const entry = allowed.get(name); const file = entry.file;
      verifyFileChecksum(file, entry.checksum);
      response.writeHead(200, {'Content-Type': mime[path.extname(name)] ?? 'application/octet-stream', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; img-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'"});
      if (request.method === 'HEAD') response.end();
      else await pipeline(fs.createReadStream(file), response);
    } catch (error) {
      if (!response.headersSent) reply(400, {error: error.message});
      else response.destroy(error);
    }
  });
  return server;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length < 3 || process.argv.length > 4) throw new Error('usage: node serve-flipbook.mjs <built-output-directory> [port]');
  const server = createFlipbookServer(process.argv[2]);
  server.listen(Number(process.argv[3] ?? 0), '127.0.0.1', () => console.log(`http://127.0.0.1:${server.address().port}`));
}
