# Knowledge-video shared code

Reusable production code belongs here; episode folders contain only configuration, locked inputs, thin composition registration, and episode artifacts.

Before creating or copying episode-local code, read `reuse-registry/registry.json`, inspect every registered module, write the episode reuse decision, and run its validator. Extend shared code when behavior is reusable across episodes. Do not copy a shared implementation into an episode.

Core modules:

- `assembly-plan`: plan generation, scene routing, inter-shot and intra-shot transition contracts.
- `audio-tools`: offline word timestamps and strict locked-narration comparison.
- `episode-tooling`: file integrity, atomic JSON, and raster geometry contracts.
- `video-scenes`: cover-only opening, narration, narrative, Ian graphic, and plan-driven composition.
- `render-qa`: media probing, full decode, and exact-role delivery locking.
- `scene-transitions`, `watercolor-bloom`, `full-frame-mask-sweep`, `gen-think`: mandatory shared render effects and visual families.
