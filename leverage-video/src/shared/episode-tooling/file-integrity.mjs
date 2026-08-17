import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const assertRegularFile = (file, {nonEmpty = false} = {}) => {
  const resolved = path.resolve(file);
  const linkStatus = fs.lstatSync(resolved);
  if (linkStatus.isSymbolicLink()) throw new Error(`symbolic link is forbidden: ${file}`);
  if (!linkStatus.isFile()) throw new Error(`regular file required: ${file}`);
  if (nonEmpty && linkStatus.size === 0) throw new Error(`non-empty file required: ${file}`);
  return resolved;
};

export const sha256File = (file) => {
  const resolved = assertRegularFile(file);
  return crypto.createHash('sha256').update(fs.readFileSync(resolved)).digest('hex');
};

export const verifyFileChecksum = (file, expectedChecksum) => {
  if (!/^[a-f0-9]{64}$/.test(expectedChecksum)) {
    throw new Error(`invalid SHA-256 checksum for ${file}`);
  }
  const actualChecksum = sha256File(file);
  if (actualChecksum !== expectedChecksum) {
    throw new Error(`checksum mismatch: ${file}`);
  }
  return actualChecksum;
};

export const readJson = (file) => JSON.parse(
  fs.readFileSync(assertRegularFile(file, {nonEmpty: true}), 'utf8'),
);

export const atomicWriteJson = (file, value) => {
  const resolved = path.resolve(file);
  fs.mkdirSync(path.dirname(resolved), {recursive: true});
  const temporary = `${resolved}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, resolved);
  return resolved;
};
