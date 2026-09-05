#!/usr/bin/env node
import process from 'node:process';

import {
  consumeOneTimeUserGateOverride,
  validateOneTimeUserGateOverride,
} from './contract.mjs';

let input = '';
for await (const chunk of process.stdin) input += chunk;

try {
  const payload = JSON.parse(input);
  if (payload.operation === 'validate') {
    const result = validateOneTimeUserGateOverride(payload.override, payload.bindings);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else if (payload.operation === 'consume') {
    const consumed = consumeOneTimeUserGateOverride(payload.override, {
      ...payload.bindings,
      consumedTransitionId: payload.consumed_transition_id,
      consumedAt: payload.consumed_at,
    });
    process.stdout.write(`${JSON.stringify(consumed)}\n`);
  } else {
    throw new Error('one-time user gate override bridge operation is invalid');
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
