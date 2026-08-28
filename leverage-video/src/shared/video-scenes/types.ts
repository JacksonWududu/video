import type {SceneTransitionContract} from '../scene-transitions';
import type {IntraShotTransitionV1} from '../intra-shot-transitions';
import type {IntraShotWatercolorTransition} from '../watercolor-bloom/contract.mjs';
import type {IanLayeredEntryEffectsPlan} from '../ian-layered-entry-effects/contract.mjs';
export type MotionTier = 'layered' | 'stateful' | 'hero_pose';

type IanLayeredSceneLayerBinding = {
  readonly layer_id: string;
  readonly z_index: number;
  readonly semantic_role: string;
  readonly source_text_start_byte: number;
  readonly source_text_end_byte_exclusive: number;
  readonly source_text: string;
  readonly entry_frame: number;
  readonly asset: string;
  readonly checksum_sha256: string;
};

type IanLayeredSceneCommonBinding = {
  readonly package_contract_version: 'ian-knowledge-video-layered-scene-v2';
  readonly package_manifest: {readonly path: string; readonly checksum_sha256: string};
  readonly scene_plan_sha256: string;
  readonly storyboard_scene_plan_sha256: string;
  readonly background: {readonly asset: string; readonly checksum_sha256: string};
  readonly layers: readonly IanLayeredSceneLayerBinding[];
  readonly final_composite: {readonly asset: string; readonly checksum_sha256: string};
};

export type LegacyIanLayeredSceneBinding = IanLayeredSceneCommonBinding & {
  readonly contract_version: 'ian-static-layered-scene-v1';
  readonly layer_entry_transition: {
    readonly contract_version: 'ian-layer-entry-fade-v1';
    readonly duration_frames: 8;
    readonly easing: 'linear';
  };
  readonly motion_policy: {
    readonly scene_transform: 'forbidden';
    readonly layer_transform: 'forbidden';
    readonly mask_reveal: 'forbidden';
    readonly internal_cut: 'forbidden';
    readonly opacity_animation: 'ian-layer-entry-fade-v1';
  };
};

export type AnimatedIanLayeredSceneBinding = IanLayeredSceneCommonBinding & {
  readonly contract_version: 'ian-layered-entry-effects-renderer-v2';
  readonly entry_effects: IanLayeredEntryEffectsPlan;
};

export type IanLayeredSceneBinding =
  | LegacyIanLayeredSceneBinding
  | AnimatedIanLayeredSceneBinding;

export type LegacyIntraShotWatercolorTransition = IntraShotWatercolorTransition & {
  readonly from_asset_id: string;
  readonly to_asset_id: string;
  readonly at_frame: number;
};

export type VisualGenerationRoute =
  | 'imagegen'
  | 'xuan-paper-diorama'
  | 'comic-imagegen'
  | 'ian-handdrawn-ppt'
  | 'ink-doodle-knowledge-card'
  | 'doodle-slides'
  | 'srt-whiteboard-animation'
  | 'local-video-file';

export type ImageOccurrence = {
  readonly asset_id: string;
  readonly asset: string;
  readonly checksum_sha256?: string | null;
  readonly from: number;
  readonly duration_in_frames: number;
  readonly visual_generation_route: VisualGenerationRoute;
  readonly generator?: 'codex-native-imagegen';
  readonly review_status?: 'approved';
  readonly width?: 1920;
  readonly height?: 1080;
  readonly prompt_asset?: string;
  readonly prompt_checksum_sha256?: string;
  readonly reference_checksums_sha256?: readonly string[];
  readonly style_profile_id?: 'xuan-paper-diorama' | 'ink-doodle-knowledge-card';
  readonly style_profile_checksum_sha256?: string;
  readonly style_skill_checksum_sha256?: string;
};

export type ComicCharacterReferenceReview = {
  readonly contract_version: 'comic-character-reference-review-v1';
  readonly status: 'approved';
  readonly reference_asset: string;
  readonly reference_checksum_sha256: string;
  readonly reference_role: string;
  readonly existing_reference: boolean;
  readonly identity_preserved: true;
  readonly redesign_forbidden: true;
};

export type ComicShotPlan = {
  readonly contract_version: 'comic-shot-plan-v1';
  readonly panel_count: 1 | 2 | 3;
  readonly panel_beats: readonly {
    readonly panel_index: number;
    readonly purpose: string;
    readonly visual_action: string;
  }[];
  readonly layout: 'standard' | 'cinematic' | 'mixed' | 'splash';
  readonly character_continuity_group_id: string | null;
  readonly character_continuity_group_size: number;
  readonly treatment_profile_id:
    | 'comic-ligne-claire-neutral'
    | 'comic-manga-warm'
    | 'comic-ink-brush-dramatic'
    | 'comic-chalk-explainer'
    | 'comic-minimalist-spot-color';
  readonly visible_text_mode: 'none';
  readonly requires_panel_order_contract: boolean;
  readonly character_reference_review: ComicCharacterReferenceReview | null;
};

