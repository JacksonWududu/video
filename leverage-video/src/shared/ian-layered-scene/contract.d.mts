export type IanLayerEntryTransition = {
  readonly contract_version: 'ian-layer-entry-fade-v1';
  readonly duration_frames: 8;
  readonly easing: 'linear';
};

export type IanLayerPlan = {
  readonly layer_id: string;
  readonly z_index: number;
  readonly semantic_role: string;
  readonly source_text_start_byte: number;
  readonly source_text_end_byte_exclusive: number;
  readonly source_text: string;
  readonly entry_frame: number;
};

export type IanLayeredScenePlan = {
  readonly contract_version: 'ian-layered-scene-plan-v1';
  readonly shot_id: string;
  readonly narration_source_text_sha256: string;
  readonly scene_renderer: 'ian-static-layered-scene-v1';
  readonly background_policy: 'static-paper-background-v1';
  readonly layer_asset_policy: 'full-canvas-transparent-png-v1';
  readonly layer_entry_transition: IanLayerEntryTransition;
  readonly motion_policy: {
    readonly scene_transform: 'forbidden';
    readonly layer_transform: 'forbidden';
    readonly mask_reveal: 'forbidden';
    readonly internal_cut: 'forbidden';
    readonly opacity_animation: 'ian-layer-entry-fade-v1';
  };
  readonly layer_count: number;
  readonly layers: readonly IanLayerPlan[];
};

export type IanRasterBinding = {
  readonly path: string;
  readonly checksum_sha256: string;
  readonly width: 1920;
  readonly height: 1080;
  readonly role:
    | 'static-paper-background'
    | 'transparent-semantic-element'
    | 'final-composite-review-raster';
  readonly has_alpha: boolean;
};

export type IanLayeredScenePackage = {
  readonly contract_version: 'ian-knowledge-video-layered-scene-v1';
  readonly episode_workspace: string;
  readonly queue_item_id: string;
  readonly shot_id: string;
  readonly visual_generation_route: 'ian-handdrawn-ppt';
  readonly treatment_profile_id: string;
  readonly storyboard_binding: {readonly path: string; readonly checksum_sha256: string};
  readonly visual_direction_review: {
    readonly path: string;
    readonly checksum_sha256: string;
    readonly presented_map_sha256: string;
  };
  readonly canvas: {readonly width: 1920; readonly height: 1080; readonly fps: 30};
  readonly timing: {
    readonly shot_start_frame: number;
    readonly shot_end_frame: number;
    readonly duration_frames: number;
  };
  readonly narration_source_text: string;
  readonly narration_source_text_sha256: string;
  readonly scene_plan: IanLayeredScenePlan;
  readonly scene_plan_sha256: string;
  readonly generation_constraints: Record<string, boolean | number>;
  readonly background: IanRasterBinding;
  readonly layers: readonly (IanLayerPlan & IanRasterBinding)[];
  readonly final_composite: IanRasterBinding;
  readonly verified_visible_text: readonly string[];
};

export const IAN_LAYERED_SCENE_PLAN_VERSION: 'ian-layered-scene-plan-v1';
export const IAN_LAYERED_SCENE_PACKAGE_VERSION: 'ian-knowledge-video-layered-scene-v1';
export const IAN_LAYERED_SCENE_RENDERER_VERSION: 'ian-static-layered-scene-v1';
export const IAN_LAYER_ENTRY_TRANSITION_VERSION: 'ian-layer-entry-fade-v1';
export const IAN_LAYER_ENTRY_DURATION_FRAMES: 8;
export function sha256Canonical(value: unknown): string;
export function sha256Text(value: string): string;
export function validateIanLayeredScenePlan(
  plan: IanLayeredScenePlan,
  expected: {shotId: string; sourceText: string; durationFrames: number; fps?: number},
): IanLayeredScenePlan;
export function validateIanLayeredSceneRhythmBinding(
  plan: IanLayeredScenePlan,
  expected: {
    shotStartFrame: number;
    rhythmShot: {
      shot_id: string;
      asset_plan: {layer_count: number};
      meaningful_change_events: readonly {at_frame: number; description: string}[];
    };
  },
): {
  contract_version: 'ian-layered-scene-rhythm-binding-v1';
  result: 'pass';
  shot_id: string;
  layer_count: number;
  entry_frames: number[];
};
export function validateIanLayeredScenePackage(
  manifest: IanLayeredScenePackage,
  expected?: Record<string, unknown>,
): IanLayeredScenePackage;
export function composeIanLayeredSceneBytes(input: {
  backgroundPath: string;
  layerPaths: readonly string[];
}): Promise<Buffer>;
export function inspectIanLayeredScenePackage(
  manifest: IanLayeredScenePackage,
  expected: {
    repositoryRoot: string;
    episodeWorkspace: string;
    [key: string]: unknown;
  },
): Promise<{
  contract_version: 'ian-knowledge-video-layered-scene-v1';
  result: 'pass';
  package: IanLayeredScenePackage;
  member_count: number;
  deterministic_composite_match: true;
}>;
