const defaults = Object.freeze({x: 0, y: 0, scale: 1, rotation: 0, opacity: 1});
const clamp01 = (value) => Math.max(0, Math.min(1, value));

const easeOut = (value) => 1 - (1 - clamp01(value)) ** 2;

const visibilityMotion = ({visibleAmount, transition}) => {
  const amount = clamp01(visibleAmount);
  if (transition === 'cut') return {...defaults, opacity: amount >= 1 ? 1 : 0};
  if (transition === 'fade-scale') {
    return {...defaults, opacity: amount, scale: 0.92 + amount * 0.08};
  }
  return {...defaults, opacity: amount, y: (1 - amount) * 0.035};
};

export const resolveVisibilityState = ({
  events = [],
  targetId,
  initial = 'visible',
  progress,
  durationSeconds,
}) => {
  let visible = initial === 'visible';
  const visibilityEvents = events
    .filter((event) => event.targetId === targetId && event.visual?.kind === 'visibility');
  for (const event of visibilityEvents) {
    if (progress < event.at) break;
    const targetVisible = event.visual.action === 'show';
    const normalizedDuration = event.visual.transition === 'cut'
      ? 0
      : event.visual.durationSeconds / Math.max(0.08, durationSeconds);
    if (normalizedDuration <= 0 || progress >= event.at + normalizedDuration) {
      visible = targetVisible;
      continue;
    }
    const amount = easeOut((progress - event.at) / normalizedDuration);
    return visibilityMotion({
      visibleAmount: visible ? 1 - amount : amount,
      transition: event.visual.transition,
    });
  }
  return {...defaults, opacity: visible ? 1 : 0};
};

export const validateVisibilityLifecycle = ({
  events = [],
  targetInitialStates = {},
  durationSeconds,
}) => {
  const issues = [];
  const states = new Map(Object.entries(targetInitialStates));
  const previousByTarget = new Map();
  for (const [eventIndex, event] of events.entries()) {
    if (event.visual?.kind !== 'visibility' || !states.has(event.targetId)) continue;
    const startSeconds = Number(event.at) * durationSeconds;
    const eventDuration = Number(event.visual.durationSeconds);
    const endSeconds = startSeconds + eventDuration;
    const previous = previousByTarget.get(event.targetId);
    if (
      previous &&
      (startSeconds <= previous.startSeconds + 1e-6 || startSeconds < previous.endSeconds - 1e-6)
    ) {
      issues.push({
        code: 'scene-event-visibility-overlap',
        message: `节点 ${event.targetId} 的可见性事件 ${previous.eventId} 与 ${event.id} 重叠或同时开始。`,
        eventIndex,
      });
    }
    if (endSeconds > durationSeconds + 1e-6) {
      issues.push({
        code: 'scene-event-visibility-overflow',
        message: `节点 ${event.targetId} 的可见性事件 ${event.id} 超出镜头结尾。`,
        eventIndex,
      });
    }
    const expected = event.visual.action === 'show' ? 'hidden' : 'visible';
    const current = states.get(event.targetId);
    if (current !== expected) {
      issues.push({
        code: 'scene-event-visibility-lifecycle',
        message: `${event.visual.action} 前节点 ${event.targetId} 必须处于 ${expected} 状态，当前为 ${current}。`,
        eventIndex,
      });
    }
    states.set(event.targetId, event.visual.action === 'show' ? 'visible' : 'hidden');
    previousByTarget.set(event.targetId, {
      eventId: event.id,
      startSeconds,
      endSeconds,
    });
  }
  return issues;
};
