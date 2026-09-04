import crypto from 'node:crypto';

export const FLIPBOOK_VERSION = 'knowledge-video-flipbook-v1';
export const FLIPBOOK_MODE = 'illustrated-flipbook';
export const FLIPBOOK_STATIC_VERSION = 'knowledge-video-static-spread-v1';
export const FLIPBOOK_TURN_KIND = 'book-page-turn';
export const FLIPBOOK_RENDERER = 'leverage-video/src/shared/flipbook-video/browser-runtime.js';
export const RECORDING_VERSION = 'knowledge-video-browser-recording-v1';
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const fail = (message) => { throw new Error(message); };
const integer = (value) => Number.isInteger(value) && value >= 0;
const checksum = (value) => /^[a-f0-9]{64}$/.test(value ?? '');
const validateLandscapeImage = (image, label) => {
  if (typeof image?.path !== 'string' || !image.path || !checksum(image.checksum_sha256)
    || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.height < 1 || image.width <= image.height
    || Math.abs((image.width / image.height) / (16 / 9) - 1) > 0.005) fail(`${label}: exact landscape 16:9 image binding required`);
};

export const MAINTENANCE_PREVIEW_PROVENANCE_VERSION = 'knowledge-video-maintenance-preview-provenance-v1';
export const isIndependentCopyPreview = (manifest) => manifest?.fixture_provenance?.contract_version
  === MAINTENANCE_PREVIEW_PROVENANCE_VERSION;

const validateMaintenanceProvenance = (manifest) => {
  const provenance = manifest.fixture_provenance;
  const copyClaim = isIndependentCopyPreview(manifest)
    || provenance?.synthetic === false
    || provenance?.image_kind === 'user-requested-independent-copies'
    || manifest.spreads?.some((spread) => spread.image_provenance !== undefined);
  if (!copyClaim) return;
  if (manifest.action_classification !== 'project_maintenance'
    || !isIndependentCopyPreview(manifest)
    || provenance.synthetic !== false
    || provenance.narration_kind !== 'synthetic-script-test-only'
    || provenance.image_kind !== 'user-requested-independent-copies'
    || provenance.production_eligible !== false
    || provenance.episode_runtime_dependency !== false
    || provenance.scope !== 'visual-browser-recording-preview-only'
    || !checksum(provenance.authorization_sha256)
    || manifest.episode_workspace !== undefined) fail('independent-copy preview requires explicit maintenance-only provenance');
  const allowed = new Set(['contract_version', 'synthetic', 'narration_kind', 'image_kind', 'production_eligible',
    'episode_runtime_dependency', 'scope', 'authorization_sha256', 'audio_kind', 'system_voice']);
  if (Object.keys(provenance).some((key) => !allowed.has(key))) fail('independent-copy provenance must not claim synthetic images or retain original source references');
  const prefix = 'leverage-video/src/shared/flipbook-video/fixtures/';
  for (const input of [manifest.narration?.path, ...(manifest.spreads ?? []).map((spread) => spread.image?.path),
    ...(manifest.opening_cover ? [manifest.opening_cover.image?.path] : [])]) {
    if (typeof input !== 'string' || !input.startsWith(prefix) || input.split('/').some((part) => part === '..' || !part)) {
      fail('independent-copy preview inputs must stay within dedicated maintenance fixtures');
    }
  }
  for (const spread of manifest.spreads ?? []) {
    const image = spread.image_provenance;
    if (!image || Object.keys(image).sort().join(',') !== 'copy_checksum_sha256,generation_claim,kind,white_cat_present'
      || image.kind !== 'independent-user-requested-copy'
      || image.copy_checksum_sha256 !== spread.image?.checksum_sha256
      || image.white_cat_present !== false || spread.white_cat_present !== false
      || image.generation_claim !== 'none') fail(`${spread.shot_id}: independent image copy provenance is missing or stale`);
  }
};

export const deriveImageSide = (seed, shotId) => {
  if (typeof seed !== 'string' || seed.length < 8) fail('layout_seed must contain at least eight characters');
  return parseInt(sha(`${seed}\0${shotId}`).slice(0, 2), 16) % 2 ? 'right' : 'left';
};

export const exactRevealText = (spread, reveal) => {
  const bytes = Buffer.from(spread.static_spread.source_text, 'utf8');
  const selected = bytes.subarray(reveal.source_start_byte, reveal.source_end_byte);
  const text = new TextDecoder('utf-8', {fatal: true}).decode(selected);
  if (!text.length) fail(`${spread.shot_id}: empty narration reveal`);
  return text;
};

