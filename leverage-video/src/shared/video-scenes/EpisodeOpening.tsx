import {AbsoluteFill, Img, staticFile} from 'remotion';

export const EpisodeOpening: React.FC<{
  readonly coverAsset: string;
}> = ({coverAsset}) => (
  <AbsoluteFill data-opening-contract="cover-only-v1" style={{backgroundColor: '#f5efe2'}}>
    <Img
      src={staticFile(coverAsset)}
      style={{width: '100%', height: '100%', objectFit: 'fill'}}
    />
  </AbsoluteFill>
);
