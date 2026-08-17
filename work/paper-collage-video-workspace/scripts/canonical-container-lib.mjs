import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  activeManifestAssets,
  assertAssetManifest,
  createAssetRecordId,
} from './asset-manifest-lib.mjs';
import {hashCompositionValue} from './composition-lib.mjs';
import {
  CANONICAL_CONTAINER_RECOVERY_POLICY,
  CANONICAL_CONTAINER_SOURCE_STRATEGY,
} from './container-source-plan-lib.mjs';

const alphaThreshold = 16;

const sha256 = (value) =>
  createHash('sha256').update(value).digest('hex');

const hashFile = async (file) => sha256(await fs.readFile(file));

const workspacePath = (root, input, label) => {
  const resolved = path.resolve(root, input);
  if (
    resolved !== root &&
    !resolved.startsWith(`${root}${path.sep}`)
  ) {
    throw new Error(`${label}越过工作区：${input}`);
  }
  return resolved;
};

const outputPath = (root, input, label) => {
  const resolved = workspacePath(root, input, label);
  const publicRoot = path.join(root, 'public');
  if (
    resolved !== publicRoot &&
    !resolved.startsWith(`${publicRoot}${path.sep}`)
  ) {
    throw new Error(`${label}必须写入 public/：${input}`);
  }
  return resolved;
};

const activeRecord = (manifest, assetId) =>
  [...activeManifestAssets(manifest)]
    .reverse()
    .find((record) => record.assetId === assetId) ?? null;

const requireImageRecord = async ({
  root,
  manifest,
  assetId,
  label,
}) => {
  const record = activeRecord(manifest, assetId);
  if (
    !record ||
    record.capability !== 'image' ||
    !/^[a-f0-9]{64}$/.test(record.sha256 ?? '')
  ) {
    throw new Error(
      `${label} 必须指向 active image manifest 记录：${assetId}`,
    );
  }
  const file = workspacePath(root, record.file, label);
  if (await hashFile(file) !== record.sha256) {
    throw new Error(`${label} manifest hash 已漂移：${assetId}`);
  }
  return {record, file};
};

const boundsForAlpha = ({data, info}) => {
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (
        data[(y * info.width + x) * info.channels + 3] <=
        alphaThreshold
      ) {
        continue;
      }
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return right < left || bottom < top
    ? null
    : {
        left,
        top,
        width: right - left + 1,
        height: bottom - top + 1,
      };
};

const inspectAlpha = async (input) => {
  const {data, info} = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({resolveWithObject: true});
  return {data, info, bounds: boundsForAlpha({data, info})};
};

