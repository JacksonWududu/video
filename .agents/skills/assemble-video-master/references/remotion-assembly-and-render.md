# Remotion assembly and render contract

## Shared-code reuse gate

Before creating or copying any episode-local script, inspect every registered shared module listed by `leverage-video/src/shared/reuse-registry/registry.json`. Do not limit the check to modules already named by this reference. Run `node leverage-video/src/shared/reuse-registry/create-reuse-decision.mjs <episode-workspace>` while the episode script directory is absent or empty; the command must fail rather than inventory pre-existing scripts. Record one `reuse`, `extend_shared`, or `not_applicable` decision and a concrete reason per module in the generated `<episode-workspace>/schema/shared-reuse-decision-v1.json`, then require this command to pass:

`node leverage-video/src/shared/reuse-registry/validate-reuse-decision.mjs <episode-workspace>/schema/shared-reuse-decision-v1.json --phase pre-script`

Use `leverage-video/src/shared/assembly-plan` for the standard plan shape and routing contract, `leverage-video/src/shared/video-scenes` for the plan-driven Remotion composition, `leverage-video/src/shared/episode-tooling` for integrity and raster contracts, and `leverage-video/src/shared/render-qa` for media and delivery verification whenever applicable. Use the audio tools during an audio-validation phase rather than duplicating them in an episode. Episode-local script code may only register compositions and bind episode configuration or locked artifact paths. It must not copy shared implementations. If the shared implementation needs a generally reusable capability, extend and test shared first; do not hide the extension inside an episode.

After creating the episode bindings, add consumer path/checksum and a real parsed shared-import marker to every `reuse` or `extend_shared` row, then require the same validator with `--phase consumption` to pass before any Remotion still, Studio, preview, render, or composition lock. Run tests as real commands outside the decision JSON. Build the plan through `leverage-video/src/shared/assembly-plan`; it must read and checksum the exact active decision file and rerun consumption validation rather than trust a caller-supplied pass flag.

If and only if a non-empty episode script directory predates this gate and the user supplies explicit user authorization for the exact episode, use `create-legacy-reuse-decision.mjs` and require `--phase legacy-migration`. It must seal the complete existing script inventory with checksums and the exact authorization message/time. Do not move or clear any script and do not fabricate an empty pre-script inventory. Keep baseline bytes unchanged, declare only new binding files in `legacy_additions`, record real consumer source/checksum/import-marker evidence, and require `--phase consumption`; an altered baseline or undeclared file fails closed.

## Reusable episode opening

- Apply `cover-only-v1`. Re-resolve only the exact real regular file `/Users/jackson/Desktop/video-edit/video-resource/cover.png`; reject symlinks, non-regular/empty files, or substitutions. Fully decode it as RGB/RGBA PNG, require landscape orientation and no more than `0.5%` relative aspect-ratio error from 16:9, and require its SHA-256 and measurements to equal the exact source evidence approved in Storyboard Review. Revalidate the archived exact bytes under `assets/image/` and its deterministic exact 1920×1080 normalized raster. A changed source invalidates the opening schedule and Review approval; do not silently use the new bytes.
- Require the normalized raster to result only from proportional scale-to-cover plus the smallest centered crop. Use one single archived cover raster in `EpisodeOpening`; add no text overlay, generated title, editable layer, redraw, stretch, padding, second opening source, or image animation.
- Place the cover and validated narration master once, both beginning at composition frame 0. Keep the cover through `first_sentence_end_frame`, then zero-overlap hard-cut to `S01`. Later narration-bound visuals use their original narration-master frames with no composition offset.
- Require `narration_start_frame = 0`, `episode_opening_frames = first_sentence_end_frame`, and `final_master_frames = narration_master_frames`. Use the same `EpisodeOpening` component, cover source/archive/normalized checksums, and frame schedule for the separately rendered per-topic opening and for frames `[0, episode_opening_frames)` of the full master. Render both directly from source; never embed the separately encoded opening MP4 into the final master. The full master already contains this opening; keep the standalone render inside the episode workspace as internal prefix-QA evidence only, and never copy or return it as a user deliverable.
- Do not read, validate, fingerprint, archive, copy, or consume the retired shared `opening.mp4` or `topicCover.png`, and do not create a retired `OPEN-01` or opening-source audio branch.

## Shot execution plan

