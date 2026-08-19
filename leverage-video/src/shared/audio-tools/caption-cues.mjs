import crypto from 'node:crypto';

const punctuation = /\p{P}/u;
const whitespace = /\s/u;

export const normalizeCaptionDisplayText = (sourceText) => Array.from(sourceText)
  .filter((character) => !punctuation.test(character))
  .join('')
  .replace(/\s+/gu, ' ')
  .trim();

const splitSourceText = (sourceText, maximumDisplayCharacters) => {
  const characters = Array.from(sourceText);
  const chunks = [];
  let start = 0;

  while (start < characters.length) {
    let displayCharacters = 0;
    let lastPreferredBoundary = -1;
    let cursor = start;
    for (; cursor < characters.length; cursor += 1) {
      const character = characters[cursor];
      if (!punctuation.test(character) && !whitespace.test(character)) displayCharacters += 1;
      if ((punctuation.test(character) || character === '\n') && displayCharacters >= 8) {
        lastPreferredBoundary = cursor + 1;
      }
      if (displayCharacters >= maximumDisplayCharacters) {
        cursor = lastPreferredBoundary > start ? lastPreferredBoundary : cursor + 1;
        break;
      }
    }
    const end = Math.min(characters.length, cursor >= characters.length ? characters.length : cursor);
    if (end <= start) throw new Error('caption source splitter did not advance');
    const source = characters.slice(start, end).join('');
    const display = normalizeCaptionDisplayText(source);
    if (display === '') {
      if (chunks.length === 0) throw new Error('caption source begins with an empty display chunk');
      chunks[chunks.length - 1] += source;
    } else {
      chunks.push(source);
    }
    start = end;
  }
  return chunks;
};

export const buildNarrationCaptionCues = ({
  shots,
  fps,
  narrationSpeechEndFrame,
  maximumDisplayCharacters = 20,
}) => {
  if (!Number.isInteger(fps) || fps <= 0) throw new Error('caption fps must be a positive integer');
  if (!Number.isInteger(narrationSpeechEndFrame) || narrationSpeechEndFrame <= 0) {
    throw new Error('narrationSpeechEndFrame must be a positive integer');
  }
  if (!Number.isInteger(maximumDisplayCharacters) || maximumDisplayCharacters < 8) {
    throw new Error('maximumDisplayCharacters must be an integer of at least 8');
  }
  const cues = [];
  for (const shot of shots) {
    const activeEndFrame = Math.min(shot.end_frame, narrationSpeechEndFrame);
    if (activeEndFrame <= shot.start_frame) continue;
    const chunks = splitSourceText(shot.source_text, maximumDisplayCharacters);
    const weights = chunks.map((sourceText) => normalizeCaptionDisplayText(sourceText).length);
    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    let consumedWeight = 0;
    for (let index = 0; index < chunks.length; index += 1) {
      const startFrame = index === 0
        ? shot.start_frame
        : shot.start_frame + Math.round(
          ((activeEndFrame - shot.start_frame) * consumedWeight) / totalWeight,
        );
      consumedWeight += weights[index];
      const endFrame = index === chunks.length - 1
        ? activeEndFrame
        : shot.start_frame + Math.round(
          ((activeEndFrame - shot.start_frame) * consumedWeight) / totalWeight,
        );
      if (endFrame <= startFrame) throw new Error(`caption cue has no duration: ${shot.shot_id}`);
      cues.push({
        cue_id: `${shot.shot_id}-C${String(index + 1).padStart(2, '0')}`,
        shot_id: shot.shot_id,
        start_frame: startFrame,
        end_frame: endFrame,
        start_seconds: startFrame / fps,
        end_seconds: endFrame / fps,
        source_text: chunks[index],
        display_text: normalizeCaptionDisplayText(chunks[index]),
      });
    }
  }
  if (cues[0]?.start_frame !== 0) throw new Error('first caption cue must begin at frame 0');
  if (cues.at(-1)?.end_frame !== narrationSpeechEndFrame) {
    throw new Error('last caption cue must end at narrationSpeechEndFrame');
  }
  return cues;
};

export const sha256Text = (value) => crypto.createHash('sha256').update(value).digest('hex');
