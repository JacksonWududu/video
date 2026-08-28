import {AbsoluteFill, Audio, Composition, staticFile, useCurrentFrame} from 'remotion';

import {SoundEffectTrack} from '../../video-scenes/SoundEffectTrack';
import type {CurrentKnowledgeVideoAssemblyPlan} from '../../video-scenes/types';

export const PROOF_CUE_FRAME = 30;
export const PROOF_DURATION_FRAMES = 70;
export const PROOF_BUS_GAIN = 0.25;

const soundEffects = {
  contract_version: 'knowledge-video-sound-effect-track-v1',
  design: {
    path: 'schema/render-proof-sound-design.json',
    checksum_sha256: '0000000000000000000000000000000000000000000000000000000000000000',
    event_map_sha256: '1111111111111111111111111111111111111111111111111111111111111111',
  },
  library: {
    path: 'leverage-video/src/shared/sound-effects/manifest-v3.json',
    checksum_sha256: 'f3ad47ac039682c9482c9984c3e02c158b629c25b21915f325ecc0e20bfa60d4',
  },
  narration_gain: 1,
  normalization: 'disabled',
  peak_ceiling_dbfs: -1,
  overflow_action: 'lower-sfx-bus-uniformly',
  bus_gain_multiplier: PROOF_BUS_GAIN,
  cues: [{
    event_id: 'S01:semantic:paper-card-entrance',
    shot_id: 'S01',
    cue_frame: PROOF_CUE_FRAME,
    semantic_role: 'paper_card_entrance',
    intensity: 'micro',
    render_owner: 'global_sound_effect_track_v1',
    gain_multiplier: 1,
    derived_asset: {
      asset: 'proof-sfx.wav',
      checksum_sha256: '2222222222222222222222222222222222222222222222222222222222222222',
      sample_rate_hz: 44100,
      channels: 2,
      format: 'wav',
      source_sample_rate_hz: 44100,
      trim_start_sample: 0,
      trim_end_sample: 48263,
      duration_in_frames: 33,
      runtime_transform: 'forbidden',
    },
  }],
} satisfies CurrentKnowledgeVideoAssemblyPlan['sound_effects'];

const Proof: React.FC<{readonly withSoundEffects: boolean}> = ({withSoundEffects}) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{
      alignItems: 'center',
      backgroundColor: frame < PROOF_CUE_FRAME ? '#16202a' : '#315b4a',
      color: '#f7f0dc',
      display: 'flex',
      fontFamily: 'sans-serif',
      fontSize: 42,
      justifyContent: 'center',
    }}>
      <div>{frame < PROOF_CUE_FRAME ? '旁白：1.0' : 'SFX cue：frame 30'}</div>
      <Audio src={staticFile('proof-narration.wav')} volume={1} />
      {withSoundEffects ? (
        <SoundEffectTrack
          soundEffects={soundEffects}
          durationInFrames={PROOF_DURATION_FRAMES}
        />
      ) : null}
    </AbsoluteFill>
  );
};

const MixedProof = () => <Proof withSoundEffects />;
const NarrationBaseline = () => <Proof withSoundEffects={false} />;

export const SoundEffectProofRoot: React.FC = () => (
  <>
    <Composition
      id="KnowledgeVideoSoundProof"
      component={MixedProof}
      durationInFrames={PROOF_DURATION_FRAMES}
      fps={30}
      width={640}
      height={360}
    />
    <Composition
      id="KnowledgeVideoNarrationBaseline"
      component={NarrationBaseline}
      durationInFrames={PROOF_DURATION_FRAMES}
      fps={30}
      width={640}
      height={360}
    />
  </>
);