Bind every post-opening shot to the validated narration master, active assets, `storyboard-visual-rhythm-v1`, `action-state-schedule-v3` when applicable, exact intra/inter-shot transition/text/route fields, and its passing `per-shot-visual-direction-review-v3` row. The builder validates both review hashes, motion tier, catalogs, route-resolved text, exact asset-route equality, local-video evidence, and the absence of generic top-title/timeline-text fields. Ordinary white-cat `imagegen`, every `xuan-paper-diorama`, and every `local-video-file` shot remain text/title-free. Unchanged v2 stays on its historical schedule and renderer.

Apply `explicit-visual-generation-route-v3` to new or modified scenes. Route `imagegen` and `xuan-paper-diorama` to `NarrativeScene`, Ian and Ink Doodle Knowledge Card to `GraphicScene`, Whiteboard to `WhiteboardScene`, and `local-video-file` to `LocalVideoScene`. Local video must use a checksum-current strict-approved `local-video-match-v1` binding: one native unrotated 1920×1080 H.264 source, exact target frames, `playback_rate = source_duration_seconds / (target_duration_frames / 30)`, `match_status: matched`, and muted source audio. Map the complete source interval; do not trim, loop, pad, interpolate, crop, stretch, redraw, or add text. 宣纸 and Ink scenes use approved raster bytes directly; no paper overlay, shader, SVG/HTML reconstruction, or route fallback may simulate them. Reject `comic-imagegen` and `doodle-slides` in new, modified, revoice, still, preview, Studio, composition-lock, and render work. Historical unchanged v1/v2 plans remain readable as evidence only; no plan may infer or fall back from a missing route.

Require `visual_direction_artifact_policy` before any protected action. New or modified work must be `current_v3`. A v1/v2 plan may pass only as an unchanged completed `legacy_read_only` episode with an empty modified-shot list; reopening any legacy shot requires v3 before a new still, preview, Studio session, composition lock, or render.

For every visual governed by `ian-handdrawn-ppt-default-v1`, require passing `ian-knowledge-video-frame-v1` evidence bound to the current v3 row, then use Remotion for animation effects only. Load its sole approved 1920×1080 raster. Remotion must not redraw, recreate, or replace any part of the approved raster with SVG, HTML, canvas, code primitives, generated labels, editable data graphics, or a separate editable animation. If the shot needs a genuinely different content state, consume another separately generated and exact-byte-approved Ian handdrawn raster.

For every `ink-doodle-knowledge-card` visual, load only the exact-byte-approved `1920×1080` PNG whose checksum and route evidence are bound in the manifest. `GraphicScene` must not redraw or relabel it and must not use `FullFrameMaskSweep`; Ian's mask rule must never leak into Ink. One state holds. Multiple approved Ink PNG states use the exact `intra-shot-transition-v1` map—normally zero-frame cuts; watercolor only when explicitly approved. Historical unchanged `doodle-slides` evidence may be parsed only and cannot produce new output.

Keep `ComicScene` only as a legacy decoder/consumer implementation for already completed unchanged v1/v2 evidence. Do not invoke it for a new output or derivative, and do not generate, revise, normalize, or reapprove its assets.

For every Whiteboard visual, require strict source/annotation/clip approvals and exact media/checksum evidence. New/modified work must carry `whiteboard-annotation-v2` whose `none | required`, exact text, placement, v3 file SHA-256, and `presented_map_sha256` have been checked against disk; legacy v1 is unchanged read-only only. Load only its approved MP4; never redraw it or add intra-shot watercolor. Keep the ordinary outgoing `scene-transition-v3` decision.

Apply `ian-full-frame-mask-sweep-v1` by the active visual manifest's exact generation-route predicate:

- When and only when an active shot records `visual_generation_route: ian-handdrawn-ppt`, its Remotion scene must use the existing `FullFrameMaskSweep` exported from the repository-relative shared module `leverage-video/src/shared/full-frame-mask-sweep`. Import and reuse that module; do not copy, fork, or reimplement its timing or mask logic inside an episode.
- Pass the shot's own `durationInFrames` to both its `Sequence` and `FullFrameMaskSweep`; use the shot duration rather than the full-composition duration. The raster stays fixed while a canvas-sized mask moves smoothly from left to right.
- Let `hold_frames = round(fps × 3)`. If `duration_in_frames <= round(fps × 3)`, create no mask animation and show the complete raster from the shot's first frame through its last frame. Do not reject or shorten the shot.
- If `duration_in_frames > round(fps × 3)`, set `sweep_frames = duration_in_frames - round(fps × 3)` and `hold_frames = round(fps × 3)`: run the sweep first, then show the complete raster for exactly 3 seconds through the shot's final frame.
- This mandatory three-second final hold is an explicit exception to the general 2.5-second maximum continuous hold. Do not add another pan, zoom, opacity reveal, internal cut, or arbitrary motion on the same Ian raster to evade or supplement this schedule; an ordinary inter-shot transition may still occur at the shot boundary without changing the shot's own duration.
- A visual without the exact `visual_generation_route: ian-handdrawn-ppt` marker must not use this rule or component. In particular, Ink `GraphicScene` and historical `DoodleScene` never import or consume `FullFrameMaskSweep`.

