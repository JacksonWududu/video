# Cover, data graphics, and asset lock

Active publishing covers are created upstream by `$imagegen-calligraphy-cover` and are forbidden from visual production, storyboard, Remotion, masters, and internal QA. Every `cover-only-v1` opening-cover rule retained in this file is completed-history validation evidence only; it must not consume or transform `publishing-cover-generation-v1` assets.

## Route-approved data and transition graphics

- Validate the shot against `visual-generation-route-catalog-v2`, `visual-language-catalog-v1`, and its approved v3 review row before opening a generator or resolving a local file. Narrative work uses `imagegen`, including comic-styled treatments and separately generated sequential states; structured routes are Ian/Ink Doodle Knowledge Card/optional Whiteboard. `local-video-file` is an explicit no-cat, no-added-text route for either scene class and is processed only after all generated visual items are approved. Reject retired `comic-imagegen` and `doodle-slides`.
- For approved `ian-handdrawn-ppt`, use `ian-knowledge-video-layered-scene-v2` and exactly one canonical style anchor: `.agents/skills/ian-handdrawn-ppt/assets/reference-handdrawn-article-illustration-style.png`. Bind its current disk SHA-256 and require it to decode as a 1920×1080 8-bit RGB/RGBA PNG; arbitrary paths, text placeholders, stale checksums, and undecodable rasters fail closed. Use `gpt-image-2` once for one complete text-free Ian master whose approved semantic groups occupy non-overlapping zones with clean gutters; bind direct Codex native ImageGen lineage, raw SHA-256, and the embedded `gpt-image/2.0` software-agent observation without describing it as signature verification. Deterministically normalize and split that master into one opaque 1920×1080 paper background and ordered full-canvas transparent semantic layers bound to the approved narration byte ranges/entry frames. An exact user instruction may authorize `ian-pre-split-layout-repair-v1` only for intact separated groups that miss their approved zones; preserve the raw failed bytes and permit deterministic downscale-and-translate only before splitting. Overlay exact approved text only on its owning layer, and build one deterministic final-composite review PNG. Bind the current storyboard and v3 review path/checksum/map hash, and disable automatic page number, title, subtitle, labels, signature, and embedded contact-sheet content.
- Under `ian-handdrawn-ppt-default-v1`, an approved `ink-doodle-knowledge-card` selection is exact-shot opt-out evidence from the Ian recommendation; it does not change any other shot's default or create an inferred route.
- For approved `ink-doodle-knowledge-card`, use the checksum-pinned `$generate-visual-styles` Skill/profile to generate an exact `1920×1080` PNG with `ink-doodle-knowledge-card-route-v1` evidence. Bind exact prompt/reference/style fingerprints; Remotion consumes only the approved PNG. Review it under manual v2 or one-click v3 according to the explicit approval-mode selection.
- Preserve every approved route-owned byte unchanged. Ian v2 is an approved master-first deterministic derivative package, not an editable code graphic. New/revised assembly binds a separate `ian-layered-entry-effects-v2` map. It may apply only deterministic maximum-10-px soft settle, approved SVG contour/path reveal, or reasoned fade-only; source/final layer bytes remain unchanged. Its sound map gives exact-frame cues only to 2–3 key layers in a multi-layer shot, leaves others silent, varies real semantic timbres, caps a source at two uses per shot, and forbids pitch/speed-only pseudo-variation. Whole-scene pan/zoom, scale, rotation, random motion, inferred raster masks, parallax, internal cuts, redraw, relabel, and replacement are forbidden.
- Use standardized, low-expression human or animal glyphs only when the approved storyboard classifies them as `symbolic information token`s. Keep their identity, scale, row/group encoding, and visual grammar stable across phases. If they perform individualized actions or emotions, return the shot to the narrative/action-family workflow.
- Verify every number and label against authoritative sources and the locked storyboard.
- Keep comparable values in one scene and reveal them in spoken order.
- Keep essential values, labels, and formulas inside the horizontal title/action-safe margins.
- Neither structured route grants text permission: follow the shot's approved visible-text mode, include only exact approved Chinese wording when the mode is `required`, and request no visible words when the mode is `none`.
- Validate causal geometry as well as data: attempted paths must end at real barriers, current physical constraints must remain distinct from remembered/internal constraints, experimental groups must preserve the same encoding across prior-condition, shared-test, and result phases, and proportional claims must be countable or exactly labeled.
- For animal experiments or other sensitive harm, use restrained abstract condition/status indicators and neutral tokens. Preserve the factual structure while rejecting injury detail, fear close-ups, humor, or spectacle.
- An approved Ian semantic layer or Ink Doodle Knowledge Card raster may contain visible text only when the exact Chinese wording, placement, and purpose were approved in that route's storyboard text contract. If Ian text is inaccurate, use only that Skill's permitted deterministic exact-text correction on a new layer version, rebuild the final composite, and reapprove the complete changed package. If Ink text is inaccurate, generate a new PNG through its pinned style route. Remotion must not recreate or replace text. A no-cat `imagegen` shot follows its own approved raster-text decision. `imagegen` with `white_cat_present: true` is always text-free.

