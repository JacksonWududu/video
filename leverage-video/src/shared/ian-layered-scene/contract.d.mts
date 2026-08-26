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
  readonly width: number;
  readonly height: number;
  readonly role:
    | 'text-free-complete-master-source'
    | 'text-free-complete-master-normalized'
    | 'static-paper-background'
    | 'transparent-semantic-element-pre-text'
    | 'transparent-semantic-element'
    | 'final-composite-review-raster';
  readonly has_alpha: boolean;
};

export type IanLayeredScenePackage = {
  readonly contract_version: 'ian-knowledge-video-layered-scene-v2';
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
  readonly master_generation: {
    readonly contract_version: 'ian-gpt-image-2-text-free-master-v1';
    readonly generator: 'codex-native-imagegen';
    readonly model_id: 'gpt-image-2';
    readonly prompt: {readonly path: string; readonly checksum_sha256: string};
    readonly reference_inputs: readonly {
      readonly role: 'visual_style_reference_only';
      readonly path: '.agents/skills/ian-handdrawn-ppt/assets/reference-handdrawn-article-illustration-style.png';
      readonly checksum_sha256: string;
    }[];
    readonly selection_status: 'selected';
    readonly visible_text_mode: 'none';
    readonly source_master: IanRasterBinding;
    readonly visual_qa: {
      readonly result: 'pass';
      readonly inspection: 'human-original-resolution-v1';
      readonly observed_visible_text: readonly [];
      readonly observed_pseudo_text: false;
    };
  };
  readonly model_provenance: {
    readonly contract_version: 'codex-native-imagegen-gpt-image-2-provenance-v1';
    readonly generator: 'codex-native-imagegen';
    readonly canonical_model: 'gpt-image-2';
    readonly evidence_kind: 'embedded-c2pa-software-agent-observation-v1';
    readonly source_master_checksum_sha256: string;
    readonly expected_software_agent: {readonly name: 'gpt-image'; readonly version: '2.0'};
  };
  readonly normalized_master: IanRasterBinding;
  readonly split_spec: {
    readonly contract_version: 'ian-semantic-region-alpha-split-v1';
    readonly normalization: {
      readonly fit: 'cover';
      readonly position: 'centre';
      readonly kernel: 'lanczos3';
      readonly stretch: false;
      readonly padding: false;
    };
    readonly matte_rgb: readonly [number, number, number];
    readonly alpha_distance_low: number;
    readonly alpha_distance_high: number;
    readonly blur_sigma_px: number;
    readonly paper_background_rgba: readonly [number, number, number, 255];
    readonly minimum_inter_layer_gutter_px: number;
    readonly outside_union_max_visible_pixels: 1024;
    readonly layers: readonly {
      readonly layer_id: string;
      readonly bbox: {readonly x: number; readonly y: number; readonly width: number; readonly height: number};
    }[];
  };
  readonly background: IanRasterBinding;
  readonly pre_text_layers: readonly (IanLayerPlan & IanRasterBinding)[];
  readonly text_overlay: {
    readonly contract_version: 'ian-deterministic-layer-text-overlay-v1';
    readonly mode: 'none' | 'required';
    readonly font: null | {
      readonly path: string;
      readonly checksum_sha256: string;
      readonly font_family: string;
    };
    readonly minimum_inset_px: 8;
    readonly labels: readonly {
      readonly layer_id: string;
      readonly text: string;
      readonly lines: readonly string[];
      readonly container_bbox: {
        readonly x: number;
        readonly y: number;
        readonly width: number;
        readonly height: number;
      };
      readonly font_size: number;
      readonly font_weight: number;
      readonly letter_spacing: number;
      readonly fill: string;
      readonly background: null | Record<string, string | number>;
    }[];
  };
  readonly layers: readonly (IanLayerPlan & IanRasterBinding)[];
  readonly final_composite: IanRasterBinding;
  readonly verified_visible_text: readonly string[];
};

export const IAN_LAYERED_SCENE_PLAN_VERSION: 'ian-layered-scene-plan-v1';
export const IAN_LAYERED_SCENE_PACKAGE_VERSION: 'ian-knowledge-video-layered-scene-v2';
export const IAN_LAYERED_SCENE_LEGACY_PACKAGE_VERSION: 'ian-knowledge-video-layered-scene-v1';
export const IAN_LAYERED_SCENE_RENDERER_VERSION: 'ian-static-layered-scene-v1';
export const IAN_LAYER_ENTRY_TRANSITION_VERSION: 'ian-layer-entry-fade-v1';
export const IAN_LAYER_ENTRY_DURATION_FRAMES: 8;
export const IAN_MASTER_GENERATION_VERSION: 'ian-gpt-image-2-text-free-master-v1';
export const IAN_MODEL_PROVENANCE_VERSION: 'codex-native-imagegen-gpt-image-2-provenance-v1';
export const IAN_SEMANTIC_SPLIT_VERSION: 'ian-semantic-region-alpha-split-v1';
export const IAN_TEXT_OVERLAY_VERSION: 'ian-deterministic-layer-text-overlay-v1';
export const IAN_CANONICAL_STYLE_ANCHOR_PATH: '.agents/skills/ian-handdrawn-ppt/assets/reference-handdrawn-article-illustration-style.png';
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
export function validateLegacyIanLayeredScenePackageV1(
  manifest: Record<string, unknown>,
  expected?: Record<string, unknown>,
): Record<string, unknown>;
export function observeGptImage2SoftwareAgent(bytes: Buffer): {
  contract_version: 'embedded-c2pa-software-agent-observation-v1';
  evidence_kind: 'observation-not-signature-verification';
  software_agent_name: 'gpt-image';
  software_agent_version: '2.0';
};
export function deriveIanLayeredSceneV2Bytes(input: {
  sourceMasterBytes: Buffer;
  splitSpec: IanLayeredScenePackage['split_spec'];
  textOverlay: IanLayeredScenePackage['text_overlay'];
  scenePlan: IanLayeredScenePlan;
}): Promise<{
  normalizedMaster: Buffer;
  background: Buffer;
  preTextLayers: Buffer[];
  layers: Buffer[];
  finalComposite: Buffer;
  outsideUnionVisiblePixels: number;
  glyphMeasurements: unknown[];
}>;
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
  contract_version: 'ian-knowledge-video-layered-scene-v2';
  result: 'pass';
  package: IanLayeredScenePackage;
  member_count: number;
  model_provenance_observation: Record<string, string>;
  deterministic_master_normalization_match: true;
  deterministic_semantic_split_match: true;
  deterministic_text_overlay_match: true;
  deterministic_composite_match: true;
}>;
export function inspectLegacyIanLayeredScenePackageV1(
  manifest: Record<string, unknown>,
  expected: {repositoryRoot: string; episodeWorkspace: string; [key: string]: unknown},
): Promise<Record<string, unknown>>;