For `revoice_variant`, reject a parent using `comic-imagegen`. Otherwise preserve direction evidence, shot/asset/state identity and order, bytes, route, text, motion, every intra-shot effect, and every inter-shot transition. For v3 consume only replacement timing and recompute state entry/end frames from locked text ranges; block when an effect changes or any target has fewer than 15 clean frames. Historical v2 retains its 18–75-frame and mandatory-watercolor constraints.

For an Ian shot in a `revoice_variant`, preserve `ian-full-frame-mask-sweep-v1` as its locked motion kind but recompute its static-versus-sweep branch and frame counts from the newly approved shot duration. Crossing the three-second boundary changes only the deterministic timing branch of that same rule; it does not authorize a new motion kind or visual.

- Keep character-family camera/crop/background/scale/light/space registration fixed.
- Validate `action-state-schedule-v3`: `stateful` 2–4 complete states, `hero_pose` 4–6 poses, exact text-byte coverage, unique semantics, complete frame coverage, fourth-state rationale, and over-five split/approval evidence. `layered`, Whiteboard, local video, and ordinary single-image scenes use their own asset contracts instead of fake states.
- Require ordered `image_sequence` plus exactly `N - 1` `intra-shot-transition-v1` entries. `cut` is zero frames; `watercolor-bloom` is 18 frames and requires explicit active-map approval. Every target retains 15 clean frames. `IntraShotImageSequence` must throw on unsupported effects and provide no fallback.
- Before any protected Remotion action, require `node .agents/skills/assemble-video-master/scripts/validate-intra-shot-transitions.mjs <assembly-plan.json> <composition-source.tsx>` to pass. For an unchanged v2 plan the dispatcher preserves the legacy mandatory-watercolor validator and renderer.
- Treat `medium_high_v1` cadence as QA warnings: aim for a meaningful change within four seconds, avoid a third identical visual structure in succession, change composition/treatment within 18 seconds, use at least three structures in the first 30 seconds with a dramatic function, and keep hero shots near 10%–25%. A transition alone never counts as a meaningful change.
- Keep ordinary scene transitions at 0.3–0.6 seconds.
- Apply `scene-transition-v3` at every ordinary boundary. Validate semantic class/recommendation and approval hash. Registered `cut` uses zero seconds/frames and empty options, creates no tail, and requires adjacent zero-overlap scenes. Visible effects—including `fade`, `slide`, `wipe`, `flip`, `clock-wipe`, `iris`, `linear-blur`, and `zoom-blur`—remain 0.3–0.6 seconds. `none`, bad options/renderers, and fallback block.
- Reuse the repository-relative shared module `leverage-video/src/shared/scene-transitions`. Recompute and verify that each recommendation used a matching source-route rule first and the shared semantic rule only as fallback; selection support and execution still come exclusively from the shared catalog/renderer. Preserve every locked shot start/end frame, narration cue, approved raster byte, exact selected effect/options, and the total composition duration by rendering the outgoing image as a deterministic transition overlay rather than shortening the timeline.
- Keep `OPEN-00 → S01` as the only zero-overlap hard-cut exception. Only the terminal clean hold may have no outgoing transition.
- A transition description stored in storyboard or assembly JSON is not proof of execution. Before any Remotion still, Studio, preview, render, or composition lock, require a passing `node .agents/skills/assemble-video-master/scripts/validate-scene-transitions.mjs <assembly-plan.json> <composition-source.tsx>` result proving complete structured plan coverage, exact user-selection evidence, catalog kind/options support, and shared renderer binding. A legacy v1 plan must first be migrated through Per-Boundary Transition Review.

## Caption-mode timeline and deterministic approved text