## Asset-count contract

Keep three separate counts:

1. `generated_narrative_rasters`: character-free narrative masters plus every performing-character family's `base/master + N` unique variants;
2. `generated_logic_assets`: every Ian source/normalized master, background, pre-text/final-layer, and final-composite package member plus every unique `ink-doodle-knowledge-card` raster used by a data/logic scene;
3. `production_outputs`: accepted rasters, exact 1920×1080 normalized rasters, the shared opening-cover archive/normalized raster, stills, contact sheets, previews, and final renders.

Repeated timeline use of one accepted state does not increase the unique-asset count. Rejected and superseded versions remain recorded as production overhead but do not increase the active accepted count. Recompute the final count only after real audio durations, shot classes, and every action-family `N` are locked.

## Shared opening cover

- Apply `cover-only-v1`. Resolve only the exact real regular file `/Users/jackson/Desktop/video-edit/video-resource/cover.png`; reject symlinks, non-regular/empty files, and path substitutions. Require its current SHA-256 to equal the source checksum recorded in the approved Storyboard Review before reading it into production.
- Decode the full file as PNG and require RGB/RGBA pixels, landscape orientation, and no more than `0.5%` relative aspect-ratio error from 16:9. Archive the exact bytes under the active episode's `assets/image/`, verify the archive checksum, and never modify the shared source or archived copy.
- Create one versioned exact 1920×1080 composition raster through deterministic proportional scale-to-cover plus the smallest centered crop. Use no text overlay, redraw, generated label, recolor, stretch, padding, second source, or editable topic-card layer. Record the source/archive/normalized paths, SHA-256 values, measured dimensions, aspect error, decode evidence, crop geometry, and render method.
- Inspect the normalized raster at full resolution and thumbnail scale, compare it against a deterministic rerun, and require identical bytes. The normalized raster may differ from the archive only by the recorded scale and centered crop.
- The shared cover is an externally fixed opening input already bound to the exact approved Storyboard Review. It is not a generated storyboard asset and must not enter `visual_asset_review.queue`; do not pause for a redundant per-image approval. A changed source checksum invalidates the opening plan and Storyboard Review before any downstream visual generation.
- Do not read, validate, fingerprint, archive, copy, or consume the retired shared `opening.mp4` or `topicCover.png`, and do not derive or generate a retired topic card.

## Accepted asset lock

Write a shot-to-asset manifest containing:

- active input storyboard path and exact-byte SHA-256;
- approved Storyboard Review SHA-256 and decision time;
- validated narration-master SHA-256;
- shot ID, scene class, and exact locked narration `source_text`;
- visual-direction review path/artifact checksum, route/visual-language catalog checksums, `presented_map_sha256`, exact user selection message/time, white-cat choice, `visual_structure_id`, `treatment_profile_id`, active non-null `visual_generation_route`, and route-resolved visible-text policy/mode/exact copy/placement; white-cat `imagegen` records `text-free-v1`, `none`, null copy/placement, and no title;
- for `local-video-file`, the exact approved absolute source path, archived root-relative MP4/checksum, probe/full-decode evidence, one unrotated native 1920×1080 H.264 stream, source duration/FPS, target duration seconds/frames, exact playback rate, `matched` status, muted-source-audio policy, strict approval, and `deferred-after-generated-visuals-v1` order;
- active versioned source and exact 1920×1080 normalized-raster paths;
- source checksum and measured dimensions/aspect error; exact 1920×1080 derivative checksum and dimensions where applicable;
- technical measurement method and result from actual raster decode; for separately governed non-data vector assets, include vector canvas/viewBox inspection plus a decoded test render;
- character reference path, version, and checksum;
- style ID;
- final English production/edit prompt;
- QA result;
- action-family role and chosen variant count;
- real shot duration and state schedule;
- common registration canvas;
- status: active, rejected, or superseded.
- for Whiteboard: source/normalized PNG, annotation JSON, preview PNG, silent MP4 paths and SHA-256 values; three nested review records; current `whiteboard-annotation-v2` with v3 review path/checksum/map binding (or unchanged legacy v1 read-only evidence); `whiteboard-render-evidence-v1`; element-order checksum; and `whiteboard-visual-sequence-lock-v1`.
- for Ian: all v2 package evidence above, plus optional/new-required `ian-layered-entry-effects-v2` path/checksum/map SHA, fixed policy SHA, element class, effect profile, edge margin, approved SVG path/checksum/path-data SHA where used, shared SFX manifest SHA, each audible layer's semantic selection reason, original source/trim/derived WAV checksums, exact cue frame/sample/gain, silent-layer nulls, per-shot repetition/timbre checks, and mix policy. Treat the embedded software-agent record as observation only, never cryptographic signature verification.
- canvas fingerprint: `16:9`, `1920×1080`, landscape.
- opening cover evidence remains outside the generated shot-to-asset queue: record `cover-only-v1`, source/archive/normalized paths and checksums, source and output measurements, aspect/decode QA, deterministic crop geometry, no-added-text QA, and the approved Storyboard Review checksum that locked the source bytes.

Freeze scene-to-asset and scene-to-state-family mappings before assembly. Remotion may consume only active accepted versions whose recorded storyboard and narration input fingerprints still match the current approved inputs.

## Production rasters and animation effects

- Require every imagegen source, the Ian source master, and the shared cover source to be landscape within `0.5%` relative error of 16:9, and every composition raster to measure exactly 1920×1080. Derive ordinary imagegen/cover normalized rasters and the Ian normalized master by their checksum-bound proportional scale-to-cover plus smallest centered crop within tolerance. Every Ian deterministic background/layer/final-composite member and Ink output is exact `1920×1080`; consume its approved bytes directly. Local video must already be native 1920×1080 and is consumed without resize, crop, stretch, or pad. Do not make an editable scene or code-drawn replacement.
- Preserve identical registration across every action family.
- For Ian, assembly follows only the checksum-bound entry-effects map: 8-frame deterministic soft settle, 12-frame approved SVG contour/path reveal, or reasoned fade-only. At most two motion language families may appear in one shot. A multi-layer shot has exact-frame SFX on only 2–3 key layers; other layers are silent, one source is used at most twice, adjacent audible timbres differ, and each cue records its semantic reason. Any distinct Ian content requires a new layer/package version and complete package reapproval.
- Preserve accepted sources untouched.
- For every v3 raster shot, store the ordered `image_sequence` and exactly N - 1 approved `intra-shot-transition-v1` entries for N images. Default every adjacent pair to zero-frame `cut`; use 18-frame `watercolor-bloom` only when its exact entry has explicit visual-rhythm-map-bound approval. Never infer or rebuild the map during production. A Whiteboard shot stores one panorama, its ordered element sequence, and zero raster transitions under `whiteboard-element-sequence-replaces-action-family-v1`; local video likewise uses its own MP4 contract. Historical v2 retains `intra-shot-watercolor-bloom-v1` unchanged.
- Store every storyboard-bound `scene-transition-v3` decision for every outgoing non-terminal shot: semantic class, source/next IDs and routes, route-first or shared-fallback recommendation authority/rule ID, recommendation, selected kind/options/duration, renderer, and exact approval evidence. `cut` is registered at zero seconds/frames with empty options; visible effects remain 0.3–0.6 seconds. Missing, `none`, unknown, substituted, or non-consecutive decisions block. Opening hard cut and terminal clean hold remain fixed exemptions.
- Do not stretch the cat, alter identity, or use post-processing to conceal failed image QA.

For technical QA, decode every active raster and record its measured dimensions. For SVG/vector assets, inspect the declared width, height, and viewBox, render the exact active file once at its declared canvas, decode that raster result, and record both checks. Do not accept dimensions copied from a prompt, filename, prior manifest, or inherited episode state.
