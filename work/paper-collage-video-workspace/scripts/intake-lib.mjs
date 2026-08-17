import {createHash} from 'node:crypto';
import {STYLE_ID_PATTERN} from './style-catalog-lib.mjs';

export const ASPECT_RATIOS = {
  '16:9': {width: 1920, height: 1080, label: '横屏 16:9'},
  '9:16': {width: 1080, height: 1920, label: '竖屏 9:16'},
};

export const PARALLAX_PREFERENCES = {
  auto: {
    label: '自动推荐',
    summary: '按故事、画面和所选制作档位决定哪些镜头使用分层视差。',
  },
  prefer: {
    label: '优先使用',
    summary: '在适合的镜头优先规划前中后景和视差，但仍避免无意义堆层。',
  },
  minimal: {
    label: '尽量少用',
    summary: '只在表达空间关系确有必要时使用视差，其他镜头以平面运动为主。',
  },
};

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const isDateTime = (value) =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));

export const createPendingIntake = ({at = new Date().toISOString()} = {}) => ({
  schemaVersion: 2,
  status: 'pending',
  aspectRatio: null,
  visualStylePreset: null,
  parallaxPreference: null,
  styleCatalogVersion: null,
  styleCatalogFingerprint: null,
  styleProfileFingerprint: null,
  confirmedAt: null,
  note: '',
  updatedAt: at,
});

export const intakeDecisionFingerprint = (intake) =>
  sha256(JSON.stringify({
    aspectRatio: intake.aspectRatio,
    visualStylePreset: intake.visualStylePreset,
    parallaxPreference: intake.parallaxPreference,
    styleCatalogVersion: intake.styleCatalogVersion,
    styleCatalogFingerprint: intake.styleCatalogFingerprint,
    styleProfileFingerprint: intake.styleProfileFingerprint,
  }));

export const validateIntake = (intake) => {
  const issues = [];
  const add = (message, location) => issues.push({message, location});
  if (!intake || typeof intake !== 'object' || Array.isArray(intake)) {
    return [{message: '缺少 intake。', location: 'intake'}];
  }
  if (intake.schemaVersion !== 2) add('intake.schemaVersion 必须为 2。', 'intake.schemaVersion');
  if (!['pending', 'confirmed'].includes(intake.status)) {
    add('intake.status 必须为 pending 或 confirmed。', 'intake.status');
  }
  if (!isDateTime(intake.updatedAt)) add('intake.updatedAt 必须是有效时间。', 'intake.updatedAt');
  if (typeof intake.note !== 'string') add('intake.note 必须为字符串。', 'intake.note');
  if (intake.status === 'pending') {
    for (const key of [
      'aspectRatio',
      'visualStylePreset',
      'parallaxPreference',
      'styleCatalogVersion',
      'styleCatalogFingerprint',
      'styleProfileFingerprint',
      'confirmedAt',
    ]) {
      if (intake[key] !== null) add(`pending intake 的 ${key} 必须为 null。`, `intake.${key}`);
    }
    return issues;
  }
  if (!Object.hasOwn(ASPECT_RATIOS, intake.aspectRatio)) {
    add('画幅必须是 16:9 或 9:16。', 'intake.aspectRatio');
  }
  if (!STYLE_ID_PATTERN.test(intake.visualStylePreset ?? '')) {
    add('视觉风格必须是有效的目录风格 id。', 'intake.visualStylePreset');
  }
  if (!Object.hasOwn(PARALLAX_PREFERENCES, intake.parallaxPreference)) {
    add('视差偏好必须是 auto、prefer 或 minimal。', 'intake.parallaxPreference');
  }
  if (typeof intake.styleCatalogVersion !== 'string' || !intake.styleCatalogVersion) {
    add('必须记录 style catalog version。', 'intake.styleCatalogVersion');
  }
  if (!/^[a-f0-9]{64}$/.test(intake.styleCatalogFingerprint ?? '')) {
    add('必须记录有效 style catalog fingerprint。', 'intake.styleCatalogFingerprint');
  }
  if (!/^[a-f0-9]{64}$/.test(intake.styleProfileFingerprint ?? '')) {
    add('必须记录有效 style profile fingerprint。', 'intake.styleProfileFingerprint');
  }
  if (!isDateTime(intake.confirmedAt)) {
    add('confirmed intake 必须记录 confirmedAt。', 'intake.confirmedAt');
  }
  return issues;
};

export const assertIntakeConfirmed = (intake) => {
  const issues = validateIntake(intake);
  if (intake?.status !== 'confirmed' || issues.length > 0) {
    throw new Error(
      issues.length
        ? issues.map(({location, message}) => `${location}: ${message}`).join('\n')
        : '请先完成人工 intake 选择。',
    );
  }
  return intake;
};

export const confirmIntake = ({
  selection,
  catalog,
  at = new Date().toISOString(),
}) => {
  const selectedStyle = catalog.styles.find(
    ({id}) => id === selection.visualStylePreset,
  );
  if (!selectedStyle) {
    throw new Error(`视觉风格不在当前目录中：${selection.visualStylePreset ?? 'missing'}。`);
  }
  const intake = {
    schemaVersion: 2,
    status: 'confirmed',
    aspectRatio: selection.aspectRatio,
    visualStylePreset: selection.visualStylePreset,
    parallaxPreference: selection.parallaxPreference,
    styleCatalogVersion: catalog.version,
    styleCatalogFingerprint: catalog.fingerprint,
    styleProfileFingerprint: selectedStyle.profileFingerprint,
    confirmedAt: at,
    note: String(selection.note ?? '').trim(),
    updatedAt: at,
  };
  const issues = validateIntake(intake);
  if (issues.length > 0) {
    throw new Error(issues.map(({location, message}) => `${location}: ${message}`).join('\n'));
  }
  return intake;
};
