# Shared Sound Effects

Reusable immutable source sound effects, automatic whole-storyboard design, and episode derivative tooling for knowledge-video assembly.

## Rules

- Files under `assets/` are immutable downloaded originals. Do not overwrite, trim, normalize, or rename them.
- `library-index.json` is the authority for the one active immutable manifest revision. Never rewrite a registered manifest or source asset; acquisition publishes the next revision and makes every older revision `legacy_read_only`.
- `shared-sound-effect-library-v2` materializes every revision through its parent, and records semantic roles, timbre family, official item/download/license URLs, live license observation, byte checksum, codec, sample rate, channels, duration, and size.
- Episode use must record the selected `asset_id`, source checksum, semantic role, onset/sync frames, gain, source-sample trim, derived-file checksum, cue-group coverage, selection basis, and `render_owner` in current `knowledge-video-sound-design-v2`. Completed checksum-valid v1 artifacts remain read-only.
- A library entry is not automatically approved for an episode. It must still pass episode-level timing, narration-dominance, licensing, checksum, and final-mix QA.
- Do not redistribute these files as a standalone sound library. Use them only inside a larger production.

## Ian layer-entry policy

- New/revised Ian assembly uses `ian-layered-entry-effects-v2`. In a shot with at least two layers, add sound only to 2–3 semantically important entries; all other layer entries remain silent. A one-layer shot has one cue. Every selected cue stays at its exact `entry_frame`.
- Select real source assets by element and meaning: paper/card motion uses paper timbres; contour, underline, or chalk drawing uses writing timbres; nodes, mechanisms, and state changes use click/pop timbres; broad reveals or directional motion use sweep/woosh timbres; insight, resolution, error, or emphasis may use an appropriate tone/impact. Record a concrete `selection_reason` for every audible layer.
- Within one shot, the same source asset may appear at most twice, and adjacent audible entries must use different timbre families. Prefer broader use of the checksum-current palette when semantics fit; do not manufacture variety only by pitch or playback-speed changes.
- Store every selected source as a deterministic pre-trimmed stereo 44.1 kHz WAV derivative. Remotion does not trim, pitch-shift, or time-stretch an original at runtime. Missing, stale, wrong-frame, unapproved, or policy-violating cues fail closed.
- Calibrate each selected profile independently so the post-gain derivative peak is normally -18 to -12 dBFS; do not reuse one gain merely because two layers share an element class.
- Narration gain remains 1. Mix normalization is forbidden. If the rendered master exceeds -1 dBFS, reduce every entry cue by one uniform SFX-bus multiplier; never lower narration.

## Whole-storyboard design

- Run sound design after visual assets, action states, Whiteboard timing, Ian entry effects, local-video actions, and both transition layers are locked, and before the shared-reuse decision or episode script. Bind the immutable `sound-design-policy-v2.json` path and SHA-256.
- Current `knowledge-video-sound-design-v2` has three mandatory structural anchors: `S01` opens audibly at frame `0`; each later `shot-boundary` jointly covers the preceding transition and next-shot opening; every `intra-shot-transition`, including `cut`, is audible. Only the terminal clean hold is exempt. Required anchors may not be silent.
- Optional visible actions, reveals, feedback, emphasis, Ian non-key entries, Whiteboard events, and local-video actions retain explicit audible/silent decisions and reasons. Abstract narration and nouns alone never create a cue.
- Select with `hard-gates-then-deterministic-ranking-v1`. Licensing, media, semantic role, and motion direction must pass before reuse or acquisition. Then rank route/material fit, direction, energy/attack, duration/sync, narration masking, adjacent timbre diversity, episode reuse count, and stable `asset_id`. Record the selected reason and every considered rejected candidate when any exists; do not describe the deterministic rank as an aesthetic score.
- One physical sound has one `cue_group_id`, one primary render event, and ordered `covered_event_ids`. Compatible simultaneous anchors may share it; all covered events stay audible while the group renders exactly once. An incompatible mandatory cue near Ian remains present and is intensity-managed rather than discarded.
- Mandatory cue groups do not consume optional budgets. Global optional groups scale by shot duration: `<=6 s: 1`, `>6–12 s: 2`, `>12–18 s: 3`, `>18 s: 4`. Strong groups stay at least 30 frames apart and no 30-frame window may contain more than three group onsets. Average 2.5–4.5 seconds, visible-event gaps above 6 seconds, and timbre variety are advisories, never permission to invent an unrelated sound.
- `prepare-sound-design.mjs` is the standard transaction entry: it verifies the selection hard gates, rechecks the active library, announces and acquires every missing compatible role, refreshes the library binding, builds missing derivatives, and then calls `build-sound-design.mjs`. The builder merges mechanical candidates with the locked-storyboard semantic analysis and fails if any decision is missing. `sound-design.mjs` validates structural coverage, canonical map, policy/bindings, cue groups, selection evidence, density, source semantics, derivatives, owners, and revoice-only retiming.
- `build-derived-wav.mjs` creates immutable episode-local stereo 44.1 kHz PCM WAVs. Remotion consumes those exact files without trim, pitch, speed, or normalization. `SoundEffectTrack` renders `global_sound_effect_track_v1`; `IanLayeredScene` retains `ian_layered_scene`; both multiply cue gain by the one top-level SFX bus value.
- Revoice calls `retimeKnowledgeVideoSoundDesignForRevoice`: preserve ordered events, audible/silent identity, reason, selection basis, semantic role, source, trim, derivative, gain, cue group, coverage, primary owner, and onset-to-sync offset; change only allowed onset/sync frames and current bindings. It never reanalyzes or downloads. A completed v1 parent stays v1; a completed soundless parent stays soundless.