- Preserve upstream caption-cue `source_text`, `display_text`, and narration-derived timing as locked evidence. A caption-free role treats them as audit data only. A captioned role may consume only `display_text` and its narration-master timing as a render input; never render `source_text` independently, paraphrase it, or change cue order.
- Build one versioned narration-caption component for the horizontal bottom safe area. A caption-free role must not instantiate or mount it. A captioned role must mount exactly one caption component and produce the expected burned-in bottom narration captions from the locked cues, including the first sentence over the cover beginning at frame 0.
- Burned-in captions are video pixels, not a subtitle track. Every role must record `subtitle_stream_count: 0` and `subtitle_sidecar_delivered: false`; do not mux SRT/VTT/ASS or another subtitle stream or prepare a subtitle sidecar for delivery.
- Require bottom narration captions to be absent in caption-free roles and expected-and-verified in captioned roles. This does not remove or alter separately approved route-owned raster/annotation text or cover typography.
- Keep every route-owned label or title baked into and checksum-bound to the approved raster, or bound to the approved Whiteboard annotation/clip. Do not recreate, edit, reposition, or remove it in Remotion. If it crowds the frame, return to the producing route for a new reviewed asset version.
- Do not define or mount a generic top-title component. Ordinary white-cat `imagegen` is title-free; other routes may show a title only when their own approved asset contract already contains it.
- Keep ordinary delivery-cover typography separate from the timeline; `OPEN-00` mounts no added title or text layer and preserves only pixels already present in the exact shared cover source.

## BGM-free base

Assemble accepted visuals, stepped families, data scenes, transitions, narration, approved route-owned raster/annotation text, internal animation, and only discrete sound effects listed with passing QA in the active sound-effect manifest. Verify each effect's path/checksum and storyboard cue before use; add no generic title/text overlay, caption layer, subtitle stream, unlisted effect, BGM, or arbitrary tail padding before duration lock. Apply the selected bottom-caption layer only in the post-lock render branch.

Use one native 16:9, 1920×1080 landscape Remotion composition for stills, Studio, previews, contact sheets, and final rendering. Before composition, decode and measure every active raster. Reject any input whose measured width or height differs from 1920×1080; never resize, stretch, crop, pad, or embed a mismatched visual to make it appear compliant. Active Ink inputs are approved PNG bytes only; no editable or reconstructed source enters Remotion preflight.

## Explicit local browser

Before any Remotion still, render, or Studio workflow, inspect these paths in order and use the first suitable executable:

1. `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
2. `/Applications/Chromium.app/Contents/MacOS/Chromium`
3. `/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge`
4. `/Applications/Brave Browser.app/Contents/MacOS/Brave Browser`

Pass `--browser-executable='<absolute path>'` to every relevant command. Never allow Remotion to download Chrome Headless Shell. If none exists, stop and report the blocker.

If sandboxed headless rendering fails with `No available ports found`, request the required runtime permission and retry with the same explicit browser path. This is not interactive Computer Use.

If a full render fails at frame zero with `Visited http://localhost:... but got no response`, retry with `--concurrency=1`.

## Visual preflight

1. Render and inspect stills from the cover opening at frame 0, a representative cover-hold frame, its final frame, and the first post-opening content frame before full rendering.
2. Inspect every master/action state and scheduled state boundary. For a cut, inspect adjacent pre/post frames; for an explicitly approved watercolor, inspect first/middle/final effect frames and the following clean hold. Also inspect representative scene frames, every ordinary inter-shot transition, and every data reveal.
3. Produce and inspect a preview and contact sheet. Decode and measure every still/contact-sheet raster, and probe and fully decode every preview; require exact 1920×1080 output for each rather than inheriting the composition's claimed fingerprint.
4. Check cover integrity, frame-0 narration, opening cut, A/V sync, identity, registration, cadence, framing, bottom-caption safe area, deterministic text, data, transitions, black frames, and holds. Verify Ian/Ink evidence; historical Comic and Doodle checks apply only during read-only inspection. Verify Whiteboard evidence as before. Inspect non-Whiteboard action continuity.
5. Repair and repeat until passing, then record `scene-transition-v3` validator output. Visible effects retain first/middle/final boundary frames; `cut` retains adjacent pre/post frames proving zero tail and overlap. Then record `composition_lock`.

For a revoice variant, also compare the rendered scene/state order to `visual_sequence_lock`, verify every cut against the replacement transcript's exact text span, and record the revoice binding checksum in `composition_lock`.

After `composition_lock`, require the recorded Caption Delivery Choice before final rendering. For every selected delivery master and matching internal opening-QA role, inspect the opening, representative cue starts/ends, overlapping visual text, line wrapping, safe-area bounds, and the whole-film contact sheet. Caption-free roles must show no bottom narration captions or accidental transcript-like overlays. Captioned roles must show exactly the locked `display_text` at the locked frames, with no missing, duplicate, early, late, or extra cue. In `both`, compare the two masters and the two internal openings for identical frame counts, audio/timing/input fingerprints, and visual order; compare each opening prefix only to its same-caption-role master.
