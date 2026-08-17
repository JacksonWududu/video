import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

import {sha256File} from '../episode-tooling/file-integrity.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, '../../../..');
const command = path.join(here, 'create-legacy-reuse-decision.mjs');

test('creates a one-time authorized legacy decision without moving or clearing existing scripts', () => {
  const episode = fs.mkdtempSync(path.join(repositoryRoot, 'leverage-video/src/__legacy-create-'));
  const scriptDirectory = path.join(episode, 'script');
  const schemaDirectory = path.join(episode, 'schema');
  const source = path.join(scriptDirectory, 'binding.ts');
  fs.mkdirSync(scriptDirectory);
  fs.mkdirSync(schemaDirectory);
  fs.writeFileSync(source, "import '../../shared/video-scenes';\n");
  const sourceChecksum = sha256File(source);
  try {
    const workspace = path.relative(repositoryRoot, episode);
    execFileSync(process.execPath, [
      command,
      workspace,
      '--authorization-message',
      '授权',
      '--authorized-at',
      '2026-08-14T00:00:00.000Z',
    ]);
    const decisionPath = path.join(schemaDirectory, 'shared-reuse-decision-v1.json');
    const decision = JSON.parse(fs.readFileSync(decisionPath, 'utf8'));
    assert.equal(decision.audit_mode, 'authorized_legacy_migration-v1');
    assert.equal(decision.pre_script_inventory, null);
    assert.equal(decision.authorization.exact_user_message, '授权');
    assert.deepEqual(decision.legacy_script_inventory, [{
      path: path.relative(repositoryRoot, source),
      checksum_sha256: sourceChecksum,
    }]);
    assert.equal(sha256File(source), sourceChecksum);
    assert.throws(
      () => execFileSync(process.execPath, [
        command,
        workspace,
        '--authorization-message',
        '授权',
        '--authorized-at',
        '2026-08-14T00:00:00.000Z',
      ]),
      /reuse decision already exists/,
    );
  } finally {
    const decisionPath = path.join(schemaDirectory, 'shared-reuse-decision-v1.json');
    if (fs.existsSync(decisionPath)) fs.unlinkSync(decisionPath);
    fs.unlinkSync(source);
    fs.rmdirSync(scriptDirectory);
    fs.rmdirSync(schemaDirectory);
    fs.rmdirSync(episode);
  }
});

test('refuses a legacy migration without a non-empty exact authorization message', () => {
  const episode = fs.mkdtempSync(path.join(repositoryRoot, 'leverage-video/src/__legacy-create-'));
  const scriptDirectory = path.join(episode, 'script');
  const schemaDirectory = path.join(episode, 'schema');
  fs.mkdirSync(scriptDirectory);
  fs.mkdirSync(schemaDirectory);
  fs.writeFileSync(path.join(scriptDirectory, 'binding.ts'), 'export {};\n');
  try {
    const workspace = path.relative(repositoryRoot, episode);
    assert.throws(
      () => execFileSync(process.execPath, [command, workspace]),
      /authorization-message/,
    );
  } finally {
    fs.unlinkSync(path.join(scriptDirectory, 'binding.ts'));
    fs.rmdirSync(scriptDirectory);
    fs.rmdirSync(schemaDirectory);
    fs.rmdirSync(episode);
  }
});
