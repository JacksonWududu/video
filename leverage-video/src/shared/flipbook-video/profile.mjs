import crypto from 'node:crypto';

export const FLIPBOOK_STYLE_ID = 'illustrated-flipbook';
export const FLIPBOOK_CONTRACT = 'knowledge-video-flipbook-v1';
export const FLIPBOOK_STATIC_CONTRACT = 'knowledge-video-static-spread-v1';
export const FLIPBOOK_TRANSITION_KIND = 'book-page-turn';
export const FLIPBOOK_RENDERER = 'leverage-video/src/shared/flipbook-video/browser-runtime.js';
export const isFlipbookStyle = (selection) => selection?.style_id === FLIPBOOK_STYLE_ID;
export const isFlipbookRow = (row) => row?.presentation_mode === FLIPBOOK_STYLE_ID;

export const FLIPBOOK_PROFILE = Object.freeze({
  contract_version: FLIPBOOK_CONTRACT,
  style_id: FLIPBOOK_STYLE_ID,
  label: '图文翻书',
  routes: ['ian-handdrawn-ppt', 'imagegen'],
  white_cat_present: false,
  image_mode: 'static_full_image',
  image_aspect: '16:9',
  image_fit: 'contain',
  image_paper_blend: 'multiply',
  subtitle_safe_area_required: false,
  body_text: 'exact_locked_narration',
  text_reveal: 'audio_timed_opacity_and_soft_settle',
  image_side: 'seeded_once_per_spread',
  canvas: {width: 1920, height: 1080, fps: 30},
  palette: {background: '#ddd7cf', background_upper: '#e5e0d8', background_highlight: '#efece4', background_shadow: '#d5cfc7', paper: '#fbfaf5', ink: '#171512'},
  typography: {body: 'Songti SC, STSong, SimSun, serif', minimum_body_px: 28},
  density_semantics: 'information_and_diagram_detail',
  transition: {kind: FLIPBOOK_TRANSITION_KIND, renderer: FLIPBOOK_RENDERER},
  publishing_covers: 'unchanged_package_with_explicit_opening_cover_adapter',
});
export const FLIPBOOK_PROFILE_BYTES = JSON.stringify(FLIPBOOK_PROFILE, null, 2) + '\n';
export const FLIPBOOK_PROFILE_SHA256 = crypto.createHash('sha256').update(FLIPBOOK_PROFILE_BYTES).digest('hex');
