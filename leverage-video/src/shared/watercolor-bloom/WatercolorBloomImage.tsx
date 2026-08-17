import React from 'react';
import {
  AbsoluteFill,
  CanvasImage,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

import {
  INTRA_SHOT_WATERCOLOR_BLOOM_RULE_ID,
  INTRA_SHOT_WATERCOLOR_BLOOM_SECONDS,
  getIntraShotWatercolorBloomDurationInFrames,
} from './contract.mjs';

export {
  INTRA_SHOT_WATERCOLOR_BLOOM_RULE_ID,
  INTRA_SHOT_WATERCOLOR_BLOOM_SECONDS,
} from './contract.mjs';

type SplashLayout = {
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
};

type PigmentPalette = readonly [string, string, string];

type InkLobe = {
  readonly path: number;
  readonly dx: number;
  readonly dy: number;
  readonly angle: number;
  readonly maxScale: number;
  readonly stretchX: number;
  readonly stretchY: number;
  readonly delay: number;
  readonly pigment: number;
};

type Satellite = {
  readonly dx: number;
  readonly dy: number;
  readonly radius: number;
  readonly delay: number;
  readonly pigment: number;
};

const SPLASH_LAYOUTS: readonly SplashLayout[] = [
  {x: 0.47, y: 0.49, rotation: -8},
  {x: 0.54, y: 0.45, rotation: 14},
  {x: 0.46, y: 0.56, rotation: 29},
  {x: 0.52, y: 0.51, rotation: -31},
];

const PIGMENT_PALETTES: readonly PigmentPalette[] = [
  ['#F3C95F', '#E7A83E', '#C88442'],
  ['#F2BD6B', '#E99655', '#C87145'],
  ['#EFCF70', '#E9A648', '#D67A4A'],
];

const ORGANIC_PATHS = [
  'M-112-12C-105-58-70-91-24-88C16-111 67-84 84-45C120-25 119 24 82 43C70 86 19 103-18 80C-57 99-103 75-101 36C-132 23-137-3-112-12Z',
  'M-99-34C-70-72-34-91 2-69C31-103 85-83 88-36C126-13 112 39 73 50C46 91-4 93-30 63C-75 81-115 48-98 9C-127-1-125-25-99-34Z',
  'M-118-4C-96-47-51-64-17-46C8-91 65-82 78-39C116-24 128 19 94 43C86 81 38 96 8 72C-26 104-80 84-84 45C-126 42-143 13-118-4Z',
  'M-101-25C-85-72-35-88 0-58C34-93 83-68 80-24C120-7 116 39 78 55C51 89 2 85-22 57C-65 84-112 53-96 15C-128 3-128-18-101-25Z',
] as const;

// One impact core, eight irregular lobes and twelve satellite drops.
const INK_LOBES: readonly InkLobe[] = [
  {path: 0, dx: -260, dy: -112, angle: -17, maxScale: 5.8, stretchX: 1.30, stretchY: 0.62, delay: 0.00, pigment: 0},
  {path: 1, dx: 44, dy: -210, angle: 21, maxScale: 5.5, stretchX: 0.64, stretchY: 1.22, delay: 0.02, pigment: 1},
  {path: 2, dx: 302, dy: -96, angle: 8, maxScale: 5.9, stretchX: 1.22, stretchY: 0.60, delay: 0.04, pigment: 2},
  {path: 3, dx: 354, dy: 132, angle: 31, maxScale: 6.0, stretchX: 1.34, stretchY: 0.54, delay: 0.06, pigment: 0},
  {path: 1, dx: 102, dy: 245, angle: -12, maxScale: 5.7, stretchX: 0.78, stretchY: 1.18, delay: 0.08, pigment: 1},
  {path: 2, dx: -194, dy: 235, angle: 19, maxScale: 5.7, stretchX: 1.18, stretchY: 0.64, delay: 0.05, pigment: 2},
  {path: 3, dx: -372, dy: 96, angle: -29, maxScale: 6.1, stretchX: 1.36, stretchY: 0.56, delay: 0.07, pigment: 0},
  {path: 0, dx: -36, dy: 18, angle: 6, maxScale: 5.9, stretchX: 0.94, stretchY: 0.82, delay: 0.01, pigment: 1},
];

const SATELLITES: readonly Satellite[] = [
  {dx: -705, dy: -330, radius: 28, delay: 0.00, pigment: 0},
  {dx: -542, dy: -418, radius: 17, delay: 0.08, pigment: 1},
  {dx: -389, dy: 438, radius: 25, delay: 0.03, pigment: 2},
  {dx: -742, dy: 216, radius: 13, delay: 0.12, pigment: 0},
  {dx: -248, dy: -486, radius: 12, delay: 0.16, pigment: 1},
  {dx: 238, dy: -452, radius: 21, delay: 0.05, pigment: 2},
  {dx: 528, dy: -372, radius: 15, delay: 0.14, pigment: 0},
  {dx: 726, dy: -156, radius: 31, delay: 0.02, pigment: 1},
  {dx: 682, dy: 276, radius: 18, delay: 0.10, pigment: 2},
  {dx: 424, dy: 424, radius: 27, delay: 0.06, pigment: 0},
  {dx: 86, dy: 494, radius: 14, delay: 0.18, pigment: 1},
  {dx: -606, dy: 64, radius: 20, delay: 0.09, pigment: 2},
];

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const burstEasing = Easing.bezier(0.13, 0.82, 0.22, 1);
const seepEasing = Easing.bezier(0.22, 0.61, 0.36, 1);

const phase = (progress: number, start: number, end: number, easing = Easing.linear) => interpolate(
  progress,
  [start, end],
  [0, 1],
  {...clamp, easing},
);

const deterministicSvgId = (src: string, occurrenceIndex: number) => {
  let hash = 2166136261;
  const value = `${src}:${occurrenceIndex}`;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return `color-ink-${occurrenceIndex}-${(hash >>> 0).toString(36)}`;
};

const InkGeometry: React.FC<{
  readonly cx: number;
  readonly cy: number;
  readonly layoutRotation: number;
  readonly progress: number;
  readonly mode: 'mask' | 'wash' | 'deposit';
  readonly palette: PigmentPalette;
  readonly washGradientPrefix: string;
}> = ({cx, cy, layoutRotation, progress, mode, palette, washGradientPrefix}) => {
  const impact = phase(progress, 0, 0.14, burstEasing);
  const paint = (pigment: number) => {
    if (mode === 'mask') return 'white';
    if (mode === 'wash') return `url(#${washGradientPrefix}-${pigment})`;
    return palette[pigment];
  };

  return (
    <g transform={`rotate(${layoutRotation} ${cx} ${cy})`}>
      <path
        d={ORGANIC_PATHS[2]}
        fill={paint(0)}
        transform={`translate(${cx} ${cy}) rotate(-11) scale(${0.02 + impact * 2.35})`}
      />
      {INK_LOBES.map((lobe, index) => {
        const burst = phase(progress, 0.08 + lobe.delay, 0.42 + lobe.delay * 0.3, burstEasing);
        const seep = phase(progress, 0.24 + lobe.delay, 0.82, seepEasing);
        const scale = lobe.maxScale * (burst * 0.70 + seep * 0.30);
        const spread = burst * 0.80 + seep * 0.20;
        return (
          <path
            key={`lobe-${index}`}
            d={ORGANIC_PATHS[lobe.path]}
            fill={paint(lobe.pigment)}
            transform={`translate(${cx + lobe.dx * spread} ${cy + lobe.dy * spread}) rotate(${lobe.angle}) scale(${Math.max(0.001, scale * lobe.stretchX)} ${Math.max(0.001, scale * lobe.stretchY)})`}
          />
        );
      })}
      {SATELLITES.map((satellite, index) => {
        const splatter = phase(progress, 0.10 + satellite.delay, 0.38 + satellite.delay * 0.35, burstEasing);
        return (
          <path
            key={`satellite-${index}`}
            d={ORGANIC_PATHS[index % ORGANIC_PATHS.length]}
            fill={paint(satellite.pigment)}
            transform={`translate(${cx + satellite.dx * splatter} ${cy + satellite.dy * splatter}) rotate(${index * 29 - 71}) scale(${Math.max(0.001, splatter * satellite.radius / 90)})`}
          />
        );
      })}
    </g>
  );
};

export const WatercolorBloomImage: React.FC<{
  readonly src: string;
  readonly progress: number;
  readonly occurrenceIndex: number;
}> = ({src, progress, occurrenceIndex}) => {
  const normalizedProgress = Math.min(1, Math.max(0, progress));
  const layout = SPLASH_LAYOUTS[occurrenceIndex % SPLASH_LAYOUTS.length];
  const palette = PIGMENT_PALETTES[occurrenceIndex % PIGMENT_PALETTES.length];
  const cx = layout.x * 1920;
  const cy = layout.y * 1080;
  const ids = deterministicSvgId(src, occurrenceIndex);
  const seep = phase(normalizedProgress, 0.24, 0.82, seepEasing);
  const primaryWashOpacity = interpolate(normalizedProgress, [0, 0.14, 0.42, 0.72, 1], [0, 0.48, 0.44, 0.28, 0], clamp);
  const secondaryWashOpacity = interpolate(normalizedProgress, [0, 0.10, 0.34, 0.74, 1], [0, 0.18, 0.22, 0.14, 0], clamp);
  const dilutedWashOpacity = interpolate(normalizedProgress, [0, 0.14, 0.38, 0.72, 1], [0, 0.28, 0.40, 0.24, 0], clamp);
  const depositOpacity = interpolate(normalizedProgress, [0, 0.18, 0.48, 0.78, 1], [0, 0.10, 0.15, 0.09, 0], clamp);
  const finalCoverage = phase(normalizedProgress, 0.70, 1, Easing.bezier(0.22, 0.61, 0.36, 1));

  return (
    <AbsoluteFill data-transition-rule={INTRA_SHOT_WATERCOLOR_BLOOM_RULE_ID}>
      <svg width="1920" height="1080" viewBox="0 0 1920 1080">
        <defs>
          <filter id={`${ids}-bleed`} x="-45%" y="-65%" width="190%" height="230%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.006 0.021" numOctaves="4" seed={31 + occurrenceIndex * 13} result="macroNoise" />
            <feDisplacementMap in="SourceGraphic" in2="macroNoise" scale={16 + seep * 34} xChannelSelector="R" yChannelSelector="B" result="macroEdge" />
            <feTurbulence type="fractalNoise" baseFrequency="0.034 0.115" numOctaves="3" seed={79 + occurrenceIndex * 17} result="paperFibers" />
            <feDisplacementMap in="macroEdge" in2="paperFibers" scale={7 + seep * 14} xChannelSelector="G" yChannelSelector="R" />
            <feGaussianBlur stdDeviation={1.4 + seep * 4.2} />
          </filter>
          <filter id={`${ids}-wash`} x="-45%" y="-65%" width="190%" height="230%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.005 0.018" numOctaves="4" seed={97 + occurrenceIndex * 19} result="washNoise" />
            <feDisplacementMap in="SourceGraphic" in2="washNoise" scale={14 + seep * 32} xChannelSelector="R" yChannelSelector="B" result="warpedWash" />
            <feTurbulence type="fractalNoise" baseFrequency="0.019 0.082" numOctaves="3" seed={151 + occurrenceIndex * 7} result="paperGrain" />
            <feColorMatrix
              in="paperGrain"
              type="matrix"
              values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.30 0.42 0.28 0.32 0.16"
              result="grainAlpha"
            />
            <feComposite in="warpedWash" in2="grainAlpha" operator="in" result="granulatedWash" />
            <feGaussianBlur in="granulatedWash" stdDeviation={0.8 + seep * 1.8} />
          </filter>
          <filter id={`${ids}-deposit`} x="-45%" y="-65%" width="190%" height="230%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.008 0.052" numOctaves="4" seed={113 + occurrenceIndex * 11} result="depositNoise" />
            <feDisplacementMap in="SourceGraphic" in2="depositNoise" scale={18 + seep * 22} xChannelSelector="R" yChannelSelector="B" result="distorted" />
            <feMorphology in="distorted" operator="dilate" radius={1.4 + seep * 1.8} result="outerEdge" />
            <feMorphology in="distorted" operator="erode" radius={0.7 + seep * 0.9} result="innerEdge" />
            <feComposite in="outerEdge" in2="innerEdge" operator="out" result="pigmentRim" />
            <feGaussianBlur in="pigmentRim" stdDeviation={0.45 + seep * 0.55} />
          </filter>
          {palette.map((color, pigment) => (
            <radialGradient
              key={`wash-gradient-${pigment}`}
              id={`${ids}-wash-gradient-${pigment}`}
              gradientUnits="userSpaceOnUse"
              cx={cx}
              cy={cy}
              r="1120"
            >
              <stop offset="0%" stopColor={color} stopOpacity="0.88" />
              <stop offset="48%" stopColor={color} stopOpacity="0.68" />
              <stop offset="78%" stopColor={color} stopOpacity="0.32" />
              <stop offset="100%" stopColor={color} stopOpacity="0.04" />
            </radialGradient>
          ))}
          <radialGradient id={`${ids}-diluted-wash`} gradientUnits="userSpaceOnUse" cx={cx} cy={cy} r="1180">
            <stop offset="0%" stopColor={palette[0]} stopOpacity="0.96" />
            <stop offset="42%" stopColor={palette[1]} stopOpacity="0.78" />
            <stop offset="78%" stopColor={palette[2]} stopOpacity="0.38" />
            <stop offset="100%" stopColor={palette[0]} stopOpacity="0" />
          </radialGradient>
          <mask id={`${ids}-mask`} maskUnits="userSpaceOnUse">
            <rect width="1920" height="1080" fill="black" />
            <g filter={`url(#${ids}-bleed)`}>
              <InkGeometry cx={cx} cy={cy} layoutRotation={layout.rotation} progress={normalizedProgress} mode="mask" palette={palette} washGradientPrefix={`${ids}-wash-gradient`} />
            </g>
          </mask>
        </defs>
        <image href={src} x="0" y="0" width="1920" height="1080" preserveAspectRatio="none" mask={`url(#${ids}-mask)`} />
        <rect
          data-pigment-layer="diluted-wash"
          width="1920"
          height="1080"
          fill={`url(#${ids}-diluted-wash)`}
          mask={`url(#${ids}-mask)`}
          opacity={dilutedWashOpacity}
          style={{mixBlendMode: 'normal'}}
        />
        <g data-pigment-layer="primary-wash" opacity={primaryWashOpacity} filter={`url(#${ids}-wash)`} style={{mixBlendMode: 'normal'}}>
          <InkGeometry cx={cx} cy={cy} layoutRotation={layout.rotation} progress={normalizedProgress} mode="wash" palette={palette} washGradientPrefix={`${ids}-wash-gradient`} />
        </g>
        <g
          id={`${ids}-diluted-wash`}
          data-pigment-layer="diluted-wash"
          opacity={dilutedWashOpacity}
          filter={`url(#${ids}-wash)`}
          transform={`translate(${cx} ${cy}) scale(1.025 1.04) translate(${-cx} ${-cy}) translate(22 -14)`}
          style={{mixBlendMode: 'multiply'}}
        >
          <InkGeometry cx={cx} cy={cy} layoutRotation={layout.rotation + 3} progress={normalizedProgress} mode="wash" palette={palette} washGradientPrefix={`${ids}-wash-gradient`} />
        </g>
        <g opacity={depositOpacity} filter={`url(#${ids}-deposit)`} style={{mixBlendMode: 'multiply'}}>
          <InkGeometry cx={cx} cy={cy} layoutRotation={layout.rotation} progress={normalizedProgress} mode="deposit" palette={palette} washGradientPrefix={`${ids}-wash-gradient`} />
        </g>
      </svg>
      <CanvasImage src={src} width={1920} height={1080} fit="fill" style={{position: 'absolute', inset: 0, opacity: finalCoverage}} />
    </AbsoluteFill>
  );
};

export type WatercolorImageOccurrence = {
  readonly src: string;
  readonly from: number;
  readonly durationInFrames: number;
};

export const WatercolorImageSequence: React.FC<{
  readonly occurrences: readonly WatercolorImageOccurrence[];
  readonly revealFirst?: boolean;
  readonly firstOccurrenceContent?: React.ReactNode;
}> = ({occurrences, revealFirst = false, firstOccurrenceContent}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  if (occurrences.length === 0 || occurrences[0].from !== 0) {
    throw new Error('intra-shot-watercolor-bloom-v1 requires a non-empty image sequence starting at frame zero');
  }
  occurrences.forEach((occurrence, index) => {
    if (!Number.isInteger(occurrence.durationInFrames) || occurrence.durationInFrames < 1) {
      throw new Error(`invalid watercolor image duration at index ${index}`);
    }
    if (index > 0) {
      const previous = occurrences[index - 1];
      if (occurrence.from !== previous.from + previous.durationInFrames) {
        throw new Error(`non-consecutive watercolor image sequence at index ${index}`);
      }
    }
  });

  let occurrenceIndex = 0;
  for (let index = 1; index < occurrences.length; index += 1) {
    if (frame < occurrences[index].from) break;
    occurrenceIndex = index;
  }
  const active = occurrences[Math.max(0, occurrenceIndex)];
  const previous = occurrenceIndex > 0 ? occurrences[occurrenceIndex - 1] : null;
  const localFrame = frame - active.from;
  const transitionFrames = Math.min(
    getIntraShotWatercolorBloomDurationInFrames(fps),
    active.durationInFrames,
  );
  const progress = transitionFrames <= 1
    ? 1
    : interpolate(localFrame, [0, transitionFrames - 1], [0, 1], clamp);

  return (
    <AbsoluteFill style={{backgroundColor: '#f5efe2'}}>
      {previous ? (
        <CanvasImage src={previous.src} width={1920} height={1080} fit="fill" style={{position: 'absolute', inset: 0}} />
      ) : null}
      {occurrenceIndex === 0 && firstOccurrenceContent !== undefined ? (
        firstOccurrenceContent
      ) : occurrenceIndex === 0 && !revealFirst ? (
        <CanvasImage src={active.src} width={1920} height={1080} fit="fill" style={{position: 'absolute', inset: 0}} />
      ) : (
        <WatercolorBloomImage src={active.src} progress={progress} occurrenceIndex={Math.max(0, occurrenceIndex)} />
      )}
    </AbsoluteFill>
  );
};
