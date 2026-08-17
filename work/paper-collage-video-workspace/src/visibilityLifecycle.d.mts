import type {MotionState} from './motion';
import type {NodeVisibility, ProjectEvent} from './project';

export function resolveVisibilityState(input: {
  events?: ProjectEvent[];
  targetId: string;
  initial?: NodeVisibility['initial'];
  progress: number;
  durationSeconds: number;
}): MotionState;

export function validateVisibilityLifecycle(input: {
  events?: ProjectEvent[];
  targetInitialStates?: Record<string, NodeVisibility['initial']>;
  durationSeconds: number;
}): Array<{code: string; message: string; eventIndex: number}>;
