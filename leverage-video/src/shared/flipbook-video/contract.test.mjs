import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import test from 'node:test';
import {createSyntheticFixture, narrationPcmFrames, syntheticPng} from './fixtures/synthetic.mjs';
import {createFlipbookManifest, deriveImageSide, validateFlipbookManifest, validateBrowserRecordingProof} from './contract.mjs';
import {buildFlipbook} from './build-flipbook.mjs';
import {createFlipbookServer} from './serve-flipbook.mjs';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'flipbook-contract-'));
const fixtureDirectory = path.join(temporary, 'leverage-video/src/shared/flipbook-video/fixtures/test-case');
const fixture = createSyntheticFixture(fixtureDirectory, {repositoryRoot: temporary});
test.after(() => fs.rmSync(temporary, {recursive: true, force: true}));
const mutate = (operation) => { const copy = structuredClone(fixture); operation(copy); return copy; };
const withOpeningCover = (input = fixture) => {
  const manifest = structuredClone(input);
  manifest.opening_cover = {image: structuredClone(manifest.spreads[0].image), hold_frames: 24, open_frames: 30};
  manifest.total_frames += 54;
  for (const spread of manifest.spreads) {
    spread.start_frame += 54;
    for (const reveal of spread.text_reveals) { reveal.start_frame += 54; reveal.end_frame += 54; }
    if (spread.transition_out) spread.transition_out.start_frame += 54;
  }
  return manifest;
};

test('synthetic two-route manifest preserves exact text and persistent random sides', () => {
  assert.equal(validateFlipbookManifest(fixture), fixture);
  assert.deepEqual(createFlipbookManifest(fixture), fixture);
  assert.equal(new Set(fixture.spreads.map((spread) => spread.visual_generation_route)).size, 2);
  assert.equal(new Set(fixture.spreads.map((spread) => spread.image_side)).size, 2);
  for (const spread of fixture.spreads) assert.equal(spread.image_side, deriveImageSide(fixture.layout_seed, spread.shot_id));
});

test('zero-duration system voice output cannot masquerade as a spoken fixture', () => {
  assert.throws(() => narrationPcmFrames(Buffer.alloc(0)), /no complete PCM/);
  assert.equal(narrationPcmFrames(Buffer.alloc(1470 * 4)), 1);
});

test('rejects changed text, cats, side drift, split UTF-8 and text after page turn', () => {
  for (const change of [
    (value) => { value.spreads[0].static_spread.source_text += '改'; },
    (value) => { value.spreads[0].white_cat_present = true; },
    (value) => { value.spreads[0].image_side = value.spreads[0].text_side; },
    (value) => { value.spreads[0].text_reveals[0].source_end_byte -= 1; },
    (value) => { value.spreads[0].text_reveals.at(-1).end_frame = value.spreads[0].transition_out.start_frame + 1; },
    (value) => { value.spreads[0].transition_out.kind = 'cut'; },
    (value) => { value.spreads[0].transition_out.user_selection.presented_map_sha256 = ''; },
  ]) assert.throws(() => validateFlipbookManifest(mutate(change)));
});

test('explicit opening cover reserves 54 frames while body images remain no-cat and narration stays exact', () => {
  const manifest = withOpeningCover();
  assert.equal(validateFlipbookManifest(manifest), manifest);
  assert.equal(manifest.spreads[0].start_frame, 54);
  assert.equal(manifest.spreads[0].text_reveals[0].start_frame, 54);
  assert.equal(manifest.total_frames - manifest.spreads.at(-1).start_frame, manifest.spreads.at(-1).duration_frames);
  assert.equal(validateFlipbookManifest(fixture).spreads[0].start_frame, 0);
  for (const change of [
    (value) => { value.opening_cover = null; },
    (value) => { value.opening_cover.hold_frames = 25; },
    (value) => { value.opening_cover.open_frames = 15; },
    (value) => { value.opening_cover.image.checksum_sha256 = ''; },
    (value) => { value.opening_cover.image.width = 940; value.opening_cover.image.height = 1672; },
    (value) => { value.spreads[0].start_frame = 0; },
    (value) => { value.spreads[0].text_reveals[0].start_frame = 0; },
    (value) => { value.total_frames -= 54; },
    (value) => { value.spreads[0].white_cat_present = true; },
  ]) {
    const candidate = structuredClone(manifest); change(candidate);
    assert.throws(() => validateFlipbookManifest(candidate));
  }
});

