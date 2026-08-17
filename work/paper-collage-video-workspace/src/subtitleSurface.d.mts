export type SubtitleSafeArea = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function normalizeSubtitleSafeArea(
  safeArea?: Partial<SubtitleSafeArea> | null,
): SubtitleSafeArea;

export function resolveSubtitleFadeFrames(options: {
  from: number;
  to: number;
  maximumFadeFrames?: number;
}): number;

export function resolveSubtitleLayout(options: {
  safeArea?: Partial<SubtitleSafeArea> | null;
  maxWidth?: number;
  width: number;
  height: number;
}): {
  contract: 'responsive-safe-area-v1';
  safeArea: SubtitleSafeArea;
  leftPercent: number;
  rightPercent: number;
  bottomPixels: number;
  maxWidth: number;
};

export function resolveSubtitleTypography(options: {
  appearance?: {
    variant?: 'boxed' | 'plain' | 'hidden';
    fontFamily?: string;
    fontWeight?: number;
    edgeTreatment?: 'soft-shadow' | 'crisp-outline' | 'none';
  } | null;
  theme?: {
    fontFile?: string;
    fontFamily?: string;
  } | null;
  scale?: number;
}): {
  contract: 'subtitle-typography-v1';
  fontFamily: string;
  fontWeight: number;
  edgeTreatment: 'soft-shadow' | 'crisp-outline' | 'none';
  textShadow: string;
};
