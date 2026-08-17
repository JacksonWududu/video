import {AbsoluteFill, Sequence} from 'remotion';

import {TransitionedScene} from '../scene-transitions';
import {DoodleScene} from './DoodleScene';
import {EpisodeOpening} from './EpisodeOpening';
import {GraphicScene} from './GraphicScene';
import {NarrationTrack} from './NarrationTrack';
import {NarrativeScene} from './NarrativeScene';
import {WhiteboardScene} from './WhiteboardScene';
import type {KnowledgeVideoAssemblyPlan} from './types';

export const KnowledgeVideo: React.FC<{
  readonly plan: KnowledgeVideoAssemblyPlan;
}> = ({plan}) => {
  if (plan.schema_version !== 'knowledge-video-assembly-plan-v1') {
    throw new Error('Unsupported knowledge-video assembly plan');
  }
  if (plan.scenes.some((scene) => scene.visual_generation_route === 'comic-imagegen')) {
    throw new Error('comic-imagegen is historical read-only and cannot create a preview or render');
  }
  return (
    <AbsoluteFill style={{backgroundColor: '#f5efe2'}}>
      <Sequence from={0} durationInFrames={plan.opening.first_sentence_end_frame} name="OPEN-00">
        <EpisodeOpening coverAsset={plan.opening.cover_asset} />
      </Sequence>
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
          {scene.scene_type === 'whiteboard' ? (
            <WhiteboardScene
              whiteboard={scene.whiteboard!}
              durationInFrames={scene.duration_frames}
              visualGenerationRoute={scene.visual_generation_route}
            />
          ) : scene.scene_type === 'graphic' ? (
            <GraphicScene
              imageSequence={scene.image_sequence}
              durationInFrames={scene.duration_frames}
              visualGenerationRoute={scene.visual_generation_route}
            />
          ) : scene.scene_type === 'doodle' ? (
            <DoodleScene
              imageSequence={scene.image_sequence}
              durationInFrames={scene.duration_frames}
              visualGenerationRoute={scene.visual_generation_route}
            />
          ) : (
            <NarrativeScene imageSequence={scene.image_sequence} shotId={scene.shot_id} />
          )}
        </TransitionedScene>
      ))}
      <NarrationTrack asset={plan.narration_asset} durationInFrames={plan.narration_frames} from={0} />
    </AbsoluteFill>
  );
};