test('new HTML preserves every byte, contains images and hides every external control while recording', () => {
  const output = path.join(temporary, 'bundle');
  const result = buildFlipbook(fixture, output, {repositoryRoot: temporary});
  const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
  assert.equal((html.match(/class="book-page /g) ?? []).length, 6);
  assert.doesNotMatch(html, /book-header|page-status|orientation|<footer|data-density="hard"/);
  assert.match(fs.readFileSync(path.join(output, 'video.css'), 'utf8'), /object-fit: contain/);
  assert.match(fs.readFileSync(path.join(output, 'video.css'), 'utf8'), /body\.recording #recording-controls \{ display: none; \}/);
  const runtime = fs.readFileSync(path.join(output, 'browser-runtime.js'), 'utf8');
  assert.match(runtime, /displaySurface !== 'browser'/);
  assert.match(runtime, /getCaptureHandle/);
  assert.match(runtime, /visibilityState !== 'visible'/);
  assert.match(runtime, /pageFlip\.flipNext\('bottom'\)/);
  assert.equal(result.build.source_inputs.length, 3);
  assert.throws(() => buildFlipbook(fixture, output, {repositoryRoot: temporary}), /new or empty/);
});

test('build rejects stale assets and maintenance paths outside synthetic fixture root', () => {
  assert.throws(() => buildFlipbook(mutate((value) => { value.spreads[0].image.checksum_sha256 = 'a'.repeat(64); }),
    path.join(temporary, 'stale'), {repositoryRoot: temporary}), /checksum/);
  assert.throws(() => buildFlipbook(mutate((value) => { value.narration.path = 'topic-test/narration.wav'; }),
    path.join(temporary, 'episode'), {repositoryRoot: temporary}), /synthetic/);
  assert.throws(() => buildFlipbook(mutate((value) => { value.action_classification = 'episode'; }),
    path.join(temporary, 'production'), {repositoryRoot: temporary}), /productionPreflight/);
});

test('approved 1536x864 source stays unchanged and false dimension claims fail', () => {
  const png = syntheticPng(0, {width: 1536, height: 864});
  fs.writeFileSync(path.join(fixtureDirectory, 'native-1536.png'), png);
  const input = mutate((value) => { value.spreads[0].image = {...value.spreads[0].image,
    path: 'leverage-video/src/shared/flipbook-video/fixtures/test-case/native-1536.png',
    checksum_sha256: crypto.createHash('sha256').update(png).digest('hex'), width: 1536, height: 864}; });
  const result = buildFlipbook(input, path.join(temporary, 'native-source'), {repositoryRoot: temporary});
  assert.deepEqual(fs.readFileSync(path.join(result.output, 'assets/images/S01.png')), png);
  assert.match(fs.readFileSync(path.join(result.output, 'index.html'), 'utf8'), /width="1536" height="864"/);
  input.spreads[0].image.width = 1920; input.spreads[0].image.height = 1080;
  assert.throws(() => buildFlipbook(input, path.join(temporary, 'false-size'), {repositoryRoot: temporary}), /measured raster dimensions/);
});

const recordingProof = (input = fixture) => ({contract_version: 'knowledge-video-browser-recording-v1', manifest_checksum_sha256: 'a'.repeat(64),
  capture: {display_surface: 'browser', current_tab_verified: true, visibility_state: 'visible', width: 1920, height: 1080, frame_rate: 30,
    settled_track_settings: {cursor: 'never'}, cursor_suppression: {method: 'cursor-never', supported_cursor: true,
      capability_cursor: ['always', 'motion', 'never'], before_cursor: 'motion', requested_cursor: {exact: 'never'},
      apply_result: 'resolved', after_cursor: 'never', applied_cursor: {exact: 'never'}, cursor_suppressed: true,
      after_frame_cursor: 'never', final_cursor: 'never'},
    dimension_source: 'decoded-video-frame', observed_frame: {method: 'HTMLVideoElement.requestVideoFrameCallback',
      width: 1920, height: 1080, video_width: 1920, video_height: 1080, presented_frames: 2}},
  all_images_decoded: true, fonts_ready: true, ui_hidden: true, errors: [],
  layout_checks: input.spreads.map((spread, index) => ({shot_id: spread.shot_id, text_fits: true, image_contained: true, stable_layout: true, source_text_matches: true, text: spread.static_spread.source_text,
    ...(input.opening_cover ? {engine_page_index: index * 2 + 1} : {})})),
  ...(input.opening_cover ? {cover_layout_check: {engine_page_index: 0, fit: 'contain', image_contained: true,
    centered: true, center_offset_x_px: 0, natural_width_px: input.opening_cover.image.width, natural_height_px: input.opening_cover.image.height}} : {}),
  total_frames: input.total_frames, elapsed_ms: input.total_frames / 30 * 1000,
  events: [...(input.opening_cover ? [
    {type: 'cover-hold', expected_frame: 0, actual_ms: 0, page: 0, scale: 1.35, translate_x: -410},
    {type: 'cover-open', expected_frame: 24, actual_ms: 800, duration_in_frames: 30},
    {type: 'renderer-cover-open-complete', expected_frame: 54, actual_ms: 1800, page: 1},
    {type: 'camera-settle', expected_frame: 54, actual_ms: 1800, scale: 1, translate_x: 0},
  ] : []), ...input.spreads.flatMap((spread, index) => [...spread.text_reveals.map((reveal) => ({type: 'text-reveal', shot_id: spread.shot_id, id: reveal.id,
    expected_frame: reveal.start_frame, actual_ms: reveal.start_frame / 30 * 1000})), ...(spread.transition_out ? [{type: 'page-turn', shot_id: spread.shot_id,
    expected_frame: spread.transition_out.start_frame, actual_ms: spread.transition_out.start_frame / 30 * 1000}, {type: 'renderer-turn-complete', page: (index + 1) * 2 + (input.opening_cover ? 1 : 0), actual_ms: input.spreads[index + 1].start_frame / 30 * 1000}] : [])])]});

test('recording proof needs current visible tab, full text, real turns and bounded drift', () => {
  assert.ok(validateBrowserRecordingProof(recordingProof(), fixture, 'a'.repeat(64)));
  for (const change of [
    (proof) => { proof.capture.display_surface = 'monitor'; },
    (proof) => { proof.capture.current_tab_verified = false; },
    (proof) => { proof.ui_hidden = false; },
    (proof) => { proof.layout_checks[0].text_fits = false; },
    (proof) => { proof.events[0].actual_ms += 101; },
    (proof) => { proof.events = proof.events.filter((event) => event.type !== 'renderer-turn-complete'); },
  ]) { const proof = recordingProof(); change(proof); assert.throws(() => validateBrowserRecordingProof(proof, fixture, 'a'.repeat(64))); }
});

test('renderer completion rejects incorrect pages, reordered turns and false completion timing', () => {
  const turns = (proof) => proof.events.filter((event) => event.type === 'renderer-turn-complete');
  for (const change of [
    (proof) => { turns(proof)[0].actual_ms += 101; },
    (proof) => { turns(proof)[0].actual_ms -= 101; },
    (proof) => { turns(proof)[0].actual_ms = Number.NaN; },
    (proof) => { turns(proof)[0].page = 0; },
    (proof) => { turns(proof)[1].page = turns(proof)[0].page; },
    (proof) => {
      const completed = turns(proof);
      [completed[0].page, completed[1].page] = [completed[1].page, completed[0].page];
      [completed[0].actual_ms, completed[1].actual_ms] = [completed[1].actual_ms, completed[0].actual_ms];
    },
  ]) {
    const proof = recordingProof(); change(proof);
    assert.throws(() => validateBrowserRecordingProof(proof, fixture, 'a'.repeat(64)), /actual renderer page completion/);
  }
  const withinTolerance = recordingProof(); turns(withinTolerance)[0].actual_ms += 100;
  assert.equal(validateBrowserRecordingProof(withinTolerance, fixture, 'a'.repeat(64)), withinTolerance);
});

test('opening proof requires actual cover layout, real opening and measured camera settlement', () => {
  const manifest = withOpeningCover();
  const proof = recordingProof(manifest);
  assert.equal(validateBrowserRecordingProof(proof, manifest, 'a'.repeat(64)), proof);
  const event = (value, type) => value.events.find((row) => row.type === type);
  for (const change of [
    (value) => { delete value.cover_layout_check; },
    (value) => { value.cover_layout_check.image_contained = false; },
    (value) => { value.cover_layout_check.fit = 'cover'; },
    (value) => { value.cover_layout_check.center_offset_x_px = 1; },
    (value) => { value.cover_layout_check.natural_width_px += 1; },
    (value) => { value.layout_checks[0].engine_page_index = 0; },
    (value) => { value.layout_checks[0].engine_page_index = 2; event(value, 'renderer-cover-open-complete').page = 2; },
    (value) => { value.layout_checks[1].engine_page_index = value.layout_checks[0].engine_page_index; },
    (value) => { value.layout_checks[2].engine_page_index = manifest.spreads.length * 2 + 1; },
    (value) => { delete value.layout_checks[1].engine_page_index; },
    (value) => { value.events = value.events.filter((row) => row.type !== 'cover-open'); },
    (value) => { value.events.push({...event(value, 'cover-hold')}); },
    (value) => { event(value, 'cover-hold').page = 1; },
    (value) => { event(value, 'cover-hold').scale = 1; },
    (value) => { event(value, 'cover-open').duration_in_frames = 15; },
    (value) => { event(value, 'renderer-cover-open-complete').page = 0; },
    (value) => { event(value, 'renderer-cover-open-complete').actual_ms += 101; },
    (value) => { event(value, 'camera-settle').expected_frame += 1; },
    (value) => { event(value, 'camera-settle').scale = 1.02; },
    (value) => { event(value, 'camera-settle').translate_x = 1; },
    (value) => { event(value, 'renderer-turn-complete').page = 2; },
    (value) => { event(value, 'renderer-turn-complete').actual_ms += 101; },
  ]) {
    const candidate = recordingProof(manifest); change(candidate);
    assert.throws(() => validateBrowserRecordingProof(candidate, manifest, 'a'.repeat(64)));
  }
  const withoutSelection = recordingProof();
  withoutSelection.events.push({...event(proof, 'cover-hold')});
  assert.throws(() => validateBrowserRecordingProof(withoutSelection, fixture, 'a'.repeat(64)), /explicitly selected opening cover/);
});

test('capture evidence requires measured resolution, landscape ratio and near-30 frame rate', () => {
  for (const capture of [
    {width: 1919}, {height: 1079}, {width: 1920, height: 1200},
    {width: undefined}, {height: '1080'}, {frame_rate: undefined},
    {frame_rate: '30'}, {frame_rate: 24}, {frame_rate: 60}, {frame_rate: 30.11},
  ]) {
    const proof = recordingProof(); Object.assign(proof.capture, capture);
    assert.throws(() => validateBrowserRecordingProof(proof, fixture, 'a'.repeat(64)), /measured browser capture/);
  }
  for (const frameRate of [29.9, 29.97, 30.1]) {
    const measured = recordingProof();
    Object.assign(measured.capture, {width: 3840, height: 2160, frame_rate: frameRate});
    Object.assign(measured.capture.observed_frame, {width: 3840, height: 2160, video_width: 3840, video_height: 2160});
    assert.equal(validateBrowserRecordingProof(measured, fixture, 'a'.repeat(64)), measured);
  }
});

test('capture dimensions come from actual decoded frames rather than transitional track settings', () => {
  const proof = recordingProof();
  Object.assign(proof.capture, {width: 3024, height: 1700,
    initial_track_settings: {width: 3024, height: 1964}, settled_track_settings: {width: 3024, height: 1700, cursor: 'never'}});
  Object.assign(proof.capture.observed_frame, {width: 3024, height: 1700, video_width: 3024, video_height: 1700});
  assert.equal(validateBrowserRecordingProof(proof, fixture, 'a'.repeat(64)), proof);
  for (const change of [
    (value) => { delete value.capture.observed_frame; },
    (value) => { value.capture.dimension_source = 'track-settings'; },
    (value) => { value.capture.observed_frame.method = 'getSettings'; },
    (value) => { value.capture.observed_frame.height = 1964; },
    (value) => { value.capture.observed_frame.video_height = 1964; },
    (value) => { value.capture.observed_frame.width = '3024'; },
    (value) => { value.capture.observed_frame.presented_frames = 1; },
  ]) {
    const candidate = structuredClone(proof); change(candidate);
    assert.throws(() => validateBrowserRecordingProof(candidate, fixture, 'a'.repeat(64)), /actual presented decoded video frame/);
  }
});

test('cursor suppression rejects ignored constraints and self-reported hidden cursors', () => {
  assert.ok(validateBrowserRecordingProof(recordingProof(), fixture, 'a'.repeat(64)));
  for (const change of [
    (value) => { delete value.capture.cursor_suppression; },
    (value) => { value.capture.cursor_suppression.method = 'hidden'; },
    (value) => { value.capture.cursor_suppression.apply_result = 'rejected'; },
    (value) => { value.capture.cursor_suppression.requested_cursor = {ideal: 'never'}; },
    (value) => { value.capture.cursor_suppression.applied_cursor = 'motion'; },
    (value) => { value.capture.cursor_suppression.after_cursor = 'motion'; },
    (value) => { value.capture.cursor_suppression.after_frame_cursor = 'motion'; },
    (value) => { value.capture.cursor_suppression.final_cursor = 'motion'; },
    (value) => { value.capture.settled_track_settings.cursor = 'motion'; },
    (value) => { value.capture.pointer_lock = {locked_at_start: true}; },
  ]) {
    const candidate = recordingProof(); change(candidate);
    assert.throws(() => validateBrowserRecordingProof(candidate, fixture, 'a'.repeat(64)), /cursor-never/);
  }
});

test('loopback server rejects remote-origin writes, unlisted paths and stale builds', async () => {
  const output = path.join(temporary, 'server-bundle');
  const result = buildFlipbook(fixture, output, {repositoryRoot: temporary});
  const server = createFlipbookServer(output);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(origin)).status, 200);
    assert.equal((await fetch(`${origin}/build-evidence.json`)).status, 404);
    const body = JSON.stringify({manifest_checksum_sha256: result.build.manifest_checksum_sha256, mime_type: 'video/webm'});
    assert.equal((await fetch(`${origin}/recordings/start`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body})).status, 400);
    assert.equal((await fetch(`${origin}/recordings/start`, {method: 'POST', headers: {'Content-Type': 'application/json', Origin: origin}, body})).status, 201);
    fs.appendFileSync(path.join(output, 'video.css'), '\n/* changed after review */\n');
    assert.equal((await fetch(`${origin}/recordings/start`, {method: 'POST', headers: {'Content-Type': 'application/json', Origin: origin}, body})).status, 400);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('production build separates artifact categories and server reruns its gate', async () => {
  const input = mutate((value) => { value.action_classification = 'episode'; value.episode_workspace = 'maintenance-fixtures/production-layout'; });
  const output = path.join(temporary, input.episode_workspace, 'docs/flipbook-test');
  let calls = 0; const productionPreflight = () => ({checked: ++calls});
  const result = buildFlipbook(input, output, {repositoryRoot: temporary, productionPreflight});
  assert.deepEqual(fs.readdirSync(output), ['index.html', 'vendor']);
  assert.equal(fs.existsSync(path.join(output, 'vendor/PAGE-FLIP-LICENSE')), true);
  assert.equal(fs.existsSync(path.join(temporary, input.episode_workspace, 'script/flipbook-test/vendor/PAGE-FLIP-LICENSE')), false);
  assert.match(result.build_descriptor, /schema\/flipbook-test-build\.json$/);
  assert.equal(fs.existsSync(path.join(temporary, input.episode_workspace, 'script/flipbook-test/browser-runtime.js')), true);
  assert.throws(() => createFlipbookServer(result.build_descriptor, {repositoryRoot: temporary}), /productionPreflight/);
  const server = createFlipbookServer(result.build_descriptor, {repositoryRoot: temporary, productionPreflight});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${origin}/manifest.json`)).status, 200);
    assert.equal((await fetch(`${origin}/recordings/start`, {method: 'POST', headers: {'Content-Type': 'application/json', Origin: origin},
      body: JSON.stringify({manifest_checksum_sha256: result.build.manifest_checksum_sha256})})).status, 201);
    assert.equal(calls, 3);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

const copyPreview = (id) => {
  const manifest = structuredClone(fixture);
  manifest.fixture_provenance = {
    contract_version: 'knowledge-video-maintenance-preview-provenance-v1',
    synthetic: false, narration_kind: 'synthetic-script-test-only',
    image_kind: 'user-requested-independent-copies', production_eligible: false,
    episode_runtime_dependency: false, scope: 'visual-browser-recording-preview-only',
    authorization_sha256: 'a'.repeat(64),
  };
  // Tests use copies of generated stand-ins; no real episode image is read.
  const directory = path.join(fixtureDirectory, id);
  fs.mkdirSync(directory);
  for (const spread of manifest.spreads) {
    const copy = path.join(directory, `${spread.shot_id}.png`);
    fs.copyFileSync(path.join(temporary, spread.image.path), copy);
    spread.image.path = path.relative(temporary, copy).split(path.sep).join('/');
    spread.image_provenance = {kind: 'independent-user-requested-copy',
      copy_checksum_sha256: spread.image.checksum_sha256, white_cat_present: false, generation_claim: 'none'};
  }
  return manifest;
};

test('pointer-lock preview proves the whole temporary lock lifecycle and cannot authorize production', () => {
  const input = copyPreview('pointer-lock-preview');
  const proof = recordingProof(input);
  proof.capture.initial_track_settings = {cursor: 'motion'};
  proof.capture.settled_track_settings = {cursor: 'motion'};
  proof.capture.cursor_suppression = {method: 'pointer-lock', before_cursor: 'motion', after_frame_cursor: 'motion', final_cursor: 'motion'};
  const ended = 7000 + proof.elapsed_ms;
  proof.capture.pointer_lock = {target_id: 'video-stage', api_supported: true, prompt_wait_ms: 6000,
    locked_at_start: true, locked_at_end: true, lost_during_capture: false,
    acquired_at_ms: 1000, capture_started_at_ms: 7000, capture_ended_at_ms: ended, released_at_ms: ended + 1,
    released: true, events: [{type: 'locked', at_ms: 1000}, {type: 'released', at_ms: ended + 1}]};
  assert.equal(validateBrowserRecordingProof(proof, input, 'a'.repeat(64)), proof);
  for (const change of [
    (value) => { delete value.capture.pointer_lock; },
    (value) => { value.capture.pointer_lock.target_id = 'document'; },
    (value) => { value.capture.pointer_lock.locked_at_end = false; },
    (value) => { value.capture.pointer_lock.lost_during_capture = true; },
    (value) => { value.capture.pointer_lock.released = false; },
    (value) => { value.capture.pointer_lock.capture_started_at_ms = 6999; },
    (value) => { value.capture.pointer_lock.capture_ended_at_ms -= 151; },
    (value) => { value.capture.pointer_lock.released_at_ms = ended - 1; },
    (value) => { value.capture.pointer_lock.events.push({type: 'lost', at_ms: 8000}); },
    (value) => { value.capture.pointer_lock.events[0].at_ms += 1; },
    (value) => { value.capture.pointer_lock.events.reverse(); },
    (value) => { value.capture.cursor_suppression.after_frame_cursor = 'never'; },
  ]) {
    const candidate = structuredClone(proof); change(candidate);
    assert.throws(() => validateBrowserRecordingProof(candidate, input, 'a'.repeat(64)), /pointer lock/);
  }
  assert.throws(() => validateBrowserRecordingProof(proof, fixture, 'a'.repeat(64)), /authorized independent-copy maintenance preview/);
  const production = mutate((value) => { value.action_classification = 'episode'; });
  assert.throws(() => validateBrowserRecordingProof(proof, production, 'a'.repeat(64)), /authorized independent-copy maintenance preview/);
});

test('pointer-outside preview requires trusted outside coordinates, a stable second and no reentry', () => {
  const input = copyPreview('pointer-outside-preview');
  const proof = recordingProof(input);
  proof.capture.initial_track_settings = {cursor: 'motion'};
  proof.capture.settled_track_settings = {cursor: 'motion'};
  proof.capture.cursor_suppression = {method: 'pointer-outside', before_cursor: 'motion', after_frame_cursor: 'motion', final_cursor: 'motion'};
  proof.capture.pointer_outside = {target: 'document', settle_ms: 1000, left_at_ms: 1000,
    capture_started_at_ms: 2000, capture_ended_at_ms: 2000 + proof.elapsed_ms, no_reentry: true,
    events: [{type: 'left', source_event: 'pointerleave', at_ms: 1000, is_trusted: true,
      client_x: 1920, client_y: 500, viewport_width: 1920, viewport_height: 1080}]};
  assert.equal(validateBrowserRecordingProof(proof, input, 'a'.repeat(64)), proof);
  for (const change of [
    (value) => { delete value.capture.pointer_outside; },
    (value) => { value.capture.pointer_outside.target = 'video-stage'; },
    (value) => { value.capture.pointer_outside.no_reentry = false; },
    (value) => { value.capture.pointer_outside.events.push({type: 'reentered'}); },
    (value) => { value.capture.pointer_outside.events[0].source_event = 'pointermove'; },
    (value) => { value.capture.pointer_outside.events[0].is_trusted = false; },
    (value) => { value.capture.pointer_outside.events[0].client_x = 1919; },
    (value) => { value.capture.pointer_outside.events[0].viewport_width = 0; },
    (value) => { value.capture.pointer_outside.events[0].at_ms += 1; },
    (value) => { value.capture.pointer_outside.capture_started_at_ms = 1999; },
    (value) => { value.capture.pointer_outside.capture_ended_at_ms = 1999; },
    (value) => { value.capture.pointer_outside.capture_ended_at_ms -= 151; },
    (value) => { value.capture.cursor_suppression.after_frame_cursor = 'never'; },
  ]) {
    const candidate = structuredClone(proof); change(candidate);
    assert.throws(() => validateBrowserRecordingProof(candidate, input, 'a'.repeat(64)), /pointer outside/);
  }
  const mouseLeave = structuredClone(proof);
  mouseLeave.capture.pointer_outside.events[0].source_event = 'mouseleave';
  mouseLeave.capture.pointer_outside.events[0].client_x = -1;
  assert.ok(validateBrowserRecordingProof(mouseLeave, input, 'a'.repeat(64)));
  assert.throws(() => validateBrowserRecordingProof(proof, fixture, 'a'.repeat(64)), /authorized independent-copy maintenance preview/);
  const production = mutate((value) => { value.action_classification = 'episode'; });
  assert.throws(() => validateBrowserRecordingProof(proof, production, 'a'.repeat(64)), /authorized independent-copy maintenance preview/);
});

test('authorized maintenance copies preserve real provenance without claiming generation', () => {
  const input = copyPreview('copied-preview');
  assert.equal(validateFlipbookManifest(input), input);
  const result = buildFlipbook(input, path.join(temporary, 'copied-preview-site'), {repositoryRoot: temporary});
  assert.equal(result.manifest.fixture_provenance.synthetic, false);
  assert.equal(result.manifest.fixture_provenance.production_eligible, false);
  for (const [index, image] of result.build.source_inputs.entries()) {
    assert.equal(image.checksum_sha256, input.spreads[index].image_provenance.copy_checksum_sha256);
    assert.deepEqual(fs.readFileSync(path.join(result.output, image.output)), fs.readFileSync(path.join(temporary, input.spreads[index].image.path)));
  }
  const server = createFlipbookServer(result.output, {repositoryRoot: temporary});
  server.close();
});

test('opening cover keeps its complete source bytes and uses the same independent-copy gates as body images', () => {
  const input = withOpeningCover(copyPreview('cover-preview'));
  const original = path.join(temporary, input.opening_cover.image.path);
  const source = path.join(path.dirname(original), 'opening-cover.png');
  fs.copyFileSync(original, source);
  input.opening_cover.image.path = path.relative(temporary, source).split(path.sep).join('/');
  const result = buildFlipbook(input, path.join(temporary, 'cover-preview-site'), {repositoryRoot: temporary});
  const html = fs.readFileSync(path.join(result.output, 'index.html'), 'utf8');
  assert.equal((html.match(/class="book-page /g) ?? []).length, 8);
  assert.equal((html.match(/data-density="hard"/g) ?? []).length, 2);
  assert.equal(result.build.source_inputs.length, 4);
  const cover = result.build.source_inputs.find((image) => image.output === 'assets/images/opening-cover.png');
  assert.equal(cover.checksum_sha256, input.opening_cover.image.checksum_sha256);
  assert.deepEqual(fs.readFileSync(path.join(result.output, cover.output)), fs.readFileSync(source));
  for (const [index, change] of [
    (value) => { value.opening_cover.image.width = 1536; value.opening_cover.image.height = 864; },
    (value) => { value.opening_cover.image.checksum_sha256 = 'b'.repeat(64); },
    (value) => { value.opening_cover.image.path = 'outside-fixtures/cover.png'; },
  ].entries()) {
    const candidate = structuredClone(input); change(candidate);
    assert.throws(() => buildFlipbook(candidate, path.join(temporary, `cover-invalid-${index}`), {repositoryRoot: temporary}), /dimensions|checksum|fixtures/);
  }
  const linked = path.join(path.dirname(source), 'cover-hard-link.png');
  fs.linkSync(source, linked);
  assert.throws(() => buildFlipbook(input, path.join(temporary, 'cover-hard-link-site'), {repositoryRoot: temporary}), /without hard links/);
  fs.unlinkSync(linked);
  fs.appendFileSync(path.join(result.output, cover.output), 'changed');
  assert.throws(() => createFlipbookServer(result.output, {repositoryRoot: temporary}), /checksum/);
});

test('independent-copy preview rejects false synthetic claims, stale authorization and production promotion', () => {
  const input = copyPreview('copy-invalid-provenance');
  for (const change of [
    (value) => { value.fixture_provenance.synthetic = true; },
    (value) => { delete value.fixture_provenance.authorization_sha256; },
    (value) => { value.fixture_provenance.episode_data_used = false; },
    (value) => { value.fixture_provenance.production_eligible = true; },
    (value) => { value.action_classification = 'episode'; },
    (value) => { value.spreads[0].image_provenance.generation_claim = 'imagegen'; },
    (value) => { value.spreads[0].image_provenance.copy_checksum_sha256 = 'b'.repeat(64); },
    (value) => { value.spreads[0].white_cat_present = true; value.spreads[0].image_provenance.white_cat_present = true; },
    (value) => { value.spreads[0].image_provenance.source_path = 'original-image.png'; },
    (value) => { value.spreads[0].image.path = 'outside-fixture/copied.png'; },
  ]) {
    const candidate = structuredClone(input); change(candidate);
    assert.throws(() => validateFlipbookManifest(candidate), /independent|preview/);
  }
});

test('independent-copy preview rejects source hard links and changed output copies', () => {
  const input = copyPreview('copy-links');
  const source = path.join(temporary, input.spreads[0].image.path);
  const linked = path.join(path.dirname(source), 'hard-link.png');
  fs.linkSync(source, linked);
  assert.throws(() => buildFlipbook(input, path.join(temporary, 'copy-hard-link-site'), {repositoryRoot: temporary}), /without hard links/);
  fs.unlinkSync(linked);
  const result = buildFlipbook(input, path.join(temporary, 'copy-byte-check-site'), {repositoryRoot: temporary});
  fs.appendFileSync(path.join(result.output, result.build.source_inputs[0].output), 'changed');
  assert.throws(() => createFlipbookServer(result.output, {repositoryRoot: temporary}), /checksum/);
});
