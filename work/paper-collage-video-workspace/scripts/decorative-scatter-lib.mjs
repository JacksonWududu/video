import sharp from 'sharp';

export const composeDecorativeScatter = async ({
  source,
  canvas,
  regions,
  placements,
}) => {
  const sources = new Map();
  for (const region of regions) {
    sources.set(
      region.id,
      await sharp(source)
        .extract({
          left: region.left,
          top: region.top,
          width: region.width,
          height: region.height,
        })
        .png()
        .toBuffer(),
    );
  }
  const layers = [];
  for (const placement of placements) {
    const input = sources.get(placement.sourceId);
    if (!input) {
      throw new Error(`decorative scatter 引用未知 sourceId：${placement.sourceId}`);
    }
    const metadata = await sharp(input).metadata();
    const width = Math.max(1, Math.round(metadata.width * placement.scale));
    const height = Math.max(1, Math.round(metadata.height * placement.scale));
    let sprite = sharp(input).resize({width, height});
    if (placement.flipX) sprite = sprite.flop();
    if (placement.rotation !== 0) {
      sprite = sprite.rotate(placement.rotation, {
        background: {r: 0, g: 0, b: 0, alpha: 0},
      });
    }
    const buffer = await sprite.png().toBuffer();
    const rotated = await sharp(buffer).metadata();
    const left = Math.round(
      placement.x * canvas.width - placement.anchorX * rotated.width,
    );
    const top = Math.round(
      placement.y * canvas.height - placement.anchorY * rotated.height,
    );
    layers.push({input: buffer, left, top});
  }
  return sharp({
    create: {
      width: canvas.width,
      height: canvas.height,
      channels: 4,
      background: {r: 0, g: 0, b: 0, alpha: 0},
    },
  }).composite(layers).png().toBuffer();
};
