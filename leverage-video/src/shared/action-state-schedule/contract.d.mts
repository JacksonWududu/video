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

export type ActionStateOccurrenceV3 = {
  readonly state_index: number;
  readonly state_id: string;
  readonly semantic_state: string;
  readonly narration_byte_start: number;
  readonly narration_byte_end: number;
  readonly narration_text: string;
  readonly at_frame: number;
  readonly end_frame: number;
  readonly duration_in_frames: number;
  readonly transition_in_frames: number;
  readonly clean_hold_in_frames: number;
  readonly semantic_hold_reason: string | null;
};

export type ActionStateScheduleV3 = {
  readonly contract_version: 'action-state-schedule-v3';
  readonly fps: 30;
  readonly total_frames: number;
  readonly source_text: string;
  readonly motion_tier: 'stateful' | 'hero_pose';
  readonly state_count_total: number;
  readonly action_variant_count: number;
  readonly state_count_rationale: string | null;
  readonly cadence_advisory: {
    readonly contract_version: 'action-state-cadence-advisory-v1';
    readonly suggested_state_count: number;
    readonly max_hold_frames: 75;
    readonly enforcement: 'advisory-only';
  };
  readonly occurrences: readonly ActionStateOccurrenceV3[];
  readonly intra_shot_transitions: readonly Readonly<Record<string, unknown>>[];
  readonly split_assessment: null | {
    readonly natural_semantic_pause_available: false;
    readonly rationale: string;
  };
  readonly extended_family_approval: null | {
    readonly status: 'approved';
    readonly exact_message: string;
    readonly decided_at: string;
    readonly presented_map_sha256: string;
    readonly state_plan_sha256: string;
  };
};

export type ActionStateSchedule = ActionStateScheduleV2 | ActionStateScheduleV3;

export const ACTION_STATE_SCHEDULE_VERSION: 'action-state-schedule-v2';
export const ACTION_STATE_SCHEDULE_V3_VERSION: 'action-state-schedule-v3';
export const ACTION_STATE_FPS: 30;
export const MIN_MULTI_STATE_HOLD_FRAMES: 18;
export const MAX_STATE_HOLD_FRAMES: 75;
export const MIN_CLEAN_HOLD_FRAMES: 15;
export const MAX_ACTION_STATE_COUNT: 5;
export const ACTION_STATE_V3_MOTION_TIERS: readonly ['stateful', 'hero_pose'];
export const ACTION_STATE_CADENCE_ADVISORY_VERSION: 'action-state-cadence-advisory-v1';

export function calculateActionStateCount(totalFrames: number): number;
export function buildActionStateSchedule(input: {totalFrames: number; fps?: number}): ActionStateScheduleV2;
export function retimeActionStateScheduleForRevoice(input: {
  parentSchedule: ActionStateScheduleV2;
  totalFrames: number;
  fps?: number;
}): ActionStateScheduleV2;

export function calculateActionStateCadenceAdvisory(totalFrames: number): {
  contract_version: 'action-state-cadence-advisory-v1';
  suggested_state_count: number;
  max_hold_frames: 75;
  enforcement: 'advisory-only';
};

export function buildActionStatePlanSha256(schedule: ActionStateScheduleV3): string;

export function buildActionStateScheduleV3(input: {
  totalFrames: number;
  fps?: 30;
  sourceText: string;
  motionTier: 'stateful' | 'hero_pose';
  states: readonly Readonly<Record<string, unknown>>[];
  stateCountRationale?: string | null;
  intraShotTransitions?: readonly Readonly<Record<string, unknown>>[] | null;
  splitAssessment?: ActionStateScheduleV3['split_assessment'];
  extendedFamilyApproval?: ActionStateScheduleV3['extended_family_approval'];
}): ActionStateScheduleV3;

export function retimeActionStateScheduleV3(input: {
  parentSchedule: ActionStateScheduleV3;
  totalFrames: number;
  stateAtFrames: readonly {readonly state_id: string; readonly at_frame: number}[];
  fps?: 30;
}): ActionStateScheduleV3;

export function validateActionStateSchedule(
  schedule: unknown,
  context: {
    totalFrames: number;
    fps?: number;
    revoiceLock?: {
      state_ids: readonly string[];
      state_plan_sha256?: string;
    } | null;
  },
): {
  result: 'pass';
  contract_version: 'action-state-schedule-v2' | 'action-state-schedule-v3';
  state_count_total: number;
};
