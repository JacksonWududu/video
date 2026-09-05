import {
  AbsoluteFill,
  Audio,
  CanvasImage,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
} from 'remotion';

import {
  IAN_LAYERED_SCENE_RENDERER_VERSION,
  IAN_LAYER_ENTRY_DURATION_FRAMES,
  IAN_LAYER_ENTRY_TRANSITION_VERSION,
} from '../ian-layered-scene/runtime.mjs';
import {
  IAN_FADE_ONLY_VERSION,
  IAN_INK_DRAW_REVEAL_VERSION,
  IAN_LAYERED_ENTRY_RENDERER_VERSION,
  IAN_SOFT_SETTLE_VERSION,
  softSettleOffset,
  validateIanLayeredEntryEffectsRenderPlan,
} from '../ian-layered-entry-effects/runtime.mjs';
import type {IanLayeredSceneBinding} from './types';

const validateBinding = (
  scene: IanLayeredSceneBinding,
  durationInFrames: number,
): IanLayeredSceneBinding => {
  if (![IAN_LAYERED_SCENE_RENDERER_VERSION, IAN_LAYERED_ENTRY_RENDERER_VERSION]
    .includes(scene.contract_version)) {
    throw new Error('IanLayeredScene requires a supported layered renderer contract');
  }
  if (!Number.isInteger(durationInFrames) || durationInFrames < 1) {
    throw new Error('IanLayeredScene requires a positive integer duration');
  }
  if (!scene.background.asset || scene.layers.length < 1) {
    throw new Error('IanLayeredScene requires one background and at least one element layer');
  }
  if (scene.contract_version === IAN_LAYERED_SCENE_RENDERER_VERSION) {
    if (scene.layer_entry_transition.contract_version !== IAN_LAYER_ENTRY_TRANSITION_VERSION
      || scene.layer_entry_transition.duration_frames !== IAN_LAYER_ENTRY_DURATION_FRAMES
      || scene.layer_entry_transition.easing !== 'linear') {
      throw new Error('IanLayeredScene requires the fixed legacy layer-entry fade');
    }
    if (scene.motion_policy.scene_transform !== 'forbidden'
      || scene.motion_policy.layer_transform !== 'forbidden'
      || scene.motion_policy.mask_reveal !== 'forbidden'
      || scene.motion_policy.internal_cut !== 'forbidden'
      || scene.motion_policy.opacity_animation !== IAN_LAYER_ENTRY_TRANSITION_VERSION) {
      throw new Error('legacy IanLayeredScene forbids transforms, masks, and internal cuts');
    }
  } else {
    validateIanLayeredEntryEffectsRenderPlan(scene.entry_effects, {
      shotId: scene.entry_effects.shot_id,
      scenePlanSha256: scene.scene_plan_sha256,
      packageManifest: scene.package_manifest,
      durationFrames: durationInFrames,
      layerEntries: scene.layers.map(({layer_id, entry_frame}) => ({layer_id, entry_frame})),
      libraryManifestSha256: scene.entry_effects.sound_effect_library.checksum_sha256,
    });
  }
  let sourceEnd = 0;
  let previousEntry = -IAN_LAYER_ENTRY_DURATION_FRAMES;
  scene.layers.forEach((layer, index) => {
    if (layer.layer_id !== `L${String(index + 1).padStart(2, '0')}`
      || layer.z_index !== index + 1
      || layer.source_text_start_byte !== sourceEnd
      || layer.source_text_end_byte_exclusive <= layer.source_text_start_byte
      || (index === 0 && layer.entry_frame !== 0)
      || (index > 0 && layer.entry_frame < previousEntry)
      || layer.entry_frame >= durationInFrames
      || !layer.asset) {
      throw new Error(`IanLayeredScene layer ${index} is unordered, stale, or out of range`);
    }
    sourceEnd = layer.source_text_end_byte_exclusive;
    previousEntry = layer.entry_frame;
  });
  return scene;
};

const easeInOut = (value: number): number => value * value * (3 - 2 * value);

const LegacyFadeLayer: React.FC<{
  readonly layer: Extract<IanLayeredSceneBinding, {contract_version: 'ian-static-layered-scene-v1'}>['layers'][number];
  readonly frame: number;
}> = ({layer, frame}) => {
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
      src={staticFile(layer.asset)}
      width={1920}
      height={1080}
      fit="fill"
      style={{position: 'absolute', inset: 0, opacity}}
    />
  );
};

