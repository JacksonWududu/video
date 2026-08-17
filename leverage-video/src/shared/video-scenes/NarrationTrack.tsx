import {Audio, Sequence, staticFile} from 'remotion';

export const NarrationTrack: React.FC<{
  readonly asset: string;
  readonly durationInFrames: number;
  readonly from?: number;
}> = ({asset, durationInFrames, from = 0}) => (
  <Sequence from={from} durationInFrames={durationInFrames} name="锁定旁白" premountFor={30}>
    <Audio src={staticFile(asset)} />
  </Sequence>
);
