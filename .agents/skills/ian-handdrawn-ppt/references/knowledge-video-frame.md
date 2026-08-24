# Ian knowledge-video layered-scene adapter

Use `ian-knowledge-video-layered-scene-v1` only when an approved knowledge-video
shot selects `visual_generation_route: ian-handdrawn-ppt`. This mode overrides
the ordinary article/PPT page shell; it does not create a deck or one flattened
production raster.

`ian-knowledge-video-frame-v1`, `ian-static-full-frame-v1`, and
`ian-subtle-raster-motion-v1` are completed-history contracts only. Do not use
them to create, revise, preview, or render an unfinished or new episode.

## Bound input

Before generation, require one resolved episode workspace, one queue item and
shot ID, the exact shot narration text and frame range, one approved
`ian-layered-scene-plan-v1`, and the current
`per-shot-visual-direction-review-v3` artifact path, file SHA-256, and
`presented_map_sha256`. The selected row must match the shot, route,
`treatment_profile_id`, `visible_text_mode`, exact Chinese, and placement
byte-for-byte. Missing, stale, ambiguous, or mismatched evidence blocks
generation.

The plan divides the complete narration source text into ordered, contiguous,
non-overlapping UTF-8 byte ranges. Each range owns one semantic layer and one
local `entry_frame`. Its count must equal the approved visual-rhythm shot's
`asset_plan.layer_count` and ordered `meaningful_change_events` count. Each
layer's `semantic_role` equals its event description, and `entry_frame` equals
`event.at_frame - shot_start_frame`; never infer these values during generation.
The first layer enters at frame 0; later entries must leave enough room for the
fixed eight-frame fade and must complete before the shot ends. The ranges must
cover the source text exactly once.

## Production object

Create one package with these checksum-bound members:

- one opaque 1920×1080 near-white paper background;
- one or more ordered 1920×1080 transparent PNG semantic layers, each with
  visible and transparent pixels;
- one opaque 1920×1080 final-composite PNG produced deterministically by
  compositing the ordered layers over the background.

The final composite is review evidence, not the Remotion production source.
Remotion consumes the approved background and ordered layers directly.

Generate every semantic element as its own transparent full-canvas layer. Do
not generate a complete page and recover layers with masks, crops, chroma keys,
inpainting, or pixel guessing. A layer may contain a coherent semantic group
such as one diagram node plus its approved label; it must not contain content
owned by a later narration range.

The scene is spatially static. The background and all layers keep identical
position, scale, and rotation for the whole shot. The only internal animation
is `ian-layer-entry-fade-v1`: linear opacity 0→1 over exactly eight local
frames, beginning at the layer's approved `entry_frame`. Masks, internal cuts,
whole-scene pan/zoom, per-layer movement, parallax, rotation, skew, and inferred
animation are forbidden. The approved incoming `scene-transition-v3` remains
the sole owner of ordinary shot entry.

## Prompt override

- Reuse Ian's near-white paper, fine handdrawn lines, restrained pastel palette,
  diagram grammar, and negative space.
- Disable the ordinary page shell: no automatic page number, title, subtitle,
  label, signature, watermark, corner text, or filler writing.
- For `visible_text_mode: none`, use an empty `Required text only` list and keep
  every layer text-free.
- For `visible_text_mode: required`, use only the exact v3-approved Chinese.
  Deterministic text repair may place only those exact bytes in the approved
  semantic layer and placement.
- A contact sheet is an outer Visual Asset Review artifact only. Never bake its
  filename, numbering, border, or annotations into any package member.

## Output and validation

Write one `ian-knowledge-video-layered-scene-v1` manifest beside the versioned
review evidence. Its repository-root-relative paths bind the current
storyboard, visual-direction row, narration timing, exact plan, background,
ordered layers, final composite, and every checksum. All paths must remain
inside the resolved episode workspace.

Run:

```bash
node .agents/skills/ian-handdrawn-ppt/scripts/validate_knowledge_video_layered_scene.mjs \
  <episode-workspace> \
  <ian-knowledge-video-layered-scene-v1.json>
```

The validator rereads every member, verifies PNG dimensions and alpha roles,
rebuilds the final composite from the background and ordered layers, and
requires exact byte equality with the submitted final composite. Structured QA
and Visual Asset Review remain required; the manifest cannot approve its own
pixels.

QA must record one `independent-member-generation` lineage stage for the
background and for every semantic layer, in package order. Each stage binds its
own prompt, exact output path/checksum, and the pinned style reference; no stage
may use the prior final composite or another package member as an image input.
The final composite has no generation stage because the package validator
rebuilds it deterministically from the approved source members.

## Migration

Completed historical episodes remain byte-for-byte read-only. For every
unfinished episode, invalidate each active Ian single-raster asset plus its
downstream visual approval, visual manifest, assembly plan, preview, render,
and delivery evidence. Preserve narration, audio, and non-Ian assets when their
bindings remain current. Rebuild and explicitly approve an
`ian-layered-scene-plan-v1` and package for every affected Ian shot before
continuing. A relaxed rule never auto-approves migrated bytes.
