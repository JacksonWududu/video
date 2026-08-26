export type TransitionKind =
  | 'cut'
  | 'dissolve'
  | 'paper-wipe'
  | 'watercolor-bloom'
  | 'match-cut'
  | 'fade'
  | 'slide'
  | 'wipe'
  | 'flip'
  | 'clock-wipe'
  | 'iris'
  | 'linear-blur'
  | 'zoom-blur';

export type RetiredTransitionKindV3 = 'zoom-blur' | 'flip' | 'slide' | 'clock-wipe';
export type ActiveTransitionKind = Exclude<TransitionKind, RetiredTransitionKindV3>;

export type SceneTransitionContractV1 = {
  contract_version: 'scene-transition-v1';
  kind: 'dissolve' | 'paper-wipe' | 'watercolor-bloom' | 'match-cut';
  duration_seconds: number;
  duration_in_frames: number;
  source_intent: string;
};

export type SceneTransitionContractV2 = {
  contract_version: 'scene-transition-v2';
  catalog_version: 'scene-transition-catalog-v2';
  source_shot_id: string;
  next_shot_id: string;
  kind: TransitionKind;
  options: Readonly<Record<string, unknown>>;
  duration_seconds: number;
  duration_in_frames: number;
  source_intent: string;
  renderer: 'leverage-video/src/shared/scene-transitions';
  user_selection: {
    status: 'approved';
    exact_message: string;
    decided_at: string;
    presented_map_sha256: string;
  };
};

export type BoundaryChangeClass =
  | 'continuity'
  | 'match_continuity'
  | 'section_change'
  | 'route_change'
  | 'time_place_change'
  | 'contrast_or_warning';

export type TransitionRecommendation = {
  kind: ActiveTransitionKind;
  options: Readonly<Record<string, unknown>>;
};

export type UserRequestedTransition = {
  transition: TransitionRecommendation;
  exact_message: string;
  requested_at: string;
  based_on_presented_map_sha256: string;
};

export type SceneTransitionContractV3 = Omit<SceneTransitionContractV2, 'contract_version' | 'catalog_version' | 'kind'> & {
  contract_version: 'scene-transition-v3';
  catalog_version: 'scene-transition-catalog-v3';
  boundary_change_class: BoundaryChangeClass;
  source_visual_generation_route: string;
  next_visual_generation_route: string;
  source_white_cat_present: boolean;
  next_white_cat_present: boolean;
  white_cat_visual_style_id?: 'loose-line-vivid-watercolor' | 'twilight-neon-animation';
  recommended_transition: TransitionRecommendation;
  recommendation_source:
    | {authority: 'visual-generation-route'; route_id: string; rule_id: string}
    | {
      authority: 'white-cat-transition-policy';
      rule_id:
        | 'imagegen-white-cat-watercolor-bloom-priority-v1'
        | 'imagegen-white-cat-twilight-dissolve-priority-v1';
      matched_boundary_roles: readonly ('source' | 'next')[];
    }
    | {authority: 'shared-fallback'; rule_id: string};
  kind: ActiveTransitionKind;
  diversity_adjustment?: {
    rule_id: 'scene-transition-recommendation-diversity-v2';
    applied: boolean;
    base_transition: TransitionRecommendation;
    reason: string;
  };
};

export type SceneTransitionContract = SceneTransitionContractV1 | SceneTransitionContractV2 | SceneTransitionContractV3;

