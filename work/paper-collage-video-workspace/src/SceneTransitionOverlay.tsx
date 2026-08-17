import {AbsoluteFill, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import type {NormalizedSceneBoundaryTransition, ProjectTheme} from './project';
import {resolveSceneTransitionPresentation} from './sceneTimeline.mjs';

const transitionSurface = (
  theme: ProjectTheme,
  edgeStyle: NormalizedSceneBoundaryTransition['treatment']['edgeStyle'],
): React.CSSProperties => ({
  backgroundColor: theme.canvas,
  ...(edgeStyle === 'paper' && theme.surface.texture
    ? {
        backgroundImage: `url(${staticFile(theme.surface.texture.src)})`,
        backgroundSize: 'cover',
      }
    : {}),
});

const transitionEdgeColor = (
  theme: ProjectTheme,
  edgeStyle: NormalizedSceneBoundaryTransition['treatment']['edgeStyle'],
) =>
  edgeStyle === 'paper' && theme.surface.subjectEdge.mode === 'paper-outline'
    ? theme.surface.subjectEdge.color
    : theme.accent;

const edgeStyle = (
  direction: NormalizedSceneBoundaryTransition['treatment']['direction'],
  progress: number,
): React.CSSProperties => {
  const position = `${progress * 100}%`;
  const common: React.CSSProperties = {
    position: 'absolute',
    background: 'currentColor',
    boxShadow: '0 0 18px rgba(25, 16, 11, .32)',
    opacity: progress <= 0.002 || progress >= 0.998 ? 0 : 1,
  };
  if (direction === 'top-to-bottom' || direction === 'bottom-to-top') {
    return {
      ...common,
      left: 0,
      right: 0,
      height: 18,
      top: direction === 'top-to-bottom' ? position : undefined,
      bottom: direction === 'bottom-to-top' ? position : undefined,
      transform: 'translateY(-50%)',
    };
  }
  return {
    ...common,
    top: 0,
    bottom: 0,
    width: 18,
    left: direction === 'left-to-right' ? position : undefined,
    right: direction === 'right-to-left' ? position : undefined,
    transform: 'translateX(-50%)',
  };
};

const PaperEdge = ({
  direction,
  progress,
  color,
}: {
  direction: NormalizedSceneBoundaryTransition['treatment']['direction'];
  progress: number;
  color: string;
}) => (
  <AbsoluteFill style={{zIndex: 1000, pointerEvents: 'none', color}}>
    <div style={edgeStyle(direction, progress)} />
  </AbsoluteFill>
);

export const SceneTransitionOverlay = ({
  transition,
  theme,
}: {
  transition: NormalizedSceneBoundaryTransition;
  theme: ProjectTheme;
}) => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const presentation = resolveSceneTransitionPresentation({transition, frame});
  if (transition.treatment.type === 'cut') return null;
  const {edgeStyle = 'clean'} = transition.treatment;
  const edgeColor = transitionEdgeColor(theme, edgeStyle);
  if (
    (transition.treatment.type === 'wipe' ||
      transition.treatment.type === 'slide') &&
    edgeStyle === 'paper'
  ) {
    return (
      <PaperEdge
        direction={transition.treatment.direction}
        progress={presentation.edgeProgress ?? 1}
        color={edgeColor}
      />
    );
  }
  if (transition.treatment.type === 'wipe' && edgeStyle === 'torn') {
    const points = (presentation.tornEdgePoints ?? [])
      .map(({x, y}) => `${x},${y}`)
      .join(' ');
    return (
      <AbsoluteFill style={{zIndex: 1000, pointerEvents: 'none'}}>
        <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polyline
            points={points}
            fill="none"
            stroke={edgeColor}
            strokeWidth="1.8"
            vectorEffect="non-scaling-stroke"
            style={{filter: 'drop-shadow(0 0 7px rgba(25, 16, 11, .42))'}}
          />
        </svg>
      </AbsoluteFill>
    );
  }
  if (transition.treatment.type === 'iris') {
    if (edgeStyle === 'clean') return null;
    const basis = Math.sqrt(width ** 2 + height ** 2) / Math.sqrt(2);
    const radius = ((presentation.irisRadius ?? 0) / 100) * basis;
    return (
      <AbsoluteFill style={{zIndex: 1000, pointerEvents: 'none'}}>
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: radius * 2,
            height: radius * 2,
            border: `14px solid ${edgeColor}`,
            borderRadius: '50%',
            boxSizing: 'border-box',
            transform: 'translate(-50%, -50%)',
            boxShadow: '0 0 24px rgba(25, 16, 11, .3)',
            opacity: radius <= 1 || presentation.progress >= 0.998 ? 0 : 1,
          }}
        />
      </AbsoluteFill>
    );
  }
  if (transition.treatment.type === 'page-turn') {
    const fold = presentation.pageTurnFold ?? 0;
    const position = `${(presentation.edgeProgress ?? 0) * 100}%`;
    const leftToRight = transition.treatment.direction === 'left-to-right';
    return (
      <AbsoluteFill style={{zIndex: 1000, pointerEvents: 'none', perspective: 1200}}>
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            width: `${5 + fold * 15}%`,
            left: leftToRight ? position : undefined,
            right: leftToRight ? undefined : position,
            transformOrigin: leftToRight ? 'left center' : 'right center',
            transform: `translateX(${leftToRight ? '-50%' : '50%'}) perspective(900px) rotateY(${(leftToRight ? -1 : 1) * fold * 68}deg)`,
            background: leftToRight
              ? `linear-gradient(90deg, ${edgeColor}, ${theme.canvas} 42%, rgba(25,16,11,.42))`
              : `linear-gradient(270deg, ${edgeColor}, ${theme.canvas} 42%, rgba(25,16,11,.42))`,
            boxShadow: '0 0 26px rgba(25, 16, 11, .38)',
            opacity: fold <= 0.01 ? 0 : 1,
          }}
        />
      </AbsoluteFill>
    );
  }
  if (transition.treatment.type === 'shutters') {
    const closure = presentation.shutterClosure ?? 0;
    const surface = transitionSurface(theme, edgeStyle);
    return (
      <AbsoluteFill style={{zIndex: 1000, pointerEvents: 'none'}}>
        <div
          style={{
            ...surface,
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            height: '50.2%',
            transform: `translateY(${(closure - 1) * 100}%)`,
            borderBottom: edgeStyle === 'clean' ? undefined : `9px solid ${edgeColor}`,
            boxSizing: 'border-box',
            boxShadow: '0 10px 20px rgba(25, 16, 11, .22)',
          }}
        />
        <div
          style={{
            ...surface,
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: '50.2%',
            transform: `translateY(${(1 - closure) * 100}%)`,
            borderTop: edgeStyle === 'clean' ? undefined : `9px solid ${edgeColor}`,
            boxSizing: 'border-box',
            boxShadow: '0 -10px 20px rgba(25, 16, 11, .22)',
          }}
        />
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill
      style={{
        zIndex: 1000,
        pointerEvents: 'none',
        opacity: presentation.coverOpacity,
        ...transitionSurface(theme, edgeStyle),
      }}
    />
  );
};
