import {AbsoluteFill} from 'remotion';

import {TransitionedScene} from '../scene-transitions';
import {DoodleScene} from './DoodleScene';
import {GraphicScene} from './GraphicScene';
import {IanLayeredScene} from './IanLayeredScene';
import {NarrationTrack} from './NarrationTrack';
import {NarrativeScene} from './NarrativeScene';
import {LocalVideoScene} from './LocalVideoScene';
import {SoundEffectTrack} from './SoundEffectTrack';
import {WhiteboardScene} from './WhiteboardScene';
import type {KnowledgeVideoAssemblyPlan} from './types';

export const KnowledgeVideo: React.FC<{
  readonly plan: KnowledgeVideoAssemblyPlan;
}> = ({plan}) => {
  if (plan.schema_version === 'knowledge-video-assembly-plan-v1') {
    throw new Error('Historical v1 assembly plans are read-only and cannot create a preview or render');
  }
  if (plan.timeline.contract_version !== 'direct-first-shot-v1'
    || plan.timeline.fixed_opening_cover !== false
    || plan.timeline.first_shot_start_frame !== 0
    || plan.scenes[0]?.shot_id !== 'S01'
    || plan.scenes[0]?.start_frame !== 0) {
    throw new Error('Unsupported knowledge-video assembly plan');
  }
  if (plan.scenes.some((scene) => scene.visual_generation_route === 'comic-imagegen')) {
    throw new Error('comic-imagegen is historical read-only and cannot create a preview or render');
  }
  if (plan.schema_version === 'knowledge-video-assembly-plan-v3'
      && plan.sound_effects.contract_version !== 'knowledge-video-sound-effect-track-v1') {
    throw new Error('Current knowledge-video assembly requires sound effects');
  }
  const soundEffectBusGain = plan.schema_version === 'knowledge-video-assembly-plan-v3'
    ? plan.sound_effects.bus_gain_multiplier
    : 1;
  return (
    <AbsoluteFill style={{backgroundColor: '#f5efe2'}}>
      {plan.scenes.map((scene, sceneIndex) => (
        <TransitionedScene
          key={scene.shot_id}
          from={scene.start_frame}
          durationInFrames={scene.duration_frames}
          transition={scene.transition}
          isTerminal={sceneIndex === plan.scenes.length - 1}
          zIndex={plan.scenes.length - sceneIndex}
          name={scene.shot_id}
        >
          {scene.scene_type === 'local-video' ? (
            <LocalVideoScene
              localVideo={scene.local_video!}
              durationInFrames={scene.duration_frames}
              visualGenerationRoute={scene.visual_generation_route}
            />
          ) : scene.scene_type === 'whiteboard' ? (
            <WhiteboardScene
              whiteboard={scene.whiteboard!}
              durationInFrames={scene.duration_frames}
              visualGenerationRoute={scene.visual_generation_route}
            />
          ) : scene.scene_type === 'ian-layered' ? (
            <IanLayeredScene
              scene={scene.ian_layered_scene!}
              durationInFrames={scene.duration_frames}
              visualGenerationRoute={scene.visual_generation_route}
              soundEffectBusGain={soundEffectBusGain}
            />
          ) : scene.scene_type === 'graphic' ? (
            <GraphicScene
              imageSequence={scene.image_sequence}
              intraShotTransitionContract={scene.intra_shot_transition_contract ?? 'intra-shot-watercolor-bloom-v1'}
              intraShotTransitions={scene.intra_shot_transitions}
              durationInFrames={scene.duration_frames}
              visualGenerationRoute={scene.visual_generation_route}
            />
          ) : scene.scene_type === 'doodle' ? (
            <DoodleScene
              imageSequence={scene.image_sequence}
              intraShotTransitionContract={scene.intra_shot_transition_contract ?? 'intra-shot-watercolor-bloom-v1'}
              intraShotTransitions={scene.intra_shot_transitions}
              durationInFrames={scene.duration_frames}
              visualGenerationRoute={scene.visual_generation_route}
            />
          ) : (
            <NarrativeScene
              imageSequence={scene.image_sequence}
              intraShotTransitionContract={scene.intra_shot_transition_contract ?? 'intra-shot-watercolor-bloom-v1'}
              intraShotTransitions={scene.intra_shot_transitions}
              heroPoseBackground={'hero_pose_background' in scene ? scene.hero_pose_background?.asset : null}
              shotId={scene.shot_id}
            />
          )}
        </TransitionedScene>
      ))}
      {plan.schema_version === 'knowledge-video-assembly-plan-v3' ? (
        <SoundEffectTrack
          soundEffects={plan.sound_effects}
          durationInFrames={plan.full_master_frames}
        />
      ) : null}
      <NarrationTrack asset={plan.narration_asset} durationInFrames={plan.narration_frames} from={0} />
    </AbsoluteFill>
  );
};
