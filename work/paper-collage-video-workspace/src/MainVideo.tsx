import {useMemo} from 'react';
import {AbsoluteFill, Audio, Sequence, staticFile} from 'remotion';
import {ReplicaChapterScene} from './ReplicaChapterScene';
import {SceneTransitionOverlay} from './SceneTransitionOverlay';
import {
  normalizeProject,
  type PaperCollageProject,
} from './project';

export const MainVideo = (project: PaperCollageProject) => {
  const normalized = useMemo(() => normalizeProject(project), [project]);
  const fontFace = normalized.theme.fontFile
    ? `@font-face { font-family: "PaperCollageProjectFont"; src: url("${staticFile(normalized.theme.fontFile)}"); font-display: block; }`
    : null;
  return (
    <AbsoluteFill style={{background: normalized.theme.canvas}}>
      {fontFace ? <style>{fontFace}</style> : null}
      {normalized.scenes.length === 0 ? (
        <AbsoluteFill
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            color: normalized.theme.subtitle,
            fontFamily:
              normalized.theme.fontFamily ??
              'STKaiti, KaiTi, "Noto Serif SC", serif',
            fontSize: 52,
            letterSpacing: 6,
          }}
        >
          {normalized.title} · 等待分镜配置
        </AbsoluteFill>
      ) : null}
      {normalized.audio.music ? (
        <Audio
          src={staticFile(normalized.audio.music.src)}
          volume={normalized.audio.music.volume}
        />
      ) : null}
      {normalized.scenes.map((scene) => (
        <Sequence
          key={scene.id}
          from={scene.from}
          durationInFrames={scene.durationInFrames}
        >
          <ReplicaChapterScene
            scene={scene}
            narrationVolume={normalized.audio.narration.volume}
            theme={normalized.theme}
            editorial={normalized.editorial}
          />
        </Sequence>
      ))}
      {normalized.transitions.map((transition) => (
        <Sequence
          key={transition.id}
          from={transition.from}
          durationInFrames={Math.max(1, transition.durationInFrames)}
        >
          <SceneTransitionOverlay transition={transition} theme={normalized.theme} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
