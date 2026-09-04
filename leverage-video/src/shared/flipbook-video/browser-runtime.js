// Vanilla browser entry for the approved, audio-timed knowledge-video branch.
import {negotiateCursorSuppression, requestDiagnosticStream} from './cursor-capture.mjs';
import {createPointerLockCapture} from './pointer-lock-capture.mjs';
import {createPointerOutsideCapture} from './pointer-outside-capture.mjs';
const status = document.querySelector('#recording-status');
const startButton = document.querySelector('#start-recording');
const stage = document.querySelector('#video-stage');
const camera = document.querySelector('#book-camera');
const book = document.querySelector('#book');
const manifestBytes = await (await fetch('manifest.json', {cache: 'no-store'})).arrayBuffer();
const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
const pointerLockPreview = document.body.dataset.captureMethod === 'pointer-lock';
const pointerOutsidePreview = document.body.dataset.captureMethod === 'pointer-outside';
if ((pointerLockPreview || pointerOutsidePreview) && manifest.action_classification !== 'project_maintenance') throw new Error('临时光标处理仅适用于明确启用的本地维护样片');
const digest = await crypto.subtle.digest('SHA-256', manifestBytes);
const manifestChecksum = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
const captureHandle = `flipbook-${crypto.randomUUID()}`;
const opening = manifest.opening_cover;
const openingFrames = opening ? opening.hold_frames + opening.open_frames : 0;
const nearScale = 1.35;
let closedTranslation = 0;
let openingStarted = false;
const turnFrames = manifest.spreads.find((spread) => spread.transition_out)?.transition_out.duration_in_frames ?? 15;
const pageFlip = new St.PageFlip(book, {width: 820, height: 462, size: 'fixed', drawShadow: true,
  flippingTime: turnFrames / 30 * 1000, usePortrait: false, startZIndex: 10, autoSize: false,
  maxShadowOpacity: 0.42, showCover: Boolean(opening), mobileScrollSupport: false, clickEventForward: false,
  useMouseEvents: false, showPageCorners: false, disableFlipByClick: true});
