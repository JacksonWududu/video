# Knowledge-video image and narration spreads

This is a conditional entry for an explicitly approved `illustrated-flipbook` presentation. All ordinary photo-book paths retain their existing behavior. This entry does not select or generate visual styles. The knowledge-video branch supplies the magazine typography, colors, image placement, exact text, timing, and approval bindings through the shared renderer.

## Inputs and scope

Use `leverage-video/src/shared/flipbook-video` rather than copying behavior into an episode. Its manifest contract is `knowledge-video-flipbook-v1`, with `style_id` and `presentation_mode` equal to `illustrated-flipbook` and a `1920×1080`, `30 fps` canvas.

Each shot is one double-page spread. One leaf contains the exact approved complete landscape raster with `contain`; the other contains the locked narration text. Preserve the actual approved source size, allowing up to `0.5%` relative aspect-ratio deviation from `16:9`; measure its dimensions instead of inventing a normalized copy. The active routes are `ian-handdrawn-ppt` and `imagegen`, both with `white_cat_present: false`. This entry uses static complete images, no layer package or layer-entry animation, and no reserved subtitle band. It does not loosen those requirements for another presentation mode.

`static_spread` carries `knowledge-video-static-spread-v1`, `source_text`, and `source_text_sha256`. Separate `text_reveals` carry ordered, contiguous UTF-8 byte ranges and real global audio `start_frame`/`end_frame` values. The ranges cover every original character and punctuation mark exactly once. Image labels remain under the ordinary short visible-text review; page narration uses its dedicated whole-batch review. Bottom captions remain an independent delivery choice.

`layout_seed`, `image_side`, and `text_side` are persisted before review. The builder generates a seed only when absent and rejects a side that differs from the saved seed. Preview, recording, and rerender must consume the same manifest bytes.

## Shared implementation

- `contract.mjs` validates exact source text, persistent layout, the two no-cat routes, complete frame coverage, approved turns, and recording evidence.
- `build-flipbook.mjs` verifies source audio/image hashes, creates the HTML leaves, and copies only the unchanged vendored runtime and the branch-owned browser implementation.
- `browser-runtime.js` prelays the entire text, fades and slightly raises exact short phrases on one wall-clock timeline, and executes real `St.PageFlip` page turns. Already revealed text stays visible. A reveal never reflows the page.
- `video.css` owns this branch's magazine presentation. The generic Skill remains style-neutral. The logical image content width in the final `1920×1080` frame is `708` pixels, with proportional height (`398.25` pixels for exact `16:9`); asset QA must assess readability at that size.
- `serve-flipbook.mjs` binds only `127.0.0.1`, serves an exact checked file map, and accepts recordings only from its own origin. It verifies manifest/build hashes before recording mutations and preserves failed proof without marking it accepted.

Production builders and servers require an executing `productionPreflight` callback from the assembly workflow. It must rerun the current episode gates and verify the exact plan bindings; a JSON field saying that approval passed is insufficient. The direct CLIs have no production callback and therefore reject production use.

Production files remain in their artifact categories: HTML and the vendored license document in `docs/flipbook-<id>/`, JS/CSS and vendored JavaScript in `script/flipbook-<id>/`, original approved images in their image asset category, manifests and proof in `schema/`, and captures in `assets/video/`. The server accepts the returned `build_descriptor` and exposes virtual URLs, so physical category separation does not change page behavior. Do not place a complete site bundle in an episode script or asset directory.

## Timing and capture

`S01` begins at frame zero with no publishing cover or hard cover. Every ordinary boundary is the registered `book-page-turn`, bound to this shared browser renderer and its exact approval evidence. A turn lasts 9–18 frames and finishes at the next shot's start frame. The last text reveal must finish before the turn starts. The initial implementation uses one approved turn duration throughout a book, while retaining an individual boundary decision for every turn. The terminal clean hold is exempt.

Before capturing, verify all image decodes, font readiness, exact source text, measured overflow, stable text layout, a visible `16:9` browser viewport, and frame-zero reset. Reject text overflow and return to semantic shot splitting; do not shrink fonts indefinitely or stretch audio.

The user must explicitly authorize Computer Use for the Codex internal browser before any browser operation. Preserve the active video workflow's approval mode and protected preview/recording gates. A mouse click starts the page's recording button; all subsequent text and page-turn events follow the approved timeline. Do not use another browser, headless rendering, shell UI control, or a canvas imitation as a silent substitute.

Capture uses `getDisplayMedia`, accepts only `displaySurface: browser`, and verifies the current tab through Capture Handle. A hidden tab, wrong surface, unverifiable current tab, resolution below `1920×1080`, layout failure, or viewport change fails closed. The start button and all recording status are hidden before captured timeline frames. No header, orientation label, folio, navigation button, hint, or debugging overlay is part of the video.

Store the original WebM, measured browser events, layout evidence, manifest hashes, and actual renderer completion events. The server probes and fully decodes the capture before locking it. The recording proof checks full reveal/turn coverage and bounded event drift. This evidence is input to the common audio, caption, delivery, and final media QA; a saved webpage or capture alone is not final video delivery.

## Synthetic maintenance verification

Maintenance uses only the dedicated `leverage-video/src/shared/flipbook-video/fixtures/` tree. It never reads a concrete episode, an old prototype, or a publishing cover. The test generator creates native-size synthetic rasters and either explicitly identified test tones or an explicitly named already installed system voice. Test voices do not establish or replace the production voice provider.

Run the unchanged generic album contract and the shared branch tests. The latter cover persistent sides, no-cat routes, exact UTF-8 coverage, turn approval, overflow evidence, guarded production calls, categorized output, stale hashes, and same-origin recording writes. Actual animation and video delivery may be claimed only after the separately authorized browser capture and final assembly QA.