export const validateFlipbookManifest = (manifest) => {
  if (manifest?.contract_version !== FLIPBOOK_VERSION
    || manifest.style_id !== FLIPBOOK_MODE || manifest.presentation_mode !== FLIPBOOK_MODE) {
    fail('explicit illustrated-flipbook contract required');
  }
  validateMaintenanceProvenance(manifest);
  if (manifest.canvas?.width !== 1920 || manifest.canvas?.height !== 1080 || manifest.canvas?.fps !== 30) {
    fail('flipbook canvas must be 1920x1080 at 30 fps');
  }
  if (!Array.isArray(manifest.spreads) || manifest.spreads.length === 0) fail('at least one spread required');
  if (!integer(manifest.total_frames) || manifest.total_frames < 1) fail('positive total_frames required');
  if (!checksum(manifest.narration?.checksum_sha256) || typeof manifest.narration?.path !== 'string') {
    fail('locked narration binding required');
  }
  const cover = manifest.opening_cover;
  if (cover !== undefined) {
    if (cover?.hold_frames !== 24 || cover?.open_frames !== 30) fail('opening cover requires a 24-frame hold and a 30-frame real page opening');
    validateLandscapeImage(cover.image, 'opening cover');
  }
  const narrationStartFrame = cover ? cover.hold_frames + cover.open_frames : 0;
  let expectedFrame = narrationStartFrame;
  const ids = new Set();
  const turns = new Set();
  for (const [index, spread] of manifest.spreads.entries()) {
    if (!/^S\d{2,}$/.test(spread.shot_id ?? '') || ids.has(spread.shot_id)
      || (index === 0 && spread.shot_id !== 'S01')) fail('unique ordered shot IDs beginning with S01 required');
    ids.add(spread.shot_id);
    if (!['ian-handdrawn-ppt', 'imagegen'].includes(spread.visual_generation_route)
      || spread.white_cat_present !== false) fail(`${spread.shot_id}: only no-cat Ian or ImageGen is allowed`);
    if (typeof spread.scene_class !== 'string' || !spread.scene_class) fail(`${spread.shot_id}: real scene_class required`);
    if (spread.start_frame !== expectedFrame || !integer(spread.duration_frames) || spread.duration_frames < 1) {
      fail(`${spread.shot_id}: contiguous exact shot frames required`);
    }
    expectedFrame += spread.duration_frames;
    validateLandscapeImage(spread.image, spread.shot_id);
    const body = spread.static_spread;
    if (body?.contract_version !== FLIPBOOK_STATIC_VERSION || typeof body.source_text !== 'string'
      || body.source_text.length === 0 || sha(body.source_text) !== body.source_text_sha256) {
      fail(`${spread.shot_id}: static spread exact narration checksum is stale`);
    }
    const side = deriveImageSide(manifest.layout_seed, spread.shot_id);
    if (spread.image_side !== side || spread.text_side !== (side === 'left' ? 'right' : 'left')) {
      fail(`${spread.shot_id}: persisted layout does not match its seed`);
    }
    if (!Array.isArray(spread.text_reveals) || spread.text_reveals.length === 0) fail(`${spread.shot_id}: real audio text timing required`);
    let endByte = 0;
    let lastStart = spread.start_frame;
    let lastEnd = spread.start_frame;
    const revealIds = new Set();
    for (const reveal of spread.text_reveals) {
      if (typeof reveal.id !== 'string' || !reveal.id || revealIds.has(reveal.id)) fail(`${spread.shot_id}: unique reveal IDs required`);
      revealIds.add(reveal.id);
      if (reveal.source_start_byte !== endByte || !integer(reveal.source_end_byte)
        || reveal.source_end_byte <= endByte) fail(`${spread.shot_id}: narration UTF-8 coverage is not contiguous`);
      endByte = reveal.source_end_byte;
      if (!integer(reveal.start_frame) || !integer(reveal.end_frame) || reveal.start_frame < lastStart
        || reveal.end_frame < reveal.start_frame || reveal.start_frame < spread.start_frame
        || reveal.end_frame > expectedFrame) fail(`${spread.shot_id}: invalid real audio reveal frames`);
      exactRevealText(spread, reveal);
      lastStart = reveal.start_frame;
      lastEnd = Math.max(lastEnd, reveal.end_frame);
    }
    if (endByte !== Buffer.byteLength(body.source_text)) fail(`${spread.shot_id}: narration must be covered exactly once`);
    if (index === 0 && spread.text_reveals[0].start_frame !== narrationStartFrame) {
      fail(cover ? 'S01 narration text must start when the opening cover completes at frame 54' : 'S01 narration text must start at frame zero');
    }
    const turn = spread.transition_out;
    if (index === manifest.spreads.length - 1) {
      if (turn != null) fail('terminal clean hold must have no outgoing turn');
    } else {
      if (turn?.kind !== FLIPBOOK_TURN_KIND || turn.renderer !== FLIPBOOK_RENDERER
        || !Number.isInteger(turn.duration_in_frames) || turn.duration_in_frames < 9 || turn.duration_in_frames > 18
        || turn.start_frame !== expectedFrame - turn.duration_in_frames) fail(`${spread.shot_id}: real 0.3–0.6 second page turn required`);
      if (lastEnd > turn.start_frame) fail(`${spread.shot_id}: complete text must appear before page turn`);
      if (!['approved', 'policy_authorized'].includes(turn.user_selection?.status)
        || !checksum(turn.user_selection?.presented_map_sha256)) fail(`${spread.shot_id}: exact approved page turn binding required`);
      turns.add(turn.duration_in_frames);
    }
  }
  if (turns.size > 1) fail('one browser runtime requires one approved page-turn duration');
  if (expectedFrame !== manifest.total_frames) fail('total frames differ from the locked shot timeline');
  return manifest;
};

