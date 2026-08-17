const CLOSING_PUNCTUATION = '”’」』）》】〕〉》';
const closingPunctuationPattern = `[${CLOSING_PUNCTUATION}]*`;

const punctuationPause = (text) => {
  if (new RegExp(`[。！？!?]${closingPunctuationPattern}$`, 'u').test(text)) {
    return 1.8;
  }
  if (new RegExp(`[，、；：,;:]${closingPunctuationPattern}$`, 'u').test(text)) {
    return 0.8;
  }
  return 0;
};

const visibleCharacters = (text) =>
  [...String(text ?? '').replace(/\s/gu, '')];

const splitBalancedCharacters = (text, maximumCharacters) => {
  const characters = [...text];
  const chunkCount = Math.ceil(characters.length / maximumCharacters);
  const baseSize = Math.floor(characters.length / chunkCount);
  const largerChunks = characters.length % chunkCount;
  const output = [];
  let cursor = 0;
  for (let index = 0; index < chunkCount; index += 1) {
    const size = baseSize + (index < largerChunks ? 1 : 0);
    output.push(characters.slice(cursor, cursor + size).join(''));
    cursor += size;
  }
  return output;
};

const splitAtPhraseBoundaries = (segment, maximumCharacters) => {
  const phrases = segment.split(/\s+/u).filter(Boolean);
  if (phrases.length <= 1) {
    return splitBalancedCharacters(segment, maximumCharacters);
  }
  const output = [];
  let index = 0;
  while (index < phrases.length) {
    const currentPhrase = phrases[index];
    if (visibleCharacters(currentPhrase).length > maximumCharacters) {
      output.push(...splitBalancedCharacters(currentPhrase, maximumCharacters));
      index += 1;
      continue;
    }
    const remainingCharacters = phrases
      .slice(index)
      .reduce(
        (total, phrase) => total + visibleCharacters(phrase).length,
        0,
      );
    const remainingChunks = Math.ceil(
      remainingCharacters / maximumCharacters,
    );
    const targetCharacters = Math.ceil(
      remainingCharacters / remainingChunks,
    );
    const chunk = [];
    let chunkCharacters = 0;
    while (index < phrases.length) {
      const phrase = phrases[index];
      const phraseCharacters = visibleCharacters(phrase).length;
      const candidateCharacters = chunkCharacters + phraseCharacters;
      if (chunk.length > 0 && candidateCharacters > maximumCharacters) break;
      if (
        chunk.length > 0 &&
        chunkCharacters >= targetCharacters &&
        Math.abs(chunkCharacters - targetCharacters) <=
          Math.abs(candidateCharacters - targetCharacters)
      ) {
        break;
      }
      chunk.push(phrase);
      chunkCharacters = candidateCharacters;
      index += 1;
    }
    output.push(chunk.join(' '));
  }
  return output;
};

const splitLongSegment = (segment, maximumCharacters) => {
  const normalized = segment.replace(/\s+/gu, ' ').trim();
  if (visibleCharacters(normalized).length <= maximumCharacters) {
    return [normalized];
  }
  const pieces = normalized
    .split(/(?<=[，、；：,;:])/u)
    .map((piece) => piece.replace(/\s+/gu, ' ').trim())
    .filter(Boolean);
  const output = [];
  for (const piece of pieces.length > 1 ? pieces : [normalized]) {
    output.push(...splitAtPhraseBoundaries(piece, maximumCharacters));
  }
  return output;
};

const attachLeadingClosers = (segments) => {
  const output = [];
  const leadingClosers = new RegExp(`^([${CLOSING_PUNCTUATION}]+)(.*)$`, 'us');
  for (const segment of segments) {
    const match = segment.match(leadingClosers);
    if (!match || output.length === 0) {
      output.push(segment);
      continue;
    }
    output[output.length - 1] += match[1];
    if (match[2]) output.push(match[2]);
  }
  return output;
};

export const segmentSubtitleText = (text, maximumCharacters) =>
  attachLeadingClosers(
    attachLeadingClosers(
      String(text ?? '')
        .replace(/\s+/gu, ' ')
        .trim()
        .split(/(?<=[。！？!?])/u)
        .map((segment) => segment.trim())
        .filter(Boolean),
    )
      .flatMap((segment) => splitLongSegment(segment, maximumCharacters)),
  );

export const defaultSubtitleMaximumCharacters = ({width, height}) =>
  width / height < 1 ? 16 : 18;

export const ensureVisibleNarrationSubtitles = (scene) => {
  const narrated =
    Boolean(scene.narration?.src) &&
    Number(scene.narration?.durationSeconds) > 0;
  if (
    !narrated ||
    !Array.isArray(scene.subtitles) ||
    scene.subtitles.length === 0 ||
    scene.appearance?.subtitles?.variant !== 'hidden'
  ) {
    return false;
  }
  scene.appearance = {
    ...(scene.appearance ?? {}),
    subtitles: {
      ...(scene.appearance?.subtitles ?? {}),
      variant: 'boxed',
      edgeTreatment:
        scene.appearance?.subtitles?.edgeTreatment ?? 'crisp-outline',
    },
  };
  return true;
};

export const deriveSubtitleCues = ({
  text,
  startSeconds,
  durationSeconds,
  fps,
  maximumCharacters,
  gapSeconds = 2 / 30,
}) => {
  const rawSegments = segmentSubtitleText(text, maximumCharacters);
  if (rawSegments.length === 0) return [];
  const narrationFrames = Math.max(1, Math.ceil(durationSeconds * fps));
  const startFrame = Math.round(startSeconds * fps);
  const requestedGapFrames = Math.max(0, Math.round(gapSeconds * fps));
  const segmentCount = Math.min(rawSegments.length, narrationFrames);
  const segments = Array.from({length: segmentCount}, (_, index) => {
    const from = Math.floor((index * rawSegments.length) / segmentCount);
    const to = Math.floor(((index + 1) * rawSegments.length) / segmentCount);
    return rawSegments.slice(from, to).join('');
  });
  const effectiveGapFrames =
    segments.length <= 1
      ? 0
      : Math.min(
          requestedGapFrames,
          Math.max(
            0,
            Math.floor(
              (narrationFrames - segments.length) / (segments.length - 1),
            ),
          ),
        );
  const totalGapFrames = effectiveGapFrames * Math.max(0, segments.length - 1);
  const availableFrames = Math.max(1, narrationFrames - totalGapFrames);
  const weights = segments.map((segment) =>
    Math.max(
      1,
      visibleCharacters(segment).length + punctuationPause(segment),
    ));
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  let cursor = startFrame;
  let allocated = 0;
  return segments.map((segment, index) => {
    const isLast = index === segments.length - 1;
    const remainingAfter = segments.length - index - 1;
    const frames = isLast
      ? availableFrames - allocated
      : Math.min(
          availableFrames - allocated - remainingAfter,
          Math.max(1, Math.round((availableFrames * weights[index]) / totalWeight)),
        );
    const from = cursor;
    const to = isLast
      ? startFrame + narrationFrames
      : Math.min(startFrame + narrationFrames, from + frames);
    allocated += to - from;
    cursor = to + (isLast ? 0 : effectiveGapFrames);
    return {
      fromSeconds: from / fps,
      toSeconds: to / fps,
      text: segment,
    };
  });
};

export const cuesFromTiming = ({timing, startSeconds}) =>
  timing.map((cue) => ({
    fromSeconds: startSeconds + Math.max(0, cue.startSeconds),
    toSeconds: startSeconds + Math.max(0, cue.endSeconds),
    text: cue.text,
  }));
