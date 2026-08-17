import type {CSSProperties, ReactNode} from 'react';
import type {
  CompositionAnnotationNode,
  CompositionDataGraphicNode,
  CompositionEditorialSwitchNode,
  CompositionNode,
  CompositionTypographyNode,
  EditorialSystem,
} from './project';
import {
  fitEditorialTypography,
  formatDataValue,
  lifecycleOpacity,
  resolveAnnotationRoute,
  resolveDataDomain,
  resolveDataState,
  resolveEditorialSwitch,
  resolveTypographyEmphasis,
  resolveTypographyReveal,
} from './editorialPrimitives.mjs';

type BaseProps = {
  sceneId: string;
  frame: number;
  editorial: EditorialSystem;
  container: CSSProperties;
  width: number;
  height: number;
};

const highlightFor = (node: CompositionTypographyNode, text: string) =>
  node.treatment.highlights.find((highlight) => text.includes(highlight.text));

export const TypographyView = ({
  node,
  sceneId,
  frame,
  editorial,
  container,
  width,
  height,
}: BaseProps & {node: CompositionTypographyNode}) => {
  const treatment = node.treatment;
  const layout = fitEditorialTypography({
    text: node.text,
    width,
    height,
    minFontSize: treatment.fit.minFontSize,
    maxFontSize: treatment.fit.maxFontSize,
    maxLines: treatment.fit.maxLines,
    lineHeight: treatment.style.lineHeight,
    letterSpacing: treatment.style.letterSpacing ?? 0,
  });
  const reveal = resolveTypographyReveal({
    node,
    editorial,
    sceneId,
    frame,
    lines: layout.lines,
  });
  const activeEmphasis = resolveTypographyEmphasis({
    node,
    editorial,
    sceneId,
    frame,
  });
  const effects = treatment.effects;
  const textShadow = effects.shadow
    ? `${effects.shadow.x}px ${effects.shadow.y}px ${effects.shadow.blur}px ${effects.shadow.color}`
    : undefined;
  const stroke = effects.stroke;
  const renderUnit = (unit: {id: string; text: string; visible: boolean}) => {
    const highlight = highlightFor(node, unit.text);
    const emphasis = activeEmphasis.find(({text}: {text: string}) =>
      unit.text.includes(text)
    );
    return (
      <span
        key={unit.id}
        data-typography-unit={unit.id}
        data-visible={unit.visible ? 'true' : 'false'}
        style={{
          display: treatment.reveal.mode === 'line' ? 'block' : 'inline-block',
          whiteSpace: treatment.reveal.mode === 'line' ? 'pre-wrap' : 'pre',
          opacity: unit.visible ? 1 : 0,
          color: emphasis?.color ?? highlight?.color ?? treatment.style.color,
          transform: emphasis
            ? `translate(${emphasis.offsetX}px, ${emphasis.offsetY}px) scale(${emphasis.scale})`
            : undefined,
          transformOrigin: '50% 70%',
        }}
      >
        {unit.text}
      </span>
    );
  };
  return (
    <div
      data-composition-node={node.id}
      data-composition-kind="typography"
      data-font-size={layout.fontSize}
      data-line-count={layout.lines.length}
      data-overflow={layout.overflow ? 'true' : 'false'}
      style={{
        ...container,
        height,
        boxSizing: 'border-box',
        overflow: treatment.fit.overflow === 'clip' ? 'hidden' : 'visible',
        padding: effects.pad?.padding ?? 0,
        borderRadius: effects.pad?.radius ?? 0,
        background: effects.pad?.color,
        color: treatment.style.color,
        fontSize: layout.fontSize,
        fontWeight: treatment.style.fontWeight,
        lineHeight: treatment.style.lineHeight,
        textAlign: treatment.style.align,
        letterSpacing: treatment.style.letterSpacing,
        fontFamily: treatment.style.fontFamily,
        textShadow,
        WebkitTextStroke: stroke ? `${stroke.width}px ${stroke.color}` : undefined,
      }}
    >
      {reveal.map(renderUnit)}
    </div>
  );
};

const annotationLabel = (
  node: CompositionAnnotationNode,
  progress: number,
) => {
  if (node.annotationKind === 'numeric-counter') {
    return Math.round(node.value * progress).toLocaleString('en-US');
  }
  if (node.annotationKind === 'percentage-counter') {
    return `${Math.round(node.value * progress)}%`;
  }
  return node.label;
};