export const createFlipbookManifest = (input) => {
  const manifest = structuredClone(input);
  manifest.layout_seed ??= crypto.randomBytes(16).toString('hex');
  manifest.spreads = manifest.spreads.map((spread) => {
    const imageSide = deriveImageSide(manifest.layout_seed, spread.shot_id);
    return {...spread, image_side: spread.image_side ?? imageSide,
      text_side: spread.text_side ?? (imageSide === 'left' ? 'right' : 'left')};
  });
  return validateFlipbookManifest(manifest);
};

const validateCaptureCursor = (proof, manifest) => {
  const capture = proof.capture;
  const cursor = capture.cursor_suppression;
  if (cursor?.method === 'pointer-outside') {
    if (manifest.action_classification !== 'project_maintenance' || !isIndependentCopyPreview(manifest)) {
      fail('pointer outside is allowed only for an authorized independent-copy maintenance preview');
    }
    const outside = capture.pointer_outside;
    const left = outside?.events?.[0];
    if (outside?.target !== 'document' || outside.settle_ms !== 1000 || outside.no_reentry !== true
      || !Array.isArray(outside.events) || outside.events.length !== 1 || left?.type !== 'left'
      || !['pointerleave', 'mouseleave'].includes(left.source_event) || left.is_trusted !== true
      || left.at_ms !== outside.left_at_ms) fail('pointer outside requires one trusted document leave and no reentry');
    if (!Number.isInteger(left.viewport_width) || left.viewport_width <= 0
      || !Number.isInteger(left.viewport_height) || left.viewport_height <= 0
      || !Number.isFinite(left.client_x) || !Number.isFinite(left.client_y)
      || !(left.client_x < 0 || left.client_y < 0 || left.client_x >= left.viewport_width || left.client_y >= left.viewport_height)) {
      fail('pointer outside leave coordinates must be outside the measured viewport');
    }
    if ([outside.left_at_ms, outside.capture_started_at_ms, outside.capture_ended_at_ms].some((value) => !Number.isFinite(value) || value < 0)
      || outside.capture_started_at_ms - outside.left_at_ms < outside.settle_ms
      || outside.capture_ended_at_ms <= outside.capture_started_at_ms
      || Math.abs(outside.capture_ended_at_ms - outside.capture_started_at_ms - proof.elapsed_ms) > 150) {
      fail('pointer outside must remain stable for one second and cover the complete recording');
    }
    if ([cursor.before_cursor, cursor.after_frame_cursor, cursor.final_cursor].some((value) => !['always', 'motion', 'never'].includes(value))
      || capture.initial_track_settings?.cursor !== cursor.before_cursor
      || capture.settled_track_settings?.cursor !== cursor.after_frame_cursor) {
      fail('pointer outside must retain truthful measured browser cursor settings');
    }
    return;
  }
  if (cursor?.method === 'pointer-lock') {
    if (manifest.action_classification !== 'project_maintenance' || !isIndependentCopyPreview(manifest)) {
      fail('pointer lock is allowed only for an authorized independent-copy maintenance preview');
    }
    const lock = capture.pointer_lock;
    if (lock?.target_id !== 'video-stage' || lock.api_supported !== true || lock.prompt_wait_ms !== 6000
      || lock.locked_at_start !== true || lock.locked_at_end !== true || lock.lost_during_capture !== false
      || lock.released !== true) fail('pointer lock requires a complete acquired, uninterrupted and released lifecycle');
    const times = [lock.acquired_at_ms, lock.capture_started_at_ms, lock.capture_ended_at_ms, lock.released_at_ms];
    if (times.some((value) => !Number.isFinite(value) || value < 0)
      || lock.capture_started_at_ms - lock.acquired_at_ms < lock.prompt_wait_ms
      || lock.capture_ended_at_ms <= lock.capture_started_at_ms || lock.released_at_ms < lock.capture_ended_at_ms
      || Math.abs(lock.capture_ended_at_ms - lock.capture_started_at_ms - proof.elapsed_ms) > 150) {
      fail('pointer lock lifecycle must cover the full recording after its six-second escape notice');
    }
    if (!Array.isArray(lock.events) || lock.events.length !== 2
      || lock.events[0]?.type !== 'locked' || lock.events[0].at_ms !== lock.acquired_at_ms
      || lock.events[1]?.type !== 'released' || lock.events[1].at_ms !== lock.released_at_ms) {
      fail('pointer lock requires exact ordered acquisition and release events without loss');
    }
    if ([cursor.before_cursor, cursor.after_frame_cursor, cursor.final_cursor].some((value) => !['always', 'motion', 'never'].includes(value))
      || capture.initial_track_settings?.cursor !== cursor.before_cursor
      || capture.settled_track_settings?.cursor !== cursor.after_frame_cursor) {
      fail('pointer lock must retain truthful measured browser cursor settings');
    }
    return;
  }
  if (cursor?.method !== 'cursor-never' || cursor.apply_result !== 'resolved' || cursor.cursor_suppressed !== true
    || cursor.requested_cursor?.exact !== 'never' || cursor.applied_cursor?.exact !== 'never'
    || cursor.after_cursor !== 'never' || cursor.after_frame_cursor !== 'never' || cursor.final_cursor !== 'never'
    || capture.settled_track_settings?.cursor !== 'never' || cursor.error !== undefined || capture.pointer_lock !== undefined) {
    fail('cursor-never capture requires a resolved exact constraint and measured never settings throughout recording');
  }
};

