import {
  AbsoluteFill,
  CanvasImage,
  interpolate,
  staticFile,
  useCurrentFrame,
} from 'remotion';

import {
  IAN_LAYERED_SCENE_RENDERER_VERSION,
  IAN_LAYER_ENTRY_DURATION_FRAMES,
  IAN_LAYER_ENTRY_TRANSITION_VERSION,
} from '../ian-layered-scene/contract.mjs';
import type {IanLayeredSceneBinding} from './types';

const validateBinding = (
  scene: IanLayeredSceneBinding,
  durationInFrames: number,
): IanLayeredSceneBinding => {
  if (scene.contract_version !== IAN_LAYERED_SCENE_RENDERER_VERSION) {
    throw new Error('IanLayeredScene requires ian-static-layered-scene-v1');
  }
  if (!Number.isInteger(durationInFrames) || durationInFrames < 1) {
    throw new Error('IanLayeredScene requires a positive integer duration');
  }
  if (!scene.background.asset || scene.layers.length < 1) {
    throw new Error('IanLayeredScene requires one background and at least one element layer');
  }
  if (scene.layer_entry_transition.contract_version !== IAN_LAYER_ENTRY_TRANSITION_VERSION
    || scene.layer_entry_transition.duration_frames !== IAN_LAYER_ENTRY_DURATION_FRAMES
    || scene.layer_entry_transition.easing !== 'linear') {
    throw new Error('IanLayeredScene requires the fixed layer-entry fade');
  }
  if (scene.motion_policy.scene_transform !== 'forbidden'
    || scene.motion_policy.layer_transform !== 'forbidden'
    || scene.motion_policy.mask_reveal !== 'forbidden'
    || scene.motion_policy.internal_cut !== 'forbidden'
    || scene.motion_policy.opacity_animation !== IAN_LAYER_ENTRY_TRANSITION_VERSION) {
    throw new Error('IanLayeredScene forbids transforms, masks, and internal cuts');
  }
  let sourceEnd = 0;
  let previousEntry = -IAN_LAYER_ENTRY_DURATION_FRAMES;
  scene.layers.forEach((layer, index) => {
    if (layer.layer_id !== `L${String(index + 1).padStart(2, '0')}`
      || layer.z_index !== index + 1
      || layer.source_text_start_byte !== sourceEnd
      || layer.source_text_end_byte_exclusive <= layer.source_text_start_byte
      || (index === 0 && layer.entry_frame !== 0)
      || (index > 0
        && layer.entry_frame < previousEntry + IAN_LAYER_ENTRY_DURATION_FRAMES)
      || layer.entry_frame + IAN_LAYER_ENTRY_DURATION_FRAMES > durationInFrames
      || !layer.asset) {
      throw new Error(`IanLayeredScene layer ${index} is unordered, stale, or out of range`);
    }
    sourceEnd = layer.source_text_end_byte_exclusive;
    previousEntry = layer.entry_frame;
  });
  return scene;
};

export const IanLayeredScene: React.FC<{
  readonly scene: IanLayeredSceneBinding;
  readonly durationInFrames: number;
  readonly visualGenerationRoute: string | null;
}> = ({scene, durationInFrames, visualGenerationRoute}) => {
  if (visualGenerationRoute !== 'ian-handdrawn-ppt') {
    throw new Error('IanLayeredScene only accepts ian-handdrawn-ppt');
  }
  const frame = useCurrentFrame();
  const validated = validateBinding(scene, durationInFrames);

  return (
    <AbsoluteFill style={{backgroundColor: '#f7f1e5'}}>
      <CanvasImage
        src={staticFile(validated.background.asset)}
        width={1920}
        height={1080}
        fit="fill"
        style={{position: 'absolute', inset: 0}}
      />
      {validated.layers.map((layer) => {
        const fadeEnd = layer.entry_frame + IAN_LAYER_ENTRY_DURATION_FRAMES - 1;
        const opacity = frame < layer.entry_frame
          ? 0
          : frame >= fadeEnd
            ? 1
            : interpolate(frame, [layer.entry_frame, fadeEnd], [0, 1], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
              });
        return (
          <CanvasImage
            key={layer.layer_id}
            src={staticFile(layer.asset)}
            width={1920}
            height={1080}
            fit="fill"
            style={{position: 'absolute', inset: 0, opacity}}
          />
        );
      })}
    </AbsoluteFill>
  );
};