export const AnnotationView = ({
  node,
  sceneId,
  frame,
  editorial,
  container,
  width,
  height,
  nodes,
  zones,
}: BaseProps & {
  node: CompositionAnnotationNode;
  nodes: CompositionNode[];
  zones: Array<{id: string; x: number; y: number; width: number; height: number; padding?: number}>;
}) => {
  const route = resolveAnnotationRoute({node, nodes, zones});
  const opacity = lifecycleOpacity({
    lifecycle: node.lifecycle,
    editorial,
    sceneId,
    frame,
  });
  const points = route.points.map(({x, y}: {x: number; y: number}) => ({
    x: x * width,
    y: y * height,
  }));
  const progress = opacity;
  const path = points
    .map(({x, y}: {x: number; y: number}, index: number) =>
      `${index === 0 ? 'M' : 'L'} ${x} ${y}`
    )
    .join(' ');
  const target = points.at(-1) ?? {x: 0, y: 0};
  const source = points[0] ?? {x: 0, y: 0};
  const cardKinds = new Set(['label', 'badge', 'explainer-card', 'callout', 'numeric-counter', 'percentage-counter']);
  return (
    <div
      data-composition-node={node.id}
      data-composition-kind="annotation"
      data-annotation-kind={node.annotationKind}
      data-route-valid={route.valid ? 'true' : 'false'}
      data-route-reason={route.reason ?? ''}
      style={{...container, height, opacity: (Number(container.opacity ?? 1)) * opacity, pointerEvents: 'none'}}
    >
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} overflow="visible">
        {path ? (
          <path
            d={path}
            fill="none"
            stroke={node.style.color}
            strokeWidth={node.style.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            strokeDasharray={node.annotationKind === 'leader-line' ? '0.04 0.025' : undefined}
          />
        ) : null}
        {node.annotationKind === 'arrow' || node.annotationKind === 'callout' ? (
          <path
            d={`M ${target.x} ${target.y} l -12 -7 l 4 14 z`}
            fill={node.style.color}
            transform={`rotate(${Math.atan2(target.y - source.y, target.x - source.x) * 180 / Math.PI} ${target.x} ${target.y})`}
          />
        ) : null}
        {node.annotationKind === 'bracket' ? (
          <path
            d={`M ${source.x} ${source.y - 14} v 28 M ${source.x} ${source.y} H ${target.x} M ${target.x} ${target.y - 14} v 28`}
            fill="none"
            stroke={node.style.color}
            strokeWidth={node.style.strokeWidth}
          />
        ) : null}
        {cardKinds.has(node.annotationKind) ? (
          <g transform={`translate(${source.x}, ${source.y})`}>
            <rect
              x={-74}
              y={-26}
              width={148}
              height={52}
              rx={node.annotationKind === 'badge' ? 26 : 8}
              fill={node.style.background}
              stroke={node.style.color}
              strokeWidth={node.style.strokeWidth}
            />
            <text
              x={0}
              y={node.style.fontSize * 0.35}
              textAnchor="middle"
              fill={node.style.color}
              fontSize={node.style.fontSize}
              fontWeight={node.annotationKind.includes('counter') ? 800 : 700}
            >
              {annotationLabel(node, progress)}
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  );
};

const chartFrame = (node: CompositionDataGraphicNode) => {
  const {ink, paper} = node.style;
  return (
    <>
      <rect x={0} y={0} width={100} height={100} rx={4} fill={paper} />
      <path d="M 12 10 V 88 H 94" fill="none" stroke={ink} strokeWidth={1.4} />
    </>
  );
};

const barChart = (node: CompositionDataGraphicNode, reveal: number, focusIds: string[]) => {
  const values = ((node.data.values ?? []) as Array<{id: string; label: string; value: number}>);
  const [minimum, maximum] = resolveDataDomain(node);
  const horizontal = node.graphicKind === 'bar-chart';
  return (
    <>
      {chartFrame(node)}
      {values.map((item, index) => {
        const ratio = (item.value - minimum) / (maximum - minimum) * reveal;
        const focused = focusIds.length === 0 || focusIds.includes(item.id);
        if (horizontal) {
          const y = 18 + index * (68 / Math.max(1, values.length));
          return (
            <g key={item.id} opacity={focused ? 1 : 0.35}>
              <rect x={18} y={y} width={ratio * 70} height={8} rx={2} fill={node.style.accent} />
              <text x={18} y={y - 2} fontSize={node.style.fontSize} fill={node.style.ink}>{item.label}</text>
              <text x={91} y={y + 7} textAnchor="end" fontSize={node.style.fontSize} fill={node.style.ink}>{formatDataValue(item.value, node.format)}</text>
            </g>
          );
        }
        const width = 68 / Math.max(1, values.length);
        const height = ratio * 65;
        const x = 18 + index * width;
        return (
          <g key={item.id} opacity={focused ? 1 : 0.35}>
            <rect x={x} y={86 - height} width={width * 0.68} height={height} rx={2} fill={node.style.accent} />
            <text x={x + width * 0.34} y={95} textAnchor="middle" fontSize={node.style.fontSize} fill={node.style.ink}>{item.label}</text>
          </g>
        );
      })}
    </>
  );
};

const lineChart = (node: CompositionDataGraphicNode, reveal: number, focusIds: string[]) => {
  const points = ((node.data.points ?? []) as Array<{id: string; label: string; value: number}>);
  const [minimum, maximum] = resolveDataDomain(node);
  const visibleCount = Math.max(1, Math.ceil(points.length * reveal));
  const visible = points.slice(0, visibleCount);
  const path = visible.map((point, index) => {
    const x = 16 + index * (76 / Math.max(1, points.length - 1));
    const y = 84 - ((point.value - minimum) / (maximum - minimum)) * 64;
    return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
  }).join(' ');
  return (
    <>
      {chartFrame(node)}
      <path d={path} fill="none" stroke={node.style.accent} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      {visible.map((point, index) => {
        const x = 16 + index * (76 / Math.max(1, points.length - 1));
        const y = 84 - ((point.value - minimum) / (maximum - minimum)) * 64;
        const focused = focusIds.length === 0 || focusIds.includes(point.id);
        return <circle key={point.id} cx={x} cy={y} r={focused ? 3.2 : 2} fill={focused ? node.style.accent : node.style.muted} />;
      })}
    </>
  );
};

const comparisonTable = (node: CompositionDataGraphicNode, reveal: number, focusIds: string[]) => {
  const rows = ((node.data.rows ?? []) as Array<{id: string; label: string; values: number[]}>);
  const columns = ((node.data.columns ?? []) as string[]);
  const visible = rows.slice(0, Math.ceil(rows.length * reveal));
  const columnWidth = 78 / Math.max(1, columns.length + 1);
  return (
    <>
      <rect width={100} height={100} rx={4} fill={node.style.paper} />
      {['', ...columns].map((label, index) => (
        <text key={`head-${index}`} x={11 + index * columnWidth} y={16} fontSize={node.style.fontSize} fontWeight={800} fill={node.style.ink}>{label}</text>
      ))}
      {visible.map((row, rowIndex) => {
        const focused = focusIds.length === 0 || focusIds.includes(row.id);
        return (
          <g key={row.id} opacity={focused ? 1 : 0.35}>
            <rect x={7} y={22 + rowIndex * 18} width={86} height={15} rx={2} fill={rowIndex % 2 ? node.style.paper : node.style.muted} opacity={0.22} />
            <text x={11} y={33 + rowIndex * 18} fontSize={node.style.fontSize} fill={node.style.ink}>{row.label}</text>
            {row.values.map((value, index) => (
              <text key={index} x={11 + (index + 1) * columnWidth} y={33 + rowIndex * 18} fontSize={node.style.fontSize} fill={node.style.ink}>{formatDataValue(value, node.format)}</text>
            ))}
          </g>
        );
      })}
    </>
  );
};

const timeline = (node: CompositionDataGraphicNode, reveal: number, focusIds: string[]) => {
  const events = ((node.data.values ?? []) as Array<{id: string; label: string; value: number}>);
  const visibleCount = Math.max(1, Math.ceil(events.length * reveal));
  return (
    <>
      <rect width={100} height={100} rx={4} fill={node.style.paper} />
      <path d="M 10 52 H 92" stroke={node.style.ink} strokeWidth={2} />
      {events.slice(0, visibleCount).map((event, index) => {
        const x = 14 + index * (74 / Math.max(1, events.length - 1));
        const focused = focusIds.length === 0 || focusIds.includes(event.id);
        return (
          <g key={event.id} opacity={focused ? 1 : 0.35}>
            <circle cx={x} cy={52} r={focused ? 5 : 3.5} fill={node.style.accent} />
            <text x={x} y={index % 2 ? 72 : 36} textAnchor="middle" fontSize={node.style.fontSize} fill={node.style.ink}>{event.label}</text>
          </g>
        );
      })}
    </>
  );
};

const mapGraphic = (node: CompositionDataGraphicNode, reveal: number, focusIds: string[]) => {
  const values = new Map(((node.data.regions ?? []) as Array<{regionId: string; value: number}>).map((region) => [region.regionId, region.value]));
  const [minimum, maximum] = resolveDataDomain(node);
  return (
    <>
      <rect width={100} height={100} rx={4} fill={node.style.paper} />
      {(node.geometry ?? []).map((geometry, index) => {
        const value = values.get(geometry.regionId) ?? minimum;
        const ratio = (value - minimum) / (maximum - minimum);
        const focused = focusIds.length === 0 || focusIds.includes(geometry.regionId);
        return (
          <path
            key={geometry.regionId}
            d={geometry.path}
            fill={focused ? node.style.accent : node.style.muted}
            fillOpacity={(0.25 + ratio * 0.75) * reveal}
            stroke={node.style.ink}
            strokeWidth={1}
            data-region-id={geometry.regionId}
            data-value={value}
            data-order={index}
          />
        );
      })}
    </>
  );
};

const flowGraphic = (node: CompositionDataGraphicNode, reveal: number, focusIds: string[]) => {
  const nodes = ((node.data.nodes ?? []) as Array<{id: string; label: string; x: number; y: number}>);
  const edges = ((node.data.edges ?? []) as Array<{from: string; to: string; value?: number}>);
  const byId = new Map(nodes.map((item) => [item.id, item]));
  return (
    <>
      <rect width={100} height={100} rx={4} fill={node.style.paper} />
      {edges.map((edge, index) => {
        const from = byId.get(edge.from);
        const to = byId.get(edge.to);
        if (!from || !to || index >= Math.ceil(edges.length * reveal)) return null;
        return <path key={`${edge.from}-${edge.to}`} d={`M ${from.x} ${from.y} L ${to.x} ${to.y}`} stroke={node.style.ink} strokeWidth={2} markerEnd="url(#flow-arrow)" />;
      })}
      <defs><marker id="flow-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill={node.style.ink} /></marker></defs>
      {nodes.map((item) => {
        const focused = focusIds.length === 0 || focusIds.includes(item.id);
        return (
          <g key={item.id} opacity={focused ? 1 : 0.4}>
            <circle cx={item.x} cy={item.y} r={9} fill={node.style.accent} stroke={node.style.ink} />
            <text x={item.x} y={item.y + 2} textAnchor="middle" fontSize={node.style.fontSize} fill={node.style.ink}>{item.label}</text>
          </g>
        );
      })}
    </>
  );
};

export const DataGraphicView = ({
  node,
  sceneId,
  frame,
  editorial,
  container,
  width,
  height,
}: BaseProps & {node: CompositionDataGraphicNode}) => {
  const state = resolveDataState({node, editorial, sceneId, frame});
  let content: ReactNode;
  if (node.graphicKind === 'bar-chart' || node.graphicKind === 'column-chart') content = barChart(node, state.reveal, state.focusIds);
  else if (node.graphicKind === 'line-chart') content = lineChart(node, state.reveal, state.focusIds);
  else if (node.graphicKind === 'comparison-table') content = comparisonTable(node, state.reveal, state.focusIds);
  else if (node.graphicKind === 'timeline') content = timeline(node, state.reveal, state.focusIds);
  else if (node.graphicKind === 'map') content = mapGraphic(node, state.reveal, state.focusIds);
  else content = flowGraphic(node, state.reveal, state.focusIds);
  return (
    <div
      data-composition-node={node.id}
      data-composition-kind="data-graphic"
      data-graphic-kind={node.graphicKind}
      data-data-state={state.id}
      style={{...container, height}}
    >
      <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        {content}
      </svg>
    </div>
  );
};

export const EditorialSwitchView = ({
  node,
  sceneId,
  frame,
  editorial,
  container,
  height,
  renderPanel,
}: BaseProps & {
  node: CompositionEditorialSwitchNode;
  renderPanel: (node: CompositionNode) => ReactNode;
}) => {
  const state = resolveEditorialSwitch({node, editorial, sceneId, frame});
  const panel = node.panels.find(({id}) => id === state.activePanelId);
  const treatment = state.activeChange?.treatment;
  const progress = state.transitionProgress;
  const transform =
    treatment === 'card-switch'
      ? `rotateY(${(1 - progress) * -90}deg)`
      : treatment === 'panel-replace'
        ? `translateX(${(1 - progress) * 100}%)`
        : `scale(${0.92 + progress * 0.08})`;
  return (
    <div
      data-composition-node={node.id}
      data-composition-kind="editorial-switch"
      data-active-panel={state.activePanelId ?? ''}
      data-switch-treatment={treatment ?? ''}
      style={{...container, height, perspective: 1200, overflow: 'hidden'}}
    >
      <div style={{position: 'absolute', inset: 0, transform, transformOrigin: '50% 50%'}}>
        {panel ? renderPanel(panel.node) : null}
      </div>
    </div>
  );
};
