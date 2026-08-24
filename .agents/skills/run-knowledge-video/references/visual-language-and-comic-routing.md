# Visual language and legacy Comic routing

Treat `leverage-video/src/shared/visual-language/catalog.json` and
`leverage-video/src/shared/visual-generation-routes/catalog.json` as mechanical
authority. Use their validators; never reconstruct eligibility from prose.

## Provenance and scope

- Adapt planning and visual-language rules from Baoyu Skills commit
  `6b7a2e417500561a5ecdd0b168332f4142584617` under MIT. Keep the exact source
  record in `leverage-video/src/shared/visual-language/provenance.md`.
- Use `baoyu-article-illustrator` only to propose how content becomes a visual
  type, metaphor, structure, and route during storyboard construction. It does
  not generate an image.
- Use `baoyu-comic` only as a narrative-planning source for ordinary `imagegen`
  treatments and sequential beats. It does not create a separate active route.
- Use `baoyu-infographic` for structure and density classification,
  `baoyu-slide-deck` for 16:9 audience/density/layout presets, and
  `baoyu-xhs-images` only for treatment-profile × layout compatibility.
- Do not integrate cards, portrait pages, watermarks, CTAs, PDFs, Bun scripts,
  upstream merge/batch tools, publishing, fetching, translation, compression,
  cover generation, external image backends, or dangerous/execution-oriented
  upstream Skills.
- Keep `baoyu-diagram` deferred. It is not a selectable v2 route. A later
  implementation must rasterize safe SVG to an independently approved PNG;
  Remotion must never consume SVG nodes.

## Lock visual language

For every generated shot, lock `visual_structure_id` and
`treatment_profile_id` in `per-shot-visual-direction-review-v3` before route
approval. Narrative structures are `single-scene`, `conceptual-metaphor`,
`before-after-story`, `sequential-panels`, and `journey-path`. Structured and
technical entries cover comparison, hierarchy, progression, branching,
fishbone, timeline, architecture, and state machine.

Use only catalog-compatible structure, scene class, treatment, and route
combinations. A single comic-styled illustration remains:

```yaml
visual_generation_route: imagegen
treatment_profile_id: comic-*
comic_plan: null
```

`comic-imagegen` is retired from new and modified work. Comic aesthetics remain
available only as an ordinary `imagegen` treatment.

`xuan-paper-diorama` is an explicit optional narrative route backed by
`$generate-visual-styles` and its checksum-pinned `xuan-paper-diorama` profile.
It uses the narrative structure set, requires treatment profile
`xuan-paper-diorama`, is always text-free, and follows
`leverage-video/src/shared/visual-generation-routes/xuan-paper-diorama-route-v1.md`.
It is never the default route recommendation.

`ink-doodle-knowledge-card` is an explicit optional no-cat structured route
backed by `$generate-visual-styles` and its checksum-pinned profile of the same
name. It uses treatment `ink-doodle-knowledge-card`, allows only the exact
Chinese copy approved by the v3 row, and follows
`leverage-video/src/shared/visual-generation-routes/ink-doodle-knowledge-card-route-v1.md`.
Ian remains the default structured recommendation. `doodle-slides` is retired
from new or modified knowledge-video work and remains readable only in
unchanged historical evidence.

For unfinished and new work, Ian production means
`ian-knowledge-video-layered-scene-v1`, not one complete PNG. The approved
`ian-layered-scene-plan-v1` maps contiguous exact narration UTF-8 byte ranges
to ordered static semantic layers. Its count, semantic roles, and local entry
frames exactly project the approved visual-rhythm `asset_plan.layer_count` and
ordered `meaningful_change_events`; generation may not infer them.
Production generates one opaque paper background, full-canvas transparent
layers, and one deterministic final-composite review image. Assembly keeps all
geometry fixed and applies only the fixed eight-frame opacity fade for each
layer. Old single-raster/static/subtle Ian contracts are completed-history
read-only.

`local-video-file` is an explicit, never-default no-cat route for either scene
class. It requires treatment `source-video-native`, no added visible text, and
one checksum-bound absolute `.mp4` source path per shot. A route or path change
requires a refreshed presented map. It follows
`leverage-video/src/shared/visual-generation-routes/local-video-file-route-v1.md`;
its source pixels replace generated image/action states rather than defining a
new visual-language structure.