## Acquisition

- Before acquisition, check the materialized active library for a hard-gate-compatible semantic role, direction, and energy; use route/material/attack/duration as ranking traits. If absent, `prepare-sound-design.mjs` briefly tells the user which sound is being downloaded and the visible event it serves, then continues without a new approval stop.
- Use Mixkit official item/license/download pages first and Pixabay official pages only as fallback. `acquire-sound-effect.mjs` accepts only live-confirmed cross-platform commercial use without required attribution, probes the downloaded media, hashes it, publishes one new manifest/index atomically, validates the new active library, rolls back on failure, and removes all temporary paths.
- A missing or ambiguous license, unofficial host, unavailable official page, duplicate id/path/bytes/semantic role, invalid media, failed download, failed probe, or failed post-publish validation blocks the episode. Do not substitute an approximate effect.

## Source and license

Current entries were downloaded from Mixkit's official CDN on 2026-08-24, 2026-08-25, and 2026-08-28. At download time, Mixkit identified Sound Effects as Free License assets and stated that its free sound effects could be used in commercial and personal projects without required attribution.

- License page: https://mixkit.co/license/
- Sound effects page: https://mixkit.co/free-sound-effects/
- Active index: `library-index.json`.
- Current semantic overlay: `manifest-v24.json` (42 classified assets plus exact Ian cue-role aliases).
- Immutable historical inventories: `manifest.json` (12 assets), `manifest-v2.json` (22 assets), `manifest-v3.json` (22 classified assets), and registered revisions `manifest-v4.json` through `manifest-v23.json`. Keep registered bytes unchanged for completed episode bindings.

The upstream license remains authoritative. Preserve the manifest's source URLs and checksums with every reuse.

## Render proof

`render-proof/` provides a two-composition 44.1 kHz PCM proof fixture. First run the assembly `preflight-sound-mix.mjs` against its plan to prove the exact audio-only projection stays at or below `-1 dBFS` without rendering video. Render the narration-only baseline and mixed proof from the same entry with `--sample-rate=44100`, then run `verify-proof-render.mjs` to prove exact video-frame cue placement, narration gain `1`, and the common SFX bus multiplier. Run `validate-render-sound-mix.mjs` with the plan, preflight evidence, and mixed render to prove final projection identity, peak, and disabled BGM policy. Use a task-created public/output directory and remove that exact directory after validation.

## Current palette

- `paper-slide`: soft paper/card entrance.
- `writing-pencil`: hand-drawn or annotation entrance.
- `typewriter-soft-click`: restrained object or conclusion accent.
- `short-transition-sweep`: brief watercolor expansion or grouped reveal.
- `air-woosh`: soft whole-layer or camera-direction accent.
- `arrow-whoosh`: directional arrow or path-growth accent.
- `explainer-pop-whoosh`: light card, icon, or fact pop-in.
- `message-pop-alert`: small node or secondary-information pop-in.
- `relaxing-bell-chime`: insight, resolution, or key-takeaway accent.
- `page-turn-single`: page, section, or paper-layer change.
- `mechanical-tool-click`: mechanism control or state-lock accent.
- `writing-scribble`: contour drawing or short hand-drawn path growth.
- `fast-small-sweep-transition`: fast micro transition.
- `technology-transition-slide`: data or UI slide transition.
- `select-click`: neutral selection or state change.
- `click-error`: negative feedback or error state.
- `success-software-tone`: success or resolution confirmation.
- `confirmation-tone`: neutral confirmation or validated step.
- `pen-marker-line`: marker annotation or underline reveal.
- `paper-quick-movement`: quick paper layer or card change.
- `chalk-line-sound`: chalk annotation or diagram reveal.
- `quick-zoom-impact`: zoom emphasis or fact impact.
- `light-rain-loop`: gentle rain ambience.
- `wind-blowing-ambience`: sustained outdoor wind ambience.
- `water-flowing-ambience-loop`: flowing-water ambience.
- `campfire-crackles`: fire and campfire texture.
- `little-birds-singing`: short bird and nature ambience.
- `footsteps-tall-grass`: human walking through grass.
- `thick-wood-door-knock`: wooden-door knock.
- `twig-breaking`: short natural wood break.
- `cloth-slide-out`: fabric or cloth movement.
- `metal-tool-falling`: small metal fall and impact.
- `glass-break-hammer`: glass break and sharp impact.
- `mechanical-movements`: mechanical or technical movement.
- `keyboard-typing`: sustained computer typing.
- `camera-shutter-click`: camera capture accent.
- `crowd-applause`: medium crowd applause.
- `human-heartbeat`: single heartbeat accent.
- `glitch-static`: brief digital fault or interference.
- `cinematic-trailer-riser`: short tension rise.
- `movie-trailer-epic-impact`: cinematic impact accent.
- `tick-tock-clock`: clock and time-passage texture.