export const validateBrowserRecordingProof = (proof, manifest, manifestChecksum) => {
  validateFlipbookManifest(manifest);
  if (proof?.contract_version !== RECORDING_VERSION || proof.manifest_checksum_sha256 !== manifestChecksum) {
    fail('browser recording proof is bound to a stale manifest');
  }
  if (proof.capture?.display_surface !== 'browser' || proof.capture.current_tab_verified !== true
    || proof.capture.visibility_state !== 'visible') fail('visible current browser-tab capture required');
  const {width, height, frame_rate: frameRate} = proof.capture;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1920 || height < 1080
    || Math.abs((width / height) / (16 / 9) - 1) > 0.005
    || !Number.isFinite(frameRate) || frameRate < 29.9 || frameRate > 30.1) {
    fail('measured browser capture must be at least 1920x1080, 16:9 within 0.5%, and 30 fps within 0.1 fps');
  }
  const observed = proof.capture.observed_frame;
  if (proof.capture.dimension_source !== 'decoded-video-frame'
    || observed?.method !== 'HTMLVideoElement.requestVideoFrameCallback'
    || observed.width !== width || observed.height !== height
    || observed.video_width !== width || observed.video_height !== height
    || !Number.isInteger(observed.presented_frames) || observed.presented_frames < 2) {
    fail('capture dimensions must match an actual presented decoded video frame and its video element');
  }
  validateCaptureCursor(proof, manifest);
  if (proof.all_images_decoded !== true || proof.fonts_ready !== true || proof.ui_hidden !== true
    || proof.errors?.length !== 0) fail('browser readiness or clean recording evidence failed');
  if (!Array.isArray(proof.layout_checks) || proof.layout_checks.length !== manifest.spreads.length
    || proof.layout_checks.some((row, i) => row.shot_id !== manifest.spreads[i].shot_id
      || row.text_fits !== true || row.image_contained !== true || row.stable_layout !== true
      || row.source_text_matches !== true || row.text !== manifest.spreads[i].static_spread.source_text)) {
    fail('every spread requires measured text, image and stable layout evidence');
  }
  const cover = manifest.opening_cover;
  if (cover) {
    const measured = proof.cover_layout_check;
    if (measured?.engine_page_index !== 0 || measured.fit !== 'contain' || measured.image_contained !== true || measured.centered !== true
      || !Number.isFinite(measured.center_offset_x_px) || Math.abs(measured.center_offset_x_px) > 0.5
      || measured.natural_width_px !== cover.image.width || measured.natural_height_px !== cover.image.height) {
      fail('opening cover requires measured centered contain layout and exact natural image dimensions');
    }
    for (const [index, layout] of proof.layout_checks.entries()) {
      if (layout.engine_page_index !== index * 2 + 1) fail('measured body engine page indexes must follow the real cover book order 1, 3, 5');
    }
  }
  const openingEvents = proof.events?.filter((event) => ['cover-hold', 'cover-open', 'renderer-cover-open-complete', 'camera-settle'].includes(event.type));
  if (cover) {
    const expectedOpening = [{type: 'cover-hold', frame: 0}, {type: 'cover-open', frame: cover.hold_frames},
      {type: 'renderer-cover-open-complete', frame: cover.hold_frames + cover.open_frames},
      {type: 'camera-settle', frame: cover.hold_frames + cover.open_frames}];
    if (!Array.isArray(openingEvents) || openingEvents.length !== expectedOpening.length) fail('complete real opening-cover event evidence required');
    for (const event of expectedOpening) {
      const matches = openingEvents.filter((row) => row.type === event.type);
      if (matches.length !== 1 || matches[0].expected_frame !== event.frame
        || !Number.isFinite(matches[0].actual_ms) || Math.abs(matches[0].actual_ms - event.frame / 30 * 1000) > 100) {
        fail('opening-cover event is missing, duplicated or differs from its approved frame by more than 100 ms');
      }
    }
    const complete = openingEvents.find((event) => event.type === 'renderer-cover-open-complete');
    const hold = openingEvents.find((event) => event.type === 'cover-hold');
    const open = openingEvents.find((event) => event.type === 'cover-open');
    const settled = openingEvents.find((event) => event.type === 'camera-settle');
    if (hold.page !== 0 || !Number.isFinite(hold.scale) || hold.scale <= 1
      || !Number.isFinite(hold.translate_x) || open.duration_in_frames !== cover.open_frames
      || open.actual_ms <= hold.actual_ms || complete.actual_ms <= open.actual_ms) {
      fail('opening cover must begin centered in close-up and perform its real approved page opening in order');
    }
    if (complete.page !== proof.layout_checks[0].engine_page_index) fail('opening cover did not complete on the measured first spread');
    if (!Number.isFinite(settled.scale) || Math.abs(settled.scale - 1) > 0.001
      || !Number.isFinite(settled.translate_x) || Math.abs(settled.translate_x) > 0.5) fail('opening camera must settle to measured scale one and centered translation');
  } else if (proof.cover_layout_check !== undefined || openingEvents?.length) {
    fail('cover evidence requires an explicitly selected opening cover');
  }
  const expected = manifest.spreads.flatMap((spread) => [
    ...spread.text_reveals.map((reveal) => ({type: 'text-reveal', shot_id: spread.shot_id, id: reveal.id, frame: reveal.start_frame})),
    ...(spread.transition_out ? [{type: 'page-turn', shot_id: spread.shot_id, frame: spread.transition_out.start_frame}] : []),
  ]);
  const actual = proof.events?.filter((event) => ['text-reveal', 'page-turn'].includes(event.type));
  if (!Array.isArray(actual) || actual.length !== expected.length) fail('recording event coverage differs from the timeline');
  for (const event of expected) {
    const matches = actual.filter((row) => row.type === event.type && row.shot_id === event.shot_id && row.id === event.id);
    if (matches.length !== 1 || matches[0].expected_frame !== event.frame
      || !Number.isFinite(matches[0].actual_ms) || Math.abs(matches[0].actual_ms - event.frame / 30 * 1000) > 100) {
      fail('recorded text or page-turn event is missing, duplicated, or more than 100 ms late');
    }
  }
  if (proof.total_frames !== manifest.total_frames || !Number.isFinite(proof.elapsed_ms)
    || Math.abs(proof.elapsed_ms - manifest.total_frames / 30 * 1000) > 150) fail('recorded duration drift exceeds 150 ms');
  const realTurns = proof.events.filter((event) => event.type === 'renderer-turn-complete');
  if (realTurns.length !== manifest.spreads.length - 1) fail('actual renderer page turns were not observed');
  for (const [index, turn] of realTurns.entries()) {
    const nextSpread = manifest.spreads[index + 1];
    const expectedPage = cover ? proof.layout_checks[index + 1].engine_page_index : (index + 1) * 2;
    if (turn.page !== expectedPage || !Number.isFinite(turn.actual_ms)
      || Math.abs(turn.actual_ms - nextSpread.start_frame / 30 * 1000) > 100
      || (index > 0 && turn.actual_ms <= realTurns[index - 1].actual_ms)) {
      fail('actual renderer page completion must be unique, ordered and within 100 ms of the next spread');
    }
  }
  return proof;
};
