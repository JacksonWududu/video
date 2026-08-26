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
`ian-knowledge-video-layered-scene-v2`, not one flattened production PNG or a
set of independently generated members. The approved `ian-layered-scene-plan-v1`
maps contiguous exact narration UTF-8 byte ranges to ordered static semantic
layers. Its count, semantic roles, and local entry frames exactly project the
approved visual-rhythm `asset_plan.layer_count` and ordered
`meaningful_change_events`; generation may not infer them. Production first
plans non-overlapping semantic zones with clean gutters and uses `gpt-image-2`
once to create one complete text-free Ian master. It binds the raw SHA-256 to
direct Codex native ImageGen lineage and an embedded `gpt-image/2.0`
software-agent observation—observation only, not cryptographic signature
verification—then deterministically normalizes and splits the master into an
opaque paper background and full-canvas transparent pre-text layers. Exact
whole-batch-approved text is overlaid only on its owning layer with 8 px
containment before the deterministic final composite is rebuilt. Assembly keeps
all geometry fixed and applies only the fixed eight-frame opacity fade for each
final layer. Old single-raster/static/subtle and v1 independent-member Ian
contracts are completed-history read-only.

`local-video-file` is an explicit, never-default no-cat route for either scene
class. It requires treatment `source-video-native`, no added visible text, and
one checksum-bound absolute `.mp4` source path per shot. A route or path change
requires a refreshed presented map. It follows
`leverage-video/src/shared/visual-generation-routes/local-video-file-route-v1.md`;
its source pixels replace generated image/action states rather than defining a
new visual-language structure.

## Episode visual cohesion

Apply `episode-visual-cohesion-v2` to every newly planned or generated shot. Gate 2
selects exactly one white-cat style and its matching episode cohesion profile; the
selection SHA-256, style ID, and cohesion ID are copied into every current v3
direction row, selected row, generation request, QA record, and visual manifest.
No shot may silently select, mix, or substitute the other style. This layer never
overrides route, visible text, composition, identity, approved bytes, or revoice
locks.

For `loose-line-vivid-watercolor`, use `warm-paper-watercolor-cohesion-v1`:

- White-cat `imagegen` uses the full selected profile and the sole canonical cat
  reference. Other routes share warm-white paper, fine dark-gray/ink lines,
  restrained blue-purple and light-peach accents, and appropriate negative space.
- Ian keeps its sole Style Anchor, fine structural detail, semantic zones, gutters,
  and `ian-knowledge-video-layered-scene-v2`; never add a second Style Anchor or
  copy watercolor brush behavior into its drawing grammar.

For `twilight-neon-animation`, use `twilight-luminous-cohesion-v1`:

- White-cat `imagegen` uses the full selected twilight animation profile and the
  sole canonical cat reference.
- Ian remains Ian: use pale-lavender or warm-white paper, indigo/gray-violet fine
  lines, periwinkle fields, restrained light-peach/coral accents, and slightly more
  negative space. Forbid dark cinematic backgrounds, neon signs, heavy bloom,
  plastic 3D modeling, animation-character remodeling, and a second Style Anchor.
- No-cat ImageGen, Xuan, Ink, and Whiteboard preserve their route mechanics and
  style authority while using the same pale ground, indigo/gray-violet structure,
  periwinkle, and restrained peach/coral accent family. Fixed profile bytes and
  checksums never change.

`local-video-file` and the fixed opening cover remain pixel-preserving exceptions.
Never recolor their bytes. Ian and white-cat ImageGen may retain normal medium
differences, but unexplained jumps in palette family, luminance, saturation,
negative-space density, or adjacent-shot visual weight are cohesion failures.
Generation QA must name and reject every affected shot before visual lock; a
revised asset returns through its approved route and the same bound cohesion ID.

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

Treat current white-cat shots as ImageGen-backed narrative shots. Their sole
active route is ordinary `imagegen`; every generation passes the existing
canonical white-cat reference as a real image input and uses the episode style
binding. Xuan white-cat assets are completed-history read-only. Never replace a
historical person, factual identity, or experimental subject with the cat.

Resolve visible text by the selected route. `imagegen` with
`white_cat_present: true` and every no-cat `xuan-paper-diorama` shot are always
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
After route-first resolution, a boundary touching white-cat `imagegen` uses the
episode style: loose watercolor resolves through
`imagegen-white-cat-watercolor-bloom-priority-v1`; twilight animation resolves
through `imagegen-white-cat-twilight-dissolve-priority-v1`. Only then use the
shared semantic fallback. `scene-transition-recommendation-diversity-v2`
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