Resolve each structure's catalog-owned `composition_layout_id` through the
XHS-derived `treatment_layout_compatibility` matrix. The matrix classifies a
treatment/layout pair as `recommended`, `supported`, or `avoid`; an `avoid`
pair is incompatible and must be changed before visual-direction approval.
This matrix is planning evidence only. It never creates an XHS card, vertical
canvas, watermark, CTA, or additional generation route. Do not confuse
`composition_layout_id` (`sparse`, `balanced`, `dense`, `list`, `comparison`,
`flow`, `mindmap`, `quadrant`) with `comic-shot-plan-v1.layout`; Comic continues
to permit only `standard`, `cinematic`, `mixed`, or `splash`, and still forbids
`dense` as a Comic-page layout.

## Retired Comic contract

Keep `comic-shot-plan-v1` and its eligibility validator only to parse completed
unchanged v1/v2 evidence. It is not a v3 candidate, compatible route,
recommendation, or user choice. Sequential or before/after beats use one or more
independently approved ordinary `imagegen` states instead.

Every new or modified v3 review excludes `comic-imagegen` from compatible and
incompatible route lists. A legacy Comic field may be read from an unchanged
completed episode, but it cannot be migrated, regenerated, reapproved, or used
to create a derivative.

## Lock recurring characters

Treat white-cat shots as imagegen-backed narrative shots. The selectable routes
are ordinary `imagegen` and explicit `xuan-paper-diorama`; both must pass the
existing canonical white-cat reference as a real image input and preserve its
identity and action system. Never replace a historical person, factual identity,
or experimental subject with the cat.

Resolve visible text by the selected route. Ordinary `imagegen` with
`white_cat_present: true` and every `xuan-paper-diorama` shot are always
`visible_text_mode: none`, with null exact copy/placement and no top title.
No-cat ordinary `imagegen`, Ian semantic layers, Ink Doodle Knowledge Card,
and Whiteboard follow their own raster, layered-package, or annotation text contracts. Local
video preserves source pixels and permits no added route-owned text. V3 resolves
the route-compatible visible-text candidate only. Every `required` candidate must
pass `concise-summary-visible-text-v1`, then all generated-shot candidates,
including `none`, enter one `visible-text-batch-review-v1` complete-map approval.
That approval is top-level and checksum-bound; per-shot text approval is forbidden,
and one-click policy authorization cannot substitute for it. Visual production
cannot add another text decision, and assembly cannot create or remove a generic title.

## Historical asset and assembly compatibility

Every new/replanned multi-image v3 shot uses `intra-shot-transition-v1`: exactly
`N - 1` entries, zero-frame `cut` by default, and `watercolor-bloom` only with
manual approval or one-click policy authorization bound to the active `storyboard-visual-rhythm-v2` map. This
rule is independent of visual treatment; a watercolor-rendered image does not
imply a watercolor transition.

Completed unchanged v1/v2 episodes may retain whole approved Comic PNGs,
`ComicScene`, character-reference evidence, and exactly `N - 1`
`intra-shot-watercolor-bloom-v1` transitions. These parsers and consumers exist
only for read-only inspection. Do not generate, revise, normalize, reapprove,
preview, render, or deliver a new output from them.

Generation-route-specific inter-shot recommendation rules have priority; the
shared semantic recommendation is only the fallback when no matching route rule
exists. The retained legacy Comic → Whiteboard rule therefore resolves to
`wipe/from-right`, while the generic route-change fallback is `wipe/from-left`.
After route-first resolution, a boundary touching an approved white-cat
`imagegen` shot uses `imagegen-white-cat-watercolor-bloom-priority-v1` before
the shared semantic fallback. `scene-transition-recommendation-diversity-v2`
may diversify this white-cat preference and shared-fallback recommendations,
allowing one visible kind to run at most three times and to occupy at most five
boundaries and 30% of visible transitions. It never rewrites a matching
route-specific rule; if a route-owned or explicit user choice breaches a limit,
proposal generation fails closed.
Every selected effect still requires shared-catalog support, shared-renderer
execution, and explicit Per-Boundary Transition Review.
The active v3 transition catalog excludes `zoom-blur`, `flip`, `slide`, and
`clock-wipe` from new selection and automatic recommendation. Their renderer
branches remain available only to read or reproduce unchanged historical v2 evidence.

## Preserve revoice and legacy behavior

A parent containing `comic-imagegen` cannot enter `revoice_variant`; it remains
historical read-only. Use v3 and an active route for every new shot and every
modified historical shot, then refresh that shot's affected downstream evidence.
Never batch-migrate historical projects.
