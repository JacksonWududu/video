import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assertRegularFile,
  atomicWriteJson,
  readJson,
  sha256File,
} from './file-integrity.mjs';

test('hashes, validates, and atomically writes regular files', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-integrity-'));
  const source = path.join(directory, 'source.txt');
  const output = path.join(directory, 'output.json');
  fs.writeFileSync(source, 'shared\n');

  assert.equal(
    sha256File(source),
    'cf99975aa7995fad86fae7f3b0905143f30a52501944dff26002afc99c3b8419',
  );
  assert.equal(assertRegularFile(source, {nonEmpty: true}), path.resolve(source));
  atomicWriteJson(output, {status: 'pass'});
  assert.deepEqual(readJson(output), {status: 'pass'});
  assert.equal(fs.existsSync(`${output}.tmp`), false);
});

test('rejects symbolic links', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-integrity-link-'));
  const source = path.join(directory, 'source.txt');
  const link = path.join(directory, 'source-link.txt');
  fs.writeFileSync(source, 'shared\n');
  fs.symlinkSync(source, link);
  assert.throws(() => assertRegularFile(link), /symbolic link/);
});
