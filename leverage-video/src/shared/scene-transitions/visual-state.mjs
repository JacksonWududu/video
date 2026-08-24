const clampProgress = (progress) => {
  if (typeof progress !== 'number' || !Number.isFinite(progress)) {
    throw new Error(`invalid transition progress: ${progress}`);
  }
  return Math.min(1, Math.max(0, progress));
};

const pct = (value) => `${Number(value.toFixed(3))}%`;

export const resolveTransitionTailProgress = ({tailFrame, durationInFrames}) => {
  if (typeof tailFrame !== 'number' || !Number.isFinite(tailFrame)) {
    throw new Error(`invalid transition tail frame: ${tailFrame}`);
  }
  if (typeof durationInFrames !== 'number'
    || !Number.isFinite(durationInFrames)
    || durationInFrames <= 0) {
    throw new Error(`invalid transition duration: ${durationInFrames}`);
  }
  return clampProgress(tailFrame / durationInFrames);
};

const directionalTranslate = (direction, progress) => {
  const amount = progress * 100;
  if (direction === 'from-left') return `${pct(amount)} 0`;
  if (direction === 'from-right') return `-${pct(amount)} 0`;
  if (direction === 'from-top') return `0 ${pct(amount)}`;
  if (direction === 'from-bottom') return `0 -${pct(amount)}`;
  throw new Error(`invalid transition direction: ${direction}`);
};

const directionalClip = (direction, progress) => {
  const amount = pct(progress * 100);
  if (direction === 'from-left') return `inset(0 0 0 ${amount})`;
  if (direction === 'from-right') return `inset(0 ${amount} 0 0)`;
  if (direction === 'from-top') return `inset(${amount} 0 0 0)`;
  if (direction === 'from-bottom') return `inset(0 0 ${amount} 0)`;
  throw new Error(`invalid transition direction: ${direction}`);
};

export const resolveTransitionTailStyle = ({kind, options = {}, progress}) => {
  const value = clampProgress(progress);
  if (kind === 'dissolve' || kind === 'fade') return {opacity: 1 - value};

  if (kind === 'paper-wipe') {
    const translate = pct(value * 108);
    return {
      transform: `translate3d(${translate}, 0, 0)`,
      borderLeft: '2px solid rgba(91, 64, 39, 0.22)',
      boxShadow: '-12px 0 18px rgba(91, 64, 39, 0.28)',
      willChange: 'transform',
    };
  }

  if (kind === 'watercolor-bloom') {
    const bloom = value * 86;
    return {
      opacity: 1 - value,
      WebkitMaskImage: `radial-gradient(circle at 50% 52%, transparent 0 ${bloom}%, rgba(0,0,0,0.38) ${Math.min(100, bloom + 4)}%, black ${Math.min(100, bloom + 10)}%)`,
      maskImage: `radial-gradient(circle at 50% 52%, transparent 0 ${bloom}%, rgba(0,0,0,0.38) ${Math.min(100, bloom + 4)}%, black ${Math.min(100, bloom + 10)}%)`,
      filter: `blur(${value * 7}px) saturate(${1 + value * 0.28})`,
    };
  }

  if (kind === 'match-cut') {
    const opacity = value <= 0.48 ? 1 - value * (0.08 / 0.48) : 0.92 * (1 - (value - 0.48) / 0.52);
    return {
      opacity,
      scale: 1 + value * 0.075,
      filter: `contrast(${1 + Math.sin(value * Math.PI) * 0.08})`,
    };
  }

  if (kind === 'slide') {
    return {translate: directionalTranslate(options.direction, value), opacity: 1 - value * 0.12};
  }
  if (kind === 'wipe') return {clipPath: directionalClip(options.direction, value)};
  if (kind === 'flip') {
    if (!['horizontal', 'vertical'].includes(options.direction)) {
      throw new Error('flip direction must be horizontal or vertical');
    }
    const axis = options.direction === 'horizontal' ? 'Y' : 'X';
    return {
      opacity: 1 - value,
      transform: `perspective(1600px) rotate${axis}(${value * 96}deg)`,
      transformOrigin: '50% 50%',
      backfaceVisibility: 'hidden',
    };
  }
  if (kind === 'clock-wipe') {
    const angle = value * 360;
    const mask = `conic-gradient(from -90deg, transparent 0 ${angle}deg, black ${angle}deg 360deg)`;
    return {WebkitMaskImage: mask, maskImage: mask};
  }
  if (kind === 'iris') {
    const radius = value * 72;
    const mask = `radial-gradient(circle at 50% 50%, transparent 0 ${radius}%, black ${Math.min(100, radius + 0.8)}%)`;
    return {WebkitMaskImage: mask, maskImage: mask};
  }
  if (kind === 'linear-blur') {
    return {opacity: 1 - value, filter: `blur(${value * 18}px)`};
  }
  if (kind === 'zoom-blur') {
    return {
      opacity: 1 - value,
      scale: 1 + value * 0.16,
      filter: `blur(${value * 14}px) saturate(${1 + value * 0.12})`,
    };
  }

  throw new Error(`Unsupported scene transition kind: ${kind}`);
};
