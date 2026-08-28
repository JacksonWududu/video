import {Audio, Sequence, staticFile} from 'remotion';

import type {CurrentKnowledgeVideoAssemblyPlan} from './types';

type SoundEffectTrackPlan = CurrentKnowledgeVideoAssemblyPlan['sound_effects'];

const validateTrack = (soundEffects: SoundEffectTrackPlan, durationInFrames: number) => {
  if (!['knowledge-video-sound-effect-track-v1', 'knowledge-video-sound-effect-track-v2']
        .includes(soundEffects.contract_version)
      || (soundEffects.contract_version === 'knowledge-video-sound-effect-track-v1'
        && soundEffects.resume_mode !== 'revoice_variant')
      || (soundEffects.contract_version === 'knowledge-video-sound-effect-track-v2'
        && (!['standard', 'revoice_variant'].includes(soundEffects.resume_mode)
          || soundEffects.policy == null
          || soundEffects.audio_preflight_policy !== 'required-before-first-full-render-v1'))
      || soundEffects.narration_gain !== 1
      || soundEffects.normalization !== 'disabled'
      || soundEffects.peak_ceiling_dbfs !== -1
      || soundEffects.overflow_action !== 'lower-sfx-bus-uniformly'
      || typeof soundEffects.bus_gain_multiplier !== 'number'
      || !Number.isFinite(soundEffects.bus_gain_multiplier)
      || soundEffects.bus_gain_multiplier <= 0) {
    throw new Error('SoundEffectTrack requires a valid unified SFX bus contract');
  }
  const ids = new Set<string>();
  for (const cue of soundEffects.cues) {
    if (ids.has(cue.event_id)
        || (soundEffects.contract_version === 'knowledge-video-sound-effect-track-v2'
          && (typeof cue.cue_group_id !== 'string' || cue.cue_group_id === ''
            || cue.primary_render_event_id !== cue.event_id
            || !Array.isArray(cue.covered_event_ids)
            || !cue.covered_event_ids.includes(cue.event_id)
            || !Number.isInteger(cue.sync_frame)
            || cue.sync_frame! < cue.cue_frame))
        || !Number.isInteger(cue.cue_frame) || cue.cue_frame < 0
        || !Number.isInteger(cue.derived_asset.duration_in_frames)
        || cue.derived_asset.duration_in_frames < 1
        || cue.cue_frame + cue.derived_asset.duration_in_frames > durationInFrames
        || cue.derived_asset.sample_rate_hz !== 44100
        || cue.derived_asset.channels !== 2
        || cue.derived_asset.format !== 'wav'
        || !Number.isInteger(cue.derived_asset.source_sample_rate_hz)
        || cue.derived_asset.source_sample_rate_hz < 1
        || cue.derived_asset.runtime_transform !== 'forbidden'
        || !cue.derived_asset.asset.endsWith('.wav')
        || cue.gain_multiplier <= 0 || cue.gain_multiplier > 1) {
      throw new Error(`SoundEffectTrack cue is invalid: ${cue.event_id}`);
    }
    ids.add(cue.event_id);
  }
  return soundEffects.cues.filter(
    ({render_owner: renderOwner}) => renderOwner === 'global_sound_effect_track_v1',
  );
};

export const SoundEffectTrack: React.FC<{
  readonly soundEffects: SoundEffectTrackPlan;
  readonly durationInFrames: number;
}> = ({soundEffects, durationInFrames}) => validateTrack(soundEffects, durationInFrames).map((cue) => (
  <Sequence
    key={cue.cue_group_id ?? cue.event_id}
    from={cue.cue_frame}
    durationInFrames={cue.derived_asset.duration_in_frames}
    name={`SFX ${cue.semantic_role}`}
    premountFor={1}
  >
    <Audio
      src={staticFile(cue.derived_asset.asset)}
      volume={cue.gain_multiplier * soundEffects.bus_gain_multiplier}
    />
  </Sequence>
));
