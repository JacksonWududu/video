#!/usr/bin/env node
import path from 'node:path';
import {
  assertProviderConfig,
  buildProviderInvocation,
  createRequestFingerprint,
  loadAssetRequest,
  loadProviderConfig,
  resolveConfirmedProvider,
} from './provider-lib.mjs';
import {ROOT} from './project-lib.mjs';

const args = process.argv.slice(2);
const action = args.find((arg) => !arg.startsWith('--'));
const valueFor = (name) =>
  args.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);

try {
  if (action !== 'validate') {
    throw new Error('用法：provider:request -- validate --request=<request.json> [--json]');
  }
  const requestInput = valueFor('--request');
  if (!requestInput) throw new Error('validate 必须提供 --request=<request.json>。');
  const loaded = await loadAssetRequest(requestInput);
  const config = assertProviderConfig(
    await loadProviderConfig(loaded.request.projectSlug),
  );
  const provider = resolveConfirmedProvider(
    config.config,
    loaded.request.capability,
    valueFor('--provider') ?? 'auto',
  );
  const invocation = buildProviderInvocation({
    request: loaded.request,
    provider,
    model: valueFor('--model'),
  });
  const summary = {
    valid: true,
    request: path.relative(ROOT, loaded.file),
    output: path.relative(ROOT, loaded.output),
    provider: provider.id,
    requestFingerprint: createRequestFingerprint({
      request: loaded.request,
      providerId: provider.id,
      model: invocation.model,
    }),
    invocation,
  };
  if (args.includes('--json')) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(`✓ 请求有效：${summary.request}`);
    console.log(`  provider: ${summary.provider}`);
    console.log(`  request fingerprint: ${summary.requestFingerprint}`);
    console.log(`  invocation fingerprint: ${summary.invocation.fingerprint}`);
  }
} catch (error) {
  console.error(`provider:request failed: ${error.message}`);
  process.exitCode = 1;
}