let recording = false;
let epoch = 0;
let events = [];
let errors = [];
let state = 'read';
let completedTurns = 0;
let pendingTurn = null;
const elapsed = () => performance.now() - epoch;
pageFlip.on('changeState', (event) => {
  state = event.data;
  if (recording) events.push({type: 'renderer-state', value: state, actual_ms: elapsed()});
  if (recording && state === 'read' && pendingTurn) {
    if (pendingTurn.type === 'page-turn') completedTurns += 1;
    events.push({type: pendingTurn.type === 'cover-open' ? 'renderer-cover-open-complete' : 'renderer-turn-complete',
      page: pageFlip.getCurrentPageIndex(), expected_frame: pendingTurn.end_frame, actual_ms: elapsed()});
    pendingTurn = null;
  }
});
pageFlip.on('flip', (event) => { if (recording) events.push({type: 'renderer-flip', page: event.data, actual_ms: elapsed()}); });
pageFlip.loadFromHTML(book.querySelectorAll('.book-page'));
const resize = () => {
  const scale = Math.min(innerWidth / 1920, innerHeight / 1080);
  stage.style.transform = `translate(${(innerWidth - 1920 * scale) / 2}px,${(innerHeight - 1080 * scale) / 2}px) scale(${scale})`;
};
addEventListener('resize', () => { resize(); if (recording) errors.push('viewport changed while recording'); });
document.addEventListener('visibilitychange', () => { if (recording && document.visibilityState !== 'visible') errors.push('browser tab became hidden'); });
resize();
await document.fonts.ready;
await Promise.all([...book.querySelectorAll('img')].map((image) => image.decode()));
if (navigator.mediaDevices?.setCaptureHandleConfig) {
  navigator.mediaDevices.setCaptureHandleConfig({handle: captureHandle, exposeOrigin: true, permittedOrigins: [location.origin]});
}
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const cameraTransform = (scale, translateX) => { camera.style.transform = `translateX(${translateX}px) scale(${scale})`; };
const measureCamera = () => {
  const transform = new DOMMatrixReadOnly(getComputedStyle(camera).transform);
  return {scale: transform.a, translate_x: transform.e};
};
const collectLayout = async () => {
  const checks = [];
  cameraTransform(1, 0);
  for (const [index, spread] of manifest.spreads.entries()) {
    pageFlip.turnToPage(index * 2 + (opening ? 1 : 0));
    await nextFrame();
    const textPage = book.querySelector(`.text-page[data-shot-id="${spread.shot_id}"]`);
    const body = textPage.querySelector('.body-copy');
    const spans = [...body.querySelectorAll('.reveal')];
    const positions = spans.map((span) => ({left: span.offsetLeft, top: span.offsetTop - parseFloat(getComputedStyle(span).top), width: span.offsetWidth, height: span.offsetHeight}));
    for (const span of spans) span.classList.add('is-visible');
    await nextFrame();
    const stable = spans.every((span, i) => positions[i].left === span.offsetLeft && Math.abs(positions[i].top - (span.offsetTop - parseFloat(getComputedStyle(span).top))) < 1
      && positions[i].width === span.offsetWidth && positions[i].height === span.offsetHeight);
    for (const span of spans) span.classList.remove('is-visible');
    const image = book.querySelector(`.image-page[data-shot-id="${spread.shot_id}"] img`);
    checks.push({shot_id: spread.shot_id, text_fits: body.scrollHeight <= body.clientHeight && body.scrollWidth <= body.clientWidth,
      stable_layout: stable, image_contained: getComputedStyle(image).objectFit === 'contain' && image.naturalWidth === spread.image.width && image.naturalHeight === spread.image.height,
      engine_page_index: pageFlip.getCurrentPageIndex(), body_width_px: body.clientWidth, body_height_px: body.clientHeight,
      image_display_width_px: image.clientWidth, image_display_height_px: image.clientHeight,
      text: body.textContent, source_text_matches: body.textContent === spread.static_spread.source_text});
  }
  pageFlip.turnToPage(0);
  await nextFrame();
  return checks;
};
const layoutChecks = await collectLayout();
let coverLayoutCheck;
if (opening) {
  const cover = book.querySelector('.cover-page');
  const image = cover.querySelector('img');
  const stageRect = stage.getBoundingClientRect();
  const coverRect = cover.getBoundingClientRect();
  const stageScale = stageRect.width / 1920;
  closedTranslation = (stageRect.left + stageRect.width / 2 - coverRect.left - coverRect.width / 2) / stageScale * nearScale;
  cameraTransform(nearScale, closedTranslation);
  await nextFrame();
  const centeredRect = cover.getBoundingClientRect();
  const centerOffset = (centeredRect.left + centeredRect.width / 2 - stageRect.left - stageRect.width / 2) / stageScale;
  coverLayoutCheck = {engine_page_index: pageFlip.getCurrentPageIndex(), fit: getComputedStyle(image).objectFit,
    image_contained: getComputedStyle(image).objectFit === 'contain' && image.clientWidth <= image.parentElement.clientWidth && image.clientHeight <= image.parentElement.clientHeight,
    natural_width_px: image.naturalWidth, natural_height_px: image.naturalHeight,
    centered: Math.abs(centerOffset) <= 0.5, center_offset_x_px: centerOffset};
  if (!coverLayoutCheck.image_contained || !coverLayoutCheck.centered
    || image.naturalWidth !== opening.image.width || image.naturalHeight !== opening.image.height) {
    status.textContent = '封面尺寸、完整显示或居中校验失败';
    throw new Error(status.textContent);
  }
}
const badLayout = layoutChecks.find((check) => !check.text_fits || !check.stable_layout || !check.image_contained || !check.source_text_matches);
if (badLayout) {
  status.textContent = `${badLayout.shot_id} 排版或原文校验失败；须拆分镜头或修复素材。`;
  throw new Error(status.textContent);
}
window.flipbookVideo = {manifestChecksum, manifest, layoutChecks, coverLayoutCheck,
  getState: () => ({state, recording, completedTurns, events, errors, engine_page_index: pageFlip.getCurrentPageIndex(), camera: measureCamera()})};
status.textContent = '页面已就绪；将仅接受当前浏览器标签页';
startButton.disabled = false;

