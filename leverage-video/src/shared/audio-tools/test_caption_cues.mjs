import assert from 'node:assert/strict';
import test from 'node:test';

import {buildNarrationCaptionCues, normalizeCaptionDisplayText} from './caption-cues.mjs';

test('caption display text removes Unicode punctuation and normalizes whitespace', () => {
  assert.equal(normalizeCaptionDisplayText('知行，合一。\n共勉！'), '知行合一 共勉');
});

test('caption cues preserve exact source bytes and narration-derived frame bounds', () => {
  const source = '第一句，继续说明。\n第二句收束。\n';
  const cues = buildNarrationCaptionCues({
    shots: [{shot_id: 'OPEN-00', start_frame: 0, end_frame: 120, source_text: source}],
    fps: 30,
    narrationSpeechEndFrame: 90,
    maximumDisplayCharacters: 8,
  });
  assert.equal(cues.map((cue) => cue.source_text).join(''), source);
  assert.equal(cues[0].start_frame, 0);
  assert.equal(cues.at(-1).end_frame, 90);
  assert.ok(cues.every((cue) => cue.display_text.replace(/\s+/gu, '').length <= 8));
  assert.ok(cues.every((cue) => cue.end_frame > cue.start_frame));
});