export type WhiteboardTimingSegment = {
  readonly source_start_frame: number;
  readonly source_end_frame: number;
  readonly output_start_frame: number;
  readonly output_end_frame: number;
  readonly playback_rate: number;
  readonly element_ids: readonly string[];
  readonly subtitle_span: {readonly start: number; readonly end: number; readonly text: string};
};

export type WhiteboardAssetReference = {
  readonly asset: string;
  readonly checksum_sha256: string;
};

export type WhiteboardSceneBinding = {
  readonly contract_version: 'whiteboard-scene-v1';
  readonly source_image: WhiteboardAssetReference;
  readonly normalized_image: WhiteboardAssetReference;
  readonly annotation: WhiteboardAssetReference;
  readonly preview: WhiteboardAssetReference;
  readonly clip: WhiteboardAssetReference;
  readonly render_evidence: WhiteboardAssetReference;
  readonly source_duration_frames: number;
  readonly retiming_mode: 'identity-v1' | 'piecewise-element-span-v1';
  readonly timing_segments: readonly WhiteboardTimingSegment[];
  readonly visual_sequence_lock: {
    readonly contract_version: 'whiteboard-visual-sequence-lock-v1';
    readonly source_image_sha256: string;
    readonly normalized_image_sha256: string;
    readonly annotation_sha256: string;
    readonly preview_sha256: string;
    readonly clip_sha256: string;
    readonly render_evidence_sha256: string;
    readonly element_order: readonly string[];
    readonly element_order_checksum_sha256: string;
  };
};

export type LocalVideoSceneBinding = {
  readonly contract_version: 'local-video-match-v1';
  readonly visual_generation_route: 'local-video-file';
  readonly shot_id: string;
  readonly selected_source_path: string;
  readonly asset: string;
  readonly checksum_sha256: string;
  readonly media: {
    readonly video_streams: 1;
    readonly audio_streams: number;
    readonly width: 1920;
    readonly height: 1080;
    readonly codec: 'h264';
    readonly rotation_degrees: 0;
    readonly source_duration_seconds: number;
    readonly source_fps: number;
    readonly probe_result: 'pass';
    readonly full_decode_result: 'pass';
  };
  readonly target_duration_frames: number;
  readonly target_duration_seconds: number;
  readonly playback_rate: number;
  readonly match_status: 'matched';
  readonly frame_mapping_policy: 'complete-source-to-exact-shot-frames-v1';
  readonly fit_policy: 'native-1920x1080-no-resize-crop-or-pad-v1';
  readonly audio_policy: 'mute-source-audio-v1';
  readonly approval: {
    readonly status: 'approved';
    readonly approved_checksum_sha256: string;
    readonly exact_message: string;
    readonly decided_at: string;
  };
};

export type LegacyNarrativeImageOccurrence = Omit<ImageOccurrence, 'visual_generation_route'> & {
  readonly visual_generation_route: null;
};

export type RenderableImageOccurrence = ImageOccurrence | LegacyNarrativeImageOccurrence;

export type CurrentKnowledgeVideoScene = {
  readonly shot_id: string;
  readonly start_frame: number;
  readonly end_frame: number;
  readonly duration_frames: number;
  readonly scene_type: 'narrative' | 'comic' | 'graphic' | 'ian-layered' | 'doodle' | 'whiteboard' | 'local-video';
  readonly scene_class: 'narrative_illustration' | 'structured_graphic';
  readonly structured_visual_kind: string | null;
  readonly visual_structure_id: string | null;
  readonly treatment_profile_id: string | null;
  readonly comic_plan: ComicShotPlan | null;
  readonly white_cat_present: boolean;
  readonly visual_generation_route: VisualGenerationRoute;
  readonly ian_layered_scene?: IanLayeredSceneBinding | null;
  readonly motion_tier?: MotionTier | null;
  readonly image_sequence: readonly ImageOccurrence[];
  readonly hero_pose_background?: null | {
    readonly asset_id: string;
    readonly asset: string;
    readonly checksum_sha256: string;
    readonly visual_generation_route: VisualGenerationRoute;
  };
  readonly intra_shot_transition_contract?:
    | 'intra-shot-transition-v1'
    | 'intra-shot-watercolor-bloom-v1';
  readonly intra_shot_transitions: readonly (
    | IntraShotTransitionV1
    | LegacyIntraShotWatercolorTransition
  )[];
  readonly whiteboard: WhiteboardSceneBinding | null;
  readonly local_video: LocalVideoSceneBinding | null;
  readonly transition: SceneTransitionContract | null;
};

