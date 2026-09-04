const timeoutError = (message) => Object.assign(new Error(message), {name: 'TimeoutError'});

export const requestDiagnosticStream = (requestStream, {timeoutMs = 15000} = {}) => new Promise((resolve, reject) => {
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    reject(timeoutError(`getDisplayMedia did not resolve within ${timeoutMs} ms`));
  }, timeoutMs);
  Promise.resolve().then(requestStream).then((stream) => {
    if (expired) { for (const track of stream.getTracks()) track.stop(); return; }
    clearTimeout(timer); resolve(stream);
  }, (error) => { clearTimeout(timer); if (!expired) reject(error); });
});

export const negotiateCursorSuppression = async (track, supportedConstraints, {timeoutMs = 3000, onUpdate = () => {}} = {}) => {
  const capabilities = track.getCapabilities?.() ?? null;
  const initialSettings = track.getSettings();
  const diagnostics = {
    method: 'cursor-never',
    phase: 'applying-cursor-constraint', apply_result: 'pending',
    supported_cursor: supportedConstraints?.cursor ?? null,
    capability_cursor: capabilities?.cursor ?? null,
    before_cursor: initialSettings.cursor ?? null,
    initial_capabilities: capabilities, initial_settings: initialSettings,
    requested_cursor: {exact: 'never'},
  };
  onUpdate(diagnostics);
  let timer;
  try {
    await Promise.race([
      track.applyConstraints({...track.getConstraints(), cursor: {exact: 'never'}}),
      new Promise((resolve, reject) => { timer = setTimeout(() => reject(timeoutError(`cursor exact never did not settle within ${timeoutMs} ms`)), timeoutMs); }),
    ]);
    diagnostics.apply_result = 'resolved';
  } catch (error) {
    diagnostics.apply_result = error.name === 'TimeoutError' ? 'timed-out' : 'rejected';
    diagnostics.error = {name: error.name, message: error.message, constraint: error.constraint ?? null};
  } finally {
    clearTimeout(timer);
  }
  diagnostics.phase = 'cursor-constraint-settled';
  diagnostics.after_cursor = track.getSettings().cursor ?? null;
  diagnostics.applied_cursor = track.getConstraints().cursor ?? null;
  diagnostics.cursor_suppressed = diagnostics.apply_result === 'resolved' && diagnostics.after_cursor === 'never';
  onUpdate(diagnostics);
  return diagnostics;
};
