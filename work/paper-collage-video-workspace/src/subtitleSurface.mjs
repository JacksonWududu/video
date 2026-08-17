const DEFAULT_SAFE_AREA = {
  x: 0.06,
  y: 0.06,
  width: 0.88,
  height: 0.88,
};

const finiteOr = (value, fallback) =>
  Number.isFinite(value) ? Number(value) : fallback;

const DEFAULT_FONT_STACK = 'STKaiti, KaiTi, "Noto Serif SC", serif';

export const resolveSubtitleTypography = ({
  appearance,
  theme,
  scale = 1,
}) => {
  const edgeTreatment = appearance?.edgeTreatment ?? 'soft-shadow';
  const fontFamily = appearance?.fontFamily?.trim() || (
    theme?.fontFile
      ? 'PaperCollageProjectFont, serif'
      : (theme?.fontFamily ?? DEFAULT_FONT_STACK)
  );
  const fontWeight = Number.isInteger(appearance?.fontWeight)
    ? appearance.fontWeight
    : 700;
  const outline = Math.max(0.5, scale);
  const textShadow = edgeTreatment === 'none'
    ? 'none'
    : edgeTreatment === 'crisp-outline'
      ? [
          `${outline}px 0 0 rgba(28,15,10,.82)`,
          `${-outline}px 0 0 rgba(28,15,10,.82)`,
          `0 ${outline}px 0 rgba(28,15,10,.82)`,
          `0 ${-outline}px 0 rgba(28,15,10,.82)`,
        ].join(', ')
      : appearance?.variant === 'plain'
        ? '0 2px 8px rgba(0,0,0,.72)'
        : '0 3px 2px rgba(28,15,10,.9), 0 0 14px rgba(28,15,10,.78)';
  return {
    contract: 'subtitle-typography-v1',
    fontFamily,
    fontWeight,
    edgeTreatment,
    textShadow,
  };
};

export const normalizeSubtitleSafeArea = (safeArea) => {
  const resolved = {
    x: finiteOr(safeArea?.x, DEFAULT_SAFE_AREA.x),
    y: finiteOr(safeArea?.y, DEFAULT_SAFE_AREA.y),
    width: finiteOr(safeArea?.width, DEFAULT_SAFE_AREA.width),
    height: finiteOr(safeArea?.height, DEFAULT_SAFE_AREA.height),
  };
  const valid =
    resolved.x >= 0 &&
    resolved.y >= 0 &&
    resolved.width > 0 &&
    resolved.height > 0 &&
    resolved.x + resolved.width <= 1 &&
    resolved.y + resolved.height <= 1;
  return valid ? resolved : DEFAULT_SAFE_AREA;
};

export const resolveSubtitleFadeFrames = ({
  from,
  to,
  maximumFadeFrames = 6,
}) => {
  const duration = Math.max(0, Math.round(to) - Math.round(from));
  if (duration < 3) return 0;
  return Math.min(
    Math.max(0, Math.floor(maximumFadeFrames)),
    Math.floor((duration - 1) / 2),
  );
};

export const resolveSubtitleLayout = ({
  safeArea,
  maxWidth = 0.78,
  width,
  height,
}) => {
  const resolvedSafeArea = normalizeSubtitleSafeArea(safeArea);
  const boundedMaxWidth = Math.min(
    resolvedSafeArea.width,
    Math.max(0.1, finiteOr(maxWidth, 0.78)),
  );
  const centeredX = (1 - boundedMaxWidth) / 2;
  const left = Math.max(resolvedSafeArea.x, centeredX);
  const right = Math.max(
    1 - resolvedSafeArea.x - resolvedSafeArea.width,
    centeredX,
  );
  const scale = Math.min(width / 1920, height / 1080);
  const safeBottom = Math.max(
    0,
    (1 - resolvedSafeArea.y - resolvedSafeArea.height) * height,
  );
  return {
    contract: 'responsive-safe-area-v1',
    safeArea: resolvedSafeArea,
    leftPercent: left * 100,
    rightPercent: right * 100,
    bottomPixels: safeBottom + 12 * scale,
    maxWidth: boundedMaxWidth,
  };
};
