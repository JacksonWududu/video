import crypto from 'node:crypto';
import {FLIPBOOK_STATIC_CONTRACT} from '../flipbook-video/profile.mjs';

export const STATIC_SPREAD_CONTRACT = FLIPBOOK_STATIC_CONTRACT;
export const FLIPBOOK_BODY_TEXT_CONTRACT = 'locked-narration-spread-body-v1';

const sourceChecksum = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

export const buildStaticSpread = (sourceText) => {
  if (typeof sourceText !== 'string' || sourceText.trim() === '') {
    throw new Error('static spread requires non-empty exact narration');
  }
  return {
    contract_version: STATIC_SPREAD_CONTRACT,
    source_text: sourceText,
    source_text_sha256: sourceChecksum(sourceText),
  };
};

export const validateStaticSpread = (spread, {sourceText, shotId = 'static spread'} = {}) => {
  if (spread?.contract_version !== STATIC_SPREAD_CONTRACT) {
    throw new Error(`${shotId} static spread contract is missing or unsupported`);
  }
  const expected = buildStaticSpread(sourceText ?? spread.source_text);
  if (spread.source_text !== expected.source_text
    || spread.source_text_sha256 !== expected.source_text_sha256) {
    throw new Error(`${shotId} static spread narration bytes or checksum are stale`);
  }
  return {result: 'pass', ...expected};
};

export const validateStaticSpreadStoryboardSection = (section, shotId, {sourceText} = {}) => {
  const match = section.match(/^- 图文双页：`knowledge-video-static-spread-v1`；精确计划 `(.+)`。$/m);
  if (!match) throw new Error(`${shotId} lacks the exact static spread JSON plan`);
  let spread;
  try { spread = JSON.parse(match[1]); } catch { throw new Error(`${shotId} static spread JSON is invalid`); }
  validateStaticSpread(spread, {sourceText, shotId});
  if (/Ian 分层场景计划|motion_tier: (?:layered|stateful|hero_pose)/.test(section)) {
    throw new Error(`${shotId} static spread must not contain a layered or pose plan`);
  }
  return spread;
};
