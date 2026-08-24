export type MotionTier = 'layered' | 'stateful' | 'hero_pose';

export type StoryboardVisualRhythmArtifact = Readonly<Record<string, unknown>> & {
  readonly contract_version: 'storyboard-visual-rhythm-v1' | 'storyboard-visual-rhythm-v2';
  readonly profile: 'medium_high_v1';
  readonly shots: readonly Readonly<Record<string, unknown>>[];
};

export const STORYBOARD_VISUAL_RHYTHM_VERSION: 'storyboard-visual-rhythm-v1';
export const STORYBOARD_VISUAL_RHYTHM_V2_VERSION: 'storyboard-visual-rhythm-v2';
export const MEDIUM_HIGH_VISUAL_RHYTHM_PROFILE: 'medium_high_v1';
export const MOTION_TIERS: readonly MotionTier[];
export const MEANINGFUL_CHANGE_MAX_GAP_FRAMES: 120;
export const STRUCTURE_CHANGE_MAX_GAP_FRAMES: 540;
export const FIRST_WINDOW_FRAMES: 900;

export function buildStoryboardVisualRhythmMapSha256(
  artifact: StoryboardVisualRhythmArtifact,
): string;

export function analyzeStoryboardVisualRhythm(
  artifact: StoryboardVisualRhythmArtifact,
): Readonly<Record<string, unknown>>;

export function validateStoryboardVisualRhythm(
  artifact: StoryboardVisualRhythmArtifact,
  context?: {readonly shotIds?: readonly string[] | null},
): Readonly<Record<string, unknown>>;