export type LegacyNarrativeScene = {
  readonly shot_id: string;
  readonly start_frame: number;
  readonly end_frame: number;
  readonly duration_frames: number;
  readonly scene_type: 'narrative';
  readonly visual_generation_route: null;
  readonly image_sequence: readonly LegacyNarrativeImageOccurrence[];
  readonly intra_shot_transition_contract?: 'intra-shot-watercolor-bloom-v1';
  readonly intra_shot_transitions: readonly LegacyIntraShotWatercolorTransition[];
  readonly transition: SceneTransitionContract | null;
};

export type KnowledgeVideoScene = CurrentKnowledgeVideoScene | LegacyNarrativeScene;

export type KnowledgeVideoSoundEffectCue = {
  readonly event_id: string;
  readonly shot_id: string;
  readonly cue_frame: number;
  readonly sync_frame?: number;
  readonly cue_group_id?: string;
  readonly primary_render_event_id?: string;
  readonly covered_event_ids?: readonly string[];
  readonly semantic_role: string;
  readonly intensity: 'micro' | 'standard' | 'strong';
  readonly render_owner: 'global_sound_effect_track_v1' | 'ian_layered_scene';
  readonly gain_multiplier: number;
  readonly derived_asset: {
    readonly asset: string;
    readonly checksum_sha256: string;
    readonly sample_rate_hz: 44100;
    readonly channels: 2;
    readonly format: 'wav';
    readonly source_sample_rate_hz: number;
    readonly trim_start_sample: number;
    readonly trim_end_sample: number;
    readonly duration_in_frames: number;
    readonly runtime_transform: 'forbidden';
  };
};

type KnowledgeVideoAssemblyPlanCommon = {
  readonly full_master_frames: number;
  readonly narration_frames: number;
  readonly narration_asset: string;
  readonly timeline: {
    readonly contract_version: 'direct-first-shot-v1';
    readonly fixed_opening_cover: false;
    readonly first_shot_id: 'S01';
    readonly first_shot_start_frame: 0;
    readonly first_sentence_end_frame: number;
    readonly narration_start_frame: 0;
    readonly narration_master_frames: number;
    readonly final_master_frames: number;
    readonly legacy_first_shot_lead_in_frames: number;
    readonly publishing_cover_timeline_consumed: false;
  };
  readonly scenes: readonly KnowledgeVideoScene[];
};

export type HistoricalKnowledgeVideoAssemblyPlan = {
  readonly schema_version: 'knowledge-video-assembly-plan-v1';
  readonly full_master_frames: number;
  readonly narration_frames: number;
  readonly narration_asset: string;
  readonly opening: Readonly<Record<string, unknown>>;
  readonly scenes: readonly unknown[];
};

export type LegacyKnowledgeVideoAssemblyPlan = KnowledgeVideoAssemblyPlanCommon & {
  readonly schema_version: 'knowledge-video-assembly-plan-v2';
  readonly sound_effects?: never;
};

type KnowledgeVideoSoundEffectTrackCommon = {
    readonly design: {
      readonly path: string;
      readonly checksum_sha256: string;
      readonly event_map_sha256: string;
    };
    readonly library: {readonly path: string; readonly checksum_sha256: string};
    readonly narration_gain: 1;
    readonly normalization: 'disabled';
    readonly peak_ceiling_dbfs: -1;
    readonly overflow_action: 'lower-sfx-bus-uniformly';
    readonly bus_gain_multiplier: number;
    readonly cues: readonly KnowledgeVideoSoundEffectCue[];
};

export type KnowledgeVideoSoundEffectTrack = KnowledgeVideoSoundEffectTrackCommon & (
  | {
    readonly contract_version: 'knowledge-video-sound-effect-track-v1';
    readonly resume_mode?: 'revoice_variant';
    readonly policy?: null;
    readonly audio_preflight_policy?: 'required-before-first-full-render-v1';
  }
  | {
    readonly contract_version: 'knowledge-video-sound-effect-track-v2';
    readonly resume_mode: 'standard' | 'revoice_variant';
    readonly policy: {readonly path: string; readonly checksum_sha256: string};
    readonly audio_preflight_policy: 'required-before-first-full-render-v1';
  }
);

export type CurrentKnowledgeVideoAssemblyPlan = KnowledgeVideoAssemblyPlanCommon & {
  readonly schema_version: 'knowledge-video-assembly-plan-v3';
  readonly sound_effects: KnowledgeVideoSoundEffectTrack;
};

export type KnowledgeVideoAssemblyPlan =
  | HistoricalKnowledgeVideoAssemblyPlan
  | LegacyKnowledgeVideoAssemblyPlan
  | CurrentKnowledgeVideoAssemblyPlan;
