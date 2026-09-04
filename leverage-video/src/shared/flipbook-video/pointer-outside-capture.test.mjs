import assert from 'node:assert/strict';
import test from 'node:test';
import {createPointerOutsideCapture} from './pointer-outside-capture.mjs';

const setup = (options = {}) => {
  const listeners = new Map();
  const document = {addEventListener: (type, listener) => { const set = listeners.get(type) ?? new Set(); set.add(listener); listeners.set(type, set); },
    removeEventListener: (type, listener) => listeners.get(type)?.delete(listener)};
  const emit = (type, fields) => { for (const listener of listeners.get(type) ?? []) listener({type, ...fields}); };
  const session = createPointerOutsideCapture({document, viewport: () => ({width: 1920, height: 1080}), settleMs: 5, waitTimeoutMs: 1000, ...options});
  return {session, emit};
};

test('only a trusted leave outside the viewport can arm capture after settling', async () => {
  const {session, emit} = setup(); const ready = session.waitForLeave();
  emit('pointerleave', {isTrusted: false, clientX: -1, clientY: 10});
  emit('mouseleave', {isTrusted: true, clientX: 10, clientY: 10});
  assert.equal(session.evidence.left_at_ms, undefined);
  emit('pointerleave', {isTrusted: true, clientX: -1, clientY: 10});
  await ready; session.markCaptureStart(); session.markCaptureEnd(); session.release();
  assert.equal(session.evidence.events.length, 1); assert.equal(session.evidence.events[0].is_trusted, true);
  assert.equal(session.evidence.no_reentry, true);
});

test('reentry during recording aborts immediately and stops the recorder and all streams', async () => {
  const {session, emit} = setup(); let streamStopped = 0; let recorderStopped = 0;
  session.attachStream({getTracks: () => [{stop: () => { streamStopped += 1; }}]});
  const ready = session.waitForLeave(); emit('mouseleave', {isTrusted: true, clientX: 1920, clientY: 10}); await ready;
  session.markCaptureStart(); session.attachRecorder({state: 'recording', stop: () => { recorderStopped += 1; }});
  const pending = session.waitFor(new Promise(() => {}));
  emit('mousemove', {isTrusted: true, clientX: 1919, clientY: 10});
  await assert.rejects(pending, {name: 'AbortError'});
  assert.equal(session.evidence.no_reentry, false); assert.equal(streamStopped, 1); assert.equal(recorderStopped, 1);
  session.release();
});

test('reentry during settling, Escape and a missing leave all fail closed', async () => {
  for (const cause of ['reentry', 'escape', 'timeout']) {
    const {session, emit} = setup({waitTimeoutMs: 10}); const ready = session.waitForLeave();
    if (cause === 'reentry') { emit('pointerleave', {isTrusted: true, clientX: -1, clientY: 0}); emit('pointerenter', {isTrusted: true, clientX: 0, clientY: 0}); }
    if (cause === 'escape') emit('keydown', {key: 'Escape'});
    await assert.rejects(ready, {name: 'AbortError'}); session.release();
  }
});

test('a stream arriving after cancellation is stopped immediately', () => {
  const {session} = setup(); let stopped = 0; session.abort('cancelled');
  assert.throws(() => session.attachStream({getTracks: () => [{stop: () => { stopped += 1; }}]}), {name: 'AbortError'});
  assert.equal(stopped, 1); session.release();
});