export const TRANSITION_KINDS: readonly TransitionKind[];
export const LEGACY_SCENE_TRANSITION_CATALOG_VERSION: 'scene-transition-catalog-v2';
export const SCENE_TRANSITION_CATALOG_VERSION: 'scene-transition-catalog-v3';
export const LEGACY_TRANSITION_CATALOG: readonly {
  readonly kind: TransitionKind;
  readonly label: string;
  readonly family: 'structural' | 'shared-custom' | 'remotion';
  readonly required_options: readonly string[];
}[];
export const RETIRED_TRANSITION_KINDS_V3: readonly RetiredTransitionKindV3[];
export const TRANSITION_CATALOG: readonly {
  readonly kind: ActiveTransitionKind;
  readonly label: string;
  readonly family: 'structural' | 'shared-custom' | 'remotion';
  readonly required_options: readonly string[];
}[];
export const TRANSITION_KINDS_V2: readonly TransitionKind[];
export const TRANSITION_KINDS_V3: readonly ActiveTransitionKind[];
export const BOUNDARY_CHANGE_CLASSES: readonly BoundaryChangeClass[];
export const TRANSITION_RECOMMENDATION_DIVERSITY_RULE_ID:
  'scene-transition-recommendation-diversity-v2';
export const WHITE_CAT_TRANSITION_RECOMMENDATION_RULE_ID:
  'imagegen-white-cat-watercolor-bloom-priority-v1';
export const TWILIGHT_WHITE_CAT_TRANSITION_RECOMMENDATION_RULE_ID:
  'imagegen-white-cat-twilight-dissolve-priority-v1';

export function getRecommendedTransition(input: {
  boundaryChangeClass: BoundaryChangeClass;
  nextVisualGenerationRoute?: string | null;
}): {kind: ActiveTransitionKind; options: Readonly<Record<string, unknown>>};

export function resolveTransitionRecommendation(input: {
  boundaryChangeClass: BoundaryChangeClass;
  sourceVisualGenerationRoute: string;
  nextVisualGenerationRoute: string;
  sourceWhiteCatPresent?: boolean;
  nextWhiteCatPresent?: boolean;
  whiteCatVisualStyleId?: 'loose-line-vivid-watercolor' | 'twilight-neon-animation';
}): Pick<SceneTransitionContractV3, 'recommended_transition' | 'recommendation_source'>;

export function applyTransitionRecommendationDiversity(rows: readonly {
  source_shot_id: string;
  boundary_change_class: BoundaryChangeClass;
  recommended_transition: TransitionRecommendation;
  recommendation_source: SceneTransitionContractV3['recommendation_source'];
  user_requested_transition?: UserRequestedTransition;
}[]): {
  policy: {
    rule_id: 'scene-transition-recommendation-diversity-v2';
    applies_to: 'visible-transition-kinds-only';
    cut_exempt: true;
    visible_boundary_count: number;
    max_identical_visible_kind_uses: number;
    max_identical_visible_kind_absolute_uses: 5;
    max_identical_visible_kind_share: 0.3;
    max_identical_visible_kind_share_denominator: 'visible_boundary_count';
    max_identical_visible_kind_share_uses: number;
    max_consecutive_identical_visible_kind_uses: 3;
    route_specific_recommendations_keep_priority: true;
    white_cat_style_bound_priority: true;
  };
  rows: readonly {
    source_shot_id: string;
    boundary_change_class: BoundaryChangeClass;
    recommended_transition: TransitionRecommendation;
    recommendation_source: SceneTransitionContractV3['recommendation_source'];
    user_requested_transition?: UserRequestedTransition;
    proposed_transition: TransitionRecommendation;
    diversity_adjustment: NonNullable<SceneTransitionContractV3['diversity_adjustment']>;
  }[];
};

export function resolveTransitionIntent(input: {
  intent: string;
  fps: number;
  isTerminal: boolean;
}): SceneTransitionContract | null;

export function validateUserApprovedTransition(
  transition: unknown,
  context: {fps: number; sourceShotId: string; nextShotId: string},
): SceneTransitionContractV2 | SceneTransitionContractV3;

export function validateRevoiceTransitionLock(
  parentTransition: unknown,
  derivativeTransition: unknown,
  context: {
    fps: number;
    sourceShotId: string;
    nextShotId: string;
    shotDurationFrames: number;
  },
): SceneTransitionContractV2 | SceneTransitionContractV3;