const polygonMask = async ({width, height, points}) => {
  const coordinates = points
    .map(
      ([x, y]) =>
        `${(x * width).toFixed(3)},${(y * height).toFixed(3)}`,
    )
    .join(' ');
  return sharp(
    Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <polygon points="${coordinates}" fill="white"/>
      </svg>
    `),
  )
    .png()
    .toBuffer();
};

const translatedCanvas = async ({
  input,
  width,
  height,
  dx,
  dy,
}) => {
  const sourceLeft = Math.max(0, -dx);
  const sourceTop = Math.max(0, -dy);
  const cropWidth = width - Math.abs(dx);
  const cropHeight = height - Math.abs(dy);
  if (cropWidth < 1 || cropHeight < 1) {
    throw new Error('容器内容对齐位移把完整状态移出了画布。');
  }
  const cropped = await sharp(input)
    .extract({
      left: sourceLeft,
      top: sourceTop,
      width: cropWidth,
      height: cropHeight,
    })
    .png()
    .toBuffer();
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: '#00000000',
    },
  })
    .composite([
      {
        input: cropped,
        left: Math.max(0, dx),
        top: Math.max(0, dy),
      },
    ])
    .png()
    .toBuffer();
};

const alphaPixelCounts = ({content, mask}) => {
  let contentPixels = 0;
  let insidePixels = 0;
  let outsidePixels = 0;
  for (let index = 0; index < content.info.width * content.info.height; index += 1) {
    const contentAlpha =
      content.data[index * content.info.channels + 3];
    if (contentAlpha <= alphaThreshold) continue;
    contentPixels += 1;
    const maskAlpha = mask.data[index * mask.info.channels + 3];
    if (maskAlpha > alphaThreshold) insidePixels += 1;
    else outsidePixels += 1;
  }
  return {contentPixels, insidePixels, outsidePixels};
};

const bottomBandCoverage = ({
  output,
  mask,
  maskBounds,
  heightRatio,
}) => {
  const bottom = maskBounds.top + maskBounds.height;
  const top = Math.max(
    maskBounds.top,
    bottom - Math.max(1, Math.round(maskBounds.height * heightRatio)),
  );
  let maskPixels = 0;
  let coveredPixels = 0;
  for (let y = top; y < bottom; y += 1) {
    for (let x = maskBounds.left; x < maskBounds.left + maskBounds.width; x += 1) {
      const index = y * mask.info.width + x;
      if (
        mask.data[index * mask.info.channels + 3] <= alphaThreshold
      ) {
        continue;
      }
      maskPixels += 1;
      if (
        output.data[index * output.info.channels + 3] >
        alphaThreshold
      ) {
        coveredPixels += 1;
      }
    }
  }
  return maskPixels === 0 ? 0 : coveredPixels / maskPixels;
};

export const validateCanonicalContainerSpec = (spec) => {
  if (
    spec?.schemaVersion !== 1 ||
    spec.sourceStrategy !== CANONICAL_CONTAINER_SOURCE_STRATEGY
  ) {
    throw new Error(
      'canonical container 必须使用 schemaVersion 1 与 canonical-frame-with-content-sheet。',
    );
  }
  if (
    !Number.isInteger(spec.registration?.canvas?.width) ||
    !Number.isInteger(spec.registration?.canvas?.height) ||
    spec.registration.canvas.width < 1 ||
    spec.registration.canvas.height < 1 ||
    spec.registration.origin !== 'top-left' ||
    !spec.registration.id ||
    !spec.registration.sourceMasterAssetId
  ) {
    throw new Error('canonical container registration.canvas 无效。');
  }
  if (
    !spec.authoritativeSurfaceId ||
    !Number.isInteger(spec.sheetLayout?.columns) ||
    spec.sheetLayout.columns < 1 ||
    spec.sheetLayout.columns > 4 ||
    !Number.isInteger(spec.sheetLayout?.rows) ||
    spec.sheetLayout.rows < 1 ||
    spec.sheetLayout.rows > 4
  ) {
    throw new Error(
      'canonical container 必须声明权威内部表面与有效的 1..4 状态表网格。',
    );
  }
  const sourceIds = [
    spec.assets?.cleanPlateAssetId,
    spec.assets?.canonicalFrameAssetId,
    spec.assets?.contentSheetAssetId,
    spec.assets?.interiorMaskAssetId,
  ];
  if (
    sourceIds.some((id) => typeof id !== 'string' || id.length === 0) ||
    new Set(sourceIds).size !== sourceIds.length ||
    !spec.assets?.interiorMaskOutput
  ) {
    throw new Error(
      'clean plate、canonical frame、content sheet 与 interior mask 必须具有不同且完整的资产/输出 id。',
    );
  }
  if (
    spec.alignmentPolicy?.mode !== 'center-bottom' ||
    ![
      'maximumTranslationX',
      'maximumTranslationY',
      'maximumCenterDrift',
      'maximumBottomGap',
      'maximumFillLevelDeviation',
      'minimumInteriorRetention',
    ].every(
      (key) =>
        Number.isFinite(spec.alignmentPolicy?.[key]) &&
        spec.alignmentPolicy[key] >= 0,
    )
  ) {
    throw new Error(
      'canonical container 必须声明完整的 center-bottom 对齐阈值。',
    );
  }
  const states = spec.states ?? [];
  if (
    states.length < 2 ||
    states.length > spec.sheetLayout.columns * spec.sheetLayout.rows
  ) {
    throw new Error('canonical container 至少需要两个内容状态。');
  }
  const ids = new Set();
  const cells = new Set();
  const outputIds = new Set();
  let previousAt = -1;
  let previousFill = -1;
  for (const state of states) {
    const cell = `${state.row}:${state.column}`;
    if (
      ids.has(state.id) ||
      cells.has(cell) ||
      outputIds.has(state.outputAssetId) ||
      !Number.isInteger(state.row) ||
      state.row < 0 ||
      state.row >= spec.sheetLayout.rows ||
      !Number.isInteger(state.column) ||
      state.column < 0 ||
      state.column >= spec.sheetLayout.columns ||
      !Number.isFinite(state.at) ||
      state.at < 0 ||
      state.at > 1 ||
      !Number.isFinite(state.fillLevel) ||
      state.fillLevel < 0 ||
      state.fillLevel > 1 ||
      !state.output ||
      state.at <= previousAt ||
      state.fillLevel <= previousFill
    ) {
      throw new Error(
        'container states 必须具有唯一 id/格位/输出，并按 at 与 fillLevel 严格递增。',
      );
    }
    ids.add(state.id);
    cells.add(cell);
    outputIds.add(state.outputAssetId);
    previousAt = state.at;
    previousFill = state.fillLevel;
  }
  if (
    spec.terminalStateId !== states.at(-1).id ||
    spec.interiorShape?.kind !== 'polygon' ||
    !Array.isArray(spec.interiorShape?.points) ||
    spec.interiorShape.points.length < 4 ||
    spec.interiorShape.points.some(
      (point) =>
        !Array.isArray(point) ||
        point.length !== 2 ||
        point.some(
          (value) =>
            !Number.isFinite(value) ||
            value < 0 ||
            value > 1,
        ),
    )
  ) {
    throw new Error(
      'terminalStateId 必须是最后状态，且 interiorShape 必须是 polygon。',
    );
  }
  if (
    ![
      spec.terminalPolicy?.minimumFillLevel,
      spec.terminalPolicy?.maximumRimGap,
      spec.terminalPolicy?.minimumBottomBandCoverage,
    ].every(
      (value) =>
        Number.isFinite(value) &&
        value >= 0 &&
        value <= 1,
    ) ||
    !(
      Number.isFinite(spec.terminalPolicy?.bottomBandHeight) &&
      spec.terminalPolicy.bottomBandHeight > 0 &&
      spec.terminalPolicy.bottomBandHeight <= 0.2
    )
  ) {
    throw new Error(
      'canonical container terminalPolicy 必须声明可量化的 fill/rim/bottom 阈值。',
    );
  }
  if (
    Object.entries(CANONICAL_CONTAINER_RECOVERY_POLICY).some(
      ([key, value]) => spec.recoveryPolicy?.[key] !== value,
    ) ||
    Object.keys(spec.recoveryPolicy ?? {}).length !==
      Object.keys(CANONICAL_CONTAINER_RECOVERY_POLICY).length
  ) {
    throw new Error(
      'canonical container recoveryPolicy 必须保留完整状态表上下文并禁止独立状态生成。',
    );
  }
};

const assertTransparentPixels = async (file, label) => {
  const {data, info} = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({resolveWithObject: true});
  if (
    info.channels < 4 ||
    !data.some(
      (_, index) =>
        index % info.channels === info.channels - 1 &&
        data[index] < 250,
    )
  ) {
    throw new Error(
      `${label} 必须包含真实透明像素，不能是带背景或烘焙棋盘格的完整画面。`,
    );
  }
};

const stateMetrics = async ({
  cell,
  maskBuffer,
  canvas,
  expectedFillLevel,
  alignmentPolicy,
  terminalPolicy,
}) => {
  const raw = await inspectAlpha(cell);
  const mask = await inspectAlpha(maskBuffer);
  if (!raw.bounds || !mask.bounds) {
    throw new Error('容器内容状态或 interior mask 为空。');
  }
  const rawCenter =
    raw.bounds.left + raw.bounds.width / 2;
  const maskCenter =
    mask.bounds.left + mask.bounds.width / 2;
  const rawBottom = raw.bounds.top + raw.bounds.height;
  const maskBottom = mask.bounds.top + mask.bounds.height;
  const dx = Math.round(maskCenter - rawCenter);
  const dy = Math.round(maskBottom - rawBottom);
  if (
    Math.abs(dx) >
      alignmentPolicy.maximumTranslationX * canvas.width ||
    Math.abs(dy) >
      alignmentPolicy.maximumTranslationY * canvas.height
  ) {
    throw new Error(
      `内容状态需要平移 ${dx}px/${dy}px，超过 center-bottom 自动修复上限。`,
    );
  }
  const translated = await translatedCanvas({
    input: cell,
    width: canvas.width,
    height: canvas.height,
    dx,
    dy,
  });
  const aligned = await inspectAlpha(translated);
  const counts = alphaPixelCounts({content: aligned, mask});
  const interiorRetention =
    counts.contentPixels === 0
      ? 0
      : counts.insidePixels / counts.contentPixels;
  const outputBuffer = await sharp(translated)
    .composite([{input: maskBuffer, blend: 'dest-in'}])
    .png()
    .toBuffer();
  const output = await inspectAlpha(outputBuffer);
  if (!output.bounds) throw new Error('内腔遮罩移除了全部内容。');
  const outputCenter =
    output.bounds.left + output.bounds.width / 2;
  const outputBottom =
    output.bounds.top + output.bounds.height;
  const centerDrift =
    Math.abs(outputCenter - maskCenter) /
    Math.max(1, mask.bounds.width);
  const bottomGap =
    Math.abs(maskBottom - outputBottom) /
    Math.max(1, mask.bounds.height);
  const fillLevel = Math.max(
    0,
    Math.min(
      1,
      (maskBottom - output.bounds.top) /
        Math.max(1, mask.bounds.height),
    ),
  );
  const rimGap = Math.max(
    0,
    Math.min(
      1,
      (output.bounds.top - mask.bounds.top) /
        Math.max(1, mask.bounds.height),
    ),
  );
  const afterCounts = alphaPixelCounts({content: output, mask});
  const metrics = {
    rawBounds: raw.bounds,
    alignedBounds: aligned.bounds,
    maskBounds: mask.bounds,
    translation: {x: dx, y: dy},
    centerDrift,
    bottomGap,
    fillLevel,
    fillLevelDeviation: Math.abs(fillLevel - expectedFillLevel),
    rimGap,
    bottomBandCoverage: bottomBandCoverage({
      output,
      mask,
      maskBounds: mask.bounds,
      heightRatio: terminalPolicy.bottomBandHeight,
    }),
    interiorRetention,
    clippedPixels: counts.outsidePixels,
    outsideMaskPixels: afterCounts.outsidePixels,
  };
  if (
    metrics.centerDrift > alignmentPolicy.maximumCenterDrift ||
    metrics.bottomGap > alignmentPolicy.maximumBottomGap ||
    metrics.fillLevelDeviation >
      alignmentPolicy.maximumFillLevelDeviation ||
    metrics.interiorRetention <
      alignmentPolicy.minimumInteriorRetention ||
    metrics.outsideMaskPixels !== 0
  ) {
    throw new Error(
      `内容状态对齐/遮罩/水位不合格：${JSON.stringify(metrics)}`,
    );
  }
  return {outputBuffer, metrics};
};

const sourceBinding = ({
  spec,
  familyFingerprint,
  role,
  stateId = null,
  authoritativeSurfaceId = null,
  metrics = null,
  hashes,
}) => ({
  schemaVersion: 1,
  familyId: spec.familyId,
  sourcePackageId: spec.sourcePackageId,
  sourceStrategy: spec.sourceStrategy,
  registrationId: spec.registration.id,
  sourceMasterAssetId: spec.registration.sourceMasterAssetId,
  canvas: spec.registration.canvas,
  origin: spec.registration.origin,
  role,
  stateId,
  authoritativeSurfaceId,
  canonicalFrameAssetId: spec.assets.canonicalFrameAssetId,
  canonicalFrameSha256: hashes.frame,
  cleanPlateAssetId: spec.assets.cleanPlateAssetId,
  cleanPlateSha256: hashes.plate,
  contentSheetAssetId: spec.assets.contentSheetAssetId,
  contentSheetSha256: hashes.sheet,
  interiorMaskAssetId: spec.assets.interiorMaskAssetId,
  interiorMaskSha256: hashes.mask,
  interiorShape: spec.interiorShape,
  alignmentPolicy: spec.alignmentPolicy,
  metrics,
  terminalStateId: spec.terminalStateId,
  terminalPolicy: spec.terminalPolicy,
  recoveryPolicy: spec.recoveryPolicy,
  familyFingerprint,
});

const derivedRecord = ({
  spec,
  assetId,
  file,
  sha,
  sizeBytes,
  media,
  reusedFrom,
  binding,
  now,
  outputRole,
  semanticBinding,
  sourceSheetAssetId = null,
}) => {
  const requestFingerprint = sha256(
    `${binding.familyFingerprint}\0${assetId}\0${sha}`,
  );
  return {
    recordId: createAssetRecordId({
      assetId,
      requestFingerprint,
      sha256: sha,
      recordedAt: now,
    }),
    assetId,
    capability: 'image',
    file,
    provider: 'local-derivation',
    adapter: 'canonical-container-derivative',
    tool: 'derive-canonical-container',
    model: null,
    externalId: null,
    attemptId: null,
    requestFingerprint,
    reusedFrom,
    sha256: sha,
    sizeBytes,
    media,
    recordedAt: now,
    request: {},
    compositionBinding: {
      sceneId: spec.sceneId,
      nodeId: spec.groupId,
      pattern: 'canonical-container',
      registrationId: spec.registration.id,
      sourceMasterAssetId: spec.registration.sourceMasterAssetId,
      outputRole,
      canvas: spec.registration.canvas,
      derivation: {
        method: 'mask-application',
        parentAssetId: reusedFrom,
      },
    },
    stateBinding: null,
    stateSheetBinding: null,
    stateSheetRecoveryBinding: null,
    sourceSheetAssetId,
    registeredFamilyBinding: null,
    containerPackageBinding: null,
    canonicalContainerBinding: binding,
    semanticBinding,
    familyFingerprint: binding.familyFingerprint,
    lifecycle: {
      status: 'active',
      changedAt: now,
      reason: 'canonical-container-local-derivative',
      supersededBy: null,
    },
  };
};

export const deriveCanonicalContainer = async ({
  root,
  spec,
  manifest: manifestInput,
  now = new Date().toISOString(),
}) => {
  validateCanonicalContainerSpec(spec);
  const manifest = assertAssetManifest(
    structuredClone(manifestInput),
    spec.projectSlug,
  );
  const [plate, frame, sheet] = await Promise.all([
    requireImageRecord({
      root,
      manifest,
      assetId: spec.assets.cleanPlateAssetId,
      label: 'clean plate',
    }),
    requireImageRecord({
      root,
      manifest,
      assetId: spec.assets.canonicalFrameAssetId,
      label: 'canonical frame',
    }),
    requireImageRecord({
      root,
      manifest,
      assetId: spec.assets.contentSheetAssetId,
      label: 'content state sheet',
    }),
  ]);
  const canvas = spec.registration.canvas;
  const [plateMetadata, frameMetadata, sheetMetadata] =
    await Promise.all([
      sharp(plate.file).metadata(),
      sharp(frame.file).metadata(),
      sharp(sheet.file).metadata(),
    ]);
  if (
    plateMetadata.width !== canvas.width ||
    plateMetadata.height !== canvas.height ||
    frameMetadata.width !== canvas.width ||
    frameMetadata.height !== canvas.height ||
    sheetMetadata.width !==
      canvas.width * spec.sheetLayout.columns ||
    sheetMetadata.height !== canvas.height * spec.sheetLayout.rows
  ) {
    throw new Error(
      'clean plate/canonical frame 必须等于注册画布，content sheet 必须等于注册画布乘网格。',
    );
  }
  if (!frameMetadata.hasAlpha) {
    throw new Error(
      'canonical frame 必须包含透明区域，不能是带背景的另一张完整瓶子图。',
    );
  }
  await Promise.all([
    assertTransparentPixels(frame.file, 'canonical frame'),
    assertTransparentPixels(sheet.file, 'content state sheet'),
  ]);
  const maskBuffer = await polygonMask({
    width: canvas.width,
    height: canvas.height,
    points: spec.interiorShape.points,
  });
  const maskFile = outputPath(
    root,
    spec.assets.interiorMaskOutput,
    'interior mask output',
  );
  const stateDerivatives = [];
  for (const state of spec.states) {
    const cell = await sharp(sheet.file)
      .extract({
        left: state.column * canvas.width,
        top: state.row * canvas.height,
        width: canvas.width,
        height: canvas.height,
      })
      .png()
      .toBuffer();
    const derived = await stateMetrics({
      cell,
      maskBuffer,
      canvas,
      expectedFillLevel: state.fillLevel,
      alignmentPolicy: spec.alignmentPolicy,
      terminalPolicy: spec.terminalPolicy,
    });
    const file = outputPath(
      root,
      state.output,
      `container state ${state.id} output`,
    );
    stateDerivatives.push({
      spec: state,
      file,
      buffer: derived.outputBuffer,
      sha256: sha256(derived.outputBuffer),
      metrics: derived.metrics,
    });
  }
  const terminal = stateDerivatives.find(
    ({spec: state}) => state.id === spec.terminalStateId,
  );
  if (
    !terminal ||
    terminal.metrics.fillLevel <
      spec.terminalPolicy.minimumFillLevel ||
    terminal.metrics.rimGap >
      spec.terminalPolicy.maximumRimGap ||
    terminal.metrics.bottomBandCoverage <
      spec.terminalPolicy.minimumBottomBandCoverage
  ) {
    throw new Error(
      `容器终态未达到可量化目标：${JSON.stringify(terminal?.metrics ?? null)}`,
    );
  }
  const maskHash = sha256(maskBuffer);
  const familyFingerprint = hashCompositionValue({
    contract: 'canonical-container-family-v1',
    spec: {...spec, applyToProject: undefined},
    sources: {
      plate: plate.record.sha256,
      frame: frame.record.sha256,
      sheet: sheet.record.sha256,
    },
    mask: maskHash,
    states: stateDerivatives.map(
      ({spec: state, sha256: stateSha, metrics}) => ({
        id: state.id,
        fillLevel: state.fillLevel,
        sha256: stateSha,
        metrics,
      }),
    ),
  });
  const hashes = {
    plate: plate.record.sha256,
    frame: frame.record.sha256,
    sheet: sheet.record.sha256,
    mask: maskHash,
  };
  await fs.mkdir(path.dirname(maskFile), {recursive: true});
  await fs.writeFile(maskFile, maskBuffer);
  for (const state of stateDerivatives) {
    await fs.mkdir(path.dirname(state.file), {recursive: true});
    await fs.writeFile(state.file, state.buffer);
  }
  const maskStat = await fs.stat(maskFile);
  const maskBinding = sourceBinding({
    spec,
    familyFingerprint,
    role: 'interior-mask',
    hashes,
  });
  const maskRecord = derivedRecord({
    spec,
    assetId: spec.assets.interiorMaskAssetId,
    file: path.relative(root, maskFile),
    sha: maskHash,
    sizeBytes: maskStat.size,
    media: {
      width: canvas.width,
      height: canvas.height,
      format: 'png',
      hasAlpha: true,
    },
    reusedFrom: spec.assets.canonicalFrameAssetId,
    binding: maskBinding,
    now,
    outputRole: 'container-interior-mask',
    semanticBinding:
      frame.record.semanticBinding ??
      frame.record.request?.semanticBinding ??
      null,
    sourceSheetAssetId: null,
  });
  const stateRecords = [];
  for (const state of stateDerivatives) {
    const stat = await fs.stat(state.file);
    const binding = sourceBinding({
      spec,
      familyFingerprint,
      role: 'content-state',
      stateId: state.spec.id,
      authoritativeSurfaceId:
        spec.authoritativeSurfaceId,
      metrics: state.metrics,
      hashes,
    });
    stateRecords.push(
      derivedRecord({
        spec,
        assetId: state.spec.outputAssetId,
        file: path.relative(root, state.file),
        sha: state.sha256,
        sizeBytes: stat.size,
        media: {
          width: canvas.width,
          height: canvas.height,
          format: 'png',
          hasAlpha: true,
        },
        reusedFrom: spec.assets.contentSheetAssetId,
        binding,
        now,
        outputRole: 'container-content-state',
        semanticBinding:
          sheet.record.semanticBinding ??
          sheet.record.request?.semanticBinding ??
          null,
        sourceSheetAssetId: spec.assets.contentSheetAssetId,
      }),
    );
  }
  const sourceRoles = [
    [plate.record, 'clean-plate'],
    [frame.record, 'canonical-frame'],
    [sheet.record, 'content-state-sheet'],
  ];
  for (const [record, role] of sourceRoles) {
    record.canonicalContainerBinding = sourceBinding({
      spec,
      familyFingerprint,
      role,
      hashes,
    });
    record.containerPackageBinding =
      record.containerPackageBinding ??
      record.request?.containerPackageBinding ??
      null;
    record.familyFingerprint = familyFingerprint;
  }
  const records = [maskRecord, ...stateRecords];
  const replacements = new Map(
    records.map((record) => [record.assetId, record]),
  );
  for (const previous of manifest.assets.filter(
    ({assetId, lifecycle}) =>
      replacements.has(assetId) &&
      lifecycle?.status === 'active',
  )) {
    previous.lifecycle = {
      status: 'superseded',
      changedAt: now,
      reason: 'replaced-by-new-canonical-container-derivative',
      supersededBy: replacements.get(previous.assetId).recordId,
    };
  }
  manifest.assets.push(...records);
  assertAssetManifest(manifest, spec.projectSlug);
  const providerRoots = [plate.record, frame.record, sheet.record];
  const providerImageCalls = providerRoots.filter(
    ({adapter, reusedFrom}) =>
      ['host', 'command'].includes(adapter) && !reusedFrom,
  ).length;
  return {
    manifest,
    records,
    familyFingerprint,
    report: {
      schemaVersion: 1,
      projectSlug: spec.projectSlug,
      sceneId: spec.sceneId,
      groupId: spec.groupId,
      familyId: spec.familyId,
      sourcePackageId: spec.sourcePackageId,
      sourceStrategy: spec.sourceStrategy,
      registration: spec.registration,
      familyFingerprint,
      providerImageCalls,
      localDerivatives: records.length,
      avoidedCalls: Math.max(1, spec.states.length - 1),
      sourceAssetIds: providerRoots.map(({assetId}) => assetId),
      interiorMask: {
        assetId: maskRecord.assetId,
        file: maskRecord.file,
        sha256: maskRecord.sha256,
      },
      states: stateRecords.map((record) => ({
        stateId: record.canonicalContainerBinding.stateId,
        assetId: record.assetId,
        file: record.file,
        sha256: record.sha256,
        metrics: record.canonicalContainerBinding.metrics,
      })),
      terminalStateId: spec.terminalStateId,
      terminalPolicy: spec.terminalPolicy,
      recoveryPolicy: spec.recoveryPolicy,
    },
  };
};

const publicSource = (file) =>
  path.normalize(file)
    .replace(/^public[\\/]/, '')
    .split(path.sep)
    .join('/');

export const applyCanonicalContainerToProject = ({
  project,
  spec,
  manifest,
  records,
}) => {
  const scene = project.scenes?.find(({id}) => id === spec.sceneId);
  const group = scene?.composition?.nodes
    ?.flatMap(function flatten(node) {
      return [
        node,
        ...(node.kind === 'group'
          ? node.children.flatMap(flatten)
          : []),
      ];
    })
    .find(({id}) => id === spec.groupId);
  if (
    !scene ||
    group?.kind !== 'group' ||
    group.pattern !== 'canonical-container'
  ) {
    throw new Error(
      `找不到 canonical-container group：${spec.sceneId}/${spec.groupId}`,
    );
  }
  const cleanPlate = group.children.find(
    ({slot}) => slot === 'container-clean-plate',
  );
  const frame = group.children.find(
    ({slot}) => slot === 'container-frame',
  );
  const contents = group.children.find(
    ({slot}) => slot === 'container-contents',
  );
  if (
    cleanPlate?.kind !== 'asset' ||
    frame?.kind !== 'asset' ||
    contents?.kind !== 'state-sequence' ||
    group.children.length !== 3
  ) {
    throw new Error(
      'applyToProject 前 group 必须预置 plate/contents/frame 三个语义槽。',
    );
  }
  const plateRecord = activeRecord(
    manifest,
    spec.assets.cleanPlateAssetId,
  );
  const frameRecord = activeRecord(
    manifest,
    spec.assets.canonicalFrameAssetId,
  );
  const recordByStateId = new Map(
    records
      .filter(
        ({canonicalContainerBinding}) =>
          canonicalContainerBinding?.role === 'content-state',
      )
      .map((record) => [
        record.canonicalContainerBinding.stateId,
        record,
      ]),
  );
  group.registration = spec.registration;
  cleanPlate.src = publicSource(plateRecord.file);
  cleanPlate.registrationId = spec.registration.id;
  cleanPlate.semanticCoverage = [
    `container-clean-plate:${spec.familyId}`,
  ];
  frame.src = publicSource(frameRecord.file);
  frame.registrationId = spec.registration.id;
  frame.semanticCoverage = [
    `container-frame:${spec.familyId}`,
  ];
  contents.poseFamilyId = spec.familyId;
  contents.registration = spec.registration;
  contents.anchorPolicy = {
    requiredAnchorIds: ['content-bottom'],
    maximumDrift: Math.max(
      spec.alignmentPolicy.maximumCenterDrift,
      spec.alignmentPolicy.maximumBottomGap,
    ),
  };
  contents.states = spec.states.map((state) => {
    const record = recordByStateId.get(state.id);
    if (!record) throw new Error(`缺少派生内容状态：${state.id}`);
    const bounds =
      record.canonicalContainerBinding.metrics.alignedBounds;
    return {
      id: state.id,
      src: publicSource(record.file),
      at: state.at,
      facing: 'neutral',
      anchors: [
        {
          id: 'content-bottom',
          x:
            (bounds.left + bounds.width / 2) /
            spec.registration.canvas.width,
          y:
            (bounds.top + bounds.height) /
            spec.registration.canvas.height,
        },
      ],
      identityReferenceAssetId:
        spec.assets.canonicalFrameAssetId,
      identityReferenceSha256: frameRecord.sha256,
    };
  });
  contents.playback = {mode: 'once', cycles: 1};
  contents.transition = contents.transition ?? {
    type: 'cut',
    durationSeconds: 0,
  };
  contents.semanticCoverage = [
    `container-surface:${
      recordByStateId.get(spec.states[0].id)
        .canonicalContainerBinding.authoritativeSurfaceId
    }`,
  ];
  const maskRecord = records.find(
    ({assetId}) => assetId === spec.assets.interiorMaskAssetId,
  );
  const stateContracts = spec.states.map((state) => {
    const record = recordByStateId.get(state.id);
    return {
      id: state.id,
      fillLevel: state.fillLevel,
      assetId: record.assetId,
      sha256: record.sha256,
      metrics: record.canonicalContainerBinding.metrics,
    };
  });
  group.canonicalContainer = {
    schemaVersion: 1,
    familyId: spec.familyId,
    sourcePackageId: spec.sourcePackageId,
    sourceStrategy: spec.sourceStrategy,
    familyFingerprint: records[0].canonicalContainerBinding
      .familyFingerprint,
    cleanPlateNodeId: cleanPlate.id,
    canonicalFrameNodeId: frame.id,
    contentsNodeId: contents.id,
    cleanPlateAssetId: plateRecord.assetId,
    cleanPlateSha256: plateRecord.sha256,
    canonicalFrameAssetId: frameRecord.assetId,
    canonicalFrameSha256: frameRecord.sha256,
    contentSheetAssetId: spec.assets.contentSheetAssetId,
    contentSheetSha256: activeRecord(
      manifest,
      spec.assets.contentSheetAssetId,
    ).sha256,
    interiorMaskAssetId: maskRecord.assetId,
    interiorMaskSha256: maskRecord.sha256,
    authoritativeSurfaceId:
      recordByStateId.get(spec.states[0].id)
        .canonicalContainerBinding.authoritativeSurfaceId,
    interiorShape: spec.interiorShape,
    alignmentPolicy: spec.alignmentPolicy,
    states: stateContracts,
    terminalStateId: spec.terminalStateId,
    terminalPolicy: spec.terminalPolicy,
    recoveryPolicy: spec.recoveryPolicy,
  };
  return group;
};

const recordForSource = (root, manifest, source) =>
  activeManifestAssets(manifest).find(
    ({file}) =>
      path.normalize(file) ===
      path.normalize(
        path.join('public', source),
      ),
  ) ?? null;

export const inspectCanonicalContainerGroupMembers = async ({
  root,
  group,
  manifest,
}) => {
  const errors = [];
  const contract = group?.canonicalContainer;
  if (
    group?.pattern !== 'canonical-container' ||
    !contract
  ) {
    return {
      passed: false,
      errors: ['group 不是已绑定的 canonical-container'],
      records: [],
    };
  }
  const cleanPlate = group.children.find(
    ({id}) => id === contract.cleanPlateNodeId,
  );
  const frame = group.children.find(
    ({id}) => id === contract.canonicalFrameNodeId,
  );
  const contents = group.children.find(
    ({id}) => id === contract.contentsNodeId,
  );
  const stateRecords =
    contents?.kind === 'state-sequence'
      ? contents.states.map(({src}) =>
          recordForSource(root, manifest, src),
        )
      : [];
  const records = [
    recordForSource(root, manifest, cleanPlate?.src ?? ''),
    recordForSource(root, manifest, frame?.src ?? ''),
    activeRecord(manifest, contract.contentSheetAssetId),
    activeRecord(manifest, contract.interiorMaskAssetId),
    ...stateRecords,
  ];
  if (records.some((record) => !record)) {
    errors.push('container 运行时成员或 source package 缺少 active manifest 记录');
  }
  const expectedRoles = [
    'clean-plate',
    'canonical-frame',
    'content-state-sheet',
    'interior-mask',
    ...stateRecords.map(() => 'content-state'),
  ];
  for (const [index, record] of records.entries()) {
    const binding = record?.canonicalContainerBinding;
    if (
      binding?.familyId !== contract.familyId ||
      binding?.familyFingerprint !== contract.familyFingerprint ||
      binding?.role !== expectedRoles[index]
    ) {
      errors.push(
        `${record?.assetId ?? 'missing'} canonicalContainerBinding 角色、家族或 fingerprint 不一致`,
      );
      continue;
    }
    const file = workspacePath(root, record.file, 'container member');
    if (await hashFile(file) !== record.sha256) {
      errors.push(`${record.assetId} 文件 hash 已漂移`);
    }
  }
  if (
    records[0]?.assetId !== contract.cleanPlateAssetId ||
    records[0]?.sha256 !== contract.cleanPlateSha256 ||
    records[1]?.assetId !== contract.canonicalFrameAssetId ||
    records[1]?.sha256 !== contract.canonicalFrameSha256 ||
    records[2]?.assetId !== contract.contentSheetAssetId ||
    records[2]?.sha256 !== contract.contentSheetSha256 ||
    records[3]?.assetId !== contract.interiorMaskAssetId ||
    records[3]?.sha256 !== contract.interiorMaskSha256
  ) {
    errors.push('container authoritative source id/hash 与运行时合同不一致');
  }
  for (const [index, state] of (
    contract.states ?? []
  ).entries()) {
    const record = stateRecords[index];
    if (
      !record ||
      record.assetId !== state.assetId ||
      record.sha256 !== state.sha256 ||
      record.canonicalContainerBinding?.stateId !== state.id ||
      JSON.stringify(
        record.canonicalContainerBinding?.metrics,
      ) !== JSON.stringify(state.metrics)
    ) {
      errors.push(`container state ${state.id} 的 hash/metrics 已漂移`);
    }
  }
  return {passed: errors.length === 0, errors, records};
};

const labeledPanel = async ({
  image,
  label,
  width = 480,
  height = 300,
}) => {
  const bodyHeight = height - 36;
  const body = await sharp(image)
    .resize(width, bodyHeight, {
      fit: 'contain',
      background: '#e9e1d2',
    })
    .png()
    .toBuffer();
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: '#2d2925',
    },
  })
    .composite([
      {input: body, left: 0, top: 36},
      {
        input: Buffer.from(`
          <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="36">
            <text x="12" y="25" fill="white" font-size="18" font-family="sans-serif">${label.replace(/[<>&]/g, '')}</text>
          </svg>
        `),
        left: 0,
        top: 0,
      },
    ])
    .png()
    .toBuffer();
};

export const buildCanonicalContainerProof = async ({
  root,
  group,
  manifest,
  directory,
  evidenceId,
}) => {
  const inspection = await inspectCanonicalContainerGroupMembers({
    root,
    group,
    manifest,
  });
  if (!inspection.passed) {
    return {
      passed: false,
      checks: [
        {
          id: 'container-family-current',
          passed: false,
          actual: inspection.errors,
        },
      ],
      artifacts: {},
      artifactHashes: {},
    };
  }
  await fs.mkdir(directory, {recursive: true});
  const contract = group.canonicalContainer;
  const cleanPlate = group.children.find(
    ({id}) => id === contract.cleanPlateNodeId,
  );
  const frame = group.children.find(
    ({id}) => id === contract.canonicalFrameNodeId,
  );
  const contents = group.children.find(
    ({id}) => id === contract.contentsNodeId,
  );
  const plateFile = workspacePath(
    root,
    recordForSource(root, manifest, cleanPlate.src).file,
    'clean plate proof',
  );
  const frameFile = workspacePath(
    root,
    recordForSource(root, manifest, frame.src).file,
    'canonical frame proof',
  );
  const maskFile = workspacePath(
    root,
    activeRecord(manifest, contract.interiorMaskAssetId).file,
    'interior mask proof',
  );
  const stateComposites = [];
  for (const [index, state] of contents.states.entries()) {
    const stateFile = workspacePath(
      root,
      recordForSource(root, manifest, state.src).file,
      `container state ${state.id}`,
    );
    const composite = await sharp(plateFile)
      .composite([
        {input: stateFile},
        {input: frameFile},
      ])
      .png()
      .toBuffer();
    stateComposites.push(
      await labeledPanel({
        image: composite,
        label:
          `${state.id} · declared ${contract.states[index].fillLevel.toFixed(3)} · measured ${contract.states[index].metrics.fillLevel.toFixed(3)}`,
      }),
    );
  }
  const columns = Math.min(3, stateComposites.length);
  const rows = Math.ceil(stateComposites.length / columns);
  const progressionFile = path.join(
    directory,
    `${evidenceId}-state-progression.png`,
  );
  await sharp({
    create: {
      width: columns * 480,
      height: rows * 300,
      channels: 4,
      background: '#171513',
    },
  })
    .composite(
      stateComposites.map((input, index) => ({
        input,
        left: (index % columns) * 480,
        top: Math.floor(index / columns) * 300,
      })),
    )
    .png()
    .toFile(progressionFile);
  const maskAlpha = await sharp(maskFile)
    .extractChannel('alpha')
    .linear(0.42)
    .png()
    .toBuffer();
  const maskTint = await sharp(maskFile)
    .removeAlpha()
    .tint('#00d9ff')
    .joinChannel(maskAlpha)
    .png()
    .toBuffer();
  const maskOverlayFile = path.join(
    directory,
    `${evidenceId}-mask-overlay.png`,
  );
  await sharp(plateFile)
    .composite([
      {input: maskTint, blend: 'over'},
      {input: frameFile},
    ])
    .png()
    .toFile(maskOverlayFile);
  const terminalIndex = contract.states.findIndex(
    ({id}) => id === contract.terminalStateId,
  );
  const terminalFile = path.join(
    directory,
    `${evidenceId}-terminal.png`,
  );
  await sharp(stateComposites[terminalIndex])
    .png()
    .toFile(terminalFile);
  const artifacts = {
    maskOverlay: maskOverlayFile,
    stateProgression: progressionFile,
    terminalState: terminalFile,
  };
  const checks = [
    {
      id: 'container-family-current',
      passed: true,
      actual: contract.familyFingerprint,
    },
    {
      id: 'container-single-authoritative-frame',
      passed:
        group.children.filter(
          ({slot}) => slot === 'container-frame',
        ).length === 1,
      actual: group.children.map(({id, slot}) => ({id, slot})),
    },
    {
      id: 'container-single-authoritative-surface',
      passed:
        group.children.filter(({semanticCoverage = []}) =>
          semanticCoverage.includes(
            `container-surface:${contract.authoritativeSurfaceId}`,
          ),
        ).length === 1,
      actual: contract.authoritativeSurfaceId,
    },
    {
      id: 'container-states-aligned-and-masked',
      passed: contract.states.every(
        ({metrics}) =>
          metrics.outsideMaskPixels === 0 &&
          metrics.centerDrift <=
            contract.alignmentPolicy.maximumCenterDrift &&
          metrics.bottomGap <=
            contract.alignmentPolicy.maximumBottomGap &&
          metrics.fillLevelDeviation <=
            contract.alignmentPolicy
              .maximumFillLevelDeviation &&
          metrics.interiorRetention >=
            contract.alignmentPolicy.minimumInteriorRetention,
      ),
      actual: contract.states.map(({id, metrics}) => ({
        id,
        metrics,
      })),
    },
    {
      id: 'container-terminal-measurable',
      passed:
        terminalIndex >= 0 &&
        contract.states[terminalIndex].metrics.fillLevel >=
          contract.terminalPolicy.minimumFillLevel &&
        contract.states[terminalIndex].metrics.rimGap <=
          contract.terminalPolicy.maximumRimGap &&
        contract.states[terminalIndex].metrics
          .bottomBandCoverage >=
          contract.terminalPolicy.minimumBottomBandCoverage,
      actual:
        terminalIndex >= 0
          ? contract.states[terminalIndex].metrics
          : null,
    },
  ];
  return {
    passed: checks.every(({passed}) => passed),
    checks,
    artifacts,
    artifactHashes: Object.fromEntries(
      await Promise.all(
        Object.values(artifacts).map(async (file) => [
          file,
          await hashFile(file),
        ]),
      ),
    ),
  };
};
