import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const ROLE_ORDER = ['support-rear', 'subject', 'support-front'];
const PROFILE_SIZES = {
  '16:9': {width: 640, height: 360},
  '9:16': {width: 360, height: 640},
  '1:1': {width: 480, height: 480},
};

const sha256File = async (file) =>
  createHash('sha256').update(await fs.readFile(file)).digest('hex');

const checkerboard = ({width, height, cell = 20}) => Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <pattern id="checker" width="${cell * 2}" height="${cell * 2}" patternUnits="userSpaceOnUse">
        <rect width="${cell * 2}" height="${cell * 2}" fill="#f3f0e8"/>
        <rect width="${cell}" height="${cell}" fill="#c8c4ba"/>
        <rect x="${cell}" y="${cell}" width="${cell}" height="${cell}" fill="#c8c4ba"/>
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#checker)"/>
  </svg>
`);

const dataUrlFor = async (file) =>
  `data:image/png;base64,${(
    await sharp(file).ensureAlpha().png().toBuffer()
  ).toString('base64')}`;

const safeText = (value) =>
  String(value).replace(/[<>&"]/g, '');

const sceneCarrierRect = ({group, width, height}) => {
  if (group?.stackingContext !== 'scene') return null;
  const transform = group.transform ?? {};
  const values = [
    transform.x,
    transform.y,
    transform.width,
    transform.height,
    transform.anchorX,
    transform.anchorY,
  ];
  if (!values.every(Number.isFinite)) {
    throw new Error(
      `scene-stacked registered-depth-stack ${group.id} 缺少完整静态 carrier transform`,
    );
  }
  const carrierWidth = transform.width * width;
  const carrierHeight = transform.height * height;
  return {
    left: transform.x * width - transform.anchorX * carrierWidth,
    top: transform.y * height - transform.anchorY * carrierHeight,
    width: carrierWidth,
    height: carrierHeight,
  };
};

const presentationRect = ({metadata, width, height, carrier}) => {
  if (carrier) return carrier;
  const cover = Math.max(width / metadata.width, height / metadata.height);
  const baseWidth = metadata.width * cover;
  const baseHeight = metadata.height * cover;
  return {
    left: (width - baseWidth) / 2,
    top: (height - baseHeight) / 2,
    width: baseWidth,
    height: baseHeight,
  };
};

export const referenceCellRectForRegisteredSheet = async ({
  record,
  file,
}) => {
  const binding =
    record?.layerPackageBinding ??
    record?.request?.layerPackageBinding ??
    null;
  if (
    binding?.packageRole !== 'registered-sheet' ||
    !binding?.sheetLayout
  ) {
    return null;
  }
  const {columns, rows, cells} = binding.sheetLayout;
  const referenceCell = cells?.find(
    ({packageRole}) => packageRole === 'reference',
  );
  if (
    !referenceCell ||
    !Number.isInteger(columns) ||
    columns < 1 ||
    !Number.isInteger(rows) ||
    rows < 1
  ) {
    throw new Error(
      `registered-layer-sheet ${record.assetId ?? 'unknown'} 缺少可提取的 reference 格位`,
    );
  }
  const metadata = await sharp(file).metadata();
  if (
    !Number.isInteger(metadata.width) ||
    !Number.isInteger(metadata.height)
  ) {
    throw new Error(
      `registered-layer-sheet ${record.assetId ?? 'unknown'} 的原生画布无法按 ${columns}x${rows} 提取 reference 格位`,
    );
  }
  const providerNativeExplicit =
    binding.sheetLayout.providerSource?.canvasMode === 'provider-native' &&
    binding.sheetLayout.providerSource?.cellExtraction === 'explicit-rects';
  if (
    !providerNativeExplicit &&
    (
      metadata.width % columns !== 0 ||
      metadata.height % rows !== 0
    )
  ) {
    throw new Error(
      `registered-layer-sheet ${record.assetId ?? 'unknown'} 的原生画布无法按 ${columns}x${rows} 提取 reference 格位`,
    );
  }
  const left = Math.floor(
    referenceCell.column * metadata.width / columns,
  );
  const right = Math.floor(
    (referenceCell.column + 1) * metadata.width / columns,
  );
  const top = Math.floor(
    referenceCell.row * metadata.height / rows,
  );
  const bottom = Math.floor(
    (referenceCell.row + 1) * metadata.height / rows,
  );
  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
};

const layerSvg = async ({
  members,
  width,
  height,
  limit,
  direction,
  carrier,
}) => {
  const images = [];
  for (const member of members) {
    const metadata = await sharp(member.file).metadata();
    const placement = presentationRect({
      metadata,
      width,
      height,
      carrier,
    });
    const depth = member.depth;
    const scale = 1 + Math.abs(depth) * limit.scale;
    const translateX = direction * depth * limit.x * width;
    const translateY = direction * depth * limit.y * height;
    const rotation =
      direction * depth * limit.rotationDegrees;
    images.push(`
      <image
        href="${await dataUrlFor(member.file)}"
        x="${placement.left}"
        y="${placement.top}"
        width="${placement.width}"
        height="${placement.height}"
        preserveAspectRatio="none"
        transform="translate(${translateX} ${translateY}) rotate(${rotation} ${width / 2} ${height / 2}) translate(${width / 2} ${height / 2}) scale(${scale}) translate(${-width / 2} ${-height / 2})"
      />
    `);
  }
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      ${images.join('\n')}
    </svg>
  `);
};

