import assert from 'node:assert/strict';
import test from 'node:test';
import {createPointerLockCapture} from './pointer-lock-capture.mjs';

const setup = (behavior = 'lock') => {
  const document = new EventTarget(); document.pointerLockElement = null;
  const element = {id: 'video-stage', requestPointerLock: () => {
    if (behavior === 'reject') return Promise.reject(new Error('pointer lock denied'));
    if (behavior === 'stall') return new Promise(() => {});
    document.pointerLockElement = element; document.dispatchEvent(new Event('pointerlockchange'));
  }};
  document.exitPointerLock = () => { document.pointerLockElement = null; document.dispatchEvent(new Event('pointerlockchange')); };
  const session = createPointerLockCapture({document, element, acquireTimeoutMs: 5});
  return {document, element, session};
};

test('a completed pointer-locked capture restores the pointer and stops resources', async () => {
  const {document, session} = setup(); let stopped = 0;
  await session.acquire();
  session.attachStream({getTracks: () => [{stop: () => { stopped += 1; }}]});
  session.markCaptureStart(); session.markCaptureEnd();
  await session.release(); await session.release();
  assert.equal(document.pointerLockElement, null); assert.equal(stopped, 1);
  assert.equal(session.evidence.locked_at_start, true); assert.equal(session.evidence.locked_at_end, true);
  assert.equal(session.evidence.released, true); assert.equal(session.evidence.lost_during_capture, false);
  assert.deepEqual(session.evidence.events.map((event) => event.type), ['locked', 'released']);
});

test('Escape immediately aborts the timeline, recorder and every stream', async () => {
  const {document, session} = setup(); let stopped = 0; let recorderStopped = 0;
  await session.acquire(); session.markCaptureStart();
  session.attachStream({getTracks: () => [{stop: () => { stopped += 1; }}]});
  session.attachRecorder({state: 'recording', stop: () => { recorderStopped += 1; }});
  const pending = session.waitFor(new Promise(() => {}));
  const event = new Event('keydown'); event.key = 'Escape'; document.dispatchEvent(event);
  await assert.rejects(pending, {name: 'AbortError'});
  assert.equal(stopped, 1); assert.equal(recorderStopped, 1);
  assert.equal(document.pointerLockElement, null); assert.equal(session.evidence.lost_during_capture, true);
  await session.release();
});

test('unexpected loss of pointer lock aborts and a late shared stream is stopped', async () => {
  const {document, session} = setup(); let stopped = 0;
  await session.acquire(); document.exitPointerLock();
  assert.equal(session.signal.aborted, true);
  assert.throws(() => session.attachStream({getTracks: () => [{stop: () => { stopped += 1; }}]}), {name: 'AbortError'});
  assert.equal(stopped, 1); await session.release();
});

test('denied and stalled lock requests fail without claiming acquisition', async () => {
  for (const behavior of ['reject', 'stall']) {
    const {session, document} = setup(behavior);
    await assert.rejects(session.acquire()); await session.release();
    assert.equal(session.evidence.acquired_at_ms, undefined); assert.equal(document.pointerLockElement, null);
  }
});

test('missing browser APIs fail before a capture session can begin', async () => {
  const document = new EventTarget();
  const session = createPointerLockCapture({document, element: {id: 'video-stage'}});
  assert.equal(session.evidence.api_supported, false);
  await assert.rejects(session.acquire(), /Pointer Lock API/); await session.release();
});
