import type {SceneTransitionContract} from '../scene-transitions';

export type VisualGenerationRoute =
  | 'imagegen'
  | 'xuan-paper-diorama'
  | 'comic-imagegen'
  | 'ian-handdrawn-ppt'
  | 'ink-doodle-knowledge-card'
  | 'doodle-slides'
  | 'srt-whiteboard-animation';

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

export type LegacyNarrativeImageOccurrence = Omit<ImageOccurrence, 'visual_generation_route'> & {
  readonly visual_generation_route: null;
};

export type RenderableImageOccurrence = ImageOccurrence | LegacyNarrativeImageOccurrence;

export type CurrentKnowledgeVideoScene = {
  readonly shot_id: string;
  readonly start_frame: number;
  readonly end_frame: number;
  readonly duration_frames: number;
  readonly scene_type: 'narrative' | 'comic' | 'graphic' | 'doodle' | 'whiteboard';
  readonly scene_class: 'narrative_illustration' | 'structured_graphic';
  readonly structured_visual_kind: string | null;
  readonly visual_structure_id: string | null;
  readonly treatment_profile_id: string | null;
  readonly comic_plan: ComicShotPlan | null;
  readonly white_cat_present: boolean;
  readonly visual_generation_route: VisualGenerationRoute;
  readonly image_sequence: readonly ImageOccurrence[];
  readonly whiteboard: WhiteboardSceneBinding | null;
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
  readonly transition: SceneTransitionContract | null;
};

export type KnowledgeVideoScene = CurrentKnowledgeVideoScene | LegacyNarrativeScene;

export type KnowledgeVideoAssemblyPlan = {
  readonly schema_version: 'knowledge-video-assembly-plan-v1';
  readonly full_master_frames: number;
  readonly narration_frames: number;
  readonly narration_asset: string;
  readonly opening: {
    readonly contract_version: 'cover-only-v1';
    readonly shot_id: 'OPEN-00';
    readonly cover_source: '/Users/jackson/Desktop/video-edit/video-resource/cover.png';
    readonly cover_asset: string;
    readonly source_is_regular_file: true;
    readonly source_is_symlink: false;
    readonly source_format: 'png';
    readonly source_decode_result: 'pass';
    readonly source_aspect_ratio_relative_error: number;
    readonly normalized_width: 1920;
    readonly normalized_height: 1080;
    readonly text_overlay: false;
    readonly start_frame: 0;
    readonly first_sentence_end_frame: number;
    readonly episode_opening_frames: number;
    readonly narration_start_frame: 0;
    readonly narration_master_frames: number;
    readonly final_master_frames: number;
  };
  readonly scenes: readonly KnowledgeVideoScene[];
};