const writeEnvelopePair = async ({
  members,
  profile,
  limit,
  file,
  group,
}) => {
  const {width, height} = PROFILE_SIZES[profile];
  const carrier = sceneCarrierRect({group, width, height});
  const negative = await layerSvg({
    members,
    width,
    height,
    limit,
    direction: -1,
    carrier,
  });
  const positive = await layerSvg({
    members,
    width,
    height,
    limit,
    direction: 1,
    carrier,
  });
  const left = await sharp(negative).ensureAlpha().png().toBuffer();
  const right = await sharp(positive).ensureAlpha().png().toBuffer();
  await sharp({
    create: {
      width: width * 2,
      height,
      channels: 4,
      background: '#00000000',
    },
  })
    .composite([
      {input: left, left: 0, top: 0},
      {input: right, left: width, top: 0},
    ])
    .png()
    .toFile(file);
  const {data, info} = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({resolveWithObject: true});
  let transparentPixels = 0;
  for (
    let offset = info.channels - 1;
    offset < data.length;
    offset += info.channels
  ) {
    if (data[offset] < 255) transparentPixels += 1;
  }
  return {
    profile,
    file,
    width: info.width,
    height: info.height,
    transparentPixels,
    passed: transparentPixels === 0,
  };
};

const subjectTravelSvg = async ({
  members,
  width,
  height,
  limit,
  direction,
  carrier,
}) => {
  const images = [];
  for (const member of members) {
    const metadata = await sharp(member.file).metadata();
    const placement = presentationRect({
      metadata,
      width,
      height,
      carrier,
    });
    const moving = member.role === 'subject';
    const translateX = moving ? direction * limit.x * width : 0;
    const translateY = moving ? -direction * limit.y * height : 0;
    const rotation = moving ? direction * limit.rotationDegrees : 0;
    const scale = moving ? 1 + limit.scale : 1;
    images.push(`
      <image
        href="${await dataUrlFor(member.file)}"
        x="${placement.left}"
        y="${placement.top}"
        width="${placement.width}"
        height="${placement.height}"
        preserveAspectRatio="none"
        transform="translate(${translateX} ${translateY}) rotate(${rotation} ${width / 2} ${height / 2}) translate(${width / 2} ${height / 2}) scale(${scale}) translate(${-width / 2} ${-height / 2})"
      />
    `);
  }
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      ${images.join('\n')}
    </svg>
  `);
};

const writeSubjectTravelPair = async ({
  members,
  profile,
  limit,
  file,
  group,
}) => {
  const {width, height} = PROFILE_SIZES[profile];
  const carrier = sceneCarrierRect({group, width, height});
  const lowerLeft = await subjectTravelSvg({
    members,
    width,
    height,
    limit,
    direction: -1,
    carrier,
  });
  const upperRight = await subjectTravelSvg({
    members,
    width,
    height,
    limit,
    direction: 1,
    carrier,
  });
  const left = await sharp(lowerLeft).ensureAlpha().png().toBuffer();
  const right = await sharp(upperRight).ensureAlpha().png().toBuffer();
  await sharp({
    create: {
      width: width * 2,
      height,
      channels: 4,
      background: '#00000000',
    },
  })
    .composite([
      {input: left, left: 0, top: 0},
      {input: right, left: width, top: 0},
    ])
    .png()
    .toFile(file);
  const {data, info} = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({resolveWithObject: true});
  let transparentPixels = 0;
  for (
    let offset = info.channels - 1;
    offset < data.length;
    offset += info.channels
  ) {
    if (data[offset] < 255) transparentPixels += 1;
  }
  return {
    profile,
    file,
    width: info.width,
    height: info.height,
    transparentPixels,
    passed: transparentPixels === 0,
  };
};

export const buildLayerStackProof = async ({
  group,
  memberFiles,
  referenceFile,
  referenceRect = null,
  directory,
  evidenceId,
}) => {
  const members = ROLE_ORDER.map((role) => {
    const node = group.children.find(
      (candidate) =>
        candidate.kind === 'asset' && candidate.slot === role,
    );
    const file = memberFiles.get(node?.id);
    if (!node || !file) {
      throw new Error(
        `registered-depth-stack ${group.id} 缺少 ${role} 证明来源`,
      );
    }
    return {role, nodeId: node.id, depth: node.depth, file};
  });
  await fs.mkdir(directory, {recursive: true});
  const safeId = evidenceId
    .replace(/[^a-z0-9-]+/gi, '-')
    .toLowerCase();
  const canvas = group.registration.canvas;
  const neutralFile = path.join(
    directory,
    `${safeId}-neutral-reconstruction.png`,
  );
  await sharp({
    create: {
      width: canvas.width,
      height: canvas.height,
      channels: 4,
      background: '#00000000',
    },
  })
    .composite(
      members.map(({file}) => ({input: file, left: 0, top: 0})),
    )
    .png()
    .toFile(neutralFile);

  const comparisonFile = path.join(
    directory,
    `${safeId}-reference-comparison.png`,
  );
  const reference = referenceFile ?? neutralFile;
  const referenceMetadata = await sharp(reference).metadata();
  let referenceInput = reference;
  if (referenceRect) {
    referenceInput = await sharp(reference)
      .extract(referenceRect)
      .resize(canvas.width, canvas.height, {fit: 'fill'})
      .png()
      .toBuffer();
  } else if (
    referenceMetadata.width !== canvas.width ||
    referenceMetadata.height !== canvas.height
  ) {
    throw new Error(
      `registered-depth-stack ${group.id} 的 reference ${referenceMetadata.width}x${referenceMetadata.height} 与注册画布 ${canvas.width}x${canvas.height} 不一致，且未声明 referenceRect`,
    );
  }
  await sharp({
    create: {
      width: canvas.width * 2,
      height: canvas.height,
      channels: 4,
      background: '#00000000',
    },
  })
    .composite([
      {input: referenceInput, left: 0, top: 0},
      {input: neutralFile, left: canvas.width, top: 0},
    ])
    .png()
    .toFile(comparisonFile);

  const tileWidth = Math.min(480, canvas.width);
  const tileHeight = Math.max(
    1,
    Math.round((tileWidth * canvas.height) / canvas.width),
  );
  const explodedFile = path.join(
    directory,
    `${safeId}-exploded-view.png`,
  );
  const explodedLayers = [];
  for (const [index, member] of members.entries()) {
    const layer = await sharp(member.file)
      .resize(tileWidth, tileHeight, {fit: 'fill'})
      .png()
      .toBuffer();
    explodedLayers.push(
      {input: checkerboard({width: tileWidth, height: tileHeight}), left: index * tileWidth, top: 0},
      {input: layer, left: index * tileWidth, top: 0},
      {
        input: Buffer.from(`
          <svg xmlns="http://www.w3.org/2000/svg" width="${tileWidth}" height="42">
            <rect width="100%" height="42" fill="rgba(15,23,42,.82)"/>
            <text x="12" y="28" fill="white" font-size="20" font-family="sans-serif">${safeText(member.role)} · ${safeText(member.nodeId)}</text>
          </svg>
        `),
        left: index * tileWidth,
        top: tileHeight,
      },
    );
  }
  await sharp({
    create: {
      width: tileWidth * 3,
      height: tileHeight + 42,
      channels: 4,
      background: '#f3f0e8',
    },
  })
    .composite(explodedLayers)
    .png()
    .toFile(explodedFile);

  const envelopeExtremes = [];
  for (const profile of Object.keys(PROFILE_SIZES)) {
    const file = path.join(
      directory,
      `${safeId}-envelope-${profile.replace(':', 'x')}.png`,
    );
    envelopeExtremes.push(
      await writeEnvelopePair({
        members,
        profile,
        limit: group.layerStack.revealEnvelope[profile],
        file,
        group,
      }),
    );
  }
  const subjectTravelExtremes = [];
  if (group.layerStack.subjectTravelEnvelope) {
    for (const profile of Object.keys(PROFILE_SIZES)) {
      const file = path.join(
        directory,
        `${safeId}-subject-travel-${profile.replace(':', 'x')}.png`,
      );
      subjectTravelExtremes.push(
        await writeSubjectTravelPair({
          members,
          profile,
          limit: group.layerStack.subjectTravelEnvelope[profile],
          file,
          group,
        }),
      );
    }
  }
  const artifacts = {
    neutralReconstruction: neutralFile,
    referenceComparison: comparisonFile,
    explodedView: explodedFile,
    envelopeExtremes,
    subjectTravelExtremes,
  };
  return {
    members: members.map(({role, nodeId, depth}) => ({
      role,
      nodeId,
      depth,
    })),
    artifacts,
    artifactHashes: Object.fromEntries(
      (
        await Promise.all([
          neutralFile,
          comparisonFile,
          explodedFile,
          ...envelopeExtremes.map(({file}) => file),
          ...subjectTravelExtremes.map(({file}) => file),
        ].map(async (file) => [file, await sha256File(file)]))
      ),
    ),
    passed:
      envelopeExtremes.every(({passed}) => passed) &&
      subjectTravelExtremes.every(({passed}) => passed),
  };
};
