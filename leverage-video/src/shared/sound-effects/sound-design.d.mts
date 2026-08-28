export const KNOWLEDGE_VIDEO_SOUND_DESIGN_VERSION: 'knowledge-video-sound-design-v1';
export const GLOBAL_SOUND_EFFECT_RENDER_OWNER: 'global_sound_effect_track_v1';
export const IAN_SOUND_EFFECT_RENDER_OWNER: 'ian_layered_scene';

export type SoundDesignBinding = {readonly path: string; readonly checksum_sha256: string};

export type KnowledgeVideoSoundDesignEvent = {
  readonly event_id: string;
  readonly shot_id: string;
  readonly anchor_kind: string;
  readonly cue_frame: number;
  readonly candidate_source: 'mechanical' | 'semantic';
  readonly decision: 'audible' | 'silent';
  readonly reason: string;
  readonly semantic_role: string | null;
  readonly intensity: 'micro' | 'strong' | null;
  readonly render_owner: 'global_sound_effect_track_v1' | 'ian_layered_scene' | null;
  readonly gain_multiplier: number | null;
  readonly source: null | {
    readonly asset_id: string;
    readonly path: string;
    readonly checksum_sha256: string;
    readonly provider: 'Mixkit' | 'Pixabay';
    readonly source_item_url: string;
    readonly license_url: string;
  };
  readonly derived_asset: null | {
    readonly path: string;
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
  readonly qa_result: 'pass' | null;
};

export function deriveSoundDesignCandidateEvents(shots: readonly unknown[]): readonly {
  readonly event_id: string;
  readonly shot_id: string;
  readonly anchor_kind: string;
  readonly cue_frame: number;
  readonly candidate_source: 'mechanical';
}[];

export function buildSoundDesignMapSha256(value: unknown): string;

export function validateKnowledgeVideoSoundDesign(value: unknown, options: {
  shots: readonly unknown[];
  durationFrames: number;
  episodeWorkspace: string;
  repositoryRoot: string;
  libraryValidation: unknown;
  expectedBindings?: Record<string, SoundDesignBinding> | null;
  verifyFiles?: boolean;
  revoiceVariant?: boolean;
  parentDesign?: null | {binding: SoundDesignBinding; value: unknown};
}): {
  contract_version: 'knowledge-video-sound-design-validation-v1';
  result: 'pass';
  resume_mode: 'standard' | 'revoice_variant';
  bindings: Record<string, SoundDesignBinding>;
  event_map_sha256: string;
  bus_gain_multiplier: number;
  events: readonly KnowledgeVideoSoundDesignEvent[];
  audible_cues: readonly KnowledgeVideoSoundDesignEvent[];
};

export function loadAndValidateKnowledgeVideoSoundDesign(options: {
  repositoryRoot: string;
  episodeWorkspace: string;
  binding: SoundDesignBinding;
  shots: readonly unknown[];
  durationFrames: number;
  expectedBindings: Record<string, SoundDesignBinding>;
  revoiceVariant?: boolean;
}): {
  path: string;
  checksum_sha256: string;
  value: unknown;
  validation: ReturnType<typeof validateKnowledgeVideoSoundDesign>;
};

export function retimeKnowledgeVideoSoundDesignForRevoice(options: {
  parentBinding: SoundDesignBinding | null;
  parentValue: any | null;
  shots: readonly unknown[];
  durationFrames: number;
  episodeWorkspace: string;
  bindings: Record<string, SoundDesignBinding>;
  semanticCueFramesByEventId?: Record<string, number>;
  repositoryRoot: string;
  libraryValidation: unknown;
  verifyFiles?: boolean;
  legacySoundlessParentEvidence?: null | {
    contract_version: 'legacy-soundless-parent-evidence-v1';
    delivery_manifest: SoundDesignBinding;
    sound_effect_cue_count: 0;
    sound_effect_track_present: false;
  };
}): any;
