import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const ASSET_LIFECYCLE_STATUSES = [
  'active',
  'superseded',
  'rejected',
  'recovery-source',
];

export const createAssetRecordId = ({assetId, requestFingerprint, sha256, recordedAt}) =>
  createHash('sha256')
    .update(JSON.stringify({assetId, requestFingerprint, sha256, recordedAt}))
    .digest('hex');

export const activeManifestAssets = (manifest) =>
  (manifest.assets ?? []).filter(({lifecycle}) => lifecycle?.status === 'active');

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const readManifestFile = async ({manifestFile, projectSlug, createIfMissing}) => {
  try {
    return JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT' || !createIfMissing) throw error;
    return {
      $schema: '../../schemas/assets-manifest.schema.json',
      schemaVersion: 4,
      projectSlug,
      assets: [],
    };
  }
};

const writeManifestAtomically = async (manifestFile, manifest) => {
  await fs.mkdir(path.dirname(manifestFile), {recursive: true});
  const temporary = `${manifestFile}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await fs.rename(temporary, manifestFile);
  } finally {
    await fs.rm(temporary, {force: true}).catch(() => {});
  }
};

/**
 * Serialize the complete read/mutate/validate/write cycle for assets-manifest.json.
 *
 * The callback may perform deterministic derivation work while the lock is held.
 * That is intentional: a derivation that fingerprints the source manifest must
 * commit against the same snapshot it inspected. Callers return
 * `{manifest, ...result}`; only `manifest` is persisted.
 */
export const transactAssetManifest = async ({
  manifestFile,
  projectSlug,
  createIfMissing = false,
  mutate,
}) => {
  const lockDirectory = `${manifestFile}.lock`;
  let acquired = false;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      await fs.mkdir(lockDirectory);
      acquired = true;
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const stat = await fs.stat(lockDirectory).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > 30_000) {
        await fs.rm(lockDirectory, {recursive: true, force: true});
        continue;
      }
      await wait(50);
    }
  }
  if (!acquired) {
    throw new Error('assets-manifest.json 正被其他进程更新，请稍后重试。');
  }
  const heartbeat = setInterval(() => {
    const now = new Date();
    fs.utimes(lockDirectory, now, now).catch(() => {});
  }, 5_000);
  heartbeat.unref();
  try {
    const current = assertAssetManifest(
      await readManifestFile({manifestFile, projectSlug, createIfMissing}),
      projectSlug,
    );
    const result = await mutate(structuredClone(current));
    const nextManifest = result?.manifest ?? result;
    assertAssetManifest(nextManifest, projectSlug);
    await writeManifestAtomically(manifestFile, nextManifest);
    return result;
  } finally {
    clearInterval(heartbeat);
    await fs.rm(lockDirectory, {recursive: true, force: true});
  }
};

export const assertAssetManifest = (manifest, projectSlug) => {
  if (manifest?.schemaVersion !== 4) {
    throw new Error('assets-manifest.json 必须使用 schemaVersion 4；旧项目不会自动迁移。');
  }
  if (manifest.projectSlug !== projectSlug || !Array.isArray(manifest.assets)) {
    throw new Error('assets-manifest.json 与项目不匹配。');
  }
  const recordIds = new Set();
  const activeIds = new Set();
  const semanticSliceGroups = new Map();
  for (const record of manifest.assets) {
    if (!record.recordId || recordIds.has(record.recordId)) {
      throw new Error(`资产记录 recordId 缺失或重复：${record.assetId ?? 'unknown'}`);
    }
    recordIds.add(record.recordId);
    if (!ASSET_LIFECYCLE_STATUSES.includes(record.lifecycle?.status)) {
      throw new Error(`资产 ${record.assetId} lifecycle.status 无效。`);
    }
    if (record.lifecycle.status === 'active') {
      if (activeIds.has(record.assetId)) throw new Error(`资产 ${record.assetId} 存在多个 active 记录。`);
      activeIds.add(record.assetId);
    }
    if (record.adapter === 'semantic-slice-derivative') {
      const binding = record.semanticSliceBinding;
      const source = manifest.assets.find(
        (candidate) =>
          candidate.assetId === binding?.sourceAssetId &&
          candidate.sha256 === binding?.sourceSha256,
      );
      if (
        !binding ||
        binding.schemaVersion !== 1 ||
        !source ||
        binding.outputCanvasPreserved !== true ||
        binding.boundaryCutPixels !== 0 ||
        !Array.isArray(binding.components) ||
        binding.components.length === 0 ||
        binding.outputAlphaPixels !==
          binding.components.reduce(
            (total, component) => total + component.pixelCount,
            0,
          ) ||
        record.media?.width !== source.media?.width ||
        record.media?.height !== source.media?.height
      ) {
        throw new Error(
          `资产 ${record.assetId} 的 semantic slice provenance 不完整或画布已漂移。`,
        );
      }
      if (record.lifecycle.status === 'active') {
        const key =
          `${binding.topologyId}\0${binding.sourceAssetId}\0${binding.sourceSha256}`;
        const group = semanticSliceGroups.get(key) ?? {
          sourceAlphaPixels: binding.sourceAlphaPixels,
          outputAlphaPixels: 0,
          components: new Set(),
        };
        if (group.sourceAlphaPixels !== binding.sourceAlphaPixels) {
          throw new Error(
            `semantic slice ${binding.topologyId}/${binding.sourceAssetId} source alpha 统计不一致。`,
          );
        }
        group.outputAlphaPixels += binding.outputAlphaPixels;
        for (const component of binding.components) {
          const componentKey =
            `${component.left}:${component.top}:${component.width}:${component.height}`;
          if (group.components.has(componentKey)) {
            throw new Error(
              `semantic slice ${binding.topologyId}/${binding.sourceAssetId} 重复占用组件 ${componentKey}。`,
            );
          }
          group.components.add(componentKey);
        }
        semanticSliceGroups.set(key, group);
      }
    } else if (record.semanticSliceBinding !== undefined && record.semanticSliceBinding !== null) {
      throw new Error(
        `资产 ${record.assetId} 只有 semantic-slice-derivative 才能声明 semanticSliceBinding。`,
      );
    }
    if (record.recoveredFromRejectedAttempt === true) {
      if (
        record.lifecycle.status !== 'recovery-source' ||
        record.providerObservation?.sourceAttempt?.status !== 'rejected' ||
        record.providerObservation?.sourceAttempt?.quotaConsumed !== true ||
        record.providerObservation?.sourceAttempt?.attemptId !== record.attemptId ||
        record.reusedFrom !== null
      ) {
        throw new Error(
          `资产 ${record.assetId} 的 rejected-output recovery-source provenance 不完整。`,
        );
      }
    }
  }
  for (const [key, group] of semanticSliceGroups) {
    if (group.outputAlphaPixels !== group.sourceAlphaPixels) {
      throw new Error(
        `semantic slice ${key.split('\0').slice(0, 2).join('/')} alpha 组件分配不完整：` +
        `${group.outputAlphaPixels}/${group.sourceAlphaPixels}。`,
      );
    }
  }
  return manifest;
};

export const transitionAssetLifecycle = (manifest, assetId, status, options = {}) => {
  if (!ASSET_LIFECYCLE_STATUSES.includes(status) || status === 'superseded') {
    throw new Error('显式生命周期状态必须是 active、rejected 或 recovery-source。');
  }
  const reason = (options.reason ?? '').trim();
  if (!reason) throw new Error('资产生命周期变更必须记录具体原因。');
  const records = [...(manifest.assets ?? [])].reverse()
    .filter((record) => record.assetId === assetId);
  const current = status === 'active'
    ? records.find((record) => ['rejected', 'recovery-source'].includes(record.lifecycle?.status))
    : records.find((record) => record.lifecycle?.status === 'active');
  if (!current) {
    throw new Error(status === 'active'
      ? `没有可重新激活的 rejected/recovery-source 资产记录：${assetId}`
      : `没有 active 资产记录：${assetId}`);
  }
  if (status === 'active' && records.some((record) => record.lifecycle?.status === 'active')) {
    throw new Error(`资产 ${assetId} 已有 active 记录，不能同时重新激活历史记录。`);
  }
  current.lifecycle = {
    status,
    changedAt: options.at ?? new Date().toISOString(),
    reason,
    supersededBy: null,
  };
  return current;
};
