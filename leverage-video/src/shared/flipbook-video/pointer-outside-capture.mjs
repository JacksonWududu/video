const cancelled = (message) => Object.assign(new Error(message), {name: 'AbortError'});

export const createPointerOutsideCapture = ({document, viewport, now = () => performance.now(), settleMs = 1000, waitTimeoutMs = 60000, onUpdate = () => {}}) => {
  const controller = new AbortController();
  const streams = new Set();
  const targets = [...new Set([document, document.documentElement].filter(Boolean))];
  const evidence = {target: 'document', settle_ms: settleMs, no_reentry: true, events: []};
  let recorder;
  let closed = false;
  let left = false;
  let timer;
  let timeout;
  let resolveLeave;
  let rejectLeave;
  const stopResources = () => {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    for (const stream of streams) for (const track of stream.getTracks()) track.stop();
    streams.clear();
  };
  const abort = (message) => {
    if (closed || controller.signal.aborted) return;
    clearTimeout(timer); clearTimeout(timeout);
    controller.abort(cancelled(message)); rejectLeave?.(controller.signal.reason); stopResources();
  };
  const leftDocument = (event) => {
    if (left || closed || !event.isTrusted) return;
    const size = viewport();
    if (![event.clientX, event.clientY].every(Number.isFinite)
      || !(event.clientX < 0 || event.clientY < 0 || event.clientX >= size.width || event.clientY >= size.height)) return;
    left = true; evidence.left_at_ms = now();
    evidence.events.push({type: 'left', source_event: event.type, at_ms: evidence.left_at_ms, is_trusted: event.isTrusted,
      client_x: event.clientX, client_y: event.clientY, viewport_width: size.width, viewport_height: size.height});
    onUpdate(evidence);
    timer = setTimeout(() => { clearTimeout(timeout); resolveLeave?.(); }, settleMs);
  };
  const reentered = (event) => {
    if (!left || closed || !event.isTrusted) return;
    const size = viewport();
    if (event.clientX >= 0 && event.clientY >= 0 && event.clientX < size.width && event.clientY < size.height) {
      evidence.no_reentry = false;
      evidence.events.push({type: 'reentered', at_ms: now(), is_trusted: true, client_x: event.clientX, client_y: event.clientY});
      onUpdate(evidence); abort('鼠标重新进入浏览器画面；录制已取消');
    }
  };
  const escaped = (event) => { if (event.key === 'Escape') abort('Esc 已取消录制'); };
  const waitFor = (promise) => new Promise((resolve, reject) => {
    if (controller.signal.aborted) { Promise.resolve(promise).catch(() => {}); reject(controller.signal.reason); return; }
    const aborted = () => reject(controller.signal.reason);
    controller.signal.addEventListener('abort', aborted, {once: true});
    Promise.resolve(promise).then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', aborted));
  });
  const assertReady = () => {
    if (controller.signal.aborted) throw controller.signal.reason;
    if (!left || evidence.no_reentry !== true || now() - evidence.left_at_ms < settleMs) throw new Error('尚未验证鼠标移出并保持稳定');
  };
  return {
    evidence, signal: controller.signal, abort, waitFor, assertReady,
    waitForLeave: () => new Promise((resolve, reject) => {
      resolveLeave = resolve; rejectLeave = reject;
      for (const target of targets) {
        for (const type of ['pointerleave', 'mouseleave']) target.addEventListener(type, leftDocument);
        for (const type of ['pointerenter', 'mouseenter', 'pointermove', 'mousemove']) target.addEventListener(type, reentered);
      }
      document.addEventListener('keydown', escaped);
      timeout = setTimeout(() => abort('60 秒内未观测到可信的鼠标移出事件'), waitTimeoutMs);
    }),
    attachStream: (stream) => {
      if (closed || controller.signal.aborted) {
        for (const track of stream.getTracks()) track.stop();
        throw controller.signal.reason ?? cancelled('录制会话已结束');
      }
      streams.add(stream); return stream;
    },
    attachRecorder: (value) => { assertReady(); recorder = value; },
    markCaptureStart: () => { assertReady(); evidence.capture_started_at_ms = now(); },
    markCaptureEnd: () => { assertReady(); evidence.capture_ended_at_ms = now(); },
    release: () => {
      if (closed) return;
      closed = true; clearTimeout(timer); clearTimeout(timeout); stopResources();
      for (const target of targets) {
        for (const type of ['pointerleave', 'mouseleave']) target.removeEventListener(type, leftDocument);
        for (const type of ['pointerenter', 'mouseenter', 'pointermove', 'mousemove']) target.removeEventListener(type, reentered);
      }
      document.removeEventListener('keydown', escaped);
    },
  };
};
