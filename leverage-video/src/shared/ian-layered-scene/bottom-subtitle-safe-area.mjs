import fs from 'node:fs';

const POLICY_PATH = new URL('./bottom-subtitle-safe-area-v1.json', import.meta.url);
const policy = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'));
const exactKeys = (value, keys) => value && typeof value === 'object'
  && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());

const expectedHeight = Math.round(1080 * 23 / 100);
const expectedSafeArea = {
  x: 0,
  y: 1080 - expectedHeight,
  width: 1920,
  height: expectedHeight,
};
if (!exactKeys(policy, [
  'contract_version', 'target_height_percent', 'pixel_rounding', 'safe_area',
])
    || policy.contract_version !== 'ian-bottom-subtitle-safe-area-v1'
    || policy.target_height_percent !== 23
    || policy.pixel_rounding !== 'nearest-integer-v1'
    || !exactKeys(policy.safe_area, ['x', 'y', 'width', 'height'])
    || JSON.stringify(policy.safe_area) !== JSON.stringify(expectedSafeArea)) {
  throw new Error('Ian bottom subtitle safe-area policy is invalid');
}

export const IAN_BOTTOM_SUBTITLE_SAFE_AREA_POLICY = Object.freeze({
  ...policy,
  safe_area: Object.freeze({...policy.safe_area}),
});
export const IAN_BOTTOM_SUBTITLE_SAFE_AREA_PROMPT_MARKER =
  'IAN BOTTOM SUBTITLE SAFE AREA: x=0, y=832, width=1920, height=248.';

export const validateIanBottomSubtitleSafeArea = (
  value,
  label = 'Ian bottom subtitle safe area',
) => {
  if (!exactKeys(value, [
    'contract_version', 'target_height_percent', 'pixel_rounding', 'safe_area',
  ])
      || value.contract_version !== policy.contract_version
      || value.target_height_percent !== policy.target_height_percent
      || value.pixel_rounding !== policy.pixel_rounding
      || !exactKeys(value.safe_area, ['x', 'y', 'width', 'height'])
      || JSON.stringify(value.safe_area) !== JSON.stringify(policy.safe_area)) {
    throw new Error(`${label} must equal ian-bottom-subtitle-safe-area-v1`);
  }
  return structuredClone(policy);
};