const cursorButton = document.querySelector('#inspect-cursor-capture');
const cursorOutput = document.querySelector('#capture-diagnostics');
const publishCursorDiagnostics = (diagnostics) => {
  window.flipbookVideo.cursorDiagnostics = diagnostics;
  cursorOutput.hidden = false;
  cursorOutput.textContent = JSON.stringify(diagnostics, null, 2);
};
let pointerCapture = null;
const pointerApiAvailable = typeof stage.requestPointerLock === 'function' && typeof document.exitPointerLock === 'function';
const browserInteractionContext = () => ({document_has_focus: document.hasFocus(), visibility_state: document.visibilityState,
  user_activation_active: navigator.userActivation?.isActive ?? null, user_activation_has_been_active: navigator.userActivation?.hasBeenActive ?? null,
  active_element_id: document.activeElement?.id ?? null, active_element_tag: document.activeElement?.tagName ?? null,
  pointer_lock_element_id: document.pointerLockElement?.id ?? null});
const armPointerCapture = async (event) => {
  cursorButton.disabled = true; startButton.disabled = true;
  const lock = createPointerLockCapture({document, element: stage});
  lock.evidence.request_context = {...browserInteractionContext(), button_click_trusted: event.isTrusted};
  pointerCapture = lock;
  lock.signal.addEventListener('abort', () => {
    status.textContent = lock.signal.reason.message;
    startButton.disabled = true;
    void lock.release().then(() => {
      if (pointerCapture === lock) pointerCapture = null;
      cursorButton.disabled = !pointerApiAvailable;
      publishCursorDiagnostics({method: 'pointer-lock', phase: 'cancelled', pointer_lock: lock.evidence});
    }, (error) => { status.textContent = error.message; });
  }, {once: true});
  try {
    publishCursorDiagnostics({method: 'pointer-lock', phase: 'requesting-pointer-lock', pointer_lock: lock.evidence});
    await lock.acquire();
    status.textContent = '鼠标已锁定；等待 6 秒使浏览器提示消失。Esc 可立即取消。';
    publishCursorDiagnostics({method: 'pointer-lock', phase: 'waiting-for-browser-prompt', pointer_lock: lock.evidence});
    await lock.waitForPrompt();
    lock.assertLocked();
    startButton.disabled = false;
    startButton.focus({preventScroll: true});
    if (document.activeElement !== startButton) throw new Error('未能聚焦第二步录制按钮');
    status.textContent = '请按 Enter，开始共享当前标签页并录制；Esc 可取消。';
    publishCursorDiagnostics({method: 'pointer-lock', phase: 'ready-for-enter', second_step_focused: document.activeElement === startButton, pointer_lock: lock.evidence});
  } catch (error) {
    status.textContent = `指针锁定未就绪：${error.message}`;
    try { await lock.release(); } catch (releaseError) { status.textContent = releaseError.message; }
    if (pointerCapture === lock) pointerCapture = null;
    cursorButton.disabled = !pointerApiAvailable; startButton.disabled = true;
    publishCursorDiagnostics({method: 'pointer-lock', phase: 'cancelled', error: {name: error.name, message: error.message}, pointer_lock: lock.evidence});
  }
};
cursorButton.disabled = false;
if (pointerLockPreview) {
  cursorButton.textContent = '锁定鼠标（Esc 取消）';
  startButton.textContent = '开始共享并录制（Enter）';
  cursorButton.disabled = !pointerApiAvailable; startButton.disabled = true;
  status.textContent = pointerApiAvailable ? '先点击“锁定鼠标”；本次录制结束会自动恢复。' : '此浏览器没有可用的 Pointer Lock API。';
  publishCursorDiagnostics({method: 'pointer-lock', phase: 'api-check', pointer_lock_api_available: pointerApiAvailable,
    browser_context: browserInteractionContext()});
}
if (pointerOutsidePreview) {
  cursorButton.hidden = true;
  startButton.textContent = '准备共享，移出鼠标后录制';
  status.textContent = '共享就绪后，请将鼠标移出浏览器画面并保持 30 秒；重入会取消录制。';
}
cursorButton.addEventListener('click', async (event) => {
  if (recording) return;
  if (pointerLockPreview) { await armPointerCapture(event); return; }
  let stream;
  let diagnostics = {phase: 'requesting-stream', supported_cursor: navigator.mediaDevices.getSupportedConstraints().cursor ?? null};
  cursorButton.disabled = true; startButton.disabled = true;
  try {
    if (document.visibilityState !== 'visible') throw new Error('诊断须在可见标签页启动');
    publishCursorDiagnostics(diagnostics);
    status.textContent = '正在请求当前标签页共享，最长等待 15 秒。';
    stream = await requestDiagnosticStream(() => navigator.mediaDevices.getDisplayMedia({video: {displaySurface: 'browser', frameRate: 30, cursor: 'never'}, audio: false,
      preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude', monitorTypeSurfaces: 'exclude'}));
    const track = stream.getVideoTracks()[0];
    diagnostics = {...diagnostics, phase: 'stream-acquired', initial_settings: track.getSettings()};
    publishCursorDiagnostics(diagnostics);
    status.textContent = '已取得共享流；正在验证当前标签页。';
    if (track.getSettings().displaySurface !== 'browser' || track.getCaptureHandle?.()?.handle !== captureHandle) throw new Error('仅可诊断当前浏览器标签页');
    diagnostics = await negotiateCursorSuppression(track, navigator.mediaDevices.getSupportedConstraints(), {onUpdate: (value) => {
      diagnostics = value; publishCursorDiagnostics(diagnostics);
      if (diagnostics.apply_result === 'pending') status.textContent = '正在应用无指针严格约束，最长等待 3 秒。';
    }});
    publishCursorDiagnostics(diagnostics);
    status.textContent = diagnostics.cursor_suppressed ? '浏览器已启用无指针捕获；可录制。' : '浏览器无法禁用共享指针；录制已阻断。';
  } catch (error) {
    diagnostics = {...diagnostics, error: {name: error.name, message: error.message}};
    publishCursorDiagnostics(diagnostics);
    status.textContent = `捕获诊断失败：${error.message}`;
  } finally {
    for (const track of stream?.getTracks() ?? []) track.stop();
    cursorButton.disabled = false; startButton.disabled = false;
    diagnostics.stream_stopped = Boolean(stream);
    publishCursorDiagnostics(diagnostics);
  }
});

const frameMeasurement = (video, now, metadata) => ({method: 'HTMLVideoElement.requestVideoFrameCallback',
  width: metadata.width, height: metadata.height, video_width: video.videoWidth, video_height: video.videoHeight,
  presented_frames: metadata.presentedFrames, callback_at_ms: now, media_time_seconds: metadata.mediaTime,
  presentation_at_ms: metadata.presentationTime, expected_display_at_ms: metadata.expectedDisplayTime,
  ...(Number.isFinite(metadata.captureTime) ? {capture_at_ms: metadata.captureTime} : {})});
const observeCaptureFrame = (video) => new Promise((resolve, reject) => {
  if (!video.requestVideoFrameCallback) { reject(new Error('浏览器缺少真实视频帧尺寸观测接口')); return; }
  let callbackId;
  let previous;
  const timeout = setTimeout(() => {
    video.cancelVideoFrameCallback(callbackId);
    reject(new Error('8 秒内未观测到稳定的 1080p 以上 16:9 捕获帧'));
  }, 8000);
  const observe = (now, metadata) => {
    const frame = frameMeasurement(video, now, metadata);
    const valid = Number.isInteger(frame.width) && Number.isInteger(frame.height) && frame.width >= 1920 && frame.height >= 1080
      && Math.abs((frame.width / frame.height) / (16 / 9) - 1) <= 0.005
      && frame.width === frame.video_width && frame.height === frame.video_height;
    if (valid && previous?.width === frame.width && previous?.height === frame.height) {
      clearTimeout(timeout); resolve(frame); return;
    }
    previous = valid ? frame : null;
    callbackId = video.requestVideoFrameCallback(observe);
  };
  callbackId = video.requestVideoFrameCallback(observe);
});

startButton.addEventListener('click', async () => {
  if (recording) return;
  const lockCapture = pointerLockPreview ? pointerCapture : null;
  let captureTiming;
  const outsideCapture = pointerOutsidePreview ? createPointerOutsideCapture({document, viewport: () => ({width: innerWidth, height: innerHeight}),
    onUpdate: (evidence) => {
      if (evidence.no_reentry && evidence.left_at_ms !== undefined) {
        document.body.classList.add('recording');
        if (captureTiming) captureTiming.ui_hidden_at_ms = performance.now();
      }
      publishCursorDiagnostics({method: 'pointer-outside', phase: evidence.no_reentry ? 'pointer-left' : 'cancelled', pointer_outside: evidence});
    }}) : null;
  const captureGuard = lockCapture ?? outsideCapture;
  const waitForCapture = (promise) => captureGuard ? captureGuard.waitFor(promise) : promise;
  let stream;
  let captureProbe;
  let captureFrameCallback;
  let activeRecorder;
  try {
    if (pointerLockPreview && !lockCapture) throw new Error('请先点击“锁定鼠标”并等待第二步');
    lockCapture?.assertLocked();
    if (document.visibilityState !== 'visible') throw new Error('录制须在可见标签页启动');
    if (Math.abs(innerWidth / innerHeight - 16 / 9) > 0.002) throw new Error('录制视口须为 16:9');
    if (!pointerOutsidePreview) document.body.classList.add('recording');
    else { startButton.disabled = true; status.textContent = '正在共享当前标签页；就绪后会提示移出鼠标。'; }
    pageFlip.turnToPage(0);
    cameraTransform(opening ? nearScale : 1, opening ? closedTranslation : 0);
    events = []; errors = []; completedTurns = 0; pendingTurn = null; openingStarted = false;
    for (const span of book.querySelectorAll('.reveal')) span.classList.remove('is-visible');
    captureTiming = {time_origin_ms: performance.timeOrigin, ui_hidden_at_ms: pointerOutsidePreview ? null : performance.now()};
    await nextFrame(); await nextFrame();
    captureTiming.requested_at_ms = performance.now();
    const streamRequest = navigator.mediaDevices.getDisplayMedia({video: {displaySurface: 'browser', frameRate: 30, ...(!pointerLockPreview && !pointerOutsidePreview ? {cursor: 'never'} : {})}, audio: false,
      preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude', monitorTypeSurfaces: 'exclude'});
    stream = await waitForCapture(captureGuard ? streamRequest.then((value) => captureGuard.attachStream(value)) : streamRequest);
    captureTiming.resolved_at_ms = performance.now();
    const track = stream.getVideoTracks()[0];
    const initialSettings = track.getSettings();
    if (initialSettings.displaySurface !== 'browser') throw new Error('仅允许浏览器标签页捕获');
    if (track.getCaptureHandle?.()?.handle !== captureHandle) throw new Error('未能验证当前标签页；请重新选择本页');
    const cursorDiagnostics = (pointerLockPreview || pointerOutsidePreview) ? {method: pointerLockPreview ? 'pointer-lock' : 'pointer-outside', before_cursor: initialSettings.cursor ?? null}
      : await negotiateCursorSuppression(track, navigator.mediaDevices.getSupportedConstraints(), {onUpdate: publishCursorDiagnostics});
    publishCursorDiagnostics(cursorDiagnostics);
    if (!pointerLockPreview && !pointerOutsidePreview && !cursorDiagnostics.cursor_suppressed) throw new Error(`浏览器无法禁用共享指针（${cursorDiagnostics.after_cursor ?? '未知'}）；请查看捕获诊断`);
    if (outsideCapture) {
      status.textContent = '共享已就绪。请将鼠标移到聊天区，保持 30 秒不要移回浏览器；移出后自动录制。';
      publishCursorDiagnostics({...cursorDiagnostics, phase: 'awaiting-real-pointer-leave'});
      await outsideCapture.waitForLeave();
    }
    captureProbe = document.createElement('video');
    captureProbe.muted = true; captureProbe.playsInline = true;
    captureProbe.setAttribute('aria-hidden', 'true');
    // Keep the decoded stream invisible without disabling its frame callbacks.
    captureProbe.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    captureProbe.srcObject = stream;
    document.body.append(captureProbe);
    await waitForCapture(captureProbe.play());
    const observedFrame = await waitForCapture(observeCaptureFrame(captureProbe));
    const frameClockSamples = [];
    const observeRecordingFrame = (now, metadata) => {
      if (recording) frameClockSamples.push(frameMeasurement(captureProbe, now, metadata));
      captureFrameCallback = captureProbe.requestVideoFrameCallback(observeRecordingFrame);
    };
    captureFrameCallback = captureProbe.requestVideoFrameCallback(observeRecordingFrame);
    const settings = track.getSettings();
    cursorDiagnostics.after_frame_cursor = settings.cursor ?? null;
    publishCursorDiagnostics(cursorDiagnostics);
    if (!pointerLockPreview && !pointerOutsidePreview && settings.cursor !== 'never') throw new Error('真实帧到达后共享指针仍未禁用');
    lockCapture?.assertLocked();
    outsideCapture?.assertReady();
    if (settings.displaySurface !== 'browser' || track.getCaptureHandle?.()?.handle !== captureHandle) throw new Error('真实帧到达后当前标签页捕获校验失败');
    const captureVisibility = document.visibilityState;
    if (captureVisibility !== 'visible') throw new Error('所选当前标签页必须实际可见');
    const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error('浏览器缺少可用 WebM 编码器');
    const started = await waitForCapture(fetch('recordings/start', {method: 'POST', signal: captureGuard?.signal, headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({manifest_checksum_sha256: manifestChecksum, mime_type: mimeType})}));
    if (!started.ok) throw new Error(await started.text());
    const session = await started.json();
    const recorder = new MediaRecorder(stream, {mimeType, videoBitsPerSecond: 18000000});
    activeRecorder = recorder;
    captureGuard?.attachRecorder(recorder);
    const chunks = [];
    recorder.addEventListener('dataavailable', (event) => { if (event.data.size) chunks.push(event.data); });
    const stopped = new Promise((resolve) => recorder.addEventListener('stop', resolve, {once: true}));
    recorder.addEventListener('error', (event) => errors.push(String(event.error?.message ?? 'MediaRecorder error')));
    track.addEventListener('ended', () => { if (recording) errors.push('capture track ended early'); });
    const checkCaptureSize = () => {
      if (captureProbe.videoWidth !== observedFrame.width || captureProbe.videoHeight !== observedFrame.height) errors.push('decoded capture frame dimensions changed while recording');
    };
    captureProbe.addEventListener('resize', () => { if (recording) checkCaptureSize(); });
    const actions = [...(opening ? [{type: 'cover-hold', frame: 0}, {type: 'cover-open', frame: opening.hold_frames}, {type: 'camera-settle', frame: openingFrames}] : []), ...manifest.spreads.flatMap((spread) => [
      ...spread.text_reveals.map((reveal) => ({type: 'text-reveal', frame: reveal.start_frame, spread, reveal})),
      ...(spread.transition_out ? [{type: 'page-turn', frame: spread.transition_out.start_frame, spread}] : []),
    ])].sort((a, b) => a.frame - b.frame);
    let actionIndex = 0;
    const runActions = (milliseconds) => {
      while (actionIndex < actions.length && actions[actionIndex].frame / 30 * 1000 <= milliseconds) {
        const action = actions[actionIndex++];
        let detail = {};
        if (action.type === 'cover-hold' || action.type === 'camera-settle') {
          detail = {...measureCamera(), ...(action.type === 'cover-hold' ? {page: pageFlip.getCurrentPageIndex()} : {})};
        } else if (action.type === 'text-reveal') {
          const selector = `.text-page[data-shot-id="${action.spread.shot_id}"] [data-reveal-id="${CSS.escape(action.reveal.id)}"]`;
          const span = book.querySelector(selector);
          span.style.transitionDuration = `${Math.max(0, action.reveal.end_frame - action.reveal.start_frame) / 30 * 1000}ms`;
          span.classList.add('is-visible');
        } else if (action.type === 'page-turn' || action.type === 'cover-open') {
          if (state !== 'read' || pendingTurn) errors.push(`overlapping page turn at ${action.spread?.shot_id ?? 'opening cover'}`);
          const duration = action.type === 'cover-open' ? opening.open_frames : action.spread.transition_out.duration_in_frames;
          pageFlip.getSettings().flippingTime = duration / 30 * 1000;
          pendingTurn = {type: action.type, end_frame: action.frame + duration};
          if (action.type === 'cover-open') { openingStarted = true; detail = {duration_in_frames: duration}; }
          pageFlip.flipNext('bottom');
        }
        events.push({type: action.type, ...detail, ...(action.spread ? {shot_id: action.spread.shot_id} : {}), ...(action.reveal ? {id: action.reveal.id} : {}),
          expected_frame: action.frame, actual_ms: milliseconds});
      }
    };
    recorder.addEventListener('start', () => { captureTiming.recorder_started_at_ms = performance.now(); }, {once: true});
    let finishTimeline;
    const finished = new Promise((resolve) => { finishTimeline = resolve; });
    const tick = () => {
      if (!recording || captureGuard?.signal.aborted) return;
      const ms = elapsed();
      if (openingStarted) {
        const progress = Math.max(0, Math.min(1, (ms * 30 / 1000 - opening.hold_frames) / opening.open_frames));
        const ease = progress * progress * (3 - 2 * progress);
        cameraTransform(nearScale + (1 - nearScale) * ease, closedTranslation * (1 - ease));
      }
      runActions(ms);
      if (ms >= manifest.total_frames / 30 * 1000) finishTimeline(ms);
      else requestAnimationFrame(tick);
    };
    captureGuard?.markCaptureStart();
    epoch = performance.now(); recording = true;
    captureTiming.recorder_start_called_at_ms = epoch;
    captureTiming.timeline_zero_at_ms = epoch;
    recorder.start(1000);
    tick();
    const elapsedMs = await waitForCapture(finished);
    captureTiming.timeline_ended_at_ms = performance.now();
    checkCaptureSize();
    cursorDiagnostics.final_cursor = track.getSettings().cursor ?? null;
    if (!pointerLockPreview && !pointerOutsidePreview && cursorDiagnostics.final_cursor !== 'never') errors.push('shared cursor suppression changed while recording');
    publishCursorDiagnostics(cursorDiagnostics);
    captureGuard?.markCaptureEnd();
    recording = false;
    recorder.stop(); await waitForCapture(stopped);
    for (const mediaTrack of stream.getTracks()) mediaTrack.stop();
    await captureGuard?.release();
    const proof = {contract_version: 'knowledge-video-browser-recording-v1', manifest_checksum_sha256: manifestChecksum,
      capture: {display_surface: settings.displaySurface, current_tab_verified: true, visibility_state: captureVisibility,
        width: observedFrame.width, height: observedFrame.height, frame_rate: settings.frameRate, mime_type: mimeType,
        dimension_source: 'decoded-video-frame', observed_frame: observedFrame,
        initial_track_settings: initialSettings, settled_track_settings: settings,
        cursor_suppression: cursorDiagnostics,
        ...(lockCapture ? {pointer_lock: lockCapture.evidence} : {}),
        ...(outsideCapture ? {pointer_outside: outsideCapture.evidence} : {}),
        timing: captureTiming, frame_clock_samples: frameClockSamples},
      all_images_decoded: true, fonts_ready: document.fonts.status === 'loaded',
      ui_hidden: getComputedStyle(document.querySelector('#recording-controls')).display === 'none',
      layout_checks: layoutChecks, ...(opening ? {cover_layout_check: coverLayoutCheck} : {}), events, errors, total_frames: manifest.total_frames, elapsed_ms: elapsedMs};
    const videoResponse = await fetch(`recordings/${session.id}/video`, {method: 'POST', headers: {'Content-Type': 'application/octet-stream'}, body: new Blob(chunks, {type: mimeType})});
    if (!videoResponse.ok) throw new Error(await videoResponse.text());
    const proofResponse = await fetch(`recordings/${session.id}/proof`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(proof)});
    if (!proofResponse.ok) throw new Error(await proofResponse.text());
    window.flipbookVideo.recordingResult = await proofResponse.json();
    status.textContent = `录制已保存：${session.id}`;
  } catch (error) {
    recording = false;
    if (activeRecorder && activeRecorder.state !== 'inactive') activeRecorder.stop();
    for (const track of stream?.getTracks() ?? []) track.stop();
    errors.push(String(error.message));
    status.textContent = `录制失败：${error.message}`;
    window.flipbookVideo.recordingError = String(error.message);
  } finally {
    if (captureProbe) {
      if (captureFrameCallback !== undefined) captureProbe.cancelVideoFrameCallback(captureFrameCallback);
      captureProbe.pause(); captureProbe.srcObject = null; captureProbe.remove();
    }
    document.body.classList.remove('recording');
    if (lockCapture) {
      try { await lockCapture.release(); } catch (error) { status.textContent = error.message; }
      if (pointerCapture === lockCapture) pointerCapture = null;
      cursorButton.disabled = !pointerApiAvailable; startButton.disabled = true;
    }
    if (outsideCapture) { outsideCapture.release(); startButton.disabled = false; }
  }
});
