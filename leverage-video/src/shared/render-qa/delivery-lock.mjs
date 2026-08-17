import fs from 'node:fs';
import path from 'node:path';

import {
  assertRegularFile,
  atomicWriteJson,
  sha256File,
} from '../episode-tooling/file-integrity.mjs';
import {validateVideo} from './media-qa.mjs';

export const validateDeliveryRoleSet = (requiredRoles, outputs) => {
  const required = [...requiredRoles].sort();
  const actual = Object.keys(outputs).sort();
  if (JSON.stringify(required) !== JSON.stringify(actual)) {
    throw new Error(`delivery role mismatch: required=${required.join(',')} actual=${actual.join(',')}`);
  }
  return actual;
};

export const lockDeliveryTransaction = ({
  transactionId,
  episodeId,
  requiredRoles,
  outputs,
  manifestPath,
  videoContract,
}) => {
  const roles = validateDeliveryRoleSet(requiredRoles, outputs);
  const manifest = {
    schema_version: 'knowledge-video-delivery-transaction-v1',
    transaction_id: transactionId,
    episode_id: episodeId,
    created_at: new Date().toISOString(),
    required_delivery_roles: roles,
    subtitle_sidecar_delivered: false,
    outputs: {},
  };
  for (const role of roles) {
    const item = outputs[role];
    const source = assertRegularFile(item.source_path, {nonEmpty: true});
    const delivered = assertRegularFile(item.delivered_path, {nonEmpty: true});
    if (fs.statSync(source).size !== fs.statSync(delivered).size) {
      throw new Error(`size mismatch for ${role}`);
    }
    const checksum = sha256File(source);
    if (sha256File(delivered) !== checksum) throw new Error(`checksum mismatch for ${role}`);
    manifest.outputs[role] = {
      source_path: path.resolve(source),
      delivered_path: path.resolve(delivered),
      checksum_sha256: checksum,
      size_bytes: fs.statSync(delivered).size,
      qa: validateVideo(delivered, videoContract),
    };
  }
  atomicWriteJson(manifestPath, manifest);
  return manifest;
};