const AnimatedLayer: React.FC<{
  readonly layer: Extract<IanLayeredSceneBinding, {contract_version: 'ian-layered-entry-effects-renderer-v2'}>['layers'][number];
  readonly entry: Extract<IanLayeredSceneBinding, {contract_version: 'ian-layered-entry-effects-renderer-v2'}>['entry_effects']['layers'][number];
  readonly frame: number;
}> = ({layer, entry, frame}) => {
  const localFrame = frame - entry.entry_frame;
  if (entry.effect.contract_version === IAN_INK_DRAW_REVEAL_VERSION) {
    const duration = entry.effect.duration_frames;
    if (localFrame < 0) return null;
    if (localFrame >= duration - 1) {
      return <CanvasImage src={staticFile(layer.asset)} width={1920} height={1080} fit="fill" style={{position: 'absolute', inset: 0}} />;
    }
    const progress = easeInOut(Math.max(0, Math.min(1, localFrame / (duration - 1))));
    const maskId = `ian-entry-${entry.layer_id}`;
    return (
      <svg viewBox="0 0 1920 1080" width="1920" height="1080" style={{position: 'absolute', inset: 0}}>
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse">
            <rect x="0" y="0" width="1920" height="1080" fill="black" />
            {entry.effect.path_spec.paths.map((vectorPath, index) => (
              <path
                key={`${entry.layer_id}-mask-${index}`}
                d={vectorPath.d}
                fill="none"
                stroke="white"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={vectorPath.stroke_width}
                strokeDasharray={vectorPath.length}
                strokeDashoffset={vectorPath.length * (1 - progress)}
              />
            ))}
          </mask>
        </defs>
        <image
          href={staticFile(layer.asset)}
          width="1920"
          height="1080"
          preserveAspectRatio="none"
          mask={`url(#${maskId})`}
        />
      </svg>
    );
  }
  const duration = entry.effect.duration_frames;
  const endFrame = entry.entry_frame + duration - 1;
  const opacity = frame < entry.entry_frame
    ? 0
    : frame >= endFrame
      ? 1
      : interpolate(frame, [entry.entry_frame, endFrame], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
  const offset = entry.effect.contract_version === IAN_SOFT_SETTLE_VERSION
    ? softSettleOffset(localFrame, entry.effect)
    : entry.effect.contract_version === IAN_FADE_ONLY_VERSION
      ? {x: 0, y: 0}
      : {x: 0, y: 0};
  return (
    <CanvasImage
      src={staticFile(layer.asset)}
      width={1920}
      height={1080}
      fit="fill"
      style={{
        position: 'absolute',
        inset: 0,
        opacity,
        transform: `translate(${offset.x}px, ${offset.y}px)`,
      }}
    />
  );
};

export const IanLayeredScene: React.FC<{
  readonly scene: IanLayeredSceneBinding;
  readonly durationInFrames: number;
  readonly visualGenerationRoute: string | null;
  readonly soundEffectBusGain: number;
}> = ({scene, durationInFrames, visualGenerationRoute, soundEffectBusGain}) => {
  if (visualGenerationRoute !== 'ian-handdrawn-ppt') {
    throw new Error('IanLayeredScene only accepts ian-handdrawn-ppt');
  }
  if (typeof soundEffectBusGain !== 'number'
      || !Number.isFinite(soundEffectBusGain) || soundEffectBusGain <= 0) {
    throw new Error('IanLayeredScene requires the unified SFX bus multiplier');
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
      {validated.contract_version === IAN_LAYERED_SCENE_RENDERER_VERSION
        ? validated.layers.map((layer) => (
            <LegacyFadeLayer key={layer.layer_id} layer={layer} frame={frame} />
          ))
        : validated.layers.map((layer, index) => (
            <AnimatedLayer
              key={layer.layer_id}
              layer={layer}
              entry={validated.entry_effects.layers[index]}
              frame={frame}
            />
          ))}
      {validated.contract_version === IAN_LAYERED_ENTRY_RENDERER_VERSION
        ? validated.entry_effects.layers.map((entry) => entry.sound_effect === null
          ? null
          : (
              <Sequence
                key={`${entry.layer_id}-sfx`}
                from={entry.sound_effect.cue_frame}
                name={`${entry.layer_id} 入场音效`}
                premountFor={1}
              >
                <Audio
                  src={staticFile(entry.sound_effect.derived_asset.asset)}
                  volume={entry.sound_effect.gain_multiplier * soundEffectBusGain}
                />
              </Sequence>
            ))
        : null}
    </AbsoluteFill>
  );
};
