import assert from 'node:assert/strict';
import test from 'node:test';
import {negotiateCursorSuppression, requestDiagnosticStream} from './cursor-capture.mjs';

const track = (behavior) => {
  let cursor = 'motion'; let constraints = {frameRate: 30};
  return {getSettings: () => ({cursor}), getCapabilities: () => ({cursor: ['never', 'motion']}),
    getConstraints: () => constraints,
    applyConstraints: async (requested) => {
      assert.deepEqual(requested, {frameRate: 30, cursor: {exact: 'never'}});
      if (behavior === 'reject') throw Object.assign(new Error('cursor mode unsupported'), {name: 'OverconstrainedError', constraint: 'cursor'});
      constraints = requested;
      if (behavior === 'apply') cursor = 'never';
    }};
};

test('cursor capture requires the exact request to resolve and actual settings to become never', async () => {
  const result = await negotiateCursorSuppression(track('apply'), {cursor: true});
  assert.equal(result.cursor_suppressed, true);
  assert.equal(result.before_cursor, 'motion');
  assert.equal(result.after_cursor, 'never');
});

test('an ignored exact constraint remains a failure even if the promise resolves', async () => {
  const result = await negotiateCursorSuppression(track('ignore'), {});
  assert.equal(result.apply_result, 'resolved');
  assert.equal(result.cursor_suppressed, false);
  assert.equal(result.after_cursor, 'motion');
  assert.equal(result.supported_cursor, null);
});

test('unsupported cursor errors remain visible diagnostic evidence', async () => {
  const result = await negotiateCursorSuppression(track('reject'), {cursor: true});
  assert.equal(result.cursor_suppressed, false);
  assert.deepEqual(result.error, {name: 'OverconstrainedError', message: 'cursor mode unsupported', constraint: 'cursor'});
});

test('a stalled exact constraint times out while preserving initial capabilities and settings', async () => {
  const stalled = track('ignore'); stalled.applyConstraints = () => new Promise(() => {});
  const updates = [];
  const result = await negotiateCursorSuppression(stalled, {cursor: true}, {timeoutMs: 5, onUpdate: (value) => updates.push(structuredClone(value))});
  assert.equal(updates[0].phase, 'applying-cursor-constraint');
  assert.equal(updates[0].before_cursor, 'motion');
  assert.deepEqual(updates[0].initial_capabilities.cursor, ['never', 'motion']);
  assert.equal(result.apply_result, 'timed-out');
  assert.equal(result.error.name, 'TimeoutError');
  assert.equal(result.cursor_suppressed, false);
});

test('a stream resolving after the diagnostic timeout is stopped immediately', async () => {
  let resolveStream; let stopped = 0;
  const pending = new Promise((resolve) => { resolveStream = resolve; });
  await assert.rejects(requestDiagnosticStream(() => pending, {timeoutMs: 5}), {name: 'TimeoutError'});
  resolveStream({getTracks: () => [{stop: () => { stopped += 1; }}]});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stopped, 1);
});

test('prompt resolution and rejection settle without waiting for the diagnostic timeout', async () => {
  const stream = {getTracks: () => []};
  assert.equal(await requestDiagnosticStream(() => Promise.resolve(stream), {timeoutMs: 1000}), stream);
  await assert.rejects(requestDiagnosticStream(() => Promise.reject(new Error('capture denied')), {timeoutMs: 1000}), /capture denied/);
});
