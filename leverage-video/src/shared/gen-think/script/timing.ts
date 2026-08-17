export const GEN_THINK_STATE_IDS = [
  'GEN-THINK-master-v04',
  'GEN-THINK-action-01-v01',
  'GEN-THINK-action-02-v02',
  'GEN-THINK-action-03-v01',
  'GEN-THINK-action-04-v01',
] as const;

export type GenThinkStateId = (typeof GEN_THINK_STATE_IDS)[number];

export type GenThinkOccurrence = {
  readonly assetId: GenThinkStateId;
  readonly from: number;
  readonly durationInFrames: number;
  readonly toExclusive: number;
};

export const normalizeGenThinkDuration = (durationInFrames: number): number => {
  if (!Number.isFinite(durationInFrames)) {
    throw new Error('GEN-THINK durationInFrames must be a finite number');
  }
  const normalized = Math.floor(durationInFrames);
  if (normalized < GEN_THINK_STATE_IDS.length) {
    throw new Error(`GEN-THINK requires at least ${GEN_THINK_STATE_IDS.length} frames`);
  }
  return normalized;
};

export const buildGenThinkSchedule = (
  durationInFrames: number,
  fps: number,
): readonly GenThinkOccurrence[] => {
  const normalizedDuration = normalizeGenThinkDuration(durationInFrames);
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error('fps must be a positive number');
  }

  const targetHoldFrames = Math.floor(fps * 1.5);
  const minimumOccurrenceCount = Math.ceil(normalizedDuration / targetHoldFrames);
  const cycleCount = Math.max(1, Math.ceil(minimumOccurrenceCount / GEN_THINK_STATE_IDS.length));
  const occurrenceCount = cycleCount * GEN_THINK_STATE_IDS.length;
  const baseDuration = Math.floor(normalizedDuration / occurrenceCount);
  const remainder = normalizedDuration % occurrenceCount;

  let from = 0;
  return Array.from({length: occurrenceCount}, (_, index) => {
    const occurrenceDuration = baseDuration + (index < remainder ? 1 : 0);
    const occurrence: GenThinkOccurrence = {
      assetId: GEN_THINK_STATE_IDS[index % GEN_THINK_STATE_IDS.length],
      from,
      durationInFrames: occurrenceDuration,
      toExclusive: from + occurrenceDuration,
    };
    from = occurrence.toExclusive;
    return occurrence;
  });
};

export const getGenThinkStateAtFrame = (
  schedule: readonly GenThinkOccurrence[],
  frame: number,
): GenThinkOccurrence => {
  const occurrence = schedule.find((candidate) => frame >= candidate.from && frame < candidate.toExclusive);
  if (!occurrence) {
    throw new Error(`frame ${frame} is outside the GEN-THINK schedule`);
  }
  return occurrence;
};
