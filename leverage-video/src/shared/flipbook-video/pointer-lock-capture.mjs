const cancelled = (message) => Object.assign(new Error(message), {name: 'AbortError'});

export const createPointerLockCapture = ({document, element, now = () => performance.now(), acquireTimeoutMs = 3000}) => {
  const controller = new AbortController();
  const streams = new Set();
  let recorder;
  let closing = false;
  let releasePromise;
  let resolveAcquisition;
  let rejectAcquisition;
  const evidence = {target_id: element.id,
    api_supported: typeof element.requestPointerLock === 'function' && typeof document.exitPointerLock === 'function',
    prompt_wait_ms: 6000, locked_at_start: false, locked_at_end: false, lost_during_capture: false, released: false, events: []};
  const stopResources = () => {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    for (const stream of streams) for (const track of stream.getTracks()) track.stop();
    streams.clear();
  };
  const abort = (message = '指针锁定已解除；录制已取消') => {
    if (closing || controller.signal.aborted) return;
    evidence.lost_during_capture = evidence.locked_at_start && !evidence.locked_at_end;
    evidence.events.push({type: 'cancelled', at_ms: now(), reason: message});
    controller.abort(cancelled(message));
    rejectAcquisition?.(controller.signal.reason);
    stopResources();
    if (document.pointerLockElement === element) document.exitPointerLock();
  };
  const changed = () => {
    if (closing) { if (document.pointerLockElement === element) document.exitPointerLock(); return; }
    if (document.pointerLockElement === element) {
      if (evidence.acquired_at_ms === undefined) {
        evidence.acquired_at_ms = now();
        evidence.events.push({type: 'locked', at_ms: evidence.acquired_at_ms});
      }
      resolveAcquisition?.();
    } else if (evidence.acquired_at_ms !== undefined && !closing) abort();
  };
  const escaped = (event) => { if (event.key === 'Escape') abort('Esc 已取消录制'); };
  document.addEventListener('pointerlockchange', changed);
  document.addEventListener('keydown', escaped);
  const waitFor = (promise) => new Promise((resolve, reject) => {
    if (controller.signal.aborted) { Promise.resolve(promise).catch(() => {}); reject(controller.signal.reason); return; }
    const aborted = () => reject(controller.signal.reason);
    controller.signal.addEventListener('abort', aborted, {once: true});
    Promise.resolve(promise).then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', aborted));
  });
  const assertLocked = () => {
    if (controller.signal.aborted) throw controller.signal.reason;
    if (document.pointerLockElement !== element) { abort(); throw controller.signal.reason; }
  };
  return {
    evidence, signal: controller.signal, abort, assertLocked, waitFor,
    acquire: () => {
      if (!evidence.api_supported) return Promise.reject(new Error('此浏览器不支持 Pointer Lock API'));
      if (document.pointerLockElement && document.pointerLockElement !== element) return Promise.reject(new Error('另一元素已锁定指针'));
      let timer;
      const acquired = new Promise((resolve, reject) => {
        resolveAcquisition = resolve; rejectAcquisition = reject;
        timer = setTimeout(() => reject(new Error('3 秒内未观测到指针锁定')), acquireTimeoutMs);
        try {
          Promise.resolve(element.requestPointerLock()).then(changed, reject);
        } catch (error) { reject(error); }
      });
      return acquired.finally(() => { clearTimeout(timer); resolveAcquisition = null; rejectAcquisition = null; });
    },
    waitForPrompt: () => {
      let timer;
      return waitFor(new Promise((resolve) => { timer = setTimeout(resolve, evidence.prompt_wait_ms); })).finally(() => clearTimeout(timer));
    },
    attachStream: (stream) => {
      if (controller.signal.aborted || closing) {
        for (const track of stream.getTracks()) track.stop();
        throw controller.signal.reason ?? cancelled('录制会话已结束');
      }
      streams.add(stream); return stream;
    },
    attachRecorder: (value) => { assertLocked(); recorder = value; },
    markCaptureStart: () => {
      assertLocked(); evidence.locked_at_start = true; evidence.capture_started_at_ms = now();
    },
    markCaptureEnd: () => {
      assertLocked(); evidence.locked_at_end = true; evidence.capture_ended_at_ms = now();
    },
    release: () => {
      if (releasePromise) return releasePromise;
      closing = true;
      stopResources();
      document.removeEventListener('pointerlockchange', changed);
      document.removeEventListener('keydown', escaped);
      releasePromise = new Promise((resolve, reject) => {
        let timer;
        let finished = false;
        const finish = () => {
          if (finished || document.pointerLockElement === element) return;
          finished = true;
          clearTimeout(timer); document.removeEventListener('pointerlockchange', finish);
          evidence.released = true; evidence.released_at_ms = now();
          evidence.events.push({type: 'released', at_ms: evidence.released_at_ms}); resolve();
        };
        document.addEventListener('pointerlockchange', finish);
        timer = setTimeout(() => {
          document.removeEventListener('pointerlockchange', finish);
          reject(new Error('未能确认指针自动恢复；请按 Esc'));
        }, 1500);
        if (document.pointerLockElement === element) document.exitPointerLock();
        finish();
      });
      return releasePromise;
    },
  };
};
