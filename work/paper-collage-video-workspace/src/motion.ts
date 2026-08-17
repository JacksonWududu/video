import type {IdleMotion, MotionKeyframe, ProjectEvent} from './project';
import {resolveVisibilityState} from './visibilityLifecycle.mjs';

export {resolveVisibilityState};

export type MotionState = {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
};

const defaults: MotionState = {x: 0, y: 0, scale: 1, rotation: 0, opacity: 1};
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const ease = (value: number, name: MotionKeyframe['ease']) => {
  const t = clamp01(value);
  switch (name) {
    case 'ease-in':
      return t * t;
    case 'ease-out':
      return 1 - (1 - t) * (1 - t);
    case 'ease-in-out':
      return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    case 'hold':
      return 0;
    case 'linear':
    default:
      return t;
  }
};

export const resolveMotionState = (
  keyframes: MotionKeyframe[],
  progress: number,
): MotionState => {
  if (keyframes.length === 0) return defaults;
  const sorted = [...keyframes].sort((left, right) => left.at - right.at);
  const valueFor = (
    keyframe: MotionKeyframe,
    property: keyof MotionState,
  ) => {
    if (property === 'x') return keyframe.offsetX ?? defaults.x;
    if (property === 'y') return keyframe.offsetY ?? defaults.y;
    return keyframe[property] ?? defaults[property];
  };
  const stateFor = (keyframe: MotionKeyframe): MotionState => ({
    x: keyframe.offsetX ?? defaults.x,
    y: keyframe.offsetY ?? defaults.y,
    scale: keyframe.scale ?? defaults.scale,
    rotation: keyframe.rotation ?? defaults.rotation,
    opacity: keyframe.opacity ?? defaults.opacity,
  });
  const current = clamp01(progress);
  if (current <= sorted[0].at) return stateFor(sorted[0]);
  if (current >= sorted.at(-1)!.at) return stateFor(sorted.at(-1)!);
  const rightIndex = sorted.findIndex(({at}) => at >= current);
  const left = sorted[Math.max(0, rightIndex - 1)];
  const right = sorted[rightIndex];
  const span = Math.max(0.000001, right.at - left.at);
  const amount = ease((current - left.at) / span, right.ease ?? 'ease-in-out');
  return Object.fromEntries(
    (Object.keys(defaults) as Array<keyof MotionState>).map((property) => {
      const start = valueFor(left, property);
      const end = valueFor(right, property);
      return [property, start + (end - start) * amount];
    }),
  ) as MotionState;
};

export const resolveIdleState = ({
  idle,
  frame,
  fps,
  phase,
}: {
  idle?: IdleMotion;
  frame: number;
  fps: number;
  phase: number;
}): MotionState => {
  if (!idle || idle.preset === 'still') return defaults;
  const cycleFrames = Math.max(1, idle.cycleSeconds * fps);
  const wave = Math.sin((frame / cycleFrames) * Math.PI * 2 + (idle.phase ?? phase));
  const intensity = idle.intensity;
  switch (idle.preset) {
    case 'breathe':
      return {...defaults, scale: 1 + wave * 0.008 * intensity};
    case 'float':
      return {...defaults, y: wave * 0.006 * intensity};
    case 'drift':
      return {...defaults, x: wave * 0.005 * intensity, y: Math.cos(frame / cycleFrames * Math.PI * 2) * 0.003 * intensity};
    case 'sway':
      return {
        ...defaults,
        x: wave * 0.004 * intensity,
        rotation: wave * 2.8 * intensity,
      };
    case 'grind':
      return {...defaults, x: wave * 0.008 * intensity, rotation: wave * 0.55 * intensity};
    default:
      return defaults;
  }
};

export const resolveEmphasisState = ({
  events,
  targetId,
  progress,
  durationSeconds,
}: {
  events: ProjectEvent[];
  targetId: string;
  progress: number;
  durationSeconds: number;
}): MotionState => {
  const result = {...defaults};
  for (const event of events.filter(
    (item) => item.targetId === targetId && item.visual?.kind === 'emphasis',
  )) {
    if (event.visual?.kind !== 'emphasis') continue;
    const duration = Math.max(0.08, event.visual.durationSeconds) / Math.max(0.08, durationSeconds);
    const eventProgress = (progress - event.at) / duration;
    if (eventProgress < 0 || eventProgress > 1) continue;
    const envelope = Math.sin(eventProgress * Math.PI) * event.visual.intensity;
    switch (event.visual.action) {
      case 'pulse':
        result.scale *= 1 + envelope * 0.055;
        break;
      case 'stamp':
        result.scale *= 1 + envelope * 0.09;
        result.rotation += (1 - eventProgress) * 2.2 * event.visual.intensity;
        break;
      case 'shake':
        result.x += Math.sin(eventProgress * Math.PI * 8) * envelope * 0.008;
        result.rotation += Math.sin(eventProgress * Math.PI * 6) * envelope * 0.8;
        break;
      case 'lift':
        result.y -= envelope * 0.025;
        break;
      case 'settle':
        result.y += envelope * 0.014;
        result.rotation -= envelope * 0.65;
        break;
      case 'drop-impact':
        result.y += eventProgress < 0.62
          ? eventProgress * 0.08 * event.visual.intensity
          : (1 - eventProgress) * 0.018 * event.visual.intensity;
        result.rotation += envelope * 4.5;
        result.scale *= 1 + Math.max(0, envelope) * 0.025;
        break;
      case 'carve':
        result.x += Math.sin(eventProgress * Math.PI * 10) * envelope * 0.004;
        result.rotation += Math.sin(eventProgress * Math.PI * 8) * envelope * 1.2;
        break;
    }
  }
  return result;
};
