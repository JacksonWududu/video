export type ActionStateOccurrence = {
  readonly state_index: number;
  readonly state_id: string;
  readonly start_frame: number;
  readonly end_frame: number;
  readonly duration_in_frames: number;
  readonly transition_in_frames: number;
  readonly clean_hold_in_frames: number;
};

export type ActionStateScheduleV2 = {
  readonly contract_version: 'action-state-schedule-v2';
  readonly fps: 30;
  readonly total_frames: number;
  readonly state_count_total: number;
  readonly action_variant_count: number;
  readonly occurrences: readonly ActionStateOccurrence[];
  readonly intra_shot_transitions: readonly Readonly<Record<string, unknown>>[];
};

export const ACTION_STATE_SCHEDULE_VERSION: 'action-state-schedule-v2';
export const ACTION_STATE_FPS: 30;
export const MIN_MULTI_STATE_HOLD_FRAMES: 18;
export const MAX_STATE_HOLD_FRAMES: 75;
export const MIN_CLEAN_HOLD_FRAMES: 15;
export const MAX_ACTION_STATE_COUNT: 5;

export function calculateActionStateCount(totalFrames: number): number;
export function buildActionStateSchedule(input: {totalFrames: number; fps?: number}): ActionStateScheduleV2;
export function retimeActionStateScheduleForRevoice(input: {
  parentSchedule: ActionStateScheduleV2;
  totalFrames: number;
  fps?: number;
}): ActionStateScheduleV2;
export function validateActionStateSchedule(
  schedule: unknown,
  context: {totalFrames: number; fps?: number; revoiceLock?: {state_ids: readonly string[]} | null},
): {result: 'pass'; contract_version: 'action-state-schedule-v2'; state_count_total: number};
