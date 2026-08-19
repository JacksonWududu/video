import {AbsoluteFill, useCurrentFrame} from 'remotion';

export type NarrationCaptionCueV1 = {
  readonly cue_id: string;
  readonly start_frame: number;
  readonly end_frame: number;
  readonly display_text: string;
};

export const NarrationCaptionsV1: React.FC<{
  readonly cues: readonly NarrationCaptionCueV1[];
}> = ({cues}) => {
  const frame = useCurrentFrame();
  const cue = cues.find((item) => frame >= item.start_frame && frame < item.end_frame);
  if (!cue) return null;
  return (
    <AbsoluteFill
      data-caption-component="narration-captions-v1"
      style={{
        pointerEvents: 'none',
        zIndex: 10000,
        alignItems: 'center',
        justifyContent: 'flex-end',
        padding: '0 120px 54px',
      }}
    >
      <div
        data-caption-cue-id={cue.cue_id}
        style={{
          maxWidth: 1680,
          padding: '15px 30px 17px',
          borderRadius: 14,
          backgroundColor: 'rgba(24, 20, 15, 0.78)',
          color: '#fffdf7',
          fontFamily: '"PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif',
          fontSize: 46,
          fontWeight: 600,
          lineHeight: 1.34,
          letterSpacing: 1.5,
          textAlign: 'center',
          textShadow: '0 2px 5px rgba(0, 0, 0, 0.72)',
          whiteSpace: 'normal',
          overflowWrap: 'break-word',
        }}
      >
        {cue.display_text}
      </div>
    </AbsoluteFill>
  );
};
