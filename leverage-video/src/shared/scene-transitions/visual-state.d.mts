export function resolveTransitionTailProgress(input: {
  tailFrame: number;
  durationInFrames: number;
}): number;

export function resolveTransitionTailStyle(input: {
  kind: string;
  options?: Readonly<Record<string, unknown>>;
  progress: number;
}): Record<string, string | number>;
