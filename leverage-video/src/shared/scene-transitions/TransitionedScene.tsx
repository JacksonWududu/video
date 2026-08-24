import type {CSSProperties, ReactNode} from 'react';
import {
  AbsoluteFill,
  Freeze,
  Sequence,
  interpolate,
  useCurrentFrame,
} from 'remotion';
import type {SceneTransitionContract} from './contract.mjs';
import {
  resolveTransitionTailProgress,
  resolveTransitionTailStyle,
} from './visual-state.mjs';

type Props = {
  from: number;
  durationInFrames: number;
  transition: SceneTransitionContract | null;
  isTerminal: boolean;
  zIndex: number;
  name: string;
  children: ReactNode;
};

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const LEGACY_TRANSITION_KINDS = [
  'dissolve',
  'paper-wipe',
  'watercolor-bloom',
  'match-cut',
] as const;

const TransitionTail: React.FC<{
  durationInFrames: number;
  transition: SceneTransitionContract | null;
  children: ReactNode;
}> = ({durationInFrames, transition, children}) => {
  const frame = useCurrentFrame();
  const hasVisibleTail = transition !== null
    && transition.kind !== 'cut'
    && transition.duration_in_frames > 0;
  const isTail = hasVisibleTail && frame >= durationInFrames;
  const progress = !hasVisibleTail
    ? 0
    : transition.kind === 'paper-wipe'
      ? resolveTransitionTailProgress({
          tailFrame: frame - durationInFrames,
          durationInFrames: transition.duration_in_frames,
        })
      : interpolate(
        frame,
        [durationInFrames, durationInFrames + transition.duration_in_frames - 1],
        [0, 1],
        clamp,
      );

  return (
    <AbsoluteFill
      data-transition-contract={transition?.contract_version ?? 'terminal-hold'}
      data-transition-kind={transition?.kind ?? 'terminal-hold'}
      style={isTail && transition ? resolveTransitionTailStyle({
        kind: transition.kind,
        options: transition.contract_version === 'scene-transition-v2'
          || transition.contract_version === 'scene-transition-v3'
          ? transition.options
          : {},
        progress,
      }) as CSSProperties : undefined}
    >
      <Freeze frame={durationInFrames - 1} active={isTail}>
        {children}
      </Freeze>
    </AbsoluteFill>
  );
};

export const TransitionedScene: React.FC<Props> = ({
  from,
  durationInFrames,
  transition,
  isTerminal,
  zIndex,
  name,
  children,
}) => {
  if (!isTerminal && transition === null) {
    throw new Error(`Missing registered transition decision on ${name} (scene-transition-v3 is required for new work)`);
  }
  if (isTerminal && transition !== null) {
    throw new Error(`Terminal scene ${name} must not have an outgoing transition`);
  }
  if (transition
    && transition.contract_version !== 'scene-transition-v1'
    && transition.contract_version !== 'scene-transition-v2'
    && transition.contract_version !== 'scene-transition-v3') {
    throw new Error(`Unsupported transition contract on ${name}`);
  }
  if (transition?.contract_version === 'scene-transition-v1'
    && !LEGACY_TRANSITION_KINDS.includes(transition.kind)) {
    throw new Error(`Unsupported legacy transition kind on ${name}`);
  }
  const tailFrames = transition?.kind === 'cut' ? 0 : (transition?.duration_in_frames ?? 0);

  return (
    <Sequence
      from={from}
      durationInFrames={durationInFrames + tailFrames}
      name={`${name} · ${transition?.kind ?? 'terminal-hold'}`}
      premountFor={30}
      style={{zIndex}}
    >
      <TransitionTail durationInFrames={durationInFrames} transition={transition}>
        {children}
      </TransitionTail>
    </Sequence>
  );
};
